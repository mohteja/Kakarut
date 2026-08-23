import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * RUTE YANG MEMILIH SENDIRI CABANGNYA HARUS SELALU DIBERI TAHU CABANGNYA.
 *
 * `resolveBranchId(c)` di `middleware/auth.ts` berbunyi persis begini untuk
 * owner/admin:
 *
 *     ?branch_id= ada  → cabang itu (divalidasi milik perusahaan)
 *     tidak ada        → **cabang aktif PERTAMA** (urut createdAt)
 *
 * Untuk kasir/tim/kitchen/bar ia mengembalikan cabang di tokennya, jadi
 * ketiadaan `branch_id` memang benar bagi mereka. Yang berbahaya justru
 * manajemen: mereka BOLEH berpindah cabang, dan permintaan tanpa `branch_id`
 * dari layar yang sedang menampilkan cabang lain menanyakan sumber daya yang
 * benar kepada cabang yang salah.
 *
 * TUJUH pintu di apps/web begitu, dan enam di antaranya berpasangan dengan
 * pintu kembar di layar yang SAMA yang mengirimkannya dengan benar. Terukur
 * terhadap Postgres sungguhan (meja & bill milik cabang kedua, token pemilik):
 *
 *   GET  /meja/:id/log                        tanpa → 404   dengan → 200
 *   POST /meja/:id/kosongkan                  tanpa → 404   dengan → 200
 *   GET  /pesanan/:jenis/:id/log              tanpa → 404   dengan → 200
 *   POST /pesanan/:jenis/:id/status           tanpa → 404   dengan → 200
 *   POST /pesanan/:jenis/:id/item/:it/status  tanpa → 404   dengan → 200
 *   POST /pesanan/:jenis/:id/item/:it/sajian  tanpa → 404   dengan → 200
 *
 * Yang ketujuh lebih buruk dari 404, dan ia alasan uji ini ditulis sebagai
 * penjaga alih-alih sekadar diperbaiki di tempat:
 *
 *   PUT  /meja/tata-letak   tanpa branch_id → **HTTP 200**, nol baris berubah,
 *   balasannya daftar meja cabang PERTAMA. Halaman menggambar denah cabang
 *   lain sebagai denah yang baru saja "tersimpan", tanpa satu pun tanda merah.
 *
 * Bentuknya yang berulang: aturannya sudah ada, penjaganya terpasang di satu
 * pintu. `KasirPage` sudah menulis `/meja/${id}/kosongkan${branchQuery}` dengan
 * benar sejak awal; modal yang dipakai bersama di `MejaStatusPanel` tidak —
 * padahal ia MENERIMA `branchQuery` sebagai prop dan memakainya dua baris di
 * bawah untuk `invalidateQueries`.
 */
/**
 * Pengupas komentar dipakai ulang dari rumah tunggalnya. Versi lokal berkas ini
 * dulu tiga `replace` regex — ia menggeser posisi (jadi nomor baris melenceng)
 * dan membaca `/*` di dalam string literal sebagai pembuka komentar. Alasannya
 * lengkap di `buta-komentar.ts`.
 */
const tanpaKomentar = butaKomentar;

const SRV = fileURLToPath(new URL("../src", import.meta.url));
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));

function berkasKode(dir: string, ext: RegExp): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasKode(p, ext));
    else if (ext.test(nama)) keluar.push(p);
  }
  return keluar;
}

/** Isi kurung seimbang yang MULAI di `s[i]`. */
function seimbang(s: string, i: number, buka: string, tutup: string): string {
  let dalam = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === buka) dalam += 1;
    else if (s[j] === tutup) {
      dalam -= 1;
      if (dalam === 0) return s.slice(i + 1, j);
    }
  }
  return "";
}

/**
 * Prefiks tiap modul rute, dibaca dari `app.ts` — bukan ditebak.
 *
 * Satu nama bisa punya BEBERAPA prefiks? Tidak — tapi satu MODUL bisa dipasang
 * dua kali lewat dua nama (`produksiRoutes` & `pembelianRoutes` lahir dari
 * pabrik yang sama), jadi nilainya larik dan tiap nama menyimpan miliknya.
 */
function mount(): Map<string, string[]> {
  const app = butaKomentar(readFileSync(join(SRV, "app.ts"), "utf8"));
  const m = new Map<string, string[]>();
  for (const r of app.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
    m.set(r[2], [...(m.get(r[2]) ?? []), r[1]]);
  }
  return m;
}

interface Rute {
  metode: string;
  jalur: string;
  res: boolean;
}

/**
 * SELURUH rute yang terpasang, beserta apakah handler-nya memilih cabang.
 *
 * Versi pertama pemeta ini salah dua kali, dan keduanya membuat gerbang di
 * bawah DIAM alih-alih merah — bentuk kegagalan yang paling mahal:
 *
 * 1. Ia mengambil `export const X = new Hono` PERTAMA yang terpasang, lalu
 *    memakai prefiksnya untuk seluruh berkas. `modules/customer/routes.ts`
 *    mengekspor dua Hono yang keduanya terpasang (`memberCariRoutes` →
 *    `/member-cari`, lalu `customerRoutes` → `/customer`), jadi sepuluh rute
 *    `/customer/*` tercatat sebagai HANTU `/member-cari/*`. Jalur hantu lebih
 *    buruk daripada jalur yang hilang: pemanggil bisa dicocokkan ke rute yang
 *    tak pernah ada.
 * 2. Ia menuntut `= new Hono` harfiah. `produksiRoutes`/`pembelianRoutes`
 *    lahir dari PABRIK (`buatRuteTambahStok("produksi")` / `("beli")`), jadi
 *    seluruh modul — 13 rute, terpasang di DUA prefiks = 26 jalur — tak
 *    terlihat sama sekali. Dua di antaranya memilih cabang.
 *
 * Sekarang tiap Hono terpasang punya WILAYAH-nya sendiri di berkas (dipotong
 * menurut posisi deklarasinya), pabrik ditelusuri ke `function`-nya, dan
 * wilayah pabrik dipetakan ke SEMUA prefiks tempat ia dipasang.
 *
 * Jalur wajib diawali `/`: tanpa itu `c.get("auth")` ikut terhitung sebagai
 * rute — kesalahan yang sudah kubuat sendiri di sapuan lain sesi ini.
 */
function semuaRute(): Rute[] {
  const prefiks = mount();
  const keluar: Rute[] = [];
  for (const p of berkasKode(SRV, /\.ts$/)) {
    const s = butaKomentar(readFileSync(p, "utf8"));
    // Jangkar = posisi tempat sebuah Hono terpasang mulai dirakit.
    const jangkar = new Map<number, string[]>();
    for (const e of s.matchAll(/export const (\w+)\s*=\s*(new Hono|(\w+)\()/g)) {
      const pre = prefiks.get(e[1]);
      if (!pre) continue;
      let pos = e.index!;
      if (e[2] !== "new Hono") {
        const f = s.indexOf(`function ${e[3]}`);
        if (f < 0) continue;
        pos = f;
      }
      jangkar.set(pos, [...(jangkar.get(pos) ?? []), ...pre]);
    }
    if (jangkar.size === 0) continue;
    const batas = [...jangkar.keys()].sort((a, b) => a - b);
    for (const m of s.matchAll(/\.(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g)) {
      let k = -1;
      for (let x = 0; x < batas.length; x += 1) if (m.index! > batas[x]) k = x;
      if (k < 0) continue;
      const isi = seimbang(s, m.index! + 1 + m[1].length, "(", ")");
      const res = isi.includes("resolveBranchId(");
      for (const pre of jangkar.get(batas[k])!) {
        keluar.push({
          metode: m[1].toUpperCase(),
          jalur: (pre + m[2]).replace(/\/\//g, "/").replace(/\/$/, "") || "/",
          res,
        });
      }
    }
  }
  return keluar;
}

/** Rute (metode + jalur penuh) yang badan handler-nya memanggil resolveBranchId. */
function ruteMemilihCabang(): { metode: string; jalur: string }[] {
  return semuaRute()
    .filter((r) => r.res)
    .map((r) => ({ metode: r.metode, jalur: r.jalur }));
}

/**
 * Pemanggilan yang SENGAJA tak membawa cabang — beserta alasannya. Bukan daftar
 * "belum sempat": tiap baris di bawah sudah diperiksa satu per satu, dan tiap
 * baris baru di sini menuntut alasan yang sama tegasnya.
 */
const DIKECUALIKAN: Record<string, string> = {
  // Beranda peran TERIKAT CABANG (rute /beranda hanya untuk tim/kitchen/bar di
  // App.tsx). Bagi mereka resolveBranchId mengembalikan cabang di token —
  // mengirim branch_id tak menambah apa pun.
  "pages/TimBerandaPage.tsx|GET|/stok": "peran terikat cabang",
  "pages/TimBerandaPage.tsx|GET|/penerimaan": "peran terikat cabang",
  // Halaman kartu stok membaca branch_id dari URL halamannya sendiri dan
  // menempelkannya secara bersyarat (`${branchId ? …}`) — sudah dibawa, cuma
  // tak terlihat oleh pemindai yang membaca teks templatnya.
  "pages/stok/KartuStokPage.tsx|GET|/stok/kartu/:x": "branch_id bersyarat dari URL halaman",
  // Cabangnya dikirim di BADAN (`tujuan_branch_id`), dan server memakainya
  // lebih dulu: `body.tujuan_branch_id ?? (await resolveBranchId(c))`.
  "pages/stok/TambahStokDariMenuPage.tsx|POST|/rekomendasi/menu/faktur":
    "cabang dikirim di badan sebagai tujuan_branch_id",
  // Dua baris berikut BARU TERLIHAT sejak pemeta rute diperbaiki: modul
  // `/produksi` + `/pembelian` lahir dari pabrik `buatRuteTambahStok`, jadi
  // pemeta lama tak pernah melihatnya sama sekali. Alasan pengecualiannya
  // sama persis dengan dua baris `TimBerandaPage` di atas — `/beranda` hanya
  // dirutekan untuk tim/kitchen/bar (`App.tsx:200`), dan bagi peran terikat
  // cabang `resolveBranchId` mengembalikan cabang di token.
  "pages/TimBerandaPage.tsx|GET|/produksi": "peran terikat cabang",
  "pages/TimBerandaPage.tsx|GET|/pembelian": "peran terikat cabang",
  // Juga baru terlihat, tapi karena sebab lain: `api<{ ok: true; jumlah:
  // number; tanggal: string }>` memuat `;` di argumen tipe, dan regex pemindai
  // lama patah di situ. Cabangnya DIKIRIM di badan, dan server memilihnya
  // lebih dulu: `body.branch_id ? await pastikanCabang(...) : resolveBranchId(c)`
  // (`stok/routes.ts:621`).
  "pages/stok/StokAwalPage.tsx|POST|/stok/awal": "cabang dikirim di badan sebagai branch_id",
};

/** Sumber cabang di apps/web — ditelusuri lewat turunan `const`, bukan daftar nama. */
const SUMBER = /useCabangData|useBranch|branch_id|branchId|branchQuery|dataQuery/;

function bawaCabang(s: string, ekspr: string, dalam = 0): boolean {
  if (dalam > 4) return false;
  if (SUMBER.test(ekspr)) return true;
  const nama = new Set([...ekspr.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const n of nama) {
    const m = s.match(new RegExp(`\\bconst\\s+${n}\\b[^=\\n]*=\\s*([^\\n;]{0,300})`));
    if (m && bawaCabang(s, m[1], dalam + 1)) return true;
    // bentuk destructuring: const { query: n } = useCabangData()
    if (new RegExp(`const\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=\\s*use(CabangData|Branch)\\(`).test(s)) {
      return true;
    }
  }
  return false;
}

interface Panggilan {
  file: string;
  baris: number;
  metode: string;
  jalur: string;
  url: string;
  bawa: boolean;
  /** Bagaimana URL-nya didapat: literal, atau nilai variabel yang ditelusuri. */
  cara: "literal" | "telusur";
}

/**
 * Kurung buka tiap panggilan `api(...)`, dengan argumen tipe DILEWATI secara
 * berimbang.
 *
 * Versi lama memakai `api\s*(?:<[^;]{0,200}?>)?\s*\(`. Argumen tipe yang memuat
 * `;` — mis. `api<{ ok: true; jumlah: number; tanggal: string }>("/stok/awal")`
 * — membuat polanya gagal, jadi panggilannya TIDAK ADA bagi gerbang ini.
 * Terukur: 23 dari 322 panggilan `api(` di `apps/web/src` tak pernah terlihat.
 */
function posisiApi(s: string): number[] {
  const keluar: number[] = [];
  for (const m of s.matchAll(/\bapi\b/g)) {
    let j = m.index! + 3;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (s[j] === "<") {
      let dalam = 0;
      while (j < s.length) {
        if (s[j] === "<") dalam += 1;
        else if (s[j] === ">") {
          dalam -= 1;
          if (dalam === 0) {
            j += 1;
            break;
          }
        } else if (s[j] === "(" && dalam === 0) break;
        j += 1;
      }
      while (j < s.length && /\s/.test(s[j])) j += 1;
    }
    if (s[j] === "(") keluar.push(j);
  }
  return keluar;
}

/** `${…}` apa pun jadi `:x`, query dibuang — bentuk yang bisa dicocokkan ke rute. */
function normalJalur(url: string): string {
  return (
    url
      .replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ":x")
      .split("?")[0]
      .replace(/\/$/, "") || "/"
  );
}

/**
 * Bentuk-bentuk jalur yang mungkin dimaksud sebuah URL — biasanya satu.
 *
 * Idiom repo ini menempelkan query lewat interpolasi di UJUNG:
 * `` `/meja/tata-letak${branchQuery}` ``. `branchQuery` mengembang jadi
 * `?branch_id=…` saat berjalan, tapi di teks sumber tak ada `?`, jadi
 * `normalJalur` menganggapnya ruas jalur: `/meja/tata-letak:x` — yang tak
 * cocok ke rute mana pun, jadi pemanggilnya DILEWATI.
 *
 * Itu lubang cakupan yang diam: pemanggil yang menempelkan query dengan cara
 * ini tak pernah dinilai, termasuk yang query-nya BUKAN cabang. Maka ekor
 * interpolasi juga dicoba sebagai query. Longgar ke arah yang aman: ia hanya
 * MENAMBAH pemanggil yang dinilai.
 */
function kandidatJalur(url: string): string[] {
  const keluar = new Set([normalJalur(url)]);
  const tanpaEkor = url.replace(/(?:\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})+$/, "");
  // Hanya bila interpolasinya MENEMPEL pada ruas (`…tata-letak${q}`), bukan
  // bila ia ruas tersendiri (`/penjualan/${id}` — itu parameter jalur).
  // Tanpa syarat ini `GET /penjualan/${selectedId}` ikut dicocokkan ke
  // `GET /penjualan` (daftar, yang memang memilih cabang) dan pemanggil DETAIL
  // yang benar tertuduh atas rute yang bukan miliknya.
  if (tanpaEkor !== url && tanpaEkor !== "" && !tanpaEkor.endsWith("/")) {
    keluar.add(normalJalur(tanpaEkor));
  }
  return [...keluar];
}

/**
 * Argumen PERTAMA sebuah panggilan — koma di dalam kurung/kurawal/template
 * tidak memotongnya. Tanpa ini `api(a ? "/x" : "/y", { method: "POST" })`
 * terbaca sampai `method`, dan `"POST"` ikut jadi kandidat jalur.
 */
function argPertama(arg: string): string {
  let dalam = 0;
  let kutip: string | null = null;
  for (let i = 0; i < arg.length; i += 1) {
    const c = arg[i];
    if (kutip) {
      if (c === "\\") i += 1;
      else if (c === kutip) kutip = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") kutip = c;
    else if (c === "(" || c === "{" || c === "[") dalam += 1;
    else if (c === ")" || c === "}" || c === "]") dalam -= 1;
    else if (c === "," && dalam === 0) return arg.slice(0, i);
  }
  return arg;
}

/**
 * Isi satu tag JSX pembuka, dari `<Komponen` sampai `>` penutupnya.
 *
 * `indexOf(">")` tidak cukup: hampir tiap tag punya `onClose={() => …}`, dan
 * `>` di dalam panah itu memotong tag-nya sebelum atribut yang dicari. Versi
 * pertama penelusur ini begitu, dan akibatnya `endpoint="/kategori-bahan"`
 * — atribut BERIKUTNYA — tak pernah terbaca. Kedalaman `{}` dihitung, jadi
 * `=>` di dalam kurawal tak pernah dianggap penutup tag.
 */
function badanTag(isi: string, mulai: number): string {
  let dalam = 0;
  for (let i = mulai; i < isi.length; i += 1) {
    const c = isi[i];
    if (c === "{") dalam += 1;
    else if (c === "}") dalam -= 1;
    else if (c === ">" && dalam === 0) return isi.slice(mulai, i);
  }
  return isi.slice(mulai, mulai + 800);
}

/**
 * Literal berjalur (`"/x"`, `` `/x/${id}` ``) yang UTUH di dalam sebuah
 * ekspresi.
 *
 * Regex tak bisa melakukan ini, dan versi pertama penelusur ini membuktikannya
 * dengan cara yang mahal: `[`"'](\/[^`"']*)` berhenti di backtick BERSARANG,
 * jadi `` `/rekomendasi/beli${branchQuery ? `${branchQuery}&` : "?"}…` ``
 * terpotong jadi `/rekomendasi/beli${branchQuery ? ` — jalur yang tak cocok ke
 * rute mana pun. Akibatnya penelusurnya tampak bekerja (bukti merahnya
 * menuduh, karena bentuk suntikannya kebetulan sederhana) padahal pada kode
 * sehat ia menyumbang NOL pemanggil. Cakupan palsu, hijau palsu.
 */
function literalJalur(teks: string): string[] {
  const keluar: string[] = [];
  for (let i = 0; i < teks.length; i += 1) {
    const q = teks[i];
    if (q !== "`" && q !== '"' && q !== "'") continue;
    let j = i + 1;
    let dalam = 0;
    for (; j < teks.length; j += 1) {
      const c = teks[j];
      if (c === "\\") {
        j += 1;
        continue;
      }
      if (q === "`" && c === "$" && teks[j + 1] === "{") dalam += 1;
      else if (q === "`" && c === "}" && dalam > 0) dalam -= 1;
      else if (c === q && dalam === 0) break;
      else if (q !== "`" && c === "\n") break;
    }
    const isi = teks.slice(i + 1, j);
    if (isi.startsWith("/")) keluar.push(isi);
    i = j;
  }
  return keluar;
}

/**
 * Nilai literal yang mungkin dipegang sebuah nama, ditelusuri ke sumbernya.
 *
 * Ini inti putaran ini. Dua puluh dua panggilan `api()` di `apps/web/src`
 * merakit URL-nya di variabel, dan gerbang versi lama MELEWATINYA diam-diam —
 * `if (!um || !um[1].startsWith("/")) continue`. Melewati bukan menilai:
 * pemanggil yang dilewati tak pernah bisa merah.
 *
 * Empat bentuk yang benar-benar dipakai repo ini, dan semuanya ditelusuri:
 *
 *   a. `const jalur = endpoint ?? `/bahan/${id}/supplier`;`     (nilai bawaan)
 *   b. prop JSX di INDUK: `<KategoriManagerModal endpoint="/kategori" />`
 *   c. tabel: `Record<Jenis, { endpoint: string }>` → `t.endpoint`
 *   d. pembantu lokal: `function buildUrl() { return `/rekomendasi/beli…` }`
 *
 * Satu nama bisa punya BEBERAPA nilai — `t.endpoint` adalah `/produksi` DAN
 * `/pembelian`. Semuanya dikembalikan; pemanggilnya baru aman bila SEMUA
 * calonnya aman. Menyimpulkan dari satu nilai saja adalah cara membuat sapuan
 * ini hijau palsu.
 */
function nilaiJalur(nama: string, isiBerkas: string, semuaWeb: string[], dalam = 0): string[] {
  const keluar = new Set<string>();
  const petik = (teks: string) => {
    for (const u of literalJalur(teks)) keluar.add(u);
  };
  const dasar = nama.split(".")[0];
  const medan = nama.includes(".") ? nama.split(".").slice(-1)[0] : null;

  // (c) tabel `{ …, endpoint: "/produksi", … }`
  if (medan) for (const q of isiBerkas.matchAll(new RegExp(`\\b${medan}\\s*:\\s*"(/[^"]*)"`, "g"))) keluar.add(q[1]);

  // (a) `const nama = …` di berkas yang sama
  for (const m of isiBerkas.matchAll(new RegExp(`\\bconst\\s+${dasar}\\b[^=\\n]*=\\s*([^\\n;]{0,300})`, "g"))) {
    petik(m[1]);
  }
  // (d) pembantu lokal: ambil `return` di dalam badannya
  const f = isiBerkas.search(new RegExp(`function\\s+${dasar}\\s*\\(`));
  if (f >= 0) {
    const buka = isiBerkas.indexOf("{", f);
    if (buka >= 0) for (const r of seimbang(isiBerkas, buka, "{", "}").matchAll(/return\s+([^\n;]{0,300})/g)) petik(r[1]);
  }
  // (b) prop JSX — nilainya ada di INDUK, jadi dicari lintas berkas. Tapi
  // hanya pada tag komponen yang DIDEFINISIKAN di berkas ini: versi pertama
  // menyapu tiap `endpoint=` di seluruh apps/web, jadi `KategoriManagerModal`
  // (yang endpoint-nya `/kategori`) ikut mewarisi `/perlengkapan/…` milik
  // `RiwayatHargaModal` — lalu tertuduh atas rute yang tak pernah dipanggilnya.
  if (keluar.size === 0) {
    const komponen = [
      ...isiBerkas.matchAll(/export (?:default )?function ([A-Z]\w*)/g),
      ...isiBerkas.matchAll(/export const ([A-Z]\w*)\s*[:=]/g),
    ].map((m) => m[1]);
    for (const isi of semuaWeb) {
      for (const k of komponen) {
        for (const tag of isi.matchAll(new RegExp(`<${k}\\b`, "g"))) {
          const badan = badanTag(isi, tag.index!);
          for (const q of badan.matchAll(new RegExp(`\\b${dasar}\\s*=\\s*(?:"(/[^"]*)"|\\{)`, "g"))) {
            if (q[1]) {
              keluar.add(q[1]);
              continue;
            }
            const nilai = badan.slice(q.index! + q[0].length);
            const lit = literalJalur(nilai);
            if (lit.length > 0) {
              for (const u of lit) keluar.add(u);
              continue;
            }
            // Prop yang nilainya VARIABEL (`endpoint={t.endpoint}`) butuh satu
            // lompatan lagi, di berkas INDUKNYA. `TambahStokPage` mengoper
            // `t.endpoint` ke tiga anak sekaligus; tanpa lompatan ini ketiganya
            // tak teresolusi, dan yang tak teresolusi tak pernah dinilai.
            const nama = /^\s*([A-Za-z_$][\w$.]*)/.exec(nilai)?.[1];
            if (nama && dalam < 2) for (const u of nilaiJalur(nama, isi, [], dalam + 1)) keluar.add(u);
          }
        }
      }
    }
  }
  // Upaya terakhir: nilai yang dioper lewat KEADAAN ROUTER, bukan prop —
  // `navigate(url, { state: { endpoint: t.endpoint } })`, lalu halaman
  // tujuannya membacanya dari `location.state`. Bentuk itu tak punya tag JSX
  // untuk ditelusuri, jadi entri `nama: nilai` dicari lintas berkas. Dipasang
  // PALING AKHIR dengan sengaja: ia yang paling mungkin memungut nilai milik
  // komponen lain, jadi ia hanya berjalan kalau semua cara yang lebih tepat
  // sudah gagal.
  if (keluar.size === 0 && dalam < 2) {
    for (const isi of semuaWeb) {
      for (const q of isi.matchAll(new RegExp(`\\b${dasar}\\s*:\\s*([A-Za-z_$][\\w$.]*)\\s*,`, "g"))) {
        for (const u of nilaiJalur(q[1], isi, [], dalam + 1)) keluar.add(u);
      }
    }
  }
  return [...keluar];
}

interface HasilPindai {
  panggilan: Panggilan[];
  /** Panggilan ber-URL variabel yang TAK berhasil ditelusuri — disebut, bukan disembunyikan. */
  takTeresolusi: string[];
  /** Berapa panggilan `api(` seluruhnya, dan berapa yang URL-nya variabel. */
  totalApi: number;
  urlVariabel: number;
}

function panggilanWeb(): HasilPindai {
  const rute = ruteMemilihCabang();
  const cocok = (metode: string, u: string): string | null => {
    const us = u.replace(/^\/|\/$/g, "").split("/");
    for (const r of rute) {
      if (r.metode !== metode) continue;
      const rs = r.jalur.replace(/^\/|\/$/g, "").split("/");
      if (rs.length !== us.length) continue;
      if (rs.every((a, i) => a.startsWith(":") || a === us[i])) return r.jalur;
    }
    return null;
  };
  const berkas = berkasKode(WEB, /\.tsx?$/);
  const isiSemua = berkas.map((p) => butaKomentar(readFileSync(p, "utf8")));
  const keluar: Panggilan[] = [];
  const takTeresolusi: string[] = [];
  let totalApi = 0;
  let urlVariabel = 0;
  for (let bi = 0; bi < berkas.length; bi += 1) {
    const p = berkas[bi];
    const s = isiSemua[bi];
    for (const i of posisiApi(s)) {
      totalApi += 1;
      const arg = seimbang(s, i, "(", ")");
      const baris = s.slice(0, i).split("\n").length;
      // Metodenya bisa TERNER: `method: item ? "PUT" : "POST"`. Regex lama
      // hanya mengenali `method: "PUT"`, jadi panggilan seperti itu terbaca
      // sebagai GET — dan `PerlengkapanPage:370` lalu tertuduh atas
      // `GET /perlengkapan`, rute yang tak pernah dipanggilnya. Penjaga yang
      // salah tuduh mengajari orang mengabaikannya (pagar #3).
      const metodeTeks = /method\s*:\s*([^,}]{0,80})/.exec(arg)?.[1] ?? "";
      const metodeSemua = [...metodeTeks.matchAll(/"(\w+)"/g)].map((x) => x[1].toUpperCase());
      const metodes = metodeSemua.length > 0 ? metodeSemua : ["GET"];
      const arg1 = argPertama(arg);
      // Tiap literal berjalur di argumen pertama ikut jadi kandidat — itu
      // sekaligus menangani bentuk terner `cond ? "/a" : "/b"`, yang dulu
      // dilewati karena argumennya tidak DIMULAI dengan kutip.
      const literal = [...arg1.matchAll(/[`"'](\/[^`"']*)/g)].map((m) => m[1]);
      const urls: { url: string; cara: "literal" | "telusur" }[] = [];
      if (literal.length > 0) {
        for (const u of literal) urls.push({ url: u, cara: "literal" });
      } else {
        urlVariabel += 1;
        // Bentuk `nama` polos, `nama(...)`, atau template berkepala `${nama}`.
        const kepala =
          /^\s*([A-Za-z_$][\w$.]*)\s*(?:\(\s*\))?\s*(?:,|$)/.exec(arg)?.[1] ??
          /^\s*`\$\{([A-Za-z_$][\w$.]*)\}/.exec(arg)?.[1] ??
          null;
        if (!kepala) {
          takTeresolusi.push(`${p.slice(WEB.length + 1)}:${baris}  ${arg.slice(0, 60).replace(/\s+/g, " ")}`);
          continue;
        }
        const nilai = nilaiJalur(kepala, s, isiSemua);
        if (nilai.length === 0) {
          takTeresolusi.push(`${p.slice(WEB.length + 1)}:${baris}  ${kepala}`);
          continue;
        }
        const ekor = /^\s*`\$\{[A-Za-z_$][\w$.]*\}([^`]*)/.exec(arg)?.[1] ?? "";
        for (const n of nilai) urls.push({ url: n + ekor, cara: "telusur" });
      }
      for (const { url, cara } of urls) {
        const pasangan = kandidatJalur(url).flatMap((j) =>
          metodes.filter((mt) => cocok(mt, j)).map((mt) => ({ j, mt })),
        );
        if (pasangan.length === 0) continue;
        const { j: jalurNorm, mt: metode } = pasangan[0];
        // Dinilai atas TEKS URL-nya — untuk panggilan berliteral itu teks di
        // tempat panggilan, untuk hasil telusur teks nilai yang ditelusuri
        // (di situlah `branchQuery` ditempelkan, mis. di dalam `buildUrl()`).
        // Sengaja BUKAN seluruh argumen: `branch_id` di BADAN permintaan bukan
        // cabang di URL, dan dua pemanggil memang begitu — keduanya punya
        // barisnya sendiri di DIKECUALIKAN, dan harus tetap begitu.
        const teks = url;
        const bawa =
          teks.includes("branch_id") ||
          [...teks.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].some((e) => bawaCabang(s, e[1]));
        keluar.push({ file: p.slice(WEB.length + 1), baris, metode, jalur: jalurNorm, url, bawa, cara });
      }
    }
  }
  return { panggilan: keluar, takTeresolusi, totalApi, urlVariabel };
}

describe("cabang ikut di URL untuk rute yang memilih sendiri cabangnya", () => {
  const semua = semuaRute();
  const rute = ruteMemilihCabang();
  const pindai = panggilanWeb();
  const panggilan = pindai.panggilan;

  it("premis: pemindainya benar-benar menemukan rute & pemanggilnya", () => {
    // Angka-angka ini adalah CAKUPAN, bukan hiasan. Versi lama menuntut
    // `rute > 30` dan `panggilan > 8` — jauh di bawah populasi sebenarnya,
    // jadi ia tetap hijau walau pemetanya kehilangan 31 rute dan pemindainya
    // kehilangan 23 panggilan. Batasnya kini dipasang tepat di bawah angka
    // terukur 2026-08-23, supaya kemunduran cakupan berteriak.
    expect(semua.length, "peta rute menciut").toBeGreaterThanOrEqual(270);
    expect(rute.length, "tak satu pun rute resolveBranchId terbaca").toBeGreaterThanOrEqual(55);
    expect(pindai.totalApi, "pemindai api() menciut").toBeGreaterThanOrEqual(320);
    // 22 panggilan ber-URL variabel; tiga di antaranya terner ber-literal
    // (`cond ? "/a" : "/b"`) yang kini terbaca langsung, jadi 19 sisanya yang
    // benar-benar butuh penelusuran nilai.
    expect(pindai.urlVariabel, "URL variabel tak lagi terlihat").toBeGreaterThanOrEqual(19);
    // Angka INI yang paling banyak bicara. Gerbang versi lama menilai **13**
    // pemanggil dari 303 panggilan `api(` yang dilihatnya — bukan karena 13
    // yang relevan, melainkan karena tiga kebutaan bertumpuk: peta rute yang
    // kehilangan 31 rute, regex yang kehilangan 23 panggilan, dan normalisasi
    // jalur yang membuang tiap URL berekor `${…}`. Sesudah ketiganya
    // diperbaiki: 75.
    expect(panggilan.length, "cakupan pemanggil menciut").toBeGreaterThanOrEqual(70);
  });

  it("premis: pemetanya tak lagi mengarang jalur HANTU, dan tak lagi kehilangan modul", () => {
    const kunci = new Set(semua.map((r) => `${r.metode} ${r.jalur}`));
    // Yang dulu hilang: `/customer/*` (dua Hono dalam satu berkas) dan seluruh
    // modul pabrik `/produksi` + `/pembelian`.
    for (const k of ["GET /customer", "PUT /customer/:id", "GET /produksi", "GET /pembelian"]) {
      expect(kunci.has(k), `rute ${k} tak terpetakan`).toBe(true);
    }
    // Yang dulu dikarang: `/customer/*` dicatat sebagai `/member-cari/*`.
    for (const h of ["PUT /member-cari/:id", "DELETE /member-cari/:id", "POST /member-cari"]) {
      expect(kunci.has(h), `jalur HANTU ${h} masih dikarang pemeta`).toBe(false);
    }
    // …dan `/member-cari` yang SUNGGUHAN tetap ada.
    expect(kunci.has("GET /member-cari")).toBe(true);
  });

  it("premis: tiap URL variabel BERHASIL ditelusuri — yang tidak, disebut namanya", () => {
    // Melewati yang tak teresolusi sama saja dengan menyapunya ke bawah
    // karpet: hijaunya lalu berarti "tidak diperiksa", bukan "aman". Satu
    // baris yang sah ada di daftar: definisi `api` itu sendiri di `lib/api.ts`.
    expect(pindai.takTeresolusi.filter((t) => !t.startsWith("lib/api.ts:"))).toEqual([]);
  });

  it("INTI: tiap pemanggilan membawa cabangnya, atau tercatat alasannya", () => {
    const telanjang = panggilan
      .filter((p) => !p.bawa)
      .filter((p) => !(`${p.file}|${p.metode}|${p.jalur}` in DIKECUALIKAN));
    expect(
      telanjang.map((p) => `${p.file}:${p.baris}  ${p.metode} ${p.url}`),
      `pemanggilan ke rute ber-resolveBranchId TANPA cabang. Untuk owner/admin ` +
        `server jatuh ke CABANG AKTIF PERTAMA, lalu menuntut sumber dayanya ada ` +
        `di sana — terukur 404 untuk enam pintu, dan HTTP 200 yang memindahkan ` +
        `meja cabang lain untuk PUT /meja/tata-letak. Tempelkan branchQuery di ` +
        `URL-nya, atau tambahkan barisnya ke DIKECUALIKAN dengan alasannya.`,
    ).toEqual([]);
  });

  it("PASANGAN: alasan pengecualian masih berlaku (rutenya masih ada & dipanggil)", () => {
    // Pengecualian yang menunjuk pemanggilan yang sudah tak ada adalah lubang
    // yang menganga diam-diam: ia tak pernah merah, dan ia melebarkan izin.
    const kunci = new Set(panggilan.map((p) => `${p.file}|${p.metode}|${p.jalur}`));
    for (const k of Object.keys(DIKECUALIKAN)) {
      expect(kunci.has(k), `pengecualian basi: ${k} tak lagi ada di apps/web`).toBe(true);
    }
  });

  /**
   * `tanpaKomentar` BUKAN kerapian, dan aku tahu itu karena versi pertama uji
   * ini tanpa dia. Komentar kepala berkas yang diperbaiki mengutip bentuk yang
   * benar (`/meja/${id}/kosongkan${branchQuery}`) untuk menjelaskan kenapa ia
   * benar — jadi saat bug aslinya kusuntikkan kembali, asersi di bawah tetap
   * HIJAU: yang dibacanya prosaku sendiri, bukan kodenya. Uji yang dijaga
   * komentarnya sendiri adalah uji yang tak bisa gagal.
   */
  const kode = (rel: string) => tanpaKomentar(readFileSync(join(WEB, rel), "utf8"));

  it("PASANGAN: enam pintu yang diperbaiki benar-benar menempelkan branchQuery", () => {
    // Source-pin, dan disebut apa adanya: ia menjaga BENTUKNYA. Yang menjaga
    // perilakunya pengukuran HTTP di komentar kepala berkas ini.
    const meja = kode("pages/pengaturan/MejaStatusPanel.tsx");
    expect(meja).toContain("/log${branchQuery}");
    expect(meja).toContain("/kosongkan${branchQuery}");
    const mejaPage = kode("pages/pengaturan/MejaPage.tsx");
    expect(mejaPage).toContain("/meja/tata-letak${branchQuery}");
    const pesanan = kode("pages/pesanan/PesananPage.tsx");
    for (const ekor of ["/status${branchQuery}", "/sajian${branchQuery}", "/log${branchQuery}"]) {
      expect(pesanan, `PesananPage kehilangan ${ekor}`).toContain(ekor);
    }
  });

  it("PASANGAN: kunci cache-nya ikut membawa cabang", () => {
    // URL berbeda WAJIB berkunci berbeda; kalau tidak, satu tempat di cache
    // menyimpan jawaban dua cabang bergantian.
    expect(kode("pages/pengaturan/MejaStatusPanel.tsx")).toContain(
      '["meja-log", meja.meja_id, branchQuery]',
    );
    expect(kode("pages/pesanan/PesananPage.tsx")).toContain(
      '["pesanan-log", pesanan.jenis, pesanan.id, branchQuery]',
    );
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh yang membawa cabang", () => {
    const s = 'const { query: branchQuery } = useCabangData();\nconst qs = `?x=1`;\n';
    expect(bawaCabang(s, "branchQuery")).toBe(true);
    expect(bawaCabang(s, "qs")).toBe(false);
    // satu lapis turunan
    const t = 'const branchQuery = "?branch_id=1";\nconst gabung = `${branchQuery}&page=1`;\n';
    expect(bawaCabang(t, "gabung")).toBe(true);
    // dan yang benar-benar tak ada hubungannya tetap tidak
    expect(bawaCabang(t, "halaman")).toBe(false);
  });
});

/**
 * PENJAGA UNTUK PENELUSURNYA SENDIRI.
 *
 * Sapuan di atas menilai 22 panggilan yang dulu DILEWATI. Melewati bukan
 * menilai: pemanggil yang dilewati tak pernah bisa merah, dan hijaunya berarti
 * "tak diperiksa", bukan "aman" (Aturan 7). Maka tiap bagian penelusurnya
 * diuji atas masukan sintetis — bukti merah yang tak bisa gagal mendarat —
 * dan yang menggantikan bentuk lama diuji BERPASANGAN dengan bentuk lama itu,
 * supaya uji ini menyatakan penelusurnya PERLU, bukan sekadar ada.
 */
describe("penelusur URL: tiap bagiannya bisa dibuktikan", () => {
  /** Regex pemindai versi lama — disimpan sebagai alat ukur, bukan dipakai. */
  const REGEX_LAMA = /\bapi\s*(?:<[^;]{0,200}?>)?\s*\(/g;

  it("BUKTI MERAH: argumen tipe ber-`;` terlihat sekarang, dan dulu tidak", () => {
    const contoh = 'api<{ ok: true; jumlah: number }>("/stok/awal", { method: "POST" });';
    expect(posisiApi(contoh)).toHaveLength(1);
    // Kalau baris ini pernah hijau dengan `toHaveLength(1)`, pemindainya sudah
    // dikembalikan ke regex lama dan 23 panggilan hilang lagi tanpa suara.
    expect([...contoh.matchAll(REGEX_LAMA)]).toHaveLength(0);
  });

  it("…dan bentuk tanpa argumen tipe tetap terlihat oleh keduanya", () => {
    const contoh = 'api("/menu");\napi<MenuDto[]>("/menu");';
    expect(posisiApi(contoh)).toHaveLength(2);
    expect([...contoh.matchAll(REGEX_LAMA)]).toHaveLength(2);
  });

  it("argumen pertama berhenti di koma tingkat atas, bukan di koma dalam kurung", () => {
    expect(argPertama('a ? "/x" : "/y", { method: "POST" }').trim()).toBe('a ? "/x" : "/y"');
    expect(argPertama('`/a/${f(1, 2)}/b`, { x: 1 }').trim()).toBe("`/a/${f(1, 2)}/b`");
    expect(argPertama('"/hanya-satu"').trim()).toBe('"/hanya-satu"');
  });

  it("`${…}` jadi `:x` dan query dibuang", () => {
    expect(normalJalur("/meja/${id}/log?branch_id=1")).toBe("/meja/:x/log");
    expect(normalJalur("/produksi")).toBe("/produksi");
  });

  describe("nilaiJalur menemukan nilainya, dan MENGEMBALIKAN SEMUANYA", () => {
    it("nilai bawaan `x ?? \"/lit\"`", () => {
      const s = 'const jalur = endpoint ?? `/bahan/${bahan.id}/supplier`;';
      expect(nilaiJalur("jalur", s, [])).toEqual(["/bahan/${bahan.id}/supplier"]);
    });

    it("tabel `Record<…, { endpoint }>` — DUA nilai, bukan satu", () => {
      const s =
        'const TEKS: Record<J, { endpoint: string }> = {\n' +
        '  produksi: { judul: "P", endpoint: "/produksi" },\n' +
        '  beli: { judul: "B", endpoint: "/pembelian" },\n};';
      expect(nilaiJalur("t.endpoint", s, []).sort()).toEqual(["/pembelian", "/produksi"]);
    });

    it("pembantu lokal — `return` di dalam badannya", () => {
      const s =
        "function buildUrl() {\n  const p = new URLSearchParams();\n" +
        "  return `/rekomendasi/beli${branchQuery ? `${branchQuery}&` : `?`}${p.toString()}`;\n}";
      expect(nilaiJalur("buildUrl", s, [])[0]).toContain("/rekomendasi/beli");
    });

    it("prop JSX dari INDUK, saat berkasnya sendiri tak menyebut nilainya", () => {
      const anak = "export function Modal({ endpoint }: { endpoint: string }) { return null; }";
      const induk = [
        '<Modal onClose={() => tutup()} endpoint="/kategori" />',
        "<Modal endpoint={`/bahan/${b.id}`} />",
      ];
      // `onClose={() => …}` sengaja ada: `>` di dalam panah itu dulu memotong
      // tag-nya sebelum `endpoint=` terbaca.
      expect(nilaiJalur("endpoint", anak, induk).sort()).toEqual(["/bahan/${b.id}", "/kategori"]);
    });

    it("prop yang nilainya VARIABEL ditelusuri satu lompatan lagi di induk", () => {
      const anak = "export function Detail({ endpoint }: { endpoint: string }) { return null; }";
      const induk = [
        'const TEKS = { a: { endpoint: "/produksi" }, b: { endpoint: "/pembelian" } };\n' +
          "<Detail endpoint={t.endpoint} />",
      ];
      expect(nilaiJalur("endpoint", anak, induk).sort()).toEqual(["/pembelian", "/produksi"]);
    });

    it("nama yang memang tak punya nilai jalur tetap kosong — bukan ditebak", () => {
      expect(nilaiJalur("entahApa", "const lain = 1;", ["<Y foo={1} />"])).toEqual([]);
    });

    it("BUKTI MERAH: `api(buildUrl())` dulu DILEWATI, sekarang dinilai", () => {
      // Saringan lama: argumen pertama harus DIMULAI dengan literal berjalur.
      // `buildUrl()` tidak, jadi `continue` — dan pemanggilnya tak pernah bisa
      // merah. Terukur: mencabut `branchQuery` dari `buildUrl()` di
      // `RekomendasiBeliPage` membuat sapuan versi baru menuduh berkas & baris
      // yang tepat (`:89`), sementara pemindai lama di berkas itu melihat 2
      // panggilan `api(` dan menilai 1 — yang bercacat justru yang dilewati.
      expect(/^\s*[`"']([^`"']*)/.exec("buildUrl()")).toBeNull();
      const sumber = "function buildUrl() {\n  return `/rekomendasi/beli?${p}`;\n}";
      expect(nilaiJalur("buildUrl", sumber, [])).toEqual(["/rekomendasi/beli?${p}"]);
    });
  });
});
