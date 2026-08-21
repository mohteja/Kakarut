/** Satu ember jam pada grafik sebaran transaksi. */
export type EmberJam = { jam: number; jumlah: number; omzet: number };

/**
 * Rapatkan hasil `GROUP BY jam` jadi deret jam yang BERSAMBUNG, dari jam
 * transaksi PERTAMA sampai TERAKHIR.
 *
 * Dua keputusan yang berlawanan, dan keduanya disengaja:
 *
 *   · Jam kosong DI TENGAH ikut, bernilai nol. Itu jeda sungguhan — warung
 *     yang ramai jam 11 lalu sepi sampai jam 17 memang punya bentuk seperti
 *     itu. Membuangnya memampatkan sumbu waktu sehingga dua jam yang
 *     berjauhan tergambar bersebelahan, dan grafiknya berbohong tentang
 *     bentuk harinya.
 *
 *   · Jam kosong di kedua UJUNG dipangkas. Warung yang buka jam 10 dan tutup
 *     jam 21 tak perlu memandangi sepuluh kolom kosong; kolom itu tak
 *     menambah keterangan apa pun, cuma meratakan batang yang berisi.
 *
 * Dipisah dari rutenya supaya bisa diuji tanpa Postgres — dan supaya ujinya
 * benar-benar MENJALANKAN aturannya, bukan mencocokkan teks sumbernya.
 */
export function rapatkanJam(baris: EmberJam[]): EmberJam[] {
  if (baris.length === 0) return [];
  const isi = new Map(baris.map((r) => [r.jam, r]));
  const jam = [...isi.keys()];
  const keluar: EmberJam[] = [];
  for (let j = Math.min(...jam); j <= Math.max(...jam); j++) {
    const r = isi.get(j);
    keluar.push({ jam: j, jumlah: r?.jumlah ?? 0, omzet: r?.omzet ?? 0 });
  }
  return keluar;
}
