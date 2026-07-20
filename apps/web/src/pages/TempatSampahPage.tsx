import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SampahRow } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  tdClass,
  thClass,
} from "../components/ui";
import { api } from "../lib/api";
import { formatRupiah, formatWaktu } from "../lib/format";

const JENIS: Record<SampahRow["jenis"], { label: string; cls: string }> = {
  penjualan: { label: "Penjualan", cls: "bg-orange-100 text-orange-700" },
  pembelian: { label: "Pembelian", cls: "bg-blue-100 text-blue-700" },
  produksi: { label: "Produksi", cls: "bg-purple-100 text-purple-700" },
};

/** Tempat Sampah: transaksi yang di-soft-delete — bisa DIPULIHKAN kembali. */
export function TempatSampahPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["sampah"],
    queryFn: () => api<SampahRow[]>("/sampah"),
  });
  const list = data ?? [];
  const [konfirmasiKosong, setKonfirmasiKosong] = useState(false);

  const pulihkan = useMutation({
    mutationFn: (r: SampahRow) =>
      api("/sampah/pulihkan", { method: "POST", body: { jenis: r.jenis, key: r.key } }),
    onSuccess: () => {
      // stok/laporan/daftar transaksi langsung terhitung lagi
      for (const key of ["sampah", "stok", "laporan", "penjualan", "/pembelian", "/produksi", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const kosongkan = useMutation({
    mutationFn: () => api<{ ok: true; penjualan: number; faktur: number }>("/sampah/kosongkan", { method: "POST" }),
    onSuccess: () => {
      setKonfirmasiKosong(false);
      queryClient.invalidateQueries({ queryKey: ["sampah"] });
    },
  });

  return (
    <div className="max-w-5xl">
      <PageTitle
        aksi={
          list.length > 0 ? (
            <button
              onClick={() => setKonfirmasiKosong(true)}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              🗑 Kosongkan Tempat Sampah
            </button>
          ) : undefined
        }
      >
        Tempat Sampah
      </PageTitle>
      <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
        Transaksi yang dihapus disimpan di sini (soft delete) — stok & laporan sudah
        dikoreksi. Salah hapus? Tekan <b>♻ Pulihkan</b> untuk mengembalikannya.
      </div>
      <ErrorText error={pulihkan.error} />

      {isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">Tempat sampah kosong.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={thClass}>Jenis</th>
                <th className={thClass}>Ringkasan</th>
                <th className={thClass}>Waktu</th>
                <th className={thClass}>Dibuat oleh</th>
                <th className={thClass}>Dihapus oleh</th>
                <th className={thClass}>Dihapus pada</th>
                <th className={`${thClass} text-right`}>Total</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {list.map((r) => (
                <tr key={`${r.jenis}-${r.key}`}>
                  <td className={tdClass}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${JENIS[r.jenis].cls}`}
                    >
                      {JENIS[r.jenis].label}
                    </span>
                  </td>
                  <td className={`${tdClass} max-w-xs truncate font-medium`}>{r.label}</td>
                  <td className={tdClass}>{formatWaktu(r.waktu)}</td>
                  <td className={tdClass}>{r.dibuat_oleh ?? "—"}</td>
                  <td className={`${tdClass} font-medium text-red-600`}>{r.dihapus_oleh ?? "—"}</td>
                  <td className={tdClass}>{formatWaktu(r.dihapus_pada)}</td>
                  <td className={`${tdClass} text-right`}>
                    {r.total > 0 ? formatRupiah(r.total) : "—"}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Pulihkan ${JENIS[r.jenis].label.toLowerCase()} "${r.label}"? Stok & laporan akan terhitung kembali.`,
                          )
                        )
                          pulihkan.mutate(r);
                      }}
                      disabled={pulihkan.isPending}
                      className="text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50"
                    >
                      ♻ Pulihkan
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {konfirmasiKosong && (
        <Modal
          open
          onClose={() => setKonfirmasiKosong(false)}
          title="🗑 Kosongkan Tempat Sampah?"
          lebar="max-w-md"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <b>{list.length} transaksi</b> di tempat sampah akan <b>DIHAPUS PERMANEN</b> dan
              <b> tidak bisa dipulihkan lagi</b>. Stok &amp; laporan tidak terpengaruh (transaksi ini
              memang sudah dihapus).
            </div>
            <ErrorText error={kosongkan.error} />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setKonfirmasiKosong(false)}
                disabled={kosongkan.isPending}
                className={btnSecondary}
              >
                Batal
              </button>
              <button
                onClick={() => kosongkan.mutate()}
                disabled={kosongkan.isPending}
                className={`${btnPrimary} !bg-red-600 hover:!bg-red-700`}
              >
                {kosongkan.isPending ? "Menghapus…" : "Ya, Hapus Permanen"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
