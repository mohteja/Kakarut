import { ConnectionlessTransport } from "./transport";

/**
 * Cetak lewat aplikasi Android RawBT (ru.a402d.rawbtprinter) — populer untuk
 * printer thermal Bluetooth klasik (SPP, bukan BLE). Byte ESC/POS dikirim
 * sebagai URL intent base64; Chrome Android membuka aplikasinya (atau
 * halaman Play Store bila belum terpasang).
 *
 * Catatan: navigasi skema kustom butuh user gesture → tidak dipakai untuk
 * auto-print, hanya tombol "Cetak Thermal".
 */
export class RawbtTransport extends ConnectionlessTransport {
  readonly kind = "rawbt" as const;

  async write(bytes: Uint8Array): Promise<void> {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    const url = `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
