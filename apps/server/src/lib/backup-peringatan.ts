import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { periksaCadangan, type KeadaanCadangan } from "@kakarut/shared";
import { db } from "../db/client";
import { backupRuns, companies, peringatanTerkirim, users } from "../db/schema";
import { env } from "../config/env";
import { getCadanganStorage } from "../modules/upload/backup-storage";
// Arah impor SATU ARAH: `backup.ts` tak boleh mengimpor berkas ini. Penjaganya
// dinyalakan dari `index.ts`, bukan dari dalam penjadwal cadangan.
import { zonaWaktuCadangan } from "./backup";
import { kirimEmail, penyediaEmail, getSmtpRow } from "../modules/mail/service";

/**
 * PENJAGA CADANGAN — yang MENGABARKAN, bukan yang menampilkan.
 *
 * Panel super admin sudah memerah sejak lama saat cadangan basi. Tapi kartu
 * merah hanya bekerja pada orang yang membuka halamannya, dan halaman
 * pencadangan justru halaman yang dibuka orang KETIKA sudah butuh cadangan —
 * yaitu tepat saat kabarnya sudah terlambat. Berkas ini menambah arah
 * sebaliknya: sistem yang mendatangi orangnya.
 *
 * Ambangnya sengaja satu sumber dengan panel (`periksaCadangan` di
 * `@kakarut/shared`), supaya tak mungkin ada keadaan "panel hijau tapi email
 * berbunyi".
 */

/** Satu-satunya jenis peringatan hari ini; kuncinya baris di `peringatan_terkirim`. */
const KUNCI = "cadangan-basi";
/**
 * Jarak minimal antar-email untuk keadaan gawat yang SAMA. Peringatan yang
 * mengulang tiap 5 menit berhenti dibaca lebih cepat daripada masalahnya
 * selesai; sehari sekali cukup untuk mengingatkan tanpa jadi kebisingan.
 */
const JEDA_JAM = 24;

export type HasilPeringatan =
  | "tenang" // tak gawat — penanda dibersihkan bila ada
  | "sudah" // gawat, tapi sudah dikabarkan dalam jendela JEDA_JAM
  | "terkirim"
  | "gagal-kirim";

/** Alamat super admin aktif — penerima peringatan. */
async function penerimaPeringatan(): Promise<{ email: string; nama: string }[]> {
  return db
    .select({ email: users.email, nama: users.nama })
    .from(users)
    .where(and(eq(users.isSuperAdmin, true), eq(users.isActive, true), isNull(users.deletedAt)))
    .orderBy(asc(users.email));
}

/** Waktu tenant PERTAMA dibuat — acuan umur saat belum pernah ada cadangan sukses. */
async function sejakPunyaData(): Promise<Date | null> {
  const [row] = await db
    .select({ waktu: companies.createdAt })
    .from(companies)
    .orderBy(asc(companies.createdAt), asc(companies.id))
    .limit(1);
  return row?.waktu ?? null;
}

/** Keadaan cadangan apa adanya — dipakai penjaga DAN panel super admin. */
export async function keadaanCadangan(): Promise<KeadaanCadangan> {
  const [sukses] = await db
    .select({ waktu: backupRuns.waktu })
    .from(backupRuns)
    .where(eq(backupRuns.status, "sukses"))
    .orderBy(desc(backupRuns.waktu), desc(backupRuns.id))
    .limit(1);
  return {
    aktif: env.BACKUP_ENABLED,
    terakhir_sukses: sukses?.waktu ? sukses.waktu.toISOString() : null,
    sejak: (await sejakPunyaData())?.toISOString() ?? null,
    ambang_hari: env.BACKUP_ALERT_DAYS,
  };
}

/** Kapan peringatan jenis ini terakhir dikirim (null = tak ada yang berlangsung). */
export async function peringatanTerakhir(kunci = KUNCI): Promise<Date | null> {
  const [row] = await db
    .select({ waktu: peringatanTerkirim.terakhirAt })
    .from(peringatanTerkirim)
    .where(eq(peringatanTerkirim.key, kunci));
  return row?.waktu ?? null;
}

/**
 * Ambil hak kirim secara ATOMIK.
 *
 * Satu perintah, bukan "SELECT lalu INSERT": dua instance yang memeriksa pada
 * detik yang sama akan sama-sama melihat "belum pernah dikirim" lalu sama-sama
 * mengirim. `ON CONFLICT … WHERE` membuat yang kalah tak memulangkan baris
 * apa pun, jadi ia tahu dirinya kalah tanpa perlu bertanya lagi.
 */
async function klaimKirim(sekarang: Date): Promise<boolean> {
  const batas = new Date(sekarang.getTime() - JEDA_JAM * 3_600_000);
  const res = await db.execute<{ key: string }>(sql`
    INSERT INTO peringatan_terkirim ("key", terakhir_at)
    VALUES (${KUNCI}, ${sekarang})
    ON CONFLICT ("key") DO UPDATE SET terakhir_at = ${sekarang}
    WHERE peringatan_terkirim.terakhir_at < ${batas}
    RETURNING "key"
  `);
  return (res.rows?.length ?? 0) > 0;
}

/** "5 hari lalu" / "30 jam lalu" — di bawah 2 hari, jam lebih informatif. */
function fraseUmur(umurJam: number): string {
  return umurJam < 48 ? `${umurJam} jam lalu` : `${Math.floor(umurJam / 24)} hari lalu`;
}

/**
 * Waktu dalam zona TENANT, bukan UTC.
 *
 * Yang membaca email ini akan membandingkannya dengan jam di dinding tokonya
 * untuk menebak kapan hal itu mulai. "2026-08-14T10:28:42.910Z" memaksanya
 * menghitung selisih zona lebih dulu — persis pada saat ia sedang panik.
 */
function fmtWaktu(d: Date, zona: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zona,
  }).format(d);
}

function badanEmail(o: {
  umurJam: number | null;
  ambangHari: number;
  terakhirSukses: string | null;
  gagalTerakhir: { waktu: Date; error: string | null } | null;
  storageMode: string;
  zona: string;
}): { subject: string; html: string; text: string } {
  const pokok =
    o.umurJam === null
      ? "sistem ini BELUM PERNAH punya cadangan yang berhasil"
      : `cadangan terakhir yang berhasil dibuat ${fraseUmur(o.umurJam)}`;
  const ringkas =
    o.umurJam === null
      ? "belum pernah ada cadangan"
      : `${fraseUmur(o.umurJam).replace(" lalu", "")} tanpa cadangan`;
  const tujuan = o.storageMode === "r2" ? "Cloudflare R2" : "disk lokal";
  const tautan = env.APP_BASE_URL ? `${env.APP_BASE_URL.replace(/\/$/, "")}/superadmin/backup` : null;
  const barisGagal = o.gagalTerakhir
    ? `Percobaan terakhir yang gagal: ${fmtWaktu(o.gagalTerakhir.waktu, o.zona)} — ${o.gagalTerakhir.error ?? "tanpa keterangan"}`
    : "Tidak ada percobaan yang tercatat gagal — kemungkinan penjadwalnya sendiri yang tak berjalan.";
  // Hanya ditulis bila ada isinya: saat belum pernah sukses, kalimat "belum ada
  // satu pun cadangan" cuma mengulang kalimat pertama dengan kata lain.
  const barisSukses = o.terakhirSukses
    ? `Cadangan berhasil terakhir: ${fmtWaktu(new Date(o.terakhirSukses), o.zona)} (${o.zona}).`
    : "";
  const text = [
    `Cadangan database Terakasir tidak jalan — ${pokok}.`,
    ...(barisSukses ? [barisSukses] : []),
    barisGagal,
    `Tujuan penyimpanan: ${tujuan}.`,
    "",
    "Selama ini berlangsung, data yang masuk tidak punya salinan mana pun.",
    tautan ? `Panel: ${tautan}` : "Buka panel super admin → Pencadangan Database.",
  ].join("\n");
  return {
    subject: `⚠️ Cadangan database Terakasir tidak jalan — ${ringkas}`,
    html:
      `<p><b>Cadangan database Terakasir tidak jalan</b> — ${pokok}.</p>` +
      (barisSukses ? `<p>${barisSukses}</p>` : "") +
      `<p>${barisGagal}</p>` +
      `<p>Tujuan penyimpanan: <b>${tujuan}</b>.</p>` +
      `<p>Selama ini berlangsung, data yang masuk <b>tidak punya salinan mana pun</b>.</p>` +
      (tautan
        ? `<p><a href="${tautan}">Buka panel pencadangan</a></p>`
        : `<p>Buka panel super admin → Pencadangan Database.</p>`),
    text,
  };
}

/**
 * Periksa keadaan cadangan; kirim email ke super admin bila gawat.
 *
 * Dipanggil berkala (lihat `jadwalkanPeringatanCadangan`). Tak pernah melempar
 * — kegagalan penjaga tak boleh menjatuhkan proses yang dijaganya.
 */
export async function periksaPeringatanCadangan(sekarang = new Date()): Promise<HasilPeringatan> {
  const keadaan = await keadaanCadangan();
  const hasil = periksaCadangan(keadaan, sekarang.getTime());

  if (!hasil.gawat) {
    // Pulih → lupakan penandanya, supaya kejadian BERIKUTNYA dikabarkan
    // seketika alih-alih tertelan sisa jendela jeda kejadian yang sudah lewat.
    await db.delete(peringatanTerkirim).where(eq(peringatanTerkirim.key, KUNCI));
    return "tenang";
  }

  if (!(await klaimKirim(sekarang))) return "sudah";

  const [penerima, smtp, gagal, zona] = await Promise.all([
    penerimaPeringatan(),
    getSmtpRow(),
    db
      .select({ waktu: backupRuns.waktu, error: backupRuns.error })
      .from(backupRuns)
      .where(eq(backupRuns.status, "gagal"))
      .orderBy(desc(backupRuns.waktu), desc(backupRuns.id))
      .limit(1)
      .then((r) => r[0] ?? null),
    zonaWaktuCadangan(),
  ]);

  const pesan = badanEmail({
    umurJam: hasil.umur_jam,
    ambangHari: keadaan.ambang_hari,
    terakhirSukses: keadaan.terakhir_sukses,
    gagalTerakhir: gagal,
    storageMode: getCadanganStorage().mode,
    zona,
  });

  /*
   * Saluran yang rusak TIDAK melepas klaimnya.
   *
   * SMTP kosong atau tanpa super admin aktif bukan keadaan yang membaik karena
   * dicoba lagi lima menit lagi — mencobanya terus hanya menghasilkan satu
   * baris log tiap lima menit, yang justru menenggelamkan barisnya sendiri.
   * Klaim tetap dipegang (jadi dicoba lagi besok), dan keadaan salurannya
   * dilaporkan ke panel lewat `email_siap`/`penerima` di GET /admin/sistem/backup.
   */
  if (penyediaEmail(smtp) === "none" || penerima.length === 0) {
    console.error(
      `PERINGATAN CADANGAN tak terkirim — ${penyediaEmail(smtp) === "none" ? "email belum dikonfigurasi" : "tak ada super admin aktif"}. ${pesan.text.split("\n")[0]}`,
    );
    return "gagal-kirim";
  }

  let terkirim = 0;
  for (const p of penerima) {
    try {
      await kirimEmail({ to: p.email, subject: pesan.subject, html: pesan.html, text: pesan.text });
      terkirim++;
    } catch (e) {
      console.error(
        `PERINGATAN CADANGAN gagal dikirim ke ${p.email}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  if (terkirim === 0) return "gagal-kirim";
  console.warn(`PERINGATAN CADANGAN dikirim ke ${terkirim} super admin. ${pesan.text.split("\n")[0]}`);
  return "terkirim";
}

/**
 * Penjaga berkala. Cek pertama 2 menit sesudah boot (beri waktu migrasi &
 * seed selesai), lalu tiap 30 menit — keadaan yang dijaga bergerak dalam
 * hitungan HARI, jadi lebih rapat dari ini tak menambah apa pun.
 */
export function jadwalkanPeringatanCadangan(): void {
  if (env.BACKUP_ALERT_DAYS <= 0) {
    console.log("Peringatan cadangan nonaktif (BACKUP_ALERT_DAYS=0).");
    return;
  }
  const jalan = () =>
    void periksaPeringatanCadangan().catch((e) =>
      console.warn("Penjaga cadangan:", e instanceof Error ? e.message : String(e)),
    );
  setTimeout(jalan, 2 * 60_000).unref();
  setInterval(jalan, 30 * 60_000).unref();
  console.log(
    `Peringatan cadangan aktif: email ke super admin bila lewat ${env.BACKUP_ALERT_DAYS} hari tanpa cadangan sukses.`,
  );
}
