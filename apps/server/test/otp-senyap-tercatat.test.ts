import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { SRC } from "./util/sql-mentah";

/**
 * CABANG YANG MEMUTUSKAN "TIDAK USAH KIRIM" WAJIB MENCATATNYA.
 *
 * Kelas ini dibayar dua kali dalam satu hari, dan yang kedua justru lahir dari
 * perbaikan yang pertama.
 *
 * Putaran pertama membuat KEGAGALAN kirim berbunyi (`kirimEmailDiam`,
 * `email_keadaan`, temuan `email_gagal_kirim`). Itu bekerja. Tapi laporan
 * berikutnya menunjukkan ia menjawab pertanyaan yang salah:
 *
 *     surat uji ke alamat X          → SAMPAI
 *     kode OTP ke alamat X yang sama → tak sampai, tak ada di spam
 *     panel                          → tak ada temuan sama sekali
 *
 * Panel yang diam punya DUA tafsir yang berlawanan — "semua berhasil" dan "tak
 * ada yang pernah dicoba" — dan tak ada cara memilih di antaranya. Sebabnya
 * struktural: `auth/routes.ts` punya cabang-cabang yang membalas 200 "kami
 * telah mengirim KODE verifikasi 6 digit. Cek email Anda" TANPA pernah
 * memanggil pengirimnya, dan tanpa meninggalkan satu jejak pun.
 *
 * Terukur lewat HTTP + Postgres sungguhan sebelum diperbaiki: mendaftar ulang
 * email yang sudah ada tidak menulis satu baris token pun, tidak mengirim apa
 * pun, dan balasannya identik byte-per-byte dengan pendaftaran yang berhasil.
 *
 * YANG DIJAGA BERKAS INI: tiap cabang kelayakan di `auth/routes.ts` harus
 * BERAKHIR pada salah satu dari dua hal — mengirim, atau mencatat kenapa
 * tidak. Tak ada pilihan ketiga.
 *
 * BATASNYA, ditulis jujur: pemindai ini leksikal, bukan pengurai TypeScript.
 * Ia hanya melihat cabang `if`/`else if` yang KONDISINYA menyebut salah satu
 * pengenal kelayakan di bawah. Cabang yang menyembunyikan keputusannya di
 * dalam pembantu, atau yang memakai nama medan lain, tak terlihat olehnya —
 * dan itu sebabnya jumlah situsnya IKUT DIPAKU: bentuk baru yang tak
 * terlihat tetap menggeser angkanya dan menagih satu keputusan.
 */

const AUTH = join(SRC, "modules/auth/routes.ts");
const SERVICE = join(SRC, "modules/mail/service.ts");

/** Yang dianggap "berakhir benar": mengirim, atau mencatat kenapa tidak. */
const AKHIR_SAH = ["kirimKodeVerifikasi", "kirimEmailDiam", "catatTakDicoba"];

/** Yang dihitung sebagai "lengan ini MENGIRIM". */
const PENGIRIM = ["kirimKodeVerifikasi", "kirimEmailDiam"];

/** Posisi kurung/kurawal penutup yang seimbang, mulai dari pembukanya di [i]. */
function seimbang(s: string, i: number, buka: string, tutup: string): number {
  let dalam = 0;
  for (let j = i; j < s.length; j += 1) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      const tanda = c;
      j += 1;
      while (j < s.length && s[j] !== tanda) j += s[j] === "\\" ? 2 : 1;
      continue;
    }
    if (c === buka) dalam += 1;
    else if (c === tutup) {
      dalam -= 1;
      if (dalam === 0) return j;
    }
  }
  return -1;
}

/**
 * RANTAI `if / else if / else` yang salah satu lengannya MENGIRIM SURAT.
 *
 * Penyaringnya sengaja inilah, bukan "kondisinya menyebut `user`/`existing`".
 * Versi pertama memakai penyaring pengenal itu dan langsung menuduh LIMA
 * cabang yang sah — penjaga login, penjaga `/verify-email`, penjaga
 * `/reset-password` — yang semuanya memang tak ada urusannya dengan surat.
 * Tuduhan palsu lebih merusak gerbang daripada diam: ia mengajari orang
 * mendaftarkan pengecualian sampai daftarnya berhenti berarti.
 *
 * Bentuk yang benar-benar dicari jauh lebih sempit dan jauh lebih tepat: satu
 * rantai keputusan yang UJUNGNYA mengirim surat. Begitu sebuah rantai punya
 * lengan pengirim, seluruh lengannya sedang menjawab pertanyaan yang sama —
 * "surat ini dikirim atau tidak?" — dan lengan yang menjawab "tidak" wajib
 * mengatakan kenapa.
 *
 * Diekspor supaya bisa diberi sumber sintetis di blok "instrumennya bisa
 * menuduh".
 */
export function rantaiKirim(isi: string): { kondisi: string; badan: string }[][] {
  const s = butaKomentar(isi);
  const keluar: { kondisi: string; badan: string }[][] = [];
  const sudah = new Set<number>();
  for (const m of s.matchAll(/(?<![\w$])if\s*\(/g)) {
    const mulai = m.index!;
    if (sudah.has(mulai)) continue;
    // Kepala rantai saja: `else if` diambil lewat penelusuran di bawah.
    if (/else\s*$/.test(s.slice(Math.max(0, mulai - 8), mulai))) continue;

    const lengan: { kondisi: string; badan: string }[] = [];
    let i = mulai;
    for (;;) {
      sudah.add(i);
      const bukaKurung = s.indexOf("(", i);
      const tutupKurung = seimbang(s, bukaKurung, "(", ")");
      if (tutupKurung < 0) break;
      const bukaKurawal = s.indexOf("{", tutupKurung);
      // `if (x) return …;` tanpa kurawal — kurawal berikutnya milik orang lain.
      if (bukaKurawal < 0 || s.slice(tutupKurung + 1, bukaKurawal).includes(";")) break;
      const tutupKurawal = seimbang(s, bukaKurawal, "{", "}");
      if (tutupKurawal < 0) break;
      lengan.push({
        kondisi: s.slice(bukaKurung + 1, tutupKurung).trim(),
        badan: s.slice(bukaKurawal + 1, tutupKurawal),
      });
      const sisa = s.slice(tutupKurawal + 1);
      const lanjut = /^\s*else\s*(if\s*\()?/.exec(sisa);
      if (!lanjut) break;
      if (lanjut[1]) {
        i = tutupKurawal + 1 + lanjut[0].length - lanjut[1].length;
        continue;
      }
      // `else { … }` penutup — lengan tanpa kondisi.
      const bk = s.indexOf("{", tutupKurawal + 1);
      const tk = seimbang(s, bk, "{", "}");
      if (tk < 0) break;
      lengan.push({ kondisi: "else", badan: s.slice(bk + 1, tk) });
      break;
    }
    if (lengan.some((l) => PENGIRIM.some((p) => l.badan.includes(p)))) keluar.push(lengan);
  }
  return keluar;
}

/** Literal serikat `SebabTakDicoba` seperti tertulis di sumbernya. */
export function sebabDariSumber(isi: string): string[] {
  const s = butaKomentar(isi);
  const i = s.indexOf("export type SebabTakDicoba");
  if (i < 0) return [];
  const akhir = s.indexOf(";", i);
  return [...s.slice(i, akhir).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** Sebab yang benar-benar dipakai di sebuah berkas. */
export function sebabDipakai(isi: string): string[] {
  const s = butaKomentar(isi);
  return [...s.matchAll(/catatTakDicoba\([^)]*?"([a-z_]+)"\s*\)/gs)].map((m) => m[1]);
}

/**
 * Tiap sebab, dengan kalimat yang menjelaskan KAPAN ia benar.
 *
 * Daftar, bukan pola: sebab baru menuntut satu keputusan yang ditulis di sini,
 * dan itulah satu-satunya gunanya.
 */
const SEBAB: Record<string, string> = {
  balapan_pendaftaran:
    "dua /register beremail sama berpapasan; yang kalah menabrak users_email_unique " +
    "dan tak punya baris user untuk dikirimi",
  akun_terhapus: "barisnya ada tapi sudah dihapus lunak — tak ada akun untuk diaktifkan",
  akun_nonaktif: "akun dinonaktifkan admin; verifikasi tak akan menghidupkannya",
  akun_terverifikasi:
    "sudah terverifikasi — jalannya MASUK, bukan verifikasi ulang. Ini satu-satunya " +
    "sebab yang dulu membuat sebuah alamat diam SELAMANYA: sekali emailVerifiedAt " +
    "terisi, tak ada rute yang mengosongkannya kembali",
  jarak_kirim_ulang:
    "ditahan jarak 120 detik antar kiriman; sah, dan justru inilah keadaan yang paling " +
    "sering disalahartikan sebagai 'emailnya hilang'",
  email_tak_dikenal:
    "alamatnya tak ada di users. Jawabannya tetap 200 supaya tak jadi oracle enumerasi, " +
    "jadi catatan inilah satu-satunya tempat keadaan ini terlihat",
  penyedia_belum_diatur:
    "tak ada SMTP maupun Resend sama sekali — suratnya tak pernah sampai ke penyedia " +
    "mana pun. Dicatat di sini walau `email_keadaan` sengaja tidak (temuan email_mati " +
    "sudah bicara untuk keadaan itu)",
};

describe("cabang yang memutuskan TIDAK mengirim wajib mencatatnya", () => {
  const isiAuth = readFileSync(AUTH, "utf8");
  const isiService = readFileSync(SERVICE, "utf8");
  const rantai = rantaiKirim(isiAuth);

  it("premis: sapuannya benar-benar menemukan rantai pengirimnya", () => {
    // Sapuan yang menemukan nol rantai hijau tanpa menyatakan apa pun.
    // Terukur 3 saat gerbang ini ditulis: /register, /resend-verification,
    // /forgot-password.
    expect(rantai.length).toBeGreaterThanOrEqual(3);
    expect(rantai.reduce((n, r) => n + r.length, 0)).toBeGreaterThanOrEqual(12);
    expect(isiAuth).toContain("catatTakDicoba");
  });

  it("tiap lengan rantai pengirim berakhir: mengirim, atau mencatat kenapa tidak", () => {
    const pelanggar = rantai
      .flat()
      .filter((b) => !AKHIR_SAH.some((n) => b.badan.includes(n)))
      .map((b) => `if (${b.kondisi.replace(/\s+/g, " ").slice(0, 80)}) — tak mengirim, tak mencatat`);
    expect(
      pelanggar,
      `${pelanggar.join("\n")}\n\nPilih SATU: kirim suratnya, atau panggil ` +
        "`catatTakDicoba(konteks, email, sebab)` dengan sebab dari `SebabTakDicoba`. " +
        "Cabang yang membalas 200 'cek email Anda' tanpa keduanya adalah bentuk yang " +
        "membuat bug 2026-09-01 tak bisa didiagnosis dari mana pun.",
    ).toEqual([]);
  });

  it("jumlah situsnya dipaku — bentuk baru menggeser angkanya", () => {
    // Bukan kerapian: pemindai ini leksikal, jadi cabang berbentuk lain lolos
    // dari asersi di atas. Angka inilah yang menagih keputusan untuk bentuk
    // yang belum dikenalnya.
    expect(sebabDipakai(isiAuth)).toHaveLength(12);
  });

  it("tiap sebab yang dipakai punya alasan tertulis, dan sebaliknya", () => {
    const serikat = sebabDariSumber(isiService);
    expect(serikat.length, "SebabTakDicoba terbaca dari sumbernya").toBeGreaterThanOrEqual(7);

    const takBeralasan = serikat.filter((s) => !SEBAB[s]);
    expect(takBeralasan, `sebab tanpa alasan tertulis: ${takBeralasan.join(", ")}`).toEqual([]);

    const kuburan = Object.keys(SEBAB).filter((s) => !serikat.includes(s));
    expect(kuburan, `alasan untuk sebab yang sudah tak ada: ${kuburan.join(", ")}`).toEqual([]);

    // Sebab yang tak pernah dipakai satu pintu pun adalah kosakata mati — ia
    // membuat daftar ini tampak lebih lengkap daripada yang sebenarnya dijaga.
    const dipakai = new Set([...sebabDipakai(isiAuth), ...sebabDipakai(isiService)]);
    // `penyedia_belum_diatur` ditulis lewat catatPercobaan, bukan catatTakDicoba.
    dipakai.add("penyedia_belum_diatur");
    const tanpaPemakai = serikat.filter((s) => !dipakai.has(s));
    expect(tanpaPemakai, `sebab yang tak dipakai pintu mana pun: ${tanpaPemakai.join(", ")}`).toEqual(
      [],
    );
  });

  it("SETIAP hasil kirim tercatat — sukses, gagal, dan tanpa-penyedia", () => {
    // Tabelnya tak berguna bila hanya kegagalan yang masuk: "tak ada baris"
    // akan kembali punya dua tafsir yang berlawanan, yaitu persis kebutaan
    // yang berkas ini ada untuk menghapusnya.
    for (const hasil of ['hasil: "terkirim"', 'hasil: "gagal"', 'hasil: "tak_dicoba"']) {
      expect(butaKomentar(isiService), `\`${hasil}\` tak pernah ditulis`).toContain(hasil);
    }
  });
});

/**
 * ATURAN 7 — alat ukurnya sendiri diuji.
 *
 * Ketiga asersi di atas hijau juga bila pemindainya tak pernah cocok dengan
 * apa pun. Blok ini memberinya sumber palsu yang jelas salah dan menuntutnya
 * menuduh.
 */
describe("instrumennya bisa menuduh", () => {
  const KIRIM = 'await kirimEmailDiam(p, "x");';

  it("lengan yang tak mengirim & tak mencatat tertangkap", () => {
    const buruk = `if (u.emailVerifiedAt) { return c.json({ ok: true }); } else { ${KIRIM} }`;
    const [r] = rantaiKirim(buruk);
    expect(r).toHaveLength(2);
    expect(AKHIR_SAH.some((n) => r[0].badan.includes(n))).toBe(false);
  });

  it("lengan yang mencatat DITERIMA", () => {
    const baik = `if (u.deletedAt) { await catatTakDicoba("v", e, "akun_terhapus"); } else { ${KIRIM} }`;
    const [r] = rantaiKirim(baik);
    expect(r.every((l) => AKHIR_SAH.some((n) => l.badan.includes(n)))).toBe(true);
  });

  it("rantai TANPA lengan pengirim tidak ikut tertarik — ini yang dulu salah", () => {
    // Versi pertama pemindai ini menuduh penjaga login, penjaga /verify-email,
    // dan penjaga /reset-password: lima tuduhan, kelimanya sah.
    const login = `if (!user || user.deletedAt || !user.isActive) { throw new HTTPException(401); }`;
    expect(rantaiKirim(login)).toEqual([]);
  });

  it("seluruh lengan terkumpul: if · else if · else", () => {
    const tiga = `if (a) { catatTakDicoba(1); } else if (b) { catatTakDicoba(2); } else { ${KIRIM} }`;
    const [r] = rantaiKirim(tiga);
    expect(r.map((l) => l.kondisi)).toEqual(["a", "b", "else"]);
  });

  it("kurawal bersarang tidak memotong lengan terlalu awal", () => {
    const sarang = `if (a) { if (x) { y(); } await catatTakDicoba("a", e, "akun_nonaktif"); } else { ${KIRIM} }`;
    const [r] = rantaiKirim(sarang);
    expect(r[0].badan).toContain("catatTakDicoba");
  });

  it("prosa yang mengutip bentuk terlarang tidak menuduh", () => {
    expect(rantaiKirim(`// if (u.emailVerifiedAt) { diam } else { kirimEmailDiam() }\nconst a = 1;`)).toEqual(
      [],
    );
  });

  it("serikat sebab terbaca dari sumbernya, bukan diketik ulang", () => {
    const palsu = `export type SebabTakDicoba =\n  | "satu"\n  | "dua";\n`;
    expect(sebabDariSumber(palsu)).toEqual(["satu", "dua"]);
    expect(sebabDariSumber("tak ada apa-apa di sini")).toEqual([]);
  });
});
