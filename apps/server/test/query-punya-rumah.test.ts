import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { barisDi, jelajah, namaProperti, petaInduk, uraikan, type Simpul } from "./util/ast";
import { berkasKode, SRV } from "./util/rute";

/**
 * MASUKAN DARI QUERY PUNYA RUMAH, SAMA SEPERTI MASUKAN DARI BADAN.
 *
 * Repo ini sudah menghabiskan satu vena penuh menertibkan masukan dari BADAN:
 * 97 `zValidator("json", …)`, 112 skema `.strict()`, batas angka bersama di
 * `lib/batas-angka.ts`, gerbangnya sendiri, dan seksi verify-api yang
 * memakunya. Pintu QUERY tak pernah kebagian — **nol**
 * `zValidator("query", …)` di seluruh `src/`, dan 47 pembacaan
 * `c.req.query(...)` yang masing-masing menjaga dirinya sendiri.
 *
 * Sebagian besar menjaga diri dengan BENAR, dan justru itu yang menyamarkan
 * masalahnya: aturan yang dipegang tiga penulis berbeda akan menjadi tiga
 * aturan. TERUKUR lewat HTTP — satu permintaan yang sama, `per_page=500`:
 *
 * | pintu | dibatasi di | dikatakan? |
 * |---|---|---|
 * | `GET /penerimaan/riwayat` | 100 | ya |
 * | `GET /produksi` | 200 | ya |
 * | `GET /transfer-stok` | 200 | **tidak** |
 *
 * Bawaannya pun berbeda: 20, 20, 50.
 *
 * Dua rumah menampung param query hari ini — `lib/tanggal-query.ts` (tanggal,
 * lahir dari venanya sendiri) dan `lib/halaman-query.ts` (halaman, lahir di
 * putaran ini). Yang dijaga gerbang ini: **angka dari query tak boleh dibaca
 * telanjang**. Teks dan enum sengaja di luar populasi — bahaya sebuah angka
 * adalah besarnya, dan itu yang bisa dinilai mekanis.
 */
const BACAAN_ANGKA = "Number(c.req.query(…))";

/** `berkas:baris` → alasan, untuk bacaan angka yang sengaja dibiarkan. */
/*
 * KUNCINYA BERKAS + NAMA PARAMETER, bukan berkas + NOMOR BARIS.
 *
 * Kunci baris di sini membusuk 2026-09-01, di tengah rilis: vena pemotongan
 * menambah komentar di atas dua situs, entrinya bergeser 26 dan 10 baris, dan
 * gerbang ini memerah tanpa satu pun perilaku berubah. Itu pembayaran KEEMPAT
 * atas pelajaran yang sama — `pelaku.test.ts`, `util/urutan.ts` (putaran 27),
 * dan `util/mutasi-web.ts` sudah menuliskannya, dan `kueri-terkurung-tenant`
 * sudah memilih BERKAS + JUMLAH justru karena ini.
 *
 * Nama parameternya (`c.req.query("hari")`) menempel pada HAL yang sedang
 * diadjudikasi: ia berpindah hanya bila parameternya sendiri berganti nama —
 * dan itu memang saat sebuah keputusan lama layak ditinjau ulang.
 *
 * Keunikannya DIPAKU premis di bawah: kunci yang stabil tapi tak unik akan
 * membuat satu entri diam-diam memaafkan dua situs.
 */
const DIPILAH = new Map<string, string>([
  [
    "modules/laporan/routes.ts:biaya_tetap",
    "Kalkulator BEP: `biaya_tetap` ditolak 400 bila bukan angka atau <= 0, di " +
      "baris berikutnya, dengan pesan yang menyebut namanya. Batas ATAS-nya " +
      "memang tak ada — dan itu tak merusak: hasilnya sekadar angka BEP yang " +
      "besar, bukan kueri yang mahal atau baris yang tertulis.",
  ],
  [
    "modules/print/kertas.ts:chars_per_line",
    "`chars_per_line` diklem 16..96 di dalam objek yang dipulangkan, bukan di " +
      "pernyataan yang sama — di luar jangkauan pemindai ini, tapi ada dan " +
      "terbaca mata satu layar.",
  ],
  [
    "modules/print/kertas.ts:feed",
    "`feed` diklem bersama `chars_per_line` di objek yang sama; alasannya sama " +
      "persis dengan tetangganya di atas.",
  ],
  [
    "modules/stok/routes.ts:hari",
    "`hari` diklem 0..60 di baris BERIKUTNYA (`Math.min(60, Math.max(0, …))`) " +
      "dengan bawaan 7 bila bukan angka — pemindai ini berlingkup satu " +
      "pernyataan, jadi klemnya tak terlihat dari situs bacaannya.",
  ],
]);

interface Situs {
  berkas: string;
  baris: number;
  nama: string;
  berklem: boolean;
}

function situsAngkaQuery(kode?: Record<string, string>): Situs[] {
  const keluar: Situs[] = [];
  const sumber: [string, string][] = kode
    ? Object.entries(kode)
    : berkasKode(SRV, /\.ts$/).map((p) => [p, readFileSync(p, "utf8")] as [string, string]);
  for (const [p, isi] of sumber) {
    if (!isi.includes("c.req.query(")) continue;
    const akar = uraikan(p, isi);
    const induk = petaInduk(akar);
    jelajah(akar, (n) => {
      if (n.type !== "CallExpression") return;
      const c = n.callee as Simpul | undefined;
      if (c?.type !== "MemberExpression" || namaProperti(c) !== "query") return;

      let k: Simpul | undefined = induk.get(n);
      let numerik = false;
      let ujung: Simpul = n;
      while (
        k &&
        [
          "CallExpression",
          "MemberExpression",
          "AwaitExpression",
          "BinaryExpression",
          "LogicalExpression",
          "TSNonNullExpression",
        ].includes(k.type)
      ) {
        const kc = k.callee as Simpul | undefined;
        if (k.type === "CallExpression" && kc?.type === "Identifier" && kc.name === "Number") {
          numerik = true;
        }
        ujung = k;
        k = induk.get(k);
      }
      if (!numerik) return;

      let st: Simpul | undefined = induk.get(ujung);
      let hop = 0;
      while (st && !/Statement|Declaration/.test(st.type) && hop < 8) {
        st = induk.get(st);
        hop += 1;
      }
      const teks = st ? isi.slice(st.start, Math.min(st.end, st.start + 400)) : "";
      const arg0 = (n.arguments as Simpul[])[0];
      keluar.push({
        berkas: p.startsWith(SRV) ? p.slice(SRV.length + 1) : p,
        baris: barisDi(isi, (c.property as Simpul).start),
        nama: arg0?.type === "Literal" ? String(arg0.value) : "?",
        berklem: /Math\.min|Math\.max|clamp|isFinite/.test(teks),
      });
    });
  }
  return keluar;
}

const semua = situsAngkaQuery();

/** Kunci adjudikasi: menempel pada parameternya, bukan pada nomor barisnya. */
const kunciSitus = (x: Situs) => `${x.berkas}:${x.nama}`;

describe("masukan dari query punya rumah, sama seperti masukan dari badan", () => {
  it("PREMIS: populasinya benar-benar tersapu", () => {
    expect(semua.length).toBeGreaterThanOrEqual(4);
    // Sesudah halaman pindah ke rumahnya, TAK ADA lagi klem sebaris di
    // `modules/` — dan itu memang tujuannya. Karena itu kemampuan membedakan
    // dibuktikan di fikstur (uji berikutnya), bukan dari pohon sungguhan:
    // premis yang bersandar pada "kebetulan ada contohnya" akan diam-diam
    // berhenti membuktikan apa pun begitu contohnya diperbaiki.
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThanOrEqual(3);
  });

  it("PREMIS: halaman punya SATU rumah, bukan tiga salinan", () => {
    // Yang menagih ini bukan kerapian: tiga salinan aturan yang sama sudah
    // TERUKUR berbeda (batas 100/200/200, bawaan 20/20/50) — satu permintaan
    // `per_page=500` mendapat tiga jawaban berbeda dari tiga pintu.
    const rumah = readFileSync(`${SRV}/lib/halaman-query.ts`, "utf8");
    expect(rumah).toContain("export function halamanQuery");
    for (const f of [
      "modules/penerimaan/routes.ts",
      "modules/produksi/routes.ts",
      "modules/transfer/routes.ts",
    ]) {
      const isi = readFileSync(`${SRV}/${f}`, "utf8");
      expect(isi, `${f} harus memakai rumah halaman`).toContain("halamanQuery(c,");
      expect(isi, `${f} masih mengklem per_page sendiri`).not.toMatch(
        /Number\(c\.req\.query\("per_page"\)/,
      );
    }
  });

  it("PREMIS: tiap pintu MENYEBUT batas & bawaannya, tak mewarisi diam-diam", () => {
    // Rumahnya sengaja MENUNTUT keduanya: batas yang tak terlihat adalah batas
    // yang pelan-pelan berbeda dari batas tetangganya.
    const rumah = readFileSync(`${SRV}/lib/halaman-query.ts`, "utf8");
    expect(rumah).toMatch(/bawaan:\s*number/);
    expect(rumah).toMatch(/maks:\s*number/);
    for (const f of [
      "modules/penerimaan/routes.ts",
      "modules/produksi/routes.ts",
      "modules/transfer/routes.ts",
    ]) {
      const isi = readFileSync(`${SRV}/${f}`, "utf8");
      expect(isi, `${f} tak menyebut batas & bawaannya`).toMatch(/bawaan:\s*\d+,\s*maks:\s*\d+/);
    }
  });

  /**
   * PREMIS bagi kunci barunya: `berkas:nama` wajib UNIK di antara situs yang
   * tak berklem. Kunci stabil yang tak unik adalah cacat kedua — satu entri
   * akan diam-diam memaafkan DUA bacaan, dan yang kedua tak pernah ditinjau
   * siapa pun.
   */
  it("PREMIS: kunci `berkas:nama` unik di antara situs tak berklem", () => {
    const k = semua.filter((x) => !x.berklem).map(kunciSitus);
    const ganda = [...new Set(k.filter((x, i) => k.indexOf(x) !== i))];
    expect(
      ganda,
      "dua bacaan tak berklem berbagi kunci — pakai kunci yang lebih halus:\n" +
        ganda.join("\n"),
    ).toEqual([]);
  });

  it("tiap angka dari query dibatasi, atau terdaftar beralasan", () => {
    const liar = semua
      .filter((x) => !x.berklem)
      .map(kunciSitus)
      .filter((k) => !DIPILAH.has(k));
    expect(
      liar,
      `${BACAAN_ANGKA} tanpa batas yang terlihat:\n` +
        liar.join("\n") +
        "\n\nPilih SATU: (a) pakai rumahnya — `halamanQuery` untuk halaman, " +
        "`tanggalQuery` untuk tanggal; (b) klem di pernyataan yang sama " +
        "(`Math.min`/`Math.max`/`Number.isFinite`); atau (c) daftarkan di " +
        "`DIPILAH` dengan alasan kenapa besarnya tak bisa merugikan.",
    ).toEqual([]);
  });

  it("anti-kuburan: tiap entri DIPILAH masih punya situsnya, dan beralasan", () => {
    const nyata = new Set(semua.map(kunciSitus));
    const basi = [...DIPILAH.keys()].filter((k) => !nyata.has(k));
    expect(basi, `sudah tak ada situsnya — hapus:\n${basi.join("\n")}`).toEqual([]);
    for (const [k, alasan] of DIPILAH) {
      expect(alasan.trim().length, `${k}: alasannya terlalu pendek`).toBeGreaterThan(80);
    }
  });

  it("PREMIS: pemindainya BISA menuduh, dan membedakan berklem dari telanjang", () => {
    const s = situsAngkaQuery({
      "uji/telanjang.ts": 'const n = Number(c.req.query("limit"));\n',
      "uji/berklem.ts": 'const n = Math.min(50, Math.max(1, Number(c.req.query("limit"))));\n',
    });
    expect(s.length).toBe(2);
    expect(s.find((x) => x.berkas === "uji/telanjang.ts")?.berklem).toBe(false);
    expect(s.find((x) => x.berkas === "uji/berklem.ts")?.berklem).toBe(true);
  });

  it("PASANGAN: param query yang bukan angka tak ikut dituduh", () => {
    // Bahaya sebuah ANGKA adalah besarnya, dan itu yang bisa dinilai mekanis.
    // Teks & enum (`status`, `sesi`, `q`) sengaja di luar populasi — menuduh
    // semuanya akan membuat gerbang ini ditutup orang, bukan dipatuhi.
    const s = situsAngkaQuery({
      "uji/teks.ts": 'const q = (c.req.query("q") ?? "").trim();\n',
    });
    expect(s).toEqual([]);
  });

  it("BUKTI MERAH: klem dicabut dari `hari` → situsnya tertuduh", () => {
    const f = `${SRV}/modules/stok/routes.ts`;
    const asli = readFileSync(f, "utf8");
    const dicabut = asli.replace(
      "Math.min(60, Math.max(0, Math.trunc(hariQ)))",
      "Math.trunc(hariQ)",
    );
    expect(dicabut, "suntikan tak mendarat").not.toBe(asli);
    const s = situsAngkaQuery({ "modules/stok/routes.ts": dicabut });
    expect(s.length).toBe(1);
    expect(s[0].berklem, "klem dicabut tapi masih terbaca berklem").toBe(false);
  });
});
