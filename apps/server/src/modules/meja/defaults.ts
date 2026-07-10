import type { Db, Tx } from "../../db/client";
import { meja } from "../../db/schema";

/**
 * Meja bawaan tiap cabang baru: 1 Ruang Tunggu (take away) + Meja 1 (dine-in),
 * supaya usaha take away langsung bisa jualan tanpa mengatur meja lebih dulu.
 * Posisi persen (0..100) dibuat tak menumpuk. Idempoten via unique
 * (branch_id, nama), jadi aman dipanggil ulang.
 */
export const MEJA_DEFAULT = [
  { nama: "Ruang Tunggu", tipe: "takeaway" as const, posX: 20, posY: 25 },
  { nama: "Meja 1", tipe: "dine_in" as const, posX: 50, posY: 45 },
];

export async function seedMejaDefault(exec: Db | Tx, companyId: string, branchId: string) {
  await exec
    .insert(meja)
    .values(MEJA_DEFAULT.map((m) => ({ companyId, branchId, ...m })))
    .onConflictDoNothing();
}
