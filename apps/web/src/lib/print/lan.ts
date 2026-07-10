import { api } from "../api";
import { ConnectionlessTransport } from "./transport";

/**
 * Printer LAN/jaringan (ESC/POS lewat TCP, umumnya port 9100). Browser tidak
 * bisa membuka TCP mentah, jadi byte diteruskan lewat server (POST /print/lan)
 * yang menyambung ke IP printer. SERVER harus bisa menjangkau IP printer.
 */
export class LanTransport extends ConnectionlessTransport {
  readonly kind = "lan" as const;

  constructor(
    private host: string,
    private port: number,
  ) {
    super();
  }

  setTarget(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.host) throw new Error("Isi IP printer dulu di Pengaturan Printer");
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    await api("/print/lan", {
      method: "POST",
      body: { host: this.host, port: this.port, data: b64 },
    });
  }
}
