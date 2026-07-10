import net from "node:net";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type AppEnv } from "../../middleware/auth";

const LanBody = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  /** byte ESC/POS dalam base64 */
  data: z.string().min(1).max(400_000),
});

/**
 * Blokir target yang jelas internal (loopback/link-local/metadata cloud) untuk
 * mengurangi risiko SSRF. Range LAN privat (192.168.x / 10.x / 172.16–31.x)
 * TETAP diizinkan karena memang itu tujuan printer jaringan.
 */
function hostTerlarang(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1") return true;
  if (h.startsWith("127.") || h.startsWith("0.")) return true;
  if (h.startsWith("169.254.")) return true; // link-local + metadata cloud
  return false;
}

const CONNECT_TIMEOUT_MS = 6000;

/** Teruskan byte ESC/POS ke printer jaringan lewat TCP (mis. port 9100). */
async function kirimKePrinter(host: string, port: number, bytes: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const ok = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const fail = (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
      socket.destroy();
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.write(bytes, (err) => {
        if (err) return fail(err);
        socket.end(); // byte terkirim ke OS → tutup dengan rapi
        ok();
      });
    });
    socket.once("timeout", () => fail(new Error("printer tidak merespons (timeout)")));
    socket.once("error", (e) => fail(e));
  });
}

/**
 * Printer LAN/jaringan: browser tidak bisa membuka TCP mentah, jadi byte
 * ESC/POS diteruskan lewat server. SERVER harus bisa menjangkau IP printer
 * (server di jaringan yang sama, atau printer punya IP publik/VPN).
 */
export const printRoutes = new Hono<AppEnv>().post(
  "/lan",
  zValidator("json", LanBody),
  async (c) => {
    const { host, port, data } = c.req.valid("json");
    if (hostTerlarang(host)) {
      throw new HTTPException(400, { message: "Alamat printer tidak diizinkan" });
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) {
      throw new HTTPException(400, { message: "Data cetak kosong/tidak valid" });
    }
    try {
      await kirimKePrinter(host, port, bytes);
    } catch (e) {
      const pesan = e instanceof Error ? e.message : String(e);
      throw new HTTPException(502, {
        message: `Gagal mencetak ke ${host}:${port} — ${pesan}. Pastikan server bisa menjangkau IP printer.`,
      });
    }
    return c.json({ ok: true });
  },
);
