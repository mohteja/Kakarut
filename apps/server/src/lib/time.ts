/** Tanggal YYYY-MM-DD pada zona waktu tertentu (default kini). */
export function tanggalDi(timeZone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

/**
 * Jam "HH:MM" 24-jam pada zona waktu tertentu (default kini). Format zero-pad
 * sehingga bisa dibandingkan langsung secara leksikografis dengan jam
 * operasional cabang (mis. "09:30" > "08:00").
 */
export function waktuDi(timeZone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Kode cabang untuk nomor struk: "Pusat" → "PUSAT". */
export function kodeCabang(nama: string): string {
  return nama.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "CAB";
}
