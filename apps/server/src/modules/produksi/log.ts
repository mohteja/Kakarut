import type { JenisPengadaan } from "@kakarut/shared";
import { db } from "../../db/client";
import { fakturLogs } from "../../db/schema";

type DbAtauTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Format rupiah ringkas untuk detail log ("Rp 90.000"). */
export function rpLog(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Label aksi tahap per jalur — dipakai log & tampilan riwayat. */
export const AKSI_TAHAP_LOG: Record<
  JenisPengadaan,
  Record<"dikerjakan" | "menunggu" | "dikonfirmasi", string>
> = {
  produksi: {
    dikerjakan: "Mulai dikerjakan",
    menunggu: "Selesai — menunggu konfirmasi",
    dikonfirmasi: "Dikonfirmasi — stok masuk",
  },
  beli: {
    dikerjakan: "Diproses",
    menunggu: "Dikirim",
    dikonfirmasi: "Diterima — stok masuk",
  },
};

/**
 * Catat satu kegiatan faktur (jejak audit). Dipanggil pada: pembuatan faktur,
 * ubah tahap, konfirmasi, dan penerimaan. Kegagalan tidak boleh terjadi diam-
 * diam — panggil di dalam transaksi yang sama bila ada.
 */
export async function catatLogFaktur(
  tx: DbAtauTx,
  log: {
    companyId: string;
    branchId: string;
    fakturId: string;
    jalur: JenisPengadaan;
    aksi: string;
    detail?: string | null;
    userId: string;
  },
) {
  await tx.insert(fakturLogs).values({
    companyId: log.companyId,
    branchId: log.branchId,
    fakturId: log.fakturId,
    jalur: log.jalur,
    aksi: log.aksi,
    detail: log.detail ?? null,
    userId: log.userId,
  });
}
