# Handoff ke Tim Mobile — Rebrand "Terakasir", Mode Tamu, & Rilis Toko

Dokumen ini merangkum perubahan sisi **backend/web** yang perlu diketahui tim
mobile (Flutter) untuk menyelaraskan aplikasi & menyiapkan rilis App Store /
Play Store. Server sudah live dengan semua ini.

---

## 1. Yang berubah (ringkas)

| Perubahan | Dampak ke mobile |
|---|---|
| **Rebrand nama → "Terakasir"** | Pastikan nama tampilan aplikasi = **Terakasir** (bila belum). Jangan ubah bundle/package id. |
| **Logo baru (final)** | Pakai berkas `docs/IMG_9765.PNG` sebagai sumber ikon launcher & ikon toko 512×512. |
| **Endpoint Mode Tamu (BARU)** | Tambah tombol "Masuk sebagai Tamu" + dipakai sebagai akun reviewer **tanpa geofence**. |
| **Halaman legal/dukungan publik sudah tersedia** | Pakai URL-nya di form App Store & Play Store, dan tautkan dari dalam aplikasi. |

> Sinkron offline `POST /api/sync` (Fase 1 & 2) sudah live & terdokumentasi di
> `docs/API-CONTRACT.md` — tidak berubah oleh handoff ini.

---

## 2. Aset & branding

- **Ikon aplikasi & toko**: dari `docs/IMG_9765.PNG` (kotak gradien hijau + bentuk putih). iOS: tanpa alpha. Play: 512×512.
- **Nama tampilan**: `Terakasir`.
- **Warna tema**: hijau `#0a7a0e` → `#8ec400` (gradien), aksen tombol oranye `#ea580c` (`orange-600`).
- **Bundle/Application ID**: **TETAP** `id.basooopa.kakarut` (mengubahnya memutus kontinuitas listing toko).
- **Plugin printer native**: nama plugin **TETAP** `KakarutPrinter` (identifier teknis, bukan brand).

---

## 3. Endpoint BARU — Mode Tamu (akun bersama, tanpa daftar)

Akun demo bersama untuk mencoba aplikasi **dan** untuk reviewer toko. Cabang
demo **tanpa geofence** → **absen bisa dari mana pun** (menyelesaikan syarat
"fitur harus bisa diuji reviewer").

```
POST /api/auth/guest
Content-Type: application/json

{ "peran": "owner" }        // atau "kasir"
```

**Respons 200** — sama persis dengan `POST /api/auth/login`:

```jsonc
{
  "token": "<JWT>",
  "user": { "sub", "email", "nama", "is_super_admin": false,
            "company_id", "role": "owner"|"cashier", "branch_id" },
  "company": { "id", "nama": "Terakasir Demo", "slug", "timezone", ... },
  "branch":  { "id", "nama": "Cabang Demo" }
}
```

- **Tanpa password.** Server hanya menerbitkan token untuk dua akun tamu tetap.
- Error **503** `{ "error": "Akun tamu belum siap — coba lagi sebentar" }` bila
  provisi belum selesai (jarang; boot idempoten).
- Setelah dapat token, alur SAMA seperti user biasa (pakai `Authorization: Bearer <token>`).
- Arahkan: `peran=owner` → beranda/dashboard; `peran=kasir` → layar kasir.

**Saran UI**: dua tombol di layar Login — "👔 Tamu Owner" & "🧾 Tamu Kasir"
(di web sudah begini). Beri catatan kecil: "Data contoh bersama · absen tanpa lokasi".

**Akun tamu** (bisa juga login normal bila perlu):
`owner-demo@terakasir.app` / `kasir-demo@terakasir.app` — password `demoterakasir`.

**Catatan untuk reviewer** (di catatan App Review / Play testing):
> Ketuk "Tamu Kasir" (atau "Tamu Owner") di layar Masuk — tanpa perlu akun.
> Cabang demo tanpa geofence, jadi absen & buka kasir bisa dari lokasi mana pun.
> Alur uji: Masuk (Tamu Kasir) → Absen (kamera) → Buka kasir → transaksi → struk.

---

## 4. URL untuk form App Store & Play Store

Halaman publik sudah dibuat (bisa dibuka **tanpa login**). Setelah domain aktif
(mis. `https://terakasir.com`), isi form toko dengan:

| Kolom toko | URL |
|---|---|
| **Privacy Policy** (WAJIB dua toko) | `https://<domain>/privasi` |
| **Support / Bantuan** | `https://<domain>/bantuan` |
| **Marketing / Homepage** | `https://<domain>/` |
| Terms of Use (opsional) | `https://<domain>/syarat` |

> Ganti `<domain>` dengan domain produksi final. Semua rute di atas dilayani
> oleh server yang sama dengan aplikasi.

Disarankan juga menautkan **Kebijakan Privasi** dari dalam aplikasi (mis. di
Profil/Pengaturan) — Apple menyukai ini.

---

## 5. Data untuk formulir kebijakan (App Privacy / Data Safety)

Isi konsisten dengan `/privasi`:

- Data dikumpulkan & tertaut ke identitas: **Email, Nama, Lokasi presisi (hanya
  saat absen), Foto (bukti absen), ID pengguna, Data transaksi usaha**.
- **Tidak ada tracking/iklan** → tanpa ATT (iOS).
- Data **dienkripsi saat transit (HTTPS)**.
- Pengguna dapat **menghapus akun dari dalam aplikasi** (fitur Hapus Akun).
- Kategori aplikasi: **Bisnis**.

**Email kontak** (App Privacy contact + support): `terahokiindonesia@gmail.com`.

Izin perangkat & alasannya (untuk string izin & form): **Kamera** (pindai QR
absen + foto bukti), **Lokasi** (geofence saat absen), **Bluetooth + jaringan
lokal** (printer struk).

---

## 6. Yang TIDAK berubah (jangan diubah)

- Bundle/Application ID: `id.basooopa.kakarut`.
- Nama plugin printer native: `KakarutPrinter`.
- Header versi API: `X-Kakarut-Build` (kontrak klien–server, hanya nama teknis).
- Skema/endpoint API lain — tidak ada breaking change.

---

## 7. Referensi

- `docs/API-CONTRACT.md` — kontrak API lengkap (termasuk sinkron offline `/api/sync`).
- `docs/mobile/RILIS-CHECKLIST.md` — checklist rilis App Store & Play Store.
- Logo master: `docs/IMG_9765.PNG`.
