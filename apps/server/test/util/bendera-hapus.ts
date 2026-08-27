import {
  barisDi,
  deklarasiTerlihat,
  jelajah,
  menyentuhProperti,
  namaProperti,
  petaInduk,
  petaLingkup,
  rantaiPenuh,
  uraikan,
  type Deklarasi,
  type Simpul,
} from "./ast";
import { sumberServer, tanpaSubkueri } from "./sql-mentah";

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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DITULIS ULANG DI ATAS POHON SINTAKS (2026-08-27), dan alasannya tercatat.
 *
 * Versi pertama menebak batas sintaks dengan hitungan kurung, dan salah TIGA
 * KALI sebelum satu tuduhan pun boleh ditulis:
 *
 * 1. **Pembantu bernama** tak diikuti → dua pintu penerimaan yang saringannya
 *    hidup di `kondisiFaktur()` tertuduh keliru.
 * 2. **Literal larik**: `ekorPernyataan` hanya menghitung KURUNG, jadi
 *    `const conds = [a, b]` terpotong di koma pertama — sepuluh pintu produksi
 *    tertuduh keliru.
 * 3. **Batas pernyataan** berhenti di `{` mana pun, memotong daftar SELECT-nya
 *    sendiri: `db.select({ archivedAt: memberships.archivedAt })` terbaca
 *    telanjang padahal benderanya ada di kepala kueri.
 *
 * Ketiganya lenyap secara konstruksi di sini: "rantai penuh" adalah simpul,
 * bukan potongan teks. Yang keempat tak pernah bisa ditambal teks sama sekali
 * dan itulah untung terbesarnya — **LINGKUP**. Aturan lama memakai "deklarasi
 * TERDEKAT SEBELUM situsnya di berkas yang sama", padahal `conds`
 * dideklarasikan sembilan kali di satu berkas: dua kueri yang bentuk teksnya
 * identik bisa memakai `conds` yang BERBEDA, dan hanya rantai lingkup yang
 * tahu yang mana.
 * ─────────────────────────────────────────────────────────────────────────
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

/** Satu berkas yang sudah diurai, beserta peta induk & lingkupnya. */
interface Konteks {
  nama: string;
  isi: string;
  prog: Simpul;
  induk: Map<Simpul, Simpul>;
  lingkup: Map<Simpul, Map<string, Deklarasi>>;
}

function konteks(nama: string, isi: string): Konteks {
  const prog = uraikan(nama.endsWith(".tsx") ? nama : `${nama}.ts`, isi);
  const induk = petaInduk(prog);
  return { nama, isi, prog, induk, lingkup: petaLingkup(prog, induk) };
}

const AMBIL = new Set(["from", "innerJoin", "leftJoin", "rightJoin"]);
const MENULIS_DRIZZLE = new Set(["update", "insert", "delete"]);

/** Identifier yang benar-benar RUJUKAN nama — bukan nama properti / kunci objek. */
function rujukan(akar: Simpul, induk: Map<Simpul, Simpul>): Simpul[] {
  const keluar: Simpul[] = [];
  jelajah(akar, (n) => {
    if (n.type !== "Identifier") return;
    const atas = induk.get(n);
    if (!atas) return;
    if (atas.type === "MemberExpression" && !atas.computed && atas.property === n) return;
    if (atas.type === "Property" && atas.key === n && !atas.computed) return;
    keluar.push(n);
  });
  return keluar;
}

function kelasDrizzle(rantai: Simpul, b: Bendera, k: Konteks): KelasBendera {
  let menulis = false;
  jelajah(rantai, (n) => {
    if (n.type !== "CallExpression") return;
    const p = n.callee ? namaProperti(n.callee) : undefined;
    if (p && MENULIS_DRIZZLE.has(p)) menulis = true;
  });
  if (menulis) return "MENULIS";
  if (menyentuhProperti(rantai, b.kolom)) return "MENYARING";
  for (const id of rujukan(rantai, k.induk)) {
    const d = deklarasiTerlihat(id, id.name as string, k.induk, k.lingkup);
    if (d && menyentuhProperti(d.nilai, b.kolom)) return "LEWAT_VARIABEL";
  }
  return "TELANJANG";
}

/** Rantai drizzle yang menyentuh tabel berbendera (atau anaknya). */
function situsDrizzle(k: Konteks): Situs[] {
  const keluar: Situs[] = [];
  for (const [indukNama, b] of Object.entries(BENDERA)) {
    const dicari = [indukNama, ...b.anak];
    // Satu RANTAI dinilai sekali: `.from(saleItems).innerJoin(sales, …)` adalah
    // satu kueri, bukan dua situs. Kuncinya simpul rantainya, bukan offset.
    // Satu rantai dicatat sekali, dan DINAMAI oleh sentuhan yang paling awal
    // secara tekstual — yaitu `.from(...)`-nya, bukan `.innerJoin(...)` yang
    // kebetulan dikunjungi lebih dulu oleh penjelajah (rantai luar dulu).
    // Tanpa ini, sebelas kueri `laporan/routes.ts` berpindah label dari
    // `saleItems` ke `sales` tanpa satu pun kueri berubah.
    const perRantai = new Map<Simpul, Simpul>();
    jelajah(k.prog, (n) => {
      if (n.type !== "CallExpression") return;
      const prop = n.callee ? namaProperti(n.callee) : undefined;
      if (!prop || !AMBIL.has(prop)) return;
      const arg0 = n.arguments?.[0];
      if (arg0?.type !== "Identifier" || !dicari.includes(arg0.name)) return;
      const rantai = rantaiPenuh(n, k.induk);
      const ada = perRantai.get(rantai);
      if (!ada || n.start < ada.start) perRantai.set(rantai, n);
    });
    for (const [rantai, n] of perRantai) {
      keluar.push({
        berkas: k.nama,
        baris: barisDi(k.isi, n.start),
        induk: indukNama,
        tabel: (n.arguments[0].name as string),
        bentuk: "drizzle",
        kelas: kelasDrizzle(rantai, b, k),
        potongan: k.isi.slice(rantai.start, rantai.end).replace(/\s+/g, " ").slice(0, 220),
      });
    }
  }
  return keluar;
}

/** Isi template `sql` PERTAMA di dalam badan sebuah pembantu bernama. */
function badanPembantu(nama: string, dari: Simpul, k: Konteks): string {
  const d = deklarasiTerlihat(dari, nama, k.induk, k.lingkup);
  if (!d?.nilai) return "";
  let isi = "";
  jelajah(d.nilai, (n) => {
    if (isi) return;
    if (n.type !== "TaggedTemplateExpression") return;
    let tag = n.tag;
    if (tag?.type === "TSInstantiationExpression") tag = tag.expression;
    if (tag?.type !== "Identifier" || tag.name !== "sql") return;
    isi = k.isi.slice(n.quasi.start + 1, n.quasi.end - 1);
  });
  return isi;
}

/**
 * Pernyataan SQL mentah yang DIJALANKAN (`.execute(sql`…`)`).
 *
 * Versi lama mengenali "dijalankan" dengan menengok 40 aksara ke belakang
 * mencari `.execute(`. Di pohon, "argumen sebuah panggilan `.execute`" adalah
 * fakta — tak ada jendela yang bisa kependekan atau kepanjangan.
 */
function situsSqlMentah(k: Konteks): Situs[] {
  const keluar: Situs[] = [];
  jelajah(k.prog, (n) => {
    if (n.type !== "TaggedTemplateExpression") return;
    let tag = n.tag;
    if (tag?.type === "TSInstantiationExpression") tag = tag.expression;
    if (tag?.type !== "Identifier" || tag.name !== "sql") return;
    const atas = k.induk.get(n);
    if (atas?.type !== "CallExpression") return;
    if (namaProperti(atas.callee) !== "execute") return;
    if (!atas.arguments?.includes(n)) return;

    let penuh = k.isi.slice(n.quasi.start + 1, n.quasi.end - 1);
    // `${pembantu(...)}` di dalam templat: badannya ikut dibaca, sebab
    // saringannya bisa hidup di sana.
    for (const ekspr of n.quasi.expressions ?? []) {
      if (ekspr.type === "CallExpression" && ekspr.callee?.type === "Identifier") {
        penuh += `\n${badanPembantu(ekspr.callee.name as string, ekspr, k)}`;
      }
    }
    const rata = tanpaSubkueri(penuh);
    const menulis = /^\s*(?:\$\{[^}]*\}\s*)*(INSERT|UPDATE|DELETE)\b/i.test(rata);
    for (const [indukNama, b] of Object.entries(BENDERA)) {
      const dicari = [b.tabelSnake, ...b.anakSnake];
      const kena = dicari.find((t) =>
        new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, "i").test(penuh),
      );
      if (!kena) continue;
      keluar.push({
        berkas: k.nama,
        baris: barisDi(k.isi, n.start),
        induk: indukNama,
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
  });
  return keluar;
}

export function situsBendera(kode?: { nama: string; isi: string }[]): Situs[] {
  const berkas = kode ?? sumberServer();
  const keluar: Situs[] = [];
  for (const { nama, isi } of berkas) {
    const k = konteks(nama, isi);
    keluar.push(...situsDrizzle(k), ...situsSqlMentah(k));
  }
  return keluar;
}

export function kunciSitus(x: Situs): string {
  return `${x.berkas}:${x.baris} ${x.bentuk} ${x.tabel}<${x.induk}>`;
}
