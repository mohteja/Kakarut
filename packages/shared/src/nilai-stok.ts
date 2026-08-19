/**
 * NILAI RUPIAH DARI STOK YANG ADA DI RAK.
 *
 * Daftar Stok menampilkan puluhan baris qty tanpa satu pun angka rupiah, jadi
 * pertanyaan "modal saya yang mengendap di gudang berapa?" cuma bisa dijawab
 * dengan mengalikan sendiri baris demi baris. Ringkasan ini menjawabnya.
 *
 * Yang membuatnya tidak sesederhana Σ(saldo × harga) ada tiga, dan ketiganya
 * SUDAH ADA di data hari ini — bukan kemungkinan teoretis:
 *
 *   1. SALDO MINUS. Layar stok yang memicu permintaan ini penuh saldo minus
 *      (−54, −175, …). Minus tak berarti "rak berisi minus 54"; rak fisik tak
 *      bisa berisi kurang dari nol. Ia berarti catatan KELUAR melebihi catatan
 *      MASUK — biasanya penerimaan yang tak tercatat. Barangnya justru ADA,
 *      hanya tak terbukukan.
 *
 *      Maka menjumlahkannya begitu saja (netting) mengurangi nilai barang lain
 *      yang benar-benar ada, dengan angka yang mewakili barang yang juga ada.
 *      Salah dua kali, ke arah yang sama. Nilainya karena itu dijumlahkan atas
 *      saldo POSITIF saja, dan yang minus dilaporkan TERPISAH sebagai apa
 *      adanya: catatan yang belum lengkap, bukan nilai negatif.
 *
 *   2. BAHAN TANPA HARGA. `harga_beli` boleh 0 (bahan baru yang belum pernah
 *      dibeli, hasil impor yang harganya belum diisi). Nol × qty berapa pun
 *      tetap nol, jadi bahan itu MENGHILANG dari total tanpa jejak — dan
 *      total yang kekurangan diam-diam persis jenis angka yang dipercaya
 *      orang. Jumlahnya ikut dilaporkan supaya kekurangannya kelihatan.
 *
 *   3. HARGA MANA. Yang dipakai `harga_beli / isi` — harga beli TERKINI bahan
 *      itu, bukan harga saat tiap lot masuk. Ini penilaian biaya-pengganti,
 *      bukan FIFO: bahan yang harganya naik minggu lalu membuat stok lama ikut
 *      dinilai dengan harga baru. FIFO per-lot ada di halaman Kartu FIFO, tapi
 *      ia dihitung satu bahan sekali jalan dan tak bisa dipakai meringkas
 *      seluruh daftar. Angka ini karena itu WAJIB diberi label sumbernya di
 *      layar; total rupiah tanpa keterangan dasar penilaian akan dibaca
 *      sebagai nilai buku, lalu dipakai orang untuk hal yang bukan haknya.
 */

/** Baris stok minimal yang dibutuhkan untuk menilai — subset `StokRowDto`. */
export interface BarisNilaiStok {
  saldo: number;
  harga_per_unit: number;
}

export interface NilaiStokRingkas {
  /** Σ(saldo × harga per unit) atas baris bersaldo POSITIF. */
  nilai: number;
  /** banyak bahan yang benar-benar menyumbang rupiah (saldo > 0 & berharga) */
  bahan_bernilai: number;
  /** banyak bahan bersaldo minus — catatan belum lengkap, tak ikut dinilai */
  minus_bahan: number;
  /**
   * Besarnya (POSITIF) rupiah yang akan hilang dari total seandainya saldo
   * minus ikut dijumlahkan. Dibawa supaya layar bisa menyebut ongkos dari
   * catatan yang belum beres, bukan sekadar mencacahnya.
   */
  minus_nilai: number;
  /** bahan bersaldo positif yang `harga_beli`-nya masih 0 → nilainya tak terhitung */
  tanpa_harga_bahan: number;
}

/**
 * Ringkas nilai rupiah sekumpulan baris stok.
 *
 * Baris bersaldo NOL diabaikan seluruhnya: ia tak menambah nilai, tak kurang
 * lengkap catatannya, dan mencacahnya sebagai "tanpa harga" cuma memunculkan
 * peringatan untuk bahan yang memang tak ada barangnya.
 */
export function ringkasNilaiStok(baris: BarisNilaiStok[]): NilaiStokRingkas {
  const r: NilaiStokRingkas = {
    nilai: 0,
    bahan_bernilai: 0,
    minus_bahan: 0,
    minus_nilai: 0,
    tanpa_harga_bahan: 0,
  };
  for (const b of baris) {
    const harga = Number.isFinite(b.harga_per_unit) ? b.harga_per_unit : 0;
    if (b.saldo > 0) {
      if (harga > 0) {
        r.nilai += b.saldo * harga;
        r.bahan_bernilai++;
      } else {
        r.tanpa_harga_bahan++;
      }
    } else if (b.saldo < 0) {
      r.minus_bahan++;
      r.minus_nilai += -b.saldo * harga;
    }
  }
  return r;
}
