import { useEffect, useState } from "react";
import { UPDATE_AVAILABLE_EVENT, periksaBuildServer } from "../lib/api";

/**
 * Notifikasi "ada pembaruan": muncul saat versi frontend baru sudah ter-deploy
 * (build server ≠ build yang dimuat tab ini). Deteksi utama lewat header build
 * pada tiap respons API (api.ts); halaman menganggur tanpa polling (mis. login)
 * dijaring cek /api/health berkala di sini.
 *
 * Muat ulang TIDAK dipaksa — kasir yang sedang transaksi bisa menunda ("Nanti")
 * ke pil kecil dan memperbarui saat luang; menekan Perbarui memuat ulang halaman
 * sehingga bundel terbaru terambil.
 */
export function UpdatePrompt() {
  const [ada, setAda] = useState(false);
  const [minimal, setMinimal] = useState(false);

  useEffect(() => {
    function onUpdate() {
      setAda(true);
      setMinimal(false);
    }
    window.addEventListener(UPDATE_AVAILABLE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_AVAILABLE_EVENT, onUpdate);
  }, []);

  // Jaring pengaman untuk tab menganggur: cek build server berkala.
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { build?: string | null };
          periksaBuildServer(d.build ?? null);
        }
      } catch {
        /* server tak terjangkau — ditangani ServerStatusOverlay */
      }
    }, 90_000);
    return () => window.clearInterval(id);
  }, []);

  if (!ada) return null;

  // Ditunda → pil kecil mengambang; diketuk untuk membuka lagi.
  if (minimal) {
    return (
      <button
        onClick={() => setMinimal(false)}
        className="fixed bottom-4 right-4 z-[1900] flex items-center gap-2 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-orange-500 print:hidden"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
        Pembaruan tersedia
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[1950] flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm print:hidden">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <div className="text-4xl">✨</div>
        <h2 className="mt-2 text-lg font-bold text-stone-800">Ada pembaruan aplikasi</h2>
        <p className="mt-1 text-sm text-stone-500">
          Versi terbaru Kakarut sudah tersedia. Perbarui untuk memakai perbaikan &amp; fitur
          terbaru. Selesaikan dulu transaksi yang sedang berjalan bila perlu.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-500"
          >
            🔄 Perbarui sekarang
          </button>
          <button
            onClick={() => setMinimal(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100"
          >
            Nanti
          </button>
        </div>
      </div>
    </div>
  );
}
