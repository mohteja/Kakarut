import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * RUTE YANG DIPOTONG SERVER == RUTE YANG PONSEL AKUI — SATU KONTRAK, DUA REPO.
 *
 * Server memotong tiga belas daftar dan mengatakannya (`potongLarik` →
 * header `X-Kakarut-Terpotong`; `rows_terpotong`/`riwayat_terpotong` di
 * badan). Ponsel membacanya lewat SATU rumah
 * (`kakarut-mobile/lib/core/widgets/daftar_dipotong.dart`), dan daftar
 * rutenya dipaku di `test/daftar_dipotong_test.dart` sebagai `ruteTerpotong`.
 *
 * Dua daftar di dua repo adalah cara sebuah aturan berhenti berlaku tanpa ada
 * yang memutuskan: pintu baru yang dipotong server tak akan memerahkan apa pun
 * di sini, dan CI ponsel baru menagihnya sesudah PR-nya ditulis — kelas
 * "kesegaran ≠ keputusan" yang sudah menggigit tiga kali di kunci kontrak.
 * Cermin ini menaruh tagihannya di gerbang SERVER: himpunan rute pengirim di
 * `modules/*\/routes.ts` (diurai, bukan disalin) harus sama dengan daftar
 * Dart, dikurangi pengecualian yang masing-masing BERALASAN — dan alasannya
 * ikut diperiksa (rute yang dikecualikan karena "tak dipanggil ponsel" memang
 * tak boleh dipanggil ponsel).
 *
 * Di CI repo ini `kakarut-mobile` tidak di-checkout → lengan lintas-repo
 * dilewati, bukan merah; lengan server-saja tetap jalan.
 */

const akarServer = new URL("../", import.meta.url);
const akarPonsel = new URL("../../../../kakarut-mobile/", import.meta.url);

/** `dir modul` → mount path, dari import + `.route()` di app.ts. */
function petaMount(): Map<string, string[]> {
  const app = readFileSync(fileURLToPath(new URL("src/app.ts", akarServer)), "utf8");
  const idKeDir = new Map<string, string>();
  for (const m of app.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/modules\/([^/"]+)\/routes"/g)) {
    for (const id of m[1].split(",").map((s) => s.trim()).filter(Boolean)) idKeDir.set(id, m[2]);
  }
  const keluar = new Map<string, string[]>();
  for (const m of app.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
    const dir = idKeDir.get(m[2]);
    if (!dir) continue;
    keluar.set(dir, [...(keluar.get(dir) ?? []), m[1]]);
  }
  return keluar;
}

const PENANDA = /potongLarik\(|\brows_terpotong\s*:|\briwayat_terpotong\s*:/g;

/** Jalur PENUH tiap situs pengirim pemotongan di server, diurai dari sumbernya. */
export function rutePengirimServer(): string[] {
  const mount = petaMount();
  const dirModul = fileURLToPath(new URL("src/modules/", akarServer));
  const keluar = new Set<string>();
  for (const dir of readdirSync(dirModul)) {
    let src: string;
    try {
      src = readFileSync(`${dirModul}${dir}/routes.ts`, "utf8");
    } catch {
      continue;
    }
    // Komentar dibutakan: prosa di kepala berkas menyebut header & kuncinya.
    const buta = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const m of buta.matchAll(PENANDA)) {
      const sebelum = buta.slice(0, m.index);
      // Deklarasi rute = `.get(` di AWAL baris (rantai Hono); `c.get("auth")`
      // di tengah baris bukan rute.
      const deklarasi = [...sebelum.matchAll(/^\s*\.get\(\s*"([^"]+)"/gm)].at(-1);
      if (!deklarasi) throw new Error(`${dir}/routes.ts: penanda pemotongan tanpa .get(" di atasnya`);
      const mounts = mount.get(dir);
      if (!mounts || mounts.length !== 1) {
        throw new Error(`${dir}/routes.ts di-mount ${mounts?.length ?? 0} kali — putuskan jalurnya dengan tangan`);
      }
      const jalur = deklarasi[1] === "/" ? "" : deklarasi[1];
      keluar.add(mounts[0] + jalur);
    }
  }
  return [...keluar].sort();
}

/**
 * Rute pengirim yang SENGAJA tak ada di daftar ponsel — tiap baris beralasan,
 * dan alasannya diperiksa di bawah.
 */
const DIKECUALIKAN: Record<string, string> = {
  "/admin/error-log": "panel super admin platform — ponsel tak punya perannya",
  "/stok/opname": "daftar BARIS opname mentah; ponsel membaca sesi lewat /stok/opname/riwayat + detailnya",
  "/supplier/:id/kartu": "layar kartu supplier belum ada di ponsel (kunci-belum-dibaca.txt)",
};

function bacaPonsel(relatif: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(relatif, akarPonsel)), "utf8");
  } catch {
    return null;
  }
}

/** `ruteTerpotong` di uji Dart — diurai per baris `jalur: '…'`. */
function ruteDart(uji: string): string[] {
  return [...uji.matchAll(/^\s*\(jalur:\s*'([^']+)'/gm)].map((m) => m[1]).sort();
}

describe("rute yang dipotong server == rute yang ponsel akui", () => {
  const server = rutePengirimServer();

  it("PREMIS: pengurai menemukan ≥13 pengirim, termasuk ketiga bentuknya", () => {
    expect(server.length).toBeGreaterThanOrEqual(13);
    expect(server).toContain("/shift");
    expect(server).toContain("/shift/selisih");
    expect(server).toContain("/menu/:id/riwayat-harga");
    expect(server).toContain("/transfer-stok"); // rows_terpotong
    expect(server).toContain("/laporan/durasi-pesanan"); // riwayat_terpotong
    expect(server).toContain("/sampah");
  });

  it("tiap pengecualian masih ada di server (bukan entri basi)", () => {
    for (const r of Object.keys(DIKECUALIKAN)) {
      expect(server, `${r} dikecualikan tapi server tak lagi memotongnya`).toContain(r);
    }
  });

  it("DUA ARAH: himpunan server − pengecualian == daftar Dart — bila repo ponsel ada", () => {
    const uji = bacaPonsel("test/daftar_dipotong_test.dart");
    if (uji == null) return; // repo ponsel tak ter-checkout (CI repo ini) → lewati, bukan merah
    const dart = ruteDart(uji);
    // Ambangnya SENGAJA di bawah jumlah sebenarnya (11): pengurai yang buta
    // memberi 0, sedangkan satu rute yang dicabut harus jatuh ke asersi
    // bernama rute di bawah — bukan ke sini.
    expect(dart.length, "pengurai daftar Dart buta").toBeGreaterThanOrEqual(8);
    const diharapkan = server.filter((r) => !(r in DIKECUALIKAN)).sort();

    const belumDiakui = diharapkan.filter((r) => !dart.includes(r));
    expect(
      belumDiakui,
      "rute yang dipotong server tapi TAK ADA di `ruteTerpotong` ponsel — tambahkan ke " +
        "kakarut-mobile/test/daftar_dipotong_test.dart (dan pemanggilnya lewat bacaBerbatas), " +
        "atau kecualikan DI SINI dengan alasan",
    ).toEqual([]);

    const tanpaSumber = dart.filter((r) => !diharapkan.includes(r));
    expect(
      tanpaSumber,
      "rute di daftar ponsel yang server tak lagi memotong — daftar Dart-nya basi",
    ).toEqual([]);
  });

  it("alasan pengecualian 'tak dipanggil ponsel' benar-benar tak dipanggil — bila repo ponsel ada", () => {
    const dirLib = (() => {
      try {
        return fileURLToPath(new URL("lib/", akarPonsel));
      } catch {
        return null;
      }
    })();
    if (dirLib == null) return;
    let berkas: string[];
    try {
      berkas = jalanRekursif(dirLib);
    } catch {
      return;
    }
    const sumber = berkas.map((b) => readFileSync(b, "utf8").replace(/\/\/[^\n]*/g, "")).join("\n");
    for (const r of ["/stok/opname", "/supplier/:id/kartu"]) {
      const pola = new RegExp(
        "\\.get\\(\\s*'" + r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "\\$\\{?\\w+\\}?") + "'",
      );
      expect(pola.test(sumber), `${r}: ${DIKECUALIKAN[r]} — tapi lib/ ponsel kini memanggilnya; cabut pengecualiannya`).toBe(false);
    }
  });

  it("PASANGAN: pengurai jalur Dart menuduh rute yang dicabut", () => {
    const contoh = "const ruteTerpotong = [\n  (jalur: '/shift', kunci: null),\n  (jalur: '/sampah', kunci: null),\n];";
    expect(ruteDart(contoh)).toEqual(["/sampah", "/shift"]);
    expect(ruteDart(contoh.replace("  (jalur: '/sampah', kunci: null),\n", ""))).toEqual(["/shift"]);
  });
});

function jalanRekursif(dir: string): string[] {
  const keluar: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) keluar.push(...jalanRekursif(`${p}/`));
    else if (e.name.endsWith(".dart")) keluar.push(p);
  }
  return keluar;
}
