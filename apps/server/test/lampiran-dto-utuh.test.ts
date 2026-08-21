import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * LAMPIRAN A `docs/API-CONTRACT.md` HARUS BENAR-BENAR SALINAN UTUH
 * `packages/shared/src/types.ts`.
 *
 * KENAPA UJI INI ADA — dan ini bukan kekhawatiran teoretis.
 *
 * Lampiran itu membuka dirinya dengan kalimat "Seluruh isi file tipe bersama
 * disalin utuh di bawah". Saat uji ini ditulis, kalimat itu SALAH: dua belas
 * tipe sama sekali tak ada di sana (`PeringatanCadanganDto`, `TemuanSetelanDto`,
 * `AnomaliKiriman`, `LaporanDurasiPesanan`, dan delapan lainnya), `LaporanHarian`
 * masih versi lama tanpa `per_jam`, dan 454 baris menyimpang seluruhnya.
 *
 * Yang membuatnya berbahaya bukan ketertinggalannya, melainkan JANJINYA.
 * Dokumen ini ditulis untuk tim mobile yang TIDAK punya akses repo server —
 * lampiran inilah satu-satunya tempat mereka bisa memeriksa bentuk data. Berkas
 * yang jujur mengaku "ringkasan" akan dicurigai dan dicek ulang; berkas yang
 * mengaku "salinan utuh" tidak. Ketiadaan sebuah medan di sana dibaca sebagai
 * "medannya memang tidak ada", bukan "dokumennya belum diperbarui — dan itu
 * persis bagaimana `per_jam` bisa hidup di server berbulan-bulan tanpa satu
 * pun klien mobile menguraikannya.
 *
 * Kelas kegagalannya sama dengan `laporan_refund_test.dart` di repo mobile:
 * medan yang tak diurai tidak melempar apa-apa, ia cuma jadi nol atau daftar
 * kosong. Bedanya, di sini akarnya bukan kode klien melainkan dokumen yang
 * menjadi acuannya.
 *
 * CARA MEMPERBAIKI KALAU UJI INI MERAH: jangan menyunting lampirannya dengan
 * tangan. Jalankan `npm run sinkron:lampiran -w @kakarut/server`, yang menyalin
 * ulang seluruh `types.ts` ke dalam pagar kode itu.
 */
const KONTRAK = fileURLToPath(new URL("../../../docs/API-CONTRACT.md", import.meta.url));
const TIPE = fileURLToPath(new URL("../../../packages/shared/src/types.ts", import.meta.url));

/**
 * Ambil isi pagar kode ```typescript pertama SESUDAH judul Lampiran A.
 *
 * Dicari dari judulnya, bukan dari nomor baris: dokumen ini tumbuh terus di
 * atasnya, dan patokan berupa nomor baris akan diam-diam menunjuk pagar yang
 * salah begitu ada satu bagian baru disisipkan.
 */
function isiLampiran(md: string): string {
  const judul = md.indexOf("## Lampiran A");
  expect(judul, "judul '## Lampiran A' tak ditemukan di API-CONTRACT.md").toBeGreaterThan(-1);
  const buka = md.indexOf("```typescript", judul);
  expect(buka, "tak ada pagar kode ```typescript sesudah judul Lampiran A").toBeGreaterThan(-1);
  const awal = md.indexOf("\n", buka) + 1;
  const tutup = md.indexOf("\n```", awal);
  expect(tutup, "pagar kode Lampiran A tak pernah ditutup").toBeGreaterThan(-1);
  return md.slice(awal, tutup);
}

describe("Lampiran A adalah salinan utuh types.ts", () => {
  const md = readFileSync(KONTRAK, "utf8");
  const tipe = readFileSync(TIPE, "utf8");
  const lampiran = isiLampiran(md);

  it("INTI: isinya sama persis, baris demi baris", () => {
    // Dibandingkan sesudah spasi ujung dibuang: perbedaan yang tak terlihat mata
    // bukan perbedaan yang berguna dilaporkan, dan editor markdown suka
    // merapikannya sendiri.
    const rapi = (s: string) =>
      s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
    expect(rapi(lampiran)).toBe(rapi(tipe));
  });

  it("PASANGAN: pembandingnya memang bisa MENUDUH", () => {
    /*
     * Tanpa ini, asersi di atas juga hijau seandainya `isiLampiran` memulangkan
     * string kosong untuk dokumen yang sama sekali tak punya lampiran — dan
     * "kosong == kosong" adalah hijau yang paling tak berarti.
     */
    const rapi = (s: string) =>
      s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
    expect(rapi(lampiran).length).toBeGreaterThan(50_000);
    expect(rapi(lampiran)).not.toBe(rapi(tipe + "\nexport interface Palsu {}"));
  });

  it("janji di kalimat pembukanya sesuai dengan yang dilakukan uji ini", () => {
    // Kalau kelak lampirannya sengaja diubah jadi RINGKASAN, kalimat ini yang
    // harus berubah lebih dulu — dan uji ini akan menuntut penjelasannya alih-
    // alih membiarkan janji lama menggantung di atas isi yang tak lagi
    // memenuhinya.
    const judul = md.indexOf("## Lampiran A");
    const pembuka = md.slice(judul, md.indexOf("```typescript", judul));
    expect(pembuka).toContain("disalin utuh");
  });

  it("medan yang tersandung dulu benar-benar ada di sana sekarang", () => {
    // Contoh konkret, bukan hiasan: `per_jam` justru yang membuat uji ini
    // ditulis. Nama-nama ini boleh dihapus dari daftar kalau tipenya memang
    // dihapus dari types.ts — asersi INTI di atas yang jadi penjaga
    // sesungguhnya.
    for (const nama of [
      "per_jam",
      "PeringatanCadanganDto",
      "TemuanSetelanDto",
      "LaporanDurasiPesanan",
      "AnomaliKiriman",
    ]) {
      expect(lampiran, `Lampiran A tak memuat ${nama}`).toContain(nama);
    }
  });
});
