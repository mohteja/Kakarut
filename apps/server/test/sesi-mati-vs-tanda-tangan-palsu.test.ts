/**
 * SESI YANG HABIS UMURNYA vs TOKEN YANG BUKAN TERBITAN KITA.
 *
 * Diukur dari panel Log Galat production 2026-09-02: 1.744 penolakan 4xx dalam
 * 7 hari, NOL 5xx, seluruhnya `401 Token tidak valid atau kedaluwarsa`,
 * terpecah jadi 157 kelompok. Sebabnya bukan bug — token hidup 12 jam tanpa
 * refresh, jadi tiap sesi mati tepat waktu, dan tiap kematian melahirkan
 * belasan baris karena semua kueri klien berangkat serentak membawa token yang
 * sama.
 *
 * Yang RUSAK bukan angkanya, melainkan apa yang tak bisa lagi dilihat di
 * antaranya. `requireAuth` menangkap `catch {` tanpa mengikat galatnya, jadi
 * DUA peristiwa yang menuntut reaksi berlawanan menulis baris yang identik:
 *
 *   · `TokenExpiredError` — rutin, tak perlu ditindaklanjuti;
 *   · tanda tangan asing — seseorang menyodorkan token terbitan kunci lain,
 *     persis yang `algorithms: ["HS256"]` dipasang untuk menolak.
 *
 * Status sama, pesan sama, `sidikGalat` sama. Maka satu percobaan pemalsuan
 * akan tenggelam di antara 1.744 baris rutin, di panel yang justru dibangun
 * untuk menemukannya.
 *
 * Yang dipaku di sini: kedua sebab punya PESAN yang berbeda, dan karena itu
 * SIDIK JARI yang berbeda — sidik jari dihitung dengan fungsi sungguhan, bukan
 * ditiru. Lengan HTTP-nya ada di §287 `verify-api.sh` (token benar-benar
 * ditandatangani ulang, bukan dikarang).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { sidikGalat } from "../src/lib/error-log";

const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const AUTH = baca("../src/middleware/auth.ts");
const KODE = butaKomentar(AUTH);

/** Blok `try { jwt.verify … } catch` saja — bukan seluruh berkas. */
const iVerify = KODE.indexOf("jwt.verify(");
const iSesudah = KODE.indexOf("const [u] = await db", iVerify);
const BLOK = KODE.slice(iVerify, iSesudah);

const PESAN_KEDALUWARSA = "Sesi kedaluwarsa — silakan masuk kembali";
const PESAN_TAK_VALID = "Token tidak valid";

describe("401: sesi kedaluwarsa dan tanda tangan palsu tak lagi menulis baris yang sama", () => {
  it("premis: blok yang diiris memang blok verifikasi tokennya", () => {
    expect(iVerify, "premis: `jwt.verify(` ada di auth.ts").toBeGreaterThan(-1);
    expect(iSesudah, "premis: pembacaan baris user ada SESUDAHnya").toBeGreaterThan(iVerify);
    expect(BLOK).toContain('algorithms: ["HS256"]');
  });

  it("galatnya DIIKAT, bukan dibuang — `catch {` telanjang sudah tak ada", () => {
    // Inilah cacat aslinya: tanpa mengikat `e`, kelas galat dari `jsonwebtoken`
    // hilang di titik ini dan tak pernah tiba di `catatGalat`.
    expect(BLOK, "catch telanjang: kelas galatnya dibuang sebelum sempat dibaca").not.toMatch(
      /catch\s*\{/,
    );
    expect(BLOK).toMatch(/catch\s*\(\s*e\s*\)/);
    expect(BLOK).toContain("jwt.TokenExpiredError");
  });

  it("dua sebab → dua pesan, dan keduanya tetap 401", () => {
    expect(BLOK).toContain(PESAN_KEDALUWARSA);
    expect(BLOK).toContain(PESAN_TAK_VALID);
    // Kelasnya tidak boleh turun jadi 403/400: yang berubah kalimatnya, bukan
    // keputusannya. Dua `HTTPException(401` di dalam blok ini, tak lebih.
    expect(BLOK.match(/HTTPException\(401/g) ?? []).toHaveLength(2);
  });

  it("dan karena itu SIDIK JARINYA berbeda — dihitung, bukan ditebak", () => {
    const sidik = (pesan: string) => sidikGalat(401, "GET", "/api/auth/me", pesan);
    expect(sidik(PESAN_KEDALUWARSA)).not.toBe(sidik(PESAN_TAK_VALID));
  });

  it("PASANGAN: sidik jari tetap MENGGABUNG kejadian yang memang sama", () => {
    // Kalau pemisahan di atas dicapai dengan menaruh sesuatu yang unik per
    // permintaan ke dalam pesan (jam, id, nama), panelnya justru pecah jadi
    // ribuan kelompok — kebalikan dari gunanya. Pesan yang sama pada jalur
    // yang sama wajib tetap satu kelompok.
    const a = sidikGalat(401, "GET", "/api/auth/me", PESAN_KEDALUWARSA);
    const b = sidikGalat(401, "GET", "/api/auth/me", PESAN_KEDALUWARSA);
    expect(a).toBe(b);
  });

  it("kata `kedaluwarsa` dipertahankan — §287 memaku bunyi itu", () => {
    expect(PESAN_KEDALUWARSA.toLowerCase()).toContain("kedaluwarsa");
    // Dan cabang tanda-tangan-palsu justru TIDAK boleh memuatnya, kalau tidak
    // asersi §287 akan lolos untuk token yang bukan kedaluwarsa sama sekali.
    expect(PESAN_TAK_VALID.toLowerCase()).not.toContain("kedaluwarsa");
  });

  it("kontrak API menyebutkan kedua kalimatnya", () => {
    const kontrak = baca("../../../docs/API-CONTRACT.md");
    expect(kontrak).toContain(PESAN_KEDALUWARSA);
    expect(kontrak).toContain(PESAN_TAK_VALID);
  });
});
