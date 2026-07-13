import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  MenuDto,
  MenuStokDto,
  RencanaBahanRow,
  RencanaFakturResult,
  RencanaMenuItem,
  RencanaMenuPreview,
  SupplierDto,
} from "@kakarut/shared";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary, inputClass, tdClass, thClass } from "../../components/ui";
import { labelCabang, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

interface Karyawan {
  user_id: string;
  nama: string;
  role: "owner" | "admin" | "cashier" | "tim";
  is_active: boolean;
}

/**
 * Satu bagian kekurangan bahan — produksi ATAU beli — dengan tabel dan
 * subtotalnya sendiri, karena keduanya menjadi faktur yang berbeda.
 */
function BagianKurang({ tipe, rows }: { tipe: "produksi" | "beli"; rows: RencanaBahanRow[] }) {
  if (rows.length === 0) return null;
  const beli = tipe === "beli";
  const subtotal = rows.reduce((t, b) => t + (b.estimasi_biaya ?? 0), 0);
  return (
    <div
      className={`overflow-hidden rounded-lg border ${beli ? "border-blue-200" : "border-purple-200"}`}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 ${beli ? "bg-blue-50 text-blue-800" : "bg-purple-50 text-purple-800"}`}
      >
        <span className="text-sm font-bold">
          {beli ? "🛒 Harus dibeli → faktur beli" : "🏭 Harus diproduksi → faktur produksi"}
        </span>
        <span className="text-xs font-semibold">
          {rows.length} bahan · {formatRupiah(subtotal)}
        </span>
      </div>
      <div className="max-h-56 overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Bahan</th>
              <th className={`${thClass} text-right`}>Butuh</th>
              <th className={`${thClass} text-right`}>Saldo</th>
              <th className={`${thClass} text-right`}>Kurang</th>
              <th className={thClass}>{beli ? "Beli" : "Produksi"}</th>
              <th className={`${thClass} text-right`}>{beli ? "Est. biaya" : "Est. RAB"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((b) => (
              <tr key={b.ingredient_id}>
                <td className={`${tdClass} font-medium`}>{b.nama}</td>
                <td className={`${tdClass} text-right`}>
                  {formatAngka(b.kebutuhan)} {b.satuan}
                </td>
                <td className={`${tdClass} text-right`}>{formatAngka(b.saldo)}</td>
                <td className={`${tdClass} text-right font-bold text-orange-700`}>
                  {formatAngka(b.kurang)}
                </td>
                <td className={`${tdClass} whitespace-nowrap font-medium`}>
                  {b.jumlah_faktur != null
                    ? b.mode_faktur === "batch"
                      ? `${formatAngka(b.jumlah_faktur)} ${beli ? "kemasan" : "batch"} (=${formatAngka(b.qty_faktur ?? 0)} ${b.satuan})`
                      : `${formatAngka(b.jumlah_faktur)} ${b.satuan}`
                    : "—"}
                </td>
                <td className={`${tdClass} text-right`}>
                  {b.estimasi_biaya != null ? formatRupiah(b.estimasi_biaya) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Tambah Stok dari MENU: owner memasang target porsi per menu → sistem
 * menghitung kebutuhan bahan (resep + menu dasar paket), membandingkan dengan
 * saldo, lalu menerbitkan faktur produksi & beli otomatis untuk kekurangannya.
 */
export function TambahStokDariMenuPage() {
  const { cabang, branchId } = useBranch();
  const queryClient = useQueryClient();

  // Cabang TUJUAN (store yang butuh stok). Dari Kantor bebas pilih; dari store
  // = cabang itu sendiri. Kebutuhan dihitung untuk cabang tujuan ini.
  const stores = useMemo(
    () => cabang.filter((b) => b.is_active && b.tipe === "store"),
    [cabang],
  );
  const [tujuanId, setTujuanId] = useState("");
  useEffect(() => {
    if (tujuanId && stores.some((s) => s.id === tujuanId)) return;
    // default: cabang aktif bila store, selain itu store pertama
    const aktif = stores.find((s) => s.id === branchId);
    setTujuanId(aktif?.id ?? stores[0]?.id ?? "");
  }, [stores, branchId, tujuanId]);
  const store = cabang.find((b) => b.id === tujuanId);
  // Central Kitchen pemasok store → produksi = work-order CK (karyawan CK yang
  // memproses & mengirim). Bila store tak punya CK → produksi di tempat (legacy).
  const ck = cabang.find((b) => b.id === store?.central_kitchen_id);
  const workOrder = !!ck;
  const branchQuery = tujuanId ? `?branch_id=${tujuanId}` : "";

  // Menu per lokasi: rencana hanya untuk menu yang tersedia di cabang aktif.
  const { data: menus = [] } = useQuery({
    queryKey: ["menu", branchQuery],
    queryFn: () => api<MenuDto[]>(`/menu${branchQuery}`),
  });
  const { data: ketersediaan = [] } = useQuery({
    queryKey: ["menu-ketersediaan", branchQuery],
    queryFn: () => api<MenuStokDto[]>(`/menu/ketersediaan${branchQuery}`),
  });
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  const sisaByMenu = useMemo(
    () => new Map(ketersediaan.map((k) => [k.menu_id, k.porsi])),
    [ketersediaan],
  );

  const [cari, setCari] = useState("");
  /** target porsi per menu (0/absen = tidak direncanakan) */
  const [rencana, setRencana] = useState<Record<string, number>>({});
  /** pelaksana faktur produksi: "k:<user_id>" | "s:<supplier_id>" | "" */
  const [pelaksana, setPelaksana] = useState("");
  /** supplier faktur beli (opsional) */
  const [supplierBeli, setSupplierBeli] = useState("");
  const [hasil, setHasil] = useState<RencanaFakturResult | null>(null);

  const items: RencanaMenuItem[] = useMemo(
    () =>
      Object.entries(rencana)
        .filter(([, porsi]) => porsi > 0)
        .map(([menu_id, porsi]) => ({ menu_id, porsi })),
    [rencana],
  );

  // Debounce agar preview tidak menembak server tiap ketukan stepper.
  const [itemsTunda, setItemsTunda] = useState<RencanaMenuItem[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setItemsTunda(items), 400);
    return () => clearTimeout(t);
  }, [items]);

  const preview = useQuery({
    queryKey: ["rencana-menu", branchQuery, JSON.stringify(itemsTunda)],
    queryFn: () =>
      api<RencanaMenuPreview>(`/rekomendasi/menu${branchQuery}`, {
        method: "POST",
        body: { items: itemsTunda },
      }),
    enabled: itemsTunda.length > 0,
  });
  const p = itemsTunda.length > 0 ? preview.data : undefined;
  const adaKurang = (p?.jumlah_produksi ?? 0) + (p?.jumlah_beli ?? 0) > 0;
  // Produksi dan beli menjadi faktur BERBEDA → tampilkan sebagai 2 daftar terpisah.
  const kurangProduksi = p?.bahan.filter((b) => b.pengadaan === "produksi" && b.kurang > 0) ?? [];
  const kurangBeli = p?.bahan.filter((b) => b.pengadaan === "beli" && b.kurang > 0) ?? [];
  const bahanCukup = p?.bahan.filter((b) => b.kurang <= 0) ?? [];
  // Pelaksana hanya wajib untuk produksi DI TEMPAT (bukan work-order CK).
  const butuhPelaksana = !workOrder && (p?.jumlah_produksi ?? 0) > 0 && !pelaksana;
  // Preview basi bila target baru diketik dan debounce/fetch belum selesai —
  // tombol Buat ditahan agar faktur selalu sama dengan angka yang terlihat.
  const previewBasi =
    preview.isFetching || JSON.stringify(items) !== JSON.stringify(itemsTunda);

  const buat = useMutation({
    mutationFn: () => {
      const [pelTipe, pelId] = pelaksana.split(":");
      return api<RencanaFakturResult>(`/rekomendasi/menu/faktur`, {
        method: "POST",
        body: {
          // pakai items LIVE (bukan snapshot debounce) — server menghitung ulang
          items,
          tujuan_branch_id: tujuanId || null,
          // work-order: produksi dikerjakan CK; pelaksana ditugaskan karyawan CK
          ck_branch_id: workOrder ? ck!.id : null,
          worker_id: !workOrder && pelTipe === "k" ? pelId : null,
          supplier_id: !workOrder && pelTipe === "s" ? pelId : null,
          supplier_beli_id: supplierBeli || null,
        },
      });
    },
    onSuccess: (data) => {
      setHasil(data);
      setRencana({});
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["menu-ketersediaan"] });
      queryClient.invalidateQueries({ queryKey: ["/produksi"] });
      queryClient.invalidateQueries({ queryKey: ["/pembelian"] });
      queryClient.invalidateQueries({ queryKey: ["rekomendasi"] });
    },
  });

  function ubahPorsi(menuId: string, val: number) {
    setRencana((prev) => {
      const next = { ...prev };
      // batas atas selaras dgn validasi server (hindari overflow kolom numeric)
      const porsi = Math.min(100_000, Math.floor(val));
      if (porsi > 0) next[menuId] = porsi;
      else delete next[menuId];
      return next;
    });
    setHasil(null);
  }

  const menuTampil = menus.filter(
    (m) =>
      m.nama.toLowerCase().includes(cari.toLowerCase()) ||
      (m.kode?.toLowerCase().includes(cari.toLowerCase()) ?? false),
  );

  return (
    <div>
      <PageTitle
        aksi={
          <Link to="/stok" className={btnSecondary}>
            ← Stok
          </Link>
        }
      >
        ➕ Permintaan Tambah Stok
      </PageTitle>
      <p className="mb-4 max-w-3xl text-sm text-stone-500">
        Tentukan <b>cabang tujuan</b> + <b>target porsi</b> tiap menu. Sistem menghitung kebutuhan
        bahan lalu membuat <b>permintaan</b>: bahan <b>produksi</b> menjadi work-order Central
        Kitchen (CK memproses → simpan di CK → kirim ke cabang → cabang terima), bahan <b>beli</b>{" "}
        jadi faktur beli cabang. Semua tercatat di riwayat.
      </p>

      {/* Cabang tujuan + Central Kitchen pelaksana */}
      <Card className="mb-4 p-4">
        <h2 className="mb-2 font-bold text-stone-800">1. Tujuan permintaan</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Cabang tujuan (butuh stok)</label>
            {stores.length > 1 ? (
              <select
                value={tujuanId}
                onChange={(e) => {
                  setTujuanId(e.target.value);
                  setHasil(null);
                }}
                className={inputClass}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {labelCabang(s)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                {store ? labelCabang(store) : "—"}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Diproduksi oleh</label>
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${workOrder ? "border-purple-200 bg-purple-50 text-purple-800" : "border-stone-200 bg-stone-50 text-stone-500"}`}
            >
              {workOrder ? `🏭 ${ck!.nama}` : "Produksi di cabang ini (tak ada Central Kitchen pemasok)"}
            </div>
          </div>
        </div>
      </Card>

      {/* Hasil pembuatan permintaan */}
      {hasil && (
        <Card className="mb-4 border-green-200 bg-green-50 p-4">
          <div className="font-semibold text-green-800">✅ Permintaan berhasil dibuat</div>
          <ul className="mt-1 space-y-0.5 text-sm text-green-900">
            {hasil.produksi && (
              <li>
                🏭 Work-order produksi — {hasil.produksi.jumlah_baris} bahan
                {workOrder && store ? ` → dikirim ke ${store.nama}` : ""} ·{" "}
                <Link to="/produksi" className="font-medium underline">
                  lihat di Produksi Bahan Baku →
                </Link>
              </li>
            )}
            {hasil.beli && (
              <li>
                🛒 Faktur beli (RAB) — {hasil.beli.jumlah_baris} bahan ·{" "}
                <Link to="/pembelian" className="font-medium underline">
                  lihat di Beli Bahan Baku →
                </Link>
              </li>
            )}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Kiri: pilih target porsi per menu */}
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-bold text-stone-800">2. Target porsi per menu</h2>
            {items.length > 0 && (
              <button
                onClick={() => setRencana({})}
                className="text-xs font-medium text-stone-400 hover:text-red-600 hover:underline"
              >
                Kosongkan
              </button>
            )}
          </div>
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="🔍 Cari menu / kode…"
            className={`${inputClass} mb-2`}
          />
          <div className="max-h-[28rem] divide-y divide-stone-100 overflow-y-auto">
            {menuTampil.map((m) => {
              const porsi = rencana[m.id] ?? 0;
              const sisa = sisaByMenu.get(m.id);
              return (
                <div key={m.id} className="flex items-center gap-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {m.kode && (
                        <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-orange-700">
                          {m.kode}
                        </span>
                      )}
                      <span className="truncate text-sm font-medium text-stone-800">{m.nama}</span>
                    </div>
                    <div className="text-xs text-stone-400">
                      {formatRupiah(m.harga_jual)}
                      {sisa != null && <> · sisa {formatAngka(sisa)} porsi</>}
                    </div>
                  </div>
                  <button
                    onClick={() => ubahPorsi(m.id, porsi - 10)}
                    className="h-7 rounded-lg border border-stone-300 px-1.5 text-xs text-stone-600 hover:bg-stone-50"
                    title="Kurangi 10"
                  >
                    −10
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={porsi === 0 ? "" : porsi}
                    onChange={(e) => ubahPorsi(m.id, Number(e.target.value) || 0)}
                    placeholder="0"
                    aria-label={`Porsi ${m.nama}`}
                    className="w-16 rounded-lg border border-stone-300 px-2 py-1 text-right text-sm"
                  />
                  <button
                    onClick={() => ubahPorsi(m.id, porsi + 10)}
                    className="h-7 rounded-lg border border-stone-300 px-1.5 text-xs text-stone-600 hover:bg-stone-50"
                    title="Tambah 10"
                  >
                    +10
                  </button>
                </div>
              );
            })}
            {menuTampil.length === 0 && (
              <div className="py-8 text-center text-sm text-stone-400">Menu tidak ditemukan.</div>
            )}
          </div>
        </Card>

        {/* Kanan: kebutuhan bahan + aksi buat faktur */}
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 font-bold text-stone-800">3. Kebutuhan bahan</h2>
            {items.length === 0 ? (
              <div className="py-8 text-center text-sm text-stone-400">
                Isi target porsi menu dulu di sebelah kiri.
              </div>
            ) : preview.isLoading || itemsTunda.length === 0 ? (
              <div className="py-8 text-center text-sm text-stone-400">Menghitung…</div>
            ) : preview.isError ? (
              <ErrorText error={preview.error} />
            ) : p ? (
              <>
                {/* Ringkasan rencana + perkiraan omzet (menyamakan dgn target omzet) */}
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-stone-200 bg-white p-2">
                    <div className="text-xs text-stone-500">Perkiraan omzet rencana</div>
                    <div className="text-sm font-bold text-stone-800">
                      {formatRupiah(p.perkiraan_omzet)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-2">
                    <div className="text-xs text-stone-500">Est. biaya faktur</div>
                    <div className="text-sm font-bold text-stone-800">
                      {formatRupiah(p.total_estimasi_biaya)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-2">
                    <div className="text-xs text-stone-500">Bahan kurang</div>
                    <div className="text-sm font-bold text-stone-800">
                      🏭 {p.jumlah_produksi} · 🛒 {p.jumlah_beli}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <BagianKurang tipe="produksi" rows={kurangProduksi} />
                  <BagianKurang tipe="beli" rows={kurangBeli} />
                  {!adaKurang && (
                    <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                      ✅ Stok semua bahan masih cukup untuk rencana ini.
                    </div>
                  )}
                  {bahanCukup.length > 0 && (
                    <details className="rounded-lg border border-stone-200">
                      <summary className="cursor-pointer select-none px-3 py-1.5 text-sm font-medium text-stone-500">
                        ✅ Stok masih cukup ({bahanCukup.length} bahan)
                      </summary>
                      <ul className="max-h-40 divide-y divide-stone-100 overflow-y-auto border-t border-stone-100 text-xs text-stone-500">
                        {bahanCukup.map((b) => (
                          <li
                            key={b.ingredient_id}
                            className="flex items-center justify-between gap-2 px-3 py-1"
                          >
                            <span className="truncate">{b.nama}</span>
                            <span className="shrink-0">
                              butuh {formatAngka(b.kebutuhan)} / saldo {formatAngka(b.saldo)}{" "}
                              {b.satuan}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </>
            ) : null}
          </Card>

          {p && items.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 font-bold text-stone-800">4. Buat permintaan</h2>
              {!adaKurang ? (
                <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                  ✅ Stok semua bahan masih cukup untuk rencana ini — tidak perlu faktur.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Work-order CK: pelaksana ditugaskan karyawan CK saat mulai.
                      Produksi di tempat (tanpa CK): pilih pelaksana di sini. */}
                  {workOrder && p.jumlah_produksi > 0 && (
                    <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800">
                      🏭 Produksi dikerjakan <b>{ck!.nama}</b> — pelaksana ditugaskan karyawan CK
                      saat mulai memproses.
                    </div>
                  )}
                  {!workOrder && p.jumlah_produksi > 0 && (
                    <div>
                      <label className="mb-1 block text-sm font-medium">
                        Pelaksana produksi (wajib)
                      </label>
                      <select
                        value={pelaksana}
                        onChange={(e) => setPelaksana(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">— pilih karyawan / supplier —</option>
                        <optgroup label="Karyawan">
                          {karyawan
                            .filter((k) => k.is_active)
                            .map((k) => (
                              <option key={k.user_id} value={`k:${k.user_id}`}>
                                {k.nama}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Supplier">
                          {suppliers.map((s) => (
                            <option key={s.id} value={`s:${s.id}`}>
                              {s.nama}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  )}
                  {p.jumlah_beli > 0 && (
                    <div>
                      <label className="mb-1 block text-sm font-medium">
                        Supplier faktur beli (opsional)
                      </label>
                      <select
                        value={supplierBeli}
                        onChange={(e) => setSupplierBeli(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">— tanpa supplier —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nama}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <ErrorText error={buat.error} />
                  <button
                    onClick={() => buat.mutate()}
                    disabled={buat.isPending || butuhPelaksana || previewBasi}
                    className={`${btnPrimary} w-full py-3`}
                  >
                    {buat.isPending
                      ? "Membuat permintaan…"
                      : previewBasi
                        ? "Menghitung ulang…"
                        : `🧾 Buat Permintaan (${p.jumlah_produksi > 0 ? `${p.jumlah_produksi} produksi` : ""}${p.jumlah_produksi > 0 && p.jumlah_beli > 0 ? " + " : ""}${p.jumlah_beli > 0 ? `${p.jumlah_beli} beli` : ""})`}
                  </button>
                  {butuhPelaksana && (
                    <div className="text-center text-xs text-amber-600">
                      Pilih pelaksana produksi dulu.
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
