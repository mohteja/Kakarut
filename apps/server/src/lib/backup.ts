import { gzipSync } from "node:zlib";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { backupRuns } from "../db/schema";
import { env } from "../config/env";
import { getCadanganStorage } from "../modules/upload/backup-storage";

/**
 * PENCADANGAN DATABASE — ekspor logis seluruh tabel `public` sebagai JSONL
 * ter-gzip, lalu unggah ke storage cadangan (R2 privat / disk lokal).
 *
 * Kenapa ekspor logis (bukan `pg_dump`)? Image runtime `node:20-slim` tidak
 * memuat biner `pg_dump`, dan versinya harus dicocokkan dengan server DB.
 * Ekspor via `information_schema` + `to_jsonb` bergantung HANYA pada koneksi
 * `pg` yang sudah ada — portabel untuk Postgres apa pun (termasuk serverless).
 *
 * Format arsip (JSONL, satu baris per tabel):
 *   { "meta": { versi, dibuat, database, jumlah_tabel } }
 *   { "tabel": "companies", "baris": [ {…}, … ] }
 *   { "tabel": "users", "baris": [ … ] }
 *   …
 * Baris `meta` selalu pertama. Dipulihkan oleh `scripts/restore-backup.ts`.
 *
 * Catatan presisi: kolom NUMERIC/BIGINT diserialkan sebagai angka JSON; nilai
 * di aplikasi ini (IDR, qty) jauh di bawah batas presisi ganda, jadi aman.
 */

const VERSI_ARSIP = 1;
/** Kunci advisory-lock agar hanya satu cadangan berjalan pada satu waktu. */
const LOCK_KEY = 918_273_645;
/** Tabel yang TIDAK ikut dicadangkan (meta cadangan itu sendiri). */
const TABEL_DIKECUALIKAN = new Set(["backup_runs"]);

export interface HasilBackup {
  id: string;
  status: "sukses" | "gagal";
  object_key: string | null;
  ukuran_bytes: number | null;
  jumlah_tabel: number | null;
  jumlah_baris: number | null;
  durasi_ms: number | null;
  error: string | null;
}

/** Ganti karakter tak-aman pada timestamp ISO agar jadi nama berkas valid. */
function namaBerkas(waktu: Date): string {
  return `kakarut-${waktu.toISOString().replace(/[:.]/g, "-")}.jsonl.gz`;
}

async function daftarTabel(): Promise<string[]> {
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return res.rows
    .map((r) => r.table_name)
    .filter((t) => !TABEL_DIKECUALIKAN.has(t));
}

/**
 * Jalankan satu pencadangan. Mengembalikan ringkasan (dan mencatat satu baris
 * `backup_runs`). Melempar bila cadangan lain sedang berjalan (lock) atau bila
 * gagal sebelum sempat mencatat baris.
 */
export async function jalankanBackup(opts: {
  pemicu: "otomatis" | "manual";
  olehUserId?: string | null;
}): Promise<HasilBackup> {
  const storage = getCadanganStorage();
  // Cegah dua cadangan berjalan bersamaan (mis. penjadwal + manual, atau
  // multi-instance). Advisory lock sesi bersifat per-KONEKSI: acquire & release
  // WAJIB di koneksi yang sama, jadi kita pegang satu koneksi khusus sepanjang
  // siklus lock. Memakai `pool.query` untuk lock akan mengambil koneksi acak →
  // unlock di koneksi lain → lock bocor (tak pernah lepas).
  const lockClient = await pool.connect();
  let punyaLock = false;
  const lock = await lockClient.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [LOCK_KEY],
  );
  if (!lock.rows[0]?.locked) {
    lockClient.release();
    throw new Error("Pencadangan lain sedang berjalan — coba lagi sebentar.");
  }
  punyaLock = true;

  const mulai = Date.now();
  const waktu = new Date();
  const key = namaBerkas(waktu);
  // Catat baris 'berjalan' lebih dulu agar kegagalan pun terekam.
  const [run] = await db
    .insert(backupRuns)
    .values({
      waktu,
      pemicu: opts.pemicu,
      olehUserId: opts.olehUserId ?? null,
      status: "berjalan",
      storageMode: storage.mode,
    })
    .returning({ id: backupRuns.id });

  try {
    const tabel = await daftarTabel();
    const potongan: string[] = [
      JSON.stringify({
        meta: {
          versi: VERSI_ARSIP,
          dibuat: waktu.toISOString(),
          jumlah_tabel: tabel.length,
        },
      }),
    ];
    let totalBaris = 0;
    for (const t of tabel) {
      // to_jsonb → tiap baris jadi objek JSON dgn tipe kolom terjaga.
      const res = await pool.query<{ r: unknown }>(
        `SELECT to_jsonb(x) AS r FROM ${quoteIdent(t)} x`,
      );
      const baris = res.rows.map((row) => row.r);
      totalBaris += baris.length;
      potongan.push(JSON.stringify({ tabel: t, baris }));
    }

    const gz = gzipSync(Buffer.from(potongan.join("\n"), "utf8"));
    await storage.simpan(key, gz);

    const durasi = Date.now() - mulai;
    await db
      .update(backupRuns)
      .set({
        status: "sukses",
        objectKey: key,
        ukuranBytes: gz.byteLength,
        jumlahTabel: tabel.length,
        jumlahBaris: totalBaris,
        durasiMs: durasi,
      })
      .where(eq(backupRuns.id, run.id));

    // Retensi: simpan N cadangan sukses terakhir, buang selebihnya (objek +
    // baris riwayat). Kegagalan retensi tak boleh menggagalkan cadangan.
    await terapkanRetensi().catch((e) =>
      console.warn("Retensi cadangan gagal:", e instanceof Error ? e.message : String(e)),
    );

    return {
      id: run.id,
      status: "sukses",
      object_key: key,
      ukuran_bytes: gz.byteLength,
      jumlah_tabel: tabel.length,
      jumlah_baris: totalBaris,
      durasi_ms: durasi,
      error: null,
    };
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    await db
      .update(backupRuns)
      .set({ status: "gagal", error: pesan, durasiMs: Date.now() - mulai })
      .where(eq(backupRuns.id, run.id))
      .catch(() => {});
    return {
      id: run.id,
      status: "gagal",
      object_key: null,
      ukuran_bytes: null,
      jumlah_tabel: null,
      jumlah_baris: null,
      durasi_ms: Date.now() - mulai,
      error: pesan,
    };
  } finally {
    // Lepas lock di KONEKSI YANG SAMA lalu kembalikan koneksinya ke pool.
    if (punyaLock) {
      await lockClient
        .query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY])
        .catch(() => {});
    }
    lockClient.release();
  }
}

/** Kutip identifier tabel dengan aman (nama dari information_schema tepercaya). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Buang cadangan sukses lama di luar `BACKUP_KEEP`: hapus objek storage lalu
 * baris riwayat. Baris 'gagal'/'berjalan' tidak dihitung sebagai cadangan.
 */
export async function terapkanRetensi(): Promise<number> {
  const storage = getCadanganStorage();
  const sukses = await db
    .select({ id: backupRuns.id, objectKey: backupRuns.objectKey })
    .from(backupRuns)
    .where(eq(backupRuns.status, "sukses"))
    .orderBy(desc(backupRuns.waktu));
  const berlebih = sukses.slice(env.BACKUP_KEEP);
  let dibuang = 0;
  for (const r of berlebih) {
    if (r.objectKey) await storage.hapus(r.objectKey).catch(() => {});
    await db.delete(backupRuns).where(eq(backupRuns.id, r.id));
    dibuang++;
  }
  return dibuang;
}

/** Waktu cadangan SUKSES terakhir (untuk penjadwal), atau null. */
export async function backupSuksesTerakhir(): Promise<Date | null> {
  const [row] = await db
    .select({ waktu: backupRuns.waktu })
    .from(backupRuns)
    .where(eq(backupRuns.status, "sukses"))
    .orderBy(desc(backupRuns.waktu))
    .limit(1);
  return row?.waktu ?? null;
}

/**
 * Penjadwal cadangan otomatis. Dipanggil sekali saat boot. Menjalankan
 * cadangan bila yang terakhir sukses lebih lama dari selang, lalu memasang
 * interval berkala (`.unref()` agar tak menahan proses). Idempoten &
 * aman multi-instance (advisory lock di `jalankanBackup`).
 */
export function jadwalkanBackupOtomatis(): void {
  if (!env.BACKUP_ENABLED) {
    console.log("Pencadangan otomatis nonaktif (BACKUP_ENABLED=false).");
    return;
  }
  const selangMs = env.BACKUP_INTERVAL_HOURS * 3_600_000;

  const jalankanBilaPerlu = async () => {
    try {
      const terakhir = await backupSuksesTerakhir();
      // beri sedikit toleransi (5 mnt) agar tak melewatkan tepat di batas
      if (terakhir && Date.now() - terakhir.getTime() < selangMs - 300_000) return;
      const h = await jalankanBackup({ pemicu: "otomatis" });
      if (h.status === "sukses")
        console.log(
          `Cadangan otomatis dibuat: ${h.object_key} (${h.jumlah_tabel} tabel, ${h.jumlah_baris} baris).`,
        );
      else console.warn("Cadangan otomatis gagal:", h.error);
    } catch (e) {
      console.warn(
        "Penjadwal cadangan:",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // Jalankan cek pertama sesaat setelah boot (jangan menahan startup), lalu
  // berkala. Timer di-unref agar proses bisa keluar bersih.
  setTimeout(() => void jalankanBilaPerlu(), 60_000).unref();
  setInterval(() => void jalankanBilaPerlu(), selangMs).unref();
  console.log(
    `Pencadangan otomatis aktif: tiap ${env.BACKUP_INTERVAL_HOURS} jam, simpan ${env.BACKUP_KEEP} terakhir.`,
  );
}
