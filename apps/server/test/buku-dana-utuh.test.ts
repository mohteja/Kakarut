import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * BUKU DANA FAKTUR: satu bentuk, satu kosakata, satu aritmetika.
 *
 * Vena ini yang paling TIPIS dari deretannya, dan itu ditulis apa adanya:
 * barisnya cocok satu-satu dengan kawat sejak awal — tak ada medan yang
 * dikirim tanpa disebut, tak ada layar yang menghitung ulang. Yang belum ada
 * cuma NAMANYA.
 *
 * Tiga hal yang tetap layak dipaku:
 *
 *  1. **Amplopnya** `{rows, total}` tak pernah dideklarasikan — salah satu dari
 *     20 amplop yang dihitung `amplop-berkontrak` (#103). Dibayar di sini → 19.
 *  2. **Kosakata `tipe`** dieja DUA kali tanpa rumah bersama: `pgEnum` di skema
 *     dan tangan di `FakturDetailPage.tsx`. Ia satu dari LIMA pgEnum (dari 27)
 *     yang tak punya padanan kontrak; sesudah putaran ini EMPAT.
 *  3. **`waktu`** `Date` di Drizzle, ISO di kawat — kelas keempat berturut-turut
 *     sesudah `planExpiresAt` (#99), `archived_at` (#101), `waktu` penerimaan
 *     (#106).
 *
 * Dan satu hal yang DIBUKTIKAN BERSIH, bukan diasumsikan: sapuan atas 27
 * `pgEnum` menemukan 22 sudah berpasangan nilai-identik dengan union kontrak,
 * dan pasangan itu MEMANG dijaga. Dibuktikan dua arah — menambah nilai
 * karangan ke `MetodeBayar` memerahkan typecheck DAN `status-satu-kontrak`;
 * menambahnya ke `SmtpEncryption` (yang tak punya `Record<>` eksklusif)
 * memerahkan `status-satu-kontrak` saja, dengan typecheck tetap hijau. Kelas
 * itu tak perlu penjaga baru.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const RUTE = "apps/server/src/modules/produksi/routes.ts";
const TIPE = "packages/shared/src/types.ts";
const SKEMA = "apps/server/src/db/schema.ts";
const WEB = "apps/web/src/pages/produksi/FakturDetailPage.tsx";

describe("buku dana faktur: bentuk, kosakata, dan aritmetikanya", () => {
  const rute = readFileSync(AKAR + RUTE, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");

  it("PREMIS: ketiga tipenya ada di kontrak", () => {
    expect(medanInterface(tipe, "DanaEntri").length, "DanaEntri bukan 6 medan").toBe(6);
    expect(medanInterface(tipe, "BukuDanaFaktur").sort()).toEqual(["rows", "total"]);
    expect(tipe).toMatch(/export type TipeDana = "cair" \| "tambahan" \| "kembali";/);
  });

  it("INTI: literal perakit == DanaEntri (dua arah)", () => {
    const buta = butaKomentar(rute);
    const i = buta.indexOf("const entri: DanaEntri[] = rows.map((r) => ({");
    expect(i, "perakit entri dana tak ditemukan").toBeGreaterThan(0);
    const dibangun = kunciObjek(buta, buta.indexOf("{", buta.indexOf("=> ({", i))).sort();
    const kontrak = medanInterface(tipe, "DanaEntri");
    expect(dibangun.filter((k) => !kontrak.includes(k)), "dibangun tapi tak di DanaEntri").toEqual([]);
    expect(kontrak.filter((k) => !dibangun.includes(k)), "di DanaEntri tapi tak dibangun").toEqual([]);
  });

  it("INTI: `waktu` DIPETAKAN, dan amplopnya dinyatakan", () => {
    const buta = butaKomentar(rute);
    expect(buta).toMatch(/waktu: r\.waktu\.toISOString\(\),/);
    expect(buta, "amplop buku dana tak menyatakan tipenya").toContain(
      "{ rows: entri, total } satisfies BukuDanaFaktur",
    );
  });

  it("INTI: `kembali` DIKURANGKAN — satu aritmetika, di server", () => {
    /*
     * Inilah satu-satunya asersi di berkas ini yang menjaga ANGKA, bukan
     * bentuk. `total` dibaca layar faktur sebagai "dana efektif"; penjumlahan
     * yang lupa membalik tanda `kembali` memulangkan angka yang terlalu besar,
     * dan tak ada yang akan menyadarinya sampai kas tak cocok.
     */
    const buta = butaKomentar(rute);
    expect(buta).toMatch(/r\.tipe === "kembali" \? -r\.nominal : r\.nominal/);
    // …dan klien TIDAK menghitungnya ulang.
    const web = butaKomentar(readFileSync(AKAR + WEB, "utf8"));
    expect(web, "layar faktur menghitung ulang total dana").not.toMatch(/\.rows\.reduce\(/);
    expect(web, "layar faktur tak memakai total dari server").toMatch(/dana\.total/);
  });

  it("INTI: kosakata `tipe` dieja SATU kali di luar skemanya", () => {
    const skema = butaKomentar(readFileSync(AKAR + SKEMA, "utf8"));
    // Skema adalah SUMBERnya — ia memang mengeja nilainya, dan itu benar.
    expect(skema).toMatch(/pgEnum\("dana_tipe", \["cair", "tambahan", "kembali"\]\)/);
    // Di luar skema & kontrak, tak boleh ada ejaan ketiga.
    const web = butaKomentar(readFileSync(AKAR + WEB, "utf8"));
    expect(web, "layar faktur mengeja ulang kosakata dana").not.toMatch(
      /"cair"\s*\|\s*"tambahan"\s*\|\s*"kembali"/,
    );
    expect(web, "layar faktur tak memakai amplop kontrak").toMatch(/BukuDanaFaktur/);
    expect(web, "salinan lokal DanaEntri masih ada").not.toMatch(/interface DanaEntri\s*\{/);
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan & medan karangan", () => {
    const palsuRute = rute.replace(
      "        id: r.id,\n        tipe: r.tipe,",
      "        id: r.id,\n        kunci_karangan: 1,\n        tipe: r.tipe,",
    );
    const buta = butaKomentar(palsuRute);
    const i = buta.indexOf("const entri: DanaEntri[] = rows.map((r) => ({");
    expect(kunciObjek(buta, buta.indexOf("{", buta.indexOf("=> ({", i)))).toContain(
      "kunci_karangan",
    );
    const palsuTipe = tipe.replace(
      "export interface DanaEntri {",
      "export interface DanaEntri {\n  medan_karangan: string;",
    );
    expect(medanInterface(palsuTipe, "DanaEntri")).toContain("medan_karangan");
    // …dan pola aritmetikanya memang membedakan tanda yang benar dari yang salah.
    expect(/r\.tipe === "kembali" \? -r\.nominal : r\.nominal/.test("x + (r.tipe === \"kembali\" ? -r.nominal : r.nominal)")).toBe(true);
    expect(/r\.tipe === "kembali" \? -r\.nominal : r\.nominal/.test("x + r.nominal")).toBe(false);
  });
});
