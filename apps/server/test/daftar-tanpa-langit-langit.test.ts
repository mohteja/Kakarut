import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
const SRC = fileURLToPath(new URL("../src", import.meta.url));

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

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Rantai sesudah `.from(...)` sampai `;` pada kedalaman kurung nol. */
function ekorPernyataan(s: string, mulai: number): string {
  let ekor = "";
  let dalam = 0;
  for (let j = mulai; j < s.length && ekor.length < 4000; j += 1) {
    const c = s[j];
    if (c === "(") dalam += 1;
    else if (c === ")") dalam -= 1;
    else if (c === ";" && dalam <= 0) break;
    ekor += c;
  }
  return ekor;
}

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
    // Tabel master tak ikut dijaga: jumlahnya kira-kira tetap.
    expect(
      buat("await db.select({ id: menus.id }).from(menus).where(f);"),
      "tabel di luar daftar TUMBUH tak boleh tertuduh",
    ).toHaveLength(0);
  });
});
