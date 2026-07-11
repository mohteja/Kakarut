import { eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { customers } from "../../db/schema";

/**
 * Normalisasi nomor WhatsApp → hanya digit (buang spasi/tanda/+). Dipakai
 * sebagai identitas member per perusahaan (dedup). Mengembalikan null bila
 * kosong / terlalu pendek untuk dianggap valid.
 */
export function normalizeWa(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

/**
 * Cari-atau-buat member berdasarkan WA (dalam transaksi checkout). Bila WA
 * kosong/invalid → tidak membuat member (mengembalikan null). Nama diperbarui
 * ke yang terbaru. Mengembalikan { id, nama, wa } untuk snapshot pada sale.
 */
export async function upsertCustomer(
  tx: Tx,
  companyId: string,
  nama: string | null | undefined,
  waRaw: string | null | undefined,
): Promise<{ id: string; nama: string; wa: string } | null> {
  const wa = normalizeWa(waRaw);
  if (!wa) return null;
  const namaBersih = nama?.trim() || "Pelanggan";
  const [row] = await tx
    .insert(customers)
    .values({ companyId, nama: namaBersih, wa })
    .onConflictDoUpdate({
      target: [customers.companyId, customers.wa],
      set: { nama: namaBersih, updatedAt: new Date() },
    })
    .returning({ id: customers.id, nama: customers.nama, wa: customers.wa });
  return row ?? null;
}

/** Ambil satu member (company-scoped) atau null. */
export async function getCustomer(tx: Tx, companyId: string, id: string) {
  const [row] = await tx.select().from(customers).where(eq(customers.id, id));
  if (!row || row.companyId !== companyId) return null;
  return row;
}
