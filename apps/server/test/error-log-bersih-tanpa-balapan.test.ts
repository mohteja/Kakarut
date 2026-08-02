import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga BALAPAN pada §142 verify-api (bersihkan log galat).
 *
 * Pencatatan galat sengaja TIDAK ditunggu — `app.ts` memanggilnya `void
 * catatGalat(...)` di ketiga cabangnya, supaya menulis log tak pernah menjelma
 * jadi kegagalan kedua. Konsekuensinya: sebuah respons galat bisa sudah sampai
 * ke klien sementara barisnya baru menyusul ditulis.
 *
 * §142 membuka dengan DUA asersi guard yang keduanya melahirkan catatan (403
 * untuk owner-bukan-super-admin, 401 untuk tanpa token), lalu langsung
 * DELETE-lalu-baca dan menuntut daftarnya kosong. Bila salah satu tulisan itu
 * mendarat sesudah DELETE-nya, yang terbaca 1, bukan 0.
 *
 * Itu bukan hipotesis: CI pernah gagal persis begitu — 1997 lolos, 1 gagal,
 * "bersihkan log → daftar kosong — nilai: 1". Satu penyintas, bukan pola.
 *
 * Bagian itu sendiri sudah tahu jalur ini tak ditunggu — dua puluh baris di
 * bawahnya ada `sleep 1` sebelum MEMBACA, lengkap dengan komentarnya. Yang
 * luput cuma bahwa MENGHAPUS punya paparan yang sama.
 */
const SKRIP = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-api.sh", import.meta.url)),
  "utf8",
);
const APP = readFileSync(
  fileURLToPath(new URL("../src/app.ts", import.meta.url)),
  "utf8",
);

describe("premisnya: pencatatan galat memang tak ditunggu", () => {
  it("app.onError memanggil catatGalat tanpa await", () => {
    const cocok = APP.match(/void catatGalat\(/g) ?? [];
    expect(cocok.length, "jalur `void catatGalat` tak ditemukan").toBeGreaterThanOrEqual(3);
    expect(APP).not.toMatch(/await catatGalat\(/);
  });

  it("§142 memang diawali dua asersi yang melahirkan catatan", () => {
    const i = SKRIP.indexOf("142. Log galat platform");
    expect(i, "§142 tak ditemukan").toBeGreaterThan(0);
    const bagian = SKRIP.slice(i, SKRIP.indexOf("DELETE /admin/error-log", i));
    expect(bagian).toMatch(/GET \/admin\/error-log → 403/);
    expect(bagian).toMatch(/tanpa token → 401/);
  });
});

describe("§142 menguras tulisan yang masih di jalan sebelum menghapus", () => {
  it("ada jeda ANTARA asersi guard dan DELETE-nya", () => {
    const i = SKRIP.indexOf("142. Log galat platform");
    const j = SKRIP.indexOf('api "$SA" DELETE /admin/error-log', i);
    expect(j, "penghapusan log tak ditemukan").toBeGreaterThan(i);
    expect(SKRIP.slice(i, j)).toMatch(/^sleep \d+$/m);
  });

  it("jeda sebelum MEMBACA yang sudah ada tetap ada", () => {
    // Pagar yang sudah benar sejak awal; dipatok agar tak ikut hilang saat
    // seseorang merapikan "sleep yang kelihatan berlebihan".
    const i = SKRIP.indexOf("Picu 4xx yang pasti");
    expect(i).toBeGreaterThan(0);
    expect(SKRIP.slice(i, i + 900)).toMatch(/sleep 1\s+#\s*pencatatan sengaja tidak ditunggu/);
  });

  it("asersi yang dijaga masih berbunyi sama", () => {
    expect(SKRIP).toMatch(/cek "bersihkan log → daftar kosong" "V == 0"/);
  });
});
