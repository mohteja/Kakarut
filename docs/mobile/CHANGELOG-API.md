# 📱 Changelog API Terakasir — untuk Tim Mobile

Ringkasan **apa yang berubah di API server** per rilis, supaya tim mobile tidak
perlu membandingkan ulang seluruh `docs/API-CONTRACT.md` (2.300+ baris) setiap
kali menerima kiriman baru.

**Cara membaca:**

| Penanda | Artinya |
| --- | --- |
| 🔴 **WAJIB** | Aplikasi mobile yang sudah ada **akan salah/berbeda perilaku** bila tidak disesuaikan. Kerjakan sebelum rilis berikutnya. |
| 🟡 **PERLU DICEK** | Tidak merusak, tapi tampilan/asumsi lama bisa jadi keliru. Tinjau layar terkait. |
| 🟢 **BARU** | Kemampuan baru. Kerjakan bila fiturnya memang mau dibawa ke mobile. |
| ⚪️ **INFO** | Tidak menuntut perubahan kode. |

**Acuan lengkap tetap `docs/API-CONTRACT.md`** — dokumen ini hanya penunjuk
arah. Lampiran A pada dokumen itu adalah salinan utuh
`packages/shared/src/types.ts`, jadi definisi tipe selalu bisa dicek di sana
tanpa akses repo server.

---

## Rilis: Sesi menyusul perubahan peran (`/auth/me` + `branch`)

> **Menunggu rilis.** Tidak ada migrasi DB. Perubahan API **aditif**.

### 🔴 WAJIB — segarkan sesi dari `/api/auth/me`, jangan percaya sesi tersimpan

Bug yang baru kami perbaiki di web, dan **kemungkinan besar ada juga di mobile**
karena penyebabnya sama.

Peran & cabang karyawan bisa diubah admin **saat sesinya sedang berjalan**.
Token TIDAK dicabut saat itu (hanya reset password yang mencabut) dan memang
tidak perlu: `requireAuth` membaca ulang keanggotaan dari database pada **setiap**
request, jadi sisi server sudah langsung memakai peran baru. Yang basi hanyalah
**salinan sesi di perangkat** — dan menu/izin dibangun dari salinan itu.

Gejalanya persis seperti laporan yang kami terima: akun yang sudah dijadikan
`bar` tetap menampilkan menu peran lamanya (tanpa Produksi & Resep), dan
**memuat ulang aplikasi tidak menolong** karena sesi tersimpan ikut bertahan.
Satu-satunya jalan keluar sebelumnya: logout lalu login lagi.

**Yang perlu kalian lakukan:**

1. Panggil `GET /api/auth/me` **saat app dibuka** dan **tiap kali kembali ke
   foreground** (`AppLifecycleState.resumed`). Beri jeda minimum (kami pakai
   30 detik) supaya tidak jadi polling.
2. Timpakan `user` / `company` / `branch` dari respons ke sesi tersimpan.
   **`token` tidak berubah** — jangan ikut ditimpa/dihapus.
3. Bila `user.role` **atau** `user.branch_id` berbeda dari yang tersimpan:
   buang cache data lokal (termasuk ETag yang kalian simpan) dan bangun ulang
   menu/izin — cakupan datanya ikut berubah.
4. `401` dari `/auth/me` = keanggotaan dicabut/diarsip → hapus sesi, ke login.
   Ini juga menutup kasus karyawan yang sudah diarsip tapi aplikasinya masih
   terlihat "hidup".

### 🟢 BARU — `GET /api/auth/me` kini mengembalikan `branch`

Sebelumnya `{ user, company }`; sekarang `{ user, company, branch }` dengan
`branch: { id, nama } | null` — **bentuknya jadi sama persis dengan sesi login
minus `token`**, supaya bisa langsung ditimpakan tanpa mapping khusus.

```jsonc
// GET /api/auth/me
{
  "user": { "sub": "…", "email": "…", "nama": "…", "is_super_admin": false,
            "company_id": "…", "role": "bar", "branch_id": "…" },
  "company": { "id": "…", "nama": "…", /* … */ },
  "branch": { "id": "…", "nama": "Ahmad Yani - Garut" }   // ← BARU
}
```

Aditif: klien lama yang mengabaikan field ini tidak terpengaruh.

### ⚪️ INFO — peran diubah ≠ sesi dicabut

Sengaja begitu. Kalau setiap perubahan peran mencabut token, karyawan akan
terlempar ke layar login di tengah kerja. Yang kami pilih: token tetap sah,
otorisasi server ikut peran baru **seketika**, dan klien menyusul lewat
`/auth/me`. Yang mencabut token hanyalah **reset/ganti password**
(`token_version` naik → semua token lama jadi `401`).

---

## Rilis: Transfer stok hanya dari Central Kitchen

> **Sudah di production.** Tidak ada migrasi DB.

### 🔴 WAJIB — `POST /api/transfer-stok` kini **403** bila asal bukan Central Kitchen

Aturan arah stok dipersempit: **yang boleh MENGIRIM hanya Central Kitchen**.
Cabang — termasuk divisi `kitchen`/`bar` — hanya **melihat** kiriman yang
menuju ke sana, lalu menerimanya di `/penerimaan`.

Ditegakkan pada cabang **ASAL**, bukan pada peran. Artinya **owner pun ditolak**
saat mengirim dari toko:

```
POST /api/transfer-stok  { asal_branch_id: <toko>, ... }
→ 403 "Transfer stok hanya bisa dikirim DARI Central Kitchen — \"Pusat\" bukan Central Kitchen"
```

**Yang perlu kalian lakukan** bila punya layar Transfer Stok: batasi pilihan
cabang asal ke lokasi bertipe `central_kitchen` saja (`GET /api/cabang` →
`tipe === "central_kitchen"`). Kalau tak ada CK yang bisa dipakai pengguna itu,
sembunyikan formulir kirimnya dan tampilkan riwayat saja — jangan biarkan
tombol yang pasti gagal.

### 🟢 BARU — kasir sekarang boleh MEMBACA `/api/transfer-stok*`

Gerbang peran endpoint dilonggarkan sampai `cashier`. Sebelumnya kasir dapat
**403** di semua metode; kini `GET` berhasil (dibatasi cabangnya sendiri, sama
seperti peran terkunci lain). Kasir tetap **tidak bisa** membuat transfer —
cabangnya bukan CK.

Gunanya: kasir bisa melihat barang yang sedang menuju cabangnya tanpa harus
menunggu munculnya di Penerimaan.

### ⚪️ INFO — respons `304` hanya membawa sedikit header

Terkait ETag yang baru kalian pakai. Respons **304 dibangun ulang dari nol**
dan hanya menyisakan sekumpulan header standar (`cache-control`, `etag`,
`vary`, `date`, `expires`, `content-location`). **Header khusus tidak ikut**
kecuali sengaja dipasang ulang.

Kami sudah kena batunya: `X-Kakarut-Build` hilang pada 304, browser memakai
ulang nilai lama dari cache-nya, dan aplikasi web terus mengira ada versi baru
— dialog "ada pembaruan" berputar tanpa henti. Sudah diperbaiki (header itu
kini dipasang ulang di luar middleware ETag) dan dikunci uji.

**Untuk kalian:** kalau ada header khusus yang kalian baca dari respons
endpoint ber-ETag (`/menu`, `/kategori`, `/cabang`, `/meja`), jangan berasumsi
header itu ada saat `304`. Sebutkan header apa saja yang kalian andalkan —
kami pasang ulang seperti `X-Kakarut-Build`.

### ⚪️ INFO — keputusan produk: resep dibatasi per divisi

Di aplikasi web, peran pelaksana kini hanya melihat resep yang **mereka**
produksi: bar → resep bar, kitchen → resep kitchen, kru CK → resep CK.
Owner/admin tetap melihat semua.

**Server tidak berubah** — `GET /api/bahan` tetap mengembalikan seluruh bahan,
karena endpoint yang sama dipakai layar Stok/Opname/Penerimaan yang memang
butuh daftar penuh. Jadi kalau mobile punya layar Resep, penyaringannya perlu
dikerjakan di sisi klien memakai `produksi_di` + `divisi_produksi` pada
`BahanDto`, supaya perilakunya sama dengan web.

---

## Rilis: Penjualan offline yang tak menemukan shift cocok

> **Sudah di production.** Penahan rilis aplikasi mobile untuk bagian ini sudah
> lepas.
>
> Menjawab dokumen kalian *"Untuk tim backend — penjualan offline yang tak
> menemukan shift cocok"*. **Opsi A dikerjakan.** Migrasi DB: `0080`
> (menambah `sales.shift_id`).

### ⚪️ INFO — koreksi premis: dulu TIDAK ada penautan sale↔shift

Dokumen kalian menulis "sale ditautkan ke shift". Sebelum rilis ini itu tidak
benar: `sales` tak punya kolom shift sama sekali — hubungannya **disimpulkan
dari waktu** (`rekapWindow` menyaring `waktu BETWEEN dibuka_pada AND
ditutup_pada`). Akibatnya Opsi A tak bisa dikerjakan sebagai perubahan kecil di
`/sync`: menautkan sale jam 20.45 ke shift yang ditutup 20.30 tetap **tidak**
memasukkannya ke rekap, dan `ada_transaksi_susulan:true` akan jadi penanda
bohong. Karena itu kolom **`sales.shift_id`** ditambahkan supaya penautannya
nyata. Baris lama tetap dihitung lewat jendela waktu (tidak perlu backfill,
tidak ada hitung ganda).

### 🟢 BARU — fallback shift: 409 itu hilang untuk kasus kalian

`POST /api/sync` `tipe:"penjualan"` sekarang mencari shift dua tahap:

1. shift yang jendelanya memuat `waktu` (seperti dulu), **plus toleransi 5
   menit di sisi buka** untuk jam perangkat yang mundur;
2. bila tak ada — shift terakhir cabang itu yang **ditutup paling dekat sebelum
   `waktu`**, syarat `waktu ≤ ditutup_pada + 6 jam` **DAN** tanggal bisnis sama
   (zona waktu perusahaan).

Sale masuk lewat jalur 2 tetap **ikut terhitung di rekap & selisih kas** shift
itu. Skenario kalian (tutup 20.30, jual 20.45) kini `status:"ok"`.

### 🟢 BARU — `data` hasil `penjualan` membawa konteks shift

```jsonc
{ "status": "ok", "kode": 201, "data": {
    "shift": { "id": "…", "dibuka_pada": "…", "ditutup_pada": "…" },
    "ada_transaksi_susulan": true,
    "di_luar_jendela_shift": true   // dibukukan lewat toleransi jalur 2
}}
```

Pakai `di_luar_jendela_shift` untuk memunculkan "transaksi masuk ke shift yang
sudah ditutup — periksa selisih kas", bukan diam-diam sukses.

**Yang TIDAK bisa kami penuhi:** `nomor` shift. Tabel `shifts` tidak punya
kolom nomor — tidak ada "SH-0142" di sistem ini. Shift dikenali lewat `id` +
`dibuka_pada`/`ditutup_pada`. Kalau kalian butuh label pendek, bilang; itu
fitur baru (penomoran shift), bukan penambahan field.

### 🟢 BARU — `shift_buka` bisa diantre offline

Konsekuensi dari merapatkan snapshot jadi 6 jam: pemadaman panjang berarti nol
transaksi, karena `POST /shift/buka` online-only. `shift_buka` kini tipe sync:

```jsonc
{ "client_ref": "…", "tipe": "shift_buka", "waktu": "2026-03-10T01:00:00Z",
  "payload": { "modal_awal": 250000 } }   // branch_id opsional
```

`waktu` jadi **`opened_at`** — bukan jam sinkron. Shift yang dibuka 08.00 lalu
disinkron 20.00 membuat seluruh penjualan hari itu jatuh di dalam jendelanya
secara wajar, **tanpa** menyentuh toleransi 6 jam sama sekali. Itu jalur yang
kami sarankan untuk pemadaman panjang.

- **Gerbang absen tetap ada**, dinilai pada **tanggal bisnis `waktu`** (bukan
  hari sinkron). Kirim `absen_saya` lebih dulu dalam batch yang sama — perintah
  dieksekusi berurutan. Belum absen di tanggal itu → **gagal 400**.
- **Sudah ada shift terbuka** (manajer membukanya lewat web) → **tetap `ok`**,
  membalas shift yang ADA + `data.sudah_terbuka:true`, tidak membuat shift
  kedua. Sengaja tidak digagalkan supaya penjualan yang bersandar padanya tak
  kehilangan tempat berpijak.
- `data` = DTO `Shift` + `sudah_terbuka`.

**`shift_tutup` TIDAK dibuka untuk sync** — `closed_at` memakai jam server,
jadi menutup lewat sync akan mencatat jam yang salah. Shift yang dibuka offline
tetap terbuka sampai ditutup online; itu justru lebih benar karena jam tutup
mengikuti kapan kasir benar-benar mengakhiri.

### 🟡 PERLU DICEK — 409 kini membawa `sebab` + `data`

`SyncItemResult` bertambah **`sebab?: string`**. Saat `penjualan` benar-benar
tak menemukan shift:

```jsonc
{ "status": "gagal", "kode": 409, "error": "Tidak ada shift kasir yang mencakup waktu transaksi ini",
  "sebab": "shift_tidak_cocok",
  "data": { "shift_terdekat": { "id": "…", "dibuka_pada": "…", "ditutup_pada": "…" } } }
```

`shift_terdekat` bernilai `null` bila memang tak ada shift sebelum `waktu`.
Penolakan tersimpan dibalas **utuh** saat retry (`status:"sudah_ada"` + `sebab`
+ `data`), jadi konteksnya tidak hilang. Opsi B poin 2 (`shift_id` opsional di
`SaleBody`) **tidak** dikerjakan — dengan Opsi A jalan, tidak ada lagi kasus
yang butuh kasir memilih shift manual.

### ⚪️ INFO — `sudah_ada` pada item SUKSES membalas `data` UTUH

Berlaku untuk **semua** tipe, bukan hanya kegagalan. Retry `penjualan` membawa
`shift` + `ada_transaksi_susulan` + `di_luar_jendela_shift`; retry `shift_buka`
membawa DTO shift + `sudah_terbuka` + `modal_awal`. Jadi peringatan kalian
("masuk ke shift yang sudah ditutup", "modal awal tidak dipakai") tetap muncul
walau perangkat mati tepat setelah server membukukan.

**Satu hal yang perlu diperhatikan:** yang dibalas adalah **hasil saat perintah
dieksekusi**, bukan penilaian ulang keadaan sekarang. Retry `shift_buka` yang
dulu benar-benar membuat shift tetap membalas `sudah_terbuka:false`, walau
sekarang shift itu memang sudah terbuka. Itu memang semantik idempotensi yang
benar — jangan diperlakukan sebagai keadaan terkini.

Perilaku ini dikunci uji (`verify-api` §137 & §138), jadi penyempitan payload di
kemudian hari akan ketahuan, bukan menghilangkan peringatan kalian diam-diam.

### 🟢 BARU — batas usia `waktu` jadi per tipe

`penjualan` **30 hari** (naik dari 7), tipe lain tetap **7 hari**. Sesuai usul
kalian: perangkat cadangan / outlet event yang offline berminggu-minggu tak
lagi kehilangan seluruh antreannya. Lewat batas tetap **gagal 400**.

### ⚪️ INFO — jawaban pertanyaan §2 kalian

Batas jendela shift **inklusif di kedua ujung** (`dibuka_pada ≤ waktu ≤
ditutup_pada`). `waktu` yang jatuh **sebelum** shift pertama hari itu: dulu
409, sekarang masih 409 **kecuali** selisihnya ≤ 5 menit (toleransi jam
perangkat mundur yang kalian sebut) — di luar itu tetap ditolak, karena
fallback hanya melihat ke belakang ke shift yang sudah ditutup.

### ⚪️ INFO — `ShiftTransaksiRow` bertambah `susulan`

`GET /api/shift/:id` → tiap baris `transaksi` kini punya `susulan: boolean`
(true = masuk setelah shift ditutup). Field tambahan, tidak merusak.

### 🟢 BARU — ETag / `304 Not Modified` pada endpoint daftar master data

Menjawab usulan kalian: revalidasi latar tak perlu lagi menarik badan penuh
setiap kali cache disajikan saat sinyal jelek.

Berlaku untuk **`GET /menu`, `/kategori`, `/cabang`, `/meja`** — dan hanya itu.
Setiap `200` membawa `ETag`; kirim balik sebagai `If-None-Match` → **`304` tanpa
badan** bila belum ada perubahan.

| Hal | Nilai |
| --- | --- |
| Header respons tambahan | `ETag`, `Cache-Control: private, no-cache`, `Vary: Authorization` |
| Klien lama (tanpa `If-None-Match`) | `200` berbadan, persis seperti sebelumnya |
| Urutan rilis | **tidak mengikat** — boleh naik & dipakai kapan saja |
| Saat badan ter-gzip | ETag jadi `W/"…"`; pencocokan mengabaikan awalan `W/`, kirim balik apa adanya |

**Kunci penyimpanan ETag harus memuat query string** — `/menu` dan `/meja`
disaring `?branch_id=`, jadi satu kunci global akan menyilangkan data
antar-cabang.

**Batasnya jujur:** yang dihemat hanya byte di kabel. Digest dihitung dari badan
respons yang sudah jadi, jadi query DB tetap berjalan penuh. `304` = "server
bekerja lalu tidak mengirim", bukan "server menjawab tanpa bekerja".

**`/menu/ketersediaan` sengaja TIDAK ber-ETag** — isinya berubah tiap penjualan,
jadi digest-nya nyaris tak pernah cocok dan hanya menambah kerja.

**Soal urutan field JSON yang kalian ingatkan:** benar, dan bukan hipotetis di
sini. Tiga tempat diperbaiki bersama rilis ini — `komponen` dan `branch_ids`
pada `/menu` dibangun dari query **tanpa `ORDER BY`**, dan `/cabang` diurut
`created_at` yang identik untuk cabang-cabang yang dibuat dalam satu transaksi.
Semua query daftar kini punya pemutus seri. verify-api §139 mengunci sifat itu
dengan membandingkan ETag enam permintaan beruntun per endpoint, supaya
kegoyahan urutan gagal di CI alih-alih menyamar jadi "hit rate rendah".

---

## Rilis: Transfer Stok + perbaikan integritas stok

> **Status:** menunggu rilis (PR #114). Endpoint di bawah **belum ada di
> production** sampai PR tersebut di-merge — koordinasikan dulu sebelum mulai
> mengerjakan bagian 🟢.
>
> **Baseline:** perubahan di bawah dihitung dari kontrak sebelum PR #114.
> Migrasi DB yang menyertainya: `0079` (menambah jenis dokumen `transfer`).

### 🔴 WAJIB — `RencanaBahanRow.saldo_ck` berubah arti

Sebelumnya field ini berisi **saldo fisik** Central Kitchen. Sekarang berisi
**stok CK yang benar-benar bisa dijanjikan** ke cabang, yaitu:

```
saldo_ck = saldo fisik CK − barang yang sudah dikirim tapi belum diterima cabang mana pun
```

Akibatnya angka yang muncul **bisa lebih kecil dari sebelumnya**, dan itu benar.
Kalau layar mobile menampilkan field ini dengan label "stok CK", ganti labelnya
jadi sesuatu seperti **"siap dikirim"** atau **"tersedia di CK"** — kalau tetap
ditulis "stok CK", angkanya akan terlihat tidak cocok dengan halaman Stok CK
(yang memang menampilkan saldo fisik, termasuk barang di jalan).

Alasannya: saldo asal sengaja baru berkurang saat cabang tujuan mengonfirmasi
penerimaan (supaya barang di jalan tidak hilang dari pembukuan). Karena itu
saldo mentah tidak boleh dipakai sebagai batas pengiriman baru — kalau dipakai,
stok yang sama bisa dijanjikan ke dua permintaan dan saldo CK jadi minus.

### 🔴 WAJIB — `kirim` pada respons rencana bisa `null` di kondisi yang dulu terisi

Endpoint: `POST /api/rekomendasi/menu/faktur`

Karena aturan di atas, perencana kini bisa mengambil keputusan berbeda:
permintaan kedua yang dulu direncanakan **"tinggal kirim dari CK"** sekarang
dialihkan menjadi **work-order produksi** bila stok CK sudah habis dijanjikan.

Praktisnya: **jangan asumsikan `kirim` selalu ada** ketika stok CK terlihat
cukup. Tangani ketiga kemungkinan (`kirim`, `produksi`, `beli`) secara
independen — masing-masing bisa `null`.

### 🟡 PERLU DICEK — pesan error baru saat mengirim stok

Endpoint: `POST /api/produksi/kirim/:fakturId` dan
`POST /api/produksi/kirim-hasil/:fakturId`

Bisa menolak dengan **400** dan pesan seperti:

> `Stok CK tidak cukup untuk daging uji66 (tersedia 0 gr, 2500 masih dalam perjalanan ke cabang lain) — kurangi jumlah kiriman`

Pesan ini sudah menjelaskan sebab **dan** solusinya, jadi **tampilkan apa
adanya** ke pengguna. Jangan diganti dengan pesan generik semacam "gagal
mengirim" — pengguna tidak akan tahu barangnya sebenarnya sedang di jalan.

### 🟡 PERLU DICEK — `GET /api/produksi` tidak lagi memuat faktur transfer

Faktur bernomor **TF-** (Transfer Stok) memakai tabel yang sama dengan produksi,
tetapi bukan pekerjaan produksi — kini disaring keluar dari daftar dan dari
hitungan badge `/api/produksi`.

Kalau mobile menampilkan jumlah pekerjaan produksi, angkanya bisa **turun**
setelah rilis ini. Itu perbaikan, bukan data hilang: faktur transfer tetap
terlihat di `/api/transfer-stok` dan `/api/penerimaan`.

### 🟡 PERLU DICEK — faktur TF- masuk ke layar Penerimaan yang sudah ada

Endpoint: `GET /api/penerimaan?branch_id=`

Kiriman transfer **otomatis muncul** di sini tanpa perubahan kode di mobile —
alur terima/tolak yang sudah ada langsung bekerja. Yang perlu disesuaikan hanya
tampilannya: bedakan nomor **TF-** (transfer manual/ad-hoc) dari **PR-**
(kiriman dari Permintaan Stok), supaya kasir tahu asal-usul barangnya.

Kasir **tidak** bisa membuat transfer, tapi tetap bisa menerimanya. *(Diperbarui
di rilis "Transfer stok hanya dari Central Kitchen": kasir kini juga boleh
**membaca** `/api/transfer-stok`, dan yang boleh mengirim hanya CK.)*

### 🟢 BARU — Transfer Stok (4 endpoint)

Memindahkan stok yang **sudah ada (ready)** antar lokasi (CK↔cabang atau
cabang↔cabang) dalam satu faktur multi bahan, nomor **TF-**. Contoh kasus:
barang kiriman rusak di jalan lalu perlu dikirim ulang dari CK.

Gerbang peran: **owner, admin, tim, kitchen, bar** (kasir tidak). Peran yang
terkunci cabang hanya boleh mengirim **dari cabangnya sendiri**.

| Endpoint | Guna |
| --- | --- |
| `GET /api/transfer-stok/saldo?branch_id=` | Isi pemilih bahan + batas qty. Hanya bahan yang **masih tersisa** (`saldo − dalam_jalan > 0`) |
| `GET /api/transfer-stok?per_page=` | Riwayat faktur transfer (terbaru dulu), per faktur beserta `items[]` |
| `POST /api/transfer-stok` | Kirim transfer → **201** `{ ok, faktur_id, nomor, asal, tujuan, jumlah_baris }` |
| `POST /api/transfer-stok/:fakturId/batal` | Batalkan selagi belum diproses tujuan |

Tipe baru di Lampiran A: `TransferStokSaldoRow`, `TransferStokItemRow`,
`TransferStokFaktur`.

**Dua hal yang wajib ditiru kalau layar ini dibuat di mobile:**

1. **Batas jumlah kirim adalah `saldo − dalam_jalan`, bukan `saldo`.** Field
   `saldo` adalah stok fisik (termasuk barang di jalan) dan `dalam_jalan` adalah
   yang sudah dijanjikan keluar. Tampilkan angka tersedia = selisihnya, dan beri
   catatan kecil "N dalam perjalanan" bila `dalam_jalan > 0`. Server tetap
   menolak dengan 400 kalau dilanggar, tapi lebih baik dicegah di form.
2. **Tandai jenis bahan.** Tiap baris membawa `pengadaan` (`"beli"` /
   `"produksi"`). Ini permintaan eksplisit dari sisi bisnis: tabel harus jelas
   mana bahan yang dibeli jadi dan mana yang diproduksi sendiri.

Kode error: **400** (asal = tujuan; asal/tujuan Kantor; bahan tidak valid,
nonaktif, atau tidak melacak stok; qty melebihi yang tersedia), **403** (peran
terkunci mengirim dari cabang lain), **404** (cabang/faktur tidak ditemukan),
**409** (membatalkan transfer yang sudah diproses tujuan).

### ⚪️ INFO — Transfer Stok belum bisa diantrekan offline

Antrean offline `POST /api/sync` baru menerima jalur **`produksi`** dan
**`pembelian`**. Transfer Stok **belum** termasuk, jadi fitur ini butuh koneksi.
Bila mobile membutuhkannya offline, itu pekerjaan tambahan di sisi server —
sampaikan supaya bisa dijadwalkan.

### ⚪️ INFO — jenis dokumen baru `transfer`

Migrasi `0079` menambah nilai `transfer` pada enum `dokumen_jenis`, dengan
prefiks nomor **TF-**. Ini pembeda tegas antara faktur transfer dan kiriman
jalur lain. Tidak ada yang perlu diubah di mobile; disebutkan agar penomoran
`TF-xxxx` tidak dikira anomali.

---

## Cara memelihara berkas ini

Tambahkan satu bagian **Rilis** baru di atas setiap kali ada perubahan API yang
dikirim ke tim mobile, dengan urutan yang sama: 🔴 WAJIB lebih dulu, lalu 🟡, 🟢,
⚪️. Sebutkan juga nomor migrasi DB bila ada, supaya jelas rilis server mana yang
dibutuhkan.

Untuk perubahan yang mengubah **arti** sebuah field (bukan menambah field baru),
selalu tulis rumus atau definisi barunya secara eksplisit — jenis perubahan itu
yang paling sering lolos dari review karena bentuk JSON-nya tidak berubah.
