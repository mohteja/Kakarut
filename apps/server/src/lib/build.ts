import { createHash } from "node:crypto";

/**
 * ID build frontend = hash isi index.html hasil build. Berubah tiap deploy web
 * baru (index.html merujuk bundel ber-hash baru), tetap sama untuk perubahan
 * server saja. Dipakai mendeteksi "ada pembaruan" di sisi klien: tab yang
 * memuat build lama membandingkan dgn build server → tawarkan muat ulang.
 *
 * Nilai disetel sekali saat boot (index.ts) setelah index.html dibaca; null di
 * dev/uji tanpa dist (klien tak akan menawarkan pembaruan).
 */
let current: string | null = null;

export function computeBuildId(html: string): string {
  return createHash("sha1").update(html).digest("hex").slice(0, 12);
}

export function setBuildId(id: string | null): void {
  current = id;
}

export function getBuildId(): string | null {
  return current;
}
