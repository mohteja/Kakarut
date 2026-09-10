import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * "DISEBUT PENULISNYA" ≠ "DISEBUT KONTRAK".
 *
 * `bentuk-balasan.ts` sudah memaku dua aturan sejak lama: bentuk balasan tak
 * boleh ditentukan TABELNYA (ATURAN A), dan kolom rahasia tak punya jalan ke
 * balasan (ATURAN B). Keduanya masih berlaku — dan keduanya HIJAU pada tiap
 * cacat yang tiga vena terakhir temukan, sebab sebuah `c.json({ … })` yang
 * mengetik kuncinya satu per satu memang "disebut penulisnya".
 *
 * Yang tak pernah ditanyakan siapa pun: **apakah bentuk itu ADA di kontrak?**
 *
 * Diukur 2026-09-10 atas seluruh `modules/**\/routes.ts`:
 *
 *   77 literal `c.json({…})` berkunci ≥ 2
 *    7 cocok PERSIS satu interface di `types.ts`
 *   45 pengakuan `{ok, …}` (≤ 4 kunci)
 *    6 badan galat (`error`/`kode`)
 *   19 AMPLOP DATA tanpa kontrak  ← populasi vena ini
 *
 * Yang terbesar di antara ke-19 itu `GET /admin/sistem` (6 kunci), dan ia
 * membuktikan biayanya: DUA halaman web mendeklarasikan `SistemStatus` dengan
 * NAMA YANG SAMA untuk himpunan kunci yang SALING LEPAS — lima dan satu — dan
 * tak satu pun menggambarkan balasan yang sebenarnya. Nama yang sama untuk dua
 * bentuk berbeda lebih buruk daripada dua nama: pembacanya mengira sudah
 * melihat bentuknya. Kunci ke-7 yang disuntikkan ke rute itu lolos typecheck,
 * lolos 3.106 uji, dan lolos **3.647 lengan verify-api** — pada rute yang
 * memang DIKETUK, bukan yang terlewat.
 *
 * Berkas ini RATCHET, bukan larangan: utangnya berangka dan hanya boleh
 * MENYUSUT. Menutup ke-19 sekaligus akan jadi satu commit yang tak bisa
 * ditinjau siapa pun; yang berbahaya bukan utangnya melainkan utang yang
 * tumbuh tanpa ada yang menghitungnya.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const MODUL = "apps/server/src/modules";
const TIPE = "packages/shared/src/types.ts";

/**
 * UTANG YANG DIIZINKAN — hanya boleh turun.
 *
 * 21 saat diukur dengan pemindai yang BENAR; `GET /admin/sistem` dibayar
 * 2026-09-10 → 20. Sehari kemudian pemindainya diperbaiki lagi (ia buta
 * terhadap sebaran bersyarat, lihat `kunciSebaranBersyarat`) → **22**, lalu
 * kedua amplop `/auth` dibayar → **20** lagi. Angkanya kembali ke tempat yang
 * sama, tapi yang DILIHATNYA bertambah dua — dan itulah yang membedakan
 * ratchet dari angka yang kebetulan tak berubah.
 *
 * Angka 19 yang sempat kutulis salah, dan salahnya instruktif: sapuan Python
 * pertamaku menuntut TITIK DUA untuk mengenali kunci, jadi properti ringkas
 * (`{ ok: true, diperiksa, yatim, … }`) tak terlihat olehnya dan dua amplop
 * terhitung terlalu sempit. `kunciObjek` — pembantu rumah yang sudah dipakai
 * lima penjaga lain — mengenalinya. Dua cara menghitung yang tak cocok adalah
 * cara temuan lahir; yang salah instrumen baruku, bukan yang lama.
 *
 * Amplop buku dana `{rows, total}` dibayar 2026-09-11 → **19**.
 */
const MAKS_UTANG = 19;

/**
 * Dua kelas yang SENGAJA di luar hitungan, dan alasannya bukan kemudahan.
 *
 *  · **Pengakuan `{ok, …}`** (45 situs). Ia bukan bentuk data melainkan
 *    jawaban "berhasil", dan kuncinya menyertai sebagai keterangan
 *    (`{ok, jumlah_baris}`). Menamai keempat puluh lima akan melahirkan empat
 *    puluh lima interface sekali-pakai — kontrak yang lebih sulit dibaca
 *    daripada yang dijaganya.
 *  · **Badan galat** (`error`/`kode`, 6 situs). Bentuknya dipaku dari sisi
 *    LAIN: kosakata `kode` diadu dua arah dengan kontrak di uji status.
 *
 * Batasnya nyata dan disebut: amplop data yang KEBETULAN membawa `ok` lolos
 * hitungan ini. Tak ada yang seperti itu hari ini (ditelusuri satu per satu),
 * dan kalau kelak ada, yang menangkapnya §303 dari kawat, bukan berkas ini.
 */
function kelasDikecualikan(kunci: string[]): boolean {
  if (kunci.includes("ok") && kunci.length <= 4) return true;
  return kunci.includes("error") || kunci.includes("kode");
}

function berkasRute(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasRute(jalur);
    return jalur.endsWith("routes.ts") ? [jalur] : [];
  });
}

/** Tiap interface `types.ts`, sebagai himpunan medan yang diurutkan. */
export function bentukKontrak(tipe: string): Set<string> {
  const keluar = new Set<string>();
  for (const m of tipe.matchAll(/^export interface ([A-Za-z0-9_]+)/gm)) {
    const medan = medanInterface(tipe, m[1]);
    if (medan.length >= 2) keluar.add([...medan].sort().join(","));
  }
  return keluar;
}

/** Isi literal `{ … }` yang dimulai di `awal`, termasuk kurung penutupnya. */
function badanLiteral(s: string, awal: number): string {
  let d = 0;
  for (let j = awal; j < s.length; j++) {
    if (s[j] === "{") d++;
    else if (s[j] === "}") {
      d--;
      if (d === 0) return s.slice(awal, j + 1);
    }
  }
  return "";
}

/**
 * Kunci yang HANYA muncul lewat sebaran bersyarat — `...(x ? { a, b } : {})`.
 *
 * `kunciObjek` tak melihatnya, dan itu bukan cacatnya: ia mengurai kunci
 * tingkat atas, dan kunci-kunci ini secara sintaksis ada di objek LAIN.
 * Tapi mereka SAMPAI KE KAWAT, dan akibatnya terukur pada 2026-09-10 — sehari
 * sesudah berkas ini lahir. Amplop `/auth/register` terbaca empat kunci
 * (`ok, sebab, message, retry_after_detik`) sehingga lolos sebagai
 * "pengakuan `{ok, …}` ≤ 4", padahal ia mengirim ENAM: `dev_verify_kode` dan
 * `dev_verify_url` menumpang sebaran itu. Yang terakhir bahkan **tak
 * dideklarasikan di mana pun** — ponsel mencatatnya sebagai hantu beralasan,
 * dan tipe lokal web tak menyebutnya sama sekali.
 *
 * Jadi pengecualian yang kutulis kemarin memutuskan atas himpunan yang SALAH.
 * Bukan ratchet-nya yang lunak; pembacanya yang rabun.
 */
export function kunciSebaranBersyarat(badan: string): string[] {
  const keluar: string[] = [];
  for (const m of badan.matchAll(/\.\.\.\([^)]*\?\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keluar.push(k[1]);
  }
  return keluar;
}

/** Amplop `c.json({…})` berkunci ≥2 yang bentuknya tak ada di kontrak. */
export function amplopTanpaKontrak(
  sumber: Record<string, string>,
  bentuk: Set<string>,
): string[] {
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/c\.json\(\s*\{/g)) {
      const i = buta.indexOf("{", m.index!);
      // Himpunan PENUH: kunci tingkat atas + yang menumpang sebaran bersyarat.
      const ks = [
        ...new Set([...kunciObjek(buta, i), ...kunciSebaranBersyarat(badanLiteral(buta, i))]),
      ].sort();
      if (ks.length < 2) continue;
      if (bentuk.has(ks.join(","))) continue;
      if (kelasDikecualikan(ks)) continue;
      keluar.push(`${berkas}:${buta.slice(0, i).split("\n").length} [${ks.join(",")}]`);
    }
  }
  return keluar.sort();
}

describe("amplop balasan: disebut penulisnya BELUM berarti disebut kontrak", () => {
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const bentuk = bentukKontrak(tipe);
  const sumber: Record<string, string> = {};
  for (const f of berkasRute(AKAR + MODUL)) sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
  const utang = amplopTanpaKontrak(sumber, bentuk);

  it("PREMIS: sapuannya melihat sebanyak yang diukur", () => {
    // Uji yang kehilangan bahannya lulus tanpa memeriksa apa pun.
    expect(Object.keys(sumber).length, "berkas rute tersapu terlalu sedikit").toBeGreaterThan(25);
    expect(bentuk.size, "bentuk kontrak terbaca terlalu tipis").toBeGreaterThan(100);
  });

  it("INTI: utang amplop tanpa kontrak hanya boleh MENYUSUT", () => {
    expect(
      utang.length,
      `amplop data tanpa tipe kontrak BERTAMBAH (${utang.length} > ${MAKS_UTANG}). ` +
        "Sebuah `c.json({…})` yang mengetik kuncinya satu per satu memang lolos " +
        "ATURAN A `bentuk-balasan`, tapi bentuknya tetap tak ada di `types.ts` — " +
        "jadi tak ada fikstur, Lampiran A, atau lengan verify-api yang bisa " +
        "menagihnya. Deklarasikan bentuknya, atau turunkan MAKS_UTANG bila " +
        "kau baru saja membayarnya:\n" + utang.join("\n"),
    ).toBeLessThanOrEqual(MAKS_UTANG);
  });

  it("INTI: amplop `GET /admin/sistem` sudah TIDAK termasuk utang", () => {
    /*
     * Dipaku pada BENTUKNYA, bukan pada nama berkasnya: `admin-system` masih
     * punya amplop lain yang belum dibayar (`POST /sapu-unggahan`, enam kunci),
     * dan asersi berkunci berkas akan menuduhnya seolah yang ini gagal.
     */
    const kontrak = medanInterface(tipe, "SistemStatusDto");
    const sidik = [...kontrak].sort().join(",");
    expect(
      utang.filter((u) => u.includes(`[${sidik}]`)),
      "amplop sistem kembali ke daftar utang — MAKS_UTANG yang diturunkan jadi bohong",
    ).toEqual([]);
    expect(kontrak.sort()).toEqual([
      "database_ok",
      "email_percobaan",
      "migrations",
      "node_version",
      "pemeriksaan",
      "storage_mode",
    ]);
  });

  it("INTI: amplopnya dinyatakan `satisfies`, dan kedua halaman web memakai Pick", () => {
    const rute = butaKomentar(readFileSync(AKAR + MODUL + "/admin-system/routes.ts", "utf8"));
    expect(rute, "amplop /admin/sistem tak menyatakan tipenya").toContain(
      "} satisfies SistemStatusDto)",
    );
    const sp = butaKomentar(
      readFileSync(AKAR + "apps/web/src/pages/superadmin/SistemPage.tsx", "utf8"),
    );
    const rp = butaKomentar(
      readFileSync(AKAR + "apps/web/src/pages/superadmin/RiwayatEmailPage.tsx", "utf8"),
    );
    // Nama yang SAMA untuk dua himpunan yang SALING LEPAS — itu bentuk cacatnya.
    for (const [nama, src] of [["SistemPage", sp], ["RiwayatEmailPage", rp]] as const) {
      expect(src, `${nama} masih mendeklarasikan SistemStatus sendiri`).not.toMatch(
        /interface SistemStatus\s*\{/,
      );
      expect(src, `${nama} tak menurunkan bentuknya dari kontrak`).toMatch(
        /Pick<\s*SistemStatusDto,/,
      );
    }
    // …dan bentuk migrasi berhenti diketik ulang di web.
    expect(sp).not.toMatch(/interface MigrationEntry\s*\{/);
  });

  it("INTI: kedua amplop `/auth` bernama, dan web berhenti mengetiknya ulang", () => {
    /*
     * `/register` dan `/resend-verification` memulangkan bentuk yang SAMA
     * PERSIS, dan itu syarat — bukan kebetulan. Respons yang berbeda antar
     * pintu membuka kembali enumerasi akun yang seluruh rute di sekitarnya
     * susah payah tutup. Satu tipe untuk keduanya memaku kesamaan itu.
     */
    const auth = butaKomentar(readFileSync(AKAR + MODUL + "/auth/routes.ts", "utf8"));
    expect(
      (auth.match(/\} satisfies DaftarResult\)/g) ?? []).length,
      "kedua amplop /auth harus menyatakan tipenya, bukan cuma satu",
    ).toBe(2);
    const kontrak = medanInterface(tipe, "DaftarResult");
    expect(kontrak.sort()).toEqual([
      "dev_verify_kode",
      "dev_verify_url",
      "message",
      "ok",
      "retry_after_detik",
      "sebab",
    ]);
    // `dev_verify_url` medan yang DIKIRIM tapi tak dideklarasikan di mana pun
    // sampai putaran ini — kalau ia lenyap lagi dari kontrak, uji ini menyebut
    // namanya alih-alih membiarkannya jadi hantu untuk kedua kalinya.
    expect(kontrak, "dev_verify_url — medan yang dulu dikirim tanpa nama").toContain(
      "dev_verify_url",
    );
    const ctx = butaKomentar(
      readFileSync(AKAR + "apps/web/src/context/AuthContext.tsx", "utf8"),
    );
    expect(ctx, "web masih mengetik DaftarResult sendiri").not.toMatch(
      /interface DaftarResult\s*\{/,
    );
    expect(ctx, "web tak menurunkan DaftarResult dari kontrak").toMatch(
      /export type \{ DaftarResult \}/,
    );
  });

  it("PASANGAN: pemindainya menuduh — dan mengecualikan dengan alasan", () => {
    const b = new Set(["a,b"]);
    // Amplop data tanpa kontrak: TERTUDUH.
    expect(amplopTanpaKontrak({ "x.ts": "return c.json({ rows: r, total: t });" }, b)).toEqual(["x.ts:1 [rows,total]"]);
    // Bentuk yang ADA di kontrak: tidak.
    expect(amplopTanpaKontrak({ "y.ts": "return c.json({ a: 1, b: 2 });" }, b)).toEqual([]);
    // Pengakuan `{ok, …}`: dikecualikan — beralasan, bukan kebetulan.
    expect(
      amplopTanpaKontrak({ "z.ts": "return c.json({ ok: true, jumlah_baris: n });" }, b),
    ).toEqual([]);
    // …tapi `ok` pada amplop LEBAR tetap tertuduh (batas pengecualiannya).
    expect(
      amplopTanpaKontrak(
        { "w.ts": "return c.json({ ok: true, a: 1, b: 2, c: 3, d: 4 });" },
        b,
      ),
    ).toEqual(["w.ts:1 [a,b,c,d,ok]"]);
    // Badan galat: dikecualikan.
    expect(
      amplopTanpaKontrak({ "e.ts": 'return c.json({ error: "x", kode: "y" }, 409);' }, b),
    ).toEqual([]);
    // Komentar tak dihitung.
    expect(amplopTanpaKontrak({ "k.ts": "// c.json({ rows: r, total: t })" }, b)).toEqual([]);
    // Satu kunci bukan "bentuk".
    expect(amplopTanpaKontrak({ "s.ts": "return c.json({ rows: r });" }, b)).toEqual([]);
    /*
     * SEBARAN BERSYARAT — kelas yang membuat pemindai ini rabun selama sehari.
     * Empat kunci tingkat atas termasuk `ok` LOLOS sebagai pengakuan; begitu
     * dua kunci yang menumpang `...(dev ? {…} : {})` ikut dihitung, himpunannya
     * enam dan pengecualiannya tak lagi berlaku. Diuji sebagai PERILAKU
     * pemindainya, bukan disimpulkan dari kodenya.
     */
    expect(kunciSebaranBersyarat("{ ok: true, ...(dev ? { a: 1, b: 2 } : {}) }")).toEqual([
      "a",
      "b",
    ]);
    expect(kunciSebaranBersyarat("{ ok: true }")).toEqual([]);
    const rabun = "return c.json({ ok: true, sebab, message: m, retry_after_detik: n });";
    const penuh =
      "return c.json({ ok: true, sebab, message: m, retry_after_detik: n, " +
      "...(dev ? { dev_verify_kode: k, dev_verify_url: u } : {}) });";
    expect(amplopTanpaKontrak({ "r.ts": rabun }, b), "empat kunci + ok = pengakuan").toEqual([]);
    expect(
      amplopTanpaKontrak({ "p.ts": penuh }, b),
      "enam kunci — pengecualian pengakuan tak lagi berlaku",
    ).toEqual([
      "p.ts:1 [dev_verify_kode,dev_verify_url,message,ok,retry_after_detik,sebab]",
    ]);
  });
});
