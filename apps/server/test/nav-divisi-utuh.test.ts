import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga NAV YANG MENUNJUK KE MANA-MANA.
 *
 * Ada satu invarian di `Layout.tsx` yang sudah pernah bocor, dan komentarnya
 * sendiri mencatat itu:
 *
 *   > setiap NavLink yang bisa muncul saat divisi = CK WAJIB ada di sini.
 *   > Kalau tidak, tautannya tetap tampil tapi efek pengalih memantulkan balik
 *   > ke /produksi begitu halaman dibuka — gejalanya "menu diklik tak terjadi
 *   > apa-apa", bukan galat, jadi sulit dilacak. `/transfer-stok` pernah
 *   > terlewat.
 *
 * Keanggotaan daftar per divisi bergantung pada syarat JSX yang bertingkat,
 * jadi TIDAK dijaga di sini — memeriksanya secara statis akan rapuh, dan
 * penjaga yang sesekali salah alarm lebih buruk daripada tak ada penjaga.
 * (Sudah ditelusuri manual: hari ini invariannya utuh.)
 *
 * Yang dijaga di sini dua premis yang bisa diperiksa mesin tanpa tafsir,
 * dan keduanya membusuk dengan gejala yang PERSIS SAMA — halaman memantul
 * atau tak terbuka, tanpa satu pun pesan galat:
 *
 *  1. Tiap entri daftar izin harus menunjuk rute yang benar-benar ada. Rute
 *     yang diganti namanya membuat entrinya tak lagi menjaga apa pun, dan
 *     tautan ke nama barunya mulai memantul.
 *  2. Tiap tujuan `NavLink` harus punya rutenya. Tautan ke rute yang sudah
 *     tak ada jatuh ke penangkap `*` dan mengalihkan diam-diam.
 */
const LAY = readFileSync(
  fileURLToPath(new URL("../../web/src/components/Layout.tsx", import.meta.url)),
  "utf8",
);
const APP = readFileSync(
  fileURLToPath(new URL("../../web/src/App.tsx", import.meta.url)),
  "utf8",
);

/** Seluruh `path` rute di App.tsx. Semuanya absolut (dijaga uji di bawah). */
const RUTE = new Set([...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));

function daftarIzin(nama: string): string[] {
  const m = new RegExp(`const ${nama} = \\[(.*?)\\];`, "s").exec(LAY);
  expect(m, `daftar ${nama} tak ditemukan di Layout.tsx`).not.toBeNull();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("premis: rute App.tsx semuanya absolut", () => {
  it("tak ada path relatif", () => {
    // Kalau kelak ada rute bersarang relatif, pencocokan set di bawah jadi
    // salah — dan ia akan MENUDUH tautan yang sebenarnya sah. Jadi premisnya
    // dijaga lebih dulu, bukan diandaikan.
    const relatif = [...RUTE].filter((p) => p !== "*" && !p.startsWith("/"));
    expect(relatif, "pencocokan di berkas ini mengandaikan path absolut").toEqual([]);
  });

  it("jumlahnya masuk akal (bukan regex yang gagal cocok)", () => {
    expect(RUTE.size).toBeGreaterThan(50);
  });
});

describe("daftar izin divisi menunjuk rute yang benar-benar ada", () => {
  for (const nama of ["BOLEH_STORE", "BOLEH_CK"]) {
    it(nama, () => {
      const hilang = daftarIzin(nama).filter((p) => !RUTE.has(p));
      expect(hilang, `${nama}: entri ini tak punya rute — tak menjaga apa pun`).toEqual([]);
    });
  }

  it("`/transfer-stok` ada di KEDUA daftar", () => {
    // Bukan entri sembarangan: inilah yang pernah terlewat, dan cabang memang
    // perlu melihatnya (pantauan kiriman masuk) sementara CK yang mengirim.
    expect(daftarIzin("BOLEH_STORE")).toContain("/transfer-stok");
    expect(daftarIzin("BOLEH_CK")).toContain("/transfer-stok");
  });
});

describe("tiap tautan sidebar punya rutenya", () => {
  it("tak ada NavLink yang menunjuk rute tak dikenal", () => {
    const tujuan = [...new Set([...LAY.matchAll(/<NavLink\s+to="([^"]+)"/g)].map((m) => m[1]))];
    expect(tujuan.length, "regex NavLink gagal cocok?").toBeGreaterThan(30);
    const mati = tujuan.filter((t) => !RUTE.has(t));
    expect(mati, "tautan ini jatuh ke penangkap `*` dan mengalihkan diam-diam").toEqual([]);
  });
});
