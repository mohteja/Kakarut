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
/**
 * PENGERJAAN pesanan pelanggan di papan dapur — sengaja BUKAN memakai ulang
 * `penyesuaianStatusEnum`/`konfirmasiStatusEnum`: keduanya berkosakata
 * PERSETUJUAN ("disetujui"/"dikonfirmasi"), sedangkan ini soal apakah
 * makanannya sudah dibuat. Menyamakan "disetujui" dengan "makanan selesai"
 * akan menyesatkan setiap pembaca kode berikutnya.
 *
 * Pesanan lahir "dikerjakan" (masuk antrean dapur) lalu ditandai "selesai"
 * atau "batal".
 */
export const pesananStatusEnum = pgEnum("pesanan_status", ["dikerjakan", "selesai", "batal"]);
/** jenis meja: meja makan biasa (dine-in) vs meja "Ruang Tunggu" untuk take away */
export const mejaTipeEnum = pgEnum("meja_tipe", ["dine_in", "takeaway"]);
export const metodeBayarEnum = pgEnum("metode_bayar", ["tunai", "qris", "transfer"]);
/** jenis cap absensi karyawan: masuk (datang) vs keluar (pulang) */
export const attendanceTipeEnum = pgEnum("attendance_tipe", ["masuk", "keluar"]);

/**
 * Ketidakhadiran yang DISENGAJA — dua jalur karena artinya beda di rekap:
 * `cuti` = jatah/keperluan pribadi, `libur` = hari tidak bekerja yang memang
 * disepakati. Keduanya BUKAN alpa. `jenis` selalu turunan `kategori` (server
 * yang menurunkannya lewat `jenisKategori()` di @kakarut/shared) — klien tak
 * pernah mengirimnya, jadi mustahil ada "libur" berkategori "melahirkan".
 */
export const pengajuanJenisEnum = pgEnum("pengajuan_jenis", ["cuti", "libur"]);
export const pengajuanKategoriEnum = pgEnum("pengajuan_kategori", [
  "tahunan",
  "sakit",
  "izin",
  "melahirkan",
  "penting",
  "mingguan",
  "tukar_jadwal",
  "tanggal_merah",
]);
export const pengajuanStatusEnum = pgEnum("pengajuan_status", [
  "menunggu",
  "disetujui",
  "ditolak",
]);

/**
 * Sesi laporan kebersihan harian. Toko dibersihkan beberapa kali sehari, jadi
 * satu laporan per hari tidak cukup: tiap sesi punya laporannya sendiri
 * (dipaksa unik per karyawan × tanggal × sesi).
 */
export const kebersihanSesiEnum = pgEnum("kebersihan_sesi", ["pagi", "siang", "malam"]);

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
  /**
   * TOLAK PESANAN YANG MELEBIHI STOK.
   *
   * Bawaannya MATI, dan itu disengaja: menyalakannya untuk tenant yang sudah
   * berjalan akan menghentikan penjualan menu mana pun yang bahannya terlanjur
   * bersaldo minus — keadaan yang lazim justru pada data lama. Menyalakannya
   * harus jadi keputusan sadar pemiliknya, bukan efek samping pembaruan.
   */
  blokirJualMinus: boolean("blokir_jual_minus").notNull().default(false),
  /** target penjualan (Rp) default untuk rekomendasi kebutuhan bahan baku */
  targetPenjualan: numeric("target_penjualan", { precision: 14, scale: 2, mode: "number" }),
  /**
   * Ambang food cost (%) yang dianggap sehat. Menu yang melewatinya ditandai
   * merah di daftar menu — HPP dihitung live dari harga bahan, jadi menu bisa
   * jatuh ke atas ambang tanpa ada yang mengubah harga jualnya.
   */
  foodCostMaks: numeric("food_cost_maks", { precision: 5, scale: 2, mode: "number" })
    .notNull()
    .default(40),
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
 * KEADAAN PENGIRIMAN EMAIL — satu baris (`kunci = 'email'`), ditulis tiap kali
 * sepucuk surat berhasil ATAU gagal dikirim.
 *
 * KENAPA ADA. Tiga pintu di aplikasi ini mengirim surat yang BOLEH gagal tanpa
 * menggagalkan permintaannya: verifikasi email pendaftar baru, reset password,
 * dan undangan karyawan. Ketiganya harus begitu — membalas 500 karena SMTP
 * mati akan menggagalkan pendaftaran yang datanya sudah tersimpan, dan pada
 * dua pintu pertama membalas apa adanya juga membuka enumerasi akun (jawaban
 * yang berbeda = cara menebak email mana yang terdaftar).
 *
 * Tapi "tak menggagalkan permintaan" pernah berarti "tak meninggalkan jejak
 * sama sekali", dan itu terukur pada 2026-09-01, lewat HTTP sungguhan, saat
 * pemilik repo melaporkan pendaftar berhenti menerima kode OTP:
 *
 *     POST /auth/register              → 200 "…kami telah mengirim KODE…"
 *     POST /auth/resend-verification   → 200 {ok:true}
 *     baris email_verification_tokens  → 2   (sistem yakin kode terbit)
 *     baris log server soal kegagalan  → 0
 *
 * Nol. Penyedia emailnya menolak, dan TAK ADA satu pun tempat di sistem ini —
 * respons, log, maupun panel — yang bisa memberi tahu siapa pun kenapa. Yang
 * bisa dilakukan pemiliknya cuma menebak.
 *
 * KENAPA DI DATABASE, BUKAN DI MEMORI. Alasannya sama dengan yang ditulis
 * `peringatan_terkirim` di bawah, ditambah satu: baris log dibaca sekali, oleh
 * orang yang kebetulan sedang menonton deploy. Kegagalan email justru
 * ditemukan berhari-hari kemudian, oleh orang yang membuka panel karena ada
 * yang mengeluh. `pemeriksaan-setelan.ts` sudah menuliskan prinsip itu untuk
 * temuan lain; baris ini yang membuatnya berlaku juga untuk email.
 *
 * YANG TIDAK DIJANJIKAN: ini bukan antrean kirim ulang. Surat yang gagal tetap
 * hilang — yang dijamin cuma bahwa kegagalannya BERBUNYI.
 */
export const emailKeadaan = pgTable("email_keadaan", {
  /** selalu `'email'` — satu baris untuk seluruh pemasangan. */
  kunci: text("kunci").primaryKey(),
  suksesPada: timestamp("sukses_pada", { withTimezone: true }),
  suksesPenyedia: text("sukses_penyedia"),
  gagalPada: timestamp("gagal_pada", { withTimezone: true }),
  gagalPenyedia: text("gagal_penyedia"),
  /** pesan galat penyedia, dipotong — cukup untuk mendiagnosis, bukan arsip. */
  gagalPesan: text("gagal_pesan"),
  /**
   * Kegagalan BERUNTUN sejak kiriman sukses terakhir. Nol berarti pengiriman
   * terakhir berhasil; angka yang naik berarti keadaannya SEDANG berlangsung,
   * bukan satu kegagalan tunggal yang sudah lewat.
   */
  gagalBeruntun: integer("gagal_beruntun").notNull().default(0),
});

/**
 * CATATAN PERCOBAAN KIRIM EMAIL — cincin 200 baris terakhir.
 *
 * KENAPA ADA, padahal `email_keadaan` di atas baru saja dipasang. Tabel itu
 * menjawab "adakah kiriman yang GAGAL?" dan ia menjawabnya dengan benar. Tapi
 * pada 2026-09-01 pertanyaan yang sebenarnya ternyata bukan itu, dan ia tak
 * bisa menjawabnya:
 *
 *     surat uji ke alamat X          → SAMPAI
 *     kode OTP ke alamat X yang sama → tak sampai, tak ada di spam
 *     panel                          → tak ada temuan `email_gagal_kirim`
 *
 * Panel yang diam punya DUA tafsir yang berlawanan — "tak ada yang gagal
 * karena semuanya berhasil" dan "tak ada yang gagal karena tak ada yang pernah
 * dicoba" — dan tak ada cara membedakannya. Diagnosisnya karena itu memakan
 * satu putaran penuh, dan berakhir pada dugaan, bukan bacaan.
 *
 * Sebabnya struktural: `auth/routes.ts` punya TUJUH cabang yang membalas 200
 * "kami telah mengirim KODE verifikasi 6 digit. Cek email Anda" TANPA pernah
 * memanggil pengirimnya. Terukur lewat HTTP: mendaftar ulang email yang sudah
 * ada tidak menulis satu baris token pun, tidak mengirim apa pun, dan
 * meninggalkan nol jejak — sementara balasannya identik dengan pendaftaran
 * yang berhasil.
 *
 * Maka yang dicatat di sini bukan cuma yang gagal, melainkan SETIAP PERCOBAAN,
 * termasuk yang keputusannya "tidak dikirim" BESERTA SEBABNYA. Itu yang
 * membuat pertanyaan "dikirim atau tidak?" terjawab dalam sekali lihat.
 *
 * ALAMAT TUJUAN DISIMPAN UTUH, atas keputusan pemilik repo, dan hanya terbaca
 * super admin (`GET /admin/sistem`). Tanpa alamatnya, laporan "si A tak
 * menerima" tak bisa dicocokkan dengan baris mana pun — dan itu persis
 * pekerjaan yang tabel ini ada untuk melakukannya. Setara dengan log penerima
 * yang dicatat mail server mana pun.
 *
 * CINCIN, bukan arsip: 200 baris terakhir, yang lama dibuang saat menulis.
 * Diagnosis email selalu tentang beberapa jam terakhir; menyimpan selamanya
 * cuma menumbuhkan tabel berisi alamat orang tanpa ada yang membacanya.
 */
export const emailPercobaan = pgTable(
  "email_percobaan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    /** nama PINTUNYA: `verifikasi-email`, `reset-password`, … */
    konteks: text("konteks").notNull(),
    tujuan: text("tujuan").notNull(),
    /** `terkirim` | `gagal` | `tak_dicoba` */
    hasil: text("hasil").notNull(),
    /** hanya untuk `tak_dicoba` — kenapa keputusannya tidak mengirim */
    sebab: text("sebab"),
    /** `smtp` | `resend`; null bila tak sampai memilih penyedia */
    penyedia: text("penyedia"),
    /** pesan galat penyedia, dipotong */
    pesan: text("pesan"),
    /**
     * ID pesan dari penyedianya sendiri (`messageId` SMTP / `id` Resend).
     *
     * Jembatan ke catatan MEREKA: baris "Terkirim" di sini cuma berarti
     * penyedianya menerima alamat itu — nasib sesudahnya (delivered, bounced,
     * blocked) tercatat di tempat lain, dan tanpa id ini tak ada cara
     * mencocokkan satu baris di panel dengan satu pesan di sana. Pada Gmail
     * SMTP, pantulannya mendarat sebagai surat "Mail Delivery Subsystem" di
     * kotak masuk akun pengirim, dan `Message-ID`-nya yang menghubungkan.
     */
    pesanId: text("pesan_id"),
  },
  (t) => [index("email_percobaan_waktu_idx").on(t.waktu)],
);

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
    /**
     * Hash dari `<user_id>:<kode>`, bukan dari kodenya saja — dan user id itu
     * yang membuat kode 6 digit aman disimpan begini.
     *
     * Kode 6 digit hanya punya sejuta kemungkinan, jadi dua akun BISA memegang
     * kode yang sama pada saat yang sama. Meng-hash kodenya telanjang membuat
     * tabrakan itu jadi galat penyisipan (dulu kolomnya `unique`), dan yang
     * lebih buruk: satu kode jadi berlaku untuk akun mana pun yang kebetulan
     * memegangnya. Dengan user id ikut di-hash, sebuah kode hanya pernah
     * berarti bagi akun yang menerimanya.
     *
     * Baris LAMA berisi hash token tautan 64-hex (skema sebelum OTP). Keduanya
     * hidup berdampingan sampai token-token itu kedaluwarsa sendiri — lihat
     * cabang transisi di `POST /auth/verify-email`.
     */
    tokenHash: text("token_hash").notNull(),
    /**
     * Percobaan SALAH terhadap kode ini. Sejuta kemungkinan bukan rahasia yang
     * kuat; yang membuatnya kuat adalah batas percobaannya. Begitu batasnya
     * tercapai barisnya dimatikan, dan pemakainya harus minta kode baru.
     */
    percobaan: integer("percobaan").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_verification_user_idx").on(t.userId),
    // Bukan unik: lihat catatan `tokenHash` di atas.
    index("email_verification_hash_idx").on(t.tokenHash),
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
    /**
     * ISI menu untuk PEMBELI — mis. "1 baso urat besar, 2 baso kecil, 1 mie".
     * SENGAJA terpisah dari resep (menu_components): resep itu dokumen BIAYA,
     * takarannya boleh pecahan hasil konversi gram (mis. 0,7576 butir) dan
     * memuat kemasan serta pelengkap yang tak pantas dicetak di daftar menu.
     * Form menyediakan tombol isi-otomatis dari resep sebagai titik awal, lalu
     * teksnya dirapikan sendiri oleh pemilik. NULL/kosong = tak ditampilkan.
     */
    deskripsi: text("deskripsi"),
    tipe: menuTipeEnum("tipe").notNull().default("regular"),
    mult: numeric("mult", { precision: 7, scale: 3, mode: "number" }),
    baseMenuId: uuid("base_menu_id").references((): AnyPgColumn => menus.id),
    baseMult: numeric("base_mult", { precision: 7, scale: 3, mode: "number" }),
    hargaJual: numeric("harga_jual", { precision: 12, scale: 2, mode: "number" }).notNull(),
    imageUrl: text("image_url"),
    /**
     * TARGET waktu penyajian (detik) — berapa lama menu ini SEHARUSNYA selesai,
     * dihitung sejak pesanan masuk sampai ditandai selesai.
     *
     * NULL = belum ditetapkan, dan itu bawaan yang disengaja: laporan durasi
     * tak boleh menuduh menu apa pun terlambat terhadap angka yang tak pernah
     * dipilih siapa-siapa. Tanpa target, laporan cuma melaporkan; dengan
     * target, ia bisa berkata "menu ini biasanya lewat".
     *
     * Kenapa per MENU dan bukan satu angka untuk seluruh dapur: kopi dan iga
     * bakar tak punya kesamaan apa pun soal ini, dan target tunggal akan salah
     * untuk keduanya sekaligus.
     */
    targetDurasiDetik: integer("target_durasi_detik"),
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
    /**
     * Uang tunai fisik hasil hitung laci. Diisi lewat `POST /shift/kunci-hitungan`
     * SEBELUM shift ditutup (hitung buta), atau langsung saat `POST /shift/tutup`.
     * Terisi selagi `closed_at` masih NULL = hitungan sudah dikunci, angka kas
     * boleh dibuka ke kasir.
     */
    uangFisik: numeric("uang_fisik", { precision: 14, scale: 2, mode: "number" }),
    /**
     * Kapan hitungan dikunci. Jejak audit yang membedakan penutupan buta
     * (kunci → angka terbuka → tutup) dari penutupan satu langkah; tanpa kolom
     * ini keduanya terlihat sama persis setelah shift tertutup.
     */
    hitunganDikunciAt: timestamp("hitungan_dikunci_at", { withTimezone: true }),
    catatan: text("catatan"),
    /**
     * true bila ADA transaksi susulan (sinkron offline) yang jatuh di jendela
     * shift ini SETELAH shift ditutup — rekap kas dihitung ulang; penanda ini
     * memberi tahu bahwa angka penutupan awal bisa berbeda dari rekap terkini.
     */
    adaTransaksiSusulan: boolean("ada_transaksi_susulan").notNull().default(false),
    /**
     * PERSETUJUAN SELISIH KAS. NULL = tak ada yang perlu disetujui: shift masih
     * terbuka, atau uang fisik PAS dengan kas sistem. Begitu ada selisih —
     * lebih maupun kurang — statusnya "menunggu" sampai owner/admin memutuskan.
     * Kasir tidak bisa menyetujui selisihnya sendiri.
     *
     * DTO memisahkan dua makna NULL itu jadi `status_selisih: null` (masih
     * terbuka) vs `"pas"` (sudah ditutup, tidak ada selisih) — lihat `toDto`.
     */
    selisihStatus: penyesuaianStatusEnum("selisih_status"),
    /** keterangan kasir saat menutup dengan selisih (mis. "kembalian kurang") */
    selisihAlasan: text("selisih_alasan"),
    disetujuiOleh: uuid("disetujui_oleh").references(() => users.id),
    disetujuiAt: timestamp("disetujui_at", { withTimezone: true }),
    /** alasan owner menolak selisih (wajib diisi saat menolak) */
    tolakAlasan: text("tolak_alasan"),
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

/**
 * PENGAJUAN CUTI / LIBUR karyawan. Sebelum ini, ketidakhadiran = tidak ada
 * baris di `attendances` — tak terbedakan antara alpa, cuti, atau libur yang
 * memang disepakati. Baris di sini yang berstatus `disetujui` itulah yang
 * mengubah sebuah tanggal dari "alpa" menjadi "cuti"/"libur" pada rekap absen.
 *
 * Hanya yang DISETUJUI berpengaruh: pengajuan `menunggu`/`ditolak` tak pernah
 * mengurangi hitungan tidak hadir.
 */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** pemohon */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** cabang pemohon saat mengajukan; null utk owner/admin tanpa cabang */
    branchId: uuid("branch_id").references(() => branches.id),
    jenis: pengajuanJenisEnum("jenis").notNull(),
    kategori: pengajuanKategoriEnum("kategori").notNull(),
    /** rentang INKLUSIF; satu hari → mulai == selesai */
    tanggalMulai: date("tanggal_mulai").notNull(),
    tanggalSelesai: date("tanggal_selesai").notNull(),
    alasan: text("alasan"),
    /** bukti pendukung (mis. surat dokter) — URL hasil POST /upload?tujuan=bukti */
    lampiranUrl: text("lampiran_url"),
    status: pengajuanStatusEnum("status").notNull().default("menunggu"),
    /** owner/admin yang memutuskan; null selama masih menunggu */
    diputusOlehUserId: uuid("diputus_oleh_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    diputusPada: timestamp("diputus_pada", { withTimezone: true }),
    /** wajib terisi saat status "ditolak" (ditegakkan di route) */
    alasanTolak: text("alasan_tolak"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_company_status_idx").on(t.companyId, t.status),
    index("leave_requests_user_mulai_idx").on(t.userId, t.tanggalMulai),
    // Rekap sebulan menyapu rentang yang BERTINDIH dengan bulan itu.
    index("leave_requests_company_rentang_idx").on(
      t.companyId,
      t.tanggalMulai,
      t.tanggalSelesai,
    ),
  ],
);

/**
 * MASTER AREA KEBERSIHAN — daftar yang dicentang karyawan tiap sesi. Isinya
 * diatur owner (bukan hard-code) karena tiap usaha beda: ada yang punya
 * chiller, ada yang punya area parkir.
 *
 * `branchId` null = area berlaku di SEMUA lokasi; terisi = khusus lokasi itu.
 * Itulah yang membuat Central Kitchen bisa punya area sendiri (ruang produksi,
 * chiller) tanpa mengotori daftar area toko.
 */
export const cleaningAreas = pgTable(
  "cleaning_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** null = berlaku di semua cabang/CK */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    nama: text("nama").notNull(),
    /** urutan tampil pada checklist; kecil = di atas */
    urutan: integer("urutan").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cleaning_areas_company_aktif_idx").on(t.companyId, t.isActive)],
);

/**
 * LAPORAN KEBERSIHAN HARIAN — satu baris per karyawan × tanggal × sesi.
 * Karyawan membuat laporannya masing-masing; owner membacanya sebagai rekap
 * satu kotak per hari.
 *
 * `tanggal` SELALU diturunkan server dari zona waktu perusahaan (seperti
 * `attendances.attendDate`), tidak pernah dikirim klien — supaya laporan tak
 * bisa dibuat mundur.
 */
export const cleaningReports = pgTable(
  "cleaning_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** lokasi pelapor, diambil dari membership — bukan dari body */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tanggal: date("tanggal").notNull(),
    sesi: kebersihanSesiEnum("sesi").notNull(),
    catatan: text("catatan"),
    /** balasan owner/admin atas laporan ini — dibaca pelapor */
    catatanOwner: text("catatan_owner"),
    catatanOwnerOlehUserId: uuid("catatan_owner_oleh_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    catatanOwnerPada: timestamp("catatan_owner_pada", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Inilah yang menegakkan "satu laporan per sesi".
    uniqueIndex("cleaning_reports_user_tanggal_sesi_uq").on(
      t.companyId,
      t.userId,
      t.tanggal,
      t.sesi,
    ),
    index("cleaning_reports_company_tanggal_idx").on(t.companyId, t.tanggal),
    index("cleaning_reports_company_branch_tanggal_idx").on(
      t.companyId,
      t.branchId,
      t.tanggal,
    ),
  ],
);

/**
 * Baris checklist sebuah laporan. `areaNama` disalin (snapshot) supaya
 * mengganti nama atau menghapus area master tidak merusak laporan lama —
 * pola yang sama dipakai `sales.mejaLabel`.
 */
export const cleaningReportItems = pgTable(
  "cleaning_report_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => cleaningReports.id, { onDelete: "cascade" }),
    /** null bila area masternya sudah dihapus — `areaNama` tetap terbaca */
    areaId: uuid("area_id").references(() => cleaningAreas.id, { onDelete: "set null" }),
    areaNama: text("area_nama").notNull(),
    bersih: boolean("bersih").notNull(),
    catatan: text("catatan"),
    /** URL hasil POST /upload?tujuan=bukti; minimal 1 per laporan (ditegakkan di route) */
    fotoUrl: text("foto_url"),
    urutan: integer("urutan").notNull().default(0),
  },
  (t) => [
    index("cleaning_report_items_report_idx").on(t.reportId),
    /**
     * Satu area maksimal satu baris per laporan. `siapkanItems` sudah menolak
     * area kembar DALAM satu permintaan, tapi itu tak menolong saat dua
     * perangkat mem-PATCH laporan yang sama nyaris bersamaan: di READ
     * COMMITTED, transaksi kedua menghapus 0 baris (yang pertama sudah
     * menghapusnya) lalu tetap menyisipkan set lengkapnya — hasilnya checklist
     * ganda yang MEMBEKU esok hari karena PATCH lintas-tanggal ditolak 409.
     * Transaksi saja tak menutup ini; hanya indeks unik yang bisa.
     *
     * `areaId` boleh NULL (area masternya dihapus) dan Postgres memperlakukan
     * NULL sebagai saling berbeda — jadi laporan lama yang areanya sudah
     * dihapus tetap boleh punya banyak baris ber-`area_id` NULL.
     */
    uniqueIndex("cleaning_report_items_report_area_uq").on(t.reportId, t.areaId),
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
    /**
     * ANGKA ASAL sebelum refund apa pun — jangkar tetap untuk menghitung
     * refund bertahap. `subtotal`/`diskon`/`pb1_amount`/`total` di atas selalu
     * berisi nilai TERKINI (sudah dikurangi refund), karena seluruh laporan,
     * rekap kas, dan laba-rugi membacanya apa adanya.
     *
     * null = belum pernah direfund → nilai terkini MEMANG nilai asalnya. Itu
     * sebabnya kolom ini nullable: tak ada backfill untuk jutaan baris lama.
     * Diisi sekali saat refund pertama, lalu tak pernah berubah lagi — kalau
     * ikut berubah, refund kedua akan menggerus diskon untuk kedua kalinya.
     */
    subtotalAsal: numeric("subtotal_asal", { precision: 14, scale: 2, mode: "number" }),
    diskonAsal: numeric("diskon_asal", { precision: 14, scale: 2, mode: "number" }),
    pb1Asal: numeric("pb1_asal", { precision: 14, scale: 2, mode: "number" }),
    /** total uang yang sudah dikembalikan ke pembeli (kumulatif, Rp) */
    refundTotal: numeric("refund_total", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
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
    /**
     * Shift kasir tempat transaksi ini dibukukan. Sebelumnya hubungan sale↔shift
     * hanya DISIMPULKAN dari waktu (`waktu` di dalam `[opened_at, closed_at]`),
     * jadi transaksi offline yang tiba setelah shift ditutup tidak punya tempat
     * berpijak: uangnya nyata ada di laci, tapi tak muncul di rekap mana pun.
     * Kolom ini membuat penautan itu eksplisit sehingga transaksi susulan tetap
     * masuk rekap & selisih kas shift yang benar.
     *
     * Nullable: baris lama (dan jalur online biasa) tetap ditautkan lewat
     * jendela waktu — lihat `rekapWindow()` di modul shift. Jadi tidak perlu
     * backfill, dan tidak ada risiko hitung ganda karena kedua jalur saling
     * eksklusif (`shift_id` terisi ATAU `shift_id IS NULL` + di dalam jendela).
     */
    shiftId: uuid("shift_id").references(() => shifts.id),
    // PAPAN PESANAN — status pengerjaan & penanda penyajian ADA DI BARIS
    // (`sale_items`), bukan di sini. Dapur menyelesaikan pesanan
    // sepotong-sepotong: minuman lebih dulu, gorengan menyusul. Status
    // setingkat transaksi memaksa "semua atau tak satu pun", sehingga tak ada
    // cara tahu mana yang sudah dan mana yang belum.
    //
    // Status kartu di papan DITURUNKAN dari barisnya saat dibaca, bukan
    // disimpan. Agregat yang disimpan harus ikut diperbarui di setiap
    // perubahan baris, dan satu yang terlewat membuat papan berbohong — itu
    // pelajaran yang sama dengan status meja.
    /**
     * Bill asal bila transaksi ini lahir dari open bill. TANPA foreign key:
     * bill bisa dibatalkan/dihapus permanen, dan jejak asalnya tetap berguna.
     */
    asalOpenBillId: uuid("asal_open_bill_id"),
    // soft-delete (Tempat Sampah): baris tetap disimpan sebagai catatan siapa yang menghapus
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("sales_branch_nomor_uq").on(t.branchId, t.nomor),
    index("sales_company_branch_date_idx").on(t.companyId, t.branchId, t.saleDate),
    // rekap shift menyaring per shift_id — indeks parsial cukup, mayoritas NULL
    index("sales_shift_idx").on(t.shiftId),
    // papan meja: "transaksi apa saja di meja X sejak jam sekian"
    index("sales_meja_idx").on(t.branchId, t.mejaId, t.waktu),
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
    /**
     * PAPAN PESANAN — pengerjaan dapur PER BARIS. Dapur menyelesaikan pesanan
     * sepotong-sepotong, jadi inilah satuan yang benar: minuman bisa `selesai`
     * sementara gorengan masih `dikerjakan`.
     *
     * `batal` di sini adalah PENANDA DAPUR ("tidak jadi dibuat"), BUKAN void:
     * `line_total`, `hpp_satuan`, `sale_consumptions`, struk, dan laporan tidak
     * bergerak sedikit pun. Pengembalian uang tetap lewat hapus transaksi.
     */
    pesananStatus: pesananStatusEnum("pesanan_status").notNull().default("dikerjakan"),
    pesananStatusAt: timestamp("pesanan_status_at", { withTimezone: true }),
    pesananStatusOleh: uuid("pesanan_status_oleh").references(() => users.id),
    /**
     * KAPAN BARIS INI MASUK DAPUR — pangkal hitungan lama pengerjaan.
     *
     * Sengaja PER BARIS, bukan diambil dari `sales.waktu`. Baris yang lahir dari
     * open bill membawa waktu aslinya (lihat `pesananMasukAt` di
     * `open_bill_items`): pelanggan memesan ronde kedua pukul 21.00 pada bill
     * yang dibuka pukul 19.00, dan menghitungnya sejak bill dibuka akan
     * melaporkan dapur bekerja dua jam untuk satu gelas es teh.
     *
     * Bukan `defaultNow()` di tingkat kolom saja: `createSale` MENGOPER nilai
     * ini dari baris bill asalnya, supaya membayar di tengah jalan tidak
     * mengulang jamnya dari nol.
     */
    pesananMasukAt: timestamp("pesanan_masuk_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * PENYAJIAN "bawa pulang" — SENGAJA terpisah dari `is_dine_in`.
     *
     * Keduanya menjawab pertanyaan berbeda dan tidak boleh disatukan:
     * - `is_dine_in` = FAKTA PEMBUKUAN, di mana pesanan dimakan. Dasar
     *   pemisahan omzet dine-in/bawa-pulang dan label meja pada struk.
     * - `sajian_takeaway` = BASIS BIAYA. `hpp_satuan` dan `sale_consumptions`
     *   dihitung dari kolom INI lewat `qtyEfektif()` (bawa pulang memakai
     *   kemasan penuh; dine-in melewati kemasan dan menghitung pelengkap 50%).
     *
     * Sebabnya: sebuah porsi bisa dibukukan di meja dine-in tapi akhirnya
     * dibungkus. Dusnya benar-benar keluar dari rak, jadi biaya & stok harus
     * mengikuti penyajiannya — bukan mejanya. Membalik kolom ini pada
     * penjualan yang sudah dibayar MEMICU hitung-ulang biaya seluruh
     * transaksi (`penjualan/rekalkulasi.ts`).
     */
    sajianTakeaway: boolean("sajian_takeaway").notNull().default(false),
    /**
     * Porsi baris ini yang sudah DIKEMBALIKAN ke pembeli — KUMULATIF, bukan
     * per-kejadian. Refund terjadi saat bahan ternyata habis sehingga sajiannya
     * tak jadi dibuat setelah transaksi dibayar.
     *
     * `qty` TIDAK dikurangi: berapa yang dipesan dan berapa yang dikembalikan
     * adalah dua fakta berbeda, dan struk asli harus tetap bisa dibaca. Yang
     * ditagih = `qty − qty_refund`; itu pula dasar HPP dan konsumsi bahan
     * (`penjualan/rekalkulasi.ts`), sehingga stok bahannya kembali sendiri.
     */
    qtyRefund: numeric("qty_refund", { precision: 10, scale: 2, mode: "number" })
      .notNull()
      .default(0),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    // papan menyaring baris yang belum selesai per transaksi
    index("sale_items_status_idx").on(t.saleId, t.pesananStatus),
  ],
);

/**
 * REFUND SEBAGIAN — satu baris per kejadian pengembalian uang.
 *
 * Sebabnya di lapangan cuma satu: bahan ternyata habis sehingga sajiannya tak
 * jadi dibuat setelah transaksi dibayar. Kasir boleh melakukannya sendiri
 * (pembeli sedang berdiri di depannya), jadi `user_id` WAJIB — wewenangnya
 * ditukar dengan jejak.
 *
 * Tabel ini adalah RIWAYAT, bukan sumber kebenaran angka: nilai terkini
 * penjualan hidup di `sales.*` dan `sale_items.qty_refund`. Yang disimpan di
 * sini adalah "apa yang terjadi, kapan, oleh siapa, berapa" — supaya owner bisa
 * memeriksa belakangan tanpa harus merekonstruksi dari selisih.
 */
export const saleRefunds = pgTable(
  "sale_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    saleItemId: uuid("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "cascade" }),
    /** porsi yang dikembalikan PADA KEJADIAN INI (bukan kumulatif) */
    qty: numeric("qty", { precision: 10, scale: 2, mode: "number" }).notNull(),
    /** uang yang benar-benar dikembalikan ke pembeli (Rp) */
    nominal: numeric("nominal", { precision: 14, scale: 2, mode: "number" }).notNull(),
    alasan: text("alasan"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /**
     * Shift yang MENANGGUNG refund ini — sejajar dengan `sales.shift_id`.
     *
     * Diisi shift yang sedang terbuka di cabang saat refund dibuat. NULL punya
     * arti tegas: tak ada shift terbuka saat itu (owner/admin merefund di luar
     * jam buka). Baris NULL disapu oleh shift BERIKUTNYA yang dibuka di cabang
     * itu — laci itulah yang uangnya benar-benar keluar.
     */
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sale_refunds_sale_idx").on(t.saleId),
    index("sale_refunds_shift_idx").on(t.shiftId),
    // laporan refund per cabang per rentang waktu
    index("sale_refunds_cabang_waktu_idx").on(t.companyId, t.branchId, t.createdAt),
  ],
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
    // PAPAN PESANAN — status pengerjaan ada di BARIS (`open_bill_items`);
    // alasannya di catatan `sales` di atas.
    /**
     * Bill SELESAI: sudah dibayar (jadi `sale_id`) atau dibatalkan. Dulu bill
     * dihapus keras oleh browser setelah bayar — panggilan yang tak dijamin
     * sampai, dan yang jalur sinkron offline tak pernah kirim sama sekali,
     * sehingga bill hantu menumpuk. Sekarang penutupan dilakukan server di
     * dalam transaksi `createSale`, dan baris bill DIPERTAHANKAN sebagai
     * jejak asal pesanan.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * BILL INI PERNAH JADI PENJUALAN — fakta, bukan penunjuk.
     *
     * `sale_id` sudah menyatakan hal yang sama, tapi ia FK ber-`ON DELETE SET
     * NULL`: begitu penjualannya dihapus permanen (Tempat Sampah dikosongkan),
     * Postgres menghapus penunjuknya dan faktanya ikut hilang. Terukur, dan
     * pemicunya tindakan pemilik yang biasa saja:
     *
     *   bill dibayar → sale_id terisi, closed_at terisi
     *   penjualannya dihapus → sampah dikosongkan
     *   → sale_id = NULL, closed_at TETAP terisi
     *
     * Dua akibatnya terukur lewat HTTP:
     *
     *   1. Bill yang SUDAH DIBAYAR muncul lagi sebagai kartu pesanan aktif di
     *      layar kasir/dapur — `GET /pesanan` menyaring dengan
     *      `sale_id IS NULL`.
     *   2. Percobaan bayar ulang dibalas `bill_dibatalkan`, bukan
     *      `bill_sudah_dibayar`. Catatan di `penjualan/service.ts` menulis
     *      sendiri bedanya: `bill_dibatalkan` berarti "membuang perintahnya
     *      berarti kehilangan satu transaksi sungguhan", jadi klien offline
     *      MENAHAN perintah yang tak akan pernah berhasil.
     *
     * Kolom ini menyimpan faktanya terpisah dari penunjuknya, jadi penghapusan
     * penjualan tak bisa lagi mengubah arti sebuah bill.
     */
    pernahJadiPenjualan: boolean("pernah_jadi_penjualan").notNull().default(false),
    // `set null`, BUKAN default `no action`. Tempat Sampah menghapus KERAS baris
    // `sales` (`sampah/routes.ts` — "Kosongkan"), dan FK yang menahan bikin
    // seluruh transaksi itu rollback: sekali ada satu penjualan asal-bill yang
    // dibatalkan, Tempat Sampah tak pernah bisa dikosongkan lagi. Bill-nya kita
    // pertahankan (jejak asal pesanan, lihat catatan `closedAt` di atas) —
    // yang putus cukup tautannya. Sisi sebaliknya, `sales.asal_open_bill_id`,
    // sengaja dibiarkan TANPA FK untuk alasan yang sama.
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "set null" }),
  },
  (t) => [
    index("open_bills_company_branch_idx").on(t.companyId, t.branchId, t.updatedAt),
    // Papan meja menanyakan "bill mana yang masih berjalan di meja X" tiap 30
    // detik dari tiap layar cabang. Indeks PARSIAL: hanya bill yang belum
    // ditutup yang pernah dicari, dan itu segelintir baris walau tabelnya
    // tumbuh setahun. (Pola sama dengan `shifts_open_per_branch_uq`.)
    index("open_bills_meja_aktif_idx")
      .on(t.branchId, t.mejaId)
      .where(sql`${t.closedAt} IS NULL`),
  ],
);

/**
 * RIWAYAT perubahan status pesanan — siapa menandai apa, kapan. Meniru
 * `fakturLogs`: satu baris per aksi, tak pernah diubah/dihapus.
 *
 * Dua kolom rujukan yang saling eksklusif karena satu pesanan bisa hidup
 * sebagai open bill lalu menjadi penjualan. Keduanya `onDelete: "cascade"` —
 * bila induknya benar-benar dihapus permanen (Tempat Sampah dikosongkan),
 * jejaknya ikut hilang bersamanya, bukan menggantung.
 */
export const pesananLogs = pgTable(
  "pesanan_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    saleId: uuid("sale_id").references(() => sales.id, { onDelete: "cascade" }),
    openBillId: uuid("open_bill_id").references(() => openBills.id, { onDelete: "cascade" }),
    /** label siap tampil, mis. "Ditandai selesai", "Diubah jadi bawa pulang" */
    aksi: text("aksi").notNull(),
    /**
     * Nama baris yang disentuh, SNAPSHOT — null berarti aksinya mengenai
     * seluruh pesanan. Sengaja teks, bukan FK: baris bill bisa diganti kasir
     * saat pesanan ditambah, dan riwayat "Es Teh ditandai selesai" harus tetap
     * terbaca meski barisnya sudah tak ada.
     */
    itemNama: text("item_nama"),
    statusLama: pesananStatusEnum("status_lama"),
    statusBaru: pesananStatusEnum("status_baru"),
    userId: uuid("user_id").references(() => users.id),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pesanan_logs_sale_idx").on(t.saleId, t.waktu),
    index("pesanan_logs_bill_idx").on(t.openBillId, t.waktu),
    index("pesanan_logs_cabang_idx").on(t.companyId, t.branchId, t.waktu),
    // "riwayat kegiatan per karyawan" — pola yang sama dengan faktur_logs
    index("pesanan_logs_user_idx").on(t.companyId, t.userId, t.waktu),
  ],
);

/**
 * PAPAN MEJA — jejak "meja ini sudah saya bereskan", satu baris per penekanan
 * tombol Kosongkan. Tabel ini punya DUA pekerjaan sekaligus:
 *
 * 1. **Audit** — siapa mengosongkan meja mana, kapan, dan apakah ia menerobos
 *    peringatan bahwa masih ada tagihan hidup di sana.
 * 2. **Batas derivasi** — status "isi" TIDAK disimpan di mana pun; ia dihitung
 *    dari tagihan & transaksi yang memang sudah tercatat. Kolom `sampai` di
 *    sinilah yang memberitahu perhitungan itu "abaikan yang lebih tua dari ini".
 *
 * `sampai` sengaja BUKAN `now()` melainkan waktu transaksi TERBARU yang benar
 * -benar ikut terhitung saat tombol ditekan (watermark). Bedanya menentukan:
 * dengan `now()`, pesanan yang masuk sepersekian detik sebelum tombol ditekan
 * ikut tersapu diam-diam dan meja jadi hijau padahal tamunya baru datang.
 * Dengan watermark, pesanan itu lebih baru dari batas → meja tetap merah.
 */
export const mejaKosongLogs = pgTable(
  "meja_kosong_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    mejaId: uuid("meja_id")
      .notNull()
      .references(() => meja.id, { onDelete: "cascade" }),
    /** label siap tampil, mis. "Meja dikosongkan" */
    aksi: text("aksi").notNull(),
    /**
     * Pengosongan BIASA hanya memotong transaksi yang sudah lunas. Hanya baris
     * ber-`paksa` yang juga memotong bill yang BELUM dibayar — itulah yang
     * membuat tombol biasa mustahil menyembunyikan tagihan hidup tanpa sengaja.
     * Bill-nya sendiri tak pernah dibatalkan: ia tetap ada dan tetap ditagih.
     */
    paksa: boolean("paksa").notNull().default(false),
    /** ringkas untuk layar riwayat, mis. "2 transaksi · 1 bill belum dibayar" */
    detail: text("detail"),
    userId: uuid("user_id").references(() => users.id),
    /** batas derivasi (watermark) — lihat komentar tabel */
    sampai: timestamp("sampai", { withTimezone: true }).notNull(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meja_kosong_logs_meja_idx").on(t.mejaId, t.waktu),
    index("meja_kosong_logs_cabang_idx").on(t.companyId, t.branchId, t.waktu),
    // "riwayat kegiatan per karyawan" — pola yang sama dengan pesanan_logs
    index("meja_kosong_logs_user_idx").on(t.companyId, t.userId, t.waktu),
  ],
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
    /**
     * Harga jual per porsi yang DIKUNCI saat baris ini dimasukkan ke bill.
     * Tanpa snapshot ini, bill yang dibuka hari ini lalu dibayar besok ditagih
     * harga menu TERBARU — bukan harga yang disepakati pembeli saat memesan.
     */
    hargaSatuan: numeric("harga_satuan", { precision: 14, scale: 2, mode: "number" }).notNull(),
    /** nama menu saat dipesan — bill tetap terbaca bila menu di-rename/diarsipkan */
    menuNama: text("menu_nama").notNull(),
    qty: numeric("qty", { precision: 10, scale: 2, mode: "number" }).notNull(),
    /** null = ikut mode transaksi; true/false = override dine-in per baris */
    dineInOverride: boolean("dine_in_override"),
    catatan: text("catatan"),
    /**
     * PAPAN PESANAN — pengerjaan dapur per baris; kembaran
     * `sale_items.pesananStatus`. Diwarisi baris penjualan saat bill dibayar
     * lewat `open_bill_item_id`, jadi pekerjaan dapur tak hilang saat pelanggan
     * membayar di tengah jalan.
     */
    pesananStatus: pesananStatusEnum("pesanan_status").notNull().default("dikerjakan"),
    pesananStatusAt: timestamp("pesanan_status_at", { withTimezone: true }),
    pesananStatusOleh: uuid("pesanan_status_oleh").references(() => users.id),
    /**
     * KAPAN BARIS INI MASUK DAPUR — pangkal hitungan lama pengerjaan, dan
     * inilah alasan kolomnya ada di sini alih-alih memakai `open_bills.created_at`.
     *
     * Satu bill hidup berjam-jam dan pesanannya datang bergelombang. Ronde
     * kedua yang dipesan pukul 21.00 pada bill yang dibuka pukul 19.00 harus
     * dihitung sejak 21.00; memakai waktu bill akan melaporkan dapur bekerja
     * dua jam untuk satu gelas es teh, dan rata-rata per menu di laporan ikut
     * tercemar.
     *
     * Diwarisi baris penjualan saat bill dibayar (`open_bill_item_id`), sama
     * seperti `pesananStatus` — membayar di tengah jalan tak boleh mengulang
     * jamnya dari nol.
     */
    pesananMasukAt: timestamp("pesanan_masuk_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Penyajian "bawa pulang" per baris — ikut diwarisi baris penjualan saat
     * dibayar, dan di sanalah ia menjadi BASIS BIAYA (kemasan take away masuk
     * HPP & `sale_consumptions`). Di bill sendiri belum ada biaya terbuku,
     * jadi menandainya di sini tidak menggerakkan angka apa pun — cukup
     * instruksi kerja sampai pesanannya dilunasi.
     */
    sajianTakeaway: boolean("sajian_takeaway").notNull().default(false),
  },
  (t) => [
    index("open_bill_items_bill_idx").on(t.billId),
    index("open_bill_items_status_idx").on(t.billId, t.pesananStatus),
  ],
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
    /**
     * KAPAN BARANGNYA BENAR-BENAR BERANGKAT dari cabang asal (`POST
     * /produksi/kirim`). Null = belum dikirim.
     *
     * Ada karena `status = 'menunggu'` menanggung TIGA arti sekaligus:
     * "selesai diproduksi" dan "siap dikirim" (barangnya masih di rak) serta
     * "dalam perjalanan" (sudah tidak di rak). Tanpa penanda ini keduanya tak
     * bisa dibedakan, dan opname fisik jadi salah untuk salah satunya —
     * memotong terlalu banyak membuat saldo CK MINUS, memotong terlalu sedikit
     * membuat kiriman yang sedang berjalan terbaca sebagai barang hilang.
     *
     * BUKAN sekadar metadata tampilan (beda dari `dari_branch_id`): ia dipakai
     * saldo. `kirim_keluar` membandingkannya dengan baseline opname supaya
     * barang yang sudah berangkat SEBELUM penghitungan tidak dikurangkan lagi
     * saat tiba — tanpa itu opname yang benar justru menjatuhkan saldo ke minus.
     * `waktu` tak bisa dipakai untuk itu: ia ditimpa waktu penerimaan saat
     * baris dikonfirmasi.
     */
    dikirimAt: timestamp("dikirim_at", { withTimezone: true }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: numeric("qty", { precision: 16, scale: 6, mode: "number" }).notNull(),
    /** jalur penambahan: produksi sendiri atau pembelian */
    tipe: pengadaanEnum("tipe").notNull().default("produksi"),
    /** total harga saat tipe='beli' (catatan pengeluaran, opsional) */
    totalHarga: numeric("total_harga", { precision: 14, scale: 2, mode: "number" }),
    /**
     * true = `total_harga` baris ini TEBAKAN, bukan angka yang dilihat manusia:
     * faktur dibuat tanpa harga, jadi diisi `hargaDefault()` = qty × harga acuan
     * bahan SAAT ITU.
     *
     * Wajib dibedakan karena "Laporan Harga" menyegarkan harga acuan bahan ke
     * MEDIAN riwayat pembelian. Kalau tebakan ikut kolam median, acuan menyeret
     * dirinya sendiri (acuan → tebakan → median → acuan) dan HPP seluruh menu
     * hanyut naik tanpa ada yang mengubah harga jual. Menjadi false begitu
     * harga sungguhan diisi (Laporan Harga / realisasi harga di tahap).
     */
    hargaTebakan: boolean("harga_tebakan").notNull().default(false),
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
  // faktur TRANSFER STOK antar lokasi (TF-, ref = productions.faktur_id)
  "transfer",
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
 * Penanda "peringatan sudah dikirim" — satu baris per JENIS peringatan.
 *
 * Pemeriksanya berjalan tiap 5 menit; tanpa penanda ini, satu keadaan gawat
 * yang berlangsung seminggu akan mengirim dua ribu email, dan yang menerimanya
 * berhenti membaca email peringatan sebelum hari kedua.
 *
 * Sengaja di DATABASE, bukan di memori proses: keadaan gawat yang bertahan
 * justru sering ditemani proses yang restart berkali-kali (deploy, crash-loop),
 * dan penanda di memori ikut hilang tiap kali — mengembalikan persis banjir
 * email yang hendak dicegah. Di database juga membuatnya benar saat lebih dari
 * satu instance berjalan: klaimnya satu baris, jadi hanya satu yang menang.
 *
 * Barisnya DIHAPUS begitu keadaannya pulih, sehingga penanda yang ada selalu
 * berarti "peringatan yang SEDANG berlangsung sudah dikabarkan".
 */
export const peringatanTerkirim = pgTable("peringatan_terkirim", {
  key: text("key").primaryKey(),
  terakhirAt: timestamp("terakhir_at", { withTimezone: true }).notNull().defaultNow(),
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

/**
 * LOG GALAT PLATFORM. Setiap respons error yang keluar lewat `app.onError`
 * dicatat di sini — 5xx (bug server) MAUPUN 4xx (penolakan: validasi, izin,
 * tak ditemukan, rate limit). Dipakai panel super admin supaya masalah nyata
 * terlihat tanpa harus membuka log container.
 *
 * LINTAS TENANT dan boleh memuat identitas pelapor → HANYA super admin
 * (`requireSuperAdmin` di app.ts). Jangan pernah dipasang di router tenant.
 *
 * Yang SENGAJA tidak disimpan: badan request (bisa memuat password/token),
 * query string (tautan verifikasi & reset membawa token di query), dan header
 * Authorization. Yang dicatat cukup untuk melacak: jalur, pesan, jejak tumpukan
 * (5xx saja), serta siapa & perusahaan mana yang mengalaminya.
 */
export const errorLogs = pgTable(
  "error_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waktu: timestamp("waktu", { withTimezone: true }).notNull().defaultNow(),
    /** status HTTP yang dikirim ke klien (400–599) */
    status: integer("status").notNull(),
    metode: text("metode").notNull(),
    /** jalur apa adanya TANPA query string, mis. `/api/bahan/9f3c…` */
    jalur: text("jalur").notNull(),
    /**
     * Jalur ter-normalisasi untuk pengelompokan: UUID & angka diganti `:id`
     * (`/api/bahan/:id`). Tanpa ini tiap id jadi kelompok sendiri dan daftar
     * galat penuh baris yang sebenarnya satu masalah.
     */
    jalurPola: text("jalur_pola").notNull(),
    pesan: text("pesan").notNull(),
    /** jejak tumpukan — hanya diisi untuk 5xx (4xx adalah penolakan, bukan bug) */
    stack: text("stack"),
    /**
     * Sidik jari kelompok: hash dari status + metode + jalur_pola + pesan.
     * Baris tetap satu-per-kejadian (kronologi utuh); kolom ini yang membuat
     * "12.000 baris" bisa disajikan sebagai "12 masalah berbeda".
     */
    sidik: text("sidik").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    /** peran saat kejadian — disalin, bukan direferensi (peran bisa berubah) */
    peran: text("peran"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("error_logs_waktu_idx").on(t.waktu),
    index("error_logs_sidik_idx").on(t.sidik),
    index("error_logs_status_idx").on(t.status),
  ],
);

/**
 * RIWAYAT HARGA JUAL MENU — jejak siapa/kapan mengubah harga yang ditagih ke
 * pembeli. Dibuat setelah keluhan "harga menu tiba-tiba berubah": tanpa jejak
 * ini, membuktikan bahwa harga jual TIDAK pernah disentuh (dan yang bergerak
 * sebenarnya HPP) hanya bisa lewat dugaan.
 *
 * `harga_lama` null = baris pertama, yaitu saat menu dibuat.
 */
export const menuPriceLogs = pgTable(
  "menu_price_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    hargaLama: numeric("harga_lama", { precision: 12, scale: 2, mode: "number" }),
    hargaBaru: numeric("harga_baru", { precision: 12, scale: 2, mode: "number" }).notNull(),
    multLama: numeric("mult_lama", { precision: 7, scale: 3, mode: "number" }),
    multBaru: numeric("mult_baru", { precision: 7, scale: 3, mode: "number" }),
    /** "buat" | "manual" | "terapkan_saran" — dari mana perubahan datang */
    sebab: text("sebab").notNull(),
    /** pelaku; null bila akunnya sudah dihapus */
    olehUserId: uuid("oleh_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("menu_price_logs_company_menu_idx").on(t.companyId, t.menuId, t.createdAt),
  ],
);
