import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { LaporanPembelian } from "@kakarut/shared";
import { Card, PageTitle, Spinner, inputClass, tdClass, thClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggal, hariIniWIB } from "../../lib/format";
import { LaporanTabs } from "./LaporanTabs";

function StatCard({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warna}`}>{value}</div>
    </Card>
  );
}

/** Laporan pengeluaran pembelian bahan baku (faktur beli terkonfirmasi). */
export function LaporanPembelianPage() {
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [dari, setDari] = useState(hariIniWIB());
  const [sampai, setSampai] = useState(hariIniWIB());
  const [cabangFilter, setCabangFilter] = useState("all");

  const branchParam = isManajemen ? `&branch_id=${cabangFilter}` : "";

  const { data: lap, isLoading } = useQuery({
    queryKey: ["laporan-pembelian", dari, sampai, isManajemen ? cabangFilter : "self"],
    queryFn: () =>
      api<LaporanPembelian>(`/laporan/pembelian?dari=${dari}&sampai=${sampai}${branchParam}`),
  });

  return (
    <div>
      <PageTitle>Laporan</PageTitle>
      <LaporanTabs />
      <div className="mb-3 text-sm text-stone-500">
        {dari === sampai ? formatTanggal(dari) : `${formatTanggal(dari)} – ${formatTanggal(sampai)}`}
        {" · "}Hanya pembelian yang <b>sudah diterima</b> (terkonfirmasi) yang dihitung.
      </div>

      <Card className="mb-5 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Dari tanggal</label>
          <input
            type="date"
            value={dari}
            max={sampai}
            onChange={(e) => setDari(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Sampai tanggal</label>
          <input
            type="date"
            value={sampai}
            min={dari}
            onChange={(e) => setSampai(e.target.value)}
            className={inputClass}
          />
        </div>
        {isManajemen && cabang.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Cabang</label>
            <select
              value={cabangFilter}
              onChange={(e) => setCabangFilter(e.target.value)}
              className={inputClass}
            >
              <option value="all">Semua cabang</option>
              {cabang
                .filter((b) => b.is_active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nama}
                  </option>
                ))}
            </select>
          </div>
        )}
      </Card>

      {isLoading || !lap ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              label="Total Pengeluaran"
              value={formatRupiah(lap.total_pengeluaran)}
              warna="text-orange-600"
            />
            <StatCard label="Jumlah Faktur" value={String(lap.jumlah_faktur)} />
            <StatCard label="Jumlah Baris Bahan" value={String(lap.jumlah_item)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-lg font-semibold text-stone-700">Pengeluaran per Supplier</h2>
              <Card className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className={thClass}>Supplier</th>
                      <th className={`${thClass} text-right`}>Faktur</th>
                      <th className={`${thClass} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {lap.per_supplier.map((s) => (
                      <tr key={s.supplier ?? "—"}>
                        <td className={`${tdClass} font-medium`}>{s.supplier ?? "Tanpa supplier"}</td>
                        <td className={`${tdClass} text-right`}>{s.jumlah_faktur}</td>
                        <td className={`${tdClass} text-right`}>{formatRupiah(s.total)}</td>
                      </tr>
                    ))}
                    {lap.per_supplier.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-sm text-stone-400">
                          Belum ada pembelian pada rentang ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </div>

            <div>
              <h2 className="mb-2 text-lg font-semibold text-stone-700">Pengeluaran per Bahan</h2>
              <Card className="max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Qty</th>
                      <th className={`${thClass} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {lap.per_bahan.map((b) => (
                      <tr key={b.slug}>
                        <td className={tdClass}>{b.nama}</td>
                        <td className={`${tdClass} text-right`}>
                          {formatAngka(b.qty)} {b.satuan}
                        </td>
                        <td className={`${tdClass} text-right`}>{formatRupiah(b.total)}</td>
                      </tr>
                    ))}
                    {lap.per_bahan.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-sm text-stone-400">
                          Belum ada pembelian pada rentang ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
