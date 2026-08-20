import { sql } from "drizzle-orm";
import type { db } from "../../db/client";

/**
 * Backfill: baris produksi/beli lama yang berhenti di 'menunggu' padahal
 * CK-LOKAL (tujuan kosong atau = cabang sendiri) → 'dikonfirmasi' (masuk stok).
 *
 * Membereskan data dari SEBELUM fitur auto-confirm: hasil produksi yang sudah
 * ditandai "Selesai" tapi masih tampil "menunggu konfirmasi" di Stok dan tak
 * ikut saldo. Sejak fitur auto-confirm, baris CK-lokal langsung 'dikonfirmasi'
 * saat mencapai 'menunggu', jadi backfill ini idempoten — setelah beres tak ada
 * lagi baris CK-lokal 'menunggu'. Baris bertujuan cabang LAIN tak disentuh
 * (harus dikirim & diterima di cabang tujuan).
 */
export async function konfirmasiProduksiCkLokalTertahan(database: typeof db) {
  const res = await database.execute(sql`
    UPDATE productions
    SET status = 'dikonfirmasi',
        confirmed_at = COALESCE(confirmed_at, updated_at, waktu),
        confirmed_by = COALESCE(confirmed_by, user_id)
    WHERE status = 'menunggu'
      AND deleted_at IS NULL
      AND (tujuan_branch_id IS NULL OR tujuan_branch_id = branch_id)
      -- BELUM PERNAH BERANGKAT. Tanpa syarat ini backfill menyapu barang yang
      -- sedang DI JALAN, bukan cuma yang macet di rak sendiri.
      --
      -- Sebabnya halus: mengirim MEMINDAHKAN barisnya ke cabang tujuan
      -- ('kolomPindahCabang'), sehingga kiriman yang menunggu ditekan "Terima"
      -- justru memenuhi 'tujuan_branch_id = branch_id' — syarat yang di atas
      -- dimaksudkan untuk menandai "tak ke mana-mana".
      --
      -- Terukur pada satu database berisi kiriman berjalan: predikat tanpa
      -- baris ini mencocokkan 17 baris, dan 14 di antaranya barang di jalan.
      -- Sasaran sejatinya cuma 3. Efeknya: stok mendarat di cabang tujuan
      -- tanpa ada yang menerimanya, dan tak ada layar yang bisa membatalkannya.
      --
      -- 'dikirim_at' penanda yang sama yang dipakai 'qtyDiJalan' untuk
      -- "sudah tidak ada di rak" — bukan aturan baru, hanya yang sudah ada.
      AND dikirim_at IS NULL
  `);
  return res.rowCount ?? 0;
}
