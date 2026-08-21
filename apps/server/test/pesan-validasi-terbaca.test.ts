import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { pesanZod } from "../src/lib/validator";

/**
 * GALAT VALIDASI HARUS BERUPA KALIMAT, BUKAN "[object Object]".
 *
 * `@hono/zod-validator` bawaan MEMULANGKAN SENDIRI 400 berisi objek ZodError
 * mentah: `{"success":false,"error":{"name":"ZodError","message":"[\\n {…"}}`.
 *
 * Seluruh API ini berjanji `{ error: "<kalimat>" }`, dan `apps/web/src/lib/api.ts`
 * menyalin `data.error` ke pesan galat — bertipe `string` menurut deklarasinya.
 * Untuk galat zod isinya OBJEK, dan `new Error(objek)` merangkainya jadi
 * "[object Object]".
 *
 * TERUKUR, bukan diperkirakan. `PATCH /company {"pb1_rate":150}` memulangkan
 * ZodError mentah; menjalankan baris 138–156 `api.ts` atas badan itu
 * menghasilkan `e.message === "[object Object]"`. Itulah yang tampil di
 * `<ErrorText>` — bukan penjelasan, bukan petunjuk, cuma tanda bahwa ada yang
 * salah. Kasir yang salah mengetik satu angka tak punya jalan tahu angka mana.
 *
 * Akibat keduanya lebih sunyi: respons itu DIPULANGKAN, bukan DILEMPAR, jadi
 * ia melewati `app.onError` sama sekali — satu-satunya pintu keluar galat di
 * aplikasi ini tak pernah melihatnya, termasuk pencatatannya ke `error_logs`.
 */
describe("pesanZod: menyebut isian DAN batasnya", () => {
  const pesan = (skema: z.ZodType, nilai: unknown) => {
    const r = skema.safeParse(nilai);
    expect(r.success, "skema uji seharusnya GAGAL").toBe(false);
    return pesanZod(r.error!);
  };

  it("batas atas disebut angkanya", () => {
    expect(pesan(z.object({ pb1_rate: z.number().max(100) }), { pb1_rate: 150 })).toBe(
      "pb1_rate: maksimal 100",
    );
  });

  it("batas bawah disebut angkanya", () => {
    expect(pesan(z.object({ qty: z.number().min(1) }), { qty: 0 })).toBe("qty: minimal 1");
  });

  it("kunci yang tak dikirim berbunyi 'wajib diisi', bukan 'harus berupa string'", () => {
    // Bagi pengirimnya, kunci yang absen bukan soal tipe.
    expect(pesan(z.object({ nama: z.string() }), {})).toBe("nama: wajib diisi");
  });

  it("tipe salah menyebut tipe yang diharapkan", () => {
    expect(pesan(z.object({ qty: z.number() }), { qty: "dua" })).toBe("qty: harus berupa number");
  });

  it("enum menyebut pilihannya", () => {
    const p = pesan(z.object({ mode: z.enum(["lite", "pro"]) }), { mode: "Pro" });
    expect(p).toContain("mode:");
    expect(p).toContain("lite");
    expect(p).toContain("pro");
  });

  it("jalur bersarang & indeks larik terbaca sebagai alamat", () => {
    const skema = z.object({ items: z.array(z.object({ qty: z.number().min(1) })) });
    expect(pesan(skema, { items: [{ qty: 5 }, { qty: 0 }] })).toBe("items[1].qty: minimal 1");
  });

  it("INTI: hasilnya SELALU string, dan tak pernah gumpalan JSON", () => {
    // Inilah asersi yang sebenarnya: apa pun bentuk galatnya, yang keluar
    // sebuah kalimat — bukan sesuatu yang merangkai jadi "[object Object]".
    const kasus: [z.ZodType, unknown][] = [
      [z.object({ a: z.number().max(1) }), { a: 9 }],
      [z.object({ a: z.string().min(3) }), { a: "x" }],
      [z.object({ a: z.enum(["x"]) }), { a: "y" }],
      [z.object({ a: z.string() }), {}],
      [z.array(z.number()), "bukan larik"],
      [z.object({ a: z.string().email() }), { a: "bukan-email" }],
    ];
    for (const [skema, nilai] of kasus) {
      const p = pesan(skema, nilai);
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
      expect(String(p)).not.toBe("[object Object]");
      expect(p, "pesan memuat gumpalan JSON").not.toMatch(/^\s*\[?\s*\{/);
    }
  });

  it("banyak masalah diringkas, tidak dimuntahkan semuanya", () => {
    const skema = z.object({
      a: z.number().max(1),
      b: z.number().max(1),
      c: z.number().max(1),
      d: z.number().max(1),
      e: z.number().max(1),
    });
    const p = pesan(skema, { a: 9, b: 9, c: 9, d: 9, e: 9 });
    expect(p).toContain("dan 2 isian lain");
    expect(p.split(";")).toHaveLength(3);
  });
});

describe("satu pintu: rute memakai pembungkusnya, bukan zValidator bawaan", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url)).replace(/\/$/, "");
  function semuaTs(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = `${dir}/${n}`;
      return statSync(p).isDirectory() ? semuaTs(p) : n.endsWith(".ts") ? [p] : [];
    });
  }

  it("tak ada modul yang mengimpor `@hono/zod-validator` langsung", () => {
    /*
     * Menyalin hook pemformatan ke 33 berkas rute adalah daftar tugas yang tak
     * akan selesai — dan rute ke-34 yang lahir besok akan melewatkannya tanpa
     * ada yang berteriak. Pembungkusnya satu, di `lib/validator.ts`.
     */
    const pelanggar = semuaTs(SRC)
      .filter((p) => !p.endsWith("/lib/validator.ts"))
      .filter((p) => /from "@hono\/zod-validator"/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(SRC.length + 1));
    expect(
      pelanggar,
      "impor langsung melewati pemformatan pesan — galatnya kembali jadi objek mentah",
    ).toEqual([]);
  });

  it("PREMIS: pembungkusnya memang dipakai luas, bukan berkas yatim", () => {
    // Kalau semua rute berhenti memakai validator sama sekali, asersi di atas
    // juga hijau — dan tak satu pun badan permintaan tervalidasi lagi.
    const pakai = semuaTs(SRC).filter((p) =>
      /from "(\.\.\/)+lib\/validator"/.test(readFileSync(p, "utf8")),
    );
    expect(pakai.length, "hampir tak ada rute yang memakai validator").toBeGreaterThan(25);
  });

  it("PASANGAN: sapuannya bisa MENUDUH", () => {
    const kotor = 'import { zValidator } from "@hono/zod-validator";';
    const bersih = 'import { zValidator } from "../../lib/validator";';
    expect(/from "@hono\/zod-validator"/.test(kotor)).toBe(true);
    expect(/from "@hono\/zod-validator"/.test(bersih)).toBe(false);
    expect(/from "(\.\.\/)+lib\/validator"/.test(bersih)).toBe(true);
  });
});
