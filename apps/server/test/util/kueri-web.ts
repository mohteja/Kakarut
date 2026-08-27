import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { barisDi, jelajah, petaInduk, uraikan, type Simpul } from "./ast";

/**
 * GAGAL MEMUAT ≠ TIDAK ADA — dan ≠ NOL.
 *
 * `useQuery` memulangkan `data === undefined` pada dua keadaan yang sama
 * sekali berbeda: belum termuat, dan GAGAL termuat. Gerbang pertama untuk
 * kelas ini (`gagal-muat-bukan-kosong.test.ts`) sudah ada, dan ia jujur: ia
 * menuliskan batasnya sendiri, dan batas itu benar untuk DUA bentuk yang
 * dipikirkannya —
 *
 *   KALIMAT  `(supplier ?? []).length === 0` → "Belum ada supplier"  → dijaga
 *   PILIHAN  `(x ?? []).map(…)` di dropdown  → SENGAJA dilewati, beralasan:
 *            "daftar pilihan yang kosong tak MENGKLAIM apa pun — ia hanya tak
 *            menawarkan apa-apa"
 *
 * Ada bentuk KETIGA, dan alasan pengecualian di atas **tidak berlaku
 * untuknya**: **ANGKA**. `(pengajuanNav ?? []).length` yang dirender sebagai
 * LENCANA bukan daftar pilihan — lencana yang lenyap memang mengklaim sesuatu:
 * *"tidak ada yang menunggu."* Dan lencana itu hidup di `Layout.tsx`, komponen
 * yang tampil di SETIAP layar, dengan `refetchInterval` 30–60 detik.
 *
 * Dua batas gerbang lama yang ikut dicabut di sini:
 *
 *   1. ia berbasis REGEX (`const { … } = useQuery(`), jadi buta pada
 *      `const q = useQuery(…)`;
 *   2. bentuk angkanya dikenali lewat DAFTAR POLA, dan daftar pola selalu
 *      kurang. Versi pertama sapuan ini melaporkan 11 situs — lalu lima
 *      lencana `Layout.tsx` lain ketahuan memakai `?.length ?? 0`, `.size`,
 *      dan `?? false`. Karena itu aturannya ditulis dari BENTUK: ke mana
 *      `data` mengalir, bukan pola apa yang kebetulan sudah terlihat.
 */

const AKAR = fileURLToPath(new URL("../../../../apps/web/src/", import.meta.url));

export type KelasKueri = "GALAT" | "ANGKA" | "KALIMAT" | "PILIHAN" | "LAIN";

export interface SitusKueri {
  berkas: string;
  baris: number;
  /** nama yang mengikat `data` (atau nama hasil `useQuery` bila tak di-destructure) */
  data: string | null;
  kelas: KelasKueri;
}

function berkasTsx(dir = AKAR, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) berkasTsx(p + "/", keluar);
    else if (/\.tsx$/.test(nama)) keluar.push(p);
  }
  return keluar;
}

/**
 * Properti yang meruntuhkan sebuah koleksi jadi ANGKA.
 *
 * `some`/`every`/`find` SENGAJA tak masuk, dan itu hasil kalibrasi: versi
 * pertama memasukkannya lalu menuduh `SatuanSelect` (yang memakai `.some()`
 * untuk memutuskan apakah nilai terpilih perlu ditambahkan sebagai `<option>`)
 * dan `StokAwalPage` (yang memakai `if (!tersimpan) return`). Keduanya
 * keputusan internal, bukan klaim yang dibaca orang.
 */
const KE_ANGKA = new Set(["length", "size"]);

/**
 * Ke mana sebuah pengikatan mengalir di dalam berkasnya.
 *
 * Ditelusuri lewat pohon: tiap `Identifier` bernama sama yang BUKAN
 * deklarasinya sendiri, lalu dilihat rantai induknya. Menelusuri teks tak bisa
 * membedakan `rows.length` milik kueri ini dari `rows.length` milik variabel
 * lain sebertaji nama di fungsi tetangga.
 */
function aliran(nama: string, akar: Simpul, induk: Map<Simpul, Simpul>, isi: string) {
  let keAngka = false;
  let keMap = false;
  let keKosong = false;
  let dipakai = 0;
  /** nama-nama turunan: `const stokKritis = stok?.filter(…).length ?? 0` */
  const turunan = new Set<string>([nama]);
  jelajah(akar, (n) => {
    if (n.type !== "Identifier" || n.name !== nama) return;
    const up = induk.get(n);
    if (!up) return;
    // deklarasinya sendiri, bukan pemakaian
    if (up.type === "VariableDeclarator" && up.id === n) return;
    if ((up.type === "Property" || up.type === "ObjectProperty") && up.key === n && up.value !== n) return;
    dipakai += 1;
    // Naik beberapa tingkat: `(x ?? []).filter(…).length`, `x?.rows.filter(…).length ?? 0`
    let cur: Simpul | undefined = n;
    for (let i = 0; i < 10 && cur; i += 1) {
      const p: Simpul | undefined = induk.get(cur);
      if (!p) break;
      // Pembungkus yang bukan langkah: rantai opsional & tanda kurung. Tanpa
      // melewatkannya, `pen?.rows.filter(…).length ?? 0` kehabisan lompatan
      // sebelum `.length` terlihat — dan lencana Penerimaan lolos.
      if (p.type === "ChainExpression" || p.type === "ParenthesizedExpression") {
        cur = p;
        continue;
      }
      if (p.type === "MemberExpression" && p.property?.type === "Identifier") {
        const prop = p.property.name as string;
        if (KE_ANGKA.has(prop)) keAngka = true;
        if (prop === "map") keMap = true;
      }
      if (p.type === "LogicalExpression" && p.operator === "??") {
        const kanan = isi.slice(p.right.start, p.right.end).trim();
        if (/^(0|false)$/.test(kanan)) keAngka = true;
        if (kanan === "[]") keKosong = true;
      }
      if (p.type === "VariableDeclarator" && p.id?.type === "Identifier") {
        turunan.add(p.id.name as string);
      }
      /*
       * Turunan lewat PANGGILAN: `const produksiBelum = hitungBelum(prodNav?.rows)`.
       * Tanpa ini tiga lencana `Layout.tsx` lolos — dan melewatkan lencana
       * adalah persis kebutaan yang sapuan ini dibuat untuk mencabut.
       */
      if (p.type === "CallExpression") {
        const vd = induk.get(p);
        if (vd?.type === "VariableDeclarator" && vd.id?.type === "Identifier") {
          turunan.add(vd.id.name as string);
        }
        /*
         * SATU LOMPATAN ke pembantu lokal: `hitungBelum(prodNav?.rows)` yang
         * badannya berakhir `.size`. Tanpa lompatan ini dua lencana pengadaan
         * lolos. Batasnya ditulis: badan pembantunya diperiksa sebagai TEKS,
         * bukan pohon — cukup untuk bentuk "koleksi → angka", dan tak lebih.
         */
        if (p.callee?.type === "Identifier") {
          const nm = p.callee.name as string;
          const m = new RegExp(`(?:const|function)\\s+${nm}\\b`).exec(isi);
          if (m) {
            const badan = isi.slice(m.index, m.index + 400);
            if (/\.(length|size)\b/.test(badan)) keAngka = true;
          }
        }
      }
      cur = p;
    }
  });
  return { keAngka, keMap, keKosong, dipakai, turunan };
}

/**
 * Angkanya SAMPAI KE MATA?
 *
 * Ini garis yang memisahkan lencana dari hitungan internal, dan tanpa garis itu
 * sapuan ini menuduh palsu — `ResepPage` memakai `.some()` untuk memilih satuan
 * bawaan, dan tak ada yang membacanya. Yang dijaga klaim yang DIRENDER.
 */
function masukJsx(nama: Set<string>, akar: Simpul, induk: Map<Simpul, Simpul>): boolean {
  let kena = false;
  jelajah(akar, (n) => {
    if (kena || n.type !== "Identifier" || !nama.has(n.name as string)) return;
    let cur: Simpul | undefined = n;
    for (let i = 0; i < 8 && cur; i += 1) {
      const p: Simpul | undefined = induk.get(cur);
      if (!p) break;
      if (p.type === "JSXExpressionContainer") {
        kena = true;
        return;
      }
      cur = p;
    }
  });
  return kena;
}

/** Aturan gerbang REGEX lama, apa adanya — dipakai membuktikan vonisnya tak bergeser. */
export function kalimatLama(nama: string, isi: string): boolean {
  if (new RegExp(`\\(\\s*\\b${nama}\\b\\s*\\?\\?\\s*\\[\\]\\s*\\)\\.length\\s*===\\s*0`).test(isi)) {
    return true;
  }
  for (const a of isi.matchAll(
    new RegExp(`const\\s+(\\w+)\\s*=\\s*\\b${nama}\\b\\s*\\?\\?\\s*\\[\\]\\s*;`, "g"),
  )) {
    if (new RegExp(`\\b${a[1]}\\b\\.length\\s*===\\s*0`).test(isi)) return true;
  }
  return false;
}

/**
 * Keadaan-kosong ber-KALIMAT — aturan gerbang regex lama, dipindahkan APA
 * ADANYA: `(x ?? []).length === 0`, langsung atau lewat SATU alias.
 *
 * Dipertahankan persis supaya kenaikan ke AST bisa dibuktikan tak menggeser
 * vonis: kelasnya wajib tetap kosong seperti sebelum putaran ini.
 */
function keadaanKosongBerkalimat(nama: string, isi: string): boolean {
  if (kalimatLama(nama, isi)) return true;
  /*
   * BENTUK YANG LOLOS ATURAN LAMA: koalesens pada PROPERTI, bukan pada
   * pengikatnya — `(riwayat?.rows ?? []).length === 0`. Regex gerbang lama
   * menuntut `?? []` menempel langsung pada nama `data`-nya, jadi tiap kueri
   * yang membungkus barisnya dalam objek (`{ rows: … }`) tak pernah masuk
   * populasinya. Itu bukan bentuk langka: begitulah setengah balasan daftar
   * di API ini berbentuk.
   */
  if (
    new RegExp(
      `\\(\\s*\\b${nama}\\b\\??\\.[\\w.]+\\s*\\?\\?\\s*\\[\\]\\s*\\)\\.length\\s*===\\s*0`,
    ).test(isi)
  ) {
    return true;
  }
  for (const a of isi.matchAll(
    new RegExp(`const\\s+(\\w+)\\s*=\\s*\\b${nama}\\b\\s*\\?\\?\\s*\\[\\]\\s*;`, "g"),
  )) {
    if (new RegExp(`\\b${a[1]}\\b\\.length\\s*===\\s*0`).test(isi)) return true;
  }
  return false;
}

/** Tiap situs `useQuery` di `apps/web/src`, dan apa yang dilakukannya. */
export function situsKueriWeb(kode?: { nama: string; isi: string }[]): SitusKueri[] {
  const sumber =
    kode ??
    berkasTsx().map((p) => ({ nama: p.slice(AKAR.length), isi: readFileSync(p, "utf8") }));
  const keluar: SitusKueri[] = [];
  for (const { nama: berkas, isi } of sumber) {
    if (!isi.includes("useQuery(")) continue;
    let prog: Simpul;
    try {
      prog = uraikan(berkas.endsWith(".tsx") ? berkas : `${berkas}.tsx`, isi);
    } catch {
      continue;
    }
    const induk = petaInduk(prog);
    jelajah(prog, (n) => {
      if (n.type !== "CallExpression" || n.callee?.name !== "useQuery") return;
      const baris = barisDi(isi, n.start);
      const up = induk.get(n);
      let namaData: string | null = null;
      let punyaGalat = false;
      if (up?.type === "VariableDeclarator") {
        const id = up.id;
        if (id?.type === "ObjectPattern") {
          for (const pr of id.properties ?? []) {
            const k = pr.key?.name as string | undefined;
            if (k === "error" || k === "isError" || k === "isLoadingError") punyaGalat = true;
            if (k === "data") namaData = (pr.value?.name as string) ?? "data";
          }
        } else if (id?.type === "Identifier") {
          // `const q = useQuery(…)` — bentuk yang regex gerbang lama tak lihat.
          namaData = id.name as string;
          const a = aliran(namaData, prog, induk, isi);
          punyaGalat = new RegExp(`\\b${namaData}\\.(error|isError)\\b`).test(isi);
          const terlihat = masukJsx(a.turunan, prog, induk);
          keluar.push({
            berkas,
            baris,
            data: namaData,
            kelas: punyaGalat
              ? "GALAT"
              : a.keAngka && terlihat
                ? "ANGKA"
                : a.keMap
                  ? "PILIHAN"
                  : "LAIN",
          });
          return;
        }
      }
      if (punyaGalat) {
        keluar.push({ berkas, baris, data: namaData, kelas: "GALAT" });
        return;
      }
      if (!namaData) {
        keluar.push({ berkas, baris, data: null, kelas: "LAIN" });
        return;
      }
      const a = aliran(namaData, prog, induk, isi);
      const terlihat = masukJsx(a.turunan, prog, induk);
      const kelas: KelasKueri = keadaanKosongBerkalimat(namaData, isi)
        ? "KALIMAT"
        : a.keAngka && terlihat
          ? "ANGKA"
          : a.keMap
            ? "PILIHAN"
            : "LAIN";
      keluar.push({ berkas, baris, data: namaData, kelas });
    });
  }
  return keluar;
}

export function petaKelasKueri(daftar = situsKueriWeb()): Map<KelasKueri, number> {
  const m = new Map<KelasKueri, number>();
  for (const s of daftar) m.set(s.kelas, (m.get(s.kelas) ?? 0) + 1);
  return m;
}
