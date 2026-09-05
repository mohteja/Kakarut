import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PENGURAI SUMBER untuk uji "DTO di shared == bentuk yang dibangun server":
 * kunci tingkat-1 sebuah objek literal, dan medan sebuah interface di
 * `packages/shared/src/types.ts`. Lahir di `stok-masuk-row-utuh.test.ts`
 * (2026-09-05), dipindah ke sini saat `sesi-cabang-dto-utuh.test.ts` memakai
 * keduanya — mengimpor dari berkas `.test.ts` membuat uji itu terdaftar dua kali.
 * Buta komentar: kunci di dalam komentar TIDAK ikut (dibuktikan PASANGAN di
 * kedua uji pemakainya).
 */
/** Kunci tingkat-1 sebuah objek literal, mulai dari `{` di posisi `awal`. */
export function kunciObjek(src: string, awal: number): string[] {
  const keluar: string[] = [];
  let d = 0;
  let i = awal;
  let mulaiBaris = -1;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{" || c === "(" || c === "[") {
      d += 1;
      if (d === 1) mulaiBaris = i + 1;
    } else if (c === "}" || c === ")" || c === "]") {
      d -= 1;
      if (d === 0) break;
    } else if (c === "\n" && d === 1) {
      mulaiBaris = i + 1;
    } else if (d === 1 && mulaiBaris >= 0) {
      // awal sebuah properti: `nama:` di kedalaman 1
      const m = /^\s*(\w+)\s*:/.exec(src.slice(mulaiBaris, i + 1));
      if (m && src[i] === ":") {
        keluar.push(m[1]);
        mulaiBaris = -1;
      }
    }
  }
  return keluar;
}

/** Medan sebuah interface di types.ts. */
export function medanInterface(src: string, nama: string): string[] {
  const buta = butaKomentar(src);
  const m = new RegExp(`export interface ${nama}(?:\\s+extends\\s+[\\w, ]+)?\\s*\\{`).exec(buta);
  if (!m) throw new Error(`interface ${nama} tak ditemukan`);
  const awal = m.index + m[0].length - 1;
  let d = 0;
  let i = awal;
  for (; i < buta.length; i += 1) {
    if (buta[i] === "{") d += 1;
    else if (buta[i] === "}") {
      d -= 1;
      if (d === 0) break;
    }
  }
  return [...buta.slice(awal, i).matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]).sort();
}

