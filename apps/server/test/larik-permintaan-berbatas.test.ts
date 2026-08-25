import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SETIAP LARIK DARI BADAN PERMINTAAN HARUS PUNYA BATAS ATAS.
 *
 * KENAPA UJI INI ADA, dan angkanya diukur bukan dikarang.
 *
 * `db` adalah `pg.Pool` bawaan: **10 koneksi**, penunggu antre SELAMANYA.
 * `db.transaction()` memegang satu koneksi sampai commit. `PUT /menu/urutan`
 * menjalankan satu UPDATE PER BARIS di dalam transaksi, jadi panjang lariknya
 * — yang ditentukan PENGIRIM — menentukan berapa lama koneksi itu ditahan.
 *
 * Diukur terhadap server sungguhan, sebelum batasnya dipasang:
 *
 *     N=1      13 ms        N=5.000     0,82 dtk
 *     N=100    38 ms        N=20.000    2,94 dtk
 *     N=1.000  242 ms       N=28.000    ~4,4 dtk   (langit batas badan 2 MB)
 *
 * …dan yang benar-benar merusak bukan lambatnya permintaan itu sendiri,
 * melainkan apa yang terjadi pada SEMUA permintaan lain. Sepuluh permintaan
 * serentak menahan kesepuluh koneksi kolam sekaligus:
 *
 *     GET /menu saat senggang        :  0,009 dtk
 *     GET /menu saat kesepuluhnya jalan : 20,07 dtk   ← 2.200×
 *     GET /menu sesudah semuanya usai:  0,009 dtk
 *
 * Rutenya, menurut komentarnya sendiri, "boleh diakses SEMUA PERAN (termasuk
 * kasir)". Jadi satu akun kasir mana pun bisa membuat seluruh server berhenti
 * menjawab selama ia mau, tanpa satu pun galat tercatat.
 *
 * ATURANNYA SUDAH ADA — itu yang membuat temuan ini berbentuk sama dengan
 * yang lain di repo ini. Sepuluh dari delapan belas larik sudah membawa
 * `.max()`, dan angka-angkanya sudah mapan: 2000 untuk daftar uuid panjang,
 * 500 untuk daftar id, 100 untuk daftar cabang, 200/1000 untuk baris bulk.
 * Dua di antaranya bahkan tinggal di BERKAS YANG SAMA dengan larik yang
 * telanjang. Yang kurang bukan pemikirannya, melainkan pemasangannya di
 * pintu-pintu saudaranya.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * `z` dan `.array(` boleh dipisah SPASI ATAU BARIS BARU.
 *
 * Versi pertama uji ini memakai `/z\.array\s*\(/` — `z` dan titiknya harus
 * bersebelahan. Prettier memformat skema yang panjang sebagai:
 *
 *     items: z
 *       .array(
 *         z.object({ … }),
 *       )
 *
 * …dan bentuk itu TAK TERLIHAT sama sekali. Diukur saat lubangnya ketemu:
 * gerbangnya membaca **18** larik sementara populasi sebenarnya **39** — buta
 * terhadap 21, termasuk seluruh larik di `penjualan`, `produksi`, `sync`, dan
 * `transfer`, yaitu jalur tulis tersibuk di server ini.
 *
 * Itu kelas kegagalan yang lebih buruk daripada bug yang dijaganya: gerbang
 * yang menyatakan "semua sudah berbatas" atas 46% populasinya membuat orang
 * berhenti mencari. Uji "PASANGAN: pemindainya melihat SELURUH populasi" di
 * bawah memaku angkanya supaya kebutaan itu tak bisa kembali diam-diam.
 */
const POLA_ARRAY = /z\s*\.\s*array\s*\(/g;

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Isi kurung seimbang mulai dari `(` di posisi i. */
function seimbang(s: string, i: number): { isi: string; tutup: number } {
  let dalam = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === "(") dalam += 1;
    else if (s[j] === ")") {
      dalam -= 1;
      if (dalam === 0) return { isi: s.slice(i + 1, j), tutup: j };
    }
  }
  return { isi: "", tutup: i };
}

interface Larik {
  file: string;
  baris: number;
  rantai: string;
}

function semuaLarik(): Larik[] {
  const keluar: Larik[] = [];
  for (const p of berkasTs(SRC)) {
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(POLA_ARRAY)) {
      const { tutup } = seimbang(s, m.index! + m[0].length - 1);
      // rantai method sesudah z.array(...) — .min(1).max(500).optional() dst
      const rantai = /^((?:\s*\.\w+\([^()]*\))*)/.exec(s.slice(tutup + 1, tutup + 120))![1];
      keluar.push({
        file: p.slice(SRC.length + 1),
        baris: s.slice(0, m.index!).split("\n").length,
        rantai: rantai.replace(/\s+/g, ""),
      });
    }
  }
  return keluar;
}

/**
 * Larik yang SENGAJA tanpa batas, dengan alasannya. Kosong hari ini — dan
 * kalau kelak terisi, tiap barisnya harus menyebut kenapa panjangnya tak bisa
 * dibatasi, bukan sekadar bahwa ia belum dibatasi.
 */
const DIKECUALIKAN: { potongan: string; kenapa: string }[] = [];

describe("larik badan permintaan selalu berbatas atas", () => {
  const larik = semuaLarik();

  it("premis: pemindainya benar-benar menemukan lariknya", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat seluruh uji hijau tanpa
    // memeriksa satu larik pun.
    expect(larik.length).toBeGreaterThan(10);
    expect(larik.some((l) => l.rantai.includes(".max("))).toBe(true);
  });

  it("PASANGAN: pemindainya melihat SELURUH populasi, bukan sebagiannya", () => {
    /*
     * Angka ini dipatok karena kebutaan sudah pernah terjadi: regex yang
     * menuntut `z` dan `.array(` bersebelahan hanya melihat 18 dari 39, dan
     * gerbangnya lalu menyatakan "semua berbatas" atas 46% populasinya.
     *
     * Perbandingan dengan pola SEMPIT-nya itulah yang menjaga — bukan angka
     * mutlaknya, yang memang akan tumbuh seiring skema baru. Yang tak boleh
     * kembali: pemindai yang melewatkan bentuk multi-baris.
     */
    const sempit = /z\.array\s*\(/g;
    let n = 0;
    for (const p of berkasTs(SRC)) n += (readFileSync(p, "utf8").match(sempit) ?? []).length;
    expect(
      larik.length,
      "pemindainya kembali buta terhadap bentuk `z\\n  .array(` yang dipakai " +
        "prettier untuk skema panjang — persis kebutaan yang membuatnya dulu " +
        "hanya melihat 18 dari 39",
    ).toBeGreaterThan(n);
  });

  it("INTI: tiap z.array punya .max(), kecuali yang disebut namanya", () => {
    const telanjang = larik
      .filter((l) => !l.rantai.includes(".max("))
      .filter((l) => !DIKECUALIKAN.some((d) => `${l.file}:${l.baris}`.includes(d.potongan)))
      .map((l) => `${l.file}:${l.baris}  z.array(…)${l.rantai}`);
    expect(
      telanjang,
      "larik ini panjangnya ditentukan PENGIRIM dan tak berbatas. Bila ia " +
        "menggerakkan kueri per baris di dalam transaksi, satu permintaan bisa " +
        "menahan 1 dari 10 koneksi kolam berlama-lama — diukur 20 detik untuk " +
        "SELURUH server. Tambahkan `.max(n)`; angka yang sudah mapan di repo " +
        "ini: 2000 daftar uuid panjang, 500 daftar id, 100 daftar cabang, " +
        "200/1000 baris bulk",
    ).toEqual([]);
  });

  it("daftar pengecualiannya masih cocok dengan sumbernya", () => {
    // Pengecualian yang sumbernya sudah pindah/hilang diam-diam melebar.
    for (const d of DIKECUALIKAN) {
      expect(
        larik.some((l) => `${l.file}:${l.baris}`.includes(d.potongan)),
        `pengecualian tak lagi cocok dengan larik mana pun: ${d.potongan}`,
      ).toBe(true);
    }
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak salah menuduh", () => {
    /*
     * Tanpa pasangan ini, "daftar pelanggar kosong" juga hijau seandainya
     * pembaca rantainya kelak cocok dengan apa pun — hijau yang tak menjaga
     * apa-apa. Keempat bentuk di bawah semuanya sungguhan dipakai di repo ini.
     */
    const rantai = (kode: string) => {
      const m = /z\.array\s*\(/.exec(kode)!;
      const { tutup } = seimbang(kode, m.index + m[0].length - 1);
      return /^((?:\s*\.\w+\([^()]*\))*)/.exec(kode.slice(tutup + 1))![1].replace(/\s+/g, "");
    };
    expect(rantai("z.array(z.string().uuid())").includes(".max(")).toBe(false);
    expect(rantai("z.array(z.string().uuid()).max(2000).optional()").includes(".max(")).toBe(true);
    expect(rantai("z.array(ItemBody).min(1).max(MAKS_ITEM)").includes(".max(")).toBe(true);
    // …dan larik BERSARANG tak membuat pembacanya tersesat ke rantai yang salah
    expect(rantai("z.array(z.object({ a: z.array(z.string()) })).max(200)").includes(".max(")).toBe(
      true,
    );
  });
});
