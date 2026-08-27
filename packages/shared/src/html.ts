/**
 * Pelolos aksara HTML — SATU rumah untuk web maupun server.
 *
 * Asalnya `esc()` lokal di `apps/web/src/pages/produksi/DokumenBelanjaModal.tsx`,
 * yang sudah terbukti dipakai konsisten di tiap interpolasi dokumen cetak.
 * Ia DIPINDAH ke sini (bukan disalin) ketika surat di server ternyata merakit
 * HTML dari data pengguna tanpa satu pun pelolos: dua salinan aturan yang sama
 * adalah kelas cacat yang sudah berulang kali menggigit repo ini.
 */

const PETA_TEKS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const PETA_ATRIBUT: Record<string, string> = { ...PETA_TEKS, "'": "&#39;" };

/**
 * Untuk data yang ditaruh sebagai TEKS di antara tag.
 * Nilai non-string diseragamkan lewat `String()`; `null`/`undefined` → "".
 */
export function lolosHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => PETA_TEKS[c] ?? c);
}

/**
 * Untuk data yang ditaruh sebagai NILAI ATRIBUT (`href="…"`, `title="…"`).
 * Sama seperti {@link lolosHtml} plus `'`, supaya atribut berkutip tunggal
 * pun tidak bisa ditutup lebih awal.
 */
export function lolosAtribut(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => PETA_ATRIBUT[c] ?? c);
}
