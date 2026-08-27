import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../../src/scripts/buta-komentar";
import { awalPernyataan, SRC } from "./sql-mentah";

/**
 * GALAT YANG DITELAN — instrumen sapuan.
 *
 * `catch` berbadan KOSONG (`catch {}`, `catch (_) {}`, `.catch(() => {})`)
 * membuat sebuah kegagalan berhenti di situ tanpa pernah sampai ke siapa pun.
 * Kadang itu justru benar — "berkas sudah tak ada", "unlock yang lepas sendiri"
 * — dan kadang ia menyembunyikan kerusakan berbayar. Yang membedakan keduanya
 * cuma satu hal yang bisa diperiksa mesin: **alasannya tertulis atau tidak**.
 *
 * Gerbang repo ini sudah menamai kelasnya lebih dulu, di kepala
 * `verify-api.sh`: *"galat yang ditelan lalu muncul sebagai kebingungan di
 * tempat lain."*
 *
 * DUA HAL YANG MEMBUAT PEMINDAI INI TIDAK NAIF:
 *
 * 1. **Situs dicari di sumber yang KOMENTARNYA DIBUTAKAN.** Versi pertama tidak,
 *    dan langsung menuduh dirinya sendiri: komentar `hapusBerkasLokal` MENGUTIP
 *    bentuk lamanya (`unlink(...).catch(() => {})`) sebagai prosa, dan prosa itu
 *    terhitung sebagai situs. `butaKomentar` mempertahankan posisi & panjang,
 *    jadi nomor barisnya tetap benar.
 * 2. **Alasan dicari di sumber MENTAH**, sebab alasan itu memang komentar —
 *    di DALAM badan `catch`, atau pada baris komentar yang BERSAMBUNG tepat di
 *    atasnya. Kelonggaran "di atas" bukan kemewahan: di `sync/routes.ts`,
 *    `stok/routes.ts` dan `app.ts` alasannya memang ditulis di atas.
 *
 *    "Bersambung" itu yang membedakannya dari versi pertama, dan bedanya nyata:
 *    versi pertama menerima komentar mana pun dalam enam baris ke atas, jadi
 *    JSDOC SEBUAH FUNGSI memaafkan telanan di baris pertama badannya —
 *    `jadwalkanPangkasErrorLog` lolos begitu, padahal alasannya tak pernah
 *    ditulis. Sekarang penelusuran berhenti pada baris pertama yang bukan
 *    komentar, jadi doc milik deklarasi tak lagi bisa dipinjam.
 *
 * BATASNYA, ditulis jujur: komentar bersambung yang membicarakan HAL LAIN tetap
 * lolos sebagai "beralasan". Yang dijaga berkas ini adalah adanya KEPUTUSAN yang
 * tertulis, bukan mutunya — mutunya dijaga daftar pilah-tangan di gerbangnya.
 */
export const AKAR: Record<string, string> = {
  server: SRC,
  web: fileURLToPath(new URL("../../../web/src", import.meta.url)),
  shared: fileURLToPath(new URL("../../../../packages/shared/src", import.meta.url)),
};

/** `.catch(() => {})` / `.catch((_) => {})` — badan benar-benar kosong. */
const POLA_PANAH = /\.catch\(\s*(?:\(\s*[\w$]*\s*(?::\s*\w+)?\s*\)|[\w$]+)\s*=>\s*\{\s*\}\s*\)/g;
/** `catch {}` / `catch (e) {}` — badan benar-benar kosong. */
const POLA_BLOK = /\bcatch\s*(?:\(\s*[^)]*\)\s*)?\{\s*\}/g;

export type Bentuk = "panah" | "blok";

export interface SitusTelan {
  berkas: string;
  baris: number;
  bentuk: Bentuk;
  /** ada komentar di dalam badan `catch`, atau pada ≤6 baris di atasnya */
  beralasan: boolean;
  potongan: string;
}

function berkasSumber(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) berkasSumber(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const ADA_KOMENTAR = /\/\/|\/\*/;

/**
 * Alasan untuk situs pada posisi `awal`: komentar di dalam badan `catch`-nya
 * (terlihat di sumber MENTAH walau badannya kosong di sumber yang dibutakan),
 * atau baris komentar yang BERSAMBUNG tepat di atas barisnya.
 */
/**
 * Awal `try` yang memiliki `catch` pada posisi `i` — mundur dari kata `catch`
 * melewati blok badannya, berhenti pada kata `try` di kedalaman nol.
 */
function awalTry(buta: string, i: number): number {
  let d = 0;
  for (let j = i - 1; j >= 0; j -= 1) {
    const c = buta[j];
    if (c === "}" || c === ")" || c === "]") d += 1;
    else if (c === "{" || c === "(" || c === "[") {
      d -= 1;
      if (d < 0) return -1; // keluar dari blok pembungkusnya — menyerah
    } else if (d === 0 && c === "y" && buta.slice(j - 2, j + 1) === "try") {
      const sebelum = buta[j - 3] ?? " ";
      if (!/[\w$]/.test(sebelum)) return j - 2;
    }
  }
  return -1;
}

function beralasan(mentah: string, buta: string, bentuk: Bentuk, awal: number, akhir: number): boolean {
  // (a) di dalam badan `catch`-nya. Ini tempat yang PALING benar, dan satu-
  //     satunya yang berlaku untuk kedua bentuk.
  if (ADA_KOMENTAR.test(mentah.slice(awal, akhir))) return true;

  // Titik yang alasannya boleh berdiri di atasnya berbeda per bentuk:
  //  - rantai `.catch(...)`  → awal PERNYATAANNYA;
  //  - blok `try {…} catch {}` → kata `try`-nya.
  //
  // Bedanya bukan kosmetik. Untuk bentuk blok, `awalPernyataan` mundur sampai
  // `{` pembungkusnya, jadi rentang "sebelum situs" memuat SELURUH badan `try`
  // — dan komentar apa pun yang menjelaskan KODE di dalamnya lalu memaafkan
  // telanannya. Dua situs `api_client.dart` lolos persis begitu pada generasi
  // ketiga pemindai ini.
  const mulai = bentuk === "blok" ? awalTry(buta, awal) : awalPernyataan(buta, awal);
  if (mulai < 0) return false;

  // (b) DI TENGAH pernyataannya, tepat sebelum `.catch` pada rantai panjang —
  //     bentuk yang dipakai `backup.ts`, `sapu-unggahan.ts`, `restore-backup.ts`
  //     dan `print/native.ts`. Hanya untuk rantai: lihat alasan di atas.
  if (bentuk === "panah" && ADA_KOMENTAR.test(mentah.slice(mulai, awal))) return true;

  // (c) baris komentar BERSAMBUNG tepat di atasnya — bentuk yang dipakai
  //     `app.ts`, yang `.catch`-nya mendarat di baris keempat pernyataan yang
  //     sama.
  //
  //     TIDAK berlaku bila ia yang PERTAMA dalam sebuah blok: komentar di atas
  //     `{` itu milik DEKLARASINYA, bukan alasan telanan di dalamnya. Tanpa
  //     pengecualian ini, JSDoc `jadwalkanPangkasErrorLog` memaafkan telanan di
  //     baris pertama badannya — satu kelolosan palsu yang ditemukan sebelum
  //     daftar pilah-tangan ditulis.
  if (mentah[mulai - 1] === "{") return false;
  // Cukup SATU baris — baris TEPAT di atasnya. Blok komentar berbaris banyak
  // tetap tertangkap: baris terakhirnya sendiri sudah berupa komentar.
  const baris = mentah.slice(0, mulai).split("\n");
  baris.pop(); // baris awalnya sendiri
  const atas = (baris.pop() ?? "").trim();
  return /^(?:\/\/|\/\*|\*)/.test(atas);
}

export function situsDitelan(kode?: { berkas: string; isi: string }[]): SitusTelan[] {
  const keluar: SitusTelan[] = [];
  const ambil = (berkas: string, mentah: string) => {
    const buta = butaKomentar(mentah);
    for (const [pola, bentuk] of [
      [POLA_PANAH, "panah"],
      [POLA_BLOK, "blok"],
    ] as const) {
      for (const m of buta.matchAll(pola)) {
        keluar.push({
          berkas,
          baris: buta.slice(0, m.index!).split("\n").length,
          bentuk,
          beralasan: beralasan(mentah, buta, bentuk, m.index!, m.index! + m[0].length),
          potongan: m[0].replace(/\s+/g, " ").slice(0, 80),
        });
      }
    }
  };
  if (kode) {
    for (const { berkas, isi } of kode) ambil(berkas, isi);
    return keluar;
  }
  for (const [akar, dir] of Object.entries(AKAR)) {
    for (const p of berkasSumber(dir)) {
      ambil(`${akar}/${p.slice(dir.length + 1)}`, readFileSync(p, "utf8"));
    }
  }
  return keluar;
}
