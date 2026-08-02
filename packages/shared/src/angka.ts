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

  const bersih = teks
    .trim()
    .replace(/\s/g, "")
    // Imbuhan rupiah, dibuang SEBELUM pemeriksaan ketat di bawah.
    //
    // Harga di dunia nyata jarang diketik ulang — ia DITEMPEL, dari daftar
    // harga WhatsApp supplier atau dari spreadsheet, dan datang lengkap
    // dengan bajunya: "Rp 15.000", "Rp15000", "12.500,-".
    //
    // Tanpa ini semuanya jadi NaN, dan hampir semua pemanggil menulis
    // `angkaDari(x) || 0` — jadi harga yang ditempel tersimpan NOL, bukan
    // ditolak. Pengurai CSV di repo ini sudah membuang "Rp" persis karena
    // alasan yang sama ("Jadi harga ber-'Rp' tak lagi terbaca 0"); isian
    // form punya paparan yang sama dan tak ikut dibereskan.
    //
    // SENGAJA hanya imbuhan ini, bukan "buang semua yang bukan angka" gaya
    // CSV: `OpnamePage` dan `StokAwalPage` memakai `Number.isNaN(angkaDari(…))`
    // untuk menandai salah ketik, dan kelonggaran penuh mengubah "12abc" jadi
    // 12 — penanda salah ketiknya mati tanpa suara.
    .replace(/^rp\.?/i, "")
    .replace(/[,.]-$/, "");
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

/**
 * Kebalikan `angkaDari`: mengubah angka SERVER jadi teks untuk MENGISI kotak
 * isian, dalam bentuk yang terbaca balik utuh.
 *
 * Ini bukan hiasan, dan bukan sekadar soal selera tampilan. `String(n)` memakai
 * titik desimal, dan aturan ke-3 `angkaDari` — satu titik diikuti TEPAT tiga
 * angka berarti ribuan — memakan justru bentuk itu:
 *
 *     String(0.125)  → "0.125"  → angkaDari → 125     ← 1000× lebih besar
 *     String(1.375)  → "1.375"  → angkaDari → 1375
 *     String(0.001)  → "0.001"  → angkaDari → 1
 *
 * Aturan itu benar untuk yang DIKETIK orang ("1.500" memang seribu lima ratus;
 * tak ada yang menulis begitu untuk satu setengah) dan salah untuk yang
 * DICETAK mesin. Bedanya cuma terlihat kalau penulisnya satu pintu dengan
 * pembacanya — karena itu fungsi ini hidup bersebelahan dengan `angkaDari`.
 *
 * Bentuk kegagalannya khas: takaran resep 0,125 kg (125 gram) dibuka lalu
 * disimpan ulang TANPA disentuh, dan berubah jadi 125 kg. Halamannya tak perlu
 * diedit sama sekali — cukup dibuka dan disimpan.
 */
export function teksAngka(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = String(n);
  // Notasi eksponen (|n| < 1e-6 atau ≥ 1e21) di luar jangkauan qty/harga
  // aplikasi ini; dibiarkan apa adanya daripada dikarang jadi angka lain.
  return s.includes("e") || s.includes("E") ? s : s.replace(".", ",");
}

/** `angkaDari`, tapi memulangkan `null` alih-alih NaN — enak untuk badan JSON. */
export function angkaAtauNull(teks: string | number | null | undefined): number | null {
  const n = angkaDari(teks);
  return Number.isNaN(n) ? null : n;
}
