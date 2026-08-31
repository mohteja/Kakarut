import { createHash, randomBytes, randomInt } from "node:crypto";
import { zValidator } from "../../lib/validator";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { env } from "../../config/env";
import { appBaseUrl } from "../../lib/base-url";
import { bentrokUnikPada } from "../../lib/pg-galat";
import { db } from "../../db/client";
import {
  branches,
  companies,
  emailVerificationTokens,
  passwordResetTokens,
  users,
} from "../../db/schema";
import { requireAuth, type AppEnv } from "../../middleware/auth";
import {
  emailDariBody,
  ipKlien,
  lewatiRateLimit,
  rateLimit,
} from "../../middleware/rateLimit";
import { emailTerkonfigurasi, kirimEmail } from "../mail/service";
import { suratReset, suratVerifikasi } from "../mail/surat";
import { autoTerimaUndanganEmail } from "../onboarding/service";
import { GUEST } from "../../seed/guest";
import { buatSesi } from "./session";

/** Token reset disimpan sebagai hash (bukan nilai mentah). */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
}).strict();

const RegisterSchema = z.object({
  nama: z.string().trim().min(1, "Nama wajib diisi"),
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
}).strict();

// ---------------------------------------------------------------------------
// Rate limiting endpoint publik (anti brute-force / abuse). Batas dipilih longgar
// untuk manusia normal, tetapi memblokir skrip yang menghajar berulang-ulang.
// `rl(...)` mematuhi sakelar env RATE_LIMIT_ENABLED (default aktif).
// ---------------------------------------------------------------------------
const rl = (mw: ReturnType<typeof rateLimit>) =>
  env.RATE_LIMIT_ENABLED ? mw : lewatiRateLimit;

/** Login: batasi per (IP + email) → tebak-password satu akun cepat mentok. */
const batasLogin = rl(
  rateLimit({
    windowMs: 5 * 60_000,
    max: 10,
    key: async (c) => `login:${ipKlien(c)}:${await emailDariBody(c)}`,
    message: "Terlalu banyak percobaan masuk — coba lagi beberapa menit lagi.",
  }),
);

/** Daftar akun: batasi per IP (bcrypt + tulis DB → mahal bila di-spam). */
const batasRegister = rl(
  rateLimit({
    windowMs: 60 * 60_000,
    max: 20,
    key: (c) => `register:${ipKlien(c)}`,
    message: "Terlalu banyak pendaftaran dari perangkat ini — coba lagi nanti.",
  }),
);

/** Masuk tamu: batasi per IP (bikin sesi + query berulang). */
const batasTamu = rl(
  rateLimit({
    windowMs: 5 * 60_000,
    max: 30,
    key: (c) => `guest:${ipKlien(c)}`,
    message: "Terlalu banyak permintaan mode tamu — coba lagi sebentar.",
  }),
);

/** Lupa password: batasi per (IP + email) → cegah bom email ke korban. */
const batasLupa = rl(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 6,
    key: async (c) => `forgot:${ipKlien(c)}:${await emailDariBody(c)}`,
    message: "Terlalu banyak permintaan reset — coba lagi beberapa menit lagi.",
  }),
);

/** Atur ulang password: batasi per IP → cegah tebak token brute-force. */
const batasReset = rl(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 20,
    key: (c) => `reset:${ipKlien(c)}`,
    message: "Terlalu banyak percobaan — coba lagi beberapa menit lagi.",
  }),
);

/** Verifikasi token email: batasi per IP → cegah tebak token brute-force. */
/*
 * BATAS PER IP, DINAIKKAN 20 → 60 SAAT TAUTAN DIGANTI KODE — dan angkanya
 * naik justru karena penjagaannya menguat, bukan melemah.
 *
 * 20 dikalibrasi untuk alur yang TAK PERNAH DIKETIK SIAPA PUN: tautan 64-hex
 * ditekan sekali, berhasil, selesai. Sebuah kode 6 angka salah ketik, dan
 * orang yang salah ketik akan mencoba lagi — lalu minta kode baru, lalu
 * mencoba lagi. Satu orang wajar menghabiskan 4–5 percobaan, dan kantor
 * ber-NAT yang mendaftarkan lima karyawan sekaligus menabrak 20 sebelum
 * seorang pun selesai. Batas yang menghukum pemakaian normal bukan penjagaan;
 * ia cuma memindahkan kegagalan ke tempat yang lebih membingungkan.
 *
 * YANG MENAHAN TEBAKAN BUKAN BATAS INI, melainkan `MAKS_PERCOBAAN`: tiap kode
 * mati sesudah lima tebakan salah, dan matinya PERMANEN — tak seperti batas
 * laju yang pulih sendiri seperempat jam kemudian. Peluang menembus satu akun
 * karena itu 5 : 1.000.000, berapa pun besar batas di sini. Sebelum ada kode,
 * penjaga per-percobaan itu tak ada sama sekali (token 32 byte memang tak bisa
 * ditebak, jadi tak perlu) — jadi angka di bawah menanggung beban yang kini
 * ditanggung tempat yang tepat.
 *
 * Sisanya yang masih dijaga di sini: SEBARAN dari satu IP ke banyak akun.
 * 60 per 15 menit = 240 per jam ≈ 48 akun yang bisa disenggol tiap jam, dengan
 * peluang 5 : 1.000.000 masing-masing.
 */
const batasVerifikasiCek = rl(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 60,
    key: (c) => `verif:${ipKlien(c)}`,
    message: "Terlalu banyak percobaan — coba lagi beberapa menit lagi.",
  }),
);

/** Kirim ulang verifikasi: batasi per (IP + email) → cegah bom email. */
const batasVerifikasiKirim = rl(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 6,
    key: async (c) => `verifkirim:${ipKlien(c)}:${await emailDariBody(c)}`,
    message: "Terlalu banyak permintaan — coba lagi beberapa menit lagi.",
  }),
);

/**
 * KODE VERIFIKASI 6 DIGIT — berlaku selama ini, sama dengan tautan reset
 * password di berkas yang sama.
 *
 * Bukan 24 jam seperti tautan yang digantikannya, dan bukan pula 10 menit
 * seperti kebiasaan OTP: rahasianya jauh lebih lemah daripada 32 byte acak
 * (sejuta kemungkinan), jadi umurnya tak boleh panjang — tapi yang paling
 * sering menggagalkan verifikasi adalah email yang datang terlambat, dan umur
 * yang terlalu pendek mengubah keterlambatan itu jadi jalan buntu. Satu jam
 * memberi ruang untuk keduanya, dan tombol "Kirim ulang" ada untuk sisanya.
 */
const VERIFIKASI_MENIT = 60;

/**
 * Percobaan SALAH yang ditoleransi untuk satu kode. Inilah yang membuat 6 digit
 * aman, bukan panjangnya: menebak sejuta kemungkinan dengan lima kesempatan
 * berpeluang 1 : 200.000 — dan sesudah kesempatan kelima kodenya mati, bukan
 * cuma tertahan batas laju yang akan pulih sendiri semenit kemudian.
 */
const MAKS_PERCOBAAN = 5;

/** Kode 6 digit, dari sumber acak kriptografis (bukan `Math.random`). */
function kodeVerifikasi(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Sidik kode: user id IKUT di-hash.
 *
 * Kode 6 digit bisa sama untuk dua akun pada saat yang sama. Meng-hash kodenya
 * telanjang membuat satu kode berlaku untuk akun mana pun yang kebetulan
 * memegangnya — dan itu bukan kekeliruan teoretis: verifikasi yang berhasil
 * LANGSUNG memberi sesi.
 */
function sidikKode(userId: string, kode: string): string {
  return hashToken(`${userId}:${kode}`);
}

/**
 * Buat kode verifikasi email untuk seorang user + kirimkan. Balikkan kodenya
 * bila email BELUM dikonfigurasi (bantuan dev/non-produksi); di produksi tidak
 * pernah dibocorkan.
 *
 * KODE LAMA DIMATIKAN LEBIH DULU, dan itu bukan kerapian. Orang yang emailnya
 * belum masuk akan menekan "Kirim ulang" berkali-kali; membiarkan kode-kode
 * sebelumnya hidup berarti setiap penekanan menambah satu rahasia 6 digit yang
 * masih bisa ditebak, masing-masing dengan jatah percobaannya sendiri. Sesudah
 * lima kali kirim ulang, peluang menebak naik lima kali lipat. Satu kode hidup
 * per akun adalah cara batas percobaan itu tetap berarti.
 */
async function kirimKodeVerifikasi(
  userId: string,
  email: string,
  nama: string,
): Promise<string | undefined> {
  const kode = kodeVerifikasi();
  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerificationTokens.userId, userId),
          isNull(emailVerificationTokens.usedAt),
        ),
      );
    await tx.insert(emailVerificationTokens).values({
      userId,
      tokenHash: sidikKode(userId, kode),
      expiresAt: new Date(Date.now() + VERIFIKASI_MENIT * 60 * 1000),
    });
  });
  try {
    await kirimEmail({
      to: email,
      subject: "Kode verifikasi Terakasir",
      html: suratVerifikasi(nama, kode, VERIFIKASI_MENIT),
    });
  } catch {
    /* best-effort: jangan gagalkan permintaan bila email error */
  }
  if (!(await emailTerkonfigurasi()) && process.env.NODE_ENV !== "production") {
    return kode;
  }
  return undefined;
}

export const authRoutes = new Hono<AppEnv>()
  .post("/login", batasLogin, zValidator("json", LoginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (
      !user ||
      user.deletedAt ||
      !user.isActive ||
      !bcrypt.compareSync(password, user.passwordHash)
    ) {
      throw new HTTPException(401, { message: "Email atau password salah" });
    }
    // Email WAJIB terverifikasi (super admin dikecualikan). Dicek SETELAH
    // password benar → hanya pemilik password yang tahu status ini, jadi BUKAN
    // oracle enumerasi (penebak password tetap dapat pesan generik di atas).
    if (!user.isSuperAdmin && !user.emailVerifiedAt) {
      throw new HTTPException(403, {
        message: "Email belum diverifikasi. Cek email Anda atau minta kode verifikasi baru.",
      });
    }
    // User tanpa perusahaan TETAP boleh masuk → diarahkan ke onboarding
    // (buat perusahaan / terima undangan). buatSesi mengembalikan company null.
    return c.json(await buatSesi(user));
  })
  // Masuk sebagai TAMU (guest mode) — akun bersama untuk mencoba aplikasi,
  // tanpa password. Dua peran: owner & kasir, di perusahaan demo (tanpa
  // geofence → absen bebas). Data bersifat sandbox bersama.
  .post(
    "/guest",
    batasTamu,
    zValidator("json", z.object({ peran: z.enum(["owner", "kasir"]) }).strict()),
    async (c) => {
      const { peran } = c.req.valid("json");
      const email = peran === "owner" ? GUEST.ownerEmail : GUEST.kasirEmail;
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user || !user.isActive || user.deletedAt) {
        throw new HTTPException(503, { message: "Akun tamu belum siap — coba lagi sebentar" });
      }
      return c.json(await buatSesi(user));
    },
  )
  // Daftar akun sendiri (self sign-up). Membuat user TANPA perusahaan; bila ada
  // undangan pending untuk email ini, langsung auto-join (mereka set password
  // sendiri saat daftar). Selesai → langsung login (kembalikan sesi).
  .post("/register", batasRegister, zValidator("json", RegisterSchema), async (c) => {
    const { nama, email, password } = c.req.valid("json");
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    let devKode: string | undefined;
    if (!existing) {
      const passwordHash = bcrypt.hashSync(password, 10);
      /*
       * Balapan pendaftaran: dua permintaan beremail sama sama-sama melihat
       * "belum ada", lalu yang kalah menabrak `users_email_unique`.
       *
       * DI SINI TERJEMAHANNYA BUKAN 409 — dan itu justru intinya. Endpoint ini
       * sengaja membalas NETRAL & IDENTIK untuk email baru maupun yang sudah
       * terdaftar (lihat catatan di bawah), supaya tak ada cara menebak akun
       * mana yang ada. Membalas 409 di jalur balapan akan membuka kembali
       * celah enumerasi yang ditutup dengan susah payah: penyerang tinggal
       * mengirim dua permintaan sekaligus dan membaca bedanya.
       *
       * Sebelum ini jawabannya 500 — yang juga membocorkan hal yang sama, cuma
       * dengan angka lain. Yang benar: perlakukan seperti "ternyata sudah ada",
       * yaitu persis cabang `existing` di atas — tak menulis apa pun, tak
       * mengirim email, dan membalas kalimat yang sama.
       */
      const user = await db
        .transaction(async (tx) => {
          const [u] = await tx.insert(users).values({ email, passwordHash, nama }).returning();
          // Auto-join bila ada undangan pending untuk email ini (keanggotaan aktif
          // begitu email diverifikasi & user login).
          await autoTerimaUndanganEmail(tx, u.id, email);
          return u;
        })
        .catch((e: unknown) => {
          if (bentrokUnikPada(e, "users_email_unique")) return null;
          throw e;
        });
      if (user) devKode = await kirimKodeVerifikasi(user.id, email, nama);
    }
    // Respons NETRAL & IDENTIK untuk email baru maupun yang sudah terdaftar →
    // menutup total celah enumerasi akun (di produksi dev_verify_kode tak pernah
    // ada, jadi respons byte-per-byte sama). TIDAK ada auto-login: pengguna wajib
    // klik tautan verifikasi di email dulu (mengaktifkan akun).
    return c.json({
      ok: true,
      message:
        "Jika email valid, kami telah mengirim KODE verifikasi 6 digit. Cek email Anda " +
        `dan masukkan kodenya (berlaku ${VERIFIKASI_MENIT} menit).`,
      ...(devKode ? { dev_verify_kode: devKode } : {}),
    });
  })
  // Lupa password: selalu balas 200 (jangan bocorkan apakah email terdaftar).
  // Bila akun ada & aktif, buat token reset + kirim tautan via email. Saat email
  // BELUM dikonfigurasi & bukan produksi, kembalikan tautan langsung (bantuan
  // dev/setup — di produksi tak pernah dibocorkan).
  .post(
    "/forgot-password",
    batasLupa,
    zValidator("json", z.object({ email: z.string().trim().toLowerCase().email() }).strict()),
    async (c) => {
      const { email } = c.req.valid("json");
      const [user] = await db.select().from(users).where(eq(users.email, email));
      let devUrl: string | undefined;
      if (user && !user.deletedAt && user.isActive) {
        const raw = randomBytes(32).toString("hex");
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 jam
        });
        const url = `${appBaseUrl(c)}/reset-password?token=${raw}`;
        try {
          await kirimEmail({
            to: email,
            subject: "Reset password Terakasir",
            html: suratReset(user.nama, url, raw),
          });
        } catch {
          /* best-effort: jangan gagalkan permintaan bila email error */
        }
        if (!(await emailTerkonfigurasi()) && process.env.NODE_ENV !== "production") {
          devUrl = url;
        }
      }
      return c.json({ ok: true, ...(devUrl ? { dev_reset_url: devUrl } : {}) });
    },
  )
  // Reset password dengan token dari email.
  .post(
    "/reset-password",
    batasReset,
    zValidator(
      "json",
      z.object({
        token: z.string().min(1),
        password: z.string().min(8, "Password minimal 8 karakter"),
      }).strict(),
    ),
    async (c) => {
      const { token, password } = c.req.valid("json");
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        );
      if (!row) {
        throw new HTTPException(400, { message: "Tautan reset tidak valid atau sudah kedaluwarsa" });
      }
      const [user] = await db.select().from(users).where(eq(users.id, row.userId));
      if (!user || user.deletedAt || !user.isActive) {
        throw new HTTPException(400, { message: "Akun tidak aktif" });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: bcrypt.hashSync(password, 10),
            // Naikkan versi token → SEMUA sesi lama (mis. token dicuri) langsung
            // batal begitu pemilik akun mereset password lewat email.
            tokenVersion: sql`${users.tokenVersion} + 1`,
          })
          .where(eq(users.id, user.id));
        /*
         * SELURUH tautan reset milik akun ini dimatikan, bukan hanya yang
         * dipakai. Orang yang tak menerima emailnya akan menekan "Lupa
         * password" berkali-kali, jadi beberapa tautan hidup bersamaan — dan
         * sesudah password berhasil diganti, sisanya masih bisa menggantinya
         * lagi selama sisa satu jam. Pada akun yang direset justru karena
         * dicurigai bocor, itu membiarkan pintu yang baru saja dikunci.
         */
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.userId, user.id),
              isNull(passwordResetTokens.usedAt),
            ),
          );
      });
      return c.json({ ok: true });
    },
  )
  /**
   * Verifikasi email dengan KODE 6 DIGIT yang diketik di layar tempat orangnya
   * mendaftar. Sukses → tandai terverifikasi + langsung beri sesi (auto-login).
   *
   * KENAPA KODE, BUKAN TAUTAN. Tautan 64-hex yang digantikannya gagal dengan
   * tiga cara yang semuanya terukur di lapangan:
   *   · sekali pakai — membuka tautannya untuk KEDUA kali (muat ulang, tombol
   *     Kembali sesudah pengalihan otomatis, atau pemindai tautan milik penyedia
   *     email yang memuatnya lebih dulu) menjawab "tidak valid atau sudah
   *     kedaluwarsa", padahal umurnya masih 24 jam. Pesannya menyalahkan waktu
   *     untuk keadaan yang sebetulnya "sudah dipakai";
   *   · URL sepanjang itu dipotong sebagian klien email;
   *   · tautannya membuka peramban LAIN — daftar di laptop, klik di ponsel, dan
   *     sesi auto-login-nya mendarat di perangkat yang salah.
   * Kode diketik di tab yang sedang terbuka, jadi ketiganya hilang sekaligus.
   *
   * BALASAN GAGALNYA NETRAL, dan itu disengaja sampai terasa kurang ramah:
   * "kode salah" dan "email itu tak terdaftar" dijawab kalimat yang SAMA. Rute
   * `/register` di berkas ini membayar mahal untuk tak bisa dipakai menebak
   * akun mana yang ada (balasannya identik byte-per-byte); membalas
   * "sisa 3 percobaan" di sini akan mengembalikan celah itu lewat pintu
   * belakang. Yang menggantikan keramahan itu tombol "Kirim ulang" di layarnya
   * — jalan keluarnya tak perlu didiagnosis kalau selalu ada.
   */
  .post(
    "/verify-email",
    batasVerifikasiCek,
    zValidator(
      "json",
      z
        .object({
          email: z.string().trim().toLowerCase().email().optional(),
          kode: z.string().trim().regex(/^\d{6}$/, "Kode harus 6 angka").optional(),
          /**
           * TRANSISI: tautan 64-hex yang sudah terlanjur ada di kotak masuk
           * orang saat perubahan ini terpasang. Dibiarkan tetap bekerja sampai
           * yang terakhir kedaluwarsa sendiri — mencabutnya seketika akan
           * memutus orang yang sedang berada di tengah pendaftarannya, dan
           * mereka tak melakukan apa pun yang salah.
           */
          token: z.string().min(1).optional(),
        })
        .strict()
        .refine((v) => v.token != null || (v.email != null && v.kode != null), {
          message: "Email dan kode 6 angka wajib diisi",
        }),
    ),
    async (c) => {
      const { email, kode, token } = c.req.valid("json");
      const SALAH = "Kode verifikasi salah atau sudah kedaluwarsa — minta kode baru.";

      let row: typeof emailVerificationTokens.$inferSelect | undefined;
      if (token != null) {
        [row] = await db
          .select()
          .from(emailVerificationTokens)
          .where(
            and(
              eq(emailVerificationTokens.tokenHash, hashToken(token)),
              isNull(emailVerificationTokens.usedAt),
              gt(emailVerificationTokens.expiresAt, new Date()),
            ),
          );
      } else {
        const [calon] = await db.select().from(users).where(eq(users.email, email!));
        if (calon) {
          [row] = await db
            .select()
            .from(emailVerificationTokens)
            .where(
              and(
                eq(emailVerificationTokens.userId, calon.id),
                eq(emailVerificationTokens.tokenHash, sidikKode(calon.id, kode!)),
                isNull(emailVerificationTokens.usedAt),
                gt(emailVerificationTokens.expiresAt, new Date()),
              ),
            );
          if (!row) {
            /*
             * KODE SALAH — jatahnya dipotong, dan barisnya MATI di percobaan
             * terakhir. Satu pernyataan, sebab dua permintaan yang berpapasan
             * kalau tidak akan sama-sama membaca `percobaan` yang sama lalu
             * menuliskan angka yang sama: penebak yang menembak berbarengan
             * akan mendapat jatah lebih banyak daripada yang mengantre.
             *
             * `usedAt` diisi lewat CASE di pernyataan yang sama, jadi tak ada
             * jendela antara "jatahnya habis" dan "barisnya mati".
             */
            await db
              .update(emailVerificationTokens)
              .set({
                percobaan: sql`${emailVerificationTokens.percobaan} + 1`,
                usedAt: sql`CASE WHEN ${emailVerificationTokens.percobaan} + 1 >= ${MAKS_PERCOBAAN} THEN now() ELSE NULL END`,
              })
              .where(
                and(
                  eq(emailVerificationTokens.userId, calon.id),
                  isNull(emailVerificationTokens.usedAt),
                  gt(emailVerificationTokens.expiresAt, new Date()),
                ),
              );
          }
        }
      }
      if (!row) throw new HTTPException(400, { message: SALAH });
      const [user] = await db.select().from(users).where(eq(users.id, row.userId));
      if (!user || user.deletedAt || !user.isActive) {
        throw new HTTPException(400, { message: "Akun tidak aktif" });
      }
      const terverifikasi = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(users)
          .set({ emailVerifiedAt: user.emailVerifiedAt ?? new Date() })
          .where(eq(users.id, user.id))
          .returning();
        /*
         * SELURUH tautan verifikasi milik akun ini dimatikan sekaligus, dan di
         * sini taruhannya lebih besar daripada di reset password: verifikasi
         * yang berhasil LANGSUNG memberi sesi (auto-login). Tautan yang belum
         * terpakai karena user menekan "kirim ulang" beberapa kali karena itu
         * adalah tautan MASUK yang masih hidup sampai 24 jam — siapa pun yang
         * memegang salah satu email itu bisa masuk tanpa tahu passwordnya,
         * bahkan sesudah akunnya terverifikasi.
         */
        await tx
          .update(emailVerificationTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(emailVerificationTokens.userId, user.id),
              isNull(emailVerificationTokens.usedAt),
            ),
          );
        return u;
      });
      return c.json(await buatSesi(terverifikasi));
    },
  )
  // Kirim ulang KODE verifikasi. Selalu balas 200 (jangan bocorkan status
  // email). Benar-benar mengirim hanya bila akun ada, aktif, & BELUM verifikasi.
  .post(
    "/resend-verification",
    batasVerifikasiKirim,
    zValidator("json", z.object({ email: z.string().trim().toLowerCase().email() }).strict()),
    async (c) => {
      const { email } = c.req.valid("json");
      const [user] = await db.select().from(users).where(eq(users.email, email));
      let devKode: string | undefined;
      if (user && !user.deletedAt && user.isActive && !user.emailVerifiedAt) {
        devKode = await kirimKodeVerifikasi(user.id, email, user.nama);
      }
      return c.json({ ok: true, ...(devKode ? { dev_verify_kode: devKode } : {}) });
    },
  )
  /**
   * Keadaan sesi TERKINI. `user` datang dari requireAuth, yang selalu membaca
   * ulang keanggotaan dari database — jadi peran/cabang di sini sudah mengikuti
   * perubahan admin walau token-nya token lama. Klien memakai endpoint ini
   * untuk menyegarkan sesi tersimpan (peran berubah → menu ikut berubah tanpa
   * login ulang); bentuk baliknya sengaja dibuat sama dengan hasil login
   * (minus `token`) supaya bisa langsung ditimpakan ke sesi tersimpan.
   */
  .get("/me", requireAuth, async (c) => {
    const auth = c.get("auth");
    let company = null;
    if (auth.company_id) {
      const [co] = await db.select().from(companies).where(eq(companies.id, auth.company_id));
      if (co) {
        company = {
          id: co.id,
          nama: co.nama,
          slug: co.slug,
          logo_url: co.logoUrl,
          pb1_enabled: co.pb1Enabled,
          pb1_rate: co.pb1Rate,
          diskon_maks_persen: co.diskonMaksPersen,
          blokir_jual_minus: co.blokirJualMinus,
          timezone: co.timezone,
        };
      }
    }
    let branch: { id: string; nama: string } | null = null;
    if (auth.branch_id) {
      const [b] = await db
        .select({ id: branches.id, nama: branches.nama })
        .from(branches)
        .where(eq(branches.id, auth.branch_id));
      branch = b ?? null;
    }
    return c.json({ user: auth, company, branch });
  });
