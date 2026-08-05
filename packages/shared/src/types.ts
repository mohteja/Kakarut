import type {
  BahanKategori,
  DivisiProduksi,
  JenisPengadaan,
  KebersihanSesi,
  MenuTipe,
  PengajuanJenis,
  PengajuanKategori,
  PengajuanStatus,
  ProduksiDi,
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

export type InvitationStatus = "pending" | "accepted" | "revoked";

/** Undangan yang DITUJUKAN ke saya (dilihat calon karyawan di onboarding). */
export interface UndanganDto {
  id: string;
  company_nama: string;
  role: UserRole;
  cabang_nama: string | null;
  diundang_pada: string;
}

/** Status onboarding user tanpa perusahaan: sudah punya perusahaan? + undangan. */
export interface OnboardingStatus {
  has_company: boolean;
  email: string;
  undangan: UndanganDto[];
}

/** Undangan yang DIBUAT perusahaan (dilihat owner/admin di Kelola Karyawan). */
export interface UndanganKaryawanRow {
  id: string;
  email: string;
  role: UserRole;
  cabang_nama: string | null;
  status: InvitationStatus;
  diundang_pada: string;
}

export type SmtpEncryption = "none" | "ssl" | "starttls";

/** Pengaturan email (SMTP) platform — GET tak pernah mengembalikan password mentah. */
export interface SmtpSettingsDto {
  host: string | null;
  port: number;
  username: string | null;
  /** true = password sudah tersimpan (nilai asli tak dikirim ke klien) */
  has_password: boolean;
  encryption: SmtpEncryption;
  sender_name: string | null;
  sender_email: string | null;
  /** true = email siap dikirim (SMTP lengkap ATAU fallback Resend aktif) */
  configured: boolean;
  /** penyedia efektif saat ini */
  provider: "smtp" | "resend" | "none";
}

/** Satu baris riwayat pencadangan database (panel super admin). */
export interface BackupRunDto {
  id: string;
  waktu: string;
  pemicu: "otomatis" | "manual";
  status: "berjalan" | "sukses" | "gagal";
  storage_mode: "r2" | "local";
  /** kunci objek / nama berkas cadangan; null bila gagal sebelum tersimpan */
  object_key: string | null;
  ukuran_bytes: number | null;
  jumlah_tabel: number | null;
  jumlah_baris: number | null;
  durasi_ms: number | null;
  error: string | null;
  /** true = berkas tersedia untuk diunduh */
  bisa_unduh: boolean;
}

/** Status + konfigurasi pencadangan (GET /admin/sistem/backup). */
export interface BackupStatusDto {
  /** pencadangan otomatis (penjadwal) aktif */
  aktif: boolean;
  /** jam LOKAL jadwal harian (0–23) — bawaan 2 (02:00 dini hari) */
  jam_lokal: number;
  /** zona waktu jadwal — mengikuti zona waktu tenant terbanyak */
  zona_waktu: string;
  /** perkiraan jadwal berikutnya (ISO); null bila pencadangan nonaktif */
  berikutnya: string | null;
  /** retensi: jumlah cadangan sukses terakhir yang disimpan */
  simpan: number;
  /** target penyimpanan cadangan */
  storage_mode: "r2" | "local";
  /** waktu cadangan sukses terakhir (ISO) atau null */
  terakhir_sukses: string | null;
  /** riwayat 50 cadangan terakhir (terbaru dulu) */
  riwayat: BackupRunDto[];
}

/**
 * Satu KELOMPOK galat pada log error platform (panel super admin). Baris di
 * database tetap satu-per-kejadian; kelompok ini hasil agregasi berdasarkan
 * `sidik` (status + metode + pola jalur + pesan) supaya satu masalah yang
 * terjadi ribuan kali tampil sebagai satu baris, bukan ribuan.
 */
export interface ErrorLogKelompokRow {
  /** sidik jari kelompok — dipakai sebagai id untuk membuka detailnya */
  sidik: string;
  status: number;
  metode: string;
  /** pola jalur ter-normalisasi, mis. `/api/bahan/:id` */
  jalur_pola: string;
  pesan: string;
  jumlah: number;
  pertama_pada: string;
  terakhir_pada: string;
  /** berapa akun berbeda yang mengalaminya (0 bila semua anonim) */
  jumlah_user: number;
  /** berapa perusahaan berbeda yang terdampak (0 bila tanpa perusahaan) */
  jumlah_perusahaan: number;
}

/** Satu KEJADIAN galat (baris mentah) — dipakai pada detail kelompok. */
export interface ErrorLogKejadianRow {
  id: string;
  waktu: string;
  status: number;
  metode: string;
  /** jalur apa adanya TANPA query string */
  jalur: string;
  pesan: string;
  /** jejak tumpukan — hanya untuk 5xx */
  stack: string | null;
  user_nama: string | null;
  user_email: string | null;
  peran: string | null;
  perusahaan_nama: string | null;
  ip: string | null;
  user_agent: string | null;
}

/** Ringkasan + daftar kelompok galat (GET /admin/error-log). */
export interface ErrorLogDto {
  /** rentang hari yang dicakup ringkasan & daftar */
  hari: number;
  /** total kejadian dalam rentang (sebelum penyaringan status) */
  total: number;
  /** kejadian 5xx — bug server */
  total_5xx: number;
  /** kejadian 4xx — penolakan (validasi/izin/tak ditemukan/rate limit) */
  total_4xx: number;
  /** jumlah kelompok berbeda pada hasil yang disaring */
  jumlah_kelompok: number;
  rows: ErrorLogKelompokRow[];
}

/** Detail satu kelompok galat (GET /admin/error-log/:sidik). */
export interface ErrorLogDetailDto {
  kelompok: ErrorLogKelompokRow;
  /** kejadian terbaru pada kelompok ini (terbaru dulu) */
  kejadian: ErrorLogKejadianRow[];
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
  /**
   * Lokasi produksi bahan jalur "produksi": "ck" (Central Kitchen, default) atau
   * "cabang" (diproduksi kitchen/bar di cabang store sesuai `divisi_produksi` —
   * hasil masuk stok cabang itu). Diabaikan untuk pengadaan "beli".
   */
  produksi_di: ProduksiDi;
  /**
   * PENUGASAN DIVISI resep saat produksi_di = "cabang": "kitchen" (default)
   * atau "bar". Role kitchen hanya boleh memproduksi resep divisi kitchen;
   * role bar hanya resep divisi bar. Diabaikan saat produksi_di = "ck".
   */
  divisi_produksi: DivisiProduksi;
  /**
   * Cabang PRODUSEN saat produksi_di = "cabang": id cabang store yang
   * kitchen/bar-nya (sesuai divisi_produksi) memproduksi bahan ini. KOSONG =
   * semua cabang store. Cabang di luar daftar dipenuhi lewat jalur CK. Selalu
   * [] untuk produksi_di = "ck".
   */
  produksi_branch_ids: string[];
  catatan: string | null;
  is_packaging: boolean;
  is_complement: boolean;
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: boolean;
  /** MINIMAL BELANJA (MOQ): jumlah beli minimum saat belanja otomatis (0 = tanpa minimum) */
  min_beli: number;
  /** MASA SIMPAN (hari) setelah masuk stok — dasar exp otomatis lot; 0 = tak diatur */
  masa_simpan_hari: number;
  /** LEAD TIME (hari): beli = lama pesanan datang; produksi = lama proses; 0 = tanpa info */
  lead_time_hari: number;
  /** FOTO BAHAN JADI hasil produksi (halaman Resep) — null = belum diunggah */
  foto_hasil_url: string | null;
  /** FOTO CARA PACKING hasil produksi (halaman Resep) — null = belum diunggah */
  foto_packing_url: string | null;
  is_active: boolean;
  /** nama supplier UTAMA bahan ini (null = belum diatur) */
  supplier_utama: string | null;
  /** jumlah supplier yang terdaftar untuk bahan ini */
  jumlah_supplier: number;
  /**
   * DI SIMPAN DI MANA: rak per cabang (CK & cabang store) tempat bahan ini
   * disimpan. READ-ONLY di daftar — diatur di Stok → Tempat Penyimpanan
   * (bukan di form Bahan Baku). Kosong = belum diatur di rak mana pun.
   */
  rak_lokasi: RakLokasi[];
}

/** Satu penempatan bahan di rak sebuah cabang (untuk kolom "Rak simpan" daftar Bahan Baku). */
export interface RakLokasi {
  branch_id: string;
  branch_nama: string;
  branch_tipe: "store" | "central_kitchen" | "kantor";
  rak_id: string;
  rak_nama: string;
}

/** Mode impor CSV bahan baku. */
export type BahanImportMode = "perbarui" | "tambah";

/**
 * Satu baris impor CSV bahan baku (hasil parse di web → dikirim ke server).
 * Cocok dengan bahan lewat `kode` (bila ada) lalu slug (nama). `jenis`
 * (pengadaan) hanya diterapkan pada bahan BARU.
 *
 * SEMUA field selain `nama` OPSIONAL, dan absennya BERARTI SESUATU:
 *
 *   - field ADA  → nilainya dipakai (termasuk `false`, `0`, dan `null` — itu
 *     perintah yang sah: mengosongkan catatan, mematikan `kemasan`, dst);
 *   - field TIDAK ADA → pada bahan LAMA nilainya DIBIARKAN apa adanya; pada
 *     bahan BARU barulah default dipakai.
 *
 * Bedanya bukan kosmetik. Berkas CSV yang cuma berisi `nama,harga_beli` —
 * bentuk yang paling lazim dipakai memperbarui harga dari daftar supplier —
 * dulu menulis default ke SELURUH kolom lain pada tiap bahan yang cocok:
 * `isi` balik ke 1 (satu dus isi 24 jadi isi 1 → HPP per botol 24× lipat),
 * `satuan` jadi "pcs", `kategori` jadi "lain", `kemasan`/`complement` mati,
 * `stok_minimum` nol. Semuanya tanpa satu pun pesan, dengan spanduk hijau
 * "✅ Impor selesai — 12 diperbarui" di layar.
 */
export interface BahanImportRow {
  kode?: string | null;
  nama: string;
  kategori?: string;
  jenis?: JenisPengadaan;
  harga_beli?: number;
  isi?: number;
  satuan?: string;
  satuan_beli?: string | null;
  stok_minimum?: number;
  /** minimal belanja (MOQ); 0 = tanpa minimum */
  min_beli?: number;
  boleh_eceran?: boolean;
  lacak_stok?: boolean;
  /** kemasan take-away (is_packaging) */
  kemasan?: boolean;
  /** complement (×0.5 dine-in) */
  complement?: boolean;
  /** masa simpan (hari); 0 = tak diatur */
  masa_simpan_hari?: number;
  /** lead time (hari); 0 = tanpa info */
  lead_time_hari?: number;
  catatan?: string | null;
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
 * Satu LANGKAH CARA MASAK bahan produksi (urut sesuai sort_order). Dikelola
 * owner/admin di halaman Resep; dibaca semua pelaksana produksi (kitchen,
 * bar, tim CK). foto_url = foto proses langkah itu (opsional).
 */
export interface BahanLangkahRow {
  id: string;
  teks: string;
  foto_url: string | null;
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
  /** minimal belanja (MOQ); 0 = tanpa minimum */
  min_beli?: number;
  /** masa simpan (hari); 0 = tak diatur */
  masa_simpan_hari?: number;
  /** lead time (hari); 0 = tanpa info */
  lead_time_hari?: number;
  /** kemasan take-away */
  is_packaging?: boolean;
  /** complement (×0.5 dine-in) */
  is_complement?: boolean;
  catatan?: string | null;
}

export interface MenuDto {
  id: string;
  nama: string;
  /** kode menu opsional (mis. "A1"), untuk kasir & daftar menu */
  kode: string | null;
  /**
   * ISI menu untuk PEMBELI — mis. "1 baso urat besar, 2 baso kecil, 1 mie".
   * Tampil di Daftar Menu (layar & cetak) dan di kartu menu kasir.
   *
   * SENGAJA bukan turunan `komponen`: resep itu dokumen BIAYA — takarannya
   * boleh pecahan hasil konversi gram (mis. 0,7576 butir) dan memuat kemasan
   * serta pelengkap yang tak pantas dicetak. Form menyediakan tombol
   * isi-otomatis dari resep sebagai titik awal, teksnya lalu dirapikan
   * pemilik. null = tak ditampilkan.
   */
  deskripsi: string | null;
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

/**
 * Satu bahan penyumbang HPP sebuah menu — dipakai halaman Analisis Harga untuk
 * menjawab "kenapa food cost menu ini naik padahal harga jualnya tak diubah".
 */
export interface PenyumbangHpp {
  ingredient_id: string;
  nama: string;
  qty: number;
  satuan: string;
  harga_per_unit: number;
  /** qty × harga_per_unit — rupiah yang bahan ini sumbangkan ke HPP */
  kontribusi: number;
  persen_hpp: number;
  /** ingredients.updated_at — kapan harga bahan ini terakhir bergerak */
  bahan_diperbarui: string;
  /** MAX(productions.laporan_harga_at) — kapan harganya terakhir DILAPORKAN */
  harga_dilaporkan_pada: string | null;
}

/**
 * Satu baris Analisis Harga: MenuDto + jejak waktu. Bila `menu_diperbarui`
 * jauh lebih tua dari `bahan_diperbarui` penyumbang terbesarnya, artinya yang
 * bergerak adalah harga BAHAN, bukan harga jual menu.
 */
export interface AnalisisHargaRow extends MenuDto {
  /** menus.updated_at — kapan menu (termasuk harga jualnya) terakhir disimpan */
  menu_diperbarui: string;
  /** ambang food cost perusahaan (%) — disalin agar klien tak perlu query lain */
  food_cost_maks: number;
  /** penyumbang HPP terbesar (maks 5), urut kontribusi menurun */
  penyumbang: PenyumbangHpp[];
}

/** Dari mana perubahan harga jual menu berasal. */
export type SebabHargaMenu = "buat" | "manual" | "terapkan_saran";

/** Satu baris riwayat perubahan harga jual sebuah menu. */
export interface MenuPriceLogRow {
  id: string;
  menu_id: string;
  /** null = baris pertama (menu baru dibuat) */
  harga_lama: number | null;
  harga_baru: number;
  mult_lama: number | null;
  mult_baru: number | null;
  sebab: SebabHargaMenu;
  /** nama pengubah; null bila akunnya sudah dihapus */
  oleh: string | null;
  created_at: string;
}

/** Ringkasan hasil POST /menu/terapkan-saran. */
export interface TerapkanSaranHasil {
  diperbarui: number;
  dilewati: number;
  rincian: Array<{
    menu_id: string;
    nama: string;
    harga_lama: number;
    harga_baru: number;
    /** false = harga sudah sama dengan saran, tak ada yang diubah */
    diperbarui: boolean;
  }>;
}

/** Satu bahan yang harga acuannya akan bergeser oleh sebuah laporan harga. */
export interface DampakBahan {
  ingredient_id: string;
  nama: string;
  satuan: string;
  acuan_lama: number;
  acuan_baru: number;
  /** berapa menu yang memakai bahan ini (langsung maupun lewat menu dasar) */
  jumlah_menu_terdampak: number;
}

/** Satu menu yang food cost-nya melewati ambang GARA-GARA laporan harga ini. */
export interface DampakMenu {
  menu_id: string;
  nama: string;
  food_cost_lama: number;
  food_cost_baru: number;
}

/**
 * Pratinjau dampak "Laporan Harga" — dihitung server tanpa menulis apa pun,
 * supaya user tahu bahwa mencatat nota juga menggeser harga acuan bahan
 * (dan karenanya HPP semua menu yang memakainya).
 */
export interface DampakLaporanHarga {
  food_cost_maks: number;
  bahan: DampakBahan[];
  /** menu yang SEBELUMNYA di bawah ambang dan setelah ini melewatinya */
  menu_lewat_ambang: DampakMenu[];
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
  /**
   * stok jadi CK yang benar-benar BISA DIJANJIKAN ke cabang ini: saldo fisik CK
   * dikurangi barang yang sudah dikirim tapi belum diterima cabang mana pun.
   * 0 bila tak ada CK. Potongan itu penting: saldo CK sengaja masih memuat
   * barang yang di jalan, jadi tanpa dipotong dua permintaan berturut-turut
   * akan sama-sama dijanjikan "tinggal kirim" dan saldo CK jadi minus.
   */
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
  /** LEAD TIME bahan (hari): pesan/buat jauh-jauh hari (H-n); 0 = tanpa info */
  lead_time_hari: number;
  /**
   * DIVISI pelaksana saat produksi_di="cabang" ("kitchen"/"bar") — faktur
   * produksi cabang dipisah per divisi. null utk jalur lain.
   */
  divisi_produksi?: DivisiProduksi | null;
  /** khusus baris BAHAN PRODUKSI: nama bahan jadi yang membutuhkannya */
  untuk?: string | null;
  /**
   * Lokasi produksi (baris pengadaan "produksi"): "cabang" = diproduksi kitchen
   * di cabang tujuan (faktur lahir di cabang, tanpa kirim CK). Pada baris
   * BAHAN PRODUKSI: lokasi produksi bahan jadi yang dilayaninya — "cabang"
   * berarti belanjanya dikirim ke cabang. Null/absen = CK (perilaku lama).
   */
  produksi_di?: ProduksiDi | null;
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
  /** id rencana — pengelompok semua faktur satu submit (Data Permintaan Stok) */
  rencana_id: string;
  /** nomor dokumen permintaan (PM-xxxx); null bila tak ada faktur yang lahir */
  nomor_permintaan: string | null;
  produksi: { faktur_id: string; jumlah_baris: number } | null;
  /**
   * Faktur produksi DI CABANG tujuan (bahan ber-produksi_di "cabang"): lahir di
   * cabang store, dikerjakan kitchen cabang, hasil langsung masuk stok cabang.
   */
  produksi_cabang: { faktur_id: string; jumlah_baris: number } | null;
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
 * Bagian FAKTUR BELI PERLENGKAPAN (BP-) sebuah permintaan — status memakai
 * pipeline perlengkapan (menunggu dibeli → tiba di CK / batal); "sebagian" =
 * campuran tiba & batal.
 */
export interface PermintaanStokBagianPerlengkapan {
  faktur_id: string;
  jumlah_baris: number;
  status: BeliPerlengkapanStatus | "sebagian";
  total: number;
}

/**
 * Satu permintaan "Tambah Stok dari Menu": gabungan faktur Produksi + Beli
 * yang lahir dari satu submit (dikelompokkan lewat productions.rencana_id).
 */
export interface PermintaanStokRow {
  rencana_id: string;
  /** nomor dokumen permintaan (PM-xxxx) — identitas tampil */
  nomor: string | null;
  /** ISO timestamp pembuatan permintaan */
  waktu: string;
  /** ringkasan menu/porsi ("50× BASOAC, 30× PYO") dari catatan faktur */
  catatan: string | null;
  /** cabang tujuan (store yang butuh stok); null bila hanya beli */
  tujuan_cabang: string | null;
  /** nama pembuat permintaan */
  pembuat: string | null;
  produksi: PermintaanStokBagian | null;
  /** produksi DI CABANG tujuan (kitchen cabang; hasil langsung masuk stok cabang) */
  produksi_cabang: PermintaanStokBagian | null;
  beli: PermintaanStokBagian | null;
  /** belanja bahan mentah untuk produksi (dari resep) */
  beli_produksi: PermintaanStokBagian | null;
  /** KIRIM DARI STOK CK: stok jadi yang sudah ada di CK, dipindah ke cabang */
  kirim: PermintaanStokBagian | null;
  /** faktur BELI PERLENGKAPAN (BP-) yang lahir bersama permintaan ini */
  beli_perlengkapan: PermintaanStokBagianPerlengkapan | null;
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

/**
 * TRANSFER STOK — satu baris bahan pada faktur transfer antar lokasi
 * (CK↔cabang, cabang↔cabang). `pengadaan` dibawa agar tabel jelas menandai
 * bahan BELI (dibeli jadi) vs PRODUKSI (dibuat sendiri).
 */
export interface TransferStokItemRow {
  id: string;
  ingredient_id: string;
  nama: string;
  /** satuan kerja — SATU-SATUNYA label yang sah untuk `qty` */
  satuan: string;
  pengadaan: JenisPengadaan;
  /** jumlah dalam `satuan` (satuan kerja), tak pernah dalam satuan kemasan */
  qty: number;
  /**
   * `qty` + `satuan` yang SUDAH ditulis server, mis. "900 gr" — tampilkan apa
   * adanya. Ada agar web & mobile mustahil berbeda satuan (lihat qtyTeks()).
   */
  qty_teks: string;
  /**
   * setara kemasan beli, mis. "≈ 0,9 kg"; null bila bahan tak berkemasan.
   * PELENGKAP — boleh ditampilkan di samping `qty_teks`, tak boleh menggantikannya.
   */
  qty_setara: string | null;
  /** menunggu = dalam perjalanan; dikonfirmasi = diterima; ditolak = tak diterima */
  status: KonfirmasiStatus;
  alasan_tolak: string | null;
}

/** Satu FAKTUR transfer stok (nomor TF-) berisi banyak bahan. */
export interface TransferStokFaktur {
  faktur_id: string;
  /** nomor dokumen TF-xxxx */
  nomor: string | null;
  waktu: string;
  prod_date: string;
  asal_branch_id: string | null;
  asal_cabang: string | null;
  tujuan_branch_id: string | null;
  tujuan_cabang: string | null;
  catatan: string | null;
  dibuat_oleh: string | null;
  /** agregat status baris; "sebagian" = ada yang diterima & ada yang ditolak */
  status: KonfirmasiStatus | "sebagian";
  items: TransferStokItemRow[];
}

/**
 * Stok READY satu bahan di cabang asal — dasar pemilih bahan & validasi qty
 * pada form Transfer Stok (hanya bahan berlacak-stok dengan saldo > 0).
 */
export interface TransferStokSaldoRow {
  ingredient_id: string;
  nama: string;
  /** satuan kerja — SATU-SATUNYA label yang sah untuk `saldo`/`dalam_jalan`/qty kirim */
  satuan: string;
  pengadaan: JenisPengadaan;
  /** saldo FISIK di lokasi asal (barang yang masih dalam perjalanan ikut terhitung) */
  saldo: number;
  /**
   * qty yang SUDAH dijanjikan keluar tapi belum diterima tujuan (kiriman &
   * transfer berstatus 'menunggu'). Barang ini fisik sudah lepas, jadi
   * `tersedia untuk transfer baru` = `saldo − dalam_jalan`.
   */
  dalam_jalan: number;
  /** isi per kemasan dalam `satuan` (1 = tanpa kemasan) */
  isi: number;
  /** satuan kemasan (mis. "kg"); null = tak diatur */
  satuan_beli: string | null;
  /**
   * true = qty kiriman WAJIB kelipatan `isi` — barang yang hanya bisa dibeli
   * per kemasan juga hanya boleh dikirim per kemasan. Pengecualiannya satu:
   * qty = seluruh sisa (`saldo − dalam_jalan`) tetap boleh ("kirim habis"),
   * kalau tidak sisa di bawah satu kemasan terjebak selamanya di cabang asal.
   */
  wajib_kelipatan: boolean;
  /**
   * sisa siap kirim (`saldo − dalam_jalan`) yang SUDAH ditulis server, mis.
   * "900 gr" — tampilkan apa adanya supaya web & mobile tak mungkin berbeda
   * satuan (lihat qtyTeks()).
   */
  tersedia_teks: string;
  /** setara kemasan dari sisa siap kirim, mis. "≈ 0,9 kg"; null bila tak berkemasan */
  tersedia_setara: string | null;
}

/**
 * Satu LOT (baris faktur masuk stok) yang hampir/lewat tanggal kedaluwarsa —
 * GET /stok/exp. APROKSIMASI: ledger stok agregat (tanpa FIFO), jadi
 * `qty_masuk` = qty saat lot masuk, BUKAN sisa lot; `saldo` (saldo live semua
 * lot bahan) disandingkan agar user menilai sendiri sebelum mencatat waste.
 */
export interface ExpLotRow {
  production_id: string;
  ingredient_id: string;
  nama: string;
  satuan: string;
  /** qty saat lot masuk stok (bukan sisa lot — lihat catatan aproksimasi) */
  qty_masuk: number;
  exp_date: string;
  /** tanggal lot masuk (prod_date faktur) */
  prod_date: string;
  tipe: JenisPengadaan;
  faktur_id: string | null;
  /** nomor dokumen faktur (PB-/PR-) bila ada */
  nomor: string | null;
  tempat: string | null;
  /** saldo live bahan saat ini (semua lot) */
  saldo: number;
  /** exp_date − hari ini (negatif = sudah lewat exp) */
  sisa_hari: number;
}

export interface SupplierDto {
  id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  catatan: string | null;
  /** kategori bebas utk pengelompokan/filter (mis. "sayur", "kemasan") */
  kategori: string | null;
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
  /** LEAD TIME bahan (hari): pesan/buat jauh-jauh hari (H-n); 0 = tanpa info */
  lead_time_hari: number;
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
  /**
   * true = masih ANGGOTA AKTIF perusahaan (user aktif, belum dihapus,
   * membership belum diarsip). Petugas non-aktif (akun diarsip/dihapus/
   * dibuat ulang) DIABAIKAN dalam pembatasan opname — rak tidak terkunci
   * diam-diam oleh penugasan basi — dan ditandai ⚠ di pengaturan agar
   * owner menugaskan ulang.
   */
  aktif: boolean;
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
  /** jumlah bahan baku yang ditugaskan disimpan di rak ini (rak default cabang) */
  jumlah_bahan: number;
  /** jumlah perlengkapan yang ditugaskan disimpan di rak ini */
  jumlah_perlengkapan: number;
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

/** Meja sedang dipakai tamu, atau siap ditempati. */
export type MejaStatus = "isi" | "kosong";

/**
 * Status okupansi satu meja — dari `GET /api/meja/status`, BUKAN dari
 * `GET /api/meja` (daftar master itu di-cache lewat ETag; status hidup akan
 * membuat sidik jarinya berubah tiap transaksi).
 *
 * Hanya meja `dine_in` yang punya status. "Ruang Tunggu" (takeaway) dipakai
 * bergantian sepanjang hari oleh orang berbeda — menandainya terisi akan
 * membuatnya merah selamanya sejak pesanan bawa pulang pertama.
 */
export interface MejaStatusDto {
  meja_id: string;
  nama: string;
  status: MejaStatus;
  /** tagihan yang BELUM dibayar di meja ini (0 = semua sudah lunas) */
  bill_terbuka: number;
  /** transaksi lunas yang masih dianggap menempati meja ini */
  transaksi_aktif: number;
  /**
   * `true` bila semuanya sudah lunas tapi meja belum dibereskan — tamu yang
   * "sudah bayar, masih duduk". Meja inilah yang paling layak ditawari tombol
   * Kosongkan.
   */
  lunas_masih_duduk: boolean;
  /** ISO — tagihan PALING AWAL di meja ini (dasar hitungan "sudah duduk berapa lama") */
  sejak: string | null;
  /** ISO — kapan meja ini terakhir dibereskan, null bila belum pernah */
  dikosongkan_pada: string | null;
  dikosongkan_oleh: string | null;
  /**
   * Konsumen pada transaksi TERAKHIR yang masih menempati meja ini — bahan
   * pilihan "tamu yang sama, tambah pesanan". Selalu `null` bila mejanya
   * `kosong`, supaya klien tak pernah menawarkan tamu yang sudah dibereskan.
   *
   * Gunanya: tamu member yang memesan dua kali di meja yang sama tak lagi
   * tercatat sebagai satu transaksi ber-member dan satu tanpa member.
   */
  konsumen_nama: string | null;
  konsumen_wa: string | null;
}

/** Satu baris riwayat "meja dibereskan" — dari `GET /api/meja/:id/log`. */
export interface MejaKosongLogRow {
  waktu: string;
  aksi: string;
  oleh: string | null;
  paksa: boolean;
  detail: string | null;
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
    /** id baris opname — dipakai untuk ACC/Tolak per produk */
    id: string;
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number;
    selisih: number | null;
    /** status ACC baris ini (per produk): menunggu / disetujui / ditolak */
    penyesuaian_status: PenyesuaianStatus;
    /** bukti foto selisih (URL) — dilampirkan saat pengecekan, untuk ACC admin */
    foto_url: string | null;
    /** alasan selisih (opsional) — dilampirkan saat pengecekan */
    alasan: string | null;
    /** alasan penolakan baris (bila baris ini ditolak) */
    tolak_alasan: string | null;
  }[];
}

export type MutasiJenis =
  | "opname"
  | "produksi"
  | "beli"
  | "penjualan"
  | "pemakaian"
  /** kiriman keluar: stok dipindah dari cabang ini ke cabang lain (diterima) */
  | "kirim";

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

/** Saldo satu bahan pada satu cabang — chip "Stok per Cabang" di Detail Produk. */
export interface BahanSaldoCabang {
  branch_id: string;
  nama: string;
  tipe: "store" | "central_kitchen" | "kantor";
  saldo: number;
}

/** DETAIL PRODUK satu bahan: DTO lengkap + metode HPP + sebaran stok per cabang. */
export interface BahanDetailDto {
  bahan: BahanDto;
  /** metode perhitungan biaya perusahaan (pengaturan Perusahaan) */
  metode_hpp: "average" | "fifo";
  /** total saldo seluruh cabang */
  total_saldo: number;
  saldo_cabang: BahanSaldoCabang[];
}

/**
 * Satu LOT masuk pada kartu FIFO: pembelian/produksi/transfer masuk, atau
 * penyesuaian opname naik. Urut PALING AWAL masuk — pemakaian mengonsumsi
 * lot dari atas (FIFO).
 */
export interface FifoLot {
  /** waktu barang masuk stok (ISO) */
  waktu: string;
  jenis: "beli" | "produksi" | "transfer" | "opname";
  nomor: string | null;
  supplier: string | null;
  qty_masuk: number;
  /**
   * harga per satuan kerja; null = tak diketahui (produksi/transfer tanpa
   * harga faktur). Lot opname naik memakai harga acuan master.
   */
  harga_satuan: number | null;
  /** true bila harga_satuan berasal dari harga acuan master (bukan faktur) */
  harga_acuan: boolean;
  terpakai: number;
  sisa: number;
  exp_date: string | null;
}

/** Rincian satu pemakaian FIFO: diambil dari lot mana saja. */
export interface FifoAmbil {
  /** indeks pada daftar `lots`; null = stok minus (keluar tanpa lot tersedia) */
  lot: number | null;
  qty: number;
  harga_satuan: number | null;
}

/** Satu peristiwa KELUAR pada kartu persediaan + rincian lot yang dikonsumsinya. */
export interface FifoPemakaian {
  waktu: string;
  jenis: "penjualan" | "pemakaian" | "kirim" | "opname";
  keterangan: string | null;
  qty: number;
  /**
   * total biaya pemakaian ini menurut metode HPP perusahaan; null bila ada
   * bagian tanpa harga yang diketahui.
   *
   * Mode `fifo`: Σ (qty × harga lot) — cocok dengan `rincian`.
   * Mode `average`: qty × `harga_rata` — SENGAJA tidak sama dengan Σ rincian,
   * karena biaya rata-rata tak mengenal identitas lot. `rincian` di mode ini
   * tetap menunjukkan lot mana yang secara FISIK keluar (untuk kedaluwarsa).
   */
  hpp: number | null;
  /**
   * harga rata-rata bergerak seluruh sisa stok sesaat SEBELUM pemakaian ini;
   * hanya terisi di mode `average` (null di mode `fifo`, atau bila ada sisa
   * lot yang harganya tak diketahui sehingga rata-rata tak bisa dihitung).
   */
  harga_rata: number | null;
  rincian: FifoAmbil[];
}

/**
 * Kartu persediaan satu bahan pada satu cabang. Lot selalu dikuras dari yang
 * PALING AWAL masuk (FIFO fisik, supaya kedaluwarsa benar); yang mengikuti
 * setelan `metode_hpp` adalah cara membebankan BIAYA-nya.
 */
export interface BahanFifoDto {
  bahan: { id: string; nama: string; satuan: string };
  branch_id: string;
  branch_nama: string;
  /** metode pembebanan biaya pemakaian: `average` = rata-rata bergerak */
  metode_hpp: "average" | "fifo";
  /** saldo akhir = Σ sisa lot − defisit; sama dengan saldo ledger cabang */
  saldo: number;
  /** stok minus yang belum tertutup lot mana pun (pemakaian saat stok kosong) */
  defisit: number;
  lots: FifoLot[];
  /** pemakaian TERBARU dulu; maksimal 300 baris — selebihnya `terpotong` */
  pemakaian: FifoPemakaian[];
  terpotong: boolean;
}

export interface SaleItemInput {
  menu_id: string;
  qty: number;
  /** override per baris; default mengikuti is_dine_in transaksi */
  is_dine_in?: boolean;
  /** catatan personalisasi per baris (mis. "tanpa gula") */
  catatan?: string | null;
  /**
   * baris open bill asal baris ini. Bila diisi (dan `open_bill_id` transaksi
   * cocok), harga jual diambil dari harga yang DIKUNCI di bill — bukan harga
   * menu terbaru. Qty tetap boleh berubah saat pembayaran.
   */
  open_bill_item_id?: string | null;
}

/**
 * SEBAB terstruktur penolakan `POST /api/penjualan` — juga muncul sebagai
 * `sebab` pada perintah `penjualan` yang gagal di `POST /api/sync`.
 *
 * Ini ADA supaya klien offline bisa memutuskan nasib perintah di antreannya
 * tanpa menebak dari teks pesan. Yang menentukan hanya satu pertanyaan:
 * **transaksinya sudah tercatat di server atau belum?**
 *
 * - `bill_sudah_dibayar` — bill sudah punya penjualan. Transaksi ini kembar
 *   dari yang sudah berhasil, jadi perintahnya AMAN dibuang dari antrean.
 * - `bill_dibatalkan` — bill ditutup lewat pembatalan, TANPA penjualan.
 *   Transaksi ini **tidak pernah tercatat**; membuangnya berarti kehilangan
 *   satu transaksi. Tampilkan ke kasir.
 * - `kasir_belum_dibuka` — tak ada shift terbuka di cabang (jalur online).
 * - `shift_tidak_cocok` — tak ada shift yang mencakup waktu transaksi (jalur
 *   `/api/sync`); membawa `data.shift_terdekat` sebagai konteks.
 *
 * Ketiga yang terakhir berarti transaksinya TIDAK tercatat.
 */
export type SebabPenjualanGagal =
  | "bill_sudah_dibayar"
  | "bill_dibatalkan"
  | "kasir_belum_dibuka"
  | "shift_tidak_cocok";

/** Baris riwayat transaksi kasir (untuk cek pesanan / cetak ulang struk). */
export interface RiwayatTransaksiRow {
  id: string;
  nomor: string;
  waktu: string;
  total: number;
  is_dine_in: boolean;
  /**
   * PENYAJIAN dari Papan Pesanan Masuk — dapur bisa mengubahnya jadi bawa
   * pulang setelah transaksi tercatat. Sengaja TERPISAH dari `is_dine_in`:
   * yang terakhir itu fakta pembukuan (di mana pesanan dimakan), sedangkan
   * INI adalah basis biaya — `hpp_satuan`, `total_hpp`, dan pemakaian bahan
   * dihitung darinya. Mengubahnya pada transaksi yang sudah dibayar MEMICU
   * hitung-ulang biaya transaksi tersebut, termasuk stok kemasan take away.
   *
   * DITURUNKAN dari baris: true hanya bila SELURUH baris transaksi ditandai
   * bawa pulang. Penandanya sendiri disimpan per baris (`sale_items`).
   */
  sajian_takeaway: boolean;
  /**
   * Cacah baris per cara penyajian — supaya klien bisa menulis "2 dari 3
   * dibungkus" alih-alih badge mutlak yang menyesatkan.
   *
   * `sajian_takeaway` di atas adalah `bool_and`: ia `false` begitu SATU baris
   * tetap di piring, jadi ia tak bisa membedakan "semuanya di piring" dari
   * "sebagian dibungkus". Dua cacah ini yang membedakannya.
   *
   * `item_takeaway + item_dine_in == jumlah_item` selalu.
   */
  item_takeaway: number;
  item_dine_in: number;
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
  /** id baris — kirim balik saat PUT agar harga terkuncinya dipertahankan */
  id: string;
  menu_id: string;
  /** nama menu saat dipesan (snapshot) */
  menu_nama: string;
  /**
   * harga jual per porsi yang DIKUNCI saat baris ini dimasukkan ke bill.
   * Inilah yang ditagih saat bill dibayar, bukan harga menu terbaru.
   */
  harga_satuan: number;
  qty: number;
  /** null = ikut mode transaksi; true/false = override dine-in per baris */
  dine_in_override: boolean | null;
  catatan: string | null;
  /**
   * Status pengerjaan dapur baris ini.
   *
   * `batal` berarti sajiannya TIDAK JADI DIBUAT — di lapangan sebabnya bahan
   * ternyata habis. Baris itu tetap ada demi jejak audit (siapa & kapan
   * membatalkannya) dan WAJIB dikirim balik saat `PUT`, karena penjaga di
   * server menolak pembaruan yang menghilangkan baris. Tapi ia tidak boleh
   * ikut ditagih: tanpa penanda ini kasir tak punya cara membedakannya dari
   * baris biasa, dan pembeli membayar makanan yang tak pernah dibuat.
   */
  pesanan_status: PesananStatus;
}

/** Ringkasan open bill untuk daftar/pemilih bill di kasir. */
export interface OpenBillRow {
  id: string;
  /**
   * Meja yang ditagih. Dipakai mencocokkan bill ke meja tanpa mengandalkan
   * `meja_label` — label itu SNAPSHOT saat bill dibuat, jadi ia berbeda dari
   * nama meja sekarang begitu mejanya diganti nama. `null` = meja sudah dihapus
   * dari master (`meja_id` ber-`onDelete: set null`) atau bill tanpa meja.
   */
  meja_id: string | null;
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

/**
 * PAPAN PESANAN MASUK — pengerjaan dapur, bukan persetujuan. Pesanan lahir
 * `dikerjakan` (masuk antrean) lalu ditandai `selesai` atau `batal`.
 */
export type PesananStatus = "dikerjakan" | "selesai" | "batal";

/**
 * Asal pesanan. `open_bill` = belum dibayar (masih bisa diubah kasir);
 * `penjualan` = sudah dibayar dan dibukukan. Satu pesanan bisa berpindah dari
 * `open_bill` ke `penjualan` saat dilunasi — statusnya ikut terbawa.
 */
export type PesananJenis = "open_bill" | "penjualan";

/**
 * Satu baris menu dalam pesanan — dan SATUAN KERJA dapur yang sebenarnya.
 *
 * Status hidup di sini, bukan di kartunya: satu bill bisa berisi minuman yang
 * sudah keluar dan gorengan yang masih digoreng, jadi dapur menandainya satu
 * per satu dan semua orang bisa melihat mana yang sudah dan mana yang belum.
 */
export interface PesananItemRow {
  /** id baris (`sale_items.id` / `open_bill_items.id`) — tujuan tombol per baris */
  id: string;
  nama: string;
  /**
   * Porsi yang HARUS DIBUAT — sudah dikurangi yang uangnya dikembalikan.
   *
   * Papan ini lembar perintah dapur, jadi angkanya harus angka yang ditagih.
   * Refund lahir justru karena bahannya habis; menampilkan porsi mentahnya akan
   * menyuruh dapur memasak sesuatu yang sudah dibatalkan dan tidak dibayar.
   */
  qty: number;
  /** porsi yang sudah dikembalikan uangnya (0 untuk bill yang belum dibayar) */
  qty_refund: number;
  /** personalisasi pelanggan, mis. "tanpa sambal" */
  catatan: string | null;
  is_dine_in: boolean;
  status: PesananStatus;
  /**
   * Penyajian "bawa pulang" per baris. SENGAJA terpisah dari `is_dine_in`:
   * yang terakhir itu fakta pembukuan (di mana pesanan dimakan) dan TIDAK
   * diubah oleh papan; yang INI adalah basis biaya — pemakaian bahan & HPP
   * baris ini dihitung darinya, jadi menandainya bawa pulang membuat kemasan
   * take away benar-benar terpakai dan stoknya berkurang.
   */
  sajian_takeaway: boolean;
  /** siapa & kapan status baris ini terakhir diubah; null = belum disentuh */
  status_oleh: string | null;
  status_pada: string | null;
}

/** Satu kartu di papan pesanan. */
export interface PesananRow {
  id: string;
  jenis: PesananJenis;
  /** nomor struk; null selama masih open bill (belum ada transaksi) */
  nomor: string | null;
  meja: string | null;
  customer: string | null;
  /** waktu pesanan masuk (ISO) */
  waktu: string;
  total: number;
  dibayar: boolean;
  /**
   * DITURUNKAN dari `items`, tidak disimpan: `batal` bila semua baris batal,
   * `selesai` bila semua baris sudah selesai/batal (dan ada yang selesai),
   * selain itu `dikerjakan`. Kartu tanpa baris dianggap `dikerjakan`.
   */
  status: PesananStatus;
  /** DITURUNKAN: true bila SEMUA baris ditandai bawa pulang */
  sajian_takeaway: boolean;
  is_dine_in: boolean;
  catatan: string | null;
  items: PesananItemRow[];
  /** jumlah baris yang sudah `selesai` — untuk ringkasan "2/3 selesai" */
  item_selesai: number;
  /** jumlah baris yang `batal` */
  item_batal: number;
  /** perubahan status baris terakhir pada kartu ini; null = belum ada */
  status_oleh: string | null;
  status_pada: string | null;
}

/** Satu baris riwayat perubahan status sebuah pesanan. */
export interface PesananLogRow {
  waktu: string;
  aksi: string;
  oleh: string | null;
  /** nama baris yang disentuh; null = aksinya mengenai seluruh pesanan */
  item_nama: string | null;
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
  /** null saat `hitung_buta` — SENGAJA null, bukan 0 (0 berarti "tak ada penjualan tunai") */
  penjualan_tunai: number | null;
  penjualan_nontunai: number;
  jumlah_transaksi: number;
  /** kas seharusnya di laci = modal_awal + penjualan_tunai; null bila `hitung_buta` */
  kas_sistem: number | null;
  /** uang_fisik − kas_sistem (null sebelum hitungan dikunci / bila `hitung_buta`) */
  selisih: number | null;
  /** ada transaksi susulan (sinkron offline) setelah shift ditutup → rekap dihitung ulang */
  ada_transaksi_susulan: boolean;
  /**
   * HITUNG BUTA. true = angka kas SENGAJA disembunyikan dari pemanggil:
   * `penjualan_tunai`, `kas_sistem`, dan `selisih` bernilai `null`.
   *
   * Berlaku untuk peran terkunci cabang (kasir/tim) selama shift masih terbuka
   * DAN hitungan belum dikunci. Alasannya: kalau kasir bisa melihat "seharusnya
   * Rp X" sebelum menghitung, penghitungan laci berhenti jadi pemeriksaan —
   * angka itu tinggal disalin dan selisih apa pun tak akan pernah terlihat.
   *
   * Dibuka oleh `POST /shift/kunci-hitungan` (uang fisik dikunci lebih dulu,
   * jadi angkanya tak bisa diubah setelah jawabannya terlihat). Owner/admin
   * tak pernah dibutakan — merekalah yang menyetujui selisih.
   *
   * `modal_awal` TIDAK ikut disembunyikan: itu angka yang kasir sendiri ketik
   * saat buka kasir, dan tanpa `penjualan_tunai` ia tak membocorkan apa pun.
   */
  hitung_buta: boolean;
  /**
   * Kapan hitungan uang fisik dikunci (`POST /shift/kunci-hitungan`). `null`
   * bila shift ditutup satu langkah tanpa penguncian. Jejak audit: hanya shift
   * ber-nilai inilah yang uang fisiknya benar-benar dihitung sebelum kas sistem
   * terlihat.
   */
  hitungan_dikunci_pada: string | null;
  /**
   * `null` selagi shift masih TERBUKA. Setelah ditutup:
   * - `"pas"` — uang fisik sama dengan kas sistem; tak perlu persetujuan;
   * - `"menunggu"` — ada selisih, owner/admin belum memutuskan;
   * - `"disetujui"` / `"ditolak"` — sudah diputuskan.
   *
   * Kasir tak pernah bisa mengubah status ini.
   */
  status_selisih: StatusSelisih | null;
  /** keterangan kasir atas selisih (dari `catatan` bila tak dikirim terpisah) */
  selisih_alasan: string | null;
  /** nama owner/admin yang memutuskan (null selama masih menunggu) */
  selisih_disetujui_oleh: string | null;
  selisih_diputus_pada: string | null;
  /** alasan penolakan — wajib diisi saat menolak */
  alasan_tolak: string | null;
}

/**
 * Status selisih kas satu shift. `"pas"` sengaja dipisah dari `null`: `null`
 * berarti "shift masih terbuka, belum ada apa-apa untuk dinilai", sedangkan
 * `"pas"` berarti "sudah dihitung dan memang tak ada selisih". Tanpa pemisahan
 * itu klien tak bisa membedakan keduanya.
 */
export type StatusSelisih = "pas" | "menunggu" | "disetujui" | "ditolak";

/** Satu baris daftar selisih kas yang menunggu keputusan owner. */
export interface SelisihKasRow {
  id: string;
  branch_nama: string;
  ditutup_oleh: string | null;
  ditutup_pada: string | null;
  kas_sistem: number;
  uang_fisik: number;
  selisih: number;
  catatan: string | null;
  status_selisih: StatusSelisih;
}

/**
 * Jenis perintah yang bisa diantre offline & disinkron via POST /api/sync.
 * Fase 1: penjualan + absen. Fase 2: opname, perlengkapan, faktur tahap/kirim,
 * penerimaan. Payload = body endpoint asli (+ path param bila ditandai).
 */
export type SyncTipe =
  /** buka kasir; `waktu` jadi `opened_at` shift (payload `{branch_id?, modal_awal?}`) */
  | "shift_buka"
  | "penjualan"
  | "absen_saya"
  | "absen_stasiun"
  // Fase 2
  | "stok_opname"
  | "perlengkapan_opname"
  | "perlengkapan_pakai" // payload + supply_id
  | "faktur_tahap" // payload + jalur ("produksi"|"pembelian") + faktur_id
  | "faktur_kirim" // payload + jalur + faktur_id
  | "produksi_kirim_hasil" // payload + faktur_id
  | "penerimaan_terima" // payload + faktur_id
  | "penerimaan_terima_sebagian" // payload + faktur_id
  | "penerimaan_tolak"; // payload + faktur_id

/** Satu perintah offline dalam batch sinkron (payload = body endpoint aslinya). */
export interface SyncCommand {
  /** idempotency key (uuid v4), unik per perusahaan */
  client_ref: string;
  tipe: SyncTipe;
  /** waktu kejadian di perangkat (ISO UTC) */
  waktu: string;
  payload: unknown;
}

/** Body POST /api/sync — batch perintah urut kronologis (maks 100). */
export interface SyncRequest {
  device_id?: string | null;
  commands: SyncCommand[];
}

/** Hasil satu perintah (urutan sama dengan permintaan). */
export interface SyncItemResult {
  client_ref: string;
  /** ok = baru dieksekusi; sudah_ada = idempoten (retry); gagal = ditolak */
  status: "ok" | "sudah_ada" | "gagal";
  /** kode HTTP hasil eksekusi endpoint asli */
  kode: number;
  /**
   * Saat ok/sudah_ada: data respons endpoint asli. Saat gagal: data lanjutan
   * yang menyertai `sebab` — mis. `{ shift_terdekat: {...} }` pada
   * `shift_tidak_cocok`, supaya mobile bisa menawarkan aksi perbaikan.
   */
  data?: unknown;
  /** pesan error endpoint asli (saat gagal) */
  error?: string;
  /**
   * Penyebab penolakan dalam bentuk yang bisa dicabang oleh kode (saat gagal).
   * Tanpa ini mobile hanya melihat teks generik dan tak bisa membedakan
   * "shift tidak cocok" dari kegagalan lain. Kode `sebab` yang ada saat ini:
   * - `shift_tidak_cocok` — 409 pada `penjualan`; `data.shift_terdekat` berisi
   *   shift tertutup terdekat sebelum `waktu` (atau null bila memang tak ada).
   */
  sebab?: string;
}

/** Respons POST /api/sync — selalu 200; detail per item. */
export interface SyncResponse {
  hasil: SyncItemResult[];
}

/** Satu transaksi milik sebuah shift (untuk detail shift). */
export interface ShiftTransaksiRow {
  id: string;
  nomor: string;
  waktu: string;
  total: number;
  metode: MetodeBayar;
  kasir: string | null;
  /**
   * true bila transaksi masuk SETELAH shift ditutup (sinkron offline) —
   * `waktu`-nya di luar jendela shift, jadi baris inilah yang membuat rekap
   * terkini berbeda dari angka saat penutupan.
   */
  susulan: boolean;
}

/** Detail satu shift = ringkasan shift + daftar transaksi di jendela waktunya. */
export interface ShiftDetail extends Shift {
  transaksi: ShiftTransaksiRow[];
}

/**
 * Status operasional satu cabang store untuk pantauan owner/admin
 * (GET /shift/pantau). Penjualan_* = total HARI INI (zona waktu perusahaan);
 * meta shift (dibuka_*) hanya terisi bila ada shift kasir yang sedang terbuka.
 */
export interface ShiftPantauRow {
  branch_id: string;
  branch_nama: string;
  /** jam operasional cabang "HH:MM" (null bila belum diatur) */
  jam_buka: string | null;
  jam_tutup: string | null;
  /** shift kasir yang sedang terbuka (null = kasir tutup) */
  shift_id: string | null;
  dibuka_oleh: string | null;
  dibuka_pada: string | null;
  modal_awal: number | null;
  penjualan_tunai: number;
  penjualan_nontunai: number;
  jumlah_transaksi: number;
  /** kas seharusnya = modal_awal + penjualan tunai hari ini (0 bila tutup) */
  kas_sistem: number;
  /** sudah ada shift dibuka hari ini? */
  buka_hari_ini: boolean;
  /** sudah lewat jam buka tapi kasir belum dibuka hari ini */
  telat_buka: boolean;
  /** kasir masih terbuka padahal sudah lewat jam tutup */
  lupa_tutup: boolean;
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

/* ===== Pengajuan cuti & libur + rekap absen bulanan ===== */

/**
 * Satu pengajuan cuti/libur. `jenis` SELALU turunan `kategori` (server yang
 * menurunkannya lewat `jenisKategori()`) — klien tak pernah mengirimnya.
 */
export interface PengajuanRow {
  id: string;
  user_id: string;
  nama: string;
  employee_code: string | null;
  /** cabang pemohon saat mengajukan; null untuk owner/admin tanpa cabang */
  cabang: string | null;
  jenis: PengajuanJenis;
  kategori: PengajuanKategori;
  /** YYYY-MM-DD; satu hari → mulai == selesai */
  tanggal_mulai: string;
  tanggal_selesai: string;
  /** jumlah hari kalender yang dicakup (inklusif) */
  jumlah_hari: number;
  alasan: string | null;
  /** bukti pendukung (mis. surat dokter) — hasil POST /upload?tujuan=bukti */
  lampiran_url: string | null;
  status: PengajuanStatus;
  /** wajib terisi bila status "ditolak" */
  alasan_tolak: string | null;
  /** nama owner/admin yang memutuskan; null selama masih "menunggu" */
  diputus_oleh: string | null;
  diputus_pada: string | null;
  created_at: string;
}

/**
 * Status satu tanggal pada rekap. `kosong` = di LUAR jendela hitung (tanggal
 * belum lewat, sebelum karyawan bergabung, atau setelah ia diarsipkan) — tidak
 * pernah dihitung sebagai apa pun.
 */
export type RekapHariStatus = "hadir" | "cuti" | "libur" | "alpa" | "kosong";

/** Isi satu kolom tanggal pada rekap absen. */
export interface RekapAbsenHari {
  tanggal: string;
  status: RekapHariStatus;
  /** terisi hanya bila status cuti/libur */
  kategori: PengajuanKategori | null;
  /** jam masuk pertama (ISO); null bila tak ada cap masuk */
  masuk: string | null;
  /** jam keluar terakhir (ISO); null bila belum/tak ada cap keluar */
  keluar: string | null;
}

/** Satu baris (satu karyawan) pada rekap absen bulanan. */
export interface RekapAbsenRow {
  user_id: string;
  nama: string;
  employee_code: string | null;
  role: UserRole | null;
  cabang: string | null;
  /**
   * Kapan keanggotaannya diarsipkan (karyawan keluar) — null = masih aktif.
   * Dipakai UI untuk menandai baris; hitungannya sendiri sudah berhenti di
   * tanggal ini.
   */
  arsip_pada: string | null;
  hadir: number;
  tidak_hadir: number;
  cuti: number;
  libur: number;
  /** satu entri per tanggal dalam bulan itu, urut tanggal 1..akhir */
  harian: RekapAbsenHari[];
}

/**
 * Rekap absen sebulan (GET /absensi/rekap) — khusus owner/admin.
 * Baris yang masuk mengikuti `?status=aktif|arsip|semua` (bawaan `aktif`).
 */
export interface RekapAbsenDto {
  /** YYYY-MM */
  bulan: string;
  dari: string;
  sampai: string;
  /** jumlah hari dalam bulan itu */
  hari: number;
  /**
   * Jumlah hari yang SUDAH lewat (≤ hari ini) — pembagi yang benar untuk
   * persentase kehadiran; hari yang belum datang tak pernah dihitung.
   */
  hari_terhitung: number;
  rows: RekapAbsenRow[];
}

/* ===== Laporan kebersihan harian ===== */

/**
 * Satu area pada master checklist kebersihan (diatur owner).
 * `branch_id` null = area berlaku di SEMUA lokasi.
 */
export interface AreaKebersihanDto {
  id: string;
  nama: string;
  branch_id: string | null;
  /** nama cabang bila area khusus satu lokasi; null = semua lokasi */
  cabang: string | null;
  urutan: number;
  is_active: boolean;
}

/** Satu baris checklist di dalam sebuah laporan kebersihan. */
export interface LaporanKebersihanItem {
  id: string;
  /** null bila area masternya sudah dihapus — `area_nama` tetap terbaca */
  area_id: string | null;
  /** salinan nama area saat laporan dibuat (tahan rename/hapus master) */
  area_nama: string;
  bersih: boolean;
  catatan: string | null;
  /** hasil POST /upload?tujuan=bukti; minimal satu item per laporan wajib terisi */
  foto_url: string | null;
  urutan: number;
}

/** Laporan kebersihan lengkap beserta checklist-nya (GET /kebersihan/:id). */
export interface LaporanKebersihanDto {
  id: string;
  user_id: string;
  nama: string;
  branch_id: string;
  cabang: string | null;
  /** YYYY-MM-DD, selalu diturunkan server dari zona waktu perusahaan */
  tanggal: string;
  sesi: KebersihanSesi;
  catatan: string | null;
  /** balasan owner/admin; null bila belum dikomentari */
  catatan_owner: string | null;
  catatan_owner_oleh: string | null;
  catatan_owner_pada: string | null;
  total_area: number;
  area_bersih: number;
  area_kotor: number;
  jumlah_foto: number;
  created_at: string;
  updated_at: string;
  items: LaporanKebersihanItem[];
}

/** Baris ringkas sebuah laporan pada rekap harian (tanpa detail checklist). */
export interface LaporanKebersihanRingkas {
  id: string;
  user_id: string;
  nama: string;
  branch_id: string;
  cabang: string | null;
  sesi: KebersihanSesi;
  total_area: number;
  area_bersih: number;
  area_kotor: number;
  jumlah_foto: number;
  /** foto pertama sebagai pratinjau; null bila entah bagaimana tak ada */
  foto_utama: string | null;
  ada_catatan_owner: boolean;
  created_at: string;
}

/** Satu kotak = satu hari pada rekap kebersihan. */
export interface RekapKebersihanHari {
  /** YYYY-MM-DD */
  tanggal: string;
  /** jumlah laporan hari itu (semua tim, semua cabang) */
  total: number;
  /** jumlah baris checklist yang ditandai TIDAK bersih hari itu */
  area_kotor: number;
  /** berapa laporan per sesi */
  sesi: { pagi: number; siang: number; malam: number };
  /** sudah terurut cabang → sesi → waktu kirim */
  laporan: LaporanKebersihanRingkas[];
}

/**
 * Rekap kebersihan sebulan (GET /kebersihan/rekap) — khusus owner/admin.
 * Hari tanpa laporan tetap muncul (kotak kosong) supaya bolongnya kelihatan.
 */
export interface RekapKebersihanDto {
  /** YYYY-MM */
  bulan: string;
  dari: string;
  sampai: string;
  /** terbaru di depan */
  hari: RekapKebersihanHari[];
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
  /** rak simpan default (tempat penyimpanan) — utk memilih lokasi saat opname */
  rak: { id: string; nama: string } | null;
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
  /**
   * DI SIMPAN DI MANA: rak per cabang (CK & cabang store), sumbernya Tempat
   * Penyimpanan (tabel yang sama dengan bahan baku). READ-ONLY — diatur di
   * Tempat Penyimpanan, bukan di form Perlengkapan.
   */
  rak_lokasi: RakLokasi[];
  /** nama supplier utama/langganan (null = belum diatur) */
  supplier_utama: string | null;
  jumlah_supplier: number;
  /** cabang dengan saldo ≠ 0 ATAU aturan konsumsi terpasang */
  lokasi: PerlengkapanLokasiDto[];
}

/**
 * Hasil "permintaan perlengkapan otomatis" untuk satu cabang: untuk item yang
 * saldo ≤ stok minimum, kiriman KP- dibuat sebanyak stok yang ADA di CK;
 * kekurangan yang belum tertutup CK dilaporkan sebagai "perlu beli di CK".
 */
export interface PermintaanPerlengkapanOtomatisHasil {
  /** kiriman KP- yang berhasil diterbitkan (dari stok CK) */
  dibuat: {
    supply_id: string;
    nama: string;
    satuan: string;
    qty: number;
    nomor: string | null;
  }[];
  /**
   * kekurangan yang stok CK tak cukup → faktur BELI (BP-) ke CK diterbitkan;
   * dibeli → tiba di CK → otomatis dikirim ke cabang tujuan (seperti bahan baku)
   */
  beli_dibuat: {
    supply_id: string;
    nama: string;
    satuan: string;
    qty: number;
    nomor: string | null;
    tujuan_nama: string | null;
  }[];
  /**
   * FAKTUR BP- yang menaungi seluruh `beli_dibuat` (satu faktur multi-item,
   * seperti faktur beli bahan baku). Null bila tak ada yang perlu dibeli.
   */
  beli_faktur: { faktur_id: string; nomor: string; jumlah_baris: number } | null;
  /** item ≤ minimum tapi cabang ini bukan store / tak terhubung CK */
  tak_bisa_kirim: { supply_id: string; nama: string; satuan: string; qty: number }[];
}

/** Status faktur beli perlengkapan ke CK. */
export type BeliPerlengkapanStatus = "menunggu" | "diproses" | "tiba" | "batal";

/** Satu BARIS faktur beli perlengkapan ke Central Kitchen (BP-). */
export interface BeliPerlengkapanRow {
  id: string;
  /**
   * FAKTUR pengelompokan: baris satu submit berbagi faktur_id & satu nomor
   * BP-. Null hanya untuk baris warisan (pra-faktur, nomor per baris).
   */
  faktur_id: string | null;
  supply_id: string;
  nama: string;
  satuan: string;
  qty: number;
  total_harga: number | null;
  status: BeliPerlengkapanStatus;
  /** CK tujuan beli (tempat barang masuk stok) */
  ck_nama: string;
  /** cabang store yang butuh — dikirim otomatis setelah tiba (null = stok CK saja) */
  tujuan_nama: string | null;
  catatan: string | null;
  waktu: string;
  oleh: string | null;
  nomor: string | null;
  /** pemroses belanja — tercatat saat faktur ditandai 'diproses' */
  diproses_oleh: string | null;
  /** supplier LANGGANAN item (is_utama) — "tempat beli" di kartu & Dokumen RAB */
  supplier_utama: string | null;
  /** harga beli per satuan dari master — estimasi RAB (qty × harga_beli) */
  harga_beli: number;
  /**
   * Faktur ini terkait PERMINTAAN yang MASIH AKTIF (rencana_id punya produksi
   * yang belum dihapus). true → tak boleh Hapus permanen dari sini (kelola dari
   * Permintaan Stok); false (manual / permintaan sudah tak ada) → boleh Hapus.
   */
  permintaan_aktif: boolean;
}

/**
 * KIRIMAN MENGGANTUNG — barang yang sudah berpindah cabang tapi tak bisa
 * diterima siapa pun: tak ada tombol Terima, stok tak pernah bertambah, dan
 * tak ada satu pun layar yang menampilkannya. Fakturnya berbunyi "Dikirim"
 * padahal barangnya hilang dari pembukuan.
 *
 * Jumlah yang BENAR adalah NOL. Apa pun di atas nol berarti ada barang yang
 * perlu ditangani manusia — bukan sekadar angka untuk dipajang.
 */
export interface KirimanMenggantung {
  id: string;
  faktur_id: string;
  /** nomor faktur (PB-/PR-) supaya bisa dicocokkan dgn kartu Beli/Produksi */
  nomor: string | null;
  tipe: JenisPengadaan;
  status: KonfirmasiStatus;
  qty: number;
  waktu: string;
  bahan: string;
  satuan: string;
  /** cabang tempat barangnya tercatat sekarang */
  posisi_sekarang: string | null;
  /** cabang yang mengirimnya */
  dikirim_dari: string | null;
  /** sudah berapa hari menggantung — makin tua makin gawat */
  umur_hari: number;
}

/** Satu barang di dalam satu kiriman yang sudah diterima/ditolak. */
export interface RiwayatPenerimaanItem {
  id: string;
  bahan: string;
  satuan: string;
  /** qty yang BENAR-BENAR diterima */
  qty: number;
  qty_teks: string;
  /** qty yang dikirim — hanya terisi bila dipakai Terima Sebagian */
  qty_dipesan: number | null;
  qty_dipesan_teks: string | null;
  status: KonfirmasiStatus;
  tempat: string | null;
  total_harga: number | null;
}

/**
 * RIWAYAT PENERIMAAN, satu entri = SATU FAKTUR (satu surat jalan) — satuan
 * yang sama dengan daftar "Menunggu penerimaan", supaya orang gudang tak perlu
 * berpindah cara pandang saat mencocokkan.
 */
export interface RiwayatPenerimaanFaktur {
  faktur_id: string;
  /** nomor dokumen (PB-/PR-/TF-) */
  nomor: string | null;
  no_faktur: string | null;
  jalur: JenisPengadaan;
  cabang: string | null;
  supplier: string | null;
  /** waktu keputusan TERAKHIR — satu faktur bisa diterima bertahap */
  waktu: string | null;
  /** siapa yang menerima/menolak */
  oleh: string | null;
  alasan_tolak: string | null;
  /** diterima = utuh, sebagian = ada yang kurang/ditolak, ditolak = tak ada yang masuk */
  hasil: "diterima" | "sebagian" | "ditolak";
  jumlah_item: number;
  items: RiwayatPenerimaanItem[];
}

/** Ringkasan pendeteksi kiriman menggantung; `jumlah: 0` = sehat. */
export interface AnomaliKiriman {
  jumlah: number;
  qty_total: number;
  rows: KirimanMenggantung[];
}

/** Hasil penghapusan kiriman menggantung (id yang tak menggantung dilewati). */
export interface TutupAnomaliHasil {
  ditutup: number;
  dilewati: number;
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

/** Metode perhitungan HPP (laba-rugi) yang dipilih perusahaan. */
export type MetodeHpp = "average" | "fifo";

/**
 * Satu "lot" pembelian barang (bahan baku / perlengkapan): satu baris beli
 * dengan qty + total harga → dasar perhitungan HPP FIFO/rata-rata. `harga_satuan`
 * = total_harga / qty (null bila harga belum dilaporkan).
 */
export interface RiwayatHargaLot {
  id: string;
  tanggal: string;
  qty: number;
  total_harga: number | null;
  harga_satuan: number | null;
  supplier: string | null;
  /** nomor nota supplier (bila diisi manual) */
  no_faktur: string | null;
  /** nomor dokumen otomatis (PB-/PL-) */
  nomor: string | null;
}

/** Titik harga ekstrem riwayat pembelian: nilainya berapa & kapan terjadi. */
export interface HargaEkstrem {
  /** harga per satuan */
  harga: number;
  /** tanggal lot pembelian (YYYY-MM-DD) */
  tanggal: string;
}

/**
 * Riwayat harga beli satu barang: daftar lot pembelian + harga terkini &
 * rata-rata tertimbang. Dipakai kartu "Riwayat Harga" (bahan baku & perlengkapan)
 * sebagai fondasi hitung laba-rugi (FIFO/average).
 */
export interface RiwayatHargaDto {
  item: {
    id: string;
    nama: string;
    satuan: string;
    /** isi per kemasan dalam satuan (1 = tanpa kemasan; perlengkapan selalu 1) */
    isi: number;
    /** satuan beli/kemasan (mis. "kg", "dus") — null bila tak diatur */
    satuan_beli: string | null;
  };
  /** harga per satuan terkini (harga_beli / isi utk bahan; harga_beli utk perlengkapan) */
  harga_terkini: number;
  /** rata-rata tertimbang per satuan dari lot berharga (null bila belum ada) */
  harga_rata: number | null;
  /** harga per satuan terendah dari lot berharga + kapan (null bila belum ada) */
  harga_terendah: HargaEkstrem | null;
  /** harga per satuan tertinggi dari lot berharga + kapan (null bila belum ada) */
  harga_tertinggi: HargaEkstrem | null;
  /**
   * median harga per satuan dari lot berharga (null bila belum ada) — dasar
   * HARGA ACUAN utk RAB beli bahan baku (disinkron saat Laporan Harga); harga
   * riil tiap pembelian tetap tercatat per lot utk HPP FIFO/resep.
   */
  harga_median: number | null;
  /** jumlah lot pembelian tercatat */
  jumlah_pembelian: number;
  lots: RiwayatHargaLot[];
}
