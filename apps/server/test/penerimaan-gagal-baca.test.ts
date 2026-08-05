import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga KLAIM TENTANG BARANG YANG SUDAH SAMPAI.
 *
 * Bagian terakhir dari peta 53. Tiga bacaan lagi yang kosongnya MENGKLAIM:
 *
 *  - `PenerimaanPage` → "Tidak ada kiriman yang menunggu penerimaan."
 *    Ini tentang barang yang SUDAH ADA DI PINTU. Petugas menyimpulkan tak ada
 *    yang datang dan tak memeriksa; barangnya menganggur tak diterima dan stok
 *    cabang tak pernah bertambah. Persis keadaan yang `PanelMenggantung` di
 *    halaman yang sama dibuat untuk menemukan — hanya saja kali ini panel itu
 *    pun tak punya apa-apa untuk ditemukan.
 *
 *  - `PenerimaanPage` riwayat → "Belum ada kiriman yang pernah diterima atau
 *    ditolak." Kalimat ini sudah pernah muncul keliru sekali lewat jalur lain
 *    (halaman 2 yang kosong sesudah ganti cabang; komentarnya masih ada di
 *    berkasnya). Bacaan gagal adalah cara KEDUA ia jadi bohong — dan yang ini
 *    tak sembuh sendiri.
 *
 *  - `StokPerlengkapanTab` → "Belum ada perlengkapan — daftarkan item di
 *    Manajemen → Perlengkapan." Menyatakan cabang tak punya perlengkapan, lalu
 *    menyuruh mendaftarkan ulang yang sudah terdaftar.
 */
const web = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../web/src/${p}`, import.meta.url)), "utf8");

const TERIMA = web("pages/produksi/PenerimaanPage.tsx");
const PERLENGKAPAN = web("pages/stok/StokPerlengkapanTab.tsx");

/**
 * Kemunculan TERAKHIR sebuah kalimat klaim, dengan jumlahnya dipatok.
 *
 * Jumlahnya berbeda-beda dan itu disengaja: komentar `StokPerlengkapanTab`
 * mengutip kalimatnya utuh (2×), sedangkan komentar di `PenerimaanPage`
 * mengutip tanpa titik penutup (1×). Mematoknya membuat penghapusan kalimat
 * di JSX tak bisa lolos dengan diam-diam bersandar pada kutipan di komentar.
 */
function letakKlaim(isi: string, kalimat: string, jumlahDiharap: number): number {
  const jumlah = isi.split(kalimat).length - 1;
  expect(jumlah, `"${kalimat}" muncul ${jumlah}×`).toBe(jumlahDiharap);
  return isi.lastIndexOf(kalimat);
}

describe("Penerimaan: 'tidak ada kiriman' hanya untuk daftar yang terbaca", () => {
  it("galatnya ditangkap", () => {
    expect(TERIMA).toContain("const { data, isLoading, error: gagalMuat } = useQuery({");
  });

  it("diperiksa SEBELUM halaman dirender", () => {
    const iGagal = TERIMA.indexOf("  if (gagalMuat) {");
    const iKlaim = letakKlaim(TERIMA, "Tidak ada kiriman yang menunggu penerimaan.", 1);
    expect(iGagal).toBeGreaterThan(0);
    expect(iKlaim).toBeGreaterThan(iGagal);
  });

  it("dan menyangkal kesimpulannya, bukan cuma diam", () => {
    expect(TERIMA).toContain("bukan</b> berarti tak ada barang yang menunggu diterima");
    expect(TERIMA).toContain("stok cabang tak pernah bertambah");
  });

  it("pemilih cabang & judul tetap tampil saat galat", () => {
    // Tanpa keduanya, layar galat jadi buntu: dari Kantor orang tak bisa
    // pindah cabang untuk memeriksa apakah masalahnya cuma satu cabang.
    //
    // DIHITUNG, bukan diiris. Percobaan pertama mengiris 1200 karakter dari
    // `if (gagalMuat) {` — dan lolos meski keduanya dicabut dari blok galat,
    // karena jendelanya meluber ke render normal yang memuat string yang sama
    // persis. Menghitung kemunculan tak punya batas untuk dilanggar.
    for (const tag of ["<CabangDataBar />", "<PageTitle>Penerimaan Barang</PageTitle>"]) {
      const jumlah = TERIMA.split(tag).length - 1;
      expect(jumlah, `${tag} harus ada di blok galat DAN render normal`).toBe(2);
    }
  });
});

describe("Penerimaan: riwayat", () => {
  it("galatnya ditangkap dan diperiksa sebelum klaim 'belum ada'", () => {
    expect(TERIMA).toContain("error: gagalRiwayat");
    const iGagal = TERIMA.indexOf("      ) : gagalRiwayat ? (");
    const iKlaim = letakKlaim(TERIMA, "Belum ada kiriman yang pernah diterima atau ditolak.", 1);
    expect(iGagal).toBeGreaterThan(0);
    expect(iKlaim).toBeGreaterThan(iGagal);
  });

  it("penjaga LAMA untuk kalimat yang sama tetap ada", () => {
    // `setPage(1)` saat ganti cabang — jalur pertama kalimat itu jadi bohong.
    // Kalau ia hilang, kalimatnya kembali bisa muncul keliru tanpa galat
    // apa pun, dan penjaga baru di atas tak akan menyadarinya.
    expect(TERIMA).toContain("setPage(1);");
    expect(TERIMA).toContain("}, [branchQuery]);");
  });
});

describe("Stok perlengkapan", () => {
  it("galatnya ditangkap dan diperiksa sebelum tabel", () => {
    expect(PERLENGKAPAN).toContain("error: gagalRows");
    const iGagal = PERLENGKAPAN.indexOf("      ) : gagalRows ? (");
    const iKlaim = letakKlaim(
      PERLENGKAPAN,
      "Belum ada perlengkapan — daftarkan item di Manajemen → Perlengkapan",
      2,
    );
    expect(iGagal).toBeGreaterThan(0);
    expect(iKlaim).toBeGreaterThan(iGagal);
  });

  it("dan melarang mendaftarkan ulang sebelum daftarnya terbaca", () => {
    expect(PERLENGKAPAN).toContain("jangan mendaftarkan");
  });
});

describe("keadaan kosong yang SAH tetap utuh di ketiganya", () => {
  it("penerimaan", () => {
    expect(TERIMA).toContain("Tidak ada kiriman yang menunggu penerimaan.");
    expect(TERIMA).toContain("Belum ada kiriman yang pernah diterima atau ditolak.");
  });

  it("perlengkapan", () => {
    expect(PERLENGKAPAN).toContain("Belum ada perlengkapan — daftarkan item di Manajemen");
  });

  it("spinner pemuatan tetap dibedakan dari galat", () => {
    expect(TERIMA).toContain("  if (isLoading) return <Spinner />;");
    expect(PERLENGKAPAN).toContain("      {isLoading ? (\n        <Spinner />\n      ) : gagalRows ? (");
  });
});
