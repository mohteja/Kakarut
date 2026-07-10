import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { SERVER_STATUS_EVENT } from "../lib/api";

/**
 * Overlay "server sedang diperbarui": muncul saat API tak terjangkau (mis.
 * container sedang di-redeploy), memberi pesan jelas ke user, lalu otomatis
 * pulih — mem-polling /api/health dan menutup diri begitu server sehat lagi.
 */
export function ServerStatusOverlay() {
  const queryClient = useQueryClient();
  const [down, setDown] = useState(false);

  // dengarkan sinyal dari api client
  useEffect(() => {
    function onStatus(e: Event) {
      const detail = (e as CustomEvent<{ down: boolean }>).detail;
      setDown((prev) => {
        if (prev && !detail.down) queryClient.invalidateQueries(); // baru pulih
        return detail.down;
      });
    }
    window.addEventListener(SERVER_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(SERVER_STATUS_EVENT, onStatus);
  }, [queryClient]);

  // saat down, coba sambung ulang tiap 3 detik
  useEffect(() => {
    if (!down) return;
    let stopped = false;
    const id = window.setInterval(async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok && !stopped) {
          setDown(false);
          queryClient.invalidateQueries();
        }
      } catch {
        /* masih terputus */
      }
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [down, queryClient]);

  if (!down) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-3 bg-stone-900/85 p-6 text-center text-white backdrop-blur-sm">
      <div className="text-5xl">⚙️</div>
      <div className="text-lg font-bold">Server sedang diperbarui</div>
      <p className="max-w-xs text-sm text-stone-300">
        Aplikasi sedang memasang versi terbaru atau koneksi terputus sesaat. Halaman akan otomatis
        pulih — mohon tunggu beberapa detik.
      </p>
      <div className="mt-1 flex items-center gap-2 text-sm text-stone-400">
        <span className="inline-block h-2 w-2 animate-ping rounded-full bg-orange-400" />
        Menyambung kembali…
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500"
      >
        Muat ulang sekarang
      </button>
    </div>
  );
}
