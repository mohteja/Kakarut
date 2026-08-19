import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { LaporanDurasiPesanan } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatDurasi, formatTanggal, formatWaktu, hariIniWIB } from "../../lib/format";
import { LaporanTabs } from "./LaporanTabs";

/**
 * LAMA PENGERJAAN PESANAN — rata-rata per menu + riwayat penyelesaiannya.
 *
 * Angka yang ditampilkan hanya berasal dari sajian yang BENAR-BENAR ditandai
 * selesai. Sajian yang batal, yang masih dikerjakan, dan yang tak pernah
 * ditandai tidak ikut dihitung — menghitungnya sebagai nol akan membuat shift
 * yang paling lalai mencatat terlihat paling cepat.
 */
export function LaporanDurasiPesananPage() {
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [dari, setDari] = useState(hariIniWIB());
  const [sampai, setSampai] = useState(hariIniWIB());
  const [cabangFilter, setCabangFilter] = useState("all");

  const branchParam = isManajemen ? `&branch_id=${cabangFilter}` : "";
  const {
    data: lap,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["laporan", "durasi-pesanan", dari, sampai, isManajemen ? cabangFilter : "self"],
    queryFn: () =>
      api<LaporanDurasiPesanan>(
        `/laporan/durasi-pesanan?dari=${dari}&sampai=${sampai}${branchParam}`,
      ),
  });

  return (
    <div>
      <PageTitle>Laporan</PageTitle>
      <LaporanTabs />
      <div className="mb-3 text-sm text-stone-500">
        {dari === sampai ? formatTanggal(dari) : `${formatTanggal(dari)} – ${formatTanggal(sampai)}`}
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

      {/*
        MENUNGGU vs GAGAL dipisah. `isLoading || !lap` menyatukan keduanya, jadi
        permintaan yang ditolak membuat `lap` tetap `undefined` dan halaman
        berputar selamanya — TanStack sudah berhenti mencoba, layarnya tak
        pernah mengatakannya.
      */}
      {isLoading ? (
        <Spinner />
      ) : error || !lap ? (
        <Card className="p-4">
          <ErrorText error={error ?? new Error("Laporan tidak dapat dimuat")} />
        </Card>
      ) : lap.jumlah === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-500">
          Belum ada sajian yang ditandai selesai pada rentang ini.
          <div className="mt-1 text-xs text-stone-400">
            Angka di sini hanya dihitung dari sajian yang ditandai selesai di Papan Pesanan.
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <div className="text-xs font-medium text-stone-500">Rata-rata seluruh sajian</div>
              <div className="mt-1 text-2xl font-bold text-stone-800">
                ⏱ {formatDurasi(lap.rata_detik)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium text-stone-500">Sajian terhitung</div>
              <div className="mt-1 text-2xl font-bold text-stone-800">{lap.jumlah}</div>
              <div className="mt-1 text-xs text-stone-400">
                hanya yang ditandai selesai — batal &amp; belum selesai tidak ikut
              </div>
            </Card>
          </div>

          <Card className="mb-5 p-0">
            <div className="border-b border-stone-200 px-4 py-3">
              <h2 className="font-semibold text-stone-800">Per menu</h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Median ikut ditampilkan karena rata-rata sendirian menyesatkan: satu sajian yang
                lupa ditandai sampai tutup toko menarik rata-rata naik berjam-jam, sementara median
                tetap menggambarkan hari yang sebenarnya. Bila keduanya berjauhan, yang salah
                biasanya pencatatannya — bukan dapurnya.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                    <th className="px-4 py-2 font-medium">Menu</th>
                    <th className="px-4 py-2 text-right font-medium">Porsi</th>
                    <th className="px-4 py-2 text-right font-medium">Rata-rata</th>
                    <th className="px-4 py-2 text-right font-medium">Median</th>
                    <th className="px-4 py-2 text-right font-medium">Tercepat</th>
                    <th className="px-4 py-2 text-right font-medium">Terlama</th>
                  </tr>
                </thead>
                <tbody>
                  {lap.per_menu.map((m) => (
                    <tr key={m.menu_nama} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-2 font-medium text-stone-800">{m.menu_nama}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-stone-600">
                        {m.jumlah}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-stone-800">
                        {formatDurasi(m.rata_detik)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-stone-600">
                        {formatDurasi(m.median_detik)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                        {formatDurasi(m.tercepat_detik)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-orange-700">
                        {formatDurasi(m.terlama_detik)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-0">
            <div className="border-b border-stone-200 px-4 py-3">
              <h2 className="font-semibold text-stone-800">Riwayat penyelesaian</h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Terbaru lebih dulu, dibatasi 200 baris terakhir.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                    <th className="px-4 py-2 font-medium">Waktu</th>
                    <th className="px-4 py-2 font-medium">Nota</th>
                    <th className="px-4 py-2 font-medium">Menu</th>
                    <th className="px-4 py-2 font-medium">Diselesaikan oleh</th>
                    <th className="px-4 py-2 text-right font-medium">Lama</th>
                  </tr>
                </thead>
                <tbody>
                  {lap.riwayat.map((r, i) => (
                    <tr
                      key={`${r.nomor}-${r.selesai_pada}-${i}`}
                      className="border-b border-stone-100 last:border-0"
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-stone-600">
                        {formatWaktu(r.selesai_pada)}
                      </td>
                      <td className="px-4 py-2 text-stone-600">{r.nomor ?? "—"}</td>
                      <td className="px-4 py-2 font-medium text-stone-800">{r.menu_nama}</td>
                      {/* Nama boleh kosong: baris lama, atau akun yang sudah
                          dihapus. Ditulis "—", bukan barisnya dihilangkan —
                          riwayat yang menyembunyikan barisnya sendiri lebih
                          buruk daripada riwayat tanpa nama. */}
                      <td className="px-4 py-2 text-stone-600">{r.oleh ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-stone-800">
                        {formatDurasi(r.durasi_detik)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
