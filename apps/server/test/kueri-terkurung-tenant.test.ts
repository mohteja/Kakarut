import { describe, expect, it } from "vitest";
import {
  buktiKondisi,
  daftarSumber,
  kelas,
  petaKelas,
  petaKelasDibuktikan,
  semuaKueri,
  type Kueri,
} from "./util/kueri-terkurung";
import { grafPanggilan } from "./util/panggilan";

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
 *   A   390  mengurung `companyId` (atau `companies.id`) di rantainya sendiri
 *   A2   56  lewat variabel — diresolusi PER LINGKUP, bukan kecocokan pertama
 *   B    21  lewat `branchId` DI DALAM `.where` (bukan sekadar kolom terpilih)
 *   C    35  kunci saringnya ikut dioper ke PANGGILAN BERNAMA ber-`company_id`
 *   E    68  memang LINTAS perusahaan: auth, panel super admin, cadangan, seed
 *   P     6  terkurung lewat KONDISI yang dioper — DIBUKTIKAN graf panggilan
 *   F    48  tak teresolusi mekanis → DIPILAH TANGAN, daftarnya di bawah
 *
 * Angka-angka itu bergerak 2026-08-27 ketika instrumennya pindah ke pohon
 * sintaks — bukan karena aturannya berubah, melainkan karena BUKTINYA akhirnya
 * terbaca. Kelas `P` menyusul hari yang sama: enam situs yang tadinya `F`
 * dengan alasan tulisan tangan ("pemanggilnya mengurung") kini dibuktikan
 * lewat GRAF PANGGILAN lintas berkas — dan pemanggil BARU yang mengoper
 * kondisi tanpa tenant menjatuhkan buktinya. Rinciannya di
 * `docs/audit/vena-audit.md`.
 *
 * Turun lagi 2026-08-31, dari 50 ke 48, dan ini kebalikan dari pelonggaran:
 * dua situs `modules/shift/routes.ts` (`/selisih/putuskan`) KELUAR dari daftar
 * tangan karena buktinya jadi terbaca mesin. Rutenya kini memanggil
 * `rekapWindow(db, row.companyId, …)` untuk menurunkan kelayakan keputusan dari
 * aturan hidup (§282), dan panggilan bernama ber-tenant itulah yang membuat
 * penulisan sesudahnya terbaca sebagai kelas C. Alasan tulisan tangannya —
 * *"`row` shift datang dari query terkurung"* — tidak berubah isinya; yang
 * berubah cuma siapa yang bisa membacanya.
 *
 * Diukur juga lewat HTTP dengan DUA tenant sungguhan (id milik tenant A
 * dibuktikan terbaca oleh A lebih dulu): sebelas rute detail ber-`:id`
 * ditembak dengan token tenant B → **404 semua**, A → 200 semua. Lihat §260
 * verify-api.
 */

/**
 * Situs kelas F, dipilah TANGAN — bukan "belum sempat".
 *
 * Kuncinya BERKAS + JUMLAH, bukan nomor baris: gerbang di repo ini sudah
 * sekali patah karena memaku baris yang bergeser gara-gara komentar. Situs
 * baru di berkas yang sama menaikkan jumlahnya → merah, dan menagih keputusan.
 */
const DIPILAH_TANGAN = new Map<string, { situs: number; alasan: string }>([
  ["modules/produksi/routes.ts", { situs: 5, alasan:
    "kunci `inArray` lahir dari baris yang SUDAH terkurung (`byId`, `rows`, `kirimMap`, `batchByProd`); sisanya menulis ke `productions.id` hasil select ber-`conds` yang memuat companyId. ENAM situs `.where(and(...conds))` KELUAR dari daftar ini sejak graf panggilan bisa membuktikannya: `conds` parameter `tahapSebagian`/`tahapSeluruhFaktur`, dan satu-satunya situs panggilnya (:1653) mengoper kondisi ber-`eq(productions.companyId, auth.company_id!)` — kelas P. SITUS KELIMA (2026-09-03): subkueri agregat `per_faktur` yang memberi makan medan `ringkas` memakai `.where(and(...conds))` yang SAMA PERSIS dengan kueri `total` dan kueri kunci halaman di handler yang sama — `conds` dirakit beberapa baris di atasnya dan memuat `eq(productions.companyId, auth.company_id!)`; kalau ia bocor, `total` dan daftarnya sudah bocor lebih dulu" }],
  ["modules/perlengkapan/service.ts", { situs: 2, alasan:
    "DUA kueri berhalaman `GET /perlengkapan/beli` (2026-09-04): subkueri agregat `per_faktur` dan kueri kunci halamannya yang membaca `.from(perFaktur)`. Keduanya memakai `.where(and(...conds))` — `conds` dirakit belasan baris di atasnya dan DIMULAI dengan `eq(supplyPurchases.companyId, companyId)`, jadi pengurungannya nyata tapi tak terbaca mekanis (variabel, bukan literal di tempat). `conds` yang SAMA memberi makan kueri `ringkas`, kueri kunci halaman, DAN kueri barisnya: kalau salah satu bocor, ketiganya bocor bersama dan itu terlihat. Ditembak lewat HTTP: verify-api §294 memakai token tenant kedua (`$UJI260`) dan menuntut NOL overlap kunci faktur dengan tenant pertama — premisnya dibuktikan asersi di atasnya yang menunjukkan tenant pertama MEMANG melihat isinya" }],
  ["modules/rekomendasi/routes.ts", { situs: 2, alasan:
    "DUA subkueri berkorelasi `EXISTS (SELECT 1 FROM supply_purchases sp …)` di dalam agregat `agregat_rencana` (`GET /permintaan`, 2026-09-03). Keduanya ditulis sebagai templat `sql` mentah — jadi tak terbaca mekanis — dan keduanya MEMBAWA `sp.company_id = ${auth.company_id!}` inline di `WHERE`-nya, di samping korelasi `sp.rencana_id = productions.rencana_id`. Induknya sendiri terkurung: `condPermintaan` memuat `eq(productions.companyId, auth.company_id!)` dan dipakai kueri agregat, kueri kunci halaman, DAN kueri barisnya. Kalau salah satu bocor, daftarnya sudah bocor lebih dulu. Ditembak lewat HTTP: verify-api §292 memakai token tenant kedua (`$UJI260`, dibuat §260) dan menuntut NOL overlap `rencana_id` dengan tenant pertama — premisnya dibuktikan asersi di atasnya yang menunjukkan tenant pertama MEMANG melihat isinya" }],
  ["modules/bahan/routes.ts", { situs: 9, alasan:
    "`id` diverifikasi `eq(ingredients.companyId, auth.company_id!)` lebih dulu di handler yang sama (mis. :638, :1062, :1663) yang membalas 404, lalu anak-anaknya (`ingredientSteps`, `ingredientComponents`, `ingredientSuppliers`, `menuComponents`) dibaca/dihapus lewat id yang sudah lolos itu. Empat situs baru: pembuktinya kueri lain, bukan panggilan bernama — dan kueri tetangga bukan verifikasi" }],
  ["modules/pesanan/routes.ts", { situs: 8, alasan:
    "`pastikanKartu(jenis, id, auth.company_id!, branchId)` dipanggil sebelum baris anak disentuh; `billIds`/`saleIds` daftar papan lahir dari query ber-companyId tepat di atasnya. TIGA situs baru ada di `selaraskanTutupBill(tx, billId, sekarang, ctx)` — `billId` PARAMETER, dan ketiga pemanggilnya mengoper bill yang sudah lolos `pastikanKartu`" }],
  ["modules/open-bill/routes.ts", { situs: 4, alasan:
    "`loadDetail` membaca bill lalu MENOLAK di JS (`bill.companyId !== companyId`) sebelum apa pun dipakai; anaknya dibaca lewat `billId` yang sudah lolos itu. Satu situs baru (`.update(openBillItems)` pembatalan) berada di dalam transaksi yang dibuka SESUDAH penolakan itu" }],
  ["modules/penjualan/refund.ts", { situs: 1, alasan:
    "`refundSajian(tx, params)` — barisnya disaring `saleItems.id` milik nota yang sudah diverifikasi pemanggilnya (`penjualan/routes.ts` membaca sale ber-companyId lalu 404) sebelum refund dijalankan" }],
  ["modules/profil/routes.ts", { situs: 1, alasan:
    "`eq(users.id, auth.sub)` — profil MILIK PEMANGGIL SENDIRI. Tak ada tenant yang bisa dilanggar: kuncinya identitas di token, bukan id yang datang dari permintaan" }],
  ["modules/penjualan/routes.ts", { situs: 4, alasan:
    "`sale` datang dari select ber-companyId; `saleItems.saleId = sale.id` dan `users.id = sale.cashierUserId` mengikutinya (tabel `users` memang global — venanya sendiri)" }],
  ["modules/kebersihan/routes.ts", { situs: 3, alasan:
    "`ids` laporan lahir dari query ber-`syarat` yang memuat companyId; itemnya dibaca/dihapus per `reportId` dari daftar itu" }],
    ["modules/menu/routes.ts", { situs: 2, alasan:
    "`menuId` diverifikasi milik perusahaan sebelum `menuComponents`/`menuBranches` diganti isi" }],
  ["modules/penjualan/rekalkulasi.ts", { situs: 4, alasan:
    "`hitungUlangBiayaPenjualan(tx, saleId, companyId, …)` menerima companyId sebagai PARAMETER dan memakainya di kueri pertamanya; dua situs baru menyaring `saleId` yang sudah lolos kueri itu di fungsi yang sama" }],
  ["modules/penjualan/service.ts", { situs: 1, alasan:
    "bill dimuat `eq(openBills.companyId, params.companyId)` + `.for(\"update\")`, baru barisnya dibaca & bill-nya ditutup lewat id itu" }],
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
    ["modules/sync/idempoten.ts", { situs: 1, alasan:
    "klaim idempotensi dikunci per (device, client_ref) — barisnya milik perintah yang sedang diproses, bukan pencarian lintas perusahaan" }],
  ]);

describe("tiap kueri terkurung perusahaannya", () => {
  const daftar = daftarSumber();
  const peta = petaKelasDibuktikan(daftar);
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

  it("kelas P: terkurung lewat KONDISI yang dioper, dan itu DIBUKTIKAN", () => {
    const pp = peta.filter((k) => k.kelas === "P");
    expect(pp.length, "tak ada situs kelas P — grafnya tak menghasilkan apa pun").toBeGreaterThanOrEqual(4);
    const b = buktiKondisi();
    expect(
      [...b.belum].map(([n, a]) => `${n}: ${a}`),
      "pembantu kondisi yang tak bisa dibuktikan — turunkan ke F & daftarkan",
    ).toEqual([]);
    expect(b.terbukti.has("tahapSebagian")).toBe(true);
  });

  it("BUKTI MERAH kelas P: satu pemanggil ber-kondisi TANPA tenant menjatuhkannya", () => {
    const racun = {
      nama: "modules/palsu/routes.ts",
      isi: "async function h(c) { const conds = [eq(productions.id, c.req.param('id'))]; await tahapSebagian({ conds }); }",
    };
    const b = buktiKondisi(grafPanggilan([racun]));
    expect(b.terbukti.has("tahapSebagian"), "suntikan tak menjatuhkan buktinya").toBe(false);
    expect(b.belum.get("tahapSebagian")).toMatch(/modules\/palsu\/routes\.ts/);
    // PASANGAN: pembantu lain tak ikut tumbang.
    expect(b.terbukti.has("selectLaporan")).toBe(true);
  });

  it("DETEKTOR TERBUKTI: rantainya tak menelan kueri tetangga", () => {
    // Versi kedua `rantai()` — penelusur kurung tulisan tangan — menghitung
    // ganda kurung buka saat melompati `.metode(`, sehingga rantainya menelan
    // rute BERIKUTNYA dan meminjam `companyId` milik tetangganya: 103 kueri tak
    // terkurung terbaca "aman". Penelusur itu sudah TIDAK ADA lagi (batas
    // rantai kini simpul pohon), dan uji ini tetap berdiri sebagai kontrak
    // perilakunya — bukan sebagai pin ke implementasinya.
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

  it("DETEKTOR TERBUKTI: PENCATAT tak bisa memutihkan kueri di sebelahnya", () => {
    /*
     * Bentuk yang benar-benar terjadi 2026-09-04. `catatHargaBahan(db,
     * auth.company_id!, …, [{ ingredientId: id, … }])` punya bentuk yang sama
     * persis dengan sebuah verifikasi — callee Identifier, argumen memuat
     * tenant DAN nama kunci saringnya — tapi ia MENULIS jejak, tak pernah
     * menolak apa pun. Tanpa daftar `PENCATAT`, kehadirannya menurunkan
     * `modules/bahan/routes.ts` dari 9 situs kelas F ke 6, dan tiga kueri yang
     * selama ini menagih adjudikasi berhenti menagihnya — tanpa satu pun dari
     * ketiganya berubah.
     */
    const pencatat = `
      async function h(c) {
        await catatHargaBahan(db, auth.company_id!, auth.sub, "manual", [{ ingredientId: id }]);
        const r = await db.delete(t).where(eq(t.ingredientId, id));
      }
    `;
    const kp = semuaKueri([{ nama: "modules/palsu/routes.ts", isi: pencatat }]);
    expect(kp).toHaveLength(1);
    expect(kelas(kp[0], pencatat), "pencatat memutihkan kueri di sebelahnya").toBe("F");

    // PASANGANNYA: verifikasi sungguhan dengan bentuk yang sama TETAP diakui —
    // kalau tidak, "F" di atas cuma berarti detektornya berhenti melihat.
    const verif = pencatat.replace("catatHargaBahan(db, auth.company_id!, auth.sub, \"manual\", [{ ingredientId: id }])", "pastikanBahan(id, auth.company_id!)");
    const kv = semuaKueri([{ nama: "modules/palsu/routes.ts", isi: verif }]);
    expect(kelas(kv[0], verif)).toBe("C");
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
