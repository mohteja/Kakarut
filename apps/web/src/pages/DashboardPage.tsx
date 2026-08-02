import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { LaporanHarian, LaporanPembelian, MenuLaris, StokRowDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, StatusBadge, tdClass, thClass } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { labelCabang, useBranch } from "../context/BranchContext";
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

/**
 * Kartu "perlu perhatian": jumlah + tautan ke halaman terkait; menyala bila
 * > 0. to=null → kartu info saja (halamannya di luar divisi lokasi saat ini).
 */
function AttnCard({ to, ikon, label, jumlah, satuan, aktif }: { to: string | null; ikon: string; label: string; jumlah: number; satuan: string; aktif: boolean }) {
  const kelas = `flex items-center gap-3 rounded-xl border p-4 shadow-sm transition ${
    aktif ? "border-orange-300 bg-orange-50" : "border-stone-200 bg-white"
  }`;
  const isi = (
    <>
      <span className="text-2xl">{ikon}</span>
      <div className="min-w-0">
        <div className={`text-2xl font-bold ${aktif ? "text-orange-600" : "text-stone-700"}`}>
          {formatAngka(jumlah)} <span className="text-sm font-normal text-stone-400">{satuan}</span>
        </div>
        <div className="truncate text-sm text-stone-500">{label}</div>
      </div>
    </>
  );
  if (!to) return <div className={kelas}>{isi}</div>;
  return (
    <Link to={to} className={`${kelas} hover:shadow`}>
      {isi}
    </Link>
  );
}

/** Beranda ringkas owner/admin: kondisi toko hari ini dalam satu layar. */
export function DashboardPage() {
  const { auth } = useAuth();
  const { branchId, cabang, divisi } = useBranch();
  const hari = hariIniWIB();

  // Kantor = pusat data: pilih mau melihat cabang mana (atau semua lokasi
  // sekaligus). Di divisi store/CK beranda terkunci ke lokasi terpilih.
  const dariKantor = divisi === "kantor";
  const [lihatPilihan, setLihat] = useState<string>("all");
  const lokasiData = cabang.filter((b) => b.is_active && b.tipe !== "kantor");
  // Chip yang menunjuk cabang yang keburu dinonaktifkan → kembali ke "Semua"
  const lihat =
    lihatPilihan === "all" || lokasiData.some((b) => b.id === lihatPilihan)
      ? lihatPilihan
      : "all";
  const branchParam = dariKantor
    ? `&branch_id=${lihat}` // "all" = gabungan seluruh cabang (didukung /laporan)
    : branchId
      ? `&branch_id=${branchId}`
      : "";
  const kunciLihat = dariKantor ? lihat : branchId;
  const namaCabang = dariKantor
    ? lihat === "all"
      ? "Semua lokasi"
      : (cabang.find((b) => b.id === lihat)?.nama ?? "")
    : cabang.find((b) => b.id === branchId)?.nama;

  const { data: jual, error: eJual } = useQuery({
    queryKey: ["laporan", hari, hari, kunciLihat],
    queryFn: () => api<LaporanHarian>(`/laporan?dari=${hari}&sampai=${hari}${branchParam}`),
  });
  const { data: beli, error: eBeli } = useQuery({
    queryKey: ["laporan-pembelian", hari, hari, kunciLihat],
    queryFn: () => api<LaporanPembelian>(`/laporan/pembelian?dari=${hari}&sampai=${hari}${branchParam}`),
  });
  const { data: laris, error: eLaris } = useQuery({
    queryKey: ["menu-laris", hari, hari, kunciLihat],
    queryFn: () => api<MenuLaris>(`/laporan/menu-laris?dari=${hari}&sampai=${hari}${branchParam}`),
  });

  // Stok & kiriman bersifat fisik per cabang (server tidak menggabungkan) —
  // dari Kantor "Semua lokasi" diagregasi dengan satu query per cabang.
  // "Semua lokasi" ikut menghitung kantor: kiriman/faktur lama yang terlanjur
  // tercatat di kantor tetap terlihat (laporan branch_id=all juga gabungan).
  const target = dariKantor
    ? lihat === "all"
      ? cabang.filter((b) => b.is_active)
      : lokasiData.filter((b) => b.id === lihat)
    : cabang.filter((b) => b.id === branchId);
  const stokQs = useQueries({
    queries: target.map((t) => ({
      queryKey: ["stok", `?branch_id=${t.id}`],
      queryFn: () => api<StokRowDto[]>(`/stok?branch_id=${t.id}`),
    })),
  });
  const penQs = useQueries({
    queries: target.map((t) => ({
      queryKey: ["penerimaan", `?branch_id=${t.id}`],
      queryFn: () => api<{ rows: { status: string }[] }>(`/penerimaan?branch_id=${t.id}`),
      refetchInterval: 60_000,
    })),
  });

  const lintasLokasi = target.length > 1;
  const kritis = target
    .flatMap((t, i) =>
      (stokQs[i]?.data ?? [])
        .filter((r) => r.status !== "aman")
        .map((r) => ({ ...r, lokasi: t.nama })),
    )
    .sort(
      (a, b) =>
        (a.status === "habis" ? -1 : 1) - (b.status === "habis" ? -1 : 1) || a.saldo - b.saldo,
    );
  const jumlahKritis = kritis.length;
  const jumlahBerjalan = stokQs.reduce(
    (n, q) => n + (q.data ?? []).filter((r) => r.produksi_berjalan != null).length,
    0,
  );
  const jumlahMenunggu = penQs.reduce(
    (n, q) => n + (q.data?.rows ?? []).filter((r) => r.status === "menunggu").length,
    0,
  );

  /*
   * MENUNGGU vs GAGAL — dulu keduanya satu kondisi.
   *
   * `loading` diturunkan dari ADA-TIDAKNYA data, jadi query yang galat membuat
   * `data` tetap `undefined` selamanya dan Beranda tersangkut di "Memuat…"
   * tanpa ujung: TanStack sudah berhenti mencoba, tapi layar tak pernah
   * mengatakannya. Ini halaman pertama sesudah login — menggantung di situ
   * terbaca seperti aplikasinya rusak, bukan seperti satu permintaan ditolak.
   */
  const galat =
    eJual ?? eBeli ?? eLaris ?? stokQs.find((q) => q.error)?.error ?? penQs.find((q) => q.error)?.error;
  const loading = !jual || !beli || stokQs.some((q) => !q.data) || penQs.some((q) => !q.data);

  return (
    <div>
      <PageTitle>Beranda</PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        {formatTanggal(hari)}
        {namaCabang ? ` · ${namaCabang}` : ""} · Halo, {auth?.user.nama} 👋
      </div>

      {/* Dari Kantor: pilih cabang yang dilihat (penjualan, stok, kiriman) */}
      {dariKantor && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setLihat("all")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              lihat === "all"
                ? "bg-orange-600 text-white"
                : "bg-white text-stone-600 hover:bg-stone-100"
            }`}
          >
            🏢 Semua lokasi
          </button>
          {lokasiData.map((b) => (
            <button
              key={b.id}
              onClick={() => setLihat(b.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                lihat === b.id
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-100"
              }`}
            >
              {labelCabang(b)}
            </button>
          ))}
        </div>
      )}

      {galat ? (
        <Card className="p-4">
          <ErrorText error={galat} />
          <div className="mt-2 text-sm text-stone-500">
            Sebagian data beranda tidak bisa dimuat, jadi angka hari ini dan peringatan stok tidak
            ditampilkan — <b>bukan</b> berarti nol. Muat ulang halaman setelah masalahnya beres.
          </div>
        </Card>
      ) : loading ? (
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

          {/* Menu terlaris hari ini */}
          {laris && laris.items.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-stone-700">🔥 Menu terlaris hari ini</h2>
                {/* Laporan hanya dibuka dari Kantor — divisi store tak punya nav-nya */}
                {divisi !== "store" && (
                  <Link to="/laporan/menu-laris" className="text-sm font-medium text-orange-600 hover:underline">
                    Lihat semua →
                  </Link>
                )}
              </div>
              <Card className="divide-y divide-stone-100">
                {laris.items.slice(0, 5).map((m, i) => (
                  <div key={m.menu_id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-6 shrink-0 text-center text-lg font-bold text-stone-400">
                      {i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}
                    </div>
                    <div className="min-w-0 flex-1 truncate font-medium text-stone-800">{m.nama}</div>
                    <div className="shrink-0 text-right text-sm">
                      <span className="font-bold text-stone-800">{formatAngka(m.qty)} porsi</span>
                      <span className="ml-2 text-orange-600">{formatRupiah(m.omzet)}</span>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}

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
                to={divisi === "store" ? null : "/produksi"}
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
                      {lintasLokasi && <th className={thClass}>Lokasi</th>}
                      <th className={`${thClass} text-right`}>Saldo</th>
                      <th className={`${thClass} text-right`}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {kritis.slice(0, 8).map((r) => (
                      <tr key={`${r.ingredient_id}-${r.lokasi}`}>
                        <td className={`${tdClass} font-medium`}>{r.nama}</td>
                        {lintasLokasi && <td className={tdClass}>{r.lokasi}</td>}
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
