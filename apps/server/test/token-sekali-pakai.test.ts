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

/**
 * Potongan sumber SATU RUTE: dari penandanya sampai rute berikutnya.
 *
 * Dulu jendelanya sepanjang bilangan tetap (700 / 1.600 aksara), dan itu cacat
 * yang menggigit begitu `/verify-email` tumbuh: penjagaannya tak berubah
 * sedikit pun, tapi asersinya jatuh di luar jendela dan uji ini memerah dengan
 * kalimat yang menuduh hal yang salah. Jendela yang kepanjangan sama buruknya —
 * ia mulai membaca rute SEBELAHNYA dan meluluskan penjagaan milik orang lain.
 *
 * Batasnya sekarang rute berikutnya, jadi panjang badan rute tak lagi jadi
 * bagian dari yang diuji.
 */
const blok = (penanda: string) => {
  const i = tanpaKomentar.indexOf(penanda);
  expect(i, `penanda tak ditemukan: ${penanda}`).toBeGreaterThan(0);
  const lanjut = tanpaKomentar.slice(i + penanda.length);
  const j = lanjut.search(/\n\s*\.(post|get|patch|put|delete)\(/);
  return j < 0 ? lanjut : lanjut.slice(0, j);
};

describe("premis: token email memang sudah dijaga dengan benar di sisi lain", () => {
  it("disimpan ter-hash, bukan apa adanya", () => {
    // Kalau suatu saat token mentah yang disimpan, bocornya basis data langsung
    // jadi tautan yang bisa dipakai — dan penjagaan di bawah jadi tak relevan.
    expect(tanpaKomentar).toMatch(/tokenHash: hashToken\(raw\)/);
    expect(tanpaKomentar).toMatch(/hashToken\(token\)/);
    // Kode verifikasi 6 digit juga tak pernah disimpan apa adanya — dan user
    // id ikut di-hash, sebab sejuta kemungkinan berarti dua akun bisa memegang
    // kode yang sama pada saat yang sama.
    expect(tanpaKomentar).toMatch(/tokenHash: sidikKode\(userId, kode\)/);
    expect(tanpaKomentar).toMatch(/hashToken\(`\$\{userId\}:\$\{kode\}`\)/);
  });

  it("dicari dengan syarat belum terpakai DAN belum kedaluwarsa", () => {
    const reset = blok('"/reset-password"');
    expect(reset).toMatch(/isNull\(passwordResetTokens\.usedAt\)/);
    expect(reset).toMatch(/gt\(passwordResetTokens\.expiresAt, new Date\(\)\)/);
    const verif = blok('"/verify-email"');
    expect(verif).toMatch(/isNull\(emailVerificationTokens\.usedAt\)/);
    expect(verif).toMatch(/gt\(emailVerificationTokens\.expiresAt, new Date\(\)\)/);
  });

  /**
   * KODE KEDALUWARSA TAK BOLEH MENAHAN KIRIM ULANG — dan itu justru mudah
   * terlewat, sebab penyaringnya ada di kueri JARAK, bukan di kueri
   * pencariannya.
   *
   * Kalau kueri jarak cuma menyaring `usedAt IS NULL`, sebuah kode yang sudah
   * mati karena waktu tetap terhitung "hidup" dan menahan kiriman berikutnya —
   * mengunci orangnya dari satu-satunya jalan keluar yang ia punya, tepat pada
   * keadaan yang jalan keluar itu ada untuk menolongnya.
   *
   * BATAS YANG DIAKUI: uji ini memaku bahwa SYARATNYA ADA di kedua kueri. Ia
   * tak membuktikan jam sungguhan menahannya — tak ada gerbang di repo ini
   * yang menunggu 60 menit, dan menjadikan umurnya setelan demi ujinya adalah
   * ekor yang mengibaskan anjing. Yang tergerbang dinamis: kode yang MATI
   * (jatah tebakan habis) tak menahan kirim ulang — lihat bagian 281.
   */
  it("kedaluwarsa disaring di pencarian kode DAN di penjaga jaraknya", () => {
    const cari = blok('"/verify-email"');
    expect(cari).toMatch(/gt\(emailVerificationTokens\.expiresAt, new Date\(\)\)/);
    // Penjaga jaraknya hidup di `kirimKodeVerifikasi`, bukan di sebuah rute.
    const i = tanpaKomentar.indexOf("async function kirimKodeVerifikasi");
    expect(i, "kirimKodeVerifikasi tak ditemukan").toBeGreaterThan(0);
    const kirim = tanpaKomentar.slice(i, tanpaKomentar.indexOf("\nexport const authRoutes", i));
    expect(kirim, "penjaga jarak tak menyaring kode kedaluwarsa").toMatch(
      /gt\(emailVerificationTokens\.expiresAt, new Date\(\)\)/,
    );
    expect(kirim, "jaraknya tak dihitung dari created_at").toMatch(
      /JEDA_KIRIM_ULANG_DETIK/,
    );
  });

  it("verifikasi yang berhasil MEMANG memberi sesi — itu yang menaikkan taruhannya", () => {
    // Bukan sekadar menandai terverifikasi: ia memulangkan sesi. Karena itu
    // tautan verifikasi yang tersisa setara tautan masuk.
    expect(blok('"/verify-email"')).toMatch(/buatSesi\(terverifikasi\)/);
  });
});

describe("token saudara ikut dimatikan, bukan cuma yang dipakai", () => {
  it("reset password mematikan SEMUA tautan reset akun itu", () => {
    const b = blok('"/reset-password"');
    expect(b).toMatch(/eq\(passwordResetTokens\.userId, user\.id\)/);
    expect(b).toMatch(/isNull\(passwordResetTokens\.usedAt\)/);
  });

  it("verifikasi email mematikan SEMUA tautan verifikasi akun itu", () => {
    const b = blok('"/verify-email"');
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
      const b = blok(penanda);
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
    expect(blok('"/reset-password"')).toMatch(/tokenVersion: sql`\$\{users\.tokenVersion\} \+ 1`/);
  });

  it("lupa password & kirim ulang tidak membocorkan email mana yang terdaftar", () => {
    // Keduanya SELALU 200 dengan bentuk yang sama; percabangannya di dalam.
    //
    // `\s*` bukan kelonggaran gaya: versi pertama memaku `{ ok: true` pada SATU
    // baris, lalu memerah begitu badan balasannya tumbuh dan prettier
    // memecahnya — memerah untuk perubahan yang tak menyentuh netralitasnya
    // sama sekali. Gerbang yang menuduh karena baris berpindah mengajari
    // pembacanya mengabaikan gerbang.
    for (const penanda of ['"/forgot-password"', '"/resend-verification"']) {
      const b = blok(penanda);
      expect(b, `${penanda} tak membalas ok:true tanpa syarat`).toMatch(
        /return c\.json\(\{\s*ok: true/,
      );
      // Dan tak ada jalan keluar lain: satu `throw` yang tergantung pada
      // ditemukan-tidaknya akun akan membocorkan persis yang ditutup di sini.
      expect(b, `${penanda} punya jalan keluar selain 200`).not.toMatch(/throw new HTTPException/);
    }
  });

  it("akun nonaktif/terhapus ditolak di kedua jalur", () => {
    for (const penanda of ['"/reset-password"', '"/verify-email"']) {
      expect(blok(penanda)).toMatch(/!user \|\| user\.deletedAt \|\| !user\.isActive/);
    }
  });
});
