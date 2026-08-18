import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * UPSERT TIDAK BISA MENYATAKAN "JANGAN SENTUH KOLOM INI".
 *
 * Provisi akun tamu berjalan di SETIAP boot server. Keanggotaan kasirnya dulu
 * dipasang dengan satu upsert:
 *
 *   .values({ role: "cashier", branchId: branchId ?? undefined, … })
 *   .onConflictDoUpdate({ set: { …, ...(branchId ? { branchId } : {}) } })
 *
 * Niatnya benar dan tertulis di komentarnya: `branchId` hanya diketahui saat
 * provisi BARU, jadi pada boot berikutnya jangan menimpa cabang yang mungkin
 * sudah disetel orang.
 *
 * Tapi upsert tak bisa menyatakan niat itu. Postgres mengevaluasi CHECK pada
 * baris USULAN — sebelum `ON CONFLICT` sempat mengalihkannya ke UPDATE. Dan
 * `memberships_cashier_branch_ck` berbunyi:
 *
 *   role IN ('owner','admin') OR branch_id IS NOT NULL
 *
 * Jadi menyusun kandidat ber-`branch_id` NULL meledakkan SELURUH provisi tamu,
 * walau barisnya sudah ada dan cabangnya sudah benar:
 *
 *   ERROR: new row for relation "memberships" violates check constraint
 *          "memberships_cashier_branch_ck"
 *
 * Yang membuatnya bertahan lama: galatnya hanya `console.warn` di `index.ts`,
 * jadi server tetap menyala dan akun demo diam-diam berhenti diperbarui.
 * Terukur — gagal di SETIAP boot pada basis data yang perusahaannya sudah ada.
 */
const GUEST = readFileSync(
  fileURLToPath(new URL("../src/seed/guest.ts", import.meta.url)),
  "utf8",
);
const SCHEMA = readFileSync(
  fileURLToPath(new URL("../src/db/schema.ts", import.meta.url)),
  "utf8",
);

describe("provisi tamu: keanggotaan kasir tak boleh lewat upsert", () => {
  it("batasan yang melandasinya masih ada — uji ini tak menjaga hantu", () => {
    // Kalau CHECK-nya dihapus kelak, seluruh alasan uji ini gugur dan ia harus
    // ikut dibuang, bukan dibiarkan menjaga aturan yang tak lagi berlaku.
    expect(SCHEMA).toContain("memberships_cashier_branch_ck");
    expect(SCHEMA).toContain("IN ('owner','admin') OR");
  });

  it("tak ada lagi kandidat kasir ber-branchId opsional", () => {
    // Bentuk lama yang meledak. `?? undefined` pada kolom yang WAJIB terisi
    // adalah tanda bahwa penulisnya mengira ON CONFLICT akan menyelamatkannya.
    expect(GUEST).not.toContain("branchId: branchId ?? undefined");
  });

  it("jalur SUDAH-ADA memakai UPDATE, bukan upsert", () => {
    // Hanya UPDATE yang bisa menyatakan "sentuh kolom ini saja".
    const iCari = GUEST.indexOf("const [adaKasir] = await tx");
    const iUpdate = GUEST.indexOf(".update(memberships)", iCari);
    expect(iCari, "pencarian keanggotaan kasir tak ditemukan").toBeGreaterThan(0);
    expect(iUpdate).toBeGreaterThan(iCari);
  });

  it("jalur BELUM-ADA selalu membawa cabang yang nyata", () => {
    // INSERT-nya harus punya cabang — dicari lebih dulu bila tak diberikan,
    // dan gagal keras bila perusahaan demo memang tak punya cabang sama sekali.
    expect(GUEST).toContain("const cabangKasir =");
    expect(GUEST).toContain("branchId: cabangKasir,");
    expect(GUEST).toContain("Perusahaan demo tak punya cabang");
  });

  it("keanggotaan OWNER boleh tetap upsert — CHECK tak mengikatnya", () => {
    // Penjaga arah sebaliknya: jangan sampai perbaikan ini dipahami sebagai
    // "upsert itu buruk". Owner tak butuh cabang, jadi upsert di sana sah dan
    // memang lebih ringkas.
    const iOwner = GUEST.indexOf('role: "owner"');
    expect(iOwner).toBeGreaterThan(0);
    expect(GUEST.slice(iOwner, iOwner + 400)).toContain("onConflictDoUpdate");
  });
});
