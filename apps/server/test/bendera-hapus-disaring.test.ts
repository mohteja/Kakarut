import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { situsBendera, type Situs } from "./util/bendera-hapus";
import { SRC, berkasTs } from "./util/sql-mentah";

/**
 * BARIS YANG SUDAH DINYATAKAN TIDAK BERLAKU — dan pintu yang lupa menyaringnya.
 *
 * Basis data ini punya bendera untuk itu, dan sampai vena ini tak satu pun
 * punya rumah: `isNull(sales.deletedAt)` ditulis ulang 23 kali,
 * `productions.deletedAt` 26 kali, `memberships.archivedAt` 22 kali. Delapan
 * puluhan salinan aturan yang sama, tanpa gerbang.
 *
 * EMPAT PINTU LUPA, dan keempatnya menugaskan PEKERJAAN — terukur lewat HTTP
 * sebelum dituduh:
 *
 *   POST /produksi/faktur      worker = karyawan yang sudah keluar → 201
 *   PATCH /produksi/faktur/:k  worker = karyawan yang sudah keluar → 200
 *   POST /rekomendasi/menu/faktur                                  → 201
 *   PUT  /penyimpanan/:id/petugas                                  → 200
 *
 * Yang terakhir paling telanjang: balasannya sendiri memuat `"aktif": false`
 * tepat di sebelah penugasan yang baru saja diterimanya. Layarnya tahu;
 * pintunya tidak.
 *
 * Yang rusak BUKAN aksesnya — orang itu sudah tak bisa login, `session.ts`
 * menyaringnya. Yang rusak PEMBUKUANNYA: dokumen yang lahir sesudah ia
 * berhenti menyebut namanya, dan tak ada satu pun galat yang muncul.
 */

/**
 * Situs TELANJANG yang sengaja dibiarkan, dengan alasan yang bisa diperiksa.
 *
 * Kunci berkas + JUMLAH, bukan nomor baris: nomor baris bergeser tiap kali
 * ada yang menyunting berkasnya, dan daftar yang basi tiap commit akan
 * dilonggarkan orang, bukan dipatuhi. Jumlahnya tetap meratchet — situs
 * telanjang BARU di berkas yang sama menaikkan hitungannya dan menagih
 * keputusan.
 */
const DIPILAH_TANGAN = new Map<string, { situs: number; alasan: string }>([
  [
    "modules/absensi/routes.ts",
    {
      situs: 1,
      alasan:
        "leftJoin memberships untuk memajang CABANG pemilik absen. Menyaringnya akan " +
        "MENGHILANGKAN riwayat absen karyawan yang sudah keluar — riwayat yang membuang " +
        "barisnya sendiri lebih buruk daripada riwayat tanpa nama cabang",
    },
  ],
  [
    "modules/admin-tenants/routes.ts",
    {
      situs: 1,
      alasan:
        "panel SUPER ADMIN: daftar anggota satu tenant untuk keperluan platform. Yang " +
        "diarsipkan tetap anggota tenant itu secara pembukuan, dan panelnya bukan pintu penugasan",
    },
  ],
  [
    "modules/dokumen/nomor.ts",
    {
      situs: 2,
      alasan:
        "backfill penomoran dokumen saat boot: faktur yang sudah dibuang tetap butuh nomornya " +
        "supaya nomor tak pernah dipakai ulang. Menyaring di sini justru melahirkan nomor kembar",
    },
  ],
  [
    "modules/pengajuan/routes.ts",
    {
      situs: 2,
      alasan:
        "leftJoin memberships untuk memajang peran & cabang pengaju. Sama seperti absensi: " +
        "pengajuan cuti karyawan yang kemudian keluar tetap harus terbaca di riwayat",
    },
  ],
  [
    "modules/penjualan/refund.ts",
    {
      situs: 1,
      alasan:
        "membaca sale_items lewat saleId yang induknya SUDAH diperiksa sebaris di atas " +
        "(refund.ts:75 memuat isNull(sales.deletedAt)) — satu hop, bukan pintu kedua",
    },
  ],
  [
    "modules/penjualan/rekalkulasi.ts",
    {
      situs: 1,
      alasan:
        "sale_items lewat saleId yang induknya diperiksa di rekalkulasi.ts:135 " +
        "(isNull(sales.deletedAt) + FOR UPDATE) — satu hop di dalam transaksi yang sama",
    },
  ],
  [
    "modules/penjualan/routes.ts",
    {
      situs: 3,
      alasan:
        "dua bacaan sale_items lewat sale yang sudah dipilih kueri ber-isNull di atasnya, " +
        "dan satu pra-cek kepemilikan cabang di dalam pembungkus idempotensi yang penjaga " +
        "sebenarnya ada di refund.ts",
    },
  ],
  [
    "modules/penjualan/service.ts",
    {
      situs: 1,
      alasan:
        "MAX(RIGHT(nomor,4)) untuk nomor nota berikutnya — WAJIB ikut menghitung nota yang " +
        "sudah dibuang, kalau tidak nomornya dipakai ulang dan dua nota berbeda bernomor sama",
    },
  ],
  // `modules/penyimpanan/autoFile.ts` DULU di sini, beralasan "pemanggilnya
  // sudah memilih baris itu dari kueri berbendera — satu hop lewat argumen".
  // Alasannya benar, dan tetap saja dibayar: jaminannya ada di PEMANGGIL,
  // sementara fungsi itu menerima daftar id apa adanya. Sejak sapuan sisi
  // PENULISAN (2026-08-27) ia menyaring sendiri di kedua kuerinya, jadi
  // entrinya dihapus — dan gerbang inilah yang menuntut penghapusannya.
  [
    "modules/pesanan/routes.ts",
    {
      situs: 7,
      alasan:
        "papan pesanan: seluruhnya lewat pastikanKartu() yang memuat isNull(sales.deletedAt) " +
        "— kartu yang sudah dibuang dibalas 404 sebelum barisnya dibaca. EMPAT di antaranya " +
        "baru terlihat sejak pemindainya memakai pohon sintaks: jendela teks lamanya menelan " +
        "`tx.insert(pesananLogs)` di pernyataan SEBELUMNYA lalu melabelinya MENULIS. Keempatnya " +
        "SELECT `.from(saleItems).where(eq(saleItems.saleId, id))` atas SATU id yang sudah " +
        "diresolusi pintunya, di dalam transaksi yang sama — tak ada agregat lintas penjualan " +
        "yang bisa kemasukan baris terbuang",
    },
  ],
  [
    "modules/produksi/routes.ts",
    {
      situs: 3,
      alasan:
        "tiga pembantu tahap menerima `conds` sebagai PARAMETER; pemanggilnya (baris 1639 & " +
        "1667 dst.) merakit conds dengan isNull(productions.deletedAt) di dalamnya",
    },
  ],
  [
    "modules/profil/routes.ts",
    {
      situs: 1,
      alasan:
        "profil MILIK SENDIRI (kode karyawan + cabang). Yang sudah diarsipkan tak bisa login " +
        "sama sekali — session.ts menyaringnya — jadi kueri ini tak pernah dicapai olehnya",
    },
  ],
  [
    "modules/users/routes.ts",
    {
      situs: 2,
      alasan:
        "GET /:userId/tempat (layar manajemen: penugasan karyawan yang sudah keluar justru " +
        "yang perlu dilihat untuk dibersihkan) dan PATCH /:userId — pintu yang MENGARSIPKAN " +
        "dan MEMULIHKAN, jadi ia wajib melihat baris yang sudah diarsipkan",
    },
  ],
  [
    "modules/users/service.ts",
    {
      situs: 2,
      alasan:
        "kode karyawan: himpunan kode terpakai & backfill-nya harus mencakup yang diarsipkan, " +
        "kalau tidak kode bekas orang yang keluar dibagikan ulang dan QR absen lama menunjuk " +
        "orang yang salah",
    },
  ],
  [
    "seed/guest.ts",
    {
      situs: 1,
      alasan: "seed akun tamu — memeriksa apakah baris membership-nya sudah ada, bukan pintu HTTP",
    },
  ],
]);

function telanjang(): Situs[] {
  return situsBendera().filter((x) => x.kelas === "TELANJANG");
}

describe("bendera 'tidak berlaku lagi': tiap pintu menyaring atau terdaftar", () => {
  const semua = situsBendera();

  it("populasinya benar-benar tersapu (bukan nol karena pemindainya patah)", () => {
    const per: Record<string, number> = {};
    for (const x of semua) per[x.induk] = (per[x.induk] ?? 0) + 1;
    expect(semua.length).toBeGreaterThanOrEqual(110);
    expect(per.sales ?? 0).toBeGreaterThanOrEqual(40);
    expect(per.productions ?? 0).toBeGreaterThanOrEqual(45);
    expect(per.memberships ?? 0).toBeGreaterThanOrEqual(25);
    // Dua cara membaca kode, keduanya benar-benar terpakai.
    expect(semua.filter((x) => x.bentuk === "sql").length).toBeGreaterThanOrEqual(10);
    expect(semua.filter((x) => x.bentuk === "drizzle").length).toBeGreaterThanOrEqual(80);
  });

  it("tak ada berkas telanjang yang tak terdaftar, dan jumlahnya cocok", () => {
    const per = new Map<string, number>();
    for (const x of telanjang()) per.set(x.berkas, (per.get(x.berkas) ?? 0) + 1);
    const salah: string[] = [];
    for (const [berkas, n] of per) {
      const d = DIPILAH_TANGAN.get(berkas);
      if (!d) salah.push(`${berkas}: ${n} situs TELANJANG, tak terdaftar`);
      else if (d.situs !== n) salah.push(`${berkas}: terdaftar ${d.situs}, sekarang ${n}`);
    }
    expect(
      salah,
      `baris yang sudah dibuang/diarsipkan ikut terbaca — saring, atau daftarkan beralasan:\n${salah.join("\n")}`,
    ).toEqual([]);
  });

  it("anti-kuburan: tiap entri daftar masih punya situsnya", () => {
    const per = new Set(telanjang().map((x) => x.berkas));
    const basi = [...DIPILAH_TANGAN.keys()].filter((k) => !per.has(k));
    expect(basi, `entri daftar sudah tak punya situs — hapus:\n${basi.join("\n")}`).toEqual([]);
  });

  it("tiap entri daftar menyebut ALASAN, bukan sekadar didiamkan", () => {
    for (const [k, v] of DIPILAH_TANGAN) {
      expect(v.alasan.length, `${k} tanpa alasan`).toBeGreaterThan(60);
    }
  });

  it("BUKTI MERAH: saringan dicabut dari laporan → gerbang menuduh berkas & barisnya", () => {
    const f = "modules/laporan/routes.ts";
    const asli = readFileSync(join(SRC, f), "utf8");
    // Berkas UTUH: tak satu pun tuduhan.
    expect(situsBendera([{ nama: f, isi: asli }]).filter((x) => x.kelas === "TELANJANG")).toEqual(
      [],
    );

    const dilucuti = asli.replace(/\n\s*isNull\(sales\.deletedAt\),/g, "");
    expect(dilucuti, "pencabutan tak mengubah apa pun — buktinya tak jadi merah").not.toBe(asli);

    const tertuduh = situsBendera([{ nama: f, isi: dilucuti }]).filter(
      (x) => x.kelas === "TELANJANG",
    );
    expect(tertuduh.length).toBeGreaterThanOrEqual(8);
    expect(tertuduh.every((x) => x.baris > 0)).toBe(true);
    // Anaknya ikut tertuduh, bukan cuma induknya — di sanalah uang & stoknya.
    //
    // Dipaku pada RANTAINYA, bukan pada medan `tabel`: sejak pemindainya
    // memakai pohon sintaks, satu rantai dinamai oleh `.from(...)`-nya (di sini
    // `sales`) sementara `saleItems`/`saleConsumptions` masuk lewat `innerJoin`.
    // Yang harus benar adalah kueri anaknya IKUT tertuduh — bukan label mana
    // yang kebetulan tercatat.
    const rantai = tertuduh.map((x) => x.potongan).join("\n");
    expect(rantai).toContain("saleItems");
    expect(rantai).toContain("saleConsumptions");
  });

  it("BUKTI MERAH kelas PEMBANTU: saringan dicabut dari kondisiFaktur → tetap tertuduh", () => {
    const f = "modules/penerimaan/routes.ts";
    const asli = readFileSync(join(SRC, f), "utf8");
    expect(situsBendera([{ nama: f, isi: asli }]).filter((x) => x.kelas === "TELANJANG")).toEqual(
      [],
    );

    const dilucuti = asli.replace(/\n\s*isNull\(productions\.deletedAt\),/g, "");
    expect(dilucuti).not.toBe(asli);
    const tertuduh = situsBendera([{ nama: f, isi: dilucuti }]).filter(
      (x) => x.kelas === "TELANJANG",
    );
    // Penelusuran pembantu bernama TIDAK boleh jadi pemaaf buta: begitu
    // `kondisiFaktur()` kehilangan saringannya, pemakainya ikut merah.
    expect(tertuduh.length).toBeGreaterThan(0);
  });

  it("'anggota aktif' punya SATU rumah: pesannya tak ditulis ulang di modul mana pun", () => {
    const PESAN = "Karyawan bukan anggota perusahaan";
    const salinan: string[] = [];
    for (const p of berkasTs(SRC)) {
      const rel = p.slice(SRC.length + 1);
      if (rel === "middleware/auth.ts") continue;
      if (readFileSync(p, "utf8").includes(PESAN)) salinan.push(rel);
    }
    expect(
      salinan,
      `aturan "pelaksana harus anggota" ditulis ulang — pakai pastikanAnggotaAktif():\n${salinan.join("\n")}`,
    ).toEqual([]);
  });

  it("pintu penugasan memakai pembantu itu, bukan kuerinya sendiri", () => {
    for (const f of ["modules/produksi/routes.ts", "modules/rekomendasi/rencana.ts"]) {
      const s = readFileSync(join(SRC, f), "utf8");
      expect(s, `${f} tak lagi lewat pintu bersama`).toContain("pastikanAnggotaAktif(");
    }
    const auth = readFileSync(join(SRC, "middleware/auth.ts"), "utf8");
    expect(auth).toContain("sudah diarsipkan (keluar)");
    // Dua sebab, dua kalimat — layar yang menjawab keduanya dengan satu kalimat
    // tak bisa ditindaklanjuti.
    expect(auth).toContain("Karyawan bukan anggota perusahaan");
  });
  // ── PENULISAN: sisi yang sampai 2026-08-27 dilewati tanpa alasan ────────
  //
  // `kelasDrizzle` memulangkan "MENULIS" untuk rantai apa pun yang menulis,
  // dan gerbang ini hanya menuduh "TELANJANG" — jadi penulisan tak pernah
  // ditagih, dan tak ada satu kalimat pun yang menjelaskan kenapa boleh
  // begitu. Kali KELIMA berturut-turut audit ini menemukan gerbang jujur yang
  // buta pada bentuk yang dilewatkan catatan pengecualiannya sendiri — dan
  // kali ini gerbangnya lahir dari audit ini juga.
  //
  // Taruhannya berlawanan arah dengan sisi bacaan: bacaan yang lupa menyaring
  // IKUT MENGHITUNG baris yang sudah dibuang; penulisan yang lupa menyaring
  // MENGUBAH baris yang sudah dibuang — tak ada angka yang terlihat salah,
  // hanya transaksi di Tempat Sampah yang diam-diam bergerak.
  // Kunci daftar ini SENGAJA bukan nomor baris. Versi pertamanya memakai
  // `berkas:baris`, dan langsung membusuk pada putaran berikutnya: satu baris
  // `import` yang ditambahkan di berkas lain menggeser 1228 jadi 1229, dan
  // gerbangnya menuduh situs yang sama yang sudah diadjudikasi. Pelajaran yang
  // sama sudah dibayar `pelaku.test.ts` sekali; sekali cukup.
  const TULIS_DIPILAH = new Map<string, string>([
    [
      "modules/produksi/routes.ts productions<productions>",
      "Syaratnya ADA dan justru paling teliti di berkas itu — `conds` " +
        "(dirakit di :1691 & :1719) memuat `isNull(productions.deletedAt)` " +
        "dan dipakai `.where(and(...conds, …))`. Yang tak terlihat pemindai " +
        "ini: `conds` sampai ke sini sebagai PARAMETER (`const { conds } = k`), " +
        "bukan sebagai deklarasi lokal, jadi penelusuran variabelnya buntu. " +
        "Batas 'berlingkup satu fungsi' yang sudah ditulis di util-nya.",
    ],
  ]);

  it("PREMIS: sisi PENULISAN ikut tersapu, dan tiap kelas amannya berpenghuni", () => {
    const tulis = semua.filter((x) => String(x.kelas).startsWith("TULIS_"));
    expect(tulis.length).toBeGreaterThanOrEqual(30);
    // Nol di salah satu kelas aman bukan temuan melainkan kebutaan: idiomnya
    // dipakai puluhan kali, dan pemindai yang tak melihatnya akan menyuruh
    // memperbaiki pintu yang justru paling teliti.
    expect(tulis.filter((x) => x.kelas === "TULIS_MENYARING").length).toBeGreaterThanOrEqual(15);
    expect(tulis.filter((x) => x.kelas === "TULIS_DIJAGA").length).toBeGreaterThanOrEqual(8);
    expect(tulis.filter((x) => x.kelas === "TULIS_SAMPAH").length).toBeGreaterThanOrEqual(1);
  });

  it("tiap penulisan ke baris terbuang menyaring, dijaga, atau terdaftar", () => {
    const liar = semua
      .filter((x) => x.kelas === "TULIS_TELANJANG")
      .map((x) => `${x.berkas} ${x.tabel}<${x.induk}>`)
      .filter((kunci) => !TULIS_DIPILAH.has(kunci));
    expect(
      liar,
      "Penulisan ke tabel berbendera tanpa saringan:\n" +
        liar.join("\n") +
        "\n\nPilih SATU: (a) tambahkan `isNull(<tabel>.<bendera>)` ke `WHERE` " +
        "penulisannya — syarat di WHERE ikut ke mana pun barisnya diklaim; " +
        "(b) muat barisnya lebih dulu dengan saringan, di fungsi yang sama; " +
        "(c) panggil penjaga bersama berkas itu (mis. `pastikanKartu`); atau " +
        "(d) daftarkan di `TULIS_DIPILAH` dengan alasan yang bisa ditunjuk.",
    ).toEqual([]);
  });

  it("anti-kuburan: tiap entri TULIS_DIPILAH masih punya situsnya", () => {
    const nyata = new Set(
      semua
        .filter((x) => x.kelas === "TULIS_TELANJANG")
        .map((x) => `${x.berkas} ${x.tabel}<${x.induk}>`),
    );
    const basi = [...TULIS_DIPILAH.keys()].filter((k) => !nyata.has(k));
    expect(basi, `entri ini sudah tak tertuduh — hapus:\n${basi.join("\n")}`).toEqual([]);
    for (const [k, alasan] of TULIS_DIPILAH) {
      expect(alasan.trim().length, `${k}: alasannya terlalu pendek`).toBeGreaterThan(80);
    }
  });

  it("BUKTI MERAH: saringan dicabut dari autoFile → penulisannya tertuduh", () => {
    const f = "modules/penyimpanan/autoFile.ts";
    const asli = readFileSync(join(SRC, f), "utf8");
    const dicabut = asli.replace(/\n\s*isNull\(productions\.deletedAt\),/g, "");
    expect(dicabut, "suntikan tak mendarat").not.toBe(asli);
    const tertuduh = situsBendera([{ nama: f, isi: dicabut }]).filter(
      (x) => x.kelas === "TULIS_TELANJANG",
    );
    expect(tertuduh.length).toBeGreaterThanOrEqual(1);
  });

  it("BUKTI MERAH: penjaga bersama dicabut dari papan pesanan → keempatnya tertuduh", () => {
    // `pastikanKartu` dipanggil sebagai baris pertama tiap handler yang
    // mengubah kartu. TERUKUR lewat HTTP: menekan tombol dapur pada baris
    // penjualan yang sudah dibuang dijawab 404, statusnya tak berubah, dan
    // nol baris log tertulis. Kalau penjaganya hilang, gerbang ini harus
    // berteriak — bukan menunggu seseorang menyadarinya.
    const f = "modules/pesanan/routes.ts";
    const asli = readFileSync(join(SRC, f), "utf8");
    const dicabut = asli.replace(/await pastikanKartu\([^;]*\);/g, "");
    expect(dicabut, "suntikan tak mendarat").not.toBe(asli);
    const tertuduh = situsBendera([{ nama: f, isi: dicabut }]).filter(
      (x) => x.kelas === "TULIS_TELANJANG",
    );
    expect(tertuduh.length).toBeGreaterThanOrEqual(4);
  });

  it("PASANGAN: Tempat Sampah tak dituduh menulis ke baris terbuang", () => {
    // Memulihkan & menghapus-permanen adalah PEKERJAANNYA. Gerbang yang
    // menuduhnya adalah gerbang yang salah paham soal apa itu Tempat Sampah.
    const sampah = semua.filter((x) => x.berkas.startsWith("modules/sampah/"));
    expect(sampah.length).toBeGreaterThanOrEqual(1);
    expect(sampah.filter((x) => x.kelas === "TULIS_TELANJANG")).toEqual([]);
  });

  it("PASANGAN: ketiga bentuk penjagaan diterima", () => {
    const s = situsBendera([
      {
        nama: "uji/langsung.ts",
        isi:
          "async function f(){ await db.update(sales).set(v)" +
          ".where(and(eq(sales.id, id), isNull(sales.deletedAt))); }\n",
      },
      {
        nama: "uji/variabel.ts",
        isi:
          "async function f(){ const kunci = and(eq(sales.id, id), isNull(sales.deletedAt));" +
          " await db.update(sales).set(v).where(kunci); }\n",
      },
      {
        nama: "uji/hulu.ts",
        isi:
          "async function f(){ const [r] = await db.select().from(sales)" +
          ".where(and(eq(sales.id, id), isNull(sales.deletedAt)));" +
          " if (!r) return; await db.update(sales).set(v).where(eq(sales.id, id)); }\n",
      },
    ]);
    const tulis = s.filter((x) => String(x.kelas).startsWith("TULIS_"));
    expect(tulis.map((x) => x.kelas).sort()).toEqual([
      "TULIS_DIJAGA",
      "TULIS_MENYARING",
      "TULIS_MENYARING",
    ]);
  });

  it("PREMIS: pemindai penulisan BISA menuduh", () => {
    const s = situsBendera([
      { nama: "uji/telanjang.ts", isi: "async function f(){ await db.update(sales).set(v).where(eq(sales.id, id)); }\n" },
    ]);
    expect(s.filter((x) => x.kelas === "TULIS_TELANJANG").length).toBe(1);
  });
});
