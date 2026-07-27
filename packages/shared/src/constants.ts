/** Ambang "Menipis": saldo / (stok awal + produksi) < 15% */
export const STOK_MENIPIS_THRESHOLD = 0.15;

/** Tarif PB1 (pajak restoran) default dalam persen */
export const DEFAULT_PB1_RATE = 10;

/**
 * Panduan markup per jenis kategori (persen) — hanya panduan saat membuat
 * menu baru; menu yang sudah ada memakai `mult` tersimpan.
 */
export const PANDUAN_MARKUP: { kategori: string; persen: string; keterangan: string }[] = [
  { kategori: "Food set", persen: "100", keterangan: "Paket makanan (HPP × 2)" },
  { kategori: "Menu baru (food)", persen: "100", keterangan: "HPP × 2" },
  { kategori: "Minuman segar", persen: "150–175", keterangan: "HPP × 2.5–2.75" },
  { kategori: "Teh", persen: "150", keterangan: "HPP × 2.5" },
  { kategori: "Frozen / dessert", persen: "100–150", keterangan: "HPP × 2–2.5" },
  { kategori: "Yamin satuan", persen: "200", keterangan: "HPP × 3" },
  { kategori: "Side dish", persen: "250–350", keterangan: "HPP × 3.5–4.5" },
  { kategori: "Oseng", persen: "0", keterangan: "Tanpa markup" },
  { kategori: "Paket yamin", persen: "0", keterangan: "Rumus khusus (topping tanpa markup)" },
];

export type StokStatus = "habis" | "menipis" | "aman";
export type UserRole = "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";
export type MenuTipe = "regular" | "paket";
/**
 * Kategori bahan = teks bebas dari master `ingredient_categories` (bisa
 * ditambah owner). "baso"/"minuman"/"lain" hanya nilai bawaan.
 */
export type BahanKategori = string;
/** jalur pengadaan bahan baku: diproduksi sendiri vs dibeli jadi */
export type JenisPengadaan = "produksi" | "beli";
/**
 * Lokasi produksi bahan jalur "produksi": diproduksi di Central Kitchen (lalu
 * dikirim ke cabang) atau langsung di cabang store (kitchen ATAU bar toko,
 * sesuai `divisi_produksi` — hasil masuk stok cabang itu). Hanya bermakna
 * untuk pengadaan "produksi".
 */
export type ProduksiDi = "ck" | "cabang";
/**
 * Divisi pelaksana resep saat produksi_di="cabang": role kitchen hanya boleh
 * memproduksi resep divisi "kitchen", role bar hanya divisi "bar". Diabaikan
 * saat produksi_di="ck".
 */
export type DivisiProduksi = "kitchen" | "bar";

/* ===== Pengajuan cuti & libur karyawan ===== */

/**
 * Dua jalur ketidakhadiran yang DISENGAJA. Dipisah karena artinya beda di
 * rekap: `cuti` = jatah/keperluan pribadi (dihitung tersendiri untuk melihat
 * pemakaian jatah), `libur` = hari tidak bekerja yang memang disepakati
 * (mingguan/tukar jadwal/tanggal merah). Keduanya sama-sama BUKAN alpa.
 */
export type PengajuanJenis = "cuti" | "libur";

export type PengajuanKategori =
  | "tahunan"
  | "sakit"
  | "izin"
  | "melahirkan"
  | "penting"
  | "mingguan"
  | "tukar_jadwal"
  | "tanggal_merah";

export type PengajuanStatus = "menunggu" | "disetujui" | "ditolak";

/**
 * SUMBER TUNGGAL kategori pengajuan — dipakai bersama oleh dropdown di web,
 * validasi zod di server, dan penurunan `jenis` dari `kategori`. Klien TIDAK
 * pernah mengirim `jenis`: server selalu menurunkannya dari sini, sehingga
 * mustahil ada baris "libur" berkategori "melahirkan".
 */
export const KATEGORI_PENGAJUAN: {
  kode: PengajuanKategori;
  jenis: PengajuanJenis;
  label: string;
  emoji: string;
}[] = [
  { kode: "tahunan", jenis: "cuti", label: "Cuti Tahunan", emoji: "🌴" },
  { kode: "sakit", jenis: "cuti", label: "Sakit", emoji: "🤒" },
  { kode: "izin", jenis: "cuti", label: "Izin", emoji: "📝" },
  { kode: "melahirkan", jenis: "cuti", label: "Melahirkan", emoji: "🍼" },
  { kode: "penting", jenis: "cuti", label: "Keperluan Penting", emoji: "🙏" },
  { kode: "mingguan", jenis: "libur", label: "Libur Mingguan", emoji: "🗓" },
  { kode: "tukar_jadwal", jenis: "libur", label: "Tukar Jadwal", emoji: "🔁" },
  { kode: "tanggal_merah", jenis: "libur", label: "Tanggal Merah", emoji: "🎉" },
];

/** Semua kode kategori — untuk `z.enum()` di server. */
export const KODE_KATEGORI_PENGAJUAN = KATEGORI_PENGAJUAN.map((k) => k.kode) as [
  PengajuanKategori,
  ...PengajuanKategori[],
];

/** Turunkan jenis (cuti/libur) dari kategori. Kategori tak dikenal → "cuti". */
export function jenisKategori(kode: PengajuanKategori): PengajuanJenis {
  return KATEGORI_PENGAJUAN.find((k) => k.kode === kode)?.jenis ?? "cuti";
}

/** Label tampilan kategori, mis. "🤒 Sakit". */
export function labelKategoriPengajuan(kode: PengajuanKategori): string {
  const k = KATEGORI_PENGAJUAN.find((x) => x.kode === kode);
  return k ? `${k.emoji} ${k.label}` : kode;
}
