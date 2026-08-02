import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, AUTH_STORAGE_KEY, loadAuth, saveAuth, type AuthState } from "../lib/api";

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

/** Jeda minimum antar penyegaran sesi (tab yang bolak-balik aktif). */
const JEDA_SEGAR_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());
  const terakhirSegar = useRef(0);

  // SINKRON SESI ANTAR-TAB (satu browser): event `storage` menyala di tab LAIN
  // saat localStorage berubah — login/ganti sesi di satu tab langsung terpasang
  // di semua tab; logout di satu tab melepas semua tab (App otomatis mengarahkan
  // ke /login karena rute bergantung `auth`).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // key null = localStorage.clear(); selain kunci sesi → abaikan
      if (e.key !== null && e.key !== AUTH_STORAGE_KEY) return;
      const berikut = loadAuth();
      setAuth((kini) => {
        if (!berikut) {
          if (!kini) return kini;
          queryClient.clear();
          return null; // logout dari tab lain
        }
        if (!kini || berikut.token !== kini.token) {
          queryClient.clear(); // sesi baru/berganti dari tab lain
          return berikut;
        }
        return kini;
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [queryClient]);

  // SEGARKAN SESI DARI SERVER. Peran & cabang seorang karyawan bisa diubah
  // admin SAAT sesinya berjalan. Token tetap sah — server membaca ulang
  // keanggotaan dari database pada tiap request — tapi sesi yang tersimpan di
  // localStorage masih memuat peran LAMA, dan menu sidebar dibangun dari situ.
  // Akibatnya karyawan yang baru dijadikan "bar" tetap melihat menu peran
  // lamanya (tanpa Produksi/Resep) sampai ia logout lalu login lagi; memuat
  // ulang halaman TIDAK menolong karena localStorage ikut bertahan.
  // /auth/me mengembalikan bentuk yang sama dengan hasil login (minus token).
  const segarkanSesi = useCallback(async () => {
    const kini = loadAuth();
    if (!kini?.token) return;
    const sekarang = Date.now();
    if (sekarang - terakhirSegar.current < JEDA_SEGAR_MS) return;
    terakhirSegar.current = sekarang;
    let baru: Pick<AuthState, "user" | "company" | "branch">;
    try {
      baru = await api<Pick<AuthState, "user" | "company" | "branch">>("/auth/me");
    } catch {
      // Jaringan mati → biarkan sesi apa adanya. 401 (keanggotaan dicabut)
      // sudah ditangani api(): sesi dihapus & dialihkan ke /login.
      return;
    }
    const sama =
      JSON.stringify([kini.user, kini.company, kini.branch]) ===
      JSON.stringify([baru.user, baru.company, baru.branch]);
    if (sama) return;
    const pindahPeran =
      kini.user.role !== baru.user.role || kini.user.branch_id !== baru.user.branch_id;
    saveAuth({ ...kini, ...baru });
    setAuth({ ...kini, ...baru });
    if (pindahPeran) {
      // Cakupan data ikut berubah → buang cache & pilihan lokasi peran lama.
      localStorage.removeItem("kakarut.branch");
      localStorage.removeItem("kakarut.cabang-data");
      localStorage.removeItem("kakarut.cabang-data-ck");
      queryClient.clear();
    }
  }, [queryClient]);

  // Cek saat aplikasi dibuka dan tiap kali tab kembali aktif (dibatasi
  // JEDA_SEGAR_MS) — bukan polling: perubahan peran jarang dan tak mendesak.
  useEffect(() => {
    if (!auth?.token) return;
    void segarkanSesi();
    const onAktif = () => {
      if (document.visibilityState === "visible") void segarkanSesi();
    };
    window.addEventListener("focus", onAktif);
    document.addEventListener("visibilitychange", onAktif);
    return () => {
      window.removeEventListener("focus", onAktif);
      document.removeEventListener("visibilitychange", onAktif);
    };
  }, [auth?.token, segarkanSesi]);

  // Pasang sesi baru + buang cache/pilihan cabang sesi sebelumnya (query key
  // tak memuat company_id, jadi cache lama = data tenant lama).
  const setSession = useCallback(
    (data: AuthState) => {
      queryClient.clear();
      localStorage.removeItem("kakarut.branch");
      localStorage.removeItem("kakarut.cabang-data");
      // Ketiganya, bukan dua. `cabang-data-ck` dulu cuma dibuang di jalur
      // ganti-peran, jadi ia bertahan melintasi logout DAN login: pemilik
      // warung B mewarisi pilihan CK milik warung A di browser POS yang sama.
      localStorage.removeItem("kakarut.cabang-data-ck");
      saveAuth(data);
      setAuth(data);
      // Sesi baru = data server paling mutakhir; mulai lagi jendela jedanya
      // supaya penyegaran berikutnya tak terhalang jeda sesi sebelumnya.
      terakhirSegar.current = Date.now();
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
    localStorage.removeItem("kakarut.cabang-data-ck");
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
