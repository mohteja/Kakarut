# Prompt Tim Mobile (Flutter) — Detail Shift + Operasional Cabang + Jam Operasional

Fitur baru di backend Kakarut yang perlu diikuti aplikasi mobile. **Tidak ada
breaking change** untuk alur transaksi kasir yang lama — ini murni tambahan.
Kontrak lengkap: `docs/API-CONTRACT.md` (bagian `/api/shift` & `/api/cabang`).

Base URL API sama seperti sebelumnya (`.../api`). Semua endpoint butuh header
`Authorization: Bearer <token>`.

---

## 1. Perubahan gerbang peran `/api/shift` (penting)

Sebelumnya seluruh `/api/shift/*` hanya untuk **cashier**. Sekarang:

- **Baca** (`GET /aktif`, `GET /`, `GET /:id`, `GET /pantau`) → dibuka untuk
  **owner/admin/cashier**.
- **Tulis** (`POST /buka`, `POST /tutup`) → tetap **cashier only** (balas **403**
  bila peran lain memanggil).

Jadi aplikasi owner/admin kini boleh menampilkan status & riwayat shift; hanya
akun kasir yang boleh membuka/menutup kasir. Alur kasir (absen → buka → jual)
**tidak berubah**.

---

## 2. Detail shift — `GET /api/shift/:id`

Untuk layar "Detail Shift" (dipakai saat menekan satu baris riwayat shift, atau
tombol "Lihat detail" pada shift berjalan).

- **Peran:** owner/admin/cashier. Kasir **terkunci** ke cabangnya → memanggil
  detail shift cabang lain balas **403**. **404** bila id tak ada.
- **Response `ShiftDetail`** = objek `Shift` yang sudah ada **+** field
  `transaksi`:

```jsonc
{
  // ...semua field Shift lama (dibuka_oleh, ditutup_oleh, dibuka_pada,
  //    ditutup_pada, modal_awal, uang_fisik, penjualan_tunai,
  //    penjualan_nontunai, jumlah_transaksi, kas_sistem, selisih, catatan, ...)
  "transaksi": [
    {
      "id": "uuid",
      "nomor": "PUSAT-20260721-0028",
      "waktu": "2026-07-21T08:18:54.412Z", // ISO
      "total": 34000,
      "metode": "tunai",                    // "tunai" | "qris" | "transfer"
      "kasir": "Kasir Pusat"                 // bisa null
    }
    // maks 300 baris, urut waktu TERBARU dulu
  ]
}
```

**UI yang diharapkan (samakan dengan web):**
- Header status **Terbuka/Ditutup** + nama cabang.
- Dua kartu jelas: **🔓 Dibuka oleh** (nama + tanggal/jam) dan **🔒 Ditutup oleh**
  (nama + tanggal/jam, atau "masih berjalan" bila belum ditutup).
- Grid rekap: Modal awal, Penjualan tunai, Non-tunai, Transaksi (×), Kas
  seharusnya, Uang fisik.
- Baris **Selisih kas** = `selisih` (null selagi terbuka): `0`→"Pas"
  (hijau), `<0`→"Kurang Rp…" (merah), `>0`→"Lebih Rp…" (amber).
- Tabel **Transaksi**: Nomor · Jam · Kasir · Metode · Total.

**Di layar Tutup Kasir kasir:** buat setiap baris riwayat shift **bisa
diketuk** untuk membuka detail ini, dan tampilkan **siapa buka & siapa tutup**
secara eksplisit (jangan sembunyikan closer walau sama dengan opener).

---

## 3. Pantau operasional cabang (khusus owner/admin) — `GET /api/shift/pantau`

Untuk halaman **"Operasional Cabang"** di aplikasi owner/admin: memantau status
kasir semua cabang store. **Read-only** — owner/admin TIDAK membuka/menutup
kasir dari sini (itu tetap tugas kasir di cabang).

- **Peran:** owner/admin saja (**403** untuk kasir/tim).
- **Response:** `ShiftPantauRow[]` (hanya cabang bertipe `store` & aktif):

```jsonc
{
  "branch_id": "uuid",
  "branch_nama": "Pusat",
  "jam_buka": "08:00",        // string "HH:MM" | null (belum diatur)
  "jam_tutup": "22:00",       // string "HH:MM" | null
  "shift_id": "uuid",         // null bila kasir sedang TUTUP
  "dibuka_oleh": "Kasir Pusat", // null bila tutup
  "dibuka_pada": "..ISO..",     // null bila tutup
  "modal_awal": 200000,         // null bila tutup
  "penjualan_tunai": 1032800,   // TOTAL HARI INI (zona waktu perusahaan)
  "penjualan_nontunai": 68000,  // TOTAL HARI INI
  "jumlah_transaksi": 30,       // TOTAL HARI INI
  "kas_sistem": 1232800,        // modal + tunai hari ini (0 bila tutup)
  "buka_hari_ini": true,        // sudah pernah buka kasir hari ini?
  "telat_buka": false,          // sudah lewat jam_buka tapi belum buka hari ini
  "lupa_tutup": false           // masih terbuka padahal sudah lewat jam_tutup
}
```

**UI yang diharapkan:** satu kartu per cabang berisi badge **Kasir Buka/Tutup**,
"Dibuka oleh … · jam" (bila buka), rekap hari ini, jam operasional, dan
peringatan **⚠️ Telat buka** (merah) / **⚠️ Lupa tutup** (amber) bila
`telat_buka`/`lupa_tutup` true. Sediakan tombol menuju riwayat shift cabang itu
(`GET /api/shift?branch_id=<id>`) lalu ke detail (endpoint di bagian 2).

> Catatan: `penjualan_*` & `jumlah_transaksi` adalah **total hari ini** per
> cabang (bukan hanya jendela shift). Meta `dibuka_*`/`modal_awal` hanya terisi
> saat kasir sedang terbuka.

---

## 4. Jam operasional cabang — `GET/PATCH /api/cabang`

Cabang kini punya **jam operasional** (dipakai untuk tanda telat buka/lupa
tutup di atas).

- `GET /api/cabang` — objek cabang bertambah dua field: `jam_buka: string|null`
  dan `jam_tutup: string|null` (format `"HH:MM"`).
- `PATCH /api/cabang/:id` (**owner/admin**) — kirim `{ "jam_buka": "08:00",
  "jam_tutup": "22:00" }` untuk mengatur; kirim `""` atau `null` untuk
  mengosongkan. Format wajib `HH:MM` (00:00–23:59) — selain itu balas **400**.

**UI:** di layar owner (kartu cabang atau pengaturan cabang), sediakan dua input
jam (time picker) + tombol Simpan yang memanggil `PATCH /api/cabang/:id`.

---

## Tidak perlu tindakan mobile

- Fitur **"Kirim Test Email" SMTP** (halaman super-admin web) bersifat web-only
  untuk platform super admin — **tidak** ada di aplikasi mobile POS.

## Ringkas checklist mobile

- [ ] Layar **Detail Shift** (opener/closer eksplisit + rekap + daftar transaksi) via `GET /api/shift/:id`.
- [ ] Riwayat shift **bisa diketuk** → buka detail; shift berjalan punya "Lihat detail".
- [ ] (Aplikasi owner/admin) Halaman **Operasional Cabang** via `GET /api/shift/pantau` + tanda telat/lupa.
- [ ] (Aplikasi owner/admin) Atur **jam operasional** cabang via `PATCH /api/cabang/:id`.
- [ ] Tangani **403** bila kasir mengakses detail shift cabang lain / owner memanggil buka/tutup.
