import { inArray, sql } from "drizzle-orm";
import type { db as DB } from "../../db/client";
import { dokumenCounters, dokumenNomor } from "../../db/schema";

type DbAtauTx = typeof DB | Parameters<Parameters<typeof DB.transaction>[0]>[0];

/** Jenis dokumen bernomor (selaras enum dokumen_jenis di schema). */
export type DokumenJenis =
  | "beli"
  | "produksi"
  | "opname"
  | "perlengkapan"
  | "kiriman_perlengkapan"
  | "opname_perlengkapan";

/**
 * Prefiks nomor per jenis dokumen: PB (pembelian), PR (produksi), SO (stock
 * opname bahan), PL (stok masuk perlengkapan), KP (kiriman perlengkapan
 * CK→cabang), OP (sesi opname perlengkapan).
 */
const PREFIKS: Record<DokumenJenis, string> = {
  beli: "PB",
  produksi: "PR",
  opname: "SO",
  perlengkapan: "PL",
  kiriman_perlengkapan: "KP",
  opname_perlengkapan: "OP",
};

export function formatNomor(jenis: DokumenJenis, nomor: number): string {
  return `${PREFIKS[jenis]}-${String(nomor).padStart(4, "0")}`;
}

/**
 * Terbitkan nomor dokumen berikutnya (PB-0001/PR-0001/SO-0001) untuk satu
 * ref (faktur_id / session_id). Increment counter atomik (upsert), lalu catat
 * di dokumen_nomor. Idempoten per ref: bila ref sudah bernomor, kembalikan
 * nomor lamanya (ON CONFLICT DO NOTHING → baca ulang).
 */
export async function terbitkanNomor(
  dbTx: DbAtauTx,
  companyId: string,
  jenis: DokumenJenis,
  refId: string,
): Promise<string> {
  const [ctr] = await dbTx
    .insert(dokumenCounters)
    .values({ companyId, jenis, lastNomor: 1 })
    .onConflictDoUpdate({
      target: [dokumenCounters.companyId, dokumenCounters.jenis],
      set: { lastNomor: sql`${dokumenCounters.lastNomor} + 1` },
    })
    .returning({ lastNomor: dokumenCounters.lastNomor });
  const teks = formatNomor(jenis, ctr.lastNomor);
  const inserted = await dbTx
    .insert(dokumenNomor)
    .values({ companyId, refId, jenis, nomor: ctr.lastNomor, nomorTeks: teks })
    .onConflictDoNothing()
    .returning({ nomorTeks: dokumenNomor.nomorTeks });
  if (inserted.length > 0) return inserted[0].nomorTeks;
  // ref sudah bernomor (idempoten) — pakai nomor lamanya
  const rows = await dbTx
    .select({ nomorTeks: dokumenNomor.nomorTeks })
    .from(dokumenNomor)
    .where(sql`${dokumenNomor.companyId} = ${companyId} AND ${dokumenNomor.refId} = ${refId}`);
  return rows[0]?.nomorTeks ?? teks;
}

/** Peta refId → nomor tampil untuk daftar (satu query per halaman). */
export async function nomorUntukRefs(
  dbTx: DbAtauTx,
  companyId: string,
  refIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(refIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await dbTx
    .select({ refId: dokumenNomor.refId, nomorTeks: dokumenNomor.nomorTeks })
    .from(dokumenNomor)
    .where(
      sql`${dokumenNomor.companyId} = ${companyId} AND ${inArray(dokumenNomor.refId, ids)}`,
    );
  return new Map(rows.map((r) => [r.refId, r.nomorTeks]));
}

/**
 * Backfill boot (idempoten): faktur produksi/beli & sesi opname LAMA yang belum
 * bernomor → diberi nomor urut kronologis (berdasar waktu terawal dokumen),
 * per perusahaan per jenis. Dokumen baru bernomor saat dibuat, jadi backfill
 * hanya menyentuh data dari sebelum fitur penomoran.
 */
export async function backfillNomorDokumen(database: typeof DB): Promise<number> {
  let total = 0;
  await database.transaction(async (tx) => {
    // faktur produksi/beli (termasuk yang di Tempat Sampah — nomor tetap milik dokumen)
    const fakturs = await tx.execute(sql`
      SELECT p.company_id, p.tipe AS jenis, p.faktur_id AS ref_id, MIN(p.waktu) AS terawal
      FROM productions p
      LEFT JOIN dokumen_nomor dn ON dn.company_id = p.company_id AND dn.ref_id = p.faktur_id
      WHERE p.faktur_id IS NOT NULL AND dn.ref_id IS NULL
      GROUP BY p.company_id, p.tipe, p.faktur_id
      ORDER BY p.company_id, MIN(p.waktu), p.faktur_id
    `);
    for (const r of fakturs.rows as { company_id: string; jenis: "beli" | "produksi"; ref_id: string }[]) {
      await terbitkanNomor(tx, r.company_id, r.jenis, r.ref_id);
      total++;
    }
    const sesi = await tx.execute(sql`
      SELECT so.company_id, so.session_id AS ref_id, MIN(so.created_at) AS terawal
      FROM stock_opnames so
      LEFT JOIN dokumen_nomor dn ON dn.company_id = so.company_id AND dn.ref_id = so.session_id
      WHERE so.session_id IS NOT NULL AND dn.ref_id IS NULL
      GROUP BY so.company_id, so.session_id
      ORDER BY so.company_id, MIN(so.created_at), so.session_id
    `);
    for (const r of sesi.rows as { company_id: string; ref_id: string }[]) {
      await terbitkanNomor(tx, r.company_id, "opname", r.ref_id);
      total++;
    }
  });
  return total;
}
