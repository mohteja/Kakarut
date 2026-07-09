import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BahanDto, JenisPengadaan } from "@kakarut/shared";
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
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatWaktu, hariIniWIB } from "../../lib/format";

interface TambahStokRow {
  id: string;
  bahan: string;
  qty: number;
  total_harga: number | null;
  is_batch: boolean;
  catatan: string | null;
  waktu: string;
}

const TEKS: Record<
  JenisPengadaan,
  { judul: string; endpoint: string; batchLabel: string; logJudul: string; infoKosong: string }
> = {
  produksi: {
    judul: "Produksi Bahan Baku",
    endpoint: "/produksi",
    batchLabel: "+1 Batch",
    logJudul: "Produksi hari ini",
    infoKosong: "Belum ada produksi hari ini.",
  },
  beli: {
    judul: "Beli Bahan Baku",
    endpoint: "/pembelian",
    batchLabel: "+1 Pembelian",
    logJudul: "Pembelian hari ini",
    infoKosong: "Belum ada pembelian hari ini.",
  },
};

/**
 * Halaman penambahan stok — dipakai dua jalur:
 * Produksi Bahan Baku (bahan buatan sendiri) dan Beli Bahan Baku (beli jadi).
 * Dropdown hanya menampilkan bahan yang jenis pengadaannya sesuai jalur.
 */
export function TambahStokPage({ tipe }: { tipe: JenisPengadaan }) {
  const t = TEKS[tipe];
  const { auth } = useAuth();
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";

  const { data: bahan } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const bahanJalur = (bahan ?? []).filter((b) => b.pengadaan === tipe);

  const today = hariIniWIB();
  const { data: log, isLoading } = useQuery({
    queryKey: [t.endpoint, today, branchQuery],
    queryFn: () =>
      api<TambahStokRow[]>(
        `${t.endpoint}${branchQuery ? `${branchQuery}&` : "?"}tanggal=${today}`,
      ),
  });

  const [bahanId, setBahanId] = useState("");
  const [qty, setQty] = useState("");
  const [totalHarga, setTotalHarga] = useState("");

  const dipilih = bahanJalur.find((b) => b.id === bahanId);
  // estimasi harga pembelian: (qty / isi) × harga_beli
  const estimasiHarga =
    tipe === "beli" && dipilih && Number(qty) > 0
      ? Math.round((Number(qty) / dipilih.isi) * dipilih.harga_beli)
      : null;

  const tambah = useMutation({
    mutationFn: (opts: { batch: boolean }) =>
      api(t.endpoint, {
        method: "POST",
        body: {
          ...(!isKasir && branchId ? { branch_id: branchId } : {}),
          ingredient_id: bahanId,
          ...(opts.batch ? { batch: true } : { qty: Number(qty) }),
          // total_harga hanya dikirim bila diisi manual — bila kosong,
          // server mengisi otomatis proporsional harga_beli
          ...(tipe === "beli" && totalHarga ? { total_harga: Number(totalHarga) } : {}),
        },
      }),
    onSuccess: () => {
      setQty("");
      setTotalHarga("");
      queryClient.invalidateQueries({ queryKey: [t.endpoint] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  const totalPembelianHariIni = (log ?? []).reduce((a, r) => a + (r.total_harga ?? 0), 0);

  return (
    <div>
      <PageTitle>{t.judul}</PageTitle>

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-sm font-medium">
              Bahan ({tipe === "produksi" ? "produksi sendiri" : "beli jadi"})
            </label>
            <select
              value={bahanId}
              onChange={(e) => setBahanId(e.target.value)}
              className={inputClass}
            >
              <option value="">— pilih bahan —</option>
              {bahanJalur.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama} (isi: {formatAngka(b.isi)})
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="mb-1 block text-sm font-medium">Qty</label>
            <input
              type="number"
              min="0.01"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={inputClass}
              placeholder="jumlah"
            />
          </div>
          {tipe === "beli" && (
            <div className="w-40">
              <label className="mb-1 block text-sm font-medium">Total harga (Rp)</label>
              <input
                type="number"
                min="0"
                value={totalHarga}
                onChange={(e) => setTotalHarga(e.target.value)}
                className={inputClass}
                placeholder={estimasiHarga != null ? String(estimasiHarga) : "otomatis"}
              />
            </div>
          )}
          <button
            onClick={() => tambah.mutate({ batch: false })}
            disabled={!bahanId || !qty || tambah.isPending}
            className={btnPrimary}
          >
            + Tambah
          </button>
          <button
            onClick={() => tambah.mutate({ batch: true })}
            disabled={!bahanId || tambah.isPending}
            className={btnSecondary}
            title={`Menambah stok sebanyak 'isi' bahan (${tipe === "produksi" ? "1 batch produksi" : "1 kali pembelian"})`}
          >
            {t.batchLabel}
            {dipilih ? ` (${formatAngka(dipilih.isi)})` : ""}
          </button>
        </div>
        {bahanJalur.length === 0 && bahan && (
          <div className="mt-2 text-sm text-stone-400">
            Belum ada bahan berjenis {tipe === "produksi" ? '"produksi sendiri"' : '"beli jadi"'} —
            atur jenis pengadaan di halaman Bahan Baku.
          </div>
        )}
        <div className="mt-2">
          <ErrorText error={tambah.error} />
        </div>
      </Card>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-700">{t.logJudul}</h2>
        {tipe === "beli" && totalPembelianHariIni > 0 && (
          <div className="text-sm text-stone-500">
            Total pengeluaran: <b>{formatRupiah(totalPembelianHariIni)}</b>
          </div>
        )}
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={thClass}>Waktu</th>
                <th className={thClass}>Bahan</th>
                <th className={`${thClass} text-right`}>Qty</th>
                {tipe === "beli" && <th className={`${thClass} text-right`}>Total Harga</th>}
                <th className={thClass}>{tipe === "produksi" ? "Batch?" : "Cara"}</th>
                <th className={thClass}>Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(log ?? []).map((r) => (
                <tr key={r.id}>
                  <td className={tdClass}>{formatWaktu(r.waktu)}</td>
                  <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                  <td className={`${tdClass} text-right`}>+{formatAngka(r.qty)}</td>
                  {tipe === "beli" && (
                    <td className={`${tdClass} text-right`}>
                      {r.total_harga != null ? formatRupiah(r.total_harga) : "—"}
                    </td>
                  )}
                  <td className={tdClass}>
                    {r.is_batch
                      ? tipe === "produksi"
                        ? "1 batch"
                        : "1 pembelian"
                      : "manual"}
                  </td>
                  <td className={`${tdClass} text-stone-400`}>{r.catatan}</td>
                </tr>
              ))}
              {(log ?? []).length === 0 && (
                <tr>
                  <td
                    colSpan={tipe === "beli" ? 6 : 5}
                    className="py-8 text-center text-sm text-stone-400"
                  >
                    {t.infoKosong}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
