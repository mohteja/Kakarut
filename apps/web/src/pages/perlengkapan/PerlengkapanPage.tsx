import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PerlengkapanAturanDto, PerlengkapanMasterRow } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
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
import { formatAngka, formatRupiah } from "../../lib/format";

/** Label aturan konsumsi: "1 / hari", "2 / 3 hari", "(nonaktif)". */
function labelAturan(a: PerlengkapanAturanDto, satuan: string): string {
  const per = a.per_hari === 1 ? "hari" : `${a.per_hari} hari`;
  const teks = `${formatAngka(a.qty)} ${satuan} / ${per}`;
  return a.aktif ? teks : `${teks} (nonaktif)`;
}

type ModalState =
  | { jenis: "item"; item: PerlengkapanMasterRow | null }
  | { jenis: "aturan"; item: PerlengkapanMasterRow }
  | null;

/**
 * MASTER perlengkapan non bahan baku (sendok, spons, sabun) — seperti halaman
 * Bahan Baku: hanya pengaturan nama, satuan, harga, stok minimum, dan aturan
 * konsumsi. TANPA pemilih cabang: semua item tampil, tiap produk menunjukkan
 * "ada di cabang mana saja". Stok fisiknya dikelola di Stok → tab Perlengkapan.
 */
export function PerlengkapanPage() {
  const queryClient = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["perlengkapan-master"],
    queryFn: () => api<PerlengkapanMasterRow[]>("/perlengkapan/master"),
  });

  const [modal, setModal] = useState<ModalState>(null);
  const [cari, setCari] = useState("");

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-master"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
  };

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/perlengkapan/${id}`, { method: "DELETE" }),
    onSuccess: segarkan,
  });

  const tampil = (rows ?? []).filter((r) =>
    r.nama.toLowerCase().includes(cari.toLowerCase()),
  );

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <button onClick={() => setModal({ jenis: "item", item: null })} className={btnPrimary}>
            ➕ Tambah Perlengkapan
          </button>
        }
      >
        🧰 Perlengkapan
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Master barang <b>non bahan baku</b> (sendok, spons, sabun…) berlaku se-perusahaan —
        hanya pengaturan <b>nama, harga, dan aturan konsumsi</b>. Kolom <b>Ada di</b>{" "}
        menunjukkan cabang yang memegang stoknya. Stok fisik (stok awal, stok masuk, opname,
        kiriman) dikelola di halaman <b>Stok → tab Perlengkapan</b>.
      </div>
      <ErrorText error={hapus.error} />

      <div className="mb-3">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari perlengkapan…"
          className={`${inputClass} max-w-xs`}
        />
      </div>

      {isLoading ? (
        <Spinner />
      ) : tampil.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {cari
            ? "Tidak ada perlengkapan yang cocok."
            : "Belum ada perlengkapan. Tambahkan lewat “➕ Tambah Perlengkapan”."}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={thClass}>Perlengkapan</th>
                <th className={`${thClass} text-right`}>Harga Beli</th>
                <th className={`${thClass} text-right`}>Stok Minimum</th>
                <th className={thClass}>Ada di (saldo · aturan konsumsi)</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {tampil.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50">
                  <td className={`${tdClass} font-medium`}>
                    {r.nama} <span className="text-xs font-normal text-stone-400">({r.satuan})</span>
                    {r.catatan && (
                      <div className="text-xs font-normal text-stone-400">{r.catatan}</div>
                    )}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {r.harga_beli > 0 ? formatRupiah(r.harga_beli) : "—"}
                  </td>
                  <td className={`${tdClass} text-right text-stone-500`}>
                    {r.stok_minimum > 0 ? formatAngka(r.stok_minimum) : "—"}
                  </td>
                  <td className={tdClass}>
                    {r.lokasi.length === 0 ? (
                      <span className="text-xs text-stone-400">belum ada di cabang mana pun</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.lokasi.map((l) => (
                          <span
                            key={l.branch_id}
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              l.status === "habis"
                                ? "bg-red-50 text-red-700"
                                : l.status === "menipis"
                                  ? "bg-amber-50 text-amber-800"
                                  : "bg-stone-100 text-stone-700"
                            }`}
                            title={`${l.branch_nama}: saldo ${formatAngka(l.saldo)} ${r.satuan}${l.aturan ? ` · aturan ${labelAturan(l.aturan, r.satuan)}` : ""}`}
                          >
                            🏪 {l.branch_nama} · <b>{formatAngka(l.saldo)}</b> {r.satuan}
                            {l.aturan && <> · ⏱ {labelAturan(l.aturan, r.satuan)}</>}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <span className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setModal({ jenis: "aturan", item: r })}
                        className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        ⏱ Aturan
                      </button>
                      <button
                        onClick={() => setModal({ jenis: "item", item: r })}
                        className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                      >
                        ✏️ Ubah
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Hapus perlengkapan "${r.nama}"? Riwayatnya tetap tersimpan.`))
                            hapus.mutate(r.id);
                        }}
                        className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        🗑
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modal?.jenis === "item" && (
        <ItemModal item={modal.item} onClose={() => setModal(null)} onSukses={segarkan} />
      )}
      {modal?.jenis === "aturan" && (
        <AturanModal item={modal.item} onClose={() => setModal(null)} onSukses={segarkan} />
      )}
    </div>
  );
}

function ItemModal({
  item,
  onClose,
  onSukses,
}: {
  item: PerlengkapanMasterRow | null;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [nama, setNama] = useState(item?.nama ?? "");
  const [satuan, setSatuan] = useState(item?.satuan ?? "pcs");
  const [hargaBeli, setHargaBeli] = useState(item ? String(item.harga_beli) : "");
  const [stokMin, setStokMin] = useState(item ? String(item.stok_minimum) : "");
  const [catatan, setCatatan] = useState(item?.catatan ?? "");
  const simpan = useMutation({
    mutationFn: () =>
      api(item ? `/perlengkapan/${item.id}` : "/perlengkapan", {
        method: item ? "PATCH" : "POST",
        body: {
          nama: nama.trim(),
          satuan: satuan.trim() || "pcs",
          harga_beli: Number(hargaBeli) || 0,
          stok_minimum: Number(stokMin) || 0,
          catatan: catatan.trim() || null,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={item ? `Ubah ${item.nama}` : "Tambah Perlengkapan"}>
      <div className="space-y-3">
        <label className="block text-sm">
          Nama
          <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} placeholder="mis. Sabun cuci piring" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Satuan
            <input value={satuan} onChange={(e) => setSatuan(e.target.value)} className={inputClass} placeholder="pcs / sachet / botol" />
          </label>
          <label className="block text-sm">
            Harga beli / satuan (Rp)
            <input type="number" min={0} value={hargaBeli} onChange={(e) => setHargaBeli(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block text-sm">
          Stok minimum (peringatan menipis)
          <input type="number" min={0} value={stokMin} onChange={(e) => setStokMin(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm">
          Catatan
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => simpan.mutate()}
            disabled={!nama.trim() || simpan.isPending}
            className={btnPrimary}
          >
            Simpan
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Aturan konsumsi berlaku PER CABANG — cabangnya dipilih di dalam modal
 * (halaman master tidak lagi punya pemilih cabang).
 */
function AturanModal({
  item,
  onClose,
  onSukses,
}: {
  item: PerlengkapanMasterRow;
  onClose: () => void;
  onSukses: () => void;
}) {
  const { cabang } = useBranch();
  // kantor tidak menyimpan stok — aturan hanya untuk store / central kitchen
  const opsi = cabang.filter((b) => b.tipe !== "kantor");
  const [branchId, setBranchId] = useState(
    item.lokasi[0]?.branch_id ?? opsi[0]?.id ?? "",
  );
  const aturan = item.lokasi.find((l) => l.branch_id === branchId)?.aturan ?? null;
  return (
    <Modal open onClose={onClose} title={`Aturan Konsumsi — ${item.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          Stok berkurang <b>otomatis</b> sesuai aturan — mis. sabun <b>1 sachet / hari</b> atau
          spons <b>1 pcs / 7 hari</b>. Aturan berlaku <b>per cabang</b>.
        </div>
        <label className="block text-sm">
          Cabang
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={inputClass}
          >
            {opsi.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nama}
              </option>
            ))}
          </select>
        </label>
        {/* key = cabang → form ter-reset ke aturan cabang terpilih */}
        <AturanForm
          key={branchId}
          item={item}
          branchId={branchId}
          aturan={aturan}
          onClose={onClose}
          onSukses={onSukses}
        />
      </div>
    </Modal>
  );
}

function AturanForm({
  item,
  branchId,
  aturan,
  onClose,
  onSukses,
}: {
  item: PerlengkapanMasterRow;
  branchId: string;
  aturan: PerlengkapanAturanDto | null;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState(aturan ? String(aturan.qty) : "1");
  const [perHari, setPerHari] = useState(aturan ? String(aturan.per_hari) : "1");
  const [aktif, setAktif] = useState(aturan?.aktif ?? true);
  const [mulai, setMulai] = useState(aturan?.mulai ?? "");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/aturan?branch_id=${branchId}`, {
        method: "PUT",
        body: {
          qty: Number(qty),
          per_hari: Number(perHari) || 1,
          aktif,
          mulai: mulai || undefined,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <>
      {aturan && (
        <div className="text-xs text-stone-500">
          Aturan saat ini: <b>{formatAngka(aturan.qty)} {item.satuan}</b> /{" "}
          {aturan.per_hari === 1 ? "hari" : `${aturan.per_hari} hari`}
          {aturan.aktif ? "" : " (nonaktif)"}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Jumlah terpakai ({item.satuan})
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm">
          Setiap … hari
          <input type="number" min={1} max={365} value={perHari} onChange={(e) => setPerHari(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm">
        Mulai berlaku (kosong = hari ini)
        <input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
        Aturan aktif
      </label>
      <ErrorText error={kirim.error} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnSecondary}>Batal</button>
        <button
          onClick={() => kirim.mutate()}
          disabled={!branchId || !(Number(qty) > 0) || kirim.isPending}
          className={btnPrimary}
        >
          ⏱ Simpan Aturan
        </button>
      </div>
    </>
  );
}
