import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  MenuDto,
  MenuStokDto,
  PerlengkapanRowDto,
  PermintaanPerlengkapanOtomatisHasil,
  RencanaBahanRow,
  RencanaFakturResult,
  RencanaMenuItem,
  RencanaMenuPreview,
  SupplierDto,
} from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { labelCabang, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

interface Karyawan {
  user_id: string;
  nama: string;
  role: "owner" | "admin" | "cashier" | "tim" | "kitchen";
  is_active: boolean;
}

/**
 * Satu bagian kekurangan bahan — produksi ATAU beli — dengan tabel dan
 * subtotalnya sendiri, karena keduanya menjadi faktur yang berbeda.
 */
function BagianKurang({
  tipe,
  rows,
}: {
  tipe: "produksi" | "produksi_cabang" | "beli" | "beli_produksi" | "kirim";
  rows: RencanaBahanRow[];
}) {
  if (rows.length === 0) return null;
  const beli = tipe === "beli" || tipe === "beli_produksi";
  const kirim = tipe === "kirim";
  const warna = kirim
    ? { border: "border-emerald-200", head: "bg-emerald-50 text-emerald-800" }
    : tipe === "produksi"
      ? { border: "border-purple-200", head: "bg-purple-50 text-purple-800" }
      : tipe === "produksi_cabang"
        ? { border: "border-rose-200", head: "bg-rose-50 text-rose-800" }
        : tipe === "beli"
          ? { border: "border-blue-200", head: "bg-blue-50 text-blue-800" }
          : { border: "border-amber-200", head: "bg-amber-50 text-amber-800" };
  const judul = kirim
    ? "🚚 Kirim dari stok CK → cabang (stok sudah ada, tinggal dikirim)"
    : tipe === "produksi"
      ? "🏭 Harus diproduksi → masuk stok CK (lalu kirim ke cabang)"
      : tipe === "produksi_cabang"
        ? "🏪 Diproduksi di CABANG (kitchen) → langsung masuk stok cabang"
        : tipe === "beli"
          ? "🛒 Beli produk jadi → faktur beli"
          : "🧺 Belanja bahan produksi → faktur beli (bahan mentah resep)";
  const subtotal = rows.reduce((t, b) => t + (b.estimasi_biaya ?? 0), 0);
  return (
    <div className={`overflow-hidden rounded-lg border ${warna.border}`}>
      <div className={`flex items-center justify-between px-3 py-1.5 ${warna.head}`}>
        <span className="text-sm font-bold">{judul}</span>
        <span className="text-xs font-semibold">
          {rows.length} bahan{kirim ? "" : ` · ${formatRupiah(subtotal)}`}
        </span>
      </div>
      <div className="max-h-56 overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Bahan</th>
              <th className={`${thClass} text-right`}>Butuh</th>
              <th className={`${thClass} text-right`}>Saldo cabang</th>
              <th className={`${thClass} text-right`}>{kirim ? "Di CK" : "Kurang"}</th>
              <th className={thClass}>{kirim ? "Kirim" : beli ? "Beli" : "Produksi"}</th>
              {!kirim && (
                <th className={`${thClass} text-right`}>{beli ? "Est. biaya" : "Est. RAB"}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((b) => (
              <tr key={b.ingredient_id}>
                <td className={`${tdClass} font-medium`}>
                  {b.nama}
                  {b.untuk && (
                    <span className="block text-[11px] font-normal text-stone-400">
                      untuk {b.untuk}
                    </span>
                  )}
                  {/* bahan mentah utk produksi di cabang: belanjanya DIKIRIM ke cabang */}
                  {tipe === "beli_produksi" && b.produksi_di === "cabang" && (
                    <span className="block text-[11px] font-semibold text-rose-600">
                      🚚 dikirim ke cabang (diproduksi kitchen)
                    </span>
                  )}
                </td>
                <td className={`${tdClass} text-right`}>
                  {formatAngka(b.kebutuhan)} {b.satuan}
                </td>
                <td className={`${tdClass} text-right`}>
                  {formatAngka(b.saldo)}
                  {!kirim && b.kirim_ck > 0 && (
                    <div className="text-[11px] font-normal text-emerald-600">
                      🚚 {formatAngka(b.kirim_ck)} dari CK
                    </div>
                  )}
                </td>
                <td className={`${tdClass} text-right font-bold text-orange-700`}>
                  {kirim ? formatAngka(b.saldo_ck) : formatAngka(b.kurang - b.kirim_ck)}
                </td>
                <td className={`${tdClass} whitespace-nowrap font-medium`}>
                  {kirim
                    ? `${formatAngka(b.kirim_ck)} ${b.satuan}`
                    : b.jumlah_faktur != null
                      ? b.mode_faktur === "batch"
                        ? `${formatAngka(b.jumlah_faktur)} ${beli ? "kemasan" : "batch"} (=${formatAngka(b.qty_faktur ?? 0)} ${b.satuan})`
                        : `${formatAngka(b.jumlah_faktur)} ${b.satuan}`
                      : "—"}
                </td>
                {!kirim && (
                  <td className={`${tdClass} text-right`}>
                    {b.estimasi_biaya != null ? formatRupiah(b.estimasi_biaya) : "—"}
                  </td>
                )}
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
  const navigate = useNavigate();

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
  const ck = cabang.find(
    (b) => b.id === store?.central_kitchen_id && b.tipe === "central_kitchen",
  );
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
  // Perlengkapan cabang tujuan → yang saldo ≤ stok minimum ikut diminta otomatis
  // (kiriman dari CK) dalam SATU klik bersama permintaan bahan baku.
  const { data: perlList = [] } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
    enabled: !!tujuanId,
  });
  const perlengkapanKurang = useMemo(
    () => perlList.filter((r) => r.stok_minimum > 0 && r.saldo < r.stok_minimum),
    [perlList],
  );
  const [sertakanPerlengkapan, setSertakanPerlengkapan] = useState(true);
  const [hasilPerlengkapan, setHasilPerlengkapan] =
    useState<PermintaanPerlengkapanOtomatisHasil | null>(null);
  // Resume/konfirmasi sebelum benar-benar menerbitkan permintaan.
  const [konfirmasi, setKonfirmasi] = useState(false);
  const sisaByMenu = useMemo(
    () => new Map(ketersediaan.map((k) => [k.menu_id, k.porsi])),
    [ketersediaan],
  );

  const [cari, setCari] = useState("");
  /** target porsi per menu (0/absen = tidak direncanakan) */
  const [rencana, setRencana] = useState<Record<string, number>>({});
  /** pelaksana faktur produksi: "k:<user_id>" | "s:<supplier_id>" | "" */
  const [pelaksana, setPelaksana] = useState("");

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
    queryKey: ["rencana-menu", branchQuery, ck?.id ?? "", JSON.stringify(itemsTunda)],
    queryFn: () =>
      api<RencanaMenuPreview>(`/rekomendasi/menu${branchQuery}`, {
        method: "POST",
        body: { items: itemsTunda, ck_branch_id: workOrder ? ck!.id : null },
      }),
    enabled: itemsTunda.length > 0,
  });
  const p = itemsTunda.length > 0 ? preview.data : undefined;
  const adaKurang =
    (p?.jumlah_produksi ?? 0) +
      (p?.jumlah_beli ?? 0) +
      (p?.jumlah_beli_produksi ?? 0) +
      (p?.jumlah_kirim ?? 0) >
    0;
  // Kirim dari stok CK, produksi, beli produk jadi, & belanja bahan produksi
  // menjadi faktur BERBEDA → tampilkan sebagai daftar terpisah. Yang PRODUKSI/
  // BELI = bagian yang benar-benar dibuat baru (punya qty_faktur); yang KIRIM =
  // dipenuhi dari stok CK yang sudah ada.
  const kurangKirim = p?.bahan.filter((b) => b.kirim_ck > 0) ?? [];
  const kurangProduksi =
    p?.bahan.filter(
      (b) =>
        b.pengadaan === "produksi" &&
        b.qty_faktur != null &&
        (!workOrder || b.produksi_di !== "cabang"),
    ) ?? [];
  // bahan ber-"Diproduksi di: Cabang" (Resep): faktur lahir di cabang tujuan,
  // dikerjakan kitchen cabang — hasil langsung masuk stok cabang.
  const kurangProduksiCabang = workOrder
    ? (p?.bahan.filter(
        (b) => b.pengadaan === "produksi" && b.qty_faktur != null && b.produksi_di === "cabang",
      ) ?? [])
    : [];
  const kurangBeli = p?.bahan.filter((b) => b.pengadaan === "beli" && b.qty_faktur != null) ?? [];
  const kurangBeliProduksi = p?.bahan_produksi.filter((b) => b.kurang > 0) ?? [];
  const bahanCukup = p?.bahan.filter((b) => b.kurang <= 0 && b.kirim_ck <= 0) ?? [];
  // Pelaksana hanya wajib untuk produksi DI TEMPAT (bukan work-order CK).
  const butuhPelaksana = !workOrder && (p?.jumlah_produksi ?? 0) > 0 && !pelaksana;
  // Preview basi bila target baru diketik dan debounce/fetch belum selesai —
  // tombol Buat ditahan agar faktur selalu sama dengan angka yang terlihat.
  const previewBasi =
    preview.isFetching || JSON.stringify(items) !== JSON.stringify(itemsTunda);

  const mintaPerlengkapan = sertakanPerlengkapan && perlengkapanKurang.length > 0;

  const buat = useMutation({
    mutationFn: async (): Promise<{
      menu: RencanaFakturResult | null;
      perlengkapan: PermintaanPerlengkapanOtomatisHasil | null;
    }> => {
      // 1) permintaan bahan baku dari menu (hanya bila ada kekurangan)
      let menu: RencanaFakturResult | null = null;
      if (adaKurang && items.length > 0) {
        const [pelTipe, pelId] = pelaksana.split(":");
        menu = await api<RencanaFakturResult>(`/rekomendasi/menu/faktur`, {
          method: "POST",
          body: {
            // pakai items LIVE (bukan snapshot debounce) — server menghitung ulang
            items,
            tujuan_branch_id: tujuanId || null,
            // work-order: produksi dikerjakan CK; pelaksana ditugaskan karyawan CK
            ck_branch_id: workOrder ? ck!.id : null,
            worker_id: !workOrder && pelTipe === "k" ? pelId : null,
            supplier_id: !workOrder && pelTipe === "s" ? pelId : null,
            // faktur beli TANPA supplier — pemroses tercatat sendiri saat
            // mengubah status ke "diproses"
          },
        });
      }
      // 2) SEKALIAN permintaan perlengkapan ≤ minimum → kiriman KP- dari CK;
      //    rencana_id ditautkan agar faktur beli BP- tampil di Permintaan Stok
      let perlengkapan: PermintaanPerlengkapanOtomatisHasil | null = null;
      if (mintaPerlengkapan && tujuanId) {
        const tautan = menu?.rencana_id ? `&rencana_id=${menu.rencana_id}` : "";
        perlengkapan = await api<PermintaanPerlengkapanOtomatisHasil>(
          `/perlengkapan/permintaan-otomatis?branch_id=${tujuanId}${tautan}`,
          { method: "POST" },
        );
      }
      return { menu, perlengkapan };
    },
    onSuccess: ({ perlengkapan }) => {
      setKonfirmasi(false);
      setRencana({});
      for (const key of [
        "stok",
        "menu-ketersediaan",
        "/produksi",
        "/pembelian",
        "rekomendasi",
        "permintaan-stok",
        "perlengkapan",
        "perlengkapan-kiriman",
        "penerimaan",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      // bila ada perlengkapan yang diminta, tampilkan ringkasannya dulu
      // (kiriman KP- muncul di Penerimaan cabang); tutup → ke Permintaan Stok
      if (perlengkapan && (perlengkapan.dibuat.length > 0 || perlengkapan.beli_dibuat.length > 0)) {
        setHasilPerlengkapan(perlengkapan);
      } else {
        navigate("/permintaan-stok");
      }
    },
  });

  // Bagian "4. Buat permintaan" tampil bila ADA kekurangan bahan baku ATAU
  // ada perlengkapan ≤ minimum — satu tombol menangani keduanya.
  const tampilAksi = (!!p && items.length > 0 && adaKurang) || perlengkapanKurang.length > 0;
  const bisaBuat =
    (adaKurang && items.length > 0 && !butuhPelaksana) ||
    (sertakanPerlengkapan && perlengkapanKurang.length > 0);
  const labelBagian = [
    p && adaKurang && p.jumlah_kirim > 0 ? `${p.jumlah_kirim} kirim` : null,
    p && adaKurang && kurangProduksi.length > 0 ? `${kurangProduksi.length} produksi` : null,
    p && adaKurang && kurangProduksiCabang.length > 0
      ? `${kurangProduksiCabang.length} produksi cabang`
      : null,
    p && adaKurang && p.jumlah_beli > 0 ? `${p.jumlah_beli} beli` : null,
    p && adaKurang && p.jumlah_beli_produksi > 0 ? `${p.jumlah_beli_produksi} bahan produksi` : null,
    mintaPerlengkapan ? `${perlengkapanKurang.length} perlengkapan` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  function ubahPorsi(menuId: string, val: number) {
    setRencana((prev) => {
      const next = { ...prev };
      // batas atas selaras dgn validasi server (hindari overflow kolom numeric)
      const porsi = Math.min(100_000, Math.floor(val));
      if (porsi > 0) next[menuId] = porsi;
      else delete next[menuId];
      return next;
    });
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
      <p className="mb-2 max-w-3xl text-sm text-stone-500">
        Tentukan <b>cabang tujuan</b> + <b>target porsi</b> tiap menu. Sistem menghitung kebutuhan
        bahan lalu membuat <b>permintaan</b> dengan faktur terpisah: bahan <b>produksi</b> menjadi
        work-order Central Kitchen (CK memproses → <b>hasilnya masuk stok CK</b>), <b>beli produk
        jadi</b> dikirim ke cabang tujuan setelah diproses CK, dan <b>belanja bahan produksi</b>{" "}
        disimpan di CK. Bahan yang di Resep ditandai <b>“Diproduksi di: Cabang”</b> tidak lewat CK
        — fakturnya lahir di cabang tujuan, dikerjakan <b>Kitchen</b> cabang, dan hasilnya langsung
        masuk stok cabang (bahan mentahnya dibelanjakan CK lalu dikirim ke cabang). Pemroses
        tercatat otomatis saat faktur mulai diproses. Semua tercatat di riwayat.
      </p>
      <p className="mb-4 max-w-3xl rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        💡 Angka <b>Saldo</b> = stok CABANG saja (cocok dengan Kartu Stok). Bila stok jadi sudah
        <b> ada di Central Kitchen</b>, kekurangan cabang dipenuhi lewat <b>🚚 Kirim dari stok CK</b>
        {" "}(transfer, tanpa produksi baru) — stok CK berkurang, stok cabang bertambah setelah{" "}
        <b>diterima</b>. Sisa yang belum ada di CK <b>diproduksi dulu ke stok CK</b> — setelah jadi,
        kirim ke cabang lewat 🚚 <b>Kirim dari stok CK</b> (CK bisa menyimpan stok).
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
                onChange={(e) => setTujuanId(e.target.value)}
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
                    <div className="text-xs text-stone-500">Rincian aksi</div>
                    <div className="text-sm font-bold text-stone-800">
                      🚚 {p.jumlah_kirim} · 🏭 {p.jumlah_produksi} · 🛒 {p.jumlah_beli} · 🧺{" "}
                      {p.jumlah_beli_produksi}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <BagianKurang tipe="kirim" rows={kurangKirim} />
                  <BagianKurang tipe="produksi" rows={kurangProduksi} />
                  <BagianKurang tipe="produksi_cabang" rows={kurangProduksiCabang} />
                  <BagianKurang tipe="beli" rows={kurangBeli} />
                  <BagianKurang tipe="beli_produksi" rows={kurangBeliProduksi} />
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

          {tampilAksi && (
            <Card className="p-4">
              <h2 className="mb-2 font-bold text-stone-800">4. Buat permintaan</h2>
              <div className="space-y-3">
                {/* stok bahan cukup tapi ada perlengkapan yang diminta */}
                {items.length > 0 && !adaKurang && (
                  <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                    ✅ Stok bahan baku masih cukup — hanya perlengkapan yang diminta.
                  </div>
                )}
                {/* ---- Bagian bahan baku (bila ada kekurangan) ---- */}
                {p && adaKurang && (
                  <>
                    {/* Work-order CK: pelaksana ditugaskan karyawan CK saat mulai.
                        Produksi di tempat (tanpa CK): pilih pelaksana di sini. */}
                    {workOrder && p.jumlah_produksi > 0 && (
                      <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800">
                        🏭 Produksi dikerjakan <b>{ck!.nama}</b> — pelaksana ditugaskan karyawan CK
                        saat mulai memproses. Hasilnya <b>masuk stok CK</b> dulu; kirim ke cabang
                        lewat 🚚 <b>Kirim dari stok CK</b> setelah jadi.
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
                    {p.jumlah_beli + p.jumlah_beli_produksi > 0 && (
                      <div className="space-y-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                        {p.jumlah_beli > 0 && (
                          <div>
                            🛒 Beli produk jadi —{" "}
                            {workOrder && store
                              ? `diproses CK → dikirim ke ${store.nama}, terima di Penerimaan cabang.`
                              : "diproses & diterima di cabang ini."}
                          </div>
                        )}
                        {p.jumlah_beli_produksi > 0 && (
                          <div>
                            🧺 Belanja bahan produksi — disimpan di{" "}
                            <b>{workOrder ? ck!.nama : "cabang ini"}</b> (dipakai untuk produksi).
                          </div>
                        )}
                        <div className="text-xs text-stone-500">
                          Tanpa pilih supplier — <b>pemroses tercatat otomatis</b> saat faktur
                          diubah ke status <b>Diproses</b>.
                        </div>
                      </div>
                    )}
                  </>
                )}
                {/* ---- Sekalian perlengkapan ≤ stok minimum ---- */}
                {perlengkapanKurang.length > 0 && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                    <input
                      type="checkbox"
                      checked={sertakanPerlengkapan}
                      onChange={(e) => setSertakanPerlengkapan(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      🧰 <b>Sekalian minta {perlengkapanKurang.length} perlengkapan</b> yang saldo ≤
                      stok minimum di {store?.nama ?? "cabang"} — kiriman <b>KP-</b> otomatis dari
                      stok CK, sisanya dilaporkan perlu dibeli di CK.
                    </span>
                  </label>
                )}
                <button
                  onClick={() => setKonfirmasi(true)}
                  disabled={buat.isPending || !bisaBuat || (adaKurang && (butuhPelaksana || previewBasi))}
                  className={`${btnPrimary} w-full py-3`}
                >
                  {adaKurang && previewBasi
                    ? "Menghitung ulang…"
                    : `🧾 Tinjau Permintaan (${labelBagian})`}
                </button>
                {adaKurang && butuhPelaksana && (
                  <div className="text-center text-xs text-amber-600">
                    Pilih pelaksana produksi dulu.
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Resume/konfirmasi sebelum menerbitkan permintaan (tidak langsung tersimpan) */}
      {konfirmasi && (
        <Modal
          open
          onClose={() => setKonfirmasi(false)}
          title="🧾 Tinjau Permintaan"
          lebar="max-w-2xl"
        >
          <div className="space-y-3">
            <p className="text-sm text-stone-500">
              Periksa dulu. Permintaan <b>belum tersimpan</b> — akan diterbitkan setelah Anda
              menekan <b>Buat Permintaan</b>.
            </p>
            {/* tujuan */}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                <div className="text-xs text-stone-500">Cabang tujuan</div>
                <div className="font-semibold text-stone-800">🏪 {store?.nama ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                <div className="text-xs text-stone-500">Diproduksi oleh</div>
                <div className="font-semibold text-stone-800">
                  {workOrder ? `🏭 ${ck!.nama}` : "Produksi di cabang ini"}
                </div>
              </div>
            </div>

            {/* bahan baku */}
            {p && adaKurang ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-stone-200 bg-white p-2">
                    <div className="text-xs text-stone-500">Est. biaya faktur</div>
                    <div className="text-sm font-bold text-stone-800">
                      {formatRupiah(p.total_estimasi_biaya)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-2">
                    <div className="text-xs text-stone-500">Perkiraan omzet</div>
                    <div className="text-sm font-bold text-stone-800">
                      {formatRupiah(p.perkiraan_omzet)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-2">
                    <div className="text-xs text-stone-500">Rincian aksi</div>
                    <div className="text-sm font-bold text-stone-800">
                      🚚 {p.jumlah_kirim} · 🏭 {p.jumlah_produksi} · 🛒 {p.jumlah_beli} · 🧺{" "}
                      {p.jumlah_beli_produksi}
                    </div>
                  </div>
                </div>
                {!workOrder && p.jumlah_produksi > 0 && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800">
                    Pelaksana produksi:{" "}
                    <b>
                      {(() => {
                        const [t, id] = pelaksana.split(":");
                        if (t === "k") return karyawan.find((k) => k.user_id === id)?.nama ?? "—";
                        if (t === "s") return suppliers.find((s) => s.id === id)?.nama ?? "—";
                        return "—";
                      })()}
                    </b>
                  </div>
                )}
                <div className="max-h-[45vh] space-y-3 overflow-y-auto">
                  <BagianKurang tipe="kirim" rows={kurangKirim} />
                  <BagianKurang tipe="produksi" rows={kurangProduksi} />
                  <BagianKurang tipe="produksi_cabang" rows={kurangProduksiCabang} />
                  <BagianKurang tipe="beli" rows={kurangBeli} />
                  <BagianKurang tipe="beli_produksi" rows={kurangBeliProduksi} />
                </div>
              </>
            ) : (
              items.length > 0 && (
                <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                  ✅ Stok bahan baku masih cukup — tidak ada faktur bahan yang dibuat.
                </div>
              )
            )}

            {/* perlengkapan */}
            {mintaPerlengkapan && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                🧰 <b>{perlengkapanKurang.length} perlengkapan</b> (saldo ≤ minimum) akan diminta —
                kiriman <b>KP-</b> otomatis dari stok CK, sisanya dilaporkan perlu dibeli di CK:
                <div className="mt-1 flex flex-wrap gap-1">
                  {perlengkapanKurang.map((r) => (
                    <span
                      key={r.id}
                      className="rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium text-orange-800"
                    >
                      {r.nama}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <ErrorText error={buat.error} />
            <div className="flex justify-end gap-2 border-t border-stone-100 pt-3">
              <button
                onClick={() => setKonfirmasi(false)}
                disabled={buat.isPending}
                className={btnSecondary}
              >
                Batal
              </button>
              <button
                onClick={() => buat.mutate()}
                disabled={buat.isPending}
                className={btnPrimary}
              >
                {buat.isPending ? "Membuat permintaan…" : "✅ Buat Permintaan"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Ringkasan hasil permintaan perlengkapan (kiriman KP- + perlu beli) */}
      {hasilPerlengkapan && (
        <Modal
          open
          onClose={() => navigate("/permintaan-stok")}
          title="🧰 Perlengkapan diminta"
          lebar="max-w-lg"
        >
          <div className="space-y-3">
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              {hasilPerlengkapan.dibuat.length > 0
                ? `${hasilPerlengkapan.dibuat.length} kiriman KP- diterbitkan — cabang tinggal menerima di Penerimaan Barang.`
                : "Tidak ada kiriman (stok CK kosong / sudah cukup)."}
            </div>
            {hasilPerlengkapan.dibuat.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-stone-500">
                  🚚 Dikirim dari CK
                </div>
                <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                  {hasilPerlengkapan.dibuat.map((d) => (
                    <div
                      key={d.supply_id}
                      className="flex items-center justify-between px-3 py-1.5 text-sm"
                    >
                      <span className="text-stone-700">{d.nama}</span>
                      <span className="flex items-center gap-2">
                        {d.nomor && (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                            {d.nomor}
                          </span>
                        )}
                        <b>{formatAngka(d.qty)}</b> {d.satuan}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {hasilPerlengkapan.beli_dibuat.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-amber-700">
                  🛒 Satu faktur beli ke CK
                  {hasilPerlengkapan.beli_faktur?.nomor && (
                    <span className="rounded bg-amber-200 px-1.5 py-0.5 font-mono text-xs font-bold normal-case text-amber-900">
                      {hasilPerlengkapan.beli_faktur.nomor}
                    </span>
                  )}
                  <span className="normal-case">(stok CK kurang → dibeli lalu dikirim)</span>
                </div>
                <div className="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-amber-50/50">
                  {hasilPerlengkapan.beli_dibuat.map((d) => (
                    <div
                      key={d.supply_id}
                      className="flex items-center justify-between px-3 py-1.5 text-sm"
                    >
                      <span className="text-stone-700">{d.nama}</span>
                      <span>
                        <b>{formatAngka(d.qty)}</b> {d.satuan}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 text-xs text-stone-400">
                  Faktur juga tampil di <b>Data Permintaan Stok</b>. Proses di{" "}
                  <b>Beli Perlengkapan</b>: tandai “Tiba di CK” → semua barang masuk stok CK
                  &amp; otomatis dikirim ke cabang.
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => navigate("/permintaan-stok")} className={btnPrimary}>
                Ke Permintaan Stok
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
