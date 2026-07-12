import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api } from "./api";

interface CompanyMode {
  mode: "lite" | "pro";
  plan: string;
}

/**
 * Mode aplikasi perusahaan: Lite (1 cabang) vs Pro (multi-lokasi CK/cabang/
 * kantor). Query key sama dengan PerusahaanPage (["company"]) → satu fetch
 * untuk keduanya. Kasir tidak memanggil /company (halamannya tak butuh mode).
 */
export function useCompanyMode(): { mode: "lite" | "pro"; isPro: boolean } {
  const { auth } = useAuth();
  const { data } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<CompanyMode>("/company"),
    enabled: Boolean(auth?.user.company_id) && !auth?.user.is_super_admin,
    staleTime: 60_000,
  });
  const mode = data?.mode === "pro" ? "pro" : "lite";
  return { mode, isPro: mode === "pro" };
}
