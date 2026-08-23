import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * SATU PINTU UNTUK `?branch_id=`.
 *
 * Cabang yang disebut klien lewat query harus DIVALIDASI milik perusahaan ini.
 * Aturannya sudah ada dan sudah dipakai 61 kali — `resolveBranchId` →
 * `pastikanCabang` → 404 "Cabang tidak ditemukan". Yang bocor bukan aturannya,
 * melainkan pintunya: DELAPAN rute menyusun sendiri saringan dari
 * `c.req.query("branch_id")` dan tak satu pun memeriksa kepemilikannya.
 *
 * Terukur lewat HTTP sungguhan (owner Basooopa, `?branch_id=` UUID cabang
 * perusahaan LAIN, 2026-08-23):
 *
 *     GET  /meja                          404  ← aturannya
 *     GET  /menu                          200, 80 dari 81 menu
 *     GET  /perlengkapan/beli             200, 0 dari 53 baris
 *     GET  /kebersihan/area               200, 2 dari 3 area
 *     GET  /kebersihan                    200, 0 baris
 *     GET  /pengajuan                     200, 0 baris
 *     GET  /absensi/rekap                 200, 0 baris
 *     POST /perlengkapan/beli/batal-semua 200 {"ok":true,"jumlah":0}
 *
 * Sesudah perbaikan kedelapannya 404, dan yang sah tetap hidup: `?branch_id=`
 * cabang sendiri tetap menyaring (menu terbatas-cabang: 81 vs 80), `all` dan
 * tanpa param tetap penuh. Dua rute malah baru sembuh — `/perlengkapan/beli`
 * dan `/menu` dulu MENOLAK `?branch_id=all` (400 / katalog kosong) padahal itu
 * nilai yang dipakai setiap daftar lain.
 *
 * ATURAN YANG DIJAGA DI SINI: `c.req.query("branch_id")` hanya boleh muncul
 * (a) di `middleware/auth.ts` — rumah kedua pintunya, atau
 * (b) sebagai perbandingan dengan `"all"`, penanda pelebaran yang selalu
 *     berpasangan dengan `resolveBranchId` di baris berikutnya.
 * Bentuk lain berarti ada yang menyusun pemilih cabang sendiri lagi.
 *
 * YANG TIDAK DIJANJIKAN: penjaga ini melihat bentuk pembacaan query, bukan apa
 * yang dilakukan nilainya sesudah itu. Rute yang memanggil `cabangDariQuery`
 * lalu mengabaikan hasilnya tetap hijau. Yang dicegah adalah kelas yang memang
 * terjadi delapan kali: query dibaca langsung, lalu masuk WHERE apa adanya.
 */
const SRC = fileURLToPath(new URL("../src/", import.meta.url)).replace(/\/$/, "");

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

const BERKAS = berkasTs(SRC).sort();
const ISI = new Map(BERKAS.map((p) => [p, butaKomentar(readFileSync(p, "utf8"))]));

/** Rumah aturannya — di sini query memang dibaca, lalu divalidasi. */
const RUMAH = join(SRC, "middleware/auth.ts");

/**
 * Pembacaan `?branch_id=` yang tidak lewat salah satu pintu.
 *
 * Dipisah dari sapuannya supaya bisa dijalankan atas masukan sintetis — bukti
 * merah yang menyuntik berkas sungguhan gampang gagal mendarat tanpa ada yang
 * sadar (sudah terjadi tiga kali di sesi ini).
 */
export function pemilihTanganSendiri(kode: string): { baris: number; potongan: string }[] {
  const keluar: { baris: number; potongan: string }[] = [];
  for (const m of kode.matchAll(/c\s*\.\s*req\s*\.\s*query\(\s*"branch_id"\s*\)/g)) {
    const sesudah = kode.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
    const sebelum = kode.slice(Math.max(0, m.index! - 60), m.index!);
    // (b) penanda pelebaran: dibandingkan dengan "all" di kedua arah penulisan.
    const penandaAll = /^\s*(===|!==)\s*"all"/.test(sesudah) || /"all"\s*(===|!==)\s*$/.test(sebelum);
    if (penandaAll) continue;
    keluar.push({
      baris: kode.slice(0, m.index!).split("\n").length,
      potongan: kode.slice(m.index!, m.index! + 70).replace(/\s+/g, " "),
    });
  }
  return keluar;
}

/** Pengecualian bernama. Kosong hari ini — mekanismenya tetap diuji di bawah. */
const DIKECUALIKAN: { berkas: string; alasan: string }[] = [];

describe("penyapunya benar-benar membaca sesuatu", () => {
  it("memindai seluruh pohon sumber, bukan sebagian", () => {
    // Pengupas komentar yang buta membuat sapuan ini melihat 19 dari 263 rute
    // dan tetap melapor "bersih" — itu kejadian nyata, bukan kekhawatiran.
    // Lihat `buta-komentar.test.ts`.
    expect(BERKAS.length).toBeGreaterThan(90);
    const rute = [...ISI.values()].join("\n").match(/\.\s*(get|post|put|patch|delete)\s*\(\s*"\//g);
    expect(rute!.length).toBeGreaterThan(250);
  });

  it("populasi pembacaan `?branch_id=` tidak nol", () => {
    let n = 0;
    for (const isi of ISI.values()) n += [...isi.matchAll(/c\s*\.\s*req\s*\.\s*query\(\s*"branch_id"\s*\)/g)].length;
    expect(n).toBeGreaterThanOrEqual(7);
  });

  it("aturannya memang dipakai luas — `resolveBranchId` puluhan kali", () => {
    let n = 0;
    for (const isi of ISI.values()) n += [...isi.matchAll(/\bresolveBranchId\s*\(/g)].length;
    expect(n).toBeGreaterThan(50);
  });
});

describe("detektornya bisa menuduh", () => {
  it("menuduh bentuk mentah yang persis dipakai kedelapan rute sebelum diperbaiki", () => {
    const dulu = [
      'const ckId = c.req.query("branch_id") || undefined;',
      'ckFilter = c.req.query("branch_id") || undefined;',
      'terikatCabang(auth.role) ? auth.branch_id : c.req.query("branch_id") || null;',
      'const branchId = saringCabang(c.req.query("branch_id"));',
      'const branchQ = c.req.query("branch_id");',
    ];
    for (const baris of dulu) {
      expect(pemilihTanganSendiri(baris), baris).toHaveLength(1);
    }
  });

  it("TIDAK menuduh penanda pelebaran `=== \"all\"`", () => {
    const sah = [
      'const semua = !terikatCabang(auth.role) && c.req.query("branch_id") === "all";',
      'if (auth.role !== "cashier" && c.req.query("branch_id") === "all") return undefined;',
      'if (c.req.query("branch_id") !== "all") lakukan();',
    ];
    for (const baris of sah) expect(pemilihTanganSendiri(baris), baris).toHaveLength(0);
  });

  it("melaporkan nomor baris yang tepat", () => {
    const kode = 'const a = 1;\nconst b = 2;\nconst c2 = c.req.query("branch_id") || null;\n';
    expect(pemilihTanganSendiri(kode)[0].baris).toBe(3);
  });

  it("tidak tertipu komentar yang mengutip bentuk terlarang", () => {
    const kode = '// dulu: c.req.query("branch_id") || null\nconst x = 1;\n';
    expect(pemilihTanganSendiri(butaKomentar(kode))).toHaveLength(0);
  });
});

describe("tak ada lagi pemilih cabang tulisan tangan", () => {
  const tertuduh = BERKAS.filter((p) => p !== RUMAH).flatMap((p) =>
    pemilihTanganSendiri(ISI.get(p)!).map((t) => ({ p, ...t })),
  );

  it("sapuan bersih di luar rumahnya", () => {
    const nama = new Set(DIKECUALIKAN.map((d) => d.berkas));
    const sisa = tertuduh.filter((t) => !nama.has(t.p.replace(SRC + "/", "")));
    expect(
      sisa.map((t) => `${t.p.replace(SRC + "/", "")}:${t.baris}  ${t.potongan}`),
      "cabang dari query wajib lewat `cabangDariQuery` (atau `resolveBranchId`) " +
        "supaya divalidasi milik perusahaan ini — lihat kepala berkas untuk " +
        "angka HTTP sebelum/sesudahnya",
    ).toEqual([]);
  });

  it("tak ada pengecualian basi", () => {
    // Pengecualian yang situsnya sudah bersih diam-diam melebarkan izin untuk
    // kode BARU di berkas yang sama. Kosong hari ini; kalau nanti terisi,
    // asersi ini yang menagihnya kembali.
    const berkasTertuduh = new Set(tertuduh.map((t) => t.p.replace(SRC + "/", "")));
    for (const d of DIKECUALIKAN) {
      expect(berkasTertuduh.has(d.berkas), `pengecualian basi: ${d.berkas} (${d.alasan})`).toBe(true);
    }
  });

  it("rumahnya sendiri memang membaca query — kalau tidak, sapuan ini hampa", () => {
    expect(pemilihTanganSendiri(ISI.get(RUMAH)!).length).toBeGreaterThanOrEqual(1);
  });
});

describe("pintunya benar-benar memvalidasi kepemilikan", () => {
  const auth = ISI.get(RUMAH)!;

  it("`cabangDariQuery` memanggil `pastikanCabang`, bukan cuma memeriksa bentuk", () => {
    const i = auth.indexOf("export async function cabangDariQuery");
    expect(i).toBeGreaterThan(0);
    const badan = auth.slice(i, i + 500);
    expect(badan).toContain("pastikanCabang(");
    // Bentuk UUID saja tidak cukup: itu yang dilakukan `saringCabang` lama, dan
    // ia meloloskan cabang perusahaan lain dengan 200.
    expect(badan).toContain("UUID_RE");
  });

  it("`pastikanCabang` masih mengurung ke perusahaan pemanggil", () => {
    const i = auth.indexOf("export async function pastikanCabang");
    expect(i).toBeGreaterThan(0);
    const badan = auth.slice(i, i + 400);
    expect(badan).toContain("eq(branches.companyId, companyId)");
    expect(badan).toContain("404");
  });
});
