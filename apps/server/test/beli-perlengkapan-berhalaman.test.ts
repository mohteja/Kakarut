import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butuhAksiBP, emberFakturBP, statusFakturBP } from "@kakarut/shared";
import type { BeliPerlengkapanStatus } from "@kakarut/shared";

/**
 * PENJAGA DAFTAR BELI PERLENGKAPAN — berhalaman per FAKTUR, dan aturan
 * statusnya satu rumah.
 *
 * Dua hal yang dijaga, dan keduanya tak bergejala saat rusak:
 *
 * 1. **Halaman diiris per FAKTUR, bukan per baris.** Mengiris per baris
 *    mengirim faktur yang terpotong di tengah — kartu berisi separuh itemnya,
 *    tanpa satu pun penanda bahwa sisanya ada.
 * 2. **Aturan statusnya satu.** Sampai putaran ini web dan ponsel memakai
 *    aturan yang BERBEDA: web "tahap paling tertinggal" (empat keadaan),
 *    ponsel "buang batal dulu, campuran tiba → `sebagian`" (lima). Faktur
 *    berisi [tiba, menunggu] berbunyi "Menunggu" di satu layar dan "Sebagian"
 *    di layar lain.
 */
// Jalurnya ditulis LITERAL, bukan dirakit dari `${SRV}/...`: `jangkar-iris`
// menelusuri berkas sumber sebuah uji dengan membaca teks jalurnya, dan jalur
// yang dirakit interpolasi tak bisa ditelusurinya — ujinya lolos sebagai
// "berjangkar tanpa sumber", persis kebutaan yang penjaga itu ada untuk
// menolak.
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const SERVICE = baca("../src/modules/perlengkapan/service.ts");
const ROUTES = baca("../src/modules/perlengkapan/routes.ts");
const HAL = baca("../../web/src/pages/perlengkapan/BeliPerlengkapanPage.tsx");
const KOLOM = baca("../../web/src/pages/perlengkapan/kolom-beli-perlengkapan.tsx");

const r = (status: BeliPerlengkapanStatus) => ({ status });

describe("statusFakturBP: tabel kebenaran", () => {
  it("seluruhnya menunggu → menunggu", () => {
    expect(statusFakturBP([r("menunggu"), r("menunggu")])).toBe("menunggu");
  });
  it("seluruhnya tiba → tiba", () => {
    expect(statusFakturBP([r("tiba"), r("tiba")])).toBe("tiba");
  });
  it("seluruhnya batal → batal", () => {
    // Satu-satunya jalan ke `batal`: TAK ADA baris hidup tersisa.
    expect(statusFakturBP([r("batal"), r("batal")])).toBe("batal");
  });
  it("campuran tiba + menunggu → sebagian (bukan menunggu)", () => {
    // INI perbedaan web-vs-ponsel yang menjadi sebab berkas ini ada.
    expect(statusFakturBP([r("tiba"), r("menunggu")])).toBe("sebagian");
  });
  it("campuran tiba + batal → tiba (batal tak menahan)", () => {
    // Membatalkan satu item dari faktur berisi dua tak boleh membuat
    // fakturnya terlihat belum selesai — barang yang datang sudah datang.
    expect(statusFakturBP([r("tiba"), r("batal")])).toBe("tiba");
  });
  it("campuran menunggu + batal → menunggu", () => {
    expect(statusFakturBP([r("menunggu"), r("batal")])).toBe("menunggu");
  });
  it("diproses menang atas menunggu bila tak ada yang tiba", () => {
    expect(statusFakturBP([r("diproses"), r("menunggu")])).toBe("diproses");
  });
  it("faktur KOSONG → batal, bukan lemparan", () => {
    // Tak terjadi lewat rutenya (faktur selalu punya baris), tapi jawabannya
    // harus ditentukan — bukan `undefined` yang merender lencana kosong.
    expect(statusFakturBP([])).toBe("batal");
  });

  it("ketiga ember SALING LEPAS dan menutupi kelima keadaan", () => {
    const semua = ["menunggu", "diproses", "sebagian", "tiba", "batal"] as const;
    const ember = semua.map(emberFakturBP);
    expect(ember).toEqual(["butuh_aksi", "butuh_aksi", "butuh_aksi", "tiba", "batal"]);
    // `butuhAksiBP` tak boleh jadi aturan KEDUA — ia harus diturunkan.
    expect(semua.map(butuhAksiBP)).toEqual([true, true, true, false, false]);
  });
});

describe("server: halaman diiris per FAKTUR", () => {
  it("kunci faktur SATU definisi, dipakai agregat & kueri baris", () => {
    expect(SERVICE).toContain("const kunciFaktur = sql<string>");
    // Dipakai `groupBy` agregatnya DAN pembatas kueri barisnya.
    expect(SERVICE).toContain("groupBy(kunciFaktur)");
    expect(SERVICE).toContain("inArray(kunciFaktur, kunciHalaman)");
  });

  it("MAX(created_at), bukan MIN", () => {
    // Tahap berpindah dengan menulis ulang barisnya, jadi yang menentukan
    // posisi adalah sentuhan TERAKHIR. Pada fikstur segar MIN==MAX, jadi
    // salahnya lolos uji dan baru muncul di data hidup.
    const i = SERVICE.indexOf("waktu: sql<Date>");
    expect(i).toBeGreaterThan(0);
    expect(SERVICE.slice(i, i + 120)).toContain("max(");
    expect(SERVICE.slice(i, i + 120)).not.toContain("min(");
  });

  it("urutan halaman punya PEMUTUS SERI", () => {
    // Kedua kunci urut di atasnya agregat; dua faktur berwaktu sama tak punya
    // urutan sama sekali. Dipadu OFFSET, akibatnya faktur yang tak muncul di
    // halaman MANA PUN — `GET /produksi` sudah membayar bug ini.
    expect(SERVICE).toContain("asc(perFaktur.kunci)");
  });

  it("baris disusun ulang mengikuti kunciHalaman, bukan urutan kueri", () => {
    expect(SERVICE).toContain("kunciHalaman.flatMap((k) => perKunci.get(k) ?? [])");
    expect(SERVICE).not.toContain("[...perKunci.values()]");
  });

  it("ringkas & total lahir dari SATU kueri atas agregat yang sama", () => {
    // Mustahil ringkasannya bicara soal populasi yang berbeda dari judulnya.
    const i = SERVICE.indexOf("const [hitung] = await db");
    expect(i).toBeGreaterThan(0);
    const blok = SERVICE.slice(i, i + 700);
    expect(blok).toContain("count(*)::int");
    expect(blok).toContain(".from(perFaktur)");
  });

  it("rutenya memulangkan amplop berkunci, bukan larik", () => {
    expect(ROUTES).toContain("const dto: BeliPerlengkapanDaftar");
    expect(ROUTES).toContain("halamanQuery(c, {");
    // Batas maksimumnya TETAP dipakai — sebagai plafon `per_page`, bukan
    // sebagai pemotong diam-diam.
    expect(ROUTES).toContain("maks: BATAS_BELI_PERLENGKAPAN");
  });
});

describe("SEMUA pemanggil web sudah ikut bentuk barunya", () => {
  /*
   * Cacat yang benar-benar lolos ke gerbang putaran ini, dan yang paling
   * mahal di antaranya.
   *
   * Saya mengubah balasan `GET /perlengkapan/beli` dari larik jadi objek, lalu
   * memperbaiki HALAMANNYA — dan melewatkan pemanggil kedua: lencana sidebar
   * di `Layout.tsx`, yang menarik daftar yang sama lalu menyaringnya sendiri.
   * `(bpNav ?? []).filter` melempar pada objek, dan karena lencana itu hidup
   * di LAYOUT, yang runtuh bukan halaman perlengkapan melainkan **setiap
   * halaman aplikasi**: 19 spec merah, dan tak satu pun menyebut perlengkapan.
   *
   * Penjaga statis putaran ini tak menangkapnya sebab ia hanya membaca berkas
   * yang saya SEBUT. Yang menangkapnya lengan peramban — sesudah tembok kuota
   * login disingkirkan; sebelum itu kegagalannya tersamar 429.
   *
   * Sapuan di bawah menutupnya secara struktural: tiap pemanggil rute ini di
   * `apps/web/src` harus mengetiknya `BeliPerlengkapanDaftar`. Larik telanjang
   * = merah.
   */
  const SRC_WEB = fileURLToPath(new URL("../../web/src", import.meta.url));

  function pemanggilRute(): { berkas: string; baris: number; isi: string }[] {
    const keluar: { berkas: string; baris: number; isi: string }[] = [];
    const jelajahDir = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const jalur = `${dir}/${e.name}`;
        if (e.isDirectory()) jelajahDir(jalur);
        else if (/\.tsx?$/.test(e.name)) {
          const isi = readFileSync(jalur, "utf8");
          /*
           * Dipindai atas SELURUH teks berkas, bukan baris demi baris.
           * Pemanggil di `BeliPerlengkapanPage` dipecah prettier jadi tiga
           * baris — `api<T>(`, jalurnya, lalu `)` — jadi pemindai per-baris
           * hanya menemukan SATU dari dua pemanggil dan lolos dengan tenang.
           * Itu kelas kebutaan yang sama dengan jendela-teks yang sudah
           * menggigit putaran sebelumnya.
           */
          const pola = /api<([^>]*)>\(\s*[`"'][^`"']*\/perlengkapan\/beli(\?|[`"'])/g;
          for (const m of isi.matchAll(pola)) {
            keluar.push({
              berkas: jalur.slice(SRC_WEB.length + 1),
              baris: isi.slice(0, m.index).split("\n").length,
              isi: m[1],
            });
          }
        }
      }
    };
    jelajahDir(SRC_WEB);
    return keluar;
  }

  it("PREMIS: sapuannya menemukan pemanggilnya (bukan nol karena regex patah)", () => {
    const p = pemanggilRute();
    expect(p.length, "tak satu pemanggil ditemukan — regexnya patah").toBeGreaterThanOrEqual(2);
  });

  it("tiap pemanggil mengetiknya BeliPerlengkapanDaftar, bukan larik", () => {
    const larik = pemanggilRute()
      .filter((p) => p.isi.trim() !== "BeliPerlengkapanDaftar")
      .map((p) => `${p.berkas}:${p.baris}`);
    expect(
      larik,
      "pemanggil yang masih mengharap LARIK — `.filter`/`.map` di atasnya akan " +
        "melempar, dan bila pemanggilnya hidup di Layout yang runtuh adalah " +
        "setiap halaman aplikasi",
    ).toEqual([]);
  });

  it("lencana sidebar memakai angka SERVER, bukan menyaring daftarnya sendiri", () => {
    const layout = readFileSync(`${SRC_WEB}/components/Layout.tsx`, "utf8");
    expect(layout).toContain("bpNav?.ringkas.butuh_aksi");
    // …dan meminta halaman terkecil: yang dibutuhkan cuma `ringkas`.
    expect(layout).toContain("/perlengkapan/beli?per_page=1");
  });
});

describe("web: satu aturan, dan urutan server dihormati", () => {
  it("halaman TIDAK lagi mendefinisikan aturan statusnya sendiri", () => {
    expect(HAL).toContain("statusFakturBP(g.rows)");
    // Bentuk lama yang menganyam status sambil menggelung barisnya.
    expect(HAL).not.toContain('if (r.status === "menunggu") g.status');
    expect(HAL).not.toContain("function butuhAksi(");
  });

  it("kelompokkanFaktur TIDAK mengurut ulang — halaman milik server", () => {
    const i = HAL.indexOf("function kelompokkanFaktur");
    expect(i).toBeGreaterThan(0);
    const blok = HAL.slice(i, i + 2200);
    expect(blok).toContain("return [...byKey.values()];");
    expect(blok).not.toContain(".sort(");
  });

  it("lencana mengenal kelima keadaan, termasuk `sebagian`", () => {
    const i = HAL.indexOf("export function BeliStatusBadge");
    expect(i).toBeGreaterThan(0);
    const blok = HAL.slice(i, i + 900);
    for (const s of ["menunggu", "diproses", "sebagian", "tiba", "batal"]) {
      expect(blok, `lencana kehilangan keadaan ${s}`).toContain(`${s}:`);
    }
  });

  it("ubin ringkasan dari SERVER, dan tak dirender saat bacaannya gagal", () => {
    // Ubin yang menjumlahkan halaman berjalan akan berbunyi "3 perlu diurus"
    // untuk perusahaan yang punya 40; "0 perlu diurus" di atas bacaan yang
    // gagal terbaca sebagai "tak ada yang perlu dibeli".
    expect(HAL).toContain("{!gagalMuat && daftar?.ringkas && total > 0 && (");
    expect(HAL).toContain("daftar.ringkas.butuh_aksi");
    expect(HAL).not.toContain("grup.filter((g) => butuhAksiBP(g.status)).length");
  });

  it("GAGAL diperiksa sebelum KOSONG", () => {
    const g = HAL.indexOf("{gagalMuat ? (");
    const k = HAL.indexOf("Belum ada faktur beli perlengkapan.");
    expect(g).toBeGreaterThan(0);
    expect(k).toBeGreaterThan(g);
  });

  it("sakelar bentuk ada, bawaannya KARTU", () => {
    // Bawaan = bentuk yang sudah ada sebelum tombolnya, jadi tak ada yang
    // berubah bagi pemakai yang tak menyentuhnya.
    expect(HAL).toContain('useTampilan<"kartu" | "tabel">(');
    expect(HAL).toContain('"kakarut.beliPerlengkapanTampilan"');
    const i = HAL.indexOf('"kakarut.beliPerlengkapanTampilan"');
    expect(HAL.slice(i, i + 120)).toContain('"kartu",');
  });

  it("kolomnya punya rumah sendiri & urutannya dipaku", () => {
    const judul = [...KOLOM.matchAll(/judul: "([^"]+)"/g)].map((m) => m[1]);
    expect(judul).toEqual([
      "Dokumen",
      "Dibuat",
      "Tujuan",
      "Isi",
      "Status",
      "Nilai",
      "Orang",
      "Aksi",
    ]);
  });

  it("kolom Nilai membedakan harga RIIL dari ESTIMASI", () => {
    // Estimasi RAB yang dipajang tanpa penanda membuat angka rencana terbaca
    // sebagai angka belanja — dan itu angka yang dipakai orang menutup buku.
    expect(KOLOM).toContain("estimasi: true");
    expect(KOLOM).toContain("est. ");
  });
});
