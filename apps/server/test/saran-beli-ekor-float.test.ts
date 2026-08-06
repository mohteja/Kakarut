import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { kekuranganBahan } from "@kakarut/shared";

/**
 * Penjaga SARAN BELI TAK BOLEH BERTERIAK TANPA ISI.
 *
 * Di layar Rekomendasi Beli, tiap baris bahan disorot oranye bila `saran_beli`
 * bernilai truthy — itulah tanda "ini yang perlu kamu beli". Angka yang
 * ditawarkannya sendiri datang dari jalur lain: `kurang` → `jumlahFaktur` →
 * `jumlah_faktur`.
 *
 * Dulu kedua jalur itu memakai definisi KEKURANGAN yang berbeda:
 *
 *     saran_beli = Math.max(0, kebutuhan - saldo)   ← penyorot baris
 *     kurang     = kekuranganBahan(kebutuhan, saldo) ← angka fakturnya
 *
 * Bedanya cuma di ekor float, dan justru di situ masalahnya. `kebutuhan` dan
 * `saldo` sama-sama jumlahan desimal — 0,1 kg tiga kali = 0,30000000000000004 —
 * jadi bahan yang stoknya PAS bisa menyisakan selisih ~5e-17. `kekuranganBahan`
 * menelan selisih sebesar itu (ambangnya 1e-9) dan memulangkan 0; `Math.max`
 * memulangkannya apa adanya.
 *
 * Yang dilihat owner: baris oranye "perlu dibeli", kolom sarannya tertulis 0
 * (dibulatkan dua desimal), estimasi biayanya Rp 0, dan tak ada jumlah faktur
 * sama sekali. Peringatan tanpa isi — ia mencari apa yang harus dibeli dan tak
 * menemukan apa pun. Yang lebih merugikan daripada satu baris salah warna
 * adalah kebiasaan yang tumbuh darinya: sorotan oranye berhenti dipercaya, dan
 * baris yang BENAR-BENAR perlu dibeli ikut dilewati.
 *
 * Perbaikannya bukan menyamakan dua rumus melainkan MEMBUANG salah satunya:
 * `kurang` kini mengambil nilai dari `saran_beli`, jadi keduanya mustahil
 * berselisih lagi.
 */
const SRV = readFileSync(
  fileURLToPath(new URL("../src/modules/rekomendasi/service.ts", import.meta.url)),
  "utf8",
);
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/produksi/RekomendasiBeliPage.tsx", import.meta.url)),
  "utf8",
);

describe("premis: kedua definisi kekurangan memang berbeda", () => {
  it("ekor float lolos dari `Math.max` tapi ditelan `kekuranganBahan`", () => {
    // Kalau premis ini gugur (mis. ambang epsilonnya dihapus), perbaikan di
    // bawah kehilangan alasannya dan uji ini yang harus memberi tahu.
    const butuh = 0.1 + 0.1 + 0.1; // 0.30000000000000004
    const saldo = 0.3;
    expect(butuh, "premis: penjumlahan desimal memang meleset").toBeGreaterThan(saldo);
    expect(Math.max(0, butuh - saldo), "rumus lama memulangkan angka mungil").toBeGreaterThan(0);
    expect(kekuranganBahan(butuh, saldo), "rumus rumah menelannya").toBe(0);
  });

  it("dan keduanya tetap sepakat untuk kekurangan yang sungguhan", () => {
    // Perbaikan ini tak boleh diam-diam mengecilkan saran beli yang nyata.
    for (const [butuh, saldo] of [
      [10, 3],
      [0.5, 0.25],
      [2, 0],
      [1, 1],
      [1, 5],
    ]) {
      expect(kekuranganBahan(butuh, saldo), `${butuh} - ${saldo}`).toBe(
        Math.max(0, butuh - saldo),
      );
    }
  });
});

describe("server: satu nilai dipakai penyorot baris DAN angka fakturnya", () => {
  it("`saran_beli` memakai `kekuranganBahan`", () => {
    expect(SRV).toContain(
      "const saran_beli = kebutuhan != null ? kekuranganBahan(kebutuhan, s.saldo) : null;",
    );
  });

  it("`kurang` MENGAMBIL dari `saran_beli`, bukan menghitung sendiri", () => {
    // Inti perbaikannya. Dua rumus yang kebetulan sama masih bisa berselisih
    // kelak; satu nilai yang dipakai berdua tidak bisa.
    expect(SRV).toContain("const kurang = saran_beli ?? 0;");
  });

  it("rumus lama benar-benar sudah tidak ada", () => {
    expect(SRV, "penyorot baris masih memakai definisi kekurangannya sendiri").not.toContain(
      "Math.max(0, kebutuhan - s.saldo)",
    );
  });

  it("`saran_beli` tetap null saat kebutuhan tak bisa dihitung", () => {
    // null ≠ 0: tanpa omzet acuan, "tidak tahu" bukan "tidak perlu beli".
    // Kolomnya menampilkan "—", dan itu jawaban yang jujur.
    expect(SRV).toContain("kebutuhan != null ?");
    expect(SRV).toContain(": null;");
  });

  it("angka faktur lahir dari `kurang` yang sama itu", () => {
    expect(SRV).toContain("kurang > 0");
    expect(SRV).toContain("jumlahFaktur(kurang,");
  });
});

describe("web: sorotan baris memang bergantung pada nilai itu", () => {
  it("baris disorot berdasarkan `saran_beli` — itulah kenapa ia harus jujur", () => {
    // Dipatok supaya alasan perbaikan server ini tetap terbaca dari sisi web.
    // Kalau kelak sorotannya dipindah ke medan lain, uji ini gugur dan yang
    // meninjau bisa memutuskan sadar — bukan menemukannya lewat baris oranye
    // yang tak bisa dijelaskan.
    expect(HAL).toContain('className={b.saran_beli ? "bg-orange-50/40" : ""}');
  });
});
