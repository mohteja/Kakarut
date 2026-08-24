/**
 * LANGIT-LANGIT ANGKA MASUKAN — DITURUNKAN DARI KOLOMNYA, BUKAN DIKARANG.
 *
 * `z.number()` menerima apa pun sampai `Number.MAX_VALUE` (1,8e308). Kolom yang
 * menampungnya tidak: `numeric(p, s)` hanya memuat `p − s` digit di depan koma.
 * Nilai di atasnya bukan disimpan salah — ia **ditolak Postgres**, dan
 * penolakan itu tiba sebagai galat tak tertangani.
 *
 * TERUKUR lewat HTTP terhadap server sungguhan:
 *
 *   PUT  /menu/:id      mult = 9.999          → 200
 *   PUT  /menu/:id      mult = 10.000         → **HTTP 500** (`numeric(7,3)`)
 *   POST /bahan         harga_beli = 1e12     → **HTTP 500** (`numeric(14,2)`)
 *   POST /penjualan     qty = 1e8             → **HTTP 500** (`numeric(10,2)`)
 *   POST /penjualan     uang_diterima = 1e15  → **HTTP 500**
 *
 * Dan yang lebih sunyi daripada 500: apa yang LOLOS. `qty = 10.000.000` dibalas
 * **201**, tersimpan, lalu ikut setiap SUM — omzet hari itu terbaca
 * **Rp 11.003.936.250** dari satu ketikan. Tak ada galat, tak ada peringatan;
 * yang salah cuma angkanya, di layar tempat orang menilai warungnya.
 *
 * KENAPA ANGKANYA PERSIS SEGINI. Tiap batas di bawah adalah nilai terbesar yang
 * MASIH MUAT di kolomnya. Bukan tebakan bisnis ("harga wajar paling Rp sekian")
 * — batas bisnis akan salah untuk warung yang tak kubayangkan, dan penjaga yang
 * menolak data sah lebih merusak daripada bug yang dijaganya. Yang ditegakkan
 * di sini cuma satu hal yang pasti: **nilai yang mustahil disimpan tak boleh
 * diterima**, dan penolakannya 400 dengan sebutan medannya, bukan 500.
 *
 * Batas yang sudah ada sebelumnya memakai `1_000_000_000_000` — satu lebih
 * BESAR dari yang muat di `numeric(14,2)`. Terukur: `harga_per_unit` = 1e12
 * lolos Zod lalu jatuh 500 di Postgres; 1e12 + 1 ditolak 400. Jadi pintu yang
 * "sudah dijaga" pun masih meloloskan tepat satu nilai yang meledak.
 */

/** `numeric(14,2)` — sales.total/subtotal/diskon/pb1/uang_diterima, productions.total_harga, supply_mutations.total_harga, shifts.modal_awal/uang_fisik, ingredients.harga_beli, supplies.harga_beli */
export const BATAS_UANG = 999_999_999_999;

/** `numeric(12,2)` — menus.harga_jual, sale_items.harga_satuan */
export const BATAS_HARGA = 9_999_999_999;

/** `numeric(10,2)` — sale_items.qty, open_bill_items.qty */
export const BATAS_QTY_BARIS = 99_999_999;

/** `numeric(16,6)` / `numeric(16,3)` — productions.qty, supply_mutations.qty, stok minimum */
export const BATAS_QTY_STOK = 9_999_999_999;

/** `numeric(7,3)` — menus.mult, menus.base_mult */
export const BATAS_FAKTOR = 9_999;

/** `numeric(12,4)` — ingredients.isi (isi per kemasan) */
export const BATAS_ISI = 99_999_999;

/**
 * `numeric(12,4)` — menu_components.qty, ingredient_components.qty (takaran resep)
 *
 * ANGKANYA SAMA DENGAN `BATAS_ISI`, DAN SENGAJA TIDAK DIGABUNG. Keduanya
 * kebetulan `numeric(12,4)` hari ini; yang satu isi per kemasan, yang satu
 * takaran resep. Menyatukannya berarti presisi salah satu kolom yang berubah
 * ikut menyeret kolom yang tak ada hubungannya — persis bentuk yang membuat
 * berkas ini ada.
 *
 * TERUKUR, sebelum konstanta ini ada: kedua pintu resep memakai
 * `BATAS_QTY_STOK` (9.999.999.999 — batas `numeric(16,6)`), **seratus kali
 * lebih besar dari kolomnya**:
 *
 *   POST /menu           komponen[].qty = 99.999.999   → 201
 *   POST /menu           komponen[].qty = 100.000.000  → **HTTP 500**
 *   PUT  /bahan/:id/resep  komponen[].qty = 99.999.999   → 200
 *   PUT  /bahan/:id/resep  komponen[].qty = 100.000.000  → **HTTP 500**
 *
 * Sembilan setengah miliar nilai lolos gerbang yang kelihatannya sudah
 * menjaga, lalu meledak di Postgres.
 */
export const BATAS_QTY_RESEP = 99_999_999;

/** kolom `integer` — sort_order, urutan tampil. Batasnya int32, bukan numeric. */
export const BATAS_URUTAN = 1_000_000;
