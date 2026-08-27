import { existsSync, readFileSync } from "node:fs";
import { butaKomentar } from "../../src/scripts/buta-komentar";
import { seimbang, type Rute } from "./rute";

/**
 * SIAPA YANG EFEKTIF BISA MASUK TIAP PINTU — dibaca dari tiga sumber.
 *
 * Rumah ini lahir sebagai pindahan, dan sebabnya bisa ditunjuk: ketiga fungsi
 * di bawah dulu hidup DI DALAM `izin-per-rute.test.ts`, dan berkas uji tak
 * bisa diimpor berkas lain — `tsx` menolaknya dengan *"Vitest cannot be
 * imported in a CommonJS module"*. Jadi gerbang KEDUA yang butuh matriks izin
 * (pengurungan cabang: "rute ini dimasuki peran yang terikat cabang atau
 * tidak?") tak punya jalan memakainya selain menyalinnya — dan salinan aturan
 * adalah persis kelas yang ledger ini berulang kali menemukan membusuk.
 *
 * Isinya dipindahkan APA ADANYA. `izin-per-rute.test.ts` mengimpornya kembali;
 * angka-angkanya wajib tak berubah, dan suite itulah buktinya.
 */
export const PERAN = ["owner", "admin", "cashier", "tim", "kitchen", "bar"] as const;
export type Peran = (typeof PERAN)[number];

/** Peran yang TERIKAT ke satu cabang — cermin `terikatCabang` di `middleware/auth.ts`. */
export const TERIKAT_CABANG: readonly string[] = ["cashier", "tim", "kitchen", "bar"];

/**
 * Penjaga prefiks di `app.ts`, dibaca dengan kurung SEIMBANG.
 *
 * Versi pertama memakai `\.use\(\s*"([^"]+)"\s*,\s*([^)]*)\)` — dan `[^)]*`
 * berhenti di `)` PERTAMA, jadi `requireRole("owner", "admin")` tak pernah
 * terbaca: 3 dari 15 penjaga terlihat, dan `/laporan/*` tercatat terbuka untuk
 * keenam peran. Uji PREMIS di `izin-per-rute.test.ts` memaku jumlahnya supaya
 * kebutaan itu tak bisa kembali diam-diam.
 */
export function penjagaPrefiks(app: string): { prefiks: string; peran: Set<string> }[] {
  const out: { prefiks: string; peran: Set<string> }[] = [];
  for (const m of app.matchAll(/\.use\(\s*"([^"]+)"/g)) {
    const jalur = m[1].replace(/\/\*$/, "");
    const mw = seimbang(app, app.indexOf("(", m.index!), "(", ")");
    let peran: Set<string> | null = null;
    const rr = mw.match(/requireRole\(([^)]*)\)/);
    if (rr) peran = new Set([...rr[1].matchAll(/"(\w+)"/g)].map((x) => x[1]));
    else if (mw.includes("izinkanProduksi"))
      peran = new Set(["owner", "admin", "tim", "kitchen", "bar"]);
    else if (mw.includes("izinkanManajemenAtauKaryawanCk"))
      peran = new Set(["owner", "admin", "tim"]);
    else if (mw.includes("requireSuperAdmin")) peran = new Set(["super"]);
    if (peran) out.push({ prefiks: jalur, peran });
  }
  return out;
}

/** Alias tingkat modul: `const bolehAturMeja = requireRole("owner","admin","cashier")`. */
export function aliasPeran(src: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const a of src.matchAll(/const (\w+)\s*=\s*requireRole\(([^)]*)\)/g)) {
    m.set(a[1], new Set([...a[2].matchAll(/"(\w+)"/g)].map((x) => x[1])));
  }
  return m;
}

const cacheAlias = new Map<string, Map<string, Set<string>>>();

/** Alias milik satu berkas modul, di-cache — dibaca ulang tiap berkas sekali. */
export function aliasBerkas(berkas: string): Map<string, Set<string>> {
  let m = cacheAlias.get(berkas);
  if (!m) {
    // Berkas yang tak ada = rute SUNTIKAN milik bukti merah; ia tak punya
    // alias modul, dan itu jawabannya — bukan galat yang ditelan. Rute nyata
    // selalu punya berkas, jadi cabang ini tak pernah menyentuh populasi asli.
    if (!existsSync(berkas)) {
      cacheAlias.set(berkas, new Map());
      return cacheAlias.get(berkas)!;
    }
    m = aliasPeran(butaKomentar(readFileSync(berkas, "utf8")));
    cacheAlias.set(berkas, m);
  }
  return m;
}

/**
 * Peran efektif satu rute = irisan ketiga sumber: penjaga prefiks `app.ts`,
 * `requireRole` di rantai rutenya sendiri, dan ALIAS tingkat modul.
 */
export function peranEfektif(
  r: Rute,
  guards: { prefiks: string; peran: Set<string> }[],
  alias: Map<string, Set<string>>,
): string[] {
  let peran = new Set<string>(PERAN);
  for (const g of guards) {
    if (r.jalur === g.prefiks || r.jalur.startsWith(`${g.prefiks}/`)) {
      if (g.peran.has("super")) return ["super"];
      peran = new Set([...peran].filter((x) => g.peran.has(x)));
    }
  }
  for (const rr of r.isi.matchAll(/requireRole\(([^)]*)\)/g)) {
    const set = new Set([...rr[1].matchAll(/"(\w+)"/g)].map((x) => x[1]));
    peran = new Set([...peran].filter((x) => set.has(x)));
  }
  for (const [nama, set] of alias) {
    if (new RegExp(`\\b${nama}\\b`).test(r.isi)) {
      peran = new Set([...peran].filter((x) => set.has(x)));
    }
  }
  return [...peran].sort();
}
