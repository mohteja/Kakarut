import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { OpnameSesiDetail, OpnameSesiRow } from "@kakarut/shared";
import { Spinner, btnSecondary } from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatWaktu } from "../../lib/format";

function DetailSheet({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["opname-sesi", sessionId],
    queryFn: () => api<OpnameSesiDetail>(`/stok/opname/sesi/${sessionId}`),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-800">Detail Opname</h2>
          <button onClick={onClose} className="text-stone-400">✕</button>
        </div>
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-3 text-sm text-stone-500">
              {formatWaktu(data.waktu)} · {data.oleh ?? "—"}
              {data.catatan && ` · ${data.catatan}`}
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-1">Bahan</th>
                  <th className="py-1 text-right">Sistem</th>
                  <th className="py-1 text-right">Fisik</th>
                  <th className="py-1 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.items.map((it, i) => {
                  const sel = it.selisih ?? 0;
                  return (
                    <tr key={i}>
                      <td className="py-1.5 pr-2">
                        {it.nama} <span className="text-stone-400">{it.satuan}</span>
                      </td>
                      <td className="py-1.5 text-right text-stone-500">
                        {it.system_qty != null ? formatAngka(it.system_qty) : "—"}
                      </td>
                      <td className="py-1.5 text-right font-medium">{formatAngka(it.qty_fisik)}</td>
                      <td
                        className={`py-1.5 text-right font-semibold ${
                          Math.abs(sel) < 1e-9
                            ? "text-green-600"
                            : sel > 0
                              ? "text-yellow-700"
                              : "text-red-600"
                        }`}
                      >
                        {Math.abs(sel) < 1e-9 ? "0" : `${sel > 0 ? "+" : ""}${formatAngka(sel)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

/** Riwayat sesi opname (mobile-friendly, layar penuh). */
export function OpnameRiwayatPage() {
  const { branchQuery } = useBranch();
  const [detail, setDetail] = useState<string | null>(null);

  const { data: sesi, isLoading } = useQuery({
    queryKey: ["opname-riwayat", branchQuery],
    queryFn: () => api<OpnameSesiRow[]>(`/stok/opname/riwayat${branchQuery}`),
  });

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/stok/opname" className="text-2xl text-stone-500" aria-label="Kembali">
          ←
        </Link>
        <div className="flex-1 text-base font-bold text-stone-800">Riwayat Opname</div>
        <Link to="/stok" className={btnSecondary}>
          Stok
        </Link>
      </header>

      <main className="flex-1 space-y-2 p-3">
        {isLoading ? (
          <Spinner />
        ) : (sesi ?? []).length === 0 ? (
          <div className="py-10 text-center text-sm text-stone-400">Belum ada riwayat opname.</div>
        ) : (
          (sesi ?? []).map((s) => (
            <button
              key={s.session_id}
              onClick={() => setDetail(s.session_id)}
              className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white p-4 text-left"
            >
              <div>
                <div className="font-semibold text-stone-800">{formatWaktu(s.waktu)}</div>
                <div className="text-sm text-stone-500">
                  {s.oleh ?? "—"} · {s.jumlah_item} bahan
                  {s.catatan ? ` · ${s.catatan}` : ""}
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  s.jumlah_selisih === 0
                    ? "bg-green-100 text-green-800"
                    : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {s.jumlah_selisih === 0 ? "Semua cocok" : `${s.jumlah_selisih} selisih`}
              </span>
            </button>
          ))
        )}
      </main>

      {detail && <DetailSheet sessionId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
