import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { OpnameSesiDetail, OpnameSesiRow, OpnameSesiStatus } from "@kakarut/shared";
import { Spinner, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatWaktu } from "../../lib/format";

/** Badge status ACC sesi opname. */
function StatusBadge({ status, jumlahSelisih }: { status: OpnameSesiStatus; jumlahSelisih: number }) {
  const map: Record<OpnameSesiStatus, { teks: string; kelas: string }> = {
    cocok: { teks: "Semua cocok", kelas: "bg-green-100 text-green-800" },
    menunggu: {
      teks: `Menunggu ACC${jumlahSelisih ? ` · ${jumlahSelisih} selisih` : ""}`,
      kelas: "bg-yellow-100 text-yellow-800",
    },
    disetujui: { teks: "Disetujui ✓", kelas: "bg-blue-100 text-blue-800" },
    ditolak: { teks: "Ditolak", kelas: "bg-red-100 text-red-700" },
  };
  const b = map[status];
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${b.kelas}`}>
      {b.teks}
    </span>
  );
}

function DetailSheet({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { data, isLoading } = useQuery({
    queryKey: ["opname-sesi", sessionId],
    queryFn: () => api<OpnameSesiDetail>(`/stok/opname/sesi/${sessionId}`),
  });

  // Setelah ACC/tolak/hapus: segarkan riwayat + stok + kartu + penyesuaian.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["opname-riwayat"] });
    queryClient.invalidateQueries({ queryKey: ["opname-sesi", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["stok"] });
    queryClient.invalidateQueries({ queryKey: ["kartu-stok"] });
    queryClient.invalidateQueries({ queryKey: ["penyesuaian"] });
  };

  const acc = useMutation({
    mutationFn: () => api(`/stok/opname/sesi/${sessionId}/acc`, { method: "POST", body: {} }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const tolak = useMutation({
    mutationFn: (alasan: string | null) =>
      api(`/stok/opname/sesi/${sessionId}/tolak`, { method: "POST", body: { alasan } }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const hapus = useMutation({
    mutationFn: () => api(`/stok/opname/sesi/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const sibuk = acc.isPending || tolak.isPending || hapus.isPending;

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
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                {data.nomor && (
                  <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {data.nomor}
                  </span>
                )}
                <span>
                  {formatWaktu(data.waktu)} · {data.oleh ?? "—"}
                  {data.catatan && ` · ${data.catatan}`}
                </span>
              </div>
              <StatusBadge
                status={data.status}
                jumlahSelisih={data.items.filter((i) => Math.abs(i.selisih ?? 0) > 1e-9).length}
              />
            </div>
            {data.status === "menunggu" && (
              <div className="mb-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                Stok <b>belum berubah</b>. Owner/admin meng-<b>ACC</b> agar selisih diterapkan ke
                stok, atau <b>Tolak</b> untuk membuang hitungan ini.
              </div>
            )}
            {data.status === "disetujui" && data.ditinjau_oleh && (
              <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Disetujui oleh <b>{data.ditinjau_oleh}</b> — stok sudah disesuaikan.
              </div>
            )}
            {data.status === "ditolak" && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                Ditolak{data.ditinjau_oleh ? ` oleh ${data.ditinjau_oleh}` : ""} — stok tidak
                berubah.
              </div>
            )}
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

            {/* Aksi ACC/Tolak/Hapus — HANYA owner/admin */}
            {bolehUbah && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
                {data.status === "menunggu" && (
                  <>
                    <button
                      onClick={() => {
                        if (window.confirm("Setujui opname ini? Stok akan disesuaikan ke hitungan fisik."))
                          acc.mutate();
                      }}
                      disabled={sibuk}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      ✅ ACC — terapkan ke stok
                    </button>
                    <button
                      onClick={() => {
                        const alasan = window.prompt("Tolak opname ini? (alasan opsional)", "");
                        if (alasan !== null) tolak.mutate(alasan.trim() || null);
                      }}
                      disabled={sibuk}
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      ❌ Tolak
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Hapus riwayat opname ini? Bila sudah disetujui, stok kembali seperti sebelum opname.",
                      )
                    )
                      hapus.mutate();
                  }}
                  disabled={sibuk}
                  className="ml-auto text-sm font-medium text-stone-400 hover:text-red-600 disabled:opacity-50"
                >
                  🗑 Hapus
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Riwayat sesi opname (mobile-friendly, layar penuh). */
export function OpnameRiwayatPage() {
  const { query: branchQuery } = useCabangData();
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
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {s.nomor && (
                    <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                      {s.nomor}
                    </span>
                  )}
                  <span className="font-semibold text-stone-800">{formatWaktu(s.waktu)}</span>
                </div>
                <div className="truncate text-sm text-stone-500">
                  {s.oleh ?? "—"} · {s.jumlah_item} bahan
                  {s.catatan ? ` · ${s.catatan}` : ""}
                </div>
              </div>
              <StatusBadge status={s.status} jumlahSelisih={s.jumlah_selisih} />
            </button>
          ))
        )}
      </main>

      {detail && <DetailSheet sessionId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
