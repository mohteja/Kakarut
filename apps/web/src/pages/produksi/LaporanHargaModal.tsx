import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, ErrorText, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import type { FakturGroup } from "./TambahStokPage";

/**
 * LAPORAN HARGA — catat harga riil yang dibayar per bahan SETELAH belanja
 * diterima. Memperbarui total baris + harga acuan bahan (untuk laba-rugi
 * FIFO/rata-rata). Setelah semua baris berharga final, faktur jadi "Selesai".
 * Hanya jalur BELI.
 */
export function LaporanHargaModal({
  grup,
  onClose,
}: {
  grup: FakturGroup;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // hanya baris yang tidak ditolak yang perlu dilaporkan harganya
  const rows = grup.rows.filter((r) => r.status !== "ditolak");
  const [harga, setHarga] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.total_harga != null ? String(r.total_harga) : ""])),
  );
  const total = rows.reduce(
    (t, r) => t + ((harga[r.id] ?? "") !== "" ? Number(harga[r.id]) || 0 : 0),
    0,
  );
  const simpan = useMutation({
    mutationFn: () =>
      api(`/pembelian/laporan-harga/${grup.fakturId}`, {
        method: "POST",
        body: {
          items: rows
            .filter((r) => (harga[r.id] ?? "") !== "")
            .map((r) => ({ id: r.id, total_harga: Math.max(0, Number(harga[r.id]) || 0) })),
        },
      }),
    onSuccess: () => {
      // segarkan daftar faktur (total + status Selesai) + master bahan + stok
      queryClient.invalidateQueries({ queryKey: ["/pembelian"] });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      onClose();
    },
  });
  // ada minimal satu harga terisi → boleh simpan
  const adaIsi = rows.some((r) => (harga[r.id] ?? "") !== "");

  return (
    <Modal open onClose={onClose} title="💰 Laporan Harga" lebar="max-w-lg">
      <div className="space-y-3">
        <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-800">
          Catat <b>harga yang benar-benar dibayar</b> tiap bahan sesuai nota belanja. Harga acuan
          bahan ikut diperbarui untuk perhitungan laba-rugi berikutnya. Setelah dilaporkan, faktur
          ini berstatus <b>✅ Selesai</b>.
        </div>
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-stone-700" title={r.bahan}>
                {r.bahan}
                <span className="ml-1 text-xs font-normal text-stone-400">
                  {formatAngka(r.qty)} {r.satuan}
                </span>
              </span>
              <span className="text-xs text-stone-400">Rp</span>
              <input
                type="number"
                min={0}
                step="any"
                value={harga[r.id] ?? ""}
                onChange={(e) => setHarga((s) => ({ ...s, [r.id]: e.target.value }))}
                placeholder="0"
                className={`${inputClass} max-w-32 text-right`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold text-stone-800">
          <span>Total dilaporkan</span>
          <span>{formatRupiah(total)}</span>
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary} disabled={simpan.isPending}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={!adaIsi || simpan.isPending}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "💾 Simpan Laporan Harga"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
