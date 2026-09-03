/**
 * TOKEN YANG SUDAH MATI TIDAK PERNAH DITEMBAKKAN.
 *
 * Diukur di panel Log Galat production 2026-09-02: 1.744 penolakan 4xx dalam 7
 * hari, NOL 5xx, seluruhnya 401 dari token yang habis umurnya. Sebabnya bukan
 * polling yang merembes, melainkan KIPAS SERENTAK: saat sesi mati, semua kueri
 * yang terpasang berangkat dalam satu momen (penyegaran-saat-fokus react-query
 * — `refetchOnWindowFocus` tak pernah diset, jadi bawaannya `true`, dipasangkan
 * `staleTime: 10_000` global).
 *
 * Buktinya ada di data production sendiri: `/company` dan `/cabang` duduk
 * BERDAMPINGAN dengan `/kategori` di KasirPage, tapi NOL di log — bedanya cuma
 * `staleTime` 5 menit (`KUNCI_MASTER` di `main.tsx`). Sebaran 401-nya mengikuti
 * garis masa-basi, bukan garis interval.
 *
 * Karena keempat belas permintaan berangkat SEBELUM balasan pertama tiba,
 * penjaga sekali-jalan pada balasan tak bisa memotong apa pun. Satu-satunya
 * titik yang tersisa adalah sebelum permintaan dikirim — itulah yang dipaku di
 * sini. Lengan perambannya (nol permintaan sungguhan) ada di
 * `apps/web/e2e/token-mati-tak-ditembakkan.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MARGIN_MATI_MS, expTokenMs, tokenSudahMati } from "../../web/src/lib/umurToken";

const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/** JWT betulan bentuknya, ditandatangani asal — umurToken tak memeriksa tanda tangan. */
function jwtPalsu(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.tanda-tangan-tak-diperiksa`;
}

const JAM = 3_600_000;

describe("umurToken: aturannya, dan arah gagalnya", () => {
  it("membaca exp dari payload — termasuk yang memuat huruf beraksen", () => {
    const exp = Math.floor(Date.UTC(2026, 8, 3, 1, 20) / 1000);
    // Nama dengan aksen bukan hiasan: `atob` memulangkan byte, dan tanpa
    // penerjemahan UTF-8 satu nama seperti ini membuat JSON.parse melempar —
    // token yang SAH akan terbaca "tak terbaca".
    expect(expTokenMs(jwtPalsu({ exp, nama: "Café Sœur — Ñoño 中文" }))).toBe(exp * 1000);
  });

  it("token mati dinyatakan mati, token hidup tidak", () => {
    const sekarang = Date.UTC(2026, 8, 3, 8, 0);
    const mati = jwtPalsu({ exp: Math.floor((sekarang - 2 * JAM) / 1000) });
    const hidup = jwtPalsu({ exp: Math.floor((sekarang + 2 * JAM) / 1000) });
    expect(tokenSudahMati(mati, sekarang)).toBe(true);
    expect(tokenSudahMati(hidup, sekarang)).toBe(false);
  });

  it("marginnya SESUDAH exp — arah kekeliruannya dipilih, bukan kebetulan", () => {
    const sekarang = Date.UTC(2026, 8, 3, 8, 0);
    // Baru saja lewat exp: BELUM dinyatakan mati (paling buruk satu permintaan
    // sia-sia). Kalau marginnya dipasang sebelum exp, kasir dikeluarkan dari
    // sesi yang masih sah — kekeliruan yang jauh lebih mahal.
    const baruLewat = jwtPalsu({ exp: Math.floor((sekarang - 1_000) / 1000) });
    expect(tokenSudahMati(baruLewat, sekarang)).toBe(false);
    const lewatJauh = jwtPalsu({ exp: Math.floor((sekarang - MARGIN_MATI_MS - 5_000) / 1000) });
    expect(tokenSudahMati(lewatJauh, sekarang)).toBe(true);
  });

  it("yang TAK TERBACA dianggap masih hidup — server tetap otoritasnya", () => {
    const sekarang = Date.UTC(2026, 8, 3, 8, 0);
    for (const aneh of ["", "bukan-jwt", "a.b", "a.b.c.d", jwtPalsu({ sub: "tanpa-exp" })]) {
      expect(tokenSudahMati(aneh, sekarang), `token: ${aneh.slice(0, 12)}`).toBe(false);
    }
    expect(expTokenMs(jwtPalsu({ exp: "besok" }))).toBeNull();
  });
});

describe("api.ts memasang gerbangnya SEBELUM fetch, bukan sesudah balasan", () => {
  const API = baca("../../web/src/lib/api.ts");
  const iFetch = API.indexOf("res = await fetch(");
  const iAuth = API.indexOf("const auth = loadAuth();", API.indexOf("bacaHeader?:"));

  it("premis: irisannya memang badan pengirim permintaan", () => {
    expect(iAuth).toBeGreaterThan(-1);
    expect(iFetch).toBeGreaterThan(iAuth);
  });

  it("gerbangnya berada di antara pembacaan sesi dan fetch", () => {
    const sebelumKirim = API.slice(iAuth, iFetch);
    expect(sebelumKirim).toContain("tokenSudahMati(auth.token, waktuServerKira())");
    expect(sebelumKirim).toContain("umumkanSesiMati()");
  });

  it("jam server dipungut dari header Date, bukan dipercayakan ke jam perangkat", () => {
    expect(API).toContain('catatJamServer(res.headers.get("Date"))');
    expect(API).toContain("Date.now() + selisihJamMs");
  });

  it("satu sesi mati = satu perpindahan halaman, bukan satu per permintaan", () => {
    // Palangnya, dan hanya SATU tempat yang menulis location.href untuk sesi.
    expect(API).toContain("let sesiMatiSudahDiumumkan = false;");
    expect(API.match(/window\.location\.href = `\/login\?\$\{PARAM_SESI\}/g) ?? []).toHaveLength(1);
    // Masuk ulang membuka palangnya lagi.
    expect(API).toContain("sesiMatiSudahDiumumkan = false;\n  } else hapusLokal(STORAGE_KEY);");
  });
});

describe("PASANGAN: jalur /auth publik tidak digerbangi — dan daftarnya diadu ke server", () => {
  const API = baca("../../web/src/lib/api.ts");
  const RUTE = baca("../src/modules/auth/routes.ts");

  it("hanya /auth/me yang membawa sesi di server, dan daftar web menyebut persis itu", () => {
    // Diadu ke SUMBER, bukan ke ingatan: kalau kelak lahir rute ber-sesi baru
    // di bawah /auth, uji ini memerah dan daftar di web wajib ditinjau —
    // menggerbangi jalur pemulihan akses akan mengunci justru orang yang
    // tokennya mati.
    const bersesi = [...RUTE.matchAll(/\.(?:get|post|patch|put|delete)\(\s*"(\/[^"]*)"\s*,\s*requireAuth/g)]
      .map((m) => m[1])
      .sort();
    expect(bersesi, "premis: sapuannya menemukan sesuatu").not.toHaveLength(0);
    expect(bersesi).toEqual(["/me"]);
    expect(API).toContain('const JALUR_AUTH_BERSESI = new Set(["/auth/me"]);');
  });

  it("dan gerbangnya memang melewati jalur /auth lain", () => {
    expect(API).toContain('!bersih.startsWith("/auth/") || JALUR_AUTH_BERSESI.has(bersih)');
  });
});
