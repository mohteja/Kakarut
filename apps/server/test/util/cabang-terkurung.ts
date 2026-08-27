import { readFileSync } from "node:fs";
import { join } from "node:path";
import { butaKomentar } from "../../src/scripts/buta-komentar";
import { jelajah, uraikan, type Simpul } from "./ast";
import { daftarSumber, SRC } from "./kueri-terkurung";
import { berkasGlobal } from "./panggilan";
import { semuaRute, SRV, type Rute } from "./rute";
import { aliasBerkas, penjagaPrefiks, peranEfektif, TERIKAT_CABANG } from "./izin";

/**
 * PENGURUNGAN CABANG — saudara kandung pengurungan tenant, satu tingkat ke bawah.
 *
 * Gerbang tenant menanyakan *"baris penyewa mana yang terbaca"*. Pertanyaan
 * yang sama pada dimensi berikutnya tak pernah punya gerbang: **dalam SATU
 * penyewa, bisakah peran yang terikat cabang A menyentuh baris cabang B?**
 *
 * `cakupan-cabang.test.ts` yang sudah ada bukan gerbang untuk pertanyaan itu.
 * Ia berbasis TEKS, populasinya DELAPAN berkas tulisan tangan (padahal
 * `resolveBranchId` dipanggil 85 kali di 18 berkas), dan ia menyapu satu arah
 * saja — *"cabang datang dari PEMANGGIL"*. Ia tak pernah bertanya apakah
 * kuerinya mengurung. Batas itu bahkan tertulis di berkasnya sendiri:
 * *"ia menangkap KELALAIAN …, bukan PENYALAHGUNAAN"*.
 *
 * Yang disapu di sini: tiap RUTE yang (a) bisa dimasuki peran terikat cabang
 * dan (b) menyentuh tabel ber-`branchId`. Pertanyaannya satu: **apakah ada
 * penjaga cabang di jalurnya** — di badan rutenya, atau di pembantu yang
 * dipanggilnya, atau berupa kurungan KEPEMILIKAN yang lebih sempit.
 */

/** Penjaga cabang yang sah, semuanya bernama dan berumah di `middleware/auth.ts`. */
const PENJAGA = [
  "resolveBranchId",
  "branchUntukTulis",
  "syaratCabang",
  "terikatCabang",
  "auth.branch_id",
];

/**
 * Kurungan KEPEMILIKAN: baris hanya boleh disentuh pembuatnya.
 *
 * Lebih SEMPIT daripada kurungan cabang (pembuatnya pasti satu cabang), jadi
 * ia sah — tapi ia kelas tersendiri, bukan pengecualian diam. Dituntut
 * dua-duanya: perbandingan atas `auth.sub` DAN penolakan 403; salah satu saja
 * bukan kurungan (mis. `auth.sub` yang cuma DITULIS ke kolom `userId`).
 */
const MILIK_BANDING = /[!=]==\s*auth\.sub|auth\.sub\s*[!=]==/;

/**
 * Kurungan AKTOR: cabang/baris ditentukan oleh keanggotaan PEMANGGIL SENDIRI,
 * bukan oleh apa pun yang dikirimnya.
 *
 * Lebih kuat daripada kurungan cabang, bukan lebih lemah: `POST /pengajuan`
 * menuliskannya sendiri — *"Cabang pemohon diambil dari keanggotaannya SAAT
 * INI (bukan dari klien)"*. Dituntut saringan atas kolom `userId` yang nilainya
 * `auth.sub` — di badan rutenya, atau di pembantu yang menerima `auth.sub`
 * sebagai argumen pertamanya.
 */
const AKTOR_LANGSUNG = /eq\(\s*\w+\.userId,\s*auth\.sub\s*\)/;
const AKTOR_PEMBANTU = /eq\(\s*\w+\.userId,\s*(?:userId|user_id)\s*\)/;

/**
 * Gerbang peran INLINE — `if (auth.role !== "owner" && auth.role !== "admin") 403`.
 *
 * `peranEfektif` membaca `requireRole`, alias modul, dan penjaga prefiks; ia
 * TIDAK membaca bentuk ini. `POST /penerimaan/anomali/tutup` memakainya, dan
 * komentarnya menjelaskan kenapa: modulnya sengaja tanpa group guard karena
 * kasir pun boleh menerima barang, jadi gerbang manajemen dipasang di handler.
 * Tanpa pembacaan ini, rute itu jadi tuduhan palsu.
 */
function peranInline(teks: string): Set<string> | null {
  const nama = [...teks.matchAll(/auth\.role !== "(\w+)"/g)].map((m) => m[1]);
  if (nama.length === 0 || !teks.includes("HTTPException(403")) return null;
  return new Set(nama);
}

export type KelasCabang =
  | "LUAR"
  | "E"
  | "KOSONG"
  | "KURUNG"
  | "HOP"
  | "MILIK"
  | "AKTOR"
  | "TELANJANG";

export interface SitusCabang {
  metode: string;
  jalur: string;
  berkas: string;
  kelas: KelasCabang;
  peran: string[];
  tabel: string[];
  /** pembantu yang membawa penjaganya, bila kelasnya `HOP` */
  lewat?: string;
}

/**
 * Tabel yang PUNYA kolom `branchId` — dibaca dari `db/schema.ts` lewat pohon,
 * sejajar `tabelBerTenant()`. Daftar 24 nama TIDAK disalin ke dalam kode:
 * daftar salinan adalah yang membusuk saat tabel ke-25 lahir.
 */
export function tabelBerCabang(): Set<string> {
  const isi = readFileSync(join(SRC, "db/schema.ts"), "utf8");
  const prog = uraikan("db/schema.ts", isi);
  const punya = new Set<string>();
  jelajah(prog, (n) => {
    if (n.type !== "VariableDeclarator" || n.id?.type !== "Identifier") return;
    if (n.init?.type !== "CallExpression" || n.init.callee?.name !== "pgTable") return;
    const kolom = n.init.arguments?.[1];
    if (kolom?.type !== "ObjectExpression") return;
    for (const p of kolom.properties ?? []) {
      if (p.key?.name === "branchId") punya.add(n.id.name as string);
    }
  });
  return punya;
}

interface Badan {
  nama: string;
  teks: string;
  /** nama fungsi lain yang dipanggil dari badan ini */
  memanggil: Set<string>;
}

/**
 * Tabel yang DISENTUH satu badan, menular lewat yang dipanggilnya.
 *
 * Menular, dan sebabnya terukur: `GET /open-bill/:id` badan rutenya tak
 * menyebut `openBills` sama sekali — kuerinya duduk di `loadDetail`. Versi
 * pertama pemindai ini menyebutnya `KOSONG` ("tak menyentuh tabel bercabang")
 * sementara ia MEMANG membalas 200 berisi bill cabang lain, terukur lewat HTTP.
 * Populasi yang menyusut diam-diam adalah kebutaan yang menyamar jadi kabar
 * baik.
 */
function tabelMenular(
  peta: Map<string, Badan[]>,
  tabel: Set<string>,
): Map<string, Set<string>> {
  const punya = new Map<string, Set<string>>();
  for (const [nama, v] of peta) {
    if (v.length > 1) continue;
    punya.set(nama, new Set([...tabel].filter((t) => v[0].teks.includes(`${t}.`))));
  }
  for (;;) {
    let berubah = false;
    for (const [nama, v] of peta) {
      const milik = punya.get(nama);
      if (!milik) continue;
      for (const p of v[0].memanggil) {
        for (const t of punya.get(p) ?? []) {
          if (!milik.has(t)) {
            milik.add(t);
            berubah = true;
          }
        }
      }
    }
    if (!berubah) return punya;
  }
}

/**
 * Badan tiap fungsi BERNAMA di seluruh `src`, beserta siapa yang dipanggilnya.
 *
 * Dipakai untuk kelas `HOP`, dan kelas itu bukan kemewahan: lima rute
 * `penerimaan` sempat kutuduh telanjang sebelum `kondisiFaktur`
 * (`penerimaan/routes.ts:120`) terbaca — penjaganya ADA, satu lompatan
 * jauhnya. Tuduhan itu dicabut sebelum satu baris pun diubah.
 */
function petaBadan(tambahan?: { nama: string; isi: string }[]): Map<string, Badan[]> {
  const peta = new Map<string, Badan[]>();
  for (const { nama: berkas, isi } of tambahan ? [...daftarSumber(), ...tambahan] : daftarSumber()) {
    let prog: Simpul;
    try {
      prog = uraikan(berkas, isi);
    } catch {
      continue;
    }
    jelajah(prog, (n) => {
      let nama: string | undefined;
      let fn: Simpul | undefined;
      if (n.type === "FunctionDeclaration" && n.id?.type === "Identifier") {
        nama = n.id.name as string;
        fn = n;
      } else if (
        n.type === "VariableDeclarator" &&
        n.id?.type === "Identifier" &&
        (n.init?.type === "ArrowFunctionExpression" || n.init?.type === "FunctionExpression")
      ) {
        nama = n.id.name as string;
        fn = n.init;
      }
      if (!nama || !fn || fn.start === undefined || fn.end === undefined) return;
      const teks = isi.slice(fn.start, fn.end);
      const memanggil = new Set<string>();
      jelajah(fn, (m) => {
        if (m.type !== "CallExpression") return;
        const c = m.callee;
        if (c?.type === "Identifier") memanggil.add(c.name as string);
      });
      peta.set(nama, [...(peta.get(nama) ?? []), { nama, teks, memanggil }]);
    });
  }
  return peta;
}

/** Badan ini sendiri menyebut penjaga cabang? */
function menjagaLangsung(teks: string): boolean {
  return PENJAGA.some((p) => teks.includes(p));
}

/**
 * Fungsi yang MEMBAWA penjaga cabang — langsung, atau lewat yang dipanggilnya.
 *
 * Titik-tetap, sebab penjaga bisa duduk dua lompatan jauhnya. Nama yang
 * dideklarasikan di lebih dari satu berkas TIDAK dipakai sebagai bukti: satu
 * `simpan()` berpenjaga tak boleh memutihkan `simpan()` lain yang telanjang.
 */
function pembawaPenjaga(peta: Map<string, Badan[]>): { bawa: Set<string>; tabrakan: string[] } {
  const tabrakan = [...peta].filter(([, v]) => v.length > 1).map(([k]) => k);
  const ragu = new Set(tabrakan);
  const bawa = new Set<string>();
  for (const [nama, v] of peta) {
    if (ragu.has(nama)) continue;
    if (menjagaLangsung(v[0].teks)) bawa.add(nama);
  }
  for (;;) {
    let berubah = false;
    for (const [nama, v] of peta) {
      if (bawa.has(nama) || ragu.has(nama)) continue;
      for (const p of v[0].memanggil) {
        if (bawa.has(p)) {
          bawa.add(nama);
          berubah = true;
          break;
        }
      }
    }
    if (!berubah) return { bawa, tabrakan };
  }
}

/** Nama fungsi yang dipanggil dari sepotong teks rute. */
function dipanggilDi(teks: string): string[] {
  return [...teks.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

/**
 * `tambahan` disuntikkan DI ATAS pohon nyata — dipakai bukti merah.
 * `ruteTambahan` menempel pada populasi rute untuk menguji pemindainya sendiri.
 */
export function situsCabang(opsi?: {
  tambahan?: { nama: string; isi: string }[];
  rute?: Rute[];
}): SitusCabang[] {
  const tabel = tabelBerCabang();
  const peta = petaBadan(opsi?.tambahan);
  const { bawa } = pembawaPenjaga(peta);
  const tabelPembantu = tabelMenular(peta, tabel);
  const app = butaKomentar(readFileSync(join(SRV, "app.ts"), "utf8"));
  const guards = penjagaPrefiks(app);
  const keluar: SitusCabang[] = [];
  for (const r of opsi?.rute ?? semuaRute()) {
    const peran = peranEfektif(r, guards, aliasBerkas(r.berkas));
    const langsung = [...tabel].filter((t) => r.isi.includes(`${t}.`));
    const lewatPembantu = dipanggilDi(r.isi).flatMap((n) => [...(tabelPembantu.get(n) ?? [])]);
    const sentuh = [...new Set([...langsung, ...lewatPembantu])].sort();
    const dasar = {
      metode: r.metode,
      jalur: r.jalur,
      berkas: r.berkas.replace(`${SRC}/`, ""),
      peran,
      tabel: sentuh,
    };
    const inline = peranInline(r.isi);
    const terikatMasuk =
      peran.some((p) => TERIKAT_CABANG.includes(p)) &&
      !(inline && !TERIKAT_CABANG.some((p) => inline.has(p)));
    if (!terikatMasuk) {
      keluar.push({ ...dasar, kelas: "LUAR" });
      continue;
    }
    if (berkasGlobal(dasar.berkas)) {
      keluar.push({ ...dasar, kelas: "E" });
      continue;
    }
    if (sentuh.length === 0) {
      keluar.push({ ...dasar, kelas: "KOSONG" });
      continue;
    }
    if (menjagaLangsung(r.isi)) {
      keluar.push({ ...dasar, kelas: "KURUNG" });
      continue;
    }
    const lewat = dipanggilDi(r.isi).find((n) => bawa.has(n));
    if (lewat) {
      keluar.push({ ...dasar, kelas: "HOP", lewat });
      continue;
    }
    const dipanggil = dipanggilDi(r.isi);
    const aktor =
      AKTOR_LANGSUNG.test(r.isi) ||
      dipanggil.some((n) => {
        const b = peta.get(n);
        return (
          b?.length === 1 &&
          AKTOR_PEMBANTU.test(b[0].teks) &&
          new RegExp(`\\b${n}\\(\\s*auth\\.sub\\b`).test(r.isi)
        );
      });
    if (aktor) {
      keluar.push({ ...dasar, kelas: "AKTOR" });
      continue;
    }
    const milikLangsung = MILIK_BANDING.test(r.isi) && r.isi.includes("HTTPException(403");
    const lewatMilik = dipanggil.some((n) => {
      const b = peta.get(n);
      return b?.length === 1 && MILIK_BANDING.test(b[0].teks) && b[0].teks.includes("HTTPException(403");
    });
    if (milikLangsung || lewatMilik) {
      keluar.push({ ...dasar, kelas: "MILIK" });
      continue;
    }
    keluar.push({ ...dasar, kelas: "TELANJANG" });
  }
  return keluar;
}

/** Ringkasan per kelas — dipakai uji PREMIS supaya angkanya tak diam-diam nol. */
export function petaKelasCabang(daftar = situsCabang()): Map<KelasCabang, number> {
  const m = new Map<KelasCabang, number>();
  for (const s of daftar) m.set(s.kelas, (m.get(s.kelas) ?? 0) + 1);
  return m;
}
