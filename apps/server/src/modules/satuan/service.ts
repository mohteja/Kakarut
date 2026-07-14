/**
 * Master SATUAN (units) — daftar satuan bawaan + backfill dari satuan yang
 * sudah dipakai bahan. `ingredients.satuan` tetap teks; tabel `units` hanya
 * sumber pilihan dropdown + pengelolaan.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { companies, ingredients, units } from "../../db/schema";

/** Satuan bawaan tiap perusahaan (urutan = sortOrder). */
export const SATUAN_DEFAULT = [
  "pcs",
  "gr",
  "kg",
  "ml",
  "liter",
  "butir",
  "porsi",
  "lembar",
  "ikat",
  "bungkus",
  "pack",
  "botol",
  "sachet",
] as const;

/**
 * Pastikan satu perusahaan punya master satuan: sisipkan default + satuan yang
 * sudah dipakai bahannya (yang belum ada). Idempotent (onConflictDoNothing).
 * Dipanggil saat provisioning tenant baru & backfill boot.
 */
export async function seedUnitsPerusahaan(dbx: Db | Tx, companyId: string): Promise<number> {
  const bahanSatuan = await dbx
    .select({ satuan: ingredients.satuan })
    .from(ingredients)
    .where(eq(ingredients.companyId, companyId));
  const nama = new Set<string>(SATUAN_DEFAULT);
  for (const b of bahanSatuan) if (b.satuan?.trim()) nama.add(b.satuan.trim());

  const daftar = [...nama];
  const rows = daftar.map((n, i) => ({
    companyId,
    nama: n,
    // default dulu (urut sesuai SATUAN_DEFAULT), lalu satuan tambahan
    sortOrder: SATUAN_DEFAULT.indexOf(n as (typeof SATUAN_DEFAULT)[number]) >= 0
      ? SATUAN_DEFAULT.indexOf(n as (typeof SATUAN_DEFAULT)[number])
      : 100 + i,
  }));
  const res = await dbx
    .insert(units)
    .values(rows)
    .onConflictDoNothing({ target: [units.companyId, units.nama] })
    .returning({ id: units.id });
  return res.length;
}

/**
 * Backfill boot: seed master satuan untuk perusahaan yang belum punya satu pun.
 * Perusahaan yang sudah punya units tidak disentuh (agar penghapusan manual
 * tak "bangkit" lagi).
 */
export async function backfillUnits(dbx: Db | Tx): Promise<number> {
  const semua = await dbx.select({ id: companies.id }).from(companies);
  if (semua.length === 0) return 0;
  const adaUnit = await dbx.select({ companyId: units.companyId }).from(units);
  const punya = new Set(adaUnit.map((r) => r.companyId));
  const kosong = semua.filter((c) => !punya.has(c.id)).map((c) => c.id);
  let n = 0;
  for (const companyId of kosong) n += await seedUnitsPerusahaan(dbx, companyId);
  return n;
}
