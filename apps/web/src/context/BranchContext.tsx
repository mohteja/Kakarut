import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCompanyMode } from "../lib/useCompanyMode";
import { useAuth } from "./AuthContext";

export interface Cabang {
  id: string;
  nama: string;
  alamat: string | null;
  telepon: string | null;
  /**
   * store = outlet penjualan; central_kitchen = dapur produksi pengirim;
   * kantor = lokasi kerja admin/finance (bukan tujuan kirim barang)
   */
  tipe: "store" | "central_kitchen" | "kantor";
  /** CK pemasok cabang store — store hanya menerima kiriman dari CK ini */
  central_kitchen_id: string | null;
  /** struk per cabang: footer + tampil/tidaknya alamat & telepon cabang */
  receipt_footer: string | null;
  receipt_show_alamat: boolean;
  /** titik maps + radius absen — absen hanya diterima dalam radius ini */
  latitude: number | null;
  longitude: number | null;
  radius_absen_m: number;
  is_active: boolean;
}

/** Label cabang dengan ikon jenisnya — dipakai di pemilih cabang. */
export function labelCabang(b: Pick<Cabang, "nama" | "tipe">) {
  const ikon = b.tipe === "central_kitchen" ? "🏭" : b.tipe === "kantor" ? "🏢" : "🏪";
  return `${ikon} ${b.nama}`;
}

/**
 * DIVISI kerja manajemen = jenis lokasi yang dipilih di sidebar. Satu
 * perusahaan, beda divisi: pilih Central Kitchen → hanya menu produksi;
 * pilih cabang store → hanya menu kasir; pilih Kantor (pusat) → semua menu.
 * null = tanpa pembagian divisi (Lite, kasir/tim, atau belum ada kantor).
 */
export type Divisi = "store" | "central_kitchen" | "kantor" | null;

interface BranchContextValue {
  cabang: Cabang[];
  branchId: string | null;
  setBranchId: (id: string) => void;
  /** query string "?branch_id=..." atau "" untuk kasir (server yang menentukan) */
  branchQuery: string;
  divisi: Divisi;
  /** pilihan "cabang data" saat berada di Kantor (dipakai useCabangData) */
  dataBranchId: string | null;
  setDataBranchId: (id: string) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { isPro } = useCompanyMode();
  // kasir & tim terkunci ke cabangnya sendiri — server yang menentukan
  const isKasir = auth?.user.role === "cashier" || auth?.user.role === "tim";
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const [branchId, setBranchId] = useState<string | null>(() =>
    isKasir ? (auth?.user.branch_id ?? null) : localStorage.getItem("kakarut.branch") || null,
  );
  // Cabang yang datanya sedang dikelola DARI kantor (stok/meja/kasir/dll.)
  const [dataBranchId, setDataBranchIdState] = useState<string | null>(
    () => localStorage.getItem("kakarut.cabang-data") || null,
  );

  // Daftar cabang dimuat untuk semua peran (label, tipe cabang sendiri, struk);
  // kasir/tim tetap tak memilih cabang — hanya membaca.
  const { data: cabang = [] } = useQuery({
    queryKey: ["cabang"],
    queryFn: () => api<Cabang[]>("/cabang"),
    enabled: Boolean(auth?.user.company_id),
  });

  // Validasi pilihan tersimpan: bila bukan cabang aktif milik perusahaan ini
  // (mis. sisa dari akun/perusahaan lain di browser yang sama), reset —
  // manajemen mendarat di Kantor (pusat, semua menu) bila ada.
  useEffect(() => {
    if (isKasir || cabang.length === 0) return;
    const valid = branchId && cabang.some((b) => b.id === branchId && b.is_active);
    if (!valid) {
      const kantor = cabang.find((b) => b.is_active && b.tipe === "kantor");
      const pertama = kantor ?? cabang.find((b) => b.is_active) ?? cabang[0];
      localStorage.setItem("kakarut.branch", pertama.id);
      setBranchId(pertama.id);
    }
  }, [cabang, branchId, isKasir]);

  const set = (id: string) => {
    localStorage.setItem("kakarut.branch", id);
    setBranchId(id);
  };
  const setDataBranchId = (id: string) => {
    localStorage.setItem("kakarut.cabang-data", id);
    setDataBranchIdState(id);
  };

  // Divisi hanya berlaku untuk manajemen mode Pro DAN perusahaan yang sudah
  // punya Kantor aktif — tanpa kantor, semua menu selalu tampil (tidak ada
  // "pusat" lain untuk mengelola perusahaan).
  const adaKantor = cabang.some((b) => b.is_active && b.tipe === "kantor");
  // is_active ikut dicek: pilihan tersimpan yang menunjuk cabang nonaktif tidak
  // boleh membentuk divisi (efek validasi di atas akan meresetnya ke Kantor).
  const dipilih = cabang.find((b) => b.id === branchId && b.is_active);
  const divisi: Divisi =
    isManajemen && isPro && adaKantor && dipilih ? dipilih.tipe : null;

  // Kasir tidak pernah mengirim branch_id — server mengunci ke cabangnya.
  const branchQuery = !isKasir && branchId ? `?branch_id=${branchId}` : "";

  return (
    <BranchContext.Provider
      value={{ cabang, branchId, setBranchId: set, branchQuery, divisi, dataBranchId, setDataBranchId }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch harus dipakai di dalam BranchProvider");
  return ctx;
}

/**
 * Cabang DATA untuk halaman yang butuh satu cabang konkret (stok, meja,
 * kasir, shift, penerimaan, faktur…). Di luar Kantor sama persis dengan
 * pemilih sidebar; DARI Kantor memakai pilihan "cabang data" tersendiri
 * (default cabang store pertama) — kantor sendiri tidak menyimpan stok/meja.
 */
export function useCabangData(): {
  id: string | null;
  query: string;
  dariKantor: boolean;
  opsi: Cabang[];
  pilih: (id: string) => void;
} {
  const { cabang, branchId, branchQuery, divisi, dataBranchId, setDataBranchId } = useBranch();
  if (divisi !== "kantor") {
    return { id: branchId, query: branchQuery, dariKantor: false, opsi: [], pilih: () => {} };
  }
  // Kantor ikut di akhir daftar: data lama yang terlanjur tercatat di kantor
  // (faktur/shift sebelum pembagian divisi) tetap bisa dibuka & diselesaikan.
  const aktif = cabang.filter((b) => b.is_active);
  const opsi = [...aktif.filter((b) => b.tipe !== "kantor"), ...aktif.filter((b) => b.tipe === "kantor")];
  const utama = opsi.find((b) => b.tipe === "store") ?? opsi[0];
  const id =
    dataBranchId && opsi.some((b) => b.id === dataBranchId) ? dataBranchId : (utama?.id ?? null);
  return {
    id,
    query: id ? `?branch_id=${id}` : "",
    dariKantor: true,
    opsi,
    pilih: setDataBranchId,
  };
}
