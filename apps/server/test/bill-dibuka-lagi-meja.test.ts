import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga "SATU MEJA DINE-IN = SATU BILL" pada jalur yang melewatinya:
 * bill yang DIBUKA KEMBALI dari papan.
 *
 * Aturannya dijaga sangat serius di dua tempat — `POST /open-bill` dan
 * `PUT /open-bill/:id` sama-sama mengunci baris mejanya (`SELECT … FOR UPDATE`)
 * sebelum memeriksa. Tapi keduanya hanya melihat bill yang `closed_at`-nya
 * masih kosong, dan ada satu jalan masuk ketiga yang tak lewat sana sama
 * sekali:
 *
 *   1. Bill A di Meja 5 DIBATALKAN (`DELETE /open-bill/A`) — seluruh barisnya
 *      bertanda `batal`, `closed_at` terisi, `sale_id` tetap null.
 *   2. Tamu baru duduk di Meja 5. Kasir membuka Bill B — DIIZINKAN, dan memang
 *      seharusnya: penjaganya hanya menghitung bill yang belum tertutup.
 *   3. Di papan, satu baris Bill A dikembalikan ke antrean ("ternyata jadi").
 *      `selaraskanTutupBill` menghidupkan A lagi (`closed_at` → null) karena
 *      barisnya tak semua `batal` lagi.
 *
 * Sesudah langkah 3, Meja 5 punya DUA bill hidup — keadaan yang seluruh
 * penguncian itu ada untuk mencegahnya, dan yang risikonya persis seperti yang
 * ditulis di `POST /open-bill`: satu bill tertinggal tak tertagih saat tamunya
 * pulang, dan kasir tak punya cara tahu sampai selisih muncul di tutup kasir.
 *
 * Ketiga langkahnya lewat tombol yang sah. Tak ada satu pun yang keliru
 * sendiri-sendiri.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const PESANAN = baca("../src/modules/pesanan/routes.ts");
const OB = baca("../src/modules/open-bill/routes.ts");

/** Isi `selaraskanTutupBill` saja — larangan di bawah tak boleh membekap berkas. */
const iFn = PESANAN.indexOf("async function selaraskanTutupBill(");
const FN = PESANAN.slice(iFn, PESANAN.indexOf("\n/** Pastikan kartunya ada", iFn));

describe("premis: begitulah dua bill bisa hidup di satu meja", () => {
  it("penjaga POST hanya menghitung bill yang BELUM tertutup", () => {
    // Karena itu Bill B sah dibuat setelah Bill A dibatalkan — ini benar, dan
    // bukan bagian yang diperbaiki.
    const post = OB.slice(OB.indexOf('.post("/"'), OB.indexOf('.put("/:id"'));
    expect(post).toContain("isNull(openBills.closedAt)");
    expect(post).toContain("FOR UPDATE");
  });

  it("dan bill yang dibatalkan MEMANG bisa hidup lagi dari papan", () => {
    // Ini juga disengaja: "dibatalkan lalu ternyata jadi" tak boleh mustahil
    // ditagih selamanya. Yang kurang bukan aturannya, melainkan akibatnya.
    expect(FN).toContain('closedAt: kartu === "batal" ? sekarang : null');
  });

  it("bill yang sudah DIBAYAR tetap tak bisa dibuka papan", () => {
    expect(FN).toContain("isNull(openBills.saleId)");
  });
});

describe("dibuka kembali ke meja yang sudah terisi → dilepas dari mejanya", () => {
  it("keadaan SEBELUM dibaca dulu — tanpa itu transisinya tak terlihat", () => {
    // `closed_at` sesudah penulisan selalu null; satu-satunya cara tahu ini
    // transisi tertutup→terbuka adalah membacanya lebih dulu.
    const iBaca = FN.indexOf("const [sebelum] = await tx");
    const iTulis = FN.indexOf(".update(openBills)");
    expect(iBaca, "pembacaan keadaan sebelum tak ditemukan").toBeGreaterThan(0);
    expect(iTulis).toBeGreaterThan(iBaca);
  });

  it("digerbang TIGA syarat — transisi, bukan batal, dan punya meja", () => {
    expect(FN).toContain('if (sebelum?.closedAt && kartu !== "batal" && sebelum.mejaId)');
  });

  it("hanya meja dine_in — takeaway memang dikecualikan dari aturannya", () => {
    // Ruang Tunggu memikul SEMUA pesanan bawa pulang cabang; melepas bill dari
    // sana akan mematikan jalur itu, bukan menjaganya.
    expect(FN).toContain('m?.tipe === "dine_in"');
  });

  it("dan hanya bila memang ADA bill lain yang hidup di meja itu", () => {
    expect(FN).toContain("lepasMeja = bentrok != null;");
    expect(FN).toContain("isNull(openBills.closedAt)");
  });

  it("dirinya sendiri dikecualikan — bill yang cuma dibuka ulang tak melepas apa-apa", () => {
    expect(FN).toContain("ne(openBills.id, billId)");
  });

  it("yang dilepas meja DAN labelnya — label itu snapshot mejanya", () => {
    expect(FN).toContain("{ mejaId: null, mejaLabel: null }");
  });

  it("pelepasan bersyarat, BUKAN penulisan tanpa syarat", () => {
    // Kalau mejanya di-null-kan tiap kali, setiap penandaan status dari papan
    // akan melepas bill dari mejanya — kerusakan yang jauh lebih besar
    // daripada yang sedang diperbaiki.
    expect(FN).toContain("...(lepasMeja ? { mejaId: null, mejaLabel: null } : {})");
    expect(FN).not.toMatch(/\.set\(\{[^}]*mejaId: null,[^}]*\}\)/);
  });

  it("dan TERCATAT — pelepasan sunyi lebih buruk daripada cacatnya", () => {
    // Kasir harus tahu kenapa bill-nya lepas, dan apa langkah berikutnya.
    expect(FN).toContain("tx.insert(pesananLogs).values(");
    expect(FN).toContain("Dibuka kembali & dilepas dari");
    expect(FN).toContain("pasang ulang mejanya dari kasir");
  });

  it("bill tetap DIBUKA — melepas meja bukan membatalkan pembukaannya", () => {
    // Inti fiturnya justru itu; menolak pembukaan akan menggagalkan tombol
    // dapur karena bentrok meja yang dapur tak bisa selesaikan.
    expect(FN).not.toMatch(/throw new HTTPException/);
  });
});

describe("jalur pemulihannya sudah ada dan sudah dijaga", () => {
  it("memasang ulang meja lewat PUT tetap ditolak bila mejanya masih terisi", () => {
    const put = OB.slice(OB.indexOf('.put("/:id"'));
    expect(put).toContain('kode: "meja_sudah_ada_bill"');
    expect(put).toContain("ne(openBills.id, id)");
  });
});

describe("kedua pemanggil mengoper konteks pencatatannya", () => {
  it("status per baris", () => {
    expect(PESANAN).toMatch(
      /kartu: await selaraskanTutupBill\(tx, id, sekarang, \{\s*\n\s*companyId: auth\.company_id!,/,
    );
  });

  it("status seluruh kartu", () => {
    expect(PESANAN).toMatch(
      /return await selaraskanTutupBill\(tx, id, sekarang, \{\s*\n\s*companyId: auth\.company_id!,/,
    );
  });

  it("tak ada lagi pemanggilan berargumen tiga", () => {
    expect(PESANAN).not.toMatch(/selaraskanTutupBill\(tx, id, sekarang\)/);
  });
});
