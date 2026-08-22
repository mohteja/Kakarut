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
 * Buang isi komentar, pertahankan posisi baris.
 *
 * DIEKSPOR supaya bisa diuji sungguhan. Versi pertama penjaga pembangkit ini
 * mencoba membuktikan pengupas ini perlu dengan menghitung nilai
 * `supply_beli_status` — dan tetap HIJAU saat pengupasnya dicabut, karena
 * nilai yang dikutip komentarnya kebetulan juga nilai yang sah, jadi `Set`
 * melipatnya. Asersi itu tak bisa gagal. Yang sekarang diuji sifatnya
 * langsung, dengan masukan yang memang memancingnya.
 */
export function butaKomentar(s: string): string {
  const out = s.split("");
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("/*", i)) {
      let j = s.indexOf("*/", i + 2);
      j = j < 0 ? s.length : j + 2;
      for (let k = i; k < j; k += 1) if (out[k] !== "\n") out[k] = " ";
      i = j;
    } else if (s.startsWith("//", i)) {
      let j = s.indexOf("\n", i);
      j = j < 0 ? s.length : j;
      for (let k = i; k < j; k += 1) out[k] = " ";
      i = j;
    } else i += 1;
  }
  return out.join("");
}

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
