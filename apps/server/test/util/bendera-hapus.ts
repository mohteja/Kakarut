import { butaKomentar } from "../../src/scripts/buta-komentar";
import {
  awalPernyataan,
  badanPembantu,
  ekorPernyataan,
  sumberServer,
  tanpaSubkueri,
  templateSql,
} from "./sql-mentah";

/**
 * BENDERA "BARIS INI TIDAK BERLAKU LAGI" — instrumen sapuan.
 *
 * Basis data ini punya empat bendera untuk baris yang sudah dinyatakan tidak
 * berlaku, dan tak satu pun punya rumah: aturannya ditulis ulang di tiap situs
 * (`isNull(sales.deletedAt)` 21×, `productions` 34×, `memberships.archivedAt`
 * 20×+). Yang dijaga berkas ini: pintu BARU yang lupa menyaringnya menagih
 * keputusan, bukan lewat diam-diam — sebab yang ikut terhitung adalah UANG
 * (omzet memuat penjualan yang sudah dibuang ke Tempat Sampah), STOK (konsumsi
 * faktur yang dibuang), dan ATRIBUSI KERJA (pekerjaan ditugaskan kepada orang
 * yang sudah keluar).
 *
 * `users.deletedAt` SENGAJA di luar populasi ini, dan alasannya diukur: enam
 * jalur auth (`session.ts`, `login`, `verifikasi`, `reset`, `kirim-ulang`,
 * `superadmin.ts`) sudah menyaringnya, sementara ~20 sentuhan sisanya adalah
 * JOIN UNTUK NAMA (`deletedBy`, `dikerjakan_oleh`, `pesanan_status_oleh`) —
 * di situ menyaring justru SALAH: riwayat yang menghilangkan barisnya sendiri
 * lebih buruk daripada riwayat tanpa nama, dan komentar `laporan/routes.ts`
 * sudah menuliskan aturan itu lebih dulu.
 */
export interface Bendera {
  /** properti drizzle, mis. `deletedAt` */
  kolom: string;
  /** kolom SQL mentah, mis. `deleted_at` */
  snake: string;
  /** tabel anak yang TAK punya bendera sendiri — hanya sah lewat induknya */
  anak: string[];
  anakSnake: string[];
  tabelSnake: string;
}

export const BENDERA: Record<string, Bendera> = {
  sales: {
    kolom: "deletedAt",
    snake: "deleted_at",
    tabelSnake: "sales",
    anak: ["saleItems", "saleConsumptions"],
    anakSnake: ["sale_items", "sale_consumptions"],
  },
  productions: {
    kolom: "deletedAt",
    snake: "deleted_at",
    tabelSnake: "productions",
    anak: ["productionConsumptions"],
    anakSnake: ["production_consumptions"],
  },
  memberships: {
    kolom: "archivedAt",
    snake: "archived_at",
    tabelSnake: "memberships",
    anak: [],
    anakSnake: [],
  },
};

export type KelasBendera = "MENYARING" | "LEWAT_VARIABEL" | "MENULIS" | "TELANJANG";

export interface Situs {
  berkas: string;
  baris: number;
  induk: string;
  tabel: string;
  bentuk: "drizzle" | "sql";
  kelas: KelasBendera;
  potongan: string;
}

/**
 * Nama yang MEMBAWA saringannya sendiri: `const filter = and(…isNull(x)…)`,
 * `const conds = [ … isNull(x) … ]`, MAUPUN
 * `function kondisiFaktur(…) { … isNull(x) … }`.
 *
 * Tiga jebakan yang sudah menggigit sapuan-sapuan sebelum ini, ditutup di muka:
 *
 * 1. **Pembantu bernama.** Tanpa cabang `function`, dua pintu penerimaan yang
 *    saringannya hidup di `kondisiFaktur()` tertuduh keliru. Kelas yang sama
 *    memakan 26 tuduhan pada sapuan tanggal putaran lalu.
 * 2. **Literal larik.** `ekorPernyataan` hanya menghitung KURUNG, jadi
 *    `const conds = [a, b]` terpotong di koma pertama dan `isNull(...)` di
 *    baris berikutnya tak terlihat — sepuluh pintu produksi tertuduh keliru.
 *    Nilai deklarasi karena itu dibaca dengan `[`/`{`/`(` sekaligus.
 * 3. **Nama yang dipakai ulang.** `conds` dideklarasikan sembilan kali di satu
 *    berkas. Satu deklarasi bersaringan tak boleh memaafkan delapan lainnya,
 *    jadi yang dipakai adalah deklarasi TERDEKAT SEBELUM situsnya (fungsi
 *    di-hoist, jadi ia berlaku di mana pun di berkasnya).
 */
interface Deklarasi {
  nama: string;
  pos: number;
  fungsi: boolean;
  menyaring: boolean;
}

/** Nilai deklarasi: seimbang `(`/`[`/`{`, berhenti di `;` atau `,` kedalaman 0. */
function nilaiDeklarasi(s: string, mulai: number, maks = 2000): string {
  let d = 0;
  let keluar = "";
  for (let j = mulai; j < s.length && keluar.length < maks; j += 1) {
    const c = s[j];
    if (c === "(" || c === "[" || c === "{") d += 1;
    else if (c === ")" || c === "]" || c === "}") {
      d -= 1;
      if (d < 0) break;
    } else if ((c === ";" || c === ",") && d === 0) break;
    keluar += c;
  }
  return keluar;
}

/** Badan `function` berimbang kurawal, dari posisi kata kuncinya. */
function badanFungsi(s: string, i: number): string {
  const buka = s.indexOf("{", s.indexOf("(", i));
  if (buka < 0) return "";
  let d = 0;
  for (let j = buka; j < s.length; j += 1) {
    if (s[j] === "{") d += 1;
    else if (s[j] === "}") {
      d -= 1;
      if (d === 0) return s.slice(buka, j + 1);
    }
  }
  return s.slice(buka);
}

function deklarasiPenyaring(s: string, b: Bendera): Deklarasi[] {
  const keluar: Deklarasi[] = [];
  for (const m of s.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*/g)) {
    const nilai = nilaiDeklarasi(s, m.index! + m[0].length);
    keluar.push({ nama: m[1], pos: m.index!, fungsi: false, menyaring: nilai.includes(`.${b.kolom}`) });
  }
  for (const m of s.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
    const badan = badanFungsi(s, m.index!);
    keluar.push({ nama: m[1], pos: m.index!, fungsi: true, menyaring: badan.includes(`.${b.kolom}`) });
  }
  return keluar;
}

/** Deklarasi yang BERLAKU untuk `nama` di posisi `pos` (fungsi di-hoist). */
function berlaku(deks: Deklarasi[], nama: string, pos: number): Deklarasi | undefined {
  const f = deks.find((d) => d.fungsi && d.nama === nama);
  if (f) return f;
  let pilih: Deklarasi | undefined;
  for (const d of deks) {
    if (d.nama !== nama || d.pos >= pos) continue;
    if (!pilih || d.pos > pilih.pos) pilih = d;
  }
  return pilih;
}

function kelasDrizzle(
  rantai: string,
  pos: number,
  b: Bendera,
  deks: Deklarasi[],
): KelasBendera {
  if (/\.(update|insert|delete)\s*\(/.test(rantai)) return "MENULIS";
  if (rantai.includes(`.${b.kolom}`)) return "MENYARING";
  for (const m of rantai.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (berlaku(deks, m[1], pos)?.menyaring) return "LEWAT_VARIABEL";
  }
  return "TELANJANG";
}

/** Rantai drizzle yang menyentuh tabel berbendera (atau anaknya). */
function situsDrizzle(nama: string, mentah: string): Situs[] {
  const s = butaKomentar(mentah);
  const keluar: Situs[] = [];
  for (const [induk, b] of Object.entries(BENDERA)) {
    const deks = deklarasiPenyaring(s, b);
    const tabelDicari = [induk, ...b.anak];
    // Satu PERNYATAAN dinilai sekali: `.from(saleItems).innerJoin(sales, …)`
    // adalah satu kueri, bukan dua situs.
    const sudah = new Set<number>();
    for (const m of s.matchAll(/\.(from|innerJoin|leftJoin|rightJoin)\(\s*(\w+)\s*[,)]/g)) {
      const tabel = m[2];
      if (!tabelDicari.includes(tabel)) continue;
      const awal = awalPernyataan(s, m.index!);
      if (sudah.has(awal)) continue;
      sudah.add(awal);
      const rantai = s.slice(awal, m.index!) + ekorPernyataan(s, m.index!, 3000);
      keluar.push({
        berkas: nama,
        baris: s.slice(0, m.index!).split("\n").length,
        induk,
        tabel,
        bentuk: "drizzle",
        kelas: kelasDrizzle(rantai, m.index!, b, deks),
        potongan: rantai.replace(/\s+/g, " ").slice(0, 220),
      });
    }
  }
  return keluar;
}

/** Pernyataan SQL mentah yang dijalankan (`.execute(sql`…`)`). */
function situsSqlMentah(nama: string, mentah: string): Situs[] {
  const s = butaKomentar(mentah);
  const keluar: Situs[] = [];
  for (const { pos, isi } of templateSql(s)) {
    if (!/\.execute\(\s*$/.test(s.slice(Math.max(0, pos - 40), pos))) continue;
    let penuh = isi;
    for (const m of isi.matchAll(/\$\{\s*(\w+)\s*\(/g)) penuh += `\n${badanPembantu(s, m[1])}`;
    const rata = tanpaSubkueri(penuh);
    const menulis = /^\s*(?:\$\{[^}]*\}\s*)*(INSERT|UPDATE|DELETE)\b/i.test(rata);
    for (const [induk, b] of Object.entries(BENDERA)) {
      const dicari = [b.tabelSnake, ...b.anakSnake];
      const kena = dicari.find((t) => new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, "i").test(penuh));
      if (!kena) continue;
      keluar.push({
        berkas: nama,
        baris: s.slice(0, pos).split("\n").length,
        induk,
        tabel: kena,
        bentuk: "sql",
        kelas: menulis
          ? "MENULIS"
          : new RegExp(`\\b${b.snake}\\b`, "i").test(penuh)
            ? "MENYARING"
            : "TELANJANG",
        potongan: penuh.replace(/\s+/g, " ").slice(0, 220),
      });
    }
  }
  return keluar;
}

export function situsBendera(kode?: { nama: string; isi: string }[]): Situs[] {
  const berkas = kode ?? sumberServer();
  const keluar: Situs[] = [];
  for (const { nama, isi } of berkas) {
    keluar.push(...situsDrizzle(nama, isi), ...situsSqlMentah(nama, isi));
  }
  return keluar;
}

export function kunciSitus(x: Situs): string {
  return `${x.berkas}:${x.baris} ${x.bentuk} ${x.tabel}<${x.induk}>`;
}
