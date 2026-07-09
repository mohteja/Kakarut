import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, loadAuth, saveAuth, type AuthState } from "../lib/api";

interface AuthContextValue {
  auth: AuthState | null;
  login: (email: string, password: string) => Promise<AuthState>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api<AuthState>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      // Buang seluruh cache & pilihan cabang milik sesi/akun sebelumnya —
      // query key tidak memuat company_id, jadi cache lama = data tenant lama.
      queryClient.clear();
      localStorage.removeItem("kakarut.branch");
      saveAuth(data);
      setAuth(data);
      return data;
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    saveAuth(null);
    localStorage.removeItem("kakarut.branch");
    queryClient.clear();
    setAuth(null);
  }, [queryClient]);

  return <AuthContext.Provider value={{ auth, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
