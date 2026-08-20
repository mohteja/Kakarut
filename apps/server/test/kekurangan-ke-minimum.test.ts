/**
 * "BERAPA KURANGNYA UNTUK MENCAPAI STOK MINIMUM" — satu rumah, satu jawaban.
 *
 * Aturan ini pernah tersalin dua kali dan salinannya SUDAH berbeda: server
 * memakai penjaga galat pembulatan (`- 1e-9`), layar tidak. Untuk item yang
 * sama, permintaan otomatis meminta 1 sementara dialog manual mengisi 2.
 *
 * Bukan kasus pinggiran yang dibuat-buat — menyapu pasangan (minimum, saldo)
 * satu desimal sampai 200 memberi 18.510 pasangan yang hasilnya berbeda.
 * Cabang bersatuan pecahan memesan satu lebih banyak dari yang perlu, tiap kali.
 *
 * Uji ini PERILAKU, bukan pencocokan sumber: helper-nya fungsi murni, jadi
 * angkanya bisa diuji langsung — cara yang lebih kuat daripada memakukan teks.
 */
import { describe, expect, it } from "vitest";
import { kekuranganKeMinimum } from "@kakarut/shared";

describe("kekuranganKeMinimum", () => {
  it("nol saat stok sudah cukup", () => {
    expect(kekuranganKeMinimum({ stok_minimum: 10, saldo: 10 })).toBe(0);
    expect(kekuranganKeMinimum({ stok_minimum: 10, saldo: 25 })).toBe(0);
  });

  it("nol saat item tak punya stok minimum", () => {
    // Tanpa penjaga ini, item bebas-minimum akan terus-menerus "kurang".
    expect(kekuranganKeMinimum({ stok_minimum: 0, saldo: 0 })).toBe(0);
    expect(kekuranganKeMinimum({ stok_minimum: 0, saldo: -5 })).toBe(0);
  });

  it("membulatkan ke ATAS — pecahan mustahil dikirim", () => {
    expect(kekuranganKeMinimum({ stok_minimum: 10, saldo: 7.2 })).toBe(3);
    expect(kekuranganKeMinimum({ stok_minimum: 5, saldo: 4.01 })).toBe(1);
  });

  it("saldo minus tetap terhitung penuh", () => {
    // Stok minus itu nyata di lapangan (koreksi menyusul kenyataan), dan
    // kekurangannya harus mencakup lubangnya, bukan cuma jarak ke nol.
    expect(kekuranganKeMinimum({ stok_minimum: 5, saldo: -3 })).toBe(8);
  });

  it("INTI: galat pembulatan float tak menaikkan pesanan satu penuh", () => {
    /*
     * 2.2 − 1.2 mendarat di 1.0000000000000002 dalam pecahan biner. Tanpa
     * epsilon, `Math.ceil` menjadikannya 2 — dan cabang memesan dua padahal
     * kurangnya satu.
     */
    expect(2.2 - 1.2).toBeGreaterThan(1); // premisnya, supaya uji ini jujur
    expect(kekuranganKeMinimum({ stok_minimum: 2.2, saldo: 1.2 })).toBe(1);
    expect(kekuranganKeMinimum({ stok_minimum: 4.4, saldo: 1.4 })).toBe(3);
    expect(kekuranganKeMinimum({ stok_minimum: 2.7, saldo: 1.7 })).toBe(1);
  });

  it("…dan epsilonnya tidak MENELAN kekurangan yang sungguhan kecil", () => {
    /*
     * Pasangan yang menjaga arah sebaliknya: penjaga yang terlalu longgar
     * membulatkan kebutuhan NYATA jadi nol, dan cabang tak pernah memesan
     * apa pun — kegagalan yang jauh lebih sunyi daripada memesan kelebihan.
     *
     * Angkanya dipilih dari skemanya, bukan dikarang: saldo disimpan
     * `numeric(16,6)`, jadi kekurangan terkecil yang BISA ada adalah 1e-6.
     * Epsilon apa pun yang ≥ 1e-5 menelannya.
     *
     * Percobaan pertama uji ini memakai saldo 9.999 (kekurangan 1e-3) dan
     * TIDAK menggigit: epsilon dilonggarkan seribu kali lipat ke 1e-4 pun
     * tetap hijau. Asersi yang tak bisa gagal tak menjaga apa pun.
     */
    expect(kekuranganKeMinimum({ stok_minimum: 10, saldo: 9.999999 })).toBe(1);
    expect(kekuranganKeMinimum({ stok_minimum: 1, saldo: 0 })).toBe(1);
  });

  it("tak pernah memulangkan angka negatif", () => {
    expect(kekuranganKeMinimum({ stok_minimum: 3, saldo: 3.0000001 })).toBe(0);
  });
});
