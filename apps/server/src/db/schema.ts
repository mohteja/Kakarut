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
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "cashier"]);
export const bahanKategoriEnum = pgEnum("bahan_kategori", ["baso", "minuman", "lain"]);
export const menuTipeEnum = pgEnum("menu_tipe", ["regular", "paket"]);

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
  plan: text("plan").notNull().default("free"),
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_company_uq").on(t.userId, t.companyId),
    check("memberships_cashier_branch_ck", sql`${t.role} <> 'cashier' OR ${t.branchId} IS NOT NULL`),
  ],
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
    kategori: bahanKategoriEnum("kategori").notNull().default("lain"),
    catatan: text("catatan"),
    isPackaging: boolean("is_packaging").notNull().default(false),
    isComplement: boolean("is_complement").notNull().default(false),
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
    subtotal: numeric("subtotal", { precision: 14, scale: 2, mode: "number" }).notNull(),
    pb1Amount: numeric("pb1_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    total: numeric("total", { precision: 14, scale: 2, mode: "number" }).notNull(),
    totalHpp: numeric("total_hpp", { precision: 16, scale: 4, mode: "number" }).notNull(),
    catatan: text("catatan"),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    saleDate: date("sale_date").notNull(),
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
    isBatch: boolean("is_batch").notNull().default(false),
    catatan: text("catatan"),
    userId: uuid("user_id").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    prodDate: date("prod_date").notNull(),
  },
  (t) => [
    index("productions_branch_ing_idx").on(t.branchId, t.ingredientId, t.waktu),
    check("productions_qty_ck", sql`${t.qty} > 0`),
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
    userId: uuid("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_opnames_branch_ing_idx").on(t.branchId, t.ingredientId, t.createdAt)],
);
