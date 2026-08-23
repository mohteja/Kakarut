/**
 * PENGUPAS KOMENTAR — satu rumah, dipakai enam penyapu.
 *
 * Banyak penjaga di repo ini bekerja dengan menyapu teks sumber dan mencocokkan
 * pola. Semuanya harus membaca KODE saja: komentar yang mengutip bentuk yang
 * benar membuat asersi tak bisa gagal, dan komentar yang mengutip bentuk yang
 * salah membuat penjaga menuduh prosa. Karena nomor baris ikut dilaporkan,
 * pengupasnya WAJIB mempertahankan posisi — komentar diganti spasi, `\n`
 * dibiarkan utuh, panjang teks tak berubah sama sekali.
 *
 * KENAPA BERKAS INI ADA, alih-alih enam salinan kecil seperti sebelumnya:
 * salinan itu semuanya memakai versi naif yang menilai `/` sebelum tahu ia ada
 * di mana. Satu baris di `app.ts` cukup untuk membutakannya:
 *
 *     .use("/admin/*", requireAuth, requireSuperAdmin)
 *
 * `/*` di dalam STRING LITERAL dibaca sebagai pembuka komentar blok, dan sisa
 * berkas — 12.363 aksara, termasuk seluruh tabel `.route(...)` — ikut terhapus;
 * 4.167 aksara di antaranya kode yang seharusnya terbaca.
 * Sapuan pertama vena "pemilihan cabang" hanya melihat 19 dari 263 rute karena
 * itu, dan tetap melaporkan angkanya seolah lengkap.
 *
 * Versi antara yang cuma melewati string literal masih salah dengan cara lain:
 * `/[",\n]/` adalah REGEX, dan `"` di dalamnya membuka string palsu yang
 * menelan komentar dokumentasi di bawahnya (`apps/web/src/lib/bahanCsv.ts:36`).
 * Kebutaan berubah jadi tuduhan palsu — pertukaran yang lebih buruk, karena
 * penjaga yang salah tuduh mengajari orang mengabaikannya.
 *
 * Maka berkas ini melewati keempat kategori leksikal sekaligus sebelum menilai
 * pembuka komentar: string `'`/`"`, template `` ` `` (berikut `${…}` yang
 * isinya kode lagi), dan literal regex.
 *
 * YANG TIDAK DIJANJIKAN: ini pemindai leksikal, bukan pengurai TypeScript.
 * Pembedaan regex-vs-bagi memakai token bermakna sebelumnya, jadi `}` yang
 * mengakhiri blok lalu diikuti `/` tetap ambigu — kasus yang tak ada di repo
 * ini. Diukur atas seluruh pohon (`apps/server/src`, `apps/web/src`,
 * `packages/shared/src`): nol komentar yang lolos, panjang & jumlah baris utuh
 * di ketiga akar.
 */

/** Kata kunci yang boleh diikuti literal regex (`return /x/`, `case /x/`). */
const KATA_KUNCI = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "yield",
  "await",
  "instanceof",
  "throw",
]);

/** Tanda baca yang boleh diikuti literal regex — sesudahnya pasti EKSPRESI. */
const TANDA_SEBELUM = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

function tokenBermaknaSebelum(s: string, i: number): number {
  let j = i - 1;
  while (j >= 0 && (s[j] === " " || s[j] === "\t" || s[j] === "\n" || s[j] === "\r")) j -= 1;
  return j;
}

/**
 * `/` di posisi `i` membuka regex atau membagi?
 *
 * Aturan yang dipakai semua pemindai JS: lihat token bermakna sebelumnya. Kalau
 * ia mengakhiri sebuah NILAI (identifier, angka, `)`, `]`), maka `/` adalah
 * pembagian; selain itu posisinya menuntut ekspresi, jadi `/` membuka regex.
 */
function regexBoleh(s: string, i: number): boolean {
  const j = tokenBermaknaSebelum(s, i);
  if (j < 0) return true;
  const c = s[j];
  if (TANDA_SEBELUM.has(c)) return true;
  if (/[\w$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(s[k])) k -= 1;
    return KATA_KUNCI.has(s.slice(k + 1, j + 1));
  }
  return false;
}

/**
 * Lewati satu string/template mulai dari kutipnya. Memulangkan indeks SESUDAH
 * penutupnya.
 *
 * String satu-kutip berhenti di `\n` walau tak tertutup: dengan begitu kutip
 * ganjil (mis. apostrof di teks JSX) paling jauh membutakan SATU baris, tak
 * pernah sisa berkas. Batas kerusakan itu disengaja.
 *
 * `${` di dalam template memulangkan kendali ke pemindai kode — isinya kode
 * biasa, lengkap dengan string, regex, dan komentar sendiri. `sarang` mencatat
 * kedalaman `{}` tiap interpolasi supaya `}` penutupnya dikenali.
 */
function lewatiString(s: string, i: number, kutip: string, sarang: number[]): number {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === kutip) return j + 1;
    if (kutip !== "`" && c === "\n") return j;
    if (kutip === "`" && c === "$" && s[j + 1] === "{") {
      sarang.push(0);
      return j + 2;
    }
    j += 1;
  }
  return s.length;
}

/** Lewati satu literal regex; `/` di dalam kelas `[...]` tidak mengakhirinya. */
function lewatiRegex(s: string, i: number): number {
  let j = i + 1;
  let kelas = false;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    // Regex tak pernah lintas baris: kalau sampai `\n`, tebakannya salah dan
    // `/` itu sebenarnya pembagian. Mundur satu aksara, jangan telan barisnya.
    if (c === "\n") return i + 1;
    if (c === "[") kelas = true;
    else if (c === "]") kelas = false;
    else if (c === "/" && !kelas) {
      j += 1;
      while (j < s.length && /[a-z]/i.test(s[j])) j += 1;
      return j;
    }
    j += 1;
  }
  return i + 1;
}

/** Buang isi komentar TANPA menggeser posisi mana pun. */
export function butaKomentar(s: string): string {
  const out = s.split("");
  const sarang: number[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (sarang.length > 0 && c === "}") {
      if (sarang[sarang.length - 1] === 0) {
        sarang.pop();
        i = lewatiString(s, i, "`", sarang);
        continue;
      }
      sarang[sarang.length - 1] -= 1;
      i += 1;
      continue;
    }
    if (sarang.length > 0 && c === "{") {
      sarang[sarang.length - 1] += 1;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = lewatiString(s, i, c, sarang);
      continue;
    }
    if (s.startsWith("/*", i)) {
      let j = s.indexOf("*/", i + 2);
      j = j < 0 ? s.length : j + 2;
      for (let k = i; k < j; k += 1) if (out[k] !== "\n") out[k] = " ";
      i = j;
      continue;
    }
    if (s.startsWith("//", i)) {
      let j = s.indexOf("\n", i);
      j = j < 0 ? s.length : j;
      for (let k = i; k < j; k += 1) out[k] = " ";
      i = j;
      continue;
    }
    if (c === "/" && regexBoleh(s, i)) {
      i = lewatiRegex(s, i);
      continue;
    }
    i += 1;
  }
  return out.join("");
}
