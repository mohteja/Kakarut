import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
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

interface BranchContextValue {
  cabang: Cabang[];
  branchId: string | null;
  setBranchId: (id: string) => void;
  /** query string "?branch_id=..." atau "" untuk kasir (server yang menentukan) */
  branchQuery: string;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  // kasir & tim terkunci ke cabangnya sendiri — server yang menentukan
  const isKasir = auth?.user.role === "cashier" || auth?.user.role === "tim";
  const [branchId, setBranchId] = useState<string | null>(() =>
    isKasir ? (auth?.user.branch_id ?? null) : localStorage.getItem("kakarut.branch") || null,
  );

  // Daftar cabang dimuat untuk semua peran (label, tipe cabang sendiri, struk);
  // kasir/tim tetap tak memilih cabang — hanya membaca.
  const { data: cabang = [] } = useQuery({
    queryKey: ["cabang"],
    queryFn: () => api<Cabang[]>("/cabang"),
    enabled: Boolean(auth?.user.company_id),
  });

  // Validasi pilihan tersimpan: bila bukan cabang aktif milik perusahaan ini
  // (mis. sisa dari akun/perusahaan lain di browser yang sama), reset ke
  // cabang aktif pertama.
  useEffect(() => {
    if (isKasir || cabang.length === 0) return;
    const valid = branchId && cabang.some((b) => b.id === branchId && b.is_active);
    if (!valid) {
      const pertama = cabang.find((b) => b.is_active) ?? cabang[0];
      localStorage.setItem("kakarut.branch", pertama.id);
      setBranchId(pertama.id);
    }
  }, [cabang, branchId, isKasir]);

  const set = (id: string) => {
    localStorage.setItem("kakarut.branch", id);
    setBranchId(id);
  };

  // Kasir tidak pernah mengirim branch_id — server mengunci ke cabangnya.
  const branchQuery = !isKasir && branchId ? `?branch_id=${branchId}` : "";

  return (
    <BranchContext.Provider value={{ cabang, branchId, setBranchId: set, branchQuery }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch harus dipakai di dalam BranchProvider");
  return ctx;
}
