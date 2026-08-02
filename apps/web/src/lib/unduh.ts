/**
 * Unduhan berkas dari peramban — SATU-SATUNYA berkas di rumpun ini yang
 * menyentuh DOM.
 *
 * Dipisah dari `bahanCsv.ts` dengan sengaja. Aturan angka CSV di sana perlu
 * diuji, dan ujinya hidup di paket server yang `lib`-nya TIDAK memuat "dom" —
 * satu `document.createElement` di berkas yang sama membuat `tsc --noEmit`
 * server gagal, dan godaan berikutnya adalah melonggarkan tsconfig server.
 * Itu justru menghapus pagar yang menahan kode DOM masuk ke sisi server.
 *
 * Jadi yang murni tetap murni, dan yang butuh peramban dikumpulkan di sini.
 */

/** Unduh string sebagai berkas CSV (BOM UTF-8 agar Excel membaca aksara Indonesia). */
export function unduhCsv(nama: string, isi: string) {
  const blob = new Blob([`\ufeff${isi}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nama;
  a.click();
  URL.revokeObjectURL(url);
}
