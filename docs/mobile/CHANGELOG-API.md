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

**Status rilis:** setiap entri diawali baris **"Sudah di-merge ke production"**
begitu tayang. Entri **tanpa** baris itu berarti belum tayang — mobile boleh
menundanya. Baris ini wajib ada di setiap entri; kalau hilang, mobile akan
mengira fitur yang sudah aktif belum bisa dipakai.

**Acuan lengkap tetap `docs/API-CONTRACT.md`** — dokumen ini hanya penunjuk
arah. Lampiran A pada dokumen itu adalah salinan utuh
`packages/shared/src/types.ts`, jadi definisi tipe selalu bisa dicek di sana
tanpa akses repo server.

---

## Rilis: Sajian batal tidak ditagih + refund sebagian per sajian

> Belum di-merge ke production. **Ada migrasi DB** (`0093`, seluruhnya aditif:
> `sale_refunds`, `sale_items.qty_refund`, `sales.subtotal_asal/diskon_asal/
> pb1_asal/refund_total`).

### 🔴 WAJIB — baris bill berstatus `batal` **tidak boleh ditagih**

`OpenBillItemDto` bertambah `pesanan_status: PesananStatus`. Baris yang dapur
tandai `batal` **tak jadi dibuat** — di lapangan sebabnya bahannya ternyata
habis — jadi pembeli tidak boleh membayarnya.

Barisnya **tetap harus ikut** di `PUT /open-bill/:id` (menghilangkannya ditolak
server, dan jejak pembatalannya ikut lenyap), tapi **keluar** dari subtotal,
struk, dan payload `POST /penjualan`. Pisahkan dua daftar: satu utuh untuk PUT,
satu tersaring untuk uang. Server versi lama tidak mengirim field ini —
perlakukan `null` sebagai "normal", jangan sampai seluruh bill mendadak gratis.

Sudah dikerjakan di klien Flutter (`CartState.linesTagih`).

### 🔴 WAJIB — kirim `client_ref` pada refund, dan PAKAI ULANG saat mencoba lagi

Refund yang terkirim dua kali **mengembalikan uang dua kali**. Pagar "melebihi
sisa porsi" tidak menolong: selama masih ada porsi tersisa, permintaan kedua sah
menurut aturan dan langsung dijalankan.

Buat kuncinya **sekali** saat tombol pertama ditekan, lalu pakai kunci yang sama
di tiap percobaan. Membuat kunci baru tiap percobaan sama saja dengan tidak
mengirimnya — justru percobaan KEDUA-lah yang harus membawa kunci yang sama.
Sudah dikerjakan di klien Flutter (`_RefundSheetState._clientRef`).

### 🟢 BARU — `POST /api/penjualan/:id/refund` (kasir boleh)

Untuk transaksi yang **sudah dibayar** lalu ketahuan bahannya habis. Kasir boleh
melakukannya sendiri — pembelinya sedang berdiri di depan kasir — dan tiap
refund menyimpan siapa, kapan, berapa, serta alasannya.

Req `{ alasan?, items: [{ sale_item_id, qty }] }` → res `{ ok, nominal,
total_lama, total_baru }`. Rincian lengkap di `docs/API-CONTRACT.md` §7.

### 🔴 WAJIB — layar yang menampilkan `GET /api/penjualan/:id` harus memakai `qty − qty_refund`

Ini bagian yang paling mudah terlewat. `sale_items.qty` **tidak** dikurangi saat
refund (berapa yang dipesan dan berapa yang dikembalikan adalah dua fakta
berbeda), dan `line_total` juga masih nilai asal. Sementara itu
`sales.subtotal/total` **sudah** menyusut.

Artinya: layar yang masih menjumlahkan `line_total` akan menampilkan struk yang
bertentangan dengan totalnya sendiri. Hitung ulang dari
`harga_satuan × (qty − qty_refund)`, dan tampilkan porsi yang dikembalikan
sebagai keterangan supaya pembeli bisa mencocokkan dengan struk lamanya.

Juga: `nominal` **bukan** `harga_satuan × qty` — bagian diskon & PB1 milik porsi
itu ikut kembali. Jangan menghitungnya sendiri.

### 🔴 WAJIB — papan pesanan: `PesananItemRow.qty` kini porsi yang DITAGIH

`GET /api/pesanan` → tiap `items[]` bertambah **`qty_refund: number`**, dan
**`qty` sudah dikurangi olehnya** (`qty − qty_refund`, minimal 0). Untuk baris
open bill `qty_refund` selalu `0` — billnya belum dibayar, jadi belum ada uang
yang bisa dikembalikan.

Papan ini lembar perintah dapur. Sajian yang uangnya sudah dikembalikan tak
jadi dibuat — bahannya habis, itu justru sebab refundnya — jadi menampilkan
porsi mentahnya menyuruh dapur memasak sesuatu yang sudah dibatalkan dan tidak
dibayar siapa pun.

Yang perlu dikerjakan mobile: **jangan** menghitung ulang `qty` dari sumber
lain, dan tampilkan keterangan bila `qty_refund > 0` — kalau tidak, angka yang
menyusut sendiri akan terbaca seperti kesalahan sistem. Web menuliskannya
`↩ N porsi dikembalikan — jangan dibuat`, dan mencoret baris yang `qty`-nya
tinggal 0. Status barisnya sengaja TIDAK ikut berubah jadi `batal`: status
adalah catatan dapur, bukan turunan uang.

### 🟡 PERLU DICEK — struk termal: baris "Sudah dikembalikan"

`ReceiptData` (di `@kakarut/shared`, dipakai bersama untuk ESC/POS) bertambah
`refundTotal?: number | null`. Bila > 0, satu baris `Sudah dikembalikan`
dicetak PERSIS SESUDAH `TOTAL`; bila 0/null/undefined barisnya tak ada sama
sekali, jadi struk lama tak berubah.

Kalau mobile merakit `ReceiptData` sendiri, isi field ini dari
`sales.refund_total`. Tanpa itu, cetak ulang sesudah refund hanya menampilkan
porsi & total yang lebih kecil dari struk asli di tangan pembeli — dua kertas
berbeda angka, tak satu pun menjelaskan sebabnya. Cetak ulang justru dipakai
saat ada perselisihan.

### ⚪️ INFO — laporan & rekap shift kini sadar refund

Tidak ada perubahan bentuk respons; hanya **angkanya** yang kini benar sesudah
ada refund. Kalau mobile pernah menghitung ulang salah satu dari ini sendiri
dari data mentah, samakan sekarang:

- `GET /laporan` (`item_terjual[]`) dan `GET /laporan/menu-laris` menghitung
  porsi sebagai `qty − qty_refund`, omzetnya `harga_satuan ×` porsi itu. Dulu
  memakai `qty`/`line_total` mentah, sehingga rincian per menu berselisih dengan
  `omzet` di respons yang sama persis sebesar refundnya — dan menu yang bahannya
  habis justru naik peringkat "terlaris".
- `GET /laporan/bep` ikut memakai porsi & HPP yang ditagih.
- `GET /shift/aktif` & `GET /shift/:id`: refund dihitung pada shift **tempat
  uangnya keluar laci**, bukan shift transaksi aslinya. Rekap shift yang sudah
  ditutup tidak lagi bergeser sendiri ketika transaksinya direfund berhari-hari
  kemudian. Untuk refund pada shift yang sama, angkanya tidak berubah.

---

## Rilis: Terima barang hanya lewat Penerimaan + jejak "diterima oleh siapa"

> Belum di-merge ke production. Tidak ada migrasi DB.

### 🔴 WAJIB — `POST /{mod}/tahap` dengan `ke:"dikonfirmasi"` kini **409** untuk kiriman beralamat cabang

Selama ini ada dua jalan menutup satu kiriman: tombol Terima di Penerimaan
Barang, dan "Ubah Tahap" langsung ke `dikonfirmasi`. Jalan kedua memasukkan stok
**tanpa** ada orang di cabang yang benar-benar memegang barangnya. Saat
kirimannya kurang atau rusak, pembukuan berkata "diterima" sementara tak ada
satu nama pun yang bisa ditanya.

Sekarang satu pintu saja. Baris yang punya `tujuan_branch_id` (termasuk
`tujuan_branch_id` yang baru ikut dikirim di permintaan yang sama, supaya
"pindahkan sekaligus konfirmasi" tak menyelinap lewat) ditolak dengan **409**:

> Kiriman beralamat ke cabang tidak bisa dikonfirmasi dari sini — barangnya
> harus DITERIMA di menu Penerimaan Barang oleh orang di cabang tujuan

Aturannya persis sama dengan `POST /{mod}/konfirmasi/:fakturId`, yang sudah
menolak dengan 409 sejak rilis sebelumnya.

**Yang perlu dikerjakan mobile:** layar Ubah Tahap tidak boleh lagi menawarkan
"Dikonfirmasi" untuk faktur ber-`tujuan_branch_id`; arahkan ke Penerimaan
Barang. Bila tombolnya telanjur ada, tangani 409 dengan menampilkan pesannya apa
adanya — pesannya sudah menyebutkan ke mana harus pergi.

Yang **tidak** berubah: faktur yang tinggal di cabangnya sendiri
(`tujuan_branch_id` kosong atau sama dengan `branch_id`) tetap bisa dikonfirmasi
lewat Ubah Tahap seperti biasa.

### 🟢 BARU — `diterima_oleh` + `diterima_pada` di tiap baris `GET /{mod}`

Dua kolom baru pada baris faktur beli & produksi: `diterima_oleh` (nama orang
yang menerima) dan `diterima_pada` (waktunya). Keduanya berasal dari
`confirmed_by`/`confirmed_at`.

Karena perubahan di atas menutup semua jalan lain, untuk barang beralamat cabang
kolom ini **hanya** bisa terisi lewat tombol Terima — jadi nilainya bisa
dipercaya sebagai bukti penerimaan, dan kosongnya berarti barang itu memang
belum diterima siapa pun. (Untuk faktur CK-lokal yang masuk stok sendiri,
isinya adalah orang yang memajukan tahapnya.)

Satu faktur bisa diterima bertahap; bila ingin menampilkan satu nama per faktur,
ambil baris dengan `diterima_pada` **paling akhir**. Jejak per-faktur yang lebih
lengkap tetap ada di `GET /penerimaan/riwayat`.

---

## Rilis: Riwayat penerimaan barang (per faktur)

> Belum di-merge ke production. Tidak ada migrasi DB.

### 🟢 BARU — `GET /penerimaan/riwayat`: jejak kiriman yang sudah diterima/ditolak

`GET /api/penerimaan` sengaja hanya memuat yang BELUM selesai. Akibatnya begitu
sebuah kiriman diterima, kartunya lenyap tanpa jejak — tak ada catatan kapan
diterima, oleh siapa, dan berapa yang benar-benar masuk dibanding yang dikirim.
Padahal justru itu yang dicari saat stok tak cocok.

Query: `branch_id?` (atau `all`), `dari?`/`sampai?` (`YYYY-MM-DD`), `page?`
(default 1), `per_page?` (default 20, maks 100).
Res: `{ rows: RiwayatPenerimaanFaktur[], total, page, per_page }`.

**Satu entri = SATU FAKTUR**, satuan yang sama dengan daftar Menunggu — orang
gudang tak perlu berpindah cara pandang saat mencocokkan surat jalan. Tiap entri
membawa `nomor` (PB-/PR-/TF-), `waktu` (keputusan terakhir), `oleh` (penerima),
`hasil` (`diterima` / `sebagian` / `ditolak`), dan `items[]` dengan qty yang
benar-benar diterima **plus** `qty_dipesan` (yang dikirim) — selisih itulah yang
dicari orang.

Dua hal yang mudah keliru saat memakainya:

1. **Halaman dipotong per FAKTUR, bukan per baris.** Jangan hitung `total`
   sebagai jumlah barang; ia jumlah surat jalan.
2. **`dari`/`sampai` menyaring SAAT DIPUTUSKAN**, bukan tanggal faktur dibuat.
   Orang mencari "penerimaan minggu lalu" berdasarkan kapan mereka menerimanya.

### 🟡 PERLU DICEK — `GET /absensi/rekap?status=arsip` sempat kehilangan baris

Batas bulannya dulu dihitung pada tengah malam **UTC**, padahal seluruh endpoint
itu bekerja dalam zona perusahaan. Untuk WIB (UTC+7) keduanya berselisih 7 jam,
jadi karyawan yang diarsipkan antara **00:00–07:00** waktu setempat pada tanggal
1 dianggap "keluar bulan lalu" dan hilang dari rekap arsip bulan itu. Sudah
diperbaiki — tak ada perubahan bentuk respons, hanya barisnya jadi lengkap.

---

## Rilis: Kiriman antar-cabang — "sudah kirim tapi tak sampai" ditutup

> **Sudah di-merge ke production** (PR #137, 31 Jul 2026). Tidak ada migrasi DB.

### 🔴 WAJIB — `POST /{mod}/konfirmasi/:fakturId` kini **409** untuk kiriman beralamat

**Bug yang diperbaiki.** Satu baris kiriman membawa dua keterangan yang harus
dibaca bersama: `branch_id` ("barang ini sekarang ada di mana") dan
`tujuan_branch_id` ("alamatnya ke mana"). Layar Penerimaan cabang hanya
menampilkan kiriman yang **keduanya sama**.

Dari lima pintu kirim yang ada, satu — **Ubah Tahap** (`POST /{mod}/tahap`
dengan `tujuan_branch_id`) — memindahkan `branch_id` **tanpa** memperbarui
`tujuan_branch_id`. Kardusnya berpindah, alamatnya tertinggal. Akibatnya faktur
berbunyi "Dikirim", tapi tak satu pun layar bisa menerimanya: `GET /penerimaan`
cabang tujuan kosong, dan stok cabang tak pernah bertambah. Korban utamanya
jalur **produksi** (alamatnya jadi kosong sama sekali). Barangnya hilang dari
pembukuan tanpa satu pun galat.

Sekarang keduanya selalu berpindah bersama. Konsekuensi yang menyentuh mobile:

- Sesudah dikirim lewat `POST /{mod}/tahap` + `tujuan_branch_id`, baris itu
  **muncul di `GET /penerimaan`** cabang tujuan dan berstatus `menunggu`.
- `POST /{mod}/konfirmasi/:fakturId` **menolak** faktur beralamat dengan
  **409** (dulu jalur beli lolos diam-diam, dan stoknya masuk tanpa ada yang
  menerima). Selesaikan lewat `POST /penerimaan/:fakturId/terima`.
  **Satu barang, satu pintu.**
- Stok cabang tujuan baru bertambah **saat diterima**, bukan saat dikirim.

**Yang perlu tim mobile lakukan:** kalau layar kalian memanggil
`/{mod}/konfirmasi` untuk faktur yang punya `tujuan_branch_id`, ganti ke
`/penerimaan/:fakturId/terima`. Tangani **409** dengan menunjukkan pesannya apa
adanya — ia sudah menjelaskan harus lewat Penerimaan.

### 🟢 BARU — `GET /penerimaan/anomali`: pendeteksi kiriman menggantung

Res: `{ jumlah, qty_total, rows: [{id, faktur_id, tipe, status, qty, waktu,
bahan, satuan, posisi_sekarang, dikirim_dari, umur_hari}] }`.

Memuat barang yang **sudah berpindah cabang tapi tak bisa diterima siapa pun**.
**Nilai sehatnya `jumlah: 0`** — apa pun di atas nol berarti ada barang yang
hilang dari pembukuan dan perlu ditangani manusia.

Yang **belum** dikirim (masih di cabang asalnya) sengaja tidak muncul: kalau ikut
ditampilkan, cabang bisa "menerima" barang yang fisiknya masih di rak pengirim.
Peran terkunci cabang hanya melihat yang mendarat di cabangnya sendiri — mereka
justru yang paling berguna melihatnya, kardusnya ada di rak mereka.

Cocok dijadikan lencana peringatan di layar Penerimaan; kalau `jumlah` 0
(keadaan normal), jangan tampilkan apa pun.

### 🟢 BARU — `POST /penerimaan/anomali/tutup`: hapuskan kiriman yang terlanjur menggantung

**[owner/admin]** — req `{ ids: uuid[] (1..500), alasan? }`, res `{ ditutup, dilewati }`.

Untuk barang yang cabangnya **sudah dikompensasi manual** (Stok Awal, opname,
atau faktur manual). Barang itu **tidak boleh diterima** lewat
`/penerimaan/:id/terima`: penerimaan menyetel `waktu = now()` yang jatuh
**sesudah** garis Stok Awal, jadi qty-nya ditumpuk di atas saldo pembuka —
terhitung dua kali. Jalan yang benar adalah dihapuskan.

Soft-delete → bisa dipulihkan dari Tempat Sampah kalau ternyata salah.

**Yang perlu diketahui saat memakainya:** daftar `ids` **tidak dipercaya
server**. Predikat menggantung dihitung ulang di sana dengan definisi yang sama
persis dengan `GET /anomali`, dan `ids` hanya dipakai sebagai irisan. Jadi id
baris sehat tidak akan menghapus apa pun — ia dilaporkan di `dilewati`, bukan
menggagalkan seluruh permintaan. Kalau `ditutup` lebih kecil dari yang kalian
kirim, itu wajar: daftarnya basi, muat ulang `/anomali`.

---

## Rilis: Tombol 🥡 kini memindahkan UANG dan STOK

> Sudah di-merge ke production. Tidak ada migrasi DB. **Mengubah perilaku lama**
> pada satu titik, dan titik itu menyentuh laba-rugi — tolong baca sampai habis
> sebelum merilis layar papan pesanan berikutnya.

### 🔴 WAJIB — `POST .../sajian` pada penjualan yang SUDAH DIBAYAR menghitung ulang biayanya

Dulu `sajian_takeaway` adalah penanda murni: menekan 🥡 hanya mengubah instruksi
penyajian. Itu ternyata melubangi pembukuan. Kasus nyata dari lapangan: pesanan
dibukukan di meja dine-in, lalu pelanggan berubah pikiran dan minta dibungkus.
Dusnya benar-benar diambil dari rak — tapi HPP tetap memakai basis dine-in (yang
**melewati** kemasan) dan `sale_consumptions` tak pernah mencatat dusnya. Owner
melihat laba lebih besar dari kenyataan, dan stok kemasan habis tanpa jejak.

Sekarang **basis biaya sebuah baris = `sajian_takeaway`**, bukan `is_dine_in`.
Akibatnya, menandai baris pada transaksi yang sudah dibayar akan:

- menulis ulang `hpp_satuan` tiap baris dan `sales.total_hpp`;
- menulis ulang `sale_consumptions` transaksi itu (kemasan take away masuk /
  keluar dari pemakaian bahan) → **saldo stok bergerak**;
- mencatat perpindahannya di `GET /api/pesanan/:jenis/:id/log`, mis.
  `"Diubah jadi bawa pulang (HPP Rp 8.000 → Rp 9.500)"`.

**Yang perlu tim mobile lakukan:**

1. **Segarkan data setelah menekan 🥡** — bukan hanya kartu papannya. Layar
   Riwayat Transaksi, Laporan (laba-rugi), dan Stok bisa ikut berubah. Responsnya
   kini membawa `total_hpp` (HPP transaksi sesudah hitung-ulang) supaya kalian
   tak perlu menebak; `null` berarti open bill (tak ada yang dihitung ulang).
2. **Jangan sajikan tombol ini sebagai aksi ringan.** Pada pesanan yang sudah
   dibayar ia menggerakkan uang. Kalau layar kalian punya konfirmasi untuk aksi
   berdampak, tombol ini masuk kategori itu.

`is_dine_in` **tidak** berubah — ia tetap fakta pembukuan (di mana pesanan
dimakan; dasar pemisahan omzet dan label meja pada nota). Jadi badge "diubah"
yang membandingkan `sajian_takeaway` dengan `is_dine_in` tetap bekerja seperti
sebelumnya.

Operasinya **idempoten**: bolak-balik TA → dine-in → TA mendarat di angka yang
sama persis, karena selalu dihitung dari nol. Penjualan di Tempat Sampah tidak
dihitung ulang.

### 🟢 BARU — tanda TA dari dapur pada bill BELUM DIBAYAR akhirnya sampai ke angka

Celah kedua, dan yang paling sering terlihat: dapur menandai satu sajian bawa
pulang selagi bill masih terbuka. Penandanya memang ikut ke baris penjualan saat
kasir menagih — tapi biayanya dulu diambil dari `is_dine_in`, jadi kemasannya
hilang tepat di titik pembayaran. Sekarang penanda itu yang jadi basis biaya,
sehingga kemasan masuk HPP dan stoknya berkurang begitu dibayar. **Tanpa
endpoint baru** — cukup `open_bill_item_id` tetap dikirim saat membayar (sudah
wajib sejak rilis harga terkunci).

### ⚪️ INFO — prasyarat data: bahan harus bertanda `is_packaging`

Aturan take away hanya bergigi bila resep menunya memuat bahan ber-`is_packaging`
(dus/box/plastik). Tanpa itu, HPP bawa pulang = HPP dine-in dan menekan 🥡 tak
mengubah apa pun — bukan bug. Field-nya sudah lama ada di
`POST/PATCH /api/bahan` dan di `BahanDto`; yang baru adalah **web akhirnya punya
centang "🥡 Kemasan TA"** untuk mengisinya (sebelumnya hanya badge baca-saja, dan
tak ada satu pun cara membuatnya dari antarmuka). Kalau layar bahan baku di
mobile bisa menyunting bahan, pertimbangkan menampilkan centang yang sama.

---

## Rilis: Papan pesanan — urutan "terakhir diubah" + `selesai` tak menghidupkan yang batal

> Sudah di-merge ke production. Tidak ada migrasi DB. **Mengubah perilaku lama**
> pada dua titik; keduanya menyempit, bukan melebar.

### 🟡 PERLU DICEK — `GET /api/pesanan` diurut "terakhir DIUBAH", bukan "terakhir masuk"

Kuncinya sekarang **`status_pada ?? waktu`, menurun**. Dapur menandai sajian
sepanjang shift, dan kartu yang baru disentuh adalah kartu yang sedang dikerjakan
orang — itu yang harus di depan mata. Kartu yang belum pernah disentuh jatuh ke
waktu masuknya, jadi pesanan baru tetap di atas dan tak ada yang tenggelam.

Kalau layar papan kalian memakai urutan dari server apa adanya, tak ada yang
perlu dikerjakan. Kalau kalian mengurut ulang sendiri **atau** memperbarui kartu
secara optimistis, pakai kunci yang sama — kalau tidak, kartu yang baru ditandai
tetap di tempatnya sampai polling berikutnya.

### 🔴 WAJIB (kalau memakai pintasan kartu) — `status:"selesai"` tak menyentuh baris `batal`

`POST /api/pesanan/:jenis/:id/status` dengan `{"status":"selesai"}` dulu membuat
**semua** baris jadi `selesai`, termasuk yang sudah dibatalkan. Sekarang baris
`batal` dibiarkan.

Menandai sebuah pesanan kelar bukan alasan menghidupkan lagi sajian yang
dibatalkan — porsinya tak pernah keluar dari dapur, dan papan yang mengklaim
sebaliknya berbohong tentang apa yang disajikan. Kartunya **tetap** pindah ke
kolom Selesai, karena status kartu hanya menuntut tak ada lagi baris
`dikerjakan`. `dikerjakan` dan `batal` tetap mengenai semua baris.

⚪️ **INFO** — di web, pintasan kartu kini satu tombol bernama **"Pindahkan ke
Selesai"**; "batal semua" dan "kembalikan semua" dihapus dari antarmuka.
Endpoint-nya masih menerima ketiga status, jadi tak ada yang rusak di mobile.
Alasannya: membatalkan sepiring makanan adalah keputusan per sajian, dan satu
tombol yang melakukannya serentak menghapus keterangan siapa membatalkan apa.

### ⚪️ INFO — aturan turunan kartu kini di `@kakarut/shared`

`turunkanStatusPesanan`, `ringkasPesanan`, `kunciUrutPesanan`, dan
`urutkanPesanan` tinggal di satu tempat dan dipakai server maupun web. Tidak ada
perubahan bentuk respons — hanya jaminan bahwa yang dihitung klien sama dengan
yang dikirim server.

---

## Rilis: `PUT /open-bill/:id` tak lagi bisa MENGHAPUS baris bill

> Sudah di-merge ke production. Tidak ada migrasi DB. **Mengubah perilaku
> lama** — baca §🔴 di bawah sebelum merilis build mobile berikutnya.

Balasan lengkapnya ada di `docs/mobile/BALASAN-HAPUS-BARIS-BILL.md`.

### 🔴 WAJIB — baris bill yang dihilangkan dari `items[]` sekarang ditolak 400

Dulu: baris bill yang tak berpasangan dengan `items[]` yang dikirim
**di-hard-delete**. Bill sudah tayang di papan dapur begitu disimpan, jadi baris
itu bisa saja sudah dimasak — dan hilangnya tak meninggalkan jejak siapa pun.

Sekarang seluruh `PUT` ditolak:

```json
{
  "error": "Pesanan yang sudah masuk dapur tidak bisa dihapus dari sini — batalkan per sajian di Papan Pesanan.",
  "kode": "baris_bill_tak_bisa_dihapus",
  "item_ids": ["<id baris yang akan terhapus>"]
}
```

**Baca `kode`, jangan teks `error`** — kalimatnya ditulis untuk kasir dan bisa
berubah; `kode` tidak.

**Penolakan dihitung sebelum apa pun ditulis.** Bill tidak berubah sedikit pun
saat 400 — tidak qty, tidak `customer_nama`. `PUT` yang gagal gagal seluruhnya,
termasuk pesanan tambahan di payload yang sama.

Yang **tetap boleh** lewat `PUT`: menambah baris baru, mengubah
qty/catatan/`dine_in_override`, `pisah_dari`, dan memindahkan meja.

| Perlu | Pakai |
| --- | --- |
| Batal **satu sajian** | `POST /api/pesanan/open_bill/:billId/item/:itemId/status` `{"status":"batal"}` — barisnya tetap ada, berjejak |
| Batal **seluruh bill** | `DELETE /api/open-bill/:id` (tak berubah) |

### 🟡 PERLU DICEK — jangan syaratkan baris bill ada di katalog

`GET /api/menu` menyaring menu nonaktif. Klien yang menyusun keranjang dari
katalog akan **membuang** baris bill yang menunya baru diarsipkan ("bakso
habis") — tanpa ada yang menekan apa pun. Digabung dengan gerbang di atas,
akibatnya bukan lagi baris hilang diam-diam, tapi bill itu **tak bisa disimpan
sama sekali**.

Aturannya: untuk menampilkan baris bill, `items[].menu_nama` +
`items[].harga_satuan` dari bill adalah **sumber yang benar**. Katalog hanya
pelengkap (foto, kategori, ketersediaan).

Mobile sudah menutup ini di `a33cfd0`; web ikut diperbaiki di rilis ini.

---

## Rilis: `pisah_dari` — memecah porsi di `PUT /open-bill/:id`

> **Sudah di-merge ke production** (PR #132, 30 Jul 2026).
>
> Tidak ada migrasi DB. Field **baru** pada body `PUT`/`POST /api/open-bill`;
> tidak ada perilaku lama yang berubah.

### 🟢 BARU — `items[].pisah_dari` di `PUT /api/open-bill/:id`

Menjawab pertanyaan tim mobile: **tidak**, `PUT` TIDAK memetakan `items[].id`
lewat map seperti pembayaran. Mengirim `id` yang sama dua kali ditolak **400**
("Baris bill dikirim lebih dari sekali"), dan itu memang disengaja — kedua field
punya arti berbeda:

| Field | Arti | Boleh berulang? |
| --- | --- | --- |
| `id` | **pasangan** — baris lama mana yang diperbarui baris ini | **tidak**, 1:1 |
| `pisah_dari` | **warisan** — baris BARU yang mewarisi harga terkunci & status dapur | **ya**, many:1 |

Jadi jangan hapus penjaga kalian — ganti dengan `pisah_dari`:

```jsonc
{ "items": [
    { "id": "B1",         "menu_id": "M", "qty": 2 },
    { "pisah_dari": "B1", "menu_id": "M", "qty": 1, "dine_in_override": false }
]}
```

Baris pecahan mewarisi `harga_satuan`, `menu_nama`, dan trio status dapur.
`sajian_takeaway` **tidak** diwarisi — memecah porsi justru dilakukan supaya
penyajiannya berbeda, jadi penandanya lahir dari `dine_in_override` baris itu
sendiri saat bill dibayar.

**Solusi sementara kalian (id hanya pada kemunculan pertama) bukan "aman tapi
tidak ideal" — itu bug harga yang sama** yang baru kalian balikkan, cuma di
momen yang berbeda: porsi pecahannya jadi baris baru berharga hari ini, jadi
pembeli ditagih lebih mahal, dan porsi yang sudah matang kembali ke antrean
dapur. Tolong pindah ke `pisah_dari`.

Ditolak **400**: `pisah_dari` bersamaan dengan `id`, menunjuk baris bill lain /
tak ada, beda `menu_id`, atau dipakai di `POST /api/open-bill` (bill baru belum
punya baris untuk diwarisi).

---

## Rilis: Pisah porsi berbagi `open_bill_item_id` + cacah penyajian di riwayat

> **Sudah di-merge ke production** (PR #132, 30 Jul 2026).
>
> Tidak ada migrasi DB, tidak ada perubahan perilaku server — satu field baru +
> satu aturan yang **diperjelas**.

### 🔴 WAJIB — baris PISAH PORSI harus tetap membawa `open_bill_item_id`

Memecah 3 porsi jadi 2 di piring + 1 dibungkus adalah keputusan **pengemasan**
saat bayar, **bukan pesanan baru**. Kirim baris pecahannya dengan
`open_bill_item_id` **yang sama** — id itu memang boleh berulang, dan server
sudah mendukungnya hari ini (pemetaan `id → harga` dan `id → status` lewat map).

```jsonc
{ "open_bill_id": "…", "items": [
    { "menu_id": "M", "qty": 2, "open_bill_item_id": "B1", "is_dine_in": true  },
    { "menu_id": "M", "qty": 1, "open_bill_item_id": "B1", "is_dine_in": false }
]}
```

Menghilangkan id pada baris pecahan merusak **dua** hal, keduanya sunyi:

1. **harga lepas dari kunci** → pembeli ditagih harga hari pembayaran;
2. **pewarisan status lepas** → `pesananStatus` jatuh ke bawaan `dikerjakan`,
   jadi sajian yang **sudah selesai kembali ke antrean dapur** saat pelanggan
   membayar.

Dikunci uji end-to-end di `verify-api.sh` §154(f2).

Server **tidak** memeriksa `sum(qty)` pecahan terhadap qty baris bill-nya —
sengaja, karena alur web yang sudah jalan mengizinkan kasir menaikkan qty baris
bill saat membayar. Jaga konsistensinya di klien.

### ⚪️ INFO — `open_bill_item_id` TETAP opsional (tidak jadi 400)

Rencana mengetatkannya **dibatalkan**. Baris tanpa id itu sah — pesanan tambahan
yang baru diketik saat membayar memang tak punya baris bill dan memang memakai
harga hari ini. Server tak bisa membedakannya dari "klien lupa"; keduanya
identik di kabel. Mewajibkannya akan mematikan pesanan tambahan, bukan menutup
lubangnya.

Yang tetap berlaku: **"tidak ada galat" bukan bukti field itu terkirim.**
Pastikan lewat pengujian klien. Kalau nanti perlu kepastian dari server, jalannya
penanda niat eksplisit per baris (`harga_hari_ini: true`) — belum ada, minta bila
perlu.

### 🟢 BARU — `RiwayatTransaksiRow.item_takeaway` & `item_dine_in`

Cacah baris per cara penyajian. `sajian_takeaway` adalah `bool_and`: ia `false`
begitu SATU baris tetap di piring, jadi tak bisa membedakan "semuanya di piring"
dari "sebagian dibungkus". Dua cacah ini yang membedakannya — pakai untuk
menulis "2 dari 3 dibungkus" alih-alih badge mutlak.

`item_takeaway + item_dine_in == jumlah_item` selalu.

---

## Rilis: Satu meja = satu bill + pilihan tamu sama / tamu baru

> **Sudah di-merge ke production** (PR #132, 30 Jul 2026).
>
> Tidak ada migrasi DB. Satu field baru pada DTO yang sudah ada + satu aturan
> baru yang **menolak permintaan yang dulu berhasil**.

Laporan dari lapangan: **kasir bisa membuat dua bill untuk satu meja di waktu
yang sama** — lalu saat tamu pulang salah satunya tertinggal, tidak tertagih,
dan baru terasa saat tutup kasir selisih.

Keputusan owner: **selama masih ada open bill di meja itu, tidak boleh bikin
bill kedua.** Pesanan tambahan wajib masuk ke bill yang masih terbuka.

### 🔴 WAJIB — `POST /api/open-bill` kini **409** di meja dine-in yang sudah punya bill

Permintaan yang dulu berhasil sekarang ditolak. Badan galatnya berkode:

```json
{ "error": "Meja 5 masih punya bill yang belum dibayar — tambahkan pesanan ke bill itu",
  "kode": "meja_sudah_ada_bill",
  "bill_id": "<uuid bill yang harus dipakai>" }
```

`bill_id` sengaja ikut supaya klien tak perlu mencari sendiri: muat bill itu
(`GET /api/open-bill/:id`), gabungkan keranjang yang sekarang, lalu simpan lewat
**`PUT /api/open-bill/:id`**. Itu satu-satunya jalan menambah pesanan ke meja
yang sudah punya bill.

**Baca `kode`, jangan mencocokkan teks pesannya.**

Alur yang disarankan supaya kasir tak menabrak galat: sebelum menyimpan bill
baru, cek `openBills.where((b) => b.meja_id == mejaTerpilih.id)` — kalau tidak
kosong, langsung tawarkan "buka bill itu" alih-alih tombol simpan.

**`PUT` ikut dijaga.** Memindahkan bill ke meja yang sudah punya bill lain juga
**409** dengan kode yang sama. Tanpa itu larangannya cuma menutup pintu depan:
bikin bill di meja lain lalu pindahkan. Menyimpan ulang bill di mejanya **sendiri**
tetap boleh — itu justru jalur "tambahkan pesanan".

### ⚪️ INFO — dua pengecualian yang TIDAK dijaga

1. **Ruang Tunggu (meja `takeaway`) dikecualikan.** Seluruh pesanan bawa pulang
   cabang menunjuk ke satu baris takeaway yang tak bisa dihapus. Kalau ia ikut
   dijaga, satu bill bawa pulang yang terparkir akan memblokir **semua** pesanan
   bawa pulang berikutnya — jalur itu mati. Bill kedua di Ruang Tunggu tetap
   **201**.
2. **Bill tanpa `meja_id`** tak punya apa pun untuk bertabrakan → tetap **201**.

Juga tidak dijaga: **penjualan langsung** (`POST /api/penjualan`) di meja yang
punya bill berjalan. Yang dilarang hanya bill kedua, bukan transaksi kedua.

Setelah bill lama dibayar **atau** dibatalkan, mejanya bebas dan boleh punya
bill baru lagi — kalau tidak, satu bill batal akan mengunci mejanya selamanya.

### 🟢 BARU — `OpenBillRow.meja_id`

`GET /api/open-bill` kini menyertakan `meja_id: string | null` di samping
`meja_label`. Tidak ada field lama yang berubah.

**Cocokkan bill ke meja lewat `meja_id`, JANGAN `meja_label`** — label itu
snapshot saat bill dibuat, jadi pencocokan lewat nama gagal begitu mejanya
diganti nama. Dan gagalnya **sunyi**: kasir tak melihat peringatan, lalu
menabrak 409 tanpa tahu sebabnya.

`null` = mejanya sudah dihapus dari master (`meja_id` ber-`onDelete: set null`)
atau bill dibuat tanpa meja.

### 🔴 WAJIB — meja SUDAH BAYAR dipilih lagi: tanya tamunya sama atau baru

`lunas_masih_duduk: true` = semuanya lunas tapi meja belum dibereskan. Kalau
kasir memilih meja itu lagi, ada **dua kejadian yang server tak bisa
membedakan**, dan keduanya sah:

| Pilihan | Yang harus dilakukan klien |
| --- | --- |
| 🍽 **Tamu yang sama — tambah pesanan** | pakai mejanya apa adanya + isikan `konsumen_nama`/`konsumen_wa` ke keranjang |
| ✓ **Tamu baru — bereskan meja dulu** | `POST /api/meja/:id/kosongkan` **dulu** (200 langsung, tanpa `paksa`), baru pakai mejanya |

**Kalau tidak ditanya, papan berbohong.** Tamu baru di meja yang belum
dibereskan membuat `sejak` tetap menunjuk transaksi tamu **sebelumnya** — papan
bilang "sudah duduk 2 jam" untuk orang yang baru lima menit duduk, dan salahnya
bertahan sampai jendela okupansi **12 jam** meluruhkannya. Membereskan meja
menulis batas di `meja_kosong_logs`, dan itulah satu-satunya yang memotong
hitungan itu.

Meja yang masih punya bill belum dibayar TIDAK masuk alur ini — di sana jalurnya
"tambahkan ke bill yang ada" (lihat 409 di atas).

### 🟢 BARU — `MejaStatusDto.konsumen_nama` & `konsumen_wa`

Konsumen pada transaksi **terbaru** yang masih menempati meja itu. **Selalu
`null` bila mejanya `kosong`**, jadi klien tak pernah menawarkan tamu yang sudah
dibereskan.

Gunanya: tanpa ini, tamu member yang memesan dua kali di meja yang sama tercatat
sebagai satu transaksi ber-member dan satu tanpa member — poin/riwayatnya
terputus justru pada tamu yang paling sering datang. Kasir tetap boleh
menghapus/mengganti namanya.

### 🔴 WAJIB — layar meja di mobile: status okupansi + Kosongkan

Endpoint `GET /api/meja/status`, `POST /api/meja/:id/kosongkan`, dan
`GET /api/meja/:id/log` **sudah tayang di production sejak PR #129** dan sudah
terbuka untuk token `cashier` — tapi mobile belum memakainya sama sekali.
Akibatnya kasir mobile bekerja buta: tak tahu meja mana yang terisi, dan tak
punya cara membereskan meja saat tamu pulang.

Dengan aturan baru di atas, ini jadi lebih mendesak: tanpa status di pemilih
meja, kasir baru tahu mejanya sudah terisi **setelah** ditolak 409.

**Langkah lengkap + empat jebakan yang tak boleh diulang ada di
`docs/mobile/PROMPT-MEJA-KASIR.md`.**

### ⚪️ INFO — web sudah disesuaikan di rilis ini

Web sudah menampilkan status okupansi + tombol Kosongkan di modal Pilih Meja.
Rilis ini menambahkan dua hal: (1) pendahuluan 409-nya — menekan **Open Bill** di
meja yang sudah punya bill langsung membuka daftar bill itu dengan tombol "Buka
bill", tanpa opsi "tetap buat bill baru" karena server memang menolaknya; dan
(2) dialog "tamu yang sama / tamu baru" saat memilih meja yang sudah dibayar,
persis seperti yang diminta di atas untuk mobile.

---

## Rilis: Status pesanan turun ke SETIAP BARIS (papan pesanan per sajian)

> **Sudah di-merge ke production** (PR #132, 30 Jul 2026).
>
> Ada migrasi DB (`0092`): kolom status **pindah** dari `sales`/`open_bills` ke
> `sale_items`/`open_bill_items`, plus `pesanan_logs.item_nama`. Migrasinya
> menyalin nilai lama ke tiap baris sebelum kolom lamanya dibuang — data
> pengerjaan yang sedang berjalan tidak hilang.

Permintaan owner: *"selesai, take away dan batal itu per baris pesanan per bill,
bukan seluruh bill — jadi nanti ketika selesai bisa kirim satu satu dan kita tau
mana yang sudah dan mana yang belum."*

Satu bill berisi minuman yang keluar duluan dan gorengan yang menyusul. Dengan
satu tombol untuk seluruh bill, dapur harus menahan "selesai" sampai sajian
terakhir jadi — dan tak seorang pun bisa tahu mana yang sudah keluar.

### 🟡 PERLU DICEK — `PesananRow.status` & `sajian_takeaway` kini TURUNAN, bukan kolom

Bentuk responsnya **tidak berubah** — `GET /api/pesanan` tetap mengembalikan
`PesananRow[]` dengan `status` dan `sajian_takeaway` di kartunya. Yang berubah
adalah **asal nilainya**: keduanya sekarang dihitung dari `items[]` saat dibaca.

| Field kartu | Aturan turunannya |
| --- | --- |
| `status` | `batal` bila **semua** baris batal; `selesai` bila **tak ada lagi** baris `dikerjakan`; selain itu `dikerjakan` |
| `sajian_takeaway` | `true` hanya bila **SEMUA** baris bertanda bawa pulang |

Jangan menyimpan sendiri agregat ini di sisi klien: agregat tersimpan harus ikut
diperbarui di setiap perubahan baris, dan satu yang terlewat membuat papan
berbohong. Baca ulang `GET /api/pesanan` setelah tiap aksi.

`PesananRow` juga bertambah `item_selesai` dan `item_batal` (cacah baris) untuk
ringkasan "2/3 selesai". `PesananItemRow` bertambah `id`, `status`,
`sajian_takeaway`, `status_oleh`, `status_pada`. `PesananLogRow` bertambah
`item_nama` (`null` = aksinya mengenai seluruh pesanan).

### 🟢 BARU — endpoint per baris

| Endpoint | Guna |
| --- | --- |
| `POST /api/pesanan/:jenis/:id/item/:itemId/status` | tandai **satu sajian** `dikerjakan`/`selesai`/`batal` |
| `POST /api/pesanan/:jenis/:id/item/:itemId/sajian` | penanda bawa pulang **satu sajian** |

`:itemId` = `PesananItemRow.id`. Responsnya
`{ ok, status, kartu_status }` — `kartu_status` adalah status kartu setelah
diturunkan ulang, jadi layar bisa memindahkan kartunya tanpa memuat ulang dulu.
**409** bila baris itu baru saja diubah orang lain (dua orang di dapur menekan
tombol yang sama) — muat ulang papan, jangan kirim paksa.

Dua endpoint setingkat kartu yang lama **tetap ada** sebagai pintasan "semua
baris" (`POST .../status` dan `POST .../sajian`) — pesanan satu-dua sajian
adalah mayoritas. Bedanya, versi kartu **tidak** ber-409 balapan: perintahnya
"jadikan semuanya X", jadi dua orang yang menekannya bersamaan sampai di hasil
yang sama.

### 🔴 WAJIB — kirim `open_bill_item_id` saat membayar open bill

Pewarisan status ke penjualan sekarang **per baris**, dan pencocokannya lewat
`items[].open_bill_item_id` pada `POST /api/penjualan`. Field itu sudah ada sejak
rilis kunci harga open bill dan sudah dibutuhkan untuk alasan itu — sekarang ia
juga yang membawa pekerjaan dapur ikut pindah.

Tanpa field itu, tiap baris penjualan lahir sebagai pekerjaan baru yang belum
tersentuh: **sajian yang sudah selesai akan kembali ke antrean dapur** begitu
pelanggan membayar.

> ### ⚠️ TOLONG DICEK ULANG DI KODE, JANGAN DARI INGATAN
>
> **Server tidak menolak permintaan tanpa field ini.** Skemanya
> `open_bill_item_id: z.string().uuid().nullish()` — opsional. Bila tak dikirim,
> `createSale` diam-diam memakai `menus.harga_jual` **hari pembayaran** (bukan
> harga yang disepakati pembeli) dan baris penjualannya lahir `dikerjakan`.
> Tidak ada 400, tidak ada peringatan, tidak ada apa pun di log.
>
> Artinya: klien yang **belum** mengirimnya tak akan pernah tahu — sejak rilis
> kunci harga pun tidak. "Tidak ada galat" **bukan** bukti field ini terkirim.
> Buka kode pembayaran open bill dan pastikan tiap baris keranjang membawa
> `id` baris bill-nya (`OpenBillDetail.items[].id`), bukan hanya `menu_id`.
>
> Kami sengaja **tidak** menjadikannya 400 di rilis ini: kalau ternyata mobile
> belum mengirimnya, mengetatkan server akan mematikan pembayaran open bill di
> produksi, bukan memperbaikinya. Beri tahu kami hasil pengecekannya — kalau
> sudah aman, gerbangnya bisa kami ketatkan supaya lubang ini tertutup
> selamanya.

### ⚪️ INFO — `RiwayatTransaksiRow.sajian_takeaway` ikut jadi turunan

Nilainya `true` hanya bila SELURUH baris transaksi bertanda bawa pulang. Badge
"diubah setelah transaksi" (`sajian_takeaway == is_dine_in`) masih berguna, tapi
bacalah arahnya hati-hati:

- `true` pada nota **dine-in** = semuanya dipindah jadi bawa pulang;
- `false` pada nota **bawa pulang** = **ada** yang dikembalikan ke piring —
  belum tentu semuanya. Hindari label "disajikan di tempat" yang mutlak.

Penandanya juga **lahir per baris** (`= !sale_items.is_dine_in`), jadi satu nota
bisa berisi sajian yang dibungkus dan sajian yang di piring sekaligus — persis
yang mustahil diwakili satu penanda setingkat transaksi.

### ⚪️ INFO — pembatalan bill & status meja ikut mengikuti baris

`DELETE /api/open-bill/:id` sekarang menandai `batal` pada **setiap** barisnya
(selain mengisi `closed_at`). Sebaliknya, bill yang seluruh barisnya batal
otomatis tertutup — dan satu baris yang dikembalikan ke antrean **membukanya
lagi** untuk kasir. Yang terlihat kasir tak berubah.

`GET /api/meja/status` juga menurun dari baris: transaksi baru dianggap tidak
lagi mengisi meja hanya kalau **seluruh** sajiannya dibatalkan.

---

## Rilis: `sebab` terstruktur pada 409 penjualan — jawaban pertanyaan antrean offline

> **Sudah di-merge ke production** (PR #131, 29 Jul 2026).
>
> Tidak ada migrasi DB. Perubahan **aditif**: satu field baru pada badan galat.

Menjawab pertanyaan yang menggantung dari mobile: *"409 pada `penjualan` kami
perlakukan sebagai 'sudah berhasil' untuk SEMUA sebab, karena kami tak bisa
membedakannya. Kalau `sebab`-nya bisa dibedakan, kirimkan kodenya."*

**Bisa — dan aturan sementara itu memang berisiko.** Kami audit seluruh 409 yang
bisa keluar dari jalur penjualan: dari empat sebab, hanya **satu** yang berarti
transaksinya sudah tercatat. Tiga sisanya berarti transaksinya **tidak pernah
tercatat**, jadi membuangnya dari antrean = kehilangan transaksi.

### 🔴 WAJIB — persempit aturannya ke `sebab == "bill_sudah_dibayar"`

`POST /api/penjualan` yang menolak dengan 409 kini **selalu** membawa `sebab` di
badan galat (`{ error, sebab }`), dan `sebab` yang sama ikut pada item gagal
`POST /api/sync` (`hasil[].sebab`).

| `sebab` | Artinya | Tercatat? | Tindakan |
| --- | --- | --- | --- |
| `bill_sudah_dibayar` | bill sudah punya penjualan | **YA** | aman dibuang dari antrean |
| `bill_dibatalkan` | bill ditutup lewat pembatalan, tanpa penjualan | **TIDAK** | jangan dibuang |
| `kasir_belum_dibuka` | tak ada shift terbuka (jalur online) | **TIDAK** | gerbang "Buka Kasir" |
| `shift_tidak_cocok` | tak ada shift mencakup `waktu` (jalur `/sync`) | **TIDAK** | tampilkan + `data.shift_terdekat` |

Dua yang pertama berasal dari sumber yang sama — `open_bill_id` yang bill-nya
sudah tertutup — dengan **kode HTTP identik dan arti berlawanan**. Itulah yang
membuat aturan "semua 409 = sudah berhasil" berbahaya: bill yang **dibatalkan**
kasir lalu dikirim ulang oleh antrean akan hilang tanpa jejak.

`shift_tidak_cocok` juga sudah ada sebelum ini dan **sudah** dikirim server —
tapi aturan "semua 409" ikut membuangnya, padahal itu justru kasus yang paling
perlu dilihat kasir.

### ⚪️ INFO — `sebab` kini bisa datang dari mana saja

Sebelumnya hanya galat yang dilempar eksekutor di modul `/sync` yang membawa
`sebab`; galat dari modul lain (mis. `createSale`) sampai sebagai 409 telanjang.
Sekarang `app.onError` dan penampung galat `/sync` sama-sama meneruskan `sebab`
bila galatnya membawanya, jadi kode sebab tak lagi mati di perbatasan modul.

### 🧪 Cara memicu 409-nya untuk uji lapangan

Mobile menyebut jalur ini belum bisa dibuktikan di perangkat. Dua resep, dua
sebab berbeda — keduanya dipakai di `verify-api.sh` dan bisa dijalankan manual:

**`bill_sudah_dibayar`** — bayar bill yang sama dua kali:
1. `POST /api/open-bill` → simpan `id`
2. `POST /api/penjualan` dengan `open_bill_id` itu → **201**
3. `POST /api/penjualan` lagi dengan `open_bill_id` yang sama → **409**
   `sebab: "bill_sudah_dibayar"`

**`bill_dibatalkan`** — inilah yang berbahaya kalau dibuang:
1. `POST /api/open-bill` → simpan `id`
2. `DELETE /api/open-bill/<id>` (batalkan)
3. `POST /api/penjualan` dengan `open_bill_id` itu → **409**
   `sebab: "bill_dibatalkan"`

Untuk menguji lewat antrean, bungkus langkah terakhir sebagai perintah
`{tipe:"penjualan", payload:{open_bill_id:…}}` di `POST /api/sync` — hasilnya
`hasil[0] = { status:"gagal", kode:409, sebab:"bill_dibatalkan" }`.

### ⚪️ INFO — `MejaStatusDto` sudah ada di Lampiran A

Menjawab pertanyaan di §2 balasan mobile: ya, bentuk respons
`GET /api/meja/status` sudah tercatat lengkap — blok `/api/meja` di
`docs/API-CONTRACT.md` dan definisi `MejaStatusDto` di Lampiran A. Tak perlu
menebak.

---

## Rilis: Perbaikan Laporan Kebersihan (`saya=1`, validasi query, transaksi)

> **Sudah di-merge ke production** (PR #129, 29 Jul 2026).
>
> Ada migrasi DB (`0091`): dedup `cleaning_report_items` lalu indeks unik
> `(report_id, area_id)`. Tidak ada perubahan kolom maupun bentuk response.

Hasil audit fitur Laporan Kebersihan. Tidak ada lubang keamanan yang ditemukan —
isolasi perusahaan, gerbang peran, dan pemeriksaan kepemilikan semuanya utuh.
Yang diperbaiki: dua **500** yang bisa dipicu klien, satu layar yang memakai data
orang lain, dan tiga penyimpangan penulisan data.

### 🔴 WAJIB — layar pengisian harus mengirim `?saya=1`

`GET /api/kebersihan` sekarang menerima `saya=1`, yang memaksa penyempitan ke
laporan pemanggil untuk **semua** peran.

Selama ini endpoint itu hanya menyempit sendiri untuk peran terkunci cabang
(`cashier`/`tim`/`kitchen`/`bar`). Untuk owner/admin ia mengembalikan laporan
**seluruh karyawan**. Klien yang memakainya sebagai "laporan saya" akan:
menandai kartu sesi sebagai sudah terisi padahal yang mengisi orang lain,
memuat checklist orang lain saat kartunya dibuka, dan mengarahkan tombol
Perbarui ke `PATCH /api/kebersihan/<id orang lain>` — yang ditolak **403**.
Akibatnya admin yang punya cabang **tak bisa** mengirim laporannya sendiri.

Kalau layar pengisian mobile memanggil `GET /api/kebersihan` polos, tambahkan
`?saya=1`. Peran terkunci cabang tidak berubah perilaku sama sekali.

### 🟡 PERLU DICEK — `GET /api/kebersihan/area` punya bawaan baru untuk manajemen

Endpoint ini melayani dua layar yang berbeda, jadi saringannya kini harus dipilih:

| Layar | Kirim | Isinya |
| --- | --- | --- |
| Pengisian checklist | `?aktif=1` (tanpa `branch_id`) | cabang penugasan sendiri, hanya yang aktif |
| Master area | `?branch_id=all` | seluruh area perusahaan, termasuk nonaktif |

Untuk peran terkunci cabang **tidak ada yang berubah** — mereka selalu menerima
area lokasinya yang aktif. Yang berubah hanya bawaan bagi owner/admin: dulu
tanpa query mereka menerima SEMUA area perusahaan, termasuk area cabang lain dan
area nonaktif — yaitu persis yang ditolak jalur tulis dengan **400**.

### 🟡 PERLU DICEK — dua query yang dulu menjatuhkan server kini 400/fallback

| Permintaan | Dulu | Sekarang |
| --- | --- | --- |
| `rekap?bulan=2026-13` atau `2026-00` | **500** | **200**, jatuh ke bulan berjalan |
| `?branch_id=<bukan-uuid>` (rekap & daftar) | **500** | **400** |

Pola bulan dulu `\d{4}-\d{2}`, sehingga bulan 00/13/99 lolos lalu dirakit jadi
tanggal mustahil (`2026-13-01`) dan Postgres melempar. Ini menggigit klien yang
menyusun bulan dari indeks berbasis-0 atau kena off-by-one di bulan Desember.
`branch_id` yang bukan UUID juga masuk langsung ke klausa `WHERE` kolom uuid.

### 🟡 PERLU DICEK — `PATCH /api/kebersihan/:id` berhenti menghapus `catatan`

`items` tetap **mengganti seluruh** checklist. `catatan` kini bersifat **patch**:

- field tidak dikirim → nilai lama **dibiarkan**
- field dikirim `null` → dikosongkan

Dulu keduanya sama-sama menulis NULL, jadi klien yang cuma membetulkan checklist
ikut menghapus pesan karyawan ke owner tanpa galat dan tanpa jejak. Klien yang
selama ini selalu mengirim `catatan` tidak berubah perilaku.

### 🟡 PERLU DICEK — `PATCH` bisa membalas **409** saat dua perangkat bentrok

Kalau dua perangkat mem-PATCH laporan yang sama nyaris bersamaan, salah satunya
kini kalah dengan **409** *"Laporan ini baru saja diperbarui dari perangkat lain
— muat ulang lalu coba lagi"*. Tangani seperti bentrok biasa: muat ulang
laporannya (`GET /api/kebersihan/:id`) lalu kirim ulang perubahannya.

Sebelum ini keduanya sama-sama **berhasil**, dan checklist jadi ganda —
`total_area`, `area_bersih`, `jumlah_foto`, dan `area_kotor` di rekap owner
semuanya berlipat. Lebih buruk lagi, angka itu **membeku**: esok harinya PATCH
lintas-tanggal ditolak 409 sehingga tak ada yang bisa membetulkannya.

`409` pada `PATCH` sekarang punya dua arti — laporan hari sebelumnya, atau
bentrok perangkat. Bedakan dari teks pesannya bila perlu.

### ⚪️ INFO — area nonaktif ditolak, penulisan jadi atomik

`POST` dan `PATCH` kini menolak `area_id` yang sudah dinonaktifkan owner
(**400**, pesannya menyebut jumlah baris yang bermasalah). Muat ulang
`GET /api/kebersihan/area` bila menerimanya.

Keduanya juga menulis dalam satu transaksi, jadi laporan tanpa item atau
checklist yang hilang separuh jalan tidak lagi mungkin.

### ⚪️ INFO — migrasi `0091` membersihkan duplikat lama

Database yang sudah terlanjur punya checklist ganda dibereskan otomatis saat
migrasi: baris kembar per `(report_id, area_id)` dibuang, menyisakan yang paling
berisi (berfoto dulu, lalu yang bercatatan). Baris ber-`area_id` NULL (area
masternya sudah dihapus) sengaja tidak disentuh. Klien tak perlu berbuat apa pun
— tapi angka rekap sebuah hari bisa **turun** setelah rilis, dan itu memang
koreksi, bukan data yang hilang.

---

## Rilis: Laporan Harga dibuka untuk karyawan Central Kitchen

> **Sudah di-merge ke production** (PR #129, 29 Jul 2026).
>
> Tidak ada migrasi DB. Tidak ada perubahan bentuk request/response.

### 🟡 PERLU DICEK — dua endpoint laporan harga tak lagi khusus owner/admin

| Endpoint | Sebelum | Sesudah |
| --- | --- | --- |
| `POST /api/pembelian/laporan-harga/:fakturId/dampak` | owner/admin | gerbang grup `/pembelian/*` |
| `POST /api/pembelian/laporan-harga/:fakturId` | owner/admin | gerbang grup `/pembelian/*` |

Gerbang grup itu = **owner/admin, ATAU `tim` yang cabangnya Central Kitchen** —
sama persis dengan seluruh `/api/pembelian/*` lainnya. Kedua rute ini dulu satu-
satunya yang menyempitkan diri lagi di dalam grup; penyempitan itu dihapus.

Yang **tetap 403**: `cashier`, `kitchen`, `bar`, dan `tim` di cabang **store** —
mereka ditolak gerbang grup, jadi tak ada pelonggaran ke luar Central Kitchen.

**Yang perlu dicek di klien:** kalau layar mobile menyembunyikan tombol "Laporan
Harga" berdasarkan peran, longgarkan syaratnya agar akun CK ikut melihatnya.
Web justru tak pernah menyaring per peran — tombolnya sudah muncul untuk tim CK
dan server-lah yang menolak, sehingga gejalanya adalah "peran tidak diizinkan"
saat tombol ditekan. Bila klien mobile menyalin logika yang sama, tak ada yang
perlu diubah.

**Kenapa dibuka:** yang belanja dan memegang notanya adalah tim CK. Selama hanya
manajemen yang boleh menyimpan, harga riil baru masuk kalau manajemen sempat
menyalinnya — dan selama belum, RAB belanja berikutnya memakai harga basi.
Pengamannya bukan peran, melainkan pratinjau `/dampak` (menghitung pergeseran
food cost tiap menu **sebelum** apa pun ditulis) plus `updated_by` +
`laporan_harga_at` yang tersimpan di tiap baris yang dilaporkan — pelakunya
tampil sebagai `diubah_oleh` pada baris `GET /api/pembelian`.

---

## Rilis: Status meja isi/kosong (`/api/meja/status`) + gerbang tulis `/api/meja`

> **Sudah di-merge ke production** (PR #129, 29 Jul 2026).
>
> Ada migrasi DB (`0090`): tabel `meja_kosong_logs` + 2 indeks bantu. Tidak ada
> perubahan kolom pada tabel lama.

Sampai sekarang tak ada cara apa pun mengetahui meja mana yang kosong: tabel
meja hanya master data. Waiter menghafal atau berkeliling.

### 🟢 BARU — `GET /api/meja/status` dan kawan-kawannya

| Endpoint | Guna |
| --- | --- |
| `GET /api/meja/status` | `MejaStatusDto[]` — **hanya meja `dine_in`** |
| `POST /api/meja/:id/kosongkan` | bereskan meja; `{ paksa?: bool }` |
| `GET /api/meja/:id/log` | "siapa membereskan, kapan" |

Detail lengkap + alasannya: blok `/api/meja` di `docs/API-CONTRACT.md`. Tiga hal
yang paling mudah salah dipahami:

1. **Dibayar ≠ kosong.** Orang lazim bayar dulu lalu duduk. Meja baru bebas saat
   ada yang menekan Kosongkan. Jangan bikin klien mengosongkan meja sendiri
   setelah transaksi berhasil.
2. **Meja terisi tetap boleh dipilih.** Statusnya memberi tahu, bukan melarang —
   melanjutkan open bill di meja terisi wajib bisa, dan penjualan langsung di
   meja terisi juga sah. Jangan menyaring meja terisi dari pemilih meja.
   *(Disusul rilis berikutnya: bill **KEDUA** di satu meja dine-in kini ditolak
   server **409** `meja_sudah_ada_bill`. Yang dilarang cuma itu — pemilihan
   mejanya tetap bebas.)*
3. **Ruang Tunggu tidak punya status** dan tidak muncul di daftar sama sekali.
   Seluruh penjualan bawa pulang menunjuk ke satu baris itu; menandainya terisi
   akan mengunci jalur bawa pulang cabang selamanya.

Tombol Kosongkan bertahap dua: kalau meja masih punya bill belum dibayar,
permintaan pertama ditolak **409** dengan badan `{ kode: "bill_berjalan",
bill_terbuka: N }`. Tampilkan konfirmasi kedua, lalu kirim ulang dengan
`{ paksa: true }`. Tagihannya **tidak dibatalkan** — tetap ada di
`GET /api/open-bill`. **Baca `kode`, jangan mencocokkan teks pesannya** — teks
bisa berubah kapan saja.

### 🔴 WAJIB — `/api/meja` yang MENGUBAH kini tertutup untuk tim/kitchen/bar

`POST /api/meja`, `PUT /api/meja/tata-letak`, `PATCH /api/meja/:id`, dan
`DELETE /api/meja/:id` sekarang **[owner/admin/cashier]**. Klien yang memakai
token `tim`, `kitchen`, atau `bar` untuk keempatnya akan mulai mendapat **403**.

**Aplikasi kasir tidak terdampak:** token `cashier` tetap boleh menulis. Yang
justru perlu diperiksa adalah **pemilih meja** di layar Kasir — lihat poin 2 di
atas: meja terisi WAJIB tetap muncul dan tetap bisa dipilih. Menyaringnya
membuat pemasangan meja batal saat melanjutkan open bill (tagihan sah jadi tak
bisa ditagih) dan membuat `dineIn` jatuh ke nilai cadangan `true`, sehingga
pesanan bawa pulang terbukukan makan-di-tempat dengan HPP salah.

Ini menambal lubang yang sudah ada, bukan pengetatan baru yang direncanakan:
modul meja selama ini **tidak punya gerbang peran sama sekali**, sehingga akun
dapur bisa menghapus meja atau menimpa denah lewat API walau tombolnya tak ada
di layar mana pun. `GET /api/meja` sendiri **tetap [any]** dan `MejaDto` tidak
berubah satu byte pun.

Dua penjaga baru yang bisa mengejutkan: menghapus atau menonaktifkan meja yang
**masih terisi** kini ditolak **409** ("kosongkan dulu"). Sebelumnya berhasil
dan membuat tagihan yang masih hidup jadi yatim (`meja_id` ber-`onDelete: set
null`).

### ⚪️ INFO — cache ETag tidak perlu disentuh

Status okupansi sengaja **tidak** ditempel ke `GET /api/meja`. Daftar master itu
tetap ber-ETag dan tetap kena 304 seperti biasa; `GET /api/meja/status` adalah
endpoint terpisah tanpa ETag yang memang harus ditarik berkala (web memakai 30
detik).

---

## Rilis: Papan Pesanan Masuk (`/api/pesanan`) + open bill ditutup server

> **Sudah di-merge ke production** (PR #129, 29 Jul 2026).
>
> Ada migrasi DB (`0089`): enum `pesanan_status`, kolom baru di `sales` &
> `open_bills`, tabel `pesanan_logs`.

Sebelum ini sistem **tak punya konsep status pesanan sama sekali**. Baris
`sales` lahir sudah-dibayar dan tak pernah berubah lagi; satu-satunya artefak
"belum selesai" adalah open bill, yang **hanya bisa dibaca kasir**. Dapur tak
punya layar kerja apa pun untuk pesanan pelanggan — jadi pesanan "tertinggal"
tanpa ada tempat mengeceknya.

> **Papannya sendiri layar komputer cabang — mobile tak perlu membangunnya.**
> Tapi JANGAN lewati entri ini: bagian 🔴 WAJIB di bawah mengubah perilaku
> `POST /api/penjualan`, dan justru mobile yang paling terdampak karena
> **antrean sinkron offline** (`POST /api/sync`) memang mengirim ulang
> transaksi yang sama.

### 🟢 BARU — `GET /api/pesanan` dan kawan-kawannya

Papan menggabungkan **open bill yang belum dibayar** + **penjualan hari ini**
jadi satu daftar kartu, dan bisa dibaca peran `kitchen`/`bar`/`tim` — bukan
hanya kasir. Detail lengkap: blok `/api/pesanan` di `docs/API-CONTRACT.md`.

| Endpoint | Guna |
| --- | --- |
| `GET /api/pesanan` | daftar kartu (`PesananRow[]`), item disertakan inline |
| `POST /api/pesanan/:jenis/:id/status` | `dikerjakan` / `selesai` / `batal` |
| `POST /api/pesanan/:jenis/:id/sajian` | penanda bawa pulang |
| `GET /api/pesanan/:jenis/:id/log` | "siapa menandai apa, kapan" |

`:jenis` = `open_bill` atau `penjualan`. Status **ikut terbawa** saat bill
dibayar, jadi satu pesanan tetap satu kartu — bukan dua.

> **Sudah disusul rilis berikutnya.** Status pindah ke **tiap baris**; kedua
> endpoint `status`/`sajian` di atas kini pintasan "semua baris", dan ada versi
> `.../item/:itemId/...` yang menjadi tombol utamanya. Lihat entri **"Status
> pesanan turun ke SETIAP BARIS"** di paling atas dokumen ini.

### 🔴 WAJIB — jangan lagi kirim `DELETE /api/open-bill/:id` setelah membayar

`POST /api/penjualan` dengan `open_bill_id` sekarang **menutup bill-nya sendiri
di dalam transaksi yang sama**. Dua akibat langsung untuk klien:

- **Hapus panggilan `DELETE` sesudah bayar.** Sudah mubazir. Web dulu
  mengirimnya *fire-and-forget* (gagal diam-diam saat jaringan putus) dan jalur
  `POST /api/sync` **tak pernah** mengirimnya sama sekali — jadi bill hantu
  memang sudah menumpuk, cuma belum terlihat karena daftarnya hanya dibuka
  kasir. Begitu papan menayangkannya, hantu itu jadi kartu ganda.
- **Membayar bill yang sudah ditutup → `409`.** Tombol bayar tertekan dua kali
  atau antrean offline yang mengirim ulang tak lagi menghasilkan dua transaksi.
  Perlakukan `409` sebagai "sudah berhasil sebelumnya", bukan kegagalan.

`DELETE /api/open-bill/:id` sendiri **tidak dihapus** — sekarang ia
*membatalkan* (status `batal` + baris riwayat). Bill tetap hilang dari
`GET /api/open-bill` dan `GET /api/open-bill/:id` → `404` seperti dulu, jadi
alur "batalkan bill" di klien tak perlu diubah.

### 🟡 PERLU DICEK — `RiwayatTransaksiRow.sajian_takeaway`

Field baru pada daftar `GET /api/penjualan`. **Bukan pengganti `is_dine_in`.**

- `is_dine_in` = fakta pembukuan; nota, laporan, dan perhitungan bahan tetap
  memakainya. Tombol bawa-pulang di papan **tidak** menyentuhnya.
- `sajian_takeaway` = instruksi penyajian, boleh diubah dapur setelah transaksi.

Penandanya **lahir sesuai pembukuannya** (`sajian_takeaway = !is_dine_in`),
sehingga `sajian_takeaway == is_dine_in` berarti memang ada yang mengubahnya —
itu sinyal untuk badge "diubah setelah transaksi". Transaksi lama diselaraskan
otomatis saat server boot, jadi tak ada baris warisan yang salah tanda.

> **Risiko yang disadari:** `sales.pesanan_status` lahir NOT NULL DEFAULT
> `dikerjakan`, sehingga SELURUH penjualan lama bernilai `dikerjakan`. Papan
> menyaring per tanggal jadi baris lama tak pernah tampil, tapi laporan apa pun
> yang kelak menghitung "pesanan belum selesai" lintas tanggal akan salah bila
> tidak membatasi tanggalnya.

---

## Rilis: Detail produksi — BERAPA BATCH, bukan cuma gramnya (`batch_teks`)

> **Sudah di-merge ke production** (PR #128).
>
> Tidak ada migrasi DB. Dua field baru pada baris `GET /api/produksi` &
> `GET /api/pembelian`; keduanya **aditif dan opsional**.

Keluhan yang memicunya, dari layar Detail Produksi (web DAN mobile):

> *"tidak ada jumlah batch yang harus dikerjakan, hanya jumlah gramnya saja.
> Lalu tidak ada kepala tabelnya — ini 2.000 gram itu apa, terus '—' itu apa?"*

### 🟢 BARU — `batch` & `batch_teks`

`qty` menjawab **"jadinya berapa"**. Yang dikerjakan orang di dapur adalah
**mengulang resep sekian kali** — dan itu tak pernah dikirim ke klien mana pun,
jadi pelaksana harus membagi sendiri di kepala tiap kali membuka faktur.

| Field | Isi |
| --- | --- |
| `batch` | `number \| null` — mis. `3` (= `qty ÷ isi`) |
| `batch_teks` | `string \| null` — mis. `"3 batch × 700 ml"` |

`null` pada **bahan beli** (tak punya resep) dan saat `isi ≤ 1` (tak ada
pengelompokan batch — `"2.100 batch × 1 ml"` tak berarti). Bila pembagiannya tak
bulat, teksnya diberi awalan `≈` (mis. `"≈ 2,36 batch × 700 ml"`) supaya tak
terbaca sebagai angka bulat.

Tampilkan **di samping/bawah `qty_teks`, jangan menggantikannya** — keduanya
menjawab pertanyaan berbeda: berapa hasilnya, vs berapa kali masak. Teksnya
ditulis server (fungsi yang sama dipakai web) supaya keduanya mustahil berbeda,
persis alasan `qty_teks` dulu dibuat.

### 🟡 PERLU DICEK — tabel baris faktur butuh KEPALA KOLOM

Ini bukan perubahan API, tapi keluhannya menyebut mobile juga. Di web, tabel
baris faktur tak punya `<thead>` sama sekali: pembaca melihat `+2.100 ml` dan
`—` tanpa tahu kolomnya apa. Sudah diperbaiki jadi:

| Bahan diproduksi | Hasil & batch | Rak simpan |
| --- | --- | --- |
| Sambal chilli oil 📖 resep | +2.100 ml<br>🍳 3 batch × 700 ml | — |

(Untuk faktur beli: **Bahan dibeli / Jumlah / Rak simpan / Biaya**.) Kolom "—"
yang membingungkan itu adalah **rak simpan**, memang kosong sampai barang masuk
stok. Mohon beri label serupa di mobile.

---

## Rilis: Tutup kasir HITUNG BUTA + kunci hitungan + ACC selisih owner

> **Sudah di-merge ke production** (PR #127, 28 Jul 2026) — menjawab pertanyaan
> nomor 3 di balasan mobile. `POST /shift/kunci-hitungan` yang sebelumnya **404**
> kini aktif; fallback Tingkat 1 di mobile boleh tetap dipertahankan sebagai
> jaring pengaman, tapi sejak rilis ini `•••` datang dari server, bukan dari UI.
>
> Migrasi DB **0087** (`shifts.selisih_status` dkk) & **0088**
> (`shifts.hitungan_dikunci_at`) — semuanya nullable, shift lama tetap sah.

**Kontrak ini menjawab usulan `PROMPTBACKENDSELISIHKAS.md` dari tim mobile.**
Usulan itu diterima hampir seluruhnya, termasuk tiga hal yang lebih baik dari
rancangan awal server: `penjualan_tunai` **tidak** dikirim 0, `status_selisih`
punya nilai `'pas'` tersendiri, dan ada endpoint pengunci hitungan. Perbedaan
penamaan yang tersisa disebut eksplisit di bawah — server sudah **mengikuti
penamaan mobile**, jadi tak ada yang perlu diubah di sisi mobile kecuali yang
ditandai.

Server memilih **Tingkat 2** (buta di server). Tingkat 1 (buta di UI saja)
tetap jalan tanpa perubahan — lihat "jalur satu langkah" di bawah.

### 🔴 WAJIB — nama field berubah & tipe melonggar

Field pada `Shift` **berganti nama**, mengikuti usulan mobile:

| Lama | Baru |
| --- | --- |
| `buta` | `hitung_buta` |
| `selisih_status` | `status_selisih` |
| `disetujui_oleh` | `selisih_disetujui_oleh` |
| `disetujui_pada` | `selisih_diputus_pada` |
| `tolak_alasan` | `alasan_tolak` |

Dan tipe yang melonggar:

| Field | Dulu | Sekarang |
| --- | --- | --- |
| `kas_sistem` | `number` | `number \| null` |
| `penjualan_tunai` | `number` | `number \| null` |

### 🔴 WAJIB — `penjualan_tunai` bisa `null`, **bukan 0**

Untuk peran terkunci cabang (kasir/tim), selagi shift **terbuka** DAN hitungan
**belum dikunci**:

| Field | Nilai |
| --- | --- |
| `hitung_buta` | `true` |
| `kas_sistem` | `null` |
| `penjualan_tunai` | `null` |
| `selisih` | `null` |
| `modal_awal`, `jumlah_transaksi`, non-tunai | tetap terisi |

Mobile benar: mengirim `0` adalah kebohongan yang tak bisa dibedakan dari "belum
ada penjualan tunai hari ini". Server sekarang mengirim `null`. Tampilkan `•••`
bila `hitung_buta`, jangan `Rp 0`.

`modal_awal` **tidak** ikut disembunyikan (usulan mobile menyebutnya) — itu
angka yang kasir sendiri ketik saat buka kasir, dan tanpa `penjualan_tunai` ia
tak membocorkan apa pun.

**Jangan menghitung sendiri `modal_awal + penjualan_tunai` sebagai pengganti** —
itu persis yang dicegah.

### 🟢 BARU — `POST /api/shift/kunci-hitungan` (momen reveal)

```
POST /api/shift/kunci-hitungan   body: { "uang_fisik": number }
→ 200 { uang_fisik, kas_sistem, selisih }
```

Persis seperti usulan mobile. Setelah ini `GET /shift/aktif` berhenti membutakan
(shift belum ditutup), jadi layar bisa langsung menampilkan angka lengkap.

- Nominal **berbeda** dikirim ulang → **409**, body `{ error, uang_fisik,
  kas_sistem, selisih }` berisi nominal **pertama**.
- Nominal **sama** dikirim ulang → tetap **200**. Retry jaringan bukan
  kecurangan, dan menolaknya akan menyandera shift.

Tombol **Kunci hitungan** yang sudah mobile buat cocok langsung ke endpoint ini.

Baca status penguncian dari `Shift.uang_fisik != null` (dan `ditutup_pada ==
null`), **bukan** dari state lokal — kalau aplikasi ditutup di antara mengunci
dan menutup, kasir harus mendarat di langkah yang sama, bukan disuruh menghitung
ulang.

### ⚪️ `selisih_alasan` — jawabannya (a) **dan** (b)

Body `POST /shift/tutup` lengkapnya:

```
{ uang_fisik?: number(≥0)|null, catatan?: string|null,
  selisih_alasan?: string|null (max 300) }
```

- **(a) benar** — bila `selisih ≠ 0` dan `selisih_alasan` tak dikirim, server
  menyalin `catatan` ke `selisih_alasan`. **Mobile tidak perlu berubah.**
- **(b) juga benar** — `selisih_alasan` diterima sebagai field terpisah, dan
  menang bila keduanya dikirim. Pakai ini kalau nanti mau memisahkan "catatan
  penutupan" dari "alasan selisih" di UI.

Urutannya: `selisih_alasan?.trim() || catatan?.trim() || null`, dan hanya
diisi saat `selisih ≠ 0` (shift `pas` menyimpan `catatan` saja).

**Soal kekhawatiran field asing:** validasinya **tidak** strict — field yang tak
dikenal diabaikan (di-strip), bukan ditolak. Jadi mengirim field yang belum
pasti diterima tak akan menggagalkan penutupan shift. Sudah dikunci di
verify-api: penutupan diuji dengan satu field karangan ikut di body.

### 🟡 PERLU DICEK — `POST /shift/tutup`: `uang_fisik` jadi opsional

- Sudah `kunci-hitungan` → `uang_fisik` boleh dihilangkan (diambil dari yang
  terkunci). Bila tetap dikirim dan **berbeda** → **409**.
- Belum mengunci → `uang_fisik` **wajib**; tanpa itu **400**. Inilah jalur satu
  langkah, jadi klien Tingkat 1 tetap berjalan tanpa perubahan kode.

### 🟢 BARU — `status_selisih` punya nilai `'pas'`

| Nilai | Arti |
| --- | --- |
| `null` | shift masih **terbuka** — belum ada yang dinilai |
| `"pas"` | sudah ditutup, uang fisik sama dengan kas sistem, tak perlu persetujuan |
| `"menunggu"` | ada selisih, owner/admin belum memutuskan |
| `"disetujui"` / `"ditolak"` | sudah diputuskan |

Usulan mobile diterima: memakai `null` untuk dua makna sekaligus membuat klien
tak bisa membedakan "belum ditutup" dari "tidak ada selisih".

Ambang "pas" adalah **0,005** — itu murni pembulatan `numeric(14,2)`, **bukan**
toleransi bisnis (lihat jawaban pertanyaan 1).

Field pendamping: `selisih_alasan` (keterangan kasir), `selisih_disetujui_oleh`,
`selisih_diputus_pada`, `alasan_tolak`, dan `hitungan_dikunci_pada`
(ISO `string | null` — jejak audit, `null` bila ditutup satu langkah tanpa
mengunci; boleh tidak ditampilkan).

`POST /shift/tutup` mengisi `status_selisih` otomatis. Kasir tak pernah bisa
mengubahnya.

**`selisih_disetujui_oleh` terisi saat DITOLAK juga.** Namanya memang warisan
kolom DB dan menyesatkan — maknanya **pemutus**, bukan "yang menyetujui". Parsing
mobile ("diputus oleh" untuk kedua kasus) sudah benar; tak ada field lain yang
diisi saat penolakan. Namanya sengaja tidak diubah lagi karena mobile sudah
rilis dengan nama ini — pasangannya `selisih_diputus_pada` menegaskan maknanya.

**Field putusan ada di SEMUA endpoint yang mengembalikan `Shift`** — termasuk
`GET /shift` (riwayat cabang), jadi penanda "⏳ menunggu / ✅ disetujui / ❌
ditolak" di layar Tutup Kasir memang berfungsi: kasir bisa melihat nasib
selisihnya sendiri tanpa akses ke layar owner. Daftarnya: `GET /shift/aktif`,
`GET /shift`, `GET /shift/:id`, respons `POST /shift/tutup`, dan respons
`POST /shift/:id/selisih/putuskan`. Keduanya dikunci di verify-api.

### 🟢 BARU — putusan owner & daftar yang menunggu

```
POST /api/shift/:id/selisih/putuskan
body: { "status": "disetujui" | "ditolak", "alasan_tolak"?: string }
```

- **409** bila sudah pernah diputuskan — *"Selisih shift ini sudah disetujui —
  tidak bisa diputuskan lagi"*, pola sama dengan `POST /pengajuan/:id/putuskan`.
- `alasan_tolak` **wajib** saat `ditolak` (400 bila kosong).
- Tidak mengubah angka apa pun; kasir yang memanggilnya dapat **403**.

```
GET /api/shift/selisih?status=menunggu[&branch_id=]
→ SelisihKasRow[]  (maks 50, urut tutup terbaru)
   { id, branch_nama, ditutup_oleh, ditutup_pada, kas_sistem,
     uang_fisik, selisih, catatan, status_selisih }
```

`status` menerima `pas` / `menunggu` / `disetujui` / `ditolak` (default
`menunggu`). `catatan` = `selisih_alasan` bila ada, jika tidak `catatan`
penutupan. Owner/admin saja (**403** untuk kasir).

Sengaja **tidak** ditempel ke `GET /shift/pantau` seperti alternatif yang mobile
tawarkan: `/pantau` bicara soal shift yang sedang berjalan **hari ini**, satu
baris per cabang — sedangkan selisih yang menunggu bisa berasal dari shift
kemarin di cabang yang hari ini belum buka. Baris itu takkan pernah punya tempat
di `/pantau`.

### ⚪️ Jawaban tiga pertanyaan di dokumen mobile

1. **Ambang toleransi selisih?** ~~Tidak ada~~ — **disepakati BELUM dipasang**
   (balasan mobile). Catatan aslinya tetap di sini sebagai alasan:
   tidak ada, dan sengaja belum dibuat.
   `0,005` di server murni pembulatan desimal. Toleransi bisnis (mis. "≤ Rp1.000
   dianggap pas") adalah **kebijakan perusahaan**, bukan konstanta — dan
   memasangnya sekarang berarti selisih di bawah ambang tak pernah sampai ke
   owner. Kalau memang diinginkan, server akan menambahkannya sebagai setelan
   perusahaan dan mengirimkannya sebagai `ambang_selisih` supaya web & mobile
   tidak menghitung sendiri-sendiri. Beri tahu saja.
2. **Setelah owner menolak?** Asumsi mobile **benar**: shift tetap tertutup,
   angka tidak diubah sama sekali, dan kasir tidak diminta menghitung ulang.
   Penolakan hanyalah penanda untuk ditindaklanjuti di luar aplikasi. Server
   memang tak menyediakan jalan untuk membuka kembali shift yang sudah ditutup.
3. **Notifikasi owner?** Ya — `GET /shift/selisih?status=menunggu` adalah sumber
   badge-nya; jumlah barisnya = angka di badge. Web memakai endpoint yang sama
   dan mem-poll tiap 60 detik saat halaman Operasional terbuka.

### ⚪️ Web sudah ikut dibenahi

Laporan lapangan yang memicu pekerjaan ini ("Kas seharusnya Rp 255.000"
terpampang di atas kolom uang fisik yang masih kosong) datang dari layar **web**,
dan halaman itu **sudah** ikut diubah di PR yang sama — bukan hanya server:
Tutup Kasir kini dua langkah (isi nominal → **Kunci Hitungan** → angka terbuka →
tutup), dan sebelum dikunci semua angka tunai tampil `•••`. Jadi begitu rilis ini
tayang, web dan mobile menutup celah yang sama pada hari yang sama.

### ⚪️ Catatan operasional

Kasir salah ketik nominal lalu terlanjur mengunci **tidak bisa membatalkannya**
— itu konsekuensi yang disengaja dari anti-pancing. Yang terjadi: shift ditutup
dengan selisih besar, lalu **owner menolaknya**. Alurnya sudah menangani kasus
ini; tak ada shift yang tersangkut. Kalau di lapangan ternyata terlalu sering,
server bisa menambah "buka kunci" khusus owner — sebut saja.

---

## Rilis: Realisasi qty boleh lebih dari RAB

> **Sudah di-merge ke production** (PR #127).
>
> Tidak ada migrasi DB. **Satu batasan dicabut** di `POST /api/{mod}/tahap/:id`,
> plus satu field baru di baris faktur.

### 🔴 WAJIB — `items[].qty` tak lagi dibatasi qty baris

Dulu `items[].qty` yang melebihi qty baris ditolak **400** (*"Qty maju melebihi
qty baris"*). Itu keliru: RAB adalah **rencana**, bukan pagu. Sayur
direncanakan 900 gr tapi hanya dijual per kilo → yang benar-benar dibeli
1.000 gr, dan angka itulah yang harus tercatat.

Sekarang satu-satunya batas adalah **qty > 0**.

| `items[].qty` vs qty baris | Yang terjadi |
| --- | --- |
| **kurang** | **split** — bagian yang maju jadi baris BARU, sisanya tetap jadi tugas |
| **sama** | seluruh baris maju apa adanya |
| **lebih** | seluruh baris maju, `qty` **diperbarui ke angka realisasi**; tak ada sisa tugas |

**Klien yang memblokir input di sisi UI (`max = qty baris`) harus melepasnya** —
kalau tidak, kasus paling umum (beli per kemasan) tetap mustahil dicatat.

### 🟢 BARU — `harga_tebakan` pada baris `GET /api/produksi` & `/api/pembelian`

`true` = `total_harga` baris itu **belum pernah dilihat manusia**: estimasi RAB,
belanja otomatis, atau hasil skala saat realisasi melebihi rencana. Baris
bertanda ini **dikecualikan dari kolam median harga acuan** — tanpa itu harga
acuan menyeret dirinya sendiri naik.

Berguna untuk menandai di UI mana harga yang masih perkiraan.

⚪️ **Harga saat qty lebih:** kirim `items[].harga` bila tahu harga riilnya —
itu menang dan menandai baris `harga_tebakan: false`. Bila tidak, server
menskalakan harga RAB (`total_harga × qty_baru ÷ qty_lama`) dan menandainya
`harga_tebakan: true`.

---

## Rilis: Isi menu untuk pembeli (`MenuDto.deskripsi`)

> **Sudah di-merge ke production** (PR #126) — endpoint sudah mengirim
> `deskripsi` sejak saat itu.
>
> Migrasi DB **0086** (`menus.deskripsi`, nullable — tak ada backfill, menu lama
> bernilai `null`). **Tak ada yang rusak**: field baru, opsional.

### 🟢 BARU — `MenuDto.deskripsi`

Daftar menu kini bisa memuat **isi tiap menu** untuk pembeli:

```
Premium Basooopa A (PBA)                                Rp 34.000
  1 baso urat besar, 2 baso kecil, 2 baso aci, 1 mie
```

| Field | Isi |
| --- | --- |
| `deskripsi` | `"1 baso urat besar, 2 baso kecil, 1 mie"` atau `null` |

Tampilkan di bawah nama menu (teks kecil, warna redup) pada layar daftar menu
dan kartu menu kasir. `null` → jangan tampilkan baris apa pun.

**Dikirim & diterima di:** `GET /api/menu`, `GET /api/menu/:id`,
`POST /api/menu`, `PUT /api/menu/:id`. Maksimum 500 karakter; `""` atau spasi
saja disimpan sebagai `null`, jadi klien cukup memeriksa satu bentuk "kosong".

⚠️ `PUT /api/menu/:id` tetap **perbarui-sebagian**: tak mengirim `deskripsi`
berarti isi menu lama dipertahankan. Kirim `""` atau `null` eksplisit untuk
mengosongkannya.

### ⚪️ INFO — kenapa BUKAN diturunkan dari `komponen`

Godaan pertamanya adalah menyusun teks ini otomatis dari resep. Data nyata
menunjukkan itu salah: resep adalah dokumen **biaya**, bukan deskripsi hidangan.

- Takarannya boleh pecahan hasil konversi gram — di katalog Basooopa ada baris
  `0,7576 butir Baso halus kecil`, yang mustahil dicetak di daftar menu.
- Memuat KEMASAN (kresek/plastik take away) dan PELENGKAP (saos & sambal) yang
  bukan "isi" yang dijanjikan ke pembeli.
- Angkanya pun kerap berbeda dari yang ingin diiklankan: resep menyebut
  3 baso aci, sementara menu cetaknya menulis 2.

Web menyediakan tombol **"Ambil dari resep"** yang hanya membuat **draf**
(kemasan & pelengkap dibuang, pecahan dibulatkan ke atas), lalu teksnya
dirapikan pemilik. Mobile tak perlu meniru tombol itu — cukup **tampilkan
`deskripsi` apa adanya**.

---

## Rilis: Satuan kiriman ditulis SERVER (`qty_teks`)

> **Sudah di-merge ke production** (PR #125).
>
> **Tidak ada migrasi DB.** Lanjutan langsung dari koreksi satuan di bawah —
> kali ini bukan cuma dokumentasi, tapi field baru yang membuat salah satuan
> tidak mungkin lagi terjadi.

### 🔴 WAJIB — pakai `qty_teks`, berhenti merangkai satuan sendiri

Koreksi kontrak di bawah menjelaskan bahwa `qty` selalu dalam `satuan`. Karena
mobile ditulis Flutter (tak bisa mengimpor paket `shared` yang dipakai web),
aturan itu tetap harus diketik ulang di sisi mobile — dan di situlah "900 kg"
lahir. Sekarang **server yang menulis teksnya**, jadi tak ada lagi yang perlu
ditebak:

| Field baru | Isi | Sifat |
| --- | --- | --- |
| `qty_teks` | `"900 gr"` | **tampilkan apa adanya** |
| `qty_setara` | `"≈ 0,9 kg"` / `null` | pelengkap — boleh di samping, **tak boleh menggantikan** |

```dart
// ❌ jangan lagi
Text('${row.qty} ${row.satuanBeli ?? row.satuan}');

// ✅ cukup
Text(row.qtyTeks);
if (row.qtySetara != null) Text(row.qtySetara!, style: kecilAbuAbu);
```

Angkanya sudah diformat gaya Indonesia (`2.000`, `0,9`) — jangan diformat ulang.
`qty` mentah tetap dikirim untuk perhitungan; `qty_teks` khusus tampilan.

**Endpoint yang sudah membawanya:**

| Endpoint | Field |
| --- | --- |
| `GET /api/transfer-stok` (`items[]`) | `qty_teks`, `qty_setara` |
| `GET /api/transfer-stok/saldo` | `tersedia_teks`, `tersedia_setara` (sisa siap kirim) |
| `GET /api/penerimaan` | `qty_teks`, `qty_setara`, `qty_dipesan_teks` |
| `GET /api/produksi`, `GET /api/pembelian` | `qty_teks`, `qty_setara` |

Empat kasus dari faktur PB-0058 dikunci uji otomatis dan sekarang berbunyi:

| Bahan | `qty_teks` | `qty_setara` |
| --- | --- | --- |
| Sayur | `900 gr` | `≈ 0,9 kg` |
| Mie basah | `2.000 gr` | `2 kg` |
| Air Mineral 330 ml | `24 botol` | `1 dus` |
| Air biasa | `15.000 ml` | `15 liter` |

⚪️ `satuan`, `satuan_beli`, `isi`, dan `is_batch` **tetap dikirim** — tak ada
yang dihapus, jadi layar yang belum diperbarui tidak rusak. Tapi selama masih
merangkai sendiri, layar itu masih menampilkan satuan yang salah.

---

## Rilis: Kiriman ikut aturan kemasan belanja

> **Sudah di-merge ke production** (PR #125).
>
> **Tidak ada migrasi DB.** Satu aturan validasi baru pada dua endpoint kiriman,
> plus tiga field baru di `TransferStokSaldoRow`.

### 🔴 WAJIB — qty kiriman ditolak bila bukan kelipatan kemasan

Barang yang hanya bisa **DIBELI** per kemasan utuh sekarang juga hanya boleh
**DIKIRIM** per kemasan utuh. Sayur yang dibeli per kg tak bisa dikirim 900 gr.

Berlaku di:

- `POST /api/transfer-stok`
- `POST /api/produksi/kirim-hasil/:fakturId`

**Kapan aturannya menyala** — ketiganya harus benar:

| Syarat | Nilai |
| --- | --- |
| `pengadaan` | `"beli"` |
| `isi` | `> 1` |
| `boleh_eceran` | `false` |

Lalu `qty` (selalu dalam `satuan` kerja — lihat koreksi satuan di bawah) wajib
kelipatan `isi`.

**Bahan `pengadaan: "produksi"` SENGAJA tidak ikut aturan ini.** Di sana `isi`
adalah **ukuran batch**, bukan kemasan fisik: CK memproduksi 100 butir baso lalu
mengirim 40 butir ke cabang adalah alur normal, dan mengunci kelipatan 100 akan
membuat cabang tak bisa dilayani.

**Pengecualian "kirim habis":** bila `qty` sama persis dengan seluruh sisa yang
boleh dikirim (`saldo − dalam_jalan`), kiriman tetap diterima walau bukan
kelipatan. Tanpa ini sisa 900 gr terjebak selamanya di gudang asal.

Pesan 400-nya sudah bisa langsung ditampilkan apa adanya:

```
"Sayur" hanya bisa dikirim per kemasan penuh — 1 kg = 1000 gr.
Kirim 1000 atau 2000 gr, bukan 1500 gr.
```

### 🟢 BARU — `TransferStokSaldoRow` += `isi`, `satuan_beli`, `wajib_kelipatan`

`GET /api/transfer-stok/saldo` kini mengirim bahan yang dibutuhkan untuk
memvalidasi di sisi UI, **sebelum** user menunggu 400 dari server:

```dart
bool qtySalah(SaldoRow r, double qty) {
  if (!r.wajibKelipatan || r.isi <= 1) return false;
  final sisa = r.saldo - r.dalamJalan;
  if ((qty - sisa).abs() < 1e-6) return false;      // kirim habis
  final k = qty / r.isi;
  return (k - k.roundToDouble()).abs() >= 1e-6;
}
```

Tampilkan petunjuknya di bawah input qty, mis.
*"Kelipatan 1000 gr (1 kg) — kirim 1000 atau 2000 gr"*. Web sudah melakukan ini
di halaman Transfer Stok; mobile sebaiknya sama supaya user tak kena tolak
mendadak.

⚪️ Urutan pemeriksaan di server: **kecukupan stok dulu**, kelipatan kemasan
belakangan. Jadi qty melebihi stok tetap memberi pesan "stok kurang", bukan
pesan kemasan yang menyesatkan.

---

## Koreksi kontrak: satuan baris faktur (`qty` vs `satuan_beli` vs `is_batch`)

> **Tidak ada perubahan API.** Ini klarifikasi kontrak yang selama ini kurang
> tegas — dan satu bug tampilan di aplikasi mobile yang perlu diperbaiki.

### 🔴 WAJIB — baris faktur di mobile menampilkan satuan yang salah

Pada faktur yang sama (PB-0058), web dan mobile menulis angka yang **sama persis**
tapi satuan yang **berbeda**:

| Bahan | Web (benar) | Mobile (salah) |
| --- | --- | --- |
| Sayur | `900 gr` | `900 kg` ← beda **1000×** |
| Mie basah | `2.000 gr` | `2000 batch` |
| Air Mineral 330 ml | `24 botol` | `24 batch` |
| Air biasa | `15.000 ml` | `15000 batch` |

Angkanya tidak salah — **labelnya** yang salah. Mobile memasangkan `qty` dengan
`satuan_beli` (atau dengan kata "batch" saat `is_batch` true), padahal:

**`qty` SELALU dinyatakan dalam `satuan` (satuan kerja/resep).**

Saat faktur dibuat, server sudah mengonversi input ke satuan kerja —
`qty = mode === "batch" ? jumlah × isi : jumlah`. Jadi begitu baris tersimpan,
`qty` tidak pernah lagi berada dalam satuan kemasan, **sekalipun `is_batch`
true**. `is_batch` itu catatan **cara input**, bukan satuan.

**Perbaikannya satu baris:** tampilkan `qty` bersama **`satuan`**.

```dart
// ❌ salah — dua-duanya bikin 900 gr terbaca sebagai 900 kg / 900 batch
final label = row.isBatch ? 'batch' : (row.satuanBeli ?? row.satuan);

// ✅ benar
final label = row.satuan;
```

`satuan_beli` hanya untuk **input pembelian** dan **dokumen belanja**. Bila
memang mau menampilkan setara kemasannya, hitung `qty ÷ isi` dan lewati bila
`satuan_beli` null atau `isi ≤ 1` — mis. Sayur `900 ÷ 1000` → "≈ 0,9 kg".

Tabel lengkapnya ada di `docs/API-CONTRACT.md` bagian
`/api/produksi` dan `/api/pembelian`.

---

## Rilis: Tiga angka yang tak boleh berubah diam-diam

> **Sudah di-merge ke production** (PR #125).
>
> Migrasi DB **0085** (`open_bill_items.harga_satuan` + `menu_nama`).
> **Dua kontrak berubah** — `PUT /api/menu/:id` dan `OpenBillItemDto`. Baca 🔴
> dan 🟡 di bawah sebelum rilis berikutnya.

### 🔴 WAJIB — `PUT /api/menu/:id` sekarang PERBARUI SEBAGIAN

Dulu `PUT` memakai skema yang sama dengan `POST`, lengkap dengan nilai default.
Artinya klien yang hanya ingin mengganti satu field **ikut menghapus** yang lain:

| Tidak dikirim | Dulu | Sekarang |
| --- | --- | --- |
| `komponen` | **seluruh resep menu terhapus** | resep dipertahankan |
| `image_url` | foto terhapus | foto dipertahankan |
| `is_active` | menu terarsip **aktif kembali** | status dipertahankan |
| `kode` | kode digenerate ulang | kode lama dipertahankan |
| `branch_ids` | (sudah dipertahankan) | tak berubah |

Sekarang **`undefined` = jangan sentuh**; `null`/`[]` eksplisit tetap berarti
"kosongkan" (`{"komponen":[]}` mengosongkan resep, `{"image_url":null}` menghapus
foto, `{"kode":""}` menggenerate ulang kode).

**Yang perlu dikerjakan:**
- Kirim `PUT` **parsial** untuk edit sebagian — jauh lebih aman dan kini sah,
  termasuk `PUT {"harga_jual":25000}` saja (validasi paket/reguler dijalankan
  atas nilai hasil gabungan, jadi tak lagi ditolak "wajib punya mult").
- **Bila selama ini mengandalkan ganti-total untuk mengosongkan resep**, mulai
  kirim `komponen: []` eksplisit.
- Klien yang memang selalu mengirim body penuh **tidak perlu berubah apa pun**.

### 🔴 WAJIB — open bill mengunci harga; kirim `open_bill_id` saat bayar

`open_bill_items` dulu hanya menyimpan `menu_id` + `qty`, jadi bill yang dibuka
hari ini lalu dibayar besok ditagih harga menu **terbaru** — bukan harga yang
disepakati pembeli. Sekarang tiap baris membawa `harga_satuan` dan `menu_nama`
hasil snapshot **server** saat baris dibuat.

`OpenBillItemDto` bertambah tiga field: **`id`**, `menu_nama`, `harga_satuan`.

**Yang perlu dikerjakan:**
1. **Tampilkan/hitung total bill dari `harga_satuan`**, bukan dari `harga_jual`
   di katalog menu. Bila keduanya berbeda, beri tanda bahwa yang berlaku adalah
   harga saat memesan.
2. **`PUT /api/open-bill/:id` → sertakan `items[].id`** untuk baris yang sudah
   ada. Server memasangkan baris kiriman ke baris lama: `id` dulu, lalu sisanya
   dicocokkan per `menu_id` berurutan — jadi klien lama yang belum mengirim `id`
   **tetap aman**, kecuali bila satu menu muncul di lebih dari satu baris. Baris
   tanpa pasangan = tambahan baru → memakai harga hari ini.
3. **Saat membayar (`POST /api/penjualan`)** kirim `open_bill_id` transaksi +
   `items[].open_bill_item_id` per baris yang berasal dari bill. Tanpa itu,
   pembayaran memakai harga menu hari ini dan kuncinya sia-sia.
   Server menolak **400** bila `open_bill_item_id` bukan milik bill tersebut,
   tak cocok `menu_id`-nya, atau dikirim tanpa `open_bill_id`; **404** bila
   bill-nya bukan milik cabang itu. `qty` bebas berubah saat pembayaran.

Yang dikunci hanya **harga jual**. `hpp_satuan` tetap dihitung saat pembayaran
dari resep × harga acuan bahan saat itu — biaya bahan memang biaya saat
disajikan.

> **Data lama:** bill yang masih terbuka saat migrasi dikunci ke harga menu
> **saat migrasi** — harga saat bill itu dibuat memang tak pernah tersimpan.

### 🟡 PERLU DICEK — setelan Metode HPP kini benar-benar dipakai (dan labelnya dikoreksi)

Setelan `companies.metode_hpp` tersimpan tapi tak pernah dibaca: kartu
persediaan **selalu** FIFO apa pun pilihan owner. Sekarang setelan itu
dihormati di `GET /api/stok/fifo/:ingredientId`.

- **Aliran barang tetap FIFO** — `lots[].terpakai`/`sisa`, kedaluwarsa, dan
  `saldo` tidak berubah sedikit pun. Yang mengikuti setelan hanya
  `pemakaian[].hpp`.
- Mode `average` memakai **rata-rata bergerak** seluruh sisa stok sesaat sebelum
  barang keluar. Di mode ini `pemakaian[].rincian` (lot fisik yang keluar)
  **sengaja tidak menjumlah** ke `hpp` — jangan tampilkan seolah-olah begitu.
- `FifoPemakaian` bertambah **`harga_rata: number | null`** — terisi hanya di
  mode `average`, dan `null` bila rata-ratanya tak bisa dihitung (ada sisa lot
  tanpa harga, atau qty jatuh ke stok minus).
- **Dampak angka:** perusahaan bermetode `average` (nilai bawaan) akan melihat
  `hpp` pemakaian **berbeda dari sebelumnya**. Angkanya sekarang benar; yang
  dulu keliru.

⚪️ **INFO — HPP di laporan laba-rugi TIDAK memakai setelan ini** dan tidak
pernah memakainya. `sale_items.hpp_satuan` dikunci saat pembayaran dari
**resep × harga acuan bahan** saat itu, lalu laporan menjumlah snapshot itu.
Teks bantu di aplikasi web yang menyebut setelan ini "dasar hitung laba-rugi"
sudah dikoreksi — samakan bila layar mobile menyalin kalimat lamanya.

---

## Rilis: Harga menu berubah sendiri — lacak, setop, perbaiki

> Migrasi DB **0084** (`companies.food_cost_maks`, `productions.harga_tebakan`,
> tabel `menu_price_logs`). **Tidak ada endpoint lama yang berubah kontraknya.**
> Satu perubahan **perilaku** di `POST /api/pembelian/laporan-harga/:fakturId` —
> baca 🟡 di bawah.

### Latar: kenapa food cost naik tanpa ada yang mengubah harga jual

`hpp`, `harga_saran`, `harga_jual_bulat`, dan `food_cost_persen` **tidak pernah
disimpan** — server menghitungnya ulang tiap request dari `ingredients.harga_beli
÷ isi` yang berlaku saat itu. Yang tersimpan hanya `menus.harga_jual`. Karena
`food_cost = hpp ÷ harga_jual`, food cost bisa melonjak serempak di semua menu
walau tak satu pun menu disimpan ulang. **Jangan cache `hpp`/`food_cost_persen`
di sisi klien lebih lama dari daftar menunya sendiri.**

### 🟡 PERLU DICEK — kolam median harga acuan kini menyaring TEBAKAN

`POST /api/pembelian/laporan-harga/:fakturId` menyegarkan `ingredients.harga_beli`
ke **median** riwayat pembelian. Sebelumnya kolam median memuat semua lot
dikonfirmasi yang punya `total_harga` — termasuk baris faktur yang dibuat
**tanpa** harga, yang `total_harga`-nya cuma tebakan `qty × harga acuan saat itu`.
Akibatnya harga acuan menyeret dirinya sendiri (acuan → tebakan → median →
acuan) dan HPP seluruh menu hanyut naik.

Sekarang kolam median hanya memuat lot yang harganya **pernah dilihat manusia**
(`productions.harga_tebakan = false`): harga diisi di `POST /{mod}/faktur`,
dilaporkan lewat endpoint laporan harga, atau direalisasi lewat
`POST /{mod}/tahap` (`items[].harga`).

**Yang perlu dicek di mobile:** bila aplikasi membuat faktur beli **tanpa**
`total_harga`, lot itu kini tak lagi ikut menentukan harga acuan sampai
harganya dilaporkan. Ini yang diinginkan — tapi kalau layar Anda menampilkan
"harga acuan" hasil hitungan sendiri, angkanya bisa berbeda dari server.

### 🟢 BARU — `perbarui_acuan` pada Laporan Harga (default `true`)

```jsonc
POST /api/pembelian/laporan-harga/:fakturId
{ "items": [{ "id": "…", "total_harga": 42000 }],
  "perbarui_acuan": false }   // opsional
```

**Bawaannya `true`, jadi klien lama tak berubah perilaku.** Kirim `false` untuk
mencatat nota tanpa menyentuh harga acuan bahan (nota beli eceran darurat yang
tak mewakili harga pasar). Mencatat nota ≠ mengubah harga acuan — kalau layar
mobile punya tombol Laporan Harga, sebaiknya kalimat itu ikut ditampilkan.

### 🟢 BARU — pratinjau dampak sebelum menyimpan

`POST /api/pembelian/laporan-harga/:fakturId/dampak` (owner/admin, beli saja) —
body sama dengan endpoint simpan, **tidak menulis apa pun**, mengembalikan
`DampakLaporanHarga`:

| Field | Isi |
| --- | --- |
| `food_cost_maks` | ambang food cost perusahaan (%) |
| `bahan[]` | `acuan_lama` → `acuan_baru` per bahan + `jumlah_menu_terdampak` |
| `menu_lewat_ambang[]` | menu aktif yang **menyeberang** ambang gara-gara laporan ini |

POST (bukan GET) karena dampaknya bergantung pada angka yang sedang **diketik**
user, bukan yang sudah tersimpan. Server memakai fungsi hitung yang sama dengan
endpoint simpan, jadi pratinjau tak bisa berbeda dari hasilnya.

### 🟢 BARU — Analisis Harga + terapkan harga saran massal

| | |
| --- | --- |
| `GET /api/menu/analisis-harga` | **owner/admin** — `AnalisisHargaRow[]`, urut food cost menurun |
| `GET /api/menu/:id/riwayat-harga` | **owner/admin** — `MenuPriceLogRow[]` (maks 50, terbaru dulu) |
| `POST /api/menu/terapkan-saran` | **owner/admin** — `{ ids: uuid[] }` → `TerapkanSaranHasil` |

`AnalisisHargaRow` = `MenuDto` + `menu_diperbarui` + `food_cost_maks` +
`penyumbang[]` (maks 5 bahan penyumbang HPP terbesar). Kunci pembacaannya:
sandingkan `menu_diperbarui` dengan `penyumbang[].bahan_diperbarui` — kalau
tanggal bahan **lebih baru** dari tanggal menu, yang bergerak adalah harga
bahan, bukan harga jual.

`POST /api/menu/terapkan-saran` menyetel `harga_jual = harga_jual_bulat` yang
**dihitung ulang di server**; angka yang dikirim klien diabaikan. Ini mengubah
harga yang ditagih ke pembeli — **wajib konfirmasi eksplisit** yang menyebut
jumlah menu dan total perubahan rupiah sebelum memanggilnya.

### ⚪️ INFO — riwayat harga jual menu

`POST /api/menu` menulis baris pembuka (`sebab: "buat"`, `harga_lama: null`).
`PUT /api/menu/:id` menulis baris `"manual"` **hanya bila `harga_jual` atau
markup benar-benar berubah** — menyimpan ulang foto/resep tidak menambah baris.

### ⚪️ INFO — ambang food cost perusahaan

`PATCH /api/company` menerima `food_cost_maks` (0..100, default **40**).
Tersedia di `GET /api/company` sebagai `foodCostMaks` (respons company memakai
camelCase kolom DB, bukan snake_case seperti DTO lain).

---

## Rilis: Laporan kebersihan harian (tim CK + seluruh tim cabang)

> **Sudah di-merge ke production** (PR #124). Migrasi DB **0083** (enum
> `kebersihan_sesi` + tabel `cleaning_areas`, `cleaning_reports`,
> `cleaning_report_items`). Perubahan API **aditif** — tak ada endpoint lama
> yang berubah perilaku.

### 🟢 BARU — `/api/kebersihan`: karyawan melapor per sesi, owner membaca rekap harian

Tiap karyawan (tim CK maupun tim cabang) mengisi checklist kebersihan untuk
sesi **pagi / siang / malam**, lengkap dengan foto bukti. Owner membacanya
sebagai rekap **satu kotak satu hari** berisi laporan semua tim.

| | |
| --- | --- |
| `GET /api/kebersihan/area` | daftar area checklist untuk lokasi pemanggil |
| `POST\|PATCH\|DELETE /api/kebersihan/area[/:id]` | **owner/admin** — master area |
| `GET /api/kebersihan/rekap` | **owner/admin** — `?bulan=` `?branch_id=` `?sesi=` |
| `GET /api/kebersihan/ringkas` | **owner/admin** — `{ tanggal, total, kotor }` untuk badge |
| `GET /api/kebersihan` | `?dari=` `?sampai=` `?branch_id=` `?sesi=` |
| `GET /api/kebersihan/:id` | pemilik atau owner/admin |
| `POST /api/kebersihan` | semua peran, atas nama diri sendiri |
| `PATCH /api/kebersihan/:id` | **pemilik**, hanya di hari yang sama |
| `PATCH /api/kebersihan/:id/catatan` | **owner/admin** — balasan untuk pelapor |
| `DELETE /api/kebersihan/:id` | pemilik (hari itu) atau owner/admin |

**Lima hal yang mudah salah kalau tidak dibaca:**

1. **Jangan kirim `tanggal`.** Server menurunkannya dari zona waktu perusahaan.
   Field itu diabaikan diam-diam, jadi laporan tak bisa dibuat mundur — jangan
   bangun UI "pilih tanggal" untuk pengisian.
2. **Jangan kirim `branch_id` saat membuat laporan.** Diambil dari keanggotaan
   pelapor. Akun tanpa cabang → **400**.
3. **Foto wajib minimal satu per laporan.** Kalau semua baris `foto_url` kosong
   → **400 "Lampirkan minimal 1 foto bukti"**. Kunci tombol Kirim di klien
   supaya galat ini tak pernah terlihat pengguna.
4. **Satu laporan per sesi per hari.** Mengirim sesi yang sama dua kali →
   **409**; tampilkan tombol "Perbarui" (`PATCH`), bukan pesan galat mentah.
5. **Peran terkunci cabang hanya melihat laporan MILIKNYA** — sama seperti
   `/pengajuan`. `branch_id` diabaikan untuk mereka.

Tiga sesi resmi (konstanta `SESI_KEBERSIHAN`) — pakai apa adanya:

| kode | label |
| --- | --- |
| `pagi` | 🌅 Pagi |
| `siang` | ☀️ Siang |
| `malam` | 🌙 Malam |

**Master area** punya `branch_id` yang boleh `null` = berlaku di semua lokasi;
terisi = khusus lokasi itu (mis. "Chiller" hanya untuk Central Kitchen).
Karyawan hanya menerima area yang berlaku untuk cabangnya, dan memakai area
milik cabang lain ditolak **400**.

**Riwayat tahan hapus:** tiap baris checklist menyimpan salinan nama area
(`area_nama`). Kalau owner menghapus areanya, `area_id` jadi `null` tapi nama
tetap terbaca — tampilkan `area_nama`, jangan lookup ke master.

**Bentuk rekap dibalik dari rekap absen.** `RekapKebersihanDto.hari[]` adalah
**day-major**: satu entri = satu hari (terbaru dulu) berisi `laporan[]` semua
tim hari itu, plus `total`, `area_kotor`, dan `sesi.{pagi,siang,malam}`. Hari
tanpa laporan tetap dikirim dengan `total: 0` — jangan disaring, justru hari
bolong itulah yang ingin dilihat owner.

DTO baru: `AreaKebersihanDto`, `LaporanKebersihanItem`, `LaporanKebersihanDto`,
`LaporanKebersihanRingkas`, `RekapKebersihanHari`, `RekapKebersihanDto`
(Lampiran A pada `docs/API-CONTRACT.md`).

---

## Rilis: Pengajuan cuti & libur + rekap absen bulanan

> **Sudah di-merge ke production.** Migrasi DB **0082** (tabel `leave_requests`
> + 3 enum). Perubahan API **aditif** — tak ada endpoint lama yang berubah
> perilaku.

### 🟢 BARU — `/api/pengajuan`: karyawan mengajukan cuti/libur, owner/admin ACC

Sebelum ini ketidakhadiran hanya berarti "tidak ada baris di `attendances`" —
tak terbedakan antara alpa, cuti, dan libur yang memang disepakati. Sekarang ada
alurnya.

| | |
| --- | --- |
| `GET /api/pengajuan` | `?status=` `?dari=` `?sampai=` `?branch_id=` |
| `POST /api/pengajuan` | semua peran, atas nama diri sendiri |
| `PATCH /api/pengajuan/:id` | **owner/admin** — `{ status: "disetujui"\|"ditolak", alasan_tolak? }` |
| `DELETE /api/pengajuan/:id` | pemohon membatalkan miliknya selama masih `menunggu` |

**Dua hal yang mudah salah kalau tidak dibaca:**

1. **Jangan kirim `jenis`.** Server menurunkannya sendiri dari `kategori`
   (`cuti` vs `libur`). Kalau kalian mengirimnya, field itu diabaikan.
2. **Peran terkunci cabang (`cashier`/`tim`/`kitchen`/`bar`) hanya melihat
   pengajuan MILIKNYA** — beda dari `GET /absensi` yang memang terbuka
   se-cabang. Pengajuan memuat alasan pribadi (mis. sakit), jadi tak dibagikan
   ke sesama karyawan. `branch_id` diabaikan untuk peran itu.

Delapan kategori resmi (dropdown pengajuan) — pakai daftar ini apa adanya:

| kode | jenis | label |
| --- | --- | --- |
| `tahunan` | cuti | 🌴 Cuti Tahunan |
| `sakit` | cuti | 🤒 Sakit |
| `izin` | cuti | 📝 Izin |
| `melahirkan` | cuti | 🍼 Melahirkan |
| `penting` | cuti | 🙏 Keperluan Penting |
| `mingguan` | libur | 🗓 Libur Mingguan |
| `tukar_jadwal` | libur | 🔁 Tukar Jadwal |
| `tanggal_merah` | libur | 🎉 Tanggal Merah |

Galat yang perlu ditangani di layar pengajuan: **409** = tanggalnya bertindih
dengan pengajuan pemohon sendiri yang masih `menunggu`/`disetujui` (tampilkan
pesannya apa adanya, minta ia membatalkan yang lama); **400** = rentang > 100
hari atau `selesai < mulai`. Lampiran (surat dokter) memakai
`POST /api/upload?tujuan=bukti` yang sudah ada, lalu kirim `lampiran_url`.

### 🟢 BARU — `GET /api/absensi/rekap` (khusus owner/admin)

Rekap SEBULAN lintas karyawan: `?bulan=YYYY-MM` + `?branch_id=` +
`?status=aktif|arsip|semua` (**bawaan `aktif`** — karyawan yang sudah keluar tak
ikut mengotori daftar & angka "tidak hadir"; `arsip` menampilkan mereka, dan
tiap baris membawa `arsip_pada`). Balikannya
`RekapAbsenDto` — per karyawan ada `hadir` / `tidak_hadir` / `cuti` / `libur`
plus `harian[]` **selalu sepanjang jumlah hari bulan itu** (urut tanggal
1..akhir), jadi bisa dirender langsung sebagai kolom tanpa mengisi lubang.

Aturan hitungnya (tak ada tabel jadwal kerja — outlet dianggap buka tiap hari):
ada cap absen → `hadir`; ada cuti/libur **disetujui** → `cuti`/`libur`; selain
itu → `alpa`. Status `kosong` = tanggal belum lewat, sebelum karyawan bergabung,
atau setelah ia diarsipkan — **tak pernah dihitung**, sehingga karyawan baru
tidak terlihat alpa sebulan penuh.

Gerbangnya **owner/admin**, dipasang inline pada rutenya — `/absensi/*` lain
tetap terbuka untuk 6 peran seperti sebelumnya.

### ⚪️ INFO — `attendances` tidak berubah

Cap absen tetap seperti sekarang (alternasi masuk/keluar per tanggal bisnis).
Cuti/libur disimpan di tabel terpisah dan hanya dibaca saat menyusun rekap, jadi
alur absen yang sudah kalian pasang tak perlu disentuh.

---

## Rilis: Sesi menyusul perubahan peran (`/auth/me` + `branch`)

> **Sudah di-merge ke production.** Tidak ada migrasi DB. Perubahan API **aditif**.

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

> **Sudah di-merge ke production** (PR #114). Endpoint di bawah sudah aktif —
> bagian 🟢 boleh langsung dikerjakan tanpa koordinasi rilis lagi.
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
