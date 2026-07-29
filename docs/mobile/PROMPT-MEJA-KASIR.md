# 🍽 Meja di aplikasi kasir: status isi/kosong + Kosongkan + cegah bill ganda

Dokumen kerja untuk tim mobile (Terakasir/Flutter). Endpoint-nya **sudah ada di
production sejak PR #129** dan sudah terbuka untuk token `cashier` — yang belum
ada hanyalah layarnya.

Acuan tipe lengkap: `docs/API-CONTRACT.md` blok `/api/meja` + Lampiran A.

---

## Kenapa ini mendesak

Laporan dari lapangan: **kasir bisa membuat dua bill untuk satu meja di waktu
yang sama, tanpa sadar.** Lalu saat tamu pulang, salah satu bill tertinggal —
tidak tertagih, dan tidak ada yang tahu sampai tutup kasir selisih.

Keputusan owner: **selama masih ada open bill di meja itu, tidak boleh bikin
bill kedua.** Pesanan tambahan wajib masuk ke bill yang masih terbuka. Server
sekarang menegakkannya — `POST /api/open-bill` di meja dine-in yang sudah punya
bill ditolak **409** `meja_sudah_ada_bill`.

Yang masih hilang di mobile: **kasir bisa melihat** bahwa mejanya sudah terisi
(supaya tak menabrak 409 dulu), dan **bisa membereskan meja** saat tamu pulang.
Web sudah punya keduanya. Itu isi dokumen ini.

---

## Yang perlu dibangun (3 hal)

### 1. Status okupansi di pemilih meja

`GET /api/meja/status?branch_id=…` → `MejaStatusDto[]`. Tarik berkala
(**web memakai 30 detik**) — endpoint ini sengaja **tanpa ETag**.

```
MejaStatusDto {
  meja_id, nama,
  status: "kosong" | "isi",
  bill_terbuka: number,        // tagihan BELUM dibayar
  transaksi_aktif: number,     // lunas tapi masih dianggap menempati
  lunas_masih_duduk: boolean,  // paling layak ditawari tombol Kosongkan
  sejak: string | null,        // ISO — tagihan paling awal (utk "sudah 40 mnt")
  dikosongkan_pada, dikosongkan_oleh
}
```

Tempelkan ke tiap baris pemilih meja: warna + label + (kalau `sejak` ada) lama
duduk. Meja yang tidak ada di respons = `kosong`.

> ⚠️ **`GET /api/meja/status` hanya mengembalikan meja `dine_in`.** Ruang Tunggu
> (takeaway) **tidak punya status** dan tidak muncul sama sekali. Seluruh
> penjualan bawa pulang cabang menunjuk ke satu baris takeaway yang tak bisa
> dihapus — sekali ia bisa "terisi", ia terisi selamanya dan jalur bawa pulang
> cabang itu mati. Jangan mencari statusnya, jangan memberinya warna terisi.

### 2. Tombol Kosongkan — dua tahap

`POST /api/meja/:id/kosongkan` dengan `{ paksa?: boolean }`.

- Meja yang **semua tagihannya sudah lunas** → langsung **200**.
- Meja yang masih punya bill belum dibayar → **409** dengan badan
  `{ kode: "bill_berjalan", bill_terbuka: N }`. Tampilkan konfirmasi kedua
  ("masih ada N tagihan belum dibayar — tetap bereskan?"), lalu kirim ulang
  dengan `{ paksa: true }`.

**Tagihannya TIDAK dibatalkan** oleh `paksa` — tetap ada di
`GET /api/open-bill` dan tetap bisa ditagih. Tombol meja tidak pernah
menghilangkan uang.

> **Baca `kode`, jangan mencocokkan teks pesannya.** Teks bisa berubah kapan
> saja; `kode` adalah kontraknya.

Idempoten: mengosongkan meja yang sudah kosong → **200**, dan **tidak** menulis
baris riwayat kedua. Tombol yang tertekan dua kali bukan masalah.

Peran yang boleh: `owner`, `admin`, `cashier`, `tim`. Peran `kitchen`/`bar`
dapat **403** — memberesi meja bukan pekerjaan mereka.

### 3. Tambahkan ke bill yang ada — bukan bill kedua

Inilah yang menjawab laporan di atas. Saat kasir menekan **Simpan / Open Bill**
untuk bill **BARU** (bukan memperbarui bill yang sedang dibuka):

```
bill di meja ini = openBills.where((b) => b.meja_id == mejaTerpilih.id)
kalau tidak kosong → JANGAN kirim POST. Tampilkan:
   "Meja 5 sudah punya bill berjalan"
   "Selama bill itu belum dibayar, pesanan tambahan masuk ke bill yang sama."
   [ 📋 <nama/label bill> · N item   → Buka bill ]
   [ Tutup ]
```

**Tidak ada opsi "tetap buat bill baru"** — server menolaknya.

Kalau POST tetap terkirim (mis. balapan dengan perangkat lain), tangani
**409** `meja_sudah_ada_bill`: badannya membawa `bill_id`, jadi langsung muat
bill itu dan tawarkan penggabungan. **Baca `kode`, jangan teks pesannya.**

Alur menambah pesanan:

1. `GET /api/open-bill/:id` → muat baris bill ke keranjang.
2. Gabungkan pesanan baru ke keranjang itu.
3. `PUT /api/open-bill/:id` — **kirim `items[].id` untuk baris yang sudah ada**,
   supaya harga terkuncinya tidak hilang. Baris tanpa `id` = tambahan baru dan
   memakai harga hari ini.

**`PUT` juga dijaga:** memindahkan bill ke meja yang sudah punya bill lain
**409** dengan kode yang sama. Menyimpan ulang bill di mejanya **sendiri** tetap
boleh — itu memang jalur ini.

> 🆕 **`OpenBillRow` kini membawa `meja_id`.** Cocokkan bill ke meja lewat
> **`meja_id`, bukan `meja_label`**. Label itu snapshot saat bill dibuat, jadi
> mencocokkan lewat nama akan gagal begitu mejanya diganti nama — dan gagalnya
> **sunyi**: kasir tak melihat peringatan, lalu menabrak 409 tanpa tahu sebabnya.

### Dua pengecualian yang TIDAK dijaga

1. **Ruang Tunggu (meja `takeaway`)** — bill kedua di sana tetap **201**. Kalau
   ia ikut dijaga, satu bill bawa pulang yang terparkir memblokir semua pesanan
   bawa pulang berikutnya.
2. **Bill tanpa meja** → tetap **201**.

Penjualan langsung (`POST /api/penjualan`) di meja yang punya bill berjalan juga
tetap boleh. Yang dilarang hanya bill kedua, bukan transaksi kedua.

Setelah bill lama dibayar **atau** dibatalkan, mejanya bebas dan boleh punya bill
baru lagi.

## Empat jebakan yang JANGAN diulang

Semuanya sudah pernah membuat masalah nyata di web:

1. **JANGAN saring meja terisi dari pemilih meja.** Meja terisi wajib tetap
   muncul dan tetap bisa dipilih — melanjutkan bill di meja itu justru jalur
   utamanya sekarang. Menyaringnya membuat pemasangan meja batal saat
   melanjutkan open bill (tagihan sah jadi tak bisa ditagih), dan — lebih halus
   — membuat `dineIn` jatuh ke nilai cadangan `true`, sehingga pesanan bawa
   pulang terbukukan makan-di-tempat **dengan HPP yang salah**.

2. **DIBAYAR ≠ KOSONG.** Orang lazim bayar dulu lalu duduk lagi. Meja baru
   bebas saat ada manusia yang menekan Kosongkan. **Jangan** memanggil
   `/kosongkan` otomatis setelah transaksi berhasil — kalau itu dilakukan,
   waiter akan mendudukkan tamu baru di meja yang masih ada orangnya.

3. **Ruang Tunggu tidak punya status** — lihat peringatan di bagian 1.

4. **Jangan menyimpan status okupansi di cache bersama `GET /api/meja`.**
   Daftar master itu ber-ETag dan memang harus kena 304; status hidup sengaja
   ditaruh di endpoint terpisah supaya cache-nya tidak goyah tiap transaksi.

---

## Riwayat (opsional, kalau layarnya sempat)

`GET /api/meja/:id/log` → `MejaKosongLogRow[]`: `waktu`, `aksi`, `oleh`,
`paksa`, `detail`. Menjawab "siapa membereskan meja ini, kapan, dan apakah
dipaksa". Terbuka untuk semua peran cabang termasuk `kitchen`/`bar` (baca saja).

---

## Yang TIDAK boleh disentuh mobile

`POST /api/meja`, `PUT /api/meja/tata-letak`, `PATCH /api/meja/:id`,
`DELETE /api/meja/:id` — sejak PR #129 hanya **[owner/admin/cashier]**. Token
`cashier` masih boleh, tapi aplikasi kasir tidak punya alasan mengubah master
meja; arahkan ke web untuk itu. Token `tim`/`kitchen`/`bar` akan dapat **403**.

Dua penjaga yang bisa mengejutkan: menghapus atau menonaktifkan meja yang
**masih terisi** ditolak **409** ("kosongkan dulu").
