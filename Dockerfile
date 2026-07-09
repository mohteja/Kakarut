# syntax=docker/dockerfile:1

# ---------- Stage 1: builder ----------
# Install SEMUA dependency (termasuk dev) lalu build SPA web (Vite -> apps/web/dist).
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Manifest dulu agar layer install ter-cache selama dependency tidak berubah.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

# Sisa source + build frontend.
COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
# Server dijalankan lewat tsx (lihat apps/server: "start": "tsx src/index.ts"),
# jadi runtime butuh node_modules (berisi tsx) + source TS, bukan hasil kompilasi.
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node_modules (dengan symlink workspace @kakarut/shared) dari builder.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
# Source server + migrasi drizzle (dibutuhkan saat runtime & migrate).
COPY --from=builder /app/apps/server ./apps/server
# Hasil build frontend; server menyajikannya dari ../../web/dist.
COPY --from=builder /app/apps/web/dist ./apps/web/dist

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 3000

# Entrypoint menjalankan migrasi (+ seed opsional) sebelum start.
ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "start"]
