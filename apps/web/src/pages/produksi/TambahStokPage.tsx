import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { JenisPengadaan } from "@kakarut/shared";
import {
  Card,
  ErrorText,
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
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

interface StokMasukPage {
  rows: StokMasukRow[];
  total: number;
  total_pengeluaran: number;
}
import { FakturDetailModal } from "./FakturDetailModal";
import { FakturModal } from "./FakturModal";

export interface StokMasukRow {
  id: string;
  bahan: string;
  isi: number;
  satuan: string;
  qty: number;
  total_harga: number | null;
  is_batch: boolean;
  catatan: string | null;
  waktu: string;
  prod_date: string;
  faktur_id: string | null;
  no_faktur: string | null;
  status: "menunggu" | "dikonfirmasi";
  supplier: string | null;
  tempat: string | null;
  supplier_id: string | null;
  storage_location_id: string | null;
  dibuat_oleh: string | null;
  diubah_oleh: string | null;
  updated_at: string | null;
}

export interface FakturGroup {
  key: string;
  fakturId: string | null;
  waktu: string;
  prodDate: string;
  supplier: string | null;
  supplierId: string | null;
  noFaktur: string | null;
  status: "menunggu" | "dikonfirmasi";
  catatan: string | null;
  dibuatOleh: string | null;
  diubahOleh: string | null;
  updatedAt: string | null;
  rows: StokMasukRow[];
  totalHarga: number;
}

const TEKS: Record<JenisPengadaan, { judul: string; endpoint: string; logJudul: string }> = {
  produksi: { judul: "Produksi Bahan Baku", endpoint: "/produksi", logJudul: "Produksi hari ini" },
  beli: { judul: "Beli Bahan Baku", endpoint: "/pembelian", logJudul: "Pembelian hari ini" },
};

/**
 * Halaman penerimaan stok per jalur (produksi sendiri / beli jadi):
 * tombol tambah → faktur multi-item → simpan (menunggu) → "Konfirmasi Ada"
 * → stok terhitung.
 */
export function TambahStokPage({ tipe }: { tipe: JenisPengadaan }) {
  const t = TEKS[tipe];
  const { branchQuery } = useBranch();
  const queryClient = useQueryClient();
  const [modalBuka, setModalBuka] = useState(false);
  const [detail, setDetail] = useState<FakturGroup | null>(null);

  // Buku besar: filter tanggal + pagination per faktur (terlama di halaman awal,
  // terbaru di halaman terakhir). Default membuka halaman TERAKHIR.
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [pinnedLast, setPinnedLast] = useState(true);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [t.endpoint, branchQuery, dari, sampai, perPage, page],
    queryFn: () => {
      const p = new URLSearchParams();
      if (dari) p.set("dari", dari);
      if (sampai) p.set("sampai", sampai);
      p.set("per_page", String(perPage));
      p.set("page", String(page));
      return api<StokMasukPage>(
        `${t.endpoint}${branchQuery ? `${branchQuery}&` : "?"}${p.toString()}`,
      );
    },
    placeholderData: (prev) => prev,
  });
  const log = data?.rows;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Setelah data termuat, kalau "pinned", lompat ke halaman terakhir (terbaru).
  useEffect(() => {
    if (pinnedLast && data && page !== totalPages) setPage(totalPages);
  }, [pinnedLast, data, totalPages, page]);

  function gantiFilter(fn: () => void) {
    fn();
    setPinnedLast(true);
    setPage(1);
  }
  function keHalaman(n: number) {
    setPinnedLast(false);
    setPage(Math.min(totalPages, Math.max(1, n)));
  }

  const konfirmasi = useMutation({
    mutationFn: (fakturId: string) =>
      api(`${t.endpoint}/konfirmasi/${fakturId}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [t.endpoint] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  // Kelompokkan baris per faktur (baris lama tanpa faktur = grup sendiri)
  const grup = useMemo<FakturGroup[]>(() => {
    const byKey = new Map<string, FakturGroup>();
    for (const r of log ?? []) {
      const key = r.faktur_id ?? r.id;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          fakturId: r.faktur_id,
          waktu: r.waktu,
          prodDate: r.prod_date,
          supplier: r.supplier,
          supplierId: r.supplier_id,
          noFaktur: r.no_faktur,
          status: r.status,
          catatan: r.catatan,
          dibuatOleh: r.dibuat_oleh,
          diubahOleh: r.diubah_oleh,
          updatedAt: r.updated_at,
          rows: [],
          totalHarga: 0,
        };
        byKey.set(key, g);
      }
      g.rows.push(r);
      g.totalHarga += r.total_harga ?? 0;
    }
    return [...byKey.values()];
  }, [log]);

  const totalPengeluaran = data?.total_pengeluaran ?? 0;
  const adaMenunggu = grup.some((g) => g.status === "menunggu");
  const jenisKata = tipe === "produksi" ? "produksi" : "pembelian";

  return (
    <div>
      <PageTitle
        aksi={
          <div className="flex flex-wrap gap-2">
            {tipe === "beli" && (
              <Link to="/pembelian/rekomendasi" className={btnSecondary}>
                📊 Rekomendasi Beli
              </Link>
            )}
            <button onClick={() => setModalBuka(true)} className={btnPrimary}>
              + Tambah {tipe === "produksi" ? "Produksi" : "Pembelian"}
            </button>
          </div>
        }
      >
        {t.judul}
      </PageTitle>

      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Stok bertambah <b>setelah faktur dikonfirmasi</b> ("Konfirmasi Ada" = barang
        benar-benar diterima & tersimpan) — memudahkan stock opname.
      </div>
      <ErrorText error={konfirmasi.error} />

      {/* Filter tanggal + jumlah baris (buku besar) */}
      <Card className="mb-3 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Dari tanggal</label>
          <input
            type="date"
            value={dari}
            onChange={(e) => gantiFilter(() => setDari(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Sampai tanggal</label>
          <input
            type="date"
            value={sampai}
            onChange={(e) => gantiFilter(() => setSampai(e.target.value))}
            className={inputClass}
          />
        </div>
        {(dari || sampai) && (
          <button
            onClick={() => gantiFilter(() => { setDari(""); setSampai(""); })}
            className={btnSecondary}
          >
            Semua tanggal
          </button>
        )}
        <div className="ml-auto">
          <label className="mb-1 block text-xs font-medium text-stone-500">Baris / halaman</label>
          <select
            value={perPage}
            onChange={(e) => gantiFilter(() => setPerPage(Number(e.target.value)))}
            className={inputClass}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-stone-700">
          Riwayat {tipe === "produksi" ? "Produksi" : "Pembelian"}{" "}
          <span className="text-sm font-normal text-stone-400">({total} faktur)</span>
        </h2>
        {tipe === "beli" && totalPengeluaran > 0 && (
          <div className="text-sm text-stone-500">
            Pengeluaran terkonfirmasi{dari || sampai ? " (rentang)" : ""}:{" "}
            <b>{formatRupiah(totalPengeluaran)}</b>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : grup.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {dari || sampai
            ? `Tidak ada ${jenisKata} pada rentang tanggal ini.`
            : `Belum ada ${jenisKata}.`}
        </Card>
      ) : (
        <div className="space-y-3">
          {grup.map((g) => (
            <Card
              key={g.key}
              onClick={() => setDetail(g)}
              className={`flex cursor-pointer overflow-hidden transition hover:border-orange-300 hover:shadow-sm ${g.status === "menunggu" ? "border-yellow-300" : ""}`}
            >
              {/* Kotak tanggal & waktu di kiri tiap transaksi */}
              <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-stone-100 bg-stone-50 px-2 py-3 text-center sm:w-28">
                <div className="text-xs font-semibold leading-tight text-stone-600">
                  {formatTanggalRingkas(g.waktu)}
                </div>
                <div className="text-base font-bold text-stone-800">{formatWaktu(g.waktu)}</div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-stone-700">
                      {g.supplier ?? (tipe === "produksi" ? "Produksi sendiri" : "Tanpa sumber")}
                    </span>
                    {g.noFaktur && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                        {g.noFaktur}
                      </span>
                    )}
                    {g.dibuatOleh && (
                      <span className="text-xs text-stone-400">oleh {g.dibuatOleh}</span>
                    )}
                    {g.catatan && <span className="text-xs text-stone-400">· {g.catatan}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        g.status === "dikonfirmasi"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {g.status === "dikonfirmasi" ? "Dikonfirmasi ✓" : "Menunggu konfirmasi"}
                    </span>
                    {g.status === "menunggu" && g.fakturId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          konfirmasi.mutate(g.fakturId!);
                        }}
                        disabled={konfirmasi.isPending}
                        className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        ✔ Konfirmasi Ada
                      </button>
                    )}
                  </div>
                </div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Qty</th>
                      <th className={thClass}>Disimpan di</th>
                      {tipe === "beli" && <th className={`${thClass} text-right`}>Harga</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                        <td className={`${tdClass} text-right`}>
                          +{formatAngka(r.qty)} {r.satuan}
                          {r.is_batch && (
                            <span className="ml-1 text-xs text-stone-400">
                              ({formatAngka(r.qty / r.isi)} batch × {formatAngka(r.isi)})
                            </span>
                          )}
                        </td>
                        <td className={tdClass}>{r.tempat ?? "—"}</td>
                        {tipe === "beli" && (
                          <td className={`${tdClass} text-right`}>
                            {r.total_harga != null ? formatRupiah(r.total_harga) : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          {adaMenunggu && (
            <div className="text-xs text-stone-400">
              Faktur "Menunggu konfirmasi" belum menambah saldo stok.
            </div>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1.5 text-sm">
          <button
            onClick={() => keHalaman(1)}
            disabled={page <= 1}
            className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
            title="Terlama"
          >
            «
          </button>
          <button
            onClick={() => keHalaman(page - 1)}
            disabled={page <= 1}
            className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
          >
            ‹ Sebelumnya
          </button>
          <span className="px-2 text-stone-500">
            Halaman <b>{page}</b> / {totalPages}
          </span>
          <button
            onClick={() => keHalaman(page + 1)}
            disabled={page >= totalPages}
            className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
          >
            Berikutnya ›
          </button>
          <button
            onClick={() => keHalaman(totalPages)}
            disabled={page >= totalPages}
            className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
            title="Terbaru"
          >
            »
          </button>
          {isFetching && <span className="ml-2 text-xs text-stone-400">Memuat…</span>}
        </div>
      )}

      {modalBuka && (
        <FakturModal tipe={tipe} endpoint={t.endpoint} onClose={() => setModalBuka(false)} />
      )}
      {detail && (
        <FakturDetailModal
          grup={detail}
          tipe={tipe}
          endpoint={t.endpoint}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
