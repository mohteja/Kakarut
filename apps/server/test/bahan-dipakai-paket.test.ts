import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { porsiTersedia, qtyBahanPerPorsi } from "@kakarut/shared";

/**
 * BAHAN YANG MASIH DIMAKAN PAKET AKTIF TAK BOLEH BISA DIARSIPKAN.
 *
 * "Dipakai" wajib berarti hal yang sama di penjaga hapus-bahan dan di kasir.
 * Penjaga itu dulu hanya melihat menu yang memuat bahan ini DAN aktif sendiri,
 * sementara `komponenEfektif` — yang benar-benar memotong stok saat menjual —
 * memulangkan komponen menu itu sendiri DITAMBAH komponen MENU DASARNYA bila
 * ia paket. Satu tingkat yang tak ikut terlihat:
 *
 *   paket P (aktif) → menu dasar A (diarsipkan) → bahan B
 *
 * Terukur terhadap server sungguhan sebelum perbaikan: stok B 100 pcs, kasir
 * menjual 60 paket (butuh 120) — LOLOS, dan saldo B mendarat di −20 yang tak
 * muncul di layar mana pun.
 *
 * Yang membuatnya sunyi total ada tiga lapis, dan uji ini menjalankan lapis
 * kedua supaya akibatnya bukan cuma tulisan di komentar.
 */

describe("kenapa bahan nonaktif berbahaya: porsi berubah jadi 'tak terbatas'", () => {
  const komponen = [{ ingredient_id: "B", qty: 2, track_stok: true }];

  it("bahan yang ADA saldonya membatasi porsi", () => {
    const perPorsi = qtyBahanPerPorsi(komponen);
    expect(porsiTersedia(perPorsi, new Map([["B", 100]]))).toBe(50);
  });

  it("bahan yang HILANG dari daftar saldo membuat menu jadi TAK TERBATAS", () => {
    /*
     * Inilah akibat yang tak berbunyi. `bahanPembatas` sengaja melewati bahan
     * tanpa saldo ("nonaktif / tak tampil di cabang diabaikan") — aturan yang
     * benar SELAMA bahan nonaktif memang tak pernah dikonsumsi. Begitu ia bisa
     * dikonsumsi, `null` di sini dibaca layar sebagai "tidak dibatasi bahan
     * apa pun": boleh dijual sebanyak apa pun.
     *
     * Perhatikan bedanya dengan 0: habis dan tak-terbatas adalah dua jawaban
     * yang berlawanan, dan yang keliru justru yang menenangkan.
     */
    const perPorsi = qtyBahanPerPorsi(komponen);
    expect(porsiTersedia(perPorsi, new Map())).toBeNull();
    expect(porsiTersedia(perPorsi, new Map([["B", 0]]))).toBe(0);
  });
});

const SRV = new URL("../src/", import.meta.url);
const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, SRV)), "utf8");

/** Irisan handler `DELETE /bahan/:id` — dijangkarkan, bukan seluruh berkas. */
function irisanHapusBahan(): string {
  const isi = baca("modules/bahan/routes.ts");
  const i = isi.indexOf('.delete("/:id"');
  expect(i, "jangkar `.delete(\"/:id\"` usang — irisannya tak memeriksa apa pun").toBeGreaterThan(
    0,
  );
  const j = isi.indexOf("isActive: false", i);
  expect(j, "penanda akhir (arsip) tak ditemukan sesudah jangkar").toBeGreaterThan(i);
  return isi.slice(i, j);
}

describe("penjaga hapus bahan memakai jangkauan yang sama dengan penjualan", () => {
  it("ikut menghitung menu dasar sebuah PAKET AKTIF", () => {
    const blok = irisanHapusBahan();
    // Alias self-join ke `menus` — tanpa itu tak ada cara menanyakan
    // "adakah paket aktif yang berdasar menu ini".
    expect(blok).toContain('alias(menus, "paket_aktif")');
    expect(blok).toMatch(/eq\(paket\.baseMenuId, menus\.id\)/);
    expect(blok).toMatch(/eq\(paket\.isActive, true\)/);
    // Syaratnya OR, bukan AND: menu aktif biasa harus tetap menghalangi.
    expect(blok).toMatch(/or\(eq\(menus\.isActive, true\), isNotNull\(paket\.id\)\)/);
  });

  it("paket yang IKUT diarsipkan tidak lagi menghalangi", () => {
    // Penjaga yang menolak semua bukan penjaga. `eq(paket.isActive, true)` di
    // atas yang menjaganya; di sini dipastikan tak ada yang melonggarkannya
    // jadi "ada paket apa pun".
    const blok = irisanHapusBahan();
    expect(blok).not.toMatch(/eq\(paket\.isActive, false\)/);
  });

  it("pesan tolaknya menyebut menu yang HIDUP, bukan menu yang sudah diarsip", () => {
    // Menyebut menu dasar yang sudah diarsipkan membuat penolakan ini terbaca
    // mustahil: yang membacanya membuka daftar menu, tak menemukannya, lalu
    // menyimpulkan sistemnya yang salah.
    expect(irisanHapusBahan()).toContain("lewat menu dasarnya");
  });
});

describe("pintu menuju bahan nonaktif tetap SATU", () => {
  it("hanya `DELETE /bahan/:id` yang menulis is_active=false pada bahan", () => {
    /*
     * Penjaga di atas cuma berarti bila ia satu-satunya jalan. Bila kelak ada
     * jalur kedua yang menonaktifkan bahan — `PUT /bahan/:id` yang menerima
     * `is_active`, impor massal, penyunting massal — penjaga ini terlewati
     * tanpa ada yang perlu menyentuhnya, dan tak ada gejala apa pun.
     *
     * `BahanPatchBody` sengaja TIDAK memuat `is_active`; itu yang dijaga di
     * sini, bersama cacah penulisannya.
     */
    const rutes = baca("modules/bahan/routes.ts");
    const penulisan = rutes.match(/isActive: false/g) ?? [];
    expect(penulisan).toHaveLength(1);

    const i = rutes.indexOf("const BahanPatchBody");
    expect(i).toBeGreaterThan(0);
    expect(rutes.slice(i, rutes.indexOf("});", i))).not.toContain("is_active");
  });

  it("daftar stok memang menyaring bahan nonaktif — itu sebab ia lenyap", () => {
    // Bukan hiasan: inilah yang membuat bahan terhapus hilang dari SETIAP
    // layar stok sekaligus (daftar, opname, belanja), sehingga saldo minusnya
    // tak bisa dilihat siapa pun.
    expect(baca("modules/stok/service.ts")).toContain("i.is_active");
  });
});
