import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga TULISAN OPTIMISTIS di Papan Pesanan.
 *
 * Papan ini memoles ulang tiap 15 detik DAN menulis perubahan ke cache sebelum
 * server menjawab. Dua sifat itu bersama melahirkan satu balapan: permintaan
 * polling yang sudah berangkat saat jari menekan tombol membawa keadaan SEBELUM
 * ketukan, dan begitu ia mendarat sesudah tulisan optimistis, ia menimpanya.
 * Kartu melompat balik ke kolom asalnya lalu maju lagi — di dapur itu terbaca
 * "ketukan saya tidak masuk", dan orang menekan lagi.
 *
 * Halamannya sudah menyadari bahaya ini dan memasang `refetchInterval: adaAksi
 * ? false : 15_000`. Penjaga itu benar untuk permintaan BERIKUTNYA, tapi tak
 * bisa menarik pulang yang sudah di udara — dan `adaAksi` sendiri baru bernilai
 * true SESUDAH `onMutate` jalan. Yang menutupnya adalah `cancelQueries`, dan
 * urutannya yang dijaga di sini: batalkan dulu, baru potret, baru tulis.
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/pesanan/PesananPage.tsx", import.meta.url)),
  "utf8",
);
const tanpaKomentar = HAL.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("premis: papan ini memang memoles ulang sambil menulis optimistis", () => {
  it("ada polling berkala", () => {
    // Tanpa polling tak ada permintaan yang bisa mendarat terlambat, dan seluruh
    // penjagaan di bawah kehilangan alasannya.
    expect(tanpaKomentar).toMatch(/refetchInterval: adaAksi \? false : 15_000/);
  });

  it("dan memang menulis ke cache sebelum server menjawab", () => {
    expect(tanpaKomentar).toContain("queryClient.setQueryData<PesananRow[]>(kunci");
  });

  it("pembuang komentar tidak memakan kodenya", () => {
    expect(tanpaKomentar).toContain("cancelQueries");
    expect(tanpaKomentar).not.toContain("ketukan saya tidak masuk");
  });
});

describe("resep optimistis lengkap dan berurutan", () => {
  it("membatalkan bacaan yang sedang di udara", () => {
    expect(tanpaKomentar).toContain("await queryClient.cancelQueries({ queryKey: kunci })");
  });

  it("batalkan DULU, baru potret, baru tulis", () => {
    // Urutannya yang menentukan. `getQueryData` sebelum `cancelQueries` masih
    // memotret keadaan yang benar, tapi bacaan yang di udara tetap mendarat
    // sesudah tulisan optimistis — persis lompatan yang mau dihilangkan.
    const iBatal = tanpaKomentar.indexOf("cancelQueries");
    const iPotret = tanpaKomentar.indexOf("getQueryData<PesananRow[]>(kunci)");
    const iTulis = tanpaKomentar.indexOf("setQueryData<PesananRow[]>(kunci");
    expect(iBatal, "cancelQueries tak ditemukan").toBeGreaterThan(0);
    expect(iPotret, "potret sebelum-nya tak ditemukan").toBeGreaterThan(iBatal);
    expect(iTulis).toBeGreaterThan(iPotret);
  });

  it("SEMUA aksi lewat jalur yang sama — tak ada yang menyelinap", () => {
    // Kalau suatu saat ada mutasi baru yang menulis cache sendiri tanpa
    // `terapkanOptimistis`, ia lolos dari pembatalan dan balapannya kembali.
    const onMutate = tanpaKomentar.match(/onMutate:/g) ?? [];
    const lewatJalur = tanpaKomentar.match(/onMutate: \(v\) =>\s*terapkanOptimistis\(/g) ?? [];
    expect(onMutate.length).toBeGreaterThanOrEqual(3);
    expect(lewatJalur.length).toBe(onMutate.length);
  });

  it("dan setiap aksi punya jalan pulang saat server menolak", () => {
    const onError = tanpaKomentar.match(/onError: \(_e, _v, ctx\) => pulihkan\(ctx\)/g) ?? [];
    expect(onError.length).toBe(3);
    expect(tanpaKomentar).toMatch(/if \(ctx\?\.sebelum\) queryClient\.setQueryData\(kunci, ctx\.sebelum\)/);
  });
});

/**
 * Penjaga PAPAN TIDAK MEMBEKU DI TANGGAL KEMARIN.
 *
 * Tablet dapur menyala sepanjang shift, dan banyak rumah makan masih melayani
 * lewat tengah malam. Dengan tanggal yang dibekukan saat halaman dibuka, papan
 * terus meminta tanggal LAMA — dengan sukses, tiap 15 detik — sementara server
 * sudah membukukan pesanan pada tanggal BARU. Pesanan baru tak pernah muncul
 * dan tak ada yang mengatakannya.
 *
 * Bahwa ini bukan tafsir: badge "Pesanan Masuk" di `Layout` menghitung
 * `hariIniWIB()` setiap render, jadi sesudah tengah malam sidebar dan papan
 * menyebut angka berbeda — dan yang keliru justru papan.
 */
describe("tanggal papan mengikuti jam dinding", () => {
  it("premis: badge sidebar memang menghitung hari ini tiap render", () => {
    const layout = readFileSync(
      fileURLToPath(new URL("../../web/src/components/Layout.tsx", import.meta.url)),
      "utf8",
    );
    expect(layout).toMatch(/const hariIniPesanan = hariIniWIB\(\);/);
  });

  it("tanggalnya tidak lagi dibekukan saat halaman dibuka", () => {
    expect(tanpaKomentar).not.toMatch(/useState\(hariIniWIB\(\)\)\s*;?\s*\n?\s*const \[fokus/);
    expect(tanpaKomentar).not.toContain("const [tanggal, setTanggal] = useState(hariIniWIB())");
  });

  it("ada denyut yang memperbarui 'hari ini'", () => {
    expect(tanpaKomentar).toMatch(/setInterval\(\(\) => setHariIni\(hariIniWIB\(\)\), 60_000\)/);
    // Tanpa pembersihan, tiap pemasangan ulang menumpuk denyut baru.
    expect(tanpaKomentar).toMatch(/return \(\) => clearInterval\(t\)/);
  });

  it("null = ikut hari ini; tanggal yang DIPILIH tetap dihormati", () => {
    expect(tanpaKomentar).toContain("const tanggal = tanggalPilihan ?? hariIni;");
    // Mengosongkan kotak tanggal kembali mengikuti hari ini, bukan mengirim "".
    expect(tanpaKomentar).toMatch(/setTanggalPilihan\(e\.target\.value \|\| null\)/);
  });

  it("papan yang bukan hari ini MENGATAKANNYA, bukan cuma menampilkan tanggal", () => {
    // Kotak `type="date"` terbaca seperti penyaring biasa; dapur tak punya cara
    // lain tahu bahwa pesanan baru tak akan pernah muncul di layar ini.
    expect(tanpaKomentar).toMatch(/\{tanggal !== hariIni && \(/);
    expect(tanpaKomentar).toContain("bukan hari ini");
    expect(tanpaKomentar).toContain("Ke hari ini");
    expect(tanpaKomentar).toMatch(/onClick=\{\(\) => setTanggalPilihan\(null\)\}/);
  });

  it("spanduknya muncul SEBELUM papan, bukan terkubur di bawah kartu", () => {
    const iSpanduk = tanpaKomentar.indexOf("{tanggal !== hariIni && (");
    const iKolom = tanpaKomentar.indexOf("KOLOM.map");
    expect(iSpanduk).toBeGreaterThan(0);
    expect(iKolom).toBeGreaterThan(iSpanduk);
  });

  it("tak ada sisa `setTanggal` yang menulis ke keadaan yang sudah hilang", () => {
    expect(tanpaKomentar).not.toMatch(/\bsetTanggal\(/);
  });
});
