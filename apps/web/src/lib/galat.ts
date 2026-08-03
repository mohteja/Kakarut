/**
 * Galat milik aksi yang PALING BARU dijalankan, untuk layar dengan beberapa
 * mutasi yang berbagi satu `<ErrorText>`.
 *
 * Bentuk yang digantikannya, `a.error || b.error || c.error`, memilih yang
 * pertama truthy — bukan yang terbaru. Dan galat sebuah mutasi bertahan sampai
 * mutasi ITU dijalankan lagi, jadi satu kegagalan bisa menempel sebagai
 * spanduk merah di atas semua keberhasilan sesudahnya, tanpa cara menutupnya.
 *
 * Di layar Penerimaan Barang akibatnya bukan sekadar berisik: tugas layar itu
 * persis menjawab "barang ini jadi masuk atau tidak", dan jawaban merah yang
 * salah membuat setiap jawaban berikutnya ikut tak bisa dipercaya.
 *
 * Yang dipulangkan adalah galat milik aksi yang PALING BARU DITEKAN — bukan
 * galat terbaru yang masih tersisa. Bedanya menentukan: kalau aksi terakhir
 * BERHASIL, layar harus diam, meski aksi sebelumnya masih menyimpan galatnya.
 * Memilih "galat terbaru yang ada" tetap memajang kegagalan lama di atas
 * keberhasilan baru — persis cacat yang hendak dihapus.
 *
 * `submittedAt` adalah cap waktu pengiriman terakhir mutasi (0 bila belum
 * pernah dijalankan), jadi urutannya mengikuti apa yang benar-benar ditekan.
 * Mutasi yang belum pernah jalan tak perlu disaring: `submittedAt`-nya 0
 * sekaligus `error`-nya null, jadi ia tak mungkin menang MAUPUN memajang apa
 * pun kalau menang.
 */
export function galatTerbaru(
  ...mutasi: { error: unknown; submittedAt: number }[]
): unknown {
  let terakhir: { error: unknown; submittedAt: number } | null = null;
  for (const m of mutasi) {
    if (!terakhir || m.submittedAt > terakhir.submittedAt) terakhir = m;
  }
  return terakhir?.error ?? null;
}
