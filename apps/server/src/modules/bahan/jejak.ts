import { and, eq, inArray } from "drizzle-orm";
import { formatAngkaId, hargaPerUnit, qtySama } from "@kakarut/shared";
import { BATAS_UANG } from "../../lib/batas-angka";
import type { Db, Tx } from "../../db/client";
import { ingredientComponents, ingredientLogs, ingredients } from "../../db/schema";

/**
 * PENULIS TUNGGAL garis waktu bahan (`ingredient_logs`).
 *
 * Ada SEMBILAN situs di `modules/` yang menulis `ingredients.harga_beli` atau
 * `ingredients.isi` — enam update dan tiga insert, tersebar di dua berkas
 * (`bahan/routes.ts` ×8, `produksi/routes.ts` ×1). Menyalin logika pencatatan
 * ke sembilan tempat berarti yang kesepuluh lahir tanpa jejak, dan lubang itu
 * TAK BERGEJALA: layar riwayat tetap terbuka, tetap terisi, cuma satu jenis
 * kejadian tak pernah muncul di dalamnya. Karena itu ada satu pintu, dan
 * penjaga statis `jejak-harga-bahan.test.ts` menolak situs kesepuluh yang
 * tidak melewatinya.
 *
 * TAK BERGANTUNG URUTAN PANGGIL. Fungsi ini menghitung ulang biaya batch dari
 * basis data, tapi harga bahan yang SEDANG berubah diambil dari `ubah`, bukan
 * dari baris DB — jadi memanggilnya sebelum atau sesudah `UPDATE` menghasilkan
 * angka yang sama. Versi yang membaca harga baru dari DB akan bekerja
 * sempurna di lima situs dan diam-diam mencatat "Rp 0 → Rp 0" di situs
 * keenam, tergantung baris mana yang kebetulan ditulis lebih dulu.
 */
export type SebabJejakBahan = "buat" | "manual" | "impor" | "resep" | "laporan_harga";

export interface UbahHargaBahan {
  ingredientId: string;
  nama: string;
  /** satuan KERJA/resep — dipakai menulis takaran di kalimat jejak */
  satuan: string;
  /** null = baris baru; ia tak mungkin jadi komponen resep mana pun */
  hargaLama: number | null;
  hargaBaru: number;
  isiLama: number | null;
  isiBaru: number;
}

const rp = (n: number) => `Rp ${formatAngkaId(n, 0)}`;

/**
 * Kalimat satu perubahan, dan kenapa `isi` punya cabangnya sendiri.
 *
 * Yang dikonsumsi resep adalah harga PER SATUAN (`harga_beli ÷ isi`), jadi
 * mengubah `isi` saja sudah menggeser biaya batch tanpa `harga_beli` bergerak
 * seangka pun. Menulis "Rp 12.000 → Rp 12.000" untuk kejadian itu bukan cuma
 * tak informatif — ia terbaca seperti jejak yang salah dan membuat orang
 * berhenti mempercayai seluruh daftarnya.
 */
function kalimatUbah(u: UbahHargaBahan): string {
  const hargaGerak = u.hargaLama != null && u.hargaLama !== u.hargaBaru;
  const isiGerak = u.isiLama != null && u.isiLama !== u.isiBaru;
  if (hargaGerak && isiGerak) {
    return `${u.nama}: ${rp(u.hargaLama!)} → ${rp(u.hargaBaru)}, isi ${formatAngkaId(u.isiLama!)} → ${formatAngkaId(u.isiBaru)} ${u.satuan}`;
  }
  if (isiGerak) {
    return `${u.nama}: isi ${formatAngkaId(u.isiLama!)} → ${formatAngkaId(u.isiBaru)} ${u.satuan}`;
  }
  if (u.hargaLama == null) return `${u.nama}: ${rp(u.hargaBaru)}`;
  return `${u.nama}: ${rp(u.hargaLama)} → ${rp(u.hargaBaru)}`;
}

/** Benar-benar bergerak? Simpan tiap kali form disimpan tak boleh jadi jejak. */
function bergerak(u: UbahHargaBahan): boolean {
  if (u.hargaLama == null) return true;
  return u.hargaLama !== u.hargaBaru || u.isiLama !== u.isiBaru;
}

/**
 * Catat perubahan harga/isi bahan — DAN sebarkan akibatnya ke resep pemakainya.
 *
 * Penyebarannya inti seluruh fitur: pemilik bertanya "kenapa harga resep
 * berubah padahal saya tak menyentuh resepnya", dan jawabannya hampir selalu
 * "satu bahan penyusunnya berubah harga". Tanpa baris `harga_bahan` di garis
 * waktu RESEP, jawaban itu cuma bisa dirakit dengan membandingkan dua layar.
 *
 * SATU TINGKAT, sesuai keputusan pemilik: bila bahan yang berubah dipakai
 * resep A, hanya A yang menerima baris. Bila A sendiri dipakai resep B,
 * B baru menerima baris saat harga TERSIMPAN A ikut ditulis — sebab hanya
 * itulah yang menggerakkan biaya B. Biaya batch A yang bergerak tanpa harga
 * tersimpannya ditulis ulang memang TIDAK mengubah apa pun di B: B memakai
 * `A.harga_beli`, bukan biaya resep A.
 *
 * Dua kueri, berapa pun banyak bahan yang berubah — bukan dua per bahan.
 */
export async function catatHargaBahan(
  tx: Tx | Db,
  companyId: string,
  olehUserId: string | null,
  sebab: SebabJejakBahan,
  ubah: UbahHargaBahan[],
): Promise<void> {
  const nyata = ubah.filter(bergerak);
  if (nyata.length === 0) return;

  const baris: (typeof ingredientLogs.$inferInsert)[] = nyata.map((u) => ({
    companyId,
    ingredientId: u.ingredientId,
    jenis: u.hargaLama == null ? "buat" : "harga_sendiri",
    sebab,
    detail: kalimatUbah(u),
    hargaLama: u.hargaLama,
    hargaBaru: u.hargaBaru,
    olehUserId,
  }));

  // Bahan yang BARU dibuat belum bisa jadi komponen resep mana pun; menyertakan
  // idnya di `inArray` di bawah hanya memperbesar kueri tanpa pernah cocok.
  const lama = nyata.filter((u) => u.hargaLama != null);
  const petaUbah = new Map(lama.map((u) => [u.ingredientId, u]));
  if (petaUbah.size > 0) {
    /*
     * KEDUA kueri di bawah TERKURUNG PERUSAHAAN lewat join ke `ingredients`,
     * sekalipun idnya sudah datang dari pemanggil yang terkurung.
     *
     * `ingredient_components` tak punya kolom `company_id` sendiri — pemiliknya
     * dikenali lewat `ingredient_id`. Tanpa join ini pengurungannya bersandar
     * pada disiplin SEMBILAN pemanggil, dan yang kesepuluh cukup sekali
     * meneruskan id dari sumber yang tak dijaga untuk menuliskan baris riwayat
     * ke garis waktu perusahaan lain. Biayanya satu join atas indeks kunci
     * utama; yang dibelinya adalah pengurungan yang bisa dibaca di sini, bukan
     * disimpulkan dari tempat lain.
     */
    const pemakai = await tx
      .select({ resepId: ingredientComponents.ingredientId })
      .from(ingredientComponents)
      .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.ingredientId))
      .where(
        and(
          eq(ingredients.companyId, companyId),
          inArray(ingredientComponents.inputIngredientId, [...petaUbah.keys()]),
        ),
      );
    const resepIds = [...new Set(pemakai.map((p) => p.resepId))];
    if (resepIds.length > 0) {
      const komponen = await tx
        .select({
          resepId: ingredientComponents.ingredientId,
          inputId: ingredientComponents.inputIngredientId,
          qty: ingredientComponents.qty,
          nama: ingredients.nama,
          satuan: ingredients.satuan,
          hargaBeli: ingredients.hargaBeli,
          isi: ingredients.isi,
        })
        .from(ingredientComponents)
        .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.inputIngredientId))
        .where(
          and(
            eq(ingredients.companyId, companyId),
            inArray(ingredientComponents.ingredientId, resepIds),
          ),
        );
      baris.push(...barisResepTerdampak(companyId, olehUserId, sebab, petaUbah, komponen));
    }
  }
  await tx.insert(ingredientLogs).values(baris);
}

interface BarisKomponen {
  resepId: string;
  inputId: string;
  qty: number;
  nama: string;
  satuan: string;
  hargaBeli: number;
  isi: number;
}

/**
 * Satu baris `harga_bahan` per resep pemakai, dengan biaya batch sebelum &
 * sesudah.
 *
 * `biayaBaru` dijumlah dari SELURUH komponen resep — bukan cuma yang berubah —
 * sebab angka yang dibaca orang di layar Resep adalah total batch, dan
 * riwayat yang menyebut angka berbeda dari layarnya sendiri lebih buruk
 * daripada tak ada riwayat. `biayaLama` diturunkan dengan mengembalikan
 * selisih komponen yang berubah, bukan dengan kueri kedua ke masa lalu yang
 * tak tersimpan di mana pun.
 */
function barisResepTerdampak(
  companyId: string,
  olehUserId: string | null,
  sebab: SebabJejakBahan,
  petaUbah: Map<string, UbahHargaBahan>,
  komponen: BarisKomponen[],
): (typeof ingredientLogs.$inferInsert)[] {
  const perResep = new Map<string, BarisKomponen[]>();
  for (const k of komponen) {
    const list = perResep.get(k.resepId) ?? [];
    list.push(k);
    perResep.set(k.resepId, list);
  }
  const hasil: (typeof ingredientLogs.$inferInsert)[] = [];
  for (const [resepId, list] of perResep) {
    let biayaBaru = 0;
    let selisih = 0;
    const berubah: { u: UbahHargaBahan; qty: number; satuan: string }[] = [];
    for (const k of list) {
      const u = petaUbah.get(k.inputId);
      // Harga BARU diambil dari `ubah`, bukan dari `k` — lihat kepala berkas:
      // itulah yang membuat fungsi ini tak peduli dipanggil sebelum atau
      // sesudah UPDATE-nya berjalan.
      const perUnitBaru = u ? hargaPerUnit(u.hargaBaru, u.isiBaru) : hargaPerUnit(k.hargaBeli, k.isi);
      biayaBaru += k.qty * perUnitBaru;
      if (u) {
        selisih += k.qty * (perUnitBaru - hargaPerUnit(u.hargaLama!, u.isiLama!));
        berubah.push({ u, qty: k.qty, satuan: k.satuan });
      }
    }
    if (berubah.length === 0) continue;
    const bulat = (n: number) => Math.round(n * 100) / 100;
    hasil.push({
      companyId,
      ingredientId: resepId,
      jenis: "harga_bahan",
      sebab,
      detail: ringkasTerdampak(berubah),
      biayaLama: muatUang(bulat(biayaBaru - selisih)),
      biayaBaru: muatUang(bulat(biayaBaru)),
      olehUserId,
    });
  }
  return hasil;
}

/**
 * Kalimat "bahan apa yang menggeser biaya resep ini".
 *
 * Dipangkas di tiga: satu nota belanja bisa menyegarkan harga acuan belasan
 * bahan sekaligus (`produksi/routes.ts` laporan harga), dan satu baris riwayat
 * sepanjang paragraf tak terbaca siapa pun. Takaran per batch ikut ditulis
 * karena itu yang menerangkan KENAPA bahan yang naik Rp 500 menggeser biaya
 * batch Rp 100 — atau Rp 10.000.
 */
function ringkasTerdampak(
  berubah: { u: UbahHargaBahan; qty: number; satuan: string }[],
): string {
  const teks = berubah
    .slice(0, 3)
    .map((b) => `${kalimatUbah(b.u)} (${formatAngkaId(b.qty)} ${b.satuan}/batch)`)
    .join(" · ");
  // Sisanya DIIRIS, bukan dihitung dari selisih dua panjang. Bentuk yang
  // mengurangkan panjang satu larik dari panjang larik lain ditagih rumahnya
  // oleh penjaga `konsep-satu-rumah` begitu ia muncul di berkas kedua — dan di
  // sini memang tak ada konsep yang perlu dibagi dengan siapa pun, cuma "yang
  // tak muat disebut jumlahnya". Mengirisnya menjawab keduanya sekaligus.
  const sisa = berubah.slice(3);
  return sisa.length > 0 ? `${teks} · +${sisa.length} bahan lain` : teks;
}

/**
 * Catat perubahan RESEP-nya sendiri: komponen, takaran batch, overhead.
 *
 * Terpisah dari `catatHargaBahan` karena sebabnya berbeda dan yang dibaca
 * orang juga berbeda — "siapa yang mengubah takaran" bukan pertanyaan yang
 * sama dengan "kenapa biayanya bergerak". Keduanya toh mendarat di satu garis
 * waktu, jadi layarnya tetap satu daftar.
 */
export async function catatResepBahan(
  tx: Tx | Db,
  row: {
    companyId: string;
    ingredientId: string;
    detail: string;
    biayaLama: number | null;
    biayaBaru: number | null;
    hargaLama: number | null;
    hargaBaru: number | null;
    olehUserId: string | null;
  },
): Promise<void> {
  // `companyId` ditulis EKSPLISIT, bukan ikut dalam `...row`: penjaga
  // `tenant-tulis` membaca objek nilainya, dan sebaran yang menyembunyikan
  // kolom penyewa membuat baris tanpa penyewa mustahil dibedakan dari baris
  // yang punya — oleh penjaganya maupun oleh pembaca berikutnya.
  await tx.insert(ingredientLogs).values({
    ...row,
    companyId: row.companyId,
    biayaLama: muatUang(row.biayaLama),
    biayaBaru: muatUang(row.biayaBaru),
    jenis: "resep",
    sebab: "resep",
  });
}

export interface KomponenJejak {
  inputId: string;
  nama: string;
  /** satuan KERJA bahan input — takaran resep selalu dalam satuan ini */
  satuan: string;
  qty: number;
}

/** Batas item yang disebut satu baris jejak sebelum sisanya diringkas. */
const BATAS_SEBUT = 5;

/**
 * Kalimat "apa yang berubah dari resep ini" — atau `null` bila TAK ADA yang
 * berubah.
 *
 * `null` bukan kerapian, ia syarat supaya daftarnya tetap terbaca. Layar Resep
 * menyimpan SELURUH formulir tiap kali tombol Simpan ditekan: mengganti satu
 * foto hasil mengirim komponen, takaran, dan overhead yang sama persis seperti
 * sebelumnya. Menulis "Resep diubah" untuk tiap simpan membuat riwayat setahun
 * berisi ratusan baris yang tak menerangkan apa-apa, dan perubahan takaran yang
 * sesungguhnya tenggelam di antaranya.
 *
 * Perbandingan `qty` memakai ambang 1e-9, bukan `!==`: takaran disimpan
 * `numeric(12,4)` dan dibaca kembali sebagai float, jadi 0,3 yang bolak-balik
 * lewat basis data bisa pulang sebagai 0,30000000000000004 — dan sama sekali
 * tak ada yang mengubahnya.
 */
export function kalimatResep(
  lama: KomponenJejak[],
  baru: KomponenJejak[],
  atur: { isiLama: number; isiBaru: number; overheadLama: number; overheadBaru: number },
): string | null {
  const petaLama = new Map(lama.map((k) => [k.inputId, k]));
  const petaBaru = new Map(baru.map((k) => [k.inputId, k]));
  const bagian: string[] = [];
  for (const b of baru) {
    const l = petaLama.get(b.inputId);
    if (!l) {
      bagian.push(`+ ${b.nama} ${formatAngkaId(b.qty, 4)} ${b.satuan}`);
    } else if (!qtySama(l.qty, b.qty)) {
      bagian.push(
        `${b.nama} ${formatAngkaId(l.qty, 4)} → ${formatAngkaId(b.qty, 4)} ${b.satuan}`,
      );
    }
  }
  for (const l of lama) {
    if (!petaBaru.has(l.inputId)) bagian.push(`− ${l.nama}`);
  }
  if (!qtySama(atur.isiLama, atur.isiBaru)) {
    bagian.push(`isi batch ${formatAngkaId(atur.isiLama)} → ${formatAngkaId(atur.isiBaru)}`);
  }
  if (!qtySama(atur.overheadLama, atur.overheadBaru)) {
    bagian.push(
      `overhead ×${formatAngkaId(atur.overheadLama, 4)} → ×${formatAngkaId(atur.overheadBaru, 4)}`,
    );
  }
  if (bagian.length === 0) return null;
  const tampil = bagian.slice(0, BATAS_SEBUT).join(" · ");
  const sisa = bagian.slice(BATAS_SEBUT);
  return sisa.length > 0 ? `${tampil} · +${sisa.length} perubahan lain` : tampil;
}

/** Biaya bahan per batch = Σ takaran × harga per satuan. Satu rumus, dua sisi. */
export function biayaBatch(
  komponen: { qty: number; hargaBeli: number; isi: number }[],
): number {
  const total = komponen.reduce((a, k) => a + k.qty * hargaPerUnit(k.hargaBeli, k.isi), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Angka yang TAK MUAT `numeric(14,2)` ditulis `null`, bukan diledakkan.
 *
 * `biayaBatch` bisa meluap secara aritmetika: takaran boleh sampai
 * `BATAS_QTY_RESEP` (≈10⁸) dan harga sampai `BATAS_UANG` (≈10¹²), jadi
 * hasilnya bisa 10²⁰ — jauh di atas kapasitas kolomnya. Resep sebesar itu tak
 * nyata, tapi yang harus diputuskan bukan kemungkinannya melainkan APA YANG
 * TERJADI kalau ia muncul.
 *
 * Melempar salah, dan salahnya bukan di jalur resep melainkan di PENYEBARAN:
 * satu laporan harga nota menyentuh belasan bahan, dan tiap bahan menyebar ke
 * resep pemakainya. Satu resep patologis akan menggagalkan seluruh nota — nota
 * yang isinya benar, ditolak karena baris CATATAN-nya tak muat. Jejak tak
 * boleh punya kuasa membatalkan peristiwa yang dicatatnya.
 *
 * Menjepit ke batas juga salah: ia menulis angka yang SALAH dan terbaca benar.
 * `null` mengatakan yang sebenarnya — "nilainya tak diberikan" — dan panel web
 * sudah merender medan kosong dengan melewatkannya, bukan dengan "Rp 0".
 */
function muatUang(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.abs(n) <= BATAS_UANG ? n : null;
}
