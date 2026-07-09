import type { PrinterDeviceSettings, TransportKind } from "./settings";

export type PrinterStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "connected"; deviceName: string | null }
  | { state: "printing" }
  | { state: "error"; message: string };

export interface PrinterTransport {
  readonly kind: TransportKind;
  /** true = perlu tombol "Hubungkan" (gesture) sebelum bisa menulis */
  readonly requiresConnect: boolean;
  /** HARUS dipanggil dari user gesture (klik) untuk bluetooth/usb */
  connect(): Promise<{ deviceName: string | null }>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  write(bytes: Uint8Array): Promise<void>;
}

/** Transport tanpa koneksi (rawbt / mock / browser-noop). */
export abstract class ConnectionlessTransport implements PrinterTransport {
  abstract readonly kind: TransportKind;
  readonly requiresConnect = false;
  async connect() {
    return { deviceName: null };
  }
  async disconnect() {}
  isConnected() {
    return true;
  }
  abstract write(bytes: Uint8Array): Promise<void>;
}
