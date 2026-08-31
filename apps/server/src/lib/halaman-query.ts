import type { Context } from "hono";

/**
 * HALAMAN DARI QUERY — satu rumah untuk `page` & `per_page`.
 *
 * Repo ini sudah menghabiskan satu vena penuh membuat MASUKAN DARI BADAN
 * tertib: 97 `zValidator("json", …)`, 112 skema `.strict()`, batas angka
 * bersama di `lib/batas-angka.ts`, gerbangnya sendiri, dan seksi verify-api
 * yang memakunya. Pintu QUERY tak pernah kebagian: **nol**
 * `zValidator("query", …)` di seluruh `src/`, dan 47 pembacaan
 * `c.req.query(...)` yang masing-masing menjaga dirinya sendiri.
 *
 * Sebagian besar menjaga diri dengan BENAR — dan justru itu yang menyamarkan
 * masalahnya: aturan yang dipegang tiga penulis berbeda akan menjadi tiga
 * aturan. TERUKUR lewat HTTP, satu permintaan yang sama (`per_page=500`) ke
 * tiga pintu berhalaman:
 *
 * | pintu | dibatasi di | dikatakan? |
 * |---|---|---|
 * | `GET /penerimaan/riwayat` | **100** | ya (`per_page: 100`) |
 * | `GET /produksi` | **200** | ya (`per_page: 200`) |
 * | `GET /transfer-stok` | **200** | **tidak** — balasannya tak memuat `per_page` |
 *
 * Bawaannya pun berbeda: 20, 20, 50.
 *
 * Rumah ini tidak menyeragamkan angkanya diam-diam — tiap pintu tetap
 * menyebut batas & bawaannya sendiri, sebab menaikkan batas sebuah pintu
 * mengubah apa yang dilihat klien dan itu keputusan pemilik pintunya. Yang
 * diseragamkan adalah **cara membacanya**: satu tempat yang tahu bahwa
 * `per_page=abc`, `per_page=-1`, `per_page=1e9`, dan `per_page` yang hilang
 * semuanya harus mendarat di angka yang masuk akal.
 *
 * Kembarannya `lib/tanggal-query.ts`, yang lahir dari vena yang sama untuk
 * param tanggal — dan yang membuktikan bentuk ini benar.
 */
export interface Halaman {
  /** 1-based, minimal 1. */
  page: number;
  /** minimal 1, maksimal `maks`. */
  perPage: number;
  /** `(page - 1) * perPage` — dipakai `.offset()`. */
  offset: number;
}

export interface OpsiHalaman {
  /** Dipakai bila `per_page` tak dikirim. */
  bawaan: number;
  /**
   * Langit-langit `per_page`. WAJIB disebut: batas yang tak terlihat adalah
   * batas yang pelan-pelan berbeda dari batas tetangganya, dan itulah yang
   * sudah terjadi (100 vs 200 vs 200).
   */
  maks: number;
}

/** Angka dari query yang tahan `undefined`, `"abc"`, `Infinity`, dan negatif. */
function angka(v: string | undefined, bawaan: number): number {
  if (v === undefined) return bawaan;
  const n = Number(v);
  return Number.isFinite(n) ? n : bawaan;
}

export function halamanQuery(c: Context, opsi: OpsiHalaman): Halaman {
  const page = Math.max(1, Math.trunc(angka(c.req.query("page"), 1)));
  const perPage = Math.min(
    opsi.maks,
    Math.max(1, Math.trunc(angka(c.req.query("per_page"), opsi.bawaan))),
  );
  return { page, perPage, offset: (page - 1) * perPage };
}
