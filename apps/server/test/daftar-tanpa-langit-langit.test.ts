import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
// Pemindai SQL mentah PINDAH ke rumah bersama saat vena bendera-hapus
// (2026-08-26) membutuhkan pemindai yang sama persis; menyalinnya akan
// melahirkan pengurai template kedua.
import {
  SRC,
  badanPembantu,
  berkasTs,
  ekorPernyataan,
  tanpaSubkueri,
  templateSql,
} from "./util/sql-mentah";

/**
 * BACAAN DAFTAR TANPA LANGIT-LANGIT ATAS TABEL YANG TUMBUH — RATCHET.
 *
 * Tabel seperti `sales`, `productions`, `supply_mutations` dan `customers`
 * tumbuh seumur warung buka. Satu `.select()` tanpa `.limit()` atasnya menarik
 * seluruhnya ke satu balasan — memori server, waktu serialisasi, dan satu dari
 * **sepuluh** koneksi kolam ditahan selama itu. Tak ada galat yang muncul; ia
 * cuma memburuk sedikit demi sedikit sampai halamannya berhenti bisa dibuka.
 *
 * Terukur pada `apps/server/src/modules/customer/routes.ts`, Postgres nyata:
 *
 *     GET /customer        10.002 member        1,61 MB
 *     GET /customer/:id    20.001 transaksi     2,97 MB
 *
 * KENAPA RATCHET DAN BUKAN NOL. Dari 63 situs yang tersisa, kebanyakan terikat
 * sesuatu yang tak ikut tumbuh — baris satu faktur, mutasi satu sesi opname,
 * transaksi satu hari, varian satu nomor WA. Menuntut `.limit()` pada semuanya
 * berarti menambahkan batas yang tak menjaga apa pun di lima puluh tempat, dan
 * uji yang menuntut pekerjaan tanpa alasan akan dilonggarkan orang, bukan
 * dipatuhi.
 *
 * Yang dijaga: JUMLAHNYA TAK BOLEH TUMBUH.
 *
 * BATAS SAPUAN INI — ditulis supaya "hijau" tak terbaca lebih luas dari yang
 * benar:
 *
 *   · Hanya bentuk drizzle `.select(...).from(tabel)`. SQL mentah lewat
 *     `db.execute(sql\`…\`)` tak terlihat sama sekali.
 *   · Daftar tabelnya DITULIS TANGAN. Tabel baru yang tumbuh tak ikut terjaga
 *     sampai namanya ditambahkan — dan itu persis yang terjadi pada
 *     `customers`: sapuan versi pertama tak memuatnya, jadi `GET /customer`
 *     yang 1,61 MB itu tak pernah tertuduh. Ia ditemukan dengan tangan.
 *   · "Agregat" dikenali dari kata COUNT/SUM/AVG. Versi pertama sapuan ini
 *     hanya melihat rantai SESUDAH `.from()` — padahal daftar SELECT ada
 *     SEBELUMNYA, jadi hampir semua agregat luput dan hitungannya 78, bukan 63.
 */

/**
 * Tabel yang barisnya bertambah seumur pemakaian — bukan data master yang
 * jumlahnya kira-kira tetap (menu, cabang, bahan, pengguna).
 */
const TUMBUH = new Set([
  "sales",
  "saleItems",
  "saleConsumptions",
  "saleRefunds",
  "productions",
  "supplyMutations",
  "stockOpnames",
  "errorLogs",
  "fakturLogs",
  "pesananLogs",
  "attendances",
  "openBills",
  "openBillItems",
  "cleaningReports",
  "cleaningReportItems",
  "leaveRequests",
  "syncCommands",
  "mejaKosongLogs",
  "menuPriceLogs",
  "backupRuns",
  "customers",
]);

/**
 * `.groupBy(` WAJIB ikut diperiksa, bukan cuma ada-tidaknya COUNT/SUM.
 *
 * Agregat SKALAR (tanpa GROUP BY) selalu membalas satu baris — itu memang
 * aman berapa pun tabelnya. Tapi agregat ber-GROUP BY membalas satu baris PER
 * KELOMPOK, dan kelompoknya ikut tumbuh: `GET /customer` menghitung
 * COUNT/SUM per member, lalu mengirim satu baris untuk tiap member yang
 * pernah ada. Mengecualikannya sebagai "agregat" adalah persis cara balasan
 * 1,61 MB itu lolos dari pandangan.
 */
const AGREGAT = /\b(count|sum|avg)\s*\(/i;

/**
 * Jumlah situs saat ratchet ini dipasang, sesudah kedua pintu `/customer`
 * dibatasi. Turun boleh (dan bagus). Naik berarti ada bacaan daftar baru tanpa
 * langit-langit atas tabel yang tumbuh — beri `.limit()`, atau naikkan DASAR
 * dengan alasan di pesan commit.
 */
const DASAR = 63;

export function situs(kode?: { nama: string; isi: string }[]): string[] {
  const berkas =
    kode ?? berkasTs(SRC).map((p) => ({ nama: p.slice(SRC.length + 1), isi: readFileSync(p, "utf8") }));
  const keluar: string[] = [];
  for (const { nama, isi: s } of berkas) {
    for (const m of s.matchAll(/\.from\(\s*(\w+)\s*\)/g)) {
      if (!TUMBUH.has(m[1])) continue;
      // Daftar SELECT-nya ada SEBELUM `.from()` — tanpa kepala ini, COUNT/SUM
      // di sana tak terlihat dan agregat skalar tertuduh keliru.
      const k = s.lastIndexOf(".select(", m.index!);
      const kepala = k >= 0 && m.index! - k < 4000 ? s.slice(k, m.index!) : "";
      const ekor = ekorPernyataan(s, m.index! + m[0].length);
      if (ekor.includes(".limit(")) continue;
      if (AGREGAT.test(kepala + ekor) && !ekor.includes(".groupBy(")) continue;
      if (/\beq\(\s*\w+\.id\s*,/.test(ekor)) continue; // satu baris by-id
      keluar.push(`${nama}:${s.slice(0, m.index!).split("\n").length}`);
    }
  }
  return keluar;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ARAH KEDUA: SQL MENTAH — populasi yang sapuan di atas tak pernah lihat.
 *
 * Komentar berkas ini sudah menuliskan kebutaannya sendiri sejak hari pertama:
 * "Hanya bentuk drizzle `.select(...).from(tabel)`. SQL mentah lewat
 * `db.execute(sql`…`)` tak terlihat sama sekali." Itu bukan kebutaan teoretis —
 * `GET /sampah` membaca SELURUH `sales` dan SELURUH `productions` yang
 * ter-soft-delete lewat dua `db.execute` tanpa `LIMIT`, atas dua tabel yang
 * SUDAH ada di daftar `TUMBUH` di atas. Aturan yang sama, tabel yang sama,
 * bentuk handler yang sama — satu dijaga dan satu tidak, semata karena cara
 * menulisnya berbeda.
 *
 * YANG DINILAI: template `sql` yang menjadi argumen LANGSUNG `.execute(`, yaitu
 * kueri yang benar-benar dijalankan. Potongan predikat dan subkueri yang
 * dirakit di tempat lain dinilai di situs `.execute` yang memakainya, bukan
 * sendiri-sendiri — tanpa batas itu, `const fakturTerhapus = sql`(SELECT …)``
 * di `sampah/routes.ts` tertuduh padahal ia bagian sebuah DELETE.
 *
 * BATASNYA, ditulis supaya "hijau" tak terbaca lebih luas dari yang benar:
 *
 *   · `${pembantu(...)}` ditelusuri SATU TINGKAT saja, ke template `sql`
 *     pertama di dalam definisi berkas yang sama. Tanpa itu
 *     `GET /penerimaan/anomali` — yang `FROM`-nya `g`, sebuah CTE di dalam
 *     `cteMenggantung()` — luput dari sapuan yang justru dibuat untuknya.
 *   · `LIMIT` dinilai pada kueri LUAR: `cteMenggantung` memuat dua subkueri
 *     berkorelasi ber-`LIMIT 1`, dan menilai teks mentah membuat kueri
 *     terbesarnya dimaafkan oleh langit-langit milik subkuerinya.
 *   · nama tabelnya diturunkan MEKANIS dari `TUMBUH` (camelCase → snake_case),
 *     bukan didaftar tangan kedua kalinya. Daftar tangan yang tak memuat
 *     `customers` adalah persis sebab balasan 1,61 MB itu tak pernah tertuduh.
 */

/** `sales` ← `sales`, `open_bill_items` ← `openBillItems`. Diturunkan, bukan diketik. */
const TUMBUH_SQL = [...TUMBUH].map((camel) => ({
  camel,
  snake: camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
}));

export function situsSql(kode?: { nama: string; isi: string }[]): string[] {
  const berkas =
    kode ??
    berkasTs(SRC).map((p) => ({ nama: p.slice(SRC.length + 1), isi: readFileSync(p, "utf8") }));
  const keluar: string[] = [];
  for (const { nama, isi: mentah } of berkas) {
    // Prosa yang MENJELASKAN aturan ini memuat contoh kueri; membaca kode
    // bersama komentarnya membuat penjaga menuduh tulisannya sendiri — sudah
    // terjadi pada `sql-number-bukan-janji`. `butaKomentar` mempertahankan
    // posisi, jadi nomor barisnya tetap benar.
    const s = butaKomentar(mentah);
    for (const { pos, isi: luar } of templateSql(s)) {
      // Hanya kueri yang BENAR-BENAR dijalankan.
      if (!/\.execute\(\s*$/.test(s.slice(Math.max(0, pos - 40), pos))) continue;
      const rata = tanpaSubkueri(luar);
      // Hanya BACAAN. UPDATE/DELETE/INSERT ber-subkueri bukan balasan daftar.
      if (!/^\s*(?:\$\{[^}]*\}\s*)*(SELECT|WITH)\b/i.test(rata)) continue;
      if (!/\bFROM\b/i.test(rata)) continue; // `SELECT (…), (…)` = satu baris
      if (/\bLIMIT\b/i.test(rata)) continue; // sudah berlangit-langit
      if (/pg_advisory/i.test(luar)) continue; // kunci, bukan daftar
      if (/\bid\s+IN\s*\(\s*\$\{/i.test(luar)) continue; // terikat daftar id pemanggil
      // `SELECT 1 … FOR UPDATE` mengunci baris; ia tak pernah mengirim data.
      // Sengaja SEMPIT: `SELECT 1 FROM sales WHERE company_id = …` tanpa
      // penguncian tetap bacaan tak berbatas, dan tetap tertuduh.
      if (/SELECT\s+1\s+FROM/i.test(rata) && /\bFOR\s+(UPDATE|SHARE)\b/i.test(rata)) continue;
      let penuh = luar;
      for (const m of luar.matchAll(/\$\{\s*(\w+)\s*\(/g)) penuh += `\n${badanPembantu(s, m[1])}`;
      const kena = TUMBUH_SQL.some(
        ({ camel, snake }) =>
          new RegExp(`\\b${snake}\\b`).test(penuh) || penuh.includes(`\${${camel}}`),
      );
      if (!kena) continue;
      // Agregat SKALAR aman; agregat ber-GROUP BY tumbuh seiring kelompoknya.
      //
      // Diuji pada DAFTAR SELECT tingkat teratas, dan itu bukan kehalusan:
      // `COALESCE(SUM(qty) FILTER (…), 0)` menaruh `SUM(` di kedalaman 1, jadi
      // versi yang menilai teks yang sudah dikosongkan tak melihat agregat sama
      // sekali dan menuduh `stok/service.ts:431` — kueri yang selalu memulangkan
      // TEPAT SATU baris. `tanpaSubkueri` mempertahankan panjang, jadi posisinya
      // sepadan dan potongannya boleh diambil dari teks aslinya.
      const iSel = rata.search(/\bSELECT\b/i);
      const iFrom = rata.search(/\bFROM\b/i);
      const kepala = iSel >= 0 && iFrom > iSel ? luar.slice(iSel, iFrom) : "";
      if (/\b(count|sum|avg)\s*\(/i.test(kepala) && !/\bGROUP\s+BY\b/i.test(rata)) continue;
      keluar.push(`${nama}:${s.slice(0, pos).split("\n").length}`);
    }
  }
  return keluar;
}

describe("bacaan daftar tanpa langit-langit tak boleh bertambah", () => {
  const daftar = situs();

  it("premis: pemindainya benar-benar menemukan `.from(tabel)` di src", () => {
    // Tanpa ini, regex yang tak lagi cocok atau jalur yang salah membuat
    // ratchetnya hijau dengan hitungan nol — izin terbuka, bukan penjagaan.
    expect(daftar.length).toBeGreaterThan(30);
  });

  it("INTI: jumlahnya tidak melebihi DASAR", () => {
    expect(
      daftar.length,
      `ada bacaan daftar BARU tanpa langit-langit atas tabel yang tumbuh. ` +
        `Satu balasan bisa membesar tanpa batas seumur warung buka — terukur ` +
        `1,61 MB dan 2,97 MB pada dua pintu /customer sebelum dibatasi. Beri ` +
        `\`.limit(BATAS + 1)\` lalu tandai pemotongannya di DTO, atau naikkan ` +
        `DASAR dengan alasan di pesan commit.\n\nsitus:\n${daftar.join("\n")}`,
    ).toBeLessThanOrEqual(DASAR);
  });

  it("kedua pintu /customer tetap berbatas DAN agregatnya tetap di SQL", () => {
    const s = readFileSync(join(SRC, "modules/customer/routes.ts"), "utf8");
    expect(s, "GET /customer kehilangan batasnya").toContain("BATAS_MEMBER + 1");
    expect(s, "GET /customer/:id kehilangan batasnya").toContain("BATAS_TRANSAKSI_MEMBER + 1");
    // Inilah yang membuat pemotongan aman. Kalau agregatnya kembali dihitung
    // di JavaScript dari larik yang sudah dipotong, "Total belanja" seorang
    // member akan turun diam-diam begitu transaksinya melewati baris ke-300.
    expect(
      s,
      "agregat member harus dihitung SQL tanpa batas, bukan dari larik yang dipotong",
    ).toContain("COALESCE(SUM(");
    expect(s, "jangan jumlahkan total dari larik transaksi di JS").not.toContain(
      "transaksi.reduce(",
    );
    // Memotong daftar tanpa pencarian di server membuat member ke-301 tak bisa
    // ditemukan sama sekali — halaman Member menyaring di browser.
    expect(s.split('.get("/", async (c) => {')[2] ?? "", "GET /customer harus menerima ?q=").toContain(
      'c.req.query("q")',
    );
  });

  it("kartu Riwayat Harga: daftar berbatas, statistiknya dari SELURUH lot", () => {
    // `harga_median` di kartu ini JADI harga acuan RAB belanja (disinkron tiap
    // Laporan Harga), dan harga acuan itu dasar HPP setiap menu yang memakai
    // bahannya. Menghitungnya dari 300 lot terbaru menggeser HPP seluruh menu
    // tanpa satu pun galat muncul.
    for (const f of ["modules/bahan/routes.ts", "modules/perlengkapan/routes.ts"] as const) {
      const isi = readFileSync(join(SRC, f), "utf8");
      expect(isi, `${f}: daftar lot kehilangan batasnya`).toContain("BATAS_LOT_RIWAYAT + 1");
      expect(isi, `${f}: statistik tak boleh dihitung dari larik yang dipotong`).not.toMatch(
        /statistikHargaLots\(\s*lots\s*\)/,
      );
      expect(
        isi,
        `${f}: jumlah_pembelian harus hitungan populasi, bukan panjang larik yang dikirim`,
      ).not.toContain("jumlah_pembelian: lots.length");
    }

    // Rumus harga per satuan pernah hidup dalam EMPAT salinan, dan
    // pembulatannya bagian dari jawabannya: dua salinan yang membulatkan
    // berbeda menghasilkan harga acuan yang berbeda untuk data yang sama.
    //
    // Yang dijaga "tepat SATU salinan", bukan "nol" — salinan yang satu itu
    // badan `hargaPerSatuanLot` sendiri. Versi pertama uji ini menuntut nol dan
    // langsung menuduh definisi yang benar; penjaga yang salah tuduh mengajari
    // orang mengabaikan warna merahnya.
    const RUMUS = /Math\.round\(\s*\(\s*[\w.]+\s*\/\s*[\w.]+\s*\)\s*\*\s*100\s*\)\s*\/\s*100/g;
    const salinan: string[] = [];
    for (const p of berkasTs(SRC)) {
      const isi = readFileSync(p, "utf8");
      for (const _ of isi.matchAll(RUMUS)) salinan.push(p.slice(SRC.length + 1));
    }
    expect(
      salinan,
      "rumus harga per satuan disalin lagi alih-alih memakai hargaPerSatuanLot",
    ).toEqual(["lib/harga-stats.ts"]);
    const stats = readFileSync(join(SRC, "lib/harga-stats.ts"), "utf8");
    expect(stats).toContain("export function hargaPerSatuanLot");
    // …dan salinan yang satu itu memang badan helper-nya, bukan tempat lain.
    expect(
      stats.slice(stats.indexOf("export function hargaPerSatuanLot")),
      "salinan satu-satunya harus berada DI DALAM hargaPerSatuanLot",
    ).toMatch(RUMUS);
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh yang sudah berbatas", () => {
    const buat = (isi: string) => situs([{ nama: "uji.ts", isi }]);
    const telanjang = `const r = await db.select({ id: sales.id }).from(sales).where(f).orderBy(x);`;
    expect(buat(telanjang), "daftar telanjang harus tertuduh").toHaveLength(1);
    expect(
      buat(telanjang.replace(".orderBy(x)", ".orderBy(x).limit(300)")),
      "yang sudah ber-.limit() tak boleh tertuduh",
    ).toHaveLength(0);
    // Agregat SKALAR aman — satu baris, berapa pun tabelnya.
    expect(
      buat("await db.select({ n: sql`COUNT(*)::int` }).from(sales).where(f);"),
      "agregat skalar tak boleh tertuduh",
    ).toHaveLength(0);
    // …tapi agregat ber-GROUP BY membalas satu baris PER KELOMPOK.
    expect(
      buat("await db.select({ n: sql`COUNT(*)::int` }).from(sales).where(f).groupBy(sales.id);"),
      "agregat ber-groupBy tumbuh seiring jumlah kelompok — harus tertuduh",
    ).toHaveLength(1);
    // DUA KUERI DI DALAM `Promise.all([a, b])`: `.limit()` milik yang kedua
    // tak boleh memaafkan yang pertama.
    expect(
      buat(
        "const [a, b] = await Promise.all([\n" +
          "  db.select({ x: sales.id }).from(sales).where(f).orderBy(u),\n" +
          "  db.select({ y: sales.id }).from(sales).where(f).orderBy(u).limit(300),\n" +
          "]);",
      ),
      "kueri tanpa batas di dalam Promise.all harus tetap tertuduh walau tetangganya berbatas",
    ).toHaveLength(1);
    // Tabel master tak ikut dijaga: jumlahnya kira-kira tetap.
    expect(
      buat("await db.select({ id: menus.id }).from(menus).where(f);"),
      "tabel di luar daftar TUMBUH tak boleh tertuduh",
    ).toHaveLength(0);
  });
});

describe("SQL mentah: bacaan daftar tanpa langit-langit", () => {
  const daftar = situsSql();

  it("premis: pemindainya benar-benar menemukan kueri `.execute(sql`…`)`", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat ratchetnya hijau dengan
    // hitungan nol — izin terbuka, bukan penjagaan. Ada 42 situs
    // `.execute(sql`…`)` di src saat gerbang ini dipasang.
    expect(daftar.length).toBeGreaterThan(5);
  });

  /**
   * Jumlah situs saat gerbang ini dipasang, SESUDAH `/sampah` dan
   * `/penerimaan/anomali` dibatasi. Kesembilannya sudah dipilah dengan tangan
   * dan tak satu pun tumbuh seumur pemakaian:
   *
   *   · `dokumen/nomor.ts:104,116,140` — backfill boot sekali-jalan &
   *     idempoten; hasilnya tak pernah menjadi balasan HTTP.
   *   · `meja/okupansi.ts:81` — satu baris per MEJA.
   *   · `stok/routes.ts:590` — `DISTINCT ON (ingredient_id)`, satu baris per
   *     bahan.
   *   · `stok/service.ts:48` — satu baris per bahan.
   *   · `stok/service.ts:547` — satu baris per CABANG.
   *   · `stok/service.ts:830,857` — `GROUP BY ingredient_id`, satu baris per
   *     bahan.
   *
   * Katalog bahan/meja/cabang adalah data master: jumlahnya kira-kira tetap,
   * tak bertambah tiap transaksi. Naik berarti ada kueri mentah BARU tanpa
   * langit-langit — beri `LIMIT`, atau naikkan DASAR dengan alasan di pesan
   * commit.
   */
  const DASAR_SQL = 9;

  it("INTI: jumlahnya tidak melebihi DASAR_SQL", () => {
    expect(
      daftar.length,
      `ada kueri SQL MENTAH baru yang memulangkan daftar tanpa langit-langit ` +
        `atas tabel yang tumbuh. Terukur pada dua pintu yang membuat gerbang ` +
        `ini ada: GET /sampah 2.438.895 byte dan GET /penerimaan/anomali ` +
        `2.760.043 byte / 4,17 detik, keduanya pada 10.000 baris.\n\n` +
        `situs:\n${daftar.join("\n")}`,
    ).toBeLessThanOrEqual(DASAR_SQL);
  });

  it("PASANGAN: pemindai SQL mentah bisa MENUDUH, dan tak menuduh yang sah", () => {
    const buat = (isi: string) => situsSql([{ nama: "uji.ts", isi }]);
    const telanjang = "await db.execute(sql`SELECT id FROM sales WHERE company_id = ${c}`);";
    expect(buat(telanjang), "daftar mentah telanjang harus tertuduh").toHaveLength(1);
    expect(
      buat(telanjang.replace("${c}`)", "${c} LIMIT 300`)")),
      "yang sudah ber-LIMIT tak boleh tertuduh",
    ).toHaveLength(0);
    // Bukan kueri yang dijalankan — potongan yang dirakit di tempat lain.
    expect(
      buat("const p = sql`SELECT id FROM sales WHERE company_id = ${c}`;"),
      "potongan di luar .execute() dinilai di situs pemakainya, bukan sendiri",
    ).toHaveLength(0);
    // Penjaga baris & kunci, bukan daftar.
    expect(
      buat("await db.execute(sql`SELECT 1 FROM sales WHERE id = ${id} FOR UPDATE`);"),
      "SELECT 1 / kunci baris tak boleh tertuduh",
    ).toHaveLength(0);
    expect(
      buat("await db.execute(sql`SELECT pg_advisory_xact_lock(${k}) FROM sales`);"),
      "advisory lock tak boleh tertuduh",
    ).toHaveLength(0);
    // Agregat SKALAR aman walau dibungkus COALESCE — kedalamannya ≥ 1, dan
    // versi pertama pemindai ini justru buta karenanya lalu menuduh kueri
    // yang selalu memulangkan satu baris.
    expect(
      buat("await db.execute(sql`SELECT COALESCE(SUM(qty) FILTER (WHERE tipe='beli'), 0) AS n FROM productions WHERE company_id = ${c}`);"),
      "agregat skalar berbungkus COALESCE tak boleh tertuduh",
    ).toHaveLength(0);
    // …tapi agregat ber-GROUP BY membalas satu baris PER KELOMPOK.
    expect(
      buat("await db.execute(sql`SELECT SUM(qty) AS n FROM productions WHERE company_id = ${c} GROUP BY faktur_id`);"),
      "agregat ber-GROUP BY harus tertuduh",
    ).toHaveLength(1);
    // `SELECT (subkueri), (subkueri)` = SATU baris, berapa pun tabelnya.
    expect(
      buat("await db.execute(sql`SELECT (SELECT COUNT(*) FROM sales WHERE company_id = ${c}) AS n`);"),
      "SELECT tanpa FROM tingkat atas selalu satu baris — tak boleh tertuduh",
    ).toHaveLength(0);
    // Terikat daftar id kiriman klien (yang dibatasi Zod `.max()`).
    expect(
      buat("await db.execute(sql`SELECT id FROM sales WHERE id IN (${ids})`);"),
      "terikat daftar id pemanggil tak boleh tertuduh",
    ).toHaveLength(0);
    // Penulisan bukan balasan daftar.
    expect(
      buat("await db.execute(sql`DELETE FROM sales WHERE id IN (SELECT id FROM sales ORDER BY waktu DESC OFFSET 100)`);"),
      "DELETE/UPDATE ber-subkueri bukan balasan daftar",
    ).toHaveLength(0);
    // Tabel master tak ikut dijaga.
    expect(
      buat("await db.execute(sql`SELECT id FROM menus WHERE company_id = ${c}`);"),
      "tabel di luar daftar TUMBUH tak boleh tertuduh",
    ).toHaveLength(0);
    // INI YANG PALING PENTING: tabelnya tersembunyi di dalam CTE milik
    // pembantu. Tanpa penelusuran satu tingkat, `GET /penerimaan/anomali` —
    // kandidat terbesar sapuan ini — luput dari sapuan yang dibuat untuknya.
    expect(
      buat(
        "function cte(c) {\n" +
          "  return sql`WITH g AS (SELECT pr.id, pr.qty FROM productions pr WHERE pr.company_id = ${c})`;\n" +
          "}\n" +
          "await db.execute(sql`${cte(x)} SELECT g.id FROM g ORDER BY g.waktu ASC`);",
      ),
      "tabel yang hanya disebut di CTE pembantu harus tetap terlihat",
    ).toHaveLength(1);
    // …dan `LIMIT` milik subkueri berkorelasi di dalam pembantu itu TIDAK
    // boleh memaafkan kueri luarnya. `cteMenggantung` memuat dua `LIMIT 1`.
    expect(
      buat(
        "function cte(c) {\n" +
          "  return sql`WITH g AS (SELECT (SELECT x FROM sales LIMIT 1) AS a FROM productions WHERE company_id = ${c})`;\n" +
          "}\n" +
          "await db.execute(sql`${cte(x)} SELECT g.a FROM g`);",
      ),
      "LIMIT milik subkueri pembantu tak boleh memaafkan kueri luar",
    ).toHaveLength(1);
  });

  it("GET /sampah: berlangit-langit, urut, dan bentuknya TETAP larik", () => {
    const s = readFileSync(join(SRC, "modules/sampah/routes.ts"), "utf8");
    expect(s, "GET /sampah kehilangan batasnya").toContain("BATAS_SAMPAH + 1");
    // Memotong tanpa ORDER BY di SQL membuat "300 terbaru" jadi 300 sembarang.
    expect(s, "penjualan harus terurut di SQL sebelum dipotong").toContain(
      "ORDER BY s.deleted_at DESC",
    );
    expect(s, "stok masuk harus terurut di SQL sebelum dipotong").toContain(
      "ORDER BY MAX(pr.deleted_at) DESC",
    );
    // Ketujuh build ponsel yang pernah rilis membaca balasan ini `as List`.
    // `c.json({ items, terpotong })` akan MELEMPAR di aplikasi terpasang.
    expect(s, "balasan /sampah harus tetap larik telanjang").toMatch(
      /return c\.json\(terpotong \? rows\.slice\(0, BATAS_SAMPAH\) : rows\)/,
    );
    expect(s, "pemotongannya harus diberitahukan lewat header").toContain("HEADER_TERPOTONG");
  });

  it("GET /penerimaan/anomali: agregat & tanda faktur tetap atas populasi penuh", () => {
    const s = butaKomentar(readFileSync(join(SRC, "modules/penerimaan/routes.ts"), "utf8"));
    expect(s, "daftar anomali kehilangan batasnya").toContain("LIMIT ${BATAS_ANOMALI}");
    // Fungsi window dihitung SEBELUM LIMIT — itu yang membuat `jumlah` tetap
    // benar. Menjumlahkannya dari larik yang dipotong membuat badge "barang
    // tidak sampai" menyusut persis saat masalahnya paling besar.
    expect(s, "jumlah/qty_total harus dihitung SQL atas populasi penuh").toContain(
      "COUNT(*) OVER ()",
    );
    expect(s, "jangan jumlahkan qty dari larik yang dipotong").not.toContain("daftar.reduce(");
    // Terukur: 500 faktur punya baris menggantung, tapi `rows` yang dipotong
    // hanya memperlihatkan 100 di antaranya.
    expect(s, "faktur bertanda harus punya kueri sendiri").toContain("SELECT DISTINCT g.faktur_id");
    const web = readFileSync(
      fileURLToPath(new URL("../../web/src/lib/menggantung.ts", import.meta.url)),
      "utf8",
    );
    expect(web, "tanda faktur tak boleh diturunkan dari rows yang dipotong").not.toMatch(
      /data\?\.rows[^)]*faktur_id/,
    );
    expect(web).toContain("data?.faktur_ids");
  });
});
