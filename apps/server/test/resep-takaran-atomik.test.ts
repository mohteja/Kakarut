import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Penjaga BIAYA YANG LAHIR DARI SEPASANG NILAI.
 *
 * Biaya per satuan bahan produksi bukan satu angka melainkan sebuah pecahan:
 *
 *     biaya per satuan = (biaya resep ÷ isi) × overhead_x
 *
 * Pembilang dan penyebutnya disimpan di TEMPAT YANG BERBEDA — komponen di
 * `ingredient_components`, `isi`/`overhead_x` di `ingredients` — dan layar
 * Resep dulu menyimpannya lewat DUA permintaan berurutan. Kalau yang kedua
 * gagal, yang pertama sudah mendarat: resep BARU dibagi `isi` LAMA.
 *
 * Yang membuatnya layak diperbaiki bukan si pengedit — halaman itu sudah
 * menangani dirinya dengan baik (draft mengikuti server lagi lewat `onError`,
 * jadi yang terlihat memang yang tersimpan). Yang tak tertangani adalah ORANG
 * LAIN: selama jendela itu, HPP setiap menu yang memakai bahan ini keliru bagi
 * semua orang, tanpa satu pun tanda di layar, sampai ada yang kebetulan
 * menyimpan ulang.
 *
 * PERBAIKANNYA SENGAJA SEMPIT. Yang pindah ke dalam transaksi hanya tiga nilai
 * yang bisa membuat model biaya bertentangan dengan dirinya sendiri: `isi`,
 * `overhead_x`, `harga_beli`. Foto, stok minimum, lead time, satuan, dan cara
 * masak TETAP lewat endpointnya masing-masing — `ingredient_steps` misalnya
 * hanya teks + foto + urutan, tak satu pun pembaca biaya menyentuhnya, jadi
 * kegagalannya menyisakan tampilan yang basi, bukan angka yang bohong.
 * Menarik semuanya ke dalam satu transaksi hanya akan menukar bug ini dengan
 * endpoint raksasa yang lebih sulit dibuktikan benar.
 */
const SRV = readFileSync(
  fileURLToPath(new URL("../src/modules/bahan/routes.ts", import.meta.url)),
  "utf8",
);
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const HAL = readFileSync(join(WEB, "pages/resep/ResepPage.tsx"), "utf8");

/** Badan `db.transaction(async (tx) => { … })` pada handler PUT /:id/resep. */
function badanTransaksiResep(): string {
  const iRute = SRV.indexOf('"/:id/resep",');
  expect(iRute, "rute PUT /:id/resep tak ditemukan").toBeGreaterThan(0);
  const iTx = SRV.indexOf("await db.transaction(async (tx) => {", iRute);
  expect(iTx, "transaksi pada /:id/resep tak ditemukan").toBeGreaterThan(iRute);
  const buka = SRV.indexOf("{", SRV.indexOf("=>", iTx));
  let dalam = 0;
  for (let i = buka; i < SRV.length; i++) {
    if (SRV[i] === "{") dalam++;
    else if (SRV[i] === "}" && --dalam === 0) return SRV.slice(buka, i + 1);
  }
  throw new Error("badan transaksi tak ketemu");
}

describe("server: takaran batch ditulis DI DALAM transaksi komponennya", () => {
  it("body /resep menerima `atur` (isi, overhead_x, harga_beli)", () => {
    expect(SRV).toContain("  atur: z");
    expect(SRV).toContain("      isi: z.number().positive().max(BATAS_ISI).optional(),");
    expect(SRV).toContain("      overhead_x: z.number().positive().max(1000).optional(),");
    expect(SRV).toContain(
      "      harga_beli: z.number().nonnegative().max(BATAS_UANG).optional(),",
    );
  });

  it("ketiganya ditulis di dalam transaksi yang sama — bukan sesudahnya", () => {
    // Inti perbaikannya, dan satu-satunya asersi yang benar-benar membuktikan
    // atomicity secara statis: `tx.update(ingredients)` HARUS berada di dalam
    // badan transaksi, bersama delete/insert komponennya.
    const tx = badanTransaksiResep();
    expect(tx).toContain("tx.delete(ingredientComponents)");
    expect(tx).toContain("tx.insert(ingredientComponents)");
    expect(tx).toContain("tx\n            .update(ingredients)");
    expect(tx).toContain("isi: atur.isi");
    expect(tx).toContain("overheadX: atur.overhead_x");
    expect(tx).toContain("hargaBeli: atur.harga_beli");
  });

  it("ditulis SESUDAH komponennya, supaya keduanya berbagi satu nasib", () => {
    const tx = badanTransaksiResep();
    const iKomponen = tx.indexOf("tx.insert(ingredientComponents)");
    const iAtur = tx.indexOf(".update(ingredients)");
    expect(iKomponen).toBeGreaterThan(0);
    expect(iAtur).toBeGreaterThan(iKomponen);
  });

  it("penjaga TOCTOU lama tetap di depan — pengadaan dikunci FOR UPDATE", () => {
    // Tanpa ini, `PUT /bahan` bisa membalik pengadaan ke "beli" di sela
    // validasi dan resep yatim tertulis. Perbaikan ini tak boleh menggesernya.
    const tx = badanTransaksiResep();
    const iKunci = tx.indexOf('.for("update")');
    const iTulis = tx.indexOf("tx.delete(ingredientComponents)");
    expect(iKunci).toBeGreaterThan(0);
    expect(iTulis).toBeGreaterThan(iKunci);
  });

  it("`atur` opsional — klien lama yang hanya mengirim komponen tak berubah", () => {
    const tx = badanTransaksiResep();
    expect(tx).toContain("if (Object.keys(setAtur).length > 0) {");
    expect(SRV).toContain("    .optional(),");
  });
});

describe("web: layar Resep mengirimnya bersama komponen, bukan terpisah", () => {
  it("`atur` ikut di panggilan /resep", () => {
    expect(HAL).toContain("                atur: {");
    expect(HAL).toContain("                  isi: angkaDari(atur.isi) > 0 ? angkaDari(atur.isi) : 1,");
    expect(HAL).toContain("                  overhead_x: overhead,");
  });

  it("dan TIDAK lagi dikirim di panggilan /bahan/:id sesudahnya", () => {
    // Mengirim ulang di sana tak salah nilainya, tapi mengembalikan jendela
    // yang baru ditutup: panggilan itu bisa gagal sendiri.
    const iMaster = HAL.indexOf("await api(`/bahan/${selectedId}`, {");
    expect(iMaster).toBeGreaterThan(0);
    const blok = HAL.slice(iMaster, HAL.indexOf("});", iMaster));
    expect(blok).not.toMatch(/^\s*isi:/m);
    expect(blok).not.toMatch(/^\s*overhead_x:/m);
    expect(blok).not.toMatch(/harga_beli:/);
  });

  it("persetujuan harga tetap jadi syarat — tak diam-diam dilepas", () => {
    // `harga_beli` HANYA dikirim bila user mencentang persetujuannya. Kalau
    // syarat ini hilang, menyimpan foto pun akan melepas kenaikan harga bahan
    // berbulan-bulan sekaligus ke HPP semua menu.
    expect(HAL).toContain("...(hargaBerubah && setujuHarga ? { harga_beli: hargaBatch } : {}),");
    expect(HAL.split("hargaBerubah && setujuHarga").length - 1).toBe(1);
  });

  it("urutan rantainya tetap: resep dulu, master, lalu langkah", () => {
    const iResep = HAL.indexOf("await api(`/bahan/${selectedId}/resep`");
    const iMaster = HAL.indexOf("await api(`/bahan/${selectedId}`, {");
    const iLangkah = HAL.indexOf("await api(`/bahan/${selectedId}/langkah`");
    expect(iResep).toBeGreaterThan(0);
    expect(iMaster).toBeGreaterThan(iResep);
    expect(iLangkah).toBeGreaterThan(iMaster);
  });

  it("penanganan gagal-separuh yang sudah baik TIDAK dicabut", () => {
    // Perbaikan ini menutup akibat terburuknya (angka bohong bagi semua orang),
    // bukan menggantikan penanganan yang sudah ada untuk si pengedit.
    expect(HAL).toContain("resepTersemai.current = null;");
    expect(HAL).toContain("<ErrorText error={simpan.error} />");
    expect(HAL).toContain("disabled={simpan.isPending");
  });
});

describe("premis: cara masak memang TIDAK menyentuh biaya", () => {
  it("ingredient_steps hanya teks/foto/urutan", () => {
    // Kalau suatu saat langkah ikut memengaruhi biaya (mis. overhead per
    // langkah), keputusan "langkah tak perlu atomik" jadi salah — dan uji ini
    // yang harus memberi tahu.
    const SKEMA = readFileSync(
      fileURLToPath(new URL("../src/db/schema.ts", import.meta.url)),
      "utf8",
    );
    const i = SKEMA.indexOf("export const ingredientSteps = pgTable(");
    expect(i, "tabel ingredient_steps tak ditemukan").toBeGreaterThan(0);
    // Sampai penutup daftar kolomnya saja — indeks/constraint di bawahnya
    // memuat nama lain yang bukan kolom.
    const blok = SKEMA.slice(i, SKEMA.indexOf("  },", i));
    for (const kolom of ["sortOrder", "teks", "fotoUrl"]) {
      expect(blok).toContain(kolom);
    }
    for (const terlarang of ["qty", "harga", "biaya", "overhead"]) {
      expect(blok, `kolom biaya "${terlarang}" muncul di ingredient_steps`).not.toContain(
        terlarang,
      );
    }
  });
});
