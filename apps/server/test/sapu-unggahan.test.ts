import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { namaBasis, TENGGANG_HARI } from "../src/lib/sapu-unggahan";

/**
 * SAPUAN BERKAS UNGGAHAN YATIM.
 *
 * `POST /upload` tak menulis baris DB apa pun, dan komentar pintunya sendiri
 * menulis celahnya: "tak ada kuota per perusahaan, tak ada pembersihan
 * yatim". Terukur (2026-08-25): 2.384 berkas di direktori unggahan dev, 40
 * nilai rujukan (20 nama unik) di database aktifnya — lalu sapuan nyata
 * menghapus 2.383 dan MENYISAKAN persis satu-satunya berkas yang dirujuk,
 * meski umurnya sama tua (perlindungannya rujukan, bukan umur).
 *
 * Dua hal yang uji ini paku:
 * 1. KELENGKAPAN DAFTAR PERUJUK — daftar kolomnya tulisan tangan (kelas yang
 *    pernah memakan temuan 1,61 MB), jadi ia ditagih terhadap sapuan mekanis
 *    `schema.ts`: kolom `*_url` baru yang tidak masuk daftar (atau daftar
 *    kecualinya) membuat uji ini merah DENGAN NAMA kolomnya.
 * 2. PAGAR KESELAMATANNYA — rujukan dikumpulkan sebelum daftar storage,
 *    umur tak terbaca tidak dihapus, dan masa tenggang tak menciut diam-diam.
 */
const SKEMA = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/db/schema.ts", import.meta.url)), "utf8"),
);
const SAPU = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/lib/sapu-unggahan.ts", import.meta.url)), "utf8"),
);

/** Kolom URL yang SENGAJA tidak disapu, dengan alasan yang bisa diperiksa. */
const DIKECUALIKAN: Record<string, string> = {
  // (kosong hari ini — kolom URL baru yang bukan unggahan ditulis di sini)
};

describe("sapu unggahan yatim", () => {
  it("KELENGKAPAN: tiap kolom *_url di schema.ts diputuskan — disapu atau dikecualikan", () => {
    // Sapuan mekanis: semua kolom SQL berakhiran _url, DIHITUNG per nama —
    // tabel BARU yang memakai ulang nama lama (foto_url kedua, ketiga…) tak
    // boleh lolos hanya karena nama itu sudah pernah masuk daftar.
    const hitungSkema = new Map<string, number>();
    for (const m of SKEMA.matchAll(/\b\w+:\s*text\("([a-z_]*url)"\)/g)) {
      hitungSkema.set(m[1], (hitungSkema.get(m[1]) ?? 0) + 1);
    }
    const total = [...hitungSkema.values()].reduce((a, b) => a + b, 0);
    expect(total, "PREMIS: sapuan skema tidak menemukan apa pun").toBeGreaterThanOrEqual(9);
    for (const [kolom, jumlah] of hitungSkema) {
      if (kolom in DIKECUALIKAN) continue;
      const diDaftar = SAPU.split(`.${kolom}"`).length - 1;
      expect(
        diDaftar,
        `kolom URL "${kolom}": ${jumlah} di schema.ts tapi ${diDaftar} di ` +
          `KOLOM_PERUJUK sapu-unggahan.ts — berkas yang HANYA dirujuk kolom yang ` +
          `hilang akan dihapus sapuan sebagai yatim`,
      ).toBe(jumlah);
    }
  });

  it("namaBasis: kebal terhadap bentuk rujukan yang tersimpan", () => {
    expect(namaBasis("/uploads/companies/c1/bukti/abc.jpg")).toBe("abc.jpg");
    expect(namaBasis("https://cdn.example.com/companies/c1/menu/xyz.png")).toBe("xyz.png");
    expect(namaBasis("polos.webp")).toBe("polos.webp");
  });

  it("PAGAR: rujukan dikumpulkan SEBELUM daftar storage — gagal baca = tak menghapus", () => {
    const posRujukan = SAPU.indexOf("KOLOM_PERUJUK) {");
    const posList = SAPU.indexOf('storage.list("companies/")');
    expect(posRujukan, "loop rujukan hilang").toBeGreaterThan(-1);
    expect(posList, "daftar storage hilang").toBeGreaterThan(-1);
    expect(posRujukan, "urutan terbalik — penghapusan bisa berjalan atas rujukan separuh")
      .toBeLessThan(posList);
  });

  it("PAGAR: umur tak terbaca tidak dihapus; tenggang tak menciut", () => {
    expect(SAPU, "berkas ber-mtime gagal-baca ikut terhapus").toContain("o.waktu === null");
    expect(
      TENGGANG_HARI,
      "masa tenggang menciut — jendela unggah-dulu-perintah-menyusul (dan antrean " +
        "gagal yang masih ditinjau kasir) butuh ruang",
    ).toBeGreaterThanOrEqual(7);
  });
});
