import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { syncCommands } from "../../db/schema";

/**
 * Ledger idempotensi BERSAMA dengan /api/sync — kunci `(company_id, client_ref)`.
 *
 * Endpoint ONLINE (penjualan/absensi) memakai ledger yang sama supaya retry —
 * baik retry online maupun antrean yang jatuh ke /sync setelah `receiveTimeout`
 * — mengenali perintah yang SUDAH sukses dan tidak menggandakannya. `/sync`
 * sendiri sudah membaca ledger ini lebih dulu, jadi begitu jalur online mencatat
 * di sini, retry lewat /sync otomatis membalas `sudah_ada`.
 */

/**
 * Field `client_ref` opsional (UUID v4 dari perangkat). Kosong/absen → diabaikan
 * (perilaku lama untuk klien tanpa field ini tidak berubah).
 */
export const clientRefField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().uuid().optional(),
);

/** Field `device_id` opsional (metadata ledger, tidak wajib). */
export const deviceIdField = z.string().trim().max(200).nullish();

/**
 * Hasil SUKSES yang sudah tercatat untuk `client_ref` ini, atau `null` bila belum
 * pernah ada. Membungkus dalam objek supaya "ada tapi hasilJson null" tetap
 * dikenali sebagai HIT (jangan sampai dieksekusi ulang).
 */
export async function cariHasilIdempoten(
  companyId: string,
  clientRef: string,
): Promise<{ hasilJson: unknown } | null> {
  const [ada] = await db
    .select({ status: syncCommands.status, hasilJson: syncCommands.hasilJson })
    .from(syncCommands)
    .where(and(eq(syncCommands.companyId, companyId), eq(syncCommands.clientRef, clientRef)));
  return ada && ada.status === "ok" ? { hasilJson: ada.hasilJson ?? null } : null;
}

/**
 * Catat hasil SUKSES jalur online ke ledger bersama. Idempoten via unique index
 * `(company_id, client_ref)` + `onConflictDoNothing` (aman bila ada balapan/retry).
 */
export async function catatHasilIdempoten(p: {
  companyId: string;
  clientRef: string;
  userId: string;
  deviceId?: string | null;
  tipe: string;
  hasilJson: unknown;
  kode?: number;
}): Promise<void> {
  await db
    .insert(syncCommands)
    .values({
      companyId: p.companyId,
      clientRef: p.clientRef,
      deviceId: p.deviceId ?? null,
      userId: p.userId,
      tipe: p.tipe,
      waktu: new Date(),
      status: "ok",
      kode: p.kode ?? 201,
      hasilJson: p.hasilJson as object,
    })
    .onConflictDoNothing();
}
