import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PenyimpananDto, StokRowDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka } from "../../lib/format";

export function StokPage() {
  const { auth } = useAuth();
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";

  const { data: stok, isLoading } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  const { data: tempatList = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });

  const [modeOpname, setModeOpname] = useState(false);
  const [opnameQty, setOpnameQty] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [filterTempat, setFilterTempat] = useState<string>("semua");

  const simpanOpname = useMutation({
    mutationFn: () => {
      const items = Object.entries(opnameQty)
        .filter(([, v]) => v !== "")
        .map(([ingredient_id, v]) => ({ ingredient_id, qty: Number(v) }));
      return api("/stok/opname", {
        method: "POST",
        body: {
          ...(branchId ? { branch_id: branchId } : {}),
          items,
          catatan: "Opname dari halaman stok",
        },
      });
    },
    onSuccess: () => {
      setModeOpname(false);
      setOpnameQty({});
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

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
  const jumlahDiisi = Object.values(opnameQty).filter((v) => v !== "").length;

  return (
    <div>
      <PageTitle
        aksi={
          isManajemen ? (
            modeOpname ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setModeOpname(false);
                    setOpnameQty({});
                  }}
                  className={btnSecondary}
                >
                  Batal
                </button>
                <button
                  onClick={() => simpanOpname.mutate()}
                  disabled={jumlahDiisi === 0 || simpanOpname.isPending}
                  className={btnPrimary}
                >
                  Simpan Opname ({jumlahDiisi})
                </button>
              </div>
            ) : (
              <button onClick={() => setModeOpname(true)} className={btnPrimary}>
                📋 Mode Opname
              </button>
            )
          ) : undefined
        }
      >
        Stok Bahan
      </PageTitle>

      {modeOpname && (
        <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
          Isi kolom <b>Stok Fisik</b> hanya untuk bahan yang dihitung ulang — baris kosong
          tidak diubah. Opname me-reset baseline saldo bahan tsb.
        </div>
      )}
      <ErrorText error={simpanOpname.error} />

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
              {modeOpname && <th className={`${thClass} text-right`}>Stok Fisik</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {tampil.map((s) => (
              <tr key={s.ingredient_id} className="hover:bg-stone-50">
                <td className={`${tdClass} font-medium`}>{s.nama}</td>
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
                {modeOpname && (
                  <td className={`${tdClass} text-right`}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={opnameQty[s.ingredient_id] ?? ""}
                      onChange={(e) =>
                        setOpnameQty({ ...opnameQty, [s.ingredient_id]: e.target.value })
                      }
                      placeholder={formatAngka(s.saldo)}
                      className="w-24 rounded-lg border border-stone-300 px-2 py-1 text-right text-sm"
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
