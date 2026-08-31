import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  barisDi,
  jelajah,
  namaProperti,
  petaInduk,
  rantaiPenuh,
  uraikan,
  type Simpul,
} from "./ast";
import { berkasKode } from "./rute";

export const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * PENULISAN YANG HASILNYA TAK PERNAH DILIHAT.
 *
 * Dual dari `urutan.ts`. Di sana pertanyaannya *"baris mana yang
 * DIPULANGKAN"*; di sini **"berapa baris yang benar-benar DISENTUH, dan
 * adakah yang memeriksanya"**.
 *
 * `UPDATE … WHERE id = $1 AND company_id = $2` yang tak cocok baris apa pun
 * bukan galat bagi Postgres — ia sukses dengan `rowCount = 0`. Kalau rutenya
 * lalu membalas `{ ok: true }`, orang yang menekan Simpan diberi tahu bahwa
 * perubahannya tersimpan atas baris yang tak pernah disentuh. Tak ada gejala,
 * tak ada galat, dan tak ada cara menebak dari layar.
 *
 * TIGA BENTUK YANG SAH, dan pemindai yang hanya tahu satu akan menuduh yang
 * benar:
 *
 *   1. **Hasilnya dipakai** — `const [row] = await db.update(…).returning()`
 *      lalu `if (!row) throw 404`. Bentuk mayoritas di repo ini, dan bentuk
 *      yang benar.
 *   2. **Penjaganya di depan** — `select` lebih dulu, `throw 404` bila kosong,
 *      baru menulis. Sah, sekalipun hasil tulisannya dibuang.
 *   3. **Memang MASSAL** — impor CSV, hapus-lalu-sisip (UPSERT), backfill,
 *      retensi. Nol baris di situ normal, bukan kegagalan.
 *
 * Yang tersisa sesudah ketiganya adalah kelas `BUTA`.
 *
 * BATAS YANG DIAKUI, ditulis supaya hijaunya tak dibaca lebih luas:
 *
 * 1. **Penjaga dicari di FUNGSI PEMBUNGKUS TERLUAR**, dan itu sengaja longgar
 *    — lebih baik membebaskan lalu dipilah tangan daripada menuduh handler
 *    yang penjaganya beberapa baris di atas. Konsekuensinya jujur: penjaga
 *    yang tinggal di fungsi LAIN (pembantu bersama) tak terlihat, dan situs
 *    seperti itu terbaca `DIJAGA` hanya bila kebetulan ada `404` di
 *    pembungkusnya.
 * 2. **`rowCount` tak dilacak.** Yang dibaca cuma "apakah nilai rantainya
 *    diikat/dikembalikan/dipakai". Rute yang memakai `rowCount` tanpa
 *    mengikat nilainya akan terbaca `BUTA` — belum ada bentuk itu di repo.
 * 3. **SQL mentah (`db.execute(sql\`UPDATE …\`)`) bukan populasi ini.** Ia
 *    punya jalur sendiri; menyapunya menuntut mengurai SQL, bukan pohon TS.
 * 4. Yang dijamin berkas ini bentuk KODE. Apakah sebuah pintu benar-benar
 *    membalas 2xx atas baris yang tak ada dijawab di tempat lain, oleh
 *    §276 `verify-api.sh` yang menembak semua 54 rute pengubah
 *    ber-parameter dengan UUID acak — pengukuran, bukan penalaran.
 */

export type KelasTulis =
  /** hasil rantainya diikat / dikembalikan / dipakai ekspresi lain */
  | "DILIHAT"
  /** hasilnya dibuang, tapi fungsinya memuat penolakan 404 */
  | "DIJAGA"
  /** hasilnya dibuang, dan tak ada penjaga terlihat */
  | "BUTA";

export interface Situs {
  /** relatif terhadap `src/` */
  berkas: string;
  baris: number;
  jenis: "update" | "delete";
  /** argumen pertama `update(T)` / `delete(T)` */
  tabel: string;
  kelas: KelasTulis;
  /** rantainya memanggil `.returning(` */
  returning: boolean;
  /** `where`-nya menyebut sebuah parameter rute (`c.req.param(...)`) */
  pakaiParam: boolean;
  /** kunci daftar-beralasan yang tak bergeser saat barisnya bergeser */
  kunci: string;
}

const rapi = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Penerima yang benar-benar sebuah klien basis data — bukan `map.delete(k)`. */
const PENERIMA = /^(db|tx|dbx|exec|database|trx)$/;

/** Penolakan "barisnya tak ada" dalam bentuk apa pun yang dipakai repo ini. */
const PENJAGA = /HTTPException\(\s*404|,\s*404\s*\)|status:\s*404/;

/**
 * Seluruh penulisan Drizzle di `src`, terkelas.
 *
 * `kode` bisa disuntik (peta `berkas relatif → isi`) supaya bukti merah dan
 * uji premis tak bersandar pada pohon sungguhan — pelajaran putaran 27,
 * tempat contoh terakhirnya lenyap justru karena diperbaiki.
 */
export function situsTulis(kode?: Record<string, string>): Situs[] {
  const berkas = kode
    ? Object.keys(kode)
    : berkasKode(SRC, /\.ts$/).map((p) => p.slice(SRC.length + 1));
  const keluar: Situs[] = [];

  for (const rel of berkas) {
    const isi = kode ? kode[rel] : readFileSync(`${SRC}/${rel}`, "utf8");
    const pohon = uraikan(rel, isi);
    const induk = petaInduk(pohon);

    jelajah(pohon, (n) => {
      if (n.type !== "CallExpression") return;
      const nm = namaProperti(n.callee as Simpul);
      if (nm !== "update" && nm !== "delete") return;
      const obj = (n.callee as Simpul).object as Simpul | undefined;
      const dasar =
        obj?.type === "Identifier" ? (obj.name as string) : namaProperti(obj as Simpul);
      if (!dasar || !PENERIMA.test(dasar)) return;

      const akar = rantaiPenuh(n, induk);
      const rantai = rapi(isi.slice(akar.start, akar.end));

      // Nilainya dipakai? Naik dari rantai TERLUAR melewati `await`; ia
      // TIDAK dipakai persis ketika rantainya berdiri sebagai pernyataan.
      let atas = induk.get(akar);
      while (atas && (atas.type === "AwaitExpression" || atas.type === "TSNonNullExpression")) {
        atas = induk.get(atas);
      }
      const dipakai = Boolean(atas && atas.type !== "ExpressionStatement");

      // Fungsi pembungkus TERLUAR — tempat penjaga biasanya ditulis.
      let terluar: Simpul | undefined;
      for (let k: Simpul | undefined = n; k; k = induk.get(k)) {
        if (
          k.type === "ArrowFunctionExpression" ||
          k.type === "FunctionExpression" ||
          k.type === "FunctionDeclaration"
        ) {
          terluar = k;
        }
      }
      const badan = terluar ? isi.slice(terluar.start, terluar.end) : "";

      const arg = (n.arguments ?? [])[0] as Simpul | undefined;
      const tabel = arg ? rapi(isi.slice(arg.start, arg.end)).slice(0, 40) : "?";

      keluar.push({
        berkas: rel,
        baris: barisDi(isi, ((n.callee as Simpul).property as Simpul).start),
        jenis: nm,
        tabel,
        kelas: dipakai ? "DILIHAT" : PENJAGA.test(badan) ? "DIJAGA" : "BUTA",
        returning: /\.returning\(/.test(rantai),
        pakaiParam: /c\.req\.param\(/.test(rantai),
        kunci: `${rel} ${nm}(${tabel})`,
      });
    });
  }

  return keluar.sort((a, b) => a.berkas.localeCompare(b.berkas) || a.baris - b.baris);
}
