> ⚠️ **USANG / TIDAK DIPAKAI LAGI (deprecated).** Rencana ini memakai
> **Capacitor (WebView)**. Arah aplikasi mobile sekarang **Flutter (native)** di
> repo terpisah `kakarut-mobile`, yang bicara langsung ke API server — **bukan**
> membungkus web di WebView. Dokumen ini disimpan hanya sebagai arsip; jangan
> dijadikan acuan. Untuk tim mobile Flutter, pakai **kontrak API** di
> `docs/API-CONTRACT.md`.

# Prompt: Bangun Aplikasi Android Kakarut POS (Capacitor + Printer Bluetooth Native)

> Salin SELURUH isi di bawah garis ini, lalu tempel ke sesi Claude Code di
> komputer lokal Anda (repo `mohteja/Kakarut` ter-clone, Android Studio terpasang).
> Ganti dulu `https://GANTI-DOMAIN-ANDA` dengan domain produksi Anda.

---

Kamu bekerja di repo **Kakarut POS** — SaaS POS F&B multi-tenant (bahasa UI:
Indonesia). Tugasmu: membuat **aplikasi Android** memakai **Capacitor** yang
membungkus web app produksi, plus **plugin printer Bluetooth klasik (SPP)
native** supaya printer thermal murah langsung jalan dari aplikasi — tanpa
aplikasi RawBT pihak ketiga. Kerjakan di branch baru dari `production`,
verifikasi, lalu commit per bagian dengan pesan jelas.

**URL produksi aplikasi:** `https://GANTI-DOMAIN-ANDA` (SELALU pakai konstanta
`APP_URL` — jangan hardcode di banyak tempat).

## 0. Fakta teknis codebase (sudah diverifikasi — jangan tebak ulang)

Monorepo **npm workspaces** `["packages/*", "apps/*"]` (root `package.json`):
`@kakarut/shared` (TS source-only), `@kakarut/server` (Hono, serve API **dan**
SPA dari `apps/web/dist`), `@kakarut/web` (React 19 + Vite + Tailwind 4).
Script penting root: `npm run typecheck` (semua workspace), `npm run build`
(build web saja), `npm test`.

**API & auth — sudah kompatibel WebView, JANGAN diubah:**
- `apps/web/src/lib/api.ts` memanggil ``fetch(`/api${path}`)`` — path **relatif**,
  tanpa env override. Server **tidak punya middleware CORS**. Karena itu WebView
  WAJIB memuat **URL produksi langsung** (same-origin) via `server.url`
  Capacitor — bukan membundel `dist` di APK.
- Auth: JWT Bearer di `localStorage` key `"kakarut.auth"` (tanpa cookie).
  401 → redirect `/login` (aman di WebView, tetap di origin yang sama).

**Subsistem printer web (semua path persis):**
- Interface transport — `apps/web/src/lib/print/transport.ts`:
  ```ts
  export interface PrinterTransport {
    readonly kind: TransportKind;
    readonly requiresConnect: boolean;
    connect(): Promise<{ deviceName: string | null }>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    write(bytes: Uint8Array): Promise<void>;
  }
  ```
  (Ada juga `abstract class ConnectionlessTransport` untuk transport tanpa
  tombol Hubungkan, dan `type PrinterStatus`.)
- Setelan — `apps/web/src/lib/print/settings.ts`: localStorage key
  `"kakarut.printer"`, `TransportKind = "browser" | "bluetooth" | "usb" |
  "rawbt" | "lan" | "mock"`, interface `PrinterDeviceSettings` (v:1, transport,
  paperWidth 58|80, charsPerLine, autoPrint, cutEnabled, drawerKickEnabled,
  feedLines, btDeviceName, chunkSize, chunkDelayMs, lanHost, lanPort) +
  `DEFAULT_PRINTER_SETTINGS`. Loader me-merge default, jadi field baru aman
  tanpa naik versi.
- `apps/web/src/context/PrinterContext.tsx`: `getTransport(settings)` memetakan
  kind → instance **singleton per-kind** (objek `singletons` level modul);
  pola untuk transport berparameter: `LanTransport` di-`setTarget(host, port)`
  setiap kali dipanggil. `printReceipt(data) = printBytes(buildReceiptBytes(data,
  opts()))`; `printTest()` untuk Cetak Tes; `canAutoPrint = isThermal &&
  transport !== "rawbt" && (!requiresConnect || isConnected())`.
- Transport yang sudah ada (JANGAN diubah): `bluetooth.ts` (Web Bluetooth BLE),
  `usb.ts` (WebUSB), `rawbt.ts` (intent app RawBT), `lan.ts` (POST
  `/print/lan` → proxy TCP di server), `mock.ts` (e2e).
- UI setelan — `apps/web/src/pages/pengaturan/PrinterPage.tsx`: array `METODE`
  (radio pilihan transport) + field per-transport + tombol Hubungkan (hanya
  bila `requiresConnect`) + Cetak Tes + `StatusBadge`.
- Byte struk — `packages/shared/src/receipt.ts`:
  `buildReceiptBytes(data: ReceiptData, opts: ReceiptOptions): Uint8Array` dan
  `buildTestPrintBytes(opts)`; ESC/POS via `EscPosBuilder`
  (`packages/shared/src/escpos.ts`), teks ASCII CP437, 58mm→32 kolom,
  80mm→48 kolom. **Byte ini transport-agnostik — plugin native hanya “pipa”.**

**Belum ada PWA/manifest/ikon** di `apps/web` (tidak ada folder `public/`) —
aset ikon aplikasi harus dibuat baru.

## 1. Arsitektur (keputusan final — jangan didebat ulang)

- **Capacitor** (versi stabil terbaru), Android saja.
- WebView memuat `APP_URL` via `server.url` → same-origin dengan API, nol
  perubahan pada `api.ts`/server, dan **setiap deploy web otomatis terpakai
  di aplikasi tanpa update APK**. Capacitor tetap menyuntikkan bridge JS ke
  halaman remote, jadi `window.Capacitor.Plugins.*` tersedia.
- Proyek native di folder **`mobile/` di root repo** — di LUAR pola workspaces
  `["packages/*", "apps/*"]`, supaya `npm ci` di Docker/CI server tidak ikut
  menginstal dependensi Capacitor. `mobile/` punya `package.json` sendiri.
- Plugin native: **Bluetooth klasik SPP/RFCOMM** (UUID
  `00001101-0000-1000-8000-00805F9B34FB`) — segmen printer thermal paling
  umum yang justru TIDAK terjangkau Web Bluetooth (BLE-only). Hanya perangkat
  **yang sudah di-pair** di Pengaturan Bluetooth Android (tanpa scanning →
  tidak perlu izin lokasi).

## 2. Bagian A — perubahan di web (`apps/web`) — ✅ SUDAH DIKERJAKAN

> **Bagian ini SUDAH diimplementasikan dan ter-merge di repo** — JANGAN
> dikerjakan ulang. Baca file-file berikut sebagai kontrak yang harus dipenuhi
> plugin native di Bagian B:
> - `apps/web/src/lib/print/native.ts` — `NativeBtTransport` + interface
>   `KakarutPrinterPlugin` (kontrak method `list`/`connect`/`disconnect`/
>   `isConnected`/`write` PERSIS seperti di file ini).
> - `apps/web/src/lib/print/settings.ts` — `TransportKind` sudah berisi
>   `"native"`, setelan sudah punya `btAddress`.
> - `apps/web/src/context/PrinterContext.tsx` — case `"native"`.
> - `apps/web/src/pages/pengaturan/PrinterPage.tsx` — opsi
>   `📱 Printer Aplikasi (Bluetooth)` (hanya tampil bila
>   `window.Capacitor.isNativePlatform()` true) + pemilih perangkat ter-pair.
>
> Spesifikasi asli di bawah dipertahankan sebagai REFERENSI perilaku.

Transport baru `"native"` yang hanya muncul saat web dibuka di dalam aplikasi.
Ikuti gaya kode sekitar (komentar bahasa Indonesia, pola yang sudah ada).

1. **`apps/web/src/lib/print/settings.ts`**
   - `TransportKind` += `"native"`.
   - `PrinterDeviceSettings` += `btAddress: string | null` (alamat MAC printer
     ter-pair) dengan default `null` di `DEFAULT_PRINTER_SETTINGS`. Versi tetap
     `v: 1` (loader sudah merge default).

2. **BARU `apps/web/src/lib/print/native.ts`**
   - `declare global` minimal untuk `window.Capacitor`
     (`isNativePlatform?: () => boolean`, `Plugins?: Record<string, …>`).
   - `export function isNativeApp(): boolean` →
     `Boolean(window.Capacitor?.isNativePlatform?.())`.
   - `export interface PerangkatBt { name: string | null; address: string }`.
   - `export class NativeBtTransport implements PrinterTransport`:
     - `kind = "native"`, **`requiresConnect = false`** — `write()` memastikan
       koneksi sendiri (lazy connect + auto-reconnect), jadi kasir tidak perlu
       tombol Hubungkan dan `canAutoPrint` langsung `true` → auto-print jalan
       sejak aplikasi dibuka.
     - `setAddress(addr: string | null)` (pola `LanTransport.setTarget`).
     - `static async listPaired(): Promise<PerangkatBt[]>` → panggil
       `window.Capacitor.Plugins.KakarutPrinter.list()`.
     - `write(bytes)`: tanpa `btAddress` → throw
       `"Pilih printer dulu di Pengaturan Printer"`; encode base64 (pola sama
       dengan `lan.ts`); panggil `KakarutPrinter.write({ address, data })`.
       Plugin native yang menangani connect/reconnect; sisi web cukup satu
       retry bila panggilan pertama gagal.
     - `connect()`/`disconnect()`/`isConnected()` implementasi wajar (connect =
       uji sambung ke `btAddress`, kembalikan nama perangkat).
     - Guard semua panggilan: bila `!isNativeApp()` atau plugin tidak ada,
       throw `"Fitur ini hanya tersedia di aplikasi Android Kakarut"`.

3. **`apps/web/src/context/PrinterContext.tsx`** — di `getTransport`, case
   `"native"`: singleton `NativeBtTransport` + `setAddress(s.btAddress)`
   setiap dipanggil (persis pola case `"lan"`).

4. **`apps/web/src/pages/pengaturan/PrinterPage.tsx`**
   - Entri `METODE` baru: `📱 Printer Aplikasi (Bluetooth)` — deskripsi:
     printer thermal Bluetooth klasik langsung dari aplikasi Android; pair dulu
     di Pengaturan Bluetooth HP. **Hanya dirender bila `isNativeApp()`**, dan
     beri badge "Direkomendasikan" saat tampil.
   - Saat transport `"native"` terpilih: seksi pemilih perangkat — tombol
     `Muat perangkat ter-pair` → `NativeBtTransport.listPaired()` → dropdown
     `nama (alamat)`; memilih → `updateSettings({ btAddress, btDeviceName })`.
     Info kecil bila daftar kosong: arahkan pair dulu di Pengaturan Bluetooth
     Android. Tombol **Cetak Tes** yang ada dipakai apa adanya.
   - Transport lain & UI lain jangan disentuh.

5. **JANGAN**: mengubah `api.ts`, server (`apps/server`), transport lama,
   atau menambah dependensi npm di `apps/web` (bridge dipakai via
   `window.Capacitor`, bukan import `@capacitor/core`).

## 3. Bagian B — proyek native `mobile/`

1. **Inisialisasi** (folder `mobile/` di root, TANPA menyentuh workspaces):
   `package.json` sendiri (private) berisi dependensi `@capacitor/core`,
   `@capacitor/cli`, `@capacitor/android` (versi stabil terbaru yang saling
   cocok). `mobile/www/index.html` placeholder (wajib ada untuk `webDir`
   meski tidak dipakai karena `server.url`). Lalu `npx cap add android`.

2. **`mobile/capacitor.config.ts`**:
   ```ts
   const APP_URL = "https://GANTI-DOMAIN-ANDA";
   const config: CapacitorConfig = {
     appId: "id.basooopa.kakarut",
     appName: "Kakarut POS",
     webDir: "www",
     server: { url: APP_URL, cleartext: false },
   };
   ```

3. **Plugin Kotlin `KakarutPrinter`** —
   `mobile/android/app/src/main/java/id/basooopa/kakarut/KakarutPrinterPlugin.kt`,
   `@CapacitorPlugin(name = "KakarutPrinter")`, didaftarkan di `MainActivity`
   (`registerPlugin(KakarutPrinterPlugin::class.java)` di `onCreate` SEBELUM
   `super.onCreate`). Metode:
   - `list()` → pastikan izin → `BluetoothAdapter.bondedDevices` →
     `{ devices: [{ name, address }] }`.
   - `write({ address, data })` — `data` = base64 ESC/POS. Pastikan socket
     RFCOMM ke `address` tersambung (`createRfcommSocketToServiceRecord(SPP_UUID)`,
     fallback `createInsecureRfcommSocketToServiceRecord`;
     `cancelDiscovery()` sebelum connect). Tulis byte + `flush()`. Bila
     `IOException` (printer sempat mati/idle): tutup socket → connect ulang
     sekali → tulis ulang. Gagal → reject pesan bahasa Indonesia yang jelas
     (mis. `"Printer tidak terjangkau — pastikan menyala dan dalam jangkauan"`).
   - `connect({ address })` → sambung + `{ deviceName }`;
     `disconnect()`; `isConnected()` → `{ connected }`.
   - **Semua operasi socket di thread IO** (ExecutorService), resolve/reject di
     callback — jangan blokir main thread. Socket disimpan sebagai state plugin
     (satu printer aktif per perangkat kasir).
   - **Izin**: manifest `BLUETOOTH` + `BLUETOOTH_ADMIN` dengan
     `android:maxSdkVersion="30"`, dan `BLUETOOTH_CONNECT` (Android 12+,
     runtime — pakai mekanisme permission alias Capacitor; minta saat `list`/
     `write` pertama; ditolak → reject `"Izin Bluetooth ditolak — izinkan
     'Perangkat di sekitar' di pengaturan aplikasi"`). Tidak perlu izin lokasi
     (hanya bonded devices, tanpa scanning).

4. **Ikon & splash**: buat `mobile/assets/icon.png` 1024×1024 sederhana (latar
   oranye `#f97316`, huruf “K” putih tebal) + `splash.png`, generate dengan
   `@capacitor/assets`. Nama aplikasi: **Kakarut POS**.

5. **`mobile/README.md`** ringkas: prasyarat, `npm install`,
   `npx cap sync android`, buka Android Studio / `./gradlew assembleDebug`,
   lokasi APK debug, cara buat keystore + `assembleRelease` untuk rilis, cara
   ganti `APP_URL`. Tambahkan `mobile/` ke `.gitignore` root hanya untuk
   artefak build native yang memang tidak di-commit (ikuti .gitignore bawaan
   `cap add android`); source proyek native tetap di-commit.

## 4. Bagian C — verifikasi (wajib, laporkan hasil nyata)

1. Repo web: `npm run typecheck` (0 error) + `npm run build` (sukses).
2. Buka web di **browser biasa** → Pengaturan Printer: opsi
   `📱 Printer Aplikasi (Bluetooth)` **TIDAK muncul**; transport lama tetap
   berfungsi (regresi visual singkat).
3. (Bila Playwright tersedia) uji UI native dengan stub:
   `page.addInitScript` men-set `window.Capacitor = { isNativePlatform: () =>
   true, Plugins: { KakarutPrinter: { list: async () => ({ devices: [...] }),
   write: async () => ({}) } } }` → opsi muncul, pilih perangkat, Cetak Tes
   memanggil `write` dengan base64 non-kosong.
4. Native: `cd mobile && npm install && npx cap sync android &&
   ./gradlew -p android assembleDebug` sukses; jalankan di HP:
   - pair printer di Pengaturan Bluetooth → buka app → login → Pengaturan
     Printer → pilih opsi native → Muat perangkat → pilih → **Cetak Tes**
     keluar dari printer;
   - transaksi kasir dengan `autoPrint` aktif → struk tercetak otomatis;
   - matikan-nyalakan printer → cetak lagi TANPA masuk pengaturan
     (auto-reconnect di `write`);
   - mode RawBT & LAN masih berfungsi seperti sebelumnya.

## 5. Kriteria penerimaan

- [ ] Opsi native muncul HANYA di dalam aplikasi; browser biasa tidak berubah.
- [ ] Cetak Tes & struk transaksi keluar di printer Bluetooth klasik ter-pair.
- [ ] Auto-print langsung aktif setelah aplikasi dibuka (tanpa tombol Hubungkan).
- [ ] Printer mati→nyala: cetak berikutnya sukses tanpa intervensi.
- [ ] Izin Android 12+ diminta dengan benar; penolakan menghasilkan pesan jelas.
- [ ] `npm run typecheck` & `npm run build` hijau; tidak ada perubahan di
      `apps/server`, `api.ts`, atau transport lama.
- [ ] `npm ci` root TIDAK menginstal dependensi Capacitor (folder `mobile/`
      di luar workspaces).
- [ ] APK debug ter-build; instruksi rilis (keystore + `assembleRelease`)
      terdokumentasi di `mobile/README.md`.

## 6. Troubleshooting (sertakan di `mobile/README.md`)

| Gejala | Penyebab umum | Solusi |
| --- | --- | --- |
| Struk huruf aneh/kotak | Printer tak dukung CP437 penuh | Teks sudah ASCII-only dari `sanitizeAscii`; coba printer lain / mode default pabrik |
| Perangkat tidak muncul di daftar | Belum di-pair / izin ditolak | Pair di Pengaturan Bluetooth; izinkan “Perangkat di sekitar” |
| Cetak pertama lambat | Connect RFCOMM ±1–3 dtk | Wajar; koneksi berikutnya cepat (socket dipertahankan) |
| Kertas tidak terpotong | Printer 58mm murah tanpa cutter | Matikan `cutEnabled` di Pengaturan Printer |
| Gagal setelah printer idle lama | Socket basi | Sudah ditangani auto-reconnect; bila masih, matikan-nyalakan printer |
| Halaman putih saat buka app | HP tidak ada internet / domain salah | Cek koneksi & nilai `APP_URL` |
