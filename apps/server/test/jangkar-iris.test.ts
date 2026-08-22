import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga JANGKAR IRISAN — uji yang menjaga uji-uji lain.
 *
 * Banyak penjaga di suite ini tidak memeriksa seluruh berkas, melainkan satu
 * POTONGAN saja, supaya klaimnya tepat ("di dalam fungsi X, tidak ada Y").
 * Potongan itu dicari dengan `indexOf` sebuah teks jangkar:
 *
 *     const i = SETELAN.indexOf("export function savePrinterSettings");
 *     expect(SETELAN.slice(i, i + 200)).not.toContain("rapikanAngka");
 *
 * Selama jangkarnya ada, ini penjaga yang bagus. Masalahnya muncul saat
 * jangkarnya HILANG — fungsinya diganti nama, blok kodenya ditulis ulang,
 * penanda komentarnya dirapikan. `indexOf` memulangkan -1, dan `slice(-1, 199)`
 * bukan galat melainkan STRING KOSONG. Setiap `not.toContain` di atas potongan
 * kosong lulus. Setiap `toContain` di atas potongan yang terlalu lebar juga
 * bisa lulus. Penjaganya tetap hijau, laporannya tetap "lulus", dan bug yang
 * dulu ia tangkap boleh pulang tanpa ada yang berkedip.
 *
 * Itu bukan kekhawatiran teoretis: seluruh nilai suite ini bertumpu pada
 * anggapan bahwa hijau berarti sesuatu benar-benar diperiksa. Penjaga yang
 * hijau karena alasan salah lebih buruk daripada tidak ada penjaga — ia
 * membuat orang berhenti memeriksa.
 *
 * MAKA aturannya: tiap teks jangkar yang dipakai `indexOf` di berkas uji WAJIB
 * benar-benar ada di salah satu berkas sumber yang uji itu baca. Kalau ada yang
 * mengganti nama fungsi, uji INI yang berteriak — bukan penjaganya yang diam.
 *
 * YANG TIDAK DIJANJIKAN uji ini, supaya tak dikira lebih: ia memeriksa jangkar
 * ADA, bukan bahwa irisannya membatasi blok yang dimaksud. Jangkar yang ada
 * tapi salah tempat tetap lolos. Yang dicegah adalah kelas kegagalan yang
 * SENYAP — jangkar hilang → penjaga jadi hampa — dan itulah yang realistis
 * terjadi saat orang merapikan kode tanpa membuka berkas ujinya.
 */
const DIR_UJI = fileURLToPath(new URL("./", import.meta.url));
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const BERKAS_INI = "jangkar-iris.test.ts";

/**
 * Akhiran berkas yang mungkin dibaca sebagai teks oleh sebuah uji.
 *
 * `.yml`/`.yaml` masuk sejak ada penjaga yang membaca `.github/workflows/ci.yml`
 * (lihat `ci-menjalankan-semua-suite.test.ts`). Tanpa keduanya, jangkar yang
 * menunjuk ke langkah workflow tak bisa diverifikasi — persis kelas kegagalan
 * senyap yang berkas ini ada untuk mencegahnya.
 */
const EKSTENSI = [".ts", ".tsx", ".md", ".sh", ".html", ".json", ".css", ".yml", ".yaml"];

function semuaBerkas(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist" || nama === ".git") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaBerkas(p + "/"));
    else if (EKSTENSI.some((e) => nama.endsWith(e))) hasil.push(p);
  }
  return hasil;
}

const SEMUA_SUMBER = [
  "apps/server/src/",
  "apps/web/src/",
  "packages/shared/src/",
  "scripts/",
  "docs/",
  // Berkas workflow ikut jadi "sumber" sejak ada penjaga yang mengiris ci.yml.
  ".github/workflows/",
]
  .flatMap((r) => semuaBerkas(AKAR + r))
  .filter((p) => !p.includes("/test/"));

/** Buka escape string JS supaya `\"` dan `\n` dibandingkan apa adanya. */
function lepasEscape(s: string): string {
  const keluar: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      keluar.push({ n: "\n", t: "\t", r: "\r" }[s[i + 1]] ?? s[i + 1]);
      i++;
    } else keluar.push(s[i]);
  }
  return keluar.join("");
}

/**
 * Berkas sumber yang dibaca sebuah uji.
 *
 * Sengaja LONGGAR: tiap literal berbentuk jalur diambil, apa pun cara uji itu
 * merangkainya (`new URL(rel)`, `SRV + "modul/routes.ts"`, penolong `baca(p)`,
 * template `WEB(`...`)`). Kelonggaran itu aman searah — berkas berlebih hanya
 * membuat pemeriksaan lebih permisif, tak pernah membuatnya salah menuduh.
 *
 * Literal berakhiran `/` ikut dibaca sebagai DIREKTORI, karena beberapa uji
 * memang menyapu satu pohon utuh dengan `readdirSync` alih-alih menyebut
 * berkasnya satu per satu.
 */
function sumberYangDibaca(isiUji: string): string[] {
  const ketemu = new Set<string>();
  for (const m of isiUji.matchAll(/[`"']([^`"'\n]*?\/)[`"']/g)) {
    const bersih = m[1].replace(/^(?:\.\.?\/)+/, "");
    if (!bersih) continue;
    const isiDir = SEMUA_SUMBER.filter((s) => s.includes("/" + bersih));
    if (isiDir.length > 0) for (const p of isiDir) ketemu.add(p);
  }
  for (const m of isiUji.matchAll(/[`"']([^`"'\n]*?\.(?:tsx?|md|sh|html|json|css|ya?ml))[`"']/g)) {
    const frag = m[1];
    const langsung = DIR_UJI + frag.replace(/^\.\//, "");
    const rapi = langsung.includes("..") ? null : langsung;
    if (rapi && !rapi.endsWith(".test.ts") && SEMUA_SUMBER.includes(rapi)) {
      ketemu.add(rapi);
      continue;
    }
    /*
     * Hanya awalan RELATIF (`./`, `../`) yang dibuang — bukan tiap titik di
     * depan. `replace(/^[./]+/, "")` ikut memakan titik milik `.github`, jadi
     * `../../../.github/workflows/ci.yml` jadi `github/workflows/ci.yml` dan
     * tak cocok dengan berkas mana pun. Akibatnya jangkar yang menunjuk ke
     * langkah workflow tak bisa ditelusuri sama sekali — padahal `.yml`
     * dimasukkan ke `EKSTENSI` justru supaya bisa.
     */
    const bersih = frag.replace(/^(?:\.\.?\/)+/, "");
    const cocok = SEMUA_SUMBER.filter((s) => s.endsWith("/" + bersih));
    if (cocok.length === 1) ketemu.add(cocok[0]);
  }
  return [...ketemu];
}

const BERKAS_UJI = readdirSync(DIR_UJI)
  .filter((f) => f.endsWith(".test.ts") && f !== BERKAS_INI)
  .sort();

type Jangkar = { uji: string; teks: string; sumber: string[] };
const jangkar: Jangkar[] = [];
const tanpaSumber: string[] = [];

for (const uji of BERKAS_UJI) {
  const isi = readFileSync(DIR_UJI + uji, "utf8");
  const teks = [...isi.matchAll(/\.indexOf\(\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => lepasEscape(m[1]))
    .filter((t) => t.length > 0);
  if (teks.length === 0) continue;
  const sumber = sumberYangDibaca(isi);
  if (sumber.length === 0) {
    tanpaSumber.push(uji);
    continue;
  }
  for (const t of new Set(teks)) jangkar.push({ uji, teks: t, sumber });
}

describe("penyapunya sendiri tidak boleh jadi hampa", () => {
  it("menemukan jangkar di banyak berkas uji", () => {
    // Kalau gaya penulisan uji berubah dan regex ini berhenti cocok, sapuan di
    // bawah diam-diam memeriksa nol hal — persis cacat yang sedang dijaga,
    // cuma pindah satu lapis ke atas.
    expect(jangkar.length, "tak satu pun jangkar terbaca").toBeGreaterThan(100);
    expect(new Set(jangkar.map((j) => j.uji)).size).toBeGreaterThan(20);
  });

  it("tiap uji berjangkar punya sumber yang bisa ditelusuri", () => {
    // Melewati uji yang sumbernya tak terpetakan sama saja dengan menyapunya
    // ke bawah karpet: hijaunya lalu berarti "tidak diperiksa", bukan "aman".
    expect(
      tanpaSumber,
      `uji ini memakai indexOf tapi tak satu berkas sumbernya terpetakan — ` +
        "perbaiki `sumberYangDibaca`, jangan biarkan lewat diam-diam",
    ).toEqual([]);
  });
});

describe("tiap jangkar irisan masih benar-benar ada di sumbernya", () => {
  for (const j of jangkar) {
    it(`${j.uji}: ${JSON.stringify(j.teks.slice(0, 60))}`, () => {
      const isi = j.sumber.map((p) => readFileSync(p, "utf8")).join("\n");
      expect(
        isi.includes(j.teks),
        `jangkar ini sudah tidak ada di sumber mana pun yang dibaca ${j.uji}. ` +
          "`indexOf` memulangkan -1, jadi irisan yang bergantung padanya kosong " +
          "atau melenceng, dan asersi di atasnya lulus tanpa memeriksa apa pun. " +
          "Perbarui jangkarnya ke nama/teks yang baru — jangan hapus asersinya.",
      ).toBe(true);
    });
  }
});
