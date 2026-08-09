import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * YANG SERENTAK MENJAWAB SAMA DENGAN YANG BERURUTAN.
 *
 * Dua sisa dari sapuan "menulis status tanpa mengikat pemeriksaannya ke
 * tulisan itu". Keduanya ringan — tak ada uang atau stok yang bergeser — tapi
 * keduanya membuat jalur serentak menjawab BERBEDA dari jalur berurutan, dan
 * itu yang membingungkan pemakainya.
 *
 * 1. TOLAK UNDANGAN. Sejak penerimaan mengunci barisnya (`FOR UPDATE`),
 *    penolakan yang datang bersamaan MENUNGGU kunci itu lalu — tanpa syarat
 *    status — menimpa `accepted` jadi `revoked`. Jejaknya bertentangan:
 *    membership-nya sah terbentuk, undangannya tercatat ditolak.
 *
 * 2. PUTUSAN SELISIH KAS SHIFT. Penjaganya SUDAH ada dan bahkan berkomentar
 *    ("dua owner menekan tombol bersamaan"), tapi hasilnya dibuang. Yang kalah
 *    dibalas 200 berisi keputusan LAWAN: ia menekan "Setujui" lalu menerima
 *    badan berbunyi "ditolak", tanpa satu pun tanda bahwa tekanannya tak
 *    berlaku — sementara percobaan berurutan dibalas 409 berpesan.
 *
 * Balapannya butuh dua transaksi serentak melawan Postgres, jadi yang dipatok
 * di sini SYARAT dan PEMERIKSAAN hasilnya.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const ONBOARDING = readFileSync(AKAR + "apps/server/src/modules/onboarding/routes.ts", "utf8");
const SHIFT = readFileSync(AKAR + "apps/server/src/modules/shift/routes.ts", "utf8");

describe("putusan serentak menjawab sama dengan berurutan", () => {
  it("tolak undangan membawa syarat 'pending' di WHERE-nya", () => {
    const i = ONBOARDING.indexOf('.post("/undangan/:id/tolak"');
    expect(i, "handler tolak undangan tak ditemukan").toBeGreaterThan(0);
    const blok = ONBOARDING.slice(i, i + 1600);
    expect(
      /eq\(invitations\.status, "pending"\)/.test(blok),
      "tolak undangan tanpa syarat status — bisa menimpa undangan yang baru saja DITERIMA",
    ).toBe(true);
  });

  it("tolak undangan tetap membalas ok (kalah balapan = no-op, bukan galat)", () => {
    /*
     * Undangan yang sudah diterima memang tak bisa ditolak lagi. Melempar galat
     * di sini akan mengubah perilaku jalur yang sudah ada tanpa alasan — cukup
     * tak melakukan apa-apa.
     */
    const i = ONBOARDING.indexOf('.post("/undangan/:id/tolak"');
    const blok = ONBOARDING.slice(i, i + 1600);
    expect(blok).toContain("return c.json({ ok: true })");
  });

  it("putusan selisih shift memeriksa hasil UPDATE-nya", () => {
    const i = SHIFT.indexOf("selisihStatus: body.status");
    expect(i, "penulisan putusan selisih tak ditemukan").toBeGreaterThan(0);
    const blok = SHIFT.slice(i, i + 1400);
    expect(blok).toMatch(/\.returning\(\{ id: shifts\.id \}\)/);
    expect(blok).toMatch(/if \(diputus\.length === 0\)/);
  });

  it("penolakannya memakai pesan yang SAMA dengan jalur berurutan", () => {
    // "sudah <status> — tidak bisa diputuskan lagi" sudah dipakai pemeriksaan
    // awal di handler yang sama; sebab baru akan terbaca asing oleh klien.
    const cocok = SHIFT.match(/tidak bisa diputuskan lagi/g) ?? [];
    expect(cocok.length, "pesan kalah-balapan harus sama dengan jalur berurutan").toBeGreaterThanOrEqual(2);
  });

  it("penjaga status pada putusan selisih tetap ada", () => {
    // Pemeriksaan hasil hanya bermakna kalau UPDATE-nya sendiri masih bersyarat.
    expect(SHIFT).toContain('eq(shifts.selisihStatus, "menunggu")');
  });
});
