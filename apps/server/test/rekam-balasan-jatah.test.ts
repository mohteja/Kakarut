import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kelasBalasan, kunciRekam } from "../src/lib/rekam-balasan";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * UJI PENOLAKAN TAK BOLEH MENGELAPARKAN BENTUK SUKSES.
 *
 * Perekam balasan (`ADU_TIPE=`) memberi tiap rute jatah `MAKS_REKAM_PER_RUTE`
 * rekaman. Pembandingnya (`adu-tipe-kawat.ts`) lalu MEMBUANG tiap balasan
 * berstatus ≥ 400. Sampai 2026-09-12 kedua angka itu tak saling tahu: jatahnya
 * berkunci `metode+pola` saja, jadi rute yang dua ketukan pertamanya kebetulan
 * uji penolakan menghabiskan jatahnya pada balasan yang akan dibuang.
 *
 * TERUKUR pada jalan verify-api yang sama, batas 2 lawan batas 8: DELAPAN pola
 * kembali muncul begitu batasnya dinaikkan.
 *
 *   DELETE /api/bahan/:id                 dua ketukan pertama: 409, 404
 *   PATCH  /api/pengajuan/:id                                  403, 400
 *   POST   /api/kebersihan                                     400, 400
 *   POST   /api/penjualan                                      409, 409
 *   POST   /api/profil/password                                401, 400
 *   POST   /api/shift/:id/selisih/putuskan                     403, 400
 *   POST   /api/transfer-stok                                  400, 400
 *   PUT    /api/bahan/:id/resep                                400, 400
 *
 * `POST /api/penjualan` ada di daftar itu — rute paling inti aplikasi kasir,
 * bentuk balasannya tak pernah sekali pun diadu dengan kontrak. Dan tak ada
 * yang mengabarkannya: lengan premis §311 adalah LANTAI (`≥ 250`), dan lantai
 * tak bisa melihat delapan yang hilang.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const APP = butaKomentar(readFileSync(`${AKAR}apps/server/src/app.ts`, "utf8"));
const VERIFY = readFileSync(`${AKAR}scripts/verify-api.sh`, "utf8");

/**
 * Tiruan jatah perekam — bentuknya sengaja sama dengan `app.ts`: satu Map,
 * satu batas, kunci dari `kunciRekam`. Dipakai untuk MENJALANKAN cacatnya,
 * bukan cuma menyebutnya.
 */
function rekam(
  balasan: { pola: string; status: number }[],
  maks: number,
  kunci: (pola: string, status: number) => string,
): { pola: string; status: number }[] {
  const cacah = new Map<string, number>();
  const keluar: { pola: string; status: number }[] = [];
  for (const b of balasan) {
    const k = kunci(b.pola, b.status);
    const n = cacah.get(k) ?? 0;
    if (n >= maks) continue;
    cacah.set(k, n + 1);
    keluar.push(b);
  }
  return keluar;
}

/** Apa yang TERSISA sesudah pembandingnya membuang balasan galat. */
const diadu = (r: { status: number }[]) => r.filter((b) => b.status < 400);

describe("jatah rekaman balasan: kelas ikut jadi kunci", () => {
  it("PREMIS: helpernya dipakai app.ts, dan tak ada kunci telanjang tersisa", () => {
    expect(APP).toContain("const kunci = kunciRekam(c.req.method, c.req.routePath, c.res.status);");
    expect(APP, "kunci lama (tanpa kelas) hidup lagi").not.toMatch(
      /const kunci = `\$\{c\.req\.method\} \$\{c\.req\.routePath\}`/,
    );
    expect(APP).toContain("const MAKS_REKAM_PER_RUTE = 2;");
  });

  it("kelasnya dipatok pada 400, sisi batasnya diuji", () => {
    expect(kelasBalasan(200)).toBe("ok");
    expect(kelasBalasan(201)).toBe("ok");
    expect(kelasBalasan(304)).toBe("ok");
    expect(kelasBalasan(399)).toBe("ok");
    expect(kelasBalasan(400), "400 adalah galat pertama — sisi batas").toBe("galat");
    expect(kelasBalasan(409)).toBe("galat");
    expect(kelasBalasan(500)).toBe("galat");
    expect(kunciRekam("POST", "/api/penjualan", 409)).toBe("POST /api/penjualan galat");
    expect(kunciRekam("POST", "/api/penjualan", 201)).toBe("POST /api/penjualan ok");
  });

  it("PASANGAN: kunci LAMA melaparkan bentuk sukses, kunci BARU tidak", () => {
    // Urutan NYATA `POST /api/penjualan` pada jalan gerbang: 409, 409, lalu 201.
    const urutan = [
      { pola: "/api/penjualan", status: 409 },
      { pola: "/api/penjualan", status: 409 },
      { pola: "/api/penjualan", status: 201 },
      { pola: "/api/penjualan", status: 201 },
    ];
    const lama = rekam(urutan, 2, (p) => `POST ${p}`);
    expect(lama).toHaveLength(2);
    expect(
      diadu(lama),
      "kunci lama: jatah habis di dua penolakan, NOL bentuk sukses tersisa untuk diadu",
    ).toEqual([]);

    const baru = rekam(urutan, 2, (p, s) => kunciRekam("POST", p, s));
    expect(baru).toHaveLength(4);
    expect(diadu(baru), "kunci baru: bentuk suksesnya ikut terekam").toHaveLength(2);
  });

  it("PASANGAN: jatah galat tetap BERBATAS — pemisahan bukan pintu terbuka", () => {
    const seratus = Array.from({ length: 100 }, () => ({ pola: "/api/x", status: 400 }));
    const r = rekam(seratus, 2, (p, s) => kunciRekam("POST", p, s));
    expect(r, "galat pun paling banyak `maks`, bukan tak terbatas").toHaveLength(2);
    // …dan rute yang TAK PERNAH galat tak membayar apa pun untuk pemisahan ini.
    const semuaOk = Array.from({ length: 10 }, () => ({ pola: "/api/y", status: 200 }));
    expect(rekam(semuaOk, 2, (p, s) => kunciRekam("GET", p, s))).toHaveLength(2);
  });

  it("INTI: lantai §311 dinaikkan — lantai 250 tak bisa melihat delapan yang hilang", () => {
    /*
     * Terukur sesudah perbaikan: 269 pola diadu (dari 261). Lantai 265 memberi
     * ruang empat pola untuk berayun bersama data, dan tetap MEMERAH bila
     * delapan hilang lagi. Lantai 250 yang lama membiarkannya lewat.
     */
    const baris = VERIFY.split("\n").find((l) => l.includes("§311 premis: pola rute terekam"));
    expect(baris, "lengan premis §311 tak ditemukan").toBeTruthy();
    const angka = Number(/V >= (\d+)/.exec(baris!)?.[1]);
    expect(angka, "lantai §311 terlalu rendah untuk melihat pola yang hilang").toBeGreaterThanOrEqual(265);
  });
});
