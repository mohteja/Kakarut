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
      // Riwayat kirim email dipindah dari SistemPage ke halamannya sendiri
      // (2026-09-02); rumusan zonanya ikut pindah, jadi berkasnya bertambah.
      "pages/superadmin/RiwayatEmailPage.tsx",
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

/**
 * …DAN SKRIP VERIFIKASINYA HARUS IKUT BERSUARA SAMA.
 *
 * `verify-api.sh` menembak API sungguhan lalu mengadu hasilnya dengan tanggal
 * yang dihitungnya sendiri di shell. Server menghitung TANGGAL BISNIS pada zona
 * perusahaan; kontainer CI berjalan UTC. Setiap `date +%F` tanpa
 * `TZ=Asia/Jakarta` karena itu mengadu dua kalender berbeda, dan selisihnya
 * muncul persis di jam 17.00–24.00 UTC — saat Jakarta sudah berganti hari.
 *
 * Bukan hipotesis. Saat uji ini ditulis, §218 memakai `date -u -d '6 days ago'`
 * dan gagal pada pukul 23.18 UTC: tunggakannya terhitung 8×3=24 alih-alih
 * 7×3=21, jadi sisanya 76 bukan 79. Delapan belas dari dua puluh perhitungan
 * tanggal-saja di skrip itu sudah benar — dua di antaranya bahkan menuliskan
 * alasannya di komentar — dan dua pintu terlewat.
 *
 * Yang paling mahal bukan kegagalannya, melainkan BENTUKnya: gerbang yang merah
 * tujuh jam setiap hari tanpa sebab nyata mengajari orang mengabaikan warna
 * merah. Sesudah itu ia tak menjaga apa pun, termasuk saat tuduhannya benar.
 */
describe("verify-api.sh memakai tanggal bisnis, bukan tanggal kontainer", () => {
  const skrip = baca("scripts/verify-api.sh");
  const baris = skrip.split("\n");

  /**
   * Baris yang menghitung TANGGAL-SAJA (`+%F` tanpa jam). Timestamp lengkap
   * (`+%FT%TZ`) sengaja dikecualikan: ia menyebut satu titik waktu mutlak, dan
   * dalam UTC memang itu bentuk yang benar.
   */
  const tanggalSaja = baris
    .map((isi, i) => ({ no: i + 1, isi }))
    .filter((b) => !b.isi.trimStart().startsWith("#"))
    /*
     * Dipecah per PERINTAH, bukan per baris.
     *
     * Versi pertama memeriksa barisnya utuh, dan bukti-merahnya menemukan
     * lubangnya: `DARI80=…; SAMPAI80=…` menaruh DUA perhitungan di satu baris,
     * jadi satu `TZ=` di paruh kedua membuat paruh pertama yang telanjang ikut
     * lolos. Penjaga yang lolos separuh justru lebih buruk daripada tak ada —
     * ia menerbitkan kesan sudah diperiksa.
     */
    .flatMap((b) => b.isi.split(";").map((isi) => ({ no: b.no, isi })))
    .filter((b) => /date[^\n|]*\+%F(?!T)/.test(b.isi));

  it("premis: penyapunya benar-benar menemukan perhitungan tanggalnya", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat uji di bawah hijau tanpa
    // memeriksa satu baris pun.
    expect(tanggalSaja.length).toBeGreaterThan(10);
  });

  it("INTI: tiap perhitungan tanggal-saja memakai TZ=Asia/Jakarta", () => {
    const menyimpang = tanggalSaja
      .filter((b) => !b.isi.includes(`TZ=${ZONA_WEB}`))
      .map((b) => `verify-api.sh:${b.no}  ${b.isi.trim().slice(0, 90)}`);
    expect(
      menyimpang,
      "baris ini mengadu tanggal UTC/kontainer dengan tanggal bisnis server. " +
        `Awali dengan TZ=${ZONA_WEB} — kalau tidak, gerbangnya merah tiap hari ` +
        "antara 17.00 dan 24.00 UTC",
    ).toEqual([]);
  });

  it("PASANGAN: penyapunya bisa MENUDUH, dan tak menuduh bentuk yang benar", () => {
    // Tanpa pasangan ini, "daftar kosong" juga hijau seandainya regexnya tak
    // pernah cocok dengan apa pun.
    const cocok = (s: string) => /date[^\n|]*\+%F(?!T)/.test(s);
    expect(cocok("MULAI=$(date -u -d '6 days ago' +%F)")).toBe(true);
    expect(cocok("HARI=$(TZ=Asia/Jakarta date +%F)")).toBe(true);
    // timestamp lengkap BUKAN sasarannya — UTC memang benar di sana
    expect(cocok('W=$(date -u +%FT%TZ)')).toBe(false);
    expect(cocok("W=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)")).toBe(false);
  });
});
