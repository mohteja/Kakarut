import { kolomDefault } from "@kakarut/shared";

export type TransportKind =
  | "browser"
  | "bluetooth"
  | "usb"
  | "rawbt"
  | "lan"
  | "mock"
  | "native";

/** Setelan printer per PERANGKAT (localStorage) — bukan per perusahaan. */
export interface PrinterDeviceSettings {
  v: 1;
  transport: TransportKind;
  paperWidth: 58 | 80;
  /** null = otomatis (32 utk 58mm, 48 utk 80mm) */
  charsPerLine: number | null;
  /** cetak otomatis setelah pembayaran (hanya efektif utk bluetooth/usb) */
  autoPrint: boolean;
  cutEnabled: boolean;
  drawerKickEnabled: boolean;
  feedLines: number;
  /** nama perangkat BLE terakhir (tampilan saja) */
  btDeviceName: string | null;
  /** lanjutan: ukuran potongan tulis BLE */
  chunkSize: number;
  chunkDelayMs: number;
  /** printer LAN/jaringan: IP/host + port (ESC/POS TCP, umumnya 9100) */
  lanHost: string;
  lanPort: number;
  /** printer aplikasi Android: alamat MAC printer Bluetooth klasik ter-pair */
  btAddress: string | null;
}

const STORAGE_KEY = "kakarut.printer";

export const DEFAULT_PRINTER_SETTINGS: PrinterDeviceSettings = {
  v: 1,
  transport: "browser",
  paperWidth: 58,
  charsPerLine: null,
  autoPrint: false,
  cutEnabled: false,
  drawerKickEnabled: false,
  feedLines: 3,
  btDeviceName: null,
  chunkSize: 100,
  chunkDelayMs: 20,
  lanHost: "",
  lanPort: 9100,
  btAddress: null,
};

export function loadPrinterSettings(): PrinterDeviceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PrinterDeviceSettings>;
    if (parsed.v !== 1) return DEFAULT_PRINTER_SETTINGS;
    return { ...DEFAULT_PRINTER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export function savePrinterSettings(s: PrinterDeviceSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function effectiveCharsPerLine(s: PrinterDeviceSettings): number {
  return s.charsPerLine && s.charsPerLine > 0 ? s.charsPerLine : kolomDefault(s.paperWidth);
}
