import { describe, expect, it } from "vitest";
import { buktiPemanggil, situsTulis, tabelBerTenant, type SitusTulis } from "./util/tenant-tulis";
import { grafPanggilan } from "./util/panggilan";

/**
 * BARIS BARU DAN TENANT-NYA — arah yang tak pernah punya gerbang.
 *
 * Sapuan pengurungan tenant hanya melihat `select`/`update`/`delete`: ketiganya
 * punya `.where`, dan pengurungannya terbaca di sana. **`insert` tak punya
 * `.where` sama sekali.** Pertanyaannya bukan "baris mana yang terbaca"
 * melainkan **"nilai `companyId` yang DITULIS ini datang dari mana"** — dan
 * kalau ia datang dari permintaan alih-alih dari token, satu penyewa menanam
 * baris di ruang penyewa lain.
 *
 * Ledger mencatat vena "Isolasi tenant pada PENULISAN" (2026-08-22) menyapu
 * 162 penulisan lalu menyatakannya bersih — *"tapi sapuannya hidup di
 * scratchpad dan tak pernah jadi gerbang."* Sampai hari ini `insert` memang
 * tak dijaga apa pun.
 *
 * HASIL SAPUAN, dan ia BERSIH — dengan angkanya:
 *
 *   tabel ber-`companyId`            42 dari 59
 *   insert ke tabel ber-tenant      101
 *     · AUTH       48  `auth.company_id!` langsung dari token
 *     · PARAMETER  25  tenant diputuskan PEMANGGIL — kini DIBUKTIKAN graf panggilan
 *     · TURUNAN     1  diwarisi dari baris induk yang dibaca terkurung
 *     · E          27  berkas yang memang lintas perusahaan (seed, admin, auth)
 *     · KLIEN       0  ← yang tak boleh ada, dan memang tak ada
 *     · TANPA       0  ← insert ke tabel ber-tenant yang lupa mengisinya
 *
 * Yang dijaga berkas ini: **dua angka nol terakhir**.
 */

/**
 * Pembantu pembawa tenant yang BELUM bisa dibuktikan mekanis.
 *
 * Daftar ini SENGAJA kosong hari ini, dan kosongnya berarti sesuatu: ke-20
 * pembantu yang membawa `companyId` lewat parameternya sudah dibuktikan lewat
 * GRAF PANGGILAN — tiap situs panggilnya, lintas berkas, mengoper tenant yang
 * menelusur ke `auth.company_id!` (atau berada di berkas kelas E, atau datang
 * dari pembantu yang sendirinya sudah terbukti). Titik-tetapnya konvergen dalam
 * 4 putaran.
 *
 * Sampai putaran ini isinya 14 berkas / 25 situs berisi alasan TULISAN TANGAN —
 * dan alasan tulisan tangan hanya menyatakan keadaan hari itu. Yang tak
 * dijaganya: pemanggil BARU. Sekarang pemanggil baru yang mengoper tenant dari
 * permintaan membuat pembantunya berhenti terbukti dan mendarat di sini.
 */
const BELUM_TERBUKTI = new Map<string, string>();

/** Situs yang mewarisi tenant dari baris INDUK yang sudah dibaca terkurung. */
const WARISAN = new Map<string, { situs: number; alasan: string }>([
  ["modules/produksi/routes.ts", { situs: 1, alasan:
    "`companyId: b.companyId` — `b` adalah baris `productions` yang baru saja dibaca & di-CAS lewat `kunci` ber-companyId di pernyataan tepat di atasnya; barisnya maju tahap, jadi tenant-nya memang tenant induknya" }],
]);

describe("tenant pada baris BARU: dari token, bukan dari permintaan", () => {
  const semua = situsTulis();
  const per = (k: SitusTulis["kelas"]) => semua.filter((x) => x.kelas === k);

  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(tabelBerTenant().size, "skema tak terbaca").toBeGreaterThanOrEqual(40);
    expect(semua.length, "tak ada insert terbaca").toBeGreaterThanOrEqual(90);
    expect(per("AUTH").length).toBeGreaterThan(30);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThan(20);
  });

  it("INTI: tak ada tenant yang datang dari PERMINTAAN", () => {
    const klien = per("KLIEN").map((x) => `${x.berkas}:${x.baris} [${x.tabel}] ← ${x.sumber}`);
    expect(
      klien,
      `\`companyId\` dipungut dari permintaan — penyewa memilih sendiri ruang yang ditulisinya:\n${klien.join("\n")}`,
    ).toEqual([]);
  });

  it("INTI: tiap insert ke tabel ber-tenant MENGISI companyId", () => {
    const tanpa = per("TANPA").map((x) => `${x.berkas}:${x.baris} [${x.tabel}]`);
    expect(
      tanpa,
      `insert ke tabel ber-\`companyId\` tanpa mengisinya — barisnya lahir tanpa penyewa:\n${tanpa.join("\n")}`,
    ).toEqual([]);
  });

  it("tenant lewat PEMANGGIL: DIBUKTIKAN grafnya, bukan dijanjikan daftarnya", () => {
    const b = buktiPemanggil(semua);
    expect(b.pembantu.length, "tak ada pembantu pembawa tenant terbaca").toBeGreaterThanOrEqual(15);
    const belum = [...b.belum].map(([n, a]) => `${n}: ${a}`);
    // Yang belum terbukti WAJIB terdaftar beralasan — tak boleh lewat diam-diam.
    const takTerdaftar = belum.filter((x) => !BELUM_TERBUKTI.has(x.split(":")[0]));
    expect(
      takTerdaftar,
      `pembantu membawa tenant lewat parameter, dan pemanggilnya tak bisa dibuktikan:\n${takTerdaftar.join("\n")}`,
    ).toEqual([]);
    for (const k of BELUM_TERBUKTI.keys()) {
      expect(b.belum.has(k), `entri daftar sudah terbukti — hapus: ${k}`).toBe(true);
    }
  });

  it("tenant WARISAN dari baris induk: terdaftar beralasan", () => {
    const hitung = new Map<string, number>();
    for (const x of per("TURUNAN")) hitung.set(x.berkas, (hitung.get(x.berkas) ?? 0) + 1);
    for (const [berkas, n] of hitung) {
      const d = WARISAN.get(berkas);
      expect(d, `${berkas}: ${n} situs warisan, belum terdaftar`).toBeTruthy();
      expect(d!.situs).toBe(n);
    }
    expect([...WARISAN.keys()].filter((k) => !hitung.has(k))).toEqual([]);
  });
});

describe("BUKTI MERAH: gerbangnya benar-benar bisa menuduh", () => {
  const sapu = (isi: string) => situsTulis([{ nama: "modules/palsu/routes.ts", isi }]);

  it("tenant dari badan permintaan → KLIEN", () => {
    const k = sapu("const x = await db.insert(sales).values({ companyId: body.company_id, total: 1 });");
    expect(k).toHaveLength(1);
    expect(k[0].kelas).toBe("KLIEN");
  });

  it("tenant dari `c.req.valid(...)` lewat satu nama → tetap KLIEN", () => {
    const k = sapu(
      "async function h(c) { const body = c.req.valid('json'); await db.insert(sales).values({ companyId: body.company_id }); }",
    );
    expect(k[0]?.kelas).toBe("KLIEN");
  });

  it("insert ke tabel ber-tenant tanpa companyId → TANPA", () => {
    const k = sapu("const x = await db.insert(sales).values({ total: 1 });");
    expect(k[0]?.kelas).toBe("TANPA");
  });

  it("PASANGAN: dari token → AUTH, dan tabel TANPA kolom tenant tak ikut disapu", () => {
    const k = sapu("async function h(c) { const auth = c.get('auth'); await db.insert(sales).values({ companyId: auth.company_id! }); }");
    expect(k[0]?.kelas).toBe("AUTH");
    // `saleItems` tak punya kolom companyId — bukan urusan sapuan ini.
    expect(sapu("await db.insert(saleItems).values({ qty: 1 });")).toEqual([]);
  });
});

describe("BUKTI MERAH graf panggilan: satu pemanggil baru cukup untuk memerahkan", () => {
  it("pemanggil ber-`body.company_id` membuat pembantunya BERHENTI terbukti", () => {
    const semua = situsTulis();
    const bersih = buktiPemanggil(semua);
    expect(bersih.terbukti.has("catatAbsen"), "premis hilang: catatAbsen tak lagi terbukti").toBe(true);

    const racun = {
      nama: "modules/palsu/routes.ts",
      isi: 'async function h(c) { const body = c.req.valid("json"); await catatAbsen({ companyId: body.company_id, userId: 1 }); }',
    };
    const kotor = buktiPemanggil(semua, grafPanggilan([racun]));
    expect(kotor.terbukti.has("catatAbsen"), "suntikan tak memerahkan apa pun").toBe(false);
    expect(kotor.belum.get("catatAbsen")).toMatch(/modules\/palsu\/routes\.ts:1 \[KLIEN\]/);

    // PASANGAN: yang lain tak ikut tumbang — tuduhannya tepat sasaran.
    expect(kotor.terbukti.has("createSale")).toBe(true);
    expect(kotor.terbukti.has("catatLogFaktur")).toBe(true);
  });
});

describe("PREMIS pemindai: empat bentuk perakit baris yang semuanya NYATA di repo ini", () => {
  const sapu = (isi: string) => situsTulis([{ nama: "modules/palsu/routes.ts", isi }]);

  it("`.map((b) => ({ … }))` — objeknya di dalam TANDA KURUNG", () => {
    // Bentuk ini memakan versi pertama pemindai: `ParenthesizedExpression`
    // adalah simpul tersendiri, dan 20 insert terbaca "tak menyebut companyId"
    // padahal menyebutnya.
    const k = sapu("async function h(c) { const auth = c.get('auth'); await db.insert(sales).values(items.map((b) => ({ companyId: auth.company_id! }))); }");
    expect(k[0]?.kelas).toBe("AUTH");
  });

  it("larik yang DIISI `.push(...)`, bukan dirakit sekaligus", () => {
    const k = sapu("async function h(c) { const auth = c.get('auth'); const values = []; values.push({ companyId: auth.company_id! }); await db.insert(sales).values(values); }");
    expect(k[0]?.kelas).toBe("AUTH");
  });

  it("pembantu bernama ber-badan EKSPRESI (`const f = (r) => r.map(…)`)", () => {
    const k = sapu("async function h(c) { const auth = c.get('auth'); const baris = (r) => r.map((b) => ({ companyId: auth.company_id! })); await db.insert(sales).values(baris(rows)); }");
    expect(k[0]?.kelas).toBe("AUTH");
  });

  it("elemen SEBAR di dalam larik `values([...a, ...b])`", () => {
    const k = sapu("async function h(c) { const auth = c.get('auth'); const baris = (r) => r.map((b) => ({ companyId: auth.company_id! })); await db.insert(sales).values([...baris(a), ...baris(b)]); }");
    expect(k[0]?.kelas).toBe("AUTH");
  });
});
