import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PESAN_DAFTAR, SEBAB_DAFTAR, SEBAB_LOGIN } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * `/register` & `/resend-verification` MENYEBUT SEBABNYA — dan log internal
 * tak boleh menyimpang dari jawaban yang diterima klien.
 *
 * Sampai 2026-09-05 kedua pintu membalas SATU jawaban untuk tiga belas
 * keadaan. Yang membuat vena ini bukan sekadar "tambah medan": servernya
 * SUDAH menamai tiap keadaan dan menuliskannya lewat `catatTakDicoba`
 * (kosakata `SebabTakDicoba`) — hanya kliennya yang dibutakan. Komentar di
 * jalur jarak kirim ulang bahkan menyebut akibatnya: *"Dari luar keadaan ini
 * tak bisa dibedakan dari 'terkirim' … barisnya inilah satu-satunya tempat
 * orang bisa melihat bahwa surat yang ditunggu memang tak pernah berangkat."*
 *
 * KEPUTUSAN PEMILIK 2026-09-05, sesudah biayanya disampaikan: enumerasi akun
 * kini terbuka di pintu yang TAK butuh password. Penahannya batas laju, bukan
 * kerahasiaan jawaban. Yang dijaga di sini bukan keputusan itu (itu miliknya),
 * melainkan bahwa pelaksanaannya tetap utuh:
 *
 *  - `PESAN_DAFTAR` berpasangan SATU-SATU dengan `SEBAB_DAFTAR`;
 *  - tiga nilai yang keadaannya sama dengan `/login` MEMAKAI ULANG nilainya —
 *    keadaan yang sama tak boleh punya dua nama;
 *  - tiap `catatTakDicoba` di jalur verifikasi-email berpasangan dengan
 *    penetapan `sebab` — kalau tidak, log dan klien mulai bercerita beda;
 *  - kedua balasan membawa `sebab` DAN kalimat dari `PESAN_DAFTAR` (bukan
 *    kalimat yang dirakit di tempat);
 *  - `/forgot-password` TIDAK ikut — ia tetap netral (dipaku spec peramban).
 *
 * Lengan HTTP-nya verify-api §299; sisi ponsel di `kakarut-mobile`.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const RUTE = "apps/server/src/modules/auth/routes.ts";
const WEB_SIGNUP = "apps/web/src/pages/SignupPage.tsx";

const rute = butaKomentar(readFileSync(AKAR + RUTE, "utf8"));

/**
 * Tiap `catatTakDicoba(…, "verifikasi-email", …)` + apakah keadaan itu juga
 * SAMPAI KE KLIEN lewat `sebab`, dinilai PER LENGAN rantai `if/else if/else`.
 *
 * Versi pertama memakai jendela ±6 baris dan LOLOS dari bukti merahnya
 * sendiri: mencabut `sebab = …` dari satu lengan tetap hijau, sebab penetapan
 * milik lengan TETANGGA masuk jendela. Pemenggalan per lengan menutup itu —
 * batasnya `} else if (` / `} else {`, bentuk yang memang dipakai kedua rantai
 * (dan `/forgot-password`, yang komentarnya sendiri menjelaskan kenapa rantai
 * tunggal dipilih alih-alih `if` berdampingan).
 *
 * Urutan di dalam lengan tak diatur: di `/register` lengan "sudah
 * terverifikasi" menetapkan `sebab` SEBELUM mencatat, karena di antara
 * keduanya ada cabang panjang yang memulangkan sesi.
 */
export function pasanganCatatSebab(src: string): { sebab: string; menetapkan: boolean }[] {
  const keluar: { sebab: string; menetapkan: boolean }[] = [];
  for (const lengan of src.split(/\}\s*else(?:\s+if\s*\([^)]*\))?\s*\{/)) {
    const menetapkan = /sebab = SEBAB_DAFTAR\./.test(lengan);
    for (const m of lengan.matchAll(/catatTakDicoba\("verifikasi-email",\s*email,\s*"([a-z_]+)"\);/g)) {
      keluar.push({ sebab: m[1], menetapkan });
    }
  }
  return keluar;
}

describe("SEBAB_DAFTAR — /register & /resend-verification menyebut keadaannya", () => {
  it("PREMIS: kosakatanya berisi dan berpasangan satu-satu dengan kalimatnya", () => {
    const kode = Object.values(SEBAB_DAFTAR);
    expect(kode.length).toBe(7);
    expect(new Set(kode).size, "ada nilai kembar di SEBAB_DAFTAR").toBe(kode.length);
    expect(Object.keys(PESAN_DAFTAR).sort()).toEqual([...kode].sort());
    for (const k of kode) {
      expect(PESAN_DAFTAR[k].length, `kalimat untuk ${k} kosong`).toBeGreaterThan(10);
    }
    expect(new Set(Object.values(PESAN_DAFTAR)).size, "dua sebab berbagi satu kalimat").toBe(kode.length);
  });

  it("INTI: keadaan yang sama dengan /login memakai NILAI yang sama", () => {
    expect(SEBAB_DAFTAR.takTerdaftar).toBe(SEBAB_LOGIN.takTerdaftar);
    expect(SEBAB_DAFTAR.terhapus).toBe(SEBAB_LOGIN.terhapus);
    expect(SEBAB_DAFTAR.nonaktif).toBe(SEBAB_LOGIN.nonaktif);
  });

  it("INTI: tiap keadaan yang DICATAT juga sampai ke klien", () => {
    /*
     * Satu situs melapor lewat jalan lain, dan disebut namanya di sini alih-alih
     * dilewati diam-diam: `jarak_kirim_ulang` dicatat DI DALAM
     * `kirimKodeVerifikasi`, yang memulangkan `{ terkirim: false }` — kedua
     * pemanggilnya memetakan nilai itu ke `SEBAB_DAFTAR.jarakKirimUlang`.
     * Pemisahnya `export const authRoutes`: apa pun sebelum baris itu milik
     * pembantu, sesudahnya milik rute.
     */
    const batas = rute.indexOf("export const authRoutes");
    expect(batas, "penanda `export const authRoutes` hilang").toBeGreaterThan(0);
    const diRute = pasanganCatatSebab(rute.slice(batas));
    const diPembantu = pasanganCatatSebab(rute.slice(0, batas));
    // Terukur 2026-09-05: empat di `/resend-verification`, tiga di `/register`.
    expect(diRute.length, "sapuan catatTakDicoba tipis — bentuk pemanggilannya berubah?").toBeGreaterThanOrEqual(7);
    expect(
      diRute.filter((p) => !p.menetapkan).map((p) => p.sebab),
      "dicatat ke log internal tapi klien tak diberi tahu — kelas yang justru dibongkar vena ini",
    ).toEqual([]);
    expect(diPembantu.map((p) => p.sebab), "pembantu mencatat sebab BARU yang tak dipetakan pemanggil").toEqual([
      "jarak_kirim_ulang",
    ]);
    // …dan pemetaan itu memang ada, di KEDUA pemanggilnya.
    expect([...rute.matchAll(/kirim\.terkirim \? SEBAB_DAFTAR\.\w+ : SEBAB_DAFTAR\.jarakKirimUlang/g)].length).toBe(3);
  });

  it("INTI: kedua balasan membawa `sebab` + kalimat dari PESAN_DAFTAR", () => {
    expect([...rute.matchAll(/message: PESAN_DAFTAR\[sebab\],/g)].length, "harus dua pintu").toBe(2);
    expect([...rute.matchAll(/^\s+sebab,$/gm)].length).toBeGreaterThanOrEqual(2);
    // Kalimat tak dirakit di tempat lagi — bentuk lama yang berpagar "Jika email valid".
    expect(rute, "kalimat berpagar lama masih ada di rute").not.toContain("Jika email valid");
  });

  it("INTI: /forgot-password TIDAK ikut bicara — netralitasnya keputusan terpisah", () => {
    const i = rute.indexOf('.post(\n    "/forgot-password"');
    const j = rute.indexOf('.post(', i + 10);
    const blok = rute.slice(i, j > i ? j : i + 4000);
    expect(blok.length, "blok /forgot-password tak terpotong benar").toBeGreaterThan(200);
    expect(blok, "/forgot-password ikut menyebut sebab — itu di luar keputusan pemilik").not.toMatch(/sebab: SEBAB_DAFTAR|PESAN_DAFTAR\[/);
  });

  it("INTI: web bercabang pada KODE, bukan mencocokkan kalimat", () => {
    const web = butaKomentar(readFileSync(AKAR + WEB_SIGNUP, "utf8"));
    expect(web).toMatch(/SEBAB_DAFTAR\.terverifikasi/);
    expect(web).toMatch(/SEBAB_DAFTAR\.nonaktif/);
    expect(web).toMatch(/SEBAB_DAFTAR\.terhapus/);
    expect(web, "layar daftar mencocokkan kalimat, bukan kode").not.toMatch(/res\.message ===/);
  });

  it("KELAS: literal ponsel == kosakata kontrak — bila repo ponsel ada", () => {
    let dart: string;
    try {
      dart = readFileSync(fileURLToPath(new URL("../../../../kakarut-mobile/lib/features/auth/verifikasi_bentuk.dart", import.meta.url)), "utf8");
    } catch {
      return; // CI repo ini tak men-checkout ponsel → lewati, bukan merah
    }
    for (const k of Object.values(SEBAB_DAFTAR)) {
      expect(dart, `ponsel tak memuat literal ${k}`).toContain(`'${k}'`);
    }
    // `jarak_kirim_ulang` BUKAN "tanpa kode": kode lama masih berlaku.
    const blok = /const Set<String> kSebabTanpaKode = \{([\s\S]*?)\};/.exec(dart);
    expect(blok, "kSebabTanpaKode tak ditemukan").not.toBeNull();
    expect(blok![1], "jarak_kirim_ulang menutup layar kode — kode lamanya masih berlaku").not.toContain("kSebabJarakKirimUlang");
  });

  it("PASANGAN: pengurainya menuduh pencatatan yang tak diikuti penetapan", () => {
    const baik = 'catatTakDicoba("verifikasi-email", email, "akun_nonaktif");\n  sebab = SEBAB_DAFTAR.nonaktif;';
    expect(pasanganCatatSebab(baik)).toEqual([{ sebab: "akun_nonaktif", menetapkan: true }]);
    /*
     * INTI PASANGAN INI: penetapan milik lengan TETANGGA tak boleh terhitung.
     * Versi pertama pengurai ini memakai jendela baris dan lolos dari bukti
     * merah SS justru pada bentuk di bawah.
     */
    const tetangga =
      'if (a) {\n  catatTakDicoba("verifikasi-email", email, "akun_nonaktif");\n} else if (b) {\n  sebab = SEBAB_DAFTAR.terhapus;\n}';
    expect(pasanganCatatSebab(tetangga)).toEqual([{ sebab: "akun_nonaktif", menetapkan: false }]);
    const buruk = 'catatTakDicoba("verifikasi-email", email, "akun_nonaktif");\n  } else {\n    kirim();\n  }';
    // …dan penetapan SEBELUM pencatatan tetap terhitung (lengan "sudah terverifikasi").
    expect(pasanganCatatSebab('sebab = SEBAB_DAFTAR.terverifikasi;\n  x();\n  catatTakDicoba("verifikasi-email", email, "akun_terverifikasi");')).toEqual([
      { sebab: "akun_terverifikasi", menetapkan: true },
    ]);
    expect(pasanganCatatSebab(buruk)).toEqual([{ sebab: "akun_nonaktif", menetapkan: false }]);
    expect(pasanganCatatSebab('catatTakDicoba("reset-password", email, "akun_nonaktif");')).toEqual([]);
  });
});
