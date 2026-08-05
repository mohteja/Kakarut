import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga OPERASIONAL CABANG — layar tempat owner mengawasi kas cabang.
 *
 * Tiga bacaan di halaman ini tak menangkap `error` sama sekali. Di React
 * Query v5 bacaan yang GAGAL berakhir `isLoading === false` DAN
 * `data === undefined`, jadi `data = []` mengubah kegagalan jadi "kosong" —
 * dan ketiga keadaan kosongnya MENGKLAIM sesuatu:
 *
 *  1. `PerluAccPanel` → `if (data.length === 0) return null`. Panelnya lenyap
 *     tanpa jejak dan halaman terlihat bersih. Ini yang paling mahal, karena
 *     docstring panel itu sendiri menyebut alasannya ada: "selisih yang belum
 *     diputuskan bisa berasal dari shift kemarin di cabang yang hari ini belum
 *     buka — kalau hanya muncul di riwayat per cabang, ia harus DICARI, dan
 *     yang harus dicari tidak akan ketemu". Bacaan yang gagal mengembalikan
 *     persis keadaan yang panel ini dibuat untuk mencegahnya.
 *  2. Halaman utama → "Belum ada cabang store. Tambahkan cabang di Pengaturan
 *     → Cabang." Menyatakan perusahaannya tak punya cabang, lalu menyuruh
 *     membuat yang sudah ada.
 *  3. `RiwayatCabangModal` → "Belum ada shift ditutup di cabang ini."
 *     Menyatakan cabang itu tak pernah menutup shift.
 *
 * Ketiganya bentuk yang sama: BACAAN GAGAL DIRENDER SEBAGAI KABAR BAIK.
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/operasional/OperasionalPage.tsx", import.meta.url)),
  "utf8",
);

describe("panel selisih kas tak boleh lenyap saat bacaannya gagal", () => {
  it("galatnya ditangkap", () => {
    expect(HAL).toContain('const { data = [], error: gagal } = useQuery({');
    expect(HAL).toContain('queryKey: ["shift-selisih", "menunggu"],');
  });

  it("galat diperiksa SEBELUM `return null`", () => {
    const iGagal = HAL.indexOf("  if (gagal) {");
    const iNull = HAL.indexOf("if (data.length === 0) return null;");
    expect(iGagal).toBeGreaterThan(0);
    expect(iNull).toBeGreaterThan(iGagal);
  });

  it("dan yang tampil menyangkal kesimpulan 'tak ada'", () => {
    expect(HAL).toContain("tidak terbaca");
    expect(HAL).toContain("bukan</b> berarti tak ada yang perlu diputuskan");
  });

  it("sebabnya ditulis — supaya `return null` tak dikembalikan ke atas", () => {
    expect(HAL).toContain("Panel ini ada PERSIS supaya selisih yang menunggu tak perlu dicari");
  });
});

describe("halaman utama tak lagi menyuruh membuat cabang yang sudah ada", () => {
  it("`isLoading` tak dipakai lagi sebagai penentu", () => {
    expect(HAL).not.toContain("if (isLoading) return <Spinner />;");
    expect(HAL).toContain("const { data, error: gagalPantau } = useQuery({");
  });

  it("bacaan gagal → SpinnerAtauGalat, bukan keadaan kosong", () => {
    expect(HAL).toContain('<SpinnerAtauGalat error={gagalPantau} apa="Pantauan operasional cabang" />');
    const iGagal = HAL.indexOf("{!data ? (\n        <SpinnerAtauGalat error={gagalPantau}");
    const iKosong = HAL.indexOf("Belum ada cabang store.");
    expect(iGagal).toBeGreaterThan(0);
    expect(iKosong).toBeGreaterThan(iGagal);
  });

  it("keadaan kosong yang SAH tetap ada — bukan dihapus", () => {
    // Arah sebaliknya: perusahaan yang memang belum punya cabang store harus
    // tetap diberi petunjuk membuatnya.
    expect(HAL).toContain("Tambahkan cabang di Pengaturan → Cabang.");
  });
});

describe("riwayat shift per cabang", () => {
  it("galatnya ditangkap dan dipakai", () => {
    expect(HAL).toContain("const { data, error: gagal } = useQuery({");
    expect(HAL).toContain('<SpinnerAtauGalat error={gagal} apa="Riwayat shift cabang" />');
  });

  it("klaim 'belum ada shift ditutup' hanya untuk data yang BENAR-BENAR terbaca", () => {
    const iGagal = HAL.indexOf('apa="Riwayat shift cabang"');
    const iKlaim = HAL.indexOf("Belum ada shift ditutup di cabang ini.");
    expect(iGagal).toBeGreaterThan(0);
    expect(iKlaim).toBeGreaterThan(iGagal);
  });
});

describe("premis: SpinnerAtauGalat memang untuk sebab ini", () => {
  const UI = readFileSync(
    fileURLToPath(new URL("../../web/src/components/ui.tsx", import.meta.url)),
    "utf8",
  );

  it("tanpa galat ia spinner; dengan galat ia berbicara", () => {
    expect(UI).toContain("  if (!error) return <Spinner />;");
    expect(UI).toContain("gagal dimuat.");
  });
});
