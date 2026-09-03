import { describe, expect, it } from "vitest";
import { situsPotong, type Situs } from "./util/potong";

/**
 * DAFTAR YANG DIPOTONG WAJIB MENGATAKANNYA.
 *
 * Empat putaran menutup satu kelas di tiga permukaan klien: bacaan yang GAGAL
 * menyamar jadi "tidak ada". Gerbang ini menjaga saudara kandungnya di
 * kontrak server→klien: **bacaan yang TERPOTONG menyamar jadi LENGKAP.**
 *
 * Aturannya bukan karangan gerbang ini. Ia sudah ditulis panjang di
 * `src/modules/customer/routes.ts:50` dan idiomnya sudah dipakai — dua idiom,
 * malah: kunci badan `*_terpotong` untuk balasan berbentuk objek, dan header
 * `X-Kakarut-Terpotong` untuk balasan berbentuk larik telanjang (bentuk larik
 * TIDAK BOLEH berubah: build ponsel lama membacanya `as List`, dan repo ini
 * tak punya gerbang versi klien). Keduanya kini serumah di `src/lib/potong.ts`.
 *
 * Sapuan 2026-08-27 atas seluruh `src/`:
 *
 * | kelas | angka |
 * |---|---|
 * | situs pemotongan (`.limit()` Drizzle + `LIMIT` di templat `sql`) | **86** di 36 berkas |
 * | · `SATU` — ambil satu baris, bukan memotong | 46 |
 * | · `BERPENANDA` / `HALAMAN` | 15 / 2 |
 * | · **`SENYAP`** | **27 → 23** |
 *
 * Empat pintu diperbaiki putaran ini; 23 sisanya diadjudikasi satu per satu
 * dan terdaftar di bawah dengan KELASNYA.
 */
type Kelas =
  /** Kosongnya punya arti yang benar, dan alasannya bisa DITUNJUK. */
  | "sah"
  /** Masih memotong diam-diam. Diakui, dihitung, tak boleh tumbuh. */
  | "utang";

interface Alasan {
  kelas: Kelas;
  jumlah: number;
  teks: string;
}

/**
 * Utang yang diakui, dalam SITUS. Wajib TURUN begitu terbayar.
 *
 * NOL sejak 2026-08-31 — kedelapan pemotongan senyap terakhir dibayar dalam
 * satu putaran, dan nolnya berarti sesuatu yang bisa diperiksa: tiap
 * pemotongan di `src` entah mengumumkan dirinya (header atau kunci badan),
 * entah terdaftar `sah` beserta alasan kenapa kosongnya punya arti yang benar.
 *
 * Ia TIDAK berarti tak ada pemotongan lain di luar populasi yang disapu
 * `util/potong.ts` — batasnya ditulis di sana, dan `slice`/`take` murni di JS
 * tetap tak terlihat.
 */
const MAKS_UTANG = 0;

/** kunci: `berkas` → teks argumen `.limit(…)` → alasan. */
const daftar: Record<string, Record<string, Alasan>> = {
  "modules/mail/service.ts": {
    BATAS_PERCOBAAN_EMAIL: {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Potongannya BUKAN klaim kelengkapan, sebab yang di baliknya juga " +
        "bukan: tabelnya sendiri CINCIN 200 baris — baris ke-201 tak " +
        "tersembunyi, ia sudah tak ada. Angkanya disebut apa adanya di layar " +
        "('200 percobaan terakhir'), dan riwayat kirim email selalu tentang " +
        "beberapa jam terakhir; menyimpan selamanya cuma menumbuhkan tabel " +
        "berisi alamat orang tanpa ada yang membacanya.",
    },
  },
  "modules/admin-error-log/routes.ts": {
    "LIMIT_KELOMPOK + 1": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "SUDAH TIDAK SENYAP sejak 2026-09-03 — pemindai ini yang tak bisa " +
        "melihatnya. Pemotongannya diumumkan `potongLarik(c, kelompok, " +
        "LIMIT_KELOMPOK)` di HANDLER-nya, satu hop dari situs `.limit()` ini, " +
        "jadi header `X-Kakarut-Terpotong` memang terkirim dan `ErrorLogPage` " +
        "merendernya. Sebelumnya entri ini berbunyi 'tiap kelompok membawa " +
        "jumlah kejadiannya sendiri, jadi tak ada angka yang mengecil karena " +
        "potongan' — dan itu ternyata keliru: kartu 'Masalah berbeda' justru " +
        "dihitung dari larik yang sudah dipotong, jadi ia berhenti bertambah " +
        "diam-diam di 200. Kini ia dihitung SQL atas populasi penuh.",
    },
    LIMIT_KEJADIAN: {
      kelas: "sah",
      jumlah: 1,
      teks: "Sama: kejadian TERBARU dari satu sidik jari galat, bukan arsipnya.",
    },
  },
  "modules/admin-system/routes.ts": {
    "50": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Riwayat cadangan. Komentarnya sendiri sudah menyebut batasnya — " +
        '"Konfigurasi + riwayat cadangan (50 terbaru)" — dan yang menentukan ' +
        "sehat/tidaknya cadangan bukan panjang daftar melainkan " +
        "`backupSuksesTerakhir()` yang dihitung TERPISAH tanpa batas.",
    },
  },
  "modules/bahan/routes.ts": {
    "5": {
      kelas: "sah",
      jumlah: 3,
      teks:
        "Saran/‘lima terakhir’ di formulir — bukan daftar yang mengaku " +
        "lengkap. Lima yang muncul memang dimaksudkan lima, dan tak ada " +
        "keputusan yang diambil dari panjangnya.",
    },
  },
  "modules/customer/routes.ts": {
    "8": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Autocomplete pencarian member: delapan tebakan teratas atas kata " +
        "yang sedang diketik. Melengkapinya bukan tujuannya — dan pencarian " +
        "penuh sudah disediakan di pintu daftarnya, yang berpenanda.",
    },
  },
  "modules/kebersihan/routes.ts": {
    limit: {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Batasnya datang dari PEMANGGIL, dan `limit = 0` berarti tanpa batas " +
        "— komentar pembantunya menuliskannya. Yang memutuskan memotong " +
        "adalah pintu di atasnya, jadi di situlah penandanya harus dinilai, " +
        "bukan di sini.",
    },
  },
  "modules/meja/routes.ts": {
    "50": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Log ‘meja dikosongkan’ untuk SATU meja. Lima puluh entri per meja " +
        "praktis tak pernah tercapai, dan layarnya jejak audit — bukan " +
        "antrean yang harus dikosongkan.",
    },
  },
  "modules/perlengkapan/service.ts": {
    /*
     * KETIGANYA BERBENTUK SAMA, dan bentuknya sudah punya preseden di berkas
     * ini: `stok/service.ts` → `ambilEvents`. Servicenya MENGAMBIL `BATAS + 1`;
     * yang memotong dan memasang headernya routes-nya, sebab `Context` hidup
     * di sana. Pemindai ini berlingkup satu FUNGSI — batas yang ditulis
     * terang-terangan di `util/potong.ts` — jadi ia tak bisa melihat satu hop
     * ke pemanggil.
     *
     * Yang membuat ketiga entri ini bukan janji kosong: gerbang
     * "rute yang memotong WAJIB mengumumkannya" di `pemotongan-terungkap`
     * MEMAKU ketiga rutenya. Mencabut `potongLarik` dari salah satunya
     * memerahkan gerbang itu, bukan diam-diam membuat entri ini jadi bohong.
     */
    "BATAS_OPNAME_PERLENGKAPAN + 1": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Riwayat sesi opname perlengkapan. Penandanya ADA, hanya tidak di " +
        "fungsi ini: `GET /perlengkapan/opname/riwayat` memanggil " +
        "`potongLarik(c, rows, BATAS_OPNAME_PERLENGKAPAN)` — dan rute itu " +
        "dipaku gerbang 'rute yang memotong wajib mengumumkannya'.",
    },
    "BATAS_BELI_PERLENGKAPAN + 1": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Daftar pembelian perlengkapan. Sama: `GET /perlengkapan/beli` yang " +
        "memanggil `potongLarik`. Urutannya menaruh yang butuh aksi di atas, " +
        "jadi yang terpotong justru ekor riwayatnya — dan kini dikatakan.",
    },
    "BATAS_KIRIMAN_PERLENGKAPAN + 1": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Riwayat kiriman perlengkapan antar cabang. Sama: " +
        "`GET /perlengkapan/kiriman` yang memanggil `potongLarik`. Cabang " +
        "penerima memakai layar ini untuk memastikan kirimannya tercatat.",
    },
  },
  "modules/pesanan/routes.ts": {
    "200": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Log aksi untuk SATU bill/penjualan. Dua ratus langkah pada satu bill " +
        "tak pernah terjadi; batas ini langit-langit pengaman, bukan potongan " +
        "yang benar-benar menggigit.",
    },
  },
  "modules/profil/routes.ts": {
    "50": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "‘Aktivitas faktur saya’ di halaman profil sendiri — 50 terakhir, " +
        "dan tak ada keputusan yang diambil dari panjangnya. Jejak penuhnya " +
        "ada di pintu admin.",
    },
  },
  "modules/rekomendasi/service.ts": {
    "8": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Delapan saran pembelian teratas. Ini memang daftar SARAN; " +
        "melengkapinya justru akan membuatnya tak terpakai.",
    },
  },
  "modules/stok/service.ts": {
    "${BATAS_EVENT_FIFO + 1}": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Penandanya ADA, hanya tidak di fungsi ini: `ambilEvents` memotong, " +
        "dan pemanggilnya merakit `terpotong: eventTerpotong || …` " +
        "(`service.ts:833`) yang ikut dikirim kartu FIFO. Pemindai ini " +
        "berlingkup satu fungsi — batas yang ditulis di `util/potong.ts`, " +
        "dan situs inilah yang membuatnya perlu ditulis.",
    },
  },
  // `modules/transfer/routes.ts` DULU di sini sebagai UTANG: "berhalaman lewat
  // per_page di query, tapi balasannya tak memuat total maupun penanda".
  // Dibayar 2026-08-27 — pintu itu ternyata tidak berhalaman sama sekali
  // melainkan daftar ber-langit-langit, jadi yang benar penanda pemotongan
  // (`rows_terpotong`), bukan nomor halaman. Batasnya ikut turun.
  "modules/shift/routes.ts": {
    "(perluHitung ? AMBIL_SELISIH : BATAS_SELISIH) + 1": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Batasnya ada di `antreanSelisih`, PENANDANYA di kedua pemanggilnya — " +
        "dan itu memang tempat yang benar untuk menilainya, sama seperti " +
        "`modules/kebersihan/routes.ts` di atas. `GET /shift/selisih` " +
        "mengatakannya lewat `HEADER_TERPOTONG` + `potongLarik`; " +
        "`GET /shift/selisih/ringkas` lewat medan `terpotong` pada DTO-nya. " +
        "Situs ini dulu terbaca BERPENANDA karena batas & penandanya berada " +
        "di satu fungsi; keduanya dipisah saat ringkasnya lahir (2026-09-03) " +
        "supaya aturan 'menunggu' hanya punya satu rumah — pemindainya yang " +
        "kehilangan jejak, bukan pintunya yang jadi bisu.",
    },
  },
  "modules/users/routes.ts": {
    "100": {
      kelas: "sah",
      jumlah: 1,
      teks:
        "Aktivitas faktur satu karyawan di panel admin — 100 terakhir. " +
        "Jejak audit yang dibaca berurutan, bukan angka yang dihitung.",
    },
  },
};

const semua = situsPotong();
const tertuduh = semua.filter((x) => x.kelas === "SENYAP");
const cari = (x: Situs): Alasan | undefined => daftar[x.berkas]?.[x.argumen];

describe("daftar yang dipotong wajib mengatakannya", () => {
  it("PREMIS: kedua bentuk benar-benar tersapu", () => {
    const drizzle = semua.filter((x) => x.bentuk === "drizzle");
    const mentah = semua.filter((x) => x.bentuk === "sql");
    // Kalau salah satu anjlok, pemindainya buta dan hijaunya bohong.
    expect(semua.length).toBeGreaterThanOrEqual(75);
    expect(drizzle.length).toBeGreaterThanOrEqual(55);
    expect(mentah.length).toBeGreaterThanOrEqual(12);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThanOrEqual(30);
  });

  it("PREMIS: idiom yang sudah dipakai TERBACA sebagai berpenanda", () => {
    // Nol di sini bukan temuan melainkan kebutaan — dan generasi pertama
    // pemindai ini melaporkan persis nol sementara enam pintu memakainya.
    const ber = semua.filter((x) => x.kelas === "BERPENANDA");
    expect(ber.length).toBeGreaterThanOrEqual(12);
    const berkas = new Set(ber.map((x) => x.berkas));
    for (const b of [
      "modules/customer/routes.ts",
      "modules/bahan/routes.ts",
      "modules/shift/routes.ts",
      "modules/sampah/routes.ts",
      "modules/supplier/routes.ts",
    ]) {
      expect(berkas, `${b} memakai idiomnya tapi tak terbaca`).toContain(b);
    }
  });

  it("tiap pemotongan yang senyap sudah diadjudikasi", () => {
    const liar = tertuduh
      .filter((x) => cari(x) === undefined)
      .map((x) => `${x.berkas}:${x.baris} [${x.bentuk}] limit(${x.argumen})`);
    expect(
      liar,
      "Pemotongan daftar yang tak mengatakan apa-apa:\n" +
        liar.join("\n") +
        "\n\nPilih SATU: (a) pakai `potongLarik(c, rows, BATAS)` dari " +
        "`src/lib/potong.ts` untuk balasan berupa LARIK (penandanya lewat " +
        "header, jadi klien lama tak berubah); (b) tambahkan kunci " +
        "`<sesuatu>_terpotong` untuk balasan berupa OBJEK; atau (c) daftarkan " +
        "di `daftar` dengan KELAS-nya — `sah` bila potongannya bukan klaim " +
        "kelengkapan, `utang` bila iya (dan naikkan `MAKS_UTANG` dengan sengaja).",
    ).toEqual([]);
  });

  it("daftarnya ditagih dua arah — tak ada entri kuburan, jumlahnya cocok", () => {
    const nyata = new Map<string, Map<string, number>>();
    for (const x of tertuduh) {
      const per = nyata.get(x.berkas) ?? new Map<string, number>();
      per.set(x.argumen, (per.get(x.argumen) ?? 0) + 1);
      nyata.set(x.berkas, per);
    }
    const salah: string[] = [];
    for (const [berkas, per] of Object.entries(daftar)) {
      for (const [arg, a] of Object.entries(per)) {
        const n = nyata.get(berkas)?.get(arg) ?? 0;
        if (n === 0) salah.push(`${berkas} → limit(${arg}): sudah tak ada situsnya — hapus entrinya`);
        else if (n !== a.jumlah) salah.push(`${berkas} → limit(${arg}): terdaftar ${a.jumlah}, sekarang ${n}`);
        if (a.teks.trim().length < 60) salah.push(`${berkas} → limit(${arg}): alasannya terlalu pendek untuk dipercaya`);
      }
    }
    expect(salah, salah.join("\n")).toEqual([]);
  });

  it("UTANG-nya dihitung, dan tak boleh tumbuh diam-diam", () => {
    const utang = tertuduh.filter((x) => cari(x)?.kelas === "utang");
    const n = utang.reduce((a) => a + 1, 0);
    expect(
      n,
      `Utang pemotongan-senyap naik jadi ${n} (batas ${MAKS_UTANG}):\n` +
        utang.map((x) => `  ${x.berkas}:${x.baris} limit(${x.argumen})`).join("\n") +
        "\n\nKalau memang disengaja, naikkan MAKS_UTANG DI DIFF YANG SAMA.",
    ).toBeLessThanOrEqual(MAKS_UTANG);
    // Batas yang tak pernah turun berhenti jadi batas.
    expect(MAKS_UTANG - n, `utang nyata ${n}, batasnya ${MAKS_UTANG} — turunkan batasnya`).toBeLessThanOrEqual(1);
  });

  // ---- PREMIS & PASANGAN pemindainya ------------------------------------

  it("PREMIS: pemindainya BISA menuduh, di kedua bentuk", () => {
    const s = situsPotong({
      "uji/a.ts": "function f(){ const r = db.select().from(t).limit(50); return c.json(r); }\n",
      "uji/b.ts": "const r = await db.execute(sql`SELECT 1 FROM t LIMIT 300`);\n",
    });
    expect(s.length).toBe(2);
    expect(s.every((x) => x.kelas === "SENYAP")).toBe(true);
    expect(s.map((x) => x.bentuk).sort()).toEqual(["drizzle", "sql"]);
  });

  it("PASANGAN: `.limit(1)` dan `LIMIT 1` bukan pemotongan daftar", () => {
    const s = situsPotong({
      "uji/satu.ts":
        "const [row] = await db.select().from(t).limit(1);\n" +
        "const x = await db.execute(sql`SELECT 1 FROM t LIMIT 1`);\n",
    });
    expect(s.length).toBe(2);
    expect(s.every((x) => x.kelas === "SATU")).toBe(true);
  });

  it("PASANGAN: ketiga cara mengatakan `terpotong` diterima", () => {
    const s = situsPotong({
      // (a) kunci badan
      "uji/badan.ts":
        "function f(){ const r = q.limit(BATAS + 1); return c.json({ rows: r, rows_terpotong: true }); }\n",
      // (b) header lewat tetapan bersama
      "uji/header.ts":
        "function f(){ const r = q.limit(BATAS + 1); if (x) c.header(HEADER_TERPOTONG, '1'); return c.json(r); }\n",
      // (c) pembantu bersama
      "uji/bantu.ts":
        "function f(){ const r = q.limit(BATAS + 1); return c.json(potongLarik(c, r, BATAS)); }\n",
    });
    expect(s.length).toBe(3);
    expect(s.map((x) => x.kelas)).toEqual(["BERPENANDA", "BERPENANDA", "BERPENANDA"]);
  });

  it("PASANGAN: kunci `total` SENDIRIAN bukan tanda berhalaman", () => {
    // Pembebasan palsu yang nyata: `sampah` memotong 300 lalu memulangkan
    // objek ber-kunci `total` — yang di situ berarti RUPIAH.
    const s = situsPotong({
      "uji/uang.ts":
        "function f(){ const r = q.limit(300); return c.json({ rows: r, total: 5000 }); }\n",
    });
    expect(s[0].kelas).toBe("SENYAP");
  });

  it("PASANGAN: `page`/`per_page` diterima sebagai berhalaman", () => {
    const s = situsPotong({
      "uji/hal.ts":
        "function f(){ const r = q.limit(perPage); return c.json({ rows: r, total: 9, page, per_page: perPage }); }\n",
    });
    expect(s[0].kelas).toBe("HALAMAN");
  });

  it("PREMIS: kata LIMIT di dalam KOMENTAR bukan situs", () => {
    const s = situsPotong({
      "uji/prosa.ts": "// dulu: LIMIT 300 di sini\nconst x = 1;\n",
    });
    expect(s).toEqual([]);
  });

  it("PREMIS: barisnya menunjuk `.limit`, bukan awal rantai kuerinya", () => {
    // Generasi pertama melaporkan awal `db.select(...)` — meleset 10–20 baris.
    const s = situsPotong({
      "uji/rantai.ts":
        "const r = await db\n  .select()\n  .from(t)\n  .where(w)\n  .orderBy(o)\n  .limit(50);\n",
    });
    expect(s[0].baris).toBe(6);
  });
});
