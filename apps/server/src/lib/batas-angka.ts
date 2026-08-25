import { HTTPException } from "hono/http-exception";
import { formatAngkaId } from "@kakarut/shared";

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

/**
 * `numeric(16,4)` — sales.total_hpp, sale_items.hpp_satuan
 *
 * TAK ADA MEDAN PERMINTAAN YANG MENGISINYA. HPP lahir dari resep × qty ×
 * harga bahan, jadi tak ada `.max()` di mana pun yang bisa menjaganya — batas
 * ini dipakai `pastikanMuat` di tempat angkanya dihitung.
 */
export const BATAS_HPP = 999_999_999_999;

/** kolom `integer` — sort_order, urutan tampil. Batasnya int32, bukan numeric. */
export const BATAS_URUTAN = 1_000_000;

/**
 * ANGKA YANG LAHIR DI SERVER — di sini `.max()` tak bisa menolong siapa pun.
 *
 * Tiga puluh dua dari 62 kolom `numeric` di skema ini TIDAK diisi medan
 * permintaan: ia hasil perkalian, penjumlahan, atau selisih. Batas masukan yang
 * sempurna pun tak menjaganya, karena yang meluap bukan masukannya melainkan
 * hasilnya. TERUKUR lewat HTTP terhadap Postgres sungguhan:
 *
 *   POST /penjualan  menu Rp 10.000 × qty 99.999.999   → 201
 *   POST /penjualan  menu Rp 20.000 × qty 99.999.999   → **HTTP 500**
 *   POST /penjualan  TIGA baris yang masing-masing MUAT → **HTTP 500**
 *
 * Baris ketiga itu intinya: tiap medan sah, tiap baris muat di kolomnya, dan
 * penjualannya tetap jatuh 500. Tak ada `z.number().max()` yang bisa
 * mencegahnya — hanya penjaga di tempat angkanya lahir.
 *
 * KENAPA MENYEBUT MEDANNYA. Terjemahan terpusat di `app.onError` membuat
 * balasannya sopan (400 "Angkanya terlalu besar untuk disimpan") tapi ia tak
 * pernah tahu angka YANG MANA. Kasir yang berdiri di depan tamu perlu tahu
 * baris mana yang harus diperbaiki, bukan bahwa "ada angka yang kebesaran".
 */
export function pastikanMuat(nilai: number, batas: number, medan: string): void {
  if (Number.isFinite(nilai) && Math.abs(nilai) <= batas) return;
  throw new HTTPException(400, {
    message: `${medan} terlalu besar untuk disimpan (maksimal ${formatAngkaId(batas)})`,
  });
}

/**
 * Skala desimal kolom qty perlengkapan (`supply_mutations.qty`,
 * `supply_transfers.qty` — keduanya `numeric(16,3)` di skema).
 */
export const SKALA_QTY_PERLENGKAPAN = 3;

/**
 * Kembalikan angka ke PRESISI KOLOMNYA sesudah disusun di JS.
 *
 * Postgres menjumlahkan `numeric` secara EKSAK, jadi satu `SUM(...)::float8`
 * hanya dibulatkan sekali dan tetap sepadan dengan nilai yang dikirim klien —
 * itu sebabnya membandingkan permintaan klien dengan SATU saldo hasil SUM
 * memang tak butuh toleransi. Yang tidak sepadan: saldo yang DISUSUN DI JS
 * dari beberapa nilai float8 yang masing-masing sudah dibulatkan sendiri.
 *
 * Terukur (2026-08-25, lewat HTTP): saldo rak perlengkapan =
 * `SUM(mutasi)::float8 − SUM(dalam_jalan)::float8`. Dengan mutasi 0,3 dan
 * kiriman menunggu 0,1, hasil kurangnya **0.19999999999999998**, dan dua
 * gerbang menolak permintaan sebesar sisa yang persis itu:
 *
 *   POST /perlengkapan/:id/pakai  qty 0,2 → 400
 *     "Stok tidak cukup (saldo 0.19999999999999998 pak)"
 *   POST /perlengkapan/:id/minta  qty 0,2 → 400
 *     "Stok CK tidak cukup (siap kirim 0.19999999999999998 …)"
 *
 * Petugas TIDAK BISA menghabiskan sisa yang ada, dan angka di pesannya sama
 * dengan yang ia minta — jadi dari layar penolakannya tak masuk akal.
 *
 * Membulatkan ke skala kolom BUKAN toleransi yang dikarang: qty perlengkapan
 * memang `numeric(16,3)`, jadi tiga desimal adalah seluruh presisi yang
 * pernah ada di data ini. Derau di digit ke-17 bukan informasi yang hilang.
 *
 * Ini BUKAN pengganti toleransi di pintu lain: `stok`/`produksi` memakai
 * `1e-9`/`1e-6` karena yang mereka bandingkan adalah KEBUTUHAN yang dihitung
 * JS (resep × batch, konversi satuan) — kelas yang berbeda, dan tetap benar.
 */
export {
  keSkalaKolom,
  SKALA_QTY_STOK_KOLOM,
  SKALA_UANG_KOLOM,
  SKALA_HPP_KOLOM,
  SKALA_QTY_BARIS_KOLOM,
} from "@kakarut/shared";

/**
 * Toleransi pembanding untuk angka yang DIHITUNG DI JS lalu diadu dengan
 * saldo — diturunkan, bukan dirasa.
 *
 * Tiga pintu memakai angka firasat (`1e-9` dua kali, `1e-6` sekali) tanpa
 * satu pengukuran di baliknya, sementara `EPS_KAS = 0.005` di jalur kas
 * sudah benar dan MENULIS asalnya: "pembulatan numeric(…,2)" — setengah unit
 * terkecil kolomnya. Pembantu ini memakai aturan yang sama, ditambah satu
 * suku yang diperlukan pengukuran:
 *
 *   toleransi = max( ½ unit skala kolom , lantai derau float pada besaran itu )
 *
 * KENAPA SUKU KEDUA. Toleransi MUTLAK berhenti berarti begitu besarannya
 * naik: ULP double pada 10⁷ sudah 1,86e-9 — LEBIH BESAR dari `1e-9`. Terukur
 * lewat HTTP (2026-08-25) pada gerbang `bahanKurang`: kebutuhan ditumpuk di
 * JS lintas 500 baris penjualan (0,01 × 49.157 per baris) menghasilkan
 * 245.785,00000000253 sementara saldonya persis 245.785 — dan penjualannya
 * DITOLAK dengan kalimat yang menelanjangi dirinya sendiri:
 *
 *   "Stok tidak cukup: Bumbu B7 (sisa 245.785 gr, butuh 245.785)"
 *
 * Angka yang dicetak sama persis, transaksinya tetap ditolak. 187 pasangan
 * (takaran, qty, baris) yang melampaui `1e-9` ditemukan pada sapuan
 * aritmetika; yang terukur di atas satu di antaranya.
 *
 * KENAPA TAK MENELAN KEKURANGAN NYATA. Suku pertama setengah unit terkecil
 * kolom, jadi kekurangan sekecil apa pun yang KOLOMNYA sanggup wakili
 * (1 unit = 10⁻⁶ untuk qty stok) tetap tertangkap. Suku kedua hanya
 * mengambil alih pada besaran di mana double sendiri sudah tak sanggup
 * membedakan sebesar itu — di sana "kekurangan" yang lebih halus dari ULP
 * bukan kekurangan, ia derau.
 */
export function toleransiBanding(nilai: number, skala: number): number {
  const setengahUnit = 0.5 * 10 ** -skala;
  // 2⁻⁵² = jarak relatif antar-double; ×1024 memberi ruang untuk akumulasi
  // JS lintas baris (badan penjualan mengizinkan 500 baris).
  const lantaiDerau = Math.abs(nilai) * 2 ** -52 * 1024;
  return Math.max(setengahUnit, lantaiDerau);
}
