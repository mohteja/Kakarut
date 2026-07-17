import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { memberships, users } from "../../db/schema";

/** Kode karyawan = 8 digit acak (numerik). Mudah diketik di numpad saat absen & unik per perusahaan. */
const FORMAT_KODE_KARYAWAN = /^\d{8}$/;

/** Kode karyawan 8 digit acak yang belum ada di himpunan `dipakai`. */
function kodeKaryawanAcak(dipakai: Set<string>): string {
  // ruang 100 juta ≫ jumlah karyawan mana pun → praktis tak pernah kehabisan
  for (let i = 0; i < 100; i += 1) {
    const kode = String(randomInt(0, 100_000_000)).padStart(8, "0");
    if (!dipakai.has(kode)) return kode;
  }
  throw new Error("Gagal membuat kode karyawan unik");
}

/**
 * Tentukan kode karyawan unik dalam perusahaan (untuk membership baru).
 * Kode = ID cepat absensi (ketik/scan QR): 8 digit acak, unik per perusahaan.
 */
export async function resolveKodeKaryawan(
  dbx: Db | Tx,
  companyId: string,
): Promise<string> {
  const rows = await dbx
    .select({ kode: memberships.employeeCode })
    .from(memberships)
    .where(eq(memberships.companyId, companyId));
  const dipakai = new Set(rows.filter((r) => r.kode).map((r) => r.kode!.toUpperCase()));
  return kodeKaryawanAcak(dipakai);
}

type BackfillRow = { id: string; companyId: string; kode: string | null };

/** advisory lock unik: dua instance server yang boot bersamaan tak mengisi kode ganda */
const BACKFILL_KODE_LOCK_KEY = 727272025;

/**
 * Pastikan tiap membership punya kode karyawan 8 digit acak (dipanggil saat boot
 * & seed). Idempotent: menyentuh baris yang kodenya NULL ATAU belum berformat 8
 * digit (kode lama gaya inisial "BS" di-upgrade sekali → 8 digit), kode yang
 * sudah 8 digit dibiarkan stabil. Dijalankan dalam transaksi + advisory lock
 * agar aman multi-instance (replika kedua menunggu, lalu melihat kode sudah
 * benar → no-op). Urutan deterministik (companyId, createdAt, id).
 */
export async function backfillEmployeeCode(dbx: Db | Tx): Promise<number> {
  return dbx.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BACKFILL_KODE_LOCK_KEY})`);
    const rows: BackfillRow[] = await tx
      .select({
        id: memberships.id,
        companyId: memberships.companyId,
        kode: memberships.employeeCode,
      })
      .from(memberships)
      .orderBy(asc(memberships.companyId), asc(memberships.createdAt), asc(memberships.id));
    const perusahaan = new Map<string, { dipakai: Set<string>; perluKode: BackfillRow[] }>();
    for (const r of rows) {
      const g = perusahaan.get(r.companyId) ?? { dipakai: new Set<string>(), perluKode: [] };
      // kode valid (8 digit) dipertahankan; NULL / format lama → dibuat ulang
      if (r.kode && FORMAT_KODE_KARYAWAN.test(r.kode)) g.dipakai.add(r.kode.toUpperCase());
      else g.perluKode.push(r);
      perusahaan.set(r.companyId, g);
    }
    let terisi = 0;
    for (const [, g] of perusahaan) {
      for (const r of g.perluKode) {
        const kode = kodeKaryawanAcak(g.dipakai);
        g.dipakai.add(kode);
        await tx.update(memberships).set({ employeeCode: kode }).where(eq(memberships.id, r.id));
        terisi += 1;
      }
    }
    return terisi;
  });
}

/**
 * Nonaktif = arsip: karyawan yang dinonaktifkan sebelum penyatuan status ikut
 * dipindah ke arsip (dipanggil saat boot; idempoten — hanya baris belum
 * terarsip milik user nonaktif).
 */
export async function arsipkanMembershipNonaktif(dbx: Db | Tx): Promise<number> {
  const nonaktif = dbx.select({ id: users.id }).from(users).where(eq(users.isActive, false));
  const rows = await dbx
    .update(memberships)
    .set({ archivedAt: new Date() })
    .where(and(isNull(memberships.archivedAt), inArray(memberships.userId, nonaktif)))
    .returning({ id: memberships.id });
  return rows.length;
}

/** Deteksi bentrok unik kode karyawan (untuk retry pembuatan karyawan). */
export function isKodeKaryawanConflict(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = err?.code ?? err?.cause?.code;
  const constraint = err?.constraint ?? err?.cause?.constraint ?? "";
  return code === "23505" && constraint.includes("memberships_company_kode_uq");
}
