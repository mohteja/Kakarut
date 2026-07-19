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

/** Profil akun sendiri (semua peran): identitas + kode/QR absen. */
export interface ProfilDto {
  nama: string;
  email: string;
  role: UserRole | null;
  cabang: string | null;
  employee_code: string | null;
}

/** Satu entri riwayat kegiatan pada faktur (jejak ubah tahap). */
export interface FakturLogRow {
  id: string;
  aksi: string;
  detail: string | null;
  oleh: string | null;
  waktu: string;
}

/** Kegiatan seorang karyawan pada faktur — pelacakan per orang. */
export interface AktivitasRow {
  id: string;
  jalur: JenisPengadaan;
  aksi: string;
  detail: string | null;
  cabang: string | null;
  faktur_id: string;
  waktu: string;
}

export interface BahanDto {
  id: string;
  slug: string;
  /** kode produk ringkas (otomatis/manual); null utk bahan lama sebelum backfill */
  kode: string | null;
  nama: string;
  harga_beli: number;
  isi: number;
  /** satuan kerja/resep (stok, resep, konsumsi, HPP): pcs, gr, ml, butir, dst */
  satuan: string;
  /** satuan beli/pembelian (mis. "dus"); null = beli langsung dalam satuan */
  satuan_beli: string | null;
  /** lacak stok: dipotong saat menjual, ditambah saat membeli/produksi */
  track_stok: boolean;
  /** ambang batas stok minimum di CK/kantor (0 = pakai rasio default) */
  stok_minimum: number;
  /** ambang stok minimum khusus cabang toko (0 = ikut stok_minimum) */
  stok_minimum_toko: number;
  /** pengali biaya resep → harga per batch bahan produksi (1 = mengikuti biaya resep) */
  overhead_x: number;
  harga_per_unit: number;
  kategori: BahanKategori;
  pengadaan: JenisPengadaan;
  catatan: string | null;
  is_packaging: boolean;
  is_complement: boolean;
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: boolean;
  /** MINIMAL BELANJA (MOQ): jumlah beli minimum saat belanja otomatis (0 = tanpa minimum) */
  min_beli: number;
  is_active: boolean;
  /** nama supplier UTAMA bahan ini (null = belum diatur) */
  supplier_utama: string | null;
  /** jumlah supplier yang terdaftar untuk bahan ini */
  jumlah_supplier: number;
  /** RAK SIMPAN default (home) di CK: barang tiba di CK otomatis diletakkan di sini */
  storage_location_id: string | null;
}

/** Mode impor CSV bahan baku. */
export type BahanImportMode = "perbarui" | "tambah";

/**
 * Satu baris impor CSV bahan baku (hasil parse di web → dikirim ke server).
 * Cocok dengan bahan lewat `kode` (bila ada) lalu slug (nama). `jenis`
 * (pengadaan) hanya diterapkan pada bahan BARU.
 */
export interface BahanImportRow {
  kode: string | null;
  nama: string;
  kategori: string;
  jenis: JenisPengadaan;
  harga_beli: number;
  isi: number;
  satuan: string;
  satuan_beli: string | null;
  stok_minimum: number;
  boleh_eceran: boolean;
  lacak_stok: boolean;
  catatan: string | null;
}

/** Ringkasan hasil impor CSV bahan baku. */
export interface BahanImportResult {
  ditambah: number;
  diperbarui: number;
  /** bahan yang tadinya di Tempat Sampah (nonaktif) lalu dipulihkan oleh impor */
  dipulihkan: number;
  dilewati: number;
  gagal: { nama: string; alasan: string }[];
}

/**
 * Satu supplier yang terdaftar untuk sebuah bahan (info "beli di mana").
 * is_utama = supplier utama/langganan (maksimal satu per bahan).
 */
export interface BahanSupplierDto {
  id: string;
  supplier_id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  is_utama: boolean;
}

/**
 * Satu baris resep produksi (BOM) bahan jadi: kebutuhan bahan mentah per
 * SATU BATCH (isi) bahan jadi.
 */
export interface BahanResepRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  /** kebutuhan per 1 batch (isi) bahan jadi */
  qty: number;
  harga_per_unit: number;
  track_stok: boolean;
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

/** Kategori menu (master data). */
export interface KategoriDto {
  id: string;
  nama: string;
  sort_order: number;
}

/** Satuan bahan (master data) — sumber pilihan dropdown satuan. */
export interface SatuanDto {
  id: string;
  nama: string;
  sort_order: number;
  /** Jumlah bahan yang memakai satuan ini (sebagai satuan resep atau satuan beli). */
  dipakai: number;
}

/** Satu baris "Tambah Bahan Baku" (bulk) — selalu jalur beli. */
export interface BahanBulkRow {
  kode?: string | null;
  nama: string;
  harga_beli: number;
  isi: number;
  satuan: string;
  satuan_beli?: string | null;
  kategori: BahanKategori;
  track_stok: boolean;
  stok_minimum: number;
  boleh_eceran: boolean;
}

export interface MenuDto {
  id: string;
  nama: string;
  /** kode menu opsional (mis. "A1"), untuk kasir & daftar menu */
  kode: string | null;
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
  sort_order: number;
  /** pembatasan lokasi (mode Pro) — [] = tampil di semua cabang */
  branch_ids: string[];
  komponen: KomponenDto[];
  /** dihitung live */
  hpp: number;
  hpp_dine_in: number;
  harga_saran: number;
  harga_jual_bulat: number;
  food_cost_persen: number;
}

/** Bahan yang MEMBATASI sisa porsi sebuah menu (saldo ÷ qty paling kecil). */
export interface MenuStokPembatas {
  ingredient_id: string;
  nama: string;
  saldo: number;
  satuan: string;
  qty_per_porsi: number;
}

/**
 * Ketersediaan (sisa porsi) sebuah menu di satu cabang — diturunkan dari saldo
 * stok bahan terlacak. `porsi` = berapa porsi lagi yang bisa dibuat
 * (min saldo/qty per porsi atas semua bahan pembatas); `null` bila menu tak
 * punya bahan terlacak yang membatasi (dianggap tak terbatas).
 */
export interface MenuStokDto {
  menu_id: string;
  porsi: number | null;
  /** bahan pembatas porsi; null bila porsi null (tak terbatas) */
  pembatas: MenuStokPembatas | null;
}

/** Satu baris rencana penambahan stok dari menu: target porsi per menu. */
export interface RencanaMenuItem {
  menu_id: string;
  porsi: number;
}

/** Ringkasan menu pada preview rencana (untuk baca ulang & perkiraan omzet). */
export interface RencanaMenuRingkas {
  menu_id: string;
  nama: string;
  kode: string | null;
  porsi: number;
  harga_jual: number;
  /** porsi × harga_jual */
  omzet: number;
}

/** Kebutuhan satu bahan pada preview rencana-dari-menu. */
export interface RencanaBahanRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  pengadaan: JenisPengadaan;
  /** total kebutuhan = Σ porsi × qty per porsi */
  kebutuhan: number;
  /** saldo stok cabang TUJUAN saja (bukan + CK) — cocok dgn Kartu Stok cabang */
  saldo: number;
  /** stok jadi yang ADA di Central Kitchen (bisa dikirim ke cabang; 0 bila tak ada CK) */
  saldo_ck: number;
  /** kekurangan cabang = max(0, kebutuhan − saldo cabang); 0 = stok cabang cukup */
  kurang: number;
  /** bagian kekurangan yang dipenuhi dgn KIRIM DARI STOK CK (transfer, bukan produksi baru) */
  kirim_ck: number;
  isi: number;
  /** baris faktur yang akan dibuat (null bila kurang = 0) */
  mode_faktur: "pcs" | "batch" | null;
  jumlah_faktur: number | null;
  /** kuantitas riil yang masuk stok dari faktur (jumlah × isi utk batch) */
  qty_faktur: number | null;
  harga_per_unit: number;
  estimasi_biaya: number | null;
  /** khusus baris BAHAN PRODUKSI: nama bahan jadi yang membutuhkannya */
  untuk?: string | null;
}

/** Preview rencana penambahan stok dari target porsi menu. */
export interface RencanaMenuPreview {
  menus: RencanaMenuRingkas[];
  /** Σ porsi × harga_jual — untuk menyamakan rencana dengan target omzet */
  perkiraan_omzet: number;
  bahan: RencanaBahanRow[];
  /**
   * BELANJA BAHAN PRODUKSI: bahan mentah (resep) yang dibutuhkan bahan jadi
   * yang akan diproduksi — kekurangan dihitung terhadap stok cabang PELAKSANA
   * (Central Kitchen bila ada). Terpisah dari belanja produk langsung jadi.
   */
  bahan_produksi: RencanaBahanRow[];
  total_estimasi_biaya: number;
  /** jumlah bahan kurang per jalur (baris faktur yang akan dibuat) */
  jumlah_produksi: number;
  jumlah_beli: number;
  jumlah_beli_produksi: number;
  /** jumlah bahan yang akan DIKIRIM dari stok CK (transfer, tanpa produksi baru) */
  jumlah_kirim: number;
}

/** Hasil pembuatan faktur otomatis dari rencana menu (null = jalur tak perlu). */
export interface RencanaFakturResult {
  produksi: { faktur_id: string; jumlah_baris: number } | null;
  beli: { faktur_id: string; jumlah_baris: number } | null;
  /** faktur beli BAHAN PRODUKSI (bahan mentah resep) — terpisah dari beli produk jadi */
  beli_produksi: { faktur_id: string; jumlah_baris: number } | null;
  /** faktur KIRIM DARI STOK CK (transfer stok jadi CK → cabang, tanpa produksi baru) */
  kirim: { faktur_id: string; jumlah_baris: number } | null;
}

/** Satu bagian (Produksi / Beli) dari sebuah permintaan tambah stok. */
export interface PermintaanStokBagian {
  faktur_id: string;
  jumlah_baris: number;
  /** status "paling awal" di antara baris faktur (tahap terkini) */
  status: KonfirmasiStatus;
  total: number;
}

/**
 * Satu permintaan "Tambah Stok dari Menu": gabungan faktur Produksi + Beli
 * yang lahir dari satu submit (dikelompokkan lewat productions.rencana_id).
 */
export interface PermintaanStokRow {
  rencana_id: string;
  /** ISO timestamp pembuatan permintaan */
  waktu: string;
  /** ringkasan menu/porsi ("50× BASOAC, 30× PYO") dari catatan faktur */
  catatan: string | null;
  /** cabang tujuan (store yang butuh stok); null bila hanya beli */
  tujuan_cabang: string | null;
  /** nama pembuat permintaan */
  pembuat: string | null;
  produksi: PermintaanStokBagian | null;
  beli: PermintaanStokBagian | null;
  /** belanja bahan mentah untuk produksi (dari resep) */
  beli_produksi: PermintaanStokBagian | null;
  /** KIRIM DARI STOK CK: stok jadi yang sudah ada di CK, dipindah ke cabang */
  kirim: PermintaanStokBagian | null;
}

/**
 * Status pipeline stok masuk: rencana (RAB) → dikerjakan → menunggu →
 * dikonfirmasi (masuk stok). 'ditolak' khusus jalur beli (kiriman ditolak
 * penerima; bisa dibatalkan → dikonfirmasi). Stok terhitung saat 'dikonfirmasi'.
 */
export type KonfirmasiStatus =
  | "rencana"
  | "dikerjakan"
  | "menunggu"
  | "dikonfirmasi"
  | "ditolak";

/** Produksi in-house yang sedang berjalan (belum masuk saldo stok). */
export interface ProduksiBerjalan {
  /** total qty semua tahap berjalan (rencana + dikerjakan + menunggu) */
  qty: number;
  rencana: number;
  dikerjakan: number;
  menunggu: number;
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
  /** ambang batas stok minimum yang diatur untuk bahan ini (0 = pakai rasio default) */
  stok_minimum: number;
  /** produksi in-house yang belum masuk stok (rencana→dikerjakan→menunggu); null bila tak ada */
  produksi_berjalan: ProduksiBerjalan | null;
  /** pembelian (beli jadi) yang belum masuk stok (RAB→diproses→dikirim); null bila tak ada */
  pembelian_berjalan: ProduksiBerjalan | null;
}

export interface SupplierDto {
  id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  catatan: string | null;
  is_active: boolean;
}

/** Satu baris transaksi pembelian pada kartu supplier. */
export interface SupplierKartuRow {
  id: string;
  waktu: string;
  prod_date: string;
  no_faktur: string | null;
  faktur_id: string | null;
  bahan: string;
  satuan: string;
  qty: number;
  total_harga: number | null;
  status: KonfirmasiStatus;
  cabang: string | null;
}

/**
 * KARTU SUPPLIER: riwayat transaksi pembelian yang tercatat ke supplier ini +
 * ringkasan belanja + bahan yang menautkannya (★ = supplier utama bahan itu).
 */
export interface SupplierKartu {
  supplier: SupplierDto;
  /** total belanja TERKONFIRMASI (barang benar-benar diterima) */
  total_belanja: number;
  /** jumlah faktur pembelian yang menyebut supplier ini */
  jumlah_transaksi: number;
  rows: SupplierKartuRow[];
  bahan: { ingredient_id: string; nama: string; is_utama: boolean }[];
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
  /** pemakaian pada periode "terpakai" terpilih (default hari ini) */
  terpakai: number;
  /** stok tersisa saat ini */
  sisa: number;
  /** pemakaian pada periode acuan */
  acuan_qty: number;
  /** kebutuhan untuk mencapai target (null bila omzet acuan 0) */
  kebutuhan: number | null;
  /** maks(0, kebutuhan − sisa) MENTAH (belum dibulatkan); null bila tak bisa dihitung */
  saran_beli: number | null;
  /** isi per kemasan (beli) / hasil per batch (produksi) */
  isi: number;
  /** saran terbulatkan mengikuti faktur otomatis: "batch" = kemasan/batch penuh */
  mode_faktur: "pcs" | "batch" | null;
  jumlah_faktur: number | null;
  /** kuantitas riil bila saran dibeli (jumlah × isi utk kemasan/batch) */
  qty_faktur: number | null;
  harga_per_unit: number;
  /** round(qty_faktur × harga_per_unit) — dari kuantitas terbulatkan */
  estimasi_biaya: number | null;
}

export interface RekomendasiBeli {
  /** target penjualan (Rp) yang dipakai */
  target: number;
  /** tanggal hari ini (tz perusahaan) */
  hari_ini: string;
  acuan: AcuanPeriode;
  /** periode kolom "terpakai" (default hari ini; dari===sampai bila satu tanggal) */
  pakai: { dari: string; sampai: string };
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

/**
 * Penugasan tempat SO (stock opname) untuk satu karyawan: `tersedia` = semua
 * tempat penyimpanan di cabang karyawan; `assigned` = id tempat yang jadi
 * tugasnya. Dipakai halaman Karyawan (GET/PUT /karyawan/:id/tempat).
 */
export interface KaryawanTempatDto {
  assigned: string[];
  tersedia: { id: string; nama: string }[];
}

/** jenis meja: meja makan (dine-in) vs "Ruang Tunggu" untuk take away. */
export type MejaTipe = "dine_in" | "takeaway";

/** Master meja per cabang + posisi denah (persen 0..100). */
export interface MejaDto {
  id: string;
  branch_id: string;
  nama: string;
  tipe: MejaTipe;
  pos_x: number;
  pos_y: number;
  is_active: boolean;
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
export type PenyesuaianStatus = "menunggu" | "disetujui" | "ditolak";

/**
 * Status sesi opname (agregat baris): cocok (tak ada selisih), menunggu ACC
 * owner/admin, disetujui (selisih diterapkan ke stok), atau ditolak (dibuang).
 */
export type OpnameSesiStatus = "cocok" | "menunggu" | "disetujui" | "ditolak";

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
  /** nomor sesi otomatis (SO-0001) */
  nomor: string | null;
  waktu: string;
  oleh: string | null;
  jumlah_item: number;
  jumlah_selisih: number;
  catatan: string | null;
  /** status ACC sesi: cocok / menunggu / disetujui / ditolak */
  status: OpnameSesiStatus;
}

export interface OpnameSesiDetail {
  session_id: string;
  /** nomor sesi otomatis (SO-0001) */
  nomor: string | null;
  waktu: string;
  oleh: string | null;
  catatan: string | null;
  status: OpnameSesiStatus;
  /** owner/admin yang meng-ACC / menolak (bila ada) */
  ditinjau_oleh: string | null;
  items: {
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number;
    selisih: number | null;
  }[];
}

export type MutasiJenis = "opname" | "produksi" | "beli" | "penjualan" | "pemakaian";

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
  /** produksi in-house yang belum masuk saldo (independen dari periode) */
  produksi_berjalan: ProduksiBerjalan | null;
  /** pembelian (beli jadi) yang belum masuk saldo (independen dari periode) */
  pembelian_berjalan: ProduksiBerjalan | null;
  mutasi: MutasiStok[];
}

export interface SaleItemInput {
  menu_id: string;
  qty: number;
  /** override per baris; default mengikuti is_dine_in transaksi */
  is_dine_in?: boolean;
  /** catatan personalisasi per baris (mis. "tanpa gula") */
  catatan?: string | null;
}

/** Baris riwayat transaksi kasir (untuk cek pesanan / cetak ulang struk). */
export interface RiwayatTransaksiRow {
  id: string;
  nomor: string;
  waktu: string;
  total: number;
  is_dine_in: boolean;
  /** label meja terpilih (null bila transaksi lama tanpa meja) */
  meja: string | null;
  /** jumlah baris menu pada transaksi */
  jumlah_item: number;
  kasir: string | null;
  /** nama konsumen/member (null bila transaksi tanpa member) */
  konsumen: string | null;
  metode: MetodeBayar;
  /** nama cabang transaksi — terisi utk tampilan lintas cabang (?branch_id=all) */
  cabang: string | null;
}

/** Member/pelanggan pada daftar member area (dengan agregat transaksi). */
export interface CustomerDto {
  id: string;
  nama: string;
  wa: string;
  catatan: string | null;
  jumlah_transaksi: number;
  total_belanja: number;
  /** waktu transaksi terakhir (ISO) — null bila belum pernah transaksi */
  terakhir: string | null;
}

/** Satu transaksi milik seorang member (untuk detail member area). */
export interface CustomerTransaksi {
  id: string;
  /** nomor invoice/struk */
  nomor: string;
  waktu: string;
  total: number;
  cabang: string;
}

/** Detail member: profil + riwayat transaksinya. */
export interface CustomerDetail extends CustomerDto {
  transaksi: CustomerTransaksi[];
}

/** Baris di Tempat Sampah: transaksi yang di-soft-delete (hanya catatan, tak bisa dikembalikan). */
export interface SampahRow {
  jenis: "penjualan" | "pembelian" | "produksi";
  /** id penjualan, atau fakturId/id baris untuk pembelian/produksi */
  key: string;
  /** ringkasan: nomor struk / daftar bahan */
  label: string;
  waktu: string;
  total: number;
  dibuat_oleh: string | null;
  dihapus_oleh: string | null;
  dihapus_pada: string;
}

/** Metode pembayaran transaksi. */
export type MetodeBayar = "tunai" | "qris" | "transfer";

export interface LaporanHarian {
  dari: string;
  sampai: string;
  omzet: number;
  jumlah_transaksi: number;
  /** rekap penjualan per metode bayar (total = omzet bruto/subtotal per metode) */
  per_metode: { metode: MetodeBayar; jumlah: number; total: number }[];
  /** total potongan/diskon yang diberikan pada rentang (Rp) */
  total_diskon: number;
  pb1_terkumpul: number;
  total_hpp: number;
  estimasi_profit: number;
  item_terjual: { menu_nama: string; qty: number; omzet: number }[];
  konsumsi_bahan: { nama: string; slug: string; qty: number }[];
}

/** Satu baris ranking menu terlaris. */
export interface MenuLarisRow {
  menu_id: string;
  nama: string;
  kode: string | null;
  kategori: string;
  /** jumlah porsi terjual pada rentang */
  qty: number;
  /** omzet (Rp) dari menu ini pada rentang */
  omzet: number;
}

/** Laporan menu terlaris pada rentang tanggal (urut qty terbanyak). */
export interface MenuLaris {
  dari: string;
  sampai: string;
  total_qty: number;
  total_omzet: number;
  items: MenuLarisRow[];
}

/** Satu baris item pada open bill (pesanan belum dibayar). */
export interface OpenBillItemDto {
  menu_id: string;
  qty: number;
  /** null = ikut mode transaksi; true/false = override dine-in per baris */
  dine_in_override: boolean | null;
  catatan: string | null;
}

/** Ringkasan open bill untuk daftar/pemilih bill di kasir. */
export interface OpenBillRow {
  id: string;
  meja_label: string | null;
  customer_nama: string | null;
  jumlah_item: number;
  /** waktu terakhir diperbarui (ISO) */
  waktu: string;
}

/** Detail open bill (dimuat kembali ke keranjang saat dibuka). */
export interface OpenBillDetail {
  id: string;
  meja_id: string | null;
  meja_label: string | null;
  customer_nama: string | null;
  customer_wa: string | null;
  catatan: string | null;
  items: OpenBillItemDto[];
}

/** Sesi kas (shift) per cabang. ditutup_* null → shift masih terbuka. */
export interface Shift {
  id: string;
  branch_nama: string;
  dibuka_oleh: string;
  dibuka_pada: string;
  ditutup_oleh: string | null;
  ditutup_pada: string | null;
  modal_awal: number;
  /** uang tunai fisik saat tutup (null selagi terbuka) */
  uang_fisik: number | null;
  catatan: string | null;
  penjualan_tunai: number;
  penjualan_nontunai: number;
  jumlah_transaksi: number;
  /** kas seharusnya di laci = modal_awal + penjualan_tunai */
  kas_sistem: number;
  /** uang_fisik − kas_sistem (null selagi terbuka) */
  selisih: number | null;
}

/** Baris ringan hasil pencarian member (autocomplete keranjang kasir). */
export interface MemberCariRow {
  id: string;
  nama: string;
  wa: string;
}

/** Jenis cap absensi karyawan: masuk (datang) vs keluar (pulang). */
export type AbsensiTipe = "masuk" | "keluar";

/** Hasil satu cap absensi (dikembalikan POST /absensi). */
export interface AbsenResult {
  user_id: string;
  nama: string;
  employee_code: string;
  tipe: AbsensiTipe;
  /** waktu cap (ISO) */
  waktu: string;
  branch_nama: string;
  /** jarak perangkat ke titik cabang (m) — null bila lokasi cabang belum diatur */
  jarak_m?: number | null;
  /** foto swafoto bukti absen (URL) */
  foto_url: string | null;
}

/** Ringkasan absensi seorang karyawan pada satu hari (daftar di halaman Absen). */
export interface AbsensiRow {
  user_id: string;
  nama: string;
  employee_code: string | null;
  /** jam masuk pertama hari itu (ISO); null bila belum absen masuk */
  masuk: string | null;
  /** jam keluar terakhir hari itu (ISO); null bila belum absen keluar */
  keluar: string | null;
  /** foto bukti saat cap masuk pertama (URL) */
  foto_masuk: string | null;
  /** foto bukti saat cap keluar terakhir (URL) */
  foto_keluar: string | null;
}

/** Laporan pengeluaran pembelian bahan baku (faktur beli terkonfirmasi) per rentang tanggal. */
export interface LaporanPembelian {
  dari: string;
  sampai: string;
  total_pengeluaran: number;
  jumlah_faktur: number;
  jumlah_item: number;
  /** supplier = null → "Tanpa supplier" */
  per_supplier: { supplier: string | null; jumlah_faktur: number; total: number }[];
  per_bahan: { nama: string; slug: string; qty: number; satuan: string; total: number }[];
}

/* ===== Perlengkapan (non bahan baku): sendok, spons, sabun, dll. ===== */

/**
 * Jenis mutasi ledger perlengkapan: masuk (+), pakai/auto (−), koreksi (±),
 * kirim (− transfer keluar) / terima (+ transfer masuk) antar cabang.
 */
export type PerlengkapanMutasiTipe =
  | "masuk"
  | "pakai"
  | "auto"
  | "koreksi"
  | "kirim"
  | "terima";

/** Metode konsumsi perlengkapan: otomatis (jadwal harian) vs manual (stock opname). */
export type PerlengkapanAturanMetode = "otomatis" | "manual";

/**
 * Aturan konsumsi per cabang. metode "otomatis": terpakai `qty` setiap
 * `per_hari` hari; metode "manual": pemakaian dicatat lewat STOCK OPNAME
 * saja (qty/per_hari/mulai diabaikan).
 */
export interface PerlengkapanAturanDto {
  metode: PerlengkapanAturanMetode;
  qty: number;
  per_hari: number;
  aktif: boolean;
  /** tanggal mulai berlaku (YYYY-MM-DD) */
  mulai: string;
}

/** Satu item perlengkapan + saldo cabang aktif + aturan konsumsinya (bila ada). */
export interface PerlengkapanRowDto {
  id: string;
  nama: string;
  satuan: string;
  harga_beli: number;
  stok_minimum: number;
  catatan: string | null;
  saldo: number;
  status: StokStatus;
  aturan: PerlengkapanAturanDto | null;
  /**
   * saldo item ini di Central Kitchen pemasok cabang (utk tombol "Minta ke
   * CK" saat stok ≤ minimum); null bila cabang tak terhubung CK / cabang
   * INI Central Kitchen-nya
   */
  saldo_ck: number | null;
}

/** Satu lokasi (cabang) tempat perlengkapan berada + aturan konsumsinya. */
export interface PerlengkapanLokasiDto {
  branch_id: string;
  branch_nama: string;
  saldo: number;
  status: StokStatus;
  aturan: PerlengkapanAturanDto | null;
}

/**
 * Baris MASTER perlengkapan (halaman Manajemen, tanpa pilih cabang):
 * data item se-perusahaan + sebaran "ada di cabang mana saja".
 */
export interface PerlengkapanMasterRow {
  id: string;
  nama: string;
  satuan: string;
  harga_beli: number;
  stok_minimum: number;
  catatan: string | null;
  /** kategori — memakai master kategori yang sama dengan bahan baku */
  kategori: string | null;
  /** boleh dibeli eceran (per pcs) vs harus utuh per kemasan */
  boleh_eceran: boolean;
  /** dilacak: konsumsinya dipantau — WAJIB punya aturan konsumsi */
  dilacak: boolean;
  /** rak simpan default (tempat penyimpanan) */
  rak: { id: string; nama: string } | null;
  /** nama supplier utama/langganan (null = belum diatur) */
  supplier_utama: string | null;
  jumlah_supplier: number;
  /** cabang dengan saldo ≠ 0 ATAU aturan konsumsi terpasang */
  lokasi: PerlengkapanLokasiDto[];
}

/** Kiriman perlengkapan CK → cabang (stok pindah saat cabang menerima). */
export interface KirimanPerlengkapanDto {
  id: string;
  nomor: string | null;
  dari_cabang: string;
  ke_cabang: string;
  /** cabang tujuan — tombol Terima hanya tampil saat melihat cabang ini */
  ke_branch_id: string;
  item: { id: string; nama: string; satuan: string };
  qty: number;
  status: "dikirim" | "diterima";
  waktu: string;
  oleh: string | null;
  catatan: string | null;
}

/** Ringkasan satu sesi opname perlengkapan (riwayat). */
export interface OpnamePerlengkapanSesiRow {
  session_id: string;
  nomor: string | null;
  waktu: string;
  oleh: string | null;
  jumlah_item: number;
  status: PenyesuaianStatus;
}

/** Detail sesi opname perlengkapan: baris selisih per item. */
export interface OpnamePerlengkapanDetail {
  session_id: string;
  nomor: string | null;
  status: PenyesuaianStatus;
  rows: {
    supply_id: string;
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number | null;
    selisih: number;
  }[];
}

/** Satu baris kartu (ledger) perlengkapan dengan saldo berjalan. */
export interface PerlengkapanMutasiDto {
  id: string;
  waktu: string;
  tanggal: string;
  tipe: PerlengkapanMutasiTipe;
  masuk: number | null;
  keluar: number | null;
  saldo: number;
  total_harga: number | null;
  catatan: string | null;
  user_nama: string | null;
  /** nomor dokumen PL- (hanya mutasi 'masuk' yang bernomor) */
  nomor: string | null;
}

/** Kartu perlengkapan per item per cabang per rentang tanggal. */
export interface KartuPerlengkapanDto {
  item: { id: string; nama: string; satuan: string };
  periode: { dari: string; sampai: string };
  saldo_awal: number;
  saldo_akhir: number;
  total_masuk: number;
  total_keluar: number;
  /** nilai belanja (SUM total_harga mutasi masuk) dalam rentang */
  total_belanja: number;
  /** true bila mutasi melebihi batas tampilan dan dipotong */
  terpotong: boolean;
  mutasi: PerlengkapanMutasiDto[];
}

/** Ringkasan belanja perlengkapan per rentang tanggal. */
export interface BelanjaPerlengkapanDto {
  dari: string;
  sampai: string;
  total: number;
  per_item: { supply_id: string; nama: string; total: number }[];
}
