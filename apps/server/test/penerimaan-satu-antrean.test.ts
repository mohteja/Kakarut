/**
 * SATU FAKTUR, SATU ANTREAN — empat pintu penerimaan tak boleh saling menyela.
 *
 * `/batal-tolak` menjaga dirinya dengan PRA-CEK: "kalau ada baris yang sudah
 * dikonfirmasi, jangan batalkan penolakan" — sebab baris yang ditolak dalam
 * penerimaan sebagian memang SENGAJA tak diterima (qty 0), dan membatalkannya
 * berarti memasukkan qty & harga PENUH yang salah. Alasannya sudah tertulis
 * lengkap di komentar handler-nya.
 *
 * Tapi pra-ceknya `SELECT`, penerapannya `UPDATE` — dua pernyataan, tanpa
 * transaksi dan tanpa kunci. `/terima-sebagian` yang commit DI ANTARA keduanya
 * lolos begitu saja:
 *
 *   1. `/batal-tolak` membaca: belum ada baris 'dikonfirmasi' → pra-cek LOLOS
 *   2. `/terima-sebagian` commit: baris A → 'dikonfirmasi', baris B → 'ditolak'
 *   3. `/batal-tolak` UPDATE `WHERE status='ditolak'` → baris B ikut jadi
 *      'dikonfirmasi', dengan qty & harga PENUH yang tak pernah diterima
 *
 * TERUKUR lewat HTTP sungguhan, bukan diperkirakan: 14 putaran dengan tekanan
 * kolam koneksi → 2 kali baris yang DITOLAK berubah jadi 'dikonfirmasi', dan
 * saldo cabang tujuan naik 8 lalu 16 untuk barang yang tak pernah datang.
 * Instrumennya diuji lebih dulu bisa melihat keadaan itu (jalur sah
 * tolak → batal-tolak memang menghasilkan 'dikonfirmasi' + saldo 8), jadi nol
 * pada putaran lain berarti balapannya meleset, bukan alatnya buta.
 *
 * PERBAIKANNYA bukan menyalin pra-ceknya ke dalam UPDATE — kondisi fakturnya
 * hidup di `kondisiFaktur()`, dan menyalinnya ke subkueri persis bentuk yang
 * `konsep-satu-rumah.test.ts` ada untuk mencegah. Yang dipakai primitif yang
 * sudah ada di repo ini: `kunciAntrean` per FAKTUR. Keempat pintu penerimaan
 * menjawab satu pertanyaan yang sama — "nasib faktur ini apa" — jadi mereka
 * memang harus antre, bukan berlomba.
 *
 * Yang dijaga di sini SIFAT STRUKTURALNYA: pintu kelima akan merah sebelum
 * lahir. Perilakunya dijaga §222 verify-api lewat HTTP sungguhan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RUTE = readFileSync(
  fileURLToPath(new URL("../src/modules/penerimaan/routes.ts", import.meta.url)),
  "utf8",
);

/** Badan satu handler, dari penandanya sampai penanda berikutnya. */
function blok(mulai: string, sampai: string): string {
  const i = RUTE.indexOf(mulai);
  expect(i, `handler ${mulai} tak ditemukan`).toBeGreaterThan(0);
  const j = RUTE.indexOf(sampai, i + mulai.length);
  return RUTE.slice(i, j > i ? j : undefined);
}

const PINTU = {
  terima: blok('"/:fakturId/terima"', '"/:fakturId/terima-sebagian"'),
  "terima-sebagian": blok('"/:fakturId/terima-sebagian"', '"/:fakturId/tolak"'),
  tolak: blok('"/:fakturId/tolak"', '"/:fakturId/batal-tolak"'),
  "batal-tolak": blok('"/:fakturId/batal-tolak"', "\n  });\n"),
};

describe("penjaganya sendiri menunjuk ke tempat yang benar", () => {
  // Kalau salah satu batas tak ketemu, `slice` memulangkan potongan yang salah
  // (atau seluruh berkas) dan SEMUA penjaga di bawah lulus tanpa arti.
  it.each(Object.entries(PINTU))("blok %s benar-benar terisolasi", (nama, isi) => {
    expect(isi.length, `blok ${nama} terlalu pendek`).toBeGreaterThan(200);
    expect(isi.length, `blok ${nama} melahap seluruh berkas`).toBeLessThan(RUTE.length / 2);
  });

  it("keempatnya potongan yang BERBEDA, bukan empat salinan potongan yang sama", () => {
    const unik = new Set(Object.values(PINTU));
    expect(unik.size).toBe(4);
  });
});

describe("satu faktur, satu antrean", () => {
  it.each(Object.keys(PINTU))("%s mengantre pada kunci faktur", (nama) => {
    const isi = PINTU[nama as keyof typeof PINTU];
    expect(isi, `${nama}: baca+tulis harus satu transaksi`).toMatch(/db\.transaction\(/);
    expect(isi, `${nama}: transaksinya harus berkunci per faktur`).toMatch(
      /kunciAntrean\(tx, "penerimaan-faktur"/,
    );
  });

  it("kuncinya memakai fakturId — bukan cuma companyId", () => {
    // Kunci se-perusahaan akan menyerialkan SELURUH penerimaan di semua cabang:
    // benar tapi mahal. Kunci per faktur tepat sasaran — yang berebut memang
    // cuma pintu-pintu yang menyentuh faktur yang sama.
    for (const [nama, isi] of Object.entries(PINTU)) {
      expect(isi, `${nama}: kunci tak menyertakan fakturId`).toMatch(
        /kunciAntrean\(tx, "penerimaan-faktur", [^)]*faktur/i,
      );
    }
  });

  it("keputusan & tulisannya lewat `tx`, bukan `db`", () => {
    // Membaca lewat `db` di dalam transaksi bukan cuma soal snapshot — ia
    // menyewa koneksi kedua dari kolam yang sama. Lihat `koneksi-bersarang.test.ts`.
    for (const [nama, isi] of Object.entries(PINTU)) {
      expect(isi, `${nama}: masih ada \`await db.\` di dalam handler`).not.toMatch(
        /await db\.(select|update|insert|delete|execute)\(/,
      );
    }
  });
});

describe("ini pengetatan, bukan pelonggaran", () => {
  it("pra-cek `/batal-tolak` TETAP ada — pesannya yang paling berguna", () => {
    // Kuncinya membuat keputusannya benar; pra-ceknya membuat penolakannya
    // TERBACA ("sudah diterima sebagian", bukan "tidak ada baris ditolak").
    // Menghapusnya karena "sekarang sudah dikunci" akan menukar pesan yang
    // menjelaskan dengan pesan yang membingungkan.
    const b = PINTU["batal-tolak"];
    expect(b).toMatch(/eq\(productions\.status, "dikonfirmasi"\)/);
    expect(b).toContain("sudah diterima sebagian");
  });

  it("`/batal-tolak` masih hanya menyentuh baris 'ditolak'", () => {
    expect(PINTU["batal-tolak"]).toMatch(/eq\(productions\.status, "ditolak"\)/);
  });

  it("CAS di `/terima`, `/terima-sebagian` & `/tolak` tak ikut hilang", () => {
    // Kunci antrean menyerialkan; CAS tetap yang menjamin baris yang berubah di
    // sela tak tertimpa. Keduanya perlu — mengganti CAS dengan kunci berarti
    // percaya bahwa TAK ADA jalur lain yang menyentuh baris ini.
    expect(PINTU.terima).toMatch(/eq\(productions\.status, "menunggu"\)/);
    expect(PINTU.tolak).toMatch(/eq\(productions\.status, "menunggu"\)/);
    expect(PINTU["terima-sebagian"]).toMatch(/eq\(productions\.status, "menunggu"\)/);
  });

  it("PASANGAN: penjaganya bisa MENUDUH kalau kuncinya dicabut", () => {
    /*
     * Seluruh asersi di atas berbentuk "harus cocok" atas sumber yang nyata —
     * gampang hijau kalau polanya meleset dan kebetulan cocok di tempat lain.
     * Yang diperiksa: pola yang SAMA atas handler tiruan tanpa kunci harus gagal.
     */
    const tanpaKunci = [
      '.post("/:fakturId/batal-tolak", async (c) => {',
      "  const [ada] = await db.select().from(productions).limit(1);",
      "  if (ada) throw new HTTPException(400, {});",
      "  const rows = await db.update(productions).set({}).returning({});",
      "  return c.json({ ok: true });",
      "})",
    ].join("\n");
    expect(/kunciAntrean\(tx, "penerimaan-faktur"/.test(tanpaKunci)).toBe(false);
    expect(/db\.transaction\(/.test(tanpaKunci)).toBe(false);
    expect(/await db\.(select|update)\(/.test(tanpaKunci)).toBe(true);

    // …dan sebaliknya: bentuk yang BENAR memang cocok pada ketiga polanya.
    const berkunci = [
      "await db.transaction(async (tx) => {",
      '  await kunciAntrean(tx, "penerimaan-faktur", auth.company_id!, fakturId);',
      "  const rows = await tx.update(productions).set({}).returning({});",
      "});",
    ].join("\n");
    expect(/kunciAntrean\(tx, "penerimaan-faktur", [^)]*faktur/i.test(berkunci)).toBe(true);
    expect(/db\.transaction\(/.test(berkunci)).toBe(true);
    expect(/await db\.(select|update|insert|delete|execute)\(/.test(berkunci)).toBe(false);
  });
});
