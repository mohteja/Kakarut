import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { smtpSettings } from "../../db/schema";

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

/**
 * Kirim email lewat penyedia efektif. Melempar error bila pengiriman gagal ATAU
 * belum ada penyedia (caller memutuskan: reset password = best-effort/diam;
 * "Kirim Test Email" = tampilkan error). Mengembalikan penyedia yang dipakai.
 */
export async function kirimEmail(pesan: Pesan): Promise<"smtp" | "resend"> {
  const row = await getSmtpRow();
  const penyedia = penyediaEmail(row);
  if (penyedia === "smtp") {
    await buatTransport(row!).sendMail({
      from: fromHeader(row),
      to: pesan.to,
      subject: pesan.subject,
      html: pesan.html,
      text: pesan.text,
    });
    return "smtp";
  }
  if (penyedia === "resend") {
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
    return "resend";
  }
  throw new Error("Email belum dikonfigurasi (SMTP kosong & tanpa Resend)");
}

/** Uji koneksi SMTP (verify) — untuk tombol "Test Koneksi". */
export async function ujiKoneksiSmtp(row: SmtpRow | null): Promise<void> {
  if (!smtpLengkap(row)) throw new Error("SMTP belum lengkap (host & email pengirim wajib)");
  await buatTransport(row!).verify();
}
