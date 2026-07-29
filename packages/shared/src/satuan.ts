/**
 * Penulisan KUANTITAS baris kiriman — satu sumber kebenaran untuk web DAN
 * mobile.
 *
 * Latar belakangnya bug nyata: pada faktur yang sama web menulis "Sayur 900 gr"
 * sementara mobile menulis "Sayur 900 kg" (beda 1000×) dan "Mie basah 2000
 * batch". Angkanya benar, LABELNYA yang salah — mobile memasangkan `qty` dengan
 * `satuan_beli`, atau dengan kata "batch" saat `is_batch` true.
 *
 * Aturannya cuma satu, dan berlaku di seluruh sistem:
 *
 *   `qty` SELALU dinyatakan dalam `satuan` (satuan kerja/resep).
 *
 * Saat baris dibuat server sudah mengonversi input ke satuan kerja
 * (`qty = mode === "batch" ? jumlah * isi : jumlah`), jadi `qty` tidak pernah
 * lagi berada dalam satuan kemasan — sekalipun `is_batch` true. `is_batch` itu
 * catatan CARA INPUT, bukan satuan.
 *
 * Karena mobile ditulis dalam Flutter (tak bisa mengimpor paket ini), server
 * ikut MENGIRIM hasil `qtyTeks()` pada baris kiriman. Dengan begitu tak ada
 * lagi yang perlu ditebak klien — dan web memakai fungsi yang sama supaya
 * keduanya tak mungkin berbeda.
 */

/** Angka gaya Indonesia: 2000 → "2.000", 0.9 → "0,9". Maksimum 2 desimal. */
export function formatAngkaId(n: number, maxDecimals = 2): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxDecimals }).format(n);
}

export interface QtyTeks {
  /** teks utama yang WAJIB ditampilkan, mis. "900 gr" — selalu satuan kerja */
  teks: string;
  /**
   * setara dalam kemasan beli, mis. "≈ 0,9 kg" — null bila bahan tak punya
   * kemasan (`isi ≤ 1`) atau `satuan_beli` kosong. Sifatnya PELENGKAP: boleh
   * ditampilkan kecil di samping `teks`, tak boleh menggantikannya.
   */
  setara: string | null;
}

/**
 * Tulis satu kuantitas baris kiriman.
 *
 * `qty` diperlakukan sebagai satuan kerja tanpa syarat — parameter `isi` dan
 * `satuanBeli` HANYA dipakai untuk menghitung teks setara, tak pernah untuk
 * mengganti satuan teks utama. Itu yang membuat "900 kg" mustahil terjadi.
 */
export function qtyTeks(params: {
  qty: number;
  /** satuan kerja/resep (mis. "gr") — label satu-satunya untuk `qty` */
  satuan: string;
  /** isi per kemasan dalam `satuan`; ≤ 1 = bahan tanpa kemasan */
  isi?: number | null;
  /** satuan kemasan (mis. "kg"); null = tak diatur */
  satuanBeli?: string | null;
}): QtyTeks {
  const { qty, satuan, isi, satuanBeli } = params;
  const teks = `${formatAngkaId(qty)} ${satuan}`.trim();
  if (!satuanBeli || isi == null || isi <= 1) return { teks, setara: null };
  const kemasan = qty / isi;
  // Pas satu kemasan atau lebih tanpa sisa → tanpa "≈", angkanya memang persis.
  const pas = Math.abs(kemasan - Math.round(kemasan)) < 1e-6;
  return {
    teks,
    setara: `${pas ? "" : "≈ "}${formatAngkaId(kemasan)} ${satuanBeli}`,
  };
}

export interface BatchTeks {
  /** berapa kali resep dijalankan; null bila baris ini bukan produksi ber-batch */
  batch: number | null;
  /** mis. "3 batch × 700 ml"; null saat `batch` null */
  teks: string | null;
}

/**
 * Berapa BATCH resep yang harus dikerjakan untuk sebuah baris produksi.
 *
 * `qty` disimpan dalam satuan kerja ("2.100 ml"), tapi yang dikerjakan orang
 * di dapur adalah **mengulang resep sekian kali** — dan satu resep menghasilkan
 * `isi` satuan kerja (lihat `ingredient_components.qty` = "kebutuhan per 1
 * batch"). Tanpa angka ini pelaksana harus membagi sendiri di kepala setiap
 * kali membuka faktur, dan salah bagi = salah masak.
 *
 * Ukuran batch diambil dari master bahan SAAT INI. Itu aman untuk baris yang
 * sedang berjalan: mengubah `isi` ditolak selama masih ada produksi berjalan
 * (lihat guard di modul bahan). Baris yang sudah lama selesai bisa saja
 * memakai ukuran batch yang berbeda dari saat ia dikerjakan — jumlah `qty`-nya
 * tetap fakta, hanya pembagian batch-nya yang mengikuti master terbaru.
 */
export function batchTeks(params: {
  qty: number;
  /** satuan kerja/resep (mis. "ml") */
  satuan: string;
  /** hasil 1 batch resep dalam `satuan`; ≤ 1 = tak ada pengelompokan batch */
  isi?: number | null;
  /** hanya bahan "produksi" yang punya batch; "beli" tidak */
  pengadaan?: string | null;
}): BatchTeks {
  const { qty, satuan, isi, pengadaan } = params;
  if (pengadaan !== "produksi" || isi == null || isi <= 1) return { batch: null, teks: null };
  const batch = qty / isi;
  const pas = Math.abs(batch - Math.round(batch)) < 1e-6;
  return {
    batch,
    teks: `${pas ? "" : "≈ "}${formatAngkaId(batch)} batch × ${formatAngkaId(isi)} ${satuan}`.trim(),
  };
}
