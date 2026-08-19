/**
 * MEMBAGI HARGA SATU BARIS SAAT QTY-NYA DIPECAH.
 *
 * Satu baris rencana 8 pcs seharga Rp 40.000 yang diproses 3 pcs harus jadi dua
 * baris — 3 pcs dan 5 pcs — dan jumlah harganya WAJIB tetap Rp 40.000. Tak ada
 * rupiah yang boleh lahir atau hilang hanya karena barisnya dipecah.
 *
 * Rumusnya sama persis ditulis di EMPAT tempat sebelum berkas ini ada: dua kali
 * di `/tahap` (jalur qty-lebih dan jalur split), sekali di `/penerimaan` (terima
 * sebagian), dan sekali lagi di layar Tahap — yang komentarnya bahkan mengakui
 * "rumusnya sama dengan yang dipakai server saat menulis baris". Salinan yang
 * sudah diberi catatan begitu adalah salinan yang menunggu bergeser: yang
 * mengubah satu tempat tak punya cara tahu ada tiga tempat lain.
 *
 * Dan bila ia bergeser, gejalanya bukan galat melainkan ANGKA. Layar menjanjikan
 * dana Rp 15.000, server menulis Rp 15.001, dan yang membacanya menyimpulkan
 * salah satunya berbohong tanpa bisa menebak yang mana.
 */

/** Toleransi banding qty — qty boleh pecahan (gram, liter) hasil konversi. */
const EPS = 1e-9;

/**
 * Harga untuk `qtyBagian` dari sebuah baris ber-`qtyBaris` seharga `totalHarga`.
 *
 * Dibulatkan ke rupiah utuh: kolom harga di sistem ini bilangan bulat, dan
 * setengah rupiah tak bisa dibayarkan siapa pun.
 *
 * `qtyBaris` nol memulangkan 0, bukan NaN. Baris ber-qty nol seharusnya tak ada
 * (skema menuntut qty positif), tapi NaN yang lolos ke kolom harga tak menolak
 * dirinya sendiri — ia tersimpan, lalu menular ke tiap penjumlahan yang
 * menyentuhnya, dan laporan yang seluruh angkanya NaN tak menyebut sebabnya.
 */
export function hargaBagian(totalHarga: number, qtyBagian: number, qtyBaris: number): number {
  if (!(qtyBaris > 0)) return 0;
  return Math.round((totalHarga * qtyBagian) / qtyBaris);
}

/**
 * Pecah harga satu baris jadi BAGIAN yang maju dan SISA yang tertinggal.
 *
 * Sisanya dihitung dengan PENGURANGAN, bukan dengan pembulatan kedua. Dua kali
 * pembulatan bisa menjumlah jadi satu rupiah lebih atau kurang dari harga
 * asalnya — mis. 10.000 dibagi 3: dua pembulatan menghasilkan 3.333 + 6.667 yang
 * kebetulan pas, tapi 10.000 dibagi 6 pada qty 1 menghasilkan 1.667 + 8.333 =
 * 10.000 di satu sisi dan bisa meleset di sisi lain tergantung angkanya.
 * Pengurangan membuat jumlahnya SELALU tepat, apa pun angkanya.
 *
 * `totalHarga` null (baris tanpa harga — mis. produksi yang belum dinilai) tetap
 * null di kedua sisi; menebak nol di sini akan memunculkan baris berharga Rp 0
 * yang tampak sah di buku belanja.
 */
export function pisahHarga(
  totalHarga: number | null,
  qtyBagian: number,
  qtyBaris: number,
): { bagian: number | null; sisa: number | null } {
  if (totalHarga == null) return { bagian: null, sisa: null };
  const bagian = hargaBagian(totalHarga, qtyBagian, qtyBaris);
  return { bagian, sisa: totalHarga - bagian };
}

/**
 * Apakah `qtyDiminta` mencakup SELURUH baris (jadi barisnya maju utuh, tanpa
 * split)? Dibandingkan dengan toleransi karena qty boleh pecahan: 0.1+0.2 di
 * floating point tidak persis 0.3, dan baris yang seharusnya maju utuh akan
 * ter-split jadi baris sisa berukuran 4e-17 yang tak bisa dihabiskan siapa pun.
 */
export function majuPenuh(qtyDiminta: number, qtyBaris: number): boolean {
  return qtyDiminta >= qtyBaris - EPS;
}

/**
 * Apakah `qtyDiminta` LEBIH dari rencana (mis. RAB 900 gr, belanjanya dapat
 * kemasan 1.000 gr)? Toleransi yang sama, arah sebaliknya — tanpa itu selisih
 * floating point sebesar 1e-17 akan dianggap "lebih" lalu memicu penskalaan
 * harga yang tak seorang pun minta.
 */
export function qtyMelebihi(qtyDiminta: number, qtyBaris: number): boolean {
  return qtyDiminta > qtyBaris + EPS;
}
