import { parseSync } from "rolldown/experimental";

/**
 * POHON SINTAKS SUNGGUHAN — rumah bersama untuk penyapu sumber.
 *
 * KENAPA BERKAS INI ADA. Tiap penyapu di suite ini menebak batas sintaks dengan
 * hitungan kurung dan jendela baris, dan ledger mencatat harganya tiap putaran,
 * selalu dengan nama:
 *
 * - **26 tuduhan palsu** pada sapuan tanggal (pembantu bernama tak terlihat);
 * - satu "templat" menelan **141 baris** `lib/backup.ts` — literal regex
 *   `/"/g` dibaca sebagai pembuka string;
 * - **14 dari 22** tuduhan cacat karena `rfind` memulangkan −1 di kepala berkas
 *   sehingga jendelanya kosong;
 * - **99 dari 101** panggilan async tertuduh palsu — argumen `Promise.all`
 *   disangka pernyataan;
 * - **empat generasi** pemindai telanan galat, satu putaran, sebelum satu
 *   tuduhan pun boleh ditulis.
 *
 * Semuanya kelas yang sama: PENGURAI YANG DIKIRA-KIRA. `butaKomentar` ada
 * persis karena itu — ia menambal gejala, bukan sebabnya.
 *
 * Yang dipakai di sini mengurai TypeScript sungguhan. Jalur pengecek TIPE tetap
 * tertutup — TypeScript 7 yang terpasang adalah port Go dan API JS-nya hanya
 * `version` — tapi POHON-nya sudah cukup untuk membunuh seluruh kelas di atas
 * secara konstruksi: pernyataan induk, rantai panggilan, dan LINGKUP sebuah
 * nama berhenti jadi taksiran.
 *
 * BATAS YANG DIJANJIKAN, dan yang tidak:
 * - dijanjikan: bentuk sintaks — pernyataan, rantai, deklarasi, lingkup;
 * - TIDAK dijanjikan: tipe. "Apakah ekspresi ini Promise", "apakah `x` itu
 *   `number`" tetap di luar jangkauan, dan penyapu yang membutuhkannya harus
 *   menuliskan taksirannya sendiri secara terbuka.
 */

/** Simpul ESTree apa adanya — sengaja longgar; penyapu memeriksa `type`. */
export interface Simpul {
  type: string;
  start: number;
  end: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

/**
 * Urai satu berkas. MELEMPAR bila parsernya menolak — sapuan yang diam-diam
 * memulangkan nol karena berkasnya gagal diurai adalah kebutaan yang menyamar
 * jadi kebersihan, dan itu kelas yang sudah dibayar ledger ini.
 */
export function uraikan(jalur: string, isi: string): Simpul {
  const hasil = parseSync(jalur, isi) as unknown as {
    program: Simpul;
    errors?: { message?: string }[];
  };
  const galat = hasil.errors ?? [];
  if (galat.length > 0) {
    throw new Error(
      `Parser menolak ${jalur}: ${galat.map((e) => e.message ?? String(e)).join(" | ")}`,
    );
  }
  if (!hasil.program || hasil.program.type !== "Program") {
    throw new Error(`Parser tak memulangkan Program untuk ${jalur}`);
  }
  return hasil.program;
}

const BUKAN_SIMPUL = new Set(["type", "start", "end"]);

/** Jelajah pra-urut. `fn` dipanggil untuk tiap simpul ber-`type`. */
export function jelajah(akar: unknown, fn: (n: Simpul) => void): void {
  const antre = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) antre(x);
      return;
    }
    const s = n as Simpul;
    if (typeof s.type === "string") fn(s);
    for (const k of Object.keys(s)) {
      if (BUKAN_SIMPUL.has(k)) continue;
      antre(s[k]);
    }
  };
  antre(akar);
}

/** Peta anak → induk. Oxc tak memberi penunjuk induk, jadi disusun sekali. */
export function petaInduk(akar: Simpul): Map<Simpul, Simpul> {
  const peta = new Map<Simpul, Simpul>();
  const turun = (n: unknown, induk: Simpul | null): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) turun(x, induk);
      return;
    }
    const s = n as Simpul;
    const punyaTipe = typeof s.type === "string";
    if (punyaTipe && induk) peta.set(s, induk);
    for (const k of Object.keys(s)) {
      if (BUKAN_SIMPUL.has(k)) continue;
      turun(s[k], punyaTipe ? s : induk);
    }
  };
  turun(akar, null);
  return peta;
}

const PERNYATAAN = /Statement$|^VariableDeclaration$|Declaration$/;

/**
 * Pernyataan yang MEMUAT simpul ini — pengganti pasti `awalPernyataan`.
 *
 * Versi kurung-mundurnya punya dua kegagalan yang tercatat: berhenti di `{`
 * mana pun (memotong daftar SELECT-nya sendiri), dan menelan kueri tetangga
 * ketika jendelanya terlalu lebar. Di sini "pernyataan induk" tak ditaksir.
 */
export function pernyataanInduk(
  n: Simpul,
  induk: Map<Simpul, Simpul>,
): Simpul | undefined {
  let k: Simpul | undefined = n;
  while (k) {
    if (PERNYATAAN.test(k.type)) return k;
    k = induk.get(k);
  }
  return undefined;
}

/**
 * Rantai panggilan TERLUAR yang memuat simpul ini — pengganti pasti
 * `ekorPernyataan`.
 *
 * `db.select(...).from(x).where(...)` adalah SATU ekspresi; versi teksnya harus
 * berhenti di koma kedalaman nol supaya dua kueri di dalam `Promise.all([a, b])`
 * tak saling menelan — dan itu taksiran yang pernah menghitung dua kueri lebih
 * sedikit dari yang sebenarnya. Di pohon, batasnya adalah simpulnya sendiri.
 */
export function rantaiPenuh(n: Simpul, induk: Map<Simpul, Simpul>): Simpul {
  let k = n;
  for (;;) {
    const atas = induk.get(k);
    if (!atas) return k;
    // Naik selama kita masih BAGIAN KIRI rantainya (obyek/callee), bukan
    // argumen milik panggilan lain.
    if (atas.type === "MemberExpression" && atas.object === k) {
      k = atas;
      continue;
    }
    if (atas.type === "CallExpression" && atas.callee === k) {
      k = atas;
      continue;
    }
    if (atas.type === "TSNonNullExpression" && atas.expression === k) {
      k = atas;
      continue;
    }
    return k;
  }
}

/** Simpul pembuat LINGKUP — blok, fungsi, dan yang punya kepala sendiri. */
const LINGKUP = new Set([
  "Program",
  "BlockStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "CatchClause",
  "ClassDeclaration",
  "ClassExpression",
  "TSModuleBlock",
]);

export interface Deklarasi {
  nama: string;
  /** simpul nilainya: `init` sebuah declarator, atau fungsi itu sendiri */
  nilai: Simpul | undefined;
  /** deklarasi fungsi (di-hoist ke seluruh lingkupnya) */
  fungsi: boolean;
}

/**
 * Resolusi nama per-LINGKUP — yang benar-benar tak bisa ditiru regex.
 *
 * Pemindai lama memakai "deklarasi TERDEKAT SEBELUM situsnya di berkas yang
 * sama", dan menuliskan sendiri kenapa itu rapuh: `conds` dideklarasikan
 * SEMBILAN kali di satu berkas. Aturan teks itu benar hanya selama tiap
 * deklarasi kebetulan berada di atas pemakainya; ia tak tahu apa-apa tentang
 * blok, argumen fungsi, atau bayangan nama.
 */
export function petaLingkup(akar: Simpul, induk: Map<Simpul, Simpul>): Map<Simpul, Map<string, Deklarasi>> {
  const lingkup = new Map<Simpul, Map<string, Deklarasi>>();
  const daftar = (l: Simpul, d: Deklarasi): void => {
    let m = lingkup.get(l);
    if (!m) {
      m = new Map();
      lingkup.set(l, m);
    }
    m.set(d.nama, d);
  };
  const lingkupDari = (n: Simpul): Simpul => {
    let k: Simpul | undefined = induk.get(n);
    while (k) {
      if (LINGKUP.has(k.type)) return k;
      k = induk.get(k);
    }
    return akar;
  };
  jelajah(akar, (n) => {
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier") {
      daftar(lingkupDari(n), { nama: n.id.name, nilai: n.init ?? undefined, fungsi: false });
    } else if (n.type === "FunctionDeclaration" && n.id?.type === "Identifier") {
      daftar(lingkupDari(n), { nama: n.id.name, nilai: n, fungsi: true });
    }
  });
  return lingkup;
}

/** Deklarasi yang BERLAKU untuk `nama` di posisi `n` (menaiki rantai lingkup). */
export function deklarasiTerlihat(
  n: Simpul,
  nama: string,
  induk: Map<Simpul, Simpul>,
  lingkup: Map<Simpul, Map<string, Deklarasi>>,
): Deklarasi | undefined {
  let k: Simpul | undefined = n;
  while (k) {
    if (LINGKUP.has(k.type)) {
      const d = lingkup.get(k)?.get(nama);
      if (d) return d;
    }
    k = induk.get(k);
  }
  return undefined;
}

/** Nama properti sebuah `MemberExpression` non-terhitung, atau `undefined`. */
export function namaProperti(n: Simpul): string | undefined {
  if (n.type !== "MemberExpression" || n.computed) return undefined;
  return n.property?.type === "Identifier" ? (n.property.name as string) : undefined;
}

/** Apakah di dalam `n` ada `<apa saja>.<kolom>` — mis. `sales.deletedAt`. */
export function menyentuhProperti(n: Simpul | undefined, kolom: string): boolean {
  if (!n) return false;
  let ketemu = false;
  jelajah(n, (x) => {
    if (!ketemu && namaProperti(x) === kolom) ketemu = true;
  });
  return ketemu;
}

/** Nomor baris (1-based) untuk offset. */
export function barisDi(isi: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < isi.length; i += 1) if (isi[i] === "\n") n += 1;
  return n;
}
