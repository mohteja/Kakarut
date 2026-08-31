import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { zTanggal } from "./tanggal-query";

/**
 * SEBERAPA JAUH sebuah waktu boleh menyimpang dari sekarang — satu rumah.
 *
 * Aturan ini sudah ada sejak lama, lengkap dengan angka dan alasannya, dan ia
 * hidup di SATU pintu saja: `modules/sync/routes.ts`. `MAKS_UMUR_HARI`,
 * `SKEW_MENIT`, dan kalimat "waktu kejadian di masa depan" tak muncul di satu
 * berkas lain pun — sementara SEMBILAN medan waktu lain yang datang dari klien
 * hanya memvalidasi BENTUKNYA.
 *
 * Terukur sebelum rumah ini ada (2026-08-27, HTTP + DB sungguhan):
 *
 *   POST /stok/awal `tanggal: "2099-01-01"`  → 201. Layar Stok melaporkan
 *     saldo **500**; kartu stok hari yang sama melaporkan **saldo_awal 0,
 *     saldo_akhir 0**. Dua tampilan stok yang sama berselisih seluruh
 *     saldonya, dan tak ada yang memberi tahu siapa pun — sebab baseline
 *     dicari `opname_date < ${dari}`, dan tanggal 2099 tak pernah cocok.
 *   PATCH faktur `prod_date: "2099-06-01"` + `exp: "1900-01-01"` → 200. Lot
 *     yang tiba hari ini tercatat diproduksi tahun 2099 dan kedaluwarsa 1900.
 *   GET /pesanan?tanggal=bukan-tanggal → **500** "Terjadi kesalahan pada
 *     server" — string tak tervalidasi sampai ke jalur tanggal.
 *
 * DUA JENIS WAKTU, dan menyamakannya akan salah:
 *
 *   KEJADIAN — sesuatu yang SUDAH terjadi (opname, stok masuk, mutasi). Tak
 *     boleh di masa depan; boleh mundur sejauh batas yang disebut pintunya.
 *   RENCANA  — sesuatu yang BERLAKU ke depan (cuti, kedaluwarsa, masa berlaku
 *     aturan). Justru harus boleh di masa depan; yang dijaga langit-langitnya.
 *
 * Memaksa aturan KEJADIAN ke medan RENCANA akan merusak fitur yang benar —
 * kesalahan yang persis itu sudah terjadi sekali di sesi ini (jalur Central
 * Kitchen pada pengurungan cabang), dan yang menangkapnya uji PASANGAN.
 */

/** Toleransi jam perangkat yang meleset. Dipindahkan APA ADANYA dari `/sync`. */
export const SKEW_MENIT = 5;

/**
 * Usia maksimal perintah, per tipe. `penjualan` sengaja jauh lebih longgar:
 * uangnya sudah diterima kasir, jadi menolak antrean lama = transaksi hilang
 * permanen. Perangkat cadangan / outlet event bisa offline berminggu-minggu.
 * Tipe lain tetap 7 hari — mengubah stok jauh ke belakang justru berbahaya.
 */
export const MAKS_UMUR_HARI: Record<string, number> = { penjualan: 30 };
export const MAKS_UMUR_HARI_DEFAULT = 7;

/**
 * Slack SATU HARI di kedua ujung, dan alasannya bukan kelonggaran asal.
 *
 * Medan `YYYY-MM-DD` adalah tanggal BISNIS di zona perusahaan, sementara
 * saringan ini berjalan di Zod — sebelum `company_id` diketahui, apalagi zona
 * waktunya. Zona nyata membentang UTC−12..+14, jadi "hari ini" di perusahaan
 * bisa satu hari di depan atau di belakang hari UTC. Tanpa slack ini, kasir di
 * Pasifik ditolak saat mencatat opname harinya sendiri.
 *
 * Yang HILANG karenanya ditulis jujur: penyimpangan satu hari lolos saringan
 * ini. Yang dijaga di sini "2099" dan "1900", bukan "besok".
 */
const SLACK_HARI = 1;

const HARI_MS = 86_400_000;

/** `YYYY-MM-DD` hari ini di UTC — pangkal perbandingan, bukan tanggal bisnis. */
function hariUtc(sekarang = Date.now()): string {
  return new Date(sekarang).toISOString().slice(0, 10);
}

function selisihHari(tanggal: string, sekarang: number): number {
  const t = new Date(`${tanggal}T00:00:00Z`).getTime();
  const h = new Date(`${hariUtc(sekarang)}T00:00:00Z`).getTime();
  return Math.round((t - h) / HARI_MS);
}

/**
 * Tanggal sebuah KEJADIAN: tak boleh di masa depan, tak boleh terlalu lampau.
 *
 * `maksHariLalu` disebut PEMANGGILNYA, sebab jawabannya memang berbeda per
 * pintu: saldo pembuka saat onboarding wajar bertanggal setahun lalu, mutasi
 * rutin tidak. Yang tak pernah berbeda: kejadian tak terjadi di masa depan.
 */
export function zTanggalKejadian(maksHariLalu: number, sekarang?: () => number) {
  return zTanggal
    .refine((s) => selisihHari(s, (sekarang ?? Date.now)()) <= SLACK_HARI, {
      message: "Tanggal kejadian tidak boleh di masa depan",
    })
    .refine((s) => selisihHari(s, (sekarang ?? Date.now)()) >= -(maksHariLalu + SLACK_HARI), {
      message: `Tanggal kejadian tidak boleh lebih dari ${maksHariLalu} hari lalu`,
    });
}

/**
 * Tanggal sebuah RENCANA: boleh di masa depan, tapi berlangit-langit.
 *
 * Kedua sisinya dibatasi karena keduanya sudah terukur salah: `exp` bertanggal
 * 1900 membuat lot kedaluwarsa seketika, dan tanpa batas atas tak ada yang
 * menghalangi tahun 9999.
 */
export function zTanggalRencana(maksHariDepan: number, maksHariLalu: number, sekarang?: () => number) {
  return zTanggal
    .refine((s) => selisihHari(s, (sekarang ?? Date.now)()) <= maksHariDepan + SLACK_HARI, {
      message: `Tanggal tidak boleh lebih dari ${maksHariDepan} hari ke depan`,
    })
    .refine((s) => selisihHari(s, (sekarang ?? Date.now)()) >= -(maksHariLalu + SLACK_HARI), {
      message: `Tanggal tidak boleh lebih dari ${maksHariLalu} hari lalu`,
    });
}

/** Langit-langit yang dipakai berulang, bernama supaya angkanya bisa dibaca. */
export const SETAHUN = 366;
export const SEPULUH_TAHUN = 3660;

/**
 * Stempel waktu PENUH sebuah kejadian (jalur `/sync`) — pemeriksaan yang sama,
 * pada satuan milidetik.
 *
 * Dipakai `/sync` menggantikan pemeriksaan sebaris yang dulu hidup di sana.
 * Pesannya dipertahankan KATA PER KATA: kontrak ponsel membacanya, dan
 * `verify-api` memakunya.
 */
export function pastikanWaktuKejadian(t: number, tipe: string, sekarang: number): void {
  if (Number.isNaN(t)) throw new HTTPException(400, { message: "waktu tidak valid" });
  if (t > sekarang + SKEW_MENIT * 60_000) {
    throw new HTTPException(400, { message: "waktu kejadian di masa depan" });
  }
  const maksUmur = MAKS_UMUR_HARI[tipe] ?? MAKS_UMUR_HARI_DEFAULT;
  if (t < sekarang - maksUmur * HARI_MS) {
    throw new HTTPException(400, { message: `waktu kejadian lebih dari ${maksUmur} hari lalu` });
  }
}

/** Stempel waktu ISO dari klien yang MEMANG boleh menunjuk jauh ke depan. */
export function zStempelRencana(maksHariDepan: number, sekarang?: () => number) {
  return z.string().datetime().refine(
    (s) => {
      const t = new Date(s).getTime();
      const n = (sekarang ?? Date.now)();
      return !Number.isNaN(t) && t <= n + maksHariDepan * HARI_MS;
    },
    { message: `Waktu tidak boleh lebih dari ${maksHariDepan} hari ke depan` },
  );
}
