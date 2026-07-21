# 📱 Kakarut POS — Kontrak API (untuk Tim Mobile Flutter)

Halo tim mobile. Dokumen ini adalah **acuan lengkap API server Kakarut POS** untuk
membangun aplikasi Flutter (native) yang bicara **langsung ke API**, bukan
membungkus web di WebView.

> **Sumber kebenaran:** semua endpoint di bawah dibaca langsung dari kode
> `apps/server/src` (Hono + TypeScript + Drizzle). Entry server:
> `apps/server/src/index.ts`; perakitan router: `apps/server/src/app.ts`; auth:
> `apps/server/src/middleware/auth.ts`. Definisi tipe DTO ada di
> `packages/shared/src/types.ts` (disalin utuh di **Lampiran** dokumen ini).

Aplikasi Flutter dikembangkan di repo terpisah **`kakarut-mobile`**. Dokumen ini
tidak menuntut akses ke repo server — cukup jadikan rujukan kontrak.

---

## 1. Konvensi

### Base URL
Semua endpoint dipasang di bawah prefix **`/api`** (`app.route("/api", api)`).
Semua path di bawah ditulis lengkap dengan prefix `/api/...`. Untuk klien mobile,
set base URL ke `https://<host-produksi>` lalu tambahkan path (mis.
`POST https://<host>/api/auth/login`).

### Autentikasi
- Header: **`Authorization: Bearer <JWT>`**.
- Token diterbitkan oleh `POST /api/auth/login`, ditandatangani dengan
  `JWT_SECRET`, masa berlaku `JWT_EXPIRES_IN`.
- Middleware `requireAuth` menolak token yang **tidak ada / tidak valid /
  kedaluwarsa** dengan **401**.
- Payload JWT (tipe `AuthUser`) berisi: `sub` (id user), `email`, `nama`,
  `is_super_admin`, `company_id`, `role`, `branch_id`.
- **Tidak ada cookie / CSRF** — auth murni via Bearer token. Simpan token di
  secure storage aplikasi.

### Peran (`UserRole`)
Empat peran: **`owner`**, **`admin`**, **`cashier`**, **`tim`**. Plus flag
platform **`is_super_admin`** (terpisah dari empat peran). Semantik dari
middleware:
- `requireRole(...peran)` → **403** jika `auth.role` di luar himpunan yang
  diizinkan.
- `requireCompany` → **403** jika akun tak punya `company_id` (tak terhubung ke
  perusahaan).
- `requireSuperAdmin` → **403** kecuali `is_super_admin`.
- `terikatCabang(role)` → true untuk **`cashier`** dan **`tim`** (peran terkunci
  cabang). `owner`/`admin` bebas lintas cabang.

### Aturan `branch_id` (`resolveBranchId`)
- Untuk peran terkunci (`cashier`/`tim`), cabang **selalu dipaksa ke
  `branch_id`-nya sendiri** — parameter query `?branch_id=` **diabaikan**.
- Untuk `owner`/`admin`, cabang aktif dipilih via **`?branch_id=<uuid>`**
  (divalidasi milik perusahaan; **404** bila bukan), default ke cabang aktif
  pertama perusahaan.
- Beberapa endpoint daftar (`/penjualan`, `/pembelian`, `/produksi`,
  `/penerimaan`, `/laporan/*`) juga menerima **`?branch_id=all`** untuk
  owner/admin agar mencakup semua cabang.

### Bentuk error JSON
Handler global (`app.onError`):
- `HTTPException` → `{ "error": "<pesan>" }` pada status exception.
- Error lain → `{ "error": "Terjadi kesalahan pada server" }` pada **500**.
- `/api/*` yang tak cocok → **404** `{ "error": "Tidak ditemukan" }`.
- **Catatan:** kegagalan validasi body oleh `zValidator` mengembalikan bentuk
  error default Hono/zod (400), **bukan** wrapper di atas.

### Header respons
Setiap respons API membawa **`X-Kakarut-Build: <buildId>`** (sinyal versi
frontend). Aman diabaikan oleh klien mobile.

### Urutan middleware (dari `app.ts`)
1. `logger()` (global)
2. Penyuntik header `X-Kakarut-Build` (global, di `/api/*`)
3. `GET /api/health` — tanpa auth
4. `/api/auth/*` — tanpa group auth (rute tertentu menambah `requireAuth`)
5. `/api/admin/*` — `requireAuth` + `requireSuperAdmin`
6. **Grup tenant** (selain di atas) — `requireAuth` + `requireCompany`, lalu
   gerbang peran per-prefix (di bawah), lalu rute modul.

Gerbang per-prefix di grup tenant (terverifikasi: gerbang `/prefix/*` Hono juga
jalan untuk root koleksi `/prefix`, jadi mencakup **semua** endpoint di modul):
- `/produksi/*`, `/pembelian/*` → **owner/admin, ATAU `tim` yang cabangnya
  `central_kitchen`** (`izinkanManajemenAtauKaryawanCk`; selain itu 403)
- `/laporan/*`, `/rekomendasi/*`, `/sampah/*`, `/karyawan/*`, `/customer/*` →
  `requireRole("owner","admin")`
- `/shift/*`, `/open-bill/*` → `requireRole("cashier")`
- `/absensi/*` → `requireRole("owner","admin","cashier","tim")`
- Modul tenant lain → semua anggota perusahaan yang login (owner/admin/cashier/
  tim), dengan `requireRole(...)` per-rute & pemeriksaan kunci-cabang seperti
  dicatat.

**Legenda kolom peran:** **[any]** = semua anggota perusahaan yang login;
**[super-admin]** = super admin platform; **[public]** = tanpa auth.

---

## 2. Rute dasar / non-modul (`index.ts`, `app.ts`)

- `GET /api/health` — [public] — res: `{ ok: true, storage: <mode>, build: <id> }` (jalankan `SELECT 1`)
- `GET /uploads/*` — [public] — penyajian file statis, **hanya saat mode storage `local`** (mode R2/remote menyajikan dari URL object store langsung)
- `GET /`, `GET /index.html`, `GET /*` — [public] — shell SPA + aset statis dari `apps/web/dist` (non-API; history-fallback untuk deep link)

---

## 3. `/api/auth` — Autentikasi (`modules/auth/routes.ts`)

> Bentuk sesi (dipakai login/register/onboarding): `{ token, user: AuthUser, company: {…} | null, branch: {id,nama} | null }`. **`company` bisa `null`** untuk user yang belum punya perusahaan (dan super-admin) — klien harus menangani: `company == null && !is_super_admin` → arahkan ke **onboarding** (buat perusahaan / terima undangan).

- `POST /api/auth/login` — [public] — req: `{ email (trim, lowercase), password (min 1) }` — res: sesi (`company` bisa null bila user belum punya perusahaan) — error: **401** email/password salah **atau akun dihapus/nonaktif**. **(CATATAN: tak lagi 403 untuk user tanpa perusahaan — kini login sukses dgn `company: null`.)**
- `POST /api/auth/register` — [public] — req: `{ nama, email (email valid, lowercase), password (min 8) }` — res: **201** sesi (langsung login; `company` null kecuali email punya undangan pending → auto-join) — error: **409** email sudah terdaftar, **400** validasi
- `POST /api/auth/forgot-password` — [public] — req: `{ email }` — res: **200** `{ ok: true, dev_reset_url? }` — SELALU 200 (tak bocorkan apakah email ada). Bila akun aktif: token reset dibuat + tautan dikirim via email. `dev_reset_url` HANYA muncul saat email server belum dikonfigurasi & bukan produksi (bantuan setup) — abaikan di produksi.
- `POST /api/auth/reset-password` — [public] — req: `{ token, password (min 8) }` — res: **200** `{ ok }` — error: **400** token tidak valid/kedaluwarsa/terpakai. Token berasal dari tautan email `APP_BASE_URL/reset-password?token=…` (halaman WEB).
- `GET /api/auth/me` — [any authenticated, incl. super-admin] (`requireAuth` inline) — res: `{ user: AuthUser, company | null }` — error: **401**

## `/api/onboarding` — Onboarding + lifecycle akun (`modules/onboarding/routes.ts`) — **[butuh login, TIDAK butuh perusahaan]**

> Dipakai user tanpa perusahaan setelah daftar/login. Aksi buat-perusahaan &
> terima-undangan mengembalikan **sesi BARU** (token+user+company) → klien harus
> MENGGANTI sesi tersimpan (seperti login), bukan menggabung.

- `GET /api/onboarding/status` — res: `{ has_company: bool, email: string, undangan: [{ id, company_nama, role, cabang_nama|null, diundang_pada }] }`
- `POST /api/onboarding/perusahaan` — req: `{ nama }` — res: **201** sesi baru (jadi owner perusahaan baru) — error: **403** super-admin
- `POST /api/onboarding/undangan/:id/terima` — res: sesi baru (bergabung ke perusahaan) — error: **404** bukan untuk email ini, **400** undangan tak berlaku
- `POST /api/onboarding/undangan/:id/tolak` — res: `{ ok }` — error: **404**
- `DELETE /api/onboarding/akun` — req: `{ password }` — SOFT delete akun sendiri — res: `{ ok }` — error: **401** password salah, **400** owner terakhir sebuah perusahaan (harus serahkan/hapus perusahaan dulu)

---

## 4. `/api/admin/tenants` — Admin tenant platform (`modules/admin-tenants/routes.ts`) — [super-admin]

- `GET /api/admin/tenants` — res: array `{ id, nama, slug, plan, plan_expires_at, is_active, created_at, jumlah_cabang, jumlah_user }`
- `POST /api/admin/tenants` — req: `{ nama: string, slug?: string (regex ^[a-z0-9-]+$), cabang_nama: string = "Pusat", owner_nama: string, owner_email: string (lowercase), owner_password: string (min 8), plan: string = "lite" }` — res: **201** `{ company, branch, owner: {id,email} }` — error: **409** slug/email dipakai
- `GET /api/admin/tenants/:id` — res: `{ company, cabang: [...], anggota: [{user_id,nama,email,role}] }` — error: **404**
- `PATCH /api/admin/tenants/:id` — req: `{ nama?, plan?, plan_expires_at?: string(datetime)|null, is_active?: boolean }` — res: row company terupdate — error: **404**

## `/api/admin/sistem` — Panel sistem platform (`modules/admin-system/routes.ts`) — [super-admin]

- `GET /api/admin/sistem` — res: `{ database_ok, storage_mode, node_version, migrations }`
- `POST /api/admin/sistem/migrate` — res: `{ ok: true, migrations }` — error: **500** migrasi gagal
- `GET /api/admin/sistem/smtp` — res: `SmtpSettingsDto` (`{ host|null, port, username|null, has_password, encryption, sender_name|null, sender_email|null, configured, provider }` — password mentah TAK pernah dikembalikan)
- `PUT /api/admin/sistem/smtp` — req: `{ host?, port?, username?, password?, encryption?: "none"|"ssl"|"starttls", sender_name?, sender_email? }` (password hanya berubah bila diisi non-kosong) — res: `SmtpSettingsDto`
- `POST /api/admin/sistem/smtp/test` — uji koneksi SMTP tersimpan — res: `{ ok }` — error: **400** koneksi gagal
- `POST /api/admin/sistem/smtp/test-email` — req: `{ to?: email }` (default email super-admin) — res: `{ ok, to, provider }` — error: **400** gagal kirim

> **Untuk mobile:** SMTP diatur super-admin (email sistem: reset password &
> undangan). Aplikasi kasir/karyawan **tak perlu** membangun halaman ini.

---

## 5. `/api/company` — Pengaturan perusahaan (`modules/company/routes.ts`)

- `GET /api/company` — [any] — res: row company + `{ mode: "lite"|"pro" }` — error: **404**
- `POST /api/company/mode` — [owner] — req: `{ mode: "lite"|"pro" }` — res: `{ ok, mode, lokasi_baru: string[] }` — error: **400** (tak bisa ke Lite bila >1 cabang aktif)
- `PATCH /api/company` — [owner/admin] — req: `{ nama?, alamat?|null, telepon?|null, logo_url?|null, pb1_enabled?: bool, pb1_rate?: number(0..100), receipt_footer?|null (max 200), receipt_show_alamat?: bool, target_penjualan?|null (≥0), diskon_maks_persen?: number(0..100), metode_hpp?: "average"|"fifo" }` — res: row company terupdate

## `/api/cabang` — Cabang (`modules/branches/routes.ts`)

- `GET /api/cabang` — [any] — res: array `{ id, nama, alamat, telepon, tipe, central_kitchen_id, receipt_footer, receipt_show_alamat, latitude, longitude, radius_absen_m, is_active }`
- `PUT /api/cabang/struk` — [owner/admin/cashier] — query: `branch_id` (owner/admin; cashier terkunci) — req: `{ receipt_footer?|null (max 200), receipt_show_alamat?: bool }` — res: `{ ok: true }` — error: **404**
- `POST /api/cabang` — [owner/admin] — req `CabangBody`: `{ nama: string, alamat?|null, telepon?|null, tipe?: "store"|"central_kitchen"|"kantor", central_kitchen_id?: uuid|null, receipt_footer?|null (max200), receipt_show_alamat?: bool, latitude?: number(-90..90)|null, longitude?: number(-180..180)|null, radius_absen_m?: int(10..10000), is_active?: bool }` — res: **201** `{ id, nama }` — error: **400** (Lite maks 1 cabang / CK invalid), **409** nama ada
- `PATCH /api/cabang/:id` — [owner/admin] — req: `CabangBody` (semua field parsial) — res: `{ ok: true }` — error: **400** CK invalid, **404**

## `/api/customer` — Member/pelanggan (`modules/customer/routes.ts`) — group guard **[owner/admin]**

- `GET /api/customer` — res: `CustomerDto[]` (`{id,nama,wa,catatan,jumlah_transaksi,total_belanja,terakhir}`)
- `GET /api/customer/:id` — res: `CustomerDetail` (customer + daftar transaksi) — error: **404**
- `POST /api/customer` — req: `{ nama: string, wa: string, catatan?|null }` — res: **201** row customer — error: **400** WA invalid, **409** WA sudah terdaftar
- `PUT /api/customer/:id` — req: parsial `{ nama?, wa?, catatan? }` — res: row customer — error: **400** WA invalid, **404**, **409** WA dipakai member lain
- `DELETE /api/customer/:id` — res: `{ ok: true }` — error: **404**

## `/api/member-cari` — Pencarian member ringan (`modules/customer/routes.ts`)

- `GET /api/member-cari` — [any] — query: `q` (substring nama atau WA) — res: `MemberCariRow[]` (`{id,nama,wa}`, maks 8, terbaru dulu) — (sengaja terbuka untuk semua peran demi autocomplete kasir)

---

## 6. `/api/bahan` — Bahan baku (`modules/bahan/routes.ts`)

- `GET /api/bahan` — [any] — res: `BahanDto[]`
- `POST /api/bahan` — [owner/admin] — req `BahanBody`: `{ slug?, kode?|null (max20), nama: string, harga_beli: number(≥0), isi: number(>0), satuan: string="pcs" (max20), satuan_beli?|null, track_stok: bool=true, stok_minimum: number(≥0)=0, stok_minimum_toko: number(≥0)=0, overhead_x: number(>0,≤1000)=1, kategori: string="lain" (max30), pengadaan: "produksi"|"beli"="beli", catatan?|null, is_packaging: bool=false, is_complement: bool=false, boleh_eceran: bool=false, min_beli: number(≥0)=0 }` — res: **201** `BahanDto` (atau **200** bila mereaktivasi slug yang di-soft-delete) — error: **409** bahan aktif sudah ada
- `POST /api/bahan/bulk` — [owner/admin] — req: `{ items: BahanBulkRow[] (1..200) }` (tiap row bahan jalur beli) — res: **201** `{ jumlah, bahan: BahanDto[] }`
- `POST /api/bahan/import` — [owner/admin] — req: `{ mode: "perbarui"|"tambah", items: BahanImportRow[] (1..1000) }` — res: `{ ditambah, diperbarui, dipulihkan, dilewati, gagal: [{nama,alasan}] }`
- `PUT /api/bahan/:id` — [owner/admin] — req `BahanPatchBody` (semua field opsional, tanpa default) — res: `BahanDto` — error: **404**, **409** (ubah ke "produksi" saat dipakai resep aktif / ubah `isi` saat produksi berjalan)
- `GET /api/bahan/:id/supplier` — [any] — res: `BahanSupplierDto[]` — error: **404**
- `PUT /api/bahan/:id/supplier` — [owner/admin] — req: `{ items: [{supplier_id: uuid, is_utama: bool=false}] (max50) }` — res: `BahanSupplierDto[]` — error: **400** (>1 utama / supplier invalid / bahan tipe produksi), **404**
- `GET /api/bahan/:id/pembelian` — [any] — res: `RiwayatHargaDto` (riwayat/lot harga beli) — error: **404**
- `POST /api/bahan/:id/harga` — [owner/admin] — req: `{ harga_per_unit: number(≥0) }` — res: `RiwayatHargaDto` — error: **404**
- `GET /api/bahan/:id/resep` — [any] — res: `BahanResepRow[]` (BOM) — error: **404**
- `PUT /api/bahan/:id/resep` — [owner/admin] — req: `{ komponen: [{ingredient_id: uuid, qty: number(>0)}] = [] }` — res: `{ ok, jumlah }` — error: **400** (bahan non-produksi / self-ref / input invalid / resep sirkular), **404**, **409** (tipe pengadaan berubah di tengah)
- `DELETE /api/bahan/:id` — [owner/admin] — soft delete — res: `{ ok: true }` — error: **404**, **409** masih dipakai menu aktif atau resep aktif lain

## `/api/kategori` — Kategori menu (`modules/kategori/routes.ts`)

- `GET /api/kategori` — [any] — res: `[{id,nama,sort_order}]`
- `POST /api/kategori` — [owner/admin] — req: `{ nama: string, sort_order: int=0 }` — res: **201** `{id,nama,sort_order}` — error: **409** ada
- `PATCH /api/kategori/:id` — [owner/admin] — req: `{ nama?, sort_order? }` — res: `{id,nama,sort_order}` — error: **404**
- `DELETE /api/kategori/:id` — [owner/admin] — res: `{ ok: true }` — error: **404**, **409** masih dipakai N menu

## `/api/kategori-bahan` — Kategori bahan (`modules/kategori-bahan/routes.ts`)

- `GET /api/kategori-bahan` — [any] — res: `[{id,nama,sort_order}]`
- `POST /api/kategori-bahan` — [owner/admin] — req: `{ nama: string (max30), sort_order: int=0 }` — res: **201** `{id,nama,sort_order}` (kembalikan match case-insensitive dengan **200** bila sudah ada) — error: **409**
- `PATCH /api/kategori-bahan/:id` — [owner/admin] — req: `{ nama? (max30), sort_order? }` — res: `{id,nama,sort_order}` — error: **404**
- `DELETE /api/kategori-bahan/:id` — [owner/admin] — res: `{ ok: true }` — error: **404**, **409** masih dipakai N bahan

## `/api/satuan` — Satuan (`modules/satuan/routes.ts`)

- `GET /api/satuan` — [any] — res: `[{id,nama,sort_order,dipakai}]`
- `POST /api/satuan` — [owner/admin] — req: `{ nama: string (max20), sort_order: int=0 }` — res: **201** `{id,nama,sort_order}` — error: **409**
- `PATCH /api/satuan/:id` — [owner/admin] — req: `{ nama? (max20), sort_order? }` — res: `{id,nama,sort_order}` — error: **404**
- `DELETE /api/satuan/:id` — [owner/admin] — res: `{ ok: true }` — error: **404**, **409** masih dipakai N bahan

## `/api/menu` — Menu (`modules/menu/routes.ts`)

- `GET /api/menu/panduan-markup` — [any] — res: konstanta `PANDUAN_MARKUP`
- `GET /api/menu` — [any] — query: `kategori_id?`, `semua=true` (termasuk nonaktif), `branch_id?` (owner/admin; cashier terkunci cabangnya) — res: `MenuDto[]`
- `GET /api/menu/ketersediaan` — [any] — query: `branch_id?` — res: row sisa-porsi per menu
- `GET /api/menu/:id` — [any] — res: `MenuDto` — error: **404**
- `PUT /api/menu/urutan` — [any] — req: `{ items: [{id: uuid, sort_order: int}] }` — res: `{ ok: true }`
- `POST /api/menu` — [owner/admin] — req `MenuBody`: `{ nama, kode?|null (max20), category_id: uuid, tipe: "regular"|"paket"="regular", mult?|null, base_menu_id?|null, base_mult?|null, harga_jual: number(≥0), image_url?|null, komponen: [{ingredient_id:uuid, qty:number(>0)}] = [], is_active: bool=true, branch_ids?: uuid[]|null }` — res: **201** `MenuDto` — error: **400** (paket butuh base_menu_id+base_mult / regular butuh mult / ref invalid / cabang non-store), **409** nama ada
- `PUT /api/menu/:id` — [owner/admin] — req: `MenuBody` (penuh) — res: `MenuDto` — error: **400**, **404**
- `DELETE /api/menu/:id` — [owner/admin] — soft delete — res: `{ ok: true }` — error: **404**

---

## 7. `/api/penjualan` — Penjualan POS (`modules/penjualan/routes.ts`)

- `POST /api/penjualan` — **[cashier only]** (`requireRole("cashier")` inline) — req `SaleBody`: `{ branch_id?: uuid, is_dine_in: bool=false, meja_id?: uuid, catatan?|null, diskon_tipe?: "persen"|"nominal", diskon_nilai?: number(≥0), customer_nama?|null, customer_wa?|null, metode_bayar?: "tunai"|"qris"|"transfer", uang_diterima?: number(≥0), items: [{menu_id:uuid, qty:number(>0), is_dine_in?:bool, catatan?}] (min 1) }` — res: **201** hasil sale + `{ kasir }` — error: **400** (validasi/diskon lewat batas), **403** kasir di luar cabang, **409** kasir belum dibuka (tidak ada shift terbuka di cabang → tampilkan gerbang "Buka Kasir")
- `GET /api/penjualan` — [any] — query: `branch_id?` (atau `all` untuk owner/admin), `tanggal?` (YYYY-MM-DD, default hari ini di TZ perusahaan) — res: array ringkasan sale — error: **400** format tanggal salah
- `GET /api/penjualan/:id` — [any] — res: `{ sale, items, branch_nama, kasir }` — error: **403** kasir luar cabang, **404**
- `DELETE /api/penjualan/:id` — [owner/admin] — soft delete → Tempat Sampah — res: `{ ok, nomor }` — error: **404**

## `/api/produksi` dan `/api/pembelian` — Tambah stok (pabrik) (`modules/produksi/routes.ts`)

> Kedua mount dibuat oleh factory yang sama `buatRuteTambahStok(tipe)` (`produksi`
> → `"produksi"`, `pembelian` → `"beli"`), jadi set rutenya identik. **Group
> guard keduanya: [owner/admin, ATAU `tim` di Central Kitchen].** Beda:
> `/kirim-hasil` khusus produksi, `/laporan-harga` khusus beli. Ganti `{mod}`
> dengan `produksi` atau `pembelian`.

- `POST /api/{mod}/faktur` — req `FakturBody`: `{ branch_id?: uuid, supplier_id?: uuid|null, no_faktur?|null (max60), catatan?|null, worker_id?: uuid|null, items: [{ingredient_id:uuid, mode:"pcs"|"batch", jumlah:number(>0), storage_location_id?:uuid|null, total_harga?:number(≥0)|null}] (min 1) }` — res: **201** `{ faktur_id, nomor, status:"rencana", jumlah_baris }` — error: **400** (supplier/ingredient/storage invalid, jalur pengadaan salah, produksi butuh worker), **403** kasir luar cabang, **404** ingredient tak ada
- `POST /api/{mod}/tahap/:fakturId` — req `TahapBody`: `{ ke: "dikerjakan"|"menunggu"|"dikonfirmasi", items?: [{id:uuid, qty:number(>0), harga?:number(≥0)|null}], dana_cair?:number|null, realisasi?:number|null, selisih_catatan?|null (max300), tujuan_branch_id?:uuid|null, tujuan_storage_id?:uuid|null, paksa?:bool }` — res: `{ ok, status, jumlah_baris }` — error: **400** (tahap tak urut, tujuan lintas cabang, qty>baris, dll), **403**, **404**, **409** (bahan mentah kurang → pesan kekurangan kecuali `paksa`; atau status berubah konkuren)
- `POST /api/{mod}/kirim/:fakturId` — req: `{ tujuan_storage_id?: uuid|null }` — res: `{ ok, tujuan, jumlah_baris }` — error: **400** (belum ada yang siap / cabang/storage tujuan invalid), **403** bukan staf CK
- `POST /api/produksi/kirim-hasil/:fakturId` — **produksi saja** (pembelian → **404**) — req: `{ tujuan_storage_id?: uuid|null, items?: [{ingredient_id:uuid, qty:number(>0)}] }` — res: `{ ok, faktur_id, nomor, tujuan, jumlah_baris }` — error: **400** (tak ada yang dikirim / stok CK kurang / tujuan invalid), **403**
- `GET /api/{mod}/dana/:fakturId` — res: `{ rows: [{id,tipe,nominal,catatan,oleh,waktu}], total }` — error: **404**
- `POST /api/{mod}/konfirmasi/:fakturId` — res: `{ ok, jumlah_baris }` — error: **404** tak ada / sudah dikonfirmasi
- `GET /api/{mod}/log/:fakturId` — res: `{ rows: [{id,aksi,detail,oleh,waktu}] }` — error: **404**
- `POST /api/pembelian/laporan-harga/:fakturId` — **[owner/admin]**, **beli saja** (produksi → **400**) — req: `{ items: [{id:uuid, total_harga:number(≥0)}] (min1) }` — res: `{ ok, jumlah }` — error: **400**, **404**
- `POST /api/{mod}` — req `TambahStokBody`: `{ branch_id?:uuid, ingredient_id:uuid, qty?:number(>0), batch:bool=false, total_harga?:number(≥0)|null, catatan? }` (refine: `batch` ATAU `qty` wajib) — res: **201** row production + `{ bahan }` — error: **400**, **404**
- `GET /api/{mod}` — query: `branch_id?` (atau `all`), `dari?`, `sampai?`, `tanggal?`, `page?` (default 1), `per_page?` (default 20, maks 200) — res: `{ rows, total, page, per_page, total_pengeluaran }`
- `PATCH /api/{mod}/faktur/:key` — req `FakturEditBody`: `{ password: string (wajib), supplier_id?:uuid|null, no_faktur?|null (max60), catatan?|null, storage_location_id?:uuid|null, worker_id?:uuid|null, prod_date?: "YYYY-MM-DD" }` — res: `{ ok, jumlah_baris }` — error: **401** password salah, **400** supplier/storage invalid, **404**
- `DELETE /api/{mod}/faktur/:key` — soft delete → Tempat Sampah (tanpa password) — res: `{ ok, jumlah_baris }` — error: **404**

## `/api/penerimaan` — Penerimaan barang di cabang (`modules/penerimaan/routes.ts`)

> Tanpa group role guard → **[any]** anggota perusahaan yang login; cashier/tim
> terkunci ke cabangnya.

- `GET /api/penerimaan` — query: `branch_id?` (atau `all`) — res: `{ rows: [...] }` (kiriman masuk menunggu diterima + ditolak)
- `POST /api/penerimaan/:fakturId/terima` — terima semua → stok masuk — res: `{ ok, jumlah_baris }` — error: **404**
- `POST /api/penerimaan/:fakturId/terima-sebagian` — req: `{ items: [{id:uuid, qty_diterima:number(≥0)}] (min1), alasan?|null (max300) }` — res: `{ ok, jumlah_baris }` — error: **400** (baris hilang / qty > dikirim), **404**, **409** status berubah
- `POST /api/penerimaan/:fakturId/tolak` — req: `{ alasan?|null (max300) }` — res: `{ ok, jumlah_baris }` — error: **404**
- `POST /api/penerimaan/:fakturId/batal-tolak` — res: `{ ok, jumlah_baris }` — error: **400** (sudah diterima sebagian), **404**

## `/api/supplier` — Supplier (`modules/supplier/routes.ts`)

- `GET /api/supplier` — [any] — res: `SupplierDto[]`
- `POST /api/supplier` — [any] (quick-add saat input faktur) — req: `{ nama: string, telepon?|null, alamat?|null, catatan?|null, is_active?: bool }` — res: **201** `SupplierDto` — error: **409** ada
- `GET /api/supplier/:id/kartu` — [any] — res: `SupplierKartu` (riwayat beli + ringkasan + bahan terkait) — error: **404**
- `PATCH /api/supplier/:id` — [owner/admin] — req: body supplier parsial — res: `SupplierDto` — error: **404**

## `/api/penyimpanan` — Tempat penyimpanan / rak (`modules/penyimpanan/routes.ts`)

- `GET /api/penyimpanan` — [any] — query: `branch_id?` — res: `PenyimpananDto[]` (dengan `petugas`, `jumlah_bahan`)
- `POST /api/penyimpanan` — [any] (quick-add; cashier cabang sendiri) — req: `{ branch_id?: uuid, nama: string, catatan?|null, is_active?: bool }` — res: **201** `PenyimpananDto` — error: **403** kasir luar cabang, **409** nama ada
- `PATCH /api/penyimpanan/:id` — [owner/admin] — req: parsial `{ nama?, catatan?, is_active? }` — res: `PenyimpananDto` — error: **404**
- `PUT /api/penyimpanan/:id/petugas` — [owner/admin] — req: `{ user_ids: uuid[] }` (replace-set petugas opname) — res: `{ ok, petugas }` — error: **400** bukan anggota, **404**
- `GET /api/penyimpanan/:id/bahan` — [any] — res: `{ ingredient_ids: uuid[], terpakai_lain: uuid[] }` — error: **404**
- `PUT /api/penyimpanan/:id/bahan` — [owner/admin] — req: `{ ingredient_ids: uuid[] (max 2000) }` (replace-set; satu bahan = satu rak per cabang) — res: `{ ok, jumlah }` — error: **400** bahan invalid, **404**

## `/api/meja` — Meja (`modules/meja/routes.ts`)

- `GET /api/meja` — [any] — query: `branch_id?` — res: `MejaDto[]`
- `POST /api/meja` — [any] (cashier cabang sendiri) — req: `{ branch_id?: uuid, nama: string, tipe?: "dine_in"|"takeaway", is_active?: bool }` — res: **201** `MejaDto` — error: **403**, **409** nama ada di cabang
- `PUT /api/meja/tata-letak` — [any] — query: `branch_id?` — req: `{ items: [{id:uuid, pos_x:int(0..100), pos_y:int(0..100)}] (max 500) }` — res: `MejaDto[]`
- `PATCH /api/meja/:id` — [any] (cashier cabang sendiri) — req: parsial `{ nama?, tipe?, is_active?, branch_id? }` — res: `MejaDto` — error: **403**, **404**
- `DELETE /api/meja/:id` — [any] (cashier cabang sendiri) — res: `{ ok: true }` — error: **400** (takeaway "Ruang Tunggu" tak bisa dihapus), **403**, **404**

## `/api/open-bill` — Open bill (`modules/open-bill/routes.ts`) — group guard **[cashier only]**

- `GET /api/open-bill` — query: `branch_id?` — res: `OpenBillRow[]`
- `GET /api/open-bill/:id` — res: `OpenBillDetail` — error: **404**
- `POST /api/open-bill` — req `BillBody`: `{ branch_id?: uuid, meja_id?: uuid|null, customer_nama?|null, customer_wa?|null, catatan?|null, items: [{menu_id:uuid, qty:number(>0), dine_in_override?:bool|null, catatan?}] (min 1) }` — res: **201** `OpenBillDetail` — error: **400** menu invalid/tak tersedia, **403** kasir luar cabang, **404** meja tak ada
- `PUT /api/open-bill/:id` — req: `BillBody` — res: `OpenBillDetail` — error: **400**, **404**
- `DELETE /api/open-bill/:id` — res: `{ ok: true }` — error: **404**

## `/api/shift` — Shift kasir (`modules/shift/routes.ts`) — group guard **[cashier only]**

- `GET /api/shift/aktif` — query: `branch_id?` — res: `Shift | null` (shift terbuka + rekap live)
- `GET /api/shift` — query: `branch_id?` — res: `Shift[]` (shift tertutup, maks 50)
- `POST /api/shift/buka` — req: `{ modal_awal: number(≥0)=0 }` — res: **201** `Shift` — error: **400** shift sudah terbuka **atau kasir belum absen masuk hari ini** (pesan: "Absen masuk dulu sebelum buka kasir"), **403** luar cabang
- `POST /api/shift/tutup` — req: `{ uang_fisik: number(≥0), catatan?|null }` — res: `Shift` — error: **400** tak ada shift terbuka

> **Gerbang Buka Kasir (penting untuk mobile):** transaksi POS (`POST /api/penjualan`)
> HANYA jalan bila ada shift **terbuka** di cabang. Sebelum layar kasir bisa
> dipakai, panggil `GET /api/shift/aktif`; bila `null`, tampilkan gerbang blokir
> "Buka Kasir" dan **jangan** biarkan transaksi. Syarat buka kasir: akun kasir
> **harus absen masuk dulu** hari ini — bila belum, `POST /api/shift/buka` balas
> **400**. Urutan wajib: **absen masuk → buka kasir → transaksi**. Lihat
> `docs/mobile/PROMPT-BUKA-KASIR.md` untuk spesifikasi UI lengkap.

## `/api/absensi` — Absensi (`modules/absensi/routes.ts`) — group guard **[owner/admin/cashier/tim]**

- `POST /api/absensi` — **[owner/admin/cashier]** (inline, kecuali tim) — pindai stasiun — query: `branch_id?` — req: `{ kode: string, foto_url: string (wajib), lat?: number(-90..90)|null, lng?: number(-180..180)|null }` — res: **201** `AbsenResult` — error: **400** (di luar radius geofence / GPS wajib / karyawan nonaktif), **404** kode tak dikenal
- `POST /api/absensi/saya` — [owner/admin/cashier/tim] — absen sendiri — query: `branch_id?` — req: `{ foto_url: string (wajib), lat?|null, lng?|null }` — res: **201** `AbsenResult` — error: **400** (geofence / tak ada kode karyawan / nonaktif), **403** bukan karyawan aktif
- `GET /api/absensi` — [owner/admin/cashier/tim] — query: `branch_id?`, `tanggal?` (YYYY-MM-DD) — res: `AbsensiRow[]` (masuk-pertama / keluar-terakhir per karyawan) — error: **400** tanggal salah

> **Catatan absensi (penting untuk mobile):** payload QR absen = **string kode
> mentah** (8 digit angka, teks polos tanpa prefix/JSON). Absen **wajib foto**:
> ambil foto → upload ke `POST /api/upload?tujuan=bukti` → kirim `foto_url` hasil
> di body absensi. Pencocokan kode case-insensitive. Input kode manual: keypad
> numerik, maks 8 karakter.

## `/api/profil` — Akun sendiri (`modules/profil/routes.ts`) — [any]

- `GET /api/profil` — res: `ProfilDto` `{ nama, email, role, cabang, employee_code }`
- `GET /api/profil/aktivitas` — res: `{ rows: [...] }` (log aktivitas faktur sendiri, maks 50)
- `POST /api/profil/password` — req: `{ password_lama: string, password_baru: string (min 8) }` — res: `{ ok: true }` — error: **401** password lama salah

## `/api/stok` — Stok & opname (`modules/stok/routes.ts`)

- `GET /api/stok` — [any] — query: `branch_id?` — res: array saldo stok (saldo per ingredient)
- `GET /api/stok/kartu/:ingredientId` — [any] — query: `branch_id?`, `dari?`, `sampai?` — res: kartu ledger stok — error: **400** stok tak dilacak, **404**
- `POST /api/stok/opname` — [owner/admin/cashier/tim] (inline) — req `OpnameBody`: `{ branch_id?: uuid, catatan?|null, items: [{ingredient_id:uuid, qty:number(≥0), foto_url?|null, alasan?|null}] (min 1) }` — res: **201** `{ ok, jumlah, session_id, nomor, ringkasan }` — error: **400** bahan invalid/tak dilacak, **403** (luar cabang / bukan petugas opname rak itu)
- `GET /api/stok/awal` — [owner/admin] — query: `branch_id?` — res: `{ tanggal, items: [{ingredient_id,qty,tanggal}] }`
- `POST /api/stok/awal` — [owner/admin] — req: `OpnameBody` + `{ tanggal?: "YYYY-MM-DD" }` (upsert saldo awal) — res: **201** `{ ok, jumlah, tanggal }` — error: **400**
- `GET /api/stok/penyesuaian` — [any] — query: `branch_id?`, `status?` (`belum` | `menunggu_persetujuan`) — res: row penyesuaian
- `POST /api/stok/penyesuaian/:id/klarifikasi` — [owner/admin] — req: `{ kategori: "waste_bahan"|"waste_matang"|"waste_gagal"|"koreksi_pencatatan"|"lainnya", catatan?|null, foto_url: string (min 1, wajib) }` — res: `{ ok: true }` — error: **400** (tak ada selisih / sudah disetujui), **404**
- `POST /api/stok/penyesuaian/:id/setujui` — [owner/admin] — res: `{ ok: true }` — error: **400**, **404**
- `POST /api/stok/penyesuaian/:id/tolak` — [owner/admin] — req: `{ alasan: string (min 1) }` — res: `{ ok: true }` — error: **404**
- `POST /api/stok/penyesuaian/setujui-massal` — [owner/admin] — query: `branch_id?` — res: `{ ok, jumlah }`
- `GET /api/stok/opname/riwayat` — [any] — query: `branch_id?` — res: row ringkasan sesi (per session_id)
- `GET /api/stok/opname/sesi/:sessionId` — [any] — res: detail sesi (fisik vs sistem per bahan) — error: **404**
- `POST /api/stok/opname/sesi/:sessionId/acc` — [owner/admin] — res: `{ ok, jumlah }` — error: **404**
- `POST /api/stok/opname/sesi/:sessionId/tolak` — [owner/admin] — req: `{ alasan?|null }` — res: `{ ok, jumlah }` — error: **404**
- `DELETE /api/stok/opname/sesi/:sessionId` — [owner/admin] — res: `{ ok, jumlah }` — error: **404**
- `GET /api/stok/opname` — [any] — query: `branch_id?` — res: row opname mentah (maks 200)

## `/api/perlengkapan` — Perlengkapan (non bahan baku) (`modules/perlengkapan/routes.ts`)

> Tanpa group role guard; peran per-rute inline. cashier/tim terkunci cabang via
> `resolveBranchId`.

- `GET /api/perlengkapan` — [any] — query: `branch_id?` — res: saldo perlengkapan (konsumsi otomatis diterapkan)
- `GET /api/perlengkapan/belanja` — [owner/admin] — query: `branch_id?`, `dari?`, `sampai?` (default bulan berjalan) — res: ringkasan belanja
- `GET /api/perlengkapan/master` — [owner/admin] — res: distribusi perlengkapan seluruh perusahaan
- `POST /api/perlengkapan/stok-awal` — [owner/admin] — query: `branch_id?` — req: `{ items: [{supply_id:uuid, qty:number(≥0)}] (min1) }` — res: `{ ok, jumlah, diubah }` — error: **404**
- `POST /api/perlengkapan/opname` — [any] — query: `branch_id?` — req: `{ items: [{supply_id:uuid, qty_fisik:number(≥0)}] (min1), catatan?|null (max300) }` — res: **201** `{session_id,nomor,...}` atau `{ session_id: null, ... }` bila tak ada selisih
- `GET /api/perlengkapan/opname/riwayat` — [any] — query: `branch_id?` — res: daftar sesi
- `GET /api/perlengkapan/opname/sesi/:sessionId` — [any] — res: detail sesi — error: **404**
- `POST /api/perlengkapan/opname/sesi/:sessionId/acc` — [owner/admin] — res: `{ ok, jumlah }` — error: **404**
- `POST /api/perlengkapan/opname/sesi/:sessionId/tolak` — [owner/admin] — res: `{ ok, jumlah }` — error: **404**
- `DELETE /api/perlengkapan/opname/sesi/:sessionId` — [owner/admin] — res: `{ ok, jumlah }` — error: **404**
- `POST /api/perlengkapan/permintaan-otomatis` — [owner/admin] — query: `branch_id?` — res: hasil kiriman — error: **400/404**
- `GET /api/perlengkapan/kiriman` — [any] — query: `branch_id?` — res: daftar kiriman
- `POST /api/perlengkapan/kiriman/:id/terima` — [any] — query: `branch_id?` — res: hasil — error: **400/404**
- `GET /api/perlengkapan/beli` — [any] — query: `branch_id?` (owner/admin; cashier/tim terkunci CK-nya) — res: daftar faktur beli
- `POST /api/perlengkapan/beli` — [owner/admin] — req: `{ supply_id:uuid, ck_branch_id?:uuid|null, qty:number(>0), tujuan_branch_id?:uuid|null, total_harga?:number(≥0)|null, catatan?|null }` — res: **201** hasil — error: **400/404**
- `POST /api/perlengkapan/beli/:id/tiba` — [owner/admin] — req: `{ qty?:number(>0), total_harga?:number(≥0)|null }` — res: hasil — error: **400/404**
- `POST /api/perlengkapan/beli/:id/batal` — [owner/admin] — res: hasil — error: **400/404**
- `POST /api/perlengkapan` — [owner/admin] — req `ItemBody`: `{ nama: string (max60), satuan: string="pcs" (max20), harga_beli: number(≥0)=0, stok_minimum: number(≥0)=0, catatan?|null (max300), kategori?|null (max60), boleh_eceran: bool=true, dilacak: bool=false, storage_location_id?: uuid|null }` — res: **201** `{ id, nama, dipulihkan }` — error: **400** rak invalid, **409** nama ada
- `PATCH /api/perlengkapan/:id` — [owner/admin] — req: `ItemPatchBody` (semua opsional + `is_active?`) — res: `{ ok: true }` — error: **400**, **404**
- `GET /api/perlengkapan/:id/supplier` — [any] — res: daftar supplier — error: **404**
- `PUT /api/perlengkapan/:id/supplier` — [owner/admin] — req: `{ items: [{supplier_id:uuid, is_utama:bool=false}] (max50) }` — res: `{ ok, jumlah }` — error: **400**, **404**
- `GET /api/perlengkapan/:id/pembelian` — [any] — res: `RiwayatHargaDto` — error: **404**
- `POST /api/perlengkapan/:id/harga` — [owner/admin] — req: `{ harga_per_unit: number(≥0) }` — res: `RiwayatHargaDto` — error: **404**
- `DELETE /api/perlengkapan/:id` — [owner/admin] — soft delete — res: `{ ok: true }` — error: **404**
- `POST /api/perlengkapan/:id/masuk` — [owner/admin] — query: `branch_id?` — req: `{ qty:number(>0), total_harga?:number(≥0)|null, catatan?|null (max300), tanggal?: "YYYY-MM-DD" }` — res: `{ ok, nomor, saldo }` — error: **404**
- `POST /api/perlengkapan/:id/pakai` — [any] — query: `branch_id?` — req: `{ qty:number(>0), catatan?|null (max300) }` — res: `{ ok, saldo }` — error: **400** stok kurang, **404**
- `POST /api/perlengkapan/:id/koreksi` — [owner/admin] — query: `branch_id?` — req: `{ qty_fisik:number(≥0), catatan?|null (max300) }` — res: `{ selisih, saldo }` — error: **404**
- `PUT /api/perlengkapan/:id/aturan` — [owner/admin] — query: `branch_id?` — req: `{ metode: "otomatis"|"manual"="otomatis", qty:number(≥0)=0, per_hari:int(1..365)=1, aktif:bool=true, mulai?: "YYYY-MM-DD" }` — res: `{ ok, saldo }` — error: **400** (otomatis butuh qty>0), **404**
- `POST /api/perlengkapan/:id/minta` — [any] — query: `branch_id?` — req: `{ qty:number(>0), catatan?|null (max300) }` — res: **201** `{ ok, kiriman_id, nomor }` — error: **400**, **404**
- `GET /api/perlengkapan/:id/kartu` — [any] — query: `branch_id?`, `dari?`, `sampai?` — res: kartu ledger perlengkapan — error: **404**

---

## 8. `/api/laporan` — Laporan (`modules/laporan/routes.ts`) — group guard **[owner/admin]**

- `GET /api/laporan` — query: `branch_id?` (atau `all`), `dari?`, `sampai?`, `tanggal?` — res: `LaporanHarian`
- `GET /api/laporan/pembelian` — query: `branch_id?` (atau `all`), `dari?`, `sampai?` — res: `LaporanPembelian`
- `GET /api/laporan/menu-laris` — query: `branch_id?` (atau `all`), `dari?`, `sampai?` — res: `MenuLaris`
- `GET /api/laporan/bep` — query: `biaya_tetap` (wajib, >0), `branch_id?` (atau `all`), `dari?`, `sampai?` — res: perhitungan BEP — error: **400** (biaya_tetap hilang/invalid, margin ≤ 0, tak ada menu)

## `/api/rekomendasi` — Rekomendasi beli & permintaan stok (`modules/rekomendasi/routes.ts`) — group guard **[owner/admin]**

- `GET /api/rekomendasi/beli` — query: `branch_id?`, `target?`, `acuan?` (`7hari`|`rentang`|`minggu_lalu`), `dari?`, `sampai?`, `pakai_dari?`, `pakai_sampai?` — res: hasil rekomendasi
- `POST /api/rekomendasi/menu` — req: `{ items: [{menu_id:uuid, porsi:int(1..100000)}] (min1), ck_branch_id?:uuid|null }` — res: pratinjau rencana
- `POST /api/rekomendasi/menu/faktur` — req: `RencanaBody` + `{ worker_id?, supplier_id?, supplier_beli_id?, tujuan_branch_id?, ck_branch_id?, catatan? }` (semua uuid/nullable) — res: **201** hasil faktur
- `GET /api/rekomendasi/permintaan` — res: `PermintaanStokRow[]`
- `DELETE /api/rekomendasi/permintaan/:rencanaId` — soft delete semua faktur ber-rencana_id sama — res: `{ ok, jumlah_baris }` — error: **404**

## `/api/sampah` — Tempat sampah / record soft-deleted (`modules/sampah/routes.ts`) — group guard **[owner/admin]**

- `GET /api/sampah` — res: `SampahRow[]` (penjualan + pembelian + produksi yang di-soft-delete)
- `POST /api/sampah/pulihkan` — req: `{ jenis: "penjualan"|"pembelian"|"produksi", key: string(uuid) }` — res: `{ ok, jumlah_baris }` — error: **404**
- `POST /api/sampah/kosongkan` — hapus permanen semua sampah — res: `{ ok, penjualan, faktur }`

## `/api/print` — Relay printer jaringan (`modules/print/routes.ts`) — [any]

- `POST /api/print/lan` — req: `{ host: string (1..255), port: int(1..65535), data: string (base64 ESC/POS, 1..400000) }` — res: `{ ok: true }` — error: **400** (host terlarang/internal, data kosong), **502** printer tak terjangkau

> Untuk cetak Bluetooth thermal di aplikasi Flutter, byte ESC/POS dibangun di
> sisi klien; endpoint ini hanya relay TCP untuk printer LAN. Printer Bluetooth
> ditangani native di aplikasi (di luar API).

## `/api/upload` — Unggah file (`modules/upload/routes.ts`) — [any]

- `POST /api/upload` — query: `tujuan=logo|bukti|menu` (default `menu`) — req: `multipart/form-data` field **`file`** (image/jpeg | image/png | image/webp, maks 5 MB) — res: **201** `{ url }` — error: **400** (file hilang / format salah / terlalu besar)

## `/api/karyawan` — Karyawan (`modules/users/routes.ts`) — group guard **[owner/admin]**

- `GET /api/karyawan` — query: `arsip=true` (daftar arsip) — res: row karyawan
- `POST /api/karyawan` — req `KaryawanBody`: `{ nama: string, email: string (lowercase), password: string (min 8), role: "owner"|"admin"|"cashier"|"tim", branch_id?: uuid|null }` — res: **201** `{ user_id, email, nama, role, employee_code }` — error: **400** (cashier/tim butuh cabang; mismatch peran/tipe cabang), **403** hanya owner boleh buat owner, **409** email ada — *(buat akun langsung + password. Untuk alur "menunggu diundang", pakai `/undang` di bawah.)*
- `POST /api/karyawan/undang` — req: `{ email, role: enum, branch_id?: uuid|null }` — buat UNDANGAN pending (tanpa password; email dikirim best-effort). Saat email itu daftar/menerima → membership dibuat otomatis — res: **201** `{ id, email, role }` — error: **400** (cashier/tim butuh cabang), **403** hanya owner boleh undang owner, **409** sudah jadi karyawan aktif / sudah diundang
- `GET /api/karyawan/undangan` — res: `UndanganKaryawanRow[]` (`{id,email,role,cabang_nama|null,status,diundang_pada}`, hanya pending)
- `DELETE /api/karyawan/undangan/:id` — batalkan undangan pending — res: `{ ok }` — error: **404**
- `GET /api/karyawan/:userId/aktivitas` — res: `{ rows: [...] }` (aktivitas faktur, maks 100)
- `GET /api/karyawan/:userId/tempat` — res: `{ assigned: uuid[], tersedia: [{id,nama}] }` — error: **404**
- `PUT /api/karyawan/:userId/tempat` — req: `{ tempat_ids: uuid[] }` — res: `{ ok, assigned }` — error: **400** (tempat luar cabang / tanpa cabang), **404**
- `PATCH /api/karyawan/:userId` — req `PatchKaryawanBody`: `{ nama?, email? (email valid), role?: enum, branch_id?: uuid|null, is_active?: bool, password? (min 8), arsip?: bool }` — res: `{ ok: true }` — error: **400** (cashier/tim butuh cabang; tak bisa arsip diri sendiri; tak bisa arsip owner terakhir), **403** (admin tak boleh sentuh/beri owner), **404**, **409** email ada

---

## 9. Catatan untuk tim mobile

- **Uang & jumlah** = angka biasa (rupiah tanpa desimal sen; qty bisa pecahan).
  Tanggal di query/body request pakai string `YYYY-MM-DD`; timestamp di respons
  string ISO-8601.
- **Siklus faktur** (produksi/pembelian) status: `rencana` → `dikerjakan` →
  `menunggu` → `dikonfirmasi` (plus `ditolak`); endpoint
  `POST /{mod}/tahap/:fakturId` menggerakkan transisi dan merupakan payload
  paling kompleks — mendukung maju sebagian per baris, split baris, pencatatan
  dana cair, dan tujuan kirim lintas cabang.
- Path param `:key` / `:fakturId` untuk produksi/pembelian menerima **UUID 36
  karakter** (bisa `faktur_id`, atau `id` row legacy untuk data pra-faktur);
  nilai non-UUID → **404** tanpa hit DB.
- **Definisi DTO lengkap** ada di **Lampiran A** (isi utuh
  `packages/shared/src/types.ts`) dan konstanta (`UserRole`, `PANDUAN_MARKUP`,
  enum) di `packages/shared/src/constants.ts`.
- **Alur login mobile disarankan:** `POST /api/auth/login` → simpan `token` di
  secure storage → set header `Authorization: Bearer <token>` di semua request →
  `GET /api/auth/me` saat buka app untuk validasi sesi (401 = minta login ulang).

---

## Lampiran A — Referensi DTO (`packages/shared/src/types.ts`)

Seluruh isi file tipe bersama disalin utuh di bawah sebagai acuan bentuk data
respons/DTO. Ini definisi TypeScript; terjemahkan ke model Dart sesuai kebutuhan.

```typescript
import type {
  BahanKategori,
  JenisPengadaan,
  MenuTipe,
  StokStatus,
  UserRole,
} from "./constants";

/** Payload JWT / hasil login */
export interface AuthUser {
  sub: string;
  email: string;
  nama: string;
  is_super_admin: boolean;
  company_id: string | null;
  role: UserRole | null;
  branch_id: string | null;
}

/** Profil akun sendiri (semua peran): identitas + kode/QR absen. */
export interface ProfilDto {
  nama: string;
  email: string;
  role: UserRole | null;
  cabang: string | null;
  employee_code: string | null;
}

/** Satu entri riwayat kegiatan pada faktur (jejak ubah tahap). */
export interface FakturLogRow {
  id: string;
  aksi: string;
  detail: string | null;
  oleh: string | null;
  waktu: string;
}

/** Kegiatan seorang karyawan pada faktur — pelacakan per orang. */
export interface AktivitasRow {
  id: string;
  jalur: JenisPengadaan;
  aksi: string;
  detail: string | null;
  cabang: string | null;
  faktur_id: string;
  waktu: string;
}

export interface BahanDto {
  id: string;
  slug: string;
  /** kode produk ringkas (otomatis/manual); null utk bahan lama sebelum backfill */
  kode: string | null;
  nama: string;
  harga_beli: number;
  isi: number;
  /** satuan kerja/resep (stok, resep, konsumsi, HPP): pcs, gr, ml, butir, dst */
  satuan: string;
  /** satuan beli/pembelian (mis. "dus"); null = beli langsung dalam satuan */
  satuan_beli: string | null;
  /** lacak stok: dipotong saat menjual, ditambah saat membeli/produksi */
  track_stok: boolean;
  /** ambang batas stok minimum di CK/kantor (0 = pakai rasio default) */
  stok_minimum: number;
  /** ambang stok minimum khusus cabang toko (0 = ikut stok_minimum) */
  stok_minimum_toko: number;
  /** pengali biaya resep → harga per batch bahan produksi (1 = mengikuti biaya resep) */
  overhead_x: number;
  harga_per_unit: number;
  kategori: BahanKategori;
  pengadaan: JenisPengadaan;
  catatan: string | null;
  is_packaging: boolean;
  is_complement: boolean;
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: boolean;
  /** MINIMAL BELANJA (MOQ): jumlah beli minimum saat belanja otomatis (0 = tanpa minimum) */
  min_beli: number;
  is_active: boolean;
  /** nama supplier UTAMA bahan ini (null = belum diatur) */
  supplier_utama: string | null;
  /** jumlah supplier yang terdaftar untuk bahan ini */
  jumlah_supplier: number;
  /**
   * DI SIMPAN DI MANA: rak per cabang (CK & cabang store) tempat bahan ini
   * disimpan. READ-ONLY di daftar — diatur di Stok → Tempat Penyimpanan
   * (bukan di form Bahan Baku). Kosong = belum diatur di rak mana pun.
   */
  rak_lokasi: RakLokasi[];
}

/** Satu penempatan bahan di rak sebuah cabang (untuk kolom "Rak simpan" daftar Bahan Baku). */
export interface RakLokasi {
  branch_id: string;
  branch_nama: string;
  branch_tipe: "store" | "central_kitchen" | "kantor";
  rak_id: string;
  rak_nama: string;
}

/** Mode impor CSV bahan baku. */
export type BahanImportMode = "perbarui" | "tambah";

/**
 * Satu baris impor CSV bahan baku (hasil parse di web → dikirim ke server).
 * Cocok dengan bahan lewat `kode` (bila ada) lalu slug (nama). `jenis`
 * (pengadaan) hanya diterapkan pada bahan BARU.
 */
export interface BahanImportRow {
  kode: string | null;
  nama: string;
  kategori: string;
  jenis: JenisPengadaan;
  harga_beli: number;
  isi: number;
  satuan: string;
  satuan_beli: string | null;
  stok_minimum: number;
  /** minimal belanja (MOQ); 0 = tanpa minimum */
  min_beli: number;
  boleh_eceran: boolean;
  lacak_stok: boolean;
  /** kemasan take-away (is_packaging) */
  kemasan: boolean;
  /** complement (×0.5 dine-in) */
  complement: boolean;
  catatan: string | null;
}

/** Ringkasan hasil impor CSV bahan baku. */
export interface BahanImportResult {
  ditambah: number;
  diperbarui: number;
  /** bahan yang tadinya di Tempat Sampah (nonaktif) lalu dipulihkan oleh impor */
  dipulihkan: number;
  dilewati: number;
  gagal: { nama: string; alasan: string }[];
}

/**
 * Satu supplier yang terdaftar untuk sebuah bahan (info "beli di mana").
 * is_utama = supplier utama/langganan (maksimal satu per bahan).
 */
export interface BahanSupplierDto {
  id: string;
  supplier_id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  is_utama: boolean;
}

/**
 * Satu baris resep produksi (BOM) bahan jadi: kebutuhan bahan mentah per
 * SATU BATCH (isi) bahan jadi.
 */
export interface BahanResepRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  /** kebutuhan per 1 batch (isi) bahan jadi */
  qty: number;
  harga_per_unit: number;
  track_stok: boolean;
}

export interface KomponenDto {
  ingredient_id: string;
  slug: string;
  nama: string;
  qty: number;
  satuan: string;
  track_stok: boolean;
  harga_per_unit: number;
  is_packaging: boolean;
  is_complement: boolean;
}

/** Kategori menu (master data). */
export interface KategoriDto {
  id: string;
  nama: string;
  sort_order: number;
}

/** Satuan bahan (master data) — sumber pilihan dropdown satuan. */
export interface SatuanDto {
  id: string;
  nama: string;
  sort_order: number;
  /** Jumlah bahan yang memakai satuan ini (sebagai satuan resep atau satuan beli). */
  dipakai: number;
}

/** Satu baris "Tambah Bahan Baku" (bulk) — selalu jalur beli. */
export interface BahanBulkRow {
  kode?: string | null;
  nama: string;
  harga_beli: number;
  isi: number;
  satuan: string;
  satuan_beli?: string | null;
  kategori: BahanKategori;
  track_stok: boolean;
  stok_minimum: number;
  boleh_eceran: boolean;
  /** minimal belanja (MOQ); 0 = tanpa minimum */
  min_beli?: number;
  /** kemasan take-away */
  is_packaging?: boolean;
  /** complement (×0.5 dine-in) */
  is_complement?: boolean;
  catatan?: string | null;
}

export interface MenuDto {
  id: string;
  nama: string;
  /** kode menu opsional (mis. "A1"), untuk kasir & daftar menu */
  kode: string | null;
  tipe: MenuTipe;
  category_id: string;
  kategori: string;
  mult: number | null;
  base_menu_id: string | null;
  base_menu_nama: string | null;
  base_mult: number | null;
  harga_jual: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  /** pembatasan lokasi (mode Pro) — [] = tampil di semua cabang */
  branch_ids: string[];
  komponen: KomponenDto[];
  /** dihitung live */
  hpp: number;
  hpp_dine_in: number;
  harga_saran: number;
  harga_jual_bulat: number;
  food_cost_persen: number;
}

/** Bahan yang MEMBATASI sisa porsi sebuah menu (saldo ÷ qty paling kecil). */
export interface MenuStokPembatas {
  ingredient_id: string;
  nama: string;
  saldo: number;
  satuan: string;
  qty_per_porsi: number;
}

/**
 * Ketersediaan (sisa porsi) sebuah menu di satu cabang — diturunkan dari saldo
 * stok bahan terlacak. `porsi` = berapa porsi lagi yang bisa dibuat
 * (min saldo/qty per porsi atas semua bahan pembatas); `null` bila menu tak
 * punya bahan terlacak yang membatasi (dianggap tak terbatas).
 */
export interface MenuStokDto {
  menu_id: string;
  porsi: number | null;
  /** bahan pembatas porsi; null bila porsi null (tak terbatas) */
  pembatas: MenuStokPembatas | null;
}

/** Satu baris rencana penambahan stok dari menu: target porsi per menu. */
export interface RencanaMenuItem {
  menu_id: string;
  porsi: number;
}

/** Ringkasan menu pada preview rencana (untuk baca ulang & perkiraan omzet). */
export interface RencanaMenuRingkas {
  menu_id: string;
  nama: string;
  kode: string | null;
  porsi: number;
  harga_jual: number;
  /** porsi × harga_jual */
  omzet: number;
}

/** Kebutuhan satu bahan pada preview rencana-dari-menu. */
export interface RencanaBahanRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  pengadaan: JenisPengadaan;
  /** total kebutuhan = Σ porsi × qty per porsi */
  kebutuhan: number;
  /** saldo stok cabang TUJUAN saja (bukan + CK) — cocok dgn Kartu Stok cabang */
  saldo: number;
  /** stok jadi yang ADA di Central Kitchen (bisa dikirim ke cabang; 0 bila tak ada CK) */
  saldo_ck: number;
  /** kekurangan cabang = max(0, kebutuhan − saldo cabang); 0 = stok cabang cukup */
  kurang: number;
  /** bagian kekurangan yang dipenuhi dgn KIRIM DARI STOK CK (transfer, bukan produksi baru) */
  kirim_ck: number;
  isi: number;
  /** baris faktur yang akan dibuat (null bila kurang = 0) */
  mode_faktur: "pcs" | "batch" | null;
  jumlah_faktur: number | null;
  /** kuantitas riil yang masuk stok dari faktur (jumlah × isi utk batch) */
  qty_faktur: number | null;
  harga_per_unit: number;
  estimasi_biaya: number | null;
  /** khusus baris BAHAN PRODUKSI: nama bahan jadi yang membutuhkannya */
  untuk?: string | null;
}

/** Preview rencana penambahan stok dari target porsi menu. */
export interface RencanaMenuPreview {
  menus: RencanaMenuRingkas[];
  /** Σ porsi × harga_jual — untuk menyamakan rencana dengan target omzet */
  perkiraan_omzet: number;
  bahan: RencanaBahanRow[];
  /**
   * BELANJA BAHAN PRODUKSI: bahan mentah (resep) yang dibutuhkan bahan jadi
   * yang akan diproduksi — kekurangan dihitung terhadap stok cabang PELAKSANA
   * (Central Kitchen bila ada). Terpisah dari belanja produk langsung jadi.
   */
  bahan_produksi: RencanaBahanRow[];
  total_estimasi_biaya: number;
  /** jumlah bahan kurang per jalur (baris faktur yang akan dibuat) */
  jumlah_produksi: number;
  jumlah_beli: number;
  jumlah_beli_produksi: number;
  /** jumlah bahan yang akan DIKIRIM dari stok CK (transfer, tanpa produksi baru) */
  jumlah_kirim: number;
}

/** Hasil pembuatan faktur otomatis dari rencana menu (null = jalur tak perlu). */
export interface RencanaFakturResult {
  produksi: { faktur_id: string; jumlah_baris: number } | null;
  beli: { faktur_id: string; jumlah_baris: number } | null;
  /** faktur beli BAHAN PRODUKSI (bahan mentah resep) — terpisah dari beli produk jadi */
  beli_produksi: { faktur_id: string; jumlah_baris: number } | null;
  /** faktur KIRIM DARI STOK CK (transfer stok jadi CK → cabang, tanpa produksi baru) */
  kirim: { faktur_id: string; jumlah_baris: number } | null;
}

/** Satu bagian (Produksi / Beli) dari sebuah permintaan tambah stok. */
export interface PermintaanStokBagian {
  faktur_id: string;
  jumlah_baris: number;
  /** status "paling awal" di antara baris faktur (tahap terkini) */
  status: KonfirmasiStatus;
  total: number;
}

/**
 * Satu permintaan "Tambah Stok dari Menu": gabungan faktur Produksi + Beli
 * yang lahir dari satu submit (dikelompokkan lewat productions.rencana_id).
 */
export interface PermintaanStokRow {
  rencana_id: string;
  /** ISO timestamp pembuatan permintaan */
  waktu: string;
  /** ringkasan menu/porsi ("50× BASOAC, 30× PYO") dari catatan faktur */
  catatan: string | null;
  /** cabang tujuan (store yang butuh stok); null bila hanya beli */
  tujuan_cabang: string | null;
  /** nama pembuat permintaan */
  pembuat: string | null;
  produksi: PermintaanStokBagian | null;
  beli: PermintaanStokBagian | null;
  /** belanja bahan mentah untuk produksi (dari resep) */
  beli_produksi: PermintaanStokBagian | null;
  /** KIRIM DARI STOK CK: stok jadi yang sudah ada di CK, dipindah ke cabang */
  kirim: PermintaanStokBagian | null;
}

/**
 * Status pipeline stok masuk: rencana (RAB) → dikerjakan → menunggu →
 * dikonfirmasi (masuk stok). 'ditolak' khusus jalur beli (kiriman ditolak
 * penerima; bisa dibatalkan → dikonfirmasi). Stok terhitung saat 'dikonfirmasi'.
 */
export type KonfirmasiStatus =
  | "rencana"
  | "dikerjakan"
  | "menunggu"
  | "dikonfirmasi"
  | "ditolak";

/** Produksi in-house yang sedang berjalan (belum masuk saldo stok). */
export interface ProduksiBerjalan {
  /** total qty semua tahap berjalan (rencana + dikerjakan + menunggu) */
  qty: number;
  rencana: number;
  dikerjakan: number;
  menunggu: number;
}

export interface StokRowDto {
  ingredient_id: string;
  slug: string;
  nama: string;
  kategori: BahanKategori;
  isi: number;
  satuan: string;
  /** tempat penyimpanan dari entri masuk terkonfirmasi terakhir */
  tempat: string | null;
  tempat_id: string | null;
  stok_awal: number;
  produksi: number;
  terpakai: number;
  saldo: number;
  status: StokStatus;
  /** ambang batas stok minimum yang diatur untuk bahan ini (0 = pakai rasio default) */
  stok_minimum: number;
  /** produksi in-house yang belum masuk stok (rencana→dikerjakan→menunggu); null bila tak ada */
  produksi_berjalan: ProduksiBerjalan | null;
  /** pembelian (beli jadi) yang belum masuk stok (RAB→diproses→dikirim); null bila tak ada */
  pembelian_berjalan: ProduksiBerjalan | null;
}

export interface SupplierDto {
  id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  catatan: string | null;
  is_active: boolean;
}

/** Satu baris transaksi pembelian pada kartu supplier. */
export interface SupplierKartuRow {
  id: string;
  waktu: string;
  prod_date: string;
  no_faktur: string | null;
  faktur_id: string | null;
  bahan: string;
  satuan: string;
  qty: number;
  total_harga: number | null;
  status: KonfirmasiStatus;
  cabang: string | null;
}

/**
 * KARTU SUPPLIER: riwayat transaksi pembelian yang tercatat ke supplier ini +
 * ringkasan belanja + bahan yang menautkannya (★ = supplier utama bahan itu).
 */
export interface SupplierKartu {
  supplier: SupplierDto;
  /** total belanja TERKONFIRMASI (barang benar-benar diterima) */
  total_belanja: number;
  /** jumlah faktur pembelian yang menyebut supplier ini */
  jumlah_transaksi: number;
  rows: SupplierKartuRow[];
  bahan: { ingredient_id: string; nama: string; is_utama: boolean }[];
}

// ===== Rekomendasi pembelian dari target penjualan =====

export type AcuanJenis = "minggu_lalu" | "7hari" | "rentang";

/** Periode acuan yang dipakai memproyeksikan kebutuhan dari target penjualan. */
export interface AcuanPeriode {
  jenis: AcuanJenis;
  dari: string;
  sampai: string;
  /** omzet (Rp) pada periode acuan — penyebut skala */
  omzet: number;
  /** true bila hari-sama-minggu-lalu kosong lalu fallback ke rata-rata 7 hari */
  fallback: boolean;
}

export interface MenuTerlaris {
  menu_nama: string;
  qty: number;
  omzet: number;
}

export interface RekomendasiBahanRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  kategori: BahanKategori;
  pengadaan: JenisPengadaan;
  /** pemakaian pada periode "terpakai" terpilih (default hari ini) */
  terpakai: number;
  /** stok tersisa saat ini */
  sisa: number;
  /** pemakaian pada periode acuan */
  acuan_qty: number;
  /** kebutuhan untuk mencapai target (null bila omzet acuan 0) */
  kebutuhan: number | null;
  /** maks(0, kebutuhan − sisa) MENTAH (belum dibulatkan); null bila tak bisa dihitung */
  saran_beli: number | null;
  /** isi per kemasan (beli) / hasil per batch (produksi) */
  isi: number;
  /** saran terbulatkan mengikuti faktur otomatis: "batch" = kemasan/batch penuh */
  mode_faktur: "pcs" | "batch" | null;
  jumlah_faktur: number | null;
  /** kuantitas riil bila saran dibeli (jumlah × isi utk kemasan/batch) */
  qty_faktur: number | null;
  harga_per_unit: number;
  /** round(qty_faktur × harga_per_unit) — dari kuantitas terbulatkan */
  estimasi_biaya: number | null;
}

export interface RekomendasiBeli {
  /** target penjualan (Rp) yang dipakai */
  target: number;
  /** tanggal hari ini (tz perusahaan) */
  hari_ini: string;
  acuan: AcuanPeriode;
  /** periode kolom "terpakai" (default hari ini; dari===sampai bila satu tanggal) */
  pakai: { dari: string; sampai: string };
  menu_terlaris: MenuTerlaris[];
  bahan: RekomendasiBahanRow[];
}

/** Akun yang ditugaskan opname pada satu tempat penyimpanan. */
export interface PetugasRingkas {
  user_id: string;
  nama: string;
  role: UserRole;
}

export interface PenyimpananDto {
  id: string;
  branch_id: string;
  nama: string;
  catatan: string | null;
  is_active: boolean;
  /**
   * Petugas opname yang ditugaskan. Kosong = terbuka (siapa saja yang boleh
   * opname di cabang). Terisi = terkunci hanya untuk mereka (owner/admin bebas).
   */
  petugas: PetugasRingkas[];
  /** jumlah bahan baku yang ditugaskan disimpan di rak ini (rak default cabang) */
  jumlah_bahan: number;
}

/**
 * Penugasan tempat SO (stock opname) untuk satu karyawan: `tersedia` = semua
 * tempat penyimpanan di cabang karyawan; `assigned` = id tempat yang jadi
 * tugasnya. Dipakai halaman Karyawan (GET/PUT /karyawan/:id/tempat).
 */
export interface KaryawanTempatDto {
  assigned: string[];
  tersedia: { id: string; nama: string }[];
}

/** jenis meja: meja makan (dine-in) vs "Ruang Tunggu" untuk take away. */
export type MejaTipe = "dine_in" | "takeaway";

/** Master meja per cabang + posisi denah (persen 0..100). */
export interface MejaDto {
  id: string;
  branch_id: string;
  nama: string;
  tipe: MejaTipe;
  pos_x: number;
  pos_y: number;
  is_active: boolean;
}

export type PenyesuaianKategori =
  | "waste_bahan"
  | "waste_matang"
  | "waste_gagal"
  | "koreksi_pencatatan"
  | "lainnya";

/** Label + apakah dianggap waste, untuk UI klarifikasi penyesuaian stok. */
export const KLARIFIKASI_KATEGORI: {
  key: PenyesuaianKategori;
  label: string;
  keterangan: string;
  is_waste: boolean;
}[] = [
  {
    key: "waste_bahan",
    label: "Waste bahan",
    keterangan: "Bahan rusak/kadaluarsa, salah penyimpanan",
    is_waste: true,
  },
  {
    key: "waste_matang",
    label: "Waste sudah dimasak",
    keterangan: "Sudah dimasak tapi tidak terjual",
    is_waste: true,
  },
  {
    key: "waste_gagal",
    label: "Waste produk gagal",
    keterangan: "Gagal dibuat / kurang matang / diganti",
    is_waste: true,
  },
  {
    key: "koreksi_pencatatan",
    label: "Koreksi pencatatan",
    keterangan: "Bukan waste — salah hitung/input",
    is_waste: false,
  },
  { key: "lainnya", label: "Lainnya", keterangan: "Jelaskan di catatan", is_waste: false },
];

/** status persetujuan penyesuaian: menunggu owner/admin, lalu disetujui. */
export type PenyesuaianStatus = "menunggu" | "disetujui" | "ditolak";

/**
 * Status sesi opname (agregat baris): cocok (tak ada selisih), menunggu ACC
 * owner/admin, disetujui (selisih diterapkan ke stok), atau ditolak (dibuang).
 */
export type OpnameSesiStatus = "cocok" | "menunggu" | "disetujui" | "ditolak";

export interface PenyesuaianRow {
  id: string;
  waktu: string;
  bahan: string;
  satuan: string;
  system_qty: number | null;
  qty_fisik: number;
  selisih: number;
  klarifikasi_status: "belum" | "sudah";
  /** menunggu persetujuan owner/admin, atau sudah disetujui (stok disesuaikan) */
  penyesuaian_status: PenyesuaianStatus;
  kategori: PenyesuaianKategori | null;
  catatan: string | null;
  foto_url: string | null;
  /** alasan penolakan terakhir (bila dikembalikan untuk klarifikasi ulang) */
  tolak_alasan: string | null;
  /** karyawan yang input opname */
  oleh: string | null;
  /** karyawan yang mengklarifikasi */
  diklarifikasi_oleh: string | null;
  /** owner/admin yang menyetujui */
  disetujui_oleh: string | null;
}

export interface OpnameRingkasan {
  dihitung: number;
  cocok: number;
  lebih: number;
  kurang: number;
  total_selisih: number;
}

export interface OpnameSesiRow {
  session_id: string;
  /** nomor sesi otomatis (SO-0001) */
  nomor: string | null;
  waktu: string;
  oleh: string | null;
  jumlah_item: number;
  jumlah_selisih: number;
  catatan: string | null;
  /** status ACC sesi: cocok / menunggu / disetujui / ditolak */
  status: OpnameSesiStatus;
}

export interface OpnameSesiDetail {
  session_id: string;
  /** nomor sesi otomatis (SO-0001) */
  nomor: string | null;
  waktu: string;
  oleh: string | null;
  catatan: string | null;
  status: OpnameSesiStatus;
  /** owner/admin yang meng-ACC / menolak (bila ada) */
  ditinjau_oleh: string | null;
  items: {
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number;
    selisih: number | null;
    /** bukti foto selisih (URL) — dilampirkan saat pengecekan, untuk ACC admin */
    foto_url: string | null;
    /** alasan selisih (opsional) — dilampirkan saat pengecekan */
    alasan: string | null;
  }[];
}

export type MutasiJenis = "opname" | "produksi" | "beli" | "penjualan" | "pemakaian";

/** Satu baris kartu stok (buku besar mutasi per bahan). */
export interface MutasiStok {
  waktu: string;
  jenis: MutasiJenis;
  keterangan: string | null;
  masuk: number | null;
  keluar: number | null;
  /** saldo berjalan setelah mutasi ini */
  saldo: number;
}

export interface KartuStokDto {
  bahan: { id: string; nama: string; slug: string; satuan: string };
  periode: { dari: string; sampai: string };
  saldo_awal: number;
  saldo_akhir: number;
  total_masuk: number;
  total_keluar: number;
  /** true bila mutasi melebihi batas 500 baris (persempit periode) */
  terpotong: boolean;
  /** produksi in-house yang belum masuk saldo (independen dari periode) */
  produksi_berjalan: ProduksiBerjalan | null;
  /** pembelian (beli jadi) yang belum masuk saldo (independen dari periode) */
  pembelian_berjalan: ProduksiBerjalan | null;
  mutasi: MutasiStok[];
}

export interface SaleItemInput {
  menu_id: string;
  qty: number;
  /** override per baris; default mengikuti is_dine_in transaksi */
  is_dine_in?: boolean;
  /** catatan personalisasi per baris (mis. "tanpa gula") */
  catatan?: string | null;
}

/** Baris riwayat transaksi kasir (untuk cek pesanan / cetak ulang struk). */
export interface RiwayatTransaksiRow {
  id: string;
  nomor: string;
  waktu: string;
  total: number;
  is_dine_in: boolean;
  /** label meja terpilih (null bila transaksi lama tanpa meja) */
  meja: string | null;
  /** jumlah baris menu pada transaksi */
  jumlah_item: number;
  kasir: string | null;
  /** nama konsumen/member (null bila transaksi tanpa member) */
  konsumen: string | null;
  metode: MetodeBayar;
  /** nama cabang transaksi — terisi utk tampilan lintas cabang (?branch_id=all) */
  cabang: string | null;
}

/** Member/pelanggan pada daftar member area (dengan agregat transaksi). */
export interface CustomerDto {
  id: string;
  nama: string;
  wa: string;
  catatan: string | null;
  jumlah_transaksi: number;
  total_belanja: number;
  /** waktu transaksi terakhir (ISO) — null bila belum pernah transaksi */
  terakhir: string | null;
}

/** Satu transaksi milik seorang member (untuk detail member area). */
export interface CustomerTransaksi {
  id: string;
  /** nomor invoice/struk */
  nomor: string;
  waktu: string;
  total: number;
  cabang: string;
}

/** Detail member: profil + riwayat transaksinya. */
export interface CustomerDetail extends CustomerDto {
  transaksi: CustomerTransaksi[];
}

/** Baris di Tempat Sampah: transaksi yang di-soft-delete (hanya catatan, tak bisa dikembalikan). */
export interface SampahRow {
  jenis: "penjualan" | "pembelian" | "produksi";
  /** id penjualan, atau fakturId/id baris untuk pembelian/produksi */
  key: string;
  /** ringkasan: nomor struk / daftar bahan */
  label: string;
  waktu: string;
  total: number;
  dibuat_oleh: string | null;
  dihapus_oleh: string | null;
  dihapus_pada: string;
}

/** Metode pembayaran transaksi. */
export type MetodeBayar = "tunai" | "qris" | "transfer";

export interface LaporanHarian {
  dari: string;
  sampai: string;
  omzet: number;
  jumlah_transaksi: number;
  /** rekap penjualan per metode bayar (total = omzet bruto/subtotal per metode) */
  per_metode: { metode: MetodeBayar; jumlah: number; total: number }[];
  /** total potongan/diskon yang diberikan pada rentang (Rp) */
  total_diskon: number;
  pb1_terkumpul: number;
  total_hpp: number;
  estimasi_profit: number;
  item_terjual: { menu_nama: string; qty: number; omzet: number }[];
  konsumsi_bahan: { nama: string; slug: string; qty: number }[];
}

/** Satu baris ranking menu terlaris. */
export interface MenuLarisRow {
  menu_id: string;
  nama: string;
  kode: string | null;
  kategori: string;
  /** jumlah porsi terjual pada rentang */
  qty: number;
  /** omzet (Rp) dari menu ini pada rentang */
  omzet: number;
}

/** Laporan menu terlaris pada rentang tanggal (urut qty terbanyak). */
export interface MenuLaris {
  dari: string;
  sampai: string;
  total_qty: number;
  total_omzet: number;
  items: MenuLarisRow[];
}

/** Satu baris item pada open bill (pesanan belum dibayar). */
export interface OpenBillItemDto {
  menu_id: string;
  qty: number;
  /** null = ikut mode transaksi; true/false = override dine-in per baris */
  dine_in_override: boolean | null;
  catatan: string | null;
}

/** Ringkasan open bill untuk daftar/pemilih bill di kasir. */
export interface OpenBillRow {
  id: string;
  meja_label: string | null;
  customer_nama: string | null;
  jumlah_item: number;
  /** waktu terakhir diperbarui (ISO) */
  waktu: string;
}

/** Detail open bill (dimuat kembali ke keranjang saat dibuka). */
export interface OpenBillDetail {
  id: string;
  meja_id: string | null;
  meja_label: string | null;
  customer_nama: string | null;
  customer_wa: string | null;
  catatan: string | null;
  items: OpenBillItemDto[];
}

/** Sesi kas (shift) per cabang. ditutup_* null → shift masih terbuka. */
export interface Shift {
  id: string;
  branch_nama: string;
  dibuka_oleh: string;
  dibuka_pada: string;
  ditutup_oleh: string | null;
  ditutup_pada: string | null;
  modal_awal: number;
  /** uang tunai fisik saat tutup (null selagi terbuka) */
  uang_fisik: number | null;
  catatan: string | null;
  penjualan_tunai: number;
  penjualan_nontunai: number;
  jumlah_transaksi: number;
  /** kas seharusnya di laci = modal_awal + penjualan_tunai */
  kas_sistem: number;
  /** uang_fisik − kas_sistem (null selagi terbuka) */
  selisih: number | null;
}

/** Baris ringan hasil pencarian member (autocomplete keranjang kasir). */
export interface MemberCariRow {
  id: string;
  nama: string;
  wa: string;
}

/** Jenis cap absensi karyawan: masuk (datang) vs keluar (pulang). */
export type AbsensiTipe = "masuk" | "keluar";

/** Hasil satu cap absensi (dikembalikan POST /absensi). */
export interface AbsenResult {
  user_id: string;
  nama: string;
  employee_code: string;
  tipe: AbsensiTipe;
  /** waktu cap (ISO) */
  waktu: string;
  branch_nama: string;
  /** jarak perangkat ke titik cabang (m) — null bila lokasi cabang belum diatur */
  jarak_m?: number | null;
  /** foto swafoto bukti absen (URL) */
  foto_url: string | null;
}

/** Ringkasan absensi seorang karyawan pada satu hari (daftar di halaman Absen). */
export interface AbsensiRow {
  user_id: string;
  nama: string;
  employee_code: string | null;
  /** jam masuk pertama hari itu (ISO); null bila belum absen masuk */
  masuk: string | null;
  /** jam keluar terakhir hari itu (ISO); null bila belum absen keluar */
  keluar: string | null;
  /** foto bukti saat cap masuk pertama (URL) */
  foto_masuk: string | null;
  /** foto bukti saat cap keluar terakhir (URL) */
  foto_keluar: string | null;
}

/** Laporan pengeluaran pembelian bahan baku (faktur beli terkonfirmasi) per rentang tanggal. */
export interface LaporanPembelian {
  dari: string;
  sampai: string;
  total_pengeluaran: number;
  jumlah_faktur: number;
  jumlah_item: number;
  /** supplier = null → "Tanpa supplier" */
  per_supplier: { supplier: string | null; jumlah_faktur: number; total: number }[];
  per_bahan: { nama: string; slug: string; qty: number; satuan: string; total: number }[];
}

/* ===== Perlengkapan (non bahan baku): sendok, spons, sabun, dll. ===== */

/**
 * Jenis mutasi ledger perlengkapan: masuk (+), pakai/auto (−), koreksi (±),
 * kirim (− transfer keluar) / terima (+ transfer masuk) antar cabang.
 */
export type PerlengkapanMutasiTipe =
  | "masuk"
  | "pakai"
  | "auto"
  | "koreksi"
  | "kirim"
  | "terima";

/** Metode konsumsi perlengkapan: otomatis (jadwal harian) vs manual (stock opname). */
export type PerlengkapanAturanMetode = "otomatis" | "manual";

/**
 * Aturan konsumsi per cabang. metode "otomatis": terpakai `qty` setiap
 * `per_hari` hari; metode "manual": pemakaian dicatat lewat STOCK OPNAME
 * saja (qty/per_hari/mulai diabaikan).
 */
export interface PerlengkapanAturanDto {
  metode: PerlengkapanAturanMetode;
  qty: number;
  per_hari: number;
  aktif: boolean;
  /** tanggal mulai berlaku (YYYY-MM-DD) */
  mulai: string;
}

/** Satu item perlengkapan + saldo cabang aktif + aturan konsumsinya (bila ada). */
export interface PerlengkapanRowDto {
  id: string;
  nama: string;
  satuan: string;
  harga_beli: number;
  stok_minimum: number;
  catatan: string | null;
  saldo: number;
  status: StokStatus;
  aturan: PerlengkapanAturanDto | null;
  /** rak simpan default (tempat penyimpanan) — utk memilih lokasi saat opname */
  rak: { id: string; nama: string } | null;
  /**
   * saldo item ini di Central Kitchen pemasok cabang (utk tombol "Minta ke
   * CK" saat stok ≤ minimum); null bila cabang tak terhubung CK / cabang
   * INI Central Kitchen-nya
   */
  saldo_ck: number | null;
}

/** Satu lokasi (cabang) tempat perlengkapan berada + aturan konsumsinya. */
export interface PerlengkapanLokasiDto {
  branch_id: string;
  branch_nama: string;
  saldo: number;
  status: StokStatus;
  aturan: PerlengkapanAturanDto | null;
}

/**
 * Baris MASTER perlengkapan (halaman Manajemen, tanpa pilih cabang):
 * data item se-perusahaan + sebaran "ada di cabang mana saja".
 */
export interface PerlengkapanMasterRow {
  id: string;
  nama: string;
  satuan: string;
  harga_beli: number;
  stok_minimum: number;
  catatan: string | null;
  /** kategori — memakai master kategori yang sama dengan bahan baku */
  kategori: string | null;
  /** boleh dibeli eceran (per pcs) vs harus utuh per kemasan */
  boleh_eceran: boolean;
  /** dilacak: konsumsinya dipantau — WAJIB punya aturan konsumsi */
  dilacak: boolean;
  /** rak simpan default (tempat penyimpanan) */
  rak: { id: string; nama: string } | null;
  /** nama supplier utama/langganan (null = belum diatur) */
  supplier_utama: string | null;
  jumlah_supplier: number;
  /** cabang dengan saldo ≠ 0 ATAU aturan konsumsi terpasang */
  lokasi: PerlengkapanLokasiDto[];
}

/**
 * Hasil "permintaan perlengkapan otomatis" untuk satu cabang: untuk item yang
 * saldo ≤ stok minimum, kiriman KP- dibuat sebanyak stok yang ADA di CK;
 * kekurangan yang belum tertutup CK dilaporkan sebagai "perlu beli di CK".
 */
export interface PermintaanPerlengkapanOtomatisHasil {
  /** kiriman KP- yang berhasil diterbitkan (dari stok CK) */
  dibuat: {
    supply_id: string;
    nama: string;
    satuan: string;
    qty: number;
    nomor: string | null;
  }[];
  /**
   * kekurangan yang stok CK tak cukup → faktur BELI (BP-) ke CK diterbitkan;
   * dibeli → tiba di CK → otomatis dikirim ke cabang tujuan (seperti bahan baku)
   */
  beli_dibuat: {
    supply_id: string;
    nama: string;
    satuan: string;
    qty: number;
    nomor: string | null;
    tujuan_nama: string | null;
  }[];
  /** item ≤ minimum tapi cabang ini bukan store / tak terhubung CK */
  tak_bisa_kirim: { supply_id: string; nama: string; satuan: string; qty: number }[];
}

/** Status faktur beli perlengkapan ke CK. */
export type BeliPerlengkapanStatus = "menunggu" | "tiba" | "batal";

/** Satu faktur beli perlengkapan ke Central Kitchen (BP-). */
export interface BeliPerlengkapanRow {
  id: string;
  supply_id: string;
  nama: string;
  satuan: string;
  qty: number;
  total_harga: number | null;
  status: BeliPerlengkapanStatus;
  /** CK tujuan beli (tempat barang masuk stok) */
  ck_nama: string;
  /** cabang store yang butuh — dikirim otomatis setelah tiba (null = stok CK saja) */
  tujuan_nama: string | null;
  catatan: string | null;
  waktu: string;
  oleh: string | null;
  nomor: string | null;
}

/** Kiriman perlengkapan CK → cabang (stok pindah saat cabang menerima). */
export interface KirimanPerlengkapanDto {
  id: string;
  nomor: string | null;
  dari_cabang: string;
  ke_cabang: string;
  /** cabang tujuan — tombol Terima hanya tampil saat melihat cabang ini */
  ke_branch_id: string;
  item: { id: string; nama: string; satuan: string };
  qty: number;
  status: "dikirim" | "diterima";
  waktu: string;
  oleh: string | null;
  catatan: string | null;
}

/** Ringkasan satu sesi opname perlengkapan (riwayat). */
export interface OpnamePerlengkapanSesiRow {
  session_id: string;
  nomor: string | null;
  waktu: string;
  oleh: string | null;
  jumlah_item: number;
  status: PenyesuaianStatus;
}

/** Detail sesi opname perlengkapan: baris selisih per item. */
export interface OpnamePerlengkapanDetail {
  session_id: string;
  nomor: string | null;
  status: PenyesuaianStatus;
  rows: {
    supply_id: string;
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number | null;
    selisih: number;
  }[];
}

/** Satu baris kartu (ledger) perlengkapan dengan saldo berjalan. */
export interface PerlengkapanMutasiDto {
  id: string;
  waktu: string;
  tanggal: string;
  tipe: PerlengkapanMutasiTipe;
  masuk: number | null;
  keluar: number | null;
  saldo: number;
  total_harga: number | null;
  catatan: string | null;
  user_nama: string | null;
  /** nomor dokumen PL- (hanya mutasi 'masuk' yang bernomor) */
  nomor: string | null;
}

/** Kartu perlengkapan per item per cabang per rentang tanggal. */
export interface KartuPerlengkapanDto {
  item: { id: string; nama: string; satuan: string };
  periode: { dari: string; sampai: string };
  saldo_awal: number;
  saldo_akhir: number;
  total_masuk: number;
  total_keluar: number;
  /** nilai belanja (SUM total_harga mutasi masuk) dalam rentang */
  total_belanja: number;
  /** true bila mutasi melebihi batas tampilan dan dipotong */
  terpotong: boolean;
  mutasi: PerlengkapanMutasiDto[];
}

/** Ringkasan belanja perlengkapan per rentang tanggal. */
export interface BelanjaPerlengkapanDto {
  dari: string;
  sampai: string;
  total: number;
  per_item: { supply_id: string; nama: string; total: number }[];
}

/** Metode perhitungan HPP (laba-rugi) yang dipilih perusahaan. */
export type MetodeHpp = "average" | "fifo";

/**
 * Satu "lot" pembelian barang (bahan baku / perlengkapan): satu baris beli
 * dengan qty + total harga → dasar perhitungan HPP FIFO/rata-rata. `harga_satuan`
 * = total_harga / qty (null bila harga belum dilaporkan).
 */
export interface RiwayatHargaLot {
  id: string;
  tanggal: string;
  qty: number;
  total_harga: number | null;
  harga_satuan: number | null;
  supplier: string | null;
  /** nomor nota supplier (bila diisi manual) */
  no_faktur: string | null;
  /** nomor dokumen otomatis (PB-/PL-) */
  nomor: string | null;
}

/**
 * Riwayat harga beli satu barang: daftar lot pembelian + harga terkini &
 * rata-rata tertimbang. Dipakai kartu "Riwayat Harga" (bahan baku & perlengkapan)
 * sebagai fondasi hitung laba-rugi (FIFO/average).
 */
export interface RiwayatHargaDto {
  item: { id: string; nama: string; satuan: string };
  /** harga per satuan terkini (harga_beli / isi utk bahan; harga_beli utk perlengkapan) */
  harga_terkini: number;
  /** rata-rata tertimbang per satuan dari lot berharga (null bila belum ada) */
  harga_rata: number | null;
  /** jumlah lot pembelian tercatat */
  jumlah_pembelian: number;
  lots: RiwayatHargaLot[];
}
```
