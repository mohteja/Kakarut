import type { PengajuanKategori } from "./constants";
import type { GajiDasar, GajiHariHasil, GajiHariMasukan, GajiRincian } from "./types";

/**
 * PENGGAJIAN — rumus murni, satu rumah untuk server (yang menghitung dan
 * menyimpan slip) dan klien (yang hanya menampilkannya).
 *
 * Aturan dari pemilik (2026-11-08):
 *   - dasar gaji per karyawan: BULANAN tetap atau HARIAN × hari dibayar;
 *   - telat  = absen masuk pertama > jam masuk + toleransi → potongan per kali;
 *   - lembur = absen keluar terakhir − jam pulang, dibulatkan KE BAWAH per
 *     30 menit → upah per jam;
 *   - alpa (hari kerja tanpa absen & tanpa pengajuan disetujui) → potongan per
 *     hari untuk gaji bulanan; gaji harian memang tak membayarnya;
 *   - cuti/libur disetujui: dibayar atau tidak menurut KATEGORI-nya
 *     (pengaturan perusahaan) — yang tak dibayar dipotong seperti alpa;
 *   - tunjangan tetap per karyawan + bonus & penyesuaian manual per slip;
 *   - kasbon dipotong min(cicilan, sisa) — tak pernah membuat gaji minus.
 */

/** Bawaan kategori cuti/libur yang DIBAYAR — `izin` tidak. */
export const CUTI_DIBAYAR_BAWAAN: PengajuanKategori[] = [
  "tahunan",
  "sakit",
  "melahirkan",
  "penting",
  "mingguan",
  "tukar_jadwal",
  "tanggal_merah",
];

/** Pembagi bawaan potongan alpa gaji bulanan: nominal ÷ 26 hari kerja. */
export const PEMBAGI_POTONGAN_ALPA = 26;
/** Periode gaji dimulai tanggal 1–28 (hari yang ada di setiap bulan). */
export const BATAS_TANGGAL_MULAI_GAJI = 28;
/** Lembur dihitung per kelipatan ini (menit), dibulatkan ke bawah. */
export const KELIPATAN_LEMBUR_MENIT = 30;

export interface GajiSetelanHitung {
  dasar: GajiDasar;
  nominal: number;
  /** "HH:MM" atau null — tanpa jadwal, telat & lembur tak dihitung. */
  jam_masuk: string | null;
  jam_pulang: string | null;
  toleransi_telat_menit: number;
  /** null = bawaan (bulanan: nominal ÷ 26; harian: 0). */
  potongan_alpa_per_hari: number | null;
  potongan_telat_per_kali: number;
  upah_lembur_per_jam: number;
}

export interface KasbonAktif {
  id: string;
  sisa: number;
  cicilan_per_periode: number;
}

/** "HH:MM" → menit sejak 00:00; null bila tak sah. */
export function menitDariJam(jam: string | null | undefined): number | null {
  if (!jam) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(jam);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const bulat = (n: number) => Math.round(n);

/** Potongan alpa per hari yang berlaku (bawaan bila setelannya kosong). */
export function potonganAlpaBerlaku(s: GajiSetelanHitung): number {
  if (s.potongan_alpa_per_hari != null) return s.potongan_alpa_per_hari;
  return s.dasar === "bulanan" ? bulat(s.nominal / PEMBAGI_POTONGAN_ALPA) : 0;
}

/** Telat & lembur satu hari hadir terhadap jadwal. */
export function telatLembur(
  s: Pick<GajiSetelanHitung, "jam_masuk" | "jam_pulang" | "toleransi_telat_menit">,
  masuk: number | null,
  keluar: number | null,
): { telat_menit: number; lembur_menit: number } {
  const jm = menitDariJam(s.jam_masuk);
  let jp = menitDariJam(s.jam_pulang);
  let telat = 0;
  let lembur = 0;
  if (jm != null && masuk != null && masuk > jm + Math.max(0, s.toleransi_telat_menit)) {
    telat = masuk - jm;
  }
  if (jm != null && jp != null && keluar != null) {
    if (jp <= jm) jp += 1440; // jadwal lewat tengah malam
    const lebih = keluar - jp;
    if (lebih > 0) lembur = Math.floor(lebih / KELIPATAN_LEMBUR_MENIT) * KELIPATAN_LEMBUR_MENIT;
  }
  return { telat_menit: telat, lembur_menit: lembur };
}

export function hitungSlip(m: {
  setelan: GajiSetelanHitung;
  tunjangan: { nama: string; nominal: number }[];
  hari: GajiHariMasukan[];
  cutiDibayar: readonly string[];
  kasbon: KasbonAktif[];
  bonus?: number;
  penyesuaian?: number;
}): GajiRincian {
  const s = m.setelan;
  const dibayarSet = new Set(m.cutiDibayar);
  let hadir = 0;
  let alpa = 0;
  let cutiDibayar = 0;
  let cutiTakDibayar = 0;
  let telatKali = 0;
  let telatMenit = 0;
  let lemburMenit = 0;
  let lupaPulang = 0;
  let aktif = 0;

  const harian: GajiHariHasil[] = m.hari.map((h) => {
    let dibayar = false;
    let tl = { telat_menit: 0, lembur_menit: 0 };
    let lupa = false;
    // `belum` (hari yang belum terjadi) tetap masa kerja — prorata bulanan
    // hanya dipotong oleh tanggal bergabung/keluar, bukan oleh "hari ini".
    if (h.status !== "kosong") aktif++;
    if (h.status === "hadir") {
      hadir++;
      dibayar = true;
      tl = telatLembur(s, h.masuk_menit, h.keluar_menit);
      if (tl.telat_menit > 0) {
        telatKali++;
        telatMenit += tl.telat_menit;
      }
      lemburMenit += tl.lembur_menit;
      lupa = h.masuk_menit != null && h.keluar_menit == null;
      if (lupa) lupaPulang++;
    } else if (h.status === "alpa") {
      alpa++;
    } else if (h.status === "cuti" || h.status === "libur") {
      if (h.kategori && dibayarSet.has(h.kategori)) {
        cutiDibayar++;
        dibayar = true;
      } else {
        cutiTakDibayar++;
      }
    }
    return { ...h, dibayar, telat_menit: tl.telat_menit, lembur_menit: tl.lembur_menit, lupa_pulang: lupa };
  });

  const hariPeriode = m.hari.length;
  const pa = potonganAlpaBerlaku(s);
  // Bulanan: pokok penuh, diprorata bila masuk/keluar di tengah periode.
  // Harian: nominal × hari yang dibayar (hadir + cuti dibayar).
  const gajiPokok =
    s.dasar === "bulanan"
      ? hariPeriode > 0
        ? bulat((s.nominal * aktif) / hariPeriode)
        : 0
      : bulat(s.nominal * (hadir + cutiDibayar));
  const potonganAlpa = s.dasar === "bulanan" ? bulat(alpa * pa) : 0;
  const potonganCuti = s.dasar === "bulanan" ? bulat(cutiTakDibayar * pa) : 0;
  const potonganTelat = bulat(telatKali * s.potongan_telat_per_kali);
  const upahLembur = bulat((lemburMenit / 60) * s.upah_lembur_per_jam);
  const tunjanganTotal = m.tunjangan.reduce((a, t) => a + t.nominal, 0);
  const bonus = m.bonus ?? 0;
  const penyesuaian = m.penyesuaian ?? 0;

  const bruto =
    gajiPokok + tunjanganTotal + upahLembur + bonus + penyesuaian - potonganAlpa - potonganCuti - potonganTelat;

  // Kasbon: cicilan tiap pinjaman, tak melebihi sisanya, dan tak melebihi
  // gaji yang tersedia — yang tak terpotong tetap jadi sisa pinjaman.
  let tersedia = Math.max(0, bruto);
  const kasbon: { id: string; nominal: number }[] = [];
  for (const k of m.kasbon) {
    const mau = Math.min(Math.max(0, k.cicilan_per_periode), Math.max(0, k.sisa));
    const potong = Math.min(mau, tersedia);
    if (potong > 0) {
      kasbon.push({ id: k.id, nominal: bulat(potong) });
      tersedia -= potong;
    }
  }
  const potonganKasbon = kasbon.reduce((a, k) => a + k.nominal, 0);
  const total = Math.max(0, bruto - potonganKasbon);

  return {
    dasar: s.dasar,
    nominal: s.nominal,
    hari_periode: hariPeriode,
    hari_aktif: aktif,
    hadir,
    alpa,
    cuti_dibayar: cutiDibayar,
    cuti_tak_dibayar: cutiTakDibayar,
    telat_kali: telatKali,
    telat_menit: telatMenit,
    lembur_menit: lemburMenit,
    lupa_pulang: lupaPulang,
    gaji_pokok: gajiPokok,
    tunjangan: m.tunjangan,
    tunjangan_total: tunjanganTotal,
    upah_lembur: upahLembur,
    potongan_alpa_per_hari: pa,
    potongan_alpa: potonganAlpa,
    potongan_cuti_tak_dibayar: potonganCuti,
    potongan_telat: potonganTelat,
    bonus,
    penyesuaian,
    bruto,
    kasbon,
    potongan_kasbon: potonganKasbon,
    total,
    kurang: bruto < 0 ? -bruto : 0,
    harian,
  };
}

/**
 * Akhir periode bulanan: tanggal `mulai` + 1 bulan − 1 hari (YYYY-MM-DD).
 * Tanggal mulai dibatasi 1–28 (`BATAS_TANGGAL_MULAI_GAJI`), jadi "hari yang
 * sama bulan depan" selalu ada.
 */
export function akhirPeriode(mulai: string): string {
  const [y, mo, d] = mulai.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo, d)); // bulan berikutnya, hari sama
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Awal periode yang memuat `tanggal` bila periode mulai tiap tanggal `mulaiHari` (1–28). */
export function awalPeriodeMemuat(tanggal: string, mulaiHari: number): string {
  const [y, mo, d] = tanggal.split("-").map(Number);
  const dd = String(mulaiHari).padStart(2, "0");
  if (d >= mulaiHari) return `${y}-${String(mo).padStart(2, "0")}-${dd}`;
  const t = new Date(Date.UTC(y, mo - 2, mulaiHari));
  return t.toISOString().slice(0, 10);
}
