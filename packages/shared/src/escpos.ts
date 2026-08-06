/**
 * Builder perintah ESC/POS bebas-dependensi untuk printer thermal
 * (58mm = 32 kolom, 80mm = 48 kolom pada Font A).
 * Dipakai di browser (Web Bluetooth / WebUSB / RawBT) — hanya byte murni.
 */

export const ESCPOS = {
  /** ESC @ — reset printer */
  INIT: [0x1b, 0x40],
  /** ESC t 0 — codepage CP437 (aman untuk ASCII) */
  CODEPAGE_CP437: [0x1b, 0x74, 0x00],
  ALIGN_LEFT: [0x1b, 0x61, 0x00],
  ALIGN_CENTER: [0x1b, 0x61, 0x01],
  ALIGN_RIGHT: [0x1b, 0x61, 0x02],
  BOLD_ON: [0x1b, 0x45, 0x01],
  BOLD_OFF: [0x1b, 0x45, 0x00],
  /** GS ! n — ukuran karakter */
  SIZE_NORMAL: [0x1d, 0x21, 0x00],
  /** tinggi 2× (lebar tetap — jumlah kolom tidak berubah) */
  SIZE_TALL: [0x1d, 0x21, 0x01],
  /** tinggi & lebar 2× (kolom efektif setengah) */
  SIZE_DOUBLE: [0x1d, 0x21, 0x11],
  LF: [0x0a],
  /** GS V 66 3 — feed + potong parsial (fungsi B, paling kompatibel) */
  CUT_PARTIAL: [0x1d, 0x56, 0x42, 0x03],
  /** ESC p 0 25 250 — kick laci kas pin 2 (50ms on / 500ms off) */
  DRAWER_KICK: [0x1b, 0x70, 0x00, 0x19, 0xfa],
} as const;

/** Jumlah kolom default per lebar kertas (Font A 12×24). */
export function kolomDefault(paperWidth: 58 | 80): number {
  return paperWidth === 80 ? 48 : 32;
}

const CHAR_MAP: Record<string, string> = {
  " ": " ", // nbsp — dihasilkan Intl.NumberFormat("id-ID") untuk "Rp "
  " ": " ",
  "×": "x",
  "·": ".",
  "•": "*",
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
};

/**
 * Printer thermal murah hanya andal untuk ASCII 0x20–0x7E.
 * Normalisasi aksen (é→e), petakan karakter tipografi umum, buang sisanya
 * (termasuk emoji).
 */
export function sanitizeAscii(s: string): string {
  let out = "";
  const normalized = s.normalize("NFKD");
  for (const ch of normalized) {
    if (ch === "\n" || ch === "\t") {
      out += ch === "\t" ? " " : "\n";
      continue;
    }
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) out += ch;
    // selain itu: combining mark / emoji / non-latin → dibuang
  }
  return out;
}

/**
 * Bungkus teks per kata agar tiap baris ≤ width.
 *
 * `width` dijepit minimal 1. Bukan kerapian: dengan `width = 0`, gelung
 * pemotong-paksa di bawah memotong nol karakter tiap putaran dan tak pernah
 * maju — larik tumbuh sampai runtime menyerah. Menjepitnya membuat fungsi ini
 * mustahil menggantung, berapa pun lebar yang diberikan pemanggil.
 */
export function wrapText(s: string, width: number): string[] {
  const lines: string[] = [];
  const w = Math.max(1, Math.floor(width));
  for (const paragraph of s.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > w) {
        // kata lebih panjang dari satu baris → potong paksa
        if (current) {
          lines.push(current);
          current = "";
        }
        let rest = word;
        while (rest.length > w) {
          lines.push(rest.slice(0, w));
          rest = rest.slice(w);
        }
        current = rest;
      } else if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= w) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

/**
 * Baris dua kolom: kiri rata kiri, kanan rata kanan, dipad spasi hingga
 * tepat `width`. Kiri yang kepanjangan dibungkus; kolom kanan menempel di
 * baris terakhir.
 */
export function padLine(left: string, right: string, width: number): string[] {
  // Kolom kanan yang TIDAK MUAT di kertas: dulu ini melempar RangeError lewat
  // `" ".repeat(negatif)`, dan karena struk dibangun sekali jalan, satu baris
  // seperti itu menggagalkan SELURUH struk — kasir tak punya apa pun untuk
  // diserahkan. Sekarang kanan turun ke barisnya sendiri apa adanya; printer
  // yang membungkusnya. Jelek, tapi tercetak.
  //
  // Hari ini semua kolom kanan berupa nominal terformat (≤ ~22 karakter) atau
  // jam 12 karakter, jadi jalur ini belum terjangkau lewat layar mana pun. Ia
  // dijaga karena `padLine` diekspor dari paket bersama — pemanggil
  // berikutnya, termasuk aplikasi mobile, tak wajib tahu batas diam-diam ini.
  if (right.length >= width) {
    return [...(left ? wrapText(left, width) : []), right];
  }
  const maxLeft = width - right.length - 1;
  if (left.length <= maxLeft) {
    return [left + " ".repeat(width - left.length - right.length) + right];
  }
  const wrapped = wrapText(left, width);
  const last = wrapped[wrapped.length - 1];
  if (last.length <= maxLeft) {
    wrapped[wrapped.length - 1] =
      last + " ".repeat(width - last.length - right.length) + right;
  } else {
    wrapped.push(" ".repeat(width - right.length) + right);
  }
  return wrapped;
}

export class EscPosBuilder {
  private bytes: number[] = [];

  constructor(readonly width: number) {}

  raw(b: readonly number[]): this {
    this.bytes.push(...b);
    return this;
  }

  init(): this {
    return this.raw(ESCPOS.INIT).raw(ESCPOS.CODEPAGE_CP437);
  }

  align(a: "left" | "center" | "right"): this {
    return this.raw(
      a === "center" ? ESCPOS.ALIGN_CENTER : a === "right" ? ESCPOS.ALIGN_RIGHT : ESCPOS.ALIGN_LEFT,
    );
  }

  bold(on: boolean): this {
    return this.raw(on ? ESCPOS.BOLD_ON : ESCPOS.BOLD_OFF);
  }

  size(s: "normal" | "tall" | "double"): this {
    return this.raw(
      s === "double" ? ESCPOS.SIZE_DOUBLE : s === "tall" ? ESCPOS.SIZE_TALL : ESCPOS.SIZE_NORMAL,
    );
  }

  /** Tulis teks (disanitasi ASCII, dibungkus per lebar) + line feed per baris. */
  text(s: string): this {
    for (const line of wrapText(sanitizeAscii(s), this.width)) {
      this.pushAscii(line);
      this.raw(ESCPOS.LF);
    }
    return this;
  }

  /** Baris dua kolom (kiri…kanan) dipad tepat selebar kertas. */
  line(left: string, right: string): this {
    for (const line of padLine(sanitizeAscii(left), sanitizeAscii(right), this.width)) {
      this.pushAscii(line);
      this.raw(ESCPOS.LF);
    }
    return this;
  }

  divider(ch = "-"): this {
    this.pushAscii(ch.repeat(this.width));
    return this.raw(ESCPOS.LF);
  }

  feed(n: number): this {
    if (n > 0) this.raw([0x1b, 0x64, Math.min(n, 255)]);
    return this;
  }

  cut(): this {
    return this.raw(ESCPOS.CUT_PARTIAL);
  }

  drawerKick(): this {
    return this.raw(ESCPOS.DRAWER_KICK);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  private pushAscii(s: string) {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      this.bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x20);
    }
  }
}
