import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * NILAI YANG DIADILI DI DALAM FUNGSI LAIN.
 *
 * Vena "angka yang disusun di JS lalu mengadili" menutup perbandingan yang
 * ditulis DI SATU BARIS, lalu menulis batasnya sendiri:
 *
 *   Sapuannya melihat perbandingan di satu baris; nilai yang dioper ke fungsi
 *   lain lalu dibandingkan DI DALAM fungsi itu tak terlihat.
 *
 * Gerbang ini menutup batas itu. Bentuknya dua tahap, sebab pertanyaannya
 * memang dua: (1) fungsi mana yang MENGADILI parameter numeriknya, dan (2)
 * siapa yang mengoper EKSPRESI aritmetika ke fungsi seperti itu — bukan
 * identifier polos yang nilainya sudah berskala di tempat lahirnya.
 *
 * Diukur saat gerbang ini dipasang (2026-08-25): 104 fungsi pengadil, dan
 * hanya 4 situs yang mengoper ekspresi. Keempatnya dipilah tangan dan aman;
 * alasannya ditulis di `DIKECUALIKAN` di bawah, satu per satu.
 *
 * BATASNYA, jujur: ia melihat pemanggilan LANGSUNG. Nilai yang mampir ke
 * variabel perantara lalu diteruskan ke pengadil masih di luar jangkauannya —
 * itu bahan bakar putaran berikutnya, bukan janji yang dibuat di sini.
 */
const AKAR = [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../../../packages/shared/src", import.meta.url)),
];

export interface Berkas {
  nama: string;
  isi: string;
}

/** Isi template literal diganti spasi — SQL & pesan tak ikut dinilai. */
function butaTemplate(src: string): string {
  const o = src.split("");
  let i = 0;
  let dalam = false;
  while (i < src.length) {
    const c = src[i];
    if (!dalam && c === "`") {
      dalam = true;
      i += 1;
      continue;
    }
    if (dalam) {
      if (c === "\\") {
        o[i] = " ";
        o[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "`") {
        dalam = false;
        i += 1;
        continue;
      }
      if (c !== "\n") o[i] = " ";
    }
    i += 1;
  }
  return o.join("");
}

const bersih = (b: Berkas) => butaTemplate(butaKomentar(b.isi));

/** Fungsi yang membandingkan/membulatkan salah satu parameternya sendiri. */
export function fungsiPengadil(berkas: Berkas[]): Map<string, string[]> {
  const hasil = new Map<string, string[]>();
  for (const b of berkas) {
    const src = bersih(b);
    for (const m of src.matchAll(/(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)[^{]*\{/g)) {
      const params = [...m[2].matchAll(/([A-Za-z_$][\w$]*)\s*[:?]/g)].map((x) => x[1]);
      if (!params.length) continue;
      const mulai = (m.index ?? 0) + m[0].length;
      const badan = src.slice(mulai, mulai + 2500);
      const adili = params.filter((p) =>
        new RegExp(
          `\\b${p}\\b\\s*(<=?|>=?|===|!==)|(<=?|>=?|===|!==)\\s*\\b${p}\\b|Math\\.(max|min|round)\\([^)]*\\b${p}\\b`,
        ).test(badan),
      );
      if (adili.length) hasil.set(m[1], adili);
    }
  }
  return hasil;
}

/**
 * `keSkalaKolom`/`toleransiBanding` sengaja tak dihitung sebagai pengadil:
 * keduanya OBATnya, bukan penyakitnya — menuduh mereka membuat gerbang ini
 * berteriak pada tiap perbaikan yang sudah benar.
 */
const OBAT = new Set(["keSkalaKolom", "toleransiBanding"]);

/** Situs yang mengoper EKSPRESI aritmetika ke fungsi pengadil. */
export function situsEkspresi(
  berkas: Berkas[],
  pengadil: Map<string, string[]>,
): { berkas: string; baris: number; fungsi: string; teks: string }[] {
  const out: { berkas: string; baris: number; fungsi: string; teks: string }[] = [];
  for (const b of berkas) {
    bersih(b)
      .split("\n")
      .forEach((ln, i) => {
        const t = ln.trim();
        if (!t) return;
        for (const nama of pengadil.keys()) {
          if (OBAT.has(nama)) continue;
          const m = ln.match(
            new RegExp(`\\b${nama}\\s*\\(([^()]*(?:\\([^()]*\\))?[^()]*)\\)`),
          );
          if (!m) continue;
          const arg = m[1];
          if (!/[A-Za-z_$)\d]\s*[-+*]\s*[A-Za-z_$(\d]/.test(arg)) return; // identifier polos
          if ([...OBAT].some((o) => arg.includes(`${o}(`))) return; // sudah diobati
          out.push({ berkas: b.nama, baris: i + 1, fungsi: nama, teks: t.slice(0, 100) });
          return;
        }
      });
  }
  return out;
}

function semuaBerkas(): Berkas[] {
  const out: Berkas[] = [];
  const walk = (d: string, akar: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, akar);
      else if (/\.tsx?$/.test(p)) out.push({ nama: p.slice(akar.length + 1), isi: readFileSync(p, "utf8") });
    }
  };
  for (const a of AKAR) walk(a, a);
  return out;
}

/**
 * Situs yang SUDAH dipilah tangan dan terbukti aman — masing-masing dengan
 * alasan yang bisa diperiksa, bukan "belum sempat".
 */
const DIKECUALIKAN = new Map<string, string>([
  // aritmetika JAM: bilangan bulat, tak berderau.
  ["index.ts:jadwalkanSapuUnggahan", "jam bulat: (BACKUP_HOUR + 1) % 24"],
  ["index.ts:jadwalkanPangkasToken", "jam bulat: (BACKUP_HOUR + 2) % 24"],
  // pembangkit FIKSTUR, dan seluruh sub/dis-nya bilangan bulat (1.000 ·
  // 12.345 · 99.999 · 333.333 × 0 · 1 · 500 · 1.234) → selisihnya eksak.
  ["scripts/acuan-uang-mobile.ts:hitungPb1", "fikstur berbilangan bulat"],
  // kembalian di struk: `uangDiterima` sudah Math.round (rupiah bulat) dan
  // `total` sudah berskala kolom sejak vena "uang yang diadili", lalu
  // hasilnya diformat — deraunya tak pernah sampai ke kertas.
  ["receipt.ts:formatRupiahAscii", "operan sudah berskala; hasilnya diformat"],
]);

describe("nilai yang diadili di dalam fungsi lain", () => {
  const berkas = semuaBerkas();
  const pengadil = fungsiPengadil(berkas);
  const situs = situsEkspresi(berkas, pengadil);
  const kunci = (s: { berkas: string; fungsi: string }) =>
    `${s.berkas.split("/").slice(-1)[0] === s.berkas ? s.berkas : s.berkas}:${s.fungsi}`;

  it("PREMIS: populasinya > 0 — nol berarti pemindainya rusak", () => {
    // Gerbang yang hijau karena tak melihat apa pun tidak menjaga apa pun.
    // Sudah terjadi di repo ini: sapuan larik dikirim dengan regex yang hanya
    // melihat 18 dari 39 situs, dan tetap hijau.
    expect(berkas.length).toBeGreaterThan(100);
    expect(pengadil.size, "tak satu pun fungsi pengadil terbaca").toBeGreaterThan(50);
    expect(situs.length, "tak satu pun situs terbaca").toBeGreaterThan(0);
  });

  it("DETEKTOR TERBUKTI: masukan sintetis tertuduh, yang aman tidak", () => {
    const sintetis: Berkas[] = [
      {
        nama: "palsu.ts",
        isi: [
          "export function jagaBatas(nilai: number, batas: number) {",
          "  if (nilai > batas) throw new Error('lewat');",
          "}",
          "const a = 1, b = 2, sudah = 3;",
          "jagaBatas(a - b, 10);", // ← tertuduh: ekspresi
          "jagaBatas(sudah, 10);", // ← aman: identifier polos
          "jagaBatas(keSkalaKolom(a - b, 2), 10);", // ← aman: sudah diobati
        ].join("\n"),
      },
    ];
    const p = fungsiPengadil(sintetis);
    expect([...p.keys()]).toContain("jagaBatas");
    const s = situsEkspresi(sintetis, p);
    expect(s.map((x) => x.baris), "hanya baris ber-EKSPRESI yang boleh tertuduh").toEqual([5]);
  });

  it("DETEKTOR TERBUKTI: fungsi yang TIDAK mengadili tak masuk populasi", () => {
    const p = fungsiPengadil([
      {
        nama: "polos.ts",
        isi: "export function gabung(a: string, b: string) {\n  return a + b;\n}\n",
      },
    ]);
    expect([...p.keys()]).not.toContain("gabung");
  });

  it("tiap situs ber-ekspresi sudah dipilah — atau menagih keputusan", () => {
    const asing = situs.filter((s) => !DIKECUALIKAN.has(kunci(s)));
    expect(
      asing.map((s) => `${s.berkas}:${s.baris} → ${s.fungsi}(${s.teks})`),
      "situs baru mengoper EKSPRESI aritmetika ke fungsi yang mengadilinya. " +
        "Bungkus argumennya dengan `keSkalaKolom`/`toleransiBanding` bila " +
        "angkanya disusun di JS, ATAU daftarkan di DIKECUALIKAN beserta " +
        "alasan yang bisa diperiksa",
    ).toEqual([]);
  });

  it("daftar pengecualiannya masih ADA — bukan kuburan nama basi", () => {
    // Situs yang hilang membuat pengecualiannya diam-diam melebar: situs baru
    // yang kelak lahir di tempat yang sama tak akan ketahuan.
    const ada = new Set(situs.map(kunci));
    for (const k of DIKECUALIKAN.keys()) expect(ada, k).toContain(k);
  });

  it("aturan KEMBALIAN tetap punya SATU rumah", () => {
    // Diukur saat gerbang ini dipasang: tepat satu situs di seluruh repo
    // (`receipt.ts`). Ponsel mengoper `uangDiterima` ke pembangun struk
    // bersama, bukan menghitung sendiri — jadi tak ada salinan kedua yang bisa
    // menyimpang. Salinan yang lahir nanti menagih keputusan di sini.
    const situsKembalian = berkas.filter((b) =>
      /Math\.max\(\s*0\s*,\s*[\w.]*uangDiterima\b/.test(bersih(b)),
    );
    expect(situsKembalian.map((b) => b.nama)).toEqual(["receipt.ts"]);
  });
});
