import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { kalimatLama, petaKelasKueri, situsKueriWeb } from "./util/kueri-web";

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
 *
 * ── BENTUK KETIGA, ditambahkan 2026-08-27 ───────────────────────────────────
 *
 * Pengecualian "daftar pilihan" di atas BENAR, dan tetap. Yang keliru adalah
 * anggapan bahwa ia mencakup semua yang bukan kalimat. Ada bentuk ketiga:
 * **ANGKA**. `(pengajuanNav ?? []).length` yang dirender sebagai LENCANA bukan
 * daftar pilihan — lencana yang lenyap memang mengklaim sesuatu: *"tidak ada
 * yang menunggu."*
 *
 * Terukur di peramban sungguhan (satu pengajuan menunggu, `page.route()`
 * membalas 500): jaringan sehat → lencana **"1"**; gagal → lencana **LENYAP**,
 * dan **tak satu pun** kalimat di layar menyebutkan kegagalan itu. Di
 * `Layout.tsx`, yang tampil di SETIAP layar, dengan poll 30–60 detik.
 *
 * Dan dua batas mesin lama ikut dicabut, keduanya membuatnya melaporkan
 * kebersihan yang tak ada:
 *   1. ia REGEX (`const { … } = useQuery(`) → buta pada `const q = useQuery(…)`;
 *   2. aturan `?? []`-nya menuntut koalesens menempel LANGSUNG pada nama
 *      `data` → tiap balasan berbentuk `{ rows: … }` lolos. `TransferStokPage`
 *      merender "Belum ada transfer stok." saat gagal, dan gerbang ini tak
 *      pernah melihatnya.
 *
 * Mesinnya kini `test/util/kueri-web.ts` (AST atas TSX). Angka sesudah sapuan:
 * `GALAT` 76 → **97** · `ANGKA` 24 → **3** (terdaftar) · `KALIMAT` 1 → **0**.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const WEB = AKAR + "apps/web/src/";

const situs = situsKueriWeb();
const peta = petaKelasKueri(situs);

/**
 * Situs yang meruntuhkan kegagalan jadi ANGKA dan MEMANG boleh — beserta
 * alasan yang bisa diperiksa. Ketiganya keputusan INTERNAL, bukan klaim yang
 * dibaca orang: tak satu pun angkanya sampai ke layar sebagai jumlah.
 */
const ANGKA_INTERNAL = new Map<string, string>([
  [
    "pages/menu/MenuFormPage.tsx:menus",
    "`menus?.find(…)` memilih menu DASAR untuk varian; `.komponen.length ?? 0 > 0` cuma memutuskan apakah form kemasan ditampilkan — tak ada jumlah yang dibaca orang",
  ],
  [
    "pages/produksi/FakturFormPage.tsx:resepRingkas",
    "`(resepRingkas[b.id] ?? 0) > 0` menyaring bahan mana yang layak ditawarkan di picker — daftar pilihan, kelas yang memang dikecualikan di atas",
  ],
  [
    "pages/resep/ResepPage.tsx:ringkas",
    "`const n = ringkas ? (ringkas[b.id] ?? 0) : null` — SUDAH membedakan 'belum tahu' dari nol, dan merender `null` apa adanya. Justru contoh bentuk yang benar",
  ],
]);

describe("daftar kosong tak pernah mengaku kosong saat pemuatannya gagal", () => {
  it("penyapunya benar-benar menemukan kueri (bukan hijau karena buta)", () => {
    // Tanpa patokan ini, regex yang berhenti cocok akan membuat uji di bawah
    // lulus dengan daftar kosong — penjaga yang tak menjaga apa pun.
    expect(situs.length, "tak satu pun `useQuery` terbaca").toBeGreaterThan(150);
    expect(new Set(situs.map((k) => k.berkas)).size).toBeGreaterThan(20);
    expect(peta.get("GALAT") ?? 0, "kelas GALAT kosong — pemindainya rusak").toBeGreaterThan(50);
  });

  it("INTI kalimat: keadaan-kosong ber-kalimat selalu membaca galatnya", () => {
    const lalai = situs
      .filter((k) => k.kelas === "KALIMAT")
      .map((k) => `${k.berkas}:${k.baris}`);
    expect(
      lalai,
      "kueri di atas memakai `?? []` untuk keadaan-kosong tapi tak pernah membaca `error` — " +
        "layar akan mengaku 'belum ada' padahal cuma gagal dimuat",
    ).toEqual([]);
  });

  it("INTI angka: lencana & jumlah yang gagal dimuat tak boleh terbaca NOL", () => {
    /*
     * Bentuk ketiga. Pengecualian "daftar pilihan" tak berlaku di sini:
     * lencana yang lenyap MENGKLAIM "tidak ada yang menunggu", dan terukur
     * begitulah `Layout.tsx` berperilaku sebelum vena ini.
     */
    const asing = situs
      .filter((k) => k.kelas === "ANGKA")
      .map((k) => `${k.berkas}:${k.data}`)
      .filter((k) => !ANGKA_INTERNAL.has(k));
    expect(
      asing,
      `hasil kueri diruntuhkan jadi ANGKA yang dirender, tanpa pernah membaca galatnya:\n${asing.join("\n")}`,
    ).toEqual([]);
  });

  it("daftar internal ditagih dua arah", () => {
    const ada = new Set(
      situs.filter((k) => k.kelas === "ANGKA").map((k) => `${k.berkas}:${k.data}`),
    );
    const usang = [...ANGKA_INTERNAL.keys()].filter((k) => !ada.has(k));
    expect(usang, `entri sudah membaca galatnya — hapus: ${usang.join(", ")}`).toEqual([]);
  });

  it("KENAIKAN INSTRUMEN tak melonggarkan: vonis aturan REGEX lama tereproduksi", () => {
    /*
     * Aturan lama dipertahankan sebagai fungsi (`kalimatLama`) dan dijalankan
     * ulang di sini. Ia harus tetap menemukan NOL — sama seperti sebelum
     * putaran ini. Kalau suatu saat ia menemukan sesuatu yang mesin AST
     * lewatkan, yang baru itulah yang salah.
     */
    const lama = situs
      .filter((k) => k.data && k.kelas !== "GALAT")
      .filter((k) => kalimatLama(k.data!, readFileSync(WEB + k.berkas, "utf8")))
      .map((k) => `${k.berkas}:${k.baris}`);
    expect(lama, "aturan lama menemukan yang baru lewatkan").toEqual([]);
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

describe("BUKTI MERAH: gerbangnya benar-benar bisa menuduh", () => {
  const sapu = (isi: string) => situsKueriWeb([{ nama: "palsu/Palsu.tsx", isi }]);

  it("kueri baru yang dirender sebagai JUMLAH → ANGKA", () => {
    const k = sapu(
      'function P() { const { data: rows } = useQuery({}); return <b>{(rows ?? []).length}</b>; }',
    );
    expect(k).toHaveLength(1);
    expect(k[0].kelas).toBe("ANGKA");
  });

  it("bentuk `const q = useQuery(…)` — yang mesin REGEX lama buta padanya", () => {
    const k = sapu('function P() { const q = useQuery({}); return <b>{(q ?? []).length}</b>; }');
    expect(k, "bentuk non-destructuring tak terbaca — populasinya menyusut diam-diam").toHaveLength(
      1,
    );
    expect(k[0].kelas).toBe("ANGKA");
  });

  it("koalesens pada PROPERTI — bentuk yang aturan lama lewatkan", () => {
    const k = sapu(
      'function P() { const { data: r } = useQuery({}); return <div>{(r?.rows ?? []).length === 0 ? "Belum ada apa-apa." : null}</div>; }',
    );
    expect(k[0]?.kelas).toBe("KALIMAT");
    // …dan aturan LAMA memang tak melihatnya — itulah batas yang dicabut.
    expect(kalimatLama("r", 'const { data: r } = useQuery({}); (r?.rows ?? []).length === 0')).toBe(
      false,
    );
  });

  it("PASANGAN: membaca galatnya → GALAT, dan daftar PILIHAN tetap dikecualikan", () => {
    expect(
      sapu('function P() { const { data: rows, error } = useQuery({}); return <b>{(rows ?? []).length}{String(error)}</b>; }')[0]
        ?.kelas,
    ).toBe("GALAT");
    // Dropdown: kosongnya tak mengklaim apa pun — pengecualian yang TETAP.
    expect(
      sapu('function P() { const { data: rows } = useQuery({}); return <select>{(rows ?? []).map((r) => <option/>)}</select>; }')[0]
        ?.kelas,
    ).toBe("PILIHAN");
  });

  it("PASANGAN: angka yang TAK sampai ke layar bukan tuduhan", () => {
    // Kalibrasi yang mencabut tiga tuduhan palsu (`SatuanSelect`, `ResepPage`,
    // `StokAwalPage`): hitungan internal tak dibaca siapa pun.
    const k = sapu(
      'function P() { const { data: rows } = useQuery({}); const n = (rows ?? []).length; if (n > 0) pakai(); return <hr/>; }',
    );
    expect(k[0]?.kelas).not.toBe("ANGKA");
  });
});
