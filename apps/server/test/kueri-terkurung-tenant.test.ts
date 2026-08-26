import { describe, expect, it } from "vitest";
import { daftarSumber, kelas, petaKelas, rantai, semuaKueri, type Kueri } from "./util/kueri-terkurung";

/**
 * SETIAP KUERI TERKURUNG PERUSAHAANNYA — arah BACA dan TULIS.
 *
 * Ledger sudah punya entri "Isolasi tenant pada PENULISAN" (2026-08-22): 162
 * penulisan disapu, BERSIH. Dua hal yang tak dikerjakannya, dan keduanya
 * dibayar di sini:
 *
 *   1. sapuannya hidup di scratchpad — tak ada gerbang berdiri, jadi
 *      penulisan baru tanpa pengurungan bisa lahir hari ini tanpa satu uji
 *      pun berubah warna;
 *   2. arah BACA tak pernah dihitung sekali pun. Di SaaS multi-tenant itu
 *      kelas kerusakan tertinggi: satu warung membaca data warung lain.
 *
 * Populasi terukur 2026-08-26: **627** kueri (469 baca + 158 tulis).
 *
 *   A   389  mengurung `companyId` (atau `companies.id`) di rantainya sendiri
 *   A2   51  lewat variabel/`and(...conds)` — satu tingkat
 *   B    23  lewat `branchId` (cabangnya sendiri lahir dari `resolveBranchId`)
 *   C    46  kunci saringnya ikut dioper ke pemanggilan ber-`company_id`
 *   E    68  memang LINTAS perusahaan: auth, panel super admin, cadangan, seed
 *   F    50  tak teresolusi mekanis → DIPILAH TANGAN, daftarnya di bawah
 *
 * Diukur juga lewat HTTP dengan DUA tenant sungguhan (id milik tenant A
 * dibuktikan terbaca oleh A lebih dulu): sebelas rute detail ber-`:id`
 * ditembak dengan token tenant B → **404 semua**, A → 200 semua. Lihat §260
 * verify-api.
 */

/**
 * Ke-50 situs kelas F, dipilah TANGAN — bukan "belum sempat".
 *
 * Kuncinya BERKAS + JUMLAH, bukan nomor baris: gerbang di repo ini sudah
 * sekali patah karena memaku baris yang bergeser gara-gara komentar. Situs
 * baru di berkas yang sama menaikkan jumlahnya → merah, dan menagih keputusan.
 */
const DIPILAH_TANGAN = new Map<string, { situs: number; alasan: string }>([
  ["modules/produksi/routes.ts", { situs: 8, alasan:
    "kunci `inArray` lahir dari baris yang SUDAH terkurung (`byId`, `rows`, `kirimMap`, `batchByProd`); sisanya menulis ke `productions.id` hasil select ber-`conds` yang memuat companyId" }],
  ["modules/bahan/routes.ts", { situs: 5, alasan:
    "`id` diverifikasi `eq(ingredients.companyId, auth.company_id!)` lebih dulu di handler yang sama (mis. :1663), lalu anak-anaknya (`ingredientSteps`, `ingredientComponents`, `ingredientProduksiBranches`) dibaca/dihapus lewat id itu" }],
  ["modules/pesanan/routes.ts", { situs: 5, alasan:
    "`pastikanKartu(jenis, id, auth.company_id!, branchId)` dipanggil sebelum baris anak disentuh; `billIds`/`saleIds` daftar papan lahir dari query ber-companyId tepat di atasnya" }],
  ["modules/open-bill/routes.ts", { situs: 3, alasan:
    "`loadDetail` membaca bill lalu MENOLAK di JS (`bill.companyId !== companyId`) sebelum apa pun dipakai; anaknya dibaca lewat `billId` yang sudah lolos itu" }],
  ["modules/penjualan/routes.ts", { situs: 4, alasan:
    "`sale` datang dari select ber-companyId; `saleItems.saleId = sale.id` dan `users.id = sale.cashierUserId` mengikutinya (tabel `users` memang global — venanya sendiri)" }],
  ["modules/kebersihan/routes.ts", { situs: 3, alasan:
    "`ids` laporan lahir dari query ber-`syarat` yang memuat companyId; itemnya dibaca/dihapus per `reportId` dari daftar itu" }],
  ["modules/penerimaan/routes.ts", { situs: 3, alasan:
    "`kondisiFaktur(c, fakturId)` menyusun `eq(productions.companyId, auth.company_id!)` — pengurungannya ada, cuma tinggal di pembantu" }],
  ["modules/menu/routes.ts", { situs: 2, alasan:
    "`menuId` diverifikasi milik perusahaan sebelum `menuComponents`/`menuBranches` diganti isi" }],
  ["modules/penjualan/rekalkulasi.ts", { situs: 2, alasan:
    "`saleId` dioper dari pemanggil yang sudah memuat notanya terkurung; `saleItems.id` dari baris nota itu" }],
  ["modules/penjualan/service.ts", { situs: 2, alasan:
    "bill dimuat `eq(openBills.companyId, params.companyId)` + `.for(\"update\")`, baru barisnya dibaca & bill-nya ditutup lewat id itu" }],
  ["modules/shift/routes.ts", { situs: 2, alasan:
    "`row` shift datang dari query terkurung; pembacaan/penulisan lanjutan memakai `row.id` sebagai penjaga balapan" }],
  ["modules/stok/routes.ts", { situs: 2, alasan:
    "`users.id in userIds` / `= reviewerId` — nama petugas dari tabel `users` yang global, kuncinya dari baris terkurung" }],
  ["modules/customer/service.ts", { situs: 1, alasan:
    "`getCustomer` membaca lalu MENOLAK di JS (`row.companyId !== companyId`) sebelum memulangkannya" }],
  ["modules/meja/routes.ts", { situs: 1, alasan:
    "log meja dibaca lewat `ada.id` — meja itu sendiri sudah diverifikasi milik perusahaan di atasnya" }],
  ["modules/penyimpanan/autoFile.ts", { situs: 1, alasan:
    "menulis `storageLocationId` ke `productions.id` yang dioper pemanggil terkurung, dan hanya bila kolomnya masih NULL" }],
  ["modules/perlengkapan/routes.ts", { situs: 1, alasan:
    "master perlengkapan diperbarui lewat id yang sudah lolos `muatSupplyAktif(auth.company_id!, …)`" }],
  ["modules/perlengkapan/service.ts", { situs: 1, alasan:
    "`supplyPurchases.id` dari `params.id` milik faktur yang pemanggilnya sudah kurung" }],
  ["modules/sync/idempoten.ts", { situs: 1, alasan:
    "klaim idempotensi dikunci per (device, client_ref) — barisnya milik perintah yang sedang diproses, bukan pencarian lintas perusahaan" }],
  ["modules/sync/routes.ts", { situs: 1, alasan:
    "pemangkas retensi `syncCommands` memang LINTAS perusahaan by design (venanya sendiri: retensi yang menghormati kontrak antrean offline)" }],
]);

describe("tiap kueri terkurung perusahaannya", () => {
  const daftar = daftarSumber();
  const peta = petaKelas(daftar);
  const f = peta.filter((k) => k.kelas === "F");

  it("PREMIS: populasinya besar dan tiap kelas terisi", () => {
    // Nol berarti pemindainya rusak, bukan repo yang bersih — kesalahan yang
    // sudah pernah terjadi di repo ini (gerbang larik hijau karena hanya
    // melihat 18 dari 39).
    expect(peta.length, "tak ada kueri terbaca").toBeGreaterThan(550);
    for (const kls of ["A", "A2", "B", "C", "E"] as const) {
      expect(peta.filter((k) => k.kelas === kls).length, `kelas ${kls} kosong`).toBeGreaterThan(0);
    }
    // Mayoritas mutlak wajib terkurung LANGSUNG; kalau angka ini runtuh,
    // yang rusak pemindainya, bukan reponya.
    expect(peta.filter((k) => k.kelas === "A").length).toBeGreaterThan(300);
  });

  it("DETEKTOR TERBUKTI: kueri telanjang tertuduh, yang terkurung tidak", () => {
    // `ke` memilih kueri KEBERAPA yang dinilai: kasus terakhir memuat DUA
    // kueri, dan yang sedang diuji adalah yang kedua.
    const uji = (isi: string, ke = 0) => {
      const semua = semuaKueri([{ nama: "modules/palsu/routes.ts", isi }]);
      return kelas(semua[ke], isi);
    };
    // telanjang → F
    expect(uji(`async function h(c) { const r = await db.select().from(t).limit(5); }`)).toBe("F");
    // terkurung langsung → A
    expect(
      uji(`async function h(c) { const r = await db.select().from(t).where(eq(t.companyId, auth.company_id!)); }`),
    ).toBe("A");
    // terkurung lewat variabel → A2
    expect(
      uji(
        `async function h(c) { const saring = and(eq(t.companyId, auth.company_id!)); const r = await db.select().from(t).where(saring); }`,
      ),
    ).toBe("A2");
    // terkurung lewat `and(...conds)` → A2
    expect(
      uji(
        `async function h(c) { const conds = [eq(t.companyId, auth.company_id!)]; const r = await db.select().from(t).where(and(...conds)); }`,
      ),
    ).toBe("A2");
    // kunci saringnya ikut diverifikasi → C
    expect(
      uji(
        `async function h(c) { await pastikanKartu(jenis, id, auth.company_id!); const r = await db.select().from(t).where(eq(t.saleId, id)); }`,
      ),
    ).toBe("C");
    // LINGKUP menyebut tenant untuk tabel LAIN → TETAP tertuduh. Versi
    // pertama kelas C menyatakan ini aman, dan itu membuat bukti merahnya
    // hijau — justru kasus inilah alasannya diperketat.
    expect(
      uji(
        `async function h(c) { const m = await db.select().from(lain).where(eq(lain.companyId, auth.company_id!)); const r = await db.select().from(t).where(eq(t.isActive, true)); }`,
        1,
      ),
    ).toBe("F");
  });

  it("DETEKTOR TERBUKTI: rantainya tak menelan kueri tetangga", () => {
    // Versi kedua `rantai()` menghitung ganda kurung buka saat melompati
    // `.metode(`, sehingga rantainya menelan rute BERIKUTNYA dan meminjam
    // `companyId` milik tetangganya — 103 kueri tak terkurung terbaca "aman".
    const isi = `
      const a = db.select().from(t).limit(5);
      const b = db.select().from(u).where(eq(u.companyId, x));
    `;
    const k = semuaKueri([{ nama: "modules/palsu/routes.ts", isi }]);
    expect(k).toHaveLength(2);
    expect(k[0].isi, "rantai pertama menelan yang kedua").not.toContain("companyId");
    expect(k[1].isi).toContain("companyId");
  });

  it("DETEKTOR TERBUKTI: dua kueri berteks IDENTIK dinilai di lingkupnya sendiri", () => {
    // `indexOf(isi)` membuat keduanya menunjuk situs PERTAMA — kelas kesalahan
    // yang sudah menggigit repo ini (pembantu senama pertama yang terpungut).
    const isi = `
      async function aman(c) {
        await pastikanKartu(jenis, id, auth.company_id!);
        const r = await db.select().from(t).where(eq(t.saleId, id));
      }
      async function bocor(c) {
        const r = await db.select().from(t).where(eq(t.saleId, id));
      }
    `;
    const daftarPalsu = [{ nama: "modules/palsu/routes.ts", isi }];
    const k = semuaKueri(daftarPalsu);
    expect(k).toHaveLength(2);
    expect(kelas(k[0], isi)).toBe("C");
    expect(kelas(k[1], isi), "situs kedua meminjam lingkup situs pertama").toBe("F");
  });

  it("tiap kueri kelas F sudah dipilah tangan", () => {
    const perBerkas = new Map<string, number>();
    for (const k of f) perBerkas.set(k.berkas, (perBerkas.get(k.berkas) ?? 0) + 1);
    const asing = [...perBerkas]
      .filter(([b, n]) => DIPILAH_TANGAN.get(b)?.situs !== n)
      .map(([b, n]) => `${b}: ${n} situs (terdaftar ${DIPILAH_TANGAN.get(b)?.situs ?? "—"})`);
    expect(
      asing,
      "kueri yang pengurungan tenant-nya tak bisa dibaca mekanis. Tembak dulu " +
        "dengan token tenant LAIN (pola §260 verify-api): kalau 200, itu " +
        "kebocoran; kalau 404, daftarkan di DIPILAH_TANGAN beserta alasan yang " +
        "bisa diperiksa — mis. induknya diverifikasi lebih dulu di handler " +
        "yang sama",
    ).toEqual([]);
  });

  it("daftar pilahannya masih ADA — bukan kuburan berkas basi", () => {
    const berkasF = new Set(f.map((k) => k.berkas));
    for (const b of DIPILAH_TANGAN.keys()) expect(berkasF, b).toContain(b);
  });

  it("berkas GLOBAL memang cuma yang lintas perusahaan", () => {
    // Pagar terhadap pelonggaran diam-diam: kalau modul tenant biasa kelak
    // masuk daftar GLOBAL, seluruh isinya berhenti dinilai tanpa satu uji pun
    // berubah warna.
    const e = new Set(peta.filter((k) => k.kelas === "E").map((k) => k.berkas.split("/").slice(0, 2).join("/")));
    for (const b of e) {
      expect(
        /^(lib|seed|db|scripts)\/|^app\.ts$|^index\.ts$|^middleware\/|^modules\/(auth|onboarding|admin-[\w-]+|mail|users)$/.test(b),
        `${b} dinyatakan global — apa benar ia bekerja lintas perusahaan?`,
      ).toBe(true);
    }
  });
});
