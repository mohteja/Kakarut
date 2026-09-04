import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * DETAIL FAKTUR PUNYA HALAMAN SENDIRI — dan halamannya berjanji tiga hal.
 *
 * Diminta pemilik repo: *"detail produksi ingin di buat form seperti form
 * produksi dan page sendiri supaya bisa di print dan share"*. Sejak itu detail
 * faktur BERJANJI: ia punya URL yang bisa dikirim, ia bisa dicetak, dan
 * PDF-nya bisa disimpan. Yang dijaga di sini syarat-syarat yang membuat
 * ketiganya benar — bukan bahwa halamannya ada.
 *
 * 1. **Datanya dari rutenya sendiri.** Tautan hanya benar-benar bisa dikirim
 *    bila penerimanya tak perlu lebih dulu membuka daftar riwayat. `GET
 *    /produksi` berhalaman 20 tanpa saringan `faktur_id`; halaman yang mencari
 *    fakturnya di sana menyisir sampai empat permintaan.
 * 2. **Gerbang rute barunya SAMA dengan daftarnya.** Rute per-id yang lebih
 *    longgar adalah pintu samping — divisi lain membaca faktur yang bukan
 *    haknya hanya dengan menebak URL.
 * 3. **Satu rumah.** Modalnya dihapus, bukan dibiarkan berdampingan: 28 medan
 *    yang dirender dua kali adalah 28 medan yang akan berbeda.
 *
 * YANG TIDAK DIJANJIKAN uji ini: ia membaca teks sumber, jadi tak bisa
 * mengatakan halamannya benar-benar tercetak rapi atau tautannya benar-benar
 * bisa dibuka. Yang mengukur itu lengan peramban di
 * `apps/web/e2e/pengadaan-tabel.spec.ts` — sengaja di berkas itu, bukan berkas
 * spec sendiri: `POST /auth/login` dibatasi 10 per 5 menit per (IP + email),
 * cache sesi e2e hidup per-MODUL, dan Playwright menjalankan tiap berkas spec
 * sebagai proses tersendiri — sepuluh berkas sudah memakai akun owner, jadi
 * berkas ke-11 memerahkan berkas lain dengan 429. Blok terakhir di bawah
 * memaku keberadaan lengan-lengan itu supaya rujukan ini tak bisa jadi basi.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const baca = (rel: string) => butaKomentar(readFileSync(AKAR + rel, "utf8"));

const HAL = baca("apps/web/src/pages/produksi/FakturDetailPage.tsx");
const DAFTAR = baca("apps/web/src/pages/produksi/TambahStokPage.tsx");
const RUTE = baca("apps/server/src/modules/produksi/routes.ts");
const APP = baca("apps/web/src/App.tsx");

describe("rute satu faktur: gerbangnya sama dengan daftarnya", () => {
  const iRute = RUTE.indexOf('.get("/faktur/:fakturId", async (c) => {');
  const potong = RUTE.slice(iRute, iRute + 3000);

  it("rutenya ada, dan irisannya benar-benar berisi", () => {
    expect(iRute).toBeGreaterThan(0);
    expect(potong).toContain("ambilBarisFaktur");
  });

  it("gerbang divisi & transfer dari SATU builder — bukan disalin", () => {
    /*
     * Versi pertama penjaga ini cuma memeriksa teks `condDivisi` ADA di
     * irisannya, dan bukti merahnya membuktikan itu tak cukup: saringan
     * divisinya dicabut (`const condDivisi: SQL[] = []`) sementara teks lama
     * tinggal sebagai binding mati — penjaganya tetap hijau. Sebuah asersi
     * teks tak bisa membuktikan sebuah NILAI dipakai.
     *
     * Maka yang dijaga sekarang bentuknya: predikat divisinya cuma boleh
     * didefinisikan SEKALI di seluruh berkas, dan kedua pintu memanggil
     * builder yang sama. Mencabutnya dari salah satu pintu berarti memanggil
     * fungsi lain — dan itu terlihat.
     */
    expect(RUTE).toMatch(/function gerbangPengadaan\(auth: AuthUser\)/);
    expect((RUTE.match(/ne\(ingredients\.divisiProduksi, auth\.role\)/g) ?? []).length).toBe(1);
    expect((RUTE.match(/eq\(dokumenNomor\.jenis, "transfer"\)/g) ?? []).length).toBe(1);
    // Dua pemanggil: daftar dan halaman detail.
    expect((RUTE.match(/gerbangPengadaan\(auth\)/g) ?? []).length).toBe(2);
    expect(potong).toContain("gerbangPengadaan(auth)");
    expect(potong).toContain("condCabang");
    // company_id & deletedAt hidup di `ambilBarisFaktur` yang dipakai bersama.
    expect(RUTE).toMatch(/eq\(productions\.companyId, companyId\)/);
    expect(RUTE).toMatch(/isNull\(productions\.deletedAt\)/);
  });

  it("SATU rumah untuk barisnya — daftar & detail memakai fungsi yang sama", () => {
    // `select` yang ditulis dua kali = dua bentuk baris yang pelan-pelan
    // berbeda, dan badge di halaman detail berhenti cocok dengan badge di
    // barisnya untuk faktur yang sama.
    expect(RUTE).toMatch(/async function ambilBarisFaktur\(/);
    expect((RUTE.match(/ambilBarisFaktur\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((RUTE.match(/id: productions\.id,\n\s+ingredient_id:/g) ?? []).length).toBe(1);
  });

  it("tak ada / tak berhak dijawab 404 yang SAMA — bukan dua pesan berbeda", () => {
    // Membedakan "tidak ada" dari "bukan milikmu" memberi tahu penebak URL
    // bahwa fakturnya ADA.
    expect((potong.match(/Faktur tidak ditemukan/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("cabangnya dari TOKEN, bukan dari query", () => {
    // `resolveBranchId(c)` membaca `?branch_id=`. Rute ini tak boleh — lihat
    // penjaga `cabang-ikut-di-url`: URL yang tak membawa cabangnya membuat
    // penjaga itu menuduh bahaya yang tak ada di sini.
    expect(potong).not.toContain("resolveBranchId");
    expect(potong).toContain("terikatCabang(auth.role)");
  });
});

describe("halaman dokumen: URL, kertas, PDF", () => {
  it("mengambil datanya dari rute satu faktur, bukan dari daftar", () => {
    expect(HAL).toContain("/faktur/${fakturId}`");
    // Kalau ia menembak daftarnya, tautan yang dikirim orang lain akan
    // mengunduh seluruh riwayat — dan gagal menemukan faktur di halaman >1.
    expect(HAL).not.toMatch(/api<[^>]*>\(`\$\{endpoint\}\?/);
  });

  it("perakit FakturGroup-nya SATU, dipakai daftar dan halaman ini", () => {
    expect(DAFTAR).toContain("export function kelompokkanFaktur(");
    expect(HAL).toContain("kelompokkanFaktur(");
    // Tak ada perakit ketiga: `byKey.set` di luar rumahnya berarti ada yang
    // menurunkan status faktur sendiri lagi.
    expect(HAL).not.toContain("byKey.set");
  });

  it("endpoint literalnya cocok dengan TEKS — dua tempat tak boleh berselisih", () => {
    // Halaman menulis endpointnya sebagai terner literal supaya penelusur
    // `cabang-ikut-di-url` bisa membacanya; nilainya wajib sama dengan peta
    // TEKS yang dipakai daftar.
    expect(HAL).toContain('const endpoint = tipe === "beli" ? "/pembelian" : "/produksi";');
    expect(DAFTAR).toMatch(/produksi: \{ judul: "[^"]+", endpoint: "\/produksi"/);
    expect(DAFTAR).toMatch(/beli: \{ judul: "[^"]+", endpoint: "\/pembelian"/);
  });

  it("mesin cetaknya yang sudah ada, bukan yang baru", () => {
    // `AreaCetak` memportal ke luar #root — tanpa itu tinggi shell ikut
    // menentukan tinggi kertas (terukur: 8 halaman, 7 kosong untuk satu struk).
    // Id `dokumen-print` sudah punya aturan @media print di index.css.
    expect(HAL).toContain('<AreaCetak id="dokumen-print">');
    expect(HAL).toContain("unduhPdf(");
    expect(HAL).toContain("window.print()");
  });

  it("tiap sisipan data di HTML PDF dilewatkan esc()", () => {
    // Dokumen yang menempelkan nama bahan mentah adalah lubang injeksi yang
    // ikut TERSIMPAN di berkas yang dibagikan.
    expect(HAL).toContain("lolosHtml as esc");
    for (const nilai of ["esc(r.bahan)", "esc(m.k)", "esc(m.v)", "esc(l.aksi)"]) {
      expect(HAL, nilai).toContain(nilai);
    }
  });

  it("bisa dibagikan, dan batasnya DIKATAKAN", () => {
    // Orang yang mengira ini tautan publik akan mengirimnya ke supplier dan
    // baru tahu keliru saat supplier itu melihat layar login.
    expect(HAL).toContain("Salin tautan");
    expect(HAL).toMatch(/navigator\.clipboard/);
    expect(HAL).toMatch(/execCommand\("copy"\)/);
    expect(HAL).toMatch(/sesama karyawan/);
  });

  it("gagal muat ≠ faktur kosong, dan ada jalan keluarnya", () => {
    expect(HAL).toContain("if (gagalMuat || !grup)");
    expect(HAL).toMatch(/tidak bisa dibuka/);
    expect(HAL).toMatch(/Kembali ke/);
  });

  it("sesudah dihapus, halamannya tak tinggal diam", () => {
    expect(HAL).toContain("navigate(endpoint, { replace: true })");
  });
});

describe("modal lama benar-benar pergi, rutenya benar-benar ada", () => {
  it("berkas modalnya tak ada lagi & tak ada yang mengimpornya", () => {
    expect(existsSync(AKAR + "apps/web/src/pages/produksi/FakturDetailModal.tsx")).toBe(false);
    expect(DAFTAR).not.toContain("FakturDetailModal");
  });

  it("baris riwayat menavigasi ke halamannya", () => {
    expect(DAFTAR).toMatch(/onKlikBaris=\{\(g\) => navigate\(/);
  });

  it("lengan peramban ADA, dan menguji yang cuma peramban bisa menguji", () => {
    /*
     * Tiga hal yang tak satu pun bisa dibuktikan dari teks sumber, dan
     * ketiganya justru INTI permintaan pemiliknya:
     *   · URL-nya benar-benar berganti saat baris diklik (bukan modal);
     *   · MUAT ULANG di URL itu tetap menampilkan dokumennya — satu-satunya
     *     bukti datanya tak diwarisi dari daftar yang sudah dimuat;
     *   · tombol Salin tautan menaruh URL yang benar di papan klip.
     * Kalau blok ini gugur, penjaga di atas tinggal menjaga bentuk kode atas
     * halaman yang mungkin tak pernah dibuka siapa pun.
     */
    const E2E = baca("apps/web/e2e/pengadaan-tabel.spec.ts");
    expect(E2E).toMatch(/toHaveURL\(\/\\\/produksi\\\//);
    expect(E2E).toContain("page.reload()");
    expect(E2E).toMatch(/navigator\.clipboard\.readText\(\)/);
    // Dibuka LANGSUNG di URL-nya, tanpa `/produksi` lebih dulu — keadaan orang
    // yang menerima tautannya.
    expect(E2E).toMatch(/page\.goto\(`\/produksi\/\$\{faktur!\.faktur_id\}`\)/);
  });

  it("kedua rutenya terdaftar, dan kitchen/bar hanya dapat produksi", () => {
    expect(APP).toContain('<Route path="/produksi/:fakturId"');
    expect(APP).toContain('<Route path="/pembelian/:fakturId"');
    // Peran kitchen/bar tak punya menu pembelian sama sekali — rute detail
    // pembelian di blok mereka akan jadi pintu yang server tolak, tapi web
    // sebaiknya tak menawarkannya lebih dulu.
    // Jangkarnya `{(isKitchen || isBar) && (` — bentuk BLOK rutenya. String
    // `isKitchen || isBar` polos muncul lebih dulu dua kali (peta peran &
    // rute /beranda), dan irisan yang berangkat dari sana ikut menelan blok
    // manajemen di atasnya — lolos hampa, persis yang `jangkar-iris` cegah.
    const iKit = APP.indexOf("{(isKitchen || isBar) && (");
    expect(iKit).toBeGreaterThan(0);
    const iAkhir = APP.indexOf("isManajemen && (", iKit);
    expect(iAkhir).toBeGreaterThan(iKit);
    const blokKit = APP.slice(iKit, iAkhir);
    expect(blokKit).toContain('path="/produksi/:fakturId"');
    expect(blokKit).not.toContain('path="/pembelian/:fakturId"');
  });
});
