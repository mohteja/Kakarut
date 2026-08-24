import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kapasitasKolom, PETA } from "./util/kolom-numerik";
import * as BATAS from "../src/lib/batas-angka";

/**
 * BATASNYA HARUS COCOK DENGAN KOLOM TUJUANNYA — bukan sekadar ADA.
 *
 * Gerbang `angka-berbatas-atas.test.ts` menuntut tiap `z.number()` punya
 * `.max()`. Ia menulis batasnya sendiri dengan jujur:
 *
 *   > ia menuntut ADANYA `.max()`, bukan bahwa angkanya cocok dengan kolom
 *   > tujuannya. Pemetaan medan → kolom tak ada di kode.
 *
 * Dan celah itu MENGGIGIT. Kedua pintu resep memakai `BATAS_QTY_STOK`
 * (9.999.999.999 — batas `numeric(16,6)` milik stok) untuk kolom yang
 * sebenarnya `numeric(12,4)`, seratus kali lebih sempit. Terukur lewat HTTP
 * terhadap Postgres sungguhan:
 *
 *     POST /menu             komponen[].qty =  99.999.999  → 201
 *     POST /menu             komponen[].qty = 100.000.000  → **HTTP 500**
 *     PUT  /bahan/:id/resep  komponen[].qty =  99.999.999  → 200
 *     PUT  /bahan/:id/resep  komponen[].qty = 100.000.000  → **HTTP 500**
 *
 * Sembilan setengah miliar nilai lolos gerbang yang KELIHATANNYA menjaga.
 * Sesudah `BATAS_QTY_RESEP`: 100.000.000 dibalas **400 bernama**
 * ("komponen[0].qty: maksimal 99999999") dan 99.999.999 tetap 201/200.
 *
 * Uji ini memindahkan pemetaan itu dari KOMENTAR ke KODE, lalu menurunkan
 * angkanya dari `schema.ts` — jadi presisi kolom yang berubah membuat uji ini
 * merah, bukan diam-diam meloloskan nilai yang tak muat lagi.
 *
 * KENAPA PETANYA DITULIS TANGAN, dan itu bukan kemalasan. Penjodohan otomatis
 * berdasar NAMA medan sudah kucoba dan ia **menuduh 17, lima belas di
 * antaranya salah**: `qty` ada di TIGA BELAS tabel dengan tiga presisi
 * berbeda, jadi penjodoh nama selalu memilih yang tersempit (`sale_items`
 * 10,2) dan menuduh setiap `qty` perlengkapan/produksi yang sebenarnya sah.
 * Penjaga yang salah tuduh mengajari orang mengabaikan warna merahnya. Yang
 * dipakai di sini: peta eksplisit + uji KELENGKAPAN, supaya medan baru tak
 * bisa lolos diam-diam meski petanya tulisan tangan.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const AKAR = [SRC, fileURLToPath(new URL("../../../packages/shared/src", import.meta.url))];

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
 * Kolom yang diklaim tiap konstanta — DIPINDAH DARI KOMENTAR KE KODE.
 *
 * Sebelumnya daftar ini hidup di komentar `batas-angka.ts`, dan komentar tak
 * pernah merah. Sekarang tiap konstanta wajib sama dengan kapasitas kolom
 * TERSEMPIT yang diklaimnya.
 */
const KOLOM: Record<string, string[]> = {
  BATAS_UANG: [
    "sales.total",
    "sales.subtotal",
    "sales.subtotal_asal",
    "sales.diskon",
    "sales.diskon_asal",
    "sales.pb1_amount",
    "sales.pb1_asal",
    "sales.refund_total",
    "sales.uang_diterima",
    "productions.total_harga",
    "supply_mutations.total_harga",
    "supply_purchases.total_harga",
    "faktur_dana.nominal",
    "sale_refunds.nominal",
    "shifts.modal_awal",
    "shifts.uang_fisik",
    "ingredients.harga_beli",
    "supplies.harga_beli",
    "companies.target_penjualan",
  ],
  BATAS_HARGA: ["menus.harga_jual", "sale_items.harga_satuan"],
  BATAS_QTY_BARIS: ["sale_items.qty", "sale_items.qty_refund", "open_bill_items.qty", "sale_refunds.qty"],
  BATAS_QTY_STOK: [
    "productions.qty",
    "productions.qty_dipesan",
    "production_consumptions.qty",
    "sale_consumptions.qty",
    "stock_opnames.qty",
    "stock_opnames.selisih",
    "stock_opnames.system_qty",
    "ingredients.stok_minimum",
    "ingredients.stok_minimum_toko",
    "ingredients.min_beli",
    "supplies.stok_minimum",
    "supply_mutations.qty",
    "supply_mutations.qty_fisik",
    "supply_mutations.system_qty",
    "supply_purchases.qty",
    "supply_rules.qty",
    "supply_transfers.qty",
  ],
  BATAS_FAKTOR: ["menus.mult", "menus.base_mult", "menu_price_logs.mult_baru", "menu_price_logs.mult_lama"],
  BATAS_ISI: ["ingredients.isi"],
  BATAS_QTY_RESEP: ["menu_components.qty", "ingredient_components.qty"],
  // Tak ada medan permintaan yang mengisinya — HPP lahir dari resep × qty ×
  // harga bahan. Ia tetap diklaim di sini karena `pastikanMuat` memakai
  // konstantanya di tempat angkanya dihitung (lihat `luapan-turunan.test.ts`).
  BATAS_HPP: ["sales.total_hpp", "sale_items.hpp_satuan"],
};

/**
 * Kolom numeric yang TIDAK diklaim konstanta mana pun, berikut alasannya.
 *
 * Dua kelompok, dan bedanya penting:
 *   · nilainya lahir DI SERVER (hasil hitungan/salinan) — tak ada medan
 *     permintaan yang bisa dibatasi;
 *   · batasnya literal karena artinya bisnis, bukan kapasitas kolom (persen,
 *     koordinat, pengali) — dan literalnya tetap diperiksa lewat `PETA`.
 */
const TAK_DIKLAIM: Record<string, string> = {
  "sales.diskon_persen": "diturunkan dari diskon & subtotal",
  "sale_items.line_total": "hasil hitungan",
  "open_bill_items.harga_satuan": "salinan harga menu saat itu",
  "menu_price_logs.harga_baru": "salinan menus.harga_jual",
  "menu_price_logs.harga_lama": "salinan menus.harga_jual",
  "branches.latitude": "koordinat — batasnya derajat (±90), bukan kapasitas kolom",
  "branches.longitude": "koordinat — batasnya derajat (±180), bukan kapasitas kolom",
  "companies.pb1_rate": "persen — batas bisnis 100",
  "companies.diskon_maks_persen": "persen — batas bisnis 100",
  "companies.food_cost_maks": "persen — batas bisnis 100",
  "ingredients.overhead_x": "pengali biaya — batas bisnis 1000",
};

/**
 * Nama medan ber-`.max()` yang BUKAN nama kolom numeric mana pun, berikut
 * putusannya. Ditulis per NAMA (bukan per situs) supaya daftarnya tetap terbaca.
 *
 * Ini juga BATAS penjaga ini yang paling penting: penjodohan nama tak melihat
 * medan yang namanya berbeda dari kolomnya (`jumlah` → productions.qty,
 * `harga` → total_harga, `porsi` → qty hasil kali). Yang bisa dijamin di sini
 * cuma bahwa daftarnya tak bertambah tanpa keputusan.
 */
const BUKAN_KOLOM: Record<string, string> = {
  sort_order: "kolom integer",
  urutan: "kolom integer",
  pos_x: "kolom integer",
  pos_y: "kolom integer",
  port: "kolom integer",
  radius_absen_m: "kolom integer",
  masa_simpan_hari: "kolom integer",
  lead_time_hari: "kolom integer",
  per_hari: "kolom integer",
  target_durasi_detik: "kolom integer",
  lat: "tak disimpan — hanya diadu dengan radius cabang",
  lng: "tak disimpan — hanya diadu dengan radius cabang",
  harga_per_unit: "→ productions.total_harga / supply_mutations.total_harga (14,2)",
  harga: "→ productions.total_harga (14,2)",
  dana_cair: "→ faktur_dana.nominal (14,2)",
  realisasi: "→ faktur_dana.nominal (14,2)",
  diskon_nilai: "→ sales.diskon (14,2)",
  qty_diterima: "→ productions.qty (16,6)",
  jumlah: "jumlah BATCH — dikalikan isi bahan sebelum jadi productions.qty",
  porsi: "jumlah PORSI — dikalikan takaran resep sebelum jadi qty",
};

type Situs = { berkas: string; baris: number; medan: string; arg: string; batas: number };

export function situsMax(kode?: { nama: string; isi: string }[]): Situs[] {
  const berkas =
    kode ??
    AKAR.flatMap((a) => berkasTs(a).map((p) => ({ nama: p.split("/src/")[1], isi: readFileSync(p, "utf8") })));
  const nilai = BATAS as unknown as Record<string, number>;
  const keluar: Situs[] = [];
  for (const { nama, isi: mentah } of berkas) {
    // Prosa `batas-angka.ts` menyebut `z.number()` sebagai contoh; membaca kode
    // bersama komentarnya membuat penjaga menuduh tulisannya sendiri.
    const s = butaKomentar(mentah);
    for (const m of s.matchAll(/(\w+):\s*z\.number\(\)((?:\s*\.\w+\([^()]*\))*)/g)) {
      const mm = /\.max\(\s*([^)]*?)\s*\)/.exec(m[2]);
      if (!mm) continue;
      const arg = mm[1];
      const batas = /^BATAS_\w+$/.test(arg) ? nilai[arg] : Number(arg.replace(/_/g, ""));
      if (!Number.isFinite(batas)) continue;
      keluar.push({
        berkas: nama,
        baris: s.slice(0, m.index!).split("\n").length,
        medan: m[1],
        arg,
        batas,
      });
    }
  }
  return keluar;
}

describe("batas angka ikut presisi kolomnya", () => {
  const kap = kapasitasKolom();
  const situs = situsMax();

  it("premis: schema.ts & sapuannya benar-benar terbaca", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat seluruh berkas ini hijau
    // dengan populasi nol — izin terbuka, bukan penjagaan.
    expect(kap.size, "kolom numeric ber-presisi di schema.ts").toBeGreaterThan(50);
    expect(situs.length, "medan z.number() ber-.max()").toBeGreaterThan(90);
  });

  it("tiap konstanta = bilangan bulat terbesar yang muat di kolom TERSEMPIT-nya", () => {
    const nilai = BATAS as unknown as Record<string, number>;
    for (const [nama, kolom] of Object.entries(KOLOM)) {
      const kaps = kolom.map((k) => {
        const c = kap.get(k);
        expect(c, `${nama}: kolom ${k} tak ada di schema.ts`).toBeDefined();
        return { k, ...c! };
      });
      const sempit = kaps.reduce((a, b) => (b.maks < a.maks ? b : a));
      expect(
        nilai[nama],
        `${nama} harus sama dengan kapasitas ${sempit.k} numeric(${sempit.p},${sempit.s})`,
      ).toBe(sempit.maks);
    }
  });

  it("KELENGKAPAN: tiap kolom numeric diklaim konstanta atau punya alasan", () => {
    const diklaim = new Set(Object.values(KOLOM).flat());
    const yatim = [...kap.keys()].filter((k) => !diklaim.has(k) && !(k in TAK_DIKLAIM));
    expect(
      yatim,
      "kolom numeric baru tanpa keputusan — masukkan ke KOLOM (bila diisi medan permintaan) " +
        "atau ke TAK_DIKLAIM dengan alasannya",
    ).toEqual([]);
    // …dan ke arah sebaliknya: alasan yang sudah tak menunjuk kolom mana pun
    // adalah keterangan basi yang menyamar jadi keputusan.
    expect(
      Object.keys(TAK_DIKLAIM).filter((k) => !kap.has(k)),
      "alasan TAK_DIKLAIM menunjuk kolom yang sudah tak ada",
    ).toEqual([]);
    expect([...diklaim].filter((k) => !kap.has(k)), "KOLOM menunjuk kolom yang sudah tak ada").toEqual([]);
  });

  it("INTI: tiap `.max()` muat di kolom tujuannya", () => {
    const pelanggar: string[] = [];
    for (const s of situs) {
      const kunci = `${s.berkas}|${s.medan}`;
      const kolom = PETA[kunci];
      if (!kolom) continue; // ditagih uji KELENGKAPAN di bawah
      const c = kap.get(kolom)!;
      if (s.batas > c.maks) {
        pelanggar.push(
          `${s.berkas}:${s.baris} ${s.medan} .max(${s.arg}=${s.batas}) > ${kolom} numeric(${c.p},${c.s}) = ${c.maks}`,
        );
      }
    }
    expect(
      pelanggar,
      "batas Zod melebihi kapasitas kolomnya — nilai di antaranya lolos 400 lalu JATUH 500 di Postgres. " +
        "Terukur pada dua pintu resep: 100.000.000 → HTTP 500, 99.999.999 → 201.\n" +
        pelanggar.join("\n"),
    ).toEqual([]);
  });

  it("KELENGKAPAN: tiap medan ber-.max() punya kolom atau putusan tertulis", () => {
    const namaKolom = new Set([...kap.keys()].map((k) => k.split(".")[1]));
    const tanpaPutusan: string[] = [];
    for (const s of situs) {
      const kunci = `${s.berkas}|${s.medan}`;
      if (PETA[kunci]) continue;
      if (!namaKolom.has(s.medan) && s.medan in BUKAN_KOLOM) continue;
      tanpaPutusan.push(`${s.berkas}:${s.baris} ${s.medan} .max(${s.arg})`);
    }
    expect(
      tanpaPutusan,
      "medan angka baru tanpa pemetaan — tambahkan ke PETA (bila masuk kolom numeric) " +
        "atau ke BUKAN_KOLOM dengan alasannya",
    ).toEqual([]);
    // Peta yang menyebut berkas/medan yang sudah tak ada adalah peta yang
    // pelan-pelan berhenti berarti apa-apa.
    const hidup = new Set(situs.map((s) => `${s.berkas}|${s.medan}`));
    expect(
      Object.keys(PETA).filter((k) => !hidup.has(k)),
      "entri PETA basi — medannya sudah tak ada",
    ).toEqual([]);
    const namaHidup = new Set(situs.map((s) => s.medan));
    expect(
      Object.keys(BUKAN_KOLOM).filter((k) => !namaHidup.has(k)),
      "entri BUKAN_KOLOM basi — medannya sudah tak ada",
    ).toEqual([]);
  });

  it("kedua pintu resep memakai BATAS_QTY_RESEP, bukan batas stok", () => {
    // Source-pin pada bug yang melahirkan berkas ini. Keduanya `numeric(12,4)`
    // dan keduanya sempat memakai batas `numeric(16,6)` — 100× kolomnya.
    for (const f of ["modules/menu/routes.ts", "modules/bahan/routes.ts"] as const) {
      const isi = butaKomentar(readFileSync(join(SRC, f), "utf8"));
      const komponen = [...isi.matchAll(/qty:\s*z\.number\(\)[^,\n]*\.max\((\w+)\)/g)].map((m) => m[1]);
      expect(komponen, `${f}: takaran resep harus dibatasi BATAS_QTY_RESEP`).toContain("BATAS_QTY_RESEP");
    }
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh yang sah", () => {
    const buat = (isi: string) => situsMax([{ nama: "uji.ts", isi }]);
    expect(buat("const B = z.object({ qty: z.number().positive().max(BATAS_QTY_STOK) });")).toHaveLength(1);
    expect(buat("const B = z.object({ qty: z.number().positive().max(BATAS_QTY_STOK) });")[0].batas).toBe(
      BATAS.BATAS_QTY_STOK,
    );
    expect(buat("const B = z.object({ n: z.number().max(86_400) });")[0].batas, "literal ber-_").toBe(86_400);
    // Tanpa `.max()` bukan urusan berkas ini — itu milik angka-berbatas-atas.
    expect(buat("const B = z.object({ n: z.number().positive() });")).toHaveLength(0);
    // Prosa yang MENJELASKAN aturan ini tak boleh ikut terhitung.
    expect(buat("/* contoh: qty: z.number().max(BATAS_QTY_STOK) */"), "komentar tak boleh terbaca").toHaveLength(
      0,
    );
    // …dan aturan INTI-nya memang menyalahkan batas yang kebesaran.
    const c = kapasitasKolom().get("menu_components.qty")!;
    expect(BATAS.BATAS_QTY_STOK > c.maks, "premis bukti merah: batas stok memang > kolom resep").toBe(true);
    expect(BATAS.BATAS_QTY_RESEP).toBe(c.maks);
  });
});
