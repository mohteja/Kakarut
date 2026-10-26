import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SERVER DAN WEB MEMBACA ZONA WAKTU YANG SAMA — ZONA PERUSAHAAN.
 *
 * Server berhati-hati soal tanggal bisnis: `companies.timezone` dibaca di
 * absensi, kebersihan, dan `createSale` lewat `tanggalDi(tz, …)`. Sampai
 * 2026-10-26 web TIDAK — ia memaku `Asia/Jakarta` di tiap pemformat — dan
 * keduanya sepakat hanya karena kolomnya tak pernah ditulis. Uji ini dulu
 * MENGUNCI kolom itu selama web masih memaku WIB.
 *
 * Kini kebalikannya: pemilik memilih WIB/WITA/WIT saat membuat perusahaan
 * (`POST /onboarding/perusahaan`), dan web mengikuti zona sesi lewat
 * `aturZonaPerusahaan` (`lib/format.ts`), yang dipasang `AuthContext` setiap
 * kali sesi berganti. Yang dijaga sekarang:
 *
 *   1. Web tak memaku zona tenant di mana pun selain bawaan `lib/format.ts`
 *      (sebelum ada sesi) — halaman superadmin boleh, karena yang mereka
 *      tampilkan zona SERVER (cadangan, log galat, surel), bukan zona tenant.
 *   2. `AuthContext` memang memasang zona dari sesi.
 *   3. Zona hanya DITULIS di satu tempat — `buatPerusahaanUntuk` — dan tak
 *      bisa diubah lewat `PATCH /company`: data yang sudah bertanggal tak
 *      ikut bergeser, jadi mengubah zona sesudahnya akan memecah satu hari
 *      penjualan jadi dua tanggal.
 *
 * Akibat bila salah satunya bocor — dan ini angka, bukan galat: selama satu
 * jam pertama tiap hari di WITA (dua jam di WIT), Stok Awal dikirim
 * bertanggal kemarin, Riwayat Transaksi membuka hari yang salah, dan jam di
 * struk meleset.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const WEB = AKAR + "apps/web/src/";
const baca = (p: string) => readFileSync(AKAR + p, "utf8");

/** Zona bawaan kolom & web sebelum ada sesi. */
const ZONA_BAWAAN = "Asia/Jakarta";

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

describe("zona waktu: server & web membaca zona perusahaan yang sama", () => {
  it("bawaan kolomnya SAMA dengan bawaan web", () => {
    expect(baca("apps/server/src/db/schema.ts")).toContain(
      `timezone: text("timezone").notNull().default("${ZONA_BAWAAN}")`,
    );
    expect(baca("apps/web/src/lib/format.ts")).toContain(`const ZONA_BAWAAN = "${ZONA_BAWAAN}";`);
  });

  it("web tak memaku zona tenant selain bawaan `lib/format.ts` (superadmin = zona server)", () => {
    const dipatok = semuaSumber(WEB, /\.tsx?$/)
      .filter((p) => readFileSync(p, "utf8").includes(ZONA_BAWAAN))
      .map((p) => p.slice(WEB.length))
      .sort();
    /*
     * MENYUSUT 2026-10-26: `DetailBahanPage` & `KartuStokPage` kini memakai
     * `zonaPerusahaan()`. Yang tersisa di luar `lib/format.ts` hanya halaman
     * superadmin — mereka menampilkan waktu SERVER (jadwal cadangan, log
     * galat, riwayat surel), yang memang WIB apa pun zona tenant mana pun.
     * Halaman tenant baru yang menulis `Asia/Jakarta` sendiri membuat uji ini
     * merah: pakai `zonaPerusahaan()` / pemformat `lib/format.ts`.
     */
    expect(dipatok, "daftar berkas web yang memaku zona waktu").toEqual([
      "lib/format.ts",
      "pages/superadmin/BackupPage.tsx",
      "pages/superadmin/ErrorLogPage.tsx",
      "pages/superadmin/RiwayatEmailPage.tsx",
      "pages/superadmin/SistemPage.tsx",
    ]);
    // Di `lib/format.ts` pun hanya sebagai BAWAAN — tak ada pemformat yang
    // menulis `timeZone: "Asia/Jakarta"` langsung.
    expect(baca("apps/web/src/lib/format.ts")).not.toContain(`timeZone: "${ZONA_BAWAAN}"`);
  });

  it("`hariIniWIB` & `waktuKertasWIB` membaca zona perusahaan", () => {
    const fmt = baca("apps/web/src/lib/format.ts");
    expect(fmt).toContain("export function hariIniWIB(timeZone = zonaPerusahaan()): string");
    expect(fmt).toContain("return waktuKertas(d, zonaPerusahaan());");
  });

  it("AuthContext memasang zona dari sesi", () => {
    const ctx = baca("apps/web/src/context/AuthContext.tsx");
    expect(ctx).toContain("aturZonaPerusahaan(auth?.company?.timezone)");
  });

  it("TAK ADA jalan mengubah zona waktu perusahaan lewat PATCH /company", () => {
    /*
     * Kata `timezone` boleh muncul TEPAT DI SATU TEMPAT di `company/routes.ts`
     * — perakit balasan `companyRow`. Di luar itu (zod `PatchBody`/`ModeBody`,
     * tiap `.set({…})`) ia terlarang: zona dipilih sekali, saat perusahaan
     * dibuat.
     */
    const rute = baca("apps/server/src/modules/company/routes.ts");
    const m = /export function companyRow\([\s\S]*?\n\}\n/.exec(rute);
    expect(m, "perakit balasan `companyRow` tak terbaca — potongannya meleset").not.toBeNull();
    const sisa = rute.replace(m![0], "");
    expect(sisa.length / rute.length, "potongan `companyRow` menelan berkasnya").toBeGreaterThan(
      0.5,
    );
    expect(m![0], "`companyRow` berhenti mengirim zona — itu perubahan kawat").toContain(
      "timezone: row.timezone",
    );
    expect(
      /timezone/.test(sisa),
      "`company/routes.ts` menyentuh timezone DI LUAR perakit balasan `companyRow` — " +
        "zona hanya boleh dipilih saat perusahaan dibuat (`buatPerusahaanUntuk`)",
    ).toBe(false);
  });

  it("zona hanya DITULIS saat perusahaan dibuat lewat halaman welcome", () => {
    const sumber = semuaSumber(AKAR + "apps/server/src/", /\.ts$/);
    const pembuat = sumber.filter((p) => /\.insert\(companies\)/.test(readFileSync(p, "utf8")));
    expect(pembuat.length, "tak satu pun jalur pembuatan perusahaan terbaca").toBeGreaterThanOrEqual(
      3,
    );
    const mengisi = pembuat.filter((p) => {
      const isi = readFileSync(p, "utf8");
      const m = /\.insert\(companies\)([\s\S]{0,400})/.exec(isi);
      return m != null && /timezone/.test(m[1]);
    });
    expect(
      mengisi.map((p) => p.slice(AKAR.length)),
      "perusahaan dibuat dengan zona waktu di luar halaman welcome",
    ).toEqual(["apps/server/src/modules/onboarding/service.ts"]);
    // …dan nilainya tersaring zod: hanya tiga zona Indonesia.
    const rute = baca("apps/server/src/modules/onboarding/routes.ts");
    expect(rute).toContain("timezone: z.enum(KODE_ZONA_WAKTU).default(ZONA_BAWAAN)");
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

  it("INTI: tiap perhitungan tanggal-saja menyebut zona bisnisnya (TZ=Asia/…)", () => {
    /*
     * Perusahaan uji memakai zona bawaan (WIB), jadi hampir semua baris
     * menulis `TZ=Asia/Jakarta`. §321 sengaja membuat perusahaan WITA dan
     * mengadu tanggalnya dengan `TZ=Asia/Makassar` — itu juga tanggal bisnis,
     * bukan tanggal kontainer. Yang terlarang tetap sama: `date +%F` TANPA
     * zona Indonesia, yang berarti UTC di CI.
     */
    const menyimpang = tanggalSaja
      .filter((b) => !/TZ=Asia\/(Jakarta|Makassar|Jayapura)/.test(b.isi))
      .map((b) => `verify-api.sh:${b.no}  ${b.isi.trim().slice(0, 90)}`);
    expect(
      menyimpang,
      "baris ini mengadu tanggal UTC/kontainer dengan tanggal bisnis server. " +
        `Awali dengan TZ=${ZONA_BAWAAN} — kalau tidak, gerbangnya merah tiap hari ` +
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
