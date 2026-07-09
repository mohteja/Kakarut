import { TambahStokPage } from "./TambahStokPage";

/** Jalur stok untuk bahan yang DIBELI JADI (kemasan, powder minuman, dll). */
export function PembelianPage() {
  return <TambahStokPage tipe="beli" />;
}
