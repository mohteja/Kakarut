import { sql } from "drizzle-orm";
import type { db } from "../db/client";

/**
 * Serialkan penulisan yang berbagi satu KUNCI LOGIS, selama transaksi berjalan.
 *
 * KENAPA INI ADA, dan kenapa `FOR UPDATE` tidak cukup.
 *
 * Pola "periksa dulu, baru tulis" hanya aman bila ada sesuatu untuk DIKUNCI.
 * Untuk aturan yang melarang baris BARU — "tak boleh ada pengajuan cuti yang
 * bertindih", "tak boleh ada dua shift terbuka" — barisnya belum ada saat
 * diperiksa, jadi tak ada yang bisa dipegang `FOR UPDATE`. Dua permintaan
 * bersamaan sama-sama melihat "belum ada", dan keduanya menulis.
 *
 * Indeks unik menutup celah itu bila aturannya bisa ditulis sebagai kesamaan
 * kolom, dan di situlah ia yang dipakai (lihat `shifts_open_per_branch_uq`).
 * Yang TIDAK bisa: aturan bertindih rentang tanggal. Untuk itu kuncinya harus
 * diambil atas NAMA aturan, bukan atas nama baris — dan itulah yang di sini.
 *
 * `pg_advisory_xact_lock` dilepas otomatis saat transaksi selesai (commit
 * maupun rollback), jadi tak ada kunci yang tertinggal bila penulisannya gagal.
 *
 * `hashtext` memampatkan kunci teks jadi 32-bit, jadi TABRAKAN ANTAR-KUNCI
 * MUNGKIN TERJADI. Akibatnya cuma dua penulisan tak berkaitan sesekali
 * menunggu giliran — lambat, bukan salah. Sengaja diterima: alternatifnya
 * (tabel kunci sendiri) menambah tulisan pada tiap permintaan.
 *
 * Bagian kunci digabung dengan ":" — sertakan `companyId` supaya penyewa satu
 * tak pernah menahan giliran penyewa lain.
 */
export async function kunciAntrean(
  tx: Pick<typeof db, "execute">,
  ...bagian: string[]
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${bagian.join(":")}))`);
}

/**
 * Serialkan pengisian KODE massal yang dipanggil saat boot & seed.
 *
 * Ketiga pengisi kode — karyawan, bahan, menu — mengerjakan hal yang sama:
 * baca semua baris, susun kode unik di MEMORI, lalu tulis satu per satu.
 * Keunikannya dijamin oleh sebuah `Set` yang hidup di dalam SATU proses, dan
 * itulah jaminan yang runtuh begitu ada proses kedua.
 *
 * TERUKUR (2026-08-27, basis data seed berisi 232 bahan, 0 kode ganda):
 * dua `backfillKodeBahan` yang jalan bersamaan menghasilkan **2 kode ganda**
 * dalam satu perusahaan — `BB264` dan `BB238` masing-masing dipakai dua bahan.
 * Bukan kasus teoretis: penyebaran repo ini memutar instance baru sebelum yang
 * lama berhenti, jadi dua boot yang bertindih adalah keadaan NORMAL, bukan
 * kecelakaan.
 *
 * `backfillEmployeeCode` sudah aman sejak awal — ia memegang advisory lock DAN
 * kolomnya punya indeks unik (`memberships_company_kode_uq`). Dua saudaranya
 * tidak punya keduanya. Fungsi ini memberi mereka yang pertama, dan alasannya
 * ditulis di satu tempat supaya pengisi kode KEEMPAT tak lahir tanpa penahan.
 *
 * Kuncinya per-JENIS, bukan per-perusahaan: pengisi kode menyapu seluruh tabel
 * sekaligus, jadi tak ada gunanya membaginya lebih halus.
 */
export async function kunciBackfillKode(
  tx: Pick<typeof db, "execute">,
  jenis: "bahan" | "menu",
): Promise<void> {
  await kunciAntrean(tx, "backfill-kode", jenis);
}
