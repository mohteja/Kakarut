import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { penerimaDitolak } from "../src/modules/mail/service";

/**
 * LAYAR TAK BOLEH MENJANJIKAN SURAT YANG TAK AKAN DATANG — DAN HANYA PUNYA
 * SATU JALAN.
 *
 * Ini babak ketiga dan keempat dari satu laporan bug yang sama, dan tiap babak
 * menemukan bahwa babak sebelumnya menjawab pertanyaan yang salah:
 *
 *   1. Kegagalan kirim ditelan `catch {}` → dibuat berbunyi.
 *   2. Ternyata TAK ADA kegagalan — suratnya tak pernah DICOBA dikirim →
 *      tujuh pintu diam dibuat mencatat, dan riwayatnya dipasang di panel.
 *   3. Riwayat itu menjawabnya dalam satu baris:
 *
 *          <alamat>  verifikasi-email  Tidak dikirim  "Akun sudah terverifikasi"
 *
 *      Tak ada bug email. Akunnya SUDAH terverifikasi (disapu migrasi 0065
 *      yang menandai semua akun lama terverifikasi), dan server benar menolak
 *      menerbitkan kode untuk akun yang tak membutuhkannya. Yang salah
 *      layarnya: "kami sudah mengirim kode" untuk surat yang tak akan datang.
 *
 *   4. Perbaikan babak 3 menaruh DUA kemungkinan di kalimat yang sama ("jika
 *      alamat ini baru … jika akunnya sudah aktif, langsung Masuk") plus
 *      tombol "Akun sudah aktif?". Pemilik repo MENOLAKNYA, dan alasannya
 *      benar: ini layar pertama orang mencoba aplikasi ini, dan layar yang
 *      menawarkan dua jalan membingungkan. Aturan babak 3 di berkas ini
 *      ("tiap kalimat menyebut KEDUA kemungkinan") karena itu DICABUT.
 *
 * Yang benar, dan yang dijaga sekarang: keadaan "sudah aktif" ditangani
 * SEBELUM layar tunggu — `/register` untuk akun terverifikasi dengan password
 * yang cocok memulangkan SESI, dan orangnya langsung dimasukkan dengan
 * keterangan. Kalimat di layar tunggu kembali satu arah, dan tak ada tombol
 * jalan kedua. Satu-satunya keadaan yang tersisa tak terwakili — akun aktif +
 * password SALAH — memang tak boleh dibedakan dari email baru (anti-enumerasi;
 * yang dibocorkan `/register` harus TEPAT SAMA dengan yang dibocorkan
 * `/login`), dan pemegangnya punya tautan "Sudah punya akun? Masuk" yang
 * selalu ada di bawah layar.
 *
 * BATASNYA, ditulis jujur: pemindai ini leksikal. Ia menjaga bahwa kalimatnya
 * datang dari satu rumah, bahwa rumah itu tak lagi bercabang, dan bahwa sesi
 * dari `/register` benar-benar dibaca layar; ia TIDAK bisa menilai apakah
 * kalimatnya enak dibaca. Mutu kalimatnya dijaga mata manusia, bentuknya
 * dijaga di sini. Perilaku servernya sendiri dijaga §284/§285 `verify-api.sh`.
 */

const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const RUMAH = join(WEB, "lib/pesan-verifikasi.ts");
const SIGNUP = join(WEB, "pages/SignupPage.tsx");
const AUTH_CTX = join(WEB, "context/AuthContext.tsx");

/** Pintu klien yang meminta kode verifikasi ke server. */
const PEMANGGIL = ["register(", "kirimUlangVerifikasi("];

/**
 * Bentuk yang DILARANG ditulis inline di layar: klaim bahwa suratnya sudah
 * berangkat. Dicari pada sumber yang komentarnya dibutakan — komentar yang
 * MENGUTIP bentuk lama (dan berkas ini penuh dengan kutipan begitu) bukan
 * pelanggaran.
 */
const KLAIM = [/sudah dikirim/i, /sudah mengirim/i, /kami (sudah|telah)/i];

/**
 * Bentuk JALAN KEDUA yang dicabut babak 4: kalimat bercabang dan tombol
 * "Akun sudah aktif?". Dilarang di kalimat tunggu kode DAN di layar.
 */
const CABANG = [/\bJika\b/, /sudah aktif/i, /\bMasuk\b/];
const TOMBOL_KEDUA = [/Akun sudah aktif\?/i, /AJAKAN_MASUK/];

function berkasTsx(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTsx(p));
    else if (nama.endsWith(".tsx") || nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Layar yang benar-benar memanggil pintu verifikasi. */
export function layarPeminta(): { nama: string; isi: string }[] {
  return berkasTsx(WEB)
    .map((p) => ({ nama: p.slice(WEB.length + 1), isi: readFileSync(p, "utf8") }))
    .filter((f) => PEMANGGIL.some((n) => butaKomentar(f.isi).includes(n)))
    .filter((f) => !f.nama.startsWith("lib/"));
}

/** Klaim "suratnya sudah berangkat" yang ditulis inline di sebuah berkas. */
export function klaimInline(isi: string): string[] {
  const s = butaKomentar(isi);
  return KLAIM.flatMap((re) => {
    const m = s.match(new RegExp(re.source, "gi"));
    return m ?? [];
  });
}

/** Kalimat `export const PESAN_* = …;` di rumahnya, komentar dibutakan. */
export function kalimatRumah(isi: string): { nama: string; isi: string }[] {
  const s = butaKomentar(isi);
  return [...s.matchAll(/export const (PESAN_\w+)\s*=\s*([\s\S]*?);\n/g)].map((m) => ({
    nama: m[1],
    isi: m[2],
  }));
}

describe("layar tunggu kode: satu rumah, satu jalan", () => {
  const layar = layarPeminta();
  const rumah = readFileSync(RUMAH, "utf8");
  const pesan = kalimatRumah(rumah);

  it("premis: sapuannya menemukan layar-layar pemintanya", () => {
    // Terukur 3 saat gerbang ini ditulis: Signup, VerifikasiEmail, Login.
    expect(layar.map((f) => f.nama).sort()).toEqual([
      "pages/LoginPage.tsx",
      "pages/SignupPage.tsx",
      "pages/VerifikasiEmailPage.tsx",
    ]);
    expect(pesan.map((p) => p.nama).sort()).toEqual([
      "PESAN_DAFTAR",
      "PESAN_KIRIM_ULANG",
      "PESAN_SUDAH_AKTIF",
    ]);
  });

  it("tak ada layar yang menuliskan klaim 'sudah dikirim' sendiri", () => {
    const pelanggar = layar
      .filter((f) => klaimInline(f.isi).length > 0)
      .map((f) => `${f.nama}: ${klaimInline(f.isi).join(", ")}`);
    expect(
      pelanggar,
      `${pelanggar.join("\n")}\n\nKalimatnya datang dari ` +
        "`web/src/lib/pesan-verifikasi.ts`. Layar yang menuliskannya sendiri " +
        "akan pelan-pelan menyimpang — persis seperti hitung mundur kirim ulang " +
        "yang dulu hanya ada di satu dari dua tombol kembar.",
    ).toEqual([]);
  });

  it("tiap layar memakai kalimat dari rumah bersamanya", () => {
    const kurang = layar
      .filter((f) => !butaKomentar(f.isi).includes("pesan-verifikasi"))
      .map((f) => f.nama);
    expect(kurang, `tak mengimpor pesan-verifikasi: ${kurang.join(", ")}`).toEqual([]);
  });

  it("kalimat tunggu kode berbicara SATU jalan — tak ada cabang 'jika sudah aktif'", () => {
    /*
     * Kebalikan persis dari aturan babak 3 ("wajib menyebut KEDUA
     * kemungkinan"), dan pembalikannya sengaja: yang dulu dijaga adalah
     * kejujuran kalimat untuk keadaan yang tak bisa dibedakan; keadaan itu
     * kini ditangani servernya sebelum layar ini tampil.
     */
    const tunggu = pesan.filter((p) => p.nama !== "PESAN_SUDAH_AKTIF");
    expect(tunggu.length, "ada kalimat tunggu yang bisa dinilai").toBeGreaterThanOrEqual(2);
    for (const p of tunggu) {
      for (const re of CABANG) {
        expect(p.isi, `${p.nama} bercabang lagi (${re.source})`).not.toMatch(re);
      }
      // dan ia tetap menyuruh menunggu kode, bukan diam
      expect(p.isi, `${p.nama} menyebut kodenya`).toMatch(/[Kk]ode/);
    }
  });

  it("keadaan 'sudah aktif' ditangani SEBELUM layar tunggu: sesi dari /register dibaca", () => {
    const aktif = pesan.find((p) => p.nama === "PESAN_SUDAH_AKTIF");
    expect(aktif?.isi, "kalimat 'sudah aktif' ada di rumahnya").toMatch(/sudah aktif/i);

    // Sesi disimpan lewat jalur yang sama dengan login — bukan cara kedua.
    const ctx = butaKomentar(readFileSync(AUTH_CTX, "utf8"));
    expect(ctx).toContain('if ("token" in res) setSession(res)');

    // …dan layar daftar benar-benar membelokkan orangnya, dengan keterangan.
    const signup = butaKomentar(readFileSync(SIGNUP, "utf8"));
    expect(signup).toContain('"token" in');
    expect(signup).toContain("PESAN_SUDAH_AKTIF");
  });

  it("tak ada layar yang menawarkan jalan kedua 'Akun sudah aktif?'", () => {
    const pelanggar = layar
      .filter((f) => TOMBOL_KEDUA.some((re) => re.test(butaKomentar(f.isi))))
      .map((f) => f.nama);
    expect(
      pelanggar,
      `${pelanggar.join(", ")}\n\nTombol itu dicabut atas keputusan pemilik repo: ` +
        "layar pertama orang mencoba aplikasi ini tak boleh menawarkan dua jalan. " +
        "Akun aktif dimasukkan SEBELUM layar ini tampil.",
    ).toEqual([]);
  });

  it("layar yang bukan halaman Masuk tetap menautkannya — jalan pemegang password salah", () => {
    /*
     * Bukan "wajib memuat /login" begitu saja: versi pertama aturan ini
     * berbunyi begitu dan langsung menuduh `LoginPage`, yang jelas tak perlu
     * menautkan dirinya sendiri. Yang dijaga NIATNYA — orang yang mendaftar
     * ulang dengan password yang salah (satu-satunya keadaan yang memang tak
     * bisa dibedakan dari email baru) harus punya jalan keluar yang terlihat.
     */
    const kurang = layar
      .filter((f) => f.nama !== "pages/LoginPage.tsx")
      .filter((f) => !butaKomentar(f.isi).includes('"/login"'))
      .map((f) => f.nama);
    expect(kurang, `tak menautkan /login: ${kurang.join(", ")}`).toEqual([]);
  });
});

/**
 * ATURAN 7 — alat ukurnya sendiri diuji: pemindai kalimat rumah harus bisa
 * membaca bentuk yang benar dan mengabaikan prosa yang mengutipnya.
 */
describe("instrumennya bisa menuduh", () => {
  it("kalimat rumah terbaca dari sumbernya, komentar dibutakan", () => {
    const palsu =
      '// export const PESAN_LAMA = "Jika X valid, kami sudah mengirim";\n' +
      'export const PESAN_A = "Kode sedang dikirim.";\n' +
      'export const PESAN_B =\n  "Jika baru, kode dikirim. " +\n  "Jika sudah aktif, Masuk.";\n';
    const k = kalimatRumah(palsu);
    expect(k.map((p) => p.nama)).toEqual(["PESAN_A", "PESAN_B"]);
    expect(CABANG.some((re) => re.test(k[1].isi))).toBe(true);
    expect(CABANG.some((re) => re.test(k[0].isi))).toBe(false);
  });

  it("'Masukkan kodenya' BUKAN cabang 'Masuk' — batas kata dihormati", () => {
    expect(CABANG.some((re) => re.test("Masukkan kodenya untuk mengaktifkan akun."))).toBe(false);
    expect(CABANG.some((re) => re.test("langsung Masuk saja."))).toBe(true);
  });
});

/**
 * "TERKIRIM" HARUS BERARTI PENYEDIANYA MENERIMA ALAMAT ITU.
 *
 * Ditemukan saat menelusuri laporan yang sama: `sendMail` nodemailer RESOLVE
 * walau penerimanya ditolak — daftarnya di `info.rejected` — dan kita tak
 * pernah membacanya. Penerima yang ditolak karena itu tercatat "Terkirim":
 * kelas yang sama persis dengan bug yang sedang dibayar, satu lapis lebih
 * dalam.
 */
describe("penerima yang DITOLAK tak boleh terbaca terkirim", () => {
  it("dua bentuk yang boleh datang bercampur terbaca dua-duanya", () => {
    expect(penerimaDitolak(["a@b.c", { address: "d@e.f" }])).toEqual(["a@b.c", "d@e.f"]);
  });

  it("kosong / tak ada → tak ada yang ditolak", () => {
    expect(penerimaDitolak([])).toEqual([]);
    expect(penerimaDitolak(undefined)).toEqual([]);
    expect(penerimaDitolak(null)).toEqual([]);
  });

  it("alamatnya IKUT di pesan galat, bukan [object Object]", () => {
    // Bentuk objek yang dibaca naif berakhir sebagai "[object Object]" —
    // pesan galat yang justru menghapus satu-satunya keterangan yang berguna.
    expect(penerimaDitolak([{ address: "korban@contoh.id" }]).join(", ")).toBe("korban@contoh.id");
  });

  it("jalur SMTP benar-benar memakainya dan MELEMPAR", () => {
    const svc = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/modules/mail/service.ts", import.meta.url)), "utf8"),
    );
    expect(svc).toContain("penerimaDitolak(info.rejected)");
    expect(svc).toMatch(/ditolak\.length > 0[\s\S]{0,120}throw new Error/);
  });

  it("id pesan penyedianya disimpan — jembatan ke catatan mereka", () => {
    const svc = butaKomentar(
      readFileSync(fileURLToPath(new URL("../src/modules/mail/service.ts", import.meta.url)), "utf8"),
    );
    expect(svc).toContain("info.messageId");
    expect(svc).toContain("badan?.id");
    expect(svc).toMatch(/hasil: "terkirim"[^}]*pesanId/);
  });
});
