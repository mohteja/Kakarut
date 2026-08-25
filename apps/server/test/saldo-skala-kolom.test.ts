import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import {
  keSkalaKolom,
  SKALA_QTY_PERLENGKAPAN,
  SKALA_QTY_STOK_KOLOM,
  toleransiBanding,
} from "../src/lib/batas-angka";

/**
 * SALDO YANG DISUSUN DI JS DARI BEBERAPA `SUM(...)::float8`.
 *
 * Postgres menjumlahkan `numeric` secara EKSAK, jadi SATU `SUM(…)::float8`
 * dibulatkan sekali dan tetap sepadan dengan angka yang dikirim klien —
 * itulah kenapa membandingkan permintaan klien dengan satu saldo hasil SUM
 * memang tak butuh toleransi (diukur: `pakai 0,8` atas saldo 0,7+0,1 → 200).
 *
 * Yang TIDAK sepadan: saldo yang disusun DI JS dari dua nilai float8 yang
 * masing-masing sudah dibulatkan sendiri. `saldoDiRakPerlengkapan` =
 * `SUM(mutasi)::float8 − SUM(dalam_jalan)::float8`, dan terukur lewat HTTP
 * (2026-08-25, mutasi 0,3 · kiriman menunggu 0,1):
 *
 *   SEBELUM  POST /perlengkapan/:id/pakai qty 0,2 → 400
 *              "Stok tidak cukup (saldo 0.19999999999999998 pak)"
 *            POST /perlengkapan/:id/minta qty 0,2 → 400
 *              "Stok CK tidak cukup (siap kirim 0.19999999999999998 …)"
 *   SESUDAH  keduanya 200/ok; pasangannya (minta 0,25 & pakai 0,05 saat rak
 *            benar-benar habis) tetap 400, dengan angka bersih "0"
 *
 * Dua kerusakan sekaligus: sisa yang ADA tak bisa dihabiskan, dan derau
 * float ikut tercetak di pesan yang dibaca petugas.
 *
 * Pembulatan ke skala kolom bukan toleransi karangan — qty perlengkapan
 * memang `numeric(16,3)`, jadi tiga desimal adalah SELURUH presisi yang
 * pernah ada di data itu.
 */
const SERVICE = butaKomentar(
  readFileSync(
    fileURLToPath(new URL("../src/modules/perlengkapan/service.ts", import.meta.url)),
    "utf8",
  ),
);

describe("saldo disusun di JS: dikembalikan ke skala kolom", () => {
  it("DETEKTOR TERBUKTI: selisih float memang meleset ke BAWAH tanpa pembulatan", () => {
    // Kalau premis ini tak bisa gagal, seluruh vena ini tak menyatakan apa pun.
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(0.3 - 0.1).toBeLessThan(0.2);
    expect(2 - 1.1).toBeLessThan(0.9);
    // …dan pembulatan ke skala kolom memulihkannya
    expect(keSkalaKolom(0.3 - 0.1, SKALA_QTY_PERLENGKAPAN)).toBe(0.2);
    expect(keSkalaKolom(2 - 1.1, SKALA_QTY_PERLENGKAPAN)).toBe(0.9);
  });

  it("keSkalaKolom tidak mengubah nilai yang memang muat di kolomnya", () => {
    for (const n of [0, 1, 0.5, 12.345, 9_999_999.999, -0.25]) {
      expect(keSkalaKolom(n, SKALA_QTY_PERLENGKAPAN)).toBe(n);
    }
    // Bukan pembulatan yang menelan permintaan berlebih: 0,2005 tetap > 0,2
    expect(keSkalaKolom(0.2005, SKALA_QTY_PERLENGKAPAN)).toBeGreaterThan(0.2);
    // Nilai tak hingga dibiarkan apa adanya (bukan jadi 0 diam-diam)
    expect(keSkalaKolom(Number.NaN, 3)).toBeNaN();
  });

  it("SKALA cocok dengan kolomnya — 3 desimal, bukan angka yang dikarang", () => {
    // `supply_mutations.qty` & `supply_transfers.qty` = numeric(16,3).
    expect(SKALA_QTY_PERLENGKAPAN).toBe(3);
  });

  it("kedua penyusun saldo di JS memakainya", () => {
    expect(
      SERVICE,
      "saldo rak kembali mentah — pintu `pakai` menolak sisa yang ADA " +
        "(terukur 400 atas 0.19999999999999998)",
    ).toContain("keSkalaKolom(v, SKALA_QTY_PERLENGKAPAN)");
    expect(
      SERVICE,
      "`siapKirim` kembali mentah — pintu `minta` menolak sisa yang siap kirim",
    ).toContain("keSkalaKolom(saldoCk - dalamJalan, SKALA_QTY_PERLENGKAPAN)");
  });

  it("PASANGAN: toleransi pintu KEBUTUHAN tak ikut dihapus (kelas lain)", () => {
    // `stok`/`produksi` membandingkan KEBUTUHAN yang dihitung JS (resep ×
    // batch, konversi satuan) — di sana toleransi memang jawabannya, dan
    // menghapusnya sambil "menyeragamkan" akan merusak yang sudah benar.
    //
    // Yang dijaga NIATNYA ("pembandingnya masih bertoleransi"), bukan ejaan
    // angkanya: vena B⁷ mengganti `1e-9`/`1e-6` yang dipilih dengan perasaan
    // menjadi `toleransiBanding` yang diturunkan dari skala kolom + lantai
    // derau float — sebab `1e-9` terukur BERHENTI BERARTI pada besaran ≥ 10⁷
    // (ULP 1,86e-9) dan menolak penjualan yang stoknya persis cukup.
    const STOK = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/modules/stok/service.ts", import.meta.url)), "utf8"),
    );
    const KONSUMSI = butaKomentar(
      readFileSync(
        fileURLToPath(new URL("../src/modules/produksi/konsumsi.ts", import.meta.url)),
        "utf8",
      ),
    );
    expect(STOK, "pembanding kebutuhan kehilangan toleransinya").toMatch(
      /r\.saldo < perlu - toleransiBanding\(/,
    );
    expect(KONSUMSI, "pembanding kebutuhan produksi kehilangan toleransinya").toMatch(
      /req\.butuh - tersedia > toleransiBanding\(/,
    );
  });
});

/**
 * TOLERANSI YANG DIUKUR, BUKAN DIRASA (vena B⁷).
 *
 * Tiga pintu memakai angka firasat (`1e-9` dua kali, `1e-6` sekali) tanpa
 * satu pengukuran di baliknya, sementara `EPS_KAS = 0.005` di jalur kas
 * sudah menulis asalnya ("pembulatan numeric(…,2)" — setengah unit kolom).
 *
 * Diukur (2026-08-25):
 *  · drift `SUM(qty)::float8` pada 1 rb / 10 rb / 30 rb baris pecahan =
 *    5,7e-15 · 4,5e-14 · 0 — TIDAK tumbuh dengan N (satu pembulatan di cast),
 *    dengan instrumen yang lolos uji-mandiri (versi pertama membandingkan
 *    float8 dengan numeric → Postgres menaikkan numeric ke float8 → nol
 *    secara konstruksi; versi kedua lewat `::numeric(40,25)` juga buta
 *    karena Postgres memakai representasi terpendek);
 *  · yang tumbuh justru sisi KEBUTUHAN yang ditumpuk di JS lintas baris:
 *    500 baris × (0,01 × 49.157) = 245.785,00000000253 vs saldo 245.785,
 *    dan penjualannya DITOLAK lewat HTTP: "sisa 245.785 gr, butuh 245.785";
 *  · ULP double pada 10⁷ = 1,86e-9 — `1e-9` berhenti berarti di sana, dan
 *    `BATAS_QTY_STOK` (≈10¹⁰) ada DI DALAM rentang yang skema izinkan.
 */
describe("toleransi banding: diturunkan, bukan dirasa", () => {
  const ulp = (x: number) => 2 ** (Math.ceil(Math.log2(Math.abs(x))) - 53);

  it("DETEKTOR TERBUKTI: `1e-9` memang berhenti berarti di besaran yang diizinkan skema", () => {
    // Kalau premis ini tak bisa gagal, seluruh vena ini tak menyatakan apa pun.
    expect(ulp(1e6)).toBeLessThan(1e-9);
    expect(ulp(1e7)).toBeGreaterThan(1e-9); // ← di sini toleransi lama mati
    expect(ulp(1e10)).toBeGreaterThan(1e-6); // ← dan yang 1e-6 juga
    // Pembantunya tidak: ia ikut naik bersama besarannya.
    expect(toleransiBanding(1e7, SKALA_QTY_STOK_KOLOM)).toBeGreaterThan(ulp(1e7));
    expect(toleransiBanding(1e10, SKALA_QTY_STOK_KOLOM)).toBeGreaterThan(ulp(1e10));
  });

  it("menutupi drift akumulasi yang TERUKUR (500 baris × 0,01 × 49.157)", () => {
    let perlu = 0;
    for (let i = 0; i < 500; i += 1) perlu += 0.01 * 49157;
    const saldo = 245785; // eksak dari SQL
    expect(perlu).toBeGreaterThan(saldo); // drift ke ATAS — inilah yang menolak
    // Gerbang LAMA menolak; gerbang BARU tidak.
    expect(saldo < perlu - 1e-9).toBe(true);
    expect(saldo < perlu - toleransiBanding(perlu, SKALA_QTY_STOK_KOLOM)).toBe(false);
  });

  it("PASANGAN: kekurangan sebesar SATU unit kolom tetap tertangkap", () => {
    // Toleransi yang terlalu besar menelan kekurangan nyata — kerusakan yang
    // lebih sunyi daripada yang diperbaiki. Satu unit kolom qty stok = 1e-6.
    for (const saldo of [1, 100, 12_345, 245_785, 1_000_000]) {
      const perlu = saldo + 1e-6;
      expect(
        saldo < perlu - toleransiBanding(perlu, SKALA_QTY_STOK_KOLOM),
        `kekurangan 1e-6 pada saldo ${saldo} ikut tertelan toleransi`,
      ).toBe(true);
    }
  });

  it("ketiga situs memakai pembantunya — bukan angka firasat", () => {
    const berkas = [
      "../src/modules/stok/service.ts",
      "../src/modules/stok/routes.ts",
      "../src/modules/produksi/konsumsi.ts",
    ];
    for (const b of berkas) {
      const src = butaKomentar(readFileSync(fileURLToPath(new URL(b, import.meta.url)), "utf8"));
      expect(src, `${b}: toleransi firasat kembali`).not.toMatch(/[-+]\s*1e-[69]\b/);
      expect(src, `${b}: tak memakai toleransiBanding`).toContain("toleransiBanding(");
    }
  });

  it("PASANGAN: EPS_KAS TIDAK ikut diseragamkan — kelasnya uang, dan sudah benar", () => {
    const shift = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/modules/shift/routes.ts", import.meta.url)), "utf8"),
    );
    expect(shift).toContain("EPS_KAS = 0.005");
  });
});
