import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * NOMOR STRUK SETELAH CABANG BERGANTI NAMA.
 *
 * Prefiks nomor diturunkan dari NAMA cabang (`kodeCabang`), dan versi lama
 * membaca urutan berikutnya dari `ORDER BY nomor DESC` — maksimum TEKSTUAL
 * atas nomor utuh — lalu `slice(-4) + 1`. Itu mengandaikan prefiks tak pernah
 * berubah. Ganti nama cabang mematahkannya, terukur (2026-08-24, DB verify
 * §248/§249): cabang "Pusat" punya 101 nota `PUSAT-…` (seq 0106) lalu
 * berganti nama → satu nota `CABANGG248-…-0107` lahir → max tekstual memilih
 * `PUSAT-…` ('P' > 'C') → seq berikutnya 0107 → 23505 → **500, dan
 * deterministik: SETIAP penjualan berikutnya di cabang itu 500 sampai ganti
 * tanggal bisnis** — kasir tak bisa menjual seharian.
 *
 * SESUDAH (keadaan beracun yang sama): max NUMERIK atas 4 digit terakhir,
 * lintas prefiks → 0108, 0109, … — cabang pulih. verify-api §249 (pasangan
 * "penjualan biasa") berjalan MELEWATI keadaan campuran-prefiks ini di tiap
 * run penuh, jadi perilakunya terjaga hidup di sana; uji ini memaku bentuk
 * sumbernya supaya bacaan tekstual tak kembali lewat refactor.
 */
const SUMBER = butaKomentar(
  readFileSync(
    fileURLToPath(new URL("../src/modules/penjualan/service.ts", import.meta.url)),
    "utf8",
  ),
);

describe("nomor struk: urutan dihitung numerik lintas prefiks", () => {
  it("PREMIS: pembangun nomornya masih di berkas ini", () => {
    expect(SUMBER).toContain("kodeCabang(branch.nama)");
    expect(SUMBER).toContain('padStart(4, "0")');
  });

  it("maksimumnya MAX(RIGHT(nomor,4)::int) — bukan ORDER BY teks + slice", () => {
    expect(SUMBER, "max numerik hilang").toContain("COALESCE(MAX(RIGHT(");
    expect(SUMBER, "bacaan tekstual kembali — ganti nama cabang akan mem-500-kan " +
      "semua penjualan sisa hari itu").not.toContain("orderBy(desc(sales.nomor))");
    expect(SUMBER).not.toContain(".slice(-4");
  });
});
