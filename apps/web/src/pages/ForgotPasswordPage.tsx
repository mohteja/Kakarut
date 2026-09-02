import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { btnPrimary, inputClass } from "../components/ui";
import { api } from "../lib/api";
import { PESAN_LUPA } from "../lib/pesan-verifikasi";

/**
 * Lupa password: minta email → server kirim tautan reset (bila terdaftar).
 * Respons selalu sukses (tak membocorkan apakah email ada). Saat email server
 * belum dikonfigurasi (dev), tautan reset dikembalikan langsung untuk diklik.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ ok: boolean; dev_reset_url?: string }>("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setSent(true);
      setDevUrl(res.dev_reset_url ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim");
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
          <div className="text-3xl">🔑</div>
          <h1 className="mt-2 text-2xl font-bold text-stone-800">Lupa Password</h1>
          <p className="text-sm text-stone-500">Kirim tautan atur ulang ke email Anda</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
              📧 <b>{email}</b> — {PESAN_LUPA}
            </div>
            {devUrl && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <div className="mb-1 font-semibold">Mode dev (email belum dikonfigurasi):</div>
                <a href={devUrl} className="break-all font-mono text-amber-700 underline">
                  {devUrl}
                </a>
              </div>
            )}
            <Link to="/login" className={`${btnPrimary} block w-full text-center`}>
              Kembali ke Masuk
            </Link>
          </div>
        ) : (
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
                placeholder="anda@email.com"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <button type="submit" disabled={loading} className={`${btnPrimary} w-full`}>
              {loading ? "Mengirim…" : "Kirim Tautan Reset"}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-stone-500">
          <Link to="/login" className="font-semibold text-orange-600 hover:underline">
            ← Kembali ke Masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
