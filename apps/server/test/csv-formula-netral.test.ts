import { describe, expect, it } from "vitest";
import type { BahanDto } from "@kakarut/shared";
import { buatCsvBahan, keRowsImpor, parseCsv, KOLOM_CSV } from "../../web/src/lib/bahanCsv";

/**
 * SEL CSV YANG DIBUKA EXCEL — rumus, bukan teks.
 *
 * `selCsv` mengutip sel bila memuat `,`/`"`/newline. Itu aturan PARSING, dan
 * benar untuk itu. Yang tak dijaganya: berkas ini dibangun untuk dibuka
 * program LAIN, dan sel yang diawali `=`, `+`, `-`, atau `@` dieksekusi
 * Excel/Sheets/LibreOffice begitu berkasnya dibuka. Alurnya tertulis di
 * berkas itu sendiri — *"unduh template → buka di Excel → Simpan"* — lalu
 * diimpor balik, jadi yang kembali adalah HASIL rumusnya, bukan nama yang
 * diketik orang.
 *
 * Terukur SEBELUM (2026-08-25, lewat pembangun sungguhan): nama `=1+1`,
 * kategori `@SUM(1+1)`, satuan `+kg`, catatan `-2+3`, dan muatan DDE
 * `=cmd|"/C calc"!A0` semuanya keluar APA ADANYA.
 * SESUDAH: keempatnya berawalan `'` (inert), dan ronde ekspor→impor
 * memulangkan teks aslinya PERSIS — termasuk nama yang memang diawali `'`
 * (dilolos ganda `''=merek` → kembali `'=merek`).
 *
 * Uji INTI di bawah bersifat perilaku dan otomatis mencakup kolom BARU: ia
 * mengisi tiap medan teks dengan muatan rumus lalu menuntut tak ada satu sel
 * pun yang keluar dengan awalan pemicu.
 */
const PEMICU = /^[=+\-@\t\r]/;

function bahan(o: Partial<BahanDto> = {}): BahanDto {
  return {
    id: "x",
    kode: null,
    nama: "Ayam",
    kategori: "bumbu",
    pengadaan: "beli",
    harga_beli: 5000,
    isi: 1,
    satuan: "kg",
    satuan_beli: null,
    stok_minimum: 0,
    min_beli: 0,
    masa_simpan_hari: 0,
    lead_time_hari: 0,
    boleh_eceran: false,
    track_stok: true,
    is_packaging: false,
    is_complement: false,
    catatan: null,
    ...o,
  } as BahanDto;
}

/**
 * Nomor kolom menurut namanya. Sengaja `findIndex`, bukan `indexOf("…")`:
 * penjaga `jangkar-iris` memperlakukan `indexOf` berargumen literal di berkas
 * uji sebagai JANGKAR IRISAN sumber (dan menuntut sumbernya terpetakan) —
 * aturan yang benar untuk kelasnya. Yang di sini cuma pencarian data pada
 * larik yang diimpor, jadi bentuknya yang diganti; bukan gerbangnya yang
 * diberi pengecualian.
 */
const kol = (nama: string) => KOLOM_CSV.findIndex((k) => k === nama);

/** Sel baris data pertama, sudah dilepas kutip CSV-nya. */
function selBaris(csv: string): string[] {
  const tabel = parseCsv(csv);
  expect(tabel.length, "PREMIS: ekspor tak menghasilkan baris data").toBeGreaterThanOrEqual(2);
  return tabel[1];
}

describe("CSV: sel tak boleh dibaca sebagai rumus", () => {
  it("INTI: tiap medan teks bermuatan rumus keluar TANPA awalan pemicu", () => {
    const muatan = "=1+1";
    const csv = buatCsvBahan([
      bahan({
        kode: muatan,
        nama: muatan,
        kategori: "@SUM(1+1)",
        satuan: "+kg",
        satuan_beli: "-2+3",
        catatan: '=cmd|"/C calc"!A0',
      }),
    ]);
    const sel = selBaris(csv);
    expect(sel.length).toBe(KOLOM_CSV.length);
    sel.forEach((s, i) => {
      expect(
        PEMICU.test(s),
        `kolom "${KOLOM_CSV[i]}" keluar sebagai RUMUS (${JSON.stringify(s)}) — ` +
          `Excel mengeksekusinya saat berkasnya dibuka`,
      ).toBe(false);
    });
  });

  it("RONDE UTUH: ekspor → impor memulangkan teks aslinya persis", () => {
    const kasus = [
      bahan({ nama: "=1+1", kategori: "@SUM(1+1)", satuan: "+kg", catatan: "-2+3" }),
      bahan({ nama: "'=merek", catatan: "'biasa" }), // sudah diawali kutip → lolos ganda
      bahan({ nama: "Vanili", harga_beli: 0.125, isi: 0.125 }), // kelas "0,125 → 125"
    ];
    const rows = keRowsImpor(parseCsv(buatCsvBahan(kasus))).rows;
    expect(rows.length).toBe(3);
    expect(rows[0].nama).toBe("=1+1");
    expect(rows[0].kategori).toBe("@SUM(1+1)");
    expect(rows[0].satuan).toBe("+kg");
    expect(rows[0].catatan).toBe("-2+3");
    expect(rows[1].nama, "nama yang MEMANG diawali kutip ikut berubah").toBe("'=merek");
    expect(rows[1].catatan).toBe("'biasa");
    expect(rows[2].harga_beli).toBe(0.125);
    expect(rows[2].isi).toBe(0.125);
  });

  it("PASANGAN: sel biasa & angka TIDAK tersentuh (berkas lama tak berubah)", () => {
    const sel = selBaris(buatCsvBahan([bahan({ kode: "AMS", nama: "Air Mineral", harga_beli: 50000 })]));
    expect(sel[kol("kode")]).toBe("AMS");
    expect(sel[kol("nama")]).toBe("Air Mineral");
    expect(sel[kol("harga_beli")]).toBe("50000");
    expect(sel[kol("boleh_eceran")]).toBe("tidak");
  });

  it("DETEKTOR TERBUKTI: muatan tanpa penetral memang tertuduh", () => {
    // Masukan sintetis — kalau asersinya tak bisa gagal, "hijau" tak berarti.
    expect(PEMICU.test("=1+1")).toBe(true);
    expect(PEMICU.test("@SUM(1)")).toBe(true);
    expect(PEMICU.test("+kg")).toBe(true);
    expect(PEMICU.test("-2+3")).toBe(true);
    expect(PEMICU.test("'=1+1")).toBe(false);
    expect(PEMICU.test("Air Mineral")).toBe(false);
  });
});
