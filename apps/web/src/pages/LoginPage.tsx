import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { btnPrimary, inputClass } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const auth = await login(email, password);
      navigate(auth.user.is_super_admin ? "/superadmin" : "/kasir", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto inline-block overflow-hidden rounded-2xl shadow-lg">
            <Logo className="block h-16 w-16" rounded={false} />
          </div>
          <h1 className="mt-3 text-2xl font-bold text-stone-800">Kakarut POS</h1>
          <p className="text-sm text-stone-500">Sistem kasir &amp; HPP untuk bisnis F&amp;B</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
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
              placeholder="anda@perusahaan.com"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={loading} className={`${btnPrimary} w-full`}>
            {loading ? "Masuk…" : "Masuk"}
          </button>
          <div className="text-center">
            <Link to="/lupa-password" className="text-sm text-stone-500 hover:text-orange-600 hover:underline">
              Lupa password?
            </Link>
          </div>
        </form>
        <p className="mt-4 text-center text-sm text-stone-500">
          Belum punya akun?{" "}
          <Link to="/daftar" className="font-semibold text-orange-600 hover:underline">
            Daftar
          </Link>
        </p>
      </div>
    </div>
  );
}
