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
import { formatAngka, formatRupiah, formatWaktu } from "../../lib/format";

/**
 * Satu FAKTUR beli perlengkapan (BP-) = kumpulan baris satu submit — tampilan
 * kartu per faktur, sejajar Beli Bahan Baku. Baris warisan tanpa faktur_id
 * diperlakukan sebagai faktur satu-item (kunci = id barisnya).
 */
interface FakturBeli {
  key: string;
  /** faktur_id server (null = baris warisan → aksi per baris) */
  fakturId: string | null;
  nomor: string | null;
  ckNama: string;
  tujuanNama: string | null;
  waktu: string;
  oleh: string | null;
  catatan: string | null;
  rows: BeliPerlengkapanRow[];
  /** menunggu > tiba > batal (masih ada yang menunggu = butuh aksi) */
  status: BeliPerlengkapanRow["status"];
  totalHarga: number;
}

function kelompokkanFaktur(rows: BeliPerlengkapanRow[]): FakturBeli[] {
  const byKey = new Map<string, FakturBeli>();
  for (const r of rows) {
    const key = r.faktur_id ?? r.id;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        fakturId: r.faktur_id,
        nomor: r.nomor,
        ckNama: r.ck_nama,
        tujuanNama: r.tujuan_nama,
        waktu: r.waktu,
        oleh: r.oleh,
        catatan: r.catatan,
        rows: [],
        status: r.status,
        totalHarga: 0,
      };
      byKey.set(key, g);
    }
    g.rows.push(r);
    if (r.total_harga != null && r.status !== "batal") g.totalHarga += r.total_harga;
    // status faktur: masih ada 'menunggu' → menunggu; ada 'tiba' → tiba; sisanya batal
    if (r.status === "menunggu") g.status = "menunggu";
    else if (r.status === "tiba" && g.status !== "menunggu") g.status = "tiba";
  }
  // menunggu (butuh aksi) dulu, lalu terbaru — mengikuti urutan server
  return [...byKey.values()].sort((a, b) => {
    const ba = a.status === "menunggu" ? 0 : 1;
    const bb = b.status === "menunggu" ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return b.waktu.localeCompare(a.waktu);
  });
}

/**
 * BELI PERLENGKAPAN ke Central Kitchen — sejajar "Beli Bahan Baku": satu
 * faktur BP- bisa memuat banyak item, dikelompokkan per kartu. Faktur lahir
 * otomatis saat permintaan cabang & stok CK kurang, atau dibuat manual di
 * sini. Alur: beli → Tiba di CK (masuk stok CK) → otomatis dikirim ke cabang.
 */
export function BeliPerlengkapanPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [tiba, setTiba] = useState<FakturBeli | null>(null);
  const [buatOpen, setBuatOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["perlengkapan-beli"],
    queryFn: () => api<BeliPerlengkapanRow[]>("/perlengkapan/beli"),
  });
  const grup = useMemo(() => kelompokkanFaktur(rows), [rows]);
  const batal = useMutation({
    mutationFn: (g: FakturBeli) =>
      g.fakturId
        ? api(`/perlengkapan/beli/faktur/${g.fakturId}/batal`, { method: "POST", body: {} })
        : api(`/perlengkapan/beli/${g.rows[0].id}/batal`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });
  // bersih-bersih massal: faktur lama yang permintaannya sudah terhapus
  // (pra-tautan rencana) tak bisa dibatalkan otomatis — batalkan sekaligus
  const batalSemua = useMutation({
    mutationFn: () => api(`/perlengkapan/beli/batal-semua`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] }),
  });

  const menunggu = grup.filter((g) => g.status === "menunggu");

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
        Faktur beli perlengkapan <b>ke Central Kitchen</b> — satu faktur bisa berisi{" "}
        <b>banyak item</b>, seperti Beli Bahan Baku. Lahir otomatis saat cabang minta &amp; stok
        CK kurang, atau dibuat manual. Tandai <b>Tiba di CK</b> → semua barang masuk stok CK lalu{" "}
        <b>otomatis dikirim</b> ke cabang tujuan.
      </div>
      <ErrorText error={batal.error} />
      <ErrorText error={batalSemua.error} />

      {isLoading ? (
        <Spinner />
      ) : grup.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada faktur beli perlengkapan.
        </Card>
      ) : (
        <div className="space-y-3">
          {menunggu.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-2">
              <span className="text-xs font-semibold text-amber-800">
                {menunggu.length} faktur menunggu dibeli
              </span>
              {isManajemen && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Batalkan SEMUA ${menunggu.length} faktur yang menunggu dibeli? (yang sudah tiba tidak disentuh)`,
                      )
                    )
                      batalSemua.mutate();
                  }}
                  className="rounded-lg px-2 py-0.5 text-xs font-medium text-red-500 hover:bg-red-50"
                >
                  🧹 Batalkan semua
                </button>
              )}
            </div>
          )}
          {grup.map((g) => (
            <Card key={g.key} className="overflow-hidden">
              {/* kepala kartu: nomor + arah + status */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 bg-stone-50 px-4 py-2.5">
                {g.nomor && (
                  <span className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs font-bold text-stone-700">
                    {g.nomor}
                  </span>
                )}
                <span className="text-xs text-stone-500">
                  {g.ckNama}
                  {g.tujuanNama ? ` → ${g.tujuanNama}` : " (stok CK)"}
                </span>
                <BeliStatusBadge status={g.status} />
                <span className="ml-auto text-xs text-stone-400">
                  {formatWaktu(g.waktu)}
                  {g.oleh ? ` · ${g.oleh}` : ""}
                </span>
              </div>
              {/* baris item */}
              <div className="divide-y divide-stone-50">
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
                  >
                    <span className="font-semibold text-stone-800">{r.nama}</span>
                    <span className="text-stone-500">
                      {formatAngka(r.qty)} {r.satuan}
                    </span>
                    {g.rows.length > 1 && r.status !== g.status && (
                      <BeliStatusBadge status={r.status} />
                    )}
                    {r.total_harga != null && r.total_harga > 0 && (
                      <span className="ml-auto text-xs text-stone-500">
                        {formatRupiah(r.total_harga)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {/* kaki kartu: ringkasan + aksi */}
              <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-2">
                <span className="text-xs text-stone-500">
                  {g.rows.length} item
                  {g.totalHarga > 0 && <> · {formatRupiah(g.totalHarga)}</>}
                </span>
                {isManajemen && g.status === "menunggu" && (
                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={() => setTiba(g)}
                      className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      ✅ Tiba di CK
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Batalkan faktur beli ${g.nomor ?? "ini"}?`))
                          batal.mutate(g);
                      }}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tiba && <TibaFakturModal faktur={tiba} onClose={() => setTiba(null)} />}
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

/**
 * Konfirmasi barang SATU FAKTUR tiba di CK: qty final + nilai belanja per
 * item. Semua baris 'menunggu' diproses sekaligus → masuk stok CK + otomatis
 * dikirim ke cabang tujuan.
 */
function TibaFakturModal({ faktur, onClose }: { faktur: FakturBeli; onClose: () => void }) {
  const queryClient = useQueryClient();
  const barisMenunggu = faktur.rows.filter((r) => r.status === "menunggu");
  const [draft, setDraft] = useState<Record<string, { qty: string; harga: string }>>(() =>
    Object.fromEntries(
      barisMenunggu.map((r) => [
        r.id,
        { qty: String(r.qty), harga: r.total_harga ? String(r.total_harga) : "" },
      ]),
    ),
  );

  const simpan = useMutation({
    mutationFn: () => {
      const items = barisMenunggu.map((r) => ({
        id: r.id,
        qty: Number(draft[r.id]?.qty) || r.qty,
        total_harga: draft[r.id]?.harga === "" ? null : Number(draft[r.id]?.harga),
      }));
      if (faktur.fakturId) {
        return api(`/perlengkapan/beli/faktur/${faktur.fakturId}/tiba`, {
          method: "POST",
          body: { items },
        });
      }
      // baris warisan tanpa faktur — endpoint per baris
      const it = items[0];
      return api(`/perlengkapan/beli/${it.id}/tiba`, {
        method: "POST",
        body: { qty: it.qty, total_harga: it.total_harga },
      });
    },
    onSuccess: () => {
      for (const key of ["perlengkapan-beli", "perlengkapan", "perlengkapan-kiriman", "penerimaan"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });

  const adaInvalid = barisMenunggu.some((r) => !(Number(draft[r.id]?.qty) > 0));

  return (
    <Modal open onClose={onClose} title={`Tiba di CK — ${faktur.nomor ?? "faktur"}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Barang masuk stok <b>{faktur.ckNama}</b>
          {faktur.tujuanNama ? (
            <>
              {" "}
              lalu <b>otomatis dikirim</b> ke <b>{faktur.tujuanNama}</b> (cabang tinggal
              menerima).
            </>
          ) : (
            <> (disimpan sebagai stok CK).</>
          )}
        </div>
        <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {barisMenunggu.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-[8rem] flex-1 text-sm font-medium text-stone-800">
                {r.nama}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={draft[r.id]?.qty ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, [r.id]: { ...p[r.id], qty: e.target.value } }))
                }
                aria-label={`Jumlah tiba ${r.nama}`}
                className={`${inputClass} !w-24`}
              />
              <span className="text-xs text-stone-500">{r.satuan}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={draft[r.id]?.harga ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, [r.id]: { ...p[r.id], harga: e.target.value } }))
                }
                placeholder="harga (Rp)"
                aria-label={`Nilai belanja ${r.nama}`}
                className={`${inputClass} !w-28`}
              />
            </div>
          ))}
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={simpan.isPending || adaInvalid}
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : "✅ Tiba & Kirim"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface BarisBeliDraft {
  supplyId: string;
  qty: string;
  harga: string;
}

/** Buat faktur beli perlengkapan manual MULTI-ITEM: daftar item + CK + cabang tujuan. */
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

  const [baris, setBaris] = useState<BarisBeliDraft[]>([{ supplyId: "", qty: "", harga: "" }]);
  const [ckId, setCkId] = useState(ckList.length === 1 ? ckList[0].id : "");
  const [tujuanId, setTujuanId] = useState("");

  function ubahBaris(i: number, patch: Partial<BarisBeliDraft>) {
    setBaris((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  const barisValid = baris.filter((b) => b.supplyId && Number(b.qty) > 0);
  const simpan = useMutation({
    mutationFn: () =>
      api("/perlengkapan/beli", {
        method: "POST",
        body: {
          items: barisValid.map((b) => ({
            supply_id: b.supplyId,
            qty: Number(b.qty),
            total_harga: b.harga === "" ? null : Number(b.harga),
          })),
          ck_branch_id: ckId || null,
          tujuan_branch_id: tujuanId || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["perlengkapan-beli"] });
      onClose();
    },
  });

  const valid = barisValid.length > 0 && (ckList.length <= 1 || ckId);

  return (
    <Modal open onClose={onClose} title="Beli Perlengkapan ke CK">
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Satu faktur (BP-) bisa berisi banyak item — semua dibeli bersama lalu ditandai{" "}
          <b>Tiba di CK</b> sekaligus.
        </div>
        <div className="space-y-2">
          {baris.map((b, i) => {
            const item = items.find((x) => x.id === b.supplyId);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={b.supplyId}
                  onChange={(e) => ubahBaris(i, { supplyId: e.target.value })}
                  aria-label={`Perlengkapan baris ${i + 1}`}
                  className={`${inputClass} !w-auto min-w-[10rem] flex-1`}
                >
                  <option value="">— pilih item —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nama} ({it.satuan})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={b.qty}
                  onChange={(e) => ubahBaris(i, { qty: e.target.value })}
                  placeholder={item ? `qty (${item.satuan})` : "qty"}
                  aria-label={`Jumlah baris ${i + 1}`}
                  className={`${inputClass} !w-24`}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={b.harga}
                  onChange={(e) => ubahBaris(i, { harga: e.target.value })}
                  placeholder="harga (Rp)"
                  aria-label={`Harga baris ${i + 1}`}
                  className={`${inputClass} !w-28`}
                />
                {baris.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBaris((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Hapus baris ${i + 1}`}
                    className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setBaris((prev) => [...prev, { supplyId: "", qty: "", harga: "" }])}
            className="text-xs font-medium text-orange-600 hover:underline"
          >
            ➕ Tambah item
          </button>
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
            Bila diisi, semua barang otomatis dikirim ke cabang ini setelah tiba di CK.
          </div>
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
