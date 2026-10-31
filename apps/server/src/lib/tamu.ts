import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * AKUN TAMU (demo bersama) — identitasnya satu rumah.
 *
 * Tombol "Tamu Owner/Kasir" memasukkan SIAPA PUN ke satu perusahaan demo
 * bersama (`seed/guest.ts`). Sampai 2026-10-31 sesi itu tak bisa dibedakan
 * dari owner asli di server: tamu bisa mengundang karyawan lewat surel ke
 * alamat mana pun, mengganti password akun bersama (mengunci tamu lain), atau
 * menghapusnya. Laporan uji 31 Okt 2026 menemukannya.
 *
 * Dikenali dari EMAIL, bukan klaim token: `requireAuth` membaca email dari
 * basis data di tiap request, jadi tak ada token lama yang bisa lolos, dan
 * tak perlu satu kueri pun tambahan.
 */
export const EMAIL_TAMU_OWNER = "owner-demo@terakasir.app";
export const EMAIL_TAMU_KASIR = "kasir-demo@terakasir.app";

const EMAIL_TAMU = new Set<string>([EMAIL_TAMU_OWNER, EMAIL_TAMU_KASIR]);

export function adalahTamu(email: string | null | undefined): boolean {
  return email != null && EMAIL_TAMU.has(email.trim().toLowerCase());
}

/** Kalimat & sebab yang sama di semua pintu yang ditutup untuk tamu. */
export const PESAN_TAMU = "Tidak tersedia di akun demo — daftar akun sendiri untuk memakai fitur ini";

/** 403 ber-`sebab: "akun_tamu"` — diteruskan `app.onError` ke badan respons. */
export class AksiTamuDitolak extends HTTPException {
  readonly sebab = "akun_tamu";
  constructor() {
    super(403, { message: PESAN_TAMU });
  }
}

/**
 * Tolak aksi berbahaya dari akun demo: mengirim surel, mengubah akun/kunci
 * bersama, menyentuh langganan, atau membuat server menghubungi alamat lain.
 * Menjual, open bill, stok, dan menu tetap boleh (direset tiap malam).
 */
export const tolakTamu: MiddlewareHandler = async (c, next) => {
  const auth = c.get("auth") as { email?: string } | undefined;
  if (adalahTamu(auth?.email)) throw new AksiTamuDitolak();
  await next();
};
