# Handoff ke Tim Mobile — Meja, Open Bill, & Status Pesanan per Sajian

Satu berkas, cukup dibaca ini saja untuk mengerjakan batch ini. Acuan lengkap
tetap `docs/API-CONTRACT.md` (Lampiran A = salinan utuh
`packages/shared/src/types.ts`).

**Tanggal snapshot: 30 Juli 2026.** ✅ **PR #132 SUDAH di-merge ke production** —
seluruh isi dokumen ini sudah tayang dan aman dipakai. Tak ada lagi yang perlu
ditunggu.

Bacaan tabel di bawah sudah disesuaikan: kolom "Status server" yang tadinya
"PR #132" kini berarti **sudah tayang**.

---

## 0. Ringkasan: 4 pekerjaan, 1 pengecekan

| # | Pekerjaan | Status server | Berat |
| --- | --- | --- | --- |
| 1 | **CEK DULU:** `open_bill_item_id` saat membayar open bill | sudah tayang (tak berubah) | pengecekan kode, mungkin nol perubahan |
| 2 | Layar meja: status okupansi + tombol Kosongkan | **sudah tayang** sejak PR #129 | layar baru |
| 3 | Satu meja = satu bill → tangani **409** `meja_sudah_ada_bill` | ✅ sudah tayang | perubahan alur simpan bill |
| 4 | Meja sudah bayar dipilih lagi → tanya **tamu sama / tamu baru** | ✅ sudah tayang | dialog baru |
| 5 | Papan pesanan per sajian (`/api/pesanan`) | ✅ sudah tayang | opsional untuk mobile |

Nomor 1 kami minta **dijawab dulu** sebelum yang lain — hasilnya menentukan
apakah ada data yang sedang rusak diam-diam di produksi.

---

## 1. ⚠️ CEK DULU — `open_bill_item_id` saat membayar open bill

**Ini bukan fitur baru. Ini permintaan memeriksa kode yang sudah ada.**

Saat membayar open bill (`POST /api/penjualan` dengan `open_bill_id`), tiap baris
`items[]` harus membawa `open_bill_item_id` = `OpenBillDetail.items[].id`.

**Server TIDAK menolak kalau field itu tidak dikirim.** Skemanya
`open_bill_item_id: z.string().uuid().nullish()` — opsional. Bila tak dikirim,
`createSale` diam-diam memakai `menus.harga_jual` **hari pembayaran**, bukan
harga yang disepakati pembeli. Tidak ada 400, tidak ada peringatan, tidak ada
apa pun di log.

Artinya **"tidak ada galat" BUKAN bukti field ini terkirim** — sejak rilis kunci
harga open bill pun tidak. Dua akibat kalau ternyata belum dikirim:

1. **Pembeli ditagih harga yang salah** setiap kali harga menu berubah antara
   memesan dan membayar.
2. Setelah PR #132: **sajian yang sudah selesai kembali ke antrean dapur** begitu
   pelanggan membayar (lihat bagian 5 — pewarisan status per baris memakai field
   yang sama).

**Yang perlu dilakukan:** buka kode pembayaran open bill, pastikan tiap baris
keranjang membawa `id` baris bill-nya, bukan hanya `menu_id`. Kabari kami
hasilnya.

> Kami sengaja **tidak** menjadikannya 400 di rilis ini: kalau ternyata mobile
> belum mengirimnya, mengetatkan server akan mematikan pembayaran open bill di
> produksi — bukan memperbaikinya. Begitu kalian konfirmasi aman, gerbangnya kami
> ketatkan supaya lubang ini tertutup selamanya.

---

## 2. Layar meja: status okupansi + tombol Kosongkan

**Sudah tayang di production sejak PR #129** dan sudah terbuka untuk token
`cashier` — tapi mobile belum memakainya sama sekali. Akibatnya kasir mobile
bekerja buta: tak tahu meja mana yang terisi, dan tak punya cara membereskan meja
saat tamu pulang.

### `GET /api/meja/status?branch_id=…` → `MejaStatusDto[]`

Tarik berkala (**web memakai 30 detik**). Endpoint ini sengaja **tanpa ETag**.

```ts
interface MejaStatusDto {
  meja_id: string;
  nama: string;
  status: "kosong" | "isi";
  bill_terbuka: number;         // tagihan BELUM dibayar
  transaksi_aktif: number;      // lunas tapi masih dianggap menempati
  lunas_masih_duduk: boolean;   // semua lunas, meja belum dibereskan
  sejak: string | null;         // ISO — tagihan paling awal (dasar "sudah 40 mnt")
  dikosongkan_pada: string | null;
  dikosongkan_oleh: string | null;
  konsumen_nama: string | null; // 🆕 konsumen transaksi TERBARU di meja itu
  konsumen_wa: string | null;   // 🆕 selalu null bila mejanya kosong
}
```

Label yang dipakai web, silakan ikuti supaya seragam:

| Keadaan | Label | Warna |
| --- | --- | --- |
| `status: "kosong"` | `Kosong` | hijau |
| `bill_terbuka > 0` | `Belum bayar · N pesanan` | merah |
| `lunas_masih_duduk` | `✓ Sudah bayar · 40 mnt` | amber |

Meja yang tidak ada di respons = anggap `kosong`.

> ⚠️ **Hanya meja `dine_in` yang dikembalikan.** Ruang Tunggu (takeaway) **tidak
> punya status** dan tidak muncul sama sekali. Seluruh penjualan bawa pulang
> cabang menunjuk ke satu baris takeaway yang tak bisa dihapus — sekali ia bisa
> "terisi", ia terisi selamanya dan jalur bawa pulang cabang itu mati. Jangan
> mencari statusnya, jangan memberinya warna terisi.

### `POST /api/meja/:id/kosongkan` — dua tahap

Body `{ paksa?: boolean }`.

- Meja yang **semua tagihannya sudah lunas** → langsung **200**.
- Meja yang masih punya bill belum dibayar → **409** dengan badan
  `{ kode: "bill_berjalan", bill_terbuka: N }`. Tampilkan konfirmasi kedua
  ("masih ada N tagihan belum dibayar — tetap bereskan?"), lalu kirim ulang
  dengan `{ paksa: true }`.

**`paksa` TIDAK membatalkan tagihannya** — tetap ada di `GET /api/open-bill` dan
tetap bisa ditagih. Tombol meja tidak pernah menghilangkan uang.

Idempoten: mengosongkan meja yang sudah kosong → **200**, dan **tidak** menulis
baris riwayat kedua. Tombol tertekan dua kali bukan masalah.

Peran yang boleh: `owner`, `admin`, `cashier`, `tim`. `kitchen`/`bar` → **403**.

### `GET /api/meja/:id/log` (opsional)

`MejaKosongLogRow[]`: `waktu`, `aksi`, `oleh`, `paksa`, `detail`. Menjawab "siapa
membereskan meja ini, kapan, dan apakah dipaksa". Terbuka untuk semua peran
cabang termasuk `kitchen`/`bar` (baca saja).

---

## 3. 🔴 SATU MEJA DINE-IN = SATU BILL BERJALAN

**Permintaan yang dulu berhasil sekarang ditolak.** Keputusan owner: selama masih
ada open bill di meja itu, tidak boleh bikin bill kedua. Pesanan tambahan wajib
masuk ke bill yang masih terbuka.

Alasannya dari lapangan: dua bill di satu meja bikin salah satunya tertinggal tak
tertagih saat tamu pulang, dan tak ada yang tahu sampai selisih muncul di tutup
kasir.

### `POST /api/open-bill` → **409** bila mejanya sudah punya bill

```json
{
  "error": "Meja 5 masih punya bill yang belum dibayar — tambahkan pesanan ke bill itu",
  "kode": "meja_sudah_ada_bill",
  "bill_id": "<uuid bill yang harus dipakai>"
}
```

`bill_id` sengaja ikut supaya klien tak perlu mencari sendiri.

**Baca `kode`, jangan mencocokkan teks pesannya.** Teks bisa berubah kapan saja.

### Alur yang benar di klien

Supaya kasir tak menabrak galat, cek **sebelum** mengirim `POST`:

```
bill di meja ini = openBills.where((b) => b.meja_id == mejaTerpilih.id)
kalau tidak kosong → JANGAN kirim POST. Tampilkan:
   "Meja 5 sudah punya bill berjalan"
   "Selama bill itu belum dibayar, pesanan tambahan masuk ke bill yang sama."
   [ 📋 <nama/label bill> · N item   → Buka bill ]
   [ Tutup ]
```

**Tidak ada opsi "tetap buat bill baru"** — server menolaknya.

Menambah pesanan ke bill yang ada:

1. `GET /api/open-bill/:id` → muat baris bill ke keranjang.
2. Gabungkan pesanan baru ke keranjang itu.
3. `PUT /api/open-bill/:id` — **kirim `items[].id` untuk baris yang sudah ada**,
   supaya harga terkuncinya tidak hilang. Baris tanpa `id` = tambahan baru dan
   memakai harga hari ini.

**`PUT` juga dijaga:** memindahkan bill ke meja yang sudah punya bill lain →
**409** kode yang sama. Menyimpan ulang bill di mejanya **sendiri** tetap boleh —
itu memang jalur "tambahkan pesanan".

### 🆕 `OpenBillRow.meja_id`

`GET /api/open-bill` kini menyertakan `meja_id: string | null` di samping
`meja_label`. Tidak ada field lama yang berubah.

**Cocokkan bill ke meja lewat `meja_id`, JANGAN `meja_label`.** Label itu snapshot
saat bill dibuat, jadi pencocokan lewat nama gagal begitu mejanya diganti nama —
dan gagalnya **sunyi**: kasir tak melihat peringatan, lalu menabrak 409 tanpa tahu
sebabnya.

`null` = mejanya sudah dihapus dari master (`meja_id` ber-`onDelete: set null`)
atau bill dibuat tanpa meja.

### Dua pengecualian yang TIDAK dijaga

1. **Ruang Tunggu (meja `takeaway`)** — bill kedua di sana tetap **201**. Kalau ia
   ikut dijaga, satu bill bawa pulang yang terparkir memblokir **semua** pesanan
   bawa pulang berikutnya.
2. **Bill tanpa `meja_id`** → tetap **201**.

**Penjualan langsung** (`POST /api/penjualan`) di meja yang punya bill berjalan
juga tetap boleh. Yang dilarang hanya bill **kedua**, bukan transaksi kedua.

Setelah bill lama dibayar **atau** dibatalkan, mejanya bebas dan boleh punya bill
baru lagi.

---

## 4. 🔴 Meja SUDAH BAYAR dipilih lagi → tanya tamunya sama atau baru

`lunas_masih_duduk: true` = semuanya lunas tapi meja belum dibereskan. Kalau kasir
memilih meja itu lagi, ada **dua kejadian yang server tak bisa membedakan**, dan
keduanya sah:

```
kasir memilih meja dengan lunas_masih_duduk == true → tampilkan:
   "Meja 5 — tamu yang sama atau tamu baru?"
   "Sudah dibayar tapi belum dibereskan (40 mnt). Konsumen terakhir: Bu Rina."

   [ 🍽 Tamu yang sama — tambah pesanan ]
       → pakai mejanya apa adanya
       → isikan konsumen_nama / konsumen_wa ke keranjang

   [ ✓ Tamu baru — bereskan meja dulu ]
       → POST /api/meja/:id/kosongkan   (200 langsung, TANPA paksa —
                                         meja lunas tak punya tagihan berjalan)
       → baru pakai mejanya, konsumen dikosongkan

   [ Batal, pilih meja lain ]
```

**Kenapa wajib ditanya.** Kalau ternyata tamu baru dan mejanya tidak dibereskan,
`sejak` tetap menunjuk transaksi tamu **sebelumnya**. Papan bilang *"sudah duduk 2
jam"* untuk orang yang baru lima menit duduk, dan salahnya bertahan sampai jendela
okupansi **12 jam** meluruhkannya sendiri. Membereskan meja menulis batas di
`meja_kosong_logs`, dan itulah satu-satunya yang memotong hitungan itu.

**Kenapa konsumennya dibawa.** Tanpa itu, tamu member yang memesan dua kali di
meja yang sama tercatat sebagai satu transaksi ber-member dan satu tanpa member —
poin/riwayatnya terputus justru pada tamu yang paling sering datang. Kasir tetap
boleh menghapus/mengganti namanya.

`konsumen_nama`/`konsumen_wa` diambil dari transaksi **terbaru** yang masih
menempati meja itu, dan **selalu `null`** saat mejanya `kosong` — jadi jangan
pernah menawarkan "tamu yang sama" untuk meja yang sudah dibereskan.

> Meja yang masih punya **bill belum dibayar** (`bill_terbuka > 0`) TIDAK masuk
> alur ini — di sana jalurnya bagian 3 ("tambahkan ke bill yang ada").

---

## 5. Papan Pesanan per SAJIAN (`/api/pesanan`) — opsional untuk mobile

Papannya layar komputer cabang; mobile tak wajib membangunnya. Tapi **bacalah
bagian ini**, karena satu hal di dalamnya mengubah `POST /api/penjualan` yang
mobile pakai (lihat bagian 1).

Status `selesai` / `take away` / `batal` sekarang hidup **per baris pesanan**,
bukan per bill. Satu bill berisi minuman yang keluar duluan dan gorengan yang
menyusul; dengan satu tombol untuk seluruh bill, dapur harus menahan "selesai"
sampai sajian terakhir jadi — dan tak ada yang bisa tahu mana yang sudah keluar.

### Status kartu = TURUNAN barisnya, bukan kolom tersimpan

`GET /api/pesanan` tetap mengembalikan `PesananRow[]` dengan `status` dan
`sajian_takeaway` di kartunya — yang berubah adalah **asal nilainya**:

| Field kartu | Aturan turunannya |
| --- | --- |
| `status` | `batal` bila **semua** baris batal; `selesai` bila **tak ada lagi** baris `dikerjakan`; selain itu `dikerjakan` |
| `sajian_takeaway` | `true` hanya bila **SEMUA** baris bertanda bawa pulang |
| `item_selesai` / `item_batal` | 🆕 cacah baris — untuk ringkasan "2/3 selesai" |
| `status_oleh` / `status_pada` | perubahan **baris** terbaru pada kartu itu |

**Jangan menyimpan sendiri agregat ini di klien**: agregat tersimpan harus ikut
diperbarui di setiap perubahan baris, dan satu yang terlewat membuat papan
berbohong. Baca ulang `GET /api/pesanan` setelah tiap aksi.

`PesananItemRow` bertambah: `id`, `status`, `sajian_takeaway`, `status_oleh`,
`status_pada`. `PesananLogRow` bertambah `item_nama` (`null` = aksinya mengenai
seluruh pesanan).

### Endpoint

| Endpoint | Guna |
| --- | --- |
| `GET /api/pesanan` | daftar kartu; query `branch_id?`, `tanggal?`, `status?` |
| `POST /api/pesanan/:jenis/:id/item/:itemId/status` | **tombol utama** — tandai satu sajian |
| `POST /api/pesanan/:jenis/:id/item/:itemId/sajian` | penanda bawa pulang satu sajian |
| `POST /api/pesanan/:jenis/:id/status` | pintasan "semua baris" |
| `POST /api/pesanan/:jenis/:id/sajian` | pintasan "semua baris" |
| `GET /api/pesanan/:jenis/:id/log` | "siapa menandai apa, kapan" |

`:jenis` = `open_bill` | `penjualan`. `:itemId` = `PesananItemRow.id`.

Guard peran seluruh grup `/pesanan/*`: **owner, admin, cashier, tim, kitchen,
bar** — dapur justru pengguna utamanya. Catatan: `/api/open-bill` **tetap
`cashier` only** dan tidak dilonggarkan, jadi `/api/pesanan` adalah satu-satunya
cara dapur melihat pesanan yang belum dibayar.

Versi **per baris** menjawab `{ ok, status, kartu_status }` — `kartu_status` =
status kartu setelah diturunkan ulang, jadi layar bisa memindahkan kartunya tanpa
memuat ulang dulu. **409** bila baris itu baru saja diubah orang lain (dua orang
di dapur menekan tombol yang sama) → muat ulang papan, jangan kirim paksa.

Versi **kartu** sengaja **tanpa** 409 balapan: perintahnya "jadikan semuanya X",
jadi dua orang yang menekannya bersamaan sampai di hasil yang sama.

### 🔴 Pewarisan status saat bill dibayar — per baris

`POST /api/penjualan` dengan `open_bill_id` menyalin status + penanda penyajian
**tiap baris bill** ke baris penjualannya, dicocokkan lewat
`items[].open_bill_item_id`. Termasuk siapa & kapan menandainya.

**Tanpa field itu, sajian yang sudah selesai kembali ke antrean dapur.** Ini
alasan kedua bagian 1 mendesak.

### `RiwayatTransaksiRow.sajian_takeaway` ikut jadi turunan

`true` hanya bila SELURUH baris transaksi bertanda bawa pulang. Badge "diubah
setelah transaksi" (`sajian_takeaway == is_dine_in`) masih berguna, tapi bacalah
arahnya hati-hati:

- `true` pada nota **dine-in** = semuanya dipindah jadi bawa pulang;
- `false` pada nota **bawa pulang** = **ada** yang dikembalikan ke piring, belum
  tentu semuanya. Hindari label "disajikan di tempat" yang mutlak.

Penandanya juga **lahir per baris** (`= !sale_items.is_dine_in`), jadi satu nota
bisa berisi sajian yang dibungkus dan sajian yang di piring sekaligus.

### Pembatalan bill

`DELETE /api/open-bill/:id` sekarang menandai `batal` pada **setiap** barisnya
(selain mengisi `closed_at`). Sebaliknya, bill yang seluruh barisnya batal
otomatis tertutup — dan satu baris yang dikembalikan ke antrean **membukanya
lagi** untuk kasir. Yang terlihat kasir tak berubah.

`GET /api/meja/status` juga menurun dari baris: transaksi dianggap tidak lagi
mengisi meja hanya kalau **seluruh** sajiannya dibatalkan.

---

## 6. Empat jebakan yang JANGAN diulang

Semuanya sudah pernah membuat masalah nyata di web:

1. **JANGAN saring meja terisi dari pemilih meja.** Meja terisi wajib tetap muncul
   dan tetap bisa dipilih — melanjutkan bill di meja itu justru jalur utamanya.
   Menyaringnya membuat pemasangan meja batal saat melanjutkan open bill (tagihan
   sah jadi tak bisa ditagih), dan — lebih halus — membuat `dineIn` jatuh ke nilai
   cadangan `true`, sehingga pesanan bawa pulang terbukukan makan-di-tempat
   **dengan HPP yang salah**.

2. **DIBAYAR ≠ KOSONG.** Orang lazim bayar dulu lalu duduk lagi. Meja baru bebas
   saat ada **manusia** yang menekan Kosongkan. **Jangan** memanggil `/kosongkan`
   otomatis setelah transaksi berhasil — waiter akan mendudukkan tamu baru di meja
   yang masih ada orangnya. Pemicunya ada di bagian 4, saat kasir menyatakan "tamu
   baru".

3. **Ruang Tunggu tidak punya status** — lihat peringatan di bagian 2.

4. **Jangan tempelkan status okupansi ke cache `GET /api/meja`.** Daftar master itu
   ber-ETag dan memang harus kena 304; status hidup sengaja ditaruh di endpoint
   terpisah supaya cache-nya tidak goyah tiap transaksi.

---

## 7. Yang TIDAK boleh disentuh mobile

`POST /api/meja`, `PUT /api/meja/tata-letak`, `PATCH /api/meja/:id`,
`DELETE /api/meja/:id` — sejak PR #129 hanya **[owner/admin/cashier]**. Token
`cashier` masih boleh, tapi aplikasi kasir tidak punya alasan mengubah master
meja; arahkan ke web. Token `tim`/`kitchen`/`bar` → **403**.

Dua penjaga yang bisa mengejutkan: menghapus atau menonaktifkan meja yang **masih
terisi** ditolak **409** ("kosongkan dulu").

---

## 8. Ringkasan kode galat yang perlu ditangani

| Endpoint | Kode | Arti | Tindakan klien |
| --- | --- | --- | --- |
| `POST /api/open-bill` | **409** `meja_sudah_ada_bill` | meja dine-in itu sudah punya bill | muat `bill_id`, tawarkan "buka bill" |
| `PUT /api/open-bill/:id` | **409** `meja_sudah_ada_bill` | pindah ke meja yang sudah punya bill lain | sama seperti di atas |
| `POST /api/meja/:id/kosongkan` | **409** `bill_berjalan` | masih ada tagihan belum dibayar | konfirmasi kedua → kirim `{ paksa: true }` |
| `POST /api/pesanan/…/item/…/status` | **409** | baris itu baru diubah orang lain | muat ulang papan |
| `POST /api/penjualan` | **409** + `sebab` | lihat entri changelog `sebab` terstruktur | hanya `bill_sudah_dibayar` yang aman dibuang dari antrean |

**Selalu baca `kode`/`sebab`, jangan mencocokkan teks pesannya.**

---

## 9. Yang kami butuhkan balik dari kalian

1. **Hasil pengecekan bagian 1** — apakah `open_bill_item_id` sudah dikirim saat
   membayar open bill? Ini yang paling mendesak.
2. Konfirmasi apakah bagian 5 (papan pesanan) mau dibawa ke mobile atau cukup di
   komputer cabang, supaya kami tahu perlu tidaknya menyiapkan apa pun lagi.
3. Kalau ada bentuk respons yang menyulitkan di sisi Flutter, bilang saja.
   PR #132 sudah tayang, jadi mengubahnya sekarang berarti perubahan kontrak
   berikutnya — masih bisa, hanya tak lagi gratis. Lebih awal lebih murah.
