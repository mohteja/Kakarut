import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildBonBytes,
  buildOrderSlipBytes,
  buildReceiptBytes,
  buildTestPrintBytes,
  type BonData,
  type OrderSlipData,
  type ReceiptData,
  type ReceiptOptions,
} from "@kakarut/shared";
import { BluetoothTransport } from "../lib/print/bluetooth";
import { LanTransport } from "../lib/print/lan";
import { MockTransport } from "../lib/print/mock";
import { NativeBtTransport } from "../lib/print/native";
import { RawbtTransport } from "../lib/print/rawbt";
import {
  effectiveCharsPerLine,
  loadPrinterSettings,
  savePrinterSettings,
  type PrinterDeviceSettings,
  type TransportKind,
} from "../lib/print/settings";
import type { PrinterStatus, PrinterTransport } from "../lib/print/transport";
import { UsbTransport } from "../lib/print/usb";

// Singleton per jenis transport di level modul — koneksi BLE/USB bertahan
// saat berpindah halaman (context hanya menyimpan status untuk UI).
const singletons: Partial<Record<TransportKind, PrinterTransport>> = {};

function getTransport(s: PrinterDeviceSettings): PrinterTransport | null {
  switch (s.transport) {
    case "browser":
      return null;
    case "bluetooth": {
      let t = singletons.bluetooth as BluetoothTransport | undefined;
      if (!t) {
        t = new BluetoothTransport(s.chunkSize, s.chunkDelayMs);
        singletons.bluetooth = t;
      } else {
        t.setChunking(s.chunkSize, s.chunkDelayMs);
      }
      return t;
    }
    case "usb":
      return (singletons.usb ??= new UsbTransport());
    case "rawbt":
      return (singletons.rawbt ??= new RawbtTransport());
    case "lan": {
      let t = singletons.lan as LanTransport | undefined;
      if (!t) {
        t = new LanTransport(s.lanHost, s.lanPort);
        singletons.lan = t;
      } else {
        t.setTarget(s.lanHost, s.lanPort);
      }
      return t;
    }
    case "mock":
      return (singletons.mock ??= new MockTransport());
    case "native": {
      let t = singletons.native as NativeBtTransport | undefined;
      if (!t) {
        t = new NativeBtTransport(s.btAddress);
        singletons.native = t;
      } else {
        t.setAddress(s.btAddress);
      }
      return t;
    }
  }
}

interface PrinterContextValue {
  settings: PrinterDeviceSettings;
  updateSettings: (patch: Partial<PrinterDeviceSettings>) => void;
  status: PrinterStatus;
  /** transport aktif; null berarti mode "Cetak Browser" */
  transport: PrinterTransport | null;
  /** panggil dari klik tombol (Web Bluetooth/USB butuh user gesture) */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  printReceipt: (data: ReceiptData) => Promise<void>;
  /** slip pesanan (menu & jumlah saja, tanpa harga) — dapur & meja tamu */
  printOrderSlip: (data: OrderSlipData) => Promise<void>;
  /** bon tagihan (berharga, BUKAN bukti bayar) — diserahkan sebelum membayar */
  printBon: (data: BonData) => Promise<void>;
  printTest: () => Promise<void>;
  /** true bila transport thermal terpilih (bukan cetak browser) */
  isThermal: boolean;
  /** auto-print aman dijalankan tanpa gesture (BLE/USB/mock terhubung) */
  canAutoPrint: boolean;
}

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PrinterDeviceSettings>(() => loadPrinterSettings());
  const [status, setStatus] = useState<PrinterStatus>({ state: "idle" });

  const transport = useMemo(() => getTransport(settings), [settings]);

  const updateSettings = useCallback((patch: Partial<PrinterDeviceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      savePrinterSettings(next);
      return next;
    });
    if (patch.transport !== undefined) setStatus({ state: "idle" });
  }, []);

  const connect = useCallback(async () => {
    if (!transport) return;
    setStatus({ state: "connecting" });
    try {
      const { deviceName } = await transport.connect();
      updateSettings({ btDeviceName: deviceName });
      setStatus({ state: "connected", deviceName });
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }, [transport, updateSettings]);

  const disconnect = useCallback(async () => {
    await transport?.disconnect();
    setStatus({ state: "idle" });
  }, [transport]);

  const opts = useCallback(
    (): ReceiptOptions => ({
      charsPerLine: effectiveCharsPerLine(settings),
      cut: settings.cutEnabled,
      drawerKick: settings.drawerKickEnabled,
      feedLines: settings.feedLines,
    }),
    [settings],
  );

  const printBytes = useCallback(
    async (bytes: Uint8Array) => {
      if (!transport) throw new Error("Mode Cetak Browser — pakai tombol cetak browser");
      setStatus({ state: "printing" });
      try {
        await transport.write(bytes);
        setStatus(
          transport.requiresConnect
            ? { state: "connected", deviceName: settings.btDeviceName }
            : { state: "idle" },
        );
      } catch (e) {
        setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
    [transport, settings.btDeviceName],
  );

  const printReceipt = useCallback(
    (data: ReceiptData) => printBytes(buildReceiptBytes(data, opts())),
    [printBytes, opts],
  );
  const printOrderSlip = useCallback(
    (data: OrderSlipData) => printBytes(buildOrderSlipBytes(data, opts())),
    [printBytes, opts],
  );
  const printBon = useCallback(
    (data: BonData) => printBytes(buildBonBytes(data, opts())),
    [printBytes, opts],
  );
  const printTest = useCallback(
    () => printBytes(buildTestPrintBytes(opts())),
    [printBytes, opts],
  );

  const isThermal = settings.transport !== "browser";
  const canAutoPrint =
    isThermal &&
    settings.transport !== "rawbt" && // navigasi intent butuh gesture
    Boolean(transport && (!transport.requiresConnect || transport.isConnected()));

  return (
    <PrinterContext.Provider
      value={{
        settings,
        updateSettings,
        status,
        transport,
        connect,
        disconnect,
        printReceipt,
        printOrderSlip,
        printBon,
        printTest,
        isThermal,
        canAutoPrint,
      }}
    >
      {children}
    </PrinterContext.Provider>
  );
}

export function usePrinter(): PrinterContextValue {
  const ctx = useContext(PrinterContext);
  if (!ctx) throw new Error("usePrinter harus dipakai di dalam PrinterProvider");
  return ctx;
}
