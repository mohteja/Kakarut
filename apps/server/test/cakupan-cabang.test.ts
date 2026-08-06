import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga BATAS CABANG untuk peran yang terkunci cabang.
 *
 * Kasir, tim, kitchen, dan bar terikat pada SATU cabang. Batas itu ditegakkan
 * bukan oleh satu gerbang melainkan oleh beberapa penolong yang berbeda:
 *
 *   `resolveBranchId`          — abaikan `?branch_id=` milik pemanggil terkunci
 *   `resolveBranchUntukTulis`  — 403 bila menulis ke cabang selain miliknya
 *   `hanyaMilikSendiri`        — persempit daftar ke baris miliknya sendiri
 *   `terikatCabang` / `auth.branch_id` — pemeriksaan langsung
 *
 * Penyisiran menemukan keempatnya dipakai dengan benar hari ini. Yang TIDAK
 * ada adalah sesuatu yang memberi tahu kalau endpoint BERIKUTNYA lupa
 * memakainya — dan justru karena penolongnya bagus (tersembunyi di balik nama),
 * kelupaan itu tak kelihatan saat membaca handler-nya sepintas.
 *
 * BATAS UJI INI, supaya tak dikira lebih dari yang ia buktikan: ia menangkap
 * KELALAIAN (endpoint baru menyentuh cabang dari pemanggil tanpa menyebut satu
 * pun penolong), bukan PENYALAHGUNAAN (penolong dipanggil tapi hasilnya
 * diabaikan). Kelalaian itulah regresi yang realistis; penyalahgunaan butuh
 * seseorang menulis penjaga lalu sengaja membuangnya.
 */
const src = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), "utf8");

const APP = src("app.ts");

/**
 * Modul yang gerbang perannya MENGIZINKAN peran terkunci cabang masuk.
 *
 * Daftarnya ditulis tangan, tapi ALASAN tiap entri dipatok ke baris gerbang di
 * `app.ts`. Kalau gerbangnya diperketat/dilonggarkan, pin-nya gugur dan daftar
 * ini wajib ditinjau ulang — bukan diam-diam jadi usang.
 */
/**
 * Gerbang peran yang MENGIZINKAN peran terkunci cabang masuk.
 *
 * Tiap entri memuat pin ke baris gerbang di `app.ts`. Kalau gerbangnya
 * diperketat/dilonggarkan, pin-nya gugur dan daftar ini wajib ditinjau ulang —
 * bukan diam-diam jadi usang.
 */
const GERBANG: string[] = [
  '"/pesanan/*",',
  '"/absensi/*",',
  '"/pengajuan/*",',
  '"/kebersihan/*",',
  '"/transfer-stok/*",',
  'tenant.use("/produksi/*", izinkanProduksi);',
  'tenant.use("/pembelian/*", izinkanManajemenAtauKaryawanCk);',
  'tenant.use("/shift/*", requireRole("owner", "admin", "cashier"));',
  'tenant.use("/open-bill/*", requireRole("cashier"));',
];

/**
 * Berkas modul di balik gerbang-gerbang itu. `pembelian` TIDAK terdaftar
 * terpisah: `pembelianRoutes` diekspor dari berkas `produksi/routes.ts` yang
 * sama, jadi memindainya dua kali hanya melipatgandakan uji yang sama.
 */
const BERKAS: string[] = [
  "modules/pesanan/routes.ts",
  "modules/absensi/routes.ts",
  "modules/pengajuan/routes.ts",
  "modules/kebersihan/routes.ts",
  "modules/transfer/routes.ts",
  "modules/produksi/routes.ts",
  "modules/shift/routes.ts",
  "modules/open-bill/routes.ts",
];

const PENOLONG = [
  "resolveBranchId",
  "resolveBranchUntukTulis",
  "hanyaMilikSendiri",
  "terikatCabang",
  "auth.branch_id",
  "kunciKirimCabang",
];

const TERIKAT = ["cashier", "tim", "kitchen", "bar"];

/**
 * Rute digerbang inline HANYA untuk manajemen? Yang diperiksa `requireRole`
 * PERTAMA di blok — itulah gerbang rutenya; `requireRole` lain (kalau ada)
 * milik rute berikutnya yang ikut terpotong ke dalam blok.
 */
function manajemenSaja(blok: string): boolean {
  const m = /requireRole\(([^)]*)\)/.exec(blok);
  if (!m) return false;
  const peran = m[1].match(/"(\w+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
  return peran.length > 0 && !peran.some((p) => TERIKAT.includes(p));
}

/** Handler rute (`.get("/…")`), BUKAN `c.get("auth")`. */
function handler(isi: string): { metode: string; path: string; blok: string }[] {
  const out: { metode: string; path: string; blok: string }[] = [];
  const re = /\.(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(isi))) {
    const sisa = isi.slice(m.index + m[0].length);
    const nxt = sisa.search(/\n  \.(get|post|put|patch|delete)\(\s*"\//);
    out.push({
      metode: m[1].toUpperCase(),
      path: m[2],
      blok: sisa.slice(0, nxt === -1 ? 6000 : nxt),
    });
  }
  return out;
}

describe("gerbang peran di app.ts masih seperti yang diasumsikan daftar di atas", () => {
  for (const pin of GERBANG) {
    it(`gerbang masih terpasang: ${pin.slice(0, 48)}`, () => {
      expect(APP, "gerbang berubah; tinjau daftar BERKAS di uji ini").toContain(pin);
    });
  }

  it("peran terkunci cabang memang keempat itu", () => {
    // Kalau daftar peran terkunci bertambah/berkurang, cakupan uji ini ikut
    // berubah artinya.
    const AUTH = src("middleware/auth.ts");
    expect(AUTH).toContain("export function terikatCabang");
    for (const peran of ["cashier", "tim", "kitchen", "bar"]) {
      expect(AUTH).toContain(`"${peran}"`);
    }
  });
});

describe("endpoint yang menerima cabang dari PEMANGGIL menyebut penjaganya", () => {
  for (const modul of BERKAS) {
    const isi = src(modul);
    for (const h of handler(isi)) {
      const dariPemanggil =
        h.blok.includes("body.branch_id") ||
        h.blok.includes('query("branch_id")') ||
        h.blok.includes("body.asal_branch_id");
      if (!dariPemanggil) continue;
      it(`${modul} ${h.metode} ${h.path}`, () => {
        // CARA KEEMPAT yang juga sah: rute digerbang INLINE ke manajemen saja.
        // Peran terkunci tak pernah sampai ke sini, jadi `branch_id` dari
        // pemanggil memang haknya (owner melihat cabang mana pun). Dua rekap
        // (/absensi/rekap, /kebersihan/rekap) memakai jalur ini — keduanya
        // sempat ditandai uji ini sebelum aturannya dilengkapi.
        if (manajemenSaja(h.blok)) return;
        const dipakai = PENOLONG.filter((p) => h.blok.includes(p));
        expect(
          dipakai,
          `menerima cabang dari pemanggil tanpa gerbang manajemen DAN tanpa menyebut satu pun dari: ${PENOLONG.join(", ")}`,
        ).not.toEqual([]);
      });
    }
  }
});

describe("penolongnya sendiri masih menegakkan batasnya", () => {
  it("resolveBranchId MENGABAIKAN ?branch_id= milik peran terkunci", () => {
    const AUTH = src("middleware/auth.ts");
    const i = AUTH.indexOf("export async function resolveBranchId");
    const blok = AUTH.slice(i, i + 700);
    // Urutannya yang penting: cek peran terkunci HARUS mendahului pembacaan
    // query. Kalau query dibaca lebih dulu lalu dipakai, batasnya bocor.
    const iTerikat = blok.indexOf("terikatCabang(auth.role)");
    const iQuery = blok.indexOf('c.req.query("branch_id")');
    expect(iTerikat).toBeGreaterThan(0);
    expect(iQuery).toBeGreaterThan(iTerikat);
    expect(blok).toContain("return auth.branch_id;");
  });

  it("resolveBranchUntukTulis MENOLAK 403 menulis ke cabang orang lain", () => {
    const PROD = src("modules/produksi/routes.ts");
    const i = PROD.indexOf("async function resolveBranchUntukTulis");
    const blok = PROD.slice(i, i + 600);
    expect(blok).toContain("terikatCabang(auth.role) && branchId !== auth.branch_id");
    expect(blok).toContain("HTTPException(403");
  });

  it("hanyaMilikSendiri menutup peran terkunci TANPA bergantung query", () => {
    // `saya === "1" || terikatCabang(role)` — bagian kedua tak bisa dimatikan
    // pemanggil. Kalau berubah jadi hanya `saya === "1"`, kasir bisa membaca
    // pengajuan cuti seluruh perusahaan (memuat alasan pribadi).
    const PNG = src("modules/pengajuan/routes.ts");
    expect(PNG).toContain('return saya === "1" || terikatCabang(role);');
  });
});
