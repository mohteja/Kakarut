import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alasanTolak } from "../../web/src/lib/unggah";

/**
 * Penjaga PAGAR UNGGAHAN SISI KLIEN — cermin dari `POST /upload`.
 *
 * `ImageUpload` memajang aturannya di layar ("JPEG/PNG/WebP, maks 5 MB") dan
 * membatasi `accept` pada pemilih berkas, tapi dulu tidak memeriksa apa pun:
 * berkasnya terkirim UTUH lebih dulu, baru ditolak server. Untuk `tujuan="bukti"`
 * — foto opname dan swafoto absen dari kamera ponsel lewat data seluler — itu
 * jalur yang paling sering dipakai sekaligus paling sering menunggu percuma,
 * karena foto 12 MP rutin melewati 5 MB.
 *
 * Yang dijaga di sini bukan "ada pemeriksaan", melainkan **pemeriksaannya SAMA
 * PERSIS dengan server**. Dua arah, dan dua-duanya merugikan:
 * - klien lebih longgar → tak ada gunanya, penolakannya balik lagi ke server;
 * - klien lebih KETAT → menolak berkas yang server terima, dan pemakainya
 *   kehabisan cara sama sekali. Ini yang lebih berbahaya, dan justru yang paling
 *   mudah terjadi diam-diam saat salah satu sisi diubah sendirian.
 */
const aturan = readFileSync(new URL("../../web/src/lib/unggah.ts", import.meta.url), "utf8");
const komponen = readFileSync(
  new URL("../../web/src/components/ImageUpload.tsx", import.meta.url),
  "utf8",
);
const server = readFileSync(
  new URL("../src/modules/upload/routes.ts", import.meta.url),
  "utf8",
);

/** Berkas palsu seukuran yang diminta — isinya tak pernah dibaca, hanya `size`. */
function berkas(byte: number, tipe: string): File {
  return new File([new Uint8Array(byte)], "foto", { type: tipe });
}

describe("alasanTolak: perilaku, bukan bentuk sumber", () => {
  const SATU_MB = 1024 * 1024;

  it("meloloskan tiga format yang didukung", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) {
      expect(alasanTolak(berkas(SATU_MB, t))).toBeNull();
    }
  });

  it("tepat 5 MB masih lolos — batasnya '>' bukan '>='", () => {
    // Server memakai `file.size > MAX_SIZE`. Kalau klien memakai `>=`, ia jadi
    // lebih ketat dan menolak berkas yang server terima.
    expect(alasanTolak(berkas(5 * SATU_MB, "image/jpeg"))).toBeNull();
  });

  it("sebyte di atas 5 MB ditolak, dengan ukurannya disebut", () => {
    const p = alasanTolak(berkas(5 * SATU_MB + 1, "image/jpeg"));
    expect(p).toContain("5 MB");
    // Menyebut ukuran nyatanya penting: "terlalu besar" tak memberi tahu
    // seberapa jauh, jadi pemakainya tak tahu harus mengecilkan berapa banyak.
    expect(p).toMatch(/5\.0 MB/);
  });

  it("HEIC iPhone ditolak — termasuk saat `type` datang kosong", () => {
    expect(alasanTolak(berkas(SATU_MB, "image/heic"))).toContain("JPEG");
    expect(alasanTolak(berkas(SATU_MB, ""))).toContain("JPEG");
  });

  it("format salah diperiksa LEBIH DULU daripada ukuran", () => {
    // HEIC 9 MB: keluhan yang berguna adalah formatnya, bukan ukurannya —
    // mengecilkan foto HEIC tetap tidak akan diterima.
    expect(alasanTolak(berkas(9 * SATU_MB, "image/heic"))).toContain("JPEG");
  });
});

describe("pagar unggahan klien = pagar server", () => {
  it("batas ukuran identik", () => {
    const klien = /MAKS_BYTE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(aturan);
    const srv = /MAX_SIZE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(server);
    expect(klien).not.toBeNull();
    expect(srv).not.toBeNull();
    expect(klien![1]).toBe(srv![1]);
  });

  it("daftar tipe identik", () => {
    const klien = /TIPE_BOLEH\s*=\s*\[([^\]]*)\]/.exec(aturan);
    expect(klien).not.toBeNull();
    const dariKlien = [...klien![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    // `ALLOWED` di server adalah peta tipe → ekstensi; kuncinya yang dibandingkan.
    const blok = /const ALLOWED[^=]*=\s*\{([^}]*)\}/.exec(server);
    expect(blok).not.toBeNull();
    const dariServer = [...blok![1].matchAll(/"([^"]+)":/g)].map((m) => m[1]).sort();
    expect(dariKlien).toEqual(dariServer);
    expect(dariKlien.length).toBeGreaterThan(0);
  });

  it("penolakan terjadi SEBELUM unggah, bukan sesudah", () => {
    // `alasanTolak` harus dipanggil lebih dulu dan menghentikan alurnya —
    // kalau ia dipanggil setelah `api(...)`, berkasnya sudah telanjur naik.
    const posTolak = komponen.indexOf("alasanTolak(file)");
    const posApi = komponen.indexOf("api<{ url: string }>");
    expect(posTolak).toBeGreaterThan(-1);
    expect(posApi).toBeGreaterThan(-1);
    expect(posTolak).toBeLessThan(posApi);
    expect(komponen).toMatch(/if \(tolak\) \{[\s\S]{0,200}?return;/);
  });

  it("`accept` pemilih berkas ikut daftar yang sama", () => {
    const acc = /accept="([^"]+)"/.exec(komponen);
    expect(acc).not.toBeNull();
    const dariAccept = acc![1].split(",").map((s) => s.trim()).sort();
    const klien = /TIPE_BOLEH\s*=\s*\[([^\]]*)\]/.exec(aturan);
    const dariKlien = [...klien![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(dariAccept).toEqual(dariKlien);
  });
});
