import { ConnectionlessTransport } from "./transport";

/** Perangkat Bluetooth klasik yang sudah di-pair di Pengaturan Bluetooth Android. */
export interface PerangkatBt {
  name: string | null;
  address: string;
}

/** Kontrak plugin native `KakarutPrinter` (Kotlin, aplikasi Android Kakarut). */
interface KakarutPrinterPlugin {
  list(): Promise<{ devices: PerangkatBt[] }>;
  connect(opts: { address: string }): Promise<{ deviceName: string | null }>;
  disconnect(): Promise<void>;
  isConnected(): Promise<{ connected: boolean }>;
  /** data = byte ESC/POS dalam base64; plugin yang menyambung/reconnect socket */
  write(opts: { address: string; data: string }): Promise<void>;
}

declare global {
  interface Window {
    /** bridge Capacitor — hanya ada saat web dimuat di dalam aplikasi Android */
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: { KakarutPrinter?: KakarutPrinterPlugin } & Record<string, unknown>;
    };
  }
}

/** true bila web sedang berjalan di dalam aplikasi Android Kakarut (Capacitor). */
export function isNativeApp(): boolean {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

function plugin(): KakarutPrinterPlugin {
  const p = window.Capacitor?.Plugins?.KakarutPrinter;
  if (!isNativeApp() || !p) {
    throw new Error("Fitur ini hanya tersedia di aplikasi Android Kakarut");
  }
  return p;
}

/**
 * Printer Bluetooth klasik (SPP) lewat plugin native aplikasi Android.
 * Tanpa tombol Hubungkan: write() menyambung sendiri ke alamat printer
 * tersimpan (lazy connect + reconnect di sisi native), jadi auto-print
 * langsung bisa sejak aplikasi dibuka.
 */
export class NativeBtTransport extends ConnectionlessTransport {
  readonly kind = "native" as const;

  constructor(private address: string | null) {
    super();
  }

  setAddress(address: string | null) {
    this.address = address;
  }

  /** daftar printer yang sudah di-pair di Pengaturan Bluetooth Android */
  static async listPaired(): Promise<PerangkatBt[]> {
    const { devices } = await plugin().list();
    return devices;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.address) throw new Error("Pilih printer dulu di Pengaturan Printer");
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const data = btoa(bin);
    const p = plugin();
    try {
      await p.write({ address: this.address, data });
    } catch {
      // socket bisa basi (printer sempat mati/idle) — putuskan lalu coba sekali lagi
      await p.disconnect().catch(() => {});
      await p.write({ address: this.address, data });
    }
  }
}
