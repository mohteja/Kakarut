import { zValidator as zvAsli } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import type { $ZodError, $ZodIssue, $ZodType } from "zod/v4/core";

/**
 * VALIDATOR BADAN PERMINTAAN — dengan pesan yang bisa dibaca orang.
 *
 * `@hono/zod-validator` bawaan MEMULANGKAN SENDIRI respons 400 berisi objek
 * ZodError mentah:
 *
 *     {"success":false,"error":{"name":"ZodError","message":"[\n  {\n
 *       \"origin\": \"number\",\n    \"code\": \"too_big\", …"}}
 *
 * Dua akibat, dan keduanya terukur:
 *
 *   1. YANG DILIHAT KASIR ADALAH "[object Object]". Seluruh API ini berjanji
 *      `{ error: "<kalimat>" }`, dan `lib/api.ts` di web menyalin `data.error`
 *      ke pesan galat — bertipe `string` menurut deklarasinya. Untuk galat zod
 *      isinya OBJEK, dan `new Error(objek)` merangkainya jadi "[object
 *      Object]". Itulah yang tampil di `<ErrorText>`: bukan penjelasan, bukan
 *      pula petunjuk, cuma tanda bahwa ada yang salah.
 *
 *   2. Ia melewati `app.onError` sama sekali (dipulangkan langsung, tidak
 *      dilempar), jadi satu-satunya pintu keluar galat di aplikasi ini tak
 *      pernah melihatnya — termasuk pencatatannya ke `error_logs`.
 *
 * Pembungkus ini MELEMPAR `HTTPException` alih-alih memulangkan respons, jadi
 * galat validasi akhirnya mengalir lewat pintu yang sama dengan galat lain dan
 * berbentuk sama pula. Dipasang di SATU tempat, bukan disalin ke 33 berkas
 * rute — daftar tugas yang tak akan selesai, persis alasan yang sama dengan
 * terjemahan 22P02 di `pg-galat.ts`.
 */

/** Nama isian yang bisa dibaca: `["items", 0, "qty"]` → `items[0].qty`. */
function labelJalur(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "Isian";
  return path.reduce<string>((acc, bagian) => {
    if (typeof bagian === "number") return `${acc}[${bagian}]`;
    return acc ? `${acc}.${String(bagian)}` : String(bagian);
  }, "");
}

/**
 * Sebab satu masalah, dalam bahasa yang menyebut BATASNYA.
 *
 * "maksimal 100" bisa ditindaklanjuti; "Too big" tidak. Kode yang belum
 * dikenali jatuh ke pesan bawaan zod — bahasa Inggris, tapi tetap kalimat,
 * bukan gumpalan JSON.
 */
function alasanIssue(issue: $ZodIssue): string {
  const i = issue as $ZodIssue & {
    maximum?: unknown;
    minimum?: unknown;
    expected?: unknown;
    values?: unknown[];
    keys?: unknown[];
  };
  switch (issue.code) {
    case "unrecognized_keys":
      /*
       * Lahir bersama `.strict()`. Tanpa kasus ini pesannya jatuh ke bawaan
       * zod — `Unrecognized key: "branch_id"`, bahasa Inggris — dan karena
       * `path`-nya KOSONG, `labelJalur` memulangkan "Isian" yang tak menunjuk
       * apa pun: "Isian: Unrecognized key: …". Berkas ini ada justru karena
       * pesan validasi pernah tampil "[object Object]"; menambah kelas galat
       * tanpa kalimatnya akan mengulang kesalahan yang sama satu tingkat lebih
       * kecil.
       *
       * Kuncinya DISEBUT: pesan "ada isian yang tak dikenal" tak bisa
       * ditindaklanjuti oleh orang yang tak tahu isian mana.
       */
      return i.keys && i.keys.length > 0
        ? `isian tak dikenal: ${i.keys.map(String).join(", ")}`
        : "ada isian yang tidak dikenal";
    case "invalid_type":
      /*
       * Kunci yang TAK DIKIRIM dan kunci yang tipenya SALAH sama-sama
       * `invalid_type` di zod v4, dan issue-nya tak memuat `input` maupun
       * `received` sebagai field — hanya pesannya yang membedakan
       * ("…received undefined" vs "…received string"). Jadi itu yang dibaca.
       *
       * Bergantung pada teks memang rapuh; percobaan pertama justru memeriksa
       * `issue.input === undefined`, yang SELALU benar di v4 — akibatnya tiap
       * salah-tipe dilaporkan "wajib diisi" kepada orang yang jelas-jelas sudah
       * mengisinya. Kerapuhan itu ditambatkan uji: `pesan-validasi-terbaca`
       * memaku KEDUA kalimatnya, jadi zod yang mengubah kata-katanya membuat
       * ujinya merah, bukan diam-diam salah melabeli lagi.
       */
      return /received undefined/i.test(issue.message)
        ? "wajib diisi"
        : `harus berupa ${String(i.expected ?? "nilai lain")}`;
    case "too_big":
      return `maksimal ${String(i.maximum)}`;
    case "too_small":
      return `minimal ${String(i.minimum)}`;
    case "invalid_value":
      return i.values && i.values.length > 0
        ? `pilihannya: ${i.values.map(String).join(", ")}`
        : "nilainya tidak sah";
    case "invalid_format":
      return "formatnya tidak sesuai";
    default:
      return issue.message;
  }
}

/** Ringkas seluruh masalah jadi SATU kalimat. */
export function pesanZod(error: $ZodError): string {
  const issues = error.issues ?? [];
  if (issues.length === 0) return "Isian tidak valid";
  // Tiga sudah cukup untuk memperbaiki; sisanya cuma memanjangkan spanduk
  // merah sampai tak terbaca.
  const BATAS = 3;
  const tampil = issues
    .slice(0, BATAS)
    .map((i: $ZodIssue) => `${labelJalur(i.path)}: ${alasanIssue(i)}`);
  const sisa = Math.max(0, issues.length - BATAS);
  return tampil.join("; ") + (sisa > 0 ? ` (dan ${sisa} isian lain)` : "");
}

/**
 * Pengganti `zValidator` bawaan. Pemakaiannya identik; bedanya cuma bentuk
 * galatnya saat validasi gagal.
 */
export function zValidator<T extends $ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zvAsli(target, schema, (hasil) => {
    if (!hasil.success) {
      throw new HTTPException(400, { message: pesanZod(hasil.error as $ZodError) });
    }
  });
}
