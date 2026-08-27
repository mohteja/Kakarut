import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga BILL YANG SUDAH DITUTUP — satu jalur yang lupa ikut dijaga.
 *
 * Sebuah open bill berakhir dengan dua cara, dan keduanya mengisi `closed_at`:
 * DIBAYAR (`createSale` sekaligus mengisi `sale_id`) atau DIBATALKAN
 * (`DELETE /open-bill/:id`, `sale_id` tetap null). Tiga jalur menghormati itu:
 *
 *   - `GET /open-bill/:id`  → `loadDetail` menyaring `closedAt` → 404
 *   - `GET /open-bill`      → `isNull(closedAt)` di WHERE
 *   - `DELETE /open-bill/:id` → `isNull(closedAt)` di WHERE → 404
 *   - `createSale`          → menolak menagih bill yang `closedAt`-nya terisi
 *
 * `PUT /open-bill/:id` tidak. Ia hanya memeriksa "ada" dan "satu perusahaan",
 * lalu menulis. Padahal justru PUT yang paling mungkin dilewati: layar kasir
 * memegang bill di memori (`editingBillId`), dan bill itu bisa saja baru
 * dibayar atau dibatalkan dari perangkat lain — persis skenario dua-perangkat
 * yang sudah diantisipasi modul ini di tempat lain (`FOR UPDATE` pada meja).
 *
 * Gagalnya sunyi di ketiga lapisan sekaligus:
 *
 *   1. Bill DIBAYAR → barisnya sudah disalin ke `sale_items`. Tambahan yang
 *      ditulis ke `open_bill_items` tak pernah ditagih dan tak muncul di kartu
 *      penjualan mana pun. Pesanannya hilang.
 *   2. Bill DIBATALKAN → seluruh barisnya bertanda `batal`; baris baru masuk
 *      dengan status hidup ke bill yang tak akan ditagih siapa pun.
 *   3. Kedua kasus berakhir di `loadDetail` yang memulangkan `null`, jadi
 *      klien menerima **200 berisi `null`** untuk tipe `OpenBillDetail` — dan
 *      `onSuccess` di KasirPage mengosongkan keranjang. Kasir membaca
 *      "tersimpan"; yang tersimpan tak ada.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const OB = baca("../src/modules/open-bill/routes.ts");

/** Potongan berkas sesudah penanda — supaya larangan tak membekap seluruh berkas. */
function sejak(src: string, penanda: string): string {
  const i = src.indexOf(penanda);
  expect(i, `penanda tak ditemukan: ${penanda}`).toBeGreaterThan(0);
  return src.slice(i);
}

describe("premis: jalur lain memang sudah menjaga bill tertutup", () => {
  it("`loadDetail` memperlakukan bill tertutup sebagai tidak ada", () => {
    expect(OB).toContain("if (!bill || bill.companyId !== companyId || bill.closedAt) return null;");
  });

  it("DELETE menyaring `closedAt` di WHERE-nya", () => {
    const del = sejak(OB, '.delete("/:id"');
    expect(del).toContain("isNull(openBills.closedAt)");
  });

  it("checkout pun menolak menagih bill yang sudah tertutup", () => {
    const jual = baca("../src/modules/penjualan/service.ts");
    expect(jual).toMatch(/if \(bill\.closedAt\)/);
  });
});

describe("PUT /open-bill/:id ikut menolak bill yang sudah ditutup", () => {
  const PUT = sejak(OB, '.put("/:id"');

  it("penjaganya ada dan berkode — klien membaca `kode`, bukan teks pesannya", () => {
    expect(PUT).toContain("if (existing.closedAt) {");
    expect(PUT).toContain('kode: "bill_sudah_ditutup"');
  });

  it("409, bukan 404 — bill-nya justru sedang tampil di layar kasir", () => {
    const iGuard = PUT.indexOf("if (existing.closedAt) {");
    const iTutup = PUT.indexOf("const katalog = await validateMenus");
    expect(PUT.slice(iGuard, iTutup)).toContain("409");
  });

  it("dibedakan: sudah dibayar vs sudah dibatalkan", () => {
    // Dua keadaan itu menuntut langkah berbeda dari kasir. "Bill sudah
    // ditutup" saja membuatnya menebak apakah tamunya sudah bayar.
    expect(PUT).toContain("sudah dibayar");
    expect(PUT).toContain("sudah dibatalkan");
    expect(PUT).toContain("sudah_dibayar: existing.saleId !== null");
  });

  it("diperiksa SEBELUM apa pun divalidasi atau ditulis", () => {
    // Bukan sekadar rapi: `validateMenus` dan `resolveMeja` memulangkan galat
    // lain (400/404) yang akan menutupi sebab sebenarnya, dan transaksi
    // penulisannya jelas tak boleh sempat berjalan.
    const iGuard = PUT.indexOf("if (existing.closedAt) {");
    const iMenu = PUT.indexOf("const katalog = await validateMenus");
    const iMeja = PUT.indexOf("const { mejaId, mejaLabel, tipe } = await resolveMeja");
    const iTulis = PUT.indexOf("await db.transaction");
    expect(iGuard, "penjaga tak ditemukan di PUT").toBeGreaterThan(0);
    expect(iMenu).toBeGreaterThan(iGuard);
    expect(iMeja).toBeGreaterThan(iGuard);
    expect(iTulis).toBeGreaterThan(iGuard);
  });

  it("tak ada lagi jalan menuju `loadDetail` yang null di akhir PUT", () => {
    // Nilai balik PUT bertipe `OpenBillDetail`. Satu-satunya cara `loadDetail`
    // memulangkan null di sini adalah bill yang tertutup — dan itu kini sudah
    // dicegat di atas.
    const iGuard = PUT.indexOf("if (existing.closedAt) {");
    const iAkhir = PUT.indexOf("return c.json(await loadDetail(auth.company_id!, id, cabangTerikat(c)));");
    expect(iGuard, "penjaga tak ditemukan di PUT").toBeGreaterThan(0);
    expect(iAkhir).toBeGreaterThan(iGuard);
  });
});

/**
 * Temuan kedua di endpoint yang sama: `PUT` menghapus kolom yang TIDAK dikirim.
 *
 * Bentuknya persis yang sudah dicabut dari `PUT /menu/:id` (dulu menghapus
 * resep, foto, dan arsip menu setiap kali menu disunting dari layar yang tak
 * mengelola ketiganya). Di sini korbannya dua, dan keduanya sunyi:
 *
 *   - `catatan` BILL tayang di kartu papan dapur, tapi `simpanBill` di
 *     KasirPage tak pernah mengirimnya. Catatan "tamu alergi udang" yang
 *     ditulis dari mobile lenyap dari layar dapur begitu kasir web menambah
 *     satu pesanan lagi.
 *   - `meja_id` yang dihilangkan MELEPAS bill dari mejanya. Mejanya lalu
 *     terlihat kosong, orang membuka bill kedua di sana, dan aturan "satu meja
 *     dine-in = satu bill" — yang dijaga sampai `SELECT … FOR UPDATE` di dua
 *     tempat — bocor lewat pintu belakang.
 */
describe("PUT hanya menyentuh kolom yang memang dikirim", () => {
  const PUT = sejak(OB, '.put("/:id"');
  const iSet = PUT.indexOf(".update(openBills)");
  const BLOK = PUT.slice(iSet, PUT.indexOf(".where(eq(openBills.id, id));", iSet));

  it("penulisan tak bersyarat sudah tidak ada lagi", () => {
    expect(BLOK).not.toMatch(/^\s*mejaId,$/m);
    expect(BLOK).not.toMatch(/^\s*mejaLabel,$/m);
    expect(BLOK).not.toContain("catatan: body.catatan?.trim() || null,\n");
  });

  it("keempat kolom metadata digerbang `!== undefined`", () => {
    expect(BLOK).toContain("...(body.meja_id !== undefined && { mejaId, mejaLabel })");
    expect(BLOK).toContain("...(body.customer_nama !== undefined && {");
    expect(BLOK).toContain("...(body.customer_wa !== undefined && {");
    expect(BLOK).toContain("...(body.catatan !== undefined && {");
  });

  it("meja & labelnya bergerak BERSAMA — label itu snapshot mejanya", () => {
    // Menulis salah satunya saja membuat bill menunjuk meja A dengan label
    // meja B; daftar bill mencocokkan lewat id, tapi struk & papan memakai
    // labelnya.
    expect(BLOK).not.toMatch(/\bmejaId\b(?![^}]*mejaLabel)/);
  });

  it("`updatedAt` TETAP tanpa syarat — barisnya memang baru saja disunting", () => {
    // Daftar bill diurutkan `desc(updatedAt)`; menggerbangnya akan membuat
    // bill yang barisnya berubah tenggelam di bawah bill yang tak disentuh.
    expect(BLOK).toContain("updatedAt: new Date(),");
    expect(BLOK).not.toContain("!== undefined && { updatedAt");
  });

  it("null EKSPLISIT tetap mengosongkan — zod membedakannya dari kunci absen", () => {
    // `z.string().nullish()` = nullable + optional. JSON tak bisa mengirim
    // undefined, jadi `!== undefined` tepat berarti "kuncinya ada".
    expect(OB).toContain("meja_id: z.string().uuid().nullish()");
    expect(OB).toContain("customer_nama: z.string().nullish()");
    expect(BLOK).toContain("body.customer_nama?.trim() || null");
  });

  it("premis: catatan bill memang dibaca papan dapur", () => {
    const papan = baca("../src/modules/pesanan/routes.ts");
    expect(papan).toContain("catatan: openBills.catatan,");
  });

  it("premis: aturan satu-meja-satu-bill memang bersandar pada meja_id", () => {
    expect(OB).toContain("eq(openBills.mejaId, mejaId)");
    expect(OB).toContain("FOR UPDATE");
  });
});

describe("KasirPage mengirim tegas apa yang memang dikelolanya", () => {
  const KASIR = baca("../../web/src/pages/kasir/KasirPage.tsx");

  /**
   * Dibatasi ke blok `simpanBill` saja — BUKAN seluruh berkas. Checkout
   * (`POST /penjualan`) memakai bentuk "hilangkan saat kosong" yang sama dan
   * di sana itu benar: ia MEMBUAT baris, tak ada nilai lama yang bisa
   * dilestarikan secara keliru.
   */
  const iSimpan = KASIR.indexOf("const simpanBill = useMutation({");
  const BODY = KASIR.slice(iSimpan, KASIR.indexOf("return editingBillId", iSimpan));

  it("nama & WA tamu SELALU dikirim — kosong pun, sebagai null", () => {
    // Kalau dihilangkan saat kosong, aturan "kunci absen = jangan sentuh"
    // justru membuat nama tamu yang baru DIHAPUS kasir bertahan di server.
    expect(BODY).toContain("customer_nama: konsumenNama.trim() || null,");
    expect(BODY).toContain("customer_wa: konsumenWa.trim() || null,");
    expect(BODY).not.toContain("...(konsumenNama.trim() ? { customer_nama:");
  });

  it("dan checkout TETAP boleh menghilangkannya — ia membuat, bukan menyunting", () => {
    expect(KASIR).toContain("...(konsumenNama.trim() ? { customer_nama: konsumenNama.trim() } : {})");
  });

  it("catatan BILL sengaja tidak dikirim — layar ini tak mengelolanya", () => {
    // Diamnya kini berarti "biarkan utuh", jadi catatan dari mobile selamat.
    // (`catatan` per BARIS tetap dikirim — itu memang milik layar ini.)
    const i = KASIR.indexOf("const simpanBill = useMutation({");
    const j = KASIR.indexOf("return editingBillId", i);
    const body = KASIR.slice(i, j);
    expect(body).not.toMatch(/^\s*catatan:/m);
    expect(body).toContain("catatan: l.catatan.trim()");
  });
});

/**
 * Sisi klien dari kejadian yang sama: kegagalan simpan bill yang tak terbaca.
 *
 * `useMutation` v5 memulangkan objek hasil BARU tiap render
 * (`return { ...result, mutate, mutateAsync }`), dan `MutationObserver`
 * mengganti `#currentResult` alih-alih menyuntingnya. Jadi objek yang
 * tertangkap closure sebuah `onClick` adalah POTRET saat render — membacanya
 * lagi sesudah `await` memberi keadaan sebelum mutasi jalan, selamanya.
 */
describe("KasirPage: kegagalan simpan bill tidak boleh dibaca dari potret lama", () => {
  const KASIR = baca("../../web/src/pages/kasir/KasirPage.tsx");

  it("tak ada lagi `simpanBill.isError` sesudah await", () => {
    expect(KASIR).not.toContain("if (simpanBill.isError) return;");
  });

  it("kegagalannya ditangkap penanda lokal di dalam `.catch`", () => {
    expect(KASIR).toMatch(/let gagal = false;\s*\n\s*await simpanBill\.mutateAsync\(\)\.catch\(\(\) => \{/);
    expect(KASIR).toContain("if (gagal) return;");
  });

  it("dan saat gagal, modalnya TETAP terbuka — di situlah galatnya tertulis", () => {
    // `<ErrorText error={simpanBill.error} />` hidup di dalam modal "Yakin
    // ganti meja?". Menutup modal saat gagal berarti membuang satu-satunya
    // tempat kasir bisa membaca sebabnya.
    const i = KASIR.indexOf("if (gagal) return;");
    const setelah = KASIR.slice(i, i + 200);
    expect(setelah).toContain("setGantiMejaOpen(false)");
    expect(KASIR.slice(0, i)).not.toContain("setGantiMejaOpen(false);\n                setMejaModalOpen(true);\n                let gagal");
  });
});
