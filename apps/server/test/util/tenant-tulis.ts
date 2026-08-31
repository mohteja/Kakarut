import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  barisDi,
  deklarasiTerlihat,
  jelajah,
  namaProperti,
  petaInduk,
  petaLingkup,
  rantaiPenuh,
  uraikan,
  type Deklarasi,
  type Simpul,
} from "./ast";
import { SRC, daftarSumber } from "./kueri-terkurung";
import { buktikan, grafPanggilan, type Graf } from "./panggilan";

/**
 * BARIS BARU DAN TENANT-NYA — arah TULIS yang tak pernah punya gerbang.
 *
 * Sapuan pengurungan tenant (`kueri-terkurung.ts`) hanya melihat
 * `select`/`update`/`delete`: ketiganya punya `.where`, dan pengurungannya bisa
 * dibaca di sana. **`insert` tak punya `.where` sama sekali** — pertanyaannya
 * bukan "baris mana yang terbaca" melainkan **"nilai `companyId` yang ditulis
 * ini datang dari mana"**. Kalau ia datang dari masukan klien alih-alih dari
 * token, satu penyewa bisa menanam baris di ruang penyewa lain.
 *
 * Ledger mencatat vena "Isolasi tenant pada PENULISAN" (2026-08-22) menyapu
 * 162 penulisan lalu menyatakannya bersih — *"tapi sapuannya hidup di
 * scratchpad dan tak pernah jadi gerbang."* Empat tahun putaran kemudian,
 * `insert` masih tak dijaga apa pun.
 *
 * KENAPA INI BARU BISA DISAPU SEKARANG. Nilai yang ditulis hampir tak pernah
 * berada di situs `insert`-nya:
 *
 *     tx.insert(ingredients).values(items.map((b, i) => ({ companyId, … })))
 *     tx.insert(productions).values(rows)          // `rows` dirakit di atas
 *     tx.insert(stockOpnames).values(values)       // idem
 *
 * Properti RINGKAS (`companyId` tanpa `:`), callback `.map`, dan nama yang
 * dirakit belasan baris sebelumnya — tak satu pun terbaca regex. Yang
 * dibutuhkan resolusi per-LINGKUP, dan itu baru ada sejak instrumennya pindah
 * ke pohon sintaks.
 */

export type KelasTulis = "AUTH" | "TURUNAN" | "PARAMETER" | "KLIEN" | "TANPA" | "E";

export interface SitusTulis {
  berkas: string;
  baris: number;
  tabel: string;
  kelas: KelasTulis;
  /** ekspresi yang jadi nilai `companyId`, apa adanya */
  sumber: string;
  /** pembantu bernama yang memuat situs ini — kunci ke graf panggilan */
  pembantu?: string;
}

/** Berkas yang memang bekerja LINTAS perusahaan (cermin daftar sapuan BACA). */
export const GLOBAL = [
  /^lib\//, /^seed\//, /^db\//, /^scripts\//, /^app\.ts$/, /^index\.ts$/,
  /^middleware\/auth\.ts$/, /^modules\/auth\//, /^modules\/onboarding\//,
  /^modules\/admin-/, /^modules\/mail\//, /^modules\/users\//,
];

export const PANGKAL = new Set(["db", "tx", "trx"]);
const FUNGSI = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Pembantu bernama TERLUAR yang memuat simpul ini. */
function pembantuPemuat(n: Simpul, k: Konteks): string | undefined {
  let x: Simpul | undefined = n;
  let nama: string | undefined;
  while (x) {
    if (FUNGSI.has(x.type)) {
      if (x.type === "FunctionDeclaration" && x.id?.type === "Identifier") nama = x.id.name as string;
      else {
        const up = k.induk.get(x);
        if (up?.type === "VariableDeclarator" && up.id?.type === "Identifier") nama = up.id.name as string;
      }
    }
    x = k.induk.get(x);
  }
  return nama;
}

export interface Konteks {
  nama: string;
  isi: string;
  prog: Simpul;
  induk: Map<Simpul, Simpul>;
  lingkup: Map<Simpul, Map<string, Deklarasi>>;
}

export function konteks(nama: string, isi: string): Konteks {
  const prog = uraikan(nama.endsWith(".ts") ? nama : `${nama}.ts`, isi);
  const induk = petaInduk(prog);
  return { nama, isi, prog, induk, lingkup: petaLingkup(prog, induk) };
}

/**
 * Tabel yang PUNYA kolom `companyId` — dibaca dari `db/schema.ts` lewat pohon,
 * bukan regex atas `pgTable(...)` yang isinya berbaris-baris dan bersarang.
 */
export function tabelBerTenant(): Set<string> {
  const isi = readFileSync(join(SRC, "db/schema.ts"), "utf8");
  const prog = uraikan("db/schema.ts", isi);
  const punya = new Set<string>();
  jelajah(prog, (n) => {
    if (n.type !== "VariableDeclarator" || n.id?.type !== "Identifier") return;
    if (n.init?.type !== "CallExpression" || n.init.callee?.name !== "pgTable") return;
    const kolom = n.init.arguments?.[1];
    if (kolom?.type !== "ObjectExpression") return;
    for (const p of kolom.properties ?? []) {
      if (p.key?.name === "companyId") punya.add(n.id.name as string);
    }
  });
  return punya;
}

/**
 * Buka pembungkus yang bukan nilai: tanda kurung dan penegas tipe.
 *
 * `ParenthesizedExpression` BUKAN detail sepele di sini. Bentuk paling lazim
 * dari perakit baris adalah `items.map((b) => ({ companyId, … }))`, dan tanda
 * kurung di sekitar objeknya itu simpul tersendiri di pohon Oxc. Versi pertama
 * pemindai ini melewatkannya — DUA PULUH insert terbaca "tak menyebut
 * companyId" padahal menyebutnya, dan dua di antaranya dengan
 * `auth.company_id!` terang-terangan. Ditemukan sebelum satu tuduhan pun
 * ditulis.
 */
function bukaBungkus(x: Simpul | undefined): Simpul | undefined {
  let n = x;
  while (
    n &&
    (n.type === "ParenthesizedExpression" ||
      n.type === "TSAsExpression" ||
      n.type === "TSNonNullExpression")
  ) {
    n = n.expression ?? n.argument;
  }
  return n;
}

/** Objek-objek baris yang benar-benar ditulis oleh `.values(<x>)`. */
export function objekBaris(mentah: Simpul | undefined, k: Konteks, dalam = 0): Simpul[] {
  const x = bukaBungkus(mentah);
  if (!x || dalam > 4) return [];
  if (x.type === "ObjectExpression") return [x];
  if (x.type === "ArrayExpression") {
    // Elemen SEBAR ikut dibuka: `values([...barisFaktur(a), ...barisFaktur(b)])`
    // adalah bentuk yang dipakai `rekomendasi/rencana.ts`, dan tanpa ini
    // seluruh larik terbaca kosong.
    return (x.elements ?? []).flatMap((e: Simpul) =>
      objekBaris(e?.type === "SpreadElement" ? e.argument : e, k, dalam + 1),
    );
  }
  // `items.map((b, i) => ({ … }))` — badan callback-nya yang menulis barisnya.
  if (x.type === "CallExpression" && namaProperti(x.callee) === "map") {
    const cb = x.arguments?.[0];
    const fn = bukaBungkus(cb);
    if (fn?.type === "ArrowFunctionExpression" || fn?.type === "FunctionExpression") {
      const badan = bukaBungkus(fn.body);
      if (badan?.type === "ObjectExpression") return [badan];
      const cb2 = fn;
      const keluar: Simpul[] = [];
      jelajah(cb2.body, (n) => {
        if (n.type === "ReturnStatement" && n.argument) {
          keluar.push(...objekBaris(n.argument, k, dalam + 1));
        }
      });
      if (!keluar.length && cb2.body) keluar.push(...objekBaris(cb2.body, k, dalam + 1));
      return keluar;
    }
  }
  if (x.type === "Identifier") {
    const d = deklarasiTerlihat(x, x.name as string, k.induk, k.lingkup);
    if (d?.nilai) {
      const langsung = objekBaris(d.nilai, k, dalam + 1);
      if (langsung.length) return langsung;
      // Larik yang DIISI dengan `.push(...)`, bukan dirakit sekaligus. Bentuk
      // ini dipakai `produksi/konsumsi.ts` dan `produksi/routes.ts`: `const
      // values = []` lalu belasan baris kemudian `values.push({ … })`.
      const nama = x.name as string;
      const keluar: Simpul[] = [];
      jelajah(k.prog, (n) => {
        if (n.type !== "CallExpression") return;
        if (namaProperti(n.callee) !== "push") return;
        if (n.callee.object?.type !== "Identifier" || n.callee.object.name !== nama) return;
        for (const a of n.arguments ?? []) keluar.push(...objekBaris(a, k, dalam + 1));
      });
      return keluar;
    }
  }
  // Baris yang dirakit PEMBANTU BERNAMA — `barisFaktur(rows, "produksi", id)`.
  if (x.type === "CallExpression" && x.callee?.type === "Identifier") {
    const d = deklarasiTerlihat(x.callee, x.callee.name as string, k.induk, k.lingkup);
    if (d?.nilai && dalam < 3) {
      const fn = bukaBungkus(d.nilai);
      // Pembantu ber-badan EKSPRESI: `const barisFaktur = (rows, …) =>
      // rows.map((b) => ({ companyId: params.companyId, … }))`. Tak ada
      // `return` untuk dicari — badannya sendiri yang merakit barisnya.
      if (
        (fn?.type === "ArrowFunctionExpression" || fn?.type === "FunctionExpression") &&
        fn.body?.type !== "BlockStatement"
      ) {
        const lewatBadan = objekBaris(fn.body, k, dalam + 1);
        if (lewatBadan.length) return lewatBadan;
      }
      const keluar: Simpul[] = [];
      jelajah(d.nilai, (n) => {
        if (n.type === "ReturnStatement" && n.argument) {
          keluar.push(...objekBaris(n.argument, k, dalam + 1));
        }
      });
      if (keluar.length) return keluar;
    }
  }
  return [];
}

/** Ekspresi nilai `companyId` di sebuah objek baris (termasuk properti RINGKAS). */
function nilaiTenant(obj: Simpul, k: Konteks): Simpul | undefined {
  for (const p of obj.properties ?? []) {
    if (p.type === "SpreadElement") {
      const dalam = objekBaris(p.argument, k, 1);
      for (const o of dalam) {
        const v = nilaiTenant(o, k);
        if (v) return v;
      }
      continue;
    }
    if (p.key?.name !== "companyId") continue;
    // Properti ringkas (`{ companyId }`) → nilainya identifier itu sendiri.
    return p.value ?? p.key;
  }
  return undefined;
}

const AUTH_RE = /auth\.company_id/;

/**
 * Sumber yang datang dari PERMINTAAN, bukan dari token.
 *
 * Inilah satu-satunya kelas yang tak boleh ada sama sekali: `companyId` yang
 * dipungut dari badan/kueri permintaan berarti penyewa memilih sendiri ruang
 * yang ditulisinya. Sapuan hari ini menemukannya NOL — dan gerbang ini yang
 * menjaga angka itu tetap nol.
 */
const KLIEN_RE = /\bbody\b|\bpayload\b|c\.req|valid\(|\binput\b|\bquery\(/;

/** Telusuri sebuah nama sampai ke asalnya (maks 4 lompatan, satu berkas). */
function asal(mentah: Simpul, k: Konteks, dalam = 0): { teks: string; parameter: boolean } {
  const n = bukaBungkus(mentah) ?? mentah;
  const teks = k.isi.slice(n.start, n.end);
  if (AUTH_RE.test(teks)) return { teks, parameter: false };
  if (dalam > 3) return { teks, parameter: false };
  if (n.type === "Identifier") {
    const d = deklarasiTerlihat(n, n.name as string, k.induk, k.lingkup);
    if (d?.nilai) return asal(d.nilai, k, dalam + 1);
    // Tak punya nilai = parameter (atau hasil destrukturisasi parameter).
    return { teks, parameter: true };
  }
  if (n.type === "MemberExpression" && n.object?.type === "Identifier") {
    const d = deklarasiTerlihat(n.object, n.object.name as string, k.induk, k.lingkup);
    if (!d?.nilai) return { teks, parameter: true };
    const dalamTeks = k.isi.slice(d.nilai.start, d.nilai.end);
    if (AUTH_RE.test(dalamTeks)) return { teks: dalamTeks, parameter: false };
  }
  return { teks, parameter: false };
}

export function situsTulis(kode?: { nama: string; isi: string }[]): SitusTulis[] {
  const punya = tabelBerTenant();
  const berkas = kode ?? daftarSumber();
  const keluar: SitusTulis[] = [];
  for (const { nama, isi } of berkas) {
    let k: Konteks;
    try {
      k = konteks(nama, isi);
    } catch {
      continue;
    }
    jelajah(k.prog, (n) => {
      if (n.type !== "CallExpression" || namaProperti(n.callee) !== "insert") return;
      const pk = n.callee.object;
      if (pk?.type !== "Identifier" || !PANGKAL.has(pk.name)) return;
      const tabel = n.arguments?.[0];
      if (tabel?.type !== "Identifier" || !punya.has(tabel.name)) return;

      // `.values(...)` di rantai yang sama.
      let nilai: Simpul | undefined;
      jelajah(rantaiPenuh(n, k.induk), (m) => {
        if (nilai || m.type !== "CallExpression") return;
        if (namaProperti(m.callee) === "values") nilai = m.arguments?.[0];
      });

      const objek = objekBaris(nilai, k);
      let sumber: Simpul | undefined;
      for (const o of objek) {
        sumber = nilaiTenant(o, k);
        if (sumber) break;
      }
      const situs = {
        berkas: nama,
        baris: barisDi(isi, n.start),
        tabel: tabel.name as string,
      };
      if (GLOBAL.some((r) => r.test(nama))) {
        keluar.push({ ...situs, kelas: "E", sumber: sumber ? k.isi.slice(sumber.start, sumber.end) : "" });
        return;
      }
      if (!sumber) {
        // Barisnya datang UTUH dari pemanggil (`values(row)` dengan `row`
        // parameter): tenant-nya diputuskan di sana, bukan di sini.
        const arg = nilai;
        if (arg?.type === "Identifier") {
          const d = deklarasiTerlihat(arg, arg.name as string, k.induk, k.lingkup);
          if (!d) {
            keluar.push({
              ...situs,
              kelas: "PARAMETER",
              sumber: arg.name as string,
              pembantu: pembantuPemuat(n, k),
            });
            return;
          }
        }
        keluar.push({ ...situs, kelas: "TANPA", sumber: "" });
        return;
      }
      const a = asal(sumber, k);
      const teksAsli = k.isi.slice(sumber.start, sumber.end);
      const kelas: KelasTulis = AUTH_RE.test(a.teks)
        ? "AUTH"
        : KLIEN_RE.test(a.teks) || KLIEN_RE.test(teksAsli)
          ? "KLIEN"
          : a.parameter
            ? "PARAMETER"
            : "TURUNAN";
      keluar.push({
        ...situs,
        kelas,
        sumber: teksAsli.replace(/\s+/g, " ").slice(0, 60),
        ...(kelas === "PARAMETER" ? { pembantu: pembantuPemuat(n, k) } : {}),
      });
    });
  }
  return keluar;
}

/**
 * BUKTI untuk kelas `PARAMETER`: tiap pembantu yang membawa tenant lewat
 * parameternya ditelusuri ke SELURUH situs panggilnya, lintas berkas.
 *
 * Inilah yang membedakan "diputuskan pemanggil" sebagai janji dari sebagai
 * bukti. Daftar tulisan tangan hanya menyatakan keadaan hari ini; graf
 * panggilan menyatakan keadaan tiap kali gerbangnya jalan — dan satu pemanggil
 * BARU yang mengoper tenant dari permintaan membuat pembantunya berhenti
 * terbukti, dengan berkas & barisnya disebut.
 */
export function buktiPemanggil(
  situs: SitusTulis[],
  graf: Graf = grafPanggilan(),
): { terbukti: Set<string>; belum: Map<string, string>; pembantu: string[] } {
  const nama = [...new Set(situs.filter((x) => x.kelas === "PARAMETER" && x.pembantu).map((x) => x.pembantu!))];
  const h = buktikan(graf, nama);
  const belum = new Map<string, string>();
  for (const n of nama) if (!h.terbukti.has(n)) belum.set(n, h.belum.get(n) ?? "tak dinilai");
  return { terbukti: h.terbukti, belum, pembantu: nama };
}
