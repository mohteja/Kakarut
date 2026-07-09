import type { PrinterTransport } from "./transport";

/**
 * Printer thermal Bluetooth Low Energy (BLE) via Web Bluetooth.
 * Printer murah (ZJ-58xx, Xprinter, EPPOS, Panda, MPT-II) umumnya memakai
 * service 18F0/2AF1; merek besar (Epson TM-P, Star SM-L) memakai UART ISSC.
 * Kita minta perangkat dengan acceptAllDevices (banyak printer tidak
 * meng-advertise service-nya) lalu coba pasangan service/characteristic
 * yang dikenal satu per satu.
 */
const KNOWN_PAIRS: { service: string; characteristic: string }[] = [
  // generik Cina (paling umum di Indonesia)
  { service: "000018f0-0000-1000-8000-00805f9b34fb", characteristic: "00002af1-0000-1000-8000-00805f9b34fb" },
  // ISSC/Microchip transparent UART (Epson TM-P20II, Star SM-L200)
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", characteristic: "49535343-8841-43f4-a8d4-ecbe34729bb3" },
  // modul HM-10 dkk
  { service: "0000ffe0-0000-1000-8000-00805f9b34fb", characteristic: "0000ffe1-0000-1000-8000-00805f9b34fb" },
  { service: "0000fff0-0000-1000-8000-00805f9b34fb", characteristic: "0000fff2-0000-1000-8000-00805f9b34fb" },
  // emulasi SPP-over-BLE
  { service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2", characteristic: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f" },
];

export function bluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export class BluetoothTransport implements PrinterTransport {
  readonly kind = "bluetooth" as const;
  readonly requiresConnect = true;

  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  constructor(
    private chunkSize: number,
    private chunkDelayMs: number,
  ) {}

  setChunking(chunkSize: number, chunkDelayMs: number) {
    this.chunkSize = chunkSize;
    this.chunkDelayMs = chunkDelayMs;
  }

  async connect(): Promise<{ deviceName: string | null }> {
    if (!bluetoothSupported()) {
      throw new Error(
        "Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge di Android atau PC. Di iPhone, gunakan aplikasi browser Bluefy.",
      );
    }
    // acceptAllDevices: printer murah sering tidak meng-advertise service-nya
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_PAIRS.map((p) => p.service),
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.characteristic = null;
    });
    await this.ensureCharacteristic();
    return { deviceName: this.device.name ?? null };
  }

  private async ensureCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
    if (this.characteristic && this.device?.gatt?.connected) return this.characteristic;
    if (!this.device?.gatt) throw new Error("Printer belum dihubungkan");

    const server = await this.device.gatt.connect();

    // coba pasangan yang dikenal dulu
    for (const pair of KNOWN_PAIRS) {
      try {
        const service = await server.getPrimaryService(pair.service);
        const ch = await service.getCharacteristic(pair.characteristic);
        if (ch.properties.write || ch.properties.writeWithoutResponse) {
          this.characteristic = ch;
          return ch;
        }
      } catch {
        /* service/characteristic tidak ada — coba berikutnya */
      }
    }
    // fallback: cari characteristic apa pun yang bisa ditulis
    try {
      const services = await server.getPrimaryServices();
      for (const service of services) {
        const chars = await service.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            this.characteristic = ch;
            return ch;
          }
        }
      }
    } catch {
      /* jatuh ke error di bawah */
    }
    throw new Error(
      "Tidak menemukan jalur tulis pada perangkat ini — pastikan yang dipilih adalah printer thermal BLE",
    );
  }

  isConnected(): boolean {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
  }

  async disconnect(): Promise<void> {
    this.device?.gatt?.disconnect();
    this.characteristic = null;
    this.device = null;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const ch = await this.ensureCharacteristic();
    const useWithResponse = ch.properties.write;
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      const chunk = bytes.slice(i, i + this.chunkSize);
      if (useWithResponse) {
        // flow control implisit — tidak perlu delay
        await ch.writeValueWithResponse(chunk);
      } else {
        await ch.writeValueWithoutResponse(chunk);
        if (this.chunkDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.chunkDelayMs));
        }
      }
    }
  }
}
