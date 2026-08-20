/**
 * BACKFILL "CK-LOKAL TERTAHAN" TAK BOLEH MENYAPU BARANG DI JALAN.
 *
 * `konfirmasiProduksiCkLokalTertahan` membalik baris dari 'menunggu' ke
 * 'dikonfirmasi' — dan itu MEMASUKKAN STOK. Ia berjalan sendiri saat boot,
 * tanpa ada yang menekan apa pun.
 *
 * Sasarannya baris CK-lokal: diproduksi/dibeli di sebuah cabang UNTUK cabang
 * itu sendiri, lalu macet di 'menunggu' karena data pra-fitur auto-confirm.
 * Penandanya `tujuan_branch_id IS NULL OR tujuan_branch_id = branch_id`,
 * yang dibaca sebagai "tak ke mana-mana".
 *
 * MASALAHNYA: mengirim MEMINDAHKAN barisnya ke cabang tujuan
 * (`kolomPindahCabang`), sehingga kiriman yang sedang menunggu ditekan
 * "Terima" justru MEMENUHI syarat itu — `tujuan_branch_id = branch_id` bukan
 * cuma berarti "tak ke mana-mana", tapi juga "sudah sampai tujuan, belum
 * diterima".
 *
 * Terukur pada satu database berisi kiriman berjalan:
 *
 *   predikat tanpa `dikirim_at IS NULL`  → 17 baris
 *     di antaranya barang DI JALAN       → 14
 *     sasaran sejatinya                  →  3
 *
 * Akibatnya bila terpicu: stok mendarat di cabang tujuan tanpa ada yang
 * menerimanya, pada 14 kiriman sekaligus, dan tak ada layar yang bisa
 * membatalkannya — "Terima" hanya ada untuk baris yang masih 'menunggu'.
 *
 * KENAPA INI PENTING PADAHAL SUDAH DIGERBANG `sekaliSaja`.
 *
 * Gerbangnya menahan pada DB yang flagnya sudah tertanam. Yang TIDAK ditahan:
 * database yang dipulihkan dari cadangan lama, dan — ini yang paling nyata —
 * undangan di komentar `index.ts` sendiri, yang menyebut backfill ini "aman
 * dijalankan ulang dengan menghapus baris flag-nya bila suatu saat perlu".
 * Sebelum perbaikan, kalimat itu menjanjikan sifat yang tidak dimiliki
 * kodenya. Sesudahnya, barulah benar.
 *
 * Uji ini struktural karena backfill-nya hanya berjalan saat boot dan tak
 * punya endpoint — verify-api tak bisa menjangkaunya, dan tak satu pun uji
 * unit di repo ini menyentuh database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUMBER = readFileSync(
  fileURLToPath(new URL("../src/modules/produksi/backfill.ts", import.meta.url)),
  "utf8",
);

/** Badan fungsi itu saja — larangan tak boleh bocor ke backfill lain. */
const FUNGSI = (() => {
  const i = SUMBER.indexOf("export async function konfirmasiProduksiCkLokalTertahan");
  expect(i, "konfirmasiProduksiCkLokalTertahan tak ditemukan").toBeGreaterThan(0);
  const j = SUMBER.indexOf("\nexport ", i + 10);
  return SUMBER.slice(i, j > 0 ? j : undefined);
})();

describe("backfill CK-lokal hanya menyentuh yang belum pernah berangkat", () => {
  it("menuntut `dikirim_at IS NULL`", () => {
    expect(FUNGSI).toMatch(/AND dikirim_at IS NULL/);
  });

  it("syarat itu ada DI DALAM UPDATE-nya, bukan sekadar disebut di komentar", () => {
    // Komentar penjelas ada di atas barisnya; yang dijaga di sini barisnya
    // sendiri — sesudah klausa WHERE dan sebelum penutup kuerinya.
    const mulai = FUNGSI.indexOf("UPDATE productions");
    const akhir = FUNGSI.indexOf("`)", mulai);
    expect(mulai, "UPDATE tak ditemukan").toBeGreaterThan(-1);
    const kueri = FUNGSI.slice(mulai, akhir);
    expect(kueri).toMatch(/WHERE status = 'menunggu'/);
    expect(kueri).toMatch(/AND dikirim_at IS NULL/);
  });

  it("dan syarat aslinya tetap ada — ini pengetatan, bukan penggantian", () => {
    // Menghapus salah satunya mengubah sasarannya, bukan mempersempitnya:
    // tanpa syarat tujuan, backfill menyentuh baris yang memang ditujukan
    // ke cabang lain dan belum berangkat.
    expect(FUNGSI).toMatch(/AND \(tujuan_branch_id IS NULL OR tujuan_branch_id = branch_id\)/);
    expect(FUNGSI).toMatch(/AND deleted_at IS NULL/);
  });

  it("komentarnya menyimpan angka terukurnya, bukan sekadar peringatan", () => {
    // Angka 17/14/3 itu yang membuat orang berikutnya percaya bahwa syaratnya
    // perlu — tanpa itu, baris `dikirim_at IS NULL` terlihat seperti kehati-
    // hatian berlebih yang boleh dibuang saat merapikan kueri.
    expect(FUNGSI).toMatch(/17 baris/);
    expect(FUNGSI).toMatch(/14/);
  });
});
