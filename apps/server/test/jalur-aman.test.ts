import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jalurDalam } from "../src/modules/upload/jalur-aman";

/**
 * Penjaga BATAS DIREKTORI pada dua penyimpanan lokal (unggahan & cadangan).
 *
 * Keduanya sudah punya penjaga traversal, dan keduanya memakai bentuk yang
 * sama: `path.join` lalu `startsWith(baseDir)`. Bentuk itu meleset di satu
 * titik yang tak kelihatan — `startsWith` menyamakan TEKS, bukan batas
 * direktori — sehingga direktori SEBELAH yang berawalan sama ikut lolos.
 *
 * JUJUR TENTANG BOBOTNYA: hari ini tak ada masukan pengguna yang sampai ke
 * sini. Kunci unggahan disusun server dan kunci cadangan lahir dari stempel
 * waktu, jadi ini menutup perangkap yang menunggu — bukan lubang yang sedang
 * menganga. Yang dijaga uji ini adalah supaya perangkapnya tidak dipasang
 * kembali saat suatu hari kunci itu datang dari luar.
 */
const DASAR = path.resolve("/data/uploads");

describe("kunci yang sah tetap lewat", () => {
  it("nama berkas polos", () => {
    expect(jalurDalam(DASAR, "kakarut-2026-08-03T00-00-00-000Z.jsonl.gz")).toBe(
      path.join(DASAR, "kakarut-2026-08-03T00-00-00-000Z.jsonl.gz"),
    );
  });

  it("kunci bersarang seperti yang dipakai unggahan", () => {
    const k = "companies/11111111-1111-1111-1111-111111111111/menu/abc.png";
    expect(jalurDalam(DASAR, k)).toBe(path.join(DASAR, k));
  });

  it("titik-sekarang dinormalkan, bukan ditolak", () => {
    expect(jalurDalam(DASAR, "./a/./b.png")).toBe(path.join(DASAR, "a/b.png"));
  });
});

describe("yang keluar dari direktori dasar DITOLAK", () => {
  it("naik satu tingkat", () => {
    expect(() => jalurDalam(DASAR, "../rahasia.txt")).toThrow(/tidak valid/);
  });

  it("naik lalu turun lagi", () => {
    expect(() => jalurDalam(DASAR, "a/../../rahasia.txt")).toThrow(/tidak valid/);
  });

  it("INTI: direktori SEBELAH yang berawalan sama", () => {
    // Inilah yang lolos dari `startsWith(baseDir)`: "/data/uploads-lama/x"
    // memang berawalan "/data/uploads", tapi ia direktori lain.
    const lama = jalurDalam;
    expect(() => lama(DASAR, "../uploads-lama/x.png")).toThrow(/tidak valid/);
    // Dan buktikan bentuk LAMA memang meloloskannya — kalau tidak, uji di atas
    // hijau karena alasan yang salah.
    const jalurLama = path.join(DASAR, "../uploads-lama/x.png");
    expect(jalurLama.startsWith(DASAR)).toBe(true);
  });

  it("kunci ABSOLUT ditolak, bukan ditulis ulang diam-diam", () => {
    // `path.join(dasar, "/etc/passwd")` memulangkan "<dasar>/etc/passwd" —
    // aman tapi menyesatkan. `resolve` memulangkan "/etc/passwd" sehingga
    // penjaganya bisa menolak terang-terangan.
    expect(() => jalurDalam(DASAR, "/etc/passwd")).toThrow(/tidak valid/);
  });

  it("dasarnya sendiri bukan berkas yang sah untuk ditulis", () => {
    // `""` menghasilkan dasar itu sendiri; menulis ke sana akan menimpa
    // direktorinya. Dibiarkan lewat HANYA sebagai jalur, bukan sebagai berkas.
    expect(jalurDalam(DASAR, "")).toBe(DASAR);
  });
});

describe("kedua penyimpanan memakainya — tak ada salinan yang tertinggal", () => {
  const baca = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it.each([
    ["unggahan", "../src/modules/upload/local-driver.ts"],
    ["cadangan", "../src/modules/upload/backup-storage.ts"],
  ])("%s memanggil jalurDalam", (_nama, berkas) => {
    expect(baca(berkas)).toMatch(/jalurDalam\(this\.baseDir, key\)/);
  });

  it("bentuk lama `startsWith(this.baseDir)` sudah tidak ada di mana pun", () => {
    for (const f of [
      "../src/modules/upload/local-driver.ts",
      "../src/modules/upload/backup-storage.ts",
    ]) {
      expect(baca(f)).not.toContain("startsWith(this.baseDir)");
    }
  });
});
