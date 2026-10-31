import bcrypt from "bcryptjs";
import { eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db/client";
import { bootFlags, companies, users } from "../db/schema";
import { GUEST, provisionGuest } from "../seed/guest";
import { EMAIL_TAMU_KASIR, EMAIL_TAMU_OWNER } from "./tamu";

/**
 * Hapus SELURUH baris milik satu perusahaan, anak dulu baru induk.
 *
 * `DELETE companies` saja tak cukup: banyak FK ANTAR-tabel perusahaan
 * (mis. `sale_consumptions → branches`) bertipe NO ACTION, dan Postgres
 * menolak cascade yang menyisakan anak sesaat (terukur: 23503 di
 * `sale_consumptions_branch_id_branches_id_fk`). Urutannya dibaca dari katalog
 * Postgres — tabel ber-`company_id` diurutkan topologis menurut FK di antara
 * mereka — jadi tabel baru otomatis ikut tanpa daftar yang bisa basi.
 * Tabel tanpa `company_id` (anak `sales`, dst.) ikut lewat CASCADE induknya.
 */
async function hapusIsiPerusahaan(tx: Tx, companyId: string): Promise<void> {
  const tabel = (
    await tx.execute(sql`
      SELECT c.table_name AS t
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
        AND tb.table_type = 'BASE TABLE' AND c.table_name <> 'companies'
    `)
  ).rows.map((r) => String((r as { t: string }).t));
  const fk = (
    await tx.execute(sql`
      SELECT DISTINCT ch.relname AS anak, pa.relname AS induk, (k.confdeltype = 'c') AS cascade
      FROM pg_constraint k
      JOIN pg_class ch ON ch.oid = k.conrelid
      JOIN pg_class pa ON pa.oid = k.confrelid
      WHERE k.contype = 'f' AND ch.relname <> pa.relname
    `)
  ).rows as { anak: string; induk: string; cascade: boolean }[];
  const himpunan = new Set(tabel);
  const anakDari = new Map<string, Set<string>>();
  const tambahSisi = (induk: string, anak: string) => {
    if (induk === anak) return;
    if (!anakDari.has(induk)) anakDari.set(induk, new Set());
    anakDari.get(induk)!.add(anak);
  };
  // Tabel TANPA company_id (mis. `menu_components`) ikut terhapus lewat CASCADE
  // pemiliknya (`menus`). Kalau ia juga menunjuk tabel perusahaan lain tanpa
  // cascade (`ingredients`), pemiliknya harus dihapus LEBIH DULU dari tabel itu.
  const pemilikCascade = new Map<string, string[]>();
  for (const { anak, induk, cascade } of fk) {
    if (cascade && !himpunan.has(anak) && himpunan.has(induk)) {
      pemilikCascade.set(anak, [...(pemilikCascade.get(anak) ?? []), induk]);
    }
  }
  for (const { anak, induk } of fk) {
    if (!himpunan.has(induk)) continue;
    if (himpunan.has(anak)) tambahSisi(induk, anak);
    else for (const pemilik of pemilikCascade.get(anak) ?? []) tambahSisi(induk, pemilik);
  }
  const sisa = new Set(tabel);
  while (sisa.size > 0) {
    // daun: tabel yang tak lagi punya anak tersisa; siklus → ambil sembarang
    const daun = [...sisa].filter((t) => ![...(anakDari.get(t) ?? [])].some((a) => sisa.has(a)));
    const giliran = daun.length > 0 ? daun : [[...sisa].sort()[0]];
    for (const t of giliran.sort()) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE company_id = ${companyId}`);
      sisa.delete(t);
    }
  }
}

/** Kunci advisory: dua instance server tak me-reset demo bersamaan. */
const KUNCI_RESET_DEMO = 72_310_031;

/**
 * RESET DATA DEMO TAMU — perusahaan demo bersama dikembalikan bersih.
 *
 * Laporan uji 31 Okt 2026: pengunjung meninggalkan member "oppaaaa", meja
 * "Meja 2 demo", dan bill yang tak dibayar 109 jam — calon pelanggan melihat
 * demo yang berantakan. Sejak itu demo DIHAPUS lalu DIPROVISI ULANG tiap malam.
 *
 * Satu `DELETE` perusahaan cukup: 45 dari 46 FK ke `companies` ber-CASCADE
 * (sisanya `error_logs`, SET NULL). Baris user tamu sengaja bertahan —
 * `provisionGuest` membuat ulang keanggotaannya — tapi password & versi
 * tokennya dipulihkan, jadi sisa perubahan apa pun ikut terhapus. Penanda
 * `demo_tamu_v2` dibuang supaya data demo lengkap ditanam lagi.
 *
 * Tamu yang sedang memegang token lama otomatis keluar (keanggotaannya lenyap
 * → 401) dan tinggal menekan tombol Tamu lagi.
 */
export async function resetDataDemo(): Promise<{ direset: boolean }> {
  return db.transaction(async (tx) => {
    const [kunci] = (
      await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${KUNCI_RESET_DEMO}) AS dapat`)
    ).rows as { dapat: boolean }[];
    if (!kunci?.dapat) return { direset: false };
    const [co] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.slug, GUEST.slug));
    if (co) await hapusIsiPerusahaan(tx, co.id);
    await tx.delete(companies).where(eq(companies.slug, GUEST.slug));
    await tx.delete(bootFlags).where(eq(bootFlags.key, "demo_tamu_v2"));
    await tx
      .update(users)
      .set({
        passwordHash: bcrypt.hashSync(GUEST.password, 10),
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(inArray(users.email, [EMAIL_TAMU_OWNER, EMAIL_TAMU_KASIR]));
    return { direset: true };
  }).then(async (h) => {
    // Provisi di luar transaksi hapus: `provisionGuest` membuka transaksinya
    // sendiri dan menanam ±40 penjualan lewat `createSale`.
    if (h.direset) await provisionGuest(db);
    return h;
  });
}

let terakhirTanggal: string | null = null;

/**
 * Penjadwal harian — pola `jadwalkanPangkasToken`: tick tiap jam, jalan sekali
 * sehari pada `jamWib`. `jamWib < 0` mematikannya.
 */
export function jadwalkanResetDemo(jamWib: number): void {
  if (jamWib < 0) return;
  const jalankanBilaPerlu = async () => {
    const wib = new Date(Date.now() + 7 * 3_600_000);
    const tanggal = wib.toISOString().slice(0, 10);
    if (terakhirTanggal === tanggal) return;
    if (wib.getUTCHours() !== jamWib) return;
    try {
      const h = await resetDataDemo();
      terakhirTanggal = tanggal;
      if (h.direset) console.log("Reset demo tamu: perusahaan demo diprovisi ulang.");
    } catch (e) {
      console.error("Reset demo tamu gagal:", e instanceof Error ? e.message : String(e));
    }
  };
  setInterval(() => void jalankanBilaPerlu(), 3_600_000).unref();
}
