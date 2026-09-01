import nodemailer from "nodemailer";
import { sql } from "drizzle-orm";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { emailKeadaan, smtpSettings } from "../../db/schema";

export type SmtpRow = typeof smtpSettings.$inferSelect;

/** Ambil baris singleton pengaturan SMTP (atau null bila belum pernah diisi). */
export async function getSmtpRow(): Promise<SmtpRow | null> {
  const [row] = await db.select().from(smtpSettings).limit(1);
  return row ?? null;
}

/** SMTP lengkap = host + email pengirim terisi. */
export function smtpLengkap(row: SmtpRow | null): boolean {
  return Boolean(row?.host && row.senderEmail);
}

function resendAktif(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** Penyedia email efektif: SMTP bila lengkap; jika tidak, Resend bila ada key; else none. */
export function penyediaEmail(row: SmtpRow | null): "smtp" | "resend" | "none" {
  if (smtpLengkap(row)) return "smtp";
  if (resendAktif()) return "resend";
  return "none";
}

export async function emailTerkonfigurasi(): Promise<boolean> {
  return penyediaEmail(await getSmtpRow()) !== "none";
}

function fromHeader(row: SmtpRow | null): string {
  const email = row?.senderEmail || "onboarding@resend.dev";
  const nama = row?.senderName || "Terakasir";
  return `${nama} <${email}>`;
}

function buatTransport(row: SmtpRow) {
  return nodemailer.createTransport({
    host: row.host!,
    port: row.port,
    secure: row.encryption === "ssl", // 465
    requireTLS: row.encryption === "starttls", // 587
    auth: row.username ? { user: row.username, pass: row.password ?? "" } : undefined,
  });
}

interface Pesan {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type KeadaanEmail = typeof emailKeadaan.$inferSelect;

/** Satu baris untuk seluruh pemasangan — kuncinya tetap, bukan per tenant. */
const KUNCI_KEADAAN = "email";

/** Panjang pesan galat yang disimpan: cukup mendiagnosis, bukan arsip log. */
const MAKS_PESAN_GALAT = 300;

/** Keadaan pengiriman email terakhir, atau null bila belum pernah ada kiriman. */
export async function keadaanEmail(): Promise<KeadaanEmail | null> {
  const [row] = await db.select().from(emailKeadaan).limit(1);
  return row ?? null;
}

/**
 * Catat hasil satu pengiriman.
 *
 * TAK PERNAH MELEMPAR, dan itu disengaja: ia dipanggil di jalur kirim surat,
 * jadi kegagalan MENCATAT tak boleh ikut menggagalkan (atau menyamarkan)
 * pengiriman yang sedang dinilainya. Tapi ia juga tak boleh diam — kalau
 * pencatatnya sendiri rusak, panel akan menampilkan "email sehat" selamanya
 * dari data yang tak pernah diperbarui. Jadi: ditangkap, lalu DIBUNYIKAN.
 */
async function catatKeadaan(
  nilai: Partial<typeof emailKeadaan.$inferInsert>,
  naikkanBeruntun: boolean,
): Promise<void> {
  try {
    await db
      .insert(emailKeadaan)
      .values({
        kunci: KUNCI_KEADAAN,
        ...nilai,
        gagalBeruntun: naikkanBeruntun ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: emailKeadaan.kunci,
        set: {
          ...nilai,
          gagalBeruntun: naikkanBeruntun
            ? sql`${emailKeadaan.gagalBeruntun} + 1`
            : sql`0`,
        },
      });
  } catch (e) {
    console.error(
      "KEADAAN EMAIL gagal dicatat — panel setelan bisa jadi tak tahu email sedang mati:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Kirim email lewat penyedia efektif. Melempar error bila pengiriman gagal ATAU
 * belum ada penyedia (caller memutuskan: reset password = best-effort/diam;
 * "Kirim Test Email" = tampilkan error). Mengembalikan penyedia yang dipakai.
 *
 * HASILNYA DICATAT DI SINI, di pintu yang DILEWATI SEMUA pengiriman — bukan di
 * masing-masing pemanggil. Pemanggil berikutnya tak bisa lupa memakainya, dan
 * tak ada pintu kedua ke keadaan yang sama yang dibiarkan terbuka.
 */
export async function kirimEmail(pesan: Pesan): Promise<"smtp" | "resend"> {
  const row = await getSmtpRow();
  const penyedia = penyediaEmail(row);
  /*
   * "Belum ada penyedia" TIDAK dicatat sebagai kegagalan kirim, dan itu bukan
   * kelalaian: `pemeriksaan-setelan.ts` sudah punya temuan `email_mati` untuk
   * keadaan itu, dengan kalimat yang lebih tepat. Mencatatnya di sini cuma
   * membuat panel menampilkan dua temuan untuk satu sebab yang sama.
   */
  if (penyedia === "none") {
    throw new Error("Email belum dikonfigurasi (SMTP kosong & tanpa Resend)");
  }
  try {
    if (penyedia === "smtp") {
      await buatTransport(row!).sendMail({
        from: fromHeader(row),
        to: pesan.to,
        subject: pesan.subject,
        html: pesan.html,
        text: pesan.text,
      });
    } else {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromHeader(row),
          to: [pesan.to],
          subject: pesan.subject,
          html: pesan.html,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend gagal (${res.status}): ${detail.slice(0, 200)}`);
      }
    }
  } catch (e) {
    await catatKeadaan(
      {
        gagalPada: new Date(),
        gagalPenyedia: penyedia,
        gagalPesan: (e instanceof Error ? e.message : String(e)).slice(0, MAKS_PESAN_GALAT),
      },
      true,
    );
    throw e;
  }
  await catatKeadaan({ suksesPada: new Date(), suksesPenyedia: penyedia }, false);
  return penyedia;
}

/**
 * Kirim surat yang BOLEH gagal tanpa menggagalkan permintaannya — tapi tak
 * boleh gagal TANPA SUARA.
 *
 * Ini rumah bersama untuk pola yang dulu disalin di EMPAT tempat: `kirimEmail`
 * dibungkus `try` dengan `catch` ber-badan komentar "best-effort". Tiga di
 * antaranya benar-benar kosong — tak ada log, tak ada penghitung, tak ada apa
 * pun. Yang keempat (peringatan cadangan) menulis `console.error` sendiri,
 * jadi idiomnya memang sudah ada di repo ini; ia cuma tak dipakai di tiga
 * pintu yang paling mahal.
 *
 * [konteks] muncul di log apa adanya; isilah dengan nama pintunya
 * ("verifikasi-email", "reset-password", …) supaya baris lognya bisa langsung
 * dipetakan ke rutenya tanpa membaca kode.
 *
 * Mengembalikan `true` bila terkirim — pemanggil yang perlu menghitung
 * (peringatan cadangan) memakai nilainya; yang tidak, mengabaikannya.
 */
export async function kirimEmailDiam(pesan: Pesan, konteks: string): Promise<boolean> {
  try {
    await kirimEmail(pesan);
    return true;
  } catch (e) {
    console.error(
      `EMAIL GAGAL [${konteks}] ke ${pesan.to}:`,
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

/** Uji koneksi SMTP (verify) — untuk tombol "Test Koneksi". */
export async function ujiKoneksiSmtp(row: SmtpRow | null): Promise<void> {
  if (!smtpLengkap(row)) throw new Error("SMTP belum lengkap (host & email pengirim wajib)");
  await buatTransport(row!).verify();
}
