#!/bin/sh
set -e

# Migrasi database dijalankan IN-PROCESS oleh server saat boot (AUTO_MIGRATE,
# default true) memakai advisory lock — aman multi-instance. Sengaja TIDAK
# dijalankan sebagai langkah terpisah di sini agar boot lebih cepat (satu cold
# start tsx, bukan dua) sehingga jendela 404 saat re-deploy lebih pendek.
#
# Untuk deploy PERTAMA (RUN_SEED=true) migrasi dijalankan lebih dulu di sini,
# karena seed butuh skema sudah ada; server tetap re-migrate (idempotent) saat
# start.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] RUN_SEED=true -> migrasi + seed (deploy pertama)..."
  npm run db:migrate
  npm run seed
else
  echo "[entrypoint] Migrasi ditangani server saat boot (AUTO_MIGRATE)."
fi

echo "[entrypoint] Memulai aplikasi..."
exec "$@"
