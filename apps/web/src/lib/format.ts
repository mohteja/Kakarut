import { waktuKertas } from "@kakarut/shared";
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/**
 * Angka yang bukan angka dicetak "—", bukan "NaN".
 *
 * `Intl.NumberFormat` mencetak NaN secara harfiah: layar menampilkan tulisan
 * "NaN" atau "Rp NaN" kepada kasir. Itu tak berarti apa-apa bagi pemakainya
 * dan tampak seperti aplikasi rusak. NaN sampai ke sini lewat jalur yang wajar
 * — isian yang belum/salah diketik — jadi menjaganya di satu tempat ini
 * menutup seluruh pemanggil sekaligus.
 *
 * "—" dipakai konsisten di aplikasi ini untuk "belum diketahui".
 */
const TAK_DIKETAHUI = "—";

export function formatRupiah(n: number): string {
  if (!Number.isFinite(n)) return TAK_DIKETAHUI;
  return rupiah.format(Math.round(n));
}

export function formatAngka(n: number, maxDecimals = 2): string {
  if (!Number.isFinite(n)) return TAK_DIKETAHUI;
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxDecimals }).format(n);
}

export function hariIniWIB(timeZone = "Asia/Jakarta"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/**
 * Waktu untuk KERTAS: "21/08 14.30" — tanggal & jam, zona WIB.
 *
 * Dipakai struk pembayaran DAN slip pesanan. Satu rumah, sebab keduanya kertas
 * yang beredar berdampingan di meja yang sama: dua rumusan yang menyimpang
 * sedikit saja membuat dua kertas untuk satu pesanan berbunyi jam berbeda, dan
 * yang membacanya tak punya cara tahu mana yang benar.
 *
 * WIB dipatok di sini, bukan di tiap pemanggil — lihat
 * `zona-waktu-satu-suara.test.ts`: selama web mematok WIB, `companies.timezone`
 * harus tetap tak bisa diubah, dan daftar tempat yang mematoknya adalah daftar
 * kerja yang harus dibereskan lebih dulu. Menambah pemanggil baru tak
 * memperpanjang daftar itu; menambah rumusan baru memperpanjangnya.
 */
export function waktuKertasWIB(d: Date): string {
  return waktuKertas(d, "Asia/Jakarta");
}

export function formatTanggal(tanggal: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full",
    timeZone: "Asia/Jakarta",
  }).format(new Date(`${tanggal}T00:00:00+07:00`));
}

export function formatWaktu(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/** Label tahap untuk badge/banner "sedang diproduksi". */
export function labelTahapProduksi(p: {
  rencana: number;
  dikerjakan: number;
  menunggu: number;
}): string {
  const aktif = [
    p.rencana > 0 && "direncanakan",
    p.dikerjakan > 0 && "dikerjakan",
    p.menunggu > 0 && "menunggu konfirmasi",
  ].filter(Boolean) as string[];
  return aktif.length === 1 ? `tahap ${aktif[0]}` : "beberapa tahap";
}

/** Label tahap dominan pembelian berjalan (RAB → diproses → dikirim). */
export function labelTahapPembelian(p: {
  rencana: number;
  dikerjakan: number;
  menunggu: number;
}): string {
  const aktif = [
    p.rencana > 0 && "RAB (rencana beli)",
    p.dikerjakan > 0 && "diproses",
    p.menunggu > 0 && "dikirim",
  ].filter(Boolean) as string[];
  return aktif.length === 1 ? `tahap ${aktif[0]}` : "beberapa tahap";
}

/** Tanggal ringkas dari timestamp ISO, mis. "11 Jul 2026" (zona WIB). */
export function formatTanggalRingkas(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/**
 * Lama pengerjaan yang enak dibaca orang dapur, bukan angka detik mentah.
 *
 * Ambangnya dipilih dari cara orang benar-benar menyebut waktu di outlet:
 * di bawah semenit disebut detik, di bawah sejam disebut menit (detiknya tak
 * menambah keputusan apa pun), sejam ke atas barulah jam. "4200 dtk" memaksa
 * pembacanya berhitung; "1j 10m" tidak.
 *
 * `null` → "—", bukan "0 dtk". Nol berarti "keluar seketika", dan pesanan yang
 * belum selesai atau tak pernah ditandai bukan pesanan yang seketika.
 */
export function formatDurasi(detik: number | null | undefined): string {
  if (detik == null) return "—";
  const d = Math.max(0, Math.round(detik));
  if (d < 60) return `${d} dtk`;
  const menit = Math.floor(d / 60);
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa === 0 ? `${jam} jam` : `${jam}j ${sisa}m`;
}
