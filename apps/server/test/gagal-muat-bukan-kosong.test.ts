import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * GAGAL MEMUAT ≠ TIDAK ADA.
 *
 * `useQuery` mengembalikan `data === undefined` pada dua keadaan yang sama
 * sekali berbeda: belum termuat, dan GAGAL termuat. Pola `(data ?? []).length
 * === 0` menyamakan keduanya dengan "memang kosong", lalu layar menuliskan
 * sebuah PERNYATAAN:
 *
 *   "Belum ada satuan — tambahkan untuk dipakai di form Bahan Baku."
 *   "Belum ada supplier — juga bisa ditambah langsung dari form faktur."
 *   "Anda belum menambahkan bahan baku apa pun ke master."
 *
 * Itu lebih buruk daripada layar kosong. Layar kosong membuat orang bertanya;
 * kalimat di atas membuat orang BEKERJA — menambah master yang sebenarnya sudah
 * ada. Dan duplikatnya menempel: satuan/kategori yang sudah dipakai tak bisa
 * dihapus lagi (server menolak dengan 409), sementara kategori ganda menyebar
 * ke dropdown Menu & Bahan Baku tempat keduanya terlihat sah.
 *
 * MAKA aturannya: bila sebuah `useQuery` menyetir keadaan-kosong lewat `?? []`,
 * galatnya WAJIB ikut dibaca. Halaman boleh menampilkannya sendiri atau
 * meneruskannya ke `TabelResponsif galat={…}` — yang dilarang cuma satu:
 * mendiamkannya.
 *
 * Penyapu ini menandai bentuknya, bukan niatnya, jadi ia juga menangkap halaman
 * BARU yang menyalin pola lama.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const WEB = AKAR + "apps/web/src/";

function semuaSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaSumber(p + "/"));
    else if (/\.tsx$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

const BERKAS = semuaSumber(WEB);

/** Tiap destructuring `const { … } = useQuery(` beserta berkas & barisnya. */
const kueri = BERKAS.flatMap((p) => {
  const isi = readFileSync(p, "utf8");
  const keluar: { berkas: string; baris: number; bidang: string; isi: string }[] = [];
  for (const m of isi.matchAll(/const\s*\{([^}]*)\}\s*=\s*useQuery\(/g)) {
    keluar.push({
      berkas: p.slice(AKAR.length),
      baris: isi.slice(0, m.index).split("\n").length,
      bidang: m[1],
      isi,
    });
  }
  return keluar;
});

describe("daftar kosong tak pernah mengaku kosong saat pemuatannya gagal", () => {
  it("penyapunya benar-benar menemukan kueri (bukan hijau karena buta)", () => {
    // Tanpa patokan ini, regex yang berhenti cocok akan membuat uji di bawah
    // lulus dengan daftar kosong — penjaga yang tak menjaga apa pun.
    expect(kueri.length, "tak satu pun `useQuery` terbaca").toBeGreaterThan(50);
    expect(new Set(kueri.map((k) => k.berkas)).size).toBeGreaterThan(20);
  });

  it("tiap kueri yang menyetir keadaan-kosong lewat `?? []` juga membaca galatnya", () => {
    /**
     * Yang ditandai: `data` yang di-`?? []` LALU dipakai sebagai keadaan-kosong
     * (`.length === 0`) — langsung maupun lewat satu alias
     * (`const semua = supplier ?? []` … `semua.length === 0`). Alias itu bukan
     * kasus karangan: begitulah `SupplierPage` ditulis, dan penyapu versi
     * pertama melewatkannya.
     *
     * Yang SENGAJA tidak ditandai: `?? []` yang cuma disuapkan ke `.map()`
     * (dropdown, checklist). Daftar pilihan yang kosong tak MENGKLAIM apa pun —
     * ia hanya tak menawarkan apa-apa. Yang berbahaya adalah kalimat.
     *
     * Karena itu penyapu ini menjaring BENTUK yang sudah terbukti salah, bukan
     * mengaku menjaring semuanya. Patokan per-berkas di bawah menahan sembilan
     * tempat yang memang pernah keliru.
     */
    const lalai = kueri
      .filter((k) => !/\berror\b|\bisError\b/.test(k.bidang))
      .filter((k) => {
        const dm = /data(?:\s*:\s*(\w+))?/.exec(k.bidang);
        if (!dm) return false;
        const nama = dm[1] ?? "data";
        // Langsung: `(supplier ?? []).length === 0`
        if (new RegExp(`\\(\\s*\\b${nama}\\b\\s*\\?\\?\\s*\\[\\]\\s*\\)\\.length\\s*===\\s*0`).test(k.isi)) {
          return true;
        }
        // Satu lompatan alias: `const semua = supplier ?? [];` … `semua.length === 0`
        for (const a of k.isi.matchAll(
          new RegExp(`const\\s+(\\w+)\\s*=\\s*\\b${nama}\\b\\s*\\?\\?\\s*\\[\\]\\s*;`, "g"),
        )) {
          if (new RegExp(`\\b${a[1]}\\b\\.length\\s*===\\s*0`).test(k.isi)) return true;
        }
        return false;
      })
      .map((k) => `${k.berkas}:${k.baris}`);

    expect(
      lalai,
      "kueri di atas memakai `?? []` untuk keadaan-kosong tapi tak pernah membaca `error` — " +
        "layar akan mengaku 'belum ada' padahal cuma gagal dimuat",
    ).toEqual([]);
  });

  it("`TabelResponsif` menyediakan jalannya, dan memakainya untuk KEDUA tampilan", () => {
    const tabel = readFileSync(WEB + "components/TabelResponsif.tsx", "utf8");
    expect(tabel).toContain("galat?: unknown;");
    // Satu sumber isi untuk kartu HP & tabel desktop — kalau hanya satu yang
    // dialihkan, separuh pengguna tetap dibohongi.
    expect(tabel).toContain("const isiKosong = galat ? (");
    expect(tabel.match(/\{isiKosong\}/g) ?? [], "kedua tampilan harus memakainya").toHaveLength(2);
    // Dan `kosong` tak boleh lagi dirender langsung di salah satunya.
    expect(tabel).not.toContain("{kosong}");
  });

  it("halaman yang dulu lalai kini benar-benar meneruskan galatnya", () => {
    // Patokan per-berkas: penyapu di atas hanya melihat BENTUK, jadi mengganti
    // `?? []` dengan `?? ([] as X[])` akan membuatnya diam. Ini menahan sembilan
    // tempat yang memang pernah salah.
    const pin: [string, string][] = [
      ["pages/pengaturan/KaryawanPage.tsx", "galat={gagalMuat}"],
      ["pages/pengaturan/PenyimpananPage.tsx", "galat={gagalMuat}"],
      ["pages/pengaturan/SupplierPage.tsx", "galat={gagalMuat}"],
      ["pages/superadmin/TenantsPage.tsx", "galat={gagalMuat}"],
      ["pages/pengaturan/SatuanPage.tsx", "Daftar satuan gagal dimuat."],
      ["components/KategoriManagerModal.tsx", "Daftar kategori gagal dimuat."],
      ["pages/produksi/FakturFormPage.tsx", "Daftar bahan baku gagal dimuat"],
      ["pages/menu/MenuListPage.tsx", "Daftar menu gagal dimuat"],
      ["pages/pengaturan/MejaPage.tsx", "Denah meja tidak bisa dimuat"],
    ];
    for (const [berkas, jangkar] of pin) {
      expect(readFileSync(WEB + berkas, "utf8"), berkas).toContain(jangkar);
    }
  });
});
