/**
 * "MASALAH BERBEDA" MENGHITUNG MASALAH, BUKAN BARIS YANG MUAT DI LAYAR.
 *
 * Ditemukan saat pemilik repo membuka panel Log Galat dan bertanya soal 1.744
 * penolakan 401 di sana — bukan oleh sapuan. Kartu keempat dihitung
 * `jumlah_kelompok: rows.length`, dan `rows` datang dari `ambilKelompok(sejak,
 * saring, cari)` yang berlangit-langit `LIMIT_KELOMPOK`. Dua cacat sekaligus,
 * dan keduanya diam:
 *
 *   · TERCEKIK. Lewat 200 kelompok, angkanya berhenti bertambah dan tetap
 *     terlihat seperti angka sebenarnya. Panel diagnosis yang berbohong soal
 *     ukuran masalahnya adalah panel yang menyesatkan justru saat paling
 *     dibutuhkan.
 *   · IKUT SARINGAN. Ketiga kartu lain sengaja dihitung atas SELURUH rentang —
 *     komentar di atas kuerinya menuliskannya: "supaya angka pada kartu tak
 *     ikut berubah saat tab disaring". Kartu keempat melanggar aturan yang
 *     ditulis untuk ketiga saudaranya, di berkas yang sama, sepuluh baris di
 *     bawahnya.
 *
 * Lengan HTTP-nya ada di §142 `verify-api.sh` (menembak `?status=semua` vs
 * `?status=4xx` pada server sungguhan dan menuntut angkanya sama). Yang dipaku
 * di sini BENTUKNYA — sebab bentuk itulah yang gampang kembali saat seseorang
 * "merapikan" handler-nya.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

const RUTE = butaKomentar(
  readFileSync(
    fileURLToPath(new URL("../src/modules/admin-error-log/routes.ts", import.meta.url)),
    "utf8",
  ),
);

/** Badan handler daftar saja — bukan seluruh berkas. */
const iHandler = RUTE.indexOf('.get("/", async (c)');
const iAkhir = RUTE.indexOf("return c.json(dto);", iHandler);
const HANDLER = RUTE.slice(iHandler, iAkhir);

describe("log galat: jumlah kelompok dihitung, bukan diukur dari larik yang dipotong", () => {
  it("premis: irisannya memang handler daftar kelompok", () => {
    expect(iHandler, "premis: handler GET / ada").toBeGreaterThan(-1);
    expect(iAkhir, "premis: ia memulangkan dto").toBeGreaterThan(iHandler);
    expect(HANDLER).toContain("ambilKelompok(sejak, saring, cari)");
  });

  it("dihitung SQL atas populasi penuh, bukan dari rows.length", () => {
    expect(HANDLER).toContain("count(distinct ${errorLogs.sidik})");
    expect(
      HANDLER,
      "jumlah_kelompok kembali diukur dari larik yang sudah dipotong & disaring",
    ).not.toMatch(/jumlah_kelompok:\s*(rows|kelompok)\.length/);
    expect(HANDLER).toContain("jumlah_kelompok: ringkas?.jumlah_kelompok ?? 0");
  });

  it("dan dihitung di kueri yang TIDAK memakai saringan status/pencarian", () => {
    // Kartu-kartunya sejajar hanya bila keempatnya lahir dari kueri yang sama.
    // Kalau `jumlah_kelompok` pindah ke kueri lain yang membawa `saring`, ia
    // kembali menyusut saat tab ditekan — cacat yang sama dengan wajah baru.
    const iRingkas = HANDLER.indexOf("const [ringkas] = await db");
    const iRows = HANDLER.indexOf("const kelompok = await ambilKelompok");
    expect(iRingkas).toBeGreaterThan(-1);
    expect(iRows).toBeGreaterThan(iRingkas);
    const blokRingkas = HANDLER.slice(iRingkas, iRows);
    expect(blokRingkas).toContain("jumlah_kelompok");
    expect(blokRingkas).toContain("gte(errorLogs.waktu, sejak)");
    expect(blokRingkas, "kueri ringkasan tak boleh membawa saringan").not.toContain("saring");
    expect(blokRingkas, "kueri ringkasan tak boleh membawa pencarian").not.toContain("cari");
  });

  it("keempat kartu lahir dari SATU kueri — tak ada pemindaian tambahan", () => {
    // `count(distinct …)` menumpang agregat yang memang sudah berjalan. Kalau
    // ia dipisah jadi kueri sendiri, panel yang disegarkan tiap 30 detik
    // membayar dua kali pemindaian untuk satu kartu.
    expect(HANDLER.match(/= await db/g) ?? []).toHaveLength(1);
  });

  it("daftarnya tetap berlangit-langit, dan mengambil SATU LEBIH agar penandanya bisa menyala", () => {
    expect(RUTE).toContain("LIMIT_KELOMPOK + 1");
    expect(HANDLER).toContain("potongLarik(c, kelompok, LIMIT_KELOMPOK)");
  });
});
