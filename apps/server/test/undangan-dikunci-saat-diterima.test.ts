import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * UNDANGAN DIKUNCI SAAT DITERIMA.
 *
 * `terimaUndangan` membaca undangannya, menolak bila statusnya bukan `pending`,
 * lalu menyisipkan membership. Tanpa mengunci barisnya, penjaga itu hanya
 * menangkap percobaan BERURUTAN: dua penerimaan yang sama di saat bersamaan
 * sama-sama membaca `pending`, sama-sama tak menemukan membership, lalu
 * sama-sama menyisipkannya.
 *
 * DATANYA sendiri selamat — `memberships_user_company_uq` menolak yang kedua —
 * jadi yang rusak "cuma" pesannya: transaksinya rollback dan pemanggil menerima
 * 500, padahal jalur berurutan sudah lama membalas 400 "Undangan sudah tidak
 * berlaku". Itu sebabnya perbaikannya kecil, dan itu pula sebabnya ia tetap
 * layak dijaga: yang kalah harus melihat pesan yang benar, bukan galat server.
 *
 * Balapannya butuh dua transaksi serentak melawan Postgres, jadi yang dipatok
 * di sini KUNCI-nya, URUTAN kuncinya, dan penerjemahan `null` menjadi 400 —
 * tiga sifat yang tak bisa disimpulkan dari satu permintaan tunggal.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SERVICE = readFileSync(AKAR + "apps/server/src/modules/onboarding/service.ts", "utf8");
const ROUTES = readFileSync(AKAR + "apps/server/src/modules/onboarding/routes.ts", "utf8");

/** Badan `terimaUndangan` saja. */
const FN = (() => {
  const i = SERVICE.indexOf("export async function terimaUndangan");
  expect(i, "terimaUndangan tak ditemukan").toBeGreaterThan(0);
  return SERVICE.slice(i, SERVICE.indexOf("export async function autoTerimaUndanganEmail", i));
})();

describe("undangan: dikunci saat diterima", () => {
  it("undangan dibaca dengan FOR UPDATE", () => {
    // Inti perbaikannya. Tanpa kunci, penjaga `pending` di bawahnya cuma
    // menangkap percobaan yang datang SESUDAH yang pertama selesai.
    expect(
      /\.for\("update"\)/.test(FN),
      "SELECT undangan tanpa FOR UPDATE — dua penerimaan bisa sama-sama menyisipkan membership",
    ).toBe(true);
  });

  it("kunci diambil SEBELUM status pending diperiksa", () => {
    // Mengunci sesudah memeriksa tak ada gunanya: keputusannya sudah diambil
    // dari snapshot yang basi.
    const iKunci = FN.indexOf('.for("update")');
    const iJaga = FN.indexOf('inv.status !== "pending"');
    expect(iKunci, "FOR UPDATE tak ditemukan").toBeGreaterThan(0);
    expect(iJaga, "penjaga pending tak ditemukan").toBeGreaterThan(0);
    expect(iKunci < iJaga, "status diperiksa SEBELUM barisnya dikunci").toBe(true);
  });

  it("penerimaan massal mengunci dalam urutan yang PASTI", () => {
    /*
     * `autoTerimaUndanganEmail` mengunci banyak undangan dalam satu transaksi
     * dan menahannya sampai selesai. Tanpa urutan tetap, dua login serentak
     * milik orang yang sama bisa mengunci dua undangan dalam urutan berlawanan
     * dan saling menunggu — deadlock, yaitu galat BARU yang lahir justru dari
     * kunci yang baru dipasang.
     */
    const i = SERVICE.indexOf("export async function autoTerimaUndanganEmail");
    expect(i, "autoTerimaUndanganEmail tak ditemukan").toBeGreaterThan(0);
    expect(SERVICE.slice(i)).toMatch(/\.orderBy\(invitations\.id\)/);
  });

  it("yang kalah dibalas 400 dengan pesan yang SAMA, bukan dibiarkan lewat", () => {
    /*
     * `terimaUndangan` memulangkan null saat kalah. Membiarkannya lewat akan
     * memberi sesi TANPA companyId — memulangkan orang yang sebenarnya sudah
     * jadi anggota ke layar "belum punya perusahaan". Pesannya sengaja sama
     * dengan pemeriksaan awal supaya klien tak melihat perilaku baru.
     */
    const i = ROUTES.indexOf("terimaUndangan(tx, invId, auth.sub)");
    expect(i, "pemanggilan terimaUndangan di route tak ditemukan").toBeGreaterThan(0);
    const sesudah = ROUTES.slice(i, i + 900);
    expect(sesudah).toMatch(/if \(companyId === null\)/);
    expect(sesudah).toContain("Undangan sudah tidak berlaku");
    // Penerjemahannya harus mendahului pembuatan sesi.
    expect(sesudah.indexOf("companyId === null")).toBeLessThan(sesudah.indexOf("buatSesi"));
  });
});
