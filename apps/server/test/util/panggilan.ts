import {
  barisDi,
  deklarasiTerlihat,
  jelajah,
  petaInduk,
  petaLingkup,
  uraikan,
  type Deklarasi,
  type Simpul,
} from "./ast";
import { daftarSumber } from "./kueri-terkurung";

/**
 * GRAF PANGGILAN LINTAS BERKAS — supaya "diputuskan pemanggil" bisa DIBUKTIKAN.
 *
 * Dua gerbang tenant berhenti di tempat yang sama: nilai yang datang lewat
 * PARAMETER. Keduanya menuliskannya "tenant diputuskan pemanggil" lalu
 * menyerahkannya ke daftar pilah-tangan — **31 klaim yang semuanya benar hari
 * ini dan semuanya SNAPSHOT**.
 *
 * Yang tak dijaga apa pun: **pemanggil BARU**. Satu pemanggil `createSale` atau
 * `catatLogFaktur` yang mengisi `companyId` dari badan permintaan tak akan
 * memerahkan apa pun, sebab kedua gerbang hanya membaca situs `insert`/`select`
 * -nya dan tak pernah pemanggilnya. Alasan tulisan tangan ("ketiga pemanggilnya
 * mengurung") membusuk diam-diam pada pemanggil keempat.
 *
 * `ast.ts` sengaja per-berkas. Yang dibutuhkan di sini lintas berkas: siapa
 * memanggil siapa, dan nilai apa yang dioper di situ.
 *
 * BATAS, ditulis di muka: grafnya berdasar NAMA, satu ruang nama untuk seluruh
 * `src`. Nama yang dideklarasikan di lebih dari satu berkas dilaporkan
 * `bertabrakan` dan **tidak** boleh dipakai sebagai bukti — disatukan diam-diam
 * justru cara kelas ini tumbuh kembali.
 */

/**
 * DIMENSI yang ditelusuri graf ini.
 *
 * Mesinnya — titik-tetap, korespondensi argumen, penolakan nama bertabrakan —
 * tak pernah tenant-spesifik; yang tenant-spesifik cuma EMPAT nilai di bawah.
 * Diparameterkan saat dimensi ketiga (**pelaku**) membutuhkan mesin yang sama:
 * `companyId` (putaran 14) dan `branchId` (putaran 16) sudah punya gerbang,
 * `userId` belum, dan menyalin 400 baris graf untuk itu adalah persis kelas
 * yang ledger ini berulang kali menemukan membusuk.
 *
 * Bukti bahwa parameterisasi ini tak menggeser apa pun: suite tenant tetap
 * hijau dengan ANGKA yang sama (20/20 pembantu terbukti, daftar tangan kosong).
 */
export interface Dimensi {
  nama: string;
  /** nama properti/parameter yang MEMBAWA nilai dimensi ini */
  prop: Set<string>;
  /** properti yang dipakai bila slotnya ditemukan lewat tipe/pemakaian */
  propBaku: string;
  /** penanda "nilainya lahir dari TOKEN" */
  auth: RegExp;
  /** penanda "nilainya lahir dari PERMINTAAN" */
  klien: RegExp;
}

const KLIEN_RE = /\bbody\b|\bpayload\b|c\.req|valid\(|\binput\b|\bquery\(/;

export const TENANT: Dimensi = {
  nama: "tenant",
  prop: new Set(["companyId", "company_id"]),
  propBaku: "companyId",
  auth: /auth\.company_id/,
  klien: KLIEN_RE,
};

/** Siapa yang melakukannya — ruas ketiga, sesudah `companyId` dan `branchId`. */
export const PELAKU: Dimensi = {
  nama: "pelaku",
  prop: new Set(["userId", "user_id"]),
  propBaku: "userId",
  auth: /auth\.sub/,
  klien: KLIEN_RE,
};
/** Saringan tenant yang terbaca di dalam sebuah kondisi yang dioper. */
const TENANT_TEKS = /companyId|company_id|companies\.id/;

/** Berkas yang memang bekerja LINTAS perusahaan — pemanggil di sini tak menagih bukti. */
const GLOBAL = [
  /^lib\//, /^seed\//, /^db\//, /^scripts\//, /^app\.ts$/, /^index\.ts$/,
  /^middleware\/auth\.ts$/, /^modules\/auth\//, /^modules\/onboarding\//,
  /^modules\/admin-/, /^modules\/mail\//, /^modules\/users\//,
];

export function berkasGlobal(nama: string): boolean {
  return GLOBAL.some((r) => r.test(nama));
}

interface Berkas {
  nama: string;
  isi: string;
  prog: Simpul;
  induk: Map<Simpul, Simpul>;
  lingkup: Map<Simpul, Map<string, Deklarasi>>;
}

/** Di mana tenant duduk pada daftar parameter sebuah pembantu. */
export interface LetakTenant {
  indeks: number;
  /** nama properti bila parameternya objek (`params.companyId`) */
  properti?: string;
}

export interface Pembantu {
  nama: string;
  berkas: string;
  baris: number;
  letak: LetakTenant | null;
}

export type KelasArgumen = "AUTH" | "KLIEN" | "LEWAT" | "LAIN";

export interface SitusPanggil {
  berkas: string;
  baris: number;
  /** pembantu yang dipanggil */
  nama: string;
  /** pembantu yang MEMUAT situs panggil ini (bila ada) */
  dalam: string | null;
  kelas: KelasArgumen;
  teks: string;
}

const FUNGSI = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function bacaBerkas(kode?: { nama: string; isi: string }[]): Berkas[] {
  const keluar: Berkas[] = [];
  for (const { nama, isi } of kode ?? daftarSumber()) {
    try {
      const prog = uraikan(nama, isi);
      const induk = petaInduk(prog);
      keluar.push({ nama, isi, prog, induk, lingkup: petaLingkup(prog, induk) });
    } catch {
      // Berkas yang tak terurai dilewati DAN dilaporkan lewat jumlah berkas —
      // sapuan yang diam-diam kehilangan berkas adalah kebutaan yang menyamar.
    }
  }
  return keluar;
}

/** Nama pembantu yang MEMUAT simpul ini (fungsi bernama terluar). */
function pembantuPemuat(n: Simpul, b: Berkas): string | null {
  let x: Simpul | undefined = n;
  let nama: string | null = null;
  while (x) {
    if (FUNGSI.has(x.type)) {
      if (x.type === "FunctionDeclaration" && x.id?.type === "Identifier") {
        nama = x.id.name as string;
      } else {
        const up = b.induk.get(x);
        if (up?.type === "VariableDeclarator" && up.id?.type === "Identifier") {
          nama = up.id.name as string;
        }
      }
    }
    x = b.induk.get(x);
  }
  return nama;
}

/** Apakah anotasi tipe sebuah parameter MENYATAKAN properti tenant. */
function tipePunyaTenant(p: Simpul, dim: Dimensi): boolean {
  const anot = p.typeAnnotation?.typeAnnotation ?? p.typeAnnotation;
  if (!anot) return false;
  let punya = false;
  jelajah(anot, (n) => {
    if (punya) return;
    if (n.type !== "TSPropertySignature") return;
    if (n.key?.type === "Identifier" && dim.prop.has(n.key.name)) punya = true;
  });
  return punya;
}

/**
 * Letak tenant pada parameter sebuah fungsi — posisional maupun properti objek.
 *
 * Urutannya penting: **anotasi TIPE diperiksa lebih dulu daripada pemakaian di
 * badan.** `catatHargaMenu(tx, row: { companyId: string; … })` mengoper `row`
 * UTUH ke `.values(row)` dan `denganKlaimIdempoten(p: { companyId: string; … })`
 * meneruskan `p` ke pembantu lain — tak satu pun menulis `row.companyId` di
 * badannya. Mencari slot lewat pemakaian saja memulangkan `null`, dan situs
 * panggilnya lalu tak pernah diperiksa sama sekali. Tipenya ada di pohon; di
 * situlah slotnya dinyatakan.
 */
function letakTenant(fn: Simpul, b: Berkas, dim: Dimensi): LetakTenant | null {
  const params = (fn.params ?? []) as Simpul[];
  for (let i = 0; i < params.length; i += 1) {
    const p = params[i];
    if (p.type === "Identifier" && dim.prop.has(p.name as string)) return { indeks: i };
    if (p.type === "Identifier" && tipePunyaTenant(p, dim))
      return { indeks: i, properti: dim.propBaku };
    if (p.type === "ObjectPattern") {
      for (const prop of p.properties ?? []) {
        if (prop.key?.type === "Identifier" && dim.prop.has(prop.key.name)) {
          return { indeks: i, properti: prop.key.name as string };
        }
      }
    }
    // `params: { companyId, … }` dipakai lewat `params.companyId` di badannya.
    if (p.type === "Identifier") {
      const nama = p.name as string;
      let pakai = false;
      jelajah(fn.body, (n) => {
        if (pakai || n.type !== "MemberExpression" || n.computed) return;
        if (n.object?.type === "Identifier" && n.object.name === nama) {
          if (n.property?.type === "Identifier" && dim.prop.has(n.property.name)) pakai = true;
        }
      });
      if (pakai) return { indeks: i, properti: dim.propBaku };
    }
  }
  return null;
}

/** Ekspresi tenant yang dioper di satu situs panggil, menurut `letak`. */
function argumenTenant(
  panggil: Simpul,
  letak: LetakTenant,
  b: Berkas,
  dim: Dimensi,
): Simpul | undefined {
  const args = (panggil.arguments ?? []) as Simpul[];
  const a = args[letak.indeks];
  if (!a) return undefined;
  if (!letak.properti) return a;
  if (a.type === "ObjectExpression") {
    for (const p of a.properties ?? []) {
      if (p.key?.type === "Identifier" && dim.prop.has(p.key.name)) return p.value ?? p.key;
    }
    return undefined;
  }
  return a;
}

/**
 * Telusuri sebuah ekspresi di lingkupnya sampai ke asalnya (maks 4 lompatan).
 *
 * OBJEK LITERAL DIBUKA SATU TINGKAT, dan itu bukan kemewahan: `tahapSebagian`
 * dipanggil dengan `konteks` — sebuah objek `{ auth, fakturId, tipe, conds, … }`
 * yang teksnya tak menyebut `companyId` sama sekali. Yang menyebutnya `conds`,
 * satu lompatan lagi ke dalam. Tanpa ini dua pembantu produksi menggantung
 * "belum terbukti" padahal buktinya ada, cuma satu tingkat lebih dalam.
 */
function asalTeks(n: Simpul, b: Berkas, dim: Dimensi, dalam = 0): string {
  const teks = b.isi.slice(n.start, n.end);
  // Enam lompatan, bukan empat: rantai terpanjang yang NYATA di repo ini ada
  // enam — `konteks` → objek literalnya → properti ringkas `conds` → deklarasi
  // `const conds = [...]`. Dengan batas empat, dua pembantu produksi
  // menggantung "belum terbukti" padahal buktinya cuma lebih dalam.
  if (dalam > 5) return teks;
  // Objek dibuka LEBIH DULU daripada penanda auth/klien diuji. Sebabnya nyata:
  // `{ auth, fakturId, tipe, conds, body: c.req.valid("json") }` memuat penanda
  // KLIEN pada properti `body` yang sama sekali bukan tenant-nya — menghentikan
  // penelusuran di situ membuat `conds` (yang justru membawa saringan tenant)
  // tak pernah terbaca. Arah TULIS tak terpengaruh: di sana properti
  // `companyId`-nya diambil lebih dulu, jadi objek utuh tak pernah ditelusuri.
  if (n.type === "ObjectExpression") {
    const bagian = (n.properties ?? [])
      .map((p: Simpul) => (p.value ? asalTeks(p.value, b, dim, dalam + 1) : ""))
      .join(" , ");
    return `${teks} , ${bagian}`;
  }
  if (dim.auth.test(teks) || dim.klien.test(teks)) return teks;
  const pangkal = n.type === "MemberExpression" ? n.object : n;
  if (pangkal?.type !== "Identifier") return teks;
  const d = deklarasiTerlihat(pangkal, pangkal.name as string, b.induk, b.lingkup);
  if (!d?.nilai) return teks;
  return asalTeks(d.nilai, b, dim, dalam + 1);
}

export interface SitusKondisi {
  berkas: string;
  baris: number;
  indeks: number;
  dalam: string | null;
  teks: string;
  jejak: string;
}

export interface Graf {
  pembantu: Map<string, Pembantu[]>;
  panggilan: Map<string, SitusPanggil[]>;
  /** tiap argumen di tiap situs panggil — dipakai arah BACA (kondisi) */
  kondisi: Map<string, SitusKondisi[]>;
  /** nama yang dideklarasikan di lebih dari satu berkas — tak boleh jadi bukti */
  bertabrakan: string[];
  jumlahBerkas: number;
  /** dimensi yang ditelusuri graf ini — `buktikan` tak boleh mencampurnya */
  dim: Dimensi;
}

/**
 * `tambahan` disuntikkan DI ATAS pohon nyata — dipakai bukti merah: satu
 * pemanggil baru yang mengoper tenant dari permintaan harus membuat pembantunya
 * berhenti terbukti.
 */
export function grafPanggilan(
  tambahan?: { nama: string; isi: string }[],
  dim: Dimensi = TENANT,
): Graf {
  const berkas = bacaBerkas(tambahan ? [...daftarSumber(), ...tambahan] : undefined);
  const pembantu = new Map<string, Pembantu[]>();
  for (const b of berkas) {
    jelajah(b.prog, (n) => {
      let fn: Simpul | undefined;
      let nama: string | undefined;
      if (n.type === "FunctionDeclaration" && n.id?.type === "Identifier") {
        fn = n;
        nama = n.id.name as string;
      } else if (
        n.type === "VariableDeclarator" &&
        n.id?.type === "Identifier" &&
        (n.init?.type === "ArrowFunctionExpression" || n.init?.type === "FunctionExpression")
      ) {
        fn = n.init;
        nama = n.id.name as string;
      }
      if (!fn || !nama) return;
      const daftar = pembantu.get(nama) ?? [];
      daftar.push({
        nama,
        berkas: b.nama,
        baris: barisDi(b.isi, n.start),
        letak: letakTenant(fn, b, dim),
      });
      pembantu.set(nama, daftar);
    });
  }

  const panggilan = new Map<string, SitusPanggil[]>();
  for (const b of berkas) {
    jelajah(b.prog, (n) => {
      if (n.type !== "CallExpression" || n.callee?.type !== "Identifier") return;
      const nama = n.callee.name as string;
      const dek = pembantu.get(nama);
      if (!dek?.length) return;
      const letak = dek[0].letak;
      const arg = letak ? argumenTenant(n, letak, b, dim) : undefined;
      const teks = arg ? b.isi.slice(arg.start, arg.end) : "";
      const jejak = arg ? asalTeks(arg, b, dim) : "";
      const kelas: KelasArgumen = !arg
        ? "LAIN"
        : dim.auth.test(jejak) || dim.auth.test(teks)
          ? "AUTH"
          : dim.klien.test(jejak) || dim.klien.test(teks)
            ? "KLIEN"
            : "LEWAT";
      const daftar = panggilan.get(nama) ?? [];
      daftar.push({
        berkas: b.nama,
        baris: barisDi(b.isi, n.start),
        nama,
        dalam: pembantuPemuat(n, b),
        kelas,
        teks: teks.replace(/\s+/g, " ").slice(0, 60),
      });
      panggilan.set(nama, daftar);
    });
  }

  const kondisi = new Map<string, SitusKondisi[]>();
  for (const b of berkas) {
    jelajah(b.prog, (n) => {
      if (n.type !== "CallExpression" || n.callee?.type !== "Identifier") return;
      const nama = n.callee.name as string;
      if (!pembantu.has(nama)) return;
      const daftar = kondisi.get(nama) ?? [];
      (n.arguments ?? []).forEach((a: Simpul, i: number) => {
        daftar.push({
          berkas: b.nama,
          baris: barisDi(b.isi, n.start),
          indeks: i,
          dalam: pembantuPemuat(n, b),
          teks: b.isi.slice(a.start, a.end).replace(/\s+/g, " ").slice(0, 70),
          jejak: asalTeks(a, b, dim).replace(/\s+/g, " ").slice(0, 200),
        });
      });
      kondisi.set(nama, daftar);
    });
  }

  const bertabrakan = [...pembantu.entries()]
    .filter(([, d]) => new Set(d.map((x) => x.berkas)).size > 1)
    .map(([n]) => n);

  return { pembantu, panggilan, kondisi, bertabrakan, jumlahBerkas: berkas.length, dim };
}

export interface HasilBukti {
  terbukti: Set<string>;
  /** pembantu → kenapa ia BELUM terbukti */
  belum: Map<string, string>;
  putaran: number;
}

/**
 * TITIK-TETAP. Sebuah pembantu TERBUKTI bila tiap situs panggilnya mengoper
 * tenant yang (a) menelusur ke `auth.company_id`, (b) berada di berkas kelas E,
 * atau (c) merupakan tenant milik pembantu yang SUDAH terbukti.
 *
 * Diulang sampai stabil, sebab (c) baru bisa dinilai setelah lapisan di atasnya
 * selesai: `catatLogFaktur` baru terbukti sesudah `rencana.ts` terbukti.
 *
 * Yang TIDAK dianggap bukti, dan itu disengaja:
 * - pembantu tanpa satu pun situs panggil yang terbaca → **belum terbukti**,
 *   bukan bersih. Tak ada pemanggil berarti tak ada yang bisa diperiksa;
 * - nama yang bertabrakan antar berkas → belum terbukti;
 * - satu saja situs panggil ber-kelas `KLIEN` → seluruh pembantunya gugur.
 */
export function buktikan(graf: Graf, kandidatAwal: string[]): HasilBukti {
  const terbukti = new Set<string>();
  const belum = new Map<string, string>();
  const tabrakan = new Set(graf.bertabrakan);
  // Himpunan kandidat WAJIB tertutup atas pemanggil: syarat (c) menanyakan
  // "apakah pembantu yang MEMUAT situs panggil ini sudah terbukti", dan
  // pertanyaan itu mustahil benar kalau pemanggilnya tak pernah dinilai. Empat
  // pembantu `perlengkapan/service.ts` menggantung persis karena itu.
  const kandidat = new Set(kandidatAwal);
  for (;;) {
    const sebelum = kandidat.size;
    for (const nama of [...kandidat]) {
      for (const s of graf.panggilan.get(nama) ?? []) {
        if (s.kelas === "LEWAT" && s.dalam) kandidat.add(s.dalam);
      }
    }
    if (kandidat.size === sebelum) break;
  }
  let putaran = 0;
  for (;;) {
    putaran += 1;
    let berubah = false;
    belum.clear();
    for (const nama of kandidat) {
      if (terbukti.has(nama)) continue;
      if (tabrakan.has(nama)) {
        belum.set(nama, "namanya dideklarasikan di lebih dari satu berkas");
        continue;
      }
      const situs = graf.panggilan.get(nama) ?? [];
      if (situs.length === 0) {
        belum.set(nama, "tak ada situs panggil yang terbaca");
        continue;
      }
      const sisa: string[] = [];
      for (const s of situs) {
        if (s.kelas === "AUTH") continue;
        if (berkasGlobal(s.berkas)) continue;
        if (s.kelas === "LEWAT" && s.dalam && terbukti.has(s.dalam)) continue;
        sisa.push(`${s.berkas}:${s.baris} [${s.kelas}]${s.teks ? " ← " + s.teks : ""}`);
      }
      if (sisa.length === 0) {
        terbukti.add(nama);
        berubah = true;
      } else {
        belum.set(nama, sisa.join(" ; "));
      }
    }
    if (!berubah) return { terbukti, belum, putaran };
  }
}

/**
 * BUKTI untuk arah BACA: pembantu yang menerima KONDISI lewat parameter.
 *
 * Bentuknya beda dari arah tulis. `tahapSebagian(k: KonteksTahap)` tak menerima
 * `companyId` melainkan `conds` — LARIK KONDISI yang sudah dirakit pemanggilnya.
 * Yang harus dibuktikan karena itu bukan "nilainya dari token" melainkan
 * **"kondisi yang dioper memuat saringan tenant"**.
 *
 * Aturannya sama ketatnya: tiap situs panggil harus mengoper argumen yang
 * (a) teksnya — atau asal-usulnya di lingkupnya — memuat `companyId`, atau
 * (b) berada di berkas kelas E, atau (c) merupakan parameter kondisi milik
 * pembantu yang sudah terbukti. Tanpa situs panggil = **belum terbukti**.
 */
export function buktikanKondisi(
  graf: Graf,
  target: { nama: string; indeks: number }[],
): HasilBukti {
  const terbukti = new Set<string>();
  const belum = new Map<string, string>();
  const tabrakan = new Set(graf.bertabrakan);
  const indeksOf = new Map(target.map((t) => [t.nama, t.indeks]));
  let putaran = 0;
  for (;;) {
    putaran += 1;
    let berubah = false;
    belum.clear();
    for (const { nama } of target) {
      if (terbukti.has(nama)) continue;
      if (tabrakan.has(nama)) {
        belum.set(nama, "namanya dideklarasikan di lebih dari satu berkas");
        continue;
      }
      const situs = graf.kondisi.get(nama) ?? [];
      if (situs.length === 0) {
        belum.set(nama, "tak ada situs panggil yang terbaca");
        continue;
      }
      const sisa: string[] = [];
      for (const s of situs) {
        if (s.indeks !== indeksOf.get(nama)) continue;
        if (TENANT_TEKS.test(s.jejak) || TENANT_TEKS.test(s.teks)) continue;
        if (berkasGlobal(s.berkas)) continue;
        if (s.dalam && terbukti.has(s.dalam)) continue;
        sisa.push(`${s.berkas}:${s.baris} ← ${s.teks}`);
      }
      if (sisa.length === 0) {
        terbukti.add(nama);
        berubah = true;
      } else {
        belum.set(nama, sisa.join(" ; "));
      }
    }
    if (!berubah) return { terbukti, belum, putaran };
  }
}
