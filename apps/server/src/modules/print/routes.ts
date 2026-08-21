import dns from "node:dns/promises";
import net from "node:net";
import { zValidator } from "../../lib/validator";
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

/** Normalisasi IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1) + lowercase. */
export function normalisasiIp(ip: string): string {
  const low = ip.toLowerCase().replace(/%.*$/, ""); // buang zone-id IPv6
  const m = low.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return m ? m[1] : low;
}

/**
 * Apakah IP hasil resolve termasuk target INTERNAL yang dilarang (mitigasi SSRF)?
 * Loopback, "this-network", link-local + metadata cloud, dan unspecified DITOLAK.
 * Range LAN privat IPv4 (10/8, 172.16–31, 192.168/16) & ULA IPv6 (fc00::/7) tetap
 * DIIZINKAN — memang di situlah printer jaringan berada.
 */
export function ipInternal(ipRaw: string): boolean {
  const ip = normalisasiIp(ipRaw);
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 0) return true; // "this" network 0.0.0.0/8 (0.0.0.0 → localhost)
    if (a === 169 && b === 254) return true; // link-local + metadata cloud 169.254.0.0/16
    return false; // LAN privat & IP publik → diizinkan
  }
  if (v === 6) {
    if (ip === "::1" || ip === "::") return true; // loopback / unspecified
    if (ip.startsWith("fe80")) return true; // link-local fe80::/10
    if (ip === "fd00:ec2::254") return true; // metadata AWS via IPv6
    return false;
  }
  return false; // bukan IP literal (seharusnya tak terjadi setelah resolve)
}

/**
 * Resolusi host printer ke IP yang AMAN. Semua alamat hasil resolve diperiksa;
 * bila SATU saja internal → tolak (mencegah host yang menunjuk balik ke dalam).
 * Mengembalikan IP hasil resolve untuk DIPIN saat connect → menutup celah
 * DNS-rebinding (host di-resolve sekali, koneksi memakai IP itu, bukan re-resolve).
 *
 * Bentuk angka aneh (desimal `2130706433`, heksa `0x7f000001`, `127.1`) ikut
 * ternormalisasi oleh getaddrinfo menjadi IP kanonik, lalu tersaring di sini.
 */
export async function resolveHostPrinter(host: string): Promise<string> {
  const h = host.replace(/^\[|\]$/g, ""); // buang kurung siku IPv6 literal
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(h, { all: true });
  } catch {
    throw new HTTPException(400, {
      message: "Alamat printer tidak dapat di-resolve — periksa host/DNS.",
    });
  }
  if (addrs.length === 0) {
    throw new HTTPException(400, { message: "Alamat printer tidak dapat di-resolve." });
  }
  for (const a of addrs) {
    if (ipInternal(a.address)) {
      throw new HTTPException(400, { message: "Alamat printer tidak diizinkan (internal)" });
    }
  }
  return addrs[0].address;
}

const CONNECT_TIMEOUT_MS = 6000;

/** Teruskan byte ESC/POS ke printer jaringan lewat TCP (mis. port 9100). */
async function kirimKePrinter(ip: string, port: number, bytes: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: ip, port });
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
    // Resolve + saring target internal LEBIH DULU, lalu pin IP hasil resolve
    // saat connect (bukan re-resolve host) → menutup celah DNS-rebinding.
    const ip = await resolveHostPrinter(host);
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) {
      throw new HTTPException(400, { message: "Data cetak kosong/tidak valid" });
    }
    try {
      await kirimKePrinter(ip, port, bytes);
    } catch (e) {
      const pesan = e instanceof Error ? e.message : String(e);
      throw new HTTPException(502, {
        message: `Gagal mencetak ke ${host}:${port} — ${pesan}. Pastikan server bisa menjangkau IP printer.`,
      });
    }
    return c.json({ ok: true });
  },
);
