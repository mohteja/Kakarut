import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { medanInterface } from "./kunci-sumber";

/**
 * `qty_teks` MILIK SERVER — LAYAR TAK BOLEH MERAKITNYA ULANG.
 *
 * Aturannya sudah tertulis di repo ini, di tiga tempat sekaligus: komentar
 * `qtyTeks()`, komentar medan `qty_teks` di kontrak ("tampilkan apa adanya…
 * agar web & mobile mustahil berbeda satuan"), dan bahkan sebuah komentar di
 * `FakturDetailPage.tsx` yang berbunyi harfiah *"`qty_teks` milik server,
 * jangan dirakit ulang"*.
 *
 * Kode tepat DI BAWAH komentar terakhir itu merakitnya ulang. Sampai
 * 2026-09-11.
 *
 * DAN SEBABNYA TERUKUR, bukan kelalaian merata. `qty_teks` masuk
 * `StokMasukRow` pada 2026-09-05 (#98) tepat untuk mencegah perakitan ulang —
 * komentarnya di kontrak menuliskannya sendiri: *"tipe ini tak pernah
 * mendeklarasikannya dan layarnya merakit ulang `formatAngka(qty) + satuan`
 * sendiri — medan ini ada persis untuk mencegah itu."* **Tipenya dibetulkan;
 * pemakainya tidak.** Kelas yang layak punya nama: *kontraknya diperbaiki,
 * pemanggilnya ditinggal.*
 *
 * Di layar Penerimaan sebabnya berbeda dan lebih dalam: `PenerimaanRow` hidup
 * sebagai tipe LOKAL yang mengetik ulang 21 dari 25 medan yang benar-benar
 * dikirim, dan `qty_teks` salah satu dari empat yang tak disebutnya. Layarnya
 * tak bisa memakai medan yang tipenya sendiri sembunyikan.
 *
 * Kenapa ini bukan kerewelan kosmetik: menebak satuan sendiri sudah pernah
 * melahirkan **"900 kg" untuk barang yang sebenarnya 900 gr**, dan "batch"
 * untuk barang bersatuan gram — tercatat di komentar `qtyTeks()` sebagai
 * kejadian, bukan kekhawatiran.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const WEB = "apps/web/src";
const TIPE = "packages/shared/src/types.ts";

/**
 * UTANG YANG DIIZINKAN — situs yang merakit ulang TANPA menanyakan `qty_teks`.
 *
 * 9 saat diukur, dan kesembilannya berjalan atas baris yang rutenya memang
 * TAK mengirim `qty_teks` (perlengkapan, analisis harga, laporan pembelian,
 * kiriman menggantung, tahap). Mereka bukan pelanggaran hari ini — mereka
 * antrean: tiap satu yang rutenya kelak ikut mengirim `qty_teks` wajib
 * berpindah ke bentuk berpagar, dan angka ini turun.
 *
 * Hanya boleh MENYUSUT.
 */
const MAKS_TELANJANG = 9;

/** `{formatAngka(x.qty)} {x.satuan}` — perakitan ulang, bentuk JSX. */
const RAKIT = /\{formatAngka\((\w+)\.qty\)\}\s*\{\1\.satuan\}/g;
/** `{x.qty_teks ?? `${formatAngka(x.qty)} ${x.satuan}`}` — bentuk BERPAGAR. */
const BERPAGAR = /\{(\w+)\.qty_teks \?\? `\$\{formatAngka\(\1\.qty\)\} \$\{\1\.satuan\}`\}/g;

function berkasWeb(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasWeb(jalur);
    return /\.tsx?$/.test(jalur) ? [jalur] : [];
  });
}

/** Situs perakitan ulang TELANJANG — yang berpagar `?? ` tak dihitung. */
export function situsTelanjang(sumber: Record<string, string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    const barisBerpagar = new Set<number>();
    for (const m of buta.matchAll(BERPAGAR)) {
      barisBerpagar.add(buta.slice(0, m.index).split("\n").length);
    }
    for (const m of buta.matchAll(RAKIT)) {
      const baris = buta.slice(0, m.index).split("\n").length;
      if (barisBerpagar.has(baris)) continue;
      keluar.push(`${berkas}:${baris}`);
    }
  }
  return keluar.sort();
}

describe("qty_teks milik server: layar tak merakit ulang teks jumlah", () => {
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const sumber: Record<string, string> = {};
  for (const f of berkasWeb(AKAR + WEB)) sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
  const telanjang = situsTelanjang(sumber);

  it("PREMIS: sapuannya melihat sebanyak yang diukur", () => {
    expect(Object.keys(sumber).length, "berkas web tersapu terlalu sedikit").toBeGreaterThan(80);
    // Aturannya masih tertulis di kontrak — kalau komentarnya kelak dihapus,
    // uji ini kehilangan alasannya dan harus ikut dibuang, bukan dibiarkan
    // menegakkan aturan yang tak berlaku.
    expect(tipe).toContain("mustahil berbeda satuan");
  });

  it("INTI: `PenerimaanRow` di kontrak, 25 medan, dan `qty_teks` salah satunya", () => {
    const k = medanInterface(tipe, "PenerimaanRow");
    expect(k.length, "kontrak PenerimaanRow bukan lagi 25 medan").toBe(25);
    // Keempat medan yang salinan lokal web TAK sebutkan — kalau salah satunya
    // lenyap lagi dari kontrak, uji ini menyebut namanya.
    for (const m of ["qty_teks", "qty_setara", "qty_dipesan_teks", "satuan_beli"]) {
      expect(k, `${m} — medan yang dulu dikirim tanpa disebut`).toContain(m);
    }
  });

  it("INTI: layar Penerimaan memakai `qty_teks`, tak mengetik bentuknya sendiri", () => {
    const hal = butaKomentar(
      readFileSync(AKAR + WEB + "/pages/produksi/PenerimaanPage.tsx", "utf8"),
    );
    expect(hal, "masih mendeklarasikan PenerimaanRow sendiri").not.toMatch(
      /interface PenerimaanRow\s*\{/,
    );
    expect(hal, "tak memakai tipe kontrak").toMatch(/PenerimaanRow/);
    expect(
      (hal.match(/\{r\.qty_teks\}/g) ?? []).length,
      "kedua panel kiriman harus memakai teks milik server",
    ).toBe(2);
  });

  it("INTI: `FakturDetailPage` akhirnya mematuhi komentarnya sendiri", () => {
    const hal = butaKomentar(
      readFileSync(AKAR + WEB + "/pages/produksi/FakturDetailPage.tsx", "utf8"),
    );
    expect(hal, "jumlahTeks masih merakit ulang tanpa menanyakan qty_teks").toMatch(
      /const teks = r\.qty_teks \?\? `\$\{formatAngka\(r\.qty\)\} \$\{r\.satuan\}`;/,
    );
    // …dan komentar aturannya TETAP ada. Kode yang benar dengan aturan yang
    // hilang adalah kode yang akan salah lagi pada penulis berikutnya.
    const mentah = readFileSync(AKAR + WEB + "/pages/produksi/FakturDetailPage.tsx", "utf8");
    expect(mentah).toContain("milik SERVER, jangan dirakit ulang");
  });

  it("INTI: perakitan ulang TELANJANG hanya boleh MENYUSUT", () => {
    expect(
      telanjang.length,
      `situs yang merakit teks jumlah tanpa menanyakan \`qty_teks\` BERTAMBAH ` +
        `(${telanjang.length} > ${MAKS_TELANJANG}). Medan itu ditulis server justru ` +
        "supaya web & ponsel mustahil berbeda satuan — menebak sendiri sudah pernah " +
        'melahirkan "900 kg" untuk barang yang sebenarnya 900 gr. Pakai ' +
        "`x.qty_teks ?? …`, atau turunkan MAKS_TELANJANG bila kau baru membayarnya:\n" +
        telanjang.join("\n"),
    ).toBeLessThanOrEqual(MAKS_TELANJANG);
  });

  it("PASANGAN: pemindainya menuduh — dan membedakan berpagar dari telanjang", () => {
    expect(
      situsTelanjang({ "a.tsx": "<td>{formatAngka(r.qty)} {r.satuan}</td>" }),
    ).toEqual(["a.tsx:1"]);
    // Bentuk BERPAGAR tidak tertuduh — itu justru bentuk yang benar.
    expect(
      situsTelanjang({
        "b.tsx": "<td>{r.qty_teks ?? `${formatAngka(r.qty)} ${r.satuan}`}</td>",
      }),
    ).toEqual([]);
    // Penerima yang BERBEDA tak dianggap sepasang (`r.qty` vs `x.satuan`).
    expect(
      situsTelanjang({ "c.tsx": "<td>{formatAngka(r.qty)} {x.satuan}</td>" }),
    ).toEqual([]);
    // Komentar tak dihitung.
    expect(
      situsTelanjang({ "d.tsx": "// <td>{formatAngka(r.qty)} {r.satuan}</td>" }),
    ).toEqual([]);
    // Pengurai kontrak menuduh medan karangan.
    const palsu = tipe.replace(
      "export interface PenerimaanRow {",
      "export interface PenerimaanRow {\n  medan_karangan: string;",
    );
    expect(medanInterface(palsu, "PenerimaanRow")).toContain("medan_karangan");
  });
});
