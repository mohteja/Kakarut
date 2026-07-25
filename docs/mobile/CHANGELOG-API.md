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

Kasir **tidak** bisa membuat transfer, tapi tetap bisa menerimanya.

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
