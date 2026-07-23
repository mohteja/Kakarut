import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Pustaka inti (React, router, TanStack Query) dipisah ke chunk
            // "vendor" sendiri: isinya nyaris tak pernah berubah antar rilis
            // aplikasi, jadi hash-nya stabil dan browser memakai cache lama —
            // deploy baru hanya perlu unduh ulang chunk kode aplikasi.
            {
              name: "vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@tanstack)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/uploads": "http://localhost:3000",
    },
  },
});
