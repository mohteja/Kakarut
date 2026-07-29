import { sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";

/**
 * OKUPANSI MEJA — dihitung, tidak disimpan.
 *
 * Sebuah meja dine-in disebut TERISI bila salah satu ini benar:
 *   (a) masih ada bill BELUM DIBAYAR yang menunjuk meja itu, atau
 *   (b) ada transaksi lunas di meja itu yang belum dibereskan.
 *
 * Kenapa dihitung dan bukan disimpan sebagai kolom: kalau statusnya jadi
 * catatan terpisah, setiap pesanan yang dibatalkan, dipindah meja, dihapus,
 * atau dipulihkan dari Tempat Sampah menambah satu tempat lagi yang harus ikut
 * diperbarui — dan cukup satu yang terlewat untuk membuat denah berbohong.
 * Repo ini sudah pernah membayar harga itu (lihat komentar `openBills.closedAt`
 * soal bill hantu). Dengan cara turunan, jalur kasir online, pelunasan bill,
 * dan antrean sinkron offline sama-sama benar tanpa satu baris kode tambahan
 * di jalur transaksi — `insert(sales)` hanya ada di satu tempat di seluruh
 * server, dan semuanya lewat sana.
 *
 * PEMBAYARAN TIDAK MENGOSONGKAN MEJA. Di rumah makan Indonesia orang lazim
 * bayar dulu di kasir lalu duduk; kalau meja langsung hijau begitu dibayar,
 * waiter akan mendudukkan tamu baru di meja yang masih ada orangnya.
 *
 * Dua batas memotong perhitungan:
 *  - **Watermark pengosongan** dari `meja_kosong_logs.sampai` — apa pun yang
 *    lebih tua dari itu sudah dibereskan manusia. Baris biasa hanya memotong
 *    transaksi lunas; hanya baris ber-`paksa` yang juga memotong bill yang
 *    belum dibayar (supaya tombol biasa mustahil menyembunyikan tagihan hidup).
 *  - **Jendela bergulir 12 jam** — jaring pengaman bila tak ada yang menekan
 *    tombol semalaman, sekaligus menjaga dari antrean sinkron offline yang
 *    boleh berumur sampai 30 hari. Sengaja BUKAN potongan tanggal bisnis:
 *    potongan tengah malam membuat meja tamu yang duduk pukul 23.50 mendadak
 *    hijau pukul 00.00 — bohong di jam paling ramai bagi warung yang buka
 *    lewat tengah malam.
 */
export const JENDELA_OKUPANSI = "12 hours";

export interface BarisOkupansi {
  meja_id: string;
  nama: string;
  bill_terbuka: number;
  transaksi_aktif: number;
  /** waktu tagihan paling awal yang masih menempati meja ini */
  sejak: Date | null;
  /**
   * Batas terakhir yang ikut terhitung sekarang — dipakai sebagai watermark
   * pengosongan. Sengaja TEKS, bukan `Date`: `timestamptz` Postgres berpresisi
   * mikrodetik sedangkan `Date` JavaScript hanya milidetik. Sekali dibulatkan,
   * watermark jadi SEDIKIT lebih tua dari transaksi yang baru saja dibereskan,
   * transaksi itu terbaca "lebih baru dari batas", dan mejanya tak pernah
   * benar-benar kosong.
   */
  batas_baru: string | null;
  dikosongkan_pada: Date | null;
  dikosongkan_oleh: string | null;
}

/**
 * Hitung okupansi seluruh meja dine-in satu cabang (atau satu meja bila
 * `mejaId` diberikan). Satu query dipakai ulang oleh empat pemanggil: daftar
 * status, tombol Kosongkan, dan dua penjaga master data (hapus & nonaktifkan)
 * — supaya keempatnya mustahil berbeda pendapat soal arti "terisi".
 */
export async function hitungOkupansi(
  exec: Db | Tx,
  opts: { companyId: string; branchId: string; mejaId?: string },
): Promise<BarisOkupansi[]> {
  const filterMeja = opts.mejaId ? sql`AND m.id = ${opts.mejaId}` : sql``;
  const hasil = await exec.execute(sql`
    WITH batas AS (
      SELECT meja_id,
             MAX(sampai)                          AS sampai,
             MAX(sampai) FILTER (WHERE paksa)     AS sampai_paksa
        FROM meja_kosong_logs
       WHERE company_id = ${opts.companyId} AND branch_id = ${opts.branchId}
       GROUP BY meja_id
    ),
    terakhir AS (
      SELECT DISTINCT ON (l.meja_id) l.meja_id, l.waktu, u.nama AS oleh
        FROM meja_kosong_logs l
        LEFT JOIN users u ON u.id = l.user_id
       WHERE l.company_id = ${opts.companyId} AND l.branch_id = ${opts.branchId}
       ORDER BY l.meja_id, l.waktu DESC
    ),
    bill AS (
      SELECT ob.meja_id,
             COUNT(*)::int      AS jumlah,
             MIN(ob.created_at) AS sejak,
             MAX(ob.created_at) AS sampai
        FROM open_bills ob
        LEFT JOIN batas b ON b.meja_id = ob.meja_id
       WHERE ob.company_id = ${opts.companyId}
         AND ob.branch_id  = ${opts.branchId}
         AND ob.meja_id IS NOT NULL
         AND ob.closed_at IS NULL
         AND ob.created_at > COALESCE(b.sampai_paksa, '-infinity'::timestamptz)
       GROUP BY ob.meja_id
    ),
    jual AS (
      SELECT s.meja_id,
             COUNT(*)::int  AS jumlah,
             MIN(s.waktu)   AS sejak,
             MAX(s.waktu)   AS sampai
        FROM sales s
        LEFT JOIN batas b ON b.meja_id = s.meja_id
       WHERE s.company_id = ${opts.companyId}
         AND s.branch_id  = ${opts.branchId}
         AND s.meja_id IS NOT NULL
         AND s.deleted_at IS NULL
         AND s.pesanan_status <> 'batal'
         AND s.waktu > GREATEST(
               COALESCE(b.sampai, '-infinity'::timestamptz),
               now() - interval '${sql.raw(JENDELA_OKUPANSI)}'
             )
       GROUP BY s.meja_id
    )
    SELECT m.id                             AS meja_id,
           m.nama                           AS nama,
           COALESCE(bill.jumlah, 0)         AS bill_terbuka,
           COALESCE(jual.jumlah, 0)         AS transaksi_aktif,
           LEAST(bill.sejak,  jual.sejak)   AS sejak,
           -- ::text SENGAJA (presisi mikrodetik) — lihat komentar di tipenya
           GREATEST(bill.sampai, jual.sampai)::text AS batas_baru,
           terakhir.waktu                   AS dikosongkan_pada,
           terakhir.oleh                    AS dikosongkan_oleh
      FROM meja m
      LEFT JOIN bill     ON bill.meja_id     = m.id
      LEFT JOIN jual     ON jual.meja_id     = m.id
      LEFT JOIN terakhir ON terakhir.meja_id = m.id
     WHERE m.company_id = ${opts.companyId}
       AND m.branch_id  = ${opts.branchId}
       -- "Ruang Tunggu" dikecualikan DI SINI, bukan di tampilan: seluruh
       -- penjualan bawa pulang cabang menunjuk ke satu baris takeaway yang tak
       -- bisa dihapus. Sekali ia bisa "terisi", ia terisi selamanya.
       AND m.tipe = 'dine_in'
       ${filterMeja}
     ORDER BY m.pos_y, m.pos_x, m.nama, m.id
  `);
  return (hasil.rows as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    const tgl = (v: unknown) => (v ? new Date(v as string) : null);
    return {
      meja_id: String(row.meja_id),
      nama: String(row.nama),
      bill_terbuka: Number(row.bill_terbuka ?? 0),
      transaksi_aktif: Number(row.transaksi_aktif ?? 0),
      sejak: tgl(row.sejak),
      batas_baru: row.batas_baru ? String(row.batas_baru) : null,
      dikosongkan_pada: tgl(row.dikosongkan_pada),
      dikosongkan_oleh: row.dikosongkan_oleh ? String(row.dikosongkan_oleh) : null,
    };
  });
}

/** Meja sedang dipakai bila ada tagihan belum dibayar ATAU transaksi aktif. */
export const sedangTerisi = (b: BarisOkupansi) => b.bill_terbuka > 0 || b.transaksi_aktif > 0;
