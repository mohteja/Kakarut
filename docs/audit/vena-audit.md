# Peta vena audit

Satu entri per **vena** — satu populasi yang disapu mekanis dari ujung ke
ujung. Berkas ini ada karena satu alasan tunggal: **ingatan**. Tanpa peta,
tiap sesi baru memeriksa ulang yang sudah bersih dan tak pernah sampai ke yang
belum tersentuh.

## Kenapa mekanis, bukan membaca modul

Hampir setiap bug yang ditemukan berbentuk sama, dan bentuknya BUKAN "tak ada
yang memikirkan aturan ini":

> Aturannya sudah dipikirkan, ditulis, bahkan dikomentari panjang. Penjaganya
> dipasang di **satu** pintu menuju keadaan yang dijaga, lalu pintu lain ke
> keadaan yang sama dibiarkan terbuka.

`sql<number>` tanpa cast, `date -u` di §218, dan `POST /karyawan/undang` tanpa
batas laju semuanya begitu — pada dua yang terakhir, komentar di berkas yang
SAMA sudah menuliskan aturannya. Tak satu pun ditemukan dengan membaca kode;
semuanya muncul dari menyapu seluruh populasi lalu memisahkan yang menyimpang.

## Aturan menulis entri

Tanpa keempatnya, berkas ini berubah jadi daftar hijau yang tak pernah dibayar:

1. **"BERSIH" hanya sah bila detektornya DIBUKTIKAN bisa menuduh.** Baris
   `Detektor:` wajib menyebut bagaimana pembuktiannya. Sapuan yang tak pernah
   merah tidak menyatakan apa pun.
2. **Populasinya disebut angkanya.** "Sudah diperiksa" tanpa angka tak bisa
   ditinjau siapa pun.
3. **Temuan memuat ukurannya**, sebelum dan sesudah.
4. **Batas detektornya ditulis jujur.** Vena yang bersih *dalam batas tertentu*
   bukan vena yang bersih.
5. **CAKUPAN disebut, bukan cuma kemampuan menuduh.** Bukti merah menjawab
   "bisakah detektornya menuduh?" — ia TIDAK menjawab "berapa banyak yang
   dilihatnya?". Sudah terjadi: gerbang larik dibuktikan bisa menuduh, lalu
   dikirim dengan regex yang hanya melihat 18 dari 39. Tiap entri karena itu
   menyebut populasinya, dan sedapat mungkin membandingkannya dengan cara
   hitung kedua.

6. **DATA SUNTIKAN WAJIB DIBUKTIKAN TERBACA.** Mengukur di atas data uji hanya
   sah bila kuerinya benar-benar MELIHAT data itu — dan yang membuktikannya
   angka dari balasan rutenya sendiri, bukan `SELECT count(*)` di basis data.
   Sudah terjadi, dan menghasilkan kesimpulan yang salah masuk ledger: 50.111
   penjualan yang kusuntikkan mendarat di PERUSAHAAN LAIN, sementara tokennya
   milik perusahaan yang punya 98. Kuerinya tak pernah melihat satu pun baris
   itu, dan "laporan agregat ternyata murah (0,035 dtk)" tercatat sebagai
   temuan terukur. Diukur ulang dengan tenant yang benar: **0,212 dtk**.
   `scripts/ukur-latensi.sh` menolak berjalan sampai premis itu terbukti.

---

## Arah GANTI-NAMA: 500 di alur harian, telanjang di sebelah saudaranya — server — 2026-08-24

- **Kenapa**: entri klik-ganda menulis *"balapan ganti-nama … berpenjaga
  `tanpaBentrok` per situs"* — keyakinan yang **belum pernah disapu**: vena
  sebelumnya hanya menghitung `.insert()`; arah `.update()` tak pernah dihitung
- **Populasi**: **37** situs `.update()` ke tabel unik · **9** tertuduh jendela
  · dipilah tangan: **7 tuduhan palsu** (medan struk, deaktivasi, backfill
  ber-uniquifier, memberships menulis role/arsip) · **1 telanjang** — persis
  tanda tangan sesi ini, **di berkas yang sama**: `POST /menu` dijaga
  `onConflictDoNothing`+409; `PUT /menu/:id` **80 baris di bawahnya** menulis
  `nama` tanpa apa pun
- **Terukur lewat HTTP — TAK BUTUH BALAPAN**:

  | | sebelum | sesudah |
  |---|---|---|
  | ganti nama menu B → nama menu A (**berurutan**) | **HTTP 500** | **409** `Menu "…" sudah ada` |
  | ganti-nama sah | 200 | 200 |
  | 4 ganti-nama serentak ke SATU nama | — | `200 200 409 409`, nol 5xx, **tepat satu** pemegang nama |

  Alur manajemen menu harian, bukan kasus tepi
- **Kembaran** `PUT /customer/:id` (WA): berurutan dijaga pra-cek (409 menyebut
  pemiliknya), jeda pra-cek→tulis kini juga dibungkus `tanpaBentrok`
- **Detektor**: DIBUKTIKAN — pembungkus dicabut (di-assert) → 500 terukur
  kembali; dikembalikan → 409
- **Tindak**: `tanpaBentrok` di kedua pintu · verify-api **§246** (8 asersi)
- **Batas**: yang dipaku dua pintu yang terukur; 28 situs `.update()` lain
  dinyatakan aman lewat pilahan baca (kolom non-unik / uniquifier / penjaga
  per situs), bukan lewat tembakan. Dan **dua kali** kubaca "cakupan BEDA
  271→0" yang ternyata **cwd-ku sendiri salah** (stderr tertelan `/dev/null`)
  — regenerasi dari cwd benar: identik
- Gerbang: typecheck bersih · `npm test` **2.207** · `verify-api` **2.913**
  terhadap Postgres segar · `audit:invarian` 26/26 · cakupan 271 identik

---

## ANTREAN KELIMA — usulan dari celah yang tercatat di ledger — 2026-08-24

Antrean keempat tuntas. Yang di bawah **diukur baca-saja hari ini**; tiap
usulan menunjuk baris "Batas" yang melahirkannya.

### Usulan A′ — arah GANTI-NAMA tak pernah disapu

**Sumbernya**: entri klik-ganda menulis — *"balapan ganti-nama tak ikut dipaku
— berpenjaga `tanpaBentrok` per situs."* Kalimat "berpenjaga per situs" itu
**keyakinan yang belum pernah disapu**: vena A hanya menghitung `.insert()`;
arah `.update()` belum pernah dihitung sekali pun.

**Diukur**: **37** situs `.update()` ke tabel berindeks unik, **9** menulis
kolom uniknya tanpa penjaga di jendela. Dipilah sebagian: dua tuduhan palsu
jendela, satu **terkonfirmasi telanjang — dan bentuknya persis tanda tangan
sesi ini, di berkas yang sama**: `POST /menu` (`menu/routes.ts:553`) dijaga
`onConflictDoNothing` + 409 "Menu sudah ada"; `PUT /menu/:id` (`:651`),
delapan puluh baris di bawahnya, menulis `nama` **tanpa apa pun** dengan
`menus_company_nama_uq` menunggu. Dan ini **tak butuh balapan**: ganti nama
menu B menjadi nama menu A — dua permintaan berurutan, alur manajemen harian —
diperkirakan 23505 mentah → 500 → overlay "server sedang diperbarui".
Kandidat lain untuk dipilah: `menu:424`, `menu/service.ts:335`,
`bahan/kode.ts:92`, `users:684` & `onboarding:252` (memberships.kode).
Bentuk kerja: pilah 9, ukur HTTP (berurutan dulu, baru serentak), perbaiki
dengan `tanpaBentrok`, §246 + bukti merah seperti §245.

### Usulan B′ — 73 kunci kontrak yang tercatat belum dibaca Dart: dipilah

Gerbang kunci-kontrak mengukur 463 kunci, 390 disentuh, **73 tercatat belum**.
Yang belum pernah terjadi: ke-73 itu dipilah jadi "sengaja tidak" (beralasan)
vs "hilang" (kelas `durasi_detik` yang dulu ketemu tak sengaja). Kerja mobile;
tiap yang "hilang" diurai + bukti merah mekanis, fikstur server sungguhan.

### Usulan C′ — `pastikanMuat` bernama untuk jalur non-penjualan

Batas #39, dua kali ditulis: jalur non-penjualan hanya dilindungi lapis
pertama — 400 terbaca, tanpa sebutan medan. Ukur dulu lewat HTTP pintu mana
yang bisa meluap dari masukan sah (`harga_per_unit × qty`, RAB per tahap),
baru pasang penjaga bernama di yang terukur.

### Usulan D′ — granularitas `penjaga-semua-pintu`: badan → pernyataan

Batas yang tetap tertulis, plus **20 pintu tekstual** bentrok-unik yang belum
pernah di-adjudikasi. Peringkat terakhir dengan sengaja: sapuan berjendela
sudah menuduh salah 14 kali di vena A — kelas ini paling rawan tuduhan palsu,
dan separuh nilainya sudah dibayar A′.

### Diperiksa dan TIDAK diusulkan

Tiga pintu host super admin (batas permanen beralasan) · antrean kolam
(terukur pulih sendiri, tuning tanpa bug) · tumpukan `BELUM_TAYANG` (menunggu
rilis ponsel, bukan kerja kode).

**Rekomendasi: A′ → B′ → C′ → D′.**

---

## Pintu detail ber-`:param` pada volume per-entitas — server — 2026-08-24

- **Kenapa**: batas tertulis dua entri — rute ber-`:param` tak ikut
  `ukur-latensi.sh`, dan jejaknya hanya pada volume seed; kelas inilah tempat
  balasan 2,97 MB `/customer/:id` dulu ditemukan
- **Metode**: volume ditempelkan pada SATU entitas per pintu (30.000 transaksi
  satu member · 30.000 lot satu bahan · 30.000 mutasi satu perlengkapan), dan
  tiap suntikan **dibuktikan terbaca lewat rutenya sendiri** (aturan 6):
  `jumlah_transaksi` 30.000 · `jumlah_pembelian` 30.018 · `terpotong: true`
- **Hasil — BERSIH dengan angka**:

  | pintu | terukur |
  |---|---|
  | `/customer/:id` | **0,024 dtk · 39 KB** |
  | `/bahan/:id/pembelian` | 0,077 dtk · 56 KB — `jumlah_pembelian` tetap **30.018** (hitungan populasi SQL, bukan larik terpotong) |
  | `/stok/kartu/:ingredientId` | 0,039 dtk · 54 KB — `terpotong: true` |
  | `/perlengkapan/:id/kartu` | 0,018 dtk · 111 KB |
  | `/perlengkapan/:id/pembelian` | 0,056 dtk · 56 KB |

  Langit-langit vena #15/#16 **memegang di dimensi per-id**
- **Aturan 6 menangkap pengukuranku sendiri**: tembakan pertama ke
  `/bahan/:id/kartu` memulangkan 0,004 dtk / **27 byte** — itu **404** (rute
  yang benar `/stok/kartu/:ingredientId`). Angka tercepat yang pernah kuukur
  adalah angka pintu yang salah alamat
- **Tindak**: blok "PINTU DETAIL" permanen di `ukur-latensi.sh` — id dipungut
  lewat API, melewati diri dengan pesan bila entitas tak ada, angka acuan
  tertanam. Gerbang: `npm test` 2.202

---

## Balapan dua boot `provisionGuest` — server — 2026-08-24

- **Kenapa**: utang yang ditulis `penjaga-semua-pintu` sendiri — satu
  `onConflictDoUpdate` di awal badan menutupi insert `companies` yang tak
  berpenjaga; *"badan yang panjang adalah titik butanya"*
- **Diukur** (dua `provisionGuest` dilepas `Promise.all` pada DB tanpa demo;
  demo mustahil di-`DELETE` — FK NO ACTION `sale_consumptions`, konsisten
  audit ON DELETE, jadi jalannya `TRUNCATE` pada DB buangan):

  | | boot 1 | boot 2 |
  |---|---|---|
  | SEBELUM | selesai (true) | **melempar `Failed query: insert into "companies" …` mentah** |
  | SESUDAH | true | **false** — jalur kalah idempoten |

  Ronde kedua false/false; 1 perusahaan; keanggotaan utuh. Yang kalah dulu
  selamat **hanya karena catch pembungkus** di `index.ts` — aman-karena-catch
  adalah aman yang bisa hilang tanpa ada yang sadar
- **Tindak**: `onConflictDoNothing` pada insert perusahaan (gerbang balapan) +
  jalur kalah yang memastikan keanggotaannya sendiri → `false`. Gerbang
  `provisi-tamu-balapan.test.ts` (2 uji source-pin; bukti merah mendarat).
  Prosa `penjaga-semua-pintu` diperbarui: utang tercatat DIBAYAR, granularitas
  badan tetap batas
- **Batas**: pin-nya struktur, bukan balapan hidup (butuh Postgres+TRUNCATE —
  terlalu mahal untuk suite unit; pengukurannya yang jadi buktinya). `branches`
  & `storageLocations` terkurung transaksi yang gerbangnya insert perusahaan
- Gerbang: typecheck bersih · `npm test` **2.207** · `verify-api` **2.905**
  terhadap Postgres segar · `audit:invarian` 26/26 · cakupan **271 identik**

---

## Rekaman cakupan diukur ulang tiap CI — server — 2026-08-24

- **Kenapa vena ini ada**: gerbang cakupan menulis batasnya sendiri —
  *"`rute-diketuk.txt` adalah REKAMAN, bukan pengukuran ulang."* Terukur:
  `ci.yml` **sudah** menjalankan verify-api tiap push, **tanpa** `JEJAK_RUTE` —
  98,9 % itu diukur sekali di satu mesin lalu dipercaya
- **Tindak**: dua perubahan kecil di `ci.yml` — `JEJAK_RUTE` dinyalakan pada
  langkah verify-api, dan langkah baru men-diff jejak run itu terhadap
  rekamannya: rute yang **berhenti** diketuk maupun rute **baru** membuat CI
  merah menyebut barisnya + perintah pembaruan sadar
- **Diverifikasi pada kenyataan, bukan niat**: jejak verify-api penuh (run
  §245, 2.905 asersi) → **271 rute, IDENTIK** dengan rekaman; simulasi merah
  (satu baris dicabut) → diff menyebut barisnya
- **Aturan 7**: `cakupan-rute.test.ts` dapat jangkar untuk langkah CI-nya
  sendiri (`JEJAK_RUTE=`, `cakupan-rute.ts`, `diff -u …`). **Suntikan bukti
  merah PERTAMAKU GAGAL MENDARAT** — frasa "Cakupan rute" juga hidup di
  komentar langkah server, jadi cek keberadaannya harus pada baris `- name:` —
  dan yang menangkapnya assert pendaratan itu sendiri, persis alasan aturannya
  ada
- **Batas**: pembandingnya menuntut kesamaan PERSIS, jadi verify-api yang
  nondeterministik (seksi yang kadang melewati diri) akan membuat CI merah
  palsu — hari ini nol seksi begitu pada dua run berturut (271 = 271), dan
  bila kelak ada, pesan gagalnya menunjuk barisnya
- Gerbang: typecheck bersih · `npm test` **2.202** · YAML tervalidasi

---

## Bentrok unik di bawah klik ganda SERENTAK — server — 2026-08-24

- **Kenapa vena ini ada**: `penjaga-semua-pintu` menulis utangnya sendiri —
  *"32 tabel berindeks unik… menyapu semuanya memunculkan 20 pintu terbuka…
  sisanya utang yang diukur."* Kelasnya sudah menggigit: 23505 mentah = 500,
  overlay "server sedang diperbarui", pemicunya satu klik ganda
- **Populasi**: **71** situs `.insert()` ke **32** tabel unik; **8** pintu
  buat-dengan-nama diukur perilakunya; **50** penjualan dilepas satu tick
- **Hasil: BERSIH secara perilaku — dan tiga lapis kesalahanku tercatat**:
  1. sapuanku menuduh **22**, EMPAT BELAS cacat jendelaku sendiri (`rfind` −1
     di kepala berkas → konteks kosong → `onConflict` tiga baris di bawah tak
     terlihat) → **8**, dan kedelapannya dipilah tangan **semuanya terjaga**:
     `auto_uq` indeks **parsial** (`WHERE tipe='auto'`; kelima insert bertipe
     lain), `supplySuppliers` dikunci `FOR UPDATE` induk (jendelaku tak kenal
     bentuk drizzle `.for("update")`), `menuComponents` dedup `Map`;
  2. **kandidat teratas usulanku GUGUR OLEH PENGUKURAN**: kutulis
     "`sales.nomor` baca-maks+1 TANPA kunci" — salah; baris PERTAMA transaksi
     `createSale` adalah `FOR UPDATE` baris cabang, seratus baris di atas
     komentar `FOR SHARE` yang kubaca. Terukur: 5 ronde × 10 penjualan dilepas
     **satu tick** (Promise.all) → **50× 201**;
  3. sasaran bukti merah pertamaku salah: mencabut `tanpaBentrok` dari
     `POST /supplier` tetap `{201, 409×3}` — penjaga pintu BUAT-nya
     `onConflictDoNothing` di insert; wrapper itu milik PATCH rename
- **Terukur, pelepasan serentak sungguhan, 8 pintu**: supplier · kategori ·
  satuan · customer(WA) · meja · cabang · penyimpanan · kategori-bahan →
  semuanya `{201:1, 409:3}`, **nol 5xx**
- **Detektor**: DIBUKTIKAN — `onConflictDoNothing` dicabut (suntikan
  di-assert) → **201 500 500 500**; dikembalikan → `409 409 409 409`
- **Yang belum pernah ada sampai putaran ini**: satu pun uji yang menembakkan
  duplikat **serentak** — semua asersi 409 menembak berurutan, jadi jalur
  balapan (23505 dari indeks, bukan pra-cek) tak pernah dilewati. **§245**
  (15 asersi) memakukannya: 4 curl paralel per pintu, nol 5xx, tepat satu 201,
  yang kalah dibalas kalimat
- **Batas**: 8 pintu yang dipaku adalah kelas buat-dengan-nama; balapan
  ganti-nama (PATCH bertabrakan) dan tabel token/idempotensi tak ikut dipaku —
  yang pertama berpenjaga `tanpaBentrok` per situs, yang kedua justru
  MENGANDALKAN 23505 sebagai mekanisme (menerjemahkannya akan merusak makna).
  `POST /cabang` membalas 400×4 di probe (validasi tipe/kuota) — pintunya tak
  sampai ke insert, dicatat bukan diabaikan
- **Tindak**: verify-api §245. Angka "20 pintu terbuka" di kepala
  `penjaga-semua-pintu` adalah sapuan TEKSTUAL aturan itu; kebenaran
  perilakunya hari ini nol pintu. Gerbang: typecheck bersih · `npm test`
  **2.201** · `verify-api` **2.905** terhadap Postgres segar

---

## ANTREAN KEEMPAT — usulan dari celah yang ditulis ledger sendiri — 2026-08-24

Antrean 1→3→2→4 tuntas. Yang di bawah **diukur baca-saja hari ini**, bukan
didaftar dari ingatan; tiap usulan menunjuk baris "Batas" ledger yang
melahirkannya.

### Usulan A — bentrok unik yang tak diterjemahkan: utang yang gerbangnya sendiri tulis

**Sumbernya**: `penjaga-semua-pintu.test.ts` menulis di kepalanya sendiri —
*"ada **32 tabel berindeks unik** di skema ini, dan menyapu semuanya
memunculkan **20 pintu terbuka**. Yang didaftarkan hanya kelas yang sudah
terbukti menyakiti… Sisanya **utang yang diukur**, bukan wilayah yang
dinyatakan bersih."* Kelasnya sudah menggigit: yang kalah balapan menerima
23505 mentah alias **500**, dan di web itu memicu overlay "server sedang
diperbarui". Pemicunya *"cukup SATU KLIK GANDA"*.

**Populasi diukur ulang hari ini**: **71** situs `.insert()` ke tabel-tabel
unik itu. Sapuanku sendiri salah dua generasi — versi pertama menuduh **22**,
dan **14 di antaranya cacat jendelaku sendiri** (`rfind` yang memulangkan −1
untuk situs di kepala berkas memotong konteksnya jadi kosong, jadi
`onConflictDoNothing` tiga baris di bawahnya tak terlihat). Sesudah diperbaiki:
**8** situs tanpa penjaga di jendelanya, dan dua yang kupilah tangan **sudah
bersih** (`menuComponents` — dedup `Map` sebelum insert; itu bukan kata kunci
penjaga, tapi ia penjaga).

**Kandidat hidup yang paling mahal**: `penjualan/service.ts` menyusun
`sales.nomor` lewat **baca-maks+1 tanpa kunci** (`orderBy desc limit 1` → +1),
dengan `sales_branch_nomor_uq` menunggu di ujungnya. `FOR SHARE` di baris
shift adalah kunci BERBAGI — dua penjualan serentak sama-sama memegangnya
tanpa saling menunggu. 50 penjualan serentak di putaran konkurensi lolos
semua, tapi curl yang di-spawn berurutan praktis terserialisasi; balapan
sesungguhnya butuh pelepasan serentak. **Kalau terukur: 500 di layar
pembayaran saat dua kasir menagih pada detik yang sama** — pintu paling mahal
di produk ini. Kandidat lain: `supplyMutations` ×5 (indeks `auto_uq`),
`supplySuppliers:945`.

**Bentuk kerjanya**: pilah tangan ke-8 (+ sapu bentuk `update` juga), ukur
balapan lewat HTTP dengan pelepasan serentak sungguhan, lalu putuskan per
kelas: `onConflict`/`tanpaBentrok` di situsnya, atau — sekarang pintu ini ada —
`23505` masuk `galatDataKlien`. Yang terakhir TIDAK otomatis benar:
`sync_commands_company_ref_uq` adalah **idempotensi**, dan menerjemahkannya
jadi 409 "sudah ada" akan mengubah makna balasan /sync. Tiap indeks diputuskan,
bukan disamaratakan.

### Usulan B — rekaman cakupan yang bisa membusuk diam-diam

**Sumbernya**: gerbang cakupan menulis batasnya — *"`rute-diketuk.txt` adalah
REKAMAN, bukan pengukuran ulang. Bila suatu saat sebuah rute berhenti diketuk
tanpa berkasnya diperbarui, gerbangnya tetap hijau."*

**Terukur hari ini**: `ci.yml` **sudah** menjalankan verify-api terhadap
Postgres segar tiap push — tapi **tanpa `JEJAK_RUTE`**, jadi 98,9% itu diukur
sekali di mesinku dan sesudahnya cuma dipercaya. Bentuk kerjanya kecil dan
struktural: nyalakan `JEJAK_RUTE` di langkah verify-api CI, tambah langkah
pembanding (`cakupan-rute.ts` sudah ada) yang gagal bila rekaman ≠ kenyataan.
Rekaman jadi pengukuran ulang **setiap CI jalan**, dan §244 tak bisa dicabut
diam-diam.

### Usulan C — 1.261 permintaan ber-`:param` di jejak, tak satu pun diukur pada volume

**Sumbernya**: dua entri — *"rute ber-`:param` tak ikut diukur `ukur-latensi.sh`
(butuh id yang sah); latensinya hanya terlihat lewat jejak saat verify-api
berjalan, **pada volume seed**"*. Detail per-id (`/customer/:id` dengan ribuan
transaksi, `/bahan/:id/kartu` dengan puluhan ribu mutasi) adalah kelas
`GET /customer/:id` 2,97 MB dulu. Bentuk kerjanya: pungut id sungguhan lewat
API, ukur N rute detail terpanas pada 200 rb transaksi dengan mesin yang sudah
ada.

### Usulan D — badan panjang `penjaga-semua-pintu`: penjaga satu insert memaafkan tiga insert di bawahnya

**Sumbernya**: gerbang itu menulis — *"satu penjaga di mana pun dalam satu
badan membuat SELURUH tulisan di badan itu lolos. `provisionGuest` adalah
contoh nyatanya: `onConflictDoUpdate` di insert `users` paling atas menutupi
insert `companies`, `branches`, `storageLocations` di bawahnya yang tak
berpenjaga sama sekali."* Keterjangkauannya rendah (boot + cek "sudah ada"),
jadi peringkatnya terakhir — tapi granularitas badan itu juga yang membuat
sapuan A perlu jendela per-PERNYATAAN, dan keduanya bisa dibayar sekali.

### Diperiksa dan TIDAK diusulkan

- **Cabang `revoked` undangan** — jalur sidestep kuota lewat XFF hanya hidup
  bila `TRUST_PROXY_HOPS > 0`; CI tak menyetelnya. Menembaknya berarti
  menaikkan kuota register untuk uji — biaya kontrak demi satu cabang kecil.
- **`sales.nomor` di 50-serentak putaran lalu** — TIDAK dihitung bukti aman:
  spawn berurutan ≈ serialisasi. Justru masuk usulan A sebagai kandidat utama.
- **Fikstur uang "tiga fungsi, bukan seluruh aritmetika"** — sisa rumusnya
  sudah tersapu vena #26 (34 render dihitung, 0 selisih); tak ada populasi
  baru.

**Rekomendasi: A dulu** — satu-satunya yang kelasnya sudah terbukti menggigit
(empat 500 sebelumnya), utangnya ditulis gerbangnya sendiri, dan kandidat
teratasnya duduk di jalur pembayaran. Lalu **B** (kecil, menutup batas tertulis
gerbang cakupan), **C**, **D**.

---

## Kunci kontrak ↔ Dart: sapuan sekali-jalan jadi gerbang berdiri — server+mobile — 2026-08-24

- **Kenapa vena ini ada**: `durasi_detik` dikirim server berbulan-bulan dan
  dibaca ponsel NOL kali — dan yang menemukannya **sapuan sekali jalan**, bukan
  gerbang. Sesudah sapuan itu selesai, tak ada apa pun yang menagih kunci
  kontrak berikutnya
- **Populasi** (diukur, pembangkitnya `acuan-kunci-mobile.ts`):

  | ukuran | angka |
  |---|---|
  | baris `Interface\|kunci` dari `types.ts` | **1.127** |
  | kunci unik | **463** |
  | disentuh Dart (baca `['k']` maupun tulis `{'k': v}`) | **390** |
  | tercatat BELUM, dengan nama | **73** |

- **Bentuknya pola cermin yang sudah terbukti dua kali** (`acuan-status-mobile`,
  `acuan-uang-mobile`): pembangkit di server → fikstur di repo mobile → uji
  cermin Dart menagih tiap kunci **diputuskan** — dibaca, atau tercatat di
  `kunci-belum-dibaca.txt`. Ratchet-nya MENYUSUT dua arah: kunci yang mulai
  dibaca wajib dihapus dari catatan (uji merah menyebutnya), kunci yang hilang
  dari kontrak juga
- **Sentinel historis**: kelima kunci vena #30/#34 (`durasi_detik`,
  `masuk_pada`, `lewat_target`, `target_detik`, `bertarget`) diasersi tetap
  disentuh — lenyapnya salah satu adalah persis regresi bug aslinya
- **Detektor**: bukti merah DUA lapis di mobile (kunci karangan → merah
  bernama; kunci terbaca yang dicatat "belum" → ratchet merah) + pasangan
  sintetis di server. **Dua kali detektorku sendiri salah saat membangunnya**:
  (1) regex pembangkit buta terhadap `export type X = {` — di `types.ts` hari
  ini kebetulan nol (139 kontrak semuanya interface), tapi kontrak pertama
  berbentuk type-alias akan lenyap tanpa suara; ketahuan oleh uji pasangan
  sintetis; (2) masukan sintetisku sendiri dirakit `replace` satu-baris
  sehingga medan keduanya tak pernah berpindah baris — ujinya menuduh
  pembangkit yang benar
- **Batas, ditulis di kedua berkasnya**: "disentuh" ≠ "diurai benar" — literal
  yang kebetulan sama ikut memuaskan sapuan; yang menjaga arah "diurai benar"
  uji parser per fitur. Fikstur diperbarui manual; kesegarannya dijaga
  `kunci-satu-kontrak.test.ts` hanya di mesin yang memuat kedua repo (CI
  masing-masing repo tak saling checkout), dan itu disebut apa adanya
- **Tindak**: `acuan-kunci-mobile.ts` + npm script · `kunci-satu-kontrak.test.ts`
  (4 uji, server) · `kunci_kontrak_server_test.dart` (5 uji, mobile) + dua
  fikstur. Gerbang: typecheck bersih · `npm test` **2.199** · `flutter analyze`
  bersih · `flutter test` **512** (3.44.7)

---

## `22001` dan jalur non-penjualan luapan turunan — server — 2026-08-24

- **Kenapa vena ini ada**: dua celah yang kutulis sendiri sebagai batas vena
  luapan-turunan — `22001` ditahan karena *"keterjangkauannya belum kuukur"*,
  dan jalur non-penjualan hanya dilindungi lapis pertama
- **Hasil 1 — `22001` terukur MUSTAHIL**: `schema.ts` punya **NOL** kolom
  `varchar(n)`/`char(n)` — seluruh **127** kolom teks bertipe `text` yang tak
  berbatas panjang dan tak pernah melempar 22001 — dan **NOL** cast
  `::varchar` di SQL mentah. Menerjemahkannya berarti mengubah 500 jadi 400
  untuk jalur yang TIDAK ADA. Keputusannya **dipaku**: `galatDataKlien` tetap
  `null` untuk 22001, dan kolom varchar PERTAMA yang lahir membuat paku merah
  dan menagih pengukuran ulang. Bukti merah mendarat (varchar suntikan →
  tertuduh → dicabut)
- **Hasil 2 — jalur non-penjualan diukur lewat HTTP**: bahan produksi
  bertakaran resep 99.999.999 diproduksi qty 1.000 → konsumsi **1e11** atas
  `production_consumptions.qty` `numeric(16,6)` (maks 9,99e9):

  | permintaan | balasan |
  |---|---|
  | `POST /produksi` qty=1.000 | **400** "Angkanya terlalu besar untuk disimpan" |
  | `POST /produksi` qty=1.000.000 | **400**, bukan 500 |

  Kelas 5xx-nya tertutup pintu keluar bersama. Yang tersisa **hanya ketiadaan
  nama medan**, dan itu batas yang dipilih sadar: `pastikanMuat` bernama milik
  jalur penjualan, tempat kasir berdiri di depan tamu
- **Tindak**: `luapan-turunan.test.ts` 5 → **7** uji (paku 22001 + pin
  pengukuran non-penjualan). Tak ada kode server tersentuh. Gerbang: typecheck
  bersih · `npm test` **2.201**

---

## Latensi di bawah KONKURENSI — server — 2026-08-24

- **Kenapa vena ini ada**: pengukuran cakupan menilai VOLUME (200.101
  transaksi, satu permintaan pada satu waktu) dan menulis batasnya sendiri —
  *"jalur tulis diukur … tapi tidak di bawah konkurensi — kelas yang justru
  melahirkan vena #12"* (`GET /menu` 0,009 → **20,07 dtk** saat
  `PUT /menu/urutan` berjalan)
- **Populasi**: enam keadaan konkurensi atas kolam **10 koneksi** (pg.Pool
  bawaan), pada **200.101 transaksi** yang **dibuktikan terbaca API** lewat
  `jumlah_transaksi` balasan rutenya (aturan 6)
- **Hasil — BERSIH, dengan bacaan yang ditulis**:

  | keadaan | terukur |
  |---|---|
  | dasar | `GET /menu` 0,013 · `POST /penjualan` 0,018 dtk |
  | 10 laporan serentak | `GET /menu` **0,160** · `POST /penjualan` 0,165 (201) |
  | 10 penjualan serentak | `GET /menu` 0,015 · penjualan ke-11 **0,085** (201) |
  | **5 `PUT /menu/urutan` serentak** | `GET /menu` **0,018 dtk** — kelas #12, dulu **20,07** |
  | 30 laporan (3× kolam) | p50 **1,631** · maks 1,930 · `GET /menu` **0,675** dtk |
  | 50 penjualan serentak | p50 0,395 · p95 **0,656** · maks 0,677 · **50× 201** |

  Penurunan di bawah beban adalah **antrean kolam** — linier terhadap kedalaman
  antrean, pulih sendiri, **tanpa 5xx**, tanpa kelaparan tak berbatas. Baris
  keempat yang terpenting: perbaikan vena #12 **memegang di bawah beban yang
  sama yang dulu membunuhnya**, dan sekarang ada angkanya
- **Bacaan atas 30-serentak, supaya tak dibaca lebih buruk dari faktanya**:
  `/laporan` **sengaja** tak berbatas laju — vena "batas laju di luar email"
  mengukurnya murah (0,225 dtk @ 200 rb) dan memutuskan begitu. Yang
  membatasinya kolam itu sendiri: 30 permintaan serentak menaikkan bacaan lain
  ke 0,675 dtk lalu pulih. p50 1,63 dtk ≈ 2,4× hitungan antrean murni
  (0,225 × 3 gelombang) — sisanya kontensi CPU serialisasi JSON, bukan kueri
- **Tindak**: blok KONTENSI KOLAM di `scripts/ukur-latensi.sh` dipermanenkan
  mengukur jalur TULIS juga (10 penjualan serentak + baca & tulis di
  tengahnya), angka acuan tertanam sebagai komentar, dan blok tulisnya
  **melewatkan diri dengan pesan jujur** bila token kasir/menu tak tersedia —
  bukan diam. Tak ada kode server tersentuh; `verify-api` tak dijalankan ulang
  untuk commit ini dan itu disebutkan. Gerbang: `npm test` **2.195**
- **Batas**: mesin CI satu kotak — klien dan server berbagi CPU, jadi angka
  serentaknya konservatif (kontensi klien ikut terhitung); konkurensinya
  sebatas 50 (kasir sungguhan per tenant jauh di bawah itu); dan `FOR UPDATE`
  meja/advisory lock tak diukur terpisah — jalurnya sudah dijaga uji perilaku
  (`§161`, `bill-dikunci-saat-dibayar`), yang belum ada angka latensinya

---

## Lima belas pintu yang tak pernah diketuk — server — 2026-08-24

- **Kenapa vena ini ada**: gerbang cakupan putaran lalu mengukur 274 rute
  konkret, 256 diketuk, dan menuliskan **15 pintu sebagai UTANG YANG DIUKUR** —
  empat `DELETE` dan sembilan jalur tulis lain yang bisa 500 sejak berbulan-bulan
  tanpa satu uji berubah warna
- **Populasi**: **15** pintu utang + 3 di luar jangkauan, dari **274**
- **Metode**: §244 di `verify-api.sh` (**41 asersi**) mengetuk kelima belasnya
  lewat HTTP sungguhan memakai fikstur yang sudah hidup di aliran skrip — tiap
  ketukan memeriksa status + satu fakta dari badannya + pasangan
  anti-hijau-palsu (404 untuk id asing, penolakan peran, idempotensi)
- **Hasil**:

  | | sebelum | sesudah |
  |---|---|---|
  | rute diketuk | **256** (93,4 %) | **271** (**98,9 %**) |
  | jalur TULIS diketuk | 155/168 | **165/168** |
  | UTANG | **15** | **0** |

  **Tak satu pun pintu membalas 5xx** — venanya bersih secara perilaku, diukur
  bukan diduga. Tiga yang tersisa memang di luar jangkauan: migrasi sungguhan,
  email sungguhan, retensi cadangan mesin
- **Dua dari lima belas ternyata PINTU HANTU — ralat atas penyebut cakupanku
  sendiri**: `buatRuteTambahStok` dipasang di dua prefiks dan dua handler-nya
  menolak separuh dirinya di baris pertama (`kirim-hasil`: `tipe !==
  "produksi"` → mount `/pembelian` **selalu 404**; `dampak`: `tipe !== "beli"`
  → mount `/produksi` **selalu 400**). Bukan utang melainkan **artefak
  pabrik**. Kini terdaftar `HANTU_PABRIK` dengan sebab strukturalnya, diuji
  **tetap mustahil** lewat HTTP, dan source-pin menahan penjaga `tipe`-nya —
  hantu yang tiba-tiba berhasil berarti mengirim hasil produksi lewat pintu
  belanja
- **Kandidat perilaku diukur lalu DITOLAK, dengan alasannya**:
  `setujui-massal` tak punya syarat `selisih ≠ 0` yang pintu tunggalnya punya —
  tapi baris nol-selisih lahir berstatus `disetujui`, jadi predikat `menunggu`
  tak pernah memungutnya. **Aman karena konjungsi lain**; yang diasersi
  perilakunya (idempoten — panggilan kedua menyetujui **NOL**)
- **Dua kesalahanku saat menulis §244, keduanya tertangkap alat yang ada**:
  1. pintu hantu kutembak `{"items":[]}` dan dapat 400 — `zValidator` berjalan
     **sebelum** handler, jadi cabang `tipe` tak pernah tercapai. Badannya
     harus sah dulu supaya hantunya benar-benar teruji;
  2. pasangan kasir kupakai `$KASIR` yang mati sejak §105 → 401 alih-alih 403.
     Yang menemukannya `verify-api-token.test.ts` — penjaga yang dipasang untuk
     kesalahan persis ini, bekerja persis seperti niatnya
- **Detektor**: bukti merah mendarat — satu baris dicabut dari
  `rute-diketuk.txt` (suntikan di-assert) → dua uji merah menyebut
  `PATCH /api/satuan/:id`. Ratchet diperketat: `UTANG` maks **0**, jalur tulis
  diketuk ≥ **165**
- **Batas**: "diketuk" tetap bukan "diuji" — tiap pintu dilewati sekali dengan
  badan sah; cabang-cabang dalamnya tidak disapu. Cabang `revoked` di
  `undangan/:id/tolak` tak tertembak (butuh akun terdaftar baru; kuota register
  20/jam sudah terpakai ~18 oleh skrip) — yang ditembak cabang penjaganya
  (404 untuk undangan orang lain + pending tetap utuh)
- **Tindak**: §244 (41 asersi) · `rute-diketuk.txt` 256 → 271 · gerbang
  `cakupan-rute.test.ts` 5 → 6 uji (+`HANTU_PABRIK` + source-pin). Gerbang:
  typecheck bersih · `npm test` **2.195** · `verify-api` **2.890** terhadap
  Postgres segar · `audit:invarian` 26/26

---

## Kunci JSON ponsel yang dibaca lewat VARIABEL — mobile — 2026-08-24

- **Kenapa vena ini ada**: ledger vena "medan yang tak diurai" menulis batasnya
  — *"regex `x['kunci']` tak melihat kunci yang lewat variabel (`j[k]`) maupun
  kunci pada badan PERMINTAAN."* Separuhnya sudah tertutup: usulan #5 membuat
  **112 dari 114** badan permintaan menolak kunci tak dikenal, jadi kunci yang
  salah nama berbunyi 400 alih-alih hilang. Yang tersisa arah BACA
- **Populasi** (disapu **tanpa komentar** — lihat di bawah):

  | ukuran | angka |
  |---|---|
  | akses kunci LITERAL `x['kunci']` di `kakarut-mobile/lib` | **1.213** |
  | akses lewat **variabel** `x[k]` (di luar indeks gelung) | **32** |
  | di antaranya membaca **payload JSON server** | **1** |

- **Sapuan pertamaku salah, dan salahnya dua macam sekaligus**: ia melaporkan
  **187** situs. Sesudah komentar dikupas dan indeks gelung (`list[i]`,
  `rows[i]`) dikeluarkan, angkanya **32**. Yang 155 itu prosa (`// lihat
  [sajianTakeaway]`, `// pakai [perbarui]` — tanda kurung siku di kalimat
  Indonesia) dan pengindeksan larik biasa. Menuduh keduanya adalah cara
  tercepat membuat gerbangnya diabaikan
- **Hasil**: **BERSIH.** Ketiga puluh satu sisanya peta LOKAL, bukan payload:
  cache `api_client` (`_cacheEtag[key]`, `_cacheWaktu[key]`, `_cacheGet[key]`),
  keadaan per-id (`_foto[areaId]`, `status[id]`, `_porsi[menuId]`), tabel
  karakter pencetak (`_charMap[ch]`), dan label peran. Satu-satunya yang
  membaca payload server `features/manajemen/manajemen_models.dart:307`:

  ```dart
  HargaEkstrem? ekstrem(String key) {
    final v = j[key];
    return v is Map<String, dynamic> ? HargaEkstrem.fromJson(v) : null;
  }
  ```

  …dan **kedua pemanggilnya memakai literal** — `ekstrem('harga_terendah')`,
  `ekstrem('harga_tertinggi')`. Sapuan kunci-per-nama mana pun tetap
  menemukannya; hanya sapuan yang bersikeras pada bentuk kurung
  `j['harga_terendah']` yang akan luput
- **Tindak: tidak ada, dan itu keputusan.** Populasi satu yang sudah tercakup
  tak menjustifikasi gerbang baru — bentuk keputusan yang sama dipakai vena
  #33 untuk tiga panggilan URL-variabel di ponsel. Menambah gerbang untuk
  populasi satu adalah menambah biaya perawatan tanpa menambah penjagaan
- **Batas & celah yang tersisa** (bahan antrean berikutnya): sapuan
  "kunci kontrak server vs kunci yang dibaca Dart" (425 vs 804 pada vena
  sebelumnya) **tak pernah jadi gerbang berdiri** — ia skrip sekali jalan.
  Kunci kontrak baru karena itu masih bisa lahir tanpa ada yang menagih sisi
  ponselnya, persis seperti `durasi_detik` dulu

---

## Teks galat DI DALAM balasan sukses — server — 2026-08-24

- **Kenapa vena ini ada**: ledger menulis *"penjaganya hanya melihat
  `new HTTPException`. Medan galat yang dibalas lewat `c.json` biasa — mis.
  `alasan` per baris pada impor bahan — tak terlihat sama sekali."*
- **Populasi** (disapu **tanpa komentar**):

  | ukuran | angka |
  |---|---|
  | medan bernama-galat (`alasan`/`sebab`/`pesan`/`keterangan`) | **48** |
  | blok `catch` di `apps/server/src` | **45** |
  | · yang MENGIKAT galatnya | **28** |
  | · galat MENTAH sampai ke nilai yang DIKIRIM | **1** |

- **Hasil perilakunya: BERSIH.** Satu-satunya situs `lib/backup.ts:157`
  (`e instanceof Error ? e.message : String(e)` → `error: pesan`), dan ia
  **sah**: seluruh rute cadangan ada di balik `/admin/*` + `requireSuperAdmin`,
  dan pesan asli itulah isi diagnosis operatornya. Dua situs `alasan:` pada
  impor bahan keduanya lewat `alasanGagalBaris`; `sebab` di `/sync` kode
  terstruktur, bukan pesan
- **Yang TIDAK bersih penjaganya, dan itu dua hal terukur**:
  1. **polanya satu bentuk, kelasnya lebih luas.** Ia menuntut tulisan harfiah
     `(e as Error).message`. Tiga bentuk yang lebih sering dipakai repo ini
     **dibuktikan lolos** pola lama dan tertuduh sapuan baru:
     `e instanceof Error ? e.message : String(e)`, `String(e)`, `` `${e}` ``;
  2. **pengecualiannya lebih luas dari alasannya.** `BOLEH` mengecualikan
     **seluruh `lib/`** dengan alasan *"penulisan log & peringatan, bukan badan
     respons"* — dan alasan itu tidak benar untuk seluruh `lib/`, karena
     `lib/backup.ts` justru memulangkan `error: pesan` di dalam objek yang
     dikirim. Kini tiga berkas `lib/` dikecualikan **dengan nama**, masing-masing
     dengan sebabnya
- **Detektor**: DIBUKTIKAN bisa menuduh, dua lapis. Sintetis: ketiga bentuk di
  atas tertuduh sementara pola lama diam (uji berpasangan di berkas yang sama).
  Pohon sungguhan: menyisipkan `e instanceof Error ? e.message : String(e)` ke
  `modules/kebersihan/routes.ts` — **suntikan di-assert mendarat** — tertuduh di
  berkas & baris yang tepat, lalu dicabut
- **Versi pertama sapuannya menuduh KOMENTAR**: `modules/bahan/routes.ts:976`,
  yaitu prosa yang MENJELASKAN cacat ini dan mengutip bentuk yang salah.
  Dibaca tanpa komentar sesudahnya. Penjaga yang menuduh tulisannya sendiri
  sudah terjadi sekali di repo ini (`sql-number-bukan-janji`)
- **Batas**: sapuan ini menilai badan `catch` sepanjang satu blok. Galat yang
  disimpan ke variabel di luar `catch` lalu dikirim jauh di bawahnya tak
  terlihat; begitu pula pesan yang dirakit di modul lain dan diteruskan. Yang
  dijamin: bentuk yang paling sering ditulis tak bisa lagi masuk diam-diam
- **Tindak**: `alasan-gagal-tanpa-bocor.test.ts` bertambah sapuan kedua + uji
  berpasangan (7 → **13** uji); `BOLEH` dipersempit dari awalan direktori jadi
  berkas bernama. Tak ada kode server yang tersentuh — hanya berkas uji — jadi
  `verify-api` tidak dijalankan ulang, dan itu **disebutkan** bukan didiamkan.
  Gerbang: typecheck bersih · `npm test` **2.194**

---

## Cakupan rute: pintu yang tak pernah diketuk — server — 2026-08-24

- **Kenapa vena ini ada**: ledger menulis batas alat ukur latensi — *"yang
  diukur RUTE BACA tanpa parameter jalur (68 dari 469). Jalur tulis dan rute
  ber-`:id` tak diukur."*
- **RALAT atas angka ledger itu**: `scripts/ukur-latensi.sh` mengukur
  **SEBELAS** jalur yang ditulis tangan di satu baris `for`, semuanya `GET`.
  Bukan 68. Dan penyebutnya **274** rute konkret, bukan 469
- **Temuan pengintaian yang menentukan bentuk putaran ini**: angka cakupan
  **tak bisa didapat secara statis**. Kucocokkan jalur yang disebut
  `verify-api.sh` dengan deklarasi rute di `src` — hasilnya **2 dari 163**,
  karena hampir setiap jalur di skrip itu dirakit dari variabel shell
  (`/bahan/$BP242/resep`). Yang dibutuhkan **pola** rutenya
  (`/api/bahan/:id/resep`), dan hanya server yang mengetahuinya
- **Populasi**:

  | ukuran | angka |
  |---|---|
  | rute konkret terdaftar di tabel rute Hono | **274** |
  | · jalur **TULIS** | **168** |
  | jalur yang `ukur-latensi.sh` ukur sebelumnya | **11**, semuanya `GET` |
  | jalur TULIS yang pernah punya angka | **0** |
  | permintaan tercatat saat `verify-api.sh` berjalan | **4.324** |

- **Metode**: middleware ber-env `JEJAK_RUTE` di `app.ts` mencatat
  `metode · c.req.routePath · status · ms`. **Diukur, bukan diandaikan**:
  `routePath` memulangkan pola LENGKAP dengan prefiks mount
  (`/api/customer/:id`, `/api/menu/:id`). Daftar rutenya dari `app.routes`
  Hono sendiri — pemeta teks di repo ini sudah salah berkali-kali, dan di sini
  aplikasinya bisa ditanya langsung
- **Detektor**: DIBUKTIKAN bisa menuduh — satu rute baru disisipkan ke `app.ts`
  (suntikan **di-assert mendarat**), gerbang menuduhnya dengan nama
  (`GET /api/pintu-yang-tak-pernah-diketuk`), lalu dicabut
- **Hasil — peta cakupan pertama yang pernah ada di repo ini**:

  | | angka |
  |---|---|
  | rute konkret terdaftar | **274** |
  | **diketuk** verify-api | **256** (**93,4 %**) |
  | **TAK PERNAH diketuk** | **18** — **13** di antaranya jalur TULIS |
  | jalur tulis | **168** terdaftar, **155** diketuk |

  Tiga memang di luar jangkauan suite dan alasannya bisa diperiksa: menjalankan
  migrasi sungguhan, mengirim email sungguhan, mengubah retensi cadangan mesin
  yang menjalankannya. **Lima belas sisanya UTANG YANG DIUKUR** — ditulis apa
  adanya, bukan disamarkan jadi "di luar jangkauan": empat `DELETE` dan sembilan
  jalur tulis lain yang bisa 500 sejak berbulan-bulan tanpa satu uji berubah
  warna
- **Venanya sendiri BERSIH secara perilaku, dan itu diukur**: pada **200.101
  transaksi** yang **dibuktikan terbaca API** (lewat `jumlah_transaksi` balasan
  rutenya, bukan `SELECT count(*)` — kesalahan yang pernah kubuat dan yang
  melahirkan gerbang premis skrip itu), **71** rute baca terukur otomatis:

  | | terukur |
  |---|---|
  | terlambat: `GET /laporan` | **0,119 dtk** |
  | `POST /penjualan` | **0,020 dtk** |
  | `POST /stok/opname` | **0,036 dtk** |
  | `PUT /menu/:id` | **0,018 dtk** |
  | kontensi kolam `GET /menu` senggang → sibuk → pulih | **0,015 → 0,012 → 0,016 dtk** |

  Kontensi yang dulu **0,009 → 2,11 dtk** kini rata. Perbaikan vena #12/#14/#15/
  #16/#36 memang memegang — dan sekarang ada angkanya, bukan keyakinan
- **Batas gerbangnya, ditulis jujur**
  - `docs/audit/rute-diketuk.txt` adalah **rekaman**, bukan pengukuran ulang.
    Bila suatu saat sebuah rute berhenti diketuk tanpa berkasnya diperbarui,
    gerbangnya tetap hijau. Yang dijaganya: rute **baru** tak bisa lahir tanpa
    keputusan
  - **"diketuk" bukan "diuji"**: rute yang ditembak sekali dengan badan paling
    sederhana tetap terhitung tercakup
  - rute ber-`:param` tak ikut diukur `ukur-latensi.sh` (butuh id yang sah);
    latensinya hanya terlihat lewat jejak saat verify-api berjalan, pada volume
    seed
  - jalur tulis diukur pada volume seed dan pada 200 ribu transaksi, tapi tidak
    di bawah **konkurensi** — kelas yang justru melahirkan vena #12
- **Tindak**: middleware jejak ber-env di `app.ts` (mati secara bawaan; isinya
  hanya metode, pola, status, ms — tak ada UUID, badan, atau token) ·
  `src/scripts/cakupan-rute.ts` · gerbang `cakupan-rute.test.ts` (5 uji) ·
  `ukur-latensi.sh` memakai tabel rute Hono (11 → **71** rute baca), gerbang
  premisnya utuh · `docs/audit/rute-diketuk.txt`. Gerbang: typecheck bersih ·
  `npm test` **2.191** · `verify-api` **2.849** terhadap Postgres segar ·
  `audit:invarian` 26/26
- **Catatan alat**: `buta-komentar.test.ts` turun **4.167 → 3.348** aksara, dan
  sebabnya ditulis di tempatnya — kerusakan pengupas naif berbentuk **RANTAI**:
  satu komentar blok baru di mana pun memasangkan ulang seluruh `/*`…`*/`
  sesudahnya dan menggeser angkanya **ke dua arah**. Ambangnya karena itu
  dipasang pada besaran, dan yang tak boleh mundur asersi
  `.route("/admin/tenants"` di atasnya — itu propertinya; angka itu ukurannya

---

## Luapan TURUNAN: angka yang lahir di server, tempat `.max()` tak menolong — server — 2026-08-24

- **Kenapa vena ini ada**: entri di bawah menutup celah "batas ada tapi angkanya
  milik kolom lain", lalu menulis batasnya sendiri — *"kelas luapan turunan tak
  disentuh sama sekali … dan tak satu pun punya penjaga"*. Ia dikerjakan
  mendahului #8–#10 karena kerusakannya **500 di layar pembayaran** dan
  keterjangkauannya **aritmetika, bukan dugaan**
- **Populasi**:

  | ukuran | angka |
  |---|---|
  | kolom `numeric(p,s)` di `schema.ts` | **62** |
  | · diisi LANGSUNG medan permintaan tervalidasi | **30** |
  | · **lahir dari hitungan server** | **32** |
  | SQLSTATE yang `alasanGagalBaris` sudah bisa terjemahkan | **7** |
  | modul yang memakainya | **1** (`bahan/routes.ts`) |
  | SQLSTATE yang diterjemahkan `app.onError` | **1** (`22P02`) → **2** |

  **Ralat atas angkaku sendiri**: entri di bawah menulis *"13 dari 62 kolom
  diisi hitungan server"*. Tiga belas adalah besar daftar `TAK_DIKLAIM` di
  berkas ujinya — himpunan yang berbeda. Yang benar **32**, dihitung sebagai
  komplemen `PETA` terhadap seluruh kolom numeric
- **Metode**: komplemen `PETA` (peta medan→kolom dari vena sebelumnya) terhadap
  kapasitas kolom yang dibaca `schema.ts`; tiap kolom turunan dipilah tangan
  jadi DIJAGA atau BERALASAN, lalu tiap kandidat **diukur lewat HTTP**
- **Detektor**: DIBUKTIKAN bisa menuduh, **tiga lapis**, tiap suntikan
  **di-assert mendarat**: (1) mencabut satu `pastikanMuat` → source-pin merah
  menyebut penjaganya; (2) mencabut terjemahan `22003` → uji pintu keluar
  merah; (3) menambahkan kolom `numeric` baru ke `schema.ts` → KELENGKAPAN
  merah menyebut `sales.uji_luap_baru`
- **Hasil**: **TEMUAN.** Terukur lewat HTTP terhadap Postgres sungguhan:

  | permintaan | sebelum | sesudah |
  |---|---|---|
  | menu Rp 10.000 × qty 99.999.999 (= 999.999.990.000) | **201** | 201 |
  | menu Rp 20.000 × qty 99.999.999 | **HTTP 500** | **400** `Total baris "…" terlalu besar untuk disimpan (maksimal 999.999.999.999)` |
  | menu Rp 1 jt × qty 1.000.000 | **HTTP 500** | **400** bernama |
  | **TIGA baris yang masing-masing MUAT** | **HTTP 500** | **400** `Subtotal terlalu besar…` |
  | menu ber-resep takaran 1000 × qty 9.999.999 | **HTTP 500** | **400** `Total HPP terlalu besar…` |

  Baris keempat itu inti venanya: **tiap medan sah, tiap baris muat di
  kolomnya, dan penjualannya tetap 500 karena jumlahnya tidak.** Tak ada
  `z.number().max()` di mana pun yang bisa mencegahnya. Pasangan
  anti-hijau-palsu ikut diukur lewat verify-api: nota Rp 20 juta dan nota tiga
  baris wajar tetap **201**
- **Bentuknya persis tanda tangan sesi ini, sampai ke kalimat pembelaannya.**
  `lib/pg-galat.ts` sudah tahu arti luapan numerik dan sudah punya kalimatnya
  (`case "22003": "Angkanya terlalu besar untuk disimpan"`), dan berkas yang
  **sama** sudah menuliskan argumen untuk memasangnya di pintu keluar bersama —
  untuk saudaranya `22P02`: *"menyalin saringan ke 137 tempat sisanya bukan
  perbaikan, itu daftar tugas yang tak akan selesai — jadi terjemahannya
  dipasang di SATU pintu keluar galat."* Argumen itu ditulis, disepakati, dan
  dijalankan — **untuk satu kode SQLSTATE saja**
- **Perbaikannya DUA LAPIS, dan keduanya perlu — dibuktikan sendiri-sendiri**:
  1. **pintu keluar bersama** (`app.onError` → `galatDataKlien`): dengan
     **seluruh** penjaga lokal dicabut (suntikan di-assert: 6 panggilan → sisa
     0), permintaan yang sama dibalas **400 "Angkanya terlalu besar untuk
     disimpan"**, bukan 500. Ini menutup kelasnya di **setiap** rute sekaligus.
     Tetap dicatat sebagai 400, sama seperti perlakuan `22P02`;
  2. **`pastikanMuat()` di tempat angkanya lahir**: menyebut **medannya** dan
     nama menunya. Pintu keluar bersama tak pernah tahu angka yang MANA, dan
     kasir yang berdiri di depan tamu perlu tahu baris mana yang diperbaiki
- **Sengaja hanya `22003`**: saudaranya `22001` ("teks terlalu panjang")
  sekelas dan sudah punya kalimatnya, tapi **keterjangkauannya belum diukur** —
  menerjemahkan yang belum diukur berarti mengubah 500 jadi 400 untuk jalur
  yang mungkin tak pernah ada, dan itu menyembunyikan cacat server sungguhan
- **Asersi verify-api-ku sendiri sempat melaporkan 5xx yang tak pernah ada**:
  `status_code_body` sengaja tak menutup barisnya, jadi `"400"` dan `"400"`
  menyatu jadi `"400400"` dan `awk '$1 >= 500'` menghitungnya satu. Diperbaiki
  dengan newline eksplisit, dan sebabnya ditulis di tempatnya
- **Batas detektornya, ditulis jujur**
  - ia menilai **kolom**, bukan menelusuri tiap ekspresi. Sebuah kolom yang
    "DIJAGA" dijaga di jalur yang kuperiksa — kalau kelak ada jalur tulis KEDUA
    ke kolom yang sama, gerbang ini tak melihatnya. Yang dijaganya: tak ada
    kolom turunan **baru** yang lahir tanpa keputusan
  - **`production_consumptions.qty` belum diukur lewat HTTP.** Jalur produksi
    memakai qty yang sudah ber-`BATAS_QTY_STOK` dan kolomnya `numeric(16,6)`
    yang sama, jadi secara aritmetika ia terkurung — tapi itu penalaran, bukan
    pengukuran, dan ditulis begitu di `PUTUSAN`
  - **jalur non-penjualan hanya dilindungi lapis pertama**: balasannya 400 yang
    bisa dibaca, tapi tanpa sebutan medan. Menambahkan `pastikanMuat` ke tiap
    jalur adalah daftar tugas yang sama dengan yang ditolak `pg-galat.ts`;
    yang dikerjakan lebih dulu jalur yang **terukur** menggigit
  - `22001` tak diukur sama sekali putaran ini
- **Tindak**: `galatDataKlien` + wiring `app.onError` · `pastikanMuat()` &
  `BATAS_HPP` di `lib/batas-angka.ts` · **enam** titik penjaga di `createSale` ·
  gerbang `luapan-turunan.test.ts` (5 uji) · `verify-api` §243 (9 asersi) ·
  pemetaan kolom dipindah ke `test/util/kolom-numerik.ts` (mengimpor berkas
  `.test.ts` membuat describe-nya berjalan dua kali) · entri `CHANGELOG-API`
  🟡 PERLU DILIHAT — ponsel tak berubah, tapi **satu kelas galat berpindah dari
  5xx ke 4xx**, dan klien yang mencoba-ulang otomatis pada 5xx sebelumnya
  mengulang permintaan yang takkan pernah berhasil. Gerbang: typecheck bersih ·
  `npm test` **2.186** · `verify-api` **2.849** terhadap Postgres segar ·
  `audit:invarian` 26/26

---

## Peta medan → kolom: batasnya ADA tapi angkanya milik kolom lain — server — 2026-08-24

- **Kenapa vena ini ada**: gerbang `angka-berbatas-atas` menulis batasnya
  sendiri — *"ia menuntut ADANYA `.max()`, bukan bahwa angkanya cocok dengan
  kolom tujuannya. Pemetaan medan → kolom tak ada di kode."* Ledger putaran lalu
  mencatatnya sebagai negatif bersih ("ketiga belas konstanta cocok hari ini"),
  dan **negatif bersih itu meleset**: yang diperiksa waktu itu konstantanya,
  bukan pemakaiannya
- **Populasi**:

  | ukuran | angka |
  |---|---|
  | kolom `numeric(p,s)` di `schema.ts` | **62** (11 presisi berbeda) |
  | `z.number()` di server + shared | **109** |
  | · ber-`.max()` | **105** — 77 lewat konstanta `BATAS_*`, 28 literal |
  | pasangan (berkas, medan) yang namanya kolom numeric | **32** |
  | nama medan yang BUKAN nama kolom mana pun | **20** (35 situs) |
  | konstanta di `lib/batas-angka.ts` | **7** → 8 |

  Angka ledger lama **"13 konstanta" diralat jadi 7**; 13 adalah jumlah kolom
  yang disebut komentarnya, bukan jumlah konstantanya
- **Metode**: kapasitas tiap kolom dihitung dari `schema.ts` sebagai
  `10^(p−s) − 1` (BigInt — `10 ** 16` sudah tak tepat di float64), lalu
  diadu dengan `.max()` tiap medan lewat peta (berkas, medan) → `tabel.kolom`
- **Detektor pertamaku SALAH, dan itu bagian hasilnya**: penjodohan otomatis
  berdasar NAMA medan menuduh **17, lima belas di antaranya keliru**. `qty` ada
  di **tiga belas** tabel dengan tiga presisi berbeda (10,2 · 12,4 · 16,3 ·
  16,6), jadi penjodoh nama selalu memilih yang tersempit (`sale_items` 10,2)
  dan menuduh setiap `qty` perlengkapan/produksi yang sah. Detektor yang dipakai
  karena itu **peta eksplisit + uji KELENGKAPAN**, bukan penjodoh nama —
  petanya tulisan tangan, tapi medan baru tak bisa lolos diam-diam
- **Detektor**: DIBUKTIKAN bisa menuduh, dua lapis, keduanya dengan suntikan
  yang **di-assert mendarat**: mengembalikan pintu resep ke `BATAS_QTY_STOK` →
  tertuduh `modules/menu/routes.ts:41` **dengan kolom & presisinya disebut**;
  mempersempit `menus.mult` jadi `numeric(6,3)` di `schema.ts` → `BATAS_FAKTOR`
  langsung merah ("harus sama dengan kapasitas menus.mult numeric(6,3)")
- **Hasil**: **DUA TEMUAN**, keduanya kolom `numeric(12,4)` yang dijaga batas
  `numeric(16,6)` — **seratus kali kolomnya**. Terukur lewat HTTP terhadap
  Postgres sungguhan:

  | pintu | sebelum | sesudah |
  |---|---|---|
  | `POST /menu` `komponen[].qty` = 99.999.999 | **201** | 201 |
  | `POST /menu` `komponen[].qty` = 100.000.000 | **HTTP 500** | **400** "komponen[0].qty: maksimal 99999999" |
  | `PUT /bahan/:id/resep` `komponen[].qty` = 99.999.999 | **200** | 200 |
  | `PUT /bahan/:id/resep` `komponen[].qty` = 100.000.000 | **HTTP 500** | **400** bernama |

  Sembilan setengah miliar nilai lolos gerbang yang KELIHATANNYA menjaga.
  Pasangan anti-hijau-palsu ikut diukur: `stok_minimum = 9.999.999.999` tetap
  **201** di jalur stok (`numeric(16,6)`) — pengetatannya tidak bocor ke pintu
  tetangga
- **`BATAS_QTY_RESEP` sengaja tidak digabung dengan `BATAS_ISI`** walau angkanya
  sama: keduanya kebetulan `numeric(12,4)` hari ini, satu isi per kemasan dan
  satu takaran resep. Menyatukannya berarti presisi salah satu kolom yang
  berubah menyeret kolom yang tak ada hubungannya — persis bentuk yang membuat
  `batas-angka.ts` ada
- **Alatnya ikut dibereskan, dan ia TUMBUH KEMBALI**: pengupas komentar naif
  ternyata punya **empat** salinan baru di berkas uji, sesudah vena sebelumnya
  menyatukan tujuh. Terukur atas berkas yang mereka baca sendiri
  (`AnalisisHargaPage`, `RiwayatPage`, `BahanEditorGrid`), ketiganya membuang
  **2–3 aksara lebih banyak** dari yang seharusnya; atas `apps/web` +
  `apps/server` (239 berkas), **74** dan **82** berkas berbeda (2.119 dan 2.576
  aksara). Atas populasi `angka-berbatas-atas` sendiri (server + shared, 127
  berkas) bedanya **satu berkas — `buta-komentar.ts` itu sendiri**, jadi tak ada
  angka gerbang terkirim yang berubah. Keempatnya kini memakai `butaKomentar`
- **Batas detektornya, ditulis jujur**
  - petanya berkunci **(berkas, medan)**, bukan nomor baris: peta yang basi tiap
    minggu akan dihapus orang. Konsekuensinya satu nama medan yang bermuara ke
    dua kolom berbeda **di berkas yang sama** akan dinilai dengan kolom yang
    terdaftar saja — hari ini tak ada yang begitu, dan uji KELENGKAPAN tak bisa
    melihatnya
  - **20 nama medan tak bernama-kolom** (`jumlah` → productions.qty, `harga` →
    total_harga, `porsi` → qty hasil kali, `harga_per_unit`, `dana_cair`, …)
    dinilai dari daftar putusan, bukan dari penelusuran nilai. Yang dijamin cuma
    daftarnya tak bertambah tanpa keputusan
  - **kelas LUAPAN TURUNAN tak disentuh sama sekali**: `porsi × takaran`,
    `jumlah batch × isi`, `harga_per_unit × qty` semuanya bisa melampaui kolom
    hasilnya walau tiap masukannya sah. 13 dari 62 kolom numeric memang diisi
    hasil hitungan server (`sales.total_hpp`, `sale_items.line_total`,
    `stock_opnames.selisih`, …) dan tak satu pun punya penjaga. Itu vena
    tersendiri, bukan bagian yang ini
  - kapasitas yang dipakai bilangan bulat (`10^(p−s) − 1`), bukan kapasitas
    sebenarnya (`… − 10^(−s)`): seluruh konstanta memang bulat, dan batas
    pecahan membuat pesan galatnya tak terbaca orang
- **Tindak**: `BATAS_QTY_RESEP` di `lib/batas-angka.ts` + dua pintu resep
  diperbaiki · gerbang `batas-ikut-presisi-kolom.test.ts` (7 uji) · `verify-api`
  §242 (11 asersi) · empat salinan pengupas komentar disatukan · entri
  `CHANGELOG-API` ⚪️ INFO (ponsel **tidak** menulis resep — tambah/ubah menu &
  resep tetap di web, jadi tak ada perubahan sisi ponsel; dicatat, bukan
  didiamkan). Gerbang: typecheck bersih · `npm test` **2.181** · `verify-api`
  **2.840** terhadap Postgres segar · `audit:invarian` 26/26

---

## SQL mentah: populasi yang tak pernah disapu aturan mana pun — server — 2026-08-24

- **Kenapa vena ini ada**: tiga aturan yang sudah terkirim menulis batas yang
  SAMA tentang dirinya sendiri — *"hanya melihat bentuk TypeScript, bukan SQL
  mentah"*. Celah itu **sudah sekali memakan temuan**: `GET /customer` yang
  1,61 MB tak pernah tertuduh sapuannya sendiri dan ditemukan dengan tangan
- **Populasi** (pemindai template berimbang, menghormati `${}` bersarang;
  definisinya ikut ditulis karena angka tanpa definisi tak bisa ditinjau):

  | ukuran | angka |
  |---|---|
  | template `` sql`…` `` polos di `apps/server/src` | **140** (134 terluar, 6 bersarang) |
  | template `` sql<T>`…` `` — potongan ekspresi ber-cast | **110** |
  | · total | **250** |
  | polos yang memuat pernyataan lengkap | **50** |
  | situs `.execute(` berargumen `` sql`…` `` | **42** dari 43 |
  | kueri lengkap tanpa sebutan `company_id` | **20** |
  | kueri ber-SELECT tanpa `LIMIT` | **29** (22 non-agregat) |

  Angka pengintaian awal (247 / 62 / 19 / 29 / 21) **diralat di sini**: regex
  versi itu tak memuat bentuk `sql<T>` dan menghitung situs `.execute` dua kali
- **Metode**: ketiga aturan yang sudah terkirim dijalankan ulang atas populasi
  itu — langit-langit daftar, pengurungan tenant, dan cast `sql<number>`
- **Detektor**: DIBUKTIKAN bisa menuduh, dua lapis. Sintetis: sebelas masukan
  lewat `situsSql([{nama, isi}])` (telanjang tertuduh · ber-`LIMIT` tidak ·
  agregat skalar berbungkus `COALESCE` tidak · ber-`GROUP BY` ya · `SELECT 1 …
  FOR UPDATE` tidak · `SELECT (subkueri), (subkueri)` tidak · tabel di dalam
  CTE pembantu TETAP terlihat · `LIMIT` milik subkueri pembantu tak memaafkan
  induknya). Pohon sungguhan: mencabut `LIMIT` dari `/sampah` — **suntikan
  di-assert mendarat** (2 → 1) — menuduh `sampah/routes.ts:67` dan menaikkan
  hitungan 9 → 10; mengembalikan `daftar.reduce()` membuat penjaga agregat
  merah. Keduanya hijau lagi sesudah dikembalikan
- **Hasil**: **DUA TEMUAN.** Keduanya membaca tabel yang **sudah ada** di
  daftar `TUMBUH` milik gerbang drizzle — aturan yang sama, tabel yang sama,
  bentuk handler yang sama; satu dijaga dan satu tidak, semata karena cara
  menulisnya berbeda. Diukur lewat HTTP terhadap Postgres nyata, 10.000 baris
  disuntikkan; **suntikannya dibuktikan terbaca lebih dulu** (10.000/10.000
  baris ber-prefiks `UJI-VOL-` muncul di balasan):

  | pintu | sebelum | sesudah |
  |---|---|---|
  | `GET /sampah` | 10.000 baris · **2.438.895 byte** · 78 ms | 300 · 72.793 byte · 23 ms |
  | `GET /penerimaan/anomali` | 10.000 baris · **2.760.043 byte** · **4.170 ms** | 100 · 27.676 byte · 1.522 ms |

  Pasangan anti-hijau-palsu: `jumlah` **tetap 10.000** dan `qty_total` **tetap
  30.000** sesudah dipotong — keduanya pindah ke `COUNT(*) OVER ()` /
  `SUM(qty) OVER ()`, yang Postgres hitung SEBELUM `LIMIT`. Memotong daftar
  tanpa memindahkan agregatnya ke SQL adalah menukar satu bug dengan bug yang
  lebih sunyi
- **Perbaikannya sendiri hampir melahirkan kerusakan baru, dan itu terukur**:
  tanda "barang tidak sampai" di kartu Beli & Produksi diturunkan dari `rows`.
  Dengan baris menggantung tersebar ke **500 faktur**, `rows` yang dipotong
  hanya memperlihatkan **100** di antaranya — 400 faktur kehilangan tandanya
  diam-diam, tepat saat masalahnya paling besar. `faktur_ids` karena itu jadi
  medan tersendiri, dihitung atas populasi penuh (2.000 UUID, ±76 KB terburuk)
- **Bentuk balasan `/sampah` SENGAJA tidak diubah**: ketujuh build ponsel yang
  pernah rilis membacanya `as List`, dan `{items, terpotong}` seperti
  `/customer` akan MELEMPAR di aplikasi yang hari ini terpasang. Batasnya tetap
  berlaku untuk semua; penandanya di header `X-Kakarut-Terpotong`, yang build
  lama abaikan tanpa akibat. Preseden headernya sudah ada di kedua sisi
  (`X-Kakarut-Build` di web, `etag`/`retry-after` di ponsel) dan tak ada
  middleware CORS yang perlu diurus
- **Dua arah lain: negatif bersih BERANGKA, bukan kekosongan**
  1. **Pengurungan tenant.** Ke-20 kueri tanpa `company_id` dipilah tangan dan
     semuanya sah — `SELECT 1`, advisory lock, subkueri berkorelasi, tabel
     global, dan yang terkurung transitif lewat `branch_id` (yang sudah dipilih
     `resolveBranchId`). Satu-satunya penulisan global sungguhan,
     `open-bill/backfill.ts:23`, memang lintas-tenant seperti migrasi
  2. **Cast `sql<number>` atas SQL mentah.** Padanannya bukan `sql<T>`
     melainkan `.rows as { … number }[]` — janji tulisan tangan yang sama
     persis, dan gerbang `sql-number-bukan-janji` buta total terhadapnya.
     Populasi **9**, satu menjanjikan `number` (`sampah/routes.ts:154`, atas
     `COUNT(*)` yang pg pulangkan sebagai **string**), dan itu sudah dibungkus
     `Number()`. Populasi 1 tak memberi gerbang baru
- **Batas detektornya, ditulis jujur**
  - hanya template yang jadi argumen LANGSUNG `.execute(`; potongan yang
    dirakit di tempat lain dinilai di situs pemakainya. Tanpa batas itu,
    `const fakturTerhapus = sql`(SELECT …)`` tertuduh padahal ia bagian DELETE
  - `${pembantu(...)}` ditelusuri **satu tingkat** saja. Tanpa penelusuran itu
    `GET /penerimaan/anomali` — yang `FROM`-nya `g`, CTE di dalam
    `cteMenggantung()` — luput dari sapuan yang justru dibuat untuknya
  - `LIMIT` dinilai pada kueri LUAR: `cteMenggantung` memuat dua subkueri
    berkorelasi ber-`LIMIT 1`, dan menilai teks mentah membuat kueri terbesarnya
    dimaafkan oleh langit-langit milik subkuerinya
  - agregat dinilai pada daftar SELECT tingkat teratas. Versi pertama menilai
    teks yang sudah dikosongkan, jadi `COALESCE(SUM(qty) FILTER (…), 0)`
    menaruh `SUM(` di kedalaman 1 dan tak terlihat — ia **menuduh
    `stok/service.ts:431`**, kueri yang selalu memulangkan tepat satu baris
  - langit-langitnya membatasi BALASAN, bukan pemindaian: `/penerimaan/anomali`
    turun 4,17 → 1,52 dtk, tidak ke nol, karena `COUNT(*) OVER ()` memang
    menuntut satu lintasan penuh. Angka benarnya yang dibayar, dan itu disengaja
  - daftar tabelnya tetap turunan `TUMBUH` yang ditulis tangan — kini
    diturunkan MEKANIS ke snake_case, bukan diketik kedua kalinya, karena
    daftar tangan yang tak memuat `customers` adalah sebab balasan 1,61 MB itu
    tak pernah tertuduh
  - keadaan TERPOTONG tak diuji verify-api: membuatnya butuh 301 penjualan yang
    dihapus satu per satu lewat HTTP (±600 permintaan untuk satu asersi). Yang
    dijaga §241 justru sisi yang paling mudah rusak tanpa disadari — bahwa
    pembatasannya TIDAK mengubah apa pun pada pemakaian normal
- **Tindak**: `situsSql()` di `daftar-tanpa-langit-langit.test.ts` (ratchet
  `DASAR_SQL = 9`, +5 uji), `verify-api.sh` §241 (12 asersi),
  `sampah_terpotong_test.dart` di ponsel (4 uji, bukti merah sendiri).
  Kesembilan situs yang tersisa dipilah tangan dan tak satu pun tumbuh seumur
  pemakaian: backfill boot ×3 (`dokumen/nomor.ts`), satu baris per meja
  (`okupansi.ts:81`), per bahan (`stok/routes.ts:590`, `service.ts:48`,
  `:830`, `:857`), per cabang (`service.ts:547`). Gerbang: typecheck bersih ·
  `npm test` **2.174** · `verify-api` **2.829** terhadap Postgres segar ·
  `audit:invarian` 26/26 · `flutter analyze` bersih · `flutter test` **507**
  pada 3.44.7

---

## N round-trip per baris di dalam transaksi — server — 2026-08-22

- **Populasi**: 33 situs perulangan ber-`await tx.<kueri>` di dalam 72 badan
  `db.transaction`
- **Cakupan (aturan ke-5, diterapkan sejak awal kali ini)**: sapuan sempit
  `for (const x of y)` hanya melihat **16 dari 33 — 48%**. Sapuan lebar (for /
  for await / while / forEach / map(async)) yang dipakai
- **Detektor**: DIBUKTIKAN bisa menuduh — satu loop ber-`await tx.select()`
  disuntikkan ke badan transaksi sungguhan di `company/routes.ts` → ratchet
  merah; dicabut → hijau. Dan DIBUKTIKAN tak salah menuduh: `(?<![.\w])`
  wajib di depan `for`/`while`, sebab tanpa itu `.for("update")` — kunci baris
  drizzle, bukan perulangan — ikut tertangkap dan "menemukan" tiga loop di
  dalam `createSale` yang sama sekali tak ada
- **Hasil**: **TEMUAN** pada 2 situs yang N-nya ditentukan pengirim
- **Ukuran**, `PUT /menu/urutan`, sepuluh permintaan serentak:

  | keadaan | `GET /menu` |
  |---|---|
  | senggang | 0,012 dtk |
  | N=28.000, sebelum dibatasi | **20,07 dtk** |
  | N=2.000, sesudah dibatasi | 1,47 dtk |
  | N=2.000, sesudah SATU pernyataan | **0,012 dtk** — tak terbedakan dari senggang |

  Pada tingkat kuerinya, 2.000 baris terhadap Postgres yang sama: **289 ms
  berurutan vs 11 ms** satu pernyataan `unnest` (26×), dengan hanya 3 parameter
  ikat berapa pun N-nya
- **Tindak**: `PUT /menu/urutan` dan `PUT /meja/tata-letak` ditulis ulang jadi
  satu `UPDATE … FROM (SELECT unnest(…))`; transaksinya dibuang (satu
  pernyataan sudah atomik sendiri); ratchet `test/round-trip-per-baris.test.ts`
  dengan DASAR 31; §231 memeriksa HASILNYA — 81 menu diurutkan terbalik lalu
  dibaca lagi, dan id asing tak menyentuh baris mana pun
- **Yang hampir merusak**: versi pertama membalas **500 "cannot cast type
  record to uuid[]"** — drizzle memecah larik JS jadi TUPLE `($1, $2, …)`,
  bentuk yang berguna untuk `IN (…)` tapi mustahil dicast ke `uuid[]`.
  `sql.param(...)` wajib membungkusnya. Probe `pg` mentah LOLOS, sebab di sana
  lariknya memang satu parameter — hanya tembakan lewat HTTP yang
  menemukannya
- **Kenapa ratchet dan bukan nol**: dari 33 situs, hanya 2 yang N-nya
  ditentukan pengirim; sisanya berputar atas data internal yang sudah terbatas
  sendiri (jumlah cabang, hari tertunggak, baris satu faktur). Menuntut nol
  berarti menulis ulang tiga puluh tempat demi bahaya yang tak ada di
  kebanyakan darinya — dan uji yang menuntut pekerjaan tanpa alasan akan
  dilonggarkan orang, bukan dipatuhi

## Larik permintaan (LANJUTAN) — gerbangnya sendiri buta 54% — server — 2026-08-22

- **KOREKSI entri di bawahnya.** Entri "Larik badan permintaan tanpa batas
  atas" menyatakan populasinya **18** dan semuanya beres. Populasinya
  sebenarnya **39**. Regex gerbangnya menuntut `z` dan `.array(` bersebelahan,
  sementara prettier memformat skema panjang sebagai `items: z\n  .array(` —
  dan bentuk itu tak terlihat sama sekali. Yang luput 21 larik, termasuk
  SELURUH larik di `penjualan`, `produksi`, `sync`, dan `transfer`
- **Metode**: regex diperlebar jadi `z\s*\.\s*array\s*\(`, lalu populasinya
  dihitung ulang dari nol
- **Detektor**: DIBUKTIKAN bisa menuduh, DUA arah —
  (a) pola sempit dikembalikan → uji "melihat SELURUH populasi" merah dengan
  angkanya sendiri ("expected 18 to be greater than 18");
  (b) `.max(500)` dicabut dari `penjualan/routes.ts` → tertuduh di baris 49
- **Hasil**: **TEMUAN**, 13 larik masih telanjang sesudah putaran sebelumnya
- **Ukuran** (`POST /penjualan`, yang terburuk): `insert into sale_items`
  memakai **14 parameter ikat per baris**, dan Postgres membatasi 65.535 →
  ambang **4.681 baris**. Terukur:

  | N | sebelum | sesudah |
  |---|---|---|
  | 4.500 | 201 | 201 |
  | 5.000 | **500** "Terjadi kesalahan pada server" | **400** "items: maksimal 500" |
  | 30.000 | 500 | 400 |

  Galatnya mendarat di `error_logs` sebagai `DrizzleQueryError` berisi SQL
  penuh. Yang diperbaiki batas ini karena itu bukan cuma bebannya melainkan
  BENTUK jawabannya
- **Tindak**: 13 larik diberi `.max()` (500 baris transaksi, 1000 baris opname,
  200 komponen); regex gerbang diperlebar; uji baru "PASANGAN: pemindainya
  melihat SELURUH populasi" memaku perbandingan dengan pola sempitnya supaya
  kebutaan itu tak bisa kembali diam-diam; §231 diperluas
- **Pelajaran yang dicatat, bukan disembunyikan**: detektor yang dibuktikan
  bisa menuduh SATU kasus belum tentu MELIHAT seluruh populasinya. Bukti merah
  menjawab "bisakah ia menuduh?"; ia tak menjawab "berapa yang dilihatnya?".
  Sejak sekarang tiap sapuan wajib menyebut CAKUPAN, bukan cuma kemampuan
  menuduh

## Larik badan permintaan tanpa batas atas — server — 2026-08-22

- **Populasi**: 18 `z.array(...)` di skema badan permintaan `apps/server/src`
- **Metode**: `larik-tanpa-batas.py` — tiap `z.array(...)`, baca rantai method
  sesudahnya, pilah yang memuat `.max(` dari yang tidak
- **Detektor**: DIBUKTIKAN bisa menuduh — `.max(2000)` dicabut dari
  `penyimpanan/routes.ts` → hitungan berbatas turun 10→9 dan lariknya muncul
  di daftar telanjang; dipulihkan → 10 lagi
- **Hasil**: **TEMUAN**. 10 dari 18 sudah berbatas — termasuk DUA yang tinggal
  di berkas yang SAMA dengan larik telanjangnya. Delapan sisanya tidak
- **Ukuran** (`PUT /menu/urutan`, satu UPDATE per baris di dalam transaksi;
  rutanya "boleh diakses SEMUA PERAN termasuk kasir"):

  | N | lama satu permintaan |
  |---|---|
  | 1 | 13 ms |
  | 1.000 | 242 ms |
  | 20.000 | 2,94 dtk |
  | 28.000 (langit batas badan 2 MB) | ~4,4 dtk |

  Dan yang benar-benar merusak bukan permintaan itu sendiri melainkan SEMUA
  yang lain — `db` adalah pg.Pool max 10:

  | keadaan | `GET /menu` |
  |---|---|
  | senggang | 0,009 dtk |
  | 10 × `PUT /menu/urutan` N=28.000 | **20,07 dtk** (2.200×) |
  | sesudah semuanya usai | 0,009 dtk |
  | 10 × N=2.000 (batas baru) | **1,47 dtk** |

- **Tindak**: kedelapan larik diberi `.max()` dengan angka yang SUDAH mapan di
  repo (2000 daftar uuid panjang, 500 daftar id, 200 baris komponen, 100
  daftar cabang); gerbang `test/larik-permintaan-berbatas.test.ts`; §231
  verify-api. Pengurutan sah 81 menu sungguhan tetap 200 dalam 35 ms
- **Utang yang DIUKUR, bukan dinyatakan beres**: batasnya mengecilkan
  kerusakan 14× tapi TIDAK menghapus mekanismenya — `PUT /menu/urutan` masih
  melakukan N round-trip di dalam satu transaksi. Menggantinya dengan satu
  `UPDATE … FROM (VALUES …)` akan membuatnya satu round-trip berapa pun N-nya.
  Itu vena tersendiri, sudah masuk antrean di bawah

## I/O jaringan di dalam `db.transaction` — server — 2026-08-22

- **Populasi**: 72 badan `db.transaction(...)` di `apps/server/src`
- **Metode**: dua sapuan bertingkat.
  (a) `io-dalam-tx.py` — panggilan berat yang HARFIAH di dalam badan transaksi:
  `kirimEmail`, `PutObjectCommand`/S3, `fetch`, `bcrypt.hash/compare` async,
  `fs.*`;
  (b) `io-dalam-tx2.py` — SATU lapis indireksi: 354 fungsi tingkat berkas
  diindeks, 33 nama yang benar-benar dipanggil dari dalam badan transaksi
  ditelusuri ke definisinya, lalu badannya diperiksa dengan pola yang sama
- **Detektor**: DIBUKTIKAN bisa menuduh, KEDUANYA.
  (a) `await kirimEmail(...)` palsu disisipkan ke badan transaksi sungguhan di
  `users/routes.ts` → tertuduh di baris 204; dicabut → nol lagi.
  (b) `await fetch(...)` palsu disisipkan ke `resolveKodeKaryawan` — fungsi
  yang MEMANG dipanggil dari dalam transaksi → 2 tersangka muncul
  (`users/routes.ts`, `admin-tenants/routes.ts`); dicabut → nol lagi
- **Hasil**: **BERSIH**. Nol I/O jaringan di dalam transaksi, langsung maupun
  satu lapis di bawah
- **Konteks**: repo ini memang sudah sadar kelasnya — `autoFileRakCabang`
  SENGAJA ditinggal di luar transaksi penerimaan, dengan komentar yang
  menyebut alasannya
- **Batas**: (1) hanya SATU lapis indireksi — fungsi yang memanggil fungsi
  yang ber-I/O tak terlihat; (2) hanya `await <ident>(`, jadi panggilan metode
  `await obj.method(` tak ditelusuri; (3) daftar "berat"-nya pilihan, bukan
  kelengkapan
- **Tindak**: —

## Isolasi tenant pada PENULISAN — server — 2026-08-22

- **Populasi**: 162 `UPDATE`/`DELETE` di `apps/server/src`
- **Metode**: sapuan AST-kasar — tiap `.update(t)`/`.delete(t)`, ekstrak
  `.where(...)`-nya, lalu pilah: mengurung `companyId` sendiri / menulis ke
  baris yang id-nya berasal dari SELECT terkurung / handler-nya tak menyebut
  perusahaan sama sekali
- **Detektor**: DIBUKTIKAN bisa menuduh — 3 penulisan tanpa `.where()` sama
  sekali tertangkap (`auth`, `rateLimit`, `lib/build`), dan ketiganya
  diperiksa sah
- **Hasil**: **BERSIH**. 72 mengurung `companyId` langsung di WHERE-nya; 37
  menulis ke baris yang id-nya `x.id` dari SELECT terkurung; 53 sisanya
  diperiksa dengan tangan — kebersihan ×6, bahan ×2, menu ×2, papan pesanan
  ×9, open-bill ×2, users ×1, onboarding ×2, dan semuanya memverifikasi
  induknya lebih dulu lalu 404
- **Batas**: hanya melihat bentuk yang ditulis TypeScript, bukan SQL mentah.
  Pengurungan yang tinggal di variabel (`filter`, `conds`, `kunci`) tak
  ditelusuri — semuanya diperiksa tangan sebagai gantinya
- **Tindak**: —

## Penulisan ke tabel `users` GLOBAL — server — 2026-08-22

- **Populasi**: 9 `insert`/`update`/`delete` ke `users` di luar seed
- **Metode**: telusuri tiap situs sampai gerbangnya
- **Detektor**: pembandingnya bukan sapuan melainkan pembacaan penuh 9 situs;
  kekuatannya berasal dari populasinya yang habis, bukan dari sampel
- **Hasil**: **BERSIH**, dan gerbangnya justru teliti. `PATCH
  /karyawan/:id` memblokir 403 untuk password, email, dan penonaktifan global
  bila akun itu masih aktif di perusahaan LAIN — `memberships_user_company_uq`
  memang mengizinkan satu akun jadi anggota beberapa perusahaan. Sisanya
  terkunci ke `auth.sub` (profil sendiri, hapus akun sendiri) atau menolak
  email yang sudah terdaftar
- **Tindak**: —

## Kunci JSON: dibaca mobile tapi tak pernah dikirim server — mobile — 2026-08-21

- **Populasi**: 425 kunci yang dibaca `lib/**.dart` vs 804 kunci yang dikenal
  `apps/server/src` + `packages/shared`
- **Metode**: `scratchpad/kunci.py` — himpunan selisih dua arah
- **Detektor**: DIBUKTIKAN bisa menuduh — kunci palsu
  `omzet_yang_tak_pernah_ada` disuntikkan ke `operasional_models.dart`,
  tertuduh; dicabut, hijau lagi
- **Hasil**: **BERSIH** untuk arah "mobile membaca yang tak ada" (7 kandidat,
  semuanya penyimpanan lokal mobile sendiri). Arah sebaliknya menyisakan satu
  celah koheren: seluruh fitur **lama pengerjaan pesanan** (`durasi_detik`,
  `masuk_pada`, `target_durasi_detik`, `LaporanDurasiPesanan`, `DurasiMenuRow`,
  `DurasiRiwayatRow`) sudah tayang di production tapi belum diurai mobile
- **Batas**: regex `x['kunci']` tak melihat kunci yang lewat variabel
  (`j[k]`) maupun kunci pada badan PERMINTAAN (map literal) — keduanya
  menghasilkan positif palsu yang sudah dipilah tangan
- **Tindak**: celah fitur durasi dicatat di PR #207, belum dikerjakan

## `sql<number>` yang tak dicast — server — 2026-08-21

- **Populasi**: 76 ekspresi `sql<number...>` di `apps/server/src`
- **Metode**: sapuan + probe langsung ke Postgres 16 untuk mengukur tipe
  balikan tiap agregat
- **Detektor**: DIBUKTIKAN — mencabut satu cast → menuduh berkas & barisnya;
  mengubah ekspresi yang dikecualikan → menuduh daftarnya basi
- **Hasil**: **TEMUAN**. 12 ekspresi tanpa cast, semuanya di jalur uang/cacah.
  Driver memulangkan `SUM(numeric)`, `SUM(integer)`, `AVG`, dan `COUNT(*)`
  sebagai STRING sementara `sql<number>` membuat TypeScript yakin ia `number`.
  Keduabelas pemanggilnya ternyata sudah membungkus `Number(...)`, jadi tak
  ada angka yang salah hari ini — yang dipindahkan letak kebenarannya, dari
  disiplin ke struktur
- **Tindak**: `::float8`/`::int` di ekspresinya; gerbang
  `test/sql-number-bukan-janji.test.ts`

## Tanggal bisnis di `verify-api.sh` — server — 2026-08-21

- **Populasi**: 20 perhitungan tanggal-saja (`+%F`) di skripnya
- **Detektor**: DIBUKTIKAN dua arah — mengembalikan `date -u` di §218 →
  tertuduh; menghapus `TZ=` pada satu dari dua perintah SEBARIS → mula-mula
  LOLOS, dan itu lubang di penjaganya sendiri yang lalu ditutup dengan memecah
  per perintah
- **Hasil**: **TEMUAN**. 18 dari 20 sudah memakai `TZ=Asia/Jakarta`, dua di
  antaranya bahkan menuliskan alasannya di komentar. Dua pintu terlewat, dan
  §218 GAGAL NYATA pada pukul 23.18 UTC — gerbangnya merah tujuh jam setiap
  hari
- **Tindak**: kedua pintu diperbaiki; gerbang menumpang
  `zona-waktu-satu-suara.test.ts`

## Batas laju pada pintu pengirim email — server — 2026-08-22

- **Populasi**: 4 pemanggil `await kirimEmail(` di `apps/server/src`
- **Detektor**: DIBUKTIKAN — mencabut kedua ember → sapuan menuduh
  `modules/users/routes.ts (baris 253)`
- **Hasil**: **TEMUAN**. `POST /karyawan/undang` tak berbatas sementara dua
  pintu sekelasnya di `auth/routes.ts` sudah berbatas 6/15mnt dengan alasan
  tertulis "cegah bom email ke korban". Terukur: 20 dari 20 surat terkirim ke
  korban yang sama, nol 429 → sesudah diperbaiki 6 terkirim, 14 ditolak
- **Batas**: granularitasnya BADAN, jadi penjaga yang sah tapi tinggal di
  PEMANGGIL terbaca "tanpa penjaga" — `kirimTautanVerifikasi` persis begitu
- **Tindak**: dua ember di `users/routes.ts`; aturan `email-berbatas` di
  `penjaga-semua-pintu`; §230 verify-api

## Balasan daftar tanpa langit-langit — server — 2026-08-22

- **Populasi**: 147 `.select().from(tabel-yang-tumbuh)` di `apps/server/src`.
  41 sudah ber-`.limit()`, 29 by-id, sisanya 75 bacaan daftar penuh. Dipilah
  tangan: 24 terikat induk tunggal (baris satu faktur, item satu struk), 3
  terikat rentang tanggal, **48 tak terikat apa pun** — tumbuh seumur warung
- **Metode**: `scratchpad/tanpa-limit{,2,3,4}.py`
- **Detektor**: DIBUKTIKAN — `.limit(BATAS_TRANSAKSI_SHIFT + 1)` dicabut dari
  `shift/routes.ts` (suntikannya di-assert mendarat lebih dulu) → sapuan
  menuduh `modules/shift/routes.ts:200`; dikembalikan → hilang lagi.
  Diperiksa pula ke arah sebaliknya: hasil jendela 1.500 aksara dibandingkan
  dengan 20.000 → **0 tuduhan palsu**
- **Hasil**: **TEMUAN**, dua pintu ke ruangan yang sama di
  `modules/customer/routes.ts`. Terukur pada Postgres berisi 10.002 member dan
  satu member dengan 20.001 transaksi:

  | | sebelum | sesudah |
  |---|---|---|
  | `GET /customer` | 1,53 MB · 0,072 dtk | **0,046 MB · 0,031 dtk** |
  | `GET /customer/:id` | 2,83 MB · 0,109 dtk | **0,042 MB · 0,017 dtk** |

  Yang membuat vena ini tak selesai dengan menempelkan `.limit()`:

  1. **Agregatnya dihitung dari larik yang dikirim.** `total_belanja` dan
     `jumlah_transaksi` dijumlahkan di JavaScript atas seluruh baris, jadi
     `.limit(300)` polos akan menjawab "Total belanja Rp 3 juta" untuk member
     yang sudah belanja Rp 600 juta. Dipindah ke agregat SQL tanpa batas LEBIH
     DULU; pasangannya terukur: 20.001 dan 600.030.000 **identik** sebelum dan
     sesudah pemotongan
  2. **Halaman Member menyaring di browser** (`useMemo` atas seluruh larik).
     Memotong 300 tanpa pencarian sisi server tidak sekadar menyembunyikan
     member ke-301 — ia membuatnya **mustahil ditemukan**. Terbukti terukur:
     `Member Uji 2137` tak ada di 300 yang terkirim, ketemu lewat `?q=`
- **Pola**: pintu saudaranya ada di berkas yang SAMA. `memberCariRoutes`
  sepuluh baris di atasnya sudah mencari di server dan sudah ber-`.limit(8)`
  sejak awal
- **Batas**: sapuan hanya melihat bentuk drizzle `.select().from()` — SQL
  mentah lewat `db.execute` tak terlihat. Daftar tabelnya DITULIS TANGAN, dan
  `customers` tak ada di dalamnya: balasan 1,61 MB itu **tak pernah tertuduh**,
  ia ditemukan dengan tangan. Versi pertama juga hanya melihat rantai SESUDAH
  `.from()` — padahal daftar SELECT ada sebelumnya, jadi hampir semua agregat
  luput dan hitungannya 78, bukan 63
- **Sisa yang tercatat, bukan dikerjakan**: enam riwayat harga per-item
  sepanjang masa (`perlengkapan/routes.ts:118`, `perlengkapan/service.ts:515`
  & `:544`, `bahan/routes.ts:464`, `produksi/routes.ts:536`,
  `rekomendasi/routes.ts:183`). Bentuknya sama — daftar tanpa batas yang
  agregatnya dihitung di JS — tapi tumbuhnya jauh lebih lambat (satu baris per
  pembelian item itu). Masuk antrean sebagai vena tersendiri
- **Tindak**: kedua pintu dibatasi 300 + penanda `terpotong` /
  `transaksi_terpotong`; `?q=` sisi server memakai penyaring yang sama dengan
  `memberCariRoutes`; ratchet `daftar-tanpa-langit-langit.test.ts` (DASAR 63);
  §232 verify-api (14 asersi); `MemberPage.tsx` menampilkan kedua penanda

## Agregat dihitung di JavaScript atas daftar tak berbatas — server — 2026-08-22

- **Populasi**: 63 bacaan daftar tanpa batas atas tabel yang tumbuh (dari
  vena sebelumnya). Ditelusuri variabel penerimanya, lalu diperiksa apakah
  larik itu DIAGREGAT di JS (`.reduce(`, `.length`, `for..of`,
  `.filter().length`, `.forEach(`): **24 ya**, 32 tidak, 7 variabelnya tak
  terlacak
- **Metode**: `scratchpad/agregat-js.py`
- **Detektor**: DIBUKTIKAN — `rows.reduce((n, r) => n + r.qty, 0)` disuntikkan
  tepat sesudah kueri `rekomendasi/routes.ts:183` (suntikannya di-assert
  mendarat DUA kali: sebelum & sesudah tulis) → bentuknya berubah dari
  `for..of` jadi `.reduce(, for..of`; dicabut → pulih.
  Versi pertamanya melewatkan suntikan itu: jendela pelacak variabelnya
  dipatok ke `.from(`, padahal blok `.select({…})` bisa dua puluh baris,
  sehingga jendelanya mulai SESUDAH deklarasi variabelnya. Dipatok ulang ke
  `.select(` → yang tak terlacak turun **15 → 7**, yang tertangkap naik
  **19 → 24**
- **Hasil**: **TEMUAN**. Dari 24, dua puluh terikat sesuatu yang tak ikut
  tumbuh (baris satu faktur, item satu struk, jendela satu shift, sesi opname,
  `inArray` dari daftar induk). Yang tersisa: **kartu Riwayat Harga**, dua
  pintu ke ruangan yang sama (`bahan/routes.ts`, `perlengkapan/routes.ts`).
  Terukur pada satu bahan dengan 12.018 lot:

  | | sebelum | sesudah |
  |---|---|---|
  | `GET /bahan/:id/pembelian` | 2,098 MB · 0,092 dtk | **0,053 MB · 0,061 dtk** |

  Yang membuatnya lebih berbahaya daripada ukurannya: `harga_median` di kartu
  ini **JADI harga acuan RAB belanja** (disinkron tiap Laporan Harga), dan
  harga acuan itu dasar HPP setiap menu yang memakai bahannya. Median dari
  "300 lot terbaru" menggeser HPP seluruh menu tanpa satu pun galat muncul.
  Pasangannya diukur: ketujuh angka (`jumlah_pembelian`, `jumlah_harga_nyata`,
  `harga_rata`, `harga_median`, `harga_terkini`, `harga_terendah`,
  `harga_tertinggi`) **identik** sebelum dan sesudah pemotongan
- **Ikut ketemu**: rumus harga per satuan
  (`Math.round((total / qty) * 100) / 100`) hidup dalam **empat** salinan —
  `harga-stats.ts` ×2, `bahan/routes.ts`, `perlengkapan/routes.ts`, dan
  `stok/service.ts` (kartu FIFO). Pembulatannya bagian dari jawabannya:
  median/terendah/tertinggi dihitung DARI angka yang sudah dibulatkan itu.
  Komentar di `harga-stats.ts` sendiri sudah menulis bahwa rata-rata tertimbang
  pernah "disalin utuh di dua berkas rute — dan kedua salinan sama-sama lupa"
- **Kesalahanku, tertangkap penjagaku sendiri**: pemindai vena sebelumnya
  memotong ekor pernyataan di `;` saja. Dua kueri di dalam `Promise.all([a, b])`
  tak pernah turun ke kedalaman nol sampai `]);`, jadi ekor kueri PERTAMA
  menelan kueri kedua dan `.limit()` milik yang kedua **memaafkan** yang
  pertama — bentuk yang baru saja kutambahkan sendiri. Gerbangnya menghitung
  61, bukan 63. Diperbaiki (berhenti juga di `,` kedalaman nol) dan diperiksa
  ke belakang: pada `HEAD` sebelumnya kedua versi sama-sama 63, jadi kebutaan
  itu tak pernah menyembunyikan apa pun di masa lalu
- **Batas**: pelacakan variabel hanya mengenali `const X = await db|dbx|exec|tx`
  dalam 400 aksara sebelum `.select(` — 7 situs masih tak terlacak dan
  diperiksa mata. Bentuk agregat yang dicari lima macam; `.map()` yang
  menjumlahkan di dalam pemanggilnya tak terlihat
- **Tindak**: kedua kartu dipecah jadi dua kueri — statistik dari kueri SEMPIT
  tanpa batas (empat kolom, tanpa join), daftar `lots` berbatas 300 +
  `lots_terpotong`; `hargaPerSatuanLot` jadi satu-satunya rumus (empat salinan
  → satu); pemindai gerbang diperbaiki + asersi `Promise.all`; 4 asersi baru di
  `daftar-tanpa-langit-langit.test.ts`; §233 verify-api (13 asersi, premisnya
  memilih bahan yang BENAR-BENAR punya lot); `RiwayatHargaModal.tsx`
  menampilkan pemotongan dan menyimpulkan "ada lot tebakan" dari angka
  populasi, bukan dari larik yang dipotong

## `z.number()` tanpa batas atas — server — 2026-08-22

- **Populasi**: **109** `z.number()` di `apps/server/src` + `packages/shared/src`.
  32 sudah ber-`.max()`, **77 telanjang**
- **Metode**: `scratchpad/znumber.py`; polanya `z\s*\.\s*number\s*\(` supaya
  bentuk prettier (`harga: z\n  .number()`) ikut terlihat — pelajaran dari
  gerbang larik yang dulu buta 54%
- **Detektor**: DIBUKTIKAN — `.max(1_000_000_000_000)` dicabut dari
  `produksi/routes.ts:153` (suntikan di-assert mendarat) → tertuduh;
  dikembalikan → hilang. Pasangannya: ketiga bentuk penulisan
  (`z.number()`, multi-baris, berspasi) diperiksa cocok
- **Hasil**: **TEMUAN**. `numeric(p, s)` cuma memuat `p − s` digit di depan
  koma; `z.number()` menerima sampai 1,8e308. Terukur lewat HTTP:

  | kirim | sebelum | sesudah |
  |---|---|---|
  | `PUT /menu/:id` `mult = 9.999` | 200 | 200 |
  | `PUT /menu/:id` `mult = 10.000` | **HTTP 500** | `400 "mult: maksimal 9999"` |
  | `POST /penjualan` `qty = 99.999.999` | 201 | 201 |
  | `POST /penjualan` `qty = 1e8` | **HTTP 500** | `400 "items[0].qty: maksimal 99999999"` |
  | `POST /bahan` `harga_beli = 999.999.999.999` | 201 | 201 |
  | `POST /bahan` `harga_beli = 1e12` | **HTTP 500** | `400 "harga_beli: maksimal 999999999999"` |

  Dan yang lebih sunyi daripada 500: **apa yang lolos**. `qty = 10.000.000`
  dibalas **201**, tersimpan, lalu ikut tiap SUM — omzet hari itu terbaca
  **Rp 11.003.936.250** dari satu ketikan. Tak ada galat, tak ada peringatan
- **Pola**: aturannya SUDAH ditegakkan di empat pintu (`harga_per_unit`,
  `harga`, `dana_cair`, `realisasi`) dan tujuh puluh tujuh saudaranya
  dibiarkan. Lebih dari itu — **batas yang sudah ada pun salah**: keempatnya
  memakai `1_000_000_000_000`, satu lebih BESAR dari yang muat di
  `numeric(14,2)`. Terukur: 1e12 lolos Zod lalu jatuh 500; 1e12+1 ditolak 400.
  Pintu yang "sudah dijaga" meloloskan tepat satu nilai yang meledak
- **Batas**: gerbangnya menuntut ADANYA `.max()`, bukan bahwa angkanya cocok
  dengan kolom tujuannya — pemetaan medan → kolom tak ada di kode, jadi
  `.max()` yang kebesaran tetap lolos. Yang menjaganya `batas-angka.ts`, tempat
  tiap konstanta menyebut kolomnya. Batasnya juga TIDAK menghalangi nilai yang
  absurd-tapi-muat: `qty = 99.999.999` tetap diterima. Batas bisnis sengaja tak
  dikarang — penjaga yang menolak data sah lebih merusak daripada bug yang
  dijaganya
- **Satu pengecualian, disebut namanya**: `BahanImportRowBody`. Rute impor
  melaporkan kegagalan PER BARIS lalu meneruskan sisanya; `.max()` di situ
  memindahkan penolakan ke Zod yang membatalkan SELURUH badan — satu sel salah
  ketik di baris ke-500 membuang 999 baris yang benar. Ditemukan karena §225
  verify-api berubah merah, bukan karena kupikirkan lebih dulu. Angkanya tetap
  tak lolos ke basis data (dijaga §225). Pengecualiannya dibatasi ke DALAM
  skema itu saja, dengan uji yang membuktikan medan bernama sama di skema lain
  pada berkas yang sama tetap tertuduh
- **Kesalahanku**: uji "batas `}` menghentikan rantai" kutulis seolah terbukti;
  suntikan yang mencabutnya ternyata tetap hijau — yang menahan di situ `)`
  penutup, bukan `}`. Klaimnya diralat di komentarnya alih-alih dibiarkan
  terbaca sebagai bukti
- **Tindak**: `lib/batas-angka.ts` (7 konstanta, tiap satu menyebut kolomnya);
  77 medan diberi batas; 4 batas 1e12 yang kelebihan satu diperbaiki; gerbang
  `angka-berbatas-atas.test.ts` (5 uji, penyaring komentar supaya tak menuduh
  prosanya sendiri); §234 verify-api (10 asersi, tiap penolakan dipasangkan
  nilai sah tepat di batasnya); 4 source-pin lama disesuaikan

## Pesan galat sistem sampai ke penyewa — server — 2026-08-22

- **Populasi**: mula-mula kusapu 28 blok `catch` (17 membaca pesan galatnya).
  Itu populasi yang SALAH. `onError` global sudah rapi — galat tak tertangani
  jadi "Terjadi kesalahan pada server" — jadi satu-satunya teks yang lolos apa
  adanya `message` milik `HTTPException`. Populasi sebenarnya: **453
  `new HTTPException`** di `apps/server/src`; **88** pesannya menyisipkan nilai;
  **5** membawa teks galat sistem
- **Metode**: `scratchpad/pesan-galat{,2,3,4}.py`
- **Detektor**: DIBUKTIKAN — kebocoran baru disuntikkan ke `menu/routes.ts`
  (di-assert mendarat) → tertuduh di baris yang tepat; dicabut → hilang
- **Hasil**: **TEMUAN**, satu pintu. Empat dari lima ada di
  `admin-system/routes.ts` yang digerbang super admin — TERUKUR lewat HTTP, tak
  disimpulkan dari membaca: kelima rutenya membalas **403 untuk owner MAUPUN
  kasir**. Yang kelima `print/routes.ts`, dan itu satu-satunya yang bisa dicapai
  kasir. Terukur sebagai kasir:

  ```
  POST /print/lan {host:"192.0.2.2", port:9100}
  → "Gagal mencetak ke 192.0.2.2:9100 — connect ECONNREFUSED 192.0.2.2:9100."
  → sesudah: "… — koneksi ditolak (port tertutup atau printer mati)."
  ```

  Yang berubah **bukan** seberapa banyak yang diketahui pemanggil: ketiga
  keadaan (menjawab / menolak / diam) memang harus bisa dibedakan, dan tetap
  bisa — juga lewat waktu tunggu. Yang berubah, teksnya kini milik kita. Pesan
  pustaka bisa berganti isi kapan saja dan apa pun isinya dulu ikut keluar
- **Kebutaan detektor, ditemukan tangan bukan oleh sapuannya**: sapuan ketiga
  hanya melihat ekspresi yang disisipkan (`${e.message}`) dan karena itu buta
  terhadap `const pesan = e.message; … ${pesan}` — bentuk yang dipakai
  `print/routes.ts`, yaitu satu-satunya temuan vena ini. Sapuan keempat
  melacak variabelnya; penjaganya memakai bentuk keempat
- **Ikut diperiksa & BERSIH**: `resolveHostPrinter` menolak alamat internal
  SEBELUM menyentuh soket dan mem-pin IP hasil resolve (anti DNS-rebinding).
  Terukur sebagai kasir: `127.0.0.1`, `localhost`, `169.254.169.254`, `::1`
  → 400 "tidak diizinkan (internal)". LAN privat (`10/8`, `192.168/16`,
  `172.16/12`) memang SENGAJA diizinkan — printer LAN tinggal di sana, dan
  komentarnya menyebutnya
- **Batas**: penjaganya hanya melihat `new HTTPException`. Medan galat yang
  dibalas lewat `c.json` biasa — mis. `alasan` per baris pada impor bahan —
  tak terlihat sama sekali; yang menjaganya §225. Ia juga tak mengukur
  seberapa banyak yang bocor, cuma apakah teksnya milik kita
- **Tindak**: `sebabGagalCetak()` menerjemahkan `code` soket ke kalimat kita;
  gerbang `pesan-galat-milik-kita.test.ts` (5 uji) dengan pengecualian
  `admin-system` yang TIDAK dipercaya begitu saja — ada uji yang menuntut
  `requireSuperAdmin` masih terpasang di `/admin/*`, jadi melepas gerbangnya
  membuat pengecualiannya ikut merah; §235 verify-api (7 asersi). Mobile tak
  terpengaruh: ia mencetak lewat Bluetooth, `/print/lan` hanya dipakai web

## Uang ditulis di luar pembantu bersama — server + web + mobile — 2026-08-22

- **Populasi**: dua lapis.
  (a) **Penulisan kolom uang `sales`**: 5 `insert/update(sales)` di
  `apps/server/src`, **3** menyentuh kolom uang — semuanya di jalur kanonik
  (`createSale`, `hitungUangSetelahRefund`, rekalkulasi HPP).
  (b) **Rumusnya sendiri**, disapu lintas TIGA permukaan (server, web, mobile):
  `PB1 = round(net × tarif/100)` → 3 kemunculan; `TOTAL = subtotal − diskon`
  → 9 kemunculan
- **Metode**: `scratchpad/uang-liar.py`, `scratchpad/rumus-uang.py`
- **Detektor**: DIBUKTIKAN dua kali — penulisan uang disuntikkan ke
  `sampah/routes.ts` (di-assert mendarat) → tertuduh, dicabut → hilang; dan
  penjaga rumusnya diuji dengan bentuk yang sah maupun yang salah
- **Kebutaan detektor, ditemukan lewat silang-periksa dengan `grep`**: sapuan
  pertama menghitung **1** penulisan, padahal ada **5**. Dua sebab: pola
  `medan:` tak melihat shorthand `{ totalHpp }`, dan `.values(x)` non-literal
  dilewati diam-diam. Diperbaiki → 3 yang menyentuh uang, 0 tak terbaca
- **Hasil**: **TEMUAN — dan seluruhnya di mobile.** Sisi server & web bersih:
  web mengimpor `hitungPb1` dan komentarnya menuliskan alasannya
  ("`hitungPb1`, bukan rumusnya ditulis ulang"), penulisan `sales` semuanya
  lewat jalur kanonik. Dart tak bisa mengimpor `@kakarut/shared`, jadi mobile
  punya tiga salinan. Diadu dengan aslinya lewat **697 baris fikstur yang
  DIHASILKAN implementasi TypeScript-nya sendiri** (bukan diketik ulang):
  `tarifPb1Struk` dan `hitungUangSetelahRefund` **cocok sempurna**;
  `bayar_sheet.dart` menyimpang.

  Terukur, sapuan tarif 1,00%–15,00% × net 1…2.000.000 (**26.185.000
  pasangan**) dijalankan di JavaScript DAN di Dart — keduanya memberi pasangan
  yang sama persis:

  | net Rp 25.000, tarif 1,13% | hasil |
  |---|---|
  | `net × (tarif ÷ 100)` — server, struk | **Rp 283** |
  | `net × tarif ÷ 100` — lembar pembayaran | **Rp 282** |

  Selisihnya satu rupiah; tempatnya yang penting — layar tempat kasir membaca
  total sebelum menekan Bayar dan menghitung kembalian, dan lembar itu berbeda
  dari struk yang dicetak untuk transaksi yang sama
- **Pola**: aturannya tertulis **dua kali** — di komentar `receipt_builder.dart`
  ("urutan operasinya SENGAJA sama persis… dua urutan itu bisa berbeda di bit
  terakhir") dan di komentar `KasirPage.tsx`. Pintu pembayarannya yang tak
  mengikuti
- **Kesalahanku**: penjaga "rumusnya cuma satu salinan" versi pertama
  mencocokkan bentuk ekspresi dengan `\w*`, dan `company!.pb1Rate` memuat `!`
  dan `.` — bukan `\w`. **Bukti merah yang menyuntikkan kembali bug aslinya
  tetap HIJAU.** Diganti jadi `* … / 100` apa pun isinya + barisnya harus
  menyebut pb1/tarif, dengan pasangan uji yang membuktikan `maksPersen / 100`
  milik batas diskon tetap bebas
- **Batas**: fikstur cerminnya menguji tiga fungsi, bukan seluruh aritmetika
  uang. `TOTAL = subtotal − diskon + pb1` sendiri tak ikut diadu baris demi
  baris — ia terlalu sederhana untuk menyimpang, tapi itu penilaian, bukan
  pengukuran. Penjaga rumusnya juga hanya melihat PB1
- **Tindak**: mobile — `lib/core/uang.dart` jadi satu rumah, dua pemakainya
  memanggilnya, uji cermin 697 baris + penjaga salinan (7 uji, 3 bukti merah);
  server — `npm run acuan:uang-mobile` yang MELAHIRKAN fikstur itu, dan
  `uang-satu-rumah.test.ts` (6 uji, 3 bukti merah) yang menjaga sisi
  server/web plus asal-usul fiksturnya. Mobile: `mohteja/kakarut-mobile`
  commit `5fc0251`, PR #12

## Batas laju di luar email — server — 2026-08-22

- **Populasi**: **469 rute HTTP** dienumerasi mekanis dari `app.ts` + tiap
  modul; **12** berbatas laju (8 auth, 1 undangan, 1 sinkron, 2 tuduhan palsu
  dari nama variabel `batas…`). Sisanya 457
- **Metode**: `scratchpad/rute-mahal.py`, lalu tiap GET tanpa parameter jalur
  (100 jalur) DITEMBAK dan diukur
- **"Mahal" DIUKUR, bukan diduga**: 100 GET ditembak dua kali — terhadap seed
  (111 penjualan) dan terhadap 50.111 penjualan sepanjang setahun. Yang
  terlambat tetap 0,035 dtk.

  > ⚠️ **ANGKA ITU SALAH, dan diralat oleh vena "Indeks vs WHERE" di bawah.**
  > 50.111 baris suntikannya mendarat di PERUSAHAAN LAIN; token yang dipakai
  > mengukur milik perusahaan yang cuma punya 98 penjualan, jadi kuerinya tak
  > pernah melihat satu pun baris itu. Diukur ulang dengan tenant yang benar:
  > `GET /laporan` **0,212 dtk** pada 50 ribu dan **0,526 dtk** pada 500 ribu.
  > Temuan `POST /upload` di entri ini tetap berdiri — ia diukur lewat
  > penyimpanan, bukan lewat kueri tenant. Aturan ke-6 lahir dari sini.
- **Detektor**: DIBUKTIKAN — aturan sapuan `unggah-berbatas` di
  `penjaga-semua-pintu`, tiga suntikan (cabut dua ember, cabut satu ember,
  cabut batas ukuran) masing-masing di-assert mendarat; ketiganya tertuduh
- **Hasil**: **TEMUAN**, satu pintu: `POST /upload`. Terukur sebagai **kasir** —
  peran paling rendah yang punya token:

  | | sebelum | sesudah |
  |---|---|---|
  | 20 unggahan 5 MB berturut-turut | 100 MB dalam **0,81 dtk** | — |
  | laju | **123 MB/dtk ≈ 432 GB/jam** | berhenti di 300 MB / 15 mnt |
  | 80 percobaan | 20/20 diterima, **nol 429** | 60 diterima, **20 × 429** |

  Bentuknya sama dengan vena `z.number()`: batas per SATUAN sudah ada
  (`MAX_SIZE` 5 MB, dan `BATAS_UNGGAH` 8 MB di `app.ts`), batas LAJUNYA tidak.
  Tak ada kuota per perusahaan dan tak ada pembersihan berkas yatim, jadi
  lajunya satu-satunya pengendali yang tersedia
- **Ikut ketemu, TIDAK dikerjakan**: isi berkas tak pernah diperiksa — hanya
  `file.type` yang DIDEKLARASIKAN pengirim. 5 MB byte acak tersimpan sebagai
  `.png`, terbukti dengan `file(1)`. Bukan lubang eksekusi (berkasnya disajikan
  statis, bukan dijalankan), tapi berarti "hanya gambar" bukan pernyataan yang
  ditegakkan. Masuk antrean sebagai vena tersendiri
- **Kesalahanku**: aturan sapuannya mula-mula memakai pola yang sama dengan
  `email-berbatas` (`rateLimit\(|\bbatas[A-Z]\w*`). **Bukti merahnya gagal**:
  mencabut kedua ember dari `.post()` membiarkan definisinya utuh di berkas yang
  sama, dan sapuannya tetap hijau. Diganti ke bentuk PEMAKAIAN
  (`^\s{2,}batasUnggah\w*,$`). Itu pun masih hijau bila SATU ember tersisa,
  jadi ada uji terpisah yang menuntut keduanya
- **Batas**: sapuan latensi hanya menembak **GET tanpa parameter jalur** (100
  dari 469 rute). Rute ber-`:id` dan seluruh POST/PUT tak diukur — yang mahal di
  sana bisa saja ada, dan tak ada yang menyatakan sebaliknya. Enumerasi rutenya
  juga menghasilkan beberapa jalur artefak (`/xxxauth`) dari modul yang
  dipasang di dua prefix
- **Tindak**: dua ember di `upload/routes.ts` (60/15mnt per pengguna,
  300/15mnt per perusahaan) mengikuti bentuk `POST /karyawan/undang`; aturan
  `unggah-berbatas` di `penjaga-semua-pintu`; 4 uji di `rate-limit.test.ts`
  termasuk yang menuntut KEDUA ember terpasang; §236 verify-api (8 asersi,
  tiap penolakan berpasangan dengan yang sah)

## Isi berkas unggahan tak pernah diperiksa — server — 2026-08-22

- **Populasi**: **2** keputusan di seluruh `apps/server/src` yang bersandar pada
  tipe yang DIDEKLARASIKAN pengirim — keduanya di `upload/routes.ts`: memilih
  ekstensi berkas, dan menetapkan `ContentType` yang disimpan ke R2
- **Metode**: `scratchpad/tipe-diklaim.py` (`file.type`, header `content-type`,
  ekstensi dari nama berkas)
- **Detektor**: DIBUKTIKAN — empat suntikan, masing-masing di-assert mendarat:
  mencabut pemeriksaan tanda tangan, menambahkan `image/svg+xml` ke daftar
  terima, memindahkan `secureHeaders` ke sub-app `/api` saja, dan melonggarkan
  tanda tangan PNG. Keempatnya tertuduh
- **Hasil**: **TEMUAN — tapi bukan yang kukira, dan itu bagian pentingnya.**
  Terukur lewat HTTP: `<svg><script>alert(1)</script></svg>` dideklarasikan
  `image/png` → **201**, tersimpan `.png`, dilayani `Content-Type: image/png`.
  Lalu kuperiksa apakah ia benar-benar berbahaya, dan **tidak**:

  | penjagaan | terukur |
  |---|---|
  | `image/svg+xml` tak ada di daftar terima | SVG satu-satunya format gambar yang bisa memuat `<script>` |
  | `secureHeaders` dipasang `app.use("*")` | respons `/uploads/*` memulangkan `X-Content-Type-Options: nosniff` |

  Jadi tak ada skrip yang berjalan. Yang menahannya **dua penjagaan di HILIR**,
  dan **tak satu pun dijaga uji** sebelum vena ini. Yang pertama bahkan berupa
  KETIADAAN satu baris — dan ketiadaan tak meninggalkan jejak yang bisa dibaca
  orang berikutnya. Menambahkan satu entri SVG (perubahan yang kelihatan
  sepele dan mudah diminta) langsung menjadikannya XSS tersimpan
- **Yang benar-benar terbuka**: penyimpanannya menerima byte apa pun. Terukur:
  200 byte acak dan 5 MB byte acak sama-sama tersimpan sebagai `.png`, terbukti
  dengan `file(1)`. Bukan lubang eksekusi, tapi "hanya gambar" bukan pernyataan
  yang ditegakkan — dan bersama vena sebelumnya (unggahan tanpa batas laju) itu
  kanal menaruh data sembarang
- **Diperiksa & bersih**: tak ada satu pun tempat di server yang MEMBACA KEMBALI
  berkas unggahan (tak ada pengolah gambar, tak ada penyematan ke PDF sisi
  server), jadi tak ada pengurai yang bisa disodori berkas cacat
- **Batas**: yang diperiksa cuma beberapa byte pertama. Itu bukan pengurai
  gambar dan tak berpura-pura: berkas yang kepalanya benar tapi badannya rusak
  tetap lolos. Yang ditegakkan lebih sederhana — tipe yang DIKLAIM harus cocok
  dengan yang TERTULIS di byte-nya. Uji penjaganya juga menjalankan SALINAN
  aturannya, bukan kode rutenya; ada asersi terpisah yang menuntut salinan itu
  tak menyimpang
- **Tindak**: `cocokTandaTangan()` di `upload/routes.ts` (PNG/JPEG/WebP);
  gerbang `unggahan-hanya-gambar.test.ts` (6 uji) yang **juga menahan kedua
  penjagaan hilir** tetap di tempatnya; §237 verify-api (8 asersi, pasangan
  "gambar sah tetap diterima" ditembakkan LEBIH DULU)

## Kebijakan `ON DELETE` tiap FK — basis data — 2026-08-22

- **Populasi**: **166 foreign key**, dibaca dari **katalog Postgres sungguhan**
  (`pg_constraint`), bukan dari migrasi: **80 cascade · 18 set null · 68 NO
  ACTION**. `schema.ts` sepakat — 99 `onDelete` eksplisit (81 cascade + 18 set
  null), sisanya bawaan `NO ACTION`
- **Metode**: `scratchpad/on-delete.py` — katalog FK disilangkan dengan tabel
  yang benar-benar DIHAPUS kode
- **Detektor**: DIBUKTIKAN — tiga suntikan, masing-masing di-assert mendarat:
  menambahkan `DELETE branches`, mencabut pra-cek 409 kategori, dan mengubah
  `menus.category_id` jadi cascade. Ketiganya tertuduh
- **Hasil**: **BERSIH.** 68 FK NO ACTION bersandar pada **9** induk berbeda;
  `users` (28 anak) dan `branches` (26) yang terbanyak — dan **keduanya tak
  pernah dihapus kode sama sekali**. Satu-satunya induk NO ACTION yang dihapus
  `menu_categories`, dan penghapusannya dijaga pra-cek. Terukur lewat HTTP:

  | | terukur |
  |---|---|
  | `DELETE /kategori/:id` yang masih dipakai | **409 "Kategori masih dipakai 33 menu"** |
  | Kosongkan Tempat Sampah, penjualan sungguhan | **200**, induk hilang, `sale_items` & `sale_consumptions` ikut tersapu cascade |

  Kelas yang dulu membuat Tempat Sampah gagal dikosongkan tak lagi punya jalan
  masuk: `sales` dan `productions` — dua tabel yang dihapus permanen di sana —
  **nol** anak NO ACTION
- **Tiga kali detektorku salah, dan ketiganya kuukur bukan kuduga**:
  1. Sapuan pertama hanya melihat `.delete(tabel)` drizzle → **buta terhadap
     SQL mentah**, yaitu justru `sampah/routes.ts` — jalur yang dulu RUSAK
     karena kelas ini. Cakupan 27 → 35 tabel.
  2. Ia menuduh `DELETE /kategori/:id` yang JUSTRU BENAR, sebab pra-cek yang
     menolak dianggap bukan penjagaan. Ditambahkan sebagai cabang sah.
  3. Jendelanya ±4.000 aksara, dan itu **menyeberang ke handler tetangga**:
     mencabut pra-cek kategori tetap hijau karena 409 "nama sudah dipakai"
     milik `POST /kategori` ikut terhitung. Dipersempit ke handler-nya sendiri.
     Bukti merah baru mendarat sesudah perbaikan ketiga ini
- **Batas**: yang dijaga uji barunya STRUKTUR (`schema.ts` + situs `DELETE` di
  kode), bukan katalog basis data. Migrasi yang mengubah kebijakan FK tanpa
  menyentuh `schema.ts` tak terlihat — yang menjaga celah itu gerbang
  `drift schema vs migrasi` yang sudah ada. Kebijakan `SET NULL` (18) tak
  diperiksa sama sekali di sini: akibatnya bukan kebuntuan melainkan medan yang
  diam-diam jadi null, dan itu vena yang berbeda
- **Tindak**: tak ada perubahan kode — vena bersih. Gerbang
  `hapus-induk-tak-buntu.test.ts` (5 uji) menahan keadaannya: `users`/`branches`
  tetap tak pernah dihapus, tiap induk NO ACTION yang dihapus wajib punya jalan
  keluar tertulis, dan pra-cek kategori tetap menghitung menunya. Sisi
  perilakunya sudah dijaga verify-api yang ada — §65 (409) dan §91
  (kosongkan sampah; 500 akibat FK akan menjatuhkan `ok:true`-nya)

## Kebijakan `SET NULL`: fakta yang disimpan sebagai penunjuk — basis data — 2026-08-22

- **Populasi**: **18 FK `ON DELETE SET NULL`** dari katalog Postgres, bersandar
  pada **9 induk**. Disilangkan dengan induk yang BENAR-BENAR dihapus kode:
  hanya **4** yang hidup — `meja`, `sales`, `customers`, `cleaning_areas`.
  `users` (7 anak SET NULL), `storage_locations`, `branches`, `shifts`,
  `companies` tak pernah dihapus
- **Detektor**: DIBUKTIKAN — empat suntikan, masing-masing di-assert mendarat:
  alasan 409 dikembalikan bersandar `saleId` saja, filter pesanan
  dikembalikan, penandaan di `createSale` dicabut, dan isi-ulang migrasi
  dihapus. Keempatnya tertuduh
- **Hasil**: **TEMUAN.** `open_bills.sale_id` dipakai bukan sebagai PENUNJUK
  melainkan sebagai **BUKTI PERISTIWA** — "bill ini sudah jadi penjualan".
  FK-nya `SET NULL`, jadi begitu penjualannya dihapus permanen, Postgres
  menghapus penunjuknya dan **faktanya ikut hilang**. Pemicunya tindakan
  pemilik yang biasa saja: mengosongkan Tempat Sampah.

  Terukur ujung ke ujung lewat HTTP:

  | | sebelum | sesudah |
  |---|---|---|
  | `sale_id` sesudah sampah dikosongkan | **NULL** (`closed_at` tetap terisi) | NULL, tapi `pernah_jadi_penjualan` = true |
  | bill di `GET /pesanan` | **muncul lagi sebagai pesanan aktif** | tidak muncul |
  | bayar ulang | **`bill_dibatalkan`** | `bill_sudah_dibayar` |

  Yang kedua bukan salah kata, dan kodenya sendiri yang menuliskan bedanya:
  `bill_sudah_dibayar` = kiriman kembar, aman dibuang dari antrean;
  `bill_dibatalkan` = "membuang perintahnya berarti kehilangan satu transaksi
  sungguhan". Jadi klien offline **menahan perintah yang tak akan pernah
  berhasil**
- **Bentuknya, dan kenapa ia layak jadi kelas tersendiri**: sebuah medan boleh
  jadi null **tanpa satu baris kode pun memintanya**. Semua penjaga yang
  dipasang di jalur tulis — validasi, transaksi, kunci baris — tak menyentuh
  jalur ini sama sekali; yang menulis basis datanya sendiri
- **Batas**: gerbangnya menjaga dua pemakai yang SUDAH diketahui, bukan menyapu
  seluruh kode mencari FK-nullable yang dibaca sebagai bukti — sapuan begitu
  butuh tahu FK mana yang `SET NULL`, dan itu ada di katalog, bukan di kode.
  Yang bisa dijaga statis: **jumlah 18** tak bertambah tanpa ditinjau. Tiga
  induk hidup lainnya (`meja`, `customers`, `cleaning_areas`) diperiksa tangan
  dan medannya memang dipakai sebagai tautan, bukan bukti — `sales.customer_id`
  bahkan sudah punya kalimat konfirmasinya sendiri di web ("Transaksi lamanya
  tetap tersimpan (tanpa link member)")
- **Tindak**: kolom `open_bills.pernah_jadi_penjualan` (migrasi `0101`
  **beserta isi ulang baris lama** — tanpa itu deploy-nya sendiri yang memicu
  cacatnya); `createSale` menandainya saat menutup bill; alasan 409 dan filter
  `GET /pesanan` diturunkan dari faktanya (dengan `saleId` dipertahankan
  sebagai jaring pengaman); gerbang `fakta-bukan-penunjuk.test.ts` (8 uji);
  §238 verify-api (7 asersi, termasuk pasangan "bill yang DIBATALKAN tetap
  terbaca dibatalkan"); entri CHANGELOG untuk mobile

## CHECK yang hilang — basis data — 2026-08-22

- **Populasi**: **8 `CHECK`** untuk **59 tabel** (katalog Postgres). 32 kolom
  numeric pada tabel yang tumbuh, **tak satu pun** ber-CHECK. Sisi kode: 34
  `z.enum`, dan **27 enum Postgres asli** — jadi status memang sudah ditegakkan
  basis data; hanya 2 kolom `status` bertipe `text`, keduanya ditulis server
  sendiri
- **Detektor**: DIBUKTIKAN — empat suntikan ke DATA sungguhan (identitas uang
  digeser Rp 500, `qty_refund` dinaikkan melebihi `qty`, mutasi `pakai`
  dibalik tandanya, bill ber-`sale_id` dicabut tandanya); keempatnya tertuduh
  dan skripnya keluar dengan status 1. Ditambah tiga suntikan ke gerbang
  pemasangannya
- **Hasil**: **BERSIH pada datanya, dengan satu artefak baru.** Tiap invarian
  yang diandaikan kode kuprobe lewat rute sungguhan:

  | probe | hasil |
  |---|---|
  | refund 5 porsi dari 2 yang terjual | **400** "hanya bisa dikembalikan 2 porsi lagi" |
  | **dua refund penuh SERENTAK** | **200 + 400**, `qty_refund = 2 = qty` — kunci `FOR UPDATE` pada baris `sales` menahan yang kedua |
  | `diskon_nilai` 99.999.999 atas subtotal 1.000 | tersimpan `diskon = 0`, `total = 1.000` |
  | penulis `qty_refund`/`refund_total` | **satu pintu saja** (`refund.ts`), dan terkunci |

- **KESALAHANKU, dan ia yang paling perlu ditulis**: invarian pertamaku
  `supply_mutations.qty >= 0` menuduh **58 baris**. Kuperiksa dulu sebelum
  melaporkannya, dan ternyata **TANDA-nya yang membawa arah** — `masuk`/`terima`
  positif, `pakai`/`auto`/`kirim` negatif. Datanya benar; invariannya yang
  salah. Kalau kupercaya angka 58 itu, vena ini akan melahirkan "temuan" yang
  justru merusak semantik yang benar. Yang masuk audit akhirnya kecocokan tanda
  dengan `tipe` — dan ia lolos 0 pelanggaran
- **Artefak**: `npm run audit:invarian` — **26 invarian** dijalankan sebagai
  kueri terhadap datanya, dan CI menjalankannya **SESUDAH `verify-api.sh`**.
  Urutan itu seluruh nilainya: pada basis data yang baru di-seed audit ini
  hijau tanpa menyatakan apa pun. Terukur sesudah 2.785 asersi melewatinya
  (112 penjualan, 138 baris, 122 mutasi, 236 produksi): **26 sehat, 0
  dilanggar**
- **Kenapa bukan `CHECK` saja**: sebagian memang bisa (`qty > 0`), dan yang
  begitu sebaiknya begitu. Tapi yang paling berharga justru yang tak bisa —
  identitas `total = subtotal − diskon + pb1` menyilang empat kolom, dan
  kecocokan tanda bergantung pada enum di kolom lain. `CHECK` menolak baris
  saat DITULIS; audit ini menjawab pertanyaan yang berbeda: "sesudah semua rute
  dijalankan, adakah yang tersisa salah?"
- **Ikut diperbaiki**: penjaga `jangkar-iris` tak bisa menelusuri jangkar yang
  menunjuk `ci.yml` — `replace(/^[./]+/, "")` ikut memakan titik milik
  `.github`. Padahal `.yml` dimasukkan ke daftar ekstensinya JUSTRU supaya bisa.
  Ketahuan karena uji baru ini yang pertama memakai `indexOf` atasnya
- **Batas**: audit ini memeriksa apa yang tersisa di data, **bukan** apakah
  suatu jalur bisa menulis pelanggaran lalu memperbaikinya sendiri. Ia juga
  hanya melihat 26 invarian yang ditulis tangan — bukan seluruh invarian yang
  diandaikan kode
- **Tindak**: `scripts/audit-invarian.ts` + npm script + langkah CI sesudah
  verify-api; gerbang `audit-invarian-terpasang.test.ts` (6 uji) yang menahan
  urutan langkah CI dan jumlah invariannya; perbaikan resolver `jangkar-iris`

## Fitur lama pengerjaan pesanan (belum diurai mobile) — mobile — 2026-08-22

- **Populasi**: **8 medan kontrak** yang menyangkut fitur ini di
  `packages/shared/src/types.ts` (`durasi_detik` di tiga tipe, `masuk_pada`,
  `status_oleh`, `status_pada`, `pesanan_durasi_detik`, `target_durasi_detik`,
  `target_detik`, `lewat_target`, `bertarget`), plus satu rute laporan
  (`/laporan/durasi-pesanan`) dan satu pembantu (`durasiPesananDetik`)
- **Sapuan**: tiap kunci JSON dicari di `lib/` — hasilnya berangka:

  | kunci | dibaca Dart |
  |---|---|
  | `status_oleh`, `status_pada` | **2** masing-masing |
  | `durasi_detik` | **0** |
  | `masuk_pada` | **0** |
  | `pesanan_durasi_detik` | **0** |
  | `target_durasi_detik`, `target_detik`, `lewat_target`, `bertarget` | **0** |
  | rute `/laporan/durasi-pesanan` | tak pernah dipanggil |

- **Terukur, bukan dibaca**: satu bill dibuat lewat HTTP sungguhan, satu sajian
  ditandai selesai dua detik kemudian. `GET /pesanan` membalas
  `{"durasi_detik": 2, "status_oleh": "Kasir Cabang 2", "status_pada":
  "2026-08-22T14:54:46.065Z", "items":[{"durasi_detik": 2, …}]}` — ponsel
  membaca dua yang terakhir dan **membuang `durasi_detik`** pada kartu maupun
  barisnya
- **Bentuk diamnya**: `fromJson` yang melewatkan satu kunci tak melempar apa
  pun, dan `flutter analyze` tetap hijau karena parameternya opsional
- **KESALAHANKU, DI VENA YANG SEDANG MEMBURU KESALAHAN ITU**: saat menulis
  perbaikannya, `PesananKartu.fromJson` **sempat tidak ikut diperbaiki** —
  `analyze` hijau, dan yang menangkapnya asersi kartu di uji baru. Bukti
  merahnya menyuntikkan kembali persis keadaan itu
- **Yang TIDAK disalin, dan alasannya**: durasi tidak dihitung ulang di ponsel
  walau `masuk_pada` dan `status_pada` dua-duanya sudah ada. Aturannya (jepit di
  nol, abaikan baris batal, abaikan yang tak berwaktu) tinggal di
  `durasiPesananDetik` milik `@kakarut/shared`; salinan Dart-nya akan jadi rumus
  kedua yang bisa menyimpang diam-diam — kelas yang sudah sekali menggigit repo
  ini pada PB1. `formatDurasi` memang disalin: ia murni tampilan, jadi
  menyimpangnya berarti kata yang beda di layar, bukan angka yang beda di
  pembukuan. Kedelapan batasnya dipatok uji
- **PINTU SAUDARA yang ikut ketemu, dan diperbaiki di commit terpisah**:
  `ringkasPesanan` memilih "terakhir disentuh" dengan `String.compareTo` atas
  `status_pada` — kelas yang sama dengan vena sebelumnya, tapi di sini kedua
  sumbernya **bercampur**: stempel server selalu berpecahan 3 digit
  (`toISOString()` JavaScript), stempel optimistis ponsel 3 **atau** 6.
  Dua sentuhan dalam milidetik yang sama diurutkan terbalik, dan kartu
  menampilkan nama orang **sebelumnya**. `bandingStempel` dipindah ke
  `lib/core/waktu_stempel.dart` supaya kedua pintu memakai satu rumah
- **Batas / tersisa, dicatat bukan didiamkan**: `target_durasi_detik` per menu
  (badge "lewat target") dan laporan `/laporan/durasi-pesanan` belum ada di
  ponsel. Keduanya **layar baru**, bukan medan yang tak terurai — beda kelas
  dari vena ini, dan lebih jujur diusulkan sebagai pekerjaan tersendiri
- **Tindak**: `durasi_detik` + `masuk_pada` diurai di baris & kartu, ditampilkan
  cermin papan web (baris selesai "⏱ 2 dtk", baris jalan "masuk 21.54", kartu
  "⏱ Rampung dalam …"), `formatDurasi` di `core/format.dart`, uji
  `test/lama_pengerjaan_test.dart` (7 uji) + `test/urutan_antrean_test.dart`
  bertambah uji pintu saudara. Mobile: commit `ccd433e` & `42820f4`, PR #12

---

## Urutan pemutaran ulang antrean offline — mobile — 2026-08-22

- **Populasi**: **14 tipe perintah** yang boleh diantre (`SyncBody.tipe`
  `z.enum`), **satu** jalur penyetempelan (`SyncQueue.tambah` → `waktuServer()
  .toUtc().toIso8601String()`), **dua** tempat pengurutan di
  `pangkasAntrean` (urutan kirim + pemangkasan item gagal)
- **Kenapa urutan itu penting, DIUKUR bukan diasumsikan**: server memproses satu
  batch `/sync` berurutan (`for (const cmd of commands)`). Satu batch dua
  perintah, kasir baru yang belum absen:

  | urutan batch | `shift_buka` | `absen_saya` |
  |---|---|---|
  | `[shift_buka, absen_saya]` | **400** "Absen masuk dulu sebelum buka kasir" | 201 |
  | `[absen_saya, shift_buka]` | **201** | 201 |

- **Hasil**: **TEMUAN.** Urutannya dibandingkan sebagai **TEKS**
  (`a.waktu.compareTo(b.waktu)`), padahal `DateTime.toIso8601String()` menulis
  **tiga** digit pecahan bila mikrodetiknya nol dan **enam** bila tidak:

      2026-08-22T05:26:23.239Z        ← mikrodetik 0
      2026-08-22T05:26:23.239001Z     ← satu mikrodetik SESUDAHNYA

  `'0'` (48) < `'Z'` (90), jadi yang **belakangan dinyatakan lebih dulu**.
  Diukur langsung: dari 12 pasangan stempel yang diuji, **4** urutannya berbeda
  antara `compareTo` teks dan `compareTo` waktu
- **Yang membuatnya lebih dari sekadar sepele**: pemutus seri `prioritas()` —
  yang mendahulukan `absen_saya` di atas `shift_buka` — hanya berjalan saat
  kedua teksnya **sama persis**. Dengan panjang pecahan yang berbeda, teksnya
  tak pernah sama, jadi **pemutus seri yang ditulis khusus untuk kasus "waktunya
  seri" tidak pernah jalan di kasus itu**. Komentarnya sendiri sudah menyebut
  bahayanya (*"urutan dalam satu batch menentukan hasilnya"*) — yang meleset
  alat ukurnya, bukan pemikirannya
- **Akibatnya di lapangan**: kasir yang absen masuk lalu membuka laci saat
  offline bisa mendapati lacinya **tetap tertutup** sesudah jaringan pulih —
  tanpa satu pun galat yang menunjuk sebabnya, karena absennya sendiri berhasil
- **Detektor**: DIBUKTIKAN bisa menuduh dua kali, tiap suntikan di-assert
  mendarat — sort utama dikembalikan ke `compareTo` teks → uji INTI merah dengan
  urutan **terbalik persis**; sort pemangkasan dikembalikan → uji pasangannya
  merah
- **Sisi TypeScript diperiksa, bukan diduga**: JS `toISOString()` **selalu**
  menulis 3 digit pecahan (dijalankan, bukan diingat), dan keempat situs
  `localeCompare` atas `waktu` di server/web mengurutkan string yang **server
  sendiri** serialisasi dari kolom `timestamp`. Pembalikan itu mustahil di sana
- **Batas detektor**: yang diperiksa urutan yang DIHASILKAN `pangkasAntrean`.
  Urutan di dalam satu tipe perintah yang bergantung satu sama lain (mis. dua
  penjualan atas bill yang sama) tak diuji — server memakai `client_ref` untuk
  idempotensi, bukan urutan, jadi kelas itu tak punya bentuk kegagalan yang sama
- **Tindak**: `bandingStempel()` mengurai kedua stempel jadi `DateTime` lebih
  dulu, dengan jatuh-balik ke perbandingan teks untuk stempel yang tak bisa
  diurai (antrean versi lama) — mempertahankan urutan yang ada lebih baik
  daripada melemparkannya ke ujung daftar. Dipakai di KEDUA tempat pengurutan.
  Gerbang `test/urutan_antrean_test.dart` (7 uji), termasuk uji PREMIS yang
  memastikan kedua stempel contohnya memang berbeda panjang pecahan — kalau
  Dart suatu hari menyeragamkannya, diamnya ketahuan di situ, bukan di produksi.
  Mobile: `mohteja/kakarut-mobile` commit `061c473`, PR #12

---

## Enum status dibandingkan sebagai teks — mobile — 2026-08-22

- **Populasi**: **122** berkas Dart, **156** perbandingan teks ke medan yang
  namanya menyebut enum (`status|tipe|role|jenis|metode|kategori|sesi|sebab|
  divisi|pengadaan|peran`), **41** nilai berbeda — diadu dengan **297 baris
  kontrak server** dari TIGA sumber: 27 `pgEnum` (92 baris), `z.enum` +
  `kode`/`sebab` di rute (64 + 17), dan union literal bernama di
  `packages/shared` (124)
- **Detektor**: DIBUKTIKAN bisa menuduh tiga kali, tiap suntikan di-assert
  mendarat — (1) `r.status == 'dikonfirmasi'` → `'dikonfirmasii'` di
  `pengadaan_page.dart` → tertuduh di baris yang tepat; (2) fikstur dikosongkan
  → uji PREMIS merah, bukan INTI hijau dengan populasi nol; (3) pengupas
  komentar pembangkitnya dilumpuhkan → merah
- **EMPAT KALI DETEKTORKU SALAH**, dan tiap kali ia menuduh kode yang benar:
  1. semestanya cuma `pgEnum` (78 nilai) → **12 tuduhan palsu**. `"persen"`/
     `"nominal"` (tipe diskon), `"open_bill"` (jenis pesanan), `"gagal"`
     (status antrean) memang tak pernah jadi enum Postgres. Diperlebar ke
     seluruh kontrak: 173 nilai
  2. `sebab:` tak ikut dipungut → menuduh `'sedang_diproses'`, yang justru
     dipakai benar di dua tempat dengan komentar yang menjelaskannya
  3. komentar di dalam badan `pgEnum` ikut terbaca: `paritas tahap "diproses"`
     masuk sebagai nilai enum KELIMA yang tak pernah ada di Postgres mana pun
  4. arah B versi pertama mencocokkan nilai LINTAS KONTEKS → `'beli'`,
     `'opname'`, `'produksi'` di peta label kartu stok dikira `dokumen_jenis`
- **ASERSI HAMPA YANG KURALAT SENDIRI**: uji "komentar tak ikut jadi nilai enum"
  versi pertama menghitung nilai `supply_beli_status` — dan tetap **HIJAU** saat
  pengupasnya dicabut, karena nilai yang dikutip komentarnya (`"diproses"`)
  kebetulan juga nilai yang sah, jadi `Set` melipatnya. Diukur: keluaran
  dengan dan tanpa pengupas **identik, 0 beda**. Asersinya tak bisa gagal.
  Diganti uji sifat langsung atas masukan yang memang memancingnya (komentar
  yang mengutip nilai yang TIDAK ada di lariknya), lalu bukti merahnya diulang
  dan kali ini mendarat
- **Hasil**: **BERSIH, dua arah.**
  - **Arah A** (literal Dart di luar kontrak): **2** dari 41 — `'bt'` dan
    `'lepas'`, keduanya jenis transport printer yang tak pernah menyeberang ke
    server
  - **Arah B** (nilai kontrak yang tak ditangani Dart): dari **34** union
    literal bernama di `packages/shared`, **3** tak lengkap — dan ketiganya
    benar secara struktural:
    · `MetodeHpp` — dipakai sebagai boolean biner (`== 'average'`), jadi
      `fifo` tertangani oleh konstruksi;
    · `InvitationStatus` — hanya `pending` yang dikirim ke layar onboarding;
    · `SebabPenjualanGagal` — **DAFTAR PUTIH yang disengaja**. `sync_queue.dart`
      hanya menyebut `bill_sudah_dibayar` sebagai "sudah tercatat"; komentarnya
      menuliskan alasannya: *"sebab baru dari server otomatis diperlakukan
      sebagai gagal dan terlihat kasir, bukan diam-diam dibuang"*. Menuntut
      keempat nilainya disebut justru akan mengubah daftar putih jadi daftar
      hitam — dan itu kebalikan dari yang aman
- **Yang sudah dijaga sebelum vena ini**: `offline_queue_test.dart` sudah
  memuat perilaku daftar putih itu (`bill_dibatalkan` → tidak selesai; sebab
  tak dikenal → tidak selesai). Tak ada uji baru yang ditambahkan di situ —
  menambah salinan uji yang sudah ada bukan penjagaan, cuma angka
- **Batas detektor**: hanya melihat perbandingan `==`/`!=`/`case` ke medan yang
  NAMANYA menyebut enum. Status yang mengalir lewat variabel bernama netral
  (`v`, `x`) tak terlihat. Nilai yang dipakai sebagai kunci peta atau argumen
  fungsi juga di luar sapuan
- **Tindak**: tak ada perubahan kode — tak ada yang salah. Artefaknya TAUTAN
  MEKANIS yang selama ini tak ada: `npm run acuan:status-mobile` melahirkan
  `test/fikstur/status-kontrak-server.txt` (297 baris) di repo mobile,
  `status_cermin_server_test.dart` (5 uji) mengadu tiap literal status dengan
  fikstur itu, dan `status-satu-kontrak.test.ts` (5 uji) menjaga pembangkitnya
  supaya fikstur tak menyusut diam-diam. Mesin yang sama dengan vena uang —
  fikstur DIHASILKAN, bukan diketik ulang

---

## Invalidasi sesudah mutasi — web — 2026-08-22

- **Sudah ada penjaganya, dan batasnya ditulis sendiri.** `invalidate-kunci.test.ts`
  menjaga arah SEBALIKNYA — tiap kunci yang di-invalidate benar-benar dipakai
  suatu query (tak ada baris mati). Komentarnya: *"Ini TIDAK menjamin cakupannya
  lengkap"*. Vena ini menggarap batas itu
- **Populasi**: **124** `useMutation` di `apps/web` (64 berkas), **110** yang
  penulisannya terurai; **185** panggilan `invalidateQueries`; **89** kunci
  query berbeda
- **EMPAT KALI DETEKTORKU SALAH, dan tiap kali ia menuduh kode yang benar.**
  Dicatat satu per satu karena polanya sendiri yang berharga — setiap kesalahan
  berbentuk "menebak dari BENTUK alih-alih menelusuri":
  1. tak mengikuti pembantu lokal → menuduh `ShiftPage` (`invalidate()`) dan
     `PesananPage` (`onSettled: segarkan`). 20 → 11
  2. hanya mengenali badan panah BERKURUNG → melewatkan
     `const segarkan = () => queryClient.invalidateQueries(…)`, menuduh tiga
     mutasi `AreaKebersihanModal`. 11 → 8
  3. `re.search` memungut definisi PERTAMA di berkas → `OpnameRiwayatPage`
     punya DUA komponen yang sama-sama punya pembantu bernama `invalidate`,
     satu untuk bahan satu untuk perlengkapan; keduanya tertuduh, keduanya
     benar. Diganti "definisi terdekat SEBELUM mutasinya"
  4. tak mengikuti panggilan balik lewat PROP (`onSukses()` di anak,
     `onSukses={segarkan}` di induk) → menuduh `StokPerlengkapanTab`, yang
     penyegarannya justru paling lengkap di repo ini. Sesudahnya: **nol** mutasi
     tanpa penyegaran sama sekali
- **Aturan pertama juga salah, dan itu keputusan bukan bug**: "segarkan SEMUA
  pembaca sumber daya ini" menuduh **70** mutasi, hampir semuanya benar —
  mengganti nama meja memang tak perlu menyegarkan riwayat pengosongan meja.
  Dipersempit ke yang tak ambigu: **berkas yang SAMA membaca apa yang baru saja
  ditulisnya**. 70 → 19
- **Detektor**: DIBUKTIKAN bisa menuduh — invalidasi `["meja"]` dicabut dari
  `MejaPage.toggle` (di-assert mendarat) → tertuduh di baris yang tepat, 11 → 12;
  dikembalikan → hilang. Untuk gerbangnya: bug aslinya disuntikkan kembali →
  INTI merah menyebut `AnalisisHargaPage`; pengecualian karangan ditambahkan →
  uji "pengecualian basi" merah
- **Hasil**: **TEMUAN — satu, lewat arah ketiga yang tak terpikir di awal.**
  Sapuan "cakupan" hanya melahirkan kandidat yang semuanya sah. Yang menemukan
  bugnya justru sapuan **ILUSI AWALAN**: pencocokan TanStack membandingkan
  elemen secara UTUH, jadi `["A"]` TIDAK pernah mengenai `["A-…"]`. Ada **31
  pasangan** kunci yang tampak induk-anak padahal bukan (`stok`/`stok-fifo`,
  `perlengkapan`/`perlengkapan-master`, `menu`/`menu-riwayat-harga`, …), dan
  **5 berkas** meng-invalidate `A` sambil membaca `A-…`
- **Yang bugnya**: `AnalisisHargaPage` — tombol **"Terapkan saran"**
  MENERBITKAN baris riwayat harga (`catatHargaMenu(…, sebab:
  "terapkan_saran")`), panel yang menampilkannya ada di halaman yang sama dan
  sedang terbuka tepat di bawah baris yang ditekan, dan invalidasinya menyebut
  `["menu"]` + `["menu-analisis-harga"]` — tak satu pun mengenai
  `["menu-riwayat-harga", id]`.

  | | sebelum | sesudah |
  |---|---|---|
  | riwayat harga di server | 3 baris | **4 baris** (`harga_lama 34.000 → harga_baru 300.000`, `sebab: terapkan_saran`) |
  | yang tampil di panelnya | 3 baris | **3 baris** — tak berubah |

  Berkas itu bahkan sudah punya labelnya: `SEBAB_LABEL.terapkan_saran =
  "terapkan harga saran"`. **Ia tahu tombol ini menerbitkan baris riwayat, dan
  tetap tak menyegarkan daftar yang menampilkannya**
- **Bentuknya, lagi**: aturan ini sudah ditulis repo ini **DUA KALI**,
  panjang-panjang — di `StokPerlengkapanTab` dan `OpnameRiwayatPage`, untuk
  `perlengkapan` vs `perlengkapan-master`, lengkap dengan alasan mengapa
  `staleTime` 5 menit membuatnya lebih parah. Pintu ketiganya tetap terbuka.
  Catatan bukan penjaga
- **Empat sisa yang TIDAK diperbaiki, berikut alasannya** (masuk `DIKECUALIKAN`
  di gerbangnya): `DetailBahanPage` ×2 — `onSuccess` memanggil `navigate()`,
  halamannya lepas sebelum kuerinya dibaca lagi; `KaryawanPage` —
  `karyawan-aktivitas` itu JEJAK AUDIT, bukan turunan datanya; `ErrorLogPage` —
  modal dimuat saat dibuka. Gerbangnya menolak pengecualian yang basi
- **Batas detektor**: hanya melihat `queryKey`/`invalidateQueries` yang elemen
  pertamanya LITERAL; kunci yang dirakit dari variabel tak terbaca (penjaga
  tetangganya sudah mencatat enam di antaranya). Penelusuran pembantu berhenti
  di dua lapis dan di dalam satu berkas — invalidasi yang dilakukan komponen
  induk di BERKAS LAIN tak terlihat
- **Mobile: kelas bug ini MUSTAHIL di sana, dan itu diperiksa bukan diduga.**
  241 `ref.invalidate(...)` di `lib/`, **nol** yang berbasis string — Riverpod
  membatalkan lewat OBJEK provider, jadi tak ada awalan untuk salah dikira
  induk. Tak ada perubahan mobile untuk vena ini
- **Tindak**: satu baris di `AnalisisHargaPage` + gerbang
  `apps/server/test/invalidasi-ilusi-awalan.test.ts` (5 uji) yang mengkodekan
  aturan yang sudah dua kali ditulis itu — termasuk uji PREMIS yang menjalankan
  aturan pencocokan TanStack-nya sendiri, supaya klaimnya diuji bukan dipercaya

---

## Uang dihitung ulang di klien — web + mobile — 2026-08-22

- **Bukan pengulangan** vena "Uang ditulis di luar pembantu bersama": entri itu
  menyapu DUA rumus (`PB1`, `TOTAL = subtotal − diskon`) dan batasnya sendiri
  menuliskan sisanya. Yang disapu di sini SELURUH rupiah yang lahir di layar
- **Populasi, TIGA cara hitung** (satu cara saja pasti buta):

  | arah | apa yang dihitung | web | mobile |
  |---|---|---|---|
  | A | `formatRupiah(<ekspresi>)` — dihitung di dalam kurung render | **13** | **5** |
  | B | `formatRupiah(x)` yang `x`-nya `const` ber-aritmetika di berkas yang sama | **20** | — |
  | C | `Rp {…}` tanpa `formatRupiah` | **1** (dari 4) | — |
  | | **jumlah rupiah yang lahir di layar** | **34** | **5** |
  | | `formatRupiah` seluruhnya (pembagi) | **203** | **165** |

  Jadi **169 dari 203** render web adalah medan server apa adanya. Arah B wajib
  ada: `kembalian` (`KasirPage:597`) tak terlihat oleh arah A sama sekali
- **Detektor**: DIBUKTIKAN bisa menuduh, tiga kali, tiap suntikan di-assert
  mendarat lebih dulu — (1) `formatRupiah(totalAlpa * 25000 - 500)` → tertuduh
  di baris yang TEPAT; (2) bentuk arah B (`const dendaPalsu = …` lalu
  `formatRupiah(dendaPalsu)`) → tertuduh; (3) nama fungsi yang disapu dibuat
  tak ada → uji PREMIS-nya merah, bukan INTI-nya hijau dengan hitungan nol.
  Di mobile: satu `formatRupiah` berhitung disisipkan → 5 → 6, tertuduh
- **KESALAHAN DETEKTORKU, ditemukan oleh bukti merahnya sendiri**: arah B versi
  pertama memakai DAFTAR NAMA (`total|diskon|harga|pb1|…`) dan **melewatkan
  `upahPalsu`** — suntikan yang dibuat justru untuk mengujinya. Daftar nama
  adalah detektor yang selalu tertinggal satu kata, dan ia sudah menuduh empat
  pemanggilan yang benar pada vena sebelumnya. Diganti jadi bebas nama: apa pun
  yang dirender `formatRupiah` ADALAH rupiah menurut kodenya sendiri; tinggal
  ditanya apakah `x` datang dari server atau lahir di sini
- **Kesalahan kedua**: penghapus komentar versi pertama MEMENDEKKAN teksnya,
  jadi nomor barisnya meleset — dilaporkan `ResepPage:1012` untuk baris yang
  sebenarnya **1110**. Penghapusnya diganti yang mempertahankan posisi (komentar
  jadi spasi, `\n` dijaga), dan ada uji yang menjaga sifat itu
- **Hasil**: **BERSIH — dan diukur, bukan dibaca.** Rantai uang layar kasir
  (subtotal → diskon → batas diskon kasir → PB1 → total) disalin apa adanya dari
  `KasirPage.tsx:566–593` lalu DIADU dengan yang benar-benar dicatat server
  lewat `POST /penjualan` sungguhan, pada perusahaan ber-PB1 **11,13%** dan
  batas diskon kasir **10%**:

  | kasus | total klien | total server |
  |---|---|---|
  | polos 1 baris | 12.224 | 12.224 |
  | polos 3 baris ganjil | 128.911 | 128.911 |
  | diskon 7% (di bawah batas) | 35.139 | 35.139 |
  | diskon 10% (PAS di batas) | 34.006 | 34.006 |
  | diskon 25% (DI ATAS batas) | 34.006 | 34.006 |
  | diskon 7,5% | 114.103 | 114.103 |
  | nominal Rp 1.000 | 74.457 | 74.457 |
  | nominal Rp 50.000 (di atas batas) | 68.012 | 68.012 |
  | diskon 100% | 11.002 | 11.002 |
  | qty 7 | 113.186 | 113.186 |

  **10 kasus, 0 selisih** — subtotal, diskon, PB1, dan total keempatnya sama
  persis. Yang membuatnya begitu: layar kasir memanggil `hitungPb1` dari
  `@kakarut/shared` alih-alih menulis ulang rumusnya, dan komentarnya sendiri
  menuliskan alasannya
- **Yang HAMPIR kutuduh, dan kenapa tidak** (pagar ke-3):
  - `ResepPage:1110` `hargaBatch / isiBatch` menulis ulang `hargaPerUnit`, dan
    penjaganya justru **terbalik** — `isiBatch = isi > 0 ? isi : 0`, yaitu nol,
    persis nilai yang meledakkan pembagiannya. Tapi rendernya dikurung
    `{isiBatch > 0 && …}`. **Tak terjangkau.**
  - `RiwayatHargaModal:295` `angkaDari(hargaBaru) / isi` — `isi` sudah dinormalkan
    ke **1** di baris 41. Aman.
  - `FakturFormPage:396` `(qtyPcs / b.isi) * b.harga_beli` — `isi` bertipe
    `z.number().positive()` di SETIAP jalur tulis; nol tak bisa masuk basis data
  - `BeliPerlengkapanPage:454` `r.qty * r.harga_beli` — perlengkapan **tak punya
    `isi`**; `harga_beli` memang per satuan. Bukan `hargaPerUnit` yang disalin
  - `LaporanPage:194` `lap.omzet + lap.total_refund` — rumusnya tertulis di
    komentar DTO servernya sendiri: *"omzet kotornya = `omzet + total_refund`"*
- **`kembalian` punya EMPAT salinan** (`receipt.ts:150`, `ReceiptModal:356`,
  `KasirPage:597`, `bayar_sheet.dart:481`) dan tak punya rumah. Ketiganya
  `Math.max(0, diterima − total)`, yang keempat `diterima − total` tanpa jepitan
  tapi dikurung di titik render. **Diperiksa satu per satu: keempatnya sepakat
  untuk semua masukan.** Dicatat sebagai duplikasi TANPA penyimpangan — bukan
  temuan, karena tak ada angka yang salah. "Sepertinya berisiko" bukan temuan
- **Batas detektor**: hanya melihat yang dirender lewat `formatRupiah` (atau
  literal `Rp {…}`). Rupiah yang dihitung lalu DIKIRIM ke server tanpa pernah
  tampil di layar tak terlihat — satu-satunya yang begitu, `total_harga` di
  `StokPerlengkapanTab:452`, diperiksa tangan (`qty × harga_beli`, dan
  perlengkapan tak punya `isi`). Arah B hanya menelusuri SATU lapis `const` di
  berkas yang sama; rantai dua lapis lintas berkas tak terlihat
- **Tindak**: tak ada perubahan kode — tak ada yang salah. Artefaknya dua ratchet
  kembar: `apps/server/test/uang-dihitung-klien.test.ts` (DASAR **34**, 5 uji) dan
  `kakarut-mobile/test/uang_dihitung_layar_test.dart` (dasar **5**, 5 uji).
  **Dipasang di KEDUA repo dengan sengaja**: memasangnya hanya di web akan jadi
  contoh berikutnya dari pola yang diburu peta ini — penjaga di satu pintu,
  pintu saudaranya dibiarkan terbuka — dan permukaan ponsel itulah yang sudah
  sekali menggigit (Rp 282 vs Rp 283)
- **Ikut diperbaiki**: `jangkar-iris` merah oleh berkas uji baru ini — ia memakai
  `.indexOf("…")` tapi literal direktorinya tak berakhir "/" sehingga tak bisa
  ditelusuri. Diberi garis miring, bukan dikecualikan: gerbang yang menyapu
  dirinya sendiri ke bawah karpet berhenti menyatakan apa pun

---

## Kunci React Query & cabang di URL — web + mobile — 2026-08-22

- **Populasi**: **166** `useQuery`/`useQueries`/`useInfiniteQuery` di
  `apps/web/src`, dan **56 rute** yang badan handler-nya memanggil
  `resolveBranchId(c)` (32 di antaranya GET) di `apps/server/src`
- **Metode**: dua arah, karena keadaan yang dijaga ("cabang mana yang sedang
  dibicarakan layar ini") punya dua pintu:

  **Arah A — kunci vs URL.** Untuk tiap `useQuery`, kumpulkan pengenal yang ikut
  membentuk URL-nya, telusuri turunan `const` lokal secara transitif, lalu
  tuntut semuanya muncul di `queryKey`. **BUKAN daftar nama variabel** —
  versi pertama sapuan ini memakai daftar nama dan menuduh empat pemanggilan
  yang benar (`cabangFilter`, `asalId`, `storageBranch`, `branchSel` tak ada di
  daftarku). Hasil arah A: **13 selisih, KETIGA BELASNYA turunan lokal yang sah**
  (`branchParam` dari `cabangFilter`, `qs` dari `branchQuery`, `qsPengadaan`
  dari `scopePengadaan`, …). **Arah A BERSIH — semua 166 kunci membawa apa pun
  yang dibawa URL-nya.**

  **Arah B — URL vs server.** `resolveBranchId` untuk owner/admin berbunyi:
  `?branch_id=` bila ada, **kalau tidak cabang aktif PERTAMA**. Jadi rute
  begitu yang dipanggil tanpa `branch_id` diam-diam berbicara tentang cabang
  pertama. **Di sinilah temuannya.**
- **Detektor**: DIBUKTIKAN bisa menuduh — tiga kali, tiap suntikan diperiksa
  benar-benar mendarat lebih dulu. (1) `branchQuery` dicabut dari
  `/kosongkan` → gerbang menuduh `MejaStatusPanel.tsx:122`; (2) dicabut dari
  `PUT /meja/tata-letak` → menuduh `MejaPage.tsx:162`; (3) `branchQuery`
  dicabut dari `queryKey` (URL tetap benar) → pasangan kunci-cache merah.
  Di mobile: cabang dikembalikan ke BADAN pada `simpanTataLetak` → merah;
  satu aksi papan berhenti mengoper cabang → merah (5 → 4)
- **KESALAHAN GERBANGKU SENDIRI, ditemukan oleh bukti merahnya**: asersi
  source-pin `expect(meja).toContain("/kosongkan${branchQuery}")` tetap **HIJAU**
  saat bug aslinya kusuntikkan kembali — yang dibacanya **prosaku sendiri**,
  komentar yang mengutip bentuk benar untuk menjelaskan kenapa ia benar. Uji
  yang dijaga komentarnya sendiri adalah uji yang tak bisa gagal. Diperbaiki
  dengan `tanpaKomentar()`, lalu bukti merahnya diulang
- **Hasil**: **TEMUAN — 7 pintu di web, 6 di mobile.** Terukur terhadap Postgres
  sungguhan; meja & bill milik cabang KEDUA, token pemilik:

  | pintu | tanpa `branch_id` | dengan |
  |---|---|---|
  | `GET /meja/:id/log` | **404** | 200 |
  | `POST /meja/:id/kosongkan` | **404** | 200 |
  | `GET /pesanan/:jenis/:id/log` | **404** | 200 |
  | `POST /pesanan/:jenis/:id/status` | **404** | 200 |
  | `POST /pesanan/…/item/:it/status` | **404** | 200 |
  | `POST /pesanan/…/item/:it/sajian` | **404** | 200 |
  | `PUT /meja/tata-letak` | **200 — dan tak ada yang pindah** | 200, pindah |

  Yang terakhir jauh lebih sunyi dari 404: memindahkan meja cabang kedua ke
  (7,9) tanpa `branch_id` membalas **HTTP 200** berisi **7 meja cabang LAIN**,
  dan mejanya tetap di (0,0). Halaman menggambar denah cabang yang salah
  sebagai denah yang barusan "tersimpan"
- **Bentuknya, lagi**: setiap pintu di atas punya **kembaran di layar yang sama
  yang mengirimkannya dengan benar**. `KasirPage` menulis
  `/meja/${id}/kosongkan${branchQuery}` sejak awal; modal yang dipakai bersama
  di `MejaStatusPanel` tidak — padahal ia MENERIMA `branchQuery` sebagai prop
  dan memakainya dua baris di bawah untuk `invalidateQueries`. Papan pesanan
  memuat kartunya dengan `branch_id`, lalu menolak setiap ketukan di atasnya
- **Mobile — bentuk paling sunyi dari semuanya**: `simpanTataLetak` MENGIRIM
  cabangnya, di **badan**. `TataLetakBody` di server hanya berisi `items`, jadi
  Zod membuangnya tanpa sepatah kata dan handler-nya jatuh ke cabang pertama.
  Terukur: `branch_id` di badan → **HTTP 200**, 7 meja cabang lain, mejanya tak
  bergerak. Komentar di repositori itu **sudah menuliskan aturannya** ("[branchId]
  wajib bagi owner/admin agar server tahu denah cabang mana yang ditulis") —
  yang salah cuma tempat menaruhnya
- **Cakupan (aturan ke-5)**: dari 20 pemanggilan web yang tercocokkan ke rute
  `resolveBranchId`, **9 membawa cabang, 11 tidak**; dari 11 itu **7 temuan, 4
  sah** (2 layar peran terikat cabang, 1 `branch_id` bersyarat dari URL halaman,
  1 mengirimnya di badan sebagai `tujuan_branch_id` yang memang dibaca server).
  Keempatnya masuk `DIKECUALIKAN` berikut alasannya, dan gerbangnya menolak
  pengecualian basi
- **Batas detektor**: hanya melihat `api(...)` yang argumen pertamanya literal —
  **22 panggilan** URL-nya dirakit di variabel dan tak terbaca. Rute yang
  memilih cabang lewat `auth.branch_id` langsung (tanpa `resolveBranchId`) juga
  di luar sapuan; ia bagian populasi yang lebih luas dan belum disapu
- **Tindak**: 7 pintu web + 6 pintu mobile menempelkan cabangnya; kunci cache
  `meja-log` & `pesanan-log` ikut membawanya; `ApiClient.put` di mobile menerima
  `query`. Gerbang `apps/server/test/cabang-ikut-di-url.test.ts` (6 uji) dan
  `test/cabang_ikut_di_query_test.dart` (9 uji). Pasangan anti-hijau-palsu:
  kasir cabang 2 tanpa `branch_id` tetap **200** di keempat pintu yang diukur —
  perbaikannya tak menyentuh peran yang terikat cabang
- **Belum dikerjakan, tercatat**: server MENERIMA `branch_id` di badan
  `/meja/tata-letak` lalu membuangnya diam-diam. Menolaknya (`.strict()`) atau
  membacanya akan mengubah kegagalan sunyi itu jadi berbunyi — di luar lingkup
  vena ini

---

## Indeks vs WHERE yang benar-benar dipakai — basis data — 2026-08-22

- **Populasi**: **157 indeks** di katalog. Diukur empiris, bukan dibaca:
  statistik direset, **68 rute GET** ditembak, lalu `pg_stat_user_tables`
  ditanya tabel mana yang di-seq-scan dan berapa baris terbaca
- **Volume**: disuntikkan bertahap sampai **500.098 penjualan + 500.138 baris
  jual** (≈7 tahun warung ramai), `ANALYZE` sesudah tiap tahap
- **Hasil**: **BERSIH — tak ada indeks yang hilang.** Dari 68 rute, tepat SATU
  tabel besar di-seq-scan penuh (`sales`, lewat `/laporan/durasi-pesanan`), dan
  `EXPLAIN (ANALYZE)` menunjukkan planner-nya BENAR: filternya memilih ~100%
  baris dalam rentang yang diminta, jadi indeks tak bisa menolong. Postgres
  sudah memparalelkannya sendiri (`Parallel Seq Scan` + `Parallel Hash Join`)

  | rute | 50 ribu | 500 ribu |
  |---|---|---|
  | `GET /laporan` | 0,212 dtk | 0,526 dtk |
  | `GET /laporan/menu-laris` | 0,099 dtk | 0,604 dtk |
  | `GET /laporan/durasi-pesanan` | 0,130 dtk | 0,273 dtk |
  | rute baca lainnya (8) | — | ≤ 0,087 dtk |

- **KESALAHAN YANG DITEMUKAN, dan ia ada di ledger ini sendiri**: vena "Batas
  laju di luar email" mencatat "laporan agregat ternyata murah (0,035 dtk atas
  50.111 penjualan)". **Angka itu hasil pengukuran yang datanya tak pernah
  dilihat kuerinya**: 50.111 baris suntikannya mendarat di perusahaan LAIN,
  sementara token pengukurnya milik perusahaan dengan 98 penjualan. Kesimpulan
  itu diralat di entrinya, dan **aturan ke-6** lahir dari sini. Temuan
  `POST /upload` di entri itu tetap berdiri — ia diukur lewat penyimpanan,
  bukan lewat kueri tenant
- **Ikut terukur**: 10 laporan rentang-penuh SERENTAK membuat `GET /menu`
  melompat **0,010 → 2,073 dtk**, lalu pulih. Bentuknya sama dengan vena
  N-round-trip, tapi **tak kuperlakukan sebagai temuan**: seluruh rute laporan
  digerbang owner/admin — terukur **403 untuk kasir pada kelimanya** — jadi ini
  ciri kapasitas pada tenant yang sepuluh pemiliknya menarik laporan tujuh
  tahun bersamaan, bukan permukaan serangan. Memasang batas laju di situ tak
  menyentuh mekanismenya dan cuma akan terlihat seperti penjagaan
- **Batas**: yang diukur RUTE BACA tanpa parameter jalur (68 dari 469). Jalur
  tulis dan rute ber-`:id` tak diukur. Volume disuntikkan pada satu tenant
  besar; distribusi banyak-tenant (yang membuat `company_id` selektif) tak
  diuji, dan justru di sanalah indeks ber-prefix `company_id` paling berguna
- **Tindak**: tak ada perubahan kode — tak ada indeks yang hilang.
  `scripts/ukur-latensi.sh` dibuat sebagai penawar kesalahan di atas: ia
  **menolak berjalan** (exit 2) sampai membuktikan API benar-benar melihat data
  yang diukur, dan buktinya diambil dari balasan rutenya sendiri, bukan dari
  `SELECT count(*)`

---

## Stempel waktu dibandingkan sebagai teks — mobile + server — 2026-08-22

Vena pertama dari **usulan lanjutan** (antrean awal habis). Dipilih karena satu
alasan yang bisa ditunjuk: kelas ini sudah menggigit **dua kali**, dan
**keduanya ketemu tak sengaja**. Alatnya sudah ada; penjaganya belum.

- **Populasi**:

  | permukaan | angka |
  |---|---|
  | Dart · `.compareTo(` di `lib/` | **12** |
  | Dart · `.sort(` | **14** |
  | TS · kandidat mentah | **19** |
  | TS · di dalam `` sql`…` `` — **Postgres, bukan JS** | **8** |
  | TS · JS sungguhan | **11** |
  | TS · medan stempel **dari klien** (`z.string().datetime(`) | **2** |

- **Hasil**: **TEMUAN — yang ketiga, dan ia ketemu saat menulis penjaganya.**
  Terukur pada `urutkanPesanan`: dua kartu, B berstempel server
  `10:00:01.000Z`, A baru ditandai di ponsel sehingga berstempel optimistis
  `10:00:01.000123Z` (**lebih baru**). Urutan papannya `[B, A]` — persis
  kebalikan dari yang ditulis dokumen fungsinya sendiri (*"tanpa mengurut ulang
  dengan kunci yang sama, kartu yang baru ditandai diam di tempatnya"*)
- **DUA KALI PENJAGANYA GAGAL PADA BUKTI MERAHNYA SENDIRI**, dan keduanya
  ditulis apa adanya:
  1. Versi pertama hanya melihat **penerima** `compareTo`. Bug yang jadi alasan
     berkas itu ada — `t.compareTo(p.waktu)` — penerimanya bernama `t`, jadi
     sapuannya **melewatkannya**. Diperbaiki jadi memeriksa KEDUA sisi; sesudah
     diperlebar ia langsung menemukan dua situs lagi yang belum pernah dilihat
  2. `urutkanPesanan` menyortir `kunciUrutPesanan(b).compareTo(kunciUrutPesanan(a))`
     — seluruhnya tentang stempel, tanpa satu kata pun yang menyebut waktu.
     Sapuan berbasis nama **tak bisa** melihatnya. Batas itu **ditulis dan
     dijaga source-pin**, bukan disamarkan dengan menambah kata ke daftar nama
- **Dua tuduhan yang ternyata BENAR**: `rekap_kebersihan_page` dan
  `rekap_absen_page` membandingkan bulan `'YYYY-MM'` — **berlebar tetap**, jadi
  urutan teks = urutan waktu. Masuk `dikecualikan` berikut alasannya. Justru
  kelas ini yang membuat aturannya tak bisa "semua perbandingan waktu wajib
  lewat pembantu"
- **Sisi TypeScript: BERSIH, dan alasannya diukur bukan diandaikan.**
  `Date.prototype.toISOString()` **selalu** menulis tiga digit pecahan
  (dijalankan di uji, bukan diingat), dan kesebelas situs JS membandingkan
  stempel yang server/web sendiri hasilkan. Kedua medan stempel dari klien
  (`sync.waktu`, `admin-tenants.plan_expires_at`) sudah diurai `new Date(...)`
  di batasnya
- **Gerbangnya TIPIS di sisi TS, dan itu keputusan**: ia hanya melarang
  perbandingan teks atas stempel **yang datang dari klien**. Gerbang yang
  menuntut seluruh perbandingan stempel lewat pembantu akan menuntut pekerjaan
  pada kode yang hari ini benar — dan penjaga semacam itu dilonggarkan orang,
  bukan dipatuhi
- **Batas detektor**: sapuan Dart berbasis NAMA medan, jadi buta terhadap
  pembantu yang namanya tak menyebut waktu (dibuktikan, lalu ditutup
  source-pin). Sapuan TS hanya melihat medan ber-`z.string().datetime(`;
  stempel klien yang masuk lewat `z.string()` polos tak terlihat
- **Tindak**: 4 situs Dart → `bandingStempel`; catatan **asimetri** ditulis di
  `packages/shared/src/pesanan.ts` (kenapa versi TS-nya aman sementara
  cerminan Dart-nya wajib memakai pembantu) supaya tak ada yang
  "menyederhanakan" sisi Dart kembali. Gerbang:
  `kakarut-mobile/test/stempel_satu_banding_test.dart` (6 uji) dan
  `apps/server/test/stempel-klien-diurai.test.ts` (5 uji, termasuk uji pasangan
  yang **menjalankan** premis `toISOString()`-nya dan yang membuktikan
  pemindainya melewati `` sql`…` ``). Mobile: commit `426ae6a`, PR #12

---

## Cabang dari query dipilih di luar `resolveBranchId` — server — 2026-08-23

Vena kedua dari usulan lanjutan (usulan #2). Yang ditemukan lebih dulu bukan
venanya, melainkan **cacat di alat yang kupakai untuk mengukurnya** — jadi
entri ini punya dua bagian, dan urutannya penting.

### Bagian A — pengupas komentar buta, dan sapuannya tetap melapor

- **Gejala**: sapuan pertama vena ini mengurai **19 rute dari 40 berkas rute**,
  lalu melaporkan angkanya seperti biasa. Instrumentasi menunjukkan tabel
  `.route(...)` di `app.ts` tak pernah terbaca.
- **Sebabnya satu baris**, `apps/server/src/app.ts:144`:

  ```ts
  .use("/admin/*", requireAuth, requireSuperAdmin)
  ```

  `/*` **di dalam string literal**. Pengupas komentar naif menilai `/` tanpa
  tahu ia ada di mana, membacanya sebagai pembuka komentar blok, dan menelan
  **12.363 aksara** sisa berkas.
- **Salinannya ada TUJUH** — empat TS, tiga Dart — semuanya versi naif yang
  sama. Kelas "aturan ditulis sekali, disalin, lalu menyimpang" ternyata berlaku
  pada perkakas auditnya sendiri.
- **Kebutaan terukur** (pengupas naif vs pengupas leksikal, aksara yang
  hasilnya BERBEDA):

  | akar | berkas | terdampak | aksara |
  |---|---|---|---|
  | `apps/server/src` | 106 | 9 | **6.307** (4.167 di `app.ts` saja) |
  | `apps/web/src` | 133 | 2 | **104** |
  | `packages/shared/src` | 21 | 0 | 0 |
  | `kakarut-mobile/lib` | 123 | 3 | **157** (semuanya `//` di dalam `https://…`) |

- **Dampak pada gerbang yang SUDAH terkirim: nol, dan itu diukur bukan
  diandaikan.** `formatRupiah` 203/203 · `queryKey:` 346/346 ·
  `z.string().datetime(` 2/2 · `terikatCabang(` 35/35 · `resolveBranchId(`
  61/61. Yang berubah hanya tabel rute `app.ts` (261 → 263), dan
  `cabang-ikut-di-url.test.ts` membaca berkas itu **mentah**, jadi ia tak pernah
  terkena. Tak ada temuan lama yang perlu ditarik.
- **Versi antara pun masih salah, dengan cara lain.** Pengupas yang cuma
  melewati string literal terpeleset di `/[",\n]/` — sebuah **regex** yang
  memuat kutip ganda; kutip itu membuka string palsu yang menelan komentar
  dokumentasi di bawahnya (`apps/web/src/lib/bahanCsv.ts:36`). Kebutaan berubah
  jadi tuduhan palsu, dan itu pertukaran yang lebih buruk (pagar #3).
- **Tindak**: satu rumah per repo —
  `apps/server/src/scripts/buta-komentar.ts` dan
  `kakarut-mobile/test/util/buta_komentar.dart`; tujuh salinan dihapus, enam
  pemakai mengimpor. Pemindainya melewati string, template `${…}` (yang
  isinya kode lagi), literal regex (TS) serta string mentah/tiga-kutip dan
  komentar blok **bersarang** (Dart) sebelum menilai pembuka komentar. Kutip
  ganjil dibatasi berhenti di `\n`, jadi kerusakan terburuknya satu baris.
- **Detektor DIBUKTIKAN bisa menuduh — dan buktinya permanen**: `butaNaif`
  disimpan **di dalam** kedua berkas uji sebagai alat ukur. Tiap sifat diuji
  berpasangan: sekali menuntut versi baru benar, sekali menuntut versi naif
  memang gagal di situ (`expect(butaNaif(app)).not.toContain('.route("/admin/tenants"')`,
  dan selisihnya > 4.000 aksara). Uji yang cuma menyatakan pengupasnya ada,
  tanpa pasangan itu, tak membuktikan ia perlu.
- **Kesetaraan port diverifikasi**: implementasi TS diadu dengan referensi
  Python atas **260 berkas** — sama persis; 12 berkas yang tampak berbeda
  ternyata cuma artefak indeks UTF-16 vs titik-kode (semuanya memuat emoji),
  dan setara lagi sesudah emoji dinetralkan.

### Bagian B — venanya, dengan pengurai yang benar

- **Populasi** (sapuan ulang, seluruh `apps/server/src`):

  | ukuran | angka |
  |---|---|
  | deklarasi rute berjalur literal | **263** |
  | pemanggilan `resolveBranchId(` | **61** |
  | pemakaian `terikatCabang(` | **35** di 13 berkas |
  | pembacaan `c.req.query("branch_id")` | **15** |

  Angka "511/515 rute" dari sapuan pertamaku **salah dan dikoreksi di sini**:
  pola `.get("…"` ikut menangkap `c.get("auth")`.

- **Rumusan mentah usulan #2 ternyata BERSIH, dan itu dikatakan begitu.** Dari
  39 pembacaan `auth.branch_id` di handler tanpa `resolveBranchId`, **34** ada
  di dalam cabang `terikatCabang(...)` dan **5** dicapai owner/admin — kelimanya
  benar: `GET /auth/me` ×2 memang melaporkan cabang penggunanya sendiri, dan
  tiga sisanya di middleware izin `izinkanManajemenAtauKaryawanCk` /
  `izinkanProduksi` (`app.ts:161,165,181`), tempat `auth.branch_id` dipakai
  sebagai **identitas**, bukan pilihan.

- **Yang tidak bersih ada satu lapis di bawahnya**: dari 15 pembacaan
  `c.req.query("branch_id")`, satu di rumahnya dan enam adalah penanda
  pelebaran `=== "all"` yang selalu berpasangan dengan `resolveBranchId`.
  **Delapan sisanya menyusun saringan cabang sendiri, dan tak satu pun
  memeriksa cabang itu milik perusahaan ini.**

- **Hasil: TEMUAN.** Terukur lewat HTTP sungguhan, owner Basooopa,
  `?branch_id=` satu UUID cabang perusahaan **lain**:

  | rute | pemilihnya | sebelum | sesudah |
  |---|---|---|---|
  | `GET /meja` | `resolveBranchId` | **404** ← aturannya | 404 |
  | `GET /menu` | tulisan tangan | 200, **80 dari 81** menu | **404** |
  | `GET /perlengkapan/beli` | tulisan tangan | 200, **0 dari 53** baris | **404** |
  | `GET /kebersihan/area` | `saringCabang` (bentuk saja) | 200, **2 dari 3** area | **404** |
  | `GET /kebersihan` | `saringCabang` | 200, 0 baris | **404** |
  | `GET /pengajuan` | tulisan tangan | 200, 0 baris | **404** |
  | `GET /absensi/rekap` | tulisan tangan | 200, 0 baris | **404** |
  | `POST /perlengkapan/beli/batal-semua` | tulisan tangan | 200 `{"ok":true,"jumlah":0}` | **404** |

  Yang terakhir intinya: **operasi massal melaporkan sukses atas cabang yang tak
  ada**. Operatornya mengira sudah membersihkan; tak ada satu baris pun
  tersentuh.

- **Bukan kebocoran lintas-perusahaan, dan itu ditulis apa adanya.**
  `company_id` selalu ikut di WHERE, jadi tak ada data perusahaan lain yang
  terlihat. Yang diperbaiki **letak aturannya**, bukan lubang data — aman yang
  datang dari konjungsi di kueri lain adalah aman yang bisa hilang tanpa ada
  yang menyadarinya. Kalimat itu bukan karanganku: komentar
  `cabangTujuanPenulisan` di berkas yang **sama** sudah menuliskannya, untuk
  paruh badan-permintaan dari aturan yang sama.

- **Dua rute malah baru SEMBUH.** Sebelum perbaikan
  `GET /perlengkapan/beli?branch_id=all` → **400** (nilai `"all"` masuk ke
  perbandingan kolom uuid) dan `GET /menu?branch_id=all` → katalog kosong —
  padahal `all` adalah nilai yang dipakai setiap daftar lain. Sesudahnya
  keduanya 200 dengan isi penuh (53 dan 81).

- **Tindak**: satu pintu baru bersebelahan dengan `pastikanCabang` —
  `cabangDariQuery(c)` di `apps/server/src/middleware/auth.ts`: tak dikirim /
  `all` → `null` (tak menyaring); bukan UUID → 400 bernama; UUID → 
  `pastikanCabang` → 404 bila bukan milik perusahaan ini. Delapan situs
  memakainya; `saringCabang` lokal di `kebersihan/routes.ts` dihapus karena
  aturannya pindah utuh.

- **Gerbang + bukti merah**: `apps/server/test/cabang-satu-pemilih.test.ts`
  (12 uji). Detektornya dipisah jadi fungsi murni supaya bukti merahnya bisa
  dijalankan atas masukan **sintetis** — kelima bentuk mentah yang dipakai
  kedelapan rute sebelum perbaikan diadukan satu per satu, dan ketiga bentuk
  `=== "all"` yang sah dipastikan **tidak** tertuduh. Lalu bukti merah atas
  pohon sungguhan: `menu/routes.ts` dikembalikan ke bentuk lamanya (suntikan
  di-assert mendarat lebih dulu), sapuan menuduh `modules/menu/routes.ts:289`
  — berkas dan baris yang tepat.
- **Perilakunya dijaga terpisah dari bentuknya**: `verify-api.sh` §239, 25
  asersi — kedelapan rute 404 untuk cabang asing, plus pasangan
  anti-hijau-palsu (cabang sendiri tetap 200, `all` tetap 200, `/menu` tanpa
  param tetap penuh, nilai sampah 400 bernama). Bentuk yang benar dengan hasil
  yang salah tetap bug, jadi keduanya perlu.
- **Anti-hijau-palsu untuk penyaringnya sendiri**: satu menu dibatasi ke cabang
  Pusat lewat `menu_branches`, lalu `?branch_id=` cabang LAIN **milik
  perusahaan yang sama** → 80 dari 81 (menunya hilang, benar), `?branch_id=`
  Pusat → 81. Jadi yang ditolak hanya cabang asing; penyaringan sahnya utuh.
- **Batas detektor, jujur**: gerbangnya melihat **bentuk pembacaan query**,
  bukan apa yang terjadi pada nilainya sesudah itu. Rute yang memanggil
  `cabangDariQuery` lalu mengabaikan hasilnya tetap hijau. Ia juga tak melihat
  `branch_id` yang datang lewat **badan** permintaan (itu wilayah
  `cabangTujuanPenulisan`) maupun lewat parameter jalur.
- **Gerbang**: typecheck bersih · `npm test` **2.147 lolos / 177 berkas** ·
  `verify-api.sh` **2.810 lolos, 0 gagal** (DB segar) · `audit:invarian` 26/0 ·
  build web bersih · `flutter analyze` bersih · `flutter test` **467**.

### Aturan 7 untuk ledger ini

> **ALAT UKURNYA IKUT DIUJI.** Sapuan yang tak dibuktikan membaca apa yang
> seharusnya dibacanya membuat setiap "BERSIH" di atasnya berarti "tidak
> terbaca", bukan "aman" — dan tak ada satu uji pun yang berubah warna saat itu
> terjadi. Aturan 1 menuntut detektornya bisa MENUDUH; aturan 7 menuntut ia
> juga bisa MELIHAT.

---

## `api()` yang URL-nya dirakit di variabel — web + server — 2026-08-23

Vena ketiga dari usulan lanjutan (usulan #3), dan ia berakhir dengan bentuk
yang sama seperti putaran lalu: **alatnya TEMUAN, venanya BERSIH.**

Usulan aslinya berbunyi "22 panggilan `api()` tak terbaca sapuan #25". Angka itu
**cocok persis**. Yang tidak diduga: dua kebutaan LAIN di gerbang yang sama,
keduanya lebih besar.

### Populasi

| ukuran | gerbang #25 | sesudah |
|---|---|---|
| panggilan `api(` yang TERLIHAT di `apps/web/src` | **303** | **322** |
| · URL literal diawali `/` | 300 | 300 |
| · URL dirakit di variabel | dilewati (**22**) | diresolusi |
| rute terpetakan | **247** | **273** |
| · ber-`resolveBranchId` | **56** | **58** |
| jalur **HANTU** yang dikarang pemeta | **4** | **0** |
| **pemanggil yang benar-benar DINILAI** | **13** | **75** |
| Dart · panggilan HTTP `lib/` literal / variabel | 165 / **3** | — |

**Tiga belas.** Gerbang yang entri #25 tulis sebagai "tujuh pintu diukur"
sesungguhnya menilai 13 dari 322 panggilan `api(` — bukan karena 13 yang
relevan, melainkan karena tiga kebutaan bertumpuk.

### Tiga sebabnya, masing-masing bisa ditunjuk barisnya

1. **Peta rute memakai `export const X = new Hono` PERTAMA untuk seluruh
   berkas.** `modules/customer/routes.ts` mengekspor dua Hono yang keduanya
   terpasang (`memberCariRoutes` → `/member-cari`, lalu `customerRoutes` →
   `/customer`), jadi sepuluh rute `/customer/*` tercatat sebagai HANTU
   `/member-cari/*`. Kelas yang sama dengan `re.search` yang memungut pembantu
   senama pertama di vena #18 — dan jalur hantu lebih buruk daripada jalur yang
   hilang: pemanggil bisa dicocokkan ke rute yang tak pernah ada.
2. **Modul yang lahir dari PABRIK tak terlihat sama sekali.**
   `export const produksiRoutes = buatRuteTambahStok("produksi")` (dan
   `pembelianRoutes = …("beli")`) tak pernah cocok dengan pola `= new Hono`,
   jadi **13 rute × 2 prefiks = 26 jalur** hilang, dua di antaranya memilih
   cabang (`GET /produksi`, `GET /pembelian`).
3. **Regex pemindai patah pada `;` di argumen tipe.**
   `api\s*(?:<[^;]{0,200}?>)?\s*\(` tak mengenali
   `api<{ ok: true; jumlah: number; tanggal: string }>("/stok/awal", …)` —
   **23 dari 322** panggilan tak pernah ada baginya.

Dan satu lagi yang ketemu SAAT MEMPERBAIKI, bukan saat mengintai:
normalisasi jalur mengubah `` `/meja/tata-letak${branchQuery}` `` jadi
`/meja/tata-letak:x`, yang tak cocok ke rute mana pun — jadi tiap pemanggil
yang menempelkan query lewat interpolasi ikut dilewati. Itu penyumbang terbesar
dari 13 → 75.

### Detektor DIBUKTIKAN bisa menuduh — dan buktinya berpasangan

Bukti merah yang paling menentukan, karena ia memisahkan gerbang lama dari yang
baru pada bug yang SAMA. `RekomendasiBeliPage.buildUrl()` dicabut
`branchQuery`-nya (suntikan di-assert mendarat lebih dulu):

| | pemanggil dinilai | hasil |
|---|---|---|
| pipa **lama** | 13 → **13** | **HIJAU** — `api(buildUrl())` dilewati, bugnya tak terlihat |
| gerbang **baru** | 75 | **MERAH** di `pages/produksi/RekomendasiBeliPage.tsx:89` |

Suntikan kedua (`MejaPage` kehilangan `${branchQuery}`) juga tertuduh di berkas
& baris yang tepat — **dan pipa lama pun menangkapnya** (13 → 14). Itu ditulis
apa adanya: untuk idiom "ekor `${branchQuery}`", kebutaan normalisasinya
**saling meniadakan** — URL yang membawa cabang tak terlihat, yang kehilangan
cabang jadi terlihat. Jadi kebutaan itu nyata sebagai cakupan, bukan sebagai
lubang untuk idiom itu sendiri.

Sebelas uji sintetis menjaga tiap bagian penelusurnya, tiap-tiap berpasangan
dengan bentuk lama yang digantikannya (`REGEX_LAMA` disimpan di dalam berkas
ujinya sebagai alat ukur, seperti `butaNaif` putaran lalu).

### Empat kali penelusurnya menuduh kode yang benar, dan semuanya diperbaiki

Tak satu pun dikirim; masing-masing ketemu karena tuduhannya diperiksa tangan.

1. `PerlengkapanPage:370` tertuduh atas `GET /perlengkapan` — panggilannya
   `method: item ? "PUT" : "POST"`, dan pembaca metodenya hanya mengenali
   `method: "PUT"`, jadi terbaca GET.
2. `KategoriManagerModal:37` tertuduh atas `GET /perlengkapan` — pencarian prop
   menyapu **tiap** `endpoint=` di seluruh `apps/web`, jadi ia mewarisi nilai
   milik `RiwayatHargaModal`. Diperbaiki: hanya tag komponen yang
   DIDEFINISIKAN di berkas itu.
3. `ShiftDetailModal:49` & `RiwayatPage:41` tertuduh atas `/shift` & `/penjualan` —
   ekor `${id}` yang merupakan RUAS jalur ikut dilucuti, jadi pemanggil DETAIL
   dicocokkan ke rute DAFTAR. Diperbaiki: ekor hanya dilucuti bila ia menempel
   pada ruas (`…tata-letak${q}`), bukan bila ia ruas tersendiri (`/penjualan/${id}`).
4. Penelusur versi pertama memungut literal template dengan regex, dan berhenti
   di backtick BERSARANG — `` `/rekomendasi/beli${branchQuery ? `…` : "?"}…` ``
   terpotong jadi `/rekomendasi/beli${branchQuery ? `. Akibatnya penelusurnya
   **tampak** bekerja (bukti merahnya menuduh, karena bentuk suntikannya
   sederhana) padahal pada kode sehat ia menyumbang **NOL** pemanggil. Ketahuan
   karena angka `telusur` dicetak dan ternyata 0 — bukan karena ada uji merah.

### Hasil: BERSIH

Dengan 75 pemanggil dinilai (dari 13), **nol** temuan perilaku. Ketujuh
tuduhan yang tersisa ditelusuri satu per satu dan semuanya sah; tiga di
antaranya BARU terlihat dan mendapat baris `DIKECUALIKAN` sendiri:

| baru terlihat | kenapa benar |
|---|---|
| `TimBerandaPage` → `GET /produksi`, `GET /pembelian` | `/beranda` hanya dirutekan untuk tim/kitchen/bar (`App.tsx:200`) — peran terikat cabang; sebelumnya tak terlihat karena modul pabrik |
| `StokAwalPage:129` → `POST /stok/awal` | cabang dikirim di BADAN, dan server memilihnya lebih dulu (`stok/routes.ts:621`); sebelumnya tak terlihat karena `;` di argumen tipe |

Keempat URL variabel yang bermuara ke rute pemilih cabang membawa cabangnya:
`RekomendasiBeliPage.buildUrl()` dan `TambahStokPage:358` sama-sama
menempelkan `branchQuery`.

**Mobile: 3 panggilan berjalur variabel, ketiganya diperiksa tangan, semuanya
benar** — `operasional_repository:148` mengirim `branch_id: 'all'`,
`perlengkapan_repository:199` menempelkan `?branch_id=` bersyarat, dan
`kasir_repository:241` (`setStrukCabang`) belum punya pemanggil layar sama
sekali. Tak ada gerbang baru dipasang untuk populasi 3 yang sudah bersih.

### Batas detektor, jujur

- Penelusur nilai berhenti di **dua lompatan**. Nilai yang berpindah lebih jauh
  dari itu (prop → prop → keadaan router → prop) tak akan teresolusi — dan
  yang tak teresolusi **disebut namanya** di uji PREMIS, bukan dilewati.
- Ia melihat nilai LITERAL. Endpoint yang dirakit dari potongan
  (`"/pro" + jenis`) tak terbaca.
- Ia menilai apakah cabang ada di URL, bukan apa yang dilakukan server dengan
  nilainya. Dua pemanggil yang mengirim cabang di BADAN tetap butuh baris
  pengecualian, dan itu memang benar: badan bukan URL.

### Gerbang

typecheck bersih · `npm test` **2.161 lolos / 177 berkas**. `verify-api` tak
dijalankan ulang — tak ada rute server yang disentuh, hanya berkas uji.

---

## Laporan Lama Pesanan di ponsel — mobile — 2026-08-23

Usulan #4, dan ia bukan perburuan bug melainkan **celah yang sudah tercatat**:
vena "fitur lama pengerjaan pesanan" memperbaiki medan yang tak terurai lalu
menuliskan sisanya sebagai batas yang jujur — *"`target_durasi_detik` per menu
dan laporan `/laporan/durasi-pesanan` belum ada di ponsel. Keduanya layar baru,
bukan medan yang tak terurai."*

- **Populasi**: **20 kunci kontrak** — `LaporanDurasiPesanan` (6),
  `DurasiMenuRow` (9), `DurasiRiwayatRow` (5). Dibaca `kakarut-mobile/lib`
  sebelum putaran ini: **0**. Pemanggilan `/laporan/durasi-pesanan` dari
  ponsel: **0**. Tab di `LaporanPage` ponsel: **4 → 5**.

- **DIKERJAKAN SEPARUH, DAN ITU KEPUTUSAN SADAR.** Usulan aslinya menyebut dua
  hal: laporannya DAN penyetel target per menu. Yang kedua **sengaja tidak
  dikerjakan**: `MenuHppPage` di ponsel menulis batasnya sendiri — *"Tambah/ubah
  menu tetap di web"* — dan menyeberanginya untuk satu medan akan membuat batas
  itu berhenti berarti apa-apa. Target tetap disetel dari `MenuFormPage` di web;
  ponsel membacanya saja, lengkap dengan kolom target dan penanda "lewat
  target". Ini dicatat sebagai keputusan, bukan sebagai pekerjaan yang lupa.

- **Fiksturnya HASIL SERVER, bukan karanganku.** Data dibuat lewat HTTP
  sungguhan: satu bill dua sajian di `POST /open-bill`, ditandai selesai
  berjarak **18** dan **27** detik lewat
  `POST /pesanan/open_bill/:id/item/:it/status`, dibayar lewat `POST /penjualan`,
  lalu menunya diberi `target_durasi_detik: 20` lewat `PUT /menu/:id` — yang
  badannya memang PARSIAL (`undefined` = jangan sentuh), jadi kirimannya cuma
  satu medan. Balasan `GET /laporan/durasi-pesanan` disimpan apa adanya sebagai
  `test/fikstur/laporan-durasi-server.json`:

  | | angka |
  |---|---|
  | `jumlah` · `rata_detik` | 8 · 6 |
  | `bertarget` · `lewat_target` | 2 · 1 |
  | baris "Kerupuk Pangsit" | rata 23 · median 23 · 18–27 · target 20 · 1 lewat · `lewat_target: true` |

  Fiksturnya memuat **ketiga** keadaan target sekaligus (tanpa target,
  bertarget-lewat, bertarget-tidak-lewat), dan itu diasersi sendiri — tanpa
  itu cabang yang tak pernah dilewati tak diuji.

- **Detektor DIBUKTIKAN bisa menuduh, dan bentuknya MEKANIS bukan sekali
  suntik.** Untuk **tiap** dari 20 kunci, fiksturnya diurai dua kali — utuh dan
  tanpa kunci itu — lalu hasilnya wajib BERBEDA. Parser yang diam-diam
  mengabaikan sebuah kunci memulangkan nilai yang sama pada kedua kali, dan
  ujinya merah. Diverifikasi dengan mencabut `median_detik` dari `fromJson`
  (suntikan di-assert mendarat): tepat uji `per_menu.median_detik` yang merah.
  Ini menutup kelas yang **nyaris terkirim** di vena #30 — `fromJson` yang
  melewatkan satu kunci tak melempar apa pun, `?? 0` memulangkan nol dengan
  tenang, dan `flutter analyze` tetap hijau.

- **PENJAGANYA SENDIRI HAMPA PADA PERCOBAAN PERTAMA, dan itu ketahuan karena
  disuntik.** Aturan "biasanya lewat target" tidak boleh dihitung ulang di Dart
  (server sudah mengirim `lewat_target`; aturannya milik `lewatTargetDurasi` di
  `@kakarut/shared`). Penjaga versi pertama memakai
  `median\w*\s*[<>]=?\s*\w*[Tt]arget` — menuntut kedua nama BERSEBELAHAN. Saat
  bentuk yang sungguhan disuntikkan (`m.medianDetik > (m.targetDetik ?? …)` —
  ada `m.`, ada kurung, ada `??`), penjaganya **diam** dan 32 uji tetap hijau.
  Diperlebar jadi `[^;\n]{0,40}` di antara keduanya; suntikan yang sama langsung
  merah. Penjaga yang tak menangkap bentuk yang benar-benar ditulis orang bukan
  penjaga.

- **Dirender, bukan cuma diurai.** Vena #30 sudah membuktikan membaca kode saja
  tak cukup — dua cacat tampilan grafik per jam ketemu dengan MERENDER dan
  keduanya lolos `analyze`. `BarisMenuDurasi` karena itu dibuat publik dan
  di-`pumpWidget`: angka sampai ke layar, penanda "lewat target" muncul HANYA
  saat server bilang begitu, dan menu tanpa target tak menampilkan kata
  "target" sama sekali.

- **Yang TIDAK disalin**: aturan `lewat_target` (dijaga uji di atas) dan
  perhitungan durasinya sendiri. Yang boleh disalin cuma `formatDurasi` — ia
  murni tampilan, dan komentarnya di `core/format.dart` sudah menyatakan itu
  sejak vena #30.

- **Satu layar, satu rentang, satu cabang**: tab kelima menonton
  `laporanRentangProvider` + `laporanCabangProvider` yang sama dengan keempat
  tab lain, bukan pemilihnya sendiri. Tab yang membawa pemilihnya sendiri
  membuat dua angka di layar yang sama diam-diam berbicara tentang periode yang
  berbeda.

- **Batas, jujur**: `nomor: null` (selesai selagi bill masih terbuka) dan
  `oleh: null` (data sebelum fitur ini) **tak muncul** di data hidup, jadi
  keduanya diuji dari map yang disusun tangan — dan disebut begitu di berkas
  ujinya, bukan disamarkan sebagai fikstur server.

- **Hasil**: **20 dari 20 kunci kini diurai dan tampil.** Tak ada perubahan
  server maupun web.
- **Gerbang**: `flutter analyze` bersih · `flutter test` **503 lolos** (dari
  467) pada 3.44.7. `verify-api` tidak dijalankan ulang — tak ada rute yang
  disentuh, dan itu disebutkan alih-alih didiamkan.
- **Tindak**: `LaporanDurasi` + `DurasiMenuRow` + `DurasiRiwayatRow` di
  `operasional_models.dart`, `getLaporanDurasi` + `laporanDurasiProvider` di
  `operasional_repository.dart`, tab `⏱ Lama Pesanan` di `laporan_page.dart`,
  `test/laporan_durasi_test.dart` (36 uji) + fikstur server. Mobile: PR #12

---

## Badan permintaan yang membuang kunci diam-diam — server — 2026-08-24

Usulan #5, dan ia lahir dari bug yang **sudah menggigit**: `PUT /meja/tata-letak`
menerima `branch_id` di badan, Zod membuangnya tanpa sepatah kata, dan
akibatnya HTTP **200** yang memindahkan denah cabang LAIN (vena #25). Yang
diperbaiki waktu itu pemanggilnya. Kelasnya tidak.

- **Populasi**:

  | ukuran | angka |
  |---|---|
  | rute terpetakan | **273** |
  | ber-`zValidator("json", …)` | **114** |
  | **`.strict()` sebelum putaran ini** | **0** |
  | sesudah | **112 strict, 2 dikecualikan** |
  | pemanggil web berbadan literal, disapu | 48 (+9 ber-`...spread`) |
  | pemanggil mobile berbadan literal, disapu | 49 (+1 spread) |
  | build ponsel yang pernah rilis, disapu semuanya | **7** (1.0.0+3 … +10) |

- **DETEKTORNYA BUKAN PENGURAI TEKS, dan itu keputusan yang dibayar.** Pembaca
  skema berbasis teks yang kubangun untuk pengintaian **menuduh enam kali, dan
  keenamnya cacatnya sendiri**: `:` terner dibaca sebagai pemisah kunci (2),
  spread objek di dalam `z.object({ …, ...KoordinatBody })`, `z.object(X)`
  ber-identifier telanjang, rantai `OpnameBody.omit({…}).extend({…})`, dan
  **tabrakan nama skema antar modul** (`SupplierBody` ada di dua modul; peta
  datarku menimpanya). Sesudah empat tuduhan palsu di usulan #3, alat pengukur
  vena ini diganti: **suite yang sudah ada** — 2.161 uji satuan + 2.810 asersi
  `verify-api.sh` lewat HTTP sungguhan — dijalankan terhadap build yang sudah
  strict. Apa pun yang merah adalah ketidakcocokan NYATA.

- **Fakta Zod DIJALANKAN, bukan diingat** (zod 4.4.3 terpasang): `.strict()`
  menurun lewat `.extend()`, `.partial()`, dan `.omit()`; kodenya
  `unrecognized_keys`. Keduanya dipaku uji, jadi zod yang berubah membuat
  ujinya merah alih-alih diam-diam salah menyimpulkan.

- **Hasil: TEMUAN — LIMA ketidakcocokan, semuanya ditemukan oleh suite:**

  1. `POST /rekomendasi/menu` (pratinjau) menerima `tujuan_branch_id` yang tak
     pernah ada di `RencanaBody`. Akibat yang lebih dalam: karena kuncinya
     dibuang, pratinjaunya jatuh ke `resolveBranchId(c)` → **cabang aktif
     pertama**, sementara faktur yang diterbitkan sesudahnya memakai
     `tujuan_branch_id`. Asersi §108 selama ini **mengukur cabang yang berbeda
     dari faktur yang dibuatnya**, dan lulus hanya karena kebetulan keduanya
     tak bergantung cabang.
  2. `POST /open-bill` — **4 panggilan** mengirim `is_dine_in`, medan milik
     `SaleBody`, bukan `BillBody`.
  3. `POST /kebersihan` menerima `tanggal` yang komentar skemanya sendiri sudah
     menyatakan *"SENGAJA tidak diterima — server yang menurunkannya"*. Kini 400
     yang menyebut kuncinya; ketujuh build ponsel disapu lebih dulu dan tak satu
     pun mengirimnya.
  4. Jembatan `/sync` meneruskan `branch_id` ke `/perlengkapan/:id/pakai` — rute
     yang membaca cabangnya dari QUERY dan tak pernah membaca kunci itu.
  5. `POST /shift/tutup` — bukan cacat melainkan **keputusan yang sudah
     tertulis**; jadi pengecualian, lihat di bawah.

- **KESALAHANKU, dan suite yang menangkapnya**: perbaikan pertama untuk (4)
  mencabut `branch_id` dari badan **sebelum** `panggilInternal` sempat
  mengangkatnya ke query. Perintahnya jadi diterima, tapi potongannya mendarat
  di cabang PERTAMA — persis bug yang §208 ada untuk mencegah, dibuat ulang
  oleh perbaikanku sendiri. §208 langsung merah. Bentuk akhirnya: cabangnya
  dioper eksplisit ke `panggilInternal`, kuncinya dicabut dari badan.

- **Dua pengecualian, bernama, dan yang satu BERTANGGAL**:

  | pintu | alasan |
  |---|---|
  | `TataLetakBody` (`PUT /meja/tata-letak`) | Ketujuh build rilis (1.0.0+3 … +10) mengirim `branch_id` di badan sini — **termasuk yang terpasang hari ini**, karena perbaikannya (`4e02a0b`) belum tayang, dan repo ini **tak punya gerbang versi klien**. `.strict()` berarti ponsel lama menerima 400 saat menyimpan denah: fitur yang sekarang jalan, mati saat deploy. **Syarat cabut ditulis di kodenya.** |
  | `POST /shift/tutup` (inline) | Aturannya sudah ditulis `verify-api` §152: *"klien yang mengirim field tak dikenal tak boleh gagal menutup shift — itu terjadi tepat saat kasir mau pulang."* |

- **Pesan galatnya diberi kalimat sendiri**: tanpa kasus `unrecognized_keys`,
  pesannya jatuh ke bawaan zod (bahasa Inggris) dan `labelJalur([])` cuma
  memulangkan "Isian". `validator.ts` ada justru karena pesan validasi pernah
  tampil `[object Object]`; menambah kelas galat tanpa kalimatnya akan
  mengulang kesalahan yang sama satu tingkat lebih kecil. Terukur lewat HTTP:
  `{"error":"Isian: isian tak dikenal: kunci_ngawur"}`, kode 400.

- **Gerbang + bukti merah**:
  `apps/server/test/badan-tak-menerima-kunci-asing.test.ts` (7 uji) menjaga
  BENTUKNYA — tiap skema `zValidator("json", …)` wajib strict, dengan
  `DIKECUALIKAN` bernama, uji pasangan yang menolak pengecualian basi, dan uji
  yang menolak gerbang-yang-dipenuhi-pengecualian. Ia **sengaja tidak membaca
  himpunan kunci** — justru bagian itu yang salah enam kali.
  Bukti merah dua lapis: mencabut `.strict()` dari `SajianBody` (suntikan
  di-assert mendarat) → gerbang menuduh `modules/pesanan/routes.ts:648` dan
  `:803`; dan lewat HTTP, kunci asing → **400 bernama**, badan sah → **201**,
  serta pengecualian denah meja → tetap **200**. `verify-api.sh` §240 memaku
  ketiganya sebagai perilaku.

- **Batas detektor, jujur**: suite ini menguji jalur yang DILEWATI 2.817 asersi.
  Rute yang tak punya asersi badan sama sekali tetap strict, tapi
  ketidakcocokannya baru ketahuan saat dipakai — dan itu justru bentuk yang
  diinginkan: 400 bernama, bukan 200 yang diam.
- **Gerbang**: typecheck bersih · `npm test` **2.169 lolos / 177 berkas** ·
  `verify-api.sh` **2.817 lolos, 0 gagal** (DB segar) · `audit:invarian` 26/0 ·
  build web bersih. Mobile tak tersentuh — 49 badan yang dikirim `lib/` hari ini
  sudah bersih, disapu bukan dikira.
- **Tindak**: `.strict()` di 112 badan (33 berkas), kasus `unrecognized_keys` di
  `lib/validator.ts`, `branch_id` dicabut dari badan di jembatan `/sync`, empat
  perbaikan di `verify-api.sh` sendiri, §240 baru, dan entri
  `docs/mobile/CHANGELOG-API.md` bertanda 🔴 WAJIB.

---

## ANTREAN HABIS — 2026-08-22

Kedua puluh satu vena di antrean awal sudah digarap. Yang tersisa di bawah
adalah **usulan baru**, lahir dari celah yang tercatat di entri-entri di atas —
bukan dari daftar awal.

### Usulan, diurut menurut apa yang sudah TERBUKTI menggigit

1. ~~**Stempel waktu dibandingkan sebagai teks — sapuan menyeluruh.**~~ —
   **TERGARAP**, lihat entri di atas. Yang KETIGA ketemu saat menulis
   penjaganya (urutan papan terbalik, terukur), dan penjaganya sendiri gagal
   pada bukti merahnya dua kali sebelum benar.
2. ~~**Rute yang memilih sendiri cabangnya, arah `auth.branch_id`.**~~ —
   **TERGARAP**, lihat entri di atas. Rumusan mentahnya BERSIH (39 pembacaan:
   34 di dalam `terikatCabang`, 5 benar). Temuannya satu lapis di bawah: 8 dari
   15 pembacaan `?branch_id=` menyusun saringan sendiri tanpa memeriksa
   kepemilikan — termasuk operasi massal yang melaporkan sukses atas cabang yang
   tak ada. Ditemukan lebih dulu: pengupas komentarku sendiri buta di 7 salinan.
3. ~~**`api()` yang URL-nya dirakit di variabel.**~~ — **TERGARAP**, lihat
   entri di atas. Angka 22-nya cocok persis, tapi venanya BERSIH dan yang
   TEMUAN justru gerbangnya: ia menilai **13** dari 322 panggilan `api(`, dan
   pemetanya mengarang 4 jalur hantu sambil kehilangan 31 rute. Sesudah
   diperbaiki: **75** pemanggil dinilai, nol temuan perilaku.
4. ~~**Layar baru: target durasi per menu & laporan `/laporan/durasi-pesanan`
   di ponsel.**~~ — **TERGARAP SEPARUH**, lihat entri di atas. Laporannya
   dikerjakan (20 dari 20 kunci kontrak kini diurai, tab kelima di Laporan);
   penyetel target per menu **sengaja tidak** — `MenuHppPage` menulis batasnya
   sendiri ("Tambah/ubah menu tetap di web"), dan batas itu dipertahankan.
5. ~~**Server menerima `branch_id` di badan `/meja/tata-letak` lalu
   membuangnya.**~~ — **TERGARAP**, lihat entri di atas. 0 → **112 dari 114**
   badan JSON kini strict (2 dikecualikan, satu bertanggal). Suite yang sudah
   ada — bukan pengurai teks — menemukan **lima** ketidakcocokan nyata, dan
   pengurai teksku sendiri menuduh **enam** kali dengan salah.

### Antrean kedua — usulan #6–#10, dari celah yang ditulis entri di atas — 2026-08-24

Kelima usulan pertama tergarap. Antrean ini **tidak dikarang**: tiap entri di
berkas ini diwajibkan menulis batas detektornya sendiri (aturan 4), dan
baris-baris "Batas:" itulah bahannya. Angka di bawah **sudah diukur baca-saja**.

6. **SQL mentah — populasi yang belum pernah disapu satu kali pun.**
   Dua entri menuliskannya sebagai batas, dan pada satu di antaranya sebuah
   temuan **1,61 MB lolos karena itu** (*"Daftar tabelnya DITULIS TANGAN, dan
   `customers` tak ada di dalamnya"*). Populasi: **247** template `` sql`…` ``,
   **62** kueri lengkap, **19** situs `db.execute`, **29** tanpa sebutan
   `company_id`, **21** SELECT baris tanpa `LIMIT`.
   Kandidat hidup sudah bernama: `GET /penerimaan/anomali`
   (`penerimaan/routes.ts:447`) memulangkan SELURUH baris menggantung tanpa
   `LIMIT` lalu me-`reduce`-nya di JS — kelas yang vena "Balasan daftar tanpa
   langit-langit" tegakkan atas 147 select drizzle, tak terlihat olehnya karena
   raw SQL. Saudaranya `stok/service.ts:694` **sudah** berbatas, jadi aturannya
   ada; yang terbuka satu pintu. Kandidat kedua:
   `open-bill/backfill.ts:23` — `UPDATE` tanpa pengurungan `company_id`.
7. **Peta medan → kolom yang tak pernah ada.** *"Gerbangnya menuntut ADANYA
   `.max()`, bukan bahwa angkanya cocok dengan kolom tujuannya."* 13 konstanta
   di `batas-angka.ts` menyebut kolomnya **di komentar saja**; ~20 presisi
   `numeric(p,s)` berbeda di `schema.ts`. Ketiga belasnya cocok hari ini
   (diperiksa) — yang diusulkan **memakukannya**, memakai penelusur nilai dari
   usulan #3 untuk mengikuti `body.X` → `.values({ kolom: body.X })`.
   Kerusakannya sudah terukur sebelumnya: 1e12 lolos Zod lalu **500**.
8. **Rute yang tak pernah diukur latensinya — 401 dari 469.** *"Yang diukur
   RUTE BACA tanpa parameter jalur (68 dari 469)."* Alatnya sudah ada
   (`scripts/ukur-latensi.sh`, yang menolak mengukur sampai premisnya terbukti);
   yang kecil cakupannya. Jalur TULIS justru yang paling mahal, dan nol yang
   pernah diukur.
9. **Galat yang dibalas DI DALAM respons sukses.** Arah `c.json({error}, 4xx)`
   sudah kuukur dan **BERSIH**: 4 kemunculan, semuanya di penangan galat pusat,
   berbanding 454 `new HTTPException`. Yang terbuka arah sebelahnya — teks galat
   di dalam balasan **200** (`alasan`/`sebab` per baris), permukaan yang sudah
   terbukti membocorkan SQL mentah & UUID.
10. **Kunci JSON yang dibaca lewat variabel di ponsel** (`j[k]`). **Separuhnya
    baru tertutup**: arah badan-permintaan kini dijaga server (112 dari 114
    badan menolak kunci tak dikenal), jadi yang tersisa arah BACA saja.

## Antrean vena — belum tergarap

Diurut kasar menurut (kerusakan bila terjadi) × (peluang pola "pintu saudara"
berlaku di situ).

### Server
- [x] ~~**I/O jaringan di dalam `db.transaction`**~~ — BERSIH, lihat entri di atas
- [x] ~~**Loop tak berbatas di dalam `db.transaction`**~~ — TEMUAN, lihat entri
      "Larik badan permintaan tanpa batas atas" di atas
- [x] ~~**N round-trip di dalam transaksi, walau sudah berbatas**~~ — TEMUAN,
      lihat entri di atas. 1,47 dtk → 0,012 dtk
- [x] ~~**Balasan tanpa LIMIT**~~ — TEMUAN, lihat entri di atas.
      1,53 MB → 0,046 MB dan 2,83 MB → 0,042 MB
- [x] ~~**Riwayat harga per-item sepanjang masa**~~ — TEMUAN, lihat entri di
      atas. 2,098 MB → 0,053 MB, ketujuh angka statistiknya identik
- [x] ~~**Zod tanpa batas atas**~~ — TEMUAN, lihat entri di atas. 77 dari 109
      telanjang; 500 → 400 bernama, dan batas lama 1e12 ternyata kelebihan satu
- [x] ~~**`e.message` sampai ke klien**~~ — TEMUAN, lihat entri di atas. 5 dari
      453; 4 digerbang super admin (terukur 403), 1 bisa dicapai kasir
- [x] ~~**Uang ditulis di luar pembantu bersama**~~ — TEMUAN, lihat entri di
      atas. Server & web bersih; mobile menyimpang Rp1 pada lembar pembayaran
- [x] ~~**Batas laju di luar email**~~ — TEMUAN, lihat entri di atas. Laporan
      agregat ternyata murah (0,035 dtk atas 50.111 penjualan); yang terbuka
      `POST /upload` — 432 GB/jam dari satu akun kasir
- [x] ~~**Isi berkas unggahan tak pernah diperiksa**~~ — TEMUAN, lihat entri di
      atas. Akibatnya tertahan dua penjagaan hilir yang belum dijaga uji

### Basis data & migrasi
- [x] ~~**Kebijakan `ON DELETE`**~~ — BERSIH, lihat entri di atas. 68 FK NO
      ACTION, 9 induk; `users`/`branches` tak pernah dihapus kode
- [x] ~~**Kebijakan `SET NULL` (18 FK)**~~ — TEMUAN, lihat entri di atas. Bill
      yang sudah dibayar muncul lagi sebagai pesanan aktif sesudah sampah
      dikosongkan
- [x] ~~**CHECK yang hilang**~~ — BERSIH pada datanya, lihat entri di atas.
      Artefaknya `npm run audit:invarian` (26 invarian) yang CI jalankan
      SESUDAH verify-api
- [x] ~~**Indeks vs WHERE yang benar-benar dipakai**~~ — BERSIH, lihat entri di
      atas. Ikut meralat angka laporan pada vena "Batas laju di luar email"

### Web
- [x] ~~**Kunci React Query tanpa `branch_id`**~~ — kuncinya BERSIH (166/166),
      tapi arah sebelahnya TEMUAN: 7 pintu web + 6 mobile memanggil rute
      ber-`resolveBranchId` tanpa `branch_id` → 404, dan satu di antaranya
      **200 yang tak memindahkan apa pun**
- [x] ~~**Uang dihitung ulang di klien**~~ — BERSIH, lihat entri di atas.
      34 dari 203 render rupiah web lahir di layar; rantai uang kasir
      diadu dengan server lewat 10 penjualan sungguhan — 0 selisih
- [x] ~~**Invalidasi sesudah mutasi**~~ — TEMUAN, lihat entri di atas.
      Bukan lewat cakupan (70 tuduhan, semuanya sah) melainkan lewat ILUSI
      AWALAN: `["menu"]` tak pernah mengenai `["menu-riwayat-harga"]` —
      riwayat 3 → 4 baris di server, panelnya tetap 3

### Mobile
- [x] ~~**Enum status dibandingkan sebagai teks**~~ — BERSIH dua arah, lihat
      entri di atas. 156 perbandingan / 41 nilai diadu dengan 297 baris
      kontrak server; artefaknya tautan mekanis yang selama ini tak ada
- [x] ~~**Urutan pemutaran ulang antrean offline**~~ — TEMUAN, lihat entri
      di atas. Stempel ISO dibandingkan sebagai TEKS, dan `toIso8601String()`
      menulis 3 digit pecahan bila mikrodetiknya nol / 6 bila tidak →
      `shift_buka` bisa mendahului `absen_saya` (terukur: 400 vs 201)
- [x] ~~**Fitur lama pengerjaan pesanan**~~ — TEMUAN, lihat entri di atas.
      `durasi_detik` & `masuk_pada` dibuang mentah-mentah (terukur: server
      kirim 2 detik, ponsel tak menampilkan apa pun). Tersisa: target per
      menu & laporan durasi — keduanya LAYAR BARU, bukan medan tak terurai
