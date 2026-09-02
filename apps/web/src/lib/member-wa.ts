/**
 * MEMBER DIKENALI DARI NOMOR WA — NAMA SAJA TIDAK PERNAH MENJADI MEMBER.
 *
 * Keputusan yang disengaja, dan letaknya di server (`upsertCustomer` di
 * `modules/customer/service.ts`): tanpa WA yang sah tak ada baris member yang
 * dibuat — nama tamu hanya disalin ke nota. Alasannya: nama bukan identitas
 * ("Budi" ada lima), dan member tanpa nomor tak bisa dihubungi maupun
 * digabung dengan kunjungannya yang berikut.
 *
 * Yang dijaga di sini SATU hal: kasir DIBERI TAHU sambil mengetik — bukan
 * seminggu kemudian saat tamunya dicari di Member dan tak ada. Ambang 6 angka
 * MENYALIN `normalizeWa` server persis (dipaku uji): bila server menganggap
 * nomornya terlalu pendek, layar tak boleh diam.
 */
export const MIN_DIGIT_WA = 6;

/** Hanya angkanya — spasi, `+`, dan tanda hubung dibuang, sama seperti server. */
export function digitWa(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Petunjuk untuk kasir, atau null bila tak ada yang perlu dikatakan. */
export function petunjukMember(nama: string, wa: string): string | null {
  const digit = digitWa(wa);
  if (digit.length >= MIN_DIGIT_WA) return null;
  if (digit.length > 0) {
    return `No. WhatsApp terlalu pendek (${digit.length} angka) — member butuh paling sedikit ${MIN_DIGIT_WA} angka.`;
  }
  const n = nama.trim();
  if (!n) return null;
  return `Nama saja tidak tersimpan sebagai member — isi No. WhatsApp agar ${n} tercatat di Member.`;
}
