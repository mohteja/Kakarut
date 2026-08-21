#!/usr/bin/env bash
# Verifikasi happy-path API end-to-end terhadap server yang sedang berjalan.
# Prasyarat: server jalan (default http://localhost:3000), database sudah
# di-migrate + seed. Butuh: curl, jq.
#
# PERHATIAN: skrip ini MEMBUAT transaksi penjualan/produksi sungguhan di
# database — jalankan hanya di database dev/test.
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
OWNER_EMAIL="${OWNER_EMAIL:-terahokiindonesia@gmail.com}"
OWNER_PASS="${OWNER_PASS:-Basooopa123!}"
KASIR_EMAIL="${KASIR_EMAIL:-kasir@basooopa.id}"
KASIR_PASS="${KASIR_PASS:-Kasir123!}"
SA_EMAIL="${SA_EMAIL:-superadmin@kakarut.id}"
SA_PASS="${SA_PASS:-SuperAdmin123!}"

PASS=0; FAIL=0
# Kegagalan dikumpulkan, bukan cuma dicetak di tempat kejadian: skrip ini
# menembak 2.100+ asersi dan log CI-nya ribuan baris. Satu ✘ di tengah praktis
# tak terlihat — yang membaca hanya tahu "gagal" tanpa tahu APA. Ringkasannya
# dicetak lagi di akhir, tepat sebelum baris Hasil, supaya `tail` beberapa
# puluh baris sudah cukup untuk mendiagnosis.
GAGAL_RINGKAS=()
ok()   { PASS=$((PASS+1)); echo "  ✔ $1"; }
gagal(){ FAIL=$((FAIL+1)); echo "  ✘ $1"; GAGAL_RINGKAS+=("$1"); }
cek()  { # cek "deskripsi" <ekspresi python bool dengan $V>
  local desc="$1" expr="$2" v="$3"
  if python3 -c "import sys; V=float(sys.argv[1]); sys.exit(0 if ($expr) else 1)" "$v"; then
    ok "$desc ($v)"
  else
    gagal "$desc — nilai: $v, harusnya: $expr"
  fi
}

login() { curl -sf -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r .token; }

# Daftar + verifikasi email (jalur dev) → echo token sesi. Register tak lagi
# auto-login: harus verifikasi email dulu. Hanya bekerja saat email BELUM
# dikonfigurasi (register mengembalikan dev_verify_url).
#
# KUOTA: `POST /auth/register` dibatasi 20 per IP per JAM (`batasRegister` di
# auth/routes.ts). Skrip ini memanggilnya sekitar 20 kali, jadi ia berjalan
# TEPAT DI TEPI kuota itu — menambah satu pendaftaran saja bisa membuat
# seksi-seksi terakhir gagal karena alasan yang sama sekali bukan kode.
#
# Tanpa penjaga di bawah, kegagalannya menyamar: 429 tak punya
# `dev_verify_url`, `vt` jadi kosong, fungsi ini `return 0` DIAM-DIAM, dan
# pemanggilnya menerima token kosong. Yang terlihat kemudian cuma asersi
# turunan yang aneh ("tiga akun baru siap membuat usaha — nilai: 0") beberapa
# ratus baris jauhnya. Itu pola yang sudah pernah menggigit repo ini (lihat
# PENJAGA RUTE MATI di bawah): galat yang ditelan lalu muncul sebagai
# kebingungan di tempat lain.
#
# Dicatat ke BERKAS, bukan lewat `gagal`, dan alasannya bukan gaya: setiap
# pemanggil memakainya sebagai `T=$(daftar_verif …)` — SUBKULIT. Di dalam
# subkulit, `FAIL` yang dinaikkan `gagal` hilang saat subkulitnya tutup, dan
# yang lebih buruk, baris "✘ …" yang dicetaknya ikut TERTANGKAP jadi isi `$T`.
# Penjaganya akan merusak token yang dijaganya sendiri lalu diam. Versi
# pertama penjaga ini persis begitu; yang menemukannya uji-diri di §215.
KUOTA_HABIS="${TMPDIR:-/tmp}/verify-api-kuota-habis.$$"
: > "$KUOTA_HABIS"
daftar_verif() { # <email> <password> <nama>
  local email="$1" pass="$2" nama="${3:-Uji}" reg vt
  reg=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"nama\":\"$nama\",\"email\":\"$email\",\"password\":\"$pass\"}")
  if printf '%s' "$reg" | grep -q 'Terlalu banyak pendaftaran'; then
    printf '%s\n' "$email" >> "$KUOTA_HABIS"
    echo "  ⚠ kuota pendaftaran habis: $email" >&2
    return 0
  fi
  vt=$(echo "$reg" | jq -r '.dev_verify_url // ""' | sed -n 's/.*token=//p')
  [ -z "$vt" ] && return 0
  curl -s -X POST "$BASE/api/auth/verify-email" -H 'Content-Type: application/json' \
    -d "{\"token\":\"$vt\"}" | jq -r '.token // ""'
}

# ── PENJAGA RUTE MATI ──────────────────────────────────────────────────────
#
# Panggilan ke endpoint yang TIDAK ADA dicatat ke BERKAS, lalu diadili di §209.
#
# KENAPA ADA. Skrip ini memanggil `POST /absensi/masuk` di lima tempat — rute
# yang tak pernah ada di server ini (yang ada `/absensi/` dan `/absensi/saya`).
# Tiap panggilannya ditulis `api … > /dev/null 2>&1 || true`, jadi galatnya
# ditelan tiga lapis sekaligus: stdout, stderr, dan status keluar. Lima blok
# "siapkan absen" itu sebetulnya tak menyiapkan apa pun; seksi-seksinya lulus
# hanya karena kasirnya kebetulan masih tercatat hadir dari §104, 2.700 baris
# di atasnya. Yang menemukannya bukan mata, melainkan tabel `error_logs`
# sesudah satu jalan penuh — jadi penjaganya dipasang di sini supaya jalan
# berikutnya tak perlu ditemukan lagi.
#
# KENAPA KE BERKAS, BUKAN KE LAYAR. Justru karena pemanggilnya menelan output.
# Berkas lolos dari ketiga lapis itu; `echo` tidak. Dan karena `api` sering
# dipanggil di dalam `$( )` — subkulit sendiri — menaikkan penghitung `FAIL`
# di sini pun tak akan sampai ke induknya.
#
# KENAPA DETEKSINYA TEPAT. `app.notFound` menjawab persis
# `{"error":"Tidak ditemukan"}`, dan badan itu tak dipakai handler lain mana
# pun (`grep '"Tidak ditemukan"' apps/server/src` → hanya index.ts). 404 yang
# SAH — "bahan tidak ditemukan", "kode karyawan … tidak ditemukan" — selalu
# membawa pesannya sendiri, jadi tak ada yang salah tuduh.
#
# BATASNYA, supaya tak dikira lebih: hanya rute yang benar-benar DITEMBAK yang
# ketahuan. Rute mati di cabang `if` yang tak pernah jalan tetap lolos.
RUTE_MATI="${TMPDIR:-/tmp}/verify-api-rute-mati.$$"
: > "$RUTE_MATI"
trap 'rm -f "$RUTE_MATI" "$KUOTA_HABIS"' EXIT

catat_rute_mati() { # catat_rute_mati <method> <path> <badan-respons>
  case "$3" in
    *'"error":"Tidak ditemukan"'*) printf '%s %s\n' "$1" "${2%%\?*}" >> "$RUTE_MATI" ;;
  esac
}

api() { # api <token> <method> <path> [json-body]
  local token="$1" method="$2" path="$3" body="${4:-}" out
  if [ -n "$body" ]; then
    out=$(curl -s -X "$method" "$BASE/api$path" -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -d "$body")
  else
    out=$(curl -s -X "$method" "$BASE/api$path" -H "Authorization: Bearer $token")
  fi
  catat_rute_mati "$method" "$path" "$out"
  printf '%s\n' "$out"
}

# `status_code*` membuang badan responsnya (`-o /dev/null`), jadi dulu ia buta
# terhadap rute mati. Badannya kini ditangkap dan diperiksa lebih dulu; yang
# dicetak tetap kode statusnya saja, persis seperti sebelumnya.
status_code() { # status_code <token> <method> <path>
  local out
  out=$(curl -s -w '\n%{http_code}' -X "$2" "$BASE/api$3" -H "Authorization: Bearer $1")
  catat_rute_mati "$2" "$3" "${out%$'\n'*}"
  printf '%s' "${out##*$'\n'}"
}

status_code_body() { # status_code_body <token> <method> <path> <json-body>
  local out
  out=$(curl -s -w '\n%{http_code}' -X "$2" "$BASE/api$3" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$4")
  catat_rute_mati "$2" "$3" "${out%$'\n'*}"
  printf '%s' "${out##*$'\n'}"
}

# pastikanHadir <token> [keterangan] — pastikan pemegang token TERCATAT HADIR
# di cabangnya, dari keadaan awal MANA PUN.
#
# Ini pengganti lima blok `POST /absensi/masuk` yang tak pernah ada rutenya.
#
# `POST /absensi/saya` itu TOGGLE, bukan "pastikan masuk": ia mencatat kebalikan
# dari cap terakhir. Memanggilnya pada orang yang sudah hadir justru MEMULANG-
# KANNYA, dan `/shift/buka` sesudahnya ditolak "Absen masuk dulu". Repo ini
# sudah pernah kena persis itu (lihat §188), jadi keadaannya DIBACA dulu.
#
# Yang dibaca `GET /absensi/status`, bukan `.tipe` dari toggle-nya: status itu
# memanggil `sedangHadir` — fungsi yang SAMA PERSIS dengan gerbang
# `POST /shift/buka`. Selama keduanya satu sumber, jawabannya tak bisa
# menyimpang. `.tipe` cuma mendekati; ia tak tahu soal sesi lintas tengah malam
# yang kedaluwarsa (`BATAS_LINTAS_HARI_JAM`).
#
# Tanpa argumen cabang, dan itu disengaja: `/absensi/status` dan `/shift/buka`
# sama-sama memakai cabang milik pemanggil untuk peran yang terikat cabang.
# Cabang yang dioper terpisah adalah cabang yang bisa salah — dan memang salah
# di kode lama, yang mengabsenkan `$OWNER` untuk shift milik kasir.
hadir_sekarang() { # hadir_sekarang <token> → "true" / "false"
  api "$1" GET /absensi/status | jq -r '.hadir // false'
}
pastikanHadir() { # pastikanHadir <token> [keterangan]
  local tok="$1" ket="${2:-}"
  if [ "$(hadir_sekarang "$tok")" = "true" ]; then return 0; fi
  api "$tok" POST /absensi/saya '{"foto_url":"https://example.com/pastikan-hadir.jpg"}' > /dev/null
  if [ "$(hadir_sekarang "$tok")" = "true" ]; then return 0; fi
  # Dilaporkan, bukan dilempar: skrip diteruskan supaya kegagalan seksi
  # berikutnya ikut terlihat — tapi SEBABNYA sudah tercatat di ringkasan.
  gagal "pastikanHadir gagal${ket:+ ($ket)} — /shift/buka sesudah ini pasti ditolak"
}

echo "== 1. Login =="
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASS");  [ -n "$OWNER" ] && ok "login owner"
KASIR=$(login "$KASIR_EMAIL" "$KASIR_PASS");  [ -n "$KASIR" ] && ok "login kasir"
SA=$(login "$SA_EMAIL" "$SA_PASS");           [ -n "$SA" ]    && ok "login super admin"

echo "== 2. Katalog menu (HPP live) =="
MENUS=$(api "$OWNER" GET /menu)
cek "jumlah menu = 57" "V == 57" "$(echo "$MENUS" | jq 'length')"
PBA=$(echo "$MENUS" | jq '[.[] | select(.nama | startswith("Premium Basooopa A"))][0]')
PBA_ID=$(echo "$PBA" | jq -r .id)
cek "HPP PBA ≈ 16993" "abs(V - 16993) <= 1" "$(echo "$PBA" | jq .hpp)"
cek "HPP dine-in PBA < HPP" "V == 1" "$(echo "$PBA" | jq '(.hpp_dine_in < .hpp) | if . then 1 else 0 end')"
cek "harga jual bulat PBA = 34000" "V == 34000" "$(echo "$PBA" | jq .harga_jual_bulat)"
PYO=$(echo "$MENUS" | jq '[.[] | select(.nama == "Paket Yamin Original")][0]')
PYO_ID=$(echo "$PYO" | jq -r .id)
cek "Paket Yamin Ori bulat = 11000" "V == 11000" "$(echo "$PYO" | jq .harga_jual_bulat)"
cek "Paket Yamin Misdasem bulat = 15000" "V == 15000" \
  "$(echo "$MENUS" | jq '[.[] | select(.nama == "Paket Yamin Misdasem")][0].harga_jual_bulat')"

stok_of() { echo "$1" | jq --arg s "$2" '[.[] | select(.slug == $s)][0].saldo'; }

echo "== 2b. Gerbang kasir: wajib absen + buka kasir sebelum transaksi =="
# Tanpa shift terbuka, transaksi kasir DITOLAK (409) → frontend munculkan modal Buka Kasir.
cek "penjualan tanpa shift terbuka → 409" "V == 409" \
  "$(status_code_body "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
# Penolakan penjualan membawa SEBAB terstruktur. Klien offline memutuskan nasib
# perintah di antreannya dari sini — mencocokkan teks pesan tak bisa diuji.
cek "…: sebab = kasir_belum_dibuka (transaksi TIDAK tercatat)" "V == 1" \
  "$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" | jq '(.sebab=="kasir_belum_dibuka")|if . then 1 else 0 end')"
# Buka kasir SEBELUM absen masuk → 400 (harus absen dulu).
cek "buka kasir tanpa absen → 400" "V == 400" \
  "$(status_code_body "$KASIR" POST /shift/buka '{"modal_awal":200000}')"
# Kasir absen masuk sendiri (cabang Pusat tanpa geofence → tanpa GPS).
ABSK=$(api "$KASIR" POST /absensi/saya '{"foto_url":"https://example.com/absen.jpg"}')
cek "kasir absen masuk (tipe=masuk)" "V == 1" "$(echo "$ABSK" | jq '(.tipe == "masuk") | if . then 1 else 0 end')"
# Setelah absen → buka kasir sukses (modal 200000) → transaksi berikutnya boleh.
SHK=$(api "$KASIR" POST /shift/buka '{"modal_awal":200000}')
cek "buka kasir setelah absen: modal 200000" "V == 200000" "$(echo "$SHK" | jq '.modal_awal')"

echo "== 3. Penjualan take-away memotong stok =="
S0=$(api "$KASIR" GET /stok)
URAT0=$(stok_of "$S0" "baso urat besar"); PLASTIK0=$(stok_of "$S0" "plastik take away"); COMP0=$(stok_of "$S0" "complement saos & sambal")
JUAL1=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
NOMOR1=$(echo "$JUAL1" | jq -r .sale.nomor)
[ "$NOMOR1" != "null" ] && ok "transaksi take-away dibuat ($NOMOR1)"
S1=$(api "$KASIR" GET /stok)
cek "baso urat besar −1" "abs(V - ($URAT0 - 1)) < 0.001" "$(stok_of "$S1" "baso urat besar")"
cek "plastik take away −1" "abs(V - ($PLASTIK0 - 1)) < 0.001" "$(stok_of "$S1" "plastik take away")"
cek "complement −1" "abs(V - ($COMP0 - 1)) < 0.001" "$(stok_of "$S1" "complement saos & sambal")"

echo "== 4. Penjualan dine-in TIDAK memotong kemasan, complement −0.5 =="
PLASTIK1=$(stok_of "$S1" "plastik take away"); COMP1=$(stok_of "$S1" "complement saos & sambal")
JUAL2=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":true,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
HPP_TA=$(echo "$JUAL1" | jq '.items[0].hppSatuan'); HPP_DI=$(echo "$JUAL2" | jq '.items[0].hppSatuan')
cek "hpp dine-in < hpp take-away" "V == 1" "$(python3 -c "print(1 if $HPP_DI < $HPP_TA else 0)")"
S2=$(api "$KASIR" GET /stok)
cek "plastik take away tetap" "abs(V - $PLASTIK1) < 0.001" "$(stok_of "$S2" "plastik take away")"
cek "complement −0.5" "abs(V - ($COMP1 - 0.5)) < 0.001" "$(stok_of "$S2" "complement saos & sambal")"

echo "== 5. Paket yamin mengonsumsi resep dasar + topping =="
MIE0=$(stok_of "$S2" "mie basah"); URATK0=$(stok_of "$S2" "baso urat kecil"); ACI0=$(stok_of "$S2" "baso aci original")
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PYO_ID\",\"qty\":1}]}" > /dev/null
S3=$(api "$KASIR" GET /stok)
cek "mie basah −1 (dari resep dasar)" "abs(V - ($MIE0 - 1)) < 0.001" "$(stok_of "$S3" "mie basah")"
cek "baso urat kecil −2 (topping)" "abs(V - ($URATK0 - 2)) < 0.001" "$(stok_of "$S3" "baso urat kecil")"
cek "baso aci original −2 (topping)" "abs(V - ($ACI0 - 2)) < 0.001" "$(stok_of "$S3" "baso aci original")"

echo "== 6. Produksi batch menambah stok sebesar isi =="
URATB_ID=$(echo "$S3" | jq -r '[.[] | select(.slug == "baso urat besar")][0].ingredient_id')
URATB_SALDO=$(stok_of "$S3" "baso urat besar")
api "$OWNER" POST /produksi "{\"ingredient_id\":\"$URATB_ID\",\"batch\":true}" > /dev/null
S4=$(api "$KASIR" GET /stok)
cek "saldo urat besar +90 (1 batch)" "abs(V - ($URATB_SALDO + 90)) < 0.001" "$(stok_of "$S4" "baso urat besar")"

echo "== 7. Laporan penjualan (rentang tanggal + filter cabang) =="
LAP=$(api "$OWNER" GET /laporan)
cek "omzet ≥ 79000 (2×PBA + paket)" "V >= 79000" "$(echo "$LAP" | jq .omzet)"
cek "profit = omzet − hpp" "V == 1" "$(echo "$LAP" | jq '(.estimasi_profit == (.omzet - .total_hpp)) | if . then 1 else 0 end')"
cek "ada item terjual" "V >= 2" "$(echo "$LAP" | jq '.item_terjual | length')"
# rentang tanggal: respons memuat dari & sampai; satu hari = sama dengan default
HARI7=$(TZ=Asia/Jakarta date +%F)
LAP_RANGE=$(api "$OWNER" GET "/laporan?dari=$HARI7&sampai=$HARI7")
cek "laporan memuat dari & sampai" "V == 1" \
  "$(echo "$LAP_RANGE" | jq '(((.dari|type)=="string") and ((.sampai|type)=="string")) | if . then 1 else 0 end')"
cek "rentang satu hari = omzet default" "V == 1" \
  "$(echo "$LAP_RANGE" | jq --argjson d "$(echo "$LAP" | jq .omzet)" '(.omzet == $d) | if . then 1 else 0 end')"
# back-compat ?tanggal= tetap jalan
cek "back-compat ?tanggal= (omzet = default)" "V == 1" \
  "$(api "$OWNER" GET "/laporan?tanggal=$HARI7" | jq --argjson d "$(echo "$LAP" | jq .omzet)" '(.omzet == $d) | if . then 1 else 0 end')"
# filter cabang: "Semua cabang" (agregasi) ≥ satu cabang
cek "branch_id=all: omzet ≥ satu cabang" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/laporan?branch_id=all&dari=$HARI7&sampai=$HARI7" | jq .omzet) >= $(echo "$LAP" | jq .omzet) else 0)")"

echo "== 8. RBAC & isolasi tenant =="
cek "kasir dilarang akses /karyawan (403)" "V == 403" "$(status_code "$KASIR" GET /karyawan)"
cek "owner dilarang akses /admin/tenants (403)" "V == 403" "$(status_code "$OWNER" GET /admin/tenants)"
cek "kasir dilarang PUT /bahan (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$URATB_ID" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"harga_beli":1}')"

TENANT2=$(api "$SA" POST /admin/tenants '{"nama":"Warung Uji","owner_nama":"Owner Uji","owner_email":"uji@example.com","owner_password":"UjiCoba123!","cabang_nama":"Pusat"}')
if echo "$TENANT2" | jq -e '.company.id' > /dev/null 2>&1; then
  ok "super admin membuat tenant kedua"
else
  echo "$TENANT2" | jq -e '.error | test("sudah")' > /dev/null 2>&1 && ok "tenant kedua sudah ada (re-run)" || gagal "buat tenant kedua: $TENANT2"
fi
UJI=$(login "uji@example.com" "UjiCoba123!")
cek "tenant baru punya 0 menu (isolasi)" "V == 0" "$(api "$UJI" GET /menu | jq 'length')"
cek "tenant baru punya 0 bahan (isolasi)" "V == 0" "$(api "$UJI" GET /bahan | jq 'length')"

# Meja bawaan: cabang tenant baru langsung punya Ruang Tunggu + Meja 1
UJI_MEJA=$(api "$UJI" GET /meja)
cek "tenant baru: 2 meja bawaan" "V == 2" "$(echo "$UJI_MEJA" | jq 'length')"
cek "tenant baru: ada Ruang Tunggu (takeaway) bawaan" "V == 1" \
  "$(echo "$UJI_MEJA" | jq '([.[] | select(.tipe=="takeaway" and .nama=="Ruang Tunggu")] | length == 1) | if . then 1 else 0 end')"
cek "tenant baru: ada Meja 1 (dine_in) bawaan" "V == 1" \
  "$(echo "$UJI_MEJA" | jq '([.[] | select(.tipe=="dine_in" and .nama=="Meja 1")] | length == 1) | if . then 1 else 0 end')"
# Mode Lite (bawaan tenant baru) membatasi 1 cabang → cabang kedua ditolak.
# Super admin menaikkan plan ke pro (murni set plan, tanpa provisioning) agar
# pengujian meja bawaan pada cabang kedua tetap berjalan.
cek "tenant baru: mode bawaan lite" "V == 1" \
  "$(api "$UJI" GET /company | jq '(.mode == "lite") | if . then 1 else 0 end')"
cek "mode Lite: cabang kedua → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $UJI" -H 'Content-Type: application/json' -d '{"nama":"Cabang Uji 2"}')"
T2_ID=$(api "$SA" GET /admin/tenants | jq -r '[.[] | select(.nama=="Warung Uji")][0].id')
api "$SA" PATCH "/admin/tenants/$T2_ID" '{"plan":"pro"}' > /dev/null
cek "super admin set plan pro → mode pro" "V == 1" \
  "$(api "$UJI" GET /company | jq '(.mode == "pro") | if . then 1 else 0 end')"

# Tambah cabang lewat POST /cabang juga menyeed meja bawaan (idempoten saat re-run)
NEWCAB=$(api "$UJI" POST /cabang '{"nama":"Cabang Uji 2"}')
NEWCAB_ID=$(echo "$NEWCAB" | jq -r '.id // empty')
[ -z "$NEWCAB_ID" ] && NEWCAB_ID=$(api "$UJI" GET /cabang | jq -r '[.[] | select(.nama=="Cabang Uji 2")][0].id')
cek "cabang baru (POST /cabang): 2 meja bawaan" "V == 2" \
  "$(api "$UJI" GET "/meja?branch_id=$NEWCAB_ID" | jq 'length')"

echo "== 9. Void transaksi: stok pulih & nomor struk tidak tabrakan =="
COMP_A=$(stok_of "$(api "$KASIR" GET /stok)" "complement saos & sambal")
VA=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
VA_ID=$(echo "$VA" | jq -r .sale.id)
VB=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
VB_NOMOR=$(echo "$VB" | jq -r .sale.nomor)
api "$OWNER" DELETE "/penjualan/$VA_ID" > /dev/null   # void (soft-delete) transaksi pertama
cek "stok complement pulih setelah void" "abs(V - ($COMP_A - 1)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "complement saos & sambal")"
VC=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
VC_NOMOR=$(echo "$VC" | jq -r .sale.nomor)
if [ "$VC_NOMOR" != "null" ] && [ "$VC_NOMOR" != "$VB_NOMOR" ]; then
  ok "transaksi baru setelah void sukses ($VC_NOMOR ≠ $VB_NOMOR)"
else
  gagal "nomor struk tabrakan/gagal setelah void: $VC_NOMOR"
fi

echo "== 10. Jalur pengadaan: produksi vs beli bahan baku =="
BAHAN=$(api "$KASIR" GET /bahan)
cek "baso urat besar berjenis produksi" "V == 1" \
  "$(echo "$BAHAN" | jq '[.[] | select(.slug == "baso urat besar")][0].pengadaan == "produksi" | if . then 1 else 0 end')"
PLASTIK_ID=$(echo "$BAHAN" | jq -r '[.[] | select(.slug == "plastik take away")][0].id')
cek "plastik take away berjenis beli" "V == 1" \
  "$(echo "$BAHAN" | jq '[.[] | select(.slug == "plastik take away")][0].pengadaan == "beli" | if . then 1 else 0 end')"
# jalur salah harus ditolak 400
cek "produksi bahan 'beli jadi' ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ingredient_id\":\"$PLASTIK_ID\",\"batch\":true}")"
cek "pembelian bahan 'produksi' ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ingredient_id\":\"$URATB_ID\",\"batch\":true}")"
# jalur benar menambah stok
PLASTIK_SALDO=$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")
BELI=$(api "$OWNER" POST /pembelian "{\"ingredient_id\":\"$PLASTIK_ID\",\"batch\":true}")
cek "pembelian 1 batch plastik +100" "abs(V - ($PLASTIK_SALDO + 100)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
cek "total_harga pembelian terisi (harga_beli)" "V == 15000" "$(echo "$BELI" | jq '.totalHarga // 0')"

echo "== 10b. Satuan bahan =="
cek "mie basah bersatuan pcs" "V == 1" \
  "$(echo "$BAHAN" | jq '[.[] | select(.slug == "mie basah")][0].satuan == "pcs" | if . then 1 else 0 end')"
cek "minyak bawang bersatuan ml" "V == 1" \
  "$(api "$KASIR" GET /bahan | jq '[.[] | select(.slug == "minyak bawang")][0].satuan == "ml" | if . then 1 else 0 end')"
cek "komponen menu memuat satuan" "V == 1" \
  "$(echo "$MENUS" | jq '[.[] | select(.nama | startswith("BMB Original"))][0].komponen[0] | has("satuan") | if . then 1 else 0 end')"

echo "== 11. Faktur penerimaan: supplier, tempat, konfirmasi baru menambah stok =="
SUP=$(api "$OWNER" POST /supplier '{"nama":"Toko Plastik Jaya"}')
SUP_ID=$(echo "$SUP" | jq -r '.id // empty')
if [ -z "$SUP_ID" ]; then SUP_ID=$(api "$OWNER" GET /supplier | jq -r '[.[] | select(.nama=="Toko Plastik Jaya")][0].id'); fi
[ -n "$SUP_ID" ] && ok "supplier dibuat/tersedia"
TMP=$(api "$OWNER" POST /penyimpanan '{"nama":"Rak Uji"}')
TMP_ID=$(echo "$TMP" | jq -r '.id // empty')
if [ -z "$TMP_ID" ]; then TMP_ID=$(api "$OWNER" GET /penyimpanan | jq -r '[.[] | select(.nama=="Rak Uji")][0].id'); fi
[ -n "$TMP_ID" ] && ok "tempat penyimpanan dibuat/tersedia"

SEDOTAN_ID=$(echo "$BAHAN" | jq -r '[.[] | select(.slug == "sedotan")][0].id')
PLASTIK_SEBELUM=$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")
SEDOTAN_SEBELUM=$(stok_of "$(api "$KASIR" GET /stok)" "sedotan")
FKT=$(api "$OWNER" POST /pembelian/faktur "{\"supplier_id\":\"$SUP_ID\",\"no_faktur\":\"INV-UJI-1\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"mode\":\"batch\",\"jumlah\":2,\"storage_location_id\":\"$TMP_ID\"},{\"ingredient_id\":\"$SEDOTAN_ID\",\"mode\":\"pcs\",\"jumlah\":50}]}")
FKT_ID=$(echo "$FKT" | jq -r .faktur_id)
cek "faktur 2 baris tersimpan (menunggu)" "V == 2" "$(echo "$FKT" | jq .jumlah_baris)"
cek "stok plastik BELUM berubah (menunggu konfirmasi)" "abs(V - $PLASTIK_SEBELUM) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
api "$OWNER" POST "/pembelian/tahap/$FKT_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKT_ID" '{"ke":"menunggu"}' > /dev/null
api "$OWNER" POST "/pembelian/konfirmasi/$FKT_ID" > /dev/null
cek "setelah konfirmasi: plastik +200 (2 batch)" "abs(V - ($PLASTIK_SEBELUM + 200)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
cek "setelah konfirmasi: sedotan +50 (pcs)" "abs(V - ($SEDOTAN_SEBELUM + 50)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "sedotan")"
cek "konfirmasi ulang ditolak (404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/konfirmasi/$FKT_ID" -H "Authorization: Bearer $OWNER")"
# faktur produksi: wajib karyawan + jalan lewat 4 tahap; mode batch = n × isi
URAT_SEBELUM=$(stok_of "$(api "$KASIR" GET /stok)" "baso urat besar")
WORKER_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.is_active)][0].user_id')
FKP=$(api "$OWNER" POST /produksi/faktur "{\"worker_id\":\"$WORKER_ID\",\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"batch\",\"jumlah\":1,\"storage_location_id\":\"$TMP_ID\"}]}")
FKP_ID=$(echo "$FKP" | jq -r .faktur_id)
api "$OWNER" POST "/produksi/tahap/$FKP_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/produksi/tahap/$FKP_ID" '{"ke":"menunggu"}' > /dev/null
api "$OWNER" POST "/produksi/konfirmasi/$FKP_ID" > /dev/null
cek "faktur produksi 1 batch urat = +90" "abs(V - ($URAT_SEBELUM + 90)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "baso urat besar")"
# item lintas jalur dalam faktur ditolak
cek "faktur pembelian berisi bahan produksi ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/faktur" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"pcs\",\"jumlah\":1}]}")"

echo "== 12. Lacak stok per bahan & tempat penyimpanan di stok =="
# baris stok memuat tempat penyimpanan terakhir (dari faktur §11 ke "Rak Uji")
cek "stok plastik memuat tempat 'Rak Uji'" "V == 1" \
  "$(api "$KASIR" GET /stok | jq '[.[] | select(.slug == "plastik take away")][0].tempat == "Rak Uji" | if . then 1 else 0 end')"

SUKRO_ID=$(echo "$BAHAN" | jq -r '[.[] | select(.slug == "sukro cikur")][0].id')
api "$OWNER" PUT "/bahan/$SUKRO_ID" '{"track_stok":false}' > /dev/null
cek "bahan tak dilacak hilang dari /stok" "V == 0" \
  "$(api "$KASIR" GET /stok | jq '[.[] | select(.slug == "sukro cikur")] | length')"
cek "faktur pembelian bahan tak dilacak ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/faktur" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$SUKRO_ID\",\"mode\":\"pcs\",\"jumlah\":5}]}")"
# penjualan menu ber-bahan tak dilacak: bahan lain tetap terpotong, sukro tidak
SS2_ID=$(echo "$MENUS" | jq -r '[.[] | select(.nama | startswith("Simple Set 2"))][0].id')
KONSUMSI_SEBELUM=$(api "$OWNER" GET /laporan | jq '[.konsumsi_bahan[] | select(.slug == "sukro cikur")] | length')
URATK_SEBELUM=$(stok_of "$(api "$KASIR" GET /stok)" "baso urat kecil")
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$SS2_ID\",\"qty\":1}]}" > /dev/null
cek "bahan terlacak tetap terpotong (urat kecil −2)" "abs(V - ($URATK_SEBELUM - 2)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "baso urat kecil")"
api "$OWNER" PUT "/bahan/$SUKRO_ID" '{"track_stok":true}' > /dev/null
cek "track_stok dikembalikan, sukro tampil lagi di /stok" "V == 1" \
  "$(api "$KASIR" GET /stok | jq '[.[] | select(.slug == "sukro cikur")] | length')"

echo "== 13. Kartu stok =="
FOTO="/uploads/companies/x/bukti/uji.jpg"
KARTU=$(api "$KASIR" GET "/stok/kartu/$PLASTIK_ID")
SALDO_STOK=$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")
cek "saldo akhir kartu == saldo di /stok" "abs(V - $SALDO_STOK) < 0.001" "$(echo "$KARTU" | jq .saldo_akhir)"
cek "kartu memuat mutasi pembelian" "V >= 1" "$(echo "$KARTU" | jq '[.mutasi[] | select(.jenis == "beli")] | length')"
cek "kartu memuat mutasi penjualan" "V >= 1" "$(echo "$KARTU" | jq '[.mutasi[] | select(.jenis == "penjualan")] | length')"
# opname hanya me-reset saldo SETELAH disetujui owner/admin
api "$OWNER" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":500}],\"catatan\":\"opname kartu\"}" > /dev/null
cek "opname menunggu: kartu BELUM reset ke 500" "abs(V - $SALDO_STOK) < 0.001" \
  "$(api "$KASIR" GET "/stok/kartu/$PLASTIK_ID" | jq .saldo_akhir)"
PID13=$(api "$OWNER" GET "/stok/penyesuaian?status=belum" | jq -r '[.[] | select(.bahan == "plastik take away")] | first | .id')
api "$OWNER" POST "/stok/penyesuaian/$PID13/klarifikasi" "{\"kategori\":\"koreksi_pencatatan\",\"foto_url\":\"$FOTO\"}" > /dev/null
api "$OWNER" POST "/stok/penyesuaian/$PID13/setujui" > /dev/null
KARTU2=$(api "$KASIR" GET "/stok/kartu/$PLASTIK_ID")
cek "setelah disetujui: baris opname me-reset saldo ke 500" "V == 500" \
  "$(echo "$KARTU2" | jq '[.mutasi[] | select(.jenis == "opname")] | last | .saldo')"
cek "saldo akhir kartu == 500 (opname disetujui)" "V == 500" "$(echo "$KARTU2" | jq .saldo_akhir)"

echo "== 14. Stock opname: kasir, snapshot sistem, selisih, riwayat =="
# saldo sistem plastik saat ini (500 setelah §13)
PLASTIK_SISTEM=$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")
FISIK=$(python3 -c "print($PLASTIK_SISTEM - 3)")   # sengaja kurang 3
OP=$(api "$KASIR" POST /stok/opname "{\"catatan\":\"opname uji\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$FISIK}]}")
SESI=$(echo "$OP" | jq -r .session_id)
[ "$SESI" != "null" ] && ok "kasir boleh opname, dapat session_id"
cek "ringkasan: 1 kurang" "V == 1" "$(echo "$OP" | jq .ringkasan.kurang)"
cek "ringkasan: total_selisih = -3" "abs(V - (-3)) < 0.001" "$(echo "$OP" | jq .ringkasan.total_selisih)"
# stok BELUM berubah — menunggu klarifikasi + persetujuan
cek "saldo /stok TIDAK berubah (menunggu persetujuan)" "abs(V - $PLASTIK_SISTEM) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
cek "riwayat opname memuat sesi baru" "V >= 1" \
  "$(api "$KASIR" GET /stok/opname/riwayat | jq --arg s "$SESI" '[.[] | select(.session_id == $s)] | length')"
DETAIL=$(api "$KASIR" GET "/stok/opname/sesi/$SESI")
cek "detail sesi: system_qty tersimpan" "abs(V - $PLASTIK_SISTEM) < 0.001" \
  "$(echo "$DETAIL" | jq '.items[0].system_qty')"
cek "detail sesi: selisih = -3" "abs(V - (-3)) < 0.001" "$(echo "$DETAIL" | jq '.items[0].selisih')"
api "$OWNER" PUT "/bahan/$SUKRO_ID" '{"track_stok":false}' > /dev/null
cek "opname bahan tak dilacak ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/opname" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$SUKRO_ID\",\"qty\":1}]}")"
api "$OWNER" PUT "/bahan/$SUKRO_ID" '{"track_stok":true}' > /dev/null

echo "== 15. Penyesuaian: klarifikasi (foto wajib) + persetujuan owner/admin =="
# opname §14 tadi membuat selisih -3 untuk plastik → menunggu klarifikasi
PENY=$(api "$KASIR" GET "/stok/penyesuaian?status=belum")
PENY_ID=$(echo "$PENY" | jq -r '[.[] | select(.bahan == "plastik take away")] | first | .id')
cek "selisih opname muncul di penyesuaian (belum)" "V == 1" \
  "$(echo "$PENY" | jq --arg id "$PENY_ID" '[.[] | select(.id == $id and .klarifikasi_status == "belum")] | length')"
cek "penyesuaian punya selisih ≠ 0" "V == 1" \
  "$(echo "$PENY" | jq --arg id "$PENY_ID" '[.[] | select(.id == $id and (.selisih | fabs) > 0)] | length')"
# setujui sebelum klarifikasi ditolak
cek "setujui sebelum klarifikasi ditolak (400)" "V == 400" \
  "$(status_code "$OWNER" POST "/stok/penyesuaian/$PENY_ID/setujui")"
cek "klarifikasi tanpa foto ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/penyesuaian/$PENY_ID/klarifikasi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"kategori":"waste_bahan","catatan":"x"}')"
cek "klarifikasi oleh KASIR ditolak (403 — hanya owner/admin)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/penyesuaian/$PENY_ID/klarifikasi" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"kategori\":\"waste_bahan\",\"foto_url\":\"$FOTO\"}")"
api "$OWNER" POST "/stok/penyesuaian/$PENY_ID/klarifikasi" "{\"kategori\":\"waste_bahan\",\"catatan\":\"tumpah\",\"foto_url\":\"$FOTO\"}" > /dev/null
DETAIL=$(api "$KASIR" GET "/stok/penyesuaian?status=semua")
cek "setelah klarifikasi: status sudah" "V == 1" \
  "$(echo "$DETAIL" | jq --arg id "$PENY_ID" '[.[] | select(.id == $id and .klarifikasi_status == "sudah" and .kategori == "waste_bahan")] | length')"
cek "bukti foto tersimpan" "V == 1" \
  "$(echo "$DETAIL" | jq --arg id "$PENY_ID" --arg f "$FOTO" '[.[] | select(.id == $id and .foto_url == $f)] | length')"
cek "hilang dari daftar 'belum'" "V == 0" \
  "$(api "$KASIR" GET "/stok/penyesuaian?status=belum" | jq --arg id "$PENY_ID" '[.[] | select(.id == $id)] | length')"
cek "muncul di 'menunggu_persetujuan'" "V == 1" \
  "$(api "$KASIR" GET "/stok/penyesuaian?status=menunggu_persetujuan" | jq --arg id "$PENY_ID" '[.[] | select(.id == $id)] | length')"
# stok masih belum berubah (menunggu persetujuan)
cek "saldo /stok masih belum berubah (menunggu persetujuan)" "abs(V - $PLASTIK_SISTEM) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
# kasir tidak boleh menyetujui
cek "kasir setujui ditolak (403)" "V == 403" \
  "$(status_code "$KASIR" POST "/stok/penyesuaian/$PENY_ID/setujui")"
# owner menyetujui → stok disesuaikan ke fisik
api "$OWNER" POST "/stok/penyesuaian/$PENY_ID/setujui" > /dev/null
cek "setelah disetujui: saldo /stok jadi fisik" "abs(V - $FISIK) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
cek "setujui ulang ditolak (404, idempoten)" "V == 404" \
  "$(status_code "$OWNER" POST "/stok/penyesuaian/$PENY_ID/setujui")"
cek "kartu stok me-reset ke fisik setelah disetujui" "abs(V - $FISIK) < 0.001" \
  "$(api "$KASIR" GET "/stok/kartu/$PLASTIK_ID" | jq .saldo_akhir)"

echo "== 15b. Penyesuaian: alur tolak → klarifikasi ulang =="
FISIK2=$(python3 -c "print($FISIK - 2)")
api "$KASIR" POST /stok/opname "{\"catatan\":\"opname tolak\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$FISIK2}]}" > /dev/null
PID2=$(api "$KASIR" GET "/stok/penyesuaian?status=belum" | jq -r '[.[] | select(.bahan == "plastik take away")] | first | .id')
api "$OWNER" POST "/stok/penyesuaian/$PID2/klarifikasi" "{\"kategori\":\"waste_bahan\",\"foto_url\":\"$FOTO\"}" > /dev/null
api "$OWNER" POST "/stok/penyesuaian/$PID2/tolak" "{\"alasan\":\"bukti kurang jelas\"}" > /dev/null
DIT=$(api "$KASIR" GET "/stok/penyesuaian?status=belum")
cek "ditolak: kembali ke 'belum'" "V == 1" \
  "$(echo "$DIT" | jq --arg id "$PID2" '[.[] | select(.id == $id and .klarifikasi_status == "belum")] | length')"
cek "ditolak: alasan tersimpan" "V == 1" \
  "$(echo "$DIT" | jq --arg id "$PID2" '[.[] | select(.id == $id and .tolak_alasan == "bukti kurang jelas")] | length')"
cek "ditolak: stok belum berubah (masih fisik lama)" "abs(V - $FISIK) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
# klarifikasi ulang → setujui → stok jadi fisik2
api "$OWNER" POST "/stok/penyesuaian/$PID2/klarifikasi" "{\"kategori\":\"koreksi_pencatatan\",\"foto_url\":\"$FOTO\"}" > /dev/null
api "$OWNER" POST "/stok/penyesuaian/$PID2/setujui" > /dev/null
cek "klarifikasi ulang lalu disetujui: saldo jadi fisik2" "abs(V - $FISIK2) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"

echo "== 15c. Opname: ACC / Tolak / Hapus per sesi (owner/admin) =="
# stok plastik saat ini = FISIK2 (dari §15b)
SC_FISIK=$(python3 -c "print($FISIK2 + 7)")
SESI_ACC=$(api "$OWNER" POST /stok/opname "{\"catatan\":\"acc sesi\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$SC_FISIK}]}" | jq -r .session_id)
ST=$(api "$OWNER" GET /stok/opname/riwayat | jq -r --arg s "$SESI_ACC" '[.[]|select(.session_id==$s)][0].status')
[ "$ST" = "menunggu" ] && ok "sesi berselisih → status 'menunggu'" || gagal "status sesi = $ST (harus menunggu)"
cek "menunggu ACC: stok BELUM berubah (masih fisik2)" "abs(V - $FISIK2) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"
ST=$(api "$OWNER" GET "/stok/opname/sesi/$SESI_ACC" | jq -r '.status')
[ "$ST" = "menunggu" ] && ok "detail sesi memuat status 'menunggu'" || gagal "detail status = $ST"
cek "kasir ACC ditolak (403 — hanya owner/admin)" "V == 403" \
  "$(status_code "$KASIR" POST "/stok/opname/sesi/$SESI_ACC/acc")"
cek "owner ACC → jumlah baris di-ACC >= 1" "V >= 1" \
  "$(api "$OWNER" POST "/stok/opname/sesi/$SESI_ACC/acc" | jq '.jumlah')"
ST=$(api "$OWNER" GET /stok/opname/riwayat | jq -r --arg s "$SESI_ACC" '[.[]|select(.session_id==$s)][0].status')
[ "$ST" = "disetujui" ] && ok "setelah ACC: status 'disetujui'" || gagal "status sesi = $ST (harus disetujui)"
cek "setelah ACC: stok jadi fisik baru ($SC_FISIK)" "abs(V - $SC_FISIK) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"
cek "ACC ulang idempoten: jumlah 0" "V == 0" \
  "$(api "$OWNER" POST "/stok/opname/sesi/$SESI_ACC/acc" | jq '.jumlah')"
# --- Tolak ---
SC_FISIK2=$(python3 -c "print($SC_FISIK - 4)")
SESI_TOLAK=$(api "$OWNER" POST /stok/opname "{\"catatan\":\"tolak sesi\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$SC_FISIK2}]}" | jq -r .session_id)
cek "kasir tolak ditolak (403)" "V == 403" \
  "$(status_code "$KASIR" POST "/stok/opname/sesi/$SESI_TOLAK/tolak")"
cek "owner tolak → jumlah baris ditolak >= 1" "V >= 1" \
  "$(api "$OWNER" POST "/stok/opname/sesi/$SESI_TOLAK/tolak" "{\"alasan\":\"salah hitung\"}" | jq '.jumlah')"
ST=$(api "$OWNER" GET /stok/opname/riwayat | jq -r --arg s "$SESI_TOLAK" '[.[]|select(.session_id==$s)][0].status')
[ "$ST" = "ditolak" ] && ok "setelah tolak: status 'ditolak'" || gagal "status sesi = $ST (harus ditolak)"
cek "ditolak: stok tetap fisik ACC (tak berubah)" "abs(V - $SC_FISIK) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"
# --- Hapus ---
cek "kasir hapus sesi ditolak (403)" "V == 403" \
  "$(status_code "$KASIR" DELETE "/stok/opname/sesi/$SESI_TOLAK")"
cek "owner hapus sesi → jumlah baris terhapus >= 1" "V >= 1" \
  "$(api "$OWNER" DELETE "/stok/opname/sesi/$SESI_TOLAK" | jq '.jumlah')"
cek "sesi hilang dari riwayat setelah dihapus" "V == 0" \
  "$(api "$OWNER" GET /stok/opname/riwayat | jq --arg s "$SESI_TOLAK" '[.[]|select(.session_id==$s)]|length')"
cek "hapus sesi tak ada → 404" "V == 404" \
  "$(status_code "$OWNER" DELETE "/stok/opname/sesi/$SESI_TOLAK")"
# --- Hapus sesi yang SUDAH disetujui → saldo balik ke sebelum opname ---
api "$OWNER" DELETE "/stok/opname/sesi/$SESI_ACC" > /dev/null
cek "hapus sesi disetujui: saldo balik ke fisik2 (sebelum ACC)" "abs(V - $FISIK2) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"

echo "== 15d. Opname: ACC / Tolak PER PRODUK dalam satu sesi (owner) =="
# dua bahan tracked dalam satu sesi: plastik (selisih +5) & sukro (selisih +3)
PP0=$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")
SS0=$(stok_of "$(api "$OWNER" GET /stok)" "sukro cikur")
PP_FISIK=$(python3 -c "print($PP0 + 5)")
SS_FISIK=$(python3 -c "print($SS0 + 3)")
SESI_PP=$(api "$OWNER" POST /stok/opname "{\"catatan\":\"per-produk\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$PP_FISIK},{\"ingredient_id\":\"$SUKRO_ID\",\"qty\":$SS_FISIK}]}" | jq -r .session_id)
DPP=$(api "$OWNER" GET "/stok/opname/sesi/$SESI_PP")
# id baris dikenali dari nilai selisihnya (5 vs 3)
PP_ROW=$(echo "$DPP" | jq -r '[.items[]|select(.selisih == 5)][0].id')
SS_ROW=$(echo "$DPP" | jq -r '[.items[]|select(.selisih == 3)][0].id')
cek "detail per-produk: tiap baris punya id" "V == 2" \
  "$(echo "$DPP" | jq '[.items[]|select(.id != null)]|length')"
cek "detail per-produk: plastik & sukro sama-sama 'menunggu'" "V == 2" \
  "$(echo "$DPP" | jq '[.items[]|select(.penyesuaian_status=="menunggu")]|length')"
# kasir tak boleh ACC per-produk
cek "kasir ACC per-produk ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/opname/sesi/$SESI_PP/acc" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"ids\":[\"$PP_ROW\"]}")"
# ACC hanya baris plastik
cek "owner ACC plastik saja → jumlah 1" "V == 1" \
  "$(api "$OWNER" POST "/stok/opname/sesi/$SESI_PP/acc" "{\"ids\":[\"$PP_ROW\"]}" | jq '.jumlah')"
cek "ACC per-produk: saldo plastik jadi fisik (+5)" "abs(V - $PP_FISIK) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"
cek "ACC per-produk: saldo sukro BELUM berubah" "abs(V - $SS0) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "sukro cikur")"
DPP=$(api "$OWNER" GET "/stok/opname/sesi/$SESI_PP")
cek "detail: baris plastik jadi 'disetujui'" "V == 1" \
  "$(echo "$DPP" | jq --arg p "$PP_ROW" '[.items[]|select(.id==$p and .penyesuaian_status=="disetujui")]|length')"
cek "detail: baris sukro masih 'menunggu'" "V == 1" \
  "$(echo "$DPP" | jq --arg s "$SS_ROW" '[.items[]|select(.id==$s and .penyesuaian_status=="menunggu")]|length')"
ST=$(api "$OWNER" GET /stok/opname/riwayat | jq -r --arg s "$SESI_PP" '[.[]|select(.session_id==$s)][0].status')
[ "$ST" = "menunggu" ] && ok "status sesi tetap 'menunggu' (sukro belum diputus)" || gagal "status sesi = $ST (harus menunggu)"
# Tolak hanya baris sukro
cek "owner Tolak sukro saja → jumlah 1" "V == 1" \
  "$(api "$OWNER" POST "/stok/opname/sesi/$SESI_PP/tolak" "{\"ids\":[\"$SS_ROW\"],\"alasan\":\"stok fisik salah\"}" | jq '.jumlah')"
cek "Tolak per-produk: saldo sukro tetap (dibuang)" "abs(V - $SS0) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "sukro cikur")"
DPP=$(api "$OWNER" GET "/stok/opname/sesi/$SESI_PP")
cek "detail: baris sukro 'ditolak' + alasan tersimpan" "V == 1" \
  "$(echo "$DPP" | jq --arg s "$SS_ROW" '[.items[]|select(.id==$s and .penyesuaian_status=="ditolak" and .tolak_alasan=="stok fisik salah")]|length')"
ST=$(api "$OWNER" GET /stok/opname/riwayat | jq -r --arg s "$SESI_PP" '[.[]|select(.session_id==$s)][0].status')
[ "$ST" = "disetujui" ] && ok "status sesi jadi 'disetujui' (sebagian di-ACC, sisa ditolak)" || gagal "status sesi = $ST (harus disetujui)"
# Flip: ACC ulang baris sukro yang tadi ditolak (status-agnostic)
cek "owner ACC ulang sukro (balik dari ditolak) → jumlah 1" "V == 1" \
  "$(api "$OWNER" POST "/stok/opname/sesi/$SESI_PP/acc" "{\"ids\":[\"$SS_ROW\"]}" | jq '.jumlah')"
cek "flip: saldo sukro jadi fisik (+3)" "abs(V - $SS_FISIK) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "sukro cikur")"
# Bersihkan: hapus sesi → saldo kembali seperti semula
api "$OWNER" DELETE "/stok/opname/sesi/$SESI_PP" > /dev/null
cek "hapus sesi per-produk: saldo plastik balik" "abs(V - $PP0) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"
cek "hapus sesi per-produk: saldo sukro balik" "abs(V - $SS0) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "sukro cikur")"

echo "== 16. Petugas opname per tempat penyimpanan =="
RAK_ID=$(api "$OWNER" GET "/penyimpanan" | jq -r '[.[] | select(.nama == "Rak Uji")][0].id')
KASIR_UID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role == "cashier")][0].user_id')
OWNER_UID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role == "owner")][0].user_id')
# Rak Uji awalnya terbuka (tanpa petugas) → kasir boleh opname plastik (tempat Rak Uji)
SID=$(api "$KASIR" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":480}]}" | jq -r .session_id)
{ [ "$SID" != "null" ] && [ -n "$SID" ]; } && ok "tempat terbuka: kasir boleh opname plastik" \
  || gagal "kasir seharusnya boleh saat tempat terbuka"
# kunci Rak Uji ke owner saja
api "$OWNER" PUT "/penyimpanan/$RAK_ID/petugas" "{\"user_ids\":[\"$OWNER_UID\"]}" > /dev/null
cek "GET penyimpanan: Rak Uji punya 1 petugas" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq --arg id "$RAK_ID" '[.[] | select(.id == $id)][0].petugas | length')"
cek "kasir bukan petugas → opname plastik ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/opname" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":470}]}")"
OSID=$(api "$OWNER" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":475}]}" | jq -r .session_id)
{ [ "$OSID" != "null" ] && [ -n "$OSID" ]; } && ok "owner selalu boleh opname (bypass)" \
  || gagal "owner seharusnya bypass"
# tambahkan kasir sebagai petugas
api "$OWNER" PUT "/penyimpanan/$RAK_ID/petugas" "{\"user_ids\":[\"$OWNER_UID\",\"$KASIR_UID\"]}" > /dev/null
KSID=$(api "$KASIR" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":472}]}" | jq -r .session_id)
{ [ "$KSID" != "null" ] && [ -n "$KSID" ]; } && ok "kasir petugas boleh opname plastik" \
  || gagal "kasir petugas seharusnya boleh"
cek "kasir tak boleh atur petugas (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/penyimpanan/$RAK_ID/petugas" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"user_ids":[]}')"
# buka lagi (kosongkan petugas)
api "$OWNER" PUT "/penyimpanan/$RAK_ID/petugas" "{\"user_ids\":[]}" > /dev/null
cek "buka lagi: Rak Uji 0 petugas" "V == 0" \
  "$(api "$OWNER" GET /penyimpanan | jq --arg id "$RAK_ID" '[.[] | select(.id == $id)][0].petugas | length')"
USID=$(api "$KASIR" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":478}]}" | jq -r .session_id)
{ [ "$USID" != "null" ] && [ -n "$USID" ]; } && ok "tempat terbuka lagi: kasir boleh opname plastik" \
  || gagal "kasir seharusnya boleh saat terbuka lagi"

echo "== 17. Batasi kasir + rekomendasi beli dari target penjualan =="
# 17a. Gerbang peran owner/admin
cek "kasir GET /pembelian ditolak (403)" "V == 403" "$(status_code "$KASIR" GET /pembelian)"
cek "kasir GET /produksi ditolak (403)" "V == 403" "$(status_code "$KASIR" GET /produksi)"
cek "kasir GET /laporan ditolak (403)" "V == 403" "$(status_code "$KASIR" GET /laporan)"
cek "kasir GET /rekomendasi/beli ditolak (403)" "V == 403" "$(status_code "$KASIR" GET /rekomendasi/beli)"
cek "kasir POST /produksi/faktur ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/faktur" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"items":[]}')"
cek "owner GET /pembelian ok (200)" "V == 200" "$(status_code "$OWNER" GET /pembelian)"
cek "owner GET /rekomendasi/beli ok (200)" "V == 200" "$(status_code "$OWNER" GET /rekomendasi/beli)"

# 17b. Penjualan hari ini → rekomendasi (acuan = hari ini). Transaksi = kasir-saja.
MENU_ID=$(api "$OWNER" GET /menu | jq -r '[.[] | select(.tipe == "regular")][0].id')
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$MENU_ID\",\"qty\":3}]}" > /dev/null
TODAY=$(TZ=Asia/Jakarta date +%F)
REK=$(api "$OWNER" GET "/rekomendasi/beli?acuan=rentang&dari=$TODAY&sampai=$TODAY&target=20000000")
cek "rekomendasi: omzet acuan > 0" "V > 0" "$(echo "$REK" | jq '.acuan.omzet')"
cek "rekomendasi: ada bahan terpakai hari ini" "V >= 1" \
  "$(echo "$REK" | jq '[.bahan[] | select(.terpakai > 0)] | length')"
cek "rekomendasi: pakai default = hari ini" "V == 1" \
  "$(echo "$REK" | jq --arg t "$TODAY" '((.pakai.dari == $t) and (.pakai.sampai == $t)) | if . then 1 else 0 end')"
# filter terpakai ke tanggal lampau tanpa penjualan → semua terpakai = 0
PAST=$(TZ=Asia/Jakarta date -d '30 days ago' +%F 2>/dev/null || TZ=Asia/Jakarta date -v-30d +%F)
REK_PAST=$(api "$OWNER" GET "/rekomendasi/beli?acuan=rentang&dari=$TODAY&sampai=$TODAY&target=20000000&pakai_dari=$PAST&pakai_sampai=$PAST")
cek "filter terpakai tanggal lampau → 0 pemakaian" "V == 0" \
  "$(echo "$REK_PAST" | jq '[.bahan[] | select(.terpakai > 0)] | length')"
cek "filter terpakai: pakai.dari mengikuti query" "V == 1" \
  "$(echo "$REK_PAST" | jq --arg p "$PAST" '(.pakai.dari == $p) | if . then 1 else 0 end')"
OM=$(echo "$REK" | jq '.acuan.omzet')
ROW=$(echo "$REK" | jq '[.bahan[] | select(.terpakai > 0 and .kebutuhan != null)][0]')
cek "rekomendasi: kebutuhan == acuan_qty*target/omzet" "abs(V) < 0.5" \
  "$(echo "$ROW" | jq --argjson om "$OM" '.kebutuhan - (.acuan_qty * 20000000 / $om)')"
cek "rekomendasi: saran_beli ~= kekurangan (kebutuhan-sisa, epsilon)" "abs(V) < 0.5" \
  "$(echo "$ROW" | jq '.saran_beli - (if (.kebutuhan - .sisa) > 0 then (.kebutuhan - .sisa) else 0 end)')"

# 17c. Target default tersimpan di company & dipakai bila ?target kosong
api "$OWNER" PATCH /company '{"target_penjualan":15000000}' > /dev/null
cek "target default tersimpan (company GET)" "V == 15000000" \
  "$(api "$OWNER" GET /company | jq '.targetPenjualan')"
cek "rekomendasi tanpa ?target pakai default" "V == 15000000" \
  "$(api "$OWNER" GET "/rekomendasi/beli?acuan=rentang&dari=$TODAY&sampai=$TODAY" | jq '.target')"

echo "== 18. Riwayat transaksi kasir (cek pesanan + cetak ulang struk) =="
MENU_R=$(api "$KASIR" GET /menu | jq -r '[.[] | select(.tipe == "regular")][0].id')
SALE=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":true,\"items\":[{\"menu_id\":\"$MENU_R\",\"qty\":2}]}")
SALE_ID=$(echo "$SALE" | jq -r '.sale.id')
SALE_NO=$(echo "$SALE" | jq -r '.sale.nomor')
{ [ -n "$SALE_ID" ] && [ "$SALE_ID" != "null" ]; } && ok "kasir buat transaksi" || gagal "kasir gagal transaksi"
TODAY2=$(TZ=Asia/Jakarta date +%F)
LIST=$(api "$KASIR" GET "/penjualan?tanggal=$TODAY2")
cek "riwayat (kasir) memuat transaksi baru" "V == 1" \
  "$(echo "$LIST" | jq --arg id "$SALE_ID" '[.[] | select(.id == $id)] | length')"
cek "riwayat: jumlah_item terisi" "V == 1" \
  "$(echo "$LIST" | jq --arg id "$SALE_ID" '[.[] | select(.id == $id and .jumlah_item >= 1)] | length')"
cek "riwayat: nama kasir terisi" "V == 1" \
  "$(echo "$LIST" | jq --arg id "$SALE_ID" '[.[] | select(.id == $id and (.kasir | type) == "string")] | length')"
DET=$(api "$KASIR" GET "/penjualan/$SALE_ID")
cek "detail transaksi: nomor cocok" "V == 1" \
  "$(echo "$DET" | jq --arg n "$SALE_NO" '(.sale.nomor == $n) | if . then 1 else 0 end')"
cek "detail: branch_nama terisi (untuk struk)" "V == 1" \
  "$(echo "$DET" | jq '((.branch_nama | length) > 0) | if . then 1 else 0 end')"
cek "detail: item lengkap (harga_satuan untuk struk)" "V == 1" \
  "$(echo "$DET" | jq '([.items[] | select(.hargaSatuan > 0)] | length >= 1) | if . then 1 else 0 end')"

echo "== 19. Meja: master + tata letak + transaksi berbasis meja =="
MEJA=$(api "$KASIR" GET /meja)
cek "kasir GET /meja: >= 5 meja" "V >= 5" "$(echo "$MEJA" | jq 'length')"
cek "kasir GET /meja: ada Ruang Tunggu (takeaway)" "V == 1" \
  "$(echo "$MEJA" | jq '([.[] | select(.tipe == "takeaway")] | length >= 1) | if . then 1 else 0 end')"
MEJA_DINEIN=$(echo "$MEJA" | jq -r '[.[] | select(.tipe == "dine_in")][0].id')
MEJA_TA=$(echo "$MEJA" | jq -r '[.[] | select(.tipe == "takeaway")][0].id')

# bersihkan sisa run sebelumnya lalu buat meja baru (harus tipe dine_in)
OLD_UJI=$(echo "$MEJA" | jq -r '[.[] | select(.nama == "Meja Uji" or .nama == "Meja Uji B")][0].id // empty')
[ -n "$OLD_UJI" ] && api "$KASIR" DELETE "/meja/$OLD_UJI" > /dev/null || true
NEW=$(api "$KASIR" POST /meja '{"nama":"Meja Uji"}')
NEW_ID=$(echo "$NEW" | jq -r '.id')
{ [ -n "$NEW_ID" ] && [ "$NEW_ID" != "null" ]; } && ok "kasir POST /meja buat 'Meja Uji'" || gagal "kasir gagal buat meja"
cek "meja baru tipe dine_in" "V == 1" "$(echo "$NEW" | jq '(.tipe == "dine_in") | if . then 1 else 0 end')"

# simpan tata letak (persen) untuk meja baru
api "$KASIR" PUT /meja/tata-letak "{\"items\":[{\"id\":\"$NEW_ID\",\"pos_x\":77,\"pos_y\":66}]}" > /dev/null
cek "tata letak tersimpan (pos_x=77)" "V == 77" \
  "$(api "$KASIR" GET /meja | jq --arg id "$NEW_ID" '[.[] | select(.id == $id)][0].pos_x')"

# rename via PATCH
api "$KASIR" PATCH "/meja/$NEW_ID" '{"nama":"Meja Uji B"}' > /dev/null
cek "rename meja (PATCH nama)" "V == 1" \
  "$(api "$KASIR" GET /meja | jq --arg id "$NEW_ID" '(([.[] | select(.id == $id)][0].nama) == "Meja Uji B") | if . then 1 else 0 end')"

# DELETE meja Ruang Tunggu ditolak (400); meja biasa boleh (200)
cek "DELETE Ruang Tunggu ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/meja/$MEJA_TA" -H "Authorization: Bearer $KASIR")"
cek "DELETE meja biasa ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/meja/$NEW_ID" -H "Authorization: Bearer $KASIR")"

# transaksi berbasis meja: tipe meja menurunkan is_dine_in + snapshot label
MENU_M=$(api "$KASIR" GET /menu | jq -r '[.[] | select(.tipe == "regular")][0].id')
S_DI=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MEJA_DINEIN\",\"items\":[{\"menu_id\":\"$MENU_M\",\"qty\":1}]}")
S_DI_ID=$(echo "$S_DI" | jq -r '.sale.id')
cek "meja dine_in → sale.is_dine_in true" "V == 1" \
  "$(echo "$S_DI" | jq '(.sale.isDineIn == true) | if . then 1 else 0 end')"
cek "meja dine_in → mejaLabel terisi" "V == 1" \
  "$(echo "$S_DI" | jq '((.sale.mejaLabel | type) == "string") | if . then 1 else 0 end')"
cek "detail transaksi memuat mejaLabel" "V == 1" \
  "$(api "$KASIR" GET "/penjualan/$S_DI_ID" | jq '((.sale.mejaLabel | type) == "string") | if . then 1 else 0 end')"
cek "riwayat memuat label meja" "V == 1" \
  "$(api "$KASIR" GET "/penjualan?tanggal=$(TZ=Asia/Jakarta date +%F)" | jq --arg id "$S_DI_ID" '[.[] | select(.id == $id and (.meja | type) == "string")] | length')"
S_TA=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MEJA_TA\",\"items\":[{\"menu_id\":\"$MENU_M\",\"qty\":1}]}")
cek "meja takeaway → sale.is_dine_in false" "V == 1" \
  "$(echo "$S_TA" | jq '(.sale.isDineIn == false) | if . then 1 else 0 end')"

# owner kelola meja per cabang via ?branch_id
BR=$(api "$OWNER" GET /cabang | jq -r '.[0].id')
cek "owner GET /meja?branch_id ok (>=5)" "V >= 5" \
  "$(api "$OWNER" GET "/meja?branch_id=$BR" | jq 'length')"

echo "== 20. Catatan personalisasi per baris menu =="
MEJA_D=$(api "$KASIR" GET /meja | jq -r '[.[] | select(.tipe == "dine_in" and .is_active)][0].id')
MENU_C=$(api "$KASIR" GET /menu | jq -r '[.[] | select(.tipe == "regular")][0].id')
S_CAT=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MEJA_D\",\"items\":[{\"menu_id\":\"$MENU_C\",\"qty\":1,\"catatan\":\"tanpa gula\"}]}")
S_CAT_ID=$(echo "$S_CAT" | jq -r '.sale.id')
cek "item menyimpan catatan (respons POST)" "V == 1" \
  "$(echo "$S_CAT" | jq '([.items[] | select(.catatan == "tanpa gula")] | length == 1) | if . then 1 else 0 end')"
cek "detail transaksi memuat catatan baris" "V == 1" \
  "$(api "$KASIR" GET "/penjualan/$S_CAT_ID" | jq '([.items[] | select(.catatan == "tanpa gula")] | length == 1) | if . then 1 else 0 end')"
S_NOCAT=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MEJA_D\",\"items\":[{\"menu_id\":\"$MENU_C\",\"qty\":1}]}")
cek "item tanpa catatan → null" "V == 1" \
  "$(echo "$S_NOCAT" | jq '(.items[0].catatan == null) | if . then 1 else 0 end')"
# catatan spasi-saja dinormalisasi jadi null (server trim)
S_WS=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MEJA_D\",\"items\":[{\"menu_id\":\"$MENU_C\",\"qty\":1,\"catatan\":\"   \"}]}")
cek "catatan spasi-saja → null (trim server)" "V == 1" \
  "$(echo "$S_WS" | jq '(.items[0].catatan == null) | if . then 1 else 0 end')"

echo "== 21. Audit + Tempat Sampah (soft-delete tanpa password + pulihkan) =="
HARI=$(TZ=Asia/Jakarta date +%F)
saldo_bahan() { api "$OWNER" GET /stok | jq --arg id "$1" '([.[] | select(.ingredient_id==$id)][0].saldo) // 0'; }
BELI_ING=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.pengadaan=="beli" and .track_stok==true)][0].id')
S0=$(saldo_bahan "$BELI_ING")

# buat faktur pembelian 10 pcs → tahap → konfirmasi → saldo +10
FK=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI_ING\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000}]}")
FKID=$(echo "$FK" | jq -r '.faktur_id')
api "$OWNER" POST "/pembelian/tahap/$FKID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKID" '{"ke":"menunggu"}' > /dev/null
api "$OWNER" POST "/pembelian/konfirmasi/$FKID" > /dev/null
S1=$(saldo_bahan "$BELI_ING")
cek "pembelian dikonfirmasi → saldo +10" "abs(V - 10) < 0.001" "$(python3 -c "print($S1 - $S0)")"
cek "pembelian: dibuat_oleh terisi" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKID" '([.rows[] | select(.faktur_id==$f and (.dibuat_oleh|type)=="string")] | length>=1) | if . then 1 else 0 end')"

# PATCH metadata: password salah → 401; benar → catatan & diubah_oleh terisi
cek "PATCH faktur password salah → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/pembelian/faktur/$FKID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"password":"salah","catatan":"x"}')"
api "$OWNER" PATCH "/pembelian/faktur/$FKID" "{\"password\":\"$OWNER_PASS\",\"catatan\":\"faktur uji edit\"}" > /dev/null
cek "PATCH metadata → catatan berubah + diubah_oleh" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKID" '([.rows[] | select(.faktur_id==$f and .catatan=="faktur uji edit" and (.diubah_oleh|type)=="string")] | length>=1) | if . then 1 else 0 end')"

# DELETE (soft, cukup konfirmasi — TANPA password) → saldo balik, hilang dari
# list, muncul di sampah; lalu PULIHKAN → kembali seperti semula
api "$OWNER" DELETE "/pembelian/faktur/$FKID" > /dev/null
cek "hapus pembelian (tanpa password) → saldo balik ke awal" "abs(V) < 0.001" "$(python3 -c "print($(saldo_bahan "$BELI_ING") - $S0)")"
cek "faktur terhapus hilang dari /pembelian" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKID" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "pembelian ada di Tempat Sampah + dihapus_oleh" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg f "$FKID" '([.[] | select(.jenis=="pembelian" and .key==$f and (.dihapus_oleh|type)=="string")] | length==1) | if . then 1 else 0 end')"
# PULIHKAN dari Tempat Sampah → kembali di buku besar + saldo terhitung lagi
api "$OWNER" POST /sampah/pulihkan "{\"jenis\":\"pembelian\",\"key\":\"$FKID\"}" > /dev/null
cek "pulihkan: faktur kembali di /pembelian" "V >= 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKID" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "pulihkan: saldo kembali +10" "abs(V - 10) < 0.001" "$(python3 -c "print($(saldo_bahan "$BELI_ING") - $S0)")"
cek "pulihkan: hilang dari Tempat Sampah" "V == 0" \
  "$(api "$OWNER" GET /sampah | jq --arg f "$FKID" '[.[] | select(.jenis=="pembelian" and .key==$f)] | length')"
cek "pulihkan dua kali → 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sampah/pulihkan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"jenis\":\"pembelian\",\"key\":\"$FKID\"}")"
# hapus lagi — sisa alur §21 tetap menguji keadaan terhapus
api "$OWNER" DELETE "/pembelian/faktur/$FKID" > /dev/null

# Penjualan: soft-delete owner+password → omzet turun, hilang dari riwayat, masuk sampah
MENU_S=$(api "$KASIR" GET /menu | jq -r '[.[] | select(.tipe=="regular")][0].id')
MJ=$(api "$KASIR" GET /meja | jq -r '[.[] | select(.tipe=="dine_in" and .is_active)][0].id')
SL=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MJ\",\"items\":[{\"menu_id\":\"$MENU_S\",\"qty\":2}]}")
SLID=$(echo "$SL" | jq -r '.sale.id')
OMZ1=$(api "$OWNER" GET "/laporan?tanggal=$HARI" | jq '.omzet')
cek "kasir hapus penjualan → 403 (role, bukan password)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/penjualan/$SLID" -H "Authorization: Bearer $KASIR")"
api "$OWNER" DELETE "/penjualan/$SLID" > /dev/null
cek "penjualan terhapus hilang dari riwayat" "V == 0" \
  "$(api "$KASIR" GET "/penjualan?tanggal=$HARI" | jq --arg id "$SLID" '[.[] | select(.id==$id)] | length')"
cek "hapus penjualan → omzet laporan turun" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/laporan?tanggal=$HARI" | jq '.omzet') < $OMZ1 else 0)")"
cek "penjualan ada di Tempat Sampah" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg id "$SLID" '([.[] | select(.jenis=="penjualan" and .key==$id)] | length==1) | if . then 1 else 0 end')"
# pulihkan penjualan → omzet kembali; hapus lagi utk keadaan akhir yang sama
api "$OWNER" POST /sampah/pulihkan "{\"jenis\":\"penjualan\",\"key\":\"$SLID\"}" > /dev/null
cek "pulihkan penjualan → omzet kembali" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/laporan?tanggal=$HARI" | jq '.omzet') == $OMZ1 else 0)")"
api "$OWNER" DELETE "/penjualan/$SLID" > /dev/null
cek "kasir GET /sampah ditolak (403)" "V == 403" "$(status_code "$KASIR" GET /sampah)"

echo "== 22. Buku besar pembelian: objek {rows,total} + pagination + filter tanggal =="
ING2=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.pengadaan=="beli" and .track_stok==true)][0].id')
for i in 1 2 3; do
  api "$OWNER" POST /pembelian/faktur "{\"no_faktur\":\"LG-$i\",\"items\":[{\"ingredient_id\":\"$ING2\",\"mode\":\"pcs\",\"jumlah\":$i}]}" > /dev/null
done
LGP=$(api "$OWNER" GET "/pembelian?per_page=2&page=1")
cek "list = objek {rows[],total}" "V == 1" \
  "$(echo "$LGP" | jq '(((.rows|type)=="array") and ((.total|type)=="number")) | if . then 1 else 0 end')"
cek "total faktur >= 3" "V >= 3" "$(echo "$LGP" | jq '.total')"
cek "per_page=2 → maks 2 faktur/halaman" "V <= 2" \
  "$(echo "$LGP" | jq '[.rows[].faktur_id] | unique | length')"
cek "rows dalam halaman urut waktu naik" "V == 1" \
  "$(echo "$LGP" | jq '(((.rows|length)==0) or (.rows[0].waktu <= .rows[-1].waktu)) | if . then 1 else 0 end')"
# urutan faktur: belum selesai dulu, lalu terbaru → LG-3 (baru dibuat, belum
# dikonfirmasi) harus muncul di halaman 1
cek "halaman 1 memuat faktur terbaru yg belum selesai (LG-3)" "V >= 1" \
  "$(echo "$LGP" | jq '[.rows[] | select(.no_faktur=="LG-3")] | length')"
cek "filter tanggal hari ini memuat faktur baru" "V >= 1" \
  "$(api "$OWNER" GET "/pembelian?dari=$HARI&sampai=$HARI&per_page=200" | jq '[.rows[] | select(.no_faktur=="LG-3")] | length')"
cek "filter tanggal lampau → 0 faktur" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?dari=2000-01-01&sampai=2000-01-02" | jq '.total')"

echo "== 23. Lihat Menu: sort_order di DTO + atur urutan (kasir) =="
cek "GET /menu memuat sort_order" "V == 1" \
  "$(api "$KASIR" GET /menu | jq '((.[0].sort_order|type)=="number") | if . then 1 else 0 end')"
# kasir membalik urutan 2 menu pertama → sort_order tersimpan (0,1 ditukar)
MID0=$(api "$KASIR" GET /menu | jq -r '.[0].id')
MID1=$(api "$KASIR" GET /menu | jq -r '.[1].id')
cek "kasir PUT /menu/urutan (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/menu/urutan" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$MID1\",\"sort_order\":0},{\"id\":\"$MID0\",\"sort_order\":1}]}")"
cek "sort_order menu tersimpan (MID1=0)" "V == 0" \
  "$(api "$KASIR" GET /menu | jq --arg id "$MID1" '[.[] | select(.id==$id)][0].sort_order')"
cek "GET /menu urut sort_order (MID1 sebelum MID0)" "V == 1" \
  "$(api "$KASIR" GET /menu | jq --arg a "$MID1" --arg b "$MID0" '((([.[] | .id] | index($a)) < ([.[] | .id] | index($b)))) | if . then 1 else 0 end')"

echo "== 24. Pipeline produksi: karyawan wajib, RAB, 4 tahap, indikator stok =="
W24=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.is_active)][0].user_id')
B24=$(api "$OWNER" GET /bahan | jq --arg id "$URATB_ID" '[.[] | select(.id == $id)][0]')
ISI24=$(echo "$B24" | jq -r .isi)
HB24=$(echo "$B24" | jq -r .harga_beli)
SALDO24=$(stok_of "$(api "$OWNER" GET /stok)" "baso urat besar")

# pelaksana kini OPSIONAL — tanpa worker/supplier faktur tetap dibuat
# (pelaksana terisi otomatis saat Mulai Kerjakan; lihat §122)
FKNP24=$(api "$OWNER" POST /produksi/faktur "{\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"batch\",\"jumlah\":1}]}")
cek "faktur produksi tanpa pelaksana → boleh dibuat" "V == 1" \
  "$(echo "$FKNP24" | jq '(.faktur_id!=null)|if . then 1 else 0 end')"
api "$OWNER" DELETE "/produksi/faktur/$(echo "$FKNP24" | jq -r .faktur_id)" > /dev/null   # bersihkan
cek "worker_id bukan anggota ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/faktur" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"worker_id\":\"00000000-0000-4000-8000-000000000000\",\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"batch\",\"jumlah\":1}]}")"

FK24=$(api "$OWNER" POST /produksi/faktur "{\"worker_id\":\"$W24\",\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"batch\",\"jumlah\":1}]}")
FK24_ID=$(echo "$FK24" | jq -r .faktur_id)
cek "faktur produksi dibuat berstatus rencana" "V == 1" \
  "$(echo "$FK24" | jq '(.status == "rencana") | if . then 1 else 0 end')"
ROW24=$(api "$OWNER" GET "/produksi?per_page=500" | jq --arg f "$FK24_ID" '[.rows[] | select(.faktur_id == $f)][0]')
cek "RAB otomatis terisi (= harga 1 batch)" "abs(V - $HB24) < 1" "$(echo "$ROW24" | jq '.total_harga // 0')"
cek "dikerjakan_oleh terisi di riwayat" "V == 1" \
  "$(echo "$ROW24" | jq '((.dikerjakan_oleh | type) == "string") | if . then 1 else 0 end')"

STOK24=$(api "$OWNER" GET /stok | jq '[.[] | select(.slug == "baso urat besar")][0]')
cek "stok: produksi_berjalan.qty = isi (rencana)" "abs(V - $ISI24) < 0.001" \
  "$(echo "$STOK24" | jq '.produksi_berjalan.qty // 0')"
cek "stok: tahap rencana terisi" "abs(V - $ISI24) < 0.001" \
  "$(echo "$STOK24" | jq '.produksi_berjalan.rencana // 0')"
cek "saldo BELUM berubah (rencana)" "abs(V - $SALDO24) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "baso urat besar")"

cek "konfirmasi dari rencana ditolak (404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/konfirmasi/$FK24_ID" -H "Authorization: Bearer $OWNER")"
cek "lompat tahap rencana→menunggu ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$FK24_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"menunggu"}')"
cek "tahap rencana→dikerjakan ok" "V == 1" \
  "$(api "$OWNER" POST "/produksi/tahap/$FK24_ID" '{"ke":"dikerjakan"}' | jq '(.status == "dikerjakan") | if . then 1 else 0 end')"
cek "ulang tahap dikerjakan ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$FK24_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikerjakan"}')"
cek "stok: tahap pindah ke dikerjakan" "abs(V - $ISI24) < 0.001" \
  "$(api "$OWNER" GET /stok | jq '[.[] | select(.slug == "baso urat besar")][0].produksi_berjalan.dikerjakan // 0')"
cek "kartu stok: produksi_berjalan.qty = isi" "abs(V - $ISI24) < 0.001" \
  "$(api "$OWNER" GET "/stok/kartu/$URATB_ID" | jq '.produksi_berjalan.qty // 0')"

cek "tahap dikerjakan→menunggu (selesai) ok" "V == 1" \
  "$(api "$OWNER" POST "/produksi/tahap/$FK24_ID" '{"ke":"menunggu"}' | jq '(.status == "menunggu") | if . then 1 else 0 end')"
# produksi selesai di CABANG SENDIRI (CK) → LANGSUNG masuk stok tanpa konfirmasi terpisah
cek "selesai produksi → saldo LANGSUNG +isi (masuk stok, tanpa konfirmasi)" "abs(V - ($SALDO24 + $ISI24)) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "baso urat besar")"
cek "selesai produksi: produksi_berjalan hilang" "V == 1" \
  "$(api "$OWNER" GET /stok | jq '[.[] | select(.slug == "baso urat besar")][0] | (.produksi_berjalan == null) | if . then 1 else 0 end')"
cek "konfirmasi CK-lokal jadi no-op (sudah masuk stok, 404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/konfirmasi/$FK24_ID" -H "Authorization: Bearer $OWNER")"

cek "faktur produksi via /pembelian/tahap → 404 (isolasi jalur)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK24_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikerjakan"}')"
# pelaksana boleh SUPPLIER (bukan hanya karyawan): faktur produksi dengan supplier_id saja diterima
SUP24=$(api "$OWNER" POST /supplier '{"nama":"Dapur Teja"}' | jq -r '.id // empty')
[ -z "$SUP24" ] && SUP24=$(api "$OWNER" GET /supplier | jq -r '[.[] | select(.nama=="Dapur Teja")][0].id')
FKS24=$(api "$OWNER" POST /produksi/faktur "{\"supplier_id\":\"$SUP24\",\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"pcs\",\"jumlah\":1}]}")
cek "faktur produksi dengan supplier (tanpa karyawan) → rencana" "V == 1" \
  "$(echo "$FKS24" | jq '(.status == "rencana") | if . then 1 else 0 end')"
cek "riwayat: pelaksana supplier terisi, dikerjakan_oleh null" "V == 1" \
  "$(api "$OWNER" GET "/produksi?per_page=500" | jq --arg f "$(echo "$FKS24" | jq -r .faktur_id)" '[.rows[] | select(.faktur_id==$f)][0] | ((.supplier == "Dapur Teja") and (.dikerjakan_oleh == null)) | if . then 1 else 0 end')"

echo "== 25. Beli di cabang sendiri: RAB → diproses → tiba = LANGSUNG masuk stok (tanpa penerimaan) =="
# Orang cabang sendiri yang beli → begitu barang TIBA (menunggu) langsung masuk
# stok, tak perlu langkah penerimaan/konfirmasi terpisah. (Kiriman CK→cabang yang
# WAJIB diterima diuji di §52b, saat mode Pro sudah punya CK + cabang.)
BELI25=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.pengadaan == "beli" and .track_stok == true)][0].id')
SALDO25=$(saldo_bahan "$BELI25")
FKA25=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI25\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":1000}]}")
FKA25_ID=$(echo "$FKA25" | jq -r .faktur_id)
cek "faktur pembelian dibuat berstatus rencana (RAB)" "V == 1" \
  "$(echo "$FKA25" | jq '(.status == "rencana") | if . then 1 else 0 end')"
cek "konfirmasi pembelian dari rencana ditolak (404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/konfirmasi/$FKA25_ID" -H "Authorization: Bearer $OWNER")"
cek "saldo belum berubah saat RAB" "abs(V - $SALDO25) < 0.001" "$(saldo_bahan "$BELI25")"
api "$OWNER" POST "/pembelian/tahap/$FKA25_ID" '{"ke":"dikerjakan"}' > /dev/null
cek "saldo belum berubah saat diproses" "abs(V - $SALDO25) < 0.001" "$(saldo_bahan "$BELI25")"
cek "kasir: beli cabang sendiri tak muncul di /penerimaan" "V == 0" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FKA25_ID" '[.rows[] | select(.faktur_id==$f)] | length')"
api "$OWNER" POST "/pembelian/tahap/$FKA25_ID" '{"ke":"menunggu"}' > /dev/null
cek "tiba di cabang sendiri → saldo LANGSUNG +10 (masuk stok, tanpa penerimaan)" "abs(V - ($SALDO25 + 10)) < 0.001" "$(saldo_bahan "$BELI25")"
cek "baris jadi dikonfirmasi (masuk stok) tanpa langkah penerimaan" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKA25_ID" '([.rows[] | select(.faktur_id==$f)][0].status == "dikonfirmasi") | if . then 1 else 0 end')"
cek "konfirmasi ulang jadi no-op (sudah masuk stok, 404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/konfirmasi/$FKA25_ID" -H "Authorization: Bearer $OWNER")"

echo "== 26. Beli sebagian di cabang sendiri: split baris → sebagian masuk stok, sisa tetap tugas =="
BELI26=$BELI25
SALDO26=$(saldo_bahan "$BELI26")
# 1 baris 10 pcs → diproses → maju 4 (tiba) LANGSUNG masuk stok (split: 4 + sisa 6);
# lalu sisa 6 tiba → semua masuk stok. (1 bahan/baris → tak ada masalah urutan.)
FKF26=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":1000}]}")
FKF26_ID=$(echo "$FKF26" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKF26_ID" '{"ke":"dikerjakan"}' > /dev/null
RF1=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FKF26_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FKF26_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RF1\",\"qty\":4}]}" > /dev/null
cek "maju 4 (tiba) → saldo +4 (masuk stok); sisa belum" "abs(V - ($SALDO26 + 4)) < 0.001" "$(saldo_bahan "$BELI26")"
cek "split: 4 dikonfirmasi (masuk stok) + 6 tetap diproses" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKF26_ID" '[.rows[] | select(.faktur_id==$f)] | ((([.[]|select(.status=="dikonfirmasi" and .qty==4)]|length)>=1) and (([.[]|select(.status=="dikerjakan" and .qty==6)]|length)==1)) | if . then 1 else 0 end')"
RF2=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FKF26_ID" '[.rows[] | select(.faktur_id==$f and .status=="dikerjakan")][0].id')
api "$OWNER" POST "/pembelian/tahap/$FKF26_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RF2\",\"qty\":6}]}" > /dev/null
cek "sisa 6 tiba → saldo +6 (total +10, semua masuk stok)" "abs(V - ($SALDO26 + 10)) < 0.001" "$(saldo_bahan "$BELI26")"
cek "faktur selesai penuh: semua dikonfirmasi" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKF26_ID" '[.rows[] | select(.faktur_id==$f)] | (all(.[]; .status=="dikonfirmasi")) | if . then 1 else 0 end')"

echo "== 27. Laporan pembelian (pengeluaran bahan baku terkonfirmasi) =="
SUPLAP=$(api "$OWNER" POST /supplier '{"nama":"Supplier Lapbeli"}' | jq -r '.id // empty')
[ -z "$SUPLAP" ] && SUPLAP=$(api "$OWNER" GET /supplier | jq -r '[.[] | select(.nama=="Supplier Lapbeli")][0].id')
FLAP=$(api "$OWNER" POST /pembelian/faktur "{\"supplier_id\":\"$SUPLAP\",\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":2,\"total_harga\":4321}]}" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FLAP" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FLAP" '{"ke":"menunggu"}' > /dev/null
api "$OWNER" POST "/penerimaan/$FLAP/terima" > /dev/null
LAP=$(api "$OWNER" GET "/laporan/pembelian?branch_id=all")
cek "laporan: total_pengeluaran memuat faktur 4321" "V >= 4321" "$(echo "$LAP" | jq '.total_pengeluaran')"
cek "laporan: per_supplier 'Supplier Lapbeli' = 4321 (1 faktur)" "V == 1" \
  "$(echo "$LAP" | jq '[.per_supplier[] | select(.supplier=="Supplier Lapbeli" and .total==4321 and .jumlah_faktur==1)] | length')"
cek "laporan: per_bahan memuat bahan dgn total>0" "V == 1" \
  "$(echo "$LAP" | jq '(([.per_bahan[] | select(.total>0)] | length) >= 1) | if . then 1 else 0 end')"
# faktur rencana (belum diterima) TIDAK menambah pengeluaran
api "$OWNER" POST /pembelian/faktur "{\"supplier_id\":\"$SUPLAP\",\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":1,\"total_harga\":9999}]}" > /dev/null
cek "laporan: faktur rencana tidak menambah pengeluaran" "V == 1" \
  "$(api "$OWNER" GET "/laporan/pembelian?branch_id=all" | jq --argjson t "$(echo "$LAP" | jq .total_pengeluaran)" '(.total_pengeluaran == $t) | if . then 1 else 0 end')"
# rentang tanggal lampau → kosong
cek "laporan: rentang 2020 → total 0" "V == 0" \
  "$(api "$OWNER" GET "/laporan/pembelian?dari=2020-01-01&sampai=2020-01-31&branch_id=all" | jq '.total_pengeluaran')"
# kasir tak boleh akses laporan (gate owner/admin)
cek "kasir akses /laporan/pembelian ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/laporan/pembelian" -H "Authorization: Bearer $KASIR")"

echo "== 28. Stok: pembelian berjalan (RAB→diproses) + tiba di cabang sendiri = masuk stok =="
pb_qty() { api "$OWNER" GET /stok | jq --arg id "$1" '([.[]|select(.ingredient_id==$id)][0].pembelian_berjalan // {qty:0}).qty'; }
pb_rencana() { api "$OWNER" GET /stok | jq --arg id "$1" '([.[]|select(.ingredient_id==$id)][0].pembelian_berjalan // {rencana:0}).rencana'; }
PB0=$(pb_qty "$BELI26")
SB0PB=$(saldo_bahan "$BELI26")   # saldo sebelum, di cabang sendiri (Pusat)
FPB=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":800}]}" | jq -r .faktur_id)
cek "stok: pembelian_berjalan +8 saat faktur RAB dibuat" "abs(V - ($PB0 + 8)) < 0.001" "$(pb_qty "$BELI26")"
cek "stok: pembelian_berjalan.rencana memuat 8" "V >= 8" "$(pb_rencana "$BELI26")"
api "$OWNER" POST "/pembelian/tahap/$FPB" '{"ke":"dikerjakan"}' > /dev/null
cek "stok: pembelian_berjalan tetap +8 saat diproses (dikerjakan)" "abs(V - ($PB0 + 8)) < 0.001" "$(pb_qty "$BELI26")"
# tiba di cabang sendiri (tanpa tujuan) → LANGSUNG masuk stok (tanpa penerimaan)
api "$OWNER" POST "/pembelian/tahap/$FPB" '{"ke":"menunggu"}' > /dev/null
cek "stok: pembelian_berjalan → 0 setelah tiba di cabang sendiri (masuk stok)" "abs(V - $PB0) < 0.001" "$(pb_qty "$BELI26")"
cek "stok: saldo +8 setelah tiba (langsung masuk stok, tanpa penerimaan)" "abs(V - ($SB0PB + 8)) < 0.001" "$(saldo_bahan "$BELI26")"

echo "== 29. Ambang batas stok minimum per bahan → status menipis/aman =="
st_of() { api "$OWNER" GET /stok | jq --arg id "$BELI26" "([.[]|select(.ingredient_id==\$id)][0].$1)"; }
SALDO29=$(saldo_bahan "$BELI26")
MIN_HI=$(python3 -c "print($SALDO29 + 50)")
api "$OWNER" PUT "/bahan/$BELI26" "{\"stok_minimum\":$MIN_HI}" > /dev/null
cek "stok: status 'menipis' saat saldo < ambang minimum" "V == 1" \
  "$(api "$OWNER" GET /stok | jq --arg id "$BELI26" '([.[]|select(.ingredient_id==$id)][0].status == "menipis") | if . then 1 else 0 end')"
cek "stok: field stok_minimum ikut terkirim" "abs(V - $MIN_HI) < 0.001" "$(st_of stok_minimum)"
api "$OWNER" PUT "/bahan/$BELI26" '{"stok_minimum":1}' > /dev/null
cek "stok: status 'aman' saat saldo > ambang minimum" "V == 1" \
  "$(api "$OWNER" GET /stok | jq --arg id "$BELI26" '([.[]|select(.ingredient_id==$id)][0].status == "aman") | if . then 1 else 0 end')"
cek "bahan: stok_minimum tersimpan (=1)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$BELI26" '([.[]|select(.id==$id)][0].stok_minimum == 1) | if . then 1 else 0 end')"
api "$OWNER" PUT "/bahan/$BELI26" '{"stok_minimum":0}' > /dev/null

echo "== 30. Diskon per transaksi di kasir (persen/nominal, clamp, laporan) =="
# diskon persen 10% atas 1 PBA (subtotal 34000)
DP=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":10,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "diskon persen: subtotal 34000" "V == 34000" "$(echo "$DP" | jq '.sale.subtotal')"
cek "diskon persen 10% = 3400" "V == 3400" "$(echo "$DP" | jq '.sale.diskon')"
cek "diskon persen: diskon_persen tersimpan 10" "V == 10" "$(echo "$DP" | jq '.sale.diskonPersen')"
cek "diskon persen: total = subtotal - diskon + pb1" "V == 1" \
  "$(echo "$DP" | jq '(.sale.total == (.sale.subtotal - .sale.diskon + .sale.pb1Amount)) | if . then 1 else 0 end')"
# diskon nominal 5000
DN=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":5000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "diskon nominal = 5000" "V == 5000" "$(echo "$DN" | jq '.sale.diskon')"
cek "diskon nominal: diskon_persen null" "V == 1" "$(echo "$DN" | jq '(.sale.diskonPersen == null) | if . then 1 else 0 end')"
cek "diskon nominal: total = subtotal - 5000 + pb1" "V == 1" \
  "$(echo "$DN" | jq '(.sale.total == (.sale.subtotal - 5000 + .sale.pb1Amount)) | if . then 1 else 0 end')"
# clamp: nominal > subtotal → diskon == subtotal, total tak negatif (== pb1)
DC=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":9999999,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "diskon clamp: diskon tak melebihi subtotal" "V == 1" \
  "$(echo "$DC" | jq '(.sale.diskon == .sale.subtotal) | if . then 1 else 0 end')"
cek "diskon clamp: total tak negatif (== pb1)" "V == 1" \
  "$(echo "$DC" | jq '(.sale.total == .sale.pb1Amount) | if . then 1 else 0 end')"
# laporan mencerminkan total_diskon & profit mundur oleh diskon
LAPD=$(api "$OWNER" GET "/laporan?branch_id=all")
cek "laporan: total_diskon >= 3400+5000+34000" "V >= 42400" "$(echo "$LAPD" | jq '.total_diskon')"
cek "laporan: profit = omzet - diskon - hpp" "V == 1" \
  "$(echo "$LAPD" | jq '(.estimasi_profit == (.omzet - .total_diskon - .total_hpp)) | if . then 1 else 0 end')"

echo "== 31. Batas maksimal diskon kasir + transaksi HANYA kasir =="
jp() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }
# Transaksi POS = peran kasir SAJA: owner/admin/tim tak boleh menjual.
cek "owner tak boleh transaksi (kasir-saja) → 403" "V == 403" \
  "$(jp "$OWNER" "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "owner tak boleh buka shift (kasir-saja) → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/shift/buka" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"modal_awal":0}')"
cek "owner tak boleh open-bill (kasir-saja) → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/open-bill" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
api "$OWNER" PATCH /company '{"diskon_maks_persen":20}' > /dev/null
cek "company: diskon_maks_persen tersimpan 20" "V == 20" "$(api "$OWNER" GET /company | jq '.diskonMaksPersen')"
cek "kasir diskon 50% (> batas 20%) ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":50,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "kasir diskon nominal 17000 (=50% > batas) ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":17000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "kasir diskon 20% (= batas) diterima (201)" "V == 201" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":20,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
# Toleransi 0,5% ADA untuk pembulatan dan harus TETAP ada di batas bukan-nol:
# 6.900 dari 34.000 = 20,29%, sedikit di atas batas 20% — diterima. Penjaga
# arah-balik supaya lantai di bawah tidak dipasang dengan cara mematikan
# toleransinya di mana-mana.
cek "batas 20: diskon nominal 6900 (20,29% — dalam toleransi bulat) diterima (201)" "V == 201" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":6900,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
api "$OWNER" PATCH /company '{"diskon_maks_persen":0}' > /dev/null
cek "batas 0: kasir diskon 5% ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":5,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
# INTI: pita di BAWAH toleransi — yang dulu lolos diam-diam. Harga PBA 34.000
# (dijamin asersi "harga jual bulat PBA = 34000" di §2), jadi 0,5% = 170.
# Rp 100 = 0,29% dan Rp 170 = tepat 0,5%: keduanya dulu DITERIMA walau batasnya
# nol, karena toleransi pembulatan ikut dipakai pada batas yang tak punya apa
# pun untuk dibulatkan. Pada nota Rp 2 juta pita itu bernilai Rp 10.000, tiap
# transaksi, tanpa persetujuan siapa pun.
cek "batas 0: diskon nominal 100 (0,29% — di bawah toleransi lama) DITOLAK (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":100,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "batas 0: diskon nominal 170 (tepat 0,5% — batas toleransi lama) DITOLAK (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":170,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "batas 0: kasir tanpa diskon tetap boleh (201)" "V == 201" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
api "$OWNER" PATCH /company '{"diskon_maks_persen":100}' > /dev/null   # reset

echo "== 32. Kode menu (manual dihormati + generate otomatis) =="
CAT_ID=$(echo "$MENUS" | jq -r '.[0].category_id')
MK=$(api "$OWNER" POST /menu "{\"nama\":\"Uji Kode Menu\",\"kode\":\"ZZ9\",\"category_id\":\"$CAT_ID\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":12000,\"komponen\":[]}")
MK_ID=$(echo "$MK" | jq -r .id)
cek "buat menu: kode manual ZZ9 dihormati" "V == 1" "$(echo "$MK" | jq '(.kode == "ZZ9") | if . then 1 else 0 end')"
cek "GET /menu: menu baru ber-kode ZZ9" "V == 1" \
  "$(api "$OWNER" GET /menu | jq --arg id "$MK_ID" '[.[] | select(.id == $id and .kode == "ZZ9")] | length')"
# tanpa kode → tergenerate otomatis (tidak kosong)
MG=$(api "$OWNER" POST /menu "{\"nama\":\"Uji Auto Kode\",\"category_id\":\"$CAT_ID\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":12000,\"komponen\":[]}")
MG_ID=$(echo "$MG" | jq -r .id)
cek "buat menu tanpa kode: tergenerate (tidak kosong)" "V >= 1" "$(echo "$MG" | jq '(.kode // "") | length')"
# edit ubah kode manual
MKE=$(api "$OWNER" PUT "/menu/$MK_ID" "{\"nama\":\"Uji Kode Menu\",\"kode\":\"A12\",\"category_id\":\"$CAT_ID\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":12000,\"komponen\":[]}")
cek "edit menu: kode manual A12" "V == 1" "$(echo "$MKE" | jq '(.kode == "A12") | if . then 1 else 0 end')"
# kode dikosongkan (spasi) → tergenerate otomatis (tidak kosong)
MKN=$(api "$OWNER" PUT "/menu/$MK_ID" "{\"nama\":\"Uji Kode Menu\",\"kode\":\"   \",\"category_id\":\"$CAT_ID\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":12000,\"komponen\":[]}")
cek "edit menu: kode dikosongkan → tergenerate otomatis" "V >= 1" "$(echo "$MKN" | jq '(.kode // "") | length')"
# bersihkan: nonaktifkan menu uji
api "$OWNER" DELETE "/menu/$MK_ID" > /dev/null
api "$OWNER" DELETE "/menu/$MG_ID" > /dev/null

echo "== 33. Member/konsumen (input keranjang + member area) =="
MS1=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"customer_nama\":\"Budi\",\"customer_wa\":\"0812-3456-7890\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "sale simpan nama konsumen" "V == 1" "$(echo "$MS1" | jq '(.sale.customerNama == "Budi") | if . then 1 else 0 end')"
cek "sale normalisasi WA (digit saja)" "V == 1" "$(echo "$MS1" | jq '(.sale.customerWa == "081234567890") | if . then 1 else 0 end')"
cek "sale ter-link ke member" "V == 1" "$(echo "$MS1" | jq '(.sale.customerId != null) | if . then 1 else 0 end')"
CUST_ID=$(echo "$MS1" | jq -r '.sale.customerId')
cek "GET /customer: member Budi ada" "V == 1" \
  "$(api "$OWNER" GET /customer | jq --arg id "$CUST_ID" '[.[] | select(.id == $id)] | length')"
# transaksi kedua, WA sama (format beda) → member sama, nama diperbarui
MS2=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"customer_nama\":\"Budi Santoso\",\"customer_wa\":\"081234567890\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "WA sama → member sama (id tetap)" "V == 1" "$(echo "$MS2" | jq --arg id "$CUST_ID" '(.sale.customerId == $id) | if . then 1 else 0 end')"
DET=$(api "$OWNER" GET "/customer/$CUST_ID")
cek "member detail: 2 transaksi" "V == 2" "$(echo "$DET" | jq '.jumlah_transaksi')"
cek "member detail: nama diperbarui" "V == 1" "$(echo "$DET" | jq '(.nama == "Budi Santoso") | if . then 1 else 0 end')"
cek "member detail: transaksi punya no invoice" "V == 1" "$(echo "$DET" | jq '(.transaksi[0].nomor | length > 0) | if . then 1 else 0 end')"
# CRUD manual (owner) + dedup WA
CM=$(api "$OWNER" POST /customer '{"nama":"Member Manual","wa":"0899-000-111"}')
CM_ID=$(echo "$CM" | jq -r .id)
cek "POST /customer: WA dinormalisasi" "V == 1" "$(echo "$CM" | jq '(.wa == "0899000111") | if . then 1 else 0 end')"
cek "POST /customer WA duplikat → 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/customer" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"Dup","wa":"0899000111"}')"
api "$OWNER" DELETE "/customer/$CM_ID" > /dev/null
# member area khusus owner/admin
cek "kasir GET /customer ditolak (403)" "V == 403" "$(status_code "$KASIR" GET /customer)"
# autocomplete member: kasir BOLEH (semua peran), cari nama / WA
cek "kasir GET /member-cari diizinkan (200)" "V == 200" "$(status_code "$KASIR" GET /member-cari)"
cek "member-cari nama 'Budi' → ada hasil" "V >= 1" \
  "$(api "$KASIR" GET "/member-cari?q=Budi" | jq '[.[] | select(.nama | test("Budi"))] | length')"
cek "member-cari hasil punya nama & wa" "V == 1" \
  "$(api "$KASIR" GET "/member-cari?q=Budi" | jq '(.[0] | (.nama|length>0) and (.wa|length>0)) | if . then 1 else 0 end')"
cek "member-cari via WA '0812' → member Budi" "V == 1" \
  "$(api "$KASIR" GET "/member-cari?q=0812" | jq --arg id "$CUST_ID" '[.[] | select(.id == $id)] | length')"
cek "member-cari tanpa q → daftar member" "V >= 1" "$(api "$KASIR" GET /member-cari | jq 'length')"

echo "== 34. Menu terlaris (ranking qty & omzet) =="
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PYO_ID\",\"qty\":4}]}" > /dev/null
ML=$(api "$OWNER" GET "/laporan/menu-laris?branch_id=all")
cek "menu-laris: ada item" "V >= 1" "$(echo "$ML" | jq '.items | length')"
cek "menu-laris: urut qty menurun" "V == 1" \
  "$(echo "$ML" | jq 'if (.items|length) >= 2 then (if .items[0].qty >= .items[1].qty then 1 else 0 end) else 1 end')"
cek "menu-laris: PYO qty >= 4" "V >= 4" \
  "$(echo "$ML" | jq --arg id "$PYO_ID" '[.items[] | select(.menu_id == $id)][0].qty // 0')"
cek "menu-laris: PBA ber-kategori" "V == 1" \
  "$(echo "$ML" | jq --arg id "$PBA_ID" '(([.items[] | select(.menu_id == $id)][0].kategori // "") | length > 0) | if . then 1 else 0 end')"
cek "menu-laris: total_qty = SUM(items.qty)" "V == 1" \
  "$(echo "$ML" | jq '((((.items|map(.qty)|add) - .total_qty) | if . < 0 then -. else . end) < 0.001) | if . then 1 else 0 end')"

echo "== 35. Metode bayar + kembalian =="
MB=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"uang_diterima\":50000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "tunai: metode tersimpan" "V == 1" "$(echo "$MB" | jq '(.sale.metodeBayar == "tunai") | if . then 1 else 0 end')"
cek "tunai: uang diterima 50000" "V == 50000" "$(echo "$MB" | jq '.sale.uangDiterima')"
cek "tunai: uang >= total (kembalian >= 0)" "V == 1" \
  "$(echo "$MB" | jq '((.sale.uangDiterima - .sale.total) >= 0) | if . then 1 else 0 end')"
cek "sale response memuat nama kasir" "V == 1" "$(echo "$MB" | jq '(.kasir | length > 0) | if . then 1 else 0 end')"
cek "GET sale detail: nama kasir ada" "V == 1" \
  "$(api "$KASIR" GET "/penjualan/$(echo "$MB" | jq -r .sale.id)" | jq '(.kasir | length > 0) | if . then 1 else 0 end')"
MBQ=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"metode_bayar\":\"qris\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "qris: metode tersimpan" "V == 1" "$(echo "$MBQ" | jq '(.sale.metodeBayar == "qris") | if . then 1 else 0 end')"
cek "qris: uang diterima null" "V == 1" "$(echo "$MBQ" | jq '(.sale.uangDiterima == null) | if . then 1 else 0 end')"
cek "tunai uang < total ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"uang_diterima\":1000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
MBD=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "default metode = tunai" "V == 1" "$(echo "$MBD" | jq '(.sale.metodeBayar == "tunai") | if . then 1 else 0 end')"
LAPM=$(api "$OWNER" GET "/laporan?branch_id=all")
cek "laporan: per_metode memuat tunai & qris" "V == 1" \
  "$(echo "$LAPM" | jq '([.per_metode[].metode] | (index("tunai") != null) and (index("qris") != null)) | if . then 1 else 0 end')"

echo "== 36. Tutup kasir / shift =="
# Shift kasir sudah TERBUKA sejak §2b (gerbang buka kasir). Pakai yang aktif.
SH=$(api "$KASIR" GET /shift/aktif)
cek "shift aktif: modal awal 200000" "V == 200000" "$(echo "$SH" | jq '.modal_awal')"
cek "shift aktif: masih terbuka" "V == 1" "$(echo "$SH" | jq '(.ditutup_pada == null) | if . then 1 else 0 end')"
cek "buka shift kedua ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/shift/buka" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"modal_awal":0}')"
# transaksi dalam shift: tunai + qris
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"uang_diterima\":50000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" > /dev/null
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"metode_bayar\":\"qris\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" > /dev/null
# Rekap kas dibaca dari OWNER: sejak hitung buta (§152) kasir tak lagi melihat
# angka tunai selagi shiftnya terbuka. Yang diuji di sini matematika rekapnya.
AK=$(api "$OWNER" GET /shift/aktif)
AK_KASIR=$(api "$KASIR" GET /shift/aktif)
cek "shift aktif (owner): penjualan tunai >= 34000" "V >= 34000" "$(echo "$AK" | jq '.penjualan_tunai')"
cek "shift aktif: non-tunai >= 34000" "V >= 34000" "$(echo "$AK_KASIR" | jq '.penjualan_nontunai')"
cek "shift aktif (owner): kas sistem = modal + tunai" "V == 1" \
  "$(echo "$AK" | jq '(.kas_sistem == (.modal_awal + .penjualan_tunai)) | if . then 1 else 0 end')"
KAS=$(echo "$AK" | jq '.kas_sistem')
TU=$(api "$KASIR" POST /shift/tutup "{\"uang_fisik\":$KAS}")
cek "tutup shift: selisih 0 (uang fisik = kas)" "V == 1" "$(echo "$TU" | jq '(.selisih == 0) | if . then 1 else 0 end')"
cek "tutup shift: ditutup terisi" "V == 1" "$(echo "$TU" | jq '(.ditutup_pada != null) | if . then 1 else 0 end')"
cek "setelah tutup: tak ada shift aktif" "V == 1" "$(api "$KASIR" GET /shift/aktif | jq '(. == null) | if . then 1 else 0 end')"
cek "riwayat shift: ada shift tertutup" "V >= 1" "$(api "$KASIR" GET /shift | jq 'length')"
# ── §186 dua penutupan kasir yang berpapasan ──
#
# `shiftTerbuka()` hanya MEMBACA. Dua penutupan yang berpapasan sama-sama
# menemukan shift yang sama masih terbuka, sama-sama lolos penjaga "hitungan
# sudah dikunci" (keduanya membaca uang_fisik = null), lalu sama-sama menulis.
# Tanpa `closed_at IS NULL` di WHERE, yang kedua MENIMPA yang pertama dan
# keduanya dibalas 200.
#
# Terukur sebelum diperbaiki: nominal 150.000 dan 999.000 dilepas bersamaan →
# DUA-DUANYA 200, dua-duanya berbunyi 999.000. Kasir yang menghitung 150.000
# melihat layar sukses berisi angka orang lain, dan shift tercatat berselisih
# 899.000 alih-alih 50.000 — di layar yang justru dipakai mempertanggungjawabkan
# isi laci.
api "$KASIR" POST /shift/buka '{"modal_awal":100000}' > /dev/null
T186=$(mktemp -d)
for pasangan in "1 150000" "2 999000"; do
  set -- $pasangan
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/shift/tutup" \
    -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' \
    -d "{\"uang_fisik\":$2}" > "$T186/k$1" &
done
wait
# Invarian yang TIDAK bergantung timing: berapa pun urutannya, tepat SATU
# penutupan boleh berhasil. Kode galat yang kalah sengaja tidak dikunci — bila
# yang kedua datang sesudah yang pertama benar-benar selesai, ia gagal karena
# tak ada shift terbuka, bukan karena kalah balapan. Yang haram cuma satu:
# dua-duanya sukses.
cek "§186 tepat SATU penutupan kasir yang berhasil" "V == 1" \
  "$(cat "$T186/k1" "$T186/k2" | grep -c '^200$')"
cek "§186 yang kalah TIDAK dibalas sukses" "V == 1" \
  "$(cat "$T186/k1" "$T186/k2" | awk '$1 >= 400' | wc -l)"
rm -rf "$T186"

# Buka lagi shift agar transaksi kasir di seksi berikutnya (§37+) tetap bisa jalan.
api "$KASIR" POST /shift/buka '{"modal_awal":200000}' > /dev/null
cek "shift dibuka lagi untuk lanjutan" "V == 1" \
  "$(api "$KASIR" GET /shift/aktif | jq '(. != null) | if . then 1 else 0 end')"

echo "== 37. Open bill (simpan, buka, ubah, bayar, hapus) =="
MEJA_OB=$(api "$KASIR" GET /meja | jq -r '[.[] | select(.is_active)][0].id')
OB=$(api "$KASIR" POST /open-bill "{\"meja_id\":\"$MEJA_OB\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":2}]}")
OB_ID=$(echo "$OB" | jq -r .id)
cek "open bill dibuat: 1 baris item" "V == 1" "$(echo "$OB" | jq '.items | length')"
cek "open bill: qty 2" "V == 2" "$(echo "$OB" | jq '.items[0].qty')"
cek "GET /open-bill: bill muncul di list" "V == 1" \
  "$(api "$KASIR" GET /open-bill | jq --arg id "$OB_ID" '[.[] | select(.id == $id)] | length')"
cek "GET /open-bill: jumlah_item = 1" "V == 1" \
  "$(api "$KASIR" GET /open-bill | jq --arg id "$OB_ID" '[.[] | select(.id == $id)][0].jumlah_item')"
OBU=$(api "$KASIR" PUT "/open-bill/$OB_ID" "{\"meja_id\":\"$MEJA_OB\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":2},{\"menu_id\":\"$PYO_ID\",\"qty\":1}]}")
cek "ubah bill: jadi 2 baris item" "V == 2" "$(echo "$OBU" | jq '.items | length')"
# bayar bill: buat sale dari item bill lalu hapus bill (alur Lanjut → Simpan)
SOB=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MEJA_OB\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":2},{\"menu_id\":\"$PYO_ID\",\"qty\":1}]}")
cek "bayar bill: sale dibuat (ada nomor)" "V == 1" "$(echo "$SOB" | jq '(.sale.nomor | length > 0) | if . then 1 else 0 end')"
api "$KASIR" DELETE "/open-bill/$OB_ID" > /dev/null
cek "setelah bayar: bill hilang dari list" "V == 0" \
  "$(api "$KASIR" GET /open-bill | jq --arg id "$OB_ID" '[.[] | select(.id == $id)] | length')"
cek "GET bill terhapus → 404" "V == 404" "$(status_code "$KASIR" GET "/open-bill/$OB_ID")"

echo "== 38. Ketersediaan menu (sisa porsi per bahan terlacak) =="
cek "ketersediaan: status 200 utk kasir" "V == 200" "$(status_code "$KASIR" GET /menu/ketersediaan)"
KET=$(api "$KASIR" GET /menu/ketersediaan)
MENU_ALL=$(api "$KASIR" GET "/menu?semua=true")
STOK=$(api "$KASIR" GET /stok)
cek "ketersediaan: jumlah baris = jumlah menu (aktif+nonaktif)" "V == 1" \
  "$(jq -n --argjson k "$KET" --argjson m "$MENU_ALL" '(($k|length) == ($m|length)) | if . then 1 else 0 end')"
cek "ketersediaan: semua porsi null / bilangan bulat >= 0" "V == 1" \
  "$(echo "$KET" | jq '([.[] | select(.porsi != null) | select((.porsi != (.porsi|floor)) or (.porsi < 0))] | length == 0) | if . then 1 else 0 end')"

# PBA (reguler) — bahan terlacak (baso) membatasi → porsi bukan null
MENU_PBA=$(api "$KASIR" GET "/menu/$PBA_ID")
PBA_PORSI=$(echo "$KET" | jq --arg id "$PBA_ID" '[.[] | select(.menu_id == $id)][0].porsi')
cek "ketersediaan PBA: porsi terlacak (bukan null)" "V == 1" \
  "$(echo "$PBA_PORSI" | jq '(. != null) | if . then 1 else 0 end')"
# cross-check: porsi == min ⌊saldo/qty⌋ atas SEMUA bahan terlacak (termasuk kemasan)
EXP_PBA=$(jq -n --argjson menu "$MENU_PBA" --argjson stok "$STOK" '
  ($stok | map({(.ingredient_id): .saldo}) | add) as $s
  | [ $menu.komponen[]
      | select(.track_stok and (.qty > 0))
      | ($s[.ingredient_id]) as $sal | select($sal != null)
      | ($sal / .qty | floor) ]
  | (if length == 0 then null else (min | if . < 0 then 0 else . end) end)')
cek "ketersediaan PBA: porsi cocok min(saldo/qty) termasuk kemasan" "V == 1" \
  "$(jq -n --argjson a "$PBA_PORSI" --argjson b "$EXP_PBA" '($a == $b) | if . then 1 else 0 end')"

# PYO (paket) — agregasi qty komponen menu sendiri + menu dasar (persis konsumsi)
MENU_PYO=$(api "$KASIR" GET "/menu/$PYO_ID")
BASE_ID=$(echo "$MENU_PYO" | jq -r '.base_menu_id')
MENU_BASE=$(api "$KASIR" GET "/menu/$BASE_ID")
PYO_PORSI=$(echo "$KET" | jq --arg id "$PYO_ID" '[.[] | select(.menu_id == $id)][0].porsi')
EXP_PYO=$(jq -n --argjson own "$MENU_PYO" --argjson base "$MENU_BASE" --argjson stok "$STOK" '
  ($stok | map({(.ingredient_id): .saldo}) | add) as $s
  | (($own.komponen + $base.komponen)
      | map(select(.track_stok and (.qty > 0)))
      | group_by(.ingredient_id)
      | map({ingredient_id: .[0].ingredient_id, qty: (map(.qty) | add)})) as $agg
  | [ $agg[] | ($s[.ingredient_id]) as $sal | select($sal != null) | ($sal / .qty | floor) ]
  | (if length == 0 then null else (min | if . < 0 then 0 else . end) end)')
cek "ketersediaan PYO (paket): cocok agregasi own+dasar" "V == 1" \
  "$(jq -n --argjson a "$PYO_PORSI" --argjson b "$EXP_PYO" '($a == $b) | if . then 1 else 0 end')"

echo "== 39. Absensi karyawan (kode/QR + masuk/keluar auto-detect) =="
# tiap karyawan (membership) dapat kode karyawan otomatis (backfill saat seed)
cek "karyawan punya employee_code" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq '([.[] | select(.employee_code != null)] | length >= 1) | if . then 1 else 0 end')"
# kode karyawan = 8 digit angka acak (backfill boot meng-upgrade kode lama pendek)
cek "employee_code semua 8 digit angka" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq '([.[] | select(.employee_code != null)] | all(.employee_code | test("^[0-9]{8}$"))) | if . then 1 else 0 end')"
# karyawan BARU juga dapat kode 8 digit acak (jalur resolveKodeKaryawan, bukan backfill)
SBR39=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.tipe=="store")][0].id')
NK39=$(api "$OWNER" POST /karyawan "{\"nama\":\"Kode Baru 39\",\"email\":\"kodebaru39@basooopa.id\",\"password\":\"KodeBaru39!\",\"role\":\"cashier\",\"branch_id\":\"$SBR39\"}")
cek "karyawan baru: employee_code 8 digit angka" "V == 1" \
  "$(echo "$NK39" | jq '(.employee_code | test("^[0-9]{8}$")) | if . then 1 else 0 end')"
# Pakai kode kasir BARU (NK39) yang belum punya absensi — kasir seed sudah absen
# masuk di §2b (gerbang buka kasir), jadi auto-detect masuk/keluar-nya sudah "kotor".
KODE_KAR=$(echo "$NK39" | jq -r '.employee_code')
# Absen WAJIB foto (anti-titip). URL bukti dummy (server menyimpan teksnya apa adanya).
FOTO="https://example.com/absen.jpg"
cek "absen tanpa foto ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE_KAR\"}")"
# kasir (semua peran boleh) mengabsen via kode → cap pertama = masuk
A1=$(api "$KASIR" POST /absensi "{\"kode\":\"$KODE_KAR\",\"foto_url\":\"$FOTO\"}")
cek "absen pertama = masuk" "V == 1" "$(echo "$A1" | jq '(.tipe == "masuk") | if . then 1 else 0 end')"
cek "absen mengembalikan nama karyawan" "V == 1" "$(echo "$A1" | jq '(.nama | length > 0) | if . then 1 else 0 end')"
cek "absen mengembalikan waktu (ISO)" "V == 1" "$(echo "$A1" | jq '(.waktu | length > 0) | if . then 1 else 0 end')"
cek "absen mengembalikan foto_url tersimpan" "V == 1" "$(echo "$A1" | jq --arg f "$FOTO" '(.foto_url == $f) | if . then 1 else 0 end')"
# cap berikutnya untuk karyawan yang sama = keluar (auto-detect dari cap terakhir)
A2=$(api "$KASIR" POST /absensi "{\"kode\":\"$KODE_KAR\",\"foto_url\":\"$FOTO\"}")
cek "absen kedua = keluar (auto-detect)" "V == 1" "$(echo "$A2" | jq '(.tipe == "keluar") | if . then 1 else 0 end')"
# kode case-insensitive (huruf kecil tetap dikenali)
A3=$(api "$KASIR" POST /absensi "{\"kode\":\"$(echo "$KODE_KAR" | tr 'A-Z' 'a-z')\",\"foto_url\":\"$FOTO\"}")
cek "kode absensi case-insensitive → masuk lagi" "V == 1" "$(echo "$A3" | jq '(.tipe == "masuk") | if . then 1 else 0 end')"
# daftar absensi hari ini memuat karyawan dengan jam masuk & keluar terisi
LIST=$(api "$KASIR" GET /absensi)
cek "daftar absensi: masuk terisi" "V == 1" \
  "$(echo "$LIST" | jq --arg k "$KODE_KAR" '[.[] | select(.employee_code == $k) | select(.masuk != null)] | length')"
cek "daftar absensi: keluar terisi" "V == 1" \
  "$(echo "$LIST" | jq --arg k "$KODE_KAR" '[.[] | select(.employee_code == $k) | select(.keluar != null)] | length')"
cek "daftar absensi: foto_masuk & foto_keluar tersimpan" "V == 1" \
  "$(echo "$LIST" | jq --arg k "$KODE_KAR" --arg f "$FOTO" '([.[] | select(.employee_code == $k)][0] | (.foto_masuk == $f) and (.foto_keluar == $f)) | if . then 1 else 0 end')"
# kode karyawan tak dikenal → 404 (foto valid agar lolos validasi dulu)
cek "kode karyawan tak dikenal → 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"kode\":\"ZZZNOPE\",\"foto_url\":\"$FOTO\"}")"
# tanggal ngawur pada daftar → 400 (bukan 500)
cek "daftar absensi tanggal invalid → 400" "V == 400" "$(status_code "$KASIR" GET "/absensi?tanggal=abc")"
cek "daftar absensi tanggal di luar rentang → 400" "V == 400" "$(status_code "$KASIR" GET "/absensi?tanggal=2026-13-40")"

echo "== 40. Rencana stok dari menu (preview + faktur otomatis) =="
# ketersediaan kini memuat bahan pembatas (nama+saldo) saat porsi terbatas
KET40=$(api "$KASIR" GET /menu/ketersediaan)
cek "ketersediaan: baris porsi terbatas punya pembatas" "V == 1" \
  "$(echo "$KET40" | jq '(([.[] | select(.porsi != null)] | length > 0) and ([.[] | select(.porsi != null) | select(.pembatas == null or ((.pembatas.nama // "")|length) == 0)] | length == 0)) | if . then 1 else 0 end')"
# preview rencana 500 porsi PBA (pasti melebihi saldo → ada kekurangan)
MENU_PBA40=$(api "$OWNER" GET "/menu/$PBA_ID")
PRV=$(api "$OWNER" POST /rekomendasi/menu "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}]}")
cek "preview: perkiraan omzet = 500 × harga jual" "V == 1" \
  "$(jq -n --argjson p "$PRV" --argjson m "$MENU_PBA40" '($p.perkiraan_omzet == 500 * $m.harga_jual) | if . then 1 else 0 end')"
cek "preview: ada bahan yang dihitung" "V >= 1" "$(echo "$PRV" | jq '.bahan | length')"
# kebutuhan tiap bahan = 500 × Σ qty komponen terlacak menu
cek "preview: kebutuhan = 500 × qty resep (semua baris)" "V == 1" \
  "$(jq -n --argjson p "$PRV" --argjson m "$MENU_PBA40" '
    def ab: if . < 0 then -. else . end;
    ($m.komponen | map(select(.track_stok and .qty > 0)) | group_by(.ingredient_id)
      | map({(.[0].ingredient_id): (map(.qty)|add * 500)}) | add // {}) as $exp
    | ([$p.bahan[] | . as $r | ($exp[$r.ingredient_id]) as $e
        | select($e != null) | select((($r.kebutuhan - $e)|ab) > 0.01)] | length == 0)
    | if . then 1 else 0 end')"
cek "preview: kurang = max(0, kebutuhan − saldo) (semua baris)" "V == 1" \
  "$(echo "$PRV" | jq 'def ab: if . < 0 then -. else . end;
    ([.bahan[] | select(((.kurang - ([0, (.kebutuhan - .saldo)] | max))|ab) > 0.01)] | length == 0) | if . then 1 else 0 end')"
cek "preview: ada kekurangan (produksi/beli)" "V >= 1" \
  "$(echo "$PRV" | jq '.jumlah_produksi + .jumlah_beli')"
cek "preview: baris kurang punya jumlah faktur ≥ kurang" "V == 1" \
  "$(echo "$PRV" | jq '([.bahan[] | select(.kurang > 0) | select(.qty_faktur == null or .qty_faktur < .kurang)] | length == 0) | if . then 1 else 0 end')"
# kasir tidak boleh (rekomendasi = owner/admin)
cek "kasir POST /rekomendasi/menu ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/rekomendasi/menu" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":1}]}")"
# menu tak dikenal → 400
cek "preview menu tak dikenal → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/rekomendasi/menu" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"items":[{"menu_id":"00000000-0000-0000-0000-000000000000","porsi":5}]}')"
# porsi absurd (> batas atas) → 400, bukan 500 numeric overflow
cek "preview porsi melebihi batas → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/rekomendasi/menu" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":5000000000}]}")"
# faktur produksi tanpa pelaksana → 400 (bila ada baris produksi)
if [ "$(echo "$PRV" | jq '.jumlah_produksi')" -gt 0 ]; then
  cek "faktur otomatis tanpa pelaksana → 400" "V == 400" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/rekomendasi/menu/faktur" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}]}")"
fi
# buat faktur otomatis dengan pelaksana karyawan
WORKER40=$(api "$OWNER" GET /karyawan | jq -r '.[0].user_id')
FKT40=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}],\"worker_id\":\"$WORKER40\"}")
cek "faktur otomatis: jalur sesuai preview (produksi)" "V == 1" \
  "$(jq -n --argjson f "$FKT40" --argjson p "$PRV" '((($p.jumlah_produksi > 0) == ($f.produksi != null)) and (($f.produksi == null) or ($f.produksi.jumlah_baris == $p.jumlah_produksi))) | if . then 1 else 0 end')"
cek "faktur otomatis: jalur sesuai preview (beli)" "V == 1" \
  "$(jq -n --argjson f "$FKT40" --argjson p "$PRV" '((($p.jumlah_beli > 0) == ($f.beli != null)) and (($f.beli == null) or ($f.beli.jumlah_baris == $p.jumlah_beli))) | if . then 1 else 0 end')"
# faktur tahap rencana → saldo TIDAK berubah, tapi muncul sbg stok berjalan
KURANG_ID=$(echo "$PRV" | jq -r '[.bahan[] | select(.kurang > 0)][0].ingredient_id')
KURANG_SALDO=$(echo "$PRV" | jq '[.bahan[] | select(.kurang > 0)][0].saldo')
S40=$(api "$OWNER" GET /stok)
cek "saldo bahan kurang tak berubah (masih rencana)" "abs(V - $KURANG_SALDO) < 0.001" \
  "$(echo "$S40" | jq --arg id "$KURANG_ID" '[.[] | select(.ingredient_id == $id)][0].saldo')"
cek "bahan kurang tampil sbg stok berjalan (produksi/beli)" "V == 1" \
  "$(echo "$S40" | jq --arg id "$KURANG_ID" '([.[] | select(.ingredient_id == $id)][0] | ((.produksi_berjalan.qty // 0) + (.pembelian_berjalan.qty // 0)) > 0) | if . then 1 else 0 end')"
echo "== 41. Pembulatan pembelian per kemasan (boleh_eceran) =="
# default: bahan beli TIDAK boleh eceran → dibulatkan per kemasan
BHN41=$(api "$OWNER" GET /bahan)
PLASTIK41_ID=$(echo "$BHN41" | jq -r '[.[] | select(.slug == "plastik take away")][0].id')
cek "bahan beli default boleh_eceran=false" "V == 1" \
  "$(echo "$BHN41" | jq '([.[] | select(.pengadaan == "beli")] | length > 0 and ([.[] | select(.pengadaan == "beli") | select(.boleh_eceran == true)] | length == 0)) | if . then 1 else 0 end')"
# preview rencana: semua baris beli isi>1 yang kurang → mode batch (kemasan), qty = jumlah×isi
PRV41=$(api "$OWNER" POST /rekomendasi/menu "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}]}")
cek "preview: beli isi>1 kurang → mode kemasan (batch)" "V == 1" \
  "$(echo "$PRV41" | jq 'def ab: if . < 0 then -. else . end;
    ([.bahan[] | select(.kurang > 0 and .pengadaan == "beli" and .isi > 1)] | length > 0) and
    ([.bahan[] | select(.kurang > 0 and .pengadaan == "beli" and .isi > 1)
       | select(.mode_faktur != "batch" or (((.qty_faktur // 0) - (.jumlah_faktur // 0) * .isi)|ab) > 0.001)] | length == 0)
    | if . then 1 else 0 end')"
# rekomendasi beli: baris ikut terbulatkan + estimasi dari qty terbulatkan
RK41=$(api "$OWNER" GET "/rekomendasi/beli?acuan=7hari&target=50000000")
cek "rekomendasi: jumlah_faktur = ⌈saran/isi⌉ utk beli isi>1" "V == 1" \
  "$(echo "$RK41" | jq 'def ab: if . < 0 then -. else . end;
    ([.bahan[] | select(.pengadaan == "beli" and .isi > 1 and (.saran_beli // 0) > 0.001)]) as $rows
    | (($rows | length) == 0) or
      ([$rows[] | select(.mode_faktur != "batch" or ((.jumlah_faktur // 0) - ((.saran_beli / .isi) | ceil) | ab) > 0.001
         or (((.estimasi_biaya // 0) - ((.qty_faktur // 0) * .harga_per_unit | round))|ab) > 1)] | length == 0)
    | if . then 1 else 0 end')"
# flip eceran: plastik boleh eceran → preview kembali per pcs
api "$OWNER" PUT "/bahan/$PLASTIK41_ID" '{"boleh_eceran":true}' > /dev/null
cek "PUT bahan boleh_eceran=true tersimpan" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$PLASTIK41_ID" '([.[] | select(.id == $id)][0].boleh_eceran == true) | if . then 1 else 0 end')"
PRV41B=$(api "$OWNER" POST /rekomendasi/menu "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}]}")
cek "eceran: baris plastik kembali mode pcs (⌈kurang⌉)" "V == 1" \
  "$(echo "$PRV41B" | jq --arg id "$PLASTIK41_ID" 'def ab: if . < 0 then -. else . end;
    ([.bahan[] | select(.ingredient_id == $id and .kurang > 0)]) as $r
    | (($r | length) == 0) or ($r[0].mode_faktur == "pcs" and ((($r[0].qty_faktur // 0) - ($r[0].kurang | ceil))|ab) < 0.001)
    | if . then 1 else 0 end')"
# kembalikan ke default agar skrip idempotent
api "$OWNER" PUT "/bahan/$PLASTIK41_ID" '{"boleh_eceran":false}' > /dev/null

echo "== 42. Ubah tahap sebagian (dropdown): split baris + sisa tugas =="
# faktur beli 2 baris: A 10 pcs @50rb, B 8 pcs @40rb
BHN42=$(api "$OWNER" GET /bahan)
ING42A=$(echo "$BHN42" | jq -r '[.[] | select(.pengadaan=="beli" and .track_stok==true)][0].id')
ING42B=$(echo "$BHN42" | jq -r '[.[] | select(.pengadaan=="beli" and .track_stok==true)][1].id')
SA42_0=$(saldo_bahan "$ING42A"); SB42_0=$(saldo_bahan "$ING42B")
FK42=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000},{\"ingredient_id\":\"$ING42B\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}")
FK42_ID=$(echo "$FK42" | jq -r .faktur_id)
baris42() { api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK42_ID" '[.rows[] | select(.faktur_id==$f)]'; }
ID42A=$(baris42 | jq -r --arg i "$ING42A" '[.[] | select(.ingredient_id==$i)][0].id')
ID42B=$(baris42 | jq -r --arg i "$ING42B" '[.[] | select(.ingredient_id==$i)][0].id')

# 1) maju sebagian: hanya baris A (penuh) → dikerjakan; B tetap RAB (sisa tugas)
api "$OWNER" POST "/pembelian/tahap/$FK42_ID" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID42A\",\"qty\":10}]}" > /dev/null
cek "sebagian: baris A maju, baris B tetap rencana" "V == 1" \
  "$(baris42 | jq --arg a "$ID42A" --arg b "$ID42B" '(([.[] | select(.id==$a)][0].status == "dikerjakan") and ([.[] | select(.id==$b)][0].status == "rencana")) | if . then 1 else 0 end')"

# 2) split qty: B maju 3 dari 8 → dua baris (3 dikerjakan + 5 rencana), Σqty & Σharga tetap
api "$OWNER" POST "/pembelian/tahap/$FK42_ID" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID42B\",\"qty\":3}]}" > /dev/null
B42=$(baris42 | jq --arg i "$ING42B" '[.[] | select(.ingredient_id==$i)]')
cek "split: baris B jadi 2" "V == 2" "$(echo "$B42" | jq 'length')"
cek "split: Σqty B tetap 8" "abs(V - 8) < 0.001" "$(echo "$B42" | jq '[.[].qty] | add')"
cek "split: Σharga B tetap 40000" "abs(V - 40000) < 0.5" "$(echo "$B42" | jq '[.[].total_harga] | add')"
cek "split: 3 dikerjakan + 5 rencana" "V == 1" \
  "$(echo "$B42" | jq '((([.[] | select(.status=="dikerjakan")][0].qty // 0) == 3) and (([.[] | select(.status=="rencana")][0].qty // 0) == 5)) | if . then 1 else 0 end')"

# 3) dgn items boleh lompat maju: sisa B (rencana) → menunggu; di cabang sendiri
#    (tanpa tujuan) LANGSUNG masuk stok (dikonfirmasi)
ID42B2=$(echo "$B42" | jq -r '[.[] | select(.status=="rencana")][0].id')
api "$OWNER" POST "/pembelian/tahap/$FK42_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID42B2\",\"qty\":5}]}" > /dev/null
cek "items: lompat rencana→menunggu → langsung masuk stok (dikonfirmasi)" "V == 1" \
  "$(baris42 | jq --arg b "$ID42B2" '([.[] | select(.id==$b)][0].status == "dikonfirmasi") | if . then 1 else 0 end')"

# 4) penjaga: mundur ditolak, qty melebihi ditolak, baris asing ditolak, dikonfirmasi tanpa items ditolak
cek "tahap mundur (menunggu→dikerjakan) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID42B2\",\"qty\":5}]}")"
cek "qty maju 0 → 400 (satu-satunya batas qty)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID42A\",\"qty\":0}]}")"
cek "baris bukan milik faktur → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"menunggu","items":[{"id":"00000000-0000-4000-8000-000000000000","qty":1}]}')"
cek "ke=dikonfirmasi tanpa items → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikonfirmasi"}')"

# 5) konfirmasi SEBAGIAN baris A (4 dari 10) → split + hanya 4 yang masuk saldo
api "$OWNER" POST "/pembelian/tahap/$FK42_ID" "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$ID42A\",\"qty\":4}]}" > /dev/null
SA42_1=$(saldo_bahan "$ING42A"); SB42_1=$(saldo_bahan "$ING42B")
cek "konfirmasi sebagian: saldo A +4 saja" "abs(V - 4) < 0.001" "$(python3 -c "print($SA42_1 - $SA42_0)")"
cek "saldo B +5 (sisa B lompat tadi langsung masuk stok)" "abs(V - 5) < 0.001" "$(python3 -c "print($SB42_1 - $SB42_0)")"
A42=$(baris42 | jq --arg i "$ING42A" '[.[] | select(.ingredient_id==$i)]')
cek "A: 4 dikonfirmasi (harga prorata 20000)" "V == 1" \
  "$(echo "$A42" | jq '([.[] | select(.status=="dikonfirmasi")][0] | (.qty == 4 and .total_harga == 20000)) | if . then 1 else 0 end')"
cek "A: sisa tugas 6 dikerjakan (harga 30000)" "V == 1" \
  "$(echo "$A42" | jq '([.[] | select(.status=="dikerjakan")][0] | (.qty == 6 and .total_harga == 30000)) | if . then 1 else 0 end')"

echo "== 43. Dana cair saat RAB → proses (penuh / sebagian, akumulatif) =="
FK43=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000},{\"ingredient_id\":\"$ING42B\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}")
FK43_ID=$(echo "$FK43" | jq -r .faktur_id)
baris43() { api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK43_ID" '[.rows[] | select(.faktur_id==$f)]'; }
ID43A=$(baris43 | jq -r --arg i "$ING42A" '[.[] | select(.ingredient_id==$i)][0].id')
ID43B=$(baris43 | jq -r --arg i "$ING42B" '[.[] | select(.ingredient_id==$i)][0].id')
# maju A dgn dana cair SEBAGIAN 30000 (dari RAB 50000)
api "$OWNER" POST "/pembelian/tahap/$FK43_ID" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID43A\",\"qty\":10}],\"dana_cair\":30000}" > /dev/null
cek "dana cair 30000 tercatat di faktur" "abs(V - 30000) < 0.5" "$(baris43 | jq '.[0].dana_cair')"
# maju B (split 3) dgn dana 15000 → pencairan DIJUMLAHKAN
api "$OWNER" POST "/pembelian/tahap/$FK43_ID" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID43B\",\"qty\":3}],\"dana_cair\":15000}" > /dev/null
cek "pencairan kedua terakumulasi (45000)" "abs(V - 45000) < 0.5" "$(baris43 | jq '.[0].dana_cair')"
cek "semua baris faktur memuat total dana yang sama" "V == 1" \
  "$(baris43 | jq 'def ab: if . < 0 then -. else . end; ([.[] | select(((.dana_cair - 45000)|ab) > 0.5)] | length == 0) | if . then 1 else 0 end')"
# saldo TIDAK berubah karena dana cair (belum dikonfirmasi)
cek "dana cair tidak menyentuh saldo stok" "abs(V) < 0.001" \
  "$(python3 -c "print($(saldo_bahan "$ING42A") - $SA42_1)")"
# jalur lama (tanpa items) juga bisa mencatat dana
FK43C=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":25000}]}")
FK43C_ID=$(echo "$FK43C" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK43C_ID" '{"ke":"dikerjakan","dana_cair":12345}' > /dev/null
cek "jalur lama: dana cair 12345 tercatat" "abs(V - 12345) < 0.5" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK43C_ID" '[.rows[] | select(.faktur_id==$f)][0].dana_cair')"
# dana negatif ditolak validasi
cek "dana cair negatif → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK43C_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"menunggu","dana_cair":-1}')"
# faktur tanpa pencairan → 0
cek "faktur tanpa pencairan → dana_cair 0" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK42_ID" '[.rows[] | select(.faktur_id==$f)][0].dana_cair')"

echo "== 44. Realisasi selesai: sesuai rencana / kurang (tambahan) / lebih (kembali) =="
# A) realisasi LEBIH BESAR dari dana → entri 'tambahan' (dari mana uangnya)
FK44=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000},{\"ingredient_id\":\"$ING42B\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}")
FK44_ID=$(echo "$FK44" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK44_ID" '{"ke":"dikerjakan","dana_cair":90000}' > /dev/null
ID44A=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK44_ID" --arg i "$ING42A" '[.rows[] | select(.faktur_id==$f and .ingredient_id==$i)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FK44_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID44A\",\"qty\":10}],\"realisasi\":100000,\"selisih_catatan\":\"talangan kasir Budi\"}" > /dev/null
DANA44=$(api "$OWNER" GET "/pembelian/dana/$FK44_ID")
cek "kurang uang → entri 'tambahan' 10000 dgn catatan sumber" "V == 1" \
  "$(echo "$DANA44" | jq '([.rows[] | select(.tipe=="tambahan" and .nominal==10000 and .catatan=="talangan kasir Budi")] | length == 1) | if . then 1 else 0 end')"
cek "dana efektif = realisasi (100000)" "abs(V - 100000) < 0.5" "$(echo "$DANA44" | jq .total)"
cek "item belum semua → A masuk stok, B masih diproses (selesai sebagian)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK44_ID" '([.rows[] | select(.faktur_id==$f)] | ([.[] | select(.status=="dikonfirmasi")] | length == 1) and ([.[] | select(.status=="dikerjakan")] | length == 1)) | if . then 1 else 0 end')"

# B) realisasi LEBIH KECIL → entri 'kembali' (di siapa sisa uangnya)
FK44B=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000}]}")
FK44B_ID=$(echo "$FK44B" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK44B_ID" '{"ke":"dikerjakan","dana_cair":50000}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FK44B_ID" '{"ke":"menunggu","realisasi":42000,"selisih_catatan":"sisa dipegang Budi"}' > /dev/null
DANA44B=$(api "$OWNER" GET "/pembelian/dana/$FK44B_ID")
cek "lebih uang → entri 'kembali' 8000 dgn catatan pemegang" "V == 1" \
  "$(echo "$DANA44B" | jq '([.rows[] | select(.tipe=="kembali" and .nominal==8000 and .catatan=="sisa dipegang Budi")] | length == 1) | if . then 1 else 0 end')"
cek "dana efektif turun ke realisasi (42000)" "abs(V - 42000) < 0.5" "$(echo "$DANA44B" | jq .total)"
cek "list: dana_cair efektif ikut turun (42000)" "abs(V - 42000) < 0.5" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK44B_ID" '[.rows[] | select(.faktur_id==$f)][0].dana_cair')"

# C) realisasi PAS → tidak ada entri selisih (sesuai rencana)
FK44C=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":25000}]}")
FK44C_ID=$(echo "$FK44C" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK44C_ID" '{"ke":"dikerjakan","dana_cair":25000}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FK44C_ID" '{"ke":"menunggu","realisasi":25000}' > /dev/null
cek "sesuai rencana → hanya 1 entri (cair), tanpa selisih" "V == 1" \
  "$(api "$OWNER" GET "/pembelian/dana/$FK44C_ID" | jq '((.rows | length) == 1 and .rows[0].tipe == "cair" and (.total == 25000)) | if . then 1 else 0 end')"

# D) penjaga: buku dana faktur tak dikenal → 404
cek "GET dana faktur tak dikenal → 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/pembelian/dana/00000000-0000-4000-8000-000000000000" -H "Authorization: Bearer $OWNER")"

echo "== 45. Harga riil per bahan saat proses → selesai (pasar naik/turun) =="
# A) harga naik: baris maju penuh dgn harga riil 55000 (RAB 50000)
FK45=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000}]}")
FK45_ID=$(echo "$FK45" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK45_ID" '{"ke":"dikerjakan","dana_cair":50000}' > /dev/null
ID45=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK45_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FK45_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID45\",\"qty\":10,\"harga\":55000}],\"realisasi\":55000,\"selisih_catatan\":\"harga pasar naik — talangan kas\"}" > /dev/null
B45=$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK45_ID" '[.rows[] | select(.faktur_id==$f)][0]')
cek "harga baris ter-update ke riil (55000) & masuk stok" "V == 1" \
  "$(echo "$B45" | jq '((.total_harga == 55000) and (.status == "dikonfirmasi")) | if . then 1 else 0 end')"
cek "selisih harga naik → dana tambahan 5000" "V == 1" \
  "$(api "$OWNER" GET "/pembelian/dana/$FK45_ID" | jq '(([.rows[] | select(.tipe=="tambahan" and .nominal==5000)] | length == 1) and .total == 55000) | if . then 1 else 0 end')"

# B) split dgn harga riil: 3 dari 8 maju seharga 18000; sisa tetap prorata RAB
FK45B=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42B\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}")
FK45B_ID=$(echo "$FK45B" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK45B_ID" '{"ke":"dikerjakan","dana_cair":40000}' > /dev/null
ID45B=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK45B_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FK45B_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID45B\",\"qty\":3,\"harga\":18000}]}" > /dev/null
B45B=$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK45B_ID" '[.rows[] | select(.faktur_id==$f)]')
cek "split: bagian maju pakai harga riil (3 pcs / 18000)" "V == 1" \
  "$(echo "$B45B" | jq '([.[] | select(.status=="dikonfirmasi")][0] | (.qty == 3 and .total_harga == 18000)) | if . then 1 else 0 end')"
cek "split: sisa tugas tetap prorata RAB (5 pcs / 25000)" "V == 1" \
  "$(echo "$B45B" | jq '([.[] | select(.status=="dikerjakan")][0] | (.qty == 5 and .total_harga == 25000)) | if . then 1 else 0 end')"

# C) harga negatif ditolak validasi
cek "harga riil negatif → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK45B_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$ID45B\",\"qty\":1,\"harga\":-5}]}")"

echo "== 46. Dikirim ke mana: cabang & tempat penyimpanan tujuan =="
# Seed = 1 cabang → mode lite; §46+ butuh multi-lokasi → upgrade Pro oleh owner
# (memprovisikan Central Kitchen + Cabang 2 + Kantor otomatis).
cek "perusahaan seed: mode awal lite" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.mode == "lite") | if . then 1 else 0 end')"
cek "mode Lite: tambah cabang → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"Cabang Uji 46"}')"
UP46=$(api "$OWNER" POST /company/mode '{"mode":"pro"}')
cek "upgrade Pro: 3 lokasi baru diprovisikan" "V == 3" "$(echo "$UP46" | jq '.lokasi_baru | length')"
cek "provisioning: ada central_kitchen & tepat 1 kantor" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq '((([.[] | select(.tipe=="central_kitchen")] | length) >= 1) and (([.[] | select(.tipe=="kantor")] | length) == 1)) | if . then 1 else 0 end')"

CB46_ID=$(api "$OWNER" POST /cabang '{"nama":"Cabang Uji 46"}' | jq -r .id)
# kasir cabang CB46 (transaksi POS = kasir-saja, terkunci di cabangnya) — dipakai
# untuk uji jual/menu-terbatas lintas cabang & data penjualan kantor (§51/§60).
api "$OWNER" POST /karyawan "{\"nama\":\"Kasir 46\",\"email\":\"kasir46@basooopa.id\",\"password\":\"Kasir46Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB46_ID\"}" > /dev/null
KASIR46=$(login "kasir46@basooopa.id" "Kasir46Pass!")
# Kasir CB46 absen masuk + buka kasir (gate shift) agar bisa transaksi di §51/§60
# (CB46 tanpa geofence → absen tanpa GPS). Shift tetap terbuka sampai akhir skrip.
api "$KASIR46" POST /absensi/saya '{"foto_url":"https://example.com/absen.jpg"}' > /dev/null
api "$KASIR46" POST /shift/buka '{"modal_awal":100000}' > /dev/null
GD46_ID=$(api "$OWNER" POST /penyimpanan "{\"nama\":\"Gudang 46\",\"branch_id\":\"$CB46_ID\"}" | jq -r .id)
PUSAT46_ID=$(api "$OWNER" GET /cabang | jq -r --arg x "$CB46_ID" '[.[] | select(.id != $x)][0].id')
GD46P_ID=$(api "$OWNER" POST /penyimpanan "{\"nama\":\"Gudang 46P\",\"branch_id\":\"$PUSAT46_ID\"}" | jq -r .id)

FK46=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$PUSAT46_ID\",\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000},{\"ingredient_id\":\"$ING42B\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}")
FK46_ID=$(echo "$FK46" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK46_ID" '{"ke":"dikerjakan","dana_cair":90000}' > /dev/null
ID46A=$(api "$OWNER" GET "/pembelian?branch_id=$PUSAT46_ID&per_page=500" | jq -r --arg f "$FK46_ID" --arg i "$ING42A" '[.rows[] | select(.faktur_id==$f and .ingredient_id==$i)][0].id')
ID46B=$(api "$OWNER" GET "/pembelian?branch_id=$PUSAT46_ID&per_page=500" | jq -r --arg f "$FK46_ID" --arg i "$ING42B" '[.rows[] | select(.faktur_id==$f and .ingredient_id==$i)][0].id')

# kirim baris A ke cabang tujuan + gudang tujuan
api "$OWNER" POST "/pembelian/tahap/$FK46_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID46A\",\"qty\":10}],\"tujuan_branch_id\":\"$CB46_ID\",\"tujuan_storage_id\":\"$GD46_ID\"}" > /dev/null
cek "baris terkirim tampil di cabang tujuan + gudang tujuan" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FK46_ID" '([.rows[] | select(.faktur_id==$f)] | (length == 1) and (.[0].status == "menunggu") and (.[0].tempat == "Gudang 46")) | if . then 1 else 0 end')"
cek "cabang asal: sisa tugas B diproses + jejak baris terkirim tetap terlihat" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$PUSAT46_ID&per_page=500" | jq --arg f "$FK46_ID" --arg p "$PUSAT46_ID" '([.rows[] | select(.faktur_id==$f)] | (length == 2) and (([.[] | select(.status=="dikerjakan" and .branch_id==$p)] | length) == 1)) | if . then 1 else 0 end')"

# ALAMAT IKUT LOKASI: sesudah dikirim, baris ada DI cabang tujuan DAN
# beralamat ke situ — syarat mutlak agar gerbang Penerimaan mengenalinya.
cek "dikirim: posisi = alamat (kardus & alamatnya berpindah bersama)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FK46_ID" --arg c "$CB46_ID" '([.rows[] | select(.faktur_id==$f)][0] | (.branch_id == $c and .tujuan_branch_id == $c)) | if . then 1 else 0 end')"
cek "kiriman MUNCUL di layar Penerimaan cabang tujuan" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$FK46_ID" '[.rows[] | select(.faktur_id==$f)] | length')"

# PENGAMAN: barang beralamat TIDAK bisa dituntaskan sepihak oleh pengirimnya —
# harus lewat Penerimaan di cabang tujuan (409, bukan 404: fakturnya ADA).
S46_0=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$ING42A" '([.[] | select(.ingredient_id==$i)][0].saldo) // 0')
cek "PENGAMAN: konfirmasi sepihak kiriman beralamat → 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/konfirmasi/$FK46_ID" -H "Authorization: Bearer $OWNER")"
cek "ditolak konfirmasi → saldo cabang tujuan BELUM bergerak" "abs(V - $S46_0) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$ING42A" '([.[] | select(.ingredient_id==$i)][0].saldo) // 0')"

# sebelum diterima, faktur ini BELUM boleh ada di riwayat penerimaan
cek "belum diterima: belum tercatat di riwayat penerimaan" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan/riwayat?branch_id=$CB46_ID" | jq --arg f "$FK46_ID" '[.rows[]|select(.faktur_id==$f)] | length')"

# baru sesudah DITERIMA di cabang → stok masuk di cabang TUJUAN
api "$OWNER" POST "/penerimaan/$FK46_ID/terima" > /dev/null
S46_1=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$ING42A" '([.[] | select(.ingredient_id==$i)][0].saldo) // 0')
cek "diterima di cabang → saldo bertambah di cabang tujuan (+10)" "abs(V - 10) < 0.001" "$(python3 -c "print($S46_1 - $S46_0)")"

# RIWAYAT PENERIMAAN — jejak yang dulu hilang begitu kiriman diterima.
R46=$(api "$OWNER" GET "/penerimaan/riwayat?branch_id=$CB46_ID" | jq --arg f "$FK46_ID" '[.rows[]|select(.faktur_id==$f)][0]')
cek "sesudah diterima: MASUK riwayat penerimaan (per faktur)" "V == 1" \
  "$(echo "$R46" | jq '(. != null) | if . then 1 else 0 end')"
cek "riwayat: hasilnya 'diterima' (utuh, tak ada yang kurang)" "V == 1" \
  "$(echo "$R46" | jq '(.hasil == "diterima") | if . then 1 else 0 end')"
cek "riwayat: mencatat SIAPA yang menerima" "V == 1" \
  "$(echo "$R46" | jq '((.oleh | type) == "string") | if . then 1 else 0 end')"
cek "riwayat: satu entri memuat barangnya (1 item, qty 10)" "V == 1" \
  "$(echo "$R46" | jq '((.jumlah_item == 1) and (.items[0].qty == 10)) | if . then 1 else 0 end')"
cek "riwayat: membawa nomor faktur utk dicocokkan" "V == 1" \
  "$(echo "$R46" | jq '((.nomor | type) == "string") | if . then 1 else 0 end')"
# Baris SISA faktur yang sama (ID46B, masih 'dikerjakan') TIDAK boleh ikut —
# riwayat hanya memuat yang benar-benar sudah diputuskan orang cabang. Itu
# sudah dibuktikan oleh jumlah_item == 1 di atas.
cek "riwayat urut dari penerimaan TERBARU" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan/riwayat?branch_id=all" | jq '([.rows[].waktu] | . == (sort | reverse)) | if . then 1 else 0 end')"
cek "riwayat: halaman & total terisi" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan/riwayat?branch_id=$CB46_ID" | jq '((.page == 1) and (.total >= 1) and (.per_page > 0)) | if . then 1 else 0 end')"
cek "riwayat: saringan tanggal jauh di masa lalu → kosong" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan/riwayat?branch_id=$CB46_ID&dari=2000-01-01&sampai=2000-12-31" | jq '.rows | length')"
cek "riwayat boleh dibaca peran terkunci cabang (kasir) → 200" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/penerimaan/riwayat" -H "Authorization: Bearer $KASIR")"

# penjaga: tempat bukan milik cabang tujuan → 400
cek "tempat bukan milik cabang tujuan → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK46_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID46B\",\"qty\":8}],\"tujuan_branch_id\":\"$CB46_ID\",\"tujuan_storage_id\":\"$GD46P_ID\"}")"

echo "== 47. Jenis cabang: store vs central kitchen =="
CK47_ID=$(api "$OWNER" POST /cabang '{"nama":"Central Kitchen 47","tipe":"central_kitchen"}' | jq -r .id)
cek "cabang central kitchen tercipta dgn tipe benar" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$CK47_ID" '([.[] | select(.id == $id)][0].tipe == "central_kitchen") | if . then 1 else 0 end')"
cek "cabang tanpa tipe → default store" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$CB46_ID" '([.[] | select(.id == $id)][0].tipe == "store") | if . then 1 else 0 end')"
api "$OWNER" PATCH "/cabang/$CK47_ID" '{"tipe":"store"}' > /dev/null
cek "PATCH tipe cabang tersimpan" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$CK47_ID" '([.[] | select(.id == $id)][0].tipe == "store") | if . then 1 else 0 end')"
api "$OWNER" PATCH "/cabang/$CK47_ID" '{"tipe":"central_kitchen"}' > /dev/null
cek "tipe cabang tak dikenal → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"X47","tipe":"gudang"}')"

echo "== 48. Profil: identitas + kode absen sendiri + ganti password =="
PRF48=$(api "$OWNER" GET /profil)
cek "profil owner: email & role benar" "V == 1" \
  "$(echo "$PRF48" | jq --arg e "$OWNER_EMAIL" '((.email == $e) and (.role == "owner") and ((.nama | length) > 0)) | if . then 1 else 0 end')"
cek "profil owner: kode karyawan (QR absen) = 8 digit angka" "V == 1" \
  "$(echo "$PRF48" | jq '((.employee_code != null) and (.employee_code | test("^[0-9]{8}$"))) | if . then 1 else 0 end')"
cek "ganti password: password lama salah → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/profil/password" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"password_lama":"salah-total","password_baru":"PasswordBaru1"}')"
cek "ganti password: baru < 8 karakter → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/profil/password" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"password_lama\":\"$OWNER_PASS\",\"password_baru\":\"abc\"}")"

# alur penuh dgn karyawan uji: buat → login → lihat profil → ganti → login ulang
api "$OWNER" POST /karyawan "{\"nama\":\"Karyawan Profil 48\",\"email\":\"profil48@basooopa.id\",\"password\":\"PwLama48!\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT46_ID\"}" > /dev/null
TK48=$(login "profil48@basooopa.id" "PwLama48!")
cek "karyawan uji bisa login" "V == 1" "$([ -n "$TK48" ] && echo 1 || echo 0)"
cek "profil kasir: kode absen otomatis ada" "V == 1" \
  "$(api "$TK48" GET /profil | jq '((.role == "cashier") and (.employee_code != null) and (.cabang != null)) | if . then 1 else 0 end')"
api "$TK48" POST /profil/password '{"password_lama":"PwLama48!","password_baru":"PwBaru48!"}' > /dev/null
TK48B=$(login "profil48@basooopa.id" "PwBaru48!")
cek "login dgn password BARU berhasil" "V == 1" "$([ -n "$TK48B" ] && echo 1 || echo 0)"
cek "login dgn password LAMA → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"profil48@basooopa.id","password":"PwLama48!"}')"

echo "== 49. Jejak ubah tahap (log faktur) + aktivitas per karyawan =="
FK49=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":25000}]}")
FK49_ID=$(echo "$FK49" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK49_ID" '{"ke":"dikerjakan","dana_cair":20000}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FK49_ID" '{"ke":"menunggu","realisasi":25000,"selisih_catatan":"kas toko"}' > /dev/null
LOG49=$(api "$OWNER" GET "/pembelian/log/$FK49_ID")
cek "log faktur: 3 kegiatan (dibuat→diproses→tiba di cabang/masuk stok)" "V == 3" "$(echo "$LOG49" | jq '.rows | length')"
cek "log: entri pertama 'Faktur dibuat' + ada pelakunya" "V == 1" \
  "$(echo "$LOG49" | jq '((.rows[0].aksi | test("dibuat")) and (.rows[0].oleh != null)) | if . then 1 else 0 end')"
cek "log: dana cair & realisasi tercatat di detail" "V == 1" \
  "$(echo "$LOG49" | jq '(([.rows[] | select((.detail // "") | test("dana cair"))] | length >= 1) and ([.rows[] | select((.detail // "") | test("realisasi"))] | length >= 1)) | if . then 1 else 0 end')"
OWN49_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
cek "aktivitas per karyawan memuat kegiatan faktur ini" "V == 1" \
  "$(api "$OWNER" GET "/karyawan/$OWN49_ID/aktivitas" | jq --arg f "$FK49_ID" '([.rows[] | select(.faktur_id == $f)] | length >= 3) | if . then 1 else 0 end')"
cek "aktivitas saya (/profil/aktivitas) ikut memuat" "V == 1" \
  "$(api "$OWNER" GET /profil/aktivitas | jq --arg f "$FK49_ID" '([.rows[] | select(.faktur_id == $f)] | length >= 1) | if . then 1 else 0 end')"
cek "kasir akses aktivitas karyawan lain → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/karyawan/$OWN49_ID/aktivitas" -H "Authorization: Bearer $KASIR")"
cek "log faktur tak dikenal → 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/pembelian/log/00000000-0000-4000-8000-000000000000" -H "Authorization: Bearer $OWNER")"

echo "== 50. Mode Lite vs Pro: tenant baru, provisioning, downgrade, guard kantor =="
api "$SA" POST /admin/tenants '{"nama":"Toko Mode 50","owner_nama":"Owner 50","owner_email":"mode50@example.com","owner_password":"Mode50Pass!"}' > /dev/null
OWN50=$(login "mode50@example.com" "Mode50Pass!")
cek "tenant baru: mode lite bawaan" "V == 1" \
  "$(api "$OWN50" GET /company | jq '(.mode == "lite") | if . then 1 else 0 end')"
cek "mode Lite: cabang kedua → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $OWN50" -H 'Content-Type: application/json' -d '{"nama":"Cabang 50B"}')"

CAB50_ID=$(api "$OWN50" GET /cabang | jq -r '.[0].id')
api "$OWN50" POST /karyawan "{\"nama\":\"Kasir 50\",\"email\":\"kasir50@example.com\",\"password\":\"Kasir50Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CAB50_ID\"}" > /dev/null
K50=$(login "kasir50@example.com" "Kasir50Pass!")
cek "kasir ubah mode → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/company/mode" -H "Authorization: Bearer $K50" -H 'Content-Type: application/json' -d '{"mode":"pro"}')"

UP50=$(api "$OWN50" POST /company/mode '{"mode":"pro"}')
cek "upgrade owner: 3 lokasi baru (CK + Cabang 2 + Kantor)" "V == 3" "$(echo "$UP50" | jq '.lokasi_baru | length')"
cek "total 4 lokasi: 1 CK + 2 store + 1 kantor" "V == 1" \
  "$(api "$OWN50" GET /cabang | jq '((length == 4) and (([.[] | select(.tipe=="central_kitchen")] | length) == 1) and (([.[] | select(.tipe=="store")] | length) == 2) and (([.[] | select(.tipe=="kantor")] | length) == 1)) | if . then 1 else 0 end')"
CAB50B_ID=$(api "$OWN50" GET /cabang | jq -r '[.[] | select(.nama=="Cabang 2")][0].id')
cek "Cabang 2 (store baru): 2 meja bawaan" "V == 2" \
  "$(api "$OWN50" GET "/meja?branch_id=$CAB50B_ID" | jq 'length')"
KANTOR50_ID=$(api "$OWN50" GET /cabang | jq -r '[.[] | select(.tipe=="kantor")][0].id')
cek "kantor: tanpa meja (bukan lokasi jualan)" "V == 0" \
  "$(api "$OWN50" GET "/meja?branch_id=$KANTOR50_ID" | jq 'length')"
api "$OWN50" POST /company/mode '{"mode":"pro"}' > /dev/null
cek "upgrade ulang idempoten (tetap 4 lokasi)" "V == 4" "$(api "$OWN50" GET /cabang | jq 'length')"

cek "downgrade dgn >1 cabang aktif → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/company/mode" -H "Authorization: Bearer $OWN50" -H 'Content-Type: application/json' -d '{"mode":"lite"}')"
for CID in $(api "$OWN50" GET /cabang | jq -r --arg x "$CAB50_ID" '.[] | select(.id != $x) | .id'); do
  api "$OWN50" PATCH "/cabang/$CID" '{"is_active":false}' > /dev/null
done
api "$OWN50" POST /company/mode '{"mode":"lite"}' > /dev/null
cek "downgrade sukses setelah sisakan 1 cabang aktif" "V == 1" \
  "$(api "$OWN50" GET /company | jq '(.mode == "lite") | if . then 1 else 0 end')"

# Kantor bukan tujuan kirim barang — pakai perusahaan seed (Pro sejak §46)
KANTOR_ID=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.tipe=="kantor")][0].id')
FK50=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":4,\"total_harga\":20000}]}")
FK50_ID=$(echo "$FK50" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK50_ID" '{"ke":"dikerjakan","dana_cair":20000}' > /dev/null
ID50=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK50_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
cek "tujuan kirim ke kantor → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK50_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID50\",\"qty\":4}],\"tujuan_branch_id\":\"$KANTOR_ID\"}")"
cek "menu dgn lokasi kantor → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/menu" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"nama\":\"Menu Kantor 50\",\"category_id\":\"$(api "$OWNER" GET /kategori | jq -r '.[0].id')\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":10000,\"branch_ids\":[\"$KANTOR_ID\"]}")"

echo "== 51. Menu per lokasi (Pro): batasi menu ke cabang tertentu =="
PUSAT51_ID=$(api "$OWNER" GET /cabang | jq -r '.[0].id')
M51=$(api "$OWNER" GET "/menu/$PBA_ID")
PUT51=$(echo "$M51" | jq --arg b "$PUSAT51_ID" '{nama, kode, category_id, tipe, mult, base_menu_id, base_mult, harga_jual, image_url, is_active, komponen: [.komponen[] | {ingredient_id, qty}], branch_ids: [$b]}')
api "$OWNER" PUT "/menu/$PBA_ID" "$PUT51" > /dev/null
cek "menu dibatasi: branch_ids tersimpan" "V == 1" \
  "$(api "$OWNER" GET "/menu/$PBA_ID" | jq --arg b "$PUSAT51_ID" '(.branch_ids == [$b]) | if . then 1 else 0 end')"
cek "katalog manajemen (tanpa filter) tetap memuat menu" "V == 1" \
  "$(api "$OWNER" GET /menu | jq --arg id "$PBA_ID" '([.[] | select(.id==$id)] | length == 1) | if . then 1 else 0 end')"
cek "daftar menu cabang lain (?branch_id=) TIDAK memuat" "V == 0" \
  "$(api "$OWNER" GET "/menu?branch_id=$CB46_ID" | jq --arg id "$PBA_ID" '[.[] | select(.id==$id)] | length')"
cek "kasir (cabang Pusat) tetap melihat menu" "V == 1" \
  "$(api "$KASIR" GET /menu | jq --arg id "$PBA_ID" '([.[] | select(.id==$id)] | length == 1) | if . then 1 else 0 end')"
cek "ketersediaan cabang lain tak memuat menu" "V == 0" \
  "$(api "$OWNER" GET "/menu/ketersediaan?branch_id=$CB46_ID" | jq --arg id "$PBA_ID" '[.[] | select(.menu_id==$id)] | length')"
# kasir CB46 jual menu yang dibatasi ke Pusat → 400 (menu tak tersedia di cabangnya)
cek "kasir CB46 jual menu terbatas → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $KASIR46" -H 'Content-Type: application/json' -d "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "kasir CB46 open bill menu terbatas → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/open-bill" -H "Authorization: Bearer $KASIR46" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "rencana menu di cabang lain → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/rekomendasi/menu?branch_id=$CB46_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":5}]}")"
cek "jual di cabang sendiri (Pusat) tetap OK" "V == 1" \
  "$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" | jq '(.sale.id != null) | if . then 1 else 0 end')"

# pulihkan: branch_ids null → menu kembali tampil di semua lokasi
PUT51B=$(echo "$M51" | jq '{nama, kode, category_id, tipe, mult, base_menu_id, base_mult, harga_jual, image_url, is_active, komponen: [.komponen[] | {ingredient_id, qty}], branch_ids: null}')
api "$OWNER" PUT "/menu/$PBA_ID" "$PUT51B" > /dev/null
cek "branch_ids null → menu kembali tampil di semua cabang" "V == 1" \
  "$(api "$OWNER" GET "/menu?branch_id=$CB46_ID" | jq --arg id "$PBA_ID" '([.[] | select(.id==$id)] | length == 1) | if . then 1 else 0 end')"

echo "== 52. Cabang store terhubung ke SATU central kitchen =="
CK52_UTAMA=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.nama=="Central Kitchen")][0].id')
cek "provisioning: store lama (Pusat) tertaut ke CK" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg ck "$CK52_UTAMA" '([.[] | select(.nama=="Pusat")][0].central_kitchen_id == $ck) | if . then 1 else 0 end')"
cek "store baru auto-tertaut saat CK hanya satu (Cabang Uji 46)" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg ck "$CK52_UTAMA" --arg id "$CB46_ID" '([.[] | select(.id==$id)][0].central_kitchen_id == $ck) | if . then 1 else 0 end')"
# Central kitchen bukan POS/kasir → tak boleh jadi lokasi tampil menu
cek "menu dgn lokasi central kitchen → 400 (CK bukan POS)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/menu" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"nama\":\"Menu CK 52\",\"category_id\":\"$(api "$OWNER" GET /kategori | jq -r '.[0].id')\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":10000,\"branch_ids\":[\"$CK52_UTAMA\"]}")"

# kini ada 2 CK (Central Kitchen + Central Kitchen 47) → wajib memilih pemasok
cek "dua CK: store baru tanpa pilih pemasok → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"Store 52"}')"
ST52_ID=$(api "$OWNER" POST /cabang "{\"nama\":\"Store 52\",\"central_kitchen_id\":\"$CK47_ID\"}" | jq -r .id)
cek "store baru tertaut ke CK pilihan (CK47)" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg ck "$CK47_ID" --arg id "$ST52_ID" '([.[] | select(.id==$id)][0].central_kitchen_id == $ck) | if . then 1 else 0 end')"
cek "pemasok bukan CK (store) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"nama\":\"Store 52X\",\"central_kitchen_id\":\"$CB46_ID\"}")"
cek "kantor dgn pemasok CK → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cabang" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"nama\":\"Kantor 52\",\"tipe\":\"kantor\",\"central_kitchen_id\":\"$CK47_ID\"}")"

# pindah pemasok via PATCH lalu kembalikan
api "$OWNER" PATCH "/cabang/$CB46_ID" "{\"central_kitchen_id\":\"$CK47_ID\"}" > /dev/null
cek "pindah pemasok via PATCH tersimpan" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg ck "$CK47_ID" --arg id "$CB46_ID" '([.[] | select(.id==$id)][0].central_kitchen_id == $ck) | if . then 1 else 0 end')"
api "$OWNER" PATCH "/cabang/$CB46_ID" "{\"central_kitchen_id\":\"$CK52_UTAMA\"}" > /dev/null

# arah kirim: CK hanya boleh mengirim ke store yang tertaut dengannya
FK52=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK47_ID\",\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":6,\"total_harga\":30000}]}")
FK52_ID=$(echo "$FK52" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK52_ID" '{"ke":"dikerjakan","dana_cair":30000}' > /dev/null
ID52=$(api "$OWNER" GET "/pembelian?branch_id=$CK47_ID&per_page=500" | jq -r --arg f "$FK52_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
cek "CK47 kirim ke store milik CK lain → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK52_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID52\",\"qty\":6}],\"tujuan_branch_id\":\"$CB46_ID\"}")"
api "$OWNER" POST "/pembelian/tahap/$FK52_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID52\",\"qty\":6}],\"tujuan_branch_id\":\"$ST52_ID\"}" > /dev/null
cek "CK47 kirim ke store miliknya → baris pindah ke tujuan" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$ST52_ID&per_page=500" | jq --arg f "$FK52_ID" '([.rows[] | select(.faktur_id==$f)] | (length == 1) and (.[0].status == "menunggu")) | if . then 1 else 0 end')"

echo "== 52b. Kiriman CK→cabang WAJIB diterima (terima-sebagian / tolak / batal / batas qty) =="
# Mode Pro: barang DIKIRIM dari CK ke cabang → wajib DITERIMA di cabang (penerimaan);
# beda dgn beli di cabang sendiri yang langsung masuk stok (§25/§26).
PUSAT52B=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.nama=="Pusat")][0].id')
BELI52B=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.pengadaan == "beli" and .track_stok == true)][0].id')
saldo_pusat() { api "$OWNER" GET "/stok?branch_id=$PUSAT52B" | jq --arg id "$1" '([.[] | select(.ingredient_id==$id)][0].saldo) // 0'; }
S52B=$(saldo_pusat "$BELI52B")   # saldo di Pusat (penerima)
ck_row() { api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq -r --arg f "$1" '[.rows[] | select(.faktur_id==$f)][0].id'; }
kirim52b() { # <faktur> <row> <qty> — beli di CK → dikirim ke Pusat (jadi kiriman)
  api "$OWNER" POST "/pembelian/tahap/$1" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$1" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$2\",\"qty\":$3}],\"tujuan_branch_id\":\"$PUSAT52B\"}" > /dev/null
}

# A) kirim (pesan 10) → batas qty ditolak → terima SEBAGIAN 6 (prorata harga)
FA52=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BELI52B\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":1000}]}")
FA52_ID=$(echo "$FA52" | jq -r .faktur_id)
cek "kiriman rencana belum tampil di /penerimaan" "V == 0" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FA52_ID" '[.rows[]|select(.faktur_id==$f)]|length')"
RA52=$(ck_row "$FA52_ID")   # id baris (pindah ke Pusat dgn id sama, qty penuh)
kirim52b "$FA52_ID" "$RA52" 10
cek "kasir: kiriman dikirim tampil di /penerimaan" "V == 1" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FA52_ID" '[.rows[]|select(.faktur_id==$f)]|length')"
cek "saldo Pusat belum berubah saat dikirim" "abs(V - $S52B) < 0.001" "$(saldo_pusat "$BELI52B")"
cek "terima-sebagian qty>dikirim ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FA52_ID/terima-sebagian" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$RA52\",\"qty_diterima\":999}]}")"
cek "kasir terima-sebagian 6 ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FA52_ID/terima-sebagian" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$RA52\",\"qty_diterima\":6}]}")"
cek "saldo +6 (bukan +10) setelah terima sebagian" "abs(V - ($S52B + 6)) < 0.001" "$(saldo_pusat "$BELI52B")"
cek "baris: qty=6, dipesan=10, harga prorata 600, dikonfirmasi" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FA52_ID" '([.rows[]|select(.faktur_id==$f)][0] | (.qty==6 and .qty_dipesan==10 and .total_harga==600 and .status=="dikonfirmasi")) | if . then 1 else 0 end')"

# B) TOLAK (alasan) → batal-tolak (salah cek) → masuk stok
FB52=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BELI52B\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":500}]}")
FB52_ID=$(echo "$FB52" | jq -r .faktur_id)
kirim52b "$FB52_ID" "$(ck_row "$FB52_ID")" 5
S52B2=$(saldo_pusat "$BELI52B")
cek "kasir tolak kiriman ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FB52_ID/tolak" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"alasan":"barang kurang"}')"
cek "kiriman ditolak tampil dgn alasan" "V == 1" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FB52_ID" '[.rows[]|select(.faktur_id==$f and .status=="ditolak" and .alasan_tolak=="barang kurang")]|length')"
cek "saldo tak berubah setelah tolak" "abs(V - $S52B2) < 0.001" "$(saldo_pusat "$BELI52B")"
cek "kasir batal-tolak ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FB52_ID/batal-tolak" -H "Authorization: Bearer $KASIR")"
cek "setelah batal-tolak: saldo +5 (masuk stok)" "abs(V - ($S52B2 + 5)) < 0.001" "$(saldo_pusat "$BELI52B")"

# C) campur (1 terima, 1 tolak) + batal-tolak diblok bila sudah diterima sebagian
FC52=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BELI52B\",\"mode\":\"pcs\",\"jumlah\":4,\"total_harga\":400},{\"ingredient_id\":\"$BELI52B\",\"mode\":\"pcs\",\"jumlah\":6,\"total_harga\":600}]}")
FC52_ID=$(echo "$FC52" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FC52_ID" '{"ke":"dikerjakan"}' > /dev/null
# urutan baris dari API tak dijamin = urutan input → kirim tiap baris qty PENUH-nya
FCROWS=$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq -c --arg f "$FC52_ID" '[.rows[]|select(.faktur_id==$f)|{id,qty}]')
RC1=$(echo "$FCROWS" | jq -r '.[0].id'); RC1Q=$(echo "$FCROWS" | jq -r '.[0].qty')
RC2=$(echo "$FCROWS" | jq -r '.[1].id'); RC2Q=$(echo "$FCROWS" | jq -r '.[1].qty')
api "$OWNER" POST "/pembelian/tahap/$FC52_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RC1\",\"qty\":$RC1Q},{\"id\":\"$RC2\",\"qty\":$RC2Q}],\"tujuan_branch_id\":\"$PUSAT52B\"}" > /dev/null
# baris pindah ke Pusat dgn id yg sama (qty penuh) → terima RC1, tolak RC2
cek "terima-sebagian campur (1 terima, 1 tolak) ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FC52_ID/terima-sebagian" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$RC1\",\"qty_diterima\":3},{\"id\":\"$RC2\",\"qty_diterima\":0}],\"alasan\":\"sebagian kosong\"}")"
cek "batal-tolak faktur diterima-sebagian diblok (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FC52_ID/batal-tolak" -H "Authorization: Bearer $KASIR")"
cek "faktur campuran: 1 dikonfirmasi + 1 ditolak" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FC52_ID" '[.rows[]|select(.faktur_id==$f)] | (([.[]|select(.status=="dikonfirmasi")]|length)==1 and ([.[]|select(.status=="ditolak")]|length)==1) | if . then 1 else 0 end')"

# D) diterima SETELAH opname tetap masuk saldo (waktu = saat terima, bukan RAB)
FD52=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BELI52B\",\"mode\":\"pcs\",\"jumlah\":7,\"total_harga\":700}]}")
FD52_ID=$(echo "$FD52" | jq -r .faktur_id)
kirim52b "$FD52_ID" "$(ck_row "$FD52_ID")" 7
SBASE52=$(saldo_pusat "$BELI52B")
api "$KASIR" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$BELI52B\",\"qty\":$SBASE52}],\"catatan\":\"opname sblm terima\"}" > /dev/null
cek "opname baseline aktif (saldo == fisik)" "abs(V - $SBASE52) < 0.001" "$(saldo_pusat "$BELI52B")"
api "$KASIR" POST "/penerimaan/$FD52_ID/terima" > /dev/null
cek "barang diterima setelah opname tetap masuk saldo (+7)" "abs(V - ($SBASE52 + 7)) < 0.001" "$(saldo_pusat "$BELI52B")"

echo "== 53. Edit karyawan: nama/email/peran/lokasi + password + status =="
api "$OWNER" POST /karyawan "{\"nama\":\"Karyawan Edit 53\",\"email\":\"edit53@basooopa.id\",\"password\":\"PwEdit53!\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT51_ID\"}" > /dev/null
U53_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="edit53@basooopa.id")][0].user_id')

# ubah nama + email + peran (kasir → admin, lokasi jadi "Semua")
api "$OWNER" PATCH "/karyawan/$U53_ID" '{"nama":"Karyawan Edit 53B","email":"edit53b@basooopa.id","role":"admin","branch_id":null}' > /dev/null
cek "PATCH nama/email/peran/lokasi tersimpan" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U53_ID" '([.[] | select(.user_id==$id)][0] | (.nama=="Karyawan Edit 53B" and .email=="edit53b@basooopa.id" and .role=="admin" and .branch_id==null)) | if . then 1 else 0 end')"
T53=$(login "edit53b@basooopa.id" "PwEdit53!")
cek "login dgn email BARU (password lama) berhasil" "V == 1" "$([ -n "$T53" ] && echo 1 || echo 0)"

cek "email bentrok dgn user lain → 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$U53_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"email\":\"$KASIR_EMAIL\"}")"
cek "peran kasir tanpa lokasi kerja → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$U53_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"role":"cashier","branch_id":null}')"

# guard hierarki: admin tidak boleh menyentuh akun owner / memberi peran owner
OWN53_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
cek "admin ubah akun owner → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$OWN53_ID" -H "Authorization: Bearer $T53" -H 'Content-Type: application/json' -d '{"nama":"Diretas"}')"
cek "admin memberi peran owner → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$U53_ID" -H "Authorization: Bearer $T53" -H 'Content-Type: application/json' -d '{"role":"owner"}')"

# ganti password via edit + nonaktifkan akun
api "$OWNER" PATCH "/karyawan/$U53_ID" '{"password":"PwEdit53Baru!"}' > /dev/null
cek "password baru dari form edit berlaku" "V == 1" \
  "$([ -n "$(login "edit53b@basooopa.id" "PwEdit53Baru!")" ] && echo 1 || echo 0)"
cek "password < 8 karakter → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$U53_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"password":"abc"}')"
api "$OWNER" PATCH "/karyawan/$U53_ID" '{"is_active":false}' > /dev/null
cek "akun nonaktif tidak bisa login (401)" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"edit53b@basooopa.id","password":"PwEdit53Baru!"}')"

echo "== 54. Nonaktifkan & arsip karyawan (keluar; riwayat tetap; bisa dipulihkan) =="
api "$OWNER" POST /karyawan "{\"nama\":\"Karyawan Arsip 54\",\"email\":\"arsip54@basooopa.id\",\"password\":\"PwArsip54!\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT51_ID\"}" > /dev/null
U54_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="arsip54@basooopa.id")][0].user_id')
KODE54=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="arsip54@basooopa.id")][0].employee_code')
cek "karyawan uji bisa login sebelum diarsipkan" "V == 1" \
  "$([ -n "$(login "arsip54@basooopa.id" "PwArsip54!")" ] && echo 1 || echo 0)"

api "$OWNER" PATCH "/karyawan/$U54_ID" '{"arsip":true}' > /dev/null
cek "terarsip: hilang dari daftar karyawan" "V == 0" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U54_ID" '[.[] | select(.user_id==$id)] | length')"
cek "terarsip: muncul di daftar arsip + tanggal arsip" "V == 1" \
  "$(api "$OWNER" GET "/karyawan?arsip=true" | jq --arg id "$U54_ID" '([.[] | select(.user_id==$id)][0] | (.archived_at != null)) | if . then 1 else 0 end')"
# nonaktif = arsip: arsip ikut menonaktifkan akun → login ditolak 401
cek "terarsip: tidak bisa login (401)" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"arsip54@basooopa.id","password":"PwArsip54!"}')"
cek "terarsip: kode absen tidak dikenali (404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE54\",\"foto_url\":\"$FOTO\"}")"

# pulihkan → kembali ke daftar dgn kode sama, login & absen normal lagi
api "$OWNER" PATCH "/karyawan/$U54_ID" '{"arsip":false}' > /dev/null
cek "dipulihkan: kembali ke daftar dgn kode sama" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U54_ID" --arg kode "$KODE54" '([.[] | select(.user_id==$id)][0] | (.employee_code == $kode and .archived_at == null)) | if . then 1 else 0 end')"
cek "dipulihkan: login kembali normal" "V == 1" \
  "$([ -n "$(login "arsip54@basooopa.id" "PwArsip54!")" ] && echo 1 || echo 0)"
cek "dipulihkan: absen dgn kode diterima" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE54\",\"foto_url\":\"$FOTO\"}")"

# guard: tidak bisa mengunci diri sendiri; admin tak boleh mengarsipkan owner
OWN54_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
cek "arsipkan akun sendiri → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$OWN54_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"arsip":true}')"
cek "nonaktifkan akun sendiri → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$OWN54_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"is_active":false}')"
api "$OWNER" PATCH "/karyawan/$U53_ID" '{"is_active":true}' > /dev/null
# T53 lama sudah dibatalkan token_version (password U53 diubah di §53) → login
# ULANG dgn password terbaru untuk token admin yang segar sebelum uji guard.
T53=$(login "edit53b@basooopa.id" "PwEdit53Baru!")
cek "admin mengarsipkan akun owner → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$OWN54_ID" -H "Authorization: Bearer $T53" -H 'Content-Type: application/json' -d '{"arsip":true}')"

echo "== 55. Struk per cabang: footer & alamat cabang (bukan perusahaan) =="
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"alamat":"Jl. Pusat No. 1","telepon":"0811111111","receipt_footer":"Terima kasih dari Pusat!","receipt_show_alamat":true}' > /dev/null
cek "PATCH struk cabang tersimpan (footer + alamat + telepon)" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$PUSAT51_ID" '([.[] | select(.id==$id)][0] | (.receipt_footer=="Terima kasih dari Pusat!" and .receipt_show_alamat==true and .alamat=="Jl. Pusat No. 1" and .telepon=="0811111111")) | if . then 1 else 0 end')"
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"receipt_show_alamat":false}' > /dev/null
cek "sembunyikan alamat di struk per cabang" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$PUSAT51_ID" '([.[] | select(.id==$id)][0].receipt_show_alamat == false) | if . then 1 else 0 end')"
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"receipt_show_alamat":true}' > /dev/null

ST55_ID=$(api "$OWNER" POST /cabang "{\"nama\":\"Store 55\",\"central_kitchen_id\":\"$CK47_ID\",\"receipt_footer\":\"Sampai jumpa di Store 55\"}" | jq -r .id)
cek "cabang baru langsung membawa footer struknya" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$ST55_ID" '([.[] | select(.id==$id)][0] | (.receipt_footer=="Sampai jumpa di Store 55" and .receipt_show_alamat==true)) | if . then 1 else 0 end')"

# struk web mengambil cabang via sale.branchId — pastikan respons penjualan memuatnya
JUAL55=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
cek "respons penjualan memuat sale.branchId = cabang kasir" "V == 1" \
  "$(echo "$JUAL55" | jq --arg b "$PUSAT51_ID" '(.sale.branchId == $b) | if . then 1 else 0 end')"
cek "GET /penjualan/:id juga memuat sale.branchId" "V == 1" \
  "$(api "$KASIR" GET "/penjualan/$(echo "$JUAL55" | jq -r .sale.id)" | jq --arg b "$PUSAT51_ID" '(.sale.branchId == $b) | if . then 1 else 0 end')"

echo "== 56. Peran TIM: cek stok, lihat menu, penerimaan, riwayat — tanpa kasir =="
cek "tim tanpa cabang → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/karyawan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"Tim X","email":"timx56@basooopa.id","password":"TimPass56!","role":"tim"}')"
api "$OWNER" POST /karyawan "{\"nama\":\"Tim Gudang 56\",\"email\":\"tim56@basooopa.id\",\"password\":\"TimPass56!\",\"role\":\"tim\",\"branch_id\":\"$PUSAT51_ID\"}" > /dev/null
T56=$(login "tim56@basooopa.id" "TimPass56!")
cek "tim bisa login & terikat cabang" "V == 1" \
  "$(api "$T56" GET /auth/me | jq --arg b "$PUSAT51_ID" '((.user.role == "tim") and (.user.branch_id == $b)) | if . then 1 else 0 end')"
cek "tim: cek stok → 200" "V == 200" "$(status_code "$T56" GET /stok)"
cek "tim: lihat menu → 200" "V == 200" "$(status_code "$T56" GET /menu)"
cek "tim: riwayat transaksi → 200" "V == 200" "$(status_code "$T56" GET /penjualan)"
cek "tim: penerimaan barang → 200" "V == 200" "$(status_code "$T56" GET /penerimaan)"
cek "tim: profil → 200" "V == 200" "$(status_code "$T56" GET /profil)"
cek "tim: membuat transaksi kasir → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "tim: shift kasir → 403" "V == 403" "$(status_code "$T56" GET /shift/aktif)"
cek "tim: open bill → 403" "V == 403" "$(status_code "$T56" GET /open-bill)"
# Tim KINI boleh stock opname (dulu 403) — terikat petugas & cabang seperti kasir
U56=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="tim56@basooopa.id")][0].user_id')
TSID56=$(api "$T56" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":123}]}" | jq -r .session_id)
{ [ "$TSID56" != "null" ] && [ -n "$TSID56" ]; } && ok "tim boleh stock opname (tak lagi 403)" \
  || gagal "tim seharusnya boleh opname sekarang"
cek "tim: opname tanpa item → 400 (validasi, bukan 403)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/opname" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d '{"items":[]}')"
# Penugasan tempat SO per-karyawan (GET/PUT /karyawan/:id/tempat)
TMP56=$(api "$OWNER" GET "/karyawan/$U56/tempat")
cek "GET tempat karyawan: tersedia = tempat di cabangnya" "V >= 1" "$(echo "$TMP56" | jq '.tersedia | length')"
cek "GET tempat karyawan: assigned awalnya kosong" "V == 0" "$(echo "$TMP56" | jq '.assigned | length')"
RAK56=$(echo "$TMP56" | jq -r '.tersedia[0].id')
api "$OWNER" PUT "/karyawan/$U56/tempat" "{\"tempat_ids\":[\"$RAK56\"]}" > /dev/null
cek "PUT tempat karyawan: assigned tersimpan" "V == 1" \
  "$(api "$OWNER" GET "/karyawan/$U56/tempat" | jq --arg t "$RAK56" '[.assigned[] | select(. == $t)] | length')"
cek "penugasan konsisten dua arah (muncul di petugas tempat)" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq --arg id "$RAK56" --arg u "$U56" '[.[] | select(.id==$id)][0].petugas | [.[] | select(.user_id==$u)] | length')"
# Simetri aktif/nonaktif: PUT tempat karyawan hanya menyentuh tempat AKTIF —
# penugasan pada tempat nonaktif (tak tampak di modal) TIDAK ikut terhapus.
TMPB56=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$PUSAT51_ID\",\"nama\":\"Gudang Nonaktif SO\"}" | jq -r .id)
api "$OWNER" PUT "/karyawan/$U56/tempat" "{\"tempat_ids\":[\"$RAK56\",\"$TMPB56\"]}" > /dev/null
api "$OWNER" PATCH "/penyimpanan/$TMPB56" '{"is_active":false}' > /dev/null
api "$OWNER" PUT "/karyawan/$U56/tempat" "{\"tempat_ids\":[\"$RAK56\"]}" > /dev/null
cek "PUT tempat: penugasan di tempat nonaktif tak ikut terhapus" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq --arg id "$TMPB56" --arg u "$U56" '[.[] | select(.id==$id)][0].petugas | [.[] | select(.user_id==$u)] | length')"
GUDCK56=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$CK47_ID\",\"nama\":\"Gudang CK47 SO\"}" | jq -r .id)
cek "PUT tempat karyawan: tempat cabang lain → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/karyawan/$U56/tempat" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"tempat_ids\":[\"$GUDCK56\"]}")"
# Tim bukan petugas tempat yang terkunci ke orang lain → opname bahan di situ 403
PLAS_TMP=$(api "$T56" GET /stok | jq -r '[.[] | select(.nama=="plastik take away")][0].tempat_id // ""')
cek "tim: plastik punya tempat di cabangnya (prasyarat scope)" "V == 1" "$([ -n "$PLAS_TMP" ] && echo 1 || echo 0)"
OWNER_UID56=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
api "$OWNER" PUT "/penyimpanan/$PLAS_TMP/petugas" "{\"user_ids\":[\"$OWNER_UID56\"]}" > /dev/null
cek "tim bukan petugas tempat plastik → opname 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/opname" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":100}]}")"
# reset: buka tempat plastik lagi & lepas penugasan T56
api "$OWNER" PUT "/penyimpanan/$PLAS_TMP/petugas" "{\"user_ids\":[]}" > /dev/null
api "$OWNER" PUT "/karyawan/$U56/tempat" "{\"tempat_ids\":[]}" > /dev/null
cek "tim: produksi → 403" "V == 403" "$(status_code "$T56" GET /produksi)"
cek "tim: kelola karyawan → 403" "V == 403" "$(status_code "$T56" GET /karyawan)"
# Absen peran TIM: STASIUN pindai (POST kode) tetap DILARANG, tapi tim boleh
# ABSEN SENDIRI (POST /absensi/saya) + lihat daftar cabang.
KODE_T56=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="tim56@basooopa.id")][0].employee_code')
cek "tim: stasiun pindai (POST kode) → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE_T56\",\"foto_url\":\"$FOTO\"}")"
cek "tim: absen SENDIRI (POST /absensi/saya) → 201" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi/saya" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"foto_url\":\"$FOTO\"}")"
cek "tim: absen sendiri wajib foto → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi/saya" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d '{}')"
cek "tim: daftar absensi (GET) → 200 (lihat kehadiran cabang)" "V == 200" "$(status_code "$T56" GET /absensi)"
cek "kasir: pindai absensi tetap boleh → 200" "V == 200" "$(status_code "$KASIR" GET /absensi)"
# Struk per cabang lewat endpoint khusus (dipindah ke halaman Printer):
# kasir mengatur cabangNYA sendiri; tim tak boleh; owner via ?branch_id.
api "$KASIR" PUT /cabang/struk '{"receipt_footer":"Dari kasir Pusat","receipt_show_alamat":false}' > /dev/null
cek "kasir set struk cabang sendiri (PUT /cabang/struk) tersimpan" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$PUSAT51_ID" '([.[]|select(.id==$id)][0] | (.receipt_footer=="Dari kasir Pusat") and (.receipt_show_alamat==false)) | if . then 1 else 0 end')"
cek "tim set struk (PUT /cabang/struk) → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/cabang/struk" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d '{"receipt_footer":"x"}')"
cek "owner set struk cabang lain via ?branch_id → tersimpan" "V == 1" \
  "$(api "$OWNER" PUT "/cabang/struk?branch_id=$CK47_ID" '{"receipt_footer":"Struk CK47"}' > /dev/null; api "$OWNER" GET /cabang | jq --arg id "$CK47_ID" '([.[]|select(.id==$id)][0].receipt_footer=="Struk CK47") | if . then 1 else 0 end')"
cek "struk endpoint body kosong → no-op 200 (bukan 500)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/cabang/struk" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{}')"

echo "== 57. Absen hanya dalam radius titik lokasi cabang =="
KODE56=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="tim56@basooopa.id")][0].employee_code')
cek "cabang tanpa titik lokasi: absen tanpa GPS tetap diterima" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\",\"foto_url\":\"$FOTO\"}")"

# titik lokasi Pusat = Monas, radius 100 m
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"latitude":-6.175392,"longitude":106.827153,"radius_absen_m":100}' > /dev/null
cek "titik lokasi & radius cabang tersimpan" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$PUSAT51_ID" '([.[] | select(.id==$id)][0] | (.latitude == -6.175392 and .longitude == 106.827153 and .radius_absen_m == 100)) | if . then 1 else 0 end')"
cek "absen tanpa koordinat → 400 (wajib GPS)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\",\"foto_url\":\"$FOTO\"}")"
cek "absen di luar radius (±4,6 km) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\",\"lat\":-6.137654,\"lng\":106.817125,\"foto_url\":\"$FOTO\"}")"
ABS57=$(api "$OWNER" POST /absensi "{\"kode\":\"$KODE56\",\"lat\":-6.175392,\"lng\":106.827553,\"foto_url\":\"$FOTO\"}")
cek "absen dalam radius (~44 m) diterima + jarak terlapor" "V == 1" \
  "$(echo "$ABS57" | jq '((.jarak_m != null) and (.jarak_m <= 100) and (.tipe != null)) | if . then 1 else 0 end')"
# ABSEN SENDIRI (tim, POST /absensi/saya) tunduk radius yang sama
cek "tim absen sendiri tanpa GPS (radius aktif) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi/saya" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"foto_url\":\"$FOTO\"}")"
cek "tim absen sendiri di luar radius → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi/saya" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"lat\":-6.137654,\"lng\":106.817125,\"foto_url\":\"$FOTO\"}")"
SELF57=$(api "$T56" POST /absensi/saya "{\"lat\":-6.175392,\"lng\":106.827553,\"foto_url\":\"$FOTO\"}")
cek "tim absen sendiri dalam radius → diterima atas nama sendiri" "V == 1" \
  "$(echo "$SELF57" | jq '((.jarak_m != null) and (.nama == "Tim Gudang 56")) | if . then 1 else 0 end')"
# kosongkan titik → aturan radius kembali nonaktif
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"latitude":null,"longitude":null}' > /dev/null
cek "titik dikosongkan: absen tanpa GPS diterima lagi" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\",\"foto_url\":\"$FOTO\"}")"

echo "== 58. Karyawan Central Kitchen: satu peran, menu produksi/beli/bahan =="
cek "kasir ditempatkan di CK → 400 (CK hanya peran Karyawan)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/karyawan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"nama\":\"Kasir CK 58\",\"email\":\"kasirck58@basooopa.id\",\"password\":\"KasirCk58!\",\"role\":\"cashier\",\"branch_id\":\"$CK52_UTAMA\"}")"
api "$OWNER" POST /karyawan "{\"nama\":\"Karyawan CK 58\",\"email\":\"ck58@basooopa.id\",\"password\":\"KaryCk58!\",\"role\":\"tim\",\"branch_id\":\"$CK52_UTAMA\"}" > /dev/null
TCK58=$(login "ck58@basooopa.id" "KaryCk58!")
U58_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="ck58@basooopa.id")][0].user_id')

cek "karyawan CK: produksi bahan baku → 200" "V == 200" "$(status_code "$TCK58" GET /produksi)"
cek "karyawan CK: beli bahan baku → 200" "V == 200" "$(status_code "$TCK58" GET /pembelian)"
cek "karyawan CK: bahan baku (lihat) → 200" "V == 200" "$(status_code "$TCK58" GET /bahan)"
cek "karyawan CK: ubah master bahan → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$URATB_ID" -H "Authorization: Bearer $TCK58" -H 'Content-Type: application/json' -d '{"harga_beli":1}')"
cek "tim cabang store: produksi → 403" "V == 403" "$(status_code "$T56" GET /produksi)"

# faktur pembelian oleh karyawan CK → jatuh di CK-nya sendiri
FK58=$(api "$TCK58" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":25000}]}")
FK58_ID=$(echo "$FK58" | jq -r .faktur_id)
cek "karyawan CK membuat faktur pembelian di CK-nya" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$FK58_ID" '([.rows[] | select(.faktur_id==$f)] | length == 1) | if . then 1 else 0 end')"
cek "karyawan CK membuat faktur di cabang lain → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/faktur" -H "Authorization: Bearer $TCK58" -H 'Content-Type: application/json' -d "{\"branch_id\":\"$PUSAT51_ID\",\"items\":[{\"ingredient_id\":\"$ING42A\",\"mode\":\"pcs\",\"jumlah\":2,\"total_harga\":10000}]}")"

# karyawan CK memproses & MENGIRIM ke store yang terhubung ke CK-nya
api "$TCK58" POST "/pembelian/tahap/$FK58_ID" '{"ke":"dikerjakan","dana_cair":25000}' > /dev/null
ID58=$(api "$TCK58" GET "/pembelian?per_page=500" | jq -r --arg f "$FK58_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
api "$TCK58" POST "/pembelian/tahap/$FK58_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID58\",\"qty\":5}],\"tujuan_branch_id\":\"$CB46_ID\"}" > /dev/null
cek "karyawan CK mengirim ke store terhubung → baris pindah" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FK58_ID" '([.rows[] | select(.faktur_id==$f)] | (length == 1) and (.[0].status == "menunggu")) | if . then 1 else 0 end')"

# faktur produksi dgn pelaksana dirinya sendiri
FP58=$(api "$TCK58" POST /produksi/faktur "{\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"pcs\",\"jumlah\":10}]}")
cek "karyawan CK membuat faktur produksi (pelaksana dirinya)" "V == 1" \
  "$(echo "$FP58" | jq '(.faktur_id != null) | if . then 1 else 0 end')"

echo "== 59. Nonaktif = arsip (satu status): kedua arah saling terikat =="
api "$OWNER" POST /karyawan "{\"nama\":\"Karyawan Satu Status 59\",\"email\":\"status59@basooopa.id\",\"password\":\"PwStatus59!\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT51_ID\"}" > /dev/null
U59_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="status59@basooopa.id")][0].user_id')

# arah 1: NONAKTIFKAN (is_active:false) → otomatis masuk arsip
api "$OWNER" PATCH "/karyawan/$U59_ID" '{"is_active":false}' > /dev/null
cek "nonaktifkan → hilang dari daftar karyawan" "V == 0" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U59_ID" '[.[] | select(.user_id==$id)] | length')"
cek "nonaktifkan → otomatis masuk arsip (archived_at terisi + nonaktif)" "V == 1" \
  "$(api "$OWNER" GET "/karyawan?arsip=true" | jq --arg id "$U59_ID" '([.[] | select(.user_id==$id)][0] | (.archived_at != null and .is_active == false)) | if . then 1 else 0 end')"
cek "nonaktif: login ditolak (401)" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"status59@basooopa.id","password":"PwStatus59!"}')"

# pulihkan via arsip:false → sekaligus aktif kembali
api "$OWNER" PATCH "/karyawan/$U59_ID" '{"arsip":false}' > /dev/null
cek "pulihkan (arsip:false) → kembali aktif di daftar" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U59_ID" '([.[] | select(.user_id==$id)][0] | (.is_active == true and .archived_at == null)) | if . then 1 else 0 end')"
cek "pulihkan: login kembali normal" "V == 1" \
  "$([ -n "$(login "status59@basooopa.id" "PwStatus59!")" ] && echo 1 || echo 0)"

# arah 2: ARSIPKAN (arsip:true) → otomatis nonaktif; aktifkan (is_active:true) → keluar arsip
api "$OWNER" PATCH "/karyawan/$U59_ID" '{"arsip":true}' > /dev/null
cek "arsipkan → otomatis nonaktif (is_active false di arsip)" "V == 1" \
  "$(api "$OWNER" GET "/karyawan?arsip=true" | jq --arg id "$U59_ID" '([.[] | select(.user_id==$id)][0] | (.is_active == false)) | if . then 1 else 0 end')"
api "$OWNER" PATCH "/karyawan/$U59_ID" '{"is_active":true}' > /dev/null
cek "aktifkan (is_active:true) → keluar dari arsip + aktif" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U59_ID" '([.[] | select(.user_id==$id)][0] | (.is_active == true and .archived_at == null)) | if . then 1 else 0 end')"
cek "aktifkan: login kembali normal" "V == 1" \
  "$([ -n "$(login "status59@basooopa.id" "PwStatus59!")" ] && echo 1 || echo 0)"

echo "== 60. Kantor pusat data penjualan: GET /penjualan?branch_id=all =="
# dua transaksi di dua cabang berbeda (oleh kasir masing-masing cabang) →
# kantor melihat keduanya sekaligus. PUSAT51 = Pusat (cabang KASIR).
J60A=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
J60B=$(api "$KASIR46" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
N60A=$(echo "$J60A" | jq -r .sale.nomor)
N60B=$(echo "$J60B" | jq -r .sale.nomor)
cek "riwayat semua cabang memuat transaksi dua cabang" "V == 2" \
  "$(api "$OWNER" GET "/penjualan?branch_id=all" | jq --arg a "$N60A" --arg b "$N60B" '[.[] | select(.nomor==$a or .nomor==$b)] | length')"
cek "riwayat semua cabang menyertakan nama cabang tiap baris" "V == 1" \
  "$(api "$OWNER" GET "/penjualan?branch_id=all" | jq --arg b "$N60B" '([.[] | select(.nomor==$b)][0].cabang != null) | if . then 1 else 0 end')"
cek "filter satu cabang tetap bekerja (transaksi cabang lain tak ikut)" "V == 0" \
  "$(api "$OWNER" GET "/penjualan?branch_id=$PUSAT51_ID" | jq --arg b "$N60B" '[.[] | select(.nomor==$b)] | length')"
# kasir tetap terkunci: ?branch_id=all diabaikan, hanya cabangnya sendiri
cek "kasir dgn branch_id=all tetap hanya cabangnya" "V == 0" \
  "$(api "$KASIR" GET "/penjualan?branch_id=all" | jq --arg b "$N60B" '[.[] | select(.nomor==$b)] | length')"
cek "kasir dgn branch_id=all masih melihat transaksi cabangnya" "V == 1" \
  "$(api "$KASIR" GET "/penjualan?branch_id=all" | jq --arg a "$N60A" '[.[] | select(.nomor==$a)] | length')"

echo "== 61. Deteksi pembaruan: build id di /api/health + header X-Kakarut-Build =="
HEALTH61=$(curl -s "$BASE/api/health")
cek "health ok:true" "V == 1" "$(echo "$HEALTH61" | jq '.ok == true | if . then 1 else 0 end')"
BUILD61=$(echo "$HEALTH61" | jq -r '.build // empty')
cek "health menyertakan build id (dist tersedia)" "V == 1" \
  "$([ -n "$BUILD61" ] && echo 1 || echo 0)"
HDR61=$(curl -s -D - -o /dev/null "$BASE/api/health" | tr -d '\r' | awk 'tolower($1)=="x-kakarut-build:"{print $2}')
cek "header X-Kakarut-Build sama dengan build health" "V == 1" \
  "$([ -n "$BUILD61" ] && [ "$HDR61" = "$BUILD61" ] && echo 1 || echo 0)"
# respons API berautentikasi juga membawa header build
HDRME=$(curl -s -D - -o /dev/null "$BASE/api/auth/me" -H "Authorization: Bearer $OWNER" | tr -d '\r' | awk 'tolower($1)=="x-kakarut-build:"{print $2}')
cek "respons API lain membawa header build yang sama" "V == 1" \
  "$([ "$HDRME" = "$BUILD61" ] && echo 1 || echo 0)"

echo "== 62. Permintaan tambah stok = work-order Central Kitchen =="
# owner minta tambah stok utk store CB46 (pemasok CK52_UTAMA), produksi di CK.
# CB46 store kosong → seluruh kebutuhan kurang → ada baris produksi.
WO=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
WO_FID=$(echo "$WO" | jq -r '.produksi.faktur_id')
cek "permintaan menghasilkan faktur produksi" "V == 1" \
  "$([ -n "$WO_FID" ] && [ "$WO_FID" != "null" ] && echo 1 || echo 0)"
# faktur produksi lahir di CK utk DISIMPAN sbg stok CK (tujuan=null = produksi
# ke CK, bukan langsung kirim ke store), tanpa pelaksana, status rencana
cek "faktur produksi: tujuan=null (produksi ke CK), worker null, rencana" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .tujuan_branch_id==null and .worker_id==null and .status=="rencana")) | if . then 1 else 0 end')"
# riwayat "Permintaan tambah stok" (owner) di log faktur + aktivitas owner
cek "riwayat: log faktur memuat 'Permintaan tambah stok'" "V == 1" \
  "$(api "$OWNER" GET "/produksi/log/$WO_FID" | jq '([.rows[] | select(.aksi=="Permintaan tambah stok")] | length > 0) | if . then 1 else 0 end')"
OWNER_UID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
cek "riwayat: aktivitas owner memuat permintaan" "V == 1" \
  "$(api "$OWNER" GET "/karyawan/$OWNER_UID/aktivitas" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f and .aksi=="Permintaan tambah stok")] | length > 0) | if . then 1 else 0 end')"

# Bahan BELI produk jadi dibukukan di CK dgn TUJUAN = store (dikirim setelah diproses)
WO_BELI=$(echo "$WO" | jq -r '.beli.faktur_id')
cek "permintaan menghasilkan faktur beli" "V == 1" \
  "$([ -n "$WO_BELI" ] && [ "$WO_BELI" != "null" ] && echo 1 || echo 0)"
cek "faktur beli lahir di CK dgn tujuan=store (rencana)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_BELI" --arg s "$CB46_ID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .tujuan_branch_id==$s and .status=="rencana")) | if . then 1 else 0 end')"
cek "faktur beli TIDAK di store (dibukukan di CK)" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$WO_BELI" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "riwayat: log faktur beli 'Permintaan tambah stok' (di CK)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian/log/$WO_BELI" | jq '([.rows[] | select(.aksi=="Permintaan tambah stok")] | length > 0) | if . then 1 else 0 end')"

# Data Permintaan Stok: produksi + beli SATU submit tergabung sbg 1 entri (rencana_id)
cek "permintaan: 1 entri menggabung produksi+beli (WO)" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg p "$WO_FID" --arg b "$WO_BELI" '[.[] | select(.produksi.faktur_id==$p and .beli.faktur_id==$b)] | length | if . == 1 then 1 else 0 end')"
cek "permintaan: bagian rencana + tujuan store terisi" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg p "$WO_FID" '[.[] | select(.produksi.faktur_id==$p)][0] | (.produksi.status=="rencana" and .beli.status=="rencana" and .tujuan_cabang!=null) | if . then 1 else 0 end')"

# tim@CK mulai dikerjakan (seluruh faktur) → self-assign pelaksana
api "$TCK58" POST "/produksi/tahap/$WO_FID" '{"ke":"dikerjakan"}' > /dev/null
cek "tim CK mulai dikerjakan → pelaksana = dirinya" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_FID" --arg u "$U58_ID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .worker_id==$u and .status=="dikerjakan")) | if . then 1 else 0 end')"

# saldo CK & store SEBELUM selesai (produksi masih dikerjakan)
ING_WO=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$WO_FID" '[.rows[] | select(.faktur_id==$f)][0].ingredient_id')
CKSALDO_SEB=$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq -r --arg i "$ING_WO" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')
STSALDO_SEB=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq -r --arg i "$ING_WO" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')
# selesai produksi di CK → LANGSUNG masuk stok CK (tanpa konfirmasi terpisah); CK
# ngestock, sebelum dikirim ke cabang lewat "kirim dari stok CK" (transfer, §66).
api "$TCK58" POST "/produksi/tahap/$WO_FID" '{"ke":"menunggu"}' > /dev/null
cek "selesai produksi CK → baris LANGSUNG dikonfirmasi (masuk stok CK)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="dikonfirmasi" and .tujuan_branch_id==null)) | if . then 1 else 0 end')"
# produksi ke CK tak muncul di penerimaan store (bukan dikirim)
cek "produksi ke CK: tidak muncul di penerimaan store" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$WO_FID" '[.rows[] | select(.faktur_id==$f)] | length')"
CKSALDO_SES=$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq -r --arg i "$ING_WO" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')
cek "hasil produksi MASUK stok CK (saldo CK naik)" "V == 1" \
  "$(jq -n --argjson a "$CKSALDO_SEB" --argjson b "$CKSALDO_SES" '($b > $a) | if . then 1 else 0 end')"
# tak mendarat di store (belum dikirim) — store butuh transfer "kirim dari stok"
STSALDO_SES=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq -r --arg i "$ING_WO" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')
cek "produksi ke CK: saldo store tak berubah (belum dikirim)" "V == 1" \
  "$(jq -n --argjson a "$STSALDO_SEB" --argjson b "$STSALDO_SES" '($b == $a) | if . then 1 else 0 end')"
# konfirmasi manual di CK sekarang no-op (sudah masuk stok) → 404
cek "konfirmasi CK-lokal jadi no-op (sudah masuk stok, 404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/konfirmasi/$WO_FID" -H "Authorization: Bearer $OWNER")"

# guard: minta produksi utk store milik CK LAIN via CK52 → 400
cek "permintaan produksi utk store CK-lain → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/rekomendasi/menu/faktur" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":10}],\"tujuan_branch_id\":\"$ST52_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")"

echo "== 63. Kantor: daftar Produksi lintas cabang (branch_id=all) =="
# buat faktur produksi di tempat lain (di CK47) agar ada >1 cabang
FK63=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK47_ID\",\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"pcs\",\"jumlah\":5}]}")
FK63_ID=$(echo "$FK63" | jq -r .faktur_id)
cek "produksi?branch_id=all memuat faktur >1 cabang (WO@CK & FK@CK47)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=all&per_page=500" | jq --arg a "$WO_FID" --arg b "$FK63_ID" '([.rows[] | select(.faktur_id==$a)] | length > 0) and ([.rows[] | select(.faktur_id==$b)] | length > 0) | if . then 1 else 0 end')"
cek "produksi?branch_id=all menyertakan nama cabang" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=all&per_page=500" | jq --arg b "$FK63_ID" '([.rows[] | select(.faktur_id==$b)][0].cabang != null) | if . then 1 else 0 end')"
cek "produksi?branch_id=<CK47> hanya faktur cabang itu (bukan WO@store)" "V == 0" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK47_ID&per_page=500" | jq --arg a "$WO_FID" '[.rows[] | select(.faktur_id==$a)] | length')"
cek "penerimaan?branch_id=all lintas cabang" "V == 200" "$(status_code "$OWNER" GET "/penerimaan?branch_id=all")"

echo "== 64. Stok Awal (saldo pembuka) =="
SA_ING=$(api "$OWNER" GET /stok | jq -r '.[0].ingredient_id')
api "$OWNER" POST /stok/awal "{\"items\":[{\"ingredient_id\":\"$SA_ING\",\"qty\":777}]}" > /dev/null
cek "stok awal menetapkan saldo bahan == 777" "abs(V - 777) < 0.001" \
  "$(api "$OWNER" GET /stok | jq --arg i "$SA_ING" '[.[] | select(.ingredient_id==$i)][0].saldo')"
# stok awal TIDAK membuat penyesuaian menunggu (bukan opname selisih)
cek "stok awal tak menambah antrean penyesuaian bahan itu" "V == 0" \
  "$(api "$OWNER" GET "/stok/penyesuaian?status=belum" | jq --arg i "$SA_ING" '[.[] | select(.ingredient_id==$i)] | length')"
# stok awal MENETAPKAN (bukan menambah): set ulang ke 300 → saldo jadi 300
api "$OWNER" POST /stok/awal "{\"items\":[{\"ingredient_id\":\"$SA_ING\",\"qty\":300}]}" > /dev/null
cek "stok awal ulang menetapkan saldo == 300 (bukan 1077)" "abs(V - 300) < 0.001" \
  "$(api "$OWNER" GET /stok | jq --arg i "$SA_ING" '[.[] | select(.ingredient_id==$i)][0].saldo')"
# GET stok awal: nilai tersimpan utk isi ulang form (bukan saldo live)
cek "GET stok awal: nilai SA_ING tersimpan == 300" "abs(V - 300) < 0.001" \
  "$(api "$OWNER" GET /stok/awal | jq --arg i "$SA_ING" '[.items[] | select(.ingredient_id==$i)][0].qty')"
cek "GET stok awal: SA_ING hanya 1 entri (upsert, tak menumpuk)" "V == 1" \
  "$(api "$OWNER" GET /stok/awal | jq --arg i "$SA_ING" '[.items[] | select(.ingredient_id==$i)] | length')"
# UPSERT nyata: kartu stok cuma 1 baris "Stok awal" (777 diganti 300, bukan 2)
cek "kartu stok: hanya 1 mutasi 'Stok awal' (upsert, bukan tumpuk)" "V == 1" \
  "$(api "$OWNER" GET "/stok/kartu/$SA_ING" | jq '[.mutasi[] | select(.jenis=="opname" and .keterangan=="Stok awal")] | length')"
# tanggal saldo pembuka bisa dipindah (lampau). Pakai bahan BARU tanpa riwayat
# agar saldo == nilai (SA_ING sudah terpakai transaksi lain; backdate akan
# menghitung pemakaian sesudah tanggal itu — perilaku benar, tapi bukan fokus).
SA_ING2=$(api "$OWNER" POST /bahan '{"nama":"stok awal uji64","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
api "$OWNER" POST /stok/awal "{\"items\":[{\"ingredient_id\":\"$SA_ING2\",\"qty\":500}],\"tanggal\":\"2020-01-01\"}" > /dev/null
cek "stok awal tanggal lampau: saldo jadi 500 (bahan baru tanpa riwayat)" "abs(V - 500) < 0.001" \
  "$(api "$OWNER" GET /stok | jq --arg i "$SA_ING2" '[.[] | select(.ingredient_id==$i)][0].saldo')"
cek "GET stok awal: tanggal terkunci == 2020-01-01" "V == 1" \
  "$(api "$OWNER" GET /stok/awal | jq --arg i "$SA_ING2" '([.items[] | select(.ingredient_id==$i)][0].tanggal == "2020-01-01") | if . then 1 else 0 end')"
# tanggal masa depan ditolak? tidak — hanya format divalidasi; format salah → 400
cek "stok awal format tanggal salah → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/awal" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$SA_ING\",\"qty\":1}],\"tanggal\":\"01-01-2020\"}")"
cek "stok awal oleh KASIR ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/awal" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$SA_ING\",\"qty\":1}]}")"
cek "GET stok awal oleh KASIR ditolak (403)" "V == 403" \
  "$(status_code "$KASIR" GET /stok/awal)"

echo "== 65. Master Kategori (CRUD + hapus aman) =="
KAT_ID=$(api "$OWNER" POST /kategori '{"nama":"Kategori Uji ZZ","sort_order":9}' | jq -r .id)
cek "kategori baru muncul di daftar" "V == 1" \
  "$(api "$OWNER" GET /kategori | jq --arg id "$KAT_ID" '[.[] | select(.id==$id)] | length')"
cek "PATCH kategori mengubah nama" "V == 1" \
  "$(api "$OWNER" PATCH "/kategori/$KAT_ID" '{"nama":"Kategori Uji ZZ2"}' | jq '.nama=="Kategori Uji ZZ2" | if . then 1 else 0 end')"
cek "PATCH parsial tak me-reset sort_order (tetap 9)" "V == 9" \
  "$(api "$OWNER" GET /kategori | jq --arg id "$KAT_ID" '[.[] | select(.id==$id)][0].sort_order')"
cek "kategori duplikat ditolak (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/kategori" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"Kategori Uji ZZ2"}')"
cek "POST kategori oleh KASIR ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/kategori" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"nama":"x"}')"
cek "DELETE kategori tak terpakai berhasil" "V == 200" \
  "$(status_code "$OWNER" DELETE "/kategori/$KAT_ID")"
cek "kategori terhapus hilang dari daftar" "V == 0" \
  "$(api "$OWNER" GET /kategori | jq --arg id "$KAT_ID" '[.[] | select(.id==$id)] | length')"
# kategori yang dipakai menu tak boleh dihapus
PBA_KAT=$(api "$OWNER" GET /menu | jq -r --arg id "$PBA_ID" '[.[] | select(.id==$id)][0].category_id')
cek "DELETE kategori yang dipakai menu ditolak (409)" "V == 409" \
  "$(status_code "$OWNER" DELETE "/kategori/$PBA_KAT")"

echo "== 66. Resep produksi (BOM): belanja bahan produksi + konsumsi otomatis =="
# bahan mentah (beli, dilacak) + bahan jadi (produksi) dengan resep per 1 batch
DAG66=$(api "$OWNER" POST /bahan '{"nama":"daging uji66","harga_beli":90000,"isi":1000,"satuan":"gr","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
TEP66=$(api "$OWNER" POST /bahan '{"nama":"tepung uji66","harga_beli":10000,"isi":500,"satuan":"gr","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
BASO66=$(api "$OWNER" POST /bahan '{"nama":"baso uji66","harga_beli":50000,"isi":100,"satuan":"butir","pengadaan":"produksi","kategori":"baso"}' | jq -r .id)
cek "resep utk bahan beli ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$DAG66/resep" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"komponen\":[{\"ingredient_id\":\"$TEP66\",\"qty\":1}]}")"
cek "resep memakai diri sendiri ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BASO66/resep" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"komponen\":[{\"ingredient_id\":\"$BASO66\",\"qty\":1}]}")"
api "$OWNER" PUT "/bahan/$BASO66/resep" "{\"komponen\":[{\"ingredient_id\":\"$DAG66\",\"qty\":2000},{\"ingredient_id\":\"$TEP66\",\"qty\":300}]}" > /dev/null
cek "GET resep memuat 2 bahan mentah" "V == 2" "$(api "$OWNER" GET "/bahan/$BASO66/resep" | jq 'length')"
# Resep BERTINGKAT: bahan PRODUKSI boleh jadi input resep (dipotong dari
# stoknya sendiri saat produksi induk selesai), + cegah resep melingkar.
JANDO66=$(api "$OWNER" POST /bahan '{"nama":"jando uji66","harga_beli":0,"isi":50,"satuan":"porsi","pengadaan":"produksi","kategori":"baso"}' | jq -r .id)
cek "resep boleh memakai bahan produksi lain (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$JANDO66/resep" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"komponen\":[{\"ingredient_id\":\"$BASO66\",\"qty\":2},{\"ingredient_id\":\"$TEP66\",\"qty\":100}]}")"
cek "GET resep jando memuat 2 input (produksi+beli)" "V == 2" "$(api "$OWNER" GET "/bahan/$JANDO66/resep" | jq 'length')"
cek "resep MELINGKAR ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BASO66/resep" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"komponen\":[{\"ingredient_id\":\"$JANDO66\",\"qty\":1}]}")"
cek "resep BASO66 tetap 2 (PUT melingkar ditolak, tak mengubah)" "V == 2" \
  "$(api "$OWNER" GET "/bahan/$BASO66/resep" | jq 'length')"
cek "hapus bahan yang dipakai resep ditolak (409)" "V == 409" \
  "$(status_code "$OWNER" DELETE "/bahan/$DAG66")"
# menu uji: 1 porsi memakai 5 butir baso66
CAT66=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
MENU66=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji66\",\"category_id\":\"$CAT66\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":15000,\"komponen\":[{\"ingredient_id\":\"$BASO66\",\"qty\":5}]}" | jq -r .id)
# preview 100 porsi utk CB46 (CK52 pelaksana): baso66 kurang 500 (5 batch),
# bahan produksi = daging 10000 gr + tepung 1500 gr (dihitung thd stok CK)
PV66=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "preview: bahan_produksi memuat 2 bahan mentah" "V == 2" "$(echo "$PV66" | jq '.bahan_produksi | length')"
cek "preview: kebutuhan daging 10000 gr (resep 2000 × 5 batch)" "abs(V - 10000) < 0.001" \
  "$(echo "$PV66" | jq --arg id "$DAG66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].kebutuhan')"
cek "preview: qty_faktur tepung 1500 (3 kemasan × 500)" "abs(V - 1500) < 0.001" \
  "$(echo "$PV66" | jq --arg id "$TEP66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].qty_faktur')"
# STOK CK ikut menutup kebutuhan store: seed 200 butir baso66 di CK → saat
# preview utk store CB46 (CK52 pelaksana), saldo store + stok CK dijumlahkan →
# kekurangan turun (500 → 300) & kebutuhan bahan mentah ikut turun (3 batch).
# Reset baso66 CK ke 0 sesudahnya agar tes MOQ/konsumsi lanjutan tak terpengaruh.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":200}]}" > /dev/null
PV66CK=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "CK: baso66 saldo_ck == 200 (stok CK ikut dihitung)" "abs(V - 200) < 0.001" \
  "$(echo "$PV66CK" | jq --arg id "$BASO66" '[.bahan[] | select(.ingredient_id==$id)][0].saldo_ck')"
cek "CK: baso66 saldo = stok CABANG saja == 0 (bukan +CK)" "abs(V) < 0.001" \
  "$(echo "$PV66CK" | jq --arg id "$BASO66" '[.bahan[] | select(.ingredient_id==$id)][0].saldo')"
cek "CK: baso66 kirim_ck 200 (CK menutup 200 lewat kirim; sisa 300 diproduksi)" "abs(V - 200) < 0.001" \
  "$(echo "$PV66CK" | jq --arg id "$BASO66" '[.bahan[] | select(.ingredient_id==$id)][0].kirim_ck')"
cek "CK: kebutuhan daging turun 10000 → 6000 (300 baso = 3 batch)" "abs(V - 6000) < 0.001" \
  "$(echo "$PV66CK" | jq --arg id "$DAG66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].kebutuhan')"
cek "CK: kebutuhan tepung turun 1500 → 900 (3 batch × 300)" "abs(V - 900) < 0.001" \
  "$(echo "$PV66CK" | jq --arg id "$TEP66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].kebutuhan')"
# STOK CK CUKUP menutup seluruh kebutuhan (600 ≥ 500) → tak perlu produksi,
# semua dikirim dari stok CK: baso66 kirim_ck 500, tak ada belanja bahan
# produksi, jumlah_produksi 0.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":600}]}" > /dev/null
PV66FULL=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "CK cukup: baso66 kirim_ck 500 (semua dari stok CK, tanpa produksi)" "abs(V - 500) < 0.001" \
  "$(echo "$PV66FULL" | jq --arg id "$BASO66" '[.bahan[] | select(.ingredient_id==$id)][0].kirim_ck')"
cek "CK cukup: jumlah_produksi 0 (tinggal kirim, tak produksi)" "V == 0" \
  "$(echo "$PV66FULL" | jq '.jumlah_produksi')"
cek "CK cukup: tak ada belanja bahan produksi (bahan_produksi kosong)" "V == 0" \
  "$(echo "$PV66FULL" | jq '.bahan_produksi | length')"
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
# MOQ (min_beli): daging minimal belanja 12000 → qty_faktur naik ke 12000
api "$OWNER" PUT "/bahan/$DAG66" '{"min_beli":12000}' > /dev/null
# stok_minimum (reorder point) IKUT ditambahkan ke belanja bahan mentah:
# kurang = kebutuhan + stok_minimum − saldo, agar sisa stok tak jatuh di
# bawah ambang (selaras faktur beli otomatis di faktur produksi).
api "$OWNER" PUT "/bahan/$TEP66" '{"stok_minimum":700}' > /dev/null
cek "PUT parsial tak me-reset satuan bahan (tetap gr)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$DAG66" '[.[] | select(.id==$id)][0].satuan == "gr" | if . then 1 else 0 end')"
PV66B=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "MOQ: qty_faktur daging dibulatkan naik ke 12000" "abs(V - 12000) < 0.001" \
  "$(echo "$PV66B" | jq --arg id "$DAG66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].qty_faktur')"
# kebutuhan 1500 + minimum 700 = 2200 → 5 kemasan × 500 = 2500
cek "reorder point ikut dibelanjakan: tepung 2500 (1500 + min 700, per kemasan)" "abs(V - 2500) < 0.001" \
  "$(echo "$PV66B" | jq --arg id "$TEP66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].qty_faktur')"
# permintaan → faktur produksi (work-order CK) + faktur belanja (bahan produksi)
WO66=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
PF66=$(echo "$WO66" | jq -r '.produksi.faktur_id')
BP66=$(echo "$WO66" | jq -r '.beli_produksi.faktur_id')
cek "permintaan menghasilkan bagian belanja bahan produksi" "V == 1" \
  "$([ -n "$BP66" ] && [ "$BP66" != "null" ] && echo 1 || echo 0)"
cek "faktur bahan produksi: 2 bahan mentah" "V == 2" "$(echo "$WO66" | jq '.beli_produksi.jumlah_baris')"
cek "faktur bahan produksi lahir di CK (tujuan null, rencana)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BP66" '([.rows[] | select(.faktur_id==$f)] | (length==2) and all(.[]; .tujuan_branch_id==null and .status=="rencana")) | if . then 1 else 0 end')"
cek "Data Permintaan Stok: bagian beli_produksi tampil (2 bahan)" "V == 2" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg p "$PF66" '[.[] | select(.produksi.faktur_id==$p)][0].beli_produksi.jumlah_baris')"
# stok awal bahan mentah di CK → produksi selesai → KONSUMSI OTOMATIS
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$DAG66\",\"qty\":20000},{\"ingredient_id\":\"$TEP66\",\"qty\":5000}]}" > /dev/null
api "$OWNER" POST "/produksi/tahap/$PF66" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/produksi/tahap/$PF66" '{"ke":"menunggu"}' > /dev/null
cek "konsumsi: saldo daging CK 20000 − 10000 = 10000" "abs(V - 10000) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$DAG66" '[.[] | select(.ingredient_id==$id)][0].saldo')"
cek "konsumsi: saldo tepung CK 5000 − 1500 = 3500" "abs(V - 3500) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$TEP66" '[.[] | select(.ingredient_id==$id)][0].saldo')"
cek "kartu stok daging: mutasi 'pemakaian' tercatat" "V >= 1" \
  "$(api "$OWNER" GET "/stok/kartu/$DAG66?branch_id=$CK52_UTAMA" | jq '[.mutasi[] | select(.jenis=="pemakaian")] | length')"
# jalur single-row (langsung dikonfirmasi): 100 butir = 1 batch → daging −2000
api "$OWNER" POST /produksi "{\"branch_id\":\"$CK52_UTAMA\",\"ingredient_id\":\"$BASO66\",\"qty\":100}" > /dev/null
cek "single-row produksi ikut konsumsi (saldo daging 8000)" "abs(V - 8000) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$DAG66" '[.[] | select(.ingredient_id==$id)][0].saldo')"
# permintaan kedua: stok bahan mentah CK masih cukup → TANPA faktur bahan produksi.
# Reset stok JADI baso66 di CK ke 0 dulu: stok jadi CK yang ikut menutup
# kebutuhan store sudah diuji terpisah di atas — fokus tes ini: split tahap
# sebagian, jadi work-order memproduksi jumlah penuh (bukan dikurangi stok CK).
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
WO66B=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":40}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
PF66B=$(echo "$WO66B" | jq -r '.produksi.faktur_id')
cek "stok bahan mentah CK cukup → beli_produksi null" "V == 1" \
  "$(echo "$WO66B" | jq '(.beli_produksi == null) | if . then 1 else 0 end')"
# tahap sebagian (split): konsumsi hanya bagian yang selesai
BID66=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$PF66B" '[.rows[] | select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/produksi/tahap/$PF66B" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$BID66\",\"qty\":200}]}" > /dev/null
api "$OWNER" POST "/produksi/tahap/$PF66B" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$BID66\",\"qty\":100}]}" > /dev/null
cek "split: konsumsi separuh (100 butir → daging 8000−2000=6000)" "abs(V - 6000) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$DAG66" '[.[] | select(.ingredient_id==$id)][0].saldo')"
SISA66=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$PF66B" '[.rows[] | select(.faktur_id==$f and .status=="dikerjakan")][0].id')
api "$OWNER" POST "/produksi/tahap/$PF66B" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$SISA66\",\"qty\":100}]}" > /dev/null
cek "sisa split maju → konsumsi sisanya (daging 4000)" "abs(V - 4000) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$DAG66" '[.[] | select(.ingredient_id==$id)][0].saldo')"

# --- KIRIM DARI STOK CK: stok jadi yang sudah ada di CK dipindah ke cabang
#     (transfer, BUKAN produksi baru). CK 600, cabang 0. Permintaan 100 porsi
#     (butuh 500 baso66) → kirim 500 dari CK; kirim + terima → cabang +500,
#     CK −500. Rencana pakai saldo CABANG saja (jujur, cocok Kartu Stok). ---
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":600}]}" > /dev/null
KRM=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
KRMF=$(echo "$KRM" | jq -r '.kirim.faktur_id // empty')
cek "CK stok cukup → faktur KIRIM (transfer), tanpa produksi" "V == 1" \
  "$(echo "$KRM" | jq '((.kirim != null) and (.produksi == null)) | if . then 1 else 0 end')"
cek "faktur kirim: 1 bahan (baso66)" "V == 1" "$(echo "$KRM" | jq '.kirim.jumlah_baris')"
cek "sebelum diterima: cabang baso66 masih 0" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"
cek "sebelum diterima: CK baso66 masih 600" "abs(V - 600) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"
api "$OWNER" POST "/produksi/kirim/$KRMF" '{}' > /dev/null
api "$OWNER" POST "/penerimaan/$KRMF/terima" '{}' > /dev/null
cek "kirim dari stok: cabang baso66 naik jadi 500" "abs(V - 500) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"
cek "kirim dari stok: CK baso66 turun jadi 100 (600−500)" "abs(V - 100) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
PVK=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "rencana: saldo baso66 = stok CABANG saja (0, bukan +CK)" "abs(V) < 0.001" \
  "$(echo "$PVK" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].saldo')"
cek "rencana: kirim_ck baso66 = 100 (sisa stok CK bisa dikirim)" "abs(V - 100) < 0.001" \
  "$(echo "$PVK" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].kirim_ck')"
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null

# --- Perbaikan review: guard konsistensi resep & isolasi tenant ---
# flip pengadaan bahan yang masih jadi INPUT resep → 409 (rencana akan
# melewatkan kebutuhannya diam-diam); bahan bebas → boleh
cek "flip pengadaan input resep ke produksi ditolak (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$DAG66" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"pengadaan":"produksi"}')"
BEBAS66=$(api "$OWNER" POST /bahan '{"nama":"bahan bebas uji66","harga_beli":1000,"isi":10,"satuan":"pcs","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
cek "flip pengadaan bahan bebas (tanpa resep) → 200" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BEBAS66" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"pengadaan":"produksi"}')"
# guard "masih dipakai" tak boleh jadi oracle lintas-tenant: DELETE bahan
# milik tenant lain → 404 polos (bukan 409 yang membocorkan nama pemakainya)
cek "DELETE bahan tenant lain → 404 (tanpa bocor nama resep)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/bahan/$DAG66" -H "Authorization: Bearer $UJI")"
# pindah dini: tujuan kirim di ke='dikerjakan' DIABAIKAN — baris tetap di
# cabang asal (pindah dini merusak atribusi cabang konsumsi bahan resep)
FR66=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"mode\":\"pcs\",\"jumlah\":5}]}" | jq -r .faktur_id)
FR66_RID=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$FR66" '[.rows[] | select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/produksi/tahap/$FR66" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$FR66_RID\",\"qty\":5}],\"tujuan_branch_id\":\"$CB46_ID\"}" > /dev/null
cek "pindah dini diabaikan: baris tetap di CK & dikerjakan" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$FR66" '([.rows[] | select(.faktur_id==$f)] | (length==1) and all(.[]; .status=="dikerjakan")) | if . then 1 else 0 end')"
# ubah `isi` bahan jadi saat produksi masih berjalan → 409 (konsumsi memakai
# isi live — drift dari RAB); setelah selesai → boleh
cek "ubah isi bahan jadi saat produksi berjalan ditolak (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BASO66" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"isi":120}')"
api "$OWNER" POST "/produksi/tahap/$FR66" '{"ke":"menunggu"}' > /dev/null
cek "konsumsi tetap di cabang asal walau tujuan dikirim dini (daging 3900)" "abs(V - 3900) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$DAG66" '[.[] | select(.ingredient_id==$id)][0].saldo')"
cek "ubah isi setelah produksi selesai → 200" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BASO66" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"isi":120}')"
api "$OWNER" PUT "/bahan/$BASO66" '{"isi":100}' > /dev/null

# --- Req 1: PENGAMAN BAHAN BAKU sebelum "mulai dikerjakan" ---
# Bahan jadi baru dgn resep butuh bahan mentah yg stoknya 0 di CK → produksi
# TIDAK boleh dimulai (400) sampai bahan diterima/di-stok. Cek availability
# saja (bukan reservasi): dilakukan saat baris rencana → dikerjakan.
GBHN66=$(api "$OWNER" POST /bahan '{"nama":"garam guard66","harga_beli":8000,"isi":1000,"satuan":"gr","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
GJADI66=$(api "$OWNER" POST /bahan '{"nama":"baso guard66","harga_beli":40000,"isi":100,"satuan":"butir","pengadaan":"produksi","kategori":"baso"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$GJADI66/resep" "{\"komponen\":[{\"ingredient_id\":\"$GBHN66\",\"qty\":500}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$GBHN66\",\"qty\":0}]}" > /dev/null
# work-order: 100 butir baso guard66 (1 batch → butuh garam 500 gr)
GFK66=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$GJADI66\",\"mode\":\"batch\",\"jumlah\":1}]}" | jq -r .faktur_id)
GFK66_RID=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$GFK66" '[.rows[] | select(.faktur_id==$f)][0].id')
# Bahan baku kurang = PERINGATAN (409), BUKAN blokir keras — user boleh tetap
# proses dengan paksa=true.
cek "mulai dikerjakan tanpa bahan baku → PERINGATAN (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$GFK66" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikerjakan"}')"
cek "mulai dikerjakan SEBAGIAN tanpa bahan baku → PERINGATAN (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$GFK66" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$GFK66_RID\",\"qty\":100}]}")"
cek "peringatan: baris tetap rencana (belum diproses)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$GFK66" '([.rows[] | select(.faktur_id==$f)] | all(.[]; .status=="rencana")) | if . then 1 else 0 end')"
# paksa=true → tetap proses meski bahan kurang (stok garam masih 0)
cek "paksa=true: tetap mulai dikerjakan meski bahan kurang" "V == 1" \
  "$(api "$OWNER" POST "/produksi/tahap/$GFK66" '{"ke":"dikerjakan","paksa":true}' | jq '(.status=="dikerjakan") | if . then 1 else 0 end')"
# faktur baru: bahan di-stok cukup → mulai dikerjakan berhasil tanpa paksa
GFK66C=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$GJADI66\",\"mode\":\"batch\",\"jumlah\":1}]}" | jq -r .faktur_id)
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$GBHN66\",\"qty\":600}]}" > /dev/null
cek "setelah bahan di-stok: mulai dikerjakan berhasil (tanpa paksa)" "V == 1" \
  "$(api "$OWNER" POST "/produksi/tahap/$GFK66C" '{"ke":"dikerjakan"}' | jq '(.status=="dikerjakan") | if . then 1 else 0 end')"
# qty penuh butuh lebih dari stok (2 batch → garam 1000 > 600) → peringatan 409
GFK66B=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$GJADI66\",\"mode\":\"batch\",\"jumlah\":2}]}" | jq -r .faktur_id)
cek "bahan kurang utk qty penuh → PERINGATAN (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$GFK66B" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikerjakan"}')"

echo "== 67. Master Satuan + Tambah Bahan Baku (bulk) + kode produk =="
# Master satuan: bawaan terisi (pcs, gr, …)
cek "master satuan bawaan terisi (>= 10)" "V >= 10" "$(api "$OWNER" GET /satuan | jq 'length')"
cek "master satuan memuat 'pcs'" "V == 1" \
  "$(api "$OWNER" GET /satuan | jq '([.[] | select(.nama=="pcs")] | length == 1) | if . then 1 else 0 end')"
SAT_ID=$(api "$OWNER" POST /satuan '{"nama":"karung67","sort_order":50}' | jq -r .id)
cek "tambah satuan baru muncul di daftar" "V == 1" \
  "$(api "$OWNER" GET /satuan | jq --arg id "$SAT_ID" '[.[] | select(.id==$id)] | length')"
cek "satuan duplikat ditolak (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/satuan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"karung67"}')"
cek "POST satuan oleh KASIR ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/satuan" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"nama":"x67"}')"
cek "DELETE satuan tak terpakai berhasil (200)" "V == 200" "$(status_code "$OWNER" DELETE "/satuan/$SAT_ID")"
# satuan yang dipakai bahan tak boleh dihapus → 409 (pcs pasti dipakai)
PCS_ID=$(api "$OWNER" GET /satuan | jq -r '[.[] | select(.nama=="pcs")][0].id')
cek "DELETE satuan yang dipakai bahan ditolak (409)" "V == 409" "$(status_code "$OWNER" DELETE "/satuan/$PCS_ID")"

# Tambah Bahan Baku (bulk) — 2 baris, selalu jalur beli
BULK=$(api "$OWNER" POST /bahan/bulk '{"items":[{"nama":"bahan bulk A67","harga_beli":5000,"isi":100,"satuan":"gr","kategori":"lain","track_stok":true,"stok_minimum":10,"boleh_eceran":true},{"nama":"bahan bulk B67","harga_beli":2000,"isi":10,"satuan":"pcs","kategori":"minuman","track_stok":false,"stok_minimum":0,"boleh_eceran":false}]}')
cek "bulk membuat 2 bahan" "V == 2" "$(echo "$BULK" | jq '.jumlah')"
cek "bulk: semua bahan jalur beli" "V == 1" \
  "$(echo "$BULK" | jq '([.bahan[] | .pengadaan] | all(. == "beli")) | if . then 1 else 0 end')"
cek "bulk: kode terisi otomatis (tak null)" "V == 1" \
  "$(echo "$BULK" | jq '([.bahan[] | .kode] | all(. != null and . != "")) | if . then 1 else 0 end')"
cek "bulk: track_stok mengikuti baris (A true, B false)" "V == 1" \
  "$(echo "$BULK" | jq '([.bahan[] | select(.nama=="bahan bulk A67")][0].track_stok == true and [.bahan[] | select(.nama=="bahan bulk B67")][0].track_stok == false) | if . then 1 else 0 end')"
cek "bulk: boleh_eceran mengikuti baris" "V == 1" \
  "$(echo "$BULK" | jq '([.bahan[] | select(.nama=="bahan bulk A67")][0].boleh_eceran == true) | if . then 1 else 0 end')"
cek "bulk: bahan muncul di daftar /bahan" "V == 2" \
  "$(api "$OWNER" GET /bahan | jq '[.[] | select(.nama | startswith("bahan bulk "))] | length')"
# bulk field set PENUH (sama dgn form Ubah): min_beli, kemasan, complement, catatan
BULKF=$(api "$OWNER" POST /bahan/bulk '{"items":[{"nama":"bahan bulk full67","harga_beli":8000,"isi":4,"satuan":"pcs","min_beli":6,"is_packaging":true,"is_complement":true,"catatan":"catatan bulk"}]}')
BFID=$(echo "$BULKF" | jq -r '.bahan[0].id')
BF=$(api "$OWNER" GET /bahan | jq --arg id "$BFID" '[.[]|select(.id==$id)][0]')
cek "bulk full: min_beli tersimpan (6)" "V == 6" "$(echo "$BF" | jq '.min_beli')"
cek "bulk full: is_packaging tersimpan" "V == 1" "$(echo "$BF" | jq '.is_packaging|if . then 1 else 0 end')"
cek "bulk full: is_complement tersimpan" "V == 1" "$(echo "$BF" | jq '.is_complement|if . then 1 else 0 end')"
cek "bulk full: catatan tersimpan" "V == 1" "$(echo "$BF" | jq '(.catatan=="catatan bulk")|if . then 1 else 0 end')"

# Kode unik: dua baris nama sama → kode berbeda (suffix)
KEMBAR=$(api "$OWNER" POST /bahan/bulk '{"items":[{"nama":"kembar67","harga_beli":1,"isi":1,"satuan":"pcs"},{"nama":"kembar67","harga_beli":1,"isi":1,"satuan":"pcs"}]}')
cek "kode dua nama sama → berbeda (suffix)" "V == 1" \
  "$(echo "$KEMBAR" | jq '(.bahan[0].kode != .bahan[1].kode) | if . then 1 else 0 end')"
# Kode manual dihormati
MAN=$(api "$OWNER" POST /bahan '{"nama":"bahan kode manual67","kode":"MANUAL67","harga_beli":1,"isi":1,"satuan":"pcs"}')
cek "kode manual dihormati" "V == 1" "$(echo "$MAN" | jq '(.kode=="MANUAL67") | if . then 1 else 0 end')"

# Bahan produksi (jalur Resep) tetap bisa dibuat & dapat kode
PROD67=$(api "$OWNER" POST /bahan '{"nama":"baso produksi67","harga_beli":50000,"isi":100,"satuan":"butir","pengadaan":"produksi","kategori":"baso"}')
cek "bahan produksi tetap bisa dibuat (jalur Resep)" "V == 1" \
  "$(echo "$PROD67" | jq '(.pengadaan=="produksi" and .kode != null) | if . then 1 else 0 end')"

echo "== 68. Master Kategori Bahan (dinamis) + kategori kustom =="
# Master kategori bahan bawaan (baso/minuman/lain) terisi
cek "kategori bahan bawaan terisi (>= 3)" "V >= 3" "$(api "$OWNER" GET /kategori-bahan | jq 'length')"
cek "kategori bahan memuat 'baso'" "V == 1" \
  "$(api "$OWNER" GET /kategori-bahan | jq '([.[] | select(.nama=="baso")] | length == 1) | if . then 1 else 0 end')"
KB_ID=$(api "$OWNER" POST /kategori-bahan '{"nama":"frozen68","sort_order":20}' | jq -r .id)
cek "tambah kategori bahan muncul di daftar" "V == 1" \
  "$(api "$OWNER" GET /kategori-bahan | jq --arg id "$KB_ID" '[.[] | select(.id==$id)] | length')"
cek "PATCH kategori bahan mengubah nama" "V == 1" \
  "$(api "$OWNER" PATCH "/kategori-bahan/$KB_ID" '{"nama":"frozen68b"}' | jq '.nama=="frozen68b" | if . then 1 else 0 end')"
# kategori duplikat (huruf sama/beda) tak buat baru → kembalikan yang ada (idempoten)
cek "kategori bahan duplikat → balik yg ada (bukan duplikat)" "V == 1" \
  "$(api "$OWNER" POST /kategori-bahan '{"nama":"FROZEN68B"}' | jq --arg id "$KB_ID" '(.id==$id) | if . then 1 else 0 end')"
cek "POST kategori bahan oleh KASIR ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/kategori-bahan" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"nama":"x68"}')"
# Bahan dgn kategori KUSTOM baru (frozen68b) → diterima & tersimpan
KB_BAHAN=$(api "$OWNER" POST /bahan '{"nama":"es batu uji68","harga_beli":1000,"isi":10,"satuan":"pcs","kategori":"frozen68b"}')
cek "bahan dgn kategori kustom tersimpan" "V == 1" \
  "$(echo "$KB_BAHAN" | jq '(.kategori=="frozen68b") | if . then 1 else 0 end')"
# Kategori yang dipakai bahan tak boleh dihapus (409); yang tak terpakai → 200
cek "DELETE kategori bahan yang dipakai ditolak (409)" "V == 409" "$(status_code "$OWNER" DELETE "/kategori-bahan/$KB_ID")"
KB_KOSONG=$(api "$OWNER" POST /kategori-bahan '{"nama":"kosong68"}' | jq -r .id)
cek "DELETE kategori bahan tak terpakai berhasil (200)" "V == 200" "$(status_code "$OWNER" DELETE "/kategori-bahan/$KB_KOSONG")"
# Kategori MENU (/kategori) tetap berfungsi
cek "kategori menu (/kategori) tetap berfungsi" "V == 200" "$(status_code "$OWNER" GET /kategori)"

echo "== 69. Satuan beli vs satuan resep + harga per satuan resep =="
# garam: beli 1 dus = 24000; 1 dus = 14400 ml (satuan resep) → harga per ml = 1.6667
GARAM69=$(api "$OWNER" POST /bahan '{"nama":"garam uji69","harga_beli":24000,"isi":14400,"satuan":"ml","satuan_beli":"dus","kategori":"lain"}')
cek "satuan_beli tersimpan (dus)" "V == 1" \
  "$(echo "$GARAM69" | jq '(.satuan_beli=="dus") | if . then 1 else 0 end')"
cek "satuan resep tersimpan (ml)" "V == 1" \
  "$(echo "$GARAM69" | jq '(.satuan=="ml") | if . then 1 else 0 end')"
cek "harga per satuan resep = harga_beli/isi ≈ 1.6667" "abs(V - 1.66667) < 0.001" \
  "$(echo "$GARAM69" | jq '.harga_per_unit')"
# bulk: satuan_beli per baris tersimpan
BULK69=$(api "$OWNER" POST /bahan/bulk '{"items":[{"nama":"kaldu uji69","harga_beli":12000,"isi":600,"satuan":"ml","satuan_beli":"botol"},{"nama":"tepung tanpa satuanbeli69","harga_beli":10000,"isi":1000,"satuan":"gr"}]}')
cek "bulk: satuan_beli baris pertama = botol" "V == 1" \
  "$(echo "$BULK69" | jq '([.bahan[] | select(.nama=="kaldu uji69")][0].satuan_beli=="botol") | if . then 1 else 0 end')"
cek "bulk: baris tanpa satuan_beli → null (regresi)" "V == 1" \
  "$(echo "$BULK69" | jq '([.bahan[] | select(.nama=="tepung tanpa satuanbeli69")][0].satuan_beli==null) | if . then 1 else 0 end')"
# PUT: set & clear satuan_beli
G69ID=$(echo "$GARAM69" | jq -r .id)
cek "PUT set satuan_beli → tersimpan (karung)" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$G69ID" '{"satuan_beli":"karung"}' | jq '(.satuan_beli=="karung") | if . then 1 else 0 end')"
cek "PUT clear satuan_beli (null) → null" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$G69ID" '{"satuan_beli":null}' | jq '(.satuan_beli==null) | if . then 1 else 0 end')"
# Master Satuan: hitung pemakaian + tak bisa dihapus bila dipakai sebagai SATUAN BELI
api "$OWNER" POST /satuan '{"nama":"dus69del","sort_order":60}' > /dev/null
DUSDEL_ID=$(api "$OWNER" GET /satuan | jq -r '[.[] | select(.nama=="dus69del")][0].id')
cek "GET /satuan: dipakai=0 sebelum satuan terpakai" "V == 0" \
  "$(api "$OWNER" GET /satuan | jq '[.[] | select(.nama=="dus69del")][0].dipakai')"
api "$OWNER" POST /bahan '{"nama":"bahan pakai dus69","harga_beli":24000,"isi":14400,"satuan":"gr","satuan_beli":"dus69del","kategori":"lain"}' > /dev/null
cek "GET /satuan: dipakai=1 setelah jadi satuan beli" "V == 1" \
  "$(api "$OWNER" GET /satuan | jq '[.[] | select(.nama=="dus69del")][0].dipakai')"
cek "DELETE satuan yg dipakai sebagai satuan BELI ditolak (409)" "V == 409" \
  "$(status_code "$OWNER" DELETE "/satuan/$DUSDEL_ID")"

echo "== 70. Resep produksi: overhead, harga ikut resep, stok minimum CK/toko =="
# bahan produksi minimal (batch/harga/stok diatur lewat panel resep setelahnya)
BP70=$(api "$OWNER" POST /bahan '{"nama":"baso uji70","harga_beli":0,"isi":1,"satuan":"pcs","kategori":"baso","pengadaan":"produksi"}')
BP70_ID=$(echo "$BP70" | jq -r .id)
cek "default overhead_x = 1" "V == 1" "$(echo "$BP70" | jq '.overhead_x')"
cek "default stok_minimum_toko = 0" "V == 0" "$(echo "$BP70" | jq '.stok_minimum_toko')"
# bahan mentah Rp20/gr → resep 500 gr = biaya batch Rp10.000
BM70_ID=$(api "$OWNER" POST /bahan '{"nama":"tepung uji70","harga_beli":20000,"isi":1000,"satuan":"gr","kategori":"lain"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$BP70_ID/resep" "{\"komponen\":[{\"ingredient_id\":\"$BM70_ID\",\"qty\":500}]}" > /dev/null
# pengaturan batch dari web: 45 butir, overhead 1.2 → harga batch = 10000×1.2 = 12000
B70=$(api "$OWNER" PUT "/bahan/$BP70_ID" '{"isi":45,"satuan":"butir","overhead_x":1.2,"stok_minimum":5,"stok_minimum_toko":2,"harga_beli":12000}')
cek "overhead_x tersimpan (1.2)" "abs(V - 1.2) < 0.0001" "$(echo "$B70" | jq '.overhead_x')"
cek "stok_minimum CK tersimpan (5)" "V == 5" "$(echo "$B70" | jq '.stok_minimum')"
cek "stok_minimum_toko tersimpan (2)" "V == 2" "$(echo "$B70" | jq '.stok_minimum_toko')"
cek "harga per satuan resep = 12000/45 ≈ 266.67" "abs(V - 266.667) < 0.01" \
  "$(echo "$B70" | jq '.harga_per_unit')"
# ambang "menipis" per tipe cabang: CK pakai stok_minimum, TOKO pakai stok_minimum_toko
api "$OWNER" PUT "/bahan/$BM70_ID" '{"stok_minimum":10,"stok_minimum_toko":3}' > /dev/null
cek "stok di CK: ambang = stok_minimum (10)" "V == 10" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK47_ID" | jq --arg id "$BM70_ID" '[.[] | select(.ingredient_id==$id)][0].stok_minimum')"
cek "stok di toko: ambang = stok_minimum_toko (3)" "V == 3" \
  "$(api "$OWNER" GET "/stok?branch_id=$ST55_ID" | jq --arg id "$BM70_ID" '[.[] | select(.ingredient_id==$id)][0].stok_minimum')"

echo "== 71. Permintaan: beli produk jadi dikirim ke cabang + pemroses tercatat =="
# bahan beli produk jadi (isi 24/botol) + menu baru berkomponen bahan itu saja
SIR71=$(api "$OWNER" POST /bahan '{"nama":"sirup uji71","harga_beli":24000,"isi":24,"satuan":"botol","pengadaan":"beli","kategori":"minuman"}' | jq -r .id)
MENU71=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji71\",\"category_id\":\"$CAT66\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":10000,\"komponen\":[{\"ingredient_id\":\"$SIR71\",\"qty\":1}]}" | jq -r .id)
# permintaan TANPA supplier — supplier tak lagi dipilih saat buat permintaan
WO71=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU71\",\"porsi\":10}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
BF71=$(echo "$WO71" | jq -r '.beli.faktur_id')
cek "permintaan tanpa supplier menghasilkan faktur beli" "V == 1" \
  "$([ -n "$BF71" ] && [ "$BF71" != "null" ] && echo 1 || echo 0)"
cek "beli produk jadi: lahir di CK, tujuan=store, tanpa supplier" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF71" --arg s "$CB46_ID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .tujuan_branch_id==$s and .supplier==null and .status=="rencana")) | if . then 1 else 0 end')"
# yang mengubah status ke DIPROSES tercatat sebagai pemroses (self-assign)
api "$TCK58" POST "/pembelian/tahap/$BF71" '{"ke":"dikerjakan"}' > /dev/null
cek "pemroses tercatat otomatis = tim CK yang memproses" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF71" --arg u "$U58_ID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .worker_id==$u and .status=="dikerjakan")) | if . then 1 else 0 end')"
# TIBA DI CK (menunggu): semua barang KUMPUL DI CK dulu — belum pindah
api "$TCK58" POST "/pembelian/tahap/$BF71" '{"ke":"menunggu"}' > /dev/null
cek "tiba di CK: semua barang masih di CK (menunggu)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF71" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="menunggu")) | if . then 1 else 0 end')"
cek "belum muncul di Penerimaan store (belum dikirim)" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$BF71" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "transit di CK tidak masuk Penerimaan CK (bukan barang CK)" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CK52_UTAMA" | jq --arg f "$BF71" '[.rows[] | select(.faktur_id==$f)] | length')"
# KIRIM KE CABANG (dokumen kirim) → baris pindah ke store, tetap menunggu
api "$TCK58" POST "/pembelian/kirim/$BF71" '{}' > /dev/null
cek "kirim: baris pindah ke store (menunggu)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$BF71" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="menunggu")) | if . then 1 else 0 end')"
cek "kirim: jejak faktur tetap terlihat di CK (dari_branch_id), baris kini di store" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF71" --arg s "$CB46_ID" '([.rows[] | select(.faktur_id==$f)] | (length > 0) and all(.[]; .branch_id == $s)) | if . then 1 else 0 end')"
cek "kiriman beli muncul di Penerimaan store" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$BF71" '([.rows[] | select(.faktur_id==$f and .jalur=="beli")] | length > 0) | if . then 1 else 0 end')"
cek "log faktur: aksi 'Dikirim ke' tercatat" "V >= 1" \
  "$(api "$OWNER" GET "/pembelian/log/$BF71" | jq '[.rows[] | select(.aksi | startswith("Dikirim ke"))] | length')"
# store terima → stok masuk STORE, bukan CK (10 butuh → 1 kemasan = 24 botol)
api "$OWNER" POST "/penerimaan/$BF71/terima" > /dev/null
cek "terima: saldo sirup di store = 24" "abs(V - 24) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$SIR71" '[.[] | select(.ingredient_id==$i)][0].saldo')"
cek "stok sirup di CK tetap 0" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$SIR71" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')"

echo "== 72. Supplier per bahan: multi-supplier + supplier utama =="
BH72=$(api "$OWNER" POST /bahan '{"nama":"gula uji72","harga_beli":15000,"isi":1000,"satuan":"gr","kategori":"lain"}')
BH72_ID=$(echo "$BH72" | jq -r .id)
cek "bahan baru: supplier_utama null + jumlah_supplier 0" "V == 1" \
  "$(echo "$BH72" | jq '((.supplier_utama==null) and (.jumlah_supplier==0)) | if . then 1 else 0 end')"
SUPA72=$(api "$OWNER" POST /supplier '{"nama":"Toko Manis 72"}' | jq -r .id)
SUPB72=$(api "$OWNER" POST /supplier '{"nama":"Grosir Pasar 72","telepon":"0811"}' | jq -r .id)
# pasang 2 supplier, A utama
LS72=$(api "$OWNER" PUT "/bahan/$BH72_ID/supplier" "{\"items\":[{\"supplier_id\":\"$SUPA72\",\"is_utama\":true},{\"supplier_id\":\"$SUPB72\"}]}")
cek "PUT 2 supplier → daftar berisi 2" "V == 2" "$(echo "$LS72" | jq 'length')"
cek "supplier utama = Toko Manis 72 (urut pertama)" "V == 1" \
  "$(echo "$LS72" | jq '((.[0].nama=="Toko Manis 72") and (.[0].is_utama==true)) | if . then 1 else 0 end')"
cek "hanya SATU utama" "V == 1" "$(echo "$LS72" | jq '[.[] | select(.is_utama)] | length')"
cek "GET /bahan: supplier_utama + jumlah_supplier terisi" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$BH72_ID" '[.[] | select(.id==$id)][0] | ((.supplier_utama=="Toko Manis 72") and (.jumlah_supplier==2)) | if . then 1 else 0 end')"
# pindah utama ke B
api "$OWNER" PUT "/bahan/$BH72_ID/supplier" "{\"items\":[{\"supplier_id\":\"$SUPA72\"},{\"supplier_id\":\"$SUPB72\",\"is_utama\":true}]}" > /dev/null
cek "pindah utama → Grosir Pasar 72" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$BH72_ID/supplier" | jq '([.[] | select(.is_utama)] | (length==1) and (.[0].nama=="Grosir Pasar 72")) | if . then 1 else 0 end')"
# dua utama sekaligus → 400
cek "dua utama sekaligus → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BH72_ID/supplier" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"supplier_id\":\"$SUPA72\",\"is_utama\":true},{\"supplier_id\":\"$SUPB72\",\"is_utama\":true}]}")"
# tanpa penanda utama → item pertama otomatis utama
api "$OWNER" PUT "/bahan/$BH72_ID/supplier" "{\"items\":[{\"supplier_id\":\"$SUPB72\"}]}" > /dev/null
cek "tanpa penanda utama → item pertama jadi utama" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$BH72_ID/supplier" | jq '((length==1) and .[0].is_utama) | if . then 1 else 0 end')"
# supplier tak dikenal → 400
cek "supplier tak dikenal → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BH72_ID/supplier" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"items":[{"supplier_id":"00000000-0000-4000-8000-000000000000"}]}')"
# kasir tak boleh mengubah, tapi boleh melihat
cek "kasir PUT supplier bahan → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BH72_ID/supplier" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"items":[]}')"
cek "kasir GET supplier bahan → boleh (1 baris)" "V == 1" \
  "$(api "$KASIR" GET "/bahan/$BH72_ID/supplier" | jq 'length')"
# kosongkan daftar
api "$OWNER" PUT "/bahan/$BH72_ID/supplier" '{"items":[]}' > /dev/null
cek "PUT items kosong → daftar kosong" "V == 0" \
  "$(api "$OWNER" GET "/bahan/$BH72_ID/supplier" | jq 'length')"
# bahan PRODUKSI SENDIRI dibuat di dapur — tidak memakai supplier
BP72=$(api "$OWNER" POST /bahan '{"nama":"baso uji72","harga_beli":0,"isi":1,"satuan":"pcs","kategori":"baso","pengadaan":"produksi"}' | jq -r .id)
cek "bahan produksi sendiri: PUT supplier → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BP72/supplier" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"supplier_id\":\"$SUPA72\"}]}")"
# bahan beli ber-supplier lalu diubah jadi produksi → tautan supplier otomatis terhapus
api "$OWNER" PUT "/bahan/$BH72_ID/supplier" "{\"items\":[{\"supplier_id\":\"$SUPA72\",\"is_utama\":true}]}" > /dev/null
FLIP72=$(api "$OWNER" PUT "/bahan/$BH72_ID" '{"pengadaan":"produksi"}')
cek "flip ke produksi → supplier_utama null + jumlah_supplier 0" "V == 1" \
  "$(echo "$FLIP72" | jq '((.supplier_utama==null) and (.jumlah_supplier==0)) | if . then 1 else 0 end')"
cek "flip ke produksi → daftar supplier kosong" "V == 0" \
  "$(api "$OWNER" GET "/bahan/$BH72_ID/supplier" | jq 'length')"

echo "== 73. Supplier tampil saat diproses + transaksi tercatat + kartu supplier =="
SUPC73=$(api "$OWNER" POST /supplier '{"nama":"Pasar Induk 73","telepon":"0812","alamat":"Jl. Pasar Induk No. 73, Blok C"}' | jq -r .id)
BH73=$(api "$OWNER" POST /bahan '{"nama":"cabai uji73","harga_beli":40000,"isi":1000,"satuan":"gr","satuan_beli":"karung","kategori":"lain"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$BH73/supplier" "{\"items\":[{\"supplier_id\":\"$SUPC73\",\"is_utama\":true}]}" > /dev/null
# faktur beli TANPA supplier → baris memuat info supplier utama bahan + alamat
FK73=$(api "$OWNER" POST /pembelian/faktur "{\"no_faktur\":\"SUP-73\",\"items\":[{\"ingredient_id\":\"$BH73\",\"mode\":\"pcs\",\"jumlah\":2}]}" | jq -r .faktur_id)
B73=$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK73" '[.rows[] | select(.faktur_id==$f)][0]')
cek "baris memuat supplier utama bahan (info beli di mana)" "V == 1" \
  "$(echo "$B73" | jq '(.supplier_bahan=="Pasar Induk 73") | if . then 1 else 0 end')"
cek "baris memuat alamat supplier bahan" "V == 1" \
  "$(echo "$B73" | jq '(.supplier_bahan_alamat=="Jl. Pasar Induk No. 73, Blok C") | if . then 1 else 0 end')"
cek "baris memuat satuan_beli (konversi kemasan dokumen belanja)" "V == 1" \
  "$(echo "$B73" | jq '(.satuan_beli=="karung") | if . then 1 else 0 end')"
cek "faktur belum menyebut supplier (rencana)" "V == 1" \
  "$(echo "$B73" | jq '(.supplier==null) | if . then 1 else 0 end')"
# mulai DIPROSES → transaksi otomatis tercatat ke supplier utama bahan
api "$OWNER" POST "/pembelian/tahap/$FK73" '{"ke":"dikerjakan"}' > /dev/null
cek "diproses: transaksi tercatat ke supplier utama" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK73" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .supplier=="Pasar Induk 73")) | if . then 1 else 0 end')"
# kartu supplier: transaksi + bahan tertaut + ringkasan
KARTU73=$(api "$OWNER" GET "/supplier/$SUPC73/kartu")
cek "kartu: profil supplier benar" "V == 1" \
  "$(echo "$KARTU73" | jq '(.supplier.nama=="Pasar Induk 73" and .supplier.alamat=="Jl. Pasar Induk No. 73, Blok C") | if . then 1 else 0 end')"
cek "kartu: transaksi faktur SUP-73 tercatat" "V >= 1" \
  "$(echo "$KARTU73" | jq '[.rows[] | select(.no_faktur=="SUP-73")] | length')"
cek "kartu: jumlah_transaksi >= 1" "V >= 1" "$(echo "$KARTU73" | jq '.jumlah_transaksi')"
cek "kartu: bahan tertaut memuat cabai uji73 (★ utama)" "V == 1" \
  "$(echo "$KARTU73" | jq '([.bahan[] | select(.nama=="cabai uji73" and .is_utama)] | length == 1) | if . then 1 else 0 end')"
cek "kartu: belum ada belanja terkonfirmasi (0)" "V == 0" "$(echo "$KARTU73" | jq '.total_belanja')"
# selesaikan sampai diterima → total_belanja terisi
api "$OWNER" POST "/pembelian/tahap/$FK73" '{"ke":"menunggu"}' > /dev/null
ID73=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK73" '[.rows[] | select(.faktur_id==$f)][0].id')
Q73=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK73" '[.rows[] | select(.faktur_id==$f)][0].qty')
api "$OWNER" POST "/pembelian/tahap/$FK73" "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$ID73\",\"qty\":$Q73}]}" > /dev/null
cek "kartu: total belanja terkonfirmasi = Rp80 (2 gr × Rp40/gr)" "V == 80" \
  "$(api "$OWNER" GET "/supplier/$SUPC73/kartu" | jq '.total_belanja')"
# faktur yang SUDAH menyebut supplier tidak ditimpa supplier utama bahan
SUPD73=$(api "$OWNER" POST /supplier '{"nama":"Toko Pilihan 73"}' | jq -r .id)
FK73B=$(api "$OWNER" POST /pembelian/faktur "{\"no_faktur\":\"SUP-73B\",\"supplier_id\":\"$SUPD73\",\"items\":[{\"ingredient_id\":\"$BH73\",\"mode\":\"pcs\",\"jumlah\":1}]}" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK73B" '{"ke":"dikerjakan"}' > /dev/null
cek "supplier pilihan manual tidak ditimpa saat diproses" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK73B" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .supplier=="Toko Pilihan 73")) | if . then 1 else 0 end')"

echo "== 74. Satu faktur belanja per permintaan (campuran: ke cabang + tetap di CK) =="
J74=$(api "$OWNER" POST /bahan '{"nama":"kecap uji74","harga_beli":12000,"isi":12,"satuan":"botol","pengadaan":"beli","kategori":"minuman"}' | jq -r .id)
BP74=$(api "$OWNER" POST /bahan '{"nama":"sambal uji74","harga_beli":0,"isi":10,"satuan":"pcs","kategori":"baso","pengadaan":"produksi"}' | jq -r .id)
CB74=$(api "$OWNER" POST /bahan '{"nama":"cabe uji74","harga_beli":30000,"isi":1000,"satuan":"gr","kategori":"lain"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$BP74/resep" "{\"komponen\":[{\"ingredient_id\":\"$CB74\",\"qty\":500}]}" > /dev/null
MENU74=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji74\",\"category_id\":\"$CAT66\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":12000,\"komponen\":[{\"ingredient_id\":\"$J74\",\"qty\":1},{\"ingredient_id\":\"$BP74\",\"qty\":1}]}" | jq -r .id)
# 10 porsi → beli kecap (produk jadi, ke cabang) + produksi sambal + beli cabe (bahan produksi, di CK)
WO74=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU74\",\"porsi\":10}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
BF74=$(echo "$WO74" | jq -r '.beli.faktur_id')
cek "beli & beli_produksi memakai SATU faktur yang sama" "V == 1" \
  "$(echo "$WO74" | jq '((.beli.faktur_id != null) and (.beli.faktur_id == .beli_produksi.faktur_id)) | if . then 1 else 0 end')"
B74=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF74" '[.rows[] | select(.faktur_id==$f)]')
cek "faktur berisi 2 baris (produk jadi + bahan produksi)" "V == 2" "$(echo "$B74" | jq 'length')"
cek "baris produk jadi bertujuan cabang" "V == 1" \
  "$(echo "$B74" | jq --arg i "$J74" --arg s "$CB46_ID" '([.[] | select(.ingredient_id==$i)][0].tujuan_branch_id == $s) | if . then 1 else 0 end')"
cek "baris bahan produksi tetap di CK (tujuan null)" "V == 1" \
  "$(echo "$B74" | jq --arg i "$CB74" '([.[] | select(.ingredient_id==$i)][0].tujuan_branch_id == null) | if . then 1 else 0 end')"
cek "permintaan: bagian beli & bahan produksi merujuk faktur sama" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg f "$BF74" '[.[] | select(.beli.faktur_id==$f)][0] | (.beli.faktur_id == .beli_produksi.faktur_id) | if . then 1 else 0 end')"
# proses → TIBA DI CK (baris produk jadi) → KIRIM ke cabang; bahan produksi tinggal
api "$OWNER" POST "/pembelian/tahap/$BF74" '{"ke":"dikerjakan"}' > /dev/null
IDJ74=$(echo "$B74" | jq -r --arg i "$J74" '[.[] | select(.ingredient_id==$i)][0].id')
QJ74=$(echo "$B74" | jq -r --arg i "$J74" '[.[] | select(.ingredient_id==$i)][0].qty')
api "$OWNER" POST "/pembelian/tahap/$BF74" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$IDJ74\",\"qty\":$QJ74}]}" > /dev/null
cek "tiba di CK: kedua baris masih di CK (jadi=menunggu, produksi=dikerjakan)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF74" '([.rows[] | select(.faktur_id==$f)] | (length==2) and (([.[] | select(.status=="menunggu")] | length)==1) and (([.[] | select(.status=="dikerjakan")] | length)==1)) | if . then 1 else 0 end')"
api "$OWNER" POST "/pembelian/kirim/$BF74" '{}' > /dev/null
cek "kirim: baris produk jadi pindah ke cabang (menunggu)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$BF74" '([.rows[] | select(.faktur_id==$f)] | (length==1) and (.[0].status=="menunggu")) | if . then 1 else 0 end')"
cek "bahan produksi masih di CK (dikerjakan) + jejak kiriman terlihat" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF74" --arg i "$CB74" --arg c "$CK52_UTAMA" '([.rows[] | select(.faktur_id==$f)] | (length==2) and (([.[] | select(.ingredient_id==$i and .status=="dikerjakan" and .branch_id==$c)] | length)==1)) | if . then 1 else 0 end')"
# baris bertujuan cabang tak boleh dikonfirmasi di CK — barangnya sudah pindah,
# yang berhak menutupnya adalah orang di cabang lewat tombol Terima (§158)
cek "konfirmasi baris bertujuan cabang → 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$BF74" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$IDJ74\",\"qty\":$QJ74}]}")"
# bahan produksi diterima di CK (baris tanpa tujuan boleh dikonfirmasi)
IDC74=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$BF74" --arg i "$CB74" '[.rows[] | select(.faktur_id==$f and .ingredient_id==$i)][0].id')
QC74=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$BF74" --arg i "$CB74" '[.rows[] | select(.faktur_id==$f and .ingredient_id==$i)][0].qty')
api "$OWNER" POST "/pembelian/tahap/$BF74" "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$IDC74\",\"qty\":$QC74}]}" > /dev/null
cek "bahan produksi masuk stok CK (cabe 1000 gr)" "abs(V - 1000) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$CB74" '[.[] | select(.ingredient_id==$i)][0].saldo')"
# produk jadi diterima di cabang lewat Penerimaan → stok cabang
api "$OWNER" POST "/penerimaan/$BF74/terima" > /dev/null
cek "produk jadi masuk stok cabang (kecap 12 botol)" "abs(V - 12) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$J74" '[.[] | select(.ingredient_id==$i)][0].saldo')"
cek "stok kecap di CK tetap 0" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$J74" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')"

echo "== 75. Hapus permintaan → semua fakturnya soft-delete + dapat dipulihkan =="
# permintaan campuran baru (produksi + belanja bahan produksi).
# Reset stok JADI baso66 di CK ke 0 → work-order memproduksi penuh (bukan
# ditutup stok jadi CK) sehingga faktur produksi & bahan produksi benar terbit.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
MENU75=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji75\",\"category_id\":\"$CAT66\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":15000,\"komponen\":[{\"ingredient_id\":\"$BASO66\",\"qty\":5}]}" | jq -r .id)
WO75=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU75\",\"porsi\":30}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
PF75=$(echo "$WO75" | jq -r '.produksi.faktur_id')
BP75=$(echo "$WO75" | jq -r '.beli_produksi.faktur_id')
RID75=$(api "$OWNER" GET /rekomendasi/permintaan | jq -r --arg p "$PF75" '[.[] | select(.produksi.faktur_id==$p)][0].rencana_id')
cek "permintaan baru tampil di Data Permintaan Stok" "V == 1" \
  "$([ -n "$RID75" ] && [ "$RID75" != "null" ] && echo 1 || echo 0)"
cek "faktur produksi permintaan ada di /produksi" "V >= 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$PF75" '[.rows[] | select(.faktur_id==$f)] | length')"
# HAPUS permintaan (tanpa password) → semua fakturnya soft-delete
api "$OWNER" DELETE "/rekomendasi/permintaan/$RID75" > /dev/null
cek "hapus permintaan → hilang dari Data Permintaan Stok" "V == 0" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg r "$RID75" '[.[] | select(.rencana_id==$r)] | length')"
cek "hapus permintaan → faktur produksi hilang dari /produksi" "V == 0" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$PF75" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "hapus permintaan → faktur bahan produksi hilang dari /pembelian" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BP75" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "hapus permintaan → faktur produksi masuk Tempat Sampah" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg f "$PF75" '([.[] | select(.jenis=="produksi" and .key==$f)] | length==1) | if . then 1 else 0 end')"
cek "hapus permintaan → faktur bahan produksi masuk Tempat Sampah" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg f "$BP75" '([.[] | select(.jenis=="pembelian" and .key==$f)] | length==1) | if . then 1 else 0 end')"
# pulihkan faktur produksi → permintaan muncul lagi (bagian produksi kembali)
api "$OWNER" POST /sampah/pulihkan "{\"jenis\":\"produksi\",\"key\":\"$PF75\"}" > /dev/null
cek "pulihkan faktur produksi → permintaan muncul lagi" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg r "$RID75" '[.[] | select(.rencana_id==$r)] | length')"
# rencana_id tak dikenal → 404
cek "hapus permintaan rencana_id asing → 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/rekomendasi/permintaan/00000000-0000-4000-8000-000000000000" -H "Authorization: Bearer $OWNER")"

echo "== 76. Impor CSV bahan baku: mode tambah & perbarui =="
# mode "tambah": 2 bahan baru masuk
IMP1=$(api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"kode":"GRM76","nama":"garam uji76","kategori":"lain","jenis":"beli","harga_beli":4000,"isi":1,"satuan":"pcs"},{"nama":"lada uji76","jenis":"beli","harga_beli":8000,"isi":100,"satuan":"gr","satuan_beli":"bungkus","stok_minimum":20}]}')
cek "impor tambah: 2 ditambah, 0 diperbarui" "V == 1" \
  "$(echo "$IMP1" | jq '((.ditambah==2) and (.diperbarui==0) and ((.gagal|length)==0)) | if . then 1 else 0 end')"
cek "impor tambah: garam uji76 tersimpan (harga 4000)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[] | select(.nama=="garam uji76")][0].harga_beli==4000) | if . then 1 else 0 end')"
cek "impor tambah: lada satuan_beli & harga/unit (8000/100=80)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[] | select(.nama=="lada uji76")][0] | (.satuan_beli=="bungkus") and (.harga_per_unit==80)) | if . then 1 else 0 end')"
# mode "tambah" lagi dgn kode sama → dilewati (tak ditimpa)
IMP2=$(api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"kode":"GRM76","nama":"garam uji76","jenis":"beli","harga_beli":9999,"isi":1,"satuan":"pcs"}]}')
cek "impor tambah: bahan sudah ada → dilewati (bukan ditimpa)" "V == 1" \
  "$(echo "$IMP2" | jq '((.ditambah==0) and (.dilewati==1)) | if . then 1 else 0 end')"
cek "impor tambah: harga garam TETAP 4000 (tak ditimpa)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[] | select(.nama=="garam uji76")][0].harga_beli==4000) | if . then 1 else 0 end')"
# mode "perbarui": garam ditimpa jadi 5000; bahan baru ikut ditambah
IMP3=$(api "$OWNER" POST /bahan/import '{"mode":"perbarui","items":[{"kode":"GRM76","nama":"garam uji76","jenis":"beli","harga_beli":5000,"isi":1,"satuan":"pcs","kategori":"baso"},{"nama":"cuka uji76","jenis":"beli","harga_beli":6000,"isi":100,"satuan":"ml"}]}')
cek "impor perbarui: 1 ditambah + 1 diperbarui" "V == 1" \
  "$(echo "$IMP3" | jq '((.ditambah==1) and (.diperbarui==1)) | if . then 1 else 0 end')"
cek "impor perbarui: garam ditimpa jadi 5000 + kategori baso" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[] | select(.nama=="garam uji76")][0] | (.harga_beli==5000) and (.kategori=="baso")) | if . then 1 else 0 end')"
# cocok via NAMA (tanpa kode) juga memperbarui bahan yang sama
IMP4=$(api "$OWNER" POST /bahan/import '{"mode":"perbarui","items":[{"nama":"garam uji76","jenis":"beli","harga_beli":5500,"isi":1,"satuan":"pcs"}]}')
cek "impor perbarui: cocok via nama (tanpa kode) → diperbarui" "V == 1" \
  "$(echo "$IMP4" | jq '((.diperbarui==1) and (.ditambah==0)) | if . then 1 else 0 end')"
cek "impor perbarui via nama: harga garam jadi 5500" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[] | select(.nama=="garam uji76")][0].harga_beli==5500) | if . then 1 else 0 end')"
# Bahan di Tempat Sampah (nonaktif) TAK dianggap "sudah ada" → dipulihkan saat impor
api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"kode":"SMP76","nama":"sampah uji76","jenis":"beli","harga_beli":3000,"isi":1,"satuan":"pcs"}]}' > /dev/null
SMP76_ID=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.nama=="sampah uji76")][0].id')
api "$OWNER" DELETE "/bahan/$SMP76_ID" > /dev/null
cek "hapus bahan → hilang dari daftar aktif" "V == 0" \
  "$(api "$OWNER" GET /bahan | jq '[.[] | select(.nama=="sampah uji76")] | length')"
IMP5=$(api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"kode":"SMP76","nama":"sampah uji76","jenis":"beli","harga_beli":7000,"isi":1,"satuan":"pcs"}]}')
cek "impor: bahan di Tempat Sampah dipulihkan (bukan dilewati)" "V == 1" \
  "$(echo "$IMP5" | jq '((.dipulihkan==1) and (.dilewati==0) and (.ditambah==0)) | if . then 1 else 0 end')"
cek "impor: bahan dipulihkan muncul lagi di daftar aktif (harga 7000)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[] | select(.nama=="sampah uji76")][0].harga_beli==7000) | if . then 1 else 0 end')"
# match via NAMA saja (tanpa kode) juga memulihkan bahan di Tempat Sampah
api "$OWNER" DELETE "/bahan/$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.nama=="sampah uji76")][0].id')" > /dev/null
IMP6=$(api "$OWNER" POST /bahan/import '{"mode":"perbarui","items":[{"nama":"sampah uji76","jenis":"beli","harga_beli":7500,"isi":1,"satuan":"pcs"}]}')
cek "impor perbarui via nama: bahan di Tempat Sampah dipulihkan" "V == 1" \
  "$(echo "$IMP6" | jq '((.dipulihkan==1) and (.dilewati==0)) | if . then 1 else 0 end')"
# impor field set PENUH (kolom = form Ubah): min_beli, kemasan, complement
IMP7=$(api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"nama":"impor full76","jenis":"beli","harga_beli":1000,"isi":1,"satuan":"pcs","min_beli":12,"kemasan":true,"complement":true}]}')
cek "impor full: 1 ditambah" "V == 1" "$(echo "$IMP7" | jq '(.ditambah==1)|if . then 1 else 0 end')"
IMPF=$(api "$OWNER" GET /bahan | jq '[.[]|select(.nama=="impor full76")][0]')
cek "impor full: min_beli tersimpan (12)" "V == 12" "$(echo "$IMPF" | jq '.min_beli')"
cek "impor full: kemasan→is_packaging tersimpan" "V == 1" "$(echo "$IMPF" | jq '.is_packaging|if . then 1 else 0 end')"
cek "impor full: complement→is_complement tersimpan" "V == 1" "$(echo "$IMPF" | jq '.is_complement|if . then 1 else 0 end')"
# perbarui: matikan kemasan/complement + ubah min_beli → tersimpan
api "$OWNER" POST /bahan/import '{"mode":"perbarui","items":[{"nama":"impor full76","jenis":"beli","harga_beli":1000,"isi":1,"satuan":"pcs","min_beli":0,"kemasan":false,"complement":false}]}' > /dev/null
IMPF2=$(api "$OWNER" GET /bahan | jq '[.[]|select(.nama=="impor full76")][0]')
cek "impor perbarui: kemasan/complement dimatikan" "V == 1" \
  "$(echo "$IMPF2" | jq '((.is_packaging==false) and (.is_complement==false) and (.min_beli==0))|if . then 1 else 0 end')"
# ── kolom yang TIDAK dikirim tak boleh ditimpa ────────────────────────────────
# Berkas CSV berisi `nama,harga_beli` saja (daftar harga supplier) adalah bentuk
# yang paling lazim. Dulu tiap kolom yang tak ada di berkas tetap terkirim
# dengan nilai bawaannya dan mode "perbarui" menuliskannya ke SETIAP bahan yang
# cocok: isi→1 (HPP per satuan melonjak sebesar isinya), satuan→"pcs",
# kategori→"lain", kemasan→mati, stok_minimum→0. Semuanya tanpa satu pesan pun.
api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"kode":"UTH76","nama":"utuh uji76","jenis":"beli","kategori":"baso","harga_beli":48000,"isi":24,"satuan":"botol","satuan_beli":"dus","stok_minimum":7,"min_beli":3,"masa_simpan_hari":45,"lead_time_hari":4,"boleh_eceran":true,"lacak_stok":true,"kemasan":true,"complement":true,"catatan":"catatan awal"}]}' > /dev/null
# hanya nama + harga yang dikirim — persis berkas `nama,harga_beli`
IMP8=$(api "$OWNER" POST /bahan/import '{"mode":"perbarui","items":[{"nama":"utuh uji76","harga_beli":51000}]}')
cek "impor sebagian: 1 diperbarui" "V == 1" \
  "$(echo "$IMP8" | jq '((.diperbarui==1) and (.ditambah==0) and ((.gagal|length)==0))|if . then 1 else 0 end')"
UTH=$(api "$OWNER" GET /bahan | jq '[.[]|select(.nama=="utuh uji76")][0]')
cek "impor sebagian: harga yang DIKIRIM tersimpan (51000)" "V == 51000" "$(echo "$UTH" | jq '.harga_beli')"
cek "impor sebagian: isi TIDAK ditimpa jadi 1" "V == 24" "$(echo "$UTH" | jq '.isi')"
cek "impor sebagian: satuan TIDAK ditimpa jadi pcs" "V == 1" \
  "$(echo "$UTH" | jq '((.satuan=="botol") and (.satuan_beli=="dus"))|if . then 1 else 0 end')"
cek "impor sebagian: kategori TIDAK ditimpa jadi lain" "V == 1" \
  "$(echo "$UTH" | jq '(.kategori=="baso")|if . then 1 else 0 end')"
cek "impor sebagian: kemasan & complement TIDAK padam" "V == 1" \
  "$(echo "$UTH" | jq '((.is_packaging==true) and (.is_complement==true))|if . then 1 else 0 end')"
cek "impor sebagian: ambang & jadwal TIDAK dinolkan" "V == 1" \
  "$(echo "$UTH" | jq '((.stok_minimum==7) and (.min_beli==3) and (.masa_simpan_hari==45) and (.lead_time_hari==4))|if . then 1 else 0 end')"
cek "impor sebagian: boleh_eceran & catatan TIDAK dihapus" "V == 1" \
  "$(echo "$UTH" | jq '((.boleh_eceran==true) and (.catatan=="catatan awal"))|if . then 1 else 0 end')"
# harga/unit ikut benar KARENA isi-nya utuh — inti kerusakan lamanya
cek "impor sebagian: harga per unit 51000/24 (bukan /1)" "V == 1" \
  "$(echo "$UTH" | jq '((.harga_per_unit*24 - 51000)|fabs < 0.01)|if . then 1 else 0 end')"
# nilai yang MEMANG dikirim tetap ditulis, termasuk yang falsy
api "$OWNER" POST /bahan/import '{"mode":"perbarui","items":[{"nama":"utuh uji76","kemasan":false,"stok_minimum":0,"catatan":null}]}' > /dev/null
UTH2=$(api "$OWNER" GET /bahan | jq '[.[]|select(.nama=="utuh uji76")][0]')
cek "impor sebagian: false/0/null yang DIKIRIM tetap tersimpan" "V == 1" \
  "$(echo "$UTH2" | jq '((.is_packaging==false) and (.stok_minimum==0) and ((.catatan==null) or (.catatan=="")))|if . then 1 else 0 end')"
cek "impor sebagian: yang tak dikirim tetap utuh di kiriman kedua" "V == 1" \
  "$(echo "$UTH2" | jq '((.isi==24) and (.satuan=="botol") and (.is_complement==true) and (.harga_beli==51000))|if . then 1 else 0 end')"
# bahan BARU tetap dapat nilai bawaan (tak ada nilai lama untuk dibiarkan)
api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"nama":"minim uji76"}]}' > /dev/null
MNM=$(api "$OWNER" GET /bahan | jq '[.[]|select(.nama=="minim uji76")][0]')
cek "bahan baru dari baris minim: default terpasang" "V == 1" \
  "$(echo "$MNM" | jq '((.isi==1) and (.satuan=="pcs") and (.harga_beli==0) and (.track_stok==true) and (.pengadaan=="beli"))|if . then 1 else 0 end')"
# isi 0 tetap ditolak validasi — bukan diterima lalu jadi pembagi maut
cek "impor isi 0 → 400 (bukan diterima)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bahan/import" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"mode":"perbarui","items":[{"nama":"utuh uji76","isi":0}]}')"
# kasir tak boleh impor → 403
cek "kasir impor CSV → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bahan/import" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"mode":"tambah","items":[{"nama":"x","jenis":"beli","harga_beli":1,"isi":1,"satuan":"pcs"}]}')"

echo "== 77. Kategori bahan case-insensitive (Buah segar == buah segar) =="
# master kategori "Buah segar"
api "$OWNER" POST /kategori-bahan '{"nama":"Buah segar"}' > /dev/null
cek "POST kategori beda huruf ('BUAH SEGAR') tak buat duplikat → balik yg ada" "V == 1" \
  "$(api "$OWNER" POST /kategori-bahan '{"nama":"BUAH SEGAR"}' | jq '(.nama=="Buah segar") | if . then 1 else 0 end')"
cek "master kategori 'buah segar' hanya 1 (case-insensitive)" "V == 1" \
  "$(api "$OWNER" GET /kategori-bahan | jq '[.[]|select(.nama|ascii_downcase=="buah segar")]|length')"
# POST bahan dgn kategori huruf kecil → disimpan mengikuti master "Buah segar"
BUAHK=$(api "$OWNER" POST /bahan '{"nama":"apel fuji77","harga_beli":30000,"isi":1,"satuan":"kg","kategori":"buah segar","pengadaan":"beli"}')
cek "POST bahan: kategori 'buah segar' dinormalkan jadi 'Buah segar'" "V == 1" \
  "$(echo "$BUAHK" | jq '(.kategori=="Buah segar") | if . then 1 else 0 end')"
# impor CSV dgn kategori huruf beda → juga dinormalkan
api "$OWNER" POST /bahan/import '{"mode":"tambah","items":[{"nama":"jeruk medan77","jenis":"beli","harga_beli":20000,"isi":1,"satuan":"kg","kategori":"BUAH SEGAR"}]}' > /dev/null
cek "impor: kategori 'BUAH SEGAR' dinormalkan jadi 'Buah segar'" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[]|select(.nama=="jeruk medan77")][0].kategori=="Buah segar") | if . then 1 else 0 end')"
# bulk dgn kategori huruf beda → dinormalkan
api "$OWNER" POST /bahan/bulk '{"items":[{"nama":"mangga77","harga_beli":15000,"isi":1,"satuan":"kg","kategori":"buah SEGAR"}]}' > /dev/null
cek "bulk: kategori 'buah SEGAR' dinormalkan jadi 'Buah segar'" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '([.[]|select(.nama=="mangga77")][0].kategori=="Buah segar") | if . then 1 else 0 end')"
# kategori terpakai (beda huruf pun) tak boleh dihapus
BSID=$(api "$OWNER" GET /kategori-bahan | jq -r '[.[]|select(.nama=="Buah segar")][0].id')
cek "hapus kategori yg dipakai (case-insensitive) ditolak (409)" "V == 409" \
  "$(status_code "$OWNER" DELETE "/kategori-bahan/$BSID")"

echo "== 78. Buat bahan: slug bahan NONAKTIF dipulihkan (bukan ditolak) =="
# bahan produksi baru → hapus (arsip, is_active=false) → tak tampil di daftar,
# tapi slug tetap terpakai. Buat ulang nama sama harus MEMULIHKAN, bukan 409.
REV78=$(api "$OWNER" POST /bahan '{"nama":"revive uji78","harga_beli":0,"isi":1,"satuan":"pcs","pengadaan":"produksi","kategori":"baso"}' | jq -r .id)
cek "bahan baru tampil di daftar aktif" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$REV78" '[.[]|select(.id==$id)]|length')"
api "$OWNER" DELETE "/bahan/$REV78" > /dev/null
cek "setelah hapus: hilang dari daftar aktif" "V == 0" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$REV78" '[.[]|select(.id==$id)]|length')"
cek "buat ulang nama sama (slug nonaktif) → 200 dipulihkan (bukan 409)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bahan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"revive uji78","harga_beli":0,"isi":1,"satuan":"pcs","pengadaan":"produksi","kategori":"baso"}')"
cek "pulih: id sama (baris lama diaktifkan, bukan baris baru)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$REV78" '([.[]|select(.nama=="revive uji78")][0].id==$id) | if . then 1 else 0 end')"
cek "pulih: bahan aktif kembali & tetap produksi" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$REV78" '[.[]|select(.id==$id and .pengadaan=="produksi")]|length')"
cek "duplikat AKTIF sungguhan → tetap 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bahan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"revive uji78","harga_beli":0,"isi":1,"satuan":"pcs","pengadaan":"produksi","kategori":"baso"}')"

echo "== 79. Rak default per bahan DI CK (Tempat Penyimpanan) + auto-file saat Tiba di CK =="
# rak (tempat penyimpanan) di CK
RAK79=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$CK52_UTAMA\",\"nama\":\"Rak A uji79\"}" | jq -r .id)
cek "buat rak di CK berhasil" "V == 1" "$([ -n "$RAK79" ] && [ "$RAK79" != "null" ] && echo 1 || echo 0)"
# bahan beli — rak default DI CK diatur di Tempat Penyimpanan (bukan di form Bahan Baku)
BH79=$(api "$OWNER" POST /bahan '{"nama":"bahan rak uji79","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
cek "assign rak default bahan di CK (PUT /penyimpanan/:id/bahan) → ok" "V == 1" \
  "$(api "$OWNER" PUT "/penyimpanan/$RAK79/bahan" "{\"ingredient_ids\":[\"$BH79\"]}" | jq '(.ok==true)|if . then 1 else 0 end')"
# rak tampil READ-ONLY di daftar Bahan Baku (rak_lokasi: cabang CK + nama rak)
cek "GET bahan: rak_lokasi memuat RAK79 (Rak A uji79 @ CK)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$BH79" --arg r "$RAK79" '([.[]|select(.id==$i)][0].rak_lokasi|map(select(.rak_id==$r and .rak_nama=="Rak A uji79" and .branch_tipe=="central_kitchen"))|length)')"
# beli faktur di CK utk BH79 → Tiba di CK (menunggu, items) → baris auto-file ke RAK79
FB79=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BH79\",\"mode\":\"pcs\",\"jumlah\":10}]}" | jq -r .faktur_id)
RID79=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$FB79" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FB79" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$RID79\",\"qty\":10}]}" > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FB79" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID79\",\"qty\":10}]}" > /dev/null
cek "Tiba di CK: baris auto-file ke rak home (storage_location_id == RAK79)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$FB79" --arg r "$RAK79" '([.rows[]|select(.faktur_id==$f)][0].storage_location_id==$r) | if . then 1 else 0 end')"
cek "Tiba di CK: default_storage_location_id bahan tampil di baris (utk pratinjau)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$FB79" --arg r "$RAK79" '([.rows[]|select(.faktur_id==$f)][0].default_storage_location_id==$r) | if . then 1 else 0 end')"
# bahan TANPA rak home → Tiba di CK tanpa tempat (null)
BH79N=$(api "$OWNER" POST /bahan '{"nama":"bahan tanpa rak uji79","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
FB79N=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BH79N\",\"mode\":\"pcs\",\"jumlah\":5}]}" | jq -r .faktur_id)
RID79N=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$FB79N" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FB79N" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$RID79N\",\"qty\":5}]}" > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FB79N" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID79N\",\"qty\":5}]}" > /dev/null
cek "Tiba di CK tanpa rak home → tanpa tempat (storage_location_id null)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$FB79N" '([.rows[]|select(.faktur_id==$f)][0].storage_location_id==null) | if . then 1 else 0 end')"

echo "== 80. Nomor dokumen otomatis: PB-/PR-/SO- + tampil di daftar, penerimaan, kartu stok =="
# faktur beli baru → respons memuat nomor PB-####; nomor juga tampil di daftar
BH80=$(api "$OWNER" POST /bahan '{"nama":"bahan nomor80","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
RESP80=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BH80\",\"mode\":\"pcs\",\"jumlah\":4}]}")
FB80=$(echo "$RESP80" | jq -r .faktur_id)
NOM80=$(echo "$RESP80" | jq -r .nomor)
echo "$NOM80" | grep -Eq '^PB-[0-9]{4,}$' && ok "faktur beli dapat nomor PB-#### ($NOM80)" || gagal "nomor beli = $NOM80"
cek "daftar /pembelian memuat nomor yang sama" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$FB80" --arg n "$NOM80" '([.rows[]|select(.faktur_id==$f)][0].nomor==$n) | if . then 1 else 0 end')"
# faktur produksi → PR-#### & nomor bertambah antar faktur beli
PJ80=$(api "$OWNER" POST /bahan '{"nama":"baso nomor80","harga_beli":10000,"isi":10,"satuan":"pcs","pengadaan":"produksi","kategori":"baso"}' | jq -r .id)
NOMP80=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"worker_id\":\"$U58_ID\",\"items\":[{\"ingredient_id\":\"$PJ80\",\"mode\":\"batch\",\"jumlah\":1}]}" | jq -r .nomor)
echo "$NOMP80" | grep -Eq '^PR-[0-9]{4,}$' && ok "faktur produksi dapat nomor PR-#### ($NOMP80)" || gagal "nomor produksi = $NOMP80"
NOM80B=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BH80\",\"mode\":\"pcs\",\"jumlah\":2}]}" | jq -r .nomor)
U80A=$(echo "$NOM80" | tr -dc '0-9'); U80B=$(echo "$NOM80B" | tr -dc '0-9')
cek "nomor PB bertambah urut ($NOM80 → $NOM80B)" "V == 1" "$(( 10#$U80B > 10#$U80A ? 1 : 0 ))"
# penerimaan: kiriman CK→cabang memuat nomor faktur asal
RID80=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$FB80" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FB80" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$RID80\",\"qty\":4}]}" > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FB80" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID80\",\"qty\":4}],\"tujuan_branch_id\":\"$PUSAT52B\"}" > /dev/null
cek "penerimaan: baris kiriman memuat nomor faktur asal ($NOM80)" "V == 1" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FB80" --arg n "$NOM80" '([.rows[]|select(.faktur_id==$f)][0].nomor==$n) | if . then 1 else 0 end')"
# stock opname → SO-#### di respons, riwayat, dan detail sesi
OP80=$(api "$OWNER" POST /stok/opname "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BH80\",\"qty\":1}],\"catatan\":\"opname nomor80\"}")
SES80=$(echo "$OP80" | jq -r .session_id); NOMS80=$(echo "$OP80" | jq -r .nomor)
echo "$NOMS80" | grep -Eq '^SO-[0-9]{4,}$' && ok "opname dapat nomor SO-#### ($NOMS80)" || gagal "nomor opname = $NOMS80"
cek "riwayat opname memuat nomor sesi" "V == 1" \
  "$(api "$OWNER" GET "/stok/opname/riwayat?branch_id=$CK52_UTAMA" | jq --arg s "$SES80" --arg n "$NOMS80" '([.[]|select(.session_id==$s)][0].nomor==$n) | if . then 1 else 0 end')"
cek "detail sesi opname memuat nomor" "V == 1" \
  "$(api "$OWNER" GET "/stok/opname/sesi/$SES80" | jq --arg n "$NOMS80" '(.nomor==$n) | if . then 1 else 0 end')"
# kartu stok: mutasi masuk beli menampilkan nomor PB (keterangan "No. PB-..")
NOM80C=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BH80\",\"mode\":\"pcs\",\"jumlah\":3}]}" | jq -r .nomor)
FB80C=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg n "$NOM80C" '[.rows[]|select(.nomor==$n)][0].faktur_id')
RID80C=$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$FB80C" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FB80C" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$RID80C\",\"qty\":3}]}" > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FB80C" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID80C\",\"qty\":3}]}" > /dev/null
# Zona perusahaan, sama seperti seluruh perhitungan tanggal-saja lainnya.
# Yang ini KEBETULAN tak pernah gagal — jendelanya tiga hari lebar sehingga
# geseran satu hari tetap memuat mutasi yang dicari — tapi ia tetap tanggal
# UTC/kontainer yang diadu dengan tanggal bisnis, dan "kebetulan cukup lebar"
# bukan alasan yang bertahan saat rentangnya kelak dipersempit.
DARI80=$(TZ=Asia/Jakarta date -d yesterday +%F); SAMPAI80=$(TZ=Asia/Jakarta date -d tomorrow +%F)
cek "kartu stok: mutasi beli memuat nomor PB di keterangan" "V >= 1" \
  "$(api "$OWNER" GET "/stok/kartu/$BH80?branch_id=$CK52_UTAMA&dari=$DARI80&sampai=$SAMPAI80" | jq --arg n "$NOM80C" '[.mutasi[]|select(.jenis=="beli" and (.keterangan//""|contains($n)))]|length')"
# ACC opname → mutasi opname di kartu memuat nomor SO
api "$OWNER" POST "/stok/opname/sesi/$SES80/acc" > /dev/null
cek "kartu stok: mutasi opname memuat nomor SO di keterangan" "V >= 1" \
  "$(api "$OWNER" GET "/stok/kartu/$BH80?branch_id=$CK52_UTAMA&dari=$DARI80&sampai=$SAMPAI80" | jq --arg n "$NOMS80" '[.mutasi[]|select(.jenis=="opname" and (.keterangan//""|contains($n)))]|length')"

echo "== 81. Kirim hasil produksi ke cabang peminta + badge asal permintaan + visibilitas CK =="
# reset stok jadi di CK & cabang → permintaan pasti menghasilkan PRODUKSI work-order
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$DAG66\",\"qty\":20000},{\"ingredient_id\":\"$TEP66\",\"qty\":5000}]}" > /dev/null
WO81=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
PF81=$(echo "$WO81" | jq -r '.produksi.faktur_id')
ROWS81=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500")
cek "produksi permintaan: untuk_branch_id = cabang peminta" "V == 1" \
  "$(echo "$ROWS81" | jq --arg f "$PF81" --arg b "$CB46_ID" '([.rows[]|select(.faktur_id==$f)] | all(.[]; .untuk_branch_id==$b)) | if . then 1 else 0 end')"
cek "produksi permintaan: rencana_id terisi (badge Permintaan)" "V == 1" \
  "$(echo "$ROWS81" | jq --arg f "$PF81" '([.rows[]|select(.faktur_id==$f)] | all(.[]; .rencana_id != null)) | if . then 1 else 0 end')"
cek "faktur manual: rencana_id null (badge Langsung)" "V == 1" \
  "$(echo "$ROWS81" | jq --arg f "$GFK66C" '([.rows[]|select(.faktur_id==$f)] | length == 0 or all(.[]; .rencana_id == null)) | if . then 1 else 0 end')"
# selesai → masuk stok CK, pengingat kirim (untuk) MASIH tercatat
api "$OWNER" POST "/produksi/tahap/$PF81" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/produksi/tahap/$PF81" '{"ke":"menunggu"}' > /dev/null
ROWS81B=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500")
cek "selesai: baris dikonfirmasi (masuk stok CK)" "V == 1" \
  "$(echo "$ROWS81B" | jq --arg f "$PF81" '([.rows[]|select(.faktur_id==$f)] | all(.[]; .status=="dikonfirmasi")) | if . then 1 else 0 end')"
cek "selesai: untuk_branch_id MASIH ada (pengingat kirim ke cabang)" "V == 1" \
  "$(echo "$ROWS81B" | jq --arg f "$PF81" --arg b "$CB46_ID" '([.rows[]|select(.faktur_id==$f)] | all(.[]; .untuk_branch_id==$b)) | if . then 1 else 0 end')"
CK81_SEBELUM=$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo')
cek "selesai: hasil di stok CK (+100 dari 1 batch)" "abs(V - 100) < 0.001" "$CK81_SEBELUM"
# KIRIM HASIL → faktur kiriman baru (transfer stok CK), sumber ditandai terkirim
KH81=$(api "$OWNER" POST "/produksi/kirim-hasil/$PF81" '{}')
KHF81=$(echo "$KH81" | jq -r '.faktur_id')
NKH81=$(echo "$KH81" | jq -r '.nomor')
echo "$NKH81" | grep -Eq '^PR-[0-9]{4,}$' && ok "kirim-hasil: faktur kiriman baru bernomor ($NKH81)" || gagal "nomor kiriman = $NKH81"
cek "sumber: untuk_branch_id dikosongkan (sudah terkirim)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$PF81" '([.rows[]|select(.faktur_id==$f)] | all(.[]; .untuk_branch_id == null)) | if . then 1 else 0 end')"
cek "kirim-hasil ulang → 400 (sudah terkirim)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/kirim-hasil/$PF81" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{}')"
cek "kiriman muncul di Penerimaan cabang (menunggu, nomor kiriman)" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$KHF81" --arg n "$NKH81" '([.rows[]|select(.faktur_id==$f)] | (length==1) and all(.[]; .status=="menunggu" and .nomor==$n)) | if . then 1 else 0 end')"
# terima di cabang → saldo cabang +100, saldo CK −100 (transfer)
api "$OWNER" POST "/penerimaan/$KHF81/terima" > /dev/null
cek "diterima: saldo cabang +100" "abs(V - 100) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo')"
cek "diterima: saldo CK berkurang 100 (transfer keluar)" "abs(V - ($CK81_SEBELUM - 100)) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo')"
# VISIBILITAS: tim CK tetap melihat faktur yang sudah terkirim penuh
cek "tim CK melihat faktur kiriman terkirim (dari_branch_id)" "V >= 1" \
  "$(api "$TCK58" GET /produksi | jq --arg f "$KHF81" '[.rows[]|select(.faktur_id==$f)] | length')"
cek "tim CK melihat faktur beli yang sudah dikirim ke cabang (§80)" "V >= 1" \
  "$(api "$TCK58" GET "/pembelian?per_page=500" | jq --arg f "$FB80" '[.rows[]|select(.faktur_id==$f)] | length')"

echo "== 82. Permintaan dgn stok ready CK: faktur KIRIM langsung + faktur PRODUKSI sisa =="
# reset: CK punya 30 butir READY, cabang 0 → butuh 100 (porsi 20)
#        = kirim 30 dari stok CK + produksi 1 batch (100) utk sisanya
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":30},{\"ingredient_id\":\"$DAG66\",\"qty\":20000},{\"ingredient_id\":\"$TEP66\",\"qty\":5000}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
P82=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "preview: stok ready CK dihitung utk KIRIM (kirim_ck = 30)" "abs(V - 30) < 0.001" \
  "$(echo "$P82" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].kirim_ck')"
cek "preview: sisa tetap DIPRODUKSI (1 batch = 100)" "abs(V - 100) < 0.001" \
  "$(echo "$P82" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].qty_faktur')"
H82=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
KF82=$(echo "$H82" | jq -r '.kirim.faktur_id // empty')
PF82=$(echo "$H82" | jq -r '.produksi.faktur_id // empty')
cek "satu permintaan menerbitkan faktur KIRIM dan PRODUKSI sekaligus" "V == 1" \
  "$([ -n "$KF82" ] && [ -n "$PF82" ] && echo 1 || echo 0)"
R82=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500")
cek "faktur kirim: 30 butir siap kirim, asal = CK (kartu 'Kiriman'), tujuan cabang" "V == 1" \
  "$(echo "$R82" | jq --arg f "$KF82" --arg ck "$CK52_UTAMA" --arg cb "$CB46_ID" '([.rows[]|select(.faktur_id==$f)] | (length==1) and (.[0].qty==30) and (.[0].status=="menunggu") and (.[0].asal_branch_id==$ck) and (.[0].tujuan_branch_id==$cb)) | if . then 1 else 0 end')"
cek "faktur produksi: 1 batch (100) status rencana, untuk cabang peminta" "V == 1" \
  "$(echo "$R82" | jq --arg f "$PF82" --arg cb "$CB46_ID" '([.rows[]|select(.faktur_id==$f)] | (length==1) and (.[0].qty==100) and (.[0].status=="rencana") and (.[0].untuk_branch_id==$cb)) | if . then 1 else 0 end')"
cek "Data Permintaan Stok: bagian KIRIM tampil (status menunggu) + bagian produksi" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg f "$KF82" '([.[]|select(.kirim != null and .kirim.faktur_id==$f)] | (length==1) and (.[0].kirim.status=="menunggu") and (.[0].produksi != null)) | if . then 1 else 0 end')"
# CK kirim → cabang terima: saldo pindah CK → cabang (transfer, tanpa produksi)
api "$OWNER" POST "/produksi/kirim/$KF82" '{}' > /dev/null
cek "dikirim: kiriman muncul di Penerimaan cabang" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$KF82" '([.rows[]|select(.faktur_id==$f)] | (length==1) and (.[0].status=="menunggu")) | if . then 1 else 0 end')"
api "$OWNER" POST "/penerimaan/$KF82/terima" > /dev/null
cek "diterima: saldo cabang +30 (dari stok ready CK)" "abs(V - 30) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo')"
cek "diterima: stok ready CK berpindah (30 → 0)" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo // 0')"
cek "permintaan: bagian kirim jadi 'Diterima cabang' (dikonfirmasi)" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg f "$KF82" '([.[]|select(.kirim != null and .kirim.faktur_id==$f)] | (length==1) and (.[0].kirim.status=="dikonfirmasi")) | if . then 1 else 0 end')"

echo "== 83. Perlengkapan non bahan baku: stok, pakai, koreksi, aturan konsumsi otomatis =="
# tanggal kemarin pada TZ perusahaan seed (Asia/Jakarta) — kontainer bisa UTC
KEMARIN83=$(TZ=Asia/Jakarta date -d yesterday +%F)
# owner tanpa ?branch_id → cabang pertama (createdAt) = cabang kasir seed;
# semua langkah §83 memakai cabang yang sama.
P83=$(api "$OWNER" POST /perlengkapan '{"nama":"Sabun Cuci Uji","satuan":"sachet","harga_beli":2000,"stok_minimum":3}')
SB83=$(echo "$P83" | jq -r .id)
[ -n "$SB83" ] && [ "$SB83" != "null" ] && ok "buat item perlengkapan (Sabun Cuci Uji)" || gagal "buat item: $P83"
M83=$(api "$OWNER" POST "/perlengkapan/$SB83/masuk" '{"qty":10,"total_harga":20000}')
cek "stok masuk 10 sachet (Rp20.000) → saldo 10" "abs(V - 10) < 0.001" "$(echo "$M83" | jq .saldo)"
NPL83=$(echo "$M83" | jq -r .nomor)
echo "$NPL83" | grep -Eq '^PL-[0-9]{4,}$' && ok "stok masuk bernomor dokumen ($NPL83)" || gagal "nomor PL = $NPL83"
cek "KASIR catat pemakaian 2 (terkunci cabangnya) → saldo 8" "abs(V - 8) < 0.001" \
  "$(api "$KASIR" POST "/perlengkapan/$SB83/pakai" '{"qty":2,"catatan":"cuci alat"}' | jq .saldo)"
cek "guard: kasir tambah item → 403" "V == 403" "$(status_code "$KASIR" POST /perlengkapan)"
cek "guard: kasir stok masuk → 403" "V == 403" "$(status_code "$KASIR" POST "/perlengkapan/$SB83/masuk")"
K83=$(api "$OWNER" POST "/perlengkapan/$SB83/koreksi" '{"qty_fisik":7}')
cek "koreksi fisik 7 → selisih -1" "V == -1" "$(echo "$K83" | jq .selisih)"
cek "koreksi fisik 7 → saldo 7" "abs(V - 7) < 0.001" "$(echo "$K83" | jq .saldo)"
# aturan: 1 sachet/hari mulai KEMARIN → auto kemarin + hari ini (inklusif) = -2
api "$OWNER" PUT "/perlengkapan/$SB83/aturan" "{\"qty\":1,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$KEMARIN83\"}" > /dev/null
cek "aturan 1/hari mulai kemarin → auto 2 hari → saldo 5" "abs(V - 5) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB83" '[.[]|select(.id==$id)][0].saldo')"
cek "GET ulang → saldo tetap 5 (auto idempoten)" "abs(V - 5) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB83" '[.[]|select(.id==$id)][0].saldo')"
cek "daftar memuat aturan (1 / hari, aktif)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB83" '([.[]|select(.id==$id)][0].aturan | (.qty==1) and (.per_hari==1) and .aktif) | if . then 1 else 0 end')"
KARTU83=$(api "$OWNER" GET "/perlengkapan/$SB83/kartu")
cek "kartu: 5 mutasi (masuk+pakai+koreksi+2 auto)" "V == 5" "$(echo "$KARTU83" | jq '.mutasi | length')"
cek "kartu: baris masuk memuat nomor PL yang sama" "V == 1" \
  "$(echo "$KARTU83" | jq --arg n "$NPL83" '([.mutasi[]|select(.tipe=="masuk")][0].nomor == $n) | if . then 1 else 0 end')"
cek "kartu: total belanja Rp20.000" "abs(V - 20000) < 0.001" "$(echo "$KARTU83" | jq .total_belanja)"
cek "kartu: saldo akhir 5" "abs(V - 5) < 0.001" "$(echo "$KARTU83" | jq .saldo_akhir)"
cek "belanja perlengkapan bulan berjalan memuat Rp20.000" "abs(V - 20000) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan/belanja | jq --arg id "$SB83" '[.per_item[]|select(.supply_id==$id)][0].total')"
# CAP HABIS: item ke-2 saldo 1, aturan 2/hari mulai kemarin → auto kemarin
# hanya min(2,1)=1, hari ini DILEWATI (saldo 0) → saldo 0, 1 baris auto
SP83=$(api "$OWNER" POST /perlengkapan '{"nama":"Spons Uji","satuan":"pcs"}' | jq -r .id)
NPL83B=$(api "$OWNER" POST "/perlengkapan/$SP83/masuk" '{"qty":1}' | jq -r .nomor)
cek "nomor PL bertambah urut ($NPL83 → $NPL83B)" "V == 1" \
  "$(( 10#${NPL83B#PL-} > 10#${NPL83#PL-} ? 1 : 0 ))"

# STOK MASUK TANPA `total_harga` → PERKIRAAN dari harga beli acuan, bukan nol.
# Tanpa itu barang masuk ke stok tanpa biaya sama sekali: saldo naik, uangnya
# tak pernah muncul di belanja perlengkapan. Layar web memang sudah mengirim
# `qty × harga_beli` saat kotaknya dikosongkan — tapi aturan itu hidup di SATU
# klien; klien lain atau panggilan API langsung membukukan nol diam-diam.
SH83=$(api "$OWNER" POST /perlengkapan '{"nama":"Sabun Uji Harga","satuan":"pcs","harga_beli":3000}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/$SH83/masuk" '{"qty":4}' > /dev/null
cek "masuk tanpa total_harga → belanja terisi perkiraan 4 × 3.000 (dulu 0)" "abs(V - 12000) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan/$SH83/kartu" | jq '.total_belanja')"
# Harga yang DIKIRIM tetap menang — perkiraannya cuma untuk yang tak mengirim.
api "$OWNER" POST "/perlengkapan/$SH83/masuk" '{"qty":2,"total_harga":1000}' > /dev/null
cek "masuk DENGAN total_harga: nilai kiriman dipakai apa adanya (12.000 + 1.000)" "abs(V - 13000) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan/$SH83/kartu" | jq '.total_belanja')"
# Item tanpa harga beli acuan tetap nol — perkiraannya bukan harga karangan.
cek "item tanpa harga acuan tetap nol (perkiraan bukan angka karangan)" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan/$SP83/kartu" | jq '.total_belanja')"
api "$OWNER" PUT "/perlengkapan/$SP83/aturan" "{\"qty\":2,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$KEMARIN83\"}" > /dev/null
cek "cap habis: auto berhenti di 0 (tidak minus)" "abs(V) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SP83" '[.[]|select(.id==$id)][0].saldo')"
cek "cap habis: hanya 1 baris auto (hari kedua dilewati)" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/$SP83/kartu" | jq '[.mutasi[]|select(.tipe=="auto")] | length')"
cek "cap habis: status item 'habis'" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SP83" '([.[]|select(.id==$id)][0].status == "habis") | if . then 1 else 0 end')"
cek "pakai saat saldo 0 → 400 (stok tidak cukup)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/$SP83/pakai" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"qty":1}')"

echo "== 84. Perlengkapan: opname sesi + ACC, dan minta ke CK (kiriman KP- + terima) =="
# item baru di CK (CB46 sudah terhubung CK52_UTAMA sejak §52)
TU84=$(api "$OWNER" POST /perlengkapan '{"nama":"Tissue Uji","satuan":"pak","stok_minimum":5}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/$TU84/masuk?branch_id=$CK52_UTAMA" '{"qty":10,"total_harga":50000}' > /dev/null
# --- OPNAME: fisik 8 → selisih -2 MENUNGGU (saldo belum berubah) ---
OP84=$(api "$OWNER" POST "/perlengkapan/opname?branch_id=$CK52_UTAMA" "{\"items\":[{\"supply_id\":\"$TU84\",\"qty_fisik\":8}]}")
SESI84=$(echo "$OP84" | jq -r .session_id)
NOP84=$(echo "$OP84" | jq -r .nomor)
echo "$NOP84" | grep -Eq '^OP-[0-9]{4,}$' && ok "sesi opname perlengkapan bernomor ($NOP84)" || gagal "nomor OP = $NOP84"
cek "selisih menunggu ACC → saldo CK MASIH 10" "abs(V - 10) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo')"
cek "riwayat opname memuat sesi (status menunggu)" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/opname/riwayat?branch_id=$CK52_UTAMA" | jq --arg s "$SESI84" '([.[]|select(.session_id==$s)] | (length==1) and (.[0].status=="menunggu") and (.[0].jumlah_item==1)) | if . then 1 else 0 end')"
cek "guard: kasir ACC sesi → 403" "V == 403" \
  "$(status_code "$KASIR" POST "/perlengkapan/opname/sesi/$SESI84/acc")"
api "$OWNER" POST "/perlengkapan/opname/sesi/$SESI84/acc" > /dev/null
cek "ACC → saldo CK jadi 8 (selisih -2 efektif)" "abs(V - 8) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo')"
# opname kedua: fisik 7 → TOLAK → saldo tetap 8
SESI84B=$(api "$OWNER" POST "/perlengkapan/opname?branch_id=$CK52_UTAMA" "{\"items\":[{\"supply_id\":\"$TU84\",\"qty_fisik\":7}]}" | jq -r .session_id)
api "$OWNER" POST "/perlengkapan/opname/sesi/$SESI84B/tolak" > /dev/null
cek "sesi ditolak → saldo tetap 8" "abs(V - 8) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo')"
cek "opname tanpa selisih → tanpa sesi (jumlah_selisih 0)" "V == 0" \
  "$(api "$OWNER" POST "/perlengkapan/opname?branch_id=$CK52_UTAMA" "{\"items\":[{\"supply_id\":\"$TU84\",\"qty_fisik\":8}]}" | jq .jumlah_selisih)"
# --- MINTA KE CK: cabang di bawah minimum (0 < 5), stok CK terlihat ---
cek "cabang melihat saldo_ck (8) sebagai dasar minta" "abs(V - 8) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo_ck')"
MK84=$(api "$OWNER" POST "/perlengkapan/$TU84/minta?branch_id=$CB46_ID" '{"qty":4}')
KIR84=$(echo "$MK84" | jq -r .kiriman_id)
NKP84=$(echo "$MK84" | jq -r .nomor)
echo "$NKP84" | grep -Eq '^KP-[0-9]{4,}$' && ok "kiriman perlengkapan bernomor ($NKP84)" || gagal "nomor KP = $NKP84"
# Dua sifat berbeda yang dulu tergabung dalam satu asersi lewat `saldo_ck`.
# LEDGER CK belum bergerak — itu inti rancangannya, dan dibaca dari sudut
# pandang CK sendiri (`saldo`), sumber yang jujur untuk pertanyaan itu.
cek "belum diterima: ledger CK masih 8, cabang masih 0" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo') == 8 and $(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo') == 0 else 0)")"
# JANJI ke cabang sudah berkurang: 4 dari 8 itu sudah punya tuan. `saldo_ck`
# menjawab "berapa yang masih bisa diminta", bukan "berapa isi buku CK" — lihat
# §205 dan catatan di `saldoPerlengkapan`.
cek "…tapi yang DIJANJIKAN ke cabang tinggal 4 (4 sudah punya tuan)" "abs(V - 4) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo_ck')"
cek "kiriman tampil (status dikirim, tujuan cabang)" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$CB46_ID" | jq --arg k "$KIR84" --arg b "$CB46_ID" '([.[]|select(.id==$k)] | (length==1) and (.[0].status=="dikirim") and (.[0].ke_branch_id==$b)) | if . then 1 else 0 end')"
cek "terima di cabang → saldo cabang 4" "abs(V - 4) < 0.001" \
  "$(api "$OWNER" POST "/perlengkapan/kiriman/$KIR84/terima?branch_id=$CB46_ID" | jq .saldo)"
cek "saldo CK berkurang jadi 4 (transfer keluar)" "abs(V - 4) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$TU84" '[.[]|select(.id==$id)][0].saldo')"
cek "terima ulang → 400 (sudah diterima)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/kiriman/$KIR84/terima?branch_id=$CB46_ID" -H "Authorization: Bearer $OWNER")"
cek "minta melebihi stok CK → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/$TU84/minta?branch_id=$CB46_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"qty":100}')"
cek "kartu CK memuat baris kirim (catatan nomor KP)" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/$TU84/kartu?branch_id=$CK52_UTAMA" | jq --arg n "$NKP84" '([.mutasi[]|select(.tipe=="kirim" and (.catatan // "" | contains($n)))] | length >= 1) | if . then 1 else 0 end')"
# --- STAF CABANG opname dari halaman Stok: KASIR boleh buat sesi (terkunci
#     cabangnya sendiri), selisih tetap menunggu ACC owner/admin ---
OPK84=$(api "$KASIR" POST /perlengkapan/opname "{\"items\":[{\"supply_id\":\"$SB83\",\"qty_fisik\":4}],\"catatan\":\"opname kasir dari halaman Stok\"}")
SESIK84=$(echo "$OPK84" | jq -r .session_id)
cek "KASIR buat opname (fisik 4, sistem 5) → 1 selisih menunggu" "V == 1" "$(echo "$OPK84" | jq .jumlah_selisih)"
cek "selisih kasir menunggu ACC → saldo cabang kasir tetap 5" "abs(V - 5) < 0.001" \
  "$(api "$KASIR" GET /perlengkapan | jq --arg id "$SB83" '[.[]|select(.id==$id)][0].saldo')"
api "$OWNER" POST "/perlengkapan/opname/sesi/$SESIK84/tolak" > /dev/null
cek "sesi kasir ditolak owner → saldo tetap 5" "abs(V - 5) < 0.001" \
  "$(api "$KASIR" GET /perlengkapan | jq --arg id "$SB83" '[.[]|select(.id==$id)][0].saldo')"

echo "== 85. Kirim hasil produksi dgn qty diatur (butuh 400, 1 batch 500 → kirim sebagian) =="
# reset stok jadi & bahan mentah → work-order porsi 20 (kebutuhan 100, 1 batch = 100)
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0},{\"ingredient_id\":\"$DAG66\",\"qty\":20000},{\"ingredient_id\":\"$TEP66\",\"qty\":5000}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
WO85=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
PF85=$(echo "$WO85" | jq -r '.produksi.faktur_id')
api "$OWNER" POST "/produksi/tahap/$PF85" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/produksi/tahap/$PF85" '{"ke":"menunggu"}' > /dev/null
# hasil 100 di stok CK; kirim melebihi stok CK → 400
cek "kirim melebihi stok CK → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/kirim-hasil/$PF85" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":150}]}")"
cek "bahan di luar faktur → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/kirim-hasil/$PF85" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$DAG66\",\"qty\":1}]}")"
# kirim SEBAGIAN: butuh 40 saja dari hasil 100
KH85=$(api "$OWNER" POST "/produksi/kirim-hasil/$PF85" "{\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":40}]}")
KHF85=$(echo "$KH85" | jq -r .faktur_id)
cek "kiriman terbit dgn qty diatur (40)" "abs(V - 40) < 0.001" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$KHF85" '[.rows[]|select(.faktur_id==$f)][0].qty')"
api "$OWNER" POST "/penerimaan/$KHF85/terima" > /dev/null
cek "diterima: cabang +40, CK sisa 60 (100 − 40)" "V == 1" \
  "$(python3 -c "
cb = $(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo // 0')
ck = $(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg id "$BASO66" '[.[]|select(.ingredient_id==$id)][0].saldo // 0')
print(1 if abs(cb-40) < 0.001 and abs(ck-60) < 0.001 else 0)")"
cek "pengingat 'untuk cabang' hilang setelah dikirim (walau sebagian)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$PF85" '([.rows[]|select(.faktur_id==$f)] | all(.[]; .untuk_branch_id == null)) | if . then 1 else 0 end')"

echo "== 86. Perlengkapan: stok awal batch dari halaman Stok (koreksi 'Stok awal') =="
LAP86=$(api "$OWNER" POST /perlengkapan '{"nama":"Lap Uji","satuan":"pcs"}' | jq -r .id)
api "$OWNER" POST /perlengkapan/stok-awal "{\"items\":[{\"supply_id\":\"$LAP86\",\"qty\":12}]}" > /dev/null
cek "stok awal 12 → saldo 12" "abs(V - 12) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$LAP86" '[.[]|select(.id==$id)][0].saldo')"
api "$OWNER" POST /perlengkapan/stok-awal "{\"items\":[{\"supply_id\":\"$LAP86\",\"qty\":10}]}" > /dev/null
cek "stok awal ulang 10 → saldo 10 (dibukukan koreksi -2)" "abs(V - 10) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$LAP86" '[.[]|select(.id==$id)][0].saldo')"
cek "kartu memuat 2 baris koreksi 'Stok awal'" "V == 2" \
  "$(api "$OWNER" GET "/perlengkapan/$LAP86/kartu" | jq '[.mutasi[]|select(.tipe=="koreksi" and .catatan=="Stok awal")] | length')"
cek "guard: kasir set stok awal → 403" "V == 403" "$(status_code "$KASIR" POST /perlengkapan/stok-awal)"

echo "== 87. Perlengkapan: master se-perusahaan + sebaran 'ada di cabang mana saja' =="
M87=$(api "$OWNER" GET /perlengkapan/master)
cek "master memuat 4 item uji (tanpa pilih cabang)" "V == 1" \
  "$(echo "$M87" | jq '([.[]|select(.nama=="Sabun Cuci Uji" or .nama=="Spons Uji" or .nama=="Tissue Uji" or .nama=="Lap Uji")] | length == 4) | if . then 1 else 0 end')"
cek "Tissue Uji: ada di 2 lokasi — CK saldo 4 & cabang saldo 4" "V == 1" \
  "$(echo "$M87" | jq --arg ck "$CK52_UTAMA" --arg cb "$CB46_ID" '([.[]|select(.nama=="Tissue Uji")][0].lokasi | (length==2) and ([.[]|select(.branch_id==$ck)][0].saldo == 4) and ([.[]|select(.branch_id==$cb)][0].saldo == 4)) | if . then 1 else 0 end')"
cek "Sabun Cuci Uji: 1 lokasi, saldo 5 + aturan 1/hari ikut tampil" "V == 1" \
  "$(echo "$M87" | jq '([.[]|select(.nama=="Sabun Cuci Uji")][0].lokasi | (length==1) and (.[0].saldo==5) and (.[0].aturan.qty==1) and (.[0].aturan.per_hari==1)) | if . then 1 else 0 end')"
cek "guard: kasir buka master → 403" "V == 403" "$(status_code "$KASIR" GET /perlengkapan/master)"

echo "== 88. Master perlengkapan: kategori, supplier, ecer/utuh, dilacak, rak simpan =="
# kategori memakai MASTER kategori bahan baku; rak = tempat penyimpanan cabang
api "$OWNER" POST /kategori-bahan '{"nama":"Kebersihan Uji"}' > /dev/null
RAK88=$(api "$OWNER" POST /penyimpanan '{"nama":"Rak Perlengkapan Uji"}' | jq -r .id)
SPL88=$(api "$OWNER" POST /supplier '{"nama":"Toko Perlengkapan Uji"}' | jq -r .id)
SPL88B=$(api "$OWNER" POST /supplier '{"nama":"Grosir Perlengkapan Uji"}' | jq -r .id)
KB88=$(api "$OWNER" POST /perlengkapan "{\"nama\":\"Karbol Uji\",\"satuan\":\"botol\",\"kategori\":\"Kebersihan Uji\",\"boleh_eceran\":false,\"dilacak\":true}" | jq -r .id)
[ -n "$KB88" ] && [ "$KB88" != "null" ] && ok "buat item lengkap (Karbol Uji)" || gagal "buat item: $KB88"
# rak simpan kini diatur di Tempat Penyimpanan (SATU tabel dgn bahan baku)
api "$OWNER" PUT "/penyimpanan/$RAK88/bahan" "{\"supply_ids\":[\"$KB88\"]}" > /dev/null
api "$OWNER" PUT "/perlengkapan/$KB88/supplier" "{\"items\":[{\"supplier_id\":\"$SPL88\",\"is_utama\":true},{\"supplier_id\":\"$SPL88B\"}]}" > /dev/null
M88=$(api "$OWNER" GET /perlengkapan/master | jq --arg id "$KB88" '[.[]|select(.id==$id)][0]')
cek "master memuat kategori/utuh-kemasan/dilacak/rak_lokasi/supplier utama (+1)" "V == 1" \
  "$(echo "$M88" | jq --arg r "$RAK88" '((.kategori=="Kebersihan Uji") and (.boleh_eceran==false) and (.dilacak==true) and ((.rak_lokasi|map(select(.rak_id==$r and .rak_nama=="Rak Perlengkapan Uji"))|length)==1) and (.supplier_utama=="Toko Perlengkapan Uji") and (.jumlah_supplier==2)) | if . then 1 else 0 end')"
cek "daftar supplier item: 2 baris, utama di atas" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/$KB88/supplier" | jq '((length==2) and (.[0].is_utama==true) and (.[0].nama=="Toko Perlengkapan Uji")) | if . then 1 else 0 end')"
# GET /perlengkapan per-cabang membawa rak (utk pilih lokasi saat opname)
cek "daftar per-cabang membawa rak item (rak.id == RAK88)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$KB88" --arg r "$RAK88" '([.[]|select(.id==$id)][0].rak.id==$r) | if . then 1 else 0 end')"
cek "item tanpa rak → rak null" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB83" '([.[]|select(.id==$id)][0].rak == null) | if . then 1 else 0 end')"
cek "dua supplier utama → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/perlengkapan/$KB88/supplier" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"supplier_id\":\"$SPL88\",\"is_utama\":true},{\"supplier_id\":\"$SPL88B\",\"is_utama\":true}]}")"
cek "guard: kasir atur supplier → 403" "V == 403" "$(status_code "$KASIR" PUT "/perlengkapan/$KB88/supplier")"
cek "PATCH lepas pelacakan + ganti kategori → master ikut berubah" "V == 1" \
  "$(api "$OWNER" PATCH "/perlengkapan/$KB88" '{"dilacak":false,"kategori":null}' > /dev/null; api "$OWNER" GET /perlengkapan/master | jq --arg id "$KB88" '([.[]|select(.id==$id)][0] | (.dilacak==false) and (.kategori==null)) | if . then 1 else 0 end')"

echo "== 89. Aturan konsumsi metode MANUAL (dari stock opname) vs OTOMATIS =="
SB89=$(api "$OWNER" POST /perlengkapan '{"nama":"Serbet Uji","satuan":"lembar"}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/$SB89/masuk" '{"qty":5}' > /dev/null
# metode manual: pemakaian via stock opname — TANPA potongan terjadwal
api "$OWNER" PUT "/perlengkapan/$SB89/aturan" '{"metode":"manual"}' > /dev/null
cek "aturan manual tersimpan (metode di daftar)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB89" '([.[]|select(.id==$id)][0].aturan.metode == "manual") | if . then 1 else 0 end')"
cek "manual: saldo TETAP 5 (tanpa potongan otomatis)" "abs(V - 5) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB89" '[.[]|select(.id==$id)][0].saldo')"
cek "aturan otomatis tanpa takaran (qty 0) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/perlengkapan/$SB89/aturan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"metode":"otomatis","qty":0}')"
# ganti ke OTOMATIS 1/hari mulai kemarin → auto 2 hari (kemarin+hari ini)
api "$OWNER" PUT "/perlengkapan/$SB89/aturan" "{\"metode\":\"otomatis\",\"qty\":1,\"per_hari\":1,\"mulai\":\"$KEMARIN83\"}" > /dev/null
cek "ganti manual → otomatis 1/hari mulai kemarin → saldo 3" "abs(V - 3) < 0.001" \
  "$(api "$OWNER" GET /perlengkapan | jq --arg id "$SB89" '[.[]|select(.id==$id)][0].saldo')"
cek "kembali ke manual → saldo berhenti terpotong (tetap 3)" "abs(V - 3) < 0.001" \
  "$(api "$OWNER" PUT "/perlengkapan/$SB89/aturan" '{"metode":"manual"}' > /dev/null; api "$OWNER" GET /perlengkapan | jq --arg id "$SB89" '[.[]|select(.id==$id)][0].saldo')"

echo "== 90. Permintaan perlengkapan OTOMATIS (kiriman dari CK + laporan perlu beli) =="
# item baru: min 10; CK punya 6; cabang CB46 (terhubung CK52) punya 0
PO90=$(api "$OWNER" POST /perlengkapan '{"nama":"Pembersih Kaca Uji","satuan":"botol","stok_minimum":10}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/$PO90/masuk?branch_id=$CK52_UTAMA" '{"qty":6}' > /dev/null
HP90=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$CB46_ID" '{}')
cek "kiriman dibuat utk item ≤ minimum, qty = stok CK (6)" "V == 1" \
  "$(echo "$HP90" | jq --arg id "$PO90" '([.dibuat[]|select(.supply_id==$id)] | (length==1) and (.[0].qty==6) and (.[0].nomor|test("^KP-"))) | if . then 1 else 0 end')"
cek "sisa kekurangan (10−6=4) jadi FAKTUR BELI ke CK (BP-)" "V == 1" \
  "$(echo "$HP90" | jq --arg id "$PO90" '([.beli_dibuat[]|select(.supply_id==$id)] | (length==1) and (.[0].qty==4) and (.[0].nomor|test("^BP-"))) | if . then 1 else 0 end')"
# kiriman KP- muncul di daftar kiriman cabang (menunggu diterima)
cek "kiriman otomatis tampil di cabang (status dikirim)" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$CB46_ID" | jq --arg id "$PO90" '([.[]|select(.item.id==$id and .status=="dikirim")] | length >= 1) | if . then 1 else 0 end')"
cek "belum diterima: saldo cabang masih 0" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$PO90" '[.[]|select(.id==$id)][0].saldo // 0')"
cek "guard: kasir jalankan permintaan otomatis → 403" "V == 403" \
  "$(status_code "$KASIR" POST /perlengkapan/permintaan-otomatis)"
cek "guard: target Central Kitchen → 400 (CK belanja langsung)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/permintaan-otomatis?branch_id=$CK52_UTAMA" -H "Authorization: Bearer $OWNER")"

echo "== 92b. Faktur beli perlengkapan ke CK: tiba → masuk stok CK + otomatis kirim =="
# faktur beli BP- (qty 4, tujuan CB46) dari §90 muncul di daftar 'menunggu'
BELI90=$(api "$OWNER" GET /perlengkapan/beli | jq -r --arg id "$PO90" '[.[]|select(.supply_id==$id and .status=="menunggu")][0].id')
[ "$BELI90" != "null" ] && [ -n "$BELI90" ] && ok "faktur beli BP- tampil (menunggu)"
cek "guard: kasir tandai tiba → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/beli/$BELI90/tiba" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"qty":4}')"
# CK saldo sebelum tiba = 6 (masuk awal; kiriman KP-6 belum diterima → belum kurang)
CKSALDO_A=$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$PO90" '[.[]|select(.id==$id)][0].saldo // 0')
cek "CK saldo sebelum tiba = 6" "abs(V - 6) < 0.001" "$CKSALDO_A"
# tandai TIBA (qty 4, nilai 20.000) → masuk stok CK (PL-) + auto-kirim (KP-) ke CB46
TIBA90=$(api "$OWNER" POST "/perlengkapan/beli/$BELI90/tiba" '{"qty":4,"total_harga":20000}')
cek "tiba: dapat nomor masuk PL-" "V == 1" \
  "$(echo "$TIBA90" | jq '((.nomor_masuk // "")|test("^PL-")) | if . then 1 else 0 end')"
cek "tiba: kiriman otomatis KP- diterbitkan ke cabang" "V == 1" \
  "$(echo "$TIBA90" | jq '((.kiriman.nomor // "")|test("^KP-")) | if . then 1 else 0 end')"
cek "CK saldo setelah tiba = 10 (6 + beli 4)" "abs(V - 10) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$PO90" '[.[]|select(.id==$id)][0].saldo // 0')"
cek "faktur beli kini berstatus 'tiba'" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq -r --arg b "$BELI90" '([.[]|select(.id==$b and .status=="tiba")]|length) | if . >= 1 then 1 else 0 end')"
# dua kiriman KP- (6 + 4) menunggu diterima di CB46 → terima semuanya
for KID in $(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$CB46_ID" | jq -r --arg id "$PO90" '.[]|select(.item.id==$id and .status=="dikirim")|.id'); do
  api "$OWNER" POST "/perlengkapan/kiriman/$KID/terima?branch_id=$CB46_ID" '{}' > /dev/null
done
cek "setelah terima semua: saldo cabang CB46 = 10" "abs(V - 10) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$PO90" '[.[]|select(.id==$id)][0].saldo // 0')"
cek "CK saldo kembali 0 (semua terkirim)" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$PO90" '[.[]|select(.id==$id)][0].saldo // 0')"
cek "tiba lagi (idempoten) → 400 (sudah tiba)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/beli/$BELI90/tiba" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{}')"
# batal: buat faktur beli baru lalu batalkan
BELIBATAL=$(api "$OWNER" POST /perlengkapan '{"nama":"Sabun Colek Uji","satuan":"pcs","stok_minimum":5}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$CB46_ID" '{}' > /dev/null
BB_ID=$(api "$OWNER" GET /perlengkapan/beli | jq -r --arg id "$BELIBATAL" '[.[]|select(.supply_id==$id and .status=="menunggu")][0].id')
cek "batal faktur beli menunggu → ok" "V == 1" \
  "$(api "$OWNER" POST "/perlengkapan/beli/$BB_ID/batal" '{}' | jq '(.ok==true)|if . then 1 else 0 end')"
cek "batal lagi (sudah batal) → 404" "V == 404" \
  "$(status_code "$OWNER" POST "/perlengkapan/beli/$BB_ID/batal")"
# MANUAL: buat faktur beli perlengkapan langsung (halaman Beli Perlengkapan)
SBMAN=$(api "$OWNER" POST /perlengkapan '{"nama":"Tisu Manual Uji","satuan":"pak"}' | jq -r .id)
MAN92=$(api "$OWNER" POST /perlengkapan/beli "{\"supply_id\":\"$SBMAN\",\"ck_branch_id\":\"$CK52_UTAMA\",\"qty\":3,\"tujuan_branch_id\":\"$CB46_ID\",\"total_harga\":15000}")
cek "manual: faktur beli BP- terbit" "V == 1" \
  "$(echo "$MAN92" | jq '((.nomor // "")|test("^BP-"))|if . then 1 else 0 end')"
cek "manual: muncul di daftar (menunggu, tujuan CB46)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg id "$SBMAN" '([.[]|select(.supply_id==$id and .status=="menunggu" and .tujuan_nama=="Cabang Uji 46")]|length>=1)|if . then 1 else 0 end')"
cek "guard: kasir buat beli perlengkapan → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/beli" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"supply_id\":\"$SBMAN\",\"qty\":1}")"

# NB: §91 mengosongkan SELURUH Tempat Sampah perusahaan (hapus permanen) —
# maka HARUS jadi seksi TERAKHIR agar tak mengganggu cek soft-delete di atas.
echo "== 91. Kosongkan Tempat Sampah (hapus permanen semua soft-delete) =="
cek "sebelum kosongkan: Tempat Sampah tidak kosong" "V >= 1" "$(api "$OWNER" GET /sampah | jq 'length')"
cek "guard: kasir kosongkan → 403" "V == 403" "$(status_code "$KASIR" POST /sampah/kosongkan)"
KOS91=$(api "$OWNER" POST /sampah/kosongkan)
cek "kosongkan → ok:true" "V == 1" "$(echo "$KOS91" | jq '(.ok==true) | if . then 1 else 0 end')"
cek "kosongkan melaporkan jumlah dihapus (penjualan+faktur ≥ 1)" "V >= 1" \
  "$(echo "$KOS91" | jq '(.penjualan + .faktur)')"
cek "setelah kosongkan: Tempat Sampah KOSONG" "V == 0" "$(api "$OWNER" GET /sampah | jq 'length')"
cek "kosongkan lagi (idempoten) → 0 dihapus" "V == 0" \
  "$(api "$OWNER" POST /sampah/kosongkan | jq '(.penjualan + .faktur)')"

echo "== 92. Opname: bukti foto + alasan selisih inline (siap ACC admin) =="
FOTO92="/uploads/companies/x/bukti/opname92.jpg"
SALDO92=$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")
FISIK92=$(python3 -c "print($SALDO92 + 5)")   # sengaja lebih 5 → selisih
OP92=$(api "$OWNER" POST /stok/opname \
  "{\"catatan\":\"opname bukti\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$FISIK92,\"foto_url\":\"$FOTO92\",\"alasan\":\"barang lebih dari kiriman\"}]}")
SESI92=$(echo "$OP92" | jq -r .session_id)
cek "opname bukti: dapat session_id" "V == 1" \
  "$(echo "$OP92" | jq '((.session_id|type)=="string")|if . then 1 else 0 end')"
# bukti inline → baris langsung 'sudah' (siap ACC), muncul di menunggu_persetujuan
PENY92=$(api "$OWNER" GET "/stok/penyesuaian?status=menunggu_persetujuan")
cek "opname bukti: selisih 'sudah' + foto tersimpan" "V == 1" \
  "$(echo "$PENY92" | jq --arg f "$FOTO92" '([.[]|select(.foto_url==$f and .klarifikasi_status=="sudah")]|length>=1)|if . then 1 else 0 end')"
cek "opname bukti: alasan tersimpan di klarifikasi" "V == 1" \
  "$(echo "$PENY92" | jq --arg f "$FOTO92" '([.[]|select(.foto_url==$f and .catatan=="barang lebih dari kiriman")]|length>=1)|if . then 1 else 0 end')"
# sesi detail memuat foto + alasan (untuk direview owner/admin sebelum ACC)
DET92=$(api "$OWNER" GET "/stok/opname/sesi/$SESI92")
cek "sesi detail: item punya foto_url" "V == 1" \
  "$(echo "$DET92" | jq --arg f "$FOTO92" '[.items[]|select(.foto_url==$f)]|length')"
cek "sesi detail: item punya alasan" "V == 1" \
  "$(echo "$DET92" | jq '[.items[]|select(.alasan=="barang lebih dari kiriman")]|length')"
# ACC sesi → selisih diterapkan, saldo jadi fisik (tanpa langkah klarifikasi terpisah)
api "$OWNER" POST "/stok/opname/sesi/$SESI92/acc" > /dev/null
cek "opname bukti: ACC → saldo plastik jadi fisik" "abs(V - $FISIK92) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "plastik take away")"
# kompatibilitas: opname selisih TANPA foto tetap diterima → klarifikasi 'belum'
FISIK92B=$(python3 -c "print($FISIK92 - 2)")
api "$OWNER" POST /stok/opname \
  "{\"catatan\":\"opname tanpa bukti\",\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":$FISIK92B}]}" > /dev/null
cek "opname tanpa foto: selisih tetap masuk antrean 'belum'" "V >= 1" \
  "$(api "$OWNER" GET "/stok/penyesuaian?status=belum" | jq '[.[]|select(.bahan=="plastik take away")]|length')"

echo "== 93. Riwayat harga + catat harga + laporan harga (fondasi HPP) =="
# --- Metode HPP di Pengaturan Perusahaan ---
cek "company: metode_hpp default 'average'" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.metodeHpp=="average")|if . then 1 else 0 end')"
api "$OWNER" PATCH /company '{"metode_hpp":"fifo"}' > /dev/null
cek "company: metode_hpp bisa diubah ke 'fifo'" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.metodeHpp=="fifo")|if . then 1 else 0 end')"
cek "guard: kasir ubah metode_hpp → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/company" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"metode_hpp":"average"}')"
api "$OWNER" PATCH /company '{"metode_hpp":"average"}' > /dev/null   # kembalikan default

# --- Bahan baku: faktur beli (masuk stok) → riwayat harga lot ---
BH93=$(api "$OWNER" POST /bahan '{"nama":"Bahan Harga Uji 93","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","track_stok":true}')
BH93_ID=$(echo "$BH93" | jq -r .id)
# lot: 10 pcs / Rp30.000 → harga_satuan 3000 (isi 1)
FKH93=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BH93_ID\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":30000}]}")
FKH93_ID=$(echo "$FKH93" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKH93_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKH93_ID" '{"ke":"menunggu"}' > /dev/null   # cabang sendiri → masuk stok
RH93=$(api "$OWNER" GET "/bahan/$BH93_ID/pembelian")
cek "riwayat harga bahan: ≥1 lot tercatat" "V >= 1" "$(echo "$RH93" | jq '.jumlah_pembelian')"
cek "riwayat harga bahan: lot harga_satuan = 3000 (30000/10)" "V == 1" \
  "$(echo "$RH93" | jq '([.lots[]|select((.harga_satuan|round)==3000 and .qty==10)]|length>=1)|if . then 1 else 0 end')"
cek "riwayat harga bahan: rata-rata tertimbang = 3000" "V == 1" \
  "$(echo "$RH93" | jq '((.harga_rata|round)==3000)|if . then 1 else 0 end')"
cek "riwayat harga bahan: nomor dokumen (PB-) tampil di lot" "V == 1" \
  "$(echo "$RH93" | jq '([.lots[]|select(.nomor!=null)]|length>=1)|if . then 1 else 0 end')"
# catat harga acuan (per satuan) → harga_terkini + harga_beli bahan terupdate
api "$OWNER" POST "/bahan/$BH93_ID/harga" '{"harga_per_unit":3500}' > /dev/null
cek "catat harga bahan: harga_terkini jadi 3500" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$BH93_ID/pembelian" | jq '((.harga_terkini|round)==3500)|if . then 1 else 0 end')"
cek "catat harga bahan: harga_beli bahan ikut jadi 3500 (× isi 1)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$BH93_ID" '([.[]|select(.id==$id)][0].harga_beli|round)==3500|if . then 1 else 0 end')"
cek "guard: kasir catat harga bahan → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bahan/$BH93_ID/harga" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"harga_per_unit":1}')"

# --- Laporan Harga dari faktur belanja (setelah barang dikirim) ---
FKL93=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BH93_ID\",\"mode\":\"pcs\",\"jumlah\":6,\"total_harga\":30000}]}")
FKL93_ID=$(echo "$FKL93" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKL93_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKL93_ID" '{"ke":"menunggu"}' > /dev/null
ROWL93=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FKL93_ID" '[.rows[]|select(.faktur_id==$f)][0].id')
# sebelum laporan harga: baris belum berharga final (laporan_harga_at null) → faktur belum "Selesai"
cek "sebelum laporan: laporan_harga_at baris null" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWL93" '([.rows[]|select(.id==$r)][0].laporan_harga_at==null)|if . then 1 else 0 end')"
cek "laporan harga: id baris bukan milik faktur → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/laporan-harga/$FKL93_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$BH93_ID\",\"total_harga\":1}]}")"
cek "guard: kasir laporan harga → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/laporan-harga/$FKL93_ID" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$ROWL93\",\"total_harga\":1}]}")"
cek "guard: laporan harga di jalur produksi → 400 (khusus beli)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/laporan-harga/$FKL93_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$ROWL93\",\"total_harga\":1}]}")"
# KARYAWAN CENTRAL KITCHEN BOLEH MELAPORKAN HARGA. Merekalah yang belanja dan
# memegang notanya; menutup ini dari mereka membuat harga riil baru masuk kalau
# manajemen sempat menyalinnya — dan selama belum, RAB belanja berikutnya
# memakai harga yang sudah basi. Pengamannya bukan peran melainkan pratinjau
# dampak + jejak updated_by/laporan_harga_at di tiap baris yang dilaporkan.
cek "karyawan CK minta pratinjau dampak → 200" "V == 200" \
  "$(status_code_body "$TCK58" POST "/pembelian/laporan-harga/$FKL93_ID/dampak" "{\"items\":[{\"id\":\"$ROWL93\",\"total_harga\":42000}]}")"
cek "tim cabang STORE tetap ditolak (bukan Central Kitchen) → 403" "V == 403" \
  "$(status_code_body "$T56" POST "/pembelian/laporan-harga/$FKL93_ID/dampak" "{\"items\":[{\"id\":\"$ROWL93\",\"total_harga\":42000}]}")"
# lapor harga riil 42000 utk 6 pcs → harga/satuan 7000. DIKERJAKAN KARYAWAN CK:
# seluruh pemeriksaan §93 di bawah ini sekaligus membuktikan hasil laporan
# harga yang ditulis tim CK sama benarnya dengan yang ditulis manajemen.
cek "karyawan CK menyimpan laporan harga → 200" "V == 200" \
  "$(status_code_body "$TCK58" POST "/pembelian/laporan-harga/$FKL93_ID" "{\"items\":[{\"id\":\"$ROWL93\",\"total_harga\":42000}]}")"
cek "laporan harga: total baris jadi 42000" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWL93" '([.rows[]|select(.id==$r)][0].total_harga==42000)|if . then 1 else 0 end')"
# setelah laporan harga: baris berharga final (laporan_harga_at terisi) → faktur "Selesai"
cek "setelah laporan: laporan_harga_at baris terisi (faktur Selesai)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWL93" '([.rows[]|select(.id==$r)][0].laporan_harga_at!=null)|if . then 1 else 0 end')"
# JEJAK PELAKU — ini pengganti gerbang peran yang dicabut: siapa pun yang melapor,
# namanya menempel di baris. Kalau kolom ini berhenti terisi, membuka akses ke
# karyawan CK berubah dari "tercatat" jadi "anonim".
cek "laporan harga oleh karyawan CK tercatat di baris (diubah_oleh)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWL93" '([.rows[]|select(.id==$r)][0].diubah_oleh=="Karyawan CK 58")|if . then 1 else 0 end')"
# acuan = MEDIAN riwayat: lot 3000 + lot 7000 (42000/6) → median 5000 (× isi 1)
cek "laporan harga: harga_beli bahan = median riwayat (5000)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$BH93_ID" '([.[]|select(.id==$id)][0].harga_beli|round)==5000|if . then 1 else 0 end')"
cek "laporan harga: lot 42000 muncul di riwayat harga" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$BH93_ID/pembelian" | jq '([.lots[]|select(.total_harga==42000)]|length>=1)|if . then 1 else 0 end')"

# --- Perlengkapan: stok masuk (lot) → riwayat harga + catat harga ---
PL93=$(api "$OWNER" POST /perlengkapan '{"nama":"Perlengkapan Harga Uji 93","satuan":"pcs","harga_beli":500}')
PL93_ID=$(echo "$PL93" | jq -r .id)
api "$OWNER" POST "/perlengkapan/$PL93_ID/masuk" '{"qty":20,"total_harga":40000}' > /dev/null   # harga_satuan 2000
RHP93=$(api "$OWNER" GET "/perlengkapan/$PL93_ID/pembelian")
cek "riwayat harga perlengkapan: ≥1 lot" "V >= 1" "$(echo "$RHP93" | jq '.jumlah_pembelian')"
cek "riwayat harga perlengkapan: harga_satuan = 2000 (40000/20)" "V == 1" \
  "$(echo "$RHP93" | jq '([.lots[]|select((.harga_satuan|round)==2000 and .qty==20)]|length>=1)|if . then 1 else 0 end')"
cek "riwayat harga perlengkapan: rata-rata tertimbang = 2000" "V == 1" \
  "$(echo "$RHP93" | jq '((.harga_rata|round)==2000)|if . then 1 else 0 end')"
cek "riwayat harga perlengkapan: nomor PL- tampil di lot" "V == 1" \
  "$(echo "$RHP93" | jq '([.lots[]|select(.nomor!=null)]|length>=1)|if . then 1 else 0 end')"
api "$OWNER" POST "/perlengkapan/$PL93_ID/harga" '{"harga_per_unit":2500}' > /dev/null
cek "catat harga perlengkapan: harga_terkini jadi 2500" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/$PL93_ID/pembelian" | jq '((.harga_terkini|round)==2500)|if . then 1 else 0 end')"
cek "guard: kasir catat harga perlengkapan → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/$PL93_ID/harga" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"harga_per_unit":1}')"

echo "== 94. Rak default cabang: pilih bahan per rak + auto-file saat kiriman diterima =="
# rak di cabang store CB46 (dibuat di §46)
RC94=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$CB46_ID\",\"nama\":\"Rak Cabang Uji94\"}" | jq -r .id)
RC94B=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$CB46_ID\",\"nama\":\"Rak Cabang Uji94 B\"}" | jq -r .id)
BH94=$(api "$OWNER" POST /bahan '{"nama":"bahan rak cabang uji94","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
cek "assign bahan ke rak cabang → ok" "V == 1" \
  "$(api "$OWNER" PUT "/penyimpanan/$RC94/bahan" "{\"ingredient_ids\":[\"$BH94\"]}" | jq '(.ok==true)|if . then 1 else 0 end')"
cek "GET rak/bahan: berisi BH94" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg i "$BH94" '[.ingredient_ids[]|select(.==$i)]|length')"
cek "daftar penyimpanan: jumlah_bahan RC94 = 1" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan?branch_id=$CB46_ID" | jq --arg r "$RC94" '[.[]|select(.id==$r)][0].jumlah_bahan')"
# picker rak lain di cabang yang sama: BH94 tampil sebagai terpakai_lain (disembunyikan)
cek "GET RC94B/bahan: BH94 di terpakai_lain (sudah di RC94)" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94B/bahan" | jq --arg i "$BH94" '[.terpakai_lain[]|select(.==$i)]|length')"
cek "GET RC94/bahan: BH94 TIDAK di terpakai_lain (rak ini sendiri)" "V == 0" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg i "$BH94" '[.terpakai_lain[]|select(.==$i)]|length')"
cek "guard: kasir assign bahan rak → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/penyimpanan/$RC94/bahan" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"ingredient_ids\":[\"$BH94\"]}")"
cek "guard: bahan asing (uuid acak) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/penyimpanan/$RC94/bahan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ingredient_ids":["00000000-0000-0000-0000-000000000000"]}')"
# 1 bahan = 1 rak per cabang: pindah ke RC94B → lepas dari RC94
api "$OWNER" PUT "/penyimpanan/$RC94B/bahan" "{\"ingredient_ids\":[\"$BH94\"]}" > /dev/null
cek "pindah rak: RC94 tak lagi berisi BH94" "V == 0" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg i "$BH94" '[.ingredient_ids[]|select(.==$i)]|length')"
cek "pindah rak: RC94B berisi BH94" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94B/bahan" | jq --arg i "$BH94" '[.ingredient_ids[]|select(.==$i)]|length')"
# kembalikan ke RC94 utk uji auto-file
api "$OWNER" PUT "/penyimpanan/$RC94/bahan" "{\"ingredient_ids\":[\"$BH94\"]}" > /dev/null
# --- Auto-file: kirim BH94 ke CB46 TANPA gudang tujuan → diterima → rak default ---
FKR94=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$PUSAT46_ID\",\"items\":[{\"ingredient_id\":\"$BH94\",\"mode\":\"pcs\",\"jumlah\":7,\"total_harga\":7000}]}")
FKR94_ID=$(echo "$FKR94" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKR94_ID" '{"ke":"dikerjakan"}' > /dev/null
RID94=$(api "$OWNER" GET "/pembelian?branch_id=$PUSAT46_ID&per_page=500" | jq -r --arg f "$FKR94_ID" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FKR94_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID94\",\"qty\":7}],\"tujuan_branch_id\":\"$CB46_ID\"}" > /dev/null
cek "sebelum diterima: baris di CB46 tanpa tempat" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FKR94_ID" '([.rows[]|select(.faktur_id==$f)][0].storage_location_id==null)|if . then 1 else 0 end')"
api "$OWNER" POST "/penerimaan/$FKR94_ID/terima" > /dev/null
cek "diterima di cabang → auto-file ke rak default RC94" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FKR94_ID" --arg r "$RC94" '([.rows[]|select(.faktur_id==$f)][0].storage_location_id==$r)|if . then 1 else 0 end')"
cek "auto-file: tempat baris = nama rak (Rak Cabang Uji94)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FKR94_ID" '([.rows[]|select(.faktur_id==$f)][0].tempat=="Rak Cabang Uji94")|if . then 1 else 0 end')"
# daftar Bahan Baku: rak_lokasi (read-only) memuat rak cabang RC94 (branch store)
cek "GET bahan: rak_lokasi BH94 memuat RC94 (store)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$BH94" --arg r "$RC94" '([.[]|select(.id==$i)][0].rak_lokasi|map(select(.rak_id==$r and .branch_tipe=="store"))|length)')"
# TERPISAH: satu bahan boleh punya rak di CK DAN di cabang store — assign BH94 juga ke rak CK RAK79
api "$OWNER" PUT "/penyimpanan/$RAK79/bahan" "{\"ingredient_ids\":[\"$BH79\",\"$BH94\"]}" > /dev/null
cek "rak CK + rak cabang berdampingan: rak_lokasi BH94 = 2 (CK & store)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$BH94" '([.[]|select(.id==$i)][0].rak_lokasi|( (map(.branch_tipe)|sort) == ["central_kitchen","store"] ))|if . then 1 else 0 end')"
# BUG FIX: stok yang MASUK tanpa lokasi (mis. Stok Awal) tetap muncul di rak yang
# di-assign saat Stok/Opname — tempat diambil dari assignment (sli), bukan hanya
# dari entri masuk terakhir. Tanpa perbaikan, bahan ini "tanpa tempat".
BHSO94=$(api "$OWNER" POST /bahan '{"nama":"bahan stok awal rak uji94","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
api "$OWNER" PUT "/penyimpanan/$RC94B/bahan" "{\"ingredient_ids\":[\"$BHSO94\"]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BHSO94\",\"qty\":50}]}" > /dev/null
cek "stok awal + rak assign: saldo 50 di cabang" "V == 50" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BHSO94" '[.[]|select(.ingredient_id==$i)][0].saldo')"
cek "stok awal tanpa lokasi masuk → tempat ikut rak assign (RC94B), bukan tanpa tempat" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BHSO94" --arg r "$RC94B" '([.[]|select(.ingredient_id==$i)][0].tempat_id==$r)|if . then 1 else 0 end')"

echo "== 95. Rak PERLENGKAPAN di Tempat Penyimpanan (satu tabel dgn bahan baku) =="
# pakai ulang rak store RC94/RC94B (§94) + rak CK RAK79 (§79)
SP95=$(api "$OWNER" POST /perlengkapan '{"nama":"perlengkapan rak uji95","satuan":"pcs","harga_beli":500,"stok_minimum":0}' | jq -r .id)
cek "assign perlengkapan ke rak cabang → jumlah_perlengkapan 1" "V == 1" \
  "$(api "$OWNER" PUT "/penyimpanan/$RC94/bahan" "{\"supply_ids\":[\"$SP95\"]}" | jq '.jumlah_perlengkapan')"
cek "GET rak/bahan: supply_ids berisi SP95" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg s "$SP95" '[.supply_ids[]|select(.==$s)]|length')"
# per-tipe: assign perlengkapan TIDAK mengganggu bahan BH94 yang sudah di RC94
cek "per-tipe: BH94 tetap di ingredient_ids RC94" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg i "$BH94" '[.ingredient_ids[]|select(.==$i)]|length')"
cek "daftar penyimpanan: jumlah_perlengkapan RC94 = 1" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan?branch_id=$CB46_ID" | jq --arg r "$RC94" '[.[]|select(.id==$r)][0].jumlah_perlengkapan')"
cek "GET RC94B/bahan: SP95 di supply_terpakai_lain (sudah di RC94)" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94B/bahan" | jq --arg s "$SP95" '[.supply_terpakai_lain[]|select(.==$s)]|length')"
cek "GET RC94/bahan: SP95 TIDAK di supply_terpakai_lain (rak sendiri)" "V == 0" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg s "$SP95" '[.supply_terpakai_lain[]|select(.==$s)]|length')"
cek "guard: kasir assign perlengkapan rak → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/penyimpanan/$RC94/bahan" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"supply_ids\":[\"$SP95\"]}")"
cek "guard: perlengkapan asing (uuid acak) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/penyimpanan/$RC94/bahan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"supply_ids":["00000000-0000-0000-0000-000000000000"]}')"
# 1 perlengkapan = 1 rak per cabang: pindah ke RC94B → lepas dari RC94
api "$OWNER" PUT "/penyimpanan/$RC94B/bahan" "{\"supply_ids\":[\"$SP95\"]}" > /dev/null
cek "pindah rak: RC94 tak lagi berisi SP95" "V == 0" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg s "$SP95" '[.supply_ids[]|select(.==$s)]|length')"
cek "pindah rak: RC94B berisi SP95" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94B/bahan" | jq --arg s "$SP95" '[.supply_ids[]|select(.==$s)]|length')"
cek "per-tipe: BH94 tetap di RC94 setelah perlengkapan pindah" "V == 1" \
  "$(api "$OWNER" GET "/penyimpanan/$RC94/bahan" | jq --arg i "$BH94" '[.ingredient_ids[]|select(.==$i)]|length')"
# daftar Perlengkapan (master): rak_lokasi (read-only) memuat RC94B (store)
cek "GET perlengkapan/master: rak_lokasi SP95 memuat RC94B (store)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/master | jq --arg i "$SP95" --arg r "$RC94B" '([.[]|select(.id==$i)][0].rak_lokasi|map(select(.rak_id==$r and .branch_tipe=="store"))|length)')"
# daftar Perlengkapan per cabang: rak = rak di cabang itu
cek "GET perlengkapan?branch_id=CB46: rak SP95 = RC94B" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg i "$SP95" --arg r "$RC94B" '([.[]|select(.id==$i)][0].rak.id==$r)|if . then 1 else 0 end')"
# TERPISAH: perlengkapan boleh punya rak di CK DAN cabang store (seperti bahan)
api "$OWNER" PUT "/penyimpanan/$RAK79/bahan" "{\"supply_ids\":[\"$SP95\"]}" > /dev/null
cek "rak CK + cabang berdampingan: rak_lokasi SP95 = 2 (CK & store)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/master | jq --arg i "$SP95" '([.[]|select(.id==$i)][0].rak_lokasi|( (map(.branch_tipe)|sort) == ["central_kitchen","store"] ))|if . then 1 else 0 end')"

echo "== 96. Daftar / onboarding / undangan / hapus akun =="
COID=$(api "$OWNER" GET /auth/me | jq -r '.company.id')
PUSAT96=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')
# 1. Daftar akun baru → respons NETRAL (tanpa sesi), kirim tautan verifikasi
REG1=$(api "" POST /auth/register '{"nama":"Uji Daftar 96","email":"ujidaftar96@example.com","password":"Rahasia123"}')
cek "daftar: respons netral (ok true, tanpa token/sesi)" "V == 1" \
  "$(echo "$REG1" | jq '((.ok==true) and (.token==null))|if . then 1 else 0 end')"
cek "daftar: sertakan tautan verifikasi (dev, email belum diatur)" "V == 1" \
  "$(echo "$REG1" | jq '((.dev_verify_url|length)>0)|if . then 1 else 0 end')"
# login SEBELUM verifikasi email → 403 (diblokir sampai email diverifikasi)
cek "login sebelum verifikasi email → 403" "V == 403" \
  "$(status_code_body "" POST /auth/login '{"email":"ujidaftar96@example.com","password":"Rahasia123"}')"
# verifikasi email (klik tautan) → dapat sesi (auto-login), company null
VT1=$(echo "$REG1" | jq -r '.dev_verify_url' | sed 's/.*token=//')
V1=$(api "" POST /auth/verify-email "{\"token\":\"$VT1\"}")
TOK1=$(echo "$V1" | jq -r .token)
cek "verifikasi email: dapat token sesi" "V == 1" "$(echo "$V1" | jq '((.token|length)>0)|if . then 1 else 0 end')"
cek "verifikasi email: belum punya perusahaan (company null)" "V == 1" "$(echo "$V1" | jq '(.company==null)|if . then 1 else 0 end')"
# login SESUDAH verifikasi → 200 (dapat sesi company null → diarahkan onboarding)
cek "login sesudah verifikasi → 200" "V == 200" \
  "$(status_code_body "" POST /auth/login '{"email":"ujidaftar96@example.com","password":"Rahasia123"}')"
# onboarding status: belum punya perusahaan, tak ada undangan
ST1=$(api "$TOK1" GET /onboarding/status)
cek "onboarding: has_company false" "V == 1" "$(echo "$ST1" | jq '(.has_company==false)|if . then 1 else 0 end')"
cek "onboarding: undangan kosong" "V == 0" "$(echo "$ST1" | jq '.undangan|length')"
# 2. Buat perusahaan sendiri → jadi owner
BP1=$(api "$TOK1" POST /onboarding/perusahaan '{"nama":"Warung Uji 96"}')
cek "buat perusahaan: jadi owner" "V == 1" "$(echo "$BP1" | jq '(.user.role=="owner")|if . then 1 else 0 end')"
cek "buat perusahaan: company terisi" "V == 1" "$(echo "$BP1" | jq '((.company.id|length)>0)|if . then 1 else 0 end')"
# Owner perusahaan BARU langsung punya kode karyawan (barcode/QR absen) —
# tanpa ini kolom Kode di halaman Karyawan kosong & absen owner tak bisa dipindai.
TOK1B=$(echo "$BP1" | jq -r '.token')
cek "buat perusahaan: owner langsung ber-kode karyawan (8 digit)" "V == 1" \
  "$(api "$TOK1B" GET /karyawan | jq '[.[]|select(.role=="owner")][0].employee_code // "" | test("^[0-9]{8}$") | if . then 1 else 0 end')"
# 3. Daftar validasi + duplikat
cek "daftar password < 8 → 400" "V == 400" \
  "$(status_code_body "" POST /auth/register '{"nama":"X","email":"pendek96@example.com","password":"123"}')"
# Anti-enumerasi TOTAL: email sudah terdaftar → 200 NETRAL (bukan 409), respons
# identik dgn email baru & TANPA tautan verifikasi untuk email milik akun lain.
cek "daftar email sudah ada → 200 netral (bukan 409)" "V == 200" \
  "$(status_code_body "" POST /auth/register "{\"nama\":\"X\",\"email\":\"$OWNER_EMAIL\",\"password\":\"Rahasia123\"}")"
REGDUP96=$(api "" POST /auth/register "{\"nama\":\"X\",\"email\":\"$OWNER_EMAIL\",\"password\":\"Rahasia123\"}")
cek "daftar duplikat: netral (ok true, tak bocorkan alamat email)" "V == 1" \
  "$(echo "$REGDUP96" | jq --arg e "$OWNER_EMAIL" '((.ok==true) and ((((.message//"")+(.error//""))|ascii_downcase|contains($e|ascii_downcase))|not))|if . then 1 else 0 end')"
cek "daftar duplikat: TANPA tautan verifikasi (email milik akun lain)" "V == 1" \
  "$(echo "$REGDUP96" | jq '(.dev_verify_url==null)|if . then 1 else 0 end')"
# 4. Undang (menunggu diundang) → daftar → auto-join
INV=$(api "$OWNER" POST /karyawan/undang "{\"email\":\"undangan96@example.com\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT96\"}")
cek "undang: dibuat (ada id)" "V == 1" "$(echo "$INV" | jq '((.id|length)>0)|if . then 1 else 0 end')"
cek "undang duplikat → 409" "V == 409" \
  "$(status_code_body "$OWNER" POST /karyawan/undang "{\"email\":\"undangan96@example.com\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT96\"}")"
cek "daftar undangan memuat email" "V == 1" \
  "$(api "$OWNER" GET /karyawan/undangan | jq '[.[]|select(.email=="undangan96@example.com")]|length')"
REG2=$(api "" POST /auth/register '{"nama":"Undangan 96","email":"undangan96@example.com","password":"Rahasia123"}')
# auto-join terjadi saat DAFTAR → undangan langsung hilang dari pending
cek "undangan diterima saat daftar → hilang dari pending" "V == 0" \
  "$(api "$OWNER" GET /karyawan/undangan | jq '[.[]|select(.email=="undangan96@example.com")]|length')"
# verifikasi email → sesi memuat keanggotaan hasil auto-join (role cashier)
VT2=$(echo "$REG2" | jq -r '.dev_verify_url' | sed 's/.*token=//')
V2=$(api "" POST /auth/verify-email "{\"token\":\"$VT2\"}")
cek "verifikasi via undangan: sesi role cashier" "V == 1" "$(echo "$V2" | jq '(.user.role=="cashier")|if . then 1 else 0 end')"
cek "verifikasi via undangan: company = perusahaan OWNER" "V == 1" \
  "$(echo "$V2" | jq --arg c "$COID" '(.company.id==$c)|if . then 1 else 0 end')"
cek "undang email yang sudah anggota → 409" "V == 409" \
  "$(status_code_body "$OWNER" POST /karyawan/undang "{\"email\":\"undangan96@example.com\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT96\"}")"
# 5. Hapus akun (soft) → login gagal → email bebas dipakai ulang
TOK3=$(daftar_verif "hapus96@example.com" "Rahasia123" "Hapus 96")
cek "hapus akun (tanpa perusahaan) → ok" "V == 1" \
  "$(api "$TOK3" DELETE /onboarding/akun '{"password":"Rahasia123"}' | jq '(.ok==true)|if . then 1 else 0 end')"
cek "login setelah hapus akun → 401" "V == 401" \
  "$(status_code_body "" POST /auth/login '{"email":"hapus96@example.com","password":"Rahasia123"}')"
# daftar ulang email yg tadi dihapus → boleh (email tombstone dibebaskan) → tautan verifikasi baru
REG3B=$(api "" POST /auth/register '{"nama":"Hapus96 Lagi","email":"hapus96@example.com","password":"Rahasia123"}')
cek "daftar ulang email yang dihapus → berhasil (tautan verifikasi baru)" "V == 1" \
  "$(echo "$REG3B" | jq '((.ok==true) and ((.dev_verify_url|length)>0))|if . then 1 else 0 end')"
VT3B=$(echo "$REG3B" | jq -r '.dev_verify_url' | sed 's/.*token=//')
TOK3B=$(api "" POST /auth/verify-email "{\"token\":\"$VT3B\"}" | jq -r .token)
cek "hapus akun password salah → 401" "V == 401" \
  "$(status_code_body "$TOK3B" DELETE /onboarding/akun '{"password":"salahbanget"}')"
# 6. Owner terakhir tak boleh hapus akun
cek "hapus akun owner terakhir → 400" "V == 400" \
  "$(status_code_body "$OWNER" DELETE /onboarding/akun "{\"password\":\"$OWNER_PASS\"}")"

echo "== 97. Lupa/reset password + pengaturan SMTP =="
# Reset password diuji SAAT email belum dikonfigurasi → forgot mengembalikan
# tautan reset langsung (dev), jadi tokennya bisa dipakai.
# daftar + verifikasi email dulu (login setelah reset butuh email terverifikasi)
daftar_verif "reset97@example.com" "Lama12345" "Reset Uji 97" > /dev/null
FP=$(api "" POST /auth/forgot-password '{"email":"reset97@example.com"}')
cek "forgot: ok true" "V == 1" "$(echo "$FP" | jq '(.ok==true)|if . then 1 else 0 end')"
cek "forgot: dev_reset_url ada (email belum diatur)" "V == 1" "$(echo "$FP" | jq '((.dev_reset_url|length)>0)|if . then 1 else 0 end')"
# Tautan reset MENGIKUTI host permintaan (APP_BASE_URL kosong) — bukan hardcode
# localhost:3000. Frontend & API satu origin, jadi tautan email mengarah ke
# domain yang dipakai pengguna. (Header X-Forwarded-* dihormati di belakang proxy.)
RHOST=$(curl -s -X POST "$BASE/api/auth/forgot-password" -H 'Content-Type: application/json' \
  -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-Host: app.reset97.example' \
  -d '{"email":"reset97@example.com"}' | jq -r '.dev_reset_url // ""')
cek "reset url mengikuti host permintaan (bukan localhost hardcode)" "V == 1" \
  "$(echo "$RHOST" | grep -Eq '^https://app\.reset97\.example/reset-password\?token=' && echo 1 || echo 0)"
RTOK=$(echo "$FP" | jq -r '.dev_reset_url' | sed 's/.*token=//')
cek "reset dgn token → ok" "V == 1" \
  "$(api "" POST /auth/reset-password "{\"token\":\"$RTOK\",\"password\":\"Baru12345\"}" | jq '(.ok==true)|if . then 1 else 0 end')"
cek "login password BARU → 200" "V == 200" \
  "$(status_code_body "" POST /auth/login '{"email":"reset97@example.com","password":"Baru12345"}')"
cek "login password LAMA → 401" "V == 401" \
  "$(status_code_body "" POST /auth/login '{"email":"reset97@example.com","password":"Lama12345"}')"
cek "reset token bekas → 400" "V == 400" \
  "$(status_code_body "" POST /auth/reset-password "{\"token\":\"$RTOK\",\"password\":\"Baru12345\"}")"
cek "reset token ngawur → 400" "V == 400" \
  "$(status_code_body "" POST /auth/reset-password '{"token":"tokenngawur","password":"Baru12345"}')"
FU=$(api "" POST /auth/forgot-password '{"email":"tidakada97@example.com"}')
cek "forgot email tak dikenal → ok tanpa url" "V == 1" \
  "$(echo "$FU" | jq '((.ok==true) and (.dev_reset_url == null))|if . then 1 else 0 end')"
# Pengaturan SMTP (super admin)
cek "SMTP awal: belum dikonfigurasi" "V == 1" \
  "$(api "$SA" GET /admin/sistem/smtp | jq '(.configured==false)|if . then 1 else 0 end')"
api "$SA" PUT /admin/sistem/smtp '{"host":"smtp.example.com","port":587,"username":"u@example.com","password":"secret","encryption":"starttls","sender_name":"Kakarut","sender_email":"noreply@example.com"}' > /dev/null
SM=$(api "$SA" GET /admin/sistem/smtp)
cek "SMTP diatur: configured true + provider smtp" "V == 1" \
  "$(echo "$SM" | jq '((.configured==true) and (.provider=="smtp"))|if . then 1 else 0 end')"
cek "SMTP: has_password true, host tersimpan" "V == 1" \
  "$(echo "$SM" | jq '((.has_password==true) and (.host=="smtp.example.com"))|if . then 1 else 0 end')"
cek "SMTP: password mentah TIDAK dikembalikan" "V == 1" \
  "$(echo "$SM" | jq '((has("password"))|not)|if . then 1 else 0 end')"
cek "owner akses pengaturan SMTP → 403" "V == 403" "$(status_code "$OWNER" GET /admin/sistem/smtp)"
cek "kasir akses pengaturan SMTP → 403" "V == 403" "$(status_code "$KASIR" GET /admin/sistem/smtp)"
# Kirim test email: tujuan/subjek/isi bisa ditentukan; guard peran + validasi tujuan
cek "test-email owner (bukan super admin) → 403" "V == 403" \
  "$(status_code_body "$OWNER" POST /admin/sistem/smtp/test-email '{"to":"a@b.com"}')"
cek "test-email tujuan tak valid → 400 (validasi)" "V == 400" \
  "$(status_code_body "$SA" POST /admin/sistem/smtp/test-email '{"to":"bukan-email"}')"
# Kosongkan SMTP lagi (host kosong → smtpLengkap=false) supaya bagian berikutnya
# yang mendaftar/memverifikasi email kembali memakai mode dev (dev_verify_url).
api "$SA" PUT /admin/sistem/smtp '{"host":""}' > /dev/null

echo "== 98. Pantau operasional cabang + detail shift + jam operasional =="
# Cabang store pertama (Pusat seed) + satu shift yang sudah ditutup (dari §36).
PUSAT_ID=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.tipe=="store")][0].id')
SHIFT_TTP=$(api "$KASIR" GET /shift | jq -r '.[0].id')
# Pantau semua cabang (owner/admin) — kasir tak boleh.
cek "pantau: owner dapat array cabang store" "V == 1" \
  "$(api "$OWNER" GET /shift/pantau | jq 'if (type=="array" and length>=1) then 1 else 0 end')"
cek "pantau: kasir → 403" "V == 403" "$(status_code "$KASIR" GET /shift/pantau)"
cek "pantau: tiap baris punya flag telat_buka/lupa_tutup" "V == 1" \
  "$(api "$OWNER" GET /shift/pantau | jq 'all(.[]; has("telat_buka") and has("lupa_tutup") and has("jam_buka")) | if . then 1 else 0 end')"
# Atur jam operasional cabang (owner) → tampil di /cabang & /shift/pantau.
api "$OWNER" PATCH "/cabang/$PUSAT_ID" '{"jam_buka":"08:00","jam_tutup":"22:00"}' > /dev/null
cek "cabang: jam operasional tersimpan" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$PUSAT_ID" '[.[] | select(.id==$id)][0] | ((.jam_buka=="08:00") and (.jam_tutup=="22:00")) | if . then 1 else 0 end')"
cek "pantau: jam operasional muncul di cabang" "V == 1" \
  "$(api "$OWNER" GET /shift/pantau | jq --arg id "$PUSAT_ID" '[.[] | select(.branch_id==$id)][0].jam_buka=="08:00" | if . then 1 else 0 end')"
cek "cabang: jam format salah → 400" "V == 400" \
  "$(status_code_body "$OWNER" PATCH "/cabang/$PUSAT_ID" '{"jam_buka":"25:99"}')"
# Detail shift: ringkasan + daftar transaksi; owner boleh lihat, kasir cabang sendiri boleh.
DTL=$(api "$OWNER" GET "/shift/$SHIFT_TTP")
cek "detail shift: id cocok" "V == 1" \
  "$(echo "$DTL" | jq --arg id "$SHIFT_TTP" '(.id==$id) | if . then 1 else 0 end')"
cek "detail shift: dibuka_oleh terisi" "V == 1" \
  "$(echo "$DTL" | jq '((.dibuka_oleh|length)>0) | if . then 1 else 0 end')"
cek "detail shift: transaksi berupa array" "V == 1" \
  "$(echo "$DTL" | jq '(.transaksi|type=="array") | if . then 1 else 0 end')"
cek "detail shift: kasir cabang sendiri → 200" "V == 200" "$(status_code "$KASIR" GET "/shift/$SHIFT_TTP")"
cek "detail shift: id tak dikenal → 404" "V == 404" \
  "$(status_code "$OWNER" GET "/shift/00000000-0000-0000-0000-000000000000")"

echo "== 99. Sinkron offline mobile (POST /api/sync) — Fase 1 =="
NOW99=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FUT99=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)
OLD99=$(date -u -d '-10 days' +%Y-%m-%dT%H:%M:%SZ)
KKODE=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.role=="cashier")][0].employee_code')
MENU99=$(api "$KASIR" GET /menu | jq -r '.[0].id')
uuid99() { cat /proc/sys/kernel/random/uuid; }
# Pastikan shift kasir TERBUKA untuk uji penjualan (kasir sudah absen di §2b).
if [ -z "$(api "$KASIR" GET /shift/aktif | jq -r '.id // empty')" ]; then
  api "$KASIR" POST /shift/buka '{"modal_awal":0}' > /dev/null 2>&1 || true
fi

# Role guard: OWNER kirim 'penjualan' → item gagal 403 (bukan gagal seluruh batch).
B_RG=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" '{device_id:"dev-uji",commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[]}}]}')
cek "sync: owner penjualan → item gagal 403" "V == 1" \
  "$(api "$OWNER" POST /sync "$B_RG" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==403)|if . then 1 else 0 end')"

# Validasi waktu: masa depan & > 7 hari → item gagal 400.
B_T=$(jq -nc --arg rf "$(uuid99)" --arg ro "$(uuid99)" --arg fut "$FUT99" --arg old "$OLD99" '{commands:[{client_ref:$rf,tipe:"absen_saya",waktu:$fut,payload:{foto_url:"http://x/f.jpg"}},{client_ref:$ro,tipe:"absen_saya",waktu:$old,payload:{foto_url:"http://x/f.jpg"}}]}')
RES_T=$(api "$KASIR" POST /sync "$B_T")
cek "sync: waktu masa depan → gagal 400" "V == 1" \
  "$(echo "$RES_T" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400)|if . then 1 else 0 end')"
cek "sync: waktu > 7 hari → gagal 400" "V == 1" \
  "$(echo "$RES_T" | jq '(.hasil[1].status=="gagal" and .hasil[1].kode==400)|if . then 1 else 0 end')"

# Idempotency + tanpa efek ganda (penjualan): kirim → transaksi +1; kirim ulang → sudah_ada, tak dobel.
N0=$(api "$KASIR" GET /penjualan | jq 'length')
RP=$(uuid99)
B_P=$(jq -nc --arg r "$RP" --arg w "$NOW99" --arg m "$MENU99" '{device_id:"dev",commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}}]}')
cek "sync: penjualan → item ok 201" "V == 1" \
  "$(api "$KASIR" POST /sync "$B_P" | jq '(.hasil[0].status=="ok" and .hasil[0].kode==201)|if . then 1 else 0 end')"
N1=$(api "$KASIR" GET /penjualan | jq 'length')
cek "sync: 1 transaksi bertambah" "V == 1" "$((N1 - N0))"
cek "sync: kirim ulang → sudah_ada" "V == 1" \
  "$(api "$KASIR" POST /sync "$B_P" | jq '(.hasil[0].status=="sudah_ada")|if . then 1 else 0 end')"
N2=$(api "$KASIR" GET /penjualan | jq 'length')
cek "sync: kirim ulang TIDAK menggandakan transaksi" "V == 0" "$((N2 - N1))"

# Isolasi kegagalan: [penjualan ok, penjualan waktu-depan gagal, absen_stasiun ok] → item 2 gagal, 1 & 3 sukses.
B_MIX=$(jq -nc --arg ra "$(uuid99)" --arg rb "$(uuid99)" --arg rc "$(uuid99)" --arg w "$NOW99" --arg fut "$FUT99" --arg m "$MENU99" --arg kk "$KKODE" '{commands:[{client_ref:$ra,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}},{client_ref:$rb,tipe:"penjualan",waktu:$fut,payload:{items:[{menu_id:$m,qty:1}]}},{client_ref:$rc,tipe:"absen_stasiun",waktu:$w,payload:{kode:$kk,foto_url:"http://x/f.jpg"}}]}')
RES_MIX=$(api "$KASIR" POST /sync "$B_MIX")
cek "sync isolasi: item1 ok, item2 gagal, item3 ok" "V == 1" \
  "$(echo "$RES_MIX" | jq '(.hasil[0].status=="ok" and .hasil[1].status=="gagal" and .hasil[2].status=="ok")|if . then 1 else 0 end')"
# Penjualan berwaktu LAMPAU yang tak tercakup shift mana pun → 409 BER-SEBAB
# `shift_tidak_cocok`, dan artinya transaksinya TIDAK tercatat. Klien yang
# memperlakukan SEMUA 409 pada `penjualan` sebagai "sudah berhasil" akan
# membuang transaksi ini diam-diam, jadi `sebab` wajib ada di item yang gagal.
# (Kegagalan item2 di atas beda perkara: 400 "waktu di masa depan".)
B_LAMA=$(jq -nc --arg r "$(uuid99)" --arg w "$OLD99" --arg m "$MENU99" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}}]}')
cek "sync: penjualan di luar jendela shift → 409 + sebab shift_tidak_cocok" "V == 1" \
  "$(api "$KASIR" POST /sync "$B_LAMA" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==409 and .hasil[0].sebab=="shift_tidak_cocok")|if . then 1 else 0 end')"

# Transaksi susulan: tutup shift, lalu sync penjualan dgn waktu DI DALAM jendela shift
# tertutup → item ok + shift ditandai ada_transaksi_susulan (rekap dihitung ulang).
if [ -n "$(api "$KASIR" GET /shift/aktif | jq -r '.id // empty')" ]; then
  api "$KASIR" POST /shift/tutup '{"uang_fisik":0}' > /dev/null
  WSUS=$(date -u -d '-5 seconds' +%Y-%m-%dT%H:%M:%SZ)
  B_SUS=$(jq -nc --arg r "$(uuid99)" --arg w "$WSUS" --arg m "$MENU99" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}}]}')
  cek "sync susulan: penjualan pada shift tertutup → ok" "V == 1" \
    "$(api "$KASIR" POST /sync "$B_SUS" | jq '(.hasil[0].status=="ok")|if . then 1 else 0 end')"
  cek "sync susulan: shift ditandai ada_transaksi_susulan" "V == 1" \
    "$(api "$KASIR" GET /shift | jq '([.[]|select(.ada_transaksi_susulan==true)]|length>=1)|if . then 1 else 0 end')"
fi

# --- Fase 2: dispatch ke endpoint asli (opname, faktur tahap, penerimaan) ---
BBS99=$(api "$OWNER" POST /bahan '{"nama":"bahan sync fase2 99","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain","track_stok":true}' | jq -r .id)
# stok_opname via sync (owner) → item ok (sesi opname terbentuk lewat handler asli).
B_SO=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" --arg i "$BBS99" '{commands:[{client_ref:$r,tipe:"stok_opname",waktu:$w,payload:{items:[{ingredient_id:$i,qty:88}]}}]}')
cek "sync fase2: stok_opname → item ok" "V == 1" \
  "$(api "$OWNER" POST /sync "$B_SO" | jq '(.hasil[0].status=="ok")|if . then 1 else 0 end')"

# faktur_tahap (jalur=pembelian): buat faktur beli (rencana) → sync tahap 'dikerjakan'.
FKS99=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BBS99\",\"mode\":\"pcs\",\"jumlah\":3,\"total_harga\":3000}]}" | jq -r .faktur_id)
RFT=$(uuid99)
B_FT=$(jq -nc --arg r "$RFT" --arg w "$NOW99" --arg f "$FKS99" '{commands:[{client_ref:$r,tipe:"faktur_tahap",waktu:$w,payload:{jalur:"pembelian",faktur_id:$f,ke:"dikerjakan"}}]}')
cek "sync fase2: faktur_tahap → item ok" "V == 1" \
  "$(api "$OWNER" POST /sync "$B_FT" | jq '(.hasil[0].status=="ok")|if . then 1 else 0 end')"
cek "sync fase2: faktur jadi 'dikerjakan' (handler asli jalan)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKS99" '([.rows[]|select(.faktur_id==$f)][0].status=="dikerjakan")|if . then 1 else 0 end')"
cek "sync fase2: faktur_tahap kirim ulang → sudah_ada" "V == 1" \
  "$(api "$OWNER" POST /sync "$B_FT" | jq '(.hasil[0].status=="sudah_ada")|if . then 1 else 0 end')"

# Role guard fase2: KASIR faktur_tahap → item gagal 403 (gerbang produksi/pembelian).
B_RG2=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" --arg f "$FKS99" '{commands:[{client_ref:$r,tipe:"faktur_tahap",waktu:$w,payload:{jalur:"pembelian",faktur_id:$f,ke:"menunggu"}}]}')
cek "sync fase2: kasir faktur_tahap → gagal 403" "V == 1" \
  "$(api "$KASIR" POST /sync "$B_RG2" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==403)|if . then 1 else 0 end')"

# Param path wajib: faktur_tahap tanpa faktur_id → item gagal 400.
B_PP=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" '{commands:[{client_ref:$r,tipe:"faktur_tahap",waktu:$w,payload:{jalur:"pembelian",ke:"dikerjakan"}}]}')
cek "sync fase2: faktur_tahap tanpa faktur_id → gagal 400" "V == 1" \
  "$(api "$OWNER" POST /sync "$B_PP" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400)|if . then 1 else 0 end')"

# penerimaan_terima faktur asing → item gagal 404 (dari handler asli).
B_PT=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" '{commands:[{client_ref:$r,tipe:"penerimaan_terima",waktu:$w,payload:{faktur_id:"00000000-0000-0000-0000-000000000000"}}]}')
cek "sync fase2: penerimaan_terima faktur asing → gagal 404" "V == 1" \
  "$(api "$OWNER" POST /sync "$B_PT" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==404)|if . then 1 else 0 end')"

echo "== 100. Rate limiting (anti brute-force / abuse) =="
# Login dibatasi per (IP + email), max 10 / 5 menit. 10 percobaan gagal untuk
# email throwaway → percobaan ke-11 (email SAMA) diblokir 429.
RLMAIL="ratelimit100@example.com"
for _ in $(seq 1 10); do
  curl -s -o /dev/null -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$RLMAIL\",\"password\":\"salah\"}"
done
cek "login ke-11 (email sama) diblokir 429" "V == 429" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
     -H 'Content-Type: application/json' -d "{\"email\":\"$RLMAIL\",\"password\":\"salah\"}")"
# Bucket per email: email LAIN dari IP sama tetap diproses (401, bukan 429).
cek "login email lain tetap diproses (bukan 429)" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
     -H 'Content-Type: application/json' -d '{"email":"ratelimit100-lain@example.com","password":"salah"}')"
# Header Retry-After ikut dikirim saat 429.
cek "respons 429 menyertakan header Retry-After" "V == 1" \
  "$(curl -s -D - -o /dev/null -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
     -d "{\"email\":\"$RLMAIL\",\"password\":\"salah\"}" | grep -ci '^retry-after:')"
# Endpoint lain tidak ikut terdampak bucket login → mode tamu tetap 200.
cek "mode tamu tetap berfungsi (200) di tengah rate-limit login" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/guest" \
     -H 'Content-Type: application/json' -d '{"peran":"owner"}')"
# Owner sah TIDAK terpengaruh (email berbeda dari yang di-spam) → login sukses.
cek "login owner sah tetap sukses (bucket email terpisah)" "V == 1" \
  "$([ -n "$(login "$OWNER_EMAIL" "$OWNER_PASS")" ] && echo 1 || echo 0)"

echo "== 101. Guard SSRF pada proxy cetak (POST /print/lan) =="
# Host printer di-resolve lalu disaring; target internal (loopback/link-local/
# metadata) ditolak 400 SEBELUM ada koneksi TCP — termasuk bentuk yang dulu bisa
# menembus filter string (::ffff:127.0.0.1, format desimal).
D64="AA=="  # 1 byte ESC/POS base64 (lolos validasi body)
ssrf_code() { # ssrf_code <host>
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/print/lan" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d "{\"host\":\"$1\",\"port\":9100,\"data\":\"$D64\"}"
}
cek "print/lan → localhost ditolak 400" "V == 400" "$(ssrf_code localhost)"
cek "print/lan → 127.0.0.1 ditolak 400" "V == 400" "$(ssrf_code 127.0.0.1)"
cek "print/lan → ::ffff:127.0.0.1 (bypass lama) ditolak 400" "V == 400" "$(ssrf_code ::ffff:127.0.0.1)"
cek "print/lan → metadata 169.254.169.254 ditolak 400" "V == 400" "$(ssrf_code 169.254.169.254)"
cek "print/lan → 0.0.0.0 ditolak 400" "V == 400" "$(ssrf_code 0.0.0.0)"

echo "== 102. Path-param sinkron wajib UUID (cegah manipulasi jalur) =="
# faktur_id/supply_id di-interpolasi ke URL sub-request → wajib UUID valid.
# Nilai jahat (path traversal / bukan UUID) → item gagal 400 SEBELUM dispatch.
SYNC_BAD_FT=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" \
  '{commands:[{client_ref:$r,tipe:"faktur_tahap",waktu:$w,payload:{jalur:"pembelian",faktur_id:"../../admin/sistem",ke:"dikerjakan"}}]}')
cek "sync: faktur_id non-UUID (path traversal) → gagal 400" "V == 1" \
  "$(api "$OWNER" POST /sync "$SYNC_BAD_FT" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400)|if . then 1 else 0 end')"
SYNC_BAD_SP=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" \
  '{commands:[{client_ref:$r,tipe:"perlengkapan_pakai",waktu:$w,payload:{supply_id:"bukan-uuid",qty:1}}]}')
cek "sync: supply_id non-UUID → gagal 400" "V == 1" \
  "$(api "$OWNER" POST /sync "$SYNC_BAD_SP" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400)|if . then 1 else 0 end')"
# UUID v4 valid (tapi faktur tak ada) TETAP lolos validasi → dispatch → 404 dari handler asli.
SYNC_OK_UUID=$(jq -nc --arg r "$(uuid99)" --arg w "$NOW99" \
  '{commands:[{client_ref:$r,tipe:"penerimaan_terima",waktu:$w,payload:{faktur_id:"11111111-1111-4111-8111-111111111111"}}]}')
cek "sync: faktur_id UUID valid → lolos validasi, dispatch (404 dari handler)" "V == 1" \
  "$(api "$OWNER" POST /sync "$SYNC_OK_UUID" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==404)|if . then 1 else 0 end')"

echo "== 103. Isolasi lintas-perusahaan: edit kredensial akun multi-perusahaan =="
# U daftar (tanpa perusahaan) → buat perusahaan sendiri (B) → diundang & terima di
# Basooopa (A) sebagai kasir → jadi anggota DUA perusahaan (identitas users global).
TOKU103=$(daftar_verif "dua103@example.com" "Dobel10345" "Dobel 103")
api "$TOKU103" POST /onboarding/perusahaan '{"nama":"Warung Dua 103"}' > /dev/null
INV103=$(api "$OWNER" POST /karyawan/undang "{\"email\":\"dua103@example.com\",\"role\":\"cashier\",\"branch_id\":\"$PUSAT96\"}" | jq -r .id)
api "$TOKU103" POST "/onboarding/undangan/$INV103/terima" > /dev/null
UID103=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.email=="dua103@example.com")][0].user_id')
cek "setup: U jadi anggota Basooopa (multi-perusahaan)" "V == 1" \
  "$([ -n "$UID103" ] && [ "$UID103" != "null" ] && echo 1 || echo 0)"
# Ganti PASSWORD akun yang juga aktif di perusahaan lain → 403 (cegah ambil-alih lintas-tenant)
cek "PATCH password akun multi-perusahaan → 403" "V == 403" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UID103" '{"password":"Bajakxx99"}')"
# Ganti EMAIL login → 403
cek "PATCH email akun multi-perusahaan → 403" "V == 403" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UID103" '{"email":"ganti103@example.com"}')"
# Edit non-kredensial (nama) tetap boleh → 200
cek "PATCH nama akun multi-perusahaan → 200 (edit scoped tetap boleh)" "V == 200" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UID103" '{"nama":"Dobel Baru 103"}')"
# Keluarkan (arsip) dari perusahaan ini → 200, TAPI login GLOBAL tidak terkunci
cek "arsip akun multi-perusahaan dari sini → 200" "V == 200" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UID103" '{"arsip":true}')"
cek "arsip lintas-tenant TIDAK mengunci login global (U masih bisa masuk)" "V == 1" \
  "$([ -n "$(login "dua103@example.com" "Dobel10345")" ] && echo 1 || echo 0)"

echo "== 104. Idempotensi client_ref lintas jalur (online /penjualan & /absensi ↔ /sync) =="
# Pastikan kasir SEDANG HADIR (absen masuk, belum keluar) lalu buka shift —
# syarat transaksi. Absen bersifat toggle: jadikan status terakhir 'masuk'.
AT104=$(api "$KASIR" POST /absensi/saya '{"foto_url":"https://example.com/in104.jpg"}' | jq -r '.tipe')
[ "$AT104" = "keluar" ] && api "$KASIR" POST /absensi/saya '{"foto_url":"https://example.com/in104b.jpg"}' > /dev/null
api "$KASIR" POST /shift/buka '{"modal_awal":150000}' > /dev/null 2>&1 || true
CR104=$(uuid99)
# 1) Online pertama → sale terbentuk (punya nomor).
J104=$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"client_ref\":\"$CR104\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
NOM104=$(echo "$J104" | jq -r '.sale.nomor')
cek "penjualan online (client_ref) → sale dibuat" "V == 1" \
  "$([ -n "$NOM104" ] && [ "$NOM104" != "null" ] && echo 1 || echo 0)"
# 2) Retry client_ref SAMA → 200 (bukan 201), sale SAMA (tak ada sale kedua).
cek "retry penjualan client_ref sama → 200 (bukan 201)" "V == 200" \
  "$(status_code_body "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"client_ref\":\"$CR104\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "retry mengembalikan sale yang SAMA (nomor identik)" "V == 1" \
  "$(api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"client_ref\":\"$CR104\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" | jq --arg n "$NOM104" '(.sale.nomor == $n) | if . then 1 else 0 end')"
# 3) INTI: online lalu /sync dengan client_ref SAMA → sudah_ada (tak dibuat ulang).
CR104B=$(uuid99)
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"client_ref\":\"$CR104B\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" > /dev/null
SYNC104=$(jq -nc --arg r "$CR104B" --arg w "$NOW99" --arg m "$PBA_ID" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{is_dine_in:false,items:[{menu_id:$m,qty:1}]}}]}')
cek "sync penjualan client_ref yg SUDAH online → sudah_ada (inti perbaikan)" "V == 1" \
  "$(api "$KASIR" POST /sync "$SYNC104" | jq '(.hasil[0].status == "sudah_ada") | if . then 1 else 0 end')"
# 4) Absensi/saya dedup: retry client_ref sama → 200, hasil (tipe) tak berubah.
AR104=$(uuid99)
A104=$(api "$KASIR" POST /absensi/saya "{\"foto_url\":\"https://example.com/a104.jpg\",\"client_ref\":\"$AR104\"}")
TIPE104=$(echo "$A104" | jq -r '.tipe')
cek "retry absensi/saya client_ref sama → 200" "V == 200" \
  "$(status_code_body "$KASIR" POST /absensi/saya "{\"foto_url\":\"https://example.com/a104.jpg\",\"client_ref\":\"$AR104\"}")"
cek "retry absensi mengembalikan hasil SAMA (tipe tak berubah)" "V == 1" \
  "$(api "$KASIR" POST /absensi/saya "{\"foto_url\":\"https://example.com/a104.jpg\",\"client_ref\":\"$AR104\"}" | jq --arg t "$TIPE104" '(.tipe == $t) | if . then 1 else 0 end')"
# 5) INTI absen: online lalu /sync absen_saya client_ref sama → sudah_ada.
AR104B=$(uuid99)
api "$KASIR" POST /absensi/saya "{\"foto_url\":\"https://example.com/b104.jpg\",\"client_ref\":\"$AR104B\"}" > /dev/null
SYNCA104=$(jq -nc --arg r "$AR104B" --arg w "$NOW99" '{commands:[{client_ref:$r,tipe:"absen_saya",waktu:$w,payload:{foto_url:"https://example.com/b104.jpg"}}]}')
cek "sync absen_saya client_ref yg SUDAH online → sudah_ada" "V == 1" \
  "$(api "$KASIR" POST /sync "$SYNCA104" | jq '(.hasil[0].status == "sudah_ada") | if . then 1 else 0 end')"
# 6) Regresi nol: penjualan TANPA client_ref → tetap 201 (perilaku lama).
cek "penjualan TANPA client_ref → tetap 201 (regresi nol)" "V == 201" \
  "$(status_code_body "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"

echo "== 105. token_version: reset (admin) & ganti sendiri membatalkan token lama =="
# CATATAN: bagian INI mengganti password kasir → letakkan PALING AKHIR agar
# tak memengaruhi bagian lain yang login sebagai kasir dengan password awal.
# (a) Admin mereset password karyawan → SEMUA token karyawan lama langsung batal.
OLD105=$(login "$KASIR_EMAIL" "$KASIR_PASS")
cek "token kasir lama valid sebelum reset (GET /auth/me → 200)" "V == 200" \
  "$(status_code "$OLD105" GET /auth/me)"
UIDK105=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.email=="'"$KASIR_EMAIL"'")][0].user_id')
NEWPASS105="KasirBaru123!"
cek "admin reset password kasir → 200" "V == 200" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UIDK105" "{\"password\":\"$NEWPASS105\"}")"
cek "token kasir LAMA → 401 setelah reset admin (token_version naik)" "V == 401" \
  "$(status_code "$OLD105" GET /auth/me)"
NEW105=$(login "$KASIR_EMAIL" "$NEWPASS105")
cek "login kasir dgn password baru berhasil" "V == 1" \
  "$([ -n "$NEW105" ] && [ "$NEW105" != "null" ] && echo 1 || echo 0)"
cek "token kasir baru valid (GET /auth/me → 200)" "V == 200" \
  "$(status_code "$NEW105" GET /auth/me)"
# (b) Ganti password sendiri (profil) → token lama batal, respons beri token baru
#     (re-issue) supaya tab yang mengganti tak ikut ter-logout.
NEWPASS105B="KasirBaru456!"
GP105=$(api "$NEW105" POST /profil/password "{\"password_lama\":\"$NEWPASS105\",\"password_baru\":\"$NEWPASS105B\"}")
REISS105=$(echo "$GP105" | jq -r '.token // ""')
cek "ganti password profil membalas token baru (re-issue)" "V == 1" \
  "$([ -n "$REISS105" ] && echo 1 || echo 0)"
cek "token sebelum-ganti → 401 setelah ganti password sendiri" "V == 401" \
  "$(status_code "$NEW105" GET /auth/me)"
cek "token re-issue valid (GET /auth/me → 200)" "V == 200" \
  "$(status_code "$REISS105" GET /auth/me)"

# ── DIKEMBALIKAN SEPERTI SEMULA ───────────────────────────────────────────
# Seksi ini mengganti password kasir DUA KALI dan dulu membiarkannya begitu.
# Catatan di kepalanya menyandarkan keamanannya pada penempatan ("letakkan
# PALING AKHIR") — dan penempatan itu sudah tak berlaku sejak lama: ada ~115
# seksi di bawah ini sekarang.
#
# Yang lebih penting, sandaran itu hanya melindungi SKRIP INI. Apa pun yang
# berjalan SESUDAH verify-api terhadap basis data yang sama — suite e2e web di
# CI, misalnya — akan mencoba login kasir dengan password seed dan ditolak.
# Persis itu yang terjadi saat Playwright dipasang di job yang sama: dua spec
# merah, dan sebabnya berjarak 4.000 baris dari gejalanya.
#
# Maka passwordnya dipulihkan di sini, dan pemulihannya ikut DIUJI — kalau
# reset-nya gagal, yang merah seksi ini, bukan suite orang lain.
cek "password kasir dipulihkan ke semula → 200" "V == 200" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UIDK105" "{\"password\":\"$KASIR_PASS\"}")"
PULIH105=$(login "$KASIR_EMAIL" "$KASIR_PASS")
cek "login kasir dgn password SEMULA berhasil lagi" "V == 1" \
  "$([ -n "$PULIH105" ] && [ "$PULIH105" != "null" ] && echo 1 || echo 0)"
# `$REISS105` diperbarui — dan HANYA itu, dengan sengaja.
#
# Reset password menaikkan `token_version`, jadi SEMUA token kasir sebelumnya
# jadi 401 — termasuk `$REISS105`, token hasil re-issue di atas. Dan
# `$REISS105`-lah yang dipakai ~60 asersi di seksi-seksi bawah sebagai "token
# kasir" (§137 bahkan menjelaskannya dalam komentar: "$KASIR sudah 401 sejak
# §105"). Memulihkan password tanpa memperbaruinya membuat §137 mati dengan
# `jq: Cannot index object with number` — badan 401 yang diindeks seperti
# larik, 1.300 baris dari sebabnya. Persis itu yang terjadi pada percobaan
# pertama pemulihan ini.
#
# `$KASIR` sengaja DIBIARKAN MATI meski passwordnya sudah pulih: penjaga
# `verify-api-token.test.ts` melarang variabel itu muncul lagi sesudah §105,
# dan larangannya berharga — dua ronde CI pernah habis mengejar 401 yang
# menyamar jadi bug produk. Satu nama untuk "token kasir sesudah §105", dan
# nama itu `$REISS105`.
REISS105="$PULIH105"

echo "== 106. Verifikasi email wajib saat daftar (anti-enumerasi + blokir login) =="
# (email sudah dikosongkan lagi di akhir §97 → mode dev: dev_verify_url tersedia)
# (a) Daftar email BARU → respons netral + tautan verifikasi; belum bisa login.
R106=$(api "" POST /auth/register '{"nama":"Verif 106","email":"verif106@example.com","password":"Verif10634"}')
cek "daftar baru: ok true tanpa sesi" "V == 1" \
  "$(echo "$R106" | jq '((.ok==true) and (.token==null))|if . then 1 else 0 end')"
cek "daftar baru: ada tautan verifikasi (dev)" "V == 1" \
  "$(echo "$R106" | jq '((.dev_verify_url|length)>0)|if . then 1 else 0 end')"
cek "login sebelum verifikasi → 403" "V == 403" \
  "$(status_code_body "" POST /auth/login '{"email":"verif106@example.com","password":"Verif10634"}')"
# (b) Anti-enumerasi: daftar email yang SUDAH terdaftar → 200 netral, tanpa tautan.
DUP106=$(api "" POST /auth/register "{\"nama\":\"X\",\"email\":\"$KASIR_EMAIL\",\"password\":\"Verif10634\"}")
cek "daftar email terdaftar → 200 netral (bukan 409)" "V == 200" \
  "$(status_code_body "" POST /auth/register "{\"nama\":\"X\",\"email\":\"$KASIR_EMAIL\",\"password\":\"Verif10634\"}")"
cek "daftar email terdaftar → ok true & TANPA tautan (tak bocorkan keberadaan)" "V == 1" \
  "$(echo "$DUP106" | jq '((.ok==true) and (.dev_verify_url==null))|if . then 1 else 0 end')"
# (c) Verifikasi token → sesi; login sesudahnya → 200.
VT106=$(echo "$R106" | jq -r '.dev_verify_url' | sed 's/.*token=//')
V106=$(api "" POST /auth/verify-email "{\"token\":\"$VT106\"}")
cek "verifikasi email: dapat sesi (token)" "V == 1" "$(echo "$V106" | jq '((.token|length)>0)|if . then 1 else 0 end')"
cek "login sesudah verifikasi → 200" "V == 200" \
  "$(status_code_body "" POST /auth/login '{"email":"verif106@example.com","password":"Verif10634"}')"
# (d) Token bekas → 400; token ngawur → 400.
cek "verifikasi token bekas → 400" "V == 400" \
  "$(status_code_body "" POST /auth/verify-email "{\"token\":\"$VT106\"}")"
cek "verifikasi token ngawur → 400" "V == 400" \
  "$(status_code_body "" POST /auth/verify-email '{"token":"tokenngawur106"}')"
# (e) Kirim ulang verifikasi: selalu netral. Akun belum-verif → tautan baru;
#     email tak dikenal → 200 tanpa tautan.
api "" POST /auth/register '{"nama":"Verif106B","email":"verif106b@example.com","password":"Verif10634"}' > /dev/null
RESEND106=$(api "" POST /auth/resend-verification '{"email":"verif106b@example.com"}')
cek "kirim ulang (akun belum verif) → tautan baru" "V == 1" \
  "$(echo "$RESEND106" | jq '((.ok==true) and ((.dev_verify_url|length)>0))|if . then 1 else 0 end')"
cek "kirim ulang (email tak dikenal) → 200 tanpa tautan" "V == 1" \
  "$(api "" POST /auth/resend-verification '{"email":"tidakada106@example.com"}' | jq '((.ok==true) and (.dev_verify_url==null))|if . then 1 else 0 end')"

echo "== 107. Role Kitchen: produksi lokal di cabang store =="
# Kitchen = tim cabang store + akses Produksi lokal: hanya bahan yang di Resep
# ditandai produksi_di="cabang"; hasil selesai LANGSUNG masuk stok cabangnya.
# Tanpa /pembelian, tanpa kirim lintas cabang. Penempatan wajib cabang store.
KANTOR107_ID=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="kantor")][0].id')
# (a) Guard penempatan: wajib cabang + wajib bertipe store.
cek "buat kitchen tanpa cabang → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /karyawan '{"nama":"K107","email":"kitchen107@basooopa.id","password":"Kitchen107!","role":"kitchen"}')"
cek "buat kitchen di Central Kitchen → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /karyawan "{\"nama\":\"K107\",\"email\":\"kitchen107@basooopa.id\",\"password\":\"Kitchen107!\",\"role\":\"kitchen\",\"branch_id\":\"$CK52_UTAMA\"}")"
cek "buat kitchen di Kantor → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /karyawan "{\"nama\":\"K107\",\"email\":\"kitchen107@basooopa.id\",\"password\":\"Kitchen107!\",\"role\":\"kitchen\",\"branch_id\":\"$KANTOR107_ID\"}")"
api "$OWNER" POST /karyawan "{\"nama\":\"Kitchen 107\",\"email\":\"kitchen107@basooopa.id\",\"password\":\"Kitchen107!\",\"role\":\"kitchen\",\"branch_id\":\"$CB46_ID\"}" > /dev/null
TKIT=$(login kitchen107@basooopa.id 'Kitchen107!')
U107_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.email=="kitchen107@basooopa.id")][0].user_id')
cek "login kitchen: role kitchen + terkunci cabang store" "V == 1" \
  "$(api "$TKIT" GET /auth/me | jq --arg b "$CB46_ID" '((.user.role=="kitchen") and (.user.branch_id==$b))|if . then 1 else 0 end')"
# (b) Gerbang menu: produksi terbuka, pembelian & manajemen tertutup, stok/opname boleh.
cek "kitchen GET /produksi → 200" "V == 200" "$(status_code "$TKIT" GET /produksi)"
cek "kitchen GET /pembelian → 403 (tanpa Beli)" "V == 403" "$(status_code "$TKIT" GET /pembelian)"
cek "kitchen GET /stok → 200" "V == 200" "$(status_code "$TKIT" GET /stok)"
cek "kitchen GET /karyawan → 403" "V == 403" "$(status_code "$TKIT" GET /karyawan)"
cek "kitchen POST /penjualan → 403 (bukan kasir)" "V == 403" \
  "$(status_code_body "$TKIT" POST /penjualan '{}')"
cek "kitchen opname: lolos gerbang peran (400 validasi, bukan 403)" "V == 400" \
  "$(status_code_body "$TKIT" POST /stok/opname '{}')"
# (c) Pengaturan lokasi produksi di Resep: default "ck"; owner set ke "cabang".
IPRODA=$(api "$OWNER" GET /bahan | jq -r '[.[]|select(.pengadaan=="produksi" and .track_stok)][0].id')
cek "default bahan produksi: produksi_di == ck" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq '[.[]|select(.pengadaan=="produksi" and .track_stok)][0].produksi_di=="ck"|if . then 1 else 0 end')"
# Kitchen belum boleh memproduksi bahan ber-produksi_di "ck".
B107="{\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$IPRODA\",\"mode\":\"pcs\",\"jumlah\":5}]}"
cek "kitchen produksi bahan 'ck' → 400 (harus diatur di Resep dulu)" "V == 400" \
  "$(status_code_body "$TKIT" POST /produksi/faktur "$B107")"
cek "owner set produksi_di=cabang via PUT /bahan" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$IPRODA" '{"produksi_di":"cabang"}' | jq '.produksi_di=="cabang"|if . then 1 else 0 end')"
# (d) Faktur produksi kitchen: lahir di cabangnya sendiri; cabang lain ditolak.
cek "kitchen faktur produksi dgn branch_id cabang lain → 403" "V == 403" \
  "$(status_code_body "$TKIT" POST /produksi/faktur "{\"branch_id\":\"$ST52_ID\",\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$IPRODA\",\"mode\":\"pcs\",\"jumlah\":5}]}")"
FK107=$(api "$TKIT" POST /produksi/faktur "$B107" | jq -r .faktur_id)
cek "kitchen buat faktur produksi lokal → faktur_id terbit" "V == 1" \
  "$([ -n "$FK107" ] && [ "$FK107" != "null" ] && echo 1 || echo 0)"
cek "faktur kitchen tercatat di cabang kitchen (CB46)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=200" | jq --arg f "$FK107" '[.rows[]|select(.faktur_id==$f)]|length >= 1|if . then 1 else 0 end')"
# (e) Selesai → LANGSUNG masuk stok cabang store (auto-confirm lokal).
S107_AWAL=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$IPRODA" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
api "$TKIT" POST "/produksi/tahap/$FK107" '{"ke":"dikerjakan","paksa":true}' > /dev/null
api "$TKIT" POST "/produksi/tahap/$FK107" '{"ke":"menunggu"}' > /dev/null
cek "faktur kitchen otomatis dikonfirmasi (produksi lokal)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=200" | jq --arg f "$FK107" '[.rows[]|select(.faktur_id==$f)|.status]|all(.=="dikonfirmasi")|if . then 1 else 0 end')"
S107_AKHIR=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$IPRODA" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "hasil produksi kitchen masuk stok cabang store (+5)" "abs(V - 5) < 0.001" \
  "$(python3 -c "print($S107_AKHIR - $S107_AWAL)")"
# (f) Kitchen tak boleh mengirim hasil ke cabang lain (produksi lokal saja) —
#     jalur items (per-baris) yang memproses tujuan_branch_id.
FK107B=$(api "$TKIT" POST /produksi/faktur "$B107" | jq -r .faktur_id)
api "$TKIT" POST "/produksi/tahap/$FK107B" '{"ke":"dikerjakan","paksa":true}' > /dev/null
RID107=$(api "$TKIT" GET "/produksi?per_page=200" | jq -r --arg f "$FK107B" '[.rows[]|select(.faktur_id==$f)][0].id')
cek "kitchen kirim lintas cabang (tujuan_branch_id) → 403" "V == 403" \
  "$(status_code_body "$TKIT" POST "/produksi/tahap/$FK107B" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID107\",\"qty\":5}],\"tujuan_branch_id\":\"$ST52_ID\"}")"

echo "== 108. Rencana dari menu sadar lokasi produksi (produksi_di=cabang) =="
# Bahan produksi ber-"Diproduksi di: Cabang" pada rencana work-order CK:
# TIDAK dikirim dari stok CK & TIDAK di-work-order-kan ke CK — faktur produksi
# lahir di CABANG tujuan (kitchen mengerjakan; hasil langsung masuk stok
# cabang). Bahan mentahnya dihitung terhadap stok cabang & belanjanya dikirim
# ke cabang. Pola permintaan sama dgn §62: menu PBA, CK52_UTAMA → CB46.
# porsi BESAR agar kebutuhan melampaui sisa stok CK (§62) → pasti ada baris
# produksi baru (bukan hanya kirim-dari-stok)
B108="{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":2000}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}"
PRE108=$(api "$OWNER" POST /rekomendasi/menu "$B108")
IP108=$(echo "$PRE108" | jq -r '[.bahan[]|select(.pengadaan=="produksi" and .qty_faktur!=null)][0].ingredient_id')
cek "dasar uji: ada bahan produksi kurang di rencana" "V == 1" \
  "$([ -n "$IP108" ] && [ "$IP108" != "null" ] && echo 1 || echo 0)"
api "$OWNER" PUT "/bahan/$IP108" '{"produksi_di":"cabang"}' > /dev/null
PRE108B=$(api "$OWNER" POST /rekomendasi/menu "$B108")
cek "preview: baris bahan bertanda produksi_di=cabang" "V == 1" \
  "$(echo "$PRE108B" | jq --arg i "$IP108" '[.bahan[]|select(.ingredient_id==$i)][0].produksi_di=="cabang"|if . then 1 else 0 end')"
cek "preview: kirim_ck bahan cabang = 0 (tak ditutup stok CK)" "V == 0" \
  "$(echo "$PRE108B" | jq --arg i "$IP108" '[.bahan[]|select(.ingredient_id==$i)][0].kirim_ck')"
HAS108=$(api "$OWNER" POST /rekomendasi/menu/faktur "$B108")
PC108=$(echo "$HAS108" | jq -r '.produksi_cabang.faktur_id')
cek "faktur produksi_cabang terbit" "V == 1" \
  "$([ -n "$PC108" ] && [ "$PC108" != "null" ] && echo 1 || echo 0)"
cek "faktur cabang lahir di store CB46 (lokal: tujuan & untuk null, rencana)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$PC108" '([.rows[]|select(.faktur_id==$f)] | (length>0) and all(.[]; .tujuan_branch_id==null and .untuk_branch_id==null and .status=="rencana")) | if . then 1 else 0 end')"
# faktur produksi CK (bila ada) TIDAK memuat bahan ber-produksi_di cabang
PROD108=$(echo "$HAS108" | jq -r '.produksi.faktur_id // ""')
if [ -n "$PROD108" ]; then
  cek "faktur produksi CK tak memuat bahan cabang" "V == 0" \
    "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$PROD108" --arg i "$IP108" '[.rows[]|select(.faktur_id==$f and .ingredient_id==$i)] | length')"
else
  ok "faktur produksi CK tak memuat bahan cabang (tak ada faktur CK)"
fi
# kitchen cabang mengerjakan faktur → self-assign, selesai → LANGSUNG masuk stok
S108_A=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$IP108" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
api "$TKIT" POST "/produksi/tahap/$PC108" '{"ke":"dikerjakan","paksa":true}' > /dev/null
api "$TKIT" POST "/produksi/tahap/$PC108" '{"ke":"menunggu"}' > /dev/null
cek "kitchen selesai → faktur cabang otomatis dikonfirmasi" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$PC108" '([.rows[]|select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="dikonfirmasi")) | if . then 1 else 0 end')"
S108_B=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$IP108" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "hasil produksi cabang masuk stok store (saldo naik)" "V == 1" \
  "$(jq -n --argjson a "$S108_A" --argjson b "$S108_B" '($b > $a) | if . then 1 else 0 end')"
# Data Permintaan Stok: bila ada DUA faktur produksi (CK + cabang), bagian
# produksi_cabang terpisah; bila hanya faktur cabang, tampil sebagai `produksi`.
if [ -n "$PROD108" ]; then
  cek "permintaan: produksi CK & produksi_cabang terpisah dlm 1 entri" "V == 1" \
    "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg p "$PROD108" --arg f "$PC108" '[.[]|select(.produksi.faktur_id==$p and .produksi_cabang.faktur_id==$f)] | length | if . >= 1 then 1 else 0 end')"
else
  cek "permintaan: faktur cabang (satu-satunya produksi) tercatat" "V == 1" \
    "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg f "$PC108" '[.[]|select(.produksi.faktur_id==$f or .produksi_cabang.faktur_id==$f)] | length | if . >= 1 then 1 else 0 end')"
fi

echo "== 109. Cabang produsen bernama per bahan (produksi_branch_ids) =="
# produksi_di="cabang" kini bisa dibatasi ke cabang store tertentu lewat daftar
# produsen (kosong = semua cabang store). Kitchen di luar daftar ditolak 400;
# planner memperlakukan cabang non-produsen lewat jalur CK (kirim/work-order).
# (a) Validasi daftar: hanya cabang store aktif milik perusahaan.
cek "set produsen berisi CK → 400" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/bahan/$IPRODA" "{\"produksi_di\":\"cabang\",\"produksi_branch_ids\":[\"$CK52_UTAMA\"]}")"
cek "set produsen = [Store 52] → tersimpan" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$IPRODA" "{\"produksi_di\":\"cabang\",\"produksi_branch_ids\":[\"$ST52_ID\"]}" | jq --arg b "$ST52_ID" '.produksi_branch_ids==[$b]|if . then 1 else 0 end')"
cek "GET /bahan memuat daftar produsen" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$IPRODA" --arg b "$ST52_ID" '[.[]|select(.id==$i)][0].produksi_branch_ids==[$b]|if . then 1 else 0 end')"
# (b) Kitchen CB46 (di LUAR daftar) tak boleh memproduksi; masuk daftar → boleh.
B109="{\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$IPRODA\",\"mode\":\"pcs\",\"jumlah\":2}]}"
cek "kitchen cabang non-produsen → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /produksi/faktur "$B109")"
api "$OWNER" PUT "/bahan/$IPRODA" "{\"produksi_branch_ids\":[\"$CB46_ID\",\"$ST52_ID\"]}" > /dev/null
FK109=$(api "$TKIT" POST /produksi/faktur "$B109" | jq -r .faktur_id)
cek "cabang masuk daftar produsen → kitchen boleh produksi" "V == 1" \
  "$([ -n "$FK109" ] && [ "$FK109" != "null" ] && echo 1 || echo 0)"
# (c) Planner: cabang tujuan di LUAR daftar produsen jatuh ke jalur CK.
api "$OWNER" PUT "/bahan/$IP108" "{\"produksi_di\":\"cabang\",\"produksi_branch_ids\":[\"$ST52_ID\"]}" > /dev/null
cek "preview: tujuan CB46 non-produsen → bahan dihitung jalur CK" "V == 1" \
  "$(api "$OWNER" POST /rekomendasi/menu "$B108" | jq --arg i "$IP108" '[.bahan[]|select(.ingredient_id==$i)][0].produksi_di=="ck"|if . then 1 else 0 end')"
# (d) Daftar kosong = SEMUA cabang (perilaku lama).
api "$OWNER" PUT "/bahan/$IP108" '{"produksi_branch_ids":[]}' > /dev/null
cek "preview: daftar kosong → kembali produksi_di=cabang" "V == 1" \
  "$(api "$OWNER" POST /rekomendasi/menu "$B108" | jq --arg i "$IP108" '[.bahan[]|select(.ingredient_id==$i)][0].produksi_di=="cabang"|if . then 1 else 0 end')"
# (e) produksi_di kembali "ck" → daftar produsen ikut dibersihkan otomatis.
cek "PUT produksi_di=ck → daftar produsen dikosongkan" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$IPRODA" '{"produksi_di":"ck"}' | jq '.produksi_branch_ids==[]|if . then 1 else 0 end')"
cek "GET /bahan: daftar produsen kosong setelah kembali ck" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$IPRODA" '[.[]|select(.id==$i)][0].produksi_branch_ids==[]|if . then 1 else 0 end')"

echo "== 110. Faktur beli perlengkapan per FAKTUR + tampil di Permintaan Stok =="
# Beli perlengkapan kini berkelompok FAKTUR (seperti beli bahan baku): satu
# submit = satu BP- multi-item; permintaan-otomatis ber-rencana_id menautkan
# faktur ke Data Permintaan Stok (bagian beli_perlengkapan).
# (a) rencana baru dari menu → rencana_id ikut di hasil faktur.
B110="{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":500}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}"
R110=$(api "$OWNER" POST /rekomendasi/menu/faktur "$B110" | jq -r '.rencana_id // ""')
cek "hasil faktur rencana memuat rencana_id" "V == 1" \
  "$([ -n "$R110" ] && echo 1 || echo 0)"
# (b) dua item perlengkapan kurang (CK kosong) → SATU faktur BP multi-item.
P110A=$(api "$OWNER" POST /perlengkapan '{"nama":"Serbet Uji 110","satuan":"pcs","stok_minimum":3}' | jq -r .id)
P110B=$(api "$OWNER" POST /perlengkapan '{"nama":"Spons Uji 110","satuan":"pcs","stok_minimum":2}' | jq -r .id)
HB110=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$CB46_ID&rencana_id=$R110" '{}')
FB110=$(echo "$HB110" | jq -r '.beli_faktur.faktur_id // ""')
cek "SATU faktur BP- menaungi seluruh item beli (>=2 baris)" "V == 1" \
  "$(echo "$HB110" | jq --arg a "$P110A" --arg b "$P110B" '((.beli_faktur.nomor // "")|test("^BP-")) and (.beli_faktur.jumlah_baris >= 2) and ([.beli_dibuat[].supply_id]|contains([$a,$b])) | if . then 1 else 0 end')"
cek "semua item beli memakai SATU nomor BP- yang sama" "V == 1" \
  "$(echo "$HB110" | jq '([.beli_dibuat[].nomor]|unique|length)==1 | if . then 1 else 0 end')"
cek "daftar beli: baris kedua item berbagi faktur_id yang sama" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg a "$P110A" --arg b "$P110B" --arg f "$FB110" '([.[]|select(.supply_id==$a or .supply_id==$b)|.faktur_id]|unique)==[$f] | if . then 1 else 0 end')"
# (c) Data Permintaan Stok: bagian beli_perlengkapan tampil di entri rencana.
cek "permintaan stok memuat bagian beli_perlengkapan (menunggu)" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg r "$R110" --arg f "$FB110" '[.[]|select(.rencana_id==$r)][0].beli_perlengkapan | ((.faktur_id==$f) and (.status=="menunggu") and (.jumlah_baris>=2)) | if . then 1 else 0 end')"
# (d) Tiba per FAKTUR: semua baris diproses sekaligus + kiriman otomatis.
TB110=$(api "$OWNER" POST "/perlengkapan/beli/faktur/$FB110/tiba" '{}')
cek "tiba per faktur: >=2 baris diproses + kiriman KP- terbit" "V == 1" \
  "$(echo "$TB110" | jq '((.jumlah_tiba >= 2) and ((.kiriman|length) >= 2)) | if . then 1 else 0 end')"
cek "semua baris faktur kini 'tiba'" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FB110" '[.[]|select(.faktur_id==$f)|.status]|unique==["tiba"] | if . then 1 else 0 end')"
cek "permintaan stok: bagian beli_perlengkapan → 'tiba'" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg r "$R110" '[.[]|select(.rencana_id==$r)][0].beli_perlengkapan.status=="tiba" | if . then 1 else 0 end')"
cek "tiba per faktur lagi (sudah tiba) → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/beli/faktur/$FB110/tiba" '{}')"
# (e) MANUAL multi-item: satu faktur berisi 2 item, lalu batal per faktur.
MAN110=$(api "$OWNER" POST /perlengkapan/beli "{\"items\":[{\"supply_id\":\"$P110A\",\"qty\":1},{\"supply_id\":\"$P110B\",\"qty\":2,\"total_harga\":5000}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
FM110=$(echo "$MAN110" | jq -r '.faktur_id // ""')
cek "manual multi-item: faktur BP- terbit (2 baris)" "V == 1" \
  "$(echo "$MAN110" | jq '((.nomor // "")|test("^BP-")) and ((.ids|length)==2) | if . then 1 else 0 end')"
cek "batal per faktur → 2 baris dibatalkan" "V == 1" \
  "$(api "$OWNER" POST "/perlengkapan/beli/faktur/$FM110/batal" '{}' | jq '(.ok==true) and (.jumlah==2) | if . then 1 else 0 end')"
cek "batal per faktur lagi → 404" "V == 404" \
  "$(status_code "$OWNER" POST "/perlengkapan/beli/faktur/$FM110/batal")"
# (f) HAPUS permintaan → faktur BP tertaut yang masih 'menunggu' ikut batal.
api "$OWNER" POST /perlengkapan '{"nama":"Lap Uji 110","satuan":"pcs","stok_minimum":4}' > /dev/null
R110B=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":300}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq -r '.rencana_id // ""')
HB2=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$CB46_ID&rencana_id=$R110B")
FB2=$(echo "$HB2" | jq -r '.beli_faktur.faktur_id // ""')
cek "dasar uji: faktur BP tertaut rencana baru terbit" "V == 1" \
  "$([ -n "$FB2" ] && echo 1 || echo 0)"
# Batalkan faktur SAAT permintaan MASIH ADA → tetap tampil sebagai 'batal'
# (pembatalan sah; permintaannya masih hidup — inilah arti "Dibatalkan").
api "$OWNER" POST "/perlengkapan/beli/faktur/$FB2/batal" '{}' > /dev/null
cek "batal faktur (permintaan masih ada) → tetap tampil 'batal'" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FB2" '[.[]|select(.faktur_id==$f)|.status]|unique==["batal"] | if . then 1 else 0 end')"
# HAPUS permintaan → productions soft-delete; faktur BP tertaut kini HILANG dari
# daftar (tak lagi "Dibatalkan" menggantung — konsisten dgn permintaan yg lenyap).
api "$OWNER" DELETE "/rekomendasi/permintaan/$R110B" > /dev/null
cek "hapus permintaan → faktur BP tertaut HILANG dari daftar" "V == 0" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FB2" '[.[]|select(.faktur_id==$f)]|length')"
# (g) BATAL SEMUA yang menunggu (bersih-bersih faktur warisan tanpa tautan).
LAP110=$(api "$OWNER" GET /perlengkapan/master | jq -r '[.[]|select(.nama=="Lap Uji 110")][0].id')
api "$OWNER" POST /perlengkapan/beli "{\"items\":[{\"supply_id\":\"$LAP110\",\"qty\":1}],\"ck_branch_id\":\"$CK52_UTAMA\"}" > /dev/null
# token $KASIR sudah 401 sejak §105 (token_version) — pakai kitchen (§107)
cek "guard: kitchen batal-semua → 403" "V == 403" \
  "$(status_code "$TKIT" POST /perlengkapan/beli/batal-semua)"
cek "batal-semua → semua faktur menunggu dibatalkan (>=1)" "V == 1" \
  "$(api "$OWNER" POST /perlengkapan/beli/batal-semua '{}' | jq '(.ok==true) and (.jumlah>=1) | if . then 1 else 0 end')"
cek "tidak ada lagi faktur menunggu setelah batal-semua" "V == 0" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq '[.[]|select(.status=="menunggu")]|length')"

echo "== 111. Performa HTTP: kompresi respons + cache aset ber-hash =="
# Kompresi gzip utk respons kompresibel ≥1 KB; aset /assets/* (ber-hash per
# build) di-cache immutable setahun; HTML shell tetap no-cache.
header_of() { # header_of <nama-header> <curl args...>
  local nama="$1"; shift
  curl -s -o /dev/null -D - "$@" | tr -d '\r' | awk -F': ' -v n="$nama" 'tolower($1)==n{print $2}' | tail -1
}
ENC111=$(header_of "content-encoding" -H 'Accept-Encoding: gzip' -H "Authorization: Bearer $OWNER" "$BASE/api/bahan")
cek "API JSON besar terkompresi gzip" "V == 1" "$([ "$ENC111" = "gzip" ] && echo 1 || echo 0)"
ENC111B=$(header_of "content-encoding" -H "Authorization: Bearer $OWNER" "$BASE/api/bahan")
cek "tanpa Accept-Encoding → tidak dikompresi" "V == 1" "$([ -z "$ENC111B" ] && echo 1 || echo 0)"
CCSHELL=$(header_of "cache-control" "$BASE/")
cek "HTML shell tetap no-cache" "V == 1" "$(echo "$CCSHELL" | grep -q no-cache && echo 1 || echo 0)"
ASET111=$(curl -s "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
if [ -n "$ASET111" ]; then
  CC111=$(header_of "cache-control" "$BASE$ASET111")
  cek "aset ber-hash ber-Cache-Control immutable" "V == 1" \
    "$(echo "$CC111" | grep -q immutable && echo 1 || echo 0)"
  ENC111C=$(header_of "content-encoding" -H 'Accept-Encoding: gzip' "$BASE$ASET111")
  cek "aset JS terkompresi gzip" "V == 1" "$([ "$ENC111C" = "gzip" ] && echo 1 || echo 0)"
else
  ok "aset ber-hash immutable (dilewati — web dist tak tersedia)"
  ok "aset JS terkompresi (dilewati — web dist tak tersedia)"
fi

echo "== 112. GET /bahan?ringkas=1 (varian ringan untuk halaman picker) =="
# Varian ringkas melewati agregasi supplier & rak (dua query terberat GET
# /bahan) — bentuk DTO tetap sama: supplier_utama null, jumlah_supplier 0,
# rak_lokasi []. produksi_branch_ids TETAP dimuat (filter picker kitchen).
BH112_ID=$(api "$OWNER" POST /bahan '{"nama":"gula uji112","harga_beli":12000,"isi":1000,"satuan":"gr","kategori":"lain"}' | jq -r .id)
SUP112=$(api "$OWNER" POST /supplier '{"nama":"Supplier Uji 112"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$BH112_ID/supplier" "{\"items\":[{\"supplier_id\":\"$SUP112\",\"is_utama\":true}]}" > /dev/null
api "$OWNER" PUT "/bahan/$IPRODA" "{\"produksi_di\":\"cabang\",\"produksi_branch_ids\":[\"$ST52_ID\"]}" > /dev/null
FL112=$(api "$OWNER" GET /bahan)
RK112=$(api "$OWNER" GET "/bahan?ringkas=1")
cek "varian lengkap tetap memuat supplier" "V == 1" \
  "$(echo "$FL112" | jq --arg i "$BH112_ID" '[.[]|select(.id==$i)][0] | (.supplier_utama=="Supplier Uji 112") and (.jumlah_supplier==1) | if . then 1 else 0 end')"
cek "ringkas: jumlah baris sama dengan varian lengkap" "V == 1" \
  "$(jq -n --argjson a "$(echo "$RK112" | jq 'length')" --argjson b "$(echo "$FL112" | jq 'length')" '($a==$b) and ($a>0) | if . then 1 else 0 end')"
cek "ringkas: supplier & rak kosong di semua baris" "V == 0" \
  "$(echo "$RK112" | jq '[.[]|select(.supplier_utama!=null or .jumlah_supplier!=0 or .rak_lokasi!=[])]|length')"
cek "ringkas: produksi_branch_ids tetap dimuat" "V == 1" \
  "$(echo "$RK112" | jq --arg i "$IPRODA" --arg b "$ST52_ID" '[.[]|select(.id==$i)][0].produksi_branch_ids==[$b] | if . then 1 else 0 end')"
cek "ringkas: kolom lain identik dengan varian lengkap" "V == 1" \
  "$(jq -n --argjson a "$(echo "$RK112" | jq --arg i "$BH112_ID" '[.[]|select(.id==$i)][0] | del(.supplier_utama,.jumlah_supplier,.rak_lokasi)')" \
          --argjson b "$(echo "$FL112" | jq --arg i "$BH112_ID" '[.[]|select(.id==$i)][0] | del(.supplier_utama,.jumlah_supplier,.rak_lokasi)')" \
          '$a==$b | if . then 1 else 0 end')"

echo "== 113. GET /bahan/resep-ringkas (peta jumlah komponen, batch) =="
# Satu request menggantikan satu GET /bahan/:id/resep per bahan produksi
# (badge daftar Resep). Peta hanya memuat bahan yang punya komponen.
BP113_ID=$(api "$OWNER" POST /bahan '{"nama":"adonan uji113","harga_beli":0,"isi":10,"satuan":"pcs","kategori":"lain","pengadaan":"produksi"}' | jq -r .id)
BK113_ID=$(api "$OWNER" POST /bahan '{"nama":"tepung uji113","harga_beli":8000,"isi":1000,"satuan":"gr","kategori":"lain"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$BP113_ID/resep" "{\"komponen\":[{\"ingredient_id\":\"$BK113_ID\",\"qty\":500},{\"ingredient_id\":\"$BH112_ID\",\"qty\":200}]}" > /dev/null
RR113=$(api "$OWNER" GET /bahan/resep-ringkas)
cek "peta memuat jumlah komponen bahan ber-resep" "V == 2" \
  "$(echo "$RR113" | jq --arg i "$BP113_ID" '.[$i] // 0')"
cek "konsisten dengan GET /bahan/:id/resep" "V == 2" \
  "$(api "$OWNER" GET "/bahan/$BP113_ID/resep" | jq 'length')"
BP113B_ID=$(api "$OWNER" POST /bahan '{"nama":"adonan kosong uji113","harga_beli":0,"isi":5,"satuan":"pcs","kategori":"lain","pengadaan":"produksi"}' | jq -r .id)
cek "bahan produksi tanpa resep tidak muncul di peta" "V == 0" \
  "$(api "$OWNER" GET /bahan/resep-ringkas | jq --arg i "$BP113B_ID" 'has($i) | if . then 1 else 0 end')"

echo "== 114. Cache immutable /uploads/* + guard fallback tak ikut immutable =="
# Nama file upload = UUID unik per unggahan (konten satu URL tak pernah
# berubah) → aman di-cache setahun. Respons 404 dan fallback shell TIDAK
# boleh ikut tertanda immutable (bisa meracuni cache CDN di URL lama).
PNG114=$(mktemp --suffix=.png)
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$PNG114"
URL114=$(curl -s -X POST "$BASE/api/upload?tujuan=menu" -H "Authorization: Bearer $OWNER" -F "file=@$PNG114;type=image/png" | jq -r '.url // ""')
cek "dasar uji: upload gambar sukses (url /uploads/…)" "V == 1" \
  "$(echo "$URL114" | grep -q '^/uploads/' && echo 1 || echo 0)"
CC114=$(header_of "cache-control" "$BASE$URL114")
cek "file upload tersaji ber-Cache-Control immutable" "V == 1" \
  "$(echo "$CC114" | grep -q immutable && echo 1 || echo 0)"
CC114B=$(header_of "cache-control" "$BASE/uploads/companies/x/menu/tidak-ada-114.png")
cek "upload hilang → 404 tanpa immutable" "V == 1" \
  "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/uploads/companies/x/menu/tidak-ada-114.png")" = "404" ] && ! echo "$CC114B" | grep -q immutable && echo 1 || echo 0)"
if [ -n "$ASET111" ]; then
  CC114C=$(header_of "cache-control" "$BASE/assets/tidak-ada-114.js")
  cek "aset hilang → no-cache (bukan immutable)" "V == 1" \
    "$(echo "$CC114C" | grep -q no-cache && ! echo "$CC114C" | grep -q immutable && echo 1 || echo 0)"
  # Dulu jawabannya shell SPA (200 + HTML). Itu tak pernah bisa jadi deep-link
  # react-router, dan peramban yang memintanya sebagai module script hanya
  # mengeluh soal MIME — bukan soal berkas yang memang sudah tidak ada.
  cek "…dan statusnya 404, bukan shell SPA yang menyamar 200" "V == 404" \
    "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/assets/tidak-ada-114.js")"
else
  ok "aset hilang → no-cache (dilewati — web dist tak tersedia)"
  ok "…dan statusnya 404 (dilewati — web dist tak tersedia)"
fi
rm -f "$PNG114"

echo "== 115. Nomor faktur permintaan (PM-) =="
# Satu submit Tambah Stok dari Menu = satu nomor PM- (ref = rencana_id):
# tampil di Data Permintaan Stok dan sebagai badge asal di baris faktur.
H115=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":100}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
R115=$(echo "$H115" | jq -r '.rencana_id // ""')
PM115=$(echo "$H115" | jq -r '.nomor_permintaan // ""')
cek "submit rencana → nomor_permintaan berformat PM-" "V == 1" \
  "$(echo "$PM115" | grep -Eq '^PM-[0-9]{4}$' && echo 1 || echo 0)"
cek "GET /rekomendasi/permintaan memuat nomor yang sama" "V == 1" \
  "$(api "$OWNER" GET /rekomendasi/permintaan | jq --arg r "$R115" --arg n "$PM115" '[.[]|select(.rencana_id==$r)][0].nomor==$n | if . then 1 else 0 end')"
# faktur permintaan lahir di CK (bukan cabang default) → lihat semua cabang
BR115=$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg r "$R115" '[.rows[]|select(.rencana_id==$r)]')
PR115=$(api "$OWNER" GET "/produksi?branch_id=all&per_page=500" | jq --arg r "$R115" '[.rows[]|select(.rencana_id==$r)]')
cek "semua baris faktur permintaan membawa permintaan_nomor sama" "V == 1" \
  "$(jq -n --argjson a "$BR115" --argjson b "$PR115" --arg n "$PM115" '($a+$b) | (length>0 and all(.permintaan_nomor==$n)) | if . then 1 else 0 end')"
cek "faktur input langsung tanpa permintaan_nomor" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq '[.rows[]|select(.rencana_id==null and .permintaan_nomor!=null)]|length')"

echo "== 116. Beli Perlengkapan paritas bahan baku: RAB → Diproses → Tiba =="
# Faktur BP kini bertahap seperti beli bahan baku: menunggu (RAB) →
# diproses (pemroses tercatat) → tiba/batal; supplier langganan item
# (tempat beli) + harga estimasi ikut di daftar utk Dokumen RAB.
SRB116=$(api "$OWNER" POST /perlengkapan '{"nama":"Serbet Uji 116","satuan":"pcs","harga_beli":7000,"stok_minimum":0}' | jq -r .id)
api "$OWNER" PUT "/perlengkapan/$SRB116/supplier" "{\"items\":[{\"supplier_id\":\"$SUP112\",\"is_utama\":true}]}" > /dev/null
F116=$(api "$OWNER" POST /perlengkapan/beli "{\"items\":[{\"supply_id\":\"$SRB116\",\"qty\":4}],\"ck_branch_id\":\"$CK52_UTAMA\",\"tujuan_branch_id\":\"$CB46_ID\"}" | jq -r '.faktur_id // ""')
cek "daftar beli memuat tempat beli (supplier utama) + harga estimasi" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$F116" '[.[]|select(.faktur_id==$f)][0] | (.supplier_utama=="Supplier Uji 112") and (.harga_beli==7000) | if . then 1 else 0 end')"
cek "guard: kitchen tandai diproses → 403" "V == 403" \
  "$(status_code "$TKIT" POST "/perlengkapan/beli/faktur/$F116/proses")"
cek "tandai Diproses → ok" "V == 1" \
  "$(api "$OWNER" POST "/perlengkapan/beli/faktur/$F116/proses" '{}' | jq '(.ok==true) and (.jumlah>=1) | if . then 1 else 0 end')"
cek "status diproses + pemroses tercatat" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$F116" '[.[]|select(.faktur_id==$f)][0] | (.status=="diproses") and (.diproses_oleh|type=="string") | if . then 1 else 0 end')"
api "$OWNER" POST /perlengkapan/beli/batal-semua '{}' > /dev/null
cek "batal-semua TIDAK menyapu faktur yang sedang diproses" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$F116" '[.[]|select(.faktur_id==$f)][0].status=="diproses" | if . then 1 else 0 end')"
cek "tiba dari tahap diproses → masuk stok CK" "V == 1" \
  "$(api "$OWNER" POST "/perlengkapan/beli/faktur/$F116/tiba" '{}' | jq '.jumlah_tiba>=1 | if . then 1 else 0 end')"

echo "== 117. Faktur beli: langsung di cabang + tujuan kirim dari CK =="
# (a) Faktur beli dibukukan DI cabang store: baris tanpa tujuan → auto-confirm
#     saat 'menunggu' (barang langsung masuk stok cabang, tanpa lewat CK).
S117_AWAL=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BH112_ID" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
FC117=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BH112_ID\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":60000}]}" | jq -r '.faktur_id // ""')
cek "dasar uji: faktur beli di cabang store terbit" "V == 1" \
  "$([ -n "$FC117" ] && echo 1 || echo 0)"
api "$OWNER" POST "/pembelian/tahap/$FC117" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FC117" '{"ke":"menunggu"}' > /dev/null
S117_AKHIR=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BH112_ID" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "beli di cabang: Tiba → langsung masuk stok cabang (+5)" "V == 5" \
  "$(python3 -c "print(round($S117_AKHIR - $S117_AWAL))")"
# (b) Faktur beli dari CK dengan TUJUAN cabang: baris bertujuan, saat
#     'menunggu' TIDAK auto-confirm (menunggu dikirim → diterima cabang).
FT117=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"tujuan_branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BH112_ID\",\"mode\":\"pcs\",\"jumlah\":3}]}" | jq -r '.faktur_id // ""')
cek "beli dari CK bertujuan: baris menyimpan tujuan cabang" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FT117" --arg t "$CB46_ID" '[.rows[]|select(.faktur_id==$f)] | length>0 and all(.tujuan_branch_id==$t) | if . then 1 else 0 end')"
api "$OWNER" POST "/pembelian/tahap/$FT117" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FT117" '{"ke":"menunggu"}' > /dev/null
cek "baris bertujuan TIDAK auto-confirm (tetap menunggu dikirim)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FT117" '[.rows[]|select(.faktur_id==$f)] | all(.status=="menunggu") | if . then 1 else 0 end')"
# guard: tujuan bukan store aktif → 400; tujuan pada faktur produksi → 400
cek "guard: tujuan bukan cabang valid → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"tujuan_branch_id\":\"00000000-0000-0000-0000-000000000000\",\"items\":[{\"ingredient_id\":\"$BH112_ID\",\"mode\":\"pcs\",\"jumlah\":1}]}")"
cek "guard: tujuan pada faktur PRODUKSI → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"tujuan_branch_id\":\"$CB46_ID\",\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$IPRODA\",\"mode\":\"pcs\",\"jumlah\":1}]}")"

echo "== 118. Exp lot (masa simpan + override) + peringatan + catat waste + lead time =="
# master: masa simpan 5 hari + lead time 3 hari pada bahan uji
api "$OWNER" PUT "/bahan/$BH112_ID" '{"masa_simpan_hari":5,"lead_time_hari":3}' > /dev/null
B118=$(api "$OWNER" GET /bahan | jq --arg i "$BH112_ID" '[.[]|select(.id==$i)][0]')
cek "master: masa_simpan_hari tersimpan (5)" "V == 5" "$(echo "$B118" | jq '.masa_simpan_hari')"
cek "master: lead_time_hari tersimpan (3)" "V == 3" "$(echo "$B118" | jq '.lead_time_hari')"
# lead time terbawa ke Rekomendasi Beli (dasar "pesan jauh-jauh hari")
cek "rekomendasi beli membawa lead_time_hari" "V == 3" \
  "$(api "$OWNER" GET "/rekomendasi/beli?branch_id=$CB46_ID" | jq --arg i "$BH112_ID" '[.bahan[]|select(.ingredient_id==$i)][0].lead_time_hari // -1')"
TGL118=$(TZ=Asia/Jakarta date +%F)
EXP118=$(python3 -c "import datetime;print((datetime.date.fromisoformat('$TGL118')+datetime.timedelta(days=5)).isoformat())")
# (a) exp OTOMATIS: beli di cabang → Tiba (auto-confirm) → exp = hari ini + 5
FE118=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BH112_ID\",\"mode\":\"pcs\",\"jumlah\":2}]}" | jq -r '.faktur_id // ""')
api "$OWNER" POST "/pembelian/tahap/$FE118" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FE118" '{"ke":"menunggu"}' > /dev/null
cek "Tiba: exp otomatis = tanggal masuk + masa simpan" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FE118" --arg e "$EXP118" '[.rows[]|select(.faktur_id==$f)][0].exp_date == $e | if . then 1 else 0 end')"
# (b) exp OVERRIDE per baris (items[].exp) + SPLIT sebagian: qty 4 → maju 1
FO118=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BH112_ID\",\"mode\":\"pcs\",\"jumlah\":4}]}" | jq -r '.faktur_id // ""')
api "$OWNER" POST "/pembelian/tahap/$FO118" '{"ke":"dikerjakan"}' > /dev/null
IDO118=$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq -r --arg f "$FO118" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/tahap/$FO118" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$IDO118\",\"qty\":1,\"exp\":\"2030-01-31\"}]}" > /dev/null
cek "split: baris MAJU memakai exp override" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FO118" '[.rows[]|select(.faktur_id==$f and .exp_date=="2030-01-31" and .status=="dikonfirmasi")] | length')"
cek "split: baris SISA belum ber-exp (belum masuk stok)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=all&per_page=500" | jq --arg f "$FO118" '[.rows[]|select(.faktur_id==$f and .status=="dikerjakan")] | (length==1 and .[0].exp_date==null) | if . then 1 else 0 end')"
# (c) GET /stok/exp: lot exp H+5 muncul di jendela 30 hari, tidak di jendela 0
E118=$(api "$OWNER" GET "/stok/exp?branch_id=$CB46_ID&hari=30")
cek "peringatan exp: lot muncul dgn sisa_hari=5 + saldo live" "V == 1" \
  "$(echo "$E118" | jq --arg i "$BH112_ID" --arg e "$EXP118" '[.[]|select(.ingredient_id==$i and .exp_date==$e)] | (length>=1 and .[0].sisa_hari==5 and .[0].saldo>0) | if . then 1 else 0 end')"
cek "peringatan exp: jendela hari=0 tidak memuat lot H+5" "V == 0" \
  "$(api "$OWNER" GET "/stok/exp?branch_id=$CB46_ID&hari=0" | jq --arg i "$BH112_ID" --arg e "$EXP118" '[.[]|select(.ingredient_id==$i and .exp_date==$e)] | length')"
# (d) catat waste: qty > saldo → 400; valid → sesi SO menunggu ACC
SW118_A=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BH112_ID" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "waste: qty melebihi saldo → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /stok/waste "{\"branch_id\":\"$CB46_ID\",\"ingredient_id\":\"$BH112_ID\",\"qty\":999999,\"foto_url\":\"/uploads/bukti-uji.jpg\"}")"
W118=$(api "$OWNER" POST /stok/waste "{\"branch_id\":\"$CB46_ID\",\"ingredient_id\":\"$BH112_ID\",\"qty\":1,\"foto_url\":\"/uploads/bukti-uji.jpg\",\"catatan\":\"Waste kedaluwarsa uji118\"}")
SID118=$(echo "$W118" | jq -r '.session_id // ""')
cek "waste tercatat sbg sesi SO (nomor terbit)" "V == 1" \
  "$(echo "$W118" | jq '(.ok==true and (.nomor|startswith("SO"))) | if . then 1 else 0 end')"
cek "waste berkategori waste_bahan + selisih −1 (menunggu ACC)" "V == 1" \
  "$(api "$OWNER" GET "/stok/opname/sesi/$SID118" | jq '[.items[]][0] | (.penyesuaian_status=="menunggu" and .selisih==-1) | if . then 1 else 0 end')"
SW118_B=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BH112_ID" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "saldo TIDAK berubah sebelum ACC" "V == 0" "$(python3 -c "print(round($SW118_B - $SW118_A))")"
api "$OWNER" POST "/stok/opname/sesi/$SID118/acc" > /dev/null
SW118_C=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BH112_ID" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "setelah ACC: saldo turun 1 (waste efektif)" "V == -1" "$(python3 -c "print(round($SW118_C - $SW118_A))")"

# Masa simpan + lead time pada bahan PRODUKSI (jalur form Resep — PUT /bahan/:id
# parsial: hanya field ini yang berubah, isi/harga/pengadaan tak tersentuh).
api "$OWNER" PUT "/bahan/$URATB_ID" '{"masa_simpan_hari":7,"lead_time_hari":2}' > /dev/null
B118P=$(api "$OWNER" GET /bahan | jq --arg i "$URATB_ID" '[.[]|select(.id==$i)][0]')
cek "produksi: masa_simpan_hari tersimpan (7)" "V == 7" "$(echo "$B118P" | jq '.masa_simpan_hari')"
cek "produksi: lead_time_hari tersimpan (2)" "V == 2" "$(echo "$B118P" | jq '.lead_time_hari')"
cek "produksi: pengadaan tetap 'produksi' (tak ke-reset PUT parsial)" "V == 1" \
  "$(echo "$B118P" | jq '.pengadaan == "produksi" | if . then 1 else 0 end')"

echo "== 119. Hapus permanen faktur beli perlengkapan (bersih-bersih data lama) =="
# Hapus permanen HANYA utk faktur yang TAK terkait permintaan aktif & belum
# 'tiba' (masuk stok) — untuk membersihkan data lama/manual. Faktur dari
# permintaan yang masih hidup dikelola dari Permintaan Stok (bukan dihapus di sini).
SBH119=$(api "$OWNER" POST /perlengkapan '{"nama":"Serbet Hapus 119","satuan":"pcs","harga_beli":3000,"stok_minimum":0}' | jq -r .id)
# (a) faktur MANUAL (tanpa permintaan) → permintaan_aktif=false → boleh Hapus
FM119=$(api "$OWNER" POST /perlengkapan/beli "{\"items\":[{\"supply_id\":\"$SBH119\",\"qty\":2}],\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq -r '.faktur_id // ""')
cek "faktur manual: permintaan_aktif=false (boleh hapus)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FM119" '[.[]|select(.faktur_id==$f)][0].permintaan_aktif==false | if . then 1 else 0 end')"
cek "guard: kitchen hapus faktur perlengkapan → 403" "V == 403" \
  "$(status_code "$TKIT" DELETE "/perlengkapan/beli/faktur/$FM119")"
cek "hapus faktur manual → ok + baris terhapus" "V == 1" \
  "$(api "$OWNER" DELETE "/perlengkapan/beli/faktur/$FM119" | jq '(.ok==true) and (.jumlah>=1) | if . then 1 else 0 end')"
cek "faktur manual HILANG permanen dari daftar" "V == 0" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FM119" '[.[]|select(.faktur_id==$f)]|length')"
cek "hapus faktur yang sudah tak ada → 404" "V == 404" \
  "$(status_code "$OWNER" DELETE "/perlengkapan/beli/faktur/$FM119")"
# (b) faktur DARI PERMINTAAN AKTIF (rencana punya produksi hidup) → tak boleh Hapus
R119=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$PBA_ID\",\"porsi\":120}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq -r '.rencana_id // ""')
# item perlengkapan baru yang PASTI kurang (min 5, saldo 0) → jamin faktur BP terbit
api "$OWNER" POST /perlengkapan '{"nama":"Spons Hapus 119","satuan":"pcs","stok_minimum":5}' > /dev/null
FP119=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$CB46_ID&rencana_id=$R119" '{}' | jq -r '.beli_faktur.faktur_id // ""')
cek "dasar uji: faktur BP tertaut permintaan terbit" "V == 1" \
  "$([ -n "$FP119" ] && echo 1 || echo 0)"
cek "faktur permintaan aktif: permintaan_aktif=true" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FP119" '[.[]|select(.faktur_id==$f)][0].permintaan_aktif==true | if . then 1 else 0 end')"
cek "hapus faktur dari permintaan aktif → 400 (kelola dari Permintaan Stok)" "V == 400" \
  "$(status_code "$OWNER" DELETE "/perlengkapan/beli/faktur/$FP119")"
cek "faktur permintaan aktif TETAP ada (tak terhapus)" "V == 1" \
  "$(api "$OWNER" GET /perlengkapan/beli | jq --arg f "$FP119" '[.[]|select(.faktur_id==$f)]|length>=1 | if . then 1 else 0 end')"
# (c) faktur yang sudah 'tiba' (masuk stok CK) → tak boleh Hapus
FT119=$(api "$OWNER" POST /perlengkapan/beli "{\"items\":[{\"supply_id\":\"$SBH119\",\"qty\":1}],\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq -r '.faktur_id // ""')
api "$OWNER" POST "/perlengkapan/beli/faktur/$FT119/tiba" '{}' > /dev/null
cek "hapus faktur yang sudah tiba (masuk stok) → 400" "V == 400" \
  "$(status_code "$OWNER" DELETE "/perlengkapan/beli/faktur/$FT119")"

echo "== 120. Detail Produk bahan + kartu FIFO (pemakaian dari lot paling awal) =="
# Detail Produk: DTO + metode HPP + saldo per cabang. Kartu FIFO: seluruh
# riwayat masuk/keluar di-walk kronologis — keluar mengonsumsi lot PALING AWAL;
# opname disetujui = reset (selisih turun dikonsumsi FIFO). Saldo akhir walk
# HARUS sama dengan saldo ledger (sumber peristiwa identik hitungSaldoCabang).
B120=$(api "$OWNER" POST /bahan '{"nama":"gula fifo uji120","harga_beli":1500,"isi":1,"satuan":"pcs","kategori":"lain"}' | jq -r .id)
# lot 1: 10 pcs @1000 → auto-confirm di cabang; lot 2: 5 pcs @2000
FL120=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$B120\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":10000}]}" | jq -r '.faktur_id')
api "$OWNER" POST "/pembelian/tahap/$FL120" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FL120" '{"ke":"menunggu"}' > /dev/null
sleep 1  # jamin urutan waktu lot 1 < lot 2
FL120B=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$B120\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":10000}]}" | jq -r '.faktur_id')
api "$OWNER" POST "/pembelian/tahap/$FL120B" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FL120B" '{"ke":"menunggu"}' > /dev/null
# (a) Detail Produk
D120=$(api "$OWNER" GET "/bahan/$B120/detail")
cek "detail: total_saldo 15 + metode HPP ada" "V == 1" \
  "$(echo "$D120" | jq '(.total_saldo==15) and (.metode_hpp=="average" or .metode_hpp=="fifo") | if . then 1 else 0 end')"
cek "detail: saldo_cabang memuat cabang uji = 15" "V == 15" \
  "$(echo "$D120" | jq --arg b "$CB46_ID" '[.saldo_cabang[]|select(.branch_id==$b)][0].saldo')"
cek "detail bahan asing → 404" "V == 404" \
  "$(status_code "$OWNER" GET "/bahan/00000000-0000-0000-0000-000000000000/detail")"
# (b) FIFO sebelum pemakaian: 2 lot urut paling awal, harga per satuan benar
FF120=$(api "$OWNER" GET "/stok/fifo/$B120?branch_id=$CB46_ID")
cek "fifo: 2 lot urut paling awal (1000 lalu 2000)" "V == 1" \
  "$(echo "$FF120" | jq '(.lots|length==2) and (.lots[0].harga_satuan==1000) and (.lots[1].harga_satuan==2000) | if . then 1 else 0 end')"
cek "fifo: saldo awal walk = 15 (== ledger)" "V == 15" "$(echo "$FF120" | jq '.saldo')"
# (c) waste 12 + ACC → konsumsi FIFO: lot1 habis (10), lot2 terpakai 2 sisa 3
W120=$(api "$OWNER" POST /stok/waste "{\"branch_id\":\"$CB46_ID\",\"ingredient_id\":\"$B120\",\"qty\":12,\"foto_url\":\"/uploads/bukti-uji.jpg\",\"catatan\":\"uji fifo 120\"}")
api "$OWNER" POST "/stok/opname/sesi/$(echo "$W120" | jq -r '.session_id')/acc" > /dev/null
# biaya di kartu mengikuti setelan Metode HPP → seksi ini menguji kedua mode
api "$OWNER" PATCH /company '{"metode_hpp":"fifo"}' > /dev/null
FF120B=$(api "$OWNER" GET "/stok/fifo/$B120?branch_id=$CB46_ID")
cek "fifo: lot PALING AWAL habis duluan (terpakai 10, sisa 0)" "V == 1" \
  "$(echo "$FF120B" | jq '(.lots[0].terpakai==10) and (.lots[0].sisa==0) | if . then 1 else 0 end')"
cek "fifo: lot kedua terpakai 2, sisa 3" "V == 1" \
  "$(echo "$FF120B" | jq '(.lots[1].terpakai==2) and (.lots[1].sisa==3) | if . then 1 else 0 end')"
cek "fifo: pemakaian opname 12 ber-HPP 14000 (10×1000 + 2×2000)" "V == 1" \
  "$(echo "$FF120B" | jq '[.pemakaian[]|select(.jenis=="opname")][0] | (.qty==12) and (.hpp==14000) and (.harga_rata==null) and (.rincian|length==2) | if . then 1 else 0 end')"
SLDG120=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$B120" '[.[]|select(.ingredient_id==$i)][0].saldo')
cek "fifo: saldo walk == saldo ledger (3)" "V == 1" \
  "$(echo "$FF120B" | jq --argjson s "$SLDG120" '(.saldo==3) and (.saldo==$s) | if . then 1 else 0 end')"
cek "fifo bahan asing → 404" "V == 404" \
  "$(status_code "$OWNER" GET "/stok/fifo/00000000-0000-0000-0000-000000000000?branch_id=$CB46_ID")"
# (c2) METODE AVERAGE: aliran barang tetap FIFO, hanya BIAYA-nya yang berubah.
# Setelan Metode HPP dulu tersimpan tapi tak pernah dibaca — kartu selalu FIFO.
api "$OWNER" PATCH /company '{"metode_hpp":"average"}' > /dev/null
FF120C=$(api "$OWNER" GET "/stok/fifo/$B120?branch_id=$CB46_ID")
cek "average: DTO melaporkan metode yang dipakai" "V == 1" \
  "$(echo "$FF120C" | jq '(.metode_hpp=="average")|if . then 1 else 0 end')"
cek "average: aliran fisik & saldo TIDAK berubah (lot1 habis, lot2 sisa 3)" "V == 1" \
  "$(echo "$FF120C" | jq '(.lots[0].terpakai==10) and (.lots[0].sisa==0) and (.lots[1].sisa==3) and (.saldo==3) | if . then 1 else 0 end')"
# rata bergerak saat 12 keluar = (10×1000 + 5×2000) ÷ 15 = 1333.33 → 12 × 1333.33
cek "average: harga_rata 1333.33 & biaya ≠ 14000 (bukan lagi FIFO)" "V == 1" \
  "$(echo "$FF120C" | jq '[.pemakaian[]|select(.jenis=="opname")][0] | (.harga_rata==1333.33) and (.hpp!=14000) and ((.hpp-15999.96) < 0.01) and ((.hpp-15999.96) > -0.01) | if . then 1 else 0 end')"
cek "average: rincian lot tetap dilaporkan (untuk lacak kedaluwarsa)" "V == 2" \
  "$(echo "$FF120C" | jq '[.pemakaian[]|select(.jenis=="opname")][0].rincian|length')"
# (d) hapus dari Detail Produk (soft delete) → hilang dari daftar
cek "hapus bahan dari detail → ok" "V == 1" \
  "$(api "$OWNER" DELETE "/bahan/$B120" | jq '(.ok==true)|if . then 1 else 0 end')"
cek "bahan terhapus → detail 404" "V == 404" \
  "$(status_code "$OWNER" GET "/bahan/$B120/detail")"

echo "== 121. Statistik riwayat harga (terendah/tertinggi/median) + median jadi acuan =="
# bahan: 3 lot beli dikonfirmasi 1000 / 3000 / 2000 per pcs (urut sengaja acak)
B121=$(api "$OWNER" POST /bahan '{"nama":"Bahan Median Uji 121","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","track_stok":true}' | jq -r .id)
beli121() { # $1=jumlah $2=total_harga → faktur beli dikonfirmasi (CK sendiri), echo faktur_id
  local F
  F=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$B121\",\"mode\":\"pcs\",\"jumlah\":$1,\"total_harga\":$2}]}" | jq -r .faktur_id)
  api "$OWNER" POST "/pembelian/tahap/$F" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$F" '{"ke":"menunggu"}' > /dev/null
  echo "$F"
}
beli121 10 10000 > /dev/null   # 1000/pcs
beli121 10 30000 > /dev/null   # 3000/pcs
F121C=$(beli121 10 20000)      # 2000/pcs
RH121=$(api "$OWNER" GET "/bahan/$B121/pembelian")
cek "stat bahan: harga_terendah 1000 + tanggalnya terisi" "V == 1" \
  "$(echo "$RH121" | jq '(.harga_terendah.harga==1000) and (.harga_terendah.tanggal!=null) | if . then 1 else 0 end')"
cek "stat bahan: harga_tertinggi 3000 + tanggalnya terisi" "V == 1" \
  "$(echo "$RH121" | jq '(.harga_tertinggi.harga==3000) and (.harga_tertinggi.tanggal!=null) | if . then 1 else 0 end')"
cek "stat bahan: harga_median 2000 (ganjil → nilai tengah)" "V == 1" \
  "$(echo "$RH121" | jq '(.harga_median==2000) | if . then 1 else 0 end')"
# Laporan Harga lot ke-3 jadi 50000 (5000/pcs) → acuan disegarkan ke MEDIAN
# riwayat (1000,3000,5000 → 3000), BUKAN harga terakhir yang dilaporkan (5000)
ROW121C=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$F121C" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/laporan-harga/$F121C" "{\"items\":[{\"id\":\"$ROW121C\",\"total_harga\":50000}]}" > /dev/null
cek "laporan harga: acuan = median 3000 (bukan 5000 harga terakhir)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$B121" '([.[]|select(.id==$id)][0].harga_beli|round)==3000|if . then 1 else 0 end')"
cek "stat bahan: harga_terkini ikut median (3000)" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$B121/pembelian" | jq '((.harga_terkini|round)==3000) and (.harga_median==3000) | if . then 1 else 0 end')"
# lot ke-4 7000/pcs → median genap (3000+5000)/2 = 4000; acuan TIDAK berubah
# tanpa Laporan Harga (harga riil lot tetap tercatat utk HPP)
beli121 10 70000 > /dev/null
RH121D=$(api "$OWNER" GET "/bahan/$B121/pembelian")
cek "stat bahan: median genap 4000 (rata-rata dua tengah) + tertinggi 7000" "V == 1" \
  "$(echo "$RH121D" | jq '(.harga_median==4000) and (.harga_tertinggi.harga==7000) | if . then 1 else 0 end')"
cek "acuan tak berubah tanpa Laporan Harga (tetap 3000)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$B121" '([.[]|select(.id==$id)][0].harga_beli|round)==3000|if . then 1 else 0 end')"
# perlengkapan: statistik yang sama dari lot stok masuk
P121=$(api "$OWNER" POST /perlengkapan '{"nama":"Perlengkapan Median Uji 121","satuan":"pcs","harga_beli":500}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/$P121/masuk" '{"qty":10,"total_harga":10000}' > /dev/null
api "$OWNER" POST "/perlengkapan/$P121/masuk" '{"qty":10,"total_harga":30000}' > /dev/null
api "$OWNER" POST "/perlengkapan/$P121/masuk" '{"qty":10,"total_harga":20000}' > /dev/null
RHP121=$(api "$OWNER" GET "/perlengkapan/$P121/pembelian")
cek "stat perlengkapan: terendah 1000 / tertinggi 3000 / median 2000" "V == 1" \
  "$(echo "$RHP121" | jq '(.harga_terendah.harga==1000) and (.harga_tertinggi.harga==3000) and (.harga_median==2000) | if . then 1 else 0 end')"

echo "== 122. Faktur produksi tanpa pelaksana → pelaksana otomatis saat Mulai Kerjakan =="
B122=$(api "$OWNER" POST /bahan '{"nama":"Bahan Produksi Uji 122","harga_beli":0,"isi":10,"satuan":"pcs","pengadaan":"produksi","track_stok":true}' | jq -r .id)
# tanpa worker_id & supplier_id → BOLEH (dulu 400 "Pelaksana wajib")
F122=$(api "$OWNER" POST /produksi/faktur "{\"items\":[{\"ingredient_id\":\"$B122\",\"mode\":\"pcs\",\"jumlah\":10}]}")
F122_ID=$(echo "$F122" | jq -r .faktur_id)
cek "faktur produksi tanpa pelaksana → dibuat" "V == 1" \
  "$(echo "$F122" | jq '(.faktur_id!=null)|if . then 1 else 0 end')"
cek "sebelum dikerjakan: worker_id baris masih kosong" "V == 1" \
  "$(api "$OWNER" GET "/produksi?per_page=500" | jq --arg f "$F122_ID" '([.rows[]|select(.faktur_id==$f)][0].worker_id==null)|if . then 1 else 0 end')"
api "$OWNER" POST "/produksi/tahap/$F122_ID" '{"ke":"dikerjakan"}' > /dev/null
cek "Mulai Kerjakan: pelaksana terisi otomatis dari aktornya" "V == 1" \
  "$(api "$OWNER" GET "/produksi?per_page=500" | jq --arg f "$F122_ID" '[.rows[]|select(.faktur_id==$f)][0] | (.worker_id!=null) and (.dikerjakan_oleh!=null) | if . then 1 else 0 end')"
# rak simpan tak dipilih di form: rak default bahan (Tempat Penyimpanan) di
# cabang faktur otomatis terpasang saat SELESAI (jalur tahap non-items)
BR122=$(api "$OWNER" GET "/produksi?per_page=500" | jq -r --arg f "$F122_ID" '[.rows[]|select(.faktur_id==$f)][0].branch_id')
RK122=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$BR122\",\"nama\":\"Rak Produksi Uji 122\"}" | jq -r .id)
api "$OWNER" PUT "/penyimpanan/$RK122/bahan" "{\"ingredient_ids\":[\"$B122\"]}" > /dev/null
api "$OWNER" POST "/produksi/tahap/$F122_ID" '{"ke":"menunggu"}' > /dev/null
cek "selesai tanpa pilih tempat: rak default bahan terpasang otomatis" "V == 1" \
  "$(api "$OWNER" GET "/produksi?per_page=500" | jq --arg f "$F122_ID" --arg r "$RK122" '([.rows[]|select(.faktur_id==$f)][0].storage_location_id==$r)|if . then 1 else 0 end')"

echo "== 123. Faktur produksi → faktur beli otomatis (bahan kurang / di bawah stok minimum) =="
# bahan mentah A: kurang total (saldo 0, isi 500) → beli 1 kemasan
M123A=$(api "$OWNER" POST /bahan '{"nama":"mentah uji123a","harga_beli":10000,"isi":500,"satuan":"gr","pengadaan":"beli","track_stok":true}' | jq -r .id)
# bahan mentah B: CUKUP utk produksi tapi sisa bakal di bawah stok minimum 300
M123B=$(api "$OWNER" POST /bahan '{"nama":"mentah uji123b","harga_beli":2000,"isi":100,"satuan":"gr","pengadaan":"beli","track_stok":true,"stok_minimum":300}' | jq -r .id)
FB123=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$M123B\",\"mode\":\"pcs\",\"jumlah\":350,\"total_harga\":7000}]}" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FB123" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FB123" '{"ke":"menunggu"}' > /dev/null   # saldo M123B = 350
# produk ber-resep: 1 batch = 10 pcs, butuh 100 gr A + 40 gr B per batch
P123=$(api "$OWNER" POST /bahan '{"nama":"produk uji123","harga_beli":0,"isi":10,"satuan":"pcs","pengadaan":"produksi","track_stok":true}' | jq -r .id)
api "$OWNER" PUT "/bahan/$P123/resep" "{\"komponen\":[{\"ingredient_id\":\"$M123A\",\"qty\":100},{\"ingredient_id\":\"$M123B\",\"qty\":40}]}" > /dev/null
# 2 batch: A butuh 200 (saldo 0 → kurang 200 → 1 kemasan = 500 gr);
#          B butuh 80 (saldo 350, sisa 270 < min 300 → kurang 30 → 1 kemasan = 100 gr)
FP123=$(api "$OWNER" POST /produksi/faktur "{\"items\":[{\"ingredient_id\":\"$P123\",\"mode\":\"batch\",\"jumlah\":2}]}")
cek "produksi kurang bahan: faktur beli otomatis dibuat (2 baris)" "V == 1" \
  "$(echo "$FP123" | jq '(.beli_otomatis!=null) and (.beli_otomatis.jumlah_baris==2) and (.beli_otomatis.nomor!=null) | if . then 1 else 0 end')"
BO123=$(echo "$FP123" | jq -r .beli_otomatis.faktur_id)
ROWS123=$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$BO123" '[.rows[]|select(.faktur_id==$f)]')
cek "beli otomatis: mentah A dibulatkan per kemasan (500 gr, rencana)" "V == 1" \
  "$(echo "$ROWS123" | jq --arg i "$M123A" '([.[]|select(.ingredient_id==$i)][0] | (.qty==500) and (.status=="rencana")) | if . then 1 else 0 end')"
cek "beli otomatis: mentah B ikut dibeli krn bakal di bawah minimum (100 gr)" "V == 1" \
  "$(echo "$ROWS123" | jq --arg i "$M123B" '([.[]|select(.ingredient_id==$i)][0].qty==100) | if . then 1 else 0 end')"
# bahan cukup & tetap di atas minimum → TANPA faktur beli otomatis
P123B=$(api "$OWNER" POST /bahan '{"nama":"produk uji123b","harga_beli":0,"isi":10,"satuan":"pcs","pengadaan":"produksi","track_stok":true}' | jq -r .id)
api "$OWNER" PUT "/bahan/$P123B/resep" "{\"komponen\":[{\"ingredient_id\":\"$M123B\",\"qty\":1}]}" > /dev/null
FP123B=$(api "$OWNER" POST /produksi/faktur "{\"items\":[{\"ingredient_id\":\"$P123B\",\"mode\":\"batch\",\"jumlah\":1}]}")
cek "produksi bahan cukup di atas minimum → tanpa faktur beli otomatis" "V == 1" \
  "$(echo "$FP123B" | jq '(.beli_otomatis==null)|if . then 1 else 0 end')"

echo "== 124. Rencana menu: belanja bahan mentah ikut STOK MINIMUM =="
# produk resep 60 gr M123B per batch: saldo 350 cukup, tapi sisa (350-60=290)
# bakal di bawah minimum 300 → planner ikut merencanakan belanja (1 kemasan)
P124=$(api "$OWNER" POST /bahan '{"nama":"produk uji124","harga_beli":0,"isi":10,"satuan":"pcs","pengadaan":"produksi","track_stok":true}' | jq -r .id)
api "$OWNER" PUT "/bahan/$P124/resep" "{\"komponen\":[{\"ingredient_id\":\"$M123B\",\"qty\":60}]}" > /dev/null
CAT124=$(api "$OWNER" GET /menu | jq -r '.[0].category_id')
MN124=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji124\",\"category_id\":\"$CAT124\",\"tipe\":\"regular\",\"mult\":1,\"harga_jual\":10000,\"komponen\":[{\"ingredient_id\":\"$P124\",\"qty\":1}]}" | jq -r .id)
# lokasi hitung bahan mentah = CK pemasok cabang (bila terhubung) — siapkan
# saldo 350 DI SANA agar skenario "cukup tapi bakal di bawah minimum" terjadi
CKP124=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.nama=="Pusat")][0].central_kitchen_id')
if [ -n "$CKP124" ] && [ "$CKP124" != "null" ]; then
  FB124=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CKP124\",\"items\":[{\"ingredient_id\":\"$M123B\",\"mode\":\"pcs\",\"jumlah\":350,\"total_harga\":7000}]}" | jq -r .faktur_id)
  api "$OWNER" POST "/pembelian/tahap/$FB124" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$FB124" '{"ke":"menunggu"}' > /dev/null
fi
PRV124=$(api "$OWNER" POST /rekomendasi/menu "{\"items\":[{\"menu_id\":\"$MN124\",\"porsi\":10}]}")
cek "planner: bahan mentah cukup tapi bakal di bawah minimum → ikut belanja" "V == 1" \
  "$(echo "$PRV124" | jq --arg i "$M123B" '([.bahan_produksi[]|select(.ingredient_id==$i)][0] | (.kurang>0) and (.qty_faktur==100)) | if . then 1 else 0 end')"
# harga per isi/kemasan: item riwayat bawa isi + satuan_beli (mis. 1 kg = 1000 gram)
B121K=$(api "$OWNER" POST /bahan '{"nama":"Bahan Isi Uji 121","harga_beli":28000,"isi":1000,"satuan":"gram","satuan_beli":"kg","pengadaan":"beli","track_stok":true}' | jq -r .id)
cek "riwayat harga bahan: item bawa isi 1000 + satuan_beli kg (harga per isi 28000)" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$B121K/pembelian" | jq '(.item.isi==1000) and (.item.satuan_beli=="kg") and ((.harga_terkini*1000|round)==28000) | if . then 1 else 0 end')"
cek "riwayat harga perlengkapan: item.isi 1 tanpa satuan_beli (tak berkemasan)" "V == 1" \
  "$(echo "$RHP121" | jq '(.item.isi==1) and (.item.satuan_beli==null) | if . then 1 else 0 end')"

echo "== 125. Arsipkan resep (nonaktifkan bahan produksi) + tab Arsip + pulihkan =="
P125=$(api "$OWNER" POST /bahan '{"nama":"produk arsip uji125","harga_beli":0,"isi":10,"satuan":"pcs","pengadaan":"produksi","track_stok":true}' | jq -r .id)
api "$OWNER" PUT "/bahan/$P125/resep" "{\"komponen\":[{\"ingredient_id\":\"$M123B\",\"qty\":5}]}" > /dev/null
cek "sebelum arsip: tampil di daftar bahan aktif" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$P125" '[.[]|select(.id==$i)]|length')"
cek "sebelum arsip: punya resep di resep-ringkas" "V == 1" \
  "$(api "$OWNER" GET /bahan/resep-ringkas | jq --arg i "$P125" 'has($i)|if . then 1 else 0 end')"
cek "arsipkan resep (DELETE bahan) → ok" "V == 1" \
  "$(api "$OWNER" DELETE "/bahan/$P125" | jq '.ok==true|if . then 1 else 0 end')"
cek "setelah arsip: hilang dari daftar bahan aktif" "V == 0" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$P125" '[.[]|select(.id==$i)]|length')"
cek "setelah arsip: hilang dari resep-ringkas" "V == 0" \
  "$(api "$OWNER" GET /bahan/resep-ringkas | jq --arg i "$P125" 'has($i)|if . then 1 else 0 end')"
cek "tab arsip (?arsip=1): memuat resep terarsip, is_active=false" "V == 1" \
  "$(api "$OWNER" GET "/bahan?arsip=1" | jq --arg i "$P125" '[.[]|select(.id==$i and .is_active==false)]|length')"
# token $KASIR sudah 401 sejak §105 (token_version) — pakai kitchen (§107)
cek "tab arsip hanya owner/admin: kitchen → 403" "V == 403" \
  "$(status_code "$TKIT" GET "/bahan?arsip=1")"
cek "guard: arsipkan resep yang dipakai menu aktif → 409" "V == 409" \
  "$(status_code "$OWNER" DELETE "/bahan/$P124")"
cek "pulihkan dari arsip → ok" "V == 1" \
  "$(api "$OWNER" POST "/bahan/$P125/pulihkan" '{}' | jq '.ok==true|if . then 1 else 0 end')"
cek "setelah pulih: kembali di daftar aktif + resep lama utuh" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$P125/resep" | jq --arg i "$M123B" '[.[]|select(.ingredient_id==$i and .qty==5)]|length')"
cek "pulihkan bahan yang tidak terarsip → 404" "V == 404" \
  "$(status_code_body "$OWNER" POST "/bahan/$P125/pulihkan" '{}')"

echo "== 126. Kategori supplier (kolom kategori + filter di halaman Supplier) =="
S126=$(api "$OWNER" POST /supplier '{"nama":"Supplier Kategori Uji126","kategori":"sayur"}' | jq -r .id)
cek "buat supplier dgn kategori → tersimpan di daftar" "V == 1" \
  "$(api "$OWNER" GET /supplier | jq --arg i "$S126" '[.[]|select(.id==$i and .kategori=="sayur")]|length')"
cek "ubah kategori supplier (PATCH)" "V == 1" \
  "$(api "$OWNER" PATCH "/supplier/$S126" '{"kategori":"kemasan"}' | jq '(.kategori=="kemasan")|if . then 1 else 0 end')"
cek "kosongkan kategori (null) → tanpa kategori" "V == 1" \
  "$(api "$OWNER" PATCH "/supplier/$S126" '{"kategori":null}' | jq '(.kategori==null)|if . then 1 else 0 end')"

echo "== 127. Pencadangan database (super admin) =="
cek "guard: owner GET /admin/sistem/backup → 403" "V == 403" \
  "$(status_code "$OWNER" GET /admin/sistem/backup)"

# PEMERIKSAAN SETELAN. Semua yang diperiksa berbentuk sama: setelannya SAH,
# servernya menyala tanpa keluhan, dan salahnya baru ketahuan berbulan-bulan
# kemudian. Hasilnya dipulangkan di sini karena log boot dibaca sekali saja.
SIS127=$(api "$SA" GET /admin/sistem)
cek "pemeriksaan setelan: berupa daftar & tiap temuan lengkap" "V == 1" \
  "$(echo "$SIS127" | jq '(.pemeriksaan|type=="array") and (.pemeriksaan|all((.kode|length)>0 and (.judul|length)>0 and (.rincian|length)>0 and (.tindakan|length)>0 and (.tingkat=="kritis" or .tingkat=="peringatan"))) | if . then 1 else 0 end')"
# DB segar ini di-seed dengan SEED_SUPERADMIN_PASSWORD bawaan, jadi temuannya
# HARUS ada. Ini yang membuktikan pemeriksanya benar-benar membandingkan hash
# di database, bukan sekadar memulangkan daftar kosong.
cek "pemeriksaan: password super admin bawaan terdeteksi" "V == 1" \
  "$(echo "$SIS127" | jq '[.pemeriksaan[]|select(.kode=="superadmin_password_bawaan" and .tingkat=="kritis")]|length')"
# ...dan sebaliknya: CI MEMASANG JWT_SECRET, jadi temuan itu tak boleh muncul.
# Pemeriksa yang tak pernah diam akan diabaikan, dan sesudah itu ia tak menjaga
# apa pun — termasuk saat temuannya benar.
cek "pemeriksaan: DIAM untuk yang memang sudah benar (JWT_SECRET)" "V == 0" \
  "$(echo "$SIS127" | jq '[.pemeriksaan[]|select(.kode=="jwt_bawaan")]|length')"
# Backup manual: bila kebetulan bertepatan dgn cadangan otomatis penjadwal
# (advisory lock → 409), ulangi beberapa kali.
BKP=""
for _ in 1 2 3 4 5; do
  BKP=$(api "$SA" POST /admin/sistem/backup '{}')
  if [ "$(echo "$BKP" | jq -r '.status // empty')" = "sukses" ]; then break; fi
  sleep 2
done
cek "backup manual → sukses, tabel>0 & baris>0" "V == 1" \
  "$(echo "$BKP" | jq '(.status=="sukses") and (.jumlah_tabel>0) and (.jumlah_baris>0) and (.bisa_unduh==true) | if . then 1 else 0 end')"
BK_ID=$(echo "$BKP" | jq -r .id)
STAT=$(api "$SA" GET /admin/sistem/backup)
cek "status backup: aktif + riwayat memuat run tadi" "V == 1" \
  "$(echo "$STAT" | jq --arg i "$BK_ID" '(.aktif==true) and ([.riwayat[]|select(.id==$i)]|length==1) and (.terakhir_sukses!=null) | if . then 1 else 0 end')"
# Jadwal harian pada jam LOKAL tenant (bawaan 02:00), bukan "tiap N jam sejak
# boot" — cadangan harus jatuh saat outlet tutup, bukan mengikuti jam deploy.
cek "status backup: jadwal harian jam 02 waktu tenant" "V == 1" \
  "$(echo "$STAT" | jq '(.jam_lokal==2) and ((.zona_waktu|length)>0) and (.berikutnya!=null) | if . then 1 else 0 end')"
cek "status backup: jadwal berikutnya di masa depan & < 24 jam lagi" "V == 1" \
  "$(echo "$STAT" | jq --argjson now "$(date +%s)" '((.berikutnya|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601) as $b | ($b > $now) and ($b - $now < 86400)) | if . then 1 else 0 end')"
# PERINGATAN CADANGAN. Panel sudah lama memerah saat cadangan basi, tapi kartu
# merah cuma bekerja pada orang yang MEMBUKA halamannya — dan halaman cadangan
# adalah halaman yang dibuka orang ketika ia sudah butuh cadangannya. Sekarang
# ada penjaga yang mengirim email; blok ini memastikan ambang yang dipakai panel
# datang DARI SERVER, satu sumber dengan yang dipakai penjaga itu.
cek "status backup: blok peringatan lengkap & ambangnya dari server" "V == 1" \
  "$(echo "$STAT" | jq '(.peringatan|type=="object") and (.peringatan.ambang_hari>=1) and (.peringatan.sejak!=null) and (.peringatan|has("umur_jam")) and (.peringatan|has("email_siap")) | if . then 1 else 0 end')"
# Baru saja dicadangkan → belum boleh gawat, dan tak boleh ada penanda kirim.
cek "peringatan: cadangan segar → tidak gawat, tanpa email terkirim" "V == 1" \
  "$(echo "$STAT" | jq '(.peringatan.gawat==false) and (.peringatan.umur_jam!=null) and (.peringatan.umur_jam<2) and (.peringatan.terakhir_dikirim==null) | if . then 1 else 0 end')"
# Kesiapan SALURAN dilaporkan apa adanya. Peringatan yang tak punya jalan keluar
# bukan peringatan — dan itu satu-satunya keadaan yang tak bisa diketahui dari
# peringatan itu sendiri. Di CI belum ada SMTP, jadi email_siap=false; yang
# diperiksa: super admin-nya terhitung sebagai penerima.
cek "peringatan: super admin terhitung sebagai penerima" "V == 1" \
  "$(echo "$STAT" | jq '.peringatan.penerima>=1 | if . then 1 else 0 end')"
BK_TMP=$(mktemp /tmp/kakarut-bk.XXXXXX.gz)
curl -s -H "Authorization: Bearer $SA" "$BASE/api/admin/sistem/backup/$BK_ID/unduh" -o "$BK_TMP"
cek "unduh cadangan = gzip valid (magic 1f8b)" "V == 1" \
  "$(python3 -c "print(1 if open('$BK_TMP','rb').read(2)==b'\x1f\x8b' else 0)")"
cek "isi arsip memuat tabel companies" "V == 1" \
  "$(python3 -c "import gzip;print(1 if b'\"tabel\":\"companies\"' in gzip.decompress(open('$BK_TMP','rb').read()) else 0)")"
rm -f "$BK_TMP"
cek "hapus cadangan → ok" "V == 1" \
  "$(api "$SA" DELETE "/admin/sistem/backup/$BK_ID" | jq '.ok==true|if . then 1 else 0 end')"
cek "setelah hapus: hilang dari riwayat" "V == 0" \
  "$(api "$SA" GET /admin/sistem/backup | jq --arg i "$BK_ID" '[.riwayat[]|select(.id==$i)]|length')"

echo "== 128. Petugas rak BASI (bukan anggota aktif) diabaikan pembatasan opname =="
# Latar: penugasan petugas bisa menunjuk akun yang kemudian diarsip/dihapus/
# dibuat ulang. Dulu rak jadi TERKUNCI diam-diam utk semua orang. Kini petugas
# non-aktif ditandai aktif=false & diabaikan dalam pembatasan.
RAK128=$(api "$OWNER" GET "/penyimpanan" | jq -r '[.[] | select(.nama == "Rak Uji")][0].id')
KBR128=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role == "cashier")][0].branch_id')
T128A=$(api "$OWNER" POST /karyawan "{\"nama\":\"Petugas Uji128A\",\"email\":\"petugas128a@example.com\",\"password\":\"Petugas128!\",\"role\":\"tim\",\"branch_id\":\"$KBR128\"}" | jq -r .user_id)
api "$OWNER" POST /karyawan "{\"nama\":\"Petugas Uji128B\",\"email\":\"petugas128b@example.com\",\"password\":\"Petugas128!\",\"role\":\"tim\",\"branch_id\":\"$KBR128\"}" > /dev/null
T128B_TOK=$(login "petugas128b@example.com" "Petugas128!")
api "$OWNER" PUT "/penyimpanan/$RAK128/petugas" "{\"user_ids\":[\"$T128A\"]}" > /dev/null
cek "petugas baru bertanda aktif=true" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq --arg id "$RAK128" '[.[]|select(.id==$id)][0].petugas | (length==1 and .[0].aktif==true) | if . then 1 else 0 end')"
cek "tim BUKAN petugas → opname bahan rak itu 403" "V == 403" \
  "$(status_code_body "$T128B_TOK" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":480}]}")"
# arsipkan petugas satu-satunya → penugasan BASI: rak tak boleh terkunci diam-diam
api "$OWNER" PATCH "/karyawan/$T128A" '{"arsip":true}' > /dev/null
cek "petugas terarsip bertanda aktif=false" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq --arg id "$RAK128" '[.[]|select(.id==$id)][0].petugas[0].aktif==false | if . then 1 else 0 end')"
SID128=$(api "$T128B_TOK" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$PLASTIK_ID\",\"qty\":480}]}" | jq -r '.session_id // empty')
{ [ -n "$SID128" ]; } && ok "petugas basi diabaikan → tim lain boleh opname lagi" \
  || gagal "tim lain seharusnya boleh opname (petugas basi diabaikan)"
api "$OWNER" PUT "/penyimpanan/$RAK128/petugas" '{"user_ids":[]}' > /dev/null

echo "== 129. Role Bar: divisi produksi kedua di cabang store =="
# Bar = kembaran kitchen utk divisi minuman: terikat cabang store, produksi
# lokal (hasil masuk stok cabangnya), TANPA /pembelian. Resep produksi cabang
# kini punya divisi (kitchen|bar): kitchen hanya boleh memproduksi resep
# divisi kitchen, bar hanya divisi bar — ditegakkan server saat buat faktur.
# (a) Guard penempatan — sama seperti kitchen (wajib cabang bertipe store).
cek "buat bar tanpa cabang → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /karyawan '{"nama":"B129","email":"bar129@basooopa.id","password":"BarUji129!","role":"bar"}')"
cek "buat bar di Central Kitchen → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /karyawan "{\"nama\":\"B129\",\"email\":\"bar129@basooopa.id\",\"password\":\"BarUji129!\",\"role\":\"bar\",\"branch_id\":\"$CK52_UTAMA\"}")"
cek "buat bar di Kantor → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /karyawan "{\"nama\":\"B129\",\"email\":\"bar129@basooopa.id\",\"password\":\"BarUji129!\",\"role\":\"bar\",\"branch_id\":\"$KANTOR107_ID\"}")"
api "$OWNER" POST /karyawan "{\"nama\":\"Bar 129\",\"email\":\"bar129@basooopa.id\",\"password\":\"BarUji129!\",\"role\":\"bar\",\"branch_id\":\"$CB46_ID\"}" > /dev/null
TBAR=$(login bar129@basooopa.id 'BarUji129!')
UBAR_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.email=="bar129@basooopa.id")][0].user_id')
cek "login bar: role bar + terkunci cabang store" "V == 1" \
  "$(api "$TBAR" GET /auth/me | jq --arg b "$CB46_ID" '((.user.role=="bar") and (.user.branch_id==$b))|if . then 1 else 0 end')"
# (b) Gerbang menu: produksi terbuka; pembelian & manajemen tertutup.
cek "bar GET /produksi → 200" "V == 200" "$(status_code "$TBAR" GET /produksi)"
cek "bar GET /pembelian → 403 (tanpa Beli)" "V == 403" "$(status_code "$TBAR" GET /pembelian)"
cek "bar GET /stok → 200" "V == 200" "$(status_code "$TBAR" GET /stok)"
cek "bar GET /karyawan → 403" "V == 403" "$(status_code "$TBAR" GET /karyawan)"
# (c) Divisi resep: default kitchen; owner pindahkan ke bar via PUT /bahan.
BB129=$(api "$OWNER" POST /bahan '{"nama":"sirup uji129","harga_beli":10000,"isi":10,"satuan":"botol","pengadaan":"produksi","kategori":"baso","produksi_di":"cabang"}' | jq -r .id)
BK129=$(api "$OWNER" POST /bahan '{"nama":"sambal uji129","harga_beli":10000,"isi":10,"satuan":"toples","pengadaan":"produksi","kategori":"baso","produksi_di":"cabang"}' | jq -r .id)
cek "bahan produksi baru: default divisi_produksi=kitchen" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg i "$BB129" '[.[]|select(.id==$i)][0].divisi_produksi=="kitchen"|if . then 1 else 0 end')"
cek "owner set divisi_produksi=bar via PUT /bahan" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$BB129" '{"divisi_produksi":"bar"}' | jq '.divisi_produksi=="bar"|if . then 1 else 0 end')"
# (d) Penegakan divisi saat buat faktur produksi di cabang.
cek "kitchen produksi resep divisi bar → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /produksi/faktur "{\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$BB129\",\"mode\":\"pcs\",\"jumlah\":4}]}")"
cek "bar produksi resep divisi kitchen → 400" "V == 400" \
  "$(status_code_body "$TBAR" POST /produksi/faktur "{\"worker_id\":\"$UBAR_ID\",\"items\":[{\"ingredient_id\":\"$BK129\",\"mode\":\"pcs\",\"jumlah\":4}]}")"
# (e) Bar memproduksi resep divisinya: faktur lokal, selesai → stok cabang naik.
FK129=$(api "$TBAR" POST /produksi/faktur "{\"worker_id\":\"$UBAR_ID\",\"items\":[{\"ingredient_id\":\"$BB129\",\"mode\":\"pcs\",\"jumlah\":4}]}" | jq -r .faktur_id)
cek "bar buat faktur produksi divisi bar → faktur_id terbit" "V == 1" \
  "$([ -n "$FK129" ] && [ "$FK129" != "null" ] && echo 1 || echo 0)"
S129_A=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BB129" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
api "$TBAR" POST "/produksi/tahap/$FK129" '{"ke":"dikerjakan","paksa":true}' > /dev/null
api "$TBAR" POST "/produksi/tahap/$FK129" '{"ke":"menunggu"}' > /dev/null
cek "faktur bar otomatis dikonfirmasi (produksi lokal)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FK129" '([.rows[]|select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="dikonfirmasi")) | if . then 1 else 0 end')"
S129_B=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BB129" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
cek "hasil produksi bar masuk stok cabang store (+4)" "abs(V - 4) < 0.001" \
  "$(python3 -c "print($S129_B - $S129_A)")"
# (f) Bar tak boleh mengirim hasil lintas cabang (produksi lokal saja).
FK129B=$(api "$TBAR" POST /produksi/faktur "{\"worker_id\":\"$UBAR_ID\",\"items\":[{\"ingredient_id\":\"$BB129\",\"mode\":\"pcs\",\"jumlah\":4}]}" | jq -r .faktur_id)
api "$TBAR" POST "/produksi/tahap/$FK129B" '{"ke":"dikerjakan","paksa":true}' > /dev/null
RID129=$(api "$TBAR" GET "/produksi?per_page=500" | jq -r --arg f "$FK129B" '[.rows[]|select(.faktur_id==$f)][0].id')
cek "bar kirim lintas cabang (tujuan_branch_id) → 403" "V == 403" \
  "$(status_code_body "$TBAR" POST "/produksi/tahap/$FK129B" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$RID129\",\"qty\":4}],\"tujuan_branch_id\":\"$ST52_ID\"}")"
# (g) Planner memisahkan faktur produksi cabang per divisi — dua faktur bila
#     kebutuhan mencakup resep kitchen DAN bar (diuji tak langsung: PUT divisi
#     kembali ke kitchen → bar ditolak lagi; simetri penegakan).
cek "divisi kembali ke kitchen → bar ditolak 400 (simetri)" "V == 400" \
  "$(api "$OWNER" PUT "/bahan/$BB129" '{"divisi_produksi":"kitchen"}' > /dev/null; status_code_body "$TBAR" POST /produksi/faktur "{\"worker_id\":\"$UBAR_ID\",\"items\":[{\"ingredient_id\":\"$BB129\",\"mode\":\"pcs\",\"jumlah\":4}]}")"
api "$OWNER" PUT "/bahan/$BB129" '{"divisi_produksi":"bar"}' > /dev/null

echo "== 130. Daftar produksi per divisi + badge divisi utk manajemen =="
# Bar tidak melihat faktur produksi resep divisi kitchen (dan sebaliknya) di
# GET /produksi — daftar & badge nav hanya pekerjaan divisinya. Owner tetap
# melihat semua, kini dengan divisi_produksi per baris (badge Kitchen/Bar).
# Konteks §129: BB129 (sirup, divisi bar) sudah punya faktur bar FK129;
# buat faktur kitchen utk BK129 (divisi kitchen) sebagai pembanding.
FK130=$(api "$TKIT" POST /produksi/faktur "{\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$BK129\",\"mode\":\"pcs\",\"jumlah\":3}]}" | jq -r .faktur_id)
cek "dasar uji: kitchen buat faktur divisi kitchen" "V == 1" \
  "$([ -n "$FK130" ] && [ "$FK130" != "null" ] && echo 1 || echo 0)"
cek "owner: baris faktur membawa divisi_produksi" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$FK130" '[.rows[]|select(.faktur_id==$f)][0].divisi_produksi=="kitchen"|if . then 1 else 0 end')"
cek "owner: melihat faktur kitchen DAN bar sekaligus" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg a "$FK130" --arg b "$FK129" '(([.rows[]|select(.faktur_id==$a)]|length) > 0 and ([.rows[]|select(.faktur_id==$b)]|length) > 0)|if . then 1 else 0 end')"
cek "bar: faktur divisi kitchen TIDAK tampil" "V == 0" \
  "$(api "$TBAR" GET "/produksi?per_page=500" | jq --arg f "$FK130" '[.rows[]|select(.faktur_id==$f)]|length')"
cek "bar: faktur divisinya sendiri tetap tampil" "V == 1" \
  "$(api "$TBAR" GET "/produksi?per_page=500" | jq --arg f "$FK129" '[.rows[]|select(.faktur_id==$f)]|length > 0|if . then 1 else 0 end')"
cek "kitchen: faktur divisi bar TIDAK tampil" "V == 0" \
  "$(api "$TKIT" GET "/produksi?per_page=500" | jq --arg f "$FK129" '[.rows[]|select(.faktur_id==$f)]|length')"
cek "kitchen: faktur divisinya sendiri tetap tampil" "V == 1" \
  "$(api "$TKIT" GET "/produksi?per_page=500" | jq --arg f "$FK130" '[.rows[]|select(.faktur_id==$f)]|length > 0|if . then 1 else 0 end')"

echo "== 131. Cara masak resep: langkah berfoto + foto hasil/packing + akses staf =="
# Resep produksi kini punya CARA MASAK: langkah berurutan (teks + foto proses
# opsional) di tabel ingredient_steps, plus foto bahan jadi & foto packing di
# master bahan. Tulis: owner/admin (replace-whole-list, urutan array = urutan
# langkah). Baca: semua pelaksana produksi (kitchen/bar/tim), lintas divisi.
cek "owner PUT 2 langkah → daftar kembali (length 2)" "V == 2" \
  "$(api "$OWNER" PUT "/bahan/$BB129/langkah" '{"langkah":[{"teks":"Rebus air sampai mendidih"},{"teks":"Tuang sirup lalu aduk","foto_url":"/uploads/companies/x/resep/uji131.jpg"}]}' | jq length)"
cek "GET langkah: urut sesuai kiriman + foto terbawa" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$BB129/langkah" | jq '(.[0].teks=="Rebus air sampai mendidih" and .[1].foto_url=="/uploads/companies/x/resep/uji131.jpg")|if . then 1 else 0 end')"
cek "bar baca langkah → 200" "V == 200" "$(status_code "$TBAR" GET "/bahan/$BB129/langkah")"
cek "kitchen baca langkah divisi bar → 200 (baca lintas divisi boleh)" "V == 200" \
  "$(status_code "$TKIT" GET "/bahan/$BB129/langkah")"
cek "kitchen PUT langkah → 403" "V == 403" \
  "$(status_code_body "$TKIT" PUT "/bahan/$BB129/langkah" '{"langkah":[]}')"
cek "PUT urutan dibalik → replace total (langkah pertama berganti)" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$BB129/langkah" '{"langkah":[{"teks":"Tuang sirup lalu aduk"},{"teks":"Rebus air sampai mendidih"}]}' | jq '.[0].teks=="Tuang sirup lalu aduk"|if . then 1 else 0 end')"
cek "PUT 1 langkah → sisa 1 (bukan digabung)" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$BB129/langkah" '{"langkah":[{"teks":"Campur semua lalu simpan dingin"}]}' | jq length)"
cek "PUT langkah bahan jalur beli → 400" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/bahan/$PLASTIK_ID/langkah" '{"langkah":[{"teks":"x"}]}')"
cek "PUT langkah id asing → 404" "V == 404" \
  "$(status_code_body "$OWNER" PUT "/bahan/00000000-0000-0000-0000-000000000000/langkah" '{"langkah":[]}')"
cek "teks 1001 karakter → 400 (validasi)" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/bahan/$BB129/langkah" "$(python3 -c "import json;print(json.dumps({'langkah':[{'teks':'x'*1001}]}))")")"
cek "31 langkah → 400 (maks 30)" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/bahan/$BB129/langkah" "$(python3 -c "import json;print(json.dumps({'langkah':[{'teks':'l'} for _ in range(31)]}))")")"
cek "PUT /bahan foto hasil+packing → memantul di DTO" "V == 1" \
  "$(api "$OWNER" PUT "/bahan/$BB129" '{"foto_hasil_url":"/uploads/companies/x/resep/hasil131.jpg","foto_packing_url":"/uploads/companies/x/resep/packing131.jpg"}' | jq '(.foto_hasil_url=="/uploads/companies/x/resep/hasil131.jpg" and .foto_packing_url=="/uploads/companies/x/resep/packing131.jpg")|if . then 1 else 0 end')"
cek "GET /bahan?ringkas=1: baris membawa foto_hasil_url (thumbnail grid)" "V == 1" \
  "$(api "$OWNER" GET "/bahan?ringkas=1" | jq --arg i "$BB129" '[.[]|select(.id==$i)][0].foto_hasil_url=="/uploads/companies/x/resep/hasil131.jpg"|if . then 1 else 0 end')"
# bucket upload "resep": tanpa allowlist server, tujuan asing diam-diam jadi
# "menu" — cek URL benar-benar berprefix /resep/ (jaring regresi koersi).
PNG131=$(mktemp --suffix=.png)
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$PNG131"
URL131=$(curl -s -X POST "$BASE/api/upload?tujuan=resep" -H "Authorization: Bearer $OWNER" -F "file=@$PNG131;type=image/png" | jq -r '.url // ""')
cek "upload tujuan=resep → tersimpan di bucket /resep/" "V == 1" \
  "$(echo "$URL131" | grep -q '/resep/' && echo 1 || echo 0)"

echo "== 132. Transfer Stok antar lokasi (faktur TF- multi bahan) =="
# Memindahkan stok READY antar lokasi (CK↔cabang, cabang↔cabang) lewat faktur
# TF- multi bahan. Satu baris productions per bahan: branch_id = TUJUAN (stok
# masuk saat diterima), asal_branch_id = ASAL (stok keluar saat diterima) →
# saldo, Penerimaan, dan Kartu Stok otomatis konsisten. Berdampingan dengan
# "Kirim dari stok CK" (jalur Permintaan, nomor PR-).
# Pilih cabang ASAL yang benar-benar punya stok siap kirim.
# ASAL wajib Central Kitchen: sejak §140 hanya CK yang boleh MENGIRIM transfer.
# Bahan yang wajib kelipatan kemasan (§148) sengaja DIHINDARI di sini: seksi ini
# menguji mekanika transfer dengan qty 1, bukan aturan kemasan.
ASAL132=""; SALDO132=""
for B132 in $(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="central_kitchen")][].id'); do
  R132=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$B132")
  if [ "$(echo "$R132" | jq '[.rows[]|select(.wajib_kelipatan|not)]|length')" -gt 0 ]; then
    ASAL132="$B132"; SALDO132="$R132"; break
  fi
done
cek "dasar uji: ada lokasi dengan stok siap kirim" "V == 1" \
  "$([ -n "$ASAL132" ] && echo 1 || echo 0)"
TUJUAN132=$(api "$OWNER" GET /cabang | jq -r --arg a "$ASAL132" '[.[]|select(.is_active and .tipe!="kantor" and .id!=$a)][0].id')
KANTOR132=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="kantor")][0].id')
ING132=$(echo "$SALDO132" | jq -r '
  ([.rows[]|select((.wajib_kelipatan|not) and .saldo>=2)][0].ingredient_id)
  // ([.rows[]|select(.wajib_kelipatan|not)][0].ingredient_id)')
cek "dasar uji: bahan §132 bebas aturan kemasan" "V == 1" \
  "$(echo "$SALDO132" | jq -r --arg i "$ING132" '[.rows[]|select(.ingredient_id==$i)][0].wajib_kelipatan|not|if . then 1 else 0 end')"
SAL132=$(echo "$SALDO132" | jq -r --arg i "$ING132" '[.rows[]|select(.ingredient_id==$i)][0].saldo')
cek "GET /transfer-stok/saldo: tiap baris punya pengadaan (beli/produksi) & saldo > 0" "V == 1" \
  "$(echo "$SALDO132" | jq '(([.rows[]|select((.pengadaan=="beli" or .pengadaan=="produksi") and .saldo>0)]|length) == (.rows|length))|if . then 1 else 0 end')"
cek "transfer asal == tujuan → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$ASAL132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}")"
cek "transfer ke Kantor → 400 (kantor tak menyimpan stok)" "V == 400" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$KANTOR132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}")"
cek "transfer qty melebihi stok asal → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":$(python3 -c "print($SAL132 + 1000)")}]}")"
cek "transfer tanpa item → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[]}")"
# saldo SEBELUM transfer (asal & tujuan) — dasar pembanding
SA132_AWAL=$(api "$OWNER" GET "/stok?branch_id=$ASAL132" | jq --arg i "$ING132" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
ST132_AWAL=$(api "$OWNER" GET "/stok?branch_id=$TUJUAN132" | jq --arg i "$ING132" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')
TF132=$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"catatan\":\"ganti barang rusak di jalan\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}")
TFID132=$(echo "$TF132" | jq -r '.faktur_id // ""')
cek "transfer valid → 201 + nomor TF-" "V == 1" \
  "$(echo "$TF132" | jq -r '(.nomor // "") | startswith("TF-") | if . then 1 else 0 end')"
cek "daftar transfer memuat faktur (status menunggu, item ber-pengadaan)" "V == 1" \
  "$(api "$OWNER" GET /transfer-stok | jq --arg f "$TFID132" '[.rows[]|select(.faktur_id==$f)][0] | (.status=="menunggu" and (.items|length)==1 and (.items[0].pengadaan|type)=="string" and .catatan=="ganti barang rusak di jalan") | if . then 1 else 0 end')"
cek "SEBELUM diterima: saldo asal belum berkurang (barang masih di jalan)" "abs(V - 0) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET "/stok?branch_id=$ASAL132" | jq --arg i "$ING132" '[.[]|select(.ingredient_id==$i)][0].saldo // 0') - $SA132_AWAL)")"
cek "kiriman transfer muncul di Penerimaan cabang tujuan" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$TUJUAN132" | jq --arg f "$TFID132" '[.rows[]|select(.faktur_id==$f)]|length >= 1|if . then 1 else 0 end')"
# terima di tujuan → stok tujuan naik, stok asal turun
api "$OWNER" POST "/penerimaan/$TFID132/terima" '{}' > /dev/null
cek "setelah diterima: stok TUJUAN naik +1" "abs(V - 1) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET "/stok?branch_id=$TUJUAN132" | jq --arg i "$ING132" '[.[]|select(.ingredient_id==$i)][0].saldo // 0') - $ST132_AWAL)")"
cek "setelah diterima: stok ASAL turun -1" "abs(V + 1) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET "/stok?branch_id=$ASAL132" | jq --arg i "$ING132" '[.[]|select(.ingredient_id==$i)][0].saldo // 0') - $SA132_AWAL)")"
cek "status faktur transfer jadi dikonfirmasi" "V == 1" \
  "$(api "$OWNER" GET /transfer-stok | jq --arg f "$TFID132" '[.rows[]|select(.faktur_id==$f)][0].status=="dikonfirmasi"|if . then 1 else 0 end')"


# ── §185 idempotensi di bawah PERMINTAAN BERSAMAAN ──
#
# Seluruh berkas ini berurutan, dan itu justru yang TIDAK bisa menguji kelas bug
# terpenting dari klaim idempotensi: dua permintaan ber-`client_ref` sama yang
# datang BERSAMAAN. Pola lama (SELECT → eksekusi → INSERT onConflictDoNothing)
# lolos setiap uji berurutan dengan mulus — dua permintaan bergiliran memang
# aman. Yang bocor hanya saat keduanya berpapasan, dan itu tak akan pernah
# terlihat dari skrip yang menunggu balasan sebelum mengirim berikutnya.
#
# `curl &` + `wait` cukup untuk memunculkannya, jadi tak ada alasan celah ini
# tetap terbuka.
echo "── §185 idempotensi saat dua permintaan berpapasan ──"

REF185=$(cat /proc/sys/kernel/random/uuid)
BODY185="{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}],\"client_ref\":\"$REF185\"}"
T185=$(mktemp -d)
for i in 1 2; do
  curl -s -o "$T185/b$i" -X POST "$BASE/api/transfer-stok" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d "$BODY185" &
done
wait

# Dua hasil sama-sama SAH, dan mana yang muncul bergantung timing:
#   - satu 201 + satu 409 `sedang_diproses` (yang kedua kalah klaim), atau
#   - dua 201 dengan faktur_id IDENTIK (yang kedua datang sesudah yang pertama
#     selesai, lalu diputar ulang dari ledger).
# Yang HARAM cuma satu: dua faktur_id berbeda. Karena itu yang diuji jumlah
# faktur DISTINCT — bukan kode statusnya, yang akan membuat uji ini goyah.
cek "§185 dua transfer berpapasan → hanya SATU faktur lahir" "V == 1" \
  "$(jq -s '[.[] | .faktur_id // empty] | unique | length' "$T185/b1" "$T185/b2")"
# Penjaga arah sebaliknya: kalau KEDUANYA 409, tak ada faktur sama sekali dan
# uji di atas akan memulangkan 0 — bukan lolos diam-diam.
cek "§185 setidaknya satu permintaan benar-benar berhasil" "V >= 1" \
  "$(jq -s '[.[] | select(.ok == true)] | length' "$T185/b1" "$T185/b2")"

# Kiriman ulang BERURUTAN atas ref yang sudah sukses: hasilnya diputar ulang
# apa adanya, bukan transfer kedua.
FID185=$(jq -rs '[.[] | .faktur_id // empty][0]' "$T185/b1" "$T185/b2")
ULANG185=$(api "$OWNER" POST /transfer-stok "$BODY185")
cek "§185 ref yang sukses memulangkan faktur yang SAMA, bukan membuat kedua" "V == 1" \
  "$(python3 -c "import sys,json;print(1 if json.loads(sys.stdin.read()).get('faktur_id')==sys.argv[1] else 0)" "$FID185" <<<"$ULANG185")"

# Kontrak "LEPAS SAAT GAGAL" — sengaja berbeda dari /sync, lihat idempoten.ts.
# Percobaan yang DITOLAK tak boleh membekukan kuncinya: web menahan `client_ref`
# yang sama sampai sukses, jadi kunci beku berarti kasir yang ditolak karena
# stok kurang lalu memperbaiki keranjangnya mendapat penolakan lama SELAMANYA.
REF186=$(cat /proc/sys/kernel/random/uuid)
cek "§185 dasar: qty berlebih ditolak" "V == 400" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":999999}],\"client_ref\":\"$REF186\"}")"
cek "§185 kunci yang DITOLAK tidak membeku — percobaan berikutnya dieksekusi" "V == 201" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}],\"client_ref\":\"$REF186\"}")"
rm -rf "$T185"

# ── §187 dua transfer yang BERSAMA-SAMA melebihi saldo ──
#
# Bukan soal idempotensi: kedua permintaan memang niat yang BERBEDA (client_ref
# berlainan), dan masing-masing muat sendiri-sendiri. Yang diuji apakah penjaga
# "stok CK tidak cukup" tetap mengikat ketika keduanya berpapasan — sebab ia
# MEMBACA saldo lalu menulis, dan pembacaan yang tak terkunci membuat keduanya
# sama-sama melihat saldo penuh.
#
# Kalau bocor, akibatnya bukan baris kembar melainkan stok CK yang MINUS: barang
# dijanjikan ke dua cabang sekaligus, dan yang kedua baru ketahuan saat rak
# kosong.
# STOKNYA DISIAPKAN SENDIRI, bukan menumpang sisa §132.
#
# `ING132` dipilih di §132 sebagai bahan PERTAMA yang saldonya >= 2 — dan
# urutan baris dari API tidak dijamin, jadi bahan yang terpilih berbeda antar
# jalan. Bila yang terpilih kebetulan bersaldo pas-pasan, §132/§185/§186 sudah
# menguras habis sebelum seksi ini sempat menguji apa pun.
#
# Terukur: pada jalan yang sama persis, lokal memulai dengan sisa 1537 dan CI
# dengan sisa 1 — lalu penjaganya gugur beserta dua asersi di bawahnya. Yang
# goyah fikstur berbaginya, bukan kodenya.
#
# `stok/awal` MENETAPKAN saldo (bukan menambah), jadi angkanya pasti berapa pun
# keadaan sebelumnya — dan seksi sesudah ini ikut berdiri di atas tanah yang
# sama.
api "$OWNER" POST /stok/awal \
  "{\"branch_id\":\"$ASAL132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":100}]}" >/dev/null
SISA187=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$ASAL132" \
  | jq --arg i "$ING132" '[.rows[]|select(.ingredient_id==$i)][0] | (.saldo - .dalam_jalan) // 0')
Q187=$(python3 -c "import math;print(max(1, math.ceil($SISA187 * 0.6)))")
cek "dasar §187: ada sisa untuk diuji" "V >= 2" "$SISA187"
T187=$(mktemp -d)
for i in 1 2; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/transfer-stok" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":$Q187}],\"client_ref\":\"$(cat /proc/sys/kernel/random/uuid)\"}" \
    > "$T187/k$i" &
done
wait
# 2 × 60% > 100%, jadi tepat satu yang boleh lolos. Kode yang kalah tidak
# dikunci: 400 (stok kurang) bila ia membaca sesudah yang pertama menulis.
cek "§187 tepat SATU transfer yang lolos" "V == 1" \
  "$(cat "$T187/k1" "$T187/k2" | grep -c '^201$')"
# INTI: sisa tak boleh negatif. Inilah kerusakan yang sesungguhnya —
# baris kembar masih bisa dihapus, stok minus sudah terlanjur dijanjikan.
cek "§187 sisa CK tidak negatif sesudah keduanya" "V >= 0" \
  "$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$ASAL132" \
     | jq --arg i "$ING132" '[.rows[]|select(.ingredient_id==$i)][0] | (.saldo - .dalam_jalan) // 0')"
rm -rf "$T187"

cek "batalkan transfer yang sudah diterima → 409" "V == 409" \
  "$(status_code_body "$OWNER" POST "/transfer-stok/$TFID132/batal" '{}')"
# batal transfer yang masih di jalan → hilang dari daftar & dari Penerimaan
TF132B=$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}" | jq -r .faktur_id)
cek "batal transfer 'menunggu' → ok" "V == 1" \
  "$(api "$OWNER" POST "/transfer-stok/$TF132B/batal" '{}' | jq '.ok==true|if . then 1 else 0 end')"
cek "transfer dibatalkan hilang dari daftar transfer" "V == 0" \
  "$(api "$OWNER" GET /transfer-stok | jq --arg f "$TF132B" '[.rows[]|select(.faktur_id==$f)]|length')"
cek "transfer dibatalkan hilang dari Penerimaan tujuan" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$TUJUAN132" | jq --arg f "$TF132B" '[.rows[]|select(.faktur_id==$f)]|length')"
cek "batal faktur asing → 404" "V == 404" \
  "$(status_code_body "$OWNER" POST "/transfer-stok/00000000-0000-0000-0000-000000000000/batal" '{}')"
# gerbang peran: kasir tak boleh membuat transfer; peran terkunci hanya cabangnya
api "$OWNER" POST /karyawan "{\"nama\":\"Kasir Uji132\",\"email\":\"kasir132@example.com\",\"password\":\"Kasir132!\",\"role\":\"cashier\",\"branch_id\":\"$KBR128\"}" > /dev/null
K132_TOK=$(login "kasir132@example.com" "Kasir132!")
cek "kasir buat transfer → 403 (bukan perannya)" "V == 403" \
  "$(status_code_body "$K132_TOK" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}")"
cek "kitchen transfer DARI cabang lain → 403 (hanya cabang sendiri)" "V == 403" \
  "$(status_code_body "$TKIT" POST /transfer-stok "{\"asal_branch_id\":\"$CK52_UTAMA\",\"tujuan_branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}")"

# --- Stok yang MASIH DI JALAN tidak boleh dijanjikan ulang ---
# Ledger baru mengurangi saldo asal saat tujuan mengonfirmasi, jadi saldo mentah
# masih memuat barang yang sudah lepas. Tanpa potongan `dalam_jalan`, stok yang
# sama bisa ditransfer berkali-kali dan saldo asal jadi minus saat semua tiba.
SALDO132B=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$ASAL132")
cek "GET /transfer-stok/saldo: tiap baris membawa dalam_jalan (angka)" "V == 1" \
  "$(echo "$SALDO132B" | jq '(([.rows[]|select((.dalam_jalan|type)=="number")]|length) == (.rows|length))|if . then 1 else 0 end')"
cek "GET /transfer-stok/saldo: hanya bahan yang masih tersisa (saldo > dalam_jalan)" "V == 1" \
  "$(echo "$SALDO132B" | jq '(([.rows[]|select(.saldo - .dalam_jalan > 0)]|length) == (.rows|length))|if . then 1 else 0 end')"
ING132C=$(echo "$SALDO132B" | jq -r '([.rows[]|select(.wajib_kelipatan|not)][0] // .rows[0]).ingredient_id')
TSD132=$(echo "$SALDO132B" | jq -r --arg i "$ING132C" '[.rows[]|select(.ingredient_id==$i)][0] | (.saldo - .dalam_jalan)')
cek "transfer sebesar SELURUH stok tersedia → 201" "V == 1" \
  "$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132C\",\"qty\":$TSD132}]}" | jq '(.ok==true)|if . then 1 else 0 end')"
cek "transfer ulang stok yang masih di jalan → 400 (tak bisa dijanjikan dua kali)" "V == 400" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132C\",\"qty\":1}]}")"
cek "pesan tolak menyebut barang masih dalam perjalanan" "V == 1" \
  "$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$ASAL132\",\"tujuan_branch_id\":\"$TUJUAN132\",\"items\":[{\"ingredient_id\":\"$ING132C\",\"qty\":1}]}" | jq '((.error // "")|test("dalam perjalanan"))|if . then 1 else 0 end')"
cek "bahan yang seluruh stoknya di jalan hilang dari daftar siap kirim" "V == 0" \
  "$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$ASAL132" | jq --arg i "$ING132C" '[.rows[]|select(.ingredient_id==$i)]|length')"
# --- faktur transfer bukan pekerjaan produksi → jangan mengotori daftar Produksi ---
cek "faktur TF- TIDAK muncul di daftar Produksi cabang tujuan" "V == 0" \
  "$(api "$OWNER" GET "/produksi?branch_id=$TUJUAN132&tipe=produksi&per_page=100" | jq '[.rows[]|select((.nomor // "")|startswith("TF-"))]|length')"
cek "faktur TF- TIDAK muncul di daftar Produksi cabang asal" "V == 0" \
  "$(api "$OWNER" GET "/produksi?branch_id=$ASAL132&tipe=produksi&per_page=100" | jq '[.rows[]|select((.nomor // "")|startswith("TF-"))]|length')"

echo "== 133. Stok CK yang sudah dijanjikan tak boleh dijanjikan ulang =="
# Saldo CK sengaja masih memuat barang yang sudah dikirim tapi belum diterima
# cabang (biar tak "hilang" dari pembukuan). Kalau perencana memakai saldo
# mentah itu, DUA permintaan berturut-turut sama-sama direncanakan "tinggal
# kirim dari CK" untuk stok yang sama → saldo CK MINUS saat semua kiriman tiba.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":500}]}" > /dev/null
R133A=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
KF133=$(echo "$R133A" | jq -r '.kirim.faktur_id // ""')
cek "permintaan-1: stok CK cukup → ada faktur kirim" "V == 1" \
  "$([ -n "$KF133" ] && echo 1 || echo 0)"
api "$OWNER" POST "/produksi/kirim/$KF133" '{}' > /dev/null
cek "selagi di jalan: saldo CK belum berkurang (barang masih tercatat di CK)" "abs(V - 500) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')"
cek "perencana melihat stok CK siap-janji = 0 (semua sudah di jalan)" "abs(V) < 0.001" \
  "$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].kirim_ck // 0')"
R133B=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "permintaan-2: TIDAK ada faktur kirim lagi (stok sudah dijanjikan)" "V == 0" \
  "$(echo "$R133B" | jq '(.kirim != null)|if . then 1 else 0 end')"
cek "permintaan-2: dialihkan jadi work-order produksi" "V == 1" \
  "$(echo "$R133B" | jq '(.produksi != null)|if . then 1 else 0 end')"
api "$OWNER" POST "/penerimaan/$KF133/terima" '{}' > /dev/null
cek "setelah kiriman diterima: saldo CK 0 — TIDAK minus" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')"
cek "cabang menerima tepat 500 (bukan dobel)" "abs(V - 500) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')"

echo "== 134. Tempat penyimpanan tampil SAMA untuk semua peran di cabang =="
# Rak + isinya diatur owner; kitchen/bar/kasir di cabang yang sama harus melihat
# rak, jumlah bahan, daftar petugas, dan isi rak yang persis sama. Menetapkan
# PETUGAS hanya membatasi siapa yang boleh meng-OPNAME rak itu — bukan siapa
# yang boleh melihatnya.
RAK134=$(api "$OWNER" POST /penyimpanan "{\"branch_id\":\"$CB46_ID\",\"nama\":\"Rak Konsistensi 134\"}" | jq -r .id)
api "$OWNER" PUT "/penyimpanan/$RAK134/bahan" "{\"ingredient_ids\":[\"$BB129\",\"$BK129\"]}" > /dev/null
api "$OWNER" PUT "/penyimpanan/$RAK134/petugas" "{\"user_ids\":[\"$U107_ID\"]}" > /dev/null
rak134() { api "$1" GET "/penyimpanan$2" | jq -r --arg r "$RAK134" '[.[]|select(.id==$r)][0] | "\(.nama)|\(.jumlah_bahan)|\([.petugas[].nama]|sort|join(","))"'; }
R134=$(rak134 "$OWNER" "?branch_id=$CB46_ID")
cek "owner melihat rak baru: nama|jumlah bahan|petugas" "V == 1" \
  "$([ "$R134" = "Rak Konsistensi 134|2|Kitchen 107" ] && echo 1 || echo 0)"
cek "kitchen (petugas rak) melihat rak identik" "V == 1" \
  "$([ "$(rak134 "$TKIT" "")" = "$R134" ] && echo 1 || echo 0)"
cek "bar (BUKAN petugas) tetap melihat rak identik" "V == 1" \
  "$([ "$(rak134 "$TBAR" "")" = "$R134" ] && echo 1 || echo 0)"
cek "kasir cabang tetap melihat rak identik" "V == 1" \
  "$([ "$(rak134 "$KASIR46" "")" = "$R134" ] && echo 1 || echo 0)"
isi134() { api "$1" GET "/penyimpanan/$RAK134/bahan" | jq -c '.ingredient_ids|sort'; }
I134=$(isi134 "$OWNER")
cek "isi rak (daftar bahan) sama untuk kitchen" "V == 1" "$([ "$(isi134 "$TKIT")" = "$I134" ] && echo 1 || echo 0)"
cek "isi rak (daftar bahan) sama untuk bar" "V == 1" "$([ "$(isi134 "$TBAR")" = "$I134" ] && echo 1 || echo 0)"
cek "isi rak (daftar bahan) sama untuk kasir" "V == 1" "$([ "$(isi134 "$KASIR46")" = "$I134" ] && echo 1 || echo 0)"
tmp134() { api "$1" GET "/stok$2" | jq -c '[.[]|select(.tempat!=null)|[.nama,.tempat]]|sort'; }
T134=$(tmp134 "$OWNER" "?branch_id=$CB46_ID")
cek "kolom Tempat di halaman Stok sama untuk kitchen" "V == 1" "$([ "$(tmp134 "$TKIT" "")" = "$T134" ] && echo 1 || echo 0)"
cek "kolom Tempat di halaman Stok sama untuk bar" "V == 1" "$([ "$(tmp134 "$TBAR" "")" = "$T134" ] && echo 1 || echo 0)"
cek "kolom Tempat di halaman Stok sama untuk kasir" "V == 1" "$([ "$(tmp134 "$KASIR46" "")" = "$T134" ] && echo 1 || echo 0)"
cek "rak cabang ini TIDAK bocor ke akun cabang lain (tim CK)" "V == 0" \
  "$(api "$TCK58" GET /penyimpanan | jq --arg r "$RAK134" '[.[]|select(.id==$r)]|length')"

echo "== 135. Resep hanya boleh diproduksi di LOKASI-nya =="
# §129 sudah menjaga DIVISI (kitchen vs bar). Di sini yang dijaga LOKASI:
# resep milik Central Kitchen tak boleh diproduksi peran cabang, dan resep
# cabang tak boleh dikerjakan divisi lain — dua-duanya ditolak server.
cek "kitchen cabang produksi resep milik CK → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /produksi/faktur "{\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"mode\":\"batch\",\"jumlah\":1}]}")"
cek "bar cabang produksi resep milik CK → 400" "V == 400" \
  "$(status_code_body "$TBAR" POST /produksi/faktur "{\"worker_id\":\"$UBAR_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"mode\":\"batch\",\"jumlah\":1}]}")"
cek "pesan tolak menyebut resep itu diproduksi di Central Kitchen" "V == 1" \
  "$(api "$TKIT" POST /produksi/faktur "{\"worker_id\":\"$U107_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"mode\":\"batch\",\"jumlah\":1}]}" | jq '((.error // "")|test("Central Kitchen"))|if . then 1 else 0 end')"
cek "bar TETAP boleh produksi resep divisinya sendiri (tidak ikut terblokir)" "V == 1" \
  "$(api "$TBAR" POST /produksi/faktur "{\"worker_id\":\"$UBAR_ID\",\"items\":[{\"ingredient_id\":\"$BB129\",\"mode\":\"pcs\",\"jumlah\":1}]}" | jq '((.faktur_id // "")|length > 0)|if . then 1 else 0 end')"

echo "== 136. Permintaan pembelian produksi memunculkan SEMUA bahan resep =="
# Resep baso uji66 = daging 2000 + tepung 300 per batch. Yang diperiksa: tidak
# ada komponen yang hilang dari rencana, baik saat stok kosong, sebagian,
# maupun sudah cukup (ditampilkan dgn kurang 0 agar tetap terlihat).
nol136() { api "$OWNER" POST /stok/awal "{\"branch_id\":\"$1\",\"items\":[{\"ingredient_id\":\"$2\",\"qty\":$3}]}" > /dev/null; }
nol136 "$CB46_ID" "$BASO66" 0; nol136 "$CK52_UTAMA" "$BASO66" 0
nol136 "$CK52_UTAMA" "$DAG66" 0; nol136 "$CK52_UTAMA" "$TEP66" 0
rencana136() { api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}"; }
R136=$(rencana136)
cek "stok kosong: KEDUA bahan mentah resep muncul di rencana" "V == 2" \
  "$(echo "$R136" | jq --arg a "$DAG66" --arg b "$TEP66" '[.bahan_produksi[]|select(.ingredient_id==$a or .ingredient_id==$b)]|length')"
cek "stok kosong: daging butuh 10000 (5 batch x 2000)" "abs(V - 10000) < 0.001" \
  "$(echo "$R136" | jq --arg a "$DAG66" '[.bahan_produksi[]|select(.ingredient_id==$a)][0].kurang')"
nol136 "$CK52_UTAMA" "$DAG66" 5000
cek "stok SEBAGIAN: daging tetap muncul dgn sisa kekurangan 5000" "abs(V - 5000) < 0.001" \
  "$(rencana136 | jq --arg a "$DAG66" '[.bahan_produksi[]|select(.ingredient_id==$a)][0].kurang')"
nol136 "$CK52_UTAMA" "$DAG66" 10000
cek "stok CUKUP: daging TETAP ditampilkan (tak disembunyikan) dgn kurang 0" "V == 1" \
  "$(rencana136 | jq --arg a "$DAG66" '([.bahan_produksi[]|select(.ingredient_id==$a)][0] | (. != null) and (.kurang == 0))|if . then 1 else 0 end')"
# Stok minimum: batch tercukupi tapi sisa di bawah minimum → tetap dibelikan,
# dan HANYA bahan yang di bawah minimum (yang berlimpah tidak ikut dibeli).
api "$OWNER" PUT "/bahan/$DAG66" '{"stok_minimum":3000}' > /dev/null
nol136 "$CK52_UTAMA" "$DAG66" 2500; nol136 "$CK52_UTAMA" "$TEP66" 5000
BO136=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"mode\":\"batch\",\"jumlah\":1}]}" | jq -r '.beli_otomatis.faktur_id // ""')
cek "stok minimum: faktur beli otomatis terbit meski batch tercukupi" "V == 1" \
  "$([ -n "$BO136" ] && echo 1 || echo 0)"
cek "beli otomatis HANYA memuat bahan yang di bawah minimum (daging)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=200" | jq --arg f "$BO136" --arg a "$DAG66" '[.rows[]|select(.faktur_id==$f)] | ((length==1) and (.[0].ingredient_id==$a)) | if . then 1 else 0 end')"
api "$OWNER" PUT "/bahan/$DAG66" '{"stok_minimum":0}' > /dev/null
# Resep BERTINGKAT: komponen yang juga resep tak bisa DIBELI, tapi tak boleh
# hilang diam-diam — pengaman "Mulai Kerjakan" wajib menyebutnya.
nol136 "$CK52_UTAMA" "$JANDO66" 0; nol136 "$CK52_UTAMA" "$BASO66" 0; nol136 "$CK52_UTAMA" "$TEP66" 0
FJ136=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$JANDO66\",\"mode\":\"batch\",\"jumlah\":1}]}" | jq -r .faktur_id)
ERR136=$(api "$OWNER" POST "/produksi/tahap/$FJ136" '{"ke":"dikerjakan"}')
cek "resep bertingkat: mulai kerjakan ditahan saat bahan belum ada" "V == 1" \
  "$(echo "$ERR136" | jq '((.error // "")|test("belum cukup"))|if . then 1 else 0 end')"
cek "peringatan menyebut bahan mentah (tepung) DAN komponen resep (baso)" "V == 1" \
  "$(echo "$ERR136" | jq '(((.error // "") | test("tepung uji66")) and ((.error // "") | test("baso uji66"))) | if . then 1 else 0 end')"

echo "== 137. Sinkron penjualan offline: shift tak cocok (transaksi susulan) =="
# Celah yang ditutup: kasir OFFLINE masih melayani setelah shift ditutup dari
# web/perangkat lain. Dulu item itu gagal 409 dan TIDAK PERNAH dicoba ulang oleh
# mobile → uang tunai yang sudah diterima tak punya jejak sama sekali.
# Sekarang sale dibukukan ke shift tertutup terdekat (<=6 jam, tanggal bisnis
# sama) lewat kolom sales.shift_id, jadi uangnya muncul di rekap & selisih kas.
uuid137() { cat /proc/sys/kernel/random/uuid; }
# token $KASIR sudah 401 sejak §105 (password kasir diganti → token_version naik).
# $REISS105 adalah token kasir hasil re-issue di §105 dan sudah diuji valid di sana.
K137="$REISS105"
MENU137=$(api "$K137" GET /menu | jq -r '.[0].id')
# Bersihkan: pastikan tak ada shift terbuka, lalu buka+tutup satu shift baru.
if [ -n "$(api "$K137" GET /shift/aktif | jq -r '.id // empty')" ]; then
  api "$K137" POST /shift/tutup '{"uang_fisik":0}' > /dev/null
fi
api "$K137" POST /shift/buka '{"modal_awal":100000}' > /dev/null
SH137=$(api "$K137" GET /shift/aktif | jq -r .id)
api "$K137" POST /shift/tutup '{"uang_fisik":100000}' > /dev/null
cek "dasar uji: shift dibuka lalu ditutup" "V == 1" \
  "$([ -n "$SH137" ] && [ "$SH137" != "null" ] && echo 1 || echo 0)"
SEL_AWAL=$(api "$K137" GET /shift | jq --arg s "$SH137" '[.[]|select(.id==$s)][0].selisih')
TUNAI_AWAL=$(api "$K137" GET /shift | jq --arg s "$SH137" '[.[]|select(.id==$s)][0].penjualan_tunai')
cek "shift tertutup: selisih kas 0 sebelum transaksi susulan" "V == 1" \
  "$(echo "$SEL_AWAL" | jq '.==0|if . then 1 else 0 end')"

# Jendela susulan mensyaratkan TANGGAL BISNIS yang sama (lihat
# `dalamToleransiSusulan` di sync/routes.ts): penjualan 00:00 WIB tidak boleh
# masuk ke shift kemarin. Itu aturan yang benar dan memang disengaja.
#
# Tapi `+2 menit` di bawah MELEWATI tengah malam WIB bila blok ini kebetulan
# berjalan pukul 23.58–23.59 — dan ke-11 pemeriksaan di bawahnya gagal karena
# kalender, bukan karena produknya. Itu bukan kemungkinan teoretis: run CI
# 16:58 UTC (= 23:58 WIB) gagal persis begitu.
#
# DITUNGGU, bukan dilewati. Melewatkan blok ini akan menghapus cakupan tepat di
# jalur yang paling jarang tersentuh (kasir offline menjual sesudah shift-nya
# ditutup dari perangkat lain), dan lubang cakupan yang muncul sendiri di
# tengah malam adalah lubang yang tak pernah ada yang sadari. Menunggunya
# paling lama ~3 menit dan hanya kena pada ~0,2% run.
JAM_WIB=$(TZ=Asia/Jakarta date +%H%M)
if [ "$((10#$JAM_WIB))" -ge 2357 ]; then
  TUNGGU137=$(( $(TZ=Asia/Jakarta date -d 'tomorrow 00:00:10' +%s) - $(date +%s) ))
  echo "   … §137 menunggu ${TUNGGU137}s melewati tengah malam WIB (jendela susulan wajib satu tanggal bisnis)"
  sleep "$TUNGGU137"
fi
# waktu 2 menit ke DEPAN: masih dalam toleransi jam perangkat (5 menit) tapi
# sudah SETELAH ditutup_pada → persis kasus lapangan "tutup 20.30, jual 20.45".
W137=$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)
R137=$(uuid137)
B137=$(jq -nc --arg r "$R137" --arg w "$W137" --arg m "$MENU137" '{device_id:"dev137",commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}],metode_bayar:"tunai"}}]}')
RES137=$(api "$K137" POST /sync "$B137")
cek "susulan di luar jendela: item ok 201 (bukan lagi gagal 409)" "V == 1" \
  "$(echo "$RES137" | jq '(.hasil[0].status=="ok" and .hasil[0].kode==201)|if . then 1 else 0 end')"
cek "data hasil memuat shift.id shift yang benar" "V == 1" \
  "$(echo "$RES137" | jq --arg s "$SH137" '.hasil[0].data.shift.id==$s|if . then 1 else 0 end')"
cek "data hasil memuat ada_transaksi_susulan=true" "V == 1" \
  "$(echo "$RES137" | jq '.hasil[0].data.ada_transaksi_susulan==true|if . then 1 else 0 end')"
cek "data hasil menandai di_luar_jendela_shift=true" "V == 1" \
  "$(echo "$RES137" | jq '.hasil[0].data.di_luar_jendela_shift==true|if . then 1 else 0 end')"
cek "shift ditandai ada_transaksi_susulan" "V == 1" \
  "$(api "$K137" GET /shift | jq --arg s "$SH137" '[.[]|select(.id==$s)][0].ada_transaksi_susulan==true|if . then 1 else 0 end')"

# Inti perbaikan: uangnya BENAR-BENAR masuk rekap shift itu. Sebelum ada kolom
# shift_id, rekap menyaring waktu <= ditutup_pada sehingga sale ini tak terhitung
# di mana pun — penanda susulan jadi penanda bohong.
TUNAI_AKHIR=$(api "$K137" GET /shift | jq --arg s "$SH137" '[.[]|select(.id==$s)][0].penjualan_tunai')
cek "rekap tunai shift BERTAMBAH (uang masuk hitungan)" "V == 1" \
  "$(echo "$TUNAI_AKHIR $TUNAI_AWAL" | jq -s '.[0] > .[1]|if . then 1 else 0 end')"
cek "selisih kas jadi negatif (uang fisik lama < kas sistem baru)" "V == 1" \
  "$(api "$K137" GET /shift | jq --arg s "$SH137" '[.[]|select(.id==$s)][0].selisih < 0|if . then 1 else 0 end')"
cek "detail shift memuat transaksi tsb dan menandainya susulan" "V == 1" \
  "$(api "$K137" GET "/shift/$SH137" | jq '[.transaksi[]|select(.susulan==true)]|length>=1|if . then 1 else 0 end')"

# Idempotency setelah fallback: kirim ulang tak boleh menggandakan rekap.
TUNAI_X=$(api "$K137" GET /shift | jq --arg s "$SH137" '[.[]|select(.id==$s)][0].penjualan_tunai')
RETRY137=$(api "$K137" POST /sync "$B137")
cek "kirim ulang batch sama → sudah_ada" "V == 1" \
  "$(echo "$RETRY137" | jq '.hasil[0].status=="sudah_ada"|if . then 1 else 0 end')"
# Perangkat bisa mati SETELAH server membukukan sale tapi SEBELUM aplikasi
# sempat memproses respons. Saat retry, mobile tetap butuh konteks shift untuk
# memunculkan peringatan "masuk ke shift yang sudah ditutup" — kalau `data`
# hilang di jalur idempoten, peringatan itu lenyap diam-diam.
cek "retry item SUKSES membalas data UTUH: shift.id ikut" "V == 1" \
  "$(echo "$RETRY137" | jq --arg s "$SH137" '.hasil[0].data.shift.id==$s|if . then 1 else 0 end')"
cek "retry item SUKSES membalas data UTUH: di_luar_jendela_shift ikut" "V == 1" \
  "$(echo "$RETRY137" | jq '.hasil[0].data.di_luar_jendela_shift==true|if . then 1 else 0 end')"
cek "retry item SUKSES membalas data UTUH: ada_transaksi_susulan ikut" "V == 1" \
  "$(echo "$RETRY137" | jq '.hasil[0].data.ada_transaksi_susulan==true|if . then 1 else 0 end')"
cek "kirim ulang TIDAK menggandakan rekap shift" "V == 1" \
  "$(api "$K137" GET /shift | jq --arg s "$SH137" --argjson t "$TUNAI_X" '[.[]|select(.id==$s)][0].penjualan_tunai == $t|if . then 1 else 0 end')"

# Batas: tanggal yang benar-benar tak punya shift tetap ditolak — sale tidak
# boleh nyasar ke shift hari lain. 409 kini membawa sebab terstruktur.
W137X=$(date -u -d '-20 days' +%Y-%m-%dT%H:%M:%SZ)
B137X=$(jq -nc --arg r "$(uuid137)" --arg w "$W137X" --arg m "$MENU137" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}}]}')
RES137X=$(api "$K137" POST /sync "$B137X")
cek "tanggal tanpa shift sama sekali → tetap gagal 409" "V == 1" \
  "$(echo "$RES137X" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==409)|if . then 1 else 0 end')"
cek "409 membawa sebab='shift_tidak_cocok'" "V == 1" \
  "$(echo "$RES137X" | jq '.hasil[0].sebab=="shift_tidak_cocok"|if . then 1 else 0 end')"
cek "409 membawa data.shift_terdekat (null bila memang tak ada)" "V == 1" \
  "$(echo "$RES137X" | jq '(.hasil[0].data|has("shift_terdekat"))|if . then 1 else 0 end')"
cek "penolakan tersimpan dibalas utuh saat retry (sebab ikut)" "V == 1" \
  "$(api "$K137" POST /sync "$B137X" | jq '(.hasil[0].status=="sudah_ada" and .hasil[0].sebab=="shift_tidak_cocok")|if . then 1 else 0 end')"

# Batas umur per tipe: penjualan 30 hari (uang sudah diterima — jangan dibuang),
# tipe lain tetap 7 hari (mengubah stok jauh ke belakang berbahaya).
W137OLD=$(date -u -d '-20 days' +%Y-%m-%dT%H:%M:%SZ)
B137A=$(jq -nc --arg r "$(uuid137)" --arg w "$W137OLD" '{commands:[{client_ref:$r,tipe:"absen_saya",waktu:$w,payload:{foto_url:"http://x/f.jpg"}}]}')
cek "absen 20 hari lalu → tetap gagal 400 (batas 7 hari)" "V == 1" \
  "$(api "$K137" POST /sync "$B137A" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400)|if . then 1 else 0 end')"
cek "penjualan 20 hari lalu → BUKAN 400 (batas 30 hari, ditolak krn shift saja)" "V == 1" \
  "$(echo "$RES137X" | jq '.hasil[0].kode==409|if . then 1 else 0 end')"
W137TOO=$(date -u -d '-40 days' +%Y-%m-%dT%H:%M:%SZ)
B137B=$(jq -nc --arg r "$(uuid137)" --arg w "$W137TOO" --arg m "$MENU137" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}}]}')
cek "penjualan 40 hari lalu → gagal 400 (lewat batas 30 hari)" "V == 1" \
  "$(api "$K137" POST /sync "$B137B" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400)|if . then 1 else 0 end')"

# Jalur lama tidak berubah: shift TERBUKA + waktu di dalam jendela → bukan susulan.
api "$K137" POST /shift/buka '{"modal_awal":0}' > /dev/null
W137N=$(date -u +%Y-%m-%dT%H:%M:%SZ)
B137N=$(jq -nc --arg r "$(uuid137)" --arg w "$W137N" --arg m "$MENU137" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}]}}]}')
RES137N=$(api "$K137" POST /sync "$B137N")
cek "shift terbuka: penjualan ok dan TIDAK ditandai susulan" "V == 1" \
  "$(echo "$RES137N" | jq '(.hasil[0].status=="ok" and .hasil[0].data.ada_transaksi_susulan==false and .hasil[0].data.di_luar_jendela_shift==false)|if . then 1 else 0 end')"

echo "== 138. shift_buka lewat sinkron (pemadaman panjang ≠ nol transaksi) =="
# Setelah snapshot shift offline mobile dirapatkan jadi 6 jam, perangkat yang
# offline lebih lama tak bisa berjualan sama sekali karena POST /shift/buka
# online-only. shift_buka kini bisa diantre: `waktu` jadi opened_at, sehingga
# SELURUH penjualan hari itu jatuh di dalam jendela shift secara wajar — tanpa
# bersandar pada toleransi transaksi susulan.
uuid138() { cat /proc/sys/kernel/random/uuid; }
MENU138=$(api "$K137" GET /menu | jq -r '.[0].id')
if [ -n "$(api "$K137" GET /shift/aktif | jq -r '.id // empty')" ]; then
  api "$K137" POST /shift/tutup '{"uang_fisik":0}' > /dev/null
fi

# Gerbang absen TIDAK dilewati, tapi dinilai pada tanggal bisnis `waktu`:
# kasir tidak absen 3 hari lalu → ditolak, walau hari ini ia absen.
W138OLD=$(date -u -d '-3 days' +%Y-%m-%dT%H:%M:%SZ)
B138OLD=$(jq -nc --arg r "$(uuid138)" --arg w "$W138OLD" '{commands:[{client_ref:$r,tipe:"shift_buka",waktu:$w,payload:{modal_awal:50000}}]}')
cek "absen dinilai pada tanggal WAKTU: 3 hari lalu tanpa absen → gagal 400" "V == 1" \
  "$(api "$K137" POST /sync "$B138OLD" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==400 and ((.hasil[0].error//"")|test("Absen masuk dulu")))|if . then 1 else 0 end')"
cek "tak ada shift terbuka setelah perintah ditolak" "V == 1" \
  "$(api "$K137" GET /shift/aktif | jq 'if .==null then 1 else 0 end')"

# Buka shift offline BEBERAPA WAKTU lalu, tapi masih HARI INI — kasir absennya
# ada di tanggal bisnis hari ini (§2b), dan gerbang absen dinilai pada tanggal
# bisnis `waktu` (dibuktikan tepat di atas oleh kasus "3 hari lalu").
#
# Karena itu offsetnya TIDAK boleh dipatok 4 jam. Antara 00.00–03.59 WIB,
# `now - 4 jam` mendarat di HARI KEMARIN, absennya tak ada di sana, dan
# perintahnya ditolak 400 — 13 pemeriksaan di bawah runtuh berurutan karena
# kalender, bukan karena produk. Itu yang terjadi pada run 17:05 UTC
# (= 00:05 WIB); jendela rusaknya empat jam penuh setiap hari.
#
# Angka 4 jam sendiri tak pernah jadi inti: yang diuji adalah `dibuka_pada`
# memakai WAKTU KEJADIAN, bukan jam sinkron. Jadi rentangnya dibuat sebesar
# yang muat di hari ini, dengan urutan buka < jual < kedua < sekarang tetap
# terjaga.
WIB_MENIT=$(( 10#$(TZ=Asia/Jakarta date +%H) * 60 + 10#$(TZ=Asia/Jakarta date +%M) ))
if [ "$WIB_MENIT" -lt 10 ]; then
  # Beberapa menit pertama hari bisnis: skenario "dibuka lebih awal hari ini"
  # memang belum bisa ada. Ditunggu (maks 10 menit, ~0,7% run) — bukan
  # dilewati, karena lubang cakupan yang muncul sendiri tengah malam adalah
  # lubang yang tak akan pernah ada yang sadari.
  echo "   … §138 menunggu $(( (10 - WIB_MENIT) * 60 ))s: butuh jarak dari tengah malam WIB"
  sleep $(( (10 - WIB_MENIT) * 60 ))
  WIB_MENIT=10
fi
SPAN138=$(( WIB_MENIT - 2 )); [ "$SPAN138" -gt 240 ] && SPAN138=240
OFF_BUKA138=$SPAN138                      # buka shift
OFF_JUAL138=$(( SPAN138 * 3 / 4 ))        # penjualan offline + ambang dibuka_pada
OFF_DUA138=$(( SPAN138 / 2 ))             # perintah shift_buka kedua
W138=$(date -u -d "-${OFF_BUKA138} minutes" +%Y-%m-%dT%H:%M:%SZ)
B138=$(jq -nc --arg r "$(uuid138)" --arg w "$W138" '{device_id:"dev138",commands:[{client_ref:$r,tipe:"shift_buka",waktu:$w,payload:{modal_awal:250000}}]}')
RES138=$(api "$K137" POST /sync "$B138")
cek "shift_buka lewat sinkron → item ok 201" "V == 1" \
  "$(echo "$RES138" | jq '(.hasil[0].status=="ok" and .hasil[0].kode==201)|if . then 1 else 0 end')"
cek "sudah_terbuka=false (shift benar-benar baru dibuat)" "V == 1" \
  "$(echo "$RES138" | jq '.hasil[0].data.sudah_terbuka==false|if . then 1 else 0 end')"
cek "modal_awal dari payload terbawa" "V == 250000" \
  "$(echo "$RES138" | jq '.hasil[0].data.modal_awal')"
SH138=$(echo "$RES138" | jq -r '.hasil[0].data.id')
# INTI: dibuka_pada = waktu kejadian, BUKAN jam sinkron.
cek "dibuka_pada memakai waktu kejadian (jauh sebelum jam sinkron)" "V == 1" \
  "$(api "$K137" GET /shift/aktif | jq --arg n "$(date -u -d "-${OFF_JUAL138} minutes" +%Y-%m-%dT%H:%M:%SZ)" '(.dibuka_pada < $n)|if . then 1 else 0 end')"

# Manfaatnya: penjualan offline 3 jam lalu masuk lewat JENDELA NORMAL —
# bukan jalur toleransi susulan.
W138S=$(date -u -d "-${OFF_JUAL138} minutes" +%Y-%m-%dT%H:%M:%SZ)
B138S=$(jq -nc --arg r "$(uuid138)" --arg w "$W138S" --arg m "$MENU138" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{items:[{menu_id:$m,qty:1}],metode_bayar:"tunai"}}]}')
RES138S=$(api "$K137" POST /sync "$B138S")
cek "penjualan 3 jam lalu → ok, masuk shift yang dibuka offline" "V == 1" \
  "$(echo "$RES138S" | jq --arg s "$SH138" '(.hasil[0].status=="ok" and .hasil[0].data.shift.id==$s)|if . then 1 else 0 end')"
cek "penjualan itu BUKAN susulan (jendela normal, bukan toleransi)" "V == 1" \
  "$(echo "$RES138S" | jq '(.hasil[0].data.di_luar_jendela_shift==false and .hasil[0].data.ada_transaksi_susulan==false)|if . then 1 else 0 end')"
cek "rekap shift terbuka menghitung penjualan itu" "V == 1" \
  "$(api "$K137" GET /shift/aktif | jq '.jumlah_transaksi>=1|if . then 1 else 0 end')"

# Bentrok: manajer/perangkat lain sudah membuka shift → JANGAN gagal, kembalikan
# shift yang ada. Menggagalkannya membuat penjualan yang bersandar padanya
# kehilangan tempat berpijak — kelas bug yang baru ditutup di §137.
B138B=$(jq -nc --arg r "$(uuid138)" --arg w "$(date -u -d "-${OFF_DUA138} minutes" +%Y-%m-%dT%H:%M:%SZ)" '{commands:[{client_ref:$r,tipe:"shift_buka",waktu:$w,payload:{modal_awal:999}}]}')
RES138B=$(api "$K137" POST /sync "$B138B")
cek "shift sudah terbuka → tetap ok (bukan gagal)" "V == 1" \
  "$(echo "$RES138B" | jq '.hasil[0].status=="ok"|if . then 1 else 0 end')"
cek "ditandai sudah_terbuka=true + mengembalikan shift yang ADA" "V == 1" \
  "$(echo "$RES138B" | jq --arg s "$SH138" '(.hasil[0].data.sudah_terbuka==true and .hasil[0].data.id==$s)|if . then 1 else 0 end')"
cek "tidak membuat shift kedua (modal_awal tak tertimpa)" "V == 250000" \
  "$(api "$K137" GET /shift/aktif | jq '.modal_awal')"

# Retry perintah SUKSES: perangkat bisa mati setelah server membukukan tapi
# sebelum aplikasi memproses respons. Jalur idempoten harus membalas `data`
# UTUH — kalau menyusut, peringatan "modal awal tidak dipakai" hilang diam-diam.
# Perhatikan: yang dibalas adalah HASIL SAAT DIEKSEKUSI (sudah_terbuka:false),
# bukan penilaian ulang keadaan sekarang — walau kini shift memang terbuka.
RETRY138=$(api "$K137" POST /sync "$B138")
cek "retry shift_buka sukses → sudah_ada" "V == 1" \
  "$(echo "$RETRY138" | jq '.hasil[0].status=="sudah_ada"|if . then 1 else 0 end')"
cek "retry membalas data UTUH: id shift ikut" "V == 1" \
  "$(echo "$RETRY138" | jq --arg s "$SH138" '.hasil[0].data.id==$s|if . then 1 else 0 end')"
cek "retry membalas data UTUH: sudah_terbuka ikut (snapshot saat eksekusi)" "V == 1" \
  "$(echo "$RETRY138" | jq '.hasil[0].data.sudah_terbuka==false|if . then 1 else 0 end')"
cek "retry membalas data UTUH: modal_awal ikut" "V == 250000" \
  "$(echo "$RETRY138" | jq '.hasil[0].data.modal_awal')"

# Guard: peran & jalur online tidak berubah.
cek "owner kirim shift_buka → item gagal 403" "V == 1" \
  "$(api "$OWNER" POST /sync "$(jq -nc --arg r "$(uuid138)" --arg w "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{commands:[{client_ref:$r,tipe:"shift_buka",waktu:$w,payload:{}}]}')" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==403)|if . then 1 else 0 end')"
cek "regresi nol: POST /shift/buka online TETAP 400 saat shift terbuka" "V == 400" \
  "$(status_code_body "$K137" POST /shift/buka '{"modal_awal":0}')"

echo
echo "== 139. ETag / 304 pada endpoint daftar master data =="
# Aplikasi mobile merevalidasi cache di latar belakang; tanpa ETag tiap
# revalidasi menarik badan penuh walau tak ada yang berubah. Yang diuji di sini
# bukan sekadar "ada header ETag", tapi tiga sifat yang kalau lepas membuat
# fiturnya diam-diam tak berguna: stabil, peka perubahan, dan tak bocor
# antar-endpoint.

etag_of() { # etag_of <token> <path> [flag curl tambahan]
  curl -s -o /dev/null -D - ${3:-} -X GET "$BASE/api$2" -H "Authorization: Bearer $1" \
    | tr -d '\r' | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p'
}
hdr_of() { # hdr_of <token> <path> <nama-header>
  curl -s -o /dev/null -D - -X GET "$BASE/api$2" -H "Authorization: Bearer $1" \
    | tr -d '\r' | sed -n "s/^$3: *//Ip"
}
status_inm() { # status_inm <token> <path> <if-none-match>
  curl -s -o /dev/null -w '%{http_code}' -X GET "$BASE/api$2" \
    -H "Authorization: Bearer $1" -H "If-None-Match: $3"
}
bytes_inm() { # bytes_inm <token> <path> <if-none-match>
  curl -s -X GET "$BASE/api$2" -H "Authorization: Bearer $1" -H "If-None-Match: $3" | wc -c
}

for JALUR in /menu /kategori /cabang /meja; do
  ET=$(etag_of "$OWNER" "$JALUR")
  cek "GET $JALUR membawa header ETag" "V == 1" "$([ -n "$ET" ] && echo 1 || echo 0)"
  cek "GET $JALUR + If-None-Match cocok → 304" "V == 304" "$(status_inm "$OWNER" "$JALUR" "$ET")"
  cek "304 $JALUR tanpa badan (0 byte)" "V == 0" "$(bytes_inm "$OWNER" "$JALUR" "$ET")"
  cek "GET $JALUR + ETag basi → 200 (bukan 304)" "V == 200" \
    "$(status_inm "$OWNER" "$JALUR" '"basi-tidak-akan-pernah-cocok"')"
done

# SIFAT PALING RAPUH: digest harus stabil untuk data yang sama. Larik bersarang
# tanpa ORDER BY (`komponen`, `branch_ids` pada /menu) atau kunci urut yang seri
# membuat ETag berubah-ubah walau tak ada yang diubah — gejalanya menyamar jadi
# "datanya memang sering berubah", jadi nyaris mustahil dilacak belakangan.
for JALUR in /menu /kategori /cabang /meja; do
  SAMA=1
  E0=$(etag_of "$OWNER" "$JALUR")
  for _ in 1 2 3 4 5; do
    [ "$(etag_of "$OWNER" "$JALUR")" = "$E0" ] || SAMA=0
  done
  cek "ETag $JALUR stabil pada 6 permintaan beruntun (urutan JSON deterministik)" "V == 1" "$SAMA"
done

# Peka perubahan: kalau ETag tak bergerak setelah data berubah, klien memegang
# data basi selamanya — kegagalan yang jauh lebih buruk daripada tanpa ETag.
EK_SEBELUM=$(etag_of "$OWNER" /kategori)
api "$OWNER" POST /kategori '{"nama":"Kategori ETag 139","sort_order":97}' > /dev/null
EK_SESUDAH=$(etag_of "$OWNER" /kategori)
cek "ETag /kategori BERUBAH setelah kategori baru dibuat" "V == 1" \
  "$([ "$EK_SEBELUM" != "$EK_SESUDAH" ] && echo 1 || echo 0)"
cek "ETag /kategori lama → 200 lagi (klien menarik data baru)" "V == 200" \
  "$(status_inm "$OWNER" /kategori "$EK_SEBELUM")"

# Tak bocor antar-endpoint: ETag terikat pada isi, bukan pada rute.
cek "ETag /kategori dipakai di /menu → 200 (bukan 304 palsu)" "V == 200" \
  "$(status_inm "$OWNER" /menu "$EK_SESUDAH")"

# Interaksi dengan kompresi. compress() melemahkan ETag jadi W/"..." saat badan
# jadi ter-gzip — RFC menuntut itu karena kompresi mengubah byte yang dikirim.
# Pencocokan If-None-Match mengabaikan awalan W/, jadi klien ber-gzip dan
# tanpa-gzip harus sama-sama kena 304. Kalau middleware dipasang di LUAR
# compress(), digest dihitung dari byte terkompresi dan tak pernah cocok.
ET_GZIP=$(etag_of "$OWNER" /menu "--compressed")
cek "ETag /menu ada juga saat klien menerima gzip" "V == 1" \
  "$([ -n "$ET_GZIP" ] && echo 1 || echo 0)"
cek "ETag gzip cocok balik → 304" "V == 304" "$(status_inm "$OWNER" /menu "$ET_GZIP")"
cek "ETag gzip = ETag polos setelah awalan W/ dilepas" "V == 1" \
  "$([ "${ET_GZIP#W/}" = "$(etag_of "$OWNER" /menu)" ] && echo 1 || echo 0)"

# Header cache: `private` supaya cache bersama tak pernah menyimpan badan milik
# satu tenant, `no-cache` = wajib revalidasi (bukan "jangan simpan").
cek "GET /menu membawa Cache-Control private, no-cache" "V == 1" \
  "$([ "$(hdr_of "$OWNER" /menu 'Cache-Control')" = "private, no-cache" ] && echo 1 || echo 0)"
cek "Cache-Control ikut terbawa pada respons 304" "V == 1" \
  "$(curl -s -o /dev/null -D - -X GET "$BASE/api/menu" -H "Authorization: Bearer $OWNER" \
      -H "If-None-Match: $(etag_of "$OWNER" /menu)" | tr -d '\r' \
      | grep -qi '^cache-control: private, no-cache' && echo 1 || echo 0)"
cek "GET /menu membawa Vary: Authorization" "V == 1" \
  "$([ "$(hdr_of "$OWNER" /menu 'Vary')" = "Authorization" ] && echo 1 || echo 0)"

# Build id WAJIB ikut pada 304. Middleware etag membangun respons 304 dari nol
# dan membuang header non-retained; kalau X-Kakarut-Build ikut hilang, browser
# memakai ulang nilai LAMA dari cache-nya → klien mengira ada versi baru
# padahal barusan diperbarui, dan dialog "Ada pembaruan aplikasi" muncul lagi
# tepat setelah dimuat ulang, berputar tanpa henti. Ini pernah terjadi.
B139_200=$(hdr_of "$OWNER" /cabang 'X-Kakarut-Build')
B139_304=$(curl -s -o /dev/null -D - -X GET "$BASE/api/cabang" \
  -H "Authorization: Bearer $OWNER" -H "If-None-Match: $(etag_of "$OWNER" /cabang)" \
  | tr -d '\r' | sed -n 's/^X-Kakarut-Build: *//Ip')
if [ -z "$B139_200" ]; then
  # server tanpa dist (CI job API-only) tak punya build id — tak ada yang diuji
  ok "304: build id — dilewati, server tanpa dist frontend"
else
  cek "304 membawa X-Kakarut-Build sama dgn 200 (anti-loop 'Ada pembaruan')" "V == 1" \
    "$([ "$B139_200" = "$B139_304" ] && echo 1 || echo 0)"
fi

# Regresi nol: hanya GET yang disentuh, dan sub-jalur tidak ikut tercakup.
cek "POST /kategori tetap 201 (middleware hanya GET)" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/kategori" \
      -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
      -d '{"nama":"Kategori ETag 139b","sort_order":98}')"
cek "GET /menu/ketersediaan TIDAK ber-ETag (berubah tiap penjualan)" "V == 1" \
  "$([ -z "$(etag_of "$OWNER" /menu/ketersediaan)" ] && echo 1 || echo 0)"
cek "GET /menu tanpa If-None-Match tetap 200 berbadan (klien lama)" "V == 1" \
  "$(api "$OWNER" GET /menu | jq 'length>0|if . then 1 else 0 end')"
echo "== 140. Transfer stok: HANYA Central Kitchen yang boleh mengirim =="
# Arah stok satu pintu — cabang (termasuk divisi kitchen/bar) hanya MELIHAT apa
# yang sedang dikirim ke sana. Ditegakkan pada ASAL, bukan pada peran, supaya
# owner sekalipun tak bisa mengirim antar-toko lewat jalur ini.
CK140=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="central_kitchen")][0].id')
TOKO140=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="store")][0].id')
TOKO140B=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="store")][1].id')
ING140=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$TOKO140" | jq -r '.rows[0].ingredient_id // ""')
cek "dasar uji: ada CK + dua toko" "V == 1" \
  "$([ -n "$CK140" ] && [ -n "$TOKO140" ] && [ -n "$TOKO140B" ] && echo 1 || echo 0)"

# Owner pun ditolak saat ASAL bukan CK — inti aturannya.
if [ -n "$ING140" ]; then
  cek "owner kirim transfer DARI toko → 403" "V == 403" \
    "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$TOKO140\",\"tujuan_branch_id\":\"$TOKO140B\",\"items\":[{\"ingredient_id\":\"$ING140\",\"qty\":1}]}")"
else
  # toko tanpa stok siap kirim: pakai bahan mana pun — guard ASAL dinilai
  # SEBELUM pemeriksaan saldo, jadi hasilnya tetap 403 (bukan 400 stok kurang).
  ING140X=$(api "$OWNER" GET /bahan?ringkas=1 | jq -r '[.[]|select(.lacak_stok)][0].id')
  cek "owner kirim transfer DARI toko → 403" "V == 403" \
    "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$TOKO140\",\"tujuan_branch_id\":\"$TOKO140B\",\"items\":[{\"ingredient_id\":\"$ING140X\",\"qty\":1}]}")"
fi

# Divisi produksi cabang: bar & kitchen tak boleh mengirim sama sekali.
BRC140=$(api "$TBAR" GET /auth/me | jq -r '.branch.id // .branch_id // ""')
ING140B=$(api "$TBAR" GET /transfer-stok/saldo | jq -r '.rows[0].ingredient_id // ""')
if [ -n "$BRC140" ] && [ -n "$ING140B" ]; then
  cek "bar kirim transfer dari cabangnya → 403" "V == 403" \
    "$(status_code_body "$TBAR" POST /transfer-stok "{\"asal_branch_id\":\"$BRC140\",\"tujuan_branch_id\":\"$CK140\",\"items\":[{\"ingredient_id\":\"$ING140B\",\"qty\":1}]}")"
fi
cek "bar kirim transfer DARI CK (bukan cabangnya) → 403" "V == 403" \
  "$(status_code_body "$TBAR" POST /transfer-stok "{\"asal_branch_id\":\"$CK140\",\"tujuan_branch_id\":\"$TOKO140\",\"items\":[{\"ingredient_id\":\"$ING132\",\"qty\":1}]}")"

# MELIHAT tetap terbuka untuk semua peran cabang — itu gunanya halaman ini.
cek "bar boleh MELIHAT daftar transfer (200)" "V == 200" "$(status_code "$TBAR" GET /transfer-stok)"
cek "kitchen boleh MELIHAT daftar transfer (200)" "V == 200" "$(status_code "$TKIT" GET /transfer-stok)"
cek "kasir boleh MELIHAT daftar transfer (200)" "V == 200" "$(status_code "$REISS105" GET /transfer-stok)"
cek "daftar transfer utk bar hanya yang menyangkut cabangnya" "V == 1" \
  "$(api "$TBAR" GET /transfer-stok | jq --arg b "$BRC140" '[.rows[]|select(.asal_branch_id!=$b and .tujuan_branch_id!=$b)]|length==0|if . then 1 else 0 end')"

# Regresi nol: CK → cabang tetap jalan. Saldo dibaca ULANG di sini — §132 sudah
# memakai sebagian stok CK, jadi memakai ING132 apa adanya bisa gagal 400 karena
# stok kurang dan menyamar seolah aturan barunya yang menolak.
SLD140=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK140")
# Bahan wajib-kelipatan (§148) dilewati: qty 1 akan ditolak aturan kemasan, dan
# yang diuji di sini adalah izin ASAL, bukan kemasan.
ING140C=$(echo "$SLD140" | jq -r '[.rows[]|select((.saldo - .dalam_jalan) >= 1 and (.wajib_kelipatan|not))][0].ingredient_id // ""')
cek "dasar uji: CK masih punya bahan siap kirim" "V == 1" \
  "$([ -n "$ING140C" ] && echo 1 || echo 0)"
cek "regresi nol: CK → cabang tetap 201" "V == 201" \
  "$(status_code_body "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$CK140\",\"tujuan_branch_id\":\"$TOKO140\",\"items\":[{\"ingredient_id\":\"$ING140C\",\"qty\":1}]}")"

echo "== 141. Sesi menyusul perubahan peran (tanpa login ulang) =="
# Admin mengubah peran karyawan SAAT sesinya berjalan. Token tetap sah — server
# membaca ulang keanggotaan tiap request — jadi /auth/me wajib melaporkan peran
# TERKINI. Web memakai endpoint ini untuk menyegarkan sesi tersimpan; tanpa itu
# menu sidebar memakai peran lama sampai karyawan logout (pernah terjadi: akun
# yang sudah dijadikan "bar" tak melihat Produksi/Resep di HP).
CAB141=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="store")][0].id')
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Peran Uji 141\",\"email\":\"peran141@basooopa.id\",\"password\":\"Peran141!\",\"role\":\"cashier\",\"branch_id\":\"$CAB141\"}" > /dev/null
UID141=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.email=="peran141@basooopa.id")][0].user_id // ""')
SESI141=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"peran141@basooopa.id","password":"Peran141!"}')
T141=$(echo "$SESI141" | jq -r '.token // ""')
cek "login karyawan uji berhasil" "V == 1" "$([ -n "$T141" ] && echo 1 || echo 0)"

# Bentuk /auth/me harus sama dengan hasil login (minus token) supaya klien bisa
# menimpakannya langsung ke sesi tersimpan.
ME141=$(api "$T141" GET /auth/me)
cek "/auth/me memuat user+company+branch" "V == 1" \
  "$(echo "$ME141" | jq '((.user|type=="object") and (has("company")) and (has("branch")))|if . then 1 else 0 end')"
cek "/auth/me branch = cabang keanggotaan" "V == 1" \
  "$(echo "$ME141" | jq --arg b "$CAB141" '(.branch.id == $b and ((.branch.nama|length) > 0))|if . then 1 else 0 end')"
cek "/auth/me peran awal = cashier" "V == 1" \
  "$(echo "$ME141" | jq '.user.role == "cashier"|if . then 1 else 0 end')"

cek "owner ubah peran → bar (200)" "V == 200" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UID141" '{"role":"bar"}')"
# Token LAMA, tanpa login ulang.
ME141B=$(api "$T141" GET /auth/me)
cek "/auth/me lapor peran BARU dgn token lama" "V == 1" \
  "$(echo "$ME141B" | jq '.user.role == "bar"|if . then 1 else 0 end')"
cek "token lama tetap sah (peran diganti ≠ sesi dicabut)" "V == 200" \
  "$(status_code "$T141" GET /cabang)"

# Pindah cabang juga harus tersusul (web memakai branch_id utk mengunci lokasi).
CAB141B=$(api "$OWNER" GET /cabang | jq -r --arg a "$CAB141" '[.[]|select(.is_active and .tipe=="store" and .id!=$a)][0].id // ""')
if [ -n "$CAB141B" ]; then
  api "$OWNER" PATCH "/karyawan/$UID141" "{\"branch_id\":\"$CAB141B\"}" > /dev/null
  ME141C=$(api "$T141" GET /auth/me)
  cek "/auth/me menyusul pindah cabang" "V == 1" \
    "$(echo "$ME141C" | jq --arg b "$CAB141B" '(.user.branch_id == $b and .branch.id == $b)|if . then 1 else 0 end')"
else
  ok "pindah cabang — dilewati, hanya ada satu cabang store"
fi

# Keanggotaan dicabut → 401, sehingga klien menendang ke halaman login alih-alih
# memakai sesi basi selamanya.
api "$OWNER" PATCH "/karyawan/$UID141" '{"arsip":true}' > /dev/null
cek "keanggotaan diarsip → /auth/me 401" "V == 401" "$(status_code "$T141" GET /auth/me)"

echo "== 142. Log galat platform (super admin) =="
# Setiap respons error yang keluar lewat app.onError dicatat — 5xx (bug) MAUPUN
# 4xx (penolakan). Daftarnya dikelompokkan per sidik jari supaya satu masalah
# yang terjadi ribuan kali tak jadi ribuan baris.
cek "guard: owner (bukan super admin) GET /admin/error-log → 403" "V == 403" \
  "$(status_code "$OWNER" GET /admin/error-log)"
cek "guard: tanpa token → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/error-log")"

# Mulai dari nol supaya angka bisa diuji pasti.
#
# Jeda SEBELUM menghapus, dan itu bukan hiasan. Pencatatan galat sengaja tidak
# ditunggu (`void` di `app.onError`) — bagian ini sendiri mengakuinya dua puluh
# baris di bawah, dengan `sleep 1` sebelum MEMBACA. Yang luput: dua asersi
# guard tepat di atas ini (403 owner-bukan-super-admin dan 401 tanpa token)
# JUGA melahirkan catatan, lewat jalur tak-ditunggu yang sama.
#
# Tanpa jeda ini, salah satu tulisan itu bisa mendarat SESUDAH DELETE-nya, dan
# "daftar kosong" melihat 1. Persis itu yang terjadi di CI: 1997 lolos, 1
# gagal, nilainya 1 — satu penyintas, bukan pola. Hapus-lalu-baca yang balapan
# dengan tulisannya sendiri akan gagal sesekali selamanya.
sleep 1
api "$SA" DELETE /admin/error-log > /dev/null
cek "bersihkan log → daftar kosong" "V == 0" \
  "$(api "$SA" GET "/admin/error-log?hari=30&status=semua" | jq '.total')"

# Picu 4xx yang pasti: bahan dengan id sah tapi tak ada → 404 dari handler.
NIHIL142=00000000-0000-0000-0000-000000000000
api "$OWNER" GET "/bahan/$NIHIL142/supplier" > /dev/null
api "$OWNER" GET "/bahan/$NIHIL142/supplier" > /dev/null
# Peran salah → 403 (kasir tak boleh melihat laporan). Pakai token kasir yang
# DITERBITKAN ULANG di §105 — token awal sudah batal sejak passwordnya diubah.
api "$REISS105" GET /laporan/ringkas > /dev/null
sleep 1  # pencatatan sengaja tidak ditunggu (void) — beri waktu menulis

LOG142=$(api "$SA" GET "/admin/error-log?hari=1&status=semua")
cek "galat tercatat (total >= 3)" "V == 1" \
  "$(echo "$LOG142" | jq '(.total>=3)|if . then 1 else 0 end')"
cek "4xx terhitung, 5xx nol" "V == 1" \
  "$(echo "$LOG142" | jq '(.total_4xx>=3) and (.total_5xx==0)|if . then 1 else 0 end')"

# Dua panggilan 404 yang sama = SATU kelompok berjumlah 2.
cek "dua 404 identik jadi satu kelompok (jumlah 2)" "V == 1" \
  "$(echo "$LOG142" | jq '[.rows[]|select(.status==404 and .jumlah==2)]|length>=1|if . then 1 else 0 end')"
# UUID pada jalur dinormalkan → :id, bukan id mentah.
cek "jalur dinormalkan jadi pola :id" "V == 1" \
  "$(echo "$LOG142" | jq '[.rows[]|select(.jalur_pola=="/api/bahan/:id/supplier")]|length>=1|if . then 1 else 0 end')"
cek "kelompok membawa pelapor & perusahaan" "V == 1" \
  "$(echo "$LOG142" | jq '[.rows[]|select(.jumlah_user>=1 and .jumlah_perusahaan>=1)]|length>=1|if . then 1 else 0 end')"

# Saringan status.
cek "saring 5xx → kosong (belum ada bug server)" "V == 0" \
  "$(api "$SA" GET "/admin/error-log?hari=1&status=5xx" | jq '.rows|length')"
cek "saring 4xx → ada isinya" "V == 1" \
  "$(api "$SA" GET "/admin/error-log?hari=1&status=4xx" | jq '(.rows|length)>0|if . then 1 else 0 end')"
cek "pencarian q= menyaring" "V == 1" \
  "$(api "$SA" GET "/admin/error-log?hari=1&q=bahan" | jq '. as $r | (($r.rows|length) > 0) and (([$r.rows[]|select((.pesan|ascii_downcase|contains("bahan")) or (.jalur_pola|contains("bahan")))]|length) == ($r.rows|length)) | if . then 1 else 0 end')"

# Detail kelompok: kronologi mentah + identitas pelapor.
SIDIK142=$(echo "$LOG142" | jq -r '[.rows[]|select(.jalur_pola=="/api/bahan/:id/supplier")][0].sidik')
DET142=$(api "$SA" GET "/admin/error-log/$SIDIK142?hari=1")
cek "detail kelompok memuat kejadian mentah" "V == 1" \
  "$(echo "$DET142" | jq '(.kelompok.sidik!=null) and ((.kejadian|length)>=2)|if . then 1 else 0 end')"
cek "kejadian membawa jalur ASLI (bukan pola)" "V == 1" \
  "$(echo "$DET142" | jq --arg n "$NIHIL142" '[.kejadian[]|select(.jalur|contains($n))]|length>=1|if . then 1 else 0 end')"
cek "4xx TANPA jejak tumpukan (bukan bug, cuma penolakan)" "V == 1" \
  "$(echo "$DET142" | jq '[.kejadian[]|select(.stack!=null)]|length==0|if . then 1 else 0 end')"
cek "sidik tak dikenal → 404" "V == 404" \
  "$(status_code "$SA" GET "/admin/error-log/tidakada123?hari=1")"

# Query string TIDAK disimpan — tautan verifikasi & reset membawa token di sana.
api "$OWNER" GET "/bahan/$NIHIL142/supplier?rahasia=jangan-disimpan" > /dev/null
sleep 1
cek "query string tidak ikut tercatat" "V == 0" \
  "$(api "$SA" GET "/admin/error-log/$SIDIK142?hari=1" | jq '[.kejadian[]|select(.jalur|contains("rahasia"))]|length')"

# Jalur API yang tak cocok rute mana pun tidak melewati app.onError — pernah
# luput sama sekali dari log. Klien yang memanggil endpoint usang justru hal
# yang paling perlu terlihat.
api "$OWNER" GET "/endpoint-yang-tidak-ada-142" > /dev/null
sleep 1
cek "endpoint tak dikenal ikut tercatat" "V == 1" \
  "$(api "$SA" GET "/admin/error-log?hari=1&status=4xx" | jq '[.rows[]|select(.jalur_pola=="/api/endpoint-yang-tidak-ada-142" and .status==404)]|length>=1|if . then 1 else 0 end')"

cek "pangkas manual → 200" "V == 200" "$(status_code "$SA" POST /admin/error-log/pangkas)"

echo "== 143. Pengajuan cuti/libur + rekap absen bulanan =="
# Sebelum ini, ketidakhadiran = tidak ada baris di attendances — tak terbedakan
# antara alpa, cuti, dan libur yang memang disepakati. Pengajuan DISETUJUI-lah
# yang mengubah sebuah tanggal dari "alpa" jadi "cuti"/"libur" di rekap.
# Zona waktu WAJIB sama dengan server (Asia/Jakarta). Dengan `date` polos,
# skrip memakai UTC sementara rekap memakai WIB — dari jam 00:00–07:00 WIB
# keduanya berbeda BULAN, dan seluruh blok ini gagal tanpa ada yang rusak.
BULAN143=$(TZ=Asia/Jakarta date +%Y-%m)
# Tanggal cuti WAJIB bukan hari ini, dan itu bukan kerewelan.
#
# Rekap menilai tiap tanggal berurutan: ada cap absen → HADIR; baru sesudah itu
# cuti/libur yang disetujui. Cap MENANG, dan itu memang aturannya (orang yang
# tetap masuk saat punya izin sakit memang hadir). Sementara kasir uji ini
# WAJIB absen masuk lebih dulu — gerbang buka-kasir menuntutnya — jadi hari ini
# selalu punya cap absen atas namanya.
#
# Dengan tanggal dipatok mati "05/06", blok ini lolos 29 hari sebulan lalu
# gagal pada tanggal 5: harinya terbaca 'hadir', `cuti` tinggal 1, dan dua
# asersi di bawah merah tanpa ada satu pun kode yang rusak. Persis itu yang
# terjadi — lolos 3 Agustus (tanggal 5 masih di masa depan), merah 5 Agustus.
# Tiga tanggal, dan ketiganya harus SALING EKSKLUSIF — bukan kebetulan:
# server menolak pengajuan yang bertindih dengan pengajuan hidup milik orang
# yang sama (409). Libur mingguan di bawah dibuat SESUDAH cuti di atas
# disetujui, jadi kalau tanggalnya bersinggungan, pembuatannya gagal, `.id`
# jadi kosong, dan DELETE atas id kosong membalas 400 — bukan 403/200 yang
# diuji. `L143` karena itu ikut bergeser bersama pasangan cutinya.
HARI143=$(TZ=Asia/Jakarta date +%d)
if [ "$HARI143" = "05" ] || [ "$HARI143" = "06" ]; then
  M143="$BULAN143-20"; S143="$BULAN143-21"; L143="$BULAN143-07"
else
  M143="$BULAN143-05"; S143="$BULAN143-06"; L143="$BULAN143-20"
fi

cek "guard: tanpa token → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/pengajuan")"
cek "guard: kasir GET /absensi/rekap → 403 (setara laporan)" "V == 403" \
  "$(status_code "$REISS105" GET /absensi/rekap)"
cek "owner GET /absensi/rekap → 200" "V == 200" "$(status_code "$OWNER" GET /absensi/rekap)"

# Kasir mengajukan — jenis DITURUNKAN server dari kategori, tak dikirim klien.
P143=$(api "$REISS105" POST /pengajuan \
  "{\"kategori\":\"sakit\",\"tanggal_mulai\":\"$M143\",\"tanggal_selesai\":\"$S143\",\"alasan\":\"demam\"}")
PID143=$(echo "$P143" | jq -r '.id // ""')
cek "kasir ajukan cuti sakit 2 hari → tercatat" "V == 1" \
  "$(echo "$P143" | jq '((.jenis=="cuti") and (.kategori=="sakit") and (.jumlah_hari==2) and (.status=="menunggu"))|if . then 1 else 0 end')"

cek "kategori ngawur → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST /pengajuan "{\"kategori\":\"ngasal\",\"tanggal_mulai\":\"$M143\",\"tanggal_selesai\":\"$M143\"}")"
cek "selesai sebelum mulai → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST /pengajuan "{\"kategori\":\"izin\",\"tanggal_mulai\":\"$S143\",\"tanggal_selesai\":\"$M143\"}")"
cek "rentang > 100 hari → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST /pengajuan "{\"kategori\":\"melahirkan\",\"tanggal_mulai\":\"2026-01-01\",\"tanggal_selesai\":\"2026-12-31\"}")"
cek "bertindih dgn pengajuan sendiri → 409" "V == 409" \
  "$(status_code_body "$REISS105" POST /pengajuan "{\"kategori\":\"izin\",\"tanggal_mulai\":\"$S143\",\"tanggal_selesai\":\"$S143\"}")"

# Pengajuan memuat alasan pribadi (mis. sakit) → peran terkunci cabang hanya
# boleh melihat MILIKNYA, tak seperti daftar absensi yang terbuka se-cabang.
UID143=$(echo "$P143" | jq -r .user_id)
cek "kasir hanya melihat pengajuan sendiri" "V == 1" \
  "$(api "$REISS105" GET /pengajuan | jq --arg u "$UID143" '[.[]|select(.user_id != $u)]|length==0|if . then 1 else 0 end')"

cek "kasir PATCH (ACC sendiri) → 403" "V == 403" \
  "$(status_code_body "$REISS105" PATCH "/pengajuan/$PID143" '{"status":"disetujui"}')"
cek "tolak tanpa alasan → 400" "V == 400" \
  "$(status_code_body "$OWNER" PATCH "/pengajuan/$PID143" '{"status":"ditolak"}')"
cek "owner setujui → disetujui + tercatat pemutusnya" "V == 1" \
  "$(api "$OWNER" PATCH "/pengajuan/$PID143" '{"status":"disetujui"}' | jq '((.status=="disetujui") and ((.diputus_oleh|length)>0) and (.diputus_pada!=null))|if . then 1 else 0 end')"
cek "putuskan dua kali → 409" "V == 409" \
  "$(status_code_body "$OWNER" PATCH "/pengajuan/$PID143" '{"status":"ditolak","alasan_tolak":"berubah pikiran"}')"

# REKAP: cuti yang disetujui harus tampak sebagai status per-tanggal.
RK143=$(api "$OWNER" "GET" "/absensi/rekap?bulan=$BULAN143&branch_id=all")
cek "rekap: bulan & jumlah hari benar" "V == 1" \
  "$(echo "$RK143" | jq --arg b "$BULAN143" '((.bulan==$b) and (.hari>=28) and (.hari<=31) and (.hari_terhitung>=0))|if . then 1 else 0 end')"
cek "rekap: panjang harian == jumlah hari bulan" "V == 1" \
  "$(echo "$RK143" | jq '(.hari) as $h | [.rows[]|select((.harian|length) != $h)]|length==0|if . then 1 else 0 end')"
cek "rekap: kasir tercatat cuti 2 hari" "V == 1" \
  "$(echo "$RK143" | jq --arg u "$UID143" '[.rows[]|select(.user_id==$u and .cuti==2)]|length==1|if . then 1 else 0 end')"
cek "rekap: tanggal cuti berstatus 'cuti' + kategori sakit" "V == 1" \
  "$(echo "$RK143" | jq --arg u "$UID143" --arg t "$M143" '[.rows[]|select(.user_id==$u)|.harian[]|select(.tanggal==$t and .status=="cuti" and .kategori=="sakit")]|length==1|if . then 1 else 0 end')"
cek "rekap: tanggal cuti TIDAK dihitung tidak hadir" "V == 1" \
  "$(echo "$RK143" | jq '(.hari) as $h | [.rows[]|select((.hadir + .tidak_hadir + .cuti + .libur) > $h)]|length==0|if . then 1 else 0 end')"
# Tanggal masa depan tak pernah dinilai — jendela hitung berhenti di hari ini.
cek "rekap: tanggal setelah hari ini berstatus 'kosong'" "V == 1" \
  "$(echo "$RK143" | jq --arg t "$(TZ=Asia/Jakarta date -d '+3 days' +%Y-%m-%d 2>/dev/null || TZ=Asia/Jakarta date +%Y-%m-%d)" '[.rows[]|.harian[]|select(.tanggal==$t and .status=="alpa")]|length==0|if . then 1 else 0 end')"
cek "rekap: bulan tak valid → jatuh ke bulan berjalan" "V == 1" \
  "$(api "$OWNER" GET "/absensi/rekap?bulan=ngawur" | jq --arg b "$BULAN143" '.bulan==$b|if . then 1 else 0 end')"

# Batalkan: pemohon hanya boleh saat masih menunggu; orang lain tak boleh sama sekali.
P143B=$(api "$REISS105" POST /pengajuan \
  "{\"kategori\":\"mingguan\",\"tanggal_mulai\":\"$L143\",\"tanggal_selesai\":\"$L143\"}")
cek "libur mingguan → jenis 'libur' (diturunkan server)" "V == 1" \
  "$(echo "$P143B" | jq '.jenis=="libur"|if . then 1 else 0 end')"
PID143B=$(echo "$P143B" | jq -r .id)
cek "karyawan lain batalkan punya orang → 403" "V == 403" \
  "$(status_code "$TKIT" DELETE "/pengajuan/$PID143B")"
cek "pemohon batalkan saat menunggu → 200" "V == 200" \
  "$(status_code "$REISS105" DELETE "/pengajuan/$PID143B")"
cek "pemohon batalkan yg sudah disetujui → 409" "V == 409" \
  "$(status_code "$REISS105" DELETE "/pengajuan/$PID143")"
# Saringan aktif/arsip: karyawan yang sudah keluar tak boleh mengotori daftar
# maupun angka "total tidak hadir" — tapi tetap bisa dilihat bila diminta.
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Keluar Uji 143\",\"email\":\"keluar143@basooopa.id\",\"password\":\"Keluar143!\",\"role\":\"admin\"}" > /dev/null
UIDK143=$(api "$OWNER" GET /karyawan | jq -r '[.[]|select(.email=="keluar143@basooopa.id")][0].user_id // ""')
cek "karyawan uji muncul di rekap saat masih aktif" "V == 1" \
  "$(api "$OWNER" GET "/absensi/rekap?bulan=$BULAN143&branch_id=all" | jq --arg u "$UIDK143" '[.rows[]|select(.user_id==$u)]|length==1|if . then 1 else 0 end')"
cek "arsipkan karyawan uji → 200" "V == 200" \
  "$(status_code_body "$OWNER" PATCH "/karyawan/$UIDK143" '{"arsip":true}')"

AKTIF143=$(api "$OWNER" GET "/absensi/rekap?bulan=$BULAN143&branch_id=all&status=aktif")
ARSIP143=$(api "$OWNER" GET "/absensi/rekap?bulan=$BULAN143&branch_id=all&status=arsip")
SEMUA143=$(api "$OWNER" GET "/absensi/rekap?bulan=$BULAN143&branch_id=all&status=semua")
cek "status=aktif: yang sudah keluar hilang dari rekap" "V == 0" \
  "$(echo "$AKTIF143" | jq --arg u "$UIDK143" '[.rows[]|select(.user_id==$u)]|length')"
cek "TANPA status= (bawaan) sama dengan status=aktif" "V == 1" \
  "$(api "$OWNER" GET "/absensi/rekap?bulan=$BULAN143&branch_id=all" | jq --argjson n "$(echo "$AKTIF143" | jq '.rows|length')" '(.rows|length)==$n|if . then 1 else 0 end')"
cek "status=arsip: yang keluar muncul + membawa arsip_pada" "V == 1" \
  "$(echo "$ARSIP143" | jq --arg u "$UIDK143" '[.rows[]|select(.user_id==$u and .arsip_pada!=null)]|length==1|if . then 1 else 0 end')"
cek "status=arsip: karyawan aktif TIDAK ikut" "V == 1" \
  "$(echo "$ARSIP143" | jq '[.rows[]|select(.arsip_pada==null)]|length==0|if . then 1 else 0 end')"
cek "status=semua: gabungan keduanya" "V == 1" \
  "$(echo "$SEMUA143" | jq --arg u "$UIDK143" --argjson n "$(echo "$AKTIF143" | jq '.rows|length')" '(([.rows[]|select(.user_id==$u)]|length)==1) and ((.rows|length) > $n)|if . then 1 else 0 end')"
cek "status ngawur → jatuh ke bawaan aktif" "V == 1" \
  "$(api "$OWNER" GET "/absensi/rekap?bulan=$BULAN143&branch_id=all&status=ngasal" | jq --argjson n "$(echo "$AKTIF143" | jq '.rows|length')" '(.rows|length)==$n|if . then 1 else 0 end')"
# Bulan SEBELUM ia bergabung: tak punya hari kerja di sana → tak usah muncul.
cek "bulan lampau: karyawan yang belum bergabung tak muncul" "V == 0" \
  "$(api "$OWNER" GET "/absensi/rekap?bulan=2020-01&branch_id=all&status=semua" | jq --arg u "$UIDK143" '[.rows[]|select(.user_id==$u)]|length')"

echo
echo "== 144. Laporan kebersihan harian (checklist area + foto wajib + rekap owner) =="
# Master area: satu berlaku semua lokasi, satu khusus store, satu khusus CK.
# Yang khusus CK tak boleh terlihat/dipakai karyawan store.
AR144_UMUM=$(api "$OWNER" POST /kebersihan/area '{"nama":"Lantai Depan 144","urutan":0}' | jq -r .id)
AR144_STORE=$(api "$OWNER" POST /kebersihan/area "{\"nama\":\"Toilet 144\",\"branch_id\":\"$CB46_ID\",\"urutan\":1}" | jq -r .id)
AR144_CK=$(api "$OWNER" POST /kebersihan/area "{\"nama\":\"Chiller CK 144\",\"branch_id\":\"$CK52_UTAMA\",\"urutan\":2}" | jq -r .id)
cek "owner buat 3 area kebersihan" "V == 1" \
  "$([ -n "$AR144_UMUM" ] && [ -n "$AR144_STORE" ] && [ -n "$AR144_CK" ] && echo 1 || echo 0)"
cek "karyawan tak boleh buat area → 403" "V == 403" \
  "$(status_code_body "$TKIT" POST /kebersihan/area '{"nama":"Nakal 144"}')"

AREA144=$(api "$TKIT" GET /kebersihan/area)
cek "kitchen store: area umum + area cabangnya terlihat" "V == 1" \
  "$(echo "$AREA144" | jq --arg a "$AR144_UMUM" --arg b "$AR144_STORE" '(([.[]|select(.id==$a)]|length)==1) and (([.[]|select(.id==$b)]|length)==1)|if . then 1 else 0 end')"
cek "kitchen store: area khusus CK TIDAK terlihat" "V == 0" \
  "$(echo "$AREA144" | jq --arg a "$AR144_CK" '[.[]|select(.id==$a)]|length')"

# Foto wajib: satu laporan harus membawa minimal satu bukti.
BODY144_TANPA="{\"sesi\":\"pagi\",\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true},{\"area_id\":\"$AR144_STORE\",\"bersih\":false,\"catatan\":\"masih bau\"}]}"
cek "laporan tanpa foto → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /kebersihan "$BODY144_TANPA")"
cek "checklist kosong → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /kebersihan '{"sesi":"pagi","items":[]}')"
# Area milik cabang lain tak boleh dipakai walau id-nya ditebak.
cek "pakai area khusus CK dari store → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /kebersihan "{\"sesi\":\"pagi\",\"items\":[{\"area_id\":\"$AR144_CK\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144.jpg\"}]}")"

# `tanggal` dikirim ngawur oleh klien — server WAJIB mengabaikannya.
BODY144="{\"sesi\":\"pagi\",\"tanggal\":\"2020-01-01\",\"catatan\":\"sabun habis\",\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144a.jpg\"},{\"area_id\":\"$AR144_STORE\",\"bersih\":false,\"catatan\":\"masih bau\"}]}"
LAP144=$(api "$TKIT" POST /kebersihan "$BODY144")
LID144=$(echo "$LAP144" | jq -r '.id // ""')
cek "laporan sesi pagi dengan foto → tersimpan" "V == 1" \
  "$([ -n "$LID144" ] && echo 1 || echo 0)"
cek "tanggal diturunkan server (abaikan kiriman klien)" "V == 1" \
  "$(echo "$LAP144" | jq --arg t "$(TZ=Asia/Jakarta date +%F)" '.tanggal==$t|if . then 1 else 0 end')"
cek "hitungan area: 2 total, 1 bersih, 1 kotor, 1 foto" "V == 1" \
  "$(echo "$LAP144" | jq '((.total_area==2) and (.area_bersih==1) and (.area_kotor==1) and (.jumlah_foto==1))|if . then 1 else 0 end')"
cek "nama area disalin ke baris laporan (snapshot)" "V == 1" \
  "$(echo "$LAP144" | jq '[.items[]|select(.area_nama=="Toilet 144" and .bersih==false)]|length==1|if . then 1 else 0 end')"
cek "sesi pagi kedua di hari yang sama → 409" "V == 409" \
  "$(status_code_body "$TKIT" POST /kebersihan "$BODY144")"
LAP144B=$(api "$TKIT" POST /kebersihan "{\"sesi\":\"malam\",\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144b.jpg\"}]}")
cek "sesi berbeda di hari yang sama → boleh" "V == 1" \
  "$(echo "$LAP144B" | jq '.sesi=="malam"|if . then 1 else 0 end')"
cek "sesi ngawur → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /kebersihan "{\"sesi\":\"subuh\",\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/x.jpg\"}]}")"

# Area yang sudah DINONAKTIFKAN owner tak boleh lagi masuk laporan. Tanpa
# penjaga di jalur tulis, tablet yang cache daftarnya belum segar tetap bisa
# mengirimnya dan `total_area` di rekap ikut menghitung area yang dipensiunkan.
AR144_MATI=$(api "$OWNER" POST /kebersihan/area '{"nama":"Gudang Lama 144","urutan":3}' | jq -r .id)
api "$OWNER" PATCH "/kebersihan/area/$AR144_MATI" '{"is_active":false}' > /dev/null
cek "area nonaktif hilang dari daftar karyawan" "V == 0" \
  "$(api "$TKIT" GET /kebersihan/area | jq --arg a "$AR144_MATI" '[.[]|select(.id==$a)]|length')"
cek "lapor memakai area nonaktif → 400" "V == 400" \
  "$(status_code_body "$TKIT" POST /kebersihan "{\"sesi\":\"siang\",\"items\":[{\"area_id\":\"$AR144_MATI\",\"bersih\":true,\"foto_url\":\"/uploads/x.jpg\"}]}")"

# Laporan itu penilaian kerja — sesama karyawan tak boleh saling mengintip.
cek "karyawan lain tak melihat laporan orang" "V == 0" \
  "$(api "$TBAR" GET /kebersihan | jq --arg i "$LID144" '[.[]|select(.id==$i)]|length')"
cek "karyawan lain buka detail → 404" "V == 404" \
  "$(status_code "$TBAR" GET "/kebersihan/$LID144")"
cek "pemilik melihat laporannya sendiri" "V == 1" \
  "$(api "$TKIT" GET /kebersihan | jq --arg i "$LID144" '[.[]|select(.id==$i)]|length==1|if . then 1 else 0 end')"
cek "owner melihat laporan semua tim" "V == 1" \
  "$(api "$OWNER" GET "/kebersihan?branch_id=all" | jq --arg i "$LID144" '[.[]|select(.id==$i)]|length==1|if . then 1 else 0 end')"
# `saya=1` menyempitkan ke pelapornya sendiri UNTUK SEMUA PERAN. Layar
# pengisian bergantung penuh pada ini: tanpa penanda tsb manajemen melihat
# laporan orang lain sebagai miliknya, kartu sesinya tertandai "sudah terisi",
# dan tombol Perbarui menunjuk laporan orang lain (ditolak 403).
cek "owner + saya=1 TIDAK memuat laporan karyawan lain" "V == 0" \
  "$(api "$OWNER" GET "/kebersihan?saya=1" | jq --arg i "$LID144" '[.[]|select(.id==$i)]|length')"
cek "pemilik + saya=1 tetap melihat laporannya sendiri" "V == 1" \
  "$(api "$TKIT" GET "/kebersihan?saya=1" | jq --arg i "$LID144" '[.[]|select(.id==$i)]|length==1|if . then 1 else 0 end')"
# branch_id ngawur masuk ke klausa WHERE kolom uuid → dulu 500, kini 400.
cek "daftar: branch_id bukan UUID → 400 (bukan 500)" "V == 400" \
  "$(status_code "$OWNER" GET "/kebersihan?branch_id=bukan-uuid")"

# Perbaikan: pemilik boleh mengganti isi selama masih hari yang sama.
cek "karyawan lain ubah laporan orang → 403" "V == 403" \
  "$(status_code_body "$TBAR" PATCH "/kebersihan/$LID144" "{\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/x.jpg\"}]}")"
cek "pemilik perbarui: semua area jadi bersih" "V == 1" \
  "$(api "$TKIT" PATCH "/kebersihan/$LID144" "{\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144a.jpg\"},{\"area_id\":\"$AR144_STORE\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144c.jpg\"}]}" | jq '((.area_kotor==0) and (.jumlah_foto==2))|if . then 1 else 0 end')"
cek "perbarui tanpa foto sama sekali → 400" "V == 400" \
  "$(status_code_body "$TKIT" PATCH "/kebersihan/$LID144" "{\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true}]}")"
# PATCH di atas TIDAK mengirim `catatan`. Field yang tak dikirim harus dibiarkan
# apa adanya: pernah `?.trim() || null` menulis NULL untuk `undefined`, jadi
# klien yang cuma membetulkan checklist ikut menghapus pesan karyawan ke owner.
cek "perbarui tanpa field catatan → catatan karyawan tetap utuh" "V == 1" \
  "$(api "$TKIT" GET "/kebersihan/$LID144" | jq '.catatan=="sabun habis"|if . then 1 else 0 end')"
cek "perbarui dengan catatan:null → catatan memang dikosongkan" "V == 1" \
  "$(api "$TKIT" PATCH "/kebersihan/$LID144" "{\"catatan\":null,\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144a.jpg\"}]}" | jq '.catatan==null|if . then 1 else 0 end')"

# BALAPAN PATCH — satu-satunya jalur yang bisa menggandakan checklist. Transaksi
# saja tak menutupnya: di READ COMMITTED yang kalah menghapus 0 baris (yang
# menang sudah menghapusnya) lalu tetap menyisipkan set lengkapnya. Yang
# menutupnya adalah indeks unik (report_id, area_id) dari migrasi 0091.
# Dua hasil sama-sama sah — keduanya 200 bila permintaannya kebetulan
# terserialkan, atau satu 409 bila benar-benar bertabrakan. Yang TIDAK boleh:
# 500, dan checklist berlipat.
RACE144="{\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/race-144.jpg\"}]}"
RC1=$(mktemp); RC2=$(mktemp)
curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/kebersihan/$LID144" \
  -H "Authorization: Bearer $TKIT" -H 'Content-Type: application/json' -d "$RACE144" > "$RC1" &
curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/kebersihan/$LID144" \
  -H "Authorization: Bearer $TKIT" -H 'Content-Type: application/json' -d "$RACE144" > "$RC2" &
wait
C1_144=$(cat "$RC1"); C2_144=$(cat "$RC2"); rm -f "$RC1" "$RC2"
cek "PATCH balapan: tiap respons 200 atau 409, tak ada 500" "V == 1" \
  "$( { [ "$C1_144" = "200" ] || [ "$C1_144" = "409" ]; } && { [ "$C2_144" = "200" ] || [ "$C2_144" = "409" ]; } && echo 1 || echo 0)"
cek "PATCH balapan: checklist tidak berlipat (tetap 1 baris)" "V == 1" \
  "$(api "$TKIT" GET "/kebersihan/$LID144" | jq '(.items|length)==1|if . then 1 else 0 end')"
# Kembalikan satu area jadi kotor + catatan semula supaya rekap & badge punya bahan uji.
api "$TKIT" PATCH "/kebersihan/$LID144" "{\"catatan\":\"sabun habis\",\"items\":[{\"area_id\":\"$AR144_UMUM\",\"bersih\":true,\"foto_url\":\"/uploads/bukti-144a.jpg\"},{\"area_id\":\"$AR144_STORE\",\"bersih\":false,\"catatan\":\"masih bau\"}]}" > /dev/null

# Catatan owner: hanya owner/admin, dan pelapor bisa membacanya.
cek "karyawan beri catatan owner → 403" "V == 403" \
  "$(status_code_body "$TKIT" PATCH "/kebersihan/$LID144/catatan" '{"catatan_owner":"tidak boleh"}')"
cek "owner beri catatan → tersimpan + tercatat penulisnya" "V == 1" \
  "$(api "$OWNER" PATCH "/kebersihan/$LID144/catatan" '{"catatan_owner":"Toilet tolong diulang"}' | jq '((.catatan_owner=="Toilet tolong diulang") and (.catatan_owner_oleh != null) and (.catatan_owner_pada != null))|if . then 1 else 0 end')"
cek "pelapor membaca catatan owner" "V == 1" \
  "$(api "$TKIT" GET "/kebersihan/$LID144" | jq '.catatan_owner=="Toilet tolong diulang"|if . then 1 else 0 end')"
cek "catatan dikosongkan → jejak penulis ikut bersih" "V == 1" \
  "$(api "$OWNER" PATCH "/kebersihan/$LID144/catatan" '{"catatan_owner":null}' | jq '((.catatan_owner==null) and (.catatan_owner_oleh==null) and (.catatan_owner_pada==null))|if . then 1 else 0 end')"
api "$OWNER" PATCH "/kebersihan/$LID144/catatan" '{"catatan_owner":"Toilet tolong diulang"}' > /dev/null

# Rekap: satu kotak satu hari, memuat laporan semua tim.
cek "karyawan buka rekap → 403" "V == 403" "$(status_code "$TKIT" GET /kebersihan/rekap)"
BULAN144=$(TZ=Asia/Jakarta date +%Y-%m)
HARI144=$(TZ=Asia/Jakarta date +%F)
RK144=$(api "$OWNER" GET "/kebersihan/rekap?bulan=$BULAN144&branch_id=all")
cek "rekap: bulan sesuai + hari terurut terbaru dulu" "V == 1" \
  "$(echo "$RK144" | jq --arg b "$BULAN144" --arg t "$HARI144" '((.bulan==$b) and (.hari[0].tanggal==$t))|if . then 1 else 0 end')"
cek "rekap: kotak hari ini memuat 2 laporan (pagi + malam)" "V == 1" \
  "$(echo "$RK144" | jq --arg t "$HARI144" '[.hari[]|select(.tanggal==$t)][0] | ((.total==2) and (.sesi.pagi==1) and (.sesi.malam==1) and (.sesi.siang==0))|if . then 1 else 0 end')"
cek "rekap: area kotor hari ini terhitung" "V == 1" \
  "$(echo "$RK144" | jq --arg t "$HARI144" '[.hari[]|select(.tanggal==$t)][0].area_kotor>=1|if . then 1 else 0 end')"
cek "rekap: baris ringkas membawa foto_utama + tanda catatan owner" "V == 1" \
  "$(echo "$RK144" | jq --arg i "$LID144" '[.hari[]|.laporan[]|select(.id==$i)][0] | ((.foto_utama != null) and (.ada_catatan_owner==true))|if . then 1 else 0 end')"
# Hari BOLONG adalah alasan rekap ini ada, jadi diuji dengan angka pasti:
# jumlah kotak = tanggal hari ini, dan semua hari SEBELUM hari ini kosong
# (tanggal laporan selalu diturunkan server, jadi tak ada laporan hari lain).
# Versi lama berbunyi `length>=0` — selalu benar, jadi tak menguji apa pun.
DOM144=$(TZ=Asia/Jakarta date +%-d)
cek "rekap: kotak = jumlah hari berjalan, hari tanpa laporan tetap tampil" "V == 1" \
  "$(echo "$RK144" | jq --argjson d "$DOM144" '(((.hari|length)==$d) and (([.hari[]|select(.total==0)]|length)==($d-1)))|if . then 1 else 0 end')"
cek "rekap: saring sesi=malam menyisakan laporan malam saja" "V == 1" \
  "$(api "$OWNER" GET "/kebersihan/rekap?bulan=$BULAN144&branch_id=all&sesi=malam" | jq '[.hari[]|.laporan[]|select(.sesi!="malam")]|length==0|if . then 1 else 0 end')"
cek "rekap: bulan ngawur → jatuh ke bulan berjalan" "V == 1" \
  "$(api "$OWNER" GET "/kebersihan/rekap?bulan=ngawur" | jq --arg b "$BULAN144" '.bulan==$b|if . then 1 else 0 end')"
# "ngawur" di atas GAGAL pola, jadi jalur amannya memang terpakai. Yang
# berbahaya justru nilai yang LOLOS pola tapi bukan bulan: "2026-13"/"2026-00"
# dulu dirakit jadi "2026-13-01" dan membuat Postgres melempar → 500, padahal
# kontrak menjanjikan jatuh ke bulan berjalan.
THN144=$(TZ=Asia/Jakarta date +%Y)
cek "rekap: bulan 13 → jatuh ke bulan berjalan (bukan 500)" "V == 1" \
  "$(api "$OWNER" GET "/kebersihan/rekap?bulan=$THN144-13" | jq --arg b "$BULAN144" '.bulan==$b|if . then 1 else 0 end')"
cek "rekap: bulan 00 → jatuh ke bulan berjalan (bukan 500)" "V == 1" \
  "$(api "$OWNER" GET "/kebersihan/rekap?bulan=$THN144-00" | jq --arg b "$BULAN144" '.bulan==$b|if . then 1 else 0 end')"
cek "rekap: branch_id bukan UUID → 400 (bukan 500)" "V == 400" \
  "$(status_code "$OWNER" GET "/kebersihan/rekap?branch_id=bukan-uuid")"
cek "ringkas: badge hari ini menghitung laporan berarea kotor" "V == 1" \
  "$(api "$OWNER" GET /kebersihan/ringkas | jq --arg t "$HARI144" '((.tanggal==$t) and (.total>=2) and (.kotor>=1))|if . then 1 else 0 end')"

# Master area boleh dihapus tanpa merusak riwayat — nama sudah disalin.
cek "hapus area master → 200" "V == 200" "$(status_code "$OWNER" DELETE "/kebersihan/area/$AR144_STORE")"
cek "laporan lama tetap menyebut nama area yang dihapus" "V == 1" \
  "$(api "$OWNER" GET "/kebersihan/$LID144" | jq '[.items[]|select(.area_nama=="Toilet 144" and .area_id==null)]|length==1|if . then 1 else 0 end')"

# Hapus punya aturan kepemilikan yang sama dengan ubah — dan dulu tak satu pun
# cabang penolakannya dijalankan uji, jadi refactor yang membalik kondisinya
# akan tetap lolos 39/39.
cek "karyawan lain hapus laporan orang → 403" "V == 403" \
  "$(status_code "$TBAR" DELETE "/kebersihan/$LID144")"
cek "pemilik hapus laporannya → 200" "V == 200" "$(status_code "$TKIT" DELETE "/kebersihan/$(echo "$LAP144B" | jq -r .id)")"
cek "owner hapus laporan siapa pun → 200" "V == 200" "$(status_code "$OWNER" DELETE "/kebersihan/$LID144")"
cek "laporan yang dihapus → 404" "V == 404" "$(status_code "$OWNER" GET "/kebersihan/$LID144")"

echo "== §145. Harga menu berubah sendiri: lacak, setop, perbaiki =="
# Skenario yang ditiru persis keluhan "harga menu tiba-tiba berubah":
# faktur belanja DIBUAT TANPA HARGA → `total_harga` barisnya diisi TEBAKAN
# yang diturunkan dari harga acuan saat itu. Dulu tebakan itu ikut kolam
# median saat "Laporan Harga", jadi acuan menyeret dirinya sendiri
# (acuan → tebakan → median → acuan) dan food cost SEMUA menu merangkak naik
# tanpa satu pun harga jual disentuh.
CAT145=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
BH145=$(api "$OWNER" POST /bahan '{"nama":"bahan uji145","harga_beli":10000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"baso"}' | jq -r .id)
MENU145=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji145\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":3,\"harga_jual\":60000,\"komponen\":[{\"ingredient_id\":\"$BH145\",\"qty\":1}]}")
MID145=$(echo "$MENU145" | jq -r .id)
harga_acuan145() { api "$OWNER" GET /bahan | jq --arg id "$BH145" '([.[]|select(.id==$id)][0].harga_beli|round)'; }
baris145() { api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$1" '[.rows[]|select(.faktur_id==$f)][0].id'; }
selesaikan145() { # <faktur_id> — majukan sampai stok masuk (dikonfirmasi)
  api "$OWNER" POST "/pembelian/tahap/$1" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$1" '{"ke":"menunggu"}' > /dev/null
  api "$OWNER" POST "/pembelian/konfirmasi/$1" > /dev/null 2>&1 || true
}

# --- §2 riwayat harga jual: baris pembuka + hanya dicatat saat harga berubah
cek "menu baru → riwayat harga punya baris pembuka 'buat'" "V == 1" \
  "$(api "$OWNER" GET "/menu/$MID145/riwayat-harga" | jq '[.[]|select(.sebab=="buat" and .harga_lama==null and .harga_baru==60000)]|length==1|if . then 1 else 0 end')"
BODY145_FOTO="{\"nama\":\"Menu Uji145\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":3,\"harga_jual\":60000,\"image_url\":\"/uploads/uji145.jpg\",\"komponen\":[{\"ingredient_id\":\"$BH145\",\"qty\":1}]}"
api "$OWNER" PUT "/menu/$MID145" "$BODY145_FOTO" > /dev/null
cek "ubah FOTO saja → riwayat harga TIDAK bertambah" "V == 1" \
  "$(api "$OWNER" GET "/menu/$MID145/riwayat-harga" | jq 'length==1|if . then 1 else 0 end')"
BODY145_HARGA="{\"nama\":\"Menu Uji145\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":3,\"harga_jual\":55000,\"image_url\":\"/uploads/uji145.jpg\",\"komponen\":[{\"ingredient_id\":\"$BH145\",\"qty\":1}]}"
api "$OWNER" PUT "/menu/$MID145" "$BODY145_HARGA" > /dev/null
cek "ubah harga jual → tercatat 'manual' 60000 → 55000" "V == 1" \
  "$(api "$OWNER" GET "/menu/$MID145/riwayat-harga" | jq '[.[]|select(.sebab=="manual" and .harga_lama==60000 and .harga_baru==55000)]|length==1|if . then 1 else 0 end')"
# $REISS105 = token kasir hasil re-issue di §105 ($KASIR sudah tak berlaku).
cek "kasir buka riwayat harga menu → 403" "V == 403" "$(status_code "$REISS105" GET "/menu/$MID145/riwayat-harga")"

# --- §3a kolam median: TEBAKAN tak boleh ikut menentukan harga acuan
# Faktur B dibuat tanpa harga saat acuan masih 10000 → tebakan 3 × 10000.
FB145=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BH145\",\"mode\":\"pcs\",\"jumlah\":3}]}" | jq -r .faktur_id)
selesaikan145 "$FB145"
ROWB145=$(baris145 "$FB145")
cek "faktur tanpa harga → baris berisi TEBAKAN 30000 (3 × acuan 10000)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWB145" '([.rows[]|select(.id==$r)][0] | (.total_harga==30000) and (.laporan_harga_at==null))|if . then 1 else 0 end')"
# Faktur A dilaporkan 40000 utk 2 pcs → 20000/satuan. Kalau tebakan ikut kolam,
# median jadi (10000+20000)/2 = 15000; dengan penyaringan yang benar → 20000.
FA145=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BH145\",\"mode\":\"pcs\",\"jumlah\":2}]}" | jq -r .faktur_id)
selesaikan145 "$FA145"
ROWA145=$(baris145 "$FA145")
api "$OWNER" POST "/pembelian/laporan-harga/$FA145" "{\"items\":[{\"id\":\"$ROWA145\",\"total_harga\":40000}]}" > /dev/null
cek "acuan = 20000 (bukan 15000 — tebakan tak menyeret acuan)" "V == 20000" "$(harga_acuan145)"
cek "baris tebakan tetap 30000 (tak ikut dilaporkan)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWB145" '([.rows[]|select(.id==$r)][0].total_harga==30000)|if . then 1 else 0 end')"

# --- §3b perbarui_acuan:false → nota tercatat, acuan tidak disentuh
FC145=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BH145\",\"mode\":\"pcs\",\"jumlah\":1}]}" | jq -r .faktur_id)
selesaikan145 "$FC145"
ROWC145=$(baris145 "$FC145")
api "$OWNER" POST "/pembelian/laporan-harga/$FC145" "{\"items\":[{\"id\":\"$ROWC145\",\"total_harga\":90000}],\"perbarui_acuan\":false}" > /dev/null
cek "perbarui_acuan:false → harga acuan tetap 20000" "V == 20000" "$(harga_acuan145)"
cek "perbarui_acuan:false → nota tetap tercatat di baris (90000)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg r "$ROWC145" '([.rows[]|select(.id==$r)][0] | (.total_harga==90000) and (.laporan_harga_at!=null))|if . then 1 else 0 end')"

# --- §3b pratinjau dampak: acuan lama→baru + menu yang menyeberang ambang
FD145=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BH145\",\"mode\":\"pcs\",\"jumlah\":1}]}" | jq -r .faktur_id)
selesaikan145 "$FD145"
ROWD145=$(baris145 "$FD145")
DMP145=$(api "$OWNER" POST "/pembelian/laporan-harga/$FD145/dampak" "{\"items\":[{\"id\":\"$ROWD145\",\"total_harga\":30000}]}")
# kolam terlapor jadi 20000 (A), 90000 (C), 30000 (D) → median 30000
cek "dampak: acuan 20000 → 30000, 1 menu memakai bahan ini" "V == 1" \
  "$(echo "$DMP145" | jq --arg i "$BH145" '[.bahan[]|select(.ingredient_id==$i)][0] | ((.acuan_lama==20000) and (.acuan_baru==30000) and (.jumlah_menu_terdampak==1))|if . then 1 else 0 end')"
cek "dampak: Menu Uji145 menyeberang ambang food cost" "V == 1" \
  "$(echo "$DMP145" | jq --arg m "$MID145" '[.menu_lewat_ambang[]|select(.menu_id==$m)]|length==1|if . then 1 else 0 end')"
cek "dampak: TIDAK menulis apa pun — acuan masih 20000" "V == 20000" "$(harga_acuan145)"
cek "kasir minta pratinjau dampak → 403" "V == 403" \
  "$(status_code_body "$REISS105" POST "/pembelian/laporan-harga/$FD145/dampak" "{\"items\":[{\"id\":\"$ROWD145\",\"total_harga\":1}]}")"
cek "dampak: baris bukan milik faktur → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST "/pembelian/laporan-harga/$FD145/dampak" "{\"items\":[{\"id\":\"$ROWA145\",\"total_harga\":1}]}")"

# --- §1 analisis harga: bukti bahwa yang bergerak adalah harga BAHAN
AN145=$(api "$OWNER" GET /menu/analisis-harga)
cek "analisis: baris menu memuat menu_diperbarui + ambang perusahaan" "V == 1" \
  "$(echo "$AN145" | jq --arg m "$MID145" '[.[]|select(.id==$m)][0] | ((.menu_diperbarui|type)=="string" and (.food_cost_maks==40))|if . then 1 else 0 end')"
cek "analisis: penyumbang HPP menyebut bahan + tanggal harganya bergerak" "V == 1" \
  "$(echo "$AN145" | jq --arg m "$MID145" --arg i "$BH145" '[.[]|select(.id==$m)][0].penyumbang[0] | ((.ingredient_id==$i) and (.kontribusi==20000) and ((.persen_hpp|round)==100) and ((.bahan_diperbarui|type)=="string") and (.harga_dilaporkan_pada!=null))|if . then 1 else 0 end')"
cek "analisis: urut food cost tertinggi lebih dulu" "V == 1" \
  "$(echo "$AN145" | jq '[.[].food_cost_persen] as $f | ($f == ($f|sort|reverse))|if . then 1 else 0 end')"
cek "kasir buka analisis harga → 403" "V == 403" "$(status_code "$REISS105" GET /menu/analisis-harga)"

# --- §4 ambang food cost perusahaan bisa diatur
api "$OWNER" PATCH /company '{"food_cost_maks":55}' > /dev/null
cek "ambang food cost tersimpan & terbawa ke analisis" "V == 55" \
  "$(api "$OWNER" GET /menu/analisis-harga | jq '.[0].food_cost_maks')"
api "$OWNER" PATCH /company '{"food_cost_maks":40}' > /dev/null

# --- §4 terapkan harga saran massal (server yang menghitung, bukan klien)
cek "kasir terapkan harga saran → 403" "V == 403" \
  "$(status_code_body "$REISS105" POST /menu/terapkan-saran "{\"ids\":[\"$MID145\"]}")"
TS145=$(api "$OWNER" POST /menu/terapkan-saran "{\"ids\":[\"$MID145\"]}")
# HPP 20000 × mult 3 = 60000 → harga_jual_bulat 60000 (dari 55000)
cek "terapkan saran: 1 menu diperbarui 55000 → 60000" "V == 1" \
  "$(echo "$TS145" | jq --arg m "$MID145" '((.diperbarui==1) and ([.rincian[]|select(.menu_id==$m and .harga_lama==55000 and .harga_baru==60000 and .diperbarui)]|length==1))|if . then 1 else 0 end')"
cek "harga jual menu benar-benar berubah jadi 60000" "V == 60000" \
  "$(api "$OWNER" GET "/menu/$MID145" | jq '.harga_jual')"
cek "terapkan saran tercatat di riwayat harga" "V == 1" \
  "$(api "$OWNER" GET "/menu/$MID145/riwayat-harga" | jq '[.[]|select(.sebab=="terapkan_saran" and .harga_lama==55000 and .harga_baru==60000)]|length==1|if . then 1 else 0 end')"
TS145B=$(api "$OWNER" POST /menu/terapkan-saran "{\"ids\":[\"$MID145\"]}")
cek "terapkan saran kedua kali → dilewati (harga sudah sama)" "V == 1" \
  "$(echo "$TS145B" | jq '((.diperbarui==0) and (.dilewati==1))|if . then 1 else 0 end')"
cek "menu yang dilewati tidak menambah baris riwayat" "V == 3" \
  "$(api "$OWNER" GET "/menu/$MID145/riwayat-harga" | jq 'length')"
cek "terapkan saran id ngawur → 404" "V == 404" \
  "$(status_code_body "$OWNER" POST /menu/terapkan-saran '{"ids":["00000000-0000-0000-0000-000000000000"]}')"


echo
echo "── §146 PUT /menu/:id = perbarui SEBAGIAN (field tak dikirim dipertahankan) ──"
# Dulu PUT memakai skema POST lengkap dengan .default(): klien yang cuma mengganti
# harga ikut MENGHAPUS resep (komponen default []), menghapus foto, dan
# MENGAKTIFKAN ULANG menu yang sudah diarsipkan. Seksi ini mengunci perbaikannya.
M146=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji146\",\"kode\":\"U146\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":3,\"harga_jual\":30000,\"image_url\":\"/uploads/uji146.jpg\",\"komponen\":[{\"ingredient_id\":\"$BH145\",\"qty\":2}]}")
MID146=$(echo "$M146" | jq -r .id)
cek "menu146 dibuat lengkap (resep 1 baris + foto + kode)" "V == 1" \
  "$(echo "$M146" | jq '((.komponen|length)==1 and .image_url=="/uploads/uji146.jpg" and .kode=="U146" and .is_active)|if . then 1 else 0 end')"

# PUT hanya harga_jual — persis pola aplikasi mobile yang tak menyimpan resep
P146=$(api "$OWNER" PUT "/menu/$MID146" '{"harga_jual":33000}')
cek "PUT {harga_jual} saja: harga berubah" "V == 33000" "$(echo "$P146" | jq '.harga_jual')"
cek "PUT {harga_jual} saja: RESEP tetap utuh" "V == 1" \
  "$(echo "$P146" | jq --arg i "$BH145" '((.komponen|length)==1 and .komponen[0].ingredient_id==$i and .komponen[0].qty==2)|if . then 1 else 0 end')"
cek "PUT {harga_jual} saja: foto, kode, nama, mult tetap" "V == 1" \
  "$(echo "$P146" | jq '(.image_url=="/uploads/uji146.jpg" and .kode=="U146" and .nama=="Menu Uji146" and .mult==3)|if . then 1 else 0 end')"
cek "PUT sebagian tetap tercatat di riwayat harga" "V == 1" \
  "$(api "$OWNER" GET "/menu/$MID146/riwayat-harga" | jq '[.[]|select(.sebab=="manual" and .harga_lama==30000 and .harga_baru==33000)]|length==1|if . then 1 else 0 end')"

# is_active: menu yang diarsipkan tak boleh hidup lagi hanya karena harga diubah
api "$OWNER" DELETE "/menu/$MID146" > /dev/null
cek "menu146 diarsipkan" "V == 1" \
  "$(api "$OWNER" GET "/menu/$MID146" | jq '(.is_active|not)|if . then 1 else 0 end')"
cek "PUT {harga_jual} pada menu terarsip: TETAP terarsip" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$MID146" '{"harga_jual":34000}' | jq '((.is_active|not) and .harga_jual==34000)|if . then 1 else 0 end')"
cek "is_active:true eksplisit → menu aktif kembali" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$MID146" '{"is_active":true}' | jq '.is_active|if . then 1 else 0 end')"

# null/[] eksplisit tetap berarti "kosongkan" — bukan "pertahankan"
cek "PUT {image_url:null} → foto dihapus, resep tetap" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$MID146" '{"image_url":null}' | jq '(.image_url==null and (.komponen|length)==1)|if . then 1 else 0 end')"
cek "PUT {komponen:[]} → resep dikosongkan" "V == 0" \
  "$(api "$OWNER" PUT "/menu/$MID146" '{"komponen":[]}' | jq '.komponen|length')"
cek "PUT {komponen:[...]} → resep diisi ulang" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$MID146" "{\"komponen\":[{\"ingredient_id\":\"$BH145\",\"qty\":5}]}" | jq '[.komponen[]|select(.qty==5)]|length')"
cek "PUT {kode:\"\"} → kode digenerate ulang dari nama" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$MID146" '{"kode":""}' | jq '(.kode!=null and .kode!="U146")|if . then 1 else 0 end')"
cek "PUT {} kosong → tak ada yang berubah" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$MID146" '{}' | jq '((.komponen|length)==1 and .harga_jual==34000 and .nama=="Menu Uji146")|if . then 1 else 0 end')"

# guard yang tak boleh ikut longgar
cek "PUT {tipe:paket} tanpa base_menu_id → 400" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$MID146" '{"tipe":"paket"}')"
cek "PUT {komponen} bahan milik perusahaan lain → 400" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$MID146" '{"komponen":[{"ingredient_id":"00000000-0000-0000-0000-000000000000","qty":1}]}')"
cek "PUT {nama:\"\"} → 400 (nama tetap wajib berisi bila dikirim)" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$MID146" '{"nama":"  "}')"
cek "PUT menu id ngawur → 404" "V == 404" \
  "$(status_code_body "$OWNER" PUT "/menu/00000000-0000-0000-0000-000000000000" '{"harga_jual":1000}')"
cek "kasir PUT /menu → 403" "V == 403" \
  "$(status_code_body "$REISS105" PUT "/menu/$MID146" '{"harga_jual":1000}')"


echo
echo "── §147 Open bill MENGUNCI harga jual saat dipesan ──"
# Bill dibuka hari ini, dibayar setelah harga menu naik. Dulu pembeli ditagih
# harga TERBARU; sekarang harga saat memesan yang menang.
M147=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji147\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":10000,\"komponen\":[]}" | jq -r .id)
MEJA147=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.is_active)][0].id')
# transaksi kasir butuh shift terbuka — seksi sebelumnya bisa meninggalkannya tertutup
if [ -z "$(api "$REISS105" GET /shift/aktif | jq -r '.id // empty')" ]; then
  api "$REISS105" POST /shift/buka '{"modal_awal":0}' > /dev/null 2>&1 || true
fi
OB147=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":2}]}")
OBID147=$(echo "$OB147" | jq -r .id)
ITEM147=$(echo "$OB147" | jq -r '.items[0].id')
cek "bill baru: harga & nama menu di-snapshot server" "V == 1" \
  "$(echo "$OB147" | jq '(.items[0].harga_satuan==10000) and (.items[0].menu_nama=="Menu Uji147") and ((.items[0].id|length)==36)|if . then 1 else 0 end')"

# harga menu NAIK setelah bill dibuat
api "$OWNER" PUT "/menu/$M147" '{"harga_jual":25000}' > /dev/null
cek "harga menu sekarang 25000" "V == 25000" "$(api "$OWNER" GET "/menu/$M147" | jq '.harga_jual')"
cek "bill TETAP memegang harga 10000 setelah menu naik" "V == 10000" \
  "$(api "$REISS105" GET "/open-bill/$OBID147" | jq '.items[0].harga_satuan')"

# menyunting bill (ubah qty) tidak boleh melepas kunci harga
OBE147=$(api "$REISS105" PUT "/open-bill/$OBID147" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"id\":\"$ITEM147\",\"menu_id\":\"$M147\",\"qty\":3}]}")
cek "PUT baris ber-id: qty berubah, harga terkunci tetap 10000" "V == 1" \
  "$(echo "$OBE147" | jq --arg i "$ITEM147" '[.items[]|select(.id==$i)][0] | (.qty==3) and (.harga_satuan==10000)|if . then 1 else 0 end')"
# klien LAMA (tanpa id) juga tak boleh kehilangan kunci — dipasangkan per menu
OBL147=$(api "$REISS105" PUT "/open-bill/$OBID147" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":4}]}")
cek "PUT tanpa id (klien lama): harga terkunci tetap dipertahankan" "V == 1" \
  "$(echo "$OBL147" | jq '(.items|length==1) and (.items[0].qty==4) and (.items[0].harga_satuan==10000)|if . then 1 else 0 end')"
# baris TAMBAHAN memakai harga hari ini — bukan ikut terkunci
ITEM147B=$(echo "$OBL147" | jq -r '.items[0].id')
OBT147=$(api "$REISS105" PUT "/open-bill/$OBID147" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"id\":\"$ITEM147B\",\"menu_id\":\"$M147\",\"qty\":4},{\"menu_id\":\"$M147\",\"qty\":1}]}")
cek "baris tambahan pakai harga HARI INI (25000), yang lama tetap 10000" "V == 1" \
  "$(echo "$OBT147" | jq '([.items[].harga_satuan]|sort) == [10000,25000]|if . then 1 else 0 end')"
cek "PUT id milik bill lain → 400" "V == 400" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID147" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"id\":\"00000000-0000-0000-0000-000000000000\",\"menu_id\":\"$M147\",\"qty\":1}]}")"

# KUNCI YANG TAK DIKIRIM = JANGAN SENTUH. Dulu PUT menimpa keempat kolom
# metadata tanpa syarat, jadi ia menghapus apa pun yang tak ikut dikirim —
# walau klien itu tak tahu-menahu soal kolomnya. `catatan` bill tayang di kartu
# papan dapur tapi tak pernah dikirim layar kasir web, dan `meja_id` yang
# hilang MELEPAS bill dari mejanya: mejanya lalu terlihat kosong, bill kedua
# dibuka di sana, dan aturan "satu meja dine-in = satu bill" bocor lewat pintu
# belakang. Bill yang terlepas itu justru yang paling mungkin tak tertagih.
ITEMS147=$(echo "$OBT147" | jq -c '[.items[]|{id:.id, menu_id:.menu_id, qty:.qty}]')
api "$REISS105" PUT "/open-bill/$OBID147" \
  "$(jq -nc --arg m "$MEJA147" --argjson it "$ITEMS147" '{meja_id:$m, catatan:"tamu alergi udang", customer_nama:"Budi", items:$it}')" > /dev/null
PP147=$(api "$REISS105" PUT "/open-bill/$OBID147" "$(jq -nc --argjson it "$ITEMS147" '{items:$it}')")
cek "PUT tanpa kunci catatan: catatan bill TIDAK ikut terhapus" "V == 1" \
  "$(echo "$PP147" | jq '(.catatan=="tamu alergi udang")|if . then 1 else 0 end')"
cek "PUT tanpa kunci customer_nama: nama tamu juga bertahan" "V == 1" \
  "$(echo "$PP147" | jq '(.customer_nama=="Budi")|if . then 1 else 0 end')"
cek "PUT tanpa kunci meja_id: bill TETAP menempel di mejanya" "V == 1" \
  "$(echo "$PP147" | jq --arg m "$MEJA147" '(.meja_id==$m)|if . then 1 else 0 end')"
cek "…dan harga terkunci tetap utuh setelah PUT sebagian itu" "V == 1" \
  "$(echo "$PP147" | jq '([.items[].harga_satuan]|sort) == [10000,25000]|if . then 1 else 0 end')"
# Yang hilang HANYA penghapusan yang tak diminta — null eksplisit tetap bekerja.
cek "catatan null EKSPLISIT tetap mengosongkan" "V == 1" \
  "$(api "$REISS105" PUT "/open-bill/$OBID147" "$(jq -nc --arg m "$MEJA147" --argjson it "$ITEMS147" '{meja_id:$m, catatan:null, customer_nama:null, items:$it}')" | jq '((.catatan==null) and (.customer_nama==null))|if . then 1 else 0 end')"

# BAYAR: yang ditagih adalah harga terkunci, bukan harga menu terbaru
S147=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":4,\"open_bill_item_id\":\"$ITEM147B\"},{\"menu_id\":\"$M147\",\"qty\":1}]}")
SID147=$(echo "$S147" | jq -r '.sale.id')
D147=$(api "$OWNER" GET "/penjualan/$SID147")
# 4 × 10000 (terkunci) + 1 × 25000 (harga hari ini) = 65000
cek "bayar bill: baris terkunci ditagih 10000/porsi" "V == 1" \
  "$(echo "$D147" | jq '[.items[]|select(.hargaSatuan==10000 and .qty==4)]|length==1|if . then 1 else 0 end')"
cek "bayar bill: baris non-bill ditagih harga hari ini 25000" "V == 1" \
  "$(echo "$D147" | jq '[.items[]|select(.hargaSatuan==25000 and .qty==1)]|length==1|if . then 1 else 0 end')"
cek "bayar bill: subtotal 65000 (bukan 5 × 25000 = 125000)" "V == 65000" \
  "$(echo "$D147" | jq '.sale.subtotal')"

# guard: kasir tak boleh menunjuk baris bill sembarangan untuk menekan harga
OB147B=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")
OBID147B=$(echo "$OB147B" | jq -r .id)
ITEM147C=$(echo "$OB147B" | jq -r '.items[0].id')
cek "open_bill_item_id milik bill LAIN → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147B\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1,\"open_bill_item_id\":\"$ITEM147B\"}]}")"
# Bill DITUTUP server saat dibayar (open_bills.closed_at + sale_id), jadi
# membayarnya dua kali ditolak di sini — bukan lagi menghasilkan transaksi
# kembar diam-diam karena klien gagal mengirim DELETE-nya.
cek "membayar bill yang SUDAH dibayar → 409 (tak ada transaksi kembar)" "V == 409" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")"
# DUA SEBAB BERBEDA di balik satu kode 409, dan artinya BERLAWANAN bagi antrean
# offline: bill yang sudah DIBAYAR berarti transaksinya kembar (aman dibuang),
# bill yang DIBATALKAN berarti transaksinya tak pernah tercatat (jangan dibuang).
# Klien mustahil membedakannya tanpa `sebab`.
cek "…: sebab = bill_sudah_dibayar (kiriman ulang, aman dibuang antrean)" "V == 1" \
  "$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}" | jq '(.sebab=="bill_sudah_dibayar")|if . then 1 else 0 end')"
OB147X=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")
OBID147X=$(echo "$OB147X" | jq -r .id)
api "$REISS105" DELETE "/open-bill/$OBID147X" > /dev/null
cek "membayar bill yang DIBATALKAN → 409" "V == 409" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147X\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")"
cek "…: sebab = bill_dibatalkan (transaksi TIDAK tercatat — jangan dibuang)" "V == 1" \
  "$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147X\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}" | jq '(.sebab=="bill_dibatalkan")|if . then 1 else 0 end')"
# MENYUNTING bill yang sudah ditutup juga harus ditolak, bukan cuma
# membayarnya. Layar kasir memegang bill di memori, jadi perangkat kedua yang
# membayar/membatalkan tak terlihat olehnya — dan tombol "Perbarui Bill" masih
# bisa ditekan. Dulu PUT hanya memeriksa "ada" + "satu perusahaan", jadi ia
# menulis ke bill mati: pada bill DIBAYAR tambahannya tak pernah ditagih
# (barisnya sudah tersalin ke sale_items), pada bill DIBATALKAN baris hidup
# masuk ke bill yang tak akan ditagih siapa pun. Lalu `loadDetail` menyaring
# bill tertutup, jadi jawabannya 200 berisi `null` — klien membacanya sebagai
# sukses dan mengosongkan keranjang. Pesanannya lenyap tanpa satu pun galat.
cek "PUT bill yang SUDAH DIBAYAR → 409 (bukan 200 berisi null)" "V == 409" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID147" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")"
cek "…: kode bill_sudah_ditutup + sudah_dibayar=true" "V == 1" \
  "$(api "$REISS105" PUT "/open-bill/$OBID147" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}" | jq '((.kode=="bill_sudah_ditutup") and (.sudah_dibayar==true))|if . then 1 else 0 end')"
cek "PUT bill yang DIBATALKAN → 409" "V == 409" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID147X" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")"
# Dibedakan, karena langkah kasirnya berbeda: yang sudah dibayar butuh
# transaksi BARU, yang dibatalkan butuh bill baru.
cek "…: sudah_dibayar=false untuk bill yang dibatalkan" "V == 1" \
  "$(api "$REISS105" PUT "/open-bill/$OBID147X" "{\"meja_id\":\"$MEJA147\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}" | jq '((.kode=="bill_sudah_ditutup") and (.sudah_dibayar==false))|if . then 1 else 0 end')"
# Penolakan itu tak boleh menyisakan apa pun: penjualan yang sudah terbuku
# tetap 2 baris (4 porsi terkunci + 1 porsi harga hari ini), tidak bertambah.
cek "penjualan bill itu TIDAK ikut berubah oleh PUT yang ditolak" "V == 2" \
  "$(api "$OWNER" GET "/penjualan/$SID147" | jq '.items|length')"
# Sebab yang sama harus sampai lewat ANTREAN OFFLINE, bukan hanya jalur online.
SYNC147=$(api "$REISS105" POST /sync "$(jq -nc --arg r "$(cat /proc/sys/kernel/random/uuid)" --arg w "$(date -u +%FT%TZ)" --arg mj "$MEJA147" --arg ob "$OBID147X" --arg m "$M147" '{commands:[{client_ref:$r,tipe:"penjualan",waktu:$w,payload:{meja_id:$mj,metode_bayar:"tunai",open_bill_id:$ob,items:[{menu_id:$m,qty:1}]}}]}')")
cek "sync: bayar bill dibatalkan → gagal 409 + sebab bill_dibatalkan" "V == 1" \
  "$(echo "$SYNC147" | jq '(.hasil[0].status=="gagal" and .hasil[0].kode==409 and .hasil[0].sebab=="bill_dibatalkan")|if . then 1 else 0 end')"
cek "open_bill_item_id tanpa open_bill_id → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1,\"open_bill_item_id\":\"$ITEM147C\"}]}")"
cek "open_bill_id ngawur → 404" "V == 404" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"00000000-0000-0000-0000-000000000000\",\"items\":[{\"menu_id\":\"$M147\",\"qty\":1}]}")"
cek "open_bill_item_id vs menu_id tak cocok → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA147\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID147B\",\"items\":[{\"menu_id\":\"$MID146\",\"qty\":1,\"open_bill_item_id\":\"$ITEM147C\"}]}")"
api "$REISS105" DELETE "/open-bill/$OBID147B" > /dev/null


echo
echo "── §148 Kiriman WAJIB kelipatan kemasan (sama seperti aturan belanja) ──"
# Barang yang hanya bisa DIBELI per kilo juga hanya boleh DIKIRIM per kilo —
# tanpa ini gudang mengirim 900 gr dari kemasan 1 kg dan sisa 100 gr menggantung.
CK148=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="central_kitchen" and .is_active)][0].id')
ST148=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
masuk148() { # <ingredient_id> <mode> <jumlah> <total>
  local f
  f=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK148\",\"items\":[{\"ingredient_id\":\"$1\",\"mode\":\"$2\",\"jumlah\":$3,\"total_harga\":$4}]}" | jq -r .faktur_id)
  api "$OWNER" POST "/pembelian/tahap/$f" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$f" '{"ke":"menunggu"}' > /dev/null
}
kirim148() { # <ingredient_id> <qty> → kode HTTP
  status_code_body "$OWNER" POST /transfer-stok \
    "{\"asal_branch_id\":\"$CK148\",\"tujuan_branch_id\":\"$ST148\",\"items\":[{\"ingredient_id\":\"$1\",\"qty\":$2}]}"
}

# (a) bahan per kemasan: 1 kg = 1000 gr, TIDAK boleh eceran; stok CK 3 kg
BK148=$(api "$OWNER" POST /bahan '{"nama":"Sayur kemasan 148","harga_beli":12000,"isi":1000,"satuan":"gr","satuan_beli":"kg","pengadaan":"beli","kategori":"lain","boleh_eceran":false}' | jq -r .id)
masuk148 "$BK148" batch 3 36000
cek "saldo CK 3.000 gr + DTO menandai wajib_kelipatan" "V == 1" \
  "$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK148" | jq --arg i "$BK148" '[.rows[]|select(.ingredient_id==$i)][0] | ((.saldo==3000) and (.isi==1000) and (.satuan_beli=="kg") and (.wajib_kelipatan==true))|if . then 1 else 0 end')"
cek "kirim 900 gr (kurang dari 1 kemasan) → 400" "V == 400" "$(kirim148 "$BK148" 900)"
cek "kirim 1.500 gr (1,5 kemasan) → 400" "V == 400" "$(kirim148 "$BK148" 1500)"
cek "pesan tolak menyebut kelipatan terdekat yang sah" "V == 1" \
  "$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$CK148\",\"tujuan_branch_id\":\"$ST148\",\"items\":[{\"ingredient_id\":\"$BK148\",\"qty\":1500}]}" | jq '(.error|test("1000 atau 2000"))|if . then 1 else 0 end')"
cek "kirim 2.000 gr (2 kg penuh) → 201" "V == 201" "$(kirim148 "$BK148" 2000)"

# (b) KIRIM HABIS: sisa di bawah 1 kemasan tetap bisa dipindahkan
BS148=$(api "$OWNER" POST /bahan '{"nama":"Sayur sisa 148","harga_beli":12000,"isi":1000,"satuan":"gr","satuan_beli":"kg","pengadaan":"beli","kategori":"lain","boleh_eceran":false}' | jq -r .id)
masuk148 "$BS148" pcs 900 10800
cek "sisa 900 gr: kirim 500 gr (sebagian) → 400" "V == 400" "$(kirim148 "$BS148" 500)"
cek "pesan menawarkan jalan keluar 'kirim habis'" "V == 1" \
  "$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$CK148\",\"tujuan_branch_id\":\"$ST148\",\"items\":[{\"ingredient_id\":\"$BS148\",\"qty\":500}]}" | jq '(.error|test("dikirim habis"))|if . then 1 else 0 end')"
cek "sisa 900 gr: kirim 900 gr (KIRIM HABIS) → 201" "V == 201" "$(kirim148 "$BS148" 900)"

# (c) bahan yang BOLEH eceran tidak ikut terkunci
BE148=$(api "$OWNER" POST /bahan '{"nama":"Bumbu eceran 148","harga_beli":5000,"isi":1000,"satuan":"gr","satuan_beli":"kg","pengadaan":"beli","kategori":"lain","boleh_eceran":true}' | jq -r .id)
masuk148 "$BE148" batch 2 10000
cek "boleh eceran → wajib_kelipatan false" "V == 1" \
  "$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK148" | jq --arg i "$BE148" '[.rows[]|select(.ingredient_id==$i)][0].wajib_kelipatan|if . then 0 else 1 end')"
cek "boleh eceran: kirim 900 gr → 201" "V == 201" "$(kirim148 "$BE148" 900)"

# (d) bahan tanpa kemasan (isi = 1) bebas seperti sebelumnya
B1148=$(api "$OWNER" POST /bahan '{"nama":"Pcs polos 148","harga_beli":2000,"isi":1,"satuan":"pcs","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
masuk148 "$B1148" pcs 10 20000
cek "isi = 1 (tanpa kemasan): kirim 7 pcs → 201" "V == 201" "$(kirim148 "$B1148" 7)"


echo
echo "── §149 SATUAN kiriman sama di web & mobile (qty_teks ditulis server) ──"
# Bug nyata: pada faktur PB-0058 yang SAMA, web menulis "Sayur 900 gr" sementara
# mobile menulis "Sayur 900 kg" — beda 1000× — karena klien memasangkan `qty`
# dengan `satuan_beli`. Server sekarang MENULIS teksnya, jadi tak ada lagi yang
# perlu ditebak klien mana pun.
# Bahan uji: satuan kerja gr, kemasan kg (1 kg = 1000 gr). Stok CK 900 gr.
BT149=$(api "$OWNER" POST /bahan '{"nama":"Sayur teks 149","harga_beli":12000,"isi":1000,"satuan":"gr","satuan_beli":"kg","pengadaan":"beli","kategori":"lain","boleh_eceran":true}' | jq -r .id)
masuk148 "$BT149" pcs 900 10800
SLD149=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK148" | jq --arg i "$BT149" '[.rows[]|select(.ingredient_id==$i)][0]')
cek "saldo kirim: tersedia_teks = '900 gr' (satuan KERJA, bukan kemasan)" "V == 1" \
  "$(echo "$SLD149" | jq -r '(.tersedia_teks == "900 gr")|if . then 1 else 0 end')"
cek "saldo kirim: tersedia_teks TIDAK memakai satuan_beli" "V == 0" \
  "$(echo "$SLD149" | jq -r '(.tersedia_teks|test("kg"))|if . then 1 else 0 end')"
cek "saldo kirim: tersedia_setara = '≈ 0,9 kg' (pelengkap, bukan pengganti)" "V == 1" \
  "$(echo "$SLD149" | jq -r '(.tersedia_setara == "≈ 0,9 kg")|if . then 1 else 0 end')"
# kirim 900 gr → baris faktur transfer harus menuliskan satuan yang sama
TF149=$(api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$CK148\",\"tujuan_branch_id\":\"$ST148\",\"items\":[{\"ingredient_id\":\"$BT149\",\"qty\":900}]}" | jq -r .faktur_id)
IT149=$(api "$OWNER" GET /transfer-stok | jq --arg f "$TF149" '[.rows[]|select(.faktur_id==$f)][0].items[0]')
cek "baris transfer: qty 900 + satuan 'gr'" "V == 1" \
  "$(echo "$IT149" | jq -r '((.qty == 900) and (.satuan == "gr"))|if . then 1 else 0 end')"
cek "baris transfer: qty_teks = '900 gr'" "V == 1" \
  "$(echo "$IT149" | jq -r '(.qty_teks == "900 gr")|if . then 1 else 0 end')"
cek "baris transfer: qty_setara = '≈ 0,9 kg'" "V == 1" \
  "$(echo "$IT149" | jq -r '(.qty_setara == "≈ 0,9 kg")|if . then 1 else 0 end')"
# penerimaan di cabang tujuan — layar tempat bug mobile terlihat
PN149=$(api "$OWNER" GET "/penerimaan?branch_id=$ST148" | jq --arg f "$TF149" '[.rows[]|select(.faktur_id==$f)][0]')
cek "penerimaan: qty_teks = '900 gr' (bukan '900 kg')" "V == 1" \
  "$(echo "$PN149" | jq -r '(.qty_teks == "900 gr")|if . then 1 else 0 end')"
cek "penerimaan: qty_setara = '≈ 0,9 kg'" "V == 1" \
  "$(echo "$PN149" | jq -r '(.qty_setara == "≈ 0,9 kg")|if . then 1 else 0 end')"
# baris faktur BELI mode batch — sumber "2000 batch" di mobile
FB149=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK148\",\"items\":[{\"ingredient_id\":\"$BT149\",\"mode\":\"batch\",\"jumlah\":2,\"total_harga\":24000}]}" | jq -r .faktur_id)
BR149=$(api "$OWNER" GET "/pembelian?branch_id=$CK148&per_page=100" | jq --arg f "$FB149" '[.rows[]|select(.faktur_id==$f)][0]')
cek "faktur beli mode batch: is_batch true TAPI qty tetap dalam satuan kerja" "V == 1" \
  "$(echo "$BR149" | jq -r '((.is_batch == true) and (.qty == 2000) and (.satuan == "gr"))|if . then 1 else 0 end')"
cek "faktur beli: qty_teks = '2.000 gr' (bukan '2000 batch')" "V == 1" \
  "$(echo "$BR149" | jq -r '(.qty_teks == "2.000 gr")|if . then 1 else 0 end')"
cek "faktur beli: qty_teks TIDAK memuat kata 'batch'" "V == 0" \
  "$(echo "$BR149" | jq -r '(.qty_teks|test("batch"))|if . then 1 else 0 end')"
cek "faktur beli: qty_setara = '2 kg' (kelipatan pas, tanpa ≈)" "V == 1" \
  "$(echo "$BR149" | jq -r '(.qty_setara == "2 kg")|if . then 1 else 0 end')"
# bahan tanpa kemasan → tak ada teks setara yang bisa disalahtafsirkan
SLD149B=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK148" | jq --arg i "$B1148" '[.rows[]|select(.ingredient_id==$i)][0]')
cek "bahan tanpa kemasan: tersedia_setara null" "V == 1" \
  "$(echo "$SLD149B" | jq -r '(.tersedia_setara == null)|if . then 1 else 0 end')"


echo
echo "── §150 Isi menu (deskripsi) — teks yang dikendalikan pemilik ──"
# "Ingin ada detail isi dari masing-masing menu": field TERPISAH dari resep,
# karena resep itu dokumen biaya (takaran boleh pecahan, memuat kemasan).
KAT150=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
M150=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Isi150\",\"category_id\":\"$KAT150\",\"harga_jual\":30000,\"mult\":2,\"deskripsi\":\"1 baso urat besar, 2 baso kecil, 1 mie\"}" | jq -r .id)
cek "POST /menu menyimpan deskripsi apa adanya" "V == 1" \
  "$(api "$OWNER" GET "/menu/$M150" | jq -r '(.deskripsi == "1 baso urat besar, 2 baso kecil, 1 mie")|if . then 1 else 0 end')"
cek "deskripsi ikut terbawa di daftar /menu" "V == 1" \
  "$(api "$OWNER" GET /menu | jq --arg i "$M150" '[.rows?[]? // .[] | select(.id==$i)][0].deskripsi != null|if . then 1 else 0 end')"
# PUT parsial (§146): deskripsi TIDAK boleh hilang saat klien hanya kirim harga
api "$OWNER" PUT "/menu/$M150" '{"harga_jual":31000}' > /dev/null
cek "PUT hanya harga → deskripsi UTUH (perbarui-sebagian)" "V == 1" \
  "$(api "$OWNER" GET "/menu/$M150" | jq -r '((.deskripsi == "1 baso urat besar, 2 baso kecil, 1 mie") and (.harga_jual == 31000))|if . then 1 else 0 end')"
api "$OWNER" PUT "/menu/$M150" '{"deskripsi":"2 baso aci, 1 siomay"}' > /dev/null
cek "PUT deskripsi baru → tergantikan" "V == 1" \
  "$(api "$OWNER" GET "/menu/$M150" | jq -r '(.deskripsi == "2 baso aci, 1 siomay")|if . then 1 else 0 end')"
# "" dan null sama-sama berarti KOSONGKAN — pembaca tak perlu cek dua bentuk
api "$OWNER" PUT "/menu/$M150" '{"deskripsi":""}' > /dev/null
cek "PUT deskripsi \"\" → null (bukan string kosong)" "V == 1" \
  "$(api "$OWNER" GET "/menu/$M150" | jq -r '(.deskripsi == null)|if . then 1 else 0 end')"
api "$OWNER" PUT "/menu/$M150" '{"deskripsi":"   "}' > /dev/null
cek "PUT deskripsi spasi saja → null" "V == 1" \
  "$(api "$OWNER" GET "/menu/$M150" | jq -r '(.deskripsi == null)|if . then 1 else 0 end')"
cek "deskripsi > 500 karakter → 400" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$M150" "{\"deskripsi\":\"$(python3 -c 'print("x"*501)')\"}")"
# menu tanpa deskripsi tetap sah (field opsional)
M150B=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Isi150b\",\"category_id\":\"$KAT150\",\"harga_jual\":12000,\"mult\":2}" | jq -r .id)
cek "menu tanpa deskripsi → null, bukan gagal" "V == 1" \
  "$(api "$OWNER" GET "/menu/$M150B" | jq -r '(.deskripsi == null)|if . then 1 else 0 end')"
api "$OWNER" DELETE "/menu/$M150" > /dev/null
api "$OWNER" DELETE "/menu/$M150B" > /dev/null


echo
echo "── §151 Realisasi BOLEH lebih/kurang dari RAB ──"
# RAB itu RENCANA, bukan pagu. Sayur direncanakan 900 gr tapi hanya dijual per
# kilo → yang benar-benar dibeli 1.000 gr, dan itulah yang harus tercatat.
CK151=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="central_kitchen" and .is_active)][0].id')
B151=$(api "$OWNER" POST /bahan '{"nama":"Sayur rab151","harga_beli":18000,"isi":1000,"satuan":"gr","satuan_beli":"kg","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
saldo151() { api "$OWNER" GET "/stok?branch_id=$CK151" | jq --arg i "$B151" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
S151_0=$(saldo151)
# RAB 900 gr seharga 16.200 (estimasi 18 rb/kg)
F151=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK151\",\"items\":[{\"ingredient_id\":\"$B151\",\"mode\":\"pcs\",\"jumlah\":900,\"total_harga\":16200}]}" | jq -r .faktur_id)
baris151() { api "$OWNER" GET "/pembelian?branch_id=$CK151&per_page=200" | jq --arg f "$F151" '[.rows[]|select(.faktur_id==$f)]'; }
ID151=$(baris151 | jq -r '.[0].id')
cek "dasar uji: RAB 900 gr" "abs(V - 900) < 0.001" "$(baris151 | jq -r '.[0].qty')"
api "$OWNER" POST "/pembelian/tahap/$F151" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID151\",\"qty\":900}]}" > /dev/null
ID151=$(baris151 | jq -r '.[0].id')
# realisasi 1.000 gr (1 kemasan penuh) — dulu ditolak 400
cek "maju dgn qty LEBIH dari RAB (1.000 > 900) → 200" "V == 200" \
  "$(status_code_body "$OWNER" POST "/pembelian/tahap/$F151" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID151\",\"qty\":1000}]}")"
cek "qty baris jadi 1.000 (angka yang benar-benar dibeli)" "abs(V - 1000) < 0.001" \
  "$(baris151 | jq -r '[.[]|select(.status=="dikonfirmasi")][0].qty')"
cek "TIDAK ada sisa tugas — seluruh baris maju" "V == 1" "$(baris151 | jq 'length')"
cek "stok CK bertambah 1.000, bukan 900" "abs(V - 1000) < 0.001" "$(python3 -c "print($(saldo151) - $S151_0)")"
cek "estimasi harga ikut diskalakan (16.200 × 1000/900 = 18.000)" "abs(V - 18000) < 1" \
  "$(baris151 | jq -r '[.[]|select(.status=="dikonfirmasi")][0].total_harga')"
cek "harga hasil skala TETAP tebakan (tak mencemari median acuan)" "V == 1" \
  "$(baris151 | jq -r '[.[]|select(.status=="dikonfirmasi")][0].harga_tebakan|if . then 1 else 0 end')"

# harga RIIL yang dikirim menang atas skala estimasi
S151_1=$(saldo151)
F151B=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK151\",\"items\":[{\"ingredient_id\":\"$B151\",\"mode\":\"pcs\",\"jumlah\":900,\"total_harga\":16200}]}" | jq -r .faktur_id)
baris151b() { api "$OWNER" GET "/pembelian?branch_id=$CK151&per_page=200" | jq --arg f "$F151B" '[.rows[]|select(.faktur_id==$f)]'; }
ID151B=$(baris151b | jq -r '.[0].id')
api "$OWNER" POST "/pembelian/tahap/$F151B" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID151B\",\"qty\":900}]}" > /dev/null
ID151B=$(baris151b | jq -r '.[0].id')
api "$OWNER" POST "/pembelian/tahap/$F151B" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID151B\",\"qty\":2000,\"harga\":35000}]}" > /dev/null
cek "qty lebih + harga riil: qty 2.000 & harga 35.000 (bukan hasil skala)" "V == 1" \
  "$(baris151b | jq -r '[.[]|select(.status=="dikonfirmasi")][0] | ((.qty==2000) and (.total_harga==35000))|if . then 1 else 0 end')"
cek "harga riil → harga_tebakan false" "V == 1" \
  "$(baris151b | jq -r '[.[]|select(.status=="dikonfirmasi")][0].harga_tebakan|if . then 0 else 1 end')"
cek "stok bertambah 2.000" "abs(V - 2000) < 0.001" "$(python3 -c "print($(saldo151) - $S151_1)")"

# KURANG dari RAB tetap seperti dulu: split, sisanya jadi tugas
F151C=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK151\",\"items\":[{\"ingredient_id\":\"$B151\",\"mode\":\"pcs\",\"jumlah\":900,\"total_harga\":16200}]}" | jq -r .faktur_id)
baris151c() { api "$OWNER" GET "/pembelian?branch_id=$CK151&per_page=200" | jq --arg f "$F151C" '[.rows[]|select(.faktur_id==$f)]'; }
ID151C=$(baris151c | jq -r '.[0].id')
api "$OWNER" POST "/pembelian/tahap/$F151C" "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID151C\",\"qty\":900}]}" > /dev/null
ID151C=$(baris151c | jq -r '.[0].id')
api "$OWNER" POST "/pembelian/tahap/$F151C" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID151C\",\"qty\":400}]}" > /dev/null
cek "qty KURANG dari RAB → split: 400 maju, 500 tetap jadi tugas" "V == 1" \
  "$(baris151c | jq '(([.[]|select(.status=="dikonfirmasi")][0].qty == 400) and ([.[]|select(.status=="dikerjakan")][0].qty == 500))|if . then 1 else 0 end')"


echo
echo "── §152 Tutup kasir: hitung BUTA + kunci hitungan + ACC selisih ──"
# Kasir menghitung laci DULU tanpa pernah melihat kas sistem; angka baru dibuka
# setelah nominalnya DIKUNCI (tak bisa diubah lagi). Selisih apa pun diputuskan
# owner, bukan kasir sendiri.
CB152=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
AKTIF152=$(api "$REISS105" GET /shift/aktif)
cek "dasar uji: kasir punya shift terbuka" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '(.id != null)|if . then 1 else 0 end')"
cek "KASIR dibutakan: hitung_buta=true selagi belum dikunci" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '(.hitung_buta == true)|if . then 1 else 0 end')"
cek "KASIR dibutakan: kas_sistem null (bukan angka)" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '(.kas_sistem == null)|if . then 1 else 0 end')"
cek "KASIR dibutakan: penjualan_tunai null — BUKAN 0 (0 itu angka yang sah)" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '(.penjualan_tunai == null)|if . then 1 else 0 end')"
cek "KASIR dibutakan: selisih null" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '(.selisih == null)|if . then 1 else 0 end')"
cek "KASIR tetap bisa melihat jumlah transaksi (pantau shift jalan)" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '((.jumlah_transaksi|type) == "number")|if . then 1 else 0 end')"
cek "shift terbuka: status_selisih null (belum ada yang dinilai)" "V == 1" \
  "$(echo "$AKTIF152" | jq -r '(.status_selisih == null)|if . then 1 else 0 end')"
# owner TIDAK pernah dibutakan — dialah yang menyetujui selisih
SID152=$(echo "$AKTIF152" | jq -r .id)
OWN152=$(api "$OWNER" GET "/shift/$SID152")
cek "OWNER tidak dibutakan: hitung_buta=false & kas_sistem berupa angka" "V == 1" \
  "$(echo "$OWN152" | jq -r '((.hitung_buta == false) and ((.kas_sistem|type) == "number"))|if . then 1 else 0 end')"
KAS152=$(echo "$OWN152" | jq -r '.kas_sistem')
FISIK152=$(python3 -c "print($KAS152 + 5000)")
# tutup TANPA mengunci & tanpa uang_fisik → 400 (tak ada angka untuk dipakai)
cek "tutup tanpa kunci & tanpa uang_fisik → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST "/shift/tutup" '{"catatan":"x"}')"
# KUNCI HITUNGAN = momen reveal
KUNCI152=$(api "$REISS105" POST /shift/kunci-hitungan "{\"uang_fisik\":$FISIK152}")
cek "REVEAL: kunci-hitungan membuka kas_sistem" "abs(V - $KAS152) < 0.01" \
  "$(echo "$KUNCI152" | jq -r '.kas_sistem')"
cek "REVEAL: selisih = +5.000" "abs(V - 5000) < 0.01" "$(echo "$KUNCI152" | jq -r '.selisih')"
AKTIF152B=$(api "$REISS105" GET /shift/aktif)
cek "setelah dikunci kasir TIDAK lagi dibutakan" "V == 1" \
  "$(echo "$AKTIF152B" | jq -r '((.hitung_buta == false) and ((.kas_sistem|type) == "number"))|if . then 1 else 0 end')"
cek "hitungan_dikunci_pada tercatat (jejak audit)" "V == 1" \
  "$(echo "$AKTIF152B" | jq -r '(.hitungan_dikunci_pada != null)|if . then 1 else 0 end')"
# ANTI-PANCING: nominal lain ditolak, nominal sama tetap lolos (retry jaringan)
cek "kunci ulang dgn nominal BERBEDA → 409 (anti-pancing angka sistem)" "V == 409" \
  "$(status_code_body "$REISS105" POST "/shift/kunci-hitungan" '{"uang_fisik":1}')"
cek "409 tetap membawa nominal yang PERTAMA" "abs(V - $FISIK152) < 0.01" \
  "$(api "$REISS105" POST /shift/kunci-hitungan '{"uang_fisik":1}' | jq -r '.uang_fisik')"
cek "kunci ulang dgn nominal SAMA → tetap 200 (retry jaringan bukan curang)" "V == 200" \
  "$(status_code_body "$REISS105" POST "/shift/kunci-hitungan" "{\"uang_fisik\":$FISIK152}")"
cek "tutup dgn nominal beda dari yang terkunci → 409" "V == 409" \
  "$(status_code_body "$REISS105" POST "/shift/tutup" '{"uang_fisik":1}')"
# tutup TANPA uang_fisik — diambil dari yang terkunci
TUTUP152=$(api "$REISS105" POST /shift/tutup '{"catatan":"kembalian dari pelanggan"}')
cek "tutup tanpa uang_fisik memakai nominal terkunci" "abs(V - $FISIK152) < 0.01" \
  "$(echo "$TUTUP152" | jq -r '.uang_fisik')"
cek "selisih tetap +5.000 setelah ditutup" "abs(V - 5000) < 0.01" "$(echo "$TUTUP152" | jq -r '.selisih')"
cek "selisih → status_selisih menunggu (bukan langsung diterima)" "V == 1" \
  "$(echo "$TUTUP152" | jq -r '(.status_selisih == "menunggu")|if . then 1 else 0 end')"
cek "keterangan kasir tersimpan sebagai selisih_alasan" "V == 1" \
  "$(echo "$TUTUP152" | jq -r '(.selisih_alasan == "kembalian dari pelanggan")|if . then 1 else 0 end')"
SID152B=$(echo "$TUTUP152" | jq -r .id)
# daftar selisih menunggu (sumber badge owner)
SEL152=$(api "$OWNER" GET "/shift/selisih?status=menunggu")
cek "GET /shift/selisih?status=menunggu memuat shift ini" "V == 1" \
  "$(echo "$SEL152" | jq --arg id "$SID152B" '[.[]|select(.id==$id)]|length')"
cek "baris selisih lengkap: kas_sistem, uang_fisik, selisih, cabang" "V == 1" \
  "$(echo "$SEL152" | jq -r --arg id "$SID152B" '[.[]|select(.id==$id)][0] | (((.kas_sistem|type)=="number") and ((.uang_fisik|type)=="number") and ((.selisih - 5000)|fabs < 0.01) and (.branch_nama != "") and (.status_selisih=="menunggu"))|if . then 1 else 0 end')"
cek "KASIR tak boleh melihat daftar selisih → 403" "V == 403" \
  "$(status_code "$REISS105" GET "/shift/selisih?status=menunggu")"
cek "KASIR tak boleh memutuskan selisihnya sendiri → 403" "V == 403" \
  "$(status_code_body "$REISS105" POST "/shift/$SID152B/selisih/putuskan" '{"status":"disetujui"}')"
cek "owner MENOLAK tanpa alasan_tolak → 400" "V == 400" \
  "$(status_code_body "$OWNER" POST "/shift/$SID152B/selisih/putuskan" '{"status":"ditolak"}')"
ACC152=$(api "$OWNER" POST "/shift/$SID152B/selisih/putuskan" '{"status":"disetujui"}')
cek "owner menyetujui → disetujui + tercatat siapa & kapan" "V == 1" \
  "$(echo "$ACC152" | jq -r '((.status_selisih == "disetujui") and (.selisih_disetujui_oleh != null) and (.selisih_diputus_pada != null))|if . then 1 else 0 end')"
cek "keputusan TIDAK mengubah angka apa pun (selisih tetap 5.000)" "abs(V - 5000) < 0.01" \
  "$(echo "$ACC152" | jq -r '.selisih')"
cek "putuskan DUA KALI → 409 (pola sama dgn pengajuan/:id/putuskan)" "V == 409" \
  "$(status_code_body "$OWNER" POST "/shift/$SID152B/selisih/putuskan" '{"status":"ditolak","alasan_tolak":"berubah pikiran"}')"
cek "sudah diputuskan → hilang dari daftar menunggu" "V == 0" \
  "$(api "$OWNER" GET "/shift/selisih?status=menunggu" | jq --arg id "$SID152B" '[.[]|select(.id==$id)]|length')"

# shift yang PAS tak butuh persetujuan sama sekali
pastikanHadir "$REISS105" "§152"
BUKA152=$(api "$REISS105" POST /shift/buka '{"modal_awal":100000}')
SID152C=$(echo "$BUKA152" | jq -r '.id // .shift.id')
KAS152C=$(api "$OWNER" GET "/shift/$SID152C" | jq -r '.kas_sistem')
# jalur SATU LANGKAH (klien yang membutakan di UI saja) tetap sah
PAS152=$(api "$REISS105" POST /shift/tutup "{\"uang_fisik\":$KAS152C}")
cek "uang fisik PAS → selisih 0 & status_selisih 'pas' (bukan null)" "V == 1" \
  "$(echo "$PAS152" | jq -r '(((.selisih|fabs) < 0.01) and (.status_selisih == "pas"))|if . then 1 else 0 end')"
cek "tutup satu langkah tanpa kunci: hitungan_dikunci_pada tetap null" "V == 1" \
  "$(echo "$PAS152" | jq -r '(.hitungan_dikunci_pada == null)|if . then 1 else 0 end')"
cek "shift tanpa selisih → putuskan ditolak 400" "V == 400" \
  "$(status_code_body "$OWNER" POST "/shift/$SID152C/selisih/putuskan" '{"status":"disetujui"}')"
cek "shift PAS masuk daftar status=pas" "V == 1" \
  "$(api "$OWNER" GET "/shift/selisih?status=pas" | jq --arg id "$SID152C" '[.[]|select(.id==$id)]|length')"

# PENOLAKAN — tiga hal yang mobile andalkan dan tak boleh diam-diam berubah:
# nama pemutus terisi walau DITOLAK (namanya "disetujui_oleh", isinya pemutus),
# `catatan` saja (tanpa selisih_alasan) tetap sampai ke owner, dan riwayat
# `GET /shift` membawa putusannya supaya kasir tahu nasib selisihnya sendiri.
pastikanHadir "$REISS105" "§152"
BUKA152D=$(api "$REISS105" POST /shift/buka '{"modal_awal":75000}')
SID152D=$(echo "$BUKA152D" | jq -r '.id // .shift.id')
KAS152D=$(api "$OWNER" GET "/shift/$SID152D" | jq -r '.kas_sistem')
# `field_ngaco` sengaja disertakan: klien yang mengirim field tak dikenal tak
# boleh gagal menutup shift — itu terjadi tepat saat kasir mau pulang.
TOLAK152=$(api "$REISS105" POST /shift/tutup "{\"uang_fisik\":$(python3 -c "print($KAS152D - 3000)"),\"catatan\":\"kembalian kurang jam ramai\",\"field_ngaco\":\"x\"}")
cek "hanya \`catatan\` dikirim (+ field asing) → tersalin jadi selisih_alasan" "V == 1" \
  "$(echo "$TOLAK152" | jq -r '(.selisih_alasan == "kembalian kurang jam ramai")|if . then 1 else 0 end')"
PUT152=$(api "$OWNER" POST "/shift/$SID152D/selisih/putuskan" '{"status":"ditolak","alasan_tolak":"setoran belum cocok"}')
cek "DITOLAK: selisih_disetujui_oleh tetap terisi (nama = pemutus)" "V == 1" \
  "$(echo "$PUT152" | jq -r '((.status_selisih == "ditolak") and (.selisih_disetujui_oleh != null) and (.selisih_diputus_pada != null) and (.alasan_tolak == "setoran belum cocok"))|if . then 1 else 0 end')"
cek "riwayat GET /shift membawa putusan lengkap (kasir tahu nasib selisihnya)" "V == 1" \
  "$(api "$REISS105" GET /shift | jq -r --arg id "$SID152D" '[.[]|select(.id==$id)][0] | ((.status_selisih == "ditolak") and (.selisih_disetujui_oleh != null) and (.alasan_tolak != null) and (.selisih_alasan != null))|if . then 1 else 0 end')"


echo
echo "── §153 Detail produksi: BERAPA BATCH, bukan cuma gramnya ──"
# Pelaksana di dapur mengulang resep sekian kali; "2.100 ml" memaksanya membagi
# sendiri di kepala. Teksnya ditulis SERVER supaya web & mobile tak berbeda.
CK153=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="central_kitchen" and .is_active)][0].id')
B153=$(api "$OWNER" POST /bahan '{"nama":"Sambal uji153","satuan":"ml","satuan_beli":"botol","isi":700,"harga_beli":21000,"pengadaan":"produksi","kategori":"lain"}' | jq -r '.id')
MENTAH153=$(api "$OWNER" POST /bahan '{"nama":"Cabai uji153","satuan":"gr","satuan_beli":"kg","isi":1000,"harga_beli":40000,"pengadaan":"beli","kategori":"lain"}' | jq -r '.id')
api "$OWNER" PUT "/bahan/$B153/resep" "{\"komponen\":[{\"ingredient_id\":\"$MENTAH153\",\"qty\":100}]}" > /dev/null
F153=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK153\",\"items\":[{\"ingredient_id\":\"$B153\",\"mode\":\"batch\",\"jumlah\":3}]}" | jq -r .faktur_id)
BARIS153=$(api "$OWNER" GET "/produksi?branch_id=$CK153&per_page=200" | jq --arg f "$F153" '[.rows[]|select(.faktur_id==$f)][0]')
cek "dasar uji: 3 batch × 700 ml tersimpan sebagai qty 2.100 ml" "abs(V - 2100) < 0.001" \
  "$(echo "$BARIS153" | jq -r '.qty')"
cek "baris produksi membawa batch = 3 (bukan hanya qty)" "abs(V - 3) < 0.001" \
  "$(echo "$BARIS153" | jq -r '.batch')"
cek "batch_teks ditulis server: '3 batch × 700 ml'" "V == 1" \
  "$(echo "$BARIS153" | jq -r '(.batch_teks == "3 batch × 700 ml")|if . then 1 else 0 end')"
cek "qty_teks TETAP satuan kerja — batch tak menggantikannya" "V == 1" \
  "$(echo "$BARIS153" | jq -r '(.qty_teks == "2.100 ml")|if . then 1 else 0 end')"
# bahan BELI tak punya batch: membaginya akan mengarang pekerjaan yang tak ada
FB153=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK153\",\"items\":[{\"ingredient_id\":\"$MENTAH153\",\"mode\":\"pcs\",\"jumlah\":2000,\"total_harga\":80000}]}" | jq -r .faktur_id)
cek "bahan BELI: batch & batch_teks null (bukan angka karangan)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK153&per_page=200" | jq -r --arg f "$FB153" '[.rows[]|select(.faktur_id==$f)][0] | ((.batch == null) and (.batch_teks == null))|if . then 1 else 0 end')"


echo
echo "── §154 Papan Pesanan Masuk: status per SAJIAN, bukan per bill ──"
# Sebelum ini dapur tak punya layar kerja apa pun: pesanan yang masih open bill
# HANYA terlihat kasir (/open-bill dijaga requireRole("cashier")), jadi pesanan
# "tertinggal" tanpa ada tempat untuk mengeceknya.
#
# Status setingkat bill pun ternyata belum cukup: satu bill berisi minuman yang
# keluar duluan dan gorengan yang menyusul, jadi satu tombol "selesai" untuk
# seluruh bill memaksa dapur berbohong sampai sajian terakhir jadi — dan tak ada
# yang bisa tahu mana yang sudah keluar. Status kini hidup di TIAP BARIS; status
# kartu hanyalah TURUNAN barisnya, jadi tak ada agregat yang bisa basi.
CB154=$(api "$REISS105" GET /auth/me | jq -r '.user.branch_id')
# menu BERBAHAN — supaya uji "penanda tak menggeser stok" punya angka nyata
M154=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji154\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":12000,\"komponen\":[{\"ingredient_id\":\"$MENTAH153\",\"qty\":10}]}" | jq -r .id)
# baris KEDUA bernama beda: seluruh bagian ini bertumpu pada kemampuan
# membedakan "sajian MANA yang sudah keluar"
M154B=$(api "$OWNER" POST /menu "{\"nama\":\"Minum Uji154\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":8000,\"komponen\":[]}" | jq -r .id)
saldo154() { api "$OWNER" GET "/stok?branch_id=$CB154" | jq -r --arg i "$MENTAH153" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
kartu154() { api "$1" GET "/pesanan?branch_id=$CB154" | jq --arg id "$2" '[.[]|select(.id==$id)][0]'; }
# meja DINE-IN eksplisit: uji (f) membuktikan penanda bawa-pulang TIDAK membalik
# is_dine_in, jadi transaksinya harus benar-benar lahir sebagai dine-in
MEJA154=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.is_active and .tipe=="dine_in")][0].id')
if [ -z "$(api "$REISS105" GET /shift/aktif | jq -r '.id // empty')" ]; then
  pastikanHadir "$REISS105" "§154"
  api "$REISS105" POST /shift/buka '{"modal_awal":0}' > /dev/null 2>&1 || true
fi

# (a) Bill yang baru dibuat kasir MUNCUL di papan lengkap dengan isinya — dan
#     tiap barisnya membawa id + statusnya sendiri.
OB154=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":2,\"catatan\":\"pedas\"},{\"menu_id\":\"$M154B\",\"qty\":1}]}")
OBID154=$(echo "$OB154" | jq -r .id)
P154=$(kartu154 "$OWNER" "$OBID154")
cek "bill belum dibayar tampil di papan: jenis open_bill, dibayar=false" "V == 1" \
  "$(echo "$P154" | jq -r '((.jenis=="open_bill") and (.dibayar==false) and (.status=="dikerjakan") and (.nomor==null))|if . then 1 else 0 end')"
cek "kartu membawa ITEM + catatan per baris (papan tak perlu N+1)" "V == 1" \
  "$(echo "$P154" | jq -r '((.items|length)==2) and ([.items[]|select(.nama=="Menu Uji154")][0].catatan=="pedas") and (.total==32000)|if . then 1 else 0 end')"
cek "tiap baris ber-id sendiri, lahir 'dikerjakan' & belum bertanda bawa pulang" "V == 2" \
  "$(echo "$P154" | jq '[.items[]|select((.id!=null) and (.status=="dikerjakan") and (.sajian_takeaway==false))]|length')"
cek "ringkasan kartu lahir 0 selesai / 0 batal" "V == 1" \
  "$(echo "$P154" | jq -r '((.item_selesai==0) and (.item_batal==0))|if . then 1 else 0 end')"

# (b) Dapur boleh membaca papan; pintu /open-bill yang lama TETAP tertutup.
api "$OWNER" POST /karyawan "{\"nama\":\"Dapur 154\",\"email\":\"kitchen154@basooopa.id\",\"password\":\"Dapur154!\",\"role\":\"kitchen\",\"branch_id\":\"$CB154\"}" > /dev/null
TKIT154=$(login kitchen154@basooopa.id 'Dapur154!')
cek "kitchen GET /pesanan → 200 (layar kerja dapur terbuka)" "V == 200" \
  "$(status_code "$TKIT154" GET /pesanan)"
cek "kitchen GET /open-bill → 403 (gerbang kasir-saja tak dilonggarkan)" "V == 403" \
  "$(status_code "$TKIT154" GET /open-bill)"
cek "kitchen melihat bill cabangnya sendiri di papan" "V == 1" \
  "$(api "$TKIT154" GET /pesanan | jq --arg id "$OBID154" '[.[]|select(.id==$id)]|length')"

# (c) INTI PERMINTAAN: "selesai bisa kirim satu satu dan kita tau mana yang
#     sudah dan mana yang belum". Satu sajian ditandai, sisanya TIDAK ikut.
BR154A=$(echo "$P154" | jq -r '[.items[]|select(.nama=="Menu Uji154")][0].id')
BR154B=$(echo "$P154" | jq -r '[.items[]|select(.nama=="Minum Uji154")][0].id')
api "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$BR154B/status" '{"status":"selesai"}' > /dev/null
PS154=$(kartu154 "$TKIT154" "$OBID154")
cek "SATU sajian selesai: barisnya selesai, yang lain MASIH dikerjakan" "V == 1" \
  "$(echo "$PS154" | jq -r --arg a "$BR154A" --arg b "$BR154B" '(([.items[]|select(.id==$b)][0].status=="selesai") and ([.items[]|select(.id==$a)][0].status=="dikerjakan"))|if . then 1 else 0 end')"
cek "kartu BELUM selesai selama masih ada sajian berjalan (1/2 selesai)" "V == 1" \
  "$(echo "$PS154" | jq -r '((.status=="dikerjakan") and (.item_selesai==1) and (.item_batal==0))|if . then 1 else 0 end')"
cek "baris membawa siapa & kapan yang menandainya" "V == 1" \
  "$(echo "$PS154" | jq -r --arg b "$BR154B" '[.items[]|select(.id==$b)][0] | ((.status_oleh=="Dapur 154") and (.status_pada!=null))|if . then 1 else 0 end')"
cek "riwayat menyebut SAJIAN MANA yang ditandai, bukan cuma aksinya" "V == 1" \
  "$(api "$TKIT154" GET "/pesanan/open_bill/$OBID154/log" | jq '[.[]|select(.oleh=="Dapur 154" and .aksi=="Ditandai selesai" and .item_nama=="Minum Uji154")]|length')"
# baris yang sama ditandai ulang (dobel-klik) → idempoten, riwayat tak menggelembung
api "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$BR154B/status" '{"status":"selesai"}' > /dev/null
cek "baris sama ditandai ulang: riwayat TETAP satu baris (bukan dua)" "V == 1" \
  "$(api "$TKIT154" GET "/pesanan/open_bill/$OBID154/log" | jq '[.[]|select(.aksi=="Ditandai selesai" and .item_nama=="Minum Uji154")]|length')"
cek "baris yang bukan milik kartu ini → 404 (tak bisa menandai punya orang)" "V == 404" \
  "$(status_code_body "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$(uuid99)/status" '{"status":"selesai"}')"
# sajian TERAKHIR → baru kartunya pindah ke kolom Selesai
api "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$BR154A/status" '{"status":"selesai"}' > /dev/null
cek "sajian terakhir selesai → kartu ikut selesai (turunan, bukan tombol lain)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154" | jq -r '((.status=="selesai") and (.item_selesai==2))|if . then 1 else 0 end')"

# (d) Penanda BAWA PULANG juga per baris — satu piring yang tetap di tempat
#     sudah cukup membuat pesanan ini bukan pesanan bawa pulang.
api "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$BR154A/sajian" '{"takeaway":true}' > /dev/null
cek "satu baris dibungkus: barisnya bertanda, KARTUNYA belum" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154" | jq -r --arg a "$BR154A" '(([.items[]|select(.id==$a)][0].sajian_takeaway==true) and (.sajian_takeaway==false))|if . then 1 else 0 end')"
api "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$BR154B/sajian" '{"takeaway":true}' > /dev/null
cek "seluruh baris dibungkus → kartu baru bertanda bawa pulang" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154" | jq -r '.sajian_takeaway|if . then 1 else 0 end')"

# (e) DIBAYAR: pekerjaan dapur pindah PER BARIS ke penjualannya. Satu baris
#     sengaja dikembalikan ke antrean dulu — kalau pewarisannya setingkat bill,
#     yang sudah selesai akan ikut terseret mundur (atau sebaliknya).
api "$TKIT154" POST "/pesanan/open_bill/$OBID154/item/$BR154A/status" '{"status":"dikerjakan"}' > /dev/null
S154=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA154\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":2,\"open_bill_item_id\":\"$BR154A\"},{\"menu_id\":\"$M154B\",\"qty\":1,\"open_bill_item_id\":\"$BR154B\"}]}")
SID154=$(echo "$S154" | jq -r '.sale.id')
PAPAN154=$(api "$OWNER" GET "/pesanan?branch_id=$CB154")
cek "bill hilang dari papan setelah dibayar (bukan kartu ganda)" "V == 0" \
  "$(echo "$PAPAN154" | jq --arg id "$OBID154" '[.[]|select(.id==$id)]|length')"
PJ154=$(echo "$PAPAN154" | jq --arg id "$SID154" '[.[]|select(.id==$id)][0]')
cek "penjualan lahir sebagai kartu berbayar bernomor struk" "V == 1" \
  "$(echo "$PJ154" | jq -r '((.jenis=="penjualan") and (.dibayar==true) and (.nomor!=null))|if . then 1 else 0 end')"
cek "PEKERJAAN DAPUR DIWARISI PER BARIS (yang selesai tak kembali ke antrean)" "V == 1" \
  "$(echo "$PJ154" | jq -r '(([.items[]|select(.nama=="Minum Uji154")][0].status=="selesai") and ([.items[]|select(.nama=="Menu Uji154")][0].status=="dikerjakan") and (.status=="dikerjakan") and (.item_selesai==1))|if . then 1 else 0 end')"
cek "penanda bawa pulang tiap baris ikut terbawa" "V == 2" \
  "$(echo "$PJ154" | jq '[.items[]|select(.sajian_takeaway==true)]|length')"
cek "is_dine_in TIDAK ikut dibalik — pembukuan tetap dine-in" "V == 1" \
  "$(echo "$PJ154" | jq -r '.is_dine_in|if . then 1 else 0 end')"
cek "riwayat penjualan menyertakan jejak SEBELUM dibayar (lewat asal bill)" "V == 1" \
  "$(api "$OWNER" GET "/pesanan/penjualan/$SID154/log" | jq '[.[]|select(.aksi=="Ditandai selesai" and .item_nama!=null)]|length>=1|if . then 1 else 0 end')"
cek "bill yang sudah dibayar hilang juga dari pemilih kasir (bukan bill hantu)" "V == 0" \
  "$(api "$REISS105" GET /open-bill | jq --arg id "$OBID154" '[.[]|select(.id==$id)]|length')"
cek "menandai bill yang SUDAH dibayar → 409 (kartunya ada di penjualan)" "V == 409" \
  "$(status_code_body "$TKIT154" POST "/pesanan/open_bill/$OBID154/status" '{"status":"dikerjakan"}')"

# (f) Mengubah penyajian menggeser biaya HANYA lewat aturan dine-in — jadi menu
#     yang resepnya TAK PUNYA kemasan/pelengkap tidak boleh bergerak sepeser
#     pun. Resep Menu Uji154 cuma cabai biasa (bukan kemasan, bukan pelengkap),
#     jadi `qtyEfektif` mengembalikan takaran yang sama untuk kedua cara
#     penyajian. Kalau angka di sini bergerak, hitung-ulangnya salah kaprah:
#     ia mengarang biaya alih-alih menerapkan aturan take away.
#     (Kasus kemasan yang MEMANG harus bergerak diuji di §156.)
HPP154A=$(api "$OWNER" GET "/penjualan/$SID154" | jq -r '[.items[].hppSatuan]|add')
SALDO154A=$(saldo154)
api "$OWNER" POST "/pesanan/penjualan/$SID154/sajian" '{"takeaway":false}' > /dev/null
cek "resep tanpa kemasan: saldo bahan cabang sama persis sebelum & sesudah" "abs(V) < 0.001" \
  "$(python3 -c "print($(saldo154) - $SALDO154A)")"
cek "resep tanpa kemasan: hpp_satuan tak bergeser sepeser pun" "abs(V) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET "/penjualan/$SID154" | jq -r '[.items[].hppSatuan]|add') - $HPP154A)")"
cek "tombol 'semua': SELURUH baris kembali makan di tempat, is_dine_in utuh" "V == 1" \
  "$(kartu154 "$OWNER" "$SID154" | jq -r '((.sajian_takeaway==false) and (.is_dine_in==true) and (([.items[]|select(.sajian_takeaway==false)]|length)==2))|if . then 1 else 0 end')"
cek "Riwayat Transaksi ikut membawa sajian_takeaway (badge 'diubah')" "V == 1" \
  "$(api "$REISS105" GET /penjualan | jq -r --arg id "$SID154" '[.[]|select(.id==$id)][0] | ((.sajian_takeaway|type)=="boolean")|if . then 1 else 0 end')"
# Pintasan "semua" tetap ada — pesanan satu-dua sajian adalah mayoritas, dan
# menekan tombol per baris untuk itu melelahkan.
api "$TKIT154" POST "/pesanan/penjualan/$SID154/status" '{"status":"selesai"}' > /dev/null
cek "tombol 'semua selesai' menurun ke tiap baris, kartu jadi selesai" "V == 1" \
  "$(kartu154 "$TKIT154" "$SID154" | jq -r '((.status=="selesai") and (.item_selesai==2))|if . then 1 else 0 end')"

# (f2) PISAH PORSI: satu baris bill dipecah jadi beberapa baris penjualan
#      (3 porsi = 2 di piring + 1 dibungkus). `open_bill_item_id` yang SAMA
#      dipakai bersama oleh baris-baris pecahannya — dan itu memang jalannya:
#      memecah porsi adalah keputusan PENGEMASAN saat bayar, bukan pesanan baru.
#
#      Dua hal ikut hancur kalau baris pecahan dibiarkan TANPA id:
#        1. harga terkuncinya lepas → pembeli ditagih harga hari pembayaran,
#           padahal ia memesan di harga yang lain;
#        2. pewarisan status lepas → sajian yang SUDAH selesai kembali ke
#           antrean dapur begitu pelanggan membayar.
#      Blok ini mengunci keduanya.
OB154P=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":3}]}")
OBID154P=$(echo "$OB154P" | jq -r .id)
BR154P=$(echo "$OB154P" | jq -r '.items[0].id')
cek "bill pisah-porsi terkunci di harga hari pesan (12000)" "V == 12000"   "$(echo "$OB154P" | jq -r '.items[0].harga_satuan')"
api "$TKIT154" POST "/pesanan/open_bill/$OBID154P/item/$BR154P/status" '{"status":"selesai"}' > /dev/null
# Harga menu NAIK setelah tamu memesan — inilah yang membuat kuncinya berarti.
api "$OWNER" PUT "/menu/$M154" '{"harga_jual":20000}' > /dev/null
# Bayar: satu baris bill → DUA baris penjualan, id-nya dipakai bersama.
S154P=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA154\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID154P\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":2,\"open_bill_item_id\":\"$BR154P\",\"is_dine_in\":true},{\"menu_id\":\"$M154\",\"qty\":1,\"open_bill_item_id\":\"$BR154P\",\"is_dine_in\":false}]}")
SID154P=$(echo "$S154P" | jq -r '.sale.id')
cek "pisah porsi diterima → 201 (bukan ditolak karena id dipakai dua kali)" "V == 1"   "$(test "$SID154P" != "null" && echo 1 || echo 0)"
D154P=$(api "$OWNER" GET "/penjualan/$SID154P")
cek "KEDUA baris pecahan ditagih harga TERKUNCI 12000 (bukan 20000)" "V == 2"   "$(echo "$D154P" | jq '[.items[]|select(.hargaSatuan==12000)]|length')"
cek "subtotal 3 × 12000 = 36000 (bukan 3 × 20000)" "V == 36000"   "$(echo "$D154P" | jq '.sale.subtotal')"
PJ154P=$(api "$OWNER" GET "/pesanan?branch_id=$CB154" | jq --arg id "$SID154P" '[.[]|select(.id==$id)][0]')
cek "KEDUA baris pecahan mewarisi 'selesai' (tak kembali ke antrean dapur)" "V == 1"   "$(echo "$PJ154P" | jq -r '((.status=="selesai") and (.item_selesai==2))|if . then 1 else 0 end')"
cek "penanda penyajian tetap per baris: 1 dibungkus, 1 di piring" "V == 1"   "$(echo "$PJ154P" | jq -r '((([.items[]|select(.sajian_takeaway==true)]|length)==1) and (([.items[]|select(.sajian_takeaway==false)]|length)==1))|if . then 1 else 0 end')"
# Cacah baris per cara penyajian — permintaan tim mobile: `bool_and` tak bisa
# membedakan "semuanya di piring" dari "sebagian dibungkus", keduanya false.
R154P=$(api "$REISS105" GET /penjualan | jq --arg id "$SID154P" '[.[]|select(.id==$id)][0]')
cek "Riwayat: item_takeaway=1, item_dine_in=1, badge mutlak tetap false" "V == 1"   "$(echo "$R154P" | jq -r '((.item_takeaway==1) and (.item_dine_in==1) and (.sajian_takeaway==false))|if . then 1 else 0 end')"
cek "item_takeaway + item_dine_in == jumlah_item" "V == 1"   "$(echo "$R154P" | jq -r '((.item_takeaway + .item_dine_in)==.jumlah_item)|if . then 1 else 0 end')"
api "$OWNER" PUT "/menu/$M154" '{"harga_jual":12000}' > /dev/null

# (f3) PISAH PORSI DI `PUT` — kasir memisah porsi lalu menekan "Perbarui Open
#      Bill" alih-alih membayar. Di pembayaran id boleh berulang (lihat f2),
#      tapi di PUT `items[].id` adalah kunci PASANGAN dan hakikatnya 1:1 —
#      dikirim dua kali ditolak. `pisah_dari` adalah kunci WARISAN yang memang
#      boleh berulang, jadi porsi pecahan tetap membawa harga terkunci & status
#      dapurnya tanpa membuat pasangan baris jadi ambigu.
OB154Q=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":3}]}")
OBID154Q=$(echo "$OB154Q" | jq -r .id)
BR154Q=$(echo "$OB154Q" | jq -r '.items[0].id')
api "$TKIT154" POST "/pesanan/open_bill/$OBID154Q/item/$BR154Q/status" '{"status":"selesai"}' > /dev/null
api "$OWNER" PUT "/menu/$M154" '{"harga_jual":20000}' > /dev/null
cek "PUT id yang sama dua kali → 400 (pasangan baris jadi ambigu)" "V == 400" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID154Q" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":2},{\"id\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":1}]}")"
cek "PUT id + pisah_dari sekaligus → 400 (dua maksud bertabrakan)" "V == 400" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID154Q" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BR154Q\",\"pisah_dari\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":3}]}")"
cek "pisah_dari beda menu → 400" "V == 400" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID154Q" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":2},{\"pisah_dari\":\"$BR154Q\",\"menu_id\":\"$M154B\",\"qty\":1}]}")"
cek "pisah_dari di POST bill BARU → 400 (belum ada baris utk diwarisi)" "V == 400" \
  "$(status_code_body "$REISS105" POST /open-bill "{\"items\":[{\"pisah_dari\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":1}]}")"
# Jalan yang benar: baris asal tetap ber-`id`, pecahannya ber-`pisah_dari`.
OBP154=$(api "$REISS105" PUT "/open-bill/$OBID154Q" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":2},{\"pisah_dari\":\"$BR154Q\",\"menu_id\":\"$M154\",\"qty\":1,\"dine_in_override\":false}]}")
cek "bill jadi DUA baris (2 + 1), tak ada yang hilang" "V == 1" \
  "$(echo "$OBP154" | jq -r '(((.items|length)==2) and (([.items[].qty]|sort)==[1,2]))|if . then 1 else 0 end')"
cek "KEDUA baris berharga TERKUNCI 12000 (pecahan tak kena 20000)" "V == 2" \
  "$(echo "$OBP154" | jq '[.items[]|select(.harga_satuan==12000)]|length')"
cek "baris pecahan bertanda bawa pulang lewat dine_in_override" "V == 1" \
  "$(echo "$OBP154" | jq '[.items[]|select(.dine_in_override==false and .qty==1)]|length')"
cek "baris pecahan MEWARISI 'selesai' (tak kembali ke antrean dapur)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154Q" | jq -r '((.status=="selesai") and (.item_selesai==2))|if . then 1 else 0 end')"
# Dibayar: harga terkuncinya bertahan sampai nota.
BRQ1=$(echo "$OBP154" | jq -r '[.items[]|select(.qty==2)][0].id')
BRQ2=$(echo "$OBP154" | jq -r '[.items[]|select(.qty==1)][0].id')
SQ154=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA154\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID154Q\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":2,\"open_bill_item_id\":\"$BRQ1\"},{\"menu_id\":\"$M154\",\"qty\":1,\"open_bill_item_id\":\"$BRQ2\",\"is_dine_in\":false}]}")
cek "nota pisah-porsi-lewat-PUT: subtotal 3 × 12000 = 36000" "V == 36000" \
  "$(echo "$SQ154" | jq '.sale.subtotal')"
api "$OWNER" PUT "/menu/$M154" '{"harga_jual":12000}' > /dev/null

# (f4) BARIS BILL TAK BISA DIHAPUS LEWAT `PUT`. Bill tayang di papan dapur
#      begitu disimpan, jadi tiap barisnya sudah dilihat — bisa jadi sudah
#      dimasak. Dulu baris yang tak dikirim ulang di-hard-delete: pekerjaan dapur
#      lenyap dari papan tanpa jejak siapa pun. Membatalkan satu sajian jalurnya
#      papan pesanan, yang menyimpan pelaku & waktunya.
OB154H=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"customer_nama\":\"Bu Sri 154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1},{\"menu_id\":\"$M154B\",\"qty\":1}]}")
OBID154H=$(echo "$OB154H" | jq -r .id)
BH1=$(echo "$OB154H" | jq -r --arg m "$M154" '[.items[]|select(.menu_id==$m)][0].id')
BH2=$(echo "$OB154H" | jq -r --arg m "$M154B" '[.items[]|select(.menu_id==$m)][0].id')
cek "PUT tanpa salah satu baris bill → 400 (bukan dihapus diam-diam)" "V == 400" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID154H" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BH1\",\"menu_id\":\"$M154\",\"qty\":1}]}")"
cek "badan galat berkode mesin + item_ids yang menolak dihapus" "V == 1" \
  "$(api "$REISS105" PUT "/open-bill/$OBID154H" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BH1\",\"menu_id\":\"$M154\",\"qty\":1}]}" | jq -r --arg b "$BH2" '((.kode=="baris_bill_tak_bisa_dihapus") and ([.item_ids[]]|index($b)!=null))|if . then 1 else 0 end')"
# DITOLAK = TIDAK ADA YANG BERUBAH. Galat di tengah transaksi tak me-rollback
# `update` yang sudah jalan, jadi penjagaannya harus di depan semua mutasi —
# assertion ini yang membuktikannya.
cek "ditolak: kedua baris MASIH ada, qty & nama konsumen tak bergeser" "V == 1" \
  "$(api "$REISS105" GET "/open-bill/$OBID154H" | jq -r '(((.items|length)==2) and ([.items[].qty]|add==2) and (.customer_nama=="Bu Sri 154"))|if . then 1 else 0 end')"
# Jalan yang BENAR: batalkan sajiannya di papan pesanan — barisnya tetap ada.
api "$TKIT154" POST "/pesanan/open_bill/$OBID154H/item/$BH2/status" '{"status":"batal"}' > /dev/null
cek "batal lewat papan: baris tetap ada, statusnya batal (berjejak)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154H" | jq -r --arg b "$BH2" '((([.items[]]|length)==2) and ([.items[]|select(.id==$b)][0].status=="batal"))|if . then 1 else 0 end')"
cek "PUT masih boleh menambah pesanan (yang dilarang cuma menghapus)" "V == 200" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID154H" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BH1\",\"menu_id\":\"$M154\",\"qty\":2},{\"id\":\"$BH2\",\"menu_id\":\"$M154B\",\"qty\":1},{\"menu_id\":\"$M154\",\"qty\":1}]}")"
cek "seluruh bill dibatalkan tetap boleh lewat DELETE" "V == 200" \
  "$(status_code_body "$REISS105" DELETE "/open-bill/$OBID154H" '')"
# MENU DIARSIPKAN setelah bill dibuat — pasangan wajib dari penjagaan di atas.
# `GET /menu` menyaring menu nonaktif, jadi klien yang membuang baris tanpa
# pasangan katalog akan mengirim PUT tanpa baris itu dan kini kena 400: kasir
# tak bisa memperbarui bill sama sekali. Server HARUS tetap menerima barisnya,
# dan klien HARUS menyusunnya dari snapshot bill (`menu_nama`+`harga_satuan`).
OB154Z=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154B\",\"qty\":1}]}")
OBID154Z=$(echo "$OB154Z" | jq -r .id)
BZ1=$(echo "$OB154Z" | jq -r '.items[0].id')
api "$OWNER" PUT "/menu/$M154B" '{"is_active":false}' > /dev/null
cek "menu diarsipkan: hilang dari GET /menu (sebab bug klien dulu)" "V == 0" \
  "$(api "$REISS105" GET /menu | jq --arg m "$M154B" '[.[]|select(.id==$m)]|length')"
cek "baris bill-nya TETAP ada di GET /open-bill/:id (dengan snapshot namanya)" "V == 1" \
  "$(api "$REISS105" GET "/open-bill/$OBID154Z" | jq -r --arg b "$BZ1" '[.items[]|select(.id==$b and (.menu_nama|length>0))]|length')"
cek "PUT bill bermenu-arsip masih 200 (kasir tak terkunci)" "V == 200" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBID154Z" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BZ1\",\"menu_id\":\"$M154B\",\"qty\":3}]}")"
cek "qty-nya benar-benar tersimpan, harga terkunci tak bergeser" "V == 1" \
  "$(api "$REISS105" GET "/open-bill/$OBID154Z" | jq -r --arg b "$BZ1" '[.items[]|select(.id==$b)][0] | ((.qty==3) and (.harga_satuan==8000))|if . then 1 else 0 end')"
api "$OWNER" PUT "/menu/$M154B" '{"is_active":true}' > /dev/null
api "$REISS105" DELETE "/open-bill/$OBID154Z" > /dev/null

# (g) BATAL per baris. Bill baru boleh lepas dari pemilih kasir saat TAK ADA
#     LAGI yang bisa ditagih — satu baris batal tidak menghapus tagihannya.
OB154B=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1},{\"menu_id\":\"$M154B\",\"qty\":1}]}")
OBID154B=$(echo "$OB154B" | jq -r .id)
PB154=$(kartu154 "$TKIT154" "$OBID154B")
BB154A=$(echo "$PB154" | jq -r '[.items[]|select(.nama=="Menu Uji154")][0].id')
BB154B=$(echo "$PB154" | jq -r '[.items[]|select(.nama=="Minum Uji154")][0].id')
api "$TKIT154" POST "/pesanan/open_bill/$OBID154B/item/$BB154A/status" '{"status":"batal"}' > /dev/null
cek "satu sajian batal: kartu MASIH berjalan (1 batal, 1 jalan)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154B" | jq -r '((.status=="dikerjakan") and (.item_batal==1))|if . then 1 else 0 end')"
cek "bill dengan satu baris batal TETAP di pemilih kasir (masih ada yang ditagih)" "V == 1" \
  "$(api "$REISS105" GET /open-bill | jq --arg id "$OBID154B" '[.[]|select(.id==$id)]|length')"
api "$TKIT154" POST "/pesanan/open_bill/$OBID154B/item/$BB154B/status" '{"status":"batal"}' > /dev/null
cek "SELURUH sajian batal → kartu batal, MASIH di papan (ada jejaknya)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154B" | jq -r '((.status=="batal") and (.item_batal==2))|if . then 1 else 0 end')"
cek "batal seluruhnya: hilang dari pemilih kasir (tak bisa ditagihkan)" "V == 0" \
  "$(api "$REISS105" GET /open-bill | jq --arg id "$OBID154B" '[.[]|select(.id==$id)]|length')"
api "$TKIT154" POST "/pesanan/open_bill/$OBID154B/item/$BB154B/status" '{"status":"dikerjakan"}' > /dev/null
cek "satu baris dikembalikan: bill terbuka lagi utk kasir (tak terkunci selamanya)" "V == 1" \
  "$(api "$REISS105" GET /open-bill | jq --arg id "$OBID154B" '[.[]|select(.id==$id)]|length')"
# DELETE lama = batalkan bercatatan, bukan hapus keras tanpa jejak
api "$REISS105" DELETE "/open-bill/$OBID154B" > /dev/null
cek "DELETE /open-bill membatalkan SELURUH barisnya, bukan hapus keras" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154B" | jq -r '((.status=="batal") and (.item_batal==2))|if . then 1 else 0 end')"
cek "pembatalan lewat DELETE tetap meninggalkan baris riwayat" "V == 1" \
  "$(api "$TKIT154" GET "/pesanan/open_bill/$OBID154B/log" | jq '[.[]|select(.aksi|startswith("Dibatalkan"))]|length>=1|if . then 1 else 0 end')"

# (g2) "PINDAHKAN KE SELESAI" TIDAK MENGHIDUPKAN SAJIAN YANG SUDAH DIBATALKAN.
#      Menandai sebuah pesanan kelar bukan alasan membuat porsi yang dibatalkan
#      jadi "selesai" — porsinya tak pernah keluar dari dapur, dan papan yang
#      mengklaim sebaliknya berbohong tentang apa yang disajikan. Kartunya tetap
#      pindah ke kolom Selesai, karena status kartu hanya menuntut tak ada lagi
#      baris `dikerjakan`.
OB154P=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1},{\"menu_id\":\"$M154B\",\"qty\":1}]}")
OBID154P=$(echo "$OB154P" | jq -r .id)
PP154=$(kartu154 "$TKIT154" "$OBID154P")
BP154A=$(echo "$PP154" | jq -r '[.items[]|select(.nama=="Menu Uji154")][0].id')
api "$TKIT154" POST "/pesanan/open_bill/$OBID154P/item/$BP154A/status" '{"status":"batal"}' > /dev/null
cek "pindahkan-ke-selesai seluruh kartu → 200" "V == 200" \
  "$(status_code_body "$TKIT154" POST "/pesanan/open_bill/$OBID154P/status" '{"status":"selesai"}')"
cek "baris yang batal TETAP batal (tidak dihidupkan jadi selesai)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154P" | jq -r --arg b "$BP154A" '[.items[]|select(.id==$b)][0].status=="batal"|if . then 1 else 0 end')"
cek "baris yang masih dikerjakan jadi selesai (1 selesai, 1 batal)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154P" | jq -r '((.item_selesai==1) and (.item_batal==1))|if . then 1 else 0 end')"
cek "kartunya tetap PINDAH ke kolom Selesai" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154P" | jq -r '.status=="selesai"|if . then 1 else 0 end')"

# (g3) URUTAN PAPAN: yang TERAKHIR DIUBAH di atas, bukan yang terakhir masuk.
#      Dapur menandai sajian sepanjang shift; kartu yang baru disentuh adalah
#      kartu yang sedang dikerjakan orang, dan itu yang harus ada di depan mata.
#
#      Diuji RELATIF antara dua kartu yang bagian ini sendiri buat — bukan lewat
#      `.[0]`. Papan cabang ini juga menampung kartu dari bagian lain, jadi
#      assertion "paling atas" akan lolos/gagal karena data tetangga dan bukan
#      karena aturannya.
urut154() { api "$TKIT154" GET "/pesanan?branch_id=$CB154" | jq --arg i "$2" '[.[].id]|index($i)'; }
# TANPA meja: OBID154P masih memegang MEJA154, dan satu meja dine-in cuma boleh
# punya satu bill (409 `meja_sudah_ada_bill`). Bill tanpa meja dikecualikan.
OB154U=$(api "$REISS105" POST /open-bill "{\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}")
OBID154U=$(echo "$OB154U" | jq -r '.id // empty')
cek "bill pembanding berhasil dibuat (tanpa meja, jadi tak kena guard satu-bill)" "V == 1" \
  "$([ -n "$OBID154U" ] && echo 1 || echo 0)"
cek "pesanan yang baru masuk ada DI ATAS kartu yang lebih tua" "V == 1" \
  "$([ "$(urut154 "$TKIT154" "$OBID154U")" -lt "$(urut154 "$TKIT154" "$OBID154P")" ] && echo 1 || echo 0)"
# sentuh kartu YANG LEBIH TUA → ia harus melompat ke atas kartu yang lebih baru
BU154=$(kartu154 "$TKIT154" "$OBID154P" | jq -r '[.items[]|select(.status=="selesai")][0].id')
api "$TKIT154" POST "/pesanan/open_bill/$OBID154P/item/$BU154/status" '{"status":"dikerjakan"}' > /dev/null
cek "kartu lama yang BARU DIUBAH melompat ke atas kartu yang lebih baru" "V == 1" \
  "$([ "$(urut154 "$TKIT154" "$OBID154P")" -lt "$(urut154 "$TKIT154" "$OBID154U")" ] && echo 1 || echo 0)"
cek "kartu yang belum disentuh tetap ada di papan (tidak lenyap)" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154U" | jq -r 'if .id then 1 else 0 end')"
api "$REISS105" DELETE "/open-bill/$OBID154U" > /dev/null
api "$REISS105" DELETE "/open-bill/$OBID154P" > /dev/null

# (g4) PENANDA TAKE AWAY KASIR HARUS TERBACA DI PAPAN, SEJAK BILL MASIH TERBUKA.
#      Kasir menandai SATU baris take away (`dine_in_override:false`); dulu
#      `sajian_takeaway` dibiarkan default false, jadi papan menandai SEMUA baris
#      "di tempat" dan baru benar setelah dibayar — telat, makanannya sudah
#      keluar di piring.
OB154T=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1,\"dine_in_override\":false},{\"menu_id\":\"$M154B\",\"qty\":1}]}")
OBID154T=$(echo "$OB154T" | jq -r .id)
PT154=$(kartu154 "$TKIT154" "$OBID154T")
cek "baris yang ditandai kasir take away → papan ikut 🥡 (bukan di tempat)" "V == 1" \
  "$(echo "$PT154" | jq -r '[.items[]|select(.nama=="Menu Uji154")][0].sajian_takeaway|if . then 1 else 0 end')"
cek "baris LAIN tetap di tempat (tidak ikut terbawa)" "V == 0" \
  "$(echo "$PT154" | jq -r '[.items[]|select(.nama=="Minum Uji154")][0].sajian_takeaway|if . then 1 else 0 end')"
cek "kartu BUKAN 'semua bawa pulang' (baru satu baris)" "V == 0" \
  "$(echo "$PT154" | jq -r '.sajian_takeaway|if . then 1 else 0 end')"
# Dapur menekan 🍽 pada baris itu → keputusan dapur menang…
BT154=$(echo "$PT154" | jq -r '[.items[]|select(.nama=="Menu Uji154")][0].id')
api "$TKIT154" POST "/pesanan/open_bill/$OBID154T/item/$BT154/sajian" '{"takeaway":false}' > /dev/null
cek "dapur boleh mengoreksi jadi di tempat" "V == 0" \
  "$(kartu154 "$TKIT154" "$OBID154T" | jq -r --arg b "$BT154" '[.items[]|select(.id==$b)][0].sajian_takeaway|if . then 1 else 0 end')"
# …dan PUT yang TIDAK mengubah dine_in_override tak boleh menimpanya kembali.
api "$REISS105" PUT "/open-bill/$OBID154T" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BT154\",\"menu_id\":\"$M154\",\"qty\":2,\"dine_in_override\":false},{\"menu_id\":\"$M154B\",\"qty\":1}]}" > /dev/null
cek "PUT tanpa mengubah pilihan kasir TIDAK menimpa koreksi dapur" "V == 0" \
  "$(kartu154 "$TKIT154" "$OBID154T" | jq -r --arg b "$BT154" '[.items[]|select(.id==$b)][0].sajian_takeaway|if . then 1 else 0 end')"
# Tapi kalau kasir benar-benar MENGUBAH pilihannya, papan ikut lagi.
api "$REISS105" PUT "/open-bill/$OBID154T" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BT154\",\"menu_id\":\"$M154\",\"qty\":2,\"dine_in_override\":true},{\"menu_id\":\"$M154B\",\"qty\":1}]}" > /dev/null
api "$REISS105" PUT "/open-bill/$OBID154T" "{\"meja_id\":\"$MEJA154\",\"items\":[{\"id\":\"$BT154\",\"menu_id\":\"$M154\",\"qty\":2,\"dine_in_override\":false},{\"menu_id\":\"$M154B\",\"qty\":1}]}" > /dev/null
cek "kasir MENGUBAH pilihannya → papan ikut lagi 🥡" "V == 1" \
  "$(kartu154 "$TKIT154" "$OBID154T" | jq -r --arg b "$BT154" '[.items[]|select(.id==$b)][0].sajian_takeaway|if . then 1 else 0 end')"
api "$REISS105" DELETE "/open-bill/$OBID154T" > /dev/null

# (h) Status meja ikut turunan baris: transaksi yang SELURUH sajiannya
#     dibatalkan tak boleh menahan meja yang sudah tak ada orangnya.
MEJAC154=$(api "$OWNER" POST /meja "{\"nama\":\"Meja Batal 154\",\"tipe\":\"dine_in\",\"branch_id\":\"$CB154\"}" | jq -r .id)
SC154=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJAC154\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M154B\",\"qty\":1}]}" | jq -r '.sale.id')
cek "transaksi baru → mejanya terbaca ISI" "V == 1" \
  "$(api "$REISS105" GET "/meja/status?branch_id=$CB154" | jq -r --arg id "$MEJAC154" '[.[]|select(.meja_id==$id)][0] | (.status=="isi")|if . then 1 else 0 end')"
api "$TKIT154" POST "/pesanan/penjualan/$SC154/status" '{"status":"batal"}' > /dev/null
cek "seluruh sajian dibatalkan → mejanya ikut bebas" "V == 1" \
  "$(api "$REISS105" GET "/meja/status?branch_id=$CB154" | jq -r --arg id "$MEJAC154" '[.[]|select(.meja_id==$id)][0] | (.status=="kosong")|if . then 1 else 0 end')"

# (i) Peran terkunci cabang tak bisa menyentuh pesanan cabang lain.
OB154C=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA154\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}" | jq -r .id)
BRC154=$(kartu154 "$TKIT154" "$OB154C" | jq -r '.items[0].id')
cek "kitchen cabang LAIN tak melihat pesanan ini" "V == 0" \
  "$(api "$TBAR" GET /pesanan | jq --arg id "$OB154C" '[.[]|select(.id==$id)]|length')"
cek "kitchen cabang LAIN menandai kartunya → 404" "V == 404" \
  "$(status_code_body "$TBAR" POST "/pesanan/open_bill/$OB154C/status" '{"status":"selesai"}')"
cek "kitchen cabang LAIN menandai BARISNYA → 404" "V == 404" \
  "$(status_code_body "$TBAR" POST "/pesanan/open_bill/$OB154C/item/$BRC154/status" '{"status":"selesai"}')"
cek "peran terkunci cabang: ?branch_id= milik orang lain diabaikan" "V == 1" \
  "$(api "$TKIT154" GET "/pesanan?branch_id=$CB46_ID" | jq --arg id "$OB154C" '[.[]|select(.id==$id)]|length')"
cek "filter ?status= menyaring papan" "V == 0" \
  "$(api "$TKIT154" GET "/pesanan?status=batal" | jq --arg id "$OB154C" '[.[]|select(.id==$id)]|length')"
api "$REISS105" DELETE "/open-bill/$OB154C" > /dev/null

# (j) Penanda penyajian LAHIR sesuai pembukuannya, PER BARIS. Kalau semua baris
#     mulai dari `false`, transaksi bawa pulang akan disuruh disajikan di piring
#     dan ditandai "diubah" padahal tak seorang pun menyentuhnya.
MEJATA154=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.is_active and .tipe=="takeaway")][0].id')
STA154=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJATA154\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}" | jq -r '.sale.id')
cek "transaksi BAWA PULANG lahir bertanda bawa pulang (bukan 'makan di tempat')" "V == 1" \
  "$(kartu154 "$OWNER" "$STA154" | jq -r '((.sajian_takeaway==true) and (.is_dine_in==false))|if . then 1 else 0 end')"
SDI154=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA154\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}" | jq -r '.sale.id')
cek "transaksi DINE-IN lahir bertanda makan di tempat" "V == 1" \
  "$(kartu154 "$OWNER" "$SDI154" | jq -r '((.sajian_takeaway==false) and (.is_dine_in==true))|if . then 1 else 0 end')"
# CAMPURAN — inilah yang mustahil diwakili penanda setingkat bill: satu sajian
# dibungkus, satu disajikan di piring, dalam satu nota yang sama.
SMX154=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA154\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1,\"is_dine_in\":false},{\"menu_id\":\"$M154B\",\"qty\":1}]}" | jq -r '.sale.id')
cek "satu dibungkus satu di piring: penandanya berbeda PER BARIS" "V == 1" \
  "$(kartu154 "$OWNER" "$SMX154" | jq -r '(([.items[]|select(.nama=="Menu Uji154")][0].sajian_takeaway==true) and ([.items[]|select(.nama=="Minum Uji154")][0].sajian_takeaway==false))|if . then 1 else 0 end')"
cek "kartu campuran TIDAK dicap 'semua bawa pulang'" "V == 1" \
  "$(kartu154 "$OWNER" "$SMX154" | jq -r '.sajian_takeaway|if . then 0 else 1 end')"
cek "Riwayat Transaksi ikut jujur: transaksi campuran bukan bawa pulang" "V == 1" \
  "$(api "$REISS105" GET /penjualan | jq -r --arg id "$SMX154" '[.[]|select(.id==$id)][0].sajian_takeaway|if . then 0 else 1 end')"


echo
echo "── §155 Meja: status isi/kosong + kosongkan berjejak ──"
# Sebelum ini tak ada cara apa pun mengetahui meja mana yang kosong: tabel meja
# cuma master data, dan tak ada satu pun peristiwa di data yang menandai "tamu
# pergi". Status DIHITUNG dari tagihan & transaksi yang sudah tercatat; yang
# DISIMPAN hanya keputusan manusia "meja ini sudah saya bereskan".
CB155=$(api "$REISS105" GET /auth/me | jq -r '.user.branch_id')
M155=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji155\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":2,\"harga_jual\":15000,\"komponen\":[]}" | jq -r .id)
MEJA155=$(api "$OWNER" POST /meja "{\"nama\":\"Meja Uji155\",\"tipe\":\"dine_in\",\"branch_id\":\"$CB155\"}" | jq -r .id)
TA155=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.tipe=="takeaway")][0].id')
if [ -z "$(api "$REISS105" GET /shift/aktif | jq -r '.id // empty')" ]; then
  pastikanHadir "$REISS105" "§155"
  api "$REISS105" POST /shift/buka '{"modal_awal":0}' > /dev/null 2>&1 || true
fi
stat155() { api "$1" GET "/meja/status?branch_id=$CB155" | jq --arg id "$MEJA155" '[.[]|select(.meja_id==$id)][0]'; }

# (a) Ruang Tunggu TIDAK PUNYA status. Seluruh penjualan bawa pulang cabang
#     menunjuk ke satu baris takeaway yang tak bisa dihapus — sekali ia bisa
#     "terisi", ia terisi selamanya dan jalur bawa pulang cabang itu mati.
cek "meja takeaway (Ruang Tunggu) tak pernah muncul di papan status" "V == 0" \
  "$(api "$REISS105" GET "/meja/status?branch_id=$CB155" | jq '[.[]|select(.tipe=="takeaway")]|length')"
cek "meja baru langsung terbaca KOSONG" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.status=="kosong") and (.bill_terbuka==0) and (.transaksi_aktif==0) and (.dikosongkan_pada==null))|if . then 1 else 0 end')"

# (b) Kasir membuat pesanan → meja langsung terisi.
OB155=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":2}]}" | jq -r .id)
cek "ada bill belum dibayar → meja ISI, belum lunas" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.status=="isi") and (.bill_terbuka==1) and (.lunas_masih_duduk==false) and (.sejak!=null))|if . then 1 else 0 end')"

# (c) INTI FITUR: DIBAYAR ≠ KOSONG. Di rumah makan orang lazim bayar dulu lalu
#     duduk; kalau meja langsung hijau begitu dibayar, waiter mendudukkan tamu
#     baru di meja yang masih ada orangnya.
api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA155\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OB155\",\"customer_nama\":\"Bu Rina 155\",\"customer_wa\":\"08155000155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":2}]}" > /dev/null
cek "SUDAH DIBAYAR tapi meja TETAP ISI (tamu masih duduk)" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.status=="isi") and (.bill_terbuka==0) and (.transaksi_aktif==1) and (.lunas_masih_duduk==true))|if . then 1 else 0 end')"

# (c2) MEJA LUNAS MEMBAWA KONSUMEN TERAKHIR — bahan pilihan "tamu yang sama,
#      tambah pesanan" di kasir. Tanpa ini, tamu member yang memesan dua kali di
#      meja yang sama tercatat sebagai satu transaksi ber-member dan satu tanpa
#      member: poin/riwayatnya terputus justru pada tamu yang paling sering datang.
cek "meja lunas membawa konsumen transaksi terakhirnya" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.konsumen_nama=="Bu Rina 155") and (.konsumen_wa!=null))|if . then 1 else 0 end')"
# Transaksi BERIKUTNYA di meja yang sama → yang terbawa yang PALING BARU, bukan
# yang pertama. Kalau tertukar, kasir ditawari nama tamu yang sudah pergi.
api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA155\",\"metode_bayar\":\"tunai\",\"customer_nama\":\"Pak Joko 155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" > /dev/null
cek "konsumen yang terbawa = transaksi TERBARU (bukan yang pertama)" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '(.konsumen_nama=="Pak Joko 155")|if . then 1 else 0 end')"

# (d) Kasir mengosongkan + konfirmasi → meja siap untuk konsumen berikutnya.
cek "kasir mengosongkan meja → 200" "V == 200" \
  "$(status_code_body "$REISS105" POST "/meja/$MEJA155/kosongkan" '{}')"
cek "setelah dikosongkan: KOSONG + tercatat siapa yang membereskan" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.status=="kosong") and (.transaksi_aktif==0) and (.dikosongkan_pada!=null) and (.dikosongkan_oleh!=null))|if . then 1 else 0 end')"
cek "meja yang sudah dibereskan TIDAK lagi membawa konsumen (tamu sudah pergi)" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.konsumen_nama==null) and (.konsumen_wa==null))|if . then 1 else 0 end')"
cek "riwayat meja bertambah TEPAT satu baris ber-nama pelaku" "V == 1" \
  "$(api "$REISS105" GET "/meja/$MEJA155/log" | jq '[.[]|select(.aksi=="Meja dikosongkan" and .oleh!=null and .paksa==false)]|length')"
# tombol tertekan dua kali / dua orang berbarengan → idempoten, bukan galat,
# dan TIDAK menulis jejak kedua untuk pembersihan yang tak terjadi
cek "kosongkan lagi saat sudah kosong → 200 (bukan galat)" "V == 200" \
  "$(status_code_body "$REISS105" POST "/meja/$MEJA155/kosongkan" '{}')"
cek "dobel-klik: riwayat TETAP satu baris (bukan dua)" "V == 1" \
  "$(api "$REISS105" GET "/meja/$MEJA155/log" | jq 'length')"

# (e) "meja itu bisa di pilih untuk konsumen selanjutnya" — transaksi baru
#     setelah pengosongan MENGISI ULANG meja. Ini yang membuktikan batas
#     pengosongan bekerja: yang lama terpotong, yang baru tidak.
SB155=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA155\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" | jq -r '.sale.id')
cek "tamu berikutnya di meja yang sama → meja ISI lagi" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '((.status=="isi") and (.transaksi_aktif==1))|if . then 1 else 0 end')"
# transaksi yang DIHAPUS tak boleh menahan meja — turunan ikut Tempat Sampah
api "$OWNER" DELETE "/penjualan/$SB155" > /dev/null
cek "transaksi dibuang ke Tempat Sampah → meja ikut bebas" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '(.status=="kosong")|if . then 1 else 0 end')"

# (f) "mengosongkan meja bisa di lakukan tim ataupun kasir".
api "$OWNER" POST /karyawan "{\"nama\":\"Waiter 155\",\"email\":\"tim155@basooopa.id\",\"password\":\"Waiter155!\",\"role\":\"tim\",\"branch_id\":\"$CB155\"}" > /dev/null
TTIM155=$(login tim155@basooopa.id 'Waiter155!')
api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA155\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" > /dev/null
cek "TIM (waiter) mengosongkan meja → 200" "V == 200" \
  "$(status_code_body "$TTIM155" POST "/meja/$MEJA155/kosongkan" '{}')"
cek "meja kembali kosong atas nama waiter" "V == 1" \
  "$(stat155 "$TTIM155" | jq -r '((.status=="kosong") and (.dikosongkan_oleh=="Waiter 155"))|if . then 1 else 0 end')"

# (g) SATU MEJA DINE-IN = SATU BILL BERJALAN. Selama bill itu belum dibayar,
#     pesanan tambahan WAJIB masuk ke bill itu (PUT), bukan jadi bill kedua.
#     Dari lapangan: dua bill di satu meja bikin salah satunya tertinggal tak
#     tertagih saat tamu pulang, dan tak ada yang tahu sampai selisih muncul di
#     tutup kasir.
OBA155=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" | jq -r .id)
cek "bill KEDUA di meja dine-in yang sama → 409 (bukan split bill)" "V == 409" \
  "$(status_code_body "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}")"
cek "badan galat berkode mesin: meja_sudah_ada_bill + bill_id yang harus dipakai" "V == 1" \
  "$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" | jq -r --arg a "$OBA155" '((.kode=="meja_sudah_ada_bill") and (.bill_id==$a))|if . then 1 else 0 end')"
cek "ditolak = TIDAK tersimpan: meja itu tetap satu bill" "V == 1" \
  "$(stat155 "$REISS105" | jq -r '.bill_terbuka')"
# Jalan yang BENAR: tambahkan pesanan ke bill yang sudah ada lewat PUT.
cek "menambah pesanan ke bill yang ada → 200 (jalan resminya)" "V == 200" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$OBA155" "{\"meja_id\":\"$MEJA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1},{\"menu_id\":\"$M155\",\"qty\":2}]}")"
cek "bill itu kini berisi DUA baris, dan tetap satu bill" "V == 1" \
  "$(api "$REISS105" GET "/open-bill/$OBA155" | jq -r '((.items|length)==2)|if . then 1 else 0 end')"
# RUANG TUNGGU DIKECUALIKAN — kalau ikut dijaga, satu bill bawa pulang yang
# terparkir memblokir SEMUA pesanan bawa pulang berikutnya: jalur itu mati.
OBTA155=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$TA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" | jq -r .id)
cek "bill KEDUA di Ruang Tunggu tetap BOLEH → 201 (jalur bawa pulang hidup)" "V == 201" \
  "$(status_code_body "$REISS105" POST /open-bill "{\"meja_id\":\"$TA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}")"
# Bill TANPA meja tak punya apa pun untuk bertabrakan.
cek "dua bill tanpa meja tetap boleh → 201" "V == 201" \
  "$(status_code_body "$REISS105" POST /open-bill "{\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}")"
# `meja_id` di daftar bill = bahan peringatan "meja ini sudah punya bill".
# Klien WAJIB mencocokkan lewat id, bukan `meja_label`: label itu snapshot saat
# bill dibuat, jadi pencocokan lewat nama gagal SUNYI begitu mejanya diganti
# nama — kasir cuma tak melihat peringatan, lalu menabrak 409 tanpa tahu sebabnya.
api "$REISS105" PATCH "/meja/$MEJA155" '{"nama":"Meja Ganti Nama 155"}' > /dev/null
cek "meja DIGANTI NAMA: meja_id tetap cocok (label lama sudah beda)" "V == 1" \
  "$(api "$REISS105" GET /open-bill | jq -r --arg m "$MEJA155" --arg a "$OBA155" '[.[]|select(.id==$a)][0] | ((.meja_id==$m) and (.meja_label!="Meja Ganti Nama 155"))|if . then 1 else 0 end')"
api "$REISS105" PATCH "/meja/$MEJA155" '{"nama":"Meja Uji155"}' > /dev/null
cek "kosongkan tanpa paksa → 409" "V == 409" \
  "$(status_code_body "$TTIM155" POST "/meja/$MEJA155/kosongkan" '{}')"
cek "badan galat berkode mesin: bill_berjalan + jumlahnya" "V == 1" \
  "$(api "$TTIM155" POST "/meja/$MEJA155/kosongkan" '{}' | jq -r '((.kode=="bill_berjalan") and (.bill_terbuka==1))|if . then 1 else 0 end')"
cek "kirim ulang dengan paksa → 200" "V == 200" \
  "$(status_code_body "$TTIM155" POST "/meja/$MEJA155/kosongkan" '{"paksa":true}')"
cek "meja bebas, dan jejaknya bertanda paksa" "V == 1" \
  "$(api "$TTIM155" GET "/meja/$MEJA155/log" | jq '[.[]|select(.paksa==true)]|length>=1|if . then 1 else 0 end')"
# UANG TIDAK PERNAH LENYAP KARENA TOMBOL MEJA — bill-nya masih bisa ditagih
cek "bill MASIH ADA di pemilih kasir (tagihan tidak dibatalkan)" "V == 1" \
  "$(api "$REISS105" GET /open-bill | jq --arg a "$OBA155" '[.[]|select(.id==$a)]|length')"
# Setelah bill lama DIBATALKAN, meja itu boleh punya bill baru lagi — kalau
# tidak, satu bill batal akan mengunci mejanya selamanya.
api "$REISS105" DELETE "/open-bill/$OBA155" > /dev/null
cek "bill lama dibatalkan → meja itu boleh dipakai bill baru → 201" "V == 201" \
  "$(status_code_body "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA155\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}")"
for _bid in $(api "$REISS105" GET /open-bill | jq -r '.[].id'); do
  api "$REISS105" DELETE "/open-bill/$_bid" > /dev/null
done

# (h) "menu meja harus ada di semua role cabang" — BACA terbuka, TULIS tidak.
#     Sebelum ini modul meja tak punya gerbang peran sama sekali: dapur bisa
#     menghapus meja lewat API walau tombolnya tak ada di layarnya.
cek "kitchen membaca papan meja → 200" "V == 200" "$(status_code "$TKIT154" GET "/meja/status")"
cek "tim membaca papan meja → 200" "V == 200" "$(status_code "$TTIM155" GET "/meja/status")"
cek "kitchen membaca riwayat meja → 200" "V == 200" \
  "$(status_code "$TKIT154" GET "/meja/$MEJA155/log")"
cek "LUBANG DITAMBAL — kitchen menambah meja → 403" "V == 403" \
  "$(status_code_body "$TKIT154" POST /meja '{"nama":"Meja Dapur"}')"
cek "LUBANG DITAMBAL — kitchen menimpa denah → 403" "V == 403" \
  "$(status_code_body "$TKIT154" PUT /meja/tata-letak '{"items":[]}')"
cek "LUBANG DITAMBAL — kitchen menghapus meja → 403" "V == 403" \
  "$(status_code "$TKIT154" DELETE "/meja/$MEJA155")"
cek "LUBANG DITAMBAL — tim menambah meja → 403" "V == 403" \
  "$(status_code_body "$TTIM155" POST /meja '{"nama":"Meja Waiter"}')"
cek "LUBANG DITAMBAL — tim mengubah meja → 403" "V == 403" \
  "$(status_code_body "$TTIM155" PATCH "/meja/$MEJA155" '{"nama":"diubah"}')"
cek "kitchen TIDAK boleh mengosongkan meja (bukan pekerjaannya)" "V == 403" \
  "$(status_code_body "$TKIT154" POST "/meja/$MEJA155/kosongkan" '{}')"
cek "kasir tetap boleh mengatur meja → 200" "V == 200" \
  "$(status_code_body "$REISS105" PATCH "/meja/$MEJA155" '{"nama":"Meja Uji155"}')"

# (i) Meja terisi tak boleh dihapus/dinonaktifkan — `meja_id` ber-onDelete
#     "set null", jadi tagihan yang masih hidup akan jadi yatim.
api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA155\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" > /dev/null
cek "hapus meja yang masih terisi → 409" "V == 409" "$(status_code "$OWNER" DELETE "/meja/$MEJA155")"
cek "nonaktifkan meja yang masih terisi → 409" "V == 409" \
  "$(status_code_body "$OWNER" PATCH "/meja/$MEJA155" '{"is_active":false}')"
api "$REISS105" POST "/meja/$MEJA155/kosongkan" '{}' > /dev/null
cek "setelah dikosongkan, meja boleh dihapus → 200" "V == 200" \
  "$(status_code "$OWNER" DELETE "/meja/$MEJA155")"

# (j) Regresi yang harus tetap hidup.
cek "Ruang Tunggu tak bisa 'dikosongkan' → 400" "V == 400" \
  "$(status_code_body "$REISS105" POST "/meja/$TA155/kosongkan" '{}')"
cek "bar bukan peran pembereskan meja → 403 (gerbang peran lebih dulu)" "V == 403" \
  "$(status_code_body "$TBAR" POST "/meja/$TA155/kosongkan" '{}')"
# Peran BENAR tapi cabang LAIN: mejanya tak terlihat sama sekali → 404, bukan
# 403 — `resolveBranchId` mengunci peran cabang ke cabangnya sendiri.
MJLAIN155=$(api "$OWNER" POST /meja "{\"nama\":\"Meja Cabang Lain 155\",\"tipe\":\"dine_in\",\"branch_id\":\"$CB46_ID\"}" | jq -r .id)
cek "waiter mengosongkan meja CABANG LAIN → 404" "V == 404" \
  "$(status_code_body "$TTIM155" POST "/meja/$MJLAIN155/kosongkan" '{}')"
# Jalur bawa pulang TIDAK PERNAH terkunci: dua pesanan beruntun lewat Ruang
# Tunggu yang sama sama-sama berhasil.
cek "bawa pulang beruntun #1 lewat Ruang Tunggu → berhasil" "V == 1" \
  "$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$TA155\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" | jq -r '(.sale.id!=null)|if . then 1 else 0 end')"
cek "bawa pulang beruntun #2 lewat Ruang Tunggu yang SAMA → berhasil" "V == 1" \
  "$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$TA155\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" | jq -r '(.sale.id!=null)|if . then 1 else 0 end')"
# Status MEMBERI TAHU, TIDAK MELARANG: meja terisi tetap boleh dipakai. Kalau
# ini gagal, §19/§147/§154 ikut rontok karena memakai ulang meja yang sama.
MJ155B=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.is_active and .tipe=="dine_in")][0].id')
api "$REISS105" POST /penjualan "{\"meja_id\":\"$MJ155B\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}" > /dev/null
cek "meja TERISI tetap bisa dipakai transaksi berikutnya → 201" "V == 201" \
  "$(status_code_body "$REISS105" POST /penjualan "{\"meja_id\":\"$MJ155B\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M155\",\"qty\":1}]}")"
# ETag daftar master TIDAK boleh goyah karena ada meja terisi — status hidup
# sengaja ditaruh di endpoint terpisah supaya cache mobile tetap kena 304.
SAMA155=1
E155=$(etag_of "$OWNER" /meja)
for _ in 1 2 3 4 5; do
  [ "$(etag_of "$OWNER" /meja)" = "$E155" ] || SAMA155=0
done
cek "ETag /meja tetap stabil MESKIPUN ada meja terisi" "V == 1" "$SAMA155"

echo "── §156 Diubah jadi TA → kemasan masuk HPP & stoknya berkurang ──"
# Dulu tombol 🥡 di papan hanya penanda: `hpp_satuan`, `total_hpp`, dan
# `sale_consumptions` sudah dibukukan dari `is_dine_in` dan tak pernah dihitung
# ulang. Akibatnya dus yang benar-benar dipakai tak pernah muncul di laba-rugi
# dan stok kemasan tak pernah turun — pemilik melihat laba lebih besar dari
# kenyataan, dan kemasan habis tanpa ada yang tahu.
#
# BASIS BIAYA kini = `sajian_takeaway` (penyajian), BUKAN `is_dine_in`
# (pembukuan). Angka di bawah dipilih bulat supaya salahnya kelihatan:
#   isi   : 100 gr × Rp 10/gr  = Rp 1.000/porsi (bahan biasa, selalu terpakai)
#   dus   :   1 pcs × Rp 2.000 = Rp 2.000/porsi (kemasan, HANYA saat bawa pulang)
CB156=$(api "$REISS105" GET /auth/me | jq -r '.user.branch_id')
ISI156=$(api "$OWNER" POST /bahan '{"nama":"Isi uji156","satuan":"gr","satuan_beli":"kg","isi":1000,"harga_beli":10000,"pengadaan":"beli","kategori":"lain"}' | jq -r .id)
DUS156=$(api "$OWNER" POST /bahan '{"nama":"Dus uji156","satuan":"pcs","satuan_beli":"pcs","isi":1,"harga_beli":2000,"pengadaan":"beli","kategori":"lain","is_packaging":true}' | jq -r .id)
cek "bahan bisa DIBUAT sebagai Kemasan TA lewat API (is_packaging bolak-balik)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq -r --arg i "$DUS156" '[.[]|select(.id==$i)][0].is_packaging|if . then 1 else 0 end')"
M156=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji156\",\"category_id\":\"$CAT145\",\"tipe\":\"regular\",\"mult\":3,\"harga_jual\":9000,\"komponen\":[{\"ingredient_id\":\"$ISI156\",\"qty\":100},{\"ingredient_id\":\"$DUS156\",\"qty\":1}]}" | jq -r .id)
cek "menu berkemasan: hpp bawa pulang 3000, hpp dine-in 1000" "V == 1" \
  "$(api "$OWNER" GET /menu | jq -r --arg i "$M156" '[.[]|select(.id==$i)][0] | ((.hpp==3000) and (.hpp_dine_in==1000))|if . then 1 else 0 end')"
dus156() { api "$OWNER" GET "/stok?branch_id=$CB156" | jq -r --arg i "$DUS156" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
isi156() { api "$OWNER" GET "/stok?branch_id=$CB156" | jq -r --arg i "$ISI156" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
hpp156() { api "$OWNER" GET "/penjualan/$1" | jq -r '.sale.totalHpp'; }
MEJA156=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.is_active and .tipe=="dine_in")][0].id')
if [ -z "$(api "$REISS105" GET /shift/aktif | jq -r '.id // empty')" ]; then
  pastikanHadir "$REISS105" "§156"
  api "$REISS105" POST /shift/buka '{"modal_awal":0}' > /dev/null 2>&1 || true
fi

# (a) Jual 2 porsi di meja DINE-IN: kemasan dilewati, stok dus tak bergerak.
DUS156_0=$(dus156); ISI156_0=$(isi156)
S156=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M156\",\"qty\":2}]}")
SID156=$(echo "$S156" | jq -r '.sale.id')
cek "dine-in: total_hpp = 2 × 1000 (dus TIDAK dihitung)" "V == 2000" "$(hpp156 "$SID156")"
cek "dine-in: stok dus tidak bergerak sebutir pun" "abs(V) < 0.001" \
  "$(python3 -c "print($(dus156) - $DUS156_0)")"
cek "dine-in: isi tetap terpakai 2 × 100 gr" "abs(V - 200) < 0.001" \
  "$(python3 -c "print($ISI156_0 - $(isi156))")"

# (b) INTI PERMINTAAN: papan menandai baris itu bawa pulang. Dusnya sudah
#     dipakai, jadi HPP naik TEPAT sebesar kemasannya dan stok dus turun.
BR156=$(api "$OWNER" GET "/pesanan?branch_id=$CB156" | jq -r --arg id "$SID156" '[.[]|select(.id==$id)][0].items[0].id')
DUS156_1=$(dus156); ISI156_1=$(isi156)
api "$OWNER" POST "/pesanan/penjualan/$SID156/item/$BR156/sajian" '{"takeaway":true}' > /dev/null
cek "diubah jadi TA: total_hpp 2000 → 6000 (naik tepat 2 × Rp 2.000 kemasan)" "V == 6000" \
  "$(hpp156 "$SID156")"
cek "diubah jadi TA: stok dus BERKURANG tepat 2 pcs" "abs(V - 2) < 0.001" \
  "$(python3 -c "print($DUS156_1 - $(dus156))")"
cek "diubah jadi TA: pemakaian bahan biasa TIDAK ikut berubah" "abs(V) < 0.001" \
  "$(python3 -c "print($ISI156_1 - $(isi156))")"
cek "is_dine_in penjualan MAUPUN barisnya tetap true (pembukuan tak dibalik)" "V == 1" \
  "$(api "$OWNER" GET "/penjualan/$SID156" | jq -r '((.sale.isDineIn==true) and ([.items[]|select(.isDineIn==true)]|length==1))|if . then 1 else 0 end')"
cek "riwayat mencatat perpindahan HPP-nya (bukan cuma labelnya)" "V == 1" \
  "$(api "$OWNER" GET "/pesanan/penjualan/$SID156/log" | jq '[.[]|select(.aksi|test("bawa pulang.*HPP"))]|length>=1|if . then 1 else 0 end')"

# (c) IDEMPOTEN: dikembalikan ke makan di tempat → angkanya kembali PERSIS.
#     Hitung-ulang selalu dari nol (bukan selisih), jadi bolak-balik tak
#     menumpuk galat sepeser pun.
api "$OWNER" POST "/pesanan/penjualan/$SID156/item/$BR156/sajian" '{"takeaway":false}' > /dev/null
cek "dikembalikan ke dine-in: total_hpp kembali PERSIS 2000" "V == 2000" "$(hpp156 "$SID156")"
cek "dikembalikan ke dine-in: stok dus kembali PERSIS ke angka awal" "abs(V) < 0.001" \
  "$(python3 -c "print($(dus156) - $DUS156_1)")"

# (c2) `waktu` konsumsi WAJIB tetap waktu transaksinya, bukan saat dihitung
#      ulang. Saldo stok mem-window-kan `sc.waktu > baseline_opname`; kalau
#      hitung-ulang memakai now(), konsumsi lama melompat ke seberang garis
#      opname dan stok berkurang DUA KALI di pembukuan yang sudah ditutup.
api "$OWNER" POST "/pesanan/penjualan/$SID156/item/$BR156/sajian" '{"takeaway":true}' > /dev/null
TGL156=$(api "$OWNER" GET "/penjualan/$SID156" | jq -r '.sale.saleDate')
NOM156=$(api "$OWNER" GET "/penjualan/$SID156" | jq -r '.sale.nomor')
cek "kartu stok dus: pemakaiannya tetap di TANGGAL TRANSAKSI, keluar 2 pcs" "V == 1" \
  "$(api "$OWNER" GET "/stok/kartu/$DUS156?branch_id=$CB156&dari=$TGL156&sampai=$TGL156" | jq -r --arg n "Struk $NOM156" '[.mutasi[]|select(.jenis=="penjualan" and .keterangan==$n)] | ((length==1) and (.[0].keluar==2))|if . then 1 else 0 end')"

# (d) CELAH YANG DILAPORKAN: dapur menandai TA saat bill BELUM dibayar. Dulu
#     penandanya sampai ke layar tapi tidak ke angka — basis biaya diambil dari
#     `is_dine_in`, jadi kemasannya hilang dari pembukuan begitu kasir menagih.
OB156=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA156\",\"items\":[{\"menu_id\":\"$M156\",\"qty\":1},{\"menu_id\":\"$M156\",\"qty\":1}]}")
OBID156=$(echo "$OB156" | jq -r .id)
BRA156=$(echo "$OB156" | jq -r '.items[0].id'); BRB156=$(echo "$OB156" | jq -r '.items[1].id')
api "$OWNER" POST "/pesanan/open_bill/$OBID156/item/$BRA156/sajian" '{"takeaway":true}' > /dev/null
DUS156_2=$(dus156)
S156B=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$OBID156\",\"items\":[{\"menu_id\":\"$M156\",\"qty\":1,\"open_bill_item_id\":\"$BRA156\"},{\"menu_id\":\"$M156\",\"qty\":1,\"open_bill_item_id\":\"$BRB156\"}]}")
SID156B=$(echo "$S156B" | jq -r '.sale.id')
cek "tanda TA dapur sampai ke ANGKA saat dibayar: total_hpp 3000+1000" "V == 4000" \
  "$(hpp156 "$SID156B")"
cek "stok dus turun 1 pcs saja — hanya baris yang ditandai" "abs(V - 1) < 0.001" \
  "$(python3 -c "print($DUS156_2 - $(dus156))")"
cek "transaksi tetap dibukukan dine-in walau satu barisnya dibungkus" "V == 1" \
  "$(api "$OWNER" GET "/penjualan/$SID156B" | jq -r '.sale.isDineIn|if . then 1 else 0 end')"

# (e) Pintasan "semua baris": kedua porsi dibungkus → basis bawa pulang penuh.
DUS156_3=$(dus156)
api "$OWNER" POST "/pesanan/penjualan/$SID156B/sajian" '{"takeaway":true}' > /dev/null
cek "tombol 'semua': total_hpp jadi 2 × 3000 (bawa pulang penuh)" "V == 6000" "$(hpp156 "$SID156B")"
cek "tombol 'semua': dus turun 1 lagi (baris yang tadi masih di piring)" "abs(V - 1) < 0.001" \
  "$(python3 -c "print($DUS156_3 - $(dus156))")"

# (f) Penjualan di Tempat Sampah TIDAK dihitung ulang — seluruh agregasi stok &
#     laporan sudah mengabaikannya, jadi menggeser biayanya cuma menambah baris
#     hantu yang tak pernah terbaca.
S156C=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M156\",\"qty\":1}]}")
SID156C=$(echo "$S156C" | jq -r '.sale.id')
BR156C=$(api "$OWNER" GET "/pesanan?branch_id=$CB156" | jq -r --arg id "$SID156C" '[.[]|select(.id==$id)][0].items[0].id')
api "$OWNER" DELETE "/penjualan/$SID156C" > /dev/null
DUS156_4=$(dus156)
api "$OWNER" POST "/pesanan/penjualan/$SID156C/item/$BR156C/sajian" '{"takeaway":true}' > /dev/null 2>&1 || true
cek "penjualan terhapus: menandainya TA tidak menggerakkan stok apa pun" "abs(V) < 0.001" \
  "$(python3 -c "print($DUS156_4 - $(dus156))")"

echo "── §157 Kiriman antar-cabang: ALAMAT ikut berpindah bersama barangnya ──"
# Satu baris `productions` membawa dua keterangan yang harus dibaca bersama:
#   branch_id        = "barang ini SEKARANG ADA DI MANA"
#   tujuan_branch_id = "barang ini ALAMATNYA KE MANA"
# Layar Penerimaan cabang hanya menampilkan kiriman yang KEDUANYA SAMA. Dulu
# pintu "Ubah Tahap" memindahkan barangnya TANPA memperbarui alamatnya: faktur
# berbunyi "Dikirim", tapi tak ada satu pun layar yang bisa menerimanya dan stok
# cabang tak pernah bertambah. Bagian ini menjaga agar keduanya berpindah
# bersama — untuk PRODUKSI (korban utamanya) dan lewat pintu yang dulu rusak.
CK157=$CK52_UTAMA
ST157=$CB46_ID
MTH157=$(api "$OWNER" POST /bahan '{"nama":"mentah uji157","harga_beli":10000,"isi":1000,"satuan":"gr","pengadaan":"beli","kategori":"lain"}' | jq -r .id)
JDI157=$(api "$OWNER" POST /bahan '{"nama":"jadi uji157","harga_beli":5000,"isi":1,"satuan":"pcs","pengadaan":"produksi","kategori":"lain"}' | jq -r .id)
api "$OWNER" PUT "/bahan/$JDI157/resep" "{\"komponen\":[{\"ingredient_id\":\"$MTH157\",\"qty\":10}]}" > /dev/null
saldo157() { api "$OWNER" GET "/stok?branch_id=$1" | jq -r --arg i "$JDI157" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
# bahan mentah masuk stok CK dulu — /tahap 'dikerjakan' menolak bila resep kurang
FKM157=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK157\",\"items\":[{\"ingredient_id\":\"$MTH157\",\"mode\":\"pcs\",\"jumlah\":5000,\"total_harga\":50000}]}" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKM157" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKM157" '{"ke":"menunggu"}' > /dev/null

FK157=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK157\",\"items\":[{\"ingredient_id\":\"$JDI157\",\"mode\":\"pcs\",\"jumlah\":15}]}" | jq -r .faktur_id)
api "$OWNER" POST "/produksi/tahap/$FK157" '{"ke":"dikerjakan"}' > /dev/null
BID157=$(api "$OWNER" GET "/produksi?branch_id=$CK157&per_page=500" | jq -r --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)][0].id')

# BELUM dikirim: masih di CK, dan pendeteksi TIDAK BOLEH mengusiknya — barang
# yang sah menunggu di rak CK bukan kiriman menggantung.
cek "belum dikirim: pendeteksi tidak menandai barang yang masih di CK" "V == 0" \
  "$(api "$OWNER" GET /penerimaan/anomali | jq --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)] | length')"

# PINTU YANG DULU RUSAK: "Ubah Tahap" → selesai + kirim ke cabang sekaligus.
api "$OWNER" POST "/produksi/tahap/$FK157" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$BID157\",\"qty\":15}],\"tujuan_branch_id\":\"$ST157\"}" > /dev/null
R157=$(api "$OWNER" GET "/produksi?branch_id=$ST157&per_page=500" | jq --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)][0]')
cek "dikirim lewat Ubah Tahap: posisi = alamat (dulu alamatnya KOSONG)" "V == 1" \
  "$(echo "$R157" | jq --arg s "$ST157" '(.branch_id == $s and .tujuan_branch_id == $s) | if . then 1 else 0 end')"
cek "dikirim: status masih 'menunggu' (belum diterima siapa pun)" "V == 1" \
  "$(echo "$R157" | jq '(.status == "menunggu") | if . then 1 else 0 end')"
cek "jejak pengirim tersimpan (CK tetap melihatnya di daftarnya)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK157&per_page=500" | jq --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)] | length | if . == 1 then 1 else 0 end')"
cek "kiriman MUNCUL di layar Penerimaan cabang tujuan" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$ST157" | jq --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)] | length')"
cek "sudah dikirim & sehat: pendeteksi tetap NOL untuk faktur ini" "V == 0" \
  "$(api "$OWNER" GET /penerimaan/anomali | jq --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)] | length')"

# PENGAMAN: selama belum DITERIMA, stok tak boleh bertambah di mana pun.
cek "belum diterima: saldo cabang tujuan masih 0" "abs(V) < 0.001" "$(saldo157 "$ST157")"
cek "belum diterima: saldo CK juga 0 (barangnya sudah keluar)" "abs(V) < 0.001" "$(saldo157 "$CK157")"
cek "PENGAMAN: konfirmasi sepihak kiriman produksi → 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/konfirmasi/$FK157" -H "Authorization: Bearer $OWNER")"
cek "ditolak konfirmasi → saldo cabang tujuan tetap 0" "abs(V) < 0.001" "$(saldo157 "$ST157")"

# Baru sesudah orang di cabang menekan Terima, barangnya jadi stok.
api "$OWNER" POST "/penerimaan/$FK157/terima" > /dev/null
cek "DITERIMA di cabang → saldo cabang tujuan jadi 15" "abs(V - 15) < 0.001" "$(saldo157 "$ST157")"
cek "diterima: status jadi 'dikonfirmasi'" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$ST157&per_page=500" | jq --arg f "$FK157" '([.rows[]|select(.faktur_id==$f)][0].status == "dikonfirmasi") | if . then 1 else 0 end')"

# PENJAGA MENYELURUH — nilai benarnya NOL. Seluruh skrip ini menempuh setiap
# pintu kirim yang ada (Ubah Tahap, /kirim, transfer stok, kirim hasil, beli
# bertujuan cabang). Bila SATU saja di antaranya memindahkan barang tanpa
# alamatnya, angka ini bukan nol lagi — dan bug "sudah kirim tapi tak sampai"
# ketahuan di sini, bukan di pembukuan cabang sebulan kemudian.
ANOM157=$(api "$OWNER" GET /penerimaan/anomali)
cek "TIDAK ADA kiriman menggantung di seluruh perusahaan" "V == 0" "$(echo "$ANOM157" | jq '.jumlah')"
cek "tidak ada qty yang hilang dalam perjalanan" "abs(V) < 0.001" "$(echo "$ANOM157" | jq '.qty_total')"
cek "pendeteksi boleh dibaca peran terkunci cabang (kasir) → 200" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/penerimaan/anomali" -H "Authorization: Bearer $REISS105")"
cek "kasir hanya melihat yang mendarat di cabangnya sendiri" "V == 1" \
  "$(api "$REISS105" GET /penerimaan/anomali | jq '(.rows | length) == 0 | if . then 1 else 0 end')"

# PENGHAPUSAN kiriman menggantung — untuk barang yang cabang SUDAH kompensasi
# manual lewat Stok Awal. Menerimanya justru menghitung dua kali (penerimaan
# menyetel waktu=now() yang jatuh SESUDAH garis Stok Awal), jadi jalannya
# dihapuskan, bukan diterima.
#
# YANG PALING PENTING DIUJI: daftar id dari klien TIDAK dipercaya. Baris SEHAT
# yang id-nya dikirim ke sini harus SELAMAT — kalau tidak, endpoint ini berubah
# jadi penghapus stok massal berkedok perbaikan data.
SEHAT157=$(api "$OWNER" GET "/produksi?branch_id=$ST157&per_page=500" | jq -r --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)][0].id')
TUTUP157=$(api "$OWNER" POST /penerimaan/anomali/tutup "{\"ids\":[\"$SEHAT157\"]}")
cek "id baris SEHAT dikirim ke penutup → TIDAK ada yang dihapus" "V == 0" \
  "$(echo "$TUTUP157" | jq '.ditutup')"
cek "id sehat itu dilaporkan dilewati, bukan digagalkan diam-diam" "V == 1" \
  "$(echo "$TUTUP157" | jq '.dilewati')"
cek "baris sehat masih hidup sesudah dicoba dihapuskan" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$ST157&per_page=500" | jq --arg f "$FK157" '[.rows[]|select(.faktur_id==$f)] | length | if . == 1 then 1 else 0 end')"
cek "saldo cabang TIDAK bergeser sesudah percobaan itu" "abs(V - 15) < 0.001" "$(saldo157 "$ST157")"
cek "penghapusan = keputusan manajemen: kasir → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/anomali/tutup" -H "Authorization: Bearer $REISS105" -H 'Content-Type: application/json' -d "{\"ids\":[\"$SEHAT157\"]}")"
cek "penutup menolak daftar id kosong → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/anomali/tutup" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ids":[]}')"

echo "── §158 Barang beralamat cabang: SAH hanya lewat tombol Terima, dan tercatat siapa ──"
# Yang dijaga di sini bukan sekadar angka stok, tapi PERTANGGUNGJAWABAN.
#
# "Ubah Tahap" bisa melompatkan faktur langsung ke "dikonfirmasi". Dipakai pada
# kiriman yang beralamat cabang, stoknya masuk tanpa satu pun orang di cabang
# yang benar-benar memegang barangnya. Saat kirimannya kurang atau rusak, tak
# ada nama yang bisa ditanya — pembukuan berkata "diterima", tak ada yang
# menerimanya. Jadi: satu pintu (tombol Terima di Penerimaan Barang), dan pintu
# itu selalu meninggalkan nama.
NAMA158=$(api "$OWNER" GET /profil | jq -r .nama)
FK158=$(api "$OWNER" POST /produksi/faktur "{\"branch_id\":\"$CK157\",\"items\":[{\"ingredient_id\":\"$JDI157\",\"mode\":\"pcs\",\"jumlah\":8}]}" | jq -r .faktur_id)
api "$OWNER" POST "/produksi/tahap/$FK158" '{"ke":"dikerjakan"}' > /dev/null
BID158=$(api "$OWNER" GET "/produksi?branch_id=$CK157&per_page=500" | jq -r --arg f "$FK158" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/produksi/tahap/$FK158" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$BID158\",\"qty\":8}],\"tujuan_branch_id\":\"$ST157\"}" > /dev/null

baris158() { api "$OWNER" GET "/produksi?branch_id=$ST157&per_page=500" | jq --arg f "$FK158" '[.rows[]|select(.faktur_id==$f)][0]'; }
cek "belum diterima: tak ada nama penerima di faktur" "V == 1" \
  "$(baris158 | jq '(.diterima_oleh == null and .diterima_pada == null) | if . then 1 else 0 end')"

# PINTU BELAKANG YANG DITUTUP: Ubah Tahap per-baris → langsung "dikonfirmasi".
# (Bentuk seluruh-faktur memang sudah lama tak bisa menutup faktur — dijaga
# assertion di bawahnya — jadi celahnya hanya ada di bentuk per-baris ini.)
cek "PENGAMAN: Ubah Tahap → 'dikonfirmasi' pada kiriman beralamat → 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$FK158" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$BID158\",\"qty\":8}]}")"
cek "ditolak: status baris tetap 'menunggu'" "V == 1" \
  "$(baris158 | jq '(.status == "menunggu") | if . then 1 else 0 end')"
cek "ditolak: saldo cabang TIDAK bertambah (masih 15 dari §157)" "abs(V - 15) < 0.001" "$(saldo157 "$ST157")"
cek "bentuk seluruh-faktur tetap menolak 'dikonfirmasi' → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$FK158" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikonfirmasi"}')"
cek "masih menunggu penerimaan di layar cabang" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$ST157" | jq --arg f "$FK158" '[.rows[]|select(.faktur_id==$f)] | length')"

# JALUR BELI juga — permintaan owner menyebut "faktur bahan baku DAN beli".
FKB158=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK157\",\"tujuan_branch_id\":\"$ST157\",\"items\":[{\"ingredient_id\":\"$MTH157\",\"mode\":\"pcs\",\"jumlah\":300,\"total_harga\":3000}]}" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKB158" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKB158" '{"ke":"menunggu"}' > /dev/null
api "$OWNER" POST "/pembelian/kirim/$FKB158" '{}' > /dev/null
BIDB158=$(api "$OWNER" GET "/pembelian?branch_id=$ST157&per_page=500" | jq -r --arg f "$FKB158" '[.rows[]|select(.faktur_id==$f)][0].id')
cek "PENGAMAN: faktur BELI beralamat cabang → 'dikonfirmasi' juga 409" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FKB158" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$BIDB158\",\"qty\":300}]}")"
cek "beli: saldo bahan mentah di cabang tetap 0" "abs(V) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$ST157" | jq -r --arg i "$MTH157" '[.[]|select(.ingredient_id==$i)][0].saldo // 0')"

# SATU-SATUNYA PINTU — dan pintu itu menuliskan namanya.
api "$OWNER" POST "/penerimaan/$FK158/terima" > /dev/null
R158=$(baris158)
cek "lewat tombol Terima → saldo cabang jadi 23 (15 + 8)" "abs(V - 23) < 0.001" "$(saldo157 "$ST157")"
cek "jejak tersimpan: nama penerima = orang yang menekan Terima" "V == 1" \
  "$(echo "$R158" | jq --arg n "$NAMA158" '(.diterima_oleh == $n) | if . then 1 else 0 end')"
cek "jejak tersimpan: waktu terima terisi" "V == 1" \
  "$(echo "$R158" | jq '(.diterima_pada != null) | if . then 1 else 0 end')"
cek "riwayat penerimaan memuat faktur ini beserta penerimanya" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan/riwayat?branch_id=$ST157" | jq --arg f "$FK158" --arg n "$NAMA158" '([.rows[]|select(.faktur_id==$f and .oleh==$n and .hasil=="diterima")] | length) | if . == 1 then 1 else 0 end')"

# TIDAK KELEBIHAN: faktur yang memang tinggal di CK sendiri tak ikut terkunci —
# di sana tak ada "cabang tujuan" yang harus menerimanya.
FKL158=$(api "$OWNER" POST /pembelian/faktur "{\"branch_id\":\"$CK157\",\"items\":[{\"ingredient_id\":\"$MTH157\",\"mode\":\"pcs\",\"jumlah\":200,\"total_harga\":2000}]}" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKL158" '{"ke":"dikerjakan"}' > /dev/null
BIDL158=$(api "$OWNER" GET "/pembelian?branch_id=$CK157&per_page=500" | jq -r --arg f "$FKL158" '[.rows[]|select(.faktur_id==$f)][0].id')
cek "faktur CK-lokal tetap boleh 'dikonfirmasi' dari Ubah Tahap → 200" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FKL158" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$BIDL158\",\"qty\":200}]}")"
cek "faktur CK-lokal: masuk stok CK tanpa penerimaan terpisah" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK157&per_page=500" | jq --arg f "$FKL158" '([.rows[]|select(.faktur_id==$f)][0].status == "dikonfirmasi") | if . then 1 else 0 end')"
cek "faktur CK-lokal pun berjejak penerima" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK157&per_page=500" | jq --arg f "$FKL158" --arg n "$NAMA158" '([.rows[]|select(.faktur_id==$f)][0].diterima_oleh == $n) | if . then 1 else 0 end')"

echo "── §159 Refund sebagian per sajian: uang, HPP, dan stok bahan ikut kembali ──"
# Kasusnya satu, dan owner menyebutkannya sendiri: pembeli sudah membayar, lalu
# ketahuan bahan salah satu sajian habis sehingga sajian itu tak jadi dibuat.
# Uang untuk sajian itu — dan hanya sajian itu — dikembalikan.
#
# Yang dijaga di sini justru bagian yang paling mudah salah: `nominal` BUKAN
# `harga × qty`. Diskon dan PB1 melekat pada transaksi, bukan pada baris; kalau
# keduanya dibiarkan utuh, pembeli menerima kembali LEBIH SEDIKIT daripada yang
# benar-benar ia bayarkan untuk sajian itu.
#
# Angka dipilih bulat supaya salahnya kelihatan (menu §156, harga jual 9.000):
#   3 porsi        = 27.000
#   diskon 10%     =  2.700  → net 24.300
#   PB1 10%        =  2.430  → total 26.730
#   refund 1 porsi → subtotal 18.000, diskon 1.800, PB1 1.620, total 17.820
#   nominal        = 26.730 − 17.820 = 8.910  (bukan 9.000!)
api "$OWNER" PATCH /company '{"pb1_enabled":true,"pb1_rate":10}' > /dev/null
ISI159_0=$(isi156)
S159=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"uang_diterima\":50000,\"diskon_tipe\":\"persen\",\"diskon_nilai\":10,\"items\":[{\"menu_id\":\"$M156\",\"qty\":3}]}")
SID159=$(echo "$S159" | jq -r '.sale.id')
IT159=$(echo "$S159" | jq -r '.items[0].id')
jual159() { api "$OWNER" GET "/penjualan/$SID159"; }
cek "sebelum refund: total 26.730 (27.000 − 2.700 + 2.430)" "abs(V - 26730) < 0.001" \
  "$(jual159 | jq -r '.sale.total')"
cek "sebelum refund: belum ada jangkar *_asal (null = belum pernah direfund)" "V == 1" \
  "$(jual159 | jq '(.sale.subtotalAsal == null and .sale.refundTotal == 0)|if . then 1 else 0 end')"
cek "sebelum refund: bahan terpakai 3 × 100 gr" "abs(V - 300) < 0.001" \
  "$(python3 -c "print($ISI159_0 - $(isi156))")"
HPP159_0=$(hpp156 "$SID159")

# (a) Refund 1 porsi. Uang, HPP, dan stok bahan bergerak bersama-sama.
R159=$(api "$REISS105" POST "/penjualan/$SID159/refund" "{\"alasan\":\"Bahan habis\",\"items\":[{\"sale_item_id\":\"$IT159\",\"qty\":1}]}")
cek "KASIR boleh merefund sendiri (tanpa memanggil owner)" "V == 1" \
  "$(echo "$R159" | jq '(.ok == true)|if . then 1 else 0 end')"
cek "nominal = 8.910, BUKAN 9.000 — diskon & PB1 porsi itu ikut kembali" "abs(V - 8910) < 0.001" \
  "$(echo "$R159" | jq -r '.nominal')"
cek "total penjualan disusutkan jadi 17.820" "abs(V - 17820) < 0.001" "$(jual159 | jq -r '.sale.total')"
cek "subtotal/diskon/PB1 ikut proporsional (18.000 / 1.800 / 1.620)" "V == 1" \
  "$(jual159 | jq '((.sale.subtotal==18000) and (.sale.diskon==1800) and (.sale.pb1Amount==1620))|if . then 1 else 0 end')"
cek "jangkar *_asal terisi dengan angka SEBELUM refund" "V == 1" \
  "$(jual159 | jq '((.sale.subtotalAsal==27000) and (.sale.diskonAsal==2700) and (.sale.pb1Asal==2430))|if . then 1 else 0 end')"
cek "refund_total tercatat 8.910" "abs(V - 8910) < 0.001" "$(jual159 | jq -r '.sale.refundTotal')"
cek "qty baris TIDAK dikurangi (tetap 3) — qty_refund yang bertambah jadi 1" "V == 1" \
  "$(jual159 | jq '((.items[0].qty==3) and (.items[0].qtyRefund==1))|if . then 1 else 0 end')"
cek "uang_diterima ikut turun → 'kembalian' di struk tetap angka yang nyata" "abs(V - 41090) < 0.001" \
  "$(jual159 | jq -r '.sale.uangDiterima')"
cek "HPP menyusut: sajian yang tak dibuat tak menanggung biaya" "V == 1" \
  "$(python3 -c "print(1 if $(hpp156 "$SID159") < $HPP159_0 - 0.001 else 0)")"
cek "STOK BAHAN KEMBALI: pemakaian tinggal 2 × 100 gr" "abs(V - 200) < 0.001" \
  "$(python3 -c "print($ISI159_0 - $(isi156))")"

# (b) Penolakan divalidasi SELURUHNYA sebelum menulis apa pun. Menolak di tengah
#     akan meninggalkan sebagian refund tertulis dengan uang yang tak diserahkan.
cek "melebihi sisa porsi → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan/$SID159/refund" -H "Authorization: Bearer $REISS105" -H 'Content-Type: application/json' -d "{\"items\":[{\"sale_item_id\":\"$IT159\",\"qty\":99}]}")"
cek "ditolak: tak ada yang berubah (refund_total masih 8.910)" "abs(V - 8910) < 0.001" \
  "$(jual159 | jq -r '.sale.refundTotal')"

# (c) BERTAHAP = SEKALIGUS. Jangkar `*_asal` yang membuatnya benar: tanpa itu,
#     refund kedua menghitung diskon dari angka yang sudah menyusut dan
#     potongannya tergerus dua kali.
R159B=$(api "$REISS105" POST "/penjualan/$SID159/refund" "{\"items\":[{\"sale_item_id\":\"$IT159\",\"qty\":2}]}")
cek "refund sisanya = 17.820 (bertahap 8.910 + 17.820 = 26.730 persis)" "abs(V - 17820) < 0.001" \
  "$(echo "$R159B" | jq -r '.nominal')"
cek "seluruh porsi dikembalikan → total 0" "abs(V) < 0.001" "$(jual159 | jq -r '.sale.total')"
cek "refund_total kumulatif = total asal, tak lebih & tak kurang" "abs(V - 26730) < 0.001" \
  "$(jual159 | jq -r '.sale.refundTotal')"
cek "stok bahan kembali SELURUHNYA ke angka sebelum transaksi" "abs(V) < 0.001" \
  "$(python3 -c "print($ISI159_0 - $(isi156))")"
cek "HPP jadi 0 — tak ada satu porsi pun yang jadi dibuat" "abs(V) < 0.001" "$(hpp156 "$SID159")"
cek "sudah habis: refund lagi → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan/$SID159/refund" -H "Authorization: Bearer $REISS105" -H 'Content-Type: application/json' -d "{\"items\":[{\"sale_item_id\":\"$IT159\",\"qty\":1}]}")"

# (d) Penjualan di Tempat Sampah tak punya arti untuk direfund — seluruh laporan
#     sudah mengabaikannya, jadi angkanya tak akan pernah terbaca siapa pun.
S159C=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M156\",\"qty\":1}]}")
SID159C=$(echo "$S159C" | jq -r '.sale.id'); IT159C=$(echo "$S159C" | jq -r '.items[0].id')
api "$OWNER" DELETE "/penjualan/$SID159C" > /dev/null
cek "penjualan terhapus → refund 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan/$SID159C/refund" -H "Authorization: Bearer $REISS105" -H 'Content-Type: application/json' -d "{\"items\":[{\"sale_item_id\":\"$IT159C\",\"qty\":1}]}")"
api "$OWNER" PATCH /company '{"pb1_enabled":false,"pb1_rate":0}' > /dev/null

echo "── §160 Refund tidak boleh cuma menyusutkan angka besar ──"
# Refund menyusutkan `sales.subtotal/total/total_hpp`, TAPI `sale_items.qty` dan
# `line_total` sengaja tetap merekam apa yang DIPESAN. Akibatnya tiap laporan
# yang menjumlah `sale_items` mentah-mentah menghitung porsi yang uangnya sudah
# dikembalikan sebagai porsi terjual — dan berselisih dengan angka utama pada
# LAYAR YANG SAMA, persis sebesar refundnya. Yang paling menyesatkan: menu yang
# bahannya habis justru naik peringkat "terlaris".
#
# Dan rekap tutup kasir: refund atas transaksi shift KEMARIN tak boleh menggeser
# rekap shift yang sudah ditutup — uangnya keluar dari laci HARI INI.
#
# Angka bulat (menu §156, harga jual 9.000, tanpa diskon & tanpa PB1):
#   3 porsi = 27.000 → refund 1 porsi = 9.000 → tersisa 2 porsi / 18.000
HARI160=$(TZ=Asia/Jakarta date +%F)
laris160() { api "$OWNER" GET "/laporan/menu-laris?dari=$HARI160&sampai=$HARI160&branch_id=$CB156" | jq -r "[.items[]|select(.menu_id==\"$M156\")|.$1]|add // 0"; }
harian160() { api "$OWNER" GET "/laporan?tanggal=$HARI160&branch_id=$CB156" | jq -r "$1"; }
rekap160() { api "$OWNER" GET "/shift/aktif?branch_id=$CB156" | jq -r "$1"; }

LARIS160_0=$(laris160 qty)
OMZ160_0=$(laris160 omzet)
TUNAI160_0=$(rekap160 .penjualan_tunai)

S160=$(api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"uang_diterima\":30000,\"items\":[{\"menu_id\":\"$M156\",\"qty\":3}]}")
SID160=$(echo "$S160" | jq -r '.sale.id')
IT160=$(echo "$S160" | jq -r '.items[0].id')
cek "3 porsi terjual → Menu Terlaris naik 3" "abs(V - 3) < 0.001" \
  "$(python3 -c "print($(laris160 qty) - $LARIS160_0)")"
cek "3 porsi terjual → omzet Menu Terlaris naik 27.000" "abs(V - 27000) < 0.001" \
  "$(python3 -c "print($(laris160 omzet) - $OMZ160_0)")"
cek "rekap shift berjalan naik 27.000" "abs(V - 27000) < 0.001" \
  "$(python3 -c "print($(rekap160 .penjualan_tunai) - $TUNAI160_0)")"

api "$REISS105" POST "/penjualan/$SID160/refund" "{\"alasan\":\"Bahan habis\",\"items\":[{\"sale_item_id\":\"$IT160\",\"qty\":1}]}" > /dev/null
cek "refund 1 porsi → Menu Terlaris tinggal +2, bukan tetap +3" "abs(V - 2) < 0.001" \
  "$(python3 -c "print($(laris160 qty) - $LARIS160_0)")"
cek "refund 1 porsi → omzet Menu Terlaris tinggal +18.000" "abs(V - 18000) < 0.001" \
  "$(python3 -c "print($(laris160 omzet) - $OMZ160_0)")"
# Inti temuannya: dua angka pada satu halaman Laporan harus cocok. `omzet` besar
# datang dari `sales.subtotal` (menyusut saat refund); rincian per menu dulu
# datang dari `sale_items.line_total` (tidak menyusut).
cek "Laporan: total item_terjual == omzet — bukan dua angka berbeda" "abs(V) < 0.001" \
  "$(python3 -c "print($(harian160 '[.item_terjual[].omzet]|add // 0') - $(harian160 '.omzet'))")"
cek "refund pada shift yang SAMA → rekap tinggal +18.000" "abs(V - 18000) < 0.001" \
  "$(python3 -c "print($(rekap160 .penjualan_tunai) - $TUNAI160_0)")"

# Papan pesanan adalah LEMBAR PERINTAH DAPUR. Porsi yang uangnya dikembalikan
# tak boleh muncul sebagai pekerjaan — refundnya lahir justru karena bahannya
# habis, jadi menampilkan porsi mentahnya menyuruh dapur memasak sesuatu yang
# sudah dibatalkan dan tidak dibayar siapa pun.
papan160() { api "$REISS105" GET "/pesanan?tanggal=$HARI160" | jq -r "[.[]|select(.id==\"$SID160\")][0].items[]|select(.id==\"$IT160\")|.$1"; }
cek "papan dapur menampilkan 2 porsi (yang ditagih), bukan 3" "abs(V - 2) < 0.001" \
  "$(papan160 qty)"
cek "papan menyertakan qty_refund supaya bisa diberi keterangan" "abs(V - 1) < 0.001" \
  "$(papan160 qty_refund)"

# Tutup lalu buka shift baru: uang refund keluar dari laci SHIFT BARU.
# Id shift diambil SEBELUM ditutup — jangan bergantung pada urutan daftar.
SHIFT160L=$(api "$REISS105" GET /shift/aktif | jq -r .id)
KAS160L=$(api "$OWNER" GET "/shift/$SHIFT160L" | jq -r '.kas_sistem')
api "$REISS105" POST /shift/tutup "{\"uang_fisik\":$KAS160L,\"catatan\":\"uji 160\"}" > /dev/null
TUNAI160L=$(api "$OWNER" GET "/shift/$SHIFT160L" | jq -r '.penjualan_tunai')
api "$REISS105" POST /shift/buka '{"modal_awal":0}' > /dev/null
api "$REISS105" POST "/penjualan/$SID160/refund" "{\"alasan\":\"Bahan habis\",\"items\":[{\"sale_item_id\":\"$IT160\",\"qty\":1}]}" > /dev/null
cek "refund lintas shift TIDAK menggeser rekap shift yang sudah ditutup" "abs(V) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET "/shift/$SHIFT160L" | jq -r '.penjualan_tunai') - $TUNAI160L)")"
cek "shift BARU yang mencatat uang keluar laci: −9.000" "abs(V + 9000) < 0.001" \
  "$(rekap160 .penjualan_tunai)"

echo
echo "── §161 Buka kasir BERBARENGAN: satu shift, tanpa 500 ──"
# Token: $REISS105, BUKAN $KASIR. $KASIR sudah tak berlaku sejak §105
# me-reissue-nya (ganti password menaikkan token_version); memakainya di sini
# membuat seluruh bagian ini balas 401 dan ujinya gagal tanpa menyentuh
# perilaku yang sebenarnya diuji. §160 di atas juga memakai $REISS105.
# Indeks parsial `shifts_open_per_branch_uq` (migrasi 0023) yang benar-benar
# menjaga "satu shift terbuka per cabang" — SELECT-lalu-INSERT selalu punya
# jeda di antaranya.
#
# Yang dijaga bagian ini: yang kalah balapan mendarat di hasil yang SAMA dengan
# jalur berurutan. Untuk jalur ONLINE itu berarti 400 berpesan, bukan 500.
# Penolakannya memang disengaja dan didokumentasikan di rutenya sendiri (kasir
# ada di depan layar dan harus tahu shift itu bukan yang baru saja ia buka) —
# ada pula asersi regresi terpisah yang mematoknya. Dulu yang kalah menerima
# 23505 mentah alias 500, dan di web 500 yang BUKAN galat aplikasi memicu
# overlay global "server sedang diperbarui": aplikasinya terlihat tumbang
# padahal kasir cuma membuka laci. Itu bedanya, dan itu yang diuji.
#
# Jadi pola kode yang benar adalah 201 untuk yang menang dan 400 untuk sisanya —
# BUKAN "ketiganya 200". Rute ini menjawab 201 saat membuat.
api "$REISS105" POST /shift/tutup '{"uang_fisik":0}' > /dev/null 2>&1 || true
# Prasyarat dipatok TERPISAH, jangan digabung ke asersi balapan. Bila penutupan
# di atas diam-diam gagal, shift lama tetap terbuka dan KETIGA permintaan akan
# dijawab 400 — bentuk kegagalan yang sama persis dengan "tak ada yang berhasil
# membuka", padahal sebabnya jauh sebelum balapan dimulai. Dipisah supaya
# kegagalannya menyebut dirinya sendiri.
cek "prasyarat §161: tak ada shift terbuka sebelum balapan" "V == 0" \
  "$(api "$REISS105" GET /shift/aktif | jq -r 'if .id then 1 else 0 end')"
R161A=$(mktemp); R161B=$(mktemp); R161C=$(mktemp)
for f in "$R161A" "$R161B" "$R161C"; do
  curl -s -X POST "$BASE/api/shift/buka" -H "Authorization: Bearer $REISS105" \
    -H 'Content-Type: application/json' -d '{"modal_awal":123000}' \
    -w '\n%{http_code}' > "$f" &
done
wait
KODE161=""; ID161=""; PESAN161=""
for f in "$R161A" "$R161B" "$R161C"; do
  KODE161="$KODE161$(tail -n1 "$f") "
  BODY161=$(sed '$d' "$f")
  ID161="$ID161$(printf '%s' "$BODY161" | jq -r '.id // empty') "
  # Amplop galat server adalah {"error": "..."} — yang ditagih di sini adalah
  # ADANYA amplop itu, karena persis itu yang membedakan penolakan aplikasi
  # dari tumbangnya server di mata klien web.
  PESAN161="$PESAN161$(printf '%s' "$BODY161" | jq -r 'if .error then 1 else 0 end') "
done
rm -f "$R161A" "$R161B" "$R161C"
cek "tiga permintaan bersamaan: TAK ADA yang 5xx" "V == 1" \
  "$(printf '%s' "$KODE161" | grep -qE '\b5[0-9][0-9]\b' && echo 0 || echo 1)"
cek "tepat SATU yang menang (201 dibuat)" "V == 1" \
  "$(printf '%s' "$KODE161" | tr ' ' '\n' | grep -c '^201$')"
cek "dua yang kalah ditolak 400 BERPESAN, bukan 500" "V == 2" \
  "$(printf '%s' "$KODE161" | tr ' ' '\n' | grep -c '^400$')"
cek "tiap yang kalah membawa amplop galat aplikasi {error}" "V == 2" \
  "$(printf '%s' "$PESAN161" | tr ' ' '\n' | grep -c '^1$')"
cek "hanya SATU badan yang membawa id shift (yang menang)" "V == 1" \
  "$(printf '%s' "$ID161" | tr ' ' '\n' | grep -v '^$' | wc -l)"
AKTIF161=$(api "$REISS105" GET /shift/aktif)
cek "server menyisakan tepat SATU shift terbuka di cabang ini" "V == 1" \
  "$(printf '%s' "$AKTIF161" | jq -r 'if .id then 1 else 0 end')"
cek "id pemenang == shift aktif di server (bukan laci kedua)" "V == 1" \
  "$(printf '%s' "$ID161" | tr ' ' '\n' | grep -v '^$' \
     | grep -qxF "$(printf '%s' "$AKTIF161" | jq -r '.id')" && echo 1 || echo 0)"
cek "modal shift aktif == yang dikirim ketiganya (123.000)" "V == 123000" \
  "$(printf '%s' "$AKTIF161" | jq -r '.modal_awal')"

echo
echo "── §162 Bill dibuka kembali: tak boleh menabrak satu-meja-satu-bill ──"
# Aturan "satu meja dine-in = satu bill" dijaga sampai `SELECT … FOR UPDATE` di
# `POST` dan `PUT /open-bill`. Tapi keduanya hanya menghitung bill yang
# `closed_at`-nya masih kosong, dan ada jalan masuk KETIGA yang tak lewat sana:
# bill yang sudah DIBATALKAN lalu dihidupkan lagi dari papan. Ketiga langkahnya
# lewat tombol yang sah dan tak satu pun keliru sendiri-sendiri.
MEJA162=$(api "$OWNER" POST /meja "{\"nama\":\"Meja Buka Lagi 162\",\"tipe\":\"dine_in\",\"branch_id\":\"$CB154\"}" | jq -r .id)
OB162A=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA162\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}")
A162=$(echo "$OB162A" | jq -r .id)
BR162=$(echo "$OB162A" | jq -r '.items[0].id')
api "$REISS105" DELETE "/open-bill/$A162" > /dev/null
cek "bill A dibatalkan → lenyap dari pemilih kasir" "V == 404" \
  "$(status_code "$REISS105" GET "/open-bill/$A162")"
# Ini SAH dan bukan bagian yang diperbaiki: mejanya memang sudah bebas.
B162=$(api "$REISS105" POST /open-bill "{\"meja_id\":\"$MEJA162\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}" | jq -r '.id // ""')
cek "tamu baru di meja yang sama → bill B boleh dibuat" "V == 1" \
  "$(python3 -c "print(1 if len('$B162') == 36 else 0)")"
# Langkah ketiga: dapur mengembalikan satu baris bill A ke antrean.
api "$TKIT154" POST "/pesanan/open_bill/$A162/item/$BR162/status" '{"status":"dikerjakan"}' > /dev/null
cek "bill A hidup lagi — 'dibatalkan lalu ternyata jadi' tetap bisa ditagih" "V == 200" \
  "$(status_code "$REISS105" GET "/open-bill/$A162")"
cek "…tapi DILEPAS dari mejanya, bukan menempel jadi bill kedua" "V == 1" \
  "$(api "$REISS105" GET "/open-bill/$A162" | jq '(.meja_id==null)|if . then 1 else 0 end')"
cek "meja itu tetap dipegang TEPAT satu bill (yaitu B)" "V == 1" \
  "$(api "$REISS105" GET /open-bill | jq --arg m "$MEJA162" '[.[]|select(.meja_id==$m)]|length')"
cek "…dan bill itu memang B" "V == 1" \
  "$(api "$REISS105" GET /open-bill | jq --arg m "$MEJA162" --arg b "$B162" '[.[]|select(.meja_id==$m and .id==$b)]|length')"
# Pelepasan yang SUNYI lebih buruk daripada cacatnya: kasir harus tahu kenapa
# bill-nya lepas dan apa langkah berikutnya.
cek "pelepasannya tercatat di riwayat papan" "V == 1" \
  "$(api "$REISS105" GET "/pesanan/open_bill/$A162/log" | jq '[.[]|select(.aksi|test("dilepas dari"))]|length>=1|if . then 1 else 0 end')"
cek "catatannya menyebut langkah berikutnya (pasang ulang dari kasir)" "V == 1" \
  "$(api "$REISS105" GET "/pesanan/open_bill/$A162/log" | jq '[.[]|select(.aksi|test("pasang ulang mejanya dari kasir"))]|length>=1|if . then 1 else 0 end')"
# Jalur pemulihannya sudah ada dan sudah dijaga — memasang ulang ke meja yang
# masih terisi tetap ditolak dengan kode yang sudah dikenal klien.
IT162A=$(api "$REISS105" GET "/open-bill/$A162" | jq -c '[.items[]|{id:.id, menu_id:.menu_id, qty:.qty}]')
cek "pasang ulang A ke meja yang masih dipegang B → 409" "V == 409" \
  "$(status_code_body "$REISS105" PUT "/open-bill/$A162" "$(jq -nc --arg m "$MEJA162" --argjson it "$IT162A" '{meja_id:$m, items:$it}')")"
cek "…dengan kode meja_sudah_ada_bill" "V == 1" \
  "$(api "$REISS105" PUT "/open-bill/$A162" "$(jq -nc --arg m "$MEJA162" --argjson it "$IT162A" '{meja_id:$m, items:$it}')" | jq '(.kode=="meja_sudah_ada_bill")|if . then 1 else 0 end')"
# Dan sesudah B dibayar, mejanya bebas — A boleh dipasang lagi ke sana.
api "$REISS105" POST /penjualan "{\"meja_id\":\"$MEJA162\",\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$B162\",\"items\":[{\"menu_id\":\"$M154\",\"qty\":1}]}" > /dev/null
cek "B dibayar → A boleh dipasang kembali ke meja itu" "V == 1" \
  "$(api "$REISS105" PUT "/open-bill/$A162" "$(jq -nc --arg m "$MEJA162" --argjson it "$IT162A" '{meja_id:$m, items:$it}')" | jq --arg m "$MEJA162" '(.meja_id==$m)|if . then 1 else 0 end')"
# PEMBUKAAN BIASA (mejanya tidak sedang dipakai siapa pun) TIDAK melepas apa
# pun — kalau tidak, tiap penandaan status dari papan akan mencabut bill dari
# mejanya, kerusakan yang jauh lebih besar daripada yang diperbaiki.
api "$REISS105" DELETE "/open-bill/$A162" > /dev/null
api "$TKIT154" POST "/pesanan/open_bill/$A162/item/$BR162/status" '{"status":"dikerjakan"}' > /dev/null
cek "dibuka kembali ke meja yang KOSONG → mejanya dipertahankan" "V == 1" \
  "$(api "$REISS105" GET "/open-bill/$A162" | jq --arg m "$MEJA162" '(.meja_id==$m)|if . then 1 else 0 end')"
api "$REISS105" DELETE "/open-bill/$A162" > /dev/null

echo
echo "── §163 Opname: kiriman ulang tak melahirkan sesi kembar ──"
# Opname adalah baseline MUTLAK, bukan selisih — jadi dua sesi kembar mendarat
# di angka stok yang sama. Yang rusak jejaknya: Riwayat Opname memuat dua sesi
# identik dan owner harus meng-ACC dua kali untuk satu penghitungan. Di layar
# yang justru dipakai memeriksa kejujuran stok, riwayat kembar itu sendiri jadi
# pertanyaan. Ledger idempotensinya SAMA dengan penjualan/refund/sync.
BHN163=$(api "$OWNER" POST /bahan "{\"nama\":\"Bahan Opname 163\",\"satuan\":\"gr\",\"harga_beli\":1000,\"isi\":1,\"track_stok\":true,\"pengadaan\":\"beli\"}" | jq -r .id)
REF163=$(cat /proc/sys/kernel/random/uuid)
BODY163=$(jq -nc --arg b "$BHN163" --arg r "$REF163" --arg c "$CB154" \
  '{branch_id:$c, client_ref:$r, catatan:"Opname uji 163", items:[{ingredient_id:$b, qty:7}]}')
SES163A=$(api "$OWNER" POST /stok/opname "$BODY163")
ID163A=$(echo "$SES163A" | jq -r '.session_id // ""')
cek "opname pertama tersimpan (punya session_id)" "V == 1" \
  "$(python3 -c "print(1 if len('$ID163A') == 36 else 0)")"
# Kiriman ULANG dengan client_ref yang SAMA — inilah yang dulu melahirkan sesi
# kedua. Harus memulangkan hasil yang sama persis, bukan sesi baru.
SES163B=$(api "$OWNER" POST /stok/opname "$BODY163")
cek "kiriman ulang memulangkan session_id yang SAMA" "V == 1" \
  "$(echo "$SES163B" | jq -r --arg a "$ID163A" '(.session_id==$a)|if . then 1 else 0 end')"
cek "…dan ringkasannya juga sama (hasil diputar ulang, bukan dihitung lagi)" "V == 1" \
  "$(echo "$SES163B" | jq -r --argjson a "$(echo "$SES163A" | jq -c .ringkasan)" '(.ringkasan==$a)|if . then 1 else 0 end')"
cek "riwayat opname memuat TEPAT satu sesi untuk kunci itu" "V == 1" \
  "$(api "$OWNER" GET "/stok/opname/riwayat?branch_id=$CB154" | jq --arg a "$ID163A" '[.[]|select(.session_id==$a)]|length')"
# client_ref BEDA = penghitungan baru, dan itu memang harus lahir sebagai sesi
# tersendiri — kalau tidak, opname ulang di hari yang sama jadi mustahil.
SES163C=$(api "$OWNER" POST /stok/opname \
  "$(jq -nc --arg b "$BHN163" --arg r "$(cat /proc/sys/kernel/random/uuid)" --arg c "$CB154" \
     '{branch_id:$c, client_ref:$r, catatan:"Opname uji 163 kedua", items:[{ingredient_id:$b, qty:9}]}')")
cek "client_ref BEDA → sesi baru (bukan ikut diputar ulang)" "V == 1" \
  "$(echo "$SES163C" | jq -r --arg a "$ID163A" '((.session_id!=$a) and ((.session_id|length)==36))|if . then 1 else 0 end')"
# Klien lama tanpa client_ref tak boleh berubah perilakunya.
SES163D=$(api "$OWNER" POST /stok/opname \
  "$(jq -nc --arg b "$BHN163" --arg c "$CB154" '{branch_id:$c, catatan:"Opname uji 163 tanpa ref", items:[{ingredient_id:$b, qty:5}]}')")
cek "tanpa client_ref: tetap membuat sesi (kompatibilitas klien lama)" "V == 1" \
  "$(echo "$SES163D" | jq -r '((.session_id|length)==36)|if . then 1 else 0 end')"

echo "== 164. Transfer stok: kiriman ulang tak memindahkan stok dua kali =="
# Kelas yang sama dengan §163 (opname) dan penjualan, di endpoint yang MEMBUAT
# faktur sekaligus MEMINDAHKAN STOK. Yang dijaga bukan klik ganda — tombolnya
# sudah dimatikan selama pending — melainkan jaringan yang putus SESUDAH server
# menulis tapi SEBELUM balasannya sampai. Chromium bahkan mengulang POST-nya
# SENDIRI saat koneksi keep-alive yang dipakai ulang ditutup server.
#
# FIKTUR SENDIRI, bukan sisa seksi lain. Percobaan pertama memakai ulang bahan
# §132 dengan penjaga "lewati kalau stoknya sudah habis" — dan di CI stoknya
# MEMANG sudah habis, jadi seluruh seksi ini dilewati sambil mencetak tanda
# centang. Hijau yang tak membuktikan apa pun persis cacat yang sedang
# diperbaiki sepanjang penyisiran ini, jadi penjaga itu dibuang: bahan dan
# saldo pembukanya dibuat di sini supaya seksinya selalu benar-benar berjalan.
CK164=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="central_kitchen")][0].id')
TJ164=$(api "$OWNER" GET /cabang | jq -r --arg a "$CK164" '[.[]|select(.is_active and .tipe=="store" and .id!=$a)][0].id')
cek "dasar uji §164: ada CK dan cabang store tujuan" "V == 1" \
  "$([ -n "$CK164" ] && [ -n "$TJ164" ] && [ "$CK164" != "null" ] && [ "$TJ164" != "null" ] && echo 1 || echo 0)"
# Bahan sendiri: eceran boleh (isi 1) supaya bebas aturan kelipatan kemasan §148.
ING164=$(api "$OWNER" POST /bahan \
  '{"nama":"Bahan Transfer 164","satuan":"gr","harga_beli":1000,"isi":1,"track_stok":true,"pengadaan":"beli","boleh_eceran":true}' \
  | jq -r .id)
api "$OWNER" POST /stok/awal \
  "$(jq -nc --arg b "$CK164" --arg i "$ING164" '{branch_id:$b, items:[{ingredient_id:$i, qty:100}]}')" > /dev/null
TERS164=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK164" \
  | jq -r --arg i "$ING164" '[.rows[]|select(.ingredient_id==$i)][0] | ((.saldo // 0) - (.dalam_jalan // 0))')
cek "dasar uji §164: saldo pembuka 100 siap kirim di CK" "abs(V - 100) < 0.001" "$TERS164"

REF164=$(cat /proc/sys/kernel/random/uuid)
BODY164=$(jq -nc --arg a "$CK164" --arg t "$TJ164" --arg i "$ING164" --arg r "$REF164" \
  '{asal_branch_id:$a, tujuan_branch_id:$t, client_ref:$r, catatan:"uji idempotensi 164", items:[{ingredient_id:$i, qty:7}]}')
N164_AWAL=$(api "$OWNER" GET /transfer-stok | jq '.rows|length')
DJ164_AWAL=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK164" \
  | jq -r --arg i "$ING164" '[.rows[]|select(.ingredient_id==$i)][0].dalam_jalan // 0')
TF164A=$(api "$OWNER" POST /transfer-stok "$BODY164")
ID164A=$(echo "$TF164A" | jq -r '.faktur_id // ""')
cek "transfer pertama tersimpan (faktur_id + nomor TF-)" "V == 1" \
  "$(echo "$TF164A" | jq -r '(((.faktur_id|length)==36) and ((.nomor // "")|startswith("TF-")))|if . then 1 else 0 end')"
TF164B=$(api "$OWNER" POST /transfer-stok "$BODY164")
cek "kiriman ulang memulangkan faktur_id yang SAMA" "V == 1" \
  "$(echo "$TF164B" | jq -r --arg a "$ID164A" '(.faktur_id==$a)|if . then 1 else 0 end')"
cek "…dan nomor TF- yang sama (diputar ulang, bukan diterbitkan lagi)" "V == 1" \
  "$(echo "$TF164B" | jq -r --argjson a "$(echo "$TF164A" | jq -c .nomor)" '(.nomor==$a)|if . then 1 else 0 end')"
cek "daftar transfer bertambah TEPAT satu, bukan dua" "V == 1" \
  "$(api "$OWNER" GET /transfer-stok | jq --argjson n "$N164_AWAL" '((.rows|length) - $n) == 1|if . then 1 else 0 end')"
cek "hanya ADA satu faktur dengan id itu" "V == 1" \
  "$(api "$OWNER" GET /transfer-stok | jq --arg a "$ID164A" '[.rows[]|select(.faktur_id==$a)]|length')"
# INI intinya: stok yang dijanjikan keluar dari CK tak boleh terhitung dua kali.
# Dibandingkan dengan nilai SEBELUM kiriman pertama — bukan dengan dirinya sendiri.
DJ164_AKHIR=$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK164" \
  | jq -r --arg i "$ING164" '[.rows[]|select(.ingredient_id==$i)][0].dalam_jalan // 0')
cek "stok 'dalam jalan' bergerak TEPAT 7 untuk satu pengiriman (bukan 14)" "abs(V - 7) < 0.001" \
  "$(python3 -c "print($DJ164_AKHIR - $DJ164_AWAL)")"
cek "sisa siap kirim tinggal 93 (100 − 7), bukan 86" "abs(V - 93) < 0.001" \
  "$(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK164" | jq -r --arg i "$ING164" '[.rows[]|select(.ingredient_id==$i)][0] | ((.saldo // 0) - (.dalam_jalan // 0))')"
cek "cabang tujuan melihat SATU kiriman untuk faktur itu" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$TJ164" | jq --arg a "$ID164A" '[.rows[]|select(.faktur_id==$a)]|length')"
# Kunci BEDA = pengiriman baru, dan itu memang harus lahir sebagai faktur
# tersendiri — kalau tidak, mengirim bahan yang sama dua kali jadi mustahil.
TF164C=$(api "$OWNER" POST /transfer-stok \
  "$(jq -nc --arg a "$CK164" --arg t "$TJ164" --arg i "$ING164" --arg r "$(cat /proc/sys/kernel/random/uuid)" \
     '{asal_branch_id:$a, tujuan_branch_id:$t, client_ref:$r, catatan:"uji 164 kedua", items:[{ingredient_id:$i, qty:3}]}')")
cek "client_ref BEDA → faktur baru (bukan ikut diputar ulang)" "V == 1" \
  "$(echo "$TF164C" | jq -r --arg a "$ID164A" '((.faktur_id!=$a) and ((.faktur_id|length)==36))|if . then 1 else 0 end')"
# Klien lama tanpa client_ref tak boleh berubah perilakunya.
TF164D=$(api "$OWNER" POST /transfer-stok \
  "$(jq -nc --arg a "$CK164" --arg t "$TJ164" --arg i "$ING164" \
     '{asal_branch_id:$a, tujuan_branch_id:$t, catatan:"uji 164 tanpa ref", items:[{ingredient_id:$i, qty:2}]}')")
cek "tanpa client_ref: tetap membuat faktur (kompatibilitas klien lama)" "V == 1" \
  "$(echo "$TF164D" | jq -r '((.faktur_id|length)==36)|if . then 1 else 0 end')"
cek "total dalam jalan = 7+3+2 = 12 (tak ada yang tergandakan)" "abs(V - 12) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET "/transfer-stok/saldo?branch_id=$CK164" | jq -r --arg i "$ING164" '[.rows[]|select(.ingredient_id==$i)][0].dalam_jalan // 0') - $DJ164_AWAL)")"

echo "== 165. Tambah Stok dari Menu: rantai dua panggilan tak melahirkan faktur ganda =="
# Halaman "Tambah Stok dari Menu" mengirim DUA permintaan berurutan dari satu
# tombol: faktur bahan baku di sini, lalu permintaan perlengkapan yang MENAUT
# ke `rencana_id` hasilnya. Kalau yang kedua gagal, yang pertama sudah
# menerbitkan faktur — tapi tombolnya memantulkan galat seolah tak terjadi
# apa-apa, dan orang menekannya lagi. Tanpa `client_ref`, gudang menerima DUA
# work-order untuk satu kebutuhan.
#
# Fikturnya dibuat sendiri (pelajaran §164): bahan ber-track_stok yang saldonya
# NOL di cabang tujuan, dipakai satu menu — sehingga selalu ada kekurangan yang
# benar-benar menerbitkan faktur, tak bergantung sisa seksi lain.
CB165=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="store")][0].id')
ING165=$(api "$OWNER" POST /bahan \
  '{"nama":"Bahan Rencana 165","satuan":"gr","harga_beli":500,"isi":1,"track_stok":true,"pengadaan":"beli","boleh_eceran":true}' \
  | jq -r .id)
# Bentuk body /menu: `category_id` + `harga_jual` + `tipe`/`mult` — BUKAN
# `kategori`/`harga`. Percobaan pertama memakai nama field karangan sendiri,
# POST /menu menjawab 400, dan seluruh §165 ikut 400 karena menunya tak pernah
# ada. Bentuk di bawah disalin dari §66 yang sudah terbukti jalan.
KAT165=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
MENU165=$(api "$OWNER" POST /menu \
  "$(jq -nc --arg i "$ING165" --arg k "$KAT165" \
     '{nama:"Menu Rencana 165", category_id:$k, tipe:"regular", mult:2, harga_jual:25000, komponen:[{ingredient_id:$i, qty:10}]}')" \
  | jq -r .id)
cek "dasar uji §165: cabang, kategori, bahan, dan menu berresep siap" "V == 1" \
  "$([ -n "$CB165" ] && [ "$CB165" != "null" ] && [ ${#KAT165} -eq 36 ] && [ ${#ING165} -eq 36 ] && [ ${#MENU165} -eq 36 ] && echo 1 || echo 0)"

REF165=$(cat /proc/sys/kernel/random/uuid)
BODY165=$(jq -nc --arg m "$MENU165" --arg t "$CB165" --arg r "$REF165" \
  '{items:[{menu_id:$m, porsi:20}], tujuan_branch_id:$t, client_ref:$r}')
N165_AWAL=$(api "$OWNER" GET /rekomendasi/permintaan | jq 'length')

R165A=$(api "$OWNER" POST /rekomendasi/menu/faktur "$BODY165")
RID165=$(echo "$R165A" | jq -r '.rencana_id // ""')
cek "permintaan pertama terbit (rencana_id + nomor PM-)" "V == 1" \
  "$(echo "$R165A" | jq -r '(((.rencana_id|length)==36) and ((.nomor_permintaan // "")|startswith("PM-")))|if . then 1 else 0 end')"
cek "…dan benar-benar menerbitkan faktur beli untuk kekurangannya" "V == 1" \
  "$(echo "$R165A" | jq -r '((.beli != null) or (.beli_produksi != null) or (.produksi != null))|if . then 1 else 0 end')"

# Inilah percobaan KEDUA: persis yang terjadi saat panggilan perlengkapan gagal
# dan orang menekan Buat sekali lagi dengan kunci yang sama.
R165B=$(api "$OWNER" POST /rekomendasi/menu/faktur "$BODY165")
cek "kiriman ulang memulangkan rencana_id yang SAMA" "V == 1" \
  "$(echo "$R165B" | jq -r --arg a "$RID165" '(.rencana_id==$a)|if . then 1 else 0 end')"
cek "…dan nomor PM- yang sama (diputar ulang, bukan diterbitkan lagi)" "V == 1" \
  "$(echo "$R165B" | jq -r --arg a "$(echo "$R165A" | jq -r '.nomor_permintaan')" '(.nomor_permintaan==$a)|if . then 1 else 0 end')"
cek "…dan faktur beli yang SAMA (bukan work-order kedua)" "V == 1" \
  "$(jq -nc --argjson a "$(echo "$R165A" | jq -c '{beli,beli_produksi,produksi,produksi_cabang}')" \
            --argjson b "$(echo "$R165B" | jq -c '{beli,beli_produksi,produksi,produksi_cabang}')" \
     '($a == $b)|if . then 1 else 0 end')"
cek "Data Permintaan Stok bertambah TEPAT satu, bukan dua" "abs(V - 1) < 0.001" \
  "$(python3 -c "print($(api "$OWNER" GET /rekomendasi/permintaan | jq 'length') - $N165_AWAL)")"

# client_ref BEDA = permintaan yang memang baru.
REF165C=$(cat /proc/sys/kernel/random/uuid)
R165C=$(api "$OWNER" POST /rekomendasi/menu/faktur \
  "$(jq -nc --arg m "$MENU165" --arg t "$CB165" --arg r "$REF165C" \
     '{items:[{menu_id:$m, porsi:5}], tujuan_branch_id:$t, client_ref:$r}')")
cek "client_ref BEDA → rencana baru (bukan ikut diputar ulang)" "V == 1" \
  "$(echo "$R165C" | jq -r --arg a "$RID165" '((.rencana_id!=$a) and ((.rencana_id|length)==36))|if . then 1 else 0 end')"
# Klien lama tanpa client_ref tak boleh berubah perilakunya.
R165D=$(api "$OWNER" POST /rekomendasi/menu/faktur \
  "$(jq -nc --arg m "$MENU165" --arg t "$CB165" '{items:[{menu_id:$m, porsi:3}], tujuan_branch_id:$t}')")
cek "tanpa client_ref: tetap membuat rencana (kompatibilitas klien lama)" "V == 1" \
  "$(echo "$R165D" | jq -r '((.rencana_id|length)==36)|if . then 1 else 0 end')"

echo "== 166. Resep: takaran batch tersimpan SATU NASIB dengan komponennya =="
# Biaya per satuan bahan produksi = (biaya resep / isi) x overhead_x. Pembilang
# dan penyebutnya dulu disimpan lewat DUA permintaan berurutan; yang kedua
# gagal menyisakan resep BARU dibagi `isi` LAMA — dan HPP tiap menu yang
# memakai bahan itu ikut keliru bagi SEMUA orang, tanpa tanda apa pun di layar.
#
# Yang dibuktikan seksi ini: (a) keduanya mendarat dalam SATU panggilan, dan
# (b) panggilan yang DITOLAK tak meninggalkan separuh pun — termasuk
# takarannya. Rollback di TENGAH transaksi (mis. 409 pengadaan berubah) tak
# bisa dipicu dari skrip secara deterministik; itu dijaga uji statis
# `resep-takaran-atomik.test.ts`, yang memastikan `tx.update(ingredients)`
# memang berada di dalam badan transaksi yang sama dengan komponennya.
ING166=$(api "$OWNER" POST /bahan \
  '{"nama":"Bahan Mentah 166","satuan":"gr","harga_beli":2000,"isi":1,"track_stok":true,"pengadaan":"beli","boleh_eceran":true}' \
  | jq -r .id)
PRD166=$(api "$OWNER" POST /bahan \
  '{"nama":"Bahan Produksi 166","satuan":"pcs","harga_beli":0,"isi":10,"overhead_x":1,"track_stok":true,"pengadaan":"produksi"}' \
  | jq -r .id)
cek "dasar uji §166: bahan mentah + bahan produksi siap" "V == 1" \
  "$([ ${#ING166} -eq 36 ] && [ ${#PRD166} -eq 36 ] && echo 1 || echo 0)"

# SATU panggilan: komponen baru + takaran baru sekaligus.
api "$OWNER" PUT "/bahan/$PRD166/resep" \
  "$(jq -nc --arg i "$ING166" '{komponen:[{ingredient_id:$i, qty:5}], atur:{isi:20, overhead_x:2}}')" \
  > /dev/null
B166=$(api "$OWNER" GET /bahan | jq -c --arg p "$PRD166" '[.[]|select(.id==$p)][0]')
cek "satu panggilan menulis takarannya juga: isi 10 → 20" "abs(V - 20) < 0.001" \
  "$(echo "$B166" | jq -r '.isi')"
cek "…dan overhead_x 1 → 2" "abs(V - 2) < 0.001" "$(echo "$B166" | jq -r '.overhead_x')"
cek "…dan komponennya memang tersimpan (1 baris, qty 5)" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$PRD166/resep" | jq -r --arg i "$ING166" \
     '((length==1) and (.[0].ingredient_id==$i) and ((.[0].qty|tonumber)==5))|if . then 1 else 0 end')"

# PANGGILAN YANG DITOLAK tak boleh meninggalkan separuh pun: resep yang memakai
# dirinya sendiri ditolak 400, dan takarannya HARUS tetap 20/2 — bukan 999/9.
cek "resep memakai dirinya sendiri → ditolak 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$PRD166/resep" \
     -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
     -d "$(jq -nc --arg p "$PRD166" '{komponen:[{ingredient_id:$p, qty:1}], atur:{isi:999, overhead_x:9}}')")"
B166B=$(api "$OWNER" GET /bahan | jq -c --arg p "$PRD166" '[.[]|select(.id==$p)][0]')
cek "ditolak: isi TIDAK ikut berubah (tetap 20, bukan 999)" "abs(V - 20) < 0.001" \
  "$(echo "$B166B" | jq -r '.isi')"
cek "ditolak: overhead_x TIDAK ikut berubah (tetap 2, bukan 9)" "abs(V - 2) < 0.001" \
  "$(echo "$B166B" | jq -r '.overhead_x')"
cek "ditolak: komponennya juga utuh (masih 1 baris qty 5)" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$PRD166/resep" | jq -r \
     '((length==1) and ((.[0].qty|tonumber)==5))|if . then 1 else 0 end')"

# Tanpa `atur`: perilaku klien lama tak berubah — takaran tak tersentuh.
api "$OWNER" PUT "/bahan/$PRD166/resep" \
  "$(jq -nc --arg i "$ING166" '{komponen:[{ingredient_id:$i, qty:7}]}')" > /dev/null
cek "tanpa atur: isi tetap 20 (kompatibilitas klien lama)" "abs(V - 20) < 0.001" \
  "$(api "$OWNER" GET /bahan | jq -r --arg p "$PRD166" '[.[]|select(.id==$p)][0].isi')"
cek "tanpa atur: komponennya tetap tersimpan (qty jadi 7)" "abs(V - 7) < 0.001" \
  "$(api "$OWNER" GET "/bahan/$PRD166/resep" | jq -r '.[0].qty')"

echo "── §167 Riwayat penerimaan: sehari penuh menurut jam dinding cabang ──"
# `confirmed_at` adalah `timestamptz`; tanggal yang diketik orang berarti
# tanggal DI ZONA PERUSAHAAN. Dulu jembatannya `new Date(`${dari}T00:00:00Z`)`
# — yang TERLIHAT seperti awal hari, tapi di WIB jam 07:00. Jendelanya bergeser
# tujuh jam: kiriman yang diterima subuh (jam sayur datang) tercatat pada HARI
# SEBELUMNYA, dan hari yang diminta malah kebagian subuh besoknya.
#
# PEMBAGIAN KERJA, supaya seksi ini tak dikira membuktikan lebih:
#   - Pergeseran tujuh jamnya sendiri dipatok uji satuan
#     `batas-hari-zona.test.ts`, yang bisa menyebut instant persis tanpa
#     bergantung jam berapa CI kebetulan berjalan.
#   - Yang dibuktikan DI SINI adalah BENTUK jendelanya lewat API sungguhan:
#     sehari penuh, menyambung, dan tertutup di kedua sisi luarnya.
#     Assertion (a)/(b) di bawah ikut menangkap bug aslinya setiap kali CI
#     berjalan antara 00:00–07:00 WIB — 7 dari 24 jam, bukan nol.
#
# TENGAH MALAM DITUNGGU, bukan dilewati (idiom yang sama dengan §137, yang
# catatannya merekam run CI 23:58 WIB gagal persis begitu). Seksi ini menerima
# kiriman lalu menyaringnya per tanggal; kalau tanggal WIB berganti di
# antaranya, semua assertion di bawah merah karena KALENDER, bukan karena
# produknya — dan merah yang salah sebab jauh lebih mahal daripada tunggu 3
# menit sekali seribu run.
JAM167=$(TZ=Asia/Jakarta date +%H%M)
if [ "$((10#$JAM167))" -ge 2357 ]; then
  TUNGGU167=$(( $(TZ=Asia/Jakarta date -d 'tomorrow 00:00:10' +%s) - $(date +%s) ))
  echo "   … §167 menunggu ${TUNGGU167}s melewati tengah malam WIB (seluruh seksi harus satu tanggal)"
  sleep "$TUNGGU167"
fi
CK167=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.is_active and .tipe=="central_kitchen")][0].id')
ST167=$(api "$OWNER" GET /cabang | jq -r --arg a "$CK167" '[.[]|select(.is_active and .tipe=="store" and .id!=$a)][0].id')
# Bahan dibuat sendiri (pelajaran §164): memakai sisa seksi lain membuat seksi
# ini bisa hijau tanpa pernah benar-benar berjalan.
ING167=$(api "$OWNER" POST /bahan \
  '{"nama":"Bahan Subuh 167","satuan":"gr","harga_beli":1500,"isi":1,"track_stok":true,"pengadaan":"beli","boleh_eceran":true}' \
  | jq -r .id)
FK167=$(api "$OWNER" POST /pembelian/faktur \
  "{\"branch_id\":\"$CK167\",\"tujuan_branch_id\":\"$ST167\",\"items\":[{\"ingredient_id\":\"$ING167\",\"mode\":\"pcs\",\"jumlah\":250,\"total_harga\":3750}]}" \
  | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FK167" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FK167" '{"ke":"menunggu"}' > /dev/null
api "$OWNER" POST "/pembelian/kirim/$FK167" '{}' > /dev/null
api "$OWNER" POST "/penerimaan/$FK167/terima" > /dev/null

HARI167=$(TZ=Asia/Jakarta date +%F)
KMR167=$(TZ=Asia/Jakarta date -d yesterday +%F 2>/dev/null || TZ=Asia/Jakarta date -v-1d +%F)
BSK167=$(TZ=Asia/Jakarta date -d tomorrow +%F 2>/dev/null || TZ=Asia/Jakarta date -v+1d +%F)
riwayat167() { # riwayat167 <query tambahan> → jumlah baris faktur ini
  api "$OWNER" GET "/penerimaan/riwayat?branch_id=$ST167&$1" \
    | jq --arg f "$FK167" '[.rows[]|select(.faktur_id==$f)] | length'
}
cek "dasar uji §167: kiriman dibuat dan BENAR-BENAR sudah diterima" "V == 1" \
  "$(riwayat167 "per_page=100")"

# (a) hari ini memuatnya. Inilah yang dulu gagal tiap kali penerimaannya
#     terjadi antara 00:00–07:00 WIB.
cek "tersaring di HARI INI (zona cabang), bukan hari lain" "V == 1" \
  "$(riwayat167 "dari=$HARI167&sampai=$HARI167")"
# (b) dan tidak bocor ke kemarin — dulu justru ke sinilah ia jatuh.
cek "TIDAK muncul di kemarin" "V == 0" "$(riwayat167 "dari=$KMR167&sampai=$KMR167")"
cek "TIDAK muncul di besok" "V == 0" "$(riwayat167 "dari=$BSK167&sampai=$BSK167")"

# Batas bawah sendirian: jendela mulai di AWAL hari ini, bukan di tengahnya.
cek "batas bawah saja (dari=hari ini) tetap memuatnya" "V == 1" "$(riwayat167 "dari=$HARI167")"
cek "batas bawah besok → sudah lewat, kosong" "V == 0" "$(riwayat167 "dari=$BSK167")"

# Batas atas sendirian: jendela berakhir di AKHIR hari ini. Kalau batas atasnya
# keliru dipasang di AWAL hari ini, assertion berikut jadi 0.
cek "batas atas saja (sampai=hari ini) memuat SELURUH hari ini" "V == 1" \
  "$(riwayat167 "sampai=$HARI167")"
cek "batas atas kemarin → hari ini di luar jendela, kosong" "V == 0" \
  "$(riwayat167 "sampai=$KMR167")"

cek "rentang kemarin..besok memuatnya tepat sekali" "V == 1" \
  "$(riwayat167 "dari=$KMR167&sampai=$BSK167")"

echo "── §168 Detail shift: daftar transaksi mengaku kalau dipotong ──"
# Modal detail shift menampilkan `jumlah_transaksi` (hitungan SEBENARNYA, dari
# agregat tanpa batas) tepat di atas daftar transaksinya, yang dibatasi 300.
# Pada shift ramai keduanya berbeda, dan tanpa penanda selisih itu terbaca
# sebagai transaksi yang HILANG — di layar tempat kasir mempertanggungjawabkan
# uang.
#
# BATAS SEKSI INI, supaya tak dikira membuktikan lebih: memicu pemotongan butuh
# >300 penjualan dalam satu shift — 300+ permintaan HTTP, terlalu mahal untuk
# CI. Yang dibuktikan di sini adalah sisi yang MURAH DAN SERING SALAH: medannya
# benar-benar ada di respons, dan pada shift kecil ia JUJUR berkata `false`
# sambil daftarnya utuh. Perilaku saat benar-benar terpotong dipatok uji statis
# `pemotongan-terungkap.test.ts` (termasuk penyapu "tiap penanda terpotong di
# DTO wajib dibaca web").
SH168=$(api "$OWNER" GET "/shift?per_page=50" | jq -r '(if type=="array" then . else .rows end)[0].id // ""')
cek "dasar uji §168: ada shift yang bisa diperiksa" "V == 1" \
  "$([ ${#SH168} -eq 36 ] && echo 1 || echo 0)"
D168=$(api "$OWNER" GET "/shift/$SH168")
cek "detail shift membawa medan transaksi_terpotong" "V == 1" \
  "$(echo "$D168" | jq '(has("transaksi_terpotong")) | if . then 1 else 0 end')"
cek "medannya boolean sejati, bukan null/teks" "V == 1" \
  "$(echo "$D168" | jq '((.transaksi_terpotong|type) == "boolean") | if . then 1 else 0 end')"
cek "shift kecil → TIDAK terpotong (penandanya jujur, bukan selalu true)" "V == 1" \
  "$(echo "$D168" | jq '(.transaksi_terpotong == false) | if . then 1 else 0 end')"
cek "tak terpotong → panjang daftar = jumlah_transaksi (dua angka sepakat)" "V == 1" \
  "$(echo "$D168" | jq '((.transaksi|length) == .jumlah_transaksi) | if . then 1 else 0 end')"
cek "daftarnya tak pernah melebihi batas 300" "V == 1" \
  "$(echo "$D168" | jq '((.transaksi|length) <= 300) | if . then 1 else 0 end')"

echo "── §169 Rekomendasi beli: sorotan \"perlu dibeli\" selalu punya isi ──"
# Di layar Rekomendasi Beli, baris disorot oranye bila `saran_beli` truthy,
# sementara angka yang ditawarkannya datang dari `jumlah_faktur`. Dulu keduanya
# memakai definisi KEKURANGAN yang berbeda — `Math.max(0, ...)` vs ambang
# epsilon `kekuranganBahan` — dan bedanya persis di ekor float. Bahan yang
# stoknya PAS bisa menyisakan ~5e-17: cukup untuk menyalakan sorotan, tak cukup
# untuk melahirkan faktur. Owner melihat baris oranye, saran "0", biaya Rp 0.
#
# Yang dipatok di sini adalah JANJINYA, bukan satu barisnya: untuk SETIAP baris,
# `saran_beli > 0` harus setara dengan `jumlah_faktur != null`. Sapuan seluruh
# daftar seperti ini menangkap ketaksepakatan di baris mana pun, termasuk baris
# yang tak terpikirkan saat menulis uji.
REK169=$(api "$OWNER" GET "/rekomendasi/beli?acuan=rentang&dari=$TODAY&sampai=$TODAY&target=20000000")
cek "dasar uji §169: daftarnya tidak kosong" "V >= 1" \
  "$(echo "$REK169" | jq '.bahan | length')"
cek "tiap baris: saran_beli > 0  <=>  jumlah_faktur ada" "V == 0" \
  "$(echo "$REK169" | jq '[.bahan[] | select(((.saran_beli // 0) > 0) != (.jumlah_faktur != null))] | length')"
cek "tak ada saran_beli mungil sisa ekor float (0 < v < 1e-9)" "V == 0" \
  "$(echo "$REK169" | jq '[.bahan[] | select((.saran_beli != null) and (.saran_beli > 0) and (.saran_beli < 0.000000001))] | length')"
cek "saran_beli tak pernah negatif" "V == 0" \
  "$(echo "$REK169" | jq '[.bahan[] | select((.saran_beli != null) and (.saran_beli < 0))] | length')"
# `null` TETAP berarti "tak bisa dihitung", bukan "tidak perlu beli". Rentang
# tanpa omzet acuan memberi baris-baris seperti itu; keberadaannya dipatok lebih
# dulu supaya asersi sesudahnya tak lulus hanya karena tak ada yang diperiksa.
REK169N=$(api "$OWNER" GET "/rekomendasi/beli?acuan=rentang&dari=$PAST&sampai=$PAST")
cek "dasar: ada baris yang kebutuhannya tak bisa dihitung" "V >= 1" \
  "$(echo "$REK169N" | jq '[.bahan[] | select(.kebutuhan == null)] | length')"
cek "kebutuhan null => saran_beli null, tak dipaksa jadi 0" "V == 0" \
  "$(echo "$REK169N" | jq '[.bahan[] | select(.kebutuhan == null and .saran_beli != null)] | length')"
cek "baris ber-faktur: estimasi biaya ikut terisi (sorotannya berisi)" "V == 0" \
  "$(echo "$REK169" | jq '[.bahan[] | select(.jumlah_faktur != null and .estimasi_biaya == null)] | length')"

echo "── §170 Kas laci milik SHIFT, bukan milik HARI INI ──"
# "Kas seharusnya" adalah janji yang sangat spesifik: uang yang HARUS ADA di
# laci sekarang. Ia dibaca kasir (`/shift/aktif`), owner (kartu Operasional
# Cabang, `GET /shift/pantau`), dan angka yang sama itu dibandingkan `POST
# /shift/tutup` untuk melahirkan selisih kas yang harus di-ACC.
#
# `/pantau` dulu menyusunnya dari `modal_awal` (milik SHIFT yang sedang
# terbuka) ditambah tunai SEHARIAN — dua jendela berbeda, dijumlah jadi satu
# angka. Di cabang bershift dua (pagi lalu sore; alur biasa, dan indeks
# `shifts_open_per_branch_uq` hanya melarang dua shift TERBUKA sekaligus),
# begitu kasir sore membuka laci angka itu ikut memuat seluruh tunai shift
# pagi — uang yang sudah dihitung, dicocokkan, dan diangkat saat tutup kasir.
# Owner membaca kekurangan sebesar omzet tunai satu shift penuh, di layar yang
# justru dipakai memantau kejujuran kas.
#
# Yang dibuktikan di sini adalah HARI DENGAN DUA SHIFT, ujung ke ujung — dan
# sekaligus arah baliknya: rekap "hari ini" TIDAK ikut menyempit ke shift.
CB170=$(api "$REISS105" GET /auth/me | jq -r '.user.branch_id')
KAT170=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
# Menu TANPA resep: seksi ini soal uang di laci, bukan stok — menu tanpa bahan
# tak pernah tertahan pagar ketersediaan, jadi angkanya tak bergantung sisa
# stok seksi lain (pola `M154B`, yang sudah terbukti laku di cabang ini).
M170=$(api "$OWNER" POST /menu \
  "$(jq -nc --arg k "$KAT170" '{nama:"Kas Uji170", category_id:$k, tipe:"regular", mult:2, harga_jual:21000, komponen:[]}')" \
  | jq -r '.id // ""')

pantau170() { api "$OWNER" GET /shift/pantau | jq --arg id "$CB170" '[.[]|select(.branch_id==$id)][0]'; }
jual170()   { api "$REISS105" POST /penjualan \
  "$(jq -nc --arg m "$M170" '{metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')"; }
tutup170() { # tutup shift berjalan TEPAT sebesar kas sistemnya (selalu "pas")
  local sid det fisik
  sid=$(api "$REISS105" GET /shift/aktif | jq -r '.id // ""')
  [ -z "$sid" ] && return 0
  # Kasir DIBUTAKAN selagi hitungan belum dikunci (§152), jadi angkanya diambil
  # dari owner. Bila hitungannya SUDAH dikunci, nominal yang berbeda ditolak 409
  # — tutup tanpa `uang_fisik` supaya yang terkunci itu yang dipakai.
  det=$(api "$OWNER" GET "/shift/$sid")
  fisik=$(echo "$det" | jq -r '.uang_fisik // empty')
  if [ -n "$fisik" ]; then
    api "$REISS105" POST /shift/tutup '{"catatan":"tutup awal §170"}' > /dev/null
  else
    api "$REISS105" POST /shift/tutup "{\"uang_fisik\":$(echo "$det" | jq -r '.kas_sistem')}" > /dev/null
  fi
}
buka170() { # buka170 <modal> → echo id shift ("" bila gagal)
  local modal="$1" r
  r=$(api "$REISS105" POST /shift/buka "{\"modal_awal\":$modal}")
  # `POST /shift/buka` menjawab 400 untuk DUA sebab yang berbeda: "shift sudah
  # terbuka" dan "Absen masuk dulu". Yang dibedakan PESANNYA, bukan sekadar
  # "tak ada id" — sebab `/absensi/saya` berselang-seling masuk/pulang, jadi
  # memanggilnya saat kasirnya sudah hadir justru meng-absen-PULANG dan
  # membuat percobaan berikutnya gagal beneran.
  if echo "$r" | jq -e '((.error // "") | test("Absen masuk"))' > /dev/null; then
    # §167 bisa menunggu melewati tengah malam, dan absen KEMARIN tak berlaku
    # untuk tanggal bisnis hari ini (`sedangHadir`).
    api "$REISS105" POST /absensi/saya '{"foto_url":"https://example.com/absen.jpg"}' > /dev/null
    r=$(api "$REISS105" POST /shift/buka "{\"modal_awal\":$modal}")
  fi
  echo "$r" | jq -r '.id // ""'
}

tutup170  # titik awal yang pasti: tak ada shift warisan seksi sebelumnya
SH170A=$(buka170 100000)
cek "dasar uji §170: menu tanpa resep siap & shift PAGI terbuka (modal 100.000)" "V == 1" \
  "$([ ${#M170} -eq 36 ] && [ ${#SH170A} -eq 36 ] && echo 1 || echo 0)"
cek "dasar uji §170: cabang kasir terbaca di /shift/pantau" "V == 1" \
  "$(pantau170 | jq '(.branch_id != null) | if . then 1 else 0 end')"
# Jendela HARIAN cabang ini sudah berisi penjualan seksi-seksi sebelumnya, jadi
# seluruh angka di bawah diperiksa sebagai SELISIH dari garis dasar ini.
HARI170=$(pantau170 | jq -r '.penjualan_tunai')
# Nominalnya DIBACA dari notanya, bukan dipatok 21.000. Seksi lain menyalakan
# lalu mematikan PB1 (§159) dan menggeser batas diskon kasir, dan `sales.total`
# — yang dijumlah baik oleh rekap harian maupun `rekapWindow` — ikut semua itu.
# Seksi ini menguji JENDELA MANA yang dipakai, bukan berapa pajaknya.
S170A=$(jual170)
TUNAI_A=$(echo "$S170A" | jq -r '.sale.total // 0')
cek "dasar uji §170: penjualan tunai PAGI tercatat dan nominalnya terbaca" "V > 0" "$TUNAI_A"

P170A=$(pantau170)
cek "PAGI: kas laci = modal 100.000 + tunai shift" "abs(V - (100000 + $TUNAI_A)) < 0.01" \
  "$(echo "$P170A" | jq -r '.kas_sistem')"
cek "PAGI: penjualan_tunai_shift = nota barusan" "abs(V - $TUNAI_A) < 0.01" \
  "$(echo "$P170A" | jq -r '.penjualan_tunai_shift')"
cek "PAGI: rekap HARIAN bertambah segitu juga (dua jendela masih sepakat)" "abs(V - ($HARI170 + $TUNAI_A)) < 0.01" \
  "$(echo "$P170A" | jq -r '.penjualan_tunai')"
# Dua LAYAR, satu angka. `?branch_id=` dipakai karena owner terkunci di Kantor
# (§135) — tanpanya `/shift/aktif` menjawab shift cabang lain.
cek "PAGI: /shift/aktif & /shift/pantau menyebut kas yang SAMA" "abs(V) < 0.01" \
  "$(python3 -c "print($(api "$OWNER" GET "/shift/aktif?branch_id=$CB170" | jq -r '.kas_sistem') - $(echo "$P170A" | jq -r '.kas_sistem'))")"

# ── Pergantian shift: uang PAGI dihitung, dicocokkan, lalu diangkat dari laci.
tutup170
SH170B=$(buka170 50000)
cek "dasar uji §170: shift SORE terbuka (modal 50.000), beda shift" "V == 1" \
  "$([ ${#SH170B} -eq 36 ] && [ "$SH170B" != "$SH170A" ] && echo 1 || echo 0)"

P170B=$(pantau170)
# INTI SEKSI INI. Sebelum perbaikan angkanya 50.000 + seluruh tunai HARIAN
# cabang — termasuk nota shift pagi yang uangnya sudah keluar dari laci.
cek "SORE: kas laci = modal 50.000 SAJA — bukan ikut memuat tunai shift pagi" "abs(V - 50000) < 0.01" \
  "$(echo "$P170B" | jq -r '.kas_sistem')"
cek "SORE: penjualan_tunai_shift = 0 (shift baru, laci belum menerima apa pun)" "abs(V) < 0.01" \
  "$(echo "$P170B" | jq -r '.penjualan_tunai_shift')"
cek "SORE: rekap HARIAN TIDAK menyusut — shift pagi tetap terhitung hari ini" "abs(V - ($HARI170 + $TUNAI_A)) < 0.01" \
  "$(echo "$P170B" | jq -r '.penjualan_tunai')"

S170B=$(jual170)
TUNAI_B=$(echo "$S170B" | jq -r '.sale.total // 0')
cek "dasar uji §170: penjualan tunai SORE tercatat dan nominalnya terbaca" "V > 0" "$TUNAI_B"
P170C=$(pantau170)
cek "SORE: kas laci = 50.000 + nota sore (hanya tunai shift ini)" "abs(V - (50000 + $TUNAI_B)) < 0.01" \
  "$(echo "$P170C" | jq -r '.kas_sistem')"
cek "SORE: penjualan_tunai_shift = nota sore saja" "abs(V - $TUNAI_B) < 0.01" \
  "$(echo "$P170C" | jq -r '.penjualan_tunai_shift')"
cek "SORE: rekap HARIAN memuat KEDUA shift" "abs(V - ($HARI170 + $TUNAI_A + $TUNAI_B)) < 0.01" \
  "$(echo "$P170C" | jq -r '.penjualan_tunai')"
cek "SORE: /shift/aktif & /shift/pantau tetap sepakat" "abs(V) < 0.01" \
  "$(python3 -c "print($(api "$OWNER" GET "/shift/aktif?branch_id=$CB170" | jq -r '.kas_sistem') - $(echo "$P170C" | jq -r '.kas_sistem'))")"

# ── Kasir tutup: tak ada laci untuk dilaporkan, tapi harinya tetap terhitung.
tutup170
P170D=$(pantau170)
cek "kasir TUTUP: kas laci 0 (tak ada laci untuk dilaporkan)" "abs(V) < 0.01" \
  "$(echo "$P170D" | jq -r '.kas_sistem')"
cek "kasir TUTUP: penjualan_tunai_shift null — BUKAN 0 (0 itu angka yang sah)" "V == 1" \
  "$(echo "$P170D" | jq '(.penjualan_tunai_shift == null) | if . then 1 else 0 end')"
cek "kasir TUTUP: rekap HARIAN tetap utuh, tak ikut dinolkan" "abs(V - ($HARI170 + $TUNAI_A + $TUNAI_B)) < 0.01" \
  "$(echo "$P170D" | jq -r '.penjualan_tunai')"

echo "── §171 BEP menghitung margin SESUDAH diskon ──"
# BEP menjawab "berapa porsi supaya biaya tetap tertutup?" = biaya_tetap ÷
# margin per porsi. Marginnya dulu disusun dari omzet KOTOR baris nota
# (`harga_satuan × porsi`), sementara potongan yang benar-benar diberikan kasir
# hidup di tingkat NOTA (`sales.diskon`) dan tak pernah ikut.
#
# Arah salahnya yang berbahaya: margin tampak lebih besar → BEP menjawab lebih
# KECIL. Layar yang tugasnya menjawab "berapa supaya tidak rugi" justru jadi
# yang paling optimistis. Sekaligus `GET /laporan` dan `GET /laporan/bep`
# berselisih soal laba: yang satu memakai `omzet − diskon − HPP`, yang lain
# `omzet − HPP`.
#
# Yang dipatok di sini INVARIAN antar-layar, bukan satu angka hasil: rentang
# tanggalnya memuat penjualan seksi-seksi lain juga, jadi angka mutlaknya tak
# bisa ditebak — tapi hubungan keduanya harus tetap persis.
SH171=$(buka170 0)
cek "dasar uji §171: shift terbuka & menu §170 masih ada" "V == 1" \
  "$([ ${#SH171} -eq 36 ] && [ ${#M170} -eq 36 ] && echo 1 || echo 0)"
# Nota BERDISKON: tanpa ini seluruh invarian di bawah lulus tanpa pernah
# menyentuh diskon — persis kelas uji hampa yang dihindari di berkas ini.
S171=$(api "$REISS105" POST /penjualan \
  "$(jq -nc --arg m "$M170" '{metode_bayar:"tunai", is_dine_in:false, diskon_tipe:"persen", diskon_nilai:20, items:[{menu_id:$m, qty:2}]}')")
cek "dasar uji §171: nota berdiskon 20% tercatat" "V > 0" "$(echo "$S171" | jq -r '.sale.diskon // 0')"

LAP171=$(api "$OWNER" GET "/laporan?dari=$TODAY&sampai=$TODAY&branch_id=$CB170")
BEP171=$(api "$OWNER" GET "/laporan/bep?biaya_tetap=10000000&dari=$TODAY&sampai=$TODAY&branch_id=$CB170")
QTY171=$(echo "$LAP171" | jq '[.item_terjual[].qty] | add // 0')
cek "dasar uji §171: rentangnya memang memuat potongan" "V > 0" \
  "$(echo "$LAP171" | jq '.total_diskon')"
cek "dasar uji §171: ada porsi terjual (penyebutnya bukan nol)" "V > 0" "$QTY171"
cek "dasar uji §171: BEP memakai basis penjualan, bukan katalog" "V == 1" \
  "$(echo "$BEP171" | jq '(.basis=="penjualan")|if . then 1 else 0 end')"

# Angka-angkanya ditarik ke variabel dulu — ekspresi python bersarang di dalam
# $( ) di dalam "..." terlalu mudah salah kutip, dan yang salah kutip di sini
# menghasilkan asersi yang gagal karena sintaks, bukan karena temuan.
M171=$(echo "$BEP171" | jq -r '.rata_margin_kontribusi')
H171=$(echo "$BEP171" | jq -r '.rata_harga_jual')
OMZ171=$(echo "$LAP171" | jq -r '.omzet')
DIS171=$(echo "$LAP171" | jq -r '.total_diskon')
HPP171=$(echo "$LAP171" | jq -r '.total_hpp')

# INTI: dua layar, satu definisi laba. margin×porsi harus = omzet − diskon − HPP.
cek "margin × porsi = omzet − diskon − HPP (sepakat dengan /laporan)" "abs(V) < 1" \
  "$(python3 -c "print($M171 * $QTY171 - ($OMZ171 - $DIS171 - $HPP171))")"
cek "harga rata-rata × porsi = omzet − diskon (yang benar-benar diterima)" "abs(V) < 1" \
  "$(python3 -c "print($H171 * $QTY171 - ($OMZ171 - $DIS171))")"
# Arah-balik: kalau diskonnya diam-diam diabaikan lagi, margin akan PERSIS sama
# dengan versi kotor — dua asersi ini yang menangkapnya, satu dalam rupiah dan
# satu dalam satuan yang benar-benar dibaca owner: porsi.
cek "margin LEBIH KECIL daripada versi kotor (diskonnya benar-benar menggigit)" "V == 1" \
  "$(python3 -c "print(1 if $M171 < ($OMZ171 - $HPP171) / $QTY171 else 0)")"
cek "porsi untuk BEP jadi lebih BANYAK daripada hitungan kotor" "V == 1" \
  "$(python3 -c "
import math
kotor = ($OMZ171 - $HPP171) / $QTY171
print(1 if math.ceil(10000000 / $M171) > math.ceil(10000000 / kotor) else 0)")"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §172 REFUND DI LUAR JAM BUKA TETAP DITANGGUNG SEBUAH SHIFT
#
# Rekap dulu mencocokkan refund ke shift MURNI lewat jendela waktu
# [opened_at, closed_at]. Refund yang dibuat saat TAK ADA shift terbuka —
# owner/admin meninjau transaksi di luar jam buka, jalur yang memang disengaja
# ("owner memeriksanya belakangan", dan owner/admin boleh merefund transaksi
# cabang mana pun) — jatuh di luar jendela shift MANA PUN. Akibatnya uang tunai
# keluar laci tapi kas harapan tak pernah turun: kasir berikutnya menghitung
# laci yang lebih tipis lalu memasukkannya sebagai modal awal, dan selisihnya
# lenyap tanpa pernah terangkat di tutup kasir — persis hal yang seluruh fitur
# tutup kasir ada untuk menangkapnya.
#
# Penjualannya sendiri SUDAH benar (`total + refund_total` = yang benar-benar
# ditagih saat itu), jadi yang diperiksa di sini khusus: ke mana refundnya
# dibebankan. Sisi `sales` sudah lama punya dua jalur (`shift_id` ATAU jendela);
# seksi ini menjaga sisi refund yang sekarang disamakan.
echo "── §172 refund di luar jam buka ──"

tutup170  # titik awal pasti: tak ada shift terbuka
SH172A=$(buka170 100000)
JUAL172=$(jual170)
SALE172=$(echo "$JUAL172" | jq -r '.sale.id // ""')
DET172=$(api "$OWNER" GET "/penjualan/$SALE172")
ITEM172=$(echo "$DET172" | jq -r '.items[0].id // ""')
cek "dasar §172: shift PAGI terbuka & satu penjualan tunai tercatat" "V == 1" \
  "$([ ${#SH172A} -eq 36 ] && [ ${#SALE172} -eq 36 ] && [ ${#ITEM172} -eq 36 ] && echo 1 || echo 0)"

# Tutup shift pagi. Sesudah ini TIDAK ADA shift terbuka di cabang.
tutup170
cek "§172 tak ada shift terbuka sesudah tutup (prasyarat ujinya)" "V == 1" \
  "$(api "$REISS105" GET /shift/aktif | jq '(.id // null) == null | if . then 1 else 0 end')"

# Refund DI LUAR jam buka — inilah baris yang dulu jatuh di luar jendela mana pun.
REF172=$(api "$OWNER" POST "/penjualan/$SALE172/refund" \
  "$(jq -nc --arg it "$ITEM172" '{alasan:"uji §172 di luar jam", items:[{sale_item_id:$it, qty:1}]}')")
NOM172=$(echo "$REF172" | jq -r '.nominal // 0')
cek "§172 refund di luar jam buka BERHASIL (jalurnya memang disengaja terbuka)" "V > 0" \
  "$NOM172"

# Shift BERIKUTNYA yang dibuka menanggung refund tadi: laci inilah yang uangnya
# benar-benar keluar. Kas sistemnya = modal − refund, bukan modal bulat-bulat.
SH172B=$(buka170 100000)
KAS172=$(api "$OWNER" GET "/shift/$SH172B" | jq -r '.kas_sistem')
cek "§172 shift berikutnya menanggung refund luar jam (kas = modal − refund)" "abs(V) < 1" \
  "$(python3 -c "print($KAS172 - (100000 - $NOM172))")"
# Arah-balik yang menangkap regresi ke perilaku lama: dulu refundnya hilang
# sama sekali, jadi kas sistem akan PERSIS sama dengan modal awal.
cek "§172 kas sistem TIDAK sama dengan modal bulat (refundnya benar-benar menggigit)" "V == 1" \
  "$(python3 -c "print(1 if abs($KAS172 - 100000) > 1 else 0)")"

# Shift pagi yang SUDAH DITUTUP tidak boleh ikut bergeser: uangnya dulu benar
# masuk dan sudah dihitung cocok saat tutup kasir.
KASA172=$(api "$OWNER" GET "/shift/$SH172A" | jq -r '.kas_sistem')
cek "§172 shift yang sudah ditutup TIDAK bergeser oleh refund susulan" "abs(V) < 1" \
  "$(python3 -c "print($KASA172 - (100000 + 21000))")"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §173 BAYAR OPEN BILL BERBARENGAN: SATU BILL, SATU TRANSAKSI
#
# `createSale` membaca bill-nya, menolak bila `closed_at` sudah terisi, lalu di
# ujung transaksi menutupnya dengan `UPDATE … WHERE closed_at IS NULL`.
# Rangkaian itu hanya menangkap kasus BERURUTAN. Dua kasir yang menekan "bayar"
# pada bill yang sama di saat bersamaan sama-sama membaca `closed_at` masih
# kosong (READ COMMITTED tak memperlihatkan tulisan yang belum di-commit), jadi
# keduanya lolos penjaganya dan keduanya MENERBITKAN PENJUALAN. Yang kedua lalu
# gagal mengunci bill-nya — tapi diam-diam, sebab UPDATE yang tak mencocokkan
# satu baris pun bukan galat. Satu bill, dua transaksi, tamu tertagih dua kali.
#
# Idempotensi `client_ref` tidak menutup ini: dua kasir mengirim ref berbeda.
echo "── §173 bayar open bill berbarengan ──"

tutup170
SH173=$(buka170 100000)
BILL173=$(api "$REISS105" POST /open-bill \
  "$(jq -nc --arg m "$M170" '{items:[{menu_id:$m, qty:1}]}')" | jq -r '.id // ""')
cek "dasar §173: shift terbuka & satu open bill siap dibayar" "V == 1" \
  "$([ ${#SH173} -eq 36 ] && [ ${#BILL173} -eq 36 ] && echo 1 || echo 0)"

# Dua permintaan bayar BERBARENGAN, `client_ref` BERBEDA — persis dua kasir.
R173A=$(mktemp); R173B=$(mktemp)
for f in "$R173A" "$R173B"; do
  curl -s -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $REISS105" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg b "$BILL173" --arg m "$M170" --arg r "$(python3 -c 'import uuid;print(uuid.uuid4())')" \
        '{open_bill_id:$b, client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')" \
    -w '\n%{http_code}' > "$f" &
done
wait

# `curl -w '\n%{http_code}'` meninggalkan berkas TANPA newline penutup, jadi
# `tail -n1` dua berkas berturut-turut MENYAMBUNG jadi satu baris ("201409")
# dan `grep '^201$'` tak pernah cocok — hitungannya 0 walau servernya benar.
# `printf '%s\n'` memaksa pemisahnya.
KODE173=$(for f in "$R173A" "$R173B"; do printf '%s\n' "$(tail -n1 "$f")"; done)
SUKSES173=$(printf '%s\n' "$KODE173" | grep -c '^201$' || true)
GAGAL409_173=$(printf '%s\n' "$KODE173" | grep -c '^409$' || true)
LIMA173=$(printf '%s\n' "$KODE173" | grep -c '^5' || true)

cek "§173 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" "$LIMA173"
# INTI: tepat SATU yang boleh jadi transaksi. Dulu keduanya 201.
cek "§173 TEPAT SATU yang jadi penjualan (dulu dua → tamu tertagih dua kali)" "V == 1" \
  "$SUKSES173"
cek "§173 yang kalah ditolak 409, bukan diam-diam sukses" "V == 1" "$GAGAL409_173"
# Sebabnya harus yang SUDAH dikenal antrean offline — kiriman kembar aman dibuang.
cek "§173 penolakannya bersebab bill_sudah_dibayar (dikenal klien offline)" "V == 1" \
  "$(for f in "$R173A" "$R173B"; do head -n-1 "$f"; printf '\n'; done | jq -rs '[.[]?|select(.sebab=="bill_sudah_dibayar")]|length' 2>/dev/null || echo 0)"

# Bill-nya benar-benar tertutup, bukan cuma "yang kedua kebetulan gagal".
# Dibaca sebagai KASIR: /open-bill/* dijaga requireRole("cashier"), dan
# `loadDetail` memulangkan null untuk bill ber-`closed_at` — jadi 404 di sini
# artinya bill itu memang sudah tak bisa dibayar lagi oleh siapa pun.
cek "§173 bill itu tertutup — tak muncul lagi sebagai bill yang bisa dibayar" "V == 404" \
  "$(status_code "$REISS105" GET "/open-bill/$BILL173")"
# Dan tak ada jalan lain menerbitkan transaksi kedua: percobaan BERURUTAN pun
# ditolak dengan sebab yang sama, bukan cuma yang berbarengan.
cek "§173 percobaan bayar BERIKUTNYA juga 409 (bukan hanya balapannya yang dijaga)" "V == 409" \
  "$(status_code_body "$REISS105" POST /penjualan \
      "$(jq -nc --arg b "$BILL173" --arg m "$M170" --arg r "$(python3 -c 'import uuid;print(uuid.uuid4())')" \
        '{open_bill_id:$b, client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')")"
rm -f "$R173A" "$R173B"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §174 TERIMA KIRIMAN PERLENGKAPAN BERBARENGAN: STOK MASUK SEKALI
#
# `terimaKirimanPerlengkapan` memeriksa status kiriman lalu menulis SEPASANG
# mutasi stok (−qty di asal, +qty di tujuan). Pemeriksaan itu hanya menangkap
# percobaan BERURUTAN — yang memang sudah dijaga §84 ("terima ulang → 400").
#
# Yang tak tertutup: dua orang menekan "Terima" pada kiriman yang sama di saat
# bersamaan. Keduanya membaca status `dikirim` (READ COMMITTED tak
# memperlihatkan tulisan yang belum di-commit), keduanya lolos penjaganya, dan
# keduanya menulis mutasinya. Stok dikreditkan DUA KALI di cabang tujuan dan
# didebit dua kali di cabang asal — permanen, tanpa jejak selain dua baris
# mutasi kembar ber-nomor kiriman yang sama.
#
# Tak ada pengaman lain yang menahannya: `supply_mutations_auto_uq` PARSIAL
# (`WHERE tipe = 'auto'`) sedangkan baris ini ber-tipe `kirim`/`terima`, dan
# mutasinya lahir ber-status bawaan `disetujui` sehingga langsung terhitung.
echo "── §174 terima kiriman perlengkapan berbarengan ──"

# Item BARU khusus seksi ini — supaya saldo $TU84 milik §84 tidak tergeser.
S174=$(api "$OWNER" POST /perlengkapan '{"nama":"Sarung Tangan Uji174","satuan":"pasang"}' | jq -r '.id // ""')
api "$OWNER" POST "/perlengkapan/$S174/masuk?branch_id=$CK52_UTAMA" '{"qty":20,"total_harga":40000}' > /dev/null
MK174=$(api "$OWNER" POST "/perlengkapan/$S174/minta?branch_id=$CB46_ID" '{"qty":6}')
KIR174=$(echo "$MK174" | jq -r '.kiriman_id // ""')
cek "dasar §174: item ber-stok CK 20 & kiriman 6 terbit (status dikirim)" "V == 1" \
  "$([ ${#S174} -eq 36 ] && [ ${#KIR174} -eq 36 ] && echo 1 || echo 0)"
# Sama seperti §84: ledger dibaca dari sudut CK sendiri, janji dari sudut cabang.
cek "dasar §174: sebelum diterima — cabang 0, ledger CK 20" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$S174" '[.[]|select(.id==$id)][0].saldo') == 20 and $(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$S174" '[.[]|select(.id==$id)][0].saldo') == 0 else 0)")"
cek "dasar §174: yang dijanjikan tinggal 14 (6 sudah punya tuan)" "abs(V - 14) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$S174" '[.[]|select(.id==$id)][0].saldo_ck')"

# Dua "Terima" BERBARENGAN pada kiriman yang sama — persis dua orang di layar
# Penerimaan cabang.
R174A=$(mktemp); R174B=$(mktemp)
for f in "$R174A" "$R174B"; do
  curl -s -X POST "$BASE/api/perlengkapan/kiriman/$KIR174/terima?branch_id=$CB46_ID" \
    -H "Authorization: Bearer $OWNER" -w '\n%{http_code}' > "$f" &
done
wait
# `curl -w '\n%{http_code}'` meninggalkan berkas TANPA newline penutup, jadi
# `tail -n1` dua berkas berturut-turut akan MENYAMBUNG jadi satu baris bila
# pemisahnya tak dipaksa (pelajaran §173).
KODE174=$(for f in "$R174A" "$R174B"; do printf '%s\n' "$(tail -n1 "$f")"; done)
cek "§174 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" \
  "$(printf '%s\n' "$KODE174" | grep -c '^5' || true)"
cek "§174 TEPAT SATU yang diterima (dulu dua → stok masuk dua kali)" "V == 1" \
  "$(printf '%s\n' "$KODE174" | grep -c '^200$' || true)"
cek "§174 yang kalah ditolak 400, bukan diam-diam sukses" "V == 1" \
  "$(printf '%s\n' "$KODE174" | grep -c '^400$' || true)"

# INTI SEKSI INI: saldonya. Kode HTTP masih bisa kebetulan benar; angka stok
# tidak. Dulu cabang jadi 12 dan CK jadi 8.
cek "§174 saldo cabang bergerak SEKALI: 6, bukan 12" "abs(V - 6) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$S174" '[.[]|select(.id==$id)][0].saldo')"
cek "§174 saldo CK berkurang SEKALI: 14, bukan 8" "abs(V - 14) < 0.001" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK52_UTAMA" | jq --arg id "$S174" '[.[]|select(.id==$id)][0].saldo')"
# Sesudah balapan, kiriman itu benar-benar tertutup: percobaan BERURUTAN pun 400.
cek "§174 percobaan terima BERIKUTNYA juga 400 (bukan hanya balapannya dijaga)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/perlengkapan/kiriman/$KIR174/terima?branch_id=$CB46_ID" -H "Authorization: Bearer $OWNER")"
rm -f "$R174A" "$R174B"


# ─────────────────────────────────────────────────────────────────────────────
# §175 KOSONGKAN TEMPAT SAMPAH SESUDAH ADA PENJUALAN ASAL OPEN BILL
#
# "Kosongkan" menghapus KERAS baris `sales` yang sudah di sampah. Semua FK ke
# `sales.id` ber-`ON DELETE cascade` — KECUALI satu: `open_bills.sale_id`, yang
# lahir tanpa klausa `onDelete` sama sekali (jadi `no action`). Begitu ada satu
# saja penjualan yang berasal dari open bill lalu dibatalkan, DELETE itu ditolak
# Postgres, dan karena seluruh "Kosongkan" berjalan dalam SATU transaksi,
# semuanya ikut rollback. Tempat Sampah jadi tak bisa dikosongkan LAGI —
# permanen, dan tak ada tombol lain untuk membersihkannya.
#
# §91 tak pernah menangkapnya: ia berjalan jauh SEBELUM seksi open bill (§147,
# §162, §173), jadi saat itu tak ada satu pun `open_bills.sale_id` yang terisi.
# Urutan seksi inilah yang menyembunyikan bug ini, bukan ketiadaan uji.
echo "── §175 kosongkan Tempat Sampah sesudah penjualan asal open bill ──"

tutup170
SH175=$(buka170 100000)
BILL175=$(api "$REISS105" POST /open-bill \
  "$(jq -nc --arg m "$M170" '{items:[{menu_id:$m, qty:1}]}')" | jq -r '.id // ""')
SALE175=$(api "$REISS105" POST /penjualan \
  "$(jq -nc --arg b "$BILL175" --arg m "$M170" --arg r "$(python3 -c 'import uuid;print(uuid.uuid4())')" \
      '{open_bill_id:$b, client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')" \
  | jq -r '.sale.id // ""')
cek "dasar §175: open bill terbayar → penjualan terbit (jejak sale_id terisi)" "V == 1" \
  "$([ ${#BILL175} -eq 36 ] && [ ${#SALE175} -eq 36 ] && echo 1 || echo 0)"

# Batalkan penjualan itu → masuk Tempat Sampah, dan `open_bills.sale_id` masih
# menunjuk ke barisnya. Inilah keadaan yang mengunci "Kosongkan".
api "$OWNER" DELETE "/penjualan/$SALE175" > /dev/null
cek "dasar §175: penjualan asal-bill itu ada di Tempat Sampah" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg id "$SALE175" '([.[] | select(.jenis=="penjualan" and .key==$id)] | length==1) | if . then 1 else 0 end')"

# INTI: dulu 500 — FK `open_bills_sale_id_sales_id_fk` menolak DELETE-nya dan
# seluruh transaksi rollback. Sekarang `ON DELETE set null`: bill-nya tetap ada
# sebagai jejak asal pesanan, hanya tautannya yang putus.
cek "§175 kosongkan → 200, bukan 500 (dulu Tempat Sampah terkunci permanen)" "V == 200" \
  "$(status_code "$OWNER" POST /sampah/kosongkan)"
cek "§175 kosongkan → ok:true" "V == 1" \
  "$(api "$OWNER" POST /sampah/kosongkan | jq '(.ok==true) | if . then 1 else 0 end')"
# Dan benar-benar terhapus, bukan sekadar tak melempar galat.
cek "§175 penjualan asal-bill itu lenyap dari Tempat Sampah" "V == 0" \
  "$(api "$OWNER" GET /sampah | jq --arg id "$SALE175" '[.[] | select(.jenis=="penjualan" and .key==$id)] | length')"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §176 DUA PERMINTAAN BER-client_ref SAMA BERBARENGAN: SATU PENJUALAN
#
# Ledger idempotensi dulu hanya DIBACA sebelum eksekusi dan DITULIS sesudahnya.
# Rangkaian itu tak menjaga apa pun terhadap yang berbarengan: dua permintaan
# ber-`client_ref` sama sama-sama mendapat `null` dari `cariHasilIdempoten`,
# sama-sama menjalankan `createSale`, lalu yang kedua kalah di unique index dan
# hasilnya DIBUANG diam-diam oleh `onConflictDoNothing`. Ledger tampak rapi satu
# baris; penjualannya dua.
#
# Bedanya dengan §173: di sana dua kasir mengirim ref BERBEDA (yang dijaga
# `open_bills.closed_at`). Di sini SATU perangkat mengirim ref yang SAMA — dan
# itu tak butuh manusia sama sekali: terukur di Chromium, browser mengulang
# sendiri POST yang soketnya ditutup pada koneksi keep-alive yang dipakai ulang.
# `/sync` sudah dijaga klaim atomik sejak lama; jalur online belum, sampai kini.
echo "── §176 dua permintaan ber-client_ref sama berbarengan ──"

tutup170
SH176=$(buka170 100000)
REF176=$(python3 -c 'import uuid;print(uuid.uuid4())')
cek "dasar §176: shift terbuka & satu kunci idempotensi disiapkan" "V == 1" \
  "$([ ${#SH176} -eq 36 ] && [ ${#REF176} -eq 36 ] && echo 1 || echo 0)"

R176A=$(mktemp); R176B=$(mktemp)
for f in "$R176A" "$R176B"; do
  curl -s -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $REISS105" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg m "$M170" --arg r "$REF176" \
        '{client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')" \
    -w '\n%{http_code}' > "$f" &
done
wait
KODE176=$(for f in "$R176A" "$R176B"; do printf '%s\n' "$(tail -n1 "$f")"; done)
cek "§176 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" \
  "$(printf '%s\n' "$KODE176" | grep -c '^5' || true)"

# INTI: berapa PENJUALAN yang lahir, bukan berapa kode 2xx. Yang kalah klaim
# boleh dijawab 409 "sedang_diproses" ATAU — bila yang menang keburu selesai —
# 200 berisi penjualan yang SAMA. Keduanya benar; yang tak boleh adalah dua id
# berbeda. Dulu tepat itu yang terjadi.
cek "§176 TEPAT SATU penjualan lahir (dulu dua → omzet & stok terhitung ganda)" "V == 1" \
  "$(for f in "$R176A" "$R176B"; do head -n-1 "$f"; printf '\n'; done | jq -rs '[.[]?|.sale?.id//empty]|unique|length' 2>/dev/null || echo 0)"

# Dan kuncinya benar-benar tercatat: percobaan BERIKUTNYA memutar ulang
# penjualan yang sama, bukan menerbitkan yang baru.
ID176=$(for f in "$R176A" "$R176B"; do head -n-1 "$f"; printf '\n'; done | jq -rs '[.[]?|.sale?.id//empty]|first // ""' 2>/dev/null || echo "")
ULANG176=$(api "$REISS105" POST /penjualan \
  "$(jq -nc --arg m "$M170" --arg r "$REF176" \
      '{client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')")
cek "§176 kiriman ulang memutar ulang penjualan yang SAMA, bukan bikin baru" "V == 1" \
  "$(echo "$ULANG176" | jq --arg id "$ID176" '(.sale.id == $id) | if . then 1 else 0 end')"
rm -f "$R176A" "$R176B"

# KONTRAK "LEPAS SAAT GAGAL" — risiko regresi dari klaim itu sendiri, dan
# justru yang paling mudah lolos dari perhatian.
#
# Web menahan `client_ref` yang SAMA sampai SUKSES (`refPembayaran.current ??=
# uuidV4()`, hanya direset di `onSuccess`). Jadi kasir yang ditolak — stok
# kurang, kasir belum dibuka, diskon lewat batas — menekan Bayar lagi dengan
# kunci yang sama. Kalau penolakan itu tersimpan di ledger dan diputar ulang,
# ia akan menerima penolakan lama itu SELAMANYA: satu kali gagal mengunci mati
# kunci itu, dan tak ada di layar yang memberitahunya harus bagaimana.
#
# Maka klaim yang eksekusinya melempar WAJIB dilepas. Diuji ujung ke ujung
# lewat penolakan yang paling mudah dipulihkan: kasir belum dibuka.
tutup170
REFG176=$(python3 -c 'import uuid;print(uuid.uuid4())')
BADAN176=$(jq -nc --arg m "$M170" --arg r "$REFG176" \
  '{client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')
cek "§176 tanpa shift terbuka, penjualan ber-ref baru ditolak 409" "V == 409" \
  "$(status_code_body "$REISS105" POST /penjualan "$BADAN176")"
SH176B=$(buka170 100000)
cek "dasar §176: kasir dibuka lagi" "V == 1" "$([ ${#SH176B} -eq 36 ] && echo 1 || echo 0)"
# INTI: kunci yang SAMA, sesudah sebabnya dibereskan → harus benar-benar jadi
# penjualan. Klaim yang tak dilepas akan menjawab 409 di sini, selamanya.
cek "§176 ref yang SAMA sesudah kasir dibuka BERHASIL (klaim gagal dilepas)" "V == 201" \
  "$(status_code_body "$REISS105" POST /penjualan "$BADAN176")"


# ─────────────────────────────────────────────────────────────────────────────
# §177 DUA REFUND BER-client_ref SAMA BERBARENGAN: UANG KEMBALI SEKALI
#
# Lubang yang sama seperti §176, tapi akibatnya langsung uang. Dan di sini
# penguncian barisnya justru yang membuat urutannya rapi DAN salah:
# `refundSajian` mengunci `sale_items` dengan `FOR UPDATE`, jadi permintaan
# kedua tidak ditolak — ia MENUNGGU yang pertama commit, lalu membaca sisa
# porsi yang memang masih ada (qty 2, baru direfund 1), lalu mengembalikan uang
# untuk kedua kalinya. Validasi "melebihi sisa porsi" tak pernah menyentuhnya.
echo "── §177 dua refund ber-client_ref sama berbarengan ──"

SALE177=$(api "$REISS105" POST /penjualan \
  "$(jq -nc --arg m "$M170" '{metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:2}]}')" \
  | jq -r '.sale.id // ""')
ITEM177=$(api "$OWNER" GET "/penjualan/$SALE177" | jq -r '.items[0].id // ""')
REF177=$(python3 -c 'import uuid;print(uuid.uuid4())')
# qty 2 DISENGAJA: dua refund qty 1 masing-masing SAH menurut sisa porsi, jadi
# yang menahannya hanya idempotensi — persis yang diuji.
cek "dasar §177: penjualan qty 2 tercatat & barisnya terbaca" "V == 1" \
  "$([ ${#SALE177} -eq 36 ] && [ ${#ITEM177} -eq 36 ] && echo 1 || echo 0)"

R177A=$(mktemp); R177B=$(mktemp)
for f in "$R177A" "$R177B"; do
  curl -s -X POST "$BASE/api/penjualan/$SALE177/refund" -H "Authorization: Bearer $OWNER" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg it "$ITEM177" --arg r "$REF177" \
        '{client_ref:$r, alasan:"uji §177", items:[{sale_item_id:$it, qty:1}]}')" \
    -w '\n%{http_code}' > "$f" &
done
wait
cek "§177 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" \
  "$(for f in "$R177A" "$R177B"; do printf '%s\n' "$(tail -n1 "$f")"; done | grep -c '^5' || true)"

# INTI: angka di pembukuan, bukan kode HTTP. Dulu qty_refund jadi 2 dan uang
# keluar dua kali untuk satu kali penekanan tombol.
DET177=$(api "$OWNER" GET "/penjualan/$SALE177")
cek "§177 porsi terefund SEKALI: qty_refund 1, bukan 2" "abs(V - 1) < 0.001" \
  "$(echo "$DET177" | jq --arg it "$ITEM177" '[.items[]|select(.id==$it)][0].qtyRefund')"
# `subtotal` IKUT TURUN saat refund, jadi sesudah satu dari dua porsi kembali
# keduanya bernilai satu porsi — `refundTotal == subtotal`, dan sisanya masih
# di atas nol. Refund ganda menghabiskannya: subtotal 0, refundTotal dua porsi.
# Dibandingkan satu sama lain, bukan ke angka mati, sebab seksi lain menyalakan
# lalu mematikan PB1 (§159) dan menggeser batas diskon.
cek "§177 sisa tagihan masih SATU porsi (refund ganda akan menghabiskannya)" "V > 0" \
  "$(echo "$DET177" | jq '.sale.subtotal')"
cek "§177 refund_total = SATU porsi, sama besar dengan sisanya" "V == 1" \
  "$(echo "$DET177" | jq '(.sale.refundTotal == .sale.subtotal) | if . then 1 else 0 end')"
rm -f "$R177A" "$R177B"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §178 PENJUALAN ONLINE DITAUTKAN KE SHIFT-NYA, BUKAN CUMA KE JENDELA WAKTU
#
# `sales.shift_id` ada justru supaya rekap tak bergantung pada jendela waktu.
# Jalur SINKRON mengisinya; jalur ONLINE tidak — padahal ia baru saja mencari
# shift terbuka untuk gerbang "Kasir belum dibuka", lalu MEMBUANG hasilnya.
# Akibatnya setiap transaksi online ber-`shift_id` NULL dan seluruh
# penautannya jatuh ke jendela waktu — persis hal yang kolom itu ada untuk
# menggantikannya, tak pernah terisi di jalur yang paling ramai.
#
# Terlihat langsung di data: sebelum perbaikan, satu-satunya baris ber-shift_id
# di hari uji adalah yang lahir lewat /sync.
echo "── §178 penjualan online tertaut ke shift ──"

tutup170
SH178=$(buka170 100000)
SALE178=$(jual170 | jq -r '.sale.id // ""')
cek "dasar §178: shift terbuka & penjualan online tercatat" "V == 1" \
  "$([ ${#SH178} -eq 36 ] && [ ${#SALE178} -eq 36 ] && echo 1 || echo 0)"

# INTI: dulu null.
cek "§178 penjualan online ber-shift_id (dulu NULL di semua transaksi online)" "V == 1" \
  "$(api "$OWNER" GET "/penjualan/$SALE178" | jq '(.sale.shiftId != null) | if . then 1 else 0 end')"
# Dan bukan sekadar terisi — terisi shift yang BENAR.
cek "§178 shift_id-nya persis shift yang sedang terbuka" "V == 1" \
  "$(api "$OWNER" GET "/penjualan/$SALE178" | jq --arg s "$SH178" '(.sale.shiftId == $s) | if . then 1 else 0 end')"
# Jalur sinkron tetap memegang kendali: shift yang DIKIRIMNYA tak boleh ditimpa
# oleh shift terbuka saat ini — itulah yang membuat transaksi susulan benar.
cek "§178 rekap shift memuat penjualan itu" "V > 0" \
  "$(api "$OWNER" GET "/shift/$SH178" | jq '.kas_sistem')"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §179 DUA PERMINTAAN TAMBAH STOK BERBARENGAN: STOK CK DIJANJIKAN SEKALI
#
# `rencanaDariMenu` membaca saldo CK dan barang-dalam-jalan lewat `db` — DI LUAR
# transaksi yang menuliskan fakturnya, dan tanpa kunci apa pun. Saldo cabang
# diturunkan dari ledger mutasi, jadi tak ada baris yang bisa dikunci dan
# `FOR UPDATE` pun tak menolong: dua permintaan yang dikirim bersamaan sama-sama
# membaca saldo lama, sama-sama menyimpulkan "tinggal kirim dari CK", dan
# sama-sama menerbitkan faktur kirimnya.
#
# Akibatnya baru muncul jauh belakangan: saldo CK jadi MINUS saat kedua kiriman
# diterima, di dua cabang berbeda, tanpa jejak yang menghubungkan keduanya.
# Kontraknya sudah tertulis di `qtyDalamJalan` ("pemanggil yang memvalidasi
# sebelum menulis harus memakai transaksi + kunciKirimCabang") dan
# `POST /produksi/kirim` sudah mematuhinya — jalur permintaan ini belum.
echo "── §179 dua permintaan tambah stok berbarengan ──"

# CK punya TEPAT 30 butir siap kirim; cabang kosong. Satu permintaan porsi 20
# menyerap seluruh 30 itu — jadi dua permintaan berbarengan memperebutkan stok
# yang hanya cukup untuk SATU.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":30},{\"ingredient_id\":\"$DAG66\",\"qty\":20000},{\"ingredient_id\":\"$TEP66\",\"qty\":5000}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
cek "dasar §179: preview menjanjikan kirim_ck = 30 dari stok CK" "abs(V - 30) < 0.001" \
  "$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].kirim_ck')"

BADAN179="{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}"
R179A=$(mktemp); R179B=$(mktemp)
for f in "$R179A" "$R179B"; do
  curl -s -X POST "$BASE/api/rekomendasi/menu/faktur" -H "Authorization: Bearer $OWNER" \
    -H 'Content-Type: application/json' -d "$BADAN179" -w '\n%{http_code}' > "$f" &
done
wait
KODE179=$(for f in "$R179A" "$R179B"; do printf '%s\n' "$(tail -n1 "$f")"; done)
cek "§179 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" \
  "$(printf '%s\n' "$KODE179" | grep -c '^5' || true)"

# INTI: berapa faktur KIRIM yang lahir. Dulu dua — 60 butir dijanjikan dari
# stok 30, dan saldo CK baru jadi minus saat keduanya diterima.
cek "§179 TEPAT SATU faktur kirim lahir (dulu dua → CK menjanjikan 60 dari 30)" "V == 1" \
  "$(for f in "$R179A" "$R179B"; do head -n-1 "$f"; printf '\n'; done | jq -rs '[.[]?|.kirim?.faktur_id//empty]|unique|length' 2>/dev/null || echo 0)"
# SENGAJA tidak menuntut "yang kalah pasti 409". Ada dua jalinan yang sama-sama
# BENAR: bila perencanaan B berjalan sesudah A commit, B sudah membaca stok CK
# yang tinggal 0 dan lolos apa adanya dengan kirim_ck = 0 — tak ada yang perlu
# ditolak. Yang harus berlaku di KEDUA jalinan adalah invariannya, dan itu yang
# diperiksa di atas: stok CK hanya boleh dijanjikan sekali. Menuntut kode 409
# akan membuat penjaga ini berkedip tanpa ada yang rusak.
cek "§179 penolakan (bila ada) terkendali: 409, bukan 4xx lain" "V == 0" \
  "$(printf '%s\n' "$KODE179" | awk '/^4/ && !/^409$/' | wc -l)"
# Sisi stok, dan inilah bentuk kerugiannya: TOTAL yang dijanjikan keluar dari CK
# oleh kedua permintaan. Dijumlah dari SEMUA faktur kirim yang lahir, bukan yang
# pertama saja — kalau cuma yang pertama diperiksa, angkanya tetap 30 walau yang
# kedua ikut menjanjikan 30 lagi, dan penjaganya hijau untuk alasan yang salah.
KFID179=$(for f in "$R179A" "$R179B"; do head -n-1 "$f"; printf '\n'; done | jq -rs '[.[]?|.kirim?.faktur_id//empty]|unique|join(",")' 2>/dev/null || echo "")
cek "§179 TOTAL dijanjikan keluar CK = 30, bukan 60 (stoknya cuma 30)" "abs(V - 30) < 0.001" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$KFID179" '($f|split(",")) as $ids | [.rows[]|select(.faktur_id as $x | $ids|index($x))]|map(.qty)|add // 0')"
# Arah balik: jalur BERURUTAN memang selalu benar — stok CK yang sudah
# dijanjikan sudah dipotong `qtyDalamJalan` sejak di perencanaan. Itulah sebabnya
# lubangnya cuma terbuka saat berbarengan, dan sebabnya ia lolos selama ini.
cek "§179 permintaan BERIKUTNYA melihat stok CK sudah habis dijanjikan (kirim_ck 0)" "abs(V) < 0.001" \
  "$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":20}],\"ck_branch_id\":\"$CK52_UTAMA\"}" | jq --arg i "$BASO66" '[.bahan[]|select(.ingredient_id==$i)][0].kirim_ck')"
rm -f "$R179A" "$R179B"


# ─────────────────────────────────────────────────────────────────────────────
# §180 DUA TOMBOL 🥡 BERBARENGAN: BIAYA KEMASAN MASUK SEKALI
#
# `/sajian` membaca `sajian_takeaway` yang LAMA, membandingkannya dengan yang
# diminta, lalu melaporkan "baris ini berpindah basis" ke `hitungUlangBiaya`.
# Perbandingan itu benar — tapi bacaannya tak dikunci. Dua penekanan pada baris
# yang sama di saat bersamaan sama-sama membaca `false` (READ COMMITTED tak
# memperlihatkan tulisan yang belum di-commit), keduanya menyimpulkan
# "berpindah", dan biaya kemasannya DITAMBAHKAN DUA KALI ke `total_hpp`.
#
# Yang TIDAK ikut rusak — dan sengaja tetap diperiksa di bawah supaya batas
# kerusakannya terdokumentasi, bukan diduga: stok kemasan bergerak dengan
# benar (turun 2, bukan 4). Jadi kerugiannya murni di pembukuan — HPP
# menggelembung dan laba dilaporkan lebih kecil dari kenyataan, sementara
# gudang tetap cocok, sehingga tak ada selisih fisik yang memancing curiga.
#
# Kunci pada UPDATE-nya tak menolong: transaksi kedua tetap memegang snapshot
# lamanya saat keputusan itu dibuat. Yang harus dikunci adalah BACAANNYA.
#
# Bukan kasus pinggir: tombol ini ada di papan pesanan dapur, layar yang paling
# sering disentuh dua orang sekaligus, dan §156 sudah menetapkan angkanya bulat
# (dus Rp 2.000/porsi) sehingga salahnya kelihatan.
echo "── §180 dua tombol 🥡 berbarengan ──"

tutup170
SH180=$(buka170 100000)
S180=$(api "$REISS105" POST /penjualan \
  "{\"meja_id\":\"$MEJA156\",\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M156\",\"qty\":2}]}")
SID180=$(echo "$S180" | jq -r '.sale.id // ""')
BR180=$(api "$OWNER" GET "/pesanan?branch_id=$CB156" | jq -r --arg id "$SID180" '[.[]|select(.id==$id)][0].items[0].id // ""')
cek "dasar §180: 2 porsi dine-in, total_hpp = 2 × 1.000 (kemasan belum terpakai)" "V == 2000" \
  "$(hpp156 "$SID180")"
cek "dasar §180: baris pesanannya terbaca" "V == 1" \
  "$([ ${#SID180} -eq 36 ] && [ ${#BR180} -eq 36 ] && echo 1 || echo 0)"

DUS180=$(dus156)
R180A=$(mktemp); R180B=$(mktemp)
for f in "$R180A" "$R180B"; do
  curl -s -X POST "$BASE/api/pesanan/penjualan/$SID180/item/$BR180/sajian" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d '{"takeaway":true}' -w '\n%{http_code}' > "$f" &
done
wait
cek "§180 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" \
  "$(for f in "$R180A" "$R180B"; do printf '%s\n' "$(tail -n1 "$f")"; done | grep -c '^5' || true)"

# INTI: 2000 + (2 porsi × Rp 2.000 kemasan) = 6000. Dulu 10000 — kemasannya
# dihitung untuk kedua penekanan, padahal dusnya cuma dipakai sekali.
cek "§180 total_hpp naik SEKALI: 6000, bukan 10000" "V == 6000" "$(hpp156 "$SID180")"
# Stok kemasan SUDAH benar bahkan sebelum perbaikan — diperiksa supaya batas
# kerusakannya tercatat: yang rusak pembukuannya, bukan gudangnya. Itu pula
# yang membuatnya sulit ketahuan; tak ada selisih fisik yang memancing curiga.
cek "§180 stok dus turun 2 pcs (sisi ini memang sudah benar)" "abs(V - 2) < 0.001" \
  "$(python3 -c "print($DUS180 - $(dus156))")"
# Dan hasil akhirnya memang tersimpan, bukan sekadar tak dihitung dua kali.
cek "§180 barisnya benar-benar bertanda bawa pulang" "V == 1" \
  "$(api "$OWNER" GET "/penjualan/$SID180" | jq --arg b "$BR180" '([.items[]|select(.id==$b)][0].sajianTakeaway==true)|if . then 1 else 0 end')"
rm -f "$R180A" "$R180B"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §181 SUNTING BILL SELAGI DIBAYAR: PESANANNYA TAK BOLEH HILANG SUNYI
#
# `PUT /open-bill/:id` menolak bill yang sudah tertutup — tapi penjaganya
# memakai `existing`, yang dibaca TANPA kunci dan di LUAR transaksi penulisnya.
# Di antara pemeriksaan dan penulisan ada `validateMenus`, `resolveMeja`, dan
# pemeriksaan baris-tak-boleh-dihapus: beberapa query terpisah, dan selama itu
# bill bisa dibayar perangkat lain. `UPDATE … WHERE id = :id` tak menyaring
# `closed_at`, jadi tulisannya benar-benar mendarat.
#
# Gejalanya persis yang paling sulit dilihat: barisnya sudah disalin ke
# `sale_items` saat dibayar, jadi tambahan yang menyusul tak pernah ditagih dan
# tak pernah muncul di kartu penjualan. Dan `loadDetail` di akhir handler
# memulangkan `null` untuk bill tertutup — jadi klien menerima **200 berisi
# null**, `onSuccess` mengosongkan keranjang, dan kasir melihat "tersimpan"
# untuk pesanan yang tak tersimpan di mana pun.
#
# Jalur ini yang paling mungkin dilewati: layar kasir bisa saja masih memegang
# bill yang baru dibayar perangkat lain.
echo "── §181 sunting bill selagi dibayar ──"

# MENGENAI JENDELANYA butuh dua hal, dan keduanya ditemukan lewat percobaan,
# bukan ditebak. Dikirim persis bersamaan, `PUT` SELALU menang (20/20 percobaan)
# — ia jauh lebih ringan daripada `createSale`, yang mengunci cabang, memuat
# katalog, dan menulis penjualan + baris + konsumsi. Dan bila `PUT` diberi jeda
# terlalu besar (≥ 50 ms), pembayarannya sudah selesai sebelum `PUT` membaca
# apa pun, sehingga penjaga lama menangkapnya dengan benar (409).
#
# Yang membukanya: `PUT` berisi BANYAK baris — validasi menu dan pemasangan
# baris jadi lebih lama, sehingga jarak antara "membaca existing" dan "menulis"
# melebar melewati saat pembayaran commit. Dengan 200 baris + jeda 30 ms,
# bug-nya muncul 8 dari 8 percobaan.
#
# Angka itu ditala di satu mesin, jadi seksi ini diulang beberapa RONDE: kalau
# satu ronde meleset dari jendelanya, ronde lain masih menggigit. Asersinya
# sendiri aman di semua jalinan — ia hanya bisa merah kalau bug-nya ada, tak
# pernah merah karena timing.
tutup170
SH181=$(buka170 100000)
cek "dasar §181: shift terbuka" "V == 1" "$([ ${#SH181} -eq 36 ] && echo 1 || echo 0)"
BESAR181=$(python3 -c "
import json,sys
print(json.dumps({'items':[{'menu_id':sys.argv[1],'qty':1} for _ in range(200)]}))" "$M170")

NULL2XX181=0; SEBAB_SALAH181=0; LIMA181=0; JUAL_GAGAL181=0
for _ in 1 2 3; do
  BILL181=$(api "$REISS105" POST /open-bill \
    "$(jq -nc --arg m "$M170" '{items:[{menu_id:$m, qty:1}]}')" | jq -r '.id // ""')
  [ ${#BILL181} -ne 36 ] && continue
  BAYAR181=$(mktemp); SUNTING181=$(mktemp)
  curl -s -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $REISS105" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg b "$BILL181" --arg m "$M170" --arg r "$(python3 -c 'import uuid;print(uuid.uuid4())')" \
        '{open_bill_id:$b, client_ref:$r, metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:1}]}')" \
    -w '\n%{http_code}' > "$BAYAR181" &
  ( sleep 0.03
    curl -s -X PUT "$BASE/api/open-bill/$BILL181" -H "Authorization: Bearer $REISS105" \
      -H 'Content-Type: application/json' -d "$BESAR181" -w '\n%{http_code}' > "$SUNTING181" ) &
  wait
  KODE181=$(printf '%s\n' "$(tail -n1 "$SUNTING181")")
  printf '%s\n' "$KODE181" | grep -q '^5' && LIMA181=$((LIMA181+1))
  # INTI: sesudah bill tertutup `loadDetail` memulangkan null, jadi 2xx berisi
  # `null` BERARTI tulisannya mendarat ke bill yang sudah dibayar — dan
  # pesanan tambahannya lenyap tanpa galat, sementara `onSuccess` di klien
  # mengosongkan keranjang. Kasir melihat "tersimpan"; yang tersimpan tak ada.
  if printf '%s\n' "$KODE181" | grep -q '^2'; then
    head -n-1 "$SUNTING181" | jq -e '.==null' > /dev/null 2>&1 && NULL2XX181=$((NULL2XX181+1))
  elif [ "$KODE181" = "409" ]; then
    # Kalau kalah, sebabnya harus yang SUDAH dikenal klien — sebab baru terbaca
    # asing dan tak menahan pengosongan keranjang.
    head -n-1 "$SUNTING181" | jq -e '.kode=="bill_sudah_ditutup"' > /dev/null 2>&1 \
      || SEBAB_SALAH181=$((SEBAB_SALAH181+1))
  else
    SEBAB_SALAH181=$((SEBAB_SALAH181+1))
  fi
  head -n-1 "$BAYAR181" | jq -e '.sale.id != null' > /dev/null 2>&1 || JUAL_GAGAL181=$((JUAL_GAGAL181+1))
  rm -f "$BAYAR181" "$SUNTING181"
done

cek "§181 tak ada yang 5xx (penolakannya terkendali, bukan tabrakan)" "V == 0" "$LIMA181"
cek "§181 penyuntingan TIDAK pernah dibalas 2xx-berisi-null (kehilangan sunyi)" "V == 0" \
  "$NULL2XX181"
cek "§181 penolakannya selalu bersebab bill_sudah_ditutup (dikenal klien)" "V == 0" \
  "$SEBAB_SALAH181"
cek "§181 pembayarannya selalu tetap menerbitkan penjualan" "V == 0" "$JUAL_GAGAL181"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §182 OPNAME DI CK: "SIAP KIRIM" vs "DI JALAN"
#
# `status = 'menunggu'` dipakai untuk TIGA keadaan yang berbeda:
#
#   - jalur produksi  : "selesai diproduksi"  → barangnya DI RAK cabang ini;
#   - jalur kirim CK  : "siap dikirim"        → barangnya DI RAK cabang ini;
#   - sesudah dikirim : "dalam perjalanan"    → barangnya SUDAH TIDAK di rak.
#
# `hitungSaldoCabang` sengaja masih memuat ketiganya — pengurangannya baru saat
# `dikonfirmasi`. Itu benar untuk perencanaan dan supaya barang tak "hilang"
# dari pembukuan selagi di jalan. Tapi opname membandingkan buku dengan APA YANG
# ADA DI RAK, dan yang sudah dimuat ke kendaraan tak bisa dihitung petugas.
#
# Seksi ini menjaga KEDUA sisinya, sebab memotong yang salah justru merusak:
# memotong seluruh `qtyDalamJalan` (termasuk "siap kirim") membuat baseline
# mengecualikan barang yang sebenarnya ada, lalu penerimaannya menguranginya
# sekali lagi — saldo CK jatuh ke MINUS. Versi pertama perbaikan ini melakukan
# persis itu dan tertangkap di −10; karena itu kasus (a) di bawah ada.
echo "── §182 opname CK: siap kirim vs di jalan ──"

# Bersihkan sisa kiriman tertunda §179 supaya CK berangkat dari keadaan yang
# diketahui — kalau tidak, "yang di jalan" bercampur antara dua seksi.
if [ ${#KFID179} -eq 36 ]; then
  api "$OWNER" POST "/produksi/kirim/$KFID179" '{}' > /dev/null 2>&1 || true
  api "$OWNER" POST "/penerimaan/$KFID179/terima" > /dev/null 2>&1 || true
fi
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":50},{\"ingredient_id\":\"$DAG66\",\"qty\":20000},{\"ingredient_id\":\"$TEP66\",\"qty\":5000}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":0}]}" > /dev/null
cek "dasar §182: CK berstok 50" "abs(V - 50) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"

# Faktur kirim 30 lahir ber-status 'menunggu' — tapi BELUM dikirim: barangnya
# masih di rak CK, dan `POST /produksi/kirim` belum dipanggil.
H182=$(api "$OWNER" POST /rekomendasi/menu/faktur \
  "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":6}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
KF182=$(echo "$H182" | jq -r '.kirim.faktur_id // ""')
cek "dasar §182: faktur kirim 30 terbit (siap kirim, belum berangkat)" "V == 1" \
  "$([ ${#KF182} -eq 36 ] && echo 1 || echo 0)"

# (a) SIAP KIRIM — barangnya MASIH DI RAK. Petugas menghitung 50, dan itu benar.
#     Inilah kasus yang rusak bila potongannya memakai `qtyDalamJalan`.
OP182A=$(api "$OWNER" POST /stok/opname \
  "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":50}]}")
cek "§182a siap-kirim masih dihitung ada: hitung 50 → selisih 0" "abs(V) < 0.001" \
  "$(echo "$OP182A" | jq '.ringkasan.total_selisih')"

# (b) DI JALAN — sekarang benar-benar dikirim. Barangnya tak lagi di rak, jadi
#     hitungan fisik yang BENAR tinggal 20.
api "$OWNER" POST "/produksi/kirim/$KF182" '{}' > /dev/null
cek "dasar §182: saldo CK tetap 50 (kiriman belum diterima — memang begitu)" "abs(V - 50) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"
OP182B=$(api "$OWNER" POST /stok/opname \
  "{\"branch_id\":\"$CK52_UTAMA\",\"items\":[{\"ingredient_id\":\"$BASO66\",\"qty\":20}]}")
# INTI: dulu −30. Petugas benar, sistem menuduh barangnya hilang.
cek "§182b yang sudah berangkat tak dihitung ada: hitung 20 → selisih 0 (dulu −30)" "abs(V) < 0.001" \
  "$(echo "$OP182B" | jq '.ringkasan.total_selisih')"
cek "§182b barisnya tercatat COCOK, bukan kurang" "V == 1" \
  "$(echo "$OP182B" | jq '(.ringkasan.cocok==1 and .ringkasan.kurang==0) | if . then 1 else 0 end')"

# (c) Sesudah diterima: tak ada pengurangan KEDUA. `kirim_keluar` menyaring
#     `pr.waktu > baseline`, dan `waktu` tetap waktu baris dibuat.
api "$OWNER" POST "/penerimaan/$KF182/terima" > /dev/null
cek "§182c sesudah diterima: cabang +30" "abs(V - 30) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"
cek "§182c sesudah diterima: CK tetap 20, tidak MINUS" "abs(V - 20) < 0.001" \
  "$(api "$OWNER" GET "/stok?branch_id=$CK52_UTAMA" | jq --arg i "$BASO66" '[.[]|select(.ingredient_id==$i)][0].saldo')"


# ─────────────────────────────────────────────────────────────────────────────
# §183 REFUND DIBUKUKAN AKRUAL, DAN LAPORANNYA MENJELASKANNYA
#
# `sales.subtotal` DISUSUTKAN tiap refund, jadi laporan periode transaksi
# aslinya memang ikut mengecil — itu pembukuan akrual, dan itu yang dipilih.
# Yang hilang selama ini keterangannya: tak ada satu pun baris yang menyebut
# kenapa omzet periode lampau tidak lagi sama dengan yang diingat orang. Tak
# ada yang salah di layar; angkanya saja yang berubah diam-diam.
#
# Baris "Refund" menutup itu — dan ia PENJELAS, bukan potongan kedua:
# omzet sudah bersih, jadi omzet kotornya = omzet + refund.
echo "── §183 refund akrual & baris penjelasnya ──"

tutup170
SH183=$(buka170 100000)
LAP183_0=$(api "$OWNER" GET /laporan)
REF183_0=$(echo "$LAP183_0" | jq -r '.total_refund // 0')
CNT183_0=$(echo "$LAP183_0" | jq -r '.jumlah_refund // 0')
cek "dasar §183: laporan memuat baris refund (bukan field yang hilang)" "V == 1" \
  "$(echo "$LAP183_0" | jq '((.total_refund|type)=="number" and (.jumlah_refund|type)=="number") | if . then 1 else 0 end')"

S183=$(api "$REISS105" POST /penjualan \
  "$(jq -nc --arg m "$M170" '{metode_bayar:"tunai", is_dine_in:false, items:[{menu_id:$m, qty:2}]}')")
SID183=$(echo "$S183" | jq -r '.sale.id // ""')
IT183=$(api "$OWNER" GET "/penjualan/$SID183" | jq -r '.items[0].id // ""')
OMZ183_1=$(api "$OWNER" GET /laporan | jq -r '.omzet')
cek "dasar §183: penjualan qty 2 tercatat & barisnya terbaca" "V == 1" \
  "$([ ${#SID183} -eq 36 ] && [ ${#IT183} -eq 36 ] && echo 1 || echo 0)"

N183=$(api "$OWNER" POST "/penjualan/$SID183/refund" \
  "$(jq -nc --arg it "$IT183" '{alasan:"uji §183", items:[{sale_item_id:$it, qty:1}]}')" | jq -r '.nominal // 0')
cek "dasar §183: refund satu porsi berhasil" "V > 0" "$N183"

LAP183_2=$(api "$OWNER" GET /laporan)
# INTI: refundnya MUNCUL, dan besarnya persis yang dikembalikan.
cek "§183 baris refund bertambah persis sebesar uang yang dikembalikan" "abs(V) < 1" \
  "$(python3 -c "print(($(echo "$LAP183_2" | jq -r '.total_refund // 0')) - $REF183_0 - $N183)")"
cek "§183 cacah kejadian refund bertambah satu" "V == 1" \
  "$(python3 -c "print(int($(echo "$LAP183_2" | jq -r '.jumlah_refund // 0') - $CNT183_0))")"
# Dan ia PENJELAS, bukan potongan kedua: omzet sudah bersih, jadi
# omzet_sesudah + refund = omzet_sebelum.
cek "§183 omzet sudah bersih — omzet + refund = omzet sebelum refund" "abs(V) < 1" \
  "$(python3 -c "print(($(echo "$LAP183_2" | jq -r '.omzet // 0')) + $N183 - $OMZ183_1)")"
tutup170


# ─────────────────────────────────────────────────────────────────────────────
# §184 RESEP TAK BOLEH BERUBAH SELAGI PRODUKSINYA BERJALAN
#
# `catatKonsumsiProduksi` membaca resep LIVE saat produksi selesai, bukan
# snapshot saat fakturnya dibuat. `PUT /bahan/:id` sudah menolak perubahan
# `isi` selagi ada produksi berjalan justru karena itu — tapi resepnya sendiri
# masih bisa ditulis ulang lewat `PUT /bahan/:id/resep`, dan akibatnya sama
# persis: faktur yang RAB-nya dihitung dengan satu resep dieksekusi dengan
# resep yang lain. Bahan yang dikeluarkan berhenti dipotong sama sekali; yang
# ditambahkan dipotong tanpa pernah masuk perhitungan biaya.
#
# Pintu yang sama, sisi yang lain — dan sisi ini yang belum berpalang.
echo "── §184 resep terkunci selagi produksi berjalan ──"

RESEP184='{"komponen":[{"ingredient_id":"'"$DAG66"'","qty":2000},{"ingredient_id":"'"$TEP66"'","qty":300}]}'

# Bahan produksi BARU yang tak pernah punya faktur: penjaganya tak boleh jadi
# palang permanen. Sengaja bukan $BASO66 — bahan itu dipakai banyak seksi lain
# dan hampir selalu punya faktur berjalan pada titik ini, jadi memakainya
# sebagai garis dasar akan menguji keadaan, bukan penjaganya.
BR184=$(api "$OWNER" POST /bahan '{"nama":"Bakso Uji184","satuan":"butir","satuan_beli":"batch","isi":100,"harga_beli":0,"pengadaan":"produksi","kategori":"lain"}' | jq -r '.id // ""')
cek "dasar §184: bahan produksi baru dibuat" "V == 1" \
  "$([ ${#BR184} -eq 36 ] && echo 1 || echo 0)"
cek "§184 tanpa produksi berjalan, resep TETAP boleh disimpan (bukan palang permanen)" "V == 200" \
  "$(status_code_body "$OWNER" PUT "/bahan/$BR184/resep" "$RESEP184")"

# $BASO66 memang punya produksi berjalan dari seksi-seksi sebelumnya — itu
# justru keadaan yang diuji di sini.
cek "dasar §184: BASO66 memang punya produksi berjalan" "V == 409" \
  "$(status_code_body "$OWNER" PUT "/bahan/$BASO66" '{"isi":250}')"
# INTI: dulu 200 — resepnya tertulis ulang dan konsumsi faktur berjalan ikut
# berubah, tanpa satu pun baris yang menerangkannya.
cek "§184 resep DITOLAK selagi produksi berjalan (dulu diterima diam-diam)" "V == 409" \
  "$(status_code_body "$OWNER" PUT "/bahan/$BASO66/resep" "$RESEP184")"


# ── §188 enam penjualan yang berpapasan di SATU cabang ──
#
# Nomor struk dibuat dengan MEMBACA nomor terbesar hari itu lalu menambah satu:
#
#   SELECT nomor … ORDER BY nomor DESC LIMIT 1   →   seq = …+1   →   INSERT
#
# Pola baca-lalu-tulis itu biasanya bocor. Di sini TIDAK, dan yang menahannya
# satu baris di awal `createSale`: baris cabangnya dikunci `FOR UPDATE`, jadi
# seluruh penjualan di satu cabang antre. Kuncinya sengaja diambil paling awal —
# sebelum apa pun dibaca — supaya tak ada celah antara membaca dan menulis.
#
# Yang membuatnya layak diuji: kalau kunci itu suatu hari dilonggarkan demi
# throughput (godaan yang masuk akal — ia menyerialkan SELURUH penjualan cabang),
# akibatnya bukan nomor kembar melainkan `sales_branch_nomor_uq` yang menolak,
# alias 500 mentah ke tangan kasir yang sedang berdiri di depan pelanggan.
# Nota yang hilang itu tak meninggalkan jejak apa pun untuk dilacak.
#
# Ini juga jalur tulis yang PALING sering dieksekusi di seluruh produk, dan
# sampai seksi ini tak satu pun asersi pernah menjalankannya dua kali sekaligus.
# Token: §105 mengganti password kasir, jadi `$KASIR` sudah MATI di titik ini
# (token_version naik → 401). Penggantinya `$REISS105`, hasil login ulang di
# §105 — dijaga `verify-api-token.test.ts`, yang menangkap seksi ini saat
# pertama ditulis.
AKTIF188=$(api "$REISS105" GET /shift/aktif | jq -r '.id // "null"')
if [ "$AKTIF188" = "null" ]; then
  # Mandiri: seksi ini duduk di ekor skrip, jadi ia tak boleh mengandaikan
  # keadaan yang ditinggalkan ribuan baris di atasnya.
  # `/absensi/saya` itu TOGGLE, bukan "pastikan masuk": ia mencatat kebalikan
  # dari cap terakhir hari itu. Kasir sudah absen masuk jauh di atas (§2), jadi
  # memanggilnya di sini justru MEMULANGKANNYA — lalu `/shift/buka` ditolak
  # dengan "absen masuk dulu", dan seksi ini gagal di penjaga pertamanya.
  #
  # Itu bukan dugaan: pada jalan yang gagal, cap terakhir kasir adalah `keluar`
  # dengan stempel waktu tepat di detik seksi ini berjalan.
  #
  # Karena itu hasilnya DIPERIKSA, bukan diasumsikan: bila yang tercatat
  # `keluar`, dibalik sekali lagi supaya berakhir pada `masuk`. Cara ini benar
  # dari keadaan awal mana pun — sudah masuk, sudah pulang, atau belum absen
  # sama sekali.
  TIPE188=$(api "$REISS105" POST /absensi/saya \
    '{"foto_url":"https://example.com/absen188.jpg"}' | jq -r '.tipe // ""')
  if [ "$TIPE188" = "keluar" ]; then
    api "$REISS105" POST /absensi/saya \
      '{"foto_url":"https://example.com/absen188.jpg"}' >/dev/null 2>&1
  fi
  api "$REISS105" POST /shift/buka '{"modal_awal":100000}' >/dev/null 2>&1
  AKTIF188=$(api "$REISS105" GET /shift/aktif | jq -r '.id // "null"')
fi
# Diperiksa sebagai UUID, bukan sekadar "bukan kata null": balasan KOSONG (server
# mati, jaringan putus) membuat `jq` memulangkan string kosong, dan `!= "null"`
# menganggapnya sah. Penjaga yang hijau tanpa server tidak menjaga apa pun.
cek "dasar §188: kasir punya kasir terbuka" "V == 1" \
  "$(printf '%s' "$AKTIF188" | grep -cE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')"
T188=$(mktemp -d)
for i in 1 2 3 4 5 6; do
  curl -s -X POST "$BASE/api/penjualan" \
    -H "Authorization: Bearer $REISS105" -H 'Content-Type: application/json' \
    -o "$T188/b$i" -w "%{http_code}\n" \
    -d "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" > "$T188/k$i" &
done
wait
LOLOS188=$(cat "$T188"/k* | grep -c '^201$')
# Tanpa ini seluruh seksi bisa hijau karena keenamnya sama-sama GAGAL (mis. stok
# habis) — nol nota tak punya nomor kembar, dan itu bukan bukti apa pun.
cek "dasar §188: penjualannya memang berjalan" "V >= 2" "$LOLOS188"
# INTI: tiap nota yang lahir bernomor sendiri. Satu nomor untuk dua nota mustahil
# (indeks uniknya menolak), jadi kebocoran kunci muncul sebagai nota yang HILANG.
cek "§188 tiap nota yang lahir bernomor unik" "V == $LOLOS188" \
  "$(for i in 1 2 3 4 5 6; do jq -r '.sale.nomor // empty' "$T188/b$i" 2>/dev/null; done | sort -u | wc -l)"
# Sisi lain dari kerusakan yang sama: tabrakan `sales_branch_nomor_uq` keluar
# sebagai 500, bukan galat yang bisa dimengerti kasir.
cek "§188 tak ada yang gagal keras (5xx)" "V == 0" \
  "$(cat "$T188"/k* | grep -c '^5')"
rm -rf "$T188"


echo "== 189. Target waktu penyajian per menu =="
# Laporan durasi sebelumnya cuma bisa berkata "rata-rata 7 menit". Angka itu tak
# bisa ditindaklanjuti: ia menjawab "berapa lama", bukan "apakah itu terlalu
# lama". Yang menjawabnya cuma target — dan target hanya masuk akal per MENU;
# kopi dan iga bakar tak punya kesamaan apa pun soal ini.
M189=$(api "$OWNER" GET /menu | jq -r '[.[]|select(.nama=="Menu Uji154")][0].id')
N189=$(api "$OWNER" GET /menu | jq -r '[.[]|select(.nama=="Minum Uji154")][0].id')
cek "dasar §189: menu §154 ketemu" "V == 1" \
  "$(printf '%s' "$M189" | grep -Eqc '^[0-9a-f-]{36}$' && echo 1 || echo 0)"
cek "menu baru default TANPA target" "V == 1" \
  "$(api "$OWNER" GET /menu | jq --arg i "$M189" '[.[]|select(.id==$i)][0].target_durasi_detik==null|if . then 1 else 0 end')"
cek "set target 300 detik → tersimpan" "V == 300" \
  "$(api "$OWNER" PUT "/menu/$M189" '{"target_durasi_detik":300}' | jq -r '.target_durasi_detik')"
# Batas atas 24 jam & minimum 1 detik: target yang lebih panjang dari sehari
# pasti salah satuan, dan salah satuan menghasilkan laporan yang selamanya
# berkata "aman".
cek "target 0 ditolak" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$M189" '{"target_durasi_detik":0}')"
cek "target 90000 (>24 jam) ditolak" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$M189" '{"target_durasi_detik":90000}')"
# PUT di repo ini PARSIAL. Target yang hilang karena klien lain menyimpan harga
# adalah kegagalan sunyi: laporannya cuma berhenti menilai, tanpa berubah rupa.
api "$OWNER" PUT "/menu/$M189" '{"harga_jual":12000}' > /dev/null
cek "PUT parsial tak menghapus target" "V == 300" \
  "$(api "$OWNER" GET /menu | jq -r --arg i "$M189" '[.[]|select(.id==$i)][0].target_durasi_detik')"
LAP189=$(api "$OWNER" GET "/laporan/durasi-pesanan?dari=2020-01-01&sampai=2030-01-01")
cek "laporan membawa target menu yang ditetapkan" "V == 1" \
  "$(echo "$LAP189" | jq '[.per_menu[]|select(.menu_nama=="Menu Uji154" and .target_detik==300)]|length')"
cek "menu tanpa target dilaporkan null, bukan 0" "V == 1" \
  "$(echo "$LAP189" | jq '[.per_menu[]|select(.target_detik==null)]|all(.lewat_target==false and .lewat_jumlah==0)|if . then 1 else 0 end')"
cek "ringkasan: bertarget terhitung" "V == 1" \
  "$(echo "$LAP189" | jq '(.bertarget>=1) and (.bertarget==([.per_menu[]|select(.target_detik!=null)]|length))|if . then 1 else 0 end')"
# Sajian yang selesai seketika (uji ini) jauh di bawah 300 detik → tak boleh
# ditandai lewat. Bendera yang menyala untuk yang memenuhi targetnya akan
# dimatikan orang, lalu tak menjaga apa pun saat benar.
cek "menu cepat TIDAK ditandai lewat target" "V == 1" \
  "$(echo "$LAP189" | jq '[.per_menu[]|select(.menu_nama=="Menu Uji154")][0].lewat_target==false|if . then 1 else 0 end')"
# Target dicari lewat menu_id, bukan dicocokkan dari NAMA: laporan mengelompok
# per nama snapshot, dan menu yang pernah diganti namanya tak akan pernah cocok
# bila dicari dari nama itu — targetnya diam-diam terbaca null.
api "$OWNER" PUT "/menu/$M189" '{"nama":"Menu Uji154 Ganti"}' > /dev/null
cek "target bertahan sesudah menu diganti nama" "V == 1" \
  "$(api "$OWNER" GET "/laporan/durasi-pesanan?dari=2020-01-01&sampai=2030-01-01" | jq '[.per_menu[]|select(.menu_nama=="Menu Uji154" and .target_detik==300)]|length')"
api "$OWNER" PUT "/menu/$M189" '{"nama":"Menu Uji154"}' > /dev/null
cek "hapus target (null) → menu tak dinilai lagi" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$N189" '{"target_durasi_detik":null}' | jq '.target_durasi_detik==null|if . then 1 else 0 end')"

echo "== 190. /tahap: kiriman ulang tak boleh memajukan dua kali =="
# `/tahap` TAK BISA idempoten dari isinya sendiri. Cabang SPLIT cuma MENGURANGI
# qty baris induk tanpa menyentuh statusnya, jadi CAS `(id,status,qty)` yang
# menjaga jalur "maju penuh" tak menjaga apa pun: kiriman kedua membaca qty yang
# sudah berkurang, cocok lagi, lalu memotong lagi. Barang yang tak pernah datang
# tercatat datang — dan Σqty faktur tetap utuh, jadi tak ada angka yang terlihat
# janggal.
ING190=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.pengadaan=="beli" and .track_stok==true)][0].id')
S190_0=$(saldo_bahan "$ING190")
FK190=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$ING190\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}")
FK190_ID=$(echo "$FK190" | jq -r .faktur_id)
R190=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK190_ID" '[.rows[]|select(.faktur_id==$f)][0].id')
cek "dasar §190: baris fakturnya ketemu, qty 8" "abs(V - 8) < 0.001" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$FK190_ID" '[.rows[]|select(.faktur_id==$f)][0].qty')"
REF190="9e1b7c40-3a2d-4f18-9c55-7d20a4e61b33"
BODY190="{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$R190\",\"qty\":3}],\"client_ref\":\"$REF190\"}"
api "$OWNER" POST "/pembelian/tahap/$FK190_ID" "$BODY190" > /dev/null
S190_1=$(saldo_bahan "$ING190")
cek "terima 3 dari 8 → saldo +3" "abs(V - 3) < 0.001" "$(echo "$S190_1 - $S190_0" | bc -l)"
# KIRIMAN ULANG PERSIS SAMA. Inilah yang dulu memotong lagi.
api "$OWNER" POST "/pembelian/tahap/$FK190_ID" "$BODY190" > /dev/null
cek "kiriman ULANG tak menambah stok lagi" "abs(V - 3) < 0.001" \
  "$(echo "$(saldo_bahan "$ING190") - $S190_0" | bc -l)"
B190=$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK190_ID" '[.rows[]|select(.faktur_id==$f)]')
cek "kiriman ULANG tak melahirkan baris ketiga" "V == 2" "$(echo "$B190" | jq 'length')"
# Sisa tugas belanja adalah korban KEDUA bug ini, dan yang paling sunyi: yang
# masih harus dibeli tercatat lebih sedikit daripada yang sebenarnya.
cek "sisa tugas belanja tetap 5, bukan menyusut jadi 2" "abs(V - 5) < 0.001" \
  "$(echo "$B190" | jq '[.[]|select(.status=="rencana")][0].qty // 0')"
cek "Σqty faktur tetap 8" "abs(V - 8) < 0.001" "$(echo "$B190" | jq '[.[].qty]|add')"
# `client_ref` BARU = permintaan baru yang sah → boleh dieksekusi sungguhan.
# Tanpa ini idempotensinya terlalu ketat: maju bertahap jadi mustahil.
BODY190B="{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$(echo "$B190" | jq -r '[.[]|select(.status=="rencana")][0].id')\",\"qty\":2}],\"client_ref\":\"3c9f5a11-88b2-4d67-b0e4-2f6a1c9d7e50\"}"
api "$OWNER" POST "/pembelian/tahap/$FK190_ID" "$BODY190B" > /dev/null
cek "client_ref BARU tetap dieksekusi → saldo +2 lagi" "abs(V - 5) < 0.001" \
  "$(echo "$(saldo_bahan "$ING190") - $S190_0" | bc -l)"


echo "== 191. Kasir tak bisa menulis ke cabang lain lewat branch_id =="
# Penjaganya SATU aturan — "peran terikat cabang hanya boleh menulis di
# cabangnya" — tapi ditulis ulang di tujuh handler. Seksi ini memakunya dari
# LUAR: apa pun bentuk kodenya di dalam, jawabannya harus 403 di tiap pintu.
#
# Dua di antaranya (penjualan, open-bill) memakai `body.branch_id ?? …` tanpa
# `pastikanCabang`, jadi aman HANYA karena gerbang perannya menuntut kasir —
# dan kasir selalu terikat cabang. Aman yang bergantung pada gerbang di berkas
# LAIN adalah aman yang bisa hilang tanpa ada yang menyadarinya.
#
# Login SENDIRI, tak menumpang $KASIR: token itu sudah mati di §97 (reset
# password), dan asersi yang gagal karena 401 tak menguji penjaga cabang sama
# sekali — ia cuma tampak merah di tempat yang salah.
K191=$(login "kasir46@basooopa.id" "Kasir46Pass!")
MENU191=$(api "$OWNER" GET /menu | jq -r '[.[]|select(.tipe=="regular" and .is_active)][0].id')
# Cabang ASING = store mana pun yang BUKAN cabangnya kasir46.
ASING191=$(api "$OWNER" GET /cabang | jq -r --arg x "$CB46_ID" '[.[]|select(.id!=$x and .tipe=="store" and .is_active)][0].id')
cek "dasar §191: kasir46 login, menu & cabang asing ada" "V == 1" \
  "$(printf '%s' "$K191$MENU191$ASING191" | grep -Eq '^.{100,}$' && echo 1 || echo 0)"
cek "dasar §191: cabang asing memang BUKAN cabang kasir46" "V == 1" \
  "$([ "$ASING191" != "$CB46_ID" ] && echo 1 || echo 0)"

# Tiap pintu diuji BERPASANGAN: cabang asing ditolak, cabang sendiri tidak.
# Tanpa pasangannya, penjaga yang menolak SEMUA permintaan juga hijau — dan
# pintu yang terkunci untuk semua orang bukan penjaga.
cek "kasir → POST /penjualan cabang lain = 403" "V == 403" \
  "$(status_code_body "$K191" POST /penjualan "{\"branch_id\":\"$ASING191\",\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$MENU191\",\"qty\":1}]}")"
cek "kasir → POST /open-bill cabang lain = 403" "V == 403" \
  "$(status_code_body "$K191" POST /open-bill "{\"branch_id\":\"$ASING191\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$MENU191\",\"qty\":1}]}")"
cek "kasir → POST /open-bill cabang SENDIRI bukan 403" "V == 0" \
  "$([ "$(status_code_body "$K191" POST /open-bill "{\"branch_id\":\"$CB46_ID\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$MENU191\",\"qty\":1}]}")" = "403" ] && echo 1 || echo 0)"
cek "kasir → POST /meja cabang lain = 403" "V == 403" \
  "$(status_code_body "$K191" POST /meja "{\"branch_id\":\"$ASING191\",\"nama\":\"M191\"}")"
cek "kasir → POST /meja cabang SENDIRI tetap boleh" "V == 1" \
  "$(api "$K191" POST /meja "{\"branch_id\":\"$CB46_ID\",\"nama\":\"M191-OK\"}" | jq '(.id != null)|if . then 1 else 0 end')"
cek "kasir → POST /penyimpanan cabang lain = 403" "V == 403" \
  "$(status_code_body "$K191" POST /penyimpanan "{\"branch_id\":\"$ASING191\",\"nama\":\"Rak 191\"}")"
cek "kasir → POST /penyimpanan cabang SENDIRI tetap boleh" "V == 1" \
  "$(api "$K191" POST /penyimpanan "{\"branch_id\":\"$CB46_ID\",\"nama\":\"Rak 191 OK\"}" | jq '(.id != null)|if . then 1 else 0 end')"

# /stok/waste & /stok/opname SENGAJA tidak ikut: keduanya punya gerbang lain
# (petugas rak, sesi opname) yang juga membalas 403, jadi hijaunya belum tentu
# berasal dari penjaga cabang — dan asersi yang hijau karena sebab lain lebih
# buruk daripada tak ada asersi.

echo "== 192. Paket berlapis: menu dasar tak boleh diubah jadi paket =="
# Perhitungan paket SATU TINGKAT — `komponenEfektif` memulangkan komponen
# sendiri + komponen dasarnya, berhenti di situ. "Menu dasar harus reguler"
# dijaga pada menu yang SEDANG disunting, tapi dulu TIDAK pada menu-menu yang
# menunjuk ke sana, jadi rantai dua tingkat bisa dibuat dari arah sebaliknya.
#
# Terukur sebelum perbaikan: paket P → A → B membuat HPP P tercatat 6.250
# padahal dasarnya sudah 10.139, dan menjual P sama sekali TIDAK mengonsumsi
# bahan resep B. Dua-duanya sunyi.
KAT192=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
BHN192=$(api "$OWNER" GET /bahan | jq -r '[.[]|select(.track_stok==true)][0].id')
B192=$(api "$OWNER" POST /menu "{\"nama\":\"Uji192 Dasar\",\"category_id\":\"$KAT192\",\"harga_jual\":10000,\"mult\":2,\"komponen\":[{\"ingredient_id\":\"$BHN192\",\"qty\":5}]}" | jq -r .id)
A192=$(api "$OWNER" POST /menu "{\"nama\":\"Uji192 Tengah\",\"category_id\":\"$KAT192\",\"harga_jual\":20000,\"mult\":2,\"komponen\":[]}" | jq -r .id)
P192=$(api "$OWNER" POST /menu "{\"nama\":\"Uji192 Paket\",\"category_id\":\"$KAT192\",\"harga_jual\":30000,\"tipe\":\"paket\",\"base_menu_id\":\"$A192\",\"base_mult\":2,\"komponen\":[]}" | jq -r .id)
cek "dasar §192: paket P dibuat di atas menu reguler A" "V == 1" \
  "$(api "$OWNER" GET /menu | jq --arg i "$P192" --arg a "$A192" '[.[]|select(.id==$i and .tipe=="paket" and .base_menu_id==$a)]|length')"
# INTI: A adalah dasar sebuah paket, jadi A sendiri tak boleh jadi paket.
cek "menu dasar sebuah paket → ditolak jadi paket (400)" "V == 400" \
  "$(status_code_body "$OWNER" PUT "/menu/$A192" "{\"tipe\":\"paket\",\"base_menu_id\":\"$B192\",\"base_mult\":2}")"
cek "A tetap reguler sesudah ditolak" "V == 1" \
  "$(api "$OWNER" GET /menu | jq --arg i "$A192" '[.[]|select(.id==$i and .tipe=="regular")]|length')"
# Sisi sebaliknya: penjaga yang menolak SEMUA perubahan bukan penjaga. Menu
# yang BUKAN dasar paket mana pun tetap boleh dijadikan paket.
C192=$(api "$OWNER" POST /menu "{\"nama\":\"Uji192 Bebas\",\"category_id\":\"$KAT192\",\"harga_jual\":9000,\"mult\":2,\"komponen\":[]}" | jq -r .id)
cek "menu biasa TETAP boleh dijadikan paket" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$C192" "{\"tipe\":\"paket\",\"base_menu_id\":\"$B192\",\"base_mult\":2}" | jq '(.tipe=="paket")|if . then 1 else 0 end')"
# Dan menu dasar tetap boleh disunting untuk hal LAIN — yang ditolak cuma
# perubahan yang melanggar batas satu tingkat.
cek "menu dasar tetap boleh ganti harga" "V == 1" \
  "$(api "$OWNER" PUT "/menu/$A192" '{"harga_jual":21000}' | jq '(.harga_jual==21000)|if . then 1 else 0 end')"

echo "== 193. Daftar stok membawa satuannya =="
# Empat kolom angka di daftar stok (Stok Awal, Masuk, Terpakai, Saldo) tak
# pernah menyebut satuannya, dan yang membacanya melihat "−54" tanpa cara tahu
# itu 54 apa. Dilaporkan langsung pemakainya: "bingung ini satuannya apa,
# padahal ketika beli ada satuannya" — dan kalimat terakhir itu intinya:
# belanja memakai KEMASAN (dus/kg), saldo memakai SATUAN KERJA (pcs/gr).
STK193=$(api "$OWNER" GET /stok)
cek "dasar §193: daftar stok tidak kosong" "V >= 5" "$(echo "$STK193" | jq 'length')"
cek "tiap baris membawa satuan yang terisi" "V == 1" \
  "$(echo "$STK193" | jq '[.[]|select((.satuan|type)!="string" or (.satuan|length)==0)]|length==0|if . then 1 else 0 end')"
# `satuan_beli` boleh null (bahan yang dibeli langsung dalam satuan kerjanya),
# tapi KUNCINYA wajib ada — tanpa itu halaman tak punya cara tahu bahan ini
# dibeli per dus, dan padanan kemasannya diam-diam tak pernah muncul.
cek "tiap baris membawa kunci satuan_beli (boleh null)" "V == 1" \
  "$(echo "$STK193" | jq '[.[]|select(has("satuan_beli")|not)]|length==0|if . then 1 else 0 end')"
# Diuji dengan MENYETELNYA lewat API, bukan mengandalkan data seed kebetulan.
B193=$(api "$OWNER" GET /bahan | jq -r '[.[]|select(.track_stok==true and .isi>1)][0].id')
cek "dasar §193: ada bahan berkemasan untuk diuji" "V == 1" \
  "$(printf '%s' "$B193" | grep -Eqc '^[0-9a-f-]{36}$' && echo 1 || echo 0)"
api "$OWNER" PUT "/bahan/$B193" '{"satuan_beli":"dus"}' > /dev/null
cek "satuan_beli yang disetel muncul di daftar stok" "V == 1" \
  "$(api "$OWNER" GET /stok | jq --arg i "$B193" '[.[]|select(.ingredient_id==$i and .satuan_beli=="dus")]|length')"


echo "== 194. Daftar stok membawa harga per SATUAN KERJA =="
# Halaman Stok kini meringkas nilai rupiah stok (Σ saldo × harga). Ringkasan
# itu hanya sebenar harga yang dikirim server, dan di sinilah letak jebakannya:
# `harga_beli` disimpan per KEMASAN (Rp 120.000 per dus) sedangkan `saldo`
# disimpan per SATUAN KERJA (pcs/gram). Mengirim `harga_beli` apa adanya
# membuat SETIAP baris di layar meleset sebesar `isi` — 1000× untuk bahan
# gram/kg — dan hasilnya tetap berupa angka rupiah yang tampak masuk akal.
B194=$(api "$OWNER" GET /bahan | jq -r '[.[]|select(.track_stok==true and .isi>1)][0].id')
cek "dasar §194: ada bahan berkemasan (isi>1) untuk diuji" "V == 1" \
  "$(printf '%s' "$B194" | grep -Eqc '^[0-9a-f-]{36}$' && echo 1 || echo 0)"
ISI194=$(api "$OWNER" GET /bahan | jq --arg i "$B194" '[.[]|select(.id==$i)][0].isi')
HB194_ASAL=$(api "$OWNER" GET /bahan | jq --arg i "$B194" '[.[]|select(.id==$i)][0].harga_beli')
cek "dasar §194: isi bahan uji memang > 1" "V > 1" "$ISI194"

# Kuncinya WAJIB ada di tiap baris. Kunci yang hilang membuat `undefined`
# masuk perkalian di layar → NaN, dan kartu ringkasan menuliskan "—" tanpa
# menyebut bahan mana penyebabnya.
STK194=$(api "$OWNER" GET /stok)
# Dasar untuk dua asersi "tiap baris" di bawah: keduanya berbentuk
# "tak ada baris yang melanggar", dan daftar KOSONG memenuhinya tanpa
# memeriksa apa pun.
cek "dasar §194: daftar stok tidak kosong" "V >= 5" "$(echo "$STK194" | jq 'length')"
cek "tiap baris membawa kunci harga_per_unit" "V == 1" \
  "$(echo "$STK194" | jq '[.[]|select(has("harga_per_unit")|not)]|length==0|if . then 1 else 0 end')"
cek "harga_per_unit selalu bilangan tak-negatif" "V == 1" \
  "$(echo "$STK194" | jq '[.[]|select((.harga_per_unit|type)!="number" or .harga_per_unit<0)]|length==0|if . then 1 else 0 end')"

# Disetel LEWAT API, bukan mengandalkan angka seed yang kebetulan.
api "$OWNER" PUT "/bahan/$B194" '{"harga_beli":120000}' > /dev/null
HPU194=$(api "$OWNER" GET /stok | jq --arg i "$B194" '[.[]|select(.ingredient_id==$i)][0].harga_per_unit')
cek "harga_per_unit = harga_beli / isi (120000 per kemasan)" "abs(V - 120000/$ISI194) < 1e-6" "$HPU194"
# Pasangan anti-hijau-palsu: bahan berkemasan HARUS lebih murah per satuan
# kerjanya daripada per kemasannya. Tanpa ini, server yang mengirim harga
# kemasan apa adanya tetap lolos asersi mana pun yang cuma memeriksa "angka".
cek "harga per satuan kerja LEBIH KECIL dari harga kemasan" "V == 1" \
  "$(python3 -c "print(1 if $HPU194 < 120000 else 0)")"

# Diubah lagi: kalau angkanya konstanta atau tersalin dari kolom lain, ia tak
# akan ikut berubah — dan asersi di atas sendirian tak bisa membedakannya.
api "$OWNER" PUT "/bahan/$B194" '{"harga_beli":60000}' > /dev/null
HPU194B=$(api "$OWNER" GET /stok | jq --arg i "$B194" '[.[]|select(.ingredient_id==$i)][0].harga_per_unit')
cek "harga_beli dipotong separuh → harga_per_unit ikut separuh" "abs(V - $HPU194/2) < 1e-6" "$HPU194B"

# Nilai baris ini harus bisa dicocokkan dari DUA endpoint yang berbeda:
# saldo dari /stok, harga_beli & isi dari /bahan. Kartu ringkasan mengalikan
# keduanya, jadi kesepakatan di antara keduanya yang jadi syaratnya.
SALDO194=$(api "$OWNER" GET /stok | jq --arg i "$B194" '[.[]|select(.ingredient_id==$i)][0].saldo')
NILAI194=$(python3 -c "print($SALDO194 * $HPU194B)")
cek "nilai baris = saldo × (harga_beli/isi) dari /bahan" "abs(V - $NILAI194) < 1e-6" \
  "$(python3 -c "print($SALDO194 * 60000 / $ISI194)")"

# Harga NOL tetap berupa angka 0, BUKAN null. Bedanya menentukan: halaman
# mencacah bahan tak berharga supaya totalnya tak diam-diam kekurangan, dan
# null yang lolos ke perkalian menghasilkan NaN alih-alih cacahan.
api "$OWNER" PUT "/bahan/$B194" '{"harga_beli":0}' > /dev/null
cek "harga_beli 0 → harga_per_unit 0 (bukan null)" "V == 1" \
  "$(api "$OWNER" GET /stok | jq --arg i "$B194" '[.[]|select(.ingredient_id==$i)][0].harga_per_unit == 0|if . then 1 else 0 end')"

# Dikembalikan ke harga asalnya: seksi ini menyentuh HPP setiap menu yang
# memakai bahan ini, dan seksi yang ditambahkan kelak sesudahnya tak punya
# cara tahu angkanya sudah digeser.
api "$OWNER" PUT "/bahan/$B194" "{\"harga_beli\":$HB194_ASAL}" > /dev/null
cek "harga_beli dikembalikan ke nilai asalnya" "abs(V - $HB194_ASAL/$ISI194) < 1e-6" \
  "$(api "$OWNER" GET /stok | jq --arg i "$B194" '[.[]|select(.ingredient_id==$i)][0].harga_per_unit')"


echo "== 195. Bahan yang masih dimakan paket aktif tak bisa diarsipkan =="
# "Dipakai" harus berarti hal yang sama di penjaga hapus-bahan dan di kasir.
# Penjaga itu dulu cuma melihat menu yang memuat bahan ini DAN aktif sendiri,
# sementara `komponenEfektif` — yang benar-benar memotong stok saat menjual —
# memulangkan komponen menu itu sendiri DITAMBAH komponen MENU DASARNYA bila ia
# paket. Satu tingkat yang tak ikut terlihat:
#
#   paket P (aktif) → menu dasar A (diarsipkan) → bahan B
#
# Terukur sebelum perbaikan: stok B 100 pcs, kasir menjual 60 paket (butuh 120)
# — LOLOS, saldo B mendarat di −20, dan B sudah lenyap dari SETIAP layar stok
# (`hitungSaldoCabang` menyaring is_active). Sisa porsi paketnya pun berubah
# dari angka menjadi "tidak dibatasi bahan apa pun".
KAT195=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
CB195=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')
cek "dasar §195: kategori & cabang store ada" "V == 1" \
  "$(printf '%s%s' "$KAT195" "$CB195" | grep -Eqc '^[0-9a-f-]{72}$' && echo 1 || echo 0)"

# Satu bahan BARU per kasus: bahan yang dipakai menu lain akan tertahan oleh
# sebab yang berbeda, dan asersi yang hijau karena sebab lain lebih buruk
# daripada tak ada asersi.
bahan195() { api "$OWNER" POST /bahan "{\"nama\":\"Bahan 195 $1\",\"harga_beli\":1000,\"isi\":1,\"satuan\":\"pcs\",\"track_stok\":true}" | jq -r .id; }
dasar195() { api "$OWNER" POST /menu "{\"nama\":\"Dasar 195 $1\",\"category_id\":\"$KAT195\",\"harga_jual\":10000,\"mult\":2,\"komponen\":[{\"ingredient_id\":\"$2\",\"qty\":2}]}" | jq -r .id; }
paket195() { api "$OWNER" POST /menu "{\"nama\":\"Paket 195 $1\",\"category_id\":\"$KAT195\",\"harga_jual\":30000,\"tipe\":\"paket\",\"base_menu_id\":\"$2\",\"base_mult\":2,\"komponen\":[]}" | jq -r .id; }

# ── Kasus BUG: dasar diarsipkan, paketnya masih aktif ───────────────────────
BA=$(bahan195 A); MA=$(dasar195 A "$BA"); PA=$(paket195 A "$MA")
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB195\",\"items\":[{\"ingredient_id\":\"$BA\",\"qty\":100}]}" > /dev/null
# Dasar dulu: sisa porsi paket memang terhitung dari saldo bahan itu. Tanpa
# asersi ini, "null" sesudahnya tak bisa dibedakan dari menu yang dari awal
# memang tak punya pembatas.
cek "dasar §195: sisa porsi paket = 50 (100 stok ÷ 2 per porsi)" "V == 50" \
  "$(api "$OWNER" GET "/menu/ketersediaan?branch_id=$CB195" | jq --arg i "$PA" '[.[]|select(.menu_id==$i)][0].porsi')"
api "$OWNER" DELETE "/menu/$MA" > /dev/null
# Mengarsipkan menu dasar SENDIRI tidak merusak apa pun — `loadKatalog` sengaja
# memuat menu nonaktif supaya paket tetap utuh. Dipatok supaya perbaikan ini
# tak salah menutup pintu yang memang harus terbuka.
cek "menu dasar diarsipkan: paket TETAP terbatas 50 porsi" "V == 50" \
  "$(api "$OWNER" GET "/menu/ketersediaan?branch_id=$CB195" | jq --arg i "$PA" '[.[]|select(.menu_id==$i)][0].porsi')"
cek "INTI: hapus bahan yang masih dimakan paket aktif = 409" "V == 409" \
  "$(status_code "$OWNER" DELETE "/bahan/$BA")"
cek "pesan tolak menyebut PAKET-nya, bukan menu dasar yang diarsip" "V == 1" \
  "$(api "$OWNER" DELETE "/bahan/$BA" | jq '((.message // .error) | test("Paket 195 A"))|if . then 1 else 0 end')"
cek "bahan itu MASIH tampil di daftar stok" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB195" | jq --arg i "$BA" '[.[]|select(.ingredient_id==$i)]|length')"

# ── Pasangan anti-hijau-palsu: penjaga yang menolak SEMUA bukan penjaga ─────
BB=$(bahan195 B); MB=$(dasar195 B "$BB")
api "$OWNER" DELETE "/menu/$MB" > /dev/null
cek "dasar diarsip & TAK ada paket → boleh dihapus" "V == 200" \
  "$(status_code "$OWNER" DELETE "/bahan/$BB")"

BC=$(bahan195 C); MC=$(dasar195 C "$BC"); PC=$(paket195 C "$MC")
api "$OWNER" DELETE "/menu/$MC" > /dev/null
api "$OWNER" DELETE "/menu/$PC" > /dev/null
cek "dasar & PAKETNYA sama-sama diarsip → boleh dihapus" "V == 200" \
  "$(status_code "$OWNER" DELETE "/bahan/$BC")"

BD=$(bahan195 D); dasar195 D "$BD" > /dev/null
cek "menu biasa masih AKTIF → tetap 409 (jalur lama tak berubah)" "V == 409" \
  "$(status_code "$OWNER" DELETE "/bahan/$BD")"

echo "== 196. Padanan kemasan saldo dikirim JADI (untuk klien non-TS) =="
# Web memanggil `qtyTeks` sendiri; mobile ditulis Flutter dan tak bisa
# mengimpor `@kakarut/shared`. Menyerahkan aturannya ke tiap klien berarti
# `qtyTeks` punya salinan kedua dalam Dart — persis bentuk yang dulu melahirkan
# "Sayur 900 gr" di web vs "Sayur 900 kg" di mobile pada faktur yang SAMA
# (beda 1000×, angkanya benar, labelnya yang salah). Karena itu servernya yang
# menghitung, sama seperti `qty_setara` pada baris kiriman.
B196=$(api "$OWNER" GET /bahan | jq -r '[.[]|select(.track_stok==true and .isi>1)][0].id')
ISI196=$(api "$OWNER" GET /bahan | jq --arg i "$B196" '[.[]|select(.id==$i)][0].isi')
CB196=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')
cek "dasar §196: bahan berkemasan & cabang store ada" "V == 1" \
  "$(printf '%s%s' "$B196" "$CB196" | grep -Eqc '^[0-9a-f-]{72}$' && echo 1 || echo 0)"
cek "tiap baris membawa kunci saldo_setara (boleh null)" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq '[.[]|select(has("saldo_setara")|not)]|length==0|if . then 1 else 0 end')"

# Disetel lewat API lalu dicocokkan dengan hitungan mandiri di shell — bukan
# sekadar "ada isinya".
api "$OWNER" PUT "/bahan/$B196" '{"satuan_beli":"dus"}' > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB196\",\"items\":[{\"ingredient_id\":\"$B196\",\"qty\":$(python3 -c "print(int($ISI196)*3)")}]}" > /dev/null
cek "saldo pas 3 kemasan → tanpa '≈' (angkanya memang persis)" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq --arg i "$B196" '[.[]|select(.ingredient_id==$i)][0].saldo_setara == "3 dus"|if . then 1 else 0 end')"
# Sisa yang tak habis dibagi WAJIB ditandai "≈" — tanpa itu angka bulat palsu
# ("3 dus" untuk 3,02 dus) dibaca sebagai stok yang pas, dan belanja
# berikutnya dihitung dari angka yang tak pernah benar.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB196\",\"items\":[{\"ingredient_id\":\"$B196\",\"qty\":$(python3 -c "print(int($ISI196)*3+1)")}]}" > /dev/null
cek "saldo lebih sedikit → diawali '≈'" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq --arg i "$B196" '[.[]|select(.ingredient_id==$i)][0].saldo_setara|startswith("≈ ")|if . then 1 else 0 end')"
# Satuan KEMASAN, bukan satuan kerja. Inilah asersi yang menangkap "900 kg".
# Diperiksa atas SELURUH baris berpadanan, bukan satu baris uji: bug "900 kg"
# lahir dari satu bahan yang satuannya tertukar, dan bahan mana pun bisa jadi
# bahan itu.
cek "SEMUA padanan memakai satuan KEMASAN, bukan satuan kerja" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq '[.[]|select(.saldo_setara != null)]|map(. as $r|($r.saldo_setara|contains($r.satuan_beli)) and (($r.saldo_setara|contains(" \($r.satuan)"))|not))|all|if . then 1 else 0 end')"
cek "dasar: ada baris berpadanan untuk diperiksa" "V >= 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq '[.[]|select(.saldo_setara != null)]|length')"

# Saldo NOL → null, bukan "0 dus": padanan yang cuma mengulang nol.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB196\",\"items\":[{\"ingredient_id\":\"$B196\",\"qty\":0}]}" > /dev/null
cek "saldo NOL → saldo_setara null (bukan \"0 dus\")" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq --arg i "$B196" '[.[]|select(.ingredient_id==$i)][0].saldo_setara == null|if . then 1 else 0 end')"

# Bahan TANPA kemasan tak punya padanan — pasangan anti-hijau-palsu: bila
# server mengarang padanan untuk bahan eceran, ia akan mengarang satuan juga.
BE196=$(api "$OWNER" POST /bahan '{"nama":"Bahan Eceran 196","harga_beli":500,"isi":1,"satuan":"pcs","track_stok":true}' | jq -r .id)
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB196\",\"items\":[{\"ingredient_id\":\"$BE196\",\"qty\":7}]}" > /dev/null
cek "bahan isi=1 (tanpa kemasan) → saldo_setara null" "V == 1" \
  "$(api "$OWNER" GET "/stok?branch_id=$CB196" | jq --arg i "$BE196" '[.[]|select(.ingredient_id==$i)][0].saldo_setara == null|if . then 1 else 0 end')"


echo "== 197. Opname CK selagi barang di jalan: tak boleh dipotong dua kali =="
# Dilaporkan pemakainya: "pengurangan stock tidak betul hingga ada stock minus".
#
# `dikirim_at` adalah penanda KEBERANGKATAN, dan DUA hal bertumpu padanya:
#   1. `qtyDiJalan` — memotong barang yang sudah berangkat dari stok buku saat
#      opname, supaya hitungan petugas cocok. Mensyaratkan dikirim_at NOT NULL.
#   2. `kirim_keluar` — menyaring COALESCE(dikirim_at, waktu) > baseline opname.
#      Tanpa dikirim_at ia jatuh ke `waktu`, yang DITIMPA waktu penerimaan saat
#      baris dikonfirmasi — jadi kiriman yang berangkat SEBELUM opname tetap
#      terhitung keluar SESUDAHNYA.
#
# `POST /transfer-stok` dulu tak menstempelnya (jalur work-order sudah, sejak
# awal). Akibatnya terukur: CK 100 → kirim 40 → opname fisik 60 → tujuan
# menerima → saldo CK 20, bukan 60. Barang yang sama dipotong dua kali, dan
# petugas yang menghitung benar dituduh kehilangan 40.
CK197="$ASAL132"; ST197="$TUJUAN132"
B197=$(api "$OWNER" POST /bahan '{"nama":"Bahan Transit 197","harga_beli":1000,"isi":1,"satuan":"pcs","track_stok":true}' | jq -r .id)
cek "dasar §197: CK, cabang tujuan, & bahan uji ada" "V == 1" \
  "$(printf '%s%s%s' "$CK197" "$ST197" "$B197" | grep -Eqc '^[0-9a-f-]{108}$' && echo 1 || echo 0)"
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK197\",\"items\":[{\"ingredient_id\":\"$B197\",\"qty\":100}]}" > /dev/null
saldo197() { api "$OWNER" GET "/stok?branch_id=$1" | jq --arg i "$B197" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
cek "dasar §197: CK bermula 100" "V == 100" "$(saldo197 "$CK197")"

# Berangkat 40 — di jalur ini membuat transfer BERARTI mengirimkannya.
api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$CK197\",\"tujuan_branch_id\":\"$ST197\",\"items\":[{\"ingredient_id\":\"$B197\",\"qty\":40}]}" > /dev/null
cek "sudah berangkat, belum diterima → saldo CK masih 100" "V == 100" "$(saldo197 "$CK197")"

# INTI 1: petugas menghitung 60 (fisik di rak). Sistem harus SETUJU — selisih 0.
# Tanpa stempel keberangkatan, sistem menuliskan 100 dan melaporkan −40:
# kehilangan yang harus di-ACC owner, padahal tak ada yang hilang.
OP197=$(api "$OWNER" POST "/stok/opname?branch_id=$CK197" "{\"catatan\":\"transit 197\",\"items\":[{\"ingredient_id\":\"$B197\",\"qty\":60}]}")
cek "INTI: petugas hitung 60 saat 40 di jalan → selisih NOL" "abs(V) < 0.001" \
  "$(echo "$OP197" | jq '.ringkasan.total_selisih')"
SESI197=$(echo "$OP197" | jq -r '.session_id')
api "$OWNER" POST "/stok/opname/sesi/$SESI197/acc" > /dev/null
cek "baseline opname CK jadi 60" "V == 60" "$(saldo197 "$CK197")"

# INTI 2: tujuan menerima. Barang yang SAMA tak boleh dipotong lagi dari CK.
FK197=$(api "$OWNER" GET "/penerimaan?branch_id=$ST197" | jq -r --arg i "$B197" '[.rows[]?|select(.ingredient_id==$i)][0].faktur_id // empty')
cek "dasar §197: faktur kiriman muncul di Penerimaan tujuan" "V == 1" \
  "$(printf '%s' "$FK197" | grep -Eqc '^[0-9a-f-]{36}$' && echo 1 || echo 0)"
api "$OWNER" POST "/penerimaan/$FK197/terima?branch_id=$ST197" > /dev/null
cek "INTI: CK TETAP 60 sesudah diterima (bukan 20)" "V == 60" "$(saldo197 "$CK197")"
cek "tujuan bertambah 40" "V == 40" "$(saldo197 "$ST197")"

# Pasangan anti-hijau-palsu: kiriman yang berangkat SESUDAH opname MEMANG harus
# memotong saldo. Penjaga yang tak pernah memotong bukan penjaga.
api "$OWNER" POST /transfer-stok "{\"asal_branch_id\":\"$CK197\",\"tujuan_branch_id\":\"$ST197\",\"items\":[{\"ingredient_id\":\"$B197\",\"qty\":10}]}" > /dev/null
FK197B=$(api "$OWNER" GET "/penerimaan?branch_id=$ST197" | jq -r --arg i "$B197" '[.rows[]?|select(.ingredient_id==$i)][0].faktur_id // empty')
api "$OWNER" POST "/penerimaan/$FK197B/terima?branch_id=$ST197" > /dev/null
cek "kiriman SESUDAH opname tetap memotong: 60−10" "V == 50" "$(saldo197 "$CK197")"


echo "== 198. Setelan \"tolak pesanan melebihi stok\" (bawaan MATI) =="
# Diminta pemakainya setelah keluhan stok minus: "menjual melebihi stok bisa
# di on off kan di menu". Bawaannya MATI dan itu disengaja — menyalakannya
# untuk tenant berjalan akan menghentikan penjualan menu mana pun yang
# bahannya terlanjur bersaldo minus, keadaan yang lazim pada data lama.
KAT198=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
CB198=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')
B198=$(api "$OWNER" POST /bahan '{"nama":"Bahan Gerbang 198","harga_beli":1000,"isi":1,"satuan":"pcs","track_stok":true}' | jq -r .id)
M198=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Gerbang 198\",\"category_id\":\"$KAT198\",\"harga_jual\":20000,\"mult\":2,\"komponen\":[{\"ingredient_id\":\"$B198\",\"qty\":2}]}" | jq -r .id)
cek "dasar §198: bahan, menu, & cabang uji ada" "V == 1" \
  "$(printf '%s%s%s' "$B198" "$M198" "$CB198" | grep -Eqc '^[0-9a-f-]{108}$' && echo 1 || echo 0)"
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB198\",\"items\":[{\"ingredient_id\":\"$B198\",\"qty\":10}]}" > /dev/null

# Kasir baru + gerbang wajibnya (absen → buka kasir), supaya §198 tak
# bergantung pada keadaan shift yang ditinggalkan seksi lain.
api "$OWNER" POST /karyawan "{\"nama\":\"Kasir 198\",\"email\":\"kasir198@basooopa.id\",\"password\":\"Kasir198Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB198\"}" > /dev/null
K198=$(login "kasir198@basooopa.id" "Kasir198Pass!")
api "$K198" POST /absensi/saya '{"foto_url":"https://example.com/absen.jpg"}' > /dev/null
api "$K198" POST /shift/buka '{"modal_awal":100000}' > /dev/null
jual198() { status_code_body "$K198" POST /penjualan "{\"branch_id\":\"$CB198\",\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M198\",\"qty\":$1}]}"; }
saldo198() { api "$OWNER" GET "/stok?branch_id=$CB198" | jq --arg i "$B198" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }

# ── MATI (bawaan): perilaku lama tak boleh berubah sedikit pun ──────────────
# GET /company memulangkan baris mentah — kuncinya camelCase, sementara
# PATCH-nya menerima snake_case. Bukan kekeliruan seksi ini; begitulah
# kontraknya, dan web membacanya persis begitu (`company.diskonMaksPersen`).
cek "bawaan: setelan MATI" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.blokirJualMinus == false)|if . then 1 else 0 end')"
cek "MATI: jual 10 porsi dari stok 10 (butuh 20) tetap 201" "V == 201" "$(jual198 10)"
cek "MATI: saldo boleh minus" "V == -10" "$(saldo198)"

# ── NYALA ──────────────────────────────────────────────────────────────────
api "$OWNER" PATCH /company '{"blokir_jual_minus":true}' > /dev/null
cek "setelan tersimpan NYALA" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.blokirJualMinus == true)|if . then 1 else 0 end')"
# Saldo sudah −10. Keputusan pemiliknya: saldo yang SUDAH minus tetap ditolak.
cek "NYALA: bahan yang sudah minus TETAP ditolak (400)" "V == 400" "$(jual198 1)"
cek "NYALA: penolakan tak menulis apa pun — saldo tetap −10" "V == -10" "$(saldo198)"
PESAN198=$(api "$K198" POST /penjualan "{\"branch_id\":\"$CB198\",\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M198\",\"qty\":1}]}" | jq -r '.error // .message')
# Pesan untuk KASIR yang berdiri di depan tamu: sebut bahannya & angkanya,
# bukan "stok tidak cukup" yang tak bisa ditindaklanjuti siapa pun.
cek "pesan tolak menyebut nama bahan & angkanya" "V == 1" \
  "$(printf '%s' "$PESAN198" | grep -qc 'Bahan Gerbang 198' && printf '%s' "$PESAN198" | grep -Eqc 'sisa .*butuh' && echo 1 || echo 0)"

# Stok dicukupkan → transaksi yang sama harus LOLOS. Penjaga yang menolak
# semua bukan penjaga.
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB198\",\"items\":[{\"ingredient_id\":\"$B198\",\"qty\":100}]}" > /dev/null
cek "NYALA: stok cukup → 201" "V == 201" "$(jual198 10)"
cek "NYALA: saldo terpotong wajar 100−20" "V == 80" "$(saldo198)"
# Batas persis: 80 tersisa = tepat 40 porsi. Satu porsi lebih harus ditolak.
cek "NYALA: tepat sebanyak stok → boleh" "V == 201" "$(jual198 40)"
cek "NYALA: satu porsi melewati batas → 400" "V == 400" "$(jual198 1)"
cek "NYALA: saldo mendarat tepat 0, tak pernah minus" "V == 0" "$(saldo198)"

# ── Jalur yang SENGAJA dilewati ─────────────────────────────────────────────
# Sinkron offline: transaksinya sudah terjadi di lapangan. Menolaknya tak
# mencegah apa pun — antrean klien menandai perintah yang ditolak sebagai
# `gagal` dan tak pernah mengirimnya lagi, jadi penjualan sungguhan HILANG.
JUAL198_SEBELUM=$(api "$OWNER" GET /penjualan | jq 'if type=="array" then length else (.rows|length) end')
REF198=$(python3 -c "import uuid;print(uuid.uuid4())")
# WAKTU KEJADIAN DITURUNKAN DARI DATA, BUKAN DARI JAM DINDING.
#
# Dulu barisnya `now - 2 jam`, dan itu membuat §198 gagal empat kali sehari.
# Sebabnya bukan tanggal bisnis melainkan gerbang pencocokan shift di
# `sync/routes.ts`: tahap 1 menuntut `opened_at <= waktu + SKEW_MENIT` (5
# menit). Shift yang dipakai §198 dibuka SAAT RUN BERJALAN, jadi `now - 2 jam`
# jatuh dua jam SEBELUM shift itu ada — tak ada shift yang mencakupnya, 409
# `shift_tidak_cocok`. Bahwa ia pernah lulus sama sekali hanya karena seksi
# lain kebetulan meninggalkan shift bertanggal mundur yang menaunginya.
#
# Kelas cacat yang SAMA PERSIS sudah dicabut sekali di §138 — komentarnya
# bahkan menyebut run 17:05 UTC (= 00:05 WIB) dan menghitung jendela rusaknya
# "empat jam penuh setiap hari". Pelajarannya tak pernah dibawa ke saudaranya.
#
# §138 memperbaikinya dengan aritmetika menit-WIB. Di sini dipakai cara yang
# lebih kuat: waktunya diambil dari shift yang MEMANG ADA, jadi tak ada jam
# dinding yang bisa menggeser apa pun. Satu detik sesudah shift dibuka
# memenuhi keduanya sekaligus — di dalam jendela shift, dan tetap SEBELUM
# baseline `stok/awal` di atas (shift dibuka lebih dulu dari baseline itu).
BUKA198=$(api "$K198" GET /shift/aktif | jq -r '.dibuka_pada')
WKT198=$(python3 -c "
import datetime, sys
t = datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
print((t + datetime.timedelta(seconds=1)).astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
" "$BUKA198")
# Premis setupnya DIPATOK, bukan diandaikan: kalau salah satunya meleset,
# asersi di bawah akan lulus/gagal karena alasan yang bukan produknya.
cek "dasar §198: waktu kejadian sesudah shift dibuka & masih di masa lalu" "V == 1" \
  "$(python3 -c "
import sys
buka, wkt, kini = sys.argv[1:4]
print(1 if buka <= wkt < kini else 0)
" "$BUKA198" "$WKT198" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
SY198=$(api "$K198" POST /sync "{\"device_id\":\"dev198\",\"commands\":[{\"client_ref\":\"$REF198\",\"tipe\":\"penjualan\",\"waktu\":\"$WKT198\",\"payload\":{\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M198\",\"qty\":5}]}}]}")
cek "sinkron offline TETAP diterima walau stok 0" "V == 1" \
  "$(echo "$SY198" | jq '[.hasil[]|select(.kode >= 200 and .kode < 300)]|length')"
# Saldonya SENGAJA tidak bergeser: konsumsinya bertanggal SEBELUM baseline
# opname yang baru dibuat `stok/awal` di atas, jadi ia di luar jendela
# baseline. Itu justru aturan yang benar — hitungan fisik saat opname sudah
# memuat pemakaian itu. Yang dipatok di sini: penjualannya BENAR-BENAR
# tercatat, bukan diam-diam ditolak gerbang.
JUAL198_SESUDAH=$(api "$OWNER" GET /penjualan | jq 'if type=="array" then length else (.rows|length) end')
cek "…dan penjualannya benar-benar tercatat (bukan ditolak diam-diam)" "V == 1" \
  "$([ "$JUAL198_SESUDAH" -gt "$JUAL198_SEBELUM" ] && echo 1 || echo 0)"

# Membayar OPEN BILL yang sudah dipesan: makanannya sudah dimasak. Menolak di
# kasir berarti tamu yang sudah makan tak bisa membayar.
api "$OWNER" PATCH /company '{"blokir_jual_minus":false}' > /dev/null
BILL198=$(api "$K198" POST /open-bill "{\"branch_id\":\"$CB198\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$M198\",\"qty\":3}]}" | jq -r '.id')
cek "dasar §198: bill dibuat saat setelan masih mati" "V == 1" \
  "$(printf '%s' "$BILL198" | grep -Eqc '^[0-9a-f-]{36}$' && echo 1 || echo 0)"
api "$OWNER" PATCH /company '{"blokir_jual_minus":true}' > /dev/null
IT198=$(api "$K198" GET "/open-bill/$BILL198" | jq -c '[.items[]|{menu_id,qty,open_bill_item_id:.id}]')
cek "membayar bill yang sudah dipesan TETAP boleh" "V == 201" \
  "$(status_code_body "$K198" POST /penjualan "{\"branch_id\":\"$CB198\",\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"open_bill_id\":\"$BILL198\",\"items\":$IT198}")"
# Tapi MEMESAN bill baru saat stok kurang harus ditolak — itu titik yang
# masih bisa ditindaklanjuti, sebelum masakannya dikerjakan.
cek "MEMESAN bill baru saat stok kurang → 400" "V == 400" \
  "$(status_code_body "$K198" POST /open-bill "{\"branch_id\":\"$CB198\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$M198\",\"qty\":5}]}")"
api "$OWNER" PATCH /company '{"blokir_jual_minus":false}' > /dev/null
cek "dikembalikan MATI supaya seksi sesudahnya tak terpengaruh" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.blokirJualMinus == false)|if . then 1 else 0 end')"


echo "== 199. Shift ditutup PAS lalu ada transaksi susulan =="
# `kas_sistem` dihitung ULANG tiap shift dibaca, jadi penjualan bertanggal
# mundur dari sinkron offline bisa mendarat di jendela shift yang sudah lama
# ditutup. Dulu `status_selisih` diturunkan dari ada-tidaknya keputusan
# tersimpan (`selisihStatus ?? "pas"`) — beku sejak tutup. Akibatnya baris
# shift berbunyi "selisih −40.000" DAN "status pas" sekaligus, dan yang lebih
# mahal: GET /shift/selisih?status=menunggu (antrean persetujuan owner)
# memfilter kolom beku itu, jadi kekurangan kasnya tak pernah sampai ke owner.
KAT199=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
CB199=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')
B199=$(api "$OWNER" POST /bahan '{"nama":"Bahan Kas 199","harga_beli":100,"isi":1,"satuan":"pcs","track_stok":true}' | jq -r .id)
M199=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Kas 199\",\"category_id\":\"$KAT199\",\"harga_jual\":10000,\"mult\":2,\"komponen\":[{\"ingredient_id\":\"$B199\",\"qty\":1}]}" | jq -r .id)
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CB199\",\"items\":[{\"ingredient_id\":\"$B199\",\"qty\":1000}]}" > /dev/null
api "$OWNER" POST /karyawan "{\"nama\":\"Kasir 199\",\"email\":\"kasir199@basooopa.id\",\"password\":\"Kasir199Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB199\"}" > /dev/null
K199=$(login "kasir199@basooopa.id" "Kasir199Pass!")
api "$K199" POST /absensi/saya '{"foto_url":"https://example.com/absen.jpg"}' > /dev/null
cek "dasar §199: bahan, menu, kasir siap" "V == 1" \
  "$(printf '%s%s' "$B199" "$M199" | grep -Eqc '^[0-9a-f-]{72}$' && [ -n "$K199" ] && echo 1 || echo 0)"

api "$K199" POST /shift/buka '{"modal_awal":200000}' > /dev/null
api "$K199" POST /penjualan "{\"branch_id\":\"$CB199\",\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M199\",\"qty\":3}]}" > /dev/null
# Dibaca sebagai OWNER: kasir sengaja dibutakan dari kas & selisih sebelum
# mengunci hitungannya (`hitung_buta`), jadi `kas_sistem` bagi kasir null.
AKTIF199=$(api "$OWNER" GET "/shift/aktif?branch_id=$CB199")
KAS199=$(echo "$AKTIF199" | jq '.kas_sistem')
DIBUKA199=$(echo "$AKTIF199" | jq -r '.dibuka_pada')
# Angkanya RELATIF, bukan mutlak: cabang ini sudah dipakai seksi-seksi
# sebelumnya, jadi kas awalnya bukan angka yang bisa dipatok. Yang dijaga
# seksi ini adalah PERGESERANNYA.
cek "dasar §199: kas sistem terbaca (bukan buta)" "V > 0" "$KAS199"
# Ditutup PAS: uang fisik persis sama dengan kas sistem.
api "$K199" POST /shift/tutup "{\"uang_fisik\":$KAS199}" > /dev/null
shift199() { api "$OWNER" GET /shift | jq -c --arg d "$DIBUKA199" '[.[]|select(.dibuka_pada==$d)][0]'; }
cek "ditutup pas: selisih 0" "abs(V) < 0.001" "$(shift199 | jq '.selisih')"
cek "ditutup pas: status \"pas\"" "V == 1" \
  "$(shift199 | jq '(.status_selisih=="pas")|if . then 1 else 0 end')"
# Dilingkupi ke shift INI saja — seksi lain meninggalkan shift berselisih,
# dan asersi yang menghitung semuanya akan hijau/merah karena sebab lain.
SHID199=$(api "$OWNER" GET /shift | jq -r --arg d "$DIBUKA199" '[.[]|select(.dibuka_pada==$d)][0].id')
cek "dasar §199: shift ini belum ada di antrean persetujuan" "V == 0" \
  "$(api "$OWNER" GET "/shift/selisih?status=menunggu" | jq --arg i "$SHID199" '[.[]|select(.id==$i)]|length')"

# Penjualan TUNAI 40.000 bertanggal DI DALAM jendela shift itu, tersinkron
# sesudah shift ditutup — persis yang terjadi saat kasir offline lalu online.
#
# WAKTUNYA DITURUNKAN DARI JAM TUTUP YANG SESUNGGUHNYA, bukan dari "buka + 5
# detik". Yang lama bergantung pada berapa lama blok ini berjalan: bila §199
# selesai dalam kurang dari 5 detik, capnya mendarat SESUDAH shift ditutup —
# di LUAR jendela, kebalikan dari yang kalimat di atas katakan. Pada database
# yang sudah besar, seksi ini memakan 6,4 detik dan capnya jatuh di dalam
# jendela, jadi asersi di bawahnya berubah jawaban tanpa satu baris kode pun
# berubah. Titik tengah antara buka dan tutup selalu di dalam jendela, seberapa
# pun cepat atau lambat mesinnya.
DITUTUP199=$(shift199 | jq -r '.ditutup_pada')
WKT199=$(python3 -c "
import datetime
b=datetime.datetime.fromisoformat('$DIBUKA199'.replace('Z','+00:00'))
t=datetime.datetime.fromisoformat('$DITUTUP199'.replace('Z','+00:00'))
print((b + (t - b) / 2).strftime('%Y-%m-%dT%H:%M:%SZ'))")
cek "dasar §199: cap penjualan benar-benar di dalam jendela shift" "V == 1" \
  "$(python3 -c "print(1 if '$DIBUKA199'[:19] <= '$WKT199'[:19] <= '$DITUTUP199'[:19] else 0)")"
REF199=$(python3 -c "import uuid;print(uuid.uuid4())")
SY199=$(api "$K199" POST /sync "{\"device_id\":\"dev199\",\"commands\":[{\"client_ref\":\"$REF199\",\"tipe\":\"penjualan\",\"waktu\":\"$WKT199\",\"payload\":{\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"items\":[{\"menu_id\":\"$M199\",\"qty\":4}]}}]}")
cek "penjualan susulan diterima (transaksinya nyata)" "V == 1" \
  "$(echo "$SY199" | jq '[.hasil[]|select(.kode >= 200 and .kode < 300)]|length')"
# `di_luar_jendela_shift` menandai penjualan yang dibukukan lewat jalur CADANGAN
# — shift yang jendelanya tak memuat capnya sama sekali. Cap ini justru di
# DALAM jendela, jadi ia lewat jalur biasa dan penandanya memang false. Yang
# membuat seksi ini bernilai bukan penanda itu, melainkan bahwa shift-nya sudah
# TERTUTUP saat penjualannya tiba — dan itulah yang diuji asersi di bawah.
cek "cap di dalam jendela → BUKAN jalur susulan (penandanya false)" "V == 0" \
  "$(echo "$SY199" | jq '[.hasil[]|select(.data.di_luar_jendela_shift == true)]|length')"
cek "dasar §199: shift-nya memang sudah tertutup saat penjualan tiba" "V == 1" \
  "$(shift199 | jq '(.ditutup_pada != null)|if . then 1 else 0 end')"

# INTI: angka & statusnya harus SEPAKAT, dan owner harus melihatnya.
cek "kas sistem ikut naik persis 40.000" "abs(V - 40000) < 0.001" \
  "$(python3 -c "print($(shift199 | jq '.kas_sistem') - $KAS199)")"
cek "selisih jadi −40.000" "abs(V + 40000) < 0.001" "$(shift199 | jq '.selisih')"
cek "INTI: status TIDAK lagi \"pas\" saat selisihnya nyata" "V == 0" \
  "$(shift199 | jq '(.status_selisih=="pas")|if . then 1 else 0 end')"
cek "INTI: status jadi \"menunggu\" persetujuan" "V == 1" \
  "$(shift199 | jq '(.status_selisih=="menunggu")|if . then 1 else 0 end')"
cek "INTI: shift itu MUNCUL di antrean persetujuan owner" "V == 1" \
  "$(api "$OWNER" GET "/shift/selisih?status=menunggu" | jq --arg i "$SHID199" '[.[]|select(.id==$i)]|length')"
cek "…dan TIDAK lagi duduk di keranjang \"pas\"" "V == 0" \
  "$(api "$OWNER" GET "/shift/selisih?status=pas" | jq --arg i "$SHID199" '[.[]|select(.id==$i)]|length')"
# Pasangan anti-hijau-palsu: shift yang benar-benar pas harus TETAP "pas".
cek "shift yang memang pas tetap berstatus pas" "V >= 0" \
  "$(api "$OWNER" GET "/shift/selisih?status=pas" | jq '[.[]|select(.selisih == 0)]|length')"
cek "tak ada baris \"pas\" yang selisihnya bukan nol" "V == 0" \
  "$(api "$OWNER" GET "/shift/selisih?status=pas" | jq '[.[]|select(.selisih != 0)]|length')"


echo "== 200. Shift yang melewati tengah malam: satu sesi, bukan dua hari =="
# Alternasi masuk↔keluar dulu dikurung di dalam satu tanggal kalender. Sesi
# hadirnya tidak. Terukur pada server sungguhan untuk satu shift tutup
# (masuk 22:00 WIB, pulang 02:00 WIB), SEBELUM perbaikan:
#
#   cap 22:00 → masuk  (attend_date = hari-1)
#   cap 02:00 → masuk  (attend_date = hari-0)   ← cap PULANG tercatat MASUK
#   rekap: hadir=2, dua-duanya tanpa jam pulang
#
# dan sisi sebaliknya, pukul 00:30 saat orangnya masih di tengah shift:
#
#   POST /sync shift_buka → 400 "Absen masuk dulu sebelum buka kasir"
#
# Kasir yang sedang berdiri di kasirnya ditolak membuka laci. Kalau ia menurut
# dan menekan "Absen Sekarang", capnya justru MENUTUP sesi yang sedang
# berjalan — tuduhan yang menciptakan syaratnya sendiri, kelas cacat yang sama
# dengan yang dicabut `gerbang-kasir-absen.test.ts` lewat pintu lain.
uuid200() { cat /proc/sys/kernel/random/uuid; }
TZ200=$(api "$OWNER" GET /company | jq -r '.timezone // "Asia/Jakarta"')
CB200=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')

# Tengah malam yang DIPAKAI: yang terakhir lewat, dan SELURUH cap seksi ini
# sudah benar-benar di masa lalu. Cap terjauh ke depan adalah +10 jam (blok
# "hari biasa" di bawah), jadi 11 jam yang jadi syaratnya — bukan 2 jam yang
# hanya menampung cap pulang. Run yang jatuh pagi hari mundur satu hari;
# batas umur sinkron 7 hari tetap aman.
NOW200=$(date +%s)
MID200=$(TZ="$TZ200" date -d 'today 00:00' +%s)
if [ $((NOW200 - MID200)) -lt $((11 * 3600)) ]; then MID200=$((MID200 - 86400)); fi
W200_MASUK=$(date -u -d "@$((MID200 - 2 * 3600))" +%Y-%m-%dT%H:%M:%SZ)   # 22:00 hari-1
W200_TENGAH=$(date -u -d "@$((MID200 + 1800))" +%Y-%m-%dT%H:%M:%SZ)      # 00:30 hari-0
W200_PULANG=$(date -u -d "@$((MID200 + 2 * 3600))" +%Y-%m-%dT%H:%M:%SZ)  # 02:00 hari-0
HARI200_MASUK=$(TZ="$TZ200" date -d "@$((MID200 - 2 * 3600))" +%Y-%m-%d)
HARI200_PULANG=$(TZ="$TZ200" date -d "@$((MID200 + 2 * 3600))" +%Y-%m-%d)
cek "dasar §200: kedua cap memang jatuh di TANGGAL yang berbeda" "V == 1" \
  "$([ "$HARI200_MASUK" != "$HARI200_PULANG" ] && echo 1 || echo 0)"
cek "dasar §200: cap terjauh ke depan pun sudah lewat" "V == 1" \
  "$([ $((MID200 + 10 * 3600)) -lt "$NOW200" ] && echo 1 || echo 0)"

# Kasir baru khusus seksi ini: karyawan yang sudah dipakai seksi lain sudah
# punya cap hari ini, dan cap itulah yang justru dilewati aturan lintas-hari.
E200="malam200.$RANDOM@basooopa.id"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Kasir Malam 200\",\"email\":\"$E200\",\"password\":\"Malam200!\",\"role\":\"cashier\",\"branch_id\":\"$CB200\"}" > /dev/null
K200=$(login "$E200" "Malam200!")
cek "dasar §200: kasir malam bisa masuk" "V == 1" \
  "$([ -n "$K200" ] && echo 1 || echo 0)"
sync200() { # sync200 <tipe> <waktu> <payload-json>
  api "$K200" POST /sync \
    "$(jq -nc --arg r "$(uuid200)" --arg t "$1" --arg w "$2" --argjson p "$3" \
        '{commands:[{client_ref:$r,tipe:$t,waktu:$w,payload:$p}]}')"
}
absen200() { sync200 absen_saya "$1" '{"foto_url":"https://example.com/malam.jpg"}'; }

# ── Cap masuk 22:00: jalur lama, tak boleh bergeser ────────────────────────
R200A=$(absen200 "$W200_MASUK")
cek "cap 22:00 hari-1 → masuk" "V == 1" \
  "$(echo "$R200A" | jq '(.hasil[0].status=="ok" and .hasil[0].data.tipe=="masuk")|if . then 1 else 0 end')"

# ── INTI-1: gerbang buka kasir pukul 00:30, masih di tengah shift ──────────
R200B=$(sync200 shift_buka "$W200_TENGAH" '{"modal_awal":100000}')
cek "INTI: 00:30 masih di tengah shift → buka kasir DITERIMA" "V == 1" \
  "$(echo "$R200B" | jq '(.hasil[0].status=="ok")|if . then 1 else 0 end')"
# Anti-hijau-palsu: kalau gerbangnya memang jalan, ia harus MENOLAK orang yang
# belum absen sama sekali. Tanpa pasangan ini, "diterima" di atas bisa berarti
# gerbangnya mati, bukan gerbangnya benar.
E200B="belum200.$RANDOM@basooopa.id"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Kasir Belum 200\",\"email\":\"$E200B\",\"password\":\"Belum200!\",\"role\":\"cashier\",\"branch_id\":\"$CB200\"}" > /dev/null
K200B=$(login "$E200B" "Belum200!")
R200BB=$(api "$K200B" POST /sync \
  "$(jq -nc --arg r "$(uuid200)" --arg w "$W200_TENGAH" \
      '{commands:[{client_ref:$r,tipe:"shift_buka",waktu:$w,payload:{modal_awal:100000}}]}')")
cek "pasangan: kasir yang BELUM absen sama sekali tetap ditolak" "V == 1" \
  "$(echo "$R200BB" | jq '(.hasil[0].status=="gagal" and ((.hasil[0].error // "")|test("Absen masuk dulu")))|if . then 1 else 0 end')"

# ── INTI-2: cap pulang 02:00 di tanggal berikutnya ─────────────────────────
R200C=$(absen200 "$W200_PULANG")
cek "INTI: cap 02:00 hari-0 → KELUAR, bukan masuk kedua" "V == 1" \
  "$(echo "$R200C" | jq '(.hasil[0].status=="ok" and .hasil[0].data.tipe=="keluar")|if . then 1 else 0 end')"

# ── INTI-3: rekap — satu shift = satu baris, dengan jam pulangnya ──────────
BLN200=$(TZ="$TZ200" date -d "@$((MID200 - 2 * 3600))" +%Y-%m)
REKAP200=$(api "$OWNER" GET "/absensi/rekap?bulan=$BLN200&branch_id=$CB200")
BARIS200=$(echo "$REKAP200" | jq --arg n "Kasir Malam 200" '[.rows[]|select(.nama==$n)][0]')
cek "dasar §200: baris kasir malam ada di rekap" "V == 1" \
  "$(echo "$BARIS200" | jq 'if .==null then 0 else 1 end')"
cek "INTI: hadir = 1 (satu shift, bukan dua hari)" "V == 1" \
  "$(echo "$BARIS200" | jq '.hadir')"
cek "hari masuknya berstatus hadir" "V == 1" \
  "$(echo "$BARIS200" | jq --arg d "$HARI200_MASUK" '[.harian[]|select(.tanggal==$d)][0].status=="hadir"|if . then 1 else 0 end')"
cek "INTI: baris itu punya jam masuk DAN jam pulang" "V == 1" \
  "$(echo "$BARIS200" | jq --arg d "$HARI200_MASUK" '[.harian[]|select(.tanggal==$d)][0]|((.masuk!=null) and (.keluar!=null))|if . then 1 else 0 end')"
cek "jam pulangnya memang cap 02:00 itu" "V == 1" \
  "$(echo "$BARIS200" | jq --arg d "$HARI200_MASUK" --arg w "$W200_PULANG" \
      '[.harian[]|select(.tanggal==$d)][0].keluar as $k | ($k|sub("\\.000Z$";"Z"))==$w|if . then 1 else 0 end')"
# Tanggal berikutnya TIDAK ikut terhitung hadir — orangnya tak memulai shift di
# hari itu. Ini pergeseran yang disengaja, jadi dipatok eksplisit: sebelum
# perbaikan hari ini berstatus "hadir" berkat cap pulang yang salah tipe.
# `// {}`: bila blok ini mundur satu hari dan tanggal pulangnya jatuh di bulan
# berikutnya, ia memang tak ada di rekap bulan ini — dan "tak ada" juga bukan
# hadir. Tanpa itu jq galat dan asersinya gagal karena kalender.
cek "INTI: tanggal berikutnya BUKAN hadir" "V == 1" \
  "$(echo "$BARIS200" | jq --arg d "$HARI200_PULANG" '(([.harian[]|select(.tanggal==$d)][0]) // {}).status!="hadir"|if . then 1 else 0 end')"

# ── Status hadir: satu sumber untuk layar dan untuk gerbang ────────────────
cek "GET /absensi/status: sesudah cap pulang, TIDAK hadir lagi" "V == 1" \
  "$(api "$K200" GET "/absensi/status?branch_id=$CB200" | jq '.hadir==false|if . then 1 else 0 end')"
cek "daftar absensi hari cap masuk memuat kedua capnya" "V == 1" \
  "$(api "$OWNER" GET "/absensi?branch_id=$CB200&tanggal=$HARI200_MASUK" \
      | jq --arg n "Kasir Malam 200" '[.[]|select(.nama==$n)][0]|((.masuk!=null) and (.keluar!=null))|if . then 1 else 0 end')"

# ── Batas: masuk yang lupa ditutup TIDAK boleh menelan cap besok pagi ──────
# Kalau batas 12 jam ini hilang, cap masuk pagi hari orang yang kemarin lupa
# absen pulang akan berubah jadi cap PULANG — orang yang baru datang tercatat
# baru saja pulang, dan gerbang kasirnya langsung terkunci.
E200C="lupa200.$RANDOM@basooopa.id"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Kasir Lupa 200\",\"email\":\"$E200C\",\"password\":\"Lupa200!\",\"role\":\"cashier\",\"branch_id\":\"$CB200\"}" > /dev/null
K200C=$(login "$E200C" "Lupa200!")
W200_LUPA=$(date -u -d "@$((MID200 - 10 * 3600))" +%Y-%m-%dT%H:%M:%SZ)   # 14:00 hari-1
W200_PAGI=$(date -u -d "@$((MID200 + 7 * 3600))" +%Y-%m-%dT%H:%M:%SZ)    # 07:00 hari-0
cek "dasar: jarak dua cap yang BENAR-BENAR dikirim > 12 jam" "V > 43200" \
  "$(($(date -u -d "$W200_PAGI" +%s) - $(date -u -d "$W200_LUPA" +%s)))"
cek "dasar: cap masuk kemarin siang tercatat" "V == 1" \
  "$(api "$K200C" POST /sync \
      "$(jq -nc --arg r "$(uuid200)" --arg w "$W200_LUPA" \
          '{commands:[{client_ref:$r,tipe:"absen_saya",waktu:$w,payload:{foto_url:"https://example.com/lupa.jpg"}}]}')" \
      | jq '(.hasil[0].data.tipe=="masuk")|if . then 1 else 0 end')"
cek "INTI: cap pagi 17 jam kemudian tetap MASUK, bukan pulang" "V == 1" \
  "$(api "$K200C" POST /sync \
      "$(jq -nc --arg r "$(uuid200)" --arg w "$W200_PAGI" \
          '{commands:[{client_ref:$r,tipe:"absen_saya",waktu:$w,payload:{foto_url:"https://example.com/pagi.jpg"}}]}')" \
      | jq '(.hasil[0].data.tipe=="masuk")|if . then 1 else 0 end')"
# …dan cap kemarin TIDAK ikut dirapikan diam-diam: hari yang lupa ditutup tetap
# tampil tanpa jam pulang. Perbaikan ini menentukan tipe cap BARU, bukan menulis
# ulang riwayat — kalau ia sampai memasangkan keduanya, jam kerja kemarin
# berubah jadi 17 jam tanpa ada yang menyentuh apa pun.
cek "…dan hari kemarin tetap tanpa jam pulang (riwayat tak ditulis ulang)" "V == 1" \
  "$(api "$OWNER" GET "/absensi/rekap?bulan=$BLN200&branch_id=$CB200" \
      | jq --arg n "Kasir Lupa 200" --arg d "$HARI200_MASUK" \
        '[.rows[]|select(.nama==$n)][0].harian|[.[]|select(.tanggal==$d)][0]|((.status=="hadir") and (.masuk!=null) and (.keluar==null))|if . then 1 else 0 end')"

# ── Batas: dua cap di HARI yang sama tetap berselang-seling ────────────────
E200D="siang200.$RANDOM@basooopa.id"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Kasir Siang 200\",\"email\":\"$E200D\",\"password\":\"Siang200!\",\"role\":\"cashier\",\"branch_id\":\"$CB200\"}" > /dev/null
K200D=$(login "$E200D" "Siang200!")
siang200() { # siang200 <offset-detik-dari-tengah-malam>
  api "$K200D" POST /sync \
    "$(jq -nc --arg r "$(uuid200)" --arg w "$(date -u -d "@$((MID200 + $1))" +%Y-%m-%dT%H:%M:%SZ)" \
        '{commands:[{client_ref:$r,tipe:"absen_saya",waktu:$w,payload:{foto_url:"https://example.com/siang.jpg"}}]}')" \
    | jq -r '.hasil[0].data.tipe // .hasil[0].error'
}
cek "hari biasa: cap pertama masuk" "V == 1" \
  "$([ "$(siang200 $((8 * 3600)))" = "masuk" ] && echo 1 || echo 0)"
cek "hari biasa: cap kedua keluar" "V == 1" \
  "$([ "$(siang200 $((9 * 3600)))" = "keluar" ] && echo 1 || echo 0)"
cek "hari biasa: cap ketiga masuk lagi (re-entry, jalur lama utuh)" "V == 1" \
  "$([ "$(siang200 $((10 * 3600)))" = "masuk" ] && echo 1 || echo 0)"


echo "== 201. Jendela hitung rekap berlaku untuk cuti/libur juga, bukan cuma alpa =="
# Layar rekap sudah mencetak kontraknya untuk pembacanya: "Tanggal yang belum
# lewat, sebelum karyawan bergabung, dan setelah ia keluar TIDAK PERNAH
# DIHITUNG." Dulu hanya cabang `alpa` yang menurutinya; cabang izin dilewati
# sebelum jendelanya sempat diperiksa, jadi janji itu dilanggar di ketiga
# arahnya sekaligus.
#
# Terukur pada server sungguhan — bergabung 08-08, cuti 08-12..08-17 disetujui,
# lalu KELUAR 08-14:
#
#   alpa = 4   → berhenti di hari kerja terakhirnya (benar)
#   cuti = 6   → termasuk 08-15, 08-16, 08-17
#
# Tiga hari cuti berbayar untuk orang yang sudah tidak bekerja di sana, di baris
# yang justru dibaca pemilik untuk menghitung gaji.
#
# ARAH "SESUDAH KELUAR" TIDAK BISA DIUJI DI SINI, dan itu perlu dikatakan
# terang-terangan: `PATCH /karyawan/:id {"arsip":true}` selalu menstempel SAAT
# INI, sedangkan tanggal sesudah saat ini sudah tersaring `batasHitung` — jadi
# lewat HTTP kedua sebabnya tak bisa dibedakan. Arah itu butuh jam berjalan
# (diarsipkan tanggal 14, dibaca tanggal 20), dan dijaga `rekap-jendela-izin.test.ts`
# yang menjalankan aturannya langsung. Dua arah lain di bawah memakai gerbang
# yang SAMA PERSIS, jadi keduanya merah bila gerbang itu dilepas.
TZ201=$(api "$OWNER" GET /company | jq -r '.timezone // "Asia/Jakarta"')
CB201=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store")][0].id')
HARI201=$(TZ="$TZ201" date +%Y-%m-%d)
BLN201=$(TZ="$TZ201" date +%Y-%m)
AWAL201="$BLN201-01"
AKHIR201=$(TZ="$TZ201" date -d "$AWAL201 +1 month -1 day" +%Y-%m-%d)

E201="jendela201.$RANDOM@basooopa.id"
N201="Jendela Izin 201"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"$N201\",\"email\":\"$E201\",\"password\":\"Jendela201!\",\"role\":\"tim\",\"branch_id\":\"$CB201\"}" > /dev/null
K201=$(login "$E201" "Jendela201!")
cek "dasar §201: karyawan baru (bergabung HARI INI) bisa masuk" "V == 1" \
  "$([ -n "$K201" ] && echo 1 || echo 0)"

baris201() {
  api "$OWNER" GET "/absensi/rekap?bulan=$BLN201&branch_id=$CB201" \
    | jq --arg n "$N201" '[.rows[]|select(.nama==$n)][0]'
}
status201() { # status201 <baris-json> <tanggal>
  echo "$1" | jq -r --arg d "$2" '(([.harian[]|select(.tanggal==$d)][0]) // {}).status // "TIDAK-ADA"'
}
acc201() { # acc201 <kategori> <mulai> <selesai> → id, langsung disetujui
  local id
  id=$(api "$K201" POST /pengajuan \
    "{\"kategori\":\"$1\",\"tanggal_mulai\":\"$2\",\"tanggal_selesai\":\"$3\"}" | jq -r '.id // empty')
  [ -n "$id" ] && api "$OWNER" PATCH "/pengajuan/$id" '{"status":"disetujui"}' > /dev/null
  printf '%s' "$id"
}

# ── Kendali: cuti pada hari yang MEMANG di dalam jendela tetap terhitung ────
# Tanpa pasangan ini, "kosong" di bawah bisa berarti cutinya tak pernah tersimpan
# — perbaikan yang menghapus semua cuti akan terlihat sama hijaunya.
ID201A=$(acc201 tahunan "$HARI201" "$HARI201")
cek "dasar §201: pengajuan hari ini dibuat & disetujui" "V == 1" \
  "$([ -n "$ID201A" ] && echo 1 || echo 0)"
B201=$(baris201)
cek "kendali: cuti HARI INI (di dalam jendela) terhitung" "V == 1" \
  "$(echo "$B201" | jq '.cuti')"
cek "kendali: hari ini berstatus cuti" "V == 1" \
  "$([ "$(status201 "$B201" "$HARI201")" = "cuti" ] && echo 1 || echo 0)"

# ── Arah 1: cuti untuk tanggal SEBELUM ia bergabung ────────────────────────
ARAH201=0
if [ "$HARI201" \> "$AWAL201" ]; then
  ARAH201=$((ARAH201 + 1))
  SEB201=$(TZ="$TZ201" date -d "$HARI201 -1 day" +%Y-%m-%d)
  MUL201=$(TZ="$TZ201" date -d "$HARI201 -3 days" +%Y-%m-%d)
  [ "$MUL201" \< "$AWAL201" ] && MUL201="$AWAL201"
  ID201B=$(acc201 sakit "$MUL201" "$SEB201")
  cek "dasar: pengajuan tanggal lampau diterima server" "V == 1" \
    "$([ -n "$ID201B" ] && echo 1 || echo 0)"
  B201=$(baris201)
  cek "INTI: cuti SEBELUM ia bergabung → kosong, bukan cuti" "V == 1" \
    "$([ "$(status201 "$B201" "$SEB201")" = "kosong" ] && echo 1 || echo 0)"
  cek "INTI: dan tidak menambah penghitung cuti (tetap 1)" "V == 1" \
    "$(echo "$B201" | jq '.cuti')"
fi

# ── Arah 2: libur untuk tanggal yang BELUM LEWAT ───────────────────────────
if [ "$HARI201" \< "$AKHIR201" ]; then
  ARAH201=$((ARAH201 + 1))
  BSK201=$(TZ="$TZ201" date -d "$HARI201 +1 day" +%Y-%m-%d)
  ID201C=$(acc201 mingguan "$BSK201" "$BSK201")
  cek "dasar: pengajuan libur besok diterima & jenisnya 'libur'" "V == 1" \
    "$([ -n "$ID201C" ] && echo 1 || echo 0)"
  B201=$(baris201)
  cek "INTI: libur yang BELUM LEWAT → kosong, bukan libur" "V == 1" \
    "$([ "$(status201 "$B201" "$BSK201")" = "kosong" ] && echo 1 || echo 0)"
  cek "INTI: penghitung libur tetap 0" "V == 0" "$(echo "$B201" | jq '.libur')"
fi

cek "dasar §201: setidaknya satu arah benar-benar diuji hari ini" "V >= 1" "$ARAH201"

# ── Penghitung wajib sama dengan hariannya — itu yang membuat angkanya bisa
#    diperiksa sendiri oleh pembacanya. ───────────────────────────────────────
B201=$(baris201)
cek "penghitung cuti = jumlah hari bercap cuti" "V == 1" \
  "$(echo "$B201" | jq '(.cuti == ([.harian[]|select(.status=="cuti")]|length))|if . then 1 else 0 end')"
cek "penghitung libur = jumlah hari bercap libur" "V == 1" \
  "$(echo "$B201" | jq '(.libur == ([.harian[]|select(.status=="libur")]|length))|if . then 1 else 0 end')"
cek "penghitung alpa = jumlah hari bercap alpa" "V == 1" \
  "$(echo "$B201" | jq '(.tidak_hadir == ([.harian[]|select(.status=="alpa")]|length))|if . then 1 else 0 end')"
cek "penghitung hadir = jumlah hari bercap hadir" "V == 1" \
  "$(echo "$B201" | jq '(.hadir == ([.harian[]|select(.status=="hadir")]|length))|if . then 1 else 0 end')"

# ── Jalur lama utuh: cap absen MENANG atas cuti pada hari yang sama ─────────
# Perbaikan ini menyisipkan gerbang tepat sebelum cabang izin; kalau urutannya
# ikut bergeser, hari yang benar-benar bekerja bisa berubah jadi cuti.
E201D="hadircuti201.$RANDOM@basooopa.id"
N201D="Hadir Tapi Cuti 201"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"$N201D\",\"email\":\"$E201D\",\"password\":\"HadirCuti201!\",\"role\":\"tim\",\"branch_id\":\"$CB201\"}" > /dev/null
K201D=$(login "$E201D" "HadirCuti201!")
api "$K201D" POST /absensi/saya '{"foto_url":"https://example.com/201.jpg"}' > /dev/null
ID201D=$(api "$K201D" POST /pengajuan \
  "{\"kategori\":\"sakit\",\"tanggal_mulai\":\"$HARI201\",\"tanggal_selesai\":\"$HARI201\"}" | jq -r '.id // empty')
api "$OWNER" PATCH "/pengajuan/$ID201D" '{"status":"disetujui"}' > /dev/null
B201D=$(api "$OWNER" GET "/absensi/rekap?bulan=$BLN201&branch_id=$CB201" \
  | jq --arg n "$N201D" '[.rows[]|select(.nama==$n)][0]')
cek "sudah absen + cuti disetujui hari yang sama → tetap HADIR" "V == 1" \
  "$(echo "$B201D" | jq --arg d "$HARI201" '[.harian[]|select(.tanggal==$d)][0].status=="hadir"|if . then 1 else 0 end')"
cek "…dan tidak dihitung dua kali (hadir=1, cuti=0)" "V == 1" \
  "$(echo "$B201D" | jq '((.hadir==1) and (.cuti==0))|if . then 1 else 0 end')"


echo "== 202. Stok CK perlengkapan hanya boleh dijanjikan SEKALI =="
# Ledger perlengkapan baru bergerak SAAT DITERIMA: `terimaKirimanPerlengkapan`
# menulis debit CK dan kredit cabang sekaligus. Selama barang di jalan, saldo CK
# karena itu masih memuatnya utuh — dan pemeriksaan "stok CK cukup" membaca
# saldo itu apa adanya.
#
# Terukur pada server sungguhan, CK berisi 10 pcs, dua toko sama-sama di bawah
# minimum. BUKAN balapan — dua permintaan berurutan:
#
#   Toko A minta → KP-0026, 10 pcs   (saldo CK terbaca 10)
#   Toko B minta → KP-0032, 10 pcs   (saldo CK MASIH terbaca 10)
#   keduanya menekan Terima → CK = −10, A = 10, B = 10
#
# Dua puluh keluar dari sepuluh. Dan `tak_bisa_kirim` KOSONG, jadi tak seorang
# pun diberi tahu: kekurangannya baru terlihat saat saldo CK sudah minus, dan
# faktur beli yang seharusnya menutupinya tak pernah terbit.
api "$OWNER" POST /company/mode '{"mode":"pro"}' > /dev/null
CK202=$(api "$OWNER" POST /cabang '{"nama":"CK 202","tipe":"central_kitchen"}' | jq -r '.id // empty')
A202=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko A 202\",\"central_kitchen_id\":\"$CK202\"}" | jq -r '.id // empty')
B202=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko B 202\",\"central_kitchen_id\":\"$CK202\"}" | jq -r '.id // empty')
cek "dasar §202: CK + dua toko yang menggantung padanya" "V == 1" \
  "$([ -n "$CK202" ] && [ -n "$A202" ] && [ -n "$B202" ] && echo 1 || echo 0)"

# Satu perlengkapan BARU khusus seksi ini: item yang sudah dipakai seksi lain
# membawa saldo & kiriman sendiri, dan angka yang hijau karena sebab lain lebih
# buruk daripada tak ada asersi. Minimum 10 → kedua toko (saldo 0) kekurangan 10.
SP202=$(api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"Spons 202 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":5000,\"stok_minimum\":10}" | jq -r '.id // empty')
cek "dasar §202: perlengkapan uji dibuat" "V == 1" "$([ -n "$SP202" ] && echo 1 || echo 0)"
# CK diisi 10 — cukup untuk SATU toko, tidak untuk dua.
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK202" \
  "{\"items\":[{\"supply_id\":\"$SP202\",\"qty\":10}]}" > /dev/null
saldo202() { # saldo202 <branch_id>
  api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$SP202" '[.[]|select(.id==$i)][0].saldo // 0'
}
cek "dasar §202: saldo CK 10, kedua toko 0" "V == 1" \
  "$([ "$(saldo202 "$CK202")" = "10" ] && [ "$(saldo202 "$A202")" = "0" ] && [ "$(saldo202 "$B202")" = "0" ] && echo 1 || echo 0)"

# ── Toko A minta lebih dulu ────────────────────────────────────────────────
RA202=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$A202")
cek "toko A dapat kiriman 10 pcs" "V == 10" \
  "$(echo "$RA202" | jq --arg i "$SP202" '[.dibuat[]?|select(.supply_id==$i)][0].qty // 0')"
# Justru inilah yang membuat cacatnya mungkin — dipatok supaya tetap terlihat.
cek "saldo CK BELUM berkurang (ledger bergerak saat diterima)" "V == 10" "$(saldo202 "$CK202")"

# ── Toko B minta hal yang sama, BERURUTAN ──────────────────────────────────
RB202=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$B202")
cek "INTI: toko B TIDAK dijanjikan stok yang sama" "V == 0" \
  "$(echo "$RB202" | jq --arg i "$SP202" '[.dibuat[]?|select(.supply_id==$i)]|length')"
# Permintaannya tak boleh lenyap begitu saja: kekurangan yang tak tertutup stok
# CK adalah persis kasus yang faktur beli BP- disediakan untuknya.
cek "INTI: kekurangannya jadi baris faktur beli, bukan hilang" "V == 10" \
  "$(echo "$RB202" | jq --arg i "$SP202" '[.beli_dibuat[]?|select(.supply_id==$i)][0].qty // 0')"
cek "faktur beli BP- benar-benar terbit" "V == 1" \
  "$(echo "$RB202" | jq '((.beli_faktur != null) and ((.beli_faktur.nomor|length) > 0))|if . then 1 else 0 end')"

# ── Keduanya menekan Terima ────────────────────────────────────────────────
terima202() { # terima202 <branch_id> → jumlah kiriman yang diterima
  local n=0 id
  for id in $(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$1" | jq -r '.[]|select(.status=="dikirim")|.id'); do
    api "$OWNER" POST "/perlengkapan/kiriman/$id/terima?branch_id=$1" > /dev/null
    n=$((n + 1))
  done
  printf '%s' "$n"
}
cek "toko A menerima tepat 1 kiriman" "V == 1" "$(terima202 "$A202")"
cek "toko B tak punya kiriman untuk diterima" "V == 0" "$(terima202 "$B202")"
cek "INTI: saldo CK mendarat di 0, BUKAN minus" "V == 0" "$(saldo202 "$CK202")"
cek "toko A menerima 10" "V == 10" "$(saldo202 "$A202")"
cek "toko B tetap 0 (barangnya memang belum ada)" "V == 0" "$(saldo202 "$B202")"
# Yang paling penting dari semuanya: jumlahnya kekal. Sepuluh masuk, sepuluh
# tersebar. Asersi ini yang akan merah untuk SETIAP cara stok CK bocor, bukan
# hanya cara yang kebetulan sudah terpikirkan.
cek "INTI: kekekalan — CK + A + B = 10 seperti semula" "V == 10" \
  "$(python3 -c "print($(saldo202 "$CK202") + $(saldo202 "$A202") + $(saldo202 "$B202"))")"

# ── Pasangan anti-hijau-palsu: penjaga yang menolak SEMUA bukan penjaga ────
# Sesudah barang A benar-benar diterima, tak ada lagi yang di jalan — jadi CK
# yang diisi ulang harus bisa mengirim lagi seperti biasa.
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK202" \
  "{\"items\":[{\"supply_id\":\"$SP202\",\"qty\":10}]}" > /dev/null
cek "dasar: CK diisi ulang jadi 10" "V == 10" "$(saldo202 "$CK202")"
RB202B=$(api "$OWNER" POST "/perlengkapan/permintaan-otomatis?branch_id=$B202")
cek "pasangan: sesudah stok ada, toko B DAPAT kiriman 10" "V == 10" \
  "$(echo "$RB202B" | jq --arg i "$SP202" '[.dibuat[]?|select(.supply_id==$i)][0].qty // 0')"
cek "pasangan: toko B menerimanya" "V == 1" "$(terima202 "$B202")"
cek "pasangan: kekekalan tetap — total 20 sesudah diisi 10 lagi" "V == 20" \
  "$(python3 -c "print($(saldo202 "$CK202") + $(saldo202 "$A202") + $(saldo202 "$B202"))")"


echo "== 203. Opname perlengkapan di CK: barang di jalan tak boleh dipotong dua kali =="
# Ledger perlengkapan baru bergerak SAAT DITERIMA. Jadi barang yang sudah
# berangkat ke cabang sudah tidak ada di rak CK, tapi masih utuh di ledgernya —
# dan layar opname menyodorkan angka ledger itu sebagai "Sistem".
#
# Terukur pada server sungguhan, CK berisi 10 pcs yang seluruhnya sudah dikirim:
#
#   petugas menghitung rak → 0 (memang kosong)
#   opname di-ACC          → koreksi −10
#   toko menekan Terima    → debit   −10
#   CK = −10, Toko = 10, total = 0 dari 10 yang ada
#
# Sepuluh unit menguap dari pembukuan dan saldo CK jatuh minus. Bentuk yang
# sama persis dengan §197 di sisi bahan baku, muncul lagi di sistem saudaranya.
api "$OWNER" POST /company/mode '{"mode":"pro"}' > /dev/null
CK203=$(api "$OWNER" POST /cabang '{"nama":"CK 203","tipe":"central_kitchen"}' | jq -r '.id // empty')
TK203=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko 203\",\"central_kitchen_id\":\"$CK203\"}" | jq -r '.id // empty')
cek "dasar §203: CK + toko yang menggantung padanya" "V == 1" \
  "$([ -n "$CK203" ] && [ -n "$TK203" ] && echo 1 || echo 0)"

sp203() { api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"$1 203 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":2000,\"stok_minimum\":0}" | jq -r '.id // empty'; }
saldo203() { # saldo203 <branch_id> <supply_id>
  api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$2" '[.[]|select(.id==$i)][0].saldo // 0'
}
jalan203() { # jalan203 <branch_id> <supply_id>
  api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$2" '[.[]|select(.id==$i)][0].dalam_jalan // 0'
}
opname203() { # opname203 <branch_id> <supply_id> <qty_fisik> → jumlah_selisih (ACC bila ada)
  local res ses
  res=$(api "$OWNER" POST "/perlengkapan/opname?branch_id=$1" \
    "{\"items\":[{\"supply_id\":\"$2\",\"qty_fisik\":$3}],\"catatan\":\"uji 203\"}")
  ses=$(echo "$res" | jq -r '.session_id // empty')
  [ -n "$ses" ] && api "$OWNER" POST "/perlengkapan/opname/sesi/$ses/acc" > /dev/null
  echo "$res" | jq '.jumlah_selisih // 0'
}

# ── Jalur lama: tanpa barang di jalan, opname bekerja seperti sebelumnya ────
# Pasangan anti-hijau-palsu. Tanpa ini, perbaikan yang mematikan opname sama
# sekali akan terlihat sama hijaunya dengan perbaikan yang benar.
SPA203=$(sp203 Biasa)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPA203\",\"qty\":10}]}" > /dev/null
cek "dasar §203: saldo CK 10, tak ada yang di jalan" "V == 1" \
  "$([ "$(saldo203 "$CK203" "$SPA203")" = "10" ] && [ "$(jalan203 "$CK203" "$SPA203")" = "0" ] && echo 1 || echo 0)"
cek "pasangan: hitung 7 dari 10 → opname tetap mencatat selisih" "V == 1" \
  "$(opname203 "$CK203" "$SPA203" 7)"
cek "pasangan: saldonya benar-benar turun jadi 7" "V == 7" "$(saldo203 "$CK203" "$SPA203")"

# ── INTI: seluruh stok sudah berangkat, rak memang kosong ──────────────────
SPB203=$(sp203 Jalan)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPB203\",\"qty\":10}]}" > /dev/null
cek "dasar §203: kiriman 10 pcs dibuat" "V == 201" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$SPB203/minta?branch_id=$TK203" '{"qty":10,"catatan":"uji 203"}')"
cek "saldo CK BELUM bergerak (ledger menunggu Terima)" "V == 10" "$(saldo203 "$CK203" "$SPB203")"
cek "INTI: DTO memberitahu 10 sedang di jalan" "V == 10" "$(jalan203 "$CK203" "$SPB203")"
# Inilah keputusan yang salah dulu: rak kosong dibaca sebagai kekurangan 10.
cek "INTI: hitung rak = 0 → TIDAK ada selisih (10 itu di jalan, bukan hilang)" "V == 0" \
  "$(opname203 "$CK203" "$SPB203" 0)"
cek "INTI: saldo CK tak tersentuh opname" "V == 10" "$(saldo203 "$CK203" "$SPB203")"

KID203=$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$TK203" | jq -r '[.[]|select(.status=="dikirim")][0].id // empty')
cek "dasar §203: kirimannya ada untuk diterima" "V == 1" "$([ -n "$KID203" ] && echo 1 || echo 0)"
api "$OWNER" POST "/perlengkapan/kiriman/$KID203/terima?branch_id=$TK203" > /dev/null
cek "INTI: sesudah Terima, saldo CK mendarat di 0 — BUKAN −10" "V == 0" \
  "$(saldo203 "$CK203" "$SPB203")"
cek "toko menerima 10" "V == 10" "$(saldo203 "$TK203" "$SPB203")"
cek "INTI: kekekalan — CK + Toko = 10 seperti semula" "V == 10" \
  "$(python3 -c "print($(saldo203 "$CK203" "$SPB203") + $(saldo203 "$TK203" "$SPB203"))")"
cek "sesudah diterima, tak ada lagi yang di jalan" "V == 0" "$(jalan203 "$CK203" "$SPB203")"

# ── Selisih SUNGGUHAN tetap tertangkap walau ada barang di jalan ───────────
# Ini yang membedakan "membandingkan angka rak" dari "mematikan opname".
SPC203=$(sp203 Campur)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPC203\",\"qty\":10}]}" > /dev/null
api "$OWNER" POST "/perlengkapan/$SPC203/minta?branch_id=$TK203" '{"qty":6,"catatan":"uji 203"}' > /dev/null
cek "dasar: 6 di jalan, jadi yang seharusnya di rak = 4" "V == 6" "$(jalan203 "$CK203" "$SPC203")"
cek "INTI: hitung rak = 4 → tak ada selisih (bukan 10 − 4 = 6)" "V == 0" \
  "$(opname203 "$CK203" "$SPC203" 4)"
cek "INTI: hitung rak = 1 → selisih NYATA tetap tertangkap" "V == 1" \
  "$(opname203 "$CK203" "$SPC203" 1)"
cek "…dan besarnya −3 (dari 4 yang seharusnya ada), bukan −9" "V == 7" \
  "$(saldo203 "$CK203" "$SPC203")"

# ── SAUDARANYA: "Stok Awal" menanyakan hal yang sama, di halaman yang sama ──
# Endpoint sebelah, aritmetika yang sama, dan dulu buta yang sama persis:
# terukur CK 10 pcs yang seluruhnya sudah dikirim, owner menyetel stok awal 0 →
# saldo CK 0, lalu toko menekan Terima → CK −10, total 0 dari 10 yang ada.
# Memperbaiki opname sendirian akan membuat klaimnya benar separuh.
SPD203=$(sp203 StokAwal)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPD203\",\"qty\":10}]}" > /dev/null
cek "dasar: stok awal 10 tersetel saat tak ada yang di jalan" "V == 10" \
  "$(saldo203 "$CK203" "$SPD203")"
api "$OWNER" POST "/perlengkapan/$SPD203/minta?branch_id=$TK203" '{"qty":10,"catatan":"uji 203"}' > /dev/null
cek "dasar: 10 berangkat, rak CK kosong" "V == 10" "$(jalan203 "$CK203" "$SPD203")"
# Rak kosong → owner menyetel stok awal 0. Itu jawaban yang JUJUR.
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPD203\",\"qty\":0}]}" > /dev/null
cek "INTI: stok awal 0 atas rak kosong TIDAK memotong barang di jalan" "V == 10" \
  "$(saldo203 "$CK203" "$SPD203")"
KID203B=$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$TK203" | jq -r '[.[]|select(.status=="dikirim")][0].id // empty')
api "$OWNER" POST "/perlengkapan/kiriman/$KID203B/terima?branch_id=$TK203" > /dev/null
cek "INTI: sesudah Terima, saldo CK 0 — BUKAN −10" "V == 0" "$(saldo203 "$CK203" "$SPD203")"
cek "INTI: kekekalan — CK + Toko = 10" "V == 10" \
  "$(python3 -c "print($(saldo203 "$CK203" "$SPD203") + $(saldo203 "$TK203" "$SPD203"))")"
# Pasangan: tanpa barang di jalan, stok awal tetap menyetel apa adanya.
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPD203\",\"qty\":25}]}" > /dev/null
cek "pasangan: stok awal tetap bekerja normal tanpa barang di jalan" "V == 25" \
  "$(saldo203 "$CK203" "$SPD203")"

# ── PINTU KETIGA: koreksi fisik satu item ──────────────────────────────────
# Ditemukan dengan menyapu SEMUA pemanggil saldo perlengkapan sesudah dua pintu
# pertama diperbaiki — dan ia rusak identik. Ketiganya kini lewat
# `saldoDiRakPerlengkapan`, satu fungsi bernama konsepnya, supaya pintu keempat
# tak bisa lupa.
SPE203=$(sp203 Koreksi)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK203" \
  "{\"items\":[{\"supply_id\":\"$SPE203\",\"qty\":10}]}" > /dev/null
api "$OWNER" POST "/perlengkapan/$SPE203/minta?branch_id=$TK203" '{"qty":10,"catatan":"uji 203"}' > /dev/null
cek "dasar: 10 berangkat, rak CK kosong" "V == 10" "$(jalan203 "$CK203" "$SPE203")"
KOR203=$(api "$OWNER" POST "/perlengkapan/$SPE203/koreksi?branch_id=$CK203" \
  '{"qty_fisik":0,"catatan":"rak kosong"}')
cek "INTI: koreksi fisik 0 atas rak kosong → selisih 0" "V == 0" \
  "$(echo "$KOR203" | jq '.selisih // 999')"
cek "INTI: saldo CK tak tersentuh koreksi" "V == 10" "$(saldo203 "$CK203" "$SPE203")"
KID203C=$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$TK203" | jq -r '[.[]|select(.status=="dikirim")][0].id // empty')
api "$OWNER" POST "/perlengkapan/kiriman/$KID203C/terima?branch_id=$TK203" > /dev/null
cek "INTI: sesudah Terima, saldo CK 0 — BUKAN −10" "V == 0" "$(saldo203 "$CK203" "$SPE203")"
cek "INTI: kekekalan — CK + Toko = 10" "V == 10" \
  "$(python3 -c "print($(saldo203 "$CK203" "$SPE203") + $(saldo203 "$TK203" "$SPE203"))")"
# Pasangan: koreksi tetap mengoreksi saat memang ada selisih.
cek "pasangan: koreksi fisik 3 dari 0 → selisih +3" "V == 3" \
  "$(api "$OWNER" POST "/perlengkapan/$SPE203/koreksi?branch_id=$CK203" '{"qty_fisik":3}' | jq '.selisih // 0')"
cek "pasangan: saldonya benar-benar jadi 3" "V == 3" "$(saldo203 "$CK203" "$SPE203")"


echo "== 204. Perlengkapan yang sudah berangkat tak bisa 'dipakai' lagi di CK =="
# Keluarga kedua dari cacat yang sama. §203 membetulkan yang bertanya "berapa
# yang ADA di rak" (opname, stok awal, koreksi); yang ini bertanya "boleh
# DIPAKAI berapa" — dan ia pun memvalidasi terhadap saldo mentah.
#
# Ledger perlengkapan baru bergerak saat diterima, jadi barang yang sudah
# berangkat masih utuh di saldo CK. Terukur: CK 10 pcs yang seluruhnya sudah
# dikirim, `pakai 10` DITERIMA → saldo 0, lalu toko menekan Terima → CK −10,
# total 0 dari 10 yang ada.
#
# Akibatnya merembet: saldo CK yang jatuh di bawah jumlah barang di jalan
# membuat `siap kirim` negatif, dan penolakan pengiriman otomatis yang ditelan
# `tibaBeliPerlengkapan` jadi terjangkau. Menutup pintu ini menutup pemicunya.
CK204=$(api "$OWNER" POST /cabang '{"nama":"CK 204","tipe":"central_kitchen"}' | jq -r '.id // empty')
TK204=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko 204\",\"central_kitchen_id\":\"$CK204\"}" | jq -r '.id // empty')
SP204=$(api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"Sabun 204 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":3000,\"stok_minimum\":0}" | jq -r '.id // empty')
cek "dasar §204: CK, toko, dan itemnya siap" "V == 1" \
  "$([ -n "$CK204" ] && [ -n "$TK204" ] && [ -n "$SP204" ] && echo 1 || echo 0)"
saldo204() { api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$SP204" '[.[]|select(.id==$i)][0].saldo // 0'; }
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK204" \
  "{\"items\":[{\"supply_id\":\"$SP204\",\"qty\":10}]}" > /dev/null

# ── Pasangan lebih dulu: sebelum apa pun berangkat, pakai HARUS boleh ───────
# Tanpa ini, perbaikan yang menolak SEMUA pemakaian akan terlihat sama hijaunya.
cek "pasangan: rak penuh → pakai 4 diterima" "V == 200" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$SP204/pakai?branch_id=$CK204" '{"qty":4}')"
cek "pasangan: saldonya benar-benar turun jadi 6" "V == 6" "$(saldo204 "$CK204")"

# ── INTI: sisa 6 dikirim seluruhnya, lalu CK mencoba memakainya ────────────
api "$OWNER" POST "/perlengkapan/$SP204/minta?branch_id=$TK204" '{"qty":6,"catatan":"uji 204"}' > /dev/null
cek "dasar: 6 berangkat, rak CK kosong" "V == 6" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK204" | jq --arg i "$SP204" '[.[]|select(.id==$i)][0].dalam_jalan // 0')"
cek "INTI: pakai 6 DITOLAK — barangnya sudah di jalan" "V == 400" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$SP204/pakai?branch_id=$CK204" '{"qty":6}')"
cek "INTI: penolakannya menyebut saldo RAK (0), bukan saldo buku (6)" "V == 1" \
  "$(api "$OWNER" POST "/perlengkapan/$SP204/pakai?branch_id=$CK204" '{"qty":6}' \
      | jq '((.message // .error // "")|test("saldo 0"))|if . then 1 else 0 end')"
cek "INTI: saldo CK tak tersentuh percobaan itu" "V == 6" "$(saldo204 "$CK204")"

KID204=$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$TK204" | jq -r '[.[]|select(.status=="dikirim")][0].id // empty')
api "$OWNER" POST "/perlengkapan/kiriman/$KID204/terima?branch_id=$TK204" > /dev/null
cek "INTI: sesudah Terima, saldo CK 0 — BUKAN −6" "V == 0" "$(saldo204 "$CK204")"
cek "INTI: kekekalan — CK + Toko = 6 (sesudah 4 dipakai dari 10)" "V == 6" \
  "$(python3 -c "print($(saldo204 "$CK204") + $(saldo204 "$TK204"))")"
# …dan sesudah barangnya benar-benar sampai, toko boleh memakainya.
cek "pasangan: toko yang MENERIMA boleh memakainya" "V == 200" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$SP204/pakai?branch_id=$TK204" '{"qty":6}')"
cek "pasangan: saldo toko jadi 0" "V == 0" "$(saldo204 "$TK204")"


echo "== 205. Layar cabang tak menjanjikan stok CK yang sudah punya tuan =="
# `saldo_ck` punya satu pekerjaan: menyalakan tombol "Minta ke CK", mengisi
# qty-nya, dan memberitahu cabang berapa yang bisa diminta. Ledger CK masih
# memuat barang yang sudah berangkat ke cabang LAIN, jadi ledger mentah
# menjanjikan barang yang sudah punya tuan.
#
# Terukur: CK 10 pcs seluruhnya sudah dikirim ke Toko B; Toko C melihat "Stok
# Central Kitchen: 10", tombolnya menyala, qty-nya terisi 10 — lalu server
# menolak dengan "siap kirim 0 dari saldo 10". Penjaga sisi tulisnya sudah benar
# sejak #201; yang salah tinggal janjinya.
CK205=$(api "$OWNER" POST /cabang '{"nama":"CK 205","tipe":"central_kitchen"}' | jq -r '.id // empty')
TB205=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko B 205\",\"central_kitchen_id\":\"$CK205\"}" | jq -r '.id // empty')
TC205=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko C 205\",\"central_kitchen_id\":\"$CK205\"}" | jq -r '.id // empty')
SP205=$(api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"Spons 205 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":2000,\"stok_minimum\":50}" | jq -r '.id // empty')
cek "dasar §205: CK + dua toko yang menggantung padanya" "V == 1" \
  "$([ -n "$CK205" ] && [ -n "$TB205" ] && [ -n "$TC205" ] && [ -n "$SP205" ] && echo 1 || echo 0)"
ck205() { api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$SP205" '[.[]|select(.id==$i)][0].saldo_ck'; }
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK205" \
  "{\"items\":[{\"supply_id\":\"$SP205\",\"qty\":10}]}" > /dev/null

cek "dasar: sebelum apa pun berangkat, Toko C melihat 10" "V == 10" "$(ck205 "$TC205")"
cek "cabang yang MEMANG CK-nya tetap melihat null" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK205" | jq --arg i "$SP205" '[.[]|select(.id==$i)][0].saldo_ck==null|if . then 1 else 0 end')"

# ── INTI: seluruh stok CK berangkat ke Toko B ─────────────────────────────
api "$OWNER" POST "/perlengkapan/$SP205/minta?branch_id=$TB205" '{"qty":10}' > /dev/null
cek "INTI: Toko C tak lagi dijanjikan 10 — barangnya milik Toko B" "V == 0" "$(ck205 "$TC205")"
# Janji dan penolakan harus SEPAKAT: layar 0, server pun menolak.
cek "INTI: dan permintaan Toko C memang ditolak server" "V == 400" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$SP205/minta?branch_id=$TC205" '{"qty":10}')"

# ── Pasangan anti-hijau-palsu: perbaikan yang selalu 0 harus MERAH ────────
# Stok awal kini berarti "RAK berisi N" (§203), jadi menyetel 7 membuat ledger
# CK 17 dengan 10 di jalan — dan yang boleh dijanjikan tepat 7.
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK205" \
  "{\"items\":[{\"supply_id\":\"$SP205\",\"qty\":7}]}" > /dev/null
cek "pasangan: rak CK diisi 7 (10 masih di jalan) → Toko C melihat 7" "V == 7" \
  "$(ck205 "$TC205")"
cek "pasangan: dan permintaan 7 itu BERHASIL" "V == 201" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$SP205/minta?branch_id=$TC205" '{"qty":7}')"
cek "pasangan: sesudah itu tak ada sisa yang dijanjikan" "V == 0" "$(ck205 "$TC205")"


echo "== 206. Pemakaian OTOMATIS tak memakan barang yang sudah berangkat =="
# Pintu kelima, dan yang paling tajam dari seluruh keluarganya: TAK ADA yang
# menekan apa pun. `terapkanKonsumsiOtomatis` berjalan sendiri setiap kali
# daftar perlengkapan dibuka, dan ia memotong dari ledger MENTAH.
#
# Niat kodenya sudah benar sejak awal — `if (sisa <= 0) break` artinya "jangan
# memakai yang tidak ada". Yang salah cuma ukurannya. Terukur:
#
#   CK 10 pcs, seluruhnya sudah dikirim, rak kosong
#   aturan 3 pcs/hari × 4 hari → memakan seluruh 10, saldo CK 0
#   toko menekan Terima        → CK −10, total 0 dari 10 yang ada
#
# Ini juga membantah dugaanku di #203 bahwa `pakai` satu-satunya pemicu yang
# bisa menjatuhkan saldo CK di bawah jumlah barang di jalan.
CK206=$(api "$OWNER" POST /cabang '{"nama":"CK 206","tipe":"central_kitchen"}' | jq -r '.id // empty')
TK206=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko 206\",\"central_kitchen_id\":\"$CK206\"}" | jq -r '.id // empty')
MULAI206=$(python3 -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=4)).isoformat())")
sp206() { api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"$1 206 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":1000,\"stok_minimum\":0}" | jq -r '.id // empty'; }
saldo206() { api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$2" '[.[]|select(.id==$i)][0].saldo // 0'; }
cek "dasar §206: CK + toko" "V == 1" \
  "$([ -n "$CK206" ] && [ -n "$TK206" ] && echo 1 || echo 0)"

# ── Pasangan LEBIH DULU: tanpa barang di jalan, potongan otomatis harus JALAN ──
# Tanpa ini, perbaikan yang mematikan seluruh potongan otomatis akan terlihat
# sama hijaunya — dan itu diam-diam merusak fitur yang dipakai tiap hari.
SPA206=$(sp206 Rutin)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK206" \
  "{\"items\":[{\"supply_id\":\"$SPA206\",\"qty\":10}]}" > /dev/null
api "$OWNER" PUT "/perlengkapan/$SPA206/aturan?branch_id=$CK206" \
  "{\"metode\":\"otomatis\",\"qty\":3,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$MULAI206\"}" > /dev/null
cek "pasangan: rak penuh → potongan otomatis tetap memotong" "V == 1" \
  "$(python3 -c "print(1 if $(saldo206 "$CK206" "$SPA206") < 10 else 0)")"

# ── INTI: seluruh stok berangkat lebih dulu ───────────────────────────────
SPB206=$(sp206 Jalan)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK206" \
  "{\"items\":[{\"supply_id\":\"$SPB206\",\"qty\":10}]}" > /dev/null
api "$OWNER" POST "/perlengkapan/$SPB206/minta?branch_id=$TK206" '{"qty":10}' > /dev/null
api "$OWNER" PUT "/perlengkapan/$SPB206/aturan?branch_id=$CK206" \
  "{\"metode\":\"otomatis\",\"qty\":3,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$MULAI206\"}" > /dev/null
# Membaca daftarnya MEMICU potongan otomatis — itulah cara bug ini dulu kambuh.
cek "INTI: potongan otomatis tak menyentuh barang di jalan" "V == 10" \
  "$(saldo206 "$CK206" "$SPB206")"
KID206=$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$TK206" | jq -r '[.[]|select(.status=="dikirim")][0].id // empty')
api "$OWNER" POST "/perlengkapan/kiriman/$KID206/terima?branch_id=$TK206" > /dev/null
cek "INTI: sesudah Terima, saldo CK 0 — BUKAN −10" "V == 0" "$(saldo206 "$CK206" "$SPB206")"
cek "INTI: kekekalan — CK + Toko = 10" "V == 10" \
  "$(python3 -c "print($(saldo206 "$CK206" "$SPB206") + $(saldo206 "$TK206" "$SPB206"))")"

# ── Campuran: sebagian di rak, sebagian di jalan ──────────────────────────
# Yang membedakan "mengukur rak" dari "mematikan potongan saat ada kiriman".
SPC206=$(sp206 Campur)
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK206" \
  "{\"items\":[{\"supply_id\":\"$SPC206\",\"qty\":10}]}" > /dev/null
api "$OWNER" POST "/perlengkapan/$SPC206/minta?branch_id=$TK206" '{"qty":6}' > /dev/null
api "$OWNER" PUT "/perlengkapan/$SPC206/aturan?branch_id=$CK206" \
  "{\"metode\":\"otomatis\",\"qty\":1,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$MULAI206\"}" > /dev/null
# Rak berisi 4; aturan 1/hari selama 4 hari boleh memakan sampai 4, tak lebih.
cek "INTI: potongan berhenti di batas RAK (4), tak menembus ke 10" "V == 1" \
  "$(python3 -c "s=$(saldo206 "$CK206" "$SPC206"); print(1 if 6 <= s <= 10 else 0)")"
cek "INTI: dan tak pernah jatuh di bawah jumlah yang di jalan (6)" "V == 1" \
  "$(python3 -c "print(1 if $(saldo206 "$CK206" "$SPC206") >= 6 else 0)")"


echo "== 207. SIFAT: saldo CK tak pernah jatuh di bawah barang yang di jalan =="
# Penutup keluarga §203–§206. Lima bug terpisah, satu sifat yang dilanggar
# kelimanya — dan lima kali berturut-turut aku salah menebak di mana pintu
# berikutnya. Jadi yang diuji di sini SIFATNYA, bukan pintunya.
#
# Sapuan seluruh penulis mutasi perlengkapan memberi enam jalur yang bisa
# MENGURANGI saldo cabang: stok-awal, opname, koreksi fisik, pakai, potongan
# otomatis, dan debit saat Terima. Seksi ini menjalankan kelimanya yang bisa
# dipicu langsung, berselang-seling dengan kiriman yang sedang berjalan, dan
# memeriksa sifat yang sama sesudah SETIAP langkah:
#
#   saldo CK >= barang yang sedang di jalan dari CK
#
# Kalau pintu KEENAM lahir suatu hari, ia akan merah di sini tanpa perlu ada
# yang menebak lebih dulu bahwa ia ada.
CK207=$(api "$OWNER" POST /cabang '{"nama":"CK 207","tipe":"central_kitchen"}' | jq -r '.id // empty')
TB207=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko B 207\",\"central_kitchen_id\":\"$CK207\"}" | jq -r '.id // empty')
TC207=$(api "$OWNER" POST /cabang "{\"nama\":\"Toko C 207\",\"central_kitchen_id\":\"$CK207\"}" | jq -r '.id // empty')
SP207=$(api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"Serbet 207 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":1500,\"stok_minimum\":0}" | jq -r '.id // empty')
cek "dasar §207: CK + dua toko + item" "V == 1" \
  "$([ -n "$CK207" ] && [ -n "$TB207" ] && [ -n "$TC207" ] && [ -n "$SP207" ] && echo 1 || echo 0)"

# Satu panggilan mengambil saldo DAN dalam_jalan sekaligus — sifatnya harus
# diperiksa pada potret yang sama, bukan dua potret berjarak.
sifat207() { # sifat207 <label> — 1 bila saldo >= dalam_jalan DAN saldo >= 0
  local row
  row=$(api "$OWNER" GET "/perlengkapan?branch_id=$CK207" | jq -c --arg i "$SP207" '[.[]|select(.id==$i)][0]')
  python3 -c "
import json,sys
r = json.loads('''$row''') if '''$row''' not in ('', 'null') else {}
s = r.get('saldo', 0); j = r.get('dalam_jalan', 0)
print(1 if (s >= j - 1e-9 and s >= -1e-9) else 0)
"
}
langkah207() { cek "sifat sesudah: $1" "V == 1" "$(sifat207)"; }

MULAI207=$(python3 -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=3)).isoformat())")

# URUTANNYA DIRANCANG SUPAYA RAK BENAR-BENAR KOSONG saat tiap operasi dicoba.
# Percobaan pertama seksi ini gagal menangkap apa pun: waktu itu raknya masih
# berisi cukup di tiap langkah, jadi pintu yang rusak tak pernah tertekan sampai
# melanggar sifatnya — uji sifat yang tak pernah bisa gagal. Sekarang hampir
# seluruh stok dikirim LEBIH DULU, sisanya dihabiskan potongan otomatis, lalu
# tiap operasi perusak dicoba di depan rak kosong dengan ledger yang masih besar.
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK207" \
  "{\"items\":[{\"supply_id\":\"$SP207\",\"qty\":20}]}" > /dev/null
langkah207 "stok awal 20"

api "$OWNER" POST "/perlengkapan/$SP207/minta?branch_id=$TB207" '{"qty":18}' > /dev/null
langkah207 "18 dari 20 berangkat ke Toko B (rak tinggal 2, ledger masih 20)"

# Aturan 5/hari jauh melebihi isi rak — potongannya harus berhenti di 2, bukan 20.
api "$OWNER" PUT "/perlengkapan/$SP207/aturan?branch_id=$CK207" \
  "{\"metode\":\"otomatis\",\"qty\":5,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$MULAI207\"}" > /dev/null
langkah207 "potongan otomatis 5/hari menghabiskan sisa rak"

# Mulai di sini raknya KOSONG sementara ledger masih memuat 18 yang di jalan.
# Setiap operasi di bawah adalah percobaan mengambil dari rak kosong.
api "$OWNER" POST "/perlengkapan/$SP207/pakai?branch_id=$CK207" '{"qty":5}' > /dev/null
langkah207 "CK mencoba memakai 5 di depan rak kosong"

api "$OWNER" POST "/perlengkapan/$SP207/koreksi?branch_id=$CK207" '{"qty_fisik":0}' > /dev/null
langkah207 "koreksi fisik: rak dihitung 0"

SES207=$(api "$OWNER" POST "/perlengkapan/opname?branch_id=$CK207" \
  "{\"items\":[{\"supply_id\":\"$SP207\",\"qty_fisik\":0}]}" | jq -r '.session_id // empty')
[ -n "$SES207" ] && api "$OWNER" POST "/perlengkapan/opname/sesi/$SES207/acc" > /dev/null
langkah207 "opname: rak dihitung 0, di-ACC"

api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CK207" \
  "{\"items\":[{\"supply_id\":\"$SP207\",\"qty\":0}]}" > /dev/null
langkah207 "stok awal disetel 0 di depan rak kosong"

KB207=$(api "$OWNER" GET "/perlengkapan/kiriman?branch_id=$TB207" | jq -r '[.[]|select(.status=="dikirim")][0].id // empty')
[ -n "$KB207" ] && api "$OWNER" POST "/perlengkapan/kiriman/$KB207/terima?branch_id=$TB207" > /dev/null
langkah207 "Toko B menerima 18"


# Sesudah semua mendarat: tak ada lagi yang di jalan, dan CK tak minus.
cek "INTI: tak ada sisa di jalan sesudah semua diterima" "V == 0" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CK207" | jq --arg i "$SP207" '[.[]|select(.id==$i)][0].dalam_jalan // 0')"
cek "INTI: saldo CK tidak minus" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/perlengkapan?branch_id=$CK207" | jq --arg i "$SP207" '[.[]|select(.id==$i)][0].saldo // 0') >= -1e-9 else 0)")"
cek "INTI: Toko B benar-benar menerima 18-nya" "V == 18" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$TB207" | jq --arg i "$SP207" '[.[]|select(.id==$i)][0].saldo // 0')"


echo "== 208. Sinkron offline mendarat di cabang yang DIMAKSUD =="
# `panggilInternal` dulu menyusun URL tanpa query sama sekali — seluruh payload
# masuk badan. Handler menentukan cabangnya lewat `resolveBranchId(c)` yang
# membaca `?branch_id=`, jadi cabang yang diminta perangkat TAK PERNAH SAMPAI,
# dan untuk peran tak terikat cabang ia jatuh ke CABANG PERTAMA perusahaan.
#
# Terukur: owner menyinkronkan "pakai 7 pcs di Cabang B" → dibalas status "ok"
# kode 200, saldo Cabang B tetap 100, dan yang terpotong justru cabang pertama
# (100 → 93). Dua cabang salah sekaligus, tanpa satu pun galat.
#
# Ditemukan lewat pengukuran cakupan: 5 dari 13 perintah sync tak punya satu pun
# asersi, dan semuanya memindahkan stok.
CK208=$(api "$OWNER" POST /cabang '{"nama":"CK 208","tipe":"central_kitchen"}' | jq -r '.id // empty')
CB208A=$(api "$OWNER" POST /cabang "{\"nama\":\"Cabang 208 A\",\"central_kitchen_id\":\"$CK208\"}" | jq -r '.id // empty')
CB208B=$(api "$OWNER" POST /cabang "{\"nama\":\"Cabang 208 B\",\"central_kitchen_id\":\"$CK208\"}" | jq -r '.id // empty')
SP208=$(api "$OWNER" POST /perlengkapan \
  "{\"nama\":\"Sabun 208 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":1000,\"stok_minimum\":0}" | jq -r '.id // empty')
cek "dasar §208: dua cabang + item" "V == 1" \
  "$([ -n "$CB208A" ] && [ -n "$CB208B" ] && [ -n "$SP208" ] && echo 1 || echo 0)"
s208() { api "$OWNER" GET "/perlengkapan?branch_id=$1" | jq --arg i "$SP208" '[.[]|select(.id==$i)][0].saldo // 0'; }
for b in "$CB208A" "$CB208B"; do
  api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$b" \
    "{\"items\":[{\"supply_id\":\"$SP208\",\"qty\":100}]}" > /dev/null
done
# Cabang PERTAMA perusahaan — tujuan cadangan yang dulu keliru dipakai.
CB208_1=$(api "$OWNER" GET /cabang | jq -r 'sort_by(.created_at) | .[0].id')
api "$OWNER" POST "/perlengkapan/stok-awal?branch_id=$CB208_1" \
  "{\"items\":[{\"supply_id\":\"$SP208\",\"qty\":100}]}" > /dev/null

sync208() { # sync208 <token> <json-payload> → balasan hasil[0]
  api "$1" POST /sync "{\"device_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"commands\":[{\"client_ref\":\"$(cat /proc/sys/kernel/random/uuid)\",\"tipe\":\"perlengkapan_pakai\",\"waktu\":\"$(date -u +%FT%TZ)\",\"payload\":$2}]}" \
    | jq -c '.hasil[0] // {}'
}

# ── INTI: owner menyinkronkan pekerjaan di cabang B ───────────────────────
H208=$(sync208 "$OWNER" "{\"supply_id\":\"$SP208\",\"branch_id\":\"$CB208B\",\"qty\":7}")
cek "INTI: perintahnya diterima" "V == 1" \
  "$(echo "$H208" | jq '(.status=="ok")|if . then 1 else 0 end')"
cek "INTI: yang terpotong cabang B — cabang yang DIMAKSUD" "V == 93" "$(s208 "$CB208B")"
cek "INTI: cabang A tak tersentuh" "V == 100" "$(s208 "$CB208A")"
cek "INTI: cabang PERTAMA perusahaan tak tersentuh (dulu ke sini)" "V == 100" \
  "$(s208 "$CB208_1")"

# ── Otorisasi TIDAK dilonggarkan oleh perbaikan ini ──────────────────────
# Ini pasangan yang wajib: mengangkat branch_id ke query bisa saja membuka
# jalan bagi kasir menulis ke cabang lain. `resolveBranchId` MENGABAIKAN query
# untuk peran terikat cabang — dan itu harus tetap benar sesudah perubahan.
EK208="kasir208.$RANDOM@basooopa.id"
api "$OWNER" POST /karyawan \
  "{\"nama\":\"Kasir 208\",\"email\":\"$EK208\",\"password\":\"Kasir208!\",\"role\":\"cashier\",\"branch_id\":\"$CB208A\"}" > /dev/null
KS208=$(login "$EK208" "Kasir208!")
cek "dasar: kasir cabang A bisa login" "V == 1" "$([ -n "$KS208" ] && echo 1 || echo 0)"
HK208=$(sync208 "$KS208" "{\"supply_id\":\"$SP208\",\"branch_id\":\"$CB208B\",\"qty\":5}")
cek "PASANGAN: kasir menunjuk cabang B → tetap mengenai cabangnya SENDIRI (A)" "V == 95" \
  "$(s208 "$CB208A")"
cek "PASANGAN: cabang B tak tersentuh oleh kasir cabang lain" "V == 93" "$(s208 "$CB208B")"

# ── Cabang milik perusahaan LAIN ditolak, bukan dipakai diam-diam ────────
cek "PASANGAN: branch_id acak (bukan milik perusahaan ini) ditolak" "V == 1" \
  "$(sync208 "$OWNER" "{\"supply_id\":\"$SP208\",\"branch_id\":\"00000000-0000-4000-8000-000000000000\",\"qty\":1}" \
      | jq '(.status=="gagal" and (.kode==404 or .kode==403))|if . then 1 else 0 end')"
cek "PASANGAN: dan tak ada cabang mana pun yang berubah karenanya" "V == 1" \
  "$(python3 -c "print(1 if $(s208 "$CB208A") == 95 and $(s208 "$CB208B") == 93 and $(s208 "$CB208_1") == 100 else 0)")"

# ── Tanpa branch_id: perilaku lama dipertahankan (cadangan cabang pertama) ─
cek "tanpa branch_id di payload → tetap jatuh ke cabang pertama (perilaku lama)" "V == 99" \
  "$(sync208 "$OWNER" "{\"supply_id\":\"$SP208\",\"qty\":1}" > /dev/null; s208 "$CB208_1")"


echo "== 210. Harga TEBAKAN tak boleh menentukan harga acuan =="
# Faktur beli yang dibuat TANPA harga diisi qty × harga acuan saat itu dan
# ditandai `harga_tebakan`. Kartu Riwayat Harga menghitung terendah, tertinggi,
# median, dan rata-rata tertimbang — dan keempatnya dulu memasukkan tebakan.
#
# Kenapa itu berbahaya, dengan kalimat layarnya sendiri: "Median jadi harga
# acuan RAB belanja — disinkron otomatis tiap Laporan Harga. Harga acuan itulah
# dasar HPP resep & laba-rugi." Jadi angka yang ditampilkan adalah angka yang
# pemilik salin jadi acuan, dan acuan itu yang menurunkan tebakan berikutnya:
# acuan → tebakan → median → acuan.
#
# Terukur lewat API ini juga, sebelum perbaikan: satu pembelian nyata 20.000,
# sisanya belanja tanpa harga → layar melaporkan Terendah 10.000 · Median
# 15.000 · Rata 15.000. 10.000 tak pernah dibayar siapa pun — itu acuan lama
# yang dikutip balik sistem seolah-olah sebuah pembelian. Menurutinya mengunci
# acuan 25% di bawah satu-satunya harga yang nyata, permanen.
B210=$(api "$OWNER" POST /bahan '{"nama":"Bahan Tebakan Uji 210","harga_beli":10000,"isi":1,"satuan":"pcs","pengadaan":"beli","track_stok":true}' | jq -r .id)
beli210() { # beli210 <jumlah> [total_harga] → faktur_id, sudah dikonfirmasi
  local F item="{\"ingredient_id\":\"$B210\",\"mode\":\"pcs\",\"jumlah\":$1"
  # tanpa total_harga = persis jalan yang melahirkan tebakan
  if [ -n "${2:-}" ]; then item="$item,\"total_harga\":$2"; fi
  F=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[$item}]}" | jq -r .faktur_id)
  api "$OWNER" POST "/pembelian/tahap/$F" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$F" '{"ke":"menunggu"}' > /dev/null
  api "$OWNER" POST "/pembelian/konfirmasi/$F" > /dev/null
  echo "$F"
}
F210A=$(beli210 10 200000)   # NYATA 20.000/pcs — satu-satunya harga yang dilihat orang
beli210 10 > /dev/null       # tanpa harga → tebakan dari acuan (10.000/pcs)
beli210 10 > /dev/null       # tanpa harga → tebakan lagi
RH210=$(api "$OWNER" GET "/bahan/$B210/pembelian")

cek "dasar §210: 3 lot tercatat, 2 di antaranya berharga TEBAKAN" "V == 1" \
  "$(echo "$RH210" | jq '((.jumlah_pembelian==3) and ([.lots[]|select(.harga_tebakan)]|length==2))|if . then 1 else 0 end')"
cek "lot tebakan TETAP ditampilkan (10.000/pcs), tidak disembunyikan" "V == 2" \
  "$(echo "$RH210" | jq '[.lots[]|select(.harga_tebakan and .harga_satuan==10000)]|length')"
cek "INTI: median = 20.000 — satu-satunya harga yang pernah dilihat orang" "V == 20000" \
  "$(echo "$RH210" | jq '.harga_median')"
cek "INTI: terendah BUKAN 10.000 — harga itu tak pernah dibayar siapa pun" "V == 20000" \
  "$(echo "$RH210" | jq '.harga_terendah.harga')"
cek "INTI: tertinggi 20.000" "V == 20000" "$(echo "$RH210" | jq '.harga_tertinggi.harga')"
cek "INTI: rata-rata tertimbang 20.000 (salinan kedua yang juga lupa)" "V == 20000" \
  "$(echo "$RH210" | jq '.harga_rata')"
cek "statistiknya mengaku dari berapa harga: 1 dari 3 lot" "V == 1" \
  "$(echo "$RH210" | jq '.jumlah_harga_nyata')"

# ── PASANGAN: saringannya TIDAK menelan harga yang memang nyata ───────────
# Arah sebaliknya, dan ia yang membuat asersi di atas berarti: saringan yang
# terlalu rakus membuat statistiknya kosong selamanya — kegagalan yang jauh
# lebih sunyi, sebab layar cuma menampilkan "—".
beli210 10 300000 > /dev/null   # NYATA 30.000/pcs
RH210B=$(api "$OWNER" GET "/bahan/$B210/pembelian")
cek "PASANGAN: pembelian nyata kedua tetap menggerakkan statistiknya" "V == 1" \
  "$(echo "$RH210B" | jq '((.harga_median==25000) and (.harga_tertinggi.harga==30000) and (.jumlah_harga_nyata==2))|if . then 1 else 0 end')"
cek "PASANGAN: rata-rata tertimbang ikut naik ke 25.000" "V == 25000" \
  "$(echo "$RH210B" | jq '.harga_rata')"

# ── JANJI LAYARNYA, diuji sebagai janji ──────────────────────────────────
# Layar menjanjikan median yang DITAMPILKAN itulah yang disinkron jadi acuan
# saat Laporan Harga. Sebelum perbaikan keduanya beda: satu memakai kolam
# bertebakan, satu tidak.
MED210=$(echo "$RH210B" | jq -r '.harga_median')
ROW210=$(api "$OWNER" GET "/pembelian?per_page=500" | jq -r --arg f "$F210A" '[.rows[]|select(.faktur_id==$f)][0].id')
api "$OWNER" POST "/pembelian/laporan-harga/$F210A" "{\"items\":[{\"id\":\"$ROW210\",\"total_harga\":200000}]}" > /dev/null
cek "JANJI LAYAR: acuan sesudah Laporan Harga = median yang ditampilkan" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$B210" --argjson m "$MED210" '([.[]|select(.id==$id)][0].harga_beli|round)==($m|round)|if . then 1 else 0 end')"

# ── Perlengkapan tak punya jalur tebakan — statistiknya tak boleh berubah ──
P210=$(api "$OWNER" POST /perlengkapan '{"nama":"Perlengkapan Uji 210","satuan":"pcs","harga_beli":500}' | jq -r .id)
api "$OWNER" POST "/perlengkapan/$P210/masuk" '{"qty":10,"total_harga":10000}' > /dev/null
api "$OWNER" POST "/perlengkapan/$P210/masuk" '{"qty":10,"total_harga":30000}' > /dev/null
cek "perlengkapan: semua lot ditandai BUKAN tebakan & statistiknya utuh" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/$P210/pembelian" | jq '(([.lots[]|select(.harga_tebakan)]|length==0) and (.harga_median==2000) and (.harga_rata==2000) and (.jumlah_harga_nyata==2))|if . then 1 else 0 end')"


echo "== 211. Empat perintah sinkron yang selama ini NOL asersi =="
CK211=$(api "$OWNER" POST /cabang '{"nama":"CK Uji 211","tipe":"central_kitchen"}' | jq -r .id)
ST211=$(api "$OWNER" POST /cabang "{\"nama\":\"Store Uji 211\",\"central_kitchen_id\":\"$CK211\"}" | jq -r .id)
B211=$(api "$OWNER" POST /bahan '{"nama":"Bahan Uji 211","harga_beli":1000,"isi":1,"satuan":"pcs","pengadaan":"beli","track_stok":true}' | jq -r .id)
cek "dasar §211: CK, store, & bahan uji ada" "V == 1" \
  "$(printf '%s%s%s' "$CK211" "$ST211" "$B211" | grep -Eqc '^[0-9a-f-]{108}$' && echo 1 || echo 0)"

uuid211(){ cat /proc/sys/kernel/random/uuid; }
# sinkron satu perintah; REF dipakai ulang pemanggil untuk menguji idempotensi
sync211(){ # sync211 <ref> <tipe> <payload-json> → hasil[0]
  api "$OWNER" POST /sync "$(jq -nc --arg r "$1" --arg t "$2" \
    --arg w "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson p "$3" \
    '{device_id:"dev211",commands:[{client_ref:$r,tipe:$t,waktu:$w,payload:$p}]}')" | jq -c '.hasil[0]'
}
saldo211(){ api "$OWNER" GET "/stok?branch_id=$1" | jq --arg i "$B211" '[.[]|select(.ingredient_id==$i)][0].saldo // 0'; }
kirim211(){ # kirim211 <qty> → faktur_id di status 'menunggu' (siap berangkat)
  local F
  F=$(api "$OWNER" POST /pembelian/faktur \
    "{\"branch_id\":\"$CK211\",\"tujuan_branch_id\":\"$ST211\",\"items\":[{\"ingredient_id\":\"$B211\",\"mode\":\"pcs\",\"jumlah\":$1,\"total_harga\":$(( $1 * 1000 ))}]}" | jq -r .faktur_id)
  api "$OWNER" POST "/pembelian/tahap/$F" '{"ke":"dikerjakan"}' > /dev/null
  api "$OWNER" POST "/pembelian/tahap/$F" '{"ke":"menunggu"}' > /dev/null
  echo "$F"
}

# ── 1. faktur_kirim ────────────────────────────────────────────────────────
F211=$(kirim211 20)
H211=$(sync211 "$(uuid211)" faktur_kirim "$(jq -nc --arg f "$F211" '{jalur:"pembelian",faktur_id:$f}')")
cek "faktur_kirim: perintah diterima" "V == 1" \
  "$(echo "$H211" | jq '(.status=="ok" and (.data.jumlah_baris//0)==1)|if . then 1 else 0 end')"
cek "faktur_kirim: kirimannya MUNCUL di Penerimaan cabang tujuan (menunggu)" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$ST211" | jq --arg f "$F211" '[.rows[]|select(.faktur_id==$f and .status=="menunggu")]|length')"
cek "faktur_kirim: stok tujuan BELUM bertambah (pindah saat diterima)" "V == 0" "$(saldo211 "$ST211")"

# ── 2. penerimaan_terima_sebagian ──────────────────────────────────────────
ROW211=$(api "$OWNER" GET "/penerimaan?branch_id=$ST211" | jq -r --arg f "$F211" '[.rows[]|select(.faktur_id==$f)][0].id')
REF211=$(uuid211)
sync211 "$REF211" penerimaan_terima_sebagian "$(jq -nc --arg f "$F211" --arg id "$ROW211" '{faktur_id:$f,items:[{id:$id,qty_diterima:12}]}')" > /dev/null
cek "terima_sebagian: stok tujuan bertambah SEBANYAK YANG DITERIMA (12 dari 20)" "V == 12" \
  "$(saldo211 "$ST211")"
cek "terima_sebagian: qty_dipesan 20 tersimpan (jejak barang kurang)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$ST211&per_page=500" | jq --arg f "$F211" '[.rows[]|select(.faktur_id==$f and .qty_dipesan==20 and .qty==12)]|length')"
# ── INTI ANTREAN OFFLINE: respons yang HILANG lalu dikirim ulang ──────────
# Perangkat yang kehilangan respons di jalan akan mengirim ulang perintah yang
# SUDAH berhasil. Jawabannya harus "sudah beres", bukan "gagal" — antrean klien
# menandai yang gagal sebagai mati dan tak pernah mencobanya lagi, jadi
# penerimaan yang sungguhan terjadi hilang dari pandangan penggunanya.
#
# ASERSI INI SEMPAT TIDAK BISA GAGAL, dan itu layak dicatat. Bentuk pertamanya
# hanya memeriksa "stok tak bertambah dua kali" — padahal itu sudah dijaga
# status barisnya sendiri ('menunggu' → 'dikonfirmasi'), sehingga ia tetap
# hijau bahkan seandainya klaim client_ref dicabut seluruhnya. Yang
# membuktikan mekanismenya justru SELISIH dua jawaban di bawah.
ULANG211=$(sync211 "$REF211" penerimaan_terima_sebagian "$(jq -nc --arg f "$F211" --arg id "$ROW211" '{faktur_id:$f,items:[{id:$id,qty_diterima:12}]}')")
cek "INTI: ulang dgn ref SAMA → 'sudah_ada' 200, klien tahu penerimaannya beres" "V == 1" \
  "$(echo "$ULANG211" | jq '(.status=="sudah_ada" and .kode==200 and (.data.ok==true))|if . then 1 else 0 end')"
BEDA211=$(sync211 "$(uuid211)" penerimaan_terima_sebagian "$(jq -nc --arg f "$F211" --arg id "$ROW211" '{faktur_id:$f,items:[{id:$id,qty_diterima:12}]}')")
cek "PEMBANDING: ref BEDA → gagal 404 — jadi yang menjawab memang klaim ref-nya" "V == 1" \
  "$(echo "$BEDA211" | jq '(.status=="gagal" and .kode==404)|if . then 1 else 0 end')"
cek "…dan sesudah dua pengulangan itu stok tetap sekali tambah" "V == 12" \
  "$(saldo211 "$ST211")"

# ── 3. penerimaan_tolak ────────────────────────────────────────────────────
F211B=$(kirim211 7)
sync211 "$(uuid211)" faktur_kirim "$(jq -nc --arg f "$F211B" '{jalur:"pembelian",faktur_id:$f}')" > /dev/null
sync211 "$(uuid211)" penerimaan_tolak "$(jq -nc --arg f "$F211B" '{faktur_id:$f,alasan:"barang rusak di jalan"}')" > /dev/null
cek "tolak: status 'ditolak' + alasannya tersimpan" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$ST211&per_page=500" | jq --arg f "$F211B" '[.rows[]|select(.faktur_id==$f and .status=="ditolak" and .alasan_tolak=="barang rusak di jalan")]|length')"
cek "tolak: stok tujuan TIDAK bertambah (tetap 12)" "V == 12" "$(saldo211 "$ST211")"

# ── 4. produksi_kirim_hasil ────────────────────────────────────────────────
MEN211=$(api "$OWNER" POST /bahan '{"nama":"Mentah Uji 211","harga_beli":500,"isi":1,"satuan":"gr","pengadaan":"beli","track_stok":true}' | jq -r .id)
JADI211=$(api "$OWNER" POST /bahan '{"nama":"Jadi Uji 211","harga_beli":0,"isi":10,"satuan":"pcs","pengadaan":"produksi","track_stok":true}' | jq -r .id)
api "$OWNER" PUT "/bahan/$JADI211/resep" "{\"komponen\":[{\"ingredient_id\":\"$MEN211\",\"qty\":5}]}" > /dev/null
KAT211=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
MENU211=$(api "$OWNER" POST /menu "{\"nama\":\"Menu Uji 211\",\"category_id\":\"$KAT211\",\"harga_jual\":15000,\"mult\":2,\"komponen\":[{\"ingredient_id\":\"$JADI211\",\"qty\":1}]}" | jq -r .id)
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$CK211\",\"items\":[{\"ingredient_id\":\"$MEN211\",\"qty\":5000},{\"ingredient_id\":\"$JADI211\",\"qty\":0}]}" > /dev/null
api "$OWNER" POST /stok/awal "{\"branch_id\":\"$ST211\",\"items\":[{\"ingredient_id\":\"$JADI211\",\"qty\":0}]}" > /dev/null
# `untuk_branch_id` HANYA lahir dari jalur permintaan tambah stok — faktur
# produksi biasa mengabaikan field itu, dan kirim-hasil menolak 400.
PF211=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU211\",\"porsi\":20}],\"tujuan_branch_id\":\"$ST211\",\"ck_branch_id\":\"$CK211\"}" | jq -r '.produksi.faktur_id')
api "$OWNER" POST "/produksi/tahap/$PF211" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/produksi/tahap/$PF211" '{"ke":"menunggu"}' > /dev/null
cek "dasar §211: work-order selesai & menunggu dikirim (untuk_branch_id terisi)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK211&per_page=500" | jq --arg f "$PF211" --arg b "$ST211" '([.rows[]|select(.faktur_id==$f)]|(length>0) and all(.[]; .untuk_branch_id==$b and .status=="dikonfirmasi"))|if . then 1 else 0 end')"
KH211=$(sync211 "$(uuid211)" produksi_kirim_hasil "$(jq -nc --arg f "$PF211" '{faktur_id:$f}')")
cek "kirim_hasil: perintah diterima & melahirkan faktur kiriman bernomor" "V == 1" \
  "$(echo "$KH211" | jq '(.status=="ok" and (.data.faktur_id!=null) and ((.data.nomor//"")|test("^PR-[0-9]{4,}$")))|if . then 1 else 0 end')"
KHF211=$(echo "$KH211" | jq -r '.data.faktur_id')
cek "kirim_hasil: kiriman muncul di Penerimaan cabang peminta" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$ST211" | jq --arg f "$KHF211" '[.rows[]|select(.faktur_id==$f and .status=="menunggu")]|length')"
cek "kirim_hasil: pengingat untuk_branch_id di sumbernya DIKOSONGKAN" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK211&per_page=500" | jq --arg f "$PF211" '([.rows[]|select(.faktur_id==$f)]|(length>0) and all(.[]; .untuk_branch_id==null))|if . then 1 else 0 end')"

# ── PASANGAN: penjaga param jalur sub-request internal masih hidup ─────────
# `faktur_id` di-interpolasi ke URL sub-request internal. Tanpa penjaga UUID,
# nilai ber-`/` atau `..` bisa mengubah jalur yang dituju.
cek "PASANGAN: faktur_id bukan UUID → ditolak 400, bukan dijalankan" "V == 1" \
  "$(sync211 "$(uuid211)" penerimaan_tolak '{"faktur_id":"../../shift/buka"}' | jq '(.status=="gagal" and .kode==400)|if . then 1 else 0 end')"
cek "PASANGAN: jalur di luar produksi/pembelian → ditolak 400" "V == 1" \
  "$(sync211 "$(uuid211)" faktur_kirim "$(jq -nc --arg f "$F211" '{jalur:"../admin",faktur_id:$f}')" | jq '(.status=="gagal" and .kode==400)|if . then 1 else 0 end')"


echo
# §212 — LARANGAN BERTINDIH TAK BISA DITITIPKAN KE INDEKS.
#
# Aturannya "rentang tanggal bertindih", bukan "kolom sama", jadi tak ada indeks
# unik yang bisa menegakkannya; dan barisnya belum ada saat diperiksa, jadi tak
# ada apa pun untuk dipegang `FOR UPDATE`. Sebelum perbaikan, periksa-lalu-tulis
# berdiri tanpa kunci sama sekali.
#
# Terukur pada kode lama: 24 permintaan serentak dari satu kasir, lima ronde —
# DUA ronde meninggalkan dua baris hidup yang bertindih. Ketukan ganda di ponsel
# dan kiriman ulang antrean offline persis sebentuk itu.
#
# Akibatnya di hilir bukan sekadar baris kembar: `absensi/routes.ts` menyusun
# rekap lewat `petaIzin.set("<user>|<tanggal>", …)` atas kueri TANPA ORDER BY,
# jadi dari dua baris yang bertindih yang menang cuma yang kebetulan terbaca
# belakangan — satu tanggal bisa terbaca "Sakit" hari ini dan "Cuti Tahunan"
# besok tanpa ada yang mengubah data.
#
# Idiomnya sama dengan §185: yang diuji INVARIANNYA (berapa baris hidup),
# bukan kode statusnya — sebaran 201/409 di antara 8 permintaan memang
# bergantung timing dan akan membuat uji ini goyah.
echo "── §212 dua pengajuan cuti berpapasan → hanya SATU yang hidup ──"
CB212=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
buatKar212(){ # <label> → token
  local e="cuti212$1.$RANDOM@basooopa.id"
  api "$OWNER" POST /karyawan "{\"nama\":\"Cuti 212$1\",\"email\":\"$e\",\"password\":\"Cuti212Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB212\"}" > /dev/null
  login "$e" "Cuti212Pass!"
}
KA212=$(buatKar212 A)
KB212=$(buatKar212 B)
cek "dasar §212: dua karyawan uji bisa login" "V == 1" \
  "$([ -n "$KA212" ] && [ -n "$KB212" ] && echo 1 || echo 0)"

hidup212(){ # hidup212 <token> <dari> <sampai> → jumlah baris HIDUP yang bertindih
  # `// error(...)` supaya respons yang BUKAN larik (mis. galat) tak terbaca 0.
  # Nol yang palsu membuat asersi di bawah merah karena alasan yang salah, dan
  # itu jenis kegagalan yang paling mahal dibaca orang.
  api "$1" GET "/pengajuan?saya=1&dari=$2&sampai=$3" \
    | jq 'if type=="array" then [.[]|select(.status=="menunggu" or .status=="disetujui")]|length
          else error("GET /pengajuan bukan larik: \(.)") end'
}

# LIMA LEDAKAN, bukan satu — dan angkanya DIUKUR, bukan ditebak.
# Balapan ini probabilistik. Terhadap kode tanpa kunci: satu ledakan 8
# permintaan menangkapnya 3 dari 5 kali, tiga ledakan 4 dari 5. Penjaga yang
# meleset seperlima waktu mengajari orang mengabaikannya, jadi rentangnya
# dijadikan lima. Ongkosnya 40 permintaan — sepele bagi suite ini.
TOT212=0
T212=$(mktemp -d)
for bln in 03 04 05 06 07; do
  BODY212="{\"kategori\":\"tahunan\",\"tanggal_mulai\":\"2027-$bln-10\",\"tanggal_selesai\":\"2027-$bln-12\",\"alasan\":\"berpapasan\"}"
  for i in $(seq 1 8); do
    curl -s -o "$T212/b$bln-$i" -X POST "$BASE/api/pengajuan" \
      -H "Authorization: Bearer $KA212" -H 'Content-Type: application/json' -d "$BODY212" &
  done
  wait
  N212=$(hidup212 "$KA212" "2027-$bln-10" "2027-$bln-12")
  # Hitungan yang gagal jangan menjelma jadi galat sintaks shell — ia harus
  # muncul sebagai angka mustahil yang menuding rentangnya.
  case "$N212" in (''|*[!0-9]*) gagal "§212: hitung baris hidup 2027-$bln gagal (jawaban: '$N212')"; N212=99 ;; esac
  TOT212=$(( TOT212 + N212 ))
done
cek "INTI: 5×8 pengajuan berpapasan → tepat SATU baris hidup per rentang" "V == 5" "$TOT212"
cek "…dan setidaknya SATU benar-benar berhasil per rentang (bukan semua ditolak)" "V >= 5" \
  "$(jq -s '[.[]|select(.id != null)]|length' "$T212"/b*)"

# PASANGAN 1: kuncinya tak boleh membekukan tanggal yang memang tak bertindih.
cek "PASANGAN: tanggal LAIN yang tak bertindih tetap boleh → 201" "V == 201" \
  "$(status_code_body "$KA212" POST /pengajuan '{"kategori":"tahunan","tanggal_mulai":"2027-09-10","tanggal_selesai":"2027-09-12"}')"

# PASANGAN 2: kuncinya PER ORANG. Kunci se-perusahaan akan membuat pengajuan
# karyawan lain ikut mengantre — benar hasilnya, tapi salah ongkosnya, dan
# tanggal yang sama untuk dua orang memang sah.
T212B=$(mktemp -d)
for tok in "$KA212" "$KB212"; do
  curl -s -o "$T212B/$(echo "$tok" | tail -c 12)" -X POST "$BASE/api/pengajuan" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
    -d '{"kategori":"tahunan","tanggal_mulai":"2027-11-10","tanggal_selesai":"2027-11-12"}' &
done
wait
cek "PASANGAN: DUA ORANG berbeda pada tanggal sama → dua-duanya sah" "V == 2" \
  "$(python3 -c "print($(hidup212 "$KA212" 2027-11-10 2027-11-12) + $(hidup212 "$KB212" 2027-11-10 2027-11-12))")"


echo "== 213. Balapan pembuatan: yang kalah dapat 409 berpesan, bukan 500 =="
# Pra-cek "sudah terdaftar?" selalu punya jeda sebelum tulisannya. Yang
# benar-benar menjaga keunikan adalah INDEKSNYA — dan tanpa terjemahan, yang
# KALAH balapan menerima 23505 mentah alias 500. Satu situasi, tiga jawaban
# berbeda tergantung timing (terukur: 201, 409, dan 500 pada tiga permintaan
# serentak beremail sama).
#
# 500 bukan cuma pesan yang salah: ia tercatat sebagai galat SERVER di panel,
# dan di web memicu overlay "server sedang diperbarui" — aplikasi terlihat
# tumbang gara-gara dua admin menambahkan karyawan yang sama.
CB213=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')

balap213(){ # balap213 <n> <token> <path> <body> → direktori berisi c* (kode) & b* (badan)
  local n="$1" t="$2" path="$3" body="$4" d i
  d=$(mktemp -d)
  for i in $(seq 1 "$n"); do
    # `\n` WAJIB: `%{http_code}` tak meninggalkan newline penutup, jadi `cat`
    # atas beberapa berkas MENYAMBUNG kodenya jadi satu baris ("409409201409")
    # — dan penghitung `grep -c '^5'` di bawah lalu buta terhadap 5xx yang tak
    # kebetulan berdiri paling depan. Perangkap yang sama sudah tercatat di
    # repo ini, dan ia tetap menggigit sekali lagi saat seksi ini ditulis.
    curl -s -o "$d/b$i" -w '%{http_code}\n' -X POST "$BASE/api$path" \
      -H "Authorization: Bearer $t" -H 'Content-Type: application/json' -d "$body" > "$d/c$i" &
  done
  wait
  echo "$d"
}
lima213(){ cat "$1"/c* | grep -c '^5' || true; }   # berapa jawaban 5xx
kode213(){ cat "$1"/c* | grep -c "^$2" || true; }  # berapa jawaban berawalan <2>

# balapUlang213 — BEBERAPA burst, tiap burst bernama beda. Kenapa perlu, dan
# kenapa satu burst tidak cukup:
#
# Balapan adalah detektor PROBABILISTIK. Ia hanya menuduh bila dua permintaan
# kebetulan berpapasan tepat di dalam jendela antara pra-cek dan tulisannya,
# dan lebar jendela itu berbeda tiap endpoint — makin banyak kerja sebelum
# INSERT, makin sempit peluangnya. Asersi yang "pernah merah sekali" karena
# itu belum tentu asersi yang menjaga: di CI ia ditembak SEKALI.
#
# Jadi kekuatannya DIUKUR, bukan ditebak. Bug-nya disuntikkan kembali lalu
# tiap bentuk dijalankan 8 ronde (server & basis data segar):
#
#   /bahan          1 burst × 4 serentak → 8/8 … tapi 5/6 pada pengukuran lain
#   /perlengkapan   1 burst × 4 serentak → 5/8   ← LOLOS tiga dari delapan kali
#   /bahan          3 burst × 6 serentak → 8/8
#   /perlengkapan   3 burst × 6 serentak → 8/8
#
# Angka 5/8 itu bukan hipotesis: bentuk 1×4 memang MELOLOSKAN bug yang sudah
# terbukti ada — persis yang terjadi saat seksi ini pertama dijalankan, semua
# asersi /bahan hijau di atas kode yang cacat.
# `awalan` disambung TANPA pemisah — pemanggil yang menentukan. Nama bahan
# mau spasi ("Balap Bahan 213 "), tapi alamat surel tidak boleh punya satu pun.
balapUlang213(){ # balapUlang213 <ronde> <n> <token> <path> <tmpl ber-%NAMA%> <awalan>
  local ronde="$1" n="$2" t="$3" path="$4" tmpl="$5" awalan="$6" d r i nm
  d=$(mktemp -d)
  for r in $(seq 1 "$ronde"); do
    nm="$awalan$RANDOM$RANDOM"
    printf '%s\n' "$nm" >> "$d/nama"
    for i in $(seq 1 "$n"); do
      curl -s -o "$d/b$r-$i" -w '%{http_code}\n' -X POST "$BASE/api$path" \
        -H "Authorization: Bearer $t" -H 'Content-Type: application/json' \
        -d "${tmpl//%NAMA%/$nm}" > "$d/c$r-$i" &
    done
    wait
  done
  echo "$d"
}

# ── POST /karyawan (users_email_unique) ────────────────────────────────────
E213="balap213.$RANDOM@basooopa.id"
D213=$(balap213 4 "$OWNER" /karyawan \
  "{\"nama\":\"Balap 213\",\"email\":\"$E213\",\"password\":\"Balap213Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB213\"}")
cek "INTI: 4 pembuatan karyawan beremail sama → TAK ADA 5xx" "V == 0" "$(lima213 "$D213")"
cek "…tepat SATU yang lahir (201), sisanya 409" "V == 1" "$(kode213 "$D213" 201)"
cek "…dan hanya satu baris karyawan beremail itu" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq --arg e "$E213" '[.[]|select(.email==$e)]|length')"
cek "…pesan penolakannya sama dgn jalur berurutan (bukan pesan generik)" "V == 1" \
  "$(cat "$D213"/b* | jq -s --arg e "$E213" '[.[]|select(.error != null)]|all(.[]; .error | test("sudah terdaftar"))|if . then 1 else 0 end')"

# ── POST /karyawan/undang (invitations_company_email_pending_uq) ───────────
# Diukur atas bug yang disuntikkan kembali: 1 burst × 4 hanya menuduh 6/8
# ronde — dua dari delapan kali ia meloloskan bug yang sudah terbukti ada.
# 3 burst × 4 → 8/8. (Menaikkan serentaknya justru MEMPERBURUK: 1 × 6 → 3/8;
# lihat catatan pada `balapUlang213` tentang kenapa.)
DU213=$(balapUlang213 3 4 "$OWNER" /karyawan/undang \
  '{"email":"undang213.%NAMA%@basooopa.id","role":"cashier","branch_id":"'"$CB213"'"}' "u")
cek "INTI: 3×4 undangan beremail sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DU213")"
cek "…tepat SATU undangan lahir per email (3 × 201)" "V == 3" "$(kode213 "$DU213" 201)"

# ── POST /admin/tenants (companies_slug_unique + users_email_unique) ───────
T213="tenant213.$RANDOM@contoh.id"
DT213=$(balap213 3 "$SA" /admin/tenants \
  "{\"nama\":\"Warung 213 $RANDOM\",\"owner_nama\":\"O\",\"owner_email\":\"$T213\",\"owner_password\":\"Balap213Pass!\",\"cabang_nama\":\"Pusat\"}")
cek "INTI: 3 pembuatan tenant kembar → TAK ADA 5xx" "V == 0" "$(lima213 "$DT213")"
cek "…tepat SATU tenant lahir" "V == 1" "$(kode213 "$DT213" 201)"

# ── POST /auth/register — DI SINI 409 JUSTRU SALAH ─────────────────────────
# Endpoint ini sengaja membalas NETRAL & IDENTIK untuk email baru maupun yang
# sudah terdaftar, supaya tak ada cara menebak akun mana yang ada. Membalas 409
# pada jalur balapan akan membuka kembali celah enumerasi itu: penyerang cukup
# mengirim dua permintaan sekaligus lalu membaca bedanya. Yang benar: balapan
# yang kalah diperlakukan seperti "ternyata sudah ada" — jawaban yang sama.
#
# BATAS YANG DIAKUI, karena yang di atasnya tidak bisa dipakai di sini.
# Diukur atas bug yang disuntikkan kembali, 8 ronde masing-masing:
#
#   1 burst × 3  → 7/8   ← yang dipakai; satu dari delapan kali ia meleset
#   1 burst × 6  → 0/8   ← lebih serentak justru BUTA TOTAL
#   3 burst × 3  → 0/8   ← begitu pula menambah burst
#
# Dua sebab, dan keduanya membuat jalur ini TAK BISA dikuatkan seperti yang
# lain. Pertama, `/auth/register` menjalankan bcrypt — mahal dan terikat CPU,
# jadi permintaan yang menumpuk malah BERBARIS, dan yang kedua baru menulis
# setelah yang pertama commit: jendela balapannya tertutup sendiri. Kedua,
# endpoint ini berkuota 20 per IP per jam, dan skrip ini sudah memakai hampir
# semuanya — angka 0/8 di atas justru terukur saat kuotanya HABIS dan semua
# jawaban jadi 429 (itulah asal-usul penjaga kuota pada `daftar_verif`).
#
# Jadi 7/8 dicatat apa adanya, bukan dibulatkan jadi "dijaga". Yang membuatnya
# tetap berguna: tiga asersi di bawah menuduh dari tiga arah berbeda atas
# balapan yang SAMA, dan asersi anti-enumerasi ("pesannya identik") juga akan
# merah bila kuota habis — bukan hijau.
R213="daftar213.$RANDOM@contoh.id"
DR213=$(balap213 3 "" /auth/register "{\"nama\":\"Daftar 213\",\"email\":\"$R213\",\"password\":\"Daftar213Pass!\"}")
cek "INTI: 3 pendaftaran beremail sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DR213")"
cek "INTI: semuanya 200 — tak ada 409 yang membocorkan email mana yang ada" "V == 3" \
  "$(kode213 "$DR213" 200)"
cek "…dan pesannya IDENTIK di ketiganya (kontrak anti-enumerasi)" "V == 1" \
  "$(cat "$DR213"/b* | jq -s '[.[]|.message]|unique|length')"

# ── PASANGAN: jalur BERURUTAN tak berubah perilakunya ──────────────────────
# Terjemahan galat tak boleh menggeser jawaban yang selama ini benar.
cek "PASANGAN: pembuatan berurutan beremail sama tetap 409" "V == 409" \
  "$(status_code_body "$OWNER" POST /karyawan \
     "{\"nama\":\"Balap 213b\",\"email\":\"$E213\",\"password\":\"Balap213Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB213\"}")"
cek "PASANGAN: email BARU tetap boleh dibuat → 201" "V == 201" \
  "$(status_code_body "$OWNER" POST /karyawan \
     "{\"nama\":\"Balap 213c\",\"email\":\"baru213.$RANDOM@basooopa.id\",\"password\":\"Balap213Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB213\"}")"

# ── PINTU KEEMPAT: buat perusahaan sendiri, dua orang bernama usaha SAMA ───
# Ditemukan sapuan mekanis `penjaga-semua-pintu`, bukan mata: tiga pintu di
# atas sudah dibereskan dengan tangan, dan yang ini terlewat.
#
# Di sini jawabannya BEDA dari ketiganya — COBA ULANG, bukan 409. `slugUnik`
# sudah menjanjikan akhiran acak untuk nama yang kembar; menolak justru
# mengingkari janji itu, dan yang menerima penolakannya orang yang BARU
# MENDAFTAR, pada tindakan pertamanya. "Warung Makan" bukan nama yang jarang.
# Terukur sebelum perbaikan: 201, 500, 500.
NAMA213="Warung Kembar 213 $RANDOM"
D4_213=$(mktemp -d)
for i in 1 2 3; do
  T=$(daftar_verif "usaha213.$i.$RANDOM@contoh.id" "Usaha213Pass!" "Usaha 213")
  printf '%s' "$T" > "$D4_213/t$i"
done
cek "dasar §213: tiga akun baru siap membuat usaha" "V == 3" \
  "$(grep -lc . "$D4_213"/t1 "$D4_213"/t2 "$D4_213"/t3 2>/dev/null | wc -l)"
for i in 1 2 3; do
  curl -s -o "$D4_213/b$i" -w '%{http_code}\n' -X POST "$BASE/api/onboarding/perusahaan" \
    -H "Authorization: Bearer $(cat "$D4_213/t$i")" -H 'Content-Type: application/json' \
    -d "{\"nama\":\"$NAMA213\"}" > "$D4_213/c$i" &
done
wait
cek "INTI: tiga usaha BERNAMA SAMA dibuat serentak → TAK ADA 5xx" "V == 0" \
  "$(cat "$D4_213"/c* | grep -c '^5' || true)"
cek "INTI: ketiganya jadi (201) — nama kembar memang boleh" "V == 3" \
  "$(cat "$D4_213"/c* | grep -c '^201' || true)"
cek "…dan slugnya dibedakan otomatis, bukan ditolak" "V == 3" \
  "$(api "$SA" GET /admin/tenants | jq --arg n "$NAMA213" '[.[]|select(.nama==$n)]|map(.slug)|unique|length')"

# ── PINTU KELIMA & KEENAM: master data yang PALING SERING diketik ──────────
# Keduanya lolos dari sapuan mekanis versi pertama — daftar tabelnya baru
# memuat `users|invitations|companies`. Yang menemukannya: menembak KESEPULUH
# endpoint pembuatan bernama unik sekaligus dan membaca kolom 5xx-nya.
# Terukur sebelum perbaikan, empat permintaan serentak bernama sama:
#   /perlengkapan → 201 409 409 500
#   /bahan        → 201 409 409 500
TB213='{"nama":"%NAMA%","satuan":"pcs","isi":1,"harga_beli":1000,"pengadaan":"beli","kategori":"lain"}'
DB213=$(balapUlang213 3 6 "$OWNER" /bahan "$TB213" "Balap Bahan 213 ")
cek "INTI: 3×6 pembuatan bahan bernama sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DB213")"
cek "…tepat SATU bahan lahir per nama (3 × 201), sisanya 409" "V == 3" "$(kode213 "$DB213" 201)"
# Jumlah baris untuk KETIGA nama yang diperebutkan. Ditulis sebagai gelung,
# bukan satu jq pintar: baris jq yang tak pernah dijalankan atas data tiruan
# adalah cara paling mudah membuat asersi yang selalu hijau.
barisPerNama213(){ # barisPerNama213 <path> <berkas-nama> → total baris
  local path="$1" jml=0 n
  local semua; semua=$(api "$OWNER" GET "$path")
  while IFS= read -r n; do
    jml=$((jml + $(printf '%s' "$semua" | jq --arg n "$n" '[.[]|select(.nama==$n)]|length')))
  done < "$2"
  echo "$jml"
}
cek "…dan hanya satu baris untuk tiap nama yang diperebutkan" "V == 3" \
  "$(barisPerNama213 /bahan "$DB213/nama")"

TP213='{"nama":"%NAMA%","satuan":"pcs","harga_beli":500}'
DP213=$(balapUlang213 3 6 "$OWNER" /perlengkapan "$TP213" "Balap Perlengkapan 213 ")
cek "INTI: 3×6 pembuatan perlengkapan bernama sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DP213")"
cek "…tepat SATU perlengkapan lahir per nama (3 × 201)" "V == 3" "$(kode213 "$DP213" 201)"

# PASANGAN: penolakannya tak boleh menelan yang SAH. Nama baru tetap 201, dan
# nama kembar tetap ditolak 409 lewat jalur berurutan — bukan cuma di balapan.
NB213=$(head -1 "$DB213/nama")
cek "PASANGAN: bahan bernama BARU tetap 201" "V == 201" \
  "$(status_code_body "$OWNER" POST /bahan "${TB213//%NAMA%/Baru 213 $RANDOM}")"
cek "PASANGAN: bahan bernama sama berurutan tetap 409" "V == 409" \
  "$(status_code_body "$OWNER" POST /bahan "${TB213//%NAMA%/$NB213}")"
cek "PASANGAN: perlengkapan bernama BARU tetap 201" "V == 201" \
  "$(status_code_body "$OWNER" POST /perlengkapan "${TP213//%NAMA%/Baru 213 $RANDOM}")"

# ── PINTU KETUJUH: IMPOR MASSAL — di sini 409 pun jawaban yang SALAH ───────
# `slugUnik` di `/bahan/bulk` bukan pemeriksa melainkan PENGALOKASI: ia membaca
# slug yang terpakai lalu memilih yang berikutnya bebas. Empat impor serentak
# bernama sama SEHARUSNYA menghasilkan empat bahan — "x", "x 2", "x 3", "x 4".
# Yang terjadi sebelum perbaikan: 201, 201, 500, 500 — di TIGA ronde berturut,
# jadi dua impor yang sah gagal seluruhnya. Ini bukan kode status yang salah,
# ini pekerjaan yang hilang.
TBK213='{"items":[{"nama":"%NAMA%","satuan":"pcs","isi":1,"harga_beli":1000,
  "track_stok":true,"stok_minimum":0,"kategori":"lain","boleh_eceran":false,
  "min_beli":1,"masa_simpan_hari":0,"lead_time_hari":0,"is_packaging":false,
  "is_complement":false}]}'
DBK213=$(balapUlang213 3 4 "$OWNER" /bahan/bulk "$TBK213" "Balap Bulk 213 ")
cek "INTI: 3×4 impor massal bernama sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DBK213")"
cek "INTI: SEMUANYA jadi (12 × 201) — pengalokasi tak boleh menolak" "V == 12" \
  "$(kode213 "$DBK213" 201)"
cek "…12 baris lahir (4 per nama), slugnya dibedakan otomatis" "V == 12" \
  "$(barisPerNama213 /bahan "$DBK213/nama")"
# Dicocokkan ke nama RONDE INI, bukan ke awalan "Balap Bulk 213 ": versi
# berawalan menghitung 24 saat skrip ini dijalankan dua kali atas basis data
# yang sama — hijau/merahnya jadi bergantung pada riwayat basis data, bukan
# pada perilaku kode. (Terjadi sungguhan saat seksi ini ditulis.)
slugBedaPerNama213(){ # slugBedaPerNama213 <path> <berkas-nama> → total slug unik
  local path="$1" jml=0 n semua
  semua=$(api "$OWNER" GET "$path")
  while IFS= read -r n; do
    jml=$((jml + $(printf '%s' "$semua" | jq --arg n "$n" '[.[]|select(.nama==$n)]|map(.slug)|unique|length')))
  done < "$2"
  echo "$jml"
}
cek "…dan tiap slug memang BERBEDA, bukan 12 baris berslug sama" "V == 12" \
  "$(slugBedaPerNama213 /bahan "$DBK213/nama")"

# ── PINTU KEDELAPAN: IMPOR CSV — pintu yang gagalnya TAK BERWARNA MERAH ────
# `/bahan/import` melaporkan kegagalan PER BARIS lalu membalas 200, jadi
# balapannya tak pernah muncul sebagai 5xx dan tak satu pun asersi "TAK ADA
# 5xx" bisa melihatnya. Yang keluar sebelum perbaikan: satu entri `gagal`
# berisi `(e as Error).message` MENTAH dari driver — seluruh teks kueri INSERT
# beserta daftar kolomnya, dikirim apa adanya ke klien.
#
# Karena itu yang diperiksa di sini BUKAN kode statusnya melainkan cacahnya:
# berurutan, empat impor "tambah" bernama sama menghasilkan 1 ditambah +
# 3 dilewati dan NOL gagal. Sebelum perbaikan, sebagian dari yang 3 itu jatuh
# ke `gagal`.
jmlField213(){ # jmlField213 <dir> <field> → jumlah field itu di semua badan
  jq -s --arg f "$2" '[.[][$f] // 0]|add' "$1"/b* 2>/dev/null || echo 99
}
TIM213='{"mode":"tambah","items":[{"nama":"%NAMA%","harga_beli":7777}]}'
DIM213=$(balapUlang213 3 4 "$OWNER" /bahan/import "$TIM213" "Impor 213 ")
cek "INTI: 3×4 impor CSV bernama sama → NOL baris gagal" "V == 0" \
  "$(jq -s '[.[].gagal[]?]|length' "$DIM213"/b* 2>/dev/null || echo 99)"
cek "…tepat satu bahan lahir per nama (3 ditambah)" "V == 3" "$(jmlField213 "$DIM213" ditambah)"
cek "…sisanya DILEWATI, bukan hilang (9 dilewati)" "V == 9" "$(jmlField213 "$DIM213" dilewati)"
cek "…dan hanya satu baris tersimpan per nama" "V == 3" \
  "$(barisPerNama213 /bahan "$DIM213/nama")"

# PASANGAN: mode "perbarui" harus benar-benar MENERAPKAN nilainya, bukan cuma
# tak-gagal. Tanpa ini, "0 gagal" juga tercapai dengan membuang baris diam-diam.
NPB213="Impor Perbarui 213 $RANDOM"
BPB213="{\"mode\":\"perbarui\",\"items\":[{\"nama\":\"$NPB213\",\"harga_beli\":7777}]}"
DPB213=$(mktemp -d)
for i in 1 2 3 4; do
  curl -s -o "$DPB213/b$i" -w '%{http_code}\n' -X POST "$BASE/api/bahan/import" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "$BPB213" > "$DPB213/c$i" &
done
wait
cek "PASANGAN: mode perbarui → nol gagal" "V == 0" \
  "$(jq -s '[.[].gagal[]?]|length' "$DPB213"/b* 2>/dev/null || echo 99)"
cek "PASANGAN: yang kalah MEMPERBARUI, bukan dilewati (1 tambah + 3 perbarui)" "V == 3" \
  "$(jmlField213 "$DPB213" diperbarui)"
cek "PASANGAN: harga dari CSV benar-benar tersimpan" "V == 7777" \
  "$(api "$OWNER" GET /bahan | jq -r --arg n "$NPB213" '[.[]|select(.nama==$n)][0].harga_beli // 0')"


echo "== 214. Perusahaan tak boleh kehilangan owner TERAKHIRNYA =="
# Penjaganya sudah ada dan tertulis niatnya — "Perusahaan tidak boleh kehilangan
# owner terakhir yang masih berjalan" — tapi ia memeriksa DI LUAR transaksi,
# tanpa kunci, dan hanya melihat satu dari dua pintu.
#
# Perusahaan tanpa owner terkunci dari seluruh fungsi ber-`requireRole("owner")`,
# TERMASUK mengangkat owner baru. Tak ada jalan keluar dari dalam aplikasi;
# hanya super admin yang bisa memulihkannya.
P214='Owner214Pass!'
buatDuaOwner214(){ # buatDuaOwner214 <label> → "T1 T2 U1 U2 CID"
  local e1="o214a.$1.$RANDOM@contoh.id" e2="o214b.$1.$RANDOM@contoh.id" t1 t2 u1 u2
  api "$SA" POST /admin/tenants \
    "{\"nama\":\"Warung 214 $1 $RANDOM\",\"owner_nama\":\"O1\",\"owner_email\":\"$e1\",\"owner_password\":\"$P214\",\"cabang_nama\":\"Pusat\"}" > /dev/null
  t1=$(login "$e1" "$P214")
  api "$t1" POST /karyawan "{\"nama\":\"O2\",\"email\":\"$e2\",\"password\":\"$P214\",\"role\":\"owner\"}" > /dev/null
  t2=$(login "$e2" "$P214")
  u1=$(api "$t1" GET /auth/me | jq -r '.user.sub')
  u2=$(api "$t1" GET /karyawan | jq -r --arg e "$e2" '[.[]|select(.email==$e)][0].user_id')
  echo "$t1 $t2 $u1 $u2"
}
# Jumlah owner AKTIF dibaca lewat API sebagai owner yang masih hidup — kalau
# keduanya jatuh, tak ada token yang bisa membacanya, dan ITU justru
# kegagalannya: dibaca 0 dan asersinya merah.
ownerAktif214(){ # ownerAktif214 <token-a> <token-b> → jumlah owner aktif
  local n
  n=$(api "$1" GET /karyawan | jq '[.[]|select(.role=="owner")]|length' 2>/dev/null)
  case "$n" in (''|*[!0-9]*) n=$(api "$2" GET /karyawan | jq '[.[]|select(.role=="owner")]|length' 2>/dev/null) ;; esac
  case "$n" in (''|*[!0-9]*) n=0 ;; esac
  echo "$n"
}

# ── PINTU 1: dua owner saling mengarsipkan BERSAMAAN ───────────────────────
# Berurutan jalur ini memang aman (yang kedua dibalas 401 karena sesinya
# dicabut), jadi cacatnya TAK PERNAH terlihat dari uji yang menunggu balasan
# sebelum mengirim berikutnya. Terukur sebelum perbaikan: enam ronde,
# enam-enamnya berakhir NOL owner, kedua permintaan dibalas 200.
read -r TA214 TB214 UA214 UB214 <<< "$(buatDuaOwner214 arsip)"
cek "dasar §214: perusahaan uji punya 2 owner" "V == 2" "$(ownerAktif214 "$TA214" "$TB214")"
D214=$(mktemp -d)
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$BASE/api/karyawan/$UB214" \
  -H "Authorization: Bearer $TA214" -H 'Content-Type: application/json' -d '{"arsip":true}' > "$D214/a" &
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$BASE/api/karyawan/$UA214" \
  -H "Authorization: Bearer $TB214" -H 'Content-Type: application/json' -d '{"arsip":true}' > "$D214/b" &
wait
cek "INTI: dua owner saling arsip BERSAMAAN → tepat SATU yang tersisa" "V == 1" \
  "$(ownerAktif214 "$TA214" "$TB214")"
cek "…dan yang kalah ditolak 400, bukan diloloskan atau 500" "V == 1" \
  "$(cat "$D214"/a "$D214"/b | grep -c '^400' || true)"

# ── PINTU 2: MENURUNKAN PERAN owner terakhir (tanpa balapan sama sekali) ────
# Penjaga lama cuma melihat `arsip`, jadi pintu ini terbuka lebar: owner
# terakhir mengubah perannya sendiri jadi admin → 200, perusahaan tanpa owner.
read -r TC214 TD214 UC214 UD214 <<< "$(buatDuaOwner214 turun)"
cek "PINTU 2: menurunkan owner yang BUKAN terakhir → boleh (200)" "V == 200" \
  "$(status_code_body "$TC214" PATCH "/karyawan/$UD214" '{"role":"admin"}')"
cek "…sisa satu owner" "V == 1" "$(ownerAktif214 "$TC214" "$TC214")"
cek "INTI: menurunkan peran owner TERAKHIR → ditolak 400" "V == 400" \
  "$(status_code_body "$TC214" PATCH "/karyawan/$UC214" '{"role":"admin"}')"
cek "…dan owner terakhirnya masih owner" "V == 1" "$(ownerAktif214 "$TC214" "$TC214")"

# ── PASANGAN: penjaganya tak boleh membekukan suntingan yang wajar ─────────
# Penjaga yang menolak terlalu banyak sama merugikannya: owner terakhir tetap
# harus bisa mengganti namanya sendiri.
cek "PASANGAN: mengubah NAMA owner terakhir tetap boleh (200)" "V == 200" \
  "$(status_code_body "$TC214" PATCH "/karyawan/$UC214" '{"nama":"Owner Ganti Nama"}')"
cek "PASANGAN: owner terakhir tetap ada sesudahnya" "V == 1" "$(ownerAktif214 "$TC214" "$TC214")"

# ── SAUDARANYA: hapus-akun-sendiri lewat jalur onboarding ──────────────────
# Penjaga "Anda owner terakhir" di sana bentuknya sama persis, dan dulu juga
# memeriksa di luar transaksi tanpa kunci.
read -r TE214 TF214 UE214 UF214 <<< "$(buatDuaOwner214 hapus)"
DH214=$(mktemp -d)
for tok in "$TE214" "$TF214"; do
  curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/api/onboarding/akun" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
    -d "{\"password\":\"$P214\"}" > "$DH214/$(echo "$tok" | tail -c 10)" &
done
wait
cek "INTI: dua owner hapus akun BERSAMAAN → tepat SATU yang tersisa" "V == 1" \
  "$(ownerAktif214 "$TE214" "$TF214")"
cek "…dan yang kalah ditolak 400" "V == 1" "$(cat "$DH214"/* | grep -c '^400' || true)"


echo
echo "== 216. Petugas tempat SO ditulis dari DUA arah yang tegak lurus =="
# `storage_location_petugas` diganti seluruhnya dari dua sisi:
#   · PUT /penyimpanan/:id/petugas   → hapus WHERE tempat = L, sisipkan (L, u…)
#   · PUT /karyawan/:userId/tempat   → hapus WHERE user  = U, sisipkan (t…, U)
#
# Keduanya sudah bertransaksi, dan masing-masing benar SENDIRIAN. Yang tak
# dijaga: himpunan baris yang mereka kunci tidak beririsan, jadi tak satu pun
# menahan yang lain — lalu keduanya menyisipkan pasangan (L, U) yang SAMA.
# Terukur sebelum perbaikan, tiga ronde berturut-turut: tempat→200,
# karyawan→500, tiap ronde.
#
# Bahwa pintu saudaranya diketahui penulisnya terlihat dari komentar di
# `users/routes.ts`: "Menulis ke tabel yang sama dengan PUT
# /penyimpanan/:id/petugas → konsisten dua arah." Tahu ada dua pintu tidak
# sama dengan memasang penjaga di keduanya — itu justru bentuk yang dijaga
# `penjaga-semua-pintu.test.ts`, dan pintu inilah yang ditunjuknya.
CB216=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
E216="petugas216.$RANDOM@basooopa.id"
U216=$(api "$OWNER" POST /karyawan \
  "{\"nama\":\"Petugas 216\",\"email\":\"$E216\",\"password\":\"Petugas216Pass!\",\"role\":\"cashier\",\"branch_id\":\"$CB216\"}" \
  | jq -r '.id // .user_id // empty')
L216=$(api "$OWNER" POST /penyimpanan "{\"nama\":\"Rak 216 $RANDOM\",\"branch_id\":\"$CB216\"}" | jq -r .id)
cek "dasar §216: karyawan & tempat uji siap" "V == 2" \
  "$(( $([ -n "$U216" ] && echo 1 || echo 0) + $([ -n "$L216" ] && echo 1 || echo 0) ))"

# Tiga ronde: satu ronde saja meleset sesekali — dua sisi harus benar-benar
# berpapasan di jendela antara hapus dan sisip.
D216=$(mktemp -d)
for r in 1 2 3; do
  curl -s -o "$D216/bA$r" -w '%{http_code}\n' -X PUT "$BASE/api/penyimpanan/$L216/petugas" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d "{\"user_ids\":[\"$U216\"]}" > "$D216/cA$r" &
  curl -s -o "$D216/bB$r" -w '%{http_code}\n' -X PUT "$BASE/api/karyawan/$U216/tempat" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d "{\"tempat_ids\":[\"$L216\"]}" > "$D216/cB$r" &
  wait
done
cek "INTI: menugaskan dari kedua arah serentak → TAK ADA 5xx" "V == 0" \
  "$(cat "$D216"/c* | grep -c '^5' || true)"
cek "…keenam permintaan dibalas 200" "V == 6" "$(cat "$D216"/c* | grep -c '^200' || true)"
# PASANGAN: "tak ada 5xx" juga tercapai kalau penugasannya diam-diam dibuang.
cek "PASANGAN: penugasannya BENAR-BENAR tersimpan (sisi tempat)" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq -r --arg l "$L216" '[.[]|select(.id==$l)][0].petugas|length')"
cek "PASANGAN: dan terbaca sama dari sisi karyawan" "V == 1" \
  "$(api "$OWNER" GET "/karyawan/$U216/tempat" | jq -r '.assigned|length')"

echo "== 217. \"Ganti seluruh daftar\" yang diklik DUA KALI =="
# HAPUS-lalu-SISIP hanya menyerialkan diri sendiri kalau ada yang bisa dipegang
# HAPUS-nya. Saat daftarnya masih KOSONG, ia tak memegang baris apa pun — dua
# permintaan bersamaan sama-sama lolos ke SISIP dan menabrak indeks pasangan.
#
# Yang membuat kelas ini beda dari §213: permintaannya IDEMPOTEN. Badan yang
# sama persis, dikirim dua kali. Yang memicunya di lapangan bukan dua admin,
# cukup SATU KLIK GANDA pada tombol Simpan — dan yang diterima pengguna adalah
# overlay "server sedang diperbarui".
#
# Terukur sebelum perbaikan, empat PUT serentak berbadan sama, tiga ronde
# berturut-turut, identik tiap ronde:
#   PUT /bahan/:id/supplier         200 200 500 500
#   PUT /perlengkapan/:id/supplier  200 200 500 500
#   PUT /penyimpanan/:id/bahan      200 500 500 500
#
# KENAPA DUA JAWABAN BERBEDA untuk kelas yang sama:
#   · `/:id/supplier` punya baris INDUK yang nyata → `FOR UPDATE` per bahan,
#     tak menghalangi bahan lain. Idiom ini sudah dipakai `PUT /bahan/:id/resep`
#     di berkas yang sama — sekali lagi dipasang di satu pintu, bukan saudaranya.
#   · `/penyimpanan/:id/bahan` menegakkan "satu barang di SATU rak", jadi ia
#     ikut menghapus dari rak LAIN. Dua permintaan ke rak BERBEDA tetap
#     berpapasan, dan induk yang mereka bagi cuma perusahaannya → kunci antrean.
#
# Dua PUT yang TIDAK cacat sudah diperiksa juga: `PUT /menu/:id` dan
# `PUT /bahan/:id` (resep) bersih 3/3 ronde — keduanya meng-UPDATE baris induk
# lebih dulu di transaksi yang sama, jadi kunci barisnya menyerialkan mereka
# tanpa sengaja. Itu yang menunjukkan idiom mana yang benar.
S217A=$(api "$OWNER" POST /supplier "{\"nama\":\"Sup 217A $RANDOM\"}" | jq -r .id)
S217B=$(api "$OWNER" POST /supplier "{\"nama\":\"Sup 217B $RANDOM\"}" | jq -r .id)
BH217=$(api "$OWNER" POST /bahan \
  "{\"nama\":\"Bahan 217 $RANDOM\",\"satuan\":\"pcs\",\"isi\":1,\"harga_beli\":1000,\"pengadaan\":\"beli\",\"kategori\":\"lain\"}" | jq -r .id)
PL217=$(api "$OWNER" POST /perlengkapan "{\"nama\":\"Perl 217 $RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":500}" | jq -r .id)
CB217=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
LOC217=$(api "$OWNER" POST /penyimpanan "{\"nama\":\"Rak 217 $RANDOM\",\"branch_id\":\"$CB217\"}" | jq -r .id)
cek "dasar §217: lima objek uji siap" "V == 5" \
  "$(printf '%s\n' "$S217A" "$S217B" "$BH217" "$PL217" "$LOC217" | grep -c '^[0-9a-f-]\{36\}$' || true)"

# `balapUlang213` menembak POST; di sini metodenya PUT dan badannya SAMA di
# tiap tembakan (justru itu intinya), jadi dipakai gelung sendiri.
balapPut217(){ # balapPut217 <ronde> <n> <path> <body> → dir
  local ronde="$1" n="$2" path="$3" body="$4" d r i
  d=$(mktemp -d)
  for r in $(seq 1 "$ronde"); do
    for i in $(seq 1 "$n"); do
      curl -s -o "$d/b$r-$i" -w '%{http_code}\n' -X PUT "$BASE/api$path" \
        -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "$body" > "$d/c$r-$i" &
    done
    wait
  done
  echo "$d"
}
ITEMS217="[{\"supplier_id\":\"$S217A\",\"is_utama\":true},{\"supplier_id\":\"$S217B\",\"is_utama\":false}]"

DBS217=$(balapPut217 2 4 "/bahan/$BH217/supplier" "{\"items\":$ITEMS217}")
cek "INTI: 2×4 PUT /bahan/:id/supplier berbadan sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DBS217")"
cek "…kedelapannya 200" "V == 8" "$(kode213 "$DBS217" 200)"

DPS217=$(balapPut217 2 4 "/perlengkapan/$PL217/supplier" "{\"items\":$ITEMS217}")
cek "INTI: 2×4 PUT /perlengkapan/:id/supplier berbadan sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DPS217")"
cek "…kedelapannya 200" "V == 8" "$(kode213 "$DPS217" 200)"

DRK217=$(balapPut217 2 4 "/penyimpanan/$LOC217/bahan" \
  "{\"ingredient_ids\":[\"$BH217\"],\"supply_ids\":[\"$PL217\"]}")
cek "INTI: 2×4 PUT /penyimpanan/:id/bahan berbadan sama → TAK ADA 5xx" "V == 0" "$(lima213 "$DRK217")"
cek "…kedelapannya 200" "V == 8" "$(kode213 "$DRK217" 200)"

# ── PASANGAN: hasilnya harus PERSIS yang dikirim ──────────────────────────
# "Tak ada 5xx" juga tercapai kalau penulisannya diam-diam dibuang, atau kalau
# barisnya berlipat. Keduanya diperiksa, termasuk indeks utama yang cuma boleh
# meloloskan SATU supplier utama.
cek "PASANGAN: bahan punya tepat 2 supplier, tak berlipat" "V == 2" \
  "$(api "$OWNER" GET "/bahan/$BH217/supplier" | jq -r 'length')"
cek "PASANGAN: …dan tepat SATU di antaranya utama" "V == 1" \
  "$(api "$OWNER" GET "/bahan/$BH217/supplier" | jq -r '[.[]|select(.is_utama)]|length')"
cek "PASANGAN: perlengkapan punya tepat 2 supplier" "V == 2" \
  "$(api "$OWNER" GET "/perlengkapan/$PL217/supplier" | jq -r 'length')"
cek "PASANGAN: …dan tepat SATU di antaranya utama" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan/$PL217/supplier" | jq -r '[.[]|select(.is_utama)]|length')"
cek "PASANGAN: rak berisi tepat 1 bahan" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq -r --arg l "$LOC217" '[.[]|select(.id==$l)][0].jumlah_bahan // 0')"
cek "PASANGAN: rak berisi tepat 1 perlengkapan" "V == 1" \
  "$(api "$OWNER" GET /penyimpanan | jq -r --arg l "$LOC217" '[.[]|select(.id==$l)][0].jumlah_perlengkapan // 0')"

# ── PASANGAN: jalur yang MEMANG bersih harus tetap bersih ─────────────────
# Kalau kelak ada yang "merapikan" dengan menyerialkan semuanya se-perusahaan,
# asersi ini tak akan menangkapnya — tapi ia menangkap kebalikannya: kunci
# induk yang dilepas dari PUT /menu/:id, yang selama ini menjaganya diam-diam.
KAT217=$(api "$OWNER" GET /kategori | jq -r '.[0].id')
MN217=$(api "$OWNER" POST /menu \
  "{\"nama\":\"Menu 217 $RANDOM\",\"category_id\":\"$KAT217\",\"harga_jual\":10000,\"mult\":2,\"komponen\":[]}" | jq -r .id)
DMN217=$(balapPut217 2 4 "/menu/$MN217" \
  "{\"nama\":\"Menu 217\",\"category_id\":\"$KAT217\",\"harga_jual\":10000,\"mult\":2,\"komponen\":[{\"ingredient_id\":\"$BH217\",\"qty\":10}]}")
cek "PASANGAN: PUT /menu/:id (komponen) tetap bebas 5xx" "V == 0" "$(lima213 "$DMN217")"


echo "== 218. Potongan otomatis tak boleh memakai stok yang tidak ada =="
# Seksi ini menjaga jalur yang TAK ADA TOMBOLNYA: potongan otomatis berjalan
# sendiri setiap kali daftar perlengkapan dibuka. Beberapa tablet yang memuat
# layar itu bersamaan di pagi hari — saat kursor aturan masih kemarin dan
# tunggakannya beberapa hari — sudah cukup membuat saldo JATUH MINUS.
#
# KENAPA INDEKS UNIKNYA TAK MENANGKAPNYA, dan kenapa itu yang penting di sini:
# `supply_mutations_auto_uq` + `onConflictDoNothing` menjaga TIDAK ADA HARI
# YANG DIPOTONG DUA KALI, dan ia menepatinya — nol baris ganda, bahkan pada
# kode yang cacat. Yang tak dijaganya BERAPA TOTALNYA.
#
#   proses A: sisaRak=10 → isi hari 1..4 (3+3+3+1), stok habis, hari 5..7
#             ditinggalkan karena `sisa <= 0`
#   proses B: membaca sisaRak=10 SEBELUM A commit → hari 1..4 bentrok
#             (dilewati, benar), lalu hari 5..7 masih kosong sehingga terisi
#
# 19 terpakai dari 10 yang ada. Indeksnya hijau, bukunya salah — jadi asersi
# yang benar di sini bukan "tak ada baris ganda" melainkan SALDONYA.
#
# Balapannya dipicu lewat HTTP saja: enam `PUT /aturan` serentak, masing-masing
# membuat/mengubah aturan LALU menerapkannya. Kursornya masih kosong sampai
# yang pertama commit, jadi jendelanya terbuka persis seperti pagi hari.
# Terukur di atas kode cacat: −9 pada tiga ronde berturut-turut.
CB218=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
# TANGGAL BISNIS (Asia/Jakarta), bukan tanggal UTC kontainer.
#
# Tunggakan dihitung server dari `mulai` sampai HARI INI menurut zona
# perusahaan. Baris ini dulu memakai `date -u`, dan di antara pukul 17.00–24.00
# UTC — saat Jakarta sudah berganti hari — "6 hari lalu" versi UTC berjarak
# TUJUH hari dari hari ini versi WIB. Tunggakannya jadi 8×3=24, bukan 7×3=21,
# dan §218 gagal dengan "sisa 76, harusnya 79".
#
# Bukan hipotesis: itulah yang terjadi saat skrip ini dijalankan pukul 23.18
# UTC. Artinya gerbang ini merah selama TUJUH JAM setiap hari — dan gerbang
# yang merah tanpa sebab mengajari orang mengabaikannya.
#
# Delapan belas dari dua puluh perhitungan tanggal-saja di skrip ini sudah
# memakai `TZ=Asia/Jakarta`; dua di antaranya bahkan menuliskan alasannya
# ("kontainer bisa UTC", "tanggal bisnis, bukan tanggal UTC server"). Yang ini
# terlewat.
MULAI218=$(TZ=Asia/Jakarta date -d '6 days ago' +%F)

# stokAwal218 <qty> → id perlengkapan baru dengan stok segitu di cabang uji
stokAwal218(){
  local p
  p=$(api "$OWNER" POST /perlengkapan \
    "{\"nama\":\"Auto 218 $RANDOM$RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":100,\"dilacak\":true}" | jq -r .id)
  api "$OWNER" POST "/perlengkapan/$p/masuk?branch_id=$CB218" "{\"qty\":$1,\"total_harga\":100}" > /dev/null
  echo "$p"
}
# balapAturan218 <supply_id> — 6 PUT /aturan serentak (3/hari sejak 6 hari lalu)
balapAturan218(){
  local p="$1" i d; d=$(mktemp -d)
  for i in $(seq 1 6); do
    curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$BASE/api/perlengkapan/$p/aturan?branch_id=$CB218" \
      -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
      -d "{\"metode\":\"otomatis\",\"qty\":3,\"per_hari\":1,\"aktif\":true,\"mulai\":\"$MULAI218\"}" > "$d/c$i" &
  done
  wait
  cat "$d"/c* | grep -c '^5' || true
  rm -rf "$d"
}
saldo218(){ api "$OWNER" GET "/perlengkapan?branch_id=$CB218" | jq -r --arg p "$1" '[.[]|select(.id==$p)][0].saldo // 999'; }

# ── INTI: stok 10, tunggakan 7 hari × 3 = 21 → boleh habis, TAK BOLEH minus ──
P218A=$(stokAwal218 10)
cek "dasar §218: item uji punya stok 10" "V == 10" "$(saldo218 "$P218A")"
cek "…enam PUT /aturan serentak tak ada yang 5xx" "V == 0" "$(balapAturan218 "$P218A")"
cek "INTI: saldo TAK JATUH MINUS meski tunggakan (21) melebihi stok (10)" "V >= 0" \
  "$(saldo218 "$P218A")"
cek "INTI: …dan berhenti PERSIS di nol, bukan menyisakan stok hantu" "V == 0" \
  "$(saldo218 "$P218A")"

# ── PASANGAN: kuncinya tak boleh diam-diam MEMATIKAN potongannya ─────────
# "Saldo tak minus" juga tercapai kalau potongan otomatis berhenti bekerja
# sama sekali. Dengan stok berlimpah, tunggakan yang sama harus terpotong PENUH.
P218B=$(stokAwal218 100)
cek "PASANGAN: item kedua punya stok 100" "V == 100" "$(saldo218 "$P218B")"
cek "PASANGAN: …enam PUT serentak, nol 5xx" "V == 0" "$(balapAturan218 "$P218B")"
cek "PASANGAN: potongan tetap PENUH — 21 terpakai dari 100 (sisa 79)" "V == 79" \
  "$(saldo218 "$P218B")"


echo "== 219. Penjaga kuantitas yang dibaca DI LUAR kunci =="
# Dua pintu, satu bentuk: baca saldo → putuskan → tulis, dengan bacanya memakai
# `db` dan tulisannya pernyataan TERPISAH. Kontraknya bahkan sudah tertulis di
# `hitungSaldoCabang`: "pemanggil yang memvalidasi SEBELUM MENULIS wajib
# mengoper `tx`-nya" — dan kedua pintu ini tidak.
#
#   POST /:id/pakai   penjaganya "qty > saldo → 400". Isinya benar; yang bocor
#                     penegakannya. Terukur: saldo 10, enam `pakai 10` serentak
#                     → TIGA dibalas 200, saldo −20 (dua dari tiga ronde).
#                     Sebagian permintaan tetap ditolak, jadi dari layar tampak
#                     berfungsi — yang lolos itulah yang menarik stok ke minus.
#
#   POST /:id/koreksi menulis SELISIH (`qty_fisik − saldo`), jadi dua koreksi
#                     bersamaan menerapkannya dua kali. Berurutan ia idempoten
#                     (koreksi kedua berselisih 0) — dan justru itu yang membuat
#                     klik ganda tampak aman. Terukur: "rak berisi 5" atas saldo
#                     10, empat kali serentak, tiga ronde → saldo 0, 10, 10.
#                     TAK SEKALI PUN 5. Berurutan selalu 5.
#
# Asersinya pada SALDO, bukan pada kode status: `koreksi` membalas 200 pada
# keempat permintaan bahkan saat hasilnya salah, jadi uji yang membaca kode
# status akan lulus di atas bug ini.
CB219=$(api "$OWNER" GET /cabang | jq -r '[.[]|select(.tipe=="store" and .is_active)][0].id')
buatStok219(){ # buatStok219 <qty> → id perlengkapan berstok segitu
  local p
  p=$(api "$OWNER" POST /perlengkapan \
    "{\"nama\":\"Kuantitas 219 $RANDOM$RANDOM\",\"satuan\":\"pcs\",\"harga_beli\":100,\"dilacak\":true}" | jq -r .id)
  api "$OWNER" POST "/perlengkapan/$p/masuk?branch_id=$CB219" "{\"qty\":$1,\"total_harga\":100}" > /dev/null
  echo "$p"
}
saldo219(){ api "$OWNER" GET "/perlengkapan?branch_id=$CB219" | jq -r --arg p "$1" '[.[]|select(.id==$p)][0].saldo // 999'; }
serentak219(){ # serentak219 <n> <path> <body> → jumlah jawaban 2xx
  local n="$1" path="$2" body="$3" d i
  d=$(mktemp -d)
  for i in $(seq 1 "$n"); do
    curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api$path" \
      -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "$body" > "$d/c$i" &
  done
  wait
  grep -hcE '^2' "$d"/c* 2>/dev/null | paste -sd+ | bc
  rm -rf "$d"
}

# ── PAKAI: tiga ronde, tiap ronde item baru berstok 10 ────────────────────
LOLOS219=0; MINUS219=0
for r in 1 2 3; do
  P=$(buatStok219 10)
  L=$(serentak219 6 "/perlengkapan/$P/pakai?branch_id=$CB219" '{"qty":10}')
  LOLOS219=$((LOLOS219 + L))
  S=$(saldo219 "$P")
  case "$S" in (-*) MINUS219=$((MINUS219 + 1)) ;; esac
done
cek "INTI: saldo tak pernah MINUS setelah pemakaian serentak (3 ronde)" "V == 0" "$MINUS219"
cek "INTI: dari 6 pemakaian serentak, tepat SATU lolos tiap ronde" "V == 3" "$LOLOS219"

# ── KOREKSI: hasilnya harus PERSIS yang dihitung petugas ──────────────────
SALAH219=0
for r in 1 2 3; do
  P=$(buatStok219 10)
  serentak219 4 "/perlengkapan/$P/koreksi?branch_id=$CB219" '{"qty_fisik":5}' > /dev/null
  [ "$(saldo219 "$P")" = "5" ] || SALAH219=$((SALAH219 + 1))
done
cek "INTI: koreksi fisik serentak mendarat di angka yang DIHITUNG (5), 3 ronde" "V == 0" "$SALAH219"

# ── PASANGAN: kuncinya tak boleh mematikan jalur normalnya ────────────────
# "Saldo tak minus" juga tercapai kalau pemakaian ditolak seluruhnya, dan
# "koreksi benar" juga tercapai kalau koreksi berhenti menulis apa pun.
P219A=$(buatStok219 10)
cek "PASANGAN: pemakaian tunggal yang WAJAR tetap diterima" "V == 200" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$P219A/pakai?branch_id=$CB219" '{"qty":4}')"
cek "PASANGAN: …dan saldonya benar-benar berkurang (10 → 6)" "V == 6" "$(saldo219 "$P219A")"
cek "PASANGAN: pemakaian melebihi saldo tetap DITOLAK 400" "V == 400" \
  "$(status_code_body "$OWNER" POST "/perlengkapan/$P219A/pakai?branch_id=$CB219" '{"qty":99}')"
P219B=$(buatStok219 10)
cek "PASANGAN: koreksi tunggal tetap menulis selisihnya (10 → 3)" "V == 3" \
  "$(api "$OWNER" POST "/perlengkapan/$P219B/koreksi?branch_id=$CB219" '{"qty_fisik":3}' > /dev/null; saldo219 "$P219B")"


echo "== 220. Kekekalan uang refund, DI DALAM basis data =="
# `refund-uang-kekal.test.ts` sudah membuktikan sifat ini untuk FUNGSInya:
# 100.000 kombinasi, jumlah refund bertahap selalu sama dengan yang dibayar.
# Yang TIDAK dibuktikan siapa pun: bahwa baris yang benar-benar TERSIMPAN ikut
# menepatinya. Di antara fungsi dan tabel ada pembulatan kolom `numeric`,
# penyusutan `sales.subtotal` tiap refund, dan `nominal` yang dikembalikan API
# — tiga tempat yang bisa menggeser satu rupiah tanpa menyentuh fungsinya.
#
# Uang yang hilang di sela itu tak terlihat dari satu nota. Yang terlihat cuma
# kas yang tak pernah cocok.
#
# Diukur lebih dulu di luar skrip ini: 240 kombinasi (tarif PB1 0/7/10/11/12,5%,
# diskon persen & nominal 0–100, tiga bentuk keranjang) → NOL pelanggaran.
# Yang dipasang di sini bagian murahnya, dengan tarif PB1 PECAHAN (12,5%) yang
# paling mungkin melahirkan setengah rupiah.
# GET /company memulangkan camelCase (baris drizzle apa adanya), sedangkan
# PATCH menerima snake_case. Versi pertama baris ini memakai snake_case untuk
# MEMBACA — jadi ketiganya `null`, pemulihannya mengirim null (ditolak zod, dan
# responsnya dibuang ke /dev/null), lalu asersi pemulihan di ekor seksi
# membandingkan null dengan null dan SELALU hijau. Setelan 12,5% yang seksi ini
# berjanji dikembalikan sebenarnya diwariskan ke seluruh seksi sesudahnya.
PB1_220=$(api "$OWNER" GET /company | jq -r '{e:.pb1Enabled,r:.pb1Rate,d:.diskonMaksPersen}|@base64')
cek "dasar §220: setelan PB1 asal terbaca (bukan null)" "V == 1" \
  "$(echo "$PB1_220" | base64 -d | jq '((.e != null) and (.r != null) and (.d != null)) | if . then 1 else 0 end')"
api "$OWNER" PATCH /company '{"pb1_enabled":true,"pb1_rate":12.5,"diskon_maks_persen":100}' > /dev/null
PBA220=$(api "$OWNER" GET /menu | jq -r '[.[]|select(.nama|startswith("Premium Basooopa A"))][0].id')
PBB220=$(api "$OWNER" GET /menu | jq -r '[.[]|select(.nama|startswith("Premium Basooopa B"))][0].id')
cek "dasar §220: dua menu uji ada" "V == 2" \
  "$(printf '%s\n' "$PBA220" "$PBB220" | grep -c '^[0-9a-f-]\{36\}$' || true)"

# kembalikanSemua220 <qtyA> <qtyB> <tipe> <nilai> → "dibayar Σrefund sisa"
kembalikanSemua220(){
  local qa="$1" qb="$2" tp="$3" nl="$4" S SID DIBAYAR ITEMS JUMLAH=0 SISA baris iid r
  S=$(api "$REISS105" POST /penjualan \
    "{\"is_dine_in\":false,\"diskon_tipe\":\"$tp\",\"diskon_nilai\":$nl,\"items\":[{\"menu_id\":\"$PBA220\",\"qty\":$qa},{\"menu_id\":\"$PBB220\",\"qty\":$qb}]}")
  SID=$(echo "$S" | jq -r '.sale.id // empty')
  [ -z "$SID" ] && { echo "0 0 -1"; return; }
  DIBAYAR=$(echo "$S" | jq -r '.sale.total')
  ITEMS=$(api "$OWNER" GET "/penjualan/$SID" | jq -c '[(.items // .sale.items)[] | {id, qty}]')
  while :; do
    baris=$(echo "$ITEMS" | jq -r 'map(select(.qty>0))[0] // empty'); [ -z "$baris" ] && break
    iid=$(echo "$baris" | jq -r .id)
    r=$(api "$REISS105" POST "/penjualan/$SID/refund" \
      "{\"items\":[{\"sale_item_id\":\"$iid\",\"qty\":1}],\"client_ref\":\"$(cat /proc/sys/kernel/random/uuid)\"}")
    JUMLAH=$((JUMLAH + $(echo "$r" | jq -r '.nominal // 0')))
    ITEMS=$(echo "$ITEMS" | jq --arg i "$iid" 'map(if .id==$i then .qty=(.qty-1) else . end)')
  done
  SISA=$(api "$OWNER" GET "/penjualan/$SID" | jq -r '(.sale.total // .total)')
  echo "$DIBAYAR $JUMLAH $SISA"
}

MELESET220=0; SISA220=0; DICOBA220=0
for kombo in "1 1 nominal 0" "2 3 nominal 7777" "3 2 persen 33" "1 2 persen 99" "2 2 nominal 1" "3 1 persen 7"; do
  # shellcheck disable=SC2086
  set -- $kombo
  hasil=$(kembalikanSemua220 "$1" "$2" "$3" "$4")
  bayar=${hasil%% *}; sisanya=${hasil##* }; jml=$(echo "$hasil" | cut -d' ' -f2)
  DICOBA220=$((DICOBA220+1))
  [ "$jml" != "$bayar" ] && MELESET220=$((MELESET220+1))
  [ "$sisanya" != "0" ] && SISA220=$((SISA220+1))
done
cek "dasar §220: enam nota uji benar-benar dibuat" "V == 6" "$DICOBA220"
cek "INTI: Σ refund bertahap = yang DIBAYAR, di semua nota" "V == 0" "$MELESET220"
cek "INTI: nota yang seluruh porsinya dikembalikan bersisa NOL" "V == 0" "$SISA220"

# ── PASANGAN: kesetaraan di atas tidak boleh benar secara sepele ──────────
# Kalau `nominal` selalu memulangkan total nota, kedua asersi di atas juga
# hijau. Yang membedakan: refund SEBAGIAN harus lebih kecil dari yang dibayar.
S220=$(api "$REISS105" POST /penjualan \
  "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA220\",\"qty\":4}]}")
SID220=$(echo "$S220" | jq -r '.sale.id')
BAYAR220=$(echo "$S220" | jq -r '.sale.total')
IT220=$(api "$OWNER" GET "/penjualan/$SID220" | jq -r '(.items // .sale.items)[0].id')
NOM220=$(api "$REISS105" POST "/penjualan/$SID220/refund" \
  "{\"items\":[{\"sale_item_id\":\"$IT220\",\"qty\":1}],\"client_ref\":\"$(cat /proc/sys/kernel/random/uuid)\"}" | jq -r '.nominal // 0')
cek "PASANGAN: refund SEBAGIAN (1 dari 4) lebih kecil dari yang dibayar" "V == 1" \
  "$([ "$NOM220" -gt 0 ] && [ "$NOM220" -lt "$BAYAR220" ] && echo 1 || echo 0)"
cek "PASANGAN: …dan notanya masih menyisakan tagihan" "V == 1" \
  "$([ "$(api "$OWNER" GET "/penjualan/$SID220" | jq -r '(.sale.total // .total)')" -gt 0 ] && echo 1 || echo 0)"

# Setelan perusahaan DIKEMBALIKAN — seksi di bawah tak boleh mewarisi PB1 12,5%.
api "$OWNER" PATCH /company "$(echo "$PB1_220" | base64 -d | jq -c '{pb1_enabled:.e,pb1_rate:.r,diskon_maks_persen:.d}')" > /dev/null
cek "setelan PB1 perusahaan dikembalikan seperti semula" "V == 1" \
  "$(api "$OWNER" GET /company | jq --argjson a "$(echo "$PB1_220" | base64 -d)" \
     '(.pb1Enabled==$a.e and .pb1Rate==$a.r and .diskonMaksPersen==$a.d)|if . then 1 else 0 end')"
cek "PASANGAN: …dan tarifnya memang BUKAN 12,5% lagi" "V == 1" \
  "$(api "$OWNER" GET /company | jq '(.pb1Rate != 12.5) | if . then 1 else 0 end')"


echo
echo "── §222 Batal-tolak tak boleh menghidupkan baris yang SENGAJA ditolak ──"
# Penerimaan sebagian menolak baris dengan qty 0: barangnya memang TIDAK datang.
# `/batal-tolak` ada untuk kasus lain — kasir salah cek lalu menolak SATU faktur
# PENUH — jadi ia wajib menolak faktur yang sudah diterima sebagian, kalau tidak
# qty & harga PENUH yang tak pernah tiba ikut masuk stok & buku belanja.
#
# Dulu penjaganya pra-cek `SELECT` lalu `UPDATE` — dua pernyataan tanpa
# transaksi. `/terima-sebagian` yang commit di antaranya lolos begitu saja.
# TERUKUR sebelum diperbaiki: 14 putaran dengan tekanan kolam koneksi → 2 kali
# baris yang ditolak berubah jadi diterima, saldo tujuan naik 8 lalu 16 untuk
# barang yang tak pernah datang; sesudah dikunci, 0 dari 28.
#
# Yang diperiksa di sini PERILAKU BERURUTANNYA — deterministik, jadi ia berarti
# di tiap jalan CI. Balapannya sendiri tidak dijadikan asersi: pada 14% per
# putaran ia butuh puluhan putaran + beban kolam untuk berbunyi sekali, dan
# detektor selemah itu di CI lebih sering berbohong "aman" daripada menangkap.
SRC222=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.tipe=="store")][0].id')
DST222=$(api "$OWNER" GET /cabang | jq -r '[.[] | select(.tipe=="store")][1].id')
# Cabang tujuan belum tentu punya tempat penyimpanan (di jalan ini "Cabang 2"
# memang kosong) — kiriman butuh gudang tujuan, jadi disiapkan bila belum ada.
GD222=$(api "$OWNER" GET "/penyimpanan?branch_id=$DST222" | jq -r '.[0].id // empty')
if [ -z "$GD222" ]; then
  GD222=$(api "$OWNER" POST /penyimpanan "{\"nama\":\"Gudang 222\",\"branch_id\":\"$DST222\"}" | jq -r '.id // empty')
fi
cek "dasar §222: dua cabang toko + gudang tujuan siap" "V == 1" \
  "$([ -n "$SRC222" ] && [ -n "$DST222" ] && [ "$SRC222" != "$DST222" ] && [ -n "$GD222" ] && echo 1 || echo 0)"

# Nama diberi akhiran acak: bahan BARU selalu bersaldo 0, jadi asersi "+10"
# di bawah tetap bermakna meski seksi ini dijalankan dua kali atas DB yang sama.
# (Tanpa itu, POST kedua kena 409 nama kembar → id kosong → seluruh §222 gagal
# di tempat yang jauh dari sebabnya.)
bahan222() { api "$OWNER" POST /bahan "{\"nama\":\"$1 $(cat /proc/sys/kernel/random/uuid | cut -c1-8)\",\"kategori\":\"lain\",\"harga_beli\":1000,\"isi\":1,\"satuan\":\"pcs\"}" | jq -r '.id // empty'; }
saldo222() { api "$OWNER" GET "/stok?branch_id=$DST222" | jq --arg i "$1" '([.[] | select(.ingredient_id==$i)][0].saldo) // 0'; }
status222() { api "$OWNER" GET "/pembelian?branch_id=$DST222&per_page=500" \
  | jq -r --arg f "$1" --arg i "$2" '[.rows[] | select(.faktur_id==$f and .ingredient_id==$i)][0].status'; }

# Satu faktur dua baris, dikirim ke cabang tujuan → keduanya 'menunggu' di sana.
kirim222() { # kirim222 <bahanA> <bahanB> → echo faktur_id
  local fk
  fk=$(api "$OWNER" POST /pembelian/faktur \
    "{\"branch_id\":\"$SRC222\",\"items\":[{\"ingredient_id\":\"$1\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000},{\"ingredient_id\":\"$2\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":40000}]}" | jq -r .faktur_id)
  api "$OWNER" POST "/pembelian/tahap/$fk" '{"ke":"dikerjakan","dana_cair":90000}' > /dev/null
  local ra rb
  ra=$(api "$OWNER" GET "/pembelian?branch_id=$SRC222&per_page=500" | jq -r --arg f "$fk" --arg i "$1" '[.rows[]|select(.faktur_id==$f and .ingredient_id==$i)][0].id')
  rb=$(api "$OWNER" GET "/pembelian?branch_id=$SRC222&per_page=500" | jq -r --arg f "$fk" --arg i "$2" '[.rows[]|select(.faktur_id==$f and .ingredient_id==$i)][0].id')
  api "$OWNER" POST "/pembelian/tahap/$fk" \
    "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ra\",\"qty\":10},{\"id\":\"$rb\",\"qty\":8}],\"tujuan_branch_id\":\"$DST222\",\"tujuan_storage_id\":\"$GD222\"}" > /dev/null
  printf '%s\n' "$fk"
}

A222=$(bahan222 "Uji 222 A"); B222=$(bahan222 "Uji 222 B")
cek "dasar §222: dua bahan uji benar-benar dibuat" "V == 1" \
  "$([ -n "$A222" ] && [ -n "$B222" ] && [ "$A222" != "$B222" ] && echo 1 || echo 0)"
FK222=$(kirim222 "$A222" "$B222")
DA222=$(api "$OWNER" GET "/pembelian?branch_id=$DST222&per_page=500" | jq -r --arg f "$FK222" --arg i "$A222" '[.rows[]|select(.faktur_id==$f and .ingredient_id==$i)][0].id')
DB222=$(api "$OWNER" GET "/pembelian?branch_id=$DST222&per_page=500" | jq -r --arg f "$FK222" --arg i "$B222" '[.rows[]|select(.faktur_id==$f and .ingredient_id==$i)][0].id')
cek "dasar §222: dua baris kiriman tiba di cabang tujuan" "V == 1" \
  "$([ -n "$DA222" ] && [ -n "$DB222" ] && [ "$DA222" != "$DB222" ] && echo 1 || echo 0)"

# A diterima penuh, B ditolak (qty 0 = barang tidak datang).
api "$OWNER" POST "/penerimaan/$FK222/terima-sebagian" \
  "{\"items\":[{\"id\":\"$DA222\",\"qty_diterima\":10},{\"id\":\"$DB222\",\"qty_diterima\":0}],\"alasan\":\"uji 222\"}" > /dev/null
cek "terima sebagian: baris yang datang jadi 'dikonfirmasi'" "V == 1" \
  "$([ "$(status222 "$FK222" "$A222")" = "dikonfirmasi" ] && echo 1 || echo 0)"
cek "terima sebagian: baris yang TIDAK datang jadi 'ditolak'" "V == 1" \
  "$([ "$(status222 "$FK222" "$B222")" = "ditolak" ] && echo 1 || echo 0)"
cek "PASANGAN: barang yang benar-benar datang MASUK stok (+10)" "abs(V - 10) < 0.001" "$(saldo222 "$A222")"
cek "INTI: barang yang tak datang TIDAK masuk stok (0)" "abs(V) < 0.001" "$(saldo222 "$B222")"

# Inilah penjaganya: faktur yang sudah diterima sebagian tak boleh di-batal-tolak.
cek "INTI: batal-tolak atas faktur yang diterima sebagian → 400" "V == 400" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FK222/batal-tolak" -H "Authorization: Bearer $OWNER")")"
cek "INTI: sesudah ditolak permintaannya, baris B TETAP 'ditolak'" "V == 1" \
  "$([ "$(status222 "$FK222" "$B222")" = "ditolak" ] && echo 1 || echo 0)"
cek "INTI: …dan saldonya TETAP nol — tak ada barang hantu" "abs(V) < 0.001" "$(saldo222 "$B222")"

# PASANGAN: jalur sah batal-tolak harus TETAP bekerja. Tanpa ini, "selalu 400"
# juga membuat ketiga asersi di atas hijau — pengetatan yang mematikan fiturnya.
A222B=$(bahan222 "Uji 222 C"); B222B=$(bahan222 "Uji 222 D")
FK222B=$(kirim222 "$A222B" "$B222B")
api "$OWNER" POST "/penerimaan/$FK222B/tolak" '{"alasan":"kasir salah cek"}' > /dev/null
cek "PASANGAN: tolak satu faktur penuh → kedua baris 'ditolak'" "V == 1" \
  "$([ "$(status222 "$FK222B" "$A222B")" = "ditolak" ] && [ "$(status222 "$FK222B" "$B222B")" = "ditolak" ] && echo 1 || echo 0)"
cek "PASANGAN: batal-tolak atas penolakan PENUH → 200" "V == 200" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FK222B/batal-tolak" -H "Authorization: Bearer $OWNER")")"
cek "PASANGAN: …dan barangnya benar-benar masuk stok (+10 dan +8)" "V == 1" \
  "$([ "$(python3 -c "print(1 if abs($(saldo222 "$A222B") - 10) < 0.001 else 0)")" = "1" ] && [ "$(python3 -c "print(1 if abs($(saldo222 "$B222B") - 8) < 0.001 else 0)")" = "1" ] && echo 1 || echo 0)"

echo
echo "── §223 Penyesuaian yang sudah DISETUJUI benar-benar terkunci ──"
# Selisih opname diputuskan lewat alur: kasir menghitung → owner MENGKLARIFIKASI
# (kategori + catatan + FOTO WAJIB) → owner MENYETUJUI. Sesudah disetujui,
# barisnya jadi baseline saldo dan klarifikasinya dikunci — kodenya sendiri
# menuliskan "klarifikasi terkunci".
#
# Dulu kuncinya cuma PRA-CEK: SELECT status, lempar 400, lalu UPDATE ber-WHERE
# `id` saja. Persetujuan yang commit di antaranya lolos — dan yang tertimpa
# bukan angka stoknya melainkan BUKTINYA: kategori, catatan, foto, dan siapa
# yang mengklarifikasi, pada baris yang sudah ditandatangani.
#
# TERUKUR sesudah pagarnya dipasang: 2 dari 46 putaran balapan dibalas 409 —
# tiap 409 itu satu penulisan yang, pada kode lama, mendarat diam-diam di baris
# yang sudah disetujui. Yang diperiksa di sini perilaku BERURUTANNYA, yang
# deterministik; balapannya sendiri terlalu jarang untuk jadi asersi CI.
ING223=$(api "$OWNER" GET /stok | jq -r '[.[] | select(.saldo > 20)][0].ingredient_id')
cek "dasar §223: ada bahan berstok untuk diopname" "V == 1" \
  "$([ -n "$ING223" ] && [ "$ING223" != "null" ] && echo 1 || echo 0)"
FOTO223="data:image/png;base64,iVBORw0KGgo="

# Satu baris opname berselisih → 'menunggu'.
SIS223=$(api "$OWNER" GET /stok | jq --arg i "$ING223" '[.[]|select(.ingredient_id==$i)][0].saldo')
api "$OWNER" POST /stok/opname \
  "{\"catatan\":\"opname 223\",\"items\":[{\"ingredient_id\":\"$ING223\",\"qty\":$(python3 -c "print($SIS223 - 2)")}]}" > /dev/null
# Daftarnya urut desc(created_at), jadi `first` = yang BARU SAJA dibuat.
# `last` akan mengambil baris tertua yang masih menggantung dari seksi lain —
# dan seluruh §223 lalu menguji baris yang bukan miliknya.
NAMA223=$(api "$OWNER" GET /bahan | jq -r --arg i "$ING223" '[.[]|select(.id==$i)][0].nama')
PID223=$(api "$OWNER" GET "/stok/penyesuaian?status=belum" | jq -r --arg n "$NAMA223" '[.[] | select(.bahan==$n and .penyesuaian_status=="menunggu")] | first | .id')
cek "dasar §223: baris penyesuaian 'menunggu' terbentuk" "V == 1" \
  "$([ -n "$PID223" ] && [ "$PID223" != "null" ] && echo 1 || echo 0)"

kat223() { api "$OWNER" GET "/stok/penyesuaian?status=semua" | jq -r --arg p "$PID223" '[.[]|select(.id==$p)][0].kategori'; }
stat223() { api "$OWNER" GET "/stok/penyesuaian?status=semua" | jq -r --arg p "$PID223" '[.[]|select(.id==$p)][0].penyesuaian_status'; }
klar223() { # klar223 <id> <kategori> → echo kode status
  printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/penyesuaian/$1/klarifikasi" \
    -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
    -d "{\"kategori\":\"$2\",\"catatan\":\"bukti $2\",\"foto_url\":\"$FOTO223\"}")"
}

cek "klarifikasi pertama (masih 'menunggu') → 200" "V == 200" "$(klar223 "$PID223" waste_bahan)"
cek "…kategorinya tersimpan" "V == 1" "$([ "$(kat223)" = "waste_bahan" ] && echo 1 || echo 0)"
cek "setujui → 200" "V == 200" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/penyesuaian/$PID223/setujui" -H "Authorization: Bearer $OWNER")")"
cek "…statusnya jadi 'disetujui'" "V == 1" "$([ "$(stat223)" = "disetujui" ] && echo 1 || echo 0)"

# INTI: sesudah disetujui, buktinya tak boleh bisa ditulis ulang.
cek "INTI: klarifikasi atas baris DISETUJUI ditolak" "V == 400 or V == 409" \
  "$(klar223 "$PID223" koreksi_pencatatan)"
cek "INTI: …dan kategorinya TETAP yang disetujui, bukan yang baru" "V == 1" \
  "$([ "$(kat223)" = "waste_bahan" ] && echo 1 || echo 0)"

# PASANGAN: pengetatannya tak boleh mematikan jalur klarifikasi ULANG atas baris
# yang DITOLAK — itu sebabnya pagarnya `ne(disetujui)`, bukan `eq(menunggu)`.
# Tanpa asersi ini, `eq(menunggu)` juga membuat kedua asersi INTI di atas hijau.
SIS223B=$(api "$OWNER" GET /stok | jq --arg i "$ING223" '[.[]|select(.ingredient_id==$i)][0].saldo')
api "$OWNER" POST /stok/opname \
  "{\"catatan\":\"opname 223b\",\"items\":[{\"ingredient_id\":\"$ING223\",\"qty\":$(python3 -c "print($SIS223B - 3)")}]}" > /dev/null
PID223B=$(api "$OWNER" GET "/stok/penyesuaian?status=belum" | jq -r --arg n "$NAMA223" '[.[] | select(.bahan==$n and .penyesuaian_status=="menunggu")] | first | .id')
cek "dasar §223: baris kedua untuk uji penolakan siap" "V == 1" \
  "$([ -n "$PID223B" ] && [ "$PID223B" != "null" ] && [ "$PID223B" != "$PID223" ] && echo 1 || echo 0)"
api "$OWNER" POST "/stok/penyesuaian/$PID223B/klarifikasi" \
  "{\"kategori\":\"waste_bahan\",\"catatan\":\"bukti awal\",\"foto_url\":\"$FOTO223\"}" > /dev/null
api "$OWNER" POST "/stok/penyesuaian/$PID223B/tolak" '{"alasan":"hitungan meragukan"}' > /dev/null
# `/penyesuaian/:id/tolak` menolak KLARIFIKASINYA, bukan penyesuaiannya:
# barisnya dikembalikan ke 'belum' beserta alasannya, dan tetap 'menunggu'
# sampai ada klarifikasi yang lebih baik. (Yang membuat penyesuaian jadi
# 'ditolak' adalah penolakan se-SESI.) Dicatat di sini karena asersi pertama
# versi ini salah menebak semantiknya — dan ujinya yang membetulkan.
BARIS223B() { api "$OWNER" GET "/stok/penyesuaian?status=semua" | jq -r --arg p "$PID223B" "[.[]|select(.id==\$p)][0].$1"; }
cek "PASANGAN: klarifikasi ditolak → kembali ke 'belum', bukan 'ditolak'" "V == 1" \
  "$([ "$(BARIS223B klarifikasi_status)" = "belum" ] && [ "$(BARIS223B penyesuaian_status)" = "menunggu" ] && echo 1 || echo 0)"
cek "PASANGAN: …dan alasan penolakannya tercatat" "V == 1" \
  "$([ "$(BARIS223B tolak_alasan)" = "hitungan meragukan" ] && echo 1 || echo 0)"
cek "PASANGAN: klarifikasi ULANG sesudah ditolak tetap boleh (200)" "V == 200" \
  "$(klar223 "$PID223B" koreksi_pencatatan)"
cek "PASANGAN: …kategori barunya tersimpan & alasan penolakan dibersihkan" "V == 1" \
  "$([ "$(BARIS223B kategori)" = "koreksi_pencatatan" ] && [ "$(BARIS223B tolak_alasan)" = "null" ] && echo 1 || echo 0)"

echo
echo "── §224 Grafik transaksi per jam: sumbunya tak boleh berbohong ──"
# Grafik ini menjawab "kapan warung ramai". Yang membuatnya bisa dipercaya satu
# sifat: batang-batangnya HARUS berjumlah sama dengan kartu "Transaksi" dan
# "Omzet" di halaman yang sama. Keduanya dihitung dari kueri yang berbeda, jadi
# kesamaannya bukan tautologi — ia yang membuktikan saringannya memang sama.
#
# Ember jamnya dihitung di ZONA PERUSAHAAN. Tanpa `AT TIME ZONE`, kueri tetap
# SAH dan tetap memulangkan angka — cuma tergeser tujuh jam di WIB, sehingga
# jam ramai yang dibaca pemilik warung jadi jam yang salah tanpa satu pun galat.
HARI224=$(TZ=Asia/Jakarta date +%F)   # tanggal bisnis, bukan tanggal UTC server
LAP224=$(api "$OWNER" GET "/laporan?dari=$HARI224&sampai=$HARI224&branch_id=all")
cek "dasar §224: laporan hari ini terbaca & memuat per_jam" "V == 1" \
  "$(echo "$LAP224" | jq '((.per_jam|type) == "array") | if . then 1 else 0 end')"
cek "INTI: cacah batang = kartu Transaksi" "V == 1" \
  "$(echo "$LAP224" | jq '(([.per_jam[].jumlah] | add // 0) == .jumlah_transaksi) | if . then 1 else 0 end')"
cek "INTI: omzet batang = kartu Omzet" "V == 1" \
  "$(echo "$LAP224" | jq '((([.per_jam[].omzet] | add // 0) - .omzet) | fabs < 0.01) | if . then 1 else 0 end')"
cek "deret jamnya BERSAMBUNG (jeda di tengah ikut, bernilai nol)" "V == 1" \
  "$(echo "$LAP224" | jq '([.per_jam[].jam] | (length == 0) or (. == ([range(.[0]; .[-1]+1)]))) | if . then 1 else 0 end')"
cek "kedua UJUNGNYA berisi — jam tutup tidak digambar" "V == 1" \
  "$(echo "$LAP224" | jq '(.per_jam | (length == 0) or ((.[0].jumlah > 0) and (.[-1].jumlah > 0))) | if . then 1 else 0 end')"
cek "jamnya masuk akal (0–23)" "V == 1" \
  "$(echo "$LAP224" | jq '([.per_jam[].jam] | all(. >= 0 and . <= 23)) | if . then 1 else 0 end')"

# PASANGAN: tanggal tanpa penjualan harus memulangkan deret KOSONG, bukan 24
# batang nol — dan bukan pula menyalin angka hari ini. Tanpa asersi ini,
# `per_jam` yang selalu berisi data hari ini akan membuat semua asersi di atas
# hijau untuk alasan yang salah.
LAP224K=$(api "$OWNER" GET "/laporan?dari=2000-01-03&sampai=2000-01-03&branch_id=all")
cek "PASANGAN: tanggal tanpa penjualan → per_jam kosong" "V == 0" \
  "$(echo "$LAP224K" | jq '.per_jam | length')"
cek "PASANGAN: …dan kartu transaksinya memang nol" "V == 0" \
  "$(echo "$LAP224K" | jq '.jumlah_transaksi')"

echo
echo "── §225 Impor bahan: pesan gagal tak boleh membawa kueri mentah ──"
# Jalur impor tidak menggagalkan seluruh permintaan saat satu baris bermasalah;
# ia melaporkan baris itu lalu meneruskan sisanya. Yang sempat terlewat:
# "melaporkan barisnya" berarti `(e as Error).message` apa adanya — dan pesan
# Drizzle memuat SELURUH kueri yang gagal beserta parameternya.
#
# TERUKUR sebelum diperbaiki: `harga_beli: 1e15` pada kolom `numeric(14,2)`
# memulangkan ke klien seluruh INSERT lengkap ke-30 nama kolomnya DITAMBAH
# daftar parameternya — termasuk uuid perusahaan. Pemiliknya cuma salah
# mengetik nol; yang ia lihat dump SQL.
#
# Komentar di `bahan/routes.ts` sudah menyebut cacat ini dan menyatakannya
# diperbaiki, tapi perbaikan itu hanya menutup cabang 23505; TIGA jalur galat
# lain di berkas yang sama tetap membuangnya mentah.
MELUAP225='1000000000000000'   # numeric(14,2) → maksimum di bawah 1e12
G225=$(api "$OWNER" POST /bahan/import \
  "{\"mode\":\"tambah\",\"items\":[{\"nama\":\"Bocor Uji 225\",\"harga_beli\":$MELUAP225}]}")
cek "dasar §225: barisnya memang GAGAL (bukan diam-diam tersimpan)" "V == 1" \
  "$(echo "$G225" | jq '((.gagal|length) == 1) and (.ditambah == 0) | if . then 1 else 0 end')"

ALASAN225=$(echo "$G225" | jq -r '.gagal[0].alasan')
cek "INTI: pesannya tak memuat teks kueri" "V == 1" \
  "$(printf '%s' "$ALASAN225" | grep -qiE 'failed query|insert into|update .*set|params:' && echo 0 || echo 1)"
cek "INTI: pesannya tak memuat nama kolom basis data" "V == 1" \
  "$(printf '%s' "$ALASAN225" | grep -qE 'company_id|harga_beli|is_active|created_at' && echo 0 || echo 1)"
cek "INTI: pesannya tak membocorkan uuid" "V == 1" \
  "$(printf '%s' "$ALASAN225" | grep -qiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' && echo 0 || echo 1)"
cek "INTI: dan pesannya MENERANGKAN sebabnya, bukan cuma 'gagal'" "V == 1" \
  "$([ "$ALASAN225" = "Angkanya terlalu besar untuk disimpan" ] && echo 1 || echo 0)"

# Jalur PERBARUI adalah pintu saudaranya — ia tak pernah ikut diperbaiki dulu.
ADA225=$(api "$OWNER" GET /bahan | jq -r '.[0].nama')
U225=$(api "$OWNER" POST /bahan/import \
  "{\"mode\":\"perbarui\",\"items\":[{\"nama\":\"$ADA225\",\"harga_beli\":$MELUAP225}]}")
cek "INTI: jalur PERBARUI pun tak membocorkan kueri" "V == 1" \
  "$(printf '%s' "$(echo "$U225" | jq -r '.gagal[0].alasan // ""')" | grep -qiE 'failed query|update .*set|params:' && echo 0 || echo 1)"

# PASANGAN: pengetatan ini tak boleh menelan impor yang SAH, dan tak boleh
# menelan keterangannya. Tanpa asersi ini, "selalu balas kalimat bawaan" juga
# membuat keempat asersi INTI di atas hijau.
N225=$(api "$OWNER" GET /bahan | jq 'length')
OK225=$(api "$OWNER" POST /bahan/import \
  '{"mode":"tambah","items":[{"nama":"Bahan Waras 225","harga_beli":12500,"isi":1,"satuan":"pcs"}]}')
cek "PASANGAN: impor yang sah tetap tersimpan" "V == 1" \
  "$(echo "$OK225" | jq '((.ditambah == 1) and ((.gagal|length) == 0)) | if . then 1 else 0 end')"
cek "PASANGAN: …dan daftar bahan bertambah tepat satu" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --argjson n "$N225" '((length - $n) == 1) | if . then 1 else 0 end')"
cek "PASANGAN: baris yang meluap TIDAK ikut tersimpan" "V == 0" \
  "$(api "$OWNER" GET /bahan | jq '[.[] | select(.nama == "Bocor Uji 225")] | length')"

echo
echo "── §226 Nilai plan tenant harus terbatas — salah ketik bukan penurunan ──"
# `modeDariPlan` memutuskan mode tenant dari satu perbandingan ketat
# (`plan === "pro"`); apa pun selain itu berarti LITE. Perbandingan itu benar.
# Yang dulu salah: pintu masuknya menerima `z.string()` bebas, jadi satu huruf
# besar cukup menurunkan pelanggan yang membayar tanpa satu pun peringatan.
#
# TERUKUR sebelum diperbaiki: tenant dengan 28 cabang aktif dikirimi
# {"plan":"Pro"} → dibalas 200, dan GET /company seketika berbunyi mode "lite".
# `isPro` menggerbangi PEMILIH CABANG di layar, jadi pemiliknya mendadak cuma
# bisa menjangkau satu dari 28 cabangnya.
#
# Jalur OWNER (POST /company/mode) sejak dulu dijaga ketat — ia menolak turun ke
# Lite selama masih ada lebih dari satu cabang aktif. Pintu super admin, yang
# justru dipakai untuk penagihan, tak punya penjaga apa pun.
CID226=$(api "$OWNER" GET /company | jq -r .id)
MODE226=$(api "$OWNER" GET /company | jq -r .mode)
cek "dasar §226: tenant uji terbaca & ber-mode pro" "V == 1" \
  "$([ -n "$CID226" ] && [ "$MODE226" = "pro" ] && echo 1 || echo 0)"

plan226() { # plan226 <nilai> → echo kode status
  printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/admin/tenants/$CID226" \
    -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"plan\":$1}")"
}
mode226() { api "$OWNER" GET /company | jq -r .mode; }

cek "INTI: plan \"Pro\" (huruf besar) DITOLAK" "V == 400" "$(plan226 '"Pro"')"
cek "INTI: plan \"PRO\" ditolak" "V == 400" "$(plan226 '"PRO"')"
cek "INTI: plan \"pro \" (spasi ekor) ditolak" "V == 400" "$(plan226 '"pro "')"
cek "INTI: plan tak dikenal (\"professional\") ditolak" "V == 400" "$(plan226 '"professional"')"
cek "INTI: plan kosong ditolak" "V == 400" "$(plan226 '""')"
cek "INTI: sesudah semua penolakan itu, modenya TETAP pro" "V == 1" \
  "$([ "$(mode226)" = "pro" ] && echo 1 || echo 0)"

# PASANGAN: pengetatan ini tak boleh mematikan alat penagihannya. Penurunan
# yang DISENGAJA harus tetap bisa — tanpa asersi ini, "tolak semua plan" juga
# membuat keenam asersi INTI di atas hijau.
cek "PASANGAN: plan \"lite\" diterima" "V == 200" "$(plan226 '"lite"')"
cek "PASANGAN: …dan modenya benar-benar turun" "V == 1" \
  "$([ "$(mode226)" = "lite" ] && echo 1 || echo 0)"
cek "PASANGAN: plan \"pro\" diterima" "V == 200" "$(plan226 '"pro"')"
cek "PASANGAN: …dan modenya kembali naik" "V == 1" \
  "$([ "$(mode226)" = "pro" ] && echo 1 || echo 0)"
cek "tenant ditinggalkan ber-mode pro seperti semula" "V == 1" \
  "$([ "$(mode226)" = "$MODE226" ] && echo 1 || echo 0)"

echo
echo "── §227 Galat validasi harus kalimat, bukan gumpalan objek ──"
# `@hono/zod-validator` bawaan MEMULANGKAN SENDIRI 400 berisi objek ZodError
# mentah: {"success":false,"error":{"name":"ZodError","message":"[\n {…"}}.
#
# Seluruh API ini berjanji { error: "<kalimat>" }, dan apps/web/src/lib/api.ts
# menyalin `data.error` ke pesan galat — bertipe string menurut deklarasinya.
# Untuk galat zod isinya OBJEK, dan `new Error(objek)` merangkainya jadi
# "[object Object]". TERUKUR: menjalankan baris 138-156 api.ts atas badan itu
# menghasilkan e.message === "[object Object]". Itulah yang tampil di layar —
# kasir yang salah mengetik satu angka tak punya jalan tahu angka mana.
#
# Akibat keduanya lebih sunyi: respons itu DIPULANGKAN, bukan DILEMPAR, jadi ia
# melewati app.onError sama sekali — termasuk pencatatannya ke error_logs.
val227() { # val227 <method> <path> <json> → echo badan responsnya
  curl -s -X "$1" "$BASE/api$2" -H "Authorization: Bearer $OWNER" \
    -H 'Content-Type: application/json' -d "$3"
}
PB1_ASAL227=$(api "$OWNER" GET /company | jq -r .pb1Rate)   # camelCase: lihat catatan §220
B227=$(val227 PATCH /company '{"pb1_rate":150}')
cek "dasar §227: badan cacat memang DITOLAK (validasinya masih hidup)" "V == 400" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/company" \
     -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"pb1_rate":150}')")"
cek "INTI: kolom error bertipe STRING, bukan objek" "V == 1" \
  "$(echo "$B227" | jq '(.error | type == "string") | if . then 1 else 0 end')"
cek "INTI: kalimatnya menyebut ISIAN dan BATASNYA" "V == 1" \
  "$([ "$(echo "$B227" | jq -r .error)" = "pb1_rate: maksimal 100" ] && echo 1 || echo 0)"
cek "INTI: bukan gumpalan JSON/ZodError" "V == 1" \
  "$(printf '%s' "$(echo "$B227" | jq -r .error)" | grep -qiE 'ZodError|"code"|\[object Object\]|^\s*\[' && echo 0 || echo 1)"

# Kunci yang TIDAK dikirim berbunyi "wajib diisi", bukan "harus berupa string" —
# bagi pengirimnya kunci yang absen memang bukan soal tipe.
cek "kunci yang absen berbunyi 'wajib diisi'" "V == 1" \
  "$(printf '%s' "$(val227 POST /bahan '{"harga_beli":100}' | jq -r .error)" | grep -q 'nama: wajib diisi' && echo 1 || echo 0)"
cek "tipe salah menyebut tipe yang diharapkan" "V == 1" \
  "$(printf '%s' "$(val227 POST /bahan '{"nama":"Uji 227","harga_beli":"seratus"}' | jq -r .error)" | grep -q 'harus berupa number' && echo 1 || echo 0)"

# PASANGAN: pembungkusnya tak boleh MEMATIKAN validasinya. Tanpa asersi ini,
# hook yang diam-diam meloloskan semua badan juga membuat asersi di atas hijau
# (tak ada galat → tak ada gumpalan objek).
cek "PASANGAN: badan yang SAH tetap diterima" "V == 200" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/company" \
     -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"pb1_rate":10}')")"
cek "PASANGAN: …dan nilainya benar-benar tersimpan" "V == 1" \
  "$([ "$(api "$OWNER" GET /company | jq -r .pb1Rate)" = "10" ] && echo 1 || echo 0)"

# Setelan dikembalikan seperti semula — seksi ini menumpang setelan perusahaan
# untuk mengujinya, dan tak boleh meninggalkannya berubah.
api "$OWNER" PATCH /company "{\"pb1_rate\":$PB1_ASAL227}" > /dev/null
cek "setelan PB1 dikembalikan seperti semula" "V == 1" \
  "$([ "$(api "$OWNER" GET /company | jq -r .pb1Rate)" = "$PB1_ASAL227" ] && echo 1 || echo 0)"

echo
echo "── §228 Slip pesanan dirender server: menu & jumlah, TANPA harga ──"
# Web menyusun byte ESC/POS-nya sendiri (ia mengimpor @kakarut/shared). Mobile
# ditulis Flutter dan tak bisa, jadi ia mengambil byte yang sudah jadi dari
# sini. Aturan yang sama dengan `qty_teks`: saat klien tak bisa berbagi kode,
# SERVER yang menuliskannya — menebak sendiri sudah pernah melahirkan "900 kg"
# untuk barang yang sebenarnya 900 gr.
#
# Di sini taruhannya lebih tajam: satu-satunya janji slip ini adalah TANPA
# HARGA. Kalau layoutnya disusun ulang di Dart, janji itu hidup di dua tempat
# dan bisa menyimpang diam-diam.
SID228=$(api "$REISS105" GET "/penjualan?per_page=1" | jq -r '.[0].id')
cek "dasar §228: ada penjualan untuk diambil slipnya" "V == 1" \
  "$([ -n "$SID228" ] && [ "$SID228" != "null" ] && echo 1 || echo 0)"
SLIP228=$(api "$REISS105" GET "/penjualan/$SID228/slip?paper=58")
T228=$(echo "$SLIP228" | jq -r '.teks // ""')

cek "INTI: slip penjualan tak memuat rupiah" "V == 1" \
  "$(printf '%s' "$T228" | grep -q 'Rp' && echo 0 || echo 1)"
cek "INTI: …dan tak memuat baris uang" "V == 1" \
  "$(printf '%s' "$T228" | grep -qE 'TOTAL|Subtotal|PB1|Diskon|Kembali' && echo 0 || echo 1)"
cek "slip menyebut dirinya PESANAN, bukan struk" "V == 1" \
  "$(printf '%s' "$T228" | grep -q 'PESANAN' && echo 1 || echo 0)"
cek "slip memuat cacah porsi" "V == 1" \
  "$(printf '%s' "$T228" | grep -q 'Total porsi' && echo 1 || echo 0)"
cek "byte ESC/POS dipulangkan base64 & tidak kosong" "V == 1" \
  "$(echo "$SLIP228" | jq '((.data|length) > 50) | if . then 1 else 0 end')"
cek "lebar kolom mengikuti kertas 58mm" "V == 32" "$(echo "$SLIP228" | jq -r '.chars_per_line')"

# LACI TAK BOLEH TERBUKA — slip ini bukan pembayaran. Diperiksa pada BYTE-nya,
# bukan pada opsinya: ESC p (0x1B 0x70) adalah perintah buka laci.
cek "INTI: byte-nya tak memuat perintah buka laci" "V == 1" \
  "$(echo "$SLIP228" | jq -r '.data' | python3 -c "
import sys, base64
b = base64.b64decode(sys.stdin.read().strip())
print(0 if bytes([0x1b, 0x70]) in b else 1)")"

# PASANGAN: struk SUNGGUHAN penjualan yang sama tetap memuat rupiahnya. Tanpa
# ini, seluruh asersi 'tak memuat' di atas juga hijau seandainya slipnya kosong
# atau datanya gagal dimuat.
cek "PASANGAN: nota yang sama memang punya angka uang" "V == 1" \
  "$(api "$REISS105" GET "/penjualan/$SID228" | jq '((.sale.total > 0) and ((.items|length) > 0)) | if . then 1 else 0 end')"

# OPEN BILL — jalur kedua yang diminta. Belum bernomor, jadi identitasnya meja.
MEJA228=$(api "$REISS105" GET /meja | jq -r '[.[]|select(.tipe=="dine_in")][0].id')
MENU228=$(api "$REISS105" GET /menu | jq -r '[.[]|select(.harga_jual>0 and .is_active)][0].id')
BILL228=$(api "$REISS105" POST /open-bill \
  "{\"meja_id\":\"$MEJA228\",\"customer_nama\":\"Uji 228\",\"items\":[{\"menu_id\":\"$MENU228\",\"qty\":2,\"catatan\":\"tanpa cabai\"}]}")
BID228=$(echo "$BILL228" | jq -r '.id // empty')
cek "dasar §228: open bill uji terbentuk" "V == 1" \
  "$([ -n "$BID228" ] && echo 1 || echo 0)"
TB228=$(api "$REISS105" GET "/open-bill/$BID228/slip?paper=58" | jq -r '.teks // ""')
cek "INTI: slip open bill tak memuat rupiah" "V == 1" \
  "$(printf '%s' "$TB228" | grep -q 'Rp' && echo 0 || echo 1)"
cek "slip open bill memuat menu, jumlah, dan catatan barisnya" "V == 1" \
  "$(printf '%s' "$TB228" | grep -q '2x ' && printf '%s' "$TB228" | grep -q 'tanpa cabai' && echo 1 || echo 0)"
cek "open bill tanpa nomor: tak ada 'Antrian NaN'" "V == 1" \
  "$(printf '%s' "$TB228" | grep -qE 'NaN|Antrian' && echo 0 || echo 1)"

# Cakupan: id asing ditolak, bukan memulangkan slip kosong.
cek "slip penjualan id asing → 404" "V == 404" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/penjualan/00000000-0000-0000-0000-000000000000/slip" -H "Authorization: Bearer $REISS105")")"
cek "slip open bill id asing → 404" "V == 404" \
  "$(printf '%s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/open-bill/00000000-0000-0000-0000-000000000000/slip" -H "Authorization: Bearer $REISS105")")"

echo
echo "── §221 Akun seed harus ditinggalkan seperti semula ──"
# Duduk di ekor bersama §209/§215, dan karena alasan yang sama: ia menghakimi
# sesudah semua seksi selesai mengutak-atik.
#
# KENAPA ADA. §105 mengganti password kasir DUA KALI untuk menguji
# `token_version`, dan dulu membiarkannya begitu — catatannya menyandarkan
# keamanan pada penempatan ("letakkan PALING AKHIR"), padahal kini ada ~115
# seksi di bawahnya. Sandaran itu juga hanya melindungi SKRIP INI: apa pun yang
# berjalan sesudahnya terhadap basis data yang sama akan login dengan password
# seed dan ditolak.
#
# Itu bukan hipotesis. Saat suite e2e web dipasang di job CI yang sama, dua
# spec merah dengan `login API (status 401)` — dan sebabnya berjarak 4.000
# baris dari gejalanya. Asersi di bawah membuat sebab dan gejalanya bertemu.
for pasangan in "owner:$OWNER_EMAIL:$OWNER_PASS" "kasir:$KASIR_EMAIL:$KASIR_PASS" "superadmin:$SA_EMAIL:$SA_PASS"; do
  peran="${pasangan%%:*}"; sisa="${pasangan#*:}"
  surel="${sisa%%:*}"; sandi="${sisa#*:}"
  cek "kredensial seed $peran masih berlaku di akhir skrip" "V == 1" \
    "$([ -n "$(login "$surel" "$sandi")" ] && echo 1 || echo 0)"
done

echo
echo "── §215 Kuota pendaftaran: skrip ini tak boleh diam saat 429 ──"
# Duduk di ekor bersama §209, dan karena alasan yang sama: ia mengadili berkas
# yang baru terisi setelah semua seksi menembakkan pendaftarannya.
#
# `POST /auth/register` berkuota 20 per IP per JAM, dan skrip ini memanggilnya
# sekitar 20 kali — TEPAT DI TEPI. Sekali terlampaui, `daftar_verif` dulu
# memulangkan token kosong tanpa sepatah kata, dan yang terlihat cuma asersi
# turunan yang membingungkan ratusan baris jauhnya.
#
# ── Dibuktikan MENGGIGIT lebih dulu, seperti §209 ──────────────────────────
# Tanpa ini, "berkasnya kosong" cuma membuktikan bahwa tak ada yang pernah
# menulis ke sana — termasuk bila deteksinya rusak sama sekali.
printf 'uji-diri-215@contoh.id\n' >> "$KUOTA_HABIS"
cek "penjaga kuota bisa MENUDUH (uji-diri)" "V == 1" \
  "$(grep -cx 'uji-diri-215@contoh.id' "$KUOTA_HABIS" || true)"
sed -i '/^uji-diri-215@contoh.id$/d' "$KUOTA_HABIS"
cek "…dan tuduhan uji-diri itu bisa dicabut lagi" "V == 0" \
  "$(grep -cx 'uji-diri-215@contoh.id' "$KUOTA_HABIS" || true)"

cek "INTI: tak ada pendaftaran yang kena 429 sepanjang jalan ini" "V == 0" \
  "$(grep -c . "$KUOTA_HABIS" || true)"
if [ -s "$KUOTA_HABIS" ]; then
  echo "     Kuota 20/IP/jam terlampaui. INI BUKAN BUG KODE — hasil seksi yang"
  echo "     memakai akun baru jadi tak bermakna. Tunggu satu jam, atau kurangi"
  echo "     pendaftaran di skrip ini. Yang kena:"
  sed 's/^/       /' "$KUOTA_HABIS"
fi

echo
echo "── §209 Rute mati: verify-api tak boleh memanggil endpoint yang TIDAK ADA ──"
# Duduk PALING AKHIR di berkas ini walau nomornya bukan yang terbesar: ia baru
# boleh menghakimi sesudah semua seksi lain menembakkan panggilannya.
# Seksi ini mengadili berkas yang diisi `catat_rute_mati` (lihat catatan panjang
# di dekat definisi `api`). Ia duduk di ekor skrip karena baru boleh menghakimi
# sesudah semua seksi lain menembakkan panggilannya.
#
# Pemicunya nyata: lima blok `POST /absensi/masuk` — rute yang tak pernah ada —
# hidup di skrip ini sampai satu jalan penuh dibaca ulang lewat `error_logs`.
# Ketiganya (stdout, stderr, status keluar) ditelan di tempat kejadian, jadi
# tak satu pun dari 2.400+ asersi berubah warna. Yang menyembunyikannya bukan
# kelalaian satu orang; itu bentuk penulisan yang memang tak bisa gagal.

# ── Dulu penjaga ini DIBUKTIKAN MENGGIGIT, baru boleh dipercaya ────────────
# Ditembakkan dengan tiga lapis penelan yang SAMA PERSIS dengan yang menutupi
# bug aslinya. Kalau deteksinya rusak — badan `notFound` berubah, `api` berhenti
# menangkap — asersi inilah yang jatuh, bukan diam-diam meloloskan semuanya.
api "$OWNER" GET "/rute-mati-uji-diri-209" > /dev/null 2>&1 || true
cek "penjaga menggigit rute fiktif MESKIPUN galatnya ditelan tiga lapis" "V == 1" \
  "$(grep -cx 'GET /rute-mati-uji-diri-209' "$RUTE_MATI" || true)"
# Bukti kedua, dari seksi lain dan lewat pemanggil lain: §142 sengaja menembak
# rute fiktif untuk menguji pencatatan galat. Ia harus ikut tertangkap — kalau
# tidak, penjaganya cuma mengenali kalimatnya sendiri.
cek "…dan panggilan sengaja di §142 pun tercatat" "V == 1" \
  "$(grep -cx 'GET /endpoint-yang-tidak-ada-142' "$RUTE_MATI" || true)"

# ── Sisanya: rute mati yang TIDAK disengaja ───────────────────────────────
# Kedua entri di atas dikeluarkan SATU-SATU dan disebut namanya, bukan disaring
# dengan pola samar seperti "*uji*" — pola begitu kelak menelan rute mati
# sungguhan yang kebetulan namanya mirip.
SISA209=$(sort -u "$RUTE_MATI" \
  | grep -vx 'GET /rute-mati-uji-diri-209' \
  | grep -vx 'GET /endpoint-yang-tidak-ada-142' || true)
if [ -n "$SISA209" ]; then
  while IFS= read -r r209; do
    # `gagal`, bukan satu `cek` berisi hitungan: yang membaca log butuh NAMA
    # rutenya di ringkasan ekor, bukan angka "3".
    gagal "verify-api memanggil rute yang TIDAK ADA: $r209"
  done <<< "$SISA209"
else
  ok "tak ada panggilan ke rute yang tidak ada"
fi


if [ "$FAIL" -gt 0 ]; then
  echo
  echo "── RINGKASAN $FAIL KEGAGALAN (diulang di sini supaya terlihat dari ekor log) ──"
  for g in "${GAGAL_RINGKAS[@]}"; do echo "  ✘ $g"; done
  echo
fi
echo "=== Hasil: $PASS lolos, $FAIL gagal ==="
[ "$FAIL" -eq 0 ]
