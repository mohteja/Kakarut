import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "../src/middleware/auth";
import { memoryStore, rateLimit } from "../src/middleware/rateLimit";

// Konteks palsu minimal: middleware hanya memanggil c.header(...) pada jalur 429.
const ctx = () => ({ header: () => {} }) as unknown as Context<AppEnv>;
const next = async () => {};

describe("rateLimit (fixed window)", () => {
  it("mengizinkan sampai max, lalu memblokir 429", async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3, key: () => "k" }, memoryStore());
    const c = ctx();
    await mw(c, next); // 1
    await mw(c, next); // 2
    await mw(c, next); // 3 (masih diizinkan)
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("kunci berbeda punya jendela terpisah", async () => {
    let k = "a";
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: () => k }, memoryStore());
    const c = ctx();
    await mw(c, next); // a → ok
    k = "b";
    await mw(c, next); // b → ok (bucket sendiri)
    k = "a";
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 }); // a lagi → blok
  });

  it("key async didukung (mis. baca email dari body)", async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2, key: async () => "async" }, memoryStore());
    const c = ctx();
    await mw(c, next);
    await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("fail-open: bila store error, permintaan diizinkan (tak 429/throw)", async () => {
    const storeError: import("../src/middleware/rateLimit").RateLimitStore = {
      hit: async () => {
        throw new Error("db down");
      },
    };
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: () => "x" }, storeError);
    const c = ctx();
    let lolos = false;
    await mw(c, async () => {
      lolos = true;
    });
    expect(lolos).toBe(true);
  });
});

/**
 * UNDANGAN KARYAWAN — pintu KETIGA yang mengirim surat ke alamat sembarang.
 *
 * `auth/routes.ts` sudah menuliskan aturannya dua kali, dengan alasan yang sama
 * persis di komentarnya: `batasLupa` ("cegah bom email ke korban") dan
 * `batasVerifikasiKirim` ("cegah bom email"), keduanya 6 per 15 menit.
 * `POST /karyawan/undang` mengirim surat ke alamat yang sama-sama ditentukan
 * pemanggil, dan tak punya batas apa pun.
 *
 * Terukur sebelum diperbaiki, lewat HTTP terhadap server sungguhan: putaran
 * undang → batalkan → undang atas korban yang SAMA menghasilkan 20 dari 20
 * surat terkirim tanpa satu pun 429, sementara `/auth/forgot-password` pada
 * server yang sama berhenti di 6. Pra-cek "sudah ada undangan pending" tak
 * menutupnya — `DELETE /karyawan/undangan/:id` mencabutnya lagi.
 *
 * Ongkosnya bukan cuma mengganggu korban: suratnya keluar lewat SMTP
 * perusahaan sendiri, jadi penyalahgunaan dari SATU akun bisa membuat domain
 * pengirimnya masuk daftar hitam — dan yang ikut mati sesudah itu adalah email
 * reset password & verifikasi SELURUH tenant.
 *
 * §230 verify-api sudah membuktikan ember PER-KORBAN lewat HTTP sungguhan.
 * Yang dipaku DI SINI ember keduanya, dan justru karena tak bisa ditembak dari
 * sana: membuktikannya butuh 30+ permintaan, dan jatah itu dipakai bersama §96
 * & §103 yang juga mengundang lewat perusahaan seed. Di sini jendelanya milik
 * ujinya sendiri.
 */
describe("batas undangan: dua ember, dua bentuk penyalahgunaan", () => {
  /** Tiruan bentuk kunci yang dipakai `users/routes.ts`. */
  const emberKorban = (perusahaan: () => string, email: () => string) =>
    rateLimit(
      { windowMs: 15 * 60_000, max: 6, key: () => `undang:${perusahaan()}:${email()}` },
      memoryStore(),
    );
  const emberPerusahaan = (perusahaan: () => string) =>
    rateLimit(
      { windowMs: 15 * 60_000, max: 30, key: () => `undang-co:${perusahaan()}` },
      memoryStore(),
    );

  it("ember korban: membanjiri SATU alamat mentok di 6", async () => {
    const mw = emberKorban(() => "co-1", () => "korban@contoh.id");
    const c = ctx();
    for (let i = 0; i < 6; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("PASANGAN: korban lain tetap bisa diundang — bukan sakelar mati", async () => {
    /*
     * Tanpa pasangan ini, "ada 429" juga hijau seandainya undangan diblokir
     * sama sekali — yaitu fitur yang mati, bukan penjaga yang bekerja.
     */
    let email = "korban@contoh.id";
    const mw = emberKorban(() => "co-1", () => email);
    const c = ctx();
    for (let i = 0; i < 6; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
    email = "orang-lain@contoh.id";
    await expect(mw(c, next)).resolves.toBeUndefined();
  });

  it("…dan perusahaan lain tak ikut terkena", async () => {
    // Kuncinya memuat perusahaan, bukan cuma alamat: satu tenant yang
    // menyalahgunakan tak boleh menghentikan onboarding tenant lain.
    let co = "co-1";
    const mw = emberKorban(() => co, () => "korban@contoh.id");
    const c = ctx();
    for (let i = 0; i < 6; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
    co = "co-2";
    await expect(mw(c, next)).resolves.toBeUndefined();
  });

  it("EMBER KEDUA: menyapu banyak alamat berbeda tetap mentok di 30", async () => {
    /*
     * Bentuk penyalahgunaan yang LOLOS ember pertama: korban+1@, korban+2@…
     * Tiap alamatnya baru, jadi ember per-korban tak pernah terisi. Yang
     * menutupnya ember per-perusahaan.
     */
    let n = 0;
    const mw = emberPerusahaan(() => "co-1");
    const c = ctx();
    for (let i = 0; i < 30; i += 1) {
      n += 1;
      await mw(c, next);
    }
    expect(n).toBe(30);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("PASANGAN: ember kedua pun per perusahaan, bukan global", async () => {
    let co = "co-1";
    const mw = emberPerusahaan(() => co);
    const c = ctx();
    for (let i = 0; i < 30; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
    co = "co-2";
    await expect(mw(c, next)).resolves.toBeUndefined();
  });

  it("angkanya SENGAJA sama dengan batasLupa — bahayanya memang sama", () => {
    /*
     * Dipaku pada SUMBERNYA, bukan disalin: kalau kelak seseorang melonggarkan
     * salah satunya, uji ini yang menunjukkan bahwa yang satu lagi ikut perlu
     * ditimbang. Dua pintu yang menjaga bahaya yang sama tak boleh punya angka
     * berbeda tanpa alasan yang ditulis.
     */
    const auth = readFileSync(
      fileURLToPath(new URL("../src/modules/auth/routes.ts", import.meta.url)),
      "utf8",
    );
    const karyawan = readFileSync(
      fileURLToPath(new URL("../src/modules/users/routes.ts", import.meta.url)),
      "utf8",
    );
    const angka = (src: string, nama: string) => {
      const i = src.indexOf(`const ${nama} =`);
      expect(i, `${nama} tak ditemukan`).toBeGreaterThan(-1);
      const blok = src.slice(i, i + 400);
      return {
        window: /windowMs:\s*([\d *_]+)/.exec(blok)?.[1]?.trim(),
        max: /max:\s*(\d+)/.exec(blok)?.[1],
      };
    };
    expect(angka(karyawan, "batasUndangKorban")).toEqual(angka(auth, "batasLupa"));
    // …dan premisnya: pembacanya memang menemukan angka, bukan undefined.
    expect(angka(auth, "batasLupa").max).toBe("6");
  });
});

describe("batas unggahan: dua ember, dan keduanya benar-benar terpasang", () => {
  /*
   * `MAX_SIZE` di `upload/routes.ts` menjaga SATU berkas. Yang tak dijaga
   * siapa pun sebelumnya: BERAPA BANYAK berkas. Terukur terhadap server
   * sungguhan, sebagai KASIR — peran paling rendah yang punya token:
   *
   *     20 unggahan 5 MB berturut-turut → 100 MB dalam 0,81 detik
   *     123 MB/detik ≈ 432 GB/jam dari SATU akun, dan NOL 429
   *
   * Sesudah dua ember dipasang: 80 percobaan → 60 diterima, 20 × 429,
   * berhenti di 300 MB.
   *
   * Tak ada kuota per perusahaan dan tak ada pembersihan berkas yatim, jadi
   * lajunya satu-satunya pengendali yang tersedia.
   */
  const emberPengguna = (sub: () => string) =>
    rateLimit({ windowMs: 15 * 60_000, max: 60, key: () => `unggah:${sub()}` }, memoryStore());
  const emberPerusahaan = (co: () => string) =>
    rateLimit({ windowMs: 15 * 60_000, max: 300, key: () => `unggah-co:${co()}` }, memoryStore());

  it("ember pengguna: satu akun mentok di 60", async () => {
    const mw = emberPengguna(() => "user-1");
    const c = ctx();
    for (let i = 0; i < 60; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("PASANGAN: akun lain tetap bisa mengunggah — bukan sakelar mati", async () => {
    // Tanpa ini, "ada 429" juga hijau seandainya unggahan diblokir sama sekali.
    let sub = "user-1";
    const mw = emberPengguna(() => sub);
    const c = ctx();
    for (let i = 0; i < 60; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
    sub = "user-2";
    await expect(mw(c, next)).resolves.toBeUndefined();
  });

  it("ember perusahaan: banyak akun tak boleh menjumlahkan jatahnya", async () => {
    // Inilah alasan ember KEDUA ada: tanpa ia, sepuluh akun dalam satu tenant
    // memberi 600 unggahan per 15 menit — pipa yang sama besar, cuma dibagi.
    const mw = emberPerusahaan(() => "co-1");
    const c = ctx();
    for (let i = 0; i < 300; i += 1) await mw(c, next);
    await expect(mw(c, next)).rejects.toMatchObject({ status: 429 });
  });

  it("KEDUANYA terpasang di rutenya — bukan cuma didefinisikan", () => {
    /*
     * Sapuan `penjaga-semua-pintu` mula-mula mencari `rateLimit(` di badan yang
     * sama, dan itu TAK CUKUP: mencabut kedua ember dari `.post()` membiarkan
     * definisinya utuh, dan sapuannya tetap hijau. Bukti merahnya gagal pada
     * percobaan pertama.
     *
     * Sapuannya kini mencari bentuk PEMAKAIAN, tapi ia hijau bila SATU ember
     * saja yang tersisa. Uji inilah yang menuntut keduanya — dan keduanya
     * menjaga hal yang berbeda: satu akun yang jadi pipa, versus banyak akun
     * dalam satu tenant yang menjumlahkan jatahnya.
     */
    const src = readFileSync(
      fileURLToPath(new URL("../src/modules/upload/routes.ts", import.meta.url)),
      "utf8",
    );
    const pasang = src.slice(src.indexOf("uploadRoutes = "), src.indexOf("async (c) =>"));
    expect(pasang, "ember per-PENGGUNA tak terpasang di rutenya").toContain(
      "batasUnggahPengguna,",
    );
    expect(pasang, "ember per-PERUSAHAAN tak terpasang di rutenya").toContain(
      "batasUnggahPerusahaan,",
    );
    // …dan batas per berkas tak boleh ikut hilang saat lajunya dibatasi.
    expect(src, "batas ukuran per berkas hilang").toContain("file.size > MAX_SIZE");
  });
});
