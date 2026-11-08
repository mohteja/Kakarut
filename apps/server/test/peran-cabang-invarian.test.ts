import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { terikatCabang } from "../src/middleware/auth";
import { userRoleEnum } from "../src/db/schema";

/**
 * TIGA BELAS GERBANG OTORISASI BERSANDAR PADA SATU CHECK DI DATABASE — DAN TAK
 * SATU BARIS PUN MENYEBUTNYA.
 *
 * Penyaringan cabang di repo ini punya DUA bentuk yang terlihat mirip tapi
 * berlawanan arah ketika `branch_id` ternyata kosong:
 *
 *   gagal-TERTUTUP    if (terikatCabang(role) && branchId !== auth.branch_id) → 403
 *                     `branchId !== null` bernilai true, jadi aksesnya ditolak.
 *
 *   gagal-TERBUKA     if (terikatCabang(role) && auth.branch_id) conds.push(…)
 *                     syaratnya tak pernah terpasang, jadi penyaringan cabang
 *                     LENYAP dan perannya melihat seluruh perusahaan.
 *
 * Bentuk kedua dipakai belasan kali — di penerimaan, stok, penjualan, shift,
 * dan lainnya. Semuanya aman hari ini, dan alasannya cuma satu: kasir, tim,
 * kitchen & bar TAK MUNGKIN punya `branch_id` kosong, sebab
 * `memberships_cashier_branch_ck` melarangnya:
 *
 *   role NOT IN ('cashier','tim','kitchen','bar') OR branch_id IS NOT NULL
 *
 * (Sejak peran `hrd`, 2026-11-08, CHECK menyebut peran yang TERIKAT, bukan
 * yang bebas — nilai enum baru tak boleh dipakai di transaksi migrasi yang
 * sama dengan ALTER TYPE ADD VALUE. Peran yang tak disebut = bebas cabang.)
 *
 * Yang membuat ini rapuh bukan kodenya, melainkan bahwa ketergantungannya tak
 * tertulis. Namanya menyebut `cashier` saja padahal ia menjaga empat peran, dan
 * ia duduk di `schema.ts` — jauh dari satu pun gerbang yang bergantung padanya.
 * Siapa pun yang kelak melonggarkannya (mis. mengizinkan kasir "mengambang"
 * tanpa cabang, atau membebaskan peran baru dari kewajiban bercabang) membuka
 * tiga belas gerbang sekaligus, tanpa menyentuh satu pun berkas otorisasi.
 *
 * Uji ini menutup jarak itu. Ia tidak memindai teks belaka: `terikatCabang`
 * DIJALANKAN dan daftar peran dibaca dari enum yang sebenarnya, jadi peran yang
 * ditambahkan kelak ikut terperiksa dengan sendirinya.
 */
const AUTH_SRC = readFileSync(
  fileURLToPath(new URL("../src/middleware/auth.ts", import.meta.url)),
  "utf8",
);
const SCHEMA_SRC = readFileSync(
  fileURLToPath(new URL("../src/db/schema.ts", import.meta.url)),
  "utf8",
);

/** Teks CHECK `memberships_cashier_branch_ck` — bisa ditulis beberapa baris. */
function teksCheck(): string {
  const i = SCHEMA_SRC.indexOf('"memberships_cashier_branch_ck"');
  if (i < 0) return "";
  return SCHEMA_SRC.slice(i, SCHEMA_SRC.indexOf("),", i));
}

/** Peran yang DIWAJIBKAN CHECK punya cabang (daftar `NOT IN (...)`). */
function peranWajibCabangCheck(): string[] {
  const daftar = teksCheck().match(/NOT IN\s*\(([^)]*)\)/);
  if (!daftar) return [];
  return [...daftar[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Peran yang DIBEBASKAN CHECK dari kewajiban punya cabang: enum − daftar wajib. */
function peranBebasCabang(): string[] {
  const wajib = new Set(peranWajibCabangCheck());
  if (wajib.size === 0) return [];
  return userRoleEnum.enumValues.filter((r) => !wajib.has(r));
}

describe("peran terikat cabang: invarian yang menopang gerbang gagal-terbuka", () => {
  const SEMUA_PERAN = userRoleEnum.enumValues;

  it("enum & CHECK-nya benar-benar terbaca — bukan lolos karena kosong", () => {
    // Tanpa ini, satu perubahan nama membuat pemindainya memulangkan daftar
    // kosong dan SELURUH uji di bawah hijau tanpa memeriksa apa pun.
    expect(SEMUA_PERAN.length).toBeGreaterThanOrEqual(4);
    expect(SCHEMA_SRC).toContain("memberships_cashier_branch_ck");
    expect(peranWajibCabangCheck()).toEqual(["cashier", "tim", "kitchen", "bar"]);
    expect(peranBebasCabang()).toEqual(["owner", "admin", "hrd"]);
  });

  it("setiap peran terikat cabang WAJIB bercabang menurut CHECK", () => {
    // Inti invariannya. Peran yang oleh kode dianggap terkunci ke satu cabang,
    // tapi oleh database dibebaskan dari kewajiban punya cabang, adalah peran
    // yang `auth.branch_id`-nya bisa kosong — dan tiap gerbang gagal-terbuka
    // langsung melebar jadi selintas perusahaan untuknya.
    const bebas = new Set(peranBebasCabang());
    const bolong = SEMUA_PERAN.filter((r) => terikatCabang(r) && bebas.has(r));
    expect(
      bolong,
      "peran ini dianggap terkunci cabang oleh terikatCabang() tapi dibebaskan " +
        "oleh memberships_cashier_branch_ck — `auth.branch_id`-nya bisa NULL, " +
        "dan setiap `terikatCabang(role) && auth.branch_id` melewatkan " +
        "penyaringan cabangnya",
    ).toEqual([]);
  });

  it("peran yang TIDAK terikat cabang memang yang dibebaskan CHECK — tak ada sisa", () => {
    // Arah sebaliknya, supaya kedua daftar tak diam-diam menyimpang. Peran yang
    // dibebaskan CHECK tapi tak dikenal `terikatCabang` sebagai bebas berarti
    // salah satu dari keduanya sudah tertinggal saat peran baru ditambahkan.
    const bebas = peranBebasCabang();
    expect(bebas.filter((r) => terikatCabang(r))).toEqual([]);
    expect(SEMUA_PERAN.filter((r) => !terikatCabang(r)).sort()).toEqual(
      [...bebas].sort(),
    );
  });

  it("resolveBranchId tetap gagal-TERTUTUP — satu-satunya yang tak bersandar pada CHECK", () => {
    // Penulis `resolveBranchId` sudah menganggap keadaan ini mungkin dan
    // menolaknya terang-terangan. Kalau penjaga eksplisit itu dicabut dengan
    // alasan "toh CHECK-nya menjamin", jaring terakhirnya ikut hilang.
    const i = AUTH_SRC.indexOf("export async function resolveBranchId");
    expect(i).toBeGreaterThan(0);
    const tubuh = AUTH_SRC.slice(i, i + 600);
    expect(tubuh).toContain("if (!auth.branch_id)");
    expect(tubuh).toContain("Akun tanpa cabang");
  });
});
