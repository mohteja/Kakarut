import { mkdtemp, mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hapusBerkasLokal } from "../src/modules/upload/jalur-aman";
import { SRC } from "./util/sql-mentah";
import { situsDitelan } from "./util/galat-ditelan";

/**
 * PENGHAPUSAN YANG GAGAL, DIHITUNG SEBAGAI BERHASIL.
 *
 * Kelasnya dinamai gerbang repo ini sendiri, di kepala `verify-api.sh`:
 * *"galat yang ditelan lalu muncul sebagai kebingungan di tempat lain."*
 * Sapuan 2026-08-26 menghitungnya: **270 blok `catch`** (server 69 · web 45 ·
 * mobile 156), **24** berbadan kosong, dan **12** yang tak menuliskan alasan
 * apa pun. Sepuluh di antaranya benar dan cuma perlu alasannya ditulis. Dua
 * sisanya satu bentuk, dan bentuk itulah temuannya:
 *
 *     await unlink(jalurDalam(...)).catch(() => {});
 *
 * Kontraknya sendiri sudah menuliskan batasnya (`storage.ts`): *"berkas yang
 * sudah tak ada bukan galat"* — sementara kodenya menelan `EPERM`, `EISDIR`,
 * `EACCES`, `EROFS` juga. Saudara kandungnya di R2 melempar. Satu antarmuka,
 * dua kejujuran yang berlawanan.
 *
 * TIGA PINTU memanggilnya, dan ketiganya membuang catatan SATU-SATUNYA yang
 * menamai objek itu. Terukur lewat HTTP terhadap DB dev + disk sungguhan:
 *
 *   DELETE /admin/sistem/backup/:id   200 `{ok:true}` · baris 1 → 0 · objek TETAP ADA
 *   POST   /admin/sistem/backup/retensi  `{"dibuang":1}` · baris 1 → 0 · objek TETAP ADA
 *   POST   /admin/sistem/sapu-unggahan   `dihapus: 3` padahal hanya 2 hilang
 *                                        (yang gagal masih dilayani HTTP 200)
 *
 * Yang tersisa: objek berbayar yang tak tercatat di mana pun lagi — retensi tak
 * akan melihatnya, dan sapuan yatim hanya menyapu bucket unggahan.
 */

/**
 * Jumlah situs telanan per berkas. TANPA prosa, dan itu disengaja: alasan tiap
 * situs sudah dituntut MEKANIS oleh uji di bawahnya, jadi daftar ini tak perlu
 * mengulanginya. Fungsinya cuma satu — telanan BARU tak bisa masuk diam-diam;
 * ia menaikkan angka di sini dan menagih satu keputusan.
 */
const PER_BERKAS = new Map<string, number>([
  ["server/app.ts", 1],
  ["server/config/env.ts", 1],
  ["server/db/migrate.ts", 1],
  ["server/lib/backup.ts", 3],
  ["server/lib/error-log.ts", 1],
  ["server/lib/pangkas-token.ts", 1],
  ["server/lib/sapu-unggahan.ts", 2],
  ["server/modules/auth/routes.ts", 2],
  ["server/modules/sync/idempoten.ts", 1],
  ["server/modules/sync/routes.ts", 2],
  ["server/modules/upload/backup-storage.ts", 1],
  ["server/modules/users/routes.ts", 1],
  ["server/scripts/restore-backup.ts", 1],
  ["server/seed/guest.ts", 1],
  ["web/components/BatasGalat.tsx", 1],
  ["web/components/ServerStatusOverlay.tsx", 1],
  ["web/components/UpdatePrompt.tsx", 3],
  ["web/lib/api.ts", 1],
  ["web/lib/print/bluetooth.ts", 2],
  ["web/lib/print/native.ts", 1],
  ["web/lib/print/usb.ts", 1],
]);

describe("galat yang ditelan: tiap situs menuliskan alasannya", () => {
  const semua = situsDitelan();

  it("populasinya benar-benar tersapu (bukan nol karena pemindainya patah)", () => {
    expect(semua.length).toBeGreaterThanOrEqual(25);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThanOrEqual(18);
    // Kedua bentuknya terlihat — `.catch(() => {})` DAN `catch {}`.
    expect(new Set(semua.map((x) => x.bentuk)).size).toBe(2);
  });

  it("tak ada satu pun telanan tanpa alasan tertulis", () => {
    const bisu = semua.filter((x) => !x.beralasan).map((x) => `${x.berkas}:${x.baris} ${x.potongan}`);
    expect(
      bisu,
      `galat ditelan tanpa satu kata pun alasannya:\n${bisu.join("\n")}\n\n` +
        "Tulis kenapa kegagalan ini boleh berhenti di sini — di dalam badan catch, " +
        "tepat sebelum `.catch` pada rantainya, atau pada baris di atas pernyataannya.",
    ).toEqual([]);
  });

  it("jumlah per berkas cocok, dan tak ada entri kuburan", () => {
    const per = new Map<string, number>();
    for (const x of semua) per.set(x.berkas, (per.get(x.berkas) ?? 0) + 1);
    const salah: string[] = [];
    for (const [berkas, n] of per) {
      const d = PER_BERKAS.get(berkas);
      if (d === undefined) salah.push(`${berkas}: ${n} telanan, berkas belum terdaftar`);
      else if (d !== n) salah.push(`${berkas}: terdaftar ${d}, sekarang ${n}`);
    }
    for (const k of PER_BERKAS.keys()) {
      if (!per.has(k)) salah.push(`${k}: sudah tak punya telanan — hapus dari daftar`);
    }
    expect(salah, salah.join("\n")).toEqual([]);
  });

  it("PREMIS: pemindainya benar-benar bisa menuduh, dan tak menuduh yang beralasan", () => {
    const bisu = situsDitelan([
      { berkas: "uji/bisu.ts", isi: "async function f() {\n  await g().catch(() => {});\n}\n" },
      { berkas: "uji/bisu2.ts", isi: "function f() {\n  try { g(); } catch {}\n}\n" },
    ]);
    expect(bisu.length).toBe(2);
    expect(bisu.every((x) => !x.beralasan)).toBe(true);

    const beralasan = situsDitelan([
      // (a) alasan di DALAM badan
      { berkas: "uji/a.ts", isi: "function f() {\n  try { g(); } catch {\n    // sudah tak ada\n  }\n}\n" },
      // (b) alasan DI TENGAH rantai, tepat sebelum `.catch`
      {
        berkas: "uji/b.ts",
        isi: "async function f() {\n  await db\n    .update(x)\n    // idempoten\n    .catch(() => {});\n}\n",
      },
      // (c) alasan pada baris DI ATAS pernyataannya
      { berkas: "uji/c.ts", isi: "async function f() {\n  const y = 1;\n  // idempoten\n  await g().catch(() => {});\n}\n" },
    ]);
    expect(beralasan.length).toBe(3);
    expect(beralasan.filter((x) => !x.beralasan)).toEqual([]);
  });

  it("PREMIS: JSDoc sebuah DEKLARASI tak bisa dipinjam jadi alasan di dalamnya", () => {
    // Kelolosan nyata pada generasi kedua pemindai ini: doc
    // `jadwalkanPangkasErrorLog` memaafkan telanan di baris pertama badannya.
    const pinjam = situsDitelan([
      {
        berkas: "uji/pinjam.ts",
        isi: "/** Jadwalkan pemangkasan berkala. */\nexport function f(): void {\n  void g().catch(() => {});\n}\n",
      },
    ]);
    expect(pinjam.length).toBe(1);
    expect(pinjam[0].beralasan, "doc deklarasi terhitung sebagai alasan telanan").toBe(false);
  });

  it("PREMIS: prosa di dalam KOMENTAR tak terhitung sebagai situs", () => {
    // Tuduhan-palsu pertama pemindai ini adalah dirinya sendiri: komentar
    // `hapusBerkasLokal` mengutip bentuk lamanya sebagai prosa.
    const prosa = situsDitelan([
      { berkas: "uji/prosa.ts", isi: "/* dulu: await unlink(p).catch(() => {}); */\nconst x = 1;\n" },
    ]);
    expect(prosa).toEqual([]);
  });
});

describe("perilaku: hapus lokal diam untuk 'sudah tak ada', melempar untuk sisanya", () => {
  it("berkas yang memang tak ada → DIAM (idempotensi kontraknya utuh)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kakarut-hapus-"));
    try {
      await expect(hapusBerkasLokal(dir, "tak-pernah-ada.gz")).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("berkas yang benar ada → terhapus", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kakarut-hapus-"));
    try {
      await writeFile(join(dir, "ada.gz"), "x");
      await expect(hapusBerkasLokal(dir, "ada.gz")).resolves.toBeUndefined();
      await expect(unlink(join(dir, "ada.gz"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("kegagalan SUNGGUHAN → MELEMPAR, dan bentuk LAMA membuktikan ia dulu diam", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kakarut-hapus-"));
    try {
      // Objek yang tak bisa di-`unlink` bahkan oleh root: sebuah DIREKTORI.
      // Cara yang sama dipakai §268 lewat HTTP — tanpa main izin, jadi ia
      // berlaku sama di mesin pengembang maupun di CI.
      await mkdir(join(dir, "bandel.gz"));
      await expect(hapusBerkasLokal(dir, "bandel.gz")).rejects.toThrow();

      // BUKTI MERAH: bentuk lama, apa adanya. Kalau ia pun melempar, tak ada
      // yang diperbaiki putaran ini.
      const lama = async (key: string) => {
        await unlink(join(dir, key)).catch(() => {});
      };
      await expect(lama("bandel.gz")).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("tiga pintu: kegagalan hapus tak lagi dihitung sebagai berhasil", () => {
  const baca = (p: string) => readFileSync(join(SRC, p), "utf8");

  it("retensi: baris DIPERTAHANKAN saat objeknya gagal dihapus", () => {
    const s = baca("lib/backup.ts");
    // Bentuk lama: `if (r.objectKey) await storage.hapus(...).catch(() => {});`
    // lalu `db.delete` TANPA SYARAT.
    expect(s).not.toMatch(/hapus\(r\.objectKey\)\.catch/);
    expect(s).toContain("await storage.hapus(r.objectKey);");
    // `continue` sebelum `db.delete` = barisnya tak jadi dibuang.
    const badan = s.slice(s.indexOf("export async function terapkanRetensi"));
    const potong = badan.slice(0, badan.indexOf("return { dibuang, gagal }"));
    expect(potong.indexOf("continue;")).toBeGreaterThan(-1);
    expect(potong.indexOf("continue;")).toBeLessThan(potong.indexOf("db.delete(backupRuns)"));
    expect(s).toContain("Promise<{ dibuang: number; gagal: number }>");
  });

  it("sapuan yatim: yang GAGAL punya penghitung sendiri, bukan ikut `dihapus`", () => {
    const s = baca("lib/sapu-unggahan.ts");
    expect(s).toContain("gagalHapus: number;");
    // `dihapus++` HANYA di jalur sukses — tepat sesudah `await storage.hapus`.
    expect(s).toMatch(/await storage\.hapus\(o\.key\);\s*\n\s*dihapus\+\+;/);
    expect(s).toMatch(/catch \(e\) \{\s*\n\s*gagalHapus\+\+;/);
  });

  it("DELETE cadangan: gagal hapus → 502, dan barisnya TIDAK dibuang", () => {
    const s = readFileSync(join(SRC, "modules/admin-system/routes.ts"), "utf8");
    expect(s).not.toMatch(/\.hapus\(row\.objectKey\)\s*\n?\s*\.catch/);
    expect(s).toContain("await getCadanganStorage().hapus(row.objectKey);");
    const i = s.indexOf("await getCadanganStorage().hapus(row.objectKey);");
    const j = s.indexOf("await db.delete(backupRuns).where(eq(backupRuns.id, id));", i);
    // `throw` di antara keduanya = penghapusan baris tak terjangkau saat gagal.
    expect(s.slice(i, j)).toContain("throw new HTTPException(502");
    // Pesan galat aslinya TIDAK ikut ke penyewa.
    expect(s.slice(i, j)).not.toMatch(/message:[^}]*e instanceof Error/);
  });

  it("aturannya PUNYA RUMAH: kedua driver lokal memanggil pintu yang sama", () => {
    for (const p of ["modules/upload/local-driver.ts", "modules/upload/backup-storage.ts"]) {
      const s = baca(p);
      expect(s, `${p} masih menelan unlink-nya sendiri`).not.toMatch(/unlink\([^)]*\)\.catch/);
      expect(s, `${p} tak memakai hapusBerkasLokal`).toContain("hapusBerkasLokal(this.baseDir, key)");
    }
    // Driver R2 sengaja TIDAK disentuh: `DeleteObject` sudah idempoten untuk
    // kunci hilang dan melempar untuk kegagalan sungguhan — persis kontraknya.
    const r2 = baca("modules/upload/r2-driver.ts");
    expect(r2).not.toContain("hapusBerkasLokal");
    expect(r2).toMatch(/async hapus\(key: string\)[\s\S]{0,200}DeleteObjectCommand/);
  });
});
