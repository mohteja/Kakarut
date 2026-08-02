import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Penjaga SISA PILIHAN LOKASI ANTAR-SESI.
 *
 * Tiga kunci localStorage menyimpan pilihan lokasi, dan ketiganya bermakna
 * "cabang milik perusahaan yang sedang login":
 *
 *   kakarut.branch          — lokasi utama
 *   kakarut.cabang-data     — cabang yang datanya dikelola dari Kantor
 *   kakarut.cabang-data-ck  — pilihan terpisah untuk halaman produksi/beli
 *
 * Yang ketiga dulu cuma dibuang di jalur ganti-peran, TIDAK saat login maupun
 * logout. Di terminal POS bersama — satu perangkat, dipakai bergantian, hal
 * paling lumrah di warung — pilihan CK milik warung A ikut terbawa ke sesi
 * warung B. Halaman Produksi/Beli lalu mengirim `?branch_id=` milik perusahaan
 * lain, server menolaknya (benar), dan pemakainya melihat galat di halaman yang
 * semestinya baik-baik saja — tanpa cara memperbaikinya, karena nilai yang
 * salah itu tak tampak di mana pun.
 *
 * Dijaga DUA LAPIS, dan keduanya perlu:
 *
 * 1. Dibersihkan di SETIAP batas sesi. Kalau cuma ini, satu jalur yang
 *    terlewat mengembalikan bugnya utuh — persis yang sudah terjadi.
 * 2. Divalidasi terhadap daftar cabang. Ini yang membuatnya sembuh sendiri
 *    apa pun asal nilainya, termasuk dari jalur yang belum terpikirkan.
 */
const auth = readFileSync(
  new URL("../../web/src/context/AuthContext.tsx", import.meta.url),
  "utf8",
);
const branch = readFileSync(
  new URL("../../web/src/context/BranchContext.tsx", import.meta.url),
  "utf8",
);

const KUNCI = ["kakarut.branch", "kakarut.cabang-data", "kakarut.cabang-data-ck"];

/** Badan sebuah `const <nama> = useCallback((…) => { … })`. */
function badanCallback(src: string, nama: string): string {
  const mulai = src.indexOf(`const ${nama} = useCallback(`);
  expect(mulai, `${nama} tak ketemu`).toBeGreaterThan(-1);
  const buka = src.indexOf("{", src.indexOf("=>", mulai));
  let dalam = 0;
  for (let i = buka; i < src.length; i++) {
    if (src[i] === "{") dalam++;
    else if (src[i] === "}" && --dalam === 0) return src.slice(buka, i + 1);
  }
  throw new Error(`badan ${nama} tak ketemu`);
}

describe("pilihan lokasi tak boleh menyeberang sesi", () => {
  for (const jalur of ["setSession", "logout"]) {
    it(`${jalur} membuang KETIGA kunci lokasi`, () => {
      const badan = badanCallback(auth, jalur);
      for (const k of KUNCI) {
        expect(badan, `${jalur} tak membuang ${k}`).toContain(`removeItem("${k}")`);
      }
    });
  }

  it("jalur ganti-peran juga membuang ketiganya", () => {
    // Ini satu-satunya jalur yang dulu benar; ia jadi acuan, jadi ikut dipatok.
    const mulai = auth.indexOf("if (pindahPeran)");
    expect(mulai).toBeGreaterThan(-1);
    const potong = auth.slice(mulai, mulai + 600);
    for (const k of KUNCI) expect(potong).toContain(`removeItem("${k}")`);
  });

  it("kedua pilihan cabang-data divalidasi terhadap daftar cabang", () => {
    // Lapis kedua: sembuh sendiri walau ada batas sesi yang terlewat.
    expect(branch).toMatch(/const sah = \(id: string \| null\)/);
    expect(branch).toContain('removeItem("kakarut.cabang-data")');
    expect(branch).toContain('removeItem("kakarut.cabang-data-ck")');
    // Yang tak sah dikembalikan ke null, bukan ditebak ke cabang lain —
    // menebak berarti diam-diam menampilkan data cabang yang tak diminta.
    expect(branch).toContain("setDataBranchIdState(null)");
    expect(branch).toContain("setDataCkBranchIdState(null)");
  });
});
