import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga CAKUPAN penyegaran opname — bukan sekadar keberadaan kuncinya.
 *
 * `invalidate-kunci.test.ts` menjaga hal lain: bahwa tiap kunci yang
 * di-invalidate benar-benar dipakai sebuah query. Ia menyatakan batasnya
 * sendiri dengan jujur — "TIDAK menjamin cakupannya lengkap" — dan persis di
 * celah itulah cacat ini hidup: barisnya ADA, kuncinya HIDUP, tapi kurang.
 *
 * MENYIMPAN opname perlengkapan menulis mutasi, bukan cuma mengajukan selisih.
 * `POST /perlengkapan/opname` menjalankan `terapkanKonsumsiOtomatis` lebih
 * dulu, yang menyisipkan `supply_mutations` ber-status `disetujui` — dan baris
 * itu langsung terbaca oleh kartu perlengkapan (`status = 'disetujui'`) maupun
 * `/perlengkapan/master` (yang juga memotong jatah otomatis sebelum
 * menghitung). Sesi barunya muncul di Riwayat Opname, yang tautannya ada di
 * header halaman itu sendiri.
 *
 * ATURANNYA, dan sebabnya ditulis sebagai paritas dan bukan daftar tetap:
 * MENYIMPAN dan meng-ACC sesi yang sama menggerakkan angka yang sama, jadi
 * keduanya wajib menyegarkan layar yang sama. Daftar tetap akan basi diam-diam
 * begitu salah satu sisi menambah kunci baru; paritas ikut bergerak sendiri.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const SIMPAN = baca("../../web/src/pages/stok/OpnamePerlengkapanPage.tsx");
const RIWAYAT = baca("../../web/src/pages/stok/OpnameRiwayatPage.tsx");

/** Kunci yang di-invalidate di dalam sepotong sumber — literal maupun lewat `for`. */
function kunciSegar(sumber: string): Set<string> {
  const out = new Set<string>();
  for (const m of sumber.matchAll(/invalidateQueries\(\{\s*queryKey:\s*\[\s*"([^"]+)"/g)) {
    out.add(m[1]);
  }
  // bentuk `for (const k of [...]) invalidateQueries({ queryKey: [k] })`
  for (const m of sumber.matchAll(/for \(const k of \[([^\]]*)\]\)/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) out.add(s[1]);
  }
  return out;
}

/**
 * Bagian `OpnameRiwayatPage` yang mengurus PERLENGKAPAN saja. Berkas itu
 * memuat dua penangan berdampingan (bahan baku & perlengkapan); mengambil
 * seluruh berkas akan mencampur `stok`/`kartu-stok` ke dalam perbandingan.
 */
const AWAL_PERLENGKAPAN = RIWAYAT.indexOf('"perlengkapan-opname"');
const BAGIAN_PERLENGKAPAN = RIWAYAT.slice(AWAL_PERLENGKAPAN - 400, AWAL_PERLENGKAPAN + 700);

describe("menyimpan opname perlengkapan menyegarkan sebanyak meng-ACC-nya", () => {
  const disimpan = kunciSegar(SIMPAN);
  const diAcc = kunciSegar(BAGIAN_PERLENGKAPAN);

  it("potongan sumber yang dibandingkan memang berisi keduanya", () => {
    // Kalau salah satu kosong, seluruh perbandingan jadi hampa.
    expect(disimpan.size, "kunci pada jalur simpan").toBeGreaterThan(0);
    expect(diAcc.size, "kunci pada jalur ACC perlengkapan").toBeGreaterThan(0);
    // Jangan sampai potongannya menyeret jalur bahan baku.
    expect(diAcc.has("kartu-stok")).toBe(false);
  });

  it("tiap kunci yang disegarkan saat ACC juga disegarkan saat menyimpan", () => {
    const kurang = [...diAcc].filter((k) => !disimpan.has(k)).sort();
    expect(kurang, `jalur simpan tidak menyegarkan: ${kurang.join(", ")}`).toEqual([]);
  });

  it("kartu & riwayat termasuk — dua yang dulu tertinggal", () => {
    // Disebut eksplisit supaya kegagalannya bercerita, bukan sekadar "himpunan
    // tak sama": kartu perlengkapan dan daftar Riwayat Opname adalah dua layar
    // yang benar-benar dilihat orang sesudah menyimpan.
    expect(disimpan.has("kartu-perlengkapan")).toBe(true);
    expect(disimpan.has("perlengkapan-opname")).toBe(true);
  });
});

/**
 * Kembarannya untuk BAHAN BAKU sudah benar sejak awal — dipatok agar tetap
 * begitu, karena dialah pembanding yang membuat sisi perlengkapan terlihat
 * kurang.
 */
describe("opname bahan baku tetap menyegarkan kartu & riwayatnya", () => {
  const bahan = kunciSegar(baca("../../web/src/pages/stok/OpnamePage.tsx"));
  it("kartu stok & riwayat opname ikut disegarkan", () => {
    expect(bahan.has("kartu-stok")).toBe(true);
    expect(bahan.has("opname-riwayat")).toBe(true);
  });
});
