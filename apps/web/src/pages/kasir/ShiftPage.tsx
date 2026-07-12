import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Shift } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

/** Label + warna selisih kas. */
function selisihInfo(selisih: number | null) {
  if (selisih == null) return { label: "—", warna: "text-stone-500" };
  if (selisih === 0) return { label: "Pas", warna: "text-green-600" };
  if (selisih < 0) return { label: `Kurang ${formatRupiah(-selisih)}`, warna: "text-red-600" };
  return { label: `Lebih ${formatRupiah(selisih)}`, warna: "text-amber-600" };
}

function Stat({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 font-bold ${warna}`}>{value}</div>
    </div>
  );
}

export function ShiftPage() {
  const qc = useQueryClient();
  // Shift kas berjalan per cabang — dari Kantor pilih cabang kasnya.
  const { query: branchQuery } = useCabangData();

  const { data: aktif, isLoading } = useQuery({
    queryKey: ["shift-aktif", branchQuery],
    queryFn: () => api<Shift | null>(`/shift/aktif${branchQuery}`),
    refetchInterval: 30_000,
  });
  const { data: riwayat = [] } = useQuery({
    queryKey: ["shift-riwayat", branchQuery],
    queryFn: () => api<Shift[]>(`/shift${branchQuery}`),
  });

  const [modalAwal, setModalAwal] = useState("");
  const [uangFisik, setUangFisik] = useState("");
  const [catatan, setCatatan] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shift-aktif"] });
    qc.invalidateQueries({ queryKey: ["shift-riwayat"] });
  };

  const buka = useMutation({
    mutationFn: () =>
      api(`/shift/buka${branchQuery}`, { method: "POST", body: { modal_awal: Number(modalAwal) || 0 } }),
    onSuccess: () => {
      invalidate();
      setModalAwal("");
    },
  });
  const tutup = useMutation({
    mutationFn: () =>
      api(`/shift/tutup${branchQuery}`, {
        method: "POST",
        body: { uang_fisik: Number(uangFisik) || 0, catatan: catatan || null },
      }),
    onSuccess: () => {
      invalidate();
      setUangFisik("");
      setCatatan("");
    },
  });

  const uangNum = Number(uangFisik) || 0;
  const selisihPreview = aktif && uangFisik !== "" ? uangNum - aktif.kas_sistem : null;
  const previewInfo = selisihInfo(selisihPreview);

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <CabangDataBar />
      <PageTitle
        aksi={
          <Link to="/kasir" className={btnSecondary}>
            ← Kasir
          </Link>
        }
      >
        Tutup Kasir
      </PageTitle>

      {!aktif ? (
        <Card className="space-y-3 p-5">
          <div className="text-sm text-stone-500">
            Belum ada shift terbuka di cabang ini. Buka kasir dengan mengisi <b>modal awal</b>{" "}
            (uang tunai di laci saat mulai).
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Modal awal (Rp)</label>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={modalAwal}
              onChange={(e) => setModalAwal(e.target.value)}
              placeholder="mis. 200000"
              className={inputClass}
            />
          </div>
          <ErrorText error={buka.error} />
          <button onClick={() => buka.mutate()} disabled={buka.isPending} className={btnPrimary}>
            {buka.isPending ? "Membuka…" : "🔓 Buka Kasir"}
          </button>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-800">Shift berjalan</h2>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Terbuka
              </span>
            </div>
            <div className="mb-3 text-sm text-stone-500">
              Dibuka oleh <b>{aktif.dibuka_oleh}</b> · {formatTanggalRingkas(aktif.dibuka_pada)}{" "}
              {formatWaktu(aktif.dibuka_pada)}
              {aktif.branch_nama ? ` · ${aktif.branch_nama}` : ""}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Modal awal" value={formatRupiah(aktif.modal_awal)} />
              <Stat label="Penjualan tunai" value={formatRupiah(aktif.penjualan_tunai)} />
              <Stat label="Non-tunai" value={formatRupiah(aktif.penjualan_nontunai)} />
              <Stat label="Transaksi" value={`${aktif.jumlah_transaksi}×`} />
              <Stat
                label="Kas seharusnya"
                value={formatRupiah(aktif.kas_sistem)}
                warna="text-orange-600"
              />
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-bold text-stone-800">Tutup & setor</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Uang tunai fisik di laci (Rp)</label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={uangFisik}
                onChange={(e) => setUangFisik(e.target.value)}
                placeholder="hitung uang fisik lalu isi di sini"
                className={inputClass}
              />
            </div>
            {selisihPreview != null && (
              <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
                <span className="text-stone-600">
                  Selisih (fisik − seharusnya {formatRupiah(aktif.kas_sistem)})
                </span>
                <span className={`font-bold ${previewInfo.warna}`}>{previewInfo.label}</span>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Catatan <span className="font-normal text-stone-400">(opsional)</span>
              </label>
              <input
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="mis. selisih karena kembalian kurang"
                className={inputClass}
              />
            </div>
            <ErrorText error={tutup.error} />
            <button
              onClick={() => {
                if (confirm("Tutup kasir sekarang? Shift akan dikunci dan tercatat di riwayat.")) {
                  tutup.mutate();
                }
              }}
              disabled={uangFisik === "" || tutup.isPending}
              className={`${btnPrimary} w-full py-3`}
            >
              {tutup.isPending ? "Menutup…" : "🔒 Tutup Kasir"}
            </button>
          </Card>
        </div>
      )}

      {/* Riwayat shift */}
      <div className="mt-6">
        <h2 className="mb-2 text-lg font-semibold text-stone-700">Riwayat shift</h2>
        {riwayat.length === 0 ? (
          <Card className="p-6 text-center text-sm text-stone-400">Belum ada shift ditutup.</Card>
        ) : (
          <div className="space-y-2">
            {riwayat.map((s) => {
              const info = selisihInfo(s.selisih);
              return (
                <Card key={s.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-800">
                        {formatTanggalRingkas(s.dibuka_pada)} · {formatWaktu(s.dibuka_pada)} –{" "}
                        {s.ditutup_pada ? formatWaktu(s.ditutup_pada) : "—"}
                      </div>
                      <div className="text-xs text-stone-500">
                        {s.dibuka_oleh}
                        {s.ditutup_oleh && s.ditutup_oleh !== s.dibuka_oleh ? ` → ${s.ditutup_oleh}` : ""}{" "}
                        · {s.jumlah_transaksi}× · tunai {formatRupiah(s.penjualan_tunai)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-sm font-bold ${info.warna}`}>{info.label}</div>
                      <div className="text-xs text-stone-400">
                        fisik {formatRupiah(s.uang_fisik ?? 0)}
                      </div>
                    </div>
                  </div>
                  {s.catatan && <div className="mt-1 text-xs text-stone-500">📝 {s.catatan}</div>}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
