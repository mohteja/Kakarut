import { useState } from "react";
import { Card, ErrorText, PageTitle, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { usePrinter } from "../../context/PrinterContext";
import { bluetoothSupported } from "../../lib/print/bluetooth";
import { NativeBtTransport, isNativeApp, type PerangkatBt } from "../../lib/print/native";
import { usbSupported } from "../../lib/print/usb";
import type { TransportKind } from "../../lib/print/settings";

// Printer lewat plugin aplikasi Android — hanya ditawarkan saat web dibuka di
// dalam aplikasi (window.Capacitor ada). Di browser biasa opsi ini disembunyikan.
const METODE_NATIVE = {
  kind: "native" as TransportKind,
  label: "📱 Printer Aplikasi (Bluetooth)",
  keterangan:
    "Printer thermal Bluetooth klasik langsung dari aplikasi Android — tanpa RawBT. Pair dulu printernya di Pengaturan Bluetooth HP, lalu pilih di sini.",
};

const METODE: { kind: TransportKind; label: string; keterangan: string }[] = [
  {
    kind: "browser",
    label: "Cetak Browser",
    keterangan:
      "Dialog cetak biasa (window.print). Cocok bila driver printer sudah terpasang di perangkat (Windows/Android print service).",
  },
  {
    kind: "bluetooth",
    label: "Bluetooth (BLE)",
    keterangan:
      "Printer thermal Bluetooth Low Energy — umum untuk printer 58mm murah (EPPOS, Panda, ZJ-58xx, Xprinter). Chrome/Edge di Android atau PC; butuh HTTPS.",
  },
  {
    kind: "usb",
    label: "USB (WebUSB)",
    keterangan:
      "Printer thermal USB langsung dari browser. Chrome/Edge di PC, Android (kabel OTG), atau ChromeOS.",
  },
  {
    kind: "rawbt",
    label: "Aplikasi RawBT (Android)",
    keterangan:
      "Untuk printer Bluetooth klasik (bukan BLE) di Android — struk dikirim ke aplikasi RawBT yang meneruskan ke printer. Pasang dari Play Store.",
  },
  {
    kind: "lan",
    label: "LAN / Jaringan (IP)",
    keterangan:
      "Printer thermal jaringan (ESC/POS via TCP, umumnya port 9100). Struk dikirim lewat server — SERVER harus bisa menjangkau IP printer (server di jaringan yang sama, atau printer punya IP publik/VPN). Untuk printer lokal saja dengan aplikasi di cloud, gunakan RawBT.",
  },
];

function StatusBadge() {
  const { status } = usePrinter();
  const map: Record<string, { text: string; cls: string }> = {
    idle: { text: "Belum terhubung", cls: "bg-stone-100 text-stone-600" },
    connecting: { text: "Menghubungkan…", cls: "bg-yellow-100 text-yellow-800" },
    connected: { text: "Terhubung", cls: "bg-green-100 text-green-800" },
    printing: { text: "Mencetak…", cls: "bg-blue-100 text-blue-800" },
    error: { text: "Gagal", cls: "bg-red-100 text-red-700" },
  };
  const m = map[status.state];
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${m.cls}`}>
      {m.text}
      {status.state === "connected" && status.deviceName ? ` · ${status.deviceName}` : ""}
    </span>
  );
}

export function PrinterPage() {
  const { settings, updateSettings, status, transport, connect, disconnect, printTest } =
    usePrinter();
  const [error, setError] = useState<unknown>(null);
  const [lanjutan, setLanjutan] = useState(false);
  /** daftar printer ter-pair dari plugin aplikasi; null = belum dimuat */
  const [perangkat, setPerangkat] = useState<PerangkatBt[] | null>(null);

  async function aksi(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  }

  const diAplikasi = isNativeApp();
  // opsi native paling atas (direkomendasikan) saat berjalan di dalam aplikasi
  const metodeTampil = diAplikasi ? [METODE_NATIVE, ...METODE] : METODE;

  async function muatPerangkat() {
    setPerangkat(await NativeBtTransport.listPaired());
  }

  const perluHubungkan = transport?.requiresConnect ?? false;
  const terhubung = status.state === "connected" || status.state === "printing";

  return (
    <div className="max-w-2xl">
      <PageTitle>Pengaturan Printer</PageTitle>
      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Pengaturan ini tersimpan di <b>perangkat ini saja</b> — atur di setiap kasir/tablet
        yang dipakai untuk mencetak.
      </div>

      <Card className="space-y-4 p-5">
        <div>
          <div className="mb-2 text-sm font-semibold text-stone-700">Metode cetak</div>
          <div className="space-y-2">
            {metodeTampil.map((m) => (
              <label
                key={m.kind}
                className={`block cursor-pointer rounded-lg border p-3 ${
                  settings.transport === m.kind
                    ? "border-orange-500 bg-orange-50"
                    : "border-stone-200 hover:border-stone-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="metode"
                    checked={settings.transport === m.kind}
                    onChange={() => updateSettings({ transport: m.kind })}
                  />
                  <span className="font-medium">{m.label}</span>
                  {m.kind === "native" && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                      Direkomendasikan
                    </span>
                  )}
                  {m.kind === "bluetooth" && !bluetoothSupported() && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      tidak didukung browser ini
                    </span>
                  )}
                  {m.kind === "usb" && !usbSupported() && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      tidak didukung browser ini
                    </span>
                  )}
                </div>
                <div className="mt-1 pl-6 text-xs text-stone-500">{m.keterangan}</div>
              </label>
            ))}
          </div>
          {settings.transport === "bluetooth" && !bluetoothSupported() && (
            <div className="mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              Web Bluetooth tidak tersedia di browser ini. Gunakan Chrome/Edge (Android/PC).
              Di iPhone/iPad, gunakan aplikasi browser <b>Bluefy</b>.
            </div>
          )}
          {settings.transport === "usb" && (
            <div className="mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              Catatan Windows: bila gagal terhubung, printer perlu driver WinUSB (alat{" "}
              <b>Zadig</b>) — atau gunakan metode Cetak Browser dengan driver vendor.
            </div>
          )}
        </div>

        {settings.transport === "lan" && (
          <div className="space-y-3 border-t border-stone-100 pt-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">IP / Host printer</label>
                <input
                  value={settings.lanHost}
                  onChange={(e) => updateSettings({ lanHost: e.target.value.trim() })}
                  className={inputClass}
                  placeholder="mis. 192.168.1.50"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={settings.lanPort}
                  onChange={(e) => updateSettings({ lanPort: Number(e.target.value) || 9100 })}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              Struk dikirim lewat <b>server</b> ke IP printer. Pastikan <b>server bisa menjangkau IP
              ini</b> — cocok bila server di jaringan yang sama, atau printer punya IP publik/VPN.
              Jika aplikasi diakses dari cloud sementara printer hanya di jaringan lokal toko,
              gunakan <b>RawBT</b>.
            </div>
          </div>
        )}

        {settings.transport === "native" && (
          <div className="space-y-3 border-t border-stone-100 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => void aksi(muatPerangkat)} className={btnSecondary}>
                🔄 Muat perangkat ter-pair
              </button>
              {settings.btAddress && (
                <span className="text-sm text-stone-600">
                  Terpilih: <b>{settings.btDeviceName ?? settings.btAddress}</b>
                </span>
              )}
            </div>
            {perangkat !== null &&
              (perangkat.length > 0 ? (
                <div>
                  <label className="mb-1 block text-sm font-medium">Pilih printer</label>
                  <select
                    value={settings.btAddress ?? ""}
                    onChange={(e) => {
                      const d = perangkat.find((p) => p.address === e.target.value);
                      if (d) {
                        updateSettings({ btAddress: d.address, btDeviceName: d.name ?? d.address });
                      }
                    }}
                    className={inputClass}
                    aria-label="Pilih printer Bluetooth ter-pair"
                  >
                    <option value="">— pilih printer —</option>
                    {perangkat.map((p) => (
                      <option key={p.address} value={p.address}>
                        {p.name ?? "Tanpa nama"} ({p.address})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  Tidak ada perangkat ter-pair. Pair printernya dulu di{" "}
                  <b>Pengaturan Bluetooth Android</b>, lalu muat ulang daftar ini.
                </div>
              ))}
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Tanpa tombol Hubungkan — aplikasi menyambung sendiri setiap mencetak, dan
              menyambung ulang otomatis bila printer sempat mati. Cetak otomatis langsung aktif.
            </div>
          </div>
        )}

        {settings.transport !== "browser" && (
          <>
            <div className="grid grid-cols-2 gap-4 border-t border-stone-100 pt-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Lebar kertas</label>
                <select
                  value={settings.paperWidth}
                  onChange={(e) =>
                    updateSettings({
                      paperWidth: Number(e.target.value) as 58 | 80,
                      cutEnabled: Number(e.target.value) === 80,
                    })
                  }
                  className={inputClass}
                >
                  <option value={58}>58 mm (32 kolom)</option>
                  <option value={80}>80 mm (48 kolom)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Karakter per baris</label>
                <input
                  type="number"
                  min={20}
                  max={64}
                  placeholder="otomatis"
                  value={settings.charsPerLine ?? ""}
                  onChange={(e) =>
                    updateSettings({
                      charsPerLine: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className={inputClass}
                />
                <div className="mt-1 text-xs text-stone-400">
                  Kosongkan untuk otomatis. Cek dengan Cetak Tes.
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-stone-100 pt-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.autoPrint}
                  onChange={(e) => updateSettings({ autoPrint: e.target.checked })}
                  disabled={settings.transport === "rawbt"}
                />
                Cetak otomatis setelah pembayaran
                {settings.transport === "rawbt" && (
                  <span className="text-xs text-stone-400">
                    (tidak tersedia untuk RawBT — cetak lewat tombol di struk)
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.cutEnabled}
                  onChange={(e) => updateSettings({ cutEnabled: e.target.checked })}
                />
                Potong kertas otomatis (printer dengan auto-cutter — umumnya 80mm)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.drawerKickEnabled}
                  onChange={(e) => updateSettings({ drawerKickEnabled: e.target.checked })}
                />
                Buka laci kas saat mencetak (printer dengan port RJ11)
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
              {perluHubungkan &&
                (terhubung ? (
                  <button onClick={() => void aksi(disconnect)} className={btnSecondary}>
                    Putuskan
                  </button>
                ) : (
                  <button onClick={() => void aksi(connect)} className={btnPrimary}>
                    🔗 Hubungkan Printer
                  </button>
                ))}
              <button
                onClick={() => void aksi(printTest)}
                className={perluHubungkan ? btnSecondary : btnPrimary}
                disabled={
                  status.state === "printing" ||
                  (perluHubungkan && !terhubung) ||
                  (settings.transport === "lan" && !settings.lanHost) ||
                  (settings.transport === "native" && !settings.btAddress)
                }
              >
                🖨 Cetak Tes
              </button>
              <StatusBadge />
            </div>
            {status.state === "error" && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {status.message}
              </div>
            )}
            <ErrorText error={error} />

            <div className="border-t border-stone-100 pt-3">
              <button
                onClick={() => setLanjutan(!lanjutan)}
                className="text-sm font-medium text-stone-500 hover:text-stone-700"
              >
                {lanjutan ? "▾" : "▸"} Pengaturan lanjutan
              </button>
              {lanjutan && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Baris feed akhir</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={settings.feedLines}
                      onChange={(e) => updateSettings({ feedLines: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Ukuran chunk BLE (byte)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={512}
                      value={settings.chunkSize}
                      onChange={(e) => updateSettings({ chunkSize: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Jeda chunk (ms)</label>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={settings.chunkDelayMs}
                      onChange={(e) =>
                        updateSettings({ chunkDelayMs: Number(e.target.value) })
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="col-span-3 text-xs text-stone-400">
                    Bila hasil cetak terpotong-potong/berhenti, kecilkan ukuran chunk atau
                    perbesar jeda.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
