# Checklist Rilis — App Store & Play Store (Terakasir)

Status teknis di repo ini sudah disiapkan (lihat §1). Sisanya adalah urusan
akun/aset/kebijakan yang harus dikerjakan manual (§2–§4).

---

## 1. Sudah beres di kode (tidak perlu diulang)

- ✅ Ikon launcher iOS & Android dari logo Terakasir (semua ukuran, tanpa alpha di iOS).
- ✅ Nama tampilan "Terakasir" (Info.plist `CFBundleDisplayName`, Android `label`).
- ✅ String izin iOS spesifik: kamera (absen/QR), lokasi (geofence absen),
  Bluetooth (printer), jaringan lokal (printer LAN).
- ✅ `ITSAppUsesNonExemptEncryption=false` (hanya HTTPS → bebas pertanyaan
  export compliance).
- ✅ Izin Android benar: lokasi FINE+COARSE semua versi (geofence absen),
  BT modern (API 31+) + legacy, kamera, internet.
- ✅ **Hapus Akun di dalam app** (Profil & Onboarding) — WAJIB Apple bila ada
  pendaftaran akun. ✔ sudah ada.
- ✅ Scaffold signing rilis Android: `android/key.properties` (di-gitignore) →
  build release otomatis memakai keystore upload.
- ✅ Versi di `pubspec.yaml` (`version: 1.0.0+1`) — naikkan `+N` (build number)
  setiap unggah baru.

## 2. Akun & aset yang harus disiapkan

| Item | Keterangan |
|---|---|
| Apple Developer Program | US$99/tahun — daftarkan, buat App ID `id.basooopa.kakarut` |
| Google Play Console | US$25 sekali — buat aplikasi `id.basooopa.kakarut` |
| **Privacy Policy URL (WAJIB dua toko)** | Halaman publik, mis. `https://terakasir.com/privacy` — jelaskan data yang dikumpulkan: email akun, lokasi saat absen, foto bukti absen, data transaksi usaha. Minta tim web membuatnya. |
| Screenshot | iOS: 6.7" (1290×2796) min 3; Android: ponsel min 2 + feature graphic 1024×500 |
| Deskripsi toko | Nama "Terakasir", deskripsi pendek/panjang Bahasa Indonesia |
| Ikon toko | Play: 512×512 (pakai assets/icon/icon.png) — iOS ikut dari build |

## 3. Build & unggah

### iOS (App Store)
```bash
# perlu CocoaPods TIDAK — proyek ini murni SPM ✅ (jangan tambah pod)
open ios/Runner.xcworkspace   # ← TIDAK ADA; buka ios/Runner.xcodeproj
# Xcode: Signing & Capabilities → Team (akun Developer) → automatic signing
flutter build ipa             # hasil: build/ios/ipa/*.ipa
# unggah via Xcode Organizer atau `xcrun altool` / Transporter
```

### Android (Play Store)
```bash
# 1) buat keystore upload (SEKALI, simpan baik-baik):
keytool -genkey -v -keystore ~/terakasir-upload.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias terakasir
# 2) buat android/key.properties:
#    storeFile=/Users/<nama>/terakasir-upload.jks
#    storePassword=...
#    keyAlias=terakasir
#    keyPassword=...
# 3) build AAB (bukan APK) utk Play:
flutter build appbundle       # hasil: build/app/outputs/bundle/release/app-release.aab
```

## 4. Formulir kebijakan di konsol (isi jujur & konsisten)

**Apple — App Privacy:** data yang dikumpulkan & tertaut ke identitas:
Email, Nama, Lokasi presisi (hanya saat absen), Foto (bukti absen),
ID pengguna. Tidak ada tracking/iklan → tanpa ATT.

**Play — Data safety:** sama seperti di atas + "data dienkripsi saat
transit (HTTPS)" + "pengguna dapat meminta penghapusan data (fitur Hapus
Akun dalam aplikasi)". Kategori app: Bisnis.

**Akun demo untuk reviewer (dua toko meminta ini):**
- Siapkan akun kasir + owner khusus review pada perusahaan demo.
- PENTING: cabang demo **tanpa geofence** (kosongkan lat/lng) agar reviewer
  bisa absen & buka kasir dari mana pun; tanpa itu alur kasir buntu dan app
  bisa DITOLAK karena "fitur tidak bisa diuji".
- Tulis catatan reviewer: alur uji singkat (login kasir → absen (kamera) →
  buka kasir → transaksi → struk opsional printer).

## 5. Perangkap penolakan umum (sudah diantisipasi / perhatikan)

- ✅ Akun wajib login tanpa cara daftar → KITA PUNYA tombol Daftar + onboarding.
- ✅ Minta izin tanpa penjelasan → string izin sudah spesifik.
- ✅ Tidak ada hapus akun → sudah ada.
- ⚠️ Reviewer tidak bisa menguji (geofence/absen) → akun demo tanpa geofence.
- ⚠️ Konten placeholder/crash saat offline → mode offline sudah ditangani,
  tapi UJI fresh-install tanpa jaringan sebelum submit.
- ⚠️ Versi minimum: iOS 14+, Android minSdk mengikuti Flutter (21+) — ok.
- ⚠️ Play menargetkan API level terbaru — ikut Flutter stable (aman); update
  Flutter bila Play menaikkan syarat targetSdk.
