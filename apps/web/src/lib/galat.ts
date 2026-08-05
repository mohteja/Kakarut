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

/**
 * Penanda galat "chunk halaman gagal dimuat" — gejala tab yang dibuka SEBELUM
 * deploy terakhir.
 *
 * Seluruh halaman dimuat lewat `React.lazy` (± 50 rute). Nama berkas chunk-nya
 * ber-hash dan berganti tiap build, jadi begitu versi baru ter-deploy, berkas
 * lamanya hilang dari `dist`. Tab kasir yang sudah terbuka sejak awal shift
 * masih menyimpan nama-nama lama, dan menekan menu apa pun yang chunk-nya
 * belum pernah dimuat akan meminta berkas yang sudah tak ada.
 *
 * Jawabannya bahkan bukan 404: `app.notFound` server memulangkan shell SPA,
 * jadi yang datang **200 + HTML** untuk sebuah module script. Peramban menolak
 * MIME-nya, `import()` gagal, `React.lazy` melempar saat render.
 *
 * Kalimat galatnya berbeda-beda per peramban, jadi dicocokkan sebagai daftar
 * penggalan — bukan satu teks pasti.
 */
const PENGGALAN_CHUNK = [
  "failed to fetch dynamically imported module", // Chrome/Edge
  "error loading dynamically imported module", // Firefox
  "importing a module script failed", // Safari
  "failed to load module script", // MIME salah (persis kasus kita)
  "expected a javascript", // lanjutan pesan MIME di atas
  "unable to preload", // helper preload Vite
];

/**
 * `true` bila galat ini berarti "berkas halamannya tak bisa diambil", bukan
 * "kode halamannya salah". Bedanya menentukan pemulihan: yang pertama sembuh
 * dengan memuat ulang (shell-nya `no-cache`, jadi hash baru langsung terambil),
 * yang kedua tidak akan pernah sembuh dengan cara itu.
 */
export function galatChunk(e: unknown): boolean {
  if (e == null) return false;
  // Bundler bergaya webpack memberi nama; Vite tidak, jadi teksnya tetap dicek.
  if (typeof e === "object" && "name" in e && e.name === "ChunkLoadError") return true;
  const teks = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return PENGGALAN_CHUNK.some((p) => teks.includes(p));
}
