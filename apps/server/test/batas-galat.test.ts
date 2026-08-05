import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { galatChunk, galatTerbaru } from "../../web/src/lib/galat";

/**
 * Penjaga LAYAR PUTIH SESUDAH DEPLOY.
 *
 * Tanpa batas galat, React membongkar SELURUH pohon begitu ada yang melempar
 * saat render — yang tersisa halaman benar-benar kosong: tak ada pesan, tak
 * ada tombol, tak ada petunjuk bahwa memuat ulang menolong.
 *
 * Dan pemicunya bukan kode yang salah, melainkan hal paling rutin: DEPLOY.
 *
 *   1. ± 50 rute dimuat lewat `React.lazy`, nama berkasnya ber-hash per build.
 *   2. Versi baru ter-deploy → chunk lama hilang dari `dist`.
 *   3. Tab kasir yang terbuka sejak awal shift masih memegang nama lama;
 *      menekan menu yang chunk-nya belum pernah dimuat memintanya.
 *   4. `app.notFound` server DULU memulangkan shell SPA → **200 + HTML** untuk
 *      sebuah module script → MIME ditolak peramban.
 *   5. `import()` gagal → `React.lazy` melempar → tak ada yang menangkap →
 *      layar putih, di tengah shift, di depan antrean.
 *
 * `UpdatePrompt` sudah ada, tapi ia jalur SOPAN: menawarkan, bisa ditunda ke
 * pil kecil, dan cek berkalanya sampai 90 detik terlambat. Ia tak menolong tab
 * yang sudah terlanjur jatuh. Yang kurang jalur PEMULIHAN.
 */
const WEB = (p: string) => fileURLToPath(new URL(`../../web/src/${p}`, import.meta.url));
const BATAS = readFileSync(WEB("components/BatasGalat.tsx"), "utf8");
const MAIN = readFileSync(WEB("main.tsx"), "utf8");
const APP = readFileSync(WEB("App.tsx"), "utf8");
const SERVER = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

describe("galatChunk: mengenali 'berkasnya tak terambil', bukan 'kodenya salah'", () => {
  // Kalimatnya berbeda-beda per peramban, jadi yang dijaga daftar nyatanya —
  // bukan satu teks yang kebetulan dipakai mesin CI.
  const NYATA: [string, string][] = [
    ["Chrome/Edge", "Failed to fetch dynamically imported module: https://app/assets/Kasir-a1b2.js"],
    ["Firefox", "error loading dynamically imported module"],
    ["Safari", "Importing a module script failed."],
    [
      "MIME salah (persis kasus kita)",
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
    ],
    ["preload Vite", "Unable to preload CSS for /assets/Kasir-a1b2.css"],
  ];

  for (const [peramban, pesan] of NYATA) {
    it(`dikenali: ${peramban}`, () => {
      expect(galatChunk(new Error(pesan))).toBe(true);
    });
  }

  it("cocoknya tak peduli besar-kecil huruf", () => {
    expect(galatChunk(new Error("FAILED TO FETCH DYNAMICALLY IMPORTED MODULE"))).toBe(true);
  });

  it("`ChunkLoadError` bernama juga dikenali", () => {
    const e = new Error("apa saja");
    e.name = "ChunkLoadError";
    expect(galatChunk(e)).toBe(true);
  });

  it("galat yang dilempar bukan Error tetap terbaca", () => {
    expect(galatChunk("Failed to fetch dynamically imported module")).toBe(true);
  });
});

describe("galatChunk: TIDAK memakan galat yang sesungguhnya", () => {
  // Arah sebaliknya, dan ini yang menentukan: kalau bug render ikut dianggap
  // chunk, aplikasinya akan MEMUAT ULANG SENDIRI karena kode yang salah —
  // menyembunyikan cacat di balik kedipan layar, berulang tiap dibuka.
  const BUKAN = [
    "Cannot read properties of undefined (reading 'nama')",
    "x is not a function",
    "Maximum update depth exceeded",
    "Tidak dapat terhubung ke server. Mungkin sedang diperbarui.",
    "Kesalahan (500)",
    "Sesi berakhir, silakan login ulang",
  ];

  for (const pesan of BUKAN) {
    it(`bukan chunk: ${pesan.slice(0, 40)}`, () => {
      expect(galatChunk(new Error(pesan))).toBe(false);
    });
  }

  it("null/undefined bukan galat chunk", () => {
    expect(galatChunk(null)).toBe(false);
    expect(galatChunk(undefined)).toBe(false);
  });
});

describe("premis: memang tak ada batas galat lain, dan rutenya memang lazy", () => {
  it("rute halaman dimuat lewat React.lazy", () => {
    const jumlah = APP.split("= lazy(() => import(").length - 1;
    expect(jumlah, "kalau lazy hilang, cacat ini juga hilang").toBeGreaterThan(30);
  });

  it("Suspense-nya SATU dan tak punya penangkap galat sendiri", () => {
    // Suspense hanya menangani "sedang dimuat" — promise yang DITOLAK tetap
    // dilempar ke atas sebagai galat render.
    expect(APP).toContain("<Suspense fallback={<PageLoading />}>");
  });
});

describe("BatasGalat: pemulihan berbeda untuk sebab yang berbeda", () => {
  it("adalah batas galat sungguhan (dua kait React-nya lengkap)", () => {
    expect(BATAS).toContain("static getDerivedStateFromError(");
    expect(BATAS).toContain("componentDidCatch(");
  });

  it("chunk → muat ulang sendiri", () => {
    expect(BATAS).toContain("if (galatChunk(galat) && !sudahPernahMuatUlang()) {");
    expect(BATAS).toContain("window.location.reload();");
  });

  it("dan muat ulangnya dikunci per build supaya tak jadi lingkaran", () => {
    expect(BATAS).toContain("sessionStorage.setItem(KUNCI_MUAT_ULANG");
    expect(BATAS).toContain("=== (LOADED_BUILD ?? \"dev\")");
  });

  it("sessionStorage diblokir → dianggap SUDAH pernah, bukan belum", () => {
    // Arah amannya sengaja dibalik: tanpa kunci yang bisa disimpan, satu-satunya
    // pilihan yang tak berisiko berputar adalah menampilkan kartu.
    const i = BATAS.indexOf("function sudahPernahMuatUlang");
    expect(BATAS.slice(i, i + 400)).toContain("return true;");
  });

  it("galat BUKAN chunk tidak memicu muat ulang diam-diam", () => {
    // Memuat ulang tak menyembuhkan kode yang salah; yang dilakukan hanya
    // memastikan layarnya tidak kosong.
    expect(BATAS).not.toContain("componentDidCatch(galat: Error) {\n    window.location.reload");
    expect(BATAS).toContain("Ada yang tidak beres di halaman ini");
  });

  it("layarnya tak pernah kosong — selalu ada jalan keluar yang bisa ditekan", () => {
    expect(BATAS).toContain("🔄 Muat ulang halaman");
    expect(BATAS).toContain("Kembali ke beranda");
  });

  it("pesan aslinya ikut ditampilkan supaya bisa dikenali lewat telepon", () => {
    expect(BATAS).toContain("{galat.message || String(galat)}");
  });
});

describe("dipasang di tempat yang benar", () => {
  it("membungkus router", () => {
    expect(MAIN).toContain("<BatasGalat>");
    expect(MAIN).toContain("</BatasGalat>");
    const i = MAIN.indexOf("<BatasGalat>");
    const j = MAIN.indexOf("</BatasGalat>");
    expect(MAIN.slice(i, j)).toContain("<App />");
  });

  it("overlay & prompt pembaruan sengaja DI LUAR batasnya", () => {
    // Keduanya paling dibutuhkan tepat saat isinya jatuh.
    const j = MAIN.indexOf("</BatasGalat>");
    expect(MAIN.slice(j)).toContain("<ServerStatusOverlay />");
    expect(MAIN.slice(j)).toContain("<UpdatePrompt />");
  });
});

describe("server: chunk lama dijawab jujur, bukan dengan shell SPA", () => {
  it("`/assets/*` yang hilang memulangkan 404", () => {
    expect(SERVER).toContain('if (c.req.path.startsWith("/assets/")) {');
    expect(SERVER).toContain("kemungkinan chunk dari build lama");
  });

  it("dan 404-nya `no-cache` — 404 boleh di-cache heuristik", () => {
    // Ketinggalan di percobaan pertama, dan CI (§114) yang menangkapnya:
    // `cacheImmutable` memang hanya menandai 2xx sehingga 404 ini tak pernah
    // jadi immutable, tapi TANPA arahan cache sama sekali, CDN masih boleh
    // menyimpannya sendiri (RFC 9111 menyebut 404 heuristically cacheable).
    // Kalau deploy di-rollback, hash lama hidup lagi dan 404 yang tersimpan
    // akan mematikan aset yang sebenarnya sudah kembali ada.
    const i = SERVER.indexOf('if (c.req.path.startsWith("/assets/")) {');
    expect(SERVER.slice(i, i + 700)).toContain('c.header("Cache-Control", "no-cache");');
  });

  it("`cacheImmutable` memang hanya menandai respons sukses", () => {
    // Premis dari uji di atas — kalau ini berubah, 404-nya bisa tertanda
    // immutable dan URL aset lama mati selama setahun.
    expect(SERVER).toContain('if (c.res.ok && !c.res.headers.get("Cache-Control")) {');
  });

  it("deep-link react-router lain TETAP dapat shell", () => {
    // Pagar arah sebaliknya: kalau ini ikut ter-404, /dashboard yang di-bookmark
    // berhenti bisa dibuka sama sekali.
    expect(SERVER).toContain("    return kirimShell(c);\n  });");
  });

  it("/api dan /uploads tetap dijawab sebagai JSON/404 seperti semula", () => {
    expect(SERVER).toContain('if (c.req.path.startsWith("/api") || c.req.path.startsWith("/uploads")) {');
    expect(SERVER).toContain('return c.json({ error: "Tidak ditemukan" }, 404);');
  });

  it("komentar yang dulu mengklaim 404 chunk sudah tercegah, diperbaiki", () => {
    expect(SERVER).not.toContain("mencegah 404 chunk lama");
    expect(SERVER).toContain("ini hanya menolong tab yang MEMUAT ULANG");
  });
});

describe("tetangganya di berkas yang sama tidak tersenggol", () => {
  it("galatTerbaru masih memilih yang paling baru DITEKAN, bukan urutan argumen", () => {
    const gagalDulu = { error: new Error("gagal lama"), submittedAt: 10 };
    const berhasilTerakhir = { error: null, submittedAt: 20 };
    // Aksi terakhir berhasil → layar harus diam, ditulis dengan urutan apa pun.
    expect(galatTerbaru(gagalDulu, berhasilTerakhir)).toBeNull();
    expect(galatTerbaru(berhasilTerakhir, gagalDulu)).toBeNull();

    // Dan sebaliknya: yang gagal belakangan memang yang ditampilkan.
    const gagalTerakhir = { error: new Error("gagal baru"), submittedAt: 30 };
    expect(galatTerbaru(berhasilTerakhir, gagalTerakhir)).toBe(gagalTerakhir.error);
    expect(galatTerbaru(gagalTerakhir, berhasilTerakhir)).toBe(gagalTerakhir.error);
  });
});
