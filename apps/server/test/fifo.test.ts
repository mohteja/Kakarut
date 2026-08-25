import { describe, expect, it } from "vitest";
import { jalankanFifo, type FifoEvent } from "../src/lib/fifo";

const masuk = (
  waktu: string,
  qty: number,
  hargaSatuan: number | null,
  jenis: "beli" | "produksi" | "transfer" = "beli",
): FifoEvent => ({
  ev: "masuk",
  waktu,
  jenis,
  nomor: null,
  supplier: null,
  qty,
  hargaSatuan,
  expDate: null,
});
const keluar = (
  waktu: string,
  qty: number,
  jenis: "penjualan" | "pemakaian" | "kirim" = "penjualan",
): FifoEvent => ({ ev: "keluar", waktu, jenis, keterangan: null, qty });
const opname = (waktu: string, qty: number): FifoEvent => ({
  ev: "opname",
  waktu,
  qty,
  keterangan: null,
});

describe("jalankanFifo", () => {
  it("konsumsi satu lot: terpakai & sisa tercatat, hpp = qty × harga", () => {
    const r = jalankanFifo([masuk("t1", 10, 1000), keluar("t2", 4)], null);
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0]).toMatchObject({ qty_masuk: 10, terpakai: 4, sisa: 6 });
    expect(r.pemakaian[0].hpp).toBe(4000);
    expect(r.pemakaian[0].rincian).toEqual([{ lot: 0, qty: 4, harga_satuan: 1000 }]);
    expect(r.saldo).toBe(6);
    expect(r.defisit).toBe(0);
  });

  it("lintas lot: lot paling awal habis dulu (FIFO)", () => {
    const r = jalankanFifo(
      [masuk("t1", 10, 1000), masuk("t2", 5, 2000), keluar("t3", 12)],
      null,
    );
    expect(r.lots[0]).toMatchObject({ terpakai: 10, sisa: 0 });
    expect(r.lots[1]).toMatchObject({ terpakai: 2, sisa: 3 });
    // 10×1000 + 2×2000
    expect(r.pemakaian[0].hpp).toBe(14000);
    expect(r.pemakaian[0].rincian).toHaveLength(2);
    expect(r.saldo).toBe(3);
  });

  it("stok minus: keluar tanpa lot → defisit, tertutup lot masuk berikutnya", () => {
    const r = jalankanFifo([keluar("t1", 3), masuk("t2", 10, 500)], null);
    expect(r.pemakaian[0].hpp).toBeNull();
    expect(r.pemakaian[0].rincian).toEqual([{ lot: null, qty: 3, harga_satuan: null }]);
    // lot baru langsung menutup defisit 3
    expect(r.lots[0]).toMatchObject({ qty_masuk: 10, terpakai: 3, sisa: 7 });
    expect(r.defisit).toBe(0);
    expect(r.saldo).toBe(7);
  });

  it("opname turun: selisih dikonsumsi FIFO sebagai pemakaian 'opname'", () => {
    const r = jalankanFifo([masuk("t1", 10, 1000), opname("t2", 6)], null);
    expect(r.lots[0]).toMatchObject({ terpakai: 4, sisa: 6 });
    expect(r.pemakaian[0]).toMatchObject({ jenis: "opname", qty: 4, hpp: 4000 });
    expect(r.saldo).toBe(6);
  });

  it("opname naik: selisih jadi lot penyesuaian berharga acuan", () => {
    const r = jalankanFifo([masuk("t1", 2, 1000), opname("t2", 9)], 750);
    expect(r.lots).toHaveLength(2);
    expect(r.lots[1]).toMatchObject({
      jenis: "opname",
      qty_masuk: 7,
      sisa: 7,
      harga_satuan: 750,
      harga_acuan: true,
    });
    expect(r.saldo).toBe(9);
  });

  it("opname naik saat defisit: defisit tertutup dulu, sisanya jadi lot", () => {
    const r = jalankanFifo([keluar("t1", 2), opname("t2", 5)], 100);
    expect(r.defisit).toBe(0);
    // reset ke 5 dari saldo −2 → +7: 2 menutup defisit, 5 jadi lot
    expect(r.lots[0]).toMatchObject({ jenis: "opname", qty_masuk: 5, sisa: 5 });
    expect(r.saldo).toBe(5);
  });

  it("lot tanpa harga (produksi/transfer): rincian tetap, hpp null", () => {
    const r = jalankanFifo(
      [masuk("t1", 4, null, "produksi"), masuk("t2", 4, 1000), keluar("t3", 6, "pemakaian")],
      null,
    );
    expect(r.pemakaian[0].hpp).toBeNull();
    expect(r.pemakaian[0].rincian).toEqual([
      { lot: 0, qty: 4, harga_satuan: null },
      { lot: 1, qty: 2, harga_satuan: 1000 },
    ]);
    expect(r.saldo).toBe(2);
  });

  it("pecahan (qty desimal) tidak menyisakan residu epsilon", () => {
    const r = jalankanFifo(
      [masuk("t1", 0.3, 1000), masuk("t2", 0.3, 1000), keluar("t3", 0.6)],
      null,
    );
    expect(r.lots[0].sisa).toBe(0);
    expect(r.lots[1].sisa).toBe(0);
    expect(Math.abs(r.saldo)).toBeLessThan(1e-6);
    expect(r.defisit).toBe(0);
  });

  it("kirim keluar mengonsumsi lot seperti pemakaian biasa", () => {
    const r = jalankanFifo([masuk("t1", 10, 1000), keluar("t2", 7, "kirim")], null);
    expect(r.pemakaian[0]).toMatchObject({ jenis: "kirim", qty: 7, hpp: 7000 });
    expect(r.saldo).toBe(3);
  });

  it("mode fifo tidak mengisi harga_rata", () => {
    const r = jalankanFifo([masuk("t1", 10, 1000), keluar("t2", 4)], null, "fifo");
    expect(r.pemakaian[0].harga_rata).toBeNull();
  });
});

describe("jalankanFifo — metode average (rata-rata bergerak)", () => {
  it("membebankan rata-rata seluruh sisa stok, bukan harga lot tertua", () => {
    const ev = [masuk("t1", 10, 1000), masuk("t2", 10, 2000), keluar("t3", 5)];
    // (10×1000 + 10×2000) ÷ 20 = 1500 → 5 × 1500
    const avg = jalankanFifo(ev, null, "average");
    expect(avg.pemakaian[0].harga_rata).toBe(1500);
    expect(avg.pemakaian[0].hpp).toBe(7500);
    // pembeda dari FIFO: metode ini benar-benar mengubah angkanya
    expect(jalankanFifo(ev, null, "fifo").pemakaian[0].hpp).toBe(5000);
  });

  it("aliran fisik tetap FIFO: lot tertua yang terkuras & saldo tak berubah", () => {
    const ev = [masuk("t1", 10, 1000), masuk("t2", 10, 2000), keluar("t3", 12)];
    const avg = jalankanFifo(ev, null, "average");
    const fifo = jalankanFifo(ev, null, "fifo");
    expect(avg.lots[0]).toMatchObject({ terpakai: 10, sisa: 0 });
    expect(avg.lots[1]).toMatchObject({ terpakai: 2, sisa: 8 });
    expect(avg.pemakaian[0].rincian).toEqual(fifo.pemakaian[0].rincian);
    expect(avg.saldo).toBe(fifo.saldo);
    expect(avg.defisit).toBe(fifo.defisit);
    // biayanya yang berbeda: 12 × 1500 vs (10×1000 + 2×2000)
    expect(avg.pemakaian[0].hpp).toBe(18000);
    expect(fifo.pemakaian[0].hpp).toBe(14000);
  });

  it("rata-rata BERGERAK: lot masuk baru mengubah biaya pemakaian berikutnya", () => {
    const r = jalankanFifo(
      [masuk("t1", 10, 1000), keluar("t2", 5), masuk("t3", 5, 2000), keluar("t4", 5)],
      null,
      "average",
    );
    // pemakaian 1: sisa 10 @1000 → rata 1000
    expect(r.pemakaian[0]).toMatchObject({ harga_rata: 1000, hpp: 5000 });
    // pemakaian 2: sisa 5@1000 + 5@2000 → rata 1500
    expect(r.pemakaian[1]).toMatchObject({ harga_rata: 1500, hpp: 7500 });
  });

  it("satu lot tanpa harga membuat rata-rata (dan biaya) tak diketahui", () => {
    const r = jalankanFifo(
      [masuk("t1", 5, null, "produksi"), masuk("t2", 5, 1000), keluar("t3", 2)],
      null,
      "average",
    );
    expect(r.pemakaian[0].harga_rata).toBeNull();
    expect(r.pemakaian[0].hpp).toBeNull();
    // fisik tetap tercatat: lot tertua yang keluar
    expect(r.pemakaian[0].rincian).toEqual([{ lot: 0, qty: 2, harga_satuan: null }]);
  });

  it("stok minus: biaya tetap null walau sisa stok berharga", () => {
    const r = jalankanFifo(
      [masuk("t1", 2, 1000), keluar("t2", 5)],
      null,
      "average",
    );
    expect(r.pemakaian[0].hpp).toBeNull();
    expect(r.defisit).toBe(3);
  });

  it("keluar saat stok kosong: rata-rata null, tetap jadi defisit", () => {
    const r = jalankanFifo([keluar("t1", 3), masuk("t2", 10, 500)], null, "average");
    expect(r.pemakaian[0].harga_rata).toBeNull();
    expect(r.pemakaian[0].hpp).toBeNull();
    expect(r.defisit).toBe(0);
    expect(r.saldo).toBe(7);
  });

  it("opname turun memakai rata-rata juga", () => {
    const r = jalankanFifo(
      [masuk("t1", 10, 1000), masuk("t2", 10, 3000), opname("t3", 16)],
      null,
      "average",
    );
    // rata (10×1000 + 10×3000) ÷ 20 = 2000; selisih turun 4 → 8000
    expect(r.pemakaian[0]).toMatchObject({ jenis: "opname", qty: 4, harga_rata: 2000, hpp: 8000 });
    expect(r.saldo).toBe(16);
  });

  it("lot penyesuaian opname naik ikut menarik rata-rata ke harga acuan", () => {
    const r = jalankanFifo(
      [masuk("t1", 5, 1000), opname("t2", 10), keluar("t3", 4)],
      2000,
      "average",
    );
    // opname naik +5 berharga acuan 2000 → sisa 5@1000 + 5@2000 → rata 1500
    expect(r.pemakaian[0]).toMatchObject({ harga_rata: 1500, hpp: 6000 });
  });
});

/**
 * PEMBANDING FIFO YANG DIUKUR, BUKAN DIRASA.
 *
 * `fifo.ts` memakai `EPS = 1e-9` — konstanta telanjang, tanpa satu kalimat
 * tentang asalnya. Vena B⁷ sudah mengukur bahwa angka itu BERHENTI BERARTI
 * begitu besarannya ≥ 10⁷: ULP double di sana 1,86e-9, lebih besar dari
 * EPS-nya sendiri. `BATAS_QTY_STOK` = 9.999.999.999, jadi besaran itu ada DI
 * DALAM rentang yang skema izinkan — bukan angka khayalan.
 *
 * Diukur atas `jalankanFifo` langsung (fungsi murni), masuk 2 lot pecahan lalu
 * keluar SELURUHNYA:
 *
 *   N=10³ · 10⁶  sisa 0 · saldo 0 · defisit 0 · hpp terisi   ← sehat
 *   N=10⁷        sisa lot 1,86e-9 · saldo 1,86e-9            ← lot hantu
 *   N=10⁸        saldo −1,49e-8 · defisit 1,49e-8 · hpp NULL ← stok minus palsu
 *   N=10⁹        saldo −1,19e-7 · defisit 1,19e-7 · hpp NULL
 *
 * Dua baris terakhir itu kelas yang sama dengan temuan B⁷ ("stok yang PERSIS
 * cukup ditolak"), dipindahkan ke jalur BIAYA: kartu FIFO melaporkan stok
 * minus dan menolak menyebut HPP untuk pemakaian yang aritmetikanya eksak.
 */
describe("pembanding FIFO ikut besaran, bukan konstanta firasat", () => {
  /** Dua lot pecahan sebesar N, lalu keluar tepat sejumlah keduanya. */
  const habiskan = (N: number, metode: "fifo" | "average" = "fifo") => {
    const a = N + 0.1;
    const b = N + 0.2;
    return jalankanFifo(
      [masuk("t1", a, 1000), masuk("t2", b, 2000), keluar("t3", a + b)],
      null,
      metode,
    );
  };

  it("DETEKTOR TERBUKTI: `1e-9` memang lebih kecil dari derau float di 10⁷", () => {
    // Kalau premis ini tak bisa gagal, seluruh vena ini tak menyatakan apa pun.
    const ulp = (x: number) => 2 ** (Math.ceil(Math.log2(Math.abs(x))) - 53);
    expect(ulp(1e6)).toBeLessThan(1e-9);
    expect(ulp(1e7)).toBeGreaterThan(1e-9);
    // …dan aritmetikanya memang menyisakan derau sebesar itu
    const a = 1e7 + 0.1;
    const b = 1e7 + 0.2;
    expect(a + b - a - b).not.toBe(0);
  });

  it("KONTROL: besaran biasa (10³ & 10⁶) memang sudah bersih", () => {
    for (const N of [1e3, 1e6]) {
      const r = habiskan(N);
      expect(r.lots.map((l) => l.sisa), `N=${N}`).toEqual([0, 0]);
      expect(r.saldo, `N=${N}`).toBe(0);
      expect(r.defisit, `N=${N}`).toBe(0);
    }
  });

  it("10⁷: lot yang HABIS tidak boleh menyisakan lot hantu", () => {
    const r = habiskan(1e7);
    expect(r.lots.map((l) => l.sisa)).toEqual([0, 0]);
    expect(r.saldo).toBe(0);
  });

  it("10⁸ & 10⁹: habis TEPAT bukan stok minus, dan HPP-nya tetap diketahui", () => {
    for (const N of [1e8, 1e9]) {
      const r = habiskan(N);
      expect(r.defisit, `defisit palsu pada N=${N}`).toBe(0);
      expect(r.saldo, `saldo minus palsu pada N=${N}`).toBe(0);
      expect(r.pemakaian[0].hpp, `HPP jadi "tidak diketahui" pada N=${N}`).not.toBeNull();
      // …dan tanpa baris hantu ber-lot null di kartunya
      expect(r.pemakaian[0].rincian.every((x) => x.lot != null), `baris hantu pada N=${N}`).toBe(
        true,
      );
    }
  });

  it("PASANGAN: sisa NYATA sebesar satu unit kolom (1e-6) tidak ikut disnap", () => {
    // Pembanding yang terlalu longgar menelan sisa yang benar-benar ada —
    // kerusakan yang lebih sunyi daripada yang diperbaiki. ½ unit skala 6 =
    // 5e-7, jadi 1e-6 harus selamat.
    const r = jalankanFifo([masuk("t1", 10, 1000), keluar("t2", 10 - 0.000001)], null);
    expect(r.lots[0].sisa).toBe(0.000001);
    expect(r.saldo).toBe(0.000001);
  });

  it("PASANGAN: defisit NYATA tetap tercatat sebagai stok minus", () => {
    const r = jalankanFifo([masuk("t1", 10, 1000), keluar("t2", 12)], null);
    expect(r.defisit).toBe(2);
    expect(r.saldo).toBe(-2);
    expect(r.pemakaian[0].hpp).toBeNull();
  });

  it("PUNCAK RENTANG (≈4,9e9): pembulatan saja TIDAK cukup — toleransinya yang membayar", () => {
    /*
     * Pengukuran yang meralat langkah pertamaku sendiri.
     *
     * Bukti merah versi pertama TIDAK MENDARAT: mengembalikan `EPS` ke `1e-9`
     * membuat seluruh uji tetap hijau, karena pembulatan ke skala kolom sudah
     * menghapus gejalanya pada 10⁷–10⁹. Artinya klaim "toleransinya yang
     * memperbaiki" waktu itu belum terbukti — dan tak boleh ditulis.
     *
     * Yang memisahkan keduanya besaran di PUNCAK rentang yang skema izinkan
     * (`BATAS_QTY_STOK` = 9.999.999.999). Di sana lantai derau float (≈2,3e-6)
     * MELEWATI satu unit kolom, jadi sisa hasil pembulatan mendarat tepat di
     * 0,000001 — bukan nol — dan `1e-9` tak sanggup menyentuhnya:
     *
     *   dengan `1e-9`              sisa lot 0.000001 · saldo 0.000001 (abadi)
     *   dengan `toleransiBanding`  keduanya 0
     *
     * Jadi kedua paruh perbaikan ini membayar BAND YANG BERBEDA: pembulatan
     * untuk 10⁷–10⁹, toleransi sadar-besaran untuk puncaknya.
     */
    for (const N of [4.9e9, 4.99e9]) {
      const a = N + 0.1;
      const b = N + 0.2;
      const r = jalankanFifo(
        [masuk("t1", a, 1000), masuk("t2", b, 2000), keluar("t3", a + b)],
        null,
      );
      expect(r.lots.map((l) => l.sisa), `sisa hantu 1 unit kolom pada N=${N}`).toEqual([0, 0]);
      expect(r.saldo, `saldo hantu pada N=${N}`).toBe(0);
    }
  });

  it("PASANGAN: besaran tinggi yang memang bersisa tetap punya sisanya", () => {
    const r = jalankanFifo([masuk("t1", 1e8, 1000), keluar("t2", 1e8 - 5)], null);
    expect(r.lots[0].sisa).toBe(5);
    expect(r.saldo).toBe(5);
  });
});
