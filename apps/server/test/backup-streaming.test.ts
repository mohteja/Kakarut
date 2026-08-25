import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PENCADANGAN: STREAMING, BUKAN SELURUH DATABASE DI MEMORI + gzip SINKRON.
 *
 * Bentuk lama memuat semua baris semua tabel ke satu larik string, `join`,
 * lalu `gzipSync` — kompresi sinkron yang menghentikan event loop. Terukur
 * pada 600.790 baris / DB 193 MB (2026-08-25):
 *
 *   SEBELUM: backup 12,9 dtk · `/api/health` (biasa 2 ms) macet sampai
 *            5.299 ms — SEMUA permintaan lain ikut berhenti · RSS 207 MB →
 *            1.786 MB, lalu BERTAHAN ±1,6 GB setelah selesai
 *   SESUDAH: backup 8,6 dtk · health MAKS 28 ms · RSS puncak 392 MB,
 *            idle sesudahnya 164 MB · arsipnya DIPULIHKAN utuh oleh
 *            `restore-backup.ts` (58 tabel, 600.788 baris, agregat suntikan
 *            cocok) — kompatibilitas format dibuktikan dengan MENJALANKAN
 *            restore, bukan dengan membaca kodenya
 *
 * Perilaku sukses/unduh/retensi tetap dijaga verify-api (§ pemeriksaan
 * sistem); volume 200 rb terlalu mahal untuk CI, jadi angka di atas hidup di
 * ledger dan uji ini memaku BENTUK yang membuatnya benar: kursor per batch
 * pada satu snapshot, tulisan sadar-backpressure, dan tak ada gzip sinkron.
 */
const SUMBER = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/lib/backup.ts", import.meta.url)), "utf8"),
);

describe("backup: ekspor streaming", () => {
  it("PREMIS: pembangun arsip & format JSONL-nya masih di berkas ini", () => {
    expect(SUMBER).toContain("jalankanBackup");
    expect(SUMBER).toContain('{"tabel":');
    expect(SUMBER).toContain("VERSI_ARSIP");
  });

  it("kompresinya createGzip ber-backpressure — gzipSync tak boleh kembali", () => {
    expect(SUMBER, "gzip streaming hilang").toContain("createGzip()");
    expect(SUMBER, "penunggu drain hilang — tulisan tanpa backpressure menumpuk " +
      "seluruh keluaran di buffer stream").toContain('once("drain"');
    expect(SUMBER, "gzipSync kembali — kompresi sinkron seluruh DB menghentikan " +
      "event loop (terukur 5,3 dtk)").not.toContain("gzipSync");
  });

  it("bacaannya kursor per batch pada SATU snapshot", () => {
    expect(SUMBER).toContain("DECLARE kursor_backup NO SCROLL CURSOR");
    expect(SUMBER).toContain("FETCH 5000 FROM kursor_backup");
    expect(SUMBER, "snapshot konsisten hilang — tabel dipotret pada waktu " +
      "berbeda-beda").toContain("BEGIN ISOLATION LEVEL REPEATABLE READ");
    expect(SUMBER, "transaksi menggantung saat gagal tak di-ROLLBACK").toContain('query("ROLLBACK")');
  });

  it("PASANGAN: kursornya di koneksi lock (bukan pool) — advisory lock & kursor wajib sekoneksi", () => {
    const ekspor = SUMBER.slice(SUMBER.indexOf("jalankanBackup"));
    expect(ekspor).toContain("lockClient.query(\n        `DECLARE kursor_backup");
  });
});
