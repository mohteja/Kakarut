/**
 * SHIFT YANG MELEWATI TENGAH MALAM.
 *
 * Alternasi masuk↔keluar dulu dikurung di dalam satu tanggal kalender. Sesi
 * hadirnya tidak. Terukur pada server sungguhan untuk satu shift tutup
 * (masuk 22:00 WIB, pulang 02:00 WIB):
 *
 *   19 Agu · hadir · masuk 22:00 · keluar —
 *   20 Agu · hadir · masuk 02:00 · keluar —      ← cap PULANG tercatat "masuk"
 *   hadir = 2
 *
 * dan sisi sebaliknya, pukul 00:30 saat orangnya masih di tengah shift:
 *
 *   POST /sync shift_buka → 400 "Absen masuk dulu sebelum buka kasir"
 *
 * Uji ini menjaga aturan yang menutup keduanya. Ia MENJALANKAN aturannya
 * (`sesiHadirTerbuka` / `capAbsenBerikutnya` di @kakarut/shared), bukan
 * mencocokkan teks sumber — jalur HTTP-nya sendiri dijaga §200 verify-api.
 */
import { describe, expect, it } from "vitest";
import {
  BATAS_LINTAS_HARI_JAM,
  capAbsenBerikutnya,
  sesiHadirTerbuka,
  type CapAbsen,
} from "@kakarut/shared";

const ms = (iso: string) => new Date(iso).getTime();
/** cap masuk 22:00 WIB 19 Agu — bertanggal bisnis 19 Agu */
const MASUK_MALAM: CapAbsen = { tipe: "masuk", waktu_ms: ms("2026-08-19T15:00:00Z"), tanggal: "2026-08-19" };
/** pukul 02:00 WIB 20 Agu — 4 jam sesudahnya, tanggal bisnisnya sudah 20 Agu */
const PULANG_DINI = ms("2026-08-19T19:00:00Z");

describe("sesiHadirTerbuka", () => {
  it("cap terakhir hari ini 'masuk' → sesi terbuka (perilaku lama, tak bergeser)", () => {
    const cap: CapAbsen = { tipe: "masuk", waktu_ms: ms("2026-08-20T01:00:00Z"), tanggal: "2026-08-20" };
    expect(sesiHadirTerbuka(cap, null, ms("2026-08-20T03:00:00Z"))).toEqual(cap);
  });
  it("cap terakhir hari ini 'keluar' → tidak hadir, tanggal kemarin TIDAK dilirik", () => {
    const keluar: CapAbsen = { tipe: "keluar", waktu_ms: ms("2026-08-20T01:00:00Z"), tanggal: "2026-08-20" };
    // sengaja disodori cap masuk kemarin yang masih segar: ia tak boleh menang
    // atas cap hari ini, kalau tidak orang yang sudah pulang tercatat hadir lagi.
    expect(sesiHadirTerbuka(keluar, MASUK_MALAM, PULANG_DINI)).toBeNull();
  });
  it("belum ada cap hari ini + masuk kemarin masih dalam batas → sesi kemarin masih terbuka", () => {
    expect(sesiHadirTerbuka(null, MASUK_MALAM, PULANG_DINI)).toEqual(MASUK_MALAM);
  });
  it("masuk kemarin yang lupa ditutup (> batas) → sesi dianggap ditinggalkan", () => {
    const lewat = MASUK_MALAM.waktu_ms + (BATAS_LINTAS_HARI_JAM + 0.5) * 3_600_000;
    expect(sesiHadirTerbuka(null, MASUK_MALAM, lewat)).toBeNull();
  });
  it("tepat di batas masih terhitung, sedetik sesudahnya tidak", () => {
    const tepat = MASUK_MALAM.waktu_ms + BATAS_LINTAS_HARI_JAM * 3_600_000;
    expect(sesiHadirTerbuka(null, MASUK_MALAM, tepat)).toEqual(MASUK_MALAM);
    expect(sesiHadirTerbuka(null, MASUK_MALAM, tepat + 1_000)).toBeNull();
  });
  it("cap 'kemarin' yang waktunya SESUDAH saat dinilai tidak dihitung", () => {
    // cap pulang MEWARISI tanggal masuknya, jadi baris bertanggal kemarin bisa
    // berwaktu sesudah 'pada' ketika sinkron susulan menilai ulang saat lampau.
    expect(sesiHadirTerbuka(null, MASUK_MALAM, MASUK_MALAM.waktu_ms - 60_000)).toBeNull();
  });
  it("cap kemarin 'keluar' → tidak hadir, seberapa pun segarnya", () => {
    const keluar: CapAbsen = { ...MASUK_MALAM, tipe: "keluar" };
    expect(sesiHadirTerbuka(null, keluar, PULANG_DINI)).toBeNull();
  });
  it("tak ada cap sama sekali → tidak hadir", () => {
    expect(sesiHadirTerbuka(null, null, PULANG_DINI)).toBeNull();
  });
});

describe("capAbsenBerikutnya", () => {
  it("cap pulang shift malam: tipe 'keluar' dan MEWARISI tanggal masuknya", () => {
    expect(capAbsenBerikutnya(null, MASUK_MALAM, PULANG_DINI)).toEqual({
      tipe: "keluar",
      tanggal_sesi: "2026-08-19",
    });
  });
  it("hari yang benar-benar baru: 'masuk' dengan tanggalnya sendiri", () => {
    // masuk kemarin sudah lewat batas — cap pagi ini harus tetap MASUK, bukan
    // berubah jadi cap pulang atas nama sesi kemarin yang lupa ditutup.
    const besokPagi = MASUK_MALAM.waktu_ms + 13 * 3_600_000;
    expect(capAbsenBerikutnya(null, MASUK_MALAM, besokPagi)).toEqual({
      tipe: "masuk",
      tanggal_sesi: null,
    });
  });
  it("dua cap di hari yang sama tetap berselang-seling seperti sebelumnya", () => {
    const pagi: CapAbsen = { tipe: "masuk", waktu_ms: ms("2026-08-20T01:00:00Z"), tanggal: "2026-08-20" };
    expect(capAbsenBerikutnya(pagi, null, ms("2026-08-20T10:00:00Z"))).toEqual({
      tipe: "keluar",
      tanggal_sesi: "2026-08-20",
    });
    // sesudah 'keluar' tak ada sesi yang ditutup, jadi cap ini memakai tanggalnya
    // sendiri (`tanggal_sesi: null`) — yang di sini kebetulan tanggal yang sama.
    expect(
      capAbsenBerikutnya({ ...pagi, tipe: "keluar" }, null, ms("2026-08-20T10:00:00Z")),
    ).toEqual({ tipe: "masuk", tanggal_sesi: null });
  });
  it("sesudah pulang dini hari, cap berikutnya di hari itu kembali 'masuk'", () => {
    // kasir yang pulang 02:00 lalu datang lagi sore harinya: cap pulang tadi
    // bertanggal KEMARIN, jadi hari ini masih kosong — dan cap kemarin itu
    // 'keluar', bukan sesi terbuka.
    const pulang: CapAbsen = { tipe: "keluar", waktu_ms: PULANG_DINI, tanggal: "2026-08-19" };
    expect(capAbsenBerikutnya(null, pulang, ms("2026-08-20T08:00:00Z"))).toEqual({
      tipe: "masuk",
      tanggal_sesi: null,
    });
  });
});
