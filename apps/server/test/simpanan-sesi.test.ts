import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { __resetSimpanan, bacaLokal, hapusLokal, tulisLokal } from "../../web/src/lib/simpanan";

/**
 * Penjaga PENYIMPANAN LOKAL YANG BOLEH GAGAL.
 *
 * Temuannya bukan "ada `localStorage` tanpa `try`". Temuannya ini:
 *
 *   `api()` mengambil tokennya dari `loadAuth()` — jadi PENYIMPANAN, bukan
 *   state React, yang jadi sumber kebenaran sesi.
 *
 * Repo sudah menganggap penyimpanan bisa gagal: `loadAuth`,
 * `loadPrinterSettings`, dan pilihan tampilan kasir semuanya dibungkus
 * `try`/`catch`. Tapi penjagaannya berhenti di sisi BACA — dan justru sisi
 * baca yang terjaga itulah yang mengantar pemakainya sampai ke sisi tulis
 * yang telanjang:
 *
 *   sesi gagal dibaca → `null` → layar login → password BENAR, server
 *   menerima → penulisan sesi melempar → tak ada sesi terpasang → permintaan
 *   berikutnya berangkat tanpa `Authorization` → 401 → dilempar ke /login.
 *
 * Kasir berputar di layar login yang setiap kali menerima passwordnya dengan
 * benar. Karena itu `try`/`catch` saja tidak cukup: ia hanya mengganti bentuk
 * kegagalannya. Yang dibutuhkan CADANGAN DI MEMORI.
 *
 * Pemicunya nyata, bukan karangan: Safari dengan "Block All Cookies" membuat
 * `window.localStorage` melempar `SecurityError` saat PROPERTINYA dibaca —
 * bukan saat `setItem`. iPad kasir yang dipakai bergantian adalah persis
 * perangkat yang setelan privasinya tersentuh orang.
 *
 * Modul `simpanan.ts` sengaja ditulis tanpa `lib.dom` supaya berkas ini bisa
 * MENJALANKANNYA sungguhan — bukan sekadar membacanya sebagai teks.
 */

type Rak = Map<string, string>;

/** Penyimpanan sehat, seperti browser normal. */
function penyimpananSehat(rak: Rak) {
  return {
    getItem: (k: string) => rak.get(k) ?? null,
    setItem: (k: string, v: string) => void rak.set(k, v),
    removeItem: (k: string) => void rak.delete(k),
  };
}

function pasang(nilai: unknown) {
  Object.defineProperty(globalThis, "localStorage", {
    value: nilai,
    configurable: true,
    writable: true,
  });
}

/** Safari "Block All Cookies": GETTER-nya yang melempar. */
function pasangGetterMelempar() {
  Object.defineProperty(globalThis, "localStorage", {
    get() {
      throw new Error("SecurityError: The operation is insecure.");
    },
    configurable: true,
  });
}

const asli = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => __resetSimpanan());
afterEach(() => {
  if (asli) Object.defineProperty(globalThis, "localStorage", asli);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.restoreAllMocks();
});

describe("penyimpanan sehat: tak ada perubahan perilaku", () => {
  it("tulis lalu baca memulangkan nilainya", () => {
    const rak: Rak = new Map();
    pasang(penyimpananSehat(rak));
    tulisLokal("kakarut.auth", '{"token":"abc"}');
    expect(bacaLokal("kakarut.auth")).toBe('{"token":"abc"}');
    // benar-benar mendarat di penyimpanan, bukan cuma di memori
    expect(rak.get("kakarut.auth")).toBe('{"token":"abc"}');
  });

  it("hapus benar-benar menghapus", () => {
    const rak: Rak = new Map();
    pasang(penyimpananSehat(rak));
    tulisLokal("kakarut.auth", '{"token":"abc"}');
    hapusLokal("kakarut.auth");
    expect(bacaLokal("kakarut.auth")).toBeNull();
    expect(rak.has("kakarut.auth")).toBe(false);
  });

  it("kunci yang tak pernah ditulis tetap null (bukan undefined)", () => {
    pasang(penyimpananSehat(new Map()));
    expect(bacaLokal("kakarut.belum-ada")).toBeNull();
  });
});

describe("LOGOUT DARI TAB LAIN tetap terlihat — memori TIDAK boleh menghidupkan sesi", () => {
  it("tab lain menghapus kunci sesi → tab ini ikut kehilangan sesinya", () => {
    const rak: Rak = new Map();
    pasang(penyimpananSehat(rak));
    tulisLokal("kakarut.auth", '{"token":"abc"}');

    // Tab LAIN logout: kuncinya lenyap dari penyimpanan tanpa lewat modul ini.
    rak.delete("kakarut.auth");

    // Cadangan memori masih memegang tokennya. Ia TIDAK boleh menang di sini —
    // kalau menang, logout antar-tab jadi tak berarti dan kasir yang sudah
    // dikeluarkan tetap bisa menjual.
    expect(bacaLokal("kakarut.auth")).toBeNull();
  });
});

describe("penyimpanan diblokir total (Safari 'Block All Cookies')", () => {
  it("membaca propertinya melempar — dan itu tidak merembes ke pemanggil", () => {
    pasangGetterMelempar();
    expect(() => bacaLokal("kakarut.auth")).not.toThrow();
    expect(() => tulisLokal("kakarut.auth", "x")).not.toThrow();
    expect(() => hapusLokal("kakarut.auth")).not.toThrow();
  });

  it("SESI TETAP HIDUP untuk tab ini (inti perbaikannya)", () => {
    pasangGetterMelempar();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    tulisLokal("kakarut.auth", '{"token":"abc"}');
    // Tanpa cadangan memori, ini null — dan `api()` mengirim permintaan tanpa
    // Authorization, 401, balik ke /login. Berputar selamanya.
    expect(bacaLokal("kakarut.auth")).toBe('{"token":"abc"}');
  });

  it("dan LOGOUT tetap benar-benar melepas sesinya", () => {
    pasangGetterMelempar();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    tulisLokal("kakarut.auth", '{"token":"abc"}');
    hapusLokal("kakarut.auth");
    // Arah sebaliknya: cadangan yang menyelamatkan login tak boleh berubah
    // jadi sesi yang tak bisa dimatikan.
    expect(bacaLokal("kakarut.auth")).toBeNull();
  });

  it("penyimpanan ADA tapi getItem-nya yang melempar — cadangan tetap menolong", () => {
    // Bentuk kegagalan KETIGA, dan ia melewati jalur kode yang berbeda dari
    // dua di atas: `ambilPenyimpanan()` berhasil, jadi penjagaan `if (!p)`
    // terlewati dan yang menangkap adalah `try`/`catch` di sekitar `getItem`.
    //
    // Uji ini ditambahkan setelah suntikan pembuktian menemukan lubangnya:
    // mencabut cadangan memori dari `catch` itu TIDAK memerahkan satu pun uji,
    // karena semua uji "diblokir" di atas membuat GETTER-nya yang melempar dan
    // tak pernah sampai ke sana.
    const rak: Rak = new Map();
    pasang({
      getItem: () => {
        throw new Error("SecurityError: The operation is insecure.");
      },
      setItem: (k: string, v: string) => void rak.set(k, v),
      removeItem: (k: string) => void rak.delete(k),
    });
    tulisLokal("kakarut.auth", '{"token":"abc"}');
    expect(bacaLokal("kakarut.auth")).toBe('{"token":"abc"}');
  });

  it("localStorage tidak ada sama sekali (WebView tertentu) — sama saja", () => {
    pasang(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    tulisLokal("kakarut.auth", '{"token":"abc"}');
    expect(bacaLokal("kakarut.auth")).toBe('{"token":"abc"}');
  });

  it("diperingatkan SEKALI saja, bukan tiap tulisan", () => {
    pasangGetterMelempar();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) tulisLokal(`k${i}`, "v");
    // Konsol yang banjir menyembunyikan galat lain yang justru perlu dibaca.
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("kuota penuh: setItem melempar padahal penyimpanan TERBACA", () => {
  it("nilai BASI di penyimpanan tidak boleh menang atas tulisan yang gagal", () => {
    const rak: Rak = new Map([["kakarut.auth", '{"token":"LAMA"}']]);
    pasang({
      getItem: (k: string) => rak.get(k) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (k: string) => void rak.delete(k),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    tulisLokal("kakarut.auth", '{"token":"BARU"}');

    // Penyimpanan masih memegang token LAMA (tulisan kita tak mendarat).
    expect(rak.get("kakarut.auth")).toBe('{"token":"LAMA"}');
    // Yang dipakai harus yang BARU: tulisan kita gagal, jadi isi penyimpanan
    // adalah nilai basi — bukan nilai yang lebih baru.
    expect(bacaLokal("kakarut.auth")).toBe('{"token":"BARU"}');
  });

  it("wewenang penyimpanan PULIH begitu tulisannya berhasil lagi", () => {
    const rak: Rak = new Map();
    let macet = true;
    pasang({
      getItem: (k: string) => rak.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (macet) throw new Error("QuotaExceededError");
        rak.set(k, v);
      },
      removeItem: (k: string) => void rak.delete(k),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    tulisLokal("kakarut.auth", '{"token":"A"}');
    macet = false;
    tulisLokal("kakarut.auth", '{"token":"B"}');

    // Penandanya tidak menempel selamanya: sesudah tulisan yang berhasil,
    // penyimpanan kembali berwenang — termasuk untuk melihat logout tab lain.
    rak.delete("kakarut.auth");
    expect(bacaLokal("kakarut.auth")).toBeNull();
  });
});

describe("sapuan: tak ada lagi sentuhan localStorage telanjang di web", () => {
  const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));

  function berkasSumber(dir: string): string[] {
    const out: string[] = [];
    for (const nama of readdirSync(dir)) {
      const p = join(dir, nama);
      if (statSync(p).isDirectory()) out.push(...berkasSumber(p));
      else if (nama.endsWith(".ts") || nama.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  it("nol pemanggilan localStorage.{get,set,remove}Item di seluruh web/src", () => {
    // `simpanan.ts` sendiri pun tak cocok pola ini: ia memegang penyimpanannya
    // lewat variabel (`p.getItem(...)`), jadi tak ada pengecualian yang perlu
    // diberi kelonggaran — dan pengecualian itulah yang biasanya jadi celah.
    const pelanggar: string[] = [];
    for (const f of berkasSumber(WEB)) {
      const isi = readFileSync(f, "utf8");
      for (const m of ["getItem", "setItem", "removeItem"]) {
        if (isi.includes(`localStorage.${m}(`)) pelanggar.push(`${f.slice(WEB.length + 1)}:${m}`);
      }
    }
    expect(pelanggar, `pakai bacaLokal/tulisLokal/hapusLokal dari lib/simpanan`).toEqual([]);
  });

  it("sesi memang lewat penjaga itu", () => {
    const API = readFileSync(join(WEB, "lib/api.ts"), "utf8");
    expect(API).toContain('import { bacaLokal, hapusLokal, tulisLokal } from "./simpanan";');
    expect(API).toContain("const raw = bacaLokal(STORAGE_KEY);");
    expect(API).toContain("if (state) tulisLokal(STORAGE_KEY, JSON.stringify(state));");
    expect(API).toContain("else hapusLokal(STORAGE_KEY);");
  });

  it("PREMISNYA: `api()` masih mengambil token dari penyimpanan, bukan state React", () => {
    // Kalau premis ini runtuh (mis. token dioper lewat context), alasan
    // cadangan memori ikut berubah — dan komentar panjang di `simpanan.ts`
    // jadi menerangkan bahaya yang sudah tak ada. Dipatok supaya ketahuan.
    const API = readFileSync(join(WEB, "lib/api.ts"), "utf8");
    const iFungsi = API.indexOf("export async function api<T = unknown>(");
    const iAmbil = API.indexOf("const auth = loadAuth();", iFungsi);
    expect(iFungsi).toBeGreaterThan(0);
    expect(iAmbil).toBeGreaterThan(iFungsi);
    expect(API).toContain("if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;");
  });

  it("sessionStorage di BatasGalat/UpdatePrompt tetap punya penjaganya sendiri", () => {
    // Keduanya sengaja TIDAK dialihkan: cadangan memori justru salah di sana.
    // "Sudah pernah muat ulang" harus LUPA saat tab ditutup, dan blokir
    // storage di situ artinya "anggap sudah pernah" — bukan "ingat di memori".
    for (const f of ["components/BatasGalat.tsx", "components/UpdatePrompt.tsx"]) {
      const isi = readFileSync(join(WEB, f), "utf8");
      expect(isi, `${f} harus tetap membungkus sessionStorage-nya`).toContain("sessionStorage");
      expect(isi).toContain("catch");
    }
  });
});
