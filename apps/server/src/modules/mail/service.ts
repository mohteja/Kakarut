import nodemailer from "nodemailer";
import { desc, inArray, sql } from "drizzle-orm";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { emailKeadaan, emailPercobaan, smtpSettings } from "../../db/schema";

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

export type PercobaanEmail = typeof emailPercobaan.$inferSelect;

/**
 * SEBAB sebuah surat TIDAK jadi dikirim.
 *
 * Serikat literal, bukan `string`: ketujuh pintu diam di `auth/routes.ts` harus
 * memilih dari daftar ini, dan penyusun TypeScript-lah yang menagihnya. Sebab
 * yang diketik bebas akan pelan-pelan berubah jadi prosa yang tak bisa
 * dikelompokkan siapa pun.
 */
export type SebabTakDicoba =
  /*
   * `email_sudah_terdaftar` PERNAH ada di sini dan dicabut sebelum sempat
   * dipakai — dicatat, bukan dihapus diam-diam. Ia lahir dari asumsi bahwa
   * mendaftar ulang email yang sudah ada memang tak boleh mengirim apa pun.
   * Asumsi itu salah, dan justru itulah perangkapnya: yang benar adalah
   * MENGIRIM kodenya (akun aktif yang belum terverifikasi), bukan mencatat
   * dengan rapi bahwa kita memilih diam. Gerbangnya sendiri yang menemukan
   * kosakata mati ini.
   */
  | "balapan_pendaftaran"
  | "jarak_kirim_ulang"
  | "email_tak_dikenal"
  | "akun_terhapus"
  | "akun_nonaktif"
  | "akun_terverifikasi"
  /** tak ada SMTP maupun Resend — suratnya tak pernah sampai ke penyedia mana pun */
  | "penyedia_belum_diatur";

/** Berapa baris percobaan yang disimpan. Lihat catatan tabelnya di schema.ts. */
export const BATAS_PERCOBAAN_EMAIL = 200;

/** 200 percobaan terakhir, terbaru dulu — sumber tabel di panel super admin. */
export async function percobaanEmailTerakhir(): Promise<PercobaanEmail[]> {
  return db
    .select()
    .from(emailPercobaan)
    .orderBy(desc(emailPercobaan.waktu), desc(emailPercobaan.id))
    .limit(BATAS_PERCOBAAN_EMAIL);
}

/**
 * Tulis satu baris percobaan, lalu buang yang melewati cincinnya.
 *
 * TAK PERNAH MELEMPAR, dengan alasan yang sama seperti `catatKeadaan`: ia
 * dipanggil di jalur kirim surat, jadi kegagalan MENCATAT tak boleh
 * menggagalkan atau menyamarkan hal yang sedang dicatatnya. Tapi ia juga tak
 * boleh diam — pencatat yang rusak diam-diam akan membuat panel menampilkan
 * riwayat yang membeku, dan itu lebih buruk daripada panel kosong.
 */
async function catatPercobaan(baris: typeof emailPercobaan.$inferInsert): Promise<void> {
  try {
    await db.insert(emailPercobaan).values(baris);
    /*
     * Dibuang SAAT MENULIS, bukan oleh penjadwal terpisah. Penjadwal menambah
     * satu hal lagi yang bisa mati diam-diam — dan tabel ini ada justru karena
     * hal yang mati diam-diam.
     */
    const sisa = await db
      .select({ id: emailPercobaan.id })
      .from(emailPercobaan)
      .orderBy(desc(emailPercobaan.waktu), desc(emailPercobaan.id))
      .offset(BATAS_PERCOBAAN_EMAIL);
    if (sisa.length > 0) {
      await db.delete(emailPercobaan).where(
        inArray(
          emailPercobaan.id,
          sisa.map((r) => r.id),
        ),
      );
    }
  } catch (e) {
    console.error(
      "PERCOBAAN EMAIL gagal dicatat — riwayat di panel bisa jadi tak lengkap:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Catat keputusan "surat ini TIDAK dikirim, dan inilah sebabnya".
 *
 * Inilah yang membedakan berkas ini dari `email_keadaan`: tanpa baris
 * `tak_dicoba`, panel yang diam punya dua tafsir yang berlawanan dan tak ada
 * cara memilih di antaranya. Lihat catatan tabel `email_percobaan` di
 * `schema.ts` untuk ongkos yang sudah dibayar karena itu.
 */
export async function catatTakDicoba(
  konteks: string,
  tujuan: string,
  sebab: SebabTakDicoba,
): Promise<void> {
  await catatPercobaan({ konteks, tujuan, hasil: "tak_dicoba", sebab });
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
export async function kirimEmail(pesan: Pesan, konteks: string): Promise<"smtp" | "resend"> {
  const row = await getSmtpRow();
  const penyedia = penyediaEmail(row);
  /*
   * "Belum ada penyedia" TIDAK dicatat sebagai kegagalan kirim, dan itu bukan
   * kelalaian: `pemeriksaan-setelan.ts` sudah punya temuan `email_mati` untuk
   * keadaan itu, dengan kalimat yang lebih tepat. Mencatatnya di sini cuma
   * membuat panel menampilkan dua temuan untuk satu sebab yang sama.
   */
  if (penyedia === "none") {
    /*
     * TETAP DICATAT sebagai percobaan, walau `email_keadaan` sengaja tidak
     * (temuan `email_mati` sudah bicara untuk keadaan itu, dengan kalimat yang
     * lebih tepat). Bedanya bukan gaya: `email_keadaan` menjawab "adakah yang
     * GAGAL", sementara tabel percobaan menjawab "apa yang TERJADI pada surat
     * INI" — dan "tak ada penyedia sama sekali" justru jawaban yang paling
     * perlu terbaca. Melewatkannya di sini mengembalikan persis kebutaan yang
     * tabel itu ada untuk menghapusnya.
     */
    await catatPercobaan({
      konteks,
      tujuan: pesan.to,
      hasil: "tak_dicoba",
      sebab: "penyedia_belum_diatur",
    });
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
        /*
         * `text` IKUT DIKIRIM, dan tidak ikut sebelumnya. `Pesan` sudah punya
         * medannya dan cabang SMTP sudah meneruskannya sejak awal; cabang ini
         * diam-diam membuangnya, sehingga tiap surat yang keluar lewat Resend
         * adalah surat HTML-saja. Surat HTML-saja berisi kode 6 angka dan satu
         * tautan punya profil spam yang tinggi — ini bukan penjelasan bug yang
         * sedang digarap (surat uji yang juga HTML-saja tetap sampai),
         * melainkan pengerasan yang ongkosnya satu baris.
         */
        body: JSON.stringify({
          from: fromHeader(row),
          to: [pesan.to],
          subject: pesan.subject,
          html: pesan.html,
          ...(pesan.text ? { text: pesan.text } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend gagal (${res.status}): ${detail.slice(0, 200)}`);
      }
    }
  } catch (e) {
    const pesanGalat = (e instanceof Error ? e.message : String(e)).slice(0, MAKS_PESAN_GALAT);
    await catatKeadaan(
      { gagalPada: new Date(), gagalPenyedia: penyedia, gagalPesan: pesanGalat },
      true,
    );
    await catatPercobaan({
      konteks,
      tujuan: pesan.to,
      hasil: "gagal",
      penyedia,
      pesan: pesanGalat,
    });
    throw e;
  }
  await catatKeadaan({ suksesPada: new Date(), suksesPenyedia: penyedia }, false);
  await catatPercobaan({ konteks, tujuan: pesan.to, hasil: "terkirim", penyedia });
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
    await kirimEmail(pesan, konteks);
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
