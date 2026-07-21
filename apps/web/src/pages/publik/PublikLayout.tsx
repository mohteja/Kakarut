import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../components/Logo";
import { EMAIL_KONTAK, NAMA_APP, TAUTAN_PUBLIK } from "./info";

/**
 * Kerangka halaman publik (tanpa login): header dengan logo + navigasi, konten,
 * lalu footer berisi tautan legal/bantuan. Dipakai halaman Privasi, Syarat,
 * Kontak, dan Bantuan agar tampil konsisten dan mudah dijelajah reviewer toko.
 */
export function PublikLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-800">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/tentang" className="flex items-center gap-2">
            <Logo className="h-9 w-9" />
            <span className="text-lg font-bold text-stone-800">{NAMA_APP}</span>
          </Link>
          <nav className="hidden gap-4 text-sm text-stone-600 sm:flex">
            {TAUTAN_PUBLIK.filter((t) => t.ke !== "/tentang").map((t) => (
              <Link key={t.ke} to={t.ke} className="hover:text-stone-900">
                {t.label}
              </Link>
            ))}
          </nav>
          <Link
            to="/login"
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Masuk
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>

      <PublikFooter />
    </div>
  );
}

/** Footer bersama: navigasi + email kontak + hak cipta. */
export function PublikFooter() {
  const tahun = TANGGAL_TAHUN();
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 text-sm text-stone-500">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {TAUTAN_PUBLIK.map((t) => (
            <Link key={t.ke} to={t.ke} className="hover:text-stone-800">
              {t.label}
            </Link>
          ))}
        </div>
        <p className="mt-3">
          Kontak:{" "}
          <a href={`mailto:${EMAIL_KONTAK}`} className="font-medium text-orange-600 hover:underline">
            {EMAIL_KONTAK}
          </a>
        </p>
        <p className="mt-1">
          © {tahun} {NAMA_APP}. Seluruh hak cipta dilindungi.
        </p>
      </div>
    </footer>
  );
}

/** Tahun untuk hak cipta — pakai konstanta tanggal berlaku agar deterministik. */
function TANGGAL_TAHUN(): string {
  // Ambil dari TANGGAL_BERLAKU ("21 Juli 2026") — hindari new Date() agar stabil.
  return "2026";
}

/** Judul + subjudul standar untuk halaman legal/bantuan. */
export function PublikHeading({ judul, sub }: { judul: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-stone-900 sm:text-3xl">{judul}</h1>
      {sub && <p className="mt-1 text-sm text-stone-500">{sub}</p>}
    </div>
  );
}

/** Seksi legal: sub-judul + isi. */
export function Seksi({ nomor, judul, children }: { nomor?: number; judul: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-lg font-semibold text-stone-900">
        {nomor != null ? `${nomor}. ` : ""}
        {judul}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}
