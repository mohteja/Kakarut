import { z } from "zod";

// Muat .env bila ada (Node >= 20.12) — tidak fatal jika tidak ada.
try {
  process.loadEnvFile();
} catch {
  /* .env opsional */
}

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://postgres@127.0.0.1:5433/kakarut"),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("12h"),

  /** Sakelar utama rate limiting endpoint sensitif (login/lupa-password/tamu/sinkron). */
  RATE_LIMIT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),

  /**
   * BERAPA PROXY DI DEPAN APLIKASI INI — dan karena itu, berapa entri
   * `X-Forwarded-For` di ujung KANAN yang boleh dipercaya.
   *
   * XFF ditambahi dari kiri ke kanan: tiap proxy MENAMBAHKAN alamat rekan
   * bicaranya di belakang rantai. Jadi entri paling KIRI adalah yang dikirim
   * klien sendiri — bebas diisi apa saja — sementara entri yang ditambahkan
   * proxy tepercaya kita ada di KANAN. Membaca yang kiri berarti mempercayai
   * penyerang untuk menyebutkan identitasnya sendiri.
   *
   * Nilai 1 (bawaan) cocok dengan penyebaran yang dikirim repo ini: satu
   * Traefik/Dokploy di depan aplikasi. Tambah jadi 2 bila ada CDN di depan
   * Traefik. Setel 0 bila aplikasi diekspos LANGSUNG tanpa proxy — dengan 0,
   * XFF diabaikan sepenuhnya dan yang dipakai alamat koneksi sebenarnya.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),

  /** jalankan migrasi database otomatis saat server start (default: aktif) */
  AUTO_MIGRATE: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),

  /**
   * Base URL publik aplikasi — dipakai membangun tautan email (verifikasi,
   * reset password, undangan) DAN sebagai asal KANONIK: permintaan dokumen
   * yang datang lewat alias (`www.` ↔ tanpa `www.`, `http` → `https`, atau
   * host lain di `APP_HOST_DIPERCAYA`) dialihkan 301 ke sini, supaya sesi
   * yang tersimpan di peramban (per asal) tak terbelah dua — lihat
   * `lib/host-kanonik.ts`. OPSIONAL: bila kosong, base URL diturunkan dari
   * header permintaan (proto + host) sehingga tautan mengikuti domain yang
   * dipakai pengguna, dan TAK ADA pengalihan. Set eksplisit bila perlu domain
   * kustom tetap.
   */
  APP_BASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /**
   * Host yang BOLEH dipakai membangun tautan email, dipisah koma — untuk
   * pemasangan multi-domain yang tak bisa memaku satu `APP_BASE_URL`.
   * Host dari header yang tak ada di daftar ini diabaikan; entri PERTAMA
   * dipakai sebagai domain kanonik. Lihat `lib/base-url.ts`.
   */
  APP_HOST_DIPERCAYA: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** Fallback pengirim email bila SMTP belum diatur (opsional). */
  RESEND_API_KEY: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  UPLOAD_DIR: z.string().optional(),
  /**
   * Bucket R2 khusus cadangan (backup) — TERPISAH & PRIVAT dari bucket upload
   * publik. Bila kosong, cadangan disimpan di bucket upload (R2_BUCKET) dengan
   * prefix `backups/`. Apa pun pilihannya, cadangan HANYA diunduh lewat
   * endpoint super admin (server yang meng-stream), tak pernah lewat URL publik.
   */
  R2_BACKUP_BUCKET: z.string().optional(),

  /** Pencadangan database otomatis (penjadwal saat boot). Default aktif. */
  BACKUP_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  /**
   * Jam LOKAL jadwal cadangan harian (0–23). Default 2 = 02:00 dini hari,
   * saat outlet tutup — ekspor penuh membebani database, jangan sampai jatuh
   * di jam ramai. Zona waktunya mengikuti tenant (lihat BACKUP_TIMEZONE).
   */
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(2),
  /**
   * Paksa zona waktu jadwal cadangan. Kosongkan (disarankan) agar server
   * memakai zona waktu tenant TERBANYAK — cadangan jatuh saat outlet benar-
   * benar tutup, bukan saat tengah malam di zona server.
   */
  BACKUP_TIMEZONE: z.string().optional(),
  /** Retensi: jumlah cadangan sukses terakhir yang disimpan. Default 14. */
  BACKUP_KEEP: z.coerce.number().min(1).default(14),
  /**
   * Berapa HARI tanpa cadangan sukses sebelum super admin diemail. Default 2.
   *
   * Kenapa 2 dan bukan 1: penjadwal sudah punya jaring pengaman 26 jam, jadi
   * satu jadwal yang terlewat akan mengejar sendiri. Lewat dua hari artinya
   * jaring pengaman ITU SENDIRI yang tak jalan — dan itu tak akan pernah
   * memperbaiki diri sendiri.
   *
   * `0` mematikan peringatan (panel tetap menampilkan status).
   */
  BACKUP_ALERT_DAYS: z.coerce.number().int().min(0).default(2),
  /**
   * Folder cadangan saat mode penyimpanan LOKAL (R2 belum diatur). Default
   * `<uploads>/../backups`. Di kontainer, arahkan ke volume ter-mount agar
   * tidak hilang saat re-deploy.
   */
  BACKUP_DIR: z.string().optional(),

  SEED_SUPERADMIN_EMAIL: z.string().default("superadmin@kakarut.id"),
  SEED_SUPERADMIN_PASSWORD: z.string().default("SuperAdmin123!"),
  SEED_OWNER_EMAIL: z.string().default("terahokiindonesia@gmail.com"),
  SEED_OWNER_PASSWORD: z.string().default("Basooopa123!"),
  SEED_KASIR_EMAIL: z.string().default("kasir@basooopa.id"),
  SEED_KASIR_PASSWORD: z.string().default("Kasir123!"),
  SEED_DEMO_STOCK: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
});

const parsed = EnvSchema.parse(process.env);

// JWT_SECRET wajib di produksi — tanpa ini siapa pun bisa memalsukan token.
if (!parsed.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET wajib di-set di produksi (lihat .env.example)");
  }
  console.warn(
    "PERINGATAN: JWT_SECRET belum di-set — memakai secret development. JANGAN dipakai di produksi.",
  );
}

export const env = {
  ...parsed,
  JWT_SECRET: parsed.JWT_SECRET ?? "dev-secret-kakarut-hanya-development",
};

export const r2Configured = Boolean(
  env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET,
);
