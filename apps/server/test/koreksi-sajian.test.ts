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
 * DUA cacat berbeda pernah hidup di baris yang sama, dan berkas ini menjaga
 * keduanya sekaligus:
 *
 * 1. DIAM SAAT SEBAGIAN. Dasarnya `p.sajian_takeaway` — turunan
 *    `items.every(…)`, alias "SEMUA baris bawa pulang". Pesanan dine-in yang
 *    cuma sebagian dibungkus tetap beragregat false, `false === true` tak
 *    pernah cocok, dan papan diam. Yang menyembunyikannya: arah sebaliknya
 *    KEBETULAN benar, karena agregatnya juga jatuh ke false.
 *
 * 2. MENUDUH YANG TAK BERSALAH. Perbaikan pertama membandingkan tiap baris
 *    dengan `is_dine_in` KARTU. Padahal kasir boleh menandai satu porsi
 *    dibungkus di meja yang makan di tempat, dan baris itu memang lahir
 *    `is_dine_in` false pada penjualan ber-`is_dine_in` true — langsung
 *    tertuduh "diubah setelah transaksi" tanpa ada yang mengubahnya.
 *
 * Keduanya lolos pembacaan sekilas karena benar di SEBAGIAN kasus. Karena itu
 * tabel di bawah menguji dua arah pembalikan DAN pesanan campur yang sah.
 */
/**
 * Baris utuh — SENGAJA tanpa `as PesananItemRow`.
 *
 * Versi pertama berkas ini memakai cast itu untuk memangkas kolom yang
 * dianggap tak relevan, dan castnya menyembunyikan bahwa namanya `nama` (bukan
 * `menu_nama`) sekaligus melewatkan `is_dine_in` — justru kolom yang jadi INTI
 * aturan di bawah. Tanpa cast, tsc yang memastikan barisnya nyata.
 */
function baris(p: {
  id: string;
  isDineIn: boolean;
  sajianTakeaway: boolean;
}): PesananItemRow {
  return {
    id: p.id,
    nama: "Nasi Goreng",
    qty: 1,
    qty_refund: 0,
    catatan: null,
    is_dine_in: p.isDineIn,
    status: "dikerjakan",
    sajian_takeaway: p.sajianTakeaway,
    status_oleh: null,
    status_pada: null,
  };
}

/**
 * `saleDineIn` = `sales.is_dine_in`, fakta pembukuan SELURUH transaksi;
 * `baris[].isDineIn` = penanda tiap baris, yang boleh berbeda karena kasir
 * bisa membungkus satu porsi di meja yang makan di tempat.
 *
 * `saleDineIn` sengaja tetap disertakan meski `adaKoreksiSajian` tak memakainya:
 * tanpa itu, menanam ulang cacat "bandingkan dengan penanda KARTU" hanya
 * menghasilkan `=== undefined` yang selalu false — merah karena alasan yang
 * salah, dan kasus campur-dari-kasir justru lolos.
 */
function kartu(p: {
  dibayar: boolean;
  saleDineIn: boolean;
  baris: { isDineIn: boolean; sajianTakeaway: boolean }[];
}): Pick<PesananRow, "dibayar" | "is_dine_in" | "items"> {
  return {
    dibayar: p.dibayar,
    is_dine_in: p.saleDineIn,
    items: p.baris.map((b, i) => baris({ id: `i${i}`, ...b })),
  };
}

/** Baris apa adanya dari kasir: `sajian_takeaway` = kebalikan `is_dine_in`. */
const asli = (isDineIn: boolean) => ({ isDineIn, sajianTakeaway: !isDineIn });
/** Baris yang penyajiannya DIBALIK di papan sesudah transaksi ditutup. */
const dibalik = (isDineIn: boolean) => ({ isDineIn, sajianTakeaway: isDineIn });

describe("papan pesanan: koreksi penyajian sesudah transaksi", () => {
  it("dine-in utuh: tak ada koreksi", () => {
    expect(
      adaKoreksiSajian(
        kartu({
          dibayar: true,
          saleDineIn: true,
          baris: [asli(true), asli(true)],
        }),
      ),
    ).toBe(false);
  });

  it("bawa pulang utuh: tak ada koreksi", () => {
    expect(
      adaKoreksiSajian(
        kartu({
          dibayar: true,
          saleDineIn: false,
          baris: [asli(false), asli(false)],
        }),
      ),
    ).toBe(false);
  });

  /**
   * Pesanan CAMPUR yang ditetapkan KASIR, bukan dibalik di papan.
   *
   * Satu orang di meja minta porsinya dibungkus (`dine_in_override`), sisanya
   * makan di tempat. Barisnya sah sejak lahir — tak ada yang dikoreksi, dan
   * menuduhnya "diubah setelah transaksi" adalah tuduhan palsu ke kasir.
   * Membandingkan baris dengan penanda KARTU justru menghasilkan tuduhan itu.
   */
  it("campur dari kasir (dine_in_override): BUKAN koreksi", () => {
    expect(
      adaKoreksiSajian(
        kartu({
          dibayar: true,
          saleDineIn: true,
          baris: [asli(true), asli(false)],
        }),
      ),
    ).toBe(false);
  });

  it("dine-in, SEMUA baris dibungkus di papan: koreksi", () => {
    expect(
      adaKoreksiSajian(
        kartu({
          dibayar: true,
          saleDineIn: true,
          baris: [dibalik(true), dibalik(true)],
        }),
      ),
    ).toBe(true);
  });

  /** Cacat aslinya: agregat kartu tinggal false, jadi papan diam. */
  it("dine-in, SEBAGIAN dibungkus di papan: TETAP koreksi", () => {
    const p = kartu({
      dibayar: true,
      saleDineIn: true,
      baris: [dibalik(true), asli(true)],
    });
    // Agregat kartu memang false — dan justru itu sebabnya ia tak boleh dipakai.
    expect(ringkasPesanan(p.items).sajian_takeaway).toBe(false);
    expect(adaKoreksiSajian(p)).toBe(true);
  });

  it("bawa pulang, SEMUA dikembalikan ke tempat: koreksi", () => {
    expect(
      adaKoreksiSajian(
        kartu({
          dibayar: true,
          saleDineIn: false,
          baris: [dibalik(false), dibalik(false)],
        }),
      ),
    ).toBe(true);
  });

  it("bawa pulang, SEBAGIAN dikembalikan ke tempat: koreksi", () => {
    expect(
      adaKoreksiSajian(
        kartu({
          dibayar: true,
          saleDineIn: false,
          baris: [dibalik(false), asli(false)],
        }),
      ),
    ).toBe(true);
  });

  it("belum dibayar: tak pernah koreksi — biayanya belum terbuku", () => {
    // Bill terbuka boleh ditandai bebas; penandanya baru sampai ke angka saat
    // dibayar, jadi tak ada pembukuan yang dikoreksi.
    expect(
      adaKoreksiSajian(
        kartu({ dibayar: false, saleDineIn: true, baris: [dibalik(true)] }),
      ),
    ).toBe(false);
    expect(
      adaKoreksiSajian(
        kartu({ dibayar: false, saleDineIn: false, baris: [dibalik(false)] }),
      ),
    ).toBe(false);
  });

  it("kartu tanpa baris: tak ada yang dikoreksi", () => {
    // Rumus lama (lewat agregat kartu) memberi `false === false` → true untuk
    // penjualan bawa pulang tanpa baris: koreksi pada pesanan tanpa sajian.
    expect(
      adaKoreksiSajian(kartu({ dibayar: true, saleDineIn: false, baris: [] })),
    ).toBe(false);
  });
});
