import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { kunciKontrak } from "../src/scripts/acuan-kunci-mobile";

/**
 * PEMBANGKIT FIKSTUR KUNCI KONTRAK — penjaga untuk alat ukurnya.
 *
 * Uji cermin `kunci_kontrak_server_test.dart` di `mohteja/kakarut-mobile`
 * menagih tiap kunci kontrak diputuskan: dibaca ponsel, atau tercatat belum.
 * Ia membaca `test/fikstur/kunci-kontrak-server.txt` yang DIHASILKAN
 * `npm run acuan:kunci-mobile` di repo ini.
 *
 * Yang dijaga DI SINI pembangkitnya — fikstur yang menyusut diam-diam membuat
 * uji di sana hijau tanpa menyatakan apa pun (aturan 7: alat ukurnya ikut
 * diuji). Angka saat ditulis: 1.127 baris `Interface|kunci`, 463 kunci unik,
 * 390 disentuh Dart, 73 tercatat belum.
 */
describe("acuan:kunci-mobile — pembangkit fikstur kunci kontrak", () => {
  const baris = kunciKontrak();

  it("premis: keluarannya sebesar kontraknya, bukan pecahannya", () => {
    expect(baris.length, "fikstur menyusut — pengurai types.ts berhenti melihat sebagian").toBeGreaterThan(1000);
    const unik = new Set(baris.map((b) => b.split("|")[1]));
    expect(unik.size, "kunci unik").toBeGreaterThan(400);
  });

  it("kunci historis vena #30/#34 ikut terpancar", () => {
    // Kalau kelimanya lenyap dari keluaran, fikstur berhenti menagih persis
    // kelas kunci yang melahirkan gerbang ini.
    const semua = new Set(baris.map((b) => b.split("|")[1]));
    for (const k of ["durasi_detik", "masuk_pada", "lewat_target", "target_detik", "bertarget"]) {
      expect(semua.has(k), `${k} tak ada di keluaran pembangkit`).toBe(true);
    }
  });

  it("PASANGAN: penguraiannya bisa dibuktikan pada masukan sintetis", () => {
    // Bentuk `^\s+kunci:` menuntut medan berindentasi SATU PER BARIS — persis
    // gaya types.ts. Masukan sintetisnya ditulis begitu apa adanya; versi
    // pertama uji ini merakitnya lewat `replace` satu-baris dan medan keduanya
    // tak pernah berpindah baris, jadi ujinya menuduh pembangkit yang benar.
    const multi = [
      "export interface Uji {",
      "  a: string;",
      "  b?: number;",
      "}",
      "export type UjiT = {",
      "  c_d: string[];",
      "}",
      "/* komentar: x_di_komentar: string */",
      "const bukanEkspor = {",
      "  z: 1,",
      "};",
    ].join("\n");
    const hasil = kunciKontrak(multi);
    expect(hasil).toContain("Uji|a");
    expect(hasil).toContain("Uji|b");
    expect(hasil).toContain("UjiT|c_d");
    // Komentar dan objek tak diekspor tak boleh ikut.
    expect(hasil.join("\n")).not.toContain("x_di_komentar");
    expect(hasil.join("\n")).not.toContain("|z");
  });

  it("fikstur yang TERSIMPAN di repo mobile masih cocok — bila repo itu ada", () => {
    // Di CI repo ini `kakarut-mobile` tidak di-checkout → lewati, bukan merah.
    // Di mesin yang memuat keduanya (tempat perubahan kontrak ditulis), ini
    // menangkap fikstur basi SEBELUM ter-commit — satu-satunya titik waktu
    // saat kunci baru bisa lolos tanpa keputusan.
    const p = new URL("../../../../kakarut-mobile/test/fikstur/kunci-kontrak-server.txt", import.meta.url);
    let tersimpan: string;
    try {
      tersimpan = readFileSync(fileURLToPath(p), "utf8");
    } catch {
      return;
    }
    expect(
      tersimpan.trim().split("\n"),
      "fikstur di repo mobile basi — jalankan `npm run --silent acuan:kunci-mobile " +
        "-w @kakarut/server > ../kakarut-mobile/test/fikstur/kunci-kontrak-server.txt`",
    ).toEqual(baris);
  });
});
