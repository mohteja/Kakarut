import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * STOK OPNAME: HITUNGAN FISIK TAK PERNAH MINUS — DAN YANG MINUS DISEBUT NAMANYA.
 *
 * Terukur di production 2026-09-02 (log galat panel super admin): `POST
 * /api/stok/opname` ditolak **54 kali dalam 29 menit** dari dua akun dengan
 * "items[0].qty: minimal 0; items[26].qty: minimal 0; items[35].qty: minimal
 * 0 (dan 3 isian lain)". Tangkapan layar ponsel pemilik menunjukkan sebabnya:
 * lembar konfirmasi memuat "nata de coco −100 → −100" dan "yakult −1 → −1" —
 * saldo sistem minus, tombol "= sistem" menyalinnya apa adanya, dan server
 * (benar) menolak. Petugas tak bisa menyimpan SO, dan pesan `items[26]` tak
 * menunjuk bahan mana pun.
 *
 * Servernya TIDAK diubah: `qty: z.number().min(0)` memang aturan yang benar.
 * Yang dijaga di sini adalah KLIEN: (1) "= sistem" tak pernah mengisi angka
 * minus; (2) baris minus menahan Simpan; (3) pesannya menyebut NAMA bahan.
 */
const HAL = butaKomentar(
  readFileSync(fileURLToPath(new URL("../../web/src/pages/stok/OpnamePage.tsx", import.meta.url)), "utf8"),
);

describe("opname web: stok fisik minus ditahan di klien, dengan nama bahannya", () => {
  it('"= sistem" mengisi paling sedikit 0, bukan saldo minus apa adanya', () => {
    expect(HAL).toContain("teksAngka(Math.max(0, s.saldo))");
    // Bentuk lama — menyalin saldo apa adanya — tak boleh kembali.
    expect(HAL).not.toContain("[s.ingredient_id]: teksAngka(s.saldo) }");
  });

  it("baris minus dikumpulkan dari isian yang terbaca angka", () => {
    expect(HAL).toMatch(/const negatif = diisi\.filter\(\(s\) => \{[\s\S]*?n < 0;[\s\S]*?\}\);/);
  });

  it("Simpan mati selagi ada baris minus", () => {
    const i = HAL.indexOf("Simpan Opname (");
    expect(i, "premis: tombol Simpan Opname ada").toBeGreaterThan(-1);
    const sebelum = HAL.slice(Math.max(0, i - 700), i);
    expect(sebelum).toMatch(/disabled=\{[\s\S]*?negatif\.length > 0[\s\S]*?\}/);
  });

  it("pesannya menyebut NAMA bahan — bukan items[26]", () => {
    expect(HAL).toContain("negatif.map((s) => s.nama).join(\", \")");
    expect(HAL).toContain("Stok fisik tidak boleh minus pada");
  });

  it("saldo sistem yang minus dijelaskan di barisnya", () => {
    expect(HAL).toMatch(/s\.saldo < 0 && \([\s\S]*?Saldo sistem minus/);
  });

  it("server tetap menolak minus — aturannya tak dilonggarkan demi klien", () => {
    const RUTE = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/modules/stok/routes.ts", import.meta.url)), "utf8"),
    );
    const i = RUTE.indexOf("const OpnameBody = z.object({");
    const j = RUTE.indexOf("}).strict();", i);
    expect(RUTE.slice(i, j)).toContain("qty: z.number().min(0).max(BATAS_QTY_STOK)");
  });
});
