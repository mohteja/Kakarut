import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga SPINNER ABADI.
 *
 * Di React Query v5, bacaan yang GAGAL berakhir dengan `isLoading === false`
 * DAN `data === undefined`. Maka dua bentuk ini menunggu selamanya:
 *
 *     {isLoading || !data ? <Spinner /> : …}
 *     {!data ? <Spinner /> : …}
 *
 * Syaratnya tetap benar sesudah kegagalan, jadi spinnernya tak pernah berhenti.
 * Layarnya tak menyebut ada yang salah dan tak ada apa pun yang bisa ditekan —
 * satu-satunya jalan keluar adalah menutup modalnya dan menebak sendiri. Enam
 * tempat mengidapnya sekaligus (detail shift, dua detail opname, lot FIFO,
 * detail kebersihan, riwayat meja): bukan kelalaian satu orang, melainkan pola
 * yang tersalin.
 *
 * Gantinya `<SpinnerAtauGalat error={…} />` — berputar selagi dimuat, berhenti
 * dan menjelaskan begitu gagal.
 *
 * Yang dilarang hanya bentuk `!data ? <Spinner />`. `isLoading ? <Spinner />`
 * TANPA `!data` tetap sah: ia berhenti sendiri saat bacaannya gagal, lalu jatuh
 * ke cabang berikutnya — asalkan cabang berikutnya bukan klaim kosong palsu,
 * dan itu urusan penjaga lain.
 */
const akarWeb = fileURLToPath(new URL("../../web/src/", import.meta.url));

function berkasTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return berkasTsx(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

/**
 * `!<nama> ? (…) <Spinner />` — termasuk varian `isLoading || !data`.
 *
 * Pola ini SENDIRI tidak selalu salah: bila ada cabang galat yang mendahuluinya
 * dalam rantai ternary yang sama, spinnernya tak pernah tercapai sesudah gagal.
 * Yang diperiksa karena itu bukan bentuknya, melainkan syarat yang membuatnya
 * mungkin ditulis benar: query yang memberi makan `data` WAJIB ikut membaca
 * `error`. Tanpa itu tak ada bahan untuk cabang galat mana pun, dan spinner
 * abadi jadi satu-satunya hasil yang bisa terjadi.
 *
 * Memeriksa "adakah cabang galat di atasnya" lewat teks tak bisa diandalkan —
 * kalimatnya bebas ("tidak dapat dimuat", "gagal", "server tak menjawab") dan
 * penjaga yang menebak-nebak prosa akan berbohong ke dua arah.
 */
const SPINNER_MENUNGGU_DATA = /!\s*(\w+)\s*\?\s*\(?\s*\n?\s*<Spinner\s*\/>/g;

/**
 * Bentuk KEDUA, dan ini yang lolos dari penjaga versi pertama:
 *
 *     if (isLoading || !data) return <Spinner />;
 *
 * Sama persis akibatnya — bacaan gagal → `isLoading` false, `data` undefined →
 * berputar selamanya — tapi tak ada tanda tanya di dalamnya, jadi pola ternary
 * di atas tak pernah mengenainya. Enam halaman mengidapnya diam-diam
 * (riwayat harga, perusahaan, profil, dan tiga panel superadmin) SESUDAH kelas
 * ini saya nyatakan terkunci.
 *
 * Pelajarannya bukan "tambah satu regex": penjaga yang cuma mengunci SATU
 * penulisan dari sebuah kesalahan memberi rasa aman yang lebih berbahaya
 * daripada tak ada penjaga sama sekali, karena kelasnya dilaporkan beres.
 */
const SPINNER_RETURN_AWAL = /if\s*\([^)]*?!\s*(\w+)[^)]*\)\s*return\s*<Spinner\s*\/>/g;

/** Nama yang di-bind ke `data` pada tiap `useQuery`, + apakah `error` dibaca. */
function queryPerBerkas(isi: string): Map<string, boolean> {
  const hasil = new Map<string, boolean>();
  for (const m of isi.matchAll(/(?:const|let)\s*(\{[^}]*\})\s*=\s*useQuery(?:<[^>]*>)?\(\{/g)) {
    const dest = m[1];
    const dm = /\bdata\s*(?::\s*(\w+))?/.exec(dest);
    if (!dm) continue;
    hasil.set(dm[1] ?? "data", /\b(isError|error)\b/.test(dest));
  }
  return hasil;
}

describe("tak ada spinner abadi di web", () => {
  const pelanggar: string[] = [];
  for (const berkas of berkasTsx(akarWeb)) {
    const isi = readFileSync(berkas, "utf8");
    const query = queryPerBerkas(isi);
    for (const pola of [SPINNER_MENUNGGU_DATA, SPINNER_RETURN_AWAL]) {
      for (const m of isi.matchAll(pola)) {
        const nama = m[1];
        // Bukan dari useQuery (mis. state lokal) → bukan urusan penjaga ini.
        if (!query.has(nama)) continue;
        if (query.get(nama)) continue; // `error` dibaca → cabang galat mungkin
        const baris = isi.slice(0, m.index).split("\n").length;
        pelanggar.push(`${berkas.slice(akarWeb.length)}:${baris} (${nama})`);
      }
    }
  }

  it("setiap `!data ? <Spinner />` berasal dari query yang membaca `error`", () => {
    expect(pelanggar).toEqual([]);
  });

  it("penggantinya benar-benar ada dan menampilkan galat", () => {
    const ui = readFileSync(join(akarWeb, "components/ui.tsx"), "utf8");
    expect(ui).toContain("export function SpinnerAtauGalat");
    // Wajib menyerah saat ada galat, bukan tetap memutar spinner.
    const badan = ui.slice(ui.indexOf("export function SpinnerAtauGalat"));
    expect(badan).toMatch(/if\s*\(\s*!error\s*\)\s*return\s*<Spinner/);
  });
});
