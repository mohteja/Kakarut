import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * TIAP `z.number()` WAJIB BERBATAS ATAS.
 *
 * `z.number()` menerima apa pun sampai `Number.MAX_VALUE` (1,8e308). Kolom yang
 * menampungnya tidak: `numeric(p, s)` hanya memuat `p − s` digit di depan koma.
 * Nilai di atasnya tidak disimpan salah — ia DITOLAK Postgres, dan penolakan
 * itu tiba sebagai galat tak tertangani.
 *
 * TERUKUR lewat HTTP terhadap server sungguhan, sebelum diperbaiki:
 *
 *     PUT  /menu/:id    mult = 9.999            → 200
 *     PUT  /menu/:id    mult = 10.000           → HTTP 500   `numeric(7,3)`
 *     POST /bahan       harga_beli = 1e12       → HTTP 500   `numeric(14,2)`
 *     POST /penjualan   qty = 1e8               → HTTP 500   `numeric(10,2)`
 *     POST /penjualan   uang_diterima = 1e15    → HTTP 500
 *
 * Dan yang lebih sunyi daripada 500: apa yang LOLOS. `qty = 10.000.000` dibalas
 * **201**, tersimpan, lalu ikut setiap SUM — omzet hari itu terbaca
 * **Rp 11.003.936.250** dari satu ketikan. Tak ada galat, tak ada peringatan.
 *
 * Aturan ini SUDAH ditegakkan di empat pintu (`harga_per_unit`, `harga`,
 * `dana_cair`, `realisasi`) sejak lama — dan tujuh puluh tujuh saudaranya
 * dibiarkan terbuka. Bentuk yang sama berulang sepanjang audit ini.
 *
 * Batas atasnya sendiri pun sempat salah: keempat pintu itu memakai
 * `1_000_000_000_000`, satu lebih BESAR dari yang muat di `numeric(14,2)`.
 * Terukur: `harga_per_unit = 1e12` lolos Zod lalu jatuh 500 di Postgres,
 * sedangkan `1e12 + 1` ditolak 400. Pintu yang "sudah dijaga" pun masih
 * meloloskan tepat satu nilai yang meledak.
 *
 * BATAS PENJAGA INI, ditulis supaya "hijau" tak terbaca lebih luas dari yang
 * benar: ia menuntut ADANYA `.max()`, bukan bahwa angkanya cocok dengan kolom
 * tujuannya.
 *
 * Celah itu MENGGIGIT, dan sekarang ada penjaganya: dua pintu resep memakai
 * batas `numeric(16,6)` untuk kolom `numeric(12,4)` — 100× kolomnya — dan
 * `komponen[].qty = 100.000.000` dibalas **HTTP 500** sementara 99.999.999
 * dibalas 201. Pemetaan medan → kolom kini hidup di
 * `batas-ikut-presisi-kolom.test.ts`, diturunkan dari `schema.ts`.
 */
const AKAR = [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../../../packages/shared/src", import.meta.url)),
];

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/**
 * Komentar dibuang SEBELUM disapu.
 *
 * Catatan panjang di `batas-angka.ts` menyebut `z.number()` sebagai contoh —
 * dan sapuan versi pertama menuduhnya. Penjaga yang menuduh prosanya sendiri
 * sudah terjadi sekali di repo ini (`sql-number-bukan-janji`); ia mengajari
 * orang mengabaikan warna merahnya.
 */
export const tanpaKomentar = butaKomentar;

/**
 * Medan yang SENGAJA tanpa batas atas, disebut satu per satu berikut alasannya.
 *
 * Bukan "yang belum sempat" — daftar ini keputusan yang ditulis. Rute impor
 * bahan melaporkan kegagalan PER BARIS lalu meneruskan sisanya; memasang
 * `.max()` di skema barisnya memindahkan penolakan ke Zod, yang membatalkan
 * SELURUH badan — satu sel salah ketik di baris ke-500 membuang 999 baris yang
 * benar. Angkanya tetap tak lolos ke basis data: jalur impor menangkapnya per
 * baris (dijaga §225 verify-api).
 *
 * Disebut lewat NAMA MEDAN + berkasnya, bukan pola samar seperti "*import*" —
 * pola begitu kelak menelan skema lain yang kebetulan namanya mirip.
 */
const DIKECUALIKAN = new Set([
  "modules/bahan/routes.ts::harga_beli",
  "modules/bahan/routes.ts::isi",
  "modules/bahan/routes.ts::stok_minimum",
  "modules/bahan/routes.ts::min_beli",
]);

/** `z.number(` boleh terpisah baris — prettier menulis `harga: z\n  .number()`. */
const POLA = /z\s*\.\s*number\s*\(/g;

/** Rantai method sesudah `z.number()`, berhenti di pemisah kedalaman nol. */
function rantai(s: string, i: number): string {
  let dalam = 0;
  let j = i;
  for (; j < s.length; j += 1) {
    if (s[j] === "(") dalam += 1;
    else if (s[j] === ")") {
      dalam -= 1;
      if (dalam === 0) {
        j += 1;
        break;
      }
    }
  }
  let out = "";
  dalam = 0;
  for (; j < s.length && out.length < 400; j += 1) {
    const c = s[j];
    if (c === "(") dalam += 1;
    else if (c === ")") {
      if (dalam === 0) break;
      dalam -= 1;
    } else if (dalam === 0 && (c === "," || c === ";" || c === "}")) break;
    else if (dalam === 0 && c === "\n") {
      // baris berikutnya masih rantai HANYA bila diawali titik
      if (!s.slice(j, j + 80).replace(/^[\s\n]+/, "").startsWith(".")) break;
    }
    out += c;
  }
  return out;
}

/**
 * Pengecualian hanya berlaku DI DALAM `BahanImportRowBody`.
 *
 * `harga_beli` juga muncul di lima skema lain pada berkas yang sama; tanpa
 * pembatas ini pengecualiannya melebar ke semuanya, dan gerbang ini akan
 * memberi izin diam-diam persis di tempat yang paling ramai.
 */
function dalamImporBahan(s: string, i: number): boolean {
  const awal = s.lastIndexOf("const BahanImportRowBody = z.object({", i);
  if (awal < 0) return false;
  const tutup = s.indexOf("\n});", awal);
  return tutup > i;
}

export function telanjang(kode?: { nama: string; isi: string }[]): string[] {
  const berkas =
    kode ??
    AKAR.flatMap((a) => berkasTs(a).map((p) => ({ nama: p.slice(a.length + 1), isi: readFileSync(p, "utf8") })));
  const keluar: string[] = [];
  for (const { nama, isi } of berkas) {
    const bersih = tanpaKomentar(isi);
    for (const m of bersih.matchAll(POLA)) {
      if (rantai(bersih, m.index! + m[0].length - 1).includes(".max(")) continue;
      const medan = /([A-Za-z_]\w*)\s*:\s*$/.exec(bersih.slice(Math.max(0, m.index! - 120), m.index!));
      // Pengecualian dicocokkan pada BERKAS + NAMA MEDAN, jadi medan bernama
      // sama di berkas lain tetap tertuduh.
      if (medan && DIKECUALIKAN.has(`${nama}::${medan[1]}`) && dalamImporBahan(bersih, m.index!)) continue;
      keluar.push(`${nama}:${bersih.slice(0, m.index!).split("\n").length}`);
    }
  }
  return keluar;
}

describe("tiap z.number() berbatas atas", () => {
  const daftar = telanjang();

  it("premis: pemindainya benar-benar menemukan z.number() di kode", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat penjaganya hijau dengan
    // hitungan nol — izin terbuka, bukan penjagaan.
    const semua = AKAR.flatMap((a) => berkasTs(a)).flatMap((p) => [
      ...tanpaKomentar(readFileSync(p, "utf8")).matchAll(POLA),
    ]);
    expect(semua.length).toBeGreaterThan(100);
  });

  it("INTI: tak ada z.number() tanpa .max()", () => {
    expect(
      daftar,
      "medan angka ini menerima nilai sampai 1,8e308, sementara kolomnya " +
        "`numeric(p,s)` cuma memuat p−s digit. Yang di atasnya jatuh 500; yang " +
        "di bawahnya tapi tetap absurd tersimpan diam-diam dan ikut tiap SUM " +
        "(terukur: satu qty salah ketik → omzet Rp 11.003.936.250). Pakai " +
        "konstanta dari `lib/batas-angka.ts` yang menyebut kolom tujuannya",
    ).toEqual([]);
  });

  it("batas lama 1e12 tak boleh kembali — ia SATU LEBIH BESAR dari yang muat", () => {
    // `numeric(14,2)` memuat 999.999.999.999,99. Terukur: 1e12 lolos Zod lalu
    // jatuh 500 di Postgres; 1e12+1 ditolak 400. Angka bulat yang kelihatan
    // rapi itu justru satu-satunya nilai yang lolos penjaga lalu meledak.
    for (const a of AKAR) {
      for (const p of berkasTs(a)) {
        expect(readFileSync(p, "utf8"), `${p}: batas 1e12 melebihi numeric(14,2)`).not.toContain(
          "max(1_000_000_000_000)",
        );
      }
    }
  });

  it("pengecualiannya SEMPIT — hanya di dalam BahanImportRowBody", () => {
    const buat = (isi: string) => telanjang([{ nama: "modules/bahan/routes.ts", isi }]);
    const di_dalam =
      "const BahanImportRowBody = z.object({\n  harga_beli: z.number().nonnegative().optional(),\n});";
    expect(buat(di_dalam), "di dalam skema impor: dikecualikan").toHaveLength(0);
    // Medan bernama sama, skema LAIN, berkas yang sama → tetap tertuduh.
    const di_luar = "const BahanCreateBody = z.object({\n  harga_beli: z.number().nonnegative(),\n});";
    expect(buat(di_luar), "di luar skema impor: harus tetap tertuduh").toHaveLength(1);
    // …dan berkas lain sama sekali tak kena pengecualian.
    expect(
      telanjang([{ nama: "modules/menu/routes.ts", isi: "harga_beli: z.number().min(0)," }]),
      "berkas lain tak boleh ikut dikecualikan",
    ).toHaveLength(1);
    // Daftarnya masih HIDUP: kalau skemanya kelak dibatasi juga, pengecualian
    // yang menggantung harus ketahuan, bukan diam-diam melebar.
    const asli = readFileSync(join(AKAR[0], "modules/bahan/routes.ts"), "utf8");
    expect(asli, "BahanImportRowBody hilang — perbarui DIKECUALIKAN").toContain(
      "const BahanImportRowBody = z.object({",
    );
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh yang salah", () => {
    const buat = (isi: string) => telanjang([{ nama: "uji.ts", isi }]);
    expect(buat("harga: z.number().nonnegative(),"), "telanjang harus tertuduh").toHaveLength(1);
    expect(buat("harga: z.number().nonnegative().max(9),"), "yang berbatas tak boleh").toHaveLength(0);
    // Bentuk prettier — pelajaran dari gerbang larik yang buta 54% karena
    // menuntut `z` dan `.number(` bersebelahan.
    expect(buat("harga: z\n  .number()\n  .min(0),"), "bentuk multi-baris harus tertuduh").toHaveLength(1);
    expect(buat("harga: z\n  .number()\n  .min(0)\n  .max(9),"), "…dan yang berbatas tak boleh").toHaveLength(0);
    // `.max()` milik objek PEMBUNGKUSNYA tak boleh memaafkan angkanya.
    //
    // Yang menghentikan rantainya di sini `)` penutup `z.object(`, bukan `}`.
    // Penghenti `}` tetap dipasang di `rantai()` sebagai pertahanan, tapi
    // dicabut pun uji ini tetap hijau — jadi ia TIDAK terbukti menahan apa pun,
    // dan tak boleh dibaca seolah begitu.
    expect(
      buat("z.object({ a: z.string(), qty: z.number().positive() }).max(5)"),
      "`.max()` milik objek pembungkusnya bukan milik angkanya",
    ).toHaveLength(1);
    // …dan prosa tak boleh tertuduh.
    expect(buat("/** contoh: z.number() tanpa batas */"), "komentar bukan kode").toHaveLength(0);
    expect(buat("// harga: z.number().nonnegative(),"), "komentar baris bukan kode").toHaveLength(0);
  });
});
