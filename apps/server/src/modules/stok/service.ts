import { eq, sql } from "drizzle-orm";
import {
  saldoStok,
  statusStok,
  type KartuStokDto,
  type MutasiJenis,
  type MutasiStok,
  type StokRowDto,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { branches } from "../../db/schema";

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
      t.id          AS tempat_id,
      t.nama        AS tempat,
      COALESCE(b.qty, 0) AS stok_awal,
      COALESCE(p.qty, 0) AS produksi,
      COALESCE(u.qty, 0) + COALESCE(pc.qty, 0) AS terpakai,
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
      -- tempat penyimpanan dari entri masuk terkonfirmasi terakhir
      SELECT sl.id, sl.nama
      FROM productions pr
      JOIN storage_locations sl ON sl.id = pr.storage_location_id
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND pr.storage_location_id IS NOT NULL
      ORDER BY pr.waktu DESC
      LIMIT 1
    ) t ON TRUE
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
    ) wb ON TRUE
    WHERE i.company_id = ${companyId} AND i.is_active AND i.track_stok
    ORDER BY i.nama
  `);

  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const stokAwal = Number(row.stok_awal);
    const produksi = Number(row.produksi);
    const terpakai = Number(row.terpakai);
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
      ), 0) AS keluar
  `);
  const awal = awalRes.rows[0] as Record<string, unknown>;
  const saldoAwal = Number(awal.baseline_qty) + Number(awal.masuk) - Number(awal.keluar);

  // Semua mutasi dalam rentang, urut waktu
  const mutasiRes = await db.execute(sql`
    SELECT * FROM (
      SELECT so.created_at AS waktu, 'opname' AS jenis, so.qty AS qty,
             so.catatan AS catatan, NULL AS nomor, NULL AS supplier,
             NULL AS tempat, false AS is_batch
      FROM stock_opnames so
      WHERE so.branch_id = ${branchId} AND so.ingredient_id = ${ingredientId}
        AND so.penyesuaian_status = 'disetujui'
        AND so.opname_date >= ${dari} AND so.opname_date <= ${sampai}
      UNION ALL
      SELECT pr.waktu, pr.tipe::text AS jenis, pr.qty, pr.catatan,
             pr.no_faktur AS nomor, sp.nama AS supplier, sl.nama AS tempat, pr.is_batch
      FROM productions pr
      LEFT JOIN suppliers sp ON sp.id = pr.supplier_id
      LEFT JOIN storage_locations sl ON sl.id = pr.storage_location_id
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
      keterangan = r.catatan ? String(r.catatan) : "Penyesuaian stok fisik";
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
