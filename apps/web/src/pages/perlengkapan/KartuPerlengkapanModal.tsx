import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { KartuPerlengkapanDto, PerlengkapanRowDto } from "@kakarut/shared";
import { Modal, SpinnerAtauGalat, inputClass, tdClass, thClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggal } from "../../lib/format";

const LABEL_TIPE: Record<string, string> = {
  masuk: "📦 Masuk",
  pakai: "✂️ Pakai",
  auto: "⏱ Otomatis",
  koreksi: "🧮 Koreksi",
  kirim: "🚚 Kirim",
  terima: "📥 Terima",
};

/** Kartu (riwayat mutasi) satu perlengkapan per cabang per rentang tanggal. */
export function KartuPerlengkapanModal({
  item,
  branchQuery,
  onClose,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
}) {
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const params = new URLSearchParams(branchQuery.replace(/^\?/, ""));
  if (dari) params.set("dari", dari);
  if (sampai) params.set("sampai", sampai);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["kartu-perlengkapan", item.id, qs],
    queryFn: () => api<KartuPerlengkapanDto>(`/perlengkapan/${item.id}/kartu${qs}`),
  });

  return (
    <Modal open onClose={onClose} title={`📒 Kartu — ${item.nama}`} lebar="max-w-2xl">
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="block">
          Dari
          <input type="date" value={dari} max={sampai} onChange={(e) => setDari(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          Sampai
          <input type="date" value={sampai} min={dari} onChange={(e) => setSampai(e.target.value)} className={inputClass} />
        </label>
        {data && (
          <div className="ml-auto text-right text-xs text-stone-500">
            Periode {formatTanggal(data.periode.dari)} – {formatTanggal(data.periode.sampai)}
            <br />
            Belanja: <b className="text-stone-700">{formatRupiah(data.total_belanja)}</b>
          </div>
        )}
      </div>
      {!data ? (
        <SpinnerAtauGalat error={error} apa="Kartu perlengkapan" />
      ) : (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-lg bg-stone-50 px-3 py-1.5">
              Saldo awal: <b>{formatAngka(data.saldo_awal)}</b>
            </div>
            <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-800">
              Masuk: <b>+{formatAngka(data.total_masuk)}</b>
            </div>
            <div className="rounded-lg bg-red-50 px-3 py-1.5 text-red-800">
              Keluar: <b>−{formatAngka(data.total_keluar)}</b>
            </div>
            <div className="rounded-lg bg-stone-100 px-3 py-1.5">
              Saldo akhir: <b>{formatAngka(data.saldo_akhir)} {item.satuan}</b>
            </div>
          </div>
          {data.terpotong && (
            <div className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              Mutasi terlalu banyak — hanya sebagian ditampilkan; persempit rentang tanggal.
            </div>
          )}
          {data.mutasi.length === 0 ? (
            <div className="py-8 text-center text-sm text-stone-400">
              Tidak ada mutasi pada rentang ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className={thClass}>Tanggal</th>
                    <th className={thClass}>Jenis</th>
                    <th className={`${thClass} text-right`}>Masuk</th>
                    <th className={`${thClass} text-right`}>Keluar</th>
                    <th className={`${thClass} text-right`}>Saldo</th>
                    <th className={thClass}>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mutasi.map((m) => (
                    <tr key={m.id} className="border-b border-stone-100">
                      <td className={`${tdClass} whitespace-nowrap`}>{formatTanggal(m.tanggal)}</td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {LABEL_TIPE[m.tipe] ?? m.tipe}
                        {m.nomor && (
                          <span className="ml-1.5 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                            {m.nomor}
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} text-right text-emerald-700`}>
                        {m.masuk != null ? `+${formatAngka(m.masuk)}` : ""}
                      </td>
                      <td className={`${tdClass} text-right text-red-700`}>
                        {m.keluar != null ? `−${formatAngka(m.keluar)}` : ""}
                      </td>
                      <td className={`${tdClass} text-right font-semibold`}>{formatAngka(m.saldo)}</td>
                      <td className={`${tdClass} text-xs text-stone-500`}>
                        {[
                          m.catatan,
                          m.total_harga ? formatRupiah(m.total_harga) : null,
                          m.user_nama,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
