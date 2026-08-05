import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga HASIL BEP vs FILTER CABANG — angka yang benar untuk cabang yang salah.
 *
 * Halaman Laporan punya dua sumber angka yang tampil berdampingan, tapi
 * disimpan dengan cara yang berbeda:
 *
 *   - laporan harian → `useQuery`, dan kuncinya MEMUAT `cabangFilter`, jadi
 *     mengganti cabang otomatis memuat ulang;
 *   - hasil BEP     → `useState` biasa, diisi sekali saat tombol Hitung
 *     ditekan, dan tak ada yang membuangnya.
 *
 * Padahal `/laporan/bep` disaring `branchCondLaporan` — jawabannya BEDA per
 * cabang. Jadi sesudah owner mengganti cabang, seluruh laporan di atas
 * berganti sementara kartu BEP tetap memajang angka cabang SEBELUMNYA, di
 * bawah judul yang sekarang menyebut cabang lain, tanpa satu pun tanda bahwa
 * keduanya bukan sepasang.
 *
 * Yang dipertaruhkan bukan tampilan. BEP dipakai owner untuk memutuskan harga
 * jual — komentar pada kotak biaya tetap di halaman itu menyebutnya sendiri:
 * "salah di sini menyesatkan keputusan, bukan cuma tampilan".
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const LAPORAN = baca("../../web/src/pages/laporan/LaporanPage.tsx");
const RUTE = baca("../src/modules/laporan/routes.ts");

describe("premis: BEP memang berbeda per cabang", () => {
  it("rutenya menyaring dengan `branchCondLaporan`", () => {
    const i = RUTE.indexOf('"/bep"');
    expect(i, "rute /bep tak ditemukan").toBeGreaterThan(0);
    expect(RUTE.slice(i, i + 900)).toContain("branchCondLaporan(c)");
  });

  it("dan klien memang mengirimkan cabangnya", () => {
    expect(LAPORAN).toContain("/laporan/bep?biaya_tetap=${Number(biayaTetap)}${branchParam}");
    expect(LAPORAN).toContain('const branchParam = isManajemen ? `&branch_id=${cabangFilter}` : "";');
  });

  it("premis kedua: laporan harian SUDAH ikut cabang lewat kunci query-nya", () => {
    // Justru itu yang membuat kartu BEP menonjol: tetangganya berganti, ia
    // tidak.
    expect(LAPORAN).toContain('queryKey: ["laporan", dari, sampai, isManajemen ? cabangFilter : "self"]');
  });

  it("hasil BEP memang state biasa, bukan useQuery", () => {
    expect(LAPORAN).toContain("const [bep, setBep] = useState<BepResult | null>(null);");
  });
});

describe("ganti cabang membuang hasil BEP", () => {
  const iSelect = LAPORAN.indexOf("value={cabangFilter}");
  const BLOK = LAPORAN.slice(iSelect, LAPORAN.indexOf("className={inputClass}", iSelect));

  it("`setCabangFilter` tak lagi sendirian di onChange-nya", () => {
    expect(iSelect, "select cabang tak ditemukan").toBeGreaterThan(0);
    expect(BLOK).toContain("setCabangFilter(e.target.value);");
    expect(BLOK).toContain("setBep(null);");
  });

  it("galat BEP ikut dibuang — sisa pesan lama menuduh cabang yang keliru", () => {
    expect(BLOK).toContain("setBepError(null);");
  });

  it("bentuk lama (onChange satu baris) sudah tidak ada", () => {
    expect(LAPORAN).not.toContain("onChange={(e) => setCabangFilter(e.target.value)}");
  });

  it("kartunya yang mendadak kosong DIJELASKAN, bukan dibiarkan misterius", () => {
    // Angka yang hilang tanpa sebab terbaca seperti kerusakan.
    expect(LAPORAN).toContain("Mengikuti filter");
    expect(LAPORAN).toContain("ganti cabang, hitung ulang");
  });
});

describe("yang SENGAJA tidak ikut membuang", () => {
  it("rentang tanggal — `/laporan/bep` tak menerima tanggal sama sekali", () => {
    // Server memakai jendela 30 harinya sendiri, jadi mengganti tanggal tidak
    // membuat hasil BEP basi. Membuangnya di situ hanya akan memaksa owner
    // menghitung ulang tanpa alasan.
    expect(LAPORAN).toContain("onChange={(e) => setDari(e.target.value)}");
    expect(LAPORAN).toContain("onChange={(e) => setSampai(e.target.value)}");
    const iDari = LAPORAN.indexOf("onChange={(e) => setDari(e.target.value)}");
    expect(LAPORAN.slice(iDari - 200, iDari + 200)).not.toContain("setBep(");
  });

  it("dan permintaan BEP memang tak membawa dari/sampai", () => {
    const i = LAPORAN.indexOf("/laporan/bep?");
    const url = LAPORAN.slice(i, LAPORAN.indexOf("`", i + 5));
    expect(url).not.toContain("dari=");
    expect(url).not.toContain("sampai=");
  });
});
