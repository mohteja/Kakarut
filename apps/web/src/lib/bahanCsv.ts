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

/** Susun CSV dari daftar bahan — kolom persis form Ubah (ekspor & template). */
export function buatCsvBahan(bahan: BahanDto[]): string {
  const baris = bahan.map((b) =>
    [
      b.kode ?? "",
      b.nama,
      b.kategori,
      b.pengadaan,
      String(b.harga_beli),
      String(b.isi),
      b.satuan,
      b.satuan_beli ?? "",
      String(b.stok_minimum),
      String(b.min_beli ?? 0),
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
          'AMS,"Air Mineral 330 ml",minuman,beli,50000,24,botol,dus,5,0,tidak,ya,tidak,tidak,contoh — hapus baris ini',
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
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (adaTitik && /^\d{1,3}(\.\d{3})+$/.test(s)) {
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
}

/** Ubah tabel CSV (baris pertama = header) menjadi baris impor bertipe. */
export function keRowsImpor(tabel: string[][]): TerbacaCsv {
  if (tabel.length === 0) return { rows: [], dilewatiTanpaNama: 0 };
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
  const iEceran = idx("boleh_eceran");
  const iLacak = idx("lacak_stok");
  const iKemasan = idx("kemasan");
  const iComplement = idx("complement");
  const iCat = idx("catatan");
  const amb = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const rows: BahanImportRow[] = [];
  let dilewatiTanpaNama = 0;
  for (const r of tabel.slice(1)) {
    const nama = amb(r, iNama);
    if (!nama) {
      dilewatiTanpaNama++;
      continue;
    }
    const jenisRaw = amb(r, iJenis).toLowerCase();
    rows.push({
      kode: amb(r, iKode) || null,
      nama,
      kategori: amb(r, iKat) || "lain",
      jenis: jenisRaw.includes("produksi") ? "produksi" : "beli",
      harga_beli: keAngka(amb(r, iHarga), 0),
      isi: Math.max(keAngka(amb(r, iIsi), 1), 0.0001),
      satuan: amb(r, iSatuan) || "pcs",
      satuan_beli: amb(r, iSatuanBeli) || null,
      stok_minimum: keAngka(amb(r, iMin), 0),
      min_beli: keAngka(amb(r, iMinBeli), 0),
      boleh_eceran: keBool(amb(r, iEceran), false),
      lacak_stok: keBool(amb(r, iLacak), true),
      kemasan: keBool(amb(r, iKemasan), false),
      complement: keBool(amb(r, iComplement), false),
      catatan: amb(r, iCat) || null,
    });
  }
  return { rows, dilewatiTanpaNama };
}

/** Unduh string sebagai berkas CSV (BOM UTF-8 agar Excel membaca aksara Indonesia). */
export function unduhCsv(nama: string, isi: string) {
  const blob = new Blob([`﻿${isi}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nama;
  a.click();
  URL.revokeObjectURL(url);
}
