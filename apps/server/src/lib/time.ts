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

/**
 * Geser tanggal "YYYY-MM-DD" sebanyak n hari (boleh negatif). Aritmetika
 * murni Date.UTC — bebas drift zona waktu/DST. Dipakai menghitung exp lot
 * (tanggal masuk + masa simpan bahan).
 */
export function tambahHari(tanggal: string, hari: number): string {
  const [y, m, d] = tanggal.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + hari));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
