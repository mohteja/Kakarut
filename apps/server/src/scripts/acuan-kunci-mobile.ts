import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "./buta-komentar";

/**
 * PEMBANGKIT FIKSTUR KUNCI KONTRAK — dipakai uji cermin
 * `kunci_kontrak_server_test.dart` di `mohteja/kakarut-mobile`.
 *
 * Kenapa ia ada. Vena "medan yang tak diurai" menemukan `durasi_detik` dibaca
 * NOL kali di ponsel padahal servernya sudah lama mengirimnya — dan yang
 * menemukannya sapuan SEKALI JALAN, bukan gerbang. Sesudah sapuannya selesai,
 * tak ada apa pun yang menagih kunci kontrak BERIKUTNYA: medan baru di
 * `types.ts` lahir tanpa satu pihak pun wajib memutuskan "ponsel ikut membaca
 * ini atau tidak".
 *
 * Fikstur ini mengubahnya jadi tagihan: tiap `Interface|kunci` di keluaran ini
 * harus DIBACA Dart atau tercatat di `kunci-belum-dibaca.txt` (repo mobile)
 * dengan sadar. Kunci baru yang tak diputuskan membuat uji di sana merah.
 *
 * Pemakaian:
 *   npm run --silent acuan:kunci-mobile -w @kakarut/server \
 *     > ../kakarut-mobile/test/fikstur/kunci-kontrak-server.txt
 */
export function kunciKontrak(sumber?: string): string[] {
  const s = butaKomentar(
    sumber ?? readFileSync(fileURLToPath(new URL("../../../../packages/shared/src/types.ts", import.meta.url)), "utf8"),
  );
  const keluar: string[] = [];
  // Dua bentuk: `export interface X … {` dan `export type X = {`. Di types.ts
  // hari ini seluruh 139 kontrak berbentuk interface dan `export type`-nya
  // union/alias tanpa kurawal — tapi pembangkitnya tetap membaca keduanya,
  // supaya kontrak pertama yang ditulis sebagai type-alias tak lenyap dari
  // fikstur tanpa suara. Uji PASANGAN di kunci-satu-kontrak menembak persis
  // bentuk itu, karena versi pertama regex ini memang buta terhadapnya.
  for (const m of s.matchAll(/export (?:interface (\w+)[^{;=]*|type (\w+)\s*=\s*)\{/g)) {
    const nama = m[1] ?? m[2];
    // blok kurawal berimbang — interface bersarang (jarang) ikut termuat, dan
    // itu benar: kuncinya tetap kunci yang dikirim/diterima kontrak.
    const i = s.indexOf("{", m.index!);
    let d = 0;
    let j = i;
    while (j < s.length) {
      if (s[j] === "{") d += 1;
      else if (s[j] === "}") {
        d -= 1;
        if (d === 0) break;
      }
      j += 1;
    }
    for (const k of s.slice(i, j).matchAll(/^\s+(\w+)\??:/gm)) {
      keluar.push(`${nama}|${k[1]}`);
    }
  }
  return [...new Set(keluar)].sort();
}

if (process.argv[1]?.endsWith("acuan-kunci-mobile.ts")) {
  for (const b of kunciKontrak()) console.log(b);
}
