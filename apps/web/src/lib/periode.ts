/**
 * PERIODE CEPAT untuk laporan — "Hari ini", "Minggu lalu", "Bulan ini", …
 *
 * Satu rumah untuk keempat tab laporan. Tanpa ini tiap halaman merumuskan
 * "minggu lalu" sendiri, dan dua rumusan yang menyimpang (Senin vs Minggu
 * sebagai awal pekan, atau bulan ini sampai hari ini vs sampai akhir bulan)
 * membuat dua tab berbeda angka untuk periode yang namanya sama.
 *
 * Aturannya:
 *   - pekan dimulai SENIN (kebiasaan kalender Indonesia, juga ISO-8601);
 *   - periode yang masih berjalan ("minggu ini", "bulan ini") berakhir HARI
 *     INI, bukan di akhir pekan/bulan — tanggal sesudah hari ini belum punya
 *     data, dan rentang yang menjangkaunya cuma membuat judulnya menyesatkan;
 *   - periode yang sudah lewat ("minggu lalu", "bulan lalu") utuh dari awal
 *     sampai akhirnya.
 *
 * Semua hitungan dilakukan pada string tanggal "YYYY-MM-DD" lewat UTC, jadi
 * zona waktu perangkat tak pernah ikut campur: "hari ini" berasal dari
 * `hariIniWIB()`, sisanya aritmetika kalender murni.
 */

export type KodePeriode =
  | "hari-ini"
  | "kemarin"
  | "minggu-ini"
  | "minggu-lalu"
  | "bulan-ini"
  | "bulan-lalu";

export type Rentang = { dari: string; sampai: string };

export const PERIODE: { kode: KodePeriode; label: string }[] = [
  { kode: "hari-ini", label: "Hari ini" },
  { kode: "kemarin", label: "Kemarin" },
  { kode: "minggu-ini", label: "Minggu ini" },
  { kode: "minggu-lalu", label: "Minggu lalu" },
  { kode: "bulan-ini", label: "Bulan ini" },
  { kode: "bulan-lalu", label: "Bulan lalu" },
];

function keTanggal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function keString(t: Date): string {
  return t.toISOString().slice(0, 10);
}

function geser(s: string, hari: number): string {
  const t = keTanggal(s);
  t.setUTCDate(t.getUTCDate() + hari);
  return keString(t);
}

/** Senin pada pekan yang memuat `s`. */
function seninDari(s: string): string {
  // getUTCDay: Minggu = 0 … Sabtu = 6 → mundur 6 hari dari Minggu, (n−1) dari lainnya.
  const hari = keTanggal(s).getUTCDay();
  return geser(s, -((hari + 6) % 7));
}

/** Rentang `kode` dilihat dari `hariIni` ("YYYY-MM-DD", WIB). */
export function rentangPeriode(kode: KodePeriode, hariIni: string): Rentang {
  switch (kode) {
    case "hari-ini":
      return { dari: hariIni, sampai: hariIni };
    case "kemarin": {
      const k = geser(hariIni, -1);
      return { dari: k, sampai: k };
    }
    case "minggu-ini":
      return { dari: seninDari(hariIni), sampai: hariIni };
    case "minggu-lalu": {
      const senin = geser(seninDari(hariIni), -7);
      return { dari: senin, sampai: geser(senin, 6) };
    }
    case "bulan-ini":
      return { dari: `${hariIni.slice(0, 7)}-01`, sampai: hariIni };
    case "bulan-lalu": {
      // Sehari sebelum tanggal 1 bulan ini = hari terakhir bulan lalu.
      const akhir = geser(`${hariIni.slice(0, 7)}-01`, -1);
      return { dari: `${akhir.slice(0, 7)}-01`, sampai: akhir };
    }
  }
}

/**
 * Periode mana yang sedang tampil — DITURUNKAN dari tanggalnya, bukan
 * disimpan terpisah. Dua sumber kebenaran untuk satu rentang berarti dropdown
 * bisa berkata "Bulan ini" sementara tanggalnya sudah diubah tangan.
 * `null` = rentang pilihan sendiri (tak cocok periode mana pun).
 *
 * `utamakan` = periode yang terakhir DIPILIH orang. Beberapa periode bisa
 * jatuh ke rentang yang sama — di hari Senin "Minggu ini" = "Hari ini", di
 * tanggal 1 "Bulan ini" = "Hari ini" — dan tanpa ini dropdown melompat ke
 * entri pertama yang cocok, seolah pilihannya tak diterima. Ia hanya dipakai
 * selama rentangnya memang masih cocok.
 */
export function periodeDari(
  r: Rentang,
  hariIni: string,
  utamakan?: KodePeriode | null,
): KodePeriode | null {
  const cocok = (kode: KodePeriode) => {
    const p = rentangPeriode(kode, hariIni);
    return p.dari === r.dari && p.sampai === r.sampai;
  };
  if (utamakan && cocok(utamakan)) return utamakan;
  return PERIODE.find(({ kode }) => cocok(kode))?.kode ?? null;
}
