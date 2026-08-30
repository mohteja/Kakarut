import { companies, customers, sales } from "./schema";

/**
 * KOLOM YANG MEMANG DIKIRIM KE KLIEN — disebut satu per satu.
 *
 * `db.select()` telanjang (dan `.returning()` telanjang) memulangkan SETIAP
 * kolom tabelnya. Baris seperti itu yang sampai ke `c.json` membuat bentuk
 * balasan mengikuti bentuk TABEL: kolom yang ditambahkan besok ikut terkirim
 * ke semua klien tanpa satu baris kode pun berubah, dan tanpa satu orang pun
 * memutuskannya. Itu bukan keputusan; itu ketiadaan keputusan.
 *
 * Ketiga daftar di bawah dibuat dari kolom yang HARI INI sudah terkirim, jadi
 * memasangnya tidak mengubah apa pun yang dilihat klien — dan itulah buktinya
 * ia benar. Yang berubah cuma satu: mulai sekarang penambahan kolom harus
 * disengaja untuk sampai ke luar.
 *
 * Tabel ber-kolom rahasia (`users`, `smtp_settings`, `invitations`, dua tabel
 * token) sengaja TIDAK punya daftar di sini: tak satu pun barisnya boleh
 * dikirim utuh, jadi yang benar bukan daftar kolom melainkan DTO yang dirakit
 * di tempatnya — seperti `buatSesi` dan `smtpDto` yang sudah begitu.
 */
export const KOLOM_COMPANY = {
  id: companies.id,
  nama: companies.nama,
  metodeHpp: companies.metodeHpp,
  slug: companies.slug,
  alamat: companies.alamat,
  telepon: companies.telepon,
  logoUrl: companies.logoUrl,
  timezone: companies.timezone,
  pb1Enabled: companies.pb1Enabled,
  pb1Rate: companies.pb1Rate,
  receiptFooter: companies.receiptFooter,
  receiptShowAlamat: companies.receiptShowAlamat,
  diskonMaksPersen: companies.diskonMaksPersen,
  blokirJualMinus: companies.blokirJualMinus,
  targetPenjualan: companies.targetPenjualan,
  foodCostMaks: companies.foodCostMaks,
  plan: companies.plan,
  planExpiresAt: companies.planExpiresAt,
  isActive: companies.isActive,
  createdAt: companies.createdAt,
  updatedAt: companies.updatedAt,
} as const;

export const KOLOM_CUSTOMER = {
  id: customers.id,
  companyId: customers.companyId,
  nama: customers.nama,
  wa: customers.wa,
  catatan: customers.catatan,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
} as const;

/**
 * `deletedAt`/`deletedBy` IKUT di sini karena hari ini memang terkirim —
 * daftar ini merekam keadaan, bukan memperbaikinya. Mencabutnya adalah
 * perubahan kontrak tersendiri yang butuh pengukurannya sendiri.
 */
export const KOLOM_SALE = {
  id: sales.id,
  companyId: sales.companyId,
  branchId: sales.branchId,
  cashierUserId: sales.cashierUserId,
  nomor: sales.nomor,
  isDineIn: sales.isDineIn,
  mejaId: sales.mejaId,
  mejaLabel: sales.mejaLabel,
  subtotal: sales.subtotal,
  diskon: sales.diskon,
  diskonPersen: sales.diskonPersen,
  pb1Amount: sales.pb1Amount,
  total: sales.total,
  subtotalAsal: sales.subtotalAsal,
  diskonAsal: sales.diskonAsal,
  pb1Asal: sales.pb1Asal,
  refundTotal: sales.refundTotal,
  totalHpp: sales.totalHpp,
  catatan: sales.catatan,
  customerId: sales.customerId,
  customerNama: sales.customerNama,
  customerWa: sales.customerWa,
  metodeBayar: sales.metodeBayar,
  uangDiterima: sales.uangDiterima,
  waktu: sales.waktu,
  saleDate: sales.saleDate,
  shiftId: sales.shiftId,
  asalOpenBillId: sales.asalOpenBillId,
  deletedAt: sales.deletedAt,
  deletedBy: sales.deletedBy,
} as const;
