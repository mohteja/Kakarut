/**
 * PERLENGKAPAN YANG SUDAH BERANGKAT TAK BISA "DIPAKAI" LAGI DI CK.
 *
 * Keluarga kedua dari cacat yang sama. §203 membetulkan pertanyaan "berapa yang
 * ADA di rak" (opname, stok awal, koreksi fisik). Yang ini pertanyaan lain —
 * "boleh DIPAKAI berapa" — dan ia pun memvalidasi terhadap saldo mentah.
 *
 * Terukur: CK 10 pcs yang seluruhnya sudah dikirim, `pakai 10` DITERIMA →
 * saldo 0, lalu toko menekan Terima → CK −10, total 0 dari 10 yang ada.
 *
 * PERILAKUNYA dijaga §204 verify-api lewat HTTP sungguhan, termasuk kekekalan
 * dan pasangan bahwa pemakaian yang sah tetap diterima.
 *
 * Yang dijaga di sini adalah SIFAT STRUKTURALNYA: semua pertanyaan tentang
 * "berapa" — dua keluarga, empat pintu — dijawab satu fungsi. Bukan empat
 * pengurangan yang kebetulan sama. Pintu kelima akan merah sebelum lahir.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baca = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const RUTE = baca("../src/modules/perlengkapan/routes.ts");

/** Badan satu handler, dari penandanya sampai penanda berikutnya. */
const blok = (mulai: string, sampai: string) => {
  const i = RUTE.indexOf(mulai);
  expect(i, `handler ${mulai} tak ditemukan`).toBeGreaterThan(0);
  const j = RUTE.indexOf(sampai, i + mulai.length);
  return RUTE.slice(i, j > i ? j : undefined);
};

describe("pemakaian divalidasi terhadap angka rak", () => {
  const PAKAI = blok('"/:id/pakai"', '"/:id/koreksi"');

  it("pembandingnya `saldoDiRakPerlengkapan`, bukan ledger mentah", () => {
    expect(PAKAI).toMatch(/saldoDiRakPerlengkapan\(db, auth\.company_id!, branchId, \[item\.id\]\)/);
    expect(PAKAI).not.toMatch(/await saldoSatuPerlengkapan\(item\.id, branchId\)/);
  });

  it("penjaganya masih ada — ini bukan pelonggaran", () => {
    // Perbaikan yang benar MEMPERKETAT: yang tadinya lolos kini ditolak.
    // Kalau penjaganya ikut hilang, seluruh pemakaian jadi bebas.
    expect(PAKAI).toMatch(/if \(body\.qty > saldo\)/);
    expect(PAKAI).toContain("Stok tidak cukup");
  });

  it("dan pesannya memakai angka yang sama dengan yang dibandingkan", () => {
    // Menolak dengan menyebut saldo BUKU ("saldo 6") pada rak kosong membaca
    // seperti galat sistem, bukan seperti keterangan.
    expect(PAKAI).toMatch(/saldo \$\{saldo\}/);
  });
});

describe("empat pintu, dua keluarga, satu fungsi", () => {
  it("tak satu pun menghitung pengurangannya sendiri", () => {
    const pintu = {
      "stok-awal": blok('"/stok-awal"', '"/opname"'),
      pakai: blok('"/:id/pakai"', '"/:id/koreksi"'),
      koreksi: blok('"/:id/koreksi"', '.put('),
    };
    for (const [nama, isi] of Object.entries(pintu)) {
      expect(isi.length, `blok ${nama} tak ditemukan`).toBeGreaterThan(100);
      expect(isi, nama).toMatch(/saldoDiRakPerlengkapan\(/);
      // Salinan aturannya di tempat lain = pintu berikutnya yang akan lupa.
      expect(isi, nama).not.toMatch(/dalamJalan\.get\(/);
    }
  });

  it("pintu keempat (opname) ada di service dan juga lewat fungsi yang sama", () => {
    const SERVICE = baca("../src/modules/perlengkapan/service.ts");
    const i = SERVICE.indexOf("export async function buatOpnamePerlengkapan");
    expect(i).toBeGreaterThan(0);
    const opname = SERVICE.slice(i, SERVICE.indexOf("\nexport ", i + 10));
    expect(opname).toMatch(/saldoDiRakPerlengkapan\(tx,/);
  });
});
