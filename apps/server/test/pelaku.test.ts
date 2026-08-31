import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buktiPelakuPemanggil,
  KOLOM_ANGKA,
  situsPelaku,
  situsTanpaPelaku,
  tabelBerPelaku,
} from "./util/pelaku";
import { SRV } from "./util/rute";
import { grafPanggilan, PELAKU } from "./util/panggilan";

/**
 * SIAPA YANG MELAKUKANNYA — ruas ketiga, sesudah `companyId` dan `branchId`.
 *
 * Dua ruas sudah dijaga: tenant (putaran 13 & 14) dan cabang (putaran 16).
 * Yang ketiga menopang seluruh jejak audit aplikasi ini — `pesananLogs`,
 * `fakturLogs`, `stockOpnames.disetujuiBy`, `shifts.openedBy`,
 * `productions.updatedBy` — dan tak satu pun uji pernah menagihnya.
 *
 * HASIL SAPUAN, dengan angkanya:
 *
 *   tabel ber-kolom pelaku              24 dari 59
 *   penulisan kolom pelaku              96
 *     · TOKEN      56  `auth.sub` langsung
 *     · PARAMETER  20  diputuskan pemanggil — 13 dari 14 pembantunya DIBUKTIKAN
 *     · E          14  berkas lintas perusahaan (seed, auth, onboarding)
 *     · NULL        3  sengaja tanpa pelaku, terdaftar
 *     · TURUNAN     2  diwarisi dari kolom yang SAMA pada baris induk
 *     · KLIEN       1  ← terdaftar beralasan, dan alasannya dipaku ke kodenya
 *
 * Arah kedua — pintu yang MENGUBAH tanpa menyegarkan pelakunya: **9 → 5**,
 * dan yang menyentuh ANGKA **2 → 0**.
 */

/**
 * Pelaku yang memang datang dari PERMINTAAN, beserta alasannya.
 *
 * Satu-satunya entri, dan ia sah karena dua hal yang bisa diperiksa: yang
 * memilih owner/admin (penugasan petugas adalah pengaturan, bukan perbuatan),
 * dan tiap id yang dikirim DIVALIDASI sebagai anggota aktif perusahaan.
 */
const PELAKU_DIPILIH = new Map<string, string>([
  [
    "modules/penyimpanan/routes.ts:storageLocationPetugas.userId",
    "PUT /penyimpanan/:id/bahan menugaskan PETUGAS rak — daftar orangnya memang dipilih manajemen; tiap id divalidasi `memberships` seperusahaan & belum diarsip, dan jumlahnya wajib cocok (400 bila tidak)",
  ],
]);

/** Pembantu pembawa pelaku yang BELUM bisa dibuktikan mekanis, beralasan. */
const BELUM_TERBUKTI = new Map<string, string>([
  [
    "catatAbsen",
    "absensi KIOS: pelakunya BUKAN pemegang token melainkan karyawan yang kode-nya diketik di perangkat bersama. `m.userId` lahir dari pencarian `memberships` ber-`auth.company_id` + belum diarsip, jadi ia terkurung — tapi ia memang bukan `auth.sub`, dan graf tak boleh dipaksa mengatakan sebaliknya",
  ],
]);

/**
 * Pintu yang mengubah baris tanpa menyegarkan `updatedBy`, beserta alasannya.
 *
 * Dikunci per BERKAS + kolom yang diubahnya, bukan per NOMOR BARIS. Versi
 * pertama memakai nomor baris dan langsung membusuk: menambahkan satu komentar
 * di atas situsnya sudah cukup membuat entri yang benar tampak asing. Kunci
 * yang menyebut APA yang diubah bertahan terhadap pergeseran baris dan tetap
 * menunjuk situs yang sama.
 */
const TAK_MENYEGARKAN = new Map<string, string>([
  [
    "modules/penerimaan/routes.ts confirmedAt,confirmedBy,status,waktu",
    "hanya memindahkan STATUS ke 'dikonfirmasi'; pelakunya tercatat di `confirmedBy` yang ditulis pernyataan yang sama",
  ],
  [
    "modules/penerimaan/routes.ts alasanTolak,confirmedAt,confirmedBy,status,waktu",
    "hanya status + `alasanTolak`; pelakunya `confirmedBy`",
  ],
  [
    "modules/produksi/routes.ts confirmedAt,confirmedBy,status,waktu",
    "hanya status; pelakunya `confirmedBy` (dua situs: jalur produksi & jalur beli)",
  ],
  [
    "modules/penyimpanan/autoFile.ts storageLocationId",
    "pengarsipan rak OTOMATIS saat barang tiba — tak ada manusia yang bisa disebut, dan menyebut penerima sebagai 'pengubah' justru menambah fakta yang salah",
  ],
]);

describe("pelaku: dari token, bukan dari permintaan", () => {
  const semua = situsPelaku();
  const per = (k: string) => semua.filter((x) => x.kelas === k);

  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(tabelBerPelaku().size, "skema tak terbaca").toBeGreaterThanOrEqual(20);
    expect(semua.length, "tak ada penulisan pelaku terbaca").toBeGreaterThan(80);
    expect(per("TOKEN").length, "kelas TOKEN kosong — pemindainya rusak").toBeGreaterThan(40);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThan(15);
  });

  it("INTI: pelaku dari PERMINTAAN hanya yang sudah diadjudikasi", () => {
    const asing = per("KLIEN")
      .map((x) => `${x.berkas}:${x.tabel}.${x.kolom}`)
      .filter((k) => !PELAKU_DIPILIH.has(k));
    expect(
      asing,
      `pelaku dipungut dari permintaan — seseorang menandatangani perbuatannya atas nama orang lain:\n${asing.join("\n")}`,
    ).toEqual([]);
  });

  it("daftar adjudikasi tak menyimpan entri usang", () => {
    const ada = new Set(per("KLIEN").map((x) => `${x.berkas}:${x.tabel}.${x.kolom}`));
    expect([...PELAKU_DIPILIH.keys()].filter((k) => !ada.has(k))).toEqual([]);
  });

  it("penugasan petugas rak MEMANG memvalidasi keanggotaannya", () => {
    // Alasan di `PELAKU_DIPILIH` dipaku ke kodenya: kalau validasinya hilang,
    // entri itu berhenti benar dan uji ini merah — bukan alasannya yang basi
    // diam-diam.
    const P = readFileSync(join(SRV, "modules/penyimpanan/routes.ts"), "utf8");
    expect(P).toContain("eq(memberships.companyId, auth.company_id!)");
    expect(P).toContain("isNull(memberships.archivedAt)");
    expect(P).toContain("members.length !== uniqueIds.length");
  });

  it("pelaku lewat PEMANGGIL: DIBUKTIKAN grafnya, bukan dijanjikan daftarnya", () => {
    const b = buktiPelakuPemanggil(semua);
    expect(b.pembantu.length, "tak ada pembantu pembawa pelaku terbaca").toBeGreaterThanOrEqual(10);
    const takTerdaftar = [...b.belum.keys()].filter((n) => !BELUM_TERBUKTI.has(n));
    expect(
      takTerdaftar,
      `pembantu membawa pelaku lewat parameter, dan pemanggilnya tak bisa dibuktikan:\n${takTerdaftar.join("\n")}`,
    ).toEqual([]);
    for (const k of BELUM_TERBUKTI.keys()) {
      expect(b.belum.has(k), `entri daftar sudah terbukti — hapus: ${k}`).toBe(true);
    }
  });

  it("PREMIS: grafnya benar-benar dibangun pada dimensi PELAKU", () => {
    // Kalau dimensinya tertukar ke tenant, seluruh angka di atas bicara tentang
    // `companyId` sambil MENGAKU bicara tentang `userId`.
    const g = grafPanggilan(undefined, PELAKU);
    expect(g.dim.nama).toBe("pelaku");
    expect(g.dim.auth.test("auth.sub")).toBe(true);
    expect(g.dim.auth.test("auth.company_id!")).toBe(false);
    expect(g.jumlahBerkas).toBeGreaterThan(100);
  });
});

describe("perubahan yang MENYEGARKAN pelakunya", () => {
  const tanpa = situsTanpaPelaku();

  it("INTI: tak ada pintu yang mengubah ANGKA tanpa menyebut penulisnya", () => {
    /*
     * `updatedBy` dilihat manusia — `produksi/routes.ts` memulangkannya sebagai
     * `diubah_oleh`, dan layar Tambah Stok merendernya. Terukur sebelum
     * diperbaiki (2026-08-27): owner membuat faktur 10 pcs Rp50.000 lalu
     * menyuntingnya; pengguna KEDUA menaikkan tahap dengan qty 14 →
     * `total_harga` 70.000 dan `harga_tebakan` true — sementara `diubah_oleh`
     * MASIH menyebut owner. Layar memberi nama orang yang menulis 50.000
     * sebagai penulis 70.000.
     */
    const uang = tanpa
      .filter((x) => x.arah === "UBAH" && x.diubah.some((c) => KOLOM_ANGKA.includes(c)))
      .map((x) => `${x.berkas}:${x.baris} [${x.tabel}] ubah{${x.diubah.join(",")}}`);
    expect(
      uang,
      `pintu mengubah angka yang dilihat manusia tanpa menyegarkan \`updatedBy\`:\n${uang.join("\n")}`,
    ).toEqual([]);
  });

  it("sisanya terdaftar beralasan — dan daftarnya ditagih dua arah", () => {
    const kunci = (x: (typeof tanpa)[number]) => `${x.berkas} ${x.diubah.join(",")}`;
    const asing = tanpa.filter((x) => !TAK_MENYEGARKAN.has(kunci(x))).map(kunci);
    expect(asing, `belum diadjudikasi:\n${[...new Set(asing)].join("\n")}`).toEqual([]);
    const ada = new Set(tanpa.map(kunci));
    const usang = [...TAK_MENYEGARKAN.keys()].filter((k) => !ada.has(k));
    expect(usang, `entri sudah menyegarkan pelakunya — hapus: ${usang.join(", ")}`).toEqual([]);
  });

  it("penghapusan LUNAK selalu menyebut penghapusnya", () => {
    // Nol, dan nolnya berarti sesuatu: tiap `update` yang mengisi `deletedAt`
    // pada tabel ber-`deletedBy` mengisi keduanya.
    expect(tanpa.filter((x) => x.arah === "HAPUS").map((x) => `${x.berkas}:${x.baris}`)).toEqual([]);
  });
});

describe("BUKTI MERAH: gerbangnya benar-benar bisa menuduh", () => {
  const sapu = (isi: string) => situsPelaku([{ nama: "modules/palsu/routes.ts", isi }]);

  it("pelaku dari badan permintaan → KLIEN", () => {
    const k = sapu("await db.insert(pesananLogs).values({ userId: body.user_id, aksi: 'x' });");
    expect(k).toHaveLength(1);
    expect(k[0].kelas).toBe("KLIEN");
  });

  it("lewat satu nama, dan lewat callback `.map` → tetap KLIEN", () => {
    expect(
      sapu("async function h(c) { const body = c.req.valid('json'); const uid = body.user_id; await db.insert(pesananLogs).values({ userId: uid }); }")[0]?.kelas,
    ).toBe("KLIEN");
    expect(
      sapu("async function h(c) { const body = c.req.valid('json'); await db.insert(pesananLogs).values(body.ids.map((u) => ({ userId: u }))); }")[0]?.kelas,
    ).toBe("KLIEN");
  });

  it("PASANGAN: dari token → TOKEN, dan tabel tanpa kolom pelaku tak disapu", () => {
    const k = sapu("async function h(c) { const auth = c.get('auth'); await db.insert(pesananLogs).values({ userId: auth.sub }); }");
    expect(k[0]?.kelas).toBe("TOKEN");
    // `suppliers` tak punya kolom pelaku — bukan urusan sapuan ini.
    expect(sapu("await db.insert(suppliers).values({ nama: 'x' });")).toEqual([]);
  });

  it("update yang mengubah ANGKA tanpa `updatedBy` → tertuduh", () => {
    const t = situsTanpaPelaku([
      { nama: "modules/palsu/routes.ts", isi: "await db.update(productions).set({ totalHarga: 1, qty: 2 }).where(x);" },
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].arah).toBe("UBAH");
    expect(t[0].diubah).toContain("totalHarga");
  });

  it("PASANGAN: yang sama DENGAN `updatedBy` → bersih; dan sebar bersyarat tetap terbaca", () => {
    expect(
      situsTanpaPelaku([{ nama: "modules/palsu/routes.ts", isi: "await db.update(productions).set({ totalHarga: 1, updatedBy: auth.sub }).where(x);" }]),
    ).toEqual([]);
    // Bentuk yang memakan versi pertama pemindai: seluruh perubahan lewat SEBAR
    // bersyarat, jadi objeknya tak punya satu pun properti bernama.
    const t = situsTanpaPelaku([
      { nama: "modules/palsu/routes.ts", isi: "await db.update(productions).set({ ...(lebih ? { qty: 1, totalHarga: 2 } : {}) }).where(x);" },
    ]);
    expect(t[0]?.diubah, "sebar bersyarat tak terbaca — pintunya tak terlihat sama sekali").toContain(
      "totalHarga",
    );
  });

  it("hapus LUNAK tanpa `deletedBy` → tertuduh, dan bukan lewat kolom yang salah", () => {
    const t = situsTanpaPelaku([
      { nama: "modules/palsu/routes.ts", isi: "await db.update(sales).set({ deletedAt: now }).where(x);" },
    ]);
    expect(t[0]?.arah).toBe("HAPUS");
    // PASANGAN: pembaruan biasa pada `sales` TIDAK ditagih `deletedBy` —
    // `sales` tak punya `updatedBy`, jadi tak ada tempat mencatatnya. Versi
    // pertama menuduh `refund.ts` & `rekalkulasi.ts` di sini; itu salah alamat.
    expect(
      situsTanpaPelaku([{ nama: "modules/palsu/routes.ts", isi: "await db.update(sales).set({ total: 1 }).where(x);" }]),
    ).toEqual([]);
  });
});
