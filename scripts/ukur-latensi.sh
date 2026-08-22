#!/usr/bin/env bash
# UKUR LATENSI RUTE BACA PADA VOLUME YANG DIPILIH — dengan premis yang dibuktikan.
#
# Kenapa berkas ini ada, dan kenapa ia rewel soal premis:
#
# Vena "batas laju di luar email" menyimpulkan "laporan agregat ternyata murah
# (0,035 dtk atas 50.111 penjualan)". Kesimpulan itu SALAH, dan sebabnya bukan
# salah hitung: 50.111 baris yang kusuntikkan ternyata milik PERUSAHAAN LAIN,
# sementara tokennya milik perusahaan yang cuma punya 98 penjualan. Kuerinya tak
# pernah melihat satu pun baris suntikan itu. Angka yang terukur benar-benar
# terukur — ia cuma mengukur basis data yang hampir kosong.
#
# Diukur ulang dengan tenant yang BENAR:
#
#     GET /laporan            50 ribu → 0,212 dtk   500 ribu → 0,526 dtk
#     GET /laporan/menu-laris 50 ribu → 0,099 dtk   500 ribu → 0,604 dtk
#     10 laporan serentak     GET /menu 0,009 → 2,11 dtk, lalu pulih
#
# Maka skrip ini MENOLAK berjalan sebelum membuktikan bahwa data yang disuntikkan
# benar-benar terbaca API — lewat angka yang dipulangkan rutenya sendiri, bukan
# lewat `SELECT count(*)` di basis data.
#
# Pemakaian:
#   BASE=http://localhost:3000 bash scripts/ukur-latensi.sh
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
OWNER_EMAIL="${OWNER_EMAIL:-terahokiindonesia@gmail.com}"
OWNER_PASS="${OWNER_PASS:-Basooopa123!}"

login() { curl -sf -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r .token; }

TOKEN=$(login "$OWNER_EMAIL" "$OWNER_PASS")
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "gagal login"; exit 1; }

api() { curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/api$1"; }

DARI="${DARI:-2019-01-01}"
SAMPAI="${SAMPAI:-$(TZ=Asia/Jakarta date +%F)}"
Q="?dari=$DARI&sampai=$SAMPAI&branch_id=all"

# ── PREMIS: berapa baris yang BENAR-BENAR dilihat API? ────────────────────
# Diambil dari balasan rutenya sendiri. `SELECT count(*)` di basis data tak
# menjawab pertanyaan ini — itu justru cara kesimpulan yang salah itu lahir.
JUMLAH=$(api "/laporan/durasi-pesanan$Q" | jq -r '.jumlah // 0')
TRANSAKSI=$(api "/laporan$Q" | jq -r '.jumlah_transaksi // .transaksi // 0')
echo "PREMIS — yang benar-benar terbaca API pada rentang $DARI…$SAMPAI:"
echo "  baris pesanan selesai : $JUMLAH"
echo "  transaksi             : $TRANSAKSI"
if [ "${JUMLAH:-0}" -lt 1000 ] && [ "${TRANSAKSI:-0}" -lt 1000 ]; then
  echo
  echo "BERHENTI: API cuma melihat sedikit baris, jadi angka latensi di bawah"
  echo "tak akan menyatakan apa pun tentang volume."
  echo
  echo "Kalau kamu baru menyuntikkan data uji, periksa company_id-nya: klon dari"
  echo "baris sembarang bisa mendarat di perusahaan LAIN, dan kuerinya tak akan"
  echo "pernah melihatnya. Itu persis yang pernah terjadi."
  exit 2
fi

echo
echo "LATENSI RUTE BACA (3 tembakan, yang tercepat dilaporkan):"
: > /tmp/ukur-latensi.txt
for J in /laporan /laporan/menu-laris /laporan/durasi-pesanan /laporan/bep \
         /laporan/pembelian /penjualan /stok /menu /bahan /customer /pesanan; do
  BEST=999
  for _ in 1 2 3; do
    T=$(curl -sf -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" \
        --max-time 120 "$BASE/api$J$Q" || echo 999)
    BEST=$(python3 -c "print(min($BEST, $T))")
  done
  printf "  %-28s %7.3f dtk\n" "$J" "$BEST" | tee -a /tmp/ukur-latensi.txt
done

echo
echo "KONTENSI KOLAM (10 laporan serentak; \`db\` adalah pg.Pool bawaan = 10 koneksi):"
SENGGANG=$(curl -sf -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" "$BASE/api/menu")
for _ in $(seq 1 10); do
  curl -sf -o /dev/null -H "Authorization: Bearer $TOKEN" --max-time 120 "$BASE/api/laporan/menu-laris$Q" &
done
sleep 0.3
SIBUK=$(curl -sf -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" --max-time 120 "$BASE/api/menu")
wait
PULIH=$(curl -sf -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" "$BASE/api/menu")
printf "  GET /menu senggang : %7.3f dtk\n" "$SENGGANG"
printf "  GET /menu SIBUK    : %7.3f dtk\n" "$SIBUK"
printf "  GET /menu pulih    : %7.3f dtk\n" "$PULIH"
