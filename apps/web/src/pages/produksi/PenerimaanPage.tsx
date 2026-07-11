import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { KonfirmasiStatus } from "@kakarut/shared";
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

interface PenerimaanRow {
  id: string;
  ingredient_id: string;
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
  status: KonfirmasiStatus;
  supplier: string | null;
  tempat: string | null;
  qty_dipesan: number | null;
  alasan_tolak: string | null;
}

interface KirimanGroup {
  key: string;
  fakturId: string | null;
  waktu: string;
  supplier: string | null;
  noFaktur: string | null;
  catatan: string | null;
  status: KonfirmasiStatus;
  alasanTolak: string | null;
  rows: PenerimaanRow[];
}

/**
 * Penerimaan barang di toko/cabang: kiriman pembelian berstatus "Dikirim"
 * diterima semua, diterima sebagian (barang kurang — isi qty per baris), atau
 * ditolak. Penolakan bisa dibatalkan (salah cek) → faktur selesai & stok masuk.
 * Dapat diakses semua peran; kasir terkunci ke cabangnya.
 */
export function PenerimaanPage() {
  const { branchQuery } = useBranch();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["penerimaan", branchQuery],
    queryFn: () => api<{ rows: PenerimaanRow[] }>(`/penerimaan${branchQuery}`),
  });

  // mode terima-sebagian per faktur: draft qty diterima per baris
  const [sebagianKey, setSebagianKey] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // mode tolak per faktur: input alasan
  const [tolakKey, setTolakKey] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");

  const grup = useMemo<KirimanGroup[]>(() => {
    const byKey = new Map<string, KirimanGroup>();
    for (const r of data?.rows ?? []) {
      const key = r.faktur_id ?? r.id;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          fakturId: r.faktur_id,
          waktu: r.waktu,
          supplier: r.supplier,
          noFaktur: r.no_faktur,
          catatan: r.catatan,
          status: r.status,
          alasanTolak: r.alasan_tolak,
          rows: [],
        };
        byKey.set(key, g);
      }
      g.rows.push(r);
      if (r.alasan_tolak && !g.alasanTolak) g.alasanTolak = r.alasan_tolak;
    }
    return [...byKey.values()];
  }, [data]);

  const dikirim = grup.filter((g) => g.status === "menunggu");
  const ditolak = grup.filter((g) => g.status === "ditolak");

  function segarkan() {
    for (const key of ["penerimaan", "/pembelian", "stok"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    setSebagianKey(null);
    setTolakKey(null);
    setAlasan("");
  }

  const terima = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/penerimaan/${fakturId}/terima`, { method: "POST" }),
    onSuccess: segarkan,
  });
  const terimaSebagian = useMutation({
    mutationFn: (g: KirimanGroup) =>
      api(`/penerimaan/${g.fakturId}/terima-sebagian`, {
        method: "POST",
        body: {
          items: g.rows.map((r) => ({
            id: r.id,
            qty_diterima: Number(qtyDraft[r.id] ?? r.qty) || 0,
          })),
          alasan: alasan.trim() || null,
        },
      }),
    onSuccess: segarkan,
  });
  const tolak = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/penerimaan/${fakturId}/tolak`, {
        method: "POST",
        body: { alasan: alasan.trim() || null },
      }),
    onSuccess: segarkan,
  });
  const batalTolak = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/penerimaan/${fakturId}/batal-tolak`, { method: "POST" }),
    onSuccess: segarkan,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageTitle>Penerimaan Barang</PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        Kiriman pembelian yang sudah <b>dikirim ke toko</b> diterima di sini. Bila barang
        kurang, pilih <b>Terima Sebagian</b> dan isi jumlah yang benar-benar diterima; bila
        salah/tidak sesuai, <b>Tolak</b>. Penolakan bisa <b>dibatalkan</b> jika ternyata salah
        cek — faktur langsung selesai & stok masuk.
      </div>

      <ErrorText error={terima.error || terimaSebagian.error || tolak.error || batalTolak.error} />

      <h2 className="mb-2 text-lg font-semibold text-stone-700">
        🚚 Menunggu penerimaan{" "}
        <span className="text-sm font-normal text-stone-400">({dikirim.length})</span>
      </h2>
      {dikirim.length === 0 ? (
        <Card className="mb-6 p-6 text-center text-sm text-stone-400">
          Tidak ada kiriman yang menunggu penerimaan.
        </Card>
      ) : (
        <div className="mb-6 space-y-3">
          {dikirim.map((g) => {
            const modeSebagian = sebagianKey === g.key;
            const modeTolak = tolakKey === g.key;
            return (
              <Card key={g.key} className="overflow-hidden border-yellow-300">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-stone-700">
                      {formatTanggalRingkas(g.waktu)} {formatWaktu(g.waktu)}
                    </span>
                    <span className="text-stone-500">{g.supplier ?? "Tanpa supplier"}</span>
                    {g.noFaktur && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                        {g.noFaktur}
                      </span>
                    )}
                    {g.catatan && <span className="text-xs text-stone-400">· {g.catatan}</span>}
                  </div>
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                    🚚 Dikirim
                  </span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>Bahan</th>
                      <th className={`${thClass} text-right`}>Dikirim</th>
                      {modeSebagian && <th className={`${thClass} text-right`}>Diterima</th>}
                      <th className={thClass}>Disimpan di</th>
                      <th className={`${thClass} text-right`}>Harga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                        <td className={`${tdClass} text-right`}>
                          {formatAngka(r.qty)} {r.satuan}
                        </td>
                        {modeSebagian && (
                          <td className={`${tdClass} text-right`}>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={qtyDraft[r.id] ?? String(r.qty)}
                              onChange={(e) =>
                                setQtyDraft((p) => ({ ...p, [r.id]: e.target.value }))
                              }
                              className={`${inputClass} w-24 text-right`}
                            />
                          </td>
                        )}
                        <td className={tdClass}>{r.tempat ?? "—"}</td>
                        <td className={`${tdClass} text-right`}>
                          {r.total_harga != null ? formatRupiah(r.total_harga) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 px-4 py-2.5">
                  {modeTolak ? (
                    <>
                      <input
                        value={alasan}
                        onChange={(e) => setAlasan(e.target.value)}
                        className={`${inputClass} max-w-xs flex-1`}
                        placeholder="alasan penolakan (mis. barang kurang)"
                      />
                      <button
                        onClick={() => tolak.mutate(g.fakturId!)}
                        disabled={tolak.isPending}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        ❌ Tolak Kiriman
                      </button>
                      <button onClick={() => setTolakKey(null)} className={btnSecondary}>
                        Batal
                      </button>
                    </>
                  ) : modeSebagian ? (
                    <>
                      <span className="mr-auto text-xs text-stone-500">
                        Isi jumlah yang benar-benar diterima (0 = baris ditolak).
                      </span>
                      <button
                        onClick={() => terimaSebagian.mutate(g)}
                        disabled={terimaSebagian.isPending}
                        className={btnPrimary}
                      >
                        {terimaSebagian.isPending ? "Menyimpan…" : "Simpan Penerimaan"}
                      </button>
                      <button onClick={() => setSebagianKey(null)} className={btnSecondary}>
                        Batal
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => terima.mutate(g.fakturId!)}
                        disabled={terima.isPending}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        ✔ Terima Semua
                      </button>
                      <button
                        onClick={() => {
                          setSebagianKey(g.key);
                          setTolakKey(null);
                          setQtyDraft({});
                        }}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                      >
                        ⚖ Terima Sebagian
                      </button>
                      <button
                        onClick={() => {
                          setTolakKey(g.key);
                          setSebagianKey(null);
                          setAlasan("");
                        }}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        ❌ Tolak
                      </button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold text-stone-700">
        ❌ Ditolak <span className="text-sm font-normal text-stone-400">({ditolak.length})</span>
      </h2>
      {ditolak.length === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-400">
          Tidak ada kiriman yang ditolak.
        </Card>
      ) : (
        <div className="space-y-3">
          {ditolak.map((g) => (
            <Card key={g.key} className="overflow-hidden border-red-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-stone-700">
                    {formatTanggalRingkas(g.waktu)} {formatWaktu(g.waktu)}
                  </span>
                  <span className="text-stone-500">{g.supplier ?? "Tanpa supplier"}</span>
                  {g.alasanTolak && (
                    <span className="text-xs text-red-600">· {g.alasanTolak}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    ❌ Ditolak
                  </span>
                  <button
                    onClick={() => batalTolak.mutate(g.fakturId!)}
                    disabled={batalTolak.isPending}
                    className={btnSecondary}
                    title="Salah cek? Batalkan penolakan — faktur selesai & stok masuk."
                  >
                    ↩ Batalkan Penolakan
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-stone-100 px-4 py-1 text-sm">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex justify-between py-1.5">
                    <span className="font-medium">{r.bahan}</span>
                    <span className="text-stone-500">
                      {formatAngka(r.qty)} {r.satuan}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
