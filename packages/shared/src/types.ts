import type {
  BahanKategori,
  JenisPengadaan,
  MenuTipe,
  StokStatus,
  UserRole,
} from "./constants";

/** Payload JWT / hasil login */
export interface AuthUser {
  sub: string;
  email: string;
  nama: string;
  is_super_admin: boolean;
  company_id: string | null;
  role: UserRole | null;
  branch_id: string | null;
}

export interface BahanDto {
  id: string;
  slug: string;
  nama: string;
  harga_beli: number;
  isi: number;
  /** satuan isi/gramasi: pcs, gr, ml, butir, porsi, dst */
  satuan: string;
  /** lacak stok: dipotong saat menjual, ditambah saat membeli/produksi */
  track_stok: boolean;
  harga_per_unit: number;
  kategori: BahanKategori;
  pengadaan: JenisPengadaan;
  catatan: string | null;
  is_packaging: boolean;
  is_complement: boolean;
  is_active: boolean;
}

export interface KomponenDto {
  ingredient_id: string;
  slug: string;
  nama: string;
  qty: number;
  satuan: string;
  track_stok: boolean;
  harga_per_unit: number;
  is_packaging: boolean;
  is_complement: boolean;
}

export interface MenuDto {
  id: string;
  nama: string;
  tipe: MenuTipe;
  category_id: string;
  kategori: string;
  mult: number | null;
  base_menu_id: string | null;
  base_menu_nama: string | null;
  base_mult: number | null;
  harga_jual: number;
  image_url: string | null;
  is_active: boolean;
  komponen: KomponenDto[];
  /** dihitung live */
  hpp: number;
  hpp_dine_in: number;
  harga_saran: number;
  harga_jual_bulat: number;
  food_cost_persen: number;
}

export interface StokRowDto {
  ingredient_id: string;
  slug: string;
  nama: string;
  kategori: BahanKategori;
  isi: number;
  satuan: string;
  /** tempat penyimpanan dari entri masuk terkonfirmasi terakhir */
  tempat: string | null;
  tempat_id: string | null;
  stok_awal: number;
  produksi: number;
  terpakai: number;
  saldo: number;
  status: StokStatus;
}

export interface SupplierDto {
  id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  catatan: string | null;
  is_active: boolean;
}

// ===== Rekomendasi pembelian dari target penjualan =====

export type AcuanJenis = "minggu_lalu" | "7hari" | "rentang";

/** Periode acuan yang dipakai memproyeksikan kebutuhan dari target penjualan. */
export interface AcuanPeriode {
  jenis: AcuanJenis;
  dari: string;
  sampai: string;
  /** omzet (Rp) pada periode acuan — penyebut skala */
  omzet: number;
  /** true bila hari-sama-minggu-lalu kosong lalu fallback ke rata-rata 7 hari */
  fallback: boolean;
}

export interface MenuTerlaris {
  menu_nama: string;
  qty: number;
  omzet: number;
}

export interface RekomendasiBahanRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  kategori: BahanKategori;
  pengadaan: JenisPengadaan;
  /** pemakaian hari ini (dari penjualan) */
  terpakai_hari_ini: number;
  /** stok tersisa saat ini */
  sisa: number;
  /** pemakaian pada periode acuan */
  acuan_qty: number;
  /** kebutuhan untuk mencapai target (null bila omzet acuan 0) */
  kebutuhan: number | null;
  /** maks(0, kebutuhan − sisa); null bila tak bisa dihitung */
  saran_beli: number | null;
  harga_per_unit: number;
  /** saran_beli × harga_per_unit */
  estimasi_biaya: number | null;
}

export interface RekomendasiBeli {
  /** target penjualan (Rp) yang dipakai */
  target: number;
  /** tanggal hari ini (tz perusahaan) */
  hari_ini: string;
  acuan: AcuanPeriode;
  menu_terlaris: MenuTerlaris[];
  bahan: RekomendasiBahanRow[];
}

/** Akun yang ditugaskan opname pada satu tempat penyimpanan. */
export interface PetugasRingkas {
  user_id: string;
  nama: string;
  role: UserRole;
}

export interface PenyimpananDto {
  id: string;
  branch_id: string;
  nama: string;
  catatan: string | null;
  is_active: boolean;
  /**
   * Petugas opname yang ditugaskan. Kosong = terbuka (siapa saja yang boleh
   * opname di cabang). Terisi = terkunci hanya untuk mereka (owner/admin bebas).
   */
  petugas: PetugasRingkas[];
}

export type PenyesuaianKategori =
  | "waste_bahan"
  | "waste_matang"
  | "waste_gagal"
  | "koreksi_pencatatan"
  | "lainnya";

/** Label + apakah dianggap waste, untuk UI klarifikasi penyesuaian stok. */
export const KLARIFIKASI_KATEGORI: {
  key: PenyesuaianKategori;
  label: string;
  keterangan: string;
  is_waste: boolean;
}[] = [
  {
    key: "waste_bahan",
    label: "Waste bahan",
    keterangan: "Bahan rusak/kadaluarsa, salah penyimpanan",
    is_waste: true,
  },
  {
    key: "waste_matang",
    label: "Waste sudah dimasak",
    keterangan: "Sudah dimasak tapi tidak terjual",
    is_waste: true,
  },
  {
    key: "waste_gagal",
    label: "Waste produk gagal",
    keterangan: "Gagal dibuat / kurang matang / diganti",
    is_waste: true,
  },
  {
    key: "koreksi_pencatatan",
    label: "Koreksi pencatatan",
    keterangan: "Bukan waste — salah hitung/input",
    is_waste: false,
  },
  { key: "lainnya", label: "Lainnya", keterangan: "Jelaskan di catatan", is_waste: false },
];

/** status persetujuan penyesuaian: menunggu owner/admin, lalu disetujui. */
export type PenyesuaianStatus = "menunggu" | "disetujui";

export interface PenyesuaianRow {
  id: string;
  waktu: string;
  bahan: string;
  satuan: string;
  system_qty: number | null;
  qty_fisik: number;
  selisih: number;
  klarifikasi_status: "belum" | "sudah";
  /** menunggu persetujuan owner/admin, atau sudah disetujui (stok disesuaikan) */
  penyesuaian_status: PenyesuaianStatus;
  kategori: PenyesuaianKategori | null;
  catatan: string | null;
  foto_url: string | null;
  /** alasan penolakan terakhir (bila dikembalikan untuk klarifikasi ulang) */
  tolak_alasan: string | null;
  /** karyawan yang input opname */
  oleh: string | null;
  /** karyawan yang mengklarifikasi */
  diklarifikasi_oleh: string | null;
  /** owner/admin yang menyetujui */
  disetujui_oleh: string | null;
}

export interface OpnameRingkasan {
  dihitung: number;
  cocok: number;
  lebih: number;
  kurang: number;
  total_selisih: number;
}

export interface OpnameSesiRow {
  session_id: string;
  waktu: string;
  oleh: string | null;
  jumlah_item: number;
  jumlah_selisih: number;
  catatan: string | null;
}

export interface OpnameSesiDetail {
  session_id: string;
  waktu: string;
  oleh: string | null;
  catatan: string | null;
  items: {
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number;
    selisih: number | null;
  }[];
}

export type MutasiJenis = "opname" | "produksi" | "beli" | "penjualan";

/** Satu baris kartu stok (buku besar mutasi per bahan). */
export interface MutasiStok {
  waktu: string;
  jenis: MutasiJenis;
  keterangan: string | null;
  masuk: number | null;
  keluar: number | null;
  /** saldo berjalan setelah mutasi ini */
  saldo: number;
}

export interface KartuStokDto {
  bahan: { id: string; nama: string; slug: string; satuan: string };
  periode: { dari: string; sampai: string };
  saldo_awal: number;
  saldo_akhir: number;
  total_masuk: number;
  total_keluar: number;
  /** true bila mutasi melebihi batas 500 baris (persempit periode) */
  terpotong: boolean;
  mutasi: MutasiStok[];
}

export interface SaleItemInput {
  menu_id: string;
  qty: number;
  /** override per baris; default mengikuti is_dine_in transaksi */
  is_dine_in?: boolean;
}

/** Baris riwayat transaksi kasir (untuk cek pesanan / cetak ulang struk). */
export interface RiwayatTransaksiRow {
  id: string;
  nomor: string;
  waktu: string;
  total: number;
  is_dine_in: boolean;
  /** jumlah baris menu pada transaksi */
  jumlah_item: number;
  kasir: string | null;
}

export interface LaporanHarian {
  tanggal: string;
  omzet: number;
  jumlah_transaksi: number;
  pb1_terkumpul: number;
  total_hpp: number;
  estimasi_profit: number;
  item_terjual: { menu_nama: string; qty: number; omzet: number }[];
  konsumsi_bahan: { nama: string; slug: string; qty: number }[];
}
