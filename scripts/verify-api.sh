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
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stok/penyesuaian/$PENY_ID/klarifikasi" -H "Authorization: Bearer $KASIR" -H 'Content-Type: application/json' -d '{"kategori":"waste_bahan","catatan":"x"}')"
api "$KASIR" POST "/stok/penyesuaian/$PENY_ID/klarifikasi" "{\"kategori\":\"waste_bahan\",\"catatan\":\"tumpah\",\"foto_url\":\"$FOTO\"}" > /dev/null
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
api "$KASIR" POST "/stok/penyesuaian/$PID2/klarifikasi" "{\"kategori\":\"waste_bahan\",\"foto_url\":\"$FOTO\"}" > /dev/null
api "$OWNER" POST "/stok/penyesuaian/$PID2/tolak" "{\"alasan\":\"bukti kurang jelas\"}" > /dev/null
DIT=$(api "$KASIR" GET "/stok/penyesuaian?status=belum")
cek "ditolak: kembali ke 'belum'" "V == 1" \
  "$(echo "$DIT" | jq --arg id "$PID2" '[.[] | select(.id == $id and .klarifikasi_status == "belum")] | length')"
cek "ditolak: alasan tersimpan" "V == 1" \
  "$(echo "$DIT" | jq --arg id "$PID2" '[.[] | select(.id == $id and .tolak_alasan == "bukti kurang jelas")] | length')"
cek "ditolak: stok belum berubah (masih fisik lama)" "abs(V - $FISIK) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
# klarifikasi ulang → setujui → stok jadi fisik2
api "$KASIR" POST "/stok/penyesuaian/$PID2/klarifikasi" "{\"kategori\":\"koreksi_pencatatan\",\"foto_url\":\"$FOTO\"}" > /dev/null
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
cek "rows urut waktu naik (terlama dulu)" "V == 1" \
  "$(echo "$LGP" | jq '(((.rows|length)==0) or (.rows[0].waktu <= .rows[-1].waktu)) | if . then 1 else 0 end')"
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

echo
echo "=== Hasil: $PASS lolos, $FAIL gagal ==="
[ "$FAIL" -eq 0 ]
