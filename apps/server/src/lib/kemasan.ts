import { HTTPException } from "hono/http-exception";
import { cekKirimKemasan } from "@kakarut/shared";

/** Bentuk minimal bahan yang dibutuhkan pemeriksaan kemasan. */
export interface BahanKemasan {
  nama: string;
  satuan: string;
  satuanBeli: string | null;
  isi: number;
  pengadaan: "produksi" | "beli";
  bolehEceran: boolean;
}

/**
 * Tegakkan aturan KEMASAN pada satu baris kiriman antar-cabang.
 *
 * Barang yang hanya bisa DIBELI per kemasan (mis. sayur per kilo) juga hanya
 * boleh DIKIRIM per kemasan — tanpa ini gudang bisa mengirim 900 gr dari
 * kemasan 1 kg, dan sisa 100 gr menggantung tanpa wadah di kedua sisi.
 * Predikatnya sama persis dengan yang dipakai belanja (`jumlahFaktur`), jadi
 * belanja dan kiriman tak pernah berbeda pendapat.
 *
 * `sisa` = saldo tersedia di cabang asal (sudah dipotong barang di jalan).
 * Bila qty = seluruh sisa, kiriman DILOLOSKAN meski bukan kelipatan: itu
 * "kirim habis", satu-satunya cara memindahkan sisa di bawah satu kemasan.
 */
export function wajibKelipatanKemasan(b: BahanKemasan, qty: number, sisa?: number): void {
  const cek = cekKirimKemasan({
    qty,
    isi: b.isi,
    pengadaan: b.pengadaan,
    bolehEceran: b.bolehEceran,
    sisa,
  });
  if (cek.ok) return;

  const kemasan = b.satuanBeli ?? "kemasan";
  const pilihan = cek.bawah > 0 ? `${cek.bawah} atau ${cek.atas}` : `${cek.atas}`;
  // Sisa yang tak akan pernah mencapai satu kemasan penuh → tawarkan jalan
  // keluarnya, kalau tidak petugas gudang buntu tanpa tahu harus apa.
  const jalanKeluar =
    sisa != null && sisa < b.isi
      ? ` Sisa ${sisa} ${b.satuan} di cabang asal boleh dikirim habis sekaligus.`
      : "";
  throw new HTTPException(400, {
    message:
      `"${b.nama}" hanya bisa dikirim per kemasan penuh — 1 ${kemasan} = ${b.isi} ${b.satuan}. ` +
      `Kirim ${pilihan} ${b.satuan}, bukan ${qty} ${b.satuan}.${jalanKeluar}`,
  });
}
