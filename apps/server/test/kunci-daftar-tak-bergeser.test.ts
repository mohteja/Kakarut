import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jelajah, uraikan, barisDi, type Simpul } from "./util/ast";

/**
 * KUNCI DAFTAR-BERALASAN TIDAK BOLEH BERGESER SAAT BARIS BERGESER.
 *
 * Repo ini penuh daftar adjudikasi tangan — **39 daftar** di
 * `apps/server/test`, dari `DIPILAH_TANGAN` sampai `TERBUKA_SENGAJA`. Tiap
 * entri menukar "gerbang merah" dengan "keputusan yang ditulis", dan itu
 * pertukaran yang sehat. Yang TIDAK sehat: mengunci entri itu pada NOMOR
 * BARIS.
 *
 * Aturannya sudah ditulis, dan sudah DIBAYAR TIGA KALI:
 *
 *   · `pelaku.test.ts:63` — *"versi pertama memakai nomor baris dan langsung
 *     membusuk: menambahkan satu komentar…"*
 *   · `util/urutan.ts:126` — *"Putaran 27 membayar pembusukan kunci bernomor
 *     baris untuk KEDUA kalinya (satu baris `import` menggeser 1228 jadi 1229
 *     dan dua gerbang memerah)."*
 *   · `util/mutasi-web.ts:105` — *"sudah dibayar dua kali… Sekali cukup."*
 *   · `util/kolom-numerik.ts:46` — *"Kuncinya bukan nomor baris."*
 *
 * Empat berkas menuliskan aturannya. **Nol yang menegakkannya** — dan pada
 * 2026-09-01 ia dibayar untuk KEEMPAT kalinya: vena pemotongan menambah
 * komentar di atas dua situs, kedua entri `DIPILAH` di `query-punya-rumah`
 * bergeser 26 dan 10 baris, dan gerbangnya memerah di tengah RILIS tanpa satu
 * pun perilaku berubah.
 *
 * Itulah tanda tangan yang berkas audit ini ada untuk mencari: aturannya sudah
 * dipikirkan, ditulis, bahkan dikomentari panjang — penjaganya dipasang di
 * beberapa pintu, dan pintu lain ke keadaan yang sama dibiarkan terbuka.
 *
 * BATAS YANG DIAKUI:
 * 1. Yang disapu KUNCI HARFIAH saja — kunci yang dirakit saat berjalan
 *    (`` `${berkas}:${baris}` ``) tak terlihat dari sini. Yang menutupnya
 *    premis di bawah: tiap daftar yang kuncinya dirakit tetap wajib memakai
 *    medan `kunci` yang stabil, dan itu keputusan penulisnya.
 * 2. Ia menyapu `apps/server/test`, bukan uji ponsel/web di repo lain.
 * 3. Ia melarang BENTUK `…:<angka>`, bukan menjamin kunci penggantinya bagus.
 *    Kunci yang stabil tapi tak unik adalah cacat lain, dan tiap daftar yang
 *    memakainya wajib memaku keunikannya sendiri (lihat `query-punya-rumah`).
 */
const TEST = fileURLToPath(new URL(".", import.meta.url));

function berkasUji(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) berkasUji(p + "/", keluar);
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

export interface KunciDaftar {
  berkas: string;
  baris: number;
  kunci: string;
  /** `objek` = `{ "k": … }` · `map` = `new Map([["k", …]])` */
  bentuk: "objek" | "map";
}

/**
 * Seluruh KUNCI HARFIAH sebuah daftar-beralasan, dari dua bentuknya.
 *
 * Dua bentuk disapu, bukan satu — dan itu bukan kelengkapan yang dikarang:
 * repo ini memakai KEDUANYA (`Record<string, …>` sebagai objek harfiah, dan
 * `new Map([[k, v]])` sebagai larik pasangan). Menyapu satu saja akan
 * menyatakan `query-punya-rumah` — yang justru membusuk — tak punya kunci
 * sama sekali.
 */
export function kunciDaftar(kode?: Record<string, string>): KunciDaftar[] {
  const keluar: KunciDaftar[] = [];
  const sumber: [string, string][] = kode
    ? Object.entries(kode)
    : berkasUji(TEST).map((p) => [p, readFileSync(p, "utf8")] as [string, string]);
  for (const [p, isi] of sumber) {
    const rel = p.startsWith(TEST) ? p.slice(TEST.length) : p;
    if (rel === "kunci-daftar-tak-bergeser.test.ts") continue;
    let akar;
    try {
      akar = uraikan(p, isi);
    } catch {
      continue;
    }
    const catat = (n: Simpul, kunci: string, bentuk: "objek" | "map") =>
      keluar.push({ berkas: rel, baris: barisDi(isi, n.start), kunci, bentuk });
    jelajah(akar, (n) => {
      // `{ "modules/x.ts:12": … }`
      if (n.type === "Property") {
        const k = n.key as Simpul | undefined;
        if (k?.type === "Literal" && typeof k.value === "string") catat(k, k.value, "objek");
        return;
      }
      // `new Map([["modules/x.ts:12", …], …])` — pasangan sebagai larik.
      if (n.type === "ArrayExpression") {
        const el = (n.elements as (Simpul | null)[])[0];
        if (
          (n.elements as unknown[]).length === 2 &&
          el?.type === "Literal" &&
          typeof el.value === "string"
        ) {
          catat(el, el.value, "map");
        }
      }
    });
  }
  return keluar;
}

/** Kunci yang berakhir dengan nomor baris — bentuk yang dilarang. */
const BERBARIS = /\.(ts|tsx|dart|sh|md):\d+$/;

const semua = kunciDaftar();

describe("kunci daftar-beralasan tak boleh bergeser bersama barisnya", () => {
  it("PREMIS: sapuannya benar-benar menemukan kunci", () => {
    // Nol berarti pemindainya rusak, bukan repo yang bersih — bentuk kegagalan
    // yang sudah menggigit repo ini berkali-kali (regex yang hafal nama lama).
    expect(semua.length).toBeGreaterThanOrEqual(300);
    expect(new Set(semua.map((k) => k.berkas)).size).toBeGreaterThanOrEqual(25);
    // KEDUA bentuk harus terwakili; nol di salah satunya berarti separuh
    // populasi tak terlihat.
    for (const b of ["objek", "map"] as const) {
      expect(semua.filter((k) => k.bentuk === b).length, `bentuk ${b}`).toBeGreaterThanOrEqual(20);
    }
  });

  it("DETEKTOR TERBUKTI: kunci bernomor baris DITUDUH, dua bentuknya", () => {
    const s = kunciDaftar({
      "palsu.test.ts":
        'const A: Record<string, string> = { "modules/x/y.ts:123": "alasan" };\n' +
        'const B = new Map<string, string>([["modules/p/q.ts:7", "alasan"]]);\n' +
        'const C: Record<string, string> = { "modules/x/y.ts": "kunci stabil" };\n',
    });
    const nakal = s.filter((k) => BERBARIS.test(k.kunci));
    expect(nakal.map((k) => k.kunci).sort()).toEqual([
      "modules/p/q.ts:7",
      "modules/x/y.ts:123",
    ]);
    expect(nakal.map((k) => k.bentuk).sort()).toEqual(["map", "objek"]);
    // …dan kunci yang stabil TIDAK ikut tertuduh.
    expect(s.some((k) => k.kunci === "modules/x/y.ts")).toBe(true);
  });

  it("tak ada daftar-beralasan yang berkunci nomor baris", () => {
    const nakal = semua
      .filter((k) => BERBARIS.test(k.kunci))
      .map((k) => `${k.berkas}:${k.baris} → "${k.kunci}"`);
    expect(
      nakal,
      "Kunci daftar-beralasan yang akan BERGESER saat barisnya bergeser:\n" +
        nakal.join("\n") +
        "\n\nNomor baris berpindah karena komentar, impor, atau vena lain — dan " +
        "gerbang yang memerah karena itu mengajari pembacanya mengabaikan " +
        "gerbang. Repo ini sudah membayarnya EMPAT kali. Pakai kunci yang " +
        "menempel pada HAL-nya: `berkas:nama-parameter`, `berkas:fungsi`, " +
        "berkas + JUMLAH situs, atau teks barisnya sendiri.",
    ).toEqual([]);
  });
});
