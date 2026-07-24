import { eq, sql } from "drizzle-orm";
import {
  saldoStok,
  statusStok,
  type BahanFifoDto,
  type BahanSaldoCabang,
  type KartuStokDto,
  type MutasiJenis,
  type MutasiStok,
  type StokRowDto,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { branches } from "../../db/schema";
import { jalankanFifo, type FifoEvent } from "../../lib/fifo";

/**
 * Saldo stok per bahan untuk satu cabang, diturunkan (bukan disimpan):
 *   baseline = opname terakhir; produksi & terpakai = akumulasi SETELAH
 *   opname tsb; saldo = baseline + produksi − terpakai.
 */
export async function hitungSaldoCabang(
  companyId: string,
  branchId: string,
): Promise<StokRowDto[]> {
  // Ambang "menipis" per tipe cabang: TOKO memakai stok_minimum_toko bila
  // diisi (>0); bila 0, jatuh kembali ke stok_minimum sehingga bahan lama
  // tanpa ambang toko berperilaku persis seperti sebelumnya. CK/kantor
  // selalu memakai stok_minimum.
  const [cabang] = await db
    .select({ tipe: branches.tipe })
    .from(branches)
    .where(eq(branches.id, branchId));
  const pakaiAmbangToko = cabang?.tipe === "store";

  const result = await db.execute(sql`
    SELECT
      i.id          AS ingredient_id,
      i.slug        AS slug,
      i.nama        AS nama,
      i.kategori    AS kategori,
      i.isi         AS isi,
      i.satuan      AS satuan,
      i.stok_minimum AS stok_minimum,
      i.stok_minimum_toko AS stok_minimum_toko,
      -- Tempat penyimpanan bahan: utamakan RAK YANG DI-ASSIGN (Tempat
      -- Penyimpanan = sumber tunggal), jatuh ke lokasi entri masuk terakhir
      -- bila bahan belum di-assign ke rak mana pun.
      COALESCE(tas.id, tin.id)     AS tempat_id,
      COALESCE(tas.nama, tin.nama) AS tempat,
      COALESCE(b.qty, 0) AS stok_awal,
      COALESCE(p.qty, 0) AS produksi,
      COALESCE(u.qty, 0) + COALESCE(pc.qty, 0) AS terpakai,
      COALESCE(k.qty, 0) AS kirim_keluar,
      COALESCE(w.rencana, 0)    AS prod_rencana,
      COALESCE(w.dikerjakan, 0) AS prod_dikerjakan,
      COALESCE(w.menunggu, 0)   AS prod_menunggu,
      COALESCE(wb.rencana, 0)    AS beli_rencana,
      COALESCE(wb.dikerjakan, 0) AS beli_dikerjakan,
      COALESCE(wb.menunggu, 0)   AS beli_menunggu
    FROM ingredients i
    LEFT JOIN LATERAL (
      SELECT so.qty, so.created_at
      FROM stock_opnames so
      WHERE so.branch_id = ${branchId} AND so.ingredient_id = i.id
        AND so.penyesuaian_status = 'disetujui'
      ORDER BY so.created_at DESC
      LIMIT 1
    ) b ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pr.qty) AS qty
      FROM productions pr
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND (b.created_at IS NULL OR pr.waktu > b.created_at)
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(sc.qty) AS qty
      FROM sale_consumptions sc
      WHERE sc.branch_id = ${branchId} AND sc.ingredient_id = i.id
        AND (b.created_at IS NULL OR sc.waktu > b.created_at)
        AND EXISTS (SELECT 1 FROM sales s WHERE s.id = sc.sale_id AND s.deleted_at IS NULL)
    ) u ON TRUE
    LEFT JOIN LATERAL (
      -- KONSUMSI PRODUKSI: bahan mentah terpakai resep saat produksi selesai
      SELECT SUM(pc.qty) AS qty
      FROM production_consumptions pc
      WHERE pc.branch_id = ${branchId} AND pc.ingredient_id = i.id
        AND (b.created_at IS NULL OR pc.waktu > b.created_at)
        AND EXISTS (
          SELECT 1 FROM productions pr WHERE pr.id = pc.production_id AND pr.deleted_at IS NULL
        )
    ) pc ON TRUE
    LEFT JOIN LATERAL (
      -- KIRIM DARI STOK (transfer keluar): stok jadi yang dipindah dari CK ini
      -- ke cabang lain (asal_branch_id = cabang ini) & sudah DITERIMA
      -- (dikonfirmasi) → mengurangi saldo CK. Produksi work-order (asal null)
      -- tak termasuk — itu produksi baru, bukan pemindahan stok yang ada.
      SELECT SUM(pr.qty) AS qty
      FROM productions pr
      WHERE pr.asal_branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND (b.created_at IS NULL OR pr.waktu > b.created_at)
    ) k ON TRUE
    LEFT JOIN LATERAL (
      -- tempat penyimpanan dari entri masuk terkonfirmasi terakhir (fallback)
      SELECT sl.id, sl.nama
      FROM productions pr
      JOIN storage_locations sl ON sl.id = pr.storage_location_id
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND pr.storage_location_id IS NOT NULL
      ORDER BY pr.waktu DESC
      LIMIT 1
    ) tin ON TRUE
    LEFT JOIN LATERAL (
      -- rak "home" yang di-assign per bahan di cabang ini (Tempat Penyimpanan).
      -- Sumber utama lokasi: stok yang sudah ada (mis. stok awal, kiriman lama
      -- tanpa lokasi) tetap muncul di rak yang di-assign saat stock opname.
      SELECT sl.id, sl.nama
      FROM storage_location_ingredients sli
      JOIN storage_locations sl ON sl.id = sli.storage_location_id
      WHERE sli.ingredient_id = i.id AND sl.branch_id = ${branchId} AND sl.is_active
      LIMIT 1
    ) tas ON TRUE
    LEFT JOIN LATERAL (
      -- produksi in-house yang BELUM masuk stok, per tahap. Sengaja TIDAK
      -- dibatasi baseline opname: ini stok masa depan (pending), bukan mutasi
      -- lampau — opname tidak membatalkan faktur yang masih berjalan.
      SELECT
        SUM(pr.qty) FILTER (WHERE pr.status = 'rencana')    AS rencana,
        SUM(pr.qty) FILTER (WHERE pr.status = 'dikerjakan') AS dikerjakan,
        SUM(pr.qty) FILTER (WHERE pr.status = 'menunggu')   AS menunggu
      FROM productions pr
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND pr.tipe = 'produksi'
        AND pr.status IN ('rencana', 'dikerjakan', 'menunggu')
        AND pr.deleted_at IS NULL
        -- work-order CK yang belum dikirim (tujuan ≠ cabang ini) tak menambah
        -- proyeksi stok CK — barang akan mendarat di cabang tujuan
        AND (pr.tujuan_branch_id IS NULL OR pr.tujuan_branch_id = pr.branch_id)
    ) w ON TRUE
    LEFT JOIN LATERAL (
      -- pembelian (beli jadi) yang BELUM masuk stok: RAB → diproses → dikirim.
      -- Sama seperti produksi: stok masa depan, tak dibatasi baseline opname.
      SELECT
        SUM(pr.qty) FILTER (WHERE pr.status = 'rencana')    AS rencana,
        SUM(pr.qty) FILTER (WHERE pr.status = 'dikerjakan') AS dikerjakan,
        SUM(pr.qty) FILTER (WHERE pr.status = 'menunggu')   AS menunggu
      FROM productions pr
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND pr.tipe = 'beli'
        AND pr.status IN ('rencana', 'dikerjakan', 'menunggu')
        AND pr.deleted_at IS NULL
        -- belanja bertujuan cabang lain tak menambah proyeksi stok CK —
        -- barang akan berpindah ke cabang tujuan saat dikirim
        AND (pr.tujuan_branch_id IS NULL OR pr.tujuan_branch_id = pr.branch_id)
    ) wb ON TRUE
    WHERE i.company_id = ${companyId} AND i.is_active AND i.track_stok
    ORDER BY i.nama
  `);

  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const stokAwal = Number(row.stok_awal);
    const produksi = Number(row.produksi);
    // "terpakai" gabungan: konsumsi penjualan/produksi + kirim keluar (transfer
    // stok jadi ke cabang lain) — semuanya mengurangi saldo cabang ini.
    const terpakai = Number(row.terpakai) + Number(row.kirim_keluar);
    const rencana = Number(row.prod_rencana);
    const dikerjakan = Number(row.prod_dikerjakan);
    const menunggu = Number(row.prod_menunggu);
    const qtyBerjalan = rencana + dikerjakan + menunggu;
    const beliRencana = Number(row.beli_rencana);
    const beliDikerjakan = Number(row.beli_dikerjakan);
    const beliMenunggu = Number(row.beli_menunggu);
    const qtyBeliBerjalan = beliRencana + beliDikerjakan + beliMenunggu;
    const ambangToko = Number(row.stok_minimum_toko);
    const stokMinimum =
      pakaiAmbangToko && ambangToko > 0 ? ambangToko : Number(row.stok_minimum);
    return {
      ingredient_id: String(row.ingredient_id),
      slug: String(row.slug),
      nama: String(row.nama),
      kategori: row.kategori as StokRowDto["kategori"],
      isi: Number(row.isi),
      satuan: String(row.satuan),
      tempat: row.tempat != null ? String(row.tempat) : null,
      tempat_id: row.tempat_id != null ? String(row.tempat_id) : null,
      stok_awal: stokAwal,
      produksi,
      terpakai,
      saldo: saldoStok(stokAwal, produksi, terpakai),
      status: statusStok(stokAwal, produksi, terpakai, stokMinimum),
      stok_minimum: stokMinimum,
      produksi_berjalan:
        qtyBerjalan > 0 ? { qty: qtyBerjalan, rencana, dikerjakan, menunggu } : null,
      pembelian_berjalan:
        qtyBeliBerjalan > 0
          ? {
              qty: qtyBeliBerjalan,
              rencana: beliRencana,
              dikerjakan: beliDikerjakan,
              menunggu: beliMenunggu,
            }
          : null,
    };
  });
}

const BATAS_MUTASI = 500;

/**
 * Kartu stok: buku besar mutasi satu bahan pada satu cabang dalam rentang
 * tanggal. Saldo berjalan mengikuti aturan saldo yang sama dengan
 * hitungSaldoCabang: opname ME-RESET saldo; masuk (produksi/pembelian
 * terkonfirmasi) menambah; konsumsi penjualan mengurangi.
 */
export async function kartuStok(params: {
  branchId: string;
  ingredientId: string;
  /** YYYY-MM-DD (timezone perusahaan) */
  dari: string;
  sampai: string;
  bahan: { id: string; nama: string; slug: string; satuan: string };
}): Promise<KartuStokDto> {
  const { branchId, ingredientId, dari, sampai, bahan } = params;

  // Saldo awal periode: baseline opname terakhir SEBELUM `dari` + masuk −
  // keluar antara baseline dan `dari` (pola yang sama dgn saldo live).
  const awalRes = await db.execute(sql`
    WITH baseline AS (
      SELECT qty, created_at FROM stock_opnames
      WHERE branch_id = ${branchId} AND ingredient_id = ${ingredientId}
        AND opname_date < ${dari}
        AND penyesuaian_status = 'disetujui'
      ORDER BY created_at DESC LIMIT 1
    )
    SELECT
      COALESCE((SELECT qty FROM baseline), 0) AS baseline_qty,
      COALESCE((
        SELECT SUM(pr.qty) FROM productions pr
        WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = ${ingredientId}
          AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL AND pr.prod_date < ${dari}
          AND (NOT EXISTS (SELECT 1 FROM baseline) OR pr.waktu > (SELECT created_at FROM baseline))
      ), 0) AS masuk,
      COALESCE((
        SELECT SUM(sc.qty) FROM sale_consumptions sc
        JOIN sales s ON s.id = sc.sale_id
        WHERE sc.branch_id = ${branchId} AND sc.ingredient_id = ${ingredientId}
          AND s.sale_date < ${dari} AND s.deleted_at IS NULL
          AND (NOT EXISTS (SELECT 1 FROM baseline) OR sc.waktu > (SELECT created_at FROM baseline))
      ), 0)
      + COALESCE((
        SELECT SUM(pc.qty) FROM production_consumptions pc
        JOIN productions pr ON pr.id = pc.production_id
        WHERE pc.branch_id = ${branchId} AND pc.ingredient_id = ${ingredientId}
          AND pc.tanggal < ${dari} AND pr.deleted_at IS NULL
          AND (NOT EXISTS (SELECT 1 FROM baseline) OR pc.waktu > (SELECT created_at FROM baseline))
      ), 0)
      + COALESCE((
        -- KIRIM KELUAR: stok dipindah dari cabang ini ke cabang lain & sudah
        -- diterima — komponen yang sama dgn hitungSaldoCabang (asal_branch_id)
        SELECT SUM(pr.qty) FROM productions pr
        WHERE pr.asal_branch_id = ${branchId} AND pr.ingredient_id = ${ingredientId}
          AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL AND pr.prod_date < ${dari}
          AND (NOT EXISTS (SELECT 1 FROM baseline) OR pr.waktu > (SELECT created_at FROM baseline))
      ), 0) AS keluar
  `);
  const awal = awalRes.rows[0] as Record<string, unknown>;
  const saldoAwal = Number(awal.baseline_qty) + Number(awal.masuk) - Number(awal.keluar);

  // Semua mutasi dalam rentang, urut waktu
  const mutasiRes = await db.execute(sql`
    SELECT * FROM (
      SELECT so.created_at AS waktu, 'opname' AS jenis, so.qty AS qty,
             so.catatan AS catatan, dn.nomor_teks AS nomor, NULL AS supplier,
             NULL AS tempat, false AS is_batch
      FROM stock_opnames so
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = so.company_id AND dn.ref_id = so.session_id
      WHERE so.branch_id = ${branchId} AND so.ingredient_id = ${ingredientId}
        AND so.penyesuaian_status = 'disetujui'
        AND so.opname_date >= ${dari} AND so.opname_date <= ${sampai}
      UNION ALL
      SELECT pr.waktu, pr.tipe::text AS jenis, pr.qty, pr.catatan,
             -- nomor dokumen otomatis (PB-/PR-); nota supplier sebagai cadangan
             COALESCE(dn.nomor_teks, pr.no_faktur) AS nomor,
             sp.nama AS supplier, sl.nama AS tempat, pr.is_batch
      FROM productions pr
      LEFT JOIN suppliers sp ON sp.id = pr.supplier_id
      LEFT JOIN storage_locations sl ON sl.id = pr.storage_location_id
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = pr.company_id AND dn.ref_id = pr.faktur_id
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = ${ingredientId}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND pr.prod_date >= ${dari} AND pr.prod_date <= ${sampai}
      UNION ALL
      SELECT sc.waktu, 'penjualan' AS jenis, sc.qty, NULL AS catatan,
             s.nomor, NULL AS supplier, NULL AS tempat, false AS is_batch
      FROM sale_consumptions sc
      JOIN sales s ON s.id = sc.sale_id
      WHERE sc.branch_id = ${branchId} AND sc.ingredient_id = ${ingredientId}
        AND s.deleted_at IS NULL
        AND s.sale_date >= ${dari} AND s.sale_date <= ${sampai}
      UNION ALL
      SELECT pc.waktu, 'pemakaian' AS jenis, pc.qty,
             ('Untuk produksi ' || ij.nama) AS catatan,
             NULL AS nomor, NULL AS supplier, NULL AS tempat, false AS is_batch
      FROM production_consumptions pc
      JOIN productions pr ON pr.id = pc.production_id
      JOIN ingredients ij ON ij.id = pr.ingredient_id
      WHERE pc.branch_id = ${branchId} AND pc.ingredient_id = ${ingredientId}
        AND pr.deleted_at IS NULL
        AND pc.tanggal >= ${dari} AND pc.tanggal <= ${sampai}
      UNION ALL
      -- KIRIM KELUAR: stok dipindah dari cabang ini & sudah diterima cabang
      -- tujuan (asal_branch_id = cabang ini) — komponen saldo yang sama dgn
      -- hitungSaldoCabang; sebelumnya tak tercatat di kartu (saldo melenceng).
      SELECT pr.waktu, 'kirim' AS jenis, pr.qty,
             ('Kirim ke ' || bt.nama) AS catatan,
             COALESCE(dn.nomor_teks, pr.no_faktur) AS nomor,
             NULL AS supplier, NULL AS tempat, false AS is_batch
      FROM productions pr
      JOIN branches bt ON bt.id = pr.branch_id
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = pr.company_id AND dn.ref_id = pr.faktur_id
      WHERE pr.asal_branch_id = ${branchId} AND pr.ingredient_id = ${ingredientId}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND pr.prod_date >= ${dari} AND pr.prod_date <= ${sampai}
    ) m
    ORDER BY m.waktu ASC
    LIMIT ${BATAS_MUTASI + 1}
  `);

  // Produksi in-house yang masih berjalan (belum masuk saldo) — independen
  // dari periode kartu, untuk banner "sedang diproduksi".
  const berjalanRes = await db.execute(sql`
    SELECT
      COALESCE(SUM(qty) FILTER (WHERE tipe = 'produksi' AND status = 'rencana'), 0)    AS prod_rencana,
      COALESCE(SUM(qty) FILTER (WHERE tipe = 'produksi' AND status = 'dikerjakan'), 0) AS prod_dikerjakan,
      COALESCE(SUM(qty) FILTER (WHERE tipe = 'produksi' AND status = 'menunggu'), 0)   AS prod_menunggu,
      COALESCE(SUM(qty) FILTER (WHERE tipe = 'beli' AND status = 'rencana'), 0)    AS beli_rencana,
      COALESCE(SUM(qty) FILTER (WHERE tipe = 'beli' AND status = 'dikerjakan'), 0) AS beli_dikerjakan,
      COALESCE(SUM(qty) FILTER (WHERE tipe = 'beli' AND status = 'menunggu'), 0)   AS beli_menunggu
    FROM productions
    WHERE branch_id = ${branchId} AND ingredient_id = ${ingredientId}
      AND status IN ('rencana', 'dikerjakan', 'menunggu')
      AND deleted_at IS NULL
  `);
  const bj = berjalanRes.rows[0] as Record<string, unknown>;
  const bjRencana = Number(bj.prod_rencana);
  const bjDikerjakan = Number(bj.prod_dikerjakan);
  const bjMenunggu = Number(bj.prod_menunggu);
  const qtyBerjalan = bjRencana + bjDikerjakan + bjMenunggu;
  const bbRencana = Number(bj.beli_rencana);
  const bbDikerjakan = Number(bj.beli_dikerjakan);
  const bbMenunggu = Number(bj.beli_menunggu);
  const qtyBeliBerjalan = bbRencana + bbDikerjakan + bbMenunggu;

  const terpotong = mutasiRes.rows.length > BATAS_MUTASI;
  const rows = mutasiRes.rows.slice(0, BATAS_MUTASI) as Record<string, unknown>[];

  let saldo = saldoAwal;
  let totalMasuk = 0;
  let totalKeluar = 0;
  const mutasi: MutasiStok[] = rows.map((r) => {
    const jenis = String(r.jenis) as MutasiJenis;
    const qty = Number(r.qty);
    let masuk: number | null = null;
    let keluar: number | null = null;
    let keterangan: string | null = null;

    if (jenis === "opname") {
      saldo = qty; // opname me-reset saldo
      keterangan = [
        r.nomor ? String(r.nomor) : null,
        r.catatan ? String(r.catatan) : "Penyesuaian stok fisik",
      ]
        .filter(Boolean)
        .join(" · ");
    } else if (jenis === "penjualan") {
      keluar = qty;
      totalKeluar += qty;
      saldo -= qty;
      keterangan = r.nomor ? `Struk ${r.nomor}` : null;
    } else if (jenis === "pemakaian") {
      // bahan mentah terpakai resep produksi — mutasi KELUAR
      keluar = qty;
      totalKeluar += qty;
      saldo -= qty;
      keterangan = r.catatan ? String(r.catatan) : "Pemakaian produksi";
    } else if (jenis === "kirim") {
      // kiriman keluar (transfer stok ke cabang lain) — mutasi KELUAR
      keluar = qty;
      totalKeluar += qty;
      saldo -= qty;
      keterangan = [r.catatan ? String(r.catatan) : "Kiriman keluar", r.nomor ? `No. ${r.nomor}` : null]
        .filter(Boolean)
        .join(" · ");
    } else {
      masuk = qty;
      totalMasuk += qty;
      saldo += qty;
      const bagian = [
        r.supplier ? String(r.supplier) : null,
        r.nomor ? `No. ${r.nomor}` : null,
        r.tempat ? `→ ${r.tempat}` : null,
        r.is_batch ? "batch" : null,
        r.catatan ? String(r.catatan) : null,
      ].filter(Boolean);
      keterangan = bagian.length > 0 ? bagian.join(" · ") : null;
    }

    return {
      waktu: new Date(r.waktu as string | Date).toISOString(),
      jenis,
      keterangan,
      masuk,
      keluar,
      saldo,
    };
  });

  return {
    bahan,
    periode: { dari, sampai },
    saldo_awal: saldoAwal,
    saldo_akhir: saldo,
    total_masuk: totalMasuk,
    total_keluar: totalKeluar,
    terpotong,
    produksi_berjalan:
      qtyBerjalan > 0
        ? { qty: qtyBerjalan, rencana: bjRencana, dikerjakan: bjDikerjakan, menunggu: bjMenunggu }
        : null,
    pembelian_berjalan:
      qtyBeliBerjalan > 0
        ? { qty: qtyBeliBerjalan, rencana: bbRencana, dikerjakan: bbDikerjakan, menunggu: bbMenunggu }
        : null,
    mutasi,
  };
}

/**
 * Saldo SATU bahan di SEMUA cabang aktif — chip "Stok per Cabang" di Detail
 * Produk. Rumus per cabang identik dengan hitungSaldoCabang (baseline opname +
 * masuk − penjualan − pemakaian − kirim keluar), difokuskan ke satu bahan.
 */
export async function saldoBahanPerCabang(
  companyId: string,
  ingredientId: string,
): Promise<BahanSaldoCabang[]> {
  const result = await db.execute(sql`
    SELECT br.id AS branch_id, br.nama AS nama, br.tipe AS tipe,
      COALESCE(b.qty, 0) + COALESCE(p.qty, 0)
        - COALESCE(u.qty, 0) - COALESCE(pc.qty, 0) - COALESCE(k.qty, 0) AS saldo
    FROM branches br
    LEFT JOIN LATERAL (
      SELECT so.qty, so.created_at
      FROM stock_opnames so
      WHERE so.branch_id = br.id AND so.ingredient_id = ${ingredientId}
        AND so.penyesuaian_status = 'disetujui'
      ORDER BY so.created_at DESC
      LIMIT 1
    ) b ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pr.qty) AS qty FROM productions pr
      WHERE pr.branch_id = br.id AND pr.ingredient_id = ${ingredientId}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND (b.created_at IS NULL OR pr.waktu > b.created_at)
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(sc.qty) AS qty FROM sale_consumptions sc
      WHERE sc.branch_id = br.id AND sc.ingredient_id = ${ingredientId}
        AND (b.created_at IS NULL OR sc.waktu > b.created_at)
        AND EXISTS (SELECT 1 FROM sales s WHERE s.id = sc.sale_id AND s.deleted_at IS NULL)
    ) u ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pc.qty) AS qty FROM production_consumptions pc
      WHERE pc.branch_id = br.id AND pc.ingredient_id = ${ingredientId}
        AND (b.created_at IS NULL OR pc.waktu > b.created_at)
        AND EXISTS (
          SELECT 1 FROM productions pr WHERE pr.id = pc.production_id AND pr.deleted_at IS NULL
        )
    ) pc ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pr.qty) AS qty FROM productions pr
      WHERE pr.asal_branch_id = br.id AND pr.ingredient_id = ${ingredientId}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND (b.created_at IS NULL OR pr.waktu > b.created_at)
    ) k ON TRUE
    WHERE br.company_id = ${companyId} AND br.is_active
    ORDER BY br.tipe, br.nama
  `);
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      branch_id: String(row.branch_id),
      nama: String(row.nama),
      tipe: row.tipe as BahanSaldoCabang["tipe"],
      saldo: Number(row.saldo),
    };
  });
}

/** Batas aman jumlah peristiwa yang di-walk FIFO (jauh di atas skala nyata). */
const BATAS_EVENT_FIFO = 20000;
/** Maksimal baris pemakaian yang DIKIRIM ke klien (perhitungan tetap penuh). */
const BATAS_PEMAKAIAN_FIFO = 300;

/**
 * KARTU FIFO satu bahan pada satu cabang: seluruh riwayat masuk/keluar
 * di-walk kronologis — pemakaian mengonsumsi lot PALING AWAL masuk dulu.
 * Sumber peristiwa identik dgn komponen hitungSaldoCabang, sehingga saldo
 * akhir walk == saldo ledger cabang. Opname disetujui = reset (selisih turun
 * dikonsumsi FIFO, selisih naik jadi lot penyesuaian berharga acuan).
 */
export async function fifoBahan(params: {
  companyId: string;
  branchId: string;
  bahan: { id: string; nama: string; satuan: string };
  /** harga acuan master per satuan kerja — utk lot penyesuaian opname naik */
  hargaAcuan: number | null;
  metodeHpp: "average" | "fifo";
}): Promise<BahanFifoDto> {
  // companyId tak dipakai di query (cakupan branch+ingredient, kepemilikan
  // bahan sudah diverifikasi route) — diterima demi kejelasan pemanggil.
  const { branchId, bahan, hargaAcuan, metodeHpp } = params;
  const [cab] = await db
    .select({ nama: branches.nama })
    .from(branches)
    .where(eq(branches.id, branchId));

  // Deret peristiwa; `sejak` opsional membatasi ke waktu >= sejak (dipakai saat
  // riwayat penuh melebihi batas — dijangkar ke baseline opname terakhir agar
  // saldo walk tetap identik ledger, TIDAK memotong ekor terbaru).
  const ambilEvents = (sejak: Date | null) =>
    db.execute(sql`
    SELECT * FROM (
      -- MASUK: pembelian/produksi terkonfirmasi; baris ber-asal = transfer masuk
      SELECT pr.waktu AS waktu, 'masuk' AS ev,
             CASE WHEN pr.asal_branch_id IS NOT NULL THEN 'transfer'
                  ELSE pr.tipe::text END AS jenis,
             pr.qty AS qty, pr.total_harga AS total_harga, pr.exp_date AS exp_date,
             COALESCE(dn.nomor_teks, pr.no_faktur) AS nomor,
             sp.nama AS supplier, pr.catatan AS catatan
      FROM productions pr
      LEFT JOIN suppliers sp ON sp.id = pr.supplier_id
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = pr.company_id AND dn.ref_id = pr.faktur_id
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = ${bahan.id}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND (${sejak}::timestamptz IS NULL OR pr.waktu >= ${sejak})
      UNION ALL
      -- KELUAR: konsumsi penjualan (BOM struk)
      SELECT sc.waktu, 'keluar', 'penjualan', sc.qty, NULL, NULL,
             s.nomor, NULL, NULL
      FROM sale_consumptions sc
      JOIN sales s ON s.id = sc.sale_id
      WHERE sc.branch_id = ${branchId} AND sc.ingredient_id = ${bahan.id}
        AND s.deleted_at IS NULL
        AND (${sejak}::timestamptz IS NULL OR sc.waktu >= ${sejak})
      UNION ALL
      -- KELUAR: bahan mentah terpakai resep produksi
      SELECT pc.waktu, 'keluar', 'pemakaian', pc.qty, NULL, NULL,
             NULL, NULL, ('Untuk produksi ' || ij.nama)
      FROM production_consumptions pc
      JOIN productions pr ON pr.id = pc.production_id
      JOIN ingredients ij ON ij.id = pr.ingredient_id
      WHERE pc.branch_id = ${branchId} AND pc.ingredient_id = ${bahan.id}
        AND pr.deleted_at IS NULL
        AND (${sejak}::timestamptz IS NULL OR pc.waktu >= ${sejak})
      UNION ALL
      -- KELUAR: kiriman ke cabang lain yang sudah diterima
      SELECT pr.waktu, 'keluar', 'kirim', pr.qty, NULL, NULL,
             COALESCE(dn.nomor_teks, pr.no_faktur), NULL,
             ('Kirim ke ' || bt.nama)
      FROM productions pr
      JOIN branches bt ON bt.id = pr.branch_id
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = pr.company_id AND dn.ref_id = pr.faktur_id
      WHERE pr.asal_branch_id = ${branchId} AND pr.ingredient_id = ${bahan.id}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND (${sejak}::timestamptz IS NULL OR pr.waktu >= ${sejak})
      UNION ALL
      -- OPNAME disetujui: reset saldo ke hitung fisik (termasuk stok awal)
      SELECT so.created_at, 'opname', 'opname', so.qty, NULL, NULL,
             dn.nomor_teks, NULL, so.catatan
      FROM stock_opnames so
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = so.company_id AND dn.ref_id = so.session_id
      WHERE so.branch_id = ${branchId} AND so.ingredient_id = ${bahan.id}
        AND so.penyesuaian_status = 'disetujui'
        AND (${sejak}::timestamptz IS NULL OR so.created_at >= ${sejak})
    ) e
    ORDER BY e.waktu ASC
    LIMIT ${BATAS_EVENT_FIFO + 1}
  `);

  let rows = (await ambilEvents(null)).rows as Record<string, unknown>[];
  let eventTerpotong = false;
  if (rows.length > BATAS_EVENT_FIFO) {
    // Riwayat penuh terlalu panjang. JANGAN buang ekor terbaru (saldo jadi basi)
    // — jangkar ulang ke baseline opname terakhir: jendela persis sama dengan
    // hitungSaldoCabang, event opname pertama me-reset walk → saldo tetap eksak.
    // Riwayat lot pra-baseline tak ditampilkan (ditandai terpotong).
    const base = await db.execute(sql`
      SELECT created_at FROM stock_opnames
      WHERE branch_id = ${branchId} AND ingredient_id = ${bahan.id}
        AND penyesuaian_status = 'disetujui'
      ORDER BY created_at DESC LIMIT 1
    `);
    const createdAt = (base.rows[0] as Record<string, unknown> | undefined)?.created_at;
    if (createdAt != null) {
      rows = (await ambilEvents(new Date(createdAt as string | Date))).rows as Record<
        string,
        unknown
      >[];
    }
    eventTerpotong = true;
    // kasus ekstrem (masih > batas tanpa baseline yang menolong): walk parsial
    // dari awal jendela — saldo bisa tertinggal; flag terpotong memperingatkan.
  }

  const events: FifoEvent[] = rows.slice(0, BATAS_EVENT_FIFO).map((r) => {
    const waktu = new Date(r.waktu as string | Date).toISOString();
    const qty = Number(r.qty);
    if (r.ev === "masuk") {
      const jenis = String(r.jenis) as "beli" | "produksi" | "transfer";
      const total = r.total_harga != null ? Number(r.total_harga) : null;
      return {
        ev: "masuk",
        waktu,
        jenis,
        nomor: r.nomor != null ? String(r.nomor) : null,
        supplier: r.supplier != null ? String(r.supplier) : null,
        qty,
        // harga menempel di lot hanya bila faktur berharga; transfer tak
        // membawa harga (biayanya milik lot asal di CK) → null
        hargaSatuan:
          jenis !== "transfer" && total != null && total > 0 && qty > 0
            ? Math.round((total / qty) * 100) / 100
            : null,
        expDate: r.exp_date != null ? String(r.exp_date) : null,
      };
    }
    if (r.ev === "keluar") {
      return {
        ev: "keluar",
        waktu,
        jenis: String(r.jenis) as "penjualan" | "pemakaian" | "kirim",
        keterangan:
          r.catatan != null
            ? String(r.catatan)
            : r.nomor != null
              ? `Struk ${r.nomor}`
              : null,
        qty,
      };
    }
    return {
      ev: "opname",
      waktu,
      qty,
      keterangan: [
        r.nomor != null ? String(r.nomor) : null,
        r.catatan != null ? String(r.catatan) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    };
  });

  const hasil = jalankanFifo(events, hargaAcuan);
  // tampilan: pemakaian TERBARU dulu, dibatasi — lot & saldo tetap dari walk penuh
  const pemakaianTerbaru = hasil.pemakaian.slice(-BATAS_PEMAKAIAN_FIFO).reverse();
  return {
    bahan,
    branch_id: branchId,
    branch_nama: cab?.nama ?? "",
    metode_hpp: metodeHpp,
    saldo: hasil.saldo,
    defisit: hasil.defisit,
    lots: hasil.lots,
    pemakaian: pemakaianTerbaru,
    terpotong: eventTerpotong || hasil.pemakaian.length > BATAS_PEMAKAIAN_FIFO,
  };
}
