import { useEffect, useState } from "react";
import { LOADED_BUILD, UPDATE_AVAILABLE_EVENT, periksaBuildServer } from "../lib/api";

/**
 * Build yang tab ini sudah pernah "dimuat ulang untuk diperbarui". Dipakai agar
 * dialog memblokir tak pernah tampil DUA KALI untuk build yang sama: kalau
 * setelah muat ulang build yang termuat tetap sama, mengulang dialog tidak
 * menolong siapa pun — cukup pil kecil. Pernah terjadi sungguhan: respons 304
 * pada endpoint daftar mengembalikan build id basi, jadi tab yang SUDAH
 * diperbarui terus dianggap ketinggalan.
 */
const KUNCI_MUAT_ULANG = "kakarut:muat-ulang-pembaruan";

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
      // Sudah pernah dimuat ulang untuk build INI tapi tetap dianggap tertinggal
      // → memuat ulang lagi tak akan menolong. Turunkan ke pil kecil supaya
      // kasir tidak terkurung dialog yang muncul terus.
      let sudah = false;
      try {
        sudah = sessionStorage.getItem(KUNCI_MUAT_ULANG) === LOADED_BUILD;
      } catch {
        /* sessionStorage diblokir (mode privat) — anggap belum pernah */
      }
      setMinimal(sudah);
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
          Versi terbaru Terakasir sudah tersedia. Perbarui untuk memakai perbaikan &amp; fitur
          terbaru. Selesaikan dulu transaksi yang sedang berjalan bila perlu.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={() => {
              // Catat build yang SEDANG dimuat sebelum memuat ulang. Kalau
              // setelah muat ulang build-nya masih sama dan tetap dianggap
              // tertinggal, dialog tak ditampilkan lagi — cukup pil kecil.
              try {
                if (LOADED_BUILD) sessionStorage.setItem(KUNCI_MUAT_ULANG, LOADED_BUILD);
              } catch {
                /* sessionStorage diblokir — muat ulang tetap dilakukan */
              }
              window.location.reload();
            }}
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
