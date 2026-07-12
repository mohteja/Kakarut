import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

export interface Cabang {
  id: string;
  nama: string;
  alamat: string | null;
  /**
   * store = outlet penjualan; central_kitchen = dapur produksi pengirim;
   * kantor = lokasi kerja admin/finance (bukan tujuan kirim barang)
   */
  tipe: "store" | "central_kitchen" | "kantor";
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
  const isKasir = auth?.user.role === "cashier";
  const [branchId, setBranchId] = useState<string | null>(
    () => (isKasir ? null : localStorage.getItem("kakarut.branch") || null),
  );

  const { data: cabang = [] } = useQuery({
    queryKey: ["cabang"],
    queryFn: () => api<Cabang[]>("/cabang"),
    enabled: Boolean(auth?.user.company_id) && !isKasir,
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
