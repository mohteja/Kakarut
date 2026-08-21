/**
 * Salin ulang `packages/shared/src/types.ts` ke dalam Lampiran A
 * `docs/API-CONTRACT.md`.
 *
 * Lampiran itu berjanji "disalin utuh", dan janji itu tak akan bertahan bila
 * pemeliharaannya bergantung pada seseorang yang ingat menyunting dua berkas
 * sekaligus. Saat penjaganya (`test/lampiran-dto-utuh.test.ts`) ditulis,
 * lampirannya sudah menyimpang 454 baris dan kehilangan dua belas tipe — tanpa
 * satu pun tanda, sebab dokumen yang ketinggalan tetap terbaca rapi.
 *
 * Jalankan: `npm run sinkron:lampiran -w @kakarut/server`
 *
 * SENGAJA tidak dijalankan otomatis oleh CI. Menulis ulang dokumen di dalam
 * pipeline membuat perubahan kontrak API mendarat di `production` tanpa pernah
 * dibaca siapa pun — padahal justru DI SITULAH tim mobile mencarinya. Uji yang
 * merah memaksa perubahannya lewat review; skrip ini cuma menghemat
 * penyalinannya.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KONTRAK = fileURLToPath(new URL("../../../../docs/API-CONTRACT.md", import.meta.url));
const TIPE = fileURLToPath(new URL("../../../../packages/shared/src/types.ts", import.meta.url));

const md = readFileSync(KONTRAK, "utf8");
const tipe = readFileSync(TIPE, "utf8").replace(/\n+$/, "");

// Dicari dari judulnya, bukan nomor baris — dokumen ini tumbuh terus di atasnya.
const judul = md.indexOf("## Lampiran A");
if (judul < 0) throw new Error("judul '## Lampiran A' tak ada di docs/API-CONTRACT.md");
const buka = md.indexOf("```typescript", judul);
if (buka < 0) throw new Error("pagar kode ```typescript tak ada sesudah judul Lampiran A");
const awal = md.indexOf("\n", buka) + 1;
const tutup = md.indexOf("\n```", awal);
if (tutup < 0) throw new Error("pagar kode Lampiran A tak pernah ditutup");

const baru = md.slice(0, awal) + tipe + md.slice(tutup);
if (baru === md) {
  console.log("Lampiran A sudah sama dengan types.ts — tak ada yang diubah.");
} else {
  writeFileSync(KONTRAK, baru);
  const hitung = (s: string) => s.split("\n").length;
  console.log(
    `Lampiran A disegarkan: ${hitung(md.slice(awal, tutup))} → ${hitung(tipe)} baris.`,
  );
}
