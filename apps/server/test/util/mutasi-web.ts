import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { barisDi, jelajah, petaInduk, uraikan, type Simpul } from "./ast";

/**
 * PENULISAN YANG GAGAL, DAN LAYAR YANG TAK BERKATA APA-APA.
 *
 * Putaran 19–22 menutup satu kelas di sisi BACA: `useQuery` yang gagal
 * memulangkan `data === undefined`, tak terbedakan dari "belum ada", dan
 * layarnya berbunyi "tidak ada apa-apa" tentang hal yang sebenarnya tak
 * terbaca. Instrumennya dibangun untuk itu — `kueri-web.ts`, di berkas
 * sebelah — dan ia bekerja.
 *
 * Sisi TULIS tak pernah kebagian, dan bentuk kegagalannya justru lebih sunyi:
 *
 * > `useMutation` yang gagal **tidak melempar** dan tidak merender apa pun.
 * > `onSuccess` sekadar tak jalan.
 *
 * Tombolnya ditekan; tak ada yang berubah, tak ada yang dikatakan. Orangnya
 * menekan lagi. Di `kueri-web.ts`, `useMutation` muncul SATU kali — dan cuma
 * sebagai petunjuk bahwa sebuah berkas punya tombol simpan. Ia tak pernah
 * jadi populasi.
 *
 * TAK ADA JARING PENGAMAN GLOBAL. `apps/web/src/main.tsx` membangun
 * `QueryClient` dengan `defaultOptions: { queries: … }` saja — tak ada
 * `MutationCache` ber-`onError`. Jadi mutasi yang tak menangani galatnya
 * sendiri tak ditangani siapa pun, dan itu bukan taksiran melainkan pembacaan
 * satu berkas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ATURANNYA SATU: **kegagalan sebuah mutasi harus punya JALAN ke layar.**
 *
 * Jalan yang sah, dan SEMUANYA ada di repo ini — pemindai yang hanya tahu satu
 * akan menuduh pintu yang benar:
 *
 *   ONERROR   `onError` di dalam opsinya (mis. menutup dialog + memberi tahu);
 *   TERLIHAT  `x.error` / `x.isError` mengalir ke JSX — hampir selalu lewat
 *             `<ErrorText error={x.error} />`, idiom yang dipakai 100+ kali;
 *   TERLIHAT  **`x` SENDIRI** dioper ke sesuatu yang dirender —
 *             `<ErrorText error={galatTerbaru(terima, tolak, …)} />`;
 *   DIBACA    dibaca tapi tak sampai ke JSX (mis. dipakai memutuskan sesuatu).
 *
 * Yang tersisa `SENYAP`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BENTUK KETIGA ITU HAMPIR MEMBUAT GERBANG INI MENUDUH SEMBILAN PINTU YANG
 * BENAR, dan pencabutannya ditulis di sini supaya tak terulang.
 *
 * Generasi pertama berkas ini hanya mencari `x.error`/`x.isError`, dan
 * melaporkan **10 situs SENYAP** — empat di layar Penerimaan, tiga di
 * Pengaturan Meja, dua di Onboarding. Kesepuluhnya SALAH. Repo ini sudah
 * memecahkan kelas ini dengan idiom yang lebih baik daripada `<ErrorText
 * error={x.error}/>` telanjang: `lib/galat.ts` menyediakan
 *
 *     galatTerbaru(...mutasi: { error: unknown; submittedAt: number }[])
 *
 * yang menerima OBJEK MUTASINYA, bukan `.error`-nya, lalu memulangkan galat
 * aksi yang paling BARU ditekan — supaya dua tombol di satu layar tak
 * berebut satu slot pesan. Ia dipakai persis di ketiga berkas itu
 * (`PenerimaanPage:269`, `MejaPage:295`, `OnboardingPage:133`).
 *
 * Pelajarannya sama dengan putaran 25, tempat empat tuduhan dicabut
 * berturut-turut: **penjaganya ada di tempat yang tak dilihat pemindai.**
 * Karena itu aturan di bawah ditulis dari BENTUK — "adakah jalan dari mutasi
 * ini ke JSX" — bukan dari pola `x.error` yang kebetulan sudah terlihat.
 *
 * BATAS YANG DIAKUI, ditulis supaya hijaunya tak dibaca lebih luas:
 *
 * 1. **Aliran ditelusuri di dalam SATU berkas.** Galat yang dioper sebagai
 *    prop ke komponen di berkas lain terbaca `TERLIHAT` (ia memang masuk JSX),
 *    dan apakah komponen di ujung sana benar-benar merendernya tak diperiksa.
 *    Itu pembebasan yang bisa terlalu cepat, dan ditulis di sini apa adanya.
 * 2. **`alert()` dan `console.error` bukan "terlihat di layar"** menurut
 *    gerbang ini — yang pertama merusak alur dan yang kedua tak dibaca siapa
 *    pun di lapangan.
 * 3. **`mutateAsync` di dalam `try/catch`** adalah bentuk keempat yang sah dan
 *    TIDAK dikenali; situs seperti itu wajib terdaftar beralasan, bukan
 *    dinyatakan aman diam-diam. (Dua situs di repo saat ini.)
 * 4. **Hanya `useMutation` yang DIIKAT ke nama** yang masuk populasi. Nol yang
 *    tak bernama saat ditulis; kalau bentuk itu lahir kelak, ia tak terlihat —
 *    dan uji cakupan di bawah yang seharusnya menangkap penyusutannya.
 */

const AKAR = fileURLToPath(new URL("../../../../apps/web/src/", import.meta.url));

export type KelasMutasi =
  /** `onError` di dalam opsinya */
  | "ONERROR"
  /** galatnya mengalir ke JSX — dirender */
  | "TERLIHAT"
  /** galatnya dibaca, tapi tak sampai ke JSX */
  | "DIBACA"
  /** kegagalannya tak terlihat di mana pun */
  | "SENYAP";

export interface SitusMutasi {
  /** relatif terhadap `apps/web/src/` */
  berkas: string;
  baris: number;
  /** nama yang mengikat hasil `useMutation` */
  nama: string;
  kelas: KelasMutasi;
  /**
   * Kunci daftar-beralasan yang TIDAK ikut bergeser saat baris bergeser.
   * Pembusukan kunci bernomor baris sudah dibayar dua kali (`pelaku.test.ts`,
   * lalu `bendera-hapus-disaring` di putaran 27). Sekali cukup.
   */
  kunci: string;
}

function berkasTsx(dir = AKAR, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) berkasTsx(p + "/", keluar);
    else if (/\.tsx$/.test(nama)) keluar.push(p);
  }
  return keluar;
}

/** Medan yang MENYATAKAN kegagalan sebuah mutasi. */
const MEDAN_GALAT = new Set(["error", "isError", "failureReason"]);

/** Pembungkus yang bukan langkah aliran — dilewati saat menaiki pohon. */
const TEMBUS = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSNonNullExpression",
  "TSAsExpression",
]);

/**
 * Apakah `n` berakhir di dalam JSX — yaitu benar-benar DIRENDER.
 *
 * `JSXExpressionContainer` adalah satu-satunya pintu dari ekspresi JS ke
 * pohon JSX (`{…}` di dalam elemen maupun di dalam atribut), jadi menanyakan
 * "adakah ia di antara leluhurnya" menjawab pertanyaannya secara struktural —
 * bukan dengan menebak nama komponen. Menebak nama akan membuat gerbang ini
 * buta pada pembungkus berikutnya yang bukan `ErrorText`.
 */
function sampaiKeJsx(n: Simpul, induk: Map<Simpul, Simpul>): boolean {
  for (let k: Simpul | undefined = n; k; k = induk.get(k)) {
    if (k.type === "JSXExpressionContainer") return true;
  }
  return false;
}

/**
 * Nama-nama yang MEMBAWA galat mutasi ini — termasuk turunannya.
 *
 * `const galat = simpan.error ?? hapus.error` lalu `<ErrorText error={galat}/>`
 * adalah bentuk yang dipakai `AreaKebersihanModal`. Tanpa melacak turunan,
 * situs yang justru menggabungkan galat dua mutasi akan tertuduh — dan gerbang
 * yang menuduh bentuk yang lebih teliti adalah gerbang yang ditutup orang.
 */
function bawaGalat(nama: string, akar: Simpul, induk: Map<Simpul, Simpul>) {
  const nama2 = new Set<string>();
  let dibaca = false;
  let terlihat = false;

  const telusur = (bawa: string, dariMedan: boolean): void => {
    jelajah(akar, (n) => {
      if (n.type !== "Identifier" || n.name !== bawa) return;
      const up = induk.get(n);
      if (!up) return;
      if (up.type === "VariableDeclarator" && up.id === n) return;
      if ((up.type === "Property" || up.type === "ObjectProperty") && up.key === n && up.value !== n)
        return;

      // Dari pengikatan mutasi, DUA bentuk dihitung:
      //   `x.error` / `x.isError`  — medan galatnya dibaca;
      //   `x` sendiri dioper ke sesuatu yang dirender (`galatTerbaru(x, y)`).
      // Bentuk kedua yang hampir membuat gerbang ini menuduh sembilan pintu
      // yang benar — lihat catatan pencabutan di kepala berkas.
      let mulai: Simpul = n;
      if (!dariMedan) {
        const medan =
          up.type === "MemberExpression" && up.object === n
            ? up.property?.type === "Identifier"
              ? (up.property.name as string)
              : ""
            : null;
        if (medan !== null) {
          if (!MEDAN_GALAT.has(medan)) return;
          mulai = up;
        } else if (!sampaiKeJsx(n, induk)) {
          // `x` dipakai untuk hal lain (mis. `x.mutate(...)`, `x.isPending`)
          // dan tak sampai ke layar — bukan jalur galat.
          return;
        }
      }
      dibaca = true;
      if (sampaiKeJsx(mulai, induk)) terlihat = true;

      // Turunan: nilainya diikat ke nama lain, lalu nama itu yang dirender.
      for (let k: Simpul | undefined = mulai, i = 0; k && i < 8; i += 1) {
        const p: Simpul | undefined = induk.get(k);
        if (!p) break;
        if (TEMBUS.has(p.type) || p.type === "LogicalExpression" || p.type === "ConditionalExpression") {
          k = p;
          continue;
        }
        if (p.type === "VariableDeclarator" && p.id?.type === "Identifier") {
          nama2.add(p.id.name as string);
        }
        break;
      }
    });
  };

  telusur(nama, false);
  for (const t of [...nama2]) telusur(t, true);
  return { dibaca, terlihat };
}

/**
 * Seluruh `useMutation` bernama di `apps/web/src`, terkelas.
 *
 * `kode` bisa disuntik (peta `berkas → isi`) supaya bukti merah dan uji premis
 * tak bersandar pada pohon sungguhan — pelajaran putaran 27, tempat contoh
 * terakhirnya lenyap justru karena diperbaiki.
 */
export function situsMutasi(kode?: Record<string, string>): SitusMutasi[] {
  const daftar = kode
    ? Object.keys(kode).map((k) => ({ rel: k, isi: kode[k] }))
    : berkasTsx().map((p) => ({ rel: p.slice(AKAR.length), isi: readFileSync(p, "utf8") }));
  const keluar: SitusMutasi[] = [];

  for (const { rel, isi } of daftar) {
    if (!isi.includes("useMutation")) continue;
    const pohon = uraikan(rel, isi);
    const induk = petaInduk(pohon);

    jelajah(pohon, (n) => {
      if (n.type !== "VariableDeclarator" || n.id?.type !== "Identifier") return;
      let init = n.init as Simpul | undefined;
      while (init && TEMBUS.has(init.type)) init = init.expression as Simpul;
      if (init?.type !== "CallExpression") return;
      const callee = init.callee as Simpul | undefined;
      if (callee?.type !== "Identifier" || callee.name !== "useMutation") return;

      const nama = n.id.name as string;
      const opsi = (init.arguments ?? [])[0] as Simpul | undefined;
      const punyaOnError =
        opsi?.type === "ObjectExpression" &&
        ((opsi.properties ?? []) as Simpul[]).some(
          (p) => p.type === "Property" && p.key?.type === "Identifier" && p.key.name === "onError",
        );

      const { dibaca, terlihat } = punyaOnError
        ? { dibaca: true, terlihat: true }
        : bawaGalat(nama, pohon, induk);

      keluar.push({
        berkas: rel,
        baris: barisDi(isi, n.id.start),
        nama,
        kelas: punyaOnError ? "ONERROR" : terlihat ? "TERLIHAT" : dibaca ? "DIBACA" : "SENYAP",
        kunci: `${rel} ${nama}`,
      });
    });
  }

  return keluar.sort((a, b) => a.berkas.localeCompare(b.berkas) || a.baris - b.baris);
}
