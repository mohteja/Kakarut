import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { btnPrimary, inputClass } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { login, masukTamu } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tamuLoading, setTamuLoading] = useState<null | "owner" | "kasir">(null);

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

  async function cobaTamu(peran: "owner" | "kasir") {
    setError(null);
    setTamuLoading(peran);
    try {
      await masukTamu(peran);
      navigate(peran === "owner" ? "/dashboard" : "/kasir", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk sebagai tamu");
    } finally {
      setTamuLoading(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto inline-block overflow-hidden rounded-2xl shadow-lg">
            <Logo className="block h-16 w-16" rounded={false} />
          </div>
          <h1 className="mt-3 text-2xl font-bold text-stone-800">Terakasir</h1>
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

        {/* Mode Tamu — akun bersama untuk mencoba tanpa daftar (absen bebas) */}
        <div className="mt-6">
          <div className="flex items-center gap-3 text-xs text-stone-400">
            <span className="h-px flex-1 bg-stone-200" />
            atau coba tanpa daftar
            <span className="h-px flex-1 bg-stone-200" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cobaTamu("owner")}
              disabled={tamuLoading !== null}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              {tamuLoading === "owner" ? "Masuk…" : "👔 Tamu Owner"}
            </button>
            <button
              type="button"
              onClick={() => cobaTamu("kasir")}
              disabled={tamuLoading !== null}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              {tamuLoading === "kasir" ? "Masuk…" : "🧾 Tamu Kasir"}
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-stone-400">Data contoh bersama · absen tanpa lokasi</p>
        </div>

        <p className="mt-4 text-center text-sm text-stone-500">
          Belum punya akun?{" "}
          <Link to="/daftar" className="font-semibold text-orange-600 hover:underline">
            Daftar
          </Link>
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-x-3 gap-y-1 border-t border-stone-100 pt-4 text-xs text-stone-400">
          <Link to="/bantuan" className="hover:text-orange-600 hover:underline">Bantuan</Link>
          <span>·</span>
          <Link to="/kontak" className="hover:text-orange-600 hover:underline">Kontak</Link>
          <span>·</span>
          <Link to="/privasi" className="hover:text-orange-600 hover:underline">Kebijakan Privasi</Link>
          <span>·</span>
          <Link to="/syarat" className="hover:text-orange-600 hover:underline">Syarat &amp; Ketentuan</Link>
        </div>
      </div>
    </div>
  );
}
