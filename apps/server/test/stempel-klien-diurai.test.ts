import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * STEMPEL WAKTU DARI KLIEN WAJIB DIURAI, TAK PERNAH DIBANDINGKAN SEBAGAI TEKS.
 *
 * Di TypeScript kelas ini **tidak bisa terjadi hari ini**, dan itu diukur bukan
 * diandaikan: `Date.prototype.toISOString()` selalu menulis TIGA digit pecahan,
 * jadi urutan teks = urutan waktu selama setiap stempel lahir di JavaScript.
 * Kesebelas perbandingan stempel di server/web membandingkan stempel yang
 * server/web sendiri hasilkan.
 *
 * Yang TIDAK dijamin begitu: stempel yang datang **dari klien**. `Dart`
 * menulis tiga digit pecahan bila mikrodetiknya nol dan **enam** bila tidak —
 * dan aplikasi ponsel mengirim stempelnya sendiri lewat `POST /api/sync`
 * (`waktu`). Begitu satu di antaranya disimpan sebagai TEKS lalu dibandingkan,
 * bug yang sudah tiga kali menggigit di sisi Dart pindah ke sisi ini.
 *
 * Karena itu gerbangnya TIPIS dan sengaja: ia diam untuk sebelas situs yang
 * ada, dan hanya berbicara tentang medan yang benar-benar datang dari luar.
 * Gerbang yang menuntut SELURUH perbandingan stempel lewat pembantu akan
 * menuntut pekerjaan pada kode yang hari ini benar — dan penjaga semacam itu
 * dilonggarkan orang, bukan dipatuhi.
 *
 * Pengingat untuk yang menambah medan baru: `new Date(x)` di batasnya sudah
 * cukup. Yang dilarang adalah menyimpan teksnya lalu mengadunya dengan `<`,
 * `>`, atau `localeCompare`.
 */
const SRC = fileURLToPath(new URL("../src/", import.meta.url)).replace(/\/$/, "");

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Dipakai ulang dari rumah tunggalnya; alasannya di `buta-komentar.ts`. */
export { butaKomentar };

/**
 * Rentang tiap template `` sql`…` `` — di dalamnya Postgres yang membandingkan
 * `timestamptz`, bukan JavaScript yang membandingkan string.
 *
 * Melewatinya WAJIB: dari 19 kandidat mentah di repo ini, **delapan** ada di
 * dalam SQL. Detektor yang menuduh `pr.waktu > b.created_at` milik Postgres
 * adalah cara tercepat membuat gerbangnya diabaikan.
 */
export function rentangSql(b: string): [number, number][] {
  const keluar: [number, number][] = [];
  for (const m of b.matchAll(/\bsql\s*`/g)) {
    const i = m.index! + m[0].length - 1;
    for (let j = i + 1; j < b.length; j += 1) {
      if (b[j] === "`" && b[j - 1] !== "\\") {
        keluar.push([m.index!, j]);
        break;
      }
    }
  }
  return keluar;
}

interface Medan {
  file: string;
  baris: number;
  nama: string;
}

/** Medan badan permintaan bertipe stempel ISO — yaitu yang datang dari klien. */
function medanKlien(): Medan[] {
  const keluar: Medan[] = [];
  for (const p of berkasTs(SRC)) {
    const src = readFileSync(p, "utf8");
    const b = butaKomentar(src);
    for (const m of b.matchAll(/(\w+)\s*:\s*z\.string\(\)[^,;\n]*\.datetime\(/g)) {
      keluar.push({
        file: p.slice(SRC.length + 1),
        baris: src.slice(0, m.index!).split("\n").length,
        nama: m[1],
      });
    }
  }
  return keluar;
}

describe("stempel dari klien: diurai, bukan diadu sebagai teks", () => {
  const medan = medanKlien();

  it("premis: masih ada medan stempel dari klien untuk dijaga", () => {
    // Kalau nol, gerbang ini hijau tanpa menyatakan apa pun — dan itu keadaan
    // yang harus ketahuan, bukan dirayakan.
    expect(medan.length, "tak satu pun z.string().datetime( terbaca").toBeGreaterThan(0);
  });

  it("INTI: tiap medan stempel klien DIURAI dengan new Date(...)", () => {
    const mentah: string[] = [];
    for (const f of medan) {
      const isi = butaKomentar(readFileSync(join(SRC, f.file), "utf8"));
      // `new Date(<apa pun yang menyebut nama medannya>)`
      const diurai = new RegExp(`new Date\\([^)\\n]{0,80}\\b${f.nama}\\b`).test(isi);
      if (!diurai) mentah.push(`${f.file}:${f.baris} — ${f.nama}`);
    }
    expect(
      mentah,
      `medan stempel dari KLIEN yang tak pernah diurai. Aplikasi ponsel ` +
        `menulis pecahan detik berlebar 3 ATAU 6 digit, jadi teksnya tak bisa ` +
        `diurutkan — dan bug itu sudah tiga kali menggigit di sisi Dart. ` +
        `Bungkus dengan new Date(...) di batasnya.`,
    ).toEqual([]);
  });

  it("INTI: tak ada medan stempel klien yang dibandingkan sebagai TEKS", () => {
    const diadu: string[] = [];
    for (const f of medan) {
      const src = readFileSync(join(SRC, f.file), "utf8");
      const b = butaKomentar(src);
      const sqls = rentangSql(b);
      const diSql = (i: number) => sqls.some(([s, e]) => i >= s && i <= e);
      const pola = new RegExp(
        `\\b${f.nama}\\b\\s*(?:\\.localeCompare\\(|[<>]=?[^=])|[<>]=?\\s*\\w*\\.?\\b${f.nama}\\b`,
        "g",
      );
      for (const m of b.matchAll(pola)) {
        if (diSql(m.index!)) continue;
        diadu.push(`${f.file}:${src.slice(0, m.index!).split("\n").length} — ${f.nama}`);
      }
    }
    expect(diadu, `stempel dari klien diadu sebagai teks — urai dulu`).toEqual([]);
  });

  it("PASANGAN: pemindainya melewati perbandingan di dalam sql`…`", () => {
    // Tanpa ini gerbangnya menuduh Postgres. Diuji dengan bentuk yang persis
    // ada di repo: `pr.waktu > b.created_at` di dalam LATERAL join.
    const contoh = 'const q = sql`SELECT 1 WHERE pr.waktu > b.created_at`;\nconst x = a.waktu > b.waktu;';
    const sqls = rentangSql(contoh);
    const iSql = contoh.indexOf("pr.waktu");
    const iJs = contoh.indexOf("a.waktu");
    expect(sqls.some(([s, e]) => iSql >= s && iSql <= e)).toBe(true);
    expect(sqls.some(([s, e]) => iJs >= s && iJs <= e)).toBe(false);
  });

  it("PASANGAN: premis JavaScript-nya — toISOString() SELALU 3 digit pecahan", () => {
    /*
     * Seluruh alasan gerbang ini boleh tipis. Kalau asumsinya salah, sebelas
     * situs yang dibiarkan berubah jadi sebelas bug — jadi ia dijalankan,
     * bukan diingat.
     */
    for (const ms of [0, 1, 9, 99, 239, 999]) {
      const d = new Date(Date.UTC(2026, 7, 22, 5, 26, 23, ms));
      expect(d.toISOString()).toMatch(/\.\d{3}Z$/);
    }
    const a = new Date(Date.UTC(2026, 7, 22, 5, 26, 23, 239));
    const b = new Date(a.getTime() + 1);
    expect(a.toISOString() < b.toISOString()).toBe(a < b);
  });
});
