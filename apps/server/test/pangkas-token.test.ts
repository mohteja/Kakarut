import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import {
  RETENSI_TOKEN_HARI,
  RETENSI_UNDANGAN_HARI,
  UMUR_TOKEN_HARI,
} from "../src/lib/pangkas-token";

/**
 * RETENSI TABEL TOKEN — melengkapi retensi ledger sinkron.
 *
 * Entri retensi ledger menyebut tiga tabel debu yang sudah dipangkas lalu
 * berhenti; sapuan ulang atas 62 tabel menemukan tiga lagi tanpa satu pun
 * penghapus: `password_reset_tokens`, `email_verification_tokens`, dan
 * `invitations` — dua yang pertama menyimpan HASH TOKEN, jadi debunya
 * bermuatan kredensial mati.
 *
 * Terukur (2026-08-25, DB verify sesudah satu run penuh): 28 baris (2 reset ·
 * 13 verifikasi · 13 undangan). Sesudah pemangkas + backdate: **20 baris mati
 * terpangkas**, dan **kelima undangan `pending` SELAMAT** meski umurnya
 * 100 hari — pagar yang paling penting di berkas ini, karena undangan yang
 * masih berdiri tak punya kedaluwarsa sama sekali.
 *
 * Yang dipaku di sini: rasio retensi terhadap umur token (jendela tak boleh
 * menciut sampai menyentuh token yang masih hidup), pagar `pending`, dan
 * bahwa penyaringnya memakai kolom yang benar.
 */
const SUMBER = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/lib/pangkas-token.ts", import.meta.url)), "utf8"),
);

describe("retensi tabel token", () => {
  it("PREMIS + rasio: retensi token jauh melampaui umur token terpanjang", () => {
    expect(UMUR_TOKEN_HARI, "PREMIS: umur token tak masuk akal").toBeGreaterThan(0);
    expect(
      RETENSI_TOKEN_HARI,
      `retensi ${RETENSI_TOKEN_HARI} hari terlalu dekat dengan umur token ` +
        `${UMUR_TOKEN_HARI} hari — baris yang dibuang harus SUDAH pasti mati, ` +
        `bukan mungkin masih dipakai orang yang tautannya baru sampai`,
    ).toBeGreaterThanOrEqual(7 * UMUR_TOKEN_HARI);
    // Undangan tak punya kedaluwarsa, jadi jejaknya disimpan jauh lebih lama.
    expect(RETENSI_UNDANGAN_HARI).toBeGreaterThanOrEqual(RETENSI_TOKEN_HARI);
  });

  it("PAGAR: undangan yang masih pending TIDAK PERNAH dibuang", () => {
    expect(
      SUMBER,
      "syarat `pending` hilang — undangan yang masih berdiri (tanpa " +
        "kedaluwarsa) ikut terhapus karena umurnya saja",
    ).toContain('ne(invitations.status, "pending")');
  });

  it("menyaring lewat kolom yang benar: expires_at token, created_at undangan", () => {
    // `used_at` sengaja TIDAK jadi syarat: token kedaluwarsa tak bisa dipakai
    // lagi entah sudah terpakai atau belum. Yang salah justru menyaring dengan
    // `created_at` untuk token — umurnya beda-beda (1 jam vs 24 jam).
    expect(SUMBER).toContain("lt(passwordResetTokens.expiresAt, batasToken)");
    expect(SUMBER).toContain("lt(emailVerificationTokens.expiresAt, batasToken)");
    expect(SUMBER).toContain("lt(invitations.createdAt, batasUndangan)");
  });

  it("dijadwalkan, bukan sekadar tersedia", () => {
    const INDEX = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8"),
    );
    expect(INDEX, "penjadwalnya tak dipasang — pemangkas yang tak pernah jalan " +
      "sama saja dengan tak ada").toContain("jadwalkanPangkasToken(");
  });
});
