import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bolehLihatBiaya, MEDAN_BIAYA_BAHAN, MEDAN_BIAYA_MENU } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";

const SRV = fileURLToPath(new URL("../src", import.meta.url));
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const MOBILE = fileURLToPath(new URL("../../../../kakarut-mobile/lib", import.meta.url));
const SHARED = fileURLToPath(new URL("../../../packages/shared/src", import.meta.url));
const baca = (p: string, akar = SRV) => butaKomentar(readFileSync(`${akar}/${p}`, "utf8"));

/**
 * ANGKA BIAYA HANYA UNTUK MANAJEMEN — dan penjaganya di PINTU, bukan di layar.
 *
 * Aturannya sudah ditulis TIGA KALI sebelum ada penjaganya, dan tiap kali
 * dengan nama sendiri: `isManajemen` (`App.tsx`, `Layout.tsx`), `bolehUbah`
 * (`ResepPage`, yang bahkan tak MENGAMBIL datanya lewat `enabled: bolehUbah`),
 * dan `lihatHarga` (`resep_page.dart`). Yang tak pernah ada: `requireRole`
 * atau penyaring di rutenya.
 *
 * Terukur 2026-08-26 dengan token peran `bar` DAN `cashier` sungguhan, DB
 * segar — ketiganya (termasuk owner) membaca angka yang SAMA PERSIS:
 *
 *   GET /menu           hpp 5662,03 · hpp_dine_in 4732,03 · harga_saran
 *                       10820,01 · food_cost_persen 51,47 ·
 *                       komponen[].harga_per_unit 357,14
 *   GET /bahan          harga_beli 35.000 · harga_per_unit 777,78
 *   GET /penjualan/:id  totalHpp 5662,0314 · items[].hppSatuan 5662,0314
 *   GET /perlengkapan/:id/kartu   total_belanja
 *
 * SESUDAH: `null` untuk `bar`/`cashier`, angka penuh untuk owner/admin.
 * Pengukuran berpasangannya hidup di §261 verify-api.
 */
describe("angka biaya hanya untuk manajemen", () => {
  it("PREMIS: aturannya punya SATU rumah, dan isinya benar", () => {
    expect(bolehLihatBiaya("owner")).toBe(true);
    expect(bolehLihatBiaya("admin")).toBe(true);
    for (const r of ["cashier", "tim", "kitchen", "bar"] as const) {
      expect(bolehLihatBiaya(r), `${r} tak boleh melihat biaya`).toBe(false);
    }
    expect(bolehLihatBiaya(null)).toBe(false);
    expect(bolehLihatBiaya(undefined)).toBe(false);
  });

  it("ketiga definisi di LAYAR masih sepakat dengan rumahnya", () => {
    /*
     * Kalau salah satu layar kelak dilonggarkan sendiri (mis. `lihatHarga`
     * ditambah `isKasir`), layarnya akan menampilkan medan yang server-nya
     * kirim `null` — dan penggunanya membaca "—" tanpa tahu sebabnya. Yang
     * dijaga di sini KESEPAKATANNYA, bukan huruf per hurufnya.
     */
    expect(baca("App.tsx", WEB)).toContain(
      'auth.user.role === "owner" || auth.user.role === "admin"',
    );
    expect(baca("components/Layout.tsx", WEB)).toContain(
      'role === "owner" || role === "admin"',
    );
    // Di CI repo ini `kakarut-mobile` tidak di-checkout → dilewati, bukan
    // merah. Di mesin yang memuat KEDUANYA — tempat perubahan kebijakan ini
    // ditulis — ia menangkap layar yang menyimpang sebelum ter-commit, dan
    // itulah satu-satunya titik waktu saat penyimpangan bisa lolos.
    let dart: string;
    try {
      dart = readFileSync(`${MOBILE}/features/auth/auth_models.dart`, "utf8");
    } catch {
      return;
    }
    expect(dart).toContain("bool get isManajemen => role == 'owner' || role == 'admin'");
  });

  it("tiap `toMenuDto` yang KELUAR melewati `saringMenu`", () => {
    /*
     * Sapuan versi pertama melihat argumen `return c.json(...)` dan menuntut
     * ia menyebut penyaringnya. Ia BUTA terhadap bentuk yang paling wajar
     * dipakai orang saat mencabut penjaganya:
     *
     *     const dto = toMenuDto(row, katalog);
     *     return c.json(dto);            // ← tak menyebut toMenuDto sama sekali
     *
     * Suntikan bukti merah persis begitu, dan gerbangnya hijau. Yang dihitung
     * sekarang KESEIMBANGAN: tiap pemanggilan `toMenuDto` yang bukan situs
     * PERHITUNGAN wajib punya satu `saringMenu` yang menyertainya.
     */
    const rute = baca("modules/menu/routes.ts");
    const semua = [...rute.matchAll(/toMenuDto\(/g)].length;
    // Dua situs memakai `toMenuDto` untuk MENGHITUNG, bukan mengeluarkan —
    // dan keduanya di rute owner/admin: analisis harga (`persen_hpp`,
    // `food_cost_persen`) dan "terapkan saran" (`harga_jual_bulat` jadi harga
    // jual baru). Menyaringnya di sana bukan menjaga apa pun, ia merusak
    // perhitungannya.
    const HITUNG = 2;
    const keluar = semua - HITUNG;
    const saring = [...rute.matchAll(/saringMenu\(/g)].length - 1; // −1: definisinya
    expect(semua, "pemanggilan toMenuDto tak terbaca").toBeGreaterThanOrEqual(6);
    expect(
      saring,
      `${keluar} situs keluaran toMenuDto tapi cuma ${saring} yang disaring — ` +
        "situs keluaran baru wajib lewat `saringMenu`, dan situs PERHITUNGAN " +
        "baru wajib menaikkan HITUNG di uji ini beserta alasannya",
    ).toBe(keluar);
  });

  it("tiap keluaran BahanDto melewati `saringBahan`", () => {
    const rute = baca("modules/bahan/routes.ts");
    // `toDto(` di luar definisinya sendiri wajib dibungkus `saringBahan`.
    const pakai = [...rute.matchAll(/[^\w](toDto\([^;]*)/g)]
      .map((m) => m[1])
      .filter((x) => !x.startsWith("toDto(\n") && !/^toDto\(\s*row: typeof/.test(x));
    expect(pakai.length, "pemakaian toDto tak terbaca").toBeGreaterThanOrEqual(8);
    const telanjang = pakai.filter((x) => !/saringBahan/.test(x));
    // `saringBahan(auth.role, toDto(...))` → potongannya diawali `toDto(`,
    // jadi yang diperiksa BARIS pemakaiannya, bukan potongan itu sendiri.
    const barisTelanjang = telanjang.filter((x) => {
      const i = rute.indexOf(x);
      const awalBaris = rute.lastIndexOf("\n", i);
      const konteks = rute.slice(Math.max(0, awalBaris - 200), i);
      return !/saringBahan/.test(konteks);
    });
    expect(
      barisTelanjang.map((x) => x.slice(0, 70)),
      "keluaran BahanDto tanpa penyaring biaya",
    ).toEqual([]);
  });

  it("penyaringnya menihilkan SELURUH medan biaya, tak ada yang tertinggal", () => {
    // Medan biaya baru yang lahir di DTO menagih keputusan: kalau ia ditambah
    // ke `MEDAN_BIAYA_*` tanpa dinihilkan penyaringnya, baris ini merah.
    const biaya = baca("biaya.ts", SHARED);
    for (const m of MEDAN_BIAYA_MENU) {
      expect(biaya, `tanpaBiayaMenu tak menihilkan ${m}`).toContain(`${m}: null`);
    }
    for (const m of MEDAN_BIAYA_BAHAN) {
      expect(biaya, `tanpaBiayaBahan tak menihilkan ${m}`).toContain(`${m}: null`);
    }
    // harga di dalam komponen resep ikut, kalau tidak struktur biayanya bisa
    // disusun ulang dari balasan yang katanya sudah disaring
    expect(biaya).toContain("harga_per_unit: null");
  });

  it("papan pesanan TIDAK ikut tertutup — pasangan anti-rusak", () => {
    /*
     * SnackBar "HPP transaksi dihitung ulang → Rp …" untuk dapur/bar adalah
     * fitur TERKIRIM. Ia membaca `total_hpp` dari balasan POST
     * `/pesanan/:jenis/:id/item/:itemId/sajian`, bukan dari rute BACA — jadi
     * kebijakan ini tak boleh menyentuhnya. Kalau kelak seseorang menyaring
     * balasan POST itu juga, baris ini yang menahannya.
     */
    const pesanan = baca("modules/pesanan/routes.ts");
    const sajian = pesanan.slice(pesanan.indexOf('"/:jenis/:id/item/:itemId/sajian"'));
    expect(sajian).toContain("total_hpp");
    expect(
      sajian.slice(0, sajian.indexOf("\n  .")),
      "balasan POST sajian ikut disaring — SnackBar HPP dapur/bar akan mati",
    ).not.toContain("bolehLihatBiaya");
  });

  it("UTANG BERSYARAT: `/stok` masih mengirim harga per bahan", () => {
    /*
     * Satu-satunya medan biaya yang SENGAJA belum ditahan, dan alasannya
     * tanggal rilis — bukan kelalaian:
     *
     *   Kartu "Nilai stok" ponsel menghitung totalnya SENDIRI dari
     *   `harga_per_unit` tiap baris. Build terpasang di tablet masih
     *   `1.0.0+10`, dan rilis berikutnya tertahan keystore Android yang belum
     *   ada. Menahan medannya hari ini memadamkan kartu itu di lapangan.
     *
     * SYARAT PENCABUTAN — dan tanpa syarat ini ia jadi pengecualian permanen
     * yang menyamar: sesudah build ponsel yang memakai `GET /stok/nilai`
     * TAYANG dan build lama habis, `hitungSaldoCabang` disaring di batas rute
     * `GET /stok` persis seperti `/menu` dan `/bahan`, lalu baris ini dihapus.
     *
     * Sisi klien SUDAH siap di kedua repo: keduanya memakai agregat server
     * begitu `harga_per_unit` datang `null`.
     */
    const stok = baca("modules/stok/routes.ts");
    expect(stok).toContain('.get("/nilai"');
    expect(stok).toContain("ringkasNilaiStok");
    expect(
      stok.slice(stok.indexOf('.get("/", '), stok.indexOf('.get("/nilai"')),
      "`GET /stok` kini menyaring — hapus utang bersyarat ini dan uji pasangannya",
    ).not.toContain("bolehLihatBiaya");
  });
});
