import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { AnomaliKiriman } from "@kakarut/shared";
import { api } from "./api";

/**
 * KIRIMAN MENGGANTUNG — barang yang fakturnya berbunyi "Dikirim" tapi tak
 * pernah bisa diterima siapa pun: tak muncul di Penerimaan, stok cabang tak
 * bertambah, dan tak ada satu pun layar yang menampilkannya.
 *
 * Dipakai bersama oleh TIGA layar, dan sengaja satu hook: layar Penerimaan
 * (spanduk + tombol hapuskan) serta kartu faktur di Beli & Produksi (tanda
 * "barang tidak sampai"). Kalau tiap layar memanggil sendiri-sendiri, suatu
 * saat yang satu bilang bermasalah dan yang lain bilang normal.
 *
 * `jumlah: 0` adalah keadaan SEHAT — layar yang memakainya tidak boleh
 * menampilkan apa pun saat nol.
 */
export function useKirimanMenggantung() {
  const { data, isLoading } = useQuery({
    queryKey: ["penerimaan-anomali"],
    queryFn: () => api<AnomaliKiriman>("/penerimaan/anomali"),
    // Bukan data yang berubah tiap detik, tapi juga tak boleh basi saat orang
    // baru saja menghapuskannya di tab lain.
    staleTime: 30_000,
  });

  /** faktur mana saja yang punya baris menggantung — dasar tanda di kartu */
  const fakturBermasalah = useMemo(
    () => new Set((data?.rows ?? []).map((r) => r.faktur_id)),
    [data],
  );

  return { data, isLoading, fakturBermasalah, jumlah: data?.jumlah ?? 0 };
}

/** Kunci query-nya, supaya pemanggil bisa menyegarkan sesudah menghapuskan. */
export const KUNCI_ANOMALI = ["penerimaan-anomali"] as const;
