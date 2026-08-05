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

  const { data: lap, isLoading, error } = useQuery({
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
              /*
               * HASIL BEP IKUT DIBUANG saat cabangnya berganti.
               *
               * `/laporan/bep` disaring `branchCondLaporan`, jadi jawabannya
               * BEDA per cabang. Tapi hasilnya tinggal di state biasa, bukan di
               * useQuery yang kuncinya memuat `cabangFilter` seperti laporan di
               * atasnya. Tanpa pembuangan ini, mengganti cabang menyegarkan
               * seluruh laporan sementara kartu BEP tetap memajang angka cabang
               * SEBELUMNYA — di bawah judul yang sekarang menyebut cabang lain,
               * tanpa satu pun tanda bahwa keduanya bukan sepasang.
               *
               * Yang dipertaruhkan bukan tampilan: BEP dipakai owner untuk
               * memutuskan harga jual, dan komentar pada kotak biaya tetap di
               * bawah menyebutnya sendiri — "salah di sini menyesatkan
               * keputusan". Kartu yang kosong dan menunggu ditekan "Hitung"
               * jauh lebih baik daripada angka yang benar untuk cabang yang
               * salah.
               *
               * Rentang tanggal SENGAJA tidak ikut membuang: `/laporan/bep`
               * tak menerima tanggal sama sekali — ia memakai jendela 30 harinya
               * sendiri di server — jadi mengganti tanggal tidak membuat
               * hasilnya basi.
               */
              onChange={(e) => {
                setCabangFilter(e.target.value);
                setBep(null);
                setBepError(null);
              }}
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

      {/*
        MENUNGGU vs GAGAL. `isLoading || !lap` menyatukan keduanya, jadi
        permintaan yang ditolak membuat `lap` tetap `undefined` dan halaman
        berputar selamanya — TanStack sudah berhenti mencoba, layarnya tak
        pernah mengatakannya.
      */}
      {isLoading ? (
        <Spinner />
      ) : error || !lap ? (
        <Card className="p-4">
          <ErrorText error={error ?? new Error("Laporan tidak dapat dimuat")} />
          <div className="mt-2 text-sm text-stone-500">
            Angkanya tidak ditampilkan karena datanya gagal dimuat — <b>bukan</b> berarti nol.
          </div>
        </Card>
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
                    /* Rupiah, pola rumah: digit murni di state, berkelompok di
                       layar. BEP dipakai owner untuk memutuskan harga — salah
                       1000× di sini menyesatkan keputusan, bukan cuma tampilan. */
                    type="text"
                    inputMode="numeric"
                    value={biayaTetap ? formatAngka(Number(biayaTetap), 0) : ""}
                    onChange={(e) => setBiayaTetap(e.target.value.replace(/\D/g, ""))}
                    className={inputClass}
                    placeholder="mis. 15.000.000"
                  />
                </div>
                <button onClick={hitungBep} disabled={!biayaTetap} className={btnPrimary}>
                  Hitung
                </button>
                {/* Sebab kartunya bisa mendadak kosong — tanpa kalimat ini,
                    hilangnya angka sesudah ganti cabang terbaca seperti
                    kerusakan, bukan seperti penolakan menampilkan angka cabang
                    yang keliru. */}
                {isManajemen && (
                  <span className="text-xs text-stone-400">
                    Mengikuti filter <b>Cabang</b> di atas — ganti cabang, hitung ulang.
                  </span>
                )}
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
