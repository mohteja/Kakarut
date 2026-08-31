import { randomUUID } from "node:crypto";
import { halamanQuery } from "../../lib/halaman-query";
import { BATAS_QTY_STOK } from "../../lib/batas-angka";
import { zValidator } from "../../lib/validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  qtyTeks,
  wajibKelipatanKirim,
  type KonfirmasiStatus,
  type TransferStokFaktur,
  type TransferStokItemRow,
  type TransferStokSaldoRow,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  ingredients,
  productions,
  users,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import {
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";
import { wajibKelipatanKemasan } from "../../lib/kemasan";
import { terbitkanNomor } from "../dokumen/nomor";
import { catatLogFaktur } from "../produksi/log";
import { hitungSaldoCabang, kunciKirimCabang, qtyDalamJalan } from "../stok/service";
import {
  clientRefField,
  denganKlaimIdempoten,
  deviceIdField,
} from "../sync/idempoten";

const TransferBody = z.object({
  /** cabang ASAL (stok berkurang saat kiriman diterima) */
  asal_branch_id: z.string().uuid(),
  /** cabang TUJUAN (stok bertambah saat diterima di Penerimaan) */
  tujuan_branch_id: z.string().uuid(),
  catatan: z.string().trim().max(300).nullish(),
  /**
   * Kunci idempotensi (UUID v4 dari perangkat) — memakai ledger BERSAMA
   * `(company_id, client_ref)` yang sama dengan penjualan & opname.
   *
   * Bukan pengaman dari klik ganda: tombolnya sudah dimatikan selama pending.
   * Yang dijaga adalah jaringan yang putus SESUDAH server menulis tapi SEBELUM
   * balasannya sampai — dan itu tak selalu butuh manusia. Terukur di Chromium:
   * saat server menutup koneksi keep-alive yang sedang dipakai ulang, browser
   * MENGULANG SENDIRI POST itu tanpa aksi siapa pun (lihat `lib/idempoten.ts`
   * di web).
   *
   * Akibat penggandaan di sini bukan sekadar baris kembar: stok keluar dari CK
   * DUA KALI untuk satu pengiriman, dan cabang menerima dua kiriman yang sama.
   * Opsional supaya klien lama tak berubah perilakunya.
   */
  client_ref: clientRefField,
  device_id: deviceIdField,
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().positive().max(BATAS_QTY_STOK),
      }),
    )
    .min(1)
    .max(100),
}).strict();

const pembuat = alias(users, "pembuat_transfer");
const cabangAsal = alias(branches, "cabang_asal");
const cabangTujuan = alias(branches, "cabang_tujuan");

/**
 * Cabang milik perusahaan yang boleh jadi asal/tujuan transfer: aktif dan
 * BUKAN kantor (kantor tak menyimpan stok).
 */
async function pastikanCabangStok(companyId: string, id: string, peran: "Asal" | "Tujuan") {
  const [b] = await db
    .select({ id: branches.id, nama: branches.nama, tipe: branches.tipe })
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.companyId, companyId), eq(branches.isActive, true)));
  if (!b) throw new HTTPException(404, { message: `Cabang ${peran.toLowerCase()} tidak ditemukan` });
  if (b.tipe === "kantor") {
    throw new HTTPException(400, {
      message: `${peran} tidak boleh Kantor — kantor tidak menyimpan stok`,
    });
  }
  return b;
}

/** Status agregat satu faktur transfer dari status baris-barisnya. */
function statusFaktur(items: { status: KonfirmasiStatus }[]): KonfirmasiStatus | "sebagian" {
  const set = new Set(items.map((i) => i.status));
  if (set.size === 1) return [...set][0];
  if (set.has("dikonfirmasi") && set.has("ditolak") && !set.has("menunggu")) return "sebagian";
  return "menunggu";
}

/**
 * TRANSFER STOK antar lokasi (CK↔cabang, cabang↔cabang) untuk stok yang SUDAH
 * ADA (ready) — mis. mengirim ulang barang yang rusak di jalan. Satu faktur
 * (nomor TF-) memuat BANYAK bahan baku.
 *
 * Representasi: satu baris `productions` per bahan dengan pola KIRIMAN yang
 * sudah dipakai jalur "kirim hasil"/"kirim dari stok CK" —
 *   branch_id      = cabang TUJUAN  → menambah saldo tujuan saat dikonfirmasi
 *   asal_branch_id = cabang ASAL    → mengurangi saldo asal saat dikonfirmasi
 *   tujuan_branch_id = TUJUAN       → muncul di Penerimaan cabang tujuan
 *   dari_branch_id = ASAL           → faktur tetap terlihat dari cabang asal
 *   status 'menunggu', total_harga 0 (pemindahan stok, bukan biaya baru)
 * Dengan begitu perhitungan saldo (hitungSaldoCabang), Kartu Stok, Penerimaan,
 * dan Tempat Sampah otomatis konsisten tanpa logika saldo baru.
 *
 * BERDAMPINGAN dengan "Kirim dari stok CK" pada Permintaan Stok: yang itu lahir
 * dari rencana menu (rencana_id terisi, nomor PR-), yang ini manual/ad-hoc
 * (rencana_id null, nomor TF-).
 */
export const transferRoutes = new Hono<AppEnv>()
  /** Stok READY di satu cabang (dasar pemilih bahan + validasi qty di form). */
  .get("/saldo", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const saldo = await hitungSaldoCabang(auth.company_id!, branchId);
    const ids = saldo.filter((r) => r.saldo > 0).map((r) => r.ingredient_id);
    if (ids.length === 0) return c.json({ branch_id: branchId, rows: [] });
    const master = await db
      .select({
        id: ingredients.id,
        pengadaan: ingredients.pengadaan,
        trackStok: ingredients.trackStok,
        isActive: ingredients.isActive,
        // dasar aturan kemasan di form kirim (lihat wajib_kelipatan)
        isi: ingredients.isi,
        satuanBeli: ingredients.satuanBeli,
        bolehEceran: ingredients.bolehEceran,
      })
      .from(ingredients)
      .where(and(eq(ingredients.companyId, auth.company_id!), inArray(ingredients.id, ids)));
    const infoById = new Map(master.map((m) => [m.id, m]));
    // barang yang sudah dijanjikan keluar tapi belum diterima tujuan tidak
    // boleh ditransfer lagi → sisanya yang benar-benar bisa dikirim
    const jalan = await qtyDalamJalan(db, auth.company_id!, branchId, ids);
    const rows: TransferStokSaldoRow[] = saldo
      .filter((r) => {
        const m = infoById.get(r.ingredient_id);
        if (!m?.trackStok || !m?.isActive) return false;
        return r.saldo - (jalan.get(r.ingredient_id) ?? 0) > 0;
      })
      .map((r) => {
        const m = infoById.get(r.ingredient_id)!;
        const dalamJalan = jalan.get(r.ingredient_id) ?? 0;
        // Teks ditulis SERVER, bukan klien: mobile (Flutter) tak bisa memakai
        // qtyTeks() dari paket shared, dan menebak sendiri sudah pernah
        // melahirkan "900 kg" untuk bahan yang sebenarnya 900 gr.
        const t = qtyTeks({
          qty: r.saldo - dalamJalan,
          satuan: r.satuan,
          isi: m.isi,
          satuanBeli: m.satuanBeli,
        });
        return {
          ingredient_id: r.ingredient_id,
          nama: r.nama,
          satuan: r.satuan,
          pengadaan: m.pengadaan,
          saldo: r.saldo,
          dalam_jalan: dalamJalan,
          isi: m.isi,
          satuan_beli: m.satuanBeli,
          // predikat yang sama dengan yang ditegakkan POST /transfer-stok,
          // supaya form tak pernah menjanjikan sesuatu yang server tolak
          wajib_kelipatan: wajibKelipatanKirim(m.pengadaan, m.isi, m.bolehEceran),
          tersedia_teks: t.teks,
          tersedia_setara: t.setara,
        };
      });
    return c.json({ branch_id: branchId, rows });
  })
  /** Daftar faktur transfer (terbaru dulu) — dikelompokkan per faktur. */
  .get("/", async (c) => {
    const auth = c.get("auth");
    // `page` sengaja tak dipakai: pintu ini menerima `per_page` tapi TIDAK
    // berhalaman — ia daftar ber-langit-langit. Karena itu yang benar di sini
    // penanda pemotongan (idiom putaran 23), bukan nomor halaman.
    const { perPage } = halamanQuery(c, { bawaan: 50, maks: 200 });
    // Peran terkunci cabang hanya melihat transfer yang menyangkut cabangnya
    // (sebagai pengirim ATAU penerima); manajemen melihat semuanya.
    const kunci =
      terikatCabang(auth.role) && auth.branch_id
        ? [
            sql`(${productions.asalBranchId} = ${auth.branch_id} OR ${productions.branchId} = ${auth.branch_id})`,
          ]
        : [];
    const kondisi = and(
      eq(productions.companyId, auth.company_id!),
      isNull(productions.deletedAt),
      ...kunci,
    );
    // Ambil dulu ID faktur terbaru sebanyak perPage, baru tarik barisnya —
    // tanpa ini seluruh riwayat transfer perusahaan ikut terbaca tiap request.
    const fakturTerbaru = await db
      .select({ faktur_id: productions.fakturId })
      .from(productions)
      .innerJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, productions.companyId),
          eq(dokumenNomor.refId, productions.fakturId),
          eq(dokumenNomor.jenis, "transfer"),
        ),
      )
      .where(kondisi)
      .groupBy(productions.fakturId)
      .orderBy(desc(sql`MAX(${productions.waktu})`), productions.fakturId)
      // `+ 1`: pembeda "tepat sejumlah batas" dari "lebih dari batas".
      .limit(perPage + 1);
    const terpotong = fakturTerbaru.length > perPage;
    const fakturIds = (terpotong ? fakturTerbaru.slice(0, perPage) : fakturTerbaru)
      .map((f) => f.faktur_id)
      .filter((id): id is string => !!id);
    if (fakturIds.length === 0) return c.json({ rows: [], rows_terpotong: false });
    const rows = await db
      .select({
        id: productions.id,
        faktur_id: productions.fakturId,
        nomor: dokumenNomor.nomorTeks,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
        ingredient_id: productions.ingredientId,
        nama: ingredients.nama,
        satuan: ingredients.satuan,
        // hanya untuk menulis teks setara kemasan — qty TETAP dalam `satuan`
        isi: ingredients.isi,
        satuan_beli: ingredients.satuanBeli,
        pengadaan: ingredients.pengadaan,
        qty: productions.qty,
        status: productions.status,
        alasan_tolak: productions.alasanTolak,
        catatan: productions.catatan,
        asal_branch_id: productions.asalBranchId,
        asal_cabang: cabangAsal.nama,
        tujuan_branch_id: productions.tujuanBranchId,
        tujuan_cabang: cabangTujuan.nama,
        dibuat_oleh: pembuat.nama,
      })
      .from(productions)
      // hanya faktur bernomor TRANSFER — pembeda tegas dari kiriman jalur lain
      .innerJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, productions.companyId),
          eq(dokumenNomor.refId, productions.fakturId),
          eq(dokumenNomor.jenis, "transfer"),
        ),
      )
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .leftJoin(cabangAsal, eq(productions.asalBranchId, cabangAsal.id))
      .leftJoin(cabangTujuan, eq(productions.tujuanBranchId, cabangTujuan.id))
      .leftJoin(pembuat, eq(productions.userId, pembuat.id))
      .where(and(kondisi, inArray(productions.fakturId, fakturIds)))
      .orderBy(desc(productions.waktu), asc(productions.id));

    const byFaktur = new Map<string, TransferStokFaktur>();
    for (const r of rows) {
      const key = r.faktur_id ?? r.id;
      let f = byFaktur.get(key);
      if (!f) {
        f = {
          faktur_id: key,
          nomor: r.nomor,
          waktu: r.waktu instanceof Date ? r.waktu.toISOString() : String(r.waktu),
          prod_date: r.prod_date,
          asal_branch_id: r.asal_branch_id,
          asal_cabang: r.asal_cabang,
          tujuan_branch_id: r.tujuan_branch_id,
          tujuan_cabang: r.tujuan_cabang,
          catatan: r.catatan,
          dibuat_oleh: r.dibuat_oleh,
          status: "menunggu",
          items: [],
        };
        byFaktur.set(key, f);
      }
      const t = qtyTeks({
        qty: r.qty,
        satuan: r.satuan,
        isi: r.isi,
        satuanBeli: r.satuan_beli,
      });
      const item: TransferStokItemRow = {
        id: r.id,
        ingredient_id: r.ingredient_id,
        nama: r.nama,
        satuan: r.satuan,
        pengadaan: r.pengadaan,
        qty: r.qty,
        qty_teks: t.teks,
        qty_setara: t.setara,
        status: r.status,
        alasan_tolak: r.alasan_tolak,
      };
      f.items.push(item);
    }
    const daftar = [...byFaktur.values()];
    for (const f of daftar) f.status = statusFaktur(f.items);
    return c.json({ rows: daftar, rows_terpotong: terpotong });
  })
  /** Buat faktur transfer + langsung KIRIM (menunggu diterima di tujuan). */
  .post("/", zValidator("json", TransferBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    /*
     * KLAIM ATOMIK sebelum apa pun ditulis — bukan sekadar "periksa dulu".
     * Cabang belum di-resolve di sini dan itu disengaja: yang dijaga adalah
     * SELURUH badan handler, termasuk pemeriksaan yang bisa melempar.
     */
    const { data } = await denganKlaimIdempoten(
      {
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "transfer_stok",
      },
      async () => {
        if (body.asal_branch_id === body.tujuan_branch_id) {
          throw new HTTPException(400, { message: "Cabang asal dan tujuan tidak boleh sama" });
        }
        // Peran terkunci cabang hanya boleh mengirim DARI cabangnya sendiri.
        if (terikatCabang(auth.role) && auth.branch_id !== body.asal_branch_id) {
          throw new HTTPException(403, {
            message: "Hanya boleh transfer dari cabang Anda sendiri",
          });
        }
        const asal = await pastikanCabangStok(auth.company_id!, body.asal_branch_id, "Asal");
        const tujuan = await pastikanCabangStok(auth.company_id!, body.tujuan_branch_id, "Tujuan");
        // PENGIRIM HANYA CENTRAL KITCHEN. Cabang (termasuk divisi kitchen/bar) cuma
        // MELIHAT kiriman yang menuju ke sana — arah stok satu pintu supaya asal
        // barang selalu bisa ditelusuri ke CK. Dicek pada ASAL, bukan pada peran,
        // agar owner/admin pun tak bisa mengirim antar-toko lewat jalur ini.
        if (asal.tipe !== "central_kitchen") {
          throw new HTTPException(403, {
            message: `Transfer stok hanya bisa dikirim DARI Central Kitchen — "${asal.nama}" bukan Central Kitchen`,
          });
        }

        // Gabungkan baris bahan yang sama (qty dijumlah) → satu baris per bahan.
        const qtyByIng = new Map<string, number>();
        for (const it of body.items) {
          qtyByIng.set(it.ingredient_id, (qtyByIng.get(it.ingredient_id) ?? 0) + it.qty);
        }
        const ingIds = [...qtyByIng.keys()];
        const bahan = await db
          .select({
            id: ingredients.id,
            nama: ingredients.nama,
            satuan: ingredients.satuan,
            trackStok: ingredients.trackStok,
            // aturan kemasan: barang yang hanya bisa DIBELI per kemasan juga
            // hanya boleh DIKIRIM per kemasan (lihat cekKirimKemasan di bawah)
            isi: ingredients.isi,
            satuanBeli: ingredients.satuanBeli,
            pengadaan: ingredients.pengadaan,
            bolehEceran: ingredients.bolehEceran,
          })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.companyId, auth.company_id!),
              eq(ingredients.isActive, true),
              inArray(ingredients.id, ingIds),
            ),
          );
        if (bahan.length !== ingIds.length) {
          throw new HTTPException(400, { message: "Ada bahan yang tidak valid atau tidak aktif" });
        }
        const takLacak = bahan.find((b) => !b.trackStok);
        if (takLacak) {
          throw new HTTPException(400, {
            message: `"${takLacak.nama}" tidak melacak stok — tidak bisa ditransfer`,
          });
        }

        const [company] = await db
          .select({ timezone: companies.timezone })
          .from(companies)
          .where(eq(companies.id, auth.company_id!));
        const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");
        const fakturId = randomUUID();

        const hasil = await db.transaction(async (tx) => {
          // Saldo diturunkan dari ledger (tak ada baris stok yang bisa dikunci),
          // jadi transfer dari SATU cabang asal diserialkan lewat advisory lock:
          // pemeriksaan "cukup atau tidak" di bawah baru berjalan setelah transfer
          // lain dari cabang yang sama selesai commit.
          await kunciKirimCabang(tx, auth.company_id!, asal.id);
          // `tx`, bukan `db` — alasannya sama dengan jalur kiriman CK:
          // menyewa koneksi kedua di dalam transaksi, dan `saldo` di sini vs
          // `jalan` di bawah jadi dua snapshot. Lihat `test/koneksi-bersarang.test.ts`.
          const saldoAsal = new Map(
            (await hitungSaldoCabang(auth.company_id!, asal.id, tx)).map((r) => [
              r.ingredient_id,
              r,
            ]),
          );
          // saldo mentah masih memuat barang yang sedang di jalan → potong dulu
          const jalan = await qtyDalamJalan(tx, auth.company_id!, asal.id, ingIds);
          for (const [ingId, qty] of qtyByIng) {
            const s = saldoAsal.get(ingId);
            const b = bahan.find((x) => x.id === ingId);
            const nama = b?.nama ?? "bahan";
            const diJalan = jalan.get(ingId) ?? 0;
            const tersedia = (s?.saldo ?? 0) - diJalan;
            if (!s || qty > tersedia + 1e-9) {
              const catatanJalan =
                diJalan > 0 ? `, ${diJalan} masih dalam perjalanan ke cabang lain` : "";
              throw new HTTPException(400, {
                message: `Stok ${asal.nama} tidak cukup untuk ${nama} (tersedia ${Math.max(0, tersedia)} ${s?.satuan ?? ""}${catatanJalan}) — kurangi jumlah transfer`,
              });
            }
            // Kelipatan kemasan diperiksa SETELAH kecukupan stok: "stok kurang"
            // masalah yang lebih mendasar dan pesannya lebih berguna duluan.
            if (b) wajibKelipatanKemasan(b, qty, Math.max(0, tersedia));
          }
          await tx.insert(productions).values(
            [...qtyByIng.entries()].map(([ingredientId, qty]) => ({
              companyId: auth.company_id!,
              // tujuan = pemilik baris (stok masuk saat diterima)
              branchId: tujuan.id,
              asalBranchId: asal.id,
              dariBranchId: asal.id,
              tujuanBranchId: tujuan.id,
              ingredientId,
              qty,
              tipe: "produksi" as const,
              totalHarga: 0, // pemindahan stok yang sudah ada — tanpa biaya baru
              fakturId,
              rencanaId: null,
              noFaktur: null,
              supplierId: null,
              // rak simpan diisi otomatis (rak default bahan) saat diterima
              storageLocationId: null,
              status: "menunggu" as const,
              /**
               * PENANDA KEBERANGKATAN — barangnya sudah tak di rak asal.
               *
               * Di jalur ini membuat transfer BERARTI mengirimkannya: tak ada
               * langkah "kirim" terpisah, tujuannya langsung melihatnya di
               * Penerimaan Barang, dan pemeriksaan kecukupan stok beberapa
               * baris di atas sudah memotong `qtyDalamJalan` dari stok asal.
               * Jadi detik baris ini lahir, barangnya sudah berangkat.
               *
               * Tanpa stempel ini DUA hal rusak sekaligus, dan keduanya
               * terukur — bukan dugaan:
               *
               *   1. LAYAR OPNAME CK. `qtyDiJalan` (yang memotong barang di
               *      jalan dari stok buku, supaya hitungan petugas cocok)
               *      mensyaratkan `dikirim_at IS NOT NULL`. Kiriman lewat
               *      jalur ini karena itu tak terlihat sedang di jalan: 40 pcs
               *      benar-benar berangkat, `qtyDiJalan` melaporkan 0. Petugas
               *      menghitung 60, sistem menuliskan 100, dan selisih 40 itu
               *      muncul sebagai KEHILANGAN yang harus di-ACC owner —
               *      catatan yang menuduh orang tanpa ada yang hilang.
               *
               *   2. SALDO CK. `kirim_keluar` menyaring
               *      `COALESCE(dikirim_at, waktu) > baseline_opname`. Dengan
               *      `dikirim_at` kosong ia jatuh ke `waktu` — yang DITIMPA
               *      waktu penerimaan saat baris dikonfirmasi. Kiriman yang
               *      berangkat SEBELUM opname karena itu tetap terhitung
               *      keluar SESUDAHNYA, padahal opname fisik sudah tak
               *      memuatnya. Barang yang sama dipotong dua kali.
               *
               * Terukur: CK 100 pcs → kirim 40 → opname fisik 60 → tujuan
               * menerima → saldo CK jatuh ke 20, bukan 60.
               *
               * Jalur work-order (`produksi/routes.ts`, "kirim ke cabang")
               * sudah menstempel ini sejak awal dengan alasan yang sama
               * persis. Ada DUA pintu menuju "barang sudah berangkat", dan
               * hanya satu yang menutup pintunya.
               */
              dikirimAt: new Date(),
              isBatch: false,
              catatan: body.catatan?.trim() || null,
              userId: auth.sub,
              workerId: null,
              prodDate,
            })),
          );
          const nomor = await terbitkanNomor(tx, auth.company_id!, "transfer", fakturId);
          const ringkas = [...qtyByIng.entries()]
            .map(([id, q]) => `${bahan.find((b) => b.id === id)?.nama ?? "?"} ${q}`)
            .join(", ");
          await catatLogFaktur(tx, {
            companyId: auth.company_id!,
            branchId: asal.id,
            fakturId,
            jalur: "produksi",
            aksi: "Transfer stok",
            detail: `${asal.nama} → ${tujuan.nama} · ${ringkas}`,
            userId: auth.sub,
          });
          return { nomor };
        });

        const keluaran = {
          ok: true,
          faktur_id: fakturId,
          nomor: hasil.nomor,
          asal: asal.nama,
          tujuan: tujuan.nama,
          jumlah_baris: ingIds.length,
        };
        return keluaran;
      },
    );
    return c.json(data, 201);
  })
  /**
   * BATALKAN transfer yang belum diterima (salah kirim) → baris masuk Tempat
   * Sampah. Hanya boleh oleh pihak PENGIRIM (atau manajemen), dan hanya selagi
   * semua barisnya masih 'menunggu' — yang sudah diterima/ditolak tak diusik.
   */
  .post("/:fakturId/batal", async (c) => {
    const auth = c.get("auth");
    const fakturId = c.req.param("fakturId");
    if (!/^[0-9a-f-]{36}$/i.test(fakturId)) {
      throw new HTTPException(404, { message: "Transfer tidak ditemukan" });
    }
    const baris = await db
      .select({
        id: productions.id,
        status: productions.status,
        asalBranchId: productions.asalBranchId,
      })
      .from(productions)
      .innerJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, productions.companyId),
          eq(dokumenNomor.refId, productions.fakturId),
          eq(dokumenNomor.jenis, "transfer"),
        ),
      )
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          eq(productions.fakturId, fakturId),
          isNull(productions.deletedAt),
        ),
      );
    if (baris.length === 0) throw new HTTPException(404, { message: "Transfer tidak ditemukan" });
    if (terikatCabang(auth.role) && auth.branch_id !== baris[0].asalBranchId) {
      throw new HTTPException(403, { message: "Hanya pengirim yang boleh membatalkan transfer" });
    }
    if (baris.some((b) => b.status !== "menunggu")) {
      throw new HTTPException(409, {
        message: "Transfer sudah diproses di cabang tujuan — tidak bisa dibatalkan",
      });
    }
    const now = new Date();
    /*
     * SEMUA BARIS ATAU TIDAK SAMA SEKALI.
     *
     * Pemeriksaan `some(status !== 'menunggu')` di atas dan UPDATE di bawah ini
     * adalah dua pernyataan terpisah. Bila cabang tujuan menerima SEBAGIAN
     * barisnya tepat di selanya, UPDATE-nya hanya mencocokkan sisanya —
     * `hapus.length > 0`, jadi dulu pembatalannya dilaporkan `ok` padahal yang
     * terjadi pembatalan SEBAGIAN: sebagian stok kembali ke asal, sebagian
     * sudah mendarat di tujuan, dan pengirim mengira transfernya batal utuh.
     *
     * Menuntut jumlahnya SAMA lalu melempar dari DALAM transaksi membuatnya
     * dibatalkan seluruhnya — idiom yang sama dengan `terima-sebagian` di modul
     * penerimaan, yang menghadapi persoalan identik dan menyelesaikannya begini.
     */
    const hapus = await db.transaction(async (tx) => {
      const res = await tx
        .update(productions)
        .set({ deletedAt: now, deletedBy: auth.sub })
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.fakturId, fakturId),
            eq(productions.status, "menunggu"),
            isNull(productions.deletedAt),
          ),
        )
        .returning({ id: productions.id });
      if (res.length !== baris.length) {
        throw new HTTPException(409, {
          message: "Transfer sudah berubah — muat ulang lalu coba lagi",
        });
      }
      return res;
    });
    return c.json({ ok: true, jumlah_baris: hapus.length });
  });
