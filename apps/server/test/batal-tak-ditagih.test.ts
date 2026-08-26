import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { barisDitagih, dibatalkanDapur } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { SRC, templateSql } from "./util/sql-mentah";

/**
 * SAJIAN YANG DIBATALKAN DAPUR TIDAK BOLEH DITAGIH.
 *
 * Aturannya ditulis panjang di `open-bill/routes.ts`, tepat di atas penyaring
 * bon: *"Di slip, membawa baris batal berarti menyuruh dapur memasaknya lagi.
 * Di sini artinya MENAGIH TAMU untuk makanan yang tak pernah datang."* Lalu ia
 * ditulis ULANG di empat tempat — slip dapur, bon tagihan, keranjang kasir web,
 * keranjang ponsel — dan TIDAK ditulis di pintu yang benar-benar mengambil
 * uangnya.
 *
 * Terukur lewat HTTP sebelum penjaganya ada, satu bill dua baris yang salah
 * satunya dibatalkan dapur:
 *
 *     bon sesudah pembatalan   Rp1.000
 *     penjualan yang terbit    Rp6.000   (201)
 *     sale_items               "Nasi Putih" Rp5.000  pesanan_status="batal"
 *     stok bahannya            50 → 49
 *
 * Satu baris yang sekaligus `batal` DAN ditagih, plus stok terpotong untuk
 * masakan yang tak pernah dibuat.
 */

const AKAR: Record<string, string> = {
  server: SRC,
  shared: fileURLToPath(new URL("../../../packages/shared/src", import.meta.url)),
  web: fileURLToPath(new URL("../../web/src", import.meta.url)),
};

/** Rumah aturannya. Satu-satunya tempat perbandingan status pesanan boleh hidup. */
const RUMAH = "shared/pesanan.ts";

/**
 * Berkas yang memakai literal `"batal"` untuk BENDERA LAIN — status faktur
 * beli perlengkapan (`supply_purchases.status`), yang kebetulan memakai kata
 * yang sama. Dicatat berkas + JUMLAH supaya perbandingan BARU di sana tetap
 * menagih keputusan, tapi ia bukan populasi vena ini.
 */
const BENDERA_LAIN = new Map<string, { situs: number; alasan: string }>([
  [
    "server/modules/rekomendasi/routes.ts",
    {
      situs: 1,
      alasan:
        "status FAKTUR beli perlengkapan (supply_purchases.status: menunggu/diproses/tiba/batal) — " +
        "bendera lain yang kebetulan memakai kata yang sama, bukan status sajian",
    },
  ],
  [
    "web/pages/perlengkapan/BeliPerlengkapanPage.tsx",
    {
      situs: 4,
      alasan:
        "layar beli perlengkapan: agregat total & penyaring baris atas status FAKTUR, " +
        "bukan atas pesanan_status sajian. Domainnya berbeda, dan menyatukannya justru menyesatkan",
    },
  ],
]);

/**
 * Situs yang memakai literalnya karena TAK BISA memanggil fungsi JS, atau
 * karena ia MENULIS/mendeklarasikan nilainya, bukan membandingkannya.
 */
const TAK_BISA_MEMANGGIL = new Map<string, { situs: number; alasan: string }>([
  [
    "server/modules/meja/okupansi.ts",
    {
      situs: 2,
      alasan:
        "SQL mentah: `si.pesanan_status <> 'batal'` di dalam CTE okupansi meja — " +
        "literal SQL tak bisa memanggil dibatalkanDapur(), dan memindahkannya ke JS " +
        "berarti menarik seluruh baris ke memori untuk menjawab satu boolean",
    },
  ],
  [
    "server/modules/penjualan/routes.ts",
    {
      situs: 2,
      alasan:
        "SQL mentah: durasi pesanan dihitung di dalam subkueri berkorelasi " +
        "(`FILTER (WHERE ... <> 'batal')`), alasan yang sama dengan okupansi",
    },
  ],
]);

type Situs = { akar: string; berkas: string; baris: number; kiri: string; dalamSql: boolean };

function berkasSumber(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) berkasSumber(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Sapuan atas berkas sungguhan, ATAU atas teks yang diberikan — supaya bukti
 * merah bisa memberi makan isi berkas yang penjaganya dicabut, dan detektornya
 * diuji dengan bahan yang sama persis dengan yang dijaganya.
 */
function situsBatal(kode?: { berkas: string; isi: string }[]): Situs[] {
  if (kode) {
    const keluar: Situs[] = [];
    for (const { berkas, isi } of kode) keluar.push(...situsDalam(berkas.split("/")[0], berkas, isi));
    return keluar;
  }
  const keluar: Situs[] = [];
  for (const [akar, dir] of Object.entries(AKAR)) {
    for (const p of berkasSumber(dir)) {
      if (p.endsWith("db/schema.ts")) continue;
      keluar.push(...situsDalam(akar, `${akar}/${p.slice(dir.length + 1)}`, readFileSync(p, "utf8")));
    }
  }
  return keluar;
}

function situsDalam(akar: string, berkas: string, mentah: string): Situs[] {
  const s = butaKomentar(mentah);
  const rentangSql = templateSql(s).map(({ pos, isi }) => [pos, pos + isi.length] as const);
  const keluar: Situs[] = [];
  for (const m of s.matchAll(/["']batal["']/g)) {
    const i = m.index!;
    keluar.push({
      akar,
      berkas,
      baris: s.slice(0, i).split("\n").length,
      kiri: s.slice(Math.max(0, i - 60), i).replace(/\s+/g, " "),
      dalamSql: rentangSql.some(([a, b]) => i >= a && i <= b),
    });
  }
  return keluar;
}

/** Perbandingan JS terhadap literalnya — `=== "batal"` / `!== "batal"`. */
function pembanding(x: Situs): boolean {
  return !x.dalamSql && /(===|!==|==|!=)\s*$/.test(x.kiri);
}

describe("status batal: satu rumah, dan pintu bayar ikut memakainya", () => {
  const semua = situsBatal();

  it("populasinya benar-benar tersapu (bukan nol karena pemindainya patah)", () => {
    const per: Record<string, number> = {};
    for (const x of semua) per[x.akar] = (per[x.akar] ?? 0) + 1;
    expect(semua.length).toBeGreaterThanOrEqual(25);
    expect(per.server ?? 0).toBeGreaterThanOrEqual(12);
    expect(per.web ?? 0).toBeGreaterThanOrEqual(5);
    // SQL mentah ikut terlihat — separuh aturannya hidup di sana.
    expect(semua.filter((x) => x.dalamSql).length).toBeGreaterThanOrEqual(4);
  });

  it("tiap PERBANDINGAN ada di rumahnya, atau berkasnya terdaftar beralasan", () => {
    const liar: string[] = [];
    const perBerkas = new Map<string, number>();
    for (const x of semua) {
      if (!pembanding(x)) continue;
      if (x.berkas === RUMAH) continue;
      perBerkas.set(x.berkas, (perBerkas.get(x.berkas) ?? 0) + 1);
    }
    for (const [berkas, n] of perBerkas) {
      const d = BENDERA_LAIN.get(berkas);
      if (!d) liar.push(`${berkas}: ${n} perbandingan "batal" tanpa dibatalkanDapur()`);
      else if (d.situs !== n) liar.push(`${berkas}: terdaftar ${d.situs}, sekarang ${n}`);
    }
    expect(
      liar,
      `aturan "dibatalkan dapur" ditulis ulang — pakai dibatalkanDapur() dari @kakarut/shared:\n${liar.join("\n")}`,
    ).toEqual([]);
  });

  it("BUKTI MERAH: aturan ditulis ulang di web → detektornya menuduh berkasnya", () => {
    const jalur = fileURLToPath(new URL("../../web/src/pages/kasir/KasirPage.tsx", import.meta.url));
    const asli = readFileSync(jalur, "utf8");
    // Berkas UTUH: nol perbandingan tulisan tangan.
    expect(situsBatal([{ berkas: "web/pages/kasir/KasirPage.tsx", isi: asli }]).filter(pembanding)).toEqual(
      [],
    );

    // Dikembalikan ke bentuk lamanya — suntikan di-assert MENGUBAH berkasnya.
    const dilucuti = asli.replace(
      "dibatalkanDapur(l.pesananStatus)",
      'l.pesananStatus === "batal"',
    );
    expect(dilucuti, "pencabutan tak mengubah apa pun — buktinya tak jadi merah").not.toBe(asli);

    const tertuduh = situsBatal([
      { berkas: "web/pages/kasir/KasirPage.tsx", isi: dilucuti },
    ]).filter(pembanding);
    expect(tertuduh.length).toBe(1);
    expect(tertuduh[0].berkas).toBe("web/pages/kasir/KasirPage.tsx");
    expect(tertuduh[0].baris).toBeGreaterThan(0);
    // …dan berkasnya TIDAK terdaftar sebagai bendera lain, jadi gerbangnya merah.
    expect(BENDERA_LAIN.has(tertuduh[0].berkas)).toBe(false);
  });

  it("literal di SQL mentah terdaftar beralasan (ia memang tak bisa memanggil JS)", () => {
    const perBerkas = new Map<string, number>();
    for (const x of semua) {
      if (!x.dalamSql) continue;
      perBerkas.set(x.berkas, (perBerkas.get(x.berkas) ?? 0) + 1);
    }
    const salah: string[] = [];
    for (const [berkas, n] of perBerkas) {
      const d = TAK_BISA_MEMANGGIL.get(berkas);
      if (!d) salah.push(`${berkas}: ${n} literal 'batal' di SQL, tak terdaftar`);
      else if (d.situs !== n) salah.push(`${berkas}: terdaftar ${d.situs}, sekarang ${n}`);
    }
    expect(salah, salah.join("\n")).toEqual([]);
  });

  it("anti-kuburan + tiap entri daftar menyebut ALASAN", () => {
    const hidup = new Set(semua.map((x) => x.berkas));
    for (const peta of [BENDERA_LAIN, TAK_BISA_MEMANGGIL]) {
      for (const [k, v] of peta) {
        expect(hidup.has(k), `entri daftar sudah tak punya situs — hapus: ${k}`).toBe(true);
        expect(v.alasan.length, `${k} tanpa alasan`).toBeGreaterThan(60);
      }
    }
  });

  it("PINTU BAYAR memakai aturannya — dan bukti merah: dicabut → merah", () => {
    const f = join(SRC, "modules/penjualan/service.ts");
    const asli = readFileSync(f, "utf8");
    // Penjaganya ADA, di jalur open bill, dengan sebab berkode.
    expect(asli).toContain("dibatalkanDapur(baris.pesananStatus)");
    expect(asli).toContain('"baris_dibatalkan"');
    // …dan galatnya MENYEBUT sajiannya, bukan "ada yang salah".
    expect(asli).toContain("baris.menuNama");

    const dilucuti = asli.replace(/if \(dibatalkanDapur\(baris\.pesananStatus\)\) \{/, "if (false) {");
    expect(dilucuti, "pencabutan tak mengubah apa pun — buktinya tak jadi merah").not.toBe(asli);
    expect(dilucuti).not.toContain("dibatalkanDapur(baris.pesananStatus)");
  });

  it("bon & slip memakai pembantu bersama, bukan penyaring tulisan tangan", () => {
    const s = readFileSync(join(SRC, "modules/open-bill/routes.ts"), "utf8");
    expect((s.match(/barisDitagih\(/g) ?? []).length).toBe(2); // slip dapur + bon tagihan
    expect(s).not.toContain('pesanan_status !== "batal"');
  });

  it("keranjang kasir web memakai aturan yang SAMA dengan pintu bayarnya", () => {
    const s = readFileSync(
      fileURLToPath(new URL("../../web/src/pages/kasir/KasirPage.tsx", import.meta.url)),
      "utf8",
    );
    expect(s).toContain("dibatalkanDapur(l.pesananStatus)");
    expect(s).toContain("cartTagih");
  });
});

describe("perilaku pembantunya: yang batal dibuang, yang lain TIDAK", () => {
  it("dibatalkanDapur hanya benar untuk 'batal'", () => {
    expect(dibatalkanDapur("batal")).toBe(true);
    expect(dibatalkanDapur("dikerjakan")).toBe(false);
    expect(dibatalkanDapur("selesai")).toBe(false);
  });

  it("PASANGAN: status kosong/tak dikenal BUKAN batal", () => {
    // Kalau null terbaca "batal", baris yang statusnya belum terisi akan hilang
    // dari tagihan diam-diam — bug yang persis berlawanan arah dengan yang
    // sedang ditutup, dan jauh lebih sunyi.
    expect(dibatalkanDapur(null)).toBe(false);
    expect(dibatalkanDapur(undefined)).toBe(false);
    expect(dibatalkanDapur("")).toBe(false);
    expect(dibatalkanDapur("BATAL")).toBe(false); // beda huruf = beda nilai enum
  });

  it("barisDitagih membuang yang batal dan MEMPERTAHANKAN sisanya, urut", () => {
    const items = [
      { id: "a", st: "dikerjakan" },
      { id: "b", st: "batal" },
      { id: "c", st: "selesai" },
      { id: "d", st: null as string | null },
    ];
    const hasil = barisDitagih(items, (i) => i.st);
    expect(hasil.map((i) => i.id)).toEqual(["a", "c", "d"]);
    // Tidak mengubah larik masukan.
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("seluruh baris batal → tak ada yang ditagih (bukan lempar)", () => {
    expect(barisDitagih([{ st: "batal" }, { st: "batal" }], (i) => i.st)).toEqual([]);
    expect(barisDitagih([], (i: { st: string }) => i.st)).toEqual([]);
  });
});
