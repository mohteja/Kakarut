import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

describe("aturan rumah: tiap penanda `terpotong` di DTO wajib dibaca web", () => {
  /**
   * Inilah yang seharusnya menangkap bug ini sejak awal. Penanda pemotongan
   * yang dihitung server tapi tak pernah dibaca layar sama saja dengan tidak
   * ada — dan cacatnya tak kelihatan dari sisi mana pun sendirian: server
   * tampak benar (ia menghitungnya), web tampak benar (ia tak tahu ada).
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
