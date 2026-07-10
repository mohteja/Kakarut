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

echo "== 7. Laporan harian =="
LAP=$(api "$OWNER" GET /laporan)
cek "omzet ≥ 79000 (2×PBA + paket)" "V >= 79000" "$(echo "$LAP" | jq .omzet)"
cek "profit = omzet − hpp" "V == 1" "$(echo "$LAP" | jq '(.estimasi_profit == (.omzet - .total_hpp)) | if . then 1 else 0 end')"
cek "ada item terjual" "V >= 2" "$(echo "$LAP" | jq '.item_terjual | length')"

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
api "$OWNER" POST "/pembelian/konfirmasi/$FKT_ID" > /dev/null
cek "setelah konfirmasi: plastik +200 (2 batch)" "abs(V - ($PLASTIK_SEBELUM + 200)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "plastik take away")"
cek "setelah konfirmasi: sedotan +50 (pcs)" "abs(V - ($SEDOTAN_SEBELUM + 50)) < 0.001" \
  "$(stok_of "$(api "$KASIR" GET /stok)" "sedotan")"
cek "konfirmasi ulang ditolak (404)" "V == 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/pembelian/konfirmasi/$FKT_ID" -H "Authorization: Bearer $OWNER")"
# faktur produksi: mode batch = n × isi
URAT_SEBELUM=$(stok_of "$(api "$KASIR" GET /stok)" "baso urat besar")
FKP=$(api "$OWNER" POST /produksi/faktur "{\"items\":[{\"ingredient_id\":\"$URATB_ID\",\"mode\":\"batch\",\"jumlah\":1,\"storage_location_id\":\"$TMP_ID\"}]}")
api "$OWNER" POST "/produksi/konfirmasi/$(echo "$FKP" | jq -r .faktur_id)" > /dev/null
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

# buat faktur pembelian 10 pcs → konfirmasi → saldo +10
FK=$(api "$OWNER" POST /pembelian/faktur "{\"items\":[{\"ingredient_id\":\"$BELI_ING\",\"mode\":\"pcs\",\"jumlah\":10,\"total_harga\":50000}]}")
FKID=$(echo "$FK" | jq -r '.faktur_id')
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

echo
echo "=== Hasil: $PASS lolos, $FAIL gagal ==="
[ "$FAIL" -eq 0 ]
