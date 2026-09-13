/**
 * JATAH REKAMAN BALASAN — kunci dan keputusannya, sebagai fungsi murni.
 *
 * Perekam balasan (`ADU_TIPE=` di `app.ts`) menumpang jalur permintaan, jadi ia
 * dibatasi: paling banyak `maks` rekaman per kunci. Yang membuat berkas ini ada
 * bukan kerapian melainkan satu cacat yang terukur pada 2026-09-12.
 *
 * Pembanding tipe (`adu-tipe-kawat.ts`) MEMBUANG tiap balasan berstatus ≥ 400 —
 * bentuknya `{error}`/`{kode}`, dipaku dari sisi lain. Jatahnya, sampai hari
 * itu, dihabiskan tanpa mengetahui itu: kuncinya hanya `metode+pola`. Maka rute
 * yang DUA ketukan pertamanya kebetulan uji penolakan menghabiskan jatahnya
 * pada balasan yang akan dibuang, dan bentuk SUKSESNYA tak pernah diadu sama
 * sekali.
 *
 * Terukur pada jalan yang sama, batas 2 lawan batas 8: **delapan pola** kembali
 * muncul begitu batasnya dinaikkan — di antaranya `POST /api/penjualan`, yang
 * dua ketukan pertamanya 409, 409. Rute paling inti aplikasi kasir, bentuk
 * balasannya tak pernah dibandingkan dengan kontrak.
 *
 * Dan tak ada yang mengabarkannya: lengan premisnya LANTAI (`≥ 250`), dan
 * lantai tak bisa melihat delapan yang hilang.
 *
 * Memisahkan kelasnya membeli jangkauan penuh dengan harga yang jauh lebih
 * murah daripada menaikkan batasnya — terukur pada jalan yang sama:
 *
 *   | bentuk                  | rekaman | pola diadu | berkas   |
 *   | ----------------------- | ------- | ---------- | -------- |
 *   | batas 2, satu jatah     |     585 |        261 |  903 KB  |
 *   | batas 8, satu jatah     |   1.851 |        269 | 4,42 MB  |
 *   | batas 2, jatah terpisah |     899 |    **269** | 1,04 MB  |
 */

/** Balasan yang pembandingnya buang — jatahnya karena itu dipisah. */
export function kelasBalasan(status: number): "ok" | "galat" {
  return status >= 400 ? "galat" : "ok";
}

/**
 * Kunci jatah. Kelasnya ikut supaya uji penolakan tak bisa mengelaparkan
 * bentuk sukses yang justru ingin diadu.
 */
export function kunciRekam(metode: string, pola: string, status: number): string {
  return `${metode} ${pola} ${kelasBalasan(status)}`;
}
