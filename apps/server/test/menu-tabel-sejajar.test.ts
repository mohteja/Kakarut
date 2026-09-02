import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * MENU & HPP: SATU TABEL PER KATEGORI, KOLOMNYA HARUS SEJAJAR ANTAR-TABEL.
 *
 * Dilaporkan pemilik repo 2026-09-02 (tangkapan layar): kepala "HPP" kategori
 * pertama di x≈594, kategori kedua x≈730, ketiga x≈803 — tiap tabel mengukur
 * kolomnya dari isinya sendiri (tata letak otomatis), jadi tabel yang ditumpuk
 * tak pernah sejajar. Penawarnya tata letak TETAP: `tetap` pada
 * `TabelResponsif` + lebar (`kelasJudul: "w-…"`) di tiap kolom kecuali satu
 * kolom yang menampung sisanya.
 *
 * Yang dijaga bukan pikselnya (itu urusan mata/Playwright) melainkan syarat
 * yang membuat sejajar itu MUNGKIN: tata letak tetap dipasang, dan setiap
 * kolom selain "Menu" punya lebar — satu kolom tanpa lebar yang terselip
 * membuat lebar sisanya dibagi dua dan kesejajaran hilang lagi diam-diam.
 */
const baca = (rel: string) =>
  butaKomentar(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const HAL = baca("../../web/src/pages/menu/MenuListPage.tsx");
const TABEL = baca("../../web/src/components/TabelResponsif.tsx");

/** Blok `kolom={[ … ]}` dari TabelResponsif per kategori. */
function blokKolom(): string {
  const i = HAL.indexOf("kolom={[");
  const j = HAL.indexOf("]}", i);
  expect(i, "premis: kolom={[ ada").toBeGreaterThan(-1);
  expect(j, "premis: penutup ]} ada").toBeGreaterThan(i);
  return HAL.slice(i, j);
}

/** Objek kolom level-1 di dalam larik — dipisah pada `{` yang mengawali tiap kolom. */
function objekKolom(blok: string): string[] {
  const isi = blok.slice("kolom={[".length);
  const hasil: string[] = [];
  let dalam = 0;
  let mulai = -1;
  for (let k = 0; k < isi.length; k++) {
    const ch = isi[k];
    if (ch === "{") {
      if (dalam === 0) mulai = k;
      dalam++;
    } else if (ch === "}") {
      dalam--;
      if (dalam === 0 && mulai >= 0) {
        hasil.push(isi.slice(mulai, k + 1));
        mulai = -1;
      }
    }
  }
  return hasil;
}

describe("Menu & HPP: tabel per kategori sejajar", () => {
  it("TabelResponsif punya mode tata letak tetap, dan itu memang `table-fixed`", () => {
    expect(TABEL).toContain("tetap?: boolean;");
    expect(TABEL).toMatch(/tetap \? "table-fixed" : ""/);
  });

  it("tabel per kategori memakai `tetap` + lebar minimum", () => {
    const i = HAL.indexOf("<TabelResponsif");
    const j = HAL.indexOf("kolom={[", i);
    const props = HAL.slice(i, j);
    expect(props).toMatch(/\btetap\b/);
    expect(props).toMatch(/minLebar="min-w-\[\d+rem\]"/);
  });

  it("tiap kolom selain \"Menu\" punya lebar (`kelasJudul: \"w-…\"`) — tepat satu yang menampung sisa", () => {
    const kolom = objekKolom(blokKolom());
    expect(kolom.length, "premis: kolomnya terbaca").toBeGreaterThanOrEqual(9);
    const tanpaLebar = kolom.filter((k) => !/kelasJudul: "w-\d+"/.test(k));
    expect(tanpaLebar).toHaveLength(1);
    expect(tanpaLebar[0]).toContain('judul: "Menu"');
  });
});
