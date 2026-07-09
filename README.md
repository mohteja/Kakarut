# Kakarut POS — SaaS POS untuk Bisnis F&B

Platform POS (point of sale) **multi-tenant** untuk bisnis F&B: banyak perusahaan,
banyak cabang, dengan mesin **HPP (harga pokok penjualan)** berbasis resep,
manajemen stok bahan baku, kasir, dan laporan harian.

Dibangun dari spesifikasi sistem HPP & stok **Basooopa** (usaha baso) — data
perusahaan tersebut di-seed sebagai tenant pertama untuk testing nyata.

## Fitur

- **Multi-tenant**: setiap perusahaan punya katalog, cabang, karyawan, dan stok sendiri; super-admin platform mengelola tenant.
- **HPP live**: HPP menu dihitung on-the-fly dari harga bahan terkini — ubah harga bahan, seluruh HPP/food-cost langsung ter-update.
- **Kasir (POS)**: tab kategori, keranjang, mode **dine-in / bawa pulang** (per transaksi & per baris), PB1 opsional, struk cetak.
- **Aturan dine-in sesuai spec**: komponen kemasan take-away tidak dihitung & tidak dikonsumsi; complement saos & sambal ×0,5.
- **Paket Yamin (harga khusus)**: HPP dasar × markup + topping tanpa markup.
- **Stok per cabang**: saldo = opname + produksi − terpakai (konsumsi otomatis dari resep saat penjualan); status Aman / Menipis / Habis.
- **Snapshot historis**: harga, HPP, dan konsumsi bahan disimpan saat transaksi — perubahan harga/resep tidak mengubah histori.
- **Laporan harian**: omzet, HPP terpakai, estimasi profit, item terjual, konsumsi bahan, kalkulator BEP.
- **Printer thermal**: cetak struk ESC/POS langsung dari browser — **Bluetooth (BLE)**, **USB (WebUSB)**, **aplikasi RawBT** (Android, printer Bluetooth klasik), atau dialog cetak browser; auto-print setelah pembayaran, potong kertas, buka laci kas.
- **Upload gambar** (menu/logo) ke **Cloudflare R2**, fallback disk lokal saat development.

## Arsitektur

```
packages/shared   → rumus HPP/harga (satu sumber kebenaran untuk server & web) + tipe DTO
apps/server       → API Hono (Node) + Drizzle ORM + PostgreSQL; menyajikan SPA hasil build
apps/web          → React + Vite + Tailwind (UI Bahasa Indonesia)
```

- **Database**: PostgreSQL (NUMERIC untuk uang/qty pecahan; multi-tenant via kolom `company_id`).
- **Auth**: JWT + bcrypt. Peran: `super admin platform`, `owner`, `admin`, `cashier` (kasir terkunci ke satu cabang).
- **Satu deployable**: satu proses Node menyajikan `/api/*`, `/uploads/*`, dan SPA.

## Menjalankan (development)

Prasyarat: Node ≥ 20, PostgreSQL 16 (atau `DATABASE_URL` ke Postgres mana pun).

```bash
npm install
npm run dev-db        # opsional: nyalakan cluster Postgres 16 lokal di port 5433
npm run db:migrate    # buat tabel
npm run seed          # seed super-admin + tenant Basooopa + katalog + stok demo
npm run dev:server    # API di :3000
npm run dev:web       # UI dev di :5173 (proxy ke :3000)
```

Atau mode produksi satu proses:

```bash
npm run build         # build UI ke apps/web/dist
npm start             # API + UI di :3000
```

### Akun hasil seed

| Peran | Email | Password |
|---|---|---|
| Super Admin (platform) | `superadmin@kakarut.id` | `SuperAdmin123!` |
| Owner Basooopa | `terahokiindonesia@gmail.com` | `Basooopa123!` |
| Kasir cabang Pusat | `kasir@basooopa.id` | `Kasir123!` |

> Password bisa dioverride lewat env `SEED_*` (lihat `.env.example`).
> **Segera ganti password setelah testing.** Seed bersifat idempotent (aman diulang)
> dan memverifikasi HPP semua 57 menu terhadap nilai referensi Excel (±Rp1).

## Verifikasi

```bash
npm test                     # unit test: HPP semua resep vs referensi, dine-in, paket, pembulatan
bash scripts/verify-api.sh   # e2e API: kasir, stok, dine-in, produksi, laporan, RBAC, isolasi tenant
npm run e2e -w @kakarut/web  # Playwright: login → POS → checkout → struk (butuh server jalan)
```

## Deploy produksi

1. Sediakan PostgreSQL (Neon / Supabase / VPS) → isi `DATABASE_URL`.
2. Salin `.env.example` ke `.env`, isi `JWT_SECRET` acak yang panjang.
3. (Opsional) isi kredensial **Cloudflare R2** (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`) — tanpa ini upload
   tersimpan di disk lokal server.
4. `npm run db:migrate && npm run seed` (seed opsional di produksi).
5. `npm run build && npm start` — aplikasi lengkap di satu port.

## Ringkasan API

Semua di bawah `/api`, autentikasi `Bearer <JWT>` kecuali `POST /auth/login` dan `GET /health`.

| Modul | Endpoint utama |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` |
| Super-admin | `GET/POST /admin/tenants`, `GET/PATCH /admin/tenants/:id` |
| Perusahaan | `GET/PATCH /company` |
| Cabang | `GET/POST /cabang`, `PATCH /cabang/:id` |
| Karyawan | `GET/POST /karyawan`, `PATCH /karyawan/:id` |
| Bahan | `GET/POST /bahan`, `PUT/DELETE /bahan/:id` |
| Kategori | `GET/POST /kategori`, `PATCH /kategori/:id` |
| Menu | `GET /menu` (dengan hpp, hpp_dine_in, harga_saran, food_cost), `POST/PUT/DELETE`, `GET /menu/panduan-markup` |
| Penjualan | `POST /penjualan`, `GET /penjualan?tanggal=`, `DELETE /penjualan/:id` (void) |
| Produksi | `POST /produksi` (`qty` atau `batch:true`), `GET /produksi?tanggal=` |
| Stok | `GET /stok`, `POST /stok/opname`, `GET /stok/opname` |
| Laporan | `GET /laporan?tanggal=`, `GET /laporan/bep?biaya_tetap=` |
| Upload | `POST /upload?tujuan=menu\|logo` (multipart, ≤5 MB) |

Owner/admin memilih cabang via `?branch_id=`; kasir otomatis terkunci ke cabangnya.

## Printer thermal

Pengaturan di menu **🖨 Printer** (tersimpan **per perangkat** — atur di tiap kasir/tablet).
Semua pencetakan dilakukan dari browser (server cloud tidak bisa menjangkau printer di toko).

| Metode | Untuk | Catatan |
|---|---|---|
| Cetak Browser (default) | Printer dengan driver terpasang | `window.print()` dengan CSS 58/80mm |
| Bluetooth (BLE) | Printer 58mm murah (EPPOS, Panda, ZJ-58xx, Xprinter), Epson TM-P, Star SM-L | Chrome/Edge di Android/PC, wajib **HTTPS**; iPhone: pakai browser Bluefy |
| USB (WebUSB) | Printer USB di PC/Android (OTG)/ChromeOS | Windows kadang perlu driver WinUSB (Zadig) |
| Aplikasi RawBT | Printer Bluetooth klasik (bukan BLE) di Android | Pasang RawBT dari Play Store; tanpa auto-print |

Fitur: lebar kertas 58/80mm (32/48 kolom, bisa override), **cetak otomatis setelah pembayaran**
(BLE/USB yang sudah terhubung), potong kertas (auto-cutter), buka laci kas (RJ11), Cetak Tes,
pengaturan chunk BLE untuk printer yang lambat. Teks footer struk & tampil/sembunyikan alamat
diatur per perusahaan di **Pengaturan → Perusahaan**.

## Aturan bisnis inti (dari spec Basooopa)

- Harga per unit bahan = `harga_beli / isi`
- HPP menu = Σ(qty komponen × harga per unit)
- Harga saran = HPP × markup; harga bulat = pembulatan ke ribuan terdekat
- Paket: HPP(dasar) × base_mult + topping pada harga asli (tanpa markup)
- Dine-in: tanpa kemasan take-away, complement ×0,5 (HPP & konsumsi stok)
- Saldo stok = opname terakhir + produksi − terpakai; Menipis bila < 15% dari (opname+produksi); Habis bila ≤ 0 dan ada pemakaian
- Laporan harian di zona waktu perusahaan (default Asia/Jakarta)

Dokumen spesifikasi asli: [`docs/SPEC-BACKEND-basooopa.md`](docs/SPEC-BACKEND-basooopa.md).
