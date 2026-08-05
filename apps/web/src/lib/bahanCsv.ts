import type { BahanDto, BahanImportRow } from "@kakarut/shared";

/**
 * CSV bahan baku — kolom SAMA dengan field form Tambah/Ubah agar tak ada beda
 * format antara input manual, ekspor, dan impor. Rak simpan (lokasi CK) tidak
 * disertakan karena berupa referensi lokasi, bukan nilai datar.
 * Urutan tetap; header dipakai saat mengunduh & mem-parse.
 */
export const KOLOM_CSV = [
  "kode",
  "nama",
  "kategori",
  "jenis",
  "harga_beli",
  "isi",
  "satuan",
  "satuan_beli",
  "stok_minimum",
  "min_beli",
  "masa_simpan_hari",
  "lead_time_hari",
  "boleh_eceran",
  "lacak_stok",
  "kemasan",
  "complement",
  "catatan",
] as const;

/** Bungkus satu sel CSV (kutip bila mengandung koma/kutip/baris baru). */
function selCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const ya = (b: boolean) => (b ? "ya" : "tidak");

/**
 * Angka untuk SEL CSV, dalam bentuk yang `keAngka` di bawah baca balik UTUH.
 *
 * `String(n)` bukan bentuk itu. Pemisah ribuan dikenali dari grup tiga angka,
 * dan pecahan tiga digit adalah grup tiga angka:
 *
 *     String(0.125) → "0.125"  → keAngka → 125     ← 1000× lebih besar
 *     String(1.375) → "1.375"  → keAngka → 1375
 *
 * Akibatnya ekspor → impor TANPA disentuh sama sekali sudah merusak datanya:
 * vanili 0,125 kg jadi 125 kg. Pemilik menekan Ekspor untuk mencadangkan, lalu
 * Impor untuk memulihkan, dan justru itu yang menghancurkannya.
 *
 * Yang diperbaiki cuma bentuk tulisnya, seminimal mungkin:
 * - bilangan bulat apa adanya (`50000`) — bagian terbesar isi berkas ini, dan
 *   berkas hasil ekspor yang sudah ada tak berubah sedikit pun;
 * - pecahan pakai KOMA (kaidah id-ID, sama dengan seluruh aplikasi), dan bila
 *   pecahannya TEPAT tiga digit ditambah satu nol. Hanya panjang tiga yang
 *   bertabrakan dengan pola ribuan, jadi hanya itu yang perlu diganggu —
 *   tanpa pembulatan, tanpa memaksa semua angka berekor nol.
 */
function selAngka(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  const s = String(n);
  // Notasi eksponen (|n| < 1e-6) di luar jangkauan harga/takaran; biarkan.
  if (s.includes("e") || s.includes("E")) return s;
  const [bulat, pecah = ""] = s.split(".");
  return `${bulat},${pecah.length === 3 ? `${pecah}0` : pecah}`;
}

/** Susun CSV dari daftar bahan — kolom persis form Ubah (ekspor & template). */
export function buatCsvBahan(bahan: BahanDto[]): string {
  const baris = bahan.map((b) =>
    [
      b.kode ?? "",
      b.nama,
      b.kategori,
      b.pengadaan,
      selAngka(b.harga_beli),
      selAngka(b.isi),
      b.satuan,
      b.satuan_beli ?? "",
      selAngka(b.stok_minimum),
      selAngka(b.min_beli ?? 0),
      selAngka(b.masa_simpan_hari ?? 0),
      selAngka(b.lead_time_hari ?? 0),
      ya(b.boleh_eceran),
      ya(b.track_stok),
      ya(b.is_packaging),
      ya(b.is_complement),
      b.catatan ?? "",
    ]
      .map(selCsv)
      .join(","),
  );
  // baris contoh bila belum ada bahan sama sekali
  const contoh =
    bahan.length === 0
      ? [
          'AMS,"Air Mineral 330 ml",minuman,beli,50000,24,botol,dus,5,0,30,2,tidak,ya,tidak,tidak,contoh — hapus baris ini',
        ]
      : [];
  return [KOLOM_CSV.join(","), ...baris, ...contoh].join("\n");
}

/** Parser CSV sederhana: dukung sel berkutip, koma & baris baru di dalam kutip. */
export function parseCsv(teks: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  const t = teks.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((sel) => sel.trim() !== ""));
}

/**
 * Pola "ini pemisah RIBUAN", untuk sel yang cuma punya satu jenis pemisah.
 *
 * Grup pertama sengaja `[1-9]`, bukan `\d`: pemisah ribuan tak pernah mengikuti
 * nol telanjang. Tanpa syarat itu `0,125` — takaran yang lumrah ditulis orang —
 * cocok dengan pola ribuan dan terbaca 125. Bukan cuma soal ekspor: petugas
 * yang mengetik sendiri "0,125" di Excel pun mendapat 125, diam-diam.
 *
 * Yang memang tetap kabur dibiarkan kabur ke arah ribuan, karena itulah maksud
 * yang lebih lazim pada berkas ketikan tangan: `1.500` → 1500, `123,456` →
 * 123456. Ekspor tak pernah menghasilkan bentuk itu untuk pecahan (lihat
 * `selAngka`), jadi ronde ekspor→impor tetap utuh.
 */
const RIBUAN_KOMA = /^[1-9]\d{0,2}(,\d{3})+$/;
const RIBUAN_TITIK = /^[1-9]\d{0,2}(\.\d{3})+$/;

/**
 * Koersi angka dari sel CSV — toleran terhadap input pengguna/Excel:
 * - buang simbol mata uang ("Rp"), spasi, dan karakter lain ("Rp 10.000,-").
 * - titik/koma ribuan dibedakan dari desimal: bila keduanya ada, pemisah desimal
 *   adalah yang muncul TERAKHIR ("1.234,5" → 1234,5 · "1,234.5" → 1234.5). Bila
 *   hanya satu jenis, grup 3-digit dianggap ribuan ("10.000" → 10000), selain itu
 *   desimal ("1,5" → 1.5). Jadi harga ber-"Rp" tak lagi terbaca 0.
 */
function keAngka(v: string, fallback: number): number {
  let s = v.trim().replace(/rp/gi, "").replace(/[^0-9.,]/g, "");
  if (!s) return fallback;
  const adaTitik = s.includes(".");
  const adaKoma = s.includes(",");
  if (adaTitik && adaKoma) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".") // desimal koma (ID)
        : s.replace(/,/g, ""); // desimal titik (EN)
  } else if (adaKoma) {
    s = RIBUAN_KOMA.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (adaTitik && RIBUAN_TITIK.test(s)) {
    s = s.replace(/\./g, ""); // titik ribuan (mis. 10.000)
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function keBool(v: string, fallback: boolean): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  return ["ya", "1", "true", "y", "yes", "aktif", "eceran"].includes(s);
}

export interface TerbacaCsv {
  rows: BahanImportRow[];
  dilewatiTanpaNama: number;
  /**
   * Kolom `KOLOM_CSV` yang TIDAK ada di header berkas (selain `nama`, yang
   * ketiadaannya sudah membuat impor berhenti sendiri). Bukan kesalahan —
   * kolomnya sekadar tak dikelola berkas ini, dan nilainya dibiarkan apa
   * adanya — tapi WAJIB terlihat, karena itulah yang membedakan "tak disentuh"
   * dari "diisi nol".
   */
  kolomHilang: string[];
  /**
   * Baris yang kolom `isi`-nya ADA tapi terbaca ≤ 0 (mis. salah ketik "0").
   * `isi` adalah pembagi harga (`harga_beli / isi`), jadi nol tak punya arti
   * yang bisa dipakai; dulu dijepit ke 0,0001 dan diam — yang membuat harga per
   * satuannya 10.000× lipat, bukan gagal.
   */
  isiTakMasukAkal: number;
}

/** Ubah tabel CSV (baris pertama = header) menjadi baris impor bertipe. */
export function keRowsImpor(tabel: string[][]): TerbacaCsv {
  if (tabel.length === 0)
    return { rows: [], dilewatiTanpaNama: 0, kolomHilang: [], isiTakMasukAkal: 0 };
  const header = tabel[0].map((h) => h.trim().toLowerCase());
  const idx = (nama: string) => header.indexOf(nama);
  const iKode = idx("kode");
  const iNama = idx("nama");
  const iKat = idx("kategori");
  const iJenis = idx("jenis");
  const iHarga = idx("harga_beli");
  const iIsi = idx("isi");
  const iSatuan = idx("satuan");
  const iSatuanBeli = idx("satuan_beli");
  const iMin = idx("stok_minimum");
  const iMinBeli = idx("min_beli");
  const iMasaSimpan = idx("masa_simpan_hari");
  const iLeadTime = idx("lead_time_hari");
  const iEceran = idx("boleh_eceran");
  const iLacak = idx("lacak_stok");
  const iKemasan = idx("kemasan");
  const iComplement = idx("complement");
  const iCat = idx("catatan");
  const amb = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  /*
   * Inti perbaikannya ada di rangkaian `if (i >= 0)` di bawah: kolom yang absen
   * tak boleh punya nilai sama sekali, supaya `JSON.stringify` membuangnya dan
   * server tahu bedanya "diisi nol" dengan "tidak dikelola berkas ini". Sel
   * KOSONG pada kolom yang ADA tetap memakai fallback lamanya — itu memang
   * pernyataan penggunanya, bukan ketiadaan pernyataan.
   */
  const rows: BahanImportRow[] = [];
  let dilewatiTanpaNama = 0;
  let isiTakMasukAkal = 0;
  for (const r of tabel.slice(1)) {
    const nama = amb(r, iNama);
    if (!nama) {
      dilewatiTanpaNama++;
      continue;
    }
    // `isi` = pembagi harga. Nol/negatif bukan nilai yang bisa dipakai, jadi
    // kolomnya dilepas (bahan lama mempertahankan isinya) dan barisnya dihitung
    // supaya bisa disebut di layar — bukan dijepit diam-diam ke 0,0001.
    const isiSel = amb(r, iIsi);
    const isiAngka = iIsi >= 0 ? keAngka(isiSel, 1) : undefined;
    const isiSah = isiAngka !== undefined && isiAngka > 0;
    if (isiAngka !== undefined && !isiSah) isiTakMasukAkal++;
    const jenisRaw = amb(r, iJenis).toLowerCase();
    const row: BahanImportRow = { nama };
    if (iKode >= 0) row.kode = amb(r, iKode) || null;
    if (iKat >= 0) row.kategori = amb(r, iKat) || "lain";
    if (iJenis >= 0) row.jenis = jenisRaw.includes("produksi") ? "produksi" : "beli";
    if (iHarga >= 0) row.harga_beli = keAngka(amb(r, iHarga), 0);
    if (isiSah) row.isi = isiAngka;
    if (iSatuan >= 0) row.satuan = amb(r, iSatuan) || "pcs";
    if (iSatuanBeli >= 0) row.satuan_beli = amb(r, iSatuanBeli) || null;
    if (iMin >= 0) row.stok_minimum = keAngka(amb(r, iMin), 0);
    if (iMinBeli >= 0) row.min_beli = keAngka(amb(r, iMinBeli), 0);
    if (iMasaSimpan >= 0)
      row.masa_simpan_hari = Math.max(0, Math.trunc(keAngka(amb(r, iMasaSimpan), 0)));
    if (iLeadTime >= 0)
      row.lead_time_hari = Math.max(0, Math.trunc(keAngka(amb(r, iLeadTime), 0)));
    if (iEceran >= 0) row.boleh_eceran = keBool(amb(r, iEceran), false);
    if (iLacak >= 0) row.lacak_stok = keBool(amb(r, iLacak), true);
    if (iKemasan >= 0) row.kemasan = keBool(amb(r, iKemasan), false);
    if (iComplement >= 0) row.complement = keBool(amb(r, iComplement), false);
    if (iCat >= 0) row.catatan = amb(r, iCat) || null;
    rows.push(row);
  }
  const kolomHilang = KOLOM_CSV.filter((k) => k !== "nama" && !header.includes(k));
  return { rows, dilewatiTanpaNama, kolomHilang, isiTakMasukAkal };
}
