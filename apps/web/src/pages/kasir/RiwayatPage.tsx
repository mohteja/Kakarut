import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { RiwayatTransaksiRow } from "@kakarut/shared";
import { Card, PageTitle, Spinner, btnSecondary, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah, formatWaktu, hariIniWIB } from "../../lib/format";
import { ReceiptModal, type SaleResult } from "./ReceiptModal";

const METODE_LABEL: Record<string, string> = {
  tunai: "💵 Tunai",
  qris: "📱 QRIS",
  transfer: "🏦 Transfer",
};

/**
 * Riwayat transaksi kasir: cek pesanan bila ada kekeliruan + cetak ulang struk.
 */
export function RiwayatPage() {
  const { auth } = useAuth();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { branchQuery, divisi } = useBranch();
  const queryClient = useQueryClient();
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Kantor = pusat data penjualan: semua transaksi seluruh cabang sekaligus
  // (cabang menyetor data penjualan ke kantor); divisi lain terkunci lokasinya.
  const dariKantor = divisi === "kantor";
  const q = dariKantor ? "?branch_id=all" : branchQuery;
  const { data: rows, isLoading } = useQuery({
    queryKey: ["riwayat", q, tanggal],
    queryFn: () =>
      api<RiwayatTransaksiRow[]>(`/penjualan${q ? `${q}&` : "?"}tanggal=${tanggal}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["transaksi-detail", selectedId],
    queryFn: () => api<SaleResult>(`/penjualan/${selectedId}`),
    enabled: !!selectedId,
  });

  const list = rows ?? [];
  const totalHari = list.reduce((a, r) => a + r.total, 0);

  return (
    <div className="max-w-2xl">
      <PageTitle
        aksi={
          <Link to="/kasir" className={btnSecondary}>
            ← Kasir
          </Link>
        }
      >
        Riwayat Transaksi
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Cek pesanan atau <b>cetak ulang struk</b> bila ada kekeliruan. Ketuk transaksi untuk
        melihat detail & mencetak ulang.
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={tanggal}
          onChange={(e) => setTanggal(e.target.value)}
          className={inputClass}
        />
        {list.length > 0 && (
          <div className="text-sm text-stone-500">
            {list.length} transaksi · total <b>{formatRupiah(totalHari)}</b>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada transaksi pada tanggal ini.
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:border-orange-400 hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold text-stone-800">{r.nomor}</div>
                <div className="truncate text-sm text-stone-500">
                  {formatWaktu(r.waktu)} · {r.jumlah_item} item
                  {dariKantor && r.cabang && ` · 🏪 ${r.cabang}`}
                  {r.meja && ` · ${r.meja}`}
                  {r.kasir && ` · ${r.kasir}`}
                  {` · ${METODE_LABEL[r.metode] ?? r.metode}`}
                </div>
                {r.konsumen && (
                  <div className="truncate text-xs font-medium text-orange-600">👤 {r.konsumen}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.is_dine_in ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-600"}`}
                >
                  {r.is_dine_in ? "Dine-in" : "Bawa pulang"}
                </span>
                <div className="text-right">
                  <div className="font-bold text-stone-800">{formatRupiah(r.total)}</div>
                  <div className="text-xs text-orange-600">🧾 Struk</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId && detail && (
        <ReceiptModal
          data={detail}
          autoPrintOnOpen={false}
          onClose={() => setSelectedId(null)}
          onDeleted={
            isManajemen
              ? () => {
                  setSelectedId(null);
                  for (const key of ["riwayat", "penjualan", "stok", "laporan", "rekomendasi"]) {
                    queryClient.invalidateQueries({ queryKey: [key] });
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
