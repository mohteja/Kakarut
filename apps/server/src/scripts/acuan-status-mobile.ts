/**
 * Hasilkan fikstur KONTRAK NILAI STATUS untuk uji cermin di `kakarut-mobile`.
 *
 * Dart tak bisa mengimpor tipe TypeScript, jadi tiap `status == 'dikerjakan'`
 * di ponsel adalah SALINAN nilai kontrak dalam bentuk teks — dan salinan yang
 * menyimpang tak berbunyi apa-apa. Cabangnya cuma tak pernah benar, selamanya:
 * tak ada galat, tak ada warna merah, hanya satu tombol yang diam.
 *
 * Kembaran `acuan:uang-mobile`, dan alasannya sama persis: yang membuat salinan
 * bisa dipercaya bukan pembacaan berulang, melainkan jawabannya DIADU dengan
 * yang asli.
 *
 * Berkas keluarannya — `test/fikstur/status-kontrak-server.txt` di repo mobile
 * — DIHASILKAN dari sini, bukan diketik ulang:
 *
 *     npm run --silent acuan:status-mobile -w @kakarut/server > \
 *       ../kakarut-mobile/test/fikstur/status-kontrak-server.txt
 *
 * TIGA SUMBER, karena satu saja tak cukup — dan itu terukur, bukan dugaan:
 * sapuan pertama vena ini hanya memungut `pgEnum` (78 nilai) dan langsung
 * menuduh DUA BELAS literal Dart yang semuanya sah, karena nilai seperti
 * `"persen"`/`"nominal"` (diskon), `"open_bill"` (jenis pesanan), dan
 * `"sedang_diproses"` (sebab galat) memang tak pernah jadi enum Postgres.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const SHARED = fileURLToPath(new URL("../../../../packages/shared/src", import.meta.url));

/**
 * Pengupas komentar dipakai ulang dari rumah tunggalnya, dan DIEKSPOR ULANG
 * supaya `status-satu-kontrak.test.ts` tetap bisa mengujinya lewat berkas ini.
 *
 * Dulu berkas ini punya salinannya sendiri — salah satu dari tujuh salinan yang
 * semuanya membaca `/*` di dalam string literal sebagai pembuka komentar.
 * Alasannya ditulis lengkap di `buta-komentar.ts`.
 */
import { butaKomentar } from "./buta-komentar";

export { butaKomentar };

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Kumpulkan seluruh nilai kontrak. Dipisah jadi fungsi supaya bisa diuji. */
export function kumpulkanKontrak(): string[] {
const nilai = new Map<string, Set<string>>();
const catat = (sumber: string, v: string) => {
  if (!nilai.has(sumber)) nilai.set(sumber, new Set());
  nilai.get(sumber)!.add(v);
};

// 1) enum Postgres — `pgEnum("nama", [...])`.
//
// Komentarnya WAJIB dibuang lebih dulu: komentar di dalam badan
// `supplyBeliStatusEnum` mengutip `"diproses"` untuk menjelaskan paritasnya,
// dan versi pertama skrip ini memungutnya sebagai nilai enum KELIMA yang tak
// pernah ada di Postgres mana pun.
{
  const s = butaKomentar(readFileSync(join(SRC, "db/schema.ts"), "utf8"));
  for (const m of s.matchAll(/pgEnum\(\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/g)) {
    for (const v of m[2].matchAll(/"([^"]+)"/g)) catat(`enum:${m[1]}`, v[1]);
  }
}

// 2) `z.enum([...])` di rute, plus `kode`/`sebab` — kontrak yang dibaca MESIN,
//    bukan teks pesan yang boleh berubah kapan saja.
for (const p of berkasTs(SRC)) {
  const s = butaKomentar(readFileSync(p, "utf8"));
  for (const m of s.matchAll(/z\.enum\(\s*\[([^\]]*)\]/g)) {
    for (const v of m[1].matchAll(/"([^"]+)"/g)) catat("zod", v[1]);
  }
  for (const m of s.matchAll(/(?:kode|sebab):\s*"([^"]+)"/g)) catat("kode", m[1]);
}

// 3) union literal bernama di `packages/shared` — kontrak yang dilihat klien.
for (const p of berkasTs(SHARED)) {
  const s = butaKomentar(readFileSync(p, "utf8"));
  for (const m of s.matchAll(/export type (\w+)\s*=\s*((?:\s*\|?\s*"[\w-]+")+)\s*;/g)) {
    const vs = [...m[2].matchAll(/"([\w-]+)"/g)].map((x) => x[1]);
    if (vs.length >= 2) for (const v of vs) catat(`union:${m[1]}`, v);
  }
}

const baris: string[] = [];
for (const sumber of [...nilai.keys()].sort()) {
  for (const v of [...nilai.get(sumber)!].sort()) baris.push(`${sumber}|${v}`);
}
return baris;
}

// Dijalankan sebagai program (bukan diimpor uji) → cetak fiksturnya.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  process.stdout.write(kumpulkanKontrak().join("\n") + "\n");
}
