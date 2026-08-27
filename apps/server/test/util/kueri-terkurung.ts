import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../../src/scripts/buta-komentar";

export const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * PENGURUNGAN TENANT — instrumen bersama untuk arah BACA **dan** TULIS.
 *
 * Vena "Isolasi tenant pada PENULISAN" (2026-08-22) menyapu 162 penulisan lalu
 * menyatakannya bersih — tapi sapuannya hidup di scratchpad dan tak pernah
 * jadi gerbang. Arah BACA belum pernah dihitung sekali pun. Berkas ini rumah
 * untuk keduanya, supaya kueri baru yang lahir tanpa pengurungan menagih
 * keputusan alih-alih lewat diam-diam.
 */
export type Kueri = { berkas: string; baris: number; isi: string };

function berkasTs(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? berkasTs(p, out) : p.endsWith(".ts") && out.push(p);
  }
  return out;
}

/**
 * Rantai lengkap satu kueri: `db.select(` berikut SELURUH `.metode(...)` yang
 * menempel sesudahnya.
 *
 * Versi pertama memotong di `;` — dan rantai drizzle yang tersebar di banyak
 * baris (atau hidup di dalam argumen fungsi lain) terpotong separuh. Versi
 * kedua melanjutkan lewat `.metode(` tapi MENGHITUNG GANDA kurung bukanya:
 * `d` di-set 1 lalu cabang `(` menaikkannya jadi 2, sehingga rantainya menelan
 * rute BERIKUTNYA. Akibatnya 103 kueri tak terkurung terbaca "aman" karena
 * meminjam `companyId` milik tetangganya — dan suntikan bukti merah pun
 * dinyatakan bersih. Karena itu kurungnya dihitung di SATU tempat saja.
 */
export function rantai(s: string, iKurung: number): string {
  let awal = iKurung;
  while (awal > 0 && /[\w.]/.test(s[awal - 1])) awal--;
  let i = iKurung;
  let d = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "(") { d++; i++; continue; }
    if (c === ")") {
      d--;
      if (d === 0) {
        const m = s.slice(i + 1).match(/^\s*\.\s*\w+\s*(?=\()/);
        if (m) { i = i + 1 + m[0].length; continue; } // mendarat DI `(`; cabang di atas yang menghitungnya
        return s.slice(awal, i + 1);
      }
      i++; continue;
    }
    if (c === ";" && d === 0) return s.slice(awal, i);
    i++;
  }
  return s.slice(awal);
}

/** Semua `db|tx .select|update|delete(` di sebuah daftar berkas. */
export function semuaKueri(daftar: { nama: string; isi: string }[]): Kueri[] {
  const out: Kueri[] = [];
  for (const { nama, isi } of daftar) {
    for (const m of isi.matchAll(/\b(?:db|tx)\s*\.\s*(?:select|update|delete)\s*\(/g)) {
      const i = m.index! + m[0].length - 1;
      out.push({ berkas: nama, baris: isi.slice(0, m.index!).split("\n").length, isi: rantai(isi, i) });
    }
  }
  return out;
}

export function daftarSumber(): { nama: string; isi: string }[] {
  return berkasTs(SRC).map((f) => ({ nama: f.slice(SRC.length + 1), isi: butaKomentar(readFileSync(f, "utf8")) }));
}

/**
 * Berkas yang memang bekerja LINTAS perusahaan: otentikasi (cari akun lewat
 * email/token), panel super admin, cadangan, seed, pemangkas retensi.
 */
const GLOBAL = [
  /^lib\//, /^seed\//, /^db\//, /^scripts\//, /^app\.ts$/, /^index\.ts$/,
  /^middleware\/auth\.ts$/, /^modules\/auth\//, /^modules\/onboarding\//,
  /^modules\/admin-/, /^modules\/mail\//, /^modules\/users\//,
];

/** Pengurungan tenant: kolom `companyId`, atau baris perusahaan itu sendiri. */
const TENANT = /companyId|company_id|companies\.id/;

/** Nilai `const X = …` di berkas yang sama — SATU tingkat, dan itu batasnya. */
function nilaiKonstan(isi: string, nama: string): string | null {
  const m = isi.match(new RegExp(`\\b(?:const|let)\\s+${nama}\\s*=\\s*`));
  if (!m) return null;
  const i = m.index! + m[0].length;
  let d = 0;
  for (let j = i; j < isi.length; j++) {
    const c = isi[j];
    if (c === "(" || c === "[" || c === "{") d++;
    else if (c === ")" || c === "]" || c === "}") d--;
    else if (c === ";" && d <= 0) return isi.slice(i, j);
  }
  return isi.slice(i, i + 400);
}

/** Identifier di dalam `.where(...)` — termasuk `and(...conds)` yang di-spread. */
function idWhere(chain: string): string[] {
  const out: string[] = [];
  for (const m of chain.matchAll(/\.(?:where|having)\(([\s\S]*)/g)) {
    for (const id of m[1].matchAll(/(?:\.\.\.)?\b([A-Za-z_$][\w$]*)\b/g)) out.push(id[1]);
  }
  return out;
}

/**
 * Badan fungsi terdekat yang MEMUAT kueri ini.
 *
 * Lokasinya dicari dari NOMOR BARIS, bukan `indexOf(isi)`: dua kueri yang
 * teksnya identik akan sama-sama menunjuk situs PERTAMA, dan lingkup yang
 * salah membuat kelas C menyatakan aman untuk situs yang tak pernah diperiksa.
 * Kelas kesalahan yang sama sudah pernah menggigit repo ini (`re.search`
 * memungut pembantu senama pertama).
 */
function lingkup(isi: string, k: Kueri): string {
  const baris = isi.split("\n");
  let i = 0;
  for (let n = 0; n < k.baris - 1; n++) i += baris[n].length + 1;
  i = isi.indexOf(k.isi.slice(0, 24), i);
  if (i < 0) return "";
  let d = 0;
  let awal = 0;
  for (let j = i; j >= 0; j--) {
    const c = isi[j];
    if (c === "}") d++;
    else if (c === "{") { if (d === 0) { awal = j; break; } d--; }
  }
  d = 0;
  for (let j = awal; j < isi.length; j++) {
    const c = isi[j];
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return isi.slice(awal, j + 1); }
  }
  return isi.slice(awal);
}

/** Identifier yang jadi NILAI banding di `.where(...)` — `eq(t.saleId, id)` → `id`. */
function kunciSaring(chain: string): Set<string> {
  const out = new Set<string>();
  for (const m of chain.matchAll(/\beq\(\s*[\w.]+\s*,\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
}

/**
 * Kelas C: bukan "lingkupnya menyebut tenant di suatu tempat" — itu terbukti
 * terlalu longgar (suntikan yang lingkupnya menyebut tenant untuk tabel LAIN
 * dinyatakan aman) — melainkan "kunci yang MENYARING kueri ini ikut dioper ke
 * pemanggilan yang membawa `company_id`", pola `pastikanKartu(jenis, id,
 * auth.company_id!)`.
 */
function indukTerverifikasi(scope: string, chain: string): boolean {
  const kunci = kunciSaring(chain);
  if (!kunci.size) return false;
  for (const m of scope.matchAll(/\b[\w.]+\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const arg = m[1];
    if (!/company_id|companyId/.test(arg)) continue;
    for (const k of kunci) if (new RegExp(`\\b${k}\\b`).test(arg)) return true;
  }
  return false;
}

export type Kelas = "A" | "A2" | "B" | "C" | "E" | "F";

export function kelas(k: Kueri, isiBerkas: string): Kelas {
  if (TENANT.test(k.isi)) return "A";
  for (const id of idWhere(k.isi)) {
    const v = nilaiKonstan(isiBerkas, id);
    if (v && TENANT.test(v)) return "A2";
  }
  if (GLOBAL.some((r) => r.test(k.berkas))) return "E";
  if (/branchId/.test(k.isi)) return "B";
  if (indukTerverifikasi(lingkup(isiBerkas, k), k.isi)) return "C";
  return "F";
}

export function petaKelas(daftar = daftarSumber()) {
  const isi = new Map(daftar.map((d) => [d.nama, d.isi]));
  return semuaKueri(daftar).map((k) => ({ ...k, kelas: kelas(k, isi.get(k.berkas) ?? "") }));
}
