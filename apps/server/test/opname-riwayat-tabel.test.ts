import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cocokCariOpname,
  lolosSaringanStatus,
  SARINGAN_STATUS_OPNAME_BAHAN,
  SARINGAN_STATUS_OPNAME_PERLENGKAPAN,
} from "@kakarut/shared";
import { situsKueriWeb } from "./util/kueri-web";

/**
 * RIWAYAT STOCK OPNAME: TANGGAL YANG HILANG, DAN TABEL YANG MENGGANTIKAN KARTU.
 *
 * Diminta pemilik: *"riwayat SO bahan baku dan perlengkapan belum ada tanggal
 * hari — juga ingin di buat tabel saja dengan kolom status"*.
 *
 * Bagian pertama itu CACAT, bukan selera. `OpnameRiwayatPage` merender
 * `formatWaktu(s.waktu)` telanjang, dan `formatWaktu` di web memulangkan JAM
 * DAN MENIT SAJA. Setiap sesi dari setiap hari karena itu terbaca sama
 * ("14.32") — di halaman yang justru ada untuk menelusuri opname LAMA, dan
 * yang sudah memasang spanduk "yang lebih lama tidak ikut ditampilkan".
 *
 * Aplikasi ponsel TIDAK punya cacat ini: `formatWaktu` di sana memulangkan
 * `dd/MM HH.mm`. Dua klien, satu nama fungsi, dua jawaban — dan yang diam
 * hanya web.
 */

const WEB = fileURLToPath(new URL("../../web/src/", import.meta.url));
const baca = (p: string) => readFileSync(WEB + p, "utf8");
const HAL = baca("pages/stok/OpnameRiwayatPage.tsx");
const KOLOM = baca("pages/stok/kolom-opname.tsx");

describe("riwayat opname — TANGGAL benar-benar dirender", () => {
  it("premis: berkasnya terbaca dan memang halaman riwayat opname", () => {
    // Premis yang lemah membuat seluruh berkas ini lolos secara hampa.
    expect(HAL.length).toBeGreaterThan(5000);
    expect(HAL).toContain("Riwayat Stock Opname");
    expect(KOLOM).toContain("kolomOpnameBahan");
    expect(KOLOM).toContain("kolomOpnamePerlengkapan");
  });

  it("KEDUA tab punya kolom Tanggal DAN kolom Jam DAN kolom Status", () => {
    // Dijaga per-tab: satu tab yang diperbaiki sementara tetangganya tidak
    // adalah persis keadaan sebelum putaran ini, hanya dengan tab yang beda.
    for (const fn of ["kolomOpnameBahan", "kolomOpnamePerlengkapan"]) {
      const i = KOLOM.indexOf(`export function ${fn}`);
      expect(i, `${fn} tak ditemukan`).toBeGreaterThan(-1);
      const badan = KOLOM.slice(i, i + 3000);
      expect(badan, `${fn} kehilangan kolom Tanggal`).toContain('judul: "Tanggal"');
      expect(badan, `${fn} kehilangan kolom Jam`).toContain('judul: "Jam"');
      expect(badan, `${fn} kehilangan kolom Status`).toContain('judul: "Status"');
    }
  });

  it("kolom Tanggal memakai pemformat yang MEMBAWA TANGGAL, bukan formatWaktu", () => {
    /*
     * Inti seluruh putaran. `formatWaktu` di web memulangkan jam-menit saja;
     * memakainya untuk kolom "Tanggal" memberi kolom bernama Tanggal yang
     * isinya bukan tanggal — lebih buruk daripada tak punya kolom itu, sebab
     * kepalanya menjanjikan sesuatu yang tak dipenuhi selnya.
     */
    const selT = KOLOM.slice(KOLOM.indexOf("function selTanggal"), KOLOM.indexOf("function selJam"));
    expect(selT).toContain("formatTanggalRingkas(");
    expect(selT).not.toContain("formatWaktu(");
    // …dan sebaliknya: sel Jam memang jam.
    const selJ = KOLOM.slice(KOLOM.indexOf("function selJam"), KOLOM.indexOf("function selNomor"));
    expect(selJ).toContain("formatWaktu(");
  });

  it("KEDUA lembar detail menyebut tanggal sesi — dan DTO perlengkapan memang membawanya", () => {
    /*
     * Lembar detail perlengkapan sempat tak menampilkan waktu SAMA SEKALI —
     * bukan karena lupa merender, melainkan karena `OpnamePerlengkapanDetail`
     * tak membawanya. Jadi yang dipaku dua lapis: DTO-nya punya `waktu`/`oleh`
     * (kalau tidak, lembar mana pun tak bisa menyebutnya), DAN kedua lembar
     * benar-benar merendernya lewat `formatTanggalJam` — bukan `formatWaktu`.
     */
    const TYPES = readFileSync(
      fileURLToPath(new URL("../../../packages/shared/src/types.ts", import.meta.url)),
      "utf8",
    );
    /*
     * Diiris sampai KURUNG TUTUP interface-nya sendiri, bukan 900 karakter.
     * Versi pertama memakai jendela 900 dan bukti merahnya GAGAL: interface ini
     * 609 karakter, jadi jendela itu menembus ke `PerlengkapanMutasiDto` di
     * bawahnya, yang juga punya `waktu: string;` — DTO yang kehilangan `waktu`
     * tetap "mengandung" `waktu: string;` milik tetangganya.
     * Penjaga yang memeriksa bahannya ADA di sekitar, bukan di tempatnya.
     */
    const awal = TYPES.indexOf("export interface OpnamePerlengkapanDetail");
    expect(awal, "DTO OpnamePerlengkapanDetail tak ditemukan").toBeGreaterThan(-1);
    const dto = TYPES.slice(awal, TYPES.indexOf("\n}\n", awal) + 3);
    expect(dto, "irisan DTO menembus interface tetangga").not.toMatch(/export interface \w+[\s\S]+export interface/);
    expect(dto, "DTO detail perlengkapan kehilangan `waktu`").toContain("waktu: string;");
    expect(dto, "DTO detail perlengkapan kehilangan `oleh`").toContain("oleh: string | null;");

    const bahan = HAL.slice(HAL.indexOf("function DetailSheet("), HAL.indexOf("function StatusBadgePerl"));
    const perl = HAL.slice(HAL.indexOf("function DetailSheetPerl("), HAL.indexOf("export function OpnameRiwayatPage"));
    for (const [nama, isi] of [["bahan", bahan], ["perlengkapan", perl]] as const) {
      expect(isi, `lembar ${nama} tak merender formatTanggalJam(data.waktu)`).toContain(
        "formatTanggalJam(data.waktu)",
      );
      expect(isi, `lembar ${nama} tak menyebut pencatatnya`).toContain("data.oleh");
      expect(isi, `lembar ${nama} kembali jam-saja`).not.toContain("formatWaktu(");
    }
  });

  it("SATU sel Tanggal dipakai kedua tab, bukan disalin dua kali", () => {
    // Dua salinan yang lahir kembar lalu menjawab beda adalah bentuk yang
    // sudah dua kali dibayar repo ini (aturan status faktur; lencana
    // permintaan berjalan). Satu helper, dua pemanggil.
    expect((KOLOM.match(/selTanggal\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((KOLOM.match(/formatTanggalRingkas\(/g) ?? []).length).toBe(1);
  });
});

describe("riwayat opname — TABEL menggantikan kartu", () => {
  it("dirender lewat TabelResponsif, dan tumpukan kartu lamanya sudah tak ada", () => {
    expect(HAL).toContain("<TabelResponsif");
    // Bentuk kartu lama: `.map((s) => (<button … onClick={() => setDetail(`.
    expect(HAL).not.toMatch(/\.map\(\(s\) => \([\s\S]{0,120}?<button/);
    // Baris tetap bisa dibuka — daftar yang bisa diklik saat berbentuk kartu
    // tak boleh jadi daftar yang cuma bisa dipandang begitu ia jadi tabel.
    expect(HAL).toContain("onKlikBaris={(r) => setDetail(r.session_id)}");
    expect(HAL).toContain("onKlikBaris={(r) => setDetailPerl(r.session_id)}");
  });

  it("kolomnya dirakit di rumahnya sendiri, bukan inline di tengah halaman", () => {
    expect(HAL).toContain("kolomOpnameBahan(");
    expect(HAL).toContain("kolomOpnamePerlengkapan(");
    expect(HAL).toContain('from "./kolom-opname"');
  });
});

describe("riwayat opname — saringan status & pencarian", () => {
  it("keduanya ADA di halaman, dan hidup di URL", () => {
    expect(HAL).toContain('type="search"');
    expect(HAL).toContain('aria-label="Cari riwayat opname"');
    expect(HAL).toContain('aria-label="Saring status"');
    /*
     * Di URL, bukan di useState. Halaman ini sering dimuat ulang sesudah
     * ACC/tolak; saringan yang hilang saat refresh membuat daftar yang tadinya
     * TERSARING tiba-tiba terbaca sebagai daftar penuh.
     */
    expect(HAL).toContain('params.get("status")');
    expect(HAL).toContain('params.get("q")');
  });

  it("TIAP keadaan yang bisa dirender badge dapat dicapai dari saringannya", () => {
    /*
     * Invarian yang paling mudah patah diam-diam: server menambah keadaan
     * kelima, badge-nya ikut mengenalinya, tapi daftar pilihan saringan tidak
     * — keadaan itu jadi tak bisa disaring, dan tak ada yang memberi tahu.
     * Sumber kebenarannya peta badge DI HALAMAN, bukan daftar yang saya ketik
     * di uji ini.
     */
    const keadaan = (nama: string) => {
      const i = HAL.indexOf(`function ${nama}(`);
      expect(i, `${nama} tak ditemukan`).toBeGreaterThan(-1);
      const peta = HAL.slice(i, i + 900);
      const isi = peta.slice(peta.indexOf("map: Record"), peta.indexOf("const b = map[status]"));
      return [...isi.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]!);
    };
    const bahan = keadaan("StatusBadge");
    const perl = keadaan("StatusBadgePerl");
    expect(bahan.length, `keadaan bahan terbaca: ${bahan.join(",")}`).toBe(4);
    expect(perl.length, `keadaan perlengkapan terbaca: ${perl.join(",")}`).toBe(3);
    for (const k of bahan) expect(SARINGAN_STATUS_OPNAME_BAHAN).toContain(k);
    for (const k of perl) expect(SARINGAN_STATUS_OPNAME_PERLENGKAPAN).toContain(k);
    // …dan sebaliknya: saringan tak boleh menawarkan keadaan yang tak pernah
    // ada, yang memulangkan daftar kosong selamanya.
    for (const s of SARINGAN_STATUS_OPNAME_BAHAN) if (s !== "semua") expect(bahan).toContain(s);
    for (const s of SARINGAN_STATUS_OPNAME_PERLENGKAPAN) {
      if (s !== "semua") expect(perl).toContain(s);
    }
  });

  it("saringan status DIBUANG saat pindah tab", () => {
    /*
     * `cocok` cuma ada di sisi bahan. Membawanya menyeberang ke tab
     * perlengkapan akan mengosongkan daftar dengan saringan yang TAK BISA
     * DILIHAT pemakainya di daftar pilihan mana pun — daftar kosong tanpa
     * sebab yang terbaca.
     */
    const badan = HAL.slice(HAL.indexOf("const gantiTab"), HAL.indexOf("const gantiTab") + 700);
    expect(badan).toContain("new URLSearchParams()");
    expect(badan).not.toContain('b.set("status"');
  });

  it("daftar yang DIPOTONG mengaku bahwa pencariannya juga terpotong", () => {
    /*
     * Yang paling mahal di putaran ini. Penyaringan dikerjakan DI KLIEN atas
     * potongan yang sudah dimuat (200 sesi bahan / 100 perlengkapan). Pada
     * perusahaan yang riwayatnya melewati plafon, "tidak ditemukan" berarti
     * "tidak ada di 200 sesi terakhir" — BUKAN "tidak pernah ada". Kedua
     * kalimat itu menuntun ke keputusan yang berlawanan, dan yang kedua yang
     * biasa disimpulkan orang.
     */
    const badan = HAL.slice(HAL.indexOf("const spanduk ="), HAL.indexOf("const spanduk =") + 900);
    expect(badan).toContain("adaSaringan");
    expect(badan).toContain("hanya menjangkau");
    // Kalimat itu hanya muncul saat saringannya aktif — spanduk yang selalu
    // menyebut pencarian pada halaman yang tak sedang dicari cuma kebisingan.
    expect(badan).toMatch(/\{adaSaringan && \(/);
  });

  it("keadaan KOSONG membedakan 'tak ada' dari 'tak cocok'", () => {
    // "Belum ada riwayat opname" pada daftar yang sedang disaring adalah
    // pernyataan yang salah tentang basis datanya.
    expect(HAL).toContain("yang cocok dengan saringan ini");
    expect(HAL).toMatch(/adaSaringan\s*\?[\s\S]{0,140}?cocok dengan saringan/);
  });
});

describe("aturan pencarian & saringan — rumah bersama", () => {
  const baris = { nomor: "SO-0007", oleh: "Owner Basooopa", catatan: "opname pagi" };

  it("kata kunci kosong cocok dengan SEMUA", () => {
    // Kotak pencarian yang belum diketik tak boleh mengosongkan daftar.
    expect(cocokCariOpname(baris, "")).toBe(true);
    expect(cocokCariOpname(baris, "   ")).toBe(true);
  });

  it("cocok ke nomor, nama, dan catatan — tak peduli besar-kecil huruf", () => {
    expect(cocokCariOpname(baris, "so-0007")).toBe(true);
    expect(cocokCariOpname(baris, "OWNER")).toBe(true);
    expect(cocokCariOpname(baris, "pagi")).toBe(true);
    expect(cocokCariOpname(baris, "SO-0008")).toBe(false);
  });

  it("beberapa kata di-AND, bukan di-OR", () => {
    /*
     * Kalau di-OR, mempersempit pencarian justru MENAMBAH baris — "SO-0007
     * owner" akan memulangkan semua milik Owner. Pencarian yang membesar saat
     * dipersempit terbaca seperti pencarian yang rusak.
     */
    expect(cocokCariOpname(baris, "SO-0007 owner")).toBe(true);
    expect(cocokCariOpname(baris, "SO-0007 kasir")).toBe(false);
    expect(cocokCariOpname({ nomor: "SO-0009", oleh: "Kasir Pusat", catatan: null }, "SO-0007 kasir")).toBe(
      false,
    );
  });

  it("null diperlakukan teks kosong, bukan 'cocok apa saja'", () => {
    const kosong = { nomor: null, oleh: null };
    expect(cocokCariOpname(kosong, "")).toBe(true);
    expect(cocokCariOpname(kosong, "owner")).toBe(false);
    // `catatan` opsional (sisi perlengkapan tak punya) tak boleh melempar.
    expect(cocokCariOpname({ nomor: "OP-0003", oleh: null }, "op-0003")).toBe(true);
  });

  it("`semua` melewatkan setiap status; selain itu cocok persis", () => {
    for (const s of ["cocok", "menunggu", "disetujui", "ditolak"]) {
      expect(lolosSaringanStatus(s, "semua")).toBe(true);
    }
    expect(lolosSaringanStatus("menunggu", "menunggu")).toBe(true);
    expect(lolosSaringanStatus("menunggu", "disetujui")).toBe(false);
  });
});

describe("RATCHET detektor: `error` yang diambil wajib DIPAKAI", () => {
  /*
   * Lahir dari bukti merah putaran ini, dan dari KEGAGALANNYA.
   *
   * `gagal-muat-bukan-kosong` menandai sebuah situs `useQuery` sebagai "GALAT
   * tertangani" begitu `error:` muncul di destructuring-nya — ia tak pernah
   * memeriksa apakah galat itu SAMPAI KE MATA. Saya mencabut
   * `<SpinnerAtauGalat>` dari halaman ini, membiarkan bacaan yang gagal jatuh
   * ke tabel kosong ber-"Belum ada riwayat opname", dan seluruh sapuannya
   * tetap HIJAU.
   *
   * Kelasnya sama dengan yang baru saja ditutup di `kunci-satu-kontrak`:
   * gerbang yang memeriksa BAHANNYA ADA, bukan bahannya DIPAKAI.
   *
   * Diukur sebelum dipasang: 93 situs mengambil `error`, dan NOL di antaranya
   * membuangnya. Jadi ini RATCHET, bukan perbaikan — tak ada yang sedang
   * salah, dan yang dijaga adalah bahwa besok pun tak ada.
   */
  const AKAR = fileURLToPath(new URL("../../web/src/", import.meta.url));

  it("premis: sapuannya benar-benar memulangkan populasi web", () => {
    const situs = situsKueriWeb();
    expect(situs.length, "sapuan useQuery memulangkan terlalu sedikit").toBeGreaterThan(80);
    expect(situs.some((s) => s.berkas.includes("OpnameRiwayatPage"))).toBe(true);
  });

  it("tak satu pun `error:` yang diambil lalu tak pernah disebut lagi", () => {
    const mati: string[] = [];
    const periksa = (p: string) => {
      const isi = readFileSync(p, "utf8");
      if (!isi.includes("useQuery(")) return;
      for (const m of isi.matchAll(/const\s*\{([^}]*)\}\s*=\s*useQuery\(/g)) {
        for (const em of m[1]!.matchAll(/\berror\s*:\s*(\w+)|(\berror\b)(?=\s*[,}])/g)) {
          const nama = em[1] ?? "error";
          const dipakai = (isi.match(new RegExp(`\\b${nama}\\b`, "g")) ?? []).length;
          if (dipakai <= 1) mati.push(`${p.slice(AKAR.length)} — error: ${nama}`);
        }
      }
    };
    const jelajahi = (dir: string) => {
      for (const nama of readdirSync(dir)) {
        if (nama === "node_modules" || nama === "dist") continue;
        const p = `${dir}${nama}`;
        if (statSync(p).isDirectory()) jelajahi(`${p}/`);
        else if (nama.endsWith(".tsx")) periksa(p);
      }
    };
    jelajahi(AKAR);
    expect(
      mati.sort(),
      "`error` diambil dari useQuery lalu tak pernah dipakai. Sapuan " +
        "`gagal-muat-bukan-kosong` menganggap situs ini SUDAH menangani galat " +
        "hanya karena namanya ada di destructuring — jadi bacaan yang gagal " +
        "akan diam-diam terbaca sebagai 'belum ada data':\n" +
        mati.join("\n"),
    ).toEqual([]);
  });
});
