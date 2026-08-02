import { describe, expect, it } from "vitest";
import { adaKoreksiSajian, ringkasPesanan } from "@kakarut/shared";
import type { PesananItemRow, PesananRow } from "@kakarut/shared";

/**
 * Penjaga BADGE "diubah setelah transaksi" pada Papan Pesanan.
 *
 * Membalik penyajian sebuah baris pada penjualan yang SUDAH DIBAYAR bukan
 * kosmetik: server menghitung ulang `hpp_satuan`/`total_hpp` dan menulis ulang
 * `sale_consumptions`. Uang dan stok kemasan benar-benar berpindah, jadi
 * kartunya wajib mengatakannya.
 *
 * Dulu dasarnya `p.sajian_takeaway` — dan itu turunan `items.every(…)`, alias
 * "SEMUA baris bawa pulang". Lubangnya tepat mengenai kasus yang paling sering
 * terjadi: pesanan dine-in yang SEBAGIAN barisnya dibungkus. Agregatnya tinggal
 * false, `false === true` tak pernah cocok, dan papan diam.
 *
 * Yang membuatnya sulit terlihat: arah sebaliknya KEBETULAN benar. Pesanan
 * bawa pulang yang sebagian dikembalikan ke tempat tetap tertandai, karena
 * agregatnya juga jatuh ke false dan `false === false` cocok. Satu arah bekerja,
 * satu arah diam — persis bentuk yang lolos dari pemeriksaan sekilas.
 *
 * Karena itu tabelnya DIUJI DUA ARAH, bukan hanya arah yang dulu rusak.
 */
function baris(sajianTakeaway: boolean): PesananItemRow {
  return {
    id: `i${sajianTakeaway}${Math.round(1)}`,
    menu_nama: "Nasi Goreng",
    qty: 1,
    catatan: null,
    status: "dikerjakan",
    sajian_takeaway: sajianTakeaway,
    status_oleh: null,
    status_pada: null,
  } as PesananItemRow;
}

function kartu(p: {
  dibayar: boolean;
  isDineIn: boolean;
  takeaway: boolean[];
}): Pick<PesananRow, "dibayar" | "is_dine_in" | "items"> {
  return {
    dibayar: p.dibayar,
    is_dine_in: p.isDineIn,
    items: p.takeaway.map((t, i) => ({ ...baris(t), id: `i${i}` })),
  };
}

describe("papan pesanan: koreksi penyajian sesudah transaksi", () => {
  it("dine-in utuh: tak ada koreksi", () => {
    expect(adaKoreksiSajian(kartu({ dibayar: true, isDineIn: true, takeaway: [false, false] }))).toBe(
      false,
    );
  });

  it("bawa pulang utuh: tak ada koreksi", () => {
    expect(adaKoreksiSajian(kartu({ dibayar: true, isDineIn: false, takeaway: [true, true] }))).toBe(
      false,
    );
  });

  it("dine-in, SEMUA baris dibungkus: koreksi", () => {
    expect(adaKoreksiSajian(kartu({ dibayar: true, isDineIn: true, takeaway: [true, true] }))).toBe(
      true,
    );
  });

  /** Inilah cacat aslinya: agregat kartu tinggal false, jadi papan diam. */
  it("dine-in, SEBAGIAN baris dibungkus: TETAP koreksi", () => {
    const p = kartu({ dibayar: true, isDineIn: true, takeaway: [true, false] });
    // Agregat kartu memang false — dan justru itu sebabnya ia tak boleh dipakai.
    expect(ringkasPesanan(p.items).sajian_takeaway).toBe(false);
    expect(adaKoreksiSajian(p)).toBe(true);
  });

  it("bawa pulang, SEMUA baris dikembalikan ke tempat: koreksi", () => {
    expect(
      adaKoreksiSajian(kartu({ dibayar: true, isDineIn: false, takeaway: [false, false] })),
    ).toBe(true);
  });

  it("bawa pulang, SEBAGIAN dikembalikan ke tempat: koreksi", () => {
    expect(
      adaKoreksiSajian(kartu({ dibayar: true, isDineIn: false, takeaway: [true, false] })),
    ).toBe(true);
  });

  it("belum dibayar: tak pernah koreksi — biayanya belum terbuku", () => {
    // Bill terbuka boleh ditandai bebas; penandanya baru sampai ke angka saat
    // dibayar, jadi tak ada pembukuan yang dikoreksi.
    expect(adaKoreksiSajian(kartu({ dibayar: false, isDineIn: true, takeaway: [true, true] }))).toBe(
      false,
    );
    expect(
      adaKoreksiSajian(kartu({ dibayar: false, isDineIn: false, takeaway: [false, false] })),
    ).toBe(false);
  });

  it("kartu tanpa baris: tak ada yang dikoreksi", () => {
    // Rumus lama memberi `false === false` → true untuk penjualan bawa pulang
    // tanpa baris; menandai koreksi pada pesanan yang tak punya sajian apa pun.
    expect(adaKoreksiSajian(kartu({ dibayar: true, isDineIn: false, takeaway: [] }))).toBe(false);
    expect(adaKoreksiSajian(kartu({ dibayar: true, isDineIn: true, takeaway: [] }))).toBe(false);
  });
});
