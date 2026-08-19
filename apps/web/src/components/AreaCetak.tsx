import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * AREA CETAK — dipasang sebagai anak LANGSUNG `body`, di luar shell aplikasi.
 *
 * KENAPA HARUS DI LUAR SHELL. CSS cetak menyembunyikan layar dengan
 * `body * { visibility: hidden }`, dan `visibility` menyembunyikan TANPA
 * melepas ruangnya. Tinggi dokumen yang tercetak karena itu mengikuti tinggi
 * SHELL, bukan tinggi isi cetaknya — dan shell adalah halaman yang sedang
 * dibuka, lengkap dengan daftar panjangnya.
 *
 * Akibatnya terukur, dan paling mahal justru pada struk:
 *
 *   isi struk           :    79mm
 *   shell (Riwayat)     : 1.961mm  ← tak tercetak apa pun, tapi menentukan
 *   hasil di kertas 58mm: 8 halaman, 7 di antaranya KOSONG
 *
 * Pada printer termal itu sekitar dua meter kertas terbuang untuk satu struk,
 * dan makin ramai harinya makin panjang — sebab daftar transaksi di belakangnya
 * yang menentukan.
 *
 * Sebagai anak langsung `body`, area ini bisa dipasangkan
 * `body:has(> [data-cetak-akar]) #root { display: none }` (lihat `index.css`),
 * yang benar-benar MELEPAS ruang shell. `display`, bukan `visibility` — itulah
 * seluruh inti berkas ini.
 *
 * `data-cetak-akar` dipakai selektornya, jadi area cetak BARU otomatis ikut
 * terlindungi tanpa ada yang perlu mengingat menambah id-nya ke CSS.
 */
export function AreaCetak({
  id,
  className,
  children,
  ...sisa
}: {
  /** id yang sudah dipakai aturan cetak di `index.css` (mis. `struk-print`) */
  id: string;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | number | undefined>) {
  return createPortal(
    <div id={id} data-cetak-akar="" className={`hidden print:block ${className ?? ""}`} {...sisa}>
      {children}
    </div>,
    document.body,
  );
}
