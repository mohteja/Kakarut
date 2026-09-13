import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * JALAN GERBANG HARUS SAMPAI KE UJUNGNYA — DAN VERDIKNYA TAK BOLEH DITENTUKAN
 * SISA KEADAAN JALAN SEBELUMNYA.
 *
 * Tiga cacat sekelas, semuanya terukur pada 2026-09-12, semuanya berakar di
 * `set -euo pipefail` yang bekerja terlalu baik:
 *
 * 1. **Satu pengukuran meleset membunuh SELURUH jalan.** `ASET111=$(curl … |
 *    grep -o '/assets/…' | head -1)` adalah PERNYATAAN, bukan kondisi: pada
 *    server tanpa `apps/web/dist`, `grep` tak menemukan apa pun → 1 →
 *    `pipefail` meneruskannya → `set -e` keluar. Jalannya berhenti di §111 dan
 *    ~200 seksi sesudahnya TAK PERNAH MENEMBAK. Yang membaca gerbang melihat
 *    exit=1 lalu `grep '✘'` memulangkan NOL BARIS — "gagal tanpa satu pun
 *    kegagalan". Penanda `TUNTAS` + jebakan EXIT yang membedakan keduanya.
 *
 * 2. **Lengan yang ditulis untuk menangkap pemindai mati, dimatikan lebih dulu
 *    oleh shell-nya.** `R309=$(npx tsx …)` lalu `KELUAR309=$?`: bila tsx-nya
 *    gagal, `set -e` keluar DI BARIS PERTAMA, jadi `KELUAR309=$?` tak pernah
 *    dieksekusi dan lengan "…keluarannya sepakat dengan kode keluar skripnya"
 *    hanya pernah bisa melihat 0. Terukur dari bash sungguhan: bentuk lama tak
 *    mencetak apa pun sesudahnya; bentuk `if …; then …; else …` memulangkan 3.
 *
 * 3. **Verdik yang bergantung pada sisa `dist`.** Empat lengan (§61 ×3, §111,
 *    §114 ×2, §139) hijau atau merah tanpa satu byte kode pun berubah,
 *    tergantung apakah `apps/web/dist` kebetulan tersisa dari jalan sebelumnya
 *    — dan satu di antaranya justru HIJAU PALSU, membandingkan dua nilai yang
 *    sama-sama kosong. Sekarang ada satu prasyarat (`ADA_DIST`, dibaca dari
 *    jawaban server sendiri di `/api/health`), dan tiap blok yang
 *    mengonsultasinya WAJIB menembak jumlah lengan yang sama di kedua cabang —
 *    supaya "dilewati" tak pernah berarti "cacahnya menyusut diam-diam".
 *
 * Ketiganya dijaga dari TEKS skripnya, dan tiap penjaga dibuktikan bisa
 * menuduh; mekanismenya sendiri dibuktikan dengan menjalankan bash sungguhan,
 * seidiom `verify-api-log-utuh.test.ts`.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SKRIP = readFileSync(AKAR + "scripts/verify-api.sh", "utf8");

const KOMENTAR = /^\s*#/;
/** Perintah yang memulangkan ≠0 pada "tak ketemu" — bukan pada galat. */
const RAWAN = [
  /\bgrep\b(?![^|]*-c\b)/,
  /\bcurl\s+(-[a-zA-Z]*f[a-zA-Z]*\s|--fail\b)/,
  /\bjq\s+-[a-zA-Z]*e\b/,
];
const JARING = /\|\|\s*(true|echo|:)/;
const PENUGASAN = /^\s*(?:local\s+|export\s+)?[A-Za-z_][A-Za-z0-9_]*=\$\(/;

/**
 * Penugasan `VAR=$(…)` sebagai PERNYATAAN yang, bila pengukurannya meleset,
 * membunuh seluruh jalannya alih-alih memerahkan satu lengan.
 */
export function situsRawanAbort(src: string): number[] {
  const keluar: number[] = [];
  src.split("\n").forEach((l, i) => {
    if (KOMENTAR.test(l) || !PENUGASAN.test(l)) return;
    if (RAWAN.some((p) => p.test(l)) && !JARING.test(l)) keluar.push(i + 1);
  });
  return keluar;
}

/**
 * `KELUAR…=$?` yang didahului penugasan TELANJANG: di bawah `set -e` baris itu
 * mati, dan lengan yang memakainya hanya pernah bisa melihat 0.
 */
export function kodeKeluarTakTerbaca(src: string): number[] {
  const baris = src.split("\n");
  const keluar: number[] = [];
  baris.forEach((l, i) => {
    if (!/^\s*[A-Za-z_][A-Za-z0-9_]*=\$\?\s*$/.test(l)) return;
    let j = i - 1;
    while (j >= 0 && (KOMENTAR.test(baris[j]) || baris[j].trim() === "")) j -= 1;
    if (j >= 0 && PENUGASAN.test(baris[j])) keluar.push(i + 1);
  });
  return keluar;
}

/** Satu blok `if … ADA_DIST …` beserta cacah lengan di kedua cabangnya. */
export interface BlokDist {
  baris: number;
  lenganThen: number;
  lenganElse: number;
}

/**
 * Tiap cabang dihitung LENGANNYA (`cek` / `ok`), bukan barisnya: cabang
 * "dilewati" yang lupa satu `ok` membuat cacah asersi menyusut diam-diam, dan
 * cacah yang menyusut adalah cara paling halus sebuah gerbang berhenti menjaga.
 */
export function blokDist(src: string): BlokDist[] {
  const baris = src.split("\n");
  const keluar: BlokDist[] = [];
  const lengan = (l: string) => (KOMENTAR.test(l) ? 0 : (l.match(/(^|\s|\$\()(cek|ok)\s+"/g) ?? []).length);
  baris.forEach((l, i) => {
    if (KOMENTAR.test(l) || !/^\s*if\b.*\bADA_DIST\b/.test(l)) return;
    // `if … ; then … ; else … ; fi` satu baris bukan blok bercabang lengan —
    // itu bentuk yang dipakai penugasan ADA_DIST sendiri. Tanpa saringan ini,
    // pemindainya tak pernah menemukan `fi` tersendiri dan menelan sisa berkas.
    if (/\bfi\s*$/.test(l)) return;
    let dalam = 1;
    let diElse = false;
    let then = 0;
    let els = 0;
    for (let j = i + 1; j < baris.length; j += 1) {
      const b = baris[j];
      if (/^\s*if\b/.test(b) && !KOMENTAR.test(b)) dalam += 1;
      else if (/^\s*fi\s*$/.test(b)) {
        dalam -= 1;
        if (dalam === 0) break;
      } else if (dalam === 1 && /^\s*else\s*$/.test(b)) {
        diElse = true;
        continue;
      }
      if (diElse) els += lengan(b);
      else then += lengan(b);
    }
    keluar.push({ baris: i + 1, lenganThen: then, lenganElse: els });
  });
  return keluar;
}

function jalankanBash(perintah: string): { keluaran: string; kode: number } {
  try {
    return { keluaran: execFileSync("bash", ["-c", perintah], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), kode: 0 };
  } catch (e) {
    const g = e as { stdout?: string; stderr?: string; status?: number };
    return { keluaran: (g.stdout ?? "") + (g.stderr ?? ""), kode: g.status ?? -1 };
  }
}

describe("verify-api.sh — jalannya tuntas, dan verdiknya tak menumpang sisa keadaan", () => {
  it("PREMIS: skrip terbaca, `set -euo pipefail`, dan penanda tuntas terpasang di jebakan EXIT", () => {
    expect(SKRIP.length).toBeGreaterThan(100_000);
    expect(SKRIP).toContain("set -euo pipefail");
    expect(SKRIP).toContain("TUNTAS=0");
    // Jebakannya harus MEMBACA penanda itu — bukan sekadar ada.
    const jebakan = SKRIP.split("\n").filter((l) => /^trap .*EXIT\s*$/.test(l));
    expect(jebakan).toHaveLength(1);
    expect(jebakan[0]).toContain("$TUNTAS");
    expect(jebakan[0]).toContain("JALAN TERPOTONG");
    // …dan penandanya dinyalakan TEPAT sebelum baris verdik, sekali saja.
    expect((SKRIP.match(/^TUNTAS=1$/gm) ?? [])).toHaveLength(1);
    expect(SKRIP).toContain('TUNTAS=1\necho "=== Hasil: $PASS lolos, $FAIL gagal ==="');
  });

  it("INTI: tak ada pengukuran yang membunuh seluruh jalan saat meleset", () => {
    expect(situsRawanAbort(SKRIP), "baris `VAR=$(… grep/curl -sf/jq -e …)` tanpa jaring").toEqual([]);
  });

  it("INTI: tiap `KELUAR…=$?` benar-benar terbaca (bukan baris mati di bawah set -e)", () => {
    expect(kodeKeluarTakTerbaca(SKRIP), "penugasan telanjang di atas penangkap kode keluar").toEqual([]);
  });

  it("INTI: prasyarat dist tunggal, dibaca dari jawaban server, dan cacah lengannya tak menyusut", () => {
    // Satu sumber kebenaran, dan sumbernya server — bukan HTML yang dikikis.
    const asal = SKRIP.split("\n").filter((l) => /^ADA_DIST=|ADA_DIST=1; else ADA_DIST=0/.test(l));
    expect(asal).toHaveLength(1);
    expect(SKRIP).toContain(`BUILD_ID=$(curl -s "$BASE/api/health" | jq -r '.build // empty')`);

    const blok = blokDist(SKRIP);
    expect(blok.length, "blok yang mengonsultasi ADA_DIST").toBeGreaterThanOrEqual(4);
    expect(
      blok.filter((b) => b.lenganThen !== b.lenganElse),
      "cabang yang menembak lengan LEBIH SEDIKIT — cacah asersi berubah tergantung ada-tidaknya dist",
    ).toEqual([]);
  });

  it("PASANGAN: mekanismenya nyata — bentuk lama mati diam-diam, bentuk baru menuduh", () => {
    // (1) penugasan telanjang: `K=$?` tak pernah jalan
    const lama = jalankanBash(`set -euo pipefail; R=$(bash -c 'exit 3'); K=$?; echo "SAMPAI K=$K"`);
    expect(lama.keluaran).not.toContain("SAMPAI K=");
    expect(lama.kode).toBe(3);
    // (2) bentuk `if`: kode keluarnya tertangkap, dan lengan premisnya bisa merah
    const baru = jalankanBash(
      `set -euo pipefail; if R=$(bash -c 'exit 3'); then K=0; else K=$?; fi; echo "SAMPAI K=$K"; ` +
        `G=$(echo "$R" | grep '^RINGKAS ' | head -1 || true); echo "PREMIS=[$G]"`,
    );
    expect(baru.keluaran).toContain("SAMPAI K=3");
    expect(baru.keluaran).toContain("PREMIS=[]");
    expect(baru.kode).toBe(0);
    // (3) grep tanpa jaring memotong jalannya; dengan jaring tidak
    const potong = jalankanBash(`set -euo pipefail; X=$(echo ada | grep -o 'tak-ada' | head -1); echo LANJUT`);
    expect(potong.keluaran).not.toContain("LANJUT");
    const utuh = jalankanBash(`set -euo pipefail; X=$(echo ada | grep -o 'tak-ada' | head -1 || true); echo LANJUT`);
    expect(utuh.keluaran).toContain("LANJUT");
    expect(utuh.kode).toBe(0);
  });

  it("PASANGAN: jebakan EXIT berteriak saat terpotong, diam saat tuntas, dan tak menyentuh kode keluar", () => {
    const badan = (ekor: string) =>
      `set -euo pipefail; TUNTAS=0; ` +
      `trap '[ "$TUNTAS" = 1 ] || echo "=== JALAN TERPOTONG: berhenti sebelum sampai ke baris Hasil ==="' EXIT; ` +
      `echo "  ✔ seksi 110"; ${ekor}`;
    const terpotong = jalankanBash(badan(`X=$(echo ada | grep -o 'tak-ada'); TUNTAS=1; echo "=== Hasil: 9 lolos, 0 gagal ==="`));
    expect(terpotong.keluaran).toContain("JALAN TERPOTONG");
    expect(terpotong.keluaran).not.toContain("=== Hasil:");
    // Tepat cacat yang membingungkan itu: exit bukan-nol TANPA satu pun ✘.
    expect(terpotong.kode).not.toBe(0);
    expect(terpotong.keluaran).not.toContain("✘");

    const gagalJujur = jalankanBash(badan(`TUNTAS=1; echo "=== Hasil: 9 lolos, 1 gagal ==="; [ 1 -eq 0 ]`));
    expect(gagalJujur.keluaran).not.toContain("JALAN TERPOTONG");
    expect(gagalJujur.keluaran).toContain("=== Hasil: 9 lolos, 1 gagal ===");
    expect(gagalJujur.kode, "jebakannya tak boleh menelan verdik gagal").toBe(1);

    const lolos = jalankanBash(badan(`TUNTAS=1; echo "=== Hasil: 9 lolos, 0 gagal ==="; [ 0 -eq 0 ]`));
    expect(lolos.keluaran).not.toContain("JALAN TERPOTONG");
    expect(lolos.kode).toBe(0);
  });

  it("BUKTI MERAH: ketiga pemindai teksnya benar-benar bisa menuduh", () => {
    // Bentuk PERSIS seperti sebelum diperbaiki — dan komentarnya tak dituduh.
    const sebelum = [
      `ASET111=$(curl -s "$BASE/" | grep -o '/assets/[^"]*\\.js' | head -1)`,
      `# ASET111=$(curl -s "$BASE/" | grep -o '/x' | head -1)`,
      `RINGKAS309=$(echo "$R309" | grep '^RINGKAS ' | head -1 || true)`,
      `if X=$(curl -sf "$BASE/a"); then Y=0; fi`,
    ].join("\n");
    expect(situsRawanAbort(sebelum)).toEqual([1]);

    expect(
      kodeKeluarTakTerbaca(`R309=$(npx tsx x)\nKELUAR309=$?\nif B=$(npx tsx y); then K=0; else K=$?; fi\n`),
    ).toEqual([2]);

    // Cabang lewat yang kehilangan satu `ok` — cacah asersinya menyusut.
    const pincang = `if [ "$ADA_DIST" = 1 ]; then\n  cek "a" "V == 1" "1"\n  cek "b" "V == 1" "1"\nelse\n  ok "a (dilewati)"\nfi\n`;
    expect(blokDist(pincang)).toEqual([{ baris: 1, lenganThen: 2, lenganElse: 1 }]);
    const genap = `if [ "$ADA_DIST" = 1 ]; then\n  cek "a" "V == 1" "1"\nelse\n  ok "a (dilewati)"\nfi\n`;
    expect(blokDist(genap)).toEqual([{ baris: 1, lenganThen: 1, lenganElse: 1 }]);
  });
});
