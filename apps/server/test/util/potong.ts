import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { barisDi, jelajah, namaProperti, petaInduk, uraikan, type Simpul } from "./ast";
import { berkasKode } from "./rute";

export const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * DAFTAR YANG DIPOTONG — DAN APAKAH YANG MEMBACANYA DIBERI TAHU.
 *
 * Empat putaran terakhir menutup satu kelas di tiga permukaan: bacaan yang
 * GAGAL menyamar jadi "tidak ada". Berkas ini menyapu saudara kandungnya, satu
 * lapis lebih hulu — di kontrak server→klien:
 *
 * > bacaan yang **TERPOTONG** menyamar jadi **LENGKAP**.
 *
 * Aturannya bukan karanganku. Ia sudah ditulis panjang di
 * `src/modules/customer/routes.ts:50`, dan menyebut dua sisi:
 *
 * 1. **Agregat wajib dihitung SEBELUM dipotong.** *"`.limit(300)` yang polos
 *    akan menjawab 'Total belanja Rp 3.000.000' untuk member yang sebenarnya
 *    sudah belanja Rp 40.000.000 — angka salah yang kelihatan wajar."*
 * 2. **Memotong tanpa memberi tahu membuat baris ke-N+1 tak bisa ditemukan**
 *    oleh klien yang menyaring di browser: yang tak terkirim tak pernah ada
 *    baginya.
 *
 * Idiomnya juga sudah ada, dipakai enam kali: ambil `BATAS + 1`, potong ke
 * `BATAS`, dan kirim kunci `*_terpotong`. Yang dijaga berkas ini cuma satu
 * hal — bahwa pintu yang memotong memakai idiom itu, atau punya alasan
 * tertulis kenapa tidak.
 *
 * DUA CARA MENYATAKAN "TERPOTONG", dan pemindai yang hanya tahu satu akan
 * menuduh pintu yang benar. Selain kunci badan (`*_terpotong`), ada header
 * `X-Kakarut-Terpotong` — dipakai `sampah/routes.ts` dan DIBACA kedua klien
 * (`TempatSampahPage.tsx:39`, `api_client.dart:332`). Generasi ketiga pemindai
 * ini menuduhnya senyap; tuduhan itu salah, dan yang membetulkannya bukan
 * pembacaan melainkan pertanyaan "kalau memang senyap, kenapa dua klien punya
 * kode untuk membacanya?".
 *
 * DUA BENTUK DISAPU, bukan satu. `.limit()` Drizzle **dan** `LIMIT` di dalam
 * templat `sql\`…\``. Menyapu yang pertama saja akan menyatakan
 * `stok/service.ts` tak punya pemotongan sama sekali — padahal di situ ada
 * tiga, dan salah satunya membatasi 20.000 event FIFO. Blind spot yang
 * DIKETAHUI lebih baik ditutup daripada ditulis.
 *
 * BATAS YANG DIAKUI, ditulis supaya hijaunya tak dibaca lebih luas:
 * 1. Pemotongan yang terjadi murni di JS (`slice`, `take`) tanpa `.limit()`
 *    maupun `LIMIT` TIDAK terlihat.
 * 2. Lingkup pencarian penandanya adalah FUNGSI PEMBUNGKUS terdekat — cukup
 *    untuk pembantu yang memulangkan `{ rows, terpotong }` maupun handler yang
 *    memanggil `c.json`, dan tak lebih. Penanda yang dirakit dua fungsi jauh
 *    tak terlihat.
 * 3. [Situs.adaAgregat] adalah PETUNJUK triase, bukan vonis. Ia menandai
 *    fungsi yang memuat `reduce`/`+=`/`.length`, dan menilai apakah angka itu
 *    benar-benar lahir dari larik yang sudah dipotong adalah pekerjaan tangan.
 */
/** Dari mana pemotongannya berasal. */
export type Bentuk = "drizzle" | "sql";

export type KelasPotong =
  /** `.limit(1)` — mengambil SATU baris, bukan memotong daftar. */
  | "SATU"
  /** Memotong, dan balasannya menyebutkan itu (`*_terpotong`). */
  | "BERPENANDA"
  /** Memotong, dan balasannya berhalaman (`page`/`total`/`per_page`). */
  | "HALAMAN"
  /** Memotong tanpa penanda apa pun. */
  | "SENYAP";

export interface Situs {
  /** relatif terhadap `src/` */
  berkas: string;
  baris: number;
  bentuk: Bentuk;
  kelas: KelasPotong;
  /** teks argumen `.limit(…)`, dinormalkan — kunci daftar yang tak ikut bergeser saat baris bergeser */
  argumen: string;
  /** mengambil `BATAS + 1` (separuh idiomnya) */
  lebihSatu: boolean;
  /** PETUNJUK: fungsi pembungkusnya memuat agregat JS */
  adaAgregat: boolean;
  /**
   * PETUNJUK: berkasnya memuat kunci `*terpotong*` di suatu tempat, tapi TIDAK
   * di fungsi pembungkus situs ini.
   *
   * Bukan pembebasan — pembebasan butuh bukti bahwa penanda itu benar-benar
   * menutupi situs INI. Ia ada karena kasus nyata: `stok/service.ts:741`
   * memotong 20.000 event dengan idiom `+1` yang benar, dan penandanya dirakit
   * di fungsi PEMANGGIL (`:833`). Tanpa petunjuk ini, tuduhannya terlihat
   * sama persis dengan pintu yang memang lupa.
   */
  penandaDiBerkas: boolean;
  potongan: string;
}

const SPASI = /\s+/g;

/**
 * Sebutan yang menyatakan "masih ada lagi" — kunci badan `*_terpotong`,
 * tetapan header `HEADER_TERPOTONG`, dan pembantu bersama `potongLarik`
 * (`src/lib/potong.ts`) yang memasang headernya.
 *
 * Ketiganya SATU aturan. Pemindai yang cuma mengenal ejaan `terpotong` akan
 * menuduh setiap pintu yang memakai pembantunya — yaitu justru pintu-pintu
 * yang paling patuh.
 */
const PENANDA = /terpotong|potongLarik/i;

/**
 * Kunci yang menyatakan BERHALAMAN. `total` SENGAJA tidak ada di sini.
 *
 * Generasi kedua pemindai ini memasukkannya, dan akibatnya sebuah PEMBEBASAN
 * PALSU: `sampah/routes.ts` memotong 300 baris lalu memulangkan objek ber-kunci
 * `total` — yang di situ berarti **rupiah**, bukan jumlah baris. Pemindainya
 * membaca "berhalaman, jadi tak apa" atas pintu yang sebenarnya senyap.
 * Nama kunci di produk ini terlalu sering soal uang untuk dipakai sebagai
 * tanda paginasi; yang menyatakan paginasi adalah `page`/`per_page`.
 */
const HALAMAN = new Set(["page", "per_page", "perPage", "halaman"]);

/** Fungsi pembungkus terdekat — tempat penanda boleh berdiri. */
function fungsiPembungkus(n: Simpul, induk: Map<Simpul, Simpul>): Simpul | undefined {
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
 * Nama KUNCI objek. `namaProperti` dari `ast.ts` sengaja hanya melayani
 * `MemberExpression` (`sales.deletedAt`); memanggilnya untuk sebuah `Property`
 * memulangkan `undefined` — dan generasi pertama pemindai ini melakukan persis
 * itu, lalu melaporkan **BERPENANDA = 0** padahal enam pintu memakai idiomnya.
 * Nol yang seperti itu bukan temuan melainkan kebutaan, dan kalau dipercaya ia
 * akan menyuruhku "memperbaiki" enam pintu yang sudah benar.
 */
function kunciProperti(n: Simpul): string | undefined {
  const k = n.key as Simpul | undefined;
  if (!k || n.computed) return undefined;
  if (k.type === "Identifier") return k.name as string;
  if (k.type === "Literal" && typeof k.value === "string") return k.value;
  return undefined;
}

/**
 * Kunci properti + SEBUTAN "terpotong" apa pun di dalam `akar`, plus jejak
 * agregat JS.
 *
 * `sebutan` menangkap idiom kedua: nama pengenal (`HEADER_TERPOTONG`) atau
 * literal teks (`"X-Kakarut-Terpotong"`) yang dipakai fungsi ini untuk
 * mengabarkan pemotongan lewat header alih-alih lewat badan.
 */
function bacaLingkup(akar: Simpul): {
  kunci: Set<string>;
  sebutan: boolean;
  agregat: boolean;
} {
  const kunci = new Set<string>();
  let sebutan = false;
  let agregat = false;
  jelajah(akar, (n) => {
    if (n.type === "Property" || n.type === "ObjectProperty") {
      const nama = kunciProperti(n);
      if (nama) kunci.add(nama);
    }
    if (n.type === "Identifier" && PENANDA.test(n.name as string)) sebutan = true;
    if (n.type === "Literal" && typeof n.value === "string" && PENANDA.test(n.value)) {
      sebutan = true;
    }
    if (n.type === "MemberExpression" && namaProperti(n) === "reduce") agregat = true;
    if (n.type === "AssignmentExpression" && n.operator === "+=") agregat = true;
  });
  return { kunci, sebutan, agregat };
}

/** `.limit(x)` — argumennya apa adanya, dan apakah bentuknya `… + 1`. */
function bacaArgumen(isi: string, panggil: Simpul): { teks: string; lebihSatu: boolean } {
  const arg = (panggil.arguments as Simpul[])[0];
  if (!arg) return { teks: "", lebihSatu: false };
  const teks = isi.slice(arg.start, arg.end).replace(SPASI, " ").trim();
  const lebihSatu =
    arg.type === "BinaryExpression" &&
    arg.operator === "+" &&
    isi.slice((arg.right as Simpul).start, (arg.right as Simpul).end).trim() === "1";
  return { teks, lebihSatu };
}

export function situsPotong(kode?: Record<string, string>): Situs[] {
  const keluar: Situs[] = [];

  const ambil = (berkas: string, isi: string): void => {
    const akar = uraikan(berkas, isi);
    const induk = petaInduk(akar);
    const cache = new Map<Simpul, ReturnType<typeof bacaLingkup>>();
    const lingkupBerkas = bacaLingkup(akar);
    const penandaBerkas =
      lingkupBerkas.sebutan || [...lingkupBerkas.kunci].some((k) => PENANDA.test(k));

    jelajah(akar, (n) => {
      if (n.type !== "CallExpression") return;
      const callee = n.callee as Simpul | undefined;
      if (!callee || callee.type !== "MemberExpression") return;
      if (namaProperti(callee) !== "limit") return;

      const { teks, lebihSatu } = bacaArgumen(isi, n);
      const fn = fungsiPembungkus(n, induk);
      let lingkup = fn ? cache.get(fn) : undefined;
      if (fn && !lingkup) {
        lingkup = bacaLingkup(fn);
        cache.set(fn, lingkup);
      }
      const kunci = lingkup?.kunci ?? new Set<string>();

      let kelas: KelasPotong;
      if (teks === "1") {
        kelas = "SATU";
      } else if (lingkup?.sebutan || [...kunci].some((k) => PENANDA.test(k))) {
        kelas = "BERPENANDA";
      } else if ([...kunci].some((k) => HALAMAN.has(k))) {
        kelas = "HALAMAN";
      } else {
        kelas = "SENYAP";
      }

      // `n.start` menunjuk awal SELURUH rantai (`db.select(...)...`), bukan
      // `.limit`. Melaporkannya membuat tiap baris meleset 10–20 baris ke atas
      // — cukup untuk menuduh potongan kode yang salah.
      const titik = (callee.property as Simpul | undefined)?.start ?? n.start;
      const akhirBaris = isi.indexOf("\n", titik);
      keluar.push({
        berkas,
        baris: barisDi(isi, titik),
        bentuk: "drizzle",
        kelas,
        argumen: teks,
        lebihSatu,
        adaAgregat: lingkup?.agregat ?? false,
        penandaDiBerkas: penandaBerkas && kelas === "SENYAP",
        potongan: isi
          .slice(titik, akhirBaris < 0 ? isi.length : akhirBaris)
          .replace(SPASI, " ")
          .trim(),
      });
    });

    // ---- bentuk kedua: `LIMIT` di dalam templat `sql`…`` ------------------
    //
    // Dicari di TEKS quasi, bukan di seluruh berkas: dengan begitu kata
    // "LIMIT" yang muncul di komentar atau di sebuah string biasa tak ikut
    // terhitung, dan yang terhitung benar-benar bagian dari kueri.
    jelajah(akar, (n) => {
      if (n.type !== "TemplateLiteral") return;
      const fn = fungsiPembungkus(n, induk);
      let lingkup = fn ? cache.get(fn) : undefined;
      if (fn && !lingkup) {
        lingkup = bacaLingkup(fn);
        cache.set(fn, lingkup);
      }
      const kunci = lingkup?.kunci ?? new Set<string>();

      for (const q of n.quasis as Simpul[]) {
        const teksQuasi = isi.slice(q.start, q.end);
        for (const m of teksQuasi.matchAll(/\bLIMIT\s+(\$\{?|[0-9]+)/g)) {
          const titik = q.start + m.index!;
          // Argumennya: sisa baris sesudah kata LIMIT, dinormalkan.
          const akhirBaris = isi.indexOf("\n", titik);
          const barisTeks = isi
            .slice(titik, akhirBaris < 0 ? isi.length : akhirBaris)
            .replace(SPASI, " ")
            .trim();
          const arg = barisTeks.replace(/^LIMIT\s+/, "").replace(/\s*`.*$/, "").trim();
          const satu = /^1\b/.test(arg);
          const lebihSatu = /\+\s*1\b/.test(arg);

          let kelas: KelasPotong;
          if (satu) kelas = "SATU";
          else if (lingkup?.sebutan || [...kunci].some((k) => PENANDA.test(k))) {
            kelas = "BERPENANDA";
          }
          else if ([...kunci].some((k) => HALAMAN.has(k))) kelas = "HALAMAN";
          else kelas = "SENYAP";

          keluar.push({
            berkas,
            baris: barisDi(isi, titik),
            bentuk: "sql",
            kelas,
            argumen: arg,
            lebihSatu,
            adaAgregat: lingkup?.agregat ?? false,
            penandaDiBerkas: penandaBerkas && kelas === "SENYAP",
            potongan: barisTeks,
          });
        }
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
