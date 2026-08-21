import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HTTPException } from "hono/http-exception";
import { alasanGagalBaris } from "../src/lib/pg-galat";

/**
 * PESAN GAGAL PER BARIS TAK BOLEH MEMBAWA KUERI MENTAH.
 *
 * Jalur massal (impor CSV) tidak menggagalkan seluruh permintaan saat satu
 * baris bermasalah — ia melaporkan baris itu lalu meneruskan sisanya. Yang
 * terlewat: "melaporkan barisnya" sempat berarti `(e as Error).message` apa
 * adanya, dan pesan Drizzle memuat SELURUH kueri yang gagal + parameternya.
 *
 * TERUKUR lewat HTTP sungguhan, bukan dikhawatirkan. `POST /bahan/import`
 * dengan `harga_beli: 1e15` (kolomnya `numeric(14,2)`) memulangkan ke klien:
 *
 *   "Failed query: insert into \\"ingredients\\" (\\"id\\", \\"company_id\\", …30 kolom…)
 *    values (default, $1, $2, …)\\nparams: 3a363494-…, bocor uji 1, BU1, …"
 *
 * — bentuk dalam basis data DAN uuid perusahaan, kepada siapa pun yang cukup
 * punya hak mengimpor bahan. Pemiliknya cuma salah mengetik nol.
 *
 * Yang ganjil bukan cuma bocornya: komentar di `bahan/routes.ts` SUDAH menyebut
 * cacat ini dan menyatakannya diperbaiki — tapi perbaikannya hanya menutup
 * cabang 23505 (slug kembar). Tiga jalur galat lain di berkas yang sama tetap
 * membuang pesan mentah. Pola yang berulang di repo ini: aturannya ditulis,
 * penjaganya dipasang di satu pintu dan tidak di saudaranya.
 */
describe("alasanGagalBaris: menerjemahkan, tak pernah meneruskan", () => {
  /** Tiruan galat driver: pesannya memuat kuerinya, persis seperti Drizzle. */
  const galatDriver = (kode: string) =>
    Object.assign(
      new Error(
        'Failed query: insert into "ingredients" ("id", "company_id", "slug") values ($1, $2, $3)\nparams: 3a363494-3a9d-4033-a08a-fc67eabf1adb,bocor,BC',
      ),
      { code: kode },
    );

  it.each([
    ["22003", "Angkanya terlalu besar untuk disimpan"],
    ["22001", "Teksnya terlalu panjang"],
    ["23502", "Ada kolom wajib yang kosong"],
    ["23505", "Sudah ada baris lain dengan nama/kode yang sama"],
    ["22P02", "Format nilainya tidak sah"],
  ])("SQLSTATE %s → kalimat yang bisa ditindaklanjuti", (kode, harap) => {
    expect(alasanGagalBaris(galatDriver(kode), "gagal disimpan")).toBe(harap);
  });

  it("INTI: hasilnya tak pernah memuat kueri, parameter, atau nama kolom", () => {
    // Inilah asersi yang sebenarnya. Terjemahan boleh berubah kalimatnya;
    // yang tak boleh berubah: apa pun galatnya, yang keluar bukan isi kuerinya.
    for (const kode of ["22003", "22001", "23502", "23503", "23514", "23505", "22P02", "XX000", ""]) {
      const keluar = alasanGagalBaris(galatDriver(kode), "gagal disimpan");
      expect(keluar, `SQLSTATE ${kode} membocorkan kueri`).not.toMatch(/Failed query|insert into|params:/i);
      expect(keluar, `SQLSTATE ${kode} membocorkan uuid`).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(keluar, `SQLSTATE ${kode} membocorkan nama kolom`).not.toContain("company_id");
    }
  });

  it("galat yang belum dikenali jatuh ke kalimat bawaan, bukan ke pesan aslinya", () => {
    expect(alasanGagalBaris(galatDriver("XX000"), "gagal ditambah")).toBe("gagal ditambah");
    expect(alasanGagalBaris(new Error("apa pun ini"), "gagal diperbarui")).toBe("gagal diperbarui");
  });

  it("kode terbungkus `cause` ikut terbaca — Drizzle membungkus galat driver", () => {
    const terbungkus = Object.assign(new Error("Failed query: …"), {
      cause: { code: "22003" },
    });
    expect(alasanGagalBaris(terbungkus, "gagal")).toBe("Angkanya terlalu besar untuk disimpan");
  });

  it("PASANGAN: `HTTPException` kita sendiri DITERUSKAN — itu memang kalimat untuk dibaca", () => {
    // Tanpa ini, "jangan pernah teruskan pesan galat" akan menelan pesan yang
    // justru paling berguna: yang kita tulis sendiri untuk dibaca orang.
    const punyaKita = new HTTPException(400, { message: "Kategori tidak dikenal" });
    expect(alasanGagalBaris(punyaKita, "gagal")).toBe("Kategori tidak dikenal");
  });
});

describe("tak ada lagi pesan galat mentah yang dikirim ke klien", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url)).replace(/\/$/, "");
  function semuaTs(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = `${dir}/${n}`;
      return statSync(p).isDirectory() ? semuaTs(p) : n.endsWith(".ts") ? [p] : [];
    });
  }

  /**
   * Modul yang BOLEH menyebut pesan aslinya, beserta alasannya. Bukan daftar
   * pengecualian yang dibiarkan menumpuk: tiap baris harus punya sebab, dan
   * sebabnya sama untuk keduanya — pembacanya super admin yang sedang
   * mendiagnosis mesinnya sendiri, dan pesan asli itulah isi diagnosisnya.
   */
  const BOLEH = [
    "modules/admin-system/routes.ts", // migrasi/cadangan/SMTP — panel super admin
    "lib/", // penulisan log & peringatan, bukan badan respons
    "modules/print/routes.ts", // galat pencetak diteruskan ke layar kasir apa adanya
    "modules/sync/routes.ts", // pesan SyncGagal yang memang kita susun sendiri
  ];

  it("tak ada `(e as Error).message` yang mendarat di badan respons", () => {
    const pelanggar: string[] = [];
    for (const p of semuaTs(SRC)) {
      const rel = p.slice(SRC.length + 1);
      if (BOLEH.some((b) => rel.startsWith(b))) continue;
      const isi = readFileSync(p, "utf8");
      isi.split("\n").forEach((baris, i) => {
        if (/^\s*\*/.test(baris)) return; // komentar
        if (/\((?:e|e2|err)\s+as\s+Error\)\??\.message/.test(baris)) {
          pelanggar.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(
      pelanggar,
      "pesan mentah driver memuat seluruh kueri + parameternya — pakai `alasanGagalBaris`",
    ).toEqual([]);
  });

  it("PASANGAN: sapuannya bisa MENUDUH, dan tak menuduh yang sudah benar", () => {
    const kotor = '        gagal.push({ nama: b.nama, alasan: (e as Error)?.message ?? "gagal" });';
    const bersih = '        gagal.push({ nama: b.nama, alasan: alasanGagalBaris(e, "gagal") });';
    const komentar = "     * `(e as Error).message` mentah dari driver, yaitu seluruh teks";
    const pola = /\((?:e|e2|err)\s+as\s+Error\)\??\.message/;
    expect(pola.test(kotor)).toBe(true);
    expect(pola.test(bersih)).toBe(false);
    // baris komentar dilewati oleh saringan `^\s*\*` di atas
    expect(/^\s*\*/.test(komentar)).toBe(true);
  });
});
