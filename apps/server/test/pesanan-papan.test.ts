import { describe, expect, it } from "vitest";
import {
  kunciUrutPesanan,
  ringkasPesanan,
  turunkanStatusPesanan,
  urutkanPesanan,
  type PesananItemRow,
} from "@kakarut/shared";

/** Baris papan minimal — hanya field yang dipakai penurunan status. */
function baris(p: Partial<PesananItemRow> & { id: string }): PesananItemRow {
  return {
    nama: `Menu ${p.id}`,
    qty: 1,
    qty_refund: 0,
    catatan: null,
    is_dine_in: true,
    status: "dikerjakan",
    sajian_takeaway: false,
    status_oleh: null,
    status_pada: null,
    // Waktu masuk wajib ada — bawaan tetap supaya uji penurunan status di
    // bawah tak ikut bergantung pada jam berjalan.
    masuk_pada: "2026-01-01T10:00:00.000Z",
    durasi_detik: null,
    ...p,
  };
}

describe("turunkanStatusPesanan", () => {
  it("kartu tanpa baris = dikerjakan (bill kosong jangan langsung mendarat di Selesai)", () => {
    expect(turunkanStatusPesanan([])).toBe("dikerjakan");
  });

  it("semua baris batal = kartu batal", () => {
    expect(turunkanStatusPesanan([{ status: "batal" }, { status: "batal" }])).toBe("batal");
  });

  it("satu baris masih dikerjakan = kartu dikerjakan, walau yang lain sudah selesai", () => {
    expect(turunkanStatusPesanan([{ status: "selesai" }, { status: "dikerjakan" }])).toBe(
      "dikerjakan",
    );
  });

  it("separuh selesai separuh batal = kartu selesai (dapur tak punya sisa kerja)", () => {
    expect(turunkanStatusPesanan([{ status: "selesai" }, { status: "batal" }])).toBe("selesai");
  });

  it("satu baris batal saja TIDAK membuat kartu batal kalau yang lain masih jalan", () => {
    expect(turunkanStatusPesanan([{ status: "batal" }, { status: "dikerjakan" }])).toBe(
      "dikerjakan",
    );
  });
});

describe("ringkasPesanan", () => {
  it("menghitung selesai/batal dan mengambil jejak baris yang PALING BARU disentuh", () => {
    const r = ringkasPesanan([
      baris({ id: "a", status: "selesai", status_oleh: "Budi", status_pada: "2026-07-30T02:00:00Z" }),
      baris({ id: "b", status: "batal", status_oleh: "Sari", status_pada: "2026-07-30T05:00:00Z" }),
      baris({ id: "c", status: "selesai", status_oleh: "Ali", status_pada: "2026-07-30T03:00:00Z" }),
    ]);
    expect(r.item_selesai).toBe(2);
    expect(r.item_batal).toBe(1);
    expect(r.status).toBe("selesai");
    // Sari menyentuh paling akhir → dialah yang tercatat di kartu
    expect(r.status_oleh).toBe("Sari");
    expect(r.status_pada).toBe("2026-07-30T05:00:00Z");
  });

  it("kartu bawa pulang hanya bila SEMUA barisnya bawa pulang", () => {
    expect(
      ringkasPesanan([
        baris({ id: "a", sajian_takeaway: true }),
        baris({ id: "b", sajian_takeaway: true }),
      ]).sajian_takeaway,
    ).toBe(true);
    expect(
      ringkasPesanan([
        baris({ id: "a", sajian_takeaway: true }),
        baris({ id: "b", sajian_takeaway: false }),
      ]).sajian_takeaway,
    ).toBe(false);
    // kartu kosong bukan kartu bawa pulang
    expect(ringkasPesanan([]).sajian_takeaway).toBe(false);
  });

  it("kartu yang belum pernah disentuh tak punya jejak", () => {
    const r = ringkasPesanan([baris({ id: "a" })]);
    expect(r.status_oleh).toBeNull();
    expect(r.status_pada).toBeNull();
  });
});

describe("urutan papan: yang terakhir DIUBAH di atas", () => {
  it("kartu yang baru disentuh mengalahkan pesanan yang masuk lebih baru", () => {
    const lamaTapiBaruDisentuh = {
      waktu: "2026-07-30T01:00:00Z",
      status_pada: "2026-07-30T09:00:00Z",
    };
    const baruMasukBelumDisentuh = { waktu: "2026-07-30T08:00:00Z", status_pada: null };
    expect(urutkanPesanan([baruMasukBelumDisentuh, lamaTapiBaruDisentuh])[0]).toBe(
      lamaTapiBaruDisentuh,
    );
  });

  it("kartu yang belum disentuh jatuh ke waktu masuknya, jadi pesanan baru tetap di atas", () => {
    const baru = { waktu: "2026-07-30T08:00:00Z", status_pada: null };
    const tua = { waktu: "2026-07-30T01:00:00Z", status_pada: null };
    expect(urutkanPesanan([tua, baru])[0]).toBe(baru);
  });

  it("status_pada yang lebih TUA dari waktu masuk tak menenggelamkan kartunya", () => {
    // bisa terjadi bila baris disentuh lalu bill-nya dibayar (waktu penjualan
    // lebih baru dari sentuhan terakhirnya)
    expect(
      kunciUrutPesanan({ waktu: "2026-07-30T08:00:00Z", status_pada: "2026-07-30T01:00:00Z" }),
    ).toBe("2026-07-30T08:00:00Z");
  });

  it("tidak mengubah array masukan", () => {
    const rows = [
      { waktu: "2026-07-30T01:00:00Z", status_pada: null },
      { waktu: "2026-07-30T09:00:00Z", status_pada: null },
    ];
    const salinan = [...rows];
    urutkanPesanan(rows);
    expect(rows).toEqual(salinan);
  });
});
