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
import { useBranch, useCabangData } from "../../context/BranchContext";
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

/**
 * Pemilih bahan dengan pencarian (nama / kode) — pengganti dropdown biasa
 * yang kewalahan saat daftar bahan panjang.
 */
function BahanPicker({
  value,
  opsi,
  label,
  kosongInfo,
  onChange,
}: {
  value: string;
  opsi: BahanDto[];
  /** teks tampil per opsi (nama + isi kemasan/batch) */
  label: (b: BahanDto) => string;
  /** penjelasan saat daftar KOSONG total (bukan sekadar pencarian tak cocok) */
  kosongInfo?: string;
  onChange: (id: string) => void;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState("");
  const dipilih = opsi.find((b) => b.id === value) ?? null;
  const q = cari.toLowerCase();
  const cocok = q
    ? opsi.filter(
        (b) =>
          b.nama.toLowerCase().includes(q) || (b.kode?.toLowerCase().includes(q) ?? false),
      )
    : opsi;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setBuka((v) => !v);
          setCari("");
        }}
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${dipilih ? "" : "text-stone-400"}`}>
          {dipilih ? label(dipilih) : "— pilih bahan —"}
        </span>
        <span className="shrink-0 text-stone-400">▾</span>
      </button>
      {buka && (
        <>
          {/* penutup klik-di-luar */}
          <div className="fixed inset-0 z-20" onClick={() => setBuka(false)} />
          <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
            <div className="border-b border-stone-100 p-2">
              <input
                autoFocus
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari nama / kode bahan…"
                className={inputClass}
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {cocok.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-stone-400">
                  {opsi.length === 0 && kosongInfo ? kosongInfo : "Tidak ada bahan yang cocok."}
                </div>
              ) : (
                cocok.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      onChange(b.id);
                      setBuka(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-orange-50 ${
                      b.id === value ? "bg-orange-50 font-semibold" : ""
                    }`}
                  >
                    {b.kode && (
                      <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-600">
                        {b.kode}
                      </span>
                    )}
                    <span className="truncate">{label(b)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
  // Produksi = urusan Central Kitchen. BELI dari Kantor SELALU dibukukan di
  // Central Kitchen — tujuan cabang ditentukan lewat "Untuk cabang" (tak ada
  // lagi pemilih "Lokasi pembelian"). Di luar Kantor (kitchen/kasir store)
  // beli tetap dibukukan di cabangnya sendiri (belanja mendesak → langsung
  // masuk stok cabang itu).
  const {
    query: branchQuery,
    id: branchIdRaw,
    dariKantor,
    opsi: opsiLokasi,
  } = useCabangData(tipe === "beli" ? "beli" : "produksi");
  // Lokasi pembukuan efektif: BELI dari Kantor → Central Kitchen; selain itu
  // ikut pilihan useCabangData (produksi CK/cabang; store beli di cabang).
  const ckLokasi =
    tipe === "beli" && dariKantor
      ? (opsiLokasi.find((b) => b.tipe === "central_kitchen") ?? null)
      : null;
  const branchId = ckLokasi ? ckLokasi.id : branchIdRaw;
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";
  // karyawan CK (tim) & kitchen cabang: faktur dibuat di cabangnya sendiri,
  // pelaksana dirinya
  const isTim = auth?.user.role === "tim" || auth?.user.role === "kitchen";
  const isKitchen = auth?.user.role === "kitchen";
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  // Faktur produksi di cabang TOKO (kitchen cabang): hasil masuk stok cabang
  // itu sendiri — bukan CK, tak ada langkah kirim/terima.
  const { cabang } = useBranch();
  const cabangTerpilih = cabang.find((b) => b.id === branchId);
  const produksiDiCabang = tipe === "produksi" && cabangTerpilih?.tipe === "store";
  // BELI langsung DI cabang store: barang Tiba langsung masuk stok cabang itu
  const beliDiCabang = tipe === "beli" && cabangTerpilih?.tipe === "store";
  const beliDiCk = tipe === "beli" && cabangTerpilih?.tipe === "central_kitchen";

  // varian LENGKAP (bukan ringkas): supplier_utama + satuan_beli dipakai di
  // pemilih bahan dan ringkasan belanja per supplier (jalur beli)
  const { data: bahan } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const { data: supplier = [] } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  // tempat simpan hanya dipilih di jalur produksi — beli otomatis ke rak
  // home bahan (master) saat barang Tiba
  const { data: tempat = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
    enabled: tipe === "produksi",
  });
  // daftar karyawan khusus manajemen — tim memakai dirinya sebagai pelaksana
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
    enabled: tipe === "produksi" && isManajemen,
  });

  // Kitchen cabang hanya boleh memproduksi bahan berlokasi produksi "cabang"
  // DAN (bila daftar cabang produsen diisi) yang memuat cabangnya sendiri —
  // server menolak 400 untuk sisanya, jadi saring dari pemilih sekalian.
  const bolehKitchen = (b: BahanDto) =>
    b.produksi_di === "cabang" &&
    ((b.produksi_branch_ids ?? []).length === 0 ||
      (branchId != null && (b.produksi_branch_ids ?? []).includes(branchId)));
  const bahanJalur = (bahan ?? []).filter(
    (b) =>
      b.pengadaan === tipe &&
      b.track_stok &&
      (!isKitchen || tipe !== "produksi" || bolehKitchen(b)),
  );

  // BELI dari CK: tujuan kirim opsional — barang tiba di CK lalu dikirim ke
  // cabang store ini (kirim → diterima di Penerimaan cabang)
  const [tujuanId, setTujuanId] = useState("");
  // produksi: "k:<id>" / "s:<id>" — tim otomatis dirinya sendiri
  const [pelaksana, setPelaksana] = useState(isTim && auth ? `k:${auth.user.sub}` : "");
  const [noFaktur, setNoFaktur] = useState("");
  const [catatan, setCatatan] = useState("");
  // BELI: baris cukup bahan + jumlah — jumlah dihitung per KEMASAN (satuan
  // beli master bahan); harga/supplier/rak simpan mengikuti master bahan.
  const barisKosong: ItemForm = { ...itemKosong, mode: tipe === "beli" ? "batch" : "pcs" };
  const [items, setItems] = useState<ItemForm[]>([{ ...barisKosong }]);
  const [tambahSupplier, setTambahSupplier] = useState(false);

  // Ganti cabang data (dari Kantor) → tempat penyimpanan milik cabang lama
  // tidak valid lagi di cabang baru; kosongkan agar tidak terkirim diam-diam
  // (server menolak 400 padahal select tampak belum terisi).
  const cabangSebelum = useRef(branchId);
  useEffect(() => {
    if (cabangSebelum.current === branchId) return;
    cabangSebelum.current = branchId;
    setItems((prev) => prev.map((it) => ({ ...it, storage_location_id: "" })));
    setTujuanId(""); // tujuan kirim milik CK lama tidak relevan lagi
  }, [branchId]);
  const [tambahTempat, setTambahTempat] = useState(false);

  const supplierBaru = useMutation({
    mutationFn: (nama: string) => api<SupplierDto>("/supplier", { method: "POST", body: { nama } }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      setPelaksana(`s:${s.id}`);
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
          ...(tipe === "beli" && beliDiCk && tujuanId ? { tujuan_branch_id: tujuanId } : {}),
          // beli: tanpa supplier faktur — server mencatat supplier UTAMA tiap
          // bahan (master) per baris saat faktur mulai Diproses
          supplier_id: tipe === "produksi" && pelTipe === "s" ? pelId : null,
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

  // RINGKASAN BELANJA (beli): baris valid dikelompokkan per supplier UTAMA
  // bahan dari master — pegangan "beli di mana" seperti Dokumen Belanja pada
  // permintaan bahan baku. Supplier bernama tampil dulu, tanpa supplier akhir.
  const kelompokSupplier = (() => {
    if (tipe !== "beli") return [];
    const byNama = new Map<
      string,
      {
        nama: string | null;
        subtotal: number;
        baris: { b: BahanDto; jumlah: number; qtyPcs: number; estimasi: number | null }[];
      }
    >();
    for (const it of items) {
      const { b, qtyPcs, estimasi } = hitungBaris(it);
      if (!b || qtyPcs <= 0) continue;
      const key = b.supplier_utama ?? "__tanpa";
      let g = byNama.get(key);
      if (!g) {
        g = { nama: b.supplier_utama ?? null, subtotal: 0, baris: [] };
        byNama.set(key, g);
      }
      g.subtotal += estimasi ?? 0;
      g.baris.push({ b, jumlah: Number(it.jumlah), qtyPcs, estimasi });
    }
    return [...byNama.values()].sort((a, z) =>
      a.nama === null ? 1 : z.nama === null ? -1 : a.nama.localeCompare(z.nama),
    );
  })();

  return (
    <div className="max-w-5xl">
      {/* Produksi tetap pakai bar "Dari Kantor"; BELI memilih lokasi lewat
          field "Lokasi pembelian" DI DALAM form (lebih menyatu). */}
      {tipe === "produksi" && <CabangDataBar fokus="produksi" />}
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
              </>
            ) : (
              <>
                {/* BELI dari Kantor SELALU dibukukan di Central Kitchen —
                    tujuan cabang ditentukan lewat "Untuk cabang" di bawah
                    (tak ada lagi pemilih "Lokasi pembelian"). Store yang beli
                    sendiri: barang langsung masuk stok cabangnya. */}
                <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                  {beliDiCabang ? (
                    <>
                      Dibeli & <b>langsung masuk stok cabang {cabangTerpilih?.nama}</b> saat
                      ditandai 📦 Tiba.
                    </>
                  ) : (
                    <>
                      Dibeli & dibukukan di{" "}
                      <b>{cabangTerpilih?.nama ?? "Central Kitchen"}</b> — barang masuk stok CK
                      saat Tiba. Untuk cabang, isi <b>“Untuk cabang”</b> di bawah.
                    </>
                  )}
                </div>
              </>
            )}
            {/* BELI dari CK (manajemen): tujuan kirim opsional ke cabang store */}
            {beliDiCk && isManajemen && (
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Untuk cabang (opsional)</label>
                <select
                  value={tujuanId}
                  onChange={(e) => setTujuanId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— Stok CK saja (tidak dikirim) —</option>
                  {cabang
                    .filter(
                      (b) =>
                        b.is_active &&
                        b.tipe === "store" &&
                        (!b.central_kitchen_id || b.central_kitchen_id === branchId),
                    )
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nama}
                      </option>
                    ))}
                </select>
                <div className="mt-1 text-xs text-stone-400">
                  Bila diisi, barang <b>dikirim</b> ke cabang ini setelah Tiba di CK, lalu{" "}
                  <b>diterima</b> di Penerimaan cabang.
                </div>
              </div>
            )}
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
          {bahanJalur.length > 0 && (
            <button
              type="button"
              onClick={() => setItems([...items, { ...barisKosong }])}
              className={btnSecondary}
            >
              + Tambah baris
            </button>
          )}
        </div>

        {bahanJalur.length === 0 ? (
          // Picker kosong = perusahaan belum punya bahan sesuai jalur ini
          // (server pun menolak bahan non-beli / tak dilacak) — jelaskan &
          // arahkan ke master Bahan Baku alih-alih baris kosong yang bingung.
          <div className="px-4 py-10 text-center">
            <div className="text-3xl">📦</div>
            <div className="mt-2 text-sm font-semibold text-stone-700">
              {tipe === "beli"
                ? "Belum ada bahan baku yang bisa dibeli"
                : "Belum ada bahan baku yang bisa diproduksi"}
            </div>
            <div className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-stone-500">
              {(bahan ?? []).length === 0 ? (
                <>Anda belum menambahkan bahan baku apa pun ke master.</>
              ) : tipe === "beli" ? (
                <>
                  Yang muncul di sini hanya bahan berjenis <b>Beli</b> yang{" "}
                  <b>dilacak stoknya</b>. Bahan “produksi sendiri” tidak dibeli — ubah
                  jenisnya ke <b>Beli</b> (dan centang “Lacak stok”) di master Bahan Baku bila
                  memang dibeli dari supplier.
                </>
              ) : (
                <>
                  Yang muncul di sini hanya bahan berjenis <b>Produksi sendiri</b> yang{" "}
                  <b>dilacak stoknya</b>.
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate("/bahan")}
              className={`${btnPrimary} mt-3`}
            >
              Buka master Bahan Baku
            </button>
          </div>
        ) : (
          <>
            {/* header kolom (desktop) */}
            <div className="hidden gap-3 border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 md:flex">
          <div className="min-w-0 flex-1">Bahan</div>
          <div className="w-28 shrink-0">Satuan</div>
          <div className="w-20 shrink-0 text-right">Jumlah</div>
          {tipe === "produksi" && <div className="w-40 shrink-0">Disimpan di</div>}
          <div className="w-32 shrink-0 text-right">
            {tipe === "beli" ? "Perkiraan (Rp)" : "Perkiraan (RAB)"}
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
                    <BahanPicker
                      value={it.ingredient_id}
                      opsi={bahanJalur}
                      label={(x) =>
                        tipe === "beli"
                          ? `${x.nama} (1 ${x.satuan_beli ?? "kemasan"} = ${formatAngka(x.isi)} ${x.satuan})${
                              x.supplier_utama ? ` · 🏬 ${x.supplier_utama}` : ""
                            }`
                          : `${x.nama} (1 batch = ${formatAngka(x.isi)} ${x.satuan})`
                      }
                      kosongInfo={
                        tipe === "beli"
                          ? `Belum ada bahan yang bisa dibeli. Pemilih ini hanya menampilkan bahan berjalur pengadaan "BELI" yang DILACAK stoknya — periksa kolom Pengadaan & Lacak Stok di master Bahan Baku.`
                          : `Belum ada bahan jalur PRODUKSI yang dilacak stoknya — periksa master Bahan Baku.`
                      }
                      onChange={(id) => ubahItem(i, { ingredient_id: id })}
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      Satuan
                    </label>
                    {tipe === "beli" ? (
                      // satuan mengikuti master bahan (satuan beli/kemasan)
                      <div className="py-2 text-sm text-stone-700">
                        {b ? (b.satuan_beli ?? "kemasan") : "—"}
                      </div>
                    ) : (
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
                          Batch
                        </button>
                      </div>
                    )}
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
                  {tipe === "produksi" && (
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
                  )}
                  <div className="w-full shrink-0 md:w-32">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      {tipe === "beli" ? "Perkiraan (Rp)" : "Perkiraan (RAB)"}
                    </label>
                    {/* harga beli mengikuti master bahan — RAB otomatis */}
                    <div className="py-2 text-right text-sm font-medium text-stone-700">
                      {estimasi != null ? formatRupiah(estimasi) : "—"}
                    </div>
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
                  {b && it.mode === "batch" && b.isi !== 1 && Number(it.jumlah) > 0 ? (
                    <div className="text-xs text-orange-700">
                      {formatAngka(Number(it.jumlah))}{" "}
                      {tipe === "beli" ? (b.satuan_beli ?? "kemasan") : "batch"} ×{" "}
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
          {tipe === "produksi" ? (
            <button
              type="button"
              onClick={() => setTambahTempat(!tambahTempat)}
              className="text-xs font-medium text-orange-600 hover:underline"
            >
              ➕ Tambah tempat penyimpanan baru
            </button>
          ) : (
            <span className="text-xs text-stone-400">
              Satuan, harga, supplier & rak simpan mengikuti master Bahan Baku.
            </span>
          )}
          <div className="text-sm text-stone-700">
            {tipe === "beli" ? "Perkiraan total: " : "Perkiraan biaya (RAB): "}
            <b className="text-base">{formatRupiah(totalFaktur)}</b>
          </div>
        </div>
            {tambahTempat && tipe === "produksi" && (
              <div className="px-4 pb-3">
                <QuickAdd
                  placeholder="nama tempat (mis. Freezer 1)"
                  onSubmit={(n) => tempatBaru.mutate(n)}
                  pending={tempatBaru.isPending}
                />
                <ErrorText error={tempatBaru.error} />
              </div>
            )}
          </>
        )}
      </Card>

      {/* Ringkasan belanja per supplier (beli) — seperti Dokumen Belanja */}
      {tipe === "beli" && kelompokSupplier.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <div className="border-b border-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-700">
            Ringkasan belanja per supplier
          </div>
          {kelompokSupplier.map((g) => (
            <div key={g.nama ?? "__tanpa"} className="border-b border-stone-100 last:border-b-0">
              <div className="flex items-center justify-between bg-stone-50 px-4 py-1.5 text-xs font-semibold text-stone-600">
                <span>{g.nama ? `🏬 ${g.nama}` : "🛒 Tanpa supplier utama (bebas)"}</span>
                <span>{formatRupiah(g.subtotal)}</span>
              </div>
              {g.baris.map((r, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">{r.b.nama}</span>
                  <span className="shrink-0 text-stone-500">
                    {formatAngka(r.jumlah)} {r.b.satuan_beli ?? "kemasan"}
                    {r.b.isi !== 1 && (
                      <>
                        {" "}
                        ({formatAngka(r.qtyPcs)} {r.b.satuan})
                      </>
                    )}{" "}
                    · {r.estimasi != null ? formatRupiah(r.estimasi) : "—"}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="bg-stone-50 px-4 py-2 text-xs text-stone-500">
            Supplier diambil dari <b>supplier utama</b> tiap bahan (master Bahan Baku) dan
            tercatat otomatis per baris saat faktur mulai <b>Diproses</b> — kelompok yang sama
            dipakai Dokumen Belanja.
          </div>
        </Card>
      )}

      <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
        {tipe === "produksi" ? (
          <>
            Faktur tersimpan sebagai <b>📋 Belum dikerjakan</b>, lalu maju bertahap:{" "}
            <b>🔨 Mulai Kerjakan</b> → <b>✅ Selesai</b>.{" "}
            {produksiDiCabang ? (
              <>
                Selesai = <b>langsung masuk stok cabang ini</b> (tanpa konfirmasi, tidak lewat
                CK).
                {isKitchen && (
                  <>
                    {" "}
                    Hanya bahan dengan lokasi produksi <b>Cabang</b> (diatur di Resep) yang
                    tampil di daftar.
                  </>
                )}
              </>
            ) : (
              <>
                Selesai = <b>langsung masuk stok CK</b> (tanpa konfirmasi). Untuk cabang: kirim
                dulu, lalu diterima di cabang.
              </>
            )}
          </>
        ) : (
          <>
            Faktur tersimpan sebagai <b>📋 RAB (rencana beli)</b>, lalu maju bertahap:{" "}
            <b>🔄 Proses</b> → <b>📦 Tiba di CK</b>. Tiba di CK = <b>langsung masuk stok CK</b>{" "}
            (tanpa penerimaan). Barang untuk cabang: <b>kirim</b> → <b>diterima di cabang</b>.
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
