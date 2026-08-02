/**
 * Membaca angka yang DIKETIK ORANG, dalam format yang aplikasi ini sendiri
 * tampilkan.
 *
 * Seluruh layar memakai `Intl.NumberFormat("id-ID")`, jadi yang dibaca mata
 * pemakai adalah `1,5` dan `1.500` — koma desimal, titik ribuan. Lalu kotak
 * isiannya memakai `Number()` mentah, yang membaca kebalikannya:
 *
 *     Number("1,5")    → NaN     (ditolak)
 *     Number("1.500")  → 1.5     (DITERIMA, salah 1000×)
 *
 * Dua-duanya nyata dan keduanya berbahaya, tapi yang kedua jauh lebih buruk:
 * ia tidak mengeluh sama sekali. Petugas gudang membaca "Saldo: 1.500" di
 * layar, mengetik ulang persis seperti yang dibacanya, dan menyimpan 1,5.
 *
 * Yang pertama pun tak berhenti di penolakan yang rapi: NaN lolos ke tampilan
 * (`Intl` mencetaknya harfiah "NaN") dan ke JSON, tempat ia berubah jadi `null`
 * sehingga server membalas galat validasi yang tak menyebut kolom mana yang
 * salah ketik.
 *
 * Aturan pemisah — urutannya penting:
 *
 * 1. Ada koma DAN titik → yang terakhir muncul adalah pemisah desimal, yang
 *    lain pemisah ribuan. `1.500,75` → 1500.75; `1,500.75` → 1500.75.
 * 2. Hanya koma → pemisah desimal (kaidah id-ID). `1,5` → 1.5.
 * 3. Hanya titik:
 *    - lebih dari satu titik → semuanya ribuan. `1.500.000` → 1500000.
 *    - tepat satu titik diikuti TEPAT tiga angka → ribuan. `1.500` → 1500.
 *      Ini yang aplikasi cetak sendiri untuk 1500, jadi begitulah ia dibaca
 *      balik. Tak ada yang menulis "1.500" bermaksud satu setengah.
 *    - selain itu → desimal. `1.5` → 1.5; `12.75` → 12.75; `0.25` → 0.25.
 *
 * Mengembalikan `NaN` bila tak terbaca — pemanggil yang memutuskan artinya
 * (kosong = belum diisi, atau ditolak). Sengaja TIDAK memulangkan 0: 0 adalah
 * angka yang sah dan bermakna di stok, dan menjadikannya nilai kegagalan
 * membuat salah ketik tak bisa dibedakan dari "memang nol".
 */
export function angkaDari(teks: string | number | null | undefined): number {
  if (typeof teks === "number") return teks;
  if (teks == null) return NaN;

  const bersih = teks.trim().replace(/\s/g, "");
  if (bersih === "") return NaN;

  // Hanya angka, pemisah, dan tanda minus di depan. Menolak "12abc" — yang
  // `Number()` juga tolak, tapi `parseFloat` diam-diam terima sebagai 12.
  if (!/^-?[\d.,]+$/.test(bersih)) return NaN;

  const komaAkhir = bersih.lastIndexOf(",");
  const titikAkhir = bersih.lastIndexOf(".");

  let normal: string;
  if (komaAkhir >= 0 && titikAkhir >= 0) {
    const desimalDi = Math.max(komaAkhir, titikAkhir);
    normal =
      bersih.slice(0, desimalDi).replace(/[.,]/g, "") +
      "." +
      bersih.slice(desimalDi + 1).replace(/[.,]/g, "");
  } else if (komaAkhir >= 0) {
    normal = bersih.replace(/,/g, ".");
    // "1,5,5" bukan angka — jangan diam-diam dijadikan sesuatu.
    if (normal.split(".").length > 2) return NaN;
  } else if (titikAkhir >= 0) {
    const bagian = bersih.split(".");
    const ribuan = bagian.length > 2 || /^\d{3}$/.test(bagian[bagian.length - 1]);
    normal = ribuan ? bagian.join("") : bersih;
  } else {
    normal = bersih;
  }

  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

/** `angkaDari`, tapi memulangkan `null` alih-alih NaN — enak untuk badan JSON. */
export function angkaAtauNull(teks: string | number | null | undefined): number | null {
  const n = angkaDari(teks);
  return Number.isNaN(n) ? null : n;
}
