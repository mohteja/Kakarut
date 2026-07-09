import type { PrinterTransport } from "./transport";

export function usbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/**
 * Printer thermal USB via WebUSB (kelas printer = 7).
 * Catatan Windows: driver usbprint.sys bawaan "memiliki" perangkat sehingga
 * claimInterface gagal — perlu ganti ke driver WinUSB via Zadig, ATAU pakai
 * mode "Cetak Browser" dengan driver vendor.
 */
export class UsbTransport implements PrinterTransport {
  readonly kind = "usb" as const;
  readonly requiresConnect = true;

  private device: USBDevice | null = null;
  private endpointOut: number | null = null;

  async connect(): Promise<{ deviceName: string | null }> {
    if (!usbSupported()) {
      throw new Error(
        "Browser ini tidak mendukung WebUSB. Gunakan Chrome/Edge di PC, Android (OTG), atau ChromeOS.",
      );
    }
    this.device = await navigator.usb.requestDevice({
      filters: [{ classCode: 7 }], // kelas printer
    });
    await this.open();
    return { deviceName: this.device.productName ?? null };
  }

  private async open(): Promise<void> {
    const d = this.device;
    if (!d) throw new Error("Printer USB belum dipilih");
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);

    const iface =
      d.configuration!.interfaces.find((i) =>
        i.alternates.some((a) => a.interfaceClass === 7),
      ) ??
      d.configuration!.interfaces.find((i) =>
        i.alternates.some((a) =>
          a.endpoints.some((e) => e.direction === "out" && e.type === "bulk"),
        ),
      );
    if (!iface) throw new Error("Perangkat ini tidak punya antarmuka printer");

    try {
      await d.claimInterface(iface.interfaceNumber);
    } catch (e) {
      throw new Error(
        "Gagal mengklaim antarmuka printer. Di Windows, printer perlu driver WinUSB (alat Zadig) — atau gunakan mode Cetak Browser dengan driver vendor.",
        { cause: e },
      );
    }

    const alt = iface.alternates[0];
    const ep = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (!ep) throw new Error("Endpoint tulis (bulk OUT) tidak ditemukan");
    this.endpointOut = ep.endpointNumber;
  }

  isConnected(): boolean {
    return Boolean(this.device?.opened && this.endpointOut !== null);
  }

  async disconnect(): Promise<void> {
    try {
      await this.device?.close();
    } catch {
      /* sudah tertutup */
    }
    this.device = null;
    this.endpointOut = null;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isConnected()) await this.open();
    const result = await this.device!.transferOut(this.endpointOut!, bytes.buffer as ArrayBuffer);
    if (result.status !== "ok") {
      throw new Error(`Transfer USB gagal (${result.status})`);
    }
  }
}
