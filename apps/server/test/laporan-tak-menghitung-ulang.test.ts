import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * ANGKA LAPORAN LAHIR DI SERVER — LAYAR TIDAK MENGHITUNGNYA ULANG.
 *
 * Vena "kebenaran angka laporan" (2026-09-02): §286 `verify-api.sh`
 * membandingkan kelima rute `/laporan/*` dengan angka yang dihitung tangan,
 * dan semuanya cocok. Yang tersisa untuk dijaga adalah SISI LAYAR: halaman
 * laporan yang merakit angka baru dari medan balasan (`omzet - diskon`,
 * `Σ total`, `rata = jumlah / n`) akan menyimpang dari server tanpa satu pun
 * gerbang server berubah warna — persis kelas "uang dihitung ulang di klien"
 * yang sudah dibayar 2026-08-22 untuk layar kasir, dan halaman laporan tak
 * pernah masuk populasinya.
 *
 * Populasi: seluruh `apps/web/src/pages/laporan/*.tsx`. Yang dicari
 * (komentar dibutakan): `reduce(` atas apa pun, dan operator aritmetika yang
 * salah satu sisinya medan angka balasan (`.omzet`, `.total`, `.qty`,
 * `.jumlah`, `_detik`, `.diskon`, `.hpp`). Situs yang memang sah didaftarkan
 * beralasan dengan kunci `berkas:pengenal` — bukan nomor baris — dan daftar
 * itu dijaga dua arah: tak ada yang tak beralasan, tak ada kuburan.
 *
 * BATASNYA, ditulis jujur: pemindai leksikal. Perhitungan yang disembunyikan
 * di pembantu (`hitungX(lap)`) di luar berkas laporan tak terlihat olehnya;
 * yang dijaga adalah bentuk yang paling sering lahir — aritmetika inline di
 * JSX.
 */

const DIR = fileURLToPath(new URL("../../web/src/pages/laporan", import.meta.url));

/** Situs yang sah, berkunci `berkas:pengenal`, dengan alasannya. */
const BERALASAN: Record<string, string> = {
  // Kedua jumlah ini ANGKA YANG MENDAMAIKAN: dicetak di kaki grafik supaya
  // pembaca bisa mencocokkan Σ batang dengan kartu di atasnya — server sudah
  // menjamin keduanya sama (§224, §286), dan justru itu yang dipertontonkan.
  "GrafikTransaksiPerJam.tsx:totalTransaksi": "Σ jumlah per jam, dicetak untuk dicocokkan dengan kartu Transaksi",
  "GrafikTransaksiPerJam.tsx:omzetGrafik": "Σ omzet per jam, dicetak untuk dicocokkan dengan kartu Omzet",
  // Pembanding pengurutan (b.qty − a.qty): urutan, bukan angka yang dibaca.
  "LaporanMenuLarisPage.tsx:items": "komparator pengurutan paling laris / paling cuan, bukan angka tampilan",
  // Tinggi batang: proporsi VISUAL (jumlah/skala×100), bukan angka yang dibaca.
  "GrafikTransaksiPerJam.tsx:tinggi": "tinggi batang grafik, proporsi visual",
  /*
   * Yang TIDAK ada di sini, dan itu temuannya: `LaporanPage` pernah menulis
   * "sebelum refund, omzetnya {omzet + total_refund}" — omzet kotor
   * ditambah nominal refund bersih. Terukur §286: 94.200 di layar untuk
   * omzet sebelum refund 92.000. Kini servernya yang mengirim
   * `omzet_sebelum_refund`; situs itu hilang, bukan didaftarkan.
   */
};

const MEDAN = "(?:omzet|total|qty|jumlah|diskon|hpp|nominal|[a-z_]*_detik|pengeluaran)";
const ARITMETIKA = new RegExp(`\\.${MEDAN}\\b\\s*[-+*/]|[-+*/]\\s*[a-zA-Z_.]*\\.${MEDAN}\\b`, "g");

export function situsHitungUlang(nama: string, isi: string): string[] {
  const s = butaKomentar(isi);
  const keluar: string[] = [];
  const baris = s.split("\n");
  for (const [n, b] of baris.entries()) {
    if (!/reduce\(/.test(b) && !ARITMETIKA.test(b)) continue;
    ARITMETIKA.lastIndex = 0;
    // Pengenal = nama const/let yang menerima hasilnya — di baris ini, atau
    // di awal pernyataan yang bersambung (paling jauh 3 baris ke atas). Tanpa
    // nama, kuncinya nomor baris — dan kunci nomor baris DILARANG beralasan
    // (bergeser tiap sunting), jadi situs seperti itu harus diberi nama dulu.
    let pengenal: string | null = null;
    for (let k = n; k >= Math.max(0, n - 3); k -= 1) {
      const m = baris[k].match(/(?:const|let)\s+([a-zA-Z_]\w*)\s*=/);
      if (m) { pengenal = m[1]; break; }
      if (k < n && /;\s*$/.test(baris[k])) break; // pernyataan sebelumnya sudah selesai
    }
    keluar.push(`${nama}:${pengenal ?? `baris-${n + 1}`}`);
  }
  return keluar;
}

describe("halaman laporan tidak menghitung ulang angka server", () => {
  const berkas = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
  const semua = berkas.flatMap((f) => situsHitungUlang(f, readFileSync(join(DIR, f), "utf8")));

  it("premis: populasinya terbaca, dan pemindainya menemukan situs yang sah", () => {
    expect(berkas.length).toBeGreaterThanOrEqual(5);
    expect(semua.length).toBeGreaterThanOrEqual(2);
  });

  it("tiap situs aritmetika atas medan balasan terdaftar beralasan", () => {
    const liar = semua.filter((k) => !BERALASAN[k]);
    expect(
      liar,
      `${liar.join(", ")}\n\nAngka laporan lahir di server (§286 membandingkannya dengan hitungan tangan). ` +
        "Kalau layar perlu angka turunan, minta servernya — atau daftarkan situsnya di " +
        "BERALASAN dengan alasan kenapa ia bukan angka yang dibaca orang.",
    ).toEqual([]);
  });

  it("daftar beralasannya bukan kuburan", () => {
    const kuburan = Object.keys(BERALASAN).filter((k) => !semua.includes(k));
    expect(kuburan, `terdaftar tapi sudah tak ada: ${kuburan.join(", ")}`).toEqual([]);
  });
});

describe("instrumennya bisa menuduh", () => {
  it("omzet − diskon di JSX tertangkap, dengan pengenal const-nya", () => {
    expect(situsHitungUlang("X.tsx", "const bersih = lap.omzet - lap.total_diskon;")).toEqual(["X.tsx:bersih"]);
  });
  it("reduce atas total tertangkap", () => {
    expect(situsHitungUlang("X.tsx", "const t = rows.reduce((a, r) => a + r.total, 0);")).toEqual(["X.tsx:t"]);
  });
  it("prosa yang mengutip rumus tidak menuduh", () => {
    expect(situsHitungUlang("X.tsx", "// laba = lap.omzet - lap.total_diskon\nconst a = 1;")).toEqual([]);
  });
  it("teks biasa tanpa medan angka tidak menuduh", () => {
    expect(situsHitungUlang("X.tsx", 'const judul = "Laporan " + nama;')).toEqual([]);
  });
});
