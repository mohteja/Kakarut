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

/**
 * `MENULIS` DULU ADALAH PEMBEBASAN YANG BISU, DAN ITU TEMUANNYA SENDIRI.
 *
 * Sampai 2026-08-27 `kelasDrizzle` memulangkan `MENULIS` untuk rantai apa pun
 * yang menulis, lalu gerbangnya hanya menuduh `TELANJANG` — jadi penulisan
 * tak pernah ditagih, dan tak ada satu kalimat pun yang menjelaskan kenapa
 * boleh begitu. Kali KELIMA berturut-turut pola yang sama muncul di audit ini:
 * gerbang jujur, buta pada bentuk yang justru dilewatkan catatan
 * pengecualiannya sendiri — dan kali ini gerbangnya lahir dari audit ini juga.
 *
 * Lebih buruk: `MENULIS` cuma melihat rantai yang JUGA membaca (`situsDrizzle`
 * berangkat dari `.from()`/`.join()`), jadi `db.update(productions).where(…)`
 * polos tak pernah jadi situs sama sekali. Terukur: `MENULIS` = 3 (dua di
 * antaranya modul Tempat Sampah, yang memang pekerjaannya), sementara
 * `update`/`delete` pada tabel berbendera ada **36**, dan **19** di antaranya
 * `WHERE`-nya tak menyebut benderanya sekali pun.
 *
 * Karena itu penulisan kini punya kelasnya sendiri — lihat [KelasTulis].
 */
export type KelasBendera =
  | "MENYARING"
  | "LEWAT_VARIABEL"
  | "MENULIS"
  | "TELANJANG"
  | KelasTulis;

/**
 * Kelas untuk PENULISAN (`update`/`delete`) pada tabel berbendera.
 *
 * Taruhannya sama dengan sisi bacaan, tapi arahnya berlawanan: bacaan yang
 * lupa menyaring IKUT MENGHITUNG baris yang sudah dibuang; penulisan yang lupa
 * menyaring MENGUBAH baris yang sudah dibuang. Yang kedua lebih sunyi — tak
 * ada angka yang terlihat salah, hanya transaksi di Tempat Sampah yang
 * diam-diam bergerak.
 */
export type KelasTulis =
  /** `WHERE`-nya sendiri menyebut benderanya. */
  | "TULIS_MENYARING"
  /** Barisnya dimuat lebih dulu DENGAN saringan, di fungsi yang sama. */
  | "TULIS_DIJAGA"
  /** Modul yang memang berwenang atas baris terbuang (Tempat Sampah, backfill). */
  | "TULIS_SAMPAH"
  /** Tak satu pun — tertuduh. */
  | "TULIS_TELANJANG";

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

/**
 * Modul yang BERWENANG menulis ke baris terbuang.
 *
 * Tempat Sampah bukan pelanggar: memulihkan dan menghapus-permanen adalah
 * pekerjaannya, dan gerbang yang menuduhnya adalah gerbang yang salah paham
 * soal apa itu Tempat Sampah. Backfill menyentuh baris lama tanpa memandang
 * statusnya — itu juga sengaja.
 */
const BERWENANG = [/^modules\/sampah\//, /^seed\//, /backfill/i];

/** Nama fungsi pembungkus mana pun mengandung "backfill". */
function dalamBackfill(n: Simpul, induk: Map<Simpul, Simpul>, isi: string): boolean {
  let k: Simpul | undefined = induk.get(n);
  while (k) {
    if (k.type === "FunctionDeclaration" && k.id?.type === "Identifier") {
      if (/backfill/i.test(k.id.name as string)) return true;
    }
    if (k.type === "VariableDeclarator" && k.id?.type === "Identifier") {
      if (/backfill/i.test(k.id.name as string)) return true;
    }
    k = induk.get(k);
  }
  return false;
}

/**
 * Fungsi pembungkus TERLUAR — lingkup tempat saringan hulu boleh berdiri.
 *
 * Sengaja yang terluar, bukan yang terdekat. Penulisan di repo ini hampir
 * selalu bersarang beberapa lapis di dalam handler-nya
 * (`db.transaction(async (tx) => … items.map(async (b) => …))`), sementara
 * saringan `isNull(deletedAt)` yang memuat fakturnya berdiri di badan
 * handler-nya. Generasi pertama sapuan ini memakai fungsi TERDEKAT dan karena
 * itu menuduh lima penulisan `produksi/routes.ts` yang fakturnya sudah dimuat
 * berfilter belasan baris di atasnya.
 *
 * Harganya ditulis: saringan atas baris LAIN di handler yang sama ikut
 * membebaskan. Karena itu pembebasan ini bukan vonis "aman" melainkan
 * "tak bisa dituduh dari sini" — dan sisanya dipilah tangan.
 */
function fungsiSekitar(n: Simpul, induk: Map<Simpul, Simpul>): Simpul | undefined {
  let k: Simpul | undefined = induk.get(n);
  let terluar: Simpul | undefined;
  while (k) {
    if (
      k.type === "ArrowFunctionExpression" ||
      k.type === "FunctionExpression" ||
      k.type === "FunctionDeclaration"
    ) {
      terluar = k;
    }
    k = induk.get(k);
  }
  return terluar;
}

/** Syarat benderanya dirakit di sebuah variabel yang dipakai rantai ini. */
function lewatVariabel(rantai: Simpul, b: Bendera, k: Konteks): boolean {
  for (const id of rujukan(rantai, k.induk)) {
    const d = deklarasiTerlihat(id, id.name as string, k.induk, k.lingkup);
    if (d && menyentuhProperti(d.nilai, b.kolom)) return true;
  }
  return false;
}

/**
 * Fungsi tingkat-berkas yang BADANNYA menyaring bendera ini atas tabel yang
 * sama — yaitu penjaga bersama seperti `pastikanKartu` di `pesanan/routes.ts`.
 *
 * Idiomnya baku di repo ini: satu penjaga, dipanggil sebagai baris PERTAMA
 * tiap handler yang mengubah sesuatu (`pastikanKartu` dipanggil di :571, :682,
 * :766, :835, :889). Pemindai yang tak mengenalinya menuduh keempat pintu
 * papan dapur — dan tuduhan itu SALAH, terbukti lewat HTTP: menekan tombol
 * dapur pada baris penjualan yang sudah dibuang dijawab **404**, statusnya tak
 * berubah, dan nol baris log tertulis.
 */
function penjagaBerkas(k: Konteks, b: Bendera, dicari: string[]): Set<string> {
  const nama = new Set<string>();
  jelajah(k.prog, (n) => {
    const id =
      n.type === "FunctionDeclaration" && n.id?.type === "Identifier"
        ? (n.id.name as string)
        : undefined;
    if (!id) return;
    let saring = false;
    jelajah(n, (x) => {
      if (saring || x.type !== "CallExpression") return;
      const prop = x.callee ? namaProperti(x.callee) : undefined;
      if (!prop || !AMBIL.has(prop)) return;
      const arg0 = x.arguments?.[0];
      if (arg0?.type !== "Identifier" || !dicari.includes(arg0.name)) return;
      if (menyentuhProperti(rantaiPenuh(x, k.induk), b.kolom)) saring = true;
    });
    if (saring) nama.add(id);
  });
  return nama;
}

/** Apakah `fn` memanggil salah satu penjaga bersama itu. */
function memanggilPenjaga(fn: Simpul, penjaga: Set<string>): boolean {
  if (penjaga.size === 0) return false;
  let ada = false;
  jelajah(fn, (n) => {
    if (ada || n.type !== "CallExpression") return;
    const c = n.callee;
    if (c?.type === "Identifier" && penjaga.has(c.name as string)) ada = true;
  });
  return ada;
}

/**
 * Apakah di dalam `fn` ada BACAAN atas tabel yang sama yang menyaring
 * benderanya — yaitu "barisnya sudah dipastikan hidup sebelum ditulis".
 *
 * Ini pembebasan yang sama bentuknya dengan yang dipakai putaran 24
 * ("dijaga pemanggilnya"), dan ia PUNYA HARGA: lingkupnya satu fungsi, jadi
 * saringan yang dilakukan pemanggil tak terlihat. Terbukti sekali di
 * pengintaian — `penjualan/refund.ts` memuat penjualannya di `:75` dengan
 * `isNull(sales.deletedAt)` lalu menulis dua kali tanpa mengulang syaratnya.
 */
function dijagaBacaan(fn: Simpul, b: Bendera, k: Konteks, dicari: string[]): boolean {
  let jaga = false;
  jelajah(fn, (n) => {
    if (jaga || n.type !== "CallExpression") return;
    const prop = n.callee ? namaProperti(n.callee) : undefined;
    if (!prop || !AMBIL.has(prop)) return;
    const arg0 = n.arguments?.[0];
    if (arg0?.type !== "Identifier" || !dicari.includes(arg0.name)) return;
    const rantai = rantaiPenuh(n, k.induk);
    if (menyentuhProperti(rantai, b.kolom)) {
      jaga = true;
      return;
    }
    for (const id of rujukan(rantai, k.induk)) {
      const d = deklarasiTerlihat(id, id.name as string, k.induk, k.lingkup);
      if (d && menyentuhProperti(d.nilai, b.kolom)) jaga = true;
    }
  });
  return jaga;
}

/**
 * PENULISAN pada tabel berbendera — `update`/`delete`, termasuk yang sama
 * sekali tak membaca apa pun.
 *
 * Sengaja TIDAK berangkat dari `.from()` seperti [situsDrizzle]: justru
 * penulisan yang tak membaca apa-apa yang paling mudah lupa menyaring, dan
 * itulah yang selama ini tak terlihat.
 */
function situsTulis(k: Konteks): Situs[] {
  const keluar: Situs[] = [];
  const berwenang = BERWENANG.some((re) => re.test(k.nama));

  for (const [indukNama, b] of Object.entries(BENDERA)) {
    const dicari = [indukNama, ...b.anak];
    const penjaga = penjagaBerkas(k, b, dicari);
    jelajah(k.prog, (n) => {
      if (n.type !== "CallExpression") return;
      const prop = n.callee ? namaProperti(n.callee) : undefined;
      if (prop !== "update" && prop !== "delete") return;
      const arg0 = n.arguments?.[0];
      if (arg0?.type !== "Identifier" || !dicari.includes(arg0.name)) return;

      const rantai = rantaiPenuh(n, k.induk);
      let kelas: KelasTulis;
      // Syaratnya boleh berdiri LANGSUNG di `.where(...)`, atau lewat sebuah
      // variabel — `const kunci = and(eq(id, …), isNull(deletedAt))` lalu
      // `.where(kunci)`. Sisi BACAAN gerbang ini sudah menelusuri variabel
      // sejak lama (`LEWAT_VARIABEL`); sisi penulisan harus memakai mata yang
      // sama, atau ia menuduh lima penulisan `produksi/routes.ts` yang
      // syaratnya justru paling teliti di seluruh berkas itu.
      if (menyentuhProperti(rantai, b.kolom) || lewatVariabel(rantai, b, k)) {
        kelas = "TULIS_MENYARING";
      } else if (berwenang || dalamBackfill(n, k.induk, k.isi)) kelas = "TULIS_SAMPAH";
      else {
        const fn = fungsiSekitar(n, k.induk);
        kelas =
          fn && (dijagaBacaan(fn, b, k, dicari) || memanggilPenjaga(fn, penjaga))
            ? "TULIS_DIJAGA"
            : "TULIS_TELANJANG";
      }

      keluar.push({
        berkas: k.nama,
        baris: barisDi(k.isi, (k.induk.get(n)?.property ?? n).start ?? n.start),
        induk: indukNama,
        tabel: arg0.name as string,
        bentuk: "drizzle",
        kelas,
        potongan: k.isi.slice(rantai.start, rantai.end).replace(/\s+/g, " ").slice(0, 220),
      });
    });
  }
  return keluar;
}

export function situsBendera(kode?: { nama: string; isi: string }[]): Situs[] {
  const berkas = kode ?? sumberServer();
  const keluar: Situs[] = [];
  for (const { nama, isi } of berkas) {
    const k = konteks(nama, isi);
    keluar.push(...situsDrizzle(k), ...situsTulis(k), ...situsSqlMentah(k));
  }
  return keluar;
}

export function kunciSitus(x: Situs): string {
  return `${x.berkas}:${x.baris} ${x.bentuk} ${x.tabel}<${x.induk}>`;
}
