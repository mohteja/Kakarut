import { eq, sql } from "drizzle-orm";
import { tanggalDi } from "../../lib/time";
import type { Db, Tx } from "../../db/client";
import { antreanTakeAway, companies } from "../../db/schema";

/**
 * NOMOR ANTREAN TAKE AWAY (permintaan pemilik 2026-11-11): banyak pesanan
 * bawa pulang berjalan bersamaan di "Kasir & Take Away", jadi tiap pesanan
 * mendapat nomor urut per cabang per hari bisnis — TA-1, TA-2, …
 *
 * Satu UPSERT … RETURNING: dua kasir yang menyimpan bersamaan mendapat nomor
 * berbeda tanpa kunci tambahan (baris penghitungnya yang mengurutkan).
 * `tanggal` = tanggal bisnis di zona perusahaan (pemanggil yang menghitung).
 */
export async function ambilNomorAntrean(exec: Db | Tx, branchId: string, tanggal: string): Promise<number> {
  const [row] = await exec
    .insert(antreanTakeAway)
    .values({ branchId, tanggal, terakhir: 1 })
    .onConflictDoUpdate({
      target: [antreanTakeAway.branchId, antreanTakeAway.tanggal],
      set: { terakhir: sql`${antreanTakeAway.terakhir} + 1` },
    })
    .returning({ terakhir: antreanTakeAway.terakhir });
  return row.terakhir;
}

/** `ambilNomorAntrean` untuk HARI INI di zona perusahaan. */
export async function ambilNomorAntreanHariIni(exec: Db | Tx, companyId: string, branchId: string): Promise<number> {
  const [comp] = await exec
    .select({ tz: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return ambilNomorAntrean(exec, branchId, tanggalDi(comp?.tz ?? "Asia/Jakarta"));
}
