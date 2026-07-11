import { asc, eq, sql } from "drizzle-orm";
import { kodeKaryawanDariNama } from "@kakarut/shared";
import type { Db, Tx } from "../../db/client";
import { memberships, users } from "../../db/schema";

/** Kode unik berikutnya dari basis + himpunan kode terpakai (mis. BS, BS2…). */
function kodeUnik(base: string, dipakai: Set<string>): string {
  let kode = base;
  let n = 2;
  while (dipakai.has(kode.toUpperCase())) {
    kode = `${base}${n}`;
    n += 1;
  }
  return kode;
}

/**
 * Tentukan kode karyawan unik dalam perusahaan dari nama (untuk membership
 * baru). Kode = ID cepat absensi (ketik/scan QR). Menambah angka bila bentrok.
 */
export async function resolveKodeKaryawan(
  dbx: Db | Tx,
  companyId: string,
  nama: string,
): Promise<string> {
  const rows = await dbx
    .select({ kode: memberships.employeeCode })
    .from(memberships)
    .where(eq(memberships.companyId, companyId));
  const dipakai = new Set(rows.filter((r) => r.kode).map((r) => r.kode!.toUpperCase()));
  return kodeUnik(kodeKaryawanDariNama(nama), dipakai);
}

type BackfillRow = { id: string; companyId: string; nama: string; kode: string | null };

/** advisory lock unik: dua instance server yang boot bersamaan tak mengisi kode ganda */
const BACKFILL_KODE_LOCK_KEY = 727272025;

/**
 * Isi kode karyawan untuk membership lama yang belum punya (dipanggil saat boot
 * & seed). Idempotent: hanya menyentuh baris kode NULL, unik per perusahaan.
 * Dijalankan dalam transaksi + advisory lock agar aman multi-instance (replika
 * kedua menunggu, lalu melihat kode sudah terisi → no-op). Urutan deterministik
 * (companyId, createdAt, id) supaya penetapan kode konsisten.
 */
export async function backfillEmployeeCode(dbx: Db | Tx): Promise<number> {
  return dbx.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BACKFILL_KODE_LOCK_KEY})`);
    const rows: BackfillRow[] = await tx
      .select({
        id: memberships.id,
        companyId: memberships.companyId,
        nama: users.nama,
        kode: memberships.employeeCode,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .orderBy(asc(memberships.companyId), asc(memberships.createdAt), asc(memberships.id));
    const perusahaan = new Map<string, { dipakai: Set<string>; kosong: BackfillRow[] }>();
    for (const r of rows) {
      const g = perusahaan.get(r.companyId) ?? { dipakai: new Set<string>(), kosong: [] };
      if (r.kode) g.dipakai.add(r.kode.toUpperCase());
      else g.kosong.push(r);
      perusahaan.set(r.companyId, g);
    }
    let terisi = 0;
    for (const [, g] of perusahaan) {
      for (const r of g.kosong) {
        const kode = kodeUnik(kodeKaryawanDariNama(r.nama), g.dipakai);
        g.dipakai.add(kode.toUpperCase());
        await tx.update(memberships).set({ employeeCode: kode }).where(eq(memberships.id, r.id));
        terisi += 1;
      }
    }
    return terisi;
  });
}

/** Deteksi bentrok unik kode karyawan (untuk retry pembuatan karyawan). */
export function isKodeKaryawanConflict(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = err?.code ?? err?.cause?.code;
  const constraint = err?.constraint ?? err?.cause?.constraint ?? "";
  return code === "23505" && constraint.includes("memberships_company_kode_uq");
}
