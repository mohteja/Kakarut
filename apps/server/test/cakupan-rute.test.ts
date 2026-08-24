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
 *     diketuk verify-api         256   (93,4%)
 *     TAK PERNAH diketuk          18   — 13 di antaranya jalur TULIS
 *
 * BATAS UJI INI, ditulis supaya "hijau" tak terbaca lebih luas dari yang benar:
 *
 *   · `rute-diketuk.txt` adalah REKAMAN, bukan pengukuran ulang. Ia dibekukan
 *     dari satu jalannya verify-api; kalau suatu saat sebuah rute berhenti
 *     diketuk tanpa berkasnya diperbarui, uji ini tetap hijau. Yang dijaganya:
 *     rute BARU tak bisa lahir tanpa keputusan. Perbaruinya:
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
 * Ditulis apa adanya dan bukan disamarkan jadi "di luar jangkauan": tiga belas
 * dari lima belas ini jalur TULIS, empat di antaranya DELETE. Daftar ini boleh
 * MENYUSUT dan tak boleh bertambah.
 */
const UTANG = [
  "DELETE /api/perlengkapan/:id",
  "DELETE /api/perlengkapan/beli/:id",
  "DELETE /api/perlengkapan/opname/sesi/:sessionId",
  "GET /api/admin/tenants/:id",
  "GET /api/menu/panduan-markup",
  "GET /api/perlengkapan/opname/sesi/:sessionId",
  "GET /api/produksi/dana/:fakturId",
  "GET /api/stok/opname",
  "PATCH /api/produksi/faktur/:key",
  "PATCH /api/satuan/:id",
  "POST /api/onboarding/undangan/:id/tolak",
  "POST /api/pembelian/kirim-hasil/:fakturId",
  "POST /api/produksi/laporan-harga/:fakturId/dampak",
  "POST /api/stok/penyesuaian/setujui-massal",
  "PUT /api/customer/:id",
];

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

  it("RATCHET: utangnya tak boleh bertambah, dan jalur TULIS-nya dihitung", () => {
    expect(UTANG.length, "utang cakupan bertambah").toBeLessThanOrEqual(15);
    // Yang paling mahal bila salah bukan bacaan melainkan tulisan: DELETE dan
    // POST yang tak pernah ditembak sekali pun bisa 500 tanpa satu uji berubah.
    const tulis = UTANG.filter((r) => !r.startsWith("GET "));
    expect(tulis.length, "utang jalur TULIS bertambah").toBeLessThanOrEqual(10);
    const tulisSemua = semua.filter((r) => !r.startsWith("GET "));
    const tulisDiketuk = tulisSemua.filter((r) => DIKETUK.has(r));
    expect(
      tulisDiketuk.length,
      `cakupan jalur TULIS turun (${tulisDiketuk.length}/${tulisSemua.length})`,
    ).toBeGreaterThanOrEqual(155);
  });
});
