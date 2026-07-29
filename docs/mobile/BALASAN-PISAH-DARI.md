# Balasan backend — `PUT` id ganda, jalur `pisah_dari` baru, & cacah penyajian

Menjawab balasan kalian (pisah porsi dibalikkan + koreksi klaim). Dua jawaban.

---

## 1. Pertanyaan `PUT`: **tidak**, dan penjaga kalian jangan dihapus — ganti

Jawaban langsung: **`PUT` TIDAK memetakan `items[].id` lewat map seperti
pembayaran.** Mengirim id yang sama dua kali ditolak **400**
(`"Baris bill dikirim lebih dari sekali"`), dan itu disengaja.

Kalian sudah menebak alasannya dengan tepat: kedua field punya arti berbeda.

| Field | Arti | Boleh berulang? |
| --- | --- | --- |
| `id` (PUT) | **pasangan** — baris lama mana yang diperbarui baris ini | **tidak**, 1:1 |
| `open_bill_item_id` (bayar) | **pencarian** — harga & status apa yang diwarisi baris ini | **ya**, many:1 |

Satu itu pertanyaan "baris ini ADALAH baris mana"; satunya "baris ini MEWARISI
dari mana". Yang pertama hakikatnya tunggal.

### ⚠️ Solusi sementara kalian bukan "aman tapi tidak ideal" — itu bug yang sama

Kalian menulis: *"mobile mengirim `id` hanya pada kemunculan pertama; pecahan
sisanya jadi baris baru pada bill (harga hari ini untuk porsi itu). Aman, tapi
tidak ideal."*

**Itu bukan aman.** Itu persis bug harga yang baru kalian balikkan, cuma pindah
momen: porsi pecahannya ditagih harga hari ini, jadi pembeli membayar lebih mahal
hanya karena kasir menekan "bungkus satu" — dan pewarisan status dapurnya juga
lepas, jadi porsi yang sudah matang kembali ke antrean. Sama seperti sebelumnya,
dua-duanya sunyi.

### ✅ Jalur baru: `items[].pisah_dari`

Ditambahkan di PR #132. Kunci **warisan** yang memang boleh berulang, terpisah
dari `id` yang tetap 1:1:

```jsonc
{ "items": [
    { "id": "B1",         "menu_id": "M", "qty": 2 },
    { "pisah_dari": "B1", "menu_id": "M", "qty": 1, "dine_in_override": false }
]}
```

Baris pecahan mewarisi `harga_satuan`, `menu_nama`, dan trio status dapur
(`pesanan_status` + siapa + kapan).

`sajian_takeaway` **sengaja tidak** diwarisi — memecah porsi justru dilakukan
supaya penyajiannya BERBEDA. Penandanya lahir dari `dine_in_override` baris itu
sendiri saat bill dibayar, jadi pecahan yang dibungkus otomatis benar.

**Ditolak 400:**

| Kiriman | Alasan |
| --- | --- |
| `id` dan `pisah_dari` bersamaan | dua maksud bertabrakan |
| `pisah_dari` menunjuk baris bill lain / tak ada | sama ketatnya dengan `id` |
| `pisah_dari` beda `menu_id` dari baris asalnya | bukan pecahan, itu menu lain |
| `pisah_dari` di `POST /api/open-bill` | bill baru belum punya baris untuk diwarisi |

Dikunci uji end-to-end (`verify-api.sh` §154 f3) — bill 3 porsi terkunci
Rp 12.000, **harga menu dinaikkan ke Rp 20.000**, lalu dipecah lewat `PUT`:

```
✔ PUT id yang sama dua kali → 400 (pasangan baris jadi ambigu)
✔ PUT id + pisah_dari sekaligus → 400 (dua maksud bertabrakan)
✔ pisah_dari beda menu → 400
✔ pisah_dari di POST bill BARU → 400 (belum ada baris utk diwarisi)
✔ bill jadi DUA baris (2 + 1), tak ada yang hilang
✔ KEDUA baris berharga TERKUNCI 12000 (pecahan tak kena 20000)
✔ baris pecahan bertanda bawa pulang lewat dine_in_override
✔ baris pecahan MEWARISI 'selesai' (tak kembali ke antrean dapur)
✔ nota pisah-porsi-lewat-PUT: subtotal 3 × 12000 = 36000
```

**Yang perlu kalian lakukan:** ganti penjaga "id hanya pada kemunculan pertama"
dengan `pisah_dari` pada baris pecahan. Baris asalnya tetap ber-`id`.

Satu catatan konsistensi: sama seperti di pembayaran, server **tidak** memeriksa
`sum(qty)` pecahan terhadap qty baris asalnya. Jaga di UI.

---

## 2. Koreksi kalian diterima — dan kedua field itu tetap ada, karena web

Terima kasih sudah memeriksa dan mengoreksi; itu jauh lebih berguna daripada
membiarkan kami menebak. Tidak perlu minta maaf — kalian menemukannya sendiri
sebelum ada yang bergantung padanya, dan itu justru urutan yang benar.

`item_takeaway`/`item_dine_in` **tetap kami pertahankan**, dan tepat seperti
saran kalian: **karena web, bukan karena permintaan kalian.**

Setelah kalian mengoreksi, kami periksa `RiwayatPage` web — dan masalahnya nyata
di sana. Badge-nya memakai `sajian_takeaway === is_dine_in`, dan karena
`sajian_takeaway` itu `bool_and`, satu piring yang tetap di tempat sudah membuat
badge-nya berbunyi seolah **semua** dikembalikan ke piring. Kami sampai menulis
"ada yang…" di teksnya justru untuk menutupi ketidaktahuan itu.

Sekarang web memakai cacahnya dan menulis apa adanya:

- sebagian → **"2 dari 3 🥡 dibungkus"**
- seragam & berbeda dari nota → **"disajikan 🥡 bawa pulang"** / **"disajikan 🍽 di tempat"** (tanpa "ada yang", karena sekarang kami tahu)
- seragam & sama dengan nota → tak ada badge

Jadi jawabannya: dua field itu **bukan** ketergantungan kalian, kalian bebas
mengabaikannya. Kalau nanti layar riwayat mobile menambah penanda penyajian,
keduanya sudah ada.

---

## 3. Ringkas: yang berubah di sisi kalian

| # | Tindakan | Mendesak? |
| --- | --- | --- |
| 1 | Ganti penjaga PUT dengan `pisah_dari` pada baris pecahan | **ya** — jalur sekarang menagih pecahan di harga hari ini |
| 2 | `item_takeaway`/`item_dine_in` | tidak — abaikan saja sampai perlu |

Sisanya sepakat: gerbang 400 tidak akan datang, label meja & tekan-lama versi
kalian dipertahankan, papan pesanan cukup di komputer cabang. Kami kabari begitu
PR #132 di-merge.
