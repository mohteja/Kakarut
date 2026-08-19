import {
  contohFakturBelanja as dataFaktur,
  contohStruk as dataStruk,
  type OpsiContohStruk,
} from "@kakarut/shared";
import type { SaleResult } from "../pages/kasir/ReceiptModal";
import type { FakturGroup } from "../pages/produksi/TambahStokPage";

/**
 * PENGIKAT DATA CONTOH KE BENTUK YANG SEBENARNYA.
 *
 * Datanya sendiri ada di `@kakarut/shared` supaya bisa DIJALANKAN uji unit
 * (aritmetika struk contoh harus konsisten, dan itu cuma terbukti dengan
 * menjalankannya; proyek server tak bisa membaca tipe dari `apps/web`).
 *
 * Yang dikerjakan berkas ini cuma satu hal, dan hal itu penting: anotasi
 * `: SaleResult` / `: FakturGroup` di bawah memaksa TypeScript memeriksa bahwa
 * data contoh masih cocok dengan bentuk yang benar-benar diterima komponennya.
 * Begitu `SaleResult` bertambah field wajib, yang gagal adalah typecheck —
 * bukan tata letak cetak yang baru ketahuan setelah kertasnya keluar.
 */

export function contohStruk(opts: OpsiContohStruk): SaleResult {
  return dataStruk(opts);
}

export function contohFakturBelanja(opts: { cabang?: string | null } = {}): FakturGroup {
  return dataFaktur(opts);
}
