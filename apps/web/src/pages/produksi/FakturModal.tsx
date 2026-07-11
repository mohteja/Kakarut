import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BahanDto, JenisPengadaan, PenyimpananDto, SupplierDto } from "@kakarut/shared";
import {
  ErrorText,
  Modal,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

interface ItemForm {
  ingredient_id: string;
  mode: "pcs" | "batch";
  jumlah: string;
  storage_location_id: string;
  total_harga: string;
}

interface Karyawan {
  user_id: string;
  nama: string;
  is_active: boolean;
  role: string;
}

const itemKosong: ItemForm = {
  ingredient_id: "",
  mode: "pcs",
  jumlah: "",
  storage_location_id: "",
  total_harga: "",
};

/** Quick-add inline: input nama + simpan, untuk supplier / tempat penyimpanan. */
function QuickAdd({
  placeholder,
  onSubmit,
  pending,
}: {
  placeholder: string;
  onSubmit: (nama: string) => void;
  pending: boolean;
}) {
  const [nama, setNama] = useState("");
  return (
    <div className="mt-1 flex gap-2">
      <input
        value={nama}
        onChange={(e) => setNama(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} flex-1`}
      />
      <button
        type="button"
        disabled={!nama.trim() || pending}
        onClick={() => {
          onSubmit(nama.trim());
          setNama("");
        }}
        className={btnSecondary}
      >
        Simpan
      </button>
    </div>
  );
}

export function FakturModal({
  tipe,
  endpoint,
  onClose,
}: {
  tipe: JenisPengadaan;
  endpoint: string;
  onClose: () => void;
}) {
  const { auth } = useAuth();
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";

  const { data: bahan } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const { data: supplier = [] } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  const { data: tempat = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  // karyawan pelaksana — wajib untuk faktur produksi (halaman ini owner/admin)
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
    enabled: tipe === "produksi",
  });

  // hanya bahan sesuai jalur DAN yang dilacak stoknya
  const bahanJalur = (bahan ?? []).filter((b) => b.pengadaan === tipe && b.track_stok);

  const [supplierId, setSupplierId] = useState(""); // jalur beli
  // jalur produksi: satu dropdown pelaksana, value "k:<user_id>" / "s:<supplier_id>"
  const [pelaksana, setPelaksana] = useState("");
  const [noFaktur, setNoFaktur] = useState("");
  const [catatan, setCatatan] = useState("");
  const [items, setItems] = useState<ItemForm[]>([{ ...itemKosong }]);
  const [tambahSupplier, setTambahSupplier] = useState(false);
  const [tambahTempat, setTambahTempat] = useState(false);

  const supplierBaru = useMutation({
    mutationFn: (nama: string) => api<SupplierDto>("/supplier", { method: "POST", body: { nama } }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      if (tipe === "produksi") setPelaksana(`s:${s.id}`);
      else setSupplierId(s.id);
      setTambahSupplier(false);
    },
  });
  const tempatBaru = useMutation({
    mutationFn: (nama: string) =>
      api<PenyimpananDto>("/penyimpanan", {
        method: "POST",
        body: { nama, ...(!isKasir && branchId ? { branch_id: branchId } : {}) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
      setTambahTempat(false);
    },
  });

  function ubahItem(i: number, patch: Partial<ItemForm>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  // Pecah pilihan pelaksana produksi jadi worker_id / supplier_id
  const [pelTipe, pelId] = pelaksana ? pelaksana.split(":") : ["", ""];

  const simpan = useMutation({
    mutationFn: () =>
      api(`${endpoint}/faktur`, {
        method: "POST",
        body: {
          ...(!isKasir && branchId ? { branch_id: branchId } : {}),
          supplier_id:
            tipe === "produksi" ? (pelTipe === "s" ? pelId : null) : supplierId || null,
          ...(tipe === "produksi" ? { worker_id: pelTipe === "k" ? pelId : null } : {}),
          no_faktur: noFaktur || null,
          catatan: catatan || null,
          items: items
            .filter((it) => it.ingredient_id && Number(it.jumlah) > 0)
            .map((it) => ({
              ingredient_id: it.ingredient_id,
              mode: it.mode,
              jumlah: Number(it.jumlah),
              storage_location_id: it.storage_location_id || null,
              ...(tipe === "beli" && it.total_harga
                ? { total_harga: Number(it.total_harga) }
                : {}),
            })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      onClose();
    },
  });

  const itemValid = items.filter((it) => it.ingredient_id && Number(it.jumlah) > 0);
  const totalFaktur = items.reduce((a, it) => {
    const b = bahanJalur.find((x) => x.id === it.ingredient_id);
    if (!b || !(Number(it.jumlah) > 0)) return a;
    const qty = it.mode === "batch" ? Number(it.jumlah) * b.isi : Number(it.jumlah);
    const harga = it.total_harga ? Number(it.total_harga) : Math.round((qty / b.isi) * b.harga_beli);
    return a + harga;
  }, 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={tipe === "produksi" ? "Faktur Produksi Bahan Baku" : "Faktur Beli Bahan Baku"}
      lebar="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            {tipe === "produksi" ? (
              <>
                <label className="mb-1 block text-sm font-medium">
                  Dikerjakan oleh (pelaksana) <span className="text-red-600">*</span>
                </label>
                <select
                  value={pelaksana}
                  onChange={(e) => setPelaksana(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— pilih pelaksana —</option>
                  {karyawan
                    .filter((k) => k.is_active)
                    .map((k) => (
                      <option key={`k:${k.user_id}`} value={`k:${k.user_id}`}>
                        {k.nama} (karyawan)
                      </option>
                    ))}
                  {supplier
                    .filter((s) => s.is_active)
                    .map((s) => (
                      <option key={`s:${s.id}`} value={`s:${s.id}`}>
                        {s.nama} (supplier)
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <>
                <label className="mb-1 block text-sm font-medium">Sumber (supplier/toko)</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— tanpa sumber —</option>
                  {supplier
                    .filter((s) => s.is_active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nama}
                      </option>
                    ))}
                </select>
              </>
            )}
            <button
              type="button"
              onClick={() => setTambahSupplier(!tambahSupplier)}
              className="mt-1 text-xs font-medium text-orange-600 hover:underline"
            >
              ➕ Tambah supplier baru
            </button>
            {tambahSupplier && (
              <QuickAdd
                placeholder="nama supplier/sumber"
                onSubmit={(n) => supplierBaru.mutate(n)}
                pending={supplierBaru.isPending}
              />
            )}
            <ErrorText error={supplierBaru.error} />
          </div>
          <div>
            {tipe === "beli" && (
              <>
                <label className="mb-1 block text-sm font-medium">No. faktur/nota (opsional)</label>
                <input
                  value={noFaktur}
                  onChange={(e) => setNoFaktur(e.target.value)}
                  className={inputClass}
                  placeholder="mis. INV-0123"
                />
              </>
            )}
            <label className="mb-1 mt-2 block text-sm font-medium">Catatan</label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className={inputClass}
              placeholder="opsional"
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-stone-700">
              Daftar bahan ({itemValid.length})
            </div>
            <button
              type="button"
              onClick={() => setItems([...items, { ...itemKosong }])}
              className={btnSecondary}
            >
              + Tambah baris
            </button>
          </div>

          <div className="space-y-3">
            {items.map((it, i) => {
              const b = bahanJalur.find((x) => x.id === it.ingredient_id);
              const qtyPcs =
                b && Number(it.jumlah) > 0
                  ? it.mode === "batch"
                    ? Number(it.jumlah) * b.isi
                    : Number(it.jumlah)
                  : 0;
              const estimasi = b && qtyPcs > 0 ? Math.round((qtyPcs / b.isi) * b.harga_beli) : null;
              return (
                <div key={i} className="rounded-lg border border-stone-200 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-56 flex-1">
                      <label className="mb-1 block text-xs font-medium">Bahan</label>
                      <select
                        value={it.ingredient_id}
                        onChange={(e) => ubahItem(i, { ingredient_id: e.target.value })}
                        className={inputClass}
                      >
                        <option value="">— pilih bahan —</option>
                        {bahanJalur.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nama} (1 batch = {formatAngka(x.isi)} {x.satuan})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Satuan</label>
                      <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
                        <button
                          type="button"
                          onClick={() => ubahItem(i, { mode: "pcs" })}
                          className={`px-3 py-2 font-medium ${it.mode === "pcs" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                        >
                          Pcs
                        </button>
                        <button
                          type="button"
                          onClick={() => ubahItem(i, { mode: "batch" })}
                          className={`px-3 py-2 font-medium ${it.mode === "batch" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                        >
                          Batch
                        </button>
                      </div>
                    </div>
                    <div className="w-24">
                      <label className="mb-1 block text-xs font-medium">Jumlah</label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        value={it.jumlah}
                        onChange={(e) => ubahItem(i, { jumlah: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div className="min-w-40 flex-1">
                      <label className="mb-1 block text-xs font-medium">Disimpan di</label>
                      <select
                        value={it.storage_location_id}
                        onChange={(e) => ubahItem(i, { storage_location_id: e.target.value })}
                        className={inputClass}
                      >
                        <option value="">— pilih tempat —</option>
                        {tempat
                          .filter((t) => t.is_active)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nama}
                            </option>
                          ))}
                      </select>
                    </div>
                    {tipe === "beli" && (
                      <div className="w-32">
                        <label className="mb-1 block text-xs font-medium">Harga (Rp)</label>
                        <input
                          type="number"
                          min="0"
                          value={it.total_harga}
                          onChange={(e) => ubahItem(i, { total_harga: e.target.value })}
                          className={inputClass}
                          placeholder={estimasi != null ? String(estimasi) : "otomatis"}
                        />
                      </div>
                    )}
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems(items.filter((_, j) => j !== i))}
                        className="pb-2 text-red-500 hover:text-red-700"
                        aria-label="Hapus baris"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {b && it.mode === "batch" && Number(it.jumlah) > 0 && (
                    <div className="mt-2 text-xs text-orange-700">
                      {formatAngka(Number(it.jumlah))} batch × {formatAngka(b.isi)} ={" "}
                      <b>
                        {formatAngka(qtyPcs)} {b.satuan}
                      </b>
                    </div>
                  )}
                  {tipe === "produksi" && estimasi != null && (
                    <div className="mt-2 text-xs text-stone-500">
                      Perkiraan biaya: <b>{formatRupiah(estimasi)}</b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setTambahTempat(!tambahTempat)}
            className="mt-2 text-xs font-medium text-orange-600 hover:underline"
          >
            ➕ Tambah tempat penyimpanan baru
          </button>
          {tambahTempat && (
            <QuickAdd
              placeholder="nama tempat (mis. Freezer 1)"
              onSubmit={(n) => tempatBaru.mutate(n)}
              pending={tempatBaru.isPending}
            />
          )}
          <ErrorText error={tempatBaru.error} />
        </div>

        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {tipe === "produksi" ? (
            <>
              Faktur tersimpan sebagai <b>📋 Rencana (RAB)</b>, lalu maju bertahap:{" "}
              <b>🔨 Mulai Kerjakan</b> → <b>✅ Tandai Selesai</b> → <b>📦 Konfirmasi Ada</b>.
              Stok baru bertambah setelah dikonfirmasi.
            </>
          ) : (
            <>
              Setelah disimpan, faktur berstatus <b>Menunggu konfirmasi</b> — stok baru
              bertambah setelah ditekan <b>"Konfirmasi Ada"</b> (barang benar-benar diterima).
            </>
          )}
        </div>

        <ErrorText error={simpan.error} />
        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <div className="text-sm text-stone-600">
            {tipe === "beli" ? "Perkiraan total: " : "Perkiraan biaya (RAB): "}
            <b>{formatRupiah(totalFaktur)}</b>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnSecondary}>
              Batal
            </button>
            <button
              type="button"
              onClick={() => simpan.mutate()}
              disabled={
                itemValid.length === 0 ||
                (tipe === "produksi" && !pelaksana) ||
                simpan.isPending
              }
              className={btnPrimary}
            >
              {simpan.isPending ? "Menyimpan…" : "Simpan Faktur"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
