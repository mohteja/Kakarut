import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Tx } from "../../db/client";
import { branches, companies, invitations, memberships } from "../../db/schema";
import { seedKategoriBahanPerusahaan } from "../kategori-bahan/service";
import { seedMejaDefault } from "../meja/defaults";
import { seedUnitsPerusahaan } from "../satuan/service";
import { resolveKodeKaryawan } from "../users/service";

/** Kasir, tim & kitchen wajib punya cabang (mirror aturan Kelola Karyawan). */
const WAJIB_CABANG = new Set(["cashier", "tim", "kitchen"]);

function slugDasar(nama: string): string {
  return nama.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "usaha";
}

/** Slug unik: coba slug dasar, lalu tambah sufiks acak bila sudah dipakai. */
async function slugUnik(tx: Tx, nama: string): Promise<string> {
  const dasar = slugDasar(nama);
  for (let i = 0; i < 20; i += 1) {
    const kandidat = i === 0 ? dasar : `${dasar}-${randomInt(1000, 9999)}`;
    const [ada] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.slug, kandidat));
    if (!ada) return kandidat;
  }
  return `${dasar}-${randomInt(100000, 999999)}`;
}

/**
 * Buat perusahaan baru + cabang Pusat + seed bawaan (meja, satuan, kategori
 * bahan) dan jadikan user sebagai OWNER. Mirror alur admin-tenants tapi
 * self-service (slug auto-unik). Mengembalikan companyId.
 */
export async function buatPerusahaanUntuk(
  tx: Tx,
  opts: { nama: string; userId: string },
): Promise<string> {
  const slug = await slugUnik(tx, opts.nama);
  const [company] = await tx
    .insert(companies)
    .values({ nama: opts.nama, slug, plan: "lite" })
    .returning();
  const [branch] = await tx
    .insert(branches)
    .values({ companyId: company.id, nama: "Pusat" })
    .returning();
  await seedMejaDefault(tx, company.id, branch.id);
  await seedUnitsPerusahaan(tx, company.id);
  await seedKategoriBahanPerusahaan(tx, company.id);
  await tx
    .insert(memberships)
    .values({ userId: opts.userId, companyId: company.id, role: "owner" });
  return company.id;
}

/**
 * Terima satu undangan pending: buat membership utk user + tandai accepted.
 * Idempoten thd membership (bila sudah anggota → pulihkan bila terarsip lalu
 * tandai). Mengembalikan companyId (untuk mengarahkan sesi) atau null bila
 * undangan tak lagi valid.
 */
export async function terimaUndangan(
  tx: Tx,
  invId: string,
  userId: string,
): Promise<string | null> {
  const [inv] = await tx.select().from(invitations).where(eq(invitations.id, invId));
  if (!inv || inv.status !== "pending") return null;
  const [existing] = await tx
    .select({ id: memberships.id, archivedAt: memberships.archivedAt })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.companyId, inv.companyId)));
  if (existing) {
    if (existing.archivedAt) {
      await tx.update(memberships).set({ archivedAt: null }).where(eq(memberships.id, existing.id));
    }
  } else {
    if (WAJIB_CABANG.has(inv.role) && !inv.branchId) {
      throw new HTTPException(400, {
        message: "Cabang undangan sudah tidak ada — minta owner mengundang ulang",
      });
    }
    const employeeCode = await resolveKodeKaryawan(tx, inv.companyId);
    await tx.insert(memberships).values({
      userId,
      companyId: inv.companyId,
      role: inv.role,
      branchId: inv.branchId ?? null,
      employeeCode,
    });
  }
  await tx
    .update(invitations)
    .set({ status: "accepted", acceptedUserId: userId, acceptedAt: new Date() })
    .where(eq(invitations.id, invId));
  return inv.companyId;
}

/**
 * Auto-terima SEMUA undangan pending yang ditujukan ke email user (dipanggil
 * saat daftar / login pertama). Mengembalikan companyId pertama yang diikuti
 * (untuk mengarahkan sesi), atau null bila tak ada undangan.
 */
export async function autoTerimaUndanganEmail(
  tx: Tx,
  userId: string,
  email: string,
): Promise<string | null> {
  const pending = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.email, email), eq(invitations.status, "pending")));
  let pertama: string | null = null;
  for (const p of pending) {
    const cid = await terimaUndangan(tx, p.id, userId);
    if (cid && !pertama) pertama = cid;
  }
  return pertama;
}
