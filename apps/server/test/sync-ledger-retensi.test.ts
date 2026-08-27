import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { RETENSI_LEDGER_HARI } from "../src/modules/sync/idempoten";

/**
 * RETENSI LEDGER IDEMPOTENSI (`sync_commands`).
 *
 * Tiga tabel debu operasional lain dipangkas (`error_logs`, `backup_runs`,
 * `rate_limits`); ledger ini tidak — ≈ satu baris per transaksi ponsel
 * ber-`hasil_json` utuh, terukur 108 baris / 136 kB per run verify-api
 * (118 penjualan), ikut membengkakkan tiap cadangan selamanya. Pemangkasnya
 * terukur (2026-08-25): 8 baris, 4 di-backdate 100 hari → `pangkasLedgerSync`
 * membuang tepat 4, penyintasnya baris hari ini.
 *
 * SYARAT AMANNYA satu kalimat: retensi WAJIB jauh melampaui usia perintah
 * maksimum /sync — replay atas ref yang barisnya terpangkas lalu tertahan
 * gerbang usia (400) SEBELUM menyentuh eksekutor, jadi pemangkasan tak
 * pernah membuka kembali jendela eksekusi ganda. Uji ini memaku rasionya.
 */
const IDEMPOTEN = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/modules/sync/idempoten.ts", import.meta.url)), "utf8"),
);
const RUTE = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/modules/sync/routes.ts", import.meta.url)), "utf8"),
);
/**
 * Batas usia perintah PINDAH RUMAH ke `lib/waktu-kejadian.ts` saat aturan
 * batas waktu disatukan — dulu ia hidup hanya di `/sync` sementara sembilan
 * medan waktu lain dari klien tak dibatasi sama sekali. Yang dipaku uji ini
 * tetap ANGKANYA, bukan alamatnya.
 */
const BATAS_WAKTU = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/lib/waktu-kejadian.ts", import.meta.url)), "utf8"),
);

describe("retensi ledger sinkron", () => {
  it("PREMIS + rasio: retensi ≥ 2× usia perintah terpanjang", () => {
    const m = BATAS_WAKTU.match(/MAKS_UMUR_HARI[^=]*=\s*\{\s*penjualan:\s*(\d+)/);
    expect(m, "usia maksimum penjualan tak terbaca dari lib/waktu-kejadian.ts").not.toBeNull();
    const maksUmur = Number(m![1]);
    expect(maksUmur).toBeGreaterThan(0);
    expect(
      RETENSI_LEDGER_HARI,
      `retensi ${RETENSI_LEDGER_HARI} hari terlalu pendek untuk usia perintah ` +
        `${maksUmur} hari — baris yang terpangkas sebelum perintahnya kedaluwarsa ` +
        `membuka kembali jendela eksekusi ganda`,
    ).toBeGreaterThanOrEqual(2 * maksUmur);
  });

  it("pemangkasnya menyaring umur BARIS (created_at), bukan waktu kejadian", () => {
    // `waktu` = stempel kejadian di perangkat, bisa 30 hari lebih tua dari
    // sinkronnya — memangkas dengannya membuang baris yang baru saja ditulis.
    expect(IDEMPOTEN).toContain("lt(syncCommands.createdAt, batas)");
  });

  it("dipanggil menumpang penulisnya — ekor handler /sync, lepas-tangan", () => {
    expect(RUTE, "kaitan pemangkas dicabut — ledger kembali tumbuh selamanya")
      .toContain("void pangkasLedgerSync()");
  });
});
