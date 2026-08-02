import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga CALLBACK UNGGAHAN: `ImageUpload` mendarat BELAKANGAN.
 *
 * `ImageUpload.onChange` bukan `onChange` biasa. Isian teks sinkron — tiap
 * ketukan punya closure segar, jadi `setForm({ ...form, x: v })` selalu benar.
 * Unggahan tidak: callback-nya mendarat beberapa detik kemudian membawa state
 * dari render saat unggahan DIMULAI. Menyebar snapshot itu (`{ ...form }`)
 * menimpa balik semua yang berubah selama menunggu.
 *
 * Bentuk kegagalannya diam-diam dan selalu terlihat seperti "kadang hilang":
 * - ketik keterangan sambil menunggu foto → keterangannya hilang saat mendarat;
 * - pilih dua foto berurutan → yang mendarat belakangan mengembalikan
 *   pasangannya jadi null;
 * - tutup modal selagi mengunggah → snapshot lama MENGHIDUPKAN form yang sudah
 *   ditutup, modalnya terbuka sendiri.
 *
 * Semuanya hilang dengan bentuk fungsional `set((prev) => …)`, yang membaca
 * state TERBARU. Karena itu yang dipatok bukan satu berkas, tapi polanya: tak
 * boleh ada setter yang dipanggil dengan literal objek langsung dari dalam
 * `onChange` sebuah `ImageUpload`.
 *
 * Catatan cakupan: setter yang menyimpan SATU nilai skalar (`onChange={setFoto}`
 * atau `(url) => setLogoUrl(url)`) tak punya masalah ini — tak ada snapshot yang
 * disebar — dan memang tidak ikut terjaring pola di bawah.
 */
const akar = fileURLToPath(new URL("../../web/src/", import.meta.url));

function semuaTsx(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTsx(p + "/"));
    else if (nama.endsWith(".tsx")) hasil.push(p);
  }
  return hasil;
}

/**
 * TANDA CACATNYA, bukan salah satu cara menuliskannya: setter yang menerima
 * literal objek yang diawali SEBARAN — `setSesuatu({ ...`.
 *
 * Versi pertama penjaga ini mematok `onChange={(x) => setSesuatu({`, dan itu
 * cuma satu ejaan. Badan blok menulis cacat yang sama persis tanpa tersentuh:
 *
 *     onChange={(url) => { setForm({ ...form, foto: url }); }}
 *
 * Saya buktikan sendiri: bentuk itu ditanam ke `PengajuanCutiSection` dan
 * penjaganya tetap HIJAU. Persis lubang yang di `spinner-abadi` menyembunyikan
 * enam spinner abadi selama beberapa ronde — di sana kebetulan ada korbannya,
 * di sini kebetulan belum. Yang membedakan cuma keberuntungan, jadi keduanya
 * ditutup dengan cara yang sama: kunci tanda cacatnya, bukan ejaannya.
 *
 * Bentuk benarnya tak pernah cocok: `set((prev) => ({ ... }))` diawali kurung
 * dan `prev`, bukan `{`.
 */
const SEBAR_BASI = /\bset\w+\(\s*\{\s*\.\.\./;

describe("ImageUpload: callback unggahan tak boleh menyebar snapshot basi", () => {
  const berkas = semuaTsx(akar).filter((p) =>
    readFileSync(p, "utf8").includes("<ImageUpload"),
  );

  it("ada berkas yang memakai ImageUpload (penjaga ini tak boleh kosong)", () => {
    // Tanpa ini, salah ketik pada `akar` membuat seluruh penjaga lulus diam-diam.
    expect(berkas.length).toBeGreaterThan(3);
  });

  for (const p of berkas) {
    it(`${p.slice(akar.length)} memakai bentuk fungsional`, () => {
      const isi = readFileSync(p, "utf8");
      // Potong per pemakaian ImageUpload supaya `onChange` milik komponen lain
      // di berkas yang sama tidak ikut terjaring.
      const blok = isi.split("<ImageUpload").slice(1);
      for (const b of blok) {
        const sampaiTutup = b.slice(0, b.indexOf("/>") + 1);
        expect(SEBAR_BASI.exec(sampaiTutup)?.[0] ?? null).toBeNull();
      }
    });
  }
});
