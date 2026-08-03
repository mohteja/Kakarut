import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga TAUTAN EMAIL YANG TERTINGGAL HIDUP.
 *
 * Reset password dan verifikasi email sama-sama memakai token acak 32 byte yang
 * disimpan TER-HASH, sekali pakai, dan berkedaluwarsa — semuanya sudah benar.
 * Yang terlewat: saat satu token dipakai, hanya BARIS ITU yang ditandai
 * terpakai. Token saudaranya tetap hidup.
 *
 * Itu bukan kasus pinggir. Orang yang emailnya belum masuk akan menekan "Lupa
 * password" / "Kirim ulang" berkali-kali, jadi beberapa tautan hidup bersamaan
 * adalah keadaan NORMAL, bukan luar biasa.
 *
 * Akibatnya berbeda di dua tempat, dan yang kedua lebih berat:
 *
 * 1. RESET PASSWORD — sesudah password berhasil diganti, tautan sisa masih bisa
 *    menggantinya lagi selama sisa satu jam. Pada akun yang direset justru
 *    karena dicurigai bocor, itu membiarkan pintu yang baru saja dikunci.
 *
 * 2. VERIFIKASI EMAIL — verifikasi yang berhasil LANGSUNG memberi sesi
 *    (auto-login, memang disengaja). Karena itu tautan verifikasi yang belum
 *    terpakai sesungguhnya adalah TAUTAN MASUK yang hidup sampai 24 jam, dan
 *    ia tetap hidup bahkan sesudah akunnya terverifikasi — siapa pun yang
 *    memegang salah satu email itu bisa masuk tanpa tahu passwordnya.
 *
 * Uji ini menjaga TEKS `where`-nya, karena persis di situlah cacatnya hidup:
 * `eq(id, row.id)` mematikan satu baris, `eq(userId, …) + isNull(usedAt)`
 * mematikan seluruh tautan yang masih hidup milik akun itu.
 */
const SRC = readFileSync(
  fileURLToPath(new URL("../src/modules/auth/routes.ts", import.meta.url)),
  "utf8",
);
const tanpaKomentar = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Potongan sumber sesudah penanda, untuk memeriksa satu blok saja. */
const blok = (penanda: string, panjang = 700) => {
  const i = tanpaKomentar.indexOf(penanda);
  expect(i, `penanda tak ditemukan: ${penanda}`).toBeGreaterThan(0);
  return tanpaKomentar.slice(i, i + panjang);
};

describe("premis: token email memang sudah dijaga dengan benar di sisi lain", () => {
  it("disimpan ter-hash, bukan apa adanya", () => {
    // Kalau suatu saat token mentah yang disimpan, bocornya basis data langsung
    // jadi tautan yang bisa dipakai — dan penjagaan di bawah jadi tak relevan.
    expect(tanpaKomentar).toMatch(/tokenHash: hashToken\(raw\)/);
    expect(tanpaKomentar).toMatch(/hashToken\(token\)/);
  });

  it("dicari dengan syarat belum terpakai DAN belum kedaluwarsa", () => {
    const reset = blok('"/reset-password"');
    expect(reset).toMatch(/isNull\(passwordResetTokens\.usedAt\)/);
    expect(reset).toMatch(/gt\(passwordResetTokens\.expiresAt, new Date\(\)\)/);
    const verif = blok('"/verify-email"');
    expect(verif).toMatch(/isNull\(emailVerificationTokens\.usedAt\)/);
    expect(verif).toMatch(/gt\(emailVerificationTokens\.expiresAt, new Date\(\)\)/);
  });

  it("verifikasi yang berhasil MEMANG memberi sesi — itu yang menaikkan taruhannya", () => {
    // Bukan sekadar menandai terverifikasi: ia memulangkan sesi. Karena itu
    // tautan verifikasi yang tersisa setara tautan masuk.
    expect(blok('"/verify-email"', 1600)).toMatch(/buatSesi\(terverifikasi\)/);
  });
});

describe("token saudara ikut dimatikan, bukan cuma yang dipakai", () => {
  it("reset password mematikan SEMUA tautan reset akun itu", () => {
    const b = blok('"/reset-password"', 1600);
    expect(b).toMatch(/eq\(passwordResetTokens\.userId, user\.id\)/);
    expect(b).toMatch(/isNull\(passwordResetTokens\.usedAt\)/);
  });

  it("verifikasi email mematikan SEMUA tautan verifikasi akun itu", () => {
    const b = blok('"/verify-email"', 1600);
    expect(b).toMatch(/eq\(emailVerificationTokens\.userId, user\.id\)/);
    expect(b).toMatch(/isNull\(emailVerificationTokens\.usedAt\)/);
  });

  it("tak ada lagi yang mematikan HANYA satu baris", () => {
    // Bentuk lama. Kalau ia kembali, satu tautan mati dan sisanya hidup lagi.
    expect(tanpaKomentar).not.toMatch(/eq\(passwordResetTokens\.id, row\.id\)/);
    expect(tanpaKomentar).not.toMatch(/eq\(emailVerificationTokens\.id, row\.id\)/);
  });

  it("keduanya tetap di dalam transaksi yang sama dengan perubahan akunnya", () => {
    // Mematikan token di luar transaksi membuka jendela: password sudah ganti
    // tapi tautan lamanya sesaat masih hidup, atau sebaliknya.
    for (const penanda of ['"/reset-password"', '"/verify-email"']) {
      const b = blok(penanda, 1600);
      const iTx = b.indexOf("db.transaction");
      const iMati = b.indexOf("usedAt: new Date()");
      expect(iTx, `transaksi tak ditemukan di ${penanda}`).toBeGreaterThan(0);
      expect(iMati).toBeGreaterThan(iTx);
    }
  });
});

/**
 * Sifat lain yang sudah benar dan tak boleh hilang saat menyentuh berkas ini.
 */
describe("penjagaan sekitarnya tetap utuh", () => {
  it("reset password membatalkan seluruh sesi lama lewat tokenVersion", () => {
    expect(blok('"/reset-password"', 1600)).toMatch(/tokenVersion: sql`\$\{users\.tokenVersion\} \+ 1`/);
  });

  it("lupa password & kirim ulang tidak membocorkan email mana yang terdaftar", () => {
    // Keduanya SELALU 200 dengan bentuk yang sama; percabangannya di dalam.
    expect(blok('"/forgot-password"', 1800)).toMatch(/return c\.json\(\{ ok: true/);
    expect(blok('"/resend-verification"', 900)).toMatch(/return c\.json\(\{ ok: true/);
  });

  it("akun nonaktif/terhapus ditolak di kedua jalur", () => {
    for (const penanda of ['"/reset-password"', '"/verify-email"']) {
      expect(blok(penanda, 1600)).toMatch(/!user \|\| user\.deletedAt \|\| !user\.isActive/);
    }
  });
});
