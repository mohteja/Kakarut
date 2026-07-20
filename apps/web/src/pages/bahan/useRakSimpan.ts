import { useQuery } from "@tanstack/react-query";
import type { PenyimpananDto } from "@kakarut/shared";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";

export interface RakOpsi {
  id: string;
  nama: string;
}

/**
 * Daftar RAK SIMPAN (home) untuk bahan baku — dipakai BERSAMA halaman Tambah &
 * Ubah agar pilihannya identik. Bahan disimpan/tiba di Central Kitchen, jadi
 * rak CK diutamakan; usaha 1 cabang (mode Lite, tanpa CK) → pakai rak cabang
 * store-nya supaya field lokasi tetap terpakai (bukan kosong).
 */
export function useRakSimpan(): RakOpsi[] {
  const { cabang } = useBranch();
  const ck = cabang.filter((b) => b.tipe === "central_kitchen" && b.is_active);
  const sumber = ck.length > 0 ? ck : cabang.filter((b) => b.tipe === "store" && b.is_active);
  const banyak = sumber.length > 1;
  const { data = [] } = useQuery({
    queryKey: ["penyimpanan-rak-simpan", sumber.map((c) => c.id).join(",")],
    enabled: sumber.length > 0,
    queryFn: async () => {
      const per = await Promise.all(
        sumber.map((b) =>
          api<PenyimpananDto[]>(`/penyimpanan?branch_id=${b.id}`).then((rows) =>
            rows.map((r) => ({ id: r.id, nama: banyak ? `${b.nama} · ${r.nama}` : r.nama })),
          ),
        ),
      );
      return per.flat() as RakOpsi[];
    },
  });
  return data;
}
