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

/** Kode periode bernama yang mana pun yang rentangnya persis `r`, atau `null`. */
export function periodeDari(r: Rentang, hariIni: string): KodePeriode | null {
  return (
    PERIODE.find(({ kode }) => {
      const p = rentangPeriode(kode, hariIni);
      return p.dari === r.dari && p.sampai === r.sampai;
    })?.kode ?? null
  );
}

/** "YYYY-MM-DD" yang benar-benar ada di kalender (bukan "2026-02-31"). */
function tanggalSah(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && keString(keTanggal(s)) === s;
}

/**
 * PERIODE DI URL — supaya ia terbawa antar tab laporan, selamat dari muat
 * ulang, dan bisa dikirim sebagai tautan.
 *
 *   ?periode=bulan-lalu        periode BERNAMA, dihitung ulang tiap dibuka
 *   ?dari=…&sampai=…           rentang pilihan tangan, apa adanya
 *   (tanpa keduanya)           hari ini
 *
 * Periode bernama disimpan sebagai NAMANYA, bukan tanggalnya: tautan "Bulan
 * lalu" yang dibuka bulan depan berarti bulan lalu SAAT ITU — itulah yang
 * dimaksud orang yang memilihnya. Sekaligus, URL-lah yang mengingat pilihan
 * orang di hari yang ambigu (Senin: "Minggu ini" = "Hari ini"; tanggal 1:
 * "Bulan ini" = "Hari ini"), jadi dropdown tak melompat ke entri lain.
 *
 * Isi URL yang rusak (tanggal mustahil, dari > sampai, kode tak dikenal) jatuh
 * ke hari ini — bukan diteruskan ke server sebagai `?dari=` kosong.
 */
export const KUNCI_URL_PERIODE = ["periode", "dari", "sampai"] as const;

export function bacaPeriodeUrl(
  params: URLSearchParams,
  hariIni: string,
): Rentang & { kode: KodePeriode | null } {
  const kode = params.get("periode");
  const dikenal = PERIODE.find((p) => p.kode === kode)?.kode;
  if (dikenal) return { ...rentangPeriode(dikenal, hariIni), kode: dikenal };
  const dari = params.get("dari");
  const sampai = params.get("sampai");
  if (tanggalSah(dari) && tanggalSah(sampai) && dari <= sampai) {
    return { dari, sampai, kode: periodeDari({ dari, sampai }, hariIni) };
  }
  return { ...rentangPeriode("hari-ini", hariIni), kode: "hari-ini" };
}

/**
 * Parameter URL baru untuk sebuah pilihan; kunci lain di `params` dibiarkan.
 * "Hari ini" = tanpa parameter, supaya URL bawaan tetap bersih.
 */
export function tulisPeriodeUrl(
  params: URLSearchParams,
  pilihan: { kode: KodePeriode } | { rentang: Rentang },
): URLSearchParams {
  const baru = new URLSearchParams(params);
  for (const k of KUNCI_URL_PERIODE) baru.delete(k);
  if ("kode" in pilihan) {
    if (pilihan.kode !== "hari-ini") baru.set("periode", pilihan.kode);
  } else {
    baru.set("dari", pilihan.rentang.dari);
    baru.set("sampai", pilihan.rentang.sampai);
  }
  return baru;
}

/** Hanya kunci periode dari `search` — yang dibawa tab laporan ke tab lain. */
export function searchPeriode(search: string): string {
  const asal = new URLSearchParams(search);
  const bawa = new URLSearchParams();
  for (const k of KUNCI_URL_PERIODE) {
    const v = asal.get(k);
    if (v !== null) bawa.set(k, v);
  }
  const s = bawa.toString();
  return s ? `?${s}` : "";
}
