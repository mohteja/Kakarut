import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  barisDi,
  deklarasiTerlihat,
  jelajah,
  namaProperti,
  petaInduk,
  petaLingkup,
  rantaiPenuh,
  uraikan,
  type Simpul,
} from "./ast";
import { berkasKode } from "./rute";

export const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const SKEMA = `${SRC}/db/schema.ts`;

/**
 * URUTAN YANG TIDAK MENENTUKAN — DAN BARIS YANG DIPILIHNYA.
 *
 * `ORDER BY x` atas baris yang nilai `x`-nya SAMA tidak menentukan urutan apa
 * pun. Postgres bebas memulangkannya dalam urutan mana saja, dan urutan itu
 * boleh berbeda antar-query — bahkan untuk kueri yang persis sama, sebab
 * `LIMIT` yang berbeda memakai heapsort ber-BATAS berbeda. Selama seluruh
 * baris dipulangkan, seri hanya soal tampilan. Begitu ada `LIMIT`, serinya
 * memutuskan **baris mana yang ada** dan **baris mana yang tidak**:
 *
 *   - dua baris yang seri bisa muncul di halaman 1 DAN halaman 2;
 *   - sementara baris ketiga TAK MUNCUL DI HALAMAN MANA PUN;
 *   - dan `LIMIT 1` yang menjawab "yang mana yang berlaku sekarang" —
 *     cabang bawaan, shift berjalan, cap absen terakhir, baseline opname —
 *     menjawabnya dengan lemparan koin.
 *
 * Baris yang hilang itu tak meninggalkan gejala. Yang membacanya cuma melihat
 * daftar yang "sepertinya kurang", dan tak ada cara menebak dari mana.
 *
 * SERINYA BUKAN KEBETULAN. Tiga sumber yang sudah ada di repo ini, dan
 * ketiganya lahir dari satu aksi pengguna biasa:
 *
 *   1. `now()` di Postgres STABIL PER TRANSAKSI, jadi seluruh baris yang lahir
 *      dalam satu transaksi berbagi `created_at`/`waktu` yang persis sama.
 *      `rekomendasi/rencana.ts` menyisipkan sampai LIMA faktur berbeda dalam
 *      satu transaksi — kelimanya seri sempurna.
 *   2. Aksi massal menulis SATU timestamp ke banyak baris sekaligus.
 *      "Selesaikan semua" di papan pesanan memakai satu `new Date()` untuk
 *      seluruh baris kartu.
 *   3. Baris yang lahir dari sinkronisasi offline membawa stempel KLIEN, dan
 *      dua perintah dalam satu antrean bisa membawa stempel yang identik.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * KENAPA BERKAS INI MENGGANTIKAN PEMINDAI TEKS YANG SUDAH ADA.
 *
 * Gerbang sebelumnya sudah menuliskan aturan di atas — termasuk sumber seri
 * nomor 1 — lalu kodenya hanya melihat `.orderBy(` yang dalam 500 KARAKTER
 * berikutnya memuat `.offset(`, dan menghitung KOMA alih-alih keunikan. Dua
 * akibatnya terukur:
 *
 *   · dari 52 pengurutan yang memotong, ia menjaga 2 (ambang premisnya sendiri
 *     `>= 2` — persis seluruh populasi yang dilihatnya);
 *   · `GET /produksi` LULUS dengan dua kunci yang keduanya AGREGAT, tak satu
 *     pun unik — sebab komanya ada satu.
 *
 * Aturannya dipikirkan, ditulis, dikomentari; penjaganya dipasang di satu
 * pintu. Yang meleset alat ukurnya, bukan pemikirannya — jadi komentarnya
 * dipertahankan dan pengukurannya yang diganti.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * KEUNIKAN DIBACA DARI SKEMA, BUKAN DIKETIK.
 *
 * `db/schema.ts` diurai: `.primaryKey()`, `.unique()`, `primaryKey({columns})`,
 * dan `uniqueIndex(...).on(...)` dikumpulkan jadi himpunan TUPEL yang membuat
 * sebuah pengurutan total. Daftar yang diketik adalah cara kolom unik
 * berikutnya lahir tanpa dikenali — kesalahan yang persis sama sudah dibayar
 * dua putaran berturut-turut (`potongLarik` dan `kunciBackfillKode` dituduh
 * gerbangnya sendiri karena daftar nama).
 *
 * BATAS YANG DIAKUI, ditulis supaya hijaunya tak dibaca lebih luas:
 *
 * 1. **Hanya kunci TELANJANG yang menyumbang keunikan.** `desc(T.kolom)`,
 *    `asc(T.kolom)`, `T.kolom`. Segala yang lain — agregat, `sql` templat,
 *    `CASE`, `COALESCE` — dicatat sebagai EKSPRESI dan TIDAK dianggap unik,
 *    sekalipun di dalamnya ada nama kolom yang kebetulan unik. `MAX(x)` bukan
 *    `x`, dan menyamakannya adalah pembebasan palsu.
 * 2. **Indeks unik PARSIAL (`uniqueIndex(...).where(...)`) tidak dihitung.**
 *    Ia menjamin keunikan hanya untuk baris yang lolos predikatnya.
 * 3. **JOIN tak dimodelkan.** Tupel unik sebuah tabel dianggap membuat
 *    pengurutan total; pada kueri ber-JOIN yang menggandakan baris, itu bisa
 *    membebaskan terlalu cepat. Situs seperti itu wajib dipilah tangan.
 * 3b. **KUNCI GRUP dihitung unik, dan itu teorema bukan taksiran.** `GROUP BY
 *    x` memulangkan tepat SATU baris per nilai `x`, jadi pengurutan yang
 *    memuat seluruh kunci grupnya sudah total — sekalipun kunci itu sebuah
 *    ekspresi yang keunikannya tak bisa dibaca dari skema. Tanpa aturan ini
 *    setiap kueri beragregat akan tertuduh, dan gerbang yang menuduh sembilan
 *    kueri yang benar adalah gerbang yang ditutup orang. Pencocokannya lewat
 *    TEKS sumber kunci grup — konservatif: kunci grup yang ditulis berbeda
 *    ejaan di `orderBy` tak dikenali, dan itu tuduhan yang bisa dicabut
 *    tangan, bukan pembebasan diam-diam.
 * 4. **Sisi `sql` mentah diresolusi lewat NAMA KOLOM saja**, tanpa tahu alias
 *    mana menunjuk tabel mana. Kunci yang menyebut kolom unik berkolom-tunggal
 *    (`id`, `slug`, …) dihitung total di mana pun ia muncul.
 * 5. **Pengurutan yang dilakukan di JS sesudah kueri** (`sort`,
 *    `localeCompare`) bukan populasi berkas ini.
 * 6. **`ORDER BY` yang dirakit di luar templat `sql`** (potongan string yang
 *    disambung) tak terlihat.
 */

/** Dari mana pengurutannya berasal. */
export type Bentuk = "drizzle" | "sql";

export type KelasUrut =
  /** Kunci urutnya memuat tupel unik — dua baris tak bisa seri. */
  | "TOTAL"
  /** Tak ada tupel unik di antara kuncinya: baris yang seri urutannya bebas. */
  | "SERI";

export interface Situs {
  /** relatif terhadap `src/` */
  berkas: string;
  baris: number;
  bentuk: Bentuk;
  kelas: KelasUrut;
  /**
   * Kunci daftar-beralasan yang TIDAK ikut bergeser saat baris bergeser.
   *
   * Putaran 27 membayar pembusukan kunci bernomor baris untuk kedua kalinya
   * (satu baris `import` menggeser 1228 jadi 1229 dan dua gerbang memerah).
   * Sekali cukup; di sini kuncinya berkas + kunci urut pertamanya.
   */
  kunci: string;
  /** teks tiap kunci urut, dinormalkan */
  kunciUrut: string[];
  /** `tabel.kolom` yang berhasil diresolusi TELANJANG (bukan ekspresi) */
  kolom: string[];
  /** ada kunci yang bentuknya ekspresi (agregat / `sql` / `CASE`) */
  adaEkspresi: boolean;
  /** kunci `GROUP BY`-nya, bila ada — unik per baris hasil menurut konstruksi */
  grup: string[];
  /** teks batas potongannya — `.limit(x)` atau `LIMIT x` */
  batas: string;
  /** berpaginasi sungguhan (`.offset()` / `OFFSET`) */
  berOffset: boolean;
}

const SPASI = /\s+/g;
const rapi = (s: string): string => s.replace(SPASI, " ").trim();

/* ── keunikan, dibaca dari skema ─────────────────────────────────────────── */

export interface Keunikan {
  /** nama VAR tabel (mis. `productions`) → daftar tupel kolom yang unik */
  tupel: Map<string, string[][]>;
  /** nama KOLOM DB yang unik sendirian (mis. `id`, `slug`) — untuk `sql` mentah */
  kolomDb: Set<string>;
}

/** Apakah rantai sebuah kolom memanggil `.primaryKey()` / `.unique()`. */
function rantaiMemanggil(n: Simpul | undefined, nama: string): boolean {
  let ketemu = false;
  jelajah(n, (x) => {
    if (ketemu || x.type !== "CallExpression") return;
    if (namaProperti(x.callee as Simpul) === nama) ketemu = true;
  });
  return ketemu;
}

/** Nama kolom DB (`uuid("id")` → `id`), bila argumen pertamanya literal teks. */
function namaDb(n: Simpul | undefined): string | undefined {
  let hasil: string | undefined;
  jelajah(n, (x) => {
    if (hasil !== undefined || x.type !== "CallExpression") return;
    const arg = (x.arguments ?? [])[0] as Simpul | undefined;
    if (arg?.type === "Literal" && typeof arg.value === "string") hasil = arg.value;
  });
  return hasil;
}

/** `t.companyId, t.nama` → `["companyId","nama"]`; kosong bila ada yang bukan `t.x`. */
function tupelDari(args: Simpul[]): string[] | undefined {
  const keluar: string[] = [];
  for (const a of args) {
    const nm = a.type === "MemberExpression" ? namaProperti(a) : undefined;
    if (!nm) return undefined;
    keluar.push(nm);
  }
  return keluar.length > 0 ? keluar : undefined;
}

/**
 * Urai `db/schema.ts` jadi peta keunikan.
 *
 * `kodeSkema` bisa disuntik supaya uji PREMIS tak bersandar pada kebetulan
 * bahwa pohon sungguhan masih memuat contoh yang dibutuhkannya — pelajaran
 * putaran 27, tempat contoh terakhirnya lenyap justru karena diperbaiki.
 */
export function petaUnik(kodeSkema?: string): Keunikan {
  const isi = kodeSkema ?? readFileSync(SKEMA, "utf8");
  const pohon = uraikan(SKEMA, isi);
  const tupel = new Map<string, string[][]>();
  const kolomDb = new Set<string>();

  jelajah(pohon, (n) => {
    if (n.type !== "VariableDeclarator" || n.id?.type !== "Identifier") return;
    const init = n.init as Simpul | undefined;
    if (init?.type !== "CallExpression") return;
    const callee = init.callee as Simpul | undefined;
    if (callee?.type !== "Identifier" || callee.name !== "pgTable") return;

    const nama = n.id.name as string;
    const daftar: string[][] = [];
    const args = (init.arguments ?? []) as Simpul[];

    // (a) kolom yang menyatakan dirinya sendiri unik
    const kolomObj = args[1];
    if (kolomObj?.type === "ObjectExpression") {
      for (const p of (kolomObj.properties ?? []) as Simpul[]) {
        if (p.type !== "Property" || p.key?.type !== "Identifier") continue;
        const nilai = p.value as Simpul | undefined;
        if (!rantaiMemanggil(nilai, "primaryKey") && !rantaiMemanggil(nilai, "unique")) continue;
        daftar.push([p.key.name as string]);
        const db = namaDb(nilai);
        if (db) kolomDb.add(db);
      }
    }

    // (b) tupel di callback tambahan: `(t) => [ … ]`
    const ekstra = args[2];
    if (ekstra) {
      jelajah(ekstra, (x) => {
        if (x.type !== "CallExpression") return;
        const c = x.callee as Simpul | undefined;
        // `primaryKey({ columns: [t.a, t.b] })`
        if (c?.type === "Identifier" && c.name === "primaryKey") {
          const obj = (x.arguments ?? [])[0] as Simpul | undefined;
          const kol = (obj?.properties ?? []).find(
            (p: Simpul) => p.type === "Property" && p.key?.name === "columns",
          ) as Simpul | undefined;
          const t = kol?.value?.type === "ArrayExpression" ? tupelDari(kol.value.elements) : undefined;
          if (t) daftar.push(t);
          return;
        }
        // `uniqueIndex("…").on(t.a, t.b)` — rantai PARSIAL (`.where(…)`) dibuang
        if (namaProperti(c as Simpul) !== "on") return;
        const dasar = (c as Simpul).object as Simpul | undefined;
        if (dasar?.type !== "CallExpression") return;
        const d = dasar.callee as Simpul | undefined;
        if (d?.type !== "Identifier" || d.name !== "uniqueIndex") return;
        const luar = rantaiPenuh(x, petaInduk(ekstra));
        if (rantaiMemanggil(luar, "where")) return;
        const t = tupelDari((x.arguments ?? []) as Simpul[]);
        if (t) daftar.push(t);
      });
    }

    if (daftar.length > 0) tupel.set(nama, daftar);
  });

  return { tupel, kolomDb };
}

/* ── kunci urut sebuah pengurutan Drizzle ────────────────────────────────── */

const ARAH = new Set(["desc", "asc"]);

/**
 * Kunci TELANJANG sebuah argumen `orderBy`: `desc(T.kolom)` / `T.kolom`.
 *
 * Mengembalikan `undefined` untuk segala bentuk lain — itu bukan kegagalan
 * membaca melainkan vonis yang benar: `desc(sql\`max(${T.waktu})\`)` mengurut
 * MAX-nya, bukan kolomnya, dan keunikan kolom tak berpindah ke agregatnya.
 */
function kunciTelanjang(arg: Simpul): { tabel: string; kolom: string } | undefined {
  let x = arg;
  if (x.type === "CallExpression") {
    const c = x.callee as Simpul | undefined;
    if (c?.type !== "Identifier" || !ARAH.has(c.name as string)) return undefined;
    const dalam = (x.arguments ?? [])[0] as Simpul | undefined;
    if (!dalam) return undefined;
    x = dalam;
  }
  if (x.type !== "MemberExpression") return undefined;
  const kolom = namaProperti(x);
  const obj = x.object as Simpul | undefined;
  if (!kolom || obj?.type !== "Identifier") return undefined;
  return { tabel: obj.name as string, kolom };
}

/**
 * Buang pembungkus ARAH supaya kunci grup dan kunci urut bisa diadu utuh:
 * `desc(x)` / `asc(x)` di Drizzle, `… DESC NULLS LAST` di SQL mentah.
 */
function tanpaArah(k: string): string {
  const drizzle = /^(?:desc|asc)\(([\s\S]*)\)$/.exec(k.trim());
  if (drizzle) return rapi(drizzle[1]);
  return rapi(k.replace(/\s+(?:ASC|DESC)\b/i, "").replace(/\s+NULLS\s+(?:FIRST|LAST)\b/i, ""));
}

/**
 * Seluruh kunci grup hadir UTUH di antara kunci urut → total (lihat batas 3b).
 *
 * Pencocokannya PERSIS, bukan substring. Generasi pertama fungsi ini memakai
 * `includes`, dan bukti merahnya langsung menangkapnya: kunci grup `k`
 * dinyatakan hadir di dalam kunci urut `MAX(waktu) DESC` — sebab kata `waktu`
 * memuat huruf `k`. Sebuah kueri beragregat tanpa pemutus seri dibebaskan oleh
 * satu huruf. Itu persis kelas kesalahan yang jadi alasan instrumen ini pindah
 * ke pohon sintaks; membiarkannya hidup di pembanding teks tak lebih baik.
 */
function grupTerpakai(grup: string[], kunciUrut: string[]): boolean {
  if (grup.length === 0) return false;
  const teks = kunciUrut.map(tanpaArah);
  return grup.every((g) => teks.includes(tanpaArah(g)));
}

/** Sebuah pengurutan total bila SATU tabel menyumbang seluruh tupel uniknya. */
function total(kolom: { tabel: string; kolom: string }[], unik: Keunikan): boolean {
  const perTabel = new Map<string, Set<string>>();
  for (const k of kolom) {
    let s = perTabel.get(k.tabel);
    if (!s) perTabel.set(k.tabel, (s = new Set()));
    s.add(k.kolom);
  }
  for (const [tabel, punya] of perTabel) {
    for (const t of unik.tupel.get(tabel) ?? []) {
      if (t.every((c) => punya.has(c))) return true;
    }
  }
  return false;
}

/* ── sisi `sql` mentah ───────────────────────────────────────────────────── */

const POLA_ORDER = /\bORDER\s+BY\b/i;
const POLA_LIMIT = /\bLIMIT\b/i;
const POLA_OFFSET = /\bOFFSET\b/i;

/**
 * Pecah daftar kunci SQL pada koma BER-KEDALAMAN NOL.
 *
 * Pemecahan `split(",")` yang polos merusak `COALESCE(a, b)` jadi dua kunci
 * palsu — dan akibatnya bukan sekadar salah hitung: kunci grup yang terpecah
 * tak pernah cocok dengan kunci urutnya, jadi kueri yang sudah benar tetap
 * tertuduh. Terjadi pada `sampah/routes.ts` saat berkas ini ditulis.
 */
function pecahKunci(s: string): string[] {
  const keluar: string[] = [];
  let dalam = 0;
  let mulai = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "(") dalam += 1;
    else if (c === ")") dalam -= 1;
    else if (c === "," && dalam === 0) {
      keluar.push(rapi(s.slice(mulai, i)));
      mulai = i + 1;
    }
  }
  const sisa = rapi(s.slice(mulai));
  if (sisa) keluar.push(sisa);
  return keluar.filter(Boolean);
}

/** Potongan `ORDER BY … ` sampai `LIMIT`/`OFFSET`/akhir, dipecah per kunci. */
export function kunciSql(teks: string): string[] {
  const m = POLA_ORDER.exec(teks);
  if (!m) return [];
  let ekor = teks.slice(m.index + m[0].length);
  const stop = ekor.search(/\bLIMIT\b|\bOFFSET\b|\)\s*$/i);
  if (stop >= 0) ekor = ekor.slice(0, stop);
  return pecahKunci(ekor);
}

/**
 * Teks templat `sql`, KOMENTAR BARIS SQL-nya dibuang.
 *
 * `-- … LIMIT …` di dalam sebuah komentar terbaca sebagai klausa sungguhan,
 * dan itu bukan kemungkinan teoretis: komentar yang menjelaskan pemutus seri
 * di `stok/service.ts` menyebut kata `LIMIT`, dan generasi pertama pembaca ini
 * langsung melaporkan batas bernama `memilih`. Pemindai yang bisa dibingungkan
 * oleh komentar akan dibungkam dengan komentar.
 */
function tekstemplat(isi: string, n: Simpul): string {
  return isi.slice(n.start, n.end).replace(/--[^\n]*/g, "");
}

/**
 * Alias yang menyalin kolom UNIK apa adanya: `so.id AS ev_id` → `ev_id` unik.
 *
 * Deret `UNION ALL` tak bisa memakai nama kolom aslinya di `ORDER BY` luar;
 * ia harus menyebut alias. Tanpa aturan ini, pemutus seri yang BENAR di sana
 * tetap tertuduh — dan gerbang yang menuduh perbaikannya sendiri adalah
 * gerbang yang tak akan dipatuhi.
 */
function aliasUnik(teks: string, kolomDb: Set<string>): Set<string> {
  const keluar = new Set<string>();
  for (const m of teks.matchAll(/(?:^|[\s,(])(?:\w+\.)?(\w+)\s+AS\s+(\w+)/gi)) {
    if (kolomDb.has(m[1])) keluar.add(m[2]);
  }
  return keluar;
}

/* ── sapuan ──────────────────────────────────────────────────────────────── */

const SEBUT = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Seluruh pengurutan yang MEMOTONG, dua bentuk sekaligus.
 *
 * `kode` bisa disuntik (peta `berkas relatif → isi`) supaya bukti merah dan
 * uji premis tak bersandar pada pohon sungguhan.
 */
export function situsUrut(kode?: Record<string, string>, kodeSkema?: string): Situs[] {
  const unik = petaUnik(kodeSkema);
  const berkas = kode
    ? Object.keys(kode)
    : berkasKode(SRC, /\.ts$/).map((p) => p.slice(SRC.length + 1));
  const keluar: Situs[] = [];

  for (const rel of berkas) {
    const isi = kode ? kode[rel] : readFileSync(`${SRC}/${rel}`, "utf8");
    const pohon = uraikan(rel, isi);
    const induk = petaInduk(pohon);
    const lingkup = petaLingkup(pohon, induk);

    /* (1) rantai Drizzle: `.orderBy(…)` yang serantai dengan `.limit`/`.offset` */
    const perRantai = new Map<
      Simpul,
      { ob?: Simpul; batas: string; berOffset: boolean; grup: string[] }
    >();
    jelajah(pohon, (n) => {
      if (n.type !== "CallExpression") return;
      const nama = namaProperti(n.callee as Simpul);
      if (nama !== "orderBy" && nama !== "limit" && nama !== "offset" && nama !== "groupBy") return;
      const akar = rantaiPenuh(n, induk);
      const e = perRantai.get(akar) ?? { batas: "", berOffset: false, grup: [] };
      if (nama === "orderBy") e.ob = n;
      if (nama === "limit") {
        const a = (n.arguments ?? [])[0] as Simpul | undefined;
        e.batas = a ? rapi(isi.slice(a.start, a.end)) : "?";
      }
      if (nama === "offset") e.berOffset = true;
      if (nama === "groupBy") {
        e.grup = ((n.arguments ?? []) as Simpul[]).map((a) => rapi(isi.slice(a.start, a.end)));
      }
      perRantai.set(akar, e);
    });

    for (const [, e] of perRantai) {
      if (!e.ob) continue;
      if (!e.batas && !e.berOffset) continue; // mengurut tanpa memotong — populasi lain
      const args: Simpul[] = [];
      for (const a of (e.ob.arguments ?? []) as Simpul[]) {
        if (a.type !== "SpreadElement") {
          args.push(a);
          continue;
        }
        // `...urutan` — larik kunci yang dirakit di variabel; dibuka bila
        // deklarasinya terlihat dan bentuknya literal larik.
        const arg = a.argument as Simpul | undefined;
        const d =
          arg?.type === "Identifier"
            ? deklarasiTerlihat(a, arg.name as string, induk, lingkup)
            : undefined;
        // `[…] as const` membungkus lariknya dalam `TSAsExpression`; kedua
        // situs `...urutan` di repo ini menulisnya begitu, jadi pembaca yang
        // hanya kenal `ArrayExpression` akan menuduh larik yang sudah benar.
        let nilai = d?.nilai;
        while (nilai?.type === "TSAsExpression" || nilai?.type === "TSSatisfiesExpression") {
          nilai = nilai.expression as Simpul;
        }
        if (nilai?.type === "ArrayExpression") args.push(...((nilai.elements ?? []) as Simpul[]));
        else args.push(a); // tak terurai → ekspresi, dan itu vonis yang jujur
      }
      const kolom = args.map(kunciTelanjang);
      const terpakai = kolom.filter((k): k is { tabel: string; kolom: string } => Boolean(k));
      const kunciUrut = args.map((a) => rapi(isi.slice(a.start, a.end)).slice(0, 80));
      const prop = (e.ob.callee as Simpul).property as Simpul;
      keluar.push({
        berkas: rel,
        baris: barisDi(isi, prop.start),
        bentuk: "drizzle",
        kelas:
          total(terpakai, unik) || grupTerpakai(e.grup, kunciUrut) ? "TOTAL" : "SERI",
        kunci: `${rel} ${kunciUrut[0] ?? "?"}`,
        kunciUrut,
        kolom: terpakai.map((k) => `${k.tabel}.${k.kolom}`),
        adaEkspresi: terpakai.length < args.length,
        grup: e.grup,
        batas: e.batas,
        berOffset: e.berOffset,
      });
    }

    /* (2) templat `sql` yang memuat ORDER BY DAN LIMIT — jalur yang pemindai
       teks sebelumnya tak pernah lihat sama sekali. */
    jelajah(pohon, (n) => {
      if (n.type !== "TemplateLiteral") return;
      const induknya = induk.get(n);
      if (induknya?.type !== "TaggedTemplateExpression") return;
      const tag = induknya.tag as Simpul | undefined;
      const namaTag = tag?.type === "Identifier" ? tag.name : namaProperti(tag as Simpul);
      if (namaTag !== "sql" && namaTag !== "raw") return;
      const teks = tekstemplat(isi, n);
      if (!POLA_ORDER.test(teks) || !POLA_LIMIT.test(teks)) return;
      const kunciUrut = kunciSql(teks);
      if (kunciUrut.length === 0) return;
      // Kunci telanjang di SQL mentah: satu sebutan kolom, tanpa kurung.
      const kolom: string[] = [];
      let ekspresi = false;
      for (const k of kunciUrut) {
        if (k.includes("(") || k.includes("${")) {
          ekspresi = true;
          continue;
        }
        const sebut = [...k.matchAll(SEBUT)]
          .map((m) => m[0])
          .filter((s) => !/^(ASC|DESC|NULLS|FIRST|LAST)$/i.test(s));
        const akhir = sebut[sebut.length - 1];
        if (akhir) kolom.push(akhir);
      }
      const alias = aliasUnik(teks, unik.kolomDb);
      const cocok = kolom.some((c) => unik.kolomDb.has(c) || alias.has(c));
      const grupM = /\bGROUP\s+BY\b([\s\S]*?)(\bORDER\s+BY\b|\bHAVING\b|\bLIMIT\b|$)/i.exec(teks);
      const grup = grupM ? pecahKunci(grupM[1]) : [];
      const batasM = /\bLIMIT\s+([^\s`]+)/i.exec(teks);
      keluar.push({
        berkas: rel,
        baris: barisDi(isi, n.start + teks.search(POLA_ORDER)),
        bentuk: "sql",
        kelas: cocok || grupTerpakai(grup, kunciUrut) ? "TOTAL" : "SERI",
        kunci: `${rel} ${kunciUrut[0]}`,
        kunciUrut,
        kolom,
        adaEkspresi: ekspresi,
        grup,
        batas: batasM ? rapi(batasM[1]) : "?",
        berOffset: POLA_OFFSET.test(teks),
      });
    });
  }

  return keluar.sort((a, b) => a.berkas.localeCompare(b.berkas) || a.baris - b.baris);
}
