/**
 * SAPUAN: waktu mundur BERPATOK JAM DINDING di verify-api.sh.
 *
 * KENAPA UJI INI ADA — dan ia ada karena cacat yang sama muncul DUA KALI.
 *
 * Perintah sinkron offline membawa `waktu` kejadiannya, dan server mencocokkan
 * waktu itu dengan shift kasir: `sync/routes.ts` menuntut
 * `opened_at <= waktu + SKEW_MENIT` (5 menit). Shift yang dipakai seksi uji
 * dibuka SAAT RUN BERJALAN — beberapa menit lalu — jadi `waktu` yang dipatok
 * "N jam lalu" jatuh N jam SEBELUM shift itu ada. Tak ada shift yang
 * mencakupnya, 409 `shift_tidak_cocok`, dan seksinya runtuh.
 *
 * Bahwa seksi begitu pernah lulus sama sekali cuma karena seksi LAIN kebetulan
 * meninggalkan shift bertanggal mundur yang menaunginya. Begitu kalender
 * bergeser — tanggal bisnis WIB berganti tengah malam — naungan itu hilang.
 *
 *   §138 kena lebih dulu. Komentarnya menyebut run 17:05 UTC (= 00:05 WIB) dan
 *   menghitung jendela rusaknya "empat jam penuh setiap hari". Diperbaiki
 *   dengan aritmetika menit-WIB.
 *
 *   §198 kena persis sama, dengan `now - 2 jam`, dan TIDAK ikut diperbaiki.
 *   Ia gagal lagi sepuluh bulan kemudian pada run 17:44 UTC (= 00:44 WIB) —
 *   dua run beruntun merah, di commit ini dan di induknya.
 *
 * Pelajarannya tertulis panjang di §138 dan tetap tak terbawa ke saudaranya.
 * Komentar tak menegakkan apa pun; uji ini yang menegakkannya.
 *
 * YANG DILARANG: offset mundur SUB-HARI yang angkanya ditulis mati.
 * YANG BOLEH, dan kenapa:
 *   - offset BERHARI (`-3 days`, `-20 days`) — itu uji batas usia perintah;
 *     bergesernya beberapa jam tak mengubah apa pun yang diuji;
 *   - offset yang DIHITUNG dari keadaan (`-${OFF_BUKA138} minutes`) — §138;
 *   - waktu yang DITURUNKAN DARI DATA — cara §198 sekarang: ambil
 *     `dibuka_pada` shift yang memang ada, tambah satu detik. Tak ada jam
 *     dinding yang bisa menggesernya, jadi ini yang paling kuat.
 *
 * BATASNYA: hanya bentuk `timedelta(...)` dan `date -u -d '-N ...'` yang
 * terlihat. Waktu mundur yang ditulis dengan cara lain lolos.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SKRIP = fileURLToPath(new URL("../../../scripts/verify-api.sh", import.meta.url));
const SUMBER = readFileSync(SKRIP, "utf8");

/**
 * Offset mundur sub-hari berangka mati — bentuk yang dua kali menyakiti repo ini.
 *
 * Yang dicari BUKAN sembarang `timedelta`, melainkan MENGURANGI jam dinding.
 * Percobaan pertama detektor ini menandai `t + timedelta(seconds=1)` milik §198
 * sendiri — padahal itu penambahan pada waktu yang DITURUNKAN DARI DATA, persis
 * bentuk yang seharusnya dianjurkan. Penjaga yang menuduh perbaikannya sendiri
 * akan dimatikan orang berikutnya, dan bersamanya hilang pula yang dijaga.
 */
const TERLARANG = [
  // now(...) − timedelta(hours|minutes|seconds = angka)
  /datetime\.now\([^)]*\)[\s\S]{0,120}?-\s*(?:datetime\.)?timedelta\(\s*(?:hours|minutes|seconds)\s*=\s*\d/g,
  // `date -u -d '-N hours'` selalu relatif terhadap SEKARANG menurut definisinya
  /date\s+-u\s+-d\s+['"]-\d+\s*(?:hour|minute)/g,
];

/**
 * Pengecualian yang SUDAH DITIMBANG. Kunci = potongan barisnya; nilai =
 * alasannya. Kosong hari ini, dan itu memang keadaan yang benar — daftar ini
 * ada supaya pengecualian berikutnya harus DITULIS ALASANNYA, bukan diselipkan.
 */
const DIKECUALIKAN: Record<string, string> = {};

/** Cocokkan atas SELURUH berkas — polanya boleh melewati baris. */
function pelanggaranDi(teks: string): string[] {
  const keluar: string[] = [];
  for (const pola of TERLARANG) {
    pola.lastIndex = 0;
    for (const m of teks.matchAll(pola)) {
      const potongan = m[0].replace(/\s+/g, " ").slice(0, 120);
      if (Object.keys(DIKECUALIKAN).some((k) => potongan.includes(k))) continue;
      keluar.push(`baris ${teks.slice(0, m.index).split("\n").length}: ${potongan}`);
    }
  }
  return keluar;
}

/**
 * Komentar penjelas memang menyebut bentuk terlarangnya — itu bukan kode.
 *
 * DIKOSONGKAN, bukan dibuang: membuang barisnya menggeser seluruh penomoran,
 * dan pesan galatnya lalu menunjuk baris 7592 untuk pelanggaran di baris 9891.
 * Penjaga yang menunjuk tempat yang salah membuat orang mencari di tempat yang
 * salah — persis kerugian yang seharusnya ia cegah.
 */
const TANPA_KOMENTAR = SUMBER.split("\n")
  .map((b) => (b.trim().startsWith("#") ? "" : b))
  .join("\n");

function barisMelanggar(): string[] {
  return pelanggaranDi(TANPA_KOMENTAR);
}

describe("verify-api tak memakai waktu mundur berpatok jam dinding", () => {
  it("tak ada offset mundur SUB-HARI yang angkanya ditulis mati", () => {
    const melanggar = barisMelanggar();
    expect(
      melanggar,
      melanggar.length === 0
        ? ""
        : `Baris berikut memundurkan waktu dengan angka mati:\n\n${melanggar.join("\n")}\n\n` +
          "Waktu kejadian yang dipatok jam dinding akan jatuh di luar shift yang " +
          "dibuka saat run berjalan — 409 `shift_tidak_cocok`, dan seksinya runtuh " +
          "pada jam tertentu saja. Turunkan waktunya DARI DATA (mis. `dibuka_pada` " +
          "shift yang memang ada, +1 detik, seperti §198), atau hitung dari keadaan " +
          "seperti §138. Kalau memang harus mati, daftarkan di DIKECUALIKAN " +
          "DENGAN ALASAN yang bisa dibaca orang lain.",
    ).toEqual([]);
  });

  it("detektornya benar-benar mengenali bentuk yang dilarang", () => {
    // Tanpa ini, regex yang salah ketik membuat uji di atas hijau selamanya —
    // penjaga yang tak bisa menuduh siapa pun tak menjaga apa pun.
    const contoh = [
      // baris §198 yang lama, apa adanya
      'WKT198=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=2)).strftime(\'%Y\'))")',
      "W=$(date -u -d '-90 minutes' +%Y)",
      // dipecah beberapa baris — bentuk yang paling mudah lolos
      "t = datetime.datetime.now(datetime.timezone.utc)\nu = t - datetime.timedelta(minutes=30)",
    ];
    for (const c of contoh) {
      expect(pelanggaranDi(c).length, `pola gagal mengenali: ${c}`).toBeGreaterThan(0);
    }
  });

  it("…dan tidak menuduh bentuk yang memang boleh", () => {
    // Pasangannya, dan ia yang paling penting di sini: percobaan pertama
    // detektor ini MENUDUH perbaikan §198 sendiri. Penjaga yang begitu akan
    // dimatikan, bukan diperbaiki.
    const sah = [
      "OLD99=$(date -u -d '-10 days' +%Y-%m-%dT%H:%M:%SZ)",
      'W138=$(date -u -d "-${OFF_BUKA138} minutes" +%Y-%m-%dT%H:%M:%SZ)',
      'EXP118=$(python3 -c "...timedelta(days=5)...")',
      "BUKA198=$(api \"$K198\" GET /shift/aktif | jq -r '.dibuka_pada')",
      // cara §198 sekarang: MENAMBAH pada waktu dari data, bukan mengurangi jam dinding
      "t = datetime.datetime.fromisoformat(x)\nprint(t + datetime.timedelta(seconds=1))",
    ];
    for (const s of sah) {
      expect(pelanggaranDi(s), `pola salah menuduh: ${s}`).toEqual([]);
    }
  });

  it("§138 dan §198 tetap memakai cara yang tak berpatok jam dinding", () => {
    // Menjaga perbaikannya, bukan cuma melarang bentuk lamanya: kalau salah
    // satunya dikembalikan ke angka mati, uji pertama menangkapnya — tapi
    // kalau diganti cara lain yang juga rapuh, hanya asersi ini yang tahu.
    expect(SUMBER).toMatch(/OFF_BUKA138=\$SPAN138/);
    expect(SUMBER).toMatch(/BUKA198=\$\(api "\$K198" GET \/shift\/aktif/);
    expect(SUMBER).toMatch(/timedelta\(seconds=1\)/);
  });
});
