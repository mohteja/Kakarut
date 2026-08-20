/**
 * JUDUL TAB per halaman.
 *
 * Seluruh aplikasi dulu memakai satu judul statis dari `index.html`
 * ("Terakasir"), jadi tiap tab terlihat sama persis. Pemilik yang membuka
 * Laporan, Stok, dan Kasir sekaligus — hal biasa — tak bisa membedakan
 * ketiganya selain dengan mengklik satu per satu. Riwayat peramban dan hasil
 * pencarian tab pun tak berguna karena semuanya bernama sama.
 *
 * Bentuknya "<Halaman> | <Perusahaan>", mengikuti kebiasaan web: yang paling
 * membedakan didahulukan, karena tab yang sempit memotong dari kanan. Nama
 * perusahaan dipakai, bukan nama aplikasi, sebab satu orang bisa memegang lebih
 * dari satu tenant di peramban yang sama.
 *
 * Label sengaja disamakan dengan tulisan di sidebar: judul tab yang tak sama
 * dengan menu yang diklik justru menambah beban, bukan menguranginya.
 */
import { matchPath } from "react-router-dom";

/** Dipakai saat belum ada perusahaan (halaman publik & layar auth). */
export const NAMA_APLIKASI = "Terakasir";

/**
 * Pola rute → judul. Kuncinya DITULIS PERSIS seperti `path` di `App.tsx`;
 * `judul-halaman.test.ts` membandingkan kedua daftar itu, jadi rute baru yang
 * lupa diberi judul akan ketahuan sebagai uji merah, bukan sebagai tab tanpa
 * nama yang tak ada yang melapor.
 */
export const JUDUL_RUTE: Record<string, string> = {
  // Publik & auth — di App.tsx dilayani lewat perbandingan `pathname`, bukan <Route>.
  "/tentang": "Tentang",
  "/privasi": "Kebijakan Privasi",
  "/syarat": "Syarat & Ketentuan",
  "/kontak": "Kontak",
  "/bantuan": "Bantuan",
  "/verifikasi-email": "Verifikasi Email",
  "/login": "Masuk",
  "/daftar": "Daftar",
  "/lupa-password": "Lupa Password",
  "/reset-password": "Atur Ulang Password",
  "/onboarding": "Persiapan Akun",

  // Beranda & laporan
  "/dashboard": "Beranda",
  "/beranda": "Beranda",
  "/laporan": "Laporan",
  "/laporan/pembelian": "Laporan Pembelian",
  "/laporan/menu-laris": "Menu Terlaris",
  "/laporan/durasi-pesanan": "Lama Pesanan",

  // Absen & kebersihan
  "/absen": "Absen",
  "/rekap-absen": "Rekap Absen",
  "/kebersihan": "Laporan Kebersihan",
  "/rekap-kebersihan": "Rekap Kebersihan",
  "/profil": "Profil Saya",

  // Kasir & pesanan
  "/kasir": "Kasir",
  "/kasir/riwayat": "Riwayat Transaksi",
  "/kasir/tutup": "Tutup Kasir",
  "/pesanan": "Pesanan Masuk",
  "/member": "Member",

  // Menu
  "/menu": "Menu",
  "/menu/lihat": "Lihat Menu",
  "/menu/baru": "Menu Baru",
  "/menu/:id/edit": "Ubah Menu",
  "/menu/analisis": "Analisis Harga",

  // Stok
  "/stok": "Stok",
  "/stok/awal": "Stok Awal",
  "/stok/opname": "Opname Bahan Baku",
  "/stok/opname-perlengkapan": "Opname Perlengkapan",
  "/stok/opname/riwayat": "Riwayat Opname",
  "/stok/kartu/:ingredientId": "Kartu Stok",
  "/stok/tambah-dari-menu": "Tambah Stok dari Menu",
  "/penerimaan": "Penerimaan Barang",
  "/transfer-stok": "Transfer Stok",
  "/permintaan-stok": "Permintaan Stok",
  "/sampah": "Tempat Sampah",

  // Bahan, resep, produksi & pembelian
  "/bahan": "Bahan Baku",
  "/bahan/baru": "Tambah Bahan Baku",
  "/bahan/ubah": "Ubah Bahan Baku",
  "/bahan/:id": "Detail Bahan",
  "/resep": "Resep",
  "/produksi": "Produksi Bahan Baku",
  "/produksi/baru": "Faktur Produksi",
  "/produksi/tahap": "Tahap Produksi",
  "/pembelian": "Beli Bahan Baku",
  "/pembelian/baru": "Faktur Pembelian",
  "/pembelian/tahap": "Tahap Pembelian",
  "/pembelian/rekomendasi": "Rekomendasi Beli",
  "/perlengkapan": "Perlengkapan",
  "/perlengkapan/beli": "Beli Perlengkapan",
  "/operasional": "Operasional Cabang",

  // Pengaturan
  "/pengaturan/perusahaan": "Pengaturan Perusahaan",
  "/pengaturan/cabang": "Cabang",
  "/pengaturan/karyawan": "Karyawan",
  "/pengaturan/supplier": "Supplier",
  "/pengaturan/supplier/:id": "Kartu Supplier",
  "/pengaturan/penyimpanan": "Tempat Penyimpanan",
  "/pengaturan/satuan": "Satuan",
  "/pengaturan/printer": "Printer",
  "/pengaturan/meja": "Meja",

  // Super admin (platform)
  "/superadmin": "Tenant",
  "/superadmin/sistem": "Sistem",
  "/superadmin/backup": "Cadangan",
  "/superadmin/error-log": "Log Galat",
  "/superadmin/email": "Pengaturan Email",
};

/** Pola ber-parameter, dicoba HANYA setelah pencocokan persis gagal. */
const POLA_DINAMIS = Object.keys(JUDUL_RUTE).filter((p) => p.includes(":"));

/**
 * Judul halaman untuk sebuah pathname, atau null bila rutenya tak dikenal
 * (mis. `/` yang selalu dialihkan, atau URL asing yang jatuh ke `*`).
 *
 * Cocok-persis didahulukan dengan sengaja: `/bahan/baru` dan `/bahan/:id`
 * dua-duanya cocok untuk URL itu, dan yang harfiah selalu yang benar.
 */
export function judulHalaman(pathname: string): string | null {
  const rapi = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const persis = JUDUL_RUTE[rapi];
  if (persis) return persis;
  for (const pola of POLA_DINAMIS) {
    if (matchPath({ path: pola, end: true }, rapi)) return JUDUL_RUTE[pola];
  }
  return null;
}

/**
 * Isi `document.title`. Halaman yang tak dikenal memulangkan nama perusahaan
 * saja (atau nama aplikasi) — lebih baik daripada judul "undefined" atau
 * tab yang mendadak kehilangan identitasnya di tengah navigasi.
 */
export function judulDokumen(pathname: string, perusahaan?: string | null): string {
  const pemilik = perusahaan?.trim() || NAMA_APLIKASI;
  const halaman = judulHalaman(pathname);
  return halaman ? `${halaman} | ${pemilik}` : pemilik;
}
