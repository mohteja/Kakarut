import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SyncItemResult, SyncResponse } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, memberships, shifts, syncCommands, users } from "../../db/schema";
import { env } from "../../config/env";
import { tanggalDi } from "../../lib/time";
import { pastikanCabang, terikatCabang, type AppEnv } from "../../middleware/auth";
import { lewatiRateLimit, rateLimit } from "../../middleware/rateLimit";
import { createSale } from "../penjualan/service";
import { SaleBody } from "../penjualan/routes";
import { catatAbsen, cekRadius, ClockBody, SelfBody } from "../absensi/routes";

/** Batas antrean & usia perintah (disepakati dgn tim mobile). */
const MAKS_PERINTAH = 100;
/**
 * Usia maksimal perintah, per tipe. `penjualan` sengaja jauh lebih longgar:
 * uangnya sudah diterima kasir, jadi menolak antrean lama = transaksi hilang
 * permanen. Perangkat cadangan / outlet event bisa offline berminggu-minggu.
 * Tipe lain tetap 7 hari — mengubah stok jauh ke belakang justru berbahaya.
 */
const MAKS_UMUR_HARI: Record<string, number> = { penjualan: 30 };
const MAKS_UMUR_HARI_DEFAULT = 7;
const SKEW_MENIT = 5;
/**
 * Toleransi transaksi susulan: sale yang `waktu`-nya jatuh SETELAH sebuah shift
 * ditutup masih dibukukan ke shift itu selama tidak lebih dari sekian jam dan
 * masih di tanggal bisnis yang sama. Menutup celah "shift ditutup dari web/
 * perangkat lain sementara kasir offline masih melayani".
 */
export const SUSULAN_TOLERANSI_JAM = 6;

/**
 * Boleh-tidaknya sebuah sale dibukukan ke shift yang SUDAH ditutup.
 *
 * Dua syarat, keduanya wajib:
 * - jeda dari penutupan tidak lebih dari `SUSULAN_TOLERANSI_JAM`;
 * - masih tanggal bisnis yang sama (zona waktu perusahaan) — supaya transaksi
 *   dini hari tidak nyasar ke shift hari sebelumnya.
 *
 * Fungsi murni agar batasnya bisa diuji tanpa database; pemanggilnya di
 * `execPenjualan` hanya menyediakan datanya.
 */
export function dalamToleransiSusulan(waktu: Date, closedAt: Date, tz: string): boolean {
  if (waktu.getTime() < closedAt.getTime()) return false; // bukan susulan
  const jedaOk = waktu.getTime() <= closedAt.getTime() + SUSULAN_TOLERANSI_JAM * 3_600_000;
  return jedaOk && tanggalDi(tz, waktu) === tanggalDi(tz, closedAt);
}

/**
 * Kegagalan perintah sinkron yang membawa sebab terstruktur + data lanjutan.
 * `HTTPException` biasa hanya membawa teks; mobile butuh tahu BEDA penyebab
 * 409 agar bisa menawarkan aksi lanjutan, bukan sekadar menampilkan pesan.
 */
class SyncGagal extends Error {
  constructor(
    readonly kode: number,
    message: string,
    readonly sebab: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "SyncGagal";
  }
}

/**
 * Referensi aplikasi utk sub-request internal (Fase 2): perintah dieksekusi
 * dengan MEMANGGIL ULANG endpoint aslinya lewat router yang sama (middleware +
 * guard + handler berjalan apa adanya) — "pembungkus, bukan jalan pintas".
 * Disuntik dari createApp() untuk menghindari import melingkar.
 */
let appRef: { fetch: (req: Request) => Response | Promise<Response> } | null = null;
export function setSyncApp(a: { fetch: (req: Request) => Response | Promise<Response> }) {
  appRef = a;
}

/** Bentuk minimal auth yang dipakai eksekutor perintah. */
type SyncAuth = {
  sub: string;
  role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar" | null;
  company_id: string | null;
  branch_id: string | null;
  nama: string;
};
type ExecCtx = { auth: SyncAuth; authHeader: string };
type Eksekutor = (ctx: ExecCtx, payload: unknown, waktu: Date) => Promise<{ kode: number; data: unknown }>;

const SyncBody = z.object({
  device_id: z.string().nullish(),
  commands: z
    .array(
      z.object({
        client_ref: z.string().uuid(),
        tipe: z.enum([
          "penjualan",
          "absen_saya",
          "absen_stasiun",
          "stok_opname",
          "perlengkapan_opname",
          "perlengkapan_pakai",
          "faktur_tahap",
          "faktur_kirim",
          "produksi_kirim_hasil",
          "penerimaan_terima",
          "penerimaan_terima_sebagian",
          "penerimaan_tolak",
        ]),
        waktu: z.string().datetime({ offset: true }),
        payload: z.unknown(),
      }),
    )
    .min(1)
    .max(MAKS_PERINTAH),
});

/** Cabang efektif utk perintah sinkron (peran terikat → cabangnya). */
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

/**
 * Sub-request internal ke endpoint asli (di bawah /api). Meneruskan token
 * pemanggil → middleware auth/company + role guard + handler asli berjalan.
 * Mengembalikan {kode, data} (kode ≥ 400 dianggap gagal oleh pemanggil).
 */
async function panggilInternal(
  authHeader: string,
  path: string,
  body: unknown,
): Promise<{ kode: number; data: unknown }> {
  if (!appRef) throw new HTTPException(500, { message: "Sinkron belum siap (app belum disuntik)" });
  const req = new Request(`http://sync.internal/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(body ?? {}),
  });
  const res = await appRef.fetch(req);
  const teks = await res.text();
  let data: unknown = teks;
  try {
    data = teks ? JSON.parse(teks) : null;
  } catch {
    /* biarkan sebagai teks mentah */
  }
  return { kode: res.status, data };
}

const UUID = z.string().uuid();

/**
 * Pisahkan path-param wajib dari payload; sisanya jadi body request.
 *
 * Path-param di-interpolasi ke URL sub-request internal, jadi kunci ber-akhiran
 * `_id` (faktur_id/supply_id — konvensi UUID di seluruh skema) WAJIB UUID valid.
 * Tanpa ini, nilai jahat (mis. berisi `/` atau `..`) bisa mengubah jalur yang
 * dituju. Kunci non-`_id` (mis. `jalur`) divalidasi terpisah oleh pemanggil.
 */
function pisahParam<T extends string>(
  payload: unknown,
  kunci: readonly T[],
): { params: Record<T, string>; body: Record<string, unknown> } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const params = {} as Record<T, string>;
  const body: Record<string, unknown> = { ...p };
  for (const k of kunci) {
    const v = p[k];
    if (typeof v !== "string" || !v) {
      throw new HTTPException(400, { message: `Field '${k}' wajib pada payload perintah` });
    }
    if (k.endsWith("_id") && !UUID.safeParse(v).success) {
      throw new HTTPException(400, { message: `Field '${k}' harus berupa UUID valid` });
    }
    params[k] = v;
    delete body[k];
  }
  return { params, body };
}

// ---------------------------------------------------------------------------
// FASE 1 — eksekusi langsung lewat service (waktu = timestamp kejadian)
// ---------------------------------------------------------------------------

/**
 * penjualan — kasir; bukukan ke shift kasir yang tepat.
 *
 * Dua tahap pencarian, karena uang tunainya SUDAH diterima kasir: menolak
 * transaksi = uang itu tidak punya jejak sama sekali di sistem.
 *
 * 1. Shift yang jendelanya memuat `waktu` (inklusif kedua ujung). Sisi buka
 *    diberi toleransi `SKEW_MENIT` untuk jam perangkat yang mundur beberapa
 *    menit — tanpa itu transaksi tepat sebelum shift dibuka ikut hilang.
 * 2. Bila tidak ada: shift terakhir cabang ini yang DITUTUP paling dekat
 *    sebelum `waktu`, selama masih dalam `SUSULAN_TOLERANSI_JAM` dan tanggal
 *    bisnis yang sama. Ini kasus "shift ditutup dari tempat lain sementara
 *    perangkat kasir offline dan masih melayani".
 *
 * Keduanya menulis `sales.shift_id` supaya transaksi benar-benar masuk rekap
 * & selisih kas shift tsb — penanda `ada_transaksi_susulan` saja tidak cukup,
 * karena rekap menyaring per jendela waktu untuk baris yang tak tertaut.
 */
const execPenjualan: Eksekutor = async ({ auth }, payload, waktu) => {
  if (auth.role !== "cashier") {
    throw new HTTPException(403, { message: "Hanya kasir yang boleh membuat transaksi" });
  }
  const p = SaleBody.parse(payload);
  const branchId = await resolveCabangSync(auth, p.branch_id);
  const batasBuka = new Date(waktu.getTime() + SKEW_MENIT * 60_000);

  let [shift] = await db
    .select({ id: shifts.id, openedAt: shifts.openedAt, closedAt: shifts.closedAt })
    .from(shifts)
    .where(
      and(
        eq(shifts.companyId, auth.company_id!),
        eq(shifts.branchId, branchId),
        lte(shifts.openedAt, batasBuka),
        sql`(${shifts.closedAt} IS NULL OR ${shifts.closedAt} >= ${waktu})`,
      ),
    )
    .orderBy(desc(shifts.openedAt))
    .limit(1);

  // Tahap 2 — shift tertutup terdekat sebelum `waktu`.
  let susulanDiLuarJendela = false;
  if (!shift) {
    const [terdekat] = await db
      .select({ id: shifts.id, openedAt: shifts.openedAt, closedAt: shifts.closedAt })
      .from(shifts)
      .where(
        and(
          eq(shifts.companyId, auth.company_id!),
          eq(shifts.branchId, branchId),
          isNotNull(shifts.closedAt),
          lte(shifts.closedAt, waktu),
        ),
      )
      .orderBy(desc(shifts.closedAt))
      .limit(1);
    if (terdekat?.closedAt) {
      const [comp] = await db
        .select({ tz: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const tz = comp?.tz ?? "Asia/Jakarta";
      if (dalamToleransiSusulan(waktu, terdekat.closedAt, tz)) {
        shift = terdekat;
        susulanDiLuarJendela = true;
      } else {
        throw new SyncGagal(
          409,
          "Tidak ada shift kasir yang mencakup waktu transaksi ini",
          "shift_tidak_cocok",
          { shift_terdekat: ringkasShift(terdekat) },
        );
      }
    }
  }

  if (!shift) {
    throw new SyncGagal(
      409,
      "Tidak ada shift kasir yang mencakup waktu transaksi ini",
      "shift_tidak_cocok",
      { shift_terdekat: null },
    );
  }

  // Rekap dihitung saat dibaca, jadi cukup tandai agar pembaca tahu angka
  // penutupan awal bisa berbeda dari rekap terkini.
  const susulan = shift.closedAt != null;
  if (susulan) {
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
    shiftId: shift.id,
    items: p.items,
  });
  return {
    kode: 201,
    data: {
      ...result,
      kasir: auth.nama,
      shift: ringkasShift(shift),
      ada_transaksi_susulan: susulan,
      /** true bila `waktu` di LUAR jendela shift (dibukukan lewat toleransi) */
      di_luar_jendela_shift: susulanDiLuarJendela,
    },
  };
};

/**
 * Identitas shift untuk dibalas ke mobile. Tabel `shifts` tidak punya kolom
 * nomor, jadi shift dikenali lewat id + jam buka/tutupnya.
 */
function ringkasShift(s: { id: string; openedAt: Date; closedAt: Date | null }) {
  return {
    id: s.id,
    dibuka_pada: s.openedAt.toISOString(),
    ditutup_pada: s.closedAt ? s.closedAt.toISOString() : null,
  };
}

/** absen_saya — cap atas nama pemanggil sendiri (semua peran). */
const execAbsenSaya: Eksekutor = async ({ auth }, payload, waktu) => {
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
const execAbsenStasiun: Eksekutor = async ({ auth }, payload, waktu) => {
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

// ---------------------------------------------------------------------------
// FASE 2 — dispatch ke endpoint asli (stok berubah saat sinkron; `waktu` untuk
// audit di ledger). Validasi = aturan endpoint asli (role, kunci cabang, dsb.).
// ---------------------------------------------------------------------------

function cekJalur(j: string): "produksi" | "pembelian" {
  if (j !== "produksi" && j !== "pembelian") {
    throw new HTTPException(400, { message: "jalur harus 'produksi' atau 'pembelian'" });
  }
  return j;
}

const execStokOpname: Eksekutor = ({ authHeader }, payload) =>
  panggilInternal(authHeader, "/stok/opname", payload);

const execPerlengkapanOpname: Eksekutor = ({ authHeader }, payload) =>
  panggilInternal(authHeader, "/perlengkapan/opname", payload);

const execPerlengkapanPakai: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["supply_id"]);
  return panggilInternal(authHeader, `/perlengkapan/${params.supply_id}/pakai`, body);
};

const execFakturTahap: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["jalur", "faktur_id"]);
  return panggilInternal(authHeader, `/${cekJalur(params.jalur)}/tahap/${params.faktur_id}`, body);
};

const execFakturKirim: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["jalur", "faktur_id"]);
  return panggilInternal(authHeader, `/${cekJalur(params.jalur)}/kirim/${params.faktur_id}`, body);
};

const execProduksiKirimHasil: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["faktur_id"]);
  return panggilInternal(authHeader, `/produksi/kirim-hasil/${params.faktur_id}`, body);
};

const execPenerimaanTerima: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["faktur_id"]);
  return panggilInternal(authHeader, `/penerimaan/${params.faktur_id}/terima`, body);
};
const execPenerimaanTerimaSebagian: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["faktur_id"]);
  return panggilInternal(authHeader, `/penerimaan/${params.faktur_id}/terima-sebagian`, body);
};
const execPenerimaanTolak: Eksekutor = ({ authHeader }, payload) => {
  const { params, body } = pisahParam(payload, ["faktur_id"]);
  return panggilInternal(authHeader, `/penerimaan/${params.faktur_id}/tolak`, body);
};

const EKSEKUTOR: Record<string, Eksekutor> = {
  penjualan: execPenjualan,
  absen_saya: execAbsenSaya,
  absen_stasiun: execAbsenStasiun,
  stok_opname: execStokOpname,
  perlengkapan_opname: execPerlengkapanOpname,
  perlengkapan_pakai: execPerlengkapanPakai,
  faktur_tahap: execFakturTahap,
  faktur_kirim: execFakturKirim,
  produksi_kirim_hasil: execProduksiKirimHasil,
  penerimaan_terima: execPenerimaanTerima,
  penerimaan_terima_sebagian: execPenerimaanTerimaSebagian,
  penerimaan_tolak: execPenerimaanTolak,
};

/** Ambil pesan error dari body respons sub-request (bila ada). */
function pesanError(data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string") return e;
  }
  return typeof data === "string" && data ? data : "Perintah gagal";
}

// Batasi laju sinkron per perusahaan: tiap request bisa membawa 100 perintah
// yang masing-masing memicu sub-request internal (mahal). Auth sudah dijalankan
// oleh gerbang tenant sebelum handler ini, jadi company_id tersedia di key.
const batasSync = env.RATE_LIMIT_ENABLED
  ? rateLimit({
      windowMs: 60_000,
      max: 60,
      key: (c) => `sync:${c.get("auth")?.company_id ?? "?"}`,
      message: "Terlalu banyak sinkron beruntun — jeda sebentar lalu coba lagi.",
    })
  : lewatiRateLimit;

/**
 * Sinkron antrean offline mobile. SATU endpoint generik: batch perintah
 * ber-`client_ref` (idempotency), dieksekusi lewat logika endpoint asli, balas
 * hasil per item. Selalu 200; kegagalan dilaporkan per item.
 */
export const syncRoutes = new Hono<AppEnv>().post("/", batasSync, zValidator("json", SyncBody), async (c) => {
  const auth = c.get("auth") as SyncAuth;
  const authHeader = c.req.header("authorization") ?? "";
  const { device_id, commands } = c.req.valid("json");
  const sekarang = Date.now();
  const hasil: SyncItemResult[] = [];

  for (const cmd of commands) {
    // 1) Idempotency: perintah yang sudah tercatat → balas hasil tersimpan.
    const [ada] = await db
      .select({ kode: syncCommands.kode, status: syncCommands.status, hasilJson: syncCommands.hasilJson })
      .from(syncCommands)
      .where(and(eq(syncCommands.companyId, auth.company_id!), eq(syncCommands.clientRef, cmd.client_ref)));
    if (ada) {
      if (ada.status === "gagal") {
        // Penolakan tersimpan dibalas UTUH (termasuk sebab & data lanjutan),
        // supaya retry tidak kehilangan konteks yang dipakai mobile menawarkan
        // aksi perbaikan.
        const j = ada.hasilJson as { error?: string; sebab?: string; data?: unknown } | null;
        hasil.push({
          client_ref: cmd.client_ref,
          status: "sudah_ada",
          kode: ada.kode,
          error: j?.error ?? "gagal",
          ...(j?.sebab ? { sebab: j.sebab } : {}),
          ...(j?.data !== undefined ? { data: j.data } : {}),
        });
      } else {
        hasil.push({
          client_ref: cmd.client_ref,
          status: "sudah_ada",
          kode: ada.kode,
          data: ada.hasilJson,
        });
      }
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
      const maksUmur = MAKS_UMUR_HARI[cmd.tipe] ?? MAKS_UMUR_HARI_DEFAULT;
      if (t < sekarang - maksUmur * 86_400_000) {
        throw new HTTPException(400, { message: `waktu kejadian lebih dari ${maksUmur} hari lalu` });
      }
      const exec = EKSEKUTOR[cmd.tipe];
      const { kode, data } = await exec({ auth, authHeader }, cmd.payload, waktu);
      if (kode >= 400) {
        // Kegagalan yang DIBALAS (mis. dari sub-request) — bukan lemparan.
        item = { client_ref: cmd.client_ref, status: "gagal", kode, error: pesanError(data) };
        simpanStatus = "gagal";
        simpanKode = kode;
        simpanHasil = { error: pesanError(data) };
      } else {
        item = { client_ref: cmd.client_ref, status: "ok", kode, data };
        simpanStatus = "ok";
        simpanKode = kode;
        simpanHasil = data;
      }
    } catch (e) {
      const kode =
        e instanceof SyncGagal
          ? e.kode
          : e instanceof HTTPException
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 500;
      const pesan =
        e instanceof SyncGagal || e instanceof HTTPException
          ? e.message
          : e instanceof z.ZodError
            ? e.issues.map((i) => i.message).join("; ")
            : "Kesalahan server";
      item = {
        client_ref: cmd.client_ref,
        status: "gagal",
        kode,
        error: pesan,
        ...(e instanceof SyncGagal ? { sebab: e.sebab, data: e.data } : {}),
      };
      simpanStatus = "gagal";
      simpanKode = kode;
      simpanHasil =
        e instanceof SyncGagal ? { error: pesan, sebab: e.sebab, data: e.data } : { error: pesan };
    }

    // 2) Catat hasil ke ledger (exactly-once). onConflictDoNothing melindungi balapan retry.
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
