import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { BahanDto, BahanResepRow, JenisPengadaan } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

interface ItemForm {
  ingredient_id: string;
  mode: "pcs" | "batch";
  jumlah: string;
  storage_location_id: string;
  total_harga: string;
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
  placeholder = "— pilih bahan —",
  onChange,
}: {
  value: string;
  opsi: BahanDto[];
  /** teks tampil per opsi (nama + isi kemasan/batch) */
  label: (b: BahanDto) => string;
  /** penjelasan saat daftar KOSONG total (bukan sekadar pencarian tak cocok) */
  kosongInfo?: string;
  placeholder?: string;
  onChange: (id: string) => void;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  // Posisi dropdown dihitung dari tombol; dropdown dirender via PORTAL ke
  // <body> dengan position:fixed agar TIDAK terpotong overflow-hidden kartu
  // "Daftar bahan". Bisa flip ke atas bila ruang bawah mepet.
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top: number;
    bottom: number;
    keAtas: boolean;
  } | null>(null);
  const hitungPosisi = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const perkiraanTinggi = 300;
    const ruangBawah = window.innerHeight - r.bottom;
    const keAtas = ruangBawah < perkiraanTinggi && r.top > ruangBawah;
    setPos({ left: r.left, width: r.width, top: r.top, bottom: r.bottom, keAtas });
  };
  useLayoutEffect(() => {
    if (!buka) return;
    hitungPosisi();
    const onMove = () => hitungPosisi();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [buka]);

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
        ref={btnRef}
        type="button"
        onClick={() => {
          setBuka((v) => !v);
          setCari("");
        }}
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${dipilih ? "" : "text-stone-400"}`}>
          {dipilih ? label(dipilih) : placeholder}
        </span>
        <span className="shrink-0 text-stone-400">▾</span>
      </button>
      {buka &&
        pos &&
        createPortal(
          <>
            {/* penutup klik-di-luar */}
            <div className="fixed inset-0 z-[60]" onClick={() => setBuka(false)} />
            <div
              className="fixed z-[61] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl"
              style={{
                left: pos.left,
                width: pos.width,
                ...(pos.keAtas
                  ? { bottom: window.innerHeight - pos.top + 4 }
                  : { top: pos.bottom + 4 }),
              }}
            >
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
          </>,
          document.body,
        )}
    </div>
  );
}

/**
 * Kolom "Bahan kurang" satu baris resep: kebutuhan BOM (qty per 1 batch) ×
 * jumlah batch dibandingkan saldo stok di lokasi produksi. Komponen yang tak
 * dilacak stoknya dilewati — server memakai perhitungan sama saat Mulai
 * Kerjakan (409 bila kurang).
 */
function BahanKurangCell({
  ingredientId,
  jumlahBatch,
  saldoByIng,
}: {
  ingredientId: string;
  jumlahBatch: number;
  saldoByIng: Map<string, number> | null;
}) {
  const { data: resep } = useQuery({
    queryKey: ["bahan-resep", ingredientId],
    queryFn: () => api<BahanResepRow[]>(`/bahan/${ingredientId}/resep`),
    enabled: !!ingredientId,
  });
  if (!ingredientId || !(jumlahBatch > 0)) return <span className="text-stone-400">—</span>;
  if (!resep || saldoByIng == null) return <span className="text-stone-400">…</span>;
  const kurang = resep
    .filter((k) => k.track_stok)
    .map((k) => ({
      ...k,
      butuh: k.qty * jumlahBatch,
      saldo: saldoByIng.get(k.ingredient_id) ?? 0,
    }))
    .filter((k) => k.saldo + 1e-9 < k.butuh);
  if (kurang.length === 0) {
    return <span className="text-xs font-medium text-green-700">✓ bahan cukup</span>;
  }
  return (
    <div className="space-y-0.5 text-xs leading-tight text-red-600">
      {kurang.map((k) => (
        <div key={k.ingredient_id}>
          {k.nama}{" "}
          <b>
            −{formatAngka(Math.round((k.butuh - k.saldo) * 100) / 100)} {k.satuan}
          </b>
        </div>
      ))}
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
    pilih: pilihLokasi,
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
  // PRODUKSI: saldo stok lokasi produksi — dasar kolom "Bahan kurang"
  // (kebutuhan resep × jumlah batch vs stok). Rak simpan TIDAK dipilih di
  // form: otomatis ikut rak default bahan (Tempat Penyimpanan) saat selesai.
  const { data: stokRows } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<{ ingredient_id: string; saldo: number }[]>(`/stok${branchQuery}`),
    enabled: tipe === "produksi",
  });
  const saldoByIng = stokRows
    ? new Map(stokRows.map((s) => [s.ingredient_id, s.saldo]))
    : null;
  // PRODUKSI = memilih RESEP: hanya bahan produksi yang sudah punya resep
  // (komponen bahan mentah) yang ditawarkan. resep-ringkas = jumlah komponen
  // per bahan ber-resep (absen = belum ada resep).
  const { data: resepRingkas } = useQuery({
    queryKey: ["resep-ringkas"],
    queryFn: () => api<Record<string, number>>("/bahan/resep-ringkas"),
    enabled: tipe === "produksi",
  });

  // Produksi di cabang STORE (kitchen cabang / manajemen memilih lokasi store):
  // hanya bahan berlokasi produksi "cabang" DAN (bila daftar cabang produsen
  // diisi) yang memuat cabang itu — server menolak 400 untuk sisanya (role
  // kitchen), jadi saring dari pemilih sekalian.
  const bolehDiStore = (b: BahanDto) =>
    b.produksi_di === "cabang" &&
    ((b.produksi_branch_ids ?? []).length === 0 ||
      (branchId != null && (b.produksi_branch_ids ?? []).includes(branchId)));
  const bahanJalur = (bahan ?? []).filter(
    (b) =>
      b.pengadaan === tipe &&
      b.track_stok &&
      // pilih RESEP: sembunyikan bahan produksi yang belum punya resep
      (tipe !== "produksi" || resepRingkas == null || (resepRingkas[b.id] ?? 0) > 0) &&
      (!produksiDiCabang || bolehDiStore(b)),
  );

  // BELI dari CK: tujuan kirim opsional — barang tiba di CK lalu dikirim ke
  // cabang store ini (kirim → diterima di Penerimaan cabang)
  const [tujuanId, setTujuanId] = useState("");
  const [noFaktur, setNoFaktur] = useState("");
  const [catatan, setCatatan] = useState("");
  // Baris SELALU per batch/kemasan: beli per kemasan (satuan beli master),
  // produksi per BATCH resep — harga/supplier/rak simpan mengikuti master.
  const barisKosong: ItemForm = { ...itemKosong, mode: "batch" };
  const [items, setItems] = useState<ItemForm[]>([{ ...barisKosong }]);

  // Ganti cabang data (dari Kantor) → tujuan kirim CK lama tidak relevan lagi
  const cabangSebelum = useRef(branchId);
  useEffect(() => {
    if (cabangSebelum.current === branchId) return;
    cabangSebelum.current = branchId;
    setTujuanId("");
  }, [branchId]);

  function ubahItem(i: number, patch: Partial<ItemForm>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  // faktur beli otomatis (bahan mentah kurang / di bawah stok minimum) yang
  // lahir bersama faktur produksi — tampilkan sebelum kembali ke daftar
  const [hasilBeli, setHasilBeli] = useState<{ nomor: string; jumlah_baris: number } | null>(
    null,
  );
  const simpan = useMutation({
    mutationFn: () =>
      api<{
        faktur_id: string;
        nomor: string;
        beli_otomatis: { faktur_id: string; nomor: string; jumlah_baris: number } | null;
      }>(`${endpoint}/faktur`, {
        method: "POST",
        body: {
          ...(isManajemen && branchId ? { branch_id: branchId } : {}),
          ...(tipe === "beli" && beliDiCk && tujuanId ? { tujuan_branch_id: tujuanId } : {}),
          // tanpa pelaksana/supplier faktur — pelaksana produksi terisi
          // otomatis dari yang menekan Mulai Kerjakan; supplier beli tercatat
          // per baris (supplier UTAMA master bahan) saat faktur mulai Diproses
          supplier_id: null,
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
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      if (d.beli_otomatis) {
        // beritahu dulu faktur beli otomatisnya sebelum kembali ke daftar
        queryClient.invalidateQueries({ queryKey: ["/pembelian"] });
        setHasilBeli(d.beli_otomatis);
      } else {
        navigate(endpoint);
      }
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
      {/* Lokasi (produksi maupun beli) dipilih lewat field DI DALAM form —
          tanpa bar "Dari Kantor" terpisah. */}
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
                {/* Tanpa pilih pelaksana — cukup pilih DI MANA diproduksi.
                    Pelaksana terisi otomatis dari yang menekan Mulai Kerjakan. */}
                <label className="mb-1 block text-sm font-medium">
                  Diproduksi di <span className="text-red-600">*</span>
                </label>
                {dariKantor ? (
                  <select
                    value={branchId ?? ""}
                    onChange={(e) => pilihLokasi(e.target.value)}
                    className={inputClass}
                  >
                    {opsiLokasi.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.tipe === "central_kitchen"
                          ? `🏭 ${b.nama} (Central Kitchen)`
                          : b.tipe === "store"
                            ? `🏪 ${b.nama} (cabang)`
                            : `🏢 ${b.nama}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
                    {produksiDiCabang ? "🏪" : "🏭"} {cabangTerpilih?.nama ?? "—"}
                  </div>
                )}
                <div className="mt-1 text-xs text-stone-500">
                  {produksiDiCabang
                    ? "Hasil produksi langsung masuk stok cabang ini. "
                    : "Hasil produksi masuk stok Central Kitchen. "}
                  Pelaksana tidak perlu dipilih — tercatat otomatis dari yang menekan{" "}
                  <b>🔨 Mulai Kerjakan</b>.
                </div>
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
            {tipe === "produksi"
              ? `Resep yang diproduksi (${itemValid.length})`
              : `Daftar bahan (${itemValid.length})`}
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
            <div className="text-3xl">{tipe === "beli" ? "📦" : "📖"}</div>
            <div className="mt-2 text-sm font-semibold text-stone-700">
              {tipe === "beli"
                ? "Belum ada bahan baku yang bisa dibeli"
                : "Belum ada resep yang bisa diproduksi"}
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
                  Yang muncul di sini hanya bahan <b>Produksi sendiri</b> yang dilacak
                  stoknya dan <b>sudah punya resep</b> (komponen bahan mentah). Susun dulu
                  resepnya di halaman Resep.
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate(tipe === "beli" ? "/bahan" : "/resep")}
              className={`${btnPrimary} mt-3`}
            >
              {tipe === "beli" ? "Buka master Bahan Baku" : "Buka halaman Resep"}
            </button>
          </div>
        ) : (
          <>
            {/* header kolom (desktop) */}
            <div className="hidden gap-3 border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 md:flex">
          <div className="min-w-0 flex-1">{tipe === "produksi" ? "Resep" : "Bahan"}</div>
          <div className="w-28 shrink-0">Satuan</div>
          <div className="w-20 shrink-0 text-right">Jumlah</div>
          {tipe === "beli" ? (
            <div className="w-32 shrink-0 text-right">Perkiraan (Rp)</div>
          ) : (
            <div className="w-44 shrink-0">Bahan kurang</div>
          )}
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
                      {tipe === "produksi" ? "Resep" : "Bahan"}
                    </label>
                    <BahanPicker
                      value={it.ingredient_id}
                      opsi={bahanJalur}
                      placeholder={tipe === "produksi" ? "— pilih resep —" : "— pilih bahan —"}
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
                          : `Belum ada resep yang bisa diproduksi di lokasi ini — susun resep bahan produksi di halaman Resep.`
                      }
                      onChange={(id) => ubahItem(i, { ingredient_id: id })}
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                      Satuan
                    </label>
                    {/* satuan mengikuti master: beli per kemasan, produksi per BATCH resep */}
                    <div className="py-2 text-sm text-stone-700">
                      {tipe === "beli" ? (b ? (b.satuan_beli ?? "kemasan") : "—") : "batch"}
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
                  {tipe === "beli" ? (
                    <div className="w-full shrink-0 md:w-32">
                      <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                        Perkiraan (Rp)
                      </label>
                      {/* harga beli mengikuti master bahan — RAB otomatis */}
                      <div className="py-2 text-right text-sm font-medium text-stone-700">
                        {estimasi != null ? formatRupiah(estimasi) : "—"}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full shrink-0 md:w-44">
                      <label className="mb-1 block text-xs font-medium text-stone-500 md:hidden">
                        Bahan kurang
                      </label>
                      <div className="py-2">
                        <BahanKurangCell
                          ingredientId={it.ingredient_id}
                          jumlahBatch={Number(it.jumlah) || 0}
                          saldoByIng={saldoByIng}
                        />
                      </div>
                    </div>
                  )}
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

        {/* footer: beli = perkiraan total; produksi = catatan (tanpa RAB) */}
        <div className="flex items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-4 py-2.5">
          {tipe === "produksi" ? (
            <span className="text-xs text-stone-400">
              Rak simpan otomatis mengikuti pengaturan bahan (Tempat Penyimpanan);{" "}
              <b>Bahan kurang</b> dihitung dari resep × jumlah batch vs stok lokasi produksi —
              yang kurang / bakal di bawah <b>stok minimum</b> otomatis dibuatkan{" "}
              <b>faktur beli</b> saat disimpan.
            </span>
          ) : (
            <>
              <span className="text-xs text-stone-400">
                Satuan, harga, supplier & rak simpan mengikuti master Bahan Baku.
              </span>
              <div className="text-sm text-stone-700">
                Perkiraan total: <b className="text-base">{formatRupiah(totalFaktur)}</b>
              </div>
            </>
          )}
        </div>
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
          disabled={itemValid.length === 0 || simpan.isPending}
          className={btnPrimary}
        >
          {simpan.isPending ? "Menyimpan…" : "Simpan Faktur"}
        </button>
      </div>

      {/* faktur beli otomatis lahir bersama faktur produksi — beritahu dulu */}
      {hasilBeli && (
        <Modal open onClose={() => navigate(endpoint)} title="✅ Faktur produksi tersimpan">
          <div className="space-y-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              🛒 Faktur beli <b>{hasilBeli.nomor}</b> otomatis dibuat untuk{" "}
              <b>{hasilBeli.jumlah_baris} bahan mentah</b> yang kurang atau bakal jatuh di
              bawah <b>stok minimum</b> setelah produksi ini. Proses belanjanya di halaman{" "}
              <b>Beli Bahan Baku</b>.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => navigate(endpoint)}
                className={btnSecondary}
              >
                Ke Daftar Produksi
              </button>
              <button
                type="button"
                onClick={() => navigate("/pembelian")}
                className={btnPrimary}
              >
                🛒 Lihat Faktur Beli
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
