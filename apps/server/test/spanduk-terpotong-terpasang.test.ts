import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * TIAP BENDERA PEMOTONGAN PUNYA LAYAR YANG MENGATAKANNYA.
 *
 * Bendera `*_terpotong` lahir untuk satu alasan yang selalu sama: sebuah
 * agregat dihitung TANPA batas sementara daftarnya dipotong, jadi dua angka
 * yang berselisih berdiri di satu layar. Tanpa kalimat yang menautkannya,
 * selisihnya terbaca sebagai data yang HILANG — dan orang mencurigai
 * pembukuannya sendiri. Itu sudah tertulis di komentar tiap situsnya.
 *
 * Yang tak dijaga siapa pun sampai hari ini: apakah benderanya benar-benar
 * SAMPAI ke sebuah layar. Bendera baru bisa lahir di kontrak, dikirim server,
 * dan tak pernah dirender — dan tak ada satu pun uji yang berubah warna.
 * `potong-berpenanda` & `rute-terpotong-satu-kontrak` menjaga sisi SERVER
 * (setiap rute yang memotong wajib menandainya); berkas ini menjaga sisi
 * seberangnya.
 *
 * Terukur 2026-09-11: **6 bendera** di kontrak, **7 situs render** di web,
 * dan **nol** spec peramban yang pernah menyebut satu pun. Tiga di antaranya
 * kini punya lengan peramban (`apps/web/e2e/spanduk-terpotong.spec.ts`); tiga
 * sisanya hidup di dalam modal dan baru dijaga oleh berkas ini.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const TIPE = "packages/shared/src/types.ts";
const WEB = "apps/web/src";

/** (interface, medan) tiap bendera `*_terpotong` di kontrak. */
export function benderaTerpotong(sumber: string): { iface: string; medan: string }[] {
  const baris = sumber.split("\n");
  const keluar: { iface: string; medan: string }[] = [];
  for (let i = 0; i < baris.length; i++) {
    const m = /^\s{2}([a-z_]+_terpotong)\s*:/.exec(baris[i]);
    if (!m) continue;
    for (let j = i; j >= 0; j--) {
      const mi = /^export (?:interface|type) (\w+)\b/.exec(baris[j]);
      if (mi) {
        keluar.push({ iface: mi[1], medan: m[1] });
        break;
      }
    }
  }
  return keluar;
}

/** Bendera yang tak disebut satu berkas web pun. */
export function tanpaLayar(
  bendera: { iface: string; medan: string }[],
  web: Record<string, string>,
): string[] {
  return bendera
    .filter(({ medan }) => !Object.values(web).some((t) => t.includes(`.${medan}`)))
    .map((b) => `${b.iface}.${b.medan}`);
}

function berkasWeb(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasWeb(jalur);
    return /\.tsx?$/.test(jalur) ? [jalur] : [];
  });
}

describe("bendera pemotongan: ada benderanya, ada layarnya", () => {
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const web: Record<string, string> = {};
  for (const f of berkasWeb(AKAR + WEB)) web[f.slice(AKAR.length)] = readFileSync(f, "utf8");
  const bendera = benderaTerpotong(tipe);

  it("PREMIS: populasinya terbaca, dan sebanyak yang diukur", () => {
    expect(Object.keys(web).length, "berkas web tersapu terlalu sedikit").toBeGreaterThan(80);
    expect(bendera.length, "bendera pemotongan menyusut — pengurainya rusak").toBeGreaterThanOrEqual(6);
    // Keenamnya disebut namanya: kalau salah satu lenyap dari kontrak, uji ini
    // menyebutkan yang mana, bukan sekadar berubah jumlah.
    const nama = bendera.map((b) => `${b.iface}.${b.medan}`);
    for (const n of [
      "TransferStokDaftar.rows_terpotong",
      "SupplierKartu.rows_terpotong",
      "CustomerDetail.transaksi_terpotong",
      "LaporanDurasiPesanan.riwayat_terpotong",
      "ShiftDetail.transaksi_terpotong",
      "RiwayatHargaDto.lots_terpotong",
    ]) {
      expect(nama, `${n} lenyap dari kontrak`).toContain(n);
    }
  });

  it("INTI: tak ada bendera pemotongan yang tak punya layar", () => {
    expect(
      tanpaLayar(bendera, web),
      "Bendera ini ada di kontrak dan dikirim server, tapi tak satu berkas web pun " +
        "menyebutnya — jadi daftarnya dipotong DIAM-DIAM. Itu justru keadaan yang " +
        "melahirkan bendera ini: agregat dihitung tanpa batas sementara daftarnya " +
        "pendek, dan selisihnya terbaca sebagai data yang hilang. Render kalimatnya, " +
        "atau cabut medannya dari kontrak:\n" + tanpaLayar(bendera, web).join("\n"),
    ).toEqual([]);
  });

  it("INTI: tiga yang punya lengan peramban memang diuji dari DOM", () => {
    // Lengan peramban itu satu-satunya yang membuktikan kalimatnya SAMPAI ke
    // layar; penjaga di berkas ini hanya membuktikan medannya DISEBUT.
    const spec = readFileSync(AKAR + "apps/web/e2e/spanduk-terpotong.spec.ts", "utf8");
    for (const m of ["rows_terpotong", "riwayat_terpotong"]) {
      expect(spec, `lengan peramban berhenti menyebut ${m}`).toContain(m);
    }
    expect(spec).toContain("route.fetch()");
  });

  it("PASANGAN: pemindainya menuduh medan yang tak pernah dirender", () => {
    const palsu = "export interface X {\n  hantu_terpotong: boolean;\n}\n";
    expect(benderaTerpotong(palsu)).toEqual([{ iface: "X", medan: "hantu_terpotong" }]);
    expect(tanpaLayar(benderaTerpotong(palsu), { "a.tsx": "const x = 1;" })).toEqual([
      "X.hantu_terpotong",
    ]);
    // …dan DIAM begitu ada layar yang menyebutnya.
    expect(
      tanpaLayar(benderaTerpotong(palsu), { "a.tsx": "{data.hantu_terpotong && <b/>}" }),
    ).toEqual([]);
  });
});
