import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  barisDi,
  deklarasiTerlihat,
  jelajah,
  namaProperti,
  rantaiPenuh,
  uraikan,
  type Simpul,
} from "./ast";
import { daftarSumber, SRC } from "./kueri-terkurung";
import { buktikan, grafPanggilan, PELAKU, type Graf } from "./panggilan";
import { GLOBAL, konteks, objekBaris, PANGKAL, type Konteks } from "./tenant-tulis";

/**
 * SIAPA YANG MELAKUKANNYA — ruas ketiga, sesudah `companyId` dan `branchId`.
 *
 * Tiga kolom menentukan sebuah baris milik siapa dan lahir dari siapa, dan
 * dua sudah punya gerbang: `companyId` (putaran 13 & 14), `branchId`
 * (putaran 16). Yang ketiga menopang SELURUH jejak audit aplikasi ini —
 * `pesananLogs`, `fakturLogs`, `stockOpnames.disetujuiBy`,
 * `shifts.openedBy`/`closedBy`, `productions.updatedBy` — dan tak satu pun uji
 * pernah menagihnya.
 *
 * DUA ARAH disapu di sini, dan keduanya perlu:
 *
 *   1. **Dari mana nilainya datang.** Pelaku yang dipungut dari badan
 *      permintaan berarti seseorang bisa menandatangani perbuatannya atas nama
 *      orang lain. Terukur hari ini: **0** — dan justru itu sebabnya gerbang
 *      ini ada, sebab "benar hari ini tanpa penjaga" adalah kelas yang ledger
 *      ini sudah berkali-kali temukan membusuk pada pemanggil berikutnya.
 *
 *   2. **Apakah perubahan MENYEGARKAN pelakunya.** `updatedBy` dilihat manusia
 *      (`produksi/routes.ts` memulangkannya sebagai `diubah_oleh`, dan layar
 *      Tambah Stok merendernya). Pintu yang mengubah angka baris tanpa
 *      menyegarkannya membuat layar menyebut orang yang BUKAN penulis angka
 *      yang sedang ditampilkan.
 */

/** Kolom yang menjawab "siapa" — dikenali dari namanya, dibaca dari skema. */
const POLA_PELAKU = /^(userId|createdBy|updatedBy|deletedBy|confirmedBy|disetujuiBy|closedBy|openedBy|pesananStatusOleh)$/;

/**
 * Arah kedua dipecah DUA, dan pemisahan itu memperbaiki tuduhan palsu.
 *
 * Versi pertama menuntut `updatedBy` ATAU `deletedBy` pada setiap `update`.
 * `sales` hanya punya `deletedBy` — jadi `refund.ts` dan `rekalkulasi.ts`, yang
 * menulis ulang total penjualan tanpa menghapus apa pun, dituduh tak menulis
 * kolom yang **tak boleh** mereka tulis. Menuntut kolom penghapus pada
 * pembaruan biasa bukan temuan melainkan salah alamat.
 */
const KOL_UBAH = "updatedBy";
const KOL_HAPUS = "deletedBy";
const KOL_WAKTU_HAPUS = "deletedAt";

export type KelasPelaku = "TOKEN" | "TURUNAN" | "PARAMETER" | "NULL" | "E" | "KLIEN";

export interface SitusPelaku {
  berkas: string;
  baris: number;
  tabel: string;
  kolom: string;
  op: "insert" | "update";
  kelas: KelasPelaku;
  /** teks ekspresi yang mengisi kolomnya */
  sumber: string;
  /** pembantu yang memuat situs ini — dipakai bukti graf untuk kelas PARAMETER */
  pembantu?: string;
}

export interface SitusTanpaPelaku {
  berkas: string;
  baris: number;
  tabel: string;
  /** `UBAH` = mengubah baris tanpa menyegarkan `updatedBy`; `HAPUS` = menandai terhapus tanpa `deletedBy` */
  arah: "UBAH" | "HAPUS";
  /** kolom yang benar-benar diubah pernyataan ini */
  diubah: string[];
}

/**
 * Tabel → kolom pelakunya, dibaca dari `db/schema.ts` lewat pohon.
 *
 * Daftar 30 kolom TIDAK disalin ke dalam kode: daftar salinan adalah yang
 * membusuk saat kolom ke-31 lahir — persis alasan `tabelBerTenant()` dan
 * `tabelBerCabang()` juga membaca skemanya.
 */
export function tabelBerPelaku(): Map<string, string[]> {
  const isi = readFileSync(join(SRC, "db/schema.ts"), "utf8");
  const prog = uraikan("db/schema.ts", isi);
  const peta = new Map<string, string[]>();
  jelajah(prog, (n) => {
    if (n.type !== "VariableDeclarator" || n.id?.type !== "Identifier") return;
    if (n.init?.type !== "CallExpression" || n.init.callee?.name !== "pgTable") return;
    const kolom = n.init.arguments?.[1];
    if (kolom?.type !== "ObjectExpression") return;
    const a: string[] = [];
    for (const p of kolom.properties ?? []) {
      const k = p.key?.name as string | undefined;
      if (k && POLA_PELAKU.test(k)) a.push(k);
    }
    if (a.length) peta.set(n.id.name as string, a);
  });
  return peta;
}

/** Pembantu bernama TERLUAR yang memuat simpul ini. */
function pembantuPemuat(n: Simpul, k: Konteks): string | undefined {
  let x: Simpul | undefined = n;
  let nama: string | undefined;
  while (x) {
    if (
      x.type === "FunctionDeclaration" ||
      x.type === "FunctionExpression" ||
      x.type === "ArrowFunctionExpression"
    ) {
      if (x.type === "FunctionDeclaration" && x.id?.type === "Identifier") {
        nama = x.id.name as string;
      } else {
        const up = k.induk.get(x);
        if (up?.type === "VariableDeclarator" && up.id?.type === "Identifier") {
          nama = up.id.name as string;
        }
      }
    }
    x = k.induk.get(x);
  }
  return nama;
}

const KLIEN_RE = /\bbody\b|\bpayload\b|c\.req|valid\(|\binput\b|\bquery\(/;

/** Parameter fungsi yang MEMUAT simpul ini (nama-namanya saja). */
function paramSekitar(n: Simpul, k: Konteks): Set<string> {
  const nama = new Set<string>();
  let x: Simpul | undefined = n;
  while (x) {
    if (
      x.type === "FunctionDeclaration" ||
      x.type === "FunctionExpression" ||
      x.type === "ArrowFunctionExpression"
    ) {
      for (const p of (x.params ?? []) as Simpul[]) {
        if (p.type === "Identifier") nama.add(p.name as string);
        else if (p.type === "ObjectPattern") {
          for (const q of p.properties ?? []) if (q.key?.type === "Identifier") nama.add(q.key.name as string);
        }
      }
    }
    x = k.induk.get(x);
  }
  return nama;
}

/**
 * Parameter callback `.map(...)` ditelusuri ke LARIK yang diiterasinya.
 *
 * `uniqueIds.map((uid) => ({ userId: uid }))` — tanpa ini `uid` terbaca sebagai
 * parameter biasa dan situsnya mendarat di `PARAMETER`, padahal `uniqueIds`
 * lahir dari badan permintaan. Kelas yang salah menyembunyikan pertanyaan;
 * yang benar memaksanya diadjudikasi.
 */
function larikMap(n: Simpul, nama: string, k: Konteks): Simpul | undefined {
  let x: Simpul | undefined = n;
  while (x) {
    if (
      (x.type === "ArrowFunctionExpression" || x.type === "FunctionExpression") &&
      ((x.params ?? []) as Simpul[]).some((p) => p.type === "Identifier" && p.name === nama)
    ) {
      const up = k.induk.get(x);
      if (up?.type === "CallExpression" && namaProperti(up.callee) === "map") return up.callee.object;
      return undefined;
    }
    x = k.induk.get(x);
  }
  return undefined;
}

/**
 * Telusuri sebuah ekspresi sampai ke asalnya di lingkupnya (maks 5 lompatan).
 *
 * Bentuk yang menuntutnya nyata: `const uid = body.user_id` lalu
 * `values({ userId: uid })` — teks di situsnya tak menyebut permintaan sama
 * sekali. Sapuan yang berhenti di nama variabelnya akan memanggil itu
 * "TERBUKTI".
 */
function asal(n: Simpul, k: Konteks, dalam = 0): string {
  const teks = k.isi.slice(n.start, n.end);
  if (dalam > 4) return teks;
  if (PELAKU.auth.test(teks) || KLIEN_RE.test(teks)) return teks;
  const pangkal = n.type === "MemberExpression" ? n.object : n;
  if (pangkal?.type !== "Identifier") return teks;
  const nama = pangkal.name as string;
  const d = deklarasiTerlihat(pangkal, nama, k.induk, k.lingkup);
  if (d?.nilai) return asal(d.nilai, k, dalam + 1);
  const larik = larikMap(n, nama, k);
  if (larik) return asal(larik, k, dalam + 1);
  return teks;
}

/**
 * Kunci kolom yang benar-benar ditulis sebuah objek `.set(...)`, MENEMBUS SEBAR.
 *
 * Bukan kemewahan: `produksi/routes.ts:989` menulis seluruh perubahannya
 * sebagai sebar bersyarat —
 * `{ ...naikBaris(b), ...pindah, ...(lebih ? { qty: item.qty } : {}), … }` —
 * jadi objeknya tak punya satu pun properti bernama. Versi pertama pemindai ini
 * melaporkannya `ubah{}` dan pintu itu **tak terlihat sama sekali**, padahal
 * ia justru pintu yang mengubah `qty` dan `totalHarga`. Sapuan yang buta pada
 * bentuk perakit baris paling lazim di repo ini melaporkan kebersihan yang
 * tidak ada.
 */
function kunciDitulis(obj: Simpul, k: Konteks, dalam = 0): string[] {
  if (dalam > 4) return [];
  const keluar: string[] = [];
  for (const p of obj.properties ?? []) {
    if (p.type === "SpreadElement" || p.type === "RestElement") {
      for (const o of objekBaris(p.argument, k, dalam + 1)) {
        keluar.push(...kunciDitulis(o, k, dalam + 1));
      }
      // `...(lebih ? { qty } : {})` — kedua cabangnya ikut dihitung: yang
      // dijaga "pintu ini BISA mengubah qty", bukan "hari ini pasti mengubah".
      const a = bukaSyarat(p.argument);
      for (const cab of a) for (const o of objekBaris(cab, k, dalam + 1)) {
        keluar.push(...kunciDitulis(o, k, dalam + 1));
      }
      continue;
    }
    const key = p.key?.name as string | undefined;
    if (key) keluar.push(key);
  }
  return keluar;
}

/** Cabang-cabang sebuah ekspresi ternari/logika, apa adanya. */
function bukaSyarat(n: Simpul | undefined): Simpul[] {
  if (!n) return [];
  if (n.type === "ParenthesizedExpression") return bukaSyarat(n.expression);
  if (n.type === "ConditionalExpression") return [...bukaSyarat(n.consequent), ...bukaSyarat(n.alternate), n.consequent, n.alternate].filter(Boolean) as Simpul[];
  if (n.type === "LogicalExpression") return [n.left, n.right];
  return [];
}

/**
 * Nilainya DIWARISI dari kolom yang SAMA pada baris lain (`b.userId → userId`).
 *
 * Argumennya bisa diperiksa: nilai itu hanya bisa sampai ke sana lewat
 * penulisan kolom yang sama sebelumnya — yang justru populasi gerbang ini.
 * Membelah porsi (`open-bill`) dan memecah baris faktur (`tahapSebagian`)
 * memakai bentuk ini, dan keduanya memang harus mempertahankan pelaku asalnya.
 *
 * Yang membedakannya dari `PARAMETER`: pangkalnya BUKAN parameter fungsi yang
 * memuatnya. `opts.userId` berbentuk sama persis tapi pangkalnya dioper
 * pemanggil — dan itu pertanyaan yang harus dibuktikan graf, bukan diwariskan.
 */
function turunanKolomSama(v: Simpul, kolom: string, situs: Simpul, k: Konteks): boolean {
  if (v.type !== "MemberExpression" || v.computed) return false;
  if (v.property?.type !== "Identifier" || v.property.name !== kolom) return false;
  if (v.object?.type !== "Identifier") return false;
  return !paramSekitar(situs, k).has(v.object.name as string);
}

/** Objek yang benar-benar ditulis `.values(<x>)` / `.set(<x>)` di rantai ini. */
function objekTulis(n: Simpul, k: Konteks): Simpul[] {
  let nilai: Simpul | undefined;
  jelajah(rantaiPenuh(n, k.induk), (m) => {
    if (nilai || m.type !== "CallExpression") return;
    const p = namaProperti(m.callee);
    if (p === "values" || p === "set") nilai = m.arguments?.[0];
  });
  return objekBaris(nilai, k);
}

interface Pernyataan {
  n: Simpul;
  op: "insert" | "update";
  tabel: string;
  k: Konteks;
  nama: string;
}

/** Tiap `insert`/`update` ke tabel ber-kolom pelaku, di seluruh `src`. */
function pernyataan(kode?: { nama: string; isi: string }[]): Pernyataan[] {
  const punya = tabelBerPelaku();
  const keluar: Pernyataan[] = [];
  for (const { nama, isi } of kode ?? daftarSumber()) {
    let k: Konteks;
    try {
      k = konteks(nama, isi);
    } catch {
      continue;
    }
    jelajah(k.prog, (n) => {
      if (n.type !== "CallExpression") return;
      const op = namaProperti(n.callee);
      if (op !== "insert" && op !== "update") return;
      const pk = n.callee.object;
      if (pk?.type !== "Identifier" || !PANGKAL.has(pk.name as string)) return;
      const t = n.arguments?.[0];
      if (t?.type !== "Identifier" || !punya.has(t.name as string)) return;
      keluar.push({ n, op, tabel: t.name as string, k, nama });
    });
  }
  return keluar;
}

/** ARAH 1 — tiap penulisan kolom pelaku, dan dari mana nilainya datang. */
export function situsPelaku(kode?: { nama: string; isi: string }[]): SitusPelaku[] {
  const punya = tabelBerPelaku();
  const keluar: SitusPelaku[] = [];
  for (const { n, op, tabel, k, nama } of pernyataan(kode)) {
    const kolom = punya.get(tabel)!;
    for (const obj of objekTulis(n, k)) {
      for (const p of obj.properties ?? []) {
        const key = p.key?.name as string | undefined;
        if (!key || !kolom.includes(key) || !p.value) continue;
        const teks = k.isi.slice(p.value.start, p.value.end).replace(/\s+/g, " ");
        const jejak = asal(p.value, k);
        const situs = {
          berkas: nama,
          baris: barisDi(k.isi, n.start),
          tabel,
          kolom: key,
          op,
          sumber: teks.slice(0, 80),
        };
        if (p.value.type === "Literal" && p.value.value === null) {
          keluar.push({ ...situs, kelas: "NULL" });
        } else if (PELAKU.auth.test(teks) || PELAKU.auth.test(jejak)) {
          keluar.push({ ...situs, kelas: "TOKEN" });
        } else if (GLOBAL.some((r) => r.test(nama))) {
          keluar.push({ ...situs, kelas: "E" });
        } else if (KLIEN_RE.test(teks) || KLIEN_RE.test(jejak)) {
          keluar.push({ ...situs, kelas: "KLIEN" });
        } else if (turunanKolomSama(p.value, key, n, k)) {
          keluar.push({ ...situs, kelas: "TURUNAN" });
        } else {
          keluar.push({ ...situs, kelas: "PARAMETER", pembantu: pembantuPemuat(n, k) });
        }
      }
    }
  }
  return keluar;
}

/**
 * ARAH 2 — pernyataan `update` yang MENGUBAH baris tanpa menyegarkan pelakunya.
 *
 * Hanya tabel yang benar-benar PUNYA kolom pengubah yang ditagih: menuntut
 * `updatedBy` pada tabel yang tak memilikinya bukan temuan melainkan salah
 * alamat. `sales` misalnya hanya punya `deletedBy` — itu dilaporkan sebagai
 * batas berangka, bukan ditambal kolom baru.
 */
export function situsTanpaPelaku(kode?: { nama: string; isi: string }[]): SitusTanpaPelaku[] {
  const punya = tabelBerPelaku();
  const keluar: SitusTanpaPelaku[] = [];
  for (const { n, op, tabel, k, nama } of pernyataan(kode)) {
    if (op !== "update") continue;
    const kolom = punya.get(tabel)!;
    const diubah: string[] = [];
    for (const obj of objekTulis(n, k)) diubah.push(...kunciDitulis(obj, k));
    if (diubah.length === 0) continue;
    const uniq = [...new Set(diubah)].sort();
    const situs = { berkas: nama, baris: barisDi(k.isi, n.start), tabel, diubah: uniq };
    // Menandai baris TERHAPUS tanpa menyebut siapa yang menghapusnya.
    if (kolom.includes(KOL_HAPUS) && uniq.includes(KOL_WAKTU_HAPUS) && !uniq.includes(KOL_HAPUS)) {
      keluar.push({ ...situs, arah: "HAPUS" });
      continue;
    }
    // Mengubah isi baris tanpa menyegarkan penulisnya — hanya untuk tabel yang
    // MEMANG punya tempat mencatatnya.
    if (kolom.includes(KOL_UBAH) && !uniq.includes(KOL_UBAH) && !uniq.includes(KOL_WAKTU_HAPUS)) {
      keluar.push({ ...situs, arah: "UBAH" });
    }
  }
  return keluar;
}

/** Kolom yang menyimpan ANGKA yang dilihat & dipercaya manusia. */
export const KOLOM_ANGKA = ["totalHarga", "qty", "qtyDipesan", "hargaTebakan", "hargaSatuan"];

/**
 * Pembantu pembawa pelaku, dibuktikan lintas berkas — sama seperti tenant.
 *
 * Grafnya dibangun pada dimensi `PELAKU`, bukan `TENANT`: mesinnya sama,
 * penandanya berbeda (`auth.sub`, slot `userId`).
 */
export function buktiPelakuPemanggil(
  situs: SitusPelaku[],
  graf: Graf = grafPanggilan(undefined, PELAKU),
): { terbukti: Set<string>; belum: Map<string, string>; pembantu: string[] } {
  const nama = [
    ...new Set(situs.filter((x) => x.kelas === "PARAMETER" && x.pembantu).map((x) => x.pembantu!)),
  ];
  const h = buktikan(graf, nama);
  const belum = new Map<string, string>();
  for (const n of nama) if (!h.terbukti.has(n)) belum.set(n, h.belum.get(n) ?? "tak dinilai");
  return { terbukti: h.terbukti, belum, pembantu: nama };
}
