import type {
  BahanDto,
  BahanDtoPenuh,
  KartuPerlengkapanDto,
  MenuDto,
  MenuDtoPenuh,
} from "./types";

/**
 * PENYARING BIAYA — menihilkan angka biaya dari DTO baca untuk peran yang tak
 * berhak melihatnya (`bolehLihatBiaya`, `constants.ts`).
 *
 * KENAPA `null` DAN BUKAN 0. Nol bukan "tidak tahu", ia sebuah angka — dan ia
 * tercetak di layar sebagai "Rp 0", lalu dipercaya orang. Ledger repo ini
 * sudah sekali menandai `?? 0` sebagai "bentuk diam yang sedang dijaga":
 * `fromJson` yang melewatkan kunci tak melempar apa pun dan analyzer tetap
 * hijau. `null` memaksa layarnya memilih — dan layar manajemen merendernya
 * `—`, bukan nol.
 *
 * KENAPA DI BATAS RUTE, BUKAN DI SERVICE. `toMenuDto` dipakai juga
 * `laporan/routes.ts` (analisis harga owner/admin), dan `hitungSaldoCabang`
 * dipakai opname, kartu stok, dan walk FIFO DI DALAM server. Menihilkan di
 * dalamnya bukan menjaga data — ia merusak perhitungan yang memang butuh
 * angkanya. Penyaring ini karena itu dipanggil tepat di `c.json(...)`.
 */

/** Medan biaya `MenuDto` — dipakai gerbang `biaya-hanya-manajemen.test.ts`. */
export const MEDAN_BIAYA_MENU = [
  "hpp",
  "hpp_dine_in",
  "harga_saran",
  "harga_jual_bulat",
  "food_cost_persen",
] as const;

/** Medan biaya `BahanDto`. */
export const MEDAN_BIAYA_BAHAN = ["harga_beli", "harga_per_unit"] as const;

/**
 * Menu tanpa angka biaya.
 *
 * `komponen[].harga_per_unit` ikut dinihilkan — ia harga beli bahan per
 * satuan, dan membiarkannya berarti seluruh struktur biaya resep tetap bisa
 * disusun ulang dari balasan yang katanya sudah disaring.
 *
 * Yang TIDAK disentuh: `harga_jual` (harga yang dibayar tamu, memang publik),
 * `komponen[].qty` (takaran — dapur memasaknya), dan `nama`/`kategori`.
 */
export function tanpaBiayaMenu(dto: MenuDtoPenuh): MenuDto {
  return {
    ...dto,
    hpp: null,
    hpp_dine_in: null,
    harga_saran: null,
    harga_jual_bulat: null,
    food_cost_persen: null,
    komponen: dto.komponen.map((k) => ({ ...k, harga_per_unit: null })),
  };
}

/** Bahan tanpa harga beli. Takaran, satuan, dan saldo tetap utuh. */
export function tanpaBiayaBahan(dto: BahanDtoPenuh): BahanDto {
  return { ...dto, harga_beli: null, harga_per_unit: null };
}

/**
 * Kartu perlengkapan tanpa angka belanja.
 *
 * Pintunya SENGAJA tetap terbuka: `KartuPerlengkapanModal` web dibuka dari tab
 * Stok → Perlengkapan yang dipakai semua peran untuk pakai/opname, dan
 * menutupnya akan menghentikan pekerjaan harian. Yang ditutup ANGKANYA.
 *
 * `mutasi[].total_harga` ikut dinihilkan: meringkas belanja dari daftar
 * mutasinya sendiri cuma butuh satu penjumlahan, jadi menutup totalnya saja
 * adalah pagar yang bisa dilangkahi dari balasan yang sama.
 *
 * (`GET /supplier/:id/kartu` tak butuh penyaring — putaran sebelumnya sudah
 * menutup PINTUnya ke owner/admin.)
 */
export function tanpaBiayaKartuPerlengkapan(k: KartuPerlengkapanDto): KartuPerlengkapanDto {
  return {
    ...k,
    total_belanja: null,
    mutasi: k.mutasi.map((m) => ({ ...m, total_harga: null })),
  };
}
