import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

export interface Cabang {
  id: string;
  nama: string;
  alamat: string | null;
  is_active: boolean;
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
    () => localStorage.getItem("kakarut.branch") || null,
  );

  const { data: cabang = [] } = useQuery({
    queryKey: ["cabang"],
    queryFn: () => api<Cabang[]>("/cabang"),
    enabled: Boolean(auth?.user.company_id) && !isKasir,
  });

  useEffect(() => {
    if (!isKasir && !branchId && cabang.length > 0) {
      setBranchId(cabang[0].id);
    }
  }, [cabang, branchId, isKasir]);

  const set = (id: string) => {
    localStorage.setItem("kakarut.branch", id);
    setBranchId(id);
  };

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
