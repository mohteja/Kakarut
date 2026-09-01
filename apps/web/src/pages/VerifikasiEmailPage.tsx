import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { btnPrimary, inputClass } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";
import { bacaLokal } from "../lib/simpanan";
import { jamPasir, sisaJeda, tulisJeda } from "../lib/jeda-verifikasi";

/**
 * Verifikasi email dengan KODE 6 DIGIT yang diketik di layar ini.
 *
 * KENAPA BUKAN TAUTAN LAGI. Bentuk sebelumnya — buka `?token=<64 hex>`, halaman
 * memverifikasi sendiri saat dimuat — gagal dengan tiga cara yang semuanya
 * berakhir di layar merah "tautan tidak valid atau sudah kedaluwarsa" padahal
 * umurnya masih 24 jam:
 *
 * 1. **Sekali pakai.** Muat ulang halamannya, atau tekan Kembali sesudah
 *    pengalihan otomatis, dan percobaan KEDUA yang gagal — bukan yang pertama.
 *    Yang terlihat pemakai: "baru saja daftar, sudah kedaluwarsa".
 * 2. **Pemindai tautan** milik penyedia email/antivirus membuka tautannya
 *    lebih dulu, jadi kodenya sudah terpakai sebelum orangnya sempat menekan.
 * 3. **Peramban yang berbeda.** Daftar di laptop, tautannya terbuka di ponsel —
 *    dan karena verifikasi yang berhasil langsung memberi sesi, sesinya
 *    mendarat di perangkat yang salah.
 *
 * Kode diketik di tab yang sedang terbuka, jadi ketiganya hilang sekaligus.
 *
 * DAN TOMBOL "KIRIM ULANG" ADA DI LAYAR INI, bukan cuma di halaman Masuk. Itu
 * bagian yang paling sering hilang: pesan gagalnya SENGAJA netral (server tak
 * boleh membedakan "kode salah" dari "email tak terdaftar" — lihat catatan di
 * `POST /auth/verify-email`), jadi ia tak bisa mendiagnosis apa pun. Yang
 * menggantikan diagnosis itu jalan keluar yang selalu terlihat.
 */
export function VerifikasiEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { verifikasiEmail, verifikasiEmailTautan, kirimUlangVerifikasi } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [kode, setKode] = useState("");
  const [status, setStatus] = useState<"isi" | "proses" | "sukses">(token ? "proses" : "isi");
  const [error, setError] = useState<string | null>(null);
  const [kirimUlang, setKirimUlang] = useState<"diam" | "loading" | "terkirim">("diam");
  const [jeda, setJeda] = useState(() => sisaJeda(params.get("email") ?? ""));
  const sudahJalan = useRef(false);

  function sukses() {
    setStatus("sukses");
    // Sudah punya sesi → App merutekan "/" ke onboarding / dashboard.
    setTimeout(() => navigate("/", { replace: true }), 900);
  }

  /*
   * TRANSISI: tautan lama yang sudah telanjur ada di kotak masuk orang tetap
   * bekerja. Dicoba sekali saja (`sudahJalan`) — di React StrictMode efek ini
   * berjalan dua kali, dan percobaan kedua atas token sekali pakai akan
   * menampilkan kegagalan atas verifikasi yang SEBENARNYA berhasil.
   */
  useEffect(() => {
    if (!token || sudahJalan.current) return;
    sudahJalan.current = true;
    verifikasiEmailTautan(token)
      .then(sukses)
      .catch(() => {
        // Tautannya mati — TAPI jalur kode masih terbuka, jadi layarnya jatuh
        // ke formulir, bukan ke jalan buntu seperti versi sebelumnya.
        setStatus("isi");
        setError("Tautan ini sudah tidak berlaku. Masukkan kode 6 angka dari email Anda.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /*
   * Hitung mundurnya dibaca ULANG dari tenggat tersimpan, bukan dikurangi satu
   * per detik dari angka di memori. Tab yang tertidur (ponsel yang dikunci)
   * membuat `setTimeout` melambat; menghitung dari jam membuat sisa waktunya
   * tetap benar berapa pun timernya meleset.
   */
  useEffect(() => {
    if (jeda <= 0) return;
    const t = setTimeout(() => setJeda(sisaJeda(email)), 1000);
    return () => clearTimeout(t);
  }, [jeda, email]);

  // Ganti email → jedanya ikut ganti: yang ditahan server adalah AKUNNYA.
  useEffect(() => {
    setJeda(sisaJeda(email));
  }, [email]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (kode.length !== 6 || !email) return;
    setError(null);
    setStatus("proses");
    try {
      await verifikasiEmail(email, kode);
      sukses();
    } catch (err) {
      setStatus("isi");
      setError(err instanceof Error ? err.message : "Verifikasi gagal");
    }
  }

  async function onKirimUlang() {
    if (!email || jeda > 0) return;
    setKirimUlang("loading");
    setError(null);
    try {
      const res = await kirimUlangVerifikasi(email);
      setKirimUlang("terkirim");
      setJeda(tulisJeda(email, res.retry_after_detik));
    } catch (err) {
      setKirimUlang("diam");
      setError(err instanceof Error ? err.message : "Gagal mengirim kode");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
        <Logo className="mx-auto h-16 w-16 shadow-lg" />
        <h1 className="mt-3 text-2xl font-bold text-stone-800">Verifikasi Email</h1>

        {status === "sukses" ? (
          <div className="mt-6 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
            ✅ Email berhasil diverifikasi. Mengalihkan…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4 text-left">
            <p className="text-sm text-stone-500">
              Masukkan kode 6 angka yang kami kirim ke email Anda.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Kode 6 angka</label>
              <input
                // `inputMode="numeric"` memunculkan papan angka di ponsel, dan
                // `one-time-code` membuat iOS/Android menawarkan kodenya
                // langsung dari notifikasi email — dua hal yang menghapus
                // separuh kesalahan ketik sebelum terjadi.
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={kode}
                // Angka saja: menempel kode dari email sering ikut membawa
                // spasi atau baris baru, dan menolaknya diam-diam di server
                // akan terbaca sebagai "kode saya salah".
                onChange={(e) => setKode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            {kirimUlang === "terkirim" && !error && (
              <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                Kode baru sudah dikirim (bila email valid). Cek email Anda.
              </div>
            )}

            <button
              type="submit"
              disabled={status === "proses" || kode.length !== 6}
              className={`${btnPrimary} w-full disabled:opacity-50`}
            >
              {status === "proses" ? "Memverifikasi…" : "Verifikasi"}
            </button>

            <button
              type="button"
              onClick={onKirimUlang}
              disabled={kirimUlang === "loading" || jeda > 0 || !email}
              className="w-full text-sm font-medium text-orange-600 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline"
            >
              {kirimUlang === "loading"
                ? "Mengirim…"
                : jeda > 0
                  ? `Kirim ulang kode (${jamPasir(jeda)})`
                  : "Kirim ulang kode"}
            </button>

            <Link
              to="/login"
              className="block text-center text-sm text-stone-500 hover:text-orange-600 hover:underline"
            >
              Ke halaman Masuk
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
