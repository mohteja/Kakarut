import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HTTPException } from "hono/http-exception";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { galatDataKlien, nilaiTakSah } from "../src/lib/pg-galat";
import { BATAS_HPP, BATAS_QTY_STOK, BATAS_UANG, pastikanMuat } from "../src/lib/batas-angka";
import { kapasitasKolom, PETA } from "./util/kolom-numerik";

/**
 * LUAPAN TURUNAN — angka yang lahir DI SERVER, tempat `.max()` tak menolong.
 *
 * Vena sebelumnya memastikan tiap `.max()` cocok dengan kolom tujuannya. Ia
 * menulis batasnya sendiri: itu hanya berlaku untuk medan yang DIISI
 * permintaan. **Tiga puluh dua dari 62** kolom `numeric` di skema ini tidak —
 * isinya hasil perkalian, penjumlahan, atau selisih. Batas masukan yang
 * sempurna pun tak menjaganya, karena yang meluap bukan masukannya.
 *
 * TERUKUR lewat HTTP terhadap Postgres sungguhan, sebelum perbaikan:
 *
 *     POST /penjualan  menu Rp 10.000 × qty 99.999.999    → 201
 *     POST /penjualan  menu Rp 20.000 × qty 99.999.999    → **HTTP 500**
 *     POST /penjualan  menu Rp 1 jt   × qty 1.000.000     → **HTTP 500**
 *     POST /penjualan  TIGA baris yang masing-masing MUAT → **HTTP 500**
 *
 * Baris terakhir itu intinya, dan ia tak bisa dijaga di sisi masukan sama
 * sekali: setiap medan sah, setiap baris muat di kolomnya, dan penjualannya
 * tetap jatuh 500 karena JUMLAHNYA tidak.
 *
 * DUA LAPIS, dan keduanya dibuktikan sendiri-sendiri lewat HTTP:
 *
 *   · pintu keluar bersama (`app.onError` → `galatDataKlien`) mengubah 22003
 *     jadi 400 yang bisa dibaca **di setiap rute sekaligus**. Dengan seluruh
 *     penjaga lokal dicabut, permintaan yang sama dibalas
 *     `400 {"error":"Angkanya terlalu besar untuk disimpan"}` — bukan 500;
 *   · penjaga di tempat angkanya lahir (`pastikanMuat`) menyebut MEDANNYA:
 *     `400 Total baris "Luap B" terlalu besar untuk disimpan (maksimal
 *     999.999.999.999)`. Pintu keluar bersama tak pernah tahu angka yang mana,
 *     dan kasir yang berdiri di depan tamu perlu tahu baris mana.
 *
 * Argumen untuk lapis pertama bukan karanganku: `lib/pg-galat.ts` sudah
 * menuliskannya untuk saudaranya `22P02` — "menyalin saringan ke 137 tempat
 * sisanya bukan perbaikan, itu daftar tugas yang tak akan selesai". Argumen itu
 * dijalankan untuk SATU kode SQLSTATE, dan kode di sebelahnya — yang sudah
 * punya kalimatnya di berkas yang sama — dibiarkan keluar sebagai 500.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const baca = (rel: string) => butaKomentar(readFileSync(join(SRC, rel), "utf8"));

/**
 * Kolom numeric yang TIDAK diisi medan permintaan — komplemen `PETA`.
 *
 * Dihitung, bukan didaftar: daftar tangan kedua akan menyimpang dari yang
 * pertama, dan vena "daftar tabel ditulis tangan" sudah membayarnya sekali
 * (`customers` yang tak ada di daftar → balasan 1,61 MB tak pernah tertuduh).
 */
function kolomTurunan(): string[] {
  const dariBadan = new Set(Object.values(PETA));
  return [...kapasitasKolom().keys()].filter((k) => !dariBadan.has(k)).sort();
}

/**
 * Tiap kolom turunan: DIJAGA (dengan sebutan penjaganya) atau BERALASAN.
 *
 * "Beralasan" di sini bukan "belum sempat". Tiga bentuk yang memang tak bisa
 * meluap, dan masing-masing bisa diperiksa:
 *   · SALINAN kolom berpresisi sama atau lebih sempit;
 *   · tujuan yang LEBIH LEBAR dari sumbernya;
 *   · nilai yang TERKURUNG oleh baris yang sudah tersimpan (refund tak bisa
 *     melebihi notanya, selisih opname tak bisa melebihi saldo).
 */
const PUTUSAN: Record<string, string> = {
  // ── dijaga `pastikanMuat` di tempat angkanya lahir ──────────────────────
  "sale_items.line_total": "DIJAGA pastikanMuat(lineTotal, BATAS_UANG)",
  "sale_items.hpp_satuan": "DIJAGA pastikanMuat(hppSatuan, BATAS_HPP)",
  "sales.subtotal": "DIJAGA pastikanMuat(subtotal, BATAS_UANG)",
  "sales.total": "DIJAGA pastikanMuat(total, BATAS_UANG)",
  "sales.total_hpp": "DIJAGA pastikanMuat(totalHpp, BATAS_HPP)",
  "sale_consumptions.qty": "DIJAGA pastikanMuat(konsumsi, BATAS_QTY_STOK)",
  // ── terkurung nilai yang sudah tersimpan ────────────────────────────────
  "sales.diskon": "dijepit [0, subtotal] yang sudah dijaga",
  "sales.pb1_amount": "hitungPb1 atas subtotal net yang sudah dijaga; `total` diperiksa sesudahnya",
  "sales.subtotal_asal": "salinan sales.subtotal saat refund pertama",
  "sales.diskon_asal": "salinan sales.diskon",
  "sales.pb1_asal": "salinan sales.pb1_amount",
  "sales.refund_total": "jumlah refund, tak pernah melebihi sales.total",
  "sales.diskon_persen": "persen, dijepit [0, 100] — kolomnya numeric(5,2)",
  "sale_refunds.nominal": "bagian dari sales.total baris yang direfund",
  "sale_refunds.qty": "tak pernah melebihi sale_items.qty",
  "sale_items.qty_refund": "akumulasi refund, dijepit ke sale_items.qty",
  "stock_opnames.selisih": "qty − system_qty; keduanya numeric(16,6) yang sama",
  "stock_opnames.system_qty": "saldo terhitung dari baris yang sudah tersimpan",
  "supply_mutations.system_qty": "saldo terhitung dari baris yang sudah tersimpan",
  "productions.qty_dipesan": "salinan productions.qty (kolom yang sama persis)",
  // ── salinan / tujuan lebih lebar ────────────────────────────────────────
  "menu_price_logs.harga_baru": "salinan menus.harga_jual — numeric(12,2) ke numeric(12,2)",
  "menu_price_logs.harga_lama": "salinan menus.harga_jual — presisi sama",
  "menu_price_logs.mult_baru": "salinan menus.mult — numeric(7,3) ke numeric(7,3)",
  "menu_price_logs.mult_lama": "salinan menus.mult — presisi sama",
  "open_bill_items.harga_satuan": "dari menus.harga_jual numeric(12,2) ke kolom numeric(14,2) yang LEBIH LEBAR",
  "sale_items.harga_satuan": "dari menus.harga_jual — presisi sama numeric(12,2)",
  "faktur_dana.nominal": "dari medan dana_cair/realisasi ber-BATAS_UANG — presisi sama",
  "supply_purchases.qty": "dari medan qty ber-BATAS_QTY_STOK ke numeric(16,3) yang lebih lebar",
  "supply_purchases.total_harga": "dari medan total_harga ber-BATAS_UANG — presisi sama",
  "supply_rules.qty": "dari medan qty ber-BATAS_QTY_STOK ke numeric(16,3) yang lebih lebar",
  "supply_transfers.qty": "dari medan qty ber-BATAS_QTY_STOK ke numeric(16,3) yang lebih lebar",
  "production_consumptions.qty":
    "resep × qty produksi; jalur produksi memakai qty yang sudah ber-BATAS_QTY_STOK dan kolomnya numeric(16,6) yang sama — BELUM diukur lewat HTTP, dan itu ditulis apa adanya di ledger",
};

describe("luapan turunan: angka yang lahir di server", () => {
  it("premis: kolom turunannya benar-benar terhitung", () => {
    // Tanpa ini, `PETA` yang gagal terbaca membuat daftar turunannya kosong
    // dan seluruh berkas ini hijau tanpa memeriksa apa pun.
    expect(kapasitasKolom().size, "kolom numeric di schema.ts").toBeGreaterThan(50);
    expect(kolomTurunan().length, "kolom yang tak diisi medan badan").toBeGreaterThan(25);
  });

  it("KELENGKAPAN: tiap kolom turunan DIJAGA atau punya alasan tertulis", () => {
    const tanpaPutusan = kolomTurunan().filter((k) => !(k in PUTUSAN));
    expect(
      tanpaPutusan,
      "kolom numeric baru yang lahir dari hitungan server, tanpa keputusan. " +
        "Beri penjaga `pastikanMuat` di tempat angkanya dihitung, atau tulis " +
        "alasan kenapa ia tak bisa meluap.\n" +
        tanpaPutusan.join("\n"),
    ).toEqual([]);
    // Alasan yang sudah tak menunjuk kolom mana pun adalah keterangan basi yang
    // menyamar jadi keputusan — persis bentuk yang membuat komentar tak bisa
    // dipercaya sebagai dokumentasi.
    const hidup = new Set(kolomTurunan());
    expect(
      Object.keys(PUTUSAN).filter((k) => !hidup.has(k)),
      "entri PUTUSAN basi — kolomnya sudah tak ada, atau sudah diisi medan badan",
    ).toEqual([]);
  });

  it("`createSale` benar-benar memanggil penjaganya di keenam titik", () => {
    // Source-pin, dibaca TANPA komentar: prosa di berkas ini menyebut
    // `pastikanMuat` berkali-kali, dan penjaga yang membaca penjelasannya
    // sendiri tak bisa gagal.
    const s = baca("modules/penjualan/service.ts");
    for (const pola of [
      /pastikanMuat\(lineTotal, BATAS_UANG/,
      /pastikanMuat\(hppSatuan, BATAS_HPP/,
      /pastikanMuat\(subtotal, BATAS_UANG/,
      /pastikanMuat\(totalHpp, BATAS_HPP/,
      /pastikanMuat\(total, BATAS_UANG/,
      /pastikanMuat\(qty, BATAS_QTY_STOK/,
    ]) {
      expect(s, `createSale kehilangan penjaga ${pola}`).toMatch(pola);
    }
  });

  it("pintu keluar bersama menerjemahkan 22003, dan HANYA yang tak ambigu", () => {
    const galat = (code: string) => ({ cause: { code } });
    expect(galatDataKlien(galat("22003"))).toBe("Angkanya terlalu besar untuk disimpan");
    // Kode di driver kadang di `err.code`, kadang di `err.cause.code` — pg
    // menaruhnya di `cause` lewat Drizzle, dan keduanya harus terbaca.
    expect(galatDataKlien({ code: "22003" })).toBe("Angkanya terlalu besar untuk disimpan");
    // Yang BUKAN kelas ini tetap 500. Menerjemahkan semua galat Postgres jadi
    // 400 akan menyembunyikan cacat server sungguhan di balik kalimat sopan.
    for (const kode of ["23505", "23503", "23514", "42P01", "40001"]) {
      expect(galatDataKlien(galat(kode)), `${kode} tak boleh diterjemahkan`).toBeNull();
    }
    // 22P02 punya pintunya sendiri yang sudah ada — jangan diambil alih.
    expect(galatDataKlien(galat("22P02"))).toBeNull();
    expect(nilaiTakSah(galat("22P02"))).toBe(true);

    const app = baca("app.ts");
    expect(app, "app.onError harus memakai galatDataKlien").toContain("galatDataKlien(err)");
    // Tetap dicatat sebagai 400, sama seperti perlakuan 22P02: yang berubah
    // labelnya, bukan keberadaannya di panel galat super admin.
    expect(app.split("galatDataKlien(err)")[1] ?? "").toContain("catatGalat(c, 400, err)");
  });

  it("22001 SENGAJA tak diterjemahkan — dan kini terukur kenapa: MUSTAHIL", () => {
    /*
     * Saat 22003 diterjemahkan, saudaranya 22001 ("teks terlalu panjang")
     * ditahan dengan alasan "keterjangkauannya belum diukur". Sekarang sudah:
     *
     *   · schema.ts: NOL kolom `varchar(n)` / `char(n)` — seluruh 127 kolom
     *     teks bertipe `text`, yang di Postgres tak berbatas panjang dan tak
     *     pernah melempar 22001;
     *   · NOL cast `::varchar(n)` / `::char(n)` di SQL mentah mana pun.
     *
     * Jadi 22001 mustahil secara struktural, dan menerjemahkannya berarti
     * mengubah 500 jadi 400 untuk jalur yang TIDAK ADA — menyembunyikan cacat
     * server sungguhan (mis. literal cacat buatan kode sendiri) di balik
     * kalimat sopan. Uji ini memaku keduanya: fakta skemanya DAN keputusannya.
     * Kolom varchar pertama yang lahir membuat paku ini merah dan menagih
     * keputusan baru — persis seperti kolom numeric baru menagih di atas.
     */
    const sk = readFileSync(join(SRC, "db/schema.ts"), "utf8");
    expect(sk, "kolom varchar berbatas pertama lahir — ukur ulang keterjangkauan 22001").not.toMatch(
      /varchar\(/,
    );
    expect(galatDataKlien({ cause: { code: "22001" } }), "22001 harus tetap null selama mustahil").toBeNull();
  });

  it("jalur NON-penjualan yang meluap tertangkap lapis pertama — terukur", () => {
    /*
     * Diukur lewat HTTP terhadap Postgres sungguhan (2026-08-24): bahan
     * produksi bertakaran resep 99.999.999 diproduksi qty 1.000 → konsumsi
     * 1e11, kolomnya `production_consumptions.qty` numeric(16,6) maks 9,99e9:
     *
     *     POST /produksi qty=1000      → 400 "Angkanya terlalu besar untuk disimpan"
     *     POST /produksi qty=1000000   → 400 (bukan 500)
     *
     * Tak ada 5xx yang tersisa di kelas ini. Batasnya tetap ditulis: balasan
     * lapis pertama TIDAK menyebut medannya — hanya jalur penjualan yang punya
     * `pastikanMuat` bernama, karena di sanalah kasir berdiri di depan tamu.
     * Yang dipaku di sini: terjemahannya tetap terpasang di app.onError, sebab
     * tanpa itu pengukuran di atas kembali jadi 500.
     */
    const app = baca("app.ts");
    expect(app).toContain("galatDataKlien(err)");
  });

  it("PASANGAN: `pastikanMuat` menolak yang meluap DAN meloloskan yang tepat di batas", () => {
    // Penjaga yang menolak data sah lebih merusak daripada bug yang dijaganya.
    expect(() => pastikanMuat(BATAS_UANG, BATAS_UANG, "Total")).not.toThrow();
    expect(() => pastikanMuat(0, BATAS_UANG, "Total")).not.toThrow();
    expect(() => pastikanMuat(-BATAS_UANG, BATAS_UANG, "Selisih")).not.toThrow();
    expect(() => pastikanMuat(BATAS_UANG + 1, BATAS_UANG, "Total")).toThrow(HTTPException);
    expect(() => pastikanMuat(Number.POSITIVE_INFINITY, BATAS_UANG, "Total")).toThrow(HTTPException);
    expect(() => pastikanMuat(Number.NaN, BATAS_UANG, "Total")).toThrow(HTTPException);
    // …dan pesannya menyebut MEDANNYA. Itu satu-satunya hal yang tak bisa
    // diberikan pintu keluar bersama.
    try {
      pastikanMuat(1e18, BATAS_QTY_STOK, 'Pemakaian bahan "Beras"');
      expect.unreachable("seharusnya melempar");
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(400);
      expect((e as HTTPException).message).toContain('Pemakaian bahan "Beras"');
      expect((e as HTTPException).message).toContain("9.999.999.999");
    }
    // Batas HPP memang kolom yang berbeda dari batas uang, walau angkanya sama
    // hari ini — konstanta terpisah supaya presisi salah satunya yang berubah
    // tak menyeret yang lain.
    expect(BATAS_HPP).toBe(kapasitasKolom().get("sales.total_hpp")!.maks);
    expect(BATAS_UANG).toBe(kapasitasKolom().get("sales.total")!.maks);
  });
});
