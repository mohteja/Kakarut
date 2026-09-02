import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { jalurDokumen, redirectKanonik, tujuanKanonik } from "../src/lib/host-kanonik";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * SATU ASAL UNTUK SATU SESI — alias `www.`/`http` dialihkan ke asal kanonik.
 *
 * Diukur di peramban 2026-09-02 pada asal yang SAMA: tab baru yang membuka `/`
 * atau `/login` saat sesi ada langsung mendarat di beranda. Yang dilaporkan
 * pemilik repo justru terjadi di production: login di satu tab, tab lain ke
 * terakasir.com → halaman depan, tombol Masuk menerima akun lain. Sesi web
 * hidup di localStorage yang PER ASAL, dan Chrome menyembunyikan `www.` di
 * bilah alamat — dua asal yang tampak satu.
 *
 * Yang dijaga: (1) alias yang dikenal dialihkan dengan jalur+query utuh;
 * (2) yang BUKAN alias tak pernah dialihkan — termasuk saat konfigurasi kosong
 * (tebakan yang salah membuat situs tak terjangkau); (3) `/api`, aset, dan
 * selain GET/HEAD tak tersentuh — klien ponsel memanggil `/api` di host mana pun
 * yang dikonfigurasi, dan 301 pada POST mengubah metode.
 */
const K = { baseUrl: "https://terakasir.com", dipercaya: [] as string[] };
const r = (host: string, path = "/", proto = "https", query = "") => ({ proto, host, path, query });

describe("tujuanKanonik — alias ↔ kanonik", () => {
  it("www → tanpa www, jalur & query utuh", () => {
    expect(tujuanKanonik(r("www.terakasir.com", "/dashboard", "https", "x=1"), K)).toBe(
      "https://terakasir.com/dashboard?x=1",
    );
  });

  it("tanpa www → www bila kanoniknya www", () => {
    expect(tujuanKanonik(r("terakasir.com"), { baseUrl: "https://www.terakasir.com", dipercaya: [] })).toBe(
      "https://www.terakasir.com/",
    );
  });

  it("http pada host kanonik dinaikkan ke https; https tak pernah diturunkan", () => {
    expect(tujuanKanonik(r("terakasir.com", "/login", "http"), K)).toBe("https://terakasir.com/login");
    expect(
      tujuanKanonik(r("terakasir.com", "/", "https"), { baseUrl: "http://terakasir.com", dipercaya: [] }),
    ).toBeNull();
  });

  it("sudah kanonik → null (tak ada lingkaran pengalihan)", () => {
    expect(tujuanKanonik(r("terakasir.com", "/", "https"), K)).toBeNull();
    expect(tujuanKanonik(r("TeraKasir.com", "/", "HTTPS"), K)).toBeNull();
  });

  it("host asing BUKAN alias → null, walau kanonik dikonfigurasi", () => {
    expect(tujuanKanonik(r("penyerang.example"), K)).toBeNull();
    expect(tujuanKanonik(r("localhost:3000", "/", "http"), K)).toBeNull();
  });

  it("host di APP_HOST_DIPERCAYA adalah alias; entri pertama = kanonik bila APP_BASE_URL kosong", () => {
    const k = { dipercaya: ["terakasir.com", "terakasir.app"] };
    expect(tujuanKanonik(r("terakasir.app", "/kasir"), k)).toBe("https://terakasir.com/kasir");
    expect(tujuanKanonik(r("terakasir.com", "/kasir"), k)).toBeNull();
  });

  it("TANPA konfigurasi tak ada pengalihan sama sekali — kanonik tak ditebak", () => {
    const kosong = { dipercaya: [] };
    expect(tujuanKanonik(r("www.terakasir.com"), kosong)).toBeNull();
    expect(tujuanKanonik(r("terakasir.com", "/", "http"), kosong)).toBeNull();
    expect(tujuanKanonik(r("www.terakasir.com"), { baseUrl: "bukan url", dipercaya: [] })).toBeNull();
  });
});

describe("jalurDokumen — yang boleh dialihkan hanya navigasi dokumen", () => {
  it.each(["/", "/index.html", "/login", "/dashboard", "/resep"])("dokumen: %s", (p) => {
    expect(jalurDokumen(p)).toBe(true);
  });
  it.each([
    "/api",
    "/api/health",
    "/api/auth/login",
    "/uploads/x.png",
    "/assets/index-abc.js",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/robots.txt",
  ])("bukan dokumen: %s", (p) => {
    expect(jalurDokumen(p)).toBe(false);
  });
});

describe("redirectKanonik — di dalam Hono sungguhan", () => {
  const app = new Hono();
  app.use("*", redirectKanonik(() => K));
  app.get("/", (c) => c.text("shell"));
  app.get("/dashboard", (c) => c.text("shell"));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/auth/login", (c) => c.json({ ok: true }));
  // POST ke jalur DOKUMEN (bukan /api): satu-satunya yang benar-benar menguji
  // penjaga metode — /api sudah dikecualikan oleh aturan awalan.
  app.post("/dashboard", (c) => c.text("kiriman"));
  app.get("/assets/app.js", (c) => c.text("js"));

  it("GET / lewat www → 301 ke asal kanonik, Cache-Control no-cache", async () => {
    const res = await app.request("/dashboard?tab=1", { headers: { host: "www.terakasir.com" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://terakasir.com/dashboard?tab=1");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("header proxy (X-Forwarded-Host/Proto) didahulukan dari Host", async () => {
    const res = await app.request("/", {
      headers: { host: "127.0.0.1:3000", "x-forwarded-host": "www.terakasir.com", "x-forwarded-proto": "https" },
    });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://terakasir.com/");
  });

  it("HEAD ikut dialihkan; POST tidak", async () => {
    const head = await app.request("/", { method: "HEAD", headers: { host: "www.terakasir.com" } });
    expect(head.status).toBe(301);
    const post = await app.request("/api/auth/login", { method: "POST", headers: { host: "www.terakasir.com" } });
    expect(post.status).toBe(200);
    const postDokumen = await app.request("/dashboard", { method: "POST", headers: { host: "www.terakasir.com" } });
    expect(postDokumen.status, "POST ke jalur dokumen lewat alias tak boleh dialihkan").toBe(200);
  });

  it("/api dan /assets lewat www TETAP dilayani — bukan dialihkan", async () => {
    const api = await app.request("/api/health", { headers: { host: "www.terakasir.com" } });
    expect(api.status).toBe(200);
    const aset = await app.request("/assets/app.js", { headers: { host: "www.terakasir.com" } });
    expect(aset.status).toBe(200);
  });

  it("host kanonik → dilayani biasa (200)", async () => {
    const res = await app.request("/", { headers: { host: "terakasir.com", "x-forwarded-proto": "https" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("shell");
  });

  it("konfigurasi kosong → tak ada yang dialihkan", async () => {
    const polos = new Hono();
    polos.use("*", redirectKanonik(() => ({ dipercaya: [] })));
    polos.get("/", (c) => c.text("shell"));
    const res = await polos.request("/", { headers: { host: "www.terakasir.com" } });
    expect(res.status).toBe(200);
  });
});

describe("redirectKanonik() bawaan membaca env — bukan konfigurasi yang disuntik saja", () => {
  // Pola `tautan-email-tak-dari-header.test.ts`: env diatur, modul dimuat ulang.
  const asli = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...asli };
    vi.resetModules();
  });

  it("APP_BASE_URL di env → alias www dialihkan tanpa konfigurasi disuntik", async () => {
    process.env.APP_BASE_URL = "https://terakasir.com";
    delete process.env.APP_HOST_DIPERCAYA;
    const { redirectKanonik: rk } = await import("../src/lib/host-kanonik");
    const app = new Hono();
    app.use("*", rk());
    app.get("/", (c) => c.text("shell"));
    const res = await app.request("/", { headers: { host: "www.terakasir.com" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://terakasir.com/");
  });

  it("env kosong → dilayani biasa (tak ada tebakan)", async () => {
    delete process.env.APP_BASE_URL;
    delete process.env.APP_HOST_DIPERCAYA;
    const { redirectKanonik: rk } = await import("../src/lib/host-kanonik");
    const app = new Hono();
    app.use("*", rk());
    app.get("/", (c) => c.text("shell"));
    const res = await app.request("/", { headers: { host: "www.terakasir.com" } });
    expect(res.status).toBe(200);
  });
});

describe("dipasang di index.ts SEBELUM shell SPA dilayani", () => {
  const INDEX = butaKomentar(
    readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8"),
  );
  it("app.use(\"*\", redirectKanonik()) mendahului app.get(\"/\", kirimShell) dan serveStatic", () => {
    const pasang = INDEX.indexOf('app.use("*", redirectKanonik());');
    const shell = INDEX.indexOf('app.get("/", kirimShell);');
    const statis = INDEX.indexOf('app.use("/*", serveStatic(');
    expect(pasang, "middleware tak terpasang").toBeGreaterThan(-1);
    expect(shell, "premis: shell dilayani").toBeGreaterThan(-1);
    expect(statis, "premis: serveStatic ada").toBeGreaterThan(-1);
    expect(pasang).toBeLessThan(shell);
    expect(pasang).toBeLessThan(statis);
  });
});
