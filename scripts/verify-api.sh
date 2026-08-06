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
ok()   { PASS=$((PASS+1)); echo "  ✔ $1"; }
gagal(){ FAIL=$((FAIL+1)); echo "  ✘ $1"; }
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
daftar_verif() { # <email> <password> <nama>
  local email="$1" pass="$2" nama="${3:-Uji}" reg vt
  reg=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"nama\":\"$nama\",\"email\":\"$email\",\"password\":\"$pass\"}")
  vt=$(echo "$reg" | jq -r '.dev_verify_url // ""' | sed -n 's/.*token=//p')
  [ -z "$vt" ] && return 0
  curl -s -X POST "$BASE/api/auth/verify-email" -H 'Content-Type: application/json' \
    -d "{\"token\":\"$vt\"}" | jq -r '.token // ""'
}

api() { # api <token> <method> <path> [json-body]
  local token="$1" method="$2" path="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$BASE/api$path" -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -X "$method" "$BASE/api$path" -H "Authorization: Bearer $token"
  fi
}

status_code() { # status_code <token> <method> <path>
  curl -s -o /dev/null -w '%{http_code}' -X "$2" "$BASE/api$3" -H "Authorization: Bearer $1"
}

status_code_body() { # status_code_body <token> <method> <path> <json-body>
  curl -s -o /dev/null -w '%{http_code}' -X "$2" "$BASE/api$3" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$4"
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
api "$OWNER" PATCH /company '{"diskon_maks_persen":0}' > /dev/null
cek "batas 0: kasir diskon 5% ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":5,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
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
DARI80=$(date -d yesterday +%F); SAMPAI80=$(date -d tomorrow +%F)
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
cek "belum diterima: saldo CK masih 8, cabang masih 0" "V == 1" \
  "$(api "$OWNER" GET "/perlengkapan?branch_id=$CB46_ID" | jq --arg id "$TU84" '([.[]|select(.id==$id)][0] | (.saldo == 0) and (.saldo_ck == 8)) | if . then 1 else 0 end')"
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
api "$OWNER" POST "/absensi/masuk" "{\"branch_id\":\"$CB152\"}" > /dev/null 2>&1 || true
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
api "$OWNER" POST "/absensi/masuk" "{\"branch_id\":\"$CB152\"}" > /dev/null 2>&1 || true
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
  api "$OWNER" POST "/absensi/masuk" "{\"branch_id\":\"$CB154\"}" > /dev/null 2>&1 || true
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
  api "$OWNER" POST "/absensi/masuk" "{\"branch_id\":\"$CB155\"}" > /dev/null 2>&1 || true
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
  api "$OWNER" POST "/absensi/masuk" "{\"branch_id\":\"$CB156\"}" > /dev/null 2>&1 || true
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

echo "=== Hasil: $PASS lolos, $FAIL gagal ==="
[ "$FAIL" -eq 0 ]
