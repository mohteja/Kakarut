import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BahanDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatWaktu, hariIniWIB } from "../../lib/format";

interface ProduksiRow {
  id: string;
  bahan: string;
  qty: number;
  is_batch: boolean;
  catatan: string | null;
  waktu: string;
}

export function ProduksiPage() {
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();

  const { data: bahan } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });

  const today = hariIniWIB();
  const { data: log, isLoading } = useQuery({
    queryKey: ["produksi", today, branchQuery],
    queryFn: () =>
      api<ProduksiRow[]>(
        `/produksi${branchQuery ? `${branchQuery}&` : "?"}tanggal=${today}`,
      ),
  });

  const [bahanId, setBahanId] = useState("");
  const [qty, setQty] = useState("");

  const dipilih = bahan?.find((b) => b.id === bahanId);

  const tambah = useMutation({
    mutationFn: (opts: { batch: boolean }) =>
      api("/produksi", {
        method: "POST",
        body: {
          ...(branchId ? { branch_id: branchId } : {}),
          ingredient_id: bahanId,
          ...(opts.batch ? { batch: true } : { qty: Number(qty) }),
        },
      }),
    onSuccess: () => {
      setQty("");
      queryClient.invalidateQueries({ queryKey: ["produksi"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  return (
    <div>
      <PageTitle>Produksi / Tambah Stok</PageTitle>

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-sm font-medium">Bahan</label>
            <select
              value={bahanId}
              onChange={(e) => setBahanId(e.target.value)}
              className={inputClass}
            >
              <option value="">— pilih bahan —</option>
              {(bahan ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama} (isi/batch: {formatAngka(b.isi)})
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="mb-1 block text-sm font-medium">Qty</label>
            <input
              type="number"
              min="0.01"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={inputClass}
              placeholder="jumlah"
            />
          </div>
          <button
            onClick={() => tambah.mutate({ batch: false })}
            disabled={!bahanId || !qty || tambah.isPending}
            className={btnPrimary}
          >
            + Tambah
          </button>
          <button
            onClick={() => tambah.mutate({ batch: true })}
            disabled={!bahanId || tambah.isPending}
            className={btnSecondary}
            title="Menambah stok sebanyak 'isi' bahan (1 batch produksi)"
          >
            +1 Batch{dipilih ? ` (${formatAngka(dipilih.isi)})` : ""}
          </button>
        </div>
        <div className="mt-2">
          <ErrorText error={tambah.error} />
        </div>
      </Card>

      <h2 className="mb-2 text-lg font-semibold text-stone-700">Produksi hari ini</h2>
      {isLoading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={thClass}>Waktu</th>
                <th className={thClass}>Bahan</th>
                <th className={`${thClass} text-right`}>Qty</th>
                <th className={thClass}>Batch?</th>
                <th className={thClass}>Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(log ?? []).map((r) => (
                <tr key={r.id}>
                  <td className={tdClass}>{formatWaktu(r.waktu)}</td>
                  <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                  <td className={`${tdClass} text-right`}>+{formatAngka(r.qty)}</td>
                  <td className={tdClass}>{r.is_batch ? "1 batch" : "manual"}</td>
                  <td className={`${tdClass} text-stone-400`}>{r.catatan}</td>
                </tr>
              ))}
              {(log ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-stone-400">
                    Belum ada produksi hari ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
