import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import jwt from "jsonwebtoken";
import type { AuthUser, UserRole } from "@kakarut/shared";
import { env } from "../config/env";
import { db } from "../db/client";
import { branches, companies, memberships, users } from "../db/schema";

export type AppEnv = { Variables: { auth: AuthUser } };

/**
 * Verifikasi password login akun (dipakai konfirmasi aksi merusak: hapus/edit
 * transaksi). Lempar 401 bila akun tak ada/nonaktif atau password salah.
 */
export async function verifikasiPassword(userId: string, password: string): Promise<void> {
  if (!password) throw new HTTPException(401, { message: "Password wajib diisi" });
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.isActive || !bcrypt.compareSync(password, user.passwordHash)) {
    throw new HTTPException(401, { message: "Password salah" });
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Perlu login (token tidak ada)" });
  }
  let payload: AuthUser & { tv?: number };
  try {
    // Pin algoritma HMAC (hindari kejutan alg-confusion di masa depan).
    payload = jwt.verify(header.slice(7), env.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as AuthUser & { tv?: number };
  } catch {
    throw new HTTPException(401, { message: "Token tidak valid atau kedaluwarsa" });
  }

  // Validasi sesi terhadap keadaan TERKINI di database — bukan hanya isi token.
  // Token menyimpan peran/perusahaan/cabang dan berumur panjang; tanpa cek ini,
  // user yang dinonaktifkan/dihapus, keanggotaan yang diarsipkan, atau
  // perubahan peran/cabang baru berlaku setelah token kedaluwarsa (bisa 12 jam).
  // Di sini akses "basi" ditolak seketika dan peran/cabang disegarkan dari DB.
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      nama: users.nama,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      isSuperAdmin: users.isSuperAdmin,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .where(eq(users.id, payload.sub));
  if (!u || u.deletedAt || !u.isActive) {
    throw new HTTPException(401, { message: "Sesi tidak berlaku lagi — silakan masuk kembali" });
  }

  // Pembatalan token saat password berubah: klaim `tv` di token harus sama
  // dengan `users.token_version` terkini. Password diubah → versi DB naik →
  // token lama (tv < versi) langsung ditolak. Token lama TANPA `tv` (sebelum
  // fitur ini) dianggap 0 → tetap sah selama versi masih 0.
  const tokenTv = typeof payload.tv === "number" ? payload.tv : 0;
  if (tokenTv !== u.tokenVersion) {
    throw new HTTPException(401, { message: "Sesi tidak berlaku lagi — silakan masuk kembali" });
  }

  // Super admin platform: tanpa perusahaan.
  if (u.isSuperAdmin) {
    c.set("auth", {
      sub: u.id,
      email: u.email,
      nama: u.nama,
      is_super_admin: true,
      company_id: null,
      role: null,
      branch_id: null,
    });
    return next();
  }

  // Sesi tanpa perusahaan (baru daftar / menunggu onboarding) tetap sah.
  if (!payload.company_id) {
    c.set("auth", {
      sub: u.id,
      email: u.email,
      nama: u.nama,
      is_super_admin: false,
      company_id: null,
      role: null,
      branch_id: null,
    });
    return next();
  }

  // Ada perusahaan di token → keanggotaan AKTIF wajib masih ada (perusahaan
  // aktif + keanggotaan belum diarsip). Peran & cabang diambil ULANG dari DB.
  const [m] = await db
    .select({ role: memberships.role, branchId: memberships.branchId })
    .from(memberships)
    .innerJoin(companies, eq(memberships.companyId, companies.id))
    .where(
      and(
        eq(memberships.userId, u.id),
        eq(memberships.companyId, payload.company_id),
        isNull(memberships.archivedAt),
        eq(companies.isActive, true),
      ),
    );
  if (!m) {
    throw new HTTPException(401, { message: "Akses ke perusahaan ini sudah tidak berlaku" });
  }
  c.set("auth", {
    sub: u.id,
    email: u.email,
    nama: u.nama,
    is_super_admin: false,
    company_id: payload.company_id,
    role: m.role,
    branch_id: m.branchId,
  });
  return next();
};

/** Rute internal perusahaan — butuh keanggotaan (bukan super admin tanpa tenant). */
export const requireCompany: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get("auth");
  if (!auth.company_id) {
    throw new HTTPException(403, { message: "Akun ini tidak terhubung ke perusahaan" });
  }
  await next();
};

export const requireRole = (...roles: UserRole[]): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth.role || !roles.includes(auth.role)) {
      throw new HTTPException(403, { message: "Peran Anda tidak diizinkan mengakses ini" });
    }
    await next();
  };
};

export const requireSuperAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("auth").is_super_admin) {
    throw new HTTPException(403, { message: "Hanya super admin platform" });
  }
  await next();
};

/** Pastikan cabang milik perusahaan; lempar 404 bila bukan. */
export async function pastikanCabang(branchId: string, companyId: string): Promise<string> {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
  if (!b) throw new HTTPException(404, { message: "Cabang tidak ditemukan" });
  return b.id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CABANG PILIHAN DARI QUERY — satu-satunya pintu untuk `?branch_id=` pada rute
 * yang artinya "tanpa param = semua cabang".
 *
 * Bedanya dengan `resolveBranchId`: di sana tak menyebut cabang berarti "cabang
 * aktif pertama", jadi selalu ada SATU cabang. Di sini tak menyebut cabang (dan
 * `all`) berarti TAK menyaring sama sekali. Dua arti yang sah, dua pintu — yang
 * tidak boleh berbeda adalah apa yang terjadi pada nilai yang DISEBUT.
 *
 * Dulu berbeda, dan terukur. Delapan rute menyusun sendiri saringannya dari
 * `c.req.query("branch_id")`, dan tak satu pun memeriksa cabangnya milik
 * perusahaan ini. Dengan owner Basooopa dan `?branch_id=` sebuah UUID cabang
 * perusahaan LAIN (2026-08-23, HTTP sungguhan):
 *
 *     GET  /meja                        → 404 "Cabang tidak ditemukan"   ← aturannya
 *     GET  /menu                        → 200, 80 dari 81 menu (satu hilang diam-diam)
 *     GET  /perlengkapan/beli           → 200, 0 dari 53 baris
 *     GET  /kebersihan/area             → 200, 2 dari 3 area
 *     GET  /pengajuan                   → 200, 0 baris
 *     GET  /absensi/rekap               → 200, 0 baris
 *     POST /perlengkapan/beli/batal-semua → 200 {"ok":true,"jumlah":0}
 *
 * Yang terakhir itu intinya: operasi MASSAL yang melaporkan sukses atas cabang
 * yang tak ada. Tak ada kebocoran lintas-perusahaan — `company_id` selalu ikut
 * di WHERE — tapi amannya datang dari konjungsi lain, bukan dari aturannya. Itu
 * persis yang sudah ditulis komentar `cabangTujuanPenulisan` di bawah: aman
 * yang bergantung pada gerbang di tempat lain adalah aman yang bisa hilang
 * tanpa ada yang menyadarinya.
 *
 * Bentuk UUID diperiksa lebih dulu supaya nilai sampah jadi 400 yang bisa
 * ditindaklanjuti, bukan 22P02 dari Postgres yang diterjemahkan belakangan
 * (dan ikut mengotori panel galat).
 *
 * Memulangkan `null` bila tak menyaring.
 */
export async function cabangDariQuery(c: Context<AppEnv>): Promise<string | null> {
  const v = c.req.query("branch_id");
  if (!v || v === "all") return null;
  if (!UUID_RE.test(v)) {
    throw new HTTPException(400, { message: "branch_id bukan UUID yang sah" });
  }
  return pastikanCabang(v, c.get("auth").company_id!);
}

/**
 * Peran yang TERIKAT ke satu cabang (kasir, tim, kitchen & bar) — selalu
 * terkunci ke cabangnya sendiri; owner/admin bebas lintas cabang.
 */
export function terikatCabang(role: string | null): boolean {
  return role === "cashier" || role === "tim" || role === "kitchen" || role === "bar";
}

/**
 * Cabang aktif untuk request ini: kasir/tim selalu terkunci ke cabangnya;
 * owner/admin boleh memilih via ?branch_id= (divalidasi milik perusahaan),
 * default cabang pertama.
 */
export async function resolveBranchId(c: Context<AppEnv>): Promise<string> {
  const auth = c.get("auth");
  if (terikatCabang(auth.role)) {
    if (!auth.branch_id) throw new HTTPException(403, { message: "Akun tanpa cabang" });
    return auth.branch_id;
  }
  const q = c.req.query("branch_id");
  if (q) return pastikanCabang(q, auth.company_id!);
  const [first] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.companyId, auth.company_id!), eq(branches.isActive, true)))
    .orderBy(branches.createdAt)
    .limit(1);
  if (!first) throw new HTTPException(404, { message: "Perusahaan belum punya cabang" });
  return first.id;
}

/**
 * CABANG TUJUAN SATU PENULISAN — satu-satunya pintu untuk `branch_id` di BADAN
 * permintaan.
 *
 * Dua hal sekaligus, dan keduanya harus terjadi bersama:
 *
 * 1. `branch_id` kiriman klien DIVALIDASI milik perusahaan ini
 *    (`pastikanCabang`), bukan dipakai apa adanya;
 * 2. peran yang terikat cabang DITOLAK bila menunjuk cabang lain.
 *
 * Aturan ini sebelumnya ditulis ulang di TUJUH handler, dan salinannya tidak
 * seragam: dua di antaranya (`/penjualan`, `/open-bill`) memakai
 * `body.branch_id ?? …` tanpa validasi, sehingga aman HANYA karena gerbang
 * perannya menuntut `cashier` — dan kasir kebetulan selalu terikat cabang.
 * Aman yang bergantung pada gerbang di berkas lain adalah aman yang bisa
 * hilang tanpa ada yang menyadarinya: menambahkan `"owner"` ke `requireRole`
 * di salah satu rute itu cukup untuk membukanya, dan tak ada satu pun uji yang
 * akan berubah warna.
 *
 * `pesanTolak` dioper karena pesannya memang berbeda per pintu ("hanya boleh
 * transaksi di cabangnya", "…menambah meja…", "…opname…"). Yang disatukan
 * ATURANNYA, bukan kalimatnya — kalimat yang diseragamkan justru membuat yang
 * ditolak menebak pintu mana yang menolaknya.
 */
export async function branchUntukTulis(
  c: Context<AppEnv>,
  bodyBranchId: string | undefined,
  pesanTolak: string,
): Promise<string> {
  const auth = c.get("auth");
  const branchId = bodyBranchId
    ? await pastikanCabang(bodyBranchId, auth.company_id!)
    : await resolveBranchId(c);
  if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
    throw new HTTPException(403, { message: pesanTolak });
  }
  return branchId;
}
