import { describe, expect, it } from "vitest";
import { buildReceiptBytes, labelCabangKertas } from "@kakarut/shared";

/**
 * "Cabang Cabang Demo" (laporan uji 31 Okt 2026): kepala struk, bon, dan slip
 * menempelkan "Cabang " pada nama yang sudah diawali "Cabang".
 */
describe("labelCabangKertas", () => {
  it("tak menggandakan awalan, tetap menambahkannya bila belum ada", () => {
    expect(labelCabangKertas("Cabang Demo")).toBe("Cabang Demo");
    expect(labelCabangKertas("cabang 2")).toBe("cabang 2");
    expect(labelCabangKertas("  Pusat ")).toBe("Cabang Pusat");
    // "Cabangan" bukan awalan "Cabang " — kata utuh saja yang dihitung.
    expect(labelCabangKertas("Cabangan Raya")).toBe("Cabang Cabangan Raya");
  });

  it("tak ada lagi rumusan `Cabang ${…}` mentah di pembangun kertas", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    for (const f of ["receipt.ts", "bon-tagihan.ts", "order-slip.ts"]) {
      const src = readFileSync(fileURLToPath(new URL(`../../../packages/shared/src/${f}`, import.meta.url)), "utf8");
      expect(src, f).not.toContain("b.text(`Cabang ${");
      expect(src, f).toContain("b.text(labelCabangKertas(data.branchNama));");
    }
    expect(typeof buildReceiptBytes).toBe("function");
  });
});
