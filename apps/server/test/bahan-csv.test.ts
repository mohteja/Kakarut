import { describe, expect, it } from "vitest";
import type { BahanDto } from "@kakarut/shared";
import { buatCsvBahan, keRowsImpor, parseCsv } from "../../web/src/lib/bahanCsv";

/**
 * Penjaga CSV BAHAN BAKU: ekspor → impor harus UTUH.
 *
 * Ekspor dan impor di berkas ini adalah sepasang, dan dulu tidak sepakat.
 * Ekspor menulis lewat `String(n)`; impor mengenali pemisah ribuan dari grup
 * TIGA angka — dan pecahan tiga digit adalah grup tiga angka:
 *
 *     String(0.125) → "0.125" → keAngka → 125      ← 1000× lebih besar
 *     String(1.375) → "1.375" → keAngka → 1375
 *
 * Jadi ronde ekspor → impor TANPA menyentuh satu sel pun sudah merusak data.
 * Bentuk kegagalannya yang paling pahit: pemilik menekan Ekspor untuk
 * mencadangkan, lalu Impor untuk memulihkan — dan justru pemulihannya yang
 * menghancurkan. Vanili 0,125 kg jadi 125 kg, stok bernilai puluhan juta
 * muncul dari ketiadaan, dan tak ada satu pun galat di layar.
 *
 * Cacat KEDUA, berdiri sendiri dan tak butuh ekspor sama sekali: petugas yang
 * mengetik "0,125" langsung di Excel juga mendapat 125, karena pola ribuannya
 * dulu menerima nol telanjang sebagai grup pertama. Tak ada pemisah ribuan
 * yang mengikuti "0" — itu yang kini disyaratkan.
 */
function bahan(p: Partial<BahanDto>): BahanDto {
  return {
    id: "x",
    kode: "K",
    nama: "Bahan",
    kategori: "bahan",
    pengadaan: "beli",
    harga_beli: 1000,
    isi: 1,
    satuan: "pcs",
    satuan_beli: "pcs",
    stok_minimum: 0,
    min_beli: 0,
    masa_simpan_hari: 0,
    lead_time_hari: 0,
    boleh_eceran: false,
    track_stok: true,
    is_packaging: false,
    is_complement: false,
    catatan: "",
    ...p,
  } as BahanDto;
}

/** Kolom angka yang bolak-balik lewat CSV. */
const ANGKA = [
  "harga_beli",
  "isi",
  "stok_minimum",
  "min_beli",
  "masa_simpan_hari",
  "lead_time_hari",
] as const;

/** Satu bahan → CSV → kembali jadi baris impor. */
function rondeLaju(b: BahanDto) {
  const rows = keRowsImpor(parseCsv(buatCsvBahan([b]))).rows;
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as Record<string, unknown>;
}

/** Baca satu sel angka dari CSV yang diketik tangan. */
function ketik(teks: string): number {
  const rows = keRowsImpor(parseCsv(`nama,stok_minimum\nB,"${teks}"`)).rows;
  const v = rows[0].stok_minimum;
  // Kolomnya ADA di header, jadi nilainya wajib ikut terkirim — beda dengan
  // kolom yang absen, yang justru harus hilang (lihat blok "kolom absen").
  expect(v, "kolom yang ada di header wajib ikut terkirim").not.toBeUndefined();
  return v as number;
}

describe("CSV bahan: ekspor → impor tanpa disentuh = utuh", () => {
  // Pecahan TEPAT tiga digit adalah satu-satunya bentuk yang bertabrakan
  // dengan pola ribuan — dan justru bentuk itu yang dulu tak diuji.
  const KASUS: Array<[string, Partial<BahanDto>]> = [
    ["bulat semua (bentuk paling lazim)", { harga_beli: 50000, isi: 25, stok_minimum: 5 }],
    ["pecahan tiga digit", { isi: 0.125, stok_minimum: 0.125 }],
    ["pecahan tiga digit, bagian bulat terisi", { isi: 1.375, stok_minimum: 123.456 }],
    ["pecahan satu digit", { isi: 2.5, stok_minimum: 0.5 }],
    ["pecahan panjang", { isi: 1.2345, stok_minimum: 0.001 }],
    ["harga pecahan", { harga_beli: 12500.75, isi: 1 }],
  ];

  for (const [nama, p] of KASUS) {
    it(nama, () => {
      const asal = bahan(p);
      const balik = rondeLaju(asal);
      for (const k of ANGKA) {
        expect(balik[k], `${nama} · kolom ${k}`).toBe(asal[k]);
      }
    });
  }

  it("berkas ekspor yang isinya bulat semua tidak berubah bentuknya", () => {
    // Perbaikan ini tak boleh mengubah rupa berkas yang sudah beredar: hanya
    // nilai PECAHAN yang ditulis ulang. Bila tidak, tiap ekspor tampak seperti
    // perubahan besar dan orang berhenti mempercayainya.
    const csv = buatCsvBahan([
      bahan({ kode: "A", nama: "Beras", harga_beli: 50000, isi: 25, stok_minimum: 5 }),
    ]);
    expect(csv.split("\n")[1]).toBe(
      "A,Beras,bahan,beli,50000,25,pcs,pcs,5,0,0,0,tidak,ya,tidak,tidak,",
    );
  });
});

/**
 * KOLOM YANG ABSEN ≠ KOLOM YANG DIISI NOL.
 *
 * Berkas CSV yang cuma berisi `nama,harga_beli` adalah bentuk yang paling
 * lazim dipakai memperbarui harga dari daftar supplier. Dulu tiap kolom yang
 * tak ada di berkas itu tetap dikirim ke server dengan nilai bawaannya, dan
 * mode "Perbarui semua" menuliskannya ke SETIAP bahan yang cocok:
 *
 *     isi          → 1        satu dus isi 24 jadi isi 1; HPP per botol 24×
 *     satuan       → "pcs"    satuan resep semua bahan seragam jadi pcs
 *     kategori     → "lain"   master kategori rata
 *     kemasan      → false    penanda kemasan take away padam diam-diam
 *     stok_minimum → 0        semua ambang "menipis" hilang
 *
 * Tak satu pun disebut di layar; spanduknya hijau, "✅ Impor selesai".
 *
 * Yang dijaga di sini: kolom absen tak boleh punya nilai SAMA SEKALI, supaya
 * `JSON.stringify` membuangnya dan server bisa membedakannya dari nilai yang
 * memang dikirim. Sel KOSONG pada kolom yang ADA tetap memakai fallback — itu
 * pernyataan penggunanya, bukan ketiadaan pernyataan.
 */
describe("CSV bahan: kolom yang tak ada di berkas tidak ikut terkirim", () => {
  const HARGA_SAJA = keRowsImpor(parseCsv("nama,harga_beli\nBeras,52000"));
  const baris = HARGA_SAJA.rows[0] as unknown as Record<string, unknown>;

  it("yang ada tetap terbaca", () => {
    expect(baris.nama).toBe("Beras");
    expect(baris.harga_beli).toBe(52000);
  });

  it("yang tidak ada tak punya kunci sama sekali (bukan bernilai default)", () => {
    for (const k of [
      "isi",
      "satuan",
      "kategori",
      "kemasan",
      "complement",
      "lacak_stok",
      "boleh_eceran",
      "stok_minimum",
      "min_beli",
      "masa_simpan_hari",
      "lead_time_hari",
      "satuan_beli",
      "catatan",
      "kode",
      "jenis",
    ]) {
      expect(k in baris, `kolom "${k}" tak ada di berkas, tapi ikut terkirim`).toBe(false);
    }
  });

  it("kolom yang hilang dilaporkan supaya bisa disebut di layar", () => {
    expect(HARGA_SAJA.kolomHilang).toContain("isi");
    expect(HARGA_SAJA.kolomHilang).toContain("kemasan");
    // `nama` tak pernah masuk daftar: ketiadaannya sudah menghentikan impor
    // lewat jalur lain (tak ada baris terbaca sama sekali).
    expect(HARGA_SAJA.kolomHilang).not.toContain("nama");
    expect(HARGA_SAJA.kolomHilang).not.toContain("harga_beli");
  });

  it("berkas lengkap tak melaporkan kolom hilang apa pun", () => {
    const t = keRowsImpor(parseCsv(buatCsvBahan([bahan({})])));
    expect(t.kolomHilang).toEqual([]);
  });

  it("SEL kosong pada kolom yang ADA tetap terkirim — itu pernyataan penggunanya", () => {
    const r = keRowsImpor(parseCsv("nama,satuan,catatan,min_beli\nBeras,,,")).rows[0];
    expect("satuan" in r).toBe(true);
    expect(r.satuan).toBe("pcs");
    expect(r.catatan).toBeNull();
    expect(r.min_beli).toBe(0);
  });

  it("`tidak`/`0` yang eksplisit tetap terkirim — mematikan flag lewat CSV harus bisa", () => {
    // Kalau nilai falsy ikut dibuang, kemasan/complement jadi hanya bisa
    // dinyalakan lewat CSV dan tak pernah bisa dimatikan lagi.
    const r = keRowsImpor(parseCsv("nama,kemasan,complement,min_beli\nBeras,tidak,tidak,0")).rows[0];
    expect(r.kemasan).toBe(false);
    expect(r.complement).toBe(false);
    expect(r.min_beli).toBe(0);
  });

  it("ronde ekspor → impor tetap membawa SELURUH kolom", () => {
    // Template adalah jalur yang dianjurkan; perbaikan ini tak boleh membuatnya
    // diam-diam berhenti mengatur sebagian kolom.
    const r = keRowsImpor(
      parseCsv(buatCsvBahan([bahan({ is_packaging: true })])),
    ).rows[0] as unknown as Record<string, unknown>;
    for (const k of ["isi", "satuan", "kategori", "kemasan", "complement", "lacak_stok"]) {
      expect(k in r, `template kehilangan kolom "${k}"`).toBe(true);
    }
    expect(r.kemasan).toBe(true);
  });
});

describe("CSV bahan: `isi` nol tak dikarang jadi 0,0001", () => {
  // `isi` adalah PEMBAGI harga (`harga_beli / isi`). Dulu nilai ≤ 0 dijepit ke
  // 0,0001 supaya lolos validasi server `positive()` — hasilnya harga per
  // satuan 10.000× lipat, dan itu jadi HPP setiap menu yang memakainya. Gagal
  // terang-terangan jauh lebih murah daripada angka yang salah 4 digit.
  it("nol → kolomnya dilepas & barisnya dihitung", () => {
    const t = keRowsImpor(parseCsv("nama,harga_beli,isi\nBeras,52000,0"));
    expect("isi" in t.rows[0]).toBe(false);
    expect(t.isiTakMasukAkal).toBe(1);
    // sisanya tetap terkirim — satu sel salah tak membatalkan barisnya
    expect(t.rows[0].harga_beli).toBe(52000);
  });

  it("nol yang ditulis sebagai pecahan juga", () => {
    expect(keRowsImpor(parseCsv("nama,isi\nBeras,\"0,0\"")).isiTakMasukAkal).toBe(1);
  });

  it("premis: tanda minus memang tak pernah sampai ke sini", () => {
    // `keAngka` membuang `-` bersama simbol lain, SENGAJA — supaya bentuk
    // "Rp 10.000,-" yang lazim di nota Indonesia terbaca 10000, bukan 0.
    // Efek sampingnya "-5" jadi 5, dan itu tak apa: tak ada satu pun kolom
    // di CSV ini yang bermakna negatif (harga, isi, ambang stok, jumlah hari).
    // Dicatat di sini supaya penjaga `> 0` di atas tak dikira menangani minus.
    expect(keRowsImpor(parseCsv("nama,isi\nBeras,-5")).rows[0].isi).toBe(5);
  });

  it("sel KOSONG bukan salah ketik — tetap memakai fallback 1, tak dihitung", () => {
    const t = keRowsImpor(parseCsv("nama,isi\nBeras,"));
    expect(t.rows[0].isi).toBe(1);
    expect(t.isiTakMasukAkal).toBe(0);
  });

  it("isi yang wajar lewat apa adanya", () => {
    const t = keRowsImpor(parseCsv("nama,isi\nBeras,24"));
    expect(t.rows[0].isi).toBe(24);
    expect(t.isiTakMasukAkal).toBe(0);
  });

  it("kolom `isi` yang absen tak dihitung sebagai salah ketik", () => {
    expect(keRowsImpor(parseCsv("nama,harga_beli\nBeras,1")).isiTakMasukAkal).toBe(0);
  });
});

describe("CSV bahan: angka yang diketik tangan", () => {
  it("nol telanjang bukan pemisah ribuan", () => {
    // Cacat yang berdiri sendiri: tak butuh ekspor, cukup diketik di Excel.
    expect(ketik("0,125")).toBe(0.125);
    expect(ketik("0.125")).toBe(0.125);
    expect(ketik("0,001")).toBe(0.001);
  });

  it("yang memang ribuan tetap dibaca ribuan", () => {
    // Ini yang membuat `keAngka` ada sejak awal — jangan sampai hilang.
    expect(ketik("10.000")).toBe(10000);
    expect(ketik("1.500")).toBe(1500);
    expect(ketik("1,500")).toBe(1500);
    expect(ketik("Rp 10.000")).toBe(10000);
  });

  it("desimal pendek & campuran dua pemisah tetap benar", () => {
    expect(ketik("1,5")).toBe(1.5);
    expect(ketik("2,5")).toBe(2.5);
    expect(ketik("1.234,5")).toBe(1234.5); // id-ID
    expect(ketik("1,234.5")).toBe(1234.5); // en-US
  });
});
