import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Penjaga RANTAI DUA PANGGILAN YANG SETENGAH BERHASIL.
 *
 * "Tambah Stok dari Menu" mengirim DUA permintaan berurutan dari satu tombol:
 *
 *   1. `POST /rekomendasi/menu/faktur`      → faktur produksi + beli
 *   2. `POST /perlengkapan/permintaan-otomatis?…&rencana_id=…`
 *
 * Yang kedua menaut dirinya ke `rencana_id` hasil yang pertama, jadi urutannya
 * memang tak bisa dibalik. Konsekuensinya: begitu (2) gagal — jaringan putus,
 * 500, apa pun — (1) SUDAH menerbitkan fakturnya, tapi tombolnya memantulkan
 * galat seolah tak ada yang terjadi.
 *
 * Halaman ini sudah pernah menambal gejalanya dengan menyegarkan pratinjau di
 * `onError`, dan komentarnya sendiri menyebut sebabnya: endpoint (1) "tak punya
 * penangkal ganda (tanpa `client_ref`)". Tambalan itu memperkecil kerusakan
 * (pratinjau menghitung ulang, jadi tekan-lagi hanya membuat SISANYA) tapi
 * menukarnya dengan kerusakan lain yang lebih sunyi: karena kekurangannya sudah
 * nol, permintaan PERLENGKAPAN yang gagal tadi tak pernah dicoba lagi — ia
 * hilang tanpa jejak di layar mana pun.
 *
 * `client_ref` menutup keduanya sekaligus. Percobaan kedua memutar ulang
 * faktur yang sama (bukan menerbitkan set kedua) DAN memulangkan `rencana_id`
 * yang sama, sehingga panggilan (2) bisa benar-benar diulang pada rencana yang
 * benar.
 */
const SRV = readFileSync(
  fileURLToPath(new URL("../src/modules/rekomendasi/routes.ts", import.meta.url)),
  "utf8",
);
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const HELPER = readFileSync(
  fileURLToPath(new URL("../src/modules/sync/idempoten.ts", import.meta.url)),
  "utf8",
);
const HAL = readFileSync(join(WEB, "pages/stok/TambahStokDariMenuPage.tsx"), "utf8");

describe("server: POST /rekomendasi/menu/faktur ikut ledger idempotensi", () => {
  it("menerima client_ref & device_id dari ledger bersama", () => {
    expect(SRV).toContain("  client_ref: clientRefField,");
    expect(SRV).toContain("  device_id: deviceIdField,");
    expect(SRV).toContain('from "../sync/idempoten";');
  });

  /*
   * SELECT-lalu-eksekusi hanya jalur cepat, bukan penjaga: dua tekanan tombol
   * ber-`client_ref` sama yang datang bersamaan sama-sama melihat ledger
   * kosong dan sama-sama MENERBITKAN faktur. Yang kedua kalah di unique index
   * dan hasilnya dibuang diam-diam — gudang tetap menerima dua work-order
   * untuk satu kebutuhan, persis yang endpoint ini seharusnya cegah.
   */
  it("mengklaim ATOMIK sebelum faktur apa pun diterbitkan", () => {
    const iKlaim = SRV.indexOf("const { data } = await denganKlaimIdempoten(");
    const iTerbit = SRV.indexOf("const hasil = await buatFakturDariRencana({");
    expect(iKlaim).toBeGreaterThan(0);
    expect(iTerbit).toBeGreaterThan(iKlaim);
    expect(SRV).toContain('tipe: "rencana_faktur",');
    expect(SRV).not.toContain("cariHasilIdempoten");
    expect(SRV).not.toContain("catatHasilIdempoten");
  });

  it("kiriman ulang memulangkan hasil yang SAMA (termasuk rencana_id-nya)", () => {
    expect(SRV).toContain("return c.json(data, 201);");
  });

  it("yang diklaim = yang dibalas", () => {
    expect(SRV).toContain("        return hasil;");
  });

  it("opsional — klien lama tak berubah perilakunya", () => {
    expect(HELPER).toContain("if (!clientRef) return { data: await jalankan(), baru: true };");
  });
});

describe("web: kunci dipegang MELEWATI kegagalan, bukan per panggilan", () => {
  it("dikirim dari ref pada panggilan pertama", () => {
    expect(HAL).toContain("client_ref: (refBuat.current ??= uuidV4()),");
    expect(HAL).toContain("const refBuat = useRef<string | null>(null);");
  });

  it("dicabut HANYA di onSuccess — bukan di onError, bukan di onSettled", () => {
    // Inti perbaikannya. Kalau kuncinya dicabut saat gagal, percobaan kedua
    // memakai kunci BARU dan server tak mengenalinya lagi: satu set faktur
    // kedua terbit, persis bug yang ditutup.
    const iSukses = HAL.indexOf("    onSuccess: ({ perlengkapan }) => {");
    const iCabut = HAL.indexOf("      refBuat.current = null;");
    expect(iSukses).toBeGreaterThan(0);
    expect(iCabut).toBeGreaterThan(iSukses);
    // tepat sekali dicabut, dan bukan di jalur gagal
    expect(HAL.split("refBuat.current = null").length - 1).toBe(1);
    const iError = HAL.indexOf("    onError: () => {");
    expect(iError).toBeGreaterThan(iCabut);
  });

  it("penyegaran onError tetap ada — ia yang membuat faktur terbit kelihatan", () => {
    // Arah sebaliknya: kunci idempotensi TIDAK menggantikan penyegaran.
    // Tanpanya layar tetap memperlihatkan kekurangan yang sudah tak ada.
    const iError = HAL.indexOf("    onError: () => {");
    const potong = HAL.slice(iError, iError + 300);
    expect(potong).toContain("queryClient.invalidateQueries");
  });

  it("urutannya tetap: faktur dulu, perlengkapan menaut ke rencana_id-nya", () => {
    const iMenu = HAL.indexOf("`/rekomendasi/menu/faktur`");
    const iPer = HAL.indexOf("`/perlengkapan/permintaan-otomatis?branch_id=");
    expect(iMenu).toBeGreaterThan(0);
    expect(iPer).toBeGreaterThan(iMenu);
    expect(HAL).toContain("menu?.rencana_id ? `&rencana_id=${menu.rencana_id}`");
  });
});

describe("komentar tak boleh lagi menyatakan endpointnya tanpa penangkal", () => {
  it("klaim lama sudah dicabut", () => {
    // Komentar yang bohong lebih berbahaya daripada tak ada komentar: ronde
    // berikutnya akan membaca "tak punya penangkal ganda" dan menambal ulang
    // sesuatu yang sudah tertutup.
    expect(HAL).not.toContain("tak punya penangkal ganda");
    expect(HAL).not.toContain("SATU SET FAKTUR PRODUKSI/BELI KEDUA");
  });
});
