import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { JenisPengadaan, KonfirmasiStatus } from "@kakarut/shared";
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
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

interface StokMasukPage {
  rows: StokMasukRow[];
  total: number;
  total_pengeluaran: number;
}
import { DokumenBelanjaModal } from "./DokumenBelanjaModal";
import { DokumenKirimModal } from "./DokumenKirimModal";
import { FakturDetailModal } from "./FakturDetailModal";
import type { TahapNavState } from "./TahapPage";

export interface StokMasukRow {
  id: string;
  bahan: string;
  isi: number;
  satuan: string;
  /** satuan beli/kemasan (mis. "dus"); 1 satuan_beli = isi satuan */
  satuan_beli?: string | null;
  qty: number;
  total_harga: number | null;
  is_batch: boolean;
  catatan: string | null;
  waktu: string;
  prod_date: string;
  faktur_id: string | null;
  no_faktur: string | null;
  status: KonfirmasiStatus;
  supplier: string | null;
  tempat: string | null;
  supplier_id: string | null;
  storage_location_id: string | null;
  /** RAK SIMPAN default (home) bahan di CK — untuk auto-file & pratinjau per rak */
  default_storage_location_id?: string | null;
  default_tempat?: string | null;
  dibuat_oleh: string | null;
  diubah_oleh: string | null;
  updated_at: string | null;
  worker_id: string | null;
  dikerjakan_oleh: string | null;
  qty_dipesan: number | null;
  alasan_tolak: string | null;
  /** cabang baris (utk tampilan Kantor "semua cabang") */
  branch_id?: string | null;
  cabang?: string | null;
  /** work-order CK: cabang tujuan pengiriman (null = bukan work-order) */
  tujuan_branch_id?: string | null;
  tujuan_cabang?: string | null;
  /** total dana cair faktur ini (nilai sama di tiap baris; 0 bila belum ada) */
  dana_cair: number;
  /** supplier UTAMA bahan baris ini (info "beli di mana" saat diproses) */
  supplier_bahan?: string | null;
  supplier_bahan_alamat?: string | null;
  supplier_bahan_telepon?: string | null;
}

export interface FakturGroup {
  key: string;
  fakturId: string | null;
  waktu: string;
  prodDate: string;
  supplier: string | null;
  supplierId: string | null;
  noFaktur: string | null;
  status: StatusFaktur;
  catatan: string | null;
  dibuatOleh: string | null;
  diubahOleh: string | null;
  updatedAt: string | null;
  workerId: string | null;
  dikerjakanOleh: string | null;
  /** cabang baris + tujuan work-order (utk tampilan Kantor & aksi Kirim) */
  cabang: string | null;
  tujuanCabang: string | null;
  rows: StokMasukRow[];
  totalHarga: number;
  /** total dana yang sudah cair untuk faktur ini */
  danaCair: number;
}

/**
 * Status satu FAKTUR (bukan baris). Setelah "terima sebagian", satu faktur
 * bisa punya baris diterima + baris ditolak sekaligus → status "sebagian".
 * Setelah "maju sebagian": ada baris selesai + baris yang masih dikerjakan
 * → status "selesai_sebagian" (masih ada item yang belum).
 */
export type StatusFaktur = KonfirmasiStatus | "sebagian" | "selesai_sebagian";

const BADGE_SEBAGIAN = { label: "📦 Diterima sebagian", cls: "bg-green-100 text-green-800" };
const BADGE_SELESAI_SEBAGIAN = {
  label: "✅ Selesai sebagian",
  cls: "bg-lime-100 text-lime-800",
};

/** Urutan pipeline — dipakai aturan "tahap hanya bisa maju" & pilihan dropdown. */
export const URUTAN_TAHAP: Record<KonfirmasiStatus, number> = {
  rencana: 0,
  dikerjakan: 1,
  menunggu: 2,
  dikonfirmasi: 3,
  ditolak: 3,
};

/**
 * Status faktur diturunkan dari status baris-barisnya. Setelah "maju sebagian"
 * baris-baris bisa berbeda tahap → tampilkan tahap PALING AWAL yang belum
 * selesai (di situlah sisa tugas berada).
 */
export function statusFaktur(rows: { status: KonfirmasiStatus }[]): StatusFaktur {
  const set = new Set(rows.map((r) => r.status));
  if (set.size === 1) return rows[0].status;
  // ada item yang sudah selesai (dikirim/diterima) TAPI masih ada yang belum
  // → "selesai sebagian"
  const adaBelum = set.has("rencana") || set.has("dikerjakan");
  const adaSelesai = set.has("menunggu") || set.has("dikonfirmasi");
  if (adaBelum && adaSelesai) return "selesai_sebagian";
  for (const s of ["rencana", "dikerjakan", "menunggu"] as const) {
    if (set.has(s)) return s;
  }
  // campuran baris selesai: ada yang diterima & ditolak
  return "sebagian";
}

/** Badge faktur (peduli "sebagian"), pilih peta sesuai jalur. */
export function badgeFaktur(tipe: JenisPengadaan, status: StatusFaktur) {
  if (status === "sebagian") return BADGE_SEBAGIAN;
  if (status === "selesai_sebagian") return BADGE_SELESAI_SEBAGIAN;
  return (tipe === "produksi" ? STATUS_PRODUKSI : STATUS_BELI)[status];
}

/** Faktur yang belum selesai (masih dalam pipeline) belum menambah saldo stok. */
export function belumSelesai(status: StatusFaktur) {
  return (
    status === "rencana" ||
    status === "dikerjakan" ||
    status === "menunggu" ||
    status === "selesai_sebagian"
  );
}

/** Badge tahap pipeline produksi. Produksi tak ber-RAB (bahan sudah dibeli di
 * Beli Bahan Baku) — tahap awal cukup "belum dikerjakan". */
export const STATUS_PRODUKSI: Record<KonfirmasiStatus, { label: string; cls: string }> = {
  rencana: { label: "📋 Belum dikerjakan", cls: "bg-stone-200 text-stone-700" },
  dikerjakan: { label: "🔨 Sedang dikerjakan", cls: "bg-blue-100 text-blue-800" },
  menunggu: { label: "✅ Selesai — menunggu konfirmasi", cls: "bg-yellow-100 text-yellow-800" },
  dikonfirmasi: { label: "📦 Dikonfirmasi ✓", cls: "bg-green-100 text-green-800" },
  ditolak: { label: "❌ Ditolak", cls: "bg-red-100 text-red-700" },
};

/** Badge tahap pipeline pembelian: RAB → diproses → dikirim → diterima / ditolak. */
export const STATUS_BELI: Record<KonfirmasiStatus, { label: string; cls: string }> = {
  rencana: { label: "📋 RAB (Rencana beli)", cls: "bg-stone-200 text-stone-700" },
  dikerjakan: { label: "🔄 Diproses", cls: "bg-blue-100 text-blue-800" },
  menunggu: { label: "🚚 Dikirim — menunggu penerimaan", cls: "bg-yellow-100 text-yellow-800" },
  dikonfirmasi: { label: "📦 Diterima ✓", cls: "bg-green-100 text-green-800" },
  ditolak: { label: "❌ Ditolak penerima", cls: "bg-red-100 text-red-700" },
};

/** Label ringkas tahap satu BARIS (dipakai saat faktur berisi campuran tahap). */
export function labelTahapRingkas(tipe: JenisPengadaan, s: KonfirmasiStatus) {
  const beli = tipe === "beli";
  switch (s) {
    case "rencana":
      return beli ? "📋 RAB" : "📋 belum dikerjakan";
    case "dikerjakan":
      return beli ? "🔄 diproses" : "🔨 dikerjakan";
    case "menunggu":
      return beli ? "🚚 dikirim" : "✅ selesai";
    case "dikonfirmasi":
      return beli ? "📦 diterima" : "📦 masuk stok";
    case "ditolak":
      return "❌ ditolak";
  }
}

export type TahapTujuan = "dikerjakan" | "menunggu" | "dikonfirmasi";

/** Pilihan tujuan tahap pada dropdown "Ubah tahap…", per jalur. */
export const AKSI_TAHAP: Record<JenisPengadaan, Array<{ ke: TahapTujuan; label: string }>> = {
  produksi: [
    { ke: "dikerjakan", label: "🔨 Mulai dikerjakan" },
    { ke: "menunggu", label: "✅ Selesai — menunggu konfirmasi" },
    { ke: "dikonfirmasi", label: "📦 Konfirmasi Ada (masuk stok)" },
  ],
  beli: [
    { ke: "dikerjakan", label: "🔄 Diproses" },
    { ke: "menunggu", label: "🚚 Dikirim ke toko" },
    { ke: "dikonfirmasi", label: "📦 Diterima (masuk stok)" },
  ],
};

const TEKS: Record<JenisPengadaan, { judul: string; endpoint: string; logJudul: string }> = {
  produksi: { judul: "Produksi Bahan Baku", endpoint: "/produksi", logJudul: "Produksi hari ini" },
  beli: { judul: "Beli Bahan Baku", endpoint: "/pembelian", logJudul: "Pembelian hari ini" },
};

/**
 * Halaman penerimaan stok per jalur (produksi sendiri / beli jadi):
 * tombol tambah → faktur multi-item → simpan (menunggu) → "Konfirmasi Ada"
 * → stok terhitung.
 */
export function TambahStokPage({ tipe }: { tipe: JenisPengadaan }) {
  const t = TEKS[tipe];
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  // rekomendasi beli = analitik manajemen; karyawan CK cukup buat faktur
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  // Faktur per cabang — DARI KANTOR tampil SEMUA cabang (kantor memantau
  // semuanya); di divisi/store lain terkunci ke cabang datanya.
  const { query: dataQuery, dariKantor } = useCabangData();
  const branchQuery = dariKantor ? "?branch_id=all" : dataQuery;
  const [detail, setDetail] = useState<FakturGroup | null>(null);

  // Kirim barang bertujuan cabang dari CK (produksi selesai / belanja yang
  // sudah tiba di CK) — langkah terpisah + dokumen kirim (surat jalan).
  const kirim = useMutation({
    mutationFn: (fakturId: string) =>
      api(`${t.endpoint}/kirim/${fakturId}`, { method: "POST", body: {} }),
    onSuccess: (_data, fakturId) => {
      queryClient.invalidateQueries({ queryKey: [t.endpoint] });
      queryClient.invalidateQueries({ queryKey: ["penerimaan"] });
      // dokumen kirim terbuka otomatis — pegangan pengantar barang
      setDokumenKirim(fakturId);
    },
  });

  // Buku besar: filter tanggal + pagination per faktur. Halaman 1 = faktur
  // yang BELUM selesai dulu, lalu terbaru (urutan dari server).
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [t.endpoint, branchQuery, dari, sampai, perPage, page],
    queryFn: () => {
      const p = new URLSearchParams();
      if (dari) p.set("dari", dari);
      if (sampai) p.set("sampai", sampai);
      p.set("per_page", String(perPage));
      p.set("page", String(page));
      return api<StokMasukPage>(
        `${t.endpoint}${branchQuery ? `${branchQuery}&` : "?"}${p.toString()}`,
      );
    },
    placeholderData: (prev) => prev,
  });
  const log = data?.rows;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  function gantiFilter(fn: () => void) {
    fn();
    setPage(1);
  }
  function keHalaman(n: number) {
    setPage(Math.min(totalPages, Math.max(1, n)));
  }

  // Ubah tahap lewat dropdown → HALAMAN penyesuaian (bukan modal, agar gestur
  // back touchpad tak menutup form tak sengaja). Grup dikirim lewat router
  // state; simpan → redirect balik ke daftar ini.
  const navigate = useNavigate();
  // Produksi mulai dikerjakan tak punya input apa pun (tak belanja → tak ada
  // uang cair) → cukup konfirmasi modal, tak perlu halaman penuh.
  const [konfirmProses, setKonfirmProses] = useState<FakturGroup | null>(null);
  const mulaiProduksi = useMutation({
    mutationFn: (g: FakturGroup) =>
      api(`${t.endpoint}/tahap/${g.fakturId}`, {
        method: "POST",
        body: {
          ke: "dikerjakan",
          items: g.rows
            .filter((r) => r.status === "rencana")
            .map((r) => ({ id: r.id, qty: r.qty })),
        },
      }),
    onSuccess: () => {
      for (const key of [t.endpoint, "stok", "laporan", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setKonfirmProses(null);
    },
  });
  const bukaUbahTahap = (g: FakturGroup, ke: TahapTujuan) => {
    if (tipe === "produksi" && ke === "dikerjakan") {
      setKonfirmProses(g);
      return;
    }
    const st: TahapNavState = {
      grup: g,
      tipe,
      endpoint: t.endpoint,
      ke,
      kembali: t.endpoint,
    };
    navigate(`${t.endpoint}/tahap`, { state: st });
  };
  // Dokumen belanja (pegangan pembelanja) — simpan KEY faktur agar isi modal
  // ikut segar setelah data list ter-refresh (bukan snapshot lama).
  const [dokumen, setDokumen] = useState<string | null>(null);
  // Setelah halaman Ubah Tahap "beli → diproses" redirect ke sini dengan
  // ?dok=<key>, buka dokumen belanja otomatis lalu bersihkan query-nya.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const dok = searchParams.get("dok");
    if (dok) {
      setDokumen(dok);
      const next = new URLSearchParams(searchParams);
      next.delete("dok");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Dokumen kirim (surat jalan CK → cabang) — pola yang sama.
  const [dokumenKirim, setDokumenKirim] = useState<string | null>(null);

  // Kelompokkan baris per faktur (baris lama tanpa faktur = grup sendiri)
  const grup = useMemo<FakturGroup[]>(() => {
    const byKey = new Map<string, FakturGroup>();
    for (const r of log ?? []) {
      const key = r.faktur_id ?? r.id;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          fakturId: r.faktur_id,
          waktu: r.waktu,
          prodDate: r.prod_date,
          supplier: r.supplier,
          supplierId: r.supplier_id,
          noFaktur: r.no_faktur,
          status: r.status,
          catatan: r.catatan,
          dibuatOleh: r.dibuat_oleh,
          diubahOleh: r.diubah_oleh,
          updatedAt: r.updated_at,
          workerId: r.worker_id,
          dikerjakanOleh: r.dikerjakan_oleh,
          cabang: r.cabang ?? null,
          tujuanCabang: r.tujuan_cabang ?? null,
          rows: [],
          totalHarga: 0,
          danaCair: r.dana_cair ?? 0,
        };
        byKey.set(key, g);
      }
      g.rows.push(r);
      // faktur campuran (produk jadi + bahan produksi): tujuan diambil dari
      // baris mana pun yang punya — baris bahan produksi tujuannya null
      if (!g.tujuanCabang && r.tujuan_cabang) g.tujuanCabang = r.tujuan_cabang;
      // baris ditolak tak menambah biaya (barang tidak diterima)
      if (r.status !== "ditolak") g.totalHarga += r.total_harga ?? 0;
    }
    // status faktur = agregat status baris (campuran diterima+ditolak = "sebagian")
    for (const g of byKey.values()) g.status = statusFaktur(g.rows);
    // urutan kartu = urutan server: yang belum selesai dulu, lalu terbaru
    return [...byKey.values()].sort((a, b) => {
      const beresA = belumSelesai(a.status) ? 0 : 1;
      const beresB = belumSelesai(b.status) ? 0 : 1;
      if (beresA !== beresB) return beresA - beresB;
      return b.waktu.localeCompare(a.waktu);
    });
  }, [log]);

  const totalPengeluaran = data?.total_pengeluaran ?? 0;
  const adaBelumKonfirmasi = grup.some((g) => belumSelesai(g.status));
  const jenisKata = tipe === "produksi" ? "produksi" : "pembelian";

  return (
    <div>
      {/* Dari Kantor daftar tampil semua cabang (tanpa pemilih cabang). */}
      {!dariKantor && <CabangDataBar />}
      <PageTitle
        aksi={
          <div className="flex flex-wrap gap-2">
            {tipe === "beli" && isManajemen && (
              <Link to="/pembelian/rekomendasi" className={btnSecondary}>
                📊 Rekomendasi Beli
              </Link>
            )}
            <Link to={`${t.endpoint}/baru`} className={btnPrimary}>
              + Tambah {tipe === "produksi" ? "Produksi" : "Pembelian"}
            </Link>
          </div>
        }
      >
        {t.judul}
      </PageTitle>

      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Stok bertambah <b>setelah faktur dikonfirmasi</b> ("Konfirmasi Ada" = barang
        benar-benar diterima & tersimpan) — memudahkan stock opname. Ubah tahap lewat
        tombol <b>➡ Ubah Tahap</b> pada tiap kartu; bisa sebagian dulu bila barang
        belum lengkap. Ketuk kartu untuk melihat rincian semua bahan.
      </div>

      <ErrorText error={kirim.error} />

      {/* Filter tanggal + jumlah baris (buku besar) */}
      <Card className="mb-3 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-[9.5rem] flex-1 sm:flex-none">
          <label className="mb-1 block text-xs font-medium text-stone-500">Dari tanggal</label>
          <input
            type="date"
            value={dari}
            onChange={(e) => gantiFilter(() => setDari(e.target.value))}
            className={inputClass}
          />
        </div>
        <div className="min-w-[9.5rem] flex-1 sm:flex-none">
          <label className="mb-1 block text-xs font-medium text-stone-500">Sampai tanggal</label>
          <input
            type="date"
            value={sampai}
            onChange={(e) => gantiFilter(() => setSampai(e.target.value))}
            className={inputClass}
          />
        </div>
        {(dari || sampai) && (
          <button
            onClick={() => gantiFilter(() => { setDari(""); setSampai(""); })}
            className={btnSecondary}
          >
            Semua tanggal
          </button>
        )}
      </Card>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-stone-700">
          Riwayat {tipe === "produksi" ? "Produksi" : "Pembelian"}{" "}
          <span className="text-sm font-normal text-stone-400">({total} faktur)</span>
        </h2>
        {tipe === "beli" && totalPengeluaran > 0 && (
          <div className="text-sm text-stone-500">
            Pengeluaran terkonfirmasi{dari || sampai ? " (rentang)" : ""}:{" "}
            <b>{formatRupiah(totalPengeluaran)}</b>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : grup.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {dari || sampai
            ? `Tidak ada ${jenisKata} pada rentang tanggal ini.`
            : `Belum ada ${jenisKata}.`}
        </Card>
      ) : (
        <div className="space-y-3">
          {grup.map((g) => {
            // faktur campuran tahap (hasil "maju sebagian") → tampilkan pill
            // tahap per baris + jumlah sisa tugas
            const campuran = new Set(g.rows.map((r) => r.status)).size > 1;
            const sisaTugas = g.rows.filter((r) => belumSelesai(r.status)).length;
            const tahapTerawal = Math.min(...g.rows.map((r) => URUTAN_TAHAP[r.status]));
            const adaTujuan = g.rows.some((r) => r.tujuan_branch_id != null);
            // Work-order CK: konfirmasi lewat Penerimaan cabang (bukan di CK) →
            // buang opsi "Konfirmasi Ada" dari dropdown; pakai tombol Kirim.
            const isWorkOrderFaktur = tipe === "produksi" && adaTujuan;
            const opsiTahap = AKSI_TAHAP[tipe]
              .filter(
                (a) =>
                  URUTAN_TAHAP[a.ke] > tahapTerawal &&
                  !(isWorkOrderFaktur && a.ke === "dikonfirmasi"),
              )
              // belanja bertujuan cabang: "menunggu" = barang tiba/kumpul di CK
              .map((a) =>
                tipe === "beli" && adaTujuan && a.ke === "menunggu"
                  ? { ...a, label: "📦 Tiba di CK (semua barang di CK)" }
                  : a,
              );
            // Barang bertujuan cabang yang SIAP DIKIRIM dari CK: produksi
            // selesai / belanja tiba di CK — tombol Kirim + dokumen kirim.
            const siapKirim =
              g.fakturId != null &&
              g.rows.some(
                (r) =>
                  r.status === "menunggu" &&
                  r.tujuan_branch_id != null &&
                  r.branch_id !== r.tujuan_branch_id,
              );
            // barang DALAM PERJALANAN (sudah dikirim, menunggu diterima cabang)
            const adaTerkirim = g.rows.some(
              (r) =>
                r.status === "menunggu" &&
                r.tujuan_branch_id != null &&
                r.branch_id === r.tujuan_branch_id,
            );
            // badge lebih jujur utk belanja yang barangnya kumpul di CK
            const badge =
              tipe === "beli" && g.status === "menunggu" && siapKirim
                ? { label: "📦 Di CK — siap kirim ke cabang", cls: "bg-purple-100 text-purple-800" }
                : badgeFaktur(tipe, g.status);
            // kartu ringkas ala transaksi marketplace: tampilkan 1 barang
            // pertama + jumlah bahan lainnya; rincian lengkap via klik kartu
            const utama = g.rows[0];
            return (
            <Card
              key={g.key}
              onClick={() => setDetail(g)}
              className={`cursor-pointer overflow-hidden transition hover:border-orange-300 hover:shadow-sm ${belumSelesai(g.status) ? "border-yellow-300" : ""}`}
            >
              {/* Header ala transaksi marketplace: jenis + tanggal di kiri,
                  STATUS di pojok kanan atas kotak. */}
              <div className="flex items-start justify-between gap-2 border-b border-stone-100 px-3 py-2.5 sm:px-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-bold text-stone-800">
                      {tipe === "produksi" ? "🏭 Produksi" : "🛒 Pembelian"}
                    </span>
                    <span className="text-sm text-stone-500">
                      {formatTanggalRingkas(g.waktu)} · {formatWaktu(g.waktu)}
                    </span>
                    {g.noFaktur && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                        {g.noFaktur}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500">
                    <span className="font-medium text-stone-600">
                      {tipe === "produksi"
                        ? `🔧 ${g.dikerjakanOleh ?? g.supplier ?? "Produksi sendiri"}`
                        : g.dikerjakanOleh
                          ? `🔧 ${g.dikerjakanOleh}` // pemroses belanja (tercatat saat Diproses)
                          : (g.supplier ?? "Belum diproses")}
                    </span>
                    {g.danaCair > 0 && (
                      <span
                        className="whitespace-nowrap font-semibold text-emerald-700"
                        title="Total dana yang sudah cair untuk faktur ini"
                      >
                        💸 cair {formatRupiah(g.danaCair)}
                      </span>
                    )}
                    {/* cabang faktur (tampilan Kantor "semua cabang") */}
                    {dariKantor && g.cabang && <span>🏪 {g.cabang}</span>}
                    {/* TUJUAN pengiriman — dibuat mencolok agar tak salah lihat */}
                    {g.tujuanCabang && (
                      <span className="whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-sm font-bold text-purple-800">
                        📦 → {g.tujuanCabang}
                      </span>
                    )}
                    {g.catatan && <span>· {g.catatan}</span>}
                  </div>
                </div>
                {/* status di pojok kanan atas kotak */}
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>

              {/* Isi ringkas: cukup 1 barang + jumlah bahan lainnya — rincian
                  lengkap tetap tersedia dgn mengetuk kartu */}
              <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-3 py-2.5 sm:px-4">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-stone-800">{utama.bahan}</div>
                  <div className="text-xs text-stone-500">
                    {formatAngka(utama.qty)} {utama.satuan}
                    {g.rows.length > 1 && <> · +{g.rows.length - 1} bahan lainnya</>}
                    {campuran && sisaTugas > 0 && (
                      <span className="ml-1.5 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                        📌 sisa tugas: {sisaTugas}
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-stone-400">detail ›</span>
              </div>

              {/* Footer: total transaksi di kiri, tombol aksi BESAR di kanan
                  (di bawah status) */}
              <div className="flex flex-wrap items-end justify-between gap-3 px-3 py-2.5 sm:px-4">
                <div>
                  {/* Produksi tak menampilkan biaya/RAB (bahan sudah dibeli di
                      Beli Bahan Baku) — cukup jumlah bahan yang diproduksi. */}
                  {tipe === "beli" ? (
                    <>
                      <div className="text-xs text-stone-500">
                        Total transaksi{g.rows.length > 1 ? ` (${g.rows.length} bahan)` : ""}:
                      </div>
                      <div className="text-lg font-bold text-stone-800">
                        {formatRupiah(g.totalHarga)}
                      </div>
                    </>
                  ) : (
                    <div className="text-lg font-bold text-stone-800">
                      {g.rows.length} bahan diproduksi
                    </div>
                  )}
                  {/* pembuat faktur cukup di footer — header tetap ringkas */}
                  {g.dibuatOleh && (
                    <div className="text-xs text-stone-400">dibuat oleh {g.dibuatOleh}</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Dokumen belanja/RAB: tersedia di SEMUA tahap (kecuali
                      baris yang semuanya ditolak) — sejak RAB agar finance bisa
                      meninjau anggaran, jadi pegangan pembelanja saat diproses,
                      lalu arsip setelah masuk stok. Bisa dicetak & diunduh. */}
                  {tipe === "beli" && g.rows.some((r) => r.status !== "ditolak") && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDokumen(g.key);
                      }}
                      className="whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 hover:border-orange-400 hover:text-orange-700"
                    >
                      📄{" "}
                      {g.rows.every((r) => r.status === "rencana" || r.status === "ditolak")
                        ? "Dokumen RAB"
                        : "Dokumen belanja"}
                    </button>
                  )}
                  {/* dokumen kirim (surat jalan) barang dalam perjalanan */}
                  {adaTerkirim && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDokumenKirim(g.key);
                      }}
                      className="whitespace-nowrap rounded-lg border border-purple-300 bg-white px-3 py-2.5 text-sm font-semibold text-purple-700 hover:border-purple-500"
                    >
                      📄 Dokumen kirim
                    </button>
                  )}
                  {siapKirim && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Kirim ke ${g.tujuanCabang ?? "cabang tujuan"}? Barang akan menunggu diterima cabang.`))
                          kirim.mutate(g.fakturId!);
                      }}
                      disabled={kirim.isPending}
                      className="whitespace-nowrap rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-500 disabled:opacity-60"
                    >
                      🚚 Kirim ke cabang
                    </button>
                  )}
                  {g.fakturId && belumSelesai(g.status) && opsiTahap.length > 0 && (
                    <select
                      value=""
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        const ke = e.target.value as TahapTujuan | "";
                        if (ke) bukaUbahTahap(g, ke);
                      }}
                      aria-label="Ubah tahap faktur"
                      className="cursor-pointer rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-500"
                    >
                      <option value="">➡ Ubah Tahap</option>
                      {opsiTahap.map((a) => (
                        <option key={a.ke} value={a.ke}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </Card>
            );
          })}
          {adaBelumKonfirmasi && (
            <div className="text-xs text-stone-400">
              Faktur yang belum dikonfirmasi belum menambah saldo stok.
            </div>
          )}
        </div>
      )}

      {/* Pagination + aturan baris di BAWAH daftar */}
      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => keHalaman(1)}
                disabled={page <= 1}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
                title="Terbaru & belum selesai"
              >
                «
              </button>
              <button
                onClick={() => keHalaman(page - 1)}
                disabled={page <= 1}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
              >
                ‹ Sebelumnya
              </button>
              <span className="px-2 text-stone-500">
                Halaman <b>{page}</b> / {totalPages}
              </span>
              <button
                onClick={() => keHalaman(page + 1)}
                disabled={page >= totalPages}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
              >
                Berikutnya ›
              </button>
              <button
                onClick={() => keHalaman(totalPages)}
                disabled={page >= totalPages}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
                title="Terlama"
              >
                »
              </button>
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            Baris / halaman
            <select
              value={perPage}
              onChange={(e) => gantiFilter(() => setPerPage(Number(e.target.value)))}
              className={`${inputClass} w-auto`}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {isFetching && <span className="text-xs text-stone-400">Memuat…</span>}
        </div>
      )}

      {detail && (
        <FakturDetailModal
          // remount tiap ganti faktur — form ubah tidak membawa nilai lama
          key={detail.key}
          grup={detail}
          tipe={tipe}
          endpoint={t.endpoint}
          onClose={() => setDetail(null)}
          // pilih tahap dari detail → buka HALAMAN Ubah Tahap
          onUbahTahap={(ke) => {
            const g = detail;
            setDetail(null);
            bukaUbahTahap(g, ke);
          }}
        />
      )}
      {dokumen &&
        (() => {
          const g = grup.find((x) => x.key === dokumen);
          return g ? (
            <DokumenBelanjaModal key={g.key} grup={g} onClose={() => setDokumen(null)} />
          ) : null;
        })()}
      {dokumenKirim &&
        (() => {
          const g = grup.find((x) => x.key === dokumenKirim);
          return g ? (
            <DokumenKirimModal
              key={g.key}
              grup={g}
              tipe={tipe}
              onClose={() => setDokumenKirim(null)}
            />
          ) : null;
        })()}
      {konfirmProses && (
        <Modal open onClose={() => setKonfirmProses(null)} title="Mulai produksi?">
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Tandai faktur ini <b>sedang Diproses</b>. Produksi tidak membeli apa pun, jadi
              tak ada uang cair yang perlu diisi.
            </p>
            <div className="space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Jumlah bahan jadi</span>
                <b>
                  {konfirmProses.rows.filter((r) => r.status === "rencana").length} baris
                </b>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Total est. RAB</span>
                <b>{formatRupiah(konfirmProses.totalHarga)}</b>
              </div>
            </div>
            <ErrorText error={mulaiProduksi.error} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setKonfirmProses(null)} className={btnSecondary}>
                Batal
              </button>
              <button
                onClick={() => mulaiProduksi.mutate(konfirmProses)}
                disabled={mulaiProduksi.isPending}
                className={btnPrimary}
              >
                {mulaiProduksi.isPending ? "Menyimpan…" : "Ya, Diproses"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
