import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bagiAtauNull, foodCostPersen } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { SRC } from "./util/sql-mentah";

/**
 * PEMBAGI NOL DIJAWAB NOL, DAN NOL ITU DIPERCAYA.
 *
 * Aturan "`null`, bukan `0`" sudah dinamai & dibayar vena biaya (2026-08-26):
 * *"nol tercetak 'Rp 0' dan dipercaya"*. Ia ditegakkan di DTO dan di layar
 * (`TAK_DIKETAHUI = "—"`), dan TIDAK di rumus intinya:
 *
 *     foodCostPersen(hpp, hargaJual) = hargaJual > 0 ? … : 0
 *
 * Lencana penerimanya sudah menuliskan kerusakannya lebih dulu
 * (`MenuListPage.tsx`): *"'—' adalah jawaban yang benar, dan 0% akan terbaca
 * sebagai food cost sempurna."*
 *
 * TERUKUR lewat HTTP, menu komplimen `harga_jual = 0` ber-resep Rp2.083:
 *
 *     food_cost_persen        0        →  null
 *     posisi di Analisis Harga 77/93   →  94/94 (ekor, dirender "—")
 *     persen_hpp saat HPP nol  0       →  null
 *
 * Nol yang SAH tetap nol: HPP 0 dengan harga jual 15.000 tetap 0%.
 */

const AKAR: Record<string, string> = {
  server: SRC,
  shared: fileURLToPath(new URL("../../../packages/shared/src", import.meta.url)),
};

/** `x > 0 ? a / b : 0` — pembagian yang jatuh ke NOL, bukan ke "tak diketahui". */
const POLA_JATUH_NOL = /\?[^?:;{}]*\/[^?:;{}]*:\s*0\b/g;

type Situs = { berkas: string; baris: number; potongan: string };

/**
 * Kelas tiap situs, dengan alasan yang bisa DIPERIKSA — bukan didiamkan.
 *
 * `CHECK` bukan klaim: uji di bawah membuktikan constraint-nya benar-benar ada
 * di berkas migrasi, jadi "dijaga basis data" tak bisa jadi mantra.
 */
type Kelas = "CHECK" | "PENJAGA_AWAL" | "BENAR";

const DIPILAH_TANGAN = new Map<string, { situs: number; kelas: Kelas; alasan: string }>([
  [
    "shared/hpp.ts",
    {
      situs: 1,
      kelas: "CHECK",
      alasan:
        "hargaPerUnit(hargaBeli, isi) — `ingredients_isi_ck` (migrasi 0000) menuntut isi > 0, " +
        "jadi cabang nolnya tak pernah menyala. Fallback-nya justru dokumentasi bahwa " +
        "constraint itu ada; menggantinya dengan null menyebarkan ketidaktahuan ke angka yang diketahui",
    },
  ],
  [
    "server/modules/produksi/konsumsi.ts",
    {
      situs: 2,
      kelas: "CHECK",
      alasan:
        "row.qty / isi (batch produksi) — penyebutnya `ingredients.isi`, dijaga " +
        "`ingredients_isi_ck`. Sama seperti hpp.ts: cabang nolnya tak terjangkau",
    },
  ],
  [
    "server/modules/rekomendasi/rencana.ts",
    {
      situs: 2,
      kelas: "CHECK",
      alasan:
        "hargaBeli / isi saat merakit rencana — penyebutnya `ingredients.isi`, dijaga " +
        "`ingredients_isi_ck`; kedua situsnya bentuk yang sama persis",
    },
  ],
  [
    "server/modules/rekomendasi/service.ts",
    {
      situs: 1,
      kelas: "CHECK",
      alasan:
        "hargaBeli / isi pada rekomendasi beli — penyebutnya `ingredients.isi`, dijaga " +
        "`ingredients_isi_ck`",
    },
  ],
  [
    "server/modules/perlengkapan/service.ts",
    {
      situs: 1,
      kelas: "PENJAGA_AWAL",
      alasan:
        "hariTerjadwal() membagi dengan `langkah = perHari * HARI_MS`, dan fungsinya dibuka " +
        "`if (perHari < 1) return []` — penyebutnya mustahil nol saat baris itu dicapai. " +
        "Nol di ternary itu pun bukan fallback pembagian melainkan nilai awal kursor",
    },
  ],
  [
    "shared/refund.ts",
    {
      situs: 1,
      kelas: "BENAR",
      alasan:
        "PB1 proporsional saat refund: bila nota asalnya TAK ber-PB1 (`asal.pb1 = 0`), " +
        "PB1 yang dikembalikan memang NOL rupiah. Ini jawaban yang diketahui, bukan " +
        "ketidaktahuan yang menyamar — mengubahnya jadi null akan membuat refund tak bisa dihitung",
    },
  ],
]);

function berkasSumber(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) berkasSumber(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function situsJatuhNol(kode?: { berkas: string; isi: string }[]): Situs[] {
  const keluar: Situs[] = [];
  const ambil = (berkas: string, mentah: string) => {
    const s = butaKomentar(mentah);
    for (const m of s.matchAll(POLA_JATUH_NOL)) {
      keluar.push({
        berkas,
        baris: s.slice(0, m.index!).split("\n").length,
        potongan: m[0].replace(/\s+/g, " ").slice(0, 100),
      });
    }
  };
  if (kode) {
    for (const { berkas, isi } of kode) ambil(berkas, isi);
    return keluar;
  }
  for (const [akar, dir] of Object.entries(AKAR)) {
    for (const p of berkasSumber(dir)) ambil(`${akar}/${p.slice(dir.length + 1)}`, readFileSync(p, "utf8"));
  }
  return keluar;
}

describe("pembagian yang jatuh ke NOL: tiap situs terdaftar dengan kelasnya", () => {
  const semua = situsJatuhNol();

  it("populasinya benar-benar tersapu (bukan nol karena pemindainya patah)", () => {
    expect(semua.length).toBeGreaterThanOrEqual(6);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThanOrEqual(5);
  });

  it("tak ada situs yang tak terdaftar, dan jumlah per berkas cocok", () => {
    const per = new Map<string, number>();
    for (const x of semua) per.set(x.berkas, (per.get(x.berkas) ?? 0) + 1);
    const salah: string[] = [];
    for (const [berkas, n] of per) {
      const d = DIPILAH_TANGAN.get(berkas);
      if (!d) salah.push(`${berkas}: ${n} pembagian jatuh ke 0, tak terdaftar`);
      else if (d.situs !== n) salah.push(`${berkas}: terdaftar ${d.situs}, sekarang ${n}`);
    }
    expect(
      salah,
      `pembagi nol dijawab NOL tanpa keputusan — pakai bagiAtauNull(), atau daftarkan beralasan:\n${salah.join("\n")}`,
    ).toEqual([]);
  });

  it("anti-kuburan + tiap entri menyebut ALASAN", () => {
    const hidup = new Set(semua.map((x) => x.berkas));
    for (const [k, v] of DIPILAH_TANGAN) {
      expect(hidup.has(k), `entri daftar sudah tak punya situs — hapus: ${k}`).toBe(true);
      expect(v.alasan.length, `${k} tanpa alasan`).toBeGreaterThan(80);
    }
  });

  it("PREMIS kelas CHECK diperiksa, bukan diyakini: constraint-nya nyata ada", () => {
    const dir = fileURLToPath(new URL("../drizzle", import.meta.url));
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .map((n) => readFileSync(join(dir, n), "utf8"))
      .join("\n");
    // Enam situs bersandar pada satu constraint. Kalau ia dihapus migrasi kelak,
    // "dijaga basis data" berhenti benar — dan gerbang ini yang memerah.
    expect(sql, "ingredients_isi_ck hilang — enam situs kelas CHECK kehilangan dasarnya").toContain(
      "ingredients_isi_ck",
    );
    expect(sql).toMatch(/CHECK\s*\(\s*"ingredients"\."isi"\s*>\s*0\s*\)/);
    const berCheck = [...DIPILAH_TANGAN.entries()].filter(([, v]) => v.kelas === "CHECK");
    expect(berCheck.reduce((a, [, v]) => a + v.situs, 0)).toBe(6);
  });
});

describe("perilaku: null untuk yang tak terhitung, NOL untuk nol yang sah", () => {
  it("bagiAtauNull menolak penyebut nol / tak hingga / NaN", () => {
    expect(bagiAtauNull(10, 0)).toBeNull();
    expect(bagiAtauNull(10, NaN)).toBeNull();
    expect(bagiAtauNull(NaN, 10)).toBeNull();
    expect(bagiAtauNull(10, Infinity)).toBeNull();
    expect(bagiAtauNull(10, 4)).toBe(2.5);
    // Nol yang SAH: pembilang nol dengan penyebut wajar adalah jawaban yang
    // BENAR-BENAR diketahui, dan ia tetap nol.
    expect(bagiAtauNull(0, 4)).toBe(0);
    expect(bagiAtauNull(-10, 4)).toBe(-2.5);
  });

  it("food cost menu komplimen tak terhitung — bukan 0%", () => {
    expect(foodCostPersen(2083.33, 0)).toBeNull();
    expect(foodCostPersen(2083.33, NaN)).toBeNull();
  });

  it("PASANGAN: menu ber-HPP nol yang DIJUAL tetap 0%, bukan '—'", () => {
    expect(foodCostPersen(0, 15000)).toBe(0);
    // …dan menu wajar tak berubah sama sekali.
    expect(foodCostPersen(2000, 10000)).toBeCloseTo(20, 10);
    expect(foodCostPersen(4000, 10000)).toBeCloseTo(40, 10);
  });

  it("BUKTI MERAH: bentuk LAMA benar-benar menjawab 0 untuk kasus yang sama", () => {
    // Rumus lama, apa adanya. Kalau ia sudah null sejak dulu, tak ada yang
    // diperbaiki putaran ini — jadi ini yang membuktikan temuannya nyata.
    const lama = (hpp: number, hargaJual: number) => (hargaJual > 0 ? (hpp / hargaJual) * 100 : 0);
    expect(lama(2083.33, 0)).toBe(0);
    expect(foodCostPersen(2083.33, 0)).toBeNull();
    // Dan keduanya SEPAKAT di jalur wajar — perbaikannya tak menggeser angka.
    for (const [hpp, harga] of [
      [2000, 10000],
      [0, 15000],
      [7777, 12345],
    ]) {
      expect(foodCostPersen(hpp, harga)).toBeCloseTo(lama(hpp, harga), 10);
    }
  });

  it("rumusnya BENAR-BENAR lewat pintu bersama (bukan penjaga tulisan tangan lagi)", () => {
    const hpp = readFileSync(
      fileURLToPath(new URL("../../../packages/shared/src/hpp.ts", import.meta.url)),
      "utf8",
    );
    expect(hpp).toContain("bagiAtauNull(hpp, hargaJual)");
    expect(hpp).not.toMatch(/hargaJual > 0 \? \(hpp \/ hargaJual\) \* 100 : 0/);
    // Situs kedua: porsi penyumbang HPP di analisis harga. Rasionya dihitung
    // lewat pintu bersama, lalu dikali 100 SESUDAHNYA — bukan `kontribusi *
    // 100` yang dioper sebagai argumen (gerbang `diadili-lintas-fungsi`).
    const menu = readFileSync(join(SRC, "modules/menu/routes.ts"), "utf8");
    expect(menu).toContain("bagiAtauNull(p.kontribusi, dto.hpp)");
    expect(menu).toContain("persen_hpp: rasio === null ? null : rasio * 100");
    expect(menu).not.toMatch(/persen_hpp: dto\.hpp > 0 \?/);
  });
});
