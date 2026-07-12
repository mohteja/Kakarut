import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
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

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "cashier"]);
export const bahanKategoriEnum = pgEnum("bahan_kategori", ["baso", "minuman", "lain"]);
export const menuTipeEnum = pgEnum("menu_tipe", ["regular", "paket"]);
/** jalur pengadaan bahan: diproduksi sendiri vs dibeli jadi */
export const pengadaanEnum = pgEnum("pengadaan", ["produksi", "beli"]);
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
 * ('disetujui') hanya setelah owner/admin menyetujui selisih yang diklarifikasi.
 */
export const penyesuaianStatusEnum = pgEnum("penyesuaian_status", ["menunggu", "disetujui"]);
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

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  nama: text("nama").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_company_uq").on(t.userId, t.companyId),
    check("memberships_cashier_branch_ck", sql`${t.role} <> 'cashier' OR ${t.branchId} IS NOT NULL`),
    // kode karyawan unik per perusahaan (abaikan yang NULL)
    uniqueIndex("memberships_company_kode_uq")
      .on(t.companyId, t.employeeCode)
      .where(sql`${t.employeeCode} IS NOT NULL`),
  ],
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
    nama: text("nama").notNull(),
    hargaBeli: numeric("harga_beli", { precision: 14, scale: 2, mode: "number" }).notNull(),
    isi: numeric("isi", { precision: 12, scale: 4, mode: "number" }).notNull(),
    /** satuan isi/gramasi: pcs, gr, ml, butir, porsi, dst */
    satuan: text("satuan").notNull().default("pcs"),
    /** lacak stok: dipotong saat menjual, ditambah saat membeli/produksi */
    trackStok: boolean("track_stok").notNull().default(true),
    /** ambang batas stok minimum: saldo ≤ nilai ini → "menipis" (0 = pakai rasio default) */
    stokMinimum: numeric("stok_minimum", { precision: 16, scale: 6, mode: "number" })
      .notNull()
      .default(0),
    kategori: bahanKategoriEnum("kategori").notNull().default("lain"),
    pengadaan: pengadaanEnum("pengadaan").notNull().default("beli"),
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
    // audit edit metadata
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id),
    // soft-delete (Tempat Sampah)
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    prodDate: date("prod_date").notNull(),
  },
  (t) => [
    index("productions_branch_ing_idx").on(t.branchId, t.ingredientId, t.waktu),
    check("productions_qty_ck", sql`${t.qty} > 0`),
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
