/**
 * DI DALAM TRANSAKSI, JANGAN MENYEWA KONEKSI KEDUA.
 *
 * `db` adalah `pg.Pool` tanpa `max` dan tanpa `connectionTimeoutMillis`
 * (`db/client.ts:10`), jadi bawaan node-postgres berlaku: **10 koneksi**, dan
 * penunggu antre **selamanya**. `db.transaction()` menyewa satu koneksi dan
 * memegangnya sampai commit. Setiap pemakaian `db` global DI DALAM blok itu
 * menyewa koneksi KEDUA sementara yang pertama masih dipegang.
 *
 * Akibatnya bukan lambat, melainkan MACET TOTAL: begitu 10 permintaan
 * serentak sama-sama membuka transaksi, kesepuluhnya menunggu koneksi ke-11
 * yang hanya bisa dilepas oleh salah satu dari mereka sendiri. Kolamnya satu
 * untuk seluruh proses, jadi yang berhenti bukan cuma rute itu — melainkan
 * setiap permintaan yang menyentuh basis data, sampai server direstart.
 *
 * TERUKUR, dan pasangannya membuktikan sebabnya cuma satu baris:
 *   kolam max=3, 3 permintaan serentak, baca lewat `db` global → MACET (>5 dtk)
 *   idem, baca lewat `tx` (koneksi sendiri)                    → SELESAI
 *
 * Bahaya keduanya lebih sunyi: dua koneksi = DUA snapshot. `kirim`/`transfer`
 * menghitung `tersedia = saldo − dalam_jalan` dengan `saldo` dibaca lewat `db`
 * dan `dalam_jalan` lewat `tx`. Penerimaan yang commit di antara keduanya
 * mengurangi SALDO dan DALAM_JALAN sekaligus, jadi yang terbaca
 * `saldo_lama − dalamJalan_baru` — persis melebih-lebihkan ketersediaan sebesar
 * jumlah yang baru diterima, yaitu kelebihan-janji stok CK yang menurut
 * komentar di atas pengurangan itu justru ada untuk mencegah.
 *
 * Advisory lock TIDAK menutupnya: `kunciKirimCabang` menyerialkan sesama
 * PENGIRIM dari cabang itu, sedangkan yang menggeser angkanya adalah
 * PENERIMAAN di cabang tujuan — antrean yang lain sama sekali.
 *
 * Daftar helper rawannya SENGAJA tidak ditulis tangan: ia diturunkan dari
 * sumber, yaitu setiap fungsi yang parameter executor-nya boleh dihilangkan
 * (`= db`). Helper rawan yang lahir besok ikut terjaga tanpa ada yang perlu
 * ingat menambahkannya ke sini.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Jalurnya ditulis berakhiran "/" dengan sengaja: `jangkar-iris.test.ts`
// mengenali literal DIREKTORI hanya dari akhiran itu, dan tanpanya penjaga
// tersebut mengira uji ini tak membaca sumber apa pun — sehingga jangkar
// "db.transaction(" di bawah tak bisa diverifikasi keberadaannya.
const SRC = fileURLToPath(new URL("../src/", import.meta.url)).replace(/\/$/, "");

type Berkas = { rel: string; isi: string };

function semuaTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = `${dir}/${n}`;
    if (statSync(p).isDirectory()) return semuaTs(p);
    return n.endsWith(".ts") ? [p] : [];
  });
}
const BERKAS = semuaTs(SRC).map((p) => ({ rel: p.slice(SRC.length + 1), isi: readFileSync(p, "utf8") }));

/** Rentang `(...)` berimbang mulai dari kurung buka pertama sesudah `dari`. */
function blokSeimbang(s: string, dari: number): [number, number] {
  const i = s.indexOf("(", dari);
  if (i < 0) return [-1, -1];
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "(") d++;
    else if (s[j] === ")" && --d === 0) return [i, j];
  }
  return [i, s.length];
}

/** Rentang `{...}` berimbang mulai dari kurawal buka pertama sesudah `dari`. */
function blokKurawal(s: string, dari: number): [number, number] {
  const i = s.indexOf("{", dari);
  if (i < 0) return [-1, -1];
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") d++;
    else if (s[j] === "}" && --d === 0) return [i, j];
  }
  return [i, s.length];
}

/** Pecah daftar argumen jadi argumen TINGKAT ATAS (koma di dalam kurung/kurawal diabaikan). */
function argumenTingkatAtas(isi: string): string[] {
  const out: string[] = [];
  let d = 0;
  let mulai = 0;
  for (let i = 0; i < isi.length; i++) {
    const c = isi[i];
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
    else if (c === "," && d === 0) {
      out.push(isi.slice(mulai, i).trim());
      mulai = i + 1;
    }
  }
  out.push(isi.slice(mulai).trim());
  return out.filter(Boolean);
}

/** Setiap blok `db.transaction(...)` di seluruh sumber. */
function blokTransaksi(isi: string): { blok: string; baris: number }[] {
  const out: { blok: string; baris: number }[] = [];
  let idx = 0;
  while ((idx = isi.indexOf("db.transaction(", idx)) !== -1) {
    const [a, b] = blokSeimbang(isi, idx + "db.transaction".length);
    if (a < 0) break;
    out.push({ blok: isi.slice(a, b), baris: isi.slice(0, a).split("\n").length });
    idx = b;
  }
  return out;
}

/**
 * Helper yang executor-nya BOLEH dihilangkan — satu-satunya bentuk yang bisa
 * salah tanpa ketahuan typechecker. Yang parameternya WAJIB tak perlu dijaga:
 * melupakannya sudah gagal saat kompilasi.
 */
function helperRawan(berkas: Berkas[] = BERKAS): string[] {
  const nama = new Set<string>();
  for (const { isi } of berkas) {
    const baris = isi.split("\n");
    baris.forEach((b, i) => {
      if (!/=\s*db\s*,?\s*$/.test(b)) return;
      // Mundur sampai deklarasi fungsinya.
      for (let j = i; j >= 0 && j > i - 40; j--) {
        const m = baris[j].match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) {
          nama.add(m[1]);
          return;
        }
      }
    });
  }
  return [...nama].sort();
}

const RAWAN = helperRawan();

const RE_DB = /\bdb\.(select|insert|update|delete|execute|query|transaction)\b/;
const dipanggil = (nama: string) => new RegExp(`(?<![.\\w])${nama}\\s*\\(`);

/** Badan tiap fungsi bernama (`function f(){}` maupun `const f = () => {}`). */
function badanFungsi(berkas: Berkas[]): Map<string, { rel: string; badan: string }> {
  const fn = new Map<string, { rel: string; badan: string }>();
  const pola = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g,
    /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?\(/g,
  ];
  for (const { rel, isi } of berkas) {
    for (const p of pola) {
      for (const m of isi.matchAll(p)) {
        if (fn.has(m[1])) continue;
        const [, tutupArg] = blokSeimbang(isi, m.index! + m[0].length - 1);
        if (tutupArg < 0) continue;
        const [ba, bb] = blokKurawal(isi, tutupArg);
        if (ba >= 0) fn.set(m[1], { rel, badan: isi.slice(ba, bb) });
      }
    }
  }
  return fn;
}

/**
 * Fungsi yang MENCAPAI `db` global — langsung, atau lewat rantai pemanggilan.
 *
 * Kelas kedua, dan yang lebih sunyi: `hitungSaldoCabang` masih kelihatan salah
 * saat dibaca (executor-nya hilang di tempat pemanggilan). Fungsi yang di
 * dalamnya memakai `db` tanpa parameter executor sama sekali tak menampakkan
 * apa pun di tempat pemanggilan — pemanggilnya terlihat polos.
 */
function fungsiKotor(fn: Map<string, { rel: string; badan: string }>): Set<string> {
  const kotor = new Set([...fn].filter(([, v]) => RE_DB.test(v.badan)).map(([k]) => k));
  for (let ubah = true, putaran = 0; ubah && putaran < 30; putaran++) {
    ubah = false;
    for (const [nama, v] of fn) {
      if (kotor.has(nama)) continue;
      for (const k of kotor) {
        if (dipanggil(k).test(v.badan)) {
          kotor.add(nama);
          ubah = true;
          break;
        }
      }
    }
  }
  return kotor;
}

/** Pemanggilan fungsi "kotor" dari DALAM blok transaksi. */
function pelanggarKotor(berkas: Berkas[]): string[] {
  const fn = badanFungsi(berkas);
  const kotor = fungsiKotor(fn);
  const out: string[] = [];
  for (const { rel, isi } of berkas) {
    for (const { blok, baris } of blokTransaksi(isi)) {
      for (const k of kotor) {
        for (const m of blok.matchAll(new RegExp(`(?<![.\\w])${k}\\s*\\(`, "g"))) {
          out.push(`${rel}:${baris + blok.slice(0, m.index).split("\n").length - 1} → ${k}()`);
        }
      }
    }
  }
  return out;
}

describe("kolam koneksi: transaksi tak boleh menyewa koneksi kedua", () => {
  it("premis: `db` memang kolam tanpa batas & tanpa tenggat yang di-set sendiri", () => {
    // Kalau suatu hari `max` dinaikkan atau `connectionTimeoutMillis` diisi,
    // ANGKANYA berubah tapi kelas bugnya tidak — cuma butuh lebih banyak
    // permintaan serentak, atau berubah dari macet jadi badai galat. Premis ini
    // dicatat supaya alasannya tetap terbaca saat itu terjadi.
    const client = readFileSync(fileURLToPath(new URL("../src/db/client.ts", import.meta.url)), "utf8");
    expect(client).toContain("new pg.Pool({ connectionString: env.DATABASE_URL })");
  });

  it("penjaganya menemukan helper rawan — daftarnya tak boleh kosong", () => {
    // Kalau penurunan daftarnya rusak (mis. gaya tulis parameternya berubah),
    // SELURUH asersi di bawah jadi hijau tanpa memeriksa apa pun.
    expect(RAWAN.length, "tak satu pun helper ber-default `db` terdeteksi").toBeGreaterThan(0);
    expect(RAWAN).toContain("hitungSaldoCabang");
  });

  it("tak ada `db.` telanjang di dalam blok transaksi", () => {
    const pelanggar: string[] = [];
    for (const { rel, isi } of BERKAS) {
      for (const { blok, baris } of blokTransaksi(isi)) {
        for (const m of blok.matchAll(/\bdb\.(select|insert|update|delete|execute|query|transaction)\b/g)) {
          pelanggar.push(`${rel}:${baris + blok.slice(0, m.index).split("\n").length - 1} → ${m[0]}`);
        }
      }
    }
    expect(pelanggar, "pemakaian `db` global di dalam transaksi menyewa koneksi kedua").toEqual([]);
  });

  it("helper ber-default `db` selalu dioper `tx` di dalam transaksi", () => {
    const pelanggar: string[] = [];
    for (const { rel, isi } of BERKAS) {
      for (const { blok, baris } of blokTransaksi(isi)) {
        for (const h of RAWAN) {
          for (const m of blok.matchAll(new RegExp(`\\b${h}\\s*\\(`, "g"))) {
            const [ia, ib] = blokSeimbang(blok, m.index! + h.length);
            if (ia < 0) continue;
            const args = argumenTingkatAtas(blok.slice(ia + 1, ib));
            if (args.some((a) => a === "tx")) continue;
            pelanggar.push(
              `${rel}:${baris + blok.slice(0, m.index).split("\n").length - 1} → ${h}(${args.join(", ").replace(/\s+/g, " ").slice(0, 60)})`,
            );
          }
        }
      }
    }
    expect(
      pelanggar,
      "helper ini membaca lewat `db` global padahal dipanggil di dalam transaksi",
    ).toEqual([]);
  });

  it("tak ada fungsi yang MENCAPAI `db` global dipanggil dari dalam transaksi", () => {
    // Premis dulu: daftar kosong bisa berarti "tak ada pelanggar" ATAU
    // "pengurainya tak membaca apa-apa". Angkanya dipatok longgar — yang
    // dijaga cuma bahwa analisisnya benar-benar berjalan atas sumber nyata.
    const fn = badanFungsi(BERKAS);
    expect(fn.size, "pengurai fungsi tak menemukan apa pun di sumber nyata").toBeGreaterThan(100);
    expect(
      fungsiKotor(fn).size,
      "tak satu pun fungsi terdeteksi menyentuh `db` — mustahil di repo ini",
    ).toBeGreaterThan(5);
    expect(
      pelanggarKotor(BERKAS),
      "fungsi ini memakai `db` global di dalamnya (langsung atau lewat rantai), " +
        "jadi memanggilnya dari dalam transaksi tetap menyewa koneksi kedua — " +
        "meski tempat pemanggilannya terlihat polos",
    ).toEqual([]);
  });

  it("PASANGAN: penutupan transitif bisa MENUDUH lewat dua lapis", () => {
    /*
     * Kelas ini tak punya satu pun pelanggar hari ini, jadi asersinya hijau —
     * dan hijau tanpa pasangan tak membuktikan apa-apa. Sumber TIRUAN ini
     * memasang pelanggarnya di lapis KEDUA: `perantara` sendiri tak menyebut
     * `db` sama sekali, jadi hanya penutupan transitif yang bisa menemukannya.
     */
    const tiruan: Berkas[] = [
      {
        rel: "tiruan.ts",
        isi: [
          "export async function bacaSesuatu() { return db.select().from(x); }",
          "export async function perantara() { return bacaSesuatu(); }",
          "export async function handler() {",
          "  return db.transaction(async (tx) => { void tx; return perantara(); });",
          "}",
        ].join("\n"),
      },
    ];
    const tuduhan = pelanggarKotor(tiruan);
    expect(tuduhan, "penutupan transitif gagal menembus lapis kedua").toHaveLength(1);
    expect(tuduhan[0]).toContain("perantara()");

    // …dan sebaliknya: rantai yang TAK pernah menyentuh `db` tidak dituduh.
    const bersih: Berkas[] = [
      {
        rel: "bersih.ts",
        isi: [
          "export async function hitung(tx) { return tx.select().from(x); }",
          "export async function handler() {",
          "  return db.transaction(async (tx) => { return hitung(tx); });",
          "}",
        ].join("\n"),
      },
    ];
    expect(pelanggarKotor(bersih), "menuduh rantai yang bersih").toEqual([]);
  });

  it("PASANGAN: detektornya bisa MENUDUH, bukan sekadar selalu hijau", () => {
    /*
     * Tiga asersi di atas semuanya berbentuk "daftar pelanggar harus kosong" —
     * bentuk yang paling gampang hijau karena alasan yang salah (regex meleset,
     * blok tak ketemu, daftar helper kosong). Yang diperiksa di sini: mesin yang
     * SAMA, dijalankan atas sumber tiruan yang memang melanggar, harus menuduh.
     */
    const tiruan = [
      "export async function hitungSaldoCabang(a: string, b: string, exec = db) {}",
      "const hasil = await db.transaction(async (tx) => {",
      "  await kunciKirimCabang(tx, companyId, ckId);",
      "  const saldo = await hitungSaldoCabang(companyId, ckId);",
      "  await db.select().from(x);",
      "  return 1;",
      "});",
    ].join("\n");

    // (a) daftar helper rawan memang terturunkan dari sumber
    expect(RAWAN).toContain("hitungSaldoCabang");

    // (b) `db.` telanjang tertangkap
    const blok = blokTransaksi(tiruan);
    expect(blok, "blok transaksi tiruan tak terbaca").toHaveLength(1);
    const dbTelanjang = [...blok[0].blok.matchAll(/\bdb\.(select|insert|update|delete|execute|query)\b/g)];
    expect(dbTelanjang.map((m) => m[0])).toEqual(["db.select"]);

    // (c) panggilan tanpa `tx` tertangkap, dan yang DENGAN `tx` tidak ikut dituduh
    const cocok = [...blok[0].blok.matchAll(/\bhitungSaldoCabang\s*\(/g)];
    expect(cocok).toHaveLength(1);
    const [ia, ib] = blokSeimbang(blok[0].blok, cocok[0].index! + "hitungSaldoCabang".length);
    expect(argumenTingkatAtas(blok[0].blok.slice(ia + 1, ib)).some((a) => a === "tx")).toBe(false);

    const benar = "await kunciKirimCabang(tx, companyId, ckId);";
    const [ja, jb] = blokSeimbang(benar, "await kunciKirimCabang".length);
    expect(argumenTingkatAtas(benar.slice(ja + 1, jb)).some((a) => a === "tx")).toBe(true);
  });

  it("PASANGAN: koma di dalam kurung tak memecah argumen", () => {
    // `saldoDiRakPerlengkapan(tx, a, b, [x, y])` punya koma di dalam `[]`.
    // Pemecah yang naif membacanya sebagai argumen terpisah dan bisa salah
    // menyimpulkan ada/tidaknya `tx`.
    expect(argumenTingkatAtas("tx, a, b, [x, y]")).toEqual(["tx", "a", "b", "[x, y]"]);
    expect(argumenTingkatAtas("f(a, b), tx")).toEqual(["f(a, b)", "tx"]);
  });
});
