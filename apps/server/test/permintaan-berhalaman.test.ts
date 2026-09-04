import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  selesaiPermintaan,
  statusPermintaan,
  TAHAP_PERLENGKAPAN_BELUM_SELESAI,
  TAHAP_PERLENGKAPAN_TIBA,
  type KonfirmasiStatus,
  type PermintaanStokBagian,
  type PermintaanStokRow,
} from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PERMINTAAN STOK: BERHALAMAN DI SERVER, DAN RINGKASNYA ATAS POPULASI.
 *
 * Pemilik repo meminta bentuk tabel; angka yang muncul saat mengukurnya
 * menentukan sisanya. `GET /rekomendasi/permintaan` tak membaca satu pun query
 * param dan memulangkan SELURUH riwayat permintaan perusahaan sekaligus —
 * terukur 2026-09-03 pada DB gerbang: 24 permintaan = 11.790 byte, dan tak ada
 * cara memintanya lebih kecil. Ia tumbuh seumur usaha buka.
 *
 * Tiga hal yang dijaga di sini, dan ketiganya rusak TANPA GEJALA:
 *
 * 1. **Aturan statusnya satu rumah.** Sejak ringkasannya dihitung SQL, aturan
 *    yang sama ada di server dan di web. Dua salinan berarti ubin berbunyi
 *    "3 selesai" di atas daftar dengan 4 lencana selesai — untuk populasi yang
 *    sama, di layar yang sama, tanpa satu uji pun memerah.
 * 2. **Urutannya menentukan.** Kedua kunci urutnya agregat; tanpa pemutus seri
 *    yang unik, baris bisa muncul di dua halaman sementara baris lain tak
 *    muncul di mana pun. `GET /produksi` sudah membayarnya: 56 terkumpul dari
 *    total 60.
 * 3. **Barisnya dipulangkan dalam urutan KUNCI HALAMAN.** Peta perakitnya
 *    diisi mengikuti pemindaian `desc(waktu)`, yang BUKAN urutan
 *    "belum-selesai-dulu". Memulangkan urutan peta memberi himpunan yang benar
 *    dengan urutan yang salah — dan tak seorang pun bisa membedakannya dari
 *    "memang begitu datanya".
 *
 * YANG TIDAK DIJANJIKAN uji ini: ia membaca teks dan menjalankan fungsi TS.
 * Ia tak bisa mengatakan SQL-nya benar. Yang mengukur itu verify-api §292 —
 * invarian partisi, telusur seluruh halaman, monoton, dan delta konfirmasi —
 * atas Postgres sungguhan.
 */
const baca = (rel: string) =>
  butaKomentar(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const RUTE = baca("../src/modules/rekomendasi/routes.ts");
const HAL = baca("../../web/src/pages/stok/PermintaanStokPage.tsx");
const KOLOM = baca("../../web/src/pages/stok/kolom-permintaan.tsx");
const SAKELAR = baca("../../web/src/components/SakelarTampilan.tsx");
const VERIFY = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-api.sh", import.meta.url)),
  "utf8",
);

/** Bagian ber-status `s`; angka lain tak menentukan apa pun di aturannya. */
const bg = (s: KonfirmasiStatus): PermintaanStokBagian => ({
  faktur_id: "f",
  jumlah_baris: 1,
  status: s,
  total: 0,
});

const baris = (p: Partial<PermintaanStokRow>): PermintaanStokRow => ({
  rencana_id: "r",
  nomor: null,
  waktu: "2026-09-03T00:00:00.000Z",
  catatan: null,
  tujuan_cabang: null,
  pembuat: null,
  produksi: null,
  produksi_cabang: null,
  beli: null,
  beli_produksi: null,
  kirim: null,
  beli_perlengkapan: null,
  ...p,
});

describe("aturan keadaan: satu rumah, dan tabel kebenarannya", () => {
  it("permintaan tanpa bagian sama sekali BUKAN 'selesai'", () => {
    // `[].every(...)` memulangkan true — jebakan yang membuat permintaan kosong
    // terbaca sebagai keberhasilan. Karena itu `st.length > 0` ada di aturannya.
    expect(selesaiPermintaan(baris({}))).toBe(false);
    expect(statusPermintaan(baris({}))).toBe("berjalan");
  });

  it.each([
    ["rencana", "berjalan"],
    ["dikerjakan", "berjalan"],
    ["menunggu", "berjalan"],
    ["dikonfirmasi", "selesai"],
    ["ditolak", "selesai_ada_ditolak"],
  ] as const)("satu bagian %s → %s", (status, harap) => {
    expect(statusPermintaan(baris({ produksi: bg(status) }))).toBe(harap);
  });

  it("SELURUHNYA ditolak = selesai, tapi BUKAN keberhasilan", () => {
    // Bedanya bukan kerapian: menyebutnya "selesai" begitu saja membuat
    // kegagalan terbaca seperti keberhasilan di ubin ringkasan.
    const r = baris({ produksi: bg("ditolak"), beli: bg("ditolak") });
    expect(selesaiPermintaan(r)).toBe(true);
    expect(statusPermintaan(r)).toBe("selesai_ada_ditolak");
  });

  it("satu bagian tertinggal menahan seluruh permintaan", () => {
    const r = baris({ produksi: bg("dikonfirmasi"), produksi_cabang: bg("menunggu") });
    expect(statusPermintaan(r)).toBe("berjalan");
  });

  it("perlengkapan: hanya menunggu/diproses yang menahan", () => {
    const dgn = (s: string) =>
      baris({
        produksi: bg("dikonfirmasi"),
        beli_perlengkapan: { faktur_id: "f", jumlah_baris: 1, status: s as never, total: 0 },
      });
    expect(statusPermintaan(dgn("menunggu"))).toBe("berjalan");
    expect(statusPermintaan(dgn("diproses"))).toBe("berjalan");
    expect(statusPermintaan(dgn("tiba"))).toBe("selesai");
    // final tapi tak bahagia — dan `"sebagian"` bukan anggota enum-nya, jadi
    // ia juga menguji bahwa `includes` tak tersandung nilai di luar enum.
    expect(statusPermintaan(dgn("batal"))).toBe("selesai_ada_ditolak");
    expect(statusPermintaan(dgn("sebagian"))).toBe("selesai_ada_ditolak");
  });

  it("TANPA perlengkapan tak boleh menjatuhkan 'mulus'", () => {
    // Kelas cacat `bool_and` atas himpunan kosong, versi TS-nya.
    expect(statusPermintaan(baris({ produksi: bg("dikonfirmasi") }))).toBe("selesai");
  });

  it("ketiga keadaan SALING LEPAS — dasar invarian partisi di §292", () => {
    const semua: KonfirmasiStatus[] = [
      "rencana",
      "dikerjakan",
      "menunggu",
      "ditolak",
      "dikonfirmasi",
    ];
    for (const a of semua)
      for (const b of semua) {
        const r = baris({ produksi: bg(a), beli: bg(b) });
        const st = statusPermintaan(r);
        expect(["berjalan", "selesai", "selesai_ada_ditolak"]).toContain(st);
        expect(st === "berjalan").toBe(!selesaiPermintaan(r));
      }
  });

  it("web TAK LAGI menyimpan salinannya", () => {
    expect(HAL).not.toMatch(/function selesaiPermintaan\b/);
    expect(HAL).not.toMatch(/function statusPermintaan\b/);
    expect(HAL).toContain('from "@kakarut/shared"');
    expect(HAL).toContain("statusPermintaan(r)");
  });

  it("server merakit predikat SQL dari konstanta yang SAMA", () => {
    // Mengetik ulang daftar tahapnya sebagai literal SQL adalah cara paling
    // pasti membuat ubin dan lencana berselisih.
    expect(RUTE).toContain("inArray(productions.status, [...TAHAP_BELUM_SELESAI])");
    expect(RUTE).toContain("TAHAP_PERLENGKAPAN_BELUM_SELESAI");
    expect(RUTE).toContain("TAHAP_PERLENGKAPAN_TIBA");
    expect(RUTE).not.toMatch(/IN\s*\(\s*'rencana'\s*,\s*'dikerjakan'/);
    // Konstantanya memang berisi (bukan larik kosong yang meloloskan semuanya).
    expect([...TAHAP_PERLENGKAPAN_BELUM_SELESAI]).toEqual(["menunggu", "diproses"]);
    expect(TAHAP_PERLENGKAPAN_TIBA).toBe("tiba");
  });
});

describe("rute: berhalaman per RENCANA, dan urutannya menentukan", () => {
  /*
   * Irisannya dibatasi RUTE BERIKUTNYA, bukan panjang tetap. Handler ini
   * ~5 KB sesudah komentarnya dibuang, dan angka tetap yang "cukup hari ini"
   * diam-diam berhenti mencakup ekornya begitu handlernya tumbuh — lalu
   * asersi di bawah hijau karena tak melihat apa pun. Persis kelas cacat yang
   * `jangkar-iris` ada untuk mencegah.
   */
  const i = RUTE.indexOf('.get("/permintaan", async (c) => {');
  const iAkhir = RUTE.indexOf('.delete("/permintaan/:rencanaId"', i);
  const potong = RUTE.slice(i, iAkhir);

  it("irisannya benar-benar berisi, dan berhenti di rute berikutnya (premis)", () => {
    expect(i).toBeGreaterThan(0);
    expect(iAkhir).toBeGreaterThan(i);
    expect(potong).toContain("halamanQuery(c, { bawaan: 20, maks: 200 })");
    // cukup panjang untuk memuat seluruh handler, cukup pendek untuk tak
    // menelan rute sesudahnya
    expect(potong.length).toBeGreaterThan(3000);
    // …dan tak menelan rute DELETE sesudahnya (yang juga menyebut rencanaId).
    expect(potong).not.toContain("soft-delete");
  });

  it("MAX(waktu), bukan MIN — konfirmasi menulis ulang `waktu`", () => {
    /*
     * `GET /produksi` mengurut `MIN(waktu) DESC`; menyalinnya ke sini salah.
     * Yang ditampilkan entri ini diambil dari baris pertama pemindaian
     * `desc(waktu)` = MAX, dan MAX bergerak sebab konfirmasi menulis ulang
     * `productions.waktu`. Pada fikstur segar MIN dan MAX sama, jadi salahnya
     * lolos seluruh uji dan baru muncul di data hidup.
     */
    expect(potong).toContain("MAX(${productions.waktu})");
    expect(potong).not.toMatch(/MIN\(\$\{productions\.waktu\}\)/);
  });

  it("pemutus seri yang unik ada di ORDER BY", () => {
    expect(potong).toContain("asc(agregat.rencanaId)");
  });

  it("total MENUMPANG kueri ringkas — satu populasi, bukan dua", () => {
    const iHitung = potong.indexOf("const [hitung] = await db");
    expect(iHitung).toBeGreaterThan(0);
    const blok = potong.slice(iHitung, iHitung + 700);
    expect(blok).toContain("COUNT(*)::int");
    expect(blok).toContain("berjalan:");
    expect(blok).toContain("selesai:");
    expect(blok).toContain("selesaiAdaDitolak:");
    // dan ketiganya + total dari SUBKUERI yang sama
    expect(blok).toContain(".from(agregat)");
  });

  it("baris halaman diurutkan mengikuti KUNCI, bukan urutan peta", () => {
    expect(potong).toContain("kunciHalaman\n      .map((id) => map.get(id))");
    expect(potong).not.toContain("[...map.values()].map(");
  });

  it("korelasi subkueri BERKUALIFIKASI TABEL", () => {
    /*
     * Bug yang sudah menggigit putaran ini. `${productions.rencanaId}` di dalam
     * `EXISTS (SELECT … FROM supply_purchases sp …)` merender
     * `sp.rencana_id = "rencana_id"` — tanpa kualifikasi, jadi teresolusi ke
     * `sp.rencana_id` sendiri: selalu benar. Akibatnya `supBelum` berhenti
     * bertanya soal permintaan INI dan mulai bertanya soal SELURUH perusahaan;
     * `ringkas` memulangkan `berjalan: 24, selesai: 0` untuk populasi yang
     * hitungan tangannya 17/7. Invarian partisi TIDAK menangkapnya — jumlahnya
     * tetap 24, semua kesalahannya mendarat di satu ember.
     */
    expect(potong).toContain("sp.rencana_id = productions.rencana_id");
    expect(potong).not.toMatch(/sp\.rencana_id = \$\{productions\.rencanaId\}/);
    // dan keduanya tetap terkurung tenant
    expect((potong.match(/sp\.company_id = \$\{auth\.company_id!\}/g) ?? []).length).toBe(2);
  });

  it("balasannya berkunci — bukan array telanjang lagi", () => {
    expect(potong).toContain("c.json({ rows: hasil, total, page, per_page: perPage, ringkas })");
  });
});

describe("web: sakelar, ubin, dan tautan yang menunjuk fakturnya", () => {
  it("sakelar bentuk punya SATU rumah, dipakai tiga halaman", () => {
    expect(SAKELAR).toContain("export function SakelarTampilan");
    expect(SAKELAR).toContain("export function useTampilan");
    for (const hal of [
      "../../web/src/pages/stok/PermintaanStokPage.tsx",
      "../../web/src/pages/menu/MenuListPage.tsx",
      "../../web/src/pages/resep/ResepPage.tsx",
    ]) {
      expect(baca(hal), hal).toContain("SakelarTampilan");
    }
    // …dan tak ada yang mengetik markupnya sendiri lagi.
    for (const hal of [
      "../../web/src/pages/menu/MenuListPage.tsx",
      "../../web/src/pages/resep/ResepPage.tsx",
    ]) {
      expect(baca(hal), hal).not.toContain('aria-pressed={tampilan === "ikon"}');
    }
  });

  it("ubin memakai ringkas SERVER, dan tak dirender saat gagal", () => {
    expect(HAL).toContain("data.ringkas.berjalan");
    expect(HAL).toContain("data.ringkas.selesai");
    // Penjaga `nilai-stok`: "0 berjalan" di atas daftar yang gagal dimuat
    // terbaca sebagai "tak ada cabang yang menunggu".
    expect(HAL).toContain("{!gagalMuat && data?.ringkas && total > 0 && (");
    // …dan TIDAK dijumlahkan dari baris yang tampil.
    expect(HAL).not.toMatch(/rows\.filter\([^)]*\)\.length/);
  });

  it("halaman & per_page dikirim ke SERVER", () => {
    expect(HAL).toContain("?page=${page}&per_page=${perPage}");
    expect(HAL).toContain("data?.total ?? 0");
    // pengurut klien lama benar-benar pergi
    expect(HAL).not.toContain("beresA - beresB");
  });

  it("tiap jalur menautkan ke FAKTURNYA, bukan ke daftarnya — DUA bentuk", () => {
    /*
     * VERSI PERTAMA UJI INI HANYA MEMBACA `KOLOM`, DAN ITU MEMBIARKAN CACAT
     * LEWAT — dicatat di sini supaya tak terulang.
     *
     * Perbaikan tautannya hanya kena bentuk TABEL; bentuk KARTU — yang BAWAAN,
     * jadi yang paling sering dibuka orang — tetap menunjuk `/produksi` dan
     * `/pembelian`, DAFTARNYA. Penjaga ini hijau (ia tak membaca halamannya),
     * dan lengan peramban juga hijau (ia mengklik tabel). Dua gerbang setuju
     * bahwa sesuatu beres, dan tak satu pun pernah melihatnya.
     *
     * Yang dijaga sekarang bukan "berkas kolom menyebut pola tautan yang
     * benar" melainkan **tak ada tempat lain yang boleh menentukan tujuannya
     * sendiri**: satu fungsi, dan kedua bentuk memanggilnya.
     */
    expect(KOLOM).toContain("export function tautanJalur(");
    expect(KOLOM).toContain("`/pembelian/${fakturId}`");
    expect(KOLOM).toContain("`/produksi/${fakturId}`");
    // BATAS YANG DISENGAJA: BP- tetap ke daftarnya — fakturnya hidup di
    // `supply_purchases`, dan halaman dokumen hanya melayani `productions`.
    expect(KOLOM).toContain('if (jalur === "beli_perlengkapan") return "/perlengkapan/beli";');

    // Halaman (bentuk KARTU) memanggil fungsi yang SAMA…
    expect(HAL).toContain("tautanJalur(jalur, data.faktur_id)");
    // …dan tak menuliskan tujuannya sendiri lagi, dalam bentuk apa pun.
    expect(HAL, "kartu menentukan tujuannya sendiri lagi").not.toMatch(
      /to=\{?"\/(produksi|pembelian|perlengkapan)/,
    );
    // Ikon jalur juga satu rumah — dua peta ikon = dua kosakata untuk hal sama.
    expect(KOLOM).toContain("export const IKON_JALUR");
    expect(HAL).toContain("IKON_JALUR[jalur]");
    expect(HAL).not.toMatch(/\? "🏭"/);
  });

  it("ringkasan menu (`catatan`) TAK dirender di daftar — dua bentuk", () => {
    /*
     * Dibuang atas keputusan pemilik repo 2026-09-04, dan dijaga di sini
     * karena dua sebabnya berbeda dan keduanya mudah dilupakan.
     *
     * ISINYA: "Rencana dari menu: 10× PBA., 10× PBB., 10× PBC., …" — daftar
     * kode menu mentah yang bisa memuat puluhan entri. Tak seorang pun
     * memindai tabel untuk membacanya.
     *
     * BENTUKNYA: `truncate` TIDAK memotong apa pun di sel `<table>`
     * ber-layout otomatis — lebar kolom di sana dihitung dari lebar-konten
     * -minimum, dan teks `nowrap` lebar minimumnya adalah panjang penuhnya.
     * Akibatnya terlihat di layar pemilik: kolom Isi terpotong di tepi kanan
     * dan Nilai/Orang/Aksi terdorong keluar layar. Terukur sesudah dibuang:
     * kolom Dokumen 95px, tabel utuh 1.052px, kedelapan kolom muat.
     *
     * Isinya tetap hidup di halaman dokumen fakturnya sebagai medan
     * "Catatan" — tempat yang memang berruang. Jadi yang dijaga di sini
     * BUKAN "catatan tak boleh ada di mana pun", melainkan "ia tak dirender
     * di DAFTAR", dan asersi terakhir memakukan bahwa rumahnya masih ada.
     */
    expect(HAL, "kartu merender catatan lagi").not.toContain("r.catatan");
    expect(KOLOM, "tabel merender catatan lagi").not.toContain("r.catatan");
    const DOK = baca("../../web/src/pages/produksi/FakturDetailPage.tsx");
    expect(DOK, "rumahnya di halaman dokumen ikut hilang").toContain('k: "Catatan"');
  });

  it("label tahap per jalur satu rumah, dipakai kartu DAN tabel", () => {
    // Sempat ada dua terner byte-identik (`Bagian` dan kolom tabel). Dua
    // salinan aturan label = kartu dan tabel bisa menyebut tahap yang sama
    // dengan dua kata berbeda untuk faktur yang sama, tanpa satu uji merah.
    expect(HAL).toContain("export function gayaBagian(");
    expect((HAL.match(/\? LABEL_PRODUKSI/g) ?? []).length).toBe(1);
    expect((HAL.match(/\? LABEL_KIRIM/g) ?? []).length).toBe(1);
  });

  it("aturan nilai (dobel hitung) satu rumah, dipakai kartu DAN tabel", () => {
    expect(KOLOM).toContain("export function totalPermintaan");
    expect(KOLOM).not.toContain("beli_produksi?.total");
    expect(HAL).toContain("totalPermintaan(r)");
    // kartu tak menjumlahkannya sendiri lagi
    expect(HAL).not.toContain("(r.produksi?.total ?? 0) +");
  });
});

describe("verify-api §292 ADA, dan menguji yang cuma Postgres bisa menguji", () => {
  it("keempat lengannya tertulis", () => {
    expect(VERIFY).toContain("§292 ringkas: ketiga ember menjumlah TEPAT ke total");
    expect(VERIFY).toContain("§292 telusur seluruh halaman: rencana unik == total");
    expect(VERIFY).toContain("§292 rows monoton");
    expect(VERIFY).toContain("§292 tenant LAIN tak melihat rencana tenant ini");
    // ringkas dibandingkan dengan hitungan tangan — bukan cuma dengan dirinya
    expect(VERIFY).toContain("§292 ringkas cocok dengan hitungan tangan atas rows");
  });
});
