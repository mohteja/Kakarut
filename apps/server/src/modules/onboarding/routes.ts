import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { OnboardingStatus, UndanganDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, invitations, memberships, users } from "../../db/schema";
import { requireAuth, verifikasiPassword, type AppEnv } from "../../middleware/auth";
import { buatSesi } from "../auth/session";
import { buatPerusahaanUntuk, terimaUndangan } from "./service";

/** Apakah user punya minimal satu keanggotaan AKTIF (perusahaan aktif + belum diarsip). */
async function punyaPerusahaan(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(companies, eq(memberships.companyId, companies.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(companies.isActive, true),
        isNull(memberships.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Undangan pending yang ditujukan ke email user. */
async function undanganUntuk(email: string): Promise<UndanganDto[]> {
  const rows = await db
    .select({
      id: invitations.id,
      company_nama: companies.nama,
      role: invitations.role,
      cabang_nama: branches.nama,
      diundang_pada: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(companies, eq(invitations.companyId, companies.id))
    .leftJoin(branches, eq(invitations.branchId, branches.id))
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.status, "pending"),
        eq(companies.isActive, true),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    company_nama: r.company_nama,
    role: r.role,
    cabang_nama: r.cabang_nama,
    diundang_pada: r.diundang_pada.toISOString(),
  }));
}

/**
 * Onboarding user tanpa perusahaan (butuh login, TIDAK butuh perusahaan) +
 * lifecycle akun sendiri (hapus akun). Dipakai setelah daftar/login: buat
 * perusahaan sendiri ATAU terima undangan yang menunggu.
 */
export const onboardingRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/status", async (c) => {
    const auth = c.get("auth");
    const [has, undangan] = await Promise.all([
      punyaPerusahaan(auth.sub),
      undanganUntuk(auth.email),
    ]);
    const status: OnboardingStatus = { has_company: has, email: auth.email, undangan };
    return c.json(status);
  })
  // Buat perusahaan sendiri → jadi OWNER → sesi baru diarahkan ke perusahaan itu.
  .post(
    "/perusahaan",
    zValidator("json", z.object({ nama: z.string().trim().min(1, "Nama usaha wajib diisi") })),
    async (c) => {
      const auth = c.get("auth");
      if (auth.is_super_admin) {
        throw new HTTPException(403, { message: "Super admin tidak membuat perusahaan sendiri" });
      }
      const companyId = await db.transaction((tx) =>
        buatPerusahaanUntuk(tx, { nama: c.req.valid("json").nama, userId: auth.sub }),
      );
      const [user] = await db.select().from(users).where(eq(users.id, auth.sub));
      return c.json(await buatSesi(user, companyId), 201);
    },
  )
  // Terima undangan → jadi anggota perusahaan itu → sesi baru diarahkan ke sana.
  .post("/undangan/:id/terima", async (c) => {
    const auth = c.get("auth");
    const invId = c.req.param("id");
    // undangan harus ditujukan ke email pemanggil
    const [inv] = await db
      .select({ email: invitations.email, status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invId));
    if (!inv || inv.email !== auth.email) {
      throw new HTTPException(404, { message: "Undangan tidak ditemukan" });
    }
    if (inv.status !== "pending") {
      throw new HTTPException(400, { message: "Undangan sudah tidak berlaku" });
    }
    const companyId = await db.transaction((tx) => terimaUndangan(tx, invId, auth.sub));
    /*
     * null = undangannya sudah tidak `pending` saat barisnya berhasil dikunci,
     * yaitu penerimaan berbarengan yang kalah. Dibalas SAMA PERSIS dengan
     * pemeriksaan awal di atas, supaya klien tak melihat perilaku baru — dan
     * bukan dibiarkan lewat, sebab sesi tanpa `companyId` akan memulangkan
     * orang yang sebenarnya SUDAH jadi anggota ke layar "belum punya
     * perusahaan".
     */
    if (companyId === null) {
      throw new HTTPException(400, { message: "Undangan sudah tidak berlaku" });
    }
    const [user] = await db.select().from(users).where(eq(users.id, auth.sub));
    return c.json(await buatSesi(user, companyId));
  })
  // Tolak undangan (milik email pemanggil).
  .post("/undangan/:id/tolak", async (c) => {
    const auth = c.get("auth");
    const invId = c.req.param("id");
    const [inv] = await db
      .select({ email: invitations.email, status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invId));
    if (!inv || inv.email !== auth.email) {
      throw new HTTPException(404, { message: "Undangan tidak ditemukan" });
    }
    /*
     * Syarat `pending` ikut di WHERE, bukan cuma diperiksa di atas.
     *
     * Sejak penerimaan undangan mengunci barisnya (`FOR UPDATE`), penolakan
     * yang datang bersamaan akan MENUNGGU kunci itu — lalu, tanpa syarat di
     * sini, menimpa status yang baru saja jadi `accepted`. Hasilnya jejak yang
     * saling bertentangan: membership-nya sah terbentuk, tapi undangannya
     * tercatat `revoked`.
     *
     * Dengan syaratnya, penolakan yang kalah mencocokkan NOL baris dan menjadi
     * no-op — yang memang perilaku benar: undangan yang sudah diterima tak bisa
     * ditolak lagi, dan pemanggil tetap dibalas ok seperti sebelumnya.
     */
    if (inv.status === "pending") {
      await db
        .update(invitations)
        .set({ status: "revoked" })
        .where(and(eq(invitations.id, invId), eq(invitations.status, "pending")));
    }
    return c.json({ ok: true });
  })
  // Hapus akun sendiri (SOFT delete): butuh konfirmasi password. Diblokir bila
  // pemanggil adalah OWNER terakhir sebuah perusahaan (harus serahkan/hapus dulu).
  .delete("/akun", zValidator("json", z.object({ password: z.string() })), async (c) => {
    const auth = c.get("auth");
    if (auth.is_super_admin) {
      throw new HTTPException(400, { message: "Akun super admin tidak bisa dihapus dari sini" });
    }
    await verifikasiPassword(auth.sub, c.req.valid("json").password);

    // Owner terakhir? Cari perusahaan tempat pemanggil owner AKTIF; bila ada yang
    // tak punya owner aktif lain → blokir dengan menyebut nama perusahaannya.
    const ownerDi = await db
      .select({ companyId: memberships.companyId, nama: companies.nama })
      .from(memberships)
      .innerJoin(companies, eq(memberships.companyId, companies.id))
      .where(
        and(
          eq(memberships.userId, auth.sub),
          eq(memberships.role, "owner"),
          isNull(memberships.archivedAt),
          eq(companies.isActive, true),
        ),
      );
    for (const co of ownerDi) {
      const [{ lain }] = await db
        .select({ lain: sql<number>`count(*)::int` })
        .from(memberships)
        .where(
          and(
            eq(memberships.companyId, co.companyId),
            eq(memberships.role, "owner"),
            isNull(memberships.archivedAt),
            ne(memberships.userId, auth.sub),
          ),
        );
      if (lain === 0) {
        throw new HTTPException(400, {
          message: `Anda owner terakhir "${co.nama}". Serahkan kepemilikan ke owner lain atau hapus perusahaan dulu sebelum menghapus akun.`,
        });
      }
    }

    await db.transaction(async (tx) => {
      // arsipkan semua keanggotaan (keluar dari perusahaan, riwayat tetap)
      await tx
        .update(memberships)
        .set({ archivedAt: new Date() })
        .where(and(eq(memberships.userId, auth.sub), isNull(memberships.archivedAt)));
      // batalkan undangan yang masih menunggu untuk email ini
      await tx
        .update(invitations)
        .set({ status: "revoked" })
        .where(and(eq(invitations.email, auth.email), eq(invitations.status, "pending")));
      // tombstone user: nonaktif + deletedAt + email di-rename agar bebas dipakai ulang
      await tx
        .update(users)
        .set({
          isActive: false,
          deletedAt: new Date(),
          email: sql`'deleted:' || ${auth.sub} || ':' || ${users.email}`,
        })
        .where(eq(users.id, auth.sub));
    });
    return c.json({ ok: true });
  });
