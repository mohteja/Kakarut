import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { KartuStokDto, MutasiJenis } from "@kakarut/shared";
import { Card, PageTitle, Spinner, inputClass, tdClass, thClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";

const JENIS_BADGE: Record<MutasiJenis, { label: string; cls: string }> = {
  opname: { label: "Opname", cls: "bg-blue-100 text-blue-800" },
  beli: { label: "Pembelian", cls: "bg-teal-100 text-teal-800" },
  produksi: { label: "Produksi", cls: "bg-orange-100 text-orange-800" },
  penjualan: { label: "Penjualan", cls: "bg-red-100 text-red-700" },
};

function tanggal30HariLalu(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date(Date.now() - 29 * 24 * 3600 * 1000),
  );
}

function StatCard({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warna}`}>{value}</div>
    </Card>
  );
}

/**
 * Kartu stok: buku besar mutasi satu bahan — halaman terpisah dengan URL
 * sendiri (dibuka dari tombol "Kartu" di halaman Stok, bisa di tab lain).
 */
export function KartuStokPage() {
  const { ingredientId } = useParams();
  const [searchParams] = useSearchParams();
  const branchId = searchParams.get("branch_id");
  const [dari, setDari] = useState(tanggal30HariLalu());
  const [sampai, setSampai] = useState(hariIniWIB());

  const { data: kartu, isLoading, error } = useQuery({
    queryKey: ["kartu-stok", ingredientId, branchId, dari, sampai],
    queryFn: () =>
      api<KartuStokDto>(
        `/stok/kartu/${ingredientId}?dari=${dari}&sampai=${sampai}${branchId ? `&branch_id=${branchId}` : ""}`,
      ),
    enabled: Boolean(ingredientId),
  });

  if (isLoading) return <Spinner />;
  if (error || !kartu) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Kartu stok tidak dapat dimuat"}
      </div>
    );
  }

  const fmt = (n: number) => `${formatAngka(n)} ${kartu.bahan.satuan}`;

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <div className="flex items-center gap-2 print:hidden">
            <input
              type="date"
              value={dari}
              onChange={(e) => setDari(e.target.value)}
              className={inputClass}
              aria-label="Dari tanggal"
            />
            <span className="text-stone-400">s/d</span>
            <input
              type="date"
              value={sampai}
              onChange={(e) => setSampai(e.target.value)}
              className={inputClass}
              aria-label="Sampai tanggal"
            />
          </div>
        }
      >
        Kartu Stok — {kartu.bahan.nama}
      </PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        {formatTanggal(kartu.periode.dari)} — {formatTanggal(kartu.periode.sampai)}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Saldo Awal" value={fmt(kartu.saldo_awal)} />
        <StatCard label="Total Masuk" value={`+${fmt(kartu.total_masuk)}`} warna="text-green-600" />
        <StatCard label="Total Keluar" value={`−${fmt(kartu.total_keluar)}`} warna="text-red-600" />
        <StatCard label="Saldo Akhir" value={fmt(kartu.saldo_akhir)} warna="text-orange-600" />
      </div>

      {kartu.terpotong && (
        <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          Mutasi melebihi 500 baris — persempit rentang tanggal untuk melihat semuanya.
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Waktu</th>
              <th className={thClass}>Jenis</th>
              <th className={thClass}>Keterangan</th>
              <th className={`${thClass} text-right`}>Masuk</th>
              <th className={`${thClass} text-right`}>Keluar</th>
              <th className={`${thClass} text-right`}>Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <tr className="bg-stone-50/60">
              <td className={tdClass} colSpan={5}>
                <span className="font-medium text-stone-500">Saldo awal periode</span>
              </td>
              <td className={`${tdClass} text-right font-bold`}>{formatAngka(kartu.saldo_awal)}</td>
            </tr>
            {kartu.mutasi.map((m, i) => {
              const badge = JENIS_BADGE[m.jenis];
              return (
                <tr key={i} className="hover:bg-stone-50">
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {new Intl.DateTimeFormat("id-ID", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    }).format(new Date(m.waktu))}
                  </td>
                  <td className={tdClass}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className={`${tdClass} max-w-72 truncate text-stone-500`} title={m.keterangan ?? ""}>
                    {m.keterangan ?? "—"}
                  </td>
                  <td className={`${tdClass} text-right text-green-700`}>
                    {m.masuk != null ? `+${formatAngka(m.masuk)}` : ""}
                    {m.jenis === "opname" && (
                      <span className="text-xs text-blue-600">reset → {formatAngka(m.saldo)}</span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right text-red-600`}>
                    {m.keluar != null ? `−${formatAngka(m.keluar)}` : ""}
                  </td>
                  <td className={`${tdClass} text-right font-bold`}>{formatAngka(m.saldo)}</td>
                </tr>
              );
            })}
            {kartu.mutasi.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-stone-400">
                  Tidak ada mutasi pada periode ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
