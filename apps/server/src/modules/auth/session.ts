import { and, eq, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import type { AuthUser } from "@kakarut/shared";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { branches, companies, memberships, users } from "../../db/schema";

type UserRow = typeof users.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

function companyDto(co: CompanyRow) {
  return {
    id: co.id,
    nama: co.nama,
    slug: co.slug,
    logo_url: co.logoUrl,
    pb1_enabled: co.pb1Enabled,
    pb1_rate: co.pb1Rate,
    diskon_maks_persen: co.diskonMaksPersen,
    timezone: co.timezone,
  };
}

export interface SesiLogin {
  token: string;
  user: AuthUser;
  company: ReturnType<typeof companyDto> | null;
  branch: { id: string; nama: string } | null;
}

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

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
  return { token, user: payload, company, branch };
}
