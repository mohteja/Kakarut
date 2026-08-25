import { and, lt, ne } from "drizzle-orm";
import { db } from "../db/client";
import { emailVerificationTokens, invitations, passwordResetTokens } from "../db/schema";

/**
 * PEMANGKAS TABEL TOKEN — melengkapi retensi yang sudah berdiri.
 *
 * Entri retensi ledger sinkron menyebut tiga saudara yang SUDAH dipangkas
 * (`error_logs`, `backup_runs`, `rate_limits`) lalu berhenti di situ. Sapuan
 * ulang atas 62 tabel menemukan tiga lagi yang tak punya satu pun penghapus —
 * hanya `.update()` penanda pakai/cabut:
 *
 *   · `password_reset_tokens`      (expires_at + used_at)
 *   · `email_verification_tokens`  (expires_at + used_at)
 *   · `invitations`                (status + accepted_at)
 *
 * Terukur (2026-08-25, DB verify sesudah satu run penuh): **28 baris** —
 * 2 reset (2 mati), 13 verifikasi (10 mati), 13 undangan (5 masih pending).
 * Kecil per run, tak berbatas seumur pemakaian, ikut TIAP cadangan — dan dua
 * tabel pertama menyimpan **hash token**: debu yang bermuatan kredensial mati.
 *
 * JENDELANYA MENGHORMATI ARTI TIAP TABEL, dan itu yang membuatnya aman:
 *   · token hidup paling lama 24 jam (`verifikasi`) / 1 jam (`reset`), jadi
 *     baris yang `expires_at`-nya sudah lewat TAK BISA dipakai lagi — apa pun
 *     yang terjadi. Retensi 30 hari = 30× umur token terpanjang, ruang lebih
 *     dari cukup untuk penyelidikan "kenapa tautan saya tak jalan";
 *   · undangan `pending` TIDAK PUNYA kedaluwarsa dan TIDAK PERNAH disentuh —
 *     ia janji yang masih berdiri. Yang dibuang hanya yang sudah `accepted`
 *     atau `revoked` DAN lebih tua dari retensinya sendiri (90 hari, jejak
 *     "siapa mengundang siapa" untuk audit keanggotaan).
 */
export const RETENSI_TOKEN_HARI = 30;
export const RETENSI_UNDANGAN_HARI = 90;

/** Umur token terpanjang yang pernah diterbitkan (verifikasi email, 24 jam). */
export const UMUR_TOKEN_JAM = 24;

export interface HasilPangkasToken {
  reset: number;
  verifikasi: number;
  undangan: number;
}

export async function pangkasTokenMati(sekarang = new Date()): Promise<HasilPangkasToken> {
  const batasToken = new Date(sekarang.getTime() - RETENSI_TOKEN_HARI * 86_400_000);
  const batasUndangan = new Date(sekarang.getTime() - RETENSI_UNDANGAN_HARI * 86_400_000);

  const reset = await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, batasToken))
    .returning({ id: passwordResetTokens.id });
  const verifikasi = await db
    .delete(emailVerificationTokens)
    .where(lt(emailVerificationTokens.expiresAt, batasToken))
    .returning({ id: emailVerificationTokens.id });
  // `ne(status, "pending")` bukan sekadar filter — ia PAGARNYA: undangan yang
  // masih berdiri tak punya kedaluwarsa, dan membuangnya berarti menghapus
  // janji yang belum ditepati.
  const undangan = await db
    .delete(invitations)
    .where(and(ne(invitations.status, "pending"), lt(invitations.createdAt, batasUndangan)))
    .returning({ id: invitations.id });

  return { reset: reset.length, verifikasi: verifikasi.length, undangan: undangan.length };
}

let terakhirTanggal: string | null = null;

/**
 * Penjadwal harian — pola `jadwalkanSapuUnggahan`/`jadwalkanBackupOtomatis`:
 * tick tiap jam, jalan sekali sehari di jam yang diberikan. Murah dan
 * idempoten; restart hanya membuatnya berjalan lagi hari itu.
 */
export function jadwalkanPangkasToken(jamJalan: number): void {
  const jalankanBilaPerlu = async () => {
    const kini = new Date();
    const tanggal = kini.toISOString().slice(0, 10);
    if (terakhirTanggal === tanggal) return;
    if (kini.getUTCHours() !== jamJalan) return;
    try {
      const h = await pangkasTokenMati();
      terakhirTanggal = tanggal;
      const total = h.reset + h.verifikasi + h.undangan;
      if (total > 0) {
        console.log(
          `Pangkas token: ${h.reset} reset · ${h.verifikasi} verifikasi · ${h.undangan} undangan.`,
        );
      }
    } catch {
      // DB sedang bermasalah — coba lagi tick berikutnya, jangan ributkan boot
    }
  };
  setInterval(() => void jalankanBilaPerlu(), 3_600_000).unref();
}

/** Dipakai uji retensi: umur token terpanjang dalam hari, untuk rasio. */
export const UMUR_TOKEN_HARI = UMUR_TOKEN_JAM / 24;
