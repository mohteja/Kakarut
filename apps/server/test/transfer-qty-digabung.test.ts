import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga BATAS QTY TRANSFER — dihitung atas JUMLAH per bahan, bukan per baris.
 *
 * Form transfer stok menulis janjinya sendiri di komentar `salahKemasan`:
 * aturan server dicermin "supaya form tak pernah menjanjikan sesuatu yang
 * nanti ditolak POST /transfer-stok". Dua dari tiga aturan memang dicermin —
 * kelipatan kemasan dan batas qty — tapi yang KEDUA dicermin setengah.
 *
 * Server MENGGABUNGKAN baris bahan yang sama lebih dulu ("Gabungkan baris
 * bahan yang sama (qty dijumlah) → satu baris per bahan") lalu membandingkan
 * TOTALNYA dengan `saldo − dalam_jalan`. Pemeriksaan per baris di klien tak
 * melihat itu: dua baris bahan yang sama, masing-masing 60 dari 100 yang
 * tersedia, lolos sendiri-sendiri padahal berjumlah 120.
 *
 * Yang menekan Kirim lalu menerima 400 yang menyebut angka total — angka yang
 * tak sama dengan baris mana pun di layar — jadi ia tak punya cara tahu baris
 * mana yang harus dikecilkan.
 *
 * Aturan KEMASAN sengaja tetap per baris: kelipatan tertutup terhadap
 * penjumlahan, jadi tak ada kasus yang lolos per baris tapi gagal digabung.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const HAL = baca("../../web/src/pages/stok/TransferStokPage.tsx");
const RUTE = baca("../src/modules/transfer/routes.ts");

describe("premis: server menggabungkan dulu, baru membandingkan", () => {
  it("baris bahan yang sama dijumlah jadi satu", () => {
    expect(RUTE).toContain(
      "qtyByIng.set(it.ingredient_id, (qtyByIng.get(it.ingredient_id) ?? 0) + it.qty);",
    );
  });

  it("dan batasnya dipatok atas TOTAL itu, bukan per baris kiriman", () => {
    expect(RUTE).toContain("for (const [ingId, qty] of qtyByIng) {");
    expect(RUTE).toContain("if (!s || qty > tersedia + 1e-9) {");
  });

  it("batas yang dipakai memotong barang yang sedang di jalan", () => {
    expect(RUTE).toContain("const tersedia = (s?.saldo ?? 0) - diJalan;");
  });

  it("premis kedua: form ini memang berjanji mencerminkan aturan server", () => {
    expect(HAL).toContain("supaya form\n   * tak pernah menjanjikan sesuatu yang nanti ditolak");
  });
});

describe("klien memakai jumlah per bahan", () => {
  it("qty dijumlahkan per `ingredient_id` lebih dulu", () => {
    expect(HAL).toContain("const totalPerBahan = useMemo(() => {");
    expect(HAL).toContain("m.set(b.ingredient_id, (m.get(b.ingredient_id) ?? 0) + q);");
  });

  it("dan yang dibandingkan ke `tersediaDari` adalah total itu", () => {
    expect(HAL).toMatch(
      /\.filter\(\(\[id, total\]\) => \{\s*\n\s*const s = saldoById\.get\(id\);\s*\n\s*return s != null && total > tersediaDari\(s\) \+ 1e-9;/,
    );
  });

  it("bentuk lama (per baris) sudah tidak ada", () => {
    expect(HAL).not.toMatch(/const adaQtyLebih = baris\.some\(/);
  });

  it("baris kosong / qty tak terbaca tidak ikut dijumlah", () => {
    // NaN dan 0 sudah punya penjaganya sendiri (`qtyTerbuang`); menjumlahkannya
    // di sini hanya akan menyembunyikan pesan yang lebih tepat.
    expect(HAL).toContain("if (!b.ingredient_id || !(q > 0)) continue;");
  });
});

describe("pesannya menyebut bahan mana — karena barisnya tak kelihatan salah", () => {
  it("nama bahan yang melebihi batas dikumpulkan", () => {
    expect(HAL).toContain("const bahanQtyLebih = [...totalPerBahan.entries()]");
    expect(HAL).toContain("const adaQtyLebih = bahanQtyLebih.length > 0;");
  });

  it("dan ditampilkan, bukan cuma 'ada jumlah yang melebihi'", () => {
    expect(HAL).toContain("{bahanQtyLebih.join(\", \")}");
    expect(HAL).toContain("dihitung");
    expect(HAL).toContain("dari total semua barisnya");
  });

  it("tombol Kirim tetap dikunci olehnya", () => {
    expect(HAL).toContain("!adaQtyLebih &&");
  });
});

describe("yang SENGAJA tetap per baris", () => {
  it("aturan kemasan — kelipatan tertutup terhadap penjumlahan", () => {
    expect(HAL).toContain(
      "const adaSalahKemasan = baris.some((b) => salahKemasan(saldoById.get(b.ingredient_id), b.qty));",
    );
  });

  it("dan alasannya ditulis, bukan disimpan di kepala", () => {
    expect(HAL).toContain("kelipatan tertutup terhadap");
  });
});
