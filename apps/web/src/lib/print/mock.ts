import { ConnectionlessTransport } from "./transport";

declare global {
  interface Window {
    /** rekaman byte untuk e2e test (transport "mock") */
    __kakarutPrintCapture?: number[][];
  }
}

/**
 * Transport palsu untuk pengujian e2e — tidak muncul di UI; aktif hanya bila
 * localStorage kakarut.printer di-seed dengan transport "mock".
 */
export class MockTransport extends ConnectionlessTransport {
  readonly kind = "mock" as const;

  async write(bytes: Uint8Array): Promise<void> {
    window.__kakarutPrintCapture ??= [];
    window.__kakarutPrintCapture.push([...bytes]);
  }
}
