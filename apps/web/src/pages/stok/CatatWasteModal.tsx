import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ExpLotRow } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { ImageUpload } from "../../components/ImageUpload";
import { api } from "../../lib/api";
import { formatAngka, formatTanggalRingkas } from "../../lib/format";

/**
 * Catat WASTE dari lot yang hampir/lewat exp: memotong stok lewat mekanisme
 * penyesuaian yang sudah ada (sesi opname kategori waste_bahan) — masuk
 * Riwayat SO dan baru EFEKTIF setelah di-ACC owner/admin. Bukti foto wajib
 * (aturan yang sama dengan selisih opname).
 */
export function CatatWasteModal({
  lot,
  branchId,
  onClose,
}: {
  lot: ExpLotRow;
  /** cabang data terpilih (dari Kantor); null = cabang sendiri (server resolve) */
  branchId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(teksAngka(Math.min(lot.qty_masuk, Math.max(lot.saldo, 0))));
  const [foto, setFoto] = useState<string | null>(null);
  const [catatan, setCatatan] = useState(
    `Waste kedaluwarsa (exp ${formatTanggalRingkas(lot.exp_date)})`,
  );
  const [sukses, setSukses] = useState<{ nomor: string } | null>(null);

  const q = angkaDari(qty);
  const qtyInvalid = !Number.isFinite(q) || q <= 0 || q > lot.saldo + 1e-9;

  const simpan = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; session_id: string; nomor: string }>("/stok/waste", {
        method: "POST",
        body: {
          ...(branchId ? { branch_id: branchId } : {}),
          ingredient_id: lot.ingredient_id,
          qty: q,
          foto_url: foto,
          catatan: catatan.trim() || null,
        },
      }),
    onSuccess: (res) => {
      // Waste dicatat SEBAGAI baris opname (kategori waste_bahan) yang masih
      // menunggu ACC — jadi sesinya muncul di Riwayat Opname. Kuncinya dulu
      // `"opname"`, dan tak ada satu pun query memakai kunci itu; pencocokan
      // awalan React Query membandingkan elemen pertama secara UTUH, jadi
      // `"opname"` tak pernah menyentuh `"opname-riwayat"`.
      for (const key of ["stok", "stok-exp", "opname-riwayat"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setSukses({ nomor: res.nomor });
    },
  });

  return (
    <Modal open onClose={onClose} title={`Catat Waste — ${lot.nama}`}>
      {sukses ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✅ Waste tercatat sebagai sesi <b>{sukses.nomor}</b> — <b>menunggu ACC</b> owner/admin
            di <b>Stok → Riwayat</b>. Stok baru berkurang setelah di-ACC.
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={btnPrimary}>
              Tutup
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
            Lot masuk {formatTanggalRingkas(lot.prod_date)} · qty saat masuk{" "}
            <b>
              {formatAngka(lot.qty_masuk)} {lot.satuan}
            </b>{" "}
            · exp <b>{formatTanggalRingkas(lot.exp_date)}</b>
            {lot.nomor && <> · {lot.nomor}</>}
            <div className="mt-0.5 text-stone-400">
              Saldo bahan saat ini (semua lot): {formatAngka(lot.saldo)} {lot.satuan} — qty
              waste dihitung dari yang benar-benar dibuang.
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Qty waste ({lot.satuan}) <span className="text-red-500">*</span>
            </label>
            <input
              /* Koma adalah pemisah desimal bahasa Indonesia, dan
                                 `type="number"` MEMBUANG-nya saat diketik: "1,5"
                                 tersimpan "15" dengan `badInput` false — tak ada
                                 satu pun tanda di layar. `angkaDari` membaca
                                 koma maupun titik ribuan. */
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`${inputClass} ${qtyInvalid ? "!border-red-400" : ""}`}
              aria-label="Qty waste"
            />
            {qtyInvalid && (
              <div className="mt-0.5 text-xs text-red-600">
                Qty harus &gt; 0 dan ≤ saldo ({formatAngka(lot.saldo)})
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">
              Bukti foto <span className="text-red-500">*wajib</span>
            </div>
            <ImageUpload value={foto} onChange={setFoto} tujuan="bukti" placeholder="📷" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Catatan</label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className={inputClass}
            />
          </div>
          <ErrorText error={simpan.error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btnSecondary}>
              Batal
            </button>
            <button
              type="button"
              onClick={() => simpan.mutate()}
              disabled={simpan.isPending || qtyInvalid || !foto}
              className={btnPrimary}
              title={!foto ? "Lampirkan bukti foto dulu" : undefined}
            >
              {simpan.isPending ? "Menyimpan…" : "Catat Waste"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
