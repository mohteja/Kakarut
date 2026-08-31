import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { semuaRute, SRV, type Rute } from "./util/rute";
import { aliasBerkas, aliasPeran, penjagaPrefiks, peranEfektif, PERAN } from "./util/izin";

/**
 * SIAPA YANG EFEKTIF BISA MASUK TIAP PINTU — dan apakah itu disengaja.
 *
 * Pertanyaan paling dasar tentang sebuah pintu, dan ledger ini tak pernah
 * menjawabnya sekali pun: pengurungan tenant, pemilihan cabang, langit-langit
 * daftar, presisi angka — semuanya sudah disapu; matriks IZIN belum.
 *
 * Jawabannya tak bisa dibaca dari satu baris. Ia disusun dari TIGA sumber:
 *   1. penjaga prefiks di `app.ts` (`.use("/laporan/*", requireRole(…))`);
 *   2. `requireRole(…)` di rantai rutenya sendiri;
 *   3. ALIAS tingkat modul (`const bolehAturMeja = requireRole(…)`) — dan
 *      inilah yang membuat versi pertama pemindai ini menuduh EMPAT pintu meja
 *      secara palsu.
 *
 * Terukur lewat HTTP dengan token peran `bar` sungguhan (2026-08-25), dan
 * pengukurannya membantah pembacaan statis dua arah:
 *
 *   POST /meja · PATCH /meja/:id · PUT /meja/tata-letak · DELETE /meja/:id
 *     → 403 (dijaga alias `bolehAturMeja`, tak terlihat pemindai versi 1)
 *   POST /penyimpanan → **201**, dan barisnya ADA di `storage_locations`
 *   POST /supplier    → **201**, dan barisnya ADA di `suppliers`
 *
 * Dua yang terakhir temuannya, dan bentuknya tanda tangan repo ini: di kedua
 * modul, MENGUBAH master data sudah `requireRole("owner","admin")`
 * (`PATCH /:id`, `PUT /:id/petugas`), sementara MEMBUATnya terbuka untuk
 * keenam peran. Aturannya sudah ditulis di pintu sebelah.
 *
 * SESUDAH: `bar` → 403, `owner` → 201 (pasangan).
 */
/**
 * Prefiks yang pintu TULIS-nya memang terbuka untuk keenam peran — beserta
 * alasan yang bisa diperiksa. Ini bukan daftar "belum sempat": tiap baris
 * sudah ditembak dengan token peran `bar` dan diadjudikasi.
 */
const TERBUKA_SENGAJA = new Map<string, string>([
  ["/auth", "pra-otentikasi: login, daftar, reset & verifikasi email"],
  ["/onboarding", "menerima/menolak undangan & membuat perusahaan sendiri"],
  ["/absensi", "absen milik sendiri — penjaga prefiksnya memang keenam peran"],
  ["/profil", "kata sandi & profil milik sendiri"],
  ["/pesanan", "dapur/bar menandai sajian — penjaga prefiksnya keenam peran"],
  ["/kebersihan", "ceklis kebersihan dikerjakan semua peran (penjaga prefiks)"],
  ["/pengajuan", "pengajuan cuti/izin milik sendiri (penjaga prefiks)"],
  ["/transfer-stok", "kiriman antar-cabang, terikat cabang pemakainya"],
  ["/sync", "antrean offline ponsel — dipakai semua peran"],
  ["/upload", "foto bukti untuk tugas masing-masing peran"],
  ["/print", "mencetak dari perangkat peran mana pun"],
  ["/menu", "HANYA `PUT /menu/urutan`; handler-nya menulis sendiri bahwa rute ini boleh diakses semua peran termasuk kasir"],
  ["/stok", "opname & waste: rute-nya ber-`requireRole` keenam peran secara EKSPLISIT"],
  ["/perlengkapan", "pakai/opname/minta/terima perlengkapan — operasional harian tiap peran, terikat cabang"],
  ["/penerimaan", "menerima kiriman di cabang — operasional, terikat cabang penerima"],
]);

/**
 * RUTE BACA yang terbuka untuk keenam peran — diadjudikasi SATU PER SATU.
 *
 * Putaran sebelumnya menutup dua pintu TULIS lalu menulis batasnya sendiri:
 * "sisanya (60 rute BACA terbuka, termasuk beberapa yang menampilkan
 * HPP/margin) belum diadjudikasi satu per satu." Ini membayarnya.
 *
 * Diukur 2026-08-26 dengan token peran `bar` sungguhan (bukan dibaca): 60 rute
 * BACA terbuka → **7 ditutup** (lihat `peranEfektif` yang dipaku di bawah) →
 * **53** tersisa (kini **54** sesudah `GET /stok/nilai` lahir), masing-masing punya baris di sini.
 *
 * Daftarnya sengaja PER RUTE, bukan per prefiks seperti `TERBUKA_SENGAJA` di
 * atas: yang ditagih justru keputusan per pintu, dan prefiks `/stok` sendiri
 * memuat delapan pintu yang artinya berbeda-beda.
 */
const TERBUKA_SENGAJA_BACA = new Map<string, string>([
  // — identitas & milik sendiri —
  ["/auth/me", "identitas pemegang token itu sendiri"],
  ["/profil", "profil milik sendiri"],
  ["/profil/aktivitas", "jejak aktivitas milik sendiri"],
  ["/onboarding/status", "status undangan pemegang token"],
  ["/absensi", "daftar absen; penjaga prefiksnya memang keenam peran"],
  ["/absensi/status", "hadir/tidaknya diri sendiri — gerbang `/shift/buka`"],
  ["/pengajuan", "pengajuan cuti/izin milik sendiri"],
  // — master data BERNAMA, tanpa angka biaya —
  ["/cabang", "daftar cabang (nama) — pemilih cabang ada di tiap layar"],
  ["/kategori", "nama kategori menu; dipakai kartu kasir"],
  ["/kategori-bahan", "nama kategori bahan; dipakai penyaring stok"],
  ["/satuan", "nama satuan; dipakai tiap form qty"],
  ["/supplier", "daftar NAMA supplier. Angka belanjanya ada di `/supplier/:id/kartu`, dan kartunya sudah ditutup putaran ini"],
  ["/penyimpanan", "daftar rak; dipakai opname & simpan hasil produksi"],
  ["/penyimpanan/:id/bahan", "isi rak; dipakai opname per rak"],
  // — jalur POS & papan dapur —
  ["/menu", "katalog kasir DAN tiket dapur/bar. Lihat CATATAN BIAYA di bawah: `hpp`/`komponen[].harga_per_unit` ikut terbawa, dan itu batas yang diukur — bukan yang didiamkan"],
  ["/menu/:id", "sama seperti `/menu`, satu baris"],
  ["/menu/ketersediaan", "menu yang bisa dijual — kasir butuh sebelum menagih"],
  ["/meja", "denah meja; jalur POS"],
  ["/meja/status", "meja terisi/kosong; papan kasir & pramusaji"],
  ["/meja/:id/log", "riwayat satu meja; menjawab 'siapa mengosongkan'"],
  ["/pesanan", "papan sajian dapur/bar — inti kerja kitchen & bar"],
  ["/pesanan/:jenis/:id/log", "jejak satu pesanan, dibaca di papan yang sama"],
  ["/member-cari", "cari member saat kasir menagih"],
  ["/penjualan", "riwayat transaksi cabang; tak membawa `total_hpp`(terukur)"],
  ["/penjualan/:id", "detail nota untuk cetak ulang & refund. Membawa `sale.totalHpp` — lihat CATATAN BIAYA"],
  ["/penjualan/:id/slip", "slip cetak ulang; tak membawa angka biaya (terukur)"],
  ["/company", "setelan yang dibutuhkan POS: `pb1Rate`, `receiptFooter`, `mode`"],
  // — operasional cabang —
  ["/kebersihan", "ceklis kebersihan dikerjakan tiap peran"],
  ["/kebersihan/area", "area yang harus dibersihkan"],
  ["/kebersihan/:id", "detail satu ceklis"],
  ["/penerimaan", "menerima kiriman di cabang"],
  ["/penerimaan/riwayat", "riwayat penerimaan cabang sendiri"],
  ["/penerimaan/anomali", "barang yang tak sampai — pelaksana cabang yang tahu"],
  ["/transfer-stok", "kiriman antar-cabang, terikat cabang pemakainya"],
  ["/transfer-stok/saldo", "saldo yang bisa dikirim dari cabang sendiri"],
  ["/stok", "saldo bahan; opname & waste dikerjakan tiap peran. Membawa `harga_per_unit` — lihat CATATAN BIAYA"],
  ["/stok/nilai", "AGREGAT nilai rupiah stok cabang — bukan harga per bahan. Kartu \"Nilai stok\" memang sengaja ditampilkan ke tiap peran yang membuka layar Stok di KEDUA klien; rute ini justru yang MEMISAHKAN totalnya dari harga per bahannya, supaya harga per bahan bisa ditahan tanpa memadamkan kartunya"],
  ["/stok/exp", "bahan mendekati kedaluwarsa — dibaca pelaksana rak"],
  ["/stok/penyesuaian", "selisih yang belum tuntas; dibuka dari layar opname"],
  ["/stok/opname", "sesi opname berjalan"],
  ["/stok/opname/riwayat", "sesi opname yang sudah lewat"],
  ["/stok/opname/sesi/:sessionId", "isi satu sesi opname"],
  ["/stok/kartu/:ingredientId", "kartu mutasi satu bahan. Membawa harga lot — lihat CATATAN BIAYA"],
  ["/stok/fifo/:ingredientId", "kartu FIFO satu bahan; dibuka dari kartu stok. Membawa harga lot — lihat CATATAN BIAYA"],
  ["/perlengkapan", "saldo perlengkapan; pakai/opname dikerjakan tiap peran"],
  ["/perlengkapan/kiriman", "kiriman perlengkapan ke cabang sendiri"],
  ["/perlengkapan/opname/riwayat", "opname perlengkapan yang sudah lewat"],
  ["/perlengkapan/opname/sesi/:sessionId", "isi satu sesi opname perlengkapan"],
  ["/perlengkapan/:id/kartu", "kartu mutasi perlengkapan. Membawa `total_belanja`, DAN modal yang menampilkannya (`KartuPerlengkapanModal`) dibuka dari tab Stok → Perlengkapan yang TAK berpenjaga peran — menutup pintunya akan mematahkan layar yang hari ini bekerja. Lihat CATATAN BIAYA"],
  // — resep: dibaca dapur/bar, harganya disembunyikan LAYAR —
  ["/bahan", "daftar bahan; `ResepPage` dapur/bar membacanya. Membawa `harga_beli`/`harga_per_unit`, dan yang menyembunyikannya adalah layar (`lihatHarga = isManajemen`) — lihat CATATAN BIAYA"],
  ["/bahan/:id/detail", "detail bahan (saldo & metode HPP); dibuka dari kartu stok"],
  ["/bahan/:id/resep", "takaran resep — dapur/bar memasaknya"],
  ["/bahan/:id/langkah", "cara masak — justru untuk pelaksana di cabang"],
  ["/bahan/resep-ringkas", "takaran ringkas; dipakai layar produksi"],
]);

/**
 * CATATAN BIAYA — batas putaran ini, ditulis apa adanya.
 *
 * Yang DIUKUR (token `bar`, 2026-08-26, DB segar):
 *
 *   GET /menu        → hpp 5662,03 · hpp_dine_in 4732,03 · harga_saran
 *                      10820,01 · food_cost_persen 51,47 ·
 *                      komponen[].harga_per_unit 357,14 / 754,55
 *   GET /bahan       → harga_beli 35.000 · harga_per_unit 777,78
 *   GET /stok        → harga_per_unit
 *   GET /penjualan/:id → sale.totalHpp 5662,0314 · items[].hppSatuan
 *   GET /perlengkapan/:id/kartu → total_belanja
 *
 * Kedua klien menulis aturannya di LAYAR, dengan nama: ponsel
 * `resep_page.dart` memakai `final lihatHarga = user?.isManajemen ?? false`,
 * web `ResepPage` bahkan tak mengambil datanya (`enabled: bolehUbah`), dan
 * `MenuListPage`/`AnalisisHargaPage`/`MenuHppPage` semuanya di balik
 * `isManajemen`. Pintunya tidak.
 *
 * TIDAK ditutup putaran ini, dan alasannya bukan "belum sempat" melainkan
 * hasil pengukuran:
 *
 *   1. Angkanya SALING TERJANGKAU. Menutup `hpp` di `/menu` sementara `/stok`
 *      dan `/bahan` tetap memberi `harga_per_unit` per bahan (dan `/bahan/:id/
 *      resep` memberi takarannya) hanya memindahkan pintunya, tidak menutup
 *      keadaannya. Penjaga yang bisa dilewati lewat pintu sebelah persis
 *      penyakit yang gerbang ini obati — memasangnya di sini akan menambah
 *      satu lagi, bukan mengurangi.
 *   2. Ada layar TERKIRIM yang sengaja menampilkannya ke peran non-manajemen:
 *      papan pesanan ponsel (`papan_pesanan_page.dart`) memunculkan SnackBar
 *      "HPP transaksi dihitung ulang → Rp …" untuk dapur/bar, dan kartu
 *      "Nilai stok" di layar Stok ponsel dihitung dari `harga_per_unit` TANPA
 *      penjaga peran sama sekali.
 *
 * Jadi kebijakannya sendiri belum satu — dan menyeragamkannya adalah keputusan
 * PRODUK (siapa boleh melihat biaya), bukan tambalan yang boleh kupasang
 * sendiri. Yang bisa dibayar hari ini adalah pintu yang aturannya sudah
 * tertulis di pintu SEBELAHNYA di berkas yang sama — dan itu yang dikerjakan.
 */

describe("matriks izin per rute", () => {
  const app = butaKomentar(readFileSync(join(SRV, "app.ts"), "utf8"));
  const guards = penjagaPrefiks(app);
  const rute = semuaRute();
  const matriks = rute.map((r) => ({
    ...r,
    peran: peranEfektif(r, guards, aliasBerkas(r.berkas)),
  }));
  const terbukaSemua = matriks.filter((m) => m.peran.length === PERAN.length);
  const tulisTerbuka = terbukaSemua.filter((m) => m.metode !== "GET");
  const bacaTerbuka = terbukaSemua.filter((m) => m.metode === "GET");

  it("PREMIS: ketiga sumber penjaga benar-benar terbaca", () => {
    // Pemindai yang buta sebagian melaporkan angka, dan angkanya salah:
    // versi pertama melihat 3 dari 15 penjaga prefiks dan menyatakan
    // `/laporan/*` terbuka untuk keenam peran.
    expect(rute.length, "daftar rute kosong").toBeGreaterThan(250);
    expect(guards.length, "penjaga prefiks tak terbaca").toBeGreaterThanOrEqual(15);
    expect(
      guards.filter((g) => g.peran.size < PERAN.length).length,
      "tak satu pun penjaga yang MEMBATASI terbaca",
    ).toBeGreaterThanOrEqual(8);
    expect(terbukaSemua.length, "tak ada rute terbuka — pemindainya rusak").toBeGreaterThan(0);
  });

  it("DETEKTOR TERBUKI: ketiga bentuk penjaga diklasifikasi benar", () => {
    const g = penjagaPrefiks('x.use("/laporan/*", requireRole("owner", "admin"));');
    expect(g).toHaveLength(1);
    expect([...g[0].peran].sort()).toEqual(["admin", "owner"]);
    expect([...aliasPeran('const boleh = requireRole("owner", "cashier");').get("boleh")!].sort()).toEqual(
      ["cashier", "owner"],
    );
    const rutePalsu: Rute = {
      metode: "POST",
      jalur: "/palsu",
      res: false,
      isi: '"/", boleh, async (c) => {}',
      berkas: "x.ts",
    };
    expect(peranEfektif(rutePalsu, [], aliasPeran('const boleh = requireRole("owner");'))).toEqual([
      "owner",
    ]);
    // tanpa penjaga apa pun → keenam peran
    expect(
      peranEfektif({ ...rutePalsu, isi: '"/", async (c) => {}' }, [], new Map()),
    ).toHaveLength(PERAN.length);
  });

  it("tiap pintu TULIS yang terbuka untuk semua peran sudah diadjudikasi", () => {
    const asing = tulisTerbuka.filter(
      (m) => !TERBUKA_SENGAJA.has(`/${m.jalur.split("/")[1] ?? ""}`),
    );
    expect(
      asing.map((m) => `${m.metode} ${m.jalur}`),
      "pintu TULIS baru terbuka untuk keenam peran. Pasang `requireRole` " +
        "seperti pintu sebelahnya, ATAU daftarkan prefiksnya di TERBUKA_SENGAJA " +
        "beserta alasan yang bisa diperiksa — dan tembak dulu dengan token peran " +
        "terlemah sebelum menyebutnya sengaja",
    ).toEqual([]);
  });

  it("MEMBUAT master data terkunci sama seperti MENGUBAHnya", () => {
    // Temuan putaran ini, dipaku sebagai perilaku: `POST /penyimpanan` dan
    // `POST /supplier` sempat terbuka untuk keenam peran sementara `PATCH /:id`
    // di berkas yang sama sudah owner/admin. Terukur: token `bar` → 201 dan
    // barisnya benar-benar ada; sesudah diperbaiki → 403, owner tetap 201.
    const buat = (jalur: string) =>
      matriks.find((m) => m.metode === "POST" && m.jalur === jalur)?.peran;
    // KASIR sengaja tetap boleh membuat penyimpanan — §191 verify-api sudah
    // memaku kontraknya berpasangan ("cabang SENDIRI tetap boleh", "cabang
    // lain 403"), dan pengetatan pertamaku ke owner/admin saja MEMATAHKANNYA.
    // Yang ditutup: `tim`, `kitchen`, `bar`.
    expect(buat("/penyimpanan"), "/penyimpanan kembali terbuka").toEqual([
      "admin",
      "cashier",
      "owner",
    ]);
    expect(buat("/supplier"), "/supplier kembali terbuka").toEqual(["admin", "owner"]);
  });

  it("daftar pengecualiannya masih ADA — bukan kuburan prefiks basi", () => {
    const prefiksTerbuka = new Set(tulisTerbuka.map((m) => `/${m.jalur.split("/")[1] ?? ""}`));
    for (const p of TERBUKA_SENGAJA.keys()) expect(prefiksTerbuka, p).toContain(p);
  });

  it("tiap pintu BACA yang terbuka untuk semua peran sudah diadjudikasi", () => {
    const asing = bacaTerbuka
      .filter((m) => !TERBUKA_SENGAJA_BACA.has(m.jalur))
      .map((m) => m.jalur);
    expect(
      asing,
      "rute BACA baru terbuka untuk keenam peran. Tembak dulu dengan token " +
        "peran terlemah, lihat APA yang terbaca, lalu putuskan: pasang " +
        "`requireRole` seperti pintu sebelahnya, ATAU daftarkan jalurnya di " +
        "TERBUKA_SENGAJA_BACA beserta alasan yang bisa diperiksa",
    ).toEqual([]);
  });

  it("daftar BACA-nya masih ADA — bukan kuburan jalur basi", () => {
    // Pasangan uji di atasnya: tanpa ini, rute yang kelak DITUTUP akan
    // meninggalkan barisnya di sini selamanya, dan daftar yang tak pernah
    // salah adalah daftar yang tak pernah dibaca. Sudah sekali terjadi di
    // gerbang ini (`/meja` di TERBUKA_SENGAJA sempat basi).
    const jalurTerbuka = new Set(bacaTerbuka.map((m) => m.jalur));
    for (const j of TERBUKA_SENGAJA_BACA.keys()) expect(jalurTerbuka, j).toContain(j);
  });

  it("PREMIS: populasi BACA terbuka tetap besar — sapuannya tidak buta", () => {
    // Nol berarti pemindainya rusak, bukan repo yang bersih. Angkanya diukur
    // 2026-08-26: 60 sebelum putaran ini, 53 sesudahnya.
    expect(bacaTerbuka.length).toBeGreaterThanOrEqual(40);
    expect(TERBUKA_SENGAJA_BACA.size).toBeGreaterThanOrEqual(40);
  });

  it("kartu & riwayat BIAYA terkunci sama seperti pintu yang MENULISnya", () => {
    /*
     * Temuan putaran ini, dipaku sebagai perilaku. Tiap baris adalah pasangan
     * di BERKAS YANG SAMA: pintu yang mengubah angkanya sudah owner/admin
     * sejak lama, pintu yang membacanya terbuka untuk keenam peran.
     *
     *   bahan/routes.ts        PUT  /:id/supplier  owner/admin   ← GET :1198
     *   bahan/routes.ts        POST /:id/harga     owner/admin   ← GET /:id/pembelian
     *   perlengkapan/routes.ts PUT  /:id/supplier  owner/admin   ← GET /:id/supplier
     *   perlengkapan/routes.ts POST /:id/harga     owner/admin   ← GET /:id/pembelian
     *   perlengkapan/routes.ts GET  /belanja,/master owner/admin ← GET /beli
     *   supplier/routes.ts     PATCH /:id          owner/admin   ← GET /:id/kartu
     *
     * Terukur lewat HTTP, sebelum → sesudah, token `bar`: 200 → 403; token
     * `tim`: tetap 200 untuk kedua pintu bahan (pasangannya — layar yang
     * membacanya memang dipasang untuk tim/tim-CK); token owner: tetap 200.
     */
    const baca = (jalur: string) =>
      matriks.find((m) => m.metode === "GET" && m.jalur === jalur)?.peran;
    expect(baca("/menu/panduan-markup"), "kebijakan markup").toEqual(["admin", "owner"]);
    expect(baca("/supplier/:id/kartu"), "kartu supplier").toEqual(["admin", "owner"]);
    expect(baca("/perlengkapan/beli"), "faktur beli perlengkapan").toEqual(["admin", "owner"]);
    expect(baca("/perlengkapan/:id/pembelian"), "riwayat harga perlengkapan").toEqual([
      "admin",
      "owner",
    ]);
    expect(baca("/perlengkapan/:id/supplier"), "supplier perlengkapan").toEqual([
      "admin",
      "owner",
    ]);
    // +tim: `BahanPage` web dipasang untuk `isManajemen || isTim`, dan laci
    // ponsel membukanya untuk `isManajemen || isTimCk`. Menutup tim di sini
    // akan mematikan layar yang hari ini bekerja.
    expect(baca("/bahan/:id/pembelian"), "riwayat harga bahan").toEqual([
      "admin",
      "owner",
      "tim",
    ]);
    expect(baca("/bahan/:id/supplier"), "supplier bahan").toEqual(["admin", "owner", "tim"]);
  });

  it("pintu yang WAJIB tetap terbuka memang masih terbuka — pasangan", () => {
    // Pengetatan tanpa pasangan adalah cara mengubah perbaikan jadi kerusakan:
    // POS butuh kasir, papan butuh dapur/bar, resep butuh pelaksana cabang.
    // Terukur lewat HTTP di §259 verify-api juga, bukan cuma di sini.
    const wajibTerbuka = [
      "/menu",
      "/menu/ketersediaan",
      "/bahan",
      "/bahan/:id/resep",
      "/bahan/:id/langkah",
      "/stok",
      "/perlengkapan",
      "/perlengkapan/:id/kartu",
      "/supplier",
      "/pesanan",
      "/meja/status",
    ];
    for (const j of wajibTerbuka) {
      const p = matriks.find((m) => m.metode === "GET" && m.jalur === j)?.peran;
      expect(p, `${j} ikut tertutup — POS/papan/resep akan berhenti`).toHaveLength(
        PERAN.length,
      );
    }
  });

  it("pintu manajemen tetap terkunci — pasangan anti-hijau-palsu", () => {
    // Kalau gerbang ini kelak dilonggarkan sampai semuanya lolos, baris ini
    // yang menahannya: pintu yang memang harus terkunci wajib tetap terkunci.
    const kunci = (metode: string, jalur: string) =>
      matriks.find((m) => m.metode === metode && m.jalur === jalur)?.peran ?? [];
    expect(kunci("GET", "/laporan")).toEqual(["admin", "owner"]);
    expect(kunci("GET", "/customer")).toEqual(["admin", "owner"]);
    expect(kunci("PATCH", "/supplier/:id")).toEqual(["admin", "owner"]);
    expect(kunci("PATCH", "/penyimpanan/:id")).toEqual(["admin", "owner"]);
  });
});
