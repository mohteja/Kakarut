/**
 * MEMINDAHKAN BARANG ANTAR CABANG — satu-satunya cara yang sah.
 *
 * Sebuah baris `productions` membawa DUA keterangan cabang yang harus dibaca
 * bersama, seperti dua tulisan di kardus kiriman:
 *
 * - `branch_id`        — "barang ini SEKARANG ADA DI MANA"
 * - `tujuan_branch_id` — "barang ini ALAMATNYA KE MANA"
 *
 * Layar Penerimaan cabang hanya menampilkan kardus yang KEDUA tulisan itu SAMA
 * (lihat `penerimaan/gerbang.ts`) — artinya "sudah sampai alamat, silakan
 * diperiksa dan diterima".
 *
 * BUG YANG MELAHIRKAN BERKAS INI: perpindahan cabang dulu ditulis ulang dari
 * nol di tiga tempat, dan dua di antaranya memindahkan `branch_id` TANPA
 * menulis `tujuan_branch_id`. Kardusnya berpindah, alamatnya tidak ikut
 * diperbarui — jadi dua tulisan itu tak pernah sama lagi dan barangnya
 * MUSTAHIL diterima siapa pun. Buku faktur menulis "Dikirim", stok cabang tak
 * pernah bertambah, dan tak ada satu pun layar yang menampilkannya. Barangnya
 * hilang dari pembukuan tanpa satu pun galat.
 *
 * Karena itu jangan pernah menulis `branchId` langsung saat memindahkan baris.
 * Pakai fungsi ini: satu tempat untuk salah, satu tempat untuk memperbaikinya.
 */
import { sql } from "drizzle-orm";
import { productions } from "../../db/schema";

/**
 * Kolom-kolom yang WAJIB berubah bersama saat sebuah baris berpindah cabang.
 *
 * `dari_branch_id` sengaja memakai COALESCE: ia jejak cabang PENGIRIM PERTAMA
 * (supaya CK tetap melihat faktur yang sudah terkirim di daftarnya), jadi
 * perpindahan berikutnya tidak boleh menimpanya.
 */
export function kolomPindahCabang(tujuanBranchId: string) {
  return {
    branchId: tujuanBranchId,
    /**
     * INI YANG DULU HILANG. Tanpa baris ini barangnya mendarat di cabang
     * dengan alamat kosong (jalur produksi) atau alamat cabang lain (jalur
     * beli), dan gerbang Penerimaan tidak akan pernah mengenalinya.
     */
    tujuanBranchId,
    dariBranchId: sql`COALESCE(${productions.dariBranchId}, ${productions.branchId})`,
  };
}

/**
 * Versi untuk INSERT baris BARU yang lahir langsung di cabang tujuan (mis.
 * baris hasil "maju sebagian" di /tahap): di sini `dari_branch_id` tak bisa
 * memakai COALESCE atas dirinya sendiri — cabang asalnya diberikan pemanggil.
 *
 * `asal` = cabang tempat baris INDUKNYA berada sebelum pindah.
 */
export function kolomBarisPindah(tujuanBranchId: string, asal: string | null) {
  return {
    branchId: tujuanBranchId,
    tujuanBranchId,
    dariBranchId: asal,
  };
}
