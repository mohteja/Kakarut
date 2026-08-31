import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { barisDi, jelajah, namaProperti, petaInduk, uraikan, type Simpul } from "./ast";
import { berkasKode } from "./rute";

export const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * PERIKSA-DULU-BARU-TULIS, DAN APA YANG MENAHANNYA SAAT DUA ORANG BERSAMAAN.
 *
 * Aturannya bukan karangan gerbang ini. Ia sudah ditulis lengkap di
 * `src/lib/kunci.ts`, beserta ketiga jawaban sahnya:
 *
 * > *"Pola 'periksa dulu, baru tulis' hanya aman bila ada sesuatu untuk
 * > DIKUNCI. … Indeks unik menutup celah itu bila aturannya bisa ditulis
 * > sebagai kesamaan kolom … Yang TIDAK bisa: aturan bertindih rentang
 * > tanggal. Untuk itu kuncinya harus diambil atas NAMA aturan."*
 *
 * Dan `modules/pengajuan/routes.ts:337` menamai jawaban KEEMPAT, yang sudah
 * baku di basis kode ini:
 *
 * > *"Idiomnya sudah baku di basis kode ini — lihat persetujuan penyesuaian
 * > opname: UPDATE bersyarat status + periksa barisnya + 409/404."*
 *
 * Empat jawaban, dan gerbang ini menerima keempatnya:
 *
 * | kelas | yang menahan balapannya |
 * |---|---|
 * | `KUNCI` | `FOR UPDATE` atau `kunciAntrean`/`pg_advisory_xact_lock` |
 * | `BENTROK` | indeks unik + penanganannya (`onConflict`, `tanpaBentrok`) |
 * | `KLAIM` | UPDATE bersyarat **dan hasilnya DIPERIKSA** — atau tabelnya DIBACA ULANG sesudahnya |
 * | `KLAIM_BUTA` | UPDATE bersyarat, hasilnya **tak pernah dilihat** — accusable |
 * | `TELANJANG` | tak satu pun — accusable |
 *
 * `KLAIM_BUTA` sengaja dipisah dari `TELANJANG`, dan ia bentuk yang paling
 * sulit dilihat mata: kodenya TERLIHAT menjaga dirinya. Syarat di `WHERE`
 * memang membuat penulis kedua tak menimpa apa pun — tapi bila tak ada yang
 * membaca "berapa baris kena", pemanggilnya tetap dibalas 200 dan tetap
 * mengira putusannya berlaku. Komentar `pengajuan/routes.ts` menuliskan
 * akibatnya: *"Karyawannya bisa diberi tahu 'disetujui' sementara catatannya
 * berbunyi 'ditolak'."*
 *
 * YANG DISAPU adalah fungsi yang MEMBACA dan MENULIS **tabel yang sama** —
 * bukan sembarang baca-lalu-tulis. "Muat induknya, 404 kalau tak ada, lalu
 * tulis anaknya" bukan balapan: penulisannya sendiri atomik, dan induk yang
 * terhapus bersamaan hanya membuat penulisannya gagal FK.
 *
 * Idiom "baca ulang" itu jawaban KELIMA, dan gerbang ini belajar mengenalinya
 * dari `POST /shift/kunci-hitungan` — pintu yang komentarnya sudah menuliskan
 * alasannya: *"bila dua permintaan berbarengan, yang kalah balapan harus
 * melaporkan nominal yang BENAR-BENAR tersimpan, bukan yang ia kirim."*
 * Generasi pertama gerbang ini menuduhnya, dan tuduhan itu salah.
 *
 * BATAS YANG DIAKUI:
 * 1. Lingkupnya satu FUNGSI. Kunci yang diambil pemanggil (mis. handler
 *    membuka transaksi lalu memanggil service) tak terlihat dari dalam.
 * 2. "Hasilnya diperiksa" dinilai dari pengenal hasilnya yang muncul di
 *    sebuah `if`/`throw` di fungsi yang sama — cukup untuk idiom baku di
 *    repo ini, dan tak lebih.
 * 3. Nama tabel dibandingkan sebagai TEKS argumen (`.from(x)` vs
 *    `.update(x)`), jadi alias tabel (`sql` mentah, subquery) tak terlihat.
 */
export type KelasLomba = "KUNCI" | "BENTROK" | "KLAIM" | "KLAIM_BUTA" | "TELANJANG";

export interface SitusLomba {
  /** relatif terhadap `src/` */
  berkas: string;
  baris: number;
  kelas: KelasLomba;
  /** tabel yang dibaca DAN ditulis fungsi ini */
  tabel: string[];
  /** nama fungsi bila ada — kunci daftar yang tak bergeser saat baris bergeser */
  nama: string;
  potongan: string;
}

const SPASI = /\s+/g;
/**
 * Bukti bahwa balapannya ditahan sebuah KUNCI.
 *
 * Pembantunya dikenali dari BENTUK namanya (`kunci…(`), bukan dari daftar
 * nama — daftar nama adalah cara gerbang ini menuduh pembantu berikutnya yang
 * lahir. Sudah terjadi dalam satu putaran yang sama: `kunciBackfillKode`
 * ditambahkan sebagai perbaikan, lalu gerbangnya sendiri menuduh perbaikan itu.
 */
const KUNCI = /FOR UPDATE|pg_advisory|\bkunci[A-Z]\w*\s*\(/;
const BENTROK = /onConflict|tanpaBentrok|bentrokUnik/;

const FUNGSI = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

/**
 * Apakah `fn` adalah CALLBACK sebuah `.transaction(...)`.
 *
 * Callback transaksi bukan fungsi lain dari sudut pandang balapan — ia badan
 * fungsi induknya yang kebetulan atomik. Memperlakukannya sebagai fungsi
 * terpisah adalah kebutaan yang paling mahal di berkas ini, dan harganya
 * terukur: dari **73** callback transaksi di `src`, **31** memuat `.update(`
 * langsung di dalamnya dan **17** di antaranya memegang klaim yang DIPERIKSA
 * (`returning` + `if`/`throw`) — tak satu pun terlihat oleh generasi pertama
 * pemindai ini.
 *
 * Akibat nyatanya tercatat di ledger: `tibaBeliPerlengkapan` didaftarkan
 * sebagai `utang` dengan kalimat *"klaimnya ADA … tapi hasilnya tak pernah
 * dilihat, jadi yang kalah balapan tetap dibalas sukses"* — padahal
 * pemeriksaannya (`if (dikunci.length === 0) throw SUDAH`) sudah ada lima
 * minggu SEBELUM utang itu dicatat. Yang tak terlihat bukan pemeriksaannya,
 * melainkan transaksi yang membungkusnya; yang tersisa di mata pemindai cuma
 * satu `update` jinak di luar transaksi, dan dari situ lahir tuduhan yang
 * kalimatnya menggambarkan baris yang lain.
 */
function callbackTransaksi(fn: Simpul, induk: Map<Simpul, Simpul>): boolean {
  const p = induk.get(fn);
  if (!p || p.type !== "CallExpression") return false;
  if ((p.arguments as Simpul[])?.[0] !== fn) return false;
  return namaProperti(p.callee as Simpul) === "transaction";
}

/**
 * Fungsi yang MEMILIKI panggilan ini — dengan callback transaksi ditembus.
 *
 * Callback selain `.transaction(` TIDAK ditembus, dan itu disengaja: `.map(…)`
 * atau `Promise.all([…])` benar-benar menjalankan badannya di konteks lain,
 * sementara `db.transaction(cb)` menjalankan `cb` tepat sekali, di alur yang
 * sama, sebagai bagian dari fungsi yang menuliskannya.
 */
function fungsiPembungkus(n: Simpul, induk: Map<Simpul, Simpul>): Simpul | undefined {
  let k: Simpul | undefined = induk.get(n);
  while (k) {
    if (FUNGSI.has(k.type)) {
      if (!callbackTransaksi(k, induk)) return k;
      // callback transaksi → naik terus, panggilannya milik fungsi induknya
    }
    k = induk.get(k);
  }
  return undefined;
}

/** Nama fungsi terdekat yang bisa disebut — untuk kunci daftar. */
function namaFungsi(fn: Simpul, induk: Map<Simpul, Simpul>, isi: string): string {
  if (fn.type === "FunctionDeclaration" && fn.id) return (fn.id as Simpul).name as string;
  const p = induk.get(fn);
  if (p?.type === "VariableDeclarator" && p.id?.type === "Identifier") {
    return p.id.name as string;
  }
  // handler rute: `.patch("/:id", …)` → pakai metode + jalurnya
  let k: Simpul | undefined = p;
  while (k && k.type !== "CallExpression") k = induk.get(k);
  if (k?.type === "CallExpression" && k.callee?.type === "MemberExpression") {
    const m = namaProperti(k.callee as Simpul);
    const arg0 = (k.arguments as Simpul[])[0];
    if (m && arg0 && arg0.type === "Literal" && typeof arg0.value === "string") {
      return `${m.toUpperCase()} ${arg0.value}`;
    }
    if (m) return m;
  }
  return `@${barisDi(isi, fn.start)}`;
}

/**
 * Pengenal yang hasilnya benar-benar DILIHAT: di sebuah `if`/`throw`, ATAU
 * dikirim ke pemanggil lewat `c.json(...)`.
 *
 * Generasi pertama gerbang ini hanya mengenal `if`/`throw`, dan langsung
 * menuduh `POST /stok/opname/sesi/:id/acc` — justru pintu yang dikutip
 * `pengajuan/routes.ts` sebagai CONTOH BAKU idiom ini. Pintu itu memulangkan
 * `{ ok: true, jumlah: updated.length }`: untuk operasi borongan, mengabarkan
 * BERAPA yang kena lebih jujur daripada melempar — nol baris di situ bukan
 * galat, melainkan kabar. Menuduhnya berarti menyuruh memperbaiki contoh yang
 * dirujuk seluruh basis kode.
 */
function yangDiperiksa(fn: Simpul): Set<string> {
  const keluar = new Set<string>();
  const kumpul = (n: unknown): void => {
    jelajah(n, (x) => {
      if (x.type === "Identifier") keluar.add(x.name as string);
    });
  };
  jelajah(fn, (n) => {
    if (n.type === "IfStatement") kumpul(n.test);
    if (n.type === "ThrowStatement") kumpul(n.argument);
    if (n.type === "ConditionalExpression") kumpul(n.test);
    if (n.type === "ReturnStatement" && n.argument?.type === "ConditionalExpression") {
      kumpul((n.argument as Simpul).test);
    }
    // `c.json(...)` — hasilnya sampai ke pemanggil, dan itu juga "melihat".
    if (
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      namaProperti(n.callee as Simpul) === "json"
    ) {
      kumpul(n.arguments);
    }
  });
  return keluar;
}

interface Lingkup {
  baca: Set<string>;
  tulis: Set<string>;
  /** pengenal hasil `update(...).where(...)` atas tabel yang juga dibaca */
  klaim: string[];
  /** ada `.from(T)` pada posisi SESUDAH `.update(T)` — baca ulang pasca-klaim */
  bacaUlang: boolean;
}

function bacaLingkup(fn: Simpul, isi: string, induk: Map<Simpul, Simpul>): Lingkup {
  const baca = new Set<string>();
  const tulis = new Set<string>();
  const klaim: string[] = [];
  const posBaca = new Map<string, number[]>();
  const posTulis = new Map<string, number[]>();

  jelajah(fn, (n) => {
    if (n.type !== "CallExpression") return;
    const c = n.callee as Simpul | undefined;
    if (!c || c.type !== "MemberExpression") return;
    const nama = namaProperti(c);
    if (nama !== "from" && nama !== "insert" && nama !== "update") return;
    // hanya panggilan di fungsi INI, bukan di fungsi bersarang di dalamnya
    if (fungsiPembungkus(n, induk) !== fn) return;
    const arg = (n.arguments as Simpul[])[0];
    if (!arg) return;
    const t = isi.slice(arg.start, arg.end).trim();
    if (nama === "from") {
      baca.add(t);
      posBaca.set(t, [...(posBaca.get(t) ?? []), n.start]);
      return;
    }
    tulis.add(t);
    if (nama === "update") posTulis.set(t, [...(posTulis.get(t) ?? []), n.start]);
    if (nama !== "update") return;

    // Sebuah KLAIM: `update(T)…where(…)`. Naik ke ujung rantainya lalu cari
    // pengenal yang mengikatnya.
    let ujung: Simpul = n;
    let p = induk.get(ujung);
    let adaWhere = false;
    while (p && (p.type === "MemberExpression" || p.type === "CallExpression" || p.type === "AwaitExpression")) {
      if (p.type === "MemberExpression" && namaProperti(p) === "where") adaWhere = true;
      ujung = p;
      p = induk.get(p);
    }
    if (!adaWhere) return;
    if (p?.type === "VariableDeclarator") {
      const id = p.id as Simpul | undefined;
      if (id?.type === "Identifier") klaim.push(id.name as string);
      // `const [x] = await db.update(...)`
      else if (id?.type === "ArrayPattern") {
        for (const el of (id.elements ?? []) as (Simpul | null)[]) {
          if (el?.type === "Identifier") klaim.push(el.name as string);
        }
      } else klaim.push("");
    } else {
      // hasilnya tak diikat sama sekali → pasti tak diperiksa
      klaim.push("");
    }
  });

  let bacaUlang = false;
  for (const [t, tulisAt] of posTulis) {
    const bacaAt = posBaca.get(t) ?? [];
    if (bacaAt.some((b) => tulisAt.some((w) => b > w))) bacaUlang = true;
  }

  return { baca, tulis, klaim, bacaUlang };
}

export function situsLomba(kode?: Record<string, string>): SitusLomba[] {
  const keluar: SitusLomba[] = [];

  const ambil = (berkas: string, isi: string): void => {
    if (!/\.insert\(|\.update\(/.test(isi)) return;
    const akar = uraikan(berkas, isi);
    const induk = petaInduk(akar);
    const fungsi = new Set<Simpul>();
    jelajah(akar, (n) => {
      if (
        n.type === "ArrowFunctionExpression" ||
        n.type === "FunctionExpression" ||
        n.type === "FunctionDeclaration"
      ) {
        fungsi.add(n);
      }
    });

    for (const fn of fungsi) {
      // Callback transaksi kini DIHITUNG MILIK fungsi induknya, jadi ia tak
      // boleh dinilai lagi sebagai situs tersendiri — satu balapan yang sama
      // akan muncul dua kali, dan angka populasi berhenti berarti.
      if (callbackTransaksi(fn, induk)) continue;
      const { baca, tulis, klaim, bacaUlang } = bacaLingkup(fn, isi, induk);
      const tabel = [...tulis].filter((t) => baca.has(t)).sort();
      if (tabel.length === 0) continue;

      const teks = isi.slice(fn.start, fn.end);
      const diperiksa = yangDiperiksa(fn);

      let kelas: KelasLomba;
      if (KUNCI.test(teks)) kelas = "KUNCI";
      else if (BENTROK.test(teks)) kelas = "BENTROK";
      else if (klaim.length > 0) {
        const dilihat = klaim.some((k) => k !== "" && diperiksa.has(k));
        kelas = dilihat || bacaUlang ? "KLAIM" : "KLAIM_BUTA";
      } else kelas = "TELANJANG";

      keluar.push({
        berkas,
        baris: barisDi(isi, fn.start),
        kelas,
        tabel,
        nama: namaFungsi(fn, induk, isi),
        potongan: teks.slice(0, 120).replace(SPASI, " ").trim(),
      });
    }
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
