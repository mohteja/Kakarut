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
