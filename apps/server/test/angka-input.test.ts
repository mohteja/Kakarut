import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

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
  // Sapuan ketiga — KOMA, bukan titik ribuan. Semua di bawah ini `type="number"`
  // polos dengan `step="any"`: pecahan memang diharapkan, dan pemisah desimal
  // bahasa Indonesia adalah KOMA. Lihat uji "isian desimal bukan type=number".
  "pages/menu/MenuFormPage.tsx",
  "pages/resep/ResepPage.tsx",
  "pages/produksi/TahapPage.tsx",
  "pages/produksi/FakturFormPage.tsx",
  "pages/produksi/PenerimaanPage.tsx",
  "pages/produksi/TambahStokPage.tsx",
  "pages/stok/CatatWasteModal.tsx",
  "pages/pengaturan/PerusahaanPage.tsx",
];

/**
 * Berkas yang MASIH boleh memakai `type="number"`, dengan jumlah isian dan
 * alasannya. Daftar ini TERTUTUP: menambah satu `type="number"` di mana pun di
 * `apps/web/src` membuat uji ini merah.
 *
 * Kenapa daftar tertutup, bukan pola: dua penjaga saya sebelumnya memakai pola,
 * dan dua-duanya bolong ke arah yang sama — mereka mengunci SATU EJAAN cacatnya
 * (`type="number"` yang bersebelahan dengan `inputMode="decimal"`, di 12 berkas
 * tertentu), sementara cacat yang sama ditulis polos tanpa `inputMode` di
 * belasan tempat lain dan lewat begitu saja. Daftar tertutup tak bisa bolong ke
 * arah itu: apa pun ejaannya, isian baru harus muncul di sini lebih dulu.
 *
 * Semua yang tersisa adalah BILANGAN BULAT berbatas yang tak pernah ditulis
 * berpemisah — di situ `type="number"` justru berguna (papan ketik angka +
 * tombol naik/turun) dan tak ada koma yang bisa dibuang peramban.
 */
const BOLEH_NUMBER: Record<string, { n: number; alasan: string }> = {
  "components/KategoriManagerModal.tsx": { n: 1, alasan: "urutan tampil — bulat kecil" },
  "pages/pengaturan/SatuanPage.tsx": { n: 1, alasan: "urutan tampil — bulat kecil" },
  "pages/pengaturan/CabangPage.tsx": { n: 1, alasan: "radius absen (meter) — bulat" },
  "pages/pengaturan/PrinterPage.tsx": {
    n: 5,
    alasan: "port, karakter/baris, baris feed, ukuran & jeda chunk — setelan perangkat",
  },
  "pages/superadmin/SmtpPage.tsx": { n: 1, alasan: "port SMTP — bulat" },
  "pages/stok/TambahStokDariMenuPage.tsx": { n: 1, alasan: "porsi rencana — bulat" },
};

/** Semua `.tsx` di bawah `apps/web/src`. */
function semuaTsx(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTsx(p + "/"));
    else if (nama.endsWith(".tsx")) hasil.push(p);
  }
  return hasil;
}

/**
 * Jumlah `type="number"` yang SUNGGUH dirender — komentar dibuang lebih dulu.
 *
 * Perbaikan di berkas-berkas ini justru MENYEBUT `type="number"` di komentar
 * untuk menjelaskan kenapa ia dibuang. Tanpa langkah ini, penjelasan cacatnya
 * terhitung sebagai cacatnya.
 */
function jumlahNumber(isi: string): number {
  // Salinan lokal pengupas komentar dulu tinggal di sini; ia membuang lebih
  // banyak dari yang seharusnya karena menilai `/` tanpa tahu ia ada di mana.
  const tanpaKomentar = butaKomentar(isi);
  return [...tanpaKomentar.matchAll(/type="number"/g)].length;
}

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
      expect(jumlahNumber(readFileSync(akar + berkas, "utf8")), berkas).toBe(0);
    }
  });

  it("tak ada type=number baru di SELURUH web tanpa dicatat alasannya", () => {
    const ketemu: Record<string, number> = {};
    for (const p of semuaTsx(akar)) {
      const n = jumlahNumber(readFileSync(p, "utf8"));
      if (n > 0) ketemu[p.slice(akar.length)] = n;
    }
    const harap = Object.fromEntries(
      Object.entries(BOLEH_NUMBER).map(([k, v]) => [k, v.n]),
    );
    // Dibandingkan DUA ARAH sekaligus. Yang bertambah = isian baru yang belum
    // ditimbang; yang berkurang = catatan basi yang harus ikut dibuang, supaya
    // daftarnya tak pelan-pelan jadi izin untuk apa saja.
    expect(ketemu).toEqual(harap);
  });

  it("yang MENGISI kotak juga satu pintu (teksAngka), bukan String()", () => {
    /**
     * Pembacanya sudah satu (`angkaDari`); penulisnya harus ikut, karena
     * `String()` menghasilkan bentuk yang justru dimakan aturan ke-3
     * `angkaDari` — satu titik diikuti TEPAT tiga angka = ribuan:
     *
     *     String(0.125) → "0.125" → angkaDari → 125    ← 1000× lebih besar
     *
     * Aturan itu benar untuk ketikan orang dan salah untuk cetakan mesin, jadi
     * satu-satunya obatnya adalah menulis lewat `teksAngka`. Tanpa uji ini,
     * takaran resep 0,125 kg berubah jadi 125 kg hanya karena halamannya
     * dibuka lalu disimpan — tanpa satu pun kolom disentuh.
     *
     * Saya nyaris melewatkannya: sapuan ronde ini mengubah belasan isian dari
     * `type="number"` ke `type="text"`, dan justru perubahan itu yang MEMBUAT
     * jalur ini hidup (di `type="number"`, "0.125" dibaca browser dengan
     * benar). Cacatnya sudah lebih dulu ada di berkas yang memang sejak awal
     * `type="text"`.
     *
     * `\bString(` tidak cocok dengan `toString(` — huruf sebelum `S` masih
     * huruf, jadi tak ada batas kata di sana.
     */
    const SAH = ["String(x)", "String(page)", "String(perPage)"];
    for (const berkas of KELUARGA) {
      const isi = readFileSync(akar + berkas, "utf8");
      const semua = [...isi.matchAll(/\bString\([^)]*\)/g)].map((m) => m[0]);
      expect(semua.filter((s) => !SAH.includes(s)), berkas).toEqual([]);
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
