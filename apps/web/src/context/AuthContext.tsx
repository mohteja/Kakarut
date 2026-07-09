import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, loadAuth, saveAuth, type AuthState } from "../lib/api";

interface AuthContextValue {
  auth: AuthState | null;
  login: (email: string, password: string) => Promise<AuthState>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<AuthState>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    saveAuth(data);
    setAuth(data);
    return data;
  }, []);

  const logout = useCallback(() => {
    saveAuth(null);
    setAuth(null);
  }, []);

  return <AuthContext.Provider value={{ auth, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
