import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga SATU PEMBACA ANGKA untuk isian yang diketik orang.
 *
 * Berkas-berkas di bawah memegang angka sebagai TEKS di state (input-nya
 * `inputMode="decimal"`, jadi pemakainya bebas mengetik `1,5` atau `1.500` —
 * dua bentuk yang aplikasi ini sendiri cetak lewat `Intl id-ID`). Semuanya
 * wajib membacanya lewat `angkaDari`; `Number()` mentah membaca kebalikannya.
 *
 * Kenapa dijaga, bukan cukup diperbaiki sekali: perbaikan pertama saya SETENGAH
 * JALAN. `angkaDari` dipasang di `BahanEditorGrid` — yang menghitung pratinjau
 * harga/satuan — tapi jalur SIMPAN-nya ada di dua halaman pemilik grid itu, dan
 * keduanya masih memakai `Number()`. Hasilnya lebih buruk daripada sebelum
 * diperbaiki: pratinjaunya membenarkan bacaan pemakai ("1.500" → harga per
 * satuan yang benar), lalu simpanannya diam-diam menyimpan 1,5.
 *
 * Satu berkas benar sementara tetangganya salah adalah bentuk kegagalan yang
 * paling meyakinkan — layar ikut berbohong. Karena itu keluarganya dipatok
 * bersama, bukan satu per satu.
 */
const akar = fileURLToPath(new URL("../../web/src/", import.meta.url));

/** Berkas yang mengurai angka ketikan pemakai. */
const KELUARGA = [
  // Empat isian HARGA yang menyusul, dan yang membuat mereka luput selama ini
  // patut dicatat: sapuan pertama saya menyaring berkas berdasarkan keberadaan
  // `inputMode`. Keempatnya `type="number"` POLOS — tak ada `inputMode` sama
  // sekali — jadi saringan itu melewatinya, bukan karena mereka aman.
  //
  // Diukur di Chromium: `type="number"` menerima "15.000" apa adanya, lalu
  // `Number("15.000")` = 15. Pemilik menetapkan harga acuan Rp 15.000 dan
  // tersimpan Rp 15 — tanpa satu pun tanda di layar.
  "components/RiwayatHargaModal.tsx",
  "pages/produksi/LaporanHargaModal.tsx",
  "pages/perlengkapan/PerlengkapanPage.tsx",
  "pages/stok/StokPerlengkapanTab.tsx",
  "pages/bahan/BahanEditorGrid.tsx",
  "pages/bahan/TambahBahanBakuPage.tsx",
  "pages/bahan/UbahBahanBakuPage.tsx",
  "pages/perlengkapan/BeliPerlengkapanPage.tsx",
  "pages/stok/OpnamePage.tsx",
  "pages/stok/OpnamePerlengkapanPage.tsx",
  "pages/stok/StokAwalPage.tsx",
  "pages/stok/TransferStokPage.tsx",
];

describe("isian angka: satu pembaca saja (angkaDari)", () => {
  for (const berkas of KELUARGA) {
    it(`${berkas} tak memakai Number() mentah`, () => {
      const isi = readFileSync(akar + berkas, "utf8");
      // `Number.isNaN` / `Number.isFinite` bukan pengurai — itu pemeriksa.
      const mentah = [...isi.matchAll(/\bNumber\(/g)];
      expect(mentah).toHaveLength(0);
      expect(isi).toContain("angkaDari");
    });
  }

  it("isian desimal bukan type=number — peramban membuang komanya", () => {
    /**
     * Diukur di Chromium, bukan dikira-kira dari spesifikasi:
     *
     *   <input type="number">  ketik "1,5"  → value "15"     ← koma HILANG
     *   <input type="text">    ketik "1,5"  → value "1,5"
     *
     * `type="number"` hanya menerima literal pecahan gaya mesin, jadi komanya
     * dibuang DIAM-DIAM sebelum kode kita melihatnya — `angkaDari` menerima
     * "15" dan menjawab 15 dengan benar. Salah 10×, tanpa satu pun tanda.
     *
     * Karena itu `angkaDari` saja tidak cukup: isiannya harus `type="text"`
     * supaya yang diketik benar-benar sampai. (Arah titik-ribuan sudah beres
     * lebih dulu: "15.000" bertahan utuh bahkan di `type="number"`.)
     *
     * Yang hilang: `min`/`step` bawaan peramban. Itu bukan kemunduran —
     * pagarnya ada dua lapis di bawahnya: penahan simpan di halaman masing-
     * masing, dan batas zod di server.
     */
    for (const berkas of KELUARGA) {
      const isi = readFileSync(akar + berkas, "utf8");
      const salah = /type="number"(?:\s*\n\s*\w+="[^"]*")*?\s*\n\s*inputMode="decimal"/.exec(isi);
      expect(salah?.[0] ?? null).toBeNull();
    }
  });

  it("lintang/bujur cabang SENGAJA tidak ikut", () => {
    // Di sana "-6.200" adalah koordinat mesin yang berarti -6,2 derajat, bukan
    // -6200. Aturan id-ID hanya berlaku untuk angka yang berasal dari layar
    // ini; menerapkannya pada koordinat justru merusaknya.
    const cabang = readFileSync(akar + "pages/pengaturan/CabangPage.tsx", "utf8");
    expect(cabang).not.toContain("angkaDari");
  });
});
