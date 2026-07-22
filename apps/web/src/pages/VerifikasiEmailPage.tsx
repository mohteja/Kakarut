import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { btnPrimary } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

/**
 * Verifikasi email dari tautan (?token=...). Dijalankan otomatis saat halaman
 * dibuka: sukses → dapat sesi (auto-login) & dialihkan ke beranda; gagal →
 * pesan + tautan ke halaman Masuk (bisa minta tautan baru dari sana).
 */
export function VerifikasiEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { verifikasiEmail } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"proses" | "sukses" | "gagal">(
    token ? "proses" : "gagal",
  );
  const [error, setError] = useState<string | null>(
    token ? null : "Tautan tidak valid — token tidak ada.",
  );
  const sudahJalan = useRef(false);

  useEffect(() => {
    if (!token || sudahJalan.current) return;
    sudahJalan.current = true; // cegah verifikasi ganda (React StrictMode)
    verifikasiEmail(token)
      .then(() => {
        setStatus("sukses");
        // Sudah punya sesi → App merutekan "/" ke onboarding / dashboard.
        setTimeout(() => navigate("/", { replace: true }), 900);
      })
      .catch((err) => {
        setStatus("gagal");
        setError(err instanceof Error ? err.message : "Verifikasi gagal");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
        <Logo className="mx-auto h-16 w-16 shadow-lg" />
        <h1 className="mt-3 text-2xl font-bold text-stone-800">Verifikasi Email</h1>
        <div className="mt-6">
          {status === "proses" && (
            <p className="text-sm text-stone-500">Memverifikasi email Anda…</p>
          )}
          {status === "sukses" && (
            <div className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
              ✅ Email berhasil diverifikasi. Mengalihkan…
            </div>
          )}
          {status === "gagal" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              <Link to="/login" className={`${btnPrimary} block w-full text-center`}>
                Ke halaman Masuk
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
