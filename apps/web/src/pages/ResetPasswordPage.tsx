import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { btnPrimary, InputPassword } from "../components/ui";
import { api } from "../lib/api";

/** Atur ulang password dari tautan email (?token=...). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terlaluPendek = password.length > 0 && password.length < 8;
  const tidakCocok = konfirmasi.length > 0 && password !== konfirmasi;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password !== konfirmasi) return;
    setError(null);
    setLoading(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal atur ulang password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-orange-600 hover:underline"
        >
          ← Kembali ke beranda
        </Link>
        <div className="mb-6 text-center">
          <div className="text-3xl">🔐</div>
          <h1 className="mt-2 text-2xl font-bold text-stone-800">Atur Ulang Password</h1>
        </div>

        {!token ? (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Tautan tidak valid — token tidak ada.
            </div>
            <Link to="/lupa-password" className={`${btnPrimary} block w-full text-center`}>
              Minta tautan baru
            </Link>
          </div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
              ✅ Password berhasil diatur ulang. Silakan masuk dengan password baru.
            </div>
            <Link to="/login" className={`${btnPrimary} block w-full text-center`}>
              Masuk
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-stone-700">
                Password baru
              </label>
              <InputPassword
                id="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                autoComplete="new-password"
              />
              {terlaluPendek && <p className="mt-1 text-xs text-red-600">Minimal 8 karakter.</p>}
            </div>
            <div>
              <label htmlFor="konfirmasi" className="mb-1 block text-sm font-medium text-stone-700">
                Ulangi password baru
              </label>
              <InputPassword
                id="konfirmasi"
                required
                value={konfirmasi}
                onChange={(e) => setKonfirmasi(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              {tidakCocok && <p className="mt-1 text-xs text-red-600">Password tidak sama.</p>}
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || terlaluPendek || tidakCocok}
              className={`${btnPrimary} w-full`}
            >
              {loading ? "Menyimpan…" : "Simpan Password Baru"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
