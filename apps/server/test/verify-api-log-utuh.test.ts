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
