import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * SATU KUNCI IDEMPOTENSI UNTUK DUA PERCOBAAN (online → offline).
 *
 * Komentar `OpnameBody` stok menulis aturannya dan `sync_queue.tambah()`
 * menulis kegunaannya — lalu sapuan 10 situs enqueue menemukan 6 yang tak
 * pernah membagi `clientRef` antara percobaan online dan antrean offline,
 * dan modul perlengkapan bahkan tak punya medan kuncinya (0 dari 22 pintu
 * tulis; skema strict → mengirimnya = 400).
 *
 * Terukur lewat HTTP (2026-08-25), percobaan online yang COMMIT + replay
 * via /sync ber-ref BARU (persis yang terjadi saat balasan online hilang):
 *   SEBELUM: `pakai 7` → saldo 100→93→**86** (potongan GANDA, balasan ok) ·
 *            opname → **2 sesi kembar** menunggu dua ACC ·
 *            tahap → 400 "Tahap tidak berurutan" = item antrean `gagal`
 *            PALSU untuk aksi yang sukses (mesin status mencegah gandanya)
 *   SESUDAH (ref DIBAGI): pakai replay → `sudah_ada`, saldo tetap; pasangan
 *            ref baru tetap dieksekusi · opname +1 sesi saja · tahap replay
 *            → `sudah_ada` · shift_buka diadjudikasi toleran (terukur:
 *            replay → 1 shift + `sudah_terbuka`, tanpa kunci pun benar)
 *
 * Pintu kirim (`/kirim`, `/kirim-hasil`) dijaga mesin status (tak bisa
 * ganda) — bagian mereka adalah MENCATAT hasil sukses ke ledger bersama
 * (`catatHasilIdempoten`) supaya replay dibalas `sudah_ada`, bukan 400 yang
 * tampak gagal. Mekanisme baca-ledger-nya (fast-path /sync) persis yang
 * diukur pada tiga pintu di atas; yang dipaku di sini bentuk TULISNYA.
 */
const PERLENGKAPAN = butaKomentar(
  readFileSync(
    fileURLToPath(new URL("../src/modules/perlengkapan/routes.ts", import.meta.url)),
    "utf8",
  ),
);
const PRODUKSI = butaKomentar(
  readFileSync(
    fileURLToPath(new URL("../src/modules/produksi/routes.ts", import.meta.url)),
    "utf8",
  ),
);

describe("idempotensi dua percobaan", () => {
  it("PREMIS: keempat skema pintu membawa medan kuncinya", () => {
    // PakaiBody & OpnameBody (perlengkapan) + KirimBody (produksi; KirimHasil
    // extend darinya). Tanpa medan ini skema strict menolak refnya = 400.
    const pakai = PERLENGKAPAN.slice(PERLENGKAPAN.indexOf("const PakaiBody"), PERLENGKAPAN.indexOf("const KoreksiBody"));
    expect(pakai).toContain("client_ref: clientRefField");
    const opname = PERLENGKAPAN.slice(PERLENGKAPAN.indexOf("const OpnameBody"), PERLENGKAPAN.indexOf("const StokAwalBody"));
    expect(opname).toContain("client_ref: clientRefField");
    const kirim = PRODUKSI.slice(PRODUKSI.indexOf("const KirimBody"), PRODUKSI.indexOf("const TahapBody"));
    expect(kirim).toContain("client_ref: clientRefField");
  });

  it("pakai & opname perlengkapan: SELURUH badan handler di dalam klaim atomik", () => {
    expect(PERLENGKAPAN, "klaim perlengkapan_pakai dicabut — replay memotong stok dua kali (terukur 100→93→86)")
      .toContain('tipe: "perlengkapan_pakai"');
    expect(PERLENGKAPAN, "klaim perlengkapan_opname dicabut — satu niat melahirkan sesi kembar")
      .toContain('tipe: "perlengkapan_opname"');
    // Keduanya lewat denganKlaimIdempoten (bukan sekadar catat-sesudah):
    // pintu ini MEMINDAHKAN stok, jadi butuh klaim sebelum eksekusi.
    const jumlahKlaim = PERLENGKAPAN.split("denganKlaimIdempoten(").length - 1;
    expect(jumlahKlaim).toBeGreaterThanOrEqual(2);
  });

  it("kirim & kirim-hasil: hasil sukses DICATAT ke ledger bersama", () => {
    expect(PRODUKSI, "catat faktur_kirim hilang — replay dibalas 400 mesin-status yang tampak gagal")
      .toContain('tipe: "faktur_kirim"');
    expect(PRODUKSI).toContain('tipe: "produksi_kirim_hasil"');
    const jumlahCatat = PRODUKSI.split("catatHasilIdempoten(").length - 1;
    expect(jumlahCatat).toBeGreaterThanOrEqual(2);
  });

  it("PASANGAN: klaim tahap yang sudah ada tak ikut tercabut", () => {
    expect(PRODUKSI).toContain("tipe: `tahap_${tipe}`");
  });
});
