import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { BeliPerlengkapanRow, PerlengkapanMasterRow } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

/**
 * BELI PERLENGKAPAN ke Central Kitchen — sejajar "Beli Bahan Baku". Faktur BP-
 * lahir otomatis saat permintaan cabang & stok CK kurang, atau dibuat manual di
 * sini. Alur: beli → Tiba di CK (masuk stok CK) → otomatis dikirim ke cabang.
 */
export function BeliPerlengkapanPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [tiba, setTiba] = useState<BeliPerlengkapanRow | null>(null);
  const [buatOpen, setBuatOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["perlengkapan-beli"],
    queryFn: () => api<BeliPerlengkapanRow[]>("/perlengkapan/beli"),
  });
  const batal = useMutation({
    mutationFn: (id: string) => api(`/perlengkapan/beli/${id}/batal`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });

  const menunggu = rows.filter((r) => r.status === "menunggu");

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          isManajemen ? (
            <button onClick={() => setBuatOpen(true)} className={btnPrimary}>
              ➕ Beli Perlengkapan
            </button>
          ) : undefined
        }
      >
        🛒 Beli Perlengkapan
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Faktur beli perlengkapan <b>ke Central Kitchen</b>. Lahir otomatis saat cabang minta &amp;
        stok CK kurang, atau dibuat manual. Tandai <b>Tiba di CK</b> → barang masuk stok CK lalu{" "}
        <b>otomatis dikirim</b> ke cabang tujuan.
      </div>
      <ErrorText error={batal.error} />

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada faktur beli perlengkapan.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {menunggu.length > 0 && (
            <div className="bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
              {menunggu.length} faktur menunggu dibeli
            </div>
          )}
          <div className="divide-y divide-stone-100">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                {r.nomor && (
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs font-bold text-stone-600">
                    {r.nomor}
                  </span>
                )}
                <span className="font-semibold text-stone-800">{r.nama}</span>
                <span className="text-stone-500">
                  {formatAngka(r.qty)} {r.satuan}
                </span>
                <span className="text-xs text-stone-500">
                  {r.ck_nama}
                  {r.tujuan_nama ? ` → ${r.tujuan_nama}` : " (stok CK)"}
                </span>
                <BeliStatusBadge status={r.status} />
                {r.total_harga != null && r.total_harga > 0 && (
                  <span className="text-xs text-stone-500">{formatRupiah(r.total_harga)}</span>
                )}
                {isManajemen && r.status === "menunggu" && (
                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={() => setTiba(r)}
                      className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      ✅ Tiba di CK
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Batalkan faktur beli "${r.nama}"?`)) batal.mutate(r.id);
                      }}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tiba && <TibaBeliModal beli={tiba} onClose={() => setTiba(null)} />}
      {buatOpen && <BuatBeliModal onClose={() => setBuatOpen(false)} />}
    </div>
  );
}

export function BeliStatusBadge({ status }: { status: BeliPerlengkapanRow["status"] }) {
  const map = {
    menunggu: { teks: "Menunggu dibeli", cls: "bg-amber-100 text-amber-800" },
    tiba: { teks: "Tiba di CK ✓", cls: "bg-blue-100 text-blue-800" },
    batal: { teks: "Dibatalkan", cls: "bg-stone-100 text-stone-500" },
  }[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map.cls}`}>{map.teks}</span>
  );
}

/** Konfirmasi barang tiba di CK: qty final + nilai belanja (opsional). */
export function TibaBeliModal({ beli, onClose }: { beli: BeliPerlengkapanRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(String(beli.qty));
  const [totalHarga, setTotalHarga] = useState(beli.total_harga ? String(beli.total_harga) : "");

  const simpan = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/beli/${beli.id}/tiba`, {
        method: "POST",
        body: {
          qty: Number(qty) || beli.qty,
          total_harga: totalHarga === "" ? null : Number(totalHarga),
        },
      }),
    onSuccess: () => {
      for (const key of ["perlengkapan-beli", "perlengkapan", "perlengkapan-kiriman", "penerimaan"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Tiba di CK — ${beli.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Barang masuk stok <b>{beli.ck_nama}</b>
          {beli.tujuan_nama ? (
            <>
              {" "}
              lalu <b>otomatis dikirim</b> ke <b>{beli.tujuan_nama}</b> (cabang tinggal menerima).
            </>
          ) : (
            <> (disimpan sebagai stok CK).</>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Jumlah yang tiba ({beli.satuan})</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Nilai belanja (opsional)</label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={totalHarga}
            onChange={(e) => setTotalHarga(e.target.value)}
            placeholder="mis. 50000"
            className={inputClass}
          />
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || !(Number(qty) > 0)}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "✅ Tiba & Kirim"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Buat faktur beli perlengkapan manual: item, CK, jumlah, cabang tujuan, harga. */
function BuatBeliModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const ckList = useMemo(
    () => cabang.filter((b) => b.tipe === "central_kitchen" && b.is_active),
    [cabang],
  );
  const storeList = useMemo(
    () => cabang.filter((b) => b.tipe === "store" && b.is_active),
    [cabang],
  );
  const { data: items = [] } = useQuery({
    queryKey: ["perlengkapan-master"],
    queryFn: () => api<PerlengkapanMasterRow[]>("/perlengkapan/master"),
  });

  const [supplyId, setSupplyId] = useState("");
  const [ckId, setCkId] = useState(ckList.length === 1 ? ckList[0].id : "");
  const [qty, setQty] = useState("");
  const [tujuanId, setTujuanId] = useState("");
  const [harga, setHarga] = useState("");
  const item = items.find((i) => i.id === supplyId);

  const simpan = useMutation({
    mutationFn: () =>
      api("/perlengkapan/beli", {
        method: "POST",
        body: {
          supply_id: supplyId,
          ck_branch_id: ckId || null,
          qty: Number(qty),
          tujuan_branch_id: tujuanId || null,
          total_harga: harga === "" ? null : Number(harga),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] });
      onClose();
    },
  });

  const valid = supplyId && Number(qty) > 0 && (ckList.length <= 1 || ckId);

  return (
    <Modal open onClose={onClose} title="Beli Perlengkapan ke CK">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Perlengkapan</label>
          <select value={supplyId} onChange={(e) => setSupplyId(e.target.value)} className={inputClass}>
            <option value="">— pilih item —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nama} ({i.satuan})
              </option>
            ))}
          </select>
        </div>
        {ckList.length > 1 && (
          <div>
            <label className="mb-1 block text-sm font-medium">Beli untuk CK</label>
            <select value={ckId} onChange={(e) => setCkId(e.target.value)} className={inputClass}>
              <option value="">— pilih CK —</option>
              {ckList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Jumlah {item ? `(${item.satuan})` : ""}
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Kirim ke cabang (opsional)</label>
          <select value={tujuanId} onChange={(e) => setTujuanId(e.target.value)} className={inputClass}>
            <option value="">— Stok CK saja (tidak dikirim) —</option>
            {storeList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nama}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-stone-400">
            Bila diisi, barang otomatis dikirim ke cabang ini setelah tiba di CK.
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Nilai belanja (opsional)</label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={harga}
            onChange={(e) => setHarga(e.target.value)}
            placeholder="mis. 50000"
            className={inputClass}
          />
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || !valid}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "Buat Faktur"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
