import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lewatTargetDurasi } from "@kakarut/shared";

/**
 * TARGET WAKTU PENYAJIAN PER MENU.
 *
 * Laporan durasi sebelumnya cuma bisa berkata "rata-rata 7 menit". Angka itu
 * tak bisa ditindaklanjuti karena ia menjawab "berapa lama", bukan "apakah itu
 * terlalu lama" — dan yang menjawabnya cuma target.
 *
 * Yang dijaga di sini adalah dua keputusan yang menentukan berguna-tidaknya
 * seluruh bendera ini, dan keduanya mudah dibalik tanpa sadar.
 */

describe("lewatTargetDurasi", () => {
  it("tanpa target → tak pernah menyala", () => {
    // Menuduh terlambat terhadap angka yang tak pernah dipilih siapa-siapa
    // cuma melatih orang mengabaikan laporannya.
    expect(lewatTargetDurasi(99_999, null)).toBe(false);
    expect(lewatTargetDurasi(99_999, 0)).toBe(false);
  });

  it("TEPAT di target = memenuhi target", () => {
    // `>=` akan membuat target mana pun mustahil dipenuhi: yang menyetel 5
    // menit lalu melihat menu 5-menitnya ditandai merah akan menyimpulkan
    // fiturnya rusak, dan ia benar.
    expect(lewatTargetDurasi(300, 300)).toBe(false);
    expect(lewatTargetDurasi(301, 300)).toBe(true);
    expect(lewatTargetDurasi(299, 300)).toBe(false);
  });

  it("target negatif diperlakukan seperti tak ada", () => {
    expect(lewatTargetDurasi(500, -60)).toBe(false);
  });
});

const AKAR = new URL("../src/", import.meta.url);
const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, AKAR)), "utf8");

describe("laporan durasi: target diambil lewat menu_id", () => {
  const SRC = baca("modules/laporan/routes.ts");
  const i = SRC.indexOf('.get("/durasi-pesanan"');
  const BLOK = i < 0 ? "" : SRC.slice(i, SRC.indexOf('.get("/bep"', i));

  it("blok laporannya ketemu — bukan lolos karena kosong", () => {
    expect(BLOK.length).toBeGreaterThan(1000);
  });

  it("join ke `menus` memakai menuId, bukan mencocokkan nama", () => {
    /*
     * Laporannya MENGELOMPOKKAN per `menu_nama` — snapshot per baris jual,
     * supaya angka historisnya tetap seperti saat transaksinya terjadi. Tapi
     * TARGET adalah setelan hari ini, dan menu yang pernah diganti namanya tak
     * akan pernah cocok bila dicari dari nama snapshot itu: targetnya diam-diam
     * terbaca null, dan menu yang paling sering disetel justru yang paling
     * mungkin pernah diganti namanya.
     *
     * Terbukti di server sungguhan: menu diganti nama, baris lamanya tetap
     * bernama lama, dan `target_detik` tetap 300.
     */
    expect(BLOK).toContain("leftJoin(menus, eq(saleItems.menuId, menus.id))");
  });

  it("LEFT join, bukan INNER — menu terhapus tetap punya riwayat durasi", () => {
    expect(BLOK).not.toContain("innerJoin(menus");
  });

  it("aturan lewat-target dipakai dari shared, tak disalin ulang", () => {
    expect(BLOK).toContain("lewatTargetDurasi(median, target)");
  });
});

describe("target di form menu: menit di layar, detik di server", () => {
  const FORM = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/menu/MenuFormPage.tsx", AKAR)),
    "utf8",
  );

  it("kotaknya meminta MENIT", () => {
    // Yang mengisinya memikirkan "sepuluh menit", bukan "600 detik". Kotak yang
    // meminta detik akan diisi "10" oleh separuh orang, dan target sepuluh
    // detik membuat laporan berkata menu ini SELALU terlambat.
    expect(FORM).toContain("Target waktu penyajian (menit)");
  });

  it("dikirim ke server dalam DETIK", () => {
    expect(FORM).toMatch(/target_durasi_detik:[^\n]*\* 60/);
  });

  it("kosong dikirim sebagai null, bukan 0", () => {
    // Server menolak 0 (400), dan target nol tak punya arti apa pun.
    const i = FORM.indexOf("target_durasi_detik:");
    expect(i).toBeGreaterThan(0);
    expect(FORM.slice(i, i + 160)).toContain("null");
  });
});
