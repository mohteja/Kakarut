import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { productions, storageLocationIngredients, storageLocations } from "../../db/schema";

/**
 * Auto-file bahan yang baru DITERIMA/dikonfirmasi di cabang ke RAK DEFAULT-nya
 * (penugasan bahan↔rak per cabang di halaman Tempat Penyimpanan). Hanya mengisi
 * baris yang BELUM punya tempat, agar rak yang dipilih manual tak tertimpa.
 * Idempoten & aman dipanggil di semua jalur konfirmasi/penerimaan.
 */
export async function autoFileRakCabang(companyId: string, rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  const rows = await db
    .select({
      id: productions.id,
      branchId: productions.branchId,
      ingredientId: productions.ingredientId,
    })
    .from(productions)
    .where(and(inArray(productions.id, rowIds), isNull(productions.storageLocationId)));
  if (rows.length === 0) return;
  const ingIds = [...new Set(rows.map((r) => r.ingredientId))];
  const asg = await db
    .select({
      ingredientId: storageLocationIngredients.ingredientId,
      storageLocationId: storageLocationIngredients.storageLocationId,
      branchId: storageLocations.branchId,
    })
    .from(storageLocationIngredients)
    .innerJoin(
      storageLocations,
      eq(storageLocations.id, storageLocationIngredients.storageLocationId),
    )
    .where(
      and(
        eq(storageLocationIngredients.companyId, companyId),
        inArray(storageLocationIngredients.ingredientId, ingIds),
      ),
    );
  const byKey = new Map(asg.map((a) => [`${a.branchId}|${a.ingredientId}`, a.storageLocationId]));
  for (const r of rows) {
    const sl = byKey.get(`${r.branchId}|${r.ingredientId}`);
    if (sl) {
      await db
        .update(productions)
        .set({ storageLocationId: sl })
        .where(and(eq(productions.id, r.id), isNull(productions.storageLocationId)));
    }
  }
}
