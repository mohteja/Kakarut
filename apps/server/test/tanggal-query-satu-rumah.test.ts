import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { bulanSah, tanggalSah } from "../src/lib/tanggal-query";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
function berkasTs(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? berkasTs(p, out) : p.endsWith(".ts") && out.push(p);
  }
  return out;
}
const sumber = () =>
  berkasTs(SRC).map((f) => ({ nama: f.slice(SRC.length + 1), isi: butaKomentar(readFileSync(f, "utf8")) }));

/**
 * TANGGAL DARI QUERY — cabang GAGALNYA punya pemilik, dan aturannya SATU.
 *
 * Terukur 2026-08-26 atas **36** pembacaan param tanggal di `c.req.query(...)`:
 * **29** memeriksa keabsahannya lalu **gagal DIAM** (dilewati atau jatuh ke
 * bawaan), **5** tak memeriksa sama sekali, **2** menolak. Aturannya ada dan
 * dipanggil; yang tak pernah ada: apa yang terjadi saat ia bilang "tidak sah".
 *
 * Dua kerusakan terukur lewat HTTP, dan keduanya lahir dari akar yang sama —
 * aturan "tanggal ini sah" punya TIGA salinan yang tak sepakat
 * (`laporan:34` & `rekomendasi:86` & `penerimaan:243` regex-saja;
 * `absensi:51` & `pengajuan:29` regex + tanggalnya benar-benar ada):
 *
 *   1. `GET /laporan?dari=2026-02-30` → **500** "Terjadi kesalahan pada
 *      server". Bentuknya lolos regex, isinya ditolak Postgres. Berlaku di
 *      SELURUH rute `/laporan/*`. SESUDAH: **400** yang menyebut paramnya.
 *   2. `GET /pengajuan?dari=BUKAN` → **200 dengan SELURUH tabel** (4 baris
 *      untuk rentang yang sah → **13**), dan satu paruh ngawur membuang KEDUA
 *      saringannya. Balasannya larik telanjang, jadi layar tetap memajang
 *      pilihan tanggal yang tak dipakai. SESUDAH: **400** bernama.
 *
 * Sesudah putaran ini: **1** pembacaan mentah tersisa (yang memang menolak),
 * sisanya lewat `lib/tanggal-query`.
 */
describe("tanggal dari query: satu rumah, cabang gagal bertuan", () => {
  it("PREMIS: pemeriksanya menolak tanggal yang BENTUKNYA benar tapi tak ada", () => {
    // Inilah pemeriksaan yang hilang di tiga salinan regex-saja, dan yang
    // membuat 2026-02-30 sampai ke Postgres.
    expect(tanggalSah("2026-08-26")).toBe(true);
    expect(tanggalSah("2026-02-28")).toBe(true);
    expect(tanggalSah("2024-02-29"), "2024 kabisat").toBe(true);
    expect(tanggalSah("2026-02-29"), "2026 bukan kabisat").toBe(false);
    expect(tanggalSah("2026-02-30")).toBe(false);
    expect(tanggalSah("2026-13-45")).toBe(false);
    expect(tanggalSah("9999-99-99")).toBe(false);
    expect(tanggalSah("BUKAN")).toBe(false);
    expect(tanggalSah("")).toBe(false);
    expect(bulanSah("2026-08")).toBe(true);
    expect(bulanSah("2026-13")).toBe(false);
    expect(bulanSah("2026-00")).toBe(false);
    expect(bulanSah("NGAWUR")).toBe(false);
  });

  it("tak ada param tanggal yang dibaca MENTAH lagi", () => {
    /*
     * Sapuan mekanis, bukan daftar tangan. `tanggalQuery`/`bulanQuery` membaca
     * `c.req.query(nama)` dengan VARIABEL, jadi ia tak ikut terhitung —
     * yang terhitung hanya pembacaan literal yang melewati rumahnya.
     */
    const TANGGAL = /^(dari|sampai|tanggal|bulan|pakai_dari|pakai_sampai)$/;
    const mentah: string[] = [];
    for (const { nama, isi } of sumber()) {
      if (nama === "lib/tanggal-query.ts") continue;
      for (const m of isi.matchAll(/c\.req\.query\(\s*"([^"]+)"\s*\)/g)) {
        if (!TANGGAL.test(m[1])) continue;
        mentah.push(`${nama}:${isi.slice(0, m.index!).split("\n").length} [${m[1]}]`);
      }
    }
    expect(
      mentah,
      "param tanggal dibaca mentah — pakai `tanggalQuery(c, nama)` / " +
        "`bulanQuery(c, nama)` dari `lib/tanggal-query`, supaya tanggal yang " +
        "ADA tapi tak sah dibalas 400 bernama alih-alih diam-diam dilewati " +
        "(terukur: seluruh tabel terbaca) atau meledak 500 di Postgres",
    ).toEqual([]);
  });

  it("tak ada SALINAN KEDUA aturan tanggalnya — query MAUPUN badan", () => {
    /*
     * LIMA salinan yang tak sepakat adalah sebab kedua kerusakan di atas, dan
     * penyakitnya melintasi dua permukaan: query DAN badan. Terukur di badan
     * juga — `POST /stok/awal` dengan `tanggal: "2026-02-30"` → **500**,
     * sebab `z.string().regex(...)` pun cuma memeriksa bentuk.
     *
     * Yang dijaga: regex tanggal tak lahir lagi di luar rumahnya, di kedua
     * permukaan. Untuk badan pakai `zTanggal`; untuk query `tanggalQuery`.
     */
    const salinan: string[] = [];
    for (const { nama, isi } of sumber()) {
      if (nama === "lib/tanggal-query.ts") continue;
      for (const m of isi.matchAll(/\\d\{4\}-\\d\{2\}-\\d\{2\}/g)) {
        salinan.push(`${nama}:${isi.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(
      salinan,
      "regex tanggal lahir di luar `lib/tanggal-query` — salinan yang tak " +
        "sepakat persis yang melahirkan 500 pada `2026-02-30`. Pakai " +
        "`zTanggal` (badan) atau `tanggalQuery` (query)",
    ).toEqual([]);
  });

  it("PASANGAN: param KOSONG tetap berarti 'tanpa rentang', bukan galat", () => {
    /*
     * Form yang belum diisi mengirim `?dari=&sampai=`. Menolaknya akan
     * mematahkan layar yang hari ini bekerja — terukur tetap 200 dengan 13
     * baris (seluruh tabel), dan itu memang jawaban yang benar untuk "tanpa
     * rentang". Yang ditolak hanya nilai yang ADA tapi tak sah.
     */
    const isi = readFileSync(join(SRC, "lib/tanggal-query.ts"), "utf8");
    expect(isi).toContain('if (v === undefined || v === "") return undefined;');
    // dan galatnya WAJIB menyebut nama paramnya — 400 tanpa sebutan medan
    // adalah kelas yang ledger ini sudah bayar sekali (§39).
    expect(isi).toContain("Tanggal pada");
    expect(isi).toMatch(/\$\{nama\}/);
  });
});
