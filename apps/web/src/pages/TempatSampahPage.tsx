import { useQuery } from "@tanstack/react-query";
import type { SampahRow } from "@kakarut/shared";
import { Card, PageTitle, Spinner, tdClass, thClass } from "../components/ui";
import { api } from "../lib/api";
import { formatRupiah, formatWaktu } from "../lib/format";

const JENIS: Record<SampahRow["jenis"], { label: string; cls: string }> = {
  penjualan: { label: "Penjualan", cls: "bg-orange-100 text-orange-700" },
  pembelian: { label: "Pembelian", cls: "bg-blue-100 text-blue-700" },
  produksi: { label: "Produksi", cls: "bg-purple-100 text-purple-700" },
};

/** Tempat Sampah: transaksi yang dihapus (hanya catatan, tidak bisa dikembalikan). */
export function TempatSampahPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["sampah"],
    queryFn: () => api<SampahRow[]>("/sampah"),
  });
  const list = data ?? [];

  return (
    <div className="max-w-5xl">
      <PageTitle>Tempat Sampah</PageTitle>
      <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
        Transaksi yang dihapus disimpan di sini sebagai <b>catatan siapa yang menghapus</b>. Stok
        sudah dikoreksi saat dihapus. <b>Tidak bisa dikembalikan.</b>
      </div>

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
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
