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

---

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
- [ ] **Batas laju di luar email** — ekspor, laporan agregat, unggah

### Basis data & migrasi
- [ ] **Kebijakan `ON DELETE`** tiap FK vs yang dilakukan kode saat induknya
      dihapus
- [ ] **CHECK yang hilang** untuk invarian yang diandaikan kode
- [ ] **Indeks vs WHERE yang benar-benar dipakai**

### Web
- [ ] **Kunci React Query tanpa `branch_id`**
- [ ] **Uang dihitung ulang di klien**, bukan lewat `@kakarut/shared`
- [ ] **Invalidasi sesudah mutasi**

### Mobile
- [ ] **Enum status dibandingkan sebagai teks**
- [ ] **Urutan pemutaran ulang antrean offline**
- [ ] **Fitur lama pengerjaan pesanan** — sudah tayang, belum diurai
