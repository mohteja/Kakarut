import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PerlengkapanRowDto } from "@kakarut/shared";
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
import { CabangDataBar } from "../../components/CabangDataBar";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

/** Label aturan konsumsi: "1 sachet / hari", "2 pcs / 3 hari", "nonaktif". */
function labelAturan(r: PerlengkapanRowDto): string | null {
  if (!r.aturan) return null;
  const per = r.aturan.per_hari === 1 ? "hari" : `${r.aturan.per_hari} hari`;
  const teks = `${formatAngka(r.aturan.qty)} ${r.satuan} / ${per}`;
  return r.aturan.aktif ? teks : `${teks} (nonaktif)`;
}

type ModalState =
  | { jenis: "item"; item: PerlengkapanRowDto | null }
  | { jenis: "aturan"; item: PerlengkapanRowDto }
  | null;

/**
 * MASTER perlengkapan non bahan baku (sendok, spons, sabun) — seperti halaman
 * Bahan Baku: hanya pengaturan nama, satuan, harga, stok minimum, dan aturan
 * konsumsi. Stok fisiknya (saldo, stok awal, stok masuk, opname, kiriman)
 * dikelola di halaman Stok → tab Perlengkapan.
 */
export function PerlengkapanPage() {
  const queryClient = useQueryClient();
  const { query: branchQuery } = useCabangData();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
  });

  const [modal, setModal] = useState<ModalState>(null);
  const [cari, setCari] = useState("");

  const segarkan = () => {
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
    <div className="max-w-3xl">
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
        Master barang <b>non bahan baku</b> (sendok, spons, sabun…) — seperti Bahan Baku:
        hanya pengaturan <b>nama, harga, dan aturan konsumsi</b>. Stok fisiknya (stok awal,
        stok masuk, opname, kiriman) dikelola di halaman <b>Stok → tab Perlengkapan</b>.
      </div>
      {/* Aturan konsumsi berlaku PER CABANG — pilih cabang datanya dari Kantor */}
      <CabangDataBar />
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
                <th className={thClass}>Satuan</th>
                <th className={`${thClass} text-right`}>Harga Beli</th>
                <th className={`${thClass} text-right`}>Stok Minimum</th>
                <th className={thClass}>Aturan Konsumsi</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {tampil.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50">
                  <td className={`${tdClass} font-medium`}>
                    {r.nama}
                    {r.catatan && (
                      <span className="ml-2 text-xs font-normal text-stone-400">{r.catatan}</span>
                    )}
                  </td>
                  <td className={`${tdClass} text-stone-500`}>{r.satuan}</td>
                  <td className={`${tdClass} text-right`}>
                    {r.harga_beli > 0 ? formatRupiah(r.harga_beli) : "—"}
                  </td>
                  <td className={`${tdClass} text-right text-stone-500`}>
                    {r.stok_minimum > 0 ? formatAngka(r.stok_minimum) : "—"}
                  </td>
                  <td className={`${tdClass} text-stone-600`}>
                    {labelAturan(r) ?? <span className="text-stone-400">manual</span>}
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
        <AturanModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
    </div>
  );
}

function ItemModal({
  item,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto | null;
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

function AturanModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState(item.aturan ? String(item.aturan.qty) : "1");
  const [perHari, setPerHari] = useState(item.aturan ? String(item.aturan.per_hari) : "1");
  const [aktif, setAktif] = useState(item.aturan?.aktif ?? true);
  const [mulai, setMulai] = useState(item.aturan?.mulai ?? "");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/aturan${branchQuery}`, {
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
    <Modal open onClose={onClose} title={`Aturan Konsumsi — ${item.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          Stok berkurang <b>otomatis</b> sesuai aturan — mis. sabun <b>1 sachet / hari</b> atau
          spons <b>1 pcs / 7 hari</b>. Berlaku untuk cabang yang sedang dipilih.
        </div>
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
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            ⏱ Simpan Aturan
          </button>
        </div>
      </div>
    </Modal>
  );
}
