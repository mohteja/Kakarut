import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { barisDi, jelajah, namaProperti, petaInduk, uraikan, type Simpul } from "./ast";
import { berkasKode } from "./rute";

export const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * BENTUK BALASAN DISEBUT PENULISNYA, BUKAN DITENTUKAN TABELNYA.
 *
 * Enam putaran menutup satu keluarga di sisi KELUARAN: bacaan yang gagal
 * menyamar jadi "tidak ada", yang terpotong menyamar jadi lengkap, penulisan
 * tanpa penahan, penulisan ke baris terbuang. Yang belum pernah ditanyakan:
 * **apa yang MASUK ke balasan tanpa ada yang memilihnya?**
 *
 * Repo ini punya 78 tempat yang menyerahkan bentuk balasan kepada sebuah
 * variabel (`c.json(x)` 68×, `c.json({ ...x })` 10×). Selama `x` sebuah DTO
 * yang kolomnya disebut satu per satu, itu aman. Yang menjaganya begitu:
 * tidak ada apa-apa. Hanya kebiasaan.
 *
 * Dua aturan dijaga di sini:
 *
 * **A. Bentuknya disebut penulisnya.** `db.select()` TELANJANG memulangkan
 * setiap kolom tabelnya. Baris seperti itu yang sampai ke `c.json` membuat
 * bentuk balasan mengikuti bentuk TABEL — jadi kolom yang ditambahkan besok
 * ikut terkirim ke semua klien tanpa satu baris kode pun berubah. Itu bukan
 * keputusan; itu ketiadaan keputusan.
 *
 * **B. Kolom rahasia tak punya JALAN ke balasan.** `users.password_hash`,
 * `smtp_settings.password`, token undangan mentah, dua tabel `token_hash`.
 * Satu `c.json(user)` di rute baru mengirim hash bcrypt seluruh akun.
 *
 * Hari ini aturan B **tidak dilanggar sekali pun**, dan itu ditelusuri, bukan
 * dianggap: delapan kandidat bermuara di `buatSesi` (`auth/session.ts:42`)
 * yang merakit `payload` kolom demi kolom, dan `smtpDto`
 * (`admin-system/routes.ts:44`) mengirim `has_password: Boolean(row?.password)`
 * — penandanya, bukan rahasianya. Keduanya contoh yang benar, dan gerbang ini
 * harus membiarkan keduanya hijau.
 *
 * DAFTAR KOLOM RAHASIA DIBACA DARI SKEMA, BUKAN DIKETIK. Daftar yang diketik
 * adalah cara kolom rahasia berikutnya lahir tanpa dijaga — kesalahan yang
 * persis sama sudah dibayar dua putaran berturut-turut, saat gerbang menuduh
 * `potongLarik` dan `kunciBackfillKode` karena regexnya hafal nama lama.
 *
 * BATAS YANG DIAKUI:
 * 1. Penelusuran asal berlingkup SATU FUNGSI. Baris yang melewati pembantu di
 *    berkas lain tak terlihat — dan itu justru yang membuat `buatSesi` aman
 *    di mata gerbang ini: yang sampai ke `c.json` adalah hasil pembantunya,
 *    bukan barisnya.
 * 2. `SELECT *` di dalam SQL mentah tidak disapu aturan A.
 * 3. Pola nama kolom rahasia adalah heuristik. Ia sengaja LEBAR (`token`
 *    menangkap `tokenVersion` yang bukan rahasia) — tabelnya memang perlu
 *    dijaga, dan lebar-yang-menjaga lebih murah daripada sempit-yang-lewat.
 */
export type KelasBalasan =
  /** Argumennya objek literal / hasil pembantu — penulisnya yang menyebut isinya. */
  | "DISEBUT"
  /** Terikat dari `select({ … })` berkolom eksplisit. */
  | "KOLOM"
  /** Terikat dari `select()` TELANJANG — bentuknya mengikuti tabel. */
  | "BARIS_PENUH"
  /** `BARIS_PENUH` atas tabel yang punya kolom rahasia. */
  | "RAHASIA";

export interface SitusBalasan {
  /** relatif terhadap `src/` */
  berkas: string;
  baris: number;
  kelas: KelasBalasan;
  /** nama pengikat yang sampai ke `c.json`, bila ada */
  nama: string;
  /** tabel asalnya, bila terlacak */
  tabel: string;
  potongan: string;
}

const SPASI = /\s+/g;

/**
 * Nama kolom yang menandai sebuah tabel memuat RAHASIA.
 *
 * Sengaja lebar: yang dijaga adalah "tabel ini tak boleh dikirim utuh", dan
 * satu kolom mencurigakan sudah cukup untuk menyatakan itu.
 */
const POLA_RAHASIA = /password|secret|token|hash|apikey|api_key/i;

/** `export const <nama> = pgTable("…", { … })` → nama kolom propertinya. */
export function tabelRahasia(skema?: string): Set<string> {
  const isi = skema ?? readFileSync(`${SRC}/db/schema.ts`, "utf8");
  const akar = uraikan("db/schema.ts", isi);
  const keluar = new Set<string>();
  jelajah(akar, (n) => {
    if (n.type !== "VariableDeclarator") return;
    const id = n.id as Simpul | undefined;
    const init = n.init as Simpul | undefined;
    if (id?.type !== "Identifier" || init?.type !== "CallExpression") return;
    const callee = init.callee as Simpul | undefined;
    if (callee?.type !== "Identifier" || callee.name !== "pgTable") return;
    const kolomArg = (init.arguments as Simpul[])[1];
    if (kolomArg?.type !== "ObjectExpression") return;
    for (const p of (kolomArg.properties ?? []) as Simpul[]) {
      const k = p.key as Simpul | undefined;
      const nama = k?.type === "Identifier" ? (k.name as string) : undefined;
      if (nama && POLA_RAHASIA.test(nama)) keluar.add(id.name as string);
    }
  });
  return keluar;
}

/** Fungsi pembungkus terdekat — lingkup penelusuran asal. */
function fungsiSekitar(n: Simpul, induk: Map<Simpul, Simpul>): Simpul | undefined {
  let k: Simpul | undefined = induk.get(n);
  while (k) {
    if (
      k.type === "ArrowFunctionExpression" ||
      k.type === "FunctionExpression" ||
      k.type === "FunctionDeclaration"
    ) {
      return k;
    }
    k = induk.get(k);
  }
  return undefined;
}

/**
 * Pengikat → tabel, untuk DUA bentuk yang sama-sama memulangkan SELURUH kolom
 * di dalam `fn`: `select()` telanjang, dan `returning()` telanjang.
 *
 * Bentuk kedua hampir terlewat. Generasi pertama pemindai ini hanya mengenal
 * `select()`, lalu melaporkan 2 situs — sementara sapuan teks yang lebih kasar
 * melaporkan 3. Ketidakcocokan itu yang menemukannya:
 * `company/routes.ts:163` memulangkan `.update(companies).set(…).returning()`,
 * yang persis sama luasnya dengan `select()` telanjang. Dua cara menghitung,
 * dan yang menang bukan yang lebih canggih melainkan yang angkanya
 * dipertanggungjawabkan.
 */
function barisPenuhDi(fn: Simpul, isi: string, induk: Map<Simpul, Simpul>): Map<string, string> {
  const peta = new Map<string, string>();
  jelajah(fn, (n) => {
    if (n.type !== "CallExpression") return;
    const c = n.callee as Simpul | undefined;
    if (c?.type !== "MemberExpression") return;
    const prop = namaProperti(c);
    if (prop !== "select" && prop !== "returning") return;
    if (((n.arguments as Simpul[]) ?? []).length !== 0) return;

    // Naik ke UJUNG rantainya lebih dulu, lalu cari nama tabelnya di seluruh
    // rantai itu. Kedua bentuk berdiri di ujung yang BERLAWANAN:
    //
    //   db.select().from(T)          → `select()` simpul TERDALAM, `.from(T)` di luar
    //   db.update(T).set(…).returning() → `returning()` membentang SELURUH rantai
    //
    // Mencari tabel hanya "di dalam" simpulnya membuat bentuk pertama
    // kehilangan tabelnya; hanya "di luar" membuat yang kedua kehilangan
    // miliknya. Generasi kedua pemindai ini melakukan yang pertama, dan dua
    // situs `select()` diam-diam pindah kelas jadi "KOLOM" — hijau palsu yang
    // hanya ketahuan karena angkanya berubah tanpa sebab.
    let ujung: Simpul = n;
    let k: Simpul | undefined = induk.get(ujung);
    let decl: Simpul | undefined;
    while (k) {
      if (
        k.type === "MemberExpression" ||
        k.type === "CallExpression" ||
        k.type === "AwaitExpression" ||
        // Rantainya bisa jadi BADAN sebuah callback: `tanpaBentrok(() =>
        // db.update(…).returning())`. Berhenti di panah itu membuat barisnya
        // tak pernah terikat ke nama apa pun, dan situsnya lolos sebagai
        // "KOLOM" — hijau yang lahir dari tak menemukan, bukan dari aman.
        k.type === "ArrowFunctionExpression"
      ) {
        ujung = k;
        k = induk.get(k);
        continue;
      }
      if (k.type === "VariableDeclarator") decl = k;
      break;
    }
    let tabel: string | undefined;
    jelajah(ujung, (x) => {
      if (tabel || x.type !== "CallExpression") return;
      const xc = x.callee as Simpul | undefined;
      if (xc?.type !== "MemberExpression") return;
      const xp = namaProperti(xc);
      if (xp !== "from" && xp !== "insert" && xp !== "update") return;
      const a = (x.arguments as Simpul[])[0];
      if (a?.type === "Identifier") tabel = a.name as string;
    });
    if (!tabel || !decl) return;
    const id = decl.id as Simpul | undefined;
    if (id?.type === "Identifier") peta.set(id.name as string, tabel);
    if (id?.type === "ArrayPattern") {
      for (const el of ((id.elements ?? []) as (Simpul | null)[])) {
        if (el?.type === "Identifier") peta.set(el.name as string, tabel);
      }
    }
  });
  return peta;
}

export function situsBalasan(kode?: Record<string, string>, skema?: string): SitusBalasan[] {
  const rahasia = tabelRahasia(skema);
  const keluar: SitusBalasan[] = [];

  const ambil = (berkas: string, isi: string): void => {
    if (!isi.includes("c.json(")) return;
    const akar = uraikan(berkas, isi);
    const induk = petaInduk(akar);
    const cache = new Map<Simpul, Map<string, string>>();

    jelajah(akar, (n) => {
      if (n.type !== "CallExpression") return;
      const c = n.callee as Simpul | undefined;
      if (c?.type !== "MemberExpression" || namaProperti(c) !== "json") return;
      const a0 = ((n.arguments as Simpul[]) ?? [])[0];
      if (!a0) return;

      const fn = fungsiSekitar(n, induk);
      let peta = fn ? cache.get(fn) : undefined;
      if (fn && !peta) {
        peta = barisPenuhDi(fn, isi, induk);
        cache.set(fn, peta);
      }
      peta ??= new Map<string, string>();

      // Pengikat yang benar-benar MENENTUKAN bentuk balasannya: argumen itu
      // sendiri bila ia sebuah pengenal, atau apa pun yang di-spread ke
      // dalamnya. Properti `x: row.nama` TIDAK termasuk — di situ penulisnya
      // yang menyebut, dan itu justru jawaban yang benar.
      const penentu = new Set<string>();
      if (a0.type === "Identifier") penentu.add(a0.name as string);
      jelajah(a0, (x) => {
        if (x.type === "SpreadElement") {
          const arg = x.argument as Simpul | undefined;
          if (arg?.type === "Identifier") penentu.add(arg.name as string);
        }
      });

      const titik = (c.property as Simpul).start;
      const akhirBaris = isi.indexOf("\n", titik);
      const potongan = isi
        .slice(titik, akhirBaris < 0 ? isi.length : akhirBaris)
        .replace(SPASI, " ")
        .trim();

      if (penentu.size === 0) {
        keluar.push({
          berkas,
          baris: barisDi(isi, titik),
          kelas: "DISEBUT",
          nama: "",
          tabel: "",
          potongan,
        });
        return;
      }

      for (const nama of penentu) {
        const tabel = peta.get(nama);
        const kelas: KelasBalasan = !tabel
          ? "KOLOM"
          : rahasia.has(tabel)
            ? "RAHASIA"
            : "BARIS_PENUH";
        keluar.push({
          berkas,
          baris: barisDi(isi, titik),
          kelas,
          nama,
          tabel: tabel ?? "",
          potongan,
        });
      }
    });
  };

  if (kode) {
    for (const [berkas, isi] of Object.entries(kode)) ambil(berkas, isi);
    return keluar;
  }
  for (const p of berkasKode(SRC, /\.ts$/)) {
    ambil(p.slice(SRC.length + 1), readFileSync(p, "utf8"));
  }
  return keluar;
}
