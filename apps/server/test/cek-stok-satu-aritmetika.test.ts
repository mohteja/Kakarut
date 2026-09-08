import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * PRACEK DAN GERBANG HARUS MEMAKAI ARITMETIKA YANG SAMA.
 *
 * `POST /penjualan/cek-stok` memberi tahu kasir, SEBELUM Bayar ditekan, apakah
 * keranjang di layarnya akan ditolak. Sebuah ramalan hanya berguna bila ia
 * dihitung oleh yang menghakimi — dan di repo ini "dua salinan yang hari ini
 * sama" adalah bentuk kegagalan yang sudah berulang: `companyDto` dirakit dua
 * tempat (#95), bentuk struk tak pernah ditulis siapa pun (#97), `GET /company`
 * bertambah empat kunci tanpa ada yang melihat (#99).
 *
 * KENAPA RUTE ITU ADA SAMA SEKALI, diukur lewat HTTP 2026-09-06 pada DB
 * gerbang. Satu-satunya bahan peringatan kasir sampai hari itu adalah
 * `GET /menu/ketersediaan`, yang menjawab PER MENU. Dari 57 menu, 38 (12
 * kelompok) berbagi bahan pembatas dengan menu lain. Keranjang 20 "Premium
 * Basooopa B" (sisa porsi 26) + 20 "Favorit Set 1" (sisa porsi 40) membuat
 * KEDUA klien diam — tiap baris di bawah porsinya sendiri — lalu
 * `POST /penjualan` menolak: "Stok tidak cukup: Baso aci jando (sisa 80 butir,
 * butuh 100)". Komentar gerbangnya sendiri sudah menuliskan sebabnya
 * bertahun-tahun; yang tak ada adalah pintu untuk menanyakannya.
 *
 * Yang dijaga berkas ini: SATU perakit kalimat, SATU perakit kebutuhan
 * keranjang, SATU predikat gerbang — dan bentuk balasan yang sama dengan
 * kontraknya, dua arah.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const baca = (p: string) => readFileSync(AKAR + p, "utf8");

const RUMAH = "apps/server/src/modules/penjualan/stok-keranjang.ts";
const TYPES = baca("packages/shared/src/types.ts");
const RUTE = baca("apps/server/src/modules/penjualan/routes.ts");
const SERVICE = baca("apps/server/src/modules/penjualan/service.ts");
const OPENBILL = baca("apps/server/src/modules/open-bill/routes.ts");

function semuaTs(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTs(p + "/"));
    else if (nama.endsWith(".ts")) hasil.push(p);
  }
  return hasil;
}

describe("cek-stok: satu aritmetika untuk yang meramal dan yang menghakimi", () => {
  it("PREMIS: rumah bersama ada dan ketiga pembantunya diekspor", () => {
    // Uji yang kehilangan bahannya lulus tanpa memeriksa apa pun.
    const rumah = butaKomentar(baca(RUMAH));
    for (const f of ["pesanStokKurang", "kebutuhanKeranjang", "gerbangBerlaku"]) {
      expect(rumah, `pembantu ${f} tak diekspor dari rumah bersamanya`).toContain(
        `export function ${f}`,
      );
    }
  });

  it("INTI: kalimat `Stok tidak cukup: …` dirakit di SATU tempat", () => {
    /*
     * Sapuannya berkunci bentuk BERTITIK-DUA, dan itu bukan kerewelan.
     * `perlengkapan/routes.ts` memulangkan "Stok tidak cukup (saldo X <satuan>)"
     * untuk domain yang BERBEDA — perlengkapan, bukan bahan resep — dan sapuan
     * yang lebih lebar akan menuduhnya tanpa sebab. Kelas persis `TABRAKAN_NAMA`
     * yang menggigit vena #96: penjaga yang menuduh yang benar berhenti
     * dipercaya secepat penjaga yang diam.
     */
    const perakit = semuaTs(AKAR + "apps/server/src/")
      .filter((p) => /`Stok tidak cukup: /.test(butaKomentar(readFileSync(p, "utf8"))))
      .map((p) => p.slice(AKAR.length));
    expect(
      perakit,
      "kalimat penolakan stok dirakit di luar `stok-keranjang.ts`. Dua perakit yang " +
        "hari ini sama akan menyimpang tanpa suara — dan sejak ada pracek, yang " +
        "menyimpang adalah janji kepada kasir",
    ).toEqual([RUMAH]);
    // …dan yang di domain lain TIDAK ikut tertuduh (pengecualian yang dipakai).
    expect(butaKomentar(baca("apps/server/src/modules/perlengkapan/routes.ts"))).toContain(
      "Stok tidak cukup (saldo",
    );
  });

  it("INTI: ketiga pemakainya memanggil rumah bersama, tak merakit sendiri", () => {
    for (const [nama, src] of [
      ["penjualan/service.ts", SERVICE],
      ["open-bill/routes.ts", OPENBILL],
      ["penjualan/routes.ts", RUTE],
    ] as const) {
      expect(butaKomentar(src), `${nama} tak memakai perakit kalimat bersama`).toContain(
        "pesanStokKurang(",
      );
    }
    // Keranjang → bahan: dua pemakai berbentuk keranjang. `createSale` TIDAK
    // ikut dan itu disengaja — ia menumpuk `konsumsi` di dalam gelung yang juga
    // menghitung harga & HPP, dan memaksanya lewat sini akan menyalin gelung
    // itu, bukan menyatukannya. Yang menyatukan keduanya satu lapis di bawah:
    // `tambahKebutuhanBahan`, yang ketiganya sama-sama pakai.
    expect(butaKomentar(OPENBILL)).toContain("kebutuhanKeranjang(");
    expect(butaKomentar(RUTE)).toContain("kebutuhanKeranjang(");
    expect(butaKomentar(SERVICE)).toContain("tambahKebutuhanBahan(");
    expect(butaKomentar(baca(RUMAH))).toContain("tambahKebutuhanBahan(");
  });

  it("INTI: predikat gerbang dipanggil dua situs, tak ada yang menulis kondisinya sendiri", () => {
    /*
     * Inilah asersi yang membuat pracek bisa dipercaya. Gerbangnya sengaja
     * DILEWATI untuk open bill (barangnya sudah dimasak) dan sinkron offline
     * (uangnya sudah diterima). Pracek yang menjawab dari `kurang.length > 0`
     * saja akan menjanjikan penolakan yang TAK AKAN TERJADI — dan peringatan
     * yang meleset ke arah itu paling mahal: kasir menolak pesanan yang
     * sebenarnya boleh dilayani.
     */
    expect(butaKomentar(SERVICE)).toContain("gerbangBerlaku({");
    expect(butaKomentar(RUTE)).toContain("gerbangBerlaku({");
    // Kondisi mentahnya tak boleh hidup lagi di luar rumahnya.
    const menulisSendiri = semuaTs(AKAR + "apps/server/src/")
      .filter((p) => p.slice(AKAR.length) !== RUMAH)
      .filter((p) => /blokirJualMinus\s*&&\s*!/.test(butaKomentar(readFileSync(p, "utf8"))))
      .map((p) => p.slice(AKAR.length));
    expect(
      menulisSendiri,
      "kondisi gerbang ditulis ulang di luar `gerbangBerlaku` — pracek dan gerbang " +
        "akan berbeda pendapat pada jalur yang dikecualikan",
    ).toEqual([]);
  });

  it("INTI: balasan pracek == `CekStokResult`, dua arah", () => {
    const buta = butaKomentar(RUTE);
    const i = buta.indexOf("return c.json({", buta.indexOf('.post("/cek-stok"'));
    expect(i, "literal balasan pracek tak ditemukan").toBeGreaterThan(0);
    const dibangun = kunciObjek(buta, buta.indexOf("{", i)).sort();
    const kontrak = medanInterface(TYPES, "CekStokResult");
    expect(kontrak.length, "kontrak CekStokResult terbaca terlalu tipis").toBe(4);
    expect(
      dibangun.filter((k) => !kontrak.includes(k)),
      "dibangun tapi tak ada di CekStokResult",
    ).toEqual([]);
    expect(
      kontrak.filter((k) => !dibangun.includes(k)),
      "ada di CekStokResult tapi tak pernah dibangun — hantu",
    ).toEqual([]);
  });

  it("INTI: baris kekurangan dipetakan kolom demi kolom, bukan disebar", () => {
    /*
     * `bahanKurang` memulangkan bentuk internalnya; menyebarnya (`...k`) membuat
     * kolom yang ditambahkan besok ikut terkirim tanpa ada yang memutuskannya.
     * Aturan yang sama dengan `strukPenjualan` (#97) dan `companyRow` (#99).
     */
    const buta = butaKomentar(RUTE);
    const potong = buta.slice(buta.indexOf('.post("/cek-stok"'));
    expect(potong).toMatch(/kurang: kurang\.map\(\(k\) => \(\{/);
    expect(potong).not.toMatch(/kurang: kurang\.map\(\(k\) => \(\{\s*\.\.\./);
    for (const medan of medanInterface(TYPES, "BahanKurangDto")) {
      expect(potong, `medan ${medan} tak dipetakan di balasan pracek`).toContain(
        `${medan}: k.${medan},`,
      );
    }
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan & perakit kedua sintetis", () => {
    const buta = butaKomentar(RUTE);
    const i = buta.indexOf("return c.json({", buta.indexOf('.post("/cek-stok"'));
    const palsu =
      buta.slice(0, i) + buta.slice(i).replace("return c.json({", "return c.json({\n      kunci_karangan: 1,");
    const dibangunPalsu = kunciObjek(palsu, palsu.indexOf("{", palsu.indexOf("return c.json({", i)));
    expect(dibangunPalsu).toContain("kunci_karangan");
    // …dan komentar tak dihitung sebagai kunci — LEWAT `butaKomentar`, sebab
    // itulah kontrak `kunciObjek` ("Pemanggil sudah membutakan komentar").
    // Memberinya teks mentah dan berharap ia menyaring sendiri adalah asersi
    // atas fungsi yang lain; percobaan pertama uji ini melakukan persis itu.
    expect(kunciObjek(butaKomentar("{ a: 1, /* b: 2, */ c: 3 }"), 0).sort()).toEqual(["a", "c"]);
    // …dan teks MENTAH bukan cuma menambah kunci palsu, ia MENYEMBUNYIKAN yang
    // nyata: penggalan `/* b: 2` dan `*/ c: 3` sama-sama gagal dikenali, jadi
    // `c` ikut hilang. Itulah kenapa membutakan komentar wajib di pemanggil,
    // bukan opsional — dan kenapa asersi ini berdiri di sini.
    expect(kunciObjek("{ a: 1, /* b: 2, */ c: 3 }", 0)).toEqual(["a"]);
    // Perakit kalimat kedua yang sintetis memang tertangkap sapuannya.
    expect(/`Stok tidak cukup: /.test("const m = `Stok tidak cukup: ${x}`;")).toBe(true);
    // …tapi bentuk domain lain (tanpa titik dua) TIDAK.
    expect(/`Stok tidak cukup: /.test("`Stok tidak cukup (saldo ${s} ${u})`")).toBe(false);
  });
});
