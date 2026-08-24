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
echo "LATENSI SELURUH RUTE BACA TANPA PARAMETER JALUR (2 tembakan, tercepat):"
#
# Versi pertama berkas ini mengukur SEBELAS jalur yang ditulis tangan di satu
# baris `for`, semuanya GET. Ledger menyebutnya "68 dari 469" — angka itu
# DIRALAT di sini: yang benar 11 dari 274 rute konkret, dan NOL jalur tulis.
#
# Daftarnya sekarang diambil dari TABEL RUTE HONO sendiri, jadi rute baca baru
# ikut terukur tanpa ada yang perlu ingat menambahkannya. Rute ber-`:param`
# tetap di luar (butuh id yang sah); latensinya terukur lewat jejak
# `JEJAK_RUTE` saat `verify-api.sh` berjalan.
: > /tmp/ukur-latensi.txt
DAFTAR=$(cd "$(dirname "$0")/../apps/server" && npx tsx -e '
import { createApp } from "./src/app";
const app = createApp();
const r = (app as unknown as { routes: { method: string; path: string }[] }).routes;
const s = new Set<string>();
for (const x of r) if (x.method === "GET" && !x.path.includes("*") && !x.path.includes(":")) s.add(x.path);
for (const p of [...s].sort()) console.log(p);
' 2>/dev/null)
JML=$(printf '%s\n' "$DAFTAR" | grep -c . || true)
if [ "${JML:-0}" -lt 40 ]; then
  echo "BERHENTI: tabel rute cuma memulangkan $JML jalur baca — pemindainya rusak,"
  echo "dan angka latensi di bawahnya tak akan menyatakan apa pun."
  exit 2
fi
echo "  (${JML} rute baca dari tabel rute Hono, bukan daftar tulisan tangan)"
for J in $DAFTAR; do
  BEST=999
  for _ in 1 2; do
    T=$(curl -sf -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" \
        --max-time 120 "$BASE$J$Q" || echo 999)
    BEST=$(python3 -c "print(min($BEST, $T))")
  done
  printf "%s\t%s\n" "$BEST" "$J" >> /tmp/ukur-latensi.txt
done
echo "  20 TERLAMBAT:"
sort -rn /tmp/ukur-latensi.txt | head -20 | awk -F'\t' '{printf "  %-34s %7.3f dtk\n", $2, $1}'

echo
echo "PINTU DETAIL BER-:param (id dipungut lewat API; 2 tembakan, tercepat):"
#
# Rute ber-:param tak bisa masuk daftar otomatis di atas (butuh id yang sah),
# dan justru di kelas inilah balasan 2,97 MB /customer/:id dulu ditemukan.
# Id-nya dipungut dari rute daftar masing-masing — bukan ditulis tangan —
# supaya blok ini tetap hidup di basis data mana pun.
#
# Angka acuan (30.000 baris PER ENTITAS, 2026-08-24): /customer/:id 0,024 dtk
# 39 KB · /bahan/:id/pembelian 0,077 dtk 56 KB (jumlah_pembelian tetap 30.018 —
# hitungan populasi dari SQL, bukan panjang larik terpotong) ·
# /stok/kartu/:id 0,039 dtk 54 KB (terpotong=true) · /perlengkapan/:id/kartu
# 0,018 dtk 111 KB. Langit-langit vena #15/#16 memegang di dimensi per-id.
CUSD=$(api "/customer" | jq -r '(.items // .)[0].id // ""')
INGD=$(api "/bahan" | jq -r '.[0].id // ""')
SUPD=$(api "/perlengkapan/master" | jq -r '.[0].id // ""')
MEND=$(api "/menu" | jq -r '.[0].id // ""')
BRD=$(api "/cabang" | jq -r '.[0].id // ""')
ukur_detail() { # <label> <path>
  local BEST=999 T BYTE
  for _ in 1 2; do
    T=$(curl -sf -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" --max-time 120 "$BASE$2" || echo 999)
    BEST=$(python3 -c "print(min($BEST, $T))")
  done
  BYTE=$(curl -sf -o /dev/null -w '%{size_download}' -H "Authorization: Bearer $TOKEN" --max-time 120 "$BASE$2" || echo 0)
  printf "  %-40s %7.3f dtk  %9s byte\n" "$1" "$BEST" "$BYTE"
}
if [ -n "$CUSD" ]; then ukur_detail "/customer/:id" "/api/customer/$CUSD"; else echo "  (customer dilewati: tak ada member)"; fi
if [ -n "$INGD" ]; then
  ukur_detail "/bahan/:id/pembelian" "/api/bahan/$INGD/pembelian"
  [ -n "$BRD" ] && ukur_detail "/stok/kartu/:ingredientId" "/api/stok/kartu/$INGD?branch_id=$BRD&dari=$DARI&sampai=$SAMPAI"
  # Pintu detail TERBERAT by design: membaca sampai BATAS_EVENT_FIFO+1 =
  # 20.001 baris lalu menghitung FIFO di JS per permintaan. Acuan (30.000
  # event tersuntik, terpotong:true, 2026-08-24): 0,056 dtk · 4,7 KB —
  # balasannya lot teragregasi, bukan barisan mentah, jadi beratnya di baca
  # 20 rb baris, bukan di serialisasi.
  [ -n "$BRD" ] && ukur_detail "/stok/fifo/:ingredientId" "/api/stok/fifo/$INGD?branch_id=$BRD"
else echo "  (bahan dilewati: tak ada bahan)"; fi
if [ -n "$SUPD" ]; then
  ukur_detail "/perlengkapan/:id/kartu" "/api/perlengkapan/$SUPD/kartu"
  ukur_detail "/perlengkapan/:id/pembelian" "/api/perlengkapan/$SUPD/pembelian"
else echo "  (perlengkapan dilewati)"; fi
[ -n "$MEND" ] && ukur_detail "/menu/:id/riwayat-harga" "/api/menu/$MEND/riwayat-harga"

echo
echo "KONTENSI KOLAM (\`db\` adalah pg.Pool bawaan = 10 koneksi)"
#
# Blok volume di atas mengukur SATU permintaan pada satu waktu. Kelas kerusakan
# yang justru pernah menggigit repo ini adalah KONKURENSI: GET /menu 0,009 →
# 20,07 dtk saat PUT /menu/urutan berjalan (vena #12). Blok ini mengukur empat
# keadaan itu, dan angka acuannya (200.101 transaksi, mesin CI 2026-08-24):
#
#   dasar: GET /menu 0,013 · POST /penjualan 0,018 dtk
#   10 laporan serentak → GET /menu 0,160 · POST /penjualan 0,165 (201)
#   10 penjualan serentak → GET /menu 0,015 · penjualan ke-11 0,085 (201)
#   5 PUT /menu/urutan serentak → GET /menu 0,018 dtk (kelas #12 tetap sembuh)
#   30 laporan (3× kolam) → p50 1,631 · maks 1,930 · GET /menu 0,675 dtk
#   50 penjualan serentak → p50 0,395 · p95 0,656 · maks 0,677 · 50× 201
#
# Bacaan atas angka itu, supaya pemakai berikutnya tak menebak: penurunan di
# bawah beban adalah ANTREAN KOLAM — linier terhadap kedalaman antrean, pulih
# sendiri, tanpa 5xx. /laporan sengaja TAK berbatas laju (vena "batas laju di
# luar email" mengukurnya murah); yang membatasinya kolam itu sendiri.
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

# ── Kontensi JALUR TULIS — butuh menu & token kasir; dilewati bila tak ada ──
KASIR_EMAIL="${KASIR_EMAIL:-kasir@basooopa.id}"
KASIR_PASS="${KASIR_PASS:-Kasir123!}"
KTOK=$(login "$KASIR_EMAIL" "$KASIR_PASS" 2>/dev/null || true)
MENU1=$(api "/menu" | jq -r '.[0].id // ""')
if [ -n "$KTOK" ] && [ "$KTOK" != "null" ] && [ -n "$MENU1" ]; then
  BODYK="{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$MENU1\",\"qty\":1}]}"
  UJI=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $KTOK" -H 'Content-Type: application/json' -d "$BODYK")
  if [ "$UJI" = "201" ]; then
    echo
    echo "  10 PENJUALAN serentak (tiap satu = transaksi menulis):"
    for _ in $(seq 1 10); do
      curl -s -o /dev/null -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $KTOK" -H 'Content-Type: application/json' -d "$BODYK" --max-time 120 &
    done
    sleep 0.1
    WBACA=$(curl -s -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $TOKEN" --max-time 120 "$BASE/api/menu")
    WTULIS=$(curl -s -o /dev/null -w '%{time_total}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $KTOK" -H 'Content-Type: application/json' -d "$BODYK" --max-time 120)
    wait
    printf "    GET /menu di tengahnya      : %7.3f dtk\n" "$WBACA"
    printf "    POST /penjualan ke-11       : %7.3f dtk\n" "$WTULIS"
  else
    echo "  (kontensi tulis dilewati: penjualan uji dibalas $UJI — mungkin stok/shift; bukan kegagalan pengukuran)"
  fi
else
  echo "  (kontensi tulis dilewati: tak ada token kasir/menu — set KASIR_EMAIL/KASIR_PASS)"
fi
