import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { LaporanHarian, LaporanPembelian, StokRowDto } from "@kakarut/shared";
import { Card, PageTitle, Spinner, StatusBadge, tdClass, thClass } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useBranch } from "../context/BranchContext";
import { api } from "../lib/api";
import { formatAngka, formatRupiah, formatTanggal, hariIniWIB } from "../lib/format";

function StatCard({ label, value, sub, warna = "text-stone-800" }: { label: string; value: string; sub?: string; warna?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${warna}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-400">{sub}</div>}
    </Card>
  );
}

/** Kartu "perlu perhatian": jumlah + tautan ke halaman terkait; menyala bila > 0. */
function AttnCard({ to, ikon, label, jumlah, satuan, aktif }: { to: string; ikon: string; label: string; jumlah: number; satuan: string; aktif: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm transition hover:shadow ${
        aktif ? "border-orange-300 bg-orange-50" : "border-stone-200 bg-white"
      }`}
    >
      <span className="text-2xl">{ikon}</span>
      <div className="min-w-0">
        <div className={`text-2xl font-bold ${aktif ? "text-orange-600" : "text-stone-700"}`}>
          {formatAngka(jumlah)} <span className="text-sm font-normal text-stone-400">{satuan}</span>
        </div>
        <div className="truncate text-sm text-stone-500">{label}</div>
      </div>
    </Link>
  );
}

/** Beranda ringkas owner/admin: kondisi toko hari ini dalam satu layar. */
export function DashboardPage() {
  const { auth } = useAuth();
  const { branchId, branchQuery, cabang } = useBranch();
  const hari = hariIniWIB();
  const branchParam = branchId ? `&branch_id=${branchId}` : "";
  const namaCabang = cabang.find((b) => b.id === branchId)?.nama;

  const { data: jual } = useQuery({
    queryKey: ["laporan", hari, hari, branchId],
    queryFn: () => api<LaporanHarian>(`/laporan?dari=${hari}&sampai=${hari}${branchParam}`),
  });
  const { data: beli } = useQuery({
    queryKey: ["laporan-pembelian", hari, hari, branchId],
    queryFn: () => api<LaporanPembelian>(`/laporan/pembelian?dari=${hari}&sampai=${hari}${branchParam}`),
  });
  const { data: stok } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  const { data: pen } = useQuery({
    queryKey: ["penerimaan", branchQuery],
    queryFn: () => api<{ rows: { status: string }[] }>(`/penerimaan${branchQuery}`),
    refetchInterval: 60_000,
  });

  const kritis = (stok ?? [])
    .filter((r) => r.status !== "aman")
    .sort((a, b) => (a.status === "habis" ? -1 : 1) - (b.status === "habis" ? -1 : 1) || a.saldo - b.saldo);
  const jumlahKritis = kritis.length;
  const jumlahBerjalan = (stok ?? []).filter((r) => r.produksi_berjalan != null).length;
  const jumlahMenunggu = (pen?.rows ?? []).filter((r) => r.status === "menunggu").length;

  const loading = !jual || !beli || !stok || !pen;

  return (
    <div>
      <PageTitle>Beranda</PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        {formatTanggal(hari)}
        {namaCabang ? ` · Cabang ${namaCabang}` : ""} · Halo, {auth?.user.nama} 👋
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {/* Hari ini */}
          <div>
            <h2 className="mb-2 text-lg font-semibold text-stone-700">Hari ini</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Penjualan"
                value={formatRupiah(jual.omzet)}
                sub={`${jual.jumlah_transaksi} transaksi`}
                warna="text-orange-600"
              />
              <StatCard label="Belanja bahan" value={formatRupiah(beli.total_pengeluaran)} />
              <StatCard
                label="Laba kotor (est.)"
                value={formatRupiah(jual.estimasi_profit)}
                sub="omzet − HPP terpakai"
                warna={jual.estimasi_profit >= 0 ? "text-green-600" : "text-red-600"}
              />
              <StatCard label="HPP terpakai" value={formatRupiah(jual.total_hpp)} />
            </div>
          </div>

          {/* Perlu perhatian */}
          <div>
            <h2 className="mb-2 text-lg font-semibold text-stone-700">Perlu perhatian</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <AttnCard
                to="/penerimaan"
                ikon="📥"
                label="Kiriman menunggu diterima"
                jumlah={jumlahMenunggu}
                satuan="kiriman"
                aktif={jumlahMenunggu > 0}
              />
              <AttnCard
                to="/stok"
                ikon="⚠️"
                label="Bahan menipis / habis"
                jumlah={jumlahKritis}
                satuan="bahan"
                aktif={jumlahKritis > 0}
              />
              <AttnCard
                to="/produksi"
                ikon="🏭"
                label="Produksi sedang berjalan"
                jumlah={jumlahBerjalan}
                satuan="bahan"
                aktif={jumlahBerjalan > 0}
              />
            </div>
          </div>

          {/* Daftar bahan menipis/habis */}
          {jumlahKritis > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-stone-700">Bahan yang perlu segera diisi</h2>
              <Card className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Saldo</th>
                      <th className={`${thClass} text-right`}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {kritis.slice(0, 8).map((r) => (
                      <tr key={r.ingredient_id}>
                        <td className={`${tdClass} font-medium`}>{r.nama}</td>
                        <td className={`${tdClass} text-right`}>
                          {formatAngka(r.saldo)} {r.satuan}
                        </td>
                        <td className={`${tdClass} text-right`}>
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {jumlahKritis > 8 && (
                  <div className="border-t border-stone-100 px-4 py-2 text-center text-sm">
                    <Link to="/stok" className="font-medium text-orange-600 hover:underline">
                      Lihat semua ({jumlahKritis}) di Stok →
                    </Link>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
