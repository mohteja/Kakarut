/**
 * KASIR: NAMA SAJA TAK PERNAH JADI MEMBER — DAN KASIR DIBERI TAHU.
 *
 * Laporan pemilik: "nama customer yang di input di kasir belum tersimpan di
 * member". Bukan bug — `upsertCustomer` memang tak membuat member tanpa WA
 * yang sah (identitas member adalah nomornya). Keputusan yang diambil:
 * aturannya TETAP, tapi kasir tak boleh menemukannya seminggu kemudian saat
 * tamunya dicari di Member dan tak ada — layar mengatakannya sambil mengetik.
 *
 * Tiga hal yang dipaku:
 *   · premis: server memang menolak WA < 6 angka (bila ini berubah, ambang
 *     layar harus ikut — uji berikutnya yang menagihnya);
 *   · ambang layar MENYALIN ambang server: dijalankan berdampingan di deret
 *     0..8 angka, layar diam PERSIS ketika server menerima;
 *   · KasirPage merender petunjuk itu dari keadaan yang SAMA dengan yang
 *     nanti dikirim (`konsumenNama`/`konsumenWa`), di bawah medannya.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MIN_DIGIT_WA, digitWa, petunjukMember } from "../../web/src/lib/member-wa";
import { normalizeWa } from "../src/modules/customer/service";

const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("kasir: nama saja tak pernah jadi member — dan kasir DIBERI TAHU", () => {
  it("premis: server memang tak membuat member tanpa WA sah (≥ 6 angka)", () => {
    expect(normalizeWa("Budi")).toBeNull();
    expect(normalizeWa("0812-3")).toBeNull();
    expect(normalizeWa("+62 812-34")).toBe("6281234");
    const SVC = baca("../src/modules/customer/service.ts");
    const iUpsert = SVC.indexOf("export async function upsertCustomer(");
    expect(iUpsert).toBeGreaterThan(-1);
    expect(SVC.slice(iUpsert, iUpsert + 600)).toContain("if (!wa) return null;");
  });

  it("ambang layar MENYALIN ambang server, bukan menebaknya", () => {
    for (let n = 0; n <= 8; n++) {
      const wa = "8".repeat(n);
      expect(petunjukMember("Budi", wa) === null, `WA ${n} angka`).toBe(normalizeWa(wa) !== null);
    }
    expect(MIN_DIGIT_WA).toBe(6);
  });

  it("nama tanpa WA → menyebut nama & tempatnya; WA pendek → menyebut jumlah angkanya", () => {
    expect(petunjukMember("  Budi  ", "")).toContain("Budi");
    expect(petunjukMember("Budi", "")).toContain("tidak tersimpan sebagai member");
    expect(petunjukMember("", "0812")).toContain("terlalu pendek (4 angka)");
    expect(petunjukMember("", "")).toBeNull();
    expect(petunjukMember("   ", "")).toBeNull();
    expect(digitWa("+62 812-3456")).toBe("628123456");
  });

  it("KasirPage merender petunjuknya di bawah medan nama/WA, dari keadaan yang dikirim", () => {
    const KASIR = baca("../../web/src/pages/kasir/KasirPage.tsx");
    expect(KASIR).toContain('import { petunjukMember } from "../../lib/member-wa";');
    expect(KASIR).toContain("const petunjukKonsumen = petunjukMember(konsumenNama, konsumenWa);");
    const iMedan = KASIR.indexOf('placeholder="📱 No. WhatsApp"');
    expect(iMedan, "premis: medan WA masih ada").toBeGreaterThan(-1);
    const iSaran = KASIR.indexOf("{memberOpen && memberSaran.length > 0 && (", iMedan);
    expect(iSaran, "premis: dropdown saran member sesudah medannya").toBeGreaterThan(iMedan);
    const antara = KASIR.slice(iMedan, iSaran);
    expect(antara).toContain("{petunjukKonsumen && (");
    expect(antara).toContain("{petunjukKonsumen}");
  });
});
