import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * LOG GERBANG TAK BOLEH MEMOTONG DIRINYA SENDIRI.
 *
 * `scripts/verify-api.sh` dijalankan gerbang sebagai `> log 2>&1`. Di dalam
 * `$(…)`, `tee /dev/stderr` membuka `/dev/stderr` — yang saat itu adalah
 * berkas log itu sendiri — dengan O_TRUNC: seluruh log SEBELUM lengan itu
 * terhapus, dan penulisan berikutnya mendarat di offset lama sebagai berkas
 * jarang penuh NUL. Terjadi di gerbang #95 (2026-09-05): 231.667 NUL dari
 * 231.786 byte, dua baris tersisa — verdik 3.567/0 tetap sah (penghitungnya di
 * memori), tapi bukti tertulisnya lenyap, dan `grep "§296"` memulangkan 1
 * dari 11. Pola itu lahir di §295 (#93) dan disalin §296.
 *
 * `tee -a` pun bukan jawabannya: ia tak memotong, tapi baris diagnostiknya
 * TERTIMPA tulisan stdout berikutnya — offset fd induk tak maju pada O_APPEND
 * (ketahuan saat uji ini pertama ditulis dengan `-a`). Yang benar: menulis ke
 * fd 2 yang DIWARISI dari dalam `$(…)` (`>&2`) — helper `bocorkan`.
 *
 * Yang dijaga: (1) tak ada `tee … /dev/stderr` sama sekali di skrip; (2)
 * PASANGAN yang MENJALANKAN bash — tanpa `-a` memotong jadi NUL, `-a`
 * menimpa, `bocorkan` utuh dan berurutan — supaya asersi teksnya terikat ke
 * mekanisme, bukan ke ejaan.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SKRIP = readFileSync(AKAR + "scripts/verify-api.sh", "utf8");

/** Baris yang membuka ulang `/dev/stderr` lewat `tee` (dengan atau tanpa -a), di luar komentar. */
export function situsTeeStderr(src: string): number[] {
  const keluar: number[] = [];
  src.split("\n").forEach((l, i) => {
    if (/\btee\s+(-a\s+)?\/dev\/stderr\b/.test(l) && !/^\s*#/.test(l)) keluar.push(i + 1);
  });
  return keluar;
}

const BOCORKAN = `bocorkan() { local d; d=$(cat); [ -n "$d" ] && printf '%s\\n' "$d" >&2; printf '%s\\n' "$d" | grep -c . || true; }`;

function jalankanBash(perintah: string): string {
  const dir = mkdtempSync(join(tmpdir(), "log-utuh-"));
  const log = join(dir, "keluaran.log");
  execFileSync("bash", ["-c", `(${perintah}) > "${log}" 2>&1`]);
  return readFileSync(log, "latin1");
}

describe("verify-api.sh — log gerbang utuh (tee -a /dev/stderr)", () => {
  it("PREMIS: skrip terbaca, helper `bocorkan` ada dan dipakai (≥ 3 situs)", () => {
    expect(SKRIP.length).toBeGreaterThan(100_000);
    expect(SKRIP).toContain(BOCORKAN);
    expect((SKRIP.match(/\| bocorkan\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("INTI: tak ada `tee /dev/stderr` maupun `tee -a /dev/stderr`", () => {
    expect(situsTeeStderr(SKRIP), "baris yang membuka ulang log gerbang saat `> log 2>&1`").toEqual([]);
  });

  it("PASANGAN: mekanismenya nyata — tanpa -a jadi NUL, -a menimpa, bocorkan utuh & berurutan", () => {
    const badan = (saluran: string) =>
      `${BOCORKAN}; for i in $(seq 1 200); do echo "baris $i"; done; X=$(echo selisih | ${saluran}); echo "sesudah X=$X"`;
    const rusak = jalankanBash(badan("tee /dev/stderr | grep -c ."));
    expect(rusak.includes("\0"), "tanpa -a: berkas jarang penuh NUL").toBe(true);
    expect(rusak.split("\n").filter((l) => l.startsWith("baris ")).length).toBeLessThan(200);
    const tertimpa = jalankanBash(badan("tee -a /dev/stderr | grep -c ."));
    expect(tertimpa.includes("\0")).toBe(false);
    expect(tertimpa.split("\n").filter((l) => l.startsWith("baris ")).length).toBe(200);
    expect(tertimpa, "-a: baris diagnostik tertimpa stdout berikutnya").not.toContain("selisih\nsesudah X=1");
    const utuh = jalankanBash(badan("bocorkan"));
    expect(utuh.includes("\0")).toBe(false);
    expect(utuh.split("\n").filter((l) => l.startsWith("baris ")).length).toBe(200);
    expect(utuh).toContain("baris 200\nselisih\nsesudah X=1\n");
    // …dan pemindai teksnya menuduh kedua bentuk tee, bukan komentarnya
    expect(situsTeeStderr("a\n  x | tee /dev/stderr | y\n# tee /dev/stderr\n z | tee -a /dev/stderr\n q | bocorkan\n")).toEqual([2, 4]);
  });
});

/**
 * …DAN PEMBANTUNYA HARUS SUDAH ADA SAAT DIPANGGIL.
 *
 * Bash mengikat nama fungsi saat DIJALANKAN, bukan saat dibaca. Sebuah
 * pembantu yang dinyatakan di baris 17.470 karena itu tak ada bagi baris
 * 15.450 — dan `verify-api.sh` satu skrip lurus sepanjang 17.000-an baris yang
 * seksinya sering menumpang pembantu seksi lain.
 *
 * Dua kali dalam satu putaran, dan KEDUANYA gagal dengan menyamar:
 *
 *   · `medan296`/`selisih296` lahir di §296; §273 di atasnya memanggilnya.
 *     Pemindahannya ke kepala berkas ikut mengangkat penugasan
 *     `R296M=$(api "$OWNER" …)` — yang DIJALANKAN saat itu juga, sebelum
 *     `$OWNER` ada. Dengan `set -u` skrip mati di baris 159: verifikasi
 *     BERHENTI ADA, sambil tetap memulangkan berkas log.
 *   · `bocorkan` lahir di §295; `selisih296` menyalurkan ke dalamnya, jadi
 *     §273 menjangkaunya 2.000 baris sebelum ia ada. Pipa ke fungsi yang belum
 *     ada memulangkan teks kosong, `float("")` melempar, dan `cek` melaporkan
 *     "nilai: , harusnya: V == 0" — terbaca seperti selisih kunci, padahal
 *     soal urutan.
 *
 * Yang dijaga: dari tiap pemanggilan DI TINGKAT ATAS, SELURUH pembantu yang
 * terjangkau — langsung maupun lewat badan pembantu lain — sudah dinyatakan
 * lebih dulu. Versi pertama uji ini mengecualikan pemanggilan di dalam badan
 * fungsi ("baru terikat saat dipanggil") dan karena itu DIAM pada kasus
 * `bocorkan`, yang justru kasus yang melahirkannya. Penutupan transitif inilah
 * yang membuatnya menuduh keduanya.
 */
type Fungsi = { nama: string; baris: number };

/**
 * Pemanggilan di POSISI PERINTAH. Dua syarat yang dibayar mahal: tanpa jangkar
 * kiri, `E200D="siang200.$RANDOM@…"` — sepotong alamat surel — tertuduh
 * sebagai pemanggilan; tanpa `;` di jangkar kanan, `… | bocorkan; }` tak
 * terbaca sebagai pemanggilan sama sekali, dan penjaganya diam pada kasus yang
 * ia lahir untuk menangkap.
 */
const polaPanggil = (n: string) =>
  new RegExp(`(?:^|[|&;(]|\\$\\()\\s*${n}(?=[\\s);|&]|$)`, "m");

/**
 * Bedah skrip jadi tiga: definisi (nama → baris), isi badan tiap fungsi, dan
 * baris yang benar-benar DIJALANKAN di tingkat atas.
 *
 * Penutup badan diuji dengan "baris ini berakhir `}`", bukan dengan mencacah
 * kurung: `medan296` satu baris tapi program awk di dalamnya memuat `BEGIN{…}`,
 * `{exit}`, dan `/^\\}/` — cacahannya timpang, dan versi pertama uji ini
 * menelan 2.000 baris berikutnya sebagai "badan medan296".
 */
export function bedahSkrip(src: string) {
  const def = new Map<string, number>();
  const badan = new Map<string, string[]>();
  const atas: { no: number; isi: string }[] = [];
  let dalam: string | null = null;
  src.split("\n").forEach((l, i) => {
    const d = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(l);
    if (d && dalam === null) {
      if (!def.has(d[1])) def.set(d[1], i + 1);
      badan.set(d[1], [...(badan.get(d[1]) ?? []), l]);
      if (!l.trimEnd().endsWith("}")) dalam = d[1];
      return;
    }
    if (dalam !== null) {
      if (l === "}") dalam = null;
      else badan.set(dalam, [...(badan.get(dalam) ?? []), l]);
      return;
    }
    if (l.trimStart().startsWith("#")) return;
    atas.push({ no: i + 1, isi: l });
  });
  return { def, badan, atas };
}

export function panggilanTerlaluDini(src: string): string[] {
  const { def, badan, atas } = bedahSkrip(src);
  const nama = [...def.keys()];
  const dipanggil = (teks: string, kecuali?: string) =>
    nama.filter((n) => n !== kecuali && polaPanggil(n).test(teks));
  const anak = new Map<string, string[]>();
  for (const [n, b] of badan) anak.set(n, dipanggil(b.join("\n"), n));
  const jangkau = (n: string, sudah = new Set<string>()): Set<string> => {
    for (const c of anak.get(n) ?? []) if (!sudah.has(c)) { sudah.add(c); jangkau(c, sudah); }
    return sudah;
  };
  const keluar = new Set<string>();
  for (const b of atas) {
    for (const n of dipanggil(b.isi)) {
      for (const g of [n, ...jangkau(n)]) {
        const dl = def.get(g)!;
        if (dl > b.no) {
          keluar.add(
            g === n
              ? `${g} dipanggil di baris ${b.no}, baru dinyatakan di ${dl}`
              : `${g} terjangkau dari ${n} di baris ${b.no}, baru dinyatakan di ${dl}`,
          );
        }
      }
    }
  }
  return [...keluar].sort();
}

describe("verify-api.sh — pembantu dinyatakan sebelum terjangkau", () => {
  it("PREMIS: pemindainya melihat skripnya — ratusan fungsi, ribuan baris tingkat atas", () => {
    // Pemindai yang berhenti menemukan apa pun lulus tanpa memeriksa apa pun.
    const { def, atas, badan } = bedahSkrip(SKRIP);
    expect(def.size, "definisi fungsi terbaca").toBeGreaterThan(100);
    expect(atas.length, "baris tingkat atas terbaca").toBeGreaterThan(5000);
    for (const n of ["bocorkan", "medan296", "selisih296", "cek", "api"]) {
      expect(def.has(n), `pembantu ${n} tak terbaca`).toBe(true);
    }
    // …dan badannya tak menelan berkasnya: `medan296` satu baris, bukan 2.000.
    expect(badan.get("medan296")!.length, "badan medan296 menelan baris di bawahnya").toBe(1);
  });

  it("INTI: tak ada pembantu yang terjangkau sebelum dinyatakan", () => {
    expect(
      panggilanTerlaluDini(SKRIP),
      "pembantu terjangkau dari tingkat atas sebelum definisinya — bash mengikat saat " +
        "DIJALANKAN, jadi ini bukan gaya melainkan pemanggilan yang gagal diam-diam. " +
        "Pindahkan definisinya ke kepala berkas, dan HANYA definisinya: penugasan yang " +
        "menembak API harus tinggal di seksinya.",
    ).toEqual([]);
  });

  it("PASANGAN: menuduh kedua bentuk yang sungguh terjadi, dan tak menuduh yang sah", () => {
    // (a) LANGSUNG — bentuk `medan296` sebelum dipindah.
    const langsung = ['K=$(medan296 CompanyRow)', "", "medan296() { echo x; }"].join("\n");
    expect(panggilanTerlaluDini(langsung)).toEqual([
      "medan296 dipanggil di baris 1, baru dinyatakan di 3",
    ]);
    // (b) TRANSITIF — bentuk `bocorkan` sebelum dipindah: yang dipanggil di
    //     tingkat atas sudah ada, yang dipakai BADANNYA belum. Inilah kasus
    //     yang versi pertama penjaga ini lewatkan.
    const transitif = [
      "selisih() { comm -3 a b | bocorkan; }",
      'cek "x" "V == 0" "$(selisih A B)"',
      "bocorkan() { cat; }",
    ].join("\n");
    expect(panggilanTerlaluDini(transitif)).toEqual([
      "bocorkan terjangkau dari selisih di baris 2, baru dinyatakan di 3",
    ]);
    // (c) Urutan yang benar tak dituduh…
    const benar = ["bocorkan() { cat; }", "selisih() { comm -3 a b | bocorkan; }", '"$(selisih A B)"'].join("\n");
    expect(panggilanTerlaluDini(benar)).toEqual([]);
    // (d) …dan sepotong teks yang kebetulan memuat namanya bukan pemanggilan.
    const surel = ['E="siang200.$RANDOM@basooopa.id"', "", "siang200() { echo x; }"].join("\n");
    expect(panggilanTerlaluDini(surel)).toEqual([]);
  });
});
