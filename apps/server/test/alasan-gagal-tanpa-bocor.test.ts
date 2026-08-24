import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HTTPException } from "hono/http-exception";
import { alasanGagalBaris } from "../src/lib/pg-galat";
import { butaKomentar } from "../src/scripts/buta-komentar";

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
    "lib/error-log.ts", // menulis ke error_logs, bukan ke badan respons
    "lib/backup.ts", // status cadangan; pembacanya HANYA super admin (lihat di bawah)
    "lib/backup-peringatan.ts", // isi peringatan ke super admin
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

  /**
   * SAPUAN KEDUA: bentuk galat mentah yang pola di atas TAK LIHAT.
   *
   * Pola pertama menuntut tulisan harfiah `(e as Error).message`. Kelasnya
   * lebih luas dari satu bentuk itu, dan bentuk yang paling sering dipakai di
   * repo ini justru bukan yang itu:
   *
   *     const pesan = e instanceof Error ? e.message : String(e);   // lib/backup.ts
   *     String(e)          `${e}`          err.message
   *
   * Sapuan ini menilai BADAN `catch` yang mengikat galatnya: bila nilai
   * mentahnya dipakai (`.message`, `String(x)`, atau interpolasi) DAN badan
   * yang sama menyusun sesuatu yang dikirim (`c.json`, `return {`, `push({`,
   * `.set({`), situsnya dilaporkan.
   *
   * Ia membaca kode TANPA KOMENTAR, dan itu bukan kehati-hatian berlebih:
   * versi pertama sapuan ini menuduh `modules/bahan/routes.ts:976` — sebuah
   * KOMENTAR yang menjelaskan cacat ini dan mengutip bentuk yang salah.
   * Penjaga yang menuduh prosanya sendiri sudah terjadi di repo ini
   * (`sql-number-bukan-janji`), dan ia mengajari orang mengabaikan merahnya.
   *
   * DAN INILAH ALASAN `BOLEH` DIPERSEMPIT DI ATAS. Sebelumnya seluruh `lib/`
   * dikecualikan dengan alasan "penulisan log & peringatan, bukan badan
   * respons". Alasan itu TIDAK BENAR untuk seluruh `lib/`: `lib/backup.ts:157`
   * memulangkan `error: pesan` di dalam objek yang dikirim. Ia tetap sah —
   * seluruh rute cadangan ada di balik `/admin/*` + `requireSuperAdmin`, dan
   * pesan asli itulah isi diagnosis operatornya — tapi sekarang ia
   * dikecualikan DENGAN NAMA, bukan lewat awalan direktori yang kebetulan
   * memuatnya.
   *
   * TERUKUR pada putaran ini: 48 medan bernama-galat, 45 blok `catch` (28
   * mengikat galatnya), dan **satu** situs tempat galat mentah sampai ke nilai
   * yang dikirim — yaitu `lib/backup.ts` itu.
   */
  function seimbangKurawal(s: string, i: number): string {
    let d = 0;
    for (let j = i; j < s.length; j += 1) {
      if (s[j] === "{") d += 1;
      else if (s[j] === "}") {
        d -= 1;
        if (d === 0) return s.slice(i, j + 1);
      }
    }
    return s.slice(i, i + 4000);
  }

  const situsMentah = (kode?: { nama: string; isi: string }[]): string[] => {
    const berkas =
      kode ?? semuaTs(SRC).map((p) => ({ nama: p.slice(SRC.length + 1), isi: readFileSync(p, "utf8") }));
    const keluar: string[] = [];
    for (const { nama, isi: mentah } of berkas) {
      if (BOLEH.some((b) => nama.startsWith(b))) continue;
      const s = butaKomentar(mentah);
      for (const m of s.matchAll(/\bcatch\s*\(\s*(\w+)[^)]*\)\s*\{/g)) {
        const v = m[1];
        const badan = seimbangKurawal(s, s.indexOf("{", m.index! + m[0].length - 1));
        const dikirim = /c\.json\(|return\s*\{|push\(\s*\{|\.set\(\s*\{/.test(badan);
        const mentahDipakai = new RegExp(
          `${v}\\s*\\.\\s*message|String\\(\\s*${v}\\s*\\)|\\$\\{\\s*${v}\\b`,
        ).test(badan);
        if (dikirim && mentahDipakai) keluar.push(`${nama}:${s.slice(0, m.index!).split("\n").length}`);
      }
    }
    return keluar;
  };

  it("SAPUAN KEDUA: galat mentah tak sampai ke nilai yang dikirim", () => {
    expect(
      situsMentah(),
      "galat mentah driver/sistem sampai ke sesuatu yang dikirim — pakai `alasanGagalBaris`, " +
        "atau kecualikan berkasnya DENGAN NAMA dan alasannya",
    ).toEqual([]);
  });

  it("PASANGAN: sapuan kedua bisa MENUDUH bentuk yang pola pertama lewatkan", () => {
    const pola1 = /\((?:e|e2|err)\s+as\s+Error\)\??\.message/;
    const kasus = [
      'try { a(); } catch (e) { const pesan = e instanceof Error ? e.message : String(e); return { error: pesan }; }',
      'try { a(); } catch (err) { return { error: String(err) }; }',
      'try { a(); } catch (e) { gagal.push({ alasan: `gagal: ${e}` }); }',
    ];
    for (const isi of kasus) {
      // pola LAMA buta terhadap ketiganya…
      expect(pola1.test(isi), `pola lama seharusnya buta: ${isi.slice(0, 40)}`).toBe(false);
      // …sapuan kedua menuduhnya.
      expect(situsMentah([{ nama: "uji.ts", isi }]), isi.slice(0, 40)).toHaveLength(1);
    }
    // Dan ia TIDAK menuduh yang sudah benar, maupun prosa yang mengutip bentuk salah.
    expect(
      situsMentah([
        { nama: "uji.ts", isi: 'try { a(); } catch (e) { gagal.push({ alasan: alasanGagalBaris(e, "gagal") }); }' },
      ]),
    ).toHaveLength(0);
    expect(
      situsMentah([{ nama: "uji.ts", isi: '/* contoh buruk: catch (e) { return { error: String(e) }; } */' }]),
      "komentar tak boleh tertuduh",
    ).toHaveLength(0);
    // …dan galat yang ditangkap tanpa dikirim ke mana pun juga bukan urusannya.
    expect(
      situsMentah([{ nama: "uji.ts", isi: 'try { a(); } catch (e) { console.error(String(e)); }' }]),
    ).toHaveLength(0);
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
