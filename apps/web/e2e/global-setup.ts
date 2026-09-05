import { request as pwRequest } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BASE, BERKAS_SESI, KASIR_EMAIL, KASIR_PASS, OWNER_EMAIL, OWNER_PASS } from "./util";

/**
 * SATU LOGIN PER AKUN UNTUK SELURUH SUITE — bukan satu per berkas spec.
 *
 * `POST /auth/login` dibatasi 10 per 5 menit per (IP + email). `util.ts`
 * menyimpan sesinya, tapi cache itu hidup di MODUL — dan modul mati bersama
 * worker-nya. Playwright MENYALAKAN ULANG worker setiap kali sebuah test
 * gagal, jadi satu kegagalan membuat tiap berkas sesudahnya membayar login
 * lagi. Akibatnya bukan satu test merah melainkan LONGSORAN: kegagalan
 * pertama membakar kuota, dan seluruh sisa suite memerah dengan 429 yang tak
 * menyatakan apa pun tentang produk.
 *
 * Terukur pada gerbang 2026-09-04: kegagalan pertama di berkas ketiga, lalu
 * 20 berkas berturut-turut merah — dan penyebab yang terlihat di log ("elemen
 * tak ditemukan") bukan penyebab yang sebenarnya.
 *
 * Sepuluh berkas memakai `OWNER_EMAIL` — TEPAT di plafonnya bahkan tanpa
 * longsoran, jadi berkas spec ke-11 saja sudah cukup memerahkan yang lain.
 * Utang ini tercatat di ledger tiga putaran berturut-turut sebelum akhirnya
 * dibayar di sini.
 *
 * Yang dilakukan: login SEKALI per akun di sini, tulis tokennya ke berkas,
 * dan `sesiApi` membacanya sebelum menyentuh jaringan. Sesudah ini seluruh
 * suite memakai DUA login, berapa pun jumlah berkas spec-nya dan berapa pun
 * kali worker-nya dinyalakan ulang.
 *
 * BUKAN sesi yang dipakai bersama antar-tenant: keduanya akun seed yang sama
 * yang sudah dipakai suite ini sejak awal. Yang berubah cuma berapa kali
 * mereka mengetuk pintu.
 */
export default async function globalSetup() {
  const ctx = await pwRequest.newContext();
  const sesi: Record<string, { token: string; user: unknown }> = {};
  for (const [email, pass] of [
    [OWNER_EMAIL, OWNER_PASS],
    [KASIR_EMAIL, KASIR_PASS],
  ] as const) {
    const r = await ctx.post(`${BASE}/api/auth/login`, { data: { email, password: pass } });
    if (r.status() === 429) {
      /*
       * DIBIARKAN LEWAT, tidak dilempar. Kuota yang sudah habis SEBELUM suite
       * mulai bukan sesuatu yang bisa diperbaiki di sini, dan menggagalkan
       * seluruh jalan di tahap persiapan menyembunyikan spec mana yang
       * sebenarnya terpengaruh. Tiap spec akan melempar kalimatnya sendiri —
       * kalimat yang menyebut akunnya dan menyebut bahwa ini bukan bug kode.
       */
      console.warn(`globalSetup: kuota login ${email} sudah habis — spec akan mencoba sendiri.`);
      continue;
    }
    if (!r.ok()) throw new Error(`globalSetup: login ${email} gagal (${r.status()})`);
    sesi[email] = (await r.json()) as { token: string; user: unknown };
  }
  await ctx.dispose();
  mkdirSync(dirname(BERKAS_SESI), { recursive: true });
  writeFileSync(BERKAS_SESI, JSON.stringify(sesi), "utf8");
}
