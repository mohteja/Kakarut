/**
 * AUDIT INVARIAN BASIS DATA — apa yang DIANDAIKAN kode, diperiksa pada DATANYA.
 *
 * Basis data ini cuma punya **delapan** `CHECK` untuk 59 tabel. Selebihnya
 * invarian hidup di kode: Zod di pintu, penjaga di dalam transaksi, kunci baris
 * saat dua orang menekan tombol yang sama. Semuanya diuji satu per satu — tapi
 * tak satu pun menjawab pertanyaan yang sebenarnya: **apakah ada baris yang
 * melanggarnya?**
 *
 * Skrip ini menanyakan itu langsung ke datanya, dan dijalankan CI **sesudah**
 * `verify-api.sh` — jadi yang diperiksa bukan basis data kosong melainkan yang
 * baru saja dilewati 2.700+ asersi lewat rute sungguhan: penjualan, refund,
 * transfer, opname, produksi, sinkron offline, kosongkan sampah.
 *
 * KENAPA BUKAN `CHECK` SAJA. Sebagian invarian di bawah memang bisa jadi
 * `CHECK` (`qty > 0`), dan yang begitu memang sebaiknya begitu. Tapi yang
 * paling berharga di sini justru yang TAK BISA: identitas uang
 * `total = subtotal − diskon + pb1` menyilang beberapa kolom sekaligus, dan
 * kecocokan tanda `qty` dengan `tipe` bergantung pada enum di kolom lain.
 * `CHECK` menolak baris yang salah SAAT DITULIS; audit ini menjawab pertanyaan
 * yang berbeda — "sesudah semua rute dijalankan, adakah yang tersisa salah?"
 *
 * ATURAN MENAMBAH INVARIAN: tulis yang DIANDAIKAN KODE, bukan yang kebetulan
 * benar hari ini. Contoh yang salah dan sempat kutulis sendiri:
 * `supply_mutations.qty >= 0` — ternyata TANDA-nya yang membawa arah (masuk
 * positif, pakai/kirim negatif), jadi 58 baris "melanggar" padahal justru
 * benar. Yang benar kecocokan tanda dengan `tipe`, dan itu ada di bawah.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client";

interface Invarian {
  nama: string;
  /** SQL yang MENGHITUNG BARIS YANG MELANGGAR — nol berarti sehat. */
  langgar: string;
}

const INVARIAN: Invarian[] = [
  // ── Baris penjualan ────────────────────────────────────────────────────
  { nama: "sale_items.qty > 0", langgar: "SELECT count(*) n FROM sale_items WHERE NOT (qty > 0)" },
  { nama: "sale_items.qty_refund >= 0", langgar: "SELECT count(*) n FROM sale_items WHERE qty_refund < 0" },
  {
    // Refund melebihi yang terjual = uang keluar yang tak pernah masuk.
    // Dijaga rute + kunci baris `sales` (`FOR UPDATE`); dua refund serentak
    // terukur berakhir 200/400, bukan dua-duanya lolos.
    nama: "sale_items.qty_refund <= qty",
    langgar: "SELECT count(*) n FROM sale_items WHERE qty_refund > qty",
  },
  { nama: "sale_items.harga_satuan >= 0", langgar: "SELECT count(*) n FROM sale_items WHERE harga_satuan < 0" },
  { nama: "sale_items.line_total >= 0", langgar: "SELECT count(*) n FROM sale_items WHERE line_total < 0" },

  // ── Uang penjualan ─────────────────────────────────────────────────────
  { nama: "sales.subtotal >= 0", langgar: "SELECT count(*) n FROM sales WHERE subtotal < 0" },
  { nama: "sales.diskon >= 0", langgar: "SELECT count(*) n FROM sales WHERE diskon < 0" },
  { nama: "sales.diskon <= subtotal", langgar: "SELECT count(*) n FROM sales WHERE diskon > subtotal" },
  { nama: "sales.pb1_amount >= 0", langgar: "SELECT count(*) n FROM sales WHERE pb1_amount < 0" },
  { nama: "sales.total >= 0", langgar: "SELECT count(*) n FROM sales WHERE total < 0" },
  { nama: "sales.refund_total >= 0", langgar: "SELECT count(*) n FROM sales WHERE refund_total < 0" },
  { nama: "sales.total_hpp >= 0", langgar: "SELECT count(*) n FROM sales WHERE total_hpp < 0" },
  {
    nama: "sales.uang_diterima >= 0",
    langgar: "SELECT count(*) n FROM sales WHERE uang_diterima IS NOT NULL AND uang_diterima < 0",
  },
  {
    /*
     * IDENTITAS UANGNYA, dan inilah yang paling tak bisa jadi `CHECK` biasa
     * tanpa menyilang beberapa kolom sekaligus. Ia menahan seluruh jalur yang
     * menulis angka penjualan — `createSale`, refund bertahap, rekalkulasi HPP
     * — dengan satu kalimat: totalnya harus tetap sama dengan bagian-bagiannya.
     * Toleransi 0,01 untuk pembulatan rupiah.
     */
    nama: "IDENTITAS: total = subtotal − diskon + pb1_amount",
    langgar:
      "SELECT count(*) n FROM sales WHERE abs(total - (subtotal - diskon + pb1_amount)) > 0.01",
  },

  // ── Mutasi perlengkapan: TANDA membawa arah ────────────────────────────
  {
    nama: "supply_mutations: masuk/terima bertanda positif",
    langgar: "SELECT count(*) n FROM supply_mutations WHERE tipe IN ('masuk','terima') AND qty <= 0",
  },
  {
    nama: "supply_mutations: pakai/auto/kirim bertanda negatif",
    langgar: "SELECT count(*) n FROM supply_mutations WHERE tipe IN ('pakai','auto','kirim') AND qty >= 0",
  },
  {
    nama: "supply_mutations.total_harga >= 0",
    langgar: "SELECT count(*) n FROM supply_mutations WHERE total_harga IS NOT NULL AND total_harga < 0",
  },

  // ── Master & produksi ──────────────────────────────────────────────────
  { nama: "productions.qty > 0", langgar: "SELECT count(*) n FROM productions WHERE NOT (qty > 0)" },
  {
    nama: "productions.total_harga >= 0",
    langgar: "SELECT count(*) n FROM productions WHERE total_harga IS NOT NULL AND total_harga < 0",
  },
  { nama: "ingredients.harga_beli >= 0", langgar: "SELECT count(*) n FROM ingredients WHERE harga_beli < 0" },
  { nama: "ingredients.isi > 0", langgar: "SELECT count(*) n FROM ingredients WHERE NOT (isi > 0)" },
  { nama: "menus.harga_jual >= 0", langgar: "SELECT count(*) n FROM menus WHERE harga_jual < 0" },
  { nama: "open_bill_items.qty > 0", langgar: "SELECT count(*) n FROM open_bill_items WHERE NOT (qty > 0)" },

  // ── Kas & shift ────────────────────────────────────────────────────────
  { nama: "shifts.modal_awal >= 0", langgar: "SELECT count(*) n FROM shifts WHERE modal_awal < 0" },
  {
    nama: "shifts.uang_fisik >= 0",
    langgar: "SELECT count(*) n FROM shifts WHERE uang_fisik IS NOT NULL AND uang_fisik < 0",
  },

  // ── Bukti peristiwa yang tak boleh hilang bersama penunjuknya ──────────
  {
    /*
     * `sale_id` ber-`ON DELETE SET NULL`: ia hilang saat penjualannya dihapus
     * permanen. `pernah_jadi_penjualan` menyimpan faktanya terpisah — jadi
     * baris yang punya `sale_id` WAJIB juga bertanda. Kebalikannya boleh:
     * bertanda tapi `sale_id` sudah NULL persis keadaan sesudah sampah
     * dikosongkan.
     */
    nama: "open_bills: sale_id terisi ⇒ pernah_jadi_penjualan",
    langgar:
      "SELECT count(*) n FROM open_bills WHERE sale_id IS NOT NULL AND pernah_jadi_penjualan = false",
  },
];

async function main(): Promise<void> {
  let gagal = 0;
  const lebar = Math.max(...INVARIAN.map((i) => i.nama.length));
  for (const inv of INVARIAN) {
    const hasil = await db.execute(sql.raw(inv.langgar));
    const n = Number((hasil.rows[0] as { n: string | number }).n);
    if (n === 0) {
      console.log(`  ✔ ${inv.nama.padEnd(lebar)}  0 pelanggaran`);
    } else {
      gagal += 1;
      console.log(`  ✘ ${inv.nama.padEnd(lebar)}  ${n} BARIS MELANGGAR`);
    }
  }
  console.log(
    `\n=== Audit invarian: ${INVARIAN.length - gagal} sehat, ${gagal} dilanggar (dari ${INVARIAN.length}) ===`,
  );
  await pool.end();
  if (gagal > 0) process.exit(1);
}

void main();
