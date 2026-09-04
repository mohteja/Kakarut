import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { semuaRute } from "./util/rute";

/**
 * Penjaga DAFTAR YANG DIPOTONG HARUS MENGAKU.
 *
 * Beberapa daftar dibatasi supaya satu layar tak menarik ribuan baris. Itu
 * benar. Yang tidak benar adalah memotongnya diam-diam: daftar pendek terlihat
 * persis seperti daftar yang memang segitu isinya, dan tak ada cara bagi
 * pemakainya membedakan "cuma segini" dari "sisanya tidak dikirim".
 *
 * Rumah ini sudah punya jawabannya — ambil satu baris LEBIH dari batas, lalu
 * kirim penanda `terpotong` di DTO. Kartu stok, kartu FIFO, dan kartu
 * perlengkapan memakainya, dan ketiganya benar-benar menampilkannya di layar.
 *
 * DETAIL SHIFT TERLEWAT, dan justru di sana akibatnya paling tajam. Modal itu
 * menampilkan `jumlah_transaksi` — hitungan SEBENARNYA, dari agregat tanpa
 * batas — tepat di atas daftar yang dipotong 300. Shift berisi 420 transaksi
 * memperlihatkan "Transaksi 420×" lalu "Transaksi (300)" berdampingan: dua
 * angka berbeda untuk hal yang sama, tanpa penjelasan, di layar tempat kasir
 * sedang diminta mempertanggungjawabkan uang. Yang dibaca orang dari selisih
 * itu bukan "daftarnya dipotong" melainkan "120 transaksi saya hilang".
 *
 * YANG TIDAK BERUBAH: uangnya. `penjualan_tunai`, `penjualan_nontunai`, dan
 * `jumlah_transaksi` datang dari agregat terpisah yang tak dibatasi, jadi
 * pemotongan daftar tak pernah menggeser rekap kas. Itu dipatok di bawah —
 * kalau suatu saat rekapnya diambil dari daftar ini, batas 300 berubah dari
 * masalah tampilan menjadi uang yang salah.
 */
const SRV = fileURLToPath(new URL("../src/", import.meta.url));
const WEB = fileURLToPath(new URL("../../web/src/", import.meta.url));
const TIPE = readFileSync(
  fileURLToPath(new URL("../../../packages/shared/src/types.ts", import.meta.url)),
  "utf8",
);
const SHIFT = readFileSync(SRV + "modules/shift/routes.ts", "utf8");
const MODAL = readFileSync(WEB + "components/ShiftDetailModal.tsx", "utf8");

describe("server: daftar transaksi shift tahu kapan dirinya dipotong", () => {
  it("mengambil SATU baris lebih dari batas — itu cara tahunya", () => {
    // Tanpa `+ 1`, `rows.length === BATAS` sama saja artinya "pas 300" dan
    // "300 dari sekian ribu". Pemotongan jadi mustahil dideteksi, dan penanda
    // apa pun di atasnya cuma tebakan.
    expect(SHIFT).toContain("const BATAS_TRANSAKSI_SHIFT = 300;");
    expect(SHIFT).toContain(".limit(BATAS_TRANSAKSI_SHIFT + 1);");
  });

  it("kelebihan baris dibuang, bukan ikut terkirim", () => {
    expect(SHIFT).toContain("const terpotong = rows.length > BATAS_TRANSAKSI_SHIFT;");
    expect(SHIFT).toContain(
      "const dipakai = terpotong ? rows.slice(0, BATAS_TRANSAKSI_SHIFT) : rows;",
    );
  });

  it("penandanya benar-benar sampai ke DTO", () => {
    // Menghitungnya tanpa mengirimkannya persis cacat yang sedang diperbaiki.
    expect(SHIFT).toContain("return { rows: daftar, terpotong };");
    expect(SHIFT).toContain("transaksi_terpotong: tx.terpotong,");
  });

  it("PREMIS: rekap kas TIDAK diambil dari daftar yang dipotong", () => {
    // Inti kenapa perbaikan ini soal kejujuran tampilan, bukan uang. Kalau
    // premis ini gugur, batas 300 berubah jadi rekap kas yang salah — dan uji
    // ini yang harus memberi tahu, bukan kasir yang kebingungan.
    const iAgregat = SHIFT.indexOf("jumlah_transaksi: jumlah };");
    const iDaftar = SHIFT.indexOf("async function transaksiWindow");
    expect(iAgregat, "agregat uang shift tak ditemukan").toBeGreaterThan(0);
    expect(iDaftar, "transaksiWindow tak ditemukan").toBeGreaterThan(iAgregat);
    // Badan transaksiWindow tak boleh menyentuh angka rekap sama sekali.
    const badan = SHIFT.slice(iDaftar, SHIFT.indexOf("\n}", iDaftar));
    for (const uang of ["penjualan_tunai", "penjualan_nontunai", "jumlah_transaksi"]) {
      expect(badan, `transaksiWindow ikut menghitung ${uang}`).not.toContain(uang);
    }
  });
});

describe("web: pemotongan diakui, dan diakui dengan angka yang mendamaikan", () => {
  it("modal membaca penandanya", () => {
    expect(MODAL).toContain("data.transaksi_terpotong");
  });

  it("judulnya menyebut hitungan SEBENARNYA saat dipotong", () => {
    // Bukan sekadar spanduk peringatan: dua angka yang berselisih itu berdiri
    // berdampingan, jadi yang menyembuhkan kebingungan adalah menautkan
    // keduanya — "(300 dari 420)" — bukan menambah kalimat di sebelahnya.
    expect(MODAL).toContain("` dari ${data.jumlah_transaksi}`");
  });

  it("dan menegaskan rekap kas tetap menghitung semuanya", () => {
    // Yang ditakutkan kasir bukan daftarnya pendek, melainkan uangnya kurang.
    expect(MODAL).toContain("Rekap kas");
    expect(MODAL).toContain("{data.jumlah_transaksi} transaksi shift ini");
  });

  it("baris ringkasan yang memakai hitungan sebenarnya TIDAK ikut diubah", () => {
    // Perbaikan ini menambah pengakuan, bukan menyeragamkan kedua angka jadi
    // sama — menurunkan yang atas ke 300 akan membuat rekapnya berbohong.
    expect(MODAL).toContain('<Baris label="Transaksi" value={`${data.jumlah_transaksi}×`} />');
  });
});

/**
 * Dipakai DUA gerbang di bawah, jadi ia tinggal di lingkup modul — bukan
 * disalin. Dua salinan penyapu berkas adalah cara sebuah sapuan pelan-pelan
 * melihat populasi yang berbeda dari saudaranya.
 */
function semuaBerkas(dir: string, ext: string[]): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaBerkas(p + "/", ext));
    else if (ext.some((e) => nama.endsWith(e))) hasil.push(p);
  }
  return hasil;
}

describe("aturan rumah: tiap penanda `terpotong` di DTO wajib dibaca web", () => {
  /**
   * Inilah yang seharusnya menangkap bug ini sejak awal. Penanda pemotongan
   * yang dihitung server tapi tak pernah dibaca layar sama saja dengan tidak
   * ada — dan cacatnya tak kelihatan dari sisi mana pun sendirian: server
   * tampak benar (ia menghitungnya), web tampak benar (ia tak tahu ada).
   */
  const medanTerpotong = [
    ...new Set(
      [...TIPE.matchAll(/^\s{2}(\w*terpotong\w*)\??:/gm)].map((m) => m[1]),
    ),
  ];

  it("daftar penandanya tidak kosong (penyapunya masih menemukan sesuatu)", () => {
    // Kalau pola penamaannya berubah, sapuan di bawah diam-diam jadi hampa —
    // hijau yang tak membuktikan apa pun.
    expect(medanTerpotong.length).toBeGreaterThanOrEqual(2);
    expect(medanTerpotong).toContain("terpotong");
    expect(medanTerpotong).toContain("transaksi_terpotong");
  });

  const isiWeb = semuaBerkas(WEB, [".ts", ".tsx"])
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  for (const medan of medanTerpotong) {
    it(`\`${medan}\` dibaca di apps/web`, () => {
      expect(
        isiWeb.includes(medan),
        `DTO mengirim \`${medan}\` tapi tak satu layar pun membacanya — ` +
          "pemakainya tak punya cara tahu daftarnya dipotong",
      ).toBe(true);
    });
  }
});

/**
 * ATURAN RUMAH KEDUA: rute yang MEMOTONG wajib punya pembacanya di layar.
 *
 * Yang di atas menagih penanda berbentuk MEDAN DTO (`*_terpotong` di
 * `types.ts`). Bentuk keduanya — header `X-Kakarut-Terpotong` untuk balasan
 * larik telanjang — tak punya penagih sama sekali, dan justru bentuk itulah
 * yang bertambah TUJUH dalam satu putaran. Lubangnya bukan hipotesis: utang
 * yang sudah tercatat di ledger berbunyi persis begitu — `GET /stok/penyesuaian`
 * mengirim headernya sejak lama, dan sisi ponselnya belum merendernya.
 *
 * Cacat ini tak kelihatan dari sisi mana pun sendirian, sama seperti saudara
 * kandungnya di atas: server tampak benar (ia memasang headernya), web tampak
 * benar (ia tak tahu ada header).
 *
 * BATAS YANG DIAKUI:
 * 1. "Dibaca" di sini berarti ADA berkas web yang menyebut jalur rutenya DAN
 *    memakai `bacaHeader`. Ia tak membuktikan spanduknya benar-benar
 *    dirender — itu pekerjaan uji layar, bukan sapuan teks.
 * 2. Jalur dicocokkan sebagai teks. Rute berparameter (`:id`) tak dipakai
 *    idiom ini hari ini; kalau kelak dipakai, pencocokannya harus diperbaiki,
 *    bukan pengecualiannya ditambah.
 */
describe("aturan rumah: rute yang memotong wajib mengumumkannya, dan layar wajib membacanya", () => {
  /**
   * Rute yang TIDAK bisa memenuhi aturan di atas, terdaftar beserta sebabnya.
   * Bukan "belum sempat" — tiap entri menyebut fakta yang bisa diperiksa.
   */
  const TAK_BERPEMBACA: Record<string, string> = {
    "GET /stok/opname":
      "Tak ada klien yang membacanya hari ini: tak satu pun berkas di apps/web " +
      "memanggilnya, dan docs/API-CONTRACT.md pun tak menyebutnya (ia hanya " +
      "diketuk verify-api). Headernya tetap dipasang karena murah dan benar.",
    "GET /stok/penyesuaian":
      "Rute HANYA-PONSEL: ia ADA di docs/API-CONTRACT.md (baris ~1376) tapi " +
      "tak satu pun layar apps/web memanggilnya. Headernya dikirim sejak lama " +
      "dan sisi ponselnya BELUM merendernya — utang yang sudah terdaftar di " +
      "docs/audit/vena-audit.md, dan repo ponselnya berumah lain.",
  };

  const rute = semuaRute().filter((r) => /\bpotongLarik\s*\(/.test(r.isi));
  const jalur = rute.map((r) => `${r.metode} ${r.jalur}`).sort();

  it("PREMIS: sapuannya benar-benar menemukan rute yang memotong", () => {
    // Nol berarti pemindainya rusak (atau `potongLarik` berganti nama), bukan
    // repo yang bersih — bentuk kegagalan yang sudah menggigit repo ini.
    expect(jalur.length).toBeGreaterThanOrEqual(9);
  });

  it("DIPAKU: pintu-pintu yang sudah dibayar memang mengumumkan potongannya", () => {
    // Menghapus entri dari daftar adjudikasi `potong-berpenanda` saja tak
    // menahan apa pun — begitu `potongLarik` dicabut dari salah satu rute ini,
    // situsnya kembali "senyap" dan yang merah cuma pesan yang menyuruh
    // MENDAFTARKANNYA. Baris di bawah membuat pencabutannya memerah di sini
    // lebih dulu, dengan kalimat yang menunjuk rutenya.
    for (const w of [
      "GET /shift",
      "GET /stok/exp",
      "GET /stok/opname/riwayat",
      "GET /stok/opname",
      "GET /perlengkapan/opname/riwayat",
      // `GET /perlengkapan/beli` KELUAR dari daftar ini 2026-09-04, dan itu
      // bukan pencabutan penanda melainkan penggantiannya dengan yang lebih
      // kuat: rutenya kini BERHALAMAN dan membawa `total` (cacah faktur atas
      // seluruh populasi) di dalam badan balasannya. `potongLarik` memasang
      // penandanya lewat HEADER — cukup untuk larik telanjang, tapi header
      // bisa hilang di proxy dan tak bisa menyebut BERAPA yang tak ikut.
      // Penjaganya pindah ke `beli-perlengkapan-berhalaman.test.ts` +
      // verify-api §294, yang menuntut invarian partisi `ringkas` dan telusur
      // seluruh halaman.
      "GET /perlengkapan/kiriman",
      // Ditambahkan 2026-09-03. Bukan bagian dari tujuh yang dibayar
      // 2026-08-31: panel log galat memotong daftarnya di 200 sejak awal, tapi
      // penandanya tak pernah ada — dan kartu "Masalah berbeda" malah
      // menghitung larik yang sudah terpotong itu, jadi angkanya berhenti
      // bertambah diam-diam. Ditemukan saat pemilik repo bertanya soal panel
      // ini, bukan oleh sapuan.
      "GET /admin/error-log",
    ]) {
      expect(jalur, `${w} berhenti memanggil potongLarik`).toContain(w);
    }
  });

  /**
   * SATU BARIS LEBIH, dipaku — sebab tanpa itu `potongLarik` jadi hiasan.
   *
   * `potongLarik` memasang headernya hanya bila `rows.length > batas`. Kueri
   * yang mengambil TEPAT `batas` baris karena itu tak pernah memicunya: rutenya
   * memotong seperti biasa, gerbang "sudah pakai potongLarik" tetap hijau, dan
   * penandanya TAK PERNAH menyala walau daftarnya benar-benar terpotong.
   * Mencabut satu karakter `+ 1` cukup untuk mengembalikan seluruh cacat yang
   * putaran ini bayar, tanpa satu asersi pun berubah warna.
   *
   * BATASNYA: yang diperiksa keberadaan `<BATAS> + 1` di suatu tempat di
   * `src`, bukan bahwa ia ada di kueri yang benar-benar memberi makan rute ini
   * — tiga pintu perlengkapan memang mengambilnya di `service.ts`, satu hop
   * dari rutenya.
   */
  const sumberSrv = semuaBerkas(SRV, [".ts"]).map((f) => readFileSync(f, "utf8")).join("\n");

  /**
   * Rute yang memotong dengan bentuk LAIN, terdaftar beserta sebabnya.
   * Bukan pengecualian gratis: tiap entri menyebut fakta yang bisa dibuka.
   */
  const BUKAN_AMBIL_LEBIH: Record<string, string> = {
    "GET /shift/selisih":
      "Penyaringannya terjadi SESUDAH query (status dihitung di JS), jadi ia " +
      "mengambil langit-langit `AMBIL_SELISIH` yang lebih besar dari " +
      "`BATAS_SELISIH` lalu menyaring. Dua sebab pemotongan, dan rutenya " +
      "mengumumkan KEDUANYA — `potongLarik` untuk hasil saring yang kepanjangan, " +
      "dan `c.header(HEADER_TERPOTONG, …)` eksplisit saat kuerinya sendiri " +
      "menyentuh langit-langit. Komentar di rutenya menuliskannya panjang.",
  };

  for (const r of rute) {
    const kunciR = `${r.metode} ${r.jalur}`;
    // Multibaris: `potongLarik(` sering dipecah beberapa baris oleh formatter,
    // dan regex satu baris menyatakan batasnya "tak terbaca" pada rute yang
    // justru benar. Terukur saat gerbang ini ditulis: `/stok/penyesuaian`.
    const batas = /potongLarik\s*\(\s*c\s*,[\s\S]+?,\s*([A-Za-z_$][\w$]*)\s*,?\s*\)/.exec(
      r.isi,
    )?.[1];
    it(`\`${kunciR}\` mengambil SATU BARIS LEBIH dari batasnya`, () => {
      if (BUKAN_AMBIL_LEBIH[kunciR]) {
        expect(BUKAN_AMBIL_LEBIH[kunciR].length).toBeGreaterThan(60);
        return;
      }
      expect(batas, `batas potongLarik di ${r.jalur} tak terbaca`).toBeDefined();
      expect(
        sumberSrv.includes(`${batas} + 1`),
        `${r.jalur} memotong di ${batas} tapi tak ada kueri yang mengambil ` +
          `\`${batas} + 1\` — headernya takkan pernah menyala, dan pemotongannya ` +
          "kembali senyap tanpa satu asersi pun berubah warna",
      ).toBe(true);
    });
  }

  const berkasWeb = semuaBerkas(WEB, [".ts", ".tsx"]).map((f) => readFileSync(f, "utf8"));

  for (const r of rute) {
    const kunci = `${r.metode} ${r.jalur}`;
    const alasan = TAK_BERPEMBACA[kunci];
    it(`\`${kunci}\` — potongannya sampai ke layar`, () => {
      /*
       * Jalur berparameter dicocokkan PER POTONGAN LITERAL, bukan utuh: web
       * menulis `/menu/${row.id}/riwayat-harga`, jadi mencari `/menu/:id/…`
       * apa adanya akan menuduh layar yang justru sudah benar. Versi pertama
       * gerbang ini melakukannya, dan `AnalisisHargaPage` yang sudah membaca
       * headernya sejak lama tertuduh.
       */
      const potongan = r.jalur.split(/\/:[^/]+/).filter(Boolean);
      /*
       * BATAS SEGMEN pada potongan TERAKHIR, dan itu bukan kerapian: tanpa
       * batasnya `/stok/opname` cocok dengan `/stok/opname/riwayat` yang
       * memang sudah dibaca — jadi rute yang benar-benar tak berpembaca
       * dinyatakan "sudah dibaca" oleh tetangganya sendiri. Terukur: entri
       * TAK_BERPEMBACA-nya tertuduh basi padahal tidak.
       */
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const akhir = new RegExp(esc(potongan[potongan.length - 1]) + "(?=[`\"'?$)])", "g");
      const awal = potongan.slice(0, -1);
      /*
       * `bacaHeader` dicari di PANGGILAN YANG SAMA, bukan di berkas yang sama —
       * dan bedanya sudah menggigit saat gerbang ini ditulis. `StokPage.tsx`
       * menyebut "/stok/opname" sebagai tautan navigasi DAN memakai
       * `bacaHeader` untuk `/stok/exp`; syarat se-berkas menyatakan rute yang
       * benar-benar tak berpembaca "sudah dibaca".
       *
       * Jendelanya dipotong sampai panggilan `api(` BERIKUTNYA, bukan sekian
       * ratus aksara — batas yang bergeser saat kodenya tumbuh adalah cara
       * gerbang berhenti berlaku tanpa ada yang memutuskan begitu.
       */
      const dibacaDi = (isi: string) => {
        if (!awal.every((k) => isi.includes(k))) return false;
        akhir.lastIndex = 0;
        for (let m = akhir.exec(isi); m; m = akhir.exec(isi)) {
          const mulai = m.index;
          const lanjut = isi.slice(mulai + 1).search(/\bapi[<(]/);
          const jendela = isi.slice(mulai, lanjut < 0 ? undefined : mulai + 1 + lanjut);
          if (jendela.includes("bacaHeader")) return true;
        }
        return false;
      };
      const ada = berkasWeb.some(dibacaDi);
      if (alasan) {
        expect(
          ada,
          `${kunci} terdaftar TAK BERPEMBACA tapi ternyata sudah dibaca — hapus entrinya`,
        ).toBe(false);
        expect(alasan.length, `alasan ${kunci} terlalu pendek`).toBeGreaterThan(60);
        return;
      }
      expect(
        ada,
        `${kunci} memotong daftarnya lewat potongLarik, tapi tak satu berkas web pun ` +
          "memanggil jalur itu SEKALIGUS memakai `bacaHeader` — pemakainya tak punya cara " +
          "tahu daftarnya dipotong. Pasang pembacanya, atau daftarkan di TAK_BERPEMBACA " +
          "dengan sebab yang bisa diperiksa.",
      ).toBe(true);
    });
  }
});
