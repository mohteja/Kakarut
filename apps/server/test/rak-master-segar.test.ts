import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga CHIP RAK di daftar master.
 *
 * Menugaskan rak dilakukan di Tempat Penyimpanan (`PUT /penyimpanan/:id/bahan`,
 * yang menulis `storage_location_ingredients`). Hasilnya tampil sebagai chip
 * `rak_lokasi` di DUA daftar master: Bahan Baku dan Perlengkapan — server
 * menyusun keduanya dari tabel yang sama.
 *
 * Kedua daftar itu berkunci MASTER (`bahan`, `perlengkapan-master`), dan kunci
 * master di aplikasi ini sengaja ber-`staleTime` 5 menit ("data master jarang
 * berubah dan setiap mutasi sudah meng-invalidate kuncinya sendiri"). Asumsi
 * itulah yang dilanggar: mutasinya ada di halaman LAIN, dan halaman itu tidak
 * menyentuh kunci masternya. Chipnya menampilkan rak lama selama lima menit.
 *
 * Yang membuatnya menyesatkan, bukan sekadar lambat: tooltip chip di Bahan Baku
 * berbunyi "(atur di Tempat Penyimpanan)". Ia menunjuk layar yang barusan
 * dipakai orang itu — jadi ia kembali memeriksa hasilnya, menemukan rak lama,
 * dan menugaskan ulang.
 *
 * Dijaga untuk KEDUA jenis sekaligus. Sumbu bahan ↔ perlengkapan sudah dua kali
 * membuktikan diri asimetris di repo ini; memperbaiki satu sisi saja adalah
 * bentuk kegagalan yang paling mungkin terulang.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const PENYIMPANAN = baca("../../web/src/pages/pengaturan/PenyimpananPage.tsx");
const BAHAN = baca("../../web/src/pages/bahan/BahanPage.tsx");
const PERLENGKAPAN = baca("../../web/src/pages/perlengkapan/PerlengkapanPage.tsx");
const MAIN = baca("../../web/src/main.tsx");

describe("menugaskan rak menyegarkan daftar master kedua jenis", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(PENYIMPANAN).toContain("penyimpanan-bahan");
    expect(PENYIMPANAN).not.toContain("paling lama basi");
  });

  it("kunci master jenis yang diedit ikut di-invalidate", () => {
    expect(PENYIMPANAN).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\[isBahan \? "bahan" : "perlengkapan-master"\]\s*\}\)/,
    );
  });

  it("daftar stok per cabang tetap disegarkan untuk perlengkapan", () => {
    // Ini sudah benar sebelumnya; dipatok agar tak ikut hilang saat dirapikan.
    expect(PENYIMPANAN).toMatch(/invalidateQueries\(\{ queryKey: \["perlengkapan"\] \}\)/);
  });
});

/**
 * Premis temuan ini, dipatok terpisah: kalau salah satunya berubah, alasan
 * invalidasi di atas ikut gugur — dan lebih baik gugur dengan berisik.
 */
describe("premisnya tetap berlaku", () => {
  it("kedua daftar master benar-benar merender chip rak", () => {
    expect(BAHAN).toMatch(/rak_lokasi/);
    expect(PERLENGKAPAN).toMatch(/rak_lokasi/);
  });

  it("keduanya memang berkunci master ber-staleTime panjang", () => {
    const daftar = MAIN.slice(MAIN.indexOf("KUNCI_MASTER = ["), MAIN.indexOf("];"));
    expect(daftar).toMatch(/"bahan"/);
    expect(daftar).toMatch(/"perlengkapan-master"/);
    expect(MAIN).toMatch(/staleTime: 5 \* 60_000/);
  });

  it("daftar Bahan Baku memakai kunci 'bahan', Perlengkapan 'perlengkapan-master'", () => {
    expect(BAHAN).toMatch(/queryKey: \["bahan"/);
    expect(PERLENGKAPAN).toMatch(/queryKey: \["perlengkapan-master"\]/);
  });
});
