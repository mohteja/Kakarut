import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BahanDto } from "@kakarut/shared";
import {
  buatCsvBahan,
  deteksiPemisah,
  keRowsImpor,
  namaPemisah,
  parseCsv,
} from "../../web/src/lib/bahanCsv";

/**
 * Penjaga PEMISAH KOLOM CSV.
 *
 * Excel menulis CSV memakai "list separator" milik Windows, dan pada Windows
 * berbahasa Indonesia itu TITIK KOMA — konsekuensi dari pemisah desimal yang
 * koma. Artinya alur paling lumrah di aplikasi ini,
 *
 *     Unduh template → buka di Excel → sunting → Simpan Sebagai CSV
 *
 * menghasilkan berkas ber-titik-koma. Dulu berkas seperti itu terbaca sebagai
 * SATU kolom: `indexOf("nama")` gagal, impor berhenti, dan pesannya berbunyi
 * "pastikan ada kolom 'nama' berisi data" — padahal kolom `nama` jelas-jelas
 * ada di layar pemakainya. Petunjuk yang menyesatkan lebih buruk daripada tak
 * ada petunjuk: pemakainya memeriksa hal yang memang sudah benar, lalu
 * menyerah dan mengetik ratusan bahan satu per satu.
 *
 * PRINSIPNYA: ketat saat menulis, longgar saat membaca. Ekspor TETAP memakai
 * koma (RFC 4180) — itu dipatok di bawah — dan hanya impor yang jadi toleran.
 *
 * AMANNYA dari mana: pemisah ditebak dari BARIS PERTAMA saja, dan hanya di
 * LUAR kutip. Header berkas ini selalu nama kolom polos, jadi koma desimal di
 * baris data ("1,5") tak bisa memengaruhi keputusan — dan itulah yang membuat
 * penebakan ini tidak menukar satu bug dengan bug lain.
 */
const contohBahan = (ubah: Partial<BahanDto> = {}): BahanDto =>
  ({
    id: "b1",
    kode: "AMS",
    nama: "Air Mineral",
    kategori: "minuman",
    pengadaan: "beli",
    harga_beli: 50000,
    isi: 24,
    satuan: "botol",
    satuan_beli: "dus",
    stok_minimum: 5,
    min_beli: 0,
    masa_simpan_hari: 30,
    lead_time_hari: 2,
    boleh_eceran: false,
    track_stok: true,
    is_packaging: false,
    is_complement: false,
    catatan: "",
    ...ubah,
  }) as BahanDto;

describe("berkas dari Excel terbaca apa pun pemisahnya", () => {
  /** Bentuk berkas yang benar-benar keluar dari Excel/Sheets di lapangan. */
  const BENTUK: { label: string; teks: string }[] = [
    { label: "koma polos", teks: "kode,nama,isi\nAMS,Air,24" },
    { label: "BOM UTF-8 (bawaan Excel)", teks: "﻿kode,nama,isi\nAMS,Air,24" },
    { label: "CRLF (baris ala Windows)", teks: "kode,nama,isi\r\nAMS,Air,24\r\n" },
    { label: "BOM + CRLF", teks: "﻿kode,nama,isi\r\nAMS,Air,24\r\n" },
    { label: "titik koma (Excel bahasa Indonesia)", teks: "kode;nama;isi\r\nAMS;Air;24\r\n" },
    { label: "tab (tempel langsung dari Excel)", teks: "kode\tnama\tisi\nAMS\tAir\t24" },
  ];

  for (const { label, teks } of BENTUK) {
    it(`${label} → 3 kolom, 1 baris bahan`, () => {
      const tabel = parseCsv(teks);
      expect(tabel[0], `header ${label} tak terpecah jadi kolom`).toHaveLength(3);
      const hasil = keRowsImpor(tabel);
      expect(hasil.rows).toHaveLength(1);
      expect(hasil.rows[0].nama).toBe("Air");
      expect(hasil.rows[0].isi).toBe(24);
    });
  }

  it("keenam bentuk menghasilkan baris yang IDENTIK satu sama lain", () => {
    // Bukan sekadar "tidak kosong": berkas yang sama isinya harus mendarat di
    // nilai yang sama persis, dari mana pun ia disimpan.
    const semua = BENTUK.map(({ teks }) => JSON.stringify(keRowsImpor(parseCsv(teks)).rows));
    expect(new Set(semua).size, `bentuk berkas menghasilkan hasil berbeda: ${semua.join(" | ")}`).toBe(
      1,
    );
  });
});

describe("penebakan pemisah tak bisa tertipu isi baris data", () => {
  const kasus: { label: string; teks: string; harap: string }[] = [
    { label: "koma polos", teks: "kode,nama,isi\nAMS,Air,24", harap: "," },
    { label: "titik koma", teks: "kode;nama;isi\nAMS;Air;24", harap: ";" },
    { label: "tab", teks: "kode\tnama\tisi\nAMS\tAir\t24", harap: "\t" },
    {
      label: "berkoma, tapi DATA-nya penuh titik koma",
      teks: 'kode,nama,catatan\nAMS,Air,"a;b;c;d;e;f;g;h"',
      harap: ",",
    },
    {
      label: "berkoma, dengan desimal koma di data",
      teks: 'kode,nama,isi\nAMS,Air,"1,5"',
      harap: ",",
    },
    {
      label: "bertitik-koma, dengan desimal koma di data",
      teks: "kode;nama;isi\nAMS;Air;1,5",
      harap: ";",
    },
    {
      label: "header punya sel BERKUTIP berisi titik koma",
      teks: '"a;b;c;d",nama,isi\nx,Air,24',
      harap: ",",
    },
    { label: "satu kolom saja", teks: "nama\nAir", harap: "," },
    { label: "berkas kosong", teks: "", harap: "," },
  ];

  for (const { label, teks, harap } of kasus) {
    it(`${label} → ${JSON.stringify(harap)}`, () => {
      expect(deteksiPemisah(teks.replace(/\r\n?/g, "\n"))).toBe(harap);
    });
  }

  it("seri / tak ada kandidat selalu jatuh ke koma", () => {
    // Aturan jatuh-balik yang membuat perbaikan ini mustahil merusak berkas
    // yang hari ini sudah terbaca benar.
    expect(deteksiPemisah("a,b;c")).toBe(",");
    expect(deteksiPemisah("hanyasatu")).toBe(",");
  });

  it("hanya baris PERTAMA yang dipakai menebak — titik koma DI DALAM kutip", () => {
    const teks = "kode,nama\nAMS,\"x;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;\"";
    expect(deteksiPemisah(teks)).toBe(",");
  });

  it("hanya baris PERTAMA yang dipakai menebak — titik koma TANPA kutip", () => {
    // Kasus inilah yang benar-benar menguji batas baris, dan ia BUKAN karangan:
    // `selCsv` hanya mengutip sel yang memuat koma/kutip/baris-baru, jadi
    // `catatan` bernilai "pagi;sore" diekspor TANPA kutip. Berkas ekspor yang
    // sah bisa memuat lebih banyak titik koma daripada koma — dan kalau
    // penebakan menghitung seluruh berkas, berkas buatan aplikasi ini sendiri
    // akan salah dibaca.
    //
    // Versi pertama uji ini melewatkan hal itu: kedua kasus "baris data"-nya
    // menaruh titik koma di dalam kutip, jadi yang menyelamatkannya adalah
    // aturan kutip, bukan aturan baris. Injeksi yang membuang batas baris pun
    // tetap hijau — hijau yang tak membuktikan apa pun.
    const teks = "kode,nama,catatan\nAMS,Air,a;b;c;d;e;f";
    expect(deteksiPemisah(teks)).toBe(",");
  });

  it("berkas ekspor sungguhan dengan banyak titik koma tetap terbaca sebagai koma", () => {
    const csv = buatCsvBahan([
      contohBahan({ kode: "A1", catatan: "pagi;sore;malam" }),
      contohBahan({ id: "b2", kode: "A2", nama: "Gula", catatan: "senin;selasa;rabu;kamis" }),
    ]);
    expect(csv, "premis: catatan bertitik-koma memang diekspor TANPA kutip").toContain(
      ",pagi;sore;malam",
    );
    expect(deteksiPemisah(csv)).toBe(",");
    expect(keRowsImpor(parseCsv(csv)).rows).toHaveLength(2);
  });
});

describe("ekspor tetap berkoma — longgar membaca, ketat menulis", () => {
  it("berkas ekspor memakai koma dan terbaca balik sebagai koma", () => {
    const csv = buatCsvBahan([contohBahan()]);
    expect(csv.split("\n")[0]).toContain("kode,nama,kategori");
    expect(deteksiPemisah(csv)).toBe(",");
  });

  it("ronde ekspor→impor utuh, termasuk sel bertitik-koma & berkoma", () => {
    // Kalau penebakan pemisah salah membaca berkas ekspornya sendiri, seluruh
    // fitur ini rusak di jalur yang paling sering dipakai.
    const csv = buatCsvBahan([contohBahan({ nama: "Air, Mineral", catatan: "pagi;sore" })]);
    const balik = keRowsImpor(parseCsv(csv, deteksiPemisah(csv)));
    expect(balik.rows[0].nama).toBe("Air, Mineral");
    expect(balik.rows[0].catatan).toBe("pagi;sore");
    expect(balik.rows[0].harga_beli).toBe(50000);
  });
});

describe("layar impor memakai pemisah yang sama dengan yang diberitakannya", () => {
  const MODAL = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/bahan/ImporBahanModal.tsx", import.meta.url)),
    "utf8",
  );

  it("ditebak SEKALI lalu dipakai mem-parse — bukan ditebak dua kali", () => {
    // Menebak ulang untuk tampilan membuka celah yang mustahil dilihat:
    // angka yang tertulis di layar bisa berasal dari tebakan yang berbeda
    // dengan yang benar-benar dipakai membaca berkasnya.
    expect(MODAL).toContain("const sep = deteksiPemisah(");
    expect(MODAL).toContain("parseCsv(teks, sep)");
    expect(MODAL.split("deteksiPemisah(").length - 1, "deteksiPemisah dipanggil lebih dari sekali").toBe(
      1,
    );
  });

  it("pesan gagal menyebut pemisah DAN jumlah kolom, bukan menyuruh cek 'nama'", () => {
    // Pesan lama menyuruh memeriksa kolom yang biasanya sudah benar. Yang
    // berguna adalah memberi tahu berkasnya dibaca sebagai apa.
    expect(MODAL).toContain("namaPemisah(sep)");
    expect(MODAL).toContain("kolom");
    expect(
      MODAL,
      "pesan lama yang menyesatkan masih ada",
    ).not.toContain("pastikan ada kolom 'nama' berisi data.");
  });

  it("ringkasan menyebut pemisah HANYA bila bukan koma", () => {
    // Menyebutnya tiap kali cuma bising: koma memang yang diharapkan.
    expect(MODAL).toContain('{pemisah !== "," && <>');
    expect(MODAL).toContain("namaPemisah(pemisah)");
  });

  it("namaPemisah memberi nama yang bisa dibaca orang", () => {
    expect(namaPemisah(";")).toBe("titik koma (;)");
    expect(namaPemisah("\t")).toBe("tab");
    expect(namaPemisah(",")).toBe("koma (,)");
  });
});
