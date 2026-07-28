import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { LaporanHarian } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggal, hariIniWIB } from "../../lib/format";
import { LaporanTabs } from "./LaporanTabs";

const METODE_LABEL: Record<string, string> = {
  tunai: "💵 Tunai",
  qris: "📱 QRIS",
  transfer: "🏦 Transfer",
};

interface BepResult {
  biaya_tetap: number;
  basis: "penjualan" | "katalog";
  rata_harga_jual: number;
  rata_margin_kontribusi: number;
  porsi_untuk_bep: number;
  omzet_untuk_bep: number;
  porsi_per_hari_30: number;
}

function StatCard({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warna}`}>{value}</div>
    </Card>
  );
}

export function LaporanPage() {
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [dari, setDari] = useState(hariIniWIB());
  const [sampai, setSampai] = useState(hariIniWIB());
  // "all" = semua cabang (gabungan); atau id cabang tertentu. Hanya owner/admin.
  const [cabangFilter, setCabangFilter] = useState("all");
  const [biayaTetap, setBiayaTetap] = useState("");
  const [bep, setBep] = useState<BepResult | null>(null);
  const [bepError, setBepError] = useState<unknown>(null);

  // Owner/admin memilih cabang lewat filter halaman; kasir dikunci server ke cabangnya.
  const branchParam = isManajemen ? `&branch_id=${cabangFilter}` : "";

  const { data: lap, isLoading } = useQuery({
    queryKey: ["laporan", dari, sampai, isManajemen ? cabangFilter : "self"],
    queryFn: () =>
      api<LaporanHarian>(`/laporan?dari=${dari}&sampai=${sampai}${branchParam}`),
  });

  async function hitungBep() {
    setBepError(null);
    try {
      setBep(
        await api<BepResult>(`/laporan/bep?biaya_tetap=${Number(biayaTetap)}${branchParam}`),
      );
    } catch (e) {
      setBep(null);
      setBepError(e);
    }
  }

  return (
    <div>
      <PageTitle>Laporan</PageTitle>
      <LaporanTabs />
      <div className="mb-3 text-sm text-stone-500">
        {dari === sampai
          ? formatTanggal(dari)
          : `${formatTanggal(dari)} – ${formatTanggal(sampai)}`}
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
            <StatCard label="Omzet" value={formatRupiah(lap.omzet)} warna="text-orange-600" />
            <StatCard label="Transaksi" value={String(lap.jumlah_transaksi)} />
            <StatCard
              label="Diskon Diberikan"
              value={formatRupiah(lap.total_diskon)}
              warna={lap.total_diskon > 0 ? "text-red-600" : "text-stone-800"}
            />
            <StatCard label="HPP Terpakai" value={formatRupiah(lap.total_hpp)} />
            <StatCard
              label="Estimasi Profit"
              value={formatRupiah(lap.estimasi_profit)}
              warna={lap.estimasi_profit >= 0 ? "text-green-600" : "text-red-600"}
            />
            <StatCard label="PB1 Terkumpul" value={formatRupiah(lap.pb1_terkumpul)} />
          </div>
          {/* Dari mana angka HPP ini datang — supaya tak dikira mengikuti setelan
              Metode HPP (yang hanya berlaku untuk kartu persediaan per bahan). */}
          <p className="-mt-4 mb-6 text-xs text-stone-500">
            <b>HPP Terpakai</b> dijumlahkan dari biaya yang dikunci di tiap transaksi saat
            pembayaran, dihitung dari <b>resep menu × harga acuan bahan</b> saat itu — bukan dari
            harga lot stok, dan tidak terpengaruh setelan Metode biaya persediaan.
          </p>

          {lap.per_metode.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-lg font-semibold text-stone-700">Metode Pembayaran</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {lap.per_metode.map((m) => (
                  <Card key={m.metode} className="p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      {METODE_LABEL[m.metode] ?? m.metode}
                    </div>
                    <div className="mt-1 text-xl font-bold text-stone-800">
                      {formatRupiah(m.total)}
                    </div>
                    <div className="text-xs text-stone-400">{m.jumlah} transaksi</div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-lg font-semibold text-stone-700">Item Terjual</h2>
              <Card className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className={thClass}>Menu</th>
                      <th className={`${thClass} text-right`}>Qty</th>
                      <th className={`${thClass} text-right`}>Omzet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {lap.item_terjual.map((it) => (
                      <tr key={it.menu_nama}>
                        <td className={`${tdClass} font-medium`}>{it.menu_nama}</td>
                        <td className={`${tdClass} text-right`}>{formatAngka(it.qty)}</td>
                        <td className={`${tdClass} text-right`}>{formatRupiah(it.omzet)}</td>
                      </tr>
                    ))}
                    {lap.item_terjual.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-sm text-stone-400">
                          Belum ada penjualan.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </div>

            <div>
              <h2 className="mb-2 text-lg font-semibold text-stone-700">Konsumsi Bahan</h2>
              <Card className="max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Terpakai</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {lap.konsumsi_bahan.map((k) => (
                      <tr key={k.slug}>
                        <td className={tdClass}>{k.nama}</td>
                        <td className={`${tdClass} text-right`}>{formatAngka(k.qty)}</td>
                      </tr>
                    ))}
                    {lap.konsumsi_bahan.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-8 text-center text-sm text-stone-400">
                          Belum ada konsumsi bahan.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="mb-2 text-lg font-semibold text-stone-700">
              Kalkulator BEP (Break-Even Point)
            </h2>
            <Card className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Biaya tetap per bulan (Rp)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={biayaTetap}
                    onChange={(e) => setBiayaTetap(e.target.value)}
                    className={inputClass}
                    placeholder="mis. 15000000"
                  />
                </div>
                <button onClick={hitungBep} disabled={!biayaTetap} className={btnPrimary}>
                  Hitung
                </button>
              </div>
              <ErrorText error={bepError} />
              {bep && (
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                  <div>
                    <div className="text-stone-500">Rata-rata margin/porsi</div>
                    <div className="font-bold">{formatRupiah(bep.rata_margin_kontribusi)}</div>
                  </div>
                  <div>
                    <div className="text-stone-500">Porsi untuk BEP</div>
                    <div className="font-bold">{formatAngka(bep.porsi_untuk_bep)} porsi</div>
                  </div>
                  <div>
                    <div className="text-stone-500">Omzet untuk BEP</div>
                    <div className="font-bold">{formatRupiah(bep.omzet_untuk_bep)}</div>
                  </div>
                  <div>
                    <div className="text-stone-500">≈ Porsi per hari (30 hari)</div>
                    <div className="font-bold">{formatAngka(bep.porsi_per_hari_30)} porsi</div>
                  </div>
                  <div className="col-span-full text-xs text-stone-400">
                    Basis perhitungan: {bep.basis === "penjualan" ? "riwayat penjualan 30 hari" : "rata-rata katalog menu"}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
