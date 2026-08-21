/**
 * KEKEKALAN UANG PADA REFUND BERTAHAP.
 *
 * `refund.ts` sudah punya uji satuan untuk kasus-kasus yang dipilih tangan.
 * Yang TIDAK dijaga siapa pun adalah sifatnya sebagai keseluruhan, dan sifat
 * itulah yang menentukan berapa rupiah berpindah tangan:
 *
 *   1. total TAK PERNAH NAIK saat porsi dikembalikan satu per satu;
 *   2. jumlah seluruh refund bertahap = total yang dibayar semula.
 *
 * KENAPA (2) TIDAK OTOMATIS BENAR meski terlihat teleskopik. `nominalRefund`
 * MENJEPIT selisih negatif jadi nol:
 *
 *     const selisih = sebelum.total - sesudah.total;
 *     return selisih > 0 ? selisih : 0;
 *
 * Jepitan itu benar — mengembalikan uang negatif tak masuk akal — tapi ia juga
 * MENYEMBUNYIKAN pelanggaran (1). Sekali sebuah langkah menaikkan total,
 * kenaikannya ditelan diam-diam dan jumlah seluruh refund jadi LEBIH BESAR
 * dari yang pernah dibayar pembeli. Tak ada yang akan melihatnya dari satu
 * transaksi; yang terlihat cuma kas yang tak pernah cocok.
 *
 * Dan bahayanya nyata secara aritmetika, bukan dibuat-buat: diskon diprorata
 * dengan `Math.round`, jadi saat subtotal turun sebesar δ, diskonnya bisa
 * turun sedikit LEBIH dari δ karena pembulatan — dan `net = subtotal − diskon`
 * ikut NAIK. Yang mencegahnya `Math.min(subtotal, …)` pada diskon dan
 * proporsionalitas PB1. Uji ini yang membuktikan pencegahan itu benar-benar
 * bekerja, bukan sekadar diyakini.
 *
 * DIUKUR: 100.000 kombinasi (40.000 tersusun + 60.000 acak, sampai 4 baris,
 * diskon 0–100%, tarif PB1 0–12,5%) → NOL pelanggaran. Yang dipasang di sini
 * bagian yang murah dijalankan tiap kali, dengan pengacak DETERMINISTIK supaya
 * kegagalannya bisa diulang persis.
 */
import { describe, expect, it } from "vitest";
import {
  hitungPb1,
  hitungUangSetelahRefund,
  nominalRefund,
  type BarisRefund,
} from "@kakarut/shared";

/**
 * Pengacak deterministik (LCG). Sengaja BUKAN `Math.random`: uji properti yang
 * gagal sekali lalu hijau saat diulang tak bisa didiagnosis siapa pun.
 */
function pengacak(benih: number) {
  let s = benih >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

interface Kasus {
  baris: BarisRefund[];
  asal: { subtotal: number; diskon: number; pb1: number };
  total: number;
}

function buatKasus(harga: number[], qty: number[], diskonPersen: number, rate: number): Kasus {
  const baris = harga.map((h, i) => ({ hargaSatuan: h, qty: qty[i], qtyRefund: 0 }));
  const subtotal = baris.reduce((a, b) => a + b.hargaSatuan * b.qty, 0);
  const diskon = Math.round((subtotal * diskonPersen) / 100);
  const pb1 = hitungPb1(subtotal - diskon, rate);
  return { baris, asal: { subtotal, diskon, pb1 }, total: subtotal - diskon + pb1 };
}

/** Kembalikan porsi satu per satu; → { naik, jumlahRefund } */
function kembalikanSemua(k: Kasus): { naik: number; jumlahRefund: number } {
  const kerja = k.baris.map((b) => ({ ...b }));
  let sebelum = { ...k.asal, total: k.total };
  let naik = 0;
  let jumlahRefund = 0;
  for (const b of kerja) {
    for (let n = 0; n < b.qty; n += 1) {
      b.qtyRefund += 1;
      const sesudah = hitungUangSetelahRefund(kerja, k.asal);
      if (sesudah.total > sebelum.total) naik += 1;
      jumlahRefund += nominalRefund(sebelum, sesudah);
      sebelum = sesudah;
    }
  }
  return { naik, jumlahRefund };
}

const HARGA = [1, 7, 101, 999, 1234, 15000, 23456];
const QTY = [1, 2, 3];
const RATE = [0, 5, 10, 11, 12.5];
const DISKON = [0, 3, 17, 50, 99, 100];

describe("uang refund bertahap tak pernah melebihi yang dibayar", () => {
  it("kombinasi tersusun: total tak pernah naik & jumlahnya persis", () => {
    let dicoba = 0;
    const naikDi: string[] = [];
    const melesetDi: string[] = [];
    for (const h1 of HARGA)
      for (const h2 of HARGA)
        for (const q1 of QTY)
          for (const q2 of QTY)
            for (const rate of RATE)
              for (const d of DISKON) {
                const k = buatKasus([h1, h2], [q1, q2], d, rate);
                const { naik, jumlahRefund } = kembalikanSemua(k);
                dicoba += 1;
                const label = `(${h1}×${q1}, ${h2}×${q2}) diskon=${d}% pb1=${rate}%`;
                if (naik > 0 && naikDi.length < 5) naikDi.push(`${label} — total naik ${naik}×`);
                if (jumlahRefund !== k.total && melesetDi.length < 5) {
                  melesetDi.push(`${label} — dibayar ${k.total}, dikembalikan ${jumlahRefund}`);
                }
              }
    expect(dicoba).toBeGreaterThan(4000); // premisnya: sapuannya memang jalan
    expect(naikDi, `total NAIK saat porsi dikembalikan:\n${naikDi.join("\n")}`).toEqual([]);
    expect(
      melesetDi,
      `jumlah refund ≠ yang dibayar — toko mengembalikan lebih/kurang:\n${melesetDi.join("\n")}`,
    ).toEqual([]);
  });

  it("acak deterministik: sampai 4 baris, diskon 0–100%", () => {
    const rnd = pengacak(20260821);
    const naikDi: string[] = [];
    const melesetDi: string[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const n = 1 + Math.floor(rnd() * 4);
      const harga = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 50000));
      const qty = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 4));
      const d = Math.floor(rnd() * 101);
      const rate = RATE[Math.floor(rnd() * RATE.length)];
      const k = buatKasus(harga, qty, d, rate);
      const { naik, jumlahRefund } = kembalikanSemua(k);
      const label = `harga=[${harga}] qty=[${qty}] diskon=${d}% pb1=${rate}%`;
      if (naik > 0 && naikDi.length < 5) naikDi.push(label);
      if (jumlahRefund !== k.total && melesetDi.length < 5) {
        melesetDi.push(`${label} — dibayar ${k.total}, dikembalikan ${jumlahRefund}`);
      }
    }
    expect(naikDi, `total NAIK:\n${naikDi.join("\n")}`).toEqual([]);
    expect(melesetDi, `jumlah refund ≠ yang dibayar:\n${melesetDi.join("\n")}`).toEqual([]);
  });

  it("PASANGAN: jepitan `nominalRefund` MENYEMBUNYIKAN total yang naik", () => {
    /*
     * Tanpa ini, dua asersi di atas cuma membuktikan bahwa `kembalikanSemua`
     * memulangkan larik kosong — bukan bahwa ia mampu mengisinya.
     *
     * Barisan di bawah DITULIS TANGAN, bukan keluaran kode produksi: ia
     * memperagakan apa yang terjadi kalau sebuah langkah refund menaikkan
     * total, dan menunjukkan bahwa akibatnya TAK TERLIHAT dari nominal per
     * langkah — hanya dari jumlahnya. Itulah sebabnya sifat (1) diuji
     * terpisah dan tidak dianggap tercakup oleh (2).
     *
     * Percobaan pertama uji ini memakai barisan yang ternyata MENURUN terus
     * (16.500 → 15.000 → 10.000 → 5.000 → 0). Ia tak melanggar apa pun:
     * jumlahnya pas 16.500, dan asersinya gagal — pasangan yang menolak
     * peragaan yang tak memperagakan apa-apa.
     */
    const dibayar = 16_500;
    // Langkah kedua NAIK (15.000 → 16.000) — inilah yang dijepit jadi 0.
    const barisan = [15_000, 16_000, 5_000, 0];
    let sebelum = dibayar;
    let naik = 0;
    let jumlah = 0;
    for (const sesudah of barisan) {
      if (sesudah > sebelum) naik += 1;
      jumlah += nominalRefund({ subtotal: 0, diskon: 0, pb1: 0, total: sebelum },
                              { subtotal: 0, diskon: 0, pb1: 0, total: sesudah });
      sebelum = sesudah;
    }
    expect(naik, "barisannya harus benar-benar memuat kenaikan").toBe(1);
    // 1.500 + 0 (dijepit) + 11.000 + 5.000 = 17.500 → toko rugi 1.000.
    expect(jumlah).toBe(17_500);
    expect(jumlah).toBeGreaterThan(dibayar);
  });
});
