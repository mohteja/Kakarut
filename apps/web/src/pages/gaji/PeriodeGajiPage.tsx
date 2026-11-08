import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { GajiPeriodeDetailDto, GajiPeriodeRow, GajiPeriodeStatus } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, SpinnerAtauGalat, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggal } from "../../lib/format";

export const LABEL_STATUS_GAJI: Record<GajiPeriodeStatus, { teks: string; kelas: string }> = {
  draft: { teks: "Draft", kelas: "bg-amber-100 text-amber-800" },
  final: { teks: "Final", kelas: "bg-blue-100 text-blue-800" },
  dibayar: { teks: "Dibayar", kelas: "bg-green-100 text-green-800" },
};

export function TandaStatusGaji({ status }: { status: GajiPeriodeStatus }) {
  const s = LABEL_STATUS_GAJI[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.kelas}`}>{s.teks}</span>;
}

/** Tautan antar-halaman penggajian — tiga halaman, satu menu. */
export function NavGaji() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link to="/gaji" className={btnSecondary}>
        📅 Periode
      </Link>
      <Link to="/gaji/karyawan" className={btnSecondary}>
        ⚙️ Setelan Gaji
      </Link>
      <Link to="/gaji/kasbon" className={btnSecondary}>
        💸 Kasbon
      </Link>
    </div>
  );
}

/**
 * PENGGAJIAN — daftar periode (owner & HRD). Periode baru langsung dihitung
 * server; bawaannya periode bulanan berikutnya, atau PERIODE KHUSUS (mis. gaji
 * pertama sesudah mulai memakai aplikasi di tengah bulan).
 */
export function PeriodeGajiPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error, refetch } = useQuery({
    queryKey: ["gaji", "periode"],
    queryFn: () => api<GajiPeriodeRow[]>("/gaji/periode"),
  });
  const [khusus, setKhusus] = useState(false);
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const buat = useMutation({
    mutationFn: () =>
      api<GajiPeriodeDetailDto>("/gaji/periode", {
        method: "POST",
        body: khusus ? { mulai, selesai } : {},
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["gaji"] });
      navigate(`/gaji/periode/${d.periode.id}`);
    },
  });

  return (
    <div className="max-w-4xl">
      <PageTitle aksi={<NavGaji />}>Penggajian</PageTitle>
      <Card className="mb-4 p-4">
        <div className="mb-2 font-semibold text-stone-800">Hitung gaji periode baru</div>
        <label className="mb-2 flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={khusus} onChange={(e) => setKhusus(e.target.checked)} />
          Periode khusus (tanggal sendiri, maks. 62 hari)
        </label>
        {khusus && (
          <div className="mb-2 grid grid-cols-2 gap-2 sm:max-w-md">
            <label className="text-xs text-stone-600">
              Mulai
              <input type="date" value={mulai} max={selesai || undefined} onChange={(e) => setMulai(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs text-stone-600">
              Selesai
              <input type="date" value={selesai} min={mulai || undefined} onChange={(e) => setSelesai(e.target.value)} className={inputClass} />
            </label>
          </div>
        )}
        <p className="mb-2 text-xs text-stone-500">
          {khusus
            ? "Dipakai misalnya untuk gaji pertama sesudah mulai memakai aplikasi di tengah bulan."
            : "Periode bulanan berikutnya — sesudah periode terakhir, atau periode yang memuat hari ini."}
        </p>
        <ErrorText error={buat.error} />
        <button
          type="button"
          onClick={() => buat.mutate()}
          disabled={buat.isPending || (khusus && (!mulai || !selesai))}
          className={btnPrimary}
        >
          {buat.isPending ? "Menghitung…" : "Buat & hitung"}
        </button>
      </Card>

      {!data ? (
        <SpinnerAtauGalat error={error} apa="Periode gaji" onCoba={() => refetch()} />
      ) : data.length === 0 ? (
        <p className="text-sm text-stone-500">
          Belum ada periode. Atur gaji karyawan di <Link to="/gaji/karyawan" className="text-orange-600 underline">Setelan Gaji</Link>, lalu buat periode.
        </p>
      ) : (
        <div className="space-y-2">
          {data.map((p) => (
            <Link key={p.id} to={`/gaji/periode/${p.id}`} className="block" data-testid="baris-periode-gaji">
              <Card className="flex items-center justify-between gap-3 p-3 hover:border-orange-300">
                <div>
                  <div className="font-semibold text-stone-800">
                    {formatTanggal(p.mulai)} – {formatTanggal(p.selesai)}
                  </div>
                  <div className="text-xs text-stone-500">{p.jumlah_slip} karyawan</div>
                </div>
                <div className="text-right">
                  <TandaStatusGaji status={p.status} />
                  <div className="mt-1 font-bold text-stone-800">{formatRupiah(p.total)}</div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
