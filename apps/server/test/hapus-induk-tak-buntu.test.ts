import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * INDUK YANG DIHAPUS KODE TAK BOLEH TERKUNCI FK-nya SENDIRI.
 *
 * Referensi tanpa `onDelete` di drizzle jadi **ON DELETE NO ACTION**: Postgres
 * MENOLAK penghapusan induk selama masih ada anak. Itu penjagaan yang benar —
 * asal kodenya membereskan anaknya lebih dulu, ATAU menolak lebih dulu dengan
 * pesan yang bisa dibaca orang. Kalau tidak, tombol Hapus-nya melempar 500 dan
 * barisnya tak pernah bisa dihapus. Persis kelas yang dulu membuat Tempat
 * Sampah gagal dikosongkan selamanya.
 *
 * POPULASI TERUKUR dari katalog Postgres sungguhan: 166 FK — **80 cascade, 18
 * set null, 68 NO ACTION** — dan `schema.ts` sepakat (99 `onDelete` eksplisit,
 * sisanya bawaan). 68 itu bersandar pada **9** induk berbeda; `users` (28 anak)
 * dan `branches` (26) yang terbanyak.
 *
 * HASILNYA BERSIH, dan diukur bukan dibaca:
 *
 *   · `users` & `branches` TAK PERNAH dihapus kode — tak ada `.delete()` ke
 *     keduanya di seluruh `apps/server/src`.
 *   · Satu-satunya induk NO ACTION yang dihapus kode `menu_categories`, dan
 *     penghapusannya dijaga pra-cek. Terukur lewat HTTP:
 *     `DELETE /kategori/:id` → **409 "Kategori masih dipakai 33 menu"**.
 *   · Mengosongkan Tempat Sampah diuji ujung ke ujung dengan penjualan
 *     sungguhan: induknya hilang, `sale_items` dan `sale_consumptions` ikut
 *     tersapu cascade, HTTP 200.
 *
 * Yang dijaga di sini KEADAAN itu, bukan sejarahnya. Menambahkan `DELETE` ke
 * induk NO ACTION mana pun — mis. rute "hapus cabang" yang wajar diminta —
 * akan menabrak 26 FK sekaligus, dan gagalnya baru terlihat saat ada yang
 * menekan tombolnya di data sungguhan.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA = readFileSync(join(SRC, "db/schema.ts"), "utf8");

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Setiap `.references(() => induk.id, …)` + apakah `onDelete` disebut. */
export function referensi(): { induk: string; berkebijakan: boolean }[] {
  const keluar: { induk: string; berkebijakan: boolean }[] = [];
  for (const m of SCHEMA.matchAll(/\.references\(\s*\([^)]*\)\s*(?::\s*\w+\s*)?=>\s*(\w+)\.\w+/g)) {
    // `onDelete` boleh berada di baris yang sama atau di baris berikutnya —
    // prettier memecah opsi panjang. 200 aksara cukup untuk keduanya, dan
    // tak pernah sampai ke `.references` berikutnya.
    const ekor = SCHEMA.slice(m.index! + m[0].length, m.index! + m[0].length + 200);
    keluar.push({ induk: m[1], berkebijakan: /onDelete\s*:/.test(ekor.split(".references")[0]) });
  }
  return keluar;
}

/** Tabel yang benar-benar DIHAPUS kode — drizzle maupun SQL mentah. */
export function dihapusKode(kode?: { nama: string; isi: string }[]): Map<string, string[]> {
  const berkas =
    kode ??
    berkasTs(SRC)
      .filter((p) => !p.includes("/seed/"))
      .map((p) => ({ nama: p.slice(SRC.length + 1), isi: readFileSync(p, "utf8") }));
  const peta = new Map<string, string[]>();
  for (const { nama, isi } of berkas) {
    // Penerimanya WAJIB db/tx — `peta.delete(kunci)` pada Map bukan
    // penghapusan tabel, dan asersi pasangan di bawah menangkapnya saat versi
    // pertama uji ini memakai `.delete(` polos.
    for (const m of isi.matchAll(
      /\b(?:db|dbx|tx|exec)\s*\.\s*delete\(\s*([A-Za-z_]\w*)\s*\)|DELETE\s+FROM\s+\$?\{?([a-zA-Z_]\w*)\}?/g,
    )) {
      const t = m[1] ?? m[2];
      if (!t) continue;
      peta.set(t, [...(peta.get(t) ?? []), nama]);
    }
  }
  return peta;
}

/** Nama tabel SQL (`menu_categories`) → variabel drizzle (`menuCategories`). */
const kamel = (t: string) =>
  t.split("_").map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join("");

describe("induk ber-FK NO ACTION tak boleh dihapus tanpa jalan keluar", () => {
  it("premis: schema.ts memang terbaca & kebijakannya tercacah", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat seluruh uji hijau dengan
    // hitungan nol — izin terbuka, bukan penjagaan.
    const r = referensi();
    expect(r.length).toBeGreaterThan(150);
    expect(r.filter((x) => x.berkebijakan).length).toBeGreaterThan(90);
    expect(r.filter((x) => !x.berkebijakan).length).toBeGreaterThan(50);
  });

  it("`users` dan `branches` tetap TAK PERNAH dihapus kode", () => {
    /*
     * Keduanya induk dari 28 dan 26 FK NO ACTION. Menambahkan rute "hapus
     * karyawan" / "hapus cabang" yang menghapus BARISNYA (bukan menonaktifkan)
     * akan menabrak seluruh FK itu sekaligus — dan gagalnya baru terlihat saat
     * ada yang menekan tombolnya pada data sungguhan, bukan pada seed.
     *
     * Kalau memang perlu, jalannya menonaktifkan (`is_active`) atau membereskan
     * anaknya lebih dulu di dalam satu transaksi — bukan `.delete()` polos.
     */
    const peta = dihapusKode();
    for (const t of ["users", "branches"]) {
      expect(peta.get(t) ?? [], `${t} kini dihapus kode — periksa 26–28 FK NO ACTION-nya`).toEqual([]);
    }
  });

  it("tiap induk NO ACTION yang DIHAPUS kode punya jalan keluar tertulis", () => {
    // Satu-satunya hari ini: `menu_categories`, dijaga pra-cek 409.
    const peta = dihapusKode();
    const indukNoAction = new Set(
      referensi().filter((r) => !r.berkebijakan).map((r) => r.induk),
    );
    // PREMIS: pemindainya memang MELIHAT satu-satunya kasus yang ada. Tanpa
    // ini, regex yang tak lagi cocok membuat uji ini hijau dengan daftar
    // kosong — bentuk asersi hampa yang sudah sekali lolos di repo ini (§220).
    expect(
      peta.has("menuCategories"),
      "pemindai tak lagi melihat DELETE menu_categories — uji ini jadi hampa",
    ).toBe(true);
    expect(indukNoAction.has("menuCategories"), "menus.category_id tak lagi NO ACTION").toBe(true);

    const perlu: string[] = [];
    for (const [tabel, berkas] of peta) {
      const v = kamel(tabel);
      if (!indukNoAction.has(v)) continue;
      for (const f of new Set(berkas)) {
        const isi = readFileSync(join(SRC, f), "utf8");
        // Jalan keluarnya: menolak dengan 409 (status yang memang berarti
        // "ada yang bergantung padanya"), atau membereskan anaknya.
        if (/HTTPException\(\s*409/.test(isi)) continue;
        perlu.push(`${f} — DELETE ${tabel}`);
      }
    }
    expect(
      perlu,
      "induk ber-FK NO ACTION dihapus tanpa pra-cek 409 maupun pembersihan " +
        "anaknya. Postgres akan MENOLAK penghapusannya, dan yang sampai ke " +
        "layar 500 — barisnya tak pernah bisa dihapus",
    ).toEqual([]);
  });

  it("`DELETE /kategori/:id` mempertahankan pra-ceknya", () => {
    // Source-pin pada satu-satunya kasus yang ada, sebab uji di atas hijau juga
    // seandainya rutenya dihapus sama sekali.
    const s = readFileSync(join(SRC, "modules/kategori/routes.ts"), "utf8");
    expect(s, "pra-cek kategori-masih-dipakai hilang").toMatch(
      /HTTPException\(409[\s\S]{0,120}masih dipakai/,
    );
    expect(s, "pra-ceknya harus MENGHITUNG menu, bukan menebak").toMatch(/count\(\)[\s\S]{0,200}from\(menus\)/);
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh yang benar", () => {
    const buat = (isi: string) => dihapusKode([{ nama: "uji.ts", isi }]);
    expect([...buat("await db.delete(branches).where(x);").keys()]).toContain("branches");
    // SQL mentah — bentuk yang dipakai `sampah/routes.ts`, dan yang luput di
    // sapuan versi pertama justru pada jalur yang dulu RUSAK karena kelas ini.
    expect([...buat("sql`DELETE FROM sales WHERE company_id = ${x}`").keys()]).toContain("sales");
    // `.delete()` pada Map/Set bukan penghapusan tabel.
    expect([...buat("peta.delete(kunci);").keys()]).not.toContain("kunci");
    expect(kamel("menu_categories")).toBe("menuCategories");
  });
});
