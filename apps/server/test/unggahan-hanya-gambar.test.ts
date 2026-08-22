import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * BERKAS UNGGAHAN: YANG DIKLAIM HARUS COCOK DENGAN YANG TERTULIS DI BYTE-NYA.
 *
 * `file.type` pada multipart datang dari header yang DITULIS KLIEN. Sapuan
 * seluruh `apps/server/src` menemukan **dua** keputusan yang bersandar
 * padanya, keduanya di `upload/routes.ts`: memilih ekstensi berkas, dan
 * menetapkan `ContentType` yang disimpan ke R2.
 *
 * TERUKUR sebelum diperbaiki, lewat HTTP:
 *
 *     POST /upload  «<svg><script>alert(1)</script></svg>» sebagai image/png
 *     → 201, tersimpan .png, dilayani `Content-Type: image/png`
 *
 * DAN TIDAK ADA SKRIP YANG BERJALAN — itu bagian yang penting, dan alasannya
 * bukan pemeriksaan isi (tak ada), melainkan DUA penjagaan di hilir:
 *
 *   1. `image/svg+xml` tak ada di `ALLOWED`. SVG satu-satunya format gambar
 *      yang bisa memuat `<script>`; tiga tipe raster tak pernah dieksekusi
 *      browser.
 *   2. `secureHeaders` terpasang `app.use("*")`, jadi `/uploads/*` ikut
 *      memulangkan `X-Content-Type-Options: nosniff` — terukur pada respons
 *      sungguhan.
 *
 * Keduanya benar HARI INI, dan tak satu pun dijaga uji sebelum berkas ini.
 * Yang pertama bahkan berupa KETIADAAN satu baris, dan ketiadaan tak
 * meninggalkan jejak yang bisa dibaca orang berikutnya. Menambahkan satu entri
 * SVG ke `ALLOWED` — perubahan yang kelihatan sepele dan mudah diminta —
 * langsung menjadikannya XSS tersimpan yang berjalan di sesi orang lain.
 *
 * Karena itu vena ini menghasilkan dua hal: pemeriksaan tanda tangan di hulu,
 * DAN uji yang menahan kedua penjagaan hilir tetap di tempatnya.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const RUTE = readFileSync(`${SRC}/modules/upload/routes.ts`, "utf8");
const APP = readFileSync(`${SRC}/app.ts`, "utf8");

/** Cerminan `cocokTandaTangan` di rutenya — dijaga sama oleh uji terakhir. */
function cocok(tipe: string, b: Buffer): boolean {
  if (tipe === "image/png") {
    return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (tipe === "image/jpeg") {
    return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  if (tipe === "image/webp") {
    return (
      b.length >= 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP"
    );
  }
  return false;
}

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([36, 0, 0, 0]),
  Buffer.from("WEBP", "latin1"),
  Buffer.from("VP8 ", "latin1"),
]);

describe("unggahan: hanya gambar, dan dibuktikan dari byte-nya", () => {
  it("INTI: tipe yang diklaim diperiksa terhadap byte-nya", () => {
    expect(RUTE, "pemeriksaan tanda tangan hilang").toContain("cocokTandaTangan(file.type, buffer)");
    // …dan hasilnya benar-benar MENOLAK, bukan cuma dihitung lalu diabaikan.
    expect(RUTE).toMatch(/if \(!cocokTandaTangan\(file\.type, buffer\)\) \{\s*throw new HTTPException\(400/);
  });

  it("gambar yang SAH tetap diterima — bukan sakelar mati", () => {
    // Tanpa pasangan ini, "menolak yang bukan gambar" juga hijau seandainya
    // seluruh unggahan ditolak, yaitu fitur yang mati.
    expect(cocok("image/png", PNG)).toBe(true);
    expect(cocok("image/jpeg", JPEG)).toBe(true);
    expect(cocok("image/webp", WEBP)).toBe(true);
  });

  it("isi yang BUKAN gambar ditolak, termasuk SVG berskrip", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(cocok("image/png", svg), "SVG dideklarasikan PNG").toBe(false);
    expect(cocok("image/png", Buffer.from("<!doctype html><script>x</script>"))).toBe(false);
    expect(cocok("image/png", Buffer.alloc(4096, 7)), "byte acak").toBe(false);
    expect(cocok("image/png", Buffer.alloc(0)), "berkas kosong").toBe(false);
    // Tipe yang benar tapi tanda tangan milik format LAIN.
    expect(cocok("image/png", JPEG), "JPEG mengaku PNG").toBe(false);
    expect(cocok("image/jpeg", PNG), "PNG mengaku JPEG").toBe(false);
    // RIFF tanpa WEBP — mis. berkas WAV.
    expect(
      cocok(
        "image/webp",
        Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE", "latin1")]),
      ),
      "RIFF/WAVE mengaku WebP",
    ).toBe(false);
  });

  it("PENJAGA HILIR 1: `image/svg+xml` tak boleh masuk ALLOWED", () => {
    /*
     * SVG satu-satunya format gambar yang bisa memuat `<script>`, dan berkas
     * unggahan disajikan dari origin yang SAMA dengan aplikasinya. Satu entri
     * di sini mengubah unggahan gambar jadi XSS tersimpan — dan pemeriksaan
     * tanda tangan di atas tak akan menahannya, sebab SVG yang sah memang
     * berisi teks XML.
     */
    const daftar = RUTE.slice(RUTE.indexOf("const ALLOWED"), RUTE.indexOf("};", RUTE.indexOf("const ALLOWED")));
    expect(daftar, "SVG bisa memuat skrip — jangan diterima").not.toMatch(/svg/i);
    expect(daftar, "XML/HTML juga tak boleh").not.toMatch(/xml|html/i);
    // …dan daftarnya memang masih ada isinya (bukan hijau karena kosong).
    for (const t of ["image/jpeg", "image/png", "image/webp"]) expect(daftar).toContain(t);
  });

  it("PENJAGA HILIR 2: nosniff berlaku ke /uploads, bukan cuma /api", () => {
    /*
     * `secureHeaders` dipasang pada app TERLUAR dengan pola `"*"`, jadi berkas
     * statis di `/uploads/*` ikut memulangkan `X-Content-Type-Options: nosniff`
     * — terukur pada respons sungguhan. Memindahkannya ke sub-app `/api` akan
     * membuat berkas unggahan kehilangan penjagaan itu tanpa satu pun uji
     * berubah warna.
     */
    expect(APP, "secureHeaders tak lagi dipasang di app terluar dengan pola *").toMatch(
      /app\.use\(\s*\n?\s*"\*",\s*\n?\s*secureHeaders\(/,
    );
  });

  it("cerminan di uji ini tak boleh menyimpang dari rutenya", () => {
    // Uji ini menjalankan SALINAN aturannya. Kalau rutenya berubah dan salinan
    // di sini tidak, uji ini berhenti menyatakan apa pun tentang kode nyata.
    for (const pola of ["137, 80, 78, 71, 13, 10, 26, 10", "0xff", "0xd8", '"RIFF"', '"WEBP"']) {
      expect(RUTE, `tanda tangan ${pola} tak lagi ada di rutenya`).toContain(pola);
    }
  });
});
