/**
 * Unduh dokumen HTML sebagai berkas PDF SUNGGUHAN (langsung ter-download —
 * tanpa dialog cetak/preview). Cocok untuk HP: satu ketuk = file .pdf turun.
 *
 * html2pdf (jsPDF + html2canvas) di-import DINAMIS agar tidak membebani bundle
 * utama — hanya dimuat saat tombol Download PDF ditekan.
 *
 * CSS harus DI-SCOPE (mis. semua selektor diawali `.dok`) supaya tidak
 * mengubah tampilan halaman aplikasi saat elemen sementara ditempel ke DOM.
 *
 * PENTING — kenapa ada DUA lapis div:
 * html2pdf tidak merender elemen yang kita berikan di tempatnya. Ia MENGKLONING
 * elemen itu (`deepCloneBasic`, atribut `style` ikut tersalin) ke dalam
 * container tersembunyinya sendiri, lalu html2canvas memotret CONTAINER-nya.
 * Jadi gaya penyembunyi apa pun yang menempel pada elemen yang kita serahkan
 * akan ikut hidup di dalam container itu: `position:fixed;left:-10000px`
 * membuat kloningnya melayang ke luar container, container jadi tanpa isi, dan
 * hasilnya PDF satu halaman KOSONG (±3 KB, hanya gambar putih).
 *
 * Karena itu penyembunyian dipasang di `luar` dan yang diserahkan ke html2pdf
 * adalah `isi` yang bersih tanpa gaya posisi. `isi` tetap terpasang di DOM
 * (lewat `luar`) supaya gambar sempat termuat dan gaya terkomputasi tersedia
 * saat pengkloningan.
 */
export async function unduhPdf(opts: {
  /** inner HTML dokumen (konten yang ingin dicetak) */
  bodyHtml: string;
  /** stylesheet ter-scope (mis. `.dok h1{...}`) */
  css: string;
  /** nama berkas tanpa ekstensi */
  namaBerkas: string;
  /** lebar kanvas render (px), default 680 */
  lebarPx?: number;
}): Promise<void> {
  // Pembungkus penyembunyi — TIDAK ikut dikloning, jadi aman diberi gaya posisi.
  const luar = document.createElement("div");
  luar.style.position = "fixed";
  luar.style.left = "-10000px";
  luar.style.top = "0";
  luar.style.width = `${opts.lebarPx ?? 680}px`;
  luar.style.background = "#ffffff";

  // Elemen yang diserahkan ke html2pdf — sengaja TANPA gaya posisi/ukuran,
  // agar kloningnya mengalir mengikuti lebar halaman A4 di container html2pdf.
  const isi = document.createElement("div");
  isi.innerHTML = `<style>${opts.css}</style>${opts.bodyHtml}`;

  luar.appendChild(isi);
  document.body.appendChild(luar);

  const nama =
    opts.namaBerkas
      .replace(/[^\w\d.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "dokumen";
  try {
    const { default: html2pdf } = await import("html2pdf.js");
    await html2pdf()
      .set({
        filename: `${nama}.pdf`,
        margin: [8, 8, 10, 8],
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(isi)
      .save();
  } finally {
    luar.remove();
  }
}
