import { isNotNull } from "drizzle-orm";
import { db, pool } from "../db/client";
import {
  attendances,
  cleaningReportItems,
  companies,
  ingredients,
  ingredientSteps,
  leaveRequests,
  menus,
  stockOpnames,
} from "../db/schema";
import { getStorage } from "../modules/upload/storage";

/**
 * SAPUAN BERKAS UNGGAHAN YATIM.
 *
 * `POST /upload` tidak menulis baris DB apa pun — berkas hanya hidup di
 * storage, dan komentar di pintunya sendiri sudah lama menulis celahnya:
 * *"Tak ada yang menghapus berkas ini kelak: tak ada kuota per perusahaan,
 * tak ada pembersihan yatim."* Vena batas-laju menjaga LAJUNYA; stoknya
 * tumbuh selamanya. Sumber yatim yang aktif: alur sinkron ponsel mengunggah
 * foto bukti DULU baru mengirim perintah — perintah yang ditolak per-item
 * (usia, shift, validasi) meninggalkan fotonya tanpa satu rujukan pun; juga
 * form web yang batal sesudah unggah.
 *
 * Terukur (2026-08-25, mesin dev): **2.384 berkas** di direktori unggahan,
 * **40** yang dirujuk database aktifnya — 98,3 % yatim (akumulasi lintas
 * reset DB; analog produksi: baris dihapus, berkasnya tinggal), ±130 berkas
 * baru per run verify.
 *
 * ATURAN AMANNYA, dua-duanya wajib:
 * 1. Rujukan dikumpulkan LENGKAP lebih dulu; kegagalan membaca satu kolom
 *    pun MEMBATALKAN seluruh sapuan tanpa menghapus apa-apa.
 * 2. Hanya berkas lebih tua dari `TENGGANG_HARI` yang boleh dihapus —
 *    jendela "unggah dulu, perintah menyusul" hanya menit; tujuh hari
 *    memberi ruang untuk antrean gagal yang masih ditinjau kasir.
 */
export const TENGGANG_HARI = 7;

/**
 * SEMUA kolom yang menyimpan URL unggahan. Daftar ini tulisan tangan — kelas
 * yang pernah memakan temuan — jadi `sapu-unggahan.test.ts` memaku
 * kelengkapannya terhadap sapuan mekanis `schema.ts`: kolom `*_url` baru
 * yang tak masuk sini (atau daftar kecualinya) membuat uji merah dengan nama.
 */
const KOLOM_PERUJUK = [
  { tabel: companies, kolom: companies.logoUrl, nama: "companies.logo_url" },
  { tabel: ingredients, kolom: ingredients.fotoHasilUrl, nama: "ingredients.foto_hasil_url" },
  { tabel: ingredients, kolom: ingredients.fotoPackingUrl, nama: "ingredients.foto_packing_url" },
  { tabel: ingredientSteps, kolom: ingredientSteps.fotoUrl, nama: "ingredient_steps.foto_url" },
  { tabel: menus, kolom: menus.imageUrl, nama: "menus.image_url" },
  { tabel: attendances, kolom: attendances.fotoUrl, nama: "attendances.foto_url" },
  { tabel: leaveRequests, kolom: leaveRequests.lampiranUrl, nama: "leave_requests.lampiran_url" },
  {
    tabel: cleaningReportItems,
    kolom: cleaningReportItems.fotoUrl,
    nama: "cleaning_report_items.foto_url",
  },
  {
    tabel: stockOpnames,
    kolom: stockOpnames.klarifikasiFotoUrl,
    nama: "stock_opnames.klarifikasi_foto_url",
  },
] as const;

/**
 * Nama basis sebuah kunci/URL — ruas terakhir sesudah '/'. Kunci unggahan
 * berbentuk `companies/<cid>/<tujuan>/<uuid>.<ext>`, jadi nama basisnya unik
 * global; mencocokkan lewat nama basis membuat sapuan kebal terhadap BENTUK
 * rujukan yang tersimpan (`/uploads/<key>` lokal vs `<R2_PUBLIC_URL>/<key>`).
 */
export function namaBasis(nilai: string): string {
  const i = nilai.lastIndexOf("/");
  return i === -1 ? nilai : nilai.slice(i + 1);
}

/** Kunci advisory sapuan — satu sapuan pada satu waktu, aman multi-instance. */
const LOCK_KEY = 918_273_646;

export interface HasilSapuan {
  diperiksa: number;
  yatim: number;
  dihapus: number;
  dirujuk: number;
}

/**
 * Jalankan satu sapuan. `hanyaHitung` = mode ukur: laporkan tanpa menghapus.
 */
export async function sapuUnggahanYatim(opts?: {
  hanyaHitung?: boolean;
  sekarang?: Date;
}): Promise<HasilSapuan> {
  const sekarang = opts?.sekarang ?? new Date();
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Sapuan unggahan lain sedang berjalan — coba lagi sebentar.");
    }
    try {
      // 1) SEMUA rujukan dulu. Satu kueri gagal → lempar → tak ada penghapusan.
      const dirujuk = new Set<string>();
      for (const k of KOLOM_PERUJUK) {
        const rows = await db
          .select({ nilai: k.kolom })
          .from(k.tabel)
          .where(isNotNull(k.kolom));
        for (const r of rows) {
          if (typeof r.nilai === "string" && r.nilai) dirujuk.add(namaBasis(r.nilai));
        }
      }

      // 2) Daftar storage → yatim = tak dirujuk DAN lewat masa tenggang.
      const storage = getStorage();
      const objek = await storage.list("companies/");
      const batas = sekarang.getTime() - TENGGANG_HARI * 86_400_000;
      let yatim = 0;
      let dihapus = 0;
      for (const o of objek) {
        if (dirujuk.has(namaBasis(o.key))) continue;
        yatim++;
        // Umur tak diketahui = JANGAN dihapus — lebih baik debu tersisa
        // daripada berkas hidup terhapus karena metadata gagal terbaca.
        if (o.waktu === null || o.waktu.getTime() > batas) continue;
        if (!opts?.hanyaHitung) {
          await storage.hapus(o.key);
          dihapus++;
        }
      }
      return { diperiksa: objek.length, yatim, dihapus, dirujuk: dirujuk.size };
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    }
  } finally {
    lockClient.release();
  }
}

let sapuTerakhirTanggal: string | null = null;

/**
 * Penjadwal harian — pola `jadwalkanBackupOtomatis`: tick tiap jam, jalan
 * sekali sehari pada jam cadangan (server yang sedang sepi). Idempoten dan
 * aman multi-instance lewat advisory lock di atas; restart hanya membuatnya
 * berjalan lagi hari itu — murah dan tanpa efek samping.
 */
export function jadwalkanSapuUnggahan(jamJalan: number): void {
  const jalankanBilaPerlu = async () => {
    const kini = new Date();
    const tanggal = kini.toISOString().slice(0, 10);
    if (sapuTerakhirTanggal === tanggal) return;
    if (kini.getUTCHours() !== jamJalan) return;
    try {
      const h = await sapuUnggahanYatim();
      sapuTerakhirTanggal = tanggal;
      if (h.dihapus > 0) {
        console.log(`Sapuan unggahan: ${h.dihapus} berkas yatim dihapus (${h.diperiksa} diperiksa).`);
      }
    } catch {
      // advisory lock kalah / storage sedang bermasalah — coba lagi tick berikutnya
    }
  };
  setInterval(() => void jalankanBilaPerlu(), 3_600_000).unref();
}
