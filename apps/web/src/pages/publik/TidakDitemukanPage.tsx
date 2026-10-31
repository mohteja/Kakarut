import { PublikHeading, PublikLayout } from "./PublikLayout";

/**
 * Halaman "tidak ditemukan" — jalur yang bukan rute mana pun (mis. /abc).
 * Server menjawabnya dengan status 404 (`ruteWebDikenal`); dulu jalur seperti
 * itu dijawab 200 lalu dilempar ke /login, jadi mesin pencari mengindeks
 * halaman hantu dan pengunjung tak tahu tautannya salah (laporan uji 31 Okt 2026).
 */
export function TidakDitemukanPage() {
  return (
    <PublikLayout>
      <PublikHeading judul="Halaman tidak ditemukan" sub="Tautan ini salah atau sudah tidak ada" />
      <p className="text-sm leading-relaxed text-stone-700">
        Periksa lagi alamatnya, atau kembali ke halaman utama.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/"
          className="inline-block rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700"
        >
          Ke halaman utama
        </a>
        <a
          href="/bantuan"
          className="inline-block rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
        >
          Bantuan
        </a>
      </div>
    </PublikLayout>
  );
}
