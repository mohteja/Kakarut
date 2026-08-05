/**
 * Pagar untuk setelan printer yang diketik bebas.
 *
 * Tiga kotak angka di Pengaturan Printer (`feedLines`, `chunkSize`,
 * `chunkDelayMs`) memakai `<input type="number">`. Atribut `min`/`max` di sana
 * TIDAK menahan apa pun: keduanya hanya mengatur tombol panah dan status
 * validitas form. Nilai yang diketik — atau kotak yang dikosongkan — tetap
 * sampai ke `onChange`, dan di halaman itu tiap ketukan langsung ditulis ke
 * localStorage.
 *
 * Yang paling gawat `chunkSize`, karena ia dipakai sebagai LANGKAH perulangan
 * pengiriman byte ke printer BLE:
 *
 *  - Kotak dikosongkan (cara paling wajar untuk mengetik ulang angka) →
 *    `Number("")` = 0 → langkah 0 → indeksnya tak pernah maju. Printer
 *    dibanjiri potongan kosong tanpa henti, struknya tak pernah keluar, dan
 *    janji cetaknya tak pernah selesai: status berhenti di "Mencetak…".
 *  - Ketikan setengah jadi yang tetap diterima `type="number"` ("2e", "-",
 *    "1.2.3") → `NaN`. Badannya jalan SEKALI (`0 < panjang`) dengan
 *    `slice(0, NaN)` = potongan KOSONG, lalu `i` jadi NaN dan `NaN < panjang`
 *    bernilai false sehingga perulangannya berhenti. Hasilnya: satu tulisan
 *    kosong ke printer, nol byte struk, dan `write()` BERHASIL. Aplikasi
 *    melaporkan struk tercetak untuk sesuatu yang tak pernah keluar.
 *  - Dan NaN tidak berhenti di situ: `JSON.stringify(NaN)` = `null`, jadi
 *    sesudah muat ulang nilainya jadi `null` → `i += null` sama dengan
 *    `i += 0` → berubah menjadi perulangan tak berujung di atas.
 *
 * (Pecahan seperti 100,5 justru TIDAK merusak apa pun: `slice` memangkas awal
 * dan akhir sama-sama ke bawah, jadi potongannya tetap sambung-menyambung dan
 * tak ada byte yang terkirim dua kali. `Math.round` di bawah cuma merapikan —
 * jumlah byte memang sepantasnya bilangan bulat — bukan menambal cacat.)
 *
 * Dua tetangganya di berkas yang sama memang sudah dijaga — `lanPort` pakai
 * `Number(...) || 9100`, `effectiveCharsPerLine` pakai
 * `s.charsPerLine && s.charsPerLine > 0` — jadi yang paling berbahaya justru
 * satu-satunya yang terlewat.
 */

export interface Rentang {
  min: number;
  max: number;
}

/**
 * Rentang wajar tiap setelan angka. Dipakai BERSAMA oleh atribut `min`/`max`
 * kotak isian dan oleh `angkaSetelan()`, supaya yang ditampilkan dan yang
 * benar-benar dijaga tak bisa berbeda.
 */
export const RENTANG = {
  /** 20 = MTU ATT minimum (23 − 3 byte header); 512 = batas satu writeValue. */
  chunkSize: { min: 20, max: 512 },
  chunkDelayMs: { min: 0, max: 200 },
  feedLines: { min: 0, max: 10 },
} as const satisfies Record<string, Rentang>;

/**
 * Angka setelan yang bisa dipercaya: bukan angka (NaN/Infinity/null-lewat-
 * `Number`) → `bawaan`; pecahan → dibulatkan; di luar rentang → dijepit ke
 * batas terdekat.
 *
 * Sengaja MENJEPIT, bukan mengembalikan ke bawaan, untuk nilai yang masih
 * angka: orang yang mengetik 10 memang ingin sekecil mungkin, dan 20 adalah
 * jawaban jujurnya. Kotak isiannya merapikan diri saat blur, jadi jepitannya
 * terlihat saat terjadi — bukan kejutan yang baru ketahuan waktu mencetak.
 */
export function angkaSetelan(nilai: unknown, bawaan: number, r: Rentang): number {
  const n = typeof nilai === "number" ? nilai : Number(nilai);
  if (!Number.isFinite(n)) return bawaan;
  return Math.min(r.max, Math.max(r.min, Math.round(n)));
}

/**
 * Potong byte struk menjadi daftar potongan siap kirim.
 *
 * Memulangkan ARRAY, bukan menaikkan indeks di tempat pemakaian: jumlah
 * potongannya sudah tertentu sebelum satu byte pun dikirim, jadi "langkah
 * nol" tak bisa lagi berarti perulangan tanpa akhir — apa pun isi setelannya,
 * dan siapa pun yang kelak memanggil `setChunking()`.
 *
 * Bawaannya di sini `RENTANG.chunkSize.min`, bukan bawaan setelan: di lapisan
 * ini kita tak tahu setelan aslinya, dan potongan terkecil selalu aman —
 * paling lambat, tak pernah gagal.
 */
export function potongBytes(bytes: Uint8Array, chunkSize: number): Uint8Array<ArrayBuffer>[] {
  const langkah = angkaSetelan(chunkSize, RENTANG.chunkSize.min, RENTANG.chunkSize);
  // `slice()` selalu menyalin ke ArrayBuffer baru (bukan SharedArrayBuffer),
  // dan Web Bluetooth hanya menerima yang itu.
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < bytes.length; i += langkah) out.push(bytes.slice(i, i + langkah));
  return out;
}
