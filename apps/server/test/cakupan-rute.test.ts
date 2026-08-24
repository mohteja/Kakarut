import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ruteKonkret } from "../src/scripts/cakupan-rute";

/**
 * PINTU YANG TAK PERNAH DIKETUK.
 *
 * `verify-api.sh` melepaskan **2.849 asersi** lewat HTTP sungguhan tiap kali
 * dijalankan, dan sampai putaran ini tak ada seorang pun — termasuk aku — yang
 * tahu BERAPA rute yang benar-benar disentuhnya. Pertanyaannya bukan retoris:
 * rute yang tak pernah diketuk suite adalah rute yang bisa 500 sejak enam bulan
 * lalu tanpa satu pun uji berubah warna.
 *
 * ANGKA ITU TAK BISA DIDAPAT SECARA STATIS, dan itu terukur. Mencocokkan jalur
 * yang disebut `verify-api.sh` dengan deklarasi rute di `src` menghasilkan
 * **2 dari 163**: hampir setiap jalur di skrip itu dirakit dari variabel shell
 * (`/bahan/$BP242/resep`). Yang dibutuhkan POLA rutenya (`/api/bahan/:id/resep`),
 * dan hanya server yang mengetahuinya — lewat `c.req.routePath`, saat berjalan.
 *
 * Maka jejaknya diambil dari server (middleware ber-env `JEJAK_RUTE` di
 * `app.ts`), daftar rutenya dari TABEL RUTE HONO sendiri (`app.routes`), dan
 * hasilnya dibekukan di `docs/audit/rute-diketuk.txt`.
 *
 * TERUKUR pada putaran ini:
 *
 *     rute konkret terdaftar     274
 *     diketuk verify-api         271   (98,9%)   — dulu 256 (93,4%)
 *     TAK PERNAH diketuk           3   — ketiganya operasi host super admin
 *     jalur TULIS                168 terdaftar, 165 diketuk (dulu 155)
 *
 * Lima belas pintu yang dulu utang kini diketuk §244, dan TAK SATU PUN
 * membalas 5xx — vena itu bersih secara perilaku, dan itu diukur.
 *
 * BATAS UJI INI, ditulis supaya "hijau" tak terbaca lebih luas dari yang benar:
 *
 *   · `rute-diketuk.txt` dulunya REKAMAN yang dipercaya. Sejak langkah
 *     "Cakupan rute" di `ci.yml`, ia DIUKUR ULANG tiap CI: server verify-api
 *     berjalan dengan `JEJAK_RUTE`, jejaknya dibandingkan dengan berkas ini,
 *     dan selisih apa pun (rute berhenti diketuk ATAU rute baru diketuk)
 *     membuat CI merah menyebut barisnya. Uji ini menjaga sisi strukturnya
 *     (rute baru wajib diputuskan); langkah CI menjaga kesegarannya.
 *     Perbaruinya:
 *     `npx tsx src/scripts/cakupan-rute.ts <jejak> > docs/audit/rute-diketuk.txt`
 *   · "diketuk" BUKAN "diuji". Rute yang ditembak sekali dengan badan paling
 *     sederhana tetap terhitung tercakup di sini.
 */
const AKAR = fileURLToPath(new URL("../../..", import.meta.url));
const DIKETUK = new Set(
  readFileSync(`${AKAR}docs/audit/rute-diketuk.txt`, "utf8")
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean),
);

/**
 * Pintu yang SENGAJA di luar jangkauan suite, dengan alasan yang bisa
 * diperiksa: efeknya jatuh di LUAR basis data, jadi menembaknya dari suite
 * berarti menjalankan migrasi sungguhan, mengirim email sungguhan, atau
 * mengubah retensi cadangan mesin yang menjalankannya.
 */
const DILUAR_JANGKAUAN: Record<string, string> = {
  "POST /api/admin/sistem/migrate": "menjalankan migrasi sungguhan pada basis data yang sedang diuji",
  "POST /api/admin/sistem/smtp/test": "mengirim email sungguhan ke luar",
  "POST /api/admin/sistem/backup/retensi": "mengubah retensi cadangan mesin yang menjalankannya",
};

/**
 * UTANG YANG DIUKUR — pintu yang belum tertembak, TANPA alasan prinsipil.
 *
 * KOSONG SEJAK §244. Lima belas pintu yang dulu di sini — empat `DELETE` dan
 * sembilan jalur tulis lain — kini diketuk lewat HTTP sungguhan, dan tak satu
 * pun membalas 5xx. Daftar ini boleh terisi lagi (dengan sadar), tapi
 * ratchet di bawah menahan agar tak terisi diam-diam.
 */
const UTANG: string[] = [];

/**
 * PINTU HANTU — ada hanya karena satu pabrik dipasang di DUA prefiks, dan
 * separuhnya menolak dirinya sendiri di baris pertama handler-nya:
 *
 *     kirim-hasil : if (tipe !== "produksi") throw 404
 *     dampak      : if (tipe !== "beli")     throw 400
 *
 * Mereka DIKETUK (§244 memastikan mereka tetap 404/400), tapi mereka tak
 * pernah bisa sukses. Dicatat karena penyebut "274 rute" memuat pintu yang
 * mustahil, dan angka cakupan yang tak menyebutkan itu terbaca lebih bagus
 * dari yang sebenarnya.
 */
const HANTU_PABRIK: Record<string, string> = {
  "POST /api/pembelian/kirim-hasil/:fakturId": 'tipe !== "produksi" → 404',
  "POST /api/produksi/laporan-harga/:fakturId/dampak": 'tipe !== "beli" → 400',
};

describe("cakupan rute: pintu yang tak pernah diketuk", () => {
  const semua = ruteKonkret();

  it("premis: tabel rute Hono benar-benar terbaca", () => {
    // Tanpa ini, `createApp()` yang berubah bentuk membuat seluruh berkas ini
    // hijau dengan populasi nol — izin terbuka, bukan penjagaan.
    expect(semua.length, "rute konkret terdaftar").toBeGreaterThan(200);
    expect(DIKETUK.size, "rekaman rute yang diketuk").toBeGreaterThan(200);
  });

  it("INTI: tiap rute DIKETUK, di luar jangkauan, atau utang yang tercatat", () => {
    const utang = new Set(UTANG);
    const yatim = semua.filter((r) => !DIKETUK.has(r) && !(r in DILUAR_JANGKAUAN) && !utang.has(r));
    expect(
      yatim,
      "rute BARU yang tak pernah diketuk verify-api. Tembak ia di verify-api.sh " +
        "lalu perbarui docs/audit/rute-diketuk.txt, atau daftarkan di UTANG " +
        "dengan sadar bahwa ia pintu yang tak dijaga siapa pun.\n" +
        yatim.join("\n"),
    ).toEqual([]);
  });

  it("tak ada entri basi: tiap yang terdaftar masih benar-benar ada", () => {
    const ada = new Set(semua);
    // Rute yang sudah dihapus tapi masih tercatat membuat daftar ini pelan-pelan
    // berhenti berarti apa-apa — bentuk yang sudah dibayar sesi ini berkali-kali.
    expect([...DIKETUK].filter((r) => !ada.has(r)), "rute-diketuk.txt memuat rute yang sudah tak ada").toEqual(
      [],
    );
    expect(Object.keys(DILUAR_JANGKAUAN).filter((r) => !ada.has(r)), "DILUAR_JANGKAUAN basi").toEqual([]);
    expect(UTANG.filter((r) => !ada.has(r)), "UTANG basi").toEqual([]);
  });

  it("himpunannya tak boleh tumpang tindih", () => {
    // Rute yang tercatat DIKETUK sekaligus UTANG berarti salah satu daftarnya
    // bohong, dan keduanya jadi tak bisa dipercaya.
    const utang = new Set(UTANG);
    expect(UTANG.filter((r) => DIKETUK.has(r)), "ada di UTANG padahal tercatat diketuk").toEqual([]);
    expect(
      Object.keys(DILUAR_JANGKAUAN).filter((r) => DIKETUK.has(r) || utang.has(r)),
      "DILUAR_JANGKAUAN tumpang tindih",
    ).toEqual([]);
  });

  it("langkah CI yang mengukur ulang rekaman ini benar-benar terpasang", () => {
    // Aturan 7: alat ukurnya ikut diuji. Tanpa jangkar ini, langkah "Cakupan
    // rute" bisa dicabut dari ci.yml dan berkas ini kembali jadi rekaman yang
    // dipercaya — persis batas yang baru saja ditutup.
    const ci = readFileSync(`${AKAR}.github/workflows/ci.yml`, "utf8");
    expect(ci, "JEJAK_RUTE tak lagi dinyalakan di langkah verify-api").toContain("JEJAK_RUTE=");
    expect(ci, "langkah pembanding cakupan hilang dari ci.yml").toContain("cakupan-rute.ts");
    expect(ci, "pembandingnya harus diff terhadap rekaman yang di-commit").toContain(
      "diff -u docs/audit/rute-diketuk.txt",
    );
  });

  it("PINTU HANTU tetap mustahil — penjaganya masih di baris pertama handler", () => {
    // Kalau suatu saat `if (tipe !== …)` dicabut, kedua pintu ini berhenti jadi
    // hantu dan mulai MENGERJAKAN sesuatu di prefiks yang salah — mengirim
    // hasil produksi lewat pintu belanja, atau menghitung dampak harga pada
    // faktur produksi. Yang menahannya di sisi perilaku §244; ini menahan
    // sumbernya.
    const src = readFileSync(fileURLToPath(new URL("../src/modules/produksi/routes.ts", import.meta.url)), "utf8");
    expect(src, "penjaga kirim-hasil hilang").toMatch(/tipe\s*!==\s*"produksi"/);
    expect(src, "penjaga laporan-harga/dampak hilang").toMatch(/tipe\s*!==\s*"beli"/);
    for (const h of Object.keys(HANTU_PABRIK)) {
      expect(DIKETUK.has(h), `${h}: pintu hantu pun wajib diketuk`).toBe(true);
    }
  });

  it("RATCHET: utangnya tak boleh bertambah, dan jalur TULIS-nya dihitung", () => {
    expect(UTANG.length, "utang cakupan bertambah").toBeLessThanOrEqual(0);
    // Yang paling mahal bila salah bukan bacaan melainkan tulisan: DELETE dan
    // POST yang tak pernah ditembak sekali pun bisa 500 tanpa satu uji berubah.
    const tulis = UTANG.filter((r) => !r.startsWith("GET "));
    expect(tulis.length, "utang jalur TULIS bertambah").toBeLessThanOrEqual(0);
    const tulisSemua = semua.filter((r) => !r.startsWith("GET "));
    const tulisDiketuk = tulisSemua.filter((r) => DIKETUK.has(r));
    expect(
      tulisDiketuk.length,
      `cakupan jalur TULIS turun (${tulisDiketuk.length}/${tulisSemua.length})`,
    ).toBeGreaterThanOrEqual(165);
  });
});
