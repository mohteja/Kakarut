import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, loadAuth, saveAuth, type AuthState } from "../lib/api";

/** Hasil daftar / kirim-ulang verifikasi (netral, tanpa sesi). */
export interface DaftarResult {
  ok: boolean;
  message?: string;
  /** Hanya di dev (email belum diatur) — tautan verifikasi langsung. */
  dev_verify_url?: string;
}

interface AuthContextValue {
  auth: AuthState | null;
  login: (email: string, password: string) => Promise<AuthState>;
  /** Masuk sebagai tamu (guest mode) — akun bersama tanpa password. */
  masukTamu: (peran: "owner" | "kasir") => Promise<AuthState>;
  /** Daftar akun. TIDAK auto-login: kirim tautan verifikasi ke email. */
  register: (nama: string, email: string, password: string) => Promise<DaftarResult>;
  /** Verifikasi email dari token tautan → langsung dapat sesi (auto-login). */
  verifikasiEmail: (token: string) => Promise<AuthState>;
  /** Kirim ulang tautan verifikasi ke email (netral). */
  kirimUlangVerifikasi: (email: string) => Promise<DaftarResult>;
  /** Ganti sesi aktif (mis. setelah buat perusahaan / terima undangan di onboarding). */
  setSession: (data: AuthState) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());

  // Pasang sesi baru + buang cache/pilihan cabang sesi sebelumnya (query key
  // tak memuat company_id, jadi cache lama = data tenant lama).
  const setSession = useCallback(
    (data: AuthState) => {
      queryClient.clear();
      localStorage.removeItem("kakarut.branch");
      localStorage.removeItem("kakarut.cabang-data");
      saveAuth(data);
      setAuth(data);
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api<AuthState>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setSession(data);
      return data;
    },
    [setSession],
  );

  const masukTamu = useCallback(
    async (peran: "owner" | "kasir") => {
      const data = await api<AuthState>("/auth/guest", {
        method: "POST",
        body: { peran },
      });
      setSession(data);
      return data;
    },
    [setSession],
  );

  const register = useCallback(
    async (nama: string, email: string, password: string) =>
      api<DaftarResult>("/auth/register", {
        method: "POST",
        body: { nama, email, password },
      }),
    [],
  );

  const verifikasiEmail = useCallback(
    async (token: string) => {
      const data = await api<AuthState>("/auth/verify-email", {
        method: "POST",
        body: { token },
      });
      setSession(data);
      return data;
    },
    [setSession],
  );

  const kirimUlangVerifikasi = useCallback(
    async (email: string) =>
      api<DaftarResult>("/auth/resend-verification", {
        method: "POST",
        body: { email },
      }),
    [],
  );

  const logout = useCallback(() => {
    saveAuth(null);
    localStorage.removeItem("kakarut.branch");
    localStorage.removeItem("kakarut.cabang-data");
    queryClient.clear();
    setAuth(null);
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        auth,
        login,
        masukTamu,
        register,
        verifikasiEmail,
        kirimUlangVerifikasi,
        setSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
