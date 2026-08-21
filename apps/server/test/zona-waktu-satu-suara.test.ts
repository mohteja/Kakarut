import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SERVER MEMBACA ZONA WAKTU PERUSAHAAN; WEB MEMATOKNYA KE WIB.
 *
 * Server berhati-hati soal tanggal bisnis: `companies.timezone` dibaca di
 * absensi, kebersihan, dan `createSale` lewat `tanggalDi(tz, …)`. Web tidak —
 * ia memakai `Asia/Jakarta` yang ditulis langsung di 13 tempat, dan
 * `hariIniWIB()` punya parameter `timeZone` yang TAK PERNAH diisi satu
 * pemanggil pun.
 *
 * Hari ini keduanya sepakat, tapi karena SEBAB YANG RAPUH: kolomnya tak pernah
 * ditulis. Tak ada `insert(companies)` yang mengisinya dan `PATCH /company`
 * tak menerimanya, jadi setiap perusahaan memakai nilai bawaan — yang kebetulan
 * sama dengan yang dipatok web.
 *
 * Yang terjadi begitu kolom itu bisa diubah (satu baris di zod, atau satu
 * UPDATE manual di basis data): server langsung memakai zona baru, web tetap
 * WIB, dan keduanya berselisih SATU HARI selama satu jam pertama tiap hari di
 * WITA — dua jam di WIT. Itu bukan jam yang sepi untuk F&B. Akibatnya bukan
 * galat melainkan angka:
 *
 *   - Stok Awal dikirim bertanggal kemarin, dan seluruh jendela saldo opname
 *     (`sc.waktu > baseline.created_at`) bergeser ikut;
 *   - Riwayat Transaksi membuka hari yang salah, jadi transaksi yang baru saja
 *     dibuat kasir tampak hilang;
 *   - jam di struk yang dibawa pulang tamu meleset satu jam.
 *
 * MAKA: selama web masih mematok WIB, kolom itu HARUS tetap tak bisa diubah.
 * Uji ini menahan pasangan itu. Kalau suatu saat zona waktu memang perlu bisa
 * disetel, uji ini yang merah lebih dulu — dan daftar berkas di bawah adalah
 * daftar kerja yang harus dibereskan sebelum kolomnya dibuka.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const WEB = AKAR + "apps/web/src/";
const baca = (p: string) => readFileSync(AKAR + p, "utf8");

/** Zona yang dipatok web. Satu-satunya nilai yang boleh dipunyai perusahaan. */
const ZONA_WEB = "Asia/Jakarta";

function semuaSumber(dir: string, ext: RegExp): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaSumber(p + "/", ext));
    else if (ext.test(nama)) hasil.push(p);
  }
  return hasil;
}

describe("zona waktu: server & web tak boleh berselisih diam-diam", () => {
  it("bawaan kolomnya SAMA dengan yang dipatok web", () => {
    // Kalau bawaannya digeser tanpa web ikut, seluruh perusahaan baru langsung
    // berselisih sejak hari pertama.
    expect(baca("apps/server/src/db/schema.ts")).toContain(
      `timezone: text("timezone").notNull().default("${ZONA_WEB}")`,
    );
  });

  it("web memang masih mematoknya (uji ini gugur kalau sudah tak relevan)", () => {
    // Patokan arah-balik: begitu web berhenti mematok WIB, uji ini harus
    // ditinjau — bukan dibiarkan hijau menjaga aturan yang sudah usang.
    const dipatok = semuaSumber(WEB, /\.tsx?$/)
      .filter((p) => readFileSync(p, "utf8").includes(ZONA_WEB))
      .map((p) => p.slice(WEB.length))
      .sort();
    /*
     * Daftar ini MENYUSUT saat slip pesanan lahir, bukan bertambah.
     *
     * Slip itu butuh waktu berformat sama dengan struk, dan menyalin
     * `Intl.DateTimeFormat(... "Asia/Jakarta")` ke pemanggil kedua akan
     * memperpanjang daftar kerja ini. Rumusannya dipindahkan ke satu rumah
     * (`lib/format.ts` → `waktuKertasWIB`), yang memang sudah ada di daftar —
     * jadi `ReceiptModal` KELUAR dan `KasirPage` tak pernah masuk.
     *
     * Yang harus dipegang pembaca berikutnya: menambah PEMANGGIL tak
     * memperpanjang daftar ini; menambah RUMUSAN memperpanjangnya.
     */
    expect(dipatok, "daftar berkas web yang memaku zona waktu").toEqual([
      "lib/format.ts",
      "pages/bahan/DetailBahanPage.tsx",
      "pages/stok/KartuStokPage.tsx",
      "pages/superadmin/BackupPage.tsx",
      "pages/superadmin/ErrorLogPage.tsx",
      "pages/superadmin/SistemPage.tsx",
    ]);
  });

  it("`hariIniWIB` boleh diberi zona, tapi bawaannya tetap zona yang dipatok", () => {
    // Parameternya sudah ada — itu bukti niat awalnya. Yang belum: satu pun
    // pemanggil mengisinya. Bawaannya harus tetap sepakat sampai itu terjadi.
    expect(baca("apps/web/src/lib/format.ts")).toContain(
      `export function hariIniWIB(timeZone = "${ZONA_WEB}"): string`,
    );
  });

  it("TAK ADA jalan mengubah zona waktu perusahaan lewat API", () => {
    // Inti penjaga ini. Menambahkan satu baris di zod akan membuat uji ini
    // merah — dan itu memang yang diinginkan: bereskan dulu berkas web di atas.
    const rute = baca("apps/server/src/modules/company/routes.ts");
    expect(
      /timezone/.test(rute),
      "PATCH /company mulai menyentuh timezone — wirekan dulu zona perusahaan ke web " +
        "(lihat daftar berkas di uji 'web memang masih mematoknya')",
    ).toBe(false);
  });

  it("dan tak ada pembuatan perusahaan yang mengisinya sendiri", () => {
    const sumber = semuaSumber(AKAR + "apps/server/src/", /\.ts$/);
    const pembuat = sumber.filter((p) => /\.insert\(companies\)/.test(readFileSync(p, "utf8")));
    // Non-vakum: kalau penyapunya berhenti menemukan pembuat perusahaan, uji di
    // bawah lulus tanpa memeriksa apa pun.
    expect(pembuat.length, "tak satu pun jalur pembuatan perusahaan terbaca").toBeGreaterThanOrEqual(
      3,
    );

    const mengisi = pembuat.filter((p) => {
      const isi = readFileSync(p, "utf8");
      // `.values({ … })` yang menyusul `insert(companies)` — cukup 400 aksara
      // sesudahnya untuk menangkap blok nilainya.
      const m = /\.insert\(companies\)([\s\S]{0,400})/.exec(isi);
      return m != null && /timezone/.test(m[1]);
    });
    expect(
      mengisi.map((p) => p.slice(AKAR.length)),
      "perusahaan dibuat dengan zona waktu sendiri — web masih mematok WIB",
    ).toEqual([]);
  });
});
