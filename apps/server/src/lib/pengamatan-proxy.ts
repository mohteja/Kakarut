/**
 * APA YANG SEBENARNYA SAMPAI KE APLIKASI INI.
 *
 * `TRUST_PROXY_HOPS` adalah janji tentang bentuk penyebaran — "ada satu proxy
 * di depanku". Janji itu tak pernah diperiksa terhadap kenyataan, dan salah di
 * kedua arahnya menghasilkan kegagalan yang sunyi:
 *
 *   hops = 0, padahal ADA proxy → `ipKlien` memulangkan alamat proxy untuk
 *     SEMUA orang. Seluruh pengguna berbagi satu ember rate-limit: satu orang
 *     yang salah password berkali-kali mengunci login untuk semua kasir,
 *     tengah jam ramai, tanpa satu pun pesan yang menjelaskan kenapa.
 *
 *   hops > 0, padahal TAK ADA proxy → `X-Forwarded-For` yang dikirim KLIEN
 *     panjangnya sudah memenuhi `hops`, jadi ia dipercaya. Klien menyebutkan
 *     alamatnya sendiri, dan rate-limit login bisa dilewati dengan mengganti
 *     satu header — persis lubang yang ditutup PR #174, kembali lewat setelan.
 *
 * Tak ada cara mengetahui yang mana dari dalam berkas konfigurasi. Yang bisa
 * dilakukan cuma satu: MENGHITUNG apa yang benar-benar datang.
 *
 * Cacahnya sengaja di memori, bukan di database — ini pengamatan tentang
 * proses INI (satu instance bisa saja berada di belakang proxy sementara yang
 * lain tidak), dan menulis satu baris per permintaan HTTP jelas tak sepadan.
 */

let total = 0;
let denganXff = 0;
let rantaiTerpanjang = 0;
let rantaiTerpendek = 0;

export interface PengamatanProxy {
  /** permintaan yang tercacah (tanpa health check) */
  total: number;
  /** di antaranya, yang membawa header `X-Forwarded-For` */
  dengan_xff: number;
  /** entri terbanyak yang pernah terlihat dalam satu rantai XFF */
  rantai_terpanjang: number;
  /**
   * Entri TERSEDIKIT yang pernah terlihat dalam satu rantai XFF (0 = belum
   * ada satu pun rantai yang teramati).
   *
   * INI, BUKAN YANG TERPANJANG, yang boleh dipakai menyarankan `hops` — dan
   * bedanya soal keamanan, bukan selera. Klien bisa mengirim
   * `X-Forwarded-For` versinya sendiri; proxy di depan MENAMBAHKAN entri, tak
   * menggantinya. Jadi rantai bisa DIPANJANGKAN oleh siapa pun yang meminta,
   * dan menyarankan `hops` dari maksimum berarti seorang penyerang bisa
   * membuat panel menyuruh pemiliknya menyetel angka yang justru membuat
   * `ipKlien` memulangkan entri karangannya — persis lubang yang ditulis di
   * kepala berkas ini.
   *
   * Yang tak bisa dipendekkan dari luar: jumlah proxy yang benar-benar ada.
   * Tiap permintaan sah melewati semuanya, jadi minimum atas banyak permintaan
   * ADALAH jumlah itu. Dan bila minimumnya kelewat rendah karena sebab lain,
   * akibatnya cuma kembali ke keadaan hari ini (alamat proxy yang tercatat) —
   * arah kekeliruan yang aman.
   */
  rantai_terpendek: number;
}

/** Catat satu permintaan. Dipanggil dari middleware paling luar. */
export function amatiProxy(xff: string | null | undefined): void {
  total++;
  if (!xff) return;
  denganXff++;
  const n = xff.split(",").filter((s) => s.trim().length > 0).length;
  if (n > rantaiTerpanjang) rantaiTerpanjang = n;
  if (rantaiTerpendek === 0 || n < rantaiTerpendek) rantaiTerpendek = n;
}

export function pengamatanProxy(): PengamatanProxy {
  return {
    total,
    dengan_xff: denganXff,
    rantai_terpanjang: rantaiTerpanjang,
    rantai_terpendek: rantaiTerpendek,
  };
}

/** Hanya untuk uji — kembalikan cacahnya ke nol. */
export function resetPengamatanProxy(): void {
  total = 0;
  denganXff = 0;
  rantaiTerpanjang = 0;
  rantaiTerpendek = 0;
}
