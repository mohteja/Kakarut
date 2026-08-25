/**
 * PENYESUAIAN YANG SUDAH DISETUJUI BENAR-BENAR TERKUNCI.
 *
 * Selisih opname yang berarti (waste vs salah catat) diputuskan lewat alur
 * persetujuan: kasir menghitung → owner/admin MENGKLARIFIKASI (kategori +
 * catatan + FOTO WAJIB) → owner/admin MENYETUJUI. Sesudah disetujui, baris itu
 * jadi baseline saldo, dan klarifikasinya dikunci — kodenya sendiri menuliskan
 * itu: "Penyesuaian sudah disetujui — klarifikasi terkunci".
 *
 * Tapi kuncinya cuma PRA-CEK: `SELECT` status, lempar 400, lalu `UPDATE` yang
 * WHERE-nya hanya `id`. Persetujuan yang commit di antara keduanya lolos —
 * dan yang ditimpa bukan angka stoknya melainkan BUKTINYA: kategori, catatan,
 * foto, dan siapa-yang-mengklarifikasi pada baris yang sudah disetujui.
 * Penyetujunya menyetujui bukti A; catatannya berakhir berbunyi B, tanpa jejak
 * bahwa itu pernah berubah.
 *
 * Bentuknya sama persis dengan `/batal-tolak` di `penerimaan-satu-antrean` —
 * dan di sana ia TERUKUR: 2 dari 14 putaran dengan tekanan kolam koneksi.
 * Yang membedakan cuma akibatnya: di sana barang hantu masuk stok, di sini
 * catatan pertanggungjawaban berubah sesudah ditandatangani.
 *
 * TERUKUR SECARA STRUKTURAL, dan itulah yang membuatnya jelas keliru: dari
 * ENAM penulisan ke `stockOpnames` di berkas ini, LIMA menyertakan predikat
 * `penyesuaianStatus` di WHERE-nya. Yang satu ini tidak. Bukan gaya yang
 * berbeda — pintu yang terlewat.
 *
 * Yang dijaga di sini: setiap penulisan ke `stockOpnames` yang ikut alur
 * persetujuan WAJIB memagari dirinya di WHERE, bukan di pra-cek. Pintu ketujuh
 * akan merah sebelum lahir.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RUTE = readFileSync(
  fileURLToPath(new URL("../src/modules/stok/routes.ts", import.meta.url)),
  "utf8",
);

/** Rentang `(...)` berimbang mulai dari kurung buka pertama sesudah `dari`. */
function blokKurung(s: string, dari: number): [number, number] {
  const i = s.indexOf("(", dari);
  if (i < 0) return [-1, -1];
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "(") d++;
    else if (s[j] === ")" && --d === 0) return [i, j];
  }
  return [i, s.length];
}

/**
 * Tiap `.update(stockOpnames)` beserta klausa `.where(...)`-nya.
 *
 * Klausa yang berupa NAMA VARIABEL (`.where(filter)`) ditelusuri ke
 * definisinya. Tanpa itu penjaga ini menuduh dua penulisan yang justru sudah
 * benar — `setujui-massal` dan `tolak` sesi merakit kondisinya lebih dulu ke
 * `const filter` karena bentuknya bercabang. Penjaga yang menuduh kode yang
 * benar lebih buruk daripada tak ada penjaga: ia mengajari orang mengabaikannya.
 */
function penulisan(sumber: string): { baris: number; where: string }[] {
  const out: { baris: number; where: string }[] = [];
  for (const m of sumber.matchAll(/\.update\(stockOpnames\)/g)) {
    const w = sumber.indexOf(".where(", m.index);
    if (w < 0) continue;
    const [a, b] = blokKurung(sumber, w + 6);
    // `b` menunjuk kurung TUTUP-nya, jadi +1 supaya ikut terpotong — tanpa itu
    // `.where(filter)` terbaca `(filter` dan pengenalan variabelnya tak pernah
    // cocok, yaitu persis cara penjaga ini sempat menuduh kode yang benar.
    let where = sumber.slice(a, b + 1);
    const ident = where.match(/^\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/);
    if (ident) {
      const d = sumber.lastIndexOf(`const ${ident[1]} =`, m.index);
      if (d >= 0) {
        const akhir = sumber.indexOf(";", d);
        where += "\n/*↳*/" + sumber.slice(d, akhir < 0 ? d + 800 : akhir);
      }
    }
    out.push({ baris: sumber.slice(0, m.index).split("\n").length, where });
  }
  return out;
}

const TULIS = penulisan(RUTE);

describe("penjaganya sendiri menunjuk ke tempat yang benar", () => {
  it("menemukan seluruh penulisan ke stockOpnames", () => {
    // Kalau pengurainya meleset, "semua sudah berpagar" jadi hijau yang hampa.
    expect(TULIS.length, "tak satu pun `.update(stockOpnames)` terbaca").toBeGreaterThanOrEqual(6);
    expect(RUTE.split(".update(stockOpnames)").length - 1).toBe(TULIS.length);
  });

  it("tiap klausa WHERE-nya benar-benar terpotong, bukan sisa berkas", () => {
    for (const t of TULIS) {
      expect(t.where.length, `where di baris ${t.baris} kosong`).toBeGreaterThan(10);
      expect(t.where.length, `where di baris ${t.baris} melahap berkas`).toBeLessThan(1200);
    }
  });
});

describe("alur persetujuan dipagari di WHERE, bukan di pra-cek", () => {
  it("tiap penulisan menyebut `penyesuaianStatus` di WHERE-nya", () => {
    /*
     * Pra-cek boleh tetap ada — ia yang membuat penolakannya TERBACA. Yang tak
     * boleh: pra-cek jadi satu-satunya pagar. `SELECT` lalu `UPDATE` adalah dua
     * pernyataan, dan apa pun yang commit di antaranya tak terlihat oleh
     * keputusan yang sudah diambil.
     */
    const bolong = TULIS.filter((t) => !t.where.includes("stockOpnames.penyesuaianStatus")).map(
      (t) => `baris ${t.baris}`,
    );
    expect(
      bolong,
      "penulisan ini memutuskan dari pra-cek saja — persetujuan yang menyela tak akan terlihat",
    ).toEqual([]);
  });

  it("tiap penulisan tetap terkurung ke perusahaannya", () => {
    // `UPDATE … WHERE id = <param>` yang lolos pra-cek tetap harus menyebut
    // company-nya sendiri: pagar yang berdiri di pernyataan yang MENULIS tak
    // bisa ditinggalkan oleh siapa pun yang kelak memindahkan pra-ceknya.
    const bolong = TULIS.filter((t) => !t.where.includes("stockOpnames.companyId")).map(
      (t) => `baris ${t.baris}`,
    );
    expect(bolong, "penulisan ini tak menyebut companyId di WHERE-nya").toEqual([]);
  });

  it("yang kalah balapan DIBERI TAHU, bukan dibalas 200", () => {
    // Tanpa memeriksa hasil UPDATE-nya, pemagaran di atas cuma membuat
    // tulisannya senyap — pengirimnya tetap melihat "tersimpan".
    const i = RUTE.indexOf('"/penyesuaian/:id/klarifikasi"');
    expect(i, "handler klarifikasi tak ditemukan").toBeGreaterThan(0);
    const blok = RUTE.slice(i, RUTE.indexOf('"/penyesuaian/:id/setujui"', i));
    expect(blok).toMatch(/\.returning\(/);
    expect(blok).toContain("klarifikasi terkunci");
  });
});

describe("ini pengetatan, bukan pelonggaran", () => {
  it("pra-cek klarifikasi TETAP ada — pesannya yang paling menjelaskan", () => {
    const i = RUTE.indexOf('"/penyesuaian/:id/klarifikasi"');
    const blok = RUTE.slice(i, RUTE.indexOf('"/penyesuaian/:id/setujui"', i));
    expect(blok).toContain('penyesuaianStatus === "disetujui"');
    expect(blok).toMatch(/foto_url/);
    expect(blok, "bukti foto tetap wajib").toContain("Bukti foto wajib dilampirkan");
  });

  it("klarifikasi ULANG atas baris DITOLAK tetap boleh", () => {
    /*
     * Pagarnya sengaja `ne(…, "disetujui")`, bukan `eq(…, "menunggu")`.
     * Baris yang DITOLAK memang dimaksudkan untuk diklarifikasi ulang — itu
     * sebabnya handler ini membersihkan `tolakAlasan`. Memakai `eq(menunggu)`
     * akan mematikan jalur perbaikan itu diam-diam, dan tak satu pun asersi
     * lain di berkas ini akan berbunyi.
     */
    const i = RUTE.indexOf('"/penyesuaian/:id/klarifikasi"');
    const blok = RUTE.slice(i, RUTE.indexOf('"/penyesuaian/:id/setujui"', i));
    expect(blok).toMatch(/ne\(stockOpnames\.penyesuaianStatus, "disetujui"\)/);
    expect(blok).toContain("tolakAlasan: null");
  });

  it("PASANGAN: penjaganya bisa MENUDUH atas sumber tiruan yang bolong", () => {
    // Ketiga asersi inti berbentuk "daftar bolong harus kosong" — hijau yang
    // paling mudah didapat karena alasan yang salah.
    const tiruan = `
      await db.update(stockOpnames).set({ a: 1 }).where(eq(stockOpnames.id, c.req.param("id")));
      await db.update(stockOpnames).set({ b: 2 })
        .where(and(eq(stockOpnames.id, x), eq(stockOpnames.companyId, y),
                   eq(stockOpnames.penyesuaianStatus, "menunggu")));
    `;
    const t = penulisan(tiruan);
    expect(t, "pengurai gagal membaca sumber tiruan").toHaveLength(2);
    expect(t.filter((x) => !x.where.includes("stockOpnames.penyesuaianStatus"))).toHaveLength(1);
    expect(t.filter((x) => !x.where.includes("stockOpnames.companyId"))).toHaveLength(1);
    // …dan yang lengkap TIDAK ikut dituduh.
    expect(t[1].where).toContain("stockOpnames.penyesuaianStatus");
    expect(t[1].where).toContain("stockOpnames.companyId");
  });

  it("PASANGAN: `.where(variabel)` ditelusuri, bukan dituduh mentah-mentah", () => {
    /*
     * Versi pertama penjaga ini MENUDUH dua penulisan yang sudah benar, sebab
     * keduanya menulis `.where(filter)` dan pengurainya berhenti di namanya.
     * Uji ini memaku penelusuran itu: bentuk yang sama, isinya lengkap, harus
     * lolos — dan variabel yang memang bolong harus tetap tertangkap.
     */
    const lengkap = `
      const filter = and(eq(stockOpnames.companyId, x), eq(stockOpnames.penyesuaianStatus, "menunggu"));
      await db.update(stockOpnames).set({ a: 1 }).where(filter);
    `;
    const l = penulisan(lengkap);
    expect(l).toHaveLength(1);
    expect(l[0].where, "definisi variabel tak ikut terbaca").toContain(
      "stockOpnames.penyesuaianStatus",
    );
    expect(l[0].where).toContain("stockOpnames.companyId");

    const bolong = `
      const filter = and(eq(stockOpnames.companyId, x));
      await db.update(stockOpnames).set({ a: 1 }).where(filter);
    `;
    expect(penulisan(bolong)[0].where).not.toContain("stockOpnames.penyesuaianStatus");
  });
});
