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
const HAL = readFileSync(join(WEB, "pages/stok/TambahStokDariMenuPage.tsx"), "utf8");

describe("server: POST /rekomendasi/menu/faktur ikut ledger idempotensi", () => {
  it("menerima client_ref & device_id dari ledger bersama", () => {
    expect(SRV).toContain("  client_ref: clientRefField,");
    expect(SRV).toContain("  device_id: deviceIdField,");
    expect(SRV).toContain('from "../sync/idempoten";');
  });

  it("diperiksa SEBELUM faktur apa pun diterbitkan", () => {
    const iCek = SRV.indexOf(
      "const ada = await cariHasilIdempoten(auth.company_id!, body.client_ref);",
    );
    const iTerbit = SRV.indexOf("const hasil = await buatFakturDariRencana({");
    expect(iCek).toBeGreaterThan(0);
    expect(iTerbit).toBeGreaterThan(iCek);
  });

  it("kiriman ulang memulangkan hasil yang SAMA (termasuk rencana_id-nya)", () => {
    expect(SRV).toContain("if (ada) return c.json(ada.hasilJson, 201);");
  });

  it("dicatat SESUDAH fakturnya benar-benar terbit", () => {
    // Dicatat lebih dulu lalu penerbitannya gagal = kiriman ulang mengira
    // sudah selesai, dan fakturnya tak pernah ada.
    const iTerbit = SRV.indexOf("const hasil = await buatFakturDariRencana({");
    const iCatat = SRV.indexOf("await catatHasilIdempoten({");
    expect(iTerbit).toBeGreaterThan(0);
    expect(iCatat).toBeGreaterThan(iTerbit);
    expect(SRV).toContain('tipe: "rencana_faktur",');
  });

  it("yang dicatat = yang dibalas", () => {
    expect(SRV).toContain("hasilJson: hasil,");
    expect(SRV).toContain("return c.json(hasil, 201);");
  });

  it("opsional — klien lama tak berubah perilakunya", () => {
    expect(SRV).toContain("if (body.client_ref) {");
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
