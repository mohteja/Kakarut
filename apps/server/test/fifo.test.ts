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
});
