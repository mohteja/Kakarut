import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rapatkanJam } from "../src/modules/laporan/per-jam";

/**
 * GRAFIK TRANSAKSI PER JAM — sumbu waktunya tak boleh berbohong.
 *
 * Uji ini MENJALANKAN aturannya (`rapatkanJam` dipanggil betulan), bukan
 * mencocokkan teks sumber. Sisanya — ember jam dihitung di zona perusahaan —
 * dipatok ke sumber, sebab yang salah di situ tak kelihatan tanpa Postgres:
 * `EXTRACT(HOUR FROM waktu)` tanpa `AT TIME ZONE` tetap kueri yang SAH dan
 * tetap memulangkan angka, cuma tergeser tujuh jam di WIB. Penjualan jam 19
 * tampil di jam 12, dan "jam ramai" yang dibaca pemilik warung jadi jam yang
 * salah — tanpa satu pun galat.
 */
describe("rapatkanJam: jam kosong di tengah ikut, di ujung dipangkas", () => {
  it("mengisi lubang di tengah dengan nol", () => {
    const hasil = rapatkanJam([
      { jam: 16, jumlah: 1, omzet: 10_000 },
      { jam: 19, jumlah: 95, omzet: 3_825_000 },
    ]);
    expect(hasil.map((r) => r.jam)).toEqual([16, 17, 18, 19]);
    expect(hasil.map((r) => r.jumlah)).toEqual([1, 0, 0, 95]);
    expect(hasil.map((r) => r.omzet)).toEqual([10_000, 0, 0, 3_825_000]);
  });

  it("TIDAK memanjangkan ke 00–23 — ujungnya jam transaksi, bukan tengah malam", () => {
    const hasil = rapatkanJam([{ jam: 13, jumlah: 4, omzet: 40_000 }]);
    expect(hasil).toEqual([{ jam: 13, jumlah: 4, omzet: 40_000 }]);
  });

  it("rentang penuh sehari tetap utuh", () => {
    const masuk = Array.from({ length: 24 }, (_, j) => ({ jam: j, jumlah: 1, omzet: 1000 }));
    expect(rapatkanJam(masuk)).toHaveLength(24);
  });

  it("tanpa transaksi → deret kosong, bukan 24 batang nol", () => {
    // Grafik berisi 24 kolom nol membaca seperti "kami buka dan tak laku";
    // yang benar hari itu memang belum ada transaksi, dan layarnya memilih
    // untuk tidak menggambar apa pun.
    expect(rapatkanJam([])).toEqual([]);
  });

  it("urutan masukan tak berpengaruh — hasilnya selalu menaik", () => {
    const hasil = rapatkanJam([
      { jam: 20, jumlah: 2, omzet: 2000 },
      { jam: 18, jumlah: 5, omzet: 5000 },
    ]);
    expect(hasil.map((r) => r.jam)).toEqual([18, 19, 20]);
  });

  it("KEKEKALAN: merapatkan tak menambah atau menghilangkan transaksi", () => {
    /*
     * Sifat yang membuat grafik ini bisa dipercaya: cacah di batang-batangnya
     * HARUS berjumlah sama dengan kartu "Transaksi". Kalau perapatan diam-diam
     * menggandakan satu ember (mis. `Map` diganti gelung yang menimpa), grafik
     * dan kartunya akan berbeda tanpa ada yang error.
     */
    for (let putaran = 0; putaran < 200; putaran++) {
      const n = 1 + (putaran % 9);
      const masuk = Array.from({ length: n }, (_, i) => ({
        jam: (putaran * 7 + i * 3) % 24,
        jumlah: 1 + ((putaran + i) % 13),
        omzet: (1 + i) * 1000,
      }));
      // ember jam unik saja (GROUP BY tak pernah memulangkan jam kembar)
      const unik = [...new Map(masuk.map((r) => [r.jam, r])).values()];
      const hasil = rapatkanJam(unik);
      const jml = (a: { jumlah: number }[]) => a.reduce((x, r) => x + r.jumlah, 0);
      const omz = (a: { omzet: number }[]) => a.reduce((x, r) => x + r.omzet, 0);
      expect(jml(hasil), `putaran ${putaran}: cacah berubah`).toBe(jml(unik));
      expect(omz(hasil), `putaran ${putaran}: omzet berubah`).toBe(omz(unik));
      // dan deretnya benar-benar bersambung
      const jam = hasil.map((r) => r.jam);
      expect(jam).toEqual(Array.from({ length: jam.length }, (_, i) => jam[0] + i));
    }
  });
});

describe("ember jamnya dihitung di ZONA PERUSAHAAN, bukan UTC", () => {
  const RUTE = readFileSync(
    fileURLToPath(new URL("../src/modules/laporan/routes.ts", import.meta.url)),
    "utf8",
  );

  it("`EXTRACT(HOUR …)` memakai `AT TIME ZONE` dengan zona perusahaan", () => {
    expect(RUTE).toMatch(/EXTRACT\(HOUR FROM \(\$\{sales\.waktu\} AT TIME ZONE \$\{tzPerusahaan\}\)\)/);
    expect(RUTE).toContain('const tzPerusahaan = company?.timezone ?? "Asia/Jakarta"');
  });

  it("dikelompokkan lewat ORDINAL, bukan mengulang ekspresinya", () => {
    /*
     * Bukan soal gaya. Drizzle merender kolom yang sama BERBEDA di dua tempat:
     * `"waktu"` di daftar SELECT, `"sales"."waktu"` di GROUP BY. Bagi Postgres
     * itu dua ekspresi berlainan → 42803 "must appear in the GROUP BY clause"
     * pada kueri yang jelas-jelas sudah punya GROUP BY. Terjadi sungguhan saat
     * halamannya dibuka; typecheck-nya bersih.
     */
    expect(RUTE).toMatch(/\.groupBy\(sql`1`\)/);
    expect(RUTE).toMatch(/\.orderBy\(sql`1`\)/);
  });

  it("disaring `saleFilter` yang SAMA dengan kartu Transaksi", () => {
    // Kalau grafik dan kartunya memakai saringan berbeda, keduanya bisa
    // menunjukkan angka berlainan untuk hari yang sama — dan tak satu pun
    // salah menurut kodenya sendiri.
    const i = RUTE.indexOf("const jamExpr");
    expect(i).toBeGreaterThan(0);
    const blok = RUTE.slice(i, RUTE.indexOf("rapatkanJam(", i));
    expect(blok).toContain(".where(saleFilter)");
  });
});
