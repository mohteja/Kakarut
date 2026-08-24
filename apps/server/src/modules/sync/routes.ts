import { zValidator } from "../../lib/validator";
import { BATAS_UANG } from "../../lib/batas-angka";
import { and, desc, eq, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
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
import { bukaShift } from "../shift/routes";
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

/**
 * Status ledger untuk perintah yang SEDANG dieksekusi — baris dipesan sebelum
 * eksekusi dimulai, lalu ditutup jadi 'ok'/'gagal' setelahnya.
 */
const BERJALAN = "berjalan";

/**
 * Klaim yang lebih tua dari ini dianggap ditinggalkan (proses mati / di-deploy
 * ulang di tengah jalan) dan boleh diambil alih. Harus JAUH lebih lama daripada
 * satu batch `/sync` terpanjang — kalau terlalu pendek, retry sah bisa merebut
 * klaim yang sebenarnya masih berjalan dan justru menggandakan yang dijaga.
 */
const KLAIM_BASI_MENIT = 15;

const SyncBody = z.object({
  device_id: z.string().nullish(),
  commands: z
    .array(
      z.object({
        client_ref: z.string().uuid(),
        tipe: z.enum([
          "shift_buka",
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
}).strict();

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
  /**
   * Cabang untuk query, bila pemanggilnya sudah MENCABUT `branch_id` dari badan.
   *
   * Dibutuhkan sejak badan JSON `.strict()`: rute yang tak mendeklarasikan
   * `branch_id` kini menolak 400 bila ia ikut terkirim, padahal cabangnya tetap
   * harus sampai — lewat query. Tanpa parameter ini pemanggilnya harus memilih
   * antara "kirim kunci yang ditolak" atau "kehilangan cabangnya", dan yang
   * kedua persis bug yang §208 ada untuk mencegah.
   */
  cabangEksplisit?: string | null,
): Promise<{ kode: number; data: unknown }> {
  if (!appRef) throw new HTTPException(500, { message: "Sinkron belum siap (app belum disuntik)" });
  /*
   * `branch_id` DIANGKAT KE QUERY, bukan hanya ditinggal di badan.
   *
   * Handler menentukan cabangnya lewat `resolveBranchId(c)`, yang membaca
   * `?branch_id=`. Panggilan internal ini dulu tak pernah menyusun query sama
   * sekali — seluruh payload masuk badan — sehingga cabang yang diminta
   * perangkat TAK PERNAH SAMPAI. Untuk peran tak terikat cabang (owner/admin)
   * `resolveBranchId` lalu jatuh ke CABANG PERTAMA perusahaan, diam-diam.
   *
   * Terukur: owner menyinkronkan "pakai 7 pcs di Cabang Sync" → dibalas
   * status "ok" kode 200, saldo Cabang Sync tetap 100, dan yang terpotong
   * justru cabang Pusat (100 → 93). Dua cabang salah sekaligus — satu
   * kelebihan, satu kekurangan — tanpa satu pun galat, dan perangkatnya
   * menganggap perintahnya sudah beres.
   *
   * Diangkat DI SINI, bukan di tiap eksekutor: ketiga belas perintah mendarat
   * di modul yang memakai `resolveBranchId`, dan satu eksekutor yang lupa akan
   * mengulang bug yang sama tanpa suara.
   *
   * Nilainya TETAP ditinggal di badan: sebagian handler (`/penjualan`,
   * `/open-bill`) membacanya dari sana lewat `branchUntukTulis`.
   *
   * Tidak melonggarkan otorisasi. `resolveBranchId` MENGABAIKAN query untuk
   * peran yang terikat cabang — kasir tetap tak bisa menulis ke cabang lain —
   * dan untuk peran tak terikat, `pastikanCabang` menolak id milik perusahaan
   * lain.
   */
  const cabang =
    cabangEksplisit ??
    (body && typeof body === "object" && typeof (body as Record<string, unknown>).branch_id === "string"
      ? ((body as Record<string, unknown>).branch_id as string)
      : null);
  const url = cabang
    ? `http://sync.internal/api${path}${path.includes("?") ? "&" : "?"}branch_id=${encodeURIComponent(cabang)}`
    : `http://sync.internal/api${path}`;
  const req = new Request(url, {
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
 * shift_buka — kasir membuka kasir saat perangkat offline.
 *
 * `waktu` jadi `opened_at`, jadi shift yang dibuka 08.00 lalu disinkron 20.00
 * membuat SELURUH penjualan hari itu jatuh di dalam jendelanya secara wajar —
 * tidak bersandar pada toleransi transaksi susulan sama sekali. Ini yang
 * membuat pemadaman panjang (mati listrik seharian, outlet tanpa sinyal) tidak
 * lagi berarti nol transaksi.
 *
 * Gerbang absen TIDAK dilewati, hanya dinilai pada tanggal bisnis `waktu`:
 * `absen_saya` juga bisa diantre offline dan perintah dalam satu batch
 * dieksekusi berurutan, jadi absen yang dikirim lebih dulu sudah tercatat saat
 * perintah ini jalan.
 *
 * Sudah ada shift terbuka (mis. manajer membukanya lewat web) → tetap `ok`
 * dengan `sudah_terbuka:true`, bukan gagal. Menggagalkannya akan membuat
 * penjualan yang bersandar pada shift ini kehilangan tempat berpijak.
 */
const execShiftBuka: Eksekutor = async ({ auth }, payload, waktu) => {
  if (auth.role !== "cashier") {
    throw new HTTPException(403, { message: "Hanya kasir yang boleh membuka shift" });
  }
  const p = z
    .object({ branch_id: z.string().uuid().nullish(), modal_awal: z.number().nonnegative().max(BATAS_UANG).default(0) })
    .parse(payload ?? {});
  const branchId = await resolveCabangSync(auth, p.branch_id);
  const { shift, sudahTerbuka } = await bukaShift({
    companyId: auth.company_id!,
    branchId,
    userId: auth.sub,
    modalAwal: p.modal_awal,
    waktu,
    role: auth.role,
  });
  return { kode: 201, data: { ...shift, sudah_terbuka: sudahTerbuka } };
};

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
    customerNama: p.customer_nama,
    customerWa: p.customer_wa,
    metodeBayar: p.metode_bayar,
    uangDiterima: p.uang_diterima,
    waktu,
    shiftId: shift.id,
    openBillId: p.open_bill_id,
    // Sudah terjadi di lapangan. Gerbang "tolak melebihi stok" tak berlaku:
    // menolak di sini tak mencegah apa pun, ia hanya menghapus penjualan
    // sungguhan — antrean klien menandai perintah yang ditolak server sebagai
    // `gagal` dan tak pernah mengirimnya lagi.
    transaksiSusulan: true,
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
  /*
   * `branch_id` DIBUANG dari badan di sini — ia sudah diangkat ke query oleh
   * `panggilInternal`, dan `PakaiBody` tak menerimanya.
   *
   * Selama badan JSON belum `.strict()`, kunci berlebih ini lolos tanpa suara.
   * Sesudah `.strict()` ia 400, dan itu benar: rute ini memilih cabangnya lewat
   * `resolveBranchId(c)` (query), jadi `branch_id` di badan memang tak pernah
   * dibaca. Yang salah bukan pengetatannya melainkan kiriman kita sendiri —
   * kelas yang persis sama dengan `PUT /meja/tata-letak` yang membuat vena ini
   * ada.
   *
   * Rute lain yang MEMBACA cabang dari badan (`branchUntukTulis`: /penjualan,
   * /open-bill, /stok/opname, /shift/buka, /penyimpanan) mendeklarasikannya di
   * skemanya, jadi bagi mereka kunci ini sah dan tetap dikirim.
   */
  const cabang = typeof body.branch_id === "string" ? body.branch_id : null;
  delete body.branch_id;
  return panggilInternal(authHeader, `/perlengkapan/${params.supply_id}/pakai`, body, cabang);
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
  shift_buka: execShiftBuka,
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
    //    Ini JALUR CEPAT saja; yang benar-benar menjaga dari eksekusi ganda
    //    adalah klaim atomik di bawah (lihat `KLAIM_BASI_MENIT`).
    const [ada] = await db
      .select({ kode: syncCommands.kode, status: syncCommands.status, hasilJson: syncCommands.hasilJson })
      .from(syncCommands)
      .where(and(eq(syncCommands.companyId, auth.company_id!), eq(syncCommands.clientRef, cmd.client_ref)));
    if (ada && ada.status !== BERJALAN) {
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

    /*
     * 1b) KLAIM ATOMIK — inilah yang menjaga "exactly-once", bukan SELECT di atas.
     *
     * SELECT-lalu-eksekusi-lalu-INSERT menyisakan jendela selebar SELURUH
     * eksekusi: dua permintaan ber-`client_ref` sama yang datang bersamaan
     * sama-sama melihat ledger kosong, sama-sama menjalankan perintahnya, lalu
     * yang kedua kalah di unique index dan hasilnya DIBUANG diam-diam oleh
     * `onConflictDoNothing`. Ledger terlihat rapi satu baris; penjualannya dua.
     *
     * Jendela itu bukan teori. `/sync` mengeksekusi batch secara BERURUTAN,
     * mobile mengirim sampai 100 perintah sekali jalan, dan `receiveTimeout`-nya
     * 30 detik — antrean panjang sesudah lama offline adalah kasus paling lambat
     * SEKALIGUS kasus pemakaian utamanya. Klien menyerah, mundur sebentar, lalu
     * mengirim ulang batch yang sama selagi server masih menggilas batch pertama.
     *
     * Maka barisnya DIPESAN LEBIH DULU dalam satu pernyataan atomik. Yang menang
     * mengeksekusi; yang kalah tak pernah menyentuh `createSale`.
     */
    const [klaim] = await db
      .insert(syncCommands)
      .values({
        companyId: auth.company_id!,
        clientRef: cmd.client_ref,
        deviceId: device_id ?? null,
        userId: auth.sub,
        tipe: cmd.tipe,
        waktu: new Date(cmd.waktu),
        status: BERJALAN,
        kode: 0,
      })
      .onConflictDoNothing()
      .returning({ id: syncCommands.id });

    if (!klaim) {
      /*
       * Kalah klaim. Dua kemungkinan, dan keduanya TIDAK boleh dieksekusi:
       *   - masih dikerjakan permintaan lain → suruh klien coba lagi nanti;
       *   - proses pengeklaimnya mati sebelum sempat menutup barisnya → setelah
       *     `KLAIM_BASI_MENIT` boleh diambil alih, lewat UPDATE bersyarat supaya
       *     dua pengambil-alih pun tetap hanya satu yang lolos.
       *
       * Ambil-alih TIDAK memperbesar risiko ganda dibanding sebelumnya: baik
       * dulu maupun sekarang, proses yang mati SESUDAH commit tapi SEBELUM
       * menutup ledger akan dieksekusi ulang. Yang hilang cuma jendela
       * balapannya, bukan jaminan barunya.
       */
      const [rebut] = await db
        .update(syncCommands)
        .set({ createdAt: new Date() })
        .where(
          and(
            eq(syncCommands.companyId, auth.company_id!),
            eq(syncCommands.clientRef, cmd.client_ref),
            eq(syncCommands.status, BERJALAN),
            lt(syncCommands.createdAt, new Date(sekarang - KLAIM_BASI_MENIT * 60_000)),
          ),
        )
        .returning({ id: syncCommands.id });
      if (!rebut) {
        /*
         * SENGAJA tidak disimpan ke ledger: ini bukan penolakan perintahnya,
         * cuma "sedang dikerjakan". Menyimpannya sebagai `gagal` akan membekukan
         * perintah yang sebenarnya sedang sukses. Mobile memperlakukan
         * kode ≥ 400 sebagai BELUM selesai (`perintahDianggapSelesai`), jadi
         * item ini tetap di antrean dan terkirim lagi pada tick berikutnya —
         * tepat yang diinginkan.
         */
        hasil.push({
          client_ref: cmd.client_ref,
          status: "gagal",
          kode: 409,
          error: "Perintah ini sedang diproses — coba lagi sebentar lagi",
          sebab: "sedang_diproses",
        });
        continue;
      }
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
      // `sebab` boleh datang dari DUA sumber: SyncGagal (dilempar eksekutor di
      // berkas ini) dan HTTPException ber-`sebab` yang dilempar modul lain —
      // mis. PenjualanGagal dari createSale. Tanpa cabang kedua, penolakan
      // paling penting bagi antrean offline ("bill sudah dibayar" vs "bill
      // dibatalkan") sampai ke klien sebagai 409 telanjang yang tak bisa
      // dibedakan, dan klien terpaksa menebak.
      const sebab = e instanceof SyncGagal ? e.sebab : (e as { sebab?: string })?.sebab;
      const data = e instanceof SyncGagal ? e.data : undefined;
      item = {
        client_ref: cmd.client_ref,
        status: "gagal",
        kode,
        error: pesan,
        ...(sebab ? { sebab, ...(data !== undefined ? { data } : {}) } : {}),
      };
      simpanStatus = "gagal";
      simpanKode = kode;
      simpanHasil = sebab ? { error: pesan, sebab, data } : { error: pesan };
    }

    // 2) Tutup baris yang tadi diklaim. Barisnya sudah ADA sejak sebelum
    //    eksekusi, jadi di sini cukup UPDATE — tak ada lagi INSERT yang bisa
    //    kalah balapan dan membuang hasilnya diam-diam.
    await db
      .update(syncCommands)
      .set({ status: simpanStatus, kode: simpanKode, hasilJson: simpanHasil as object })
      .where(
        and(
          eq(syncCommands.companyId, auth.company_id!),
          eq(syncCommands.clientRef, cmd.client_ref),
        ),
      );
    hasil.push(item);
  }

  return c.json({ hasil } satisfies SyncResponse);
});
