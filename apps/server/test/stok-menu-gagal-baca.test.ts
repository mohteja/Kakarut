import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga STOK MENU — bacaan yang gagal tak boleh berkata "tak terbatas".
 *
 * Tab Bahan di berkas yang SAMA sudah menjaga kaidah ini sejak lama, lengkap
 * dengan komentarnya ("GAGAL MEMUAT ≠ TIDAK ADA BAHAN"). Tab Stok Menu dan
 * spanduk kedaluwarsa tertinggal — bukan beda pendapat, melainkan satu berkas
 * yang tak konsisten dengan aturan yang sudah ditulisnya sendiri.
 *
 * Di tab Menu bentuk bohongnya lebih parah dari layar kosong. Dua permintaan
 * BERBEDA menyusun tabelnya:
 *
 *     GET /menu               → daftar menunya
 *     GET /menu/ketersediaan  → sisa porsi per menu (agregat, yang mahal)
 *
 * Gagalnya yang kedua saja sudah cukup, dan justru itu yang paling mungkin
 * gagal duluan. Porsi yang tak ketemu jatuh ke `null` — dan `null` di kolom
 * ini SUDAH punya arti lain: "menu ini tak dibatasi bahan apa pun", yang
 * dirender **∞** dengan status **tak terbatas**.
 *
 * Jadi layar yang gagal membaca stok justru menyatakan setiap menu bisa
 * dijual tanpa batas: bacaan paling menenangkan yang mungkin, tepat ketika ia
 * tak tahu apa-apa. Kasir yang mengeceknya sebelum buka lapak menyimpulkan
 * semua aman, lalu menerima pesanan yang bahannya sudah habis.
 *
 * Spanduk exp punya bentuk yang sama tapi lebih sunyi: gagal → `expLots` jadi
 * `[]` → spanduknya HILANG sama sekali, dan hilangnya spanduk itu sendiri
 * sebuah pernyataan ("tak ada yang mau kedaluwarsa").
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/stok/StokPage.tsx", import.meta.url)),
  "utf8",
);

describe("galat tiap query benar-benar diambil, bukan dibuang", () => {
  it("`/menu` dan `/menu/ketersediaan` punya nama galatnya sendiri", () => {
    // `data: x = []` tanpa `error` adalah bentuk yang membuang kegagalan
    // diam-diam — dua query ini dulu persis begitu.
    expect(HAL).toContain("const { data: ketersediaan = [], error: porsiGagal } = useQuery({");
    expect(HAL).toContain("const { data: menus = [], error: menuGagal } = useQuery({");
  });

  it("begitu juga peringatan kedaluwarsa", () => {
    expect(HAL).toContain("const { data: expLots = [], error: expGagal } = useQuery({");
  });
});

describe("sisa porsi: `?` saat tak terbaca, `∞` hanya bila memang tak dibatasi", () => {
  it("`porsiGagal` diperiksa SEBELUM jatuh ke `∞`", () => {
    expect(HAL).toContain('{porsiGagal ? "?" : porsi == null ? "∞" : formatAngka(porsi)}');
  });

  it("kolom Status tak lagi memberi lencana 'tak terbatas' saat gagal", () => {
    const i = HAL.indexOf('judul: "Status",');
    const blok = HAL.slice(i, i + 700);
    expect(i, "kolom Status tak ditemukan").toBeGreaterThan(0);
    // penjaganya harus mendahului perhitungan status, bukan sesudahnya
    const iGagal = blok.indexOf("if (porsiGagal)");
    const iBadge = blok.indexOf("<StatusBadge status={status} />");
    expect(iGagal).toBeGreaterThan(0);
    expect(iBadge).toBeGreaterThan(iGagal);
    expect(blok).toContain("tak terbaca");
  });

  it("bahan pembatas juga tak mengarang 'tidak dibatasi bahan'", () => {
    const i = HAL.indexOf('judul: "Bahan Pembatas",');
    const blok = HAL.slice(i, i + 400);
    expect(i).toBeGreaterThan(0);
    expect(blok).toContain("porsiGagal ? (");
    expect(blok).toContain("tidak terbaca");
  });

  it("`∞` TETAP ADA untuk maknanya yang sah — ini bukan penghapusan fitur", () => {
    // Menu tanpa satu pun bahan berlacak stok memang tak terbatas; kalau
    // penjaganya sampai menelan kasus itu, tabelnya jadi salah ke arah lain.
    expect(HAL).toContain('porsi == null ? "∞"');
    expect(HAL).toContain("tidak dibatasi bahan");
  });
});

describe("kartu peringatan muncul sebelum tabelnya, bukan sesudah", () => {
  it("gagal memuat menu: kosongnya tak lagi berbunyi 'Belum ada menu aktif'", () => {
    expect(HAL).toContain('menuGagal\n                ? "Data tidak dapat dimuat — bukan berarti kosong."');
    // kalimat lamanya tetap ada, tapi kini hanya untuk kosong yang SUNGGUHAN
    expect(HAL).toContain('"Belum ada menu aktif."');
  });

  // Frasa yang dipatok WAJIB utuh dalam satu baris sumber: JSX membungkus
  // kalimat panjang dan menyelipkan `<b>`, jadi kalimat yang dibaca manusia
  // sebagai satu potong sering tidak ada sebagai substring. Ini kejadian
  // KEEMPAT di repo ini (ronde 55, 75, 87, 96) — patok potongan pendek.
  it("kartu porsi gagal menyebut akibatnya, bukan cuma pesan galat", () => {
    expect(HAL).toContain("Sisa porsi tidak bisa dihitung");
    expect(HAL).toContain("terlihat bisa dijual sampai halaman ini");
  });

  it("kartu porsi tak menumpuk di atas kartu menu gagal", () => {
    // Kalau /menu gagal, /menu/ketersediaan hampir pasti ikut gagal; dua
    // kartu merah bertumpuk untuk satu sebab hanya jadi bising.
    expect(HAL).toContain("{!menuGagal && porsiGagal && (");
  });

  it("gagal exp disebut, sebab hilangnya spanduk itu sendiri sebuah klaim", () => {
    expect(HAL).toContain("{expGagal && (");
    expect(HAL).toContain("Peringatan kedaluwarsa tidak bisa dimuat");
    expect(HAL).toContain("berarti tak ada bahan yang");
  });
});

describe("sifat tab Bahan yang sudah benar — jangan sampai ikut hilang", () => {
  it("kartu `stokGagal` & kosong yang jujur tetap ada", () => {
    expect(HAL).toContain("{stokGagal && (");
    expect(HAL).toContain('stokGagal\n            ? "Data tidak dapat dimuat — bukan berarti kosong."');
  });

  it("dan komentar kaidahnya tetap tertulis", () => {
    expect(HAL).toContain("GAGAL MEMUAT ≠ TIDAK ADA BAHAN");
  });
});
