import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PENJAGA UNTUK ALATNYA SENDIRI.
 *
 * Enam penyapu di suite ini memutuskan "bersih" atas teks yang sudah dikupas
 * komentarnya. Kalau pengupasnya buta sebagian, tiap "bersih" di atasnya cuma
 * berarti "tidak terbaca" — dan tak ada satu pun uji yang berubah warna.
 * Itu bukan hipotesis: sapuan pertama vena "pemilihan cabang" melihat 19 dari
 * 263 rute, lalu melaporkan angkanya seolah lengkap.
 *
 * Sebabnya satu baris di `app.ts`:
 *
 *     .use("/admin/*", requireAuth, requireSuperAdmin)
 *
 * Versi naif menilai `/` tanpa tahu ia ada di dalam string, membaca `/*` itu
 * sebagai pembuka komentar blok, dan menelan 12.363 aksara sisa berkas —
 * termasuk seluruh tabel `.route(...)`. Yang benar-benar berbeda hasilnya
 * 4.167 aksara (sisanya spasi & `\n` yang memang tak disentuh siapa pun);
 * angka itulah yang diasersi di bawah, karena ia bisa diperiksa ulang.
 *
 * BUKTI MERAHNYA PERMANEN: `butaNaif` di bawah adalah salinan persis versi yang
 * dulu terkirim ke enam tempat. Tiap sifat yang dijanjikan pengupas baru diuji
 * berpasangan — sekali menuntut versi baru benar, sekali menuntut versi naif
 * memang GAGAL di situ. Tanpa pasangan kedua, uji-uji ini tak membuktikan
 * pengupasnya perlu; ia cuma menyatakan ia ada.
 */

/** Versi naif yang dulu terkirim — disimpan sebagai alat ukur, bukan dipakai. */
function butaNaif(s: string): string {
  const out = s.split("");
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("/*", i)) {
      let j = s.indexOf("*/", i + 2);
      j = j < 0 ? s.length : j + 2;
      for (let k = i; k < j; k += 1) if (out[k] !== "\n") out[k] = " ";
      i = j;
    } else if (s.startsWith("//", i)) {
      let j = s.indexOf("\n", i);
      j = j < 0 ? s.length : j;
      for (let k = i; k < j; k += 1) out[k] = " ";
      i = j;
    } else i += 1;
  }
  return out.join("");
}

const APP = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");

describe("pengupas komentar: `/*` di dalam string bukan pembuka komentar", () => {
  const contoh = `.use("/admin/*", requireAuth)\nconst setelahnya = 1;\n`;

  it("kode sesudah `\"/admin/*\"` bertahan", () => {
    expect(butaKomentar(contoh)).toContain("const setelahnya = 1;");
  });

  it("BUKTI MERAH: versi naif menelan kode itu", () => {
    // Kalau baris ini pernah hijau dengan `toContain`, pengupas barunya sudah
    // dikembalikan ke versi naif dan seluruh berkas ini jadi hiasan.
    expect(butaNaif(contoh)).not.toContain("const setelahnya = 1;");
  });

  it("pada app.ts sungguhan, tabel rute bertahan — dan naif kehilangannya", () => {
    const jangkar = '.route("/admin/tenants"';
    expect(APP.indexOf(jangkar)).toBeGreaterThan(0);
    expect(butaKomentar(APP)).toContain(jangkar);
    expect(butaNaif(APP)).not.toContain(jangkar);

    // Angka kebutaannya, bukan sekadar "ada bedanya". Diukur 2026-08-23:
    // 4.167 aksara berbeda di app.ts saja — 66 % dari 6.307 aksara yang naif
    // butakan di seluruh `apps/server/src`. Batasnya dipasang longgar (4.000)
    // supaya penyuntingan biasa di app.ts tak membuatnya merah palsu.
    const baru = butaKomentar(APP);
    const naif = butaNaif(APP);
    let hilang = 0;
    for (let i = 0; i < APP.length; i += 1) if (baru[i] !== naif[i]) hilang += 1;
    expect(hilang).toBeGreaterThan(4_000);
  });
});

describe("regex literal juga dilewati, bukan dibaca sebagai string", () => {
  // `/[",\n]/` memuat kutip ganda. Versi antara yang cuma melewati string
  // literal membuka string palsu di situ dan menelan komentar di bawahnya —
  // persis yang terjadi di `apps/web/src/lib/bahanCsv.ts:36`.
  const contoh = `const selCsv = (v) => /[",\\n]/.test(v) ? q(v) : v;\n/** dokumentasi */\nconst kode = 2;\n`;

  it("komentar sesudah regex tetap terhapus", () => {
    expect(butaKomentar(contoh)).not.toContain("dokumentasi");
  });

  it("kode sesudahnya tetap utuh", () => {
    expect(butaKomentar(contoh)).toContain("const kode = 2;");
  });

  it("pembagian tetap dibaca sebagai pembagian, bukan pembuka regex", () => {
    const bagi = `const r = hargaBatch / isiBatch;\n// catatan\nconst z = 3;\n`;
    expect(butaKomentar(bagi)).toContain("const r = hargaBatch / isiBatch;");
    expect(butaKomentar(bagi)).not.toContain("catatan");
    expect(butaKomentar(bagi)).toContain("const z = 3;");
  });
});

describe("komentar sungguhan tetap dihapus", () => {
  it("baris & blok, di luar maupun di dalam interpolasi template", () => {
    const s = "const a = 1; // rahasia\n/* juga rahasia */\nconst b = `x${y /* dan ini */}z`;\n";
    const b = butaKomentar(s);
    expect(b).not.toContain("rahasia");
    expect(b).not.toContain("dan ini");
    expect(b).toContain("const a = 1;");
    expect(b).toContain("const b = `x${y");
  });

  it("kutip ganjil paling jauh membutakan SATU baris", () => {
    // Apostrof di teks JSX membuka string yang tak pernah tertutup. Batasnya
    // `\n`, jadi komentar di baris berikutnya tetap kena.
    const s = "<p>Kasir's laci</p>\n// masih komentar\nconst c = 4;\n";
    const b = butaKomentar(s);
    expect(b).not.toContain("masih komentar");
    expect(b).toContain("const c = 4;");
  });
});

describe("posisi tak bergeser", () => {
  it("panjang dan jumlah baris app.ts persis sama", () => {
    const b = butaKomentar(APP);
    expect(b.length).toBe(APP.length);
    expect(b.split("\n").length).toBe(APP.split("\n").length);
  });

  it("nomor baris kode tetap benar sesudah dikupas", () => {
    const s = "satu\n/* dua\n   tiga */\nempat\n";
    const b = butaKomentar(s);
    expect(b.split("\n")[3]).toBe("empat");
    expect(b.split("\n")[1].trim()).toBe("");
  });
});
