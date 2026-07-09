#!/bin/sh
set -e

echo "[entrypoint] Menjalankan migrasi database..."
npm run db:migrate

# Seed hanya jika RUN_SEED=true (idempotent, aman diulang). Set sekali saat
# deploy pertama untuk membuat super-admin + tenant Basooopa, lalu matikan.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] RUN_SEED=true -> menjalankan seed..."
  npm run seed
else
  echo "[entrypoint] RUN_SEED tidak aktif -> lewati seed."
fi

echo "[entrypoint] Memulai aplikasi..."
exec "$@"
