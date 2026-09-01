import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { penerimaDitolak } from "../src/modules/mail/service";

/**
 * LAYAR TAK BOLEH MENJANJIKAN SURAT YANG BELUM TENTU DIKIRIM.
 *
 * Ini babak ketiga dari satu laporan bug yang sama, dan tiap babak menemukan
 * bahwa babak sebelumnya menjawab pertanyaan yang salah:
 *
 *   1. Kegagalan kirim ditelan `catch {}` → dibuat berbunyi.
 *   2. Ternyata TAK ADA kegagalan — suratnya tak pernah DICOBA dikirim →
 *      tujuh pintu diam dibuat mencatat, dan riwayatnya dipasang di panel.
 *   3. Riwayat itu menjawabnya dalam satu baris:
 *
 *          <alamat>  verifikasi-email  Tidak dikirim  "Akun sudah terverifikasi"
 *
 * Tak ada bug email sama sekali. Akunnya SUDAH terverifikasi, dan server benar
 * menolak menerbitkan kode untuk akun yang tak membutuhkannya. Yang salah
 * layarnya — ia MENGKLAIM sesuatu yang tak selalu benar:
 *
 *     "Jika X valid, kami sudah mengirim kode 6 angka ke email tersebut."
 *     "Kode baru sudah dikirim (bila email valid). Cek email Anda."
 *
 * Ketiganya lalu mendorong orangnya ke layar tunggu yang tak punya ujung, dan
 * tak satu pun menyebut jalan keluarnya: MASUK. Pemilik repo ini sendiri
 * terjebak di situ dua hari.
 *
 * PERBAIKANNYA BUKAN MEMBERI TAHU YANG MANA — itu akan membuka kembali celah
 * enumerasi akun yang dijaga respons netral server. Yang benar: kalimat yang
 * MENGASUMSIKAN satu kemungkinan diganti kalimat yang MENYEBUT keduanya.
 *
 * BATASNYA, ditulis jujur: pemindai ini leksikal. Ia menjaga bahwa kalimatnya
 * datang dari satu rumah dan bahwa rumah itu menyebut kedua kemungkinan; ia
 * TIDAK bisa menilai apakah kalimatnya enak dibaca. Mutu kalimatnya dijaga
 * mata manusia, bentuknya dijaga di sini.
 */

const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const RUMAH = join(WEB, "lib/pesan-verifikasi.ts");

/** Pintu klien yang meminta kode verifikasi ke server. */
const PEMANGGIL = ["register(", "kirimUlangVerifikasi("];

/**
 * Bentuk yang DILARANG ditulis inline di layar: klaim bahwa suratnya sudah
 * berangkat. Dicari pada sumber yang komentarnya dibutakan — komentar yang
 * MENGUTIP bentuk lama (dan berkas ini penuh dengan kutipan begitu) bukan
 * pelanggaran.
 */
const KLAIM = [/sudah dikirim/i, /sudah mengirim/i, /kami (sudah|telah)/i];

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

describe("layar tak menjanjikan surat yang belum tentu dikirim", () => {
  const layar = layarPeminta();
  const rumah = readFileSync(RUMAH, "utf8");

  it("premis: sapuannya menemukan layar-layar pemintanya", () => {
    // Terukur 3 saat gerbang ini ditulis: Signup, VerifikasiEmail, Login.
    expect(layar.map((f) => f.nama).sort()).toEqual([
      "pages/LoginPage.tsx",
      "pages/SignupPage.tsx",
      "pages/VerifikasiEmailPage.tsx",
    ]);
  });

  it("tak ada layar yang menuliskan klaim 'sudah dikirim' sendiri", () => {
    const pelanggar = layar
      .filter((f) => klaimInline(f.isi).length > 0)
      .map((f) => `${f.nama}: ${klaimInline(f.isi).join(", ")}`);
    expect(
      pelanggar,
      `${pelanggar.join("\n")}\n\nKalimatnya datang dari ` +
        "`web/src/lib/pesan-verifikasi.ts`, yang menyebut KEDUA kemungkinan. " +
        "Layar yang menuliskannya sendiri akan pelan-pelan menyimpang — persis " +
        "seperti hitung mundur kirim ulang yang dulu hanya ada di satu dari dua " +
        "tombol kembar.",
    ).toEqual([]);
  });

  it("tiap layar memakai kalimat dari rumah bersamanya", () => {
    const kurang = layar
      .filter((f) => !butaKomentar(f.isi).includes("pesan-verifikasi"))
      .map((f) => f.nama);
    expect(kurang, `tak mengimpor pesan-verifikasi: ${kurang.join(", ")}`).toEqual([]);
  });

  it("tiap kalimat di rumahnya menyebut KEDUA kemungkinan", () => {
    const s = butaKomentar(rumah);
    const pesan = [...s.matchAll(/export const (PESAN_\w+)\s*=\s*([\s\S]*?);\n/g)];
    expect(pesan.length, "ada kalimat yang bisa dinilai").toBeGreaterThanOrEqual(2);
    for (const [, nama, isi] of pesan) {
      // "Jika … . Jika …" — dua cabang, bukan satu klaim.
      expect((isi.match(/Jika/g) ?? []).length, `${nama} menyebut dua kemungkinan`).toBeGreaterThanOrEqual(2);
      // dan jalan keluarnya disebut namanya
      expect(isi, `${nama} menyebut jalan keluar "Masuk"`).toMatch(/Masuk/);
    }
  });

  it("tiap layar menawarkan jalan MASUK — yang bukan halaman Masuk, menautkannya", () => {
    /*
     * Bukan "wajib memuat /login" begitu saja: versi pertama aturan ini
     * berbunyi begitu dan langsung menuduh `LoginPage`, yang jelas tak perlu
     * menautkan dirinya sendiri. Yang dijaga NIATNYA — orang yang terjebak di
     * layar tunggu harus punya jalan keluar yang terlihat — dan halaman Masuk
     * memenuhinya dengan cara paling sederhana: ia sudah di sana.
     */
    const kurang = layar
      .filter((f) => f.nama !== "pages/LoginPage.tsx")
      .filter((f) => !butaKomentar(f.isi).includes('"/login"'))
      .map((f) => f.nama);
    expect(kurang, `tak menautkan /login: ${kurang.join(", ")}`).toEqual([]);
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
