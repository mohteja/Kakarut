/**
 * Master KATEGORI BAHAN (ingredient_categories) — daftar bawaan + backfill dari
 * kategori yang sudah dipakai bahan. `ingredients.kategori` tetap teks; tabel
 * ini hanya sumber pilihan dropdown + pengelolaannya. Pola sama dgn satuan.
 */
import { eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { companies, ingredientCategories, ingredients } from "../../db/schema";

/** Kategori bahan bawaan tiap perusahaan (urutan = sortOrder). */
export const KATEGORI_BAHAN_DEFAULT = ["baso", "minuman", "lain"] as const;

/**
 * Pastikan satu perusahaan punya master kategori bahan: sisipkan default +
 * kategori yang sudah dipakai bahannya (yang belum ada). Idempotent.
 * Dipanggil saat provisioning tenant baru & backfill boot.
 */
export async function seedKategoriBahanPerusahaan(
  dbx: Db | Tx,
  companyId: string,
): Promise<number> {
  const bahanKategori = await dbx
    .select({ kategori: ingredients.kategori })
    .from(ingredients)
    .where(eq(ingredients.companyId, companyId));
  const nama = new Set<string>(KATEGORI_BAHAN_DEFAULT);
  for (const b of bahanKategori) if (b.kategori?.trim()) nama.add(b.kategori.trim());

  const daftar = [...nama];
  const rows = daftar.map((n, i) => {
    const idx = KATEGORI_BAHAN_DEFAULT.indexOf(n as (typeof KATEGORI_BAHAN_DEFAULT)[number]);
    return { companyId, nama: n, sortOrder: idx >= 0 ? idx : 100 + i };
  });
  const res = await dbx
    .insert(ingredientCategories)
    .values(rows)
    .onConflictDoNothing({ target: [ingredientCategories.companyId, ingredientCategories.nama] })
    .returning({ id: ingredientCategories.id });
  return res.length;
}

/**
 * Peta kanonik kategori: lowercase(nama) → nama master asli. Dipakai untuk
 * menormalkan kategori bahan agar konsisten huruf besar/kecil (mis. user
 * mengetik "buah segar" padahal master "Buah segar" → disimpan "Buah segar").
 */
export async function kategoriKanonikMap(
  dbx: Db | Tx,
  companyId: string,
): Promise<Map<string, string>> {
  const rows = await dbx
    .select({ nama: ingredientCategories.nama })
    .from(ingredientCategories)
    .where(eq(ingredientCategories.companyId, companyId));
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.nama.trim().toLowerCase(), r.nama);
  return m;
}

/** Kembalikan ejaan kategori master yang cocok (case-insensitive), atau teks apa adanya. */
export function kanonikKategori(map: Map<string, string>, raw: string): string {
  const t = raw.trim();
  return map.get(t.toLowerCase()) ?? t;
}

/**
 * Backfill boot: seed master kategori bahan untuk perusahaan yang belum punya
 * satu pun (perusahaan yang sudah punya tak disentuh).
 */
export async function backfillKategoriBahan(dbx: Db | Tx): Promise<number> {
  const semua = await dbx.select({ id: companies.id }).from(companies);
  if (semua.length === 0) return 0;
  const ada = await dbx
    .select({ companyId: ingredientCategories.companyId })
    .from(ingredientCategories);
  const punya = new Set(ada.map((r) => r.companyId));
  const kosong = semua.filter((c) => !punya.has(c.id)).map((c) => c.id);
  let n = 0;
  for (const companyId of kosong) n += await seedKategoriBahanPerusahaan(dbx, companyId);
  return n;
}
