import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * KAS LACI MILIK SHIFT, BUKAN MILIK HARI INI.
 *
 * "Kas seharusnya" adalah janji yang sangat spesifik: uang yang HARUS ADA di
 * laci saat ini. Ia muncul di empat tempat — `/shift/aktif` (layar kasir),
 * modal detail shift, daftar `/shift/selisih`, dan kartu Operasional Cabang
 * milik owner — dan angka yang sama itulah yang dibandingkan `POST
 * /shift/tutup` untuk melahirkan selisih kas yang harus di-ACC owner. Empat
 * tempat, satu angka; kalau salah satunya menghitung sendiri, yang muncul bukan
 * galat melainkan tuduhan.
 *
 * Yang pernah terjadi persis di sini: `GET /shift/pantau` menyusun kasnya dari
 * `modal_awal` (milik SHIFT yang sedang terbuka) ditambah penjualan tunai
 * SEHARIAN. Dua jendela berbeda, dijumlahkan jadi satu angka.
 *
 * Akibatnya di cabang bershift dua — pagi lalu sore, alur biasa dan memang
 * diizinkan (indeks `shifts_open_per_branch_uq` hanya melarang dua shift
 * TERBUKA sekaligus): begitu kasir sore membuka laci, "Kas seharusnya" di layar
 * owner ikut memuat seluruh tunai shift pagi — uang yang sudah dihitung,
 * dicocokkan, dan diangkat dari laci saat tutup kasir. Owner membaca kekurangan
 * sebesar omzet tunai satu shift penuh, pada layar yang justru dipakai memantau
 * kejujuran kas. Dua selisih lain dari sumbu yang sama: refund atas penjualan
 * HARI SEBELUMNYA mengambil uang dari laci hari ini tanpa terlihat di jendela
 * `sale_date = hari ini`, dan shift yang melewati tengah malam kehilangan
 * seluruh penjualan sebelum pukul 00:00.
 *
 * Uji ini menahan aturannya di sumbernya: SETIAP "modal_awal + X" di modul
 * shift, X-nya wajib berjendela SHIFT. Penyapu, bukan daftar baris — yang
 * menambahkan layar kas kelima dengan angka harian ketahuan di sini.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const baca = (p: string) => readFileSync(AKAR + p, "utf8");

const SHIFT = baca("apps/server/src/modules/shift/routes.ts");

/** Blok penangan `GET /shift/pantau` saja — rute sesudahnya adalah `.get("/")`. */
const PANTAU = (() => {
  const mulai = SHIFT.indexOf('.get("/pantau"');
  const akhir = SHIFT.indexOf('.get("/"', mulai + 1);
  expect(mulai, "penangan /shift/pantau tak ditemukan").toBeGreaterThan(0);
  expect(akhir, "batas akhir blok /pantau tak ditemukan").toBeGreaterThan(mulai);
  return SHIFT.slice(mulai, akhir);
})();

describe("kas seharusnya: satu angka untuk semua layar", () => {
  it("tiap `modal_awal + X` memakai X yang berjendela SHIFT", () => {
    // `!` (non-null assertion) ikut dilucuti: `tunaiShift!` dan `tunaiShift`
    // adalah nilai yang sama.
    const penjumlah = [...SHIFT.matchAll(/modalAwal\s*\+\s*([A-Za-z_$][\w$.]*)!?/g)].map(
      (m) => m[1],
    );
    // Non-vakum: kalau penyapunya berhenti menemukan perhitungan kas, seluruh
    // pemeriksaan di bawah lulus tanpa memeriksa apa pun.
    expect(penjumlah.length, "tak satu pun perhitungan kas laci terbaca").toBeGreaterThanOrEqual(3);
    expect(
      [...new Set(penjumlah)].sort(),
      "kas laci dijumlah dengan angka yang bukan milik shift berjalan — agregat " +
        "harian (`s.tunai`) tak boleh dipakai di sini; lihat komentar uji ini",
    ).toEqual(["rekap.penjualan_tunai", "tunaiShift"]);
  });

  it("`/pantau` menghitung kasnya lewat `rekapWindow`, bukan agregat harian", () => {
    // Inti perbaikannya. `rekapWindow` adalah fungsi yang sama dengan yang
    // dipakai `/shift/aktif`, detail shift, `/shift/selisih`, dan `tutup` —
    // termasuk atribusi refund ke shift tempat uangnya keluar laci.
    expect(
      PANTAU.includes("rekapWindow("),
      "/pantau tidak lagi memanggil rekapWindow — kasnya kembali dihitung sendiri",
    ).toBe(true);
    expect(PANTAU).toContain("kas_sistem: open ? open.modalAwal + tunaiShift! : 0,");
  });

  it("tapi rekap HARI INI tetap harian — bukan ikut disempitkan ke shift", () => {
    /*
     * Patokan arah-balik, dan bukan basa-basi: cara termudah "menyeragamkan"
     * kartu ini adalah menyempitkan SEMUA angkanya ke shift berjalan. Itu
     * membuat judul "Rekap hari ini" dan medan `jumlah_transaksi` berbohong ke
     * arah sebaliknya — cabang bershift dua akan terlihat sepi separuh hari.
     * Yang benar memang DUA jendela di satu kartu, dengan keterangan.
     */
    expect(PANTAU).toContain("penjualan_tunai: s.tunai,");
    expect(PANTAU).toContain("penjualan_nontunai: s.nontunai,");
    expect(PANTAU).toContain("jumlah_transaksi: s.jumlah,");
    // dan jendela harian itu memang datang dari `sale_date = hari ini`
    expect(PANTAU).toMatch(/eq\(sales\.saleDate,\s*today\)/);
  });

  it("angka shift ikut dikirim, jadi selisih dua jendelanya bisa dijelaskan", () => {
    // Dua jendela pada satu kartu WAJIB bisa diterangkan. Tanpa medan ini web
    // hanya punya angka harian dan kas laci yang tak menjumlah — persis bentuk
    // "dua angka berselisih tanpa keterangan" yang dihindari di sini.
    expect(PANTAU).toContain("penjualan_tunai_shift: tunaiShift,");
    expect(baca("packages/shared/src/types.ts")).toContain("penjualan_tunai_shift: number | null;");
    expect(
      baca("apps/web/src/pages/operasional/OperasionalPage.tsx").includes(
        "row.penjualan_tunai_shift",
      ),
      "web tak membaca penjualan_tunai_shift — kartu Operasional kembali " +
        "menampilkan dua angka yang tak menjumlah tanpa keterangan",
    ).toBe(true);
  });

  it("kasir tutup → tak ada kas laci untuk dilaporkan (null, bukan 0)", () => {
    // Nol adalah angka yang sah ("shift ini belum menerima tunai"); klien tak
    // punya cara membedakannya dari "tak ada shift".
    expect(PANTAU).toContain("const tunaiShift = open ? (tunaiShiftByBranch.get(b.id) ?? 0) : null;");
  });
});
