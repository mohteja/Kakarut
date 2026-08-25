import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * BADAN PERMINTAAN TIDAK MENERIMA KUNCI YANG TAK DIKENAL.
 *
 * Zod membuang kunci tak dikenal DIAM-DIAM kecuali skemanya `.strict()`.
 * Sebelum putaran ini, **0 dari 114** badan JSON di server ini strict — dan
 * diamnya sudah menggigit: `PUT /meja/tata-letak` menerima `branch_id` di
 * badan, membuangnya, lalu jatuh ke `resolveBranchId(c)` → cabang aktif
 * PERTAMA. Terukur waktu itu: **HTTP 200**, balasannya 7 meja cabang LAIN, dan
 * mejanya tetap di tempat semula. Tak ada satu pun tanda bahwa yang tersimpan
 * bukan denah yang diminta.
 *
 * Pengetatannya menemukan LIMA ketidakcocokan nyata, dan detektornya bukan
 * pengurai teks melainkan suite yang sudah ada — 2.161 uji satuan + 2.812
 * asersi `verify-api.sh` lewat HTTP sungguhan:
 *
 *   1. `POST /rekomendasi/menu` (pratinjau) menerima `tujuan_branch_id` yang
 *      tak pernah ada di skemanya — dan karena itu pratinjaunya selama ini
 *      dihitung terhadap cabang yang BERBEDA dari faktur yang diterbitkannya;
 *   2. `POST /open-bill` (4 panggilan uji) mengirim `is_dine_in`, milik
 *      `SaleBody`, bukan `BillBody`;
 *   3. `POST /kebersihan` menerima `tanggal` yang komentarnya sendiri sudah
 *      menyatakan "SENGAJA tidak diterima";
 *   4. `POST /shift/tutup` memang HARUS menerima kunci asing — lihat
 *      pengecualian di bawah;
 *   5. jembatan `/sync` meneruskan `branch_id` ke `/perlengkapan/:id/pakai`,
 *      rute yang membaca cabangnya dari QUERY dan tak pernah membaca kunci itu.
 *
 * YANG DIJAGA DI SINI: bentuknya, bukan himpunan kuncinya. Uji ini memetakan
 * rute → NAMA skema dan menuntut skemanya strict. Ia SENGAJA tidak membaca
 * daftar kunci tiap skema — justru bagian itu yang salah enam kali saat
 * pengintaian putaran ini (spread objek di dalam `z.object`, `z.object(X)`
 * ber-identifier telanjang, rantai `.omit().extend()`, dan tabrakan nama skema
 * antar modul). Penjaga yang memakai pengurai rapuh sebagai buktinya akan
 * menuduh kode yang benar, dan penjaga yang salah tuduh mengajari orang
 * mengabaikannya.
 */
const SRC = fileURLToPath(new URL("../src/", import.meta.url)).replace(/\/$/, "");

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

const BERKAS = berkasTs(SRC).sort();
const ISI = new Map(BERKAS.map((p) => [p, butaKomentar(readFileSync(p, "utf8"))]));

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

interface Pemakaian {
  berkas: string;
  baris: number;
  /** nama skema, atau `(inline)` bila ditulis langsung di zValidator */
  skema: string;
  strict: boolean;
}

/**
 * Apakah definisi `nama` di berkas ini berakhir strict?
 *
 * `.strict()` MENURUN lewat `.extend()`, `.partial()`, dan `.omit()` — itu
 * dijalankan, bukan diingat (uji "zod menurunkan strict" di bawah). Jadi skema
 * turunan cukup ditelusuri ke induknya.
 */
function skemaStrict(isi: string, nama: string, dalam = 0): boolean {
  if (dalam > 4) return false;
  const langsung = new RegExp(`const ${nama}\\s*=\\s*z\\s*\\.\\s*object\\s*\\(`).exec(isi);
  if (langsung) {
    const buka = langsung.index + langsung[0].length - 1;
    let d = 0;
    for (let j = buka; j < isi.length; j += 1) {
      if (isi[j] === "(") d += 1;
      else if (isi[j] === ")") {
        d -= 1;
        if (d === 0) return /^\s*\.\s*strict\s*\(\s*\)/.test(isi.slice(j + 1));
      }
    }
    return false;
  }
  const turunan = new RegExp(`const ${nama}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\.`).exec(isi);
  if (turunan) return skemaStrict(isi, turunan[1], dalam + 1);
  return false;
}

function pemakaian(): Pemakaian[] {
  const keluar: Pemakaian[] = [];
  for (const p of BERKAS) {
    const s = ISI.get(p)!;
    for (const m of s.matchAll(/zValidator\(\s*"json"\s*,\s*/g)) {
      const i = m.index! + m[0].length;
      const baris = s.slice(0, m.index!).split("\n").length;
      const berkas = p.replace(SRC + "/", "");
      if (/^z\s*\.\s*object\s*\(/.test(s.slice(i))) {
        // inline: cari `)` penutup `z.object(` lalu lihat apa yang menyusul
        const buka = s.indexOf("(", i + 1);
        let d = 0;
        let akhir = -1;
        for (let j = buka; j < s.length; j += 1) {
          if (s[j] === "(") d += 1;
          else if (s[j] === ")") {
            d -= 1;
            if (d === 0) {
              akhir = j;
              break;
            }
          }
        }
        keluar.push({
          berkas,
          baris,
          skema: "(inline)",
          strict: akhir > 0 && /^\s*\.\s*strict\s*\(\s*\)/.test(s.slice(akhir + 1)),
        });
        continue;
      }
      const nm = /^([A-Za-z_$][\w$]*)/.exec(s.slice(i));
      if (!nm) continue;
      // Skema bisa didefinisikan di berkas lain (mis. `SaleBody` yang diimpor
      // `sync`), jadi definisinya dicari di SELURUH pohon — dan tabrakan nama
      // antar modul memang ada, maka yang menang definisi di berkas ini dulu.
      const punyaSendiri = new RegExp(`const ${nm[1]}\\s*=`).test(s);
      const strict = punyaSendiri
        ? skemaStrict(s, nm[1])
        : [...ISI.values()].some((lain) => new RegExp(`const ${nm[1]}\\s*=`).test(lain) && skemaStrict(lain, nm[1]));
      keluar.push({ berkas, baris, skema: nm[1], strict });
    }
  }
  return keluar;
}

/**
 * Pintu yang SENGAJA tetap menerima kunci asing. Dua-duanya punya alasan yang
 * bisa diperiksa, dan satu punya syarat cabut.
 */
const DIKECUALIKAN: Record<string, string> = {
  "modules/meja/routes.ts|TataLetakBody":
    "Ketujuh build ponsel yang pernah rilis (1.0.0+3 … +10) mengirim `branch_id` " +
    "di badan sini, termasuk yang terpasang hari ini — perbaikannya (4e02a0b) " +
    "belum tayang, dan repo ini tak punya gerbang versi klien. SYARAT CABUT: " +
    "sesudah build ber-4e02a0b tayang dan build lama habis dari lapangan.",
  "modules/shift/routes.ts|(inline)":
    "`POST /shift/tutup` — aturannya sudah ditulis verify-api §152: klien yang " +
    "mengirim field tak dikenal tak boleh gagal menutup shift, karena itu " +
    "terjadi tepat saat kasir mau pulang dan lacinya jadi tak bisa ditutup.",
};

describe("premis: penyapunya benar-benar melihat badan JSON", () => {
  const semua = pemakaian();

  it("menemukan seluruh populasi zValidator json", () => {
    // Tanpa angka ini, regex yang tak lagi cocok membuat gerbangnya hijau
    // dengan populasi nol — izin terbuka, bukan penjagaan.
    expect(semua.length, "populasi badan JSON menciut").toBeGreaterThanOrEqual(110);
    expect(new Set(semua.map((x) => x.berkas)).size).toBeGreaterThan(25);
  });

  it("zod BENAR-BENAR menurunkan `.strict()` lewat extend/partial/omit", () => {
    // Dijalankan, bukan diingat: seluruh cara kerja penjaga ini bertumpu
    // padanya. Kalau zod berubah, uji INI yang merah — bukan sapuannya yang
    // diam-diam salah menyimpulkan.
    const dasar = z.object({ a: z.string(), b: z.string().optional() }).strict();
    for (const [nama, s] of [
      ["strict", dasar],
      ["extend", dasar.extend({ c: z.string().optional() })],
      ["partial", dasar.partial()],
      ["omit", dasar.omit({ b: true })],
    ] as const) {
      expect(s.safeParse({ a: "x", zz: 1 }).success, `${nama} meloloskan kunci asing`).toBe(false);
    }
    expect(z.object({ a: z.string() }).safeParse({ a: "x", zz: 1 }).success).toBe(true);
  });

  it("pembaca `.strict()`-nya bisa membedakan yang ketat dari yang longgar", () => {
    const contoh =
      'const Ketat = z.object({ a: z.string() }).strict();\n' +
      "const Longgar = z.object({ b: z.string() });\n" +
      "const Turun = Ketat.partial();\n" +
      "const TurunLonggar = Longgar.partial();\n";
    expect(skemaStrict(contoh, "Ketat")).toBe(true);
    expect(skemaStrict(contoh, "Longgar")).toBe(false);
    expect(skemaStrict(contoh, "Turun")).toBe(true);
    expect(skemaStrict(contoh, "TurunLonggar")).toBe(false);
  });
});

describe("tiap badan JSON menolak kunci yang tak dikenal", () => {
  const semua = pemakaian();
  const longgar = semua.filter((x) => !x.strict);

  it("INTI: tak ada badan longgar di luar yang dikecualikan", () => {
    const sisa = longgar.filter((x) => !(`${x.berkas}|${x.skema}` in DIKECUALIKAN));
    expect(
      sisa.map((x) => `${x.berkas}:${x.baris}  ${x.skema}`),
      "badan JSON tanpa `.strict()` MEMBUANG kunci tak dikenal tanpa suara — " +
        "kiriman yang salah dan kiriman yang benar menghasilkan balasan yang " +
        "sama persis. Tambahkan `.strict()`, atau daftarkan di DIKECUALIKAN " +
        "dengan alasan yang bisa diperiksa (dan syarat cabutnya).",
    ).toEqual([]);
  });

  it("PASANGAN: pengecualiannya masih benar-benar longgar (tak basi)", () => {
    // Pengecualian yang situsnya sudah strict diam-diam melebarkan izin untuk
    // skema BARU yang kelak dinamai sama di berkas itu.
    const kunciLonggar = new Set(longgar.map((x) => `${x.berkas}|${x.skema}`));
    for (const k of Object.keys(DIKECUALIKAN)) {
      expect(kunciLonggar.has(k), `pengecualian basi: ${k} ternyata sudah strict`).toBe(true);
    }
  });

  it("PASANGAN: hampir semuanya strict — bukan hampir semuanya dikecualikan", () => {
    // Gerbang yang dipenuhi pengecualian adalah gerbang yang sudah menyerah.
    expect(longgar.length).toBeLessThanOrEqual(Object.keys(DIKECUALIKAN).length);
    expect(semua.filter((x) => x.strict).length).toBeGreaterThanOrEqual(100);
  });
});

describe("pesan galatnya menyebut kunci yang ditolak", () => {
  it("`unrecognized_keys` punya kalimatnya sendiri di validator", () => {
    // Tanpa kasus ini pesannya jatuh ke bawaan zod — bahasa Inggris — dan
    // karena `path`-nya kosong, labelnya cuma "Isian". Berkas `validator.ts`
    // ada justru karena pesan validasi pernah tampil "[object Object]".
    const v = ISI.get(join(SRC, "lib/validator.ts"))!;
    const i = v.indexOf('case "unrecognized_keys"');
    expect(i).toBeGreaterThan(0);
    // Jendelanya lebar karena komentar di antaranya panjang — dan komentar itu
    // sudah dikupas jadi spasi, jadi 400 aksara pertama seluruhnya kosong.
    expect(v.slice(i, i + 1500)).toContain("isian tak dikenal");
  });
});
