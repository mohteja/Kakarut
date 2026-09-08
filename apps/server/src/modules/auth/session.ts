import { and, eq, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import type { AuthUser, CompanyDto, SesiLogin } from "@kakarut/shared";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { branches, companies, memberships, users } from "../../db/schema";

type UserRow = typeof users.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

/**
 * SATU-SATUNYA penulis bentuk `company` yang dilihat klien. `GET /auth/me`
 * sempat merakit objek yang sama sendiri (dua penulis satu bentuk — cara
 * sebuah medan hilang dari salah satunya tanpa suara); kini ia memanggil
 * fungsi ini. Bentuknya dipaku `CompanyDto` di shared dan dijaga
 * `sesi-cabang-dto-utuh.test.ts` + verify-api §296.
 */
export function companyDto(co: CompanyRow): CompanyDto {
  return {
    id: co.id,
    nama: co.nama,
    slug: co.slug,
    logo_url: co.logoUrl,
    pb1_enabled: co.pb1Enabled,
    pb1_rate: co.pb1Rate,
    diskon_maks_persen: co.diskonMaksPersen,
    // Kasir perlu tahu setelan ini untuk MEMPERINGATKAN sebelum tombol
    // Bayar ditekan; penegakannya tetap di server.
    blokir_jual_minus: co.blokirJualMinus,
    timezone: co.timezone,
  };
}

// `SesiLogin` kini di `@kakarut/shared` (Lampiran A) — satu bentuk untuk
// server, web, dan ponsel; sampai 2026-09-05 ia hidup di sini saja.

/**
 * Bangun sesi login (token JWT + user + company + branch) untuk seorang user.
 * Resolusi perusahaan: keanggotaan AKTIF (perusahaan aktif + belum diarsip).
 * User tanpa keanggotaan aktif → sesi TANPA perusahaan (company null) → frontend
 * mengarahkannya ke onboarding (buat perusahaan / terima undangan). Bila
 * `preferredCompanyId` diberikan (mis. setelah buat perusahaan / terima
 * undangan), sesi diarahkan ke perusahaan itu.
 */
export async function buatSesi(user: UserRow, preferredCompanyId?: string): Promise<SesiLogin> {
  let payload: AuthUser = {
    sub: user.id,
    email: user.email,
    nama: user.nama,
    is_super_admin: user.isSuperAdmin,
    company_id: null,
    role: null,
    branch_id: null,
  };
  let company: ReturnType<typeof companyDto> | null = null;
  let branch: { id: string; nama: string } | null = null;

  if (!user.isSuperAdmin) {
    const rows = await db
      .select()
      .from(memberships)
      .innerJoin(companies, eq(memberships.companyId, companies.id))
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(companies.isActive, true),
          isNull(memberships.archivedAt),
        ),
      );
    const m =
      (preferredCompanyId && rows.find((r) => r.memberships.companyId === preferredCompanyId)) ||
      rows[0];
    if (m) {
      payload = {
        ...payload,
        company_id: m.memberships.companyId,
        role: m.memberships.role,
        branch_id: m.memberships.branchId,
      };
      company = companyDto(m.companies);
      if (m.memberships.branchId) {
        const [b] = await db
          .select({ id: branches.id, nama: branches.nama })
          .from(branches)
          .where(eq(branches.id, m.memberships.branchId));
        branch = b ?? null;
      }
    }
  }

  // Klaim `tv` (token version) menyertai token agar bisa dibatalkan saat
  // password berubah — divalidasi di requireAuth. Tidak ikut di `payload`
  // (AuthUser) yang dikembalikan ke klien: klien menyimpan token apa adanya.
  const token = jwt.sign({ ...payload, tv: user.tokenVersion }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
  return { token, user: payload, company, branch };
}
