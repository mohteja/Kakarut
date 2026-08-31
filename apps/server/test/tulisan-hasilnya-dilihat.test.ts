import { describe, expect, it } from "vitest";
import { situsTulis } from "./util/tulisan";

/**
 * PENULISAN YANG HASILNYA TAK PERNAH DILIHAT — dan pintu yang bilang "ok".
 *
 * `UPDATE … WHERE id = $1 AND company_id = $2` yang tak cocok baris apa pun
 * BUKAN galat bagi Postgres: ia sukses dengan `rowCount = 0`. Kalau rutenya
 * lalu membalas `{ ok: true }`, orang yang menekan Simpan diberi tahu bahwa
 * perubahannya tersimpan atas baris yang tak pernah disentuh — tanpa gejala,
 * tanpa galat, tanpa cara menebak dari layar.
 *
 * TERUKUR saat gerbang ini ditulis: **161 penulisan** Drizzle lewat `db`/`tx`
 * (120 `update`, 41 `delete`), dan **82 di antaranya membuang hasilnya** — tak
 * satu pun `.returning()` yang nilainya dibaca. Dari 123 yang ada di berkas
 * rute, **23** tak punya penjaga 404 di fungsi pembungkusnya.
 *
 * DAN DI SITU ANGKANYA BERHENTI MENAKUTKAN, sebab satu angka lagi menjelaskan
 * semuanya:
 *
 *     penulisan BUTA yang `where`-nya menyebut parameter rute: 0
 *
 * Ke-23 itu semuanya menulis ke baris yang TIDAK dipilih pemanggil —
 * `auth.company_id` dari token, daftar id yang baru saja dibaca sendiri, baris
 * token yang sudah divalidasi, sesi opname yang sedang dibuat. Nol baris di
 * situ normal (impor massal, hapus-lalu-sisip, retensi), bukan kegagalan.
 *
 * ITULAH yang dijaga di sini, dan ia bukan angka sembarangan melainkan
 * invarian: **pemanggil tak boleh bisa MENAMAI baris bagi penulisan yang
 * hasilnya tak diperiksa siapa pun.** Selama itu benar, "id tak dikenal" tak
 * pernah bisa dijawab "tersimpan".
 *
 * SISI PENGUKURANNYA ADA DI TEMPAT LAIN, dan sengaja. Berkas ini menjamin
 * bentuk KODE; apakah tiap pintu benar-benar menolak id yang tak ada dijawab
 * §276 `scripts/verify-api.sh`, yang menembak **54 rute pengubah
 * ber-parameter** dengan UUID acak lewat HTTP sungguhan dan menuntut tak satu
 * pun membalas 2xx. Dua lapis untuk satu aturan: yang satu tak bisa dielakkan
 * dengan menulis kode berbeda, yang lain tak bisa dielakkan dengan menulis
 * penalaran yang salah.
 *
 * Batas-batas yang diakui ditulis di kepala `util/tulisan.ts` — hijau di sini
 * berarti "aman dalam batas itu", bukan "tak mungkin salah".
 */
describe("penulisan: hasilnya dilihat, atau barisnya tak bisa dinamai pemanggil", () => {
  const semua = situsTulis();

  /* ── CAKUPAN: nol di salah satu angka ini berarti pemindainya buta ──────── */

  it("menemukan populasi penulisan (bukan lolos karena kosong)", () => {
    // 161 saat ditulis (120 update + 41 delete).
    expect(semua.length).toBeGreaterThanOrEqual(120);
    expect(semua.filter((s) => s.jenis === "update").length).toBeGreaterThanOrEqual(90);
    expect(semua.filter((s) => s.jenis === "delete").length).toBeGreaterThanOrEqual(25);
  });

  it("ketiga kelasnya terisi — pemilahnya benar-benar memilah", () => {
    // Satu kelas kosong berarti pemilahnya runtuh ke satu jawaban, dan
    // jawaban tunggal apa pun membuat aturan di bawah tak bermakna.
    for (const k of ["DILIHAT", "DIJAGA", "BUTA"] as const) {
      expect(semua.filter((s) => s.kelas === k).length, `kelas ${k} kosong`).toBeGreaterThan(0);
    }
  });

  it("menyapu berkas rute, bukan cuma pembantu", () => {
    expect(semua.filter((s) => /routes\.ts$/.test(s.berkas)).length).toBeGreaterThanOrEqual(90);
  });

  /* ── ATURANNYA ─────────────────────────────────────────────────────────── */

  it("pemanggil tak bisa MENAMAI baris bagi penulisan yang hasilnya dibuang", () => {
    const pelanggar = semua
      .filter((s) => s.kelas === "BUTA" && s.pakaiParam)
      .map((s) => `${s.berkas}:${s.baris} ${s.jenis}(${s.tabel})`);
    expect(
      pelanggar,
      "penulisan ini menyasar baris yang dipilih PEMANGGIL lewat parameter rute, " +
        "dan tak ada yang memeriksa berapa baris yang tersentuh — id yang tak " +
        "dikenal akan dijawab 'tersimpan'. Pakai `.returning()` lalu tolak 404 " +
        "bila kosong, atau periksa keberadaannya lebih dulu",
    ).toEqual([]);
  });

  /* ── PREMIS: detektornya bisa menuduh, dua arah ─────────────────────────── */

  /**
   * Dibuktikan di FIKSTUR, bukan di pohon: pelanggarnya nol di `src`, jadi
   * contohnya HARUS disuntik. Premis yang bersandar pada "kebetulan masih ada
   * contohnya" berhenti membuktikan apa pun begitu contohnya diperbaiki —
   * pelajaran putaran 27.
   */
  const satu = (kode: string) => situsTulis({ "x.ts": kode })[0];

  it("MERAH: tulisan buta yang barisnya dinamai parameter rute", () => {
    const s = satu(
      `app.patch("/:id", async (c) => {
         await db.update(menus).set({ nama: b.nama })
           .where(and(eq(menus.id, c.req.param("id")), eq(menus.companyId, auth.company_id)));
         return c.json({ ok: true });
       });`,
    );
    expect(s.kelas).toBe("BUTA");
    expect(s.pakaiParam).toBe(true);
  });

  it("HIJAU: hasilnya diikat lalu ditolak 404", () => {
    const s = satu(
      `app.patch("/:id", async (c) => {
         const [row] = await db.update(menus).set({ nama: b.nama })
           .where(eq(menus.id, c.req.param("id"))).returning();
         if (!row) throw new HTTPException(404, { message: "x" });
         return c.json(row);
       });`,
    );
    expect(s.kelas).toBe("DILIHAT");
  });

  it("HIJAU: hasilnya dibuang, tapi penjaga 404 ada di depan", () => {
    const s = satu(
      `app.patch("/:id", async (c) => {
         const [ada] = await db.select().from(menus).where(eq(menus.id, c.req.param("id")));
         if (!ada) throw new HTTPException(404, { message: "x" });
         await db.update(menus).set({ nama: b.nama }).where(eq(menus.id, c.req.param("id")));
         return c.json({ ok: true });
       });`,
    );
    expect(s.kelas).toBe("DIJAGA");
  });

  it("PASANGAN: tulisan MASSAL tak ikut dituduh", () => {
    // Nol baris di sini normal: pemanggil tak menamai apa pun, dan yang
    // ditulis adalah himpunan yang barusan dibaca sendiri. Menuduhnya akan
    // membuat gerbang ini ditutup orang alih-alih dipatuhi.
    const s = satu(
      `async function impor(c) {
         await db.delete(komponen).where(inArray(komponen.menuId, ids));
         await db.insert(komponen).values(rows);
       }`,
    );
    expect(s.kelas).toBe("BUTA");
    expect(s.pakaiParam).toBe(false);
  });

  it("PASANGAN: `map.delete(k)` bukan penulisan basis data", () => {
    // Penerimanya dibatasi ke klien DB. Tanpa itu tiap `Map`/`Set` di repo
    // masuk populasi, dan angkanya berhenti berarti.
    expect(situsTulis({ "x.ts": `cache.delete(kunci); antrean.update(x);` })).toEqual([]);
  });

  it("`tx` dihitung sama dengan `db`", () => {
    // Sebagian besar penulisan berbahaya justru ada di dalam transaksi.
    const s = satu(
      `app.post("/:id", async (c) => {
         await db.transaction(async (tx) => {
           await tx.delete(baris).where(eq(baris.id, c.req.param("id")));
         });
         return c.json({ ok: true });
       });`,
    );
    expect(s.kelas).toBe("BUTA");
    expect(s.pakaiParam).toBe(true);
  });
});
