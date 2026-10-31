/**
 * SEGMEN PERTAMA tiap rute web (`apps/web/src/App.tsx`) — dibaca server untuk
 * menjawab jalur yang TAK ADA dengan status 404 (bukan 200 + shell lalu
 * dilempar ke /login, laporan uji 31 Okt 2026), dan oleh web untuk
 * menampilkan halaman "tidak ditemukan".
 *
 * Dijaga `rute-web-terdaftar.test.ts`: rute baru di App.tsx yang segmennya tak
 * tercatat di sini membuat ujinya merah — kalau tidak, halaman baru itu akan
 * dijawab 404 oleh server.
 */
export const SEGMEN_RUTE_WEB: readonly string[] = [
  // publik
  "tentang",
  "privasi",
  "syarat",
  "kontak",
  "bantuan",
  "verifikasi-email",
  "login",
  "daftar",
  "lupa-password",
  "reset-password",
  // aplikasi
  "absen",
  "bahan",
  "beranda",
  "dashboard",
  "kasir",
  "kebersihan",
  "laporan",
  "member",
  "menu",
  "onboarding",
  "operasional",
  "pembelian",
  "penerimaan",
  "pengaturan",
  "perlengkapan",
  "permintaan-stok",
  "pesanan",
  "produksi",
  "profil",
  "rekap-absen",
  "rekap-kebersihan",
  "resep",
  "sampah",
  "stok",
  "superadmin",
  "transfer-stok",
];

const SET_SEGMEN = new Set(SEGMEN_RUTE_WEB);

/** Jalur ini rute web yang dikenal? `/` selalu dikenal. */
export function ruteWebDikenal(pathname: string): boolean {
  const seg = pathname.replace(/^\/+/, "").split(/[/?#]/)[0];
  return seg === "" || SET_SEGMEN.has(seg);
}
