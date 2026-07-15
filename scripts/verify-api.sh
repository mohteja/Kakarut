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
api "$OWNER" DELETE "/penjualan/$VA_ID" "{\"password\":\"$OWNER_PASS\"}" > /dev/null   # void (soft-delete) transaksi pertama
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

# 17b. Penjualan hari ini → rekomendasi (acuan = hari ini)
MENU_ID=$(api "$OWNER" GET /menu | jq -r '[.[] | select(.tipe == "regular")][0].id')
api "$OWNER" POST /penjualan "{\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$MENU_ID\",\"qty\":3}]}" > /dev/null
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
cek "rekomendasi: saran_beli == max(0, kebutuhan-sisa)" "abs(V) < 0.5" \
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

echo "== 21. Audit + Tempat Sampah (soft-delete + verifikasi password) =="
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

# DELETE (soft): password salah → 401; benar → saldo balik, hilang dari list, muncul di sampah
cek "DELETE faktur password salah → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/pembelian/faktur/$FKID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"password":"salah"}')"
api "$OWNER" DELETE "/pembelian/faktur/$FKID" "{\"password\":\"$OWNER_PASS\"}" > /dev/null
cek "hapus pembelian → saldo balik ke awal" "abs(V) < 0.001" "$(python3 -c "print($(saldo_bahan "$BELI_ING") - $S0)")"
cek "faktur terhapus hilang dari /pembelian" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKID" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "pembelian ada di Tempat Sampah + dihapus_oleh" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg f "$FKID" '([.[] | select(.jenis=="pembelian" and .key==$f and (.dihapus_oleh|type)=="string")] | length==1) | if . then 1 else 0 end')"

# Penjualan: soft-delete owner+password → omzet turun, hilang dari riwayat, masuk sampah
MENU_S=$(api "$KASIR" GET /menu | jq -r '[.[] | select(.tipe=="regular")][0].id')
MJ=$(api "$KASIR" GET /meja | jq -r '[.[] | select(.tipe=="dine_in" and .is_active)][0].id')
SL=$(api "$KASIR" POST /penjualan "{\"meja_id\":\"$MJ\",\"items\":[{\"menu_id\":\"$MENU_S\",\"qty\":2}]}")
SLID=$(echo "$SL" | jq -r '.sale.id')
OMZ1=$(api "$OWNER" GET "/laporan?tanggal=$HARI" | jq '.omzet')
cek "kasir hapus penjualan → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/penjualan/$SLID" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"password":"'"$KASIR_PASS"'"}')"
cek "owner hapus penjualan password salah → 401" "V == 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/penjualan/$SLID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"password":"salah"}')"
api "$OWNER" DELETE "/penjualan/$SLID" "{\"password\":\"$OWNER_PASS\"}" > /dev/null
cek "penjualan terhapus hilang dari riwayat" "V == 0" \
  "$(api "$KASIR" GET "/penjualan?tanggal=$HARI" | jq --arg id "$SLID" '[.[] | select(.id==$id)] | length')"
cek "hapus penjualan → omzet laporan turun" "V == 1" \
  "$(python3 -c "print(1 if $(api "$OWNER" GET "/laporan?tanggal=$HARI" | jq '.omzet') < $OMZ1 else 0)")"
cek "penjualan ada di Tempat Sampah" "V == 1" \
  "$(api "$OWNER" GET /sampah | jq --arg id "$SLID" '([.[] | select(.jenis=="penjualan" and .key==$id)] | length==1) | if . then 1 else 0 end')"
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

cek "faktur produksi tanpa pelaksana (worker/supplier) ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/faktur" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"batch\",\"jumlah\":1}]}")"
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

cek "tahap dikerjakan→menunggu ok" "V == 1" \
  "$(api "$OWNER" POST "/produksi/tahap/$FK24_ID" '{"ke":"menunggu"}' | jq '(.status == "menunggu") | if . then 1 else 0 end')"
cek "saldo masih belum berubah (menunggu)" "abs(V - $SALDO24) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "baso urat besar")"
api "$OWNER" POST "/produksi/konfirmasi/$FK24_ID" > /dev/null
cek "setelah konfirmasi: saldo bertambah +isi" "abs(V - ($SALDO24 + $ISI24)) < 0.001" \
  "$(stok_of "$(api "$OWNER" GET /stok)" "baso urat besar")"
cek "setelah konfirmasi: produksi_berjalan hilang" "V == 1" \
  "$(api "$OWNER" GET /stok | jq '[.[] | select(.slug == "baso urat besar")][0] | (.produksi_berjalan == null) | if . then 1 else 0 end')"

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

echo "== 25. Pembelian 4 tahap + penerimaan toko (terima/sebagian/tolak/batal) =="
BELI25=$(api "$OWNER" GET /bahan | jq -r '[.[] | select(.pengadaan == "beli" and .track_stok == true)][0].id')
SALDO25=$(saldo_bahan "$BELI25")

# Faktur A: RAB → diproses → dikirim → kasir terima SEBAGIAN (pesan 10, terima 6)
FKA25=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI25\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":1000}]}")
FKA25_ID=$(echo "$FKA25" | jq -r .faktur_id)
cek "faktur pembelian dibuat berstatus rencana (RAB)" "V == 1" \
  "$(echo "$FKA25" | jq '(.status == "rencana") | if . then 1 else 0 end')"
cek "konfirmasi pembelian dari rencana ditolak (404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/konfirmasi/$FKA25_ID" -H "Authorization: Bearer $OWNER")"
cek "kasir: kiriman rencana belum tampil di /penerimaan" "V == 0" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FKA25_ID" '[.rows[] | select(.faktur_id==$f)] | length')"
api "$OWNER" POST "/pembelian/tahap/$FKA25_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKA25_ID" '{"ke":"menunggu"}' > /dev/null
cek "kasir: kiriman dikirim tampil di /penerimaan" "V == 1" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FKA25_ID" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "saldo belum berubah saat dikirim" "abs(V - $SALDO25) < 0.001" "$(saldo_bahan "$BELI25")"
ROW25=$(api "$KASIR" GET /penerimaan | jq -r --arg f "$FKA25_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
cek "kasir terima-sebagian ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FKA25_ID/terima-sebagian" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$ROW25\",\"qty_diterima\":6}]}")"
cek "saldo +6 (bukan +10) setelah terima sebagian" "abs(V - ($SALDO25 + 6)) < 0.001" "$(saldo_bahan "$BELI25")"
ROWA25=$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKA25_ID" '[.rows[] | select(.faktur_id==$f)][0]')
cek "baris: qty=6, dipesan=10, harga prorata 600" "V == 1" \
  "$(echo "$ROWA25" | jq '((.qty == 6) and (.qty_dipesan == 10) and (.total_harga == 600) and (.status == "dikonfirmasi")) | if . then 1 else 0 end')"

# Faktur B: dikirim → kasir TOLAK (alasan) → batal-tolak (salah cek) → selesai + stok masuk
FKB25=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI25\",\"mode\":\"pcs\",\"jumlah\":5,\"total_harga\":500}]}")
FKB25_ID=$(echo "$FKB25" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKB25_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKB25_ID" '{"ke":"menunggu"}' > /dev/null
SALDO25B=$(saldo_bahan "$BELI25")
cek "kasir tolak kiriman ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FKB25_ID/tolak" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"alasan":"barang kurang"}')"
cek "kiriman ditolak tampil dgn alasan di /penerimaan" "V == 1" \
  "$(api "$KASIR" GET /penerimaan | jq --arg f "$FKB25_ID" '[.rows[] | select(.faktur_id==$f and .status=="ditolak" and .alasan_tolak=="barang kurang")] | length')"
cek "saldo tidak berubah setelah tolak" "abs(V - $SALDO25B) < 0.001" "$(saldo_bahan "$BELI25")"
cek "kasir batal-tolak ok (salah cek → selesai)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FKB25_ID/batal-tolak" -H "Authorization: Bearer $KASIR")"
cek "setelah batal-tolak: saldo +5 (selesai/masuk stok)" "abs(V - ($SALDO25B + 5)) < 0.001" "$(saldo_bahan "$BELI25")"
cek "status faktur jadi dikonfirmasi (selesai)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKB25_ID" '([.rows[] | select(.faktur_id==$f)][0].status == "dikonfirmasi") | if . then 1 else 0 end')"

echo "== 26. Perbaikan review: batas qty, batal-tolak sebagian, waktu vs opname =="
BELI26=$BELI25

# (a) terima-sebagian tak boleh melebihi qty yang dikirim (cegah inflasi stok)
FKC26=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":800}]}")
FKC26_ID=$(echo "$FKC26" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKC26_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKC26_ID" '{"ke":"menunggu"}' > /dev/null
ROWC26=$(api "$KASIR" GET /penerimaan | jq -r --arg f "$FKC26_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
SALDO26A=$(saldo_bahan "$BELI26")
cek "terima-sebagian qty>dikirim ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FKC26_ID/terima-sebagian" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$ROWC26\",\"qty_diterima\":999}]}")"
cek "saldo tak berubah setelah tolakan batas qty" "abs(V - $SALDO26A) < 0.001" "$(saldo_bahan "$BELI26")"
api "$KASIR" POST "/penerimaan/$FKC26_ID/terima" > /dev/null  # beres-kan agar tak polusi

# (b) batal-tolak diblok bila faktur sudah diterima SEBAGIAN (baris ditolak memang tak diterima)
FKD26=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":4,\"total_harga\":400},{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":6,\"total_harga\":600}]}")
FKD26_ID=$(echo "$FKD26" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKD26_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKD26_ID" '{"ke":"menunggu"}' > /dev/null
R1_26=$(api "$KASIR" GET /penerimaan | jq -r --arg f "$FKD26_ID" '[.rows[] | select(.faktur_id==$f)][0].id')
R2_26=$(api "$KASIR" GET /penerimaan | jq -r --arg f "$FKD26_ID" '[.rows[] | select(.faktur_id==$f)][1].id')
cek "terima-sebagian campur (1 terima, 1 tolak) ok (200)" "V == 200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FKD26_ID/terima-sebagian" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"id\":\"$R1_26\",\"qty_diterima\":3},{\"id\":\"$R2_26\",\"qty_diterima\":0}],\"alasan\":\"sebagian kosong\"}")"
cek "batal-tolak faktur diterima-sebagian diblok (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penerimaan/$FKD26_ID/batal-tolak" -H "Authorization: Bearer $KASIR")"
cek "faktur campuran: 1 baris dikonfirmasi + 1 baris ditolak" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FKD26_ID" '[.rows[] | select(.faktur_id==$f)] | (([.[]|select(.status=="dikonfirmasi")]|length)==1 and ([.[]|select(.status=="ditolak")]|length)==1) | if . then 1 else 0 end')"

# (c) barang diterima SETELAH opname tetap masuk saldo (waktu = saat terima, bukan RAB)
FKE26=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":7,\"total_harga\":700}]}")
FKE26_ID=$(echo "$FKE26" | jq -r .faktur_id)
api "$OWNER" POST "/pembelian/tahap/$FKE26_ID" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FKE26_ID" '{"ke":"menunggu"}' > /dev/null
SBASE26=$(saldo_bahan "$BELI26")   # barang belum diterima → sistem = saldo saat ini
# opname selisih 0 → langsung jadi baseline (disetujui), created_at = sekarang
api "$OWNER" POST /stok/opname "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"qty\":$SBASE26}],\"catatan\":\"opname sblm terima\"}" > /dev/null
cek "opname baseline aktif (saldo == fisik)" "abs(V - $SBASE26) < 0.001" "$(saldo_bahan "$BELI26")"
api "$KASIR" POST "/penerimaan/$FKE26_ID/terima" > /dev/null   # terima SETELAH opname
cek "barang diterima setelah opname tetap masuk saldo (+7)" "abs(V - ($SBASE26 + 7)) < 0.001" \
  "$(saldo_bahan "$BELI26")"

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

echo "== 28. Stok: pembelian berjalan (RAB→diproses→dikirim) tampil sbg stok masa depan =="
pb_qty() { api "$OWNER" GET /stok | jq --arg id "$1" '([.[]|select(.ingredient_id==$id)][0].pembelian_berjalan // {qty:0}).qty'; }
pb_rencana() { api "$OWNER" GET /stok | jq --arg id "$1" '([.[]|select(.ingredient_id==$id)][0].pembelian_berjalan // {rencana:0}).rencana'; }
PB0=$(pb_qty "$BELI26")
FPB=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI26\",\"mode\":\"pcs\",\"jumlah\":8,\"total_harga\":800}]}" | jq -r .faktur_id)
cek "stok: pembelian_berjalan +8 saat faktur RAB dibuat" "abs(V - ($PB0 + 8)) < 0.001" "$(pb_qty "$BELI26")"
cek "stok: pembelian_berjalan.rencana memuat 8" "V >= 8" "$(pb_rencana "$BELI26")"
api "$OWNER" POST "/pembelian/tahap/$FPB" '{"ke":"dikerjakan"}' > /dev/null
api "$OWNER" POST "/pembelian/tahap/$FPB" '{"ke":"menunggu"}' > /dev/null
cek "stok: pembelian_berjalan tetap +8 saat dikirim (menunggu)" "abs(V - ($PB0 + 8)) < 0.001" "$(pb_qty "$BELI26")"
SBPB=$(saldo_bahan "$BELI26")
api "$OWNER" POST "/penerimaan/$FPB/terima" > /dev/null
cek "stok: pembelian_berjalan turun −8 setelah diterima" "abs(V - $PB0) < 0.001" "$(pb_qty "$BELI26")"
cek "stok: saldo +8 setelah diterima (masuk stok)" "abs(V - ($SBPB + 8)) < 0.001" "$(saldo_bahan "$BELI26")"

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

echo "== 31. Batas maksimal diskon kasir (owner/admin bebas) =="
jp() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }
api "$OWNER" PATCH /company '{"diskon_maks_persen":20}' > /dev/null
cek "company: diskon_maks_persen tersimpan 20" "V == 20" "$(api "$OWNER" GET /company | jq '.diskonMaksPersen')"
cek "kasir diskon 50% (> batas 20%) ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":50,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "kasir diskon nominal 17000 (=50% > batas) ditolak (400)" "V == 400" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"nominal\",\"diskon_nilai\":17000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "kasir diskon 20% (= batas) diterima (201)" "V == 201" \
  "$(jp "$KASIR" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":20,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "owner diskon 50% (bypass batas) diterima (201)" "V == 201" \
  "$(jp "$OWNER" "{\"is_dine_in\":false,\"diskon_tipe\":\"persen\",\"diskon_nilai\":50,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
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
SH=$(api "$KASIR" POST /shift/buka '{"modal_awal":200000}')
cek "buka shift: modal awal 200000" "V == 200000" "$(echo "$SH" | jq '.modal_awal')"
cek "buka shift: masih terbuka" "V == 1" "$(echo "$SH" | jq '(.ditutup_pada == null) | if . then 1 else 0 end')"
cek "buka shift kedua ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/shift/buka" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"modal_awal":0}')"
# transaksi dalam shift: tunai + qris
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"metode_bayar\":\"tunai\",\"uang_diterima\":50000,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" > /dev/null
api "$KASIR" POST /penjualan "{\"is_dine_in\":false,\"metode_bayar\":\"qris\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}" > /dev/null
AK=$(api "$KASIR" GET /shift/aktif)
cek "shift aktif: penjualan tunai >= 34000" "V >= 34000" "$(echo "$AK" | jq '.penjualan_tunai')"
cek "shift aktif: non-tunai >= 34000" "V >= 34000" "$(echo "$AK" | jq '.penjualan_nontunai')"
cek "shift aktif: kas sistem = modal + tunai" "V == 1" \
  "$(echo "$AK" | jq '(.kas_sistem == (.modal_awal + .penjualan_tunai)) | if . then 1 else 0 end')"
KAS=$(echo "$AK" | jq '.kas_sistem')
TU=$(api "$KASIR" POST /shift/tutup "{\"uang_fisik\":$KAS}")
cek "tutup shift: selisih 0 (uang fisik = kas)" "V == 1" "$(echo "$TU" | jq '(.selisih == 0) | if . then 1 else 0 end')"
cek "tutup shift: ditutup terisi" "V == 1" "$(echo "$TU" | jq '(.ditutup_pada != null) | if . then 1 else 0 end')"
cek "setelah tutup: tak ada shift aktif" "V == 1" "$(api "$KASIR" GET /shift/aktif | jq '(. == null) | if . then 1 else 0 end')"
cek "riwayat shift: ada shift tertutup" "V >= 1" "$(api "$KASIR" GET /shift | jq 'length')"

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
KODE_KAR=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role == "cashier")][0].employee_code')
# kasir (semua peran boleh) mengabsen via kode → cap pertama = masuk
A1=$(api "$KASIR" POST /absensi "{\"kode\":\"$KODE_KAR\"}")
cek "absen pertama = masuk" "V == 1" "$(echo "$A1" | jq '(.tipe == "masuk") | if . then 1 else 0 end')"
cek "absen mengembalikan nama karyawan" "V == 1" "$(echo "$A1" | jq '(.nama | length > 0) | if . then 1 else 0 end')"
cek "absen mengembalikan waktu (ISO)" "V == 1" "$(echo "$A1" | jq '(.waktu | length > 0) | if . then 1 else 0 end')"
# cap berikutnya untuk karyawan yang sama = keluar (auto-detect dari cap terakhir)
A2=$(api "$KASIR" POST /absensi "{\"kode\":\"$KODE_KAR\"}")
cek "absen kedua = keluar (auto-detect)" "V == 1" "$(echo "$A2" | jq '(.tipe == "keluar") | if . then 1 else 0 end')"
# kode case-insensitive (huruf kecil tetap dikenali)
A3=$(api "$KASIR" POST /absensi "{\"kode\":\"$(echo "$KODE_KAR" | tr 'A-Z' 'a-z')\"}")
cek "kode absensi case-insensitive → masuk lagi" "V == 1" "$(echo "$A3" | jq '(.tipe == "masuk") | if . then 1 else 0 end')"
# daftar absensi hari ini memuat karyawan dengan jam masuk & keluar terisi
LIST=$(api "$KASIR" GET /absensi)
cek "daftar absensi: masuk terisi" "V == 1" \
  "$(echo "$LIST" | jq --arg k "$KODE_KAR" '[.[] | select(.employee_code == $k) | select(.masuk != null)] | length')"
cek "daftar absensi: keluar terisi" "V == 1" \
  "$(echo "$LIST" | jq --arg k "$KODE_KAR" '[.[] | select(.employee_code == $k) | select(.keluar != null)] | length')"
# kode karyawan tak dikenal → 404
cek "kode karyawan tak dikenal → 404" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"kode":"ZZZNOPE"}')"
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

# 3) dgn items boleh lompat maju: sisa B (rencana) langsung → menunggu (dikirim)
ID42B2=$(echo "$B42" | jq -r '[.[] | select(.status=="rencana")][0].id')
api "$OWNER" POST "/pembelian/tahap/$FK42_ID" "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID42B2\",\"qty\":5}]}" > /dev/null
cek "items: lompat maju rencana→menunggu diizinkan" "V == 1" \
  "$(baris42 | jq --arg b "$ID42B2" '([.[] | select(.id==$b)][0].status == "menunggu") | if . then 1 else 0 end')"

# 4) penjaga: mundur ditolak, qty melebihi ditolak, baris asing ditolak, dikonfirmasi tanpa items ditolak
cek "tahap mundur (menunggu→dikerjakan) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"dikerjakan\",\"items\":[{\"id\":\"$ID42B2\",\"qty\":5}]}")"
cek "qty maju melebihi qty baris → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"ke\":\"menunggu\",\"items\":[{\"id\":\"$ID42A\",\"qty\":999}]}")"
cek "baris bukan milik faktur → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"menunggu","items":[{"id":"00000000-0000-4000-8000-000000000000","qty":1}]}')"
cek "ke=dikonfirmasi tanpa items → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/tahap/$FK42_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"ke":"dikonfirmasi"}')"

# 5) konfirmasi SEBAGIAN baris A (4 dari 10) → split + hanya 4 yang masuk saldo
api "$OWNER" POST "/pembelian/tahap/$FK42_ID" "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$ID42A\",\"qty\":4}]}" > /dev/null
SA42_1=$(saldo_bahan "$ING42A"); SB42_1=$(saldo_bahan "$ING42B")
cek "konfirmasi sebagian: saldo A +4 saja" "abs(V - 4) < 0.001" "$(python3 -c "print($SA42_1 - $SA42_0)")"
cek "saldo B belum berubah (belum dikonfirmasi)" "abs(V) < 0.001" "$(python3 -c "print($SB42_1 - $SB42_0)")"
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
cek "item belum semua → A dikirim, B masih diproses (selesai sebagian)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?per_page=500" | jq --arg f "$FK44_ID" '([.rows[] | select(.faktur_id==$f)] | ([.[] | select(.status=="menunggu")] | length == 1) and ([.[] | select(.status=="dikerjakan")] | length == 1)) | if . then 1 else 0 end')"

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
cek "harga baris ter-update ke riil (55000) & dikirim" "V == 1" \
  "$(echo "$B45" | jq '((.total_harga == 55000) and (.status == "menunggu")) | if . then 1 else 0 end')"
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
  "$(echo "$B45B" | jq '([.[] | select(.status=="menunggu")][0] | (.qty == 3 and .total_harga == 18000)) | if . then 1 else 0 end')"
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
cek "cabang asal tinggal sisa tugas (baris B diproses)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$PUSAT46_ID&per_page=500" | jq --arg f "$FK46_ID" '([.rows[] | select(.faktur_id==$f)] | (length == 1) and (.[0].status == "dikerjakan")) | if . then 1 else 0 end')"

# diterima → stok masuk di cabang TUJUAN
S46_0=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$ING42A" '([.[] | select(.ingredient_id==$i)][0].saldo) // 0')
api "$OWNER" POST "/pembelian/konfirmasi/$FK46_ID" > /dev/null
S46_1=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq --arg i "$ING42A" '([.[] | select(.ingredient_id==$i)][0].saldo) // 0')
cek "diterima → saldo bertambah di cabang tujuan (+10)" "abs(V - 10) < 0.001" "$(python3 -c "print($S46_1 - $S46_0)")"

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
cek "profil owner: kode karyawan (QR absen) tersedia" "V == 1" \
  "$(echo "$PRF48" | jq '((.employee_code != null) and ((.employee_code | length) >= 2)) | if . then 1 else 0 end')"
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
api "$OWNER" POST "/pembelian/konfirmasi/$FK49_ID" > /dev/null
LOG49=$(api "$OWNER" GET "/pembelian/log/$FK49_ID")
cek "log faktur: 4 kegiatan (dibuat→diproses→dikirim→diterima)" "V == 4" "$(echo "$LOG49" | jq '.rows | length')"
cek "log: entri pertama 'Faktur dibuat' + ada pelakunya" "V == 1" \
  "$(echo "$LOG49" | jq '((.rows[0].aksi | test("dibuat")) and (.rows[0].oleh != null)) | if . then 1 else 0 end')"
cek "log: dana cair & realisasi tercatat di detail" "V == 1" \
  "$(echo "$LOG49" | jq '(([.rows[] | select((.detail // "") | test("dana cair"))] | length >= 1) and ([.rows[] | select((.detail // "") | test("realisasi"))] | length >= 1)) | if . then 1 else 0 end')"
OWN49_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
cek "aktivitas per karyawan memuat kegiatan faktur ini" "V == 1" \
  "$(api "$OWNER" GET "/karyawan/$OWN49_ID/aktivitas" | jq --arg f "$FK49_ID" '([.rows[] | select(.faktur_id == $f)] | length >= 4) | if . then 1 else 0 end')"
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
cek "jual menu terbatas di cabang lain → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/penjualan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"branch_id\":\"$CB46_ID\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
cek "open bill menu terbatas di cabang lain → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/open-bill" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"branch_id\":\"$CB46_ID\",\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")"
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
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE54\"}")"

# pulihkan → kembali ke daftar dgn kode sama, login & absen normal lagi
api "$OWNER" PATCH "/karyawan/$U54_ID" '{"arsip":false}' > /dev/null
cek "dipulihkan: kembali ke daftar dgn kode sama" "V == 1" \
  "$(api "$OWNER" GET /karyawan | jq --arg id "$U54_ID" --arg kode "$KODE54" '([.[] | select(.user_id==$id)][0] | (.employee_code == $kode and .archived_at == null)) | if . then 1 else 0 end')"
cek "dipulihkan: login kembali normal" "V == 1" \
  "$([ -n "$(login "arsip54@basooopa.id" "PwArsip54!")" ] && echo 1 || echo 0)"
cek "dipulihkan: absen dgn kode diterima" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE54\"}")"

# guard: tidak bisa mengunci diri sendiri; admin tak boleh mengarsipkan owner
OWN54_ID=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.role=="owner")][0].user_id')
cek "arsipkan akun sendiri → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$OWN54_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"arsip":true}')"
cek "nonaktifkan akun sendiri → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/karyawan/$OWN54_ID" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"is_active":false}')"
api "$OWNER" PATCH "/karyawan/$U53_ID" '{"is_active":true}' > /dev/null
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
# Stasiun absen (pindai QR) hanya admin/kasir — tim tak boleh mencatat absen
KODE_T56=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="tim56@basooopa.id")][0].employee_code')
cek "tim: pindai absensi (POST) → 403" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $T56" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE_T56\"}")"
cek "tim: daftar absensi (GET) → 403" "V == 403" "$(status_code "$T56" GET /absensi)"
cek "kasir: pindai absensi tetap boleh → 200" "V == 200" "$(status_code "$KASIR" GET /absensi)"

echo "== 57. Absen hanya dalam radius titik lokasi cabang =="
KODE56=$(api "$OWNER" GET /karyawan | jq -r '[.[] | select(.email=="tim56@basooopa.id")][0].employee_code')
cek "cabang tanpa titik lokasi: absen tanpa GPS tetap diterima" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\"}")"

# titik lokasi Pusat = Monas, radius 100 m
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"latitude":-6.175392,"longitude":106.827153,"radius_absen_m":100}' > /dev/null
cek "titik lokasi & radius cabang tersimpan" "V == 1" \
  "$(api "$OWNER" GET /cabang | jq --arg id "$PUSAT51_ID" '([.[] | select(.id==$id)][0] | (.latitude == -6.175392 and .longitude == 106.827153 and .radius_absen_m == 100)) | if . then 1 else 0 end')"
cek "absen tanpa koordinat → 400 (wajib GPS)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\"}")"
cek "absen di luar radius (±4,6 km) → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\",\"lat\":-6.137654,\"lng\":106.817125}")"
ABS57=$(api "$OWNER" POST /absensi "{\"kode\":\"$KODE56\",\"lat\":-6.175392,\"lng\":106.827553}")
cek "absen dalam radius (~44 m) diterima + jarak terlapor" "V == 1" \
  "$(echo "$ABS57" | jq '((.jarak_m != null) and (.jarak_m <= 100) and (.tipe != null)) | if . then 1 else 0 end')"
# kosongkan titik → aturan radius kembali nonaktif
api "$OWNER" PATCH "/cabang/$PUSAT51_ID" '{"latitude":null,"longitude":null}' > /dev/null
cek "titik dikosongkan: absen tanpa GPS diterima lagi" "V == 201" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/absensi" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"kode\":\"$KODE56\"}")"

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
# dua transaksi di dua cabang berbeda → kantor melihat keduanya sekaligus
J60A=$(api "$OWNER" POST /penjualan "{\"branch_id\":\"$PUSAT51_ID\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
J60B=$(api "$OWNER" POST /penjualan "{\"branch_id\":\"$CB46_ID\",\"is_dine_in\":false,\"items\":[{\"menu_id\":\"$PBA_ID\",\"qty\":1}]}")
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
# faktur produksi lahir di CK dgn tujuan = store, tanpa pelaksana, status rencana
cek "faktur produksi: tujuan=store, worker null, rencana" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_FID" --arg s "$CB46_ID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .tujuan_branch_id==$s and .worker_id==null and .status=="rencana")) | if . then 1 else 0 end')"
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

# selesai → tersimpan di CK (menunggu, masih di CK, tujuan tetap)
api "$TCK58" POST "/produksi/tahap/$WO_FID" '{"ke":"menunggu"}' > /dev/null
cek "selesai: menunggu, masih di CK, tujuan store" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_FID" --arg s "$CB46_ID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="menunggu" and .tujuan_branch_id==$s)) | if . then 1 else 0 end')"
# belum tampil di penerimaan store (belum dikirim)
cek "belum dikirim: tidak di penerimaan store" "V == 0" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$WO_FID" '[.rows[] | select(.faktur_id==$f)] | length')"

# GUARD: work-order TIDAK boleh dikonfirmasi di CK (harus lewat kirim→penerimaan)
WO_RID_CK=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$WO_FID" '[.rows[] | select(.faktur_id==$f)][0].id')
WO_QTY_CK=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$WO_FID" '[.rows[] | select(.faktur_id==$f)][0].qty')
cek "work-order: /tahap dikonfirmasi di CK → 400" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/tahap/$WO_FID" -H "Authorization: Bearer $TCK58" -H 'Content-Type: application/json' -d "{\"ke\":\"dikonfirmasi\",\"items\":[{\"id\":\"$WO_RID_CK\",\"qty\":$WO_QTY_CK}]}")"
cek "work-order: /konfirmasi di CK → 404 (tak ada baris non-work-order)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/produksi/konfirmasi/$WO_FID" -H "Authorization: Bearer $TCK58")"
cek "guard: baris tetap menunggu di CK (tak jadi stok CK)" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f)] | all(.[]; .status=="menunggu")) | if . then 1 else 0 end')"

# kirim ke cabang → baris pindah ke store, tetap menunggu
ING_WO=$(api "$OWNER" GET "/produksi?branch_id=$CK52_UTAMA&per_page=500" | jq -r --arg f "$WO_FID" '[.rows[] | select(.faktur_id==$f)][0].ingredient_id')
SALDO_SEB=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq -r --arg i "$ING_WO" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')
api "$TCK58" POST "/produksi/kirim/$WO_FID" '{}' > /dev/null
cek "kirim: baris ada di store, status menunggu" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="menunggu")) | if . then 1 else 0 end')"
# kiriman produksi kini muncul di penerimaan store (jalur produksi)
cek "kiriman produksi muncul di penerimaan store (jalur produksi)" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f and .jalur=="produksi")] | length > 0) | if . then 1 else 0 end')"

# store terima → dikonfirmasi + saldo store naik
api "$OWNER" POST "/penerimaan/$WO_FID/terima" > /dev/null
cek "diterima: baris dikonfirmasi di store" "V == 1" \
  "$(api "$OWNER" GET "/produksi?branch_id=$CB46_ID&per_page=500" | jq --arg f "$WO_FID" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="dikonfirmasi")) | if . then 1 else 0 end')"
SALDO_SES=$(api "$OWNER" GET "/stok?branch_id=$CB46_ID" | jq -r --arg i "$ING_WO" '[.[] | select(.ingredient_id==$i)][0].saldo // 0')
cek "diterima: saldo bahan di store bertambah" "V == 1" \
  "$(jq -n --argjson a "$SALDO_SEB" --argjson b "$SALDO_SES" '($b > $a) | if . then 1 else 0 end')"

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
cek "stok awal oleh KASIR ditolak (403)" "V == 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/awal" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d "{\"items\":[{\"ingredient_id\":\"$SA_ING\",\"qty\":1}]}")"

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
cek "resep dgn bahan mentah jenis produksi ditolak (400)" "V == 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/bahan/$BASO66/resep" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"komponen\":[{\"ingredient_id\":\"$BASO66\",\"qty\":1}]}")"
api "$OWNER" PUT "/bahan/$BASO66/resep" "{\"komponen\":[{\"ingredient_id\":\"$DAG66\",\"qty\":2000},{\"ingredient_id\":\"$TEP66\",\"qty\":300}]}" > /dev/null
cek "GET resep memuat 2 bahan mentah" "V == 2" "$(api "$OWNER" GET "/bahan/$BASO66/resep" | jq 'length')"
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
# MOQ (min_beli): daging minimal belanja 12000 → qty_faktur naik ke 12000
api "$OWNER" PUT "/bahan/$DAG66" '{"min_beli":12000}' > /dev/null
# reorder point (stok_minimum): tepung 700 → kurang 1500+700 = 2200 → 5 kemasan (2500)
api "$OWNER" PUT "/bahan/$TEP66" '{"stok_minimum":700}' > /dev/null
cek "PUT parsial tak me-reset satuan bahan (tetap gr)" "V == 1" \
  "$(api "$OWNER" GET /bahan | jq --arg id "$DAG66" '[.[] | select(.id==$id)][0].satuan == "gr" | if . then 1 else 0 end')"
PV66B=$(api "$OWNER" POST "/rekomendasi/menu?branch_id=$CB46_ID" "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"ck_branch_id\":\"$CK52_UTAMA\"}")
cek "MOQ: qty_faktur daging dibulatkan naik ke 12000" "abs(V - 12000) < 0.001" \
  "$(echo "$PV66B" | jq --arg id "$DAG66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].qty_faktur')"
cek "reorder point: qty_faktur tepung 2500 (kurang 2200 → 5 kemasan)" "abs(V - 2500) < 0.001" \
  "$(echo "$PV66B" | jq --arg id "$TEP66" '[.bahan_produksi[] | select(.ingredient_id==$id)][0].qty_faktur')"
# permintaan → 2 faktur: produksi (work-order CK) + belanja bahan produksi (terpisah)
WO66=$(api "$OWNER" POST /rekomendasi/menu/faktur "{\"items\":[{\"menu_id\":\"$MENU66\",\"porsi\":100}],\"tujuan_branch_id\":\"$CB46_ID\",\"ck_branch_id\":\"$CK52_UTAMA\"}")
PF66=$(echo "$WO66" | jq -r '.produksi.faktur_id')
BP66=$(echo "$WO66" | jq -r '.beli_produksi.faktur_id')
cek "permintaan menghasilkan faktur belanja bahan produksi terpisah" "V == 1" \
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
# permintaan kedua: stok bahan mentah CK masih cukup → TANPA faktur bahan produksi
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
cek "kategori bahan duplikat ditolak (409)" "V == 409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/kategori-bahan" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"nama":"frozen68b"}')"
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
# DIKIRIM (menunggu) → baris otomatis pindah ke cabang tujuan
api "$TCK58" POST "/pembelian/tahap/$BF71" '{"ke":"menunggu"}' > /dev/null
cek "dikirim: baris pindah ke store (menunggu)" "V == 1" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CB46_ID&per_page=500" | jq --arg f "$BF71" '([.rows[] | select(.faktur_id==$f)] | (length>0) and all(.[]; .status=="menunggu")) | if . then 1 else 0 end')"
cek "dikirim: tidak lagi tercatat di CK" "V == 0" \
  "$(api "$OWNER" GET "/pembelian?branch_id=$CK52_UTAMA&per_page=500" | jq --arg f "$BF71" '[.rows[] | select(.faktur_id==$f)] | length')"
cek "kiriman beli muncul di Penerimaan store" "V == 1" \
  "$(api "$OWNER" GET "/penerimaan?branch_id=$CB46_ID" | jq --arg f "$BF71" '([.rows[] | select(.faktur_id==$f and .jalur=="beli")] | length > 0) | if . then 1 else 0 end')"
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

echo
echo "=== Hasil: $PASS lolos, $FAIL gagal ==="
[ "$FAIL" -eq 0 ]
