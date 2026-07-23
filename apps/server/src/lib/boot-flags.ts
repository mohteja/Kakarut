import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { bootFlags } from "../db/schema";

/**
 * Jalankan backfill WARISAN sekali saja: bila flag `key` sudah tercatat,
 * lompati (boot cepat); bila belum, jalankan lalu catat. Backfill-nya sendiri
 * tetap idempoten — dua instance yang boot bersamaan paling banter menjalankan
 * ulang pekerjaan tanpa efek ganda, lalu sama-sama mencatat flag.
 */
export async function sekaliSaja(
  key: string,
  jalankan: () => Promise<number>,
): Promise<number> {
  const [ada] = await db
    .select({ key: bootFlags.key })
    .from(bootFlags)
    .where(eq(bootFlags.key, key));
  if (ada) return 0;
  const n = await jalankan();
  await db.insert(bootFlags).values({ key }).onConflictDoNothing();
  return n;
}
