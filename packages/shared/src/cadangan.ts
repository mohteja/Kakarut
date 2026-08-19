/**
 * KAPAN CADANGAN DIANGGAP GAWAT.
 *
 * Aturannya ditaruh di sini, bukan di server atau di halaman, karena keduanya
 * memakai jawaban yang sama untuk dua hal berbeda:
 *
 *   - server memakainya untuk memutuskan MENGIRIM EMAIL peringatan;
 *   - panel super admin memakainya untuk MEMERAHKAN kartu status.
 *
 * Dua salinan aturan akan bergeser: panelnya masih hijau sementara emailnya
 * sudah berbunyi, atau sebaliknya — dan yang membacanya tak punya cara tahu
 * mana yang benar. Satu fungsi, dua pemakai.
 */

export interface KeadaanCadangan {
  /** penjadwal cadangan otomatis aktif (`BACKUP_ENABLED`) */
  aktif: boolean;
  /** waktu cadangan SUKSES terakhir (ISO); null = belum pernah sukses */
  terakhir_sukses: string | null;
  /**
   * Sejak kapan sistem punya data yang layak dicadangkan (ISO) — tenant
   * pertama dibuat. Dipakai HANYA sebagai titik acuan saat belum pernah ada
   * cadangan sukses sama sekali.
   *
   * Kenapa bukan waktu proses menyala: proses menyala ulang tiap deploy, dan
   * deploy bisa berkali-kali sehari. Acuan yang ikut ter-reset tiap deploy tak
   * akan pernah mencapai ambang berapa pun — justru pada sistem yang paling
   * sering dirilis, yang paling butuh dijaga.
   */
  sejak: string | null;
  /** ambang hari tanpa cadangan sukses sebelum dianggap gawat; 0 = mati */
  ambang_hari: number;
}

export interface HasilPeriksaCadangan {
  /** kondisi gawat: sudah terlalu lama tanpa cadangan sukses */
  gawat: boolean;
  /** umur cadangan sukses terakhir dalam jam; null bila belum pernah sukses */
  umur_jam: number | null;
  /** true bila sistem BELUM PERNAH punya cadangan sukses */
  belum_pernah: boolean;
}

const JAM = 3_600_000;

/**
 * Periksa apakah keadaan cadangan sudah gawat.
 *
 * Tidak gawat bila penjadwalnya memang sengaja dimatikan (`aktif=false`) atau
 * ambangnya nol — keduanya keputusan sadar, bukan kelalaian.
 *
 * Bila belum pernah ada cadangan sukses, umurnya dihitung dari `sejak`. Sistem
 * yang belum punya tenant sama sekali (`sejak=null`) tak punya apa pun untuk
 * hilang, jadi tak pernah gawat — ini yang mencegah instalasi yang baru saja
 * berdiri langsung memerah sebelum jadwal pertamanya sempat jalan.
 */
export function periksaCadangan(k: KeadaanCadangan, sekarang: number): HasilPeriksaCadangan {
  const sukses = k.terakhir_sukses ? Date.parse(k.terakhir_sukses) : NaN;
  const belumPernah = !Number.isFinite(sukses);
  const umurJam = belumPernah ? null : Math.max(0, Math.round((sekarang - sukses) / JAM));

  if (!k.aktif || k.ambang_hari <= 0) return { gawat: false, umur_jam: umurJam, belum_pernah: belumPernah };

  const acuan = belumPernah ? (k.sejak ? Date.parse(k.sejak) : NaN) : sukses;
  if (!Number.isFinite(acuan)) return { gawat: false, umur_jam: umurJam, belum_pernah: belumPernah };

  return {
    gawat: sekarang - acuan >= k.ambang_hari * 24 * JAM,
    umur_jam: umurJam,
    belum_pernah: belumPernah,
  };
}
