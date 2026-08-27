import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { medanWaktu, petaKelasWaktu } from "./util/waktu-klien";
import { SRV } from "./util/rute";
import {
  MAKS_UMUR_HARI,
  MAKS_UMUR_HARI_DEFAULT,
  pastikanWaktuKejadian,
  SETAHUN,
  SKEW_MENIT,
  zTanggalKejadian,
  zTanggalRencana,
} from "../src/lib/waktu-kejadian";

/**
 * KAPAN — ruas keempat, dan aturan yang dulu hidup di satu pintu saja.
 *
 * `companyId` (putaran 13 & 14), `branchId` (16), `userId` (17) sudah punya
 * gerbang. Yang keempat menentukan di periode mana sebuah baris hidup.
 *
 * HASIL SAPUAN, sebelum → sesudah:
 *
 *   medan waktu dari klien        10
 *     · KEJADIAN     0 → 3   tak boleh di masa depan
 *     · RENCANA      0 → 5   boleh ke depan, tetap berlangit-langit
 *     · TERDAFTAR    —   2   beralasan, dan alasannya dipaku ke kodenya
 *     · TELANJANG    9 → 0   ← tuduhannya
 *
 * Ketiga akibat diukur lewat HTTP sungguhan sebelum satu baris diubah; lihat
 * `lib/waktu-kejadian.ts` dan `verify-api.sh` §271.
 */

/**
 * Medan waktu yang MEMANG tak dibatasi posisinya, beserta alasan yang bisa
 * diperiksa — dan tiap alasan dipaku ke kode yang membuatnya benar.
 */
const TERDAFTAR = new Map<string, string>([
  [
    "modules/pesanan/routes.ts:tanggal",
    "SARINGAN papan pesanan, bukan nilai yang disimpan: melihat papan kemarin itu wajar, jadi yang dituntut BENTUKNYA saja. Sebelumnya `z.string()` telanjang dan terukur 500",
  ],
  [
    "modules/sync/routes.ts:waktu",
    "stempel kejadian perangkat offline — dibatasi di HANDLER-nya oleh `pastikanWaktuKejadian` (skew 5 menit, usia per tipe), sebab batasnya bergantung `tipe` perintah yang tak terlihat dari skema medannya",
  ],
]);

describe("tiap medan waktu dari klien punya batas — atau alasan", () => {
  const semua = medanWaktu();
  const peta = petaKelasWaktu(semua);

  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(semua.length, "tak ada medan waktu terbaca").toBeGreaterThanOrEqual(8);
    expect(peta.get("KEJADIAN") ?? 0, "kelas KEJADIAN kosong").toBeGreaterThan(0);
    expect(peta.get("RENCANA") ?? 0, "kelas RENCANA kosong").toBeGreaterThan(0);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThan(4);
  });

  it("INTI: tak ada medan waktu telanjang yang belum diadjudikasi", () => {
    const asing = semua
      .filter((x) => x.kelas === "TELANJANG")
      .map((x) => `${x.berkas}:${x.nama}`)
      .filter((k) => !TERDAFTAR.has(k));
    expect(
      asing,
      `medan waktu dari klien tanpa batas posisi — tahun 1900 dan 2099 lolos:\n${asing.join("\n")}`,
    ).toEqual([]);
  });

  it("daftar adjudikasi ditagih dua arah", () => {
    const ada = new Set(
      semua.filter((x) => x.kelas === "TELANJANG").map((x) => `${x.berkas}:${x.nama}`),
    );
    const usang = [...TERDAFTAR.keys()].filter((k) => !ada.has(k));
    expect(usang, `entri sudah dibatasi — hapus dari daftar: ${usang.join(", ")}`).toEqual([]);
  });

  it("alasan `/sync` dipaku ke kodenya: handler-nya MEMANG membatasi", () => {
    // Kalau panggilan ini dicabut, entri daftar di atas berhenti benar — dan
    // uji ini merah, bukan alasannya yang basi diam-diam.
    const S = readFileSync(join(SRV, "modules/sync/routes.ts"), "utf8");
    expect(S).toContain("pastikanWaktuKejadian(waktu.getTime(), cmd.tipe, sekarang)");
  });

  it("PINDAH RUMAH tak melonggarkan: angka `/sync` tetap sama", () => {
    // 5 menit / 30 hari / 7 hari dipaku. Memindahkan aturan ke rumah bersama
    // adalah tempat paling mudah untuk diam-diam melunakkannya.
    expect(SKEW_MENIT).toBe(5);
    expect(MAKS_UMUR_HARI.penjualan).toBe(30);
    expect(MAKS_UMUR_HARI_DEFAULT).toBe(7);
  });
});

describe("PREMIS instrumen: batasnya sendiri berperilaku benar", () => {
  // Aturan 7 — alat ukurnya ikut diuji. Jam dipatok, bukan dibaca dari mesin:
  // uji yang bergantung "hari ini" gagal sendiri saat tengah malam CI.
  const KINI = Date.parse("2026-06-15T12:00:00Z");
  const jam = () => KINI;
  const kejadian = zTanggalKejadian(30, jam);
  const rencana = zTanggalRencana(30, 30, jam);

  it("KEJADIAN: hari ini lolos, besok-jauh ditolak, lampau-jauh ditolak", () => {
    expect(kejadian.safeParse("2026-06-15").success).toBe(true);
    expect(kejadian.safeParse("2026-05-20").success).toBe(true);
    expect(kejadian.safeParse("2099-01-01").success).toBe(false);
    expect(kejadian.safeParse("1900-01-01").success).toBe(false);
  });

  it("KEJADIAN: slack SATU HARI untuk zona waktu — dan hanya satu", () => {
    // Perusahaan di UTC+14 mencatat opname "hari ini" yang di UTC masih besok.
    expect(kejadian.safeParse("2026-06-16").success).toBe(true);
    expect(kejadian.safeParse("2026-06-17").success).toBe(false);
  });

  it("RENCANA: masa depan JUSTRU lolos — aturan KEJADIAN tak dipaksakan", () => {
    expect(rencana.safeParse("2026-07-10").success).toBe(true);
    expect(rencana.safeParse("2099-01-01").success).toBe(false);
    expect(rencana.safeParse("1900-01-01").success).toBe(false);
  });

  it("bentuknya tetap ditagih — batas tak menggantikan pemeriksaan tanggal ADA", () => {
    expect(kejadian.safeParse("2026-02-30").success).toBe(false);
    expect(kejadian.safeParse("bukan-tanggal").success).toBe(false);
  });

  it("`pastikanWaktuKejadian` melempar dengan kalimat yang SAMA seperti dulu", () => {
    const now = KINI;
    expect(() => pastikanWaktuKejadian(now, "penjualan", now)).not.toThrow();
    expect(() => pastikanWaktuKejadian(now + 60 * 60_000, "penjualan", now)).toThrowError(
      /waktu kejadian di masa depan/,
    );
    expect(() => pastikanWaktuKejadian(now - 31 * 86_400_000, "penjualan", now)).toThrowError(
      /lebih dari 30 hari lalu/,
    );
    // tipe lain memakai bawaan 7 hari — perbedaan itu disengaja & beralasan
    expect(() => pastikanWaktuKejadian(now - 8 * 86_400_000, "stok_opname", now)).toThrowError(
      /lebih dari 7 hari lalu/,
    );
    expect(() => pastikanWaktuKejadian(Number.NaN, "penjualan", now)).toThrowError(
      /waktu tidak valid/,
    );
  });

  it("SETAHUN benar-benar setahun — angkanya dibaca, bukan dipercaya", () => {
    expect(SETAHUN).toBeGreaterThanOrEqual(365);
    expect(SETAHUN).toBeLessThanOrEqual(366);
  });
});

describe("BUKTI MERAH: gerbangnya benar-benar bisa menuduh", () => {
  const sapu = (isi: string) => medanWaktu([{ nama: "modules/palsu/routes.ts", isi }]);

  it("medan waktu baru ber-`z.string()` telanjang → TELANJANG", () => {
    const k = sapu('const B = z.object({ tanggal: z.string().optional() });');
    expect(k).toHaveLength(1);
    expect(k[0].kelas).toBe("TELANJANG");
  });

  it("…dan `zTanggal` saja (bentuk saja) TETAP telanjang", () => {
    // Justru inilah keadaan sebelum vena ini: sembilan medan lolos karena
    // bentuknya benar, sementara tahun 2099 tetap masuk.
    expect(sapu('const B = z.object({ prod_date: zTanggal.optional() });')[0]?.kelas).toBe(
      "TELANJANG",
    );
  });

  it("PASANGAN: yang berbatas terbaca kelasnya, dan medan bukan-waktu tak disapu", () => {
    expect(sapu('const B = z.object({ tanggal: zTanggalKejadian(SETAHUN) });')[0]?.kelas).toBe(
      "KEJADIAN",
    );
    expect(sapu('const B = z.object({ mulai: zTanggalRencana(SETAHUN, SETAHUN) });')[0]?.kelas).toBe(
      "RENCANA",
    );
    expect(sapu('const B = z.object({ nama: z.string(), qty: z.number() });')).toEqual([]);
  });

  it("PREMIS: medan BERSARANG ikut terbaca", () => {
    // `z.object({ items: z.array(z.object({ exp: … })) })` — bentuk nyata di
    // `produksi/routes.ts`, dan sapuan berjendela akan melewatkannya.
    const k = sapu(
      'const B = z.object({ items: z.array(z.object({ exp: z.string().nullish() })) });',
    );
    expect(k, "medan bersarang tak terbaca — populasinya menyusut diam-diam").toHaveLength(1);
    expect(k[0].nama).toBe("exp");
  });
});
