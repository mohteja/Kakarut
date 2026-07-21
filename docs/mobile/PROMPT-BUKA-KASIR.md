# Prompt Implementasi (Flutter): Gerbang "Buka Kasir" + wajib absen

> Salin seluruh isi dokumen ini sebagai prompt untuk developer / AI assistant
> yang mengerjakan aplikasi **kakarut-mobile (Flutter)**. Semua yang dibutuhkan
> ada di sini — endpoint, bentuk request/response, kode error, dan spesifikasi
> UI. Aplikasi bicara **langsung ke API** (lihat `docs/API-CONTRACT.md`), tidak
> ada logika bisnis di klien selain alur di bawah.

---

## Tujuan

Di aplikasi POS Flutter, seorang **kasir** tidak boleh melakukan transaksi bila
**kasir belum dibuka** (belum ada shift terbuka di cabangnya). Saat itu, layar
Kasir harus menampilkan **gerbang blokir "Buka Kasir"**. Untuk membuka kasir,
akun kasir **harus absen masuk dulu** hari ini.

**Urutan wajib: Absen masuk → Buka Kasir → Transaksi.**

Ini menyalin persis perilaku aplikasi web. Fitur hanya berlaku untuk peran
`cashier`.

---

## Kontrak API yang dipakai

Base URL sama seperti fitur lain. Semua request butuh header
`Authorization: Bearer <token>`. Query `branch_id` opsional untuk kasir (server
mengunci kasir ke cabangnya otomatis) — kirim apa adanya seperti fitur lain.

### 1. Cek shift aktif (menentukan gerbang muncul/tidak)
```
GET /api/shift/aktif
```
- Res **200**: `Shift`  → ada shift terbuka → gerbang TIDAK muncul, transaksi boleh.
- Res **200**: `null`   → belum ada shift terbuka → TAMPILKAN gerbang "Buka Kasir".
- Hanya boleh peran `cashier` (grup guard `/shift/*` = cashier). Jangan panggil
  untuk peran lain.

Bentuk `Shift` (field yang relevan):
```json
{
  "id": "uuid",
  "branch_nama": "Pusat",
  "dibuka_oleh": "Nama Kasir",
  "dibuka_pada": "2026-07-21T02:00:00.000Z",
  "ditutup_pada": null,
  "modal_awal": 200000,
  "penjualan_tunai": 0,
  "penjualan_nontunai": 0,
  "jumlah_transaksi": 0,
  "kas_sistem": 200000,
  "selisih": null
}
```

### 2. Cek apakah kasir sudah absen masuk hari ini
```
GET /api/absensi
```
- Res **200**: `AbsensiRow[]` (masuk-pertama / keluar-terakhir per karyawan hari ini
  di cabang).
- Cari baris milik kasir yang login: `row.user_id == <id user login>` (ambil id
  user dari state auth / hasil login, field `sub`/`id` — samakan dengan yang
  dipakai fitur profil).
- **Sudah hadir** bila: `row != null && row.masuk != null && row.keluar == null`.

Bentuk `AbsensiRow`:
```json
{
  "user_id": "uuid",
  "nama": "Nama Kasir",
  "employee_code": "12345678",
  "masuk": "2026-07-21T01:55:00.000Z",  // atau null
  "keluar": null,                         // atau ISO string bila sudah pulang
  "foto_masuk": "https://…",
  "foto_keluar": null
}
```

### 3. Absen masuk sendiri (bila belum absen)
```
POST /api/absensi/saya
body: { "foto_url": "https://…", "lat": <num|null>, "lng": <num|null> }
```
- **Foto wajib**: ambil foto → upload ke `POST /api/upload?tujuan=bukti` → pakai
  `foto_url` hasilnya. (Sama seperti alur absen yang sudah ada di app — pakai
  ulang halaman/aksi absen yang sudah dibuat, JANGAN bikin baru.)
- Bila cabang punya titik geofence, `lat`/`lng` wajib dan divalidasi radius.
  Cabang tanpa geofence → boleh tanpa GPS.
- Res **201**: `AbsenResult` (`tipe` = `"masuk"` untuk cap pertama hari ini).
- Error **400** (di luar radius / GPS wajib / nonaktif), **403** (bukan karyawan aktif).

### 4. Buka kasir
```
POST /api/shift/buka
body: { "modal_awal": <number ≥ 0> }
```
- Res **201**: `Shift` (shift baru terbuka).
- Error **400**:
  - pesan mengandung *"Absen masuk dulu"* → kasir **belum absen** → arahkan absen.
  - pesan *"Masih ada shift kasir yang terbuka…"* → sudah ada shift (harusnya
    tak terjadi bila cek `/shift/aktif` benar; tangani dengan refresh).
- Error **403**: kasir di luar cabangnya.
- **Server adalah otoritas final**: walaupun UI sudah cek absen, tetap tangani
  balasan 400 di sini dan tampilkan pesannya.

### 5. Transaksi (yang diblokir bila kasir tutup)
```
POST /api/penjualan   (dan POST /api/open-bill juga hanya cashier)
```
- Error baru **409**: *"Kasir belum dibuka — buka kasir dulu sebelum bertransaksi"*.
  Bila muncul (mis. shift ditutup dari perangkat lain di tengah sesi), **tampilkan
  kembali gerbang "Buka Kasir"** dan batalkan aksi bayar. Perlakukan 409 dari
  `/api/penjualan` sebagai sinyal "kasir tutup".

---

## Spesifikasi UI (mobile)

### Kapan gerbang muncul
- Hanya untuk peran `cashier`.
- Saat masuk layar Kasir (dan saat kembali fokus/aktif), panggil `GET /api/shift/aktif`.
- Bila hasil `null` → tampilkan **modal/overlay blokir** yang **tidak bisa
  ditutup** (tanpa tombol X, tanpa dismiss di luar area) menutupi layar Kasir.
- Selama loading `/shift/aktif`, jangan tampilkan gerbang (hindari kedip); tampil
  hanya setelah dipastikan `null`.
- Segarkan berkala (mis. tiap 30 detik) atau saat app resume, mirip web.

### Isi gerbang "Kasir Belum Dibuka"
Header: ikon gembok 🔒 + judul **"Kasir Belum Dibuka"** + subteks
*"Transaksi belum bisa dilakukan. Buka kasir dulu untuk mulai berjualan."*

Lalu, tergantung status absen (dari `GET /api/absensi`):

**A. Belum absen** (`masuk == null` atau sudah `keluar`):
- Panel peringatan (amber): **"Anda belum absen masuk"** +
  *"Absen masuk dulu sebelum membuka kasir."*
- Tombol utama **"🖐 Absen Sekarang"** → buka alur absen yang sudah ada. Setelah
  absen sukses (`POST /api/absensi/saya` → 201), kembali ke gerbang dan
  **refresh** `GET /api/absensi` sehingga status jadi hijau.

**B. Sudah absen** (`masuk != null && keluar == null`):
- Baris status hijau: **"✓ Sudah absen masuk hari ini"**.

Selalu tampilkan (baik A maupun B) — biar tak ada jalan buntu bila heuristik
absen di klien meleset, server tetap yang memutuskan:
- Input angka **"Modal awal (Rp)"** (uang tunai di laci saat mulai), keyboard numerik.
- Teks kecil: *"Uang tunai di laci saat mulai shift."*
- Tombol **"🔓 Buka Kasir"**:
  - `POST /api/shift/buka { modal_awal }`.
  - Sukses (201) → tutup gerbang, invalidasi/refresh state shift & transaksi
    boleh jalan.
  - Gagal 400 dengan pesan absen → tampilkan pesan server + arahkan ke absen
    (jangan biarkan buntu).
  - Tampilkan pesan error server apa adanya di area error tombol.
- Tautan kecil "Kelola shift (tutup / riwayat)" → ke layar Tutup Kasir bila ada.

### Sesudah kasir terbuka
- Gerbang hilang, layar Kasir normal (pemilih meja / keranjang / bayar).
- Bila `POST /api/penjualan` membalas **409** kapan pun → tampilkan gerbang lagi
  dan batalkan bayar.

---

## Catatan implementasi Flutter

- Simpan status gerbang di state layar Kasir (mis. Riverpod/BLoC/Provider —
  ikuti pola yang sudah dipakai app). `shiftAktif == null` → `kasirTutup = true`.
- Fetch `GET /api/absensi` hanya saat `kasirTutup == true` (hemat request).
- Tentukan `userId` kasir dari state auth yang sama dipakai fitur lain
  (jangan hardcode). Cocokkan dengan `AbsensiRow.user_id`.
- Waktu semua ISO 8601 UTC; batas "hari ini" ditentukan **server** (timezone
  perusahaan) — klien tidak perlu menghitung tanggal untuk gerbang ini.
- Pakai ulang komponen absen + upload foto yang sudah ada; JANGAN membuat alur
  absen baru.
- Gerbang harus benar-benar mem-blokir: tombol bayar/keranjang tak boleh bisa
  ditekan di belakang overlay.

---

## Kriteria terima (checklist uji)

1. Login kasir, buka layar Kasir tanpa shift → gerbang "Kasir Belum Dibuka" tampil,
   status "belum absen", transaksi terblokir.
2. Coba `POST /api/penjualan` (mis. via tombol bayar) tanpa shift → dapat **409** →
   gerbang tetap/tampil, bayar dibatalkan.
3. Tekan "Absen Sekarang" → alur absen → `POST /api/absensi/saya` → **201**.
4. Kembali ke gerbang → status jadi hijau "✓ Sudah absen masuk hari ini".
5. Isi modal awal → "Buka Kasir" → `POST /api/shift/buka` → **201** → gerbang hilang.
6. `POST /api/penjualan` sekarang → **201** (transaksi berhasil).
7. Coba buka kasir SEBELUM absen (lewati langkah 3) → `POST /api/shift/buka` →
   **400** pesan "Absen masuk dulu…" → UI tampilkan pesan + arahkan absen.
8. Peran non-kasir tidak melihat gerbang (dan memang tak bisa transaksi POS).

---

## Referensi
- `docs/API-CONTRACT.md` — kontrak lengkap semua endpoint (bagian `/api/shift`,
  `/api/absensi`, `/api/penjualan`, catatan "Gerbang Buka Kasir").
- Perilaku acuan: `apps/web/src/pages/kasir/KasirPage.tsx` (gerbang
  `kasirTutup`), `apps/web/src/pages/kasir/ShiftPage.tsx` (buka/tutup shift),
  `apps/web/src/pages/absen/AbsenPage.tsx` (absen sendiri).
