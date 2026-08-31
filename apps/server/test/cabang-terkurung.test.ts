import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { situsCabang, petaKelasCabang, tabelBerCabang } from "./util/cabang-terkurung";
import { SRV, type Rute } from "./util/rute";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PENGURUNGAN CABANG — arah yang tak pernah punya gerbang.
 *
 * Pengurungan TENANT sudah dijaga dua arah: baca (`kueri-terkurung-tenant`,
 * 626 kueri) dan tulis (`tenant-tulis`, 101 insert). Pertanyaan yang sama satu
 * tingkat ke bawah — **dalam SATU penyewa, bisakah peran terikat cabang A
 * menyentuh baris cabang B?** — tak pernah disapu sekali pun.
 *
 * `cakupan-cabang.test.ts` bukan gerbang untuk itu, dan batasnya tertulis di
 * berkasnya sendiri: ia berbasis teks, populasinya DELAPAN berkas tulisan
 * tangan, dan ia menyapu satu arah — *"cabang datang dari PEMANGGIL"*. Ia tak
 * pernah bertanya apakah kuerinya mengurung.
 *
 * HASIL SAPUAN — dengan angkanya, sebelum → sesudah:
 *
 *   tabel ber-`branchId`                        24 dari 59
 *   rute                                       275
 *     · LUAR      135  tak dimasuki peran terikat cabang
 *     · E          13  berkas lintas perusahaan (auth, onboarding)
 *     · KOSONG     29  tak menyentuh tabel ber-cabang
 *     · KURUNG  68→80  penjaga cabang di badan rutenya
 *     · HOP       5→7  penjaganya terbukti lewat pembantu yang dipanggilnya
 *     · MILIK       3  dikurung KEPEMILIKAN (`auth.sub` + 403)
 *     · AKTOR       4  cabang lahir dari keanggotaan PEMANGGIL sendiri
 *     · TELANJANG 18→4 ← tuduhannya
 *
 * Keempat belas yang ditutup semuanya TERUKUR lewat HTTP lebih dulu (satu
 * perusahaan, dua cabang, token kasir & kitchen terikat "Pusat" menembak baris
 * "Cabang Uji 46") — bukan dibaca lalu ditebak. Lihat `verify-api.sh` §269.
 */

/**
 * Pintu yang MEMANG tak mengurung cabang, beserta alasan yang bisa diperiksa.
 *
 * Bukan daftar "belum sempat": tiap baris ditembak dan dibaca. Yang
 * menyatukannya satu kalimat — **baris yang DIALAMATI `:id`-nya milik
 * PERUSAHAAN, bukan cabang**; tabel ber-cabang yang ikut tersentuh cuma
 * satelit yang menjawab "di cabang mana" untuk baris perusahaan itu.
 */
const MILIK_PERUSAHAAN = new Map<string, string>([
  [
    "GET /bahan/:id/detail",
    "yang dialamati `ingredients` (milik perusahaan); `ingredientProduksiBranches` & `storageLocations` satelit yang menjawab 'diproduksi/disimpan di cabang mana' — katalog itu memang lintas cabang",
  ],
  [
    "GET /bahan/:id/pembelian",
    "riwayat harga bahan = kolam yang melahirkan `ingredients.harga_beli`, kolom PERUSAHAAN; memotongnya per cabang membuat acuan tiap cabang berbeda dari acuan yang dipakainya. owner/admin/tim saja",
  ],
  [
    "GET /menu/:id",
    "yang dialamati `menus` (milik perusahaan); `menuBranches` satelit ketersediaan per cabang — dan klien memang butuh peta lengkapnya untuk menandai 'kosong di cabang ini'",
  ],
  [
    "POST /profil/password",
    "ganti password AKUN SENDIRI; `memberships` tersentuh lewat penerbitan ulang sesi, bukan lewat baris cabang mana pun",
  ],
]);

describe("pengurungan cabang: baris cabang lain tak terjangkau peran terikat", () => {
  const semua = situsCabang();
  const peta = petaKelasCabang(semua);

  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(tabelBerCabang().size, "skema tak terbaca").toBeGreaterThanOrEqual(20);
    expect(semua.length, "daftar rute kosong").toBeGreaterThan(250);
    expect(peta.get("KURUNG") ?? 0, "tak ada rute berpenjaga terbaca").toBeGreaterThan(40);
    // Kalau ini nol, lompatan pembantunya tak terpakai dan angka KURUNG bohong.
    expect(peta.get("HOP") ?? 0, "kelas HOP kosong — lompatannya tak terpakai").toBeGreaterThan(0);
    expect(peta.get("LUAR") ?? 0).toBeGreaterThan(50);
  });

  it("INTI: tiap pintu yang tak mengurung cabang sudah diadjudikasi", () => {
    const asing = semua
      .filter((s) => s.kelas === "TELANJANG")
      .map((s) => `${s.metode} ${s.jalur}`)
      .filter((k) => !MILIK_PERUSAHAAN.has(k));
    expect(
      asing,
      `pintu menyentuh tabel ber-cabang, dimasuki peran TERIKAT cabang, tanpa penjaga apa pun:\n${asing.join("\n")}`,
    ).toEqual([]);
  });

  it("daftar adjudikasi tak menyimpan entri yang sudah usang", () => {
    const telanjang = new Set(
      semua.filter((s) => s.kelas === "TELANJANG").map((s) => `${s.metode} ${s.jalur}`),
    );
    const usang = [...MILIK_PERUSAHAAN.keys()].filter((k) => !telanjang.has(k));
    expect(usang, `entri sudah berpenjaga / hilang — hapus dari daftar: ${usang.join(", ")}`).toEqual(
      [],
    );
  });

  it("ketujuh pintu terukur itu KINI mengurung", () => {
    // Yang dipaku bukan "ada tulisan syaratCabang" melainkan kelas hasil
    // sapuannya: pintu-pintu ini pernah membalas 200 atas baris cabang lain.
    const wajib = [
      "PUT /open-bill/:id",
      "DELETE /open-bill/:id",
      "GET /open-bill/:id",
      "GET /stok/opname/sesi/:sessionId",
      "GET /penyimpanan/:id/bahan",
      "PATCH /produksi/faktur/:key",
      "DELETE /produksi/faktur/:key",
      "POST /produksi/laporan-harga/:fakturId",
      "GET /perlengkapan/opname/sesi/:sessionId",
    ];
    const kelas = new Map(semua.map((s) => [`${s.metode} ${s.jalur}`, s.kelas]));
    for (const k of wajib) {
      expect(["KURUNG", "HOP"], `${k}: ${kelas.get(k)}`).toContain(kelas.get(k));
    }
  });

  it("`syaratCabang` MENOLAK peran terikat tanpa cabang, tak jatuh terbuka", () => {
    /*
     * `kondisiFaktur` dulu menulis `terikatCabang(role) && auth.branch_id` —
     * peran terikat yang tak punya cabang lolos ke SELURUH perusahaan,
     * sementara `resolveBranchId` pada keadaan yang sama menjawab 403. Yang
     * dipaku di sini: cabang jatuh-terbukanya tak boleh kembali.
     */
    const AUTH = readFileSync(join(SRV, "middleware/auth.ts"), "utf8");
    const i = AUTH.indexOf("export function cabangTerikat");
    expect(i, "penolongnya tak ditemukan — jangkarnya usang").toBeGreaterThan(0);
    const blok = AUTH.slice(i, i + 400);
    expect(blok).toContain("if (!terikatCabang(auth.role)) return null;");
    expect(blok).toContain('throw new HTTPException(403, { message: "Akun tanpa cabang" })');
    /*
     * Dan tak ada lagi SALINAN bentuk jatuh-terbukanya — di KODE, bukan di
     * prosa: versi pertama jangkar ini membaca komentar yang menerangkan
     * pola itu dan menuduh berkas yang justru sudah diperbaiki. Sapuan atas
     * teks mentah menuduh dirinya sendiri.
     *
     * Ia menemukan sesuatu yang nyata sambil begitu: SALINAN KEDUA di
     * `penerimaan/routes.ts:465` — `kunciCabang` berbentuk SQL mentah, dengan
     * cabang jatuh-terbuka yang sama, di luar jangkauan `syaratCabang` karena
     * ia merakit `sql\`AND …\`` alih-alih kondisi drizzle.
     */
    for (const berkas of ["modules/penerimaan/routes.ts", "modules/perlengkapan/routes.ts"]) {
      const kode = butaKomentar(readFileSync(join(SRV, berkas), "utf8"));
      expect(kode, `${berkas}: salinan penjaga yang jatuh terbuka`).not.toContain(
        "terikatCabang(auth.role) && auth.branch_id",
      );
    }
  });
});

describe("BUKTI MERAH: gerbangnya benar-benar bisa menuduh", () => {
  const palsu = (isi: string, jalur = "/palsu"): Rute[] => [
    { metode: "POST", jalur, res: false, berkas: join(SRV, "modules/palsu/routes.ts"), isi },
  ];

  it("rute baru menyentuh tabel ber-cabang tanpa penjaga → TELANJANG", () => {
    const k = situsCabang({
      rute: palsu('"/", async (c) => { await db.select().from(openBills).where(eq(openBills.companyId, auth.company_id!)); }'),
    });
    expect(k[0].kelas).toBe("TELANJANG");
    expect(k[0].tabel).toContain("openBills");
  });

  it("PASANGAN: yang sama DENGAN penjaga → KURUNG, dan tabel tanpa cabang tak disapu", () => {
    const k = situsCabang({
      rute: palsu('"/", async (c) => { await db.select().from(openBills).where(and(eq(openBills.companyId, auth.company_id!), syaratCabang(c, openBills.branchId))); }'),
    });
    expect(k[0].kelas).toBe("KURUNG");
    // `suppliers` tak punya kolom branchId — bukan urusan sapuan ini.
    const t = situsCabang({
      rute: palsu('"/", async (c) => { await db.select().from(suppliers).where(eq(suppliers.companyId, auth.company_id!)); }'),
    });
    expect(t[0].kelas).toBe("KOSONG");
  });

  it("rute yang cuma dimasuki owner/admin tak ditagih", () => {
    const k = situsCabang({
      rute: palsu('"/", requireRole("owner", "admin"), async (c) => { await db.select().from(openBills); }'),
    });
    expect(k[0].kelas).toBe("LUAR");
  });

  it("gerbang peran INLINE juga terbaca — bukan cuma `requireRole`", () => {
    // `POST /penerimaan/anomali/tutup` memakai bentuk ini; tanpa pembacaannya
    // rute itu jadi tuduhan palsu.
    const k = situsCabang({
      rute: palsu(
        '"/", async (c) => { if (auth.role !== "owner" && auth.role !== "admin") throw new HTTPException(403, { message: "x" }); await db.select().from(openBills); }',
      ),
    });
    expect(k[0].kelas).toBe("LUAR");
  });

  it("PREMIS lompatan: penjaga di PEMBANTU tetap terbaca (kelas kondisiFaktur)", () => {
    const k = situsCabang({
      tambahan: [
        {
          nama: "modules/palsu/bantu.ts",
          isi: "export function saringCabangPalsu(c) { return syaratCabang(c, openBills.branchId); }",
        },
      ],
      rute: palsu('"/", async (c) => { await db.select().from(openBills).where(saringCabangPalsu(c)); }'),
    });
    expect(k[0].kelas).toBe("HOP");
    expect(k[0].lewat).toBe("saringCabangPalsu");
  });

  it("PREMIS: sentuhan tabel juga MENULAR lewat pembantu", () => {
    // `GET /open-bill/:id` badan rutenya tak menyebut `openBills` sama sekali;
    // kuerinya duduk di `loadDetail`. Versi pertama menyebutnya KOSONG
    // sementara ia membalas 200 berisi bill cabang lain.
    const k = situsCabang({
      tambahan: [
        {
          nama: "modules/palsu/bantu.ts",
          isi: "export async function muatPalsu(id) { return db.select().from(openBills).where(eq(openBills.id, id)); }",
        },
      ],
      rute: palsu('"/", async (c) => { return c.json(await muatPalsu(c.req.param("id"))); }'),
    });
    expect(k[0].tabel, "sentuhan tabel tak menular — populasinya menyusut diam-diam").toContain(
      "openBills",
    );
    expect(k[0].kelas).toBe("TELANJANG");
  });
});
