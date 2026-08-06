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

/**
 * Selisih zona (ms) pada satu instant: berapa yang harus DITAMBAHKAN ke UTC
 * untuk mendapat jam dinding di `timeZone`. WIB → +7 jam.
 *
 * Caranya: format instant itu di zona tujuan, lalu baca hasilnya seolah-olah
 * UTC. Selisih keduanya adalah offsetnya — dan karena dibaca dari Intl, ia
 * ikut aturan DST/perubahan offset historis zona yang bersangkutan, bukan
 * angka yang dipatok.
 */
function selisihZona(timeZone: string, d: Date): number {
  const bagian = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23", // tanpa ini tengah malam bisa terbaca "24", bukan "00"
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const b of bagian) p[b.type] = b.value;
  const lokalSebagaiUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  // `formatToParts` berhenti di detik; instant-nya dibulatkan ke detik juga
  // supaya milidetik tak bocor jadi offset palsu.
  return lokalSebagaiUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * Tengah malam tanggal "YYYY-MM-DD" DI ZONA PERUSAHAAN, sebagai instant UTC.
 *
 * Dipakai setiap kali tanggal yang dipilih orang harus dibandingkan dengan
 * kolom `timestamptz`. `new Date("2026-08-06T00:00:00Z")` TERLIHAT seperti
 * awal hari, tapi di WIB ia jam 07:00 — tujuh jam pertama tiap hari jatuh di
 * sisi yang salah. Untuk restoran itu bukan jam sepi: kiriman sayur datang
 * subuh, dan justru itu yang dicari orang saat menelusuri penerimaan.
 *
 * Dihitung dari dua kandidat: satu memakai offset pada tebakan kasarnya, satu
 * lagi memakai offset pada instant hasil tebakan itu. Bila keduanya sepakat —
 * kasus normal, dan SATU-SATUNYA kasus di Indonesia, yang tak mengenal DST —
 * itulah jawabannya.
 *
 * Kalau tidak sepakat, ada peralihan DST tepat di sekitar tengah malam, dan
 * "awal hari" jadi pertanyaan yang perlu dijawab, bukan diasumsikan:
 *
 *   - Tengah malam terjadi DUA KALI (mundur): keduanya sah; ambil yang LEBIH
 *     AWAL, supaya jam pertama hari itu ikut terhitung.
 *   - Tengah malam TIDAK PERNAH terjadi (maju — mis. Chile, yang meloncat
 *     dari 23:59 langsung ke 01:00): tak satu pun sah; hari itu dimulai pada
 *     instant peralihannya, yaitu kandidat yang LEBIH AKHIR.
 *
 * Tanpa cabang kedua, penyewa di zona seperti itu mendapat instant yang masih
 * berada di HARI SEBELUMNYA — laporan sehari penuh yang meleset satu hari,
 * bukan satu jam.
 */
export function awalHariDi(timeZone: string, tanggal: string): Date {
  const naif = Date.parse(`${tanggal}T00:00:00Z`);
  const offsetKasar = selisihZona(timeZone, new Date(naif));
  const a = naif - offsetKasar;
  const b = naif - selisihZona(timeZone, new Date(a));
  if (a === b) return new Date(a);
  // Kandidat SAH = offset di instant itu benar-benar memetakannya ke tengah
  // malam yang diminta (bukan sekadar hasil hitungan yang tak konsisten).
  const sah = [a, b].filter((c) => selisihZona(timeZone, new Date(c)) === naif - c);
  return new Date(sah.length > 0 ? Math.min(...sah) : Math.max(a, b));
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
