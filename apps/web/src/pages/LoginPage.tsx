import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { btnPrimary, inputClass, InputPassword } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";
import { jamPasir, sisaJeda, tulisJeda } from "../lib/jeda-verifikasi";
import { PESAN_KIRIM_ULANG } from "../lib/pesan-verifikasi";
import { NILAI_SESI_BERAKHIR, PARAM_SESI, PESAN_SESI_BERAKHIR } from "../lib/pesan-sesi";

export function LoginPage() {
  const { login, masukTamu, kirimUlangVerifikasi } = useAuth();
  const navigate = useNavigate();
  // Dilempar ke sini oleh `api()` karena 401? Katakan sebabnya (lib/pesan-sesi.ts).
  const [params] = useSearchParams();
  const sesiBerakhir = params.get(PARAM_SESI) === NILAI_SESI_BERAKHIR;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tamuLoading, setTamuLoading] = useState<null | "owner" | "kasir">(null);
  // Bila login gagal karena email belum diverifikasi → tawarkan kirim ulang.
  const [belumVerif, setBelumVerif] = useState(false);
  const [verifKirim, setVerifKirim] = useState<"idle" | "loading" | "sent">("idle");
  const [verifJeda, setVerifJeda] = useState(0);
  // Tenggatnya tersimpan per email, jadi hitung mundurnya benar walau
  // halamannya baru dimuat — bukan cuma selama tab ini hidup.
  useEffect(() => {
    setVerifJeda(sisaJeda(email));
    const t = setInterval(() => setVerifJeda(sisaJeda(email)), 1000);
    return () => clearInterval(t);
  }, [email]);
  const [verifDevKode, setVerifDevUrl] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBelumVerif(false);
    setVerifKirim("idle");
    setLoading(true);
    try {
      const auth = await login(email, password);
      navigate(auth.user.is_super_admin ? "/superadmin" : "/kasir", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal login";
      setError(msg);
      setBelumVerif(msg.toLowerCase().includes("belum diverifikasi"));
    } finally {
      setLoading(false);
    }
  }

  /*
   * HITUNG MUNDURNYA IKUT DI SINI, dan sebelumnya tidak.
   *
   * Tombol ini dulu tak membaca `retry_after_detik` sama sekali dan selalu
   * menampilkan "sudah dikirim" — termasuk pada detik-detik ketika server
   * memang sedang menahan kiriman itu (jarak 2 menit per akun). Layar sebelah
   * (`VerifikasiEmailPage`) sudah membayar aturan ini lengkap dengan
   * alasannya; pintu kedua ke keadaan yang sama dibiarkan terbuka. Rumahnya
   * kini satu: `lib/jeda-verifikasi.ts`.
   */
  async function kirimUlang() {
    if (sisaJeda(email) > 0) return;
    setVerifKirim("loading");
    try {
      const res = await kirimUlangVerifikasi(email);
      setVerifDevUrl(res.dev_verify_kode ?? null);
      setVerifJeda(tulisJeda(email, res.retry_after_detik));
      setVerifKirim("sent");
    } catch {
      setVerifKirim("idle");
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
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-orange-600 hover:underline"
        >
          ← Kembali ke beranda
        </Link>
        <div className="mb-6 text-center">
          <div className="mx-auto inline-block overflow-hidden rounded-2xl shadow-lg">
            <Logo className="block h-16 w-16" rounded={false} />
          </div>
          <h1 className="mt-3 text-2xl font-bold text-stone-800">Terakasir</h1>
          <p className="text-sm text-stone-500">Sistem kasir &amp; HPP untuk bisnis F&amp;B</p>
        </div>
        {sesiBerakhir && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⏰ {PESAN_SESI_BERAKHIR}
          </div>
        )}
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
            <InputPassword
              id="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {belumVerif && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {verifKirim === "sent" ? (
                <>
                  <div>{PESAN_KIRIM_ULANG}</div>
                  {verifDevKode && (
                    <div className="mt-1 font-mono text-base tracking-widest">{verifDevKode}</div>
                  )}
                  <Link
                    to={`/verifikasi-email?email=${encodeURIComponent(email)}`}
                    className="mt-1 block font-semibold underline"
                  >
                    Masukkan kodenya →
                  </Link>
                </>
              ) : (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={kirimUlang}
                    disabled={verifKirim === "loading" || !email || verifJeda > 0}
                    className="font-semibold underline disabled:opacity-60"
                  >
                    {verifKirim === "loading"
                      ? "Mengirim…"
                      : verifJeda > 0
                        ? `Kirim ulang kode verifikasi (${jamPasir(verifJeda)})`
                        : "Kirim ulang kode verifikasi"}
                  </button>
                  {/* Kodenya mungkin MASIH BERLAKU (60 menit) — orang yang
                      emailnya sudah masuk tak perlu memicu kiriman baru cuma
                      untuk sampai ke layar isiannya. */}
                  <Link
                    to={`/verifikasi-email?email=${encodeURIComponent(email)}`}
                    className="block underline"
                  >
                    Sudah punya kodenya? Masukkan di sini →
                  </Link>
                </div>
              )}
            </div>
          )}
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
