import { readFileSync } from "node:fs";
import { createApp } from "../app";

/**
 * CAKUPAN RUTE — rute mana yang BENAR-BENAR pernah diketuk `verify-api.sh`.
 *
 * Angka ini tak bisa didapat secara statis, dan itu terukur: mencocokkan jalur
 * yang disebut `verify-api.sh` dengan deklarasi rute di `src` menghasilkan
 * **2 dari 163**, karena hampir setiap jalur di skrip itu dirakit dari variabel
 * shell (`/bahan/$BP242/resep`). Yang dibutuhkan POLA rutenya
 * (`/api/bahan/:id/resep`), dan hanya server yang mengetahuinya.
 *
 * Pemakaian:
 *   1. jalankan server dengan `JEJAK_RUTE=/tmp/jejak.tsv`
 *   2. `bash scripts/verify-api.sh`
 *   3. `npx tsx src/scripts/cakupan-rute.ts /tmp/jejak.tsv > docs/audit/rute-diketuk.txt`
 *
 * Daftar rutenya diambil dari TABEL RUTE HONO sendiri (`app.routes`), bukan
 * dari sapuan teks: pemeta teks di repo ini sudah salah berkali-kali, dan
 * di sini tak ada alasan menebak — aplikasinya bisa ditanya langsung.
 */
export function ruteKonkret(): string[] {
  const app = createApp();
  const daftar = (app as unknown as { routes: { method: string; path: string }[] }).routes;
  const set = new Set<string>();
  for (const r of daftar) {
    // `ALL` dan jalur ber-`*` adalah middleware, bukan pintu yang bisa diketuk.
    if (r.method === "ALL" || r.path.includes("*")) continue;
    set.add(`${r.method} ${r.path}`);
  }
  return [...set].sort();
}

/** Rute yang muncul di berkas jejak (metode + POLA rute, satu per baris). */
export function ruteDiketuk(jejak: string): Set<string> {
  const keluar = new Set<string>();
  for (const baris of jejak.split("\n")) {
    const [metode, pola] = baris.split("\t");
    if (!pola || pola.includes("*")) continue;
    keluar.add(`${metode} ${pola}`);
  }
  return keluar;
}

if (process.argv[1]?.endsWith("cakupan-rute.ts")) {
  const berkas = process.argv[2];
  if (!berkas) {
    console.error("pakai: tsx src/scripts/cakupan-rute.ts <berkas-jejak>");
    process.exit(2);
  }
  const kena = ruteDiketuk(readFileSync(berkas, "utf8"));
  for (const r of ruteKonkret()) if (kena.has(r)) console.log(r);
}
