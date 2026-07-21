# Info Tim Mobile (Flutter): perombakan alur login + onboarding + lupa password

> Salin dokumen ini sebagai prompt/brief untuk tim **kakarut-mobile (Flutter)**.
> Aplikasi bicara langsung ke API yang sama (lihat `docs/API-CONTRACT.md`).
> Fokus: yang **berubah** dan yang **baru** — beserta layar yang perlu dibuat.

---

## TL;DR — yang WAJIB diadopsi

1. **Login sekarang bisa balas sesi TANPA perusahaan** (`company: null`). Dulu
   ditolak 403; sekarang sukses. Aplikasi HARUS menangani state "belum punya
   perusahaan" → tampilkan layar **Onboarding**.
2. **Endpoint baru**: daftar, lupa/reset password, onboarding (buat perusahaan /
   terima undangan / hapus akun), undang karyawan.
3. **Aksi buat-perusahaan & terima-undangan mengembalikan SESI BARU** (token +
   user + company). Perlakukan seperti login: **ganti** sesi tersimpan.
4. **Gerbang Buka Kasir** (sudah live sebelumnya) tetap berlaku — lihat
   `PROMPT-BUKA-KASIR.md`. Tak berubah.

---

## 1. Perubahan perilaku endpoint LAMA

### `POST /api/auth/login`
- Res sukses kini bisa `company: null`, `user.company_id: null`, `user.role: null`
  untuk user yang belum tergabung ke perusahaan mana pun.
- **Aturan navigasi setelah login:**
  - `user.is_super_admin == true` → area super-admin (mobile umumnya abaikan).
  - `company != null` → masuk aplikasi seperti biasa (kasir/manajemen sesuai `role`).
  - `company == null && !is_super_admin` → **layar Onboarding** (lihat §3).
- Error **401** sekarang juga untuk akun yang **dihapus/nonaktif** (bukan hanya
  password salah). Tak ada lagi 403 "tak terhubung perusahaan".

---

## 2. Endpoint auth BARU (publik — tanpa token)

- `POST /api/auth/register` — body `{ nama, email, password (min 8) }` → **201**
  sesi (langsung login). `company` null kecuali email itu punya undangan pending
  (auto-join). Error **409** email sudah ada, **400** validasi.
- `POST /api/auth/forgot-password` — body `{ email }` → **200** `{ ok, dev_reset_url? }`.
  SELALU 200 (jangan tampilkan apakah email terdaftar). Server kirim tautan reset
  via email. `dev_reset_url` hanya ada saat email server belum dikonfigurasi &
  bukan produksi — **abaikan di aplikasi rilis**.
- `POST /api/auth/reset-password` — body `{ token, password (min 8) }` → **200**;
  error **400** token invalid/kedaluwarsa/terpakai.

### Layar yang perlu dibuat
- **Daftar** (Register): nama, email, password + konfirmasi → `register` → arahkan
  sesuai hasil sesi (onboarding bila `company` null).
- **Lupa Password**: input email → `forgot-password` → pesan "cek email Anda".
- **Reset Password**: form password baru → `reset-password`. **Token** datang dari
  tautan email berupa URL WEB `…/reset-password?token=…`. Dua opsi:
  - (a) buka tautan di browser/web (paling sederhana), atau
  - (b) **deep link**: daftarkan skema link app untuk `/reset-password?token=` →
    buka layar native → panggil `reset-password`. (Butuh `APP_BASE_URL` server
    diarahkan ke domain yang ditangani app.)
- Tautan **"Lupa password?"** & **"Daftar"** di layar Masuk.

---

## 3. Onboarding — user tanpa perusahaan (`/api/onboarding/*`, butuh token)

Tampil saat `company == null`. Panggil `GET /api/onboarding/status` →
`{ has_company, email, undangan: [{ id, company_nama, role, cabang_nama, diundang_pada }] }`.

Layar Onboarding memuat:
1. **Undangan untuk Anda** (bila `undangan` tak kosong): tiap item → **Terima**
   (`POST /onboarding/undangan/:id/terima` → **sesi baru** → ganti sesi → masuk app)
   atau **Tolak** (`POST /onboarding/undangan/:id/tolak`).
2. **Buat Perusahaan**: input nama usaha → `POST /onboarding/perusahaan { nama }`
   → **201 sesi baru** (jadi owner) → ganti sesi → masuk app.
3. Info **"menunggu diundang"**: tampilkan email user (minta owner mengundang
   email ini).
4. **Keluar** (logout) + **Hapus Akun** (opsional; lihat §5).

> PENTING: `perusahaan` & `undangan/terima` mengembalikan **sesi baru** (token+
> user+company). Simpan/ganti seperti hasil login, JANGAN sekadar refresh profil.

---

## 4. Undang karyawan (sisi owner/admin — `/api/karyawan/*`)

Bila app punya layar Kelola Karyawan:
- `POST /api/karyawan/undang { email, role, branch_id? }` → **201**. (cashier/tim
  wajib `branch_id`.) Error **409** sudah anggota/sudah diundang.
- `GET /api/karyawan/undangan` → daftar undangan pending.
- `DELETE /api/karyawan/undangan/:id` → batalkan.

`POST /api/karyawan` (buat akun langsung + password) tetap ada untuk hire cepat.

---

## 5. Hapus akun sendiri

- `DELETE /api/onboarding/akun` — body `{ password }` → **200**. SOFT delete;
  setelah itu login gagal (401). Error **400** bila pemanggil **owner terakhir**
  sebuah perusahaan (harus serahkan/hapus perusahaan dulu), **401** password salah.
- Bisa ditaruh di Profil dan/atau Onboarding. Setelah sukses → logout ke Masuk.

---

## 6. Yang TIDAK perlu dibangun di mobile

- Halaman **Pengaturan SMTP** (super-admin/web saja).
- Halaman super-admin lain.

---

## 7. Checklist terima

1. Login user tanpa perusahaan → tak error, masuk **Onboarding**.
2. Daftar akun baru → onboarding; email dgn undangan → auto-join langsung masuk.
3. Onboarding → Buat Perusahaan → jadi owner, masuk app (sesi diganti).
4. Onboarding → Terima undangan → jadi karyawan, masuk app (sesi diganti).
5. Lupa password → 200; reset via tautan → login password baru berhasil; token
   bekas/ngawur → 400.
6. Hapus akun → 200 lalu login gagal; owner terakhir → 400.
7. Undang via email → muncul di daftar undangan; batalkan bekerja.

## Referensi
- `docs/API-CONTRACT.md` — bagian `/api/auth`, `/api/onboarding`, `/api/karyawan`.
- `docs/mobile/PROMPT-BUKA-KASIR.md` — gerbang Buka Kasir (tak berubah).
- Perilaku acuan (web): `apps/web/src/pages/SignupPage.tsx`,
  `OnboardingPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`,
  `components/HapusAkunButton.tsx`, `context/AuthContext.tsx` (`register`/`setSession`).
