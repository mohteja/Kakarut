/** Tanggal YYYY-MM-DD pada zona waktu tertentu (default kini). */
export function tanggalDi(timeZone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

/** Kode cabang untuk nomor struk: "Pusat" → "PUSAT". */
export function kodeCabang(nama: string): string {
  return nama.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "CAB";
}
