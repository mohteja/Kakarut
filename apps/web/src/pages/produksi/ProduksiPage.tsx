import { TambahStokPage } from "./TambahStokPage";

/** Jalur stok untuk bahan yang DIPRODUKSI SENDIRI (baso, kuah, aci, dll). */
export function ProduksiPage() {
  return <TambahStokPage tipe="produksi" />;
}
