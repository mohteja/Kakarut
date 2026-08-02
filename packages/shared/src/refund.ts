/**
 * REFUND SEBAGIAN PER SAJIAN — aritmetika uangnya.
 *
 * Kasus nyatanya satu: pembeli sudah membayar, lalu ketahuan bahan salah satu
 * sajian habis sehingga sajian itu tak jadi dibuat. Uang untuk sajian itu — dan
 * HANYA sajian itu — dikembalikan.
 *
 * Ditaruh di `shared` dan bebas basis data supaya bisa diuji sendiri: ini satu-
 * satunya tempat yang memutuskan berapa rupiah berpindah tangan, dan salahnya
 * tak akan terlihat sampai ada yang menghitung ulang struk.
 *
 * ATURAN: PROPORSIONAL.
 *
 * Diskon dan PB1 melekat pada transaksi, bukan pada baris. Kalau keduanya
 * dibiarkan utuh saat sebagian sajian dikembalikan, pembeli menerima kembali
 * lebih sedikit dari yang benar-benar ia bayarkan untuk sajian itu — ia sudah
 * "memakai" diskonnya untuk barang yang tak pernah datang. Jadi keduanya ikut
 * menyusut sebanding porsi yang dikembalikan, dan yang diterima pembeli persis
 * sama dengan yang ia bayar untuk porsi itu.
 *
 * Ini juga membuat operasinya IDEMPOTEN dan bisa bertahap: `qtyRefund` selalu
 * KUMULATIF (total yang sudah dikembalikan untuk baris itu), jadi refund kedua
 * pada baris yang sama dihitung dari nol lagi, bukan ditumpuk.
 */

/** Satu baris penjualan, dengan qty yang sudah dikembalikan (kumulatif). */
export interface BarisRefund {
  hargaSatuan: number;
  qty: number;
  /** total porsi yang dikembalikan untuk baris ini — 0 = utuh */
  qtyRefund: number;
}

/** Angka uang sebuah penjualan. */
export interface UangPenjualan {
  subtotal: number;
  diskon: number;
  pb1: number;
  total: number;
}

/**
 * Porsi yang benar-benar jadi ditagih pada satu baris.
 *
 * Parameternya sengaja lebih longgar dari `BarisRefund`: harga tak dipakai di
 * sini, dan pemanggil seperti hitung-ulang HPP hanya membaca qty — memaksanya
 * ikut memilih kolom harga hanya untuk memuaskan tipe akan membuat query
 * mengambil data yang tak dipakainya.
 */
export function qtyDitagih(b: { qty: number; qtyRefund: number }): number {
  const sisa = b.qty - b.qtyRefund;
  return sisa > 0 ? sisa : 0;
}

/**
 * Hitung ulang angka uang penjualan dari porsi yang TERSISA.
 *
 * `asal` adalah angka penjualan APA ADANYA saat dibuat (sebelum refund apa
 * pun) — bukan angka hasil refund sebelumnya. Menyimpan titik tolak yang tetap
 * inilah yang membuat refund bertahap tidak menggerus diskon dua kali.
 */
export function hitungUangSetelahRefund(
  baris: BarisRefund[],
  asal: { subtotal: number; diskon: number; pb1: number },
): UangPenjualan {
  const subtotal = baris.reduce((a, b) => a + b.hargaSatuan * qtyDitagih(b), 0);

  // Penjualan kosong / seluruh sajian dikembalikan → tak ada apa pun tersisa.
  // Dijaga eksplisit supaya pembagian di bawah tak pernah menyentuh nol.
  if (asal.subtotal <= 0 || subtotal <= 0) {
    return { subtotal: 0, diskon: 0, pb1: 0, total: 0 };
  }

  // Diskon menyusut sebanding, lalu dijaga tak melebihi subtotal barunya —
  // total tak boleh negatif walau pembulatan meleset.
  const rasio = subtotal / asal.subtotal;
  const diskon = Math.min(subtotal, Math.round(asal.diskon * rasio));

  const net = subtotal - diskon;
  const netAsal = asal.subtotal - asal.diskon;
  // PB1 dihitung atas nilai net, jadi ia menyusut sebanding NET, bukan
  // subtotal. Diturunkan dari PB1 asal (bukan dari tarif perusahaan hari ini):
  // tarif bisa sudah berubah sejak transaksi terjadi, dan yang dikembalikan
  // harus mengikuti yang DULU dibayar.
  const pb1 = asal.pb1 > 0 && netAsal > 0 ? Math.round((asal.pb1 * net) / netAsal) : 0;

  return { subtotal, diskon, pb1, total: net + pb1 };
}

/**
 * Uang yang harus dikembalikan ke pembeli = selisih total sebelum & sesudah.
 *
 * Dihitung dari total, bukan dari `hargaSatuan × qty`, supaya bagian diskon &
 * PB1 milik porsi itu ikut kembali.
 */
export function nominalRefund(sebelum: UangPenjualan, sesudah: UangPenjualan): number {
  const selisih = sebelum.total - sesudah.total;
  return selisih > 0 ? selisih : 0;
}
