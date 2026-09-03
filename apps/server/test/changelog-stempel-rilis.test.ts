import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ENTRI YANG SUDAH TAYANG TAPI LUPA DISTEMPEL — TAK ADA YANG MENYADARINYA.
 *
 * `CHANGELOG-API.md` adalah satu-satunya tempat tim mobile mengetahui kontrak
 * mana yang sudah hidup di production. Aturannya ditulis di kepala berkasnya:
 *
 *   Entri TANPA baris "Sudah di-merge ke production" berarti BELUM tayang —
 *   mobile boleh menunda menyesuaikan diri.
 *
 * Karena itu stempel yang hilang bukan cuma soal kerapian: ia berbohong ke arah
 * yang berbahaya. Perubahan yang SUDAH tayang terbaca sebagai belum tayang,
 * dan klien yang menunggu justru sedang berbicara dengan server yang kontraknya
 * sudah berganti.
 *
 * Sebelas rilis pernah berada dalam keadaan itu sekaligus. Semuanya kuverifikasi
 * satu per satu di kode `production` — lewat uji penjaganya (`bep-sesudah-diskon`,
 * `kas-laci-milik-shift`, `resep-takaran-atomik`, `transfer-idempoten`,
 * `rencana-faktur-idempoten`, `pb1-tarif-struk`, `analisis-harga-gagal-muat`)
 * atau lewat baris kodenya langsung — sebelum satu pun distempel.
 *
 * Yang dijaga di sini bukan "semua entri harus bertanda". Mendokumentasikan
 * perubahan yang BELUM tayang memang sah dan memang dipakai. Yang dijaga adalah
 * bahwa keadaan itu harus DISENGAJA: entri tanpa stempel wajib disebut namanya
 * di `BELUM_TAYANG` di bawah, lengkap dengan alasannya. Lupa jadi mustahil;
 * yang mungkin tinggal keputusan yang ditulis.
 */
const MD = readFileSync(
  fileURLToPath(new URL("../../../docs/mobile/CHANGELOG-API.md", import.meta.url)),
  "utf8",
);

/**
 * Blok level-2 yang SENGAJA tak berstempel, dengan alasannya.
 *
 * Dua sebab yang berbeda, dan keduanya sah:
 *
 *   · BUKAN RILIS. "Sudah tayang atau belum" tak berlaku untuknya — yang satu
 *     meralat keterangan pada rilis-rilis sebelumnya, yang lain petunjuk
 *     pemeliharaan berkas ini sendiri.
 *   · RILIS YANG MEMANG BELUM TAYANG. Masih di cabang kerja, belum di-merge ke
 *     `production`. Begitu merge-nya terjadi, stempelnya dipasang DAN barisnya
 *     dihapus dari sini — uji "daftar pengecualiannya masih ADA" di bawah
 *     memastikan judul yang tak lagi cocok tak bisa menggantung diam-diam.
 */
const BELUM_TAYANG = new Set([
  /*
   * PARUH "belum di-merge" KOSONG sejak 2026-08-31 — dan kosongnya bukan
   * kerapian. Entri "Angka BIAYA hanya untuk manajemen" tercantum di sini
   * sebagai belum tayang selama EMPAT HARI padahal ia sudah hidup di
   * production sejak merge `6ceef83` (2026-08-27); dibuktikan dari production
   * sendiri, rute `GET /stok/nilai` yang entrinya sebut memang sudah ada di
   * sana. Kepala CHANGELOG menuliskan akibatnya lebih dulu: "mobile akan
   * mengira fitur yang sudah aktif belum bisa dipakai."
   *
   * Daftar ini menahan LUPA MENSTEMPEL; ia tak menahan STEMPEL YANG TERLAMBAT
   * DICABUT, sebab entri yang terdaftar di sini tak pernah ditanya lagi.
   * Batas yang diketahui — dan yang menutupnya kelak harus membandingkan
   * dengan production, bukan dengan daftar ini.
   */
  // bukan rilis
  "## Koreksi kontrak: satuan baris faktur (`qty` vs `satuan_beli` vs `is_batch`)",
  "## Cara memelihara berkas ini",
  // belum di-merge — pemilik repo meminta putaran ini berhenti di cabang kerja
  // sampai ia minta rilis. Stempelnya dipasang dan baris ini dihapus saat
  // merge ke `production` terjadi.
  "## 401 sesi kedaluwarsa dan 401 token palsu kini punya kalimat masing-masing",
]);

/** Dua bentuk stempel yang sah — baris mandiri (baru) dan blockquote (lama). */
const STEMPEL = /[Ss]udah di-?merge ke production/;

function blokLevel2(): { judul: string; isi: string }[] {
  return MD.split(/\n(?=## (?!#))/)
    .filter((b) => b.trimStart().startsWith("## "))
    .map((b) => ({ judul: b.split("\n")[0].trim(), isi: b }));
}

describe("CHANGELOG-API: status tayang tiap entri", () => {
  const blok = blokLevel2();

  it("berkasnya benar-benar terbaca & terpotong (bukan lolos karena kosong)", () => {
    // Tanpa ini, jalur yang salah atau pemisah yang tak lagi cocok membuat
    // seluruh uji hijau tanpa memeriksa satu entri pun.
    expect(blok.length).toBeGreaterThan(30);
    expect(MD).toContain("Sudah di-merge ke production");
  });

  it("aturannya masih tertulis di kepala berkas — uji ini tak menjaga hantu", () => {
    // Kalau konvensinya kelak dihapus, uji ini kehilangan seluruh alasannya dan
    // harus ikut dibuang, bukan dibiarkan menegakkan aturan yang tak berlaku.
    expect(MD).toContain("**Status rilis:**");
  });

  it("tiap entri bertanda tayang, kecuali yang disebut namanya berikut alasannya", () => {
    const lupa = blok.filter((b) => !STEMPEL.test(b.isi) && !BELUM_TAYANG.has(b.judul));
    expect(
      lupa.map((b) => b.judul),
      "entri ini tak bertanda tayang dan tak ada di BELUM_TAYANG. Kalau sudah " +
        "di-merge, tambahkan baris **Sudah di-merge ke production.** tepat di " +
        "bawah penanda audiensnya. Kalau memang belum, daftarkan judulnya di " +
        "BELUM_TAYANG beserta alasannya — jangan dibiarkan menggantung, sebab " +
        "mobile membaca 'tanpa stempel' sebagai 'belum tayang'",
    ).toEqual([]);
  });

  it("daftar pengecualiannya masih ADA — bukan kuburan judul basi", () => {
    // Judul yang diubah/dihapus membuat pengecualiannya diam-diam melebar:
    // entri lain yang kelak lupa distempel tak akan ketahuan.
    const judul = new Set(blok.map((b) => b.judul));
    for (const j of BELUM_TAYANG) expect(judul, j).toContain(j);
  });

  it("tak ada entri yang distempel dua kali", () => {
    // Penstempelan pernah dikerjakan dengan skrip; menjalankannya dua kali
    // menyisipkan baris kedua yang tak terlihat salah saat dibaca sepintas.
    const ganda = blok
      .filter((b) => (b.isi.match(/^\*\*Sudah di-merge ke production\.\*\*$/gm) ?? []).length > 1)
      .map((b) => b.judul);
    expect(ganda).toEqual([]);
  });
});
