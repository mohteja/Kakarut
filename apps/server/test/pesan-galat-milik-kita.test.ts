import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PESAN YANG SAMPAI KE PENYEWA HARUS DITULIS KITA, BUKAN OLEH PUSTAKA.
 *
 * `onError` global sudah rapi: galat tak tertangani jadi "Terjadi kesalahan
 * pada server". Yang lolos apa adanya ke klien cuma `message` milik
 * `HTTPException` — teks yang kita karang sendiri. Jadi kebocoran tak lahir di
 * blok `catch`, melainkan di tiap pesan yang MENYISIPKAN sesuatu:
 *
 *     `Bahan ${nama} tak ada`            ← nilai dari pengirim: aman
 *     `Maksimal ${BATAS} baris`          ← konstanta kita: aman
 *     `Gagal: ${e.message}`              ← pesan pustaka: apa pun isinya, keluar
 *
 * POPULASI TERUKUR: 453 `new HTTPException` di `apps/server/src`; 88 pesannya
 * menyisipkan nilai; **lima** membawa teks galat sistem. Empat di antaranya di
 * `admin-system/routes.ts` yang digerbang super admin — terukur lewat HTTP:
 * owner 403, kasir 403 di kelima rutenya. Yang kelima `print/routes.ts`, dan
 * itulah satu-satunya yang bisa dicapai kasir.
 *
 * TERUKUR sebelum diperbaiki, sebagai kasir:
 *
 *     POST /print/lan {host:"192.0.2.2", port:9100}
 *     → "Gagal mencetak ke 192.0.2.2:9100 — connect ECONNREFUSED 192.0.2.2:9100."
 *
 * Teks itu milik Node, bukan milik kami. Yang keluar hari ini kebetulan tak
 * berbahaya; yang menentukan isinya besok bukan kami.
 *
 * BATAS PENJAGA INI, ditulis supaya "hijau" tak terbaca lebih luas: ia hanya
 * melihat `new HTTPException`. Medan galat yang dibalas lewat `c.json` biasa
 * (mis. `alasan` per baris pada impor) TIDAK terlihat di sini — yang menjaganya
 * §225 verify-api. Ia juga tak mengukur seberapa banyak yang bocor, cuma
 * apakah teksnya milik kita.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/**
 * Berkas yang BOLEH menyisipkan teks galat sistem, berikut alasannya.
 *
 * `admin-system` dipasang di belakang `requireSuperAdmin` (lihat `app.ts`:
 * `.use("/admin/*", requireAuth, requireSuperAdmin)`), jadi pembacanya operator
 * platform — orang yang memang perlu melihat galat migrasi, `pg_dump`, dan uji
 * SMTP apa adanya. Menyembunyikannya dari dia bukan keamanan, cuma menyulitkan.
 *
 * Gerbangnya TIDAK dipercaya begitu saja: uji di bawah membaca `app.ts` dan
 * menuntut `requireSuperAdmin` masih terpasang pada `/admin/*`. Kalau kelak
 * dilepas, pengecualian ini ikut merah — bukan diam-diam jadi izin terbuka.
 */
const BOLEH = new Set(["modules/admin-system/routes.ts"]);

function seimbang(s: string, i: number): string {
  let dalam = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === "(") dalam += 1;
    else if (s[j] === ")") {
      dalam -= 1;
      if (dalam === 0) return s.slice(i + 1, j);
    }
  }
  return "";
}

const PANGGIL = /new HTTPException\s*\(/g;
const SISIP = /\$\{([^}]*)\}/g;
/** Ekspresi yang mengambil teks galat sistem. */
const GALAT = /\.message\b|String\(\s*[a-z]\w*\s*\)|\bcause\b/i;

export function membocorkan(kode?: { nama: string; isi: string }[]): string[] {
  const berkas =
    kode ?? berkasTs(SRC).map((p) => ({ nama: p.slice(SRC.length + 1), isi: readFileSync(p, "utf8") }));
  const keluar: string[] = [];
  for (const { nama, isi } of berkas) {
    if (BOLEH.has(nama)) continue;
    // Variabel yang ISINYA teks galat — tanpa ini `const pesan = e.message`
    // lalu `${pesan}` tak terlihat sama sekali. Kebutaan itu nyata: sapuan
    // versi ketiga melewatkan `print/routes.ts`, dan yang menemukannya tangan.
    const dariGalat = new Set(
      [...isi.matchAll(/const\s+(\w+)\s*=\s*[^;]*?(?:\.message\b|String\(\s*[a-z]\w*\s*\))/g)].map(
        (m) => m[1],
      ),
    );
    for (const m of isi.matchAll(PANGGIL)) {
      const badan = seimbang(isi, m.index! + m[0].length - 1);
      const sisip = [...badan.matchAll(SISIP)].map((x) => x[1].trim());
      const bocor = sisip.some((x) => GALAT.test(x) || (/^\w+$/.test(x) && dariGalat.has(x)));
      if (bocor) keluar.push(`${nama}:${isi.slice(0, m.index!).split("\n").length}`);
    }
  }
  return keluar;
}

describe("pesan galat yang sampai ke penyewa ditulis kita sendiri", () => {
  it("premis: pemindainya benar-benar menemukan HTTPException di kode", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat penjaganya hijau dengan
    // hitungan nol — izin terbuka, bukan penjagaan.
    const semua = berkasTs(SRC).flatMap((p) => [...readFileSync(p, "utf8").matchAll(PANGGIL)]);
    expect(semua.length).toBeGreaterThan(300);
  });

  it("INTI: tak ada pesan HTTPException yang membawa teks galat sistem", () => {
    expect(
      membocorkan(),
      "pesan ini meneruskan teks galat pustaka apa adanya ke klien. Yang " +
        "keluar hari ini mungkin tak berbahaya, tapi yang menentukan isinya " +
        "besok bukan kita — pesan drizzle memuat kueri penuh beserta " +
        "parameternya. Terjemahkan ke kata-kata sendiri (lihat " +
        "`sebabGagalCetak` di modules/print/routes.ts)",
    ).toEqual([]);
  });

  it("pengecualian `admin-system` masih benar-benar digerbang super admin", () => {
    // Pengecualiannya bersandar PENUH pada gerbang ini. Kalau gerbangnya
    // dilepas, pengecualian yang menggantung berubah jadi kebocoran ke seluruh
    // penyewa — dan tak ada yang menyadarinya.
    const app = readFileSync(join(SRC, "app.ts"), "utf8");
    expect(app, "gerbang super admin pada /admin/* hilang — cabut BOLEH").toMatch(
      /\.use\(\s*"\/admin\/\*"\s*,\s*requireAuth\s*,\s*requireSuperAdmin\s*\)/,
    );
    for (const f of BOLEH) {
      expect(app, `${f} tak lagi dipasang di bawah /admin/*`).toContain("/admin/sistem");
    }
  });

  it("onError global tak boleh membocorkan galat tak tertangani", () => {
    // Pintu terakhir, dan yang paling luas: satu perubahan di sini membocorkan
    // SETIAP rute sekaligus.
    const app = readFileSync(join(SRC, "app.ts"), "utf8");
    expect(app).toContain('return c.json({ error: "Terjadi kesalahan pada server" }, 500);');
    expect(app, "onError tak boleh menaruh err.message pada balasan 500").not.toMatch(
      /c\.json\(\s*\{\s*error:\s*err\.message[^}]*\}\s*,\s*500\s*\)/,
    );
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh yang benar", () => {
    const buat = (isi: string) => membocorkan([{ nama: "uji.ts", isi }]);
    expect(buat("throw new HTTPException(500, { message: `Gagal: ${e.message}` });")).toHaveLength(1);
    expect(buat("throw new HTTPException(500, { message: `Gagal: ${String(e)}` });")).toHaveLength(1);
    // …lewat variabel perantara — bentuk yang meloloskan `print/routes.ts`.
    expect(
      buat("const pesan = e instanceof Error ? e.message : String(e);\nthrow new HTTPException(502, { message: `X ${pesan}` });"),
      "teks galat lewat variabel harus tetap tertuduh",
    ).toHaveLength(1);
    // Nilai dari pengirim sendiri, dan konstanta kita: aman.
    expect(buat("throw new HTTPException(404, { message: `Bahan ${nama} tak ada` });")).toHaveLength(0);
    expect(buat("throw new HTTPException(400, { message: `Maksimal ${BATAS} baris` });")).toHaveLength(0);
    // Pesan tanpa sisipan sama sekali.
    expect(buat('throw new HTTPException(404, { message: "Tidak ditemukan" });')).toHaveLength(0);
  });
});
