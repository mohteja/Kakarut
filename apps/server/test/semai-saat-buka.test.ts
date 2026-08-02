import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga EDITOR JAM OPERASIONAL di halaman Operasional Cabang.
 *
 * Kartu cabang menyimpan isian jam di `useState(row.jam_… ?? "")`. Nilai awal
 * `useState` hanya dipakai saat komponen PERTAMA dipasang — dan kartu ini tak
 * pernah dipasang ulang: kuncinya `branch_id` yang tetap, sementara halamannya
 * menarik `/shift/pantau` tiap 60 detik. Isian itu karenanya membeku pada
 * keadaan saat halaman dibuka, sementara baris "Jam operasional" di atasnya
 * dibaca langsung dari `row` dan ikut segar.
 *
 * Editornya dibuka belakangan lewat tombol, jadi dua hal bisa berbeda di layar
 * yang SAMA: kartunya memajang 08:00 yang baru diatur admin lain, editornya
 * terbuka kosong. Menekan Simpan mengirim yang kosong — dan `jam_buka` kosong
 * bukan sekadar teks yang hilang: `telat_buka` disyaratkan `Boolean(jam_buka)`,
 * jadi peringatan "telat buka"/"lupa tutup" cabang itu ikut MATI, diam-diam,
 * oleh orang yang merasa tak mengubah apa-apa.
 *
 * Tombol Batal memang sudah menyemai ulang dari `row`. Yang kurang justru
 * tombol MEMBUKANYA — dan itulah sebabnya penjaga ini menempel pada jalur
 * `setEdit(true)`, bukan sekadar mencari nama setter-nya di berkas: token
 * telanjang macam `setJamBuka(` juga hidup di handler Batal dan di `onChange`,
 * jadi mencarinya saja akan tetap hijau meski penyemaian saat buka dihapus.
 */
const SUMBER = readFileSync(
  fileURLToPath(
    new URL("../../web/src/pages/operasional/OperasionalPage.tsx", import.meta.url),
  ),
  "utf8",
);

/**
 * Komentar DIBUANG sebelum diperiksa.
 *
 * Versi pertama penjaga ini tidak, dan langsung tersandung: komentar di atas
 * tombolnya menyebut `setEdit(true)` di dalam backtick, jadi `indexOf`
 * mendarat di prosa dan potongan yang diperiksa berhenti SEBELUM kodenya —
 * merah pada kode yang sudah benar. Kebalikannya sama berbahayanya: komentar
 * yang menyebut pemanggilan yang tepat bisa membuat penjaga hijau padahal
 * kodenya sudah hilang. Yang dijaga harus kode, bukan penjelasannya.
 */
const HALAMAN = SUMBER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("editor jam operasional menyemai ulang saat dibuka", () => {
  /** Potongan sumber SEBELUM `setEdit(true)` — jalur MEMBUKA editor saja. */
  const sebelumBuka = HALAMAN.slice(0, HALAMAN.indexOf("setEdit(true)"));

  it("pembuang komentar tidak ikut memakan kodenya", () => {
    // Kalau strip-nya kebablasan, seluruh uji di bawah jadi hampa.
    expect(HALAMAN).toContain("setEdit(true)");
    expect(HALAMAN).toContain("btnSecondary");
    expect(HALAMAN).not.toContain("SEMAI ULANG SAAT DIBUKA");
  });

  it("jam buka disemai dari row pada jalur buka", () => {
    expect(sebelumBuka).toMatch(/setJamBuka\(row\.jam_buka \?\? ""\)/);
  });

  it("jam tutup disemai dari row pada jalur buka", () => {
    expect(sebelumBuka).toMatch(/setJamTutup\(row\.jam_tutup \?\? ""\)/);
  });

  it("keduanya berada di handler yang sama dengan setEdit(true)", () => {
    // Tanpa batas jarak ini, penyemaian yang tercecer jauh di atas (mis. di
    // efek lain) akan tetap membuat uji di atas hijau.
    expect(HALAMAN).toMatch(
      /setJamBuka\(row\.jam_buka \?\? ""\);[\s\S]{0,120}?setJamTutup\(row\.jam_tutup \?\? ""\);[\s\S]{0,120}?setEdit\(true\)/,
    );
  });

  it("tombol Batal tetap menyemai ulang juga", () => {
    // Membatalkan harus membuang ketikan yang belum disimpan, bukan
    // menyisakannya untuk terkirim pada pembukaan berikutnya.
    expect(HALAMAN).toMatch(
      /setJamBuka\(row\.jam_buka \?\? ""\);[\s\S]{0,120}?setJamTutup\(row\.jam_tutup \?\? ""\);[\s\S]{0,120}?setEdit\(false\)/,
    );
  });
});
