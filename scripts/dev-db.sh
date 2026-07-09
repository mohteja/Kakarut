#!/usr/bin/env bash
# Menjalankan cluster PostgreSQL 16 lokal untuk development/testing
# (tanpa Docker — pakai initdb/pg_ctl langsung).
# PostgreSQL menolak berjalan sebagai root, jadi saat dijalankan sebagai root
# skrip ini mendelegasikan ke user `postgres` (dibuat bila belum ada).
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATA_DIR="${PG_DATA_DIR:-/tmp/kakarut-pgdata}"
SOCK_DIR="${DATA_DIR}-sock"
PORT="${PG_PORT:-5433}"
DB_NAME="${PG_DB:-kakarut}"

run_pg() {
  if [ "$(id -u)" = "0" ]; then
    if ! id postgres >/dev/null 2>&1; then
      useradd -m -s /bin/bash postgres
    fi
    su postgres -c "$*"
  else
    bash -c "$*"
  fi
}

if [ ! -d "$DATA_DIR/base" ]; then
  mkdir -p "$DATA_DIR"; mkdir -p "$SOCK_DIR"; chmod 777 "$SOCK_DIR"
  if [ "$(id -u)" = "0" ]; then
    id postgres >/dev/null 2>&1 || useradd -m -s /bin/bash postgres
    chown -R postgres:postgres "$DATA_DIR"
  fi
  run_pg "'$PG_BIN/initdb' -D '$DATA_DIR' -U postgres --auth=trust" >/dev/null
fi
mkdir -p "$SOCK_DIR" 2>/dev/null || true

if ! run_pg "'$PG_BIN/pg_ctl' -D '$DATA_DIR' status" >/dev/null 2>&1; then
  run_pg "'$PG_BIN/pg_ctl' -D '$DATA_DIR' -o '-p $PORT -k $SOCK_DIR -c listen_addresses=127.0.0.1' -l '$DATA_DIR/pg.log' -w start"
fi

if ! run_pg "'$PG_BIN/psql' -h 127.0.0.1 -p $PORT -U postgres -lqt" | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  run_pg "'$PG_BIN/createdb' -h 127.0.0.1 -p $PORT -U postgres '$DB_NAME'"
fi

echo "PostgreSQL siap: postgres://postgres@127.0.0.1:$PORT/$DB_NAME"
