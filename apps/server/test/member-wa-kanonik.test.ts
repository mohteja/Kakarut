import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bentukKanonikWa,
  normalizeWa,
  varianWa,
} from "../src/modules/customer/service";

/**
 * Penjaga IDENTITAS MEMBER: satu nomor, satu orang.
 *
 * Dedup member bersandar pada satu kunci — `customers_company_wa_uq` di
 * `(company_id, wa)`. Dulu `normalizeWa` hanya membuang non-digit, jadi satu
 * nomor yang sama menghasilkan kunci BERBEDA tergantung cara kasir
 * mengetiknya:
 *
 *     0812-3456-7890      → 081234567890
 *     +62 812-3456-7890   → 6281234567890
 *     +62 0812-3456-7890  → 62081234567890
 *
 * Indeks uniknya lalu dengan patuh membuat TIGA baris member untuk satu tamu.
 * Yang paling terbelah justru tamu paling setia — dialah yang nomornya paling
 * sering diketik ulang, oleh kasir yang berbeda-beda. Riwayat belanjanya
 * pecah, dan `upsertCustomer` juga menimpa `nama` pada baris yang kebetulan
 * cocok, jadi ketiganya ikut melenceng satu sama lain.
 *
 * Web mengirim WA MENTAH (`konsumenWa.trim()` di KasirPage) — tak ada
 * normalisasi sisi klien sama sekali, jadi seluruh beban ada di sini.
 */

describe("bentuk kanonik: tiga cara menulis, satu kunci", () => {
  const KANONIK = "6281234567890";

  it.each([
    ["lokal berawalan 0", "081234567890"],
    ["internasional", "6281234567890"],
    ["campur (+62 lalu 0)", "62081234567890"],
  ])("%s → kunci yang sama", (_nama, digits) => {
    expect(bentukKanonikWa(digits)).toBe(KANONIK);
  });

  it("normalizeWa TIDAK mengkanonikkan — ia hanya membuang tanda baca", () => {
    // Bentuk simpan adalah KONTRAK: ia mengalir ke DTO, halaman Member, dan
    // autocomplete `member-cari` yang mencocokkan `ilike '%q%'` atas digit
    // mentah. Mengkanonikkan yang tersimpan membuat kasir yang mengetik
    // `0812` tak lagi menemukan member yang nomornya diketik `0812…`.
    expect(normalizeWa("0812-3456-7890")).toBe("081234567890");
    expect(normalizeWa("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizeWa("(+62) 0812-3456-7890")).toBe("62081234567890");
  });

  it("yang menyatukan ketiganya adalah PENCOCOKANNYA, bukan bentuk simpannya", () => {
    for (const raw of [
      "0812-3456-7890",
      "+62 812-3456-7890",
      "(+62) 0812-3456-7890",
    ]) {
      expect(bentukKanonikWa(normalizeWa(raw)!), raw).toBe(KANONIK);
    }
  });

  it("nomor terlalu pendek tetap ditolak", () => {
    expect(normalizeWa("12345")).toBeNull();
    expect(normalizeWa("")).toBeNull();
    expect(normalizeWa(null)).toBeNull();
    expect(normalizeWa("--")).toBeNull();
  });

  it("SENGAJA tidak melipat `8` telanjang — itu akan merusak nomor asing", () => {
    // `86…` adalah Tiongkok. Melipat semua awalan 8 jadi `62…` membuat nomor
    // yang sah berubah jadi nomor Indonesia yang bukan siapa-siapa.
    expect(bentukKanonikWa("8613800138000")).toBe("8613800138000");
    expect(bentukKanonikWa("81234567890")).toBe("81234567890");
  });

  it("nomor asing lain tidak disentuh", () => {
    expect(bentukKanonikWa("15551234567")).toBe("15551234567");
    expect(bentukKanonikWa("60123456789")).toBe("60123456789"); // Malaysia
  });
});

describe("varian: yang lama tetap ketemu, tanpa migrasi", () => {
  it("mencakup ketiga bentuk yang mungkin sudah tersimpan", () => {
    const v = varianWa("6281234567890");
    expect(v).toContain("6281234567890");
    expect(v).toContain("081234567890");
    expect(v).toContain("62081234567890");
  });

  it("tidak menghasilkan duplikat", () => {
    const v = varianWa("6281234567890");
    expect(new Set(v).size).toBe(v.length);
  });

  it("nomor non-62 hanya mencari dirinya sendiri", () => {
    // Tanpa pagar ini, `varianWa` akan mengarang varian untuk nomor asing dan
    // bisa menabrakkan dua orang yang berbeda menjadi satu member.
    expect(varianWa("15551234567")).toEqual(["15551234567"]);
  });

  it("INTI: apa pun bentuk ketikannya, pencariannya menjangkau ketiga bentuk", () => {
    // Himpunannya tak harus identik (masing-masing juga memuat bentuk
    // ketikannya sendiri), tapi ketiganya WAJIB saling menjangkau — itulah
    // yang membuat tiga cara ketik bertemu di satu member.
    const bentuk = ["081234567890", "6281234567890", "62081234567890"];
    for (const dari of bentuk) {
      const v = varianWa(dari);
      for (const ke of bentuk) {
        expect(v, `${dari} harus menjangkau ${ke}`).toContain(ke);
      }
    }
  });

  it("varian selalu memuat bentuk ketikannya sendiri — baris lama pasti ketemu", () => {
    // Baris yang tersimpan persis seperti diketik harus ditemukan tanpa
    // bergantung pada kanonikalisasi apa pun.
    expect(varianWa("081234567890")).toContain("081234567890");
    expect(varianWa("15551234567")).toContain("15551234567");
  });
});

/**
 * Ketiga jalur tulis harus memakai aturan yang sama. Dulu ketiganya
 * membandingkan TEKS PERSIS, jadi masing-masing bisa melahirkan duplikat
 * sendiri-sendiri.
 */
describe("ketiga jalur tulis memakai pencarian setara", () => {
  const baca = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const SERVICE = baca("../src/modules/customer/service.ts");
  const ROUTES = baca("../src/modules/customer/routes.ts");

  it("checkout (upsertCustomer) mencari yang setara lebih dulu", () => {
    expect(SERVICE).toMatch(/const lama = await cariCustomerSetara\(tx, companyId, wa\)/);
  });

  it("dan tetap memakai onConflictDoUpdate — cek-lalu-tulis itu balapan", () => {
    // Dua checkout serempak untuk tamu BARU yang sama sama-sama meleset di
    // pencarian lalu sama-sama menyisip. Tanpa penyelesaian konflik, yang
    // kalah gagal 23505 di tengah pembayaran.
    expect(SERVICE).toContain("onConflictDoUpdate");
  });

  it("buat member manual menolak lintas varian, bukan cuma teks persis", () => {
    expect(ROUTES).toMatch(/const setara = await cariCustomerSetara\(db, auth\.company_id!, wa\)/);
  });

  it("ubah member juga, dan mengecualikan dirinya sendiri", () => {
    expect(ROUTES).toMatch(
      /const bentrok = await cariCustomerSetara\(db, auth\.company_id!, wa, id\)/,
    );
  });

  it("bentuk lama `eq(customers.wa, wa)` sudah tidak dipakai sebagai penjaga bentrok", () => {
    expect(ROUTES).not.toContain("eq(customers.wa, wa)");
  });

  it("pesan bentroknya menyebut SIAPA dan bentuk tersimpannya", () => {
    // "Nomor sudah dipakai" tanpa menyebut siapa membuat kasir mengira ada
    // kesalahan sistem, padahal member itu memang ada — cuma tersimpan dalam
    // bentuk lain sehingga tak ketemu saat ia mencari.
    expect(ROUTES).toContain("tersimpan sebagai");
  });

  it("yang TERTUA yang menang bila terlanjur ada dua baris", () => {
    // Harus deterministik: dua kasir tak boleh menulis ke baris berbeda untuk
    // tamu yang sama. Yang tertua memikul riwayat terpanjang.
    expect(SERVICE).toMatch(/\.orderBy\(asc\(customers\.createdAt\)\)/);
  });
});
