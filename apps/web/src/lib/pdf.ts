/**
 * Unduh dokumen HTML sebagai berkas PDF SUNGGUHAN (langsung ter-download —
 * tanpa dialog cetak/preview). Cocok untuk HP: satu ketuk = file .pdf turun.
 *
 * html2pdf (jsPDF + html2canvas) di-import DINAMIS agar tidak membebani bundle
 * utama — hanya dimuat saat tombol Download PDF ditekan.
 *
 * CSS harus DI-SCOPE (mis. semua selektor diawali `.dok`) supaya tidak
 * mengubah tampilan halaman aplikasi saat elemen sementara ditempel ke DOM.
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
  const wrap = document.createElement("div");
  // render di luar layar tetapi tetap ter-layout agar html2canvas bisa mengukur
  wrap.style.position = "fixed";
  wrap.style.left = "-10000px";
  wrap.style.top = "0";
  wrap.style.width = `${opts.lebarPx ?? 680}px`;
  wrap.style.background = "#ffffff";
  wrap.innerHTML = `<style>${opts.css}</style>${opts.bodyHtml}`;
  document.body.appendChild(wrap);
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
      .from(wrap)
      .save();
  } finally {
    wrap.remove();
  }
}
