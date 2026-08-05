import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Penjaga KUNCI MASTER — premis `staleTime` 5 menit harus tetap benar.
 *
 * `main.tsx` memberi tujuh kunci `staleTime` 5 menit, dengan alasan yang
 * ditulis di sana: "Data MASTER jarang berubah dan setiap mutasi sudah
 * meng-invalidate kuncinya sendiri". Kalimat itu bukan komentar hiasan — ia
 * SATU-SATUNYA yang membuat cache selama itu aman. Satu mutasi yang lupa
 * menyebut kuncinya, dan layarnya menampilkan bacaan basi sampai lima menit
 * tanpa sebab yang bisa ditebak pemakainya.
 *
 * Penjaga ini menyisir sisi web: tiap berkas yang menulis (POST/PATCH/PUT/
 * DELETE) ke salah satu endpoint master WAJIB menyebut kunci master itu di
 * `invalidateQueries`. Yang menulis ke sub-path yang BUKAN master (mis.
 * `/penyimpanan/:id/bahan` — pemetaan rak, bukan master bahan) tidak dihitung,
 * makanya pencocokannya memakai path lengkap, bukan sekadar nama kuncinya.
 */
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));

function berkasWeb(dir: string): string[] {
  const out: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) out.push(...berkasWeb(p));
    else if (nama.endsWith(".tsx") || nama.endsWith(".ts")) out.push(p);
  }
  return out;
}
const BERKAS = berkasWeb(WEB);
const isi = new Map(BERKAS.map((f) => [f, readFileSync(f, "utf8")]));

/** Kunci master → pola endpoint yang benar-benar mengubah master itu. */
const MASTER: Array<[string, RegExp]> = [
  ["company", /api\("\/company",\s*\{\s*method:/],
  ["cabang", /api\(`?\/cabang[^`"]*`?,\s*\{\s*method:/],
  ["satuan", /api\(`?\/satuan[^`"]*`?,\s*\{\s*method:/],
  ["supplier", /api\(`?\/supplier[^`"]*`?,\s*\{\s*method:/],
  ["kategori-bahan", /api\(`?\/kategori-bahan[^`"]*`?,\s*\{\s*method:/],
];

describe("premis: kunci master memang ber-staleTime panjang", () => {
  const MAIN = readFileSync(fileURLToPath(new URL("../../web/src/main.tsx", import.meta.url)), "utf8");

  it("`KUNCI_MASTER` ada dan diberi 5 menit", () => {
    expect(MAIN).toContain("const KUNCI_MASTER = [");
    expect(MAIN).toContain("setQueryDefaults([kunci], { staleTime: 5 * 60_000 });");
  });

  it("alasannya tertulis — itulah yang dijaga berkas ini", () => {
    expect(MAIN).toContain("setiap mutasi sudah meng-invalidate kuncinya");
  });

  it("dan `company` termasuk di dalamnya", () => {
    const i = MAIN.indexOf("const KUNCI_MASTER = [");
    expect(MAIN.slice(i, MAIN.indexOf("];", i))).toContain('"company"');
  });
});

describe("tiap penulis endpoint master menyebut kunci masternya", () => {
  for (const [kunci, pola] of MASTER) {
    it(`penulis \`${kunci}\` tak ada yang lupa`, () => {
      const lupa: string[] = [];
      for (const [f, s] of isi) {
        if (!pola.test(s)) continue;
        if (!s.includes(`queryKey: ["${kunci}"]`)) lupa.push(f.slice(WEB.length + 1));
      }
      expect(lupa, `berkas ini menulis ke master "${kunci}" tanpa meng-invalidate-nya`).toEqual([]);
    });
  }
});

describe("yang dulu lupa: target penjualan di Rekomendasi Beli", () => {
  const HAL = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/produksi/RekomendasiBeliPage.tsx", import.meta.url)),
    "utf8",
  );

  it("menyebut kedua kunci, bukan cuma `rekomendasi`", () => {
    const i = HAL.indexOf("const simpanDefault = useMutation({");
    // Jendela TETAP, bukan sampai `});` terdekat: `});` pertama justru muncul
    // di dalam `onSuccess` sendiri (`invalidateQueries({ … });`), jadi batas
    // itu memotong tepat sebelum baris yang mau diperiksa.
    const blok = HAL.slice(i, i + 1400);
    expect(i, "mutasi simpanDefault tak ditemukan").toBeGreaterThan(0);
    expect(blok).toContain("const hitung =");
    expect(blok).toContain('queryKey: ["rekomendasi"]');
    expect(blok).toContain('queryKey: ["company"]');
  });

  it("dicatat bahwa ini menutup JEBAKAN, bukan memperbaiki gejala", () => {
    // Jujur soal ini penting: tak ada layar yang menampilkan
    // `target_penjualan` dari `["company"]` hari ini, jadi tak ada yang
    // rusak sekarang. Yang salah adalah premisnya, dan premis itulah yang
    // dipakai membenarkan cache 5 menit.
    expect(HAL).toContain("tak ada gejala yang terlihat");
    expect(HAL).toContain("mewarisi bacaan basi 5 menit");
  });
});
