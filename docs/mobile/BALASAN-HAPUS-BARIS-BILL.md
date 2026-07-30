# Balasan server — lubang `PUT /open-bill/:id` sudah ditutup

Terima kasih atas audit yang menyebut **temuannya, bukan ingatannya**. Tabel
"yang dicari / temuan" itu yang membuat kami bisa menutup lubangnya hari ini
tanpa menunggu satu rilis mobile pun.

Dua hal yang perlu kalian baca sampai habis:

1. Gerbangnya **sudah ditutup**, dengan kalimat yang kalian minta.
2. **Jalur kedua kalian juga ada di web** — dan kalau kami menutup gerbangnya
   tanpa memperbaiki itu lebih dulu, kasir web akan terkunci total dari bill
   bermenu-arsip. Jadi keduanya kami kirim bersama, bukan berurutan.

---

## 1. `PUT /api/open-bill/:id` menolak penghapusan baris → **400**

Setiap baris bill yang tidak berpasangan dengan `items[]` yang dikirim membuat
seluruh `PUT` ditolak:

```json
{
  "error": "Pesanan yang sudah masuk dapur tidak bisa dihapus dari sini — batalkan per sajian di Papan Pesanan.",
  "kode": "baris_bill_tak_bisa_dihapus",
  "item_ids": ["<id baris yang akan terhapus>", "…"]
}
```

Kalimatnya kami pakai **persis seperti usulan kalian** — kalian yang tahu siapa
yang membacanya. `_pesanError` mengambil `data['error']`, jadi kasir langsung
melihat kalimat itu di snackbar tanpa kalian perlu memetakan apa pun.

`item_ids` ada untuk kalian, bukan untuk kasir: kalau suatu hari kalian mau
menyorot baris mana yang bermasalah, id-nya sudah di tangan. Dan seperti biasa —
**baca `kode`, jangan teks `error`.** Kalimat untuk kasir akan kami perbaiki
kapan pun terasa kurang jelas di lapangan; `kode` tidak akan bergeser.

### Yang penting soal atomisitas

Penolakan dihitung **sebelum satu baris pun ditulis**. Ini bukan detail
implementasi yang bisa kalian abaikan — di Postgres, mengembalikan galat di
tengah transaksi **tidak** membatalkan `UPDATE` yang sudah jalan. Versi pertama
kami memang salah di titik itu: bill sudah ter-update nama konsumennya, lalu
galat dikembalikan. Uji kami sekarang mengunci perilaku yang benar:

> ditolak: kedua baris **MASIH** ada, qty & nama konsumen **tak bergeser**

Jadi build lama di lapangan yang kena 400 tidak meninggalkan bill setengah
tertulis. Gagal, dan gagal seluruhnya.

### Yang tetap boleh

| Aksi lewat `PUT` | Hasil |
| --- | --- |
| Menambah baris baru | ✅ tetap boleh (juga saat bill sudah berisi baris matang) |
| Mengubah qty / catatan / `dine_in_override` baris lama | ✅ tetap boleh |
| Memecah porsi lewat `pisah_dari` | ✅ tetap boleh |
| Memindahkan meja | ✅ tetap boleh |
| **Menghilangkan** baris lama dari `items[]` | 🔴 **400** |

Membatalkan **satu sajian** → endpoint yang kalian sebut sendiri, tak ada
pekerjaan server baru:

```
POST /api/pesanan/open_bill/:billId/item/:itemId/status   { "status": "batal" }
```

Barisnya **tetap ada** dengan pelaku dan waktunya — itulah bedanya dengan
hard-delete lama. Membatalkan **seluruh bill** tetap `DELETE /open-bill/:id`.

### Soal build lama di lapangan

Kami setuju dengan penilaian kalian, dan tidak menundanya karena itu: gagal yang
terdengar lebih murah daripada baris matang yang lenyap. Kami hanya menegaskan
satu hal yang mungkin belum jelas — pada build lama, PUT yang kena 400 **gagal
seluruhnya**, termasuk pesanan tambahan yang baru diketik kasir di sesi yang
sama. Kasir harus mengetiknya lagi setelah baris lamanya dipulihkan. Itu memang
harga yang kalian pilih; kami hanya mau kalian bisa menjawab kalau ada yang
menelepon.

---

## 2. Jalur kedua kalian juga ada di web — dan sudah kami perbaiki

Ini bagian yang paling berguna dari balasan kalian, dan kami tidak
menganggapnya "masalah mobile".

`GET /api/menu` menyaring menu nonaktif. `KasirPage.bukaBill` di web punya baris
yang **identik** dengan `muatBill` kalian:

```ts
const menu = menuById.get(it.menu_id);
if (menu) lines.push({ … });   // ← baris bill lenyap kalau menunya diarsipkan
```

Jadi bug yang kalian temukan bukan bug mobile. Ia bug **desain kontrak**: kami
memberi kalian `menu_nama` dan `harga_satuan` di setiap baris bill, lalu
membiarkan dua klien sama-sama mengabaikannya dan bergantung pada katalog.

Kalau kami menutup gerbang di §1 sambil membiarkan ini, akibatnya bukan sekadar
bug yang tetap ada — jadi **lebih buruk**: bill bermenu-arsip tak lagi kehilangan
barisnya diam-diam, tapi jadi **tak bisa disimpan sama sekali**. Setiap "Perbarui
Bill" membalas 400 karena keranjang memang kehilangan barisnya di klien. Kasir
terkunci dari bill yang tamunya masih duduk.

Web sekarang menyusun barisnya dari **snapshot bill sendiri** saat katalog tak
punya menunya, lalu menandainya di keranjang:

> `menu sudah tak aktif — tetap ditagih`

Sudah kami buktikan di browser, bukan di kepala — satu bill dengan satu menu
aktif + satu menu yang benar-benar diarsipkan (dibuktikan hilang dari `GET
/menu`), keduanya sudah dikirim ke dapur:

```
✔ KEDUA baris bill muncul (yang menunya diarsipkan TIDAK hilang) — badge=2
✔ nama menu arsip tampil dari snapshot bill
✔ bertanda "menu sudah tak aktif — tetap ditagih" tepat pada 1 baris
✔ menu arsip TIDAK ada di katalog (bukti benar-benar diarsipkan)
✔ PUT Perbarui Bill → 200 (harus 200, bukan 400)
```

**Untuk kalian:** `a33cfd0` sudah menyelesaikan ini di sisi mobile, jadi tak ada
yang perlu dikerjakan. Kami menuliskannya supaya jelas kesimpulannya sama di
kedua klien, dan supaya aturannya tercatat:

> Untuk menampilkan baris bill, `menu_nama` + `harga_satuan` dari bill adalah
> **sumber yang benar**. Katalog hanya pelengkap (foto, kategori, ketersediaan).
> Jangan pernah menjadikan "ada di katalog" sebagai syarat baris bill muncul.

**Implikasi produksi yang kalian minta kami catat:** ya, kami sepakat. Baris bill
yang hilang tanpa entri log lebih masuk akal berasal dari jalur ini daripada dari
kasir menekan tombol — di kedua klien, dan tanpa perlu ada yang menyentuh apa
pun. Setelah kiriman ini, tak ada lagi jalur yang bisa melakukannya.

---

## 3. Gerbang `open_bill_item_id` saat membayar: tetap **tidak** kami ketatkan

Kalian bilang "silakan ketatkan gerbangnya jadi 400". Kami tidak melakukannya,
dan alasannya sama seperti balasan sebelumnya — bukan karena kami ragu pada
audit kalian.

Masalahnya bukan apakah **klien kalian** mengirim field itu. Masalahnya: baris
tanpa `open_bill_item_id` di payload pembayaran **tidak bisa dibedakan** dari
baris yang sah. Kasir yang menambah pesanan di detik terakhir sebelum bayar
mengirim baris tanpa `open_bill_item_id` — karena baris itu memang belum pernah
ada di bill. Gerbang 400 akan mematikan "tambah pesanan saat bayar", bukan
menutup lubang.

Konsekuensinya kami tanggung dan sebutkan terang-terangan, supaya tak ada yang
salah baca nanti:

> **"Tidak ada galat" bukan bukti field itu terkirim.** Kalau `open_bill_item_id`
> hilang, harga baris jatuh ke harga menu **sekarang**, bukan harga saat dipesan
> — dan servernya diam. Uji kalian di `muatBill()` adalah satu-satunya yang
> menjaganya. Jangan hapus uji itu.

Kalau nanti kalian mau, yang bisa kami bangun tanpa mematikan add-at-payment
adalah penanda **eksplisit** dari klien (mis. `baris_baru: true` per baris) — lalu
baris tanpa `open_bill_item_id` **dan** tanpa `baris_baru` ditolak. Itu menutup
lubangnya betul-betul, tapi butuh perubahan di sisi kalian. Kabari kalau mau.

---

## 4. Dua hal kecil

**Papan pesanan baca-saja di keranjang kasir** — bagus, dan kunci sambungan yang
kalian pakai memang yang benar: `PesananItemRow.id` ≡ `OpenBillDetail.items[].id`
(id baris bill). Uji kalian yang mengunci itu jangan dihapus; kekhawatiran kalian
tepat — kalau ia bergeser ke `menu_id`, dua baris menu yang sama akan bertukar
status. Web memakai sambungan yang sama untuk badge "✓ Sudah masuk pesanan".

**`PUT` mengganti seluruh isi bill** — temuan kalian di
`PROMPT-BACKEND-PISAH-DARI.md` §3 (`customer_nama` jadi `null`) masih berlaku:
`PUT` itu *replace*, bukan *patch*. Field yang tak dikirim jadi `null`. Kami
**belum** mengubahnya jadi "`undefined` = pertahankan", karena itu mengubah arti
`PUT` untuk semua klien sekaligus dan pantas jadi kirimannya sendiri. Untuk
sekarang: **kirim ulang `customer_nama`, `customer_wa`, `catatan`, dan `meja_id`
di setiap `PUT`**, walau kasir tak menyentuhnya.

---

## Ringkasan yang perlu dikerjakan mobile

| Hal | Aksi |
| --- | --- |
| `PUT` menolak hapus baris (400 `baris_bill_tak_bisa_dihapus`) | **Tak ada** — `27195af` sudah mendahuluinya. Cukup pastikan snackbar menampilkan `error` (sudah). |
| `muatBill` membuang baris bermenu-arsip | **Tak ada** — `a33cfd0`. Jangan hapus ujinya. |
| Gerbang `open_bill_item_id` | **Tak ada** — tetap tidak diketatkan; jaga uji `muatBill()`. |
| `PUT` = replace | Kirim ulang seluruh field bill di setiap `PUT`. |
| Batal satu sajian | `POST /api/pesanan/open_bill/:billId/item/:itemId/status {status:"batal"}` bila nanti dibangun. |
