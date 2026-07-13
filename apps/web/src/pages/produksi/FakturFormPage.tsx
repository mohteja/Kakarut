import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BahanDto, JenisPengadaan, PenyimpananDto, SupplierDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
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

/**
 * Halaman (bukan modal) untuk membuat faktur produksi / pembelian bahan baku.
 * Tiap baris bahan menampilkan harga/RAB SEBARIS dengan bahannya, lalu total
 * di bawah. Setelah simpan kembali ke daftar.
 */
export function FakturFormPage({ tipe }: { tipe: JenisPengadaan }) {
  const endpoint = tipe === "produksi" ? "/produksi" : "/pembelian";
  const navigate = useNavigate();
  const { auth } = useAuth();
  // Produksi & beli bahan baku = urusan Central Kitchen. Dari Kantor, pilih
  // CK-nya (default CK pertama) — bukan store.
  const { query: branchQuery, id: branchId } = useCabangData("produksi");
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";
  // karyawan CK (tim): faktur dibuat di cabangnya sendiri, pelaksana dirinya
  const isTim = auth?.user.role === "tim";
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";

  const { data: bahan } = useQuery({ queryKey: ["bahan"], queryFn: () => api<BahanDto[]>("/bahan") });
  const { data: supplier = [] } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  const { data: tempat = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  // daftar karyawan khusus manajemen — tim memakai dirinya sebagai pelaksana
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
    enabled: tipe === "produksi" && isManajemen,
  });

  const bahanJalur = (bahan ?? []).filter((b) => b.pengadaan === tipe && b.track_stok);

  const [supplierId, setSupplierId] = useState(""); // jalur beli
  // produksi: "k:<id>" / "s:<id>" — tim otomatis dirinya sendiri
  const [pelaksana, setPelaksana] = useState(isTim && auth ? `k:${auth.user.sub}` : "");
  const [noFaktur, setNoFaktur] = useState("");
  const [catatan, setCatatan] = useState("");
  const [items, setItems] = useState<ItemForm[]>([{ ...itemKosong }]);
  const [tambahSupplier, setTambahSupplier] = useState(false);

  // Ganti cabang data (dari Kantor) → tempat penyimpanan milik cabang lama
  // tidak valid lagi di cabang baru; kosongkan agar tidak terkirim diam-diam
  // (server menolak 400 padahal select tampak belum terisi).
  const cabangSebelum = useRef(branchId);
  useEffect(() => {
    if (cabangSebelum.current === branchId) return;
    cabangSebelum.current = branchId;
    setItems((prev) => prev.map((it) => ({ ...it, storage_location_id: "" })));
  }, [branchId]);
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

  const [pelTipe, pelId] = pelaksana ? pelaksana.split(":") : ["", ""];

  const simpan = useMutation({
    mutationFn: () =>
      api(`${endpoint}/faktur`, {
        method: "POST",
        body: {
          ...(isManajemen && branchId ? { branch_id: branchId } : {}),
          supplier_id: tipe === "produksi" ? (pelTipe === "s" ? pelId : null) : supplierId || null,
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
              ...(tipe === "beli" && it.total_harga ? { total_harga: Number(it.total_harga) } : {}),
            })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      navigate(endpoint);
    },
  });

  /** qty dalam pcs + estimasi harga (RAB) satu baris */
  function hitungBaris(it: ItemForm) {
    const b = bahanJalur.find((x) => x.id === it.ingredient_id);
    const qtyPcs =
      b && Number(it.jumlah) > 0
        ? it.mode === "batch"
          ? Number(it.jumlah) * b.isi
          : Number(it.jumlah)
        : 0;
    const estimasi = b && qtyPcs > 0 ? Math.round((qtyPcs / b.isi) * b.harga_beli) : null;
    return { b, qtyPcs, estimasi };
  }

  const itemValid = items.filter((it) => it.ingredient_id && Number(it.jumlah) > 0);
  const totalFaktur = items.reduce((a, it) => {
    const { estimasi } = hitungBaris(it);
    const harga = it.total_harga ? Number(it.total_harga) : (estimasi ?? 0);
    return a + harga;
  }, 0);

  return (
    <div className="max-w-5xl">
      <CabangDataBar fokus="produksi" />
      <PageTitle
        aksi={
          <button type="button" onClick={() => navigate(endpoint)} className={btnSecondary}>
            ← Kembali
          </button>
        }
      >
        {tipe === "produksi" ? "Faktur Produksi Bahan Baku" : "Faktur Beli Bahan Baku"}
      </PageTitle>

      {/* Info sumber / pelaksana / catatan */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
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
                  {isTim && auth && (
                    <option value={`k:${auth.user.sub}`}>{auth.user.nama} (saya)</option>
                  )}
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
      </Card>

      {/* Daftar bahan — harga sebaris tiap bahan + total */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5">
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

        {/* header kolom (desktop) */}
        <div className="hidden gap-3 border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 md:flex">
          <div className="min-w-0 flex-1">Bahan</div>
          <div className="w-28 shrink-0">Satuan</div>
          <div className="w-20 shrink-0 text-right">Jumlah</div>
          <div className="w-40 shrink-0">Disimpan di</div>
          <div className="w-32 shrink-0 text-right">
            {tipe === "beli" ? "Harga (Rp)" : "Perkiraan (RAB)"}
          </div>
          <div className="w-5 shrink-0" />
        </div>

        <div className="divide-y divide-stone-100">
          {items.map((it, i) => {
            const { b, qtyPcs, estimasi } = hitungBaris(it);
            return (
              <div key={i} className="px-4 py-2.5">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      Bahan
                    </label>
                    <select
                      value={it.ingredient_id}
                      onChange={(e) => ubahItem(i, { ingredient_id: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">— pilih bahan —</option>
                      {bahanJalur.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.nama} (1 {tipe === "beli" ? "kemasan" : "batch"} ={" "}
                          {formatAngka(x.isi)} {x.satuan})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28 shrink-0">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      Satuan
                    </label>
                    <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
                      <button
                        type="button"
                        onClick={() => ubahItem(i, { mode: "pcs" })}
                        className={`flex-1 px-2 py-2 font-medium ${it.mode === "pcs" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                      >
                        Pcs
                      </button>
                      <button
                        type="button"
                        onClick={() => ubahItem(i, { mode: "batch" })}
                        className={`flex-1 px-2 py-2 font-medium ${it.mode === "batch" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                      >
                        {tipe === "beli" ? "Kemasan" : "Batch"}
                      </button>
                    </div>
                  </div>
                  <div className="w-full shrink-0 md:w-20">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      Jumlah
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={it.jumlah}
                      onChange={(e) => ubahItem(i, { jumlah: e.target.value })}
                      className={`${inputClass} md:text-right`}
                    />
                  </div>
                  <div className="w-full shrink-0 md:w-40">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      Disimpan di
                    </label>
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
                  <div className="w-full shrink-0 md:w-32">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      {tipe === "beli" ? "Harga (Rp)" : "Perkiraan (RAB)"}
                    </label>
                    {tipe === "beli" ? (
                      <input
                        type="number"
                        min="0"
                        value={it.total_harga}
                        onChange={(e) => ubahItem(i, { total_harga: e.target.value })}
                        className={`${inputClass} md:text-right`}
                        placeholder={estimasi != null ? String(estimasi) : "otomatis"}
                      />
                    ) : (
                      <div className="py-2 text-right text-sm font-medium text-stone-700">
                        {estimasi != null ? formatRupiah(estimasi) : "—"}
                      </div>
                    )}
                  </div>
                  <div className="hidden w-5 shrink-0 md:block">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems(items.filter((_, j) => j !== i))}
                        className="text-red-500 hover:text-red-700"
                        aria-label="Hapus baris"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  {b && it.mode === "batch" && Number(it.jumlah) > 0 ? (
                    <div className="text-xs text-orange-700">
                      {formatAngka(Number(it.jumlah))} {tipe === "beli" ? "kemasan" : "batch"} ×{" "}
                      {formatAngka(b.isi)} ={" "}
                      <b>
                        {formatAngka(qtyPcs)} {b.satuan}
                      </b>
                    </div>
                  ) : (
                    <span />
                  )}
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                      className="text-xs font-medium text-red-500 hover:underline md:hidden"
                    >
                      ✕ Hapus baris
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* total */}
        <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setTambahTempat(!tambahTempat)}
            className="text-xs font-medium text-orange-600 hover:underline"
          >
            ➕ Tambah tempat penyimpanan baru
          </button>
          <div className="text-sm text-stone-700">
            {tipe === "beli" ? "Perkiraan total: " : "Perkiraan biaya (RAB): "}
            <b className="text-base">{formatRupiah(totalFaktur)}</b>
          </div>
        </div>
        {tambahTempat && (
          <div className="px-4 pb-3">
            <QuickAdd
              placeholder="nama tempat (mis. Freezer 1)"
              onSubmit={(n) => tempatBaru.mutate(n)}
              pending={tempatBaru.isPending}
            />
            <ErrorText error={tempatBaru.error} />
          </div>
        )}
      </Card>

      <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
        {tipe === "produksi" ? (
          <>
            Faktur tersimpan sebagai <b>📋 Rencana (RAB)</b>, lalu maju bertahap:{" "}
            <b>🔨 Mulai Kerjakan</b> → <b>✅ Tandai Selesai</b> → <b>📦 Konfirmasi Ada</b>. Stok
            baru bertambah setelah dikonfirmasi.
          </>
        ) : (
          <>
            Faktur tersimpan sebagai <b>📋 RAB (rencana beli)</b>, lalu maju bertahap:{" "}
            <b>🔄 Proses</b> → <b>🚚 Kirim ke Toko</b> → <b>penerimaan di toko</b> (terima semua /
            sebagian / tolak). Stok baru bertambah setelah barang diterima.
          </>
        )}
      </div>

      <ErrorText error={simpan.error} />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => navigate(endpoint)} className={btnSecondary}>
          Batal
        </button>
        <button
          type="button"
          onClick={() => simpan.mutate()}
          disabled={
            itemValid.length === 0 || (tipe === "produksi" && !pelaksana) || simpan.isPending
          }
          className={btnPrimary}
        >
          {simpan.isPending ? "Menyimpan…" : "Simpan Faktur"}
        </button>
      </div>
    </div>
  );
}
