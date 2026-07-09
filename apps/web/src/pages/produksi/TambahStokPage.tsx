import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { JenisPengadaan } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  tdClass,
  thClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatWaktu, hariIniWIB } from "../../lib/format";
import { FakturModal } from "./FakturModal";

interface StokMasukRow {
  id: string;
  bahan: string;
  isi: number;
  satuan: string;
  qty: number;
  total_harga: number | null;
  is_batch: boolean;
  catatan: string | null;
  waktu: string;
  faktur_id: string | null;
  no_faktur: string | null;
  status: "menunggu" | "dikonfirmasi";
  supplier: string | null;
  tempat: string | null;
}

interface FakturGroup {
  key: string;
  fakturId: string | null;
  waktu: string;
  supplier: string | null;
  noFaktur: string | null;
  status: "menunggu" | "dikonfirmasi";
  catatan: string | null;
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

  const today = hariIniWIB();
  const { data: log, isLoading } = useQuery({
    queryKey: [t.endpoint, today, branchQuery],
    queryFn: () =>
      api<StokMasukRow[]>(
        `${t.endpoint}${branchQuery ? `${branchQuery}&` : "?"}tanggal=${today}`,
      ),
  });

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
          supplier: r.supplier,
          noFaktur: r.no_faktur,
          status: r.status,
          catatan: r.catatan,
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

  const totalPengeluaran = grup
    .filter((g) => g.status === "dikonfirmasi")
    .reduce((a, g) => a + g.totalHarga, 0);
  const adaMenunggu = grup.some((g) => g.status === "menunggu");

  return (
    <div>
      <PageTitle
        aksi={
          <button onClick={() => setModalBuka(true)} className={btnPrimary}>
            + Tambah {tipe === "produksi" ? "Produksi" : "Pembelian"}
          </button>
        }
      >
        {t.judul}
      </PageTitle>

      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Stok bertambah <b>setelah faktur dikonfirmasi</b> ("Konfirmasi Ada" = barang
        benar-benar diterima & tersimpan) — memudahkan stock opname.
      </div>
      <ErrorText error={konfirmasi.error} />

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-700">{t.logJudul}</h2>
        {tipe === "beli" && totalPengeluaran > 0 && (
          <div className="text-sm text-stone-500">
            Pengeluaran terkonfirmasi: <b>{formatRupiah(totalPengeluaran)}</b>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : grup.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada {tipe === "produksi" ? "produksi" : "pembelian"} hari ini.
        </Card>
      ) : (
        <div className="space-y-3">
          {grup.map((g) => (
            <Card key={g.key} className={g.status === "menunggu" ? "border-yellow-300" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-stone-700">{formatWaktu(g.waktu)}</span>
                  <span className="text-stone-500">
                    {g.supplier ?? (tipe === "produksi" ? "Produksi sendiri" : "Tanpa sumber")}
                  </span>
                  {g.noFaktur && (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                      {g.noFaktur}
                    </span>
                  )}
                  {g.catatan && <span className="text-xs text-stone-400">{g.catatan}</span>}
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
                      onClick={() => konfirmasi.mutate(g.fakturId!)}
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
            </Card>
          ))}
          {adaMenunggu && (
            <div className="text-xs text-stone-400">
              Faktur "Menunggu konfirmasi" belum menambah saldo stok.
            </div>
          )}
        </div>
      )}

      {modalBuka && (
        <FakturModal tipe={tipe} endpoint={t.endpoint} onClose={() => setModalBuka(false)} />
      )}
    </div>
  );
}
