import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BelanjaPerlengkapanDto, PerlengkapanRowDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { CabangDataBar } from "../../components/CabangDataBar";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import { KartuPerlengkapanModal } from "./KartuPerlengkapanModal";

/** Label aturan konsumsi: "1 sachet / hari", "2 pcs / 3 hari", "nonaktif". */
function labelAturan(r: PerlengkapanRowDto): string | null {
  if (!r.aturan) return null;
  const per = r.aturan.per_hari === 1 ? "hari" : `${r.aturan.per_hari} hari`;
  const teks = `${formatAngka(r.aturan.qty)} ${r.satuan} / ${per}`;
  return r.aturan.aktif ? teks : `${teks} (nonaktif)`;
}

type ModalState =
  | { jenis: "item"; item: PerlengkapanRowDto | null }
  | { jenis: "masuk" | "pakai" | "koreksi" | "aturan" | "kartu"; item: PerlengkapanRowDto }
  | null;

/**
 * Perlengkapan non bahan baku (sendok, spons, sabun): modul mandiri di luar
 * Bahan Baku — tidak menyentuh resep/HPP. Stok per cabang; pemakaian dicatat
 * manual (semua peran) atau otomatis lewat aturan harian (owner/admin).
 */
export function PerlengkapanPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { query: branchQuery } = useCabangData();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";

  const { data: rows, isLoading } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
  });
  const { data: belanja } = useQuery({
    queryKey: ["perlengkapan-belanja", branchQuery],
    queryFn: () => api<BelanjaPerlengkapanDto>(`/perlengkapan/belanja${branchQuery}`),
    enabled: isManajemen,
  });

  const [modal, setModal] = useState<ModalState>(null);
  const [cari, setCari] = useState("");

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-belanja"] });
    queryClient.invalidateQueries({ queryKey: ["kartu-perlengkapan"] });
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
          isManajemen ? (
            <button onClick={() => setModal({ jenis: "item", item: null })} className={btnPrimary}>
              ➕ Tambah Perlengkapan
            </button>
          ) : undefined
        }
      >
        🧰 Perlengkapan
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Barang <b>non bahan baku</b> (sendok, spons, sabun…) — di luar resep & HPP. Pemakaian
        dicatat lewat tombol <b>Pakai</b>, atau otomatis lewat <b>Aturan</b> (mis. sabun 1
        sachet/hari).
      </div>
      <CabangDataBar />
      <ErrorText error={hapus.error} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari perlengkapan…"
          className={`${inputClass} max-w-xs`}
        />
        {isManajemen && belanja && (
          <div className="ml-auto rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-700">
            🛒 Belanja bulan ini: <b>{formatRupiah(belanja.total)}</b>
          </div>
        )}
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
        <div className="space-y-2">
          {tampil.map((r) => (
            <Card key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-stone-800">{r.nama}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
                    {labelAturan(r) && <span>⏱ {labelAturan(r)}</span>}
                    {r.stok_minimum > 0 && (
                      <span>min {formatAngka(r.stok_minimum)} {r.satuan}</span>
                    )}
                    {r.catatan && <span>· {r.catatan}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-stone-800">
                    {formatAngka(r.saldo)}{" "}
                    <span className="text-sm font-normal text-stone-500">{r.satuan}</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-100 pt-2">
                <button
                  onClick={() => setModal({ jenis: "pakai", item: r })}
                  className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700"
                >
                  ✂️ Pakai
                </button>
                {isManajemen && (
                  <>
                    <button
                      onClick={() => setModal({ jenis: "masuk", item: r })}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      📦 Stok Masuk
                    </button>
                    <button
                      onClick={() => setModal({ jenis: "aturan", item: r })}
                      className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      ⏱ Aturan
                    </button>
                    <button
                      onClick={() => setModal({ jenis: "koreksi", item: r })}
                      className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      🧮 Koreksi Fisik
                    </button>
                  </>
                )}
                <button
                  onClick={() => setModal({ jenis: "kartu", item: r })}
                  className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                >
                  📒 Kartu
                </button>
                {isManajemen && (
                  <span className="ml-auto flex gap-1.5">
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
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal?.jenis === "item" && (
        <ItemModal item={modal.item} onClose={() => setModal(null)} onSukses={segarkan} />
      )}
      {modal?.jenis === "pakai" && (
        <PakaiModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "masuk" && (
        <MasukModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "koreksi" && (
        <KoreksiModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "aturan" && (
        <AturanModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "kartu" && (
        <KartuPerlengkapanModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
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

function PakaiModal({
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
  const [qty, setQty] = useState("1");
  const [catatan, setCatatan] = useState("");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/pakai${branchQuery}`, {
        method: "POST",
        body: { qty: Number(qty), catatan: catatan.trim() || null },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Catat Pemakaian — ${item.nama}`}>
      <div className="space-y-3">
        <div className="text-sm text-stone-500">
          Saldo saat ini: <b>{formatAngka(item.saldo)} {item.satuan}</b>
        </div>
        <label className="block text-sm">
          Jumlah dipakai ({item.satuan})
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} placeholder="mis. cuci peralatan dapur" />
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            ✂️ Catat Pakai
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MasukModal({
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
  const [qty, setQty] = useState("");
  const [totalHarga, setTotalHarga] = useState("");
  const [catatan, setCatatan] = useState("");
  // harga default = qty × harga beli item (bisa ditimpa manual)
  const perkiraan = Number(qty) > 0 && item.harga_beli > 0 ? Number(qty) * item.harga_beli : null;
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/masuk${branchQuery}`, {
        method: "POST",
        body: {
          qty: Number(qty),
          total_harga: totalHarga !== "" ? Number(totalHarga) : perkiraan,
          catatan: catatan.trim() || null,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Stok Masuk — ${item.nama}`}>
      <div className="space-y-3">
        <label className="block text-sm">
          Jumlah masuk ({item.satuan})
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Total harga (Rp{perkiraan != null ? ` — perkiraan ${formatRupiah(perkiraan)}` : ", opsional"})
          <input
            type="number"
            min={0}
            value={totalHarga}
            onChange={(e) => setTotalHarga(e.target.value)}
            className={inputClass}
            placeholder={perkiraan != null ? String(perkiraan) : "0"}
          />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} placeholder="mis. beli di toko grosir" />
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            📦 Simpan
          </button>
        </div>
      </div>
    </Modal>
  );
}

function KoreksiModal({
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
  const [fisik, setFisik] = useState("");
  const [catatan, setCatatan] = useState("");
  const selisih = fisik === "" ? null : Number(fisik) - item.saldo;
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/koreksi${branchQuery}`, {
        method: "POST",
        body: { qty_fisik: Number(fisik), catatan: catatan.trim() || null },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Koreksi Fisik — ${item.nama}`}>
      <div className="space-y-3">
        <div className="text-sm text-stone-500">
          Saldo sistem: <b>{formatAngka(item.saldo)} {item.satuan}</b>
        </div>
        <label className="block text-sm">
          Jumlah fisik hasil hitung ({item.satuan})
          <input type="number" min={0} step="any" value={fisik} onChange={(e) => setFisik(e.target.value)} className={inputClass} autoFocus />
        </label>
        {selisih != null && selisih !== 0 && (
          <div className={`rounded-lg px-3 py-2 text-sm ${selisih < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            Selisih {selisih > 0 ? "+" : ""}{formatAngka(selisih)} {item.satuan} akan dicatat sebagai koreksi.
          </div>
        )}
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={fisik === "" || Number(fisik) < 0 || kirim.isPending}
            className={btnPrimary}
          >
            🧮 Simpan Koreksi
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
