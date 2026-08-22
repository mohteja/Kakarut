import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
 * Idiom yang sudah dipakai `analisis-harga-gagal-muat` & `bahan-grid-angka`:
 * pembantu LOKAL, bukan impor lintas berkas uji (mengimpornya ikut menjalankan
 * suite tetangga di dalam berkas ini).
 */
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

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

/** Prefiks tiap modul rute, dibaca dari `app.ts` — bukan ditebak. */
function mount(): Map<string, string> {
  const app = readFileSync(join(SRV, "app.ts"), "utf8");
  const m = new Map<string, string>();
  for (const r of app.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
    if (!m.has(r[2])) m.set(r[2], r[1]);
  }
  return m;
}

/** Rute (metode + jalur penuh) yang badan handler-nya memanggil resolveBranchId. */
function ruteMemilihCabang(): { metode: string; jalur: string }[] {
  const prefiks = mount();
  const keluar: { metode: string; jalur: string }[] = [];
  for (const p of berkasKode(SRV, /\.ts$/)) {
    const s = readFileSync(p, "utf8");
    let pre: string | undefined;
    for (const e of s.matchAll(/export const (\w+)\s*=\s*new Hono/g)) {
      if (prefiks.has(e[1])) {
        pre = prefiks.get(e[1]);
        break;
      }
    }
    if (pre === undefined) continue;
    for (const m of s.matchAll(/\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g)) {
      const isi = seimbang(s, m.index! + 1 + m[1].length, "(", ")");
      if (!isi.includes("resolveBranchId(")) continue;
      keluar.push({
        metode: m[1].toUpperCase(),
        jalur: (pre + m[2]).replace(/\/\//g, "/").replace(/\/$/, "") || "/",
      });
    }
  }
  return keluar;
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
}

function panggilanWeb(): Panggilan[] {
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
  const keluar: Panggilan[] = [];
  for (const p of berkasKode(WEB, /\.tsx?$/)) {
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(/\bapi\s*(?:<[^;]{0,200}?>)?\s*\(/g)) {
      const arg = seimbang(s, m.index! + m[0].length - 1, "(", ")");
      const um = /^\s*[`"']([^`"']*)/.exec(arg);
      if (!um || !um[1].startsWith("/")) continue;
      const url = um[1];
      const mm = /method\s*:\s*"(\w+)"/.exec(arg);
      const metode = mm ? mm[1].toUpperCase() : "GET";
      const jalurNorm =
        (url.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ":x").split("?")[0].replace(/\/$/, "") ||
          "/");
      const jalur = cocok(metode, jalurNorm);
      if (!jalur) continue;
      const bawa =
        url.includes("branch_id") ||
        [...url.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].some((e) => bawaCabang(s, e[1]));
      keluar.push({
        file: p.slice(WEB.length + 1),
        baris: s.slice(0, m.index!).split("\n").length,
        metode,
        jalur: jalurNorm,
        url,
        bawa,
      });
    }
  }
  return keluar;
}

describe("cabang ikut di URL untuk rute yang memilih sendiri cabangnya", () => {
  const rute = ruteMemilihCabang();
  const panggilan = panggilanWeb();

  it("premis: pemindainya benar-benar menemukan rute & pemanggilnya", () => {
    // Tanpa dua angka ini, regex yang tak lagi cocok membuat gerbangnya hijau
    // dengan populasi nol — yaitu izin terbuka, bukan penjagaan.
    expect(rute.length, "tak satu pun rute resolveBranchId terbaca").toBeGreaterThan(30);
    expect(panggilan.length, "tak satu pun pemanggilan web tercocokkan").toBeGreaterThan(8);
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
