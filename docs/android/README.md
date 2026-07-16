# 📱 Kakarut POS — Aplikasi Android

Dokumen ini menjelaskan rencana & cara membuat **aplikasi Android** Kakarut POS,
supaya **printer thermal Bluetooth lebih mudah** (langsung tersambung, tanpa
aplikasi RawBT pihak ketiga) dan **kasir lebih nyaman** (ikon di layar utama,
layar penuh, auto-print setelah bayar).

> **Cara pakai:** buka file [`PROMPT.md`](./PROMPT.md), salin seluruh isinya,
> lalu tempel ke sesi Claude Code **di komputer lokal Anda** (yang sudah
> terpasang Android Studio). Prompt itu berisi semua konteks teknis yang
> dibutuhkan untuk membangun aplikasinya dari nol sampai APK.

---

## Keputusan arsitektur (ringkas)

**Capacitor (WebView + plugin native), bukan menulis ulang aplikasi.**

| Pertimbangan | Penjelasan |
| --- | --- |
| UI kasir | Web app React yang sudah ada **dipakai ulang 100%** — tidak ada fitur yang ditulis dua kali. |
| Sumber halaman | WebView memuat **URL produksi langsung** (`server.url` Capacitor). Setiap deploy web otomatis terpakai di semua HP — **tanpa update APK**. |
| Kenapa bukan bundel `dist` di APK? | `apps/web/src/lib/api.ts` memanggil API dengan path **relatif `/api`** dan server **tidak punya middleware CORS** — memuat dari URL produksi berarti *same-origin*, nol perubahan kode. Bundel lokal butuh 2 perubahan berisiko (base URL + CORS) tanpa manfaat nyata (POS ini butuh internet karena DB-nya remote). |
| Printer | Plugin native Kotlin **Bluetooth klasik (SPP/RFCOMM)** — jenis printer thermal murah yang paling umum di Indonesia dan justru **tidak bisa** diakses Web Bluetooth (BLE-only). Byte ESC/POS-nya tetap dari builder yang sudah ada di `packages/shared` — plugin hanya “pipa” pengirim byte. |
| Auth | Sudah kompatibel WebView: JWT Bearer di `localStorage` (`kakarut.auth`), tanpa cookie. |
| Distribusi | APK langsung di-install ke HP kasir (tidak wajib Play Store). |

### Arsitektur cetak setelah ada aplikasi Android

```
ReceiptModal ──► buildReceiptBytes(ReceiptData) ──► Uint8Array ESC/POS
                                                        │
                    PrinterContext.getTransport(settings.transport)
                                                        │
        ┌──────────────┬──────────────┬─────────────────┼──────────────┐
        ▼              ▼              ▼                 ▼              ▼
   "browser"      "bluetooth"      "usb"            "rawbt"         "lan"
 window.print()   Web BT (BLE)    WebUSB         app RawBT      proxy server
        │                                                          TCP 9100
        ▼
    "native"  ◄── BARU: hanya muncul di dalam aplikasi Android
 window.Capacitor.Plugins.KakarutPrinter (Kotlin)
 → Bluetooth klasik SPP → printer thermal
```

Transport lama **tidak diubah** — `"native"` hanya opsi tambahan yang muncul
otomatis ketika web dibuka dari dalam aplikasi.

## Apa yang akan dibangun (2 bagian)

1. **Bagian A — repo ini (web): ✅ sudah dikerjakan.** Transport
   `apps/web/src/lib/print/native.ts` + opsi “📱 Printer Aplikasi (Bluetooth)”
   di Pengaturan Printer (hanya tampil di dalam aplikasi) + field `btAddress`
   di setelan printer. Karena WebView memuat URL produksi, bagian ini ikut
   terdeploy lewat alur deploy web biasa.
2. **Bagian B — folder baru `mobile/` (di luar npm workspaces): dikerjakan di
   komputer lokal lewat `PROMPT.md`.** Proyek Capacitor Android + plugin Kotlin
   `KakarutPrinter` (list perangkat ter-pair, connect SPP, tulis byte base64,
   auto-reconnect saat write) — kontrak method-nya mengikuti interface di
   `apps/web/src/lib/print/native.ts`.

## Prasyarat di komputer Anda

- **Android Studio** terbaru (berisi Android SDK + platform-tools).
- **JDK 17+** (bawaan Android Studio cukup).
- **Node.js 20+** dan repo `mohteja/Kakarut` ter-clone.
- HP Android untuk uji (aktifkan *Developer options → USB debugging*), dan
  printer thermal Bluetooth yang **sudah di-pair** lewat Pengaturan Bluetooth HP.

## Alur kerja singkat

1. Salin isi `PROMPT.md` → tempel ke Claude Code di komputer lokal.
2. Claude membangun Bagian A + B, lalu memandu build:
   `cd mobile && npm install && npx cap sync android && npx cap open android`.
3. Jalankan di HP dari Android Studio (▶), atau `./gradlew assembleDebug`
   → `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
4. Di aplikasi: login kasir → Pengaturan Printer → pilih
   **📱 Printer Aplikasi (Bluetooth)** → pilih printer ter-pair → **Cetak Tes**.
5. Rilis: buat keystore, `./gradlew assembleRelease`, bagikan APK ke HP kasir.

## FAQ

- **Perlu Play Store?** Tidak. APK bisa dipasang langsung (sideload) — umum
  untuk perangkat kasir internal. Play Store opsional belakangan.
- **Kalau web di-deploy versi baru?** Aplikasi otomatis memuat versi terbaru
  (WebView menunjuk URL produksi). APK hanya perlu di-update bila plugin
  printer/konfigurasi native berubah.
- **Kalau internet mati?** Sama seperti membuka web di browser — POS ini memang
  butuh koneksi ke server. (Mode offline = proyek terpisah, di luar lingkup ini.)
- **Printer LAN & RawBT masih bisa?** Bisa — semua transport lama tetap ada.
  Opsi native hanya menambah jalur yang paling nyaman untuk Bluetooth klasik.
