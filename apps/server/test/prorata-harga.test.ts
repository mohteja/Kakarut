import { describe, expect, it } from "vitest";
import { hargaBagian, majuPenuh, pisahHarga, qtyMelebihi } from "@kakarut/shared";

/**
 * PEMBAGIAN HARGA SAAT BARIS DIPECAH.
 *
 * Satu baris rencana 8 pcs seharga Rp 40.000 yang diproses 3 pcs harus jadi dua
 * baris — 3 dan 5 — dan jumlah harganya WAJIB tetap Rp 40.000.
 *
 * Sebelum ini, invarian itu cuma dijaga satu asersi verify-api ("Σharga B tetap
 * 40000") pada SATU pasang angka. Rumusnya sendiri tertulis empat kali di empat
 * berkas, dan tak satu pun bisa dijalankan uji karena tak ada fungsi untuk
 * dipanggil. Uji ini menjalankannya terhadap ribuan pasang angka.
 */

describe("pisahHarga: tak ada rupiah yang lahir atau hilang", () => {
  it("contoh yang dipakai verify-api §42", () => {
    const { bagian, sisa } = pisahHarga(40_000, 3, 8);
    expect(bagian).toBe(15_000);
    expect(sisa).toBe(25_000);
  });

  it("jumlahnya SELALU kembali ke harga asal — 3.000+ kombinasi", () => {
    /*
     * Inilah alasan sisanya dihitung dengan PENGURANGAN, bukan pembulatan
     * kedua. Dua pembulatan bisa menjumlah jadi satu rupiah lebih atau kurang,
     * dan satu rupiah yang lahir tiap kali baris dipecah tak akan pernah
     * ketahuan dari layar mana pun — ia cuma membuat buku belanja tak pernah
     * benar-benar cocok.
     */
    const gagal: string[] = [];
    for (let total = 1; total <= 100_000; total += 997) {
      for (let qtyBaris = 1; qtyBaris <= 30; qtyBaris++) {
        for (let bagianQty = 1; bagianQty < qtyBaris; bagianQty++) {
          const { bagian, sisa } = pisahHarga(total, bagianQty, qtyBaris);
          if (bagian! + sisa! !== total) {
            gagal.push(`${total} ${bagianQty}/${qtyBaris} → ${bagian}+${sisa}`);
          }
        }
      }
    }
    expect(gagal.slice(0, 5)).toEqual([]);
  });

  it("qty pecahan (gram/liter hasil konversi) juga menjumlah tepat", () => {
    for (const [total, q, qb] of [
      [10_000, 0.7576, 3],
      [33_333, 1.5, 4.5],
      [1, 0.001, 0.003],
    ] as const) {
      const { bagian, sisa } = pisahHarga(total, q, qb);
      expect(bagian! + sisa!, `${total} ${q}/${qb}`).toBe(total);
    }
  });

  it("baris tanpa harga tetap tanpa harga — bukan Rp 0", () => {
    // Menebak nol akan memunculkan baris berharga Rp 0 yang tampak sah di buku
    // belanja, dan tak ada yang bisa membedakannya dari barang gratis.
    expect(pisahHarga(null, 3, 8)).toEqual({ bagian: null, sisa: null });
  });

  it("qty baris nol memulangkan 0, bukan NaN", () => {
    // NaN tak menolak dirinya sendiri: ia tersimpan ke kolom harga, lalu
    // menular ke tiap penjumlahan yang menyentuhnya. Laporan yang seluruh
    // angkanya NaN tak menyebut sebabnya.
    expect(hargaBagian(40_000, 3, 0)).toBe(0);
    expect(Number.isNaN(hargaBagian(40_000, 3, 0))).toBe(false);
    const { bagian, sisa } = pisahHarga(40_000, 3, 0);
    expect(bagian).toBe(0);
    expect(sisa).toBe(40_000);
  });

  it("bagian penuh mengambil seluruh harga, sisanya nol", () => {
    expect(pisahHarga(40_000, 8, 8)).toEqual({ bagian: 40_000, sisa: 0 });
  });
});

describe("majuPenuh / qtyMelebihi: banding qty bertoleransi", () => {
  it("qty pecahan yang seharusnya PAS tak melahirkan baris sisa hantu", () => {
    /*
     * 0.1 + 0.7 = 0.7999999999999999 — KURANG SEDIKIT dari 0.8. Tanpa
     * toleransi, baris yang seharusnya maju utuh ter-split jadi sisa berukuran
     * 1e-16: tugas yang tak bisa dihabiskan siapa pun dan tak bisa dijelaskan
     * kepada siapa pun.
     *
     * Versi pertama uji ini memakai 0.1 + 0.2 vs 0.3, dan tetap HIJAU saat
     * toleransinya kuhapus untuk membuktikannya merah — jumlah itu kebetulan
     * jatuh di sisi LEBIH (0.30000000000000004), jadi `>=` lolos tanpa bantuan
     * toleransi. Arah selisihnya yang menentukan, bukan sekadar "tak persis".
     */
    const qty = 0.1 + 0.7;
    expect(qty < 0.8).toBe(true);
    expect(majuPenuh(qty, 0.8)).toBe(true);
    expect(qtyMelebihi(qty, 0.8)).toBe(false);
    // Sisi lain: jumlah yang jatuh sedikit di atas target juga bukan "lebih".
    expect(qtyMelebihi(0.1 + 0.2, 0.3)).toBe(false);
  });

  it("kurang dari rencana → split, bukan maju penuh", () => {
    expect(majuPenuh(3, 8)).toBe(false);
    expect(majuPenuh(7.999, 8)).toBe(false);
  });

  it("lebih dari rencana (beli per kemasan) terdeteksi", () => {
    expect(majuPenuh(1000, 900)).toBe(true);
    expect(qtyMelebihi(1000, 900)).toBe(true);
  });

  it("tepat sama = penuh, tapi TIDAK lebih", () => {
    // Kalau "sama" ikut dihitung lebih, harga baris diskalakan tanpa ada yang
    // memintanya — dan hasil skala itu ditandai `harga_tebakan`, jadi harga
    // yang diketik orang diam-diam berhenti dianggap harga sungguhan.
    expect(majuPenuh(8, 8)).toBe(true);
    expect(qtyMelebihi(8, 8)).toBe(false);
  });
});
