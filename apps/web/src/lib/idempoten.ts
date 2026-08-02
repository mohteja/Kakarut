/**
 * KUNCI IDEMPOTENSI untuk perintah yang MEMINDAHKAN UANG.
 *
 * Masalahnya bukan klik ganda — tombolnya sudah dimatikan selama pending.
 * Masalahnya jaringan putus SESUDAH server menyimpan transaksi tapi SEBELUM
 * balasannya sampai ke browser: transaksi kedua terbuat untuk satu kali
 * pembayaran, dan omzet, stok, serta HPP semuanya terhitung dua kali.
 *
 * DAN ITU TIDAK SELALU BUTUH MANUSIA. Terukur di Chromium: saat server menutup
 * koneksi keep-alive yang sedang dipakai ulang, browser MENGULANG SENDIRI POST
 * itu tanpa aksi siapa pun. Jadi kuncinya bukan cuma pengaman dari kasir yang
 * menekan tombol dua kali — ia pengaman dari perilaku browser yang tak bisa
 * kita larang.
 *
 * Server sudah punya penangkalnya sejak lama (`cariHasilIdempoten`, diperiksa
 * paling awal di `POST /penjualan`) — tapi itu hanya bekerja kalau klien
 * mengirim `client_ref` YANG SAMA saat mencoba ulang. Klien Flutter
 * mengirimnya; web tidak, sampai sekarang.
 */

/**
 * UUID v4.
 *
 * `crypto.randomUUID` hanya ada di secure context (https / localhost). Toko
 * yang membuka aplikasinya lewat http di jaringan lokal tidak punya itu, dan
 * kalau kita memanggilnya buta, pembayaran akan gagal dengan TypeError —
 * mengubah pengaman transaksi jadi penghenti transaksi. Jadi ada cadangan.
 */
export function uuidV4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // versi 4
  b[8] = (b[8] & 0x3f) | 0x80; // varian RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
