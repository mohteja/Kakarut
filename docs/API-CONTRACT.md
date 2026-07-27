# 📱 Terakasir — Kontrak API (untuk Tim Mobile Flutter)

Halo tim mobile. Dokumen ini adalah **acuan lengkap API server Terakasir** untuk
membangun aplikasi Flutter (native) yang bicara **langsung ke API**, bukan
membungkus web di WebView.

> **Sumber kebenaran:** semua endpoint di bawah dibaca langsung dari kode
> `apps/server/src` (Hono + TypeScript + Drizzle). Entry server:
> `apps/server/src/index.ts`; perakitan router: `apps/server/src/app.ts`; auth:
> `apps/server/src/middleware/auth.ts`. Definisi tipe DTO ada di
> `packages/shared/src/types.ts` (disalin utuh di **Lampiran** dokumen ini).

Aplikasi Flutter dikembangkan di repo terpisah **`kakarut-mobile`**. Dokumen ini
tidak menuntut akses ke repo server — cukup jadikan rujukan kontrak.

> **Sudah pernah menerima dokumen ini sebelumnya?** Jangan bandingkan ulang
> seluruh isinya. Baca **[`docs/mobile/CHANGELOG-API.md`](mobile/CHANGELOG-API.md)**
> — di sana perubahan per rilis diringkas dan ditandai mana yang **wajib**
> disesuaikan di aplikasi mobile, mana yang sekadar informasi.

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
  `is_super_admin`, `company_id`, `role`, `branch_id`. Selain itu ada klaim
  internal **`tv`** (token_version) yang **tidak** perlu dibaca klien.
- **Invalidasi token saat password berubah (`tv` / token_version):** setiap
  ganti/reset password (via profil sendiri, reset oleh admin, atau alur
  `POST /api/auth/reset-password`) menaikkan versi token user, sehingga **SEMUA
  token yang diterbitkan sebelumnya langsung menjadi `401`** di endpoint mana
  pun. Klien mobile WAJIB menangani `401` di request apa pun sebagai "sesi tak
  berlaku" → hapus token tersimpan → arahkan ke login. Endpoint yang mengganti
  password sendiri **menerbitkan token baru** di responsnya — simpan token baru
  itu menggantikan yang lama agar sesi tetap hidup tanpa login ulang.
- **Tidak ada cookie / CSRF** — auth murni via Bearer token. Simpan token di
  secure storage aplikasi.

### Peran (`UserRole`)
Enam peran: **`owner`**, **`admin`**, **`cashier`**, **`tim`**, **`kitchen`**,
**`bar`**. Plus flag platform **`is_super_admin`** (terpisah dari peran).
Semantik dari middleware:
- `requireRole(...peran)` → **403** jika `auth.role` di luar himpunan yang
  diizinkan.
- `requireCompany` → **403** jika akun tak punya `company_id` (tak terhubung ke
  perusahaan).
- `requireSuperAdmin` → **403** kecuali `is_super_admin`.
- `terikatCabang(role)` → true untuk **`cashier`**, **`tim`**, **`kitchen`**,
  dan **`bar`** (peran terkunci cabang). `owner`/`admin` bebas lintas cabang.
- **`kitchen`** (BARU) = dapur cabang: semua akses `tim` di cabang store
  **plus** modul `/produksi` untuk produksi LOKAL cabangnya — hanya bahan yang
  di Resep ditandai `produksi_di: "cabang"`; hasil selesai langsung masuk stok
  cabangnya (auto-konfirmasi lokal). Bila bahan punya daftar
  `produksi_branch_ids` (cabang produsen), kitchen di luar daftar juga ditolak
  400 — daftar kosong = semua cabang store. Kitchen TIDAK mendapat
  `/pembelian`, tidak bisa mengirim hasil ke cabang lain, dan penempatannya
  WAJIB cabang bertipe `store` (400 bila di CK/kantor).
- **`bar`** (BARU) = kembaran `kitchen` untuk divisi minuman: hak akses dan
  batasan PERSIS sama (produksi lokal cabang store, tanpa `/pembelian`,
  penempatan wajib store). Pembedanya **divisi resep**: bahan produksi
  ber-`produksi_di:"cabang"` kini punya `divisi_produksi: "kitchen"|"bar"`
  (default `"kitchen"`) — role `kitchen` hanya boleh memproduksi resep divisi
  kitchen dan role `bar` hanya divisi bar (**400** bila silang divisi;
  owner/admin bebas keduanya). Planner rencana-dari-menu menerbitkan faktur
  produksi cabang TERPISAH per divisi bila kebutuhan mencakup keduanya.

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

### Pembatasan laju (rate limiting) — **429**
Endpoint sensitif dibatasi per (IP + email/identitas) untuk mencegah brute-force /
abuse: **login, register, forgot/reset password, verifikasi email, kirim-ulang
verifikasi, masuk tamu, dan sinkron antrean (`/sync`)**. Saat kuota jendela habis
server membalas **`429`** `{ "error": "Terlalu banyak permintaan — coba lagi
nanti." }` disertai header **`Retry-After: <detik>`**. Klien mobile sebaiknya:
menampilkan pesan ramah ("coba lagi dalam N detik"), menonaktifkan tombol submit
selama `Retry-After`, dan **tidak** melakukan retry otomatis agresif. Batas
dihitung terpusat (di DB) sehingga konsisten di semua instance server dan
bertahan lintas restart — nilai `Retry-After` akurat & bisa dipercaya.

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
- `/produksi/*` → **owner/admin, `tim` ber-cabang CK, ATAU `kitchen`/`bar`**
  (kitchen/bar: produksi lokal di cabang store-nya, resep divisinya saja)
- `/pembelian/*` → **owner/admin, ATAU `tim` yang cabangnya
  `central_kitchen`** (`izinkanManajemenAtauKaryawanCk`; selain itu 403)
- `/laporan/*`, `/rekomendasi/*`, `/sampah/*`, `/karyawan/*`, `/customer/*` →
  `requireRole("owner","admin")`
- `/open-bill/*` → `requireRole("cashier")`
- `/shift/*` → `requireRole("owner","admin","cashier")` (BACA dibuka untuk
  owner/admin; **buka/tutup** digerbang `requireRole("cashier")` per-rute)
- `/absensi/*` → `requireRole("owner","admin","cashier","tim","kitchen","bar")`
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

> Bentuk sesi (dipakai login/verify-email/onboarding): `{ token, user: AuthUser, company: {…} | null, branch: {id,nama} | null }`. **`company` bisa `null`** untuk user yang belum punya perusahaan (dan super-admin) — klien harus menangani: `company == null && !is_super_admin` → arahkan ke **onboarding** (buat perusahaan / terima undangan).
>
> **PENTING — `register` TIDAK lagi mengembalikan sesi.** Alur daftar sekarang: `register` (email verifikasi dikirim) → user klik tautan di email → `verify-email` (baru di sini sesi diterbitkan). Lihat detail di bawah.
>
> **PRASYARAT PRODUKSI — SMTP wajib aktif.** `register`, `verify-email`, `resend-verification`, `forgot-password`, dan undangan karyawan semuanya bergantung pada email **benar-benar terkirim**. Field bantuan `dev_verify_url` / `dev_reset_url` **hanya** muncul saat email server BELUM dikonfigurasi **dan** `NODE_ENV !== "production"` — di produksi tidak pernah dibocorkan. Tanpa SMTP aktif di produksi, alur daftar/verifikasi/reset **mati total** (server tetap balas `200` netral demi anti-enumerasi, tapi tak ada email masuk). Super-admin WAJIB mengatur SMTP di panel sistem + memastikan tes kirim berhasil sebelum go-live.

- `POST /api/auth/login` — [public] — req: `{ email (trim, lowercase), password (min 1) }` — res: sesi (`company` bisa null bila user belum punya perusahaan) — error: **401** email/password salah **atau akun dihapus/nonaktif**; **403** `{ error: "Email belum diverifikasi. …" }` bila email **belum diverifikasi** (dicek SETELAH password benar; super-admin dikecualikan). Klien: tangani `403` → tampilkan layar "verifikasi email" dengan tombol **kirim ulang** (panggil `/resend-verification`). **(CATATAN: tak lagi 403 untuk user tanpa perusahaan — user tanpa perusahaan login sukses dgn `company: null`; 403 di login kini KHUSUS email belum terverifikasi.)**
- `POST /api/auth/register` — [public] — req: `{ nama, email (email valid, lowercase), password (min 8) }` — res: **200** `{ ok: true, message, dev_verify_url? }` — **TANPA sesi** (tidak auto-login). Respons **selalu netral** (anti-enumerasi akun): baik email baru maupun email yang sudah terdaftar mengembalikan `200` yang sama — **tak ada lagi `409`**. Untuk email baru, tautan verifikasi dikirim via email. `dev_verify_url` HANYA muncul saat email server belum dikonfigurasi & bukan produksi (bantuan setup) — abaikan di produksi. — error: **400** validasi. Setelah ini, arahkan user ke layar "cek email Anda".
- `POST /api/auth/verify-email` — [public] — req: `{ token }` — res: **sesi** `{ token, user, company, branch }` (auto-login begitu email terverifikasi) — error: **400** token tidak valid/kedaluwarsa/terpakai **atau** akun nonaktif. Token berasal dari tautan email `APP_BASE_URL/verifikasi-email?token=…`. **Untuk klien yang tempel-manual (mobile tanpa deep link):** email verifikasi juga menampilkan **kode yang mudah disalin** — nilainya **identik** dengan parameter `token` pada URL tautan itu. Jadi baik hasil deep-link maupun kode yang ditempel user dikirim sebagai `{ token }` yang sama. Simpan sesi yang dikembalikan seperti hasil login.
- `POST /api/auth/resend-verification` — [public] — req: `{ email }` — res: **200** `{ ok: true, dev_verify_url? }` — SELALU 200 (netral; tak bocorkan status email). Benar-benar mengirim tautan hanya bila akun ADA, aktif, & BELUM terverifikasi. Dibatasi rate limit (429 + `Retry-After`).
- `POST /api/auth/forgot-password` — [public] — req: `{ email }` — res: **200** `{ ok: true, dev_reset_url? }` — SELALU 200 (tak bocorkan apakah email ada). Bila akun aktif: token reset dibuat + tautan dikirim via email. `dev_reset_url` HANYA muncul saat email server belum dikonfigurasi & bukan produksi (bantuan setup) — abaikan di produksi.
- `POST /api/auth/reset-password` — [public] — req: `{ token, password (min 8) }` — res: **200** `{ ok }` (tanpa sesi — pengguna login ulang dengan password baru) — error: **400** token tidak valid/kedaluwarsa/terpakai. Token berasal dari tautan email `APP_BASE_URL/reset-password?token=…` (halaman WEB); email reset juga menampilkan **kode yang mudah disalin** (identik dengan parameter `token`) untuk klien tempel-manual. **Efek samping:** menaikkan token_version user → semua token lama user itu jadi **401** (lihat bagian Autentikasi).
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
- `GET /api/admin/sistem/backup` — res: `BackupStatusDto` (`{ aktif, selang_jam, simpan, storage_mode, terakhir_sukses|null, riwayat: BackupRunDto[] }` — pencadangan database platform: konfigurasi + 50 riwayat terakhir)
- `POST /api/admin/sistem/backup` — picu cadangan manual sekarang — res: **201** `BackupRunDto` — error: **409** (cadangan lain sedang berjalan), **500** gagal
- `GET /api/admin/sistem/backup/:id/unduh` — unduh berkas cadangan (di-stream server; `application/gzip`, `Content-Disposition: attachment`) — error: **404** (tak ada/berkas tak terambil), **400** (cadangan tanpa berkas)
- `DELETE /api/admin/sistem/backup/:id` — hapus cadangan (berkas + riwayat) — res: `{ ok: true }` — error: **404**
- `POST /api/admin/sistem/backup/retensi` — terapkan retensi sekarang (buang cadangan lama di luar `BACKUP_KEEP`) — res: `{ ok: true, dibuang }`
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

- `GET /api/cabang` — [any] — res: array `{ id, nama, alamat, telepon, tipe, central_kitchen_id, receipt_footer, receipt_show_alamat, latitude, longitude, radius_absen_m, jam_buka: string|null, jam_tutup: string|null, is_active }` — `jam_*` = jam operasional "HH:MM"
- `PUT /api/cabang/struk` — [owner/admin/cashier] — query: `branch_id` (owner/admin; cashier terkunci) — req: `{ receipt_footer?|null (max 200), receipt_show_alamat?: bool }` — res: `{ ok: true }` — error: **404**
- `POST /api/cabang` — [owner/admin] — req `CabangBody`: `{ nama: string, alamat?|null, telepon?|null, tipe?: "store"|"central_kitchen"|"kantor", central_kitchen_id?: uuid|null, receipt_footer?|null (max200), receipt_show_alamat?: bool, latitude?: number(-90..90)|null, longitude?: number(-180..180)|null, radius_absen_m?: int(10..10000), jam_buka?: string(HH:MM atau "")|null, jam_tutup?: string(HH:MM atau "")|null, is_active?: bool }` — res: **201** `{ id, nama }` — error: **400** (Lite maks 1 cabang / CK invalid / format jam bukan HH:MM), **409** nama ada
- `PATCH /api/cabang/:id` — [owner/admin] — req: `CabangBody` (semua field parsial; termasuk `jam_buka`/`jam_tutup` untuk mengatur jam operasional) — res: `{ ok: true }` — error: **400** CK invalid / format jam salah, **404**

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

- `GET /api/bahan` — [any] — query: `ringkas?=1` (varian ringan untuk halaman picker/editor: lewati agregasi supplier & rak — `supplier_utama` selalu `null`, `jumlah_supplier` selalu `0`, `rak_lokasi` selalu `[]`; kolom lain termasuk `produksi_branch_ids` tetap terisi) · `arsip?=1` ([owner/admin] daftar bahan TERARSIP/nonaktif — `is_active=false`; bentuk ringkas; dipakai tab 🗄 Arsip halaman Resep — **403** peran lain) — res: `BahanDto[]`
- `POST /api/bahan` — [owner/admin] — req `BahanBody`: `{ slug?, kode?|null (max20), nama: string, harga_beli: number(≥0), isi: number(>0), satuan: string="pcs" (max20), satuan_beli?|null, track_stok: bool=true, stok_minimum: number(≥0)=0, stok_minimum_toko: number(≥0)=0, overhead_x: number(>0,≤1000)=1, kategori: string="lain" (max30), pengadaan: "produksi"|"beli"="beli", produksi_di?: "ck"|"cabang"="ck" (lokasi produksi bahan jalur produksi: Central Kitchen atau cabang/kitchen toko), produksi_branch_ids?: uuid[]=[] (cabang PRODUSEN saat produksi_di="cabang"; kosong = semua cabang store; wajib cabang store aktif → **400** bila bukan; diabaikan/dikosongkan saat produksi_di="ck"), divisi_produksi?: "kitchen"|"bar"="kitchen" (divisi yang MEMPRODUKSI saat produksi_di="cabang": role kitchen hanya boleh memproduksi resep divisi kitchen, role bar hanya divisi bar — silang divisi ditolak **400**; tak bermakna utk produksi_di="ck"), foto_hasil_url?|null (max500, FOTO BAHAN JADI — URL hasil `POST /upload?tujuan=resep`), foto_packing_url?|null (max500, FOTO CARA PACKING), catatan?|null, is_packaging: bool=false, is_complement: bool=false, boleh_eceran: bool=false, min_beli: number(≥0)=0, masa_simpan_hari: int(0..3650)=0 (umur layak pakai setelah masuk stok — dasar `exp_date` otomatis lot; 0 = tak diatur), lead_time_hari: int(0..365)=0 (beli = lama pesanan datang; produksi = lama proses — dasar "pesan/buat jauh-jauh hari") }` — res: **201** `BahanDto` (atau **200** bila mereaktivasi slug yang di-soft-delete) — error: **409** bahan aktif sudah ada
- `POST /api/bahan/bulk` — [owner/admin] — req: `{ items: BahanBulkRow[] (1..200) }` (tiap row bahan jalur beli) — res: **201** `{ jumlah, bahan: BahanDto[] }`
- `POST /api/bahan/import` — [owner/admin] — req: `{ mode: "perbarui"|"tambah", items: BahanImportRow[] (1..1000) }` — res: `{ ditambah, diperbarui, dipulihkan, dilewati, gagal: [{nama,alasan}] }`
- `PUT /api/bahan/:id` — [owner/admin] — req `BahanPatchBody` (semua field opsional, tanpa default; termasuk `foto_hasil_url`/`foto_packing_url`) — res: `BahanDto` — error: **404**, **409** (ubah ke "produksi" saat dipakai resep aktif / ubah `isi` saat produksi berjalan)
- `GET /api/bahan/:id/supplier` — [any] — res: `BahanSupplierDto[]` — error: **404**
- `PUT /api/bahan/:id/supplier` — [owner/admin] — req: `{ items: [{supplier_id: uuid, is_utama: bool=false}] (max50) }` — res: `BahanSupplierDto[]` — error: **400** (>1 utama / supplier invalid / bahan tipe produksi), **404**
- `GET /api/bahan/:id/detail` — [any] — **DETAIL PRODUK** satu bahan: `BahanDetailDto` = `{ bahan: BahanDto, metode_hpp: "average"|"fifo" (pengaturan Perusahaan), total_saldo, saldo_cabang: BahanSaldoCabang[] }` — error: **404** (termasuk bahan nonaktif)
- `GET /api/bahan/:id/pembelian` — [any] — res: `RiwayatHargaDto` (riwayat/lot harga beli) — error: **404**
- `POST /api/bahan/:id/harga` — [owner/admin] — req: `{ harga_per_unit: number(≥0) }` — res: `RiwayatHargaDto` — error: **404**
- `GET /api/bahan/resep-ringkas` — [any] — res: `Record<ingredient_id, number>` (jumlah bahan mentah per bahan produksi ber-resep, satu query batch; bahan tanpa komponen tidak muncul — perlakukan absen = 0)
- `GET /api/bahan/:id/resep` — [any] — res: `BahanResepRow[]` (BOM) — error: **404**
- `PUT /api/bahan/:id/resep` — [owner/admin] — req: `{ komponen: [{ingredient_id: uuid, qty: number(>0)}] = [] }` — res: `{ ok, jumlah }` — error: **400** (bahan non-produksi / self-ref / input invalid / resep sirkular), **404**, **409** (tipe pengadaan berubah di tengah)
- `GET /api/bahan/:id/langkah` — [any] — res: `BahanLangkahRow[]` (LANGKAH CARA MASAK urut, tiap langkah `{id, teks, foto_url|null}`; `[]` bila belum diatur/bahan non-produksi) — error: **404** — semua pelaksana produksi (kitchen/bar/tim) boleh baca, lintas divisi
- `PUT /api/bahan/:id/langkah` — [owner/admin] — req: `{ langkah: [{teks: string(1..1000), foto_url?|null (max500)}] (max 30) = [] }` — **urutan array = urutan langkah** (replace-whole-list; kirim `[]` utk mengosongkan) — res: `BahanLangkahRow[]` terbaru — error: **400** bahan non-produksi/teks invalid, **404**, **409** (pengadaan berubah konkuren)
- `DELETE /api/bahan/:id` — [owner/admin] — soft delete (= **arsipkan**; hilang dari semua daftar aktif, muncul di `GET /bahan?arsip=1`) — res: `{ ok: true }` — error: **404**, **409** masih dipakai menu aktif atau resep aktif lain
- `POST /api/bahan/:id/pulihkan` — [owner/admin] — pulihkan bahan terarsip (aktif kembali; resep/BOM lama tetap utuh) — res: `{ ok: true }` — error: **404** bukan bahan terarsip

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
> guard keduanya: [owner/admin, ATAU `tim` di Central Kitchen]; khusus
> `/produksi/*` juga role `kitchen`/`bar` (produksi lokal cabangnya).** Beda:
> `/kirim-hasil` khusus produksi, `/laporan-harga` khusus beli. Ganti `{mod}`
> dengan `produksi` atau `pembelian`.

- `POST /api/{mod}/faktur` — req `FakturBody`: `{ branch_id?: uuid, tujuan_branch_id?: uuid|null (KHUSUS BELI, manajemen: cabang STORE tujuan kirim — barang tiba di cabang faktur lalu dikirim & diterima di Penerimaan cabang; baris bertujuan TIDAK auto-confirm), supplier_id?: uuid|null, no_faktur?|null (max60), catatan?|null, worker_id?: uuid|null (produksi: OPSIONAL — bila kosong pelaksana terisi otomatis dari aktor yang memajukan tahap ke "dikerjakan"), items: [{ingredient_id:uuid, mode:"pcs"|"batch", jumlah:number(>0), storage_location_id?:uuid|null, total_harga?:number(≥0)|null}] (min 1) }`. `branch_id` boleh cabang STORE (beli langsung di cabang — barang Tiba langsung masuk stok cabang itu; produksi di cabang store = produksi lokal, hasil masuk stok cabang itu). — res: **201** `{ faktur_id, nomor, status:"rencana", jumlah_baris, beli_otomatis: { faktur_id, nomor, jumlah_baris } | null }` — `beli_otomatis` (jalur PRODUKSI): faktur BELI yang lahir otomatis di cabang sama untuk bahan mentah resep yang KURANG atau yang sisa stoknya bakal jatuh **di bawah stok minimum** setelah produksi (`kurang = kebutuhan resep + stok_minimum − saldo`, dibulatkan per kemasan + MOQ `min_beli`; hanya bahan jalur beli ber-lacak-stok; null bila tak ada). — error: **400** (supplier/ingredient/storage/tujuan invalid, jalur pengadaan salah, tujuan pada produksi), **403** kasir luar cabang / non-manajemen pakai tujuan, **404** ingredient tak ada
- `POST /api/{mod}/tahap/:fakturId` — req `TahapBody`: `{ ke: "dikerjakan"|"menunggu"|"dikonfirmasi", items?: [{id:uuid, qty:number(>0), harga?:number(≥0)|null, exp?: "YYYY-MM-DD"|null (override tanggal kedaluwarsa lot saat baris MASUK STOK, target ≥ "menunggu"; kosong = otomatis `tanggal masuk + masa_simpan_hari` bahan; diabaikan utk target lain)}], dana_cair?:number|null, realisasi?:number|null, selisih_catatan?|null (max300), tujuan_branch_id?:uuid|null, tujuan_storage_id?:uuid|null, paksa?:bool }` — res: `{ ok, status, jumlah_baris }` — error: **400** (tahap tak urut, tujuan lintas cabang, qty>baris, dll), **403**, **404**, **409** (bahan mentah kurang → pesan kekurangan kecuali `paksa`; atau status berubah konkuren). Saat baris MASUK STOK (`menunggu`), rak simpan yang kosong otomatis diisi **rak default bahan** di cabang baris (Tempat Penyimpanan) — berlaku jalur items maupun non-items; baris bertujuan cabang lain tetap tanpa rak (transit) sampai diterima di cabang.
- `POST /api/{mod}/kirim/:fakturId` — req: `{ tujuan_storage_id?: uuid|null }` — res: `{ ok, tujuan, jumlah_baris }` — error: **400** (belum ada yang siap / cabang/storage tujuan invalid), **403** bukan staf CK
- `POST /api/produksi/kirim-hasil/:fakturId` — **produksi saja** (pembelian → **404**) — req: `{ tujuan_storage_id?: uuid|null, items?: [{ingredient_id:uuid, qty:number(>0)}] }` — res: `{ ok, faktur_id, nomor, tujuan, jumlah_baris }` — error: **400** (tak ada yang dikirim / stok CK kurang / tujuan invalid), **403**
- `GET /api/{mod}/dana/:fakturId` — res: `{ rows: [{id,tipe,nominal,catatan,oleh,waktu}], total }` — error: **404**
- `POST /api/{mod}/konfirmasi/:fakturId` — res: `{ ok, jumlah_baris }` — error: **404** tak ada / sudah dikonfirmasi
- `GET /api/{mod}/log/:fakturId` — res: `{ rows: [{id,aksi,detail,oleh,waktu}] }` — error: **404**
- `POST /api/pembelian/laporan-harga/:fakturId` — **[owner/admin]**, **beli saja** (produksi → **400**) — req: `{ items: [{id:uuid, total_harga:number(≥0)}] (min1) }` — res: `{ ok, jumlah }` — error: **400**, **404**. Selain memperbarui `total_harga` baris (harga riil utk HPP FIFO/resep), harga acuan tiap bahan yang dilaporkan (`harga_beli`) disegarkan ke **median** harga/satuan seluruh lot beli dikonfirmasi yang berharga (acuan RAB; fallback harga baris dilaporkan bila belum ada lot berharga).
- `POST /api/{mod}` — req `TambahStokBody`: `{ branch_id?:uuid, ingredient_id:uuid, qty?:number(>0), batch:bool=false, total_harga?:number(≥0)|null, catatan? }` (refine: `batch` ATAU `qty` wajib) — res: **201** row production + `{ bahan }` — error: **400**, **404**
- `GET /api/{mod}` — query: `branch_id?` (atau `all`), `dari?`, `sampai?`, `tanggal?`, `page?` (default 1), `per_page?` (default 20, maks 200) — res: `{ rows, total, page, per_page, total_pengeluaran }` (tiap row memuat `rencana_id` + `permintaan_nomor` (PM-xxxx) bila faktur lahir dari permintaan Tambah Stok dari Menu; juga `exp_date` (tanggal kedaluwarsa lot — terisi saat baris masuk stok; NULL utk transfer stok/kirim-hasil karena lot asal tak diketahui) dan `masa_simpan_hari` master bahan; juga `produksi_di` + `divisi_produksi` bahan — dasar badge divisi Kitchen/Bar pada faktur produksi cabang). **Role `kitchen`/`bar`: daftar otomatis DISARING per divisi** — baris resep produksi-cabang milik divisi lain tidak dikembalikan (bar tak melihat pekerjaan kitchen dan sebaliknya; baris lain seperti kiriman/bahan CK tetap tampil). Owner/admin melihat semuanya.
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

## `/api/transfer-stok` — Transfer stok antar lokasi (`modules/transfer/routes.ts`)

> **Group guard: [owner/admin, `tim`, `kitchen`, `bar`]** (kasir tidak membuat
> transfer — hanya menerima lewat `/penerimaan`). Memindahkan stok yang **sudah
> ada (ready)** antar lokasi: CK↔cabang atau cabang↔cabang, satu faktur (nomor
> **TF-**) berisi BANYAK bahan. Dipakai mis. saat barang kiriman rusak di jalan
> lalu dikirim ulang.
>
> **Representasi & saldo:** satu baris `productions` per bahan dengan pola
> KIRIMAN yang sudah ada — `branch_id` = TUJUAN (menambah saldo tujuan saat
> dikonfirmasi), `asal_branch_id` = ASAL (mengurangi saldo asal saat
> dikonfirmasi), `tujuan_branch_id` = TUJUAN, `dari_branch_id` = ASAL, `tipe` =
> "produksi", `status` = "menunggu", `total_harga` = 0. Konsekuensinya:
> kiriman **otomatis muncul di `GET /penerimaan`** cabang tujuan dan **stok asal
> baru berkurang saat kiriman DITERIMA** (selagi di jalan, stok masih tercatat
> di asal) — sama seperti jalur kiriman lain. Rak simpan diisi otomatis (rak
> default bahan) saat diterima.
>
> **Batas kirim = `saldo − dalam_jalan`.** Karena saldo asal baru berkurang saat
> tujuan mengonfirmasi, saldo mentah masih memuat barang yang fisiknya sudah
> lepas. Barang berstatus `menunggu` yang keluar dari cabang itu (transfer MAUPUN
> kiriman jalur lain) karena itu dipotong lebih dulu — tanpa ini stok yang sama
> bisa dijanjikan berkali-kali dan saldo asal jadi minus saat semua kiriman tiba.
> Transfer dari satu cabang asal juga diserialkan (advisory lock per cabang)
> sehingga dua permintaan bersamaan tidak bisa sama-sama lolos.
>
> **Bukan pekerjaan produksi:** meski menumpang tabel `productions`, faktur
> transfer TIDAK muncul di `GET /produksi` (daftar & badge) — jalurnya hanya
> `/transfer-stok` dan `/penerimaan`.
>
> **Aturan yang sama berlaku di jalur Permintaan Stok:** perencana rencana-menu
> memakai `saldo CK − barang di jalan` saat memutuskan "tinggal kirim dari CK",
> sehingga dua permintaan berturut-turut tidak bisa dijanjikan stok yang sama
> (permintaan kedua otomatis jadi work-order produksi).
>
> **Berdampingan** dengan "Kirim dari stok CK" pada Permintaan Stok: yang itu
> lahir dari rencana menu (`rencana_id` terisi, nomor PR-), yang ini manual/
> ad-hoc (`rencana_id` null, nomor TF-). Pembeda tegas di API: faktur transfer
> adalah faktur yang punya nomor dokumen berjenis `transfer`.

- `GET /api/transfer-stok/saldo` — query: `branch_id?` (peran terkunci cabang selalu dipaksa ke cabangnya) — res: `{ branch_id, rows: TransferStokSaldoRow[] }` — stok READY di cabang itu: hanya bahan **aktif + berlacak-stok + masih tersisa (`saldo − dalam_jalan > 0`)**. Tiap baris membawa `pengadaan` ("beli"/"produksi") agar UI bisa menandai jenis bahan, `saldo` (fisik) dan `dalam_jalan` (sudah dikirim, belum diterima tujuan) — **yang boleh ditransfer adalah `saldo − dalam_jalan`**
- `GET /api/transfer-stok` — query: `per_page?` (default 50, maks 200) — res: `{ rows: TransferStokFaktur[] }` (terbaru dulu; tiap faktur memuat `items[]` dengan `pengadaan` & `status` per bahan, plus `status` agregat: `menunggu`/`dikonfirmasi`/`ditolak`/`sebagian`). Peran terkunci cabang hanya melihat transfer yang menyangkut cabangnya (pengirim atau penerima)
- `POST /api/transfer-stok` — req: `{ asal_branch_id: uuid, tujuan_branch_id: uuid, catatan?|null (max300), items: [{ingredient_id: uuid, qty: number(>0)}] (1..100; bahan sama digabung qty-nya) }` — res: **201** `{ ok, faktur_id, nomor (TF-xxxx), asal, tujuan, jumlah_baris }` — error: **400** (asal = tujuan; asal/tujuan Kantor; bahan invalid/nonaktif/tak lacak stok; **qty melebihi `saldo − dalam_jalan` di asal** — dicek di dalam transaksi setelah advisory lock per cabang asal, pesannya menyebut berapa yang masih dalam perjalanan), **403** peran terkunci mengirim dari cabang lain, **404** cabang tidak ditemukan
- `POST /api/transfer-stok/:fakturId/batal` — batalkan transfer yang belum diproses tujuan (baris masuk Tempat Sampah) — res: `{ ok, jumlah_baris }` — error: **403** bukan pengirim, **404** bukan faktur transfer, **409** sudah diterima/ditolak di tujuan

## `/api/supplier` — Supplier (`modules/supplier/routes.ts`)

- `GET /api/supplier` — [any] — res: `SupplierDto[]`
- `POST /api/supplier` — [any] (quick-add saat input faktur) — req: `{ nama: string, telepon?|null, alamat?|null, catatan?|null, kategori?|null (max30 — kategori bebas utk pengelompokan/filter, mis. "sayur"/"kemasan"), is_active?: bool }` — res: **201** `SupplierDto` (ber-`kategori`) — error: **409** ada
- `GET /api/supplier/:id/kartu` — [any] — res: `SupplierKartu` (riwayat beli + ringkasan + bahan terkait) — error: **404**
- `PATCH /api/supplier/:id` — [owner/admin] — req: body supplier parsial — res: `SupplierDto` — error: **404**

## `/api/penyimpanan` — Tempat penyimpanan / rak (`modules/penyimpanan/routes.ts`)

- `GET /api/penyimpanan` — [any] — query: `branch_id?` — res: `PenyimpananDto[]` (dengan `petugas` — tiap petugas ber-`aktif`: false = bukan anggota aktif lagi (diarsip/dihapus/dibuat ulang) sehingga DIABAIKAN dalam pembatasan opname — dan `jumlah_bahan`)
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

## `/api/shift` — Shift kasir (`modules/shift/routes.ts`) — group guard **[owner/admin/cashier]** (buka/tutup **cashier only**)

- `GET /api/shift/aktif` — [owner/admin/cashier] — query: `branch_id?` — res: `Shift | null` (shift terbuka + rekap live)
- `GET /api/shift/pantau` — **[owner/admin]** — res: `ShiftPantauRow[]` — pantau operasional SEMUA cabang store: status kasir + rekap **hari ini** (zona waktu perusahaan) + jam operasional + tanda telat buka/lupa tutup
- `GET /api/shift` — [owner/admin/cashier] — query: `branch_id?` — res: `Shift[]` (shift tertutup, maks 50)
- `GET /api/shift/:id` — [owner/admin/cashier; cashier terkunci cabangnya] — res: `ShiftDetail` (= `Shift` + `transaksi: ShiftTransaksiRow[]`, maks 300, urut waktu desc) — error: **403** shift bukan cabang kasir, **404**
- `POST /api/shift/buka` — **[cashier]** — req: `{ modal_awal: number(≥0)=0 }` — res: **201** `Shift` — error: **400** shift sudah terbuka **atau kasir belum absen masuk hari ini** (pesan: "Absen masuk dulu sebelum buka kasir"), **403** luar cabang
- `POST /api/shift/tutup` — **[cashier]** — req: `{ uang_fisik: number(≥0), catatan?|null }` — res: `Shift` — error: **400** tak ada shift terbuka

> **Tipe baru (shared):**
> - `ShiftTransaksiRow`: `{ id, nomor, waktu (ISO), total, metode: "tunai"|"qris"|"transfer", kasir: string|null }`
> - `ShiftDetail extends Shift`: `{ ...Shift, transaksi: ShiftTransaksiRow[] }`
> - `ShiftPantauRow`: `{ branch_id, branch_nama, jam_buka: string|null, jam_tutup: string|null, shift_id: string|null, dibuka_oleh: string|null, dibuka_pada: string|null (ISO), modal_awal: number|null, penjualan_tunai, penjualan_nontunai, jumlah_transaksi, kas_sistem, buka_hari_ini: bool, telat_buka: bool, lupa_tutup: bool }` — `penjualan_*` = total HARI INI; meta `dibuka_*`/`modal_awal` hanya terisi bila kasir sedang terbuka.

> **Gerbang Buka Kasir (penting untuk mobile):** transaksi POS (`POST /api/penjualan`)
> HANYA jalan bila ada shift **terbuka** di cabang. Sebelum layar kasir bisa
> dipakai, panggil `GET /api/shift/aktif`; bila `null`, tampilkan gerbang blokir
> "Buka Kasir" dan **jangan** biarkan transaksi. Syarat buka kasir: akun kasir
> **harus absen masuk dulu** hari ini — bila belum, `POST /api/shift/buka` balas
> **400**. Urutan wajib: **absen masuk → buka kasir → transaksi**. Lihat
> `docs/mobile/PROMPT-BUKA-KASIR.md` untuk spesifikasi UI lengkap.

## `/api/sync` — Sinkron antrean offline mobile (`modules/sync/routes.ts`) — group guard **[any]** (per-perintah divalidasi seperti endpoint aslinya)

Satu endpoint generik untuk mengirim BATCH perintah offline yang tersimpan di
perangkat. Server mengeksekusi tiap perintah lewat logika service yang SUDAH
ADA (validasi = aturan endpoint asli), idempoten per `client_ref`.

- `POST /api/sync` — [any] — req `SyncRequest`: `{ device_id?: string|null, commands: SyncCommand[] (1..100) }` di mana `SyncCommand = { client_ref: uuid (idempotency, unik per company), tipe: SyncTipe, waktu: ISO-8601 UTC, payload: <body endpoint asli> }`.
  - res: **selalu 200** `SyncResponse`: `{ hasil: SyncItemResult[] }` (urutan sama dgn `commands`). `SyncItemResult = { client_ref, status: "ok"|"sudah_ada"|"gagal", kode: <HTTP endpoint asli>, data?: <respons endpoint asli — atau data lanjutan saat gagal>, error?: <pesan>, sebab?: <kode penyebab, saat gagal> }`. `sebab` yang ada saat ini: `"shift_tidak_cocok"` (lihat penjualan di bawah). Penolakan yang tersimpan di ledger dibalas **utuh** saat retry — `sebab` & `data` ikut, jadi konteksnya tidak hilang..
  - **Fase 1 `tipe`** (dieksekusi langsung lewat service; `waktu` = timestamp kejadian yang dibukukan): `penjualan` (payload = body `POST /penjualan`), `absen_saya` (body `POST /absensi/saya`), `absen_stasiun` (body `POST /absensi`).
  - **Fase 2 `tipe`** (di-dispatch ke endpoint asli lewat sub-request internal → middleware + role guard + handler asli berjalan apa adanya; stok berubah **saat sinkron**, boleh minus, `waktu` cukup tercatat di ledger untuk audit): `stok_opname` (payload = body `POST /stok/opname`), `perlengkapan_opname` (body `POST /perlengkapan/opname`), `perlengkapan_pakai` (payload += `supply_id`, sisanya body `POST /perlengkapan/:id/pakai`), `faktur_tahap` (payload += `jalur` `"produksi"|"pembelian"` + `faktur_id`, sisanya body `POST /:jalur/tahap/:id`), `faktur_kirim` (payload += `jalur` + `faktur_id`, body `POST /:jalur/kirim/:id`), `produksi_kirim_hasil` (payload += `faktur_id`, body `POST /produksi/kirim-hasil/:id`), `penerimaan_terima` / `penerimaan_terima_sebagian` / `penerimaan_tolak` (payload += `faktur_id`, sisanya body `POST /penerimaan/:id/terima|terima-sebagian|tolak`).
    - **Path-param di payload**: perintah Fase 2 yang butuh id di URL mengambilnya dari field payload (`supply_id`/`faktur_id`/`jalur`); field wajib yang hilang → item **gagal 400**, `jalur` selain `produksi`/`pembelian` → item **gagal 400**. Sisa field payload jadi body request.
    - **Kode hasil**: `kode` = status HTTP endpoint asli; `kode ≥ 400` → item `status:"gagal"` (mis. role/guard salah → 403, faktur asing → 404) tanpa menghentikan item lain.
  - **Idempotency**: `client_ref` yang sudah tercatat → `sudah_ada` + hasil tersimpan (TIDAK dieksekusi ulang). Aman untuk retry (exactly-once) — berlaku untuk Fase 1 & Fase 2.
  - **Eksekusi berurutan**; item gagal TIDAK menghentikan item lain (kegagalan dilaporkan per item dgn `status:"gagal"` + `kode` + `error`).
  - **Validasi `waktu`**: tolak masa depan (skew +5 mnt) → item **gagal 400**. Batas usia **per tipe**: `penjualan` **30 hari**, tipe lain **7 hari** → lewat batas item **gagal 400**. (Penjualan dilonggarkan karena uangnya sudah diterima kasir — menolaknya berarti transaksi hilang permanen; tipe lain tetap ketat karena mengubah stok jauh ke belakang berbahaya.) `waktu` = timestamp kejadian (bukan jam sinkron).
  - **penjualan (semantik `waktu`)**: dipakai sebagai waktu struk + tanggal bisnis. Gerbang "Kasir belum dibuka" (409) TIDAK berlaku di sync. Sale dibukukan ke shift lewat kolom **`sales.shift_id`** (penautan eksplisit, bukan lagi sekadar disimpulkan dari waktu), dengan dua tahap pencarian:
    1. **Shift yang jendelanya memuat `waktu`** — batas **inklusif di kedua ujung** (`dibuka_pada ≤ waktu ≤ ditutup_pada`; shift terbuka = ujung kanan tak terbatas). Sisi buka diberi toleransi **5 menit** untuk jam perangkat yang mundur, jadi transaksi tepat sebelum shift dibuka tidak hilang.
    2. **Bila tidak ada** — shift terakhir cabang itu yang **ditutup paling dekat sebelum `waktu`**, selama `waktu ≤ ditutup_pada + 6 jam` **DAN** masih tanggal bisnis yang sama (zona waktu perusahaan). Ini kasus "shift ditutup dari web/perangkat lain sementara perangkat kasir offline masih melayani".
    Shift yang sudah tertutup (jalur 1 maupun 2) → sale tetap masuk, **ikut terhitung di rekap & selisih kas shift itu**, dan shift ditandai `ada_transaksi_susulan:true` (lihat DTO `Shift`). Baris transaksinya di `GET /api/shift/:id` bertanda `susulan:true`.
    - **`data` saat ok** memuat `shift: { id, dibuka_pada, ditutup_pada }`, `ada_transaksi_susulan: boolean`, dan `di_luar_jendela_shift: boolean` (true = dibukukan lewat toleransi jalur 2 → beri tahu kasir agar selisih kas shift itu diperiksa). Catatan: tabel `shifts` **tidak punya kolom nomor**, jadi shift dikenali lewat `id` + jam buka/tutup.
    - **Tetap gagal 409** hanya bila benar-benar tak ada shift yang memenuhi (mis. `waktu` di tanggal yang tak punya shift sama sekali, atau `waktu` sebelum shift pertama hari itu di luar toleransi 5 menit). Respons gagal membawa `sebab:"shift_tidak_cocok"` + `data.shift_terdekat` = `{ id, dibuka_pada, ditutup_pada }` shift tertutup terdekat sebelum `waktu`, atau `null` bila memang tak ada.
  - **absen (semantik `waktu`)**: cap masuk/keluar dicatat pada `waktu`; geofence tetap divalidasi dari `lat`/`lng` payload.
  - **Role guard**: sama dgn endpoint asli — mis. `penjualan` oleh non-kasir → item **gagal 403** (bukan gagal seluruh batch).
- **Online-only (tidak lewat sync)**: login/auth, CRUD master, ACC/persetujuan, laporan, upload foto (mobile unggah `POST /upload` DULU saat online, lalu kirim perintah dgn `foto_url` hasil unggah). Shift buka/tutup tetap online-only (Fase 1).

## `/api/absensi` — Absensi (`modules/absensi/routes.ts`) — group guard **[owner/admin/cashier/tim/kitchen/bar]**

- `POST /api/absensi` — **[owner/admin/cashier]** (inline, kecuali tim) — pindai stasiun — query: `branch_id?` — req: `{ kode: string, foto_url: string (wajib), lat?: number(-90..90)|null, lng?: number(-180..180)|null }` — res: **201** `AbsenResult` — error: **400** (di luar radius geofence / GPS wajib / karyawan nonaktif), **404** kode tak dikenal
- `POST /api/absensi/saya` — [owner/admin/cashier/tim/kitchen/bar] — absen sendiri — query: `branch_id?` — req: `{ foto_url: string (wajib), lat?|null, lng?|null }` — res: **201** `AbsenResult` — error: **400** (geofence / tak ada kode karyawan / nonaktif), **403** bukan karyawan aktif
- `GET /api/absensi` — [owner/admin/cashier/tim/kitchen/bar] — query: `branch_id?`, `tanggal?` (YYYY-MM-DD) — res: `AbsensiRow[]` (masuk-pertama / keluar-terakhir per karyawan) — error: **400** tanggal salah

> **Catatan absensi (penting untuk mobile):** payload QR absen = **string kode
> mentah** (8 digit angka, teks polos tanpa prefix/JSON). Absen **wajib foto**:
> ambil foto → upload ke `POST /api/upload?tujuan=bukti` → kirim `foto_url` hasil
> di body absensi. Pencocokan kode case-insensitive. Input kode manual: keypad
> numerik, maks 8 karakter.

## `/api/profil` — Akun sendiri (`modules/profil/routes.ts`) — [any]

- `GET /api/profil` — res: `ProfilDto` `{ nama, email, role, cabang, employee_code }`
- `GET /api/profil/aktivitas` — res: `{ rows: [...] }` (log aktivitas faktur sendiri, maks 50)
- `POST /api/profil/password` — req: `{ password_lama: string, password_baru: string (min 8) }` — res: **`{ ok: true, token, user, company, branch }`** (bentuk **sesi** yang sama seperti login) — error: **401** password lama salah. **PENTING:** ganti password menaikkan token_version → token LAMA (perangkat/tab lain) langsung jadi **401**. Endpoint ini **menerbitkan token baru** untuk tab/perangkat yang melakukan perubahan agar TIDAK ikut ter-logout — **klien WAJIB menyimpan `token` baru ini menggantikan yang lama**. Perusahaan aktif dipertahankan (penting untuk akun multi-perusahaan).

## `/api/stok` — Stok & opname (`modules/stok/routes.ts`)

- `GET /api/stok` — [any] — query: `branch_id?` — res: array saldo stok (saldo per ingredient)
- `GET /api/stok/kartu/:ingredientId` — [any] — query: `branch_id?`, `dari?`, `sampai?` — res: kartu ledger stok (`KartuStokDto`; mutasi kini juga memuat jenis `kirim` = kiriman keluar/transfer stok ke cabang lain yang sudah diterima) — error: **400** stok tak dilacak, **404**
- `GET /api/stok/fifo/:ingredientId` — [any] — query: `branch_id?` — **KARTU FIFO** satu bahan pada satu cabang: seluruh riwayat masuk/keluar di-walk kronologis, keluar mengonsumsi lot **paling awal masuk** (First-In First-Out). Res: `BahanFifoDto` = lot masuk (qty/harga/terpakai/sisa/exp) + `pemakaian` (terbaru dulu, maks 300; tiap baris membawa `rincian` diambil dari lot mana + `hpp` biaya FIFO) + `saldo` (== saldo ledger) + `defisit` (stok minus tak tertutup lot). Opname disetujui = reset: selisih turun dikonsumsi FIFO, selisih naik jadi lot penyesuaian berharga acuan. — error: **400** stok tak dilacak, **404**
- `GET /api/stok/exp` — [any] — query: `branch_id?`, `hari?=7` (clamp 0..60) — res: `ExpLotRow[]` (lot masuk stok ber-`exp_date` ≤ hari ini + `hari`, urut exp ASC, maks 300; lot sebelum baseline opname terakhir bahan itu dikecualikan). **APROKSIMASI**: ledger stok agregat tanpa FIFO — `qty_masuk` = qty saat lot masuk, BUKAN sisa lot; `saldo` live bahan disandingkan agar pemakai menilai sendiri. `sisa_hari` = exp − hari ini (negatif = lewat)
- `POST /api/stok/waste` — [owner/admin/cashier/tim/kitchen/bar] (peran terikat cabang hanya cabangnya) — req: `{ branch_id?: uuid, ingredient_id: uuid, qty: number(>0), foto_url: string (min 1, **bukti foto wajib**), catatan?|null (max300) }` — mencatat WASTE (mis. bahan kedaluwarsa) lewat mekanisme penyesuaian yang ada: menulis SATU sesi `stock_opnames` (fisik = saldo − qty, `penyesuaian_kategori:"waste_bahan"`, status `menunggu`) → tampil di Riwayat SO dan **baru memotong stok setelah di-ACC** owner/admin — res: **201** `{ ok, session_id, nomor }` (SO-xxxx) — error: **400** (bahan invalid/tak dilacak, qty > saldo), **403** luar cabang
- `POST /api/stok/opname` — [owner/admin/cashier/tim/kitchen/bar] (inline) — req `OpnameBody`: `{ branch_id?: uuid, catatan?|null, items: [{ingredient_id:uuid, qty:number(≥0), foto_url?|null, alasan?|null}] (min 1) }` — res: **201** `{ ok, jumlah, session_id, nomor, ringkasan }` — error: **400** bahan invalid/tak dilacak, **403** (luar cabang / bukan petugas opname rak itu — hanya petugas ANGGOTA AKTIF yang dihitung; penugasan basi diabaikan)
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
- `POST /api/perlengkapan/permintaan-otomatis` — [owner/admin] — query: `branch_id?`, `rencana_id?` (tautkan faktur BP ke permintaan Tambah Stok dari Menu → tampil di `PermintaanStokRow.beli_perlengkapan`) — res: `PermintaanPerlengkapanOtomatisHasil` (seluruh item kurang jadi **SATU faktur BP multi-item** — lihat `beli_faktur`) — error: **400/404**
- `GET /api/perlengkapan/kiriman` — [any] — query: `branch_id?` — res: daftar kiriman
- `POST /api/perlengkapan/kiriman/:id/terima` — [any] — query: `branch_id?` — res: hasil — error: **400/404**
- `GET /api/perlengkapan/beli` — [any] — query: `branch_id?` (owner/admin; cashier/tim terkunci CK-nya) — res: `BeliPerlengkapanRow[]` (baris; kelompokkan per `faktur_id` — baris warisan `faktur_id=null` = faktur satu-item; `nomor` BP- per FAKTUR; kini juga memuat `diproses_oleh` (pemroses), `supplier_utama` (tempat beli — supplier langganan item), dan `harga_beli` master utk estimasi RAB). **Status pipeline paritas beli bahan baku**: `menunggu` (RAB) → `diproses` (sedang dibelanjakan) → `tiba` / `batal`. **Faktur yang PERMINTAANNYA SUDAH DIHAPUS TIDAK ditampilkan** (baris non-`tiba` yang `rencana_id`-nya hanya punya produksi ter-soft-delete) — konsisten dgn productions yang lenyap; status `batal` hanya tampil bila permintaannya masih ada (pembatalan sah). Baris `tiba` (stok nyata) selalu tampil.
- `POST /api/perlengkapan/beli` — [owner/admin] — req **multi-item**: `{ items: [{supply_id:uuid, qty:number(>0), total_harga?:number(≥0)|null}] (1..100), ck_branch_id?:uuid|null, tujuan_branch_id?:uuid|null, catatan?|null }` (bentuk lama satu-item `{supply_id, qty, …}` tetap diterima) — res: **201** `{ faktur_id, nomor, ids[] }` — error: **400/404**
- `POST /api/perlengkapan/beli/faktur/:fakturId/proses` — [owner/admin] — tandai faktur **diproses** (sedang dibelanjakan; pemroses tercatat) — hanya dari 'menunggu' — res: `{ ok, jumlah }` — error: **404**
- `POST /api/perlengkapan/beli/faktur/:fakturId/tiba` — [owner/admin] — req: `{ items?: [{id:uuid, qty?:number(>0), total_harga?:number(≥0)|null}] }` — proses SEMUA baris 'menunggu'/'diproses' faktur (masuk stok CK PL- per baris + auto-kirim KP- per baris) — res: `{ faktur_id, jumlah_tiba, kiriman[] }` — error: **400/404**
- `POST /api/perlengkapan/beli/faktur/:fakturId/batal` — [owner/admin] — batalkan semua baris 'menunggu'/'diproses' faktur — res: `{ ok, jumlah }` — error: **404**
- `POST /api/perlengkapan/beli/batal-semua` — [owner/admin] — query: `branch_id?` (CK) — batalkan SEMUA faktur yang masih 'menunggu' (bersih-bersih massal; faktur ber-status 'diproses' TIDAK ikut tersapu) — res: `{ ok, jumlah }`. Catatan: `DELETE /api/rekomendasi/permintaan/:rencanaId` men-soft-delete productions permintaan itu & membatalkan baris BP tertaut yang masih 'menunggu' — baris BP tsb (permintaannya lenyap) OTOMATIS HILANG dari `GET /perlengkapan/beli` (tak lagi muncul "batal"); pulihkan permintaannya dari Tempat Sampah → baris BP tampil kembali.
- `POST /api/perlengkapan/beli/:id/tiba` — [owner/admin] — per BARIS (warisan) — req: `{ qty?:number(>0), total_harga?:number(≥0)|null }` — res: hasil — error: **400/404**
- `POST /api/perlengkapan/beli/:id/batal` — [owner/admin] — per BARIS (warisan) — res: hasil — error: **400/404**
- `DELETE /api/perlengkapan/beli/faktur/:fakturId` — [owner/admin] — **HAPUS PERMANEN** satu faktur (bersih-bersih data lama). Boleh HANYA bila `permintaan_aktif=false` (tak terkait permintaan hidup) DAN tak ada baris `tiba` (belum masuk stok). Berbeda dari `…/batal` (soft): ini menghapus baris `supply_purchases` permanen — tak muncul di manapun. — res: `{ ok, jumlah }` — error: **400** (faktur dari permintaan aktif → kelola dari Permintaan Stok / ada baris sudah tiba), **404** (tidak ditemukan)
- `DELETE /api/perlengkapan/beli/:id` — [owner/admin] — sama, per BARIS (warisan `faktur_id=null`) — res: `{ ok, jumlah }` — error: **400/404**
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

> **Lokasi produksi (BARU):** bahan produksi ber-`produksi_di: "cabang"` pada rencana-dari-menu TIDAK dikirim dari stok CK dan TIDAK di-work-order-kan ke CK — `POST /menu/faktur` menerbitkan faktur produksi TERPISAH yang lahir di CABANG tujuan (dikerjakan role `kitchen` — dan bila ada resep ber-`divisi_produksi:"bar"`, SATU faktur cabang LAGI khusus divisi bar, dikerjakan role `bar`; hasil selesai langsung masuk stok cabang), dan bahan mentah resepnya dihitung terhadap stok cabang lalu dibelanjakan CK dengan tujuan kirim ke cabang. Respons `RencanaFakturResult` dan `PermintaanStokRow` punya bagian baru `produksi_cabang`; baris preview `RencanaBahanRow` membawa `produksi_di`. `produksi_di` pada baris preview sudah RESOLUSI PER CABANG TUJUAN: bila bahan punya daftar `produksi_branch_ids` dan cabang tujuan TIDAK termasuk, baris tampil `"ck"` (kebutuhan cabang itu dipenuhi lewat jalur CK — kirim stok / work-order CK).

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

- `POST /api/upload` — query: `tujuan=logo|bukti|menu|resep` (default `menu`; `resep` = foto cara masak/bahan jadi/packing) — req: `multipart/form-data` field **`file`** (image/jpeg | image/png | image/webp, maks 5 MB) — res: **201** `{ url }` — error: **400** (file hilang / format salah / terlalu besar)

## `/api/karyawan` — Karyawan (`modules/users/routes.ts`) — group guard **[owner/admin]**

- `GET /api/karyawan` — query: `arsip=true` (daftar arsip) — res: row karyawan
- `POST /api/karyawan` — req `KaryawanBody`: `{ nama: string, email: string (lowercase), password: string (min 8), role: "owner"|"admin"|"cashier"|"tim"|"kitchen"|"bar", branch_id?: uuid|null }` — res: **201** `{ user_id, email, nama, role, employee_code }` — error: **400** (cashier/tim/kitchen/bar butuh cabang; mismatch peran/tipe cabang — kitchen/bar hanya cabang store), **403** hanya owner boleh buat owner, **409** email ada — *(buat akun langsung + password. Untuk alur "menunggu diundang", pakai `/undang` di bawah.)*
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
- **Alur daftar mobile disarankan:** `POST /api/auth/register` (balas `200`
  netral, **tanpa sesi**) → tampilkan layar "cek email Anda" → user buka tautan
  email (`APP_BASE_URL/verifikasi-email?token=…`, tangkap via **deep link**) →
  `POST /api/auth/verify-email` `{ token }` → **simpan sesi** yang dikembalikan
  (sama seperti hasil login). Sediakan tombol **Kirim ulang** →
  `POST /api/auth/resend-verification` `{ email }`.
- **Alur login mobile disarankan:** `POST /api/auth/login` → **`403`** = email
  belum diverifikasi (tampilkan layar verifikasi + tombol kirim ulang); sukses →
  simpan `token` di secure storage → set header `Authorization: Bearer <token>`
  di semua request → `GET /api/auth/me` saat buka app untuk validasi sesi.
- **Tangani `401` secara global:** `401` di endpoint mana pun berarti sesi tak
  berlaku (token kedaluwarsa **atau** password diubah/di-reset → token_version
  naik). Reaksi: hapus token tersimpan → arahkan ke login. Bila klien punya alur
  ganti/reset password yang mengembalikan token baru, **ganti** token tersimpan
  dengan yang baru itu.
- **Tangani `429` (rate limit):** pada endpoint auth/sync, `429` disertai header
  `Retry-After` (detik). Tampilkan "coba lagi dalam N detik" & jeda tombol
  submit; hindari retry otomatis beruntun.

---

## Lampiran A — Referensi DTO (`packages/shared/src/types.ts`)

Seluruh isi file tipe bersama disalin utuh di bawah sebagai acuan bentuk data
respons/DTO. Ini definisi TypeScript; terjemahkan ke model Dart sesuai kebutuhan.

```typescript
import type {
  BahanKategori,
  DivisiProduksi,
  JenisPengadaan,
  MenuTipe,
  ProduksiDi,
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

export type InvitationStatus = "pending" | "accepted" | "revoked";

/** Undangan yang DITUJUKAN ke saya (dilihat calon karyawan di onboarding). */
export interface UndanganDto {
  id: string;
  company_nama: string;
  role: UserRole;
  cabang_nama: string | null;
  diundang_pada: string;
}

/** Status onboarding user tanpa perusahaan: sudah punya perusahaan? + undangan. */
export interface OnboardingStatus {
  has_company: boolean;
  email: string;
  undangan: UndanganDto[];
}

/** Undangan yang DIBUAT perusahaan (dilihat owner/admin di Kelola Karyawan). */
export interface UndanganKaryawanRow {
  id: string;
  email: string;
  role: UserRole;
  cabang_nama: string | null;
  status: InvitationStatus;
  diundang_pada: string;
}

export type SmtpEncryption = "none" | "ssl" | "starttls";

/** Pengaturan email (SMTP) platform — GET tak pernah mengembalikan password mentah. */
export interface SmtpSettingsDto {
  host: string | null;
  port: number;
  username: string | null;
  /** true = password sudah tersimpan (nilai asli tak dikirim ke klien) */
  has_password: boolean;
  encryption: SmtpEncryption;
  sender_name: string | null;
  sender_email: string | null;
  /** true = email siap dikirim (SMTP lengkap ATAU fallback Resend aktif) */
  configured: boolean;
  /** penyedia efektif saat ini */
  provider: "smtp" | "resend" | "none";
}

/** Satu baris riwayat pencadangan database (panel super admin). */
export interface BackupRunDto {
  id: string;
  waktu: string;
  pemicu: "otomatis" | "manual";
  status: "berjalan" | "sukses" | "gagal";
  storage_mode: "r2" | "local";
  /** kunci objek / nama berkas cadangan; null bila gagal sebelum tersimpan */
  object_key: string | null;
  ukuran_bytes: number | null;
  jumlah_tabel: number | null;
  jumlah_baris: number | null;
  durasi_ms: number | null;
  error: string | null;
  /** true = berkas tersedia untuk diunduh */
  bisa_unduh: boolean;
}

/** Status + konfigurasi pencadangan (GET /admin/sistem/backup). */
export interface BackupStatusDto {
  /** pencadangan otomatis (penjadwal) aktif */
  aktif: boolean;
  /** selang cadangan otomatis (jam) */
  selang_jam: number;
  /** retensi: jumlah cadangan sukses terakhir yang disimpan */
  simpan: number;
  /** target penyimpanan cadangan */
  storage_mode: "r2" | "local";
  /** waktu cadangan sukses terakhir (ISO) atau null */
  terakhir_sukses: string | null;
  /** riwayat 50 cadangan terakhir (terbaru dulu) */
  riwayat: BackupRunDto[];
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
  /**
   * Lokasi produksi bahan jalur "produksi": "ck" (Central Kitchen, default) atau
   * "cabang" (diproduksi kitchen/bar di cabang store sesuai `divisi_produksi` —
   * hasil masuk stok cabang itu). Diabaikan untuk pengadaan "beli".
   */
  produksi_di: ProduksiDi;
  /**
   * PENUGASAN DIVISI resep saat produksi_di = "cabang": "kitchen" (default)
   * atau "bar". Role kitchen hanya boleh memproduksi resep divisi kitchen;
   * role bar hanya resep divisi bar. Diabaikan saat produksi_di = "ck".
   */
  divisi_produksi: DivisiProduksi;
  /**
   * Cabang PRODUSEN saat produksi_di = "cabang": id cabang store yang
   * kitchen/bar-nya (sesuai divisi_produksi) memproduksi bahan ini. KOSONG =
   * semua cabang store. Cabang di luar daftar dipenuhi lewat jalur CK. Selalu
   * [] untuk produksi_di = "ck".
   */
  produksi_branch_ids: string[];
  catatan: string | null;
  is_packaging: boolean;
  is_complement: boolean;
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: boolean;
  /** MINIMAL BELANJA (MOQ): jumlah beli minimum saat belanja otomatis (0 = tanpa minimum) */
  min_beli: number;
  /** MASA SIMPAN (hari) setelah masuk stok — dasar exp otomatis lot; 0 = tak diatur */
  masa_simpan_hari: number;
  /** LEAD TIME (hari): beli = lama pesanan datang; produksi = lama proses; 0 = tanpa info */
  lead_time_hari: number;
  /** FOTO BAHAN JADI hasil produksi (halaman Resep) — null = belum diunggah */
  foto_hasil_url: string | null;
  /** FOTO CARA PACKING hasil produksi (halaman Resep) — null = belum diunggah */
  foto_packing_url: string | null;
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
  /** masa simpan (hari); 0 = tak diatur */
  masa_simpan_hari: number;
  /** lead time (hari); 0 = tanpa info */
  lead_time_hari: number;
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
 * Satu LANGKAH CARA MASAK bahan produksi (urut sesuai sort_order). Dikelola
 * owner/admin di halaman Resep; dibaca semua pelaksana produksi (kitchen,
 * bar, tim CK). foto_url = foto proses langkah itu (opsional).
 */
export interface BahanLangkahRow {
  id: string;
  teks: string;
  foto_url: string | null;
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
  /** masa simpan (hari); 0 = tak diatur */
  masa_simpan_hari?: number;
  /** lead time (hari); 0 = tanpa info */
  lead_time_hari?: number;
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
  /**
   * stok jadi CK yang benar-benar BISA DIJANJIKAN ke cabang ini: saldo fisik CK
   * dikurangi barang yang sudah dikirim tapi belum diterima cabang mana pun.
   * 0 bila tak ada CK. Potongan itu penting: saldo CK sengaja masih memuat
   * barang yang di jalan, jadi tanpa dipotong dua permintaan berturut-turut
   * akan sama-sama dijanjikan "tinggal kirim" dan saldo CK jadi minus.
   */
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
  /** LEAD TIME bahan (hari): pesan/buat jauh-jauh hari (H-n); 0 = tanpa info */
  lead_time_hari: number;
  /**
   * DIVISI pelaksana saat produksi_di="cabang" ("kitchen"/"bar") — faktur
   * produksi cabang dipisah per divisi. null utk jalur lain.
   */
  divisi_produksi?: DivisiProduksi | null;
  /** khusus baris BAHAN PRODUKSI: nama bahan jadi yang membutuhkannya */
  untuk?: string | null;
  /**
   * Lokasi produksi (baris pengadaan "produksi"): "cabang" = diproduksi kitchen
   * di cabang tujuan (faktur lahir di cabang, tanpa kirim CK). Pada baris
   * BAHAN PRODUKSI: lokasi produksi bahan jadi yang dilayaninya — "cabang"
   * berarti belanjanya dikirim ke cabang. Null/absen = CK (perilaku lama).
   */
  produksi_di?: ProduksiDi | null;
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
  /** id rencana — pengelompok semua faktur satu submit (Data Permintaan Stok) */
  rencana_id: string;
  /** nomor dokumen permintaan (PM-xxxx); null bila tak ada faktur yang lahir */
  nomor_permintaan: string | null;
  produksi: { faktur_id: string; jumlah_baris: number } | null;
  /**
   * Faktur produksi DI CABANG tujuan (bahan ber-produksi_di "cabang"): lahir di
   * cabang store, dikerjakan kitchen cabang, hasil langsung masuk stok cabang.
   */
  produksi_cabang: { faktur_id: string; jumlah_baris: number } | null;
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
 * Bagian FAKTUR BELI PERLENGKAPAN (BP-) sebuah permintaan — status memakai
 * pipeline perlengkapan (menunggu dibeli → tiba di CK / batal); "sebagian" =
 * campuran tiba & batal.
 */
export interface PermintaanStokBagianPerlengkapan {
  faktur_id: string;
  jumlah_baris: number;
  status: BeliPerlengkapanStatus | "sebagian";
  total: number;
}

/**
 * Satu permintaan "Tambah Stok dari Menu": gabungan faktur Produksi + Beli
 * yang lahir dari satu submit (dikelompokkan lewat productions.rencana_id).
 */
export interface PermintaanStokRow {
  rencana_id: string;
  /** nomor dokumen permintaan (PM-xxxx) — identitas tampil */
  nomor: string | null;
  /** ISO timestamp pembuatan permintaan */
  waktu: string;
  /** ringkasan menu/porsi ("50× BASOAC, 30× PYO") dari catatan faktur */
  catatan: string | null;
  /** cabang tujuan (store yang butuh stok); null bila hanya beli */
  tujuan_cabang: string | null;
  /** nama pembuat permintaan */
  pembuat: string | null;
  produksi: PermintaanStokBagian | null;
  /** produksi DI CABANG tujuan (kitchen cabang; hasil langsung masuk stok cabang) */
  produksi_cabang: PermintaanStokBagian | null;
  beli: PermintaanStokBagian | null;
  /** belanja bahan mentah untuk produksi (dari resep) */
  beli_produksi: PermintaanStokBagian | null;
  /** KIRIM DARI STOK CK: stok jadi yang sudah ada di CK, dipindah ke cabang */
  kirim: PermintaanStokBagian | null;
  /** faktur BELI PERLENGKAPAN (BP-) yang lahir bersama permintaan ini */
  beli_perlengkapan: PermintaanStokBagianPerlengkapan | null;
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

/**
 * TRANSFER STOK — satu baris bahan pada faktur transfer antar lokasi
 * (CK↔cabang, cabang↔cabang). `pengadaan` dibawa agar tabel jelas menandai
 * bahan BELI (dibeli jadi) vs PRODUKSI (dibuat sendiri).
 */
export interface TransferStokItemRow {
  id: string;
  ingredient_id: string;
  nama: string;
  satuan: string;
  pengadaan: JenisPengadaan;
  qty: number;
  /** menunggu = dalam perjalanan; dikonfirmasi = diterima; ditolak = tak diterima */
  status: KonfirmasiStatus;
  alasan_tolak: string | null;
}

/** Satu FAKTUR transfer stok (nomor TF-) berisi banyak bahan. */
export interface TransferStokFaktur {
  faktur_id: string;
  /** nomor dokumen TF-xxxx */
  nomor: string | null;
  waktu: string;
  prod_date: string;
  asal_branch_id: string | null;
  asal_cabang: string | null;
  tujuan_branch_id: string | null;
  tujuan_cabang: string | null;
  catatan: string | null;
  dibuat_oleh: string | null;
  /** agregat status baris; "sebagian" = ada yang diterima & ada yang ditolak */
  status: KonfirmasiStatus | "sebagian";
  items: TransferStokItemRow[];
}

/**
 * Stok READY satu bahan di cabang asal — dasar pemilih bahan & validasi qty
 * pada form Transfer Stok (hanya bahan berlacak-stok dengan saldo > 0).
 */
export interface TransferStokSaldoRow {
  ingredient_id: string;
  nama: string;
  satuan: string;
  pengadaan: JenisPengadaan;
  /** saldo FISIK di lokasi asal (barang yang masih dalam perjalanan ikut terhitung) */
  saldo: number;
  /**
   * qty yang SUDAH dijanjikan keluar tapi belum diterima tujuan (kiriman &
   * transfer berstatus 'menunggu'). Barang ini fisik sudah lepas, jadi
   * `tersedia untuk transfer baru` = `saldo − dalam_jalan`.
   */
  dalam_jalan: number;
}

/**
 * Satu LOT (baris faktur masuk stok) yang hampir/lewat tanggal kedaluwarsa —
 * GET /stok/exp. APROKSIMASI: ledger stok agregat (tanpa FIFO), jadi
 * `qty_masuk` = qty saat lot masuk, BUKAN sisa lot; `saldo` (saldo live semua
 * lot bahan) disandingkan agar user menilai sendiri sebelum mencatat waste.
 */
export interface ExpLotRow {
  production_id: string;
  ingredient_id: string;
  nama: string;
  satuan: string;
  /** qty saat lot masuk stok (bukan sisa lot — lihat catatan aproksimasi) */
  qty_masuk: number;
  exp_date: string;
  /** tanggal lot masuk (prod_date faktur) */
  prod_date: string;
  tipe: JenisPengadaan;
  faktur_id: string | null;
  /** nomor dokumen faktur (PB-/PR-) bila ada */
  nomor: string | null;
  tempat: string | null;
  /** saldo live bahan saat ini (semua lot) */
  saldo: number;
  /** exp_date − hari ini (negatif = sudah lewat exp) */
  sisa_hari: number;
}

export interface SupplierDto {
  id: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  catatan: string | null;
  /** kategori bebas utk pengelompokan/filter (mis. "sayur", "kemasan") */
  kategori: string | null;
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
  /** LEAD TIME bahan (hari): pesan/buat jauh-jauh hari (H-n); 0 = tanpa info */
  lead_time_hari: number;
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
  /**
   * true = masih ANGGOTA AKTIF perusahaan (user aktif, belum dihapus,
   * membership belum diarsip). Petugas non-aktif (akun diarsip/dihapus/
   * dibuat ulang) DIABAIKAN dalam pembatasan opname — rak tidak terkunci
   * diam-diam oleh penugasan basi — dan ditandai ⚠ di pengaturan agar
   * owner menugaskan ulang.
   */
  aktif: boolean;
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
  /** jumlah perlengkapan yang ditugaskan disimpan di rak ini */
  jumlah_perlengkapan: number;
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
    /** id baris opname — dipakai untuk ACC/Tolak per produk */
    id: string;
    nama: string;
    satuan: string;
    system_qty: number | null;
    qty_fisik: number;
    selisih: number | null;
    /** status ACC baris ini (per produk): menunggu / disetujui / ditolak */
    penyesuaian_status: PenyesuaianStatus;
    /** bukti foto selisih (URL) — dilampirkan saat pengecekan, untuk ACC admin */
    foto_url: string | null;
    /** alasan selisih (opsional) — dilampirkan saat pengecekan */
    alasan: string | null;
    /** alasan penolakan baris (bila baris ini ditolak) */
    tolak_alasan: string | null;
  }[];
}

export type MutasiJenis =
  | "opname"
  | "produksi"
  | "beli"
  | "penjualan"
  | "pemakaian"
  /** kiriman keluar: stok dipindah dari cabang ini ke cabang lain (diterima) */
  | "kirim";

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

/** Saldo satu bahan pada satu cabang — chip "Stok per Cabang" di Detail Produk. */
export interface BahanSaldoCabang {
  branch_id: string;
  nama: string;
  tipe: "store" | "central_kitchen" | "kantor";
  saldo: number;
}

/** DETAIL PRODUK satu bahan: DTO lengkap + metode HPP + sebaran stok per cabang. */
export interface BahanDetailDto {
  bahan: BahanDto;
  /** metode perhitungan biaya perusahaan (pengaturan Perusahaan) */
  metode_hpp: "average" | "fifo";
  /** total saldo seluruh cabang */
  total_saldo: number;
  saldo_cabang: BahanSaldoCabang[];
}

/**
 * Satu LOT masuk pada kartu FIFO: pembelian/produksi/transfer masuk, atau
 * penyesuaian opname naik. Urut PALING AWAL masuk — pemakaian mengonsumsi
 * lot dari atas (FIFO).
 */
export interface FifoLot {
  /** waktu barang masuk stok (ISO) */
  waktu: string;
  jenis: "beli" | "produksi" | "transfer" | "opname";
  nomor: string | null;
  supplier: string | null;
  qty_masuk: number;
  /**
   * harga per satuan kerja; null = tak diketahui (produksi/transfer tanpa
   * harga faktur). Lot opname naik memakai harga acuan master.
   */
  harga_satuan: number | null;
  /** true bila harga_satuan berasal dari harga acuan master (bukan faktur) */
  harga_acuan: boolean;
  terpakai: number;
  sisa: number;
  exp_date: string | null;
}

/** Rincian satu pemakaian FIFO: diambil dari lot mana saja. */
export interface FifoAmbil {
  /** indeks pada daftar `lots`; null = stok minus (keluar tanpa lot tersedia) */
  lot: number | null;
  qty: number;
  harga_satuan: number | null;
}

/** Satu peristiwa KELUAR pada kartu FIFO + rincian lot yang dikonsumsinya. */
export interface FifoPemakaian {
  waktu: string;
  jenis: "penjualan" | "pemakaian" | "kirim" | "opname";
  keterangan: string | null;
  qty: number;
  /** total biaya FIFO pemakaian ini; null bila ada bagian dari lot tanpa harga */
  hpp: number | null;
  rincian: FifoAmbil[];
}

/** Kartu FIFO satu bahan pada satu cabang (riwayat penggunaan dari lot paling awal). */
export interface BahanFifoDto {
  bahan: { id: string; nama: string; satuan: string };
  branch_id: string;
  branch_nama: string;
  metode_hpp: "average" | "fifo";
  /** saldo akhir = Σ sisa lot − defisit; sama dengan saldo ledger cabang */
  saldo: number;
  /** stok minus yang belum tertutup lot mana pun (pemakaian saat stok kosong) */
  defisit: number;
  lots: FifoLot[];
  /** pemakaian TERBARU dulu; maksimal 300 baris — selebihnya `terpotong` */
  pemakaian: FifoPemakaian[];
  terpotong: boolean;
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
  /** ada transaksi susulan (sinkron offline) setelah shift ditutup → rekap dihitung ulang */
  ada_transaksi_susulan: boolean;
}

/**
 * Jenis perintah yang bisa diantre offline & disinkron via POST /api/sync.
 * Fase 1: penjualan + absen. Fase 2: opname, perlengkapan, faktur tahap/kirim,
 * penerimaan. Payload = body endpoint asli (+ path param bila ditandai).
 */
export type SyncTipe =
  | "penjualan"
  | "absen_saya"
  | "absen_stasiun"
  // Fase 2
  | "stok_opname"
  | "perlengkapan_opname"
  | "perlengkapan_pakai" // payload + supply_id
  | "faktur_tahap" // payload + jalur ("produksi"|"pembelian") + faktur_id
  | "faktur_kirim" // payload + jalur + faktur_id
  | "produksi_kirim_hasil" // payload + faktur_id
  | "penerimaan_terima" // payload + faktur_id
  | "penerimaan_terima_sebagian" // payload + faktur_id
  | "penerimaan_tolak"; // payload + faktur_id

/** Satu perintah offline dalam batch sinkron (payload = body endpoint aslinya). */
export interface SyncCommand {
  /** idempotency key (uuid v4), unik per perusahaan */
  client_ref: string;
  tipe: SyncTipe;
  /** waktu kejadian di perangkat (ISO UTC) */
  waktu: string;
  payload: unknown;
}

/** Body POST /api/sync — batch perintah urut kronologis (maks 100). */
export interface SyncRequest {
  device_id?: string | null;
  commands: SyncCommand[];
}

/** Hasil satu perintah (urutan sama dengan permintaan). */
export interface SyncItemResult {
  client_ref: string;
  /** ok = baru dieksekusi; sudah_ada = idempoten (retry); gagal = ditolak */
  status: "ok" | "sudah_ada" | "gagal";
  /** kode HTTP hasil eksekusi endpoint asli */
  kode: number;
  /** data respons endpoint asli (saat ok/sudah_ada sukses) */
  data?: unknown;
  /** pesan error endpoint asli (saat gagal) */
  error?: string;
}

/** Respons POST /api/sync — selalu 200; detail per item. */
export interface SyncResponse {
  hasil: SyncItemResult[];
}

/** Satu transaksi di dalam jendela waktu sebuah shift (untuk detail shift). */
export interface ShiftTransaksiRow {
  id: string;
  nomor: string;
  waktu: string;
  total: number;
  metode: MetodeBayar;
  kasir: string | null;
}

/** Detail satu shift = ringkasan shift + daftar transaksi di jendela waktunya. */
export interface ShiftDetail extends Shift {
  transaksi: ShiftTransaksiRow[];
}

/**
 * Status operasional satu cabang store untuk pantauan owner/admin
 * (GET /shift/pantau). Penjualan_* = total HARI INI (zona waktu perusahaan);
 * meta shift (dibuka_*) hanya terisi bila ada shift kasir yang sedang terbuka.
 */
export interface ShiftPantauRow {
  branch_id: string;
  branch_nama: string;
  /** jam operasional cabang "HH:MM" (null bila belum diatur) */
  jam_buka: string | null;
  jam_tutup: string | null;
  /** shift kasir yang sedang terbuka (null = kasir tutup) */
  shift_id: string | null;
  dibuka_oleh: string | null;
  dibuka_pada: string | null;
  modal_awal: number | null;
  penjualan_tunai: number;
  penjualan_nontunai: number;
  jumlah_transaksi: number;
  /** kas seharusnya = modal_awal + penjualan tunai hari ini (0 bila tutup) */
  kas_sistem: number;
  /** sudah ada shift dibuka hari ini? */
  buka_hari_ini: boolean;
  /** sudah lewat jam buka tapi kasir belum dibuka hari ini */
  telat_buka: boolean;
  /** kasir masih terbuka padahal sudah lewat jam tutup */
  lupa_tutup: boolean;
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
  /**
   * DI SIMPAN DI MANA: rak per cabang (CK & cabang store), sumbernya Tempat
   * Penyimpanan (tabel yang sama dengan bahan baku). READ-ONLY — diatur di
   * Tempat Penyimpanan, bukan di form Perlengkapan.
   */
  rak_lokasi: RakLokasi[];
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
  /**
   * FAKTUR BP- yang menaungi seluruh `beli_dibuat` (satu faktur multi-item,
   * seperti faktur beli bahan baku). Null bila tak ada yang perlu dibeli.
   */
  beli_faktur: { faktur_id: string; nomor: string; jumlah_baris: number } | null;
  /** item ≤ minimum tapi cabang ini bukan store / tak terhubung CK */
  tak_bisa_kirim: { supply_id: string; nama: string; satuan: string; qty: number }[];
}

/** Status faktur beli perlengkapan ke CK. */
export type BeliPerlengkapanStatus = "menunggu" | "diproses" | "tiba" | "batal";

/** Satu BARIS faktur beli perlengkapan ke Central Kitchen (BP-). */
export interface BeliPerlengkapanRow {
  id: string;
  /**
   * FAKTUR pengelompokan: baris satu submit berbagi faktur_id & satu nomor
   * BP-. Null hanya untuk baris warisan (pra-faktur, nomor per baris).
   */
  faktur_id: string | null;
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
  /** pemroses belanja — tercatat saat faktur ditandai 'diproses' */
  diproses_oleh: string | null;
  /** supplier LANGGANAN item (is_utama) — "tempat beli" di kartu & Dokumen RAB */
  supplier_utama: string | null;
  /** harga beli per satuan dari master — estimasi RAB (qty × harga_beli) */
  harga_beli: number;
  /**
   * Faktur ini terkait PERMINTAAN yang MASIH AKTIF (rencana_id punya produksi
   * yang belum dihapus). true → tak boleh Hapus permanen dari sini (kelola dari
   * Permintaan Stok); false (manual / permintaan sudah tak ada) → boleh Hapus.
   */
  permintaan_aktif: boolean;
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

/** Titik harga ekstrem riwayat pembelian: nilainya berapa & kapan terjadi. */
export interface HargaEkstrem {
  /** harga per satuan */
  harga: number;
  /** tanggal lot pembelian (YYYY-MM-DD) */
  tanggal: string;
}

/**
 * Riwayat harga beli satu barang: daftar lot pembelian + harga terkini &
 * rata-rata tertimbang. Dipakai kartu "Riwayat Harga" (bahan baku & perlengkapan)
 * sebagai fondasi hitung laba-rugi (FIFO/average).
 */
export interface RiwayatHargaDto {
  item: {
    id: string;
    nama: string;
    satuan: string;
    /** isi per kemasan dalam satuan (1 = tanpa kemasan; perlengkapan selalu 1) */
    isi: number;
    /** satuan beli/kemasan (mis. "kg", "dus") — null bila tak diatur */
    satuan_beli: string | null;
  };
  /** harga per satuan terkini (harga_beli / isi utk bahan; harga_beli utk perlengkapan) */
  harga_terkini: number;
  /** rata-rata tertimbang per satuan dari lot berharga (null bila belum ada) */
  harga_rata: number | null;
  /** harga per satuan terendah dari lot berharga + kapan (null bila belum ada) */
  harga_terendah: HargaEkstrem | null;
  /** harga per satuan tertinggi dari lot berharga + kapan (null bila belum ada) */
  harga_tertinggi: HargaEkstrem | null;
  /**
   * median harga per satuan dari lot berharga (null bila belum ada) — dasar
   * HARGA ACUAN utk RAB beli bahan baku (disinkron saat Laporan Harga); harga
   * riil tiap pembelian tetap tercatat per lot utk HPP FIFO/resep.
   */
  harga_median: number | null;
  /** jumlah lot pembelian tercatat */
  jumlah_pembelian: number;
  lots: RiwayatHargaLot[];
}
```
