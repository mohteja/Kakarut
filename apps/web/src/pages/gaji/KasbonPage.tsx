import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { angkaDari, type GajiKaryawanRow, type KasbonRow } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, SpinnerAtauGalat, btnPrimary, inputClass, tdClass, thClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggal, hariIniWIB } from "../../lib/format";
import { NavGaji } from "./PeriodeGajiPage";

/**
 * KASBON — pinjaman karyawan. Dipotong otomatis dari slip saat periode gaji
 * difinalkan (min(cicilan, sisa)), sampai lunas. Kasbon yang sudah pernah
 * dipotong tak bisa dihapus.
 */
export function KasbonPage() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["gaji", "kasbon"],
    queryFn: () => api<KasbonRow[]>("/gaji/kasbon"),
  });
  const { data: karyawan } = useQuery({
    queryKey: ["gaji", "karyawan"],
    queryFn: () => api<GajiKaryawanRow[]>("/gaji/karyawan"),
  });
  const [userId, setUserId] = useState("");
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [nominal, setNominal] = useState("");
  const [cicilan, setCicilan] = useState("");
  const [catatan, setCatatan] = useState("");
  const tambah = useMutation({
    mutationFn: () =>
      api("/gaji/kasbon", {
        method: "POST",
        body: { user_id: userId, tanggal, nominal: angkaDari(nominal) || 0, cicilan_per_periode: angkaDari(cicilan) || 0, catatan: catatan || null },
      }),
    onSuccess: () => {
      setNominal("");
      setCicilan("");
      setCatatan("");
      qc.invalidateQueries({ queryKey: ["gaji"] });
    },
  });
  const hapus = useMutation({
    mutationFn: (id: string) => api(`/gaji/kasbon/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gaji"] }),
  });

  return (
    <div className="max-w-4xl">
      <PageTitle aksi={<NavGaji />}>Kasbon</PageTitle>
      <Card className="mb-4 p-4">
        <div className="mb-2 font-semibold text-stone-800">Catat kasbon</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            Karyawan
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass}>
              <option value="">— pilih —</option>
              {(karyawan ?? [])
                .filter((k) => !k.arsip_pada)
                .map((k) => (
                  <option key={k.user_id} value={k.user_id}>
                    {k.nama}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Tanggal
            <input type="date" value={tanggal} max={hariIniWIB()} onChange={(e) => setTanggal(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            Jumlah pinjaman (Rp)
            <input inputMode="numeric" value={nominal} onChange={(e) => setNominal(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            Cicilan per periode gaji (Rp)
            <input inputMode="numeric" value={cicilan} onChange={(e) => setCicilan(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm sm:col-span-2">
            Catatan
            <input value={catatan} maxLength={200} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
          </label>
        </div>
        <ErrorText error={tambah.error} />
        <button
          type="button"
          onClick={() => tambah.mutate()}
          disabled={tambah.isPending || !userId || !nominal || !cicilan}
          className={`mt-2 ${btnPrimary}`}
        >
          Simpan kasbon
        </button>
      </Card>

      <ErrorText error={hapus.error} />
      {!data ? (
        <SpinnerAtauGalat error={error} apa="Kasbon" onCoba={() => refetch()} />
      ) : data.length === 0 ? (
        <p className="text-sm text-stone-500">Belum ada kasbon.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="border-b border-stone-200">
                <th className={thClass}>Karyawan</th>
                <th className={thClass}>Tanggal</th>
                <th className={`${thClass} text-right`}>Pinjaman</th>
                <th className={`${thClass} text-right`}>Cicilan</th>
                <th className={`${thClass} text-right`}>Sisa</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id} className="border-b border-stone-100" data-testid="baris-kasbon">
                  <td className={tdClass}>
                    <div className="font-medium text-stone-800">{k.nama}</div>
                    {k.catatan && <div className="text-xs text-stone-500">{k.catatan}</div>}
                  </td>
                  <td className={tdClass}>{formatTanggal(k.tanggal)}</td>
                  <td className={`${tdClass} text-right`}>{formatRupiah(k.nominal)}</td>
                  <td className={`${tdClass} text-right`}>{formatRupiah(k.cicilan_per_periode)}</td>
                  <td className={`${tdClass} text-right font-semibold`}>
                    {k.lunas ? <span className="text-green-700">Lunas</span> : formatRupiah(k.sisa)}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {k.terpotong === 0 && (
                      <button
                        type="button"
                        onClick={() => confirm(`Hapus kasbon ${k.nama}?`) && hapus.mutate(k.id)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
