# Balasan backend — pisah porsi, gerbang 400, & cacah penyajian (30 Jul 2026)

Menjawab balasan kalian atas handoff Meja/Open Bill/Pesanan. Tiga keputusan, satu
di antaranya membalik rencana yang kalian izinkan.

---

## 1. ❌ Gerbang 400 TIDAK kami ketatkan — dan justru temuan kalian yang mencegahnya

Terima kasih sudah memeriksa; senang tahu kedua jalur mengirim
`open_bill_item_id`. Kalian mengizinkan kami mengetatkannya jadi **400**.

**Kami tidak melakukannya, dan fitur pisah porsi kalian sendiri alasannya.**

Baris **tanpa** `open_bill_item_id` itu sah dan harus tetap bisa:

- pesanan **tambahan** yang baru diketik kasir saat membayar — tak punya baris
  bill, dan memang harus memakai harga hari ini;
- (sebelum keputusan §2 di bawah) baris pisah porsi kalian.

Server tak punya cara membedakan "baris baru yang sah" dari "klien lupa mengirim
id" — di kabel keduanya **terlihat sama persis**. Mewajibkannya berarti mematikan
pesanan tambahan saat bayar, bukan menutup lubangnya. Jadi gerbangnya tetap
opsional, dan konsekuensinya kami tulis terang di kontrak:

> **"Tidak ada galat" bukan bukti `open_bill_item_id` terkirim.** Pastikan lewat
> pengujian di sisi klien, bukan lewat respons server.

Kalau nanti kalian mau kepastian dari server, yang bisa kami tambahkan adalah
**penanda niat eksplisit per baris** (mis. `harga_hari_ini: true` untuk baris yang
memang ingin harga hari ini) — baru setelah itu absennya keduanya bisa jadi 400.
Bilang saja kalau mau; itu perubahan kecil di kedua sisi.

---

## 2. ✅ Pisah porsi: **kirim `open_bill_item_id` yang SAMA** di semua baris pecahan

Ini jawaban atas pertanyaan kalian. Kesimpulannya: **harga terkunci yang menang,
dan id-nya jangan dilepas.** Tolong balikkan perbaikan kemarin.

Memecah 3 porsi jadi 2 di piring + 1 dibungkus adalah keputusan **pengemasan**
saat bayar — **bukan pesanan baru**. Tamu memesan 3 porsi di harga yang disepakati;
kalau harga naik hari ini, ia tak boleh ikut naik hanya karena kasir menekan
"pisah". Melepas kunci membuat layar jujur, tapi **membuat yang ditagih salah** —
itu memperbaiki gejalanya, bukan sebabnya.

### Yang perlu diubah di sisi kalian

Satu id memang **boleh dipakai beberapa baris**. Kirim begini:

```jsonc
{ "open_bill_id": "…", "items": [
    { "menu_id": "M", "qty": 2, "open_bill_item_id": "B1", "is_dine_in": true  },
    { "menu_id": "M", "qty": 1, "open_bill_item_id": "B1", "is_dine_in": false }
]}
```

Premis "satu id server hanya boleh dipasangkan ke satu baris" tidak berlaku di
sini — server memetakan `id → harga` dan `id → status` lewat map, jadi beberapa
baris yang menunjuk id yang sama sama-sama menemukan nilai yang benar. **Tidak ada
perubahan server yang dibutuhkan; ini sudah jalan hari ini.**

### Satu akibat kedua yang belum kalian sebut — dan ini lebih mahal

Baris pecahan tanpa `open_bill_item_id` bukan cuma kehilangan kunci harga. Ia juga
kehilangan **pewarisan status dapur**: `pesananStatus` jatuh ke nilai bawaan
`dikerjakan`. Jadi porsi yang **sudah selesai dimasak kembali ke antrean dapur**
tepat saat pelanggan membayar — persis bug §5 di handoff, muncul lagi lewat jalur
pisah porsi.

Dengan id-nya dikirim, keduanya beres sekaligus.

### Sudah kami kunci dengan uji end-to-end

Ditambahkan ke `scripts/verify-api.sh` §154(f2) — bill 3 porsi terkunci Rp 12.000,
**harga menu dinaikkan ke Rp 20.000**, lalu dibayar sebagai 2 + 1 dengan id yang
sama:

```
✔ pisah porsi diterima → 201 (bukan ditolak karena id dipakai dua kali)
✔ KEDUA baris pecahan ditagih harga TERKUNCI 12000 (bukan 20000)
✔ subtotal 3 × 12000 = 36000 (bukan 3 × 20000)
✔ KEDUA baris pecahan mewarisi 'selesai' (tak kembali ke antrean dapur)
✔ penanda penyajian tetap per baris: 1 dibungkus, 1 di piring
```

Jadi perilaku ini sekarang punya jaring — kalau nanti ada yang merusaknya, uji
kami merah sebelum sampai ke kalian.

### Satu hal yang TIDAK kami jaga, supaya kalian tahu

Server **tidak** memeriksa `sum(qty)` baris pecahan terhadap qty baris bill-nya.
Mengirim 2 + 2 untuk baris bill berisi 3 akan diterima, dan ketiganya… empat-nya,
ditagih di harga terkunci. Kami sengaja tidak menambah penjaga itu sekarang: alur
web yang sudah jalan mengizinkan kasir menaikkan qty baris bill saat membayar
(bill 2 porsi → dibayar 3), dan penjaga ketat akan mematikannya. Jaga
konsistensinya di UI kalian.

---

## 3. ✅ `item_takeaway` & `item_dine_in` — sudah ditambahkan

Permintaan §6 kalian. Murah, dan alasannya benar: `sajian_takeaway` itu
`bool_and`, jadi ia `false` begitu **satu** baris tetap di piring — tak bisa
membedakan "semuanya di piring" dari "sebagian dibungkus".

`RiwayatTransaksiRow` sekarang membawa:

```ts
item_takeaway: number;   // baris bertanda bawa pulang
item_dine_in: number;    // baris yang tetap di piring
// item_takeaway + item_dine_in == jumlah_item, selalu
```

Silakan tulis **"2 dari 3 dibungkus"** alih-alih badge mutlak. Ada di PR #132,
belum tayang — sebelum tayang keduanya tak ada di respons, jadi parse toleran
seperti yang sudah kalian lakukan untuk `meja_id`.

---

## 4. Yang tidak perlu diubah

- **Label meja "2 bon" vs "Belum bayar · N pesanan"** — pakai versi kalian.
  Alasan 140 dp itu sah, dan yang penting seragam maknanya, bukan seragam
  katanya. Web tidak akan kami ubah mengikuti mobile, dan sebaliknya.
- **Kosongkan di tekan-lama** — bagus. Pertimbangan "aksi yang mengubah keadaan
  rekan lain tak pantas sekali sentuh" itu tepat; web memakai tombol terpisah
  karena penunjuknya presisi, bukan karena tekan-lama lebih buruk.
- **Papan pesanan cukup di komputer cabang** — diterima, dan alasannya kami catat.
  Tak ada yang kami siapkan lagi untuk mobile. `/api/pesanan` tetap ada apa adanya
  kalau nanti dapur pakai tablet.
- **Parse toleran `meja_id` / `konsumen_*` sebelum PR #132 tayang** — tepat. Kami
  kabari begitu PR-nya di-merge.

---

## 5. Ringkas: yang berubah di sisi kalian

| # | Tindakan | Mendesak? |
| --- | --- | --- |
| 1 | **Balikkan** perbaikan "baris pecahan melepas kunci harga" → kirim `open_bill_item_id` yang sama | **ya** — sekarang tamu bisa ditagih salah |
| 2 | Pakai `item_takeaway`/`item_dine_in` untuk badge riwayat | tidak, setelah PR #132 tayang |
| 3 | Tak perlu menunggu gerbang 400 — tidak akan datang | — |
