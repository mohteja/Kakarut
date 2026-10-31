import bcrypt from "bcryptjs";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client";
import { memberships, users } from "../db/schema";

/** PIN refund: tepat 6 angka. */
export const POLA_PIN_REFUND = /^\d{6}$/;

/** 403 ber-`sebab` — klien bercabang atas `sebab`, bukan teks. */
export class PinRefundDitolak extends HTTPException {
  constructor(
    readonly sebab: "pin_refund_wajib" | "pin_refund_belum_diatur" | "pin_refund_salah",
    message: string,
  ) {
    super(403, { message });
  }
}

/**
 * IZIN REFUND KASIR — PIN owner/admin yang HADIR di kasir.
 *
 * Laporan uji 31 Okt 2026: kasir bisa menekan "Kembalikan uang" sendirian.
 * Pemilik memilih PIN di tempat (bukan persetujuan jarak jauh): owner/admin
 * mengatur PIN 6 angka di Profil, kasir mengetikkan PIN itu saat refund.
 *
 * Dicocokkan ke SEMUA owner/admin aktif perusahaan yang punya PIN; yang cocok
 * dicatat sebagai penyetuju (`sale_refunds.disetujui_oleh`).
 */
/**
 * PAGAR TEBAK PIN — 5 PIN SALAH per 15 menit per kasir, lalu terkunci.
 *
 * Hanya yang SALAH yang dihitung: refund sah sebanyak apa pun tak boleh
 * terhalang (versi pertama memagari semua refund dan menahan kasir yang sibuk
 * dengan 429). PIN 6 angka = sejuta kemungkinan; tanpa pagar ini kasir bisa
 * menebaknya lewat API dalam hitungan menit. Di memori proses: dengan N
 * instance, jatahnya N×5 — masih jauh dari sejuta.
 */
const MAKS_SALAH = 5;
const JENDELA_MS = 15 * 60_000;
const salahPin = new Map<string, { jumlah: number; sampai: number }>();

function terkunci(kunci: string, kini: number): boolean {
  const c = salahPin.get(kunci);
  if (!c || c.sampai <= kini) return false;
  return c.jumlah >= MAKS_SALAH;
}

function catatSalah(kunci: string, kini: number): void {
  const c = salahPin.get(kunci);
  if (!c || c.sampai <= kini) salahPin.set(kunci, { jumlah: 1, sampai: kini + JENDELA_MS });
  else c.jumlah += 1;
}

export async function izinRefundKasir(
  companyId: string,
  pin: string | null | undefined,
  kasirId = "-",
): Promise<string> {
  const kunci = `${companyId}:${kasirId}`;
  const kini = Date.now();
  if (terkunci(kunci, kini)) {
    throw new HTTPException(429, {
      message: "Terlalu banyak PIN salah — coba lagi 15 menit lagi.",
    });
  }
  const penyetuju = await db
    .select({ id: users.id, hash: users.pinRefundHash })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.companyId, companyId),
        inArray(memberships.role, ["owner", "admin"]),
        isNull(memberships.archivedAt),
        eq(users.isActive, true),
        isNull(users.deletedAt),
        isNotNull(users.pinRefundHash),
      ),
    );
  if (penyetuju.length === 0) {
    throw new PinRefundDitolak(
      "pin_refund_belum_diatur",
      "Owner belum mengatur PIN refund — minta owner mengaturnya di Profil",
    );
  }
  if (!pin) {
    throw new PinRefundDitolak("pin_refund_wajib", "Refund oleh kasir butuh PIN owner/admin");
  }
  for (const p of penyetuju) {
    if (p.hash && bcrypt.compareSync(pin, p.hash)) return p.id;
  }
  catatSalah(kunci, kini);
  throw new PinRefundDitolak("pin_refund_salah", "PIN owner/admin salah — refund tidak dilakukan");
}
