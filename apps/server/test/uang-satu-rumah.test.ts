import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hitungPb1 } from "@kakarut/shared";

/**
 * ARITMETIKA UANG PENJUALAN PUNYA SATU RUMAH.
 *
 * `total = subtotal − diskon + pb1`, dan `pb1 = round(net × (tarif ÷ 100))`.
 * Keduanya hidup di `packages/shared`. Tiap layar yang menuliskannya ulang
 * menegakkan aritmetika itu dengan tangan — dan salinan yang menyimpang tak
 * berbunyi apa-apa, ia cuma memberi angka yang berbeda dari yang dicatat.
 *
 * URUTAN OPERASINYA BAGIAN DARI JAWABANNYA. Terukur dengan menyapu tarif
 * 1,00%–15,00% × net 1…2.000.000 (26.185.000 pasangan), di JavaScript DAN di
 * Dart — keduanya memberi pasangan yang sama persis:
 *
 *     net Rp 25.000, tarif 1,13%
 *       net × (tarif ÷ 100)  → Rp 283
 *       net × tarif ÷ 100    → Rp 282
 *
 * Lembar pembayaran di aplikasi ponsel memakai urutan yang kedua — layar tempat
 * kasir membaca total sebelum menekan Bayar. Diperbaiki di
 * `mohteja/kakarut-mobile`; yang dijaga DI SINI sisi server & web-nya, plus
 * asal-usul fikstur yang dipakai uji cermin di sana.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const SHARED = fileURLToPath(new URL("../../../packages/shared/src", import.meta.url));

function berkasKode(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasKode(p));
    else if (/\.tsx?$/.test(nama)) keluar.push(p);
  }
  return keluar;
}

function tanpaKomentar(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * `* … / 100` apa pun isinya, lalu barisnya harus menyebut pb1/tarif.
 *
 * BUKAN pencocokan bentuk ekspresi. Versi pertama penjaga kembarannya di repo
 * mobile menuntut `\w*` di antara `*` dan `/ 100`, dan karena itu BUTA terhadap
 * `company!.pb1Rate` — `!` dan `.` bukan `\w`. Menyuntikkan kembali bug yang
 * jadi alasan uji itu ada membuatnya tetap hijau.
 *
 * Syarat "menyebut pb1/tarif" membuat `subtotal * maksPersen / 100` milik batas
 * diskon tetap bebas — itu perhitungan lain yang memang bukan urusan sini.
 */
const BAGI100 = /\*[^;\n]{0,60}\/\s*100/;
const SOAL_PB1 = /pb1|tarif/i;

export function salinanRumus(kode?: { nama: string; isi: string }[]): string[] {
  const berkas =
    kode ??
    [
      ...berkasKode(SRC).map((p) => ({ nama: `server/${p.slice(SRC.length + 1)}`, isi: readFileSync(p, "utf8") })),
      ...berkasKode(WEB).map((p) => ({ nama: `web/${p.slice(WEB.length + 1)}`, isi: readFileSync(p, "utf8") })),
    ];
  const keluar: string[] = [];
  for (const { nama, isi } of berkas) {
    for (const baris of tanpaKomentar(isi).split("\n")) {
      if (BAGI100.test(baris) && SOAL_PB1.test(baris)) keluar.push(`${nama}: ${baris.trim()}`);
    }
  }
  return keluar;
}

describe("aritmetika uang penjualan punya satu rumah", () => {
  it("premis: pemindainya benar-benar membaca berkas server & web", () => {
    expect(berkasKode(SRC).length).toBeGreaterThan(50);
    expect(berkasKode(WEB).length).toBeGreaterThan(30);
  });

  it("INTI: rumus PB1 tak ditulis ulang di luar packages/shared", () => {
    expect(
      salinanRumus(),
      "rumus PB1 dieja lagi di sini. Urutan operasinya bagian dari jawabannya " +
        "(terukur beda Rp1 pada net 25.000 tarif 1,13%) — panggil `hitungPb1` " +
        "dari @kakarut/shared",
    ).toEqual([]);
  });

  it("`hitungPb1` memakai urutan `net × (tarif ÷ 100)`, bukan sebaliknya", () => {
    const s = readFileSync(join(SHARED, "hpp.ts"), "utf8");
    expect(s).toContain("Math.round(subtotal * (ratePersen / 100))");
    // …dan buktinya bahwa urutan itu MEMANG berbeda — kalau tidak, seluruh uji
    // di berkas ini menjaga hantu.
    expect(hitungPb1(25_000, 1.13)).toBe(283);
    expect(Math.round((25_000 * 1.13) / 100)).toBe(282);
  });

  it("kasir web memanggil pembantunya, bukan mengeja rumusnya", () => {
    const s = readFileSync(join(WEB, "pages/kasir/KasirPage.tsx"), "utf8");
    expect(s, "KasirPage harus mengimpor hitungPb1").toMatch(/import[^;]*hitungPb1[^;]*from "@kakarut\/shared"/);
    expect(s).toContain("hitungPb1(subtotalNet,");
  });

  it("skrip pembuat fikstur cermin mobile masih ada & terdaftar", () => {
    // Uji cermin di `kakarut-mobile` mengadu 697 baris jawaban Dart dengan
    // keluaran skrip ini. Kalau skripnya hilang, fikstur di sana berubah jadi
    // angka yang tak bisa dilahirkan ulang — dan cocoknya tak menyatakan apa
    // pun tentang implementasi hari ini.
    const skrip = readFileSync(join(SRC, "scripts/acuan-uang-mobile.ts"), "utf8");
    for (const f of ["hitungPb1", "tarifPb1Struk", "hitungUangSetelahRefund"]) {
      expect(skrip, `fikstur cermin tak lagi meliputi ${f}`).toContain(f);
    }
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(pkg.scripts["acuan:uang-mobile"]).toBeTruthy();
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh batas diskon", () => {
    const buat = (isi: string) => salinanRumus([{ nama: "uji.ts", isi }]);
    // Bentuk PERSIS yang sempat lolos di penjaga kembarannya:
    expect(buat("const pb1 = (net * (company!.pb1Rate) / 100);")).toHaveLength(1);
    expect(buat("const pb1 = Math.round(net * tarif / 100);")).toHaveLength(1);
    // …dan yang SAH tak boleh tertuduh:
    expect(buat("const maksDiskon = subtotal * maksPersen / 100;"), "batas diskon bukan PB1").toHaveLength(0);
    expect(buat("const pb1 = hitungPb1(subtotalNet, rate);"), "memanggil pembantunya justru yang diminta").toHaveLength(0);
    expect(buat("// pb1 = net * tarif / 100"), "komentar bukan kode").toHaveLength(0);
  });
});
