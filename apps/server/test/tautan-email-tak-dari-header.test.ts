import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const baca = (p: string) => butaKomentar(readFileSync(`${SRC}/${p}`, "utf8"));

/** Konteks Hono palsu — cuma header yang dibaca `appBaseUrl`. */
function ctx(h: Record<string, string>) {
  return { req: { header: (n: string) => h[n.toLowerCase()] } } as never;
}

/**
 * TAUTAN EMAIL TAK BOLEH LAHIR DARI HEADER YANG DIKENDALIKAN PEMINTA.
 *
 * TEREPRODUKSI lewat HTTP (2026-08-26), dan ini bukan phishing melainkan
 * pengambilalihan akun:
 *
 *   POST /api/auth/forgot-password   Host: penyerang.example
 *   -> {"dev_reset_url":"http://penyerang.example/reset-password?token=a9c078..."}
 *
 *   ...dan lewat X-Forwarded-Host, protonya ikut ditempa:
 *   -> "https://penyerang.example/reset-password?token=e7fc51..."
 *
 * Tokennya HIDUP dan milik korban. Surat mendarat di kotak masuk korban,
 * tampak sah, dan sekali diklik tokennya berpindah tangan.
 *
 * Pintu yang sama dipakai EMPAT tautan: reset password, verifikasi email
 * (x2), dan undangan karyawan.
 *
 * Penawarnya konfigurasi, dan kode membuat konfigurasi berkuasa:
 *   1. APP_BASE_URL       -> dipakai apa adanya, header diabaikan total
 *   2. APP_HOST_DIPERCAYA -> host header wajib ada di daftar; kalau tidak,
 *                            entri pertama (domain kanonik) yang dipakai
 *   3. keduanya kosong    -> perilaku lama (satu-satunya yang bekerja di
 *                            dev/lokal), TAPI dilaporkan `kritis` ke panel
 *                            super admin
 *
 * Kenapa nomor 3 tidak dibuat keras: bila produksi belum menyetel apa pun,
 * menolak menurunkan dari header membuat SELURUH tautan menunjuk `localhost`
 * — menukar lubang yang butuh penyerang dengan kerusakan yang pasti.
 */
describe("tautan email tak lahir dari header peminta", () => {
  const asli = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...asli };
    vi.resetModules();
  });

  const muat = () => import("../src/lib/base-url");

  it("APP_BASE_URL menang — header diabaikan TOTAL", async () => {
    process.env.APP_BASE_URL = "https://kanonik.kakarut.id";
    const { appBaseUrl } = await muat();
    expect(
      appBaseUrl(ctx({ host: "penyerang.example", "x-forwarded-proto": "https" })),
      "host tempaan menembus APP_BASE_URL",
    ).toBe("https://kanonik.kakarut.id");
    expect(appBaseUrl(ctx({ "x-forwarded-host": "penyerang.example" }))).toBe(
      "https://kanonik.kakarut.id",
    );
  });

  it("APP_HOST_DIPERCAYA: host asing ditolak, host sah dihormati", async () => {
    process.env.APP_HOST_DIPERCAYA = "app.kakarut.id, kakarut.id";
    const { appBaseUrl } = await muat();
    expect(appBaseUrl(ctx({ host: "penyerang.example" }))).toBe("https://app.kakarut.id");
    expect(appBaseUrl(ctx({ "x-forwarded-host": "penyerang.example" }))).toBe(
      "https://app.kakarut.id",
    );
    // PASANGAN: host yang MEMANG sah tetap dipakai — pemasangan multi-domain
    // tak boleh ikut dimatikan oleh perbaikan ini.
    expect(
      appBaseUrl(ctx({ "x-forwarded-host": "kakarut.id", "x-forwarded-proto": "https" })),
      "host yang sah ikut ditolak — multi-domain mati",
    ).toBe("https://kakarut.id");
  });

  it("keduanya kosong: perilaku lama DIPERTAHANKAN, tapi dilaporkan", async () => {
    delete process.env.APP_BASE_URL;
    delete process.env.APP_HOST_DIPERCAYA;
    const { appBaseUrl, tautanEmailDariHeader } = await muat();
    expect(appBaseUrl(ctx({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(tautanEmailDariHeader(), "keadaan berbahaya tak dilaporkan").toBe(true);
  });

  it("temuan HILANG begitu disetel — bukan omelan permanen", async () => {
    process.env.APP_BASE_URL = "https://kanonik.kakarut.id";
    expect((await muat()).tautanEmailDariHeader()).toBe(false);
    vi.resetModules();
    delete process.env.APP_BASE_URL;
    process.env.APP_HOST_DIPERCAYA = "app.kakarut.id";
    expect((await muat()).tautanEmailDariHeader()).toBe(false);
  });

  it("keadaan berbahaya dilaporkan `kritis` ke panel super admin", () => {
    const p = baca("lib/pemeriksaan-setelan.ts");
    expect(p).toContain('kode: "tautan_email_dari_header"');
    expect(p).toContain("tautanEmailDariHeader()");
    expect(p, "tindakannya tak menyebut env yang harus disetel").toMatch(/APP_BASE_URL/);
  });

  it("tak ada pembangun tautan email KEDUA yang melewati rumahnya", () => {
    const liar: string[] = [];
    for (const berkas of [
      "modules/auth/routes.ts",
      "modules/users/routes.ts",
      "modules/mail/service.ts",
    ]) {
      const isi = baca(berkas);
      for (const m of isi.matchAll(/header\(\s*"(host|x-forwarded-host)"/gi)) {
        liar.push(`${berkas}:${isi.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(
      liar,
      "host dibaca langsung dari header di luar `lib/base-url` — pakai " +
        "`appBaseUrl(c)` supaya APP_BASE_URL/APP_HOST_DIPERCAYA tetap berkuasa",
    ).toEqual([]);
  });
});
