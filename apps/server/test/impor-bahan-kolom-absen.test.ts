import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga IMPOR BAHAN: kolom yang tak dikirim tak boleh ditulis.
 *
 * Sisi web-nya diuji betulan di `bahan-csv.test.ts` (fungsinya dipanggil).
 * Yang dijaga di sini adalah separuh sisanya, yang butuh Postgres untuk
 * dijalankan: bahwa server MASIH BISA membedakan "tidak dikirim" dari
 * "dikirim bernilai nol/mati", dan memakai bedanya.
 *
 * Rantainya utuh hanya bila ketiganya benar sekaligus:
 *
 *   1. `keRowsImpor` tak memasang kunci untuk kolom yang absen   (bahan-csv)
 *   2. zod tak mengisinya dengan `.default()` sebelum rute lihat (di sini)
 *   3. `.set()` hanya menulis field yang `!== undefined`         (di sini)
 *
 * Satu saja putus, seluruh perbaikannya lenyap tanpa jejak: yang mengimpor
 * daftar harga `nama,harga_beli` kembali menimpa `isi`, `satuan`, `kategori`,
 * `kemasan`, dan `stok_minimum` SETIAP bahan yang cocok — dengan spanduk
 * hijau "✅ Impor selesai" di layar. Kelas kegagalan yang sama dengan
 * `PUT /open-bill/:id` dan `PUT /menu/:id`: penulisan yang menghapus kolom
 * yang tak pernah dikelola pengirimnya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const RUTE = baca("../src/modules/bahan/routes.ts");
const MODAL = baca("../../web/src/pages/bahan/ImporBahanModal.tsx");

/** Potongan `POST /import` saja, supaya penjaganya tak salah alamat. */
const iImpor = RUTE.indexOf('.post("/import", requireRole(');
const IMPOR = RUTE.slice(iImpor, RUTE.indexOf('.put(\n    "/:id"', iImpor));

/** Definisi badan barisnya saja. */
const iBody = RUTE.indexOf("const BahanImportRowBody = z.object({");
const BODY = RUTE.slice(iBody, RUTE.indexOf("});", iBody));

describe("penjaganya sendiri menunjuk ke tempat yang benar", () => {
  // Kalau salah satu batas tak ketemu, `slice` memulangkan potongan yang salah
  // (atau seluruh berkas) dan SEMUA penjaga di bawah lulus tanpa arti.
  it("blok `POST /import` benar-benar terisolasi", () => {
    expect(iImpor).toBeGreaterThan(0);
    expect(RUTE.indexOf('.put(\n    "/:id"', iImpor)).toBeGreaterThan(iImpor);
    expect(IMPOR.length).toBeLessThan(RUTE.length / 2);
    expect(IMPOR).toContain("const { mode, items } = c.req.valid(\"json\");");
    expect(IMPOR).not.toContain("BahanPatchBody");
  });
});

describe("zod: absen tetap absen sampai ke rutenya", () => {
  it("tak ada `.default()` satu pun di badan baris impor", () => {
    // `.default()` mengisi nilainya SEBELUM rute sempat melihat — sesudah itu
    // "tidak dikirim" dan "dikirim bernilai default" jadi tak terbedakan.
    expect(iBody, "BahanImportRowBody tak ditemukan").toBeGreaterThan(0);
    expect(BODY).not.toContain(".default(");
  });

  it("field yang dulu ber-default kini `.optional()`", () => {
    for (const f of [
      "kategori",
      "jenis",
      "harga_beli",
      "isi",
      "satuan",
      "stok_minimum",
      "min_beli",
      "boleh_eceran",
      "lacak_stok",
      "kemasan",
      "complement",
      "masa_simpan_hari",
      "lead_time_hari",
    ]) {
      expect(BODY, `field ${f} tak lagi opsional`).toMatch(
        new RegExp(`${f}:[^\\n]*\\.optional\\(\\)`),
      );
    }
  });

  it("`nama` tetap WAJIB — tanpa itu tak ada yang bisa dicocokkan", () => {
    expect(BODY).toContain("nama: z.string().trim().min(1),");
  });

  it("batas nilainya tak ikut longgar saat default dilepas", () => {
    // Melepas `.default()` sempat menggoda untuk sekalian melepas penjaganya.
    expect(BODY).toContain("harga_beli: z.number().nonnegative().optional(),");
    expect(BODY).toContain("isi: z.number().positive().optional(),");
    expect(BODY).toContain("masa_simpan_hari: z.number().int().min(0).max(3650).optional(),");
    expect(BODY).toContain("lead_time_hari: z.number().int().min(0).max(365).optional(),");
  });
});

describe("update: hanya menulis kolom yang benar-benar dikirim", () => {
  it("tiap kolom dijaga `!== undefined`", () => {
    for (const [f, kol] of [
      ["harga_beli", "hargaBeli"],
      ["isi", "isi"],
      ["satuan", "satuan"],
      ["satuan_beli", "satuanBeli"],
      ["stok_minimum", "stokMinimum"],
      ["min_beli", "minBeli"],
      ["masa_simpan_hari", "masaSimpanHari"],
      ["lead_time_hari", "leadTimeHari"],
      ["boleh_eceran", "bolehEceran"],
      ["lacak_stok", "trackStok"],
      ["kemasan", "isPackaging"],
      ["complement", "isComplement"],
      ["catatan", "catatan"],
    ] as const) {
      expect(IMPOR, `kolom ${kol} ditulis tanpa memeriksa apakah dikirim`).toContain(
        `...(b.${f} !== undefined && { ${kol}:`,
      );
    }
    expect(IMPOR).toContain("...(b.kategori !== undefined && { kategori: kanonikKategori(");
  });

  it("dijaga `!== undefined`, BUKAN truthiness", () => {
    // `b.kemasan && {…}` akan diam-diam berhenti mematikan kemasan, dan
    // `b.harga_beli && {…}` membuat harga 0 tak bisa disimpan. Nol dan `false`
    // adalah nilai yang sah di sini.
    expect(IMPOR).not.toMatch(/\.\.\.\(b\.(kemasan|complement|lacak_stok|boleh_eceran) &&/);
    expect(IMPOR).not.toMatch(/\.\.\.\(b\.(harga_beli|isi|stok_minimum|min_beli) &&/);
  });

  it("`nama` tetap ditulis tanpa syarat — barisnya memang dicocokkan lewat itu", () => {
    expect(IMPOR).toContain("nama: b.nama,");
  });

  it("pulih dari Tempat Sampah tak ikut terganggu", () => {
    expect(IMPOR).toContain("...(u.pulih && { isActive: true }),");
  });
});

describe("insert: bahan BARU tetap dapat nilai bawaan", () => {
  it("defaultnya ditulis eksplisit, tak lagi menumpang zod", () => {
    for (const d of [
      "hargaBeli: b.harga_beli ?? 0,",
      "isi: b.isi ?? 1,",
      'satuan: b.satuan ?? "pcs",',
      "trackStok: b.lacak_stok ?? true,",
      "stokMinimum: b.stok_minimum ?? 0,",
      "minBeli: b.min_beli ?? 0,",
      "masaSimpanHari: b.masa_simpan_hari ?? 0,",
      "leadTimeHari: b.lead_time_hari ?? 0,",
      'kategori: kanonikKategori(kmap, b.kategori ?? "lain"),',
      'pengadaan: b.jenis ?? "beli",',
      "bolehEceran: b.boleh_eceran ?? false,",
      "isPackaging: b.kemasan ?? false,",
      "isComplement: b.complement ?? false,",
    ]) {
      expect(IMPOR, `default insert hilang: ${d}`).toContain(d);
    }
  });

  it("premis: `harga_beli` & `isi` memang NOT NULL tanpa default di DB", () => {
    // Kalau salah satu default insert di atas hilang, yang terjadi bukan
    // "nilainya kosong" melainkan barisnya GAGAL — dan impornya melaporkan
    // baris gagal, bukan menulis data separuh. Dicatat supaya jelas kenapa
    // default insert wajib eksplisit.
    const schema = baca("../src/db/schema.ts");
    const i = schema.indexOf('export const ingredients = pgTable(');
    const blok = schema.slice(i, i + 3000);
    expect(blok).toContain(
      'hargaBeli: numeric("harga_beli", { precision: 14, scale: 2, mode: "number" }).notNull(),',
    );
    expect(blok).toContain(
      'isi: numeric("isi", { precision: 12, scale: 4, mode: "number" }).notNull(),',
    );
  });
});

describe("layar: kolom yang hilang disebut sebelum tombolnya ditekan", () => {
  // Kondisinya dipatok UTUH, bukan sepotong: `toContain("kolomHilang.length
  // > 0")` masih lulus kalau seseorang menambahkan `{false && …}` di depannya
  // untuk "sementara mematikan panelnya".
  it("daftar kolomnya ditampilkan apa adanya", () => {
    expect(MODAL).toContain("{terbaca && terbaca.kolomHilang.length > 0 && (");
    expect(MODAL).toContain("terbaca.kolomHilang.join(\", \")");
  });

  it("kalimatnya menyebut akibatnya, bukan sekadar 'ada kolom hilang'", () => {
    expect(MODAL).toContain("dibiarkan apa adanya");
    expect(MODAL).toContain("tidak dikosongkan");
  });

  it("baris ber-`isi` nol juga disebut, dengan sebabnya", () => {
    expect(MODAL).toContain("{terbaca && terbaca.isiTakMasukAkal > 0 && (");
    expect(MODAL).toContain("pembagi harga");
  });
});
