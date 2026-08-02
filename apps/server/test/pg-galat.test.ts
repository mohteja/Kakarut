import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bentrokUnik, nilaiTakSah } from "../src/lib/pg-galat";

/**
 * Penjaga PENERJEMAH GALAT POSTGRES.
 *
 * Dua kode yang bisa dilempar oleh input pemakai, bukan oleh kerusakan server:
 * 23505 (indeks unik) dan 22P02 (sintaks nilai tak sah — id cacat di alamat).
 * Keduanya harus keluar sebagai 4xx yang bisa dibaca.
 *
 * BENTUK GALATNYA yang jadi inti: drizzle membungkus galat driver, jadi
 * kodenya bisa ada di `err.code` MAUPUN `err.cause.code`. Pengenal yang cuma
 * memeriksa satu di antaranya akan diam persis pada separuh kasus nyata — dan
 * diamnya berarti 500. Karena itu kedua bentuk diuji, untuk kedua kode.
 */
function galat(kode: string, bersarang: boolean) {
  return bersarang
    ? Object.assign(new Error("gagal"), {
        cause: Object.assign(new Error("pg"), { code: kode }),
      })
    : Object.assign(new Error("gagal"), { code: kode });
}

describe("pengenal galat Postgres", () => {
  it("22P02 dikenali pada kedua bentuk pembungkusan", () => {
    expect(nilaiTakSah(galat("22P02", false))).toBe(true);
    expect(nilaiTakSah(galat("22P02", true))).toBe(true);
  });

  it("23505 dikenali pada kedua bentuk pembungkusan", () => {
    expect(bentrokUnik(galat("23505", false))).toBe(true);
    expect(bentrokUnik(galat("23505", true))).toBe(true);
  });

  it("keduanya tidak saling mengaku", () => {
    // Kalau tertukar, salah ketik nama meja akan dijawab "id tidak valid" dan
    // id cacat dijawab "sudah dipakai" — dua pesan yang menyesatkan sekaligus.
    expect(nilaiTakSah(galat("23505", true))).toBe(false);
    expect(bentrokUnik(galat("22P02", true))).toBe(false);
  });

  it("galat lain tidak diterjemahkan — 500 tetap 500", () => {
    // 23503 (foreign key), 40001 (serialisasi), dan galat biasa bukan salah
    // input klien; menjadikannya 4xx menyembunyikan kerusakan sungguhan.
    for (const kode of ["23503", "40001", "08006"]) {
      expect(nilaiTakSah(galat(kode, true))).toBe(false);
      expect(bentrokUnik(galat(kode, true))).toBe(false);
    }
    expect(nilaiTakSah(new Error("polos"))).toBe(false);
    expect(nilaiTakSah(null)).toBe(false);
    expect(nilaiTakSah(undefined)).toBe(false);
  });
});

/**
 * Terjemahannya harus terpasang di SATU pintu keluar galat.
 *
 * Bukan sekadar "fungsinya ada": versi pertama temuan ini nyaris berhenti di
 * `lib/` dan tak pernah dipanggil dari mana pun — persis nasib yang diratapi
 * header berkas itu sendiri ("bukan mereka menyalinnya, melainkan mereka tidak
 * memasangnya sama sekali").
 */
describe("app.onError memasang terjemahannya", () => {
  const app = readFileSync(
    fileURLToPath(new URL("../src/app.ts", import.meta.url)),
    "utf8",
  );

  it("22P02 dipetakan ke 400 di dalam onError", () => {
    const i = app.indexOf("app.onError");
    expect(i, "app.onError tak ditemukan").toBeGreaterThan(0);
    const badan = app.slice(i);
    expect(badan, "nilaiTakSah tak dipanggil di onError").toMatch(
      /nilaiTakSah\(err\)/,
    );
    // 400, bukan 500 — dan tetap dicatat.
    expect(badan).toMatch(
      /nilaiTakSah\(err\)\)[\s\S]{0,200}?catatGalat\(c,\s*400/,
    );
    expect(badan).toMatch(/nilaiTakSah\(err\)\)[\s\S]{0,300}?\},\s*400\)/);
  });
});
