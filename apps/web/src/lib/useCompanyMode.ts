import { useQuery } from "@tanstack/react-query";
import type { CompanyRow, ModeCompany } from "@kakarut/shared";
import { useAuth } from "../context/AuthContext";
import { api } from "./api";

/**
 * Pandangan sempit atas `GET /company` — bentuknya milik kontrak
 * (`CompanyRow`, Lampiran A). Sampai 2026-09-06 diketik ulang di sini, dan ia
 * salah satu dari TIGA salinan web atas satu balasan yang sama.
 */
type CompanyMode = Pick<CompanyRow, "mode" | "plan">;

/**
 * Mode aplikasi perusahaan: Lite (1 cabang) vs Pro (multi-lokasi CK/cabang/
 * kantor). Query key sama dengan PerusahaanPage (["company"]) → satu fetch
 * untuk keduanya. Kasir tidak memanggil /company (halamannya tak butuh mode).
 */
export function useCompanyMode(): { mode: ModeCompany; isPro: boolean } {
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
