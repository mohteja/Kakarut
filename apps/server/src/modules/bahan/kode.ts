/**
 * Kode produk untuk BAHAN (ingredients) — mirror kode menu: pakai kode manual
 * bila diisi, kosong → generate dari nama; dijamin unik per perusahaan. Dipakai
 * POST/PUT/bulk bahan + backfill boot untuk bahan lama tanpa kode.
 */
import { asc, eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { ingredients } from "../../db/schema";
import { kunciBackfillKode } from "../../lib/kunci";
import { kodeDariNama, kodeUnik } from "../menu/service";

/** Himpunan kode terpakai (uppercase) di sebuah perusahaan, kecuali `selfId`. */
async function kodeDipakai(
  dbx: Db | Tx,
  companyId: string,
  selfId?: string,
): Promise<Set<string>> {
  const rows = await dbx
    .select({ id: ingredients.id, kode: ingredients.kode })
    .from(ingredients)
    .where(eq(ingredients.companyId, companyId));
  return new Set(
    rows.filter((r) => r.kode && r.id !== selfId).map((r) => r.kode!.toUpperCase()),
  );
}

/**
 * Kode final sebuah bahan: manual bila diisi, selain itu generate dari nama.
 * Unik dalam perusahaan (menambah angka bila bentrok). Untuk pembuatan banyak
 * bahan sekaligus, pakai `resolveKodeBahanBatch` agar antar-baris juga unik.
 */
export async function resolveKodeBahan(
  dbx: Db | Tx,
  companyId: string,
  desired: string | null | undefined,
  nama: string,
  selfId?: string,
): Promise<string> {
  const dipakai = await kodeDipakai(dbx, companyId, selfId);
  const manual = desired?.trim();
  const base = manual && manual.length > 0 ? manual : kodeDariNama(nama);
  return kodeUnik(base, dipakai);
}

/**
 * Kode untuk sekumpulan bahan baru (bulk) — unik terhadap existing DAN antar
 * baris dalam batch yang sama (satu pass, tak menggagalkan batch bila bentrok).
 */
export async function resolveKodeBahanBatch(
  dbx: Db | Tx,
  companyId: string,
  baris: { nama: string; kode?: string | null }[],
): Promise<string[]> {
  const dipakai = await kodeDipakai(dbx, companyId);
  return baris.map((b) => {
    const manual = b.kode?.trim();
    const base = manual && manual.length > 0 ? manual : kodeDariNama(b.nama);
    const kode = kodeUnik(base, dipakai);
    dipakai.add(kode.toUpperCase());
    return kode;
  });
}

type BackfillRow = { id: string; companyId: string; nama: string; kode: string | null };

/**
 * Isi kode untuk bahan lama yang belum punya (dipanggil saat boot & seed).
 * Idempotent: hanya menyentuh baris kode NULL. Kode digenerate dari nama &
 * unik per perusahaan.
 *
 * "Unik" itu dijamin oleh `dipakai`, sebuah Set yang hidup di dalam SATU
 * proses — dan `ingredients.kode` TIDAK punya indeks unik yang menangkapnya
 * kalau jaminan itu meleset. Dua instance yang boot bersamaan sama-sama
 * membaca "kode NULL", sama-sama menurunkan kode yang sama dari nama yang
 * sama, lalu sama-sama menulis. TERUKUR: 232 bahan, dua backfill serentak →
 * **2 kode ganda**. Karena itu seluruhnya dijalankan dalam transaksi +
 * advisory lock, persis seperti `backfillEmployeeCode` yang sudah lebih dulu
 * begitu (dan yang komentarnya sudah menuliskan sebabnya).
 */
export async function backfillKodeBahan(dbx: Db | Tx): Promise<number> {
  return dbx.transaction(async (tx) => backfillKodeBahanTx(tx));
}

async function backfillKodeBahanTx(dbx: Tx): Promise<number> {
  await kunciBackfillKode(dbx, "bahan");
  const rows: BackfillRow[] = await dbx
    .select({
      id: ingredients.id,
      companyId: ingredients.companyId,
      nama: ingredients.nama,
      kode: ingredients.kode,
    })
    .from(ingredients)
    .orderBy(asc(ingredients.nama));
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
      const kode = kodeUnik(kodeDariNama(r.nama), g.dipakai);
      g.dipakai.add(kode.toUpperCase());
      await dbx.update(ingredients).set({ kode }).where(eq(ingredients.id, r.id));
      terisi += 1;
    }
  }
  return terisi;
}
