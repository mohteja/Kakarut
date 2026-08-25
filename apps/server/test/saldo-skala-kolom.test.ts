import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { keSkalaKolom, SKALA_QTY_PERLENGKAPAN } from "../src/lib/batas-angka";

/**
 * SALDO YANG DISUSUN DI JS DARI BEBERAPA `SUM(...)::float8`.
 *
 * Postgres menjumlahkan `numeric` secara EKSAK, jadi SATU `SUM(…)::float8`
 * dibulatkan sekali dan tetap sepadan dengan angka yang dikirim klien —
 * itulah kenapa membandingkan permintaan klien dengan satu saldo hasil SUM
 * memang tak butuh toleransi (diukur: `pakai 0,8` atas saldo 0,7+0,1 → 200).
 *
 * Yang TIDAK sepadan: saldo yang disusun DI JS dari dua nilai float8 yang
 * masing-masing sudah dibulatkan sendiri. `saldoDiRakPerlengkapan` =
 * `SUM(mutasi)::float8 − SUM(dalam_jalan)::float8`, dan terukur lewat HTTP
 * (2026-08-25, mutasi 0,3 · kiriman menunggu 0,1):
 *
 *   SEBELUM  POST /perlengkapan/:id/pakai qty 0,2 → 400
 *              "Stok tidak cukup (saldo 0.19999999999999998 pak)"
 *            POST /perlengkapan/:id/minta qty 0,2 → 400
 *              "Stok CK tidak cukup (siap kirim 0.19999999999999998 …)"
 *   SESUDAH  keduanya 200/ok; pasangannya (minta 0,25 & pakai 0,05 saat rak
 *            benar-benar habis) tetap 400, dengan angka bersih "0"
 *
 * Dua kerusakan sekaligus: sisa yang ADA tak bisa dihabiskan, dan derau
 * float ikut tercetak di pesan yang dibaca petugas.
 *
 * Pembulatan ke skala kolom bukan toleransi karangan — qty perlengkapan
 * memang `numeric(16,3)`, jadi tiga desimal adalah SELURUH presisi yang
 * pernah ada di data itu.
 */
const SERVICE = butaKomentar(
  readFileSync(
    fileURLToPath(new URL("../src/modules/perlengkapan/service.ts", import.meta.url)),
    "utf8",
  ),
);

describe("saldo disusun di JS: dikembalikan ke skala kolom", () => {
  it("DETEKTOR TERBUKTI: selisih float memang meleset ke BAWAH tanpa pembulatan", () => {
    // Kalau premis ini tak bisa gagal, seluruh vena ini tak menyatakan apa pun.
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(0.3 - 0.1).toBeLessThan(0.2);
    expect(2 - 1.1).toBeLessThan(0.9);
    // …dan pembulatan ke skala kolom memulihkannya
    expect(keSkalaKolom(0.3 - 0.1, SKALA_QTY_PERLENGKAPAN)).toBe(0.2);
    expect(keSkalaKolom(2 - 1.1, SKALA_QTY_PERLENGKAPAN)).toBe(0.9);
  });

  it("keSkalaKolom tidak mengubah nilai yang memang muat di kolomnya", () => {
    for (const n of [0, 1, 0.5, 12.345, 9_999_999.999, -0.25]) {
      expect(keSkalaKolom(n, SKALA_QTY_PERLENGKAPAN)).toBe(n);
    }
    // Bukan pembulatan yang menelan permintaan berlebih: 0,2005 tetap > 0,2
    expect(keSkalaKolom(0.2005, SKALA_QTY_PERLENGKAPAN)).toBeGreaterThan(0.2);
    // Nilai tak hingga dibiarkan apa adanya (bukan jadi 0 diam-diam)
    expect(keSkalaKolom(Number.NaN, 3)).toBeNaN();
  });

  it("SKALA cocok dengan kolomnya — 3 desimal, bukan angka yang dikarang", () => {
    // `supply_mutations.qty` & `supply_transfers.qty` = numeric(16,3).
    expect(SKALA_QTY_PERLENGKAPAN).toBe(3);
  });

  it("kedua penyusun saldo di JS memakainya", () => {
    expect(
      SERVICE,
      "saldo rak kembali mentah — pintu `pakai` menolak sisa yang ADA " +
        "(terukur 400 atas 0.19999999999999998)",
    ).toContain("keSkalaKolom(v, SKALA_QTY_PERLENGKAPAN)");
    expect(
      SERVICE,
      "`siapKirim` kembali mentah — pintu `minta` menolak sisa yang siap kirim",
    ).toContain("keSkalaKolom(saldoCk - dalamJalan, SKALA_QTY_PERLENGKAPAN)");
  });

  it("PASANGAN: toleransi pintu KEBUTUHAN tak ikut dihapus (kelas lain)", () => {
    // `stok`/`produksi` membandingkan KEBUTUHAN yang dihitung JS (resep ×
    // batch, konversi satuan) — di sana toleransi memang jawabannya, dan
    // menghapusnya sambil "menyeragamkan" akan merusak yang sudah benar.
    const STOK = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/modules/stok/service.ts", import.meta.url)), "utf8"),
    );
    const KONSUMSI = butaKomentar(
      readFileSync(
        fileURLToPath(new URL("../src/modules/produksi/konsumsi.ts", import.meta.url)),
        "utf8",
      ),
    );
    expect(STOK).toContain("perlu - 1e-9");
    expect(KONSUMSI).toContain("tersedia > 1e-6");
  });
});
