import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Peran: owner/admin = manajemen (lintas cabang); cashier = kasir cabang;
 * tim = anggota tim cabang (cek stok, lihat menu, penerimaan barang, riwayat
 * transaksi — tanpa kasir); kitchen = tim cabang STORE + produksi lokal
 * (hasil masuk stok cabangnya); bar = sama seperti kitchen tetapi DIVISI BAR —
 * hanya memproduksi resep ber-divisi_produksi "bar" (kitchen hanya "kitchen").
 * cashier, tim, kitchen & bar terikat ke satu cabang.
 */
export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "cashier",
  "tim",
  "kitchen",
  "bar",
]);
export const menuTipeEnum = pgEnum("menu_tipe", ["regular", "paket"]);
/** jalur pengadaan bahan: diproduksi sendiri vs dibeli jadi */
export const pengadaanEnum = pgEnum("pengadaan", ["produksi", "beli"]);
/**
 * Lokasi produksi bahan jalur "produksi": di Central Kitchen (default; hasil
 * dikirim ke cabang) atau di CABANG store (kitchen toko memproduksi sendiri —
 * hasil langsung masuk stok cabang itu). Diabaikan untuk pengadaan "beli".
 */
export const produksiDiEnum = pgEnum("produksi_di", ["ck", "cabang"]);
/**
 * Divisi produksi resep saat produksi_di="cabang": "kitchen" (dapur) atau
 * "bar" (minuman). Role kitchen hanya boleh memproduksi resep divisi kitchen;
 * role bar hanya resep divisi bar. Diabaikan saat produksi_di="ck".
 */
export const divisiProduksiEnum = pgEnum("divisi_produksi", ["kitchen", "bar"]);
/**
 * Status pipeline stok masuk: rencana (RAB) → dikerjakan (produksi: dikerjakan;
 * beli: diproses) → menunggu (produksi: selesai—menunggu konfirmasi; beli:
 * dikirim—menunggu penerimaan toko) → dikonfirmasi (masuk stok). 'ditolak'
 * khusus jalur beli: kiriman ditolak penerima (bisa dibatalkan → dikonfirmasi).
 * Stok baru terhitung saat 'dikonfirmasi'.
 */
export const konfirmasiStatusEnum = pgEnum("konfirmasi_status", [
  "rencana",
  "dikerjakan",
  "menunggu",
  "dikonfirmasi",
  "ditolak",
]);
/** kategori klarifikasi selisih opname (waste vs koreksi pencatatan) */
export const penyesuaianKategoriEnum = pgEnum("penyesuaian_kategori", [
  "waste_bahan",
  "waste_matang",
  "waste_gagal",
  "koreksi_pencatatan",
  "lainnya",
]);
/** status klarifikasi penyesuaian stok */
export const klarifikasiStatusEnum = pgEnum("klarifikasi_status", ["belum", "sudah"]);
/**
 * status persetujuan penyesuaian stok: opname baru jadi baseline saldo
 * ('disetujui') hanya setelah owner/admin ACC sesi opname. 'ditolak' = sesi
 * ditolak owner/admin (selisih dibuang, stok tak berubah).
 */
export const penyesuaianStatusEnum = pgEnum("penyesuaian_status", [
  "menunggu",
  "disetujui",
  "ditolak",
]);
/** jenis meja: meja makan biasa (dine-in) vs meja "Ruang Tunggu" untuk take away */
export const mejaTipeEnum = pgEnum("meja_tipe", ["dine_in", "takeaway"]);
export const metodeBayarEnum = pgEnum("metode_bayar", ["tunai", "qris", "transfer"]);
/** jenis cap absensi karyawan: masuk (datang) vs keluar (pulang) */
export const attendanceTipeEnum = pgEnum("attendance_tipe", ["masuk", "keluar"]);

/**
 * Jenis entri buku dana faktur: 'cair' = pencairan RAB; 'tambahan' = dana
 * ekstra saat realisasi lebih besar (catatan: dari mana uangnya); 'kembali' =
 * sisa dana saat realisasi lebih kecil (catatan: di siapa uangnya).
 */
export const danaTipeEnum = pgEnum("dana_tipe", ["cair", "tambahan", "kembali"]);

// ===== Tenancy & identitas =====

/**
 * Metode perhitungan HPP/harga pokok untuk laba-rugi: average (rata-rata
 * bergerak) atau fifo (masuk pertama keluar pertama). Data pembelian dicatat
 * per-lot (qty+harga+tanggal) sehingga mendukung keduanya.
 */
export const metodeHppEnum = pgEnum("metode_hpp", ["average", "fifo"]);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  nama: text("nama").notNull(),
  /** metode HPP untuk laba-rugi (average default) */
  metodeHpp: metodeHppEnum("metode_hpp").notNull().default("average"),
  slug: text("slug").notNull().unique(),
  alamat: text("alamat"),
  telepon: text("telepon"),
  logoUrl: text("logo_url"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  pb1Enabled: boolean("pb1_enabled").notNull().default(false),
  pb1Rate: numeric("pb1_rate", { precision: 5, scale: 2, mode: "number" })
    .notNull()
    .default(10),
  receiptFooter: text("receipt_footer"),
  receiptShowAlamat: boolean("receipt_show_alamat").notNull().default(true),
  /** batas maksimal diskon (%) yang boleh diberikan KASIR; owner/admin bebas. 100 = tanpa batas */
  diskonMaksPersen: numeric("diskon_maks_persen", { precision: 5, scale: 2, mode: "number" })
    .notNull()
    .default(100),
  /** target penjualan (Rp) default untuk rekomendasi kebutuhan bahan baku */
  targetPenjualan: numeric("target_penjualan", { precision: 14, scale: 2, mode: "number" }),
  plan: text("plan").notNull().default("free"),
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Jenis cabang: 'store' = outlet penjualan; 'central_kitchen' = dapur pusat
 * yang memproses/produksi bahan lalu MENGIRIM ke cabang store (lewat tujuan
 * kirim pada tahap faktur); 'kantor' = lokasi kerja admin/finance —
 * hanya untuk penempatan karyawan & absensi, bukan tujuan kirim barang.
 */
export const branchTipeEnum = pgEnum("branch_tipe", ["store", "central_kitchen", "kantor"]);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    alamat: text("alamat"),
    telepon: text("telepon"),
    tipe: branchTipeEnum("tipe").notNull().default("store"),
    /**
     * Cabang store terhubung ke SATU central kitchen (pemasoknya) — CK hanya
     * boleh mengirim ke store yang terhubung dengannya. NULL untuk CK/kantor
     * atau perusahaan tanpa CK.
     */
    centralKitchenId: uuid("central_kitchen_id").references((): AnyPgColumn => branches.id, {
      onDelete: "set null",
    }),
    /**
     * Pengaturan struk PER CABANG — alamat/telepon cabang inilah yang tercetak
     * di struk (perusahaan hanya menyimpan identitas holding/global).
     */
    receiptFooter: text("receipt_footer"),
    receiptShowAlamat: boolean("receipt_show_alamat").notNull().default(true),
    /**
     * Titik lokasi cabang (maps) + radius absen: bila lat/lng terisi, absen
     * karyawan hanya diterima dalam radius ini dari titik cabang.
     */
    latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
    longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
    radiusAbsenM: integer("radius_absen_m").notNull().default(100),
    /**
     * Jam operasional cabang "HH:MM" (opsional) — dipakai memantau operasional
     * kasir: telat buka (lewat jamBuka tapi belum buka kasir) & lupa tutup
     * (masih terbuka padahal sudah lewat jamTutup). Tidak memblokir transaksi.
     */
    jamBuka: text("jam_buka"),
    jamTutup: text("jam_tutup"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("branches_company_nama_uq").on(t.companyId, t.nama)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nama: text("nama").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Versi token sesi — dinaikkan setiap password diubah (reset via email, ganti
   * sendiri, atau di-reset admin) untuk MEMBATALKAN semua token lama. JWT
   * membawa klaim `tv`; bila `tv` token ≠ nilai ini, sesi ditolak (401). Token
   * lama tanpa `tv` dianggap 0 → tetap sah selama versi masih 0 (tanpa
   * memaksa logout massal saat fitur ini dirilis).
   */
  tokenVersion: integer("token_version").notNull().default(0),
  /**
   * Verifikasi email: terisi = email sudah dikonfirmasi (klik tautan). NULL =
   * belum → login diblokir (kecuali super admin). Pendaftaran mandiri dibuat
   * NULL; akun yang dibuat admin/seed/undangan langsung terisi (pra-verifikasi).
   */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /**
   * Hapus akun sendiri = SOFT delete (tombstone): terisi = akun dihapus, tak
   * bisa login. Riwayat (transaksi, absensi, log faktur) tetap utuh karena
   * baris user tetap ada. Saat dihapus, email di-rename agar alamat bebas
   * dipakai daftar ulang.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    branchId: uuid("branch_id").references(() => branches.id),
    /** kode karyawan (untuk absensi via kode/QR) — unik per perusahaan, digenerate otomatis */
    employeeCode: text("employee_code"),
    /**
     * Arsip karyawan: terisi = keluar dari daftar & tidak bisa login/absen di
     * perusahaan ini, tapi riwayat (log, faktur, absensi) tetap tersimpan.
     * Bisa dipulihkan dengan mengosongkan kembali.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_company_uq").on(t.userId, t.companyId),
    // owner/admin boleh lintas cabang; peran lain (kasir, tim) wajib punya
    // cabang. Ditulis tanpa literal 'tim' agar migrasi aman dijalankan satu
    // transaksi dengan ALTER TYPE ADD VALUE (nilai enum baru belum bisa dipakai).
    check("memberships_cashier_branch_ck", sql`${t.role} IN ('owner','admin') OR ${t.branchId} IS NOT NULL`),
    // kode karyawan unik per perusahaan (abaikan yang NULL)
    uniqueIndex("memberships_company_kode_uq")
      .on(t.companyId, t.employeeCode)
      .where(sql`${t.employeeCode} IS NOT NULL`),
  ],
);

/** Status undangan karyawan: menunggu diterima / sudah diterima / dibatalkan. */
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
]);

/**
 * Undangan karyawan (alur "menunggu diundang"): owner/admin mengundang sebuah
 * EMAIL ke perusahaan + peran + cabang. Undangan tertunda; saat email itu
 * mendaftar (auto-join) atau menerima dari halaman onboarding, membership
 * dibuat & status → accepted. Satu undangan pending per (perusahaan, email).
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** token acak (untuk tautan email di PR berikutnya) — unik */
    token: text("token").notNull().unique(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitations_email_idx").on(t.email),
    index("invitations_company_idx").on(t.companyId),
    // satu undangan PENDING per (perusahaan, email) — cegah duplikat
    uniqueIndex("invitations_company_email_pending_uq")
      .on(t.companyId, t.email)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Mode enkripsi koneksi SMTP: tanpa / SSL (465) / STARTTLS (587). */
export const smtpEncryptionEnum = pgEnum("smtp_encryption", ["none", "ssl", "starttls"]);

/**
 * Pengaturan email (SMTP) TINGKAT PLATFORM — satu baris (singleton), diatur
 * super admin. Dipakai untuk email sistem: reset password (termasuk user yang
 * belum punya perusahaan) & undangan. Bila kosong/tak lengkap, email tak
 * terkirim (dev: tautan dicatat di log / dikembalikan saat belum dikonfigurasi).
 */
export const smtpSettings = pgTable("smtp_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: text("host"),
  port: integer("port").notNull().default(587),
  username: text("username"),
  password: text("password"),
  encryption: smtpEncryptionEnum("encryption").notNull().default("starttls"),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Token reset password (lupa password): dikirim via email sebagai tautan.
 * Disimpan sebagai HASH (bukan token mentah). Sekali pakai + kedaluwarsa.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_reset_user_idx").on(t.userId)],
);

/**
 * Rate limiter TERPUSAT (fixed window) — pengganti store in-memory per-proses.
 * Satu baris per bucket (`<endpoint>:<ip/email/company>`); atomic upsert menaikkan
 * `count` sampai `reset_at` lewat lalu di-reset. Aman multi-instance + bertahan
 * lintas restart. Baris kedaluwarsa disapu berkala.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text("bucket").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_reset_idx").on(t.resetAt)],
);

/** Token verifikasi email (hash, sekali pakai) — pola sama dgn reset password. */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_verification_user_idx").on(t.userId)],
);

/** Master supplier / sumber pengadaan (per perusahaan). */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    telepon: text("telepon"),
    alamat: text("alamat"),
    catatan: text("catatan"),
    /** Kategori bebas utk pengelompokan/filter (mis. "sayur", "kemasan"). */
    kategori: text("kategori"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppliers_company_nama_uq").on(t.companyId, t.nama)],
);

/** Master tempat penyimpanan (per cabang) — rujukan lokasi barang saat opname. */
export const storageLocations = pgTable(
  "storage_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    catatan: text("catatan"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("storage_locations_branch_nama_uq").on(t.branchId, t.nama)],
);

/**
 * Petugas opname per tempat penyimpanan: akun yang ditugaskan melakukan stock
 * opname untuk tempat itu. Tempat tanpa petugas = terbuka (siapa saja yang
 * boleh opname di cabang). Begitu ada petugas, tempat itu terkunci hanya untuk
 * mereka (owner/admin selalu boleh).
 */
export const storageLocationPetugas = pgTable(
  "storage_location_petugas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    storageLocationId: uuid("storage_location_id")
      .notNull()
      .references(() => storageLocations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("storage_location_petugas_uq").on(t.storageLocationId, t.userId)],
);

/**
 * Penugasan ITEM (BAHAN BAKU atau PERLENGKAPAN) ke tempat penyimpanan (rak)
 * SETIAP cabang (CK & store): "item ini disimpan di rak ini di cabang ini".
 * SUMBER TUNGGAL rak simpan — diatur di Tempat Penyimpanan, bukan di form
 * Bahan/Perlengkapan. SATU TABEL untuk keduanya: tiap baris merujuk TEPAT SATU
 * dari ingredient_id / supply_id (dijaga check XOR). Untuk bahan baku juga
 * dipakai sebagai RAK DEFAULT: saat barang tiba/diterima/dikonfirmasi di sebuah
 * cabang, otomatis diletakkan di rak yang ditugaskan untuk item itu DI CABANG
 * TERSEBUT. Sebuah item bisa punya rak di CK DAN di cabang store (terpisah),
 * tapi maksimal SATU rak per cabang (dijaga di handler PUT).
 */
export const storageLocationIngredients = pgTable(
  "storage_location_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    storageLocationId: uuid("storage_location_id")
      .notNull()
      .references(() => storageLocations.id, { onDelete: "cascade" }),
    /** salah satu diisi: bahan baku (ingredient) ATAU perlengkapan (supply) */
    ingredientId: uuid("ingredient_id").references(() => ingredients.id, { onDelete: "cascade" }),
    supplyId: uuid("supply_id").references(() => supplies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("storage_location_ingredients_uq")
      .on(t.storageLocationId, t.ingredientId)
      .where(sql`${t.ingredientId} IS NOT NULL`),
    uniqueIndex("storage_location_supplies_uq")
      .on(t.storageLocationId, t.supplyId)
      .where(sql`${t.supplyId} IS NOT NULL`),
    index("storage_location_ingredients_ing_idx").on(t.ingredientId),
    index("storage_location_ingredients_sup_idx").on(t.supplyId),
    check(
      "storage_location_items_target_ck",
      sql`(${t.ingredientId} IS NOT NULL) <> (${t.supplyId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Master meja (per cabang) — dipilih kasir saat memulai transaksi. Posisi
 * posX/posY disimpan dalam persen (0..100) agar tata letak denah bebas resolusi.
 * Selalu ada minimal satu meja bertipe "takeaway" (Ruang Tunggu) per cabang.
 */
export const meja = pgTable(
  "meja",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    tipe: mejaTipeEnum("tipe").notNull().default("dine_in"),
    posX: integer("pos_x").notNull().default(0),
    posY: integer("pos_y").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meja_branch_nama_uq").on(t.branchId, t.nama)],
);

// ===== Katalog (per company) =====

export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    /** kode produk ringkas (otomatis dari nama atau input manual); unik per company via generator */
    kode: text("kode"),
    nama: text("nama").notNull(),
    hargaBeli: numeric("harga_beli", { precision: 14, scale: 2, mode: "number" }).notNull(),
    isi: numeric("isi", { precision: 12, scale: 4, mode: "number" }).notNull(),
    /** satuan KERJA/RESEP (stok, resep, konsumsi, HPP): pcs, gr, ml, butir, dst */
    satuan: text("satuan").notNull().default("pcs"),
    /**
     * satuan BELI/pembelian (mis. "dus") — label untuk belanja/minimum beli.
     * 1 satuan_beli = `isi` satuan (resep). Null = beli langsung dalam satuan.
     */
    satuanBeli: text("satuan_beli"),
    /** lacak stok: dipotong saat menjual, ditambah saat membeli/produksi */
    trackStok: boolean("track_stok").notNull().default(true),
    /**
     * ambang batas stok minimum: saldo ≤ nilai ini → "menipis" (0 = pakai
     * rasio default). Berlaku di cabang Central Kitchen/kantor; cabang TOKO
     * memakai stok_minimum_toko.
     */
    stokMinimum: numeric("stok_minimum", { precision: 16, scale: 6, mode: "number" })
      .notNull()
      .default(0),
    /** ambang stok minimum khusus cabang TOKO (store); 0 = ikut stok_minimum */
    stokMinimumToko: numeric("stok_minimum_toko", { precision: 16, scale: 6, mode: "number" })
      .notNull()
      .default(0),
    /**
     * OVERHEAD bahan produksi: pengali biaya resep → harga per batch
     * (harga_beli = biaya bahan resep × overhead_x). 1 = harga mengikuti
     * biaya resep. Hanya bermakna untuk pengadaan "produksi".
     */
    overheadX: numeric("overhead_x", { precision: 8, scale: 4, mode: "number" })
      .notNull()
      .default(1),
    // kategori pengelompokan bahan (master dinamis `ingredient_categories`);
    // tetap teks — master hanya menyediakan pilihan (pola satuan).
    kategori: text("kategori").notNull().default("lain"),
    pengadaan: pengadaanEnum("pengadaan").notNull().default("beli"),
    // Lokasi produksi bahan jalur "produksi" (diatur di Resep): "ck" = Central
    // Kitchen; "cabang" = diproduksi kitchen/bar di cabang store (masuk stok
    // cabang) sesuai `divisiProduksi`.
    produksiDi: produksiDiEnum("produksi_di").notNull().default("ck"),
    /** divisi pelaksana saat produksi_di="cabang": kitchen (default) / bar */
    divisiProduksi: divisiProduksiEnum("divisi_produksi").notNull().default("kitchen"),
    catatan: text("catatan"),
    isPackaging: boolean("is_packaging").notNull().default(false),
    isComplement: boolean("is_complement").notNull().default(false),
    /**
     * boleh dibeli ECERAN (per pcs/gr). false (default) = pembelian mengikuti
     * kemasan toko: saran beli & faktur otomatis dibulatkan ke atas per
     * kemasan `isi`. Hanya relevan untuk jalur pengadaan "beli" (produksi
     * selalu per batch).
     */
    bolehEceran: boolean("boleh_eceran").notNull().default(false),
    /**
     * MINIMAL BELANJA (MOQ): saat sistem membuat daftar belanja, jumlah beli
     * dibulatkan naik minimal ke nilai ini (satuan bahan). 0 = tanpa minimum.
     * Berbeda dengan stok_minimum (batas stok / reorder point).
     */
    minBeli: numeric("min_beli", { precision: 16, scale: 6, mode: "number" })
      .notNull()
      .default(0),
    /**
     * MASA SIMPAN (hari): umur layak pakai bahan setelah masuk stok. Saat
     * baris faktur ditandai Tiba/Selesai, exp otomatis = tanggal masuk +
     * masa simpan (bisa di-override per baris). 0 = tidak diatur (exp kosong).
     */
    masaSimpanHari: integer("masa_simpan_hari").notNull().default(0),
    /**
     * LEAD TIME (hari): jalur beli = lama pesanan sampai barang datang;
     * jalur produksi = lama proses produksi. Dipakai perencanaan belanja
     * ("pesan/buat jauh-jauh hari, H-n"). 0 = tanpa info.
     */
    leadTimeHari: integer("lead_time_hari").notNull().default(0),
    /** FOTO BAHAN JADI hasil produksi (diunggah di halaman Resep). */
    fotoHasilUrl: text("foto_hasil_url"),
    /** FOTO CARA PACKING hasil produksi (diunggah di halaman Resep). */
    fotoPackingUrl: text("foto_packing_url"),
    /**
     * WARISAN — jangan dipakai lagi. Dulu "rak simpan default (home)" per bahan
     * yang diatur di form Bahan Baku. Kini rak simpan diatur per cabang di
     * Tempat Penyimpanan (storage_location_ingredients). Nilai lama dipindah ke
     * sana lalu kolom ini dikosongkan saat boot (backfillRakSimpanKeSli).
     */
    storageLocationId: uuid("storage_location_id").references(() => storageLocations.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingredients_company_slug_uq").on(t.companyId, t.slug),
    index("ingredients_company_idx").on(t.companyId),
    check("ingredients_isi_ck", sql`${t.isi} > 0`),
  ],
);

/**
 * CABANG PRODUSEN per BAHAN (untuk produksi_di = 'cabang'): daftar cabang
 * store yang kitchen-nya memproduksi bahan ini. KOSONG = semua cabang store
 * boleh (perilaku default). Cabang di luar daftar dipenuhi lewat jalur CK
 * (planner) dan kitchen-nya tak boleh memproduksi bahan ini.
 */
export const ingredientProduksiBranches = pgTable(
  "ingredient_produksi_branches",
  {
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ingredientId, t.branchId] })],
);

/**
 * LANGKAH CARA MASAK per BAHAN PRODUKSI: teks berurutan (sort_order) + foto
 * proses opsional. Dikelola owner/admin di halaman Resep (replace-whole-list);
 * dibaca semua pelaksana produksi. Tenancy lewat parent (ingredients) —
 * kepemilikan dicek di route, pola sama dgn ingredient_components.
 */
export const ingredientSteps = pgTable(
  "ingredient_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    teks: text("teks").notNull(),
    fotoUrl: text("foto_url"),
  },
  (t) => [index("ingredient_steps_ingredient_idx").on(t.ingredientId)],
);

/**
 * SUPPLIER per BAHAN (many-to-many): info "beli di mana" untuk tiap bahan.
 * Satu bahan bisa punya beberapa supplier; is_utama menandai supplier
 * utama/langganan (maksimal SATU per bahan — dijaga partial unique index).
 */
export const ingredientSuppliers = pgTable(
  "ingredient_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    isUtama: boolean("is_utama").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ingredient_suppliers_pair_uq").on(t.ingredientId, t.supplierId),
    uniqueIndex("ingredient_suppliers_utama_uq")
      .on(t.ingredientId)
      .where(sql`${t.isUtama}`),
    index("ingredient_suppliers_company_idx").on(t.companyId),
  ],
);

/**
 * RESEP PRODUKSI (BOM) bahan jadi: bahan dengan pengadaan "produksi" dibuat
 * dari bahan mentah (pengadaan "beli"). qty = kebutuhan bahan mentah per
 * SATU BATCH (isi) bahan jadi. Dipakai untuk: (1) rencana belanja bahan
 * produksi, (2) konsumsi otomatis bahan mentah saat produksi selesai.
 * Tenancy lewat bahan induk (ingredients.company_id) — pola menu_components.
 */
export const ingredientComponents = pgTable(
  "ingredient_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** bahan jadi (pengadaan "produksi") pemilik resep */
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    /** bahan mentah (pengadaan "beli") yang dibutuhkan */
    inputIngredientId: uuid("input_ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    /** kebutuhan per 1 batch (= isi bahan jadi) */
    qty: numeric("qty", { precision: 12, scale: 4, mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("ingredient_components_pair_uq").on(t.ingredientId, t.inputIngredientId),
    check("ingredient_components_qty_ck", sql`${t.qty} > 0`),
    check("ingredient_components_self_ck", sql`${t.ingredientId} <> ${t.inputIngredientId}`),
  ],
);

/**
 * Master SATUAN (unit) per company: daftar satuan yang boleh dipakai bahan
 * (pcs, gr, kg, ml, …). `ingredients.satuan` tetap teks; tabel ini hanya
 * menyediakan pilihan dropdown + pengelolaannya. Pola sama dgn menu_categories.
 */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("units_company_nama_uq").on(t.companyId, t.nama)],
);

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("menu_categories_company_nama_uq").on(t.companyId, t.nama)],
);

/**
 * Master KATEGORI BAHAN per company: pilihan pengelompokan bahan baku (baso,
 * minuman, lain, dst — bisa ditambah). `ingredients.kategori` tetap teks;
 * tabel ini hanya sumber pilihan dropdown. Pola sama dgn menu_categories/units.
 */
export const ingredientCategories = pgTable(
  "ingredient_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("ingredient_categories_company_nama_uq").on(t.companyId, t.nama)],
);

export const menus = pgTable(
  "menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id),
    nama: text("nama").notNull(),
    /** kode menu opsional (mis. "A1") untuk kasir & daftar menu */
    kode: text("kode"),
    tipe: menuTipeEnum("tipe").notNull().default("regular"),
    mult: numeric("mult", { precision: 7, scale: 3, mode: "number" }),
    baseMenuId: uuid("base_menu_id").references((): AnyPgColumn => menus.id),
    baseMult: numeric("base_mult", { precision: 7, scale: 3, mode: "number" }),
    hargaJual: numeric("harga_jual", { precision: 12, scale: 2, mode: "number" }).notNull(),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("menus_company_nama_uq").on(t.companyId, t.nama),
    index("menus_company_category_idx").on(t.companyId, t.categoryId),
    check(
      "menus_paket_ck",
      sql`${t.tipe} <> 'paket' OR (${t.baseMenuId} IS NOT NULL AND ${t.baseMult} IS NOT NULL)`,
    ),
  ],
);

/**
 * Pembatasan menu per lokasi (mode Pro): TANPA baris = menu tampil di SEMUA
 * cabang (default, data lama aman); ada baris = whitelist cabang.
 */
export const menuBranches = pgTable(
  "menu_branches",
  {
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.menuId, t.branchId] })],
);

export const menuComponents = pgTable(
  "menu_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: numeric("qty", { precision: 12, scale: 4, mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("menu_components_menu_ingredient_uq").on(t.menuId, t.ingredientId)],
);

// ===== Transaksi (per cabang) =====

/** Member/pelanggan — identitas via nomor WhatsApp, dipakai kasir & member area. */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    /** nomor WhatsApp (digit ternormalisasi) — identitas member per perusahaan */
    wa: text("wa").notNull(),
    catatan: text("catatan"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customers_company_wa_uq").on(t.companyId, t.wa)],
);

/** Sesi kas (shift) per cabang: buka dengan modal awal, tutup dengan uang fisik. */
export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    modalAwal: numeric("modal_awal", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** uang tunai fisik yang dihitung saat tutup (untuk selisih kas) */
    uangFisik: numeric("uang_fisik", { precision: 14, scale: 2, mode: "number" }),
    catatan: text("catatan"),
    /**
     * true bila ADA transaksi susulan (sinkron offline) yang jatuh di jendela
     * shift ini SETELAH shift ditutup — rekap kas dihitung ulang; penanda ini
     * memberi tahu bahwa angka penutupan awal bisa berbeda dari rekap terkini.
     */
    adaTransaksiSusulan: boolean("ada_transaksi_susulan").notNull().default(false),
  },
  (t) => [
    // hanya boleh ada satu shift terbuka per cabang pada satu waktu
    uniqueIndex("shifts_open_per_branch_uq")
      .on(t.branchId)
      .where(sql`${t.closedAt} IS NULL`),
    index("shifts_company_branch_idx").on(t.companyId, t.branchId, t.openedAt),
  ],
);

/**
 * Absensi karyawan: satu baris per cap (masuk/keluar). Pasangan masuk↔keluar
 * ditentukan dari urutan waktu per (perusahaan, karyawan, tanggal) — cap
 * berikutnya menjadi lawan cap terakhir hari itu.
 */
export const attendances = pgTable(
  "attendances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tipe: attendanceTipeEnum("tipe").notNull(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    /** tanggal (zona waktu perusahaan) untuk mengelompokkan cap per hari */
    attendDate: date("attend_date").notNull(),
    /** foto bukti swafoto saat absen (URL upload) — bukti kehadiran anti-titip */
    fotoUrl: text("foto_url"),
    catatan: text("catatan"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendances_company_branch_date_idx").on(t.companyId, t.branchId, t.attendDate),
    index("attendances_user_date_idx").on(t.userId, t.attendDate),
  ],
);

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    cashierUserId: uuid("cashier_user_id")
      .notNull()
      .references(() => users.id),
    nomor: text("nomor").notNull(),
    isDineIn: boolean("is_dine_in").notNull().default(false),
    // meja terpilih saat transaksi (nullable — transaksi lama/tanpa meja tetap valid)
    mejaId: uuid("meja_id").references(() => meja.id, { onDelete: "set null" }),
    mejaLabel: text("meja_label"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2, mode: "number" }).notNull(),
    /** potongan harga per transaksi (Rp); 0 = tanpa diskon */
    diskon: numeric("diskon", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** persen diskon bila mode persen (utk label struk "Diskon 10%"); null = nominal/tanpa */
    diskonPersen: numeric("diskon_persen", { precision: 5, scale: 2, mode: "number" }),
    pb1Amount: numeric("pb1_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    total: numeric("total", { precision: 14, scale: 2, mode: "number" }).notNull(),
    totalHpp: numeric("total_hpp", { precision: 16, scale: 4, mode: "number" }).notNull(),
    catatan: text("catatan"),
    // member/pelanggan (opsional) — identitas via WA; snapshot nama/wa agar
    // riwayat tetap benar meski data member kelak diubah/dihapus
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    customerNama: text("customer_nama"),
    customerWa: text("customer_wa"),
    // pembayaran: metode + uang tunai diterima (null = pas/non-tunai). Kembalian
    // dihitung dari uang_diterima − total saat perlu (struk/riwayat).
    metodeBayar: metodeBayarEnum("metode_bayar").notNull().default("tunai"),
    uangDiterima: numeric("uang_diterima", { precision: 14, scale: 2, mode: "number" }),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    saleDate: date("sale_date").notNull(),
    // soft-delete (Tempat Sampah): baris tetap disimpan sebagai catatan siapa yang menghapus
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("sales_branch_nomor_uq").on(t.branchId, t.nomor),
    index("sales_company_branch_date_idx").on(t.companyId, t.branchId, t.saleDate),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id),
    // snapshot saat transaksi — histori tidak berubah saat katalog berubah
    menuNama: text("menu_nama").notNull(),
    hargaSatuan: numeric("harga_satuan", { precision: 12, scale: 2, mode: "number" }).notNull(),
    hppSatuan: numeric("hpp_satuan", { precision: 16, scale: 4, mode: "number" }).notNull(),
    qty: numeric("qty", { precision: 10, scale: 2, mode: "number" }).notNull(),
    isDineIn: boolean("is_dine_in").notNull().default(false),
    // catatan personalisasi per baris (mis. "tanpa gula", "tanpa mie")
    catatan: text("catatan"),
    lineTotal: numeric("line_total", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId)],
);

export const saleConsumptions = pgTable(
  "sale_consumptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: numeric("qty", { precision: 16, scale: 6, mode: "number" }).notNull(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sale_consumptions_branch_ing_idx").on(t.branchId, t.ingredientId, t.waktu)],
);

/** Bill terbuka (pesanan belum dibayar) — disimpan sampai dibayar (jadi sale) atau dibatalkan. */
export const openBills = pgTable(
  "open_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    mejaId: uuid("meja_id").references(() => meja.id, { onDelete: "set null" }),
    mejaLabel: text("meja_label"),
    customerNama: text("customer_nama"),
    customerWa: text("customer_wa"),
    catatan: text("catatan"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("open_bills_company_branch_idx").on(t.companyId, t.branchId, t.updatedAt)],
);

export const openBillItems = pgTable(
  "open_bill_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => openBills.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id),
    qty: numeric("qty", { precision: 10, scale: 2, mode: "number" }).notNull(),
    /** null = ikut mode transaksi; true/false = override dine-in per baris */
    dineInOverride: boolean("dine_in_override"),
    catatan: text("catatan"),
  },
  (t) => [index("open_bill_items_bill_idx").on(t.billId)],
);

export const productions = pgTable(
  "productions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    /**
     * Cabang tujuan work-order Central Kitchen (store): faktur produksi hidup di
     * CK lalu dikirim ke sini. null = bukan work-order (produksi/beli biasa).
     */
    tujuanBranchId: uuid("tujuan_branch_id").references(() => branches.id),
    /**
     * "Kirim dari stok" (transfer stok jadi CK → cabang): non-null = baris ini
     * MEMINDAH stok jadi yang SUDAH ADA di CK (asal_branch_id) ke cabang tujuan,
     * BUKAN produksi baru — lahir langsung 'menunggu' (siap dikirim), tak
     * mengonsumsi bahan mentah. Saat DITERIMA di cabang: stok cabang bertambah
     * (baris produksi biasa) & stok CK asal berkurang (dihitung di
     * hitungSaldoCabang). null = produksi/beli biasa.
     */
    asalBranchId: uuid("asal_branch_id").references(() => branches.id),
    /**
     * "Diproduksi UNTUK cabang" (permintaan tambah stok): hasil produksi masuk
     * stok CK dulu saat selesai, lalu PERLU DIKIRIM ke cabang ini — pengingat
     * + target tombol "Kirim hasil". Dikosongkan begitu hasil dikirim.
     * Murni metadata tampilan/link — TIDAK dipakai perhitungan saldo.
     */
    untukBranchId: uuid("untuk_branch_id").references(() => branches.id),
    /**
     * Cabang ASAL PENGIRIM: diisi saat baris pindah cabang (dikirim) supaya
     * cabang pengirim (CK) tetap melihat faktur yang sudah terkirim penuh di
     * daftarnya. Murni metadata tampilan/visibilitas — TIDAK dipakai saldo
     * (beda dgn asal_branch_id yang mengurangi stok CK saat transfer diterima).
     */
    dariBranchId: uuid("dari_branch_id").references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: numeric("qty", { precision: 16, scale: 6, mode: "number" }).notNull(),
    /** jalur penambahan: produksi sendiri atau pembelian */
    tipe: pengadaanEnum("tipe").notNull().default("produksi"),
    /** total harga saat tipe='beli' (catatan pengeluaran, opsional) */
    totalHarga: numeric("total_harga", { precision: 14, scale: 2, mode: "number" }),
    /** pengelompokan baris satu faktur penerimaan */
    fakturId: uuid("faktur_id"),
    /**
     * Penanda satu "Permintaan Tambah Stok" (Tambah Stok dari Menu): faktur
     * produksi + beli yang lahir dari SATU submit berbagi rencana_id yang sama,
     * agar bisa dikelompokkan sebagai satu permintaan di "Data Permintaan Stok".
     * null = bukan dari rencana menu.
     */
    rencanaId: uuid("rencana_id"),
    /**
     * Penanda BELANJA BAHAN PRODUKSI (jalur beli): baris pembelian bahan
     * mentah yang dibutuhkan resep produksi — dibedakan dari belanja produk
     * langsung jadi. false = pembelian produk jadi / bukan dari resep.
     */
    bahanProduksi: boolean("bahan_produksi").notNull().default(false),
    /** nomor faktur/nota dari supplier (opsional) */
    noFaktur: text("no_faktur"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    storageLocationId: uuid("storage_location_id").references(() => storageLocations.id),
    /** stok baru terhitung setelah 'dikonfirmasi' (barang benar-benar ada) */
    status: konfirmasiStatusEnum("status").notNull().default("dikonfirmasi"),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    isBatch: boolean("is_batch").notNull().default(false),
    catatan: text("catatan"),
    userId: uuid("user_id").references(() => users.id),
    /** karyawan yang mengerjakan produksi (wajib utk faktur produksi baru) */
    workerId: uuid("worker_id").references(() => users.id),
    /** qty pesanan awal saat penerimaan sebagian (qty = yang benar-benar diterima) */
    qtyDipesan: numeric("qty_dipesan", { precision: 16, scale: 6, mode: "number" }),
    /** alasan penolakan kiriman (jalur beli, status 'ditolak') */
    alasanTolak: text("alasan_tolak"),
    /**
     * LAPORAN HARGA (jalur beli): waktu harga riil yang dibayar dilaporkan untuk
     * baris ini. Null = belum dilaporkan. Faktur beli yang sudah diterima & semua
     * barisnya berharga final → status "Selesai".
     */
    laporanHargaAt: timestamp("laporan_harga_at", { withTimezone: true }),
    // audit edit metadata
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id),
    // soft-delete (Tempat Sampah)
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    prodDate: date("prod_date").notNull(),
    /**
     * TANGGAL KEDALUWARSA lot: diisi saat baris masuk stok (beli Tiba /
     * produksi Selesai) = tanggal masuk + masa simpan bahan, bisa di-override
     * per baris. NULL = bahan tanpa masa simpan / baris lama / transfer stok
     * (lot asal tak diketahui).
     */
    expDate: date("exp_date"),
  },
  (t) => [
    index("productions_branch_ing_idx").on(t.branchId, t.ingredientId, t.waktu),
    // daftar Beli/Produksi difilter cabang + rentang tanggal faktur
    index("productions_branch_date_idx").on(t.branchId, t.prodDate),
    // Data Permintaan Stok memindai baris ber-rencana saja (parsial)
    index("productions_rencana_idx")
      .on(t.rencanaId)
      .where(sql`${t.rencanaId} IS NOT NULL`),
    // peringatan exp memindai lot ber-exp saja (parsial)
    index("productions_exp_idx")
      .on(t.branchId, t.expDate)
      .where(sql`${t.expDate} IS NOT NULL`),
    check("productions_qty_ck", sql`${t.qty} > 0`),
  ],
);

/**
 * KONSUMSI BAHAN MENTAH oleh produksi: saat baris produksi SELESAI dikerjakan
 * (melewati tahap 'menunggu' / lahir 'dikonfirmasi'), bahan mentah sesuai
 * resep bahan jadi dikurangi dari stok cabang pelaksana. Analog
 * sale_consumptions untuk penjualan; ikut dihitung sebagai "terpakai" di
 * hitungSaldoCabang & kartu stok.
 */
export const productionConsumptions = pgTable(
  "production_consumptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** baris productions (bahan jadi) yang memakai bahan mentah ini */
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** cabang pelaksana produksi (CK utk work-order) — stoknya yang berkurang */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    /** bahan mentah yang terpakai */
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: numeric("qty", { precision: 16, scale: 6, mode: "number" }).notNull(),
    /** tanggal bisnis (timezone perusahaan) saat produksi selesai */
    tanggal: date("tanggal").notNull(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("production_consumptions_branch_ing_idx").on(t.branchId, t.ingredientId, t.waktu),
    uniqueIndex("production_consumptions_row_uq").on(t.productionId, t.ingredientId),
  ],
);

/**
 * Catatan DANA CAIR per faktur produksi/beli: saat faktur naik dari RAB ke
 * tahap berikutnya, owner mencatat dana yang benar-benar diserahkan (penuh
 * sesuai RAB atau sebagian). Bisa lebih dari satu entri per faktur —
 * pencairan bertahap dijumlahkan.
 */
export const fakturDana = pgTable(
  "faktur_dana",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    /** faktur virtual: productions.faktur_id (tanpa FK — faktur bukan tabel) */
    fakturId: uuid("faktur_id").notNull(),
    tipe: danaTipeEnum("tipe").notNull().default("cair"),
    nominal: numeric("nominal", { precision: 14, scale: 2, mode: "number" }).notNull(),
    catatan: text("catatan"),
    userId: uuid("user_id").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("faktur_dana_faktur_idx").on(t.fakturId),
    check("faktur_dana_nominal_ck", sql`${t.nominal} >= 0`),
  ],
);

/**
 * Jejak KEGIATAN faktur produksi/beli: dibuat, ubah tahap (dgn dana/realisasi/
 * tujuan), konfirmasi, dan penerimaan — siapa melakukannya dan kapan. Dipakai
 * untuk riwayat per faktur DAN riwayat kegiatan per karyawan.
 */
export const fakturLogs = pgTable(
  "faktur_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    /** faktur virtual: productions.faktur_id (tanpa FK — faktur bukan tabel) */
    fakturId: uuid("faktur_id").notNull(),
    jalur: pengadaanEnum("jalur").notNull(),
    /** label aksi, mis. "Faktur dibuat (RAB)", "Diproses", "Dikirim" */
    aksi: text("aksi").notNull(),
    /** rincian ringkas: jumlah baris, dana cair, realisasi, tujuan kirim, dll. */
    detail: text("detail"),
    userId: uuid("user_id").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("faktur_logs_faktur_idx").on(t.fakturId, t.waktu),
    index("faktur_logs_user_idx").on(t.companyId, t.userId, t.waktu),
  ],
);

export const stockOpnames = pgTable(
  "stock_opnames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: numeric("qty", { precision: 16, scale: 6, mode: "number" }).notNull(),
    opnameDate: date("opname_date").notNull(),
    catatan: text("catatan"),
    /** pengelompokan satu sesi opname */
    sessionId: uuid("session_id"),
    /** snapshot saldo sistem saat opname (untuk bandingkan fisik vs sistem) */
    systemQty: numeric("system_qty", { precision: 16, scale: 6, mode: "number" }),
    /** qty_fisik − system_qty */
    selisih: numeric("selisih", { precision: 16, scale: 6, mode: "number" }),
    /** klarifikasi selisih: 'belum' saat opname bila selisih≠0, lalu 'sudah' */
    klarifikasiStatus: klarifikasiStatusEnum("klarifikasi_status"),
    penyesuaianKategori: penyesuaianKategoriEnum("penyesuaian_kategori"),
    klarifikasiCatatan: text("klarifikasi_catatan"),
    /** bukti foto wajib saat klarifikasi (URL R2 / lokal) */
    klarifikasiFotoUrl: text("klarifikasi_foto_url"),
    klarifikasiBy: uuid("klarifikasi_by").references(() => users.id),
    klarifikasiAt: timestamp("klarifikasi_at", { withTimezone: true }),
    /**
     * persetujuan owner/admin: baris opname jadi baseline saldo hanya setelah
     * 'disetujui'. Default 'disetujui' agar baris lama tetap efektif; opname
     * baru dgn selisih≠0 di-set 'menunggu' sampai disetujui.
     */
    penyesuaianStatus: penyesuaianStatusEnum("penyesuaian_status")
      .notNull()
      .default("disetujui"),
    disetujuiBy: uuid("disetujui_by").references(() => users.id),
    disetujuiAt: timestamp("disetujui_at", { withTimezone: true }),
    /** alasan penolakan (dikembalikan ke karyawan untuk klarifikasi ulang) */
    tolakAlasan: text("tolak_alasan"),
    userId: uuid("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_opnames_branch_ing_idx").on(t.branchId, t.ingredientId, t.createdAt)],
);

/**
 * jenis dokumen bernomor: faktur pembelian (PB), faktur produksi (PR), sesi
 * stock opname bahan (SO), stok masuk perlengkapan (PL, ref =
 * supply_mutations.id tipe 'masuk'), kiriman perlengkapan CK→cabang (KP,
 * ref = supply_transfers.id), sesi opname perlengkapan (OP, ref = session_id)
 */
export const dokumenJenisEnum = pgEnum("dokumen_jenis", [
  "beli",
  "produksi",
  "opname",
  "perlengkapan",
  "kiriman_perlengkapan",
  "opname_perlengkapan",
  // faktur beli perlengkapan ke CK (BP-, ref = supply_purchases.id)
  "beli_perlengkapan",
  // permintaan Tambah Stok dari Menu (PM-, ref = productions.rencana_id)
  "permintaan",
]);

/**
 * Penghitung nomor dokumen per perusahaan per jenis (PB/PR/SO). Increment
 * atomik via upsert — aman dipanggil bersamaan dari beberapa request.
 */
export const dokumenCounters = pgTable(
  "dokumen_counters",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    jenis: dokumenJenisEnum("jenis").notNull(),
    lastNomor: integer("last_nomor").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.jenis] })],
);

/**
 * Nomor dokumen manusiawi (PB-0001 / PR-0001 / SO-0001) untuk faktur
 * pembelian/produksi (ref = productions.faktur_id) dan sesi stock opname
 * (ref = stock_opnames.session_id). Diterbitkan saat dokumen dibuat;
 * dokumen lama diisi lewat backfill boot. Nomor tidak pernah dipakai ulang
 * meski dokumennya dihapus (jejak audit).
 */
export const dokumenNomor = pgTable(
  "dokumen_nomor",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** productions.faktur_id atau stock_opnames.session_id (tanpa FK — virtual) */
    refId: uuid("ref_id").notNull(),
    jenis: dokumenJenisEnum("jenis").notNull(),
    nomor: integer("nomor").notNull(),
    /** bentuk tampil, mis. "PB-0012" */
    nomorTeks: text("nomor_teks").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.refId] }),
    uniqueIndex("dokumen_nomor_urut_idx").on(t.companyId, t.jenis, t.nomor),
  ],
);

/**
 * ===== PERLENGKAPAN (non bahan baku): sendok, spons, sabun, dll. =====
 * Modul mandiri di luar `ingredients` — tidak pernah masuk resep/HPP/rencana.
 * Stok = ledger mutasi bertanda (masuk +, pakai/auto −, koreksi ±) per cabang.
 */
export const supplyMutasiTipeEnum = pgEnum("supply_mutasi_tipe", [
  "masuk",
  "pakai",
  "auto",
  "koreksi",
  // transfer antar cabang (kiriman CK→cabang diterima): kirim = −, terima = +
  "kirim",
  "terima",
]);

/** Status kiriman perlengkapan CK→cabang: stok pindah saat DITERIMA cabang. */
export const supplyKirimStatusEnum = pgEnum("supply_kirim_status", ["dikirim", "diterima"]);

/** Master item perlengkapan per perusahaan (stok dicatat per cabang di ledger). */
export const supplies = pgTable(
  "supplies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    satuan: text("satuan").notNull().default("pcs"),
    /** harga beli per satuan — untuk nilai belanja (opsional, boleh 0) */
    hargaBeli: numeric("harga_beli", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    stokMinimum: numeric("stok_minimum", { precision: 16, scale: 3, mode: "number" })
      .notNull()
      .default(0),
    isActive: boolean("is_active").notNull().default(true),
    catatan: text("catatan"),
    /** kategori — memakai MASTER KATEGORI yang sama dgn bahan baku (teks) */
    kategori: text("kategori"),
    /** boleh dibeli ECERAN (per pcs) vs harus utuh per kemasan */
    bolehEceran: boolean("boleh_eceran").notNull().default(true),
    /**
     * DILACAK: konsumsinya dipantau sistem — item dilacak WAJIB punya aturan
     * konsumsi (per cabang); yang tidak dilacak cukup dihitung saat opname.
     */
    dilacak: boolean("dilacak").notNull().default(false),
    /** rak simpan default (tempat penyimpanan) — null = tanpa rak */
    storageLocationId: uuid("storage_location_id").references(() => storageLocations.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supplies_company_nama_uq").on(t.companyId, t.nama)],
);

/**
 * SUPPLIER per PERLENGKAPAN (many-to-many) — pola persis ingredient_suppliers:
 * satu item bisa beberapa supplier; is_utama menandai langganan (maks SATU,
 * dijaga partial unique index).
 */
export const supplySuppliers = pgTable(
  "supply_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    supplyId: uuid("supply_id")
      .notNull()
      .references(() => supplies.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    isUtama: boolean("is_utama").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supply_suppliers_pair_uq").on(t.supplyId, t.supplierId),
    uniqueIndex("supply_suppliers_utama_uq")
      .on(t.supplyId)
      .where(sql`${t.isUtama}`),
    index("supply_suppliers_company_idx").on(t.companyId),
  ],
);

/** Metode konsumsi perlengkapan per cabang: otomatis (jadwal) vs manual (opname). */
export const supplyRuleMetodeEnum = pgEnum("supply_rule_metode", ["otomatis", "manual"]);

/**
 * Aturan konsumsi per cabang. metode "otomatis": terpakai `qty` setiap
 * `per_hari` hari sejak `mulai` (mis. sabun 1 sachet/hari); metode "manual":
 * pemakaian dicatat lewat STOCK OPNAME saja (tanpa potongan terjadwal).
 * `terakhir_diterapkan` = kursor hari lokal terakhir yang sudah dihitung —
 * hari yang DILEWATI karena saldo habis tidak boleh diulang setelah restock.
 */
export const supplyRules = pgTable(
  "supply_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    supplyId: uuid("supply_id")
      .notNull()
      .references(() => supplies.id, { onDelete: "cascade" }),
    metode: supplyRuleMetodeEnum("metode").notNull().default("otomatis"),
    qty: numeric("qty", { precision: 16, scale: 3, mode: "number" }).notNull(),
    perHari: integer("per_hari").notNull().default(1),
    mulai: date("mulai").notNull(),
    aktif: boolean("aktif").notNull().default(true),
    terakhirDiterapkan: date("terakhir_diterapkan"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supply_rules_branch_supply_uq").on(t.branchId, t.supplyId)],
);

/**
 * Ledger mutasi perlengkapan per cabang. `qty` BERTANDA: masuk = +, pakai/auto
 * = −, koreksi = ± selisih fisik. Saldo cabang = SUM(qty).
 */
export const supplyMutations = pgTable(
  "supply_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    supplyId: uuid("supply_id")
      .notNull()
      .references(() => supplies.id, { onDelete: "cascade" }),
    tipe: supplyMutasiTipeEnum("tipe").notNull(),
    qty: numeric("qty", { precision: 16, scale: 3, mode: "number" }).notNull(),
    /** nilai belanja — hanya tipe 'masuk' */
    totalHarga: numeric("total_harga", { precision: 14, scale: 2, mode: "number" }),
    /** tanggal lokal (zona waktu perusahaan) mutasi terjadi */
    tanggal: date("tanggal").notNull(),
    catatan: text("catatan"),
    /** null untuk mutasi 'auto' (dicatat sistem) */
    userId: uuid("user_id").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    /**
     * OPNAME PERLENGKAPAN: selisih hitung fisik lahir 'menunggu' (belum
     * memengaruhi saldo) sampai di-ACC owner/admin — persis alur opname bahan.
     * Mutasi biasa (masuk/pakai/auto/koreksi/kirim/terima) langsung 'disetujui'.
     */
    status: penyesuaianStatusEnum("status").notNull().default("disetujui"),
    /** pengelompok sesi opname perlengkapan (null utk mutasi biasa) */
    sessionId: uuid("session_id"),
    /** info opname: saldo sistem & hasil hitung fisik saat sesi dibuat */
    systemQty: numeric("system_qty", { precision: 16, scale: 3, mode: "number" }),
    qtyFisik: numeric("qty_fisik", { precision: 16, scale: 3, mode: "number" }),
  },
  (t) => [
    index("supply_mutations_branch_supply_idx").on(t.branchId, t.supplyId, t.tanggal),
    // maksimal SATU baris auto per item per cabang per hari (idempoten)
    uniqueIndex("supply_mutations_auto_uq")
      .on(t.supplyId, t.branchId, t.tanggal)
      .where(sql`${t.tipe} = 'auto'`),
  ],
);

/**
 * Kiriman perlengkapan CK → cabang (permintaan cabang saat stok ≤ minimum,
 * dipenuhi dari stok ready CK). Faktur bernomor KP-; saldo baru pindah
 * (CK − / cabang +) saat cabang menekan TERIMA — seperti kiriman produksi.
 */
export const supplyTransfers = pgTable(
  "supply_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    dariBranchId: uuid("dari_branch_id")
      .notNull()
      .references(() => branches.id),
    keBranchId: uuid("ke_branch_id")
      .notNull()
      .references(() => branches.id),
    supplyId: uuid("supply_id")
      .notNull()
      .references(() => supplies.id, { onDelete: "cascade" }),
    qty: numeric("qty", { precision: 16, scale: 3, mode: "number" }).notNull(),
    status: supplyKirimStatusEnum("status").notNull().default("dikirim"),
    catatan: text("catatan"),
    /** peminta/pembuat kiriman */
    userId: uuid("user_id").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    diterimaBy: uuid("diterima_by").references(() => users.id),
    diterimaAt: timestamp("diterima_at", { withTimezone: true }),
  },
  (t) => [index("supply_transfers_ke_status_idx").on(t.keBranchId, t.status)],
);

/**
 * Status faktur beli perlengkapan ke CK: 'menunggu' (faktur terbit, barang
 * belum dibeli/tiba), 'tiba' (barang masuk stok CK + otomatis dikirim ke
 * cabang tujuan bila ada), 'batal'.
 */
export const supplyBeliStatusEnum = pgEnum("supply_beli_status", [
  "menunggu",
  // sedang dibelanjakan (pemroses tercatat) — paritas tahap "diproses" beli bahan baku
  "diproses",
  "tiba",
  "batal",
]);

/**
 * Faktur beli perlengkapan KE CENTRAL KITCHEN — dibuat saat stok CK kurang
 * (dari permintaan cabang) atau manual. Alur meniru bahan baku: beli → tiba di
 * CK (masuk stok CK, bernomor PL-) → otomatis dikirim (KP-) ke cabang tujuan.
 * Faktur sendiri bernomor BP-.
 */
export const supplyPurchases = pgTable(
  "supply_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** CK tempat barang dibeli & masuk stok */
    ckBranchId: uuid("ck_branch_id")
      .notNull()
      .references(() => branches.id),
    supplyId: uuid("supply_id")
      .notNull()
      .references(() => supplies.id, { onDelete: "cascade" }),
    qty: numeric("qty", { precision: 16, scale: 3, mode: "number" }).notNull(),
    /** nilai belanja — diisi saat barang tiba (opsional) */
    totalHarga: numeric("total_harga", { precision: 14, scale: 2, mode: "number" }),
    /** cabang store yang butuh — dikirim otomatis setelah tiba (null = stok CK saja) */
    tujuanBranchId: uuid("tujuan_branch_id").references(() => branches.id),
    /**
     * FAKTUR pengelompokan (seperti beli bahan baku): baris yang dibuat
     * bersama berbagi faktur_id & SATU nomor BP- (dokumen_nomor ref =
     * faktur_id). Null hanya untuk baris warisan (nomor per baris).
     */
    fakturId: uuid("faktur_id"),
    /** tautan ke rencana Tambah Stok dari Menu — tampil di Data Permintaan Stok */
    rencanaId: uuid("rencana_id"),
    status: supplyBeliStatusEnum("status").notNull().default("menunggu"),
    catatan: text("catatan"),
    userId: uuid("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** kiriman KP- yang otomatis dibuat saat tiba (bila cabang tujuan diisi) */
    kirimTransferId: uuid("kirim_transfer_id").references(() => supplyTransfers.id),
    tibaBy: uuid("tiba_by").references(() => users.id),
    tibaAt: timestamp("tiba_at", { withTimezone: true }),
    /** pemroses belanja — tercatat saat faktur ditandai 'diproses' */
    diprosesBy: uuid("diproses_by").references(() => users.id),
    diprosesAt: timestamp("diproses_at", { withTimezone: true }),
  },
  (t) => [
    index("supply_purchases_ck_status_idx").on(t.ckBranchId, t.status),
    index("supply_purchases_faktur_idx")
      .on(t.fakturId)
      .where(sql`${t.fakturId} IS NOT NULL`),
    index("supply_purchases_rencana_idx")
      .on(t.rencanaId)
      .where(sql`${t.rencanaId} IS NOT NULL`),
  ],
);

/**
 * Penanda BACKFILL BOOT yang sudah selesai — backfill warisan (perbaikan data
 * pra-fitur) cukup berjalan SEKALI; boot berikutnya melompatinya sehingga
 * start server tetap cepat saat data membesar. Baris = satu backfill selesai.
 */
export const bootFlags = pgTable("boot_flags", {
  key: text("key").primaryKey(),
  selesaiAt: timestamp("selesai_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Buku besar idempotency untuk sinkron offline mobile (POST /api/sync).
 * Setiap perintah offline punya `client_ref` unik per perusahaan; hasil
 * eksekusi (sukses/gagal) disimpan agar retry dari perangkat aman
 * (exactly-once) — perintah yang sudah tercatat tidak dieksekusi ulang.
 */
export const syncCommands = pgTable(
  "sync_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** idempotency key dari perangkat — unik per perusahaan */
    clientRef: uuid("client_ref").notNull(),
    deviceId: text("device_id"),
    userId: uuid("user_id").references(() => users.id),
    tipe: text("tipe").notNull(),
    /** waktu kejadian di perangkat (offline), bukan waktu sinkron */
    waktu: timestamp("waktu", { withTimezone: true }).notNull(),
    /** status hasil: 'ok' | 'gagal' */
    status: text("status").notNull(),
    /** kode HTTP hasil eksekusi (201/200/400/403/409/…) */
    kode: integer("kode").notNull(),
    /** payload hasil (data endpoint asli) atau pesan error */
    hasilJson: jsonb("hasil_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sync_commands_company_ref_uq").on(t.companyId, t.clientRef)],
);

/**
 * Riwayat pencadangan (backup) database platform. Setiap kali cadangan dibuat
 * — otomatis (penjadwal) atau manual (super admin) — satu baris dicatat di
 * sini: statusnya, ke mana disimpan, ukuran, dan cakupannya. Dipakai panel
 * super admin untuk menampilkan riwayat, mengunduh, dan menerapkan retensi
 * (menyimpan N cadangan terakhir). Baris ini SENGAJA tidak ikut dicadangkan
 * (menghindari referensi-diri yang membengkak).
 */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    /** 'otomatis' (penjadwal) | 'manual' (dipicu super admin) */
    pemicu: text("pemicu").notNull(),
    /** super admin pemicu (untuk manual); null bila otomatis */
    olehUserId: uuid("oleh_user_id").references(() => users.id, { onDelete: "set null" }),
    /** 'berjalan' | 'sukses' | 'gagal' */
    status: text("status").notNull(),
    /** 'r2' | 'local' — target penyimpanan cadangan ini */
    storageMode: text("storage_mode").notNull(),
    /** kunci objek (R2) atau nama berkas (lokal); null bila gagal sebelum tersimpan */
    objectKey: text("object_key"),
    ukuranBytes: bigint("ukuran_bytes", { mode: "number" }),
    jumlahTabel: integer("jumlah_tabel"),
    jumlahBaris: bigint("jumlah_baris", { mode: "number" }),
    durasiMs: integer("durasi_ms"),
    /** pesan galat bila status 'gagal' */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("backup_runs_waktu_idx").on(t.waktu)],
);
