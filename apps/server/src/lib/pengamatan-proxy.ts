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

export interface PengamatanProxy {
  /** permintaan yang tercacah (tanpa health check) */
  total: number;
  /** di antaranya, yang membawa header `X-Forwarded-For` */
  dengan_xff: number;
  /** entri terbanyak yang pernah terlihat dalam satu rantai XFF */
  rantai_terpanjang: number;
}

/** Catat satu permintaan. Dipanggil dari middleware paling luar. */
export function amatiProxy(xff: string | null | undefined): void {
  total++;
  if (!xff) return;
  denganXff++;
  const n = xff.split(",").filter((s) => s.trim().length > 0).length;
  if (n > rantaiTerpanjang) rantaiTerpanjang = n;
}

export function pengamatanProxy(): PengamatanProxy {
  return { total, dengan_xff: denganXff, rantai_terpanjang: rantaiTerpanjang };
}

/** Hanya untuk uji — kembalikan cacahnya ke nol. */
export function resetPengamatanProxy(): void {
  total = 0;
  denganXff = 0;
  rantaiTerpanjang = 0;
}
