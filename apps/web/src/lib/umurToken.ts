/**
 * UMUR TOKEN, DIBACA DI KLIEN — TANPA MEMVERIFIKASI TANDA TANGANNYA.
 *
 * Kenapa ini ada. Token hidup 12 jam tanpa refresh, jadi tiap sesi mati tepat
 * waktu; dan saat ia mati, layar yang terbuka menembakkan SELURUH kueri yang
 * terpasang dalam satu momen (penyegaran-saat-fokus di web, `_segarkan()` di
 * ponsel). Semuanya membawa token yang sama, semuanya ditolak, dan tiap
 * penolakan menulis satu baris log. Terukur di panel galat production
 * 2026-09-02: 1.744 penolakan 4xx dalam 7 hari, NOL 5xx, ~14 baris per sesi
 * yang mati.
 *
 * PENJAGA SEKALI-JALAN TAK CUKUP untuk itu, dan ini inti rancangannya: keempat
 * belas permintaan sudah berangkat SEBELUM balasan pertama tiba, jadi apa pun
 * yang dikerjakan saat balasan datang selalu terlambat. Satu-satunya titik yang
 * masih bisa memotongnya adalah SEBELUM permintaan dikirim.
 *
 * TANDA TANGANNYA SENGAJA TIDAK DIPERIKSA. Klien bukan otoritas atas keabsahan
 * token — server tetap satu-satunya yang memutuskan. Yang dilakukan di sini
 * hanya menghindari permintaan yang SUDAH PASTI ditolak. Karena itu semua
 * kegagalan membaca berakhir "belum mati": token yang aneh tetap dikirim dan
 * server yang menjawab. Arah gagalnya dipilih: lebih baik satu permintaan
 * sia-sia daripada satu sesi sah yang diputus klien.
 */

/**
 * Jeda sesudah `exp` sebelum token dianggap mati.
 *
 * Bukan hiasan: perbandingannya memakai jam, dan jam perangkat bisa meleset.
 * Marginnya dipasang SESUDAH `exp` (bukan sebelum) supaya arah kekeliruannya
 * tetap aman — telat menyatakan mati berarti satu permintaan sia-sia, terlalu
 * cepat menyatakan mati berarti kasir dikeluarkan dari sesi yang masih sah.
 */
export const MARGIN_MATI_MS = 60_000;

/** `exp` dalam milidetik epoch, atau null bila tak terbaca. */
export function expTokenMs(token: string): number | null {
  try {
    const bagian = token.split(".");
    if (bagian.length !== 3) return null;
    const b64 = bagian[1].replace(/-/g, "+").replace(/_/g, "/");
    const isi = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    // Payload memuat nama/email yang bisa non-ASCII; `atob` memulangkan deret
    // byte, jadi diterjemahkan sebagai UTF-8 dulu. Tanpa ini satu nama beraksen
    // membuat JSON.parse melempar — dan token yang sah dianggap tak terbaca.
    const teks = new TextDecoder().decode(Uint8Array.from(isi, (ch) => ch.charCodeAt(0)));
    const payload = JSON.parse(teks) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/**
 * Benar HANYA bila token itu pasti sudah lewat umurnya menurut `sekarangMs`.
 * Token tanpa `exp`, cacat, atau bukan JWT → false (kirim saja, server yang
 * memutuskan).
 */
export function tokenSudahMati(token: string, sekarangMs: number): boolean {
  const exp = expTokenMs(token);
  if (exp === null) return false;
  return exp + MARGIN_MATI_MS <= sekarangMs;
}
