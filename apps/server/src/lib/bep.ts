/**
 * MARGIN KONTRIBUSI PER PORSI — SESUDAH DISKON.
 *
 * BEP menjawab satu pertanyaan: "berapa porsi harus terjual supaya biaya tetap
 * tertutup?" Jawabannya `biaya_tetap ÷ margin kontribusi per porsi`, jadi
 * seluruh ketelitiannya bertumpu pada margin itu.
 *
 * Yang dulu dipakai adalah omzet KOTOR baris nota (`harga_satuan × porsi`).
 * Diskon hidup di tingkat NOTA (`sales.diskon`) — potongan yang benar-benar
 * diberikan kasir — dan tak pernah ikut. Akibatnya margin kelihatan lebih besar
 * daripada yang benar-benar masuk, dan BEP menjawab lebih KECIL daripada yang
 * sebenarnya: layar yang tugasnya menjawab "berapa supaya tidak rugi" justru
 * yang paling optimistis. Rumah makan yang rutin memberi diskon 10% dengan
 * margin 40% melihat kebutuhan porsi meleset seperempatnya.
 *
 * Ia juga membuat dua layar berselisih atas pertanyaan yang sama:
 * `GET /laporan` sudah menghitung `estimasi_profit = omzet − diskon − HPP`,
 * sementara BEP memakai `omzet − HPP`. Rumus di sini disamakan dengan yang itu.
 *
 * PB1 sengaja TIDAK dikurangkan: ia titipan pajak yang diteruskan ke negara,
 * bukan pendapatan — dan `subtotal` memang belum memuatnya.
 */
export interface RataPerPorsi {
  /** harga jual rata-rata yang BENAR-BENAR diterima per porsi (net diskon) */
  harga: number;
  /** margin kontribusi rata-rata per porsi = (net diskon − HPP) ÷ porsi */
  margin: number;
}

/**
 * Rata-rata per porsi dari agregat satu periode.
 *
 * `subtotal`/`diskon`/`hpp` diambil dari tingkat NOTA dan `qty` dari tingkat
 * BARIS; ketiganya sudah menyusut sendiri saat refund (`hitungUangSetelahRefund`
 * dan `hitungUlangBiayaPenjualan`), jadi pembilang dan penyebutnya sama-sama
 * "yang benar-benar ditagih".
 *
 * `null` bila tak ada porsi terjual — pemanggil yang memutuskan memakai basis
 * katalog. Nol porsi BUKAN margin nol; membaginya menghasilkan Infinity/NaN.
 */
export function rataPerPorsi(p: {
  subtotal: number;
  diskon: number;
  hpp: number;
  qty: number;
}): RataPerPorsi | null {
  if (!(p.qty > 0)) return null;
  const bersih = p.subtotal - p.diskon;
  return { harga: bersih / p.qty, margin: (bersih - p.hpp) / p.qty };
}
