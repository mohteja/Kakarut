import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/client";
import { errorLogs } from "../db/schema";
import { ipKlien } from "../middleware/rateLimit";

/** Simpan galat berapa hari (baris lebih tua dibuang penjadwal). */
const RETENSI_HARI = 30;
/**
 * Batas atas jumlah baris. Retensi waktu saja tidak cukup: satu klien yang
 * ngambek bisa menulis ratusan ribu baris dalam sehari dan membuat tabel ini
 * lebih besar dari data usaha yang sebenarnya.
 */
const MAKS_BARIS = 50_000;

/** Potong teks panjang supaya satu galat tak bisa menulis megabyte. */
const potong = (s: string, maks: number) => (s.length > maks ? `${s.slice(0, maks)}…` : s);

/**
 * Normalisasi jalur untuk pengelompokan: UUID dan angka jadi `:id`.
 * `/api/bahan/9f3c…/resep` → `/api/bahan/:id/resep`. Tanpa ini setiap id
 * menjadi kelompok tersendiri dan daftar galat penuh baris yang sebenarnya
 * satu masalah yang sama.
 */
export function polaJalur(jalur: string): string {
  return jalur
    .split("/")
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^\d+$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
}

/**
 * Sidik jari kelompok. Angka di dalam pesan dinolkan lebih dulu ("stok kurang:
 * 3 dari 5" dan "… 7 dari 9" adalah masalah yang sama), begitu pula teks dalam
 * tanda kutip (biasanya nama bahan/cabang yang berbeda-beda).
 */
export function sidikGalat(status: number, metode: string, pola: string, pesan: string): string {
  const inti = pesan
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\d+([.,]\d+)?/g, "#")
    .trim()
    .toLowerCase();
  return createHash("sha1").update(`${status}|${metode}|${pola}|${inti}`).digest("hex").slice(0, 16);
}

/**
 * Catat satu galat. Dipanggil dari `app.onError` — WAJIB tidak pernah melempar
 * dan tidak menahan respons: kegagalan menulis log tak boleh menjelma jadi
 * kegagalan request yang kedua. Karena itu pemanggilnya tidak menunggu (`void`)
 * dan seluruh isinya dibungkus try/catch.
 *
 * Yang SENGAJA tidak disimpan: badan request (bisa memuat password/token),
 * query string (tautan verifikasi & reset password membawa token di sana), dan
 * header Authorization.
 */
export async function catatGalat(c: Context, status: number, err: unknown): Promise<void> {
  try {
    if (status < 400 || status > 599) return;
    const req = c.req.raw;
    // Query string dibuang — bisa memuat token verifikasi/reset.
    const jalur = potong(new URL(req.url).pathname, 500);
    const pola = polaJalur(jalur);
    const pesan = potong(err instanceof Error ? err.message : String(err), 1000);
    // Jejak tumpukan hanya untuk 5xx: 4xx adalah penolakan yang disengaja
    // (validasi/izin), tumpukannya tak menerangkan apa pun & memenuhi tabel.
    const stack = status >= 500 && err instanceof Error ? potong(err.stack ?? "", 8000) : null;

    // `auth` hanya terpasang bila request sudah lolos requireAuth. Galat pada
    // endpoint publik (login, register) tak punya ini — biarkan null.
    let userId: string | null = null;
    let companyId: string | null = null;
    let peran: string | null = null;
    try {
      const auth = c.get("auth") as
        | { sub?: string; company_id?: string | null; role?: string | null }
        | undefined;
      if (auth?.sub) {
        userId = auth.sub;
        companyId = auth.company_id ?? null;
        peran = auth.role ?? null;
      }
    } catch {
      /* variabel auth belum diset — bukan masalah */
    }

    await db.insert(errorLogs).values({
      status,
      metode: req.method,
      jalur,
      jalurPola: pola,
      pesan,
      stack,
      sidik: sidikGalat(status, req.method, pola, pesan),
      userId,
      companyId,
      peran,
      // Lewat `ipKlien`, bukan membaca XFF sendiri. Entri paling kiri dikirim
      // klien: mencatatnya berarti catatan galat ini menuliskan alamat KARANGAN
      // penyerang — dan justru catatan inilah yang dibaca orang saat menyelidiki
      // penyalahgunaan.
      ip: potong(ipKlien(c), 100) || null,
      userAgent: potong(c.req.header("user-agent") ?? "", 300) || null,
    });
  } catch (e) {
    // Jangan pakai catatGalat lagi di sini — itu jalan menuju rekursi.
    console.error("Gagal menulis error_logs:", e);
  }
}

/** Buang baris kedaluwarsa & kelebihan kuota. Mengembalikan jumlah terhapus. */
export async function pangkasErrorLog(): Promise<number> {
  const batas = new Date(Date.now() - RETENSI_HARI * 24 * 60 * 60_000);
  const lama = await db.delete(errorLogs).where(lt(errorLogs.waktu, batas)).returning({
    id: errorLogs.id,
  });
  // Sisakan MAKS_BARIS terbaru. Subquery (bukan ambil-lalu-hapus) supaya tak
  // menarik puluhan ribu id ke memori proses.
  const kelebihan = await db.execute(sql`
    DELETE FROM ${errorLogs}
    WHERE ${errorLogs.id} IN (
      SELECT id FROM ${errorLogs} ORDER BY waktu DESC OFFSET ${MAKS_BARIS}
    )
  `);
  return lama.length + (kelebihan.rowCount ?? 0);
}

/** Jadwalkan pemangkasan berkala (sekali saat boot, lalu tiap 6 jam). */
export function jadwalkanPangkasErrorLog(): void {
  void pangkasErrorLog().catch(() => {});
  setInterval(() => void pangkasErrorLog().catch(() => {}), 6 * 60 * 60_000).unref();
}
