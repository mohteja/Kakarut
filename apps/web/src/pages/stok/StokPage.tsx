import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PenyesuaianRow, PenyimpananDto, StokRowDto } from "@kakarut/shared";
import {
  Card,
  PageTitle,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, labelTahapProduksi } from "../../lib/format";

export function StokPage() {
  const { branchQuery } = useBranch();

  const { data: stok, isLoading } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  const { data: tempatList = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  // semua penyesuaian yang belum tuntas (belum diklarifikasi + menunggu persetujuan)
  const { data: penyesuaianRows = [] } = useQuery({
    queryKey: ["penyesuaian", branchQuery, "semua"],
    queryFn: () => api<PenyesuaianRow[]>(`/stok/penyesuaian${branchQuery || ""}`),
  });
  const belumTuntas = penyesuaianRows.filter(
    (r) => r.penyesuaian_status !== "disetujui",
  ).length;

  const [cari, setCari] = useState("");
  const [filterTempat, setFilterTempat] = useState<string>("semua");

  if (isLoading) return <Spinner />;

  const tampil = (stok ?? [])
    .filter((s) => s.nama.toLowerCase().includes(cari.toLowerCase()))
    .filter((s) =>
      filterTempat === "semua"
        ? true
        : filterTempat === "tanpa"
          ? s.tempat_id === null
          : s.tempat_id === filterTempat,
    );

  return (
    <div>
      <PageTitle
        aksi={
          <div className="flex flex-wrap gap-2">
            <Link to="/stok/penyesuaian" className={`${btnSecondary} relative`}>
              ⚠️ Penyesuaian
              {belumTuntas > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
                  {belumTuntas}
                </span>
              )}
            </Link>
            <Link to="/stok/opname/riwayat" className={btnSecondary}>
              🕑 Riwayat
            </Link>
            <Link to="/stok/opname" className={btnPrimary}>
              📋 Stok Opname
            </Link>
          </div>
        }
      >
        Stok Bahan
      </PageTitle>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className={`${inputClass} max-w-56`}
        />
        <select
          value={filterTempat}
          onChange={(e) => setFilterTempat(e.target.value)}
          className={`${inputClass} max-w-56`}
          aria-label="Filter tempat penyimpanan"
        >
          <option value="semua">Semua tempat penyimpanan</option>
          {tempatList.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nama}
            </option>
          ))}
          <option value="tanpa">Tanpa tempat</option>
        </select>
        {filterTempat !== "semua" && (
          <button
            onClick={() => setFilterTempat("semua")}
            className="text-sm font-medium text-orange-600 hover:underline"
          >
            Reset filter
          </button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Bahan</th>
              <th className={thClass}>Tempat</th>
              <th className={`${thClass} text-right`}>Stok Awal</th>
              <th className={`${thClass} text-right`} title="Produksi + pembelian setelah opname terakhir">
                Masuk
              </th>
              <th className={`${thClass} text-right`}>Terpakai</th>
              <th className={`${thClass} text-right`}>Saldo</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {tampil.map((s) => (
              <tr key={s.ingredient_id} className="hover:bg-stone-50">
                <td className={`${tdClass} font-medium`}>
                  {s.nama}
                  {s.produksi_berjalan && (
                    <span
                      className="ml-2 whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800"
                      title={`Direncanakan ${formatAngka(s.produksi_berjalan.rencana)} · Dikerjakan ${formatAngka(s.produksi_berjalan.dikerjakan)} · Menunggu konfirmasi ${formatAngka(s.produksi_berjalan.menunggu)}`}
                    >
                      🏭 +{formatAngka(s.produksi_berjalan.qty)} ·{" "}
                      {labelTahapProduksi(s.produksi_berjalan)}
                    </span>
                  )}
                </td>
                <td className={`${tdClass} text-stone-500`}>{s.tempat ?? "—"}</td>
                <td className={`${tdClass} text-right`}>{formatAngka(s.stok_awal)}</td>
                <td className={`${tdClass} text-right text-green-700`}>
                  {s.produksi > 0 ? `+${formatAngka(s.produksi)}` : "—"}
                </td>
                <td className={`${tdClass} text-right text-red-600`}>
                  {s.terpakai > 0 ? `−${formatAngka(s.terpakai)}` : "—"}
                </td>
                <td className={`${tdClass} text-right font-bold`}>{formatAngka(s.saldo)}</td>
                <td className={tdClass}>
                  <StatusBadge status={s.status} />
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <a
                    href={`/stok/kartu/${s.ingredient_id}${branchQuery}`}
                    target="_blank"
                    rel="noopener"
                    className="text-sm font-medium text-orange-600 hover:underline"
                    title="Buka kartu stok di tab baru"
                  >
                    📄 Kartu
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
