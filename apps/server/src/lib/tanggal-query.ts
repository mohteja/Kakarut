import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/**
 * TANGGAL DARI QUERY — satu rumah, dan cabang GAGALNYA punya pemilik.
 *
 * Terukur 2026-08-26 atas 36 pembacaan param tanggal di `c.req.query(...)`:
 * **29 memeriksa keabsahannya lalu GAGAL DIAM** (dilewati atau jatuh ke
 * bawaan), **5 tak memeriksa sama sekali**, dan hanya **2** yang menolak.
 * Aturannya ada, dipanggil, bahkan dikomentari — yang tak pernah ada: apa
 * yang terjadi kalau ia bilang "tidak sah".
 *
 * Dua kerusakan yang benar-benar terukur, keduanya lewat HTTP:
 *
 *   1. **500 pada tanggal yang MUNGKIN DIKETIK ORANG.** `tglValid` di
 *      `laporan/routes.ts` cuma memeriksa BENTUK (`/^\d{4}-\d{2}-\d{2}$/`),
 *      jadi `2026-02-30` lolos, masuk SQL, dan Postgres menolaknya:
 *      `GET /laporan?dari=2026-02-30` → **500 "Terjadi kesalahan pada
 *      server"**. Berlaku di SELURUH rute `/laporan/*`.
 *
 *   2. **Saringan dibuang diam-diam.** `pengajuan/routes.ts` memakai
 *      `if (dari && tanggalValid(dari))` — cabang gagalnya melewati
 *      saringannya. Terukur: `?dari=2026-08-01&sampai=2026-08-26` → **4**
 *      baris; `?dari=BUKAN&sampai=xxx` → **13** (seluruh tabel). Dan satu
 *      paruh yang ngawur membuang KEDUA saringannya:
 *      `?dari=2026-08-01&sampai=BUKAN` → 13 juga. Balasannya larik telanjang,
 *      jadi layar tetap memajang pilihan tanggal yang tak dipakai.
 *
 * Dan sebabnya satu: aturan "tanggal ini sah" punya DUA rumah yang tak
 * sepakat — `laporan:34` (regex saja) dan `pengajuan:29` (regex + tanggalnya
 * benar-benar ada). Yang kedua benar; berkas ini menjadikannya satu-satunya.
 *
 * KONTRAK:
 *   · param tak ada / kosong  → `undefined`; pemanggil memakai bawaannya
 *     (perilaku lama, tak berubah — "tanpa rentang" memang sah)
 *   · sah                     → nilainya
 *   · ADA tapi tak sah        → **400 yang MENYEBUT paramnya**
 *
 * Yang sengaja TIDAK dilakukan: menolak rentang terbalik (`dari > sampai`).
 * Ia memulangkan nol baris, dan nol baris adalah jawaban yang BENAR untuk
 * rentang kosong — bukan galat.
 */

/** Sah bila bentuknya `YYYY-MM-DD` DAN tanggalnya benar-benar ada. */
export function tanggalSah(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // Round-trip: `2026-02-30` diurai jadi 2 Maret, jadi teksnya tak kembali
  // sama. Inilah pemeriksaan yang hilang di `tglValid` versi regex-saja.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Sah bila bentuknya `YYYY-MM` dengan bulan 01–12. */
export function bulanSah(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function ambil(
  c: Context,
  nama: string,
  sah: (s: string) => boolean,
  bentuk: string,
): string | undefined {
  const v = c.req.query(nama);
  // Tak dikirim ATAU dikirim kosong = "tanpa rentang". Membedakan keduanya
  // akan membuat `?dari=` (bentuk yang dikirim form kosong) jadi 400.
  if (v === undefined || v === "") return undefined;
  if (!sah(v)) {
    throw new HTTPException(400, {
      message: `Tanggal pada "${nama}" tidak sah: "${v}" — pakai format ${bentuk}`,
    });
  }
  return v;
}

/** `?dari=`/`?sampai=`/`?tanggal=` → `YYYY-MM-DD`, atau 400 bernama. */
export function tanggalQuery(c: Context, nama: string): string | undefined {
  return ambil(c, nama, tanggalSah, "YYYY-MM-DD");
}

/** `?bulan=` → `YYYY-MM`, atau 400 bernama. */
export function bulanQuery(c: Context, nama: string): string | undefined {
  return ambil(c, nama, bulanSah, "YYYY-MM");
}

/**
 * Medan tanggal di BADAN permintaan — rumah yang sama.
 *
 * Permukaannya berbeda (Zod, bukan query) tapi penyakitnya identik dan sudah
 * TERUKUR: `POST /stok/awal` dengan `tanggal: "2026-02-30"` → **500**, sebab
 * `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` cuma memeriksa BENTUK dan
 * Postgres-lah yang menolak isinya. `.refine(tanggalSah)` menutup selisih itu
 * dengan pemeriksaan yang sama persis dengan sisi query.
 */
export const zTanggal = z
  .string()
  .refine(tanggalSah, "Format tanggal harus YYYY-MM-DD dan tanggalnya harus ada");

/**
 * BULAN dengan BAWAAN — dan kapan itu sah.
 *
 * Aturannya bisa dinamai, dan repo ini sudah memakainya tanpa menamainya:
 * **jatuh ke bawaan itu jujur HANYA bila balasannya menyebut apa yang
 * dipakai.** `/laporan` mengembalikan `dari`/`sampai`; `/absensi/rekap` dan
 * `/kebersihan/rekap` mengembalikan `bulan`/`dari`/`sampai`. Layarnya
 * merender dari nilai itu, bukan dari yang diketik orang — jadi tak ada
 * angka yang dilabeli rentang yang tak pernah dipakai.
 *
 * Kontraknya pun sudah DIPAKU verify-api sejak lama ("rekap: bulan 00 →
 * jatuh ke bulan berjalan, bukan 500"), dan pengetatanku ke 400 mematahkannya
 * — gerbang lama menahan perbaikan yang berlebihan, persis seperti §191
 * menahan pengetatan `POST /penyimpanan`.
 *
 * Yang TIDAK boleh memakai ini: balasan yang tak menyebut rentangnya —
 * `/pengajuan` dan `/kebersihan` memulangkan larik telanjang, jadi di sana
 * bawaan diam-diam berarti layar memajang pilihan yang tak dipakai. Di sana
 * `bulanQuery`/`tanggalQuery` yang menolak.
 */
export function bulanQueryAtau(c: Context, nama: string, bawaan: string): string {
  const v = c.req.query(nama);
  return v && bulanSah(v) ? v : bawaan;
}
