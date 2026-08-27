import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  barisDi,
  deklarasiTerlihat,
  jelajah,
  menyentuhProperti,
  petaInduk,
  petaLingkup,
  rantaiPenuh,
  uraikan,
} from "./util/ast";
import { butaKomentar } from "../src/scripts/buta-komentar";
import {
  SRC,
  akhirTemplate,
  awalPernyataan,
  ekorPernyataan,
  templateSql,
} from "./util/sql-mentah";
import { situsBendera } from "./util/bendera-hapus";

/**
 * INSTRUMENNYA SENDIRI YANG DIUJI — Aturan 7, dibayar sekali lagi.
 *
 * Ledger ini mencatat detektor regex meleset hampir tiap putaran, dan tiap kali
 * dengan nama: 26 tuduhan palsu; satu "templat" menelan 141 baris; 14 dari 22
 * jendela patah; 99 dari 101 panggilan async tertuduh palsu; empat generasi
 * pemindai telanan galat dalam satu putaran. Sebabnya satu: PENGURAI YANG
 * DIKIRA-KIRA.
 *
 * Sejak 2026-08-27 penyapu bendera-hapus (dan pencari templat `sql`) berdiri di
 * atas pohon sintaks sungguhan. Berkas ini yang menjaga bahwa pertukaran itu
 * NYATA — bukan tukar rasa: tiap uji di bawah menyebut BENTUK yang membutakan
 * versi teksnya, dan membuktikannya di KODE YANG BENAR-BENAR ADA di repo ini.
 */

const baca = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("premis: parsernya nyata, dan diamnya tak bisa menyamar jadi bersih", () => {
  it("mengurai TypeScript, bukan cuma JavaScript", () => {
    const prog = uraikan(
      "u.ts",
      "type T = { a: number };\nconst x = { a: 1 } as T;\nfunction f<A>(v: A): A { return v; }\n",
    );
    const tipe = new Set<string>();
    jelajah(prog, (n) => tipe.add(n.type));
    expect(tipe.has("TSAsExpression"), "`as` tak terlihat — ini bukan pengurai TS").toBe(true);
    expect(tipe.has("TSTypeAliasDeclaration")).toBe(true);
  });

  it("MENOLAK berkas rusak, bukan memulangkan pohon kosong", () => {
    // Sapuan yang diam-diam memulangkan nol karena berkasnya gagal diurai
    // adalah kebutaan yang menyamar jadi kebersihan — kelas yang sudah dibayar
    // ledger ini lebih dari sekali.
    expect(() => uraikan("rusak.ts", "const a = (((;")).toThrow(/Parser menolak/);
  });

  it("KOMENTAR & STRING bukan kode — tanpa satu pun penambal", () => {
    // Inilah alasan `butaKomentar` pernah harus ada. Di pohon, prosa memang
    // tak pernah masuk.
    const isi = [
      "// db.select().from(sales)",
      'const s = "db.select().from(sales)";',
      "/* .from(sales) */",
      "const r = db.select().from(sales);",
    ].join("\n");
    const situs = situsBendera([{ nama: "uji/prosa.ts", isi }]);
    expect(situs.length, "prosa/string ikut terhitung sebagai kueri").toBe(1);
  });
});

describe("BUKTI BUTA #1 — prosa `sql<...>` di komentar dibaca sebagai templat SQL", () => {
  const F = "lib/porsi-ditagih.ts";

  it("berkas nyata: pemindai lama melihat 6 templat, pohonnya melihat 4", () => {
    const isi = baca(F);
    // Premis: berkas ini MEMANG menulis `sql<number>` sebagai prosa di
    // komentarnya, di dalam petik-balik Markdown — itu yang menipu regexnya.
    expect(isi, "premis hilang: prosanya sudah tak ada").toMatch(/`sql<number>`/);

    // Pemindai LAMA, apa adanya.
    const lama = (s: string): { pos: number; isi: string }[] => {
      const keluar: { pos: number; isi: string }[] = [];
      for (const m of s.matchAll(/\bsql(?:<[^`>]*>)?\s*`/g)) {
        const awal = m.index! + m[0].length;
        keluar.push({ pos: m.index!, isi: s.slice(awal, akhirTemplate(s, awal)) });
      }
      return keluar;
    };
    expect(lama(isi).length).toBe(6);
    expect(templateSql(isi).length).toBe(4);
    // …dan empat itu memang keempat `sql<number>` yang benar-benar dijalankan.
    expect(templateSql(isi).every((t) => /::float8/.test(t.isi))).toBe(true);
  });

  it("kelas yang sama di berkas kedua: `modules/penjualan/routes.ts`", () => {
    const isi = baca("modules/penjualan/routes.ts");
    expect(isi).toMatch(/`sql<\.\.\.>`/);
    const lama = [...isi.matchAll(/\bsql(?:<[^`>]*>)?\s*`/g)].length;
    expect(lama).toBe(templateSql(isi).length + 1);
  });
});

describe("BUKTI BUTA #2 — SELECT dimaafkan sebagai TULISAN oleh jendela teks", () => {
  const F = "modules/pesanan/routes.ts";

  it("empat kueri nyata: aturan teks lama melabelinya MENULIS, pohonnya TELANJANG", () => {
    const isi = baca(F);

    // Aturan LAMA direkonstruksi apa adanya, dengan primitif yang persis sama
    // (keduanya masih diekspor `sql-mentah.ts`): jendela teks dari "awal
    // pernyataan" sampai ujung rantainya, lalu dicari `.insert|.update|.delete`
    // DI DALAM TEKS ITU. Situs yang dilabeli MENULIS tak pernah ditagih
    // keputusan apa pun — ia dianggap tulisan, dan tulisan memang tak perlu
    // menyaring bendera.
    const s = butaKomentar(isi);
    const menulisLama: number[] = [];
    for (const m of s.matchAll(/\.(from|innerJoin|leftJoin|rightJoin)\(\s*(\w+)\s*[,)]/g)) {
      if (m[2] !== "saleItems") continue;
      const rantaiLama =
        s.slice(awalPernyataan(s, m.index!), m.index!) + ekorPernyataan(s, m.index!, 3000);
      if (/\.(update|insert|delete)\s*\(/.test(rantaiLama)) menulisLama.push(m.index!);
    }
    expect(
      menulisLama.length,
      "aturan lama tak melabeli satu pun MENULIS — buktinya tak mendarat",
    ).toBeGreaterThanOrEqual(4);

    // Pohonnya: rantai yang sama murni SELECT, jadi ia tertuduh TELANJANG dan
    // harus terdaftar beralasan di gerbangnya.
    const telanjang = situsBendera([{ nama: F, isi }]).filter(
      (x) => x.kelas === "TELANJANG" && x.tabel === "saleItems",
    );
    expect(telanjang.length).toBeGreaterThanOrEqual(4);
    for (const x of telanjang) {
      expect(x.potongan, "rantainya ternyata memang menulis").not.toMatch(
        /\.(insert|update|delete)\(/,
      );
    }
  });
});

describe("BUKTI BUTA #3 — dua kueri dalam satu `Promise.all` dihitung satu", () => {
  for (const [F, n] of [
    ["modules/bahan/routes.ts", 2],
    ["modules/customer/routes.ts", 2],
  ] as const) {
    it(`berkas nyata: ${F} punya ${n} kueri berdampingan, dan keduanya terhitung`, () => {
      const isi = baca(F);
      expect(isi, "premis hilang: tak ada Promise.all di berkas ini").toContain(
        "await Promise.all([",
      );
      const prog = uraikan(F, isi);
      const induk = petaInduk(prog);
      // Kueri yang induk sintaksisnya SATU larik `Promise.all` — di teks,
      // keduanya berbagi "awal pernyataan" yang sama, dan versi lama
      // memulangkan satu.
      const perLarik = new Map<unknown, number>();
      jelajah(prog, (x) => {
        if (x.type !== "CallExpression") return;
        if (x.callee?.type !== "MemberExpression" || x.callee.property?.name !== "from") return;
        const rantai = rantaiPenuh(x, induk);
        const atas = induk.get(rantai);
        if (atas?.type !== "ArrayExpression") return;
        perLarik.set(atas, (perLarik.get(atas) ?? 0) + 1);
      });
      expect(Math.max(0, ...perLarik.values())).toBeGreaterThanOrEqual(n);
    });
  }
});

describe("kemampuan yang TAK BISA ditiru teks: lingkup sebuah nama", () => {
  it("dua kueri yang teksnya identik memakai `conds` yang BERBEDA", () => {
    // Ini uji KEMAMPUAN, dan ditulis begitu: bentuknya disusun di sini, bukan
    // dipungut dari repo. Yang dibuktikan bukan ada bug di suatu berkas,
    // melainkan bahwa aturan lama ("deklarasi terdekat SEBELUM situsnya di
    // berkas yang sama") memang tak bisa menjawabnya — `bendera-hapus.ts`
    // sendiri menulis bahwa `conds` dideklarasikan sembilan kali di satu
    // berkas.
    const isi = [
      "async function f() {",
      "  const conds = [eq(a.b, 1)];",
      "  {",
      "    const conds = [isNull(sales.deletedAt)];",
      "    await db.select().from(sales).where(and(...conds));",
      "  }",
      "  await db.select().from(sales).where(and(...conds));",
      "}",
    ].join("\n");
    const situs = situsBendera([{ nama: "uji/lingkup.ts", isi }]).filter(
      (x) => x.induk === "sales",
    );
    expect(situs.length).toBe(2);
    const urut = [...situs].sort((x, y) => x.baris - y.baris);
    expect(urut[0].kelas, "yang di dalam blok memakai conds bersaringan").toBe("LEWAT_VARIABEL");
    expect(urut[1].kelas, "yang di luar blok memakai conds TANPA saringan").toBe("TELANJANG");

    // Dan aturan lama benar-benar menjawab keduanya sama — dibuktikan, bukan
    // diklaim: deklarasi terakhir sebelum KEDUA situs adalah yang bersaringan.
    const posSitus = [...isi.matchAll(/\.from\(sales\)/g)].map((m) => m.index!);
    const posDekl = [...isi.matchAll(/const conds =/g)].map((m) => m.index!);
    const terdekat = (p: number) => posDekl.filter((d) => d < p).at(-1)!;
    expect(terdekat(posSitus[0])).toBe(posDekl[1]);
    expect(terdekat(posSitus[1]), "aturan teks lama memaafkan yang kedua").toBe(posDekl[1]);
  });

  it("primitif lingkupnya sendiri: bayangan nama diselesaikan, bukan ditebak", () => {
    const isi = "const x = [satu.deletedAt];\nfunction f() {\n  const x = [dua.id];\n  g(x);\n}\n";
    const prog = uraikan("u.ts", isi);
    const induk = petaInduk(prog);
    const lingkup = petaLingkup(prog, induk);
    let dalam: ReturnType<typeof deklarasiTerlihat>;
    jelajah(prog, (n) => {
      if (n.type === "CallExpression" && n.callee?.name === "g") {
        dalam = deklarasiTerlihat(n, "x", induk, lingkup);
      }
    });
    expect(dalam, "nama tak terselesaikan").toBeTruthy();
    expect(menyentuhProperti(dalam!.nilai, "deletedAt"), "yang terlihat justru x LUAR").toBe(false);
  });
});

describe("primitif: rantai & baris", () => {
  it("rantai penuh berhenti di batas ekspresinya, bukan di koma tetangga", () => {
    const isi = "const [a, b] = await Promise.all([db.select().from(x).limit(5), db.select().from(y)]);\n";
    const prog = uraikan("u.ts", isi);
    const induk = petaInduk(prog);
    const rantai: string[] = [];
    jelajah(prog, (n) => {
      if (n.type !== "CallExpression") return;
      if (n.callee?.type !== "MemberExpression" || n.callee.property?.name !== "from") return;
      const r = rantaiPenuh(n, induk);
      rantai.push(isi.slice(r.start, r.end));
    });
    expect(rantai).toEqual(["db.select().from(x).limit(5)", "db.select().from(y)"]);
  });

  it("nomor baris dihitung dari offset, dan 1-based", () => {
    const isi = "a\nb\nc";
    expect(barisDi(isi, 0)).toBe(1);
    expect(barisDi(isi, 2)).toBe(2);
    expect(barisDi(isi, 4)).toBe(3);
  });
});
