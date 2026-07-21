import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "../../components/Logo";
import { useAuth } from "../../context/AuthContext";
import { PublikFooter } from "./PublikLayout";
import { DESKRIPSI_SINGKAT, NAMA_APP } from "./info";

const FITUR = [
  { ikon: "🧾", judul: "Kasir cepat", teks: "Transaksi, struk, metode bayar & kembalian, meja, dan open bill — dirancang mobile-first." },
  { ikon: "📦", judul: "Stok & HPP akurat", teks: "Lacak bahan baku, resep/HPP, opname, dan tempat penyimpanan per cabang." },
  { ikon: "🏭", judul: "Produksi & pembelian", teks: "Central Kitchen, faktur produksi & beli bahan, penerimaan barang antar cabang." },
  { ikon: "🕒", judul: "Shift & absensi", teks: "Buka/tutup kasir, rekap shift, dan absen karyawan berbasis lokasi + foto." },
  { ikon: "📊", judul: "Laporan", teks: "Penjualan, menu terlaris, laba kotor, dan laporan belanja untuk pemilik." },
  { ikon: "📶", judul: "Mode offline", teks: "Transaksi tetap tercatat saat internet putus, lalu tersinkron otomatis." },
];

/**
 * Halaman utama publik Terakasir (tanpa login). Perkenalan produk untuk
 * pengunjung umum & reviewer App Store/Play Store, dengan tautan ke aplikasi
 * dan dokumen legal/bantuan.
 */
export function LandingPage() {
  const { masukTamu } = useAuth();
  const navigate = useNavigate();
  const [tamu, setTamu] = useState(false);

  async function cobaTamu() {
    setTamu(true);
    try {
      await masukTamu("owner");
      navigate("/dashboard", { replace: true });
    } catch {
      navigate("/login");
    } finally {
      setTamu(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-stone-800">
      {/* Header */}
      <header className="border-b border-stone-200">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo className="h-9 w-9" />
            <span className="text-lg font-bold">{NAMA_APP}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/bantuan" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 sm:block">
              Bantuan
            </Link>
            <Link to="/login" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">
              Masuk
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-green-50 to-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-14 text-center">
          <div className="mx-auto mb-5 inline-block overflow-hidden rounded-3xl shadow-lg">
            <Logo className="block h-20 w-20" rounded={false} />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-stone-900 sm:text-5xl">
            {NAMA_APP}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-stone-600 sm:text-lg">
            {DESKRIPSI_SINGKAT} Satu aplikasi untuk kasir, stok, produksi, absensi, dan laporan —
            cocok untuk usaha dengan satu atau banyak cabang.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/daftar" className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-orange-700">
              Coba Gratis
            </Link>
            <button
              type="button"
              onClick={cobaTamu}
              disabled={tamu}
              className="rounded-xl border border-stone-300 bg-white px-6 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              {tamu ? "Masuk…" : "🎫 Coba sebagai Tamu"}
            </button>
            <Link to="/login" className="rounded-xl px-6 py-3 text-sm font-semibold text-stone-500 hover:text-stone-800">
              Masuk ke Akun
            </Link>
          </div>
          {/* Badge toko — aplikasi mobile segera hadir */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5"> App Store — segera hadir</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5">▶ Google Play — segera hadir</span>
          </div>
        </div>
      </section>

      {/* Fitur */}
      <section className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 className="text-center text-2xl font-bold text-stone-900">Semua yang usaha F&amp;B butuhkan</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FITUR.map((f) => (
            <div key={f.judul} className="rounded-2xl border border-stone-200 bg-white p-5">
              <div className="text-2xl">{f.ikon}</div>
              <h3 className="mt-2 font-semibold text-stone-900">{f.judul}</h3>
              <p className="mt-1 text-sm text-stone-600">{f.teks}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA bawah */}
      <section className="bg-stone-900">
        <div className="mx-auto w-full max-w-5xl px-4 py-12 text-center">
          <h2 className="text-2xl font-bold text-white">Siap mulai?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-stone-300">
            Buat akun gratis dan atur usaha Anda dalam hitungan menit.
          </p>
          <Link to="/daftar" className="mt-6 inline-block rounded-xl bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-700">
            Daftar Sekarang
          </Link>
        </div>
      </section>

      <PublikFooter />
    </div>
  );
}
