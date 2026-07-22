import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { btnPrimary, inputClass } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

/**
 * Daftar akun sendiri (self sign-up). Membuat akun tanpa perusahaan; setelah
 * daftar user diarahkan ke onboarding (buat perusahaan / terima undangan).
 * Bila email sudah diundang, otomatis bergabung.
 */
export function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const terlaluPendek = password.length > 0 && password.length < 8;
  const tidakCocok = konfirmasi.length > 0 && password !== konfirmasi;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password !== konfirmasi) return;
    setError(null);
    setLoading(true);
    try {
      await register(nama, email, password);
      // Company-less → App mengarahkan ke /onboarding; bila auto-join undangan,
      // "/" akan diarahkan ke beranda perusahaan.
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mendaftar");
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
          <Logo className="mx-auto h-16 w-16 shadow-lg" />
          <h1 className="mt-3 text-2xl font-bold text-stone-800">Daftar Akun</h1>
          <p className="text-sm text-stone-500">Buat akun untuk mulai memakai Terakasir</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="nama" className="mb-1 block text-sm font-medium text-stone-700">
              Nama
            </label>
            <input
              id="nama"
              type="text"
              required
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              className={inputClass}
              placeholder="Nama lengkap"
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-stone-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="anda@email.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-stone-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="Minimal 8 karakter"
              autoComplete="new-password"
            />
            {terlaluPendek && <p className="mt-1 text-xs text-red-600">Minimal 8 karakter.</p>}
          </div>
          <div>
            <label htmlFor="konfirmasi" className="mb-1 block text-sm font-medium text-stone-700">
              Ulangi password
            </label>
            <input
              id="konfirmasi"
              type="password"
              required
              value={konfirmasi}
              onChange={(e) => setKonfirmasi(e.target.value)}
              className={inputClass}
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
            {loading ? "Mendaftar…" : "Daftar"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-500">
          Sudah punya akun?{" "}
          <Link to="/login" className="font-semibold text-orange-600 hover:underline">
            Masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
