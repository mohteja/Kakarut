import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SyncItemResult, SyncResponse } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, memberships, shifts, syncCommands, users } from "../../db/schema";
import { pastikanCabang, terikatCabang, type AppEnv } from "../../middleware/auth";
import { createSale } from "../penjualan/service";
import { SaleBody } from "../penjualan/routes";
import { catatAbsen, cekRadius, ClockBody, SelfBody } from "../absensi/routes";

/** Batas antrean & usia perintah (disepakati dgn tim mobile). */
const MAKS_PERINTAH = 100;
const MAKS_UMUR_HARI = 7;
const SKEW_MENIT = 5;

/** Bentuk minimal auth yang dipakai eksekutor perintah. */
type SyncAuth = {
  sub: string;
  role: "owner" | "admin" | "cashier" | "tim" | null;
  company_id: string | null;
  branch_id: string | null;
  nama: string;
};

const SyncBody = z.object({
  device_id: z.string().nullish(),
  commands: z
    .array(
      z.object({
        client_ref: z.string().uuid(),
        tipe: z.enum(["penjualan", "absen_saya", "absen_stasiun"]),
        waktu: z.string().datetime({ offset: true }),
        payload: z.unknown(),
      }),
    )
    .min(1)
    .max(MAKS_PERINTAH),
});

/**
 * Cabang efektif untuk sebuah perintah sinkron. Peran terikat (kasir/tim)
 * selalu ke cabangnya; owner/admin boleh menyebut cabang di payload (divalidasi
 * milik perusahaan) — default cabang akun.
 */
async function resolveCabangSync(auth: SyncAuth, payloadBranchId?: string | null): Promise<string> {
  if (terikatCabang(auth.role)) {
    if (!auth.branch_id) throw new HTTPException(403, { message: "Akun tanpa cabang" });
    if (payloadBranchId && payloadBranchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Perintah di luar cabang Anda" });
    }
    return auth.branch_id;
  }
  if (payloadBranchId) return pastikanCabang(payloadBranchId, auth.company_id!);
  if (auth.branch_id) return auth.branch_id;
  const [first] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.companyId, auth.company_id!), eq(branches.isActive, true)))
    .orderBy(branches.createdAt)
    .limit(1);
  if (!first) throw new HTTPException(404, { message: "Perusahaan belum punya cabang" });
  return first.id;
}

type Eksekutor = (auth: SyncAuth, payload: unknown, waktu: Date) => Promise<{ kode: number; data: unknown }>;

/** penjualan — kasir; tautkan ke shift yang jendelanya memuat `waktu`. */
const execPenjualan: Eksekutor = async (auth, payload, waktu) => {
  if (auth.role !== "cashier") {
    throw new HTTPException(403, { message: "Hanya kasir yang boleh membuat transaksi" });
  }
  const p = SaleBody.parse(payload);
  const branchId = await resolveCabangSync(auth, p.branch_id);
  // Cari shift kasir (terbuka ATAU tertutup) yang jendela waktunya memuat `waktu`.
  const [shift] = await db
    .select({ id: shifts.id, closedAt: shifts.closedAt })
    .from(shifts)
    .where(
      and(
        eq(shifts.companyId, auth.company_id!),
        eq(shifts.branchId, branchId),
        lte(shifts.openedAt, waktu),
        sql`(${shifts.closedAt} IS NULL OR ${shifts.closedAt} >= ${waktu})`,
      ),
    )
    .orderBy(desc(shifts.openedAt))
    .limit(1);
  if (!shift) {
    throw new HTTPException(409, {
      message: "Tidak ada shift kasir yang mencakup waktu transaksi ini",
    });
  }
  // Transaksi susulan pada shift yang SUDAH ditutup → tandai (rekap dihitung
  // ulang otomatis karena berbasis jendela waktu).
  if (shift.closedAt) {
    await db.update(shifts).set({ adaTransaksiSusulan: true }).where(eq(shifts.id, shift.id));
  }
  const result = await createSale({
    companyId: auth.company_id!,
    branchId,
    cashierUserId: auth.sub,
    isDineIn: p.is_dine_in,
    mejaId: p.meja_id,
    catatan: p.catatan,
    diskonTipe: p.diskon_tipe,
    diskonNilai: p.diskon_nilai,
    bypassDiskonLimit: false,
    customerNama: p.customer_nama,
    customerWa: p.customer_wa,
    metodeBayar: p.metode_bayar,
    uangDiterima: p.uang_diterima,
    waktu,
    items: p.items,
  });
  return { kode: 201, data: { ...result, kasir: auth.nama, ada_transaksi_susulan: shift.closedAt != null } };
};

/** absen_saya — cap atas nama pemanggil sendiri (semua peran). */
const execAbsenSaya: Eksekutor = async (auth, payload, waktu) => {
  const p = SelfBody.parse(payload);
  const branchId = await resolveCabangSync(auth, null);
  const { jarakM, namaCabang } = await cekRadius(branchId, p.lat, p.lng);
  const [m] = await db
    .select({ kode: memberships.employeeCode, nama: users.nama, isActive: users.isActive })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.companyId, auth.company_id!),
        eq(memberships.userId, auth.sub),
        isNull(memberships.archivedAt),
      ),
    );
  if (!m) throw new HTTPException(403, { message: "Akun Anda bukan karyawan aktif cabang ini" });
  if (!m.kode) throw new HTTPException(400, { message: "Kode karyawan Anda belum diatur — hubungi admin" });
  if (!m.isActive) throw new HTTPException(400, { message: "Akun Anda berstatus nonaktif" });
  const result = await catatAbsen({
    companyId: auth.company_id!,
    branchId,
    userId: auth.sub,
    employeeCode: m.kode,
    nama: m.nama,
    namaCabang,
    fotoUrl: p.foto_url,
    jarakM,
    waktu,
  });
  return { kode: 201, data: result };
};

/** absen_stasiun — operator (owner/admin/kasir) memindai kode karyawan. */
const execAbsenStasiun: Eksekutor = async (auth, payload, waktu) => {
  if (auth.role !== "owner" && auth.role !== "admin" && auth.role !== "cashier") {
    throw new HTTPException(403, { message: "Peran Anda tidak boleh memakai stasiun absen" });
  }
  const p = ClockBody.parse(payload);
  const branchId = await resolveCabangSync(auth, null);
  const { jarakM, namaCabang } = await cekRadius(branchId, p.lat, p.lng);
  const kode = p.kode.trim();
  const [m] = await db
    .select({
      userId: memberships.userId,
      kode: memberships.employeeCode,
      nama: users.nama,
      isActive: users.isActive,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.companyId, auth.company_id!),
        sql`upper(${memberships.employeeCode}) = upper(${kode})`,
        isNull(memberships.archivedAt),
      ),
    );
  if (!m) throw new HTTPException(404, { message: `Kode karyawan "${kode}" tidak ditemukan` });
  if (!m.isActive) throw new HTTPException(400, { message: `${m.nama} berstatus nonaktif` });
  const result = await catatAbsen({
    companyId: auth.company_id!,
    branchId,
    userId: m.userId,
    employeeCode: m.kode ?? kode,
    nama: m.nama,
    namaCabang,
    fotoUrl: p.foto_url,
    jarakM,
    waktu,
  });
  return { kode: 201, data: result };
};

const EKSEKUTOR: Record<string, Eksekutor> = {
  penjualan: execPenjualan,
  absen_saya: execAbsenSaya,
  absen_stasiun: execAbsenStasiun,
};

/**
 * Sinkron antrean offline mobile. SATU endpoint generik: menerima batch
 * perintah ber-`client_ref` (idempotency), mengeksekusi tiap perintah lewat
 * logika service yang SUDAH ADA (validasi = aturan endpoint asli), lalu
 * membalas hasil per item. Selalu 200; kegagalan dilaporkan per item.
 */
export const syncRoutes = new Hono<AppEnv>().post("/", zValidator("json", SyncBody), async (c) => {
  const auth = c.get("auth") as SyncAuth;
  const { device_id, commands } = c.req.valid("json");
  const sekarang = Date.now();
  const hasil: SyncItemResult[] = [];

  for (const cmd of commands) {
    // 1) Idempotency: perintah yang sudah tercatat → balas hasil tersimpan, JANGAN eksekusi ulang.
    const [ada] = await db
      .select({ kode: syncCommands.kode, status: syncCommands.status, hasilJson: syncCommands.hasilJson })
      .from(syncCommands)
      .where(and(eq(syncCommands.companyId, auth.company_id!), eq(syncCommands.clientRef, cmd.client_ref)));
    if (ada) {
      hasil.push(
        ada.status === "gagal"
          ? {
              client_ref: cmd.client_ref,
              status: "sudah_ada",
              kode: ada.kode,
              error: (ada.hasilJson as { error?: string } | null)?.error ?? "gagal",
            }
          : { client_ref: cmd.client_ref, status: "sudah_ada", kode: ada.kode, data: ada.hasilJson },
      );
      continue;
    }

    const waktu = new Date(cmd.waktu);
    let item: SyncItemResult;
    let simpanStatus: "ok" | "gagal";
    let simpanKode: number;
    let simpanHasil: unknown;
    try {
      const t = waktu.getTime();
      if (Number.isNaN(t)) throw new HTTPException(400, { message: "waktu tidak valid" });
      if (t > sekarang + SKEW_MENIT * 60_000) {
        throw new HTTPException(400, { message: "waktu kejadian di masa depan" });
      }
      if (t < sekarang - MAKS_UMUR_HARI * 86_400_000) {
        throw new HTTPException(400, { message: `waktu kejadian lebih dari ${MAKS_UMUR_HARI} hari lalu` });
      }
      const exec = EKSEKUTOR[cmd.tipe];
      const { kode, data } = await exec(auth, cmd.payload, waktu);
      item = { client_ref: cmd.client_ref, status: "ok", kode, data };
      simpanStatus = "ok";
      simpanKode = kode;
      simpanHasil = data;
    } catch (e) {
      const kode =
        e instanceof HTTPException ? e.status : e instanceof z.ZodError ? 400 : 500;
      const pesan =
        e instanceof HTTPException
          ? e.message
          : e instanceof z.ZodError
            ? e.issues.map((i) => i.message).join("; ")
            : "Kesalahan server";
      item = { client_ref: cmd.client_ref, status: "gagal", kode, error: pesan };
      simpanStatus = "gagal";
      simpanKode = kode;
      simpanHasil = { error: pesan };
    }

    // 2) Catat hasil ke ledger (exactly-once). onConflictDoNothing melindungi
    // dari balapan retry — bila kalah balapan, item tetap dilaporkan apa adanya.
    await db
      .insert(syncCommands)
      .values({
        companyId: auth.company_id!,
        clientRef: cmd.client_ref,
        deviceId: device_id ?? null,
        userId: auth.sub,
        tipe: cmd.tipe,
        waktu,
        status: simpanStatus,
        kode: simpanKode,
        hasilJson: simpanHasil as object,
      })
      .onConflictDoNothing();
    hasil.push(item);
  }

  return c.json({ hasil } satisfies SyncResponse);
});
