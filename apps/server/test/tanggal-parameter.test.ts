import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga DUA ATURAN TANGGAL DI SISI SERVER.
 *
 * Keduanya sudah dipatuhi hampir di mana-mana — dan justru itu masalahnya.
 * Satu penangan yang menyimpang tak terlihat sebagai apa pun: ia bersebelahan
 * dengan tiga saudaranya yang benar, di berkas yang sama, dan tak ada yang
 * membandingkan. `/laporan/bep` melanggar KEDUANYA sekaligus.
 *
 * ATURAN 1 — zona waktu selalu dari perusahaan.
 *
 * `tanggalDi("Asia/Jakarta")` mematok zona, padahal `companies.timezone` ada
 * dan dipakai 20+ tempat lain. Untuk cabang WITA/WIT, "hari ini" versi Jakarta
 * MASIH KEMARIN selama satu sampai dua jam sesudah tengah malam setempat. Di
 * `/bep` itu menggeser seluruh jendela 30 hari sehari penuh — termasuk
 * penjualan yang baru saja terjadi — dan hasilnya cuma "angka BEP-nya agak
 * lain", tanpa satu pun tanda bahwa rentangnya salah.
 *
 * Karena itu yang dipatok BUKAN "ada kata timezone" melainkan: argumen pertama
 * `tanggalDi` tak boleh berupa literal string. Zona harus datang dari suatu
 * nilai — apa pun namanya — bukan dari yang diketik di tempat.
 *
 * ATURAN 2 — tanggal dari query disaring sebelum menyentuh SQL.
 *
 * `dari`/`sampai`/`tanggal` mendarat di pembanding kolom `date` Postgres, atau
 * di `new Date(`${dari}T00:00:00Z`)`. Teks yang bukan tanggal tidak ditolak
 * rapi dengan 400; ia menjatuhkan permintaannya. Tiga tempat melewatkan
 * saringan ini, dan salah satunya — `rekomendasi` — punya penyaringnya berdiri
 * DUA BARIS di atas, terpakai untuk sepasang parameter di bawahnya saja.
 */
const akar = fileURLToPath(new URL("../src/", import.meta.url));

function semuaTs(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTs(p + "/"));
    else if (nama.endsWith(".ts")) hasil.push(p);
  }
  return hasil;
}

const BERKAS = semuaTs(akar);

describe("tanggal server: zona dari perusahaan, query disaring", () => {
  it("berkas sumber server terbaca (penjaga ini tak boleh kosong)", () => {
    // Tanpa ini, salah ketik pada `akar` membuat kedua aturan lulus diam-diam.
    expect(BERKAS.length).toBeGreaterThan(30);
  });

  it("tanggalDi() tak pernah dipanggil dengan zona literal", () => {
    const langgar: string[] = [];
    for (const p of BERKAS) {
      const isi = readFileSync(p, "utf8");
      // Argumen pertama diawali kutip = literal zona yang dipatok di tempat.
      for (const m of isi.matchAll(/\btanggalDi\(\s*["'`]/g)) {
        const baris = isi.slice(0, m.index).split("\n").length;
        langgar.push(`${p.slice(akar.length)}:${baris}`);
      }
    }
    expect(langgar).toEqual([]);
  });

  it("dari/sampai/tanggal dari query selalu lewat penyaring", () => {
    /**
     * Bentuk yang sah ada beberapa dan semuanya diterima, karena yang penting
     * adalah nilainya tersaring — bukan ejaan penyaringnya:
     *
     *   tglValid(c.req.query("dari"))          — pembungkus langsung
     *   tgl(c.req.query("dari"))
     *   const dari = c.req.query("dari"); if (dari && RE.test(dari)) …
     *   const tanggalQ = c.req.query("tanggal"); if (…) throw 400
     *
     * Jadi yang diperiksa: setiap `c.req.query("<tanggal>")` harus DIBUNGKUS
     * penyaring, atau nama yang menampungnya diperiksa di baris-baris dekatnya.
     */
    const NAMA = ["dari", "sampai", "tanggal"];
    const langgar: string[] = [];
    for (const p of BERKAS) {
      const isi = readFileSync(p, "utf8");
      const baris = isi.split("\n");
      for (const nama of NAMA) {
        const pola = new RegExp(`c\\.req\\.query\\("${nama}"\\)`, "g");
        for (const m of isi.matchAll(pola)) {
          const iBaris = isi.slice(0, m.index).split("\n").length - 1;
          // Jendela mundur DUA baris juga: penyaringnya kerap berdiri lebih
          // dulu, dan pemakaiannya menyusul di cabang ternary di bawahnya —
          // `? c.req.query("sampai")!` pada baris berikutnya bukan pemakaian
          // mentah, ia sudah dijaga baris di atasnya.
          const sekitar = baris.slice(Math.max(0, iBaris - 2), iBaris + 6).join("\n");
          /**
           * Penyaringnya harus mengenai PARAMETER INI, bukan sekadar berdiri
           * di dekatnya.
           *
           * Versi kedua penjaga ini cuma mencari "ada penyaring di sekitar",
           * dan itu melubanginya tepat di salah satu dari tiga cacat aslinya:
           *
           *     dari: c.req.query("dari") ?? undefined,      ← mentah
           *     sampai: c.req.query("sampai") ?? undefined,  ← mentah
           *     pakaiDari: tgl(c.req.query("pakai_dari")),   ← tetangganya
           *
           * `tgl(` milik baris ketiga membuat dua baris di atasnya tampak
           * terjaga. Saya baru melihatnya karena ketiga cacat asli ditanam
           * ulang SESUDAH penjaganya dilonggarkan — kalau hanya menanam satu,
           * lubang ini lolos dan kelasnya terlanjur dilaporkan beres.
           */
          const namaKutip = nama.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const dibungkus = new RegExp(
            `(tglValid|tgl|tanggalValid|TANGGAL_RE\\.test|\\.test)\\(\\s*c\\.req\\.query\\("${namaKutip}"\\)`,
          ).test(sekitar);
          /**
           * Ditampung dulu lalu diperiksa beberapa baris kemudian. Bentuknya
           * bermacam-macam dan semuanya sah:
           *
           *   if (dari && /^\d{4}-\d{2}-\d{2}$/.test(dari)) …   ← regex sebaris
           *   dariQ && tanggalValid.test(dariQ) ? dariQ : …      ← regex bernama
           *   if (!tanggalValid(tanggalQ)) throw 400             ← fungsi
           *
           * Versi pertama penjaga ini cuma mencari `NAMA(`, jadi `NAMA.test(`
           * — dua dari tiga bentuk di atas — dilaporkan sebagai pelanggaran.
           * Dua berkas yang sudah BENAR jadi merah, dan kalau saya percaya
           * begitu saja, "perbaikannya" akan mengubah kode yang tak rusak.
           * Yang dicari sekarang tandanya: pola tanggal, `.test(`, atau
           * penolakan 400 — bukan satu ejaan pemanggilan.
           */
          const ditampung = new RegExp(
            `const\\s+(\\w+)\\s*=\\s*c\\.req\\.query\\("${namaKutip}"\\)`,
          ).exec(baris[iBaris]);
          const diperiksa =
            ditampung != null &&
            // Nama penampungnya sendiri yang harus diuji di sekitarnya —
            // `RE.test(dariQ)`, `tanggalValid(dariQ)`, atau `dariQ && …`.
            new RegExp(`(\\.test\\(\\s*${ditampung[1]}|\\w+\\(\\s*${ditampung[1]}\\s*\\)|\\b${ditampung[1]}\\s*&&)`).test(
              sekitar.replace(baris[iBaris], ""),
            );
          if (!dibungkus && !diperiksa) {
            langgar.push(`${p.slice(akar.length)}:${iBaris + 1} — query("${nama}")`);
          }
        }
      }
    }
    expect(langgar).toEqual([]);
  });
});
