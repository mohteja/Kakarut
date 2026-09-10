import type {
  BahanDto,
  BahanDtoPenuh,
  CompanyRow,
  KartuPerlengkapanDto,
  MenuDto,
  MenuDtoPenuh,
  PerlengkapanRowDto,
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

/**
 * Medan `CompanyRow` yang HANYA untuk manajemen — angka perencanaan usaha,
 * bukan angka yang dipakai melayani tamu.
 *
 * Terukur 2026-09-11 dengan token kasir sungguhan: `GET /company` memulangkan
 * KEDUA PULUH DUA kuncinya utuh ke tiap peran — `targetPenjualan` 15.000.000,
 * `foodCostMaks` 40, `metodeHpp`, `planExpiresAt` — di layar yang paling
 * sering terbuka di tablet bersama.
 *
 * Kenapa penjaga biaya yang sudah ada tak melihatnya: populasinya digambar
 * SEKALI, mengelilingi harga pokok (`MEDAN_BIAYA_MENU`/`_BAHAN`), dan tak
 * pernah diukur ulang. Bentuk kelalaian yang sama dengan ATURAN A yang
 * melapor nol sementara dua baris tabel telanjang berjalan di kawat.
 *
 * KEEMPATNYA DIPILIH DARI PEMBACANYA, bukan dari firasat — disapu di web dan
 * ponsel:
 *
 *   · `targetPenjualan` — NOL pembaca di kedua klien. Servernya membaca
 *     kolomnya langsung (`rekomendasi/routes.ts`); web cuma MENULISnya lewat
 *     PATCH.
 *   · `planExpiresAt` — NOL pembaca di kedua klien.
 *   · `foodCostMaks` — web: `PerusahaanPage` + `MenuListPage`, keduanya
 *     digerbangi `isManajemen`. Ponsel membaca `food_cost_maks` (snake) dari
 *     rute LAIN, bukan yang ini.
 *   · `metodeHpp` — web: `PerusahaanPage` saja. Ponsel membaca `metode_hpp`
 *     (snake) dari `/stok/fifo/:id`.
 *
 * Yang TIDAK disentuh, dan sebabnya: `pb1Rate`/`pb1Enabled`/`receiptFooter`/
 * `receiptShowAlamat`/`logoUrl`/`alamat`/`telepon`/`nama` dipakai KASIR untuk
 * mencetak struk — `kasir_models.dart` mengurai persis kedelapan itu.
 * `plan`/`mode`/`isActive` menggerbangi fitur di seluruh layar.
 */
export const MEDAN_MANAJEMEN_COMPANY = [
  "targetPenjualan",
  "foodCostMaks",
  "metodeHpp",
  "planExpiresAt",
] as const;

/**
 * Perusahaan tanpa angka perencanaan usaha.
 *
 * `null`, bukan kunci yang dicabut: bentuknya tetap `CompanyRow` utuh, jadi
 * tak satu klien pun patah dan kontraknya tak berubah — persis alasan yang
 * sama dengan `tanpaBiayaMenu` di atas. Yang berubah cuma isinya.
 */
export function tanpaAngkaManajemenCompany(c: CompanyRow): CompanyRow {
  return {
    ...c,
    targetPenjualan: null,
    foodCostMaks: null,
    metodeHpp: null,
    planExpiresAt: null,
  };
}

/** Bahan tanpa harga beli. Takaran, satuan, dan saldo tetap utuh. */
export function tanpaBiayaBahan(dto: BahanDtoPenuh): BahanDto {
  return { ...dto, harga_beli: null, harga_per_unit: null };
}

/**
 * Baris perlengkapan tanpa harga beli — untuk `GET /perlengkapan`.
 *
 * Terukur 2026-09-11 dengan sapuan KEBIJAKAN dari kawat (§313): dari 57 rute
 * yang boleh diketuk kasir, DUA memulangkan medan yang namanya sudah ada di
 * `MEDAN_*` — `harga_beli` di sini, dan `harga_per_unit` di `GET /stok` yang
 * memang utang bersyarat bertanggal. Yang ini tak tercatat di mana pun.
 *
 * Kelalaian yang sama dengan `/company` sehari sebelumnya, satu lapis lebih
 * dekat: modul ini SUDAH punya penyaingnya (`tanpaBiayaKartuPerlengkapan`,
 * dipasang di `/perlengkapan/:id/kartu`) — yang terlewat rute daftarnya
 * sendiri, tetangga sebelahnya.
 */
export function tanpaBiayaPerlengkapan(r: PerlengkapanRowDto): PerlengkapanRowDto {
  return { ...r, harga_beli: null };
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
