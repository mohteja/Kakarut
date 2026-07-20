import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RiwayatHargaDto } from "@kakarut/shared";
import { api } from "../lib/api";
import { formatAngka, formatRupiah, formatTanggal } from "../lib/format";
import { ErrorText, Modal, Spinner, btnPrimary, btnSecondary, inputClass } from "./ui";

/**
 * Kartu RIWAYAT HARGA satu barang (bahan baku / perlengkapan): daftar lot
 * pembelian + harga terkini & rata-rata tertimbang — fondasi hitung laba-rugi
 * FIFO/rata-rata. owner/admin bisa mencatat harga acuan terbaru di sini.
 *
 * `endpoint` = basis path item (mis. `/bahan/<id>` atau `/perlengkapan/<id>`).
 * Server menyediakan GET `${endpoint}/pembelian` & POST `${endpoint}/harga`.
 */
export function RiwayatHargaModal({
  endpoint,
  nama,
  satuan,
  bolehUbah,
  invalidateKeys = [],
  onClose,
}: {
  endpoint: string;
  nama: string;
  satuan: string;
  bolehUbah: boolean;
  /** query keys yang di-invalidate saat harga acuan disimpan */
  invalidateKeys?: string[][];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["riwayat-harga", endpoint],
    queryFn: () => api<RiwayatHargaDto>(`${endpoint}/pembelian`),
  });
  const [hargaBaru, setHargaBaru] = useState("");

  const simpan = useMutation({
    mutationFn: () =>
      api<RiwayatHargaDto>(`${endpoint}/harga`, {
        method: "POST",
        body: { harga_per_unit: Number(hargaBaru) || 0 },
      }),
    onSuccess: (d) => {
      queryClient.setQueryData(["riwayat-harga", endpoint], d);
      for (const k of invalidateKeys) queryClient.invalidateQueries({ queryKey: k });
      setHargaBaru("");
    },
  });

  return (
    <Modal open onClose={onClose} title={`Riwayat Harga — ${nama}`}>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-stone-50 px-2 py-2">
              <div className="text-xs text-stone-500">Harga terkini</div>
              <div className="text-sm font-bold text-stone-800">
                {formatRupiah(data.harga_terkini)}
              </div>
              <div className="text-[10px] text-stone-400">/ {satuan}</div>
            </div>
            <div className="rounded-lg bg-stone-50 px-2 py-2">
              <div className="text-xs text-stone-500">Rata-rata</div>
              <div className="text-sm font-bold text-stone-800">
                {data.harga_rata != null ? formatRupiah(data.harga_rata) : "—"}
              </div>
              <div className="text-[10px] text-stone-400">tertimbang / {satuan}</div>
            </div>
            <div className="rounded-lg bg-stone-50 px-2 py-2">
              <div className="text-xs text-stone-500">Pembelian</div>
              <div className="text-sm font-bold text-stone-800">{data.jumlah_pembelian}</div>
              <div className="text-[10px] text-stone-400">lot tercatat</div>
            </div>
          </div>

          {data.lots.length === 0 ? (
            <div className="rounded-lg bg-stone-50 px-3 py-6 text-center text-sm text-stone-400">
              Belum ada riwayat pembelian. Harga terisi dari pembelian yang tercatat.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-stone-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Tanggal</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5 text-right">Harga/{satuan}</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.lots.map((l) => (
                    <tr key={l.id}>
                      <td className="px-2 py-1.5 text-stone-700">
                        {formatTanggal(l.tanggal)}
                        <div className="text-[10px] text-stone-400">
                          {l.nomor ?? l.no_faktur ?? ""}
                          {l.supplier ? ` · ${l.supplier}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-stone-600">
                        {formatAngka(l.qty)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium text-stone-800">
                        {l.harga_satuan != null ? formatRupiah(l.harga_satuan) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-stone-600">
                        {l.total_harga != null ? formatRupiah(l.total_harga) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bolehUbah && (
            <div className="rounded-lg border border-stone-200 p-3">
              <label className="mb-1 block text-sm font-medium">
                Catat harga terbaru (Rp / {satuan})
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={hargaBaru}
                  onChange={(e) => setHargaBaru(e.target.value)}
                  placeholder={String(data.harga_terkini)}
                  className={`${inputClass} max-w-40`}
                />
                <button
                  onClick={() => simpan.mutate()}
                  disabled={!(Number(hargaBaru) >= 0) || hargaBaru === "" || simpan.isPending}
                  className={btnPrimary}
                >
                  {simpan.isPending ? "Menyimpan…" : "Catat"}
                </button>
                {simpan.isSuccess && <span className="text-sm text-green-600">Tersimpan ✓</span>}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                Memperbarui <b>harga acuan</b> — dipakai perkiraan biaya &amp; laba-rugi berikutnya.
              </p>
              <ErrorText error={simpan.error} />
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={onClose} className={btnSecondary}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
