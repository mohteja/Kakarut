import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SELISIH_TERLAMBAT_HARI, selisihTerlambat } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * ANTREAN PUTUSAN SELISIH KAS HARUS TERLIHAT DARI LUAR HALAMANNYA SENDIRI.
 *
 * Pemilik repo membuka Operasional Cabang dan menemukan **26 selisih kas
 * menunggu keputusannya**, yang tertua ditutup dua belas hari sebelumnya, lalu
 * menulis: *"selisih tidak ada notif harus di putuskan."*
 *
 * Ia benar, dan sebabnya tertulis. `docs/mobile/CHANGELOG-API.md` menjawab
 * "apakah owner perlu notifikasi?" dengan: *"Ya — `GET /shift/selisih?status=
 * menunggu` adalah sumber badge-nya… di-poll tiap 60 detik **saat halaman
 * Operasional terbuka**."* Jadi "notifikasi" pernah dilingkupi, sadar dan
 * tercatat, sebagai lencana yang hanya hidup DI DALAM halaman yang seharusnya
 * ia ingatkan. Di web bahkan lencananya pun tak pernah dipasang: sampai
 * 2026-09-03 "Operasional Cabang" satu-satunya butir nav manajemen tanpa
 * lencana, sementara ponsel sudah punya (`kasir_page.dart`, `badgeMerah`).
 *
 * Uji ini menjaga ketiga sisinya sekaligus, sebab yang membuat cacat ini
 * bertahan bukan satu baris melainkan jarak antar-berkas: pintu servernya di
 * satu repo, lencananya di berkas lain, ambangnya bisa diketik ulang di
 * mana saja.
 */

const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const LAYOUT = butaKomentar(readFileSync(`${WEB}/components/Layout.tsx`, "utf8"));
const BERANDA = butaKomentar(readFileSync(`${WEB}/pages/DashboardPage.tsx`, "utf8"));
const RUTE = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/modules/shift/routes.ts", import.meta.url)), "utf8"),
);

describe("ambang terlambat: satu aturan, satu tempat", () => {
  it("`selisihTerlambat` menggigit tepat di ambangnya", () => {
    const sekarang = Date.UTC(2026, 8, 15, 12, 0, 0);
    const hari = (n: number) => new Date(sekarang - n * 86_400_000).toISOString();
    expect(selisihTerlambat(hari(0), sekarang), "baru ditutup").toBe(false);
    expect(selisihTerlambat(hari(SELISIH_TERLAMBAT_HARI - 1), sekarang), "sehari sebelum").toBe(
      false,
    );
    // Tepat di ambang BUKAN terlambat — batasnya "lebih dari", bukan "sama
    // dengan". Tanpa asersi ini, `>` dan `>=` sama-sama hijau.
    expect(selisihTerlambat(hari(SELISIH_TERLAMBAT_HARI), sekarang), "tepat di ambang").toBe(false);
    expect(selisihTerlambat(hari(SELISIH_TERLAMBAT_HARI + 1), sekarang), "sehari sesudah").toBe(
      true,
    );
    expect(selisihTerlambat(hari(12), sekarang), "dua belas hari — kasus pemiliknya").toBe(true);
  });

  it("masukan yang tak bisa dibaca TIDAK dianggap terlambat", () => {
    const sekarang = Date.UTC(2026, 8, 15, 12, 0, 0);
    // `null` = shift belum ditutup: ia bahkan belum masuk antrean putusan.
    expect(selisihTerlambat(null, sekarang)).toBe(false);
    // Tanggal rusak jangan sampai menyalakan peringatan — lencana yang menyala
    // tanpa sebab persis sama merusaknya dengan lencana yang diam.
    expect(selisihTerlambat("bukan tanggal", sekarang)).toBe(false);
  });

  it("ambangnya tak diketik ulang di server maupun web", () => {
    // Angka telanjang di salah satu sisi = dua tempat yang bisa berselisih
    // pendapat soal kapan sesuatu terlambat.
    expect(RUTE).toContain("selisihTerlambat");
    expect(RUTE).not.toMatch(/24 \* 60 \* 60 \* 1000/);
    expect(BERANDA).toContain("SELISIH_TERLAMBAT_HARI");
  });
});

describe("lencana Operasional Cabang", () => {
  it("tautannya memakai navFlex + badgeOranye, bukan tautan polos", () => {
    // `linkClass` = tautan tanpa tempat untuk lencana. Sampai 2026-09-03
    // inilah yang dipakai, dan karena itu 26 selisih menunggu tak punya satu
    // pun tanda di luar halamannya sendiri.
    const blok = /<NavLink to="\/operasional" className=\{(\w+)\}>[\s\S]{0,400}?<\/NavLink>/.exec(
      LAYOUT,
    );
    expect(blok, "tautan /operasional tak ditemukan").not.toBeNull();
    expect(blok![1], "tautan /operasional harus navFlex agar bisa memuat lencana").toBe("navFlex");
    expect(blok![0]).toContain('badgeOranye(');
    expect(blok![0]).toContain('"nav-lencana-selisih"');
  });

  it("kuerinya digerbang SAMA dengan syarat render tautannya", () => {
    /*
     * `74b9165` lahir dari lencana yang menembak pintu yang ia tahu tertutup:
     * 211 galat 403 dalam 7 hari, semuanya kitchen/bar, untuk lencana yang tak
     * pernah dirender. Gerbang kueri yang lebih longgar dari gerbang render
     * adalah bentuk yang sama persis.
     */
    expect(LAYOUT).toMatch(/const lihatSelisih =[\s\S]{0,200}?manajemenGuard/);
    expect(LAYOUT).toMatch(/const lihatSelisih =[\s\S]{0,200}?penuhGuard/);
    expect(LAYOUT).toMatch(/queryKey: \["shift-selisih", "ringkas"\][\s\S]{0,200}?enabled: lihatSelisih/);
    // Tautannya sendiri dirender di dalam `{penuh && (` — sumber `penuhGuard`.
    expect(LAYOUT).toContain('const penuhGuard = !divisi || divisi === "kantor";');
  });

  it("kartu Beranda berbagi kunci kueri dengan lencananya", () => {
    // Kunci yang sama = react-query menyatukannya jadi SATU permintaan.
    // Kunci berbeda = dua tembakan tiap 60 detik untuk angka yang sama.
    const kunci = (s: string) => (s.match(/queryKey: \["shift-selisih", "ringkas"\]/g) ?? []).length;
    expect(kunci(LAYOUT), "lencana sidebar").toBe(1);
    expect(kunci(BERANDA), "kartu beranda").toBe(1);
    expect(BERANDA).toContain('api<RingkasSelisihDto>("/shift/selisih/ringkas")');
  });

  it("kegagalan baca TIDAK jatuh jadi nol di kedua permukaan", () => {
    /*
     * Aturan repo ini: "lencana gagal ≠ lencana nol". `badgeOranye` menerima
     * galatnya sebagai argumen kedua dan merender penanda abu-abu; kalau
     * galatnya tak diteruskan, permintaan yang GAGAL terlihat persis seperti
     * "tak ada yang menunggu keputusanmu" — satu-satunya kalimat yang seluruh
     * putaran ini dibuat untuk mencegah.
     */
    expect(LAYOUT).toContain('badgeOranye(selisihNav?.menunggu ?? 0, selisihGagal, "nav-lencana-selisih")');
    expect(BERANDA).toMatch(/if \(gagal\) \{[\s\S]{0,600}?tidak terbaca/);
    expect(BERANDA).toMatch(/if \(gagal\)[\s\S]{0,800}?bukan<\/b> berarti tak ada/);
  });
});

describe("pintu servernya", () => {
  it("ringkas digerbang owner/admin, sama dengan daftarnya", () => {
    expect(RUTE).toContain('.get("/selisih/ringkas", requireRole("owner", "admin")');
  });

  it("ringkas memakai perhitungan yang SAMA dengan daftarnya", () => {
    /*
     * Aturan "menunggu" tak bisa ditulis `count(*)` di SQL: statusnya
     * diturunkan dari selisih yang HIDUP, dihitung ulang tiap dibaca. Dua
     * tempat yang menurunkannya sendiri-sendiri adalah dua tempat yang akan
     * berselisih pendapat soal shift yang sama — dan yang satu jadi lencana
     * yang menyala untuk antrean kosong, atau diam untuk antrean penuh.
     */
    expect(
      (RUTE.match(/await antreanSelisih\(/g) ?? []).length,
      "daftar dan ringkas harus sama-sama memanggil antreanSelisih",
    ).toBeGreaterThanOrEqual(2);
    expect(RUTE).not.toMatch(/count\(\*\)[\s\S]{0,80}selisih_status/);
  });
});
