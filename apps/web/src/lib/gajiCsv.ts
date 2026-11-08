import type { GajiPeriodeRow, GajiSlipRow } from "@kakarut/shared";
import { selCsv, selTeks } from "./bahanCsv";

/**
 * CSV satu periode gaji — untuk transfer bank / arsip di Excel. Sel teks
 * dinetralkan dari rumus (`selTeks`, sama dengan ekspor bahan); angka rupiah
 * bulat ditulis apa adanya.
 */
export const KOLOM_CSV_GAJI = [
  "nama",
  "kode",
  "peran",
  "cabang",
  "dasar",
  "hadir",
  "alpa",
  "cuti_dibayar",
  "cuti_tak_dibayar",
  "telat_kali",
  "lembur_menit",
  "gaji_pokok",
  "tunjangan",
  "upah_lembur",
  "bonus",
  "penyesuaian",
  "potongan",
  "potongan_kasbon",
  "total",
  "catatan",
] as const;

export function buatCsvGaji(slip: GajiSlipRow[]): string {
  const baris = slip.map((s) =>
    [
      selTeks(s.nama),
      selTeks(s.employee_code ?? ""),
      s.role ?? "",
      selTeks(s.cabang ?? ""),
      s.dasar,
      String(s.hadir),
      String(s.alpa),
      String(s.cuti_dibayar),
      String(s.cuti_tak_dibayar),
      String(s.telat_kali),
      String(s.lembur_menit),
      String(s.gaji_pokok),
      String(s.tunjangan_total),
      String(s.upah_lembur),
      String(s.bonus),
      String(s.penyesuaian),
      String(s.potongan),
      String(s.potongan_kasbon),
      String(s.total),
      selTeks(s.catatan ?? ""),
    ]
      .map(selCsv)
      .join(","),
  );
  return [KOLOM_CSV_GAJI.join(","), ...baris].join("\n");
}

export function namaBerkasGaji(p: Pick<GajiPeriodeRow, "mulai" | "selesai">): string {
  return `gaji-${p.mulai}_${p.selesai}.csv`;
}
