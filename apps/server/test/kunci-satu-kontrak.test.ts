import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

  it("KELAS: kunci yang ponsel tak sentuh sudah DIPUTUSKAN di repo mobile — bila repo itu ada", () => {
    // Kesegaran fikstur BUKAN keputusan. Uji di atas hijau begitu fiksturnya
    // diregenerasi; yang menagih keputusannya `kunci_kontrak_server_test.dart`
    // — di repo SEBELAH, yang hanya jalan di CI-nya sendiri. Celah waktunya
    // sempit dan mahal: kunci baru lolos di sini, ter-commit, ter-push, lalu
    // memerahkan CI ponsel sesudah PR-nya ditulis. Sudah terjadi TIGA kali
    // (CI ponsel #32, #33, #38 — yang terakhir `biaya_lama`/`biaya_baru` dari
    // pintu riwayat resep). Cerminnya ditaruh di sini supaya jatuhnya di
    // gerbang yang memang dijalankan saat kontraknya diubah.
    const akar = new URL("../../../../kakarut-mobile/", import.meta.url);
    let belumDibaca: string;
    try {
      belumDibaca = readFileSync(fileURLToPath(new URL("test/fikstur/kunci-belum-dibaca.txt", akar)), "utf8");
    } catch {
      return; // repo ponsel tak ter-checkout (CI repo ini) → lewati, bukan merah
    }
    const tercatat = new Set(
      belumDibaca
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#")),
    );

    // Sapuan lib/ ponsel, disalin PERSIS dari uji cermin di sana: tiap literal
    // 'kunci', baca maupun tulis. Bentuk yang berbeda akan menuduh beda.
    const disentuh = new Set<string>();
    const dart = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const jalur = `${dir}/${n}`;
        if (statSync(jalur).isDirectory()) return dart(jalur);
        return jalur.endsWith(".dart") ? [jalur] : [];
      });
    const berkas = dart(fileURLToPath(new URL("lib", akar)));
    for (const f of berkas) {
      for (const m of readFileSync(f, "utf8").matchAll(/'([a-z][a-z0-9_]*)'/g)) disentuh.add(m[1]!);
    }

    // Premis: sapuan yang memulangkan sedikit tak menuduh siapa pun — ia hanya
    // berhenti bisa menuduh, dan asersi di bawahnya lolos secara hampa.
    expect(berkas.length, "lib/ ponsel terbaca terlalu tipis").toBeGreaterThan(100);
    expect(disentuh.size, "sapuan lib ponsel rusak — regexnya atau jalurnya").toBeGreaterThan(500);
    expect(disentuh.has("nama"), "kunci paling umum pun tak terbaca").toBe(true);

    const kunci = new Set(baris.map((b) => b.split("|")[1]!));
    const tanpaKeputusan = [...kunci].filter((k) => !disentuh.has(k) && !tercatat.has(k)).sort();
    expect(
      tanpaKeputusan,
      "kunci kontrak BARU yang ponsel tak sentuh dan tak diputuskan. Urai kuncinya di " +
        "fromJson yang memakainya, atau catat di kakarut-mobile/test/fikstur/kunci-belum-dibaca.txt " +
        "dalam kelompok BERALASAN:\n" +
        tanpaKeputusan.join("\n"),
    ).toEqual([]);
  });
});
