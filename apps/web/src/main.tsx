import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { BatasGalat } from "./components/BatasGalat";
import { ServerStatusOverlay } from "./components/ServerStatusOverlay";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { AuthProvider } from "./context/AuthContext";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});
// Data MASTER jarang berubah dan setiap mutasi sudah meng-invalidate kuncinya
// sendiri — tak perlu refetch tiap pindah halaman. staleTime panjang memangkas
// request beruntun saat navigasi (terasa di jaringan seluler); perubahan oleh
// perangkat lain paling lambat terlihat 5 menit (atau saat mutasi lokal).
const KUNCI_MASTER = [
  "bahan",
  "cabang",
  "satuan",
  "supplier",
  "kategori-bahan",
  "perlengkapan-master",
  "company",
];
for (const kunci of KUNCI_MASTER) {
  queryClient.setQueryDefaults([kunci], { staleTime: 5 * 60_000 });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Batas galat membungkus router SAJA — `ServerStatusOverlay` dan
            `UpdatePrompt` sengaja di luar, supaya keduanya tetap hidup justru
            saat isinya jatuh: satu memberi tahu servernya sedang tak terjangkau,
            satunya menawarkan pembaruan. Keduanya paling dibutuhkan tepat pada
            saat itu. */}
        <BatasGalat>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </BatasGalat>
        <ServerStatusOverlay />
        <UpdatePrompt />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
