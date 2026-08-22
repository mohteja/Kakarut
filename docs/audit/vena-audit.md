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

---

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

---

## Antrean vena — belum tergarap

Diurut kasar menurut (kerusakan bila terjadi) × (peluang pola "pintu saudara"
berlaku di situ).

### Server
- [x] ~~**I/O jaringan di dalam `db.transaction`**~~ — BERSIH, lihat entri di atas
- [ ] **Loop tak berbatas di dalam `db.transaction`** — bahaya yang SAMA
      (menahan 1 dari 10 koneksi) tanpa jaringan: diukur ada **17** loop
      ber-`await tx.` di dalam badan transaksi. Yang perlu diperiksa: mana yang
      panjangnya ditentukan MASUKAN pemanggil dan tak berbatas atas
- [ ] **Balasan tanpa LIMIT** — `.select()` tanpa `.limit()` pada tabel yang
      tumbuh (`sales`, `sale_items`, kartu stok)
- [ ] **Zod tanpa batas atas** — tiap `z.number()` uang/qty tanpa `.max()`
- [ ] **`e.message` sampai ke klien** — sisa kelas kebocoran SQL mentah
- [ ] **Uang ditulis di luar pembantu bersama** — `sales.subtotal/total/
      pb1_amount` yang tak lewat `createSale`/`hitungUangSetelahRefund`
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
