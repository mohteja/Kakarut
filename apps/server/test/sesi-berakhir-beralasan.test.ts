import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * SESI YANG MATI DIKATAKAN SEBABNYA — di halaman yang benar-benar dilihat.
 *
 * `lib/api.ts` menjawab 401 di luar login dengan menghapus sesi lokal dan
 * memindahkan browser ke /login. Sampai 2026-09-02 ia melempar `ApiError`
 * "Sesi berakhir…" yang tak pernah dibaca siapa pun: `window.location.href`
 * sudah membuang dokumennya. Token kedaluwarsa, password diganti di perangkat
 * lain, akun dinonaktifkan — semua berakhir di layar login yang bisu. Diukur
 * di browser (e2e `sesi-berakhir.spec.ts`): URL /login, tanpa satu kalimat.
 *
 * Yang dijaga: (1) pemindahan itu MEMBAWA sebabnya lewat query (satu-satunya
 * yang selamat dari perpindahan dokumen penuh); (2) halaman login MEMBACA
 * query itu dan mengucapkan kalimat dari rumahnya, `lib/pesan-sesi.ts`; (3)
 * nama query & nilainya satu sumber di kedua sisi — bukan dua string yang
 * pelan-pelan menyimpang.
 */
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const baca = (p: string) => butaKomentar(readFileSync(`${WEB}/${p}`, "utf8"));

describe("401 sampai ke layar login DENGAN sebabnya", () => {
  const api = baca("lib/api.ts");
  const login = baca("pages/LoginPage.tsx");
  const rumah = baca("lib/pesan-sesi.ts");

  it("rumah kalimatnya ada, dan kalimatnya menyebut 'masuk kembali'", () => {
    expect(rumah).toMatch(/export const PESAN_SESI_BERAKHIR/);
    expect(rumah).toMatch(/masuk kembali/i);
    expect(rumah).toMatch(/export const PARAM_SESI/);
    expect(rumah).toMatch(/export const NILAI_SESI_BERAKHIR/);
  });

  it("api.ts memindahkan ke /login MEMBAWA sebabnya (dari rumah, bukan string lepas)", () => {
    // Cabang 401-nya masih ada — kalau kelak dipindah ke tempat lain, uji ini
    // harus ikut pindah, bukan hijau karena tak menemukan apa pun.
    expect(api).toMatch(/res\.status === 401/);
    expect(api).toContain("/login?${PARAM_SESI}=${NILAI_SESI_BERAKHIR}");
    expect(api).toContain('from "./pesan-sesi"');
  });

  it("halaman login membaca query itu dan mengucapkan kalimat rumahnya", () => {
    expect(login).toContain("useSearchParams");
    expect(login).toContain("params.get(PARAM_SESI) === NILAI_SESI_BERAKHIR");
    expect(login).toContain("{PESAN_SESI_BERAKHIR}");
    expect(login).toContain('from "../lib/pesan-sesi"');
  });

  it("tak ada string '?sesi=' lepas di luar rumahnya", () => {
    // Nama query yang diketik ulang di tempat lain adalah salinan yang akan
    // menyimpang; nilainya wajib lewat konstanta.
    expect(api).not.toMatch(/\?sesi=/);
    expect(login).not.toMatch(/["'`]berakhir["'`]/);
  });
});
