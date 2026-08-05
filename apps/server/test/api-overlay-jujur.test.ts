import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga OVERLAY "SERVER SEDANG DIPERBARUI" — jangan menyatakan sehat saat
 * jawabannya tak terbaca.
 *
 * `api()` adalah satu-satunya pintu ke server untuk SELURUH halaman, dan
 * `emitServerDown(false)` di dalamnya adalah pernyataan "server menjawab
 * dengan baik" yang menutup overlay.
 *
 * `res.ok` cuma berarti statusnya 2xx — belum berarti yang datang adalah
 * jawaban aplikasi ini. Kasus nyatanya: reverse-proxy yang melayani shell SPA
 * (`index.html`) untuk path tak dikenal membalas **200 + HTML** ketika
 * `/api/*` salah rute atau sedang re-deploy. Bentuk itu justru yang paling
 * mirip "server sedang diperbarui" — dan dulu ia MENUTUP overlaynya, lalu
 * melempar `SyntaxError` mentah ("Unexpected token '<'").
 *
 * Jadi satu-satunya jalur yang ada untuk mengabari pengguna bahwa server tak
 * bisa dipakai justru menyatakan semuanya baik-baik saja tepat ketika ia
 * menerima sesuatu yang tak ia mengerti.
 */
const API = readFileSync(
  fileURLToPath(new URL("../../web/src/lib/api.ts", import.meta.url)),
  "utf8",
);

describe("urutan: badan dibaca dulu, overlay ditutup sesudahnya", () => {
  it("`res.json()` dibungkus try/catch, bukan dipanggil telanjang", () => {
    expect(API).toContain("    data = (await res.json()) as T;");
    expect(API).toContain("  } catch {\n    emitServerDown(true);");
  });

  it("gagal-parse dinyatakan sebagai server tak terjangkau", () => {
    // Pesannya sengaja SAMA dengan jalur gagal jaringan: bagi pemakainya
    // keduanya memang kejadian yang sama.
    const jumlah = API.split(
      '"Tidak dapat terhubung ke server. Mungkin sedang diperbarui."',
    ).length - 1;
    expect(jumlah, "pesan server-down harus dipakai di KEDUA jalur").toBe(2);
  });

  it("`emitServerDown(false)` berada SESUDAH parse berhasil", () => {
    const iParse = API.indexOf("data = (await res.json()) as T;");
    const iTutup = API.lastIndexOf("emitServerDown(false);");
    expect(iParse).toBeGreaterThan(0);
    expect(iTutup).toBeGreaterThan(iParse);
  });

  it("dan yang dipulangkan adalah nilai yang sudah ter-parse", () => {
    expect(API).toContain("  return data;");
    expect(API).not.toContain("return (await res.json()) as T;");
  });
});

describe("sifat yang sudah benar dan jangan sampai hilang", () => {
  it("gagal jaringan tetap menyalakan overlay", () => {
    expect(API).toContain("  } catch {\n    // gagal jaringan → server tak terjangkau");
  });

  it("404/5xx non-JSON tetap dianggap server bermasalah", () => {
    expect(API).toContain(
      "if (!isJsonError && (res.status === 404 || res.status >= 500)) {",
    );
  });

  it("401 di luar login tetap memaksa login ulang", () => {
    expect(API).toContain('if (res.status === 401 && !path.startsWith("/auth/login")) {');
  });

  it("galat aplikasi ber-JSON tetap memakai pesan aslinya dari server", () => {
    expect(API).toContain("        message = data.error;");
    expect(API).toContain("        isJsonError = true;");
  });

  it("sebabnya ditulis supaya urutannya tak 'dirapikan' kembali", () => {
    expect(API).toContain("Badan dibaca DULU, overlay ditutup SESUDAHNYA");
    expect(API).toContain("200 + HTML");
  });
});
