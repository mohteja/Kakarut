import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { awalHariDi, tambahHari, tanggalDi } from "../src/lib/time";

/**
 * Penjaga BATAS HARI: tanggal yang dipilih orang vs kolom `timestamptz`.
 *
 * Tanggal di layar selalu berarti tanggal DI ZONA PERUSAHAAN. Yang disimpan
 * di kolom `timestamptz` adalah instant. Menjembatani keduanya dengan
 * `new Date(`${tanggal}T00:00:00Z`)` TERLIHAT benar — ia bahkan bertuliskan
 * "00:00" — tapi di WIB instant itu jam 07:00. Jendela sehari jadi bergeser
 * tujuh jam: bukan sedikit meleset, melainkan memuat pagi hari BERIKUTNYA
 * sambil membuang subuh hari yang diminta.
 *
 * Untuk restoran, tujuh jam itu bukan jam sepi. Sayur dan daging datang
 * subuh, dan "kiriman kemarin jadi diterima berapa?" adalah pertanyaan yang
 * justru dijawab oleh riwayat penerimaan — halaman yang dulu salah menjawab.
 *
 * DUA TEMPAT yang diperbaiki, keduanya kelas kesalahan yang sama:
 *
 *   1. `GET /penerimaan/riwayat` — menyaring `confirmed_at` (timestamptz)
 *      dengan jendela UTC. Kiriman yang diterima jam 5 pagi tercatat pada
 *      HARI SEBELUMNYA, dan hari yang diminta malah kebagian subuh besoknya.
 *   2. `POST /stok/stok-awal` — saldo pembuka bertanggal lampau ditulis pada
 *      tengah malam UTC. Saldo dipakai sebagai baseline (`waktu > created_at`),
 *      jadi mutasi antara 00:00–07:00 pada tanggal itu jatuh di sisi salah
 *      dan HILANG dari saldo.
 *
 * YANG TIDAK DIPATOK: bahwa setiap kolom waktu di repo ini sudah dibandingkan
 * dengan benar. Yang dipatok adalah bahwa jembatan tanggal→instant hanya boleh
 * lewat `awalHariDi`, dan bahwa pemakaian `T00:00:00Z` yang tersisa memang
 * bukan jembatan itu (lihat daftar DIIZINKAN).
 */

const AKAR = fileURLToPath(new URL("../src/", import.meta.url));
const src = (p: string) => readFileSync(AKAR + p, "utf8");

/** Zona Indonesia — ketiganya nyata dan berbeda tujuh, delapan, sembilan jam. */
const WIB = "Asia/Jakarta";
const WITA = "Asia/Makassar";
const WIT = "Asia/Jayapura";

describe("awalHariDi: tengah malam di zona perusahaan, bukan di UTC", () => {
  it("WIB — tengah malam 6 Agustus jatuh pukul 17:00 UTC tanggal 5", () => {
    // Inti seluruh perbaikan dalam satu angka. Kalau ini berubah jadi
    // 2026-08-06T00:00:00Z, bug-nya kembali.
    expect(awalHariDi(WIB, "2026-08-06").toISOString()).toBe("2026-08-05T17:00:00.000Z");
  });

  it("WITA dan WIT ikut bergeser sesuai zonanya", () => {
    // `companies.timezone` memang sebuah kolom, bukan konstanta. Selama ketiga
    // zona ini ada, "cukup pakai UTC" tak pernah jadi jawaban yang benar.
    expect(awalHariDi(WITA, "2026-08-06").toISOString()).toBe("2026-08-05T16:00:00.000Z");
    expect(awalHariDi(WIT, "2026-08-06").toISOString()).toBe("2026-08-05T15:00:00.000Z");
  });

  it("UTC tetap tengah malam UTC — perbaikannya bukan menggeser semua orang", () => {
    expect(awalHariDi("UTC", "2026-08-06").toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  it("zona berpecahan jam ikut benar", () => {
    // Kathmandu +05:45 — pembulatan ke jam penuh akan meleset 15 menit di sini.
    expect(awalHariDi("Asia/Kathmandu", "2026-08-06").toISOString()).toBe(
      "2026-08-05T18:15:00.000Z",
    );
  });

  it("invarian: hasilnya BENAR-BENAR instant paling awal pada tanggal itu", () => {
    // Dua sisi sekaligus, dan keduanya perlu:
    //   (a) instant hasilnya jatuh pada tanggal yang diminta — kalau tidak,
    //       jendelanya mulai di hari yang salah;
    //   (b) satu milidetik sebelumnya SUDAH hari sebelumnya — kalau tidak,
    //       awal harinya kesiangan dan jam-jam pertama terbuang.
    // Disapu setahun penuh supaya batas bulan, tahun kabisat, dan peralihan
    // DST ikut kena, bukan cuma satu tanggal pilihan.
    const zona = [WIB, WITA, WIT, "UTC", "America/New_York", "Australia/Lord_Howe"];
    let diperiksa = 0;
    for (const tz of zona) {
      let d = "2026-01-01";
      for (let i = 0; i < 365; i++) {
        const awal = awalHariDi(tz, d);
        expect(tanggalDi(tz, awal), `${tz} ${d}: awal hari jatuh di tanggal lain`).toBe(d);
        expect(
          tanggalDi(tz, new Date(awal.getTime() - 1)),
          `${tz} ${d}: masih ada instant lebih awal pada tanggal yang sama`,
        ).toBe(tambahHari(d, -1));
        diperiksa++;
        d = tambahHari(d, 1);
      }
    }
    expect(diperiksa).toBe(zona.length * 365);
  });

  it("DST maju/mundur biasa (tengah malam tetap ada) tak tergeser", () => {
    // New York memindahkan jamnya pukul 02:00, jadi tengah malamnya normal:
    // 8 Mar masih EST (−5), 1 Nov sudah EDT (−4).
    expect(awalHariDi("America/New_York", "2026-03-08").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(awalHariDi("America/New_York", "2026-11-01").toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  it("tengah malam yang TIDAK PERNAH ADA — hari dimulai di instant peralihan", () => {
    // Chile meloncat dari 23:59 langsung ke 01:00, jadi 2026-09-06 00:00
    // waktu setempat tak pernah terjadi. Perhitungan dua-kandidat yang naif
    // mendarat di 23:00 tanggal 5 — sehari penuh meleset, bukan sejam.
    const awal = awalHariDi("America/Santiago", "2026-09-06");
    expect(awal.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(tanggalDi("America/Santiago", awal)).toBe("2026-09-06");
  });
});

describe("kiriman subuh: jendela yang dulu membuangnya kini memuatnya", () => {
  /** Kiriman diterima 6 Agustus pukul 05:00 WIB — jam sayur datang. */
  const subuh = new Date("2026-08-05T22:00:00.000Z");

  it("premis: instant itu memang tanggal 6 menurut jam dinding WIB", () => {
    expect(tanggalDi(WIB, subuh)).toBe("2026-08-06");
  });

  it("jendela LAMA (tengah malam UTC) membuangnya dari tanggal 6…", () => {
    const dariLama = new Date("2026-08-06T00:00:00Z");
    const sampaiLama = new Date("2026-08-06T23:59:59.999Z");
    expect(subuh >= dariLama && subuh <= sampaiLama).toBe(false);
  });

  it("…dan malah menaruhnya di tanggal 5", () => {
    // Bukan sekadar "hilang": ia muncul di hari yang salah, jadi dua hari
    // sekaligus salah dan tak ada satu pun tanda di layar.
    const dariLama = new Date("2026-08-05T00:00:00Z");
    const sampaiLama = new Date("2026-08-05T23:59:59.999Z");
    expect(subuh >= dariLama && subuh <= sampaiLama).toBe(true);
  });

  it("jendela BARU memuatnya di tanggal 6, dan hanya di tanggal 6", () => {
    const dalam = (tgl: string) =>
      subuh >= awalHariDi(WIB, tgl) && subuh < awalHariDi(WIB, tambahHari(tgl, 1));
    expect(dalam("2026-08-06")).toBe(true);
    expect(dalam("2026-08-05")).toBe(false);
    expect(dalam("2026-08-07")).toBe(false);
  });

  it("batas atas `lt(awal hari berikutnya)` tak membuang milidetik terakhir", () => {
    // Alasan memakai `lt` pada awal hari berikutnya, bukan `lte` pada
    // 23:59:59.999: yang terakhir menebak kehalusan jam, dan tebakan itu
    // salah kalau kolomnya menyimpan mikrodetik (Postgres: memang begitu).
    const akhir = new Date(awalHariDi(WIB, "2026-08-07").getTime() - 1);
    expect(tanggalDi(WIB, akhir)).toBe("2026-08-06");
    expect(akhir < awalHariDi(WIB, "2026-08-07")).toBe(true);
  });
});

describe("riwayat penerimaan menyaring di zona perusahaan", () => {
  const PEN = src("modules/penerimaan/routes.ts");

  it("zona diambil dari perusahaan, bukan dipatok", () => {
    expect(PEN).toContain('const tz = comp?.timezone ?? "Asia/Jakarta";');
  });

  it("batas bawah dan batas atas keduanya lewat awalHariDi", () => {
    expect(PEN).toContain("gte(productions.confirmedAt, awalHariDi(tz, dari))");
    expect(PEN).toContain(
      "lt(productions.confirmedAt, awalHariDi(tz, tambahHari(sampai, 1)))",
    );
  });

  it("tak ada lagi jendela UTC di berkas itu", () => {
    expect(PEN).not.toContain("T00:00:00Z");
    expect(PEN).not.toContain("T23:59:59");
  });

  it("menyaringnya tetap pada SAAT DIPUTUSKAN, bukan waktu faktur dibuat", () => {
    // Perbaikan zona tak boleh diam-diam menggeser kolom yang disaring:
    // orang mencari penerimaan berdasarkan kapan mereka menerimanya.
    expect(PEN).toContain("productions.confirmedAt");
    const i = PEN.indexOf("awalHariDi(tz, dari)");
    expect(i).toBeGreaterThan(0);
    expect(PEN.slice(i - 400, i)).toContain("Disaring pada SAAT DIPUTUSKAN");
  });
});

describe("stok awal ditulis pada awal hari zona perusahaan", () => {
  const STOK = src("modules/stok/routes.ts");

  it("baseline lampau memakai awalHariDi, bukan tengah malam UTC", () => {
    expect(STOK).toContain(
      "const createdAt = tanggal < today ? awalHariDi(tz, tanggal) : new Date();",
    );
  });

  it("tanggal hari-ini tetap memakai waktu kini — perilaku reset tak berubah", () => {
    // Sengaja BUKAN awalHariDi: kalau saldo direset hari ini, mutasi yang sudah
    // terjadi hari ini harus tetap dihitung SETELAH baseline. Menyeragamkannya
    // akan menghidupkan lagi mutasi yang baru saja sengaja ditimpa.
    expect(STOK).toContain(": new Date();");
  });

  it("zona yang dipakai `today` dan `createdAt` adalah zona yang SAMA", () => {
    // Kalau keduanya beda sumber, perbandingan `tanggal < today` bisa memilih
    // cabang yang tidak cocok dengan instant yang lalu ditulis.
    expect(STOK).toContain('const tz = company?.timezone ?? "Asia/Jakarta";');
    expect(STOK).toContain("const today = tanggalDi(tz);");
  });
});

describe("tak ada jembatan tanggal→instant baru yang lewat UTC", () => {
  /**
   * `${x}T00:00:00Z` yang MASIH BOLEH ada, berikut alasannya. Bukan daftar
   * berkas melainkan daftar (berkas, potongan baris), supaya pemakaian KEDUA
   * di berkas yang sama tetap tertangkap.
   *
   * Yang membedakan pemakaian sah dari yang tidak: sah bila hasilnya tak
   * pernah dibandingkan dengan `timestamptz` — entah dipakai memvalidasi teks,
   * atau dipakai beraritmetika hari lalu dikembalikan sebagai teks tanggal
   * lagi (offsetnya saling menghapus).
   */
  const DIIZINKAN: { berkas: string; potongan: string; alasan: string }[] = [
    {
      berkas: "lib/tanggal-query.ts",
      potongan: "const d = new Date(`${s}T00:00:00Z`);",
      alasan:
        "validasi teks: dibulatkan balik ke string dan dibandingkan dengan " +
        "aslinya — hasilnya TAK PERNAH dipakai sebagai batas jendela, cuma " +
        "menjawab 'tanggal ini ada atau tidak'. Ia menggantikan DUA entri " +
        "sebelumnya (absensi & pengajuan) yang kini satu rumah",
    },
    {
      berkas: "modules/pengajuan/routes.ts",
      potongan: "const a = Date.parse(`${mulai}T00:00:00Z`);",
      alasan: "hitung selisih hari — kedua sisi digeser sama, offsetnya saling menghapus",
    },
    {
      berkas: "modules/pengajuan/routes.ts",
      potongan: "const b = Date.parse(`${selesai}T00:00:00Z`);",
      alasan: "pasangan baris di atas",
    },
    {
      berkas: "modules/perlengkapan/routes.ts",
      potongan: "new Date(new Date(`${sampai}T00:00:00Z`).getTime() - 29 * 86_400_000)",
      alasan: "mundur 29 hari lalu di-.slice(0,10) jadi teks tanggal lagi — tak pernah jadi instant",
    },
    {
      berkas: "lib/time.ts",
      potongan: "const naif = Date.parse(`${tanggal}T00:00:00Z`);",
      alasan: "titik awal awalHariDi sendiri — justru ini yang mengoreksinya",
    },
  ];

  function semuaTs(dir: string): string[] {
    const hasil: string[] = [];
    for (const nama of readdirSync(dir)) {
      const p = dir + nama;
      if (statSync(p).isDirectory()) hasil.push(...semuaTs(p + "/"));
      else if (nama.endsWith(".ts")) hasil.push(p);
    }
    return hasil;
  }

  /**
   * Baris komentar dilewati. Catatan sejarah memang MENYEBUT bentuk lamanya —
   * `absensi/routes.ts` menyimpan satu, tentang bug 7 jam yang sama pada
   * `archived_at` — dan menyeret prosa ke daftar DIIZINKAN akan membuat daftar
   * itu bercampur antara "kode yang sah" dan "kalimat yang kebetulan mirip".
   *
   * Penyaringnya sengaja kasar (baris yang DIMULAI dengan penanda komentar),
   * bukan pengurai: komentar di BELAKANG kode tetap ikut terpindai, jadi
   * kekasarannya tak bisa menyembunyikan perbandingan sungguhan.
   */
  const barisKomentar = (b: string) => /^\s*(\/\/|\/?\*)/.test(b);

  it("setiap `T00:00:00Z` di src/ ada di daftar DIIZINKAN berikut alasannya", () => {
    const liar: string[] = [];
    for (const berkas of semuaTs(AKAR)) {
      const rel = berkas.slice(AKAR.length);
      const baris = readFileSync(berkas, "utf8").split("\n");
      baris.forEach((b, i) => {
        if (!b.includes("T00:00:00Z") && !b.includes("T23:59:59")) return;
        if (barisKomentar(b)) return;
        const cocok = DIIZINKAN.some((d) => d.berkas === rel && b.includes(d.potongan));
        if (!cocok) liar.push(`${rel}:${i + 1} ${b.trim()}`);
      });
    }
    expect(
      liar,
      "tanggal dijembatankan ke instant lewat UTC — pakai awalHariDi(tz, …), " +
        "atau tambahkan ke DIIZINKAN bila hasilnya memang tak pernah dibandingkan " +
        "dengan kolom timestamptz",
    ).toEqual([]);
  });

  it("daftar DIIZINKAN tidak menyimpan entri usang", () => {
    // Entri yang barisnya sudah hilang membuat daftar ini terlihat lebih ketat
    // daripada yang sebenarnya ia jaga.
    for (const d of DIIZINKAN) {
      expect(src(d.berkas), `entri usang: ${d.berkas} — ${d.potongan}`).toContain(d.potongan);
    }
  });
});
