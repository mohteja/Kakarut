# Terakasir — SaaS POS untuk Bisnis F&B

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
- **Stok per cabang**: saldo = opname + masuk − terpakai (konsumsi otomatis dari resep saat penjualan); status Aman / Menipis / Habis.
- **Dua jalur penambahan stok**: **Produksi Bahan Baku** (bahan buatan sendiri — baso, kuah, aci) dan **Beli Bahan Baku** (beli jadi — kemasan, powder, buah; dengan catatan total harga). Setiap bahan punya **jenis pengadaan** (`produksi`/`beli`) dan hanya bisa ditambah lewat jalurnya.
- **Faktur penerimaan stok**: penambahan stok lewat form faktur multi-item — sumber (**master supplier**), qty dalam **pcs atau batch** (dengan info isi per batch), **tempat penyimpanan** (master per cabang: freezer/gudang/dll). Faktur berstatus *Menunggu konfirmasi*; **stok baru terhitung setelah "Konfirmasi Ada"** (barang benar-benar diterima) — mendukung stock opname.
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
4. `npm run seed` untuk deploy pertama (membuat super-admin + tenant contoh).
5. `npm run build && npm start` — aplikasi lengkap di satu port.

### Migrasi database otomatis

Setiap rilis fitur baru menyertakan file migrasi di `apps/server/drizzle/`.
Saat server start, migrasi yang belum terpasang **diterapkan otomatis**
(`AUTO_MIGRATE`, default aktif) — deploy versi baru tidak butuh langkah manual.
Aman dijalankan berulang dan multi-instance (advisory lock PostgreSQL).

- Pantau & jalankan manual: panel super-admin → **Sistem & Migrasi**
  (`GET/POST /api/admin/sistem`).
- Nonaktifkan dengan `AUTO_MIGRATE=false` bila migrasi dikelola terpisah
  (mis. entrypoint Docker/CI menjalankan `npm run db:migrate`).

### Pencadangan (backup) database otomatis

Seluruh isi database diekspor berkala (JSONL ter-gzip) lalu diunggah ke
**storage cadangan yang privat** — Cloudflare R2 bila dikonfigurasi, jika tidak
ke disk lokal (`BACKUP_DIR`). Berjalan otomatis via penjadwal saat boot
(advisory lock, aman multi-instance). File upload (foto) tidak ikut dicadangkan
karena sudah tersimpan durable di R2.

- Panel super-admin → **Backup Database**: jadwal, backup manual, riwayat,
  unduh, dan hapus (`GET/POST /api/admin/sistem/backup`).
- Jadwalnya **harian pada jam lokal tenant** (bawaan 02:00) — dini hari saat
  outlet tutup, karena ekspor penuh membebani database. Zona waktunya mengikuti
  zona waktu tenant terbanyak. Server yang mati melewati jadwalnya akan
  mencadangkan begitu hidup lagi (jaring pengaman 26 jam).
- Variabel: `BACKUP_ENABLED` (default `true`), `BACKUP_HOUR` (jam lokal 0–23,
  default `2`), `BACKUP_TIMEZONE` (opsional, paksa zona waktu jadwal),
  `BACKUP_KEEP` (retensi, default `14`), `BACKUP_DIR` (folder
  saat mode lokal — arahkan ke volume ter-mount di kontainer), dan
  `R2_BACKUP_BUCKET` (opsional: bucket R2 privat khusus cadangan; bila kosong
  memakai `R2_BUCKET` dengan prefix `backups/`). Cadangan **tidak pernah**
  dilayani lewat URL publik — hanya diunduh lewat endpoint super-admin.
- **Pulihkan** dari berkas cadangan (⚠️ menimpa DB tujuan):

  ```sh
  # unduh berkas .jsonl.gz dari panel super-admin, lalu:
  npm run db:restore -w @kakarut/server -- <berkas.jsonl.gz>        # telaah (tanpa tulis)
  npm run db:restore -w @kakarut/server -- <berkas.jsonl.gz> --yes  # pulihkan
  ```

## Log galat platform (super-admin)

Setiap respons error yang keluar lewat `app.onError` — **5xx** (bug server)
maupun **4xx** (penolakan: validasi, izin, tak ditemukan, rate limit) — dicatat
ke tabel `error_logs`, termasuk jalur API yang tak cocok rute mana pun. Dipakai
panel super-admin agar masalah nyata terlihat tanpa membuka log container.

- Panel super-admin → **Log Galat** (`GET /api/admin/error-log`). Daftarnya
  berisi **kelompok**, bukan baris mentah: kejadian dengan status, pola jalur,
  dan pesan yang sama digabung lewat sidik jari, sehingga satu tombol yang rusak
  tidak menghasilkan ribuan baris. Klik kelompok → kronologi kejadiannya
  (siapa, perusahaan mana, jejak tumpukan untuk 5xx).
- **Tidak** disimpan: badan request (bisa memuat password), query string
  (tautan verifikasi & reset password membawa token di sana), dan header
  `Authorization`.
- Retensi 30 hari, maksimum 50.000 baris terbaru; dipangkas otomatis tiap 6 jam
  (dan bisa dipicu manual: `POST /api/admin/error-log/pangkas`).
- Pencatatan **tidak menahan respons** (fire-and-forget) dan menelan galatnya
  sendiri — menulis log tak boleh menjelma jadi kegagalan kedua.

### Re-deploy tanpa "404 page not found" (Dokploy/Traefik)

Halaman **"404 page not found"** polos saat deploy berasal dari **Traefik**
(bukan aplikasi): Traefik hanya mengarahkan trafik ke container **sehat**, dan
saat re-deploy compose container lama dihentikan dulu sebelum yang baru
dinyatakan sehat. Yang memperkecil jendela itu:

- **Healthcheck cepat** — Docker menjalankan cek pertama setelah `interval`
  berlalu; `interval: 5s` (di `docker-compose.yml` & `Dockerfile`) membuat
  container baru sehat dalam ±5–10 detik, bukan ±40–60 detik.
- **Boot tahan banting** — server me-retry koneksi DB saat boot (10× per 3 dtk),
  jadi Neon yang bangun dari idle tidak membuat container crash-loop.
- **Overlay klien** — pengguna yang aplikasinya SUDAH terbuka melihat overlay
  "server sedang diperbarui" + auto-reconnect, bukan halaman error.

Untuk **zero-downtime sejati** (tanpa jendela sama sekali), jalankan aplikasi
sebagai **Application** (bukan Compose) di Dokploy, lalu di
*Advanced → Swarm Settings → Update Config* isi `Order: start-first`
(+ `FailureAction: rollback`). Dengan begitu container baru dinaikkan &
ditunggu sehat dulu, baru yang lama dihentikan — healthcheck dari image sudah
mendukung ini.

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
| Produksi | `POST /produksi/faktur` (multi-item, status menunggu), `POST /produksi/konfirmasi/:fakturId`, `POST /produksi` (langsung), `GET /produksi?tanggal=` — hanya bahan jenis `produksi` |
| Pembelian | `POST /pembelian/faktur`, `POST /pembelian/konfirmasi/:fakturId`, `POST /pembelian`, `GET /pembelian?tanggal=` — hanya bahan jenis `beli`; `total_harga` default proporsional harga beli |
| Supplier | `GET/POST /supplier`, `PATCH /supplier/:id` |
| Penyimpanan | `GET/POST /penyimpanan` (per cabang), `PATCH /penyimpanan/:id` |
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
