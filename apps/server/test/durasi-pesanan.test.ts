import { describe, expect, it } from "vitest";
import {
  durasiPesananDetik,
  ringkasPesanan,
  type PesananItemRow,
  type PesananStatus,
} from "@kakarut/shared";

/**
 * LAMA PENGERJAAN PESANAN — dan tiga cara diam-diam salahnya.
 *
 * Angka ini masuk ke laporan yang dipakai menilai dapur, jadi arah salahnya
 * penting, bukan cuma besarnya:
 *
 *   1. NOL BUKAN "TAK ADA". Baris yang belum selesai, batal, atau tak pernah
 *      ditandai harus `null`. Menghitungnya 0 membuat shift yang paling lalai
 *      mencatat terlihat paling cepat — persis kebalikan dari yang benar.
 *
 *   2. DURASI KARTU BUKAN JUMLAH BARISNYA. Dapur mengerjakan beberapa sajian
 *      sekaligus; menjumlahkan tiap baris melaporkan penantian yang tak pernah
 *      terjadi. Yang benar: baris paling awal masuk → baris paling akhir keluar.
 *
 *   3. WAKTU MASUK ITU PER BARIS. Satu bill hidup berjam-jam dan pesanannya
 *      datang bergelombang; memakai waktu bill akan melaporkan dapur bekerja
 *      dua jam untuk segelas es teh yang dipesan lima menit lalu.
 *
 * Aturannya tinggal di `@kakarut/shared` karena server memakainya saat menyusun
 * `GET /api/pesanan` dan web memakainya saat memperbarui kartu secara
 * optimistis. Dua salinan berarti angka yang sama tampil berbeda di layar yang
 * sama, dan bedanya baru terlihat saat polling menimpanya.
 */

function baris(p: Partial<PesananItemRow> & { id: string }): PesananItemRow {
  return {
    nama: `Menu ${p.id}`,
    qty: 1,
    qty_refund: 0,
    catatan: null,
    is_dine_in: true,
    status: "dikerjakan" as PesananStatus,
    sajian_takeaway: false,
    status_oleh: null,
    status_pada: null,
    masuk_pada: "2026-01-01T10:00:00.000Z",
    durasi_detik: null,
    ...p,
  };
}

/** Baris selesai `d` detik sesudah masuk. */
function selesai(id: string, masukIso: string, detik: number): PesananItemRow {
  return baris({
    id,
    status: "selesai",
    masuk_pada: masukIso,
    status_pada: new Date(Date.parse(masukIso) + detik * 1000).toISOString(),
  });
}

describe("durasiPesananDetik (per baris)", () => {
  it("baris selesai: selisih masuk → ditandai, dalam detik", () => {
    expect(durasiPesananDetik(selesai("a", "2026-01-01T10:00:00.000Z", 305))).toBe(305);
  });

  it("baris masih dikerjakan → null, BUKAN 0", () => {
    // 0 berarti "keluar seketika". Pesanan yang masih di wajan bukan itu.
    expect(durasiPesananDetik(baris({ id: "a" }))).toBeNull();
  });

  it("baris batal → null (tak ada pekerjaan yang rampung)", () => {
    expect(
      durasiPesananDetik(
        baris({ id: "a", status: "batal", status_pada: "2026-01-01T10:05:00.000Z" }),
      ),
    ).toBeNull();
  });

  it("selesai tapi tak berwaktu (data lama) → null", () => {
    // Baris warisan dari sebelum fitur ini ada. Menebaknya 0 mencemari
    // rata-rata seluruh menu tanpa satu pun tanda di layar.
    expect(durasiPesananDetik(baris({ id: "a", status: "selesai", status_pada: null }))).toBeNull();
  });

  it("jam yang mundur tidak melahirkan durasi negatif", () => {
    // Terjadi nyata saat server disinkronkan NTP di tengah shift.
    const b = baris({
      id: "a",
      status: "selesai",
      masuk_pada: "2026-01-01T10:05:00.000Z",
      status_pada: "2026-01-01T10:00:00.000Z",
    });
    expect(durasiPesananDetik(b)).toBe(0);
  });
});

describe("durasi kartu (lewat ringkasPesanan)", () => {
  it("BUKAN jumlah baris — dari yang paling awal masuk ke yang paling akhir keluar", () => {
    // Dua sajian dimasak berbarengan: masing-masing 300 dtk dan 600 dtk, tapi
    // tamu menunggu 600 dtk, bukan 900.
    const items = [
      selesai("a", "2026-01-01T10:00:00.000Z", 300),
      selesai("b", "2026-01-01T10:00:00.000Z", 600),
    ];
    expect(ringkasPesanan(items).durasi_detik).toBe(600);
  });

  it("ronde kedua: dihitung dari baris paling awal, bukan dari yang terakhir masuk", () => {
    const items = [
      selesai("a", "2026-01-01T10:00:00.000Z", 300), // selesai 10:05
      selesai("b", "2026-01-01T10:20:00.000Z", 120), // masuk 10:20, selesai 10:22
    ];
    // 10:00 → 10:22 = 1320 dtk.
    expect(ringkasPesanan(items).durasi_detik).toBe(1320);
  });

  it("masih ada satu baris dikerjakan → null (kartu belum rampung)", () => {
    const items = [selesai("a", "2026-01-01T10:00:00.000Z", 300), baris({ id: "b" })];
    expect(ringkasPesanan(items).durasi_detik).toBeNull();
  });

  it("baris batal tidak MENAHAN kartu jadi rampung", () => {
    // Sajian yang dibatalkan bukan pekerjaan yang tertunda — kartunya tetap
    // boleh rampung, dan durasinya diukur dari baris yang benar-benar dibuat.
    const items = [
      selesai("a", "2026-01-01T10:00:00.000Z", 300),
      baris({ id: "b", status: "batal" }),
    ];
    expect(ringkasPesanan(items).durasi_detik).toBe(300);
  });

  it("baris batal juga tidak IKUT menentukan kapan mulai/selesai", () => {
    // Baris batal masuk jauh lebih awal. Kalau ia ikut dihitung, kartunya
    // seolah-olah ditunggu satu jam lebih lama daripada kenyataannya.
    const items = [
      baris({
        id: "batal",
        status: "batal",
        masuk_pada: "2026-01-01T09:00:00.000Z",
        status_pada: "2026-01-01T09:01:00.000Z",
      }),
      selesai("a", "2026-01-01T10:00:00.000Z", 300),
    ];
    expect(ringkasPesanan(items).durasi_detik).toBe(300);
  });

  it("SELURUH baris batal → null, bukan 0", () => {
    const items = [
      baris({ id: "a", status: "batal", status_pada: "2026-01-01T10:01:00.000Z" }),
      baris({ id: "b", status: "batal", status_pada: "2026-01-01T10:02:00.000Z" }),
    ];
    expect(ringkasPesanan(items).durasi_detik).toBeNull();
  });

  it("kartu tanpa baris → null (bill kosong bukan bill yang rampung seketika)", () => {
    expect(ringkasPesanan([]).durasi_detik).toBeNull();
  });

  it("satu baris selesai tanpa waktu membuat kartunya null, bukan salah hitung", () => {
    const items = [
      selesai("a", "2026-01-01T10:00:00.000Z", 300),
      baris({ id: "b", status: "selesai", status_pada: null }),
    ];
    expect(ringkasPesanan(items).durasi_detik).toBeNull();
  });
});
