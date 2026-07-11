const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatRupiah(n: number): string {
  return rupiah.format(Math.round(n));
}

export function formatAngka(n: number, maxDecimals = 2): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxDecimals }).format(n);
}

export function hariIniWIB(timeZone = "Asia/Jakarta"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
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

/** Tanggal ringkas dari timestamp ISO, mis. "11 Jul 2026" (zona WIB). */
export function formatTanggalRingkas(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}
