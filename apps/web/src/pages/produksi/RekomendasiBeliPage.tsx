import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AcuanJenis, RekomendasiBeli } from "@kakarut/shared";
import {
  Card,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

const ACUAN_LABEL: Record<AcuanJenis, string> = {
  minggu_lalu: "hari sama minggu lalu",
  "7hari": "rata-rata 7 hari",
  rentang: "rentang tanggal",
};

/** Judul kolom terpakai mengikuti periode yang dipilih. */
function labelTerpakai(d: RekomendasiBeli): string {
  const { dari, sampai } = d.pakai;
  if (dari === d.hari_ini && sampai === d.hari_ini) return "Terpakai hari ini";
  if (dari === sampai) return `Terpakai ${dari}`;
  return `Terpakai ${dari}…${sampai}`;
}

function StatKecil({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-0.5 font-bold text-stone-800">{nilai}</div>
    </div>
  );
}

/** Rekomendasi jumlah beli tiap bahan agar mencapai target penjualan. */
export function RekomendasiBeliPage() {
  const { branchQuery } = useBranch();
  const queryClient = useQueryClient();
  const [targetInput, setTargetInput] = useState("");
  const [targetInited, setTargetInited] = useState(false);
  const [targetApplied, setTargetApplied] = useState("");
  const [acuan, setAcuan] = useState<AcuanJenis>("minggu_lalu");
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [pakaiMode, setPakaiMode] = useState<"hari_ini" | "tanggal" | "rentang">("hari_ini");
  const [pakaiDari, setPakaiDari] = useState("");
  const [pakaiSampai, setPakaiSampai] = useState("");

  function buildUrl() {
    const p = new URLSearchParams();
    p.set("acuan", acuan);
    if (targetApplied) p.set("target", targetApplied);
    if (acuan === "rentang" && dari && sampai) {
      p.set("dari", dari);
      p.set("sampai", sampai);
    }
    if (pakaiMode === "tanggal" && pakaiDari) {
      p.set("pakai_dari", pakaiDari);
      p.set("pakai_sampai", pakaiDari);
    } else if (pakaiMode === "rentang" && pakaiDari && pakaiSampai) {
      p.set("pakai_dari", pakaiDari);
      p.set("pakai_sampai", pakaiSampai);
    }
    return `/rekomendasi/beli${branchQuery ? `${branchQuery}&` : "?"}${p.toString()}`;
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "rekomendasi",
      branchQuery,
      targetApplied,
      acuan,
      dari,
      sampai,
      pakaiMode,
      pakaiDari,
      pakaiSampai,
    ],
    queryFn: () => api<RekomendasiBeli>(buildUrl()),
  });

  // isi field target dari default server sekali saat pertama termuat
  useEffect(() => {
    if (data && !targetInited) {
      if (data.target > 0) setTargetInput(String(data.target));
      setTargetInited(true);
    }
  }, [data, targetInited]);

  const simpanDefault = useMutation({
    mutationFn: () =>
      api("/company", { method: "PATCH", body: { target_penjualan: Number(targetInput) || 0 } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rekomendasi"] }),
  });

  const hitung = () => setTargetApplied(targetInput);

  const totalBiaya = (data?.bahan ?? []).reduce((a, b) => a + (b.estimasi_biaya ?? 0), 0);
  const adaAcuan = (data?.acuan.omzet ?? 0) > 0;

  return (
    <div className="max-w-5xl">
      <PageTitle
        aksi={
          <div className="flex flex-wrap gap-2">
            <Link to="/stok/tambah-dari-menu" className={btnSecondary}>
              🍜 Rencana dari Menu
            </Link>
            <Link to="/pembelian" className={btnSecondary}>
              ← Beli Bahan Baku
            </Link>
          </div>
        }
      >
        Rekomendasi Beli
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Masukkan <b>target penjualan (Rp)</b>. Sistem memproyeksikan kebutuhan bahan dari pemakaian
        nyata periode acuan: <i>bila periode itu omzet Rp X memakai bahan Y, untuk target Rp T butuh
        Y×(T/X)</i> — otomatis ikut menu terlaris. <b>Saran beli = kebutuhan − sisa</b>, dibulatkan
        ke atas per <b>kemasan</b> toko / <b>batch</b> produksi (bahan bertanda "Eceran" tetap per
        satuan).
      </div>

      <Card className="mb-3 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Target penjualan (Rp)</label>
            <input
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && hitung()}
              inputMode="numeric"
              placeholder="mis. 10000000"
              className={inputClass}
            />
          </div>
          <button onClick={hitung} className={btnPrimary}>
            Hitung
          </button>
          <button
            onClick={() => simpanDefault.mutate()}
            disabled={simpanDefault.isPending || !targetInput}
            className={btnSecondary}
          >
            {simpanDefault.isPending ? "Menyimpan…" : "Simpan default"}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Periode acuan</label>
            <select
              value={acuan}
              onChange={(e) => setAcuan(e.target.value as AcuanJenis)}
              className={inputClass}
            >
              <option value="minggu_lalu">Hari sama minggu lalu</option>
              <option value="7hari">Rata-rata 7 hari terakhir</option>
              <option value="rentang">Rentang tanggal</option>
            </select>
          </div>
          {acuan === "rentang" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">Dari</label>
                <input
                  type="date"
                  value={dari}
                  onChange={(e) => setDari(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Sampai</label>
                <input
                  type="date"
                  value={sampai}
                  onChange={(e) => setSampai(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Kolom terpakai (pemakaian)</label>
            <select
              value={pakaiMode}
              onChange={(e) =>
                setPakaiMode(e.target.value as "hari_ini" | "tanggal" | "rentang")
              }
              className={inputClass}
            >
              <option value="hari_ini">Hari ini</option>
              <option value="tanggal">Tanggal tertentu</option>
              <option value="rentang">Rentang tanggal</option>
            </select>
          </div>
          {pakaiMode === "tanggal" && (
            <div>
              <label className="mb-1 block text-sm font-medium">Tanggal</label>
              <input
                type="date"
                value={pakaiDari}
                onChange={(e) => setPakaiDari(e.target.value)}
                className={inputClass}
              />
            </div>
          )}
          {pakaiMode === "rentang" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">Terpakai dari</label>
                <input
                  type="date"
                  value={pakaiDari}
                  onChange={(e) => setPakaiDari(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Terpakai sampai</label>
                <input
                  type="date"
                  value={pakaiSampai}
                  onChange={(e) => setPakaiSampai(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      {isLoading ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatKecil label="Target penjualan" nilai={formatRupiah(data.target)} />
            <StatKecil
              label={`Omzet acuan (${ACUAN_LABEL[data.acuan.jenis]})`}
              nilai={formatRupiah(data.acuan.omzet)}
            />
            <StatKecil label="Est. total belanja" nilai={formatRupiah(totalBiaya)} />
            <StatKecil
              label="Periode acuan"
              nilai={
                data.acuan.dari === data.acuan.sampai
                  ? data.acuan.dari
                  : `${data.acuan.dari} … ${data.acuan.sampai}`
              }
            />
          </div>

          {data.acuan.fallback && (
            <div className="mb-3 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              Hari-sama minggu lalu tidak ada penjualan — dipakai rata-rata 7 hari terakhir sebagai
              acuan.
            </div>
          )}
          {!data.target ? (
            <div className="mb-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Masukkan target penjualan lalu tekan <b>Hitung</b> untuk melihat saran beli.
            </div>
          ) : !adaAcuan ? (
            <div className="mb-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Belum ada penjualan pada periode acuan, jadi kebutuhan/saran beli belum bisa dihitung.
              Kolom pemakaian tetap ditampilkan.
            </div>
          ) : null}

          <Card className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thClass}>Bahan</th>
                  <th className={`${thClass} text-right`}>{labelTerpakai(data)}</th>
                  <th className={`${thClass} text-right`}>Sisa</th>
                  <th className={`${thClass} text-right`}>Acuan</th>
                  <th className={`${thClass} text-right`}>Kebutuhan</th>
                  <th className={`${thClass} text-right`}>Saran beli</th>
                  <th className={`${thClass} text-right`}>Est. biaya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.bahan.map((b) => (
                  <tr key={b.ingredient_id} className={b.saran_beli ? "bg-orange-50/40" : ""}>
                    <td className={`${tdClass} font-medium`}>
                      {b.nama}
                      <span className="ml-1 text-xs font-normal text-stone-400">({b.satuan})</span>
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.5 text-xs font-normal ${b.pengadaan === "beli" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}
                      >
                        {b.pengadaan === "beli" ? "beli" : "produksi"}
                      </span>
                    </td>
                    <td className={`${tdClass} text-right`}>{formatAngka(b.terpakai)}</td>
                    <td className={`${tdClass} text-right`}>{formatAngka(b.sisa)}</td>
                    <td className={`${tdClass} text-right text-stone-500`}>
                      {formatAngka(b.acuan_qty)}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      {b.kebutuhan != null ? formatAngka(b.kebutuhan) : "—"}
                    </td>
                    <td
                      className={`${tdClass} text-right font-bold ${b.jumlah_faktur ? "text-orange-700" : "text-stone-400"}`}
                    >
                      {b.jumlah_faktur != null ? (
                        b.mode_faktur === "batch" ? (
                          <>
                            {formatAngka(b.jumlah_faktur)}{" "}
                            {b.pengadaan === "beli" ? "kemasan" : "batch"}
                            <span className="block text-xs font-normal text-stone-400">
                              = {formatAngka(b.qty_faktur ?? 0)} {b.satuan} · butuh{" "}
                              {formatAngka(b.saran_beli ?? 0)}
                            </span>
                          </>
                        ) : (
                          `${formatAngka(b.jumlah_faktur)} ${b.satuan}`
                        )
                      ) : b.saran_beli != null ? (
                        formatAngka(b.saran_beli)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${tdClass} text-right text-stone-500`}>
                      {b.estimasi_biaya != null ? formatRupiah(b.estimasi_biaya) : "—"}
                    </td>
                  </tr>
                ))}
                {data.bahan.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-stone-400">
                      Belum ada bahan yang stoknya dilacak.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          {data.menu_terlaris.length > 0 && (
            <Card className="mt-3 p-4">
              <div className="mb-2 text-sm font-semibold text-stone-700">
                Menu terlaris (periode acuan) — pendorong kebutuhan bahan
              </div>
              <div className="space-y-1">
                {data.menu_terlaris.map((m) => (
                  <div key={m.menu_nama} className="flex justify-between text-sm">
                    <span className="text-stone-700">
                      {m.menu_nama} <span className="text-stone-400">×{formatAngka(m.qty)}</span>
                    </span>
                    <span className="font-medium text-stone-600">{formatRupiah(m.omzet)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {isFetching && <div className="mt-2 text-xs text-stone-400">Memperbarui…</div>}
        </>
      ) : null}
    </div>
  );
}
