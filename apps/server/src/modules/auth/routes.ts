import { createHash, randomBytes, randomInt } from "node:crypto";
import { zValidator } from "../../lib/validator";
import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { env } from "../../config/env";
import { appBaseUrl } from "../../lib/base-url";
import { kunciAntrean } from "../../lib/kunci";
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
import { catatTakDicoba, emailTerkonfigurasi, kirimEmailDiam } from "../mail/service";
import { suratReset, suratResetTeks, suratVerifikasi, suratVerifikasiTeks } from "../mail/surat";
import { autoTerimaUndanganEmail } from "../onboarding/service";
import { GUEST } from "../../seed/guest";
import { buatSesi, companyDto } from "./session";
import { PESAN_LOGIN, SEBAB_LOGIN, type CompanyDto, type SebabLogin, type SesiDto } from "@kakarut/shared";

/**
 * Penolakan masuk yang membawa SEBAB terstruktur, bukan cuma kalimat.
 *
 * `sebab` dipasang sebagai PROPERTI (bukan `cause`): `app.onError` membacanya
 * lewat `(err as { sebab?: string }).sebab` dan hanya properti itu yang sampai
 * ke badan respons — bentuk yang sama dengan `PenjualanGagal` dan
 * `SedangDiproses`. Dilempar, bukan di-`return c.json`: jalur `throw`-lah yang
 * lewat `catatGalat`, dan penolakan masuk HARUS tetap tercatat di panel Log
 * Galat (panel itu justru yang membuat pemilik melihat banjir 401).
 */
class LoginDitolak extends HTTPException {
  constructor(
    message: string,
    readonly sebab: SebabLogin,
  ) {
    super(401, { message });
  }
}

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

/*
 * Kirim ulang verifikasi: batasi per (IP + email) → cegah bom email.
 *
 * 6 → 8 saat jarak 2 menit dipasang: 15 menit memuat 7,5 kiriman yang MENURUTI
 * jaraknya, jadi ember 6 akan menolak orang yang justru patuh — dan menolaknya
 * dengan kalimat yang berbeda ("terlalu banyak permintaan"), sehingga ia tak
 * bisa tahu bahwa yang salah cuma sabarnya. Jaraknya kini aturan yang
 * mengikat; ember ini tinggal jaring pengaman.
 */
const batasVerifikasiKirim = rl(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 8,
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

/**
 * JARAK MINIMUM ANTAR PENGIRIMAN KODE untuk satu akun.
 *
 * Sebelum ini jaraknya cuma ada di React (`setJeda(60)`) — 60 detik, di KLIEN,
 * dan hilang begitu halamannya dimuat ulang. Itu kenyamanan tampilan, bukan
 * penahan: sisi server hanya punya ember 15 menit yang tak mengatur jarak sama
 * sekali, jadi enam kiriman boleh beruntun dalam enam detik.
 *
 * Angkanya dipulangkan ke klien (`retry_after_detik`) alih-alih disalin ke
 * sana, supaya tak ada dua angka yang bisa menyimpang.
 */
const JEDA_KIRIM_ULANG_DETIK = 120;

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
 * JARAKNYA DIJAGA DI SINI, bukan di rutenya — alasan yang sama dengan
 * pencarian shift di `createSale`: pemanggil berikutnya tak bisa lupa
 * memakainya. Aman untuk pendaftaran, sebab akun yang baru lahir belum punya
 * kode hidup, jadi penjaganya no-op di sana.
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
  baseUrl: string,
): Promise<{ kode: string; url: string } | undefined> {
  const kode = kodeVerifikasi();
  /*
   * DUA JALAN MASUK UNTUK SATU PENERBITAN — kode 6 angka DAN tautan 64-hex.
   *
   * Kodenya jalan utama (web), sebab tautan verifikasi punya tiga cara gagal
   * yang tak bisa ditambal: sekali pakai (muat ulang → "kedaluwarsa" padahal
   * masih 24 jam), dipotong klien email, dan membuka peramban LAIN sehingga
   * sesi auto-login mendarat di perangkat yang salah.
   *
   * Tautannya tetap ada karena `docs/API-CONTRACT.md` menuliskannya sebagai
   * alur daftar APLIKASI PONSEL: register → tangkap deep link
   * `APP_BASE_URL/verifikasi-email?token=…` → `verify-email { token }`.
   * Mencabutnya berarti mematikan pendaftaran dari ponsel sampai repo ponsel
   * menyusul — dan mereka tak melakukan apa pun yang salah.
   *
   * DUA BARIS, bukan satu baris berkolom baru: baris tautannya berbentuk
   * PERSIS SAMA dengan baris yang terbit sebelum kode ada, jadi cabang
   * `{ token }` di `verify-email` tak perlu tahu apa-apa tentang perubahan ini
   * dan baris lama di produksi tetap bekerja tanpa cabang khusus. Tak ada
   * migrasi yang dibutuhkan.
   */
  const raw = randomBytes(32).toString("hex");
  const url = `${baseUrl}/verifikasi-email?token=${raw}`;
  const dikirim = await db.transaction(async (tx) => {
    /*
     * "Baca kode terakhir lalu tulis kode baru" adalah balapan, dan akibatnya
     * bukan sekadar dua email: dua tekanan yang berpapasan sama-sama melihat
     * "tak ada yang baru", sama-sama mengirim, lalu yang KEDUA mematikan kode
     * yang barusan dikirimkan yang pertama. Orangnya menerima dua email dan
     * hanya satu yang berlaku — tanpa cara menebak yang mana.
     */
    await kunciAntrean(tx, "verifikasi-email", userId);
    const [hidup] = await tx
      .select({ createdAt: emailVerificationTokens.createdAt })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, userId),
          isNull(emailVerificationTokens.usedAt),
          // Kode KEDALUWARSA tak boleh menahan kirim ulang — kalau ia menahan,
          // orang yang kodenya mati justru terkunci dari satu-satunya jalan
          // keluarnya. Sama untuk kode yang MATI karena jatah tebakannya habis:
          // salah ketik lima kali bukan alasan menunggu dua menit.
          gt(emailVerificationTokens.expiresAt, new Date()),
        ),
      )
      // Pemutus seri wajib: tanpa `id`, dua baris berdetik sama bisa bertukar
      // urutan antar pemanggilan dan "yang terbaru" berhenti berarti.
      .orderBy(desc(emailVerificationTokens.createdAt), desc(emailVerificationTokens.id))
      .limit(1);
    if (hidup && Date.now() - hidup.createdAt.getTime() < JEDA_KIRIM_ULANG_DETIK * 1000) {
      /*
       * DITOLAK TANPA MENYENTUH APA PUN — dan urutan ini yang paling mudah
       * salah. Mematikan kode lama lebih dulu lalu menolak mengirim akan
       * MENGHANCURKAN kode yang sedang diketik orangnya, dan ia tak menerima
       * gantinya: satu tekanan tombol mengubah keadaan yang benar jadi jalan
       * buntu.
       */
      return false;
    }
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerificationTokens.userId, userId),
          isNull(emailVerificationTokens.usedAt),
        ),
      );
    const kedaluwarsa = new Date(Date.now() + VERIFIKASI_MENIT * 60 * 1000);
    /*
     * Keduanya milik SATU penerbitan, dan seluruh invarian yang sudah dipaku
     * tetap berlaku apa adanya karena itu: pematian "seluruh baris hidup milik
     * akun" mematikan keduanya sekaligus (jadi memakai salah satu jalan
     * mematikan yang lain), penjaga jarak membaca baris hidup TERBARU dan
     * keduanya seumur, dan penghitung tebakan salah menaikkan `percobaan` pada
     * seluruh baris hidup — jadi lima tebakan kode yang salah mematikan
     * tautannya juga. Yang terakhir disebut apa adanya, bukan disembunyikan:
     * itu satu penerbitan, dan jalan keluarnya tetap "kirim ulang".
     */
    await tx.insert(emailVerificationTokens).values([
      { userId, tokenHash: sidikKode(userId, kode), expiresAt: kedaluwarsa },
      { userId, tokenHash: hashToken(raw), expiresAt: kedaluwarsa },
    ]);
    return true;
  });
  if (!dikirim) {
    /*
     * DITAHAN JARAKNYA — sah, dan tetap dicatat. Dari luar keadaan ini tak
     * bisa dibedakan dari "terkirim": rutenya membalas 200 yang sama persis.
     * Barisnya inilah satu-satunya tempat orang bisa melihat bahwa surat yang
     * ditunggu memang tak pernah berangkat.
     */
    await catatTakDicoba("verifikasi-email", email, "jarak_kirim_ulang");
    return undefined;
  }
  /*
   * KEGAGALANNYA TAK DIPULANGKAN KE PEMINTA, dan itu keputusan, bukan
   * kelalaian: rute pemanggilnya (`/register`, `/resend-verification`) sengaja
   * membalas byte-per-byte sama untuk email yang terdaftar dan yang tidak.
   * Menambahkan `email_gagal` ke badannya akan membuka kembali enumerasi akun
   * yang ditutup dengan susah payah — surat hanya dikirim untuk akun yang ADA
   * dan belum terverifikasi, jadi penandanya menjawab persis pertanyaan yang
   * tak boleh terjawab.
   *
   * Maka satu-satunya jalan keluar kabar ini adalah ke arah OPERATOR, dan
   * `kirimEmailDiam` yang mengurusnya: log ber-konteks + penghitung kegagalan
   * beruntun yang dibaca panel setelan.
   */
  await kirimEmailDiam(
    {
      to: email,
      subject: "Kode verifikasi Terakasir",
      html: suratVerifikasi(nama, kode, VERIFIKASI_MENIT, url),
      text: suratVerifikasiTeks(nama, kode, VERIFIKASI_MENIT, url),
    },
    "verifikasi-email",
  );
  if (!(await emailTerkonfigurasi()) && process.env.NODE_ENV !== "production") {
    return { kode, url };
  }
  return undefined;
}

export const authRoutes = new Hono<AppEnv>()
  .post("/login", batasLogin, zValidator("json", LoginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    /*
     * ALASAN PENOLAKAN DISEBUTKAN — KEPUTUSAN SADAR PEMILIK REPO (2026-09-03),
     * dan konsekuensinya ditulis di sini supaya tak ada yang "memperbaikinya"
     * balik tanpa tahu apa yang sedang ia batalkan.
     *
     * Sampai hari ini keempat keadaan di bawah dijawab satu kalimat yang sama,
     * "Email atau password salah" — email tak pernah terdaftar, akun dihapus,
     * akun dinonaktifkan admin, dan password salah. Itu menutup ENUMERASI
     * AKUN: orang luar tak bisa menempelkan daftar email lalu memanen mana yang
     * punya akun di sistem ini.
     *
     * Pemilik meminta alasannya disebutkan, biayanya disampaikan lebih dulu,
     * dan ia memilih tetap. Yang hilang: enumerasi kini terbuka. Yang tersisa
     * sebagai penahan HANYA `batasLogin` — 10 percobaan per 5 menit per
     * (IP + email). Yang didapat sebagai gantinya nyata: karyawan yang akunnya
     * dinonaktifkan dulu menerima "password salah", lalu mereset passwordnya
     * berulang kali tanpa hasil — sebab passwordnya memang tak pernah salah.
     *
     * TIDAK ikut berubah: `/lupa-password` tetap memulangkan kalimat yang SAMA
     * untuk email dikenal maupun tidak (dipaku `lupa-password.spec.ts`). Pintu
     * itu bisa ditembak tanpa modal apa pun; pintu ini setidaknya berbatas laju.
     *
     * Status tetap 401 pada keempatnya — yang berubah kalimatnya, bukan
     * kontraknya (`verify-api.sh` §61 memaku 401 untuk akun nonaktif). Yang
     * BERTAMBAH `sebab` (lihat `LoginDitolak` di atas): kalimatnya untuk
     * manusia, kodenya untuk klien yang harus bercabang — aplikasi ponsel ada
     * di repo lain dan tak bisa membaca `PESAN_LOGIN` sama sekali.
     */
    if (!user) {
      throw new LoginDitolak(PESAN_LOGIN.takTerdaftar, SEBAB_LOGIN.takTerdaftar);
    }
    if (user.deletedAt) {
      throw new LoginDitolak(PESAN_LOGIN.terhapus, SEBAB_LOGIN.terhapus);
    }
    if (!user.isActive) {
      throw new LoginDitolak(PESAN_LOGIN.nonaktif, SEBAB_LOGIN.nonaktif);
    }
    if (!bcrypt.compareSync(password, user.passwordHash)) {
      throw new LoginDitolak(PESAN_LOGIN.passwordSalah, SEBAB_LOGIN.passwordSalah);
    }
    // Email WAJIB terverifikasi (super admin dikecualikan). Dicek SETELAH
    // password benar — urutannya tetap dipertahankan meski keempat pesan di
    // atas kini bicara: status verifikasi hanya diketahui orang yang memang
    // memegang passwordnya, jadi ia tak ikut menambah apa pun yang bisa dipanen
    // dari luar.
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
    const [existing] = await db
      .select({
        id: users.id,
        nama: users.nama,
        deletedAt: users.deletedAt,
        isActive: users.isActive,
        emailVerifiedAt: users.emailVerifiedAt,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email));
    let dev: { kode: string; url: string } | undefined;
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
      if (user) dev = await kirimKodeVerifikasi(user.id, email, nama, appBaseUrl(c));
      else await catatTakDicoba("verifikasi-email", email, "balapan_pendaftaran");
    } else if (existing.deletedAt) {
      await catatTakDicoba("verifikasi-email", email, "akun_terhapus");
    } else if (!existing.isActive) {
      await catatTakDicoba("verifikasi-email", email, "akun_nonaktif");
    } else if (existing.emailVerifiedAt) {
      // Sudah terverifikasi: jalannya MASUK, bukan verifikasi ulang. Tak ada
      // surat yang berguna untuk dikirim — tapi keputusannya dicatat, sebab
      // dari luar ia tampak persis seperti pendaftaran yang berhasil.
      await catatTakDicoba("verifikasi-email", email, "akun_terverifikasi");
      /*
       * DAN BILA PASSWORDNYA COCOK, LANGSUNG DIMASUKKAN.
       *
       * Ini keadaan pemilik repo sendiri selama dua hari: mendaftar ulang
       * dengan email+password yang sama, dijawab "cek email Anda" untuk akun
       * yang sudah aktif, lalu menunggu surat yang memang tak akan datang.
       * Layar tak boleh menyuruh menunggu kode untuk akun yang tak butuh kode.
       *
       * INI BUKAN KEBOCORAN BARU, dan syaratnya ditulis di sini supaya tak
       * pelan-pelan melonggar: yang dibocorkan `/register` HARUS TEPAT SAMA
       * dengan yang dibocorkan `/login` — keberadaan akun hanya terungkap
       * kepada pemegang password yang benar. Pemegang password yang salah
       * tetap menerima balasan netral yang identik dengan email baru, jadi
       * penebak email tak mendapat apa pun yang belum bisa ia dapat di
       * `/login`. Ember `batasRegister` (20/IP/jam) bahkan lebih ketat
       * daripada ember login untuk menebak password lewat pintu ini.
       *
       * Akun yang BELUM terverifikasi TIDAK dimasukkan walau passwordnya
       * cocok — cabang di bawah mengirim kodenya; verifikasi tetap wajib,
       * persis seperti `/login` yang menolaknya dengan 403.
       */
      if (bcrypt.compareSync(password, existing.passwordHash)) {
        const [user] = await db.select().from(users).where(eq(users.id, existing.id));
        return c.json({ ...(await buatSesi(user)), sudah_aktif: true });
      }
    } else {
      /*
       * AKUN SUDAH ADA, AKTIF, TAPI BELUM TERVERIFIKASI → KODENYA DIKIRIM.
       *
       * Sebelumnya cabang ini tak mengirim apa pun, dan itu PERANGKAP yang
       * paling mahal di seluruh alur ini: orang yang kodenya tak sampai akan
       * melakukan hal yang paling wajar — mengisi formulir daftar sekali lagi
       * — dan dijawab "kami telah mengirim KODE verifikasi 6 digit. Cek email
       * Anda" oleh cabang yang secara struktural tak pernah menyentuh penyedia
       * email. Terukur lewat HTTP pada 2026-09-01: pendaftaran kedua tak
       * menulis satu baris token pun, tak mengirim apa pun, dan meninggalkan
       * NOL jejak, sementara balasannya identik dengan yang pertama.
       *
       * TAK ADA KEMAMPUAN BARU YANG DIBUKA. Badan responsnya tak berubah
       * sedikit pun — `dev` sengaja TIDAK diisi di sini, sehingga jawaban untuk
       * email yang sudah terdaftar tetap identik byte-per-byte dengan jawaban
       * untuk email baru, di produksi maupun di dev. Suratnya hanya pergi ke
       * pemilik alamat itu sendiri, dan `/resend-verification` sudah menawarkan
       * kemampuan yang persis sama kepada siapa pun yang tahu alamatnya —
       * dengan penjaga yang sama pula: `batasRegister` 20/IP/jam di depan, dan
       * jarak 120 detik per akun di dalam `kirimKodeVerifikasi`.
       *
       * Yang dihapus cuma perangkapnya.
       */
      await kirimKodeVerifikasi(existing.id, email, existing.nama, appBaseUrl(c));
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
      // Ikut dipulangkan di sini supaya layar kode langsung menampilkan hitung
      // mundurnya: pendaftaran BARU SAJA mengirim kode, jadi tombol "kirim
      // ulang" yang tampak siap ditekan akan ditolak diam-diam oleh jaraknya.
      retry_after_detik: JEDA_KIRIM_ULANG_DETIK,
      ...(dev ? { dev_verify_kode: dev.kode, dev_verify_url: dev.url } : {}),
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
      /*
       * SATU RANTAI, bukan dua blok berdampingan — dan itu bukan gaya.
       * Gerbang `otp-senyap-tercatat` menilai RANTAI yang salah satu lengannya
       * mengirim: bentuk "tiga if pencatat, lalu satu if pengirim di
       * sebelahnya" lolos dari penilaian itu tanpa satu asersi pun berubah
       * warna, karena rantai pencatatnya tak punya lengan yang mengirim. Ditulis
       * sebagai satu rantai, tiap lengan wajib berakhir pada salah satu dari
       * dua hal, dan lengan yang lahir kemudian ikut tertagih.
       */
      if (!user) {
        await catatTakDicoba("reset-password", email, "email_tak_dikenal");
      } else if (user.deletedAt) {
        await catatTakDicoba("reset-password", email, "akun_terhapus");
      } else if (!user.isActive) {
        await catatTakDicoba("reset-password", email, "akun_nonaktif");
      } else {
        const raw = randomBytes(32).toString("hex");
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 jam
        });
        const url = `${appBaseUrl(c)}/reset-password?token=${raw}`;
        // Sama seperti verifikasi: jawabannya wajib netral (lihat catatan di
        // `kirimKodeVerifikasi`), jadi kabar kegagalannya keluar lewat log +
        // penghitung, bukan lewat badan respons.
        await kirimEmailDiam(
          {
            to: email,
            subject: "Reset password Terakasir",
            html: suratReset(user.nama, url, raw),
            text: suratResetTeks(user.nama, url, raw),
          },
          "reset-password",
        );
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
            /*
             * SEKALIAN TERVERIFIKASI — penulis ke-7 `emailVerifiedAt`, disengaja.
             *
             * Tautan reset hanya pernah dikirim ke alamat yang tercatat di baris
             * ini, jadi orang yang memegangnya sudah membuktikan kepemilikan
             * inbox itu — standar bukti yang PERSIS SAMA dengan kode/tautan
             * verifikasi. Sebelum ini, akun yang belum terverifikasi bisa
             * mereset passwordnya lewat inbox-nya, diberi tahu "silakan masuk",
             * lalu ditolak `/login` 403 "Email belum diverifikasi" — diukur di
             * browser (e2e `lupa-password.spec.ts`, 2026-09-02). `coalesce`
             * supaya akun yang sudah terverifikasi TAK bergeser stempelnya.
             */
            emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
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
      let dev: { kode: string; url: string } | undefined;
      /*
       * EMPAT CABANG DIAM, dan keempatnya dulu tak meninggalkan jejak apa pun.
       * Yang terakhir paling mahal: sekali `emailVerifiedAt` terisi, alamat ini
       * PERMANEN diam — tak ada rute yang mengosongkannya kembali — sementara
       * layarnya tetap berkata "Kode baru sudah dikirim".
       */
      if (!user) {
        await catatTakDicoba("verifikasi-email", email, "email_tak_dikenal");
      } else if (user.deletedAt) {
        await catatTakDicoba("verifikasi-email", email, "akun_terhapus");
      } else if (!user.isActive) {
        await catatTakDicoba("verifikasi-email", email, "akun_nonaktif");
      } else if (user.emailVerifiedAt) {
        await catatTakDicoba("verifikasi-email", email, "akun_terverifikasi");
      } else {
        dev = await kirimKodeVerifikasi(user.id, email, user.nama, appBaseUrl(c));
      }
      /*
       * `retry_after_detik` dipulangkan SELALU dan nilainya TETAP — email yang
       * terdaftar dan yang tidak menerima angka yang sama persis, jadi tak ada
       * oracle baru yang dibuka di pintu yang seluruh rute di sekitarnya sudah
       * susah payah tutup.
       */
      return c.json({
        ok: true,
        retry_after_detik: JEDA_KIRIM_ULANG_DETIK,
        ...(dev ? { dev_verify_kode: dev.kode, dev_verify_url: dev.url } : {}),
      });
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
    let company: CompanyDto | null = null;
    if (auth.company_id) {
      const [co] = await db.select().from(companies).where(eq(companies.id, auth.company_id));
      // Satu penulis bentuk `company` (`companyDto`) — sampai 2026-09-05 objeknya
      // dirakit ulang di sini, sembilan medan yang harus tetap sinkron dengan
      // `buatSesi` hanya karena kebetulan.
      if (co) company = companyDto(co);
    }
    let branch: SesiDto["branch"] = null;
    if (auth.branch_id) {
      const [b] = await db
        .select({ id: branches.id, nama: branches.nama })
        .from(branches)
        .where(eq(branches.id, auth.branch_id));
      branch = b ?? null;
    }
    const sesi: SesiDto = { user: auth, company, branch };
    return c.json(sesi);
  });
