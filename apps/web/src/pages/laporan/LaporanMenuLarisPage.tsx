import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { MenuLaris } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggal, hariIniWIB } from "../../lib/format";
import { LaporanTabs } from "./LaporanTabs";

const MEDALI = ["🥇", "🥈", "🥉"];

export function LaporanMenuLarisPage() {
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [dari, setDari] = useState(hariIniWIB());
  const [sampai, setSampai] = useState(hariIniWIB());
  const [cabangFilter, setCabangFilter] = useState("all");
  // metrik urut: "qty" (paling laris) atau "omzet" (paling cuan)
  const [urut, setUrut] = useState<"qty" | "omzet">("qty");

  const branchParam = isManajemen ? `&branch_id=${cabangFilter}` : "";

  const { data: lap, isLoading, error } = useQuery({
    queryKey: ["menu-laris", dari, sampai, isManajemen ? cabangFilter : "self"],
    queryFn: () => api<MenuLaris>(`/laporan/menu-laris?dari=${dari}&sampai=${sampai}${branchParam}`),
  });

  const items = [...(lap?.items ?? [])].sort((a, b) =>
    urut === "qty" ? b.qty - a.qty || b.omzet - a.omzet : b.omzet - a.omzet || b.qty - a.qty,
  );
  const maks = items.length > 0 ? (urut === "qty" ? items[0].qty : items[0].omzet) : 0;

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
          <input type="date" value={dari} max={sampai} onChange={(e) => setDari(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Sampai tanggal</label>
          <input type="date" value={sampai} min={dari} onChange={(e) => setSampai(e.target.value)} className={inputClass} />
        </div>
        {isManajemen && cabang.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Cabang</label>
            <select value={cabangFilter} onChange={(e) => setCabangFilter(e.target.value)} className={inputClass}>
              <option value="all">Semua cabang</option>
              {cabang.filter((b) => b.is_active).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Urutkan</label>
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
            <button
              onClick={() => setUrut("qty")}
              className={`px-3 py-2 font-medium ${urut === "qty" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
            >
              Porsi terjual
            </button>
            <button
              onClick={() => setUrut("omzet")}
              className={`px-3 py-2 font-medium ${urut === "omzet" ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
            >
              Omzet
            </button>
          </div>
        </div>
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
          <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Total porsi</div>
              <div className="mt-1 text-xl font-bold text-stone-800">{formatAngka(lap.total_qty)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Total omzet</div>
              <div className="mt-1 text-xl font-bold text-orange-600">{formatRupiah(lap.total_omzet)}</div>
            </Card>
          </div>

          {items.length === 0 ? (
            <Card className="p-10 text-center text-sm text-stone-400">
              Belum ada penjualan pada rentang ini.
            </Card>
          ) : (
            <div className="space-y-1.5">
              {items.map((m, i) => {
                const nilai = urut === "qty" ? m.qty : m.omzet;
                const lebar = maks > 0 ? Math.max(4, Math.round((nilai / maks) * 100)) : 0;
                return (
                  <Card key={m.menu_id} className="relative overflow-hidden p-3">
                    {/* bar latar proporsional terhadap peringkat teratas */}
                    <div
                      className="absolute inset-y-0 left-0 bg-orange-50"
                      style={{ width: `${lebar}%` }}
                      aria-hidden
                    />
                    <div className="relative flex items-center gap-3">
                      <div className="w-7 shrink-0 text-center text-lg font-bold text-stone-400">
                        {i < 3 ? MEDALI[i] : i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {m.kode && (
                            <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-orange-700">
                              {m.kode}
                            </span>
                          )}
                          <span className="truncate font-semibold text-stone-800">{m.nama}</span>
                        </div>
                        {m.kategori && <div className="text-xs text-stone-400">{m.kategori}</div>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-stone-800">{formatAngka(m.qty)} porsi</div>
                        <div className="text-xs text-orange-600">{formatRupiah(m.omzet)}</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
