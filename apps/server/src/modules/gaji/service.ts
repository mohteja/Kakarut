import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import {
  hitungSlip,
  type GajiHariMasukan,
  type GajiPeriodeRow,
  type GajiRincian,
  type GajiSetelanKaryawanDto,
  type GajiSlipRow,
  type KasbonAktif,
  type PengajuanKategori,
  type UserRole,
} from "@kakarut/shared";
import { db, type Tx } from "../../db/client";
import {
  attendances,
  branches,
  companies,
  gajiPeriode,
  gajiSetelan,
  gajiSlip,
  gajiTunjangan,
  kasbon,
  kasbonPotongan,
  memberships,
  users,
} from "../../db/schema";
import { BATAS_UANG, pastikanMuat } from "../../lib/batas-angka";
import { tanggalDi, waktuDi } from "../../lib/time";
import { pengajuanDisetujuiPadaRentang, tanggalDalamRentang } from "../pengajuan/routes";

type DbAtauTx = typeof db | Tx;

/** Pengaturan penggajian perusahaan + zona waktunya. */
export async function aturanPerusahaan(dbx: DbAtauTx, companyId: string) {
  const [c] = await dbx
    .select({
      nama: companies.nama,
      tz: companies.timezone,
      tanggalMulai: companies.gajiTanggalMulai,
      cutiDibayar: companies.gajiCutiDibayar,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  return {
    nama: c.nama,
    tz: c.tz,
    tanggal_mulai: c.tanggalMulai,
    cuti_dibayar: c.cutiDibayar as PengajuanKategori[],
  };
}

/** Menit sejak 00:00 TANGGAL KERJA (zona perusahaan); lewat tengah malam > 1440. */
export function menitLokal(tz: string, tanggalKerja: string, waktu: Date): number {
  const tgl = tanggalDi(tz, waktu);
  const [h, m] = waktuDi(tz, waktu).split(":").map(Number);
  const selisihHari = Math.round((Date.parse(tgl) - Date.parse(tanggalKerja)) / 86_400_000);
  return selisihHari * 1440 + h * 60 + m;
}

export interface KaryawanGaji {
  user_id: string;
  nama: string;
  employee_code: string | null;
  role: UserRole;
  cabang: string | null;
  bergabung: Date;
  arsip: Date | null;
}

/**
 * Status per hari tiap karyawan untuk rentang periode — aturan SAMA dengan
 * Rekap Absen (`nilaiHariRekap`): cap absen = hadir (bahkan di luar masa
 * kerja — fakta sejarah), di luar masa kerja = kosong, pengajuan disetujui =
 * cuti/libur, selain itu alpa. Bedanya hanya `belum` untuk hari yang belum
 * terjadi (rekap memakai `kosong`, yang di sini akan memotong prorata).
 */
export async function harianKaryawan(
  dbx: DbAtauTx,
  companyId: string,
  tz: string,
  dari: string,
  sampai: string,
  karyawan: KaryawanGaji[],
): Promise<Map<string, GajiHariMasukan[]>> {
  const ids = karyawan.map((k) => k.user_id);
  const hasil = new Map<string, GajiHariMasukan[]>();
  if (ids.length === 0) return hasil;

  const cap = await dbx
    .select({
      user_id: attendances.userId,
      tanggal: attendances.attendDate,
      masuk: sql<string | null>`min(${attendances.waktu}) filter (where ${attendances.tipe} = 'masuk')`,
      keluar: sql<string | null>`max(${attendances.waktu}) filter (where ${attendances.tipe} = 'keluar')`,
    })
    .from(attendances)
    .where(
      and(
        eq(attendances.companyId, companyId),
        inArray(attendances.userId, ids),
        gte(attendances.attendDate, dari),
        lte(attendances.attendDate, sampai),
      ),
    )
    .groupBy(attendances.userId, attendances.attendDate);
  const petaCap = new Map<string, { masuk: number | null; keluar: number | null }>();
  for (const r of cap) {
    petaCap.set(`${r.user_id}|${r.tanggal}`, {
      masuk: r.masuk ? menitLokal(tz, r.tanggal, new Date(r.masuk)) : null,
      keluar: r.keluar ? menitLokal(tz, r.tanggal, new Date(r.keluar)) : null,
    });
  }

  const izin = await pengajuanDisetujuiPadaRentang(companyId, dari, sampai, ids);
  const petaIzin = new Map<string, { jenis: "cuti" | "libur"; kategori: PengajuanKategori }>();
  for (const p of izin) {
    const mulai = p.mulai < dari ? dari : p.mulai;
    const selesai = p.selesai > sampai ? sampai : p.selesai;
    for (const t of tanggalDalamRentang(mulai, selesai)) {
      petaIzin.set(`${p.userId}|${t}`, { jenis: p.jenis, kategori: p.kategori as PengajuanKategori });
    }
  }

  const hariIni = tanggalDi(tz);
  const semua = tanggalDalamRentang(dari, sampai);
  for (const k of karyawan) {
    const gabung = tanggalDi(tz, k.bergabung);
    const keluar = k.arsip ? tanggalDi(tz, k.arsip) : null;
    hasil.set(
      k.user_id,
      semua.map((tanggal): GajiHariMasukan => {
        const kunci = `${k.user_id}|${tanggal}`;
        const c = petaCap.get(kunci);
        if (c) {
          return { tanggal, status: "hadir", kategori: null, masuk_menit: c.masuk, keluar_menit: c.keluar };
        }
        const kosong = { tanggal, kategori: null, masuk_menit: null, keluar_menit: null };
        if (tanggal < gabung || (keluar !== null && tanggal > keluar)) return { ...kosong, status: "kosong" };
        const iz = petaIzin.get(kunci);
        if (iz) return { ...kosong, status: iz.jenis, kategori: iz.kategori };
        if (tanggal > hariIni) return { ...kosong, status: "belum" };
        return { ...kosong, status: "alpa" };
      }),
    );
  }
  return hasil;
}

/**
 * Kasbon yang masih bersisa, per karyawan, tertua dulu. Sisa = nominal − Σ
 * potongan TERCATAT (baris `kasbon_potongan` hanya lahir saat periode
 * difinalkan, dan dihapus saat periodenya dibuka lagi).
 */
export async function kasbonAktif(
  dbx: DbAtauTx,
  companyId: string,
  userIds: string[],
): Promise<Map<string, KasbonAktif[]>> {
  const peta = new Map<string, KasbonAktif[]>();
  if (userIds.length === 0) return peta;
  const rows = await dbx
    .select({
      id: kasbon.id,
      user_id: kasbon.userId,
      nominal: kasbon.nominal,
      cicilan: kasbon.cicilanPerPeriode,
      terpotong: sql<string>`coalesce(sum(${kasbonPotongan.nominal}), 0)`,
    })
    .from(kasbon)
    .leftJoin(kasbonPotongan, eq(kasbonPotongan.kasbonId, kasbon.id))
    .where(and(eq(kasbon.companyId, companyId), inArray(kasbon.userId, userIds)))
    .groupBy(kasbon.id)
    .orderBy(asc(kasbon.tanggal), asc(kasbon.createdAt));
  for (const r of rows) {
    const sisa = r.nominal - Number(r.terpotong);
    if (sisa <= 0) continue;
    const arr = peta.get(r.user_id) ?? [];
    arr.push({ id: r.id, sisa, cicilan_per_periode: r.cicilan });
    peta.set(r.user_id, arr);
  }
  return peta;
}

export function setelanDto(r: typeof gajiSetelan.$inferSelect): GajiSetelanKaryawanDto {
  return {
    dasar: r.dasar,
    nominal: r.nominal,
    jam_masuk: r.jamMasuk,
    jam_pulang: r.jamPulang,
    toleransi_telat_menit: r.toleransiTelatMenit,
    potongan_alpa_per_hari: r.potonganAlpaPerHari,
    potongan_telat_per_kali: r.potonganTelatPerKali,
    upah_lembur_per_jam: r.upahLemburPerJam,
    aktif: r.aktif,
  };
}

/** Karyawan perusahaan (tanpa owner) yang masa kerjanya bertindih rentang. */
export async function karyawanPerusahaan(
  dbx: DbAtauTx,
  companyId: string,
  tz: string,
  dari: string,
  sampai: string,
): Promise<KaryawanGaji[]> {
  const rows = await dbx
    .select({
      user_id: users.id,
      nama: users.nama,
      employee_code: memberships.employeeCode,
      role: memberships.role,
      cabang: branches.nama,
      bergabung: memberships.createdAt,
      arsip: memberships.archivedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(branches, eq(branches.id, memberships.branchId))
    .where(and(eq(memberships.companyId, companyId), ne(memberships.role, "owner")))
    .orderBy(users.nama);
  return rows
    .filter((k) => tanggalDi(tz, k.bergabung) <= sampai && (k.arsip == null || tanggalDi(tz, k.arsip) >= dari))
    .map((k) => ({ ...k, employee_code: k.employee_code ?? null, cabang: k.cabang ?? null }));
}

/**
 * Hitung (ulang) slip sebuah periode DRAFT. Bonus, penyesuaian, & catatan yang
 * sudah diisi dipertahankan; angka lain dihitung segar dari absen, setelan,
 * tunjangan, dan kasbon saat ini. `hanyaUser` = hitung satu orang saja.
 */
export async function hitungUlangPeriode(
  tx: Tx,
  companyId: string,
  periode: { id: string; mulai: string; selesai: string },
  hanyaUser?: string,
): Promise<{ tanpa_setelan: { user_id: string; nama: string }[] }> {
  const aturan = await aturanPerusahaan(tx, companyId);
  const semua = await karyawanPerusahaan(tx, companyId, aturan.tz, periode.mulai, periode.selesai);
  const sasaran = hanyaUser ? semua.filter((k) => k.user_id === hanyaUser) : semua;
  const ids = sasaran.map((k) => k.user_id);

  const setelan =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(gajiSetelan)
          .where(and(eq(gajiSetelan.companyId, companyId), inArray(gajiSetelan.userId, ids)));
  const petaSetelan = new Map(setelan.filter((s) => s.aktif).map((s) => [s.userId, s]));
  const dihitung = sasaran.filter((k) => petaSetelan.has(k.user_id));
  const tanpaSetelan = sasaran
    .filter((k) => !petaSetelan.has(k.user_id) && k.arsip == null)
    .map((k) => ({ user_id: k.user_id, nama: k.nama }));

  const idHitung = dihitung.map((k) => k.user_id);
  const tunjangan =
    idHitung.length === 0
      ? []
      : await tx
          .select()
          .from(gajiTunjangan)
          .where(and(eq(gajiTunjangan.companyId, companyId), inArray(gajiTunjangan.userId, idHitung)));
  const lama = await tx
    .select({
      userId: gajiSlip.userId,
      bonus: gajiSlip.bonus,
      penyesuaian: gajiSlip.penyesuaian,
      catatan: gajiSlip.catatan,
    })
    .from(gajiSlip)
    .where(and(eq(gajiSlip.companyId, companyId), eq(gajiSlip.periodeId, periode.id)));
  const petaLama = new Map(lama.map((l) => [l.userId, l]));
  const harian = await harianKaryawan(tx, companyId, aturan.tz, periode.mulai, periode.selesai, dihitung);
  const pinjaman = await kasbonAktif(tx, companyId, idHitung);

  // ID slip DIPERTAHANKAN (upsert per periode × karyawan) — klien yang sedang
  // memegang id slip tak boleh kehilangannya hanya karena bonusnya diubah.
  // Yang tak lagi dihitung (setelan dinonaktifkan, keluar sebelum periode)
  // dihapus; draft belum punya potongan kasbon tercatat.
  const idTetap = new Set(dihitung.map((k) => k.user_id));
  const usang = lama.map((l) => l.userId).filter((u) => !idTetap.has(u) && (!hanyaUser || u === hanyaUser));
  if (usang.length > 0) {
    await tx
      .delete(gajiSlip)
      .where(
        and(eq(gajiSlip.companyId, companyId), eq(gajiSlip.periodeId, periode.id), inArray(gajiSlip.userId, usang)),
      );
  }

  const baris = dihitung.map((k) => {
    const s = petaSetelan.get(k.user_id)!;
    const l = petaLama.get(k.user_id);
    const rincian = hitungSlip({
      setelan: setelanDto(s),
      tunjangan: tunjangan
        .filter((t) => t.userId === k.user_id)
        .map((t) => ({ nama: t.nama, nominal: t.nominal })),
      hari: harian.get(k.user_id) ?? [],
      cutiDibayar: aturan.cuti_dibayar,
      kasbon: pinjaman.get(k.user_id) ?? [],
      bonus: l?.bonus ?? 0,
      penyesuaian: l?.penyesuaian ?? 0,
    });
    pastikanMuat(rincian.total, BATAS_UANG, `total gaji ${k.nama}`);
    return {
      companyId,
      periodeId: periode.id,
      userId: k.user_id,
      bonus: rincian.bonus,
      penyesuaian: rincian.penyesuaian,
      catatan: l?.catatan ?? null,
      total: rincian.total,
      rincian,
    };
  });
  if (baris.length > 0) {
    await tx
      .insert(gajiSlip)
      .values(baris)
      .onConflictDoUpdate({
        target: [gajiSlip.periodeId, gajiSlip.userId],
        set: {
          total: sql`excluded.total`,
          rincian: sql`excluded.rincian`,
          dihitungPada: sql`now()`,
        },
      });
  }
  return { tanpa_setelan: tanpaSetelan };
}

/** Ringkas periode + jumlah & total slip. */
export async function daftarPeriode(dbx: DbAtauTx, companyId: string, id?: string): Promise<GajiPeriodeRow[]> {
  const rows = await dbx
    .select({
      id: gajiPeriode.id,
      mulai: gajiPeriode.mulai,
      selesai: gajiPeriode.selesai,
      status: gajiPeriode.status,
      difinalkanPada: gajiPeriode.difinalkanPada,
      dibayarPada: gajiPeriode.dibayarPada,
      jumlah: sql<number>`count(${gajiSlip.id})::int`,
      total: sql<string>`coalesce(sum(${gajiSlip.total}), 0)`,
    })
    .from(gajiPeriode)
    .leftJoin(gajiSlip, eq(gajiSlip.periodeId, gajiPeriode.id))
    .where(and(eq(gajiPeriode.companyId, companyId), ...(id ? [eq(gajiPeriode.id, id)] : [])))
    .groupBy(gajiPeriode.id)
    .orderBy(sql`${gajiPeriode.mulai} desc`);
  return rows.map((r) => ({
    id: r.id,
    mulai: r.mulai,
    selesai: r.selesai,
    status: r.status,
    jumlah_slip: r.jumlah,
    total: Number(r.total),
    difinalkan_pada: r.difinalkanPada ? r.difinalkanPada.toISOString() : null,
    dibayar_pada: r.dibayarPada ? r.dibayarPada.toISOString() : null,
  }));
}

/** Baris slip untuk tabel — angka ringkas dari rincian yang tersimpan. */
export async function daftarSlip(
  dbx: DbAtauTx,
  companyId: string,
  syarat: { periodeId?: string; slipId?: string; userId?: string },
): Promise<(GajiSlipRow & { rincian: GajiRincian })[]> {
  const rows = await dbx
    .select({
      id: gajiSlip.id,
      periode_id: gajiSlip.periodeId,
      user_id: gajiSlip.userId,
      nama: users.nama,
      employee_code: memberships.employeeCode,
      role: memberships.role,
      cabang: branches.nama,
      catatan: gajiSlip.catatan,
      total: gajiSlip.total,
      rincian: gajiSlip.rincian,
    })
    .from(gajiSlip)
    .innerJoin(users, eq(users.id, gajiSlip.userId))
    .leftJoin(
      memberships,
      and(eq(memberships.userId, gajiSlip.userId), eq(memberships.companyId, gajiSlip.companyId)),
    )
    .leftJoin(branches, eq(branches.id, memberships.branchId))
    .where(
      and(
        eq(gajiSlip.companyId, companyId),
        ...(syarat.periodeId ? [eq(gajiSlip.periodeId, syarat.periodeId)] : []),
        ...(syarat.slipId ? [eq(gajiSlip.id, syarat.slipId)] : []),
        ...(syarat.userId ? [eq(gajiSlip.userId, syarat.userId)] : []),
      ),
    )
    .orderBy(users.nama);
  return rows.map((r) => {
    const g = r.rincian as GajiRincian;
    return {
      id: r.id,
      periode_id: r.periode_id,
      user_id: r.user_id,
      nama: r.nama,
      employee_code: r.employee_code ?? null,
      role: r.role ?? null,
      cabang: r.cabang ?? null,
      dasar: g.dasar,
      hadir: g.hadir,
      alpa: g.alpa,
      cuti_dibayar: g.cuti_dibayar,
      cuti_tak_dibayar: g.cuti_tak_dibayar,
      telat_kali: g.telat_kali,
      lembur_menit: g.lembur_menit,
      lupa_pulang: g.lupa_pulang,
      gaji_pokok: g.gaji_pokok,
      tunjangan_total: g.tunjangan_total,
      upah_lembur: g.upah_lembur,
      bonus: g.bonus,
      penyesuaian: g.penyesuaian,
      potongan: g.potongan_alpa + g.potongan_cuti_tak_dibayar + g.potongan_telat,
      potongan_kasbon: g.potongan_kasbon,
      total: r.total,
      catatan: r.catatan,
      rincian: g,
    };
  });
}
