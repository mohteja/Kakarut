import { describe, expect, it } from "vitest";
import { situsTulis, tabelBerTenant, type SitusTulis } from "./util/tenant-tulis";

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
 *     · PARAMETER  25  tenant diputuskan PEMANGGIL (daftarnya di bawah)
 *     · TURUNAN     1  diwarisi dari baris induk yang dibaca terkurung
 *     · E          27  berkas yang memang lintas perusahaan (seed, admin, auth)
 *     · KLIEN       0  ← yang tak boleh ada, dan memang tak ada
 *     · TANPA       0  ← insert ke tabel ber-tenant yang lupa mengisinya
 *
 * Yang dijaga berkas ini: **dua angka nol terakhir**.
 */

/**
 * Situs yang tenant-nya diputuskan PEMANGGIL. Kuncinya BERKAS + JUMLAH — situs
 * baru menaikkan angkanya dan menagih satu keputusan, bukan lewat diam-diam.
 *
 * Belum ada kelas mekanis untuk "pemanggilnya membuktikan": itu menuntut
 * penelusuran antar-fungsi (parameter → destrukturisasi → tiap situs panggil),
 * dan sudah tercatat sebagai utang di ledger. Sampai ada, tiap berkas di sini
 * membawa alasan yang bisa diperiksa.
 */
const TENANT_DARI_PEMANGGIL = new Map<string, { situs: number; alasan: string }>([
  ["modules/perlengkapan/service.ts", { situs: 6, alasan:
    "seluruh pintu perlengkapan menerima `params: { companyId, … }` dari rute yang membacanya dari `auth.company_id!`; tak satu pun rute mengambilnya dari badan permintaan" }],
  ["modules/rekomendasi/rencana.ts", { situs: 5, alasan:
    "`params.companyId` dirakit `rencana()` yang dipanggil rute rekomendasi dengan `auth.company_id!`; `barisFaktur()` menuliskannya ke tiap baris faktur" }],
  ["modules/penjualan/service.ts", { situs: 2, alasan:
    "`createSale(params)` — dua pintu pembayaran (`POST /penjualan` dan `/sync`) sama-sama mengisi `params.companyId` dari token" }],
  ["modules/sync/idempoten.ts", { situs: 2, alasan:
    "kunci idempotensi ditulis dengan companyId milik sesi yang sedang menjalankan perintah; pemanggilnya `/sync` yang sudah ber-`requireCompany`" }],
  ["modules/absensi/routes.ts", { situs: 1, alasan:
    "`opts.companyId` dirakit di rute absensi yang sama dari `auth.company_id!` sebelum dioper ke pencatat" }],
  ["modules/customer/service.ts", { situs: 1, alasan:
    "`companyId` parameter `upsertCustomer`; pemanggilnya rute member & alur penjualan, keduanya dari token" }],
  ["modules/menu/routes.ts", { situs: 1, alasan:
    "`catatHargaMenu(tx, row)` menerima baris log yang SUDAH lengkap dari pemanggilnya di modul yang sama" }],
  ["modules/penjualan/refund.ts", { situs: 1, alasan:
    "`refundSajian(tx, params)` — `params.companyId` datang dari rute refund yang membacanya dari token" }],
  ["modules/penjualan/rekalkulasi.ts", { situs: 1, alasan:
    "`hitungUlangBiayaPenjualan(tx, saleId, companyId, …)` menerima companyId sebagai parameter dan memakainya di kueri pertamanya juga" }],
  ["modules/pesanan/routes.ts", { situs: 1, alasan:
    "`ctx.companyId` dirakit penangan rute papan pesanan dari `auth.company_id!` sebelum masuk `selaraskanTutupBill`" }],
  ["modules/produksi/konsumsi.ts", { situs: 1, alasan:
    "`companyId` parameter pencatat konsumsi produksi; pemanggilnya alur produksi yang sudah membaca faktur terkurung" }],
  ["modules/produksi/log.ts", { situs: 1, alasan:
    "`catatLogFaktur(tx, log)` menerima baris log lengkap; tiap pemanggil mengisinya dari `auth.company_id!`" }],
  ["modules/produksi/routes.ts", { situs: 1, alasan:
    "`arg.companyId` pada pencatat dana faktur, dirakit di rute yang sama dari token" }],
  ["modules/shift/routes.ts", { situs: 1, alasan:
    "`params.companyId` pada pembuka shift, dari `auth.company_id!` di rute yang sama" }],
]);

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

  it("tenant lewat PEMANGGIL: tiap berkas terdaftar, jumlahnya cocok, tak ada kuburan", () => {
    const hitung = new Map<string, number>();
    for (const x of per("PARAMETER")) hitung.set(x.berkas, (hitung.get(x.berkas) ?? 0) + 1);
    const salah: string[] = [];
    for (const [berkas, n] of hitung) {
      const d = TENANT_DARI_PEMANGGIL.get(berkas);
      if (!d) salah.push(`${berkas}: ${n} situs, belum terdaftar`);
      else if (d.situs !== n) salah.push(`${berkas}: terdaftar ${d.situs}, sekarang ${n}`);
    }
    for (const k of TENANT_DARI_PEMANGGIL.keys()) {
      if (!hitung.has(k)) salah.push(`${k}: sudah tak punya situs — hapus dari daftar`);
    }
    expect(salah, salah.join("\n")).toEqual([]);
    for (const [k, v] of TENANT_DARI_PEMANGGIL) {
      expect(v.alasan.length, `${k} tanpa alasan yang bisa diperiksa`).toBeGreaterThan(70);
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
