import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../../src/scripts/buta-komentar";

/**
 * DAFTAR RUTE TERPASANG — SATU RUMAH.
 *
 * Pemeta ini lahir di `test/cabang-ikut-di-url.test.ts` dan sudah dibetulkan
 * dua kali di sana; ia dipindah ke sini (bukan disalin) begitu gerbang KEDUA
 * membutuhkannya. Menyalin pemeta rute akan melahirkan dua daftar yang
 * pelan-pelan berbeda — kelas yang sudah sekali menggigit repo ini, dan yang
 * `test/util/kolom-numerik.ts` juga ada untuk mencegahnya.
 *
 * Dua cacat versi pertamanya, ditulis di sini karena keduanya membuat gerbang
 * DIAM alih-alih merah — bentuk kegagalan yang paling mahal:
 *
 * 1. Ia mengambil `export const X = new Hono` PERTAMA yang terpasang lalu
 *    memakai prefiksnya untuk seluruh berkas. `modules/customer/routes.ts`
 *    mengekspor DUA Hono yang keduanya terpasang, jadi sepuluh rute
 *    `/customer/*` tercatat sebagai HANTU `/member-cari/*`. Jalur hantu lebih
 *    buruk daripada jalur yang hilang: pemanggil bisa dicocokkan ke rute yang
 *    tak pernah ada.
 * 2. Ia menuntut `= new Hono` harfiah. `produksiRoutes`/`pembelianRoutes`
 *    lahir dari PABRIK, jadi seluruh modul — 13 rute × 2 prefiks = 26 jalur —
 *    tak terlihat sama sekali.
 *
 * Sekarang tiap Hono terpasang punya WILAYAHNYA sendiri di berkas, pabrik
 * ditelusuri ke `function`-nya, dan wilayah pabrik dipetakan ke SEMUA prefiks
 * tempat ia dipasang. Jalur wajib diawali `/`: tanpa itu `c.get("auth")` ikut
 * terhitung sebagai rute.
 */
export const SRV = fileURLToPath(new URL("../../src", import.meta.url));

export function berkasKode(dir: string, ext: RegExp): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasKode(p, ext));
    else if (ext.test(nama)) keluar.push(p);
  }
  return keluar;
}

/** Isi kurung seimbang yang MULAI di `s[i]`. */
export function seimbang(s: string, i: number, buka: string, tutup: string): string {
  let dalam = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === buka) dalam += 1;
    else if (s[j] === tutup) {
      dalam -= 1;
      if (dalam === 0) return s.slice(i + 1, j);
    }
  }
  return "";
}

/**
 * Prefiks tiap modul rute, dibaca dari `app.ts` — bukan ditebak.
 *
 * Satu MODUL bisa dipasang dua kali lewat dua nama (`produksiRoutes` &
 * `pembelianRoutes` lahir dari pabrik yang sama), jadi nilainya larik.
 */
export function mount(): Map<string, string[]> {
  const app = butaKomentar(readFileSync(join(SRV, "app.ts"), "utf8"));
  const m = new Map<string, string[]>();
  for (const r of app.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
    m.set(r[2], [...(m.get(r[2]) ?? []), r[1]]);
  }
  return m;
}

export interface Rute {
  metode: string;
  /** jalur PENUH termasuk prefiks mount-nya */
  jalur: string;
  /** handler memanggil `resolveBranchId` */
  res: boolean;
  /** berkas sumber rute ini — dipakai gerbang izin untuk membaca alias lokal */
  berkas: string;
  /**
   * Isi kurung `.get("…", …)` apa adanya (tanpa komentar) — rantai
   * middleware + handler. Dari sinilah gerbang izin membaca `requireRole`,
   * dan gerbang cabang membaca `resolveBranchId`.
   */
  isi: string;
}

export function semuaRute(): Rute[] {
  const prefiks = mount();
  const keluar: Rute[] = [];
  for (const p of berkasKode(SRV, /\.ts$/)) {
    const s = butaKomentar(readFileSync(p, "utf8"));
    // Jangkar = posisi tempat sebuah Hono terpasang mulai dirakit.
    const jangkar = new Map<number, string[]>();
    for (const e of s.matchAll(/export const (\w+)\s*=\s*(new Hono|(\w+)\()/g)) {
      const pre = prefiks.get(e[1]);
      if (!pre) continue;
      let pos = e.index!;
      if (e[2] !== "new Hono") {
        const f = s.indexOf(`function ${e[3]}`);
        if (f < 0) continue;
        pos = f;
      }
      jangkar.set(pos, [...(jangkar.get(pos) ?? []), ...pre]);
    }
    if (jangkar.size === 0) continue;
    const batas = [...jangkar.keys()].sort((a, b) => a - b);
    for (const m of s.matchAll(/\.(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g)) {
      let k = -1;
      for (let x = 0; x < batas.length; x += 1) if (m.index! > batas[x]) k = x;
      if (k < 0) continue;
      const isi = seimbang(s, m.index! + 1 + m[1].length, "(", ")");
      const res = isi.includes("resolveBranchId(");
      for (const pre of jangkar.get(batas[k])!) {
        keluar.push({
          metode: m[1].toUpperCase(),
          jalur: (pre + m[2]).replace(/\/\//g, "/").replace(/\/$/, "") || "/",
          res,
          isi,
          berkas: p,
        });
      }
    }
  }
  return keluar;
}
