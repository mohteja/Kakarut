import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * RESEP DIBUKA TERKUNCI — "boleh mengubah" TERPISAH dari "sedang mengubah".
 *
 * Diminta pemilik repo 2026-09-04: *"resep ketika di klik ingin read only saja,
 * dan ingin ada tombol edit untuk admin dan owner"*. Sebelumnya panel detail
 * langsung bisa diketik begitu resepnya diklik, jadi satu klik nyasar di medan
 * takaran cukup mengubah HPP setiap menu yang memakai bahan itu.
 *
 * YANG DIJAGA DI SINI justru pemisahan benderanya, bukan tombolnya. `bolehUbah`
 * (peran) menjaga DUA hal yang berbeda: afordansi mengetik, DAN kelihatan atau
 * tidaknya angka manajemen — kolom uang di daftar, harga per satuan di baris
 * bahan, total bahan baku. Kalau keduanya dipadatkan jadi satu bendera, mode
 * "baca" akan ikut menyembunyikan harga dari owner yang cuma ingin melihat —
 * dan itu membuat mode baca tak berguna justru bagi orang yang paling sering
 * memakainya.
 *
 * YANG TIDAK DIJANJIKAN uji ini: ia membaca teks, jadi tak bisa mengatakan
 * medannya benar-benar tak bisa diketik di peramban. Yang mengukur itu dua
 * lengan di `apps/web/e2e/resep-tampilan.spec.ts`, dan blok terakhir di bawah
 * memaku keberadaannya.
 */
const baca = (rel: string) =>
  butaKomentar(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const HAL = baca("../../web/src/pages/resep/ResepPage.tsx");
const E2E = baca("../../web/e2e/resep-tampilan.spec.ts");

describe("dua bendera, dan yang mana menjaga apa", () => {
  it("keduanya ada, dan `sedangUbah` menuntut IZIN sekaligus MODE", () => {
    expect(HAL).toMatch(/const bolehUbah = role === "owner" \|\| role === "admin";/);
    expect(HAL).toContain('const [mode, setMode] = useState<"lihat" | "ubah">("lihat");');
    // Bawaannya "lihat" — dan itu inti permintaannya.
    expect(HAL).toContain('useState<"lihat" | "ubah">("lihat")');
    // `sedangUbah` TIDAK boleh cuma `mode === "ubah"`: tanpa `bolehUbah`,
    // peran non-manajemen bisa membuka mode ubah lewat keadaan lokal.
    expect(HAL).toContain('const sedangUbah = bolehUbah && mode === "ubah";');
  });

  it("tiap medan yang bisa diketik terkunci pada MODE, bukan pada peran", () => {
    expect(HAL).not.toContain("disabled={!bolehUbah}");
    expect((HAL.match(/disabled=\{!sedangUbah\}/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it("angka manajemen TETAP terlihat saat terkunci — bukan ikut disembunyikan", () => {
    /*
     * Kalau ini pernah berubah jadi `sedangUbah`, mode baca berhenti
     * menampilkan harga kepada owner — dan mode baca yang menyembunyikan
     * justru yang ingin dilihat adalah mode baca yang orang lewati.
     */
    expect(HAL).toContain("{bolehUbah && resep.length > 0 && (");
    expect(HAL).toContain("kolomDaftarResep({ bolehUbah, ringkas })");
  });

  it("tombol Edit hanya untuk yang berhak, dan hanya saat terkunci", () => {
    expect(HAL).toContain("{bolehUbah && !sedangUbah && (");
    expect(HAL).toContain("✏️ Edit resep");
    // Simpan & Arsipkan pindah ke mode ubah — keduanya di blok yang sama.
    expect(HAL).toContain("{sedangUbah && (");
  });
});

describe("ketikan tak hilang tanpa ditanya", () => {
  it("konfirmasi hanya saat drafnya MEMANG berubah", () => {
    // Konfirmasi yang muncul juga saat tak ada yang diubah adalah konfirmasi
    // yang orang belajar menekan "OK" tanpa membaca.
    expect(HAL).toContain("const adaPerubahan = () =>");
    expect(HAL).toMatch(/adaPerubahan\(\) &&\s*!confirm\(/);
  });

  it("PINTU SAMPING ikut dijaga: pindah resep saat mengubah", () => {
    /*
     * Tombol Batal bukan satu-satunya jalan keluar. Mengklik resep lain juga
     * meninggalkan mode ubah, dan kalau ia tak lewat penjaga yang sama,
     * ketikan hilang lewat pintu yang tak dijaga sementara pintu depan dijaga.
     */
    const i = HAL.indexOf("const bukaDetail = (id: string | null) => {");
    expect(i, "bukaDetail bukan lagi bentuk yang bisa diperiksa").toBeGreaterThan(0);
    const blok = HAL.slice(i, i + 500);
    expect(blok).toContain('if (mode === "ubah")');
    expect(blok).toContain("adaPerubahan()");
    expect(blok).toContain("confirm(");
  });

  it("sesudah simpan berhasil, panel terkunci lagi", () => {
    // Pilihan pemilik: simpan = selesai, jadi keadaan diam halaman selalu
    // terkunci dan tak ada resep yang tertinggal terbuka.
    /*
     * Irisannya 600, bukan 200: `butaKomentar` MENGOSONGKAN komentar tanpa
     * memendekkan berkasnya (posisi baris lain harus tetap), jadi blok
     * penjelasan enam baris di antara keduanya tetap memakan tempat.
     * Angka yang pas-pasan di sini lolos hari ini lalu diam-diam berhenti
     * melihat apa pun begitu komentarnya tumbuh.
     */
    const i = HAL.indexOf('queryClient.invalidateQueries({ queryKey: ["stok"] });');
    expect(i).toBeGreaterThan(0);
    const blok = HAL.slice(i, i + 600);
    expect(blok).toContain('setMode("lihat")');
    expect(blok).toContain("cadanganDraf.current = null");
  });
});

describe("konfirmasi simpan HIDUP di mode yang benar", () => {
  /*
   * Regresi yang lahir dari keputusan "sesudah simpan, kembali terkunci" —
   * dan lolos dari SELURUH gerbang putaran itu.
   *
   * Penanda "✓ Tersimpan" berdiri di dalam blok `sedangUbah`, berdampingan
   * dengan tombol Simpan. Begitu simpan yang berhasil memanggil
   * `setMode("lihat")`, `sedangUbah` menjadi false pada render yang SAMA
   * dengan yang membuat penandanya layak tampil — jadi ia dilepas sebelum
   * pernah sekali pun terlihat. Yang menyimpan resep karena itu tak mendapat
   * konfirmasi apa pun: panelnya cuma terkunci, dan diamnya tak bisa
   * dibedakan dari simpan yang gagal tanpa suara.
   *
   * Tak ada uji statis yang bisa menemukannya — keduanya benar dibaca
   * terpisah. Yang menemukannya lengan peramban putaran riwayat resep.
   * Penjaga di bawah menjaga BENTUK perbaikannya supaya ia tak berbalik.
   */
  it("penandanya berada di blok mode BACA, bukan di blok `sedangUbah`", () => {
    const tanda = HAL.indexOf("✓ Tersimpan");
    expect(tanda).toBeGreaterThan(0);
    // Blok baca dikenali dari tombol Edit yang cuma ada di sana.
    const bacaMulai = HAL.indexOf("✏️ Edit resep");
    const ubahMulai = HAL.indexOf('onClick={() => simpan.mutate()}');
    expect(bacaMulai).toBeGreaterThan(0);
    expect(ubahMulai).toBeGreaterThan(bacaMulai);
    expect(tanda, "penanda tersimpan kembali ke blok mode ubah").toBeLessThan(ubahMulai);
  });

  it("penandanya terikat resep yang BENAR-BENAR disimpan", () => {
    // `simpan.isSuccess` telanjang bertahan sampai mutasi berikutnya, jadi
    // tanda hijaunya akan menempel di panel resep LAIN yang diklik sesudahnya.
    expect(HAL).toContain("terakhirSimpan === dipilih.id");
    expect(HAL).toContain("setTerakhirSimpan(selectedId)");
    // …dan padam saat mode ubah dibuka lagi.
    expect(HAL).toMatch(/setTerakhirSimpan\(null\);\s*\n\s*setMode\("ubah"\)/);
  });
});

describe("lengan peramban ADA — yang cuma peramban bisa menjawab", () => {
  it("terkunci saat dibuka, Edit membukanya, Batal bertanya", () => {
    expect(E2E).toContain("await expect(takaran).toBeDisabled();");
    expect(E2E).toMatch(/name: \/Edit resep\//);
    expect(E2E).toContain("await expect(takaran).toBeEnabled();");
    // premisnya diturunkan dari server, bukan dari urutan baris tabel
    expect(E2E).toContain("/api/bahan/resep-ringkas");
    // dan lengan konfirmasinya menghitung dialognya, bukan sekadar menerimanya
    expect(E2E).toContain('expect(ditanya, "Batal membuang ketikan tanpa bertanya").toBe(1);');
  });
});
