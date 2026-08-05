import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga KLAIM STOK YANG LAHIR DARI BACAAN GAGAL.
 *
 * Sapuan seluruh web menemukan 53 tempat yang memakai `data = []` /
 * `isLoading` tanpa menangkap `error`. Sebagian besar tak berbahaya —
 * daftar pilihan yang kosongnya cuma bikin dropdown sepi. Yang dijaga di
 * berkas ini adalah yang KOSONGNYA MENGKLAIM SESUATU TENTANG STOK, karena
 * di situ layar tak sekadar sepi: ia berbohong, dan orang menuruti
 * bohongnya.
 *
 *  - `OpnamePage` (penghitungan stok fisik)
 *      "Belum ada tempat penyimpanan yang bisa Anda opname."  ← rak tak terbaca
 *      "Tidak ada bahan di lokasi ini."                       ← stok tak terbaca
 *    Keduanya menyuruh petugas pulang. Hitungan hari itu tak pernah terjadi,
 *    dan tak ada satu tanda pun — di layar maupun di riwayat.
 *
 *  - `TransferStokPage` (kirim stok antar cabang)
 *      "Tidak ada stok siap kirim di X — isi stok dulu (produksi, pembelian,
 *       atau stok awal)."
 *    Dua kesalahan sekaligus: menyatakan cabang asal tak punya stok, lalu
 *    menyuruh memproduksi/membeli barang yang sebenarnya ADA di rak.
 */
const web = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../web/src/${p}`, import.meta.url)), "utf8");

const OPNAME = web("pages/stok/OpnamePage.tsx");
const TRANSFER = web("pages/stok/TransferStokPage.tsx");

/**
 * Kedua kalimat klaim itu muncul DUA kali di `OpnamePage`: sekali dikutip di
 * komentar yang menerangkan cacatnya, sekali sungguhan di JSX. `indexOf`
 * menemukan yang di komentar — yang letaknya jauh di ATAS gerbang — sehingga
 * uji urutan lolos/gagal karena alasan yang salah. Jadi yang dipakai
 * kemunculan TERAKHIR, dan jumlahnya ikut dipatok supaya menghapus salah satu
 * tak lolos begitu saja.
 */
function letakKlaim(isi: string, kalimat: string): number {
  const jumlah = isi.split(kalimat).length - 1;
  expect(jumlah, `"${kalimat}" harus muncul 2× (komentar + JSX)`).toBe(2);
  return isi.lastIndexOf(kalimat);
}

describe("Opname: rak & stok yang tak terbaca tak boleh jadi 'tidak ada'", () => {
  it("kedua bacaan menangkap galatnya", () => {
    expect(OPNAME).toContain("error: gagalStok");
    expect(OPNAME).toContain("error: gagalTempat");
    expect(OPNAME).toContain("const gagalMuat = gagalStok ?? gagalTempat;");
  });

  it("langkah pilih-lokasi tertahan selama bacaannya gagal", () => {
    expect(OPNAME).toContain('{langkah === "lokasi" && (memuat || gagalMuat) && (');
    expect(OPNAME).toContain('{langkah === "lokasi" && !memuat && !gagalMuat && (');
    expect(OPNAME).toContain('<SpinnerAtauGalat error={gagalMuat} apa="Daftar rak & stok cabang" />');
  });

  it("klaim 'belum ada tempat' hanya untuk data yang BENAR-BENAR terbaca", () => {
    const iGate = OPNAME.indexOf('{langkah === "lokasi" && !memuat && !gagalMuat && (');
    const iKlaim = letakKlaim(OPNAME, "Belum ada tempat penyimpanan yang bisa Anda opname.");
    expect(iGate).toBeGreaterThan(0);
    expect(iKlaim).toBeGreaterThan(iGate);
  });

  it("klaim 'tidak ada bahan di lokasi ini' juga di belakang gerbang itu", () => {
    // Langkah 2 hanya bisa dicapai lewat langkah 1, jadi satu gerbang cukup —
    // dan urutan inilah yang membuktikannya.
    const iGate = OPNAME.indexOf('{langkah === "lokasi" && !memuat && !gagalMuat && (');
    const iKlaim = letakKlaim(OPNAME, "Tidak ada bahan di lokasi ini.");
    expect(iKlaim).toBeGreaterThan(iGate);
  });

  it("keadaan kosong yang SAH tetap ada — bukan dihapus", () => {
    expect(OPNAME).toContain("Belum ada tempat penyimpanan yang bisa Anda opname.");
    expect(OPNAME).toContain("Tidak ada bahan di lokasi ini.");
  });

  it("sebabnya ditulis, supaya `memuat` tak dikembalikan sendirian", () => {
    expect(OPNAME).toContain("KOSONG ≠ TAK TERBACA");
    expect(OPNAME).toContain("Ini layar penghitungan stok fisik.");
  });
});

describe("Transfer stok: 'tidak ada stok siap kirim' adalah klaim, bukan bawaan", () => {
  it("galat saldo ditangkap", () => {
    expect(TRANSFER).toContain("error: gagalSaldo");
  });

  it("galat diperiksa SEBELUM kalimat 'isi stok dulu'", () => {
    const iGagal = TRANSFER.indexOf("          ) : gagalSaldo ? (");
    const iKlaim = TRANSFER.indexOf("Tidak ada stok siap kirim di");
    expect(iGagal).toBeGreaterThan(0);
    expect(iKlaim).toBeGreaterThan(iGagal);
  });

  it("dan yang tampil menyangkal kesimpulan 'kosong'", () => {
    expect(TRANSFER).toContain("<b>tidak terbaca</b>");
    expect(TRANSFER).toContain("bukan</b> berarti stoknya kosong");
    expect(TRANSFER).toContain("<ErrorText error={gagalSaldo} />");
  });

  it("dan menjelaskan kenapa pemilih bahannya ikut kosong", () => {
    // Tanpa kalimat ini, dropdown yang sepi tetap jadi bukti palsu bahwa
    // raknya memang kosong.
    expect(TRANSFER).toContain("bukan karena raknya kosong");
  });

  it("keadaan kosong yang SAH tetap utuh", () => {
    // Frasanya terpotong baris di JSX ("…(produksi,\n pembelian, atau stok
    // awal)."), jadi yang diperiksa penggalan yang benar-benar utuh.
    expect(TRANSFER).toContain("Tidak ada stok siap kirim di {namaCabang(asalId)}");
    expect(TRANSFER).toContain("pembelian, atau stok awal)");
  });

  it("spinner saat memuat tetap dibedakan dari galat", () => {
    // Arah sebaliknya: kalau `saldoLoading` ikut dilipat ke cabang galat,
    // pemuatan biasa akan tampil sebagai kegagalan.
    expect(TRANSFER).toContain("{saldoLoading ? (");
  });
});
