import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { barisDi, jelajah, uraikan, type Simpul } from "./util/ast";
import { berkasKode } from "./util/rute";

/**
 * TIPE CABANG DISEBUT DARI YANG DIINGINKAN, BUKAN DARI SISANYA.
 *
 * `lokasi-menu-hanya-store.test.ts` menceritakan harganya: `MenuListPage`
 * menawarkan "🏭 Central Kitchen" sebagai lokasi menu selama DUA TAHUN, sebab
 * satu commit mengubah formulirnya dari `tipe !== "kantor"` jadi
 * `tipe === "store"` dan melewatkan halaman daftarnya. Penjaga itu lahir dari
 * sana — tapi populasinya digambar mengelilingi `pages/menu/`, dan aturan yang
 * SAMA diputuskan di tempat lain juga.
 *
 * Terukur 2026-09-11 atas seluruh `apps/web/src` + `apps/server/src`: dari 12
 * rantai `x !== "a" && x !== "b"` atas nilai enum, SATU berjalan atas tipe
 * cabang — `StokPage.tsx:58`, `selTipe !== "central_kitchen" && selTipe !==
 * "kantor"`, yang memutuskan apakah tab **Stok Menu** tampil.
 *
 * KENAPA BENTUK ITU BERBEDA DARI `!== "store"` YANG BIASA. Menyebut satu nilai
 * yang tak diinginkan adalah gerbang: nilai baru jatuh ke sisi TERTOLAK, sisi
 * yang aman. Menyebut SELURUH SISANYA membalik itu — tipe cabang keempat jatuh
 * ke sisi DITERIMA, tanpa ada yang memutuskannya. Dan ia tak menunggu tipe
 * keempat: selagi `/cabang` dalam perjalanan nilainya `undefined`, dan
 * `undefined !== "central_kitchen"` juga benar.
 *
 * Yang dijaga: NOL rantai kecuali atas tipe cabang, di kedua pohon. Bentuk
 * positifnya sudah punya rumah — `bolehJadiLokasiMenu` di `BranchContext`.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const TIPE_CABANG = new Set(["store", "central_kitchen", "kantor"]);

export interface RantaiKecuali {
  berkas: string;
  baris: number;
  nilai: string[];
  cuplik: string;
}

/**
 * Rantai `x !== "a" && x !== "b"` atas literal tipe cabang, dengan operand
 * kiri yang SAMA. Dua literal ke atas — satu literal saja bukan daftar-kecuali,
 * ia gerbang biasa.
 */
export function rantaiKecualiTipe(berkas: string, isi: string): RantaiKecuali[] {
  const keluar: RantaiKecuali[] = [];
  let akar: Simpul;
  try {
    akar = uraikan(berkas, isi);
  } catch {
    return keluar;
  }
  const teks = (n: Simpul) => isi.slice(n.start, n.end).replace(/\s+/g, " ");
  jelajah(akar, (n) => {
    if (n.type !== "LogicalExpression" || n.operator !== "&&") return;
    const bagian: Simpul[] = [];
    const kumpul = (x: Simpul): void => {
      if (x.type === "LogicalExpression" && x.operator === "&&") {
        kumpul(x.left as Simpul);
        kumpul(x.right as Simpul);
      } else bagian.push(x);
    };
    kumpul(n);
    const banding = bagian.filter(
      (b) => b.type === "BinaryExpression" && (b.operator === "!==" || b.operator === "!="),
    );
    const atasTipe = banding.filter((b) => {
      const r = b.right as Simpul;
      return r?.type === "Literal" && TIPE_CABANG.has(r.value as string);
    });
    if (atasTipe.length < 2) return;
    const kiri = new Set(atasTipe.map((b) => teks(b.left as Simpul)));
    if (kiri.size !== 1) return;
    keluar.push({
      berkas,
      baris: barisDi(isi, n.start),
      nilai: atasTipe.map((b) => (b.right as Simpul).value as string),
      cuplik: teks(n).slice(0, 90),
    });
  });
  // rantai induk & anaknya bisa sama-sama tertangkap — satu per baris cukup
  const unik = new Map<number, RantaiKecuali>();
  for (const k of keluar) {
    const ada = unik.get(k.baris);
    if (!ada || k.nilai.length > ada.nilai.length) unik.set(k.baris, k);
  }
  return [...unik.values()];
}

describe("tipe cabang disebut positif, bukan lewat daftar-kecuali", () => {
  const berkas = [
    ...berkasKode(AKAR + "apps/web/src", /\.tsx?$/),
    ...berkasKode(AKAR + "apps/server/src", /\.ts$/),
  ];
  const temuan = berkas.flatMap((p) =>
    rantaiKecualiTipe(p.replace(AKAR, ""), readFileSync(p, "utf8")),
  );

  it("PREMIS: sapuannya melihat kedua pohon, bukan satu", () => {
    // Sapuan yang kehilangan separuh bahannya lulus tanpa memeriksa apa pun.
    expect(berkas.filter((p) => p.includes("/web/")).length).toBeGreaterThan(100);
    expect(berkas.filter((p) => p.includes("/server/")).length).toBeGreaterThan(80);
  });

  it("INTI: nol rantai `x !== tipeA && x !== tipeB`", () => {
    expect(
      temuan.map((t) => `${t.berkas}:${t.baris} [${t.nilai.join(",")}] ${t.cuplik}`),
      "Tipe cabang diputuskan dari SISANYA, bukan dari yang diinginkan — tipe " +
        "keempat kelak jatuh ke sisi DITERIMA tanpa ada yang memutuskannya, dan " +
        "`undefined` (selagi /cabang dalam perjalanan) sudah begitu hari ini. " +
        "Pakai bentuk positif; untuk lokasi menu rumahnya `bolehJadiLokasiMenu`.",
    ).toEqual([]);
  });

  it("PASANGAN: pemindainya menuduh — dan melewati gerbang satu-nilai", () => {
    const u = (kode: string) => rantaiKecualiTipe("u.ts", kode);
    expect(u('const a = t !== "central_kitchen" && t !== "kantor";')).toHaveLength(1);
    expect(u('const a = t !== "central_kitchen" && t !== "kantor";')[0].nilai).toEqual([
      "central_kitchen",
      "kantor",
    ]);
    // rantai panjang: penjaga lain di tengah tak menyelamatkannya
    expect(u('const a = x && t !== "store" && y && t !== "kantor";')).toHaveLength(1);
    // SATU nilai = gerbang biasa, dan itu justru bentuk yang aman
    expect(u('const a = t !== "store";')).toEqual([]);
    expect(u('const a = t !== "store" && b.is_active;')).toEqual([]);
    // bentuk POSITIF tak pernah dituduh
    expect(u('const a = t === "store";')).toEqual([]);
    expect(u('const a = t === "central_kitchen" || t === "kantor";')).toEqual([]);
    // operand yang BERBEDA bukan daftar-kecuali — ia dua pertanyaan
    expect(u('const a = a.tipe !== "store" && b.tipe !== "kantor";')).toEqual([]);
    // nilai di luar tipe cabang tak ikut (peran, status, …)
    expect(u('const a = r !== "owner" && r !== "admin";')).toEqual([]);
    // komentar tak dibaca — pengurainya pohon sintaks
    expect(u('// t !== "central_kitchen" && t !== "kantor"')).toEqual([]);
  });

  it("penjaga lokasi menu yang melahirkan aturan ini masih berdiri", () => {
    /*
     * Dua penjaga, satu pelajaran, dan keduanya perlu: yang itu melarang
     * halaman menu menulis aturannya sendiri DALAM BENTUK APA PUN (populasi
     * satu direktori, tuduhan luas); yang ini melarang SATU BENTUK di seluruh
     * repo (populasi luas, tuduhan sempit). Mencabut salah satunya membuka
     * separuh celahnya kembali.
     */
    const lain = readFileSync(AKAR + "apps/server/test/lokasi-menu-hanya-store.test.ts", "utf8");
    expect(lain).toContain("bolehJadiLokasiMenu");
    expect(lain).toContain("tak ada halaman menu yang menulis sendiri aturan tipe cabang");
    // …dan rumah bentuk positifnya masih berbunyi `store`
    expect(readFileSync(AKAR + "apps/web/src/context/BranchContext.tsx", "utf8")).toContain(
      'export const bolehJadiLokasiMenu = (b?: Pick<Cabang, "tipe"> | null) => b?.tipe === "store"',
    );
  });
});
