import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { customers } from "../../db/schema";

/**
 * Bentuk KANONIK sebuah nomor Indonesia: selalu berawalan `62`.
 *
 * Satu nomor yang sama lazim ditulis tiga cara di kasir, dan ketiganya benar
 * menurut orang yang mengetiknya:
 *
 *     0812-3456-7890     →  081234567890
 *     +62 812-3456-7890  →  6281234567890
 *     +62 0812-3456-7890 →  62081234567890   (sering — label "+62" sudah
 *                                             tercetak di form, lalu diketik 0)
 *
 * Membuang non-digit saja menyisakan TIGA kunci berbeda untuk SATU orang, dan
 * `customers_company_wa_uq` di `(company_id, wa)` lalu dengan patuh membuat
 * tiga baris member. Riwayat belanja tamu paling setia justru yang paling
 * terbelah, karena dialah yang paling sering diketik ulang.
 *
 * SENGAJA TIDAK melipat awalan `8` telanjang (mis. `81234567890`). Itu memang
 * bentuk Indonesia yang wajar saat angka 0-nya hilang, tapi melipatnya akan
 * ikut merusak nomor negara lain yang sah berawalan 8 — `86…` (Tiongkok)
 * berubah jadi `6286…`. Yang dilipat hanya yang tak punya tafsir lain.
 */
export function bentukKanonikWa(digits: string): string {
  if (digits.startsWith("620")) return `62${digits.slice(3)}`;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

/**
 * Seluruh bentuk setara dari sebuah nomor — dari bentuk ketikan APA PUN.
 *
 * Dipakai MENCOCOKKAN, bukan menyimpan. Bedanya penting: yang tersimpan tetap
 * apa adanya (digit saja, seperti yang diketik), dan hanya PENCARIANNYA yang
 * melebar ke seluruh bentuk setara.
 *
 * Itu disengaja. Bentuk simpan adalah KONTRAK — ia mengalir ke DTO, halaman
 * Member, autocomplete `member-cari` yang mencocokkan `ilike '%q%'` atas digit
 * mentah yang diketik kasir, dan aplikasi mobile. Mengkanonikkan yang
 * tersimpan akan membuat kasir yang mengetik `0812` tak lagi menemukan member
 * yang nomornya memang diketik `0812…` — memperbaiki dedup dengan merusak
 * pencarian, dan yang kedua jauh lebih sering dipakai.
 */
export function varianWa(digits: string): string[] {
  const kanonik = bentukKanonikWa(digits);
  const set = new Set<string>([digits, kanonik]);
  if (kanonik.startsWith("62")) {
    const tanpaKode = kanonik.slice(2);
    set.add(`0${tanpaKode}`);
    set.add(`620${tanpaKode}`);
  }
  return [...set];
}

/**
 * Normalisasi nomor WhatsApp → hanya digit (buang spasi/tanda/+). Dipakai
 * sebagai identitas member per perusahaan (dedup). Mengembalikan null bila
 * kosong / terlalu pendek untuk dianggap valid.
 *
 * SENGAJA tidak dikanonikkan — lihat `varianWa`. Yang menyatukan `0812…` dan
 * `+62812…` menjadi satu member adalah pencocokannya, bukan bentuk simpannya.
 */
export function normalizeWa(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

/**
 * Member yang setara dengan nomor ini — dalam bentuk tersimpan apa pun.
 *
 * Bila sebuah perusahaan terlanjur punya DUA baris untuk orang yang sama
 * (peninggalan sebelum kanonikalisasi), yang dipilih adalah yang TERTUA:
 * dialah yang memikul riwayat terpanjang, dan pilihannya harus deterministik
 * supaya dua kasir tak menulis ke baris yang berbeda.
 */
export async function cariCustomerSetara(
  exec: Db | Tx,
  companyId: string,
  wa: string,
  kecualiId?: string,
): Promise<{ id: string; nama: string; wa: string } | null> {
  const rows = await exec
    .select({ id: customers.id, nama: customers.nama, wa: customers.wa })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), inArray(customers.wa, varianWa(wa))))
    .orderBy(asc(customers.createdAt));
  const dipakai = kecualiId ? rows.filter((r) => r.id !== kecualiId) : rows;
  return dipakai[0] ?? null;
}

/**
 * Cari-atau-buat member berdasarkan WA (dalam transaksi checkout). Bila WA
 * kosong/invalid → tidak membuat member (mengembalikan null). Nama diperbarui
 * ke yang terbaru. Mengembalikan { id, nama, wa } untuk snapshot pada sale.
 */
export async function upsertCustomer(
  tx: Tx,
  companyId: string,
  nama: string | null | undefined,
  waRaw: string | null | undefined,
): Promise<{ id: string; nama: string; wa: string } | null> {
  const wa = normalizeWa(waRaw);
  if (!wa) return null;
  const namaBersih = nama?.trim() || "Pelanggan";

  // Yang sudah ada menang — dalam bentuk tersimpan apa pun. Tanpa langkah ini,
  // tamu yang tadi diketik `0812…` dan kini `+62812…` jadi member kedua.
  const lama = await cariCustomerSetara(tx, companyId, wa);
  if (lama) {
    await tx
      .update(customers)
      .set({ nama: namaBersih, updatedAt: new Date() })
      .where(eq(customers.id, lama.id));
    return { id: lama.id, nama: namaBersih, wa: lama.wa };
  }

  // Benar-benar baru. `onConflictDoUpdate` TETAP dipertahankan: pencarian di
  // atas adalah cek-lalu-tulis, dan dua checkout serempak untuk tamu baru yang
  // sama akan sama-sama meleset lalu sama-sama menyisip. Indeks uniknya yang
  // memutuskan; tanpa ini yang kalah gagal 23505 di tengah pembayaran.
  const [row] = await tx
    .insert(customers)
    .values({ companyId, nama: namaBersih, wa })
    .onConflictDoUpdate({
      target: [customers.companyId, customers.wa],
      set: { nama: namaBersih, updatedAt: new Date() },
    })
    .returning({ id: customers.id, nama: customers.nama, wa: customers.wa });
  return row ?? null;
}

/** Ambil satu member (company-scoped) atau null. */
export async function getCustomer(tx: Tx, companyId: string, id: string) {
  const [row] = await tx.select().from(customers).where(eq(customers.id, id));
  if (!row || row.companyId !== companyId) return null;
  return row;
}
