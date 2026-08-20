import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { qtyTeks } from "@kakarut/shared";

/**
 * ANGKA STOK HARUS MENYEBUT SATUANNYA.
 *
 * Daftar Stok Bahan menampilkan empat kolom angka — Stok Awal, Masuk,
 * Terpakai, Saldo — dan dulu tak satu pun menyebut satuannya. Yang membacanya
 * melihat "−54" dan tak punya cara tahu itu 54 apa: mililiter, gram, butir,
 * atau dus. Dilaporkan langsung oleh pemakainya: "bingung ini satuannya apa,
 * padahal ketika beli ada satuannya".
 *
 * Kalimat terakhir itu inti persoalannya. Belanja terjadi dalam KEMASAN (dus,
 * kg) sedangkan saldo disimpan dalam SATUAN KERJA (pcs, gr) — dua satuan yang
 * selama ini tak pernah bertemu di satu layar.
 *
 * Repo ini sudah punya jawabannya di dua tempat: `qtyTeks` (yang lahir dari
 * bug "900 gr" vs "900 kg", beda 1000×) dan tab PERLENGKAPAN di halaman yang
 * sama, yang sudah menempelkan satuan pada saldonya sejak awal. Tab Stok Bahan
 * yang tertinggal.
 *
 * Yang dijaga uji ini: KEDUA tab tetap menyebut satuannya. Divergensi di
 * antara dua tab bersebelahan itulah yang melahirkan keluhan ini, dan ia tak
 * menimbulkan gejala apa pun selain kebingungan yang tak dilaporkan siapa-siapa.
 */

const WEB = new URL("../../web/src/", import.meta.url);
const baca = (p: string, dari: URL = WEB) =>
  readFileSync(fileURLToPath(new URL(p, dari)), "utf8");

/** Kolom/sel SALDO di tiap tab — dijangkarkan ke teks yang menandainya. */
const TAB: { nama: string; berkas: string; jangkar: string }[] = [
  { nama: "Stok Bahan", berkas: "pages/stok/StokPage.tsx", jangkar: 'judul: "Saldo"' },
  {
    nama: "Perlengkapan",
    berkas: "pages/stok/StokPerlengkapanTab.tsx",
    jangkar: "formatAngka(r.saldo)",
  },
];

describe("daftar stok: saldo menyebut satuannya", () => {
  it.each(TAB)("$nama menempelkan satuan pada saldo", ({ berkas, jangkar }) => {
    const isi = baca(berkas);
    const i = isi.indexOf(jangkar);
    expect(i, `jangkar "${jangkar}" usang — irisannya tak memeriksa apa pun`).toBeGreaterThan(0);
    const blok = isi.slice(i, i + 900);
    expect(blok).toMatch(/\{s?r?\.satuan\}|satuan: s\.satuan/);
  });

  it("Stok Bahan memakai `qtyTeks`, bukan merangkai satuannya sendiri", () => {
    // `qtyTeks` yang tahu kapan padanan kemasan pantas ditampilkan dan kapan
    // tidak. Merangkai sendiri di halaman berarti aturan itu punya salinan
    // kedua — persis bentuk yang melahirkan "900 gr" vs "900 kg".
    expect(baca("pages/stok/StokPage.tsx")).toContain("qtyTeks({");
  });

  it("padanan kemasan tak ditampilkan saat saldo NOL", () => {
    // `qtyTeks` memang memulangkan "0 kg" untuk saldo nol — benar secara
    // aritmetika, tapi di layar ia cuma baris kedua yang mengulang nol.
    expect(qtyTeks({ qty: 0, satuan: "gram", isi: 1000, satuanBeli: "kg" }).setara).toBe("0 kg");
    expect(baca("pages/stok/StokPage.tsx")).toContain("s.saldo !== 0");
  });
});

const SRV = new URL("../src/", import.meta.url);

describe("server mengirim satuan kemasan ke daftar stok", () => {
  it("`satuan_beli` ikut dipilih query & dipetakan ke DTO", () => {
    const svc = baca("modules/stok/service.ts", SRV);
    expect(svc).toContain("i.satuan_beli AS satuan_beli");
    expect(svc).toContain("satuan_beli: row.satuan_beli != null");
  });

  it("`satuan_beli` ada di kontrak StokRowDto", () => {
    // Tanpa ini halaman tak punya cara tahu bahan ini dibeli per dus/kg, dan
    // padanan kemasannya diam-diam tak pernah muncul.
    const tipe = baca("../../../packages/shared/src/types.ts", SRV);
    const i = tipe.indexOf("export interface StokRowDto");
    expect(i).toBeGreaterThan(0);
    expect(tipe.slice(i, tipe.indexOf("\n}", i))).toContain("satuan_beli: string | null");
  });
});
