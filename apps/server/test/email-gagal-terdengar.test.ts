import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { sumberServer } from "./util/sql-mentah";
import { temuanEmailGagal } from "../src/lib/pemeriksaan-setelan";

/**
 * SURAT YANG GAGAL DIKIRIM HARUS PUNYA JALAN KELUAR — KE OPERATOR.
 *
 * Kelas ini sudah punya gerbang lebih dulu (`galat-ditelan-beralasan.test.ts`),
 * dan gerbang itu MELOLOSKAN tiga pintu email selama berbulan-bulan. Bukan
 * karena rusak: ia menuntut alasan yang TERTULIS, dan alasannya memang
 * tertulis rapi di ketiganya — "best-effort: jangan gagalkan permintaan bila
 * email error". Catatan kejujuran gerbang itu sendiri menyebut batasnya:
 * *"yang dijaga berkas ini adalah adanya KEPUTUSAN yang tertulis, bukan
 * mutunya."*
 *
 * Ongkos batas itu terukur 2026-09-01 lewat HTTP + Postgres sungguhan, saat
 * pendaftar berhenti menerima kode OTP:
 *
 *     POST /auth/register             → 200 "…kami telah mengirim KODE…"
 *     POST /auth/resend-verification  → 200 {ok:true}
 *     baris email_verification_tokens → 2   (sistem yakin kodenya terbit)
 *     baris log yang menyebut sebabnya→ 0
 *
 * Nol. Penyedianya menolak dan tak ada satu pun tempat — respons, log, panel —
 * yang bisa memberi tahu pemilik pemasangan kenapa.
 *
 * ALASAN TERTULIS ≠ KABAR TERSAMPAIKAN. Itu yang dijaga berkas ini, dan ia
 * menjaganya secara mekanis: siapa boleh memanggil `kirimEmail` telanjang,
 * dan bahwa tiap pemakai `kirimEmailDiam` menyebut konteksnya.
 *
 * KENAPA BUKAN "PULANGKAN GALATNYA KE PEMINTA". Tiga dari lima pintu itu
 * (`/register`, `/resend-verification`, `/forgot-password`) sengaja menjawab
 * IDENTIK untuk email yang terdaftar dan yang tidak — surat hanya dikirim
 * untuk akun yang ada, jadi penanda "email gagal" di badan respons menjawab
 * persis pertanyaan yang rute-rute itu susah payah tutup. Arah keluarnya
 * memang harus ke operator, bukan ke peminta.
 */

/**
 * Berkas yang BOLEH memanggil `kirimEmail` telanjang, beserta alasannya.
 *
 * Daftar, bukan pola: tiap penambahan menuntut satu keputusan yang ditulis di
 * sini, dan itulah satu-satunya gunanya.
 */
const BOLEH_TELANJANG = new Map<string, string>([
  [
    "modules/mail/service.ts",
    "rumahnya sendiri — di sinilah `kirimEmail` didefinisikan dan dipanggil `kirimEmailDiam`",
  ],
  [
    "modules/admin-system/routes.ts",
    'tombol "Kirim Test Email": galatnya justru DITAMPILKAN ke super admin sebagai badan 400 — ' +
      "menelannya di sini akan membuat satu-satunya alat diagnosis email berbohong",
  ],
]);

/** Konteks yang harus dipakai tiap pintu — nama pintunya, bukan prosa. */
const KONTEKS_WAJIB = new Map<string, string[]>([
  ["modules/auth/routes.ts", ["verifikasi-email", "reset-password"]],
  ["modules/users/routes.ts", ["undangan-karyawan"]],
  ["lib/backup-peringatan.ts", ["peringatan-cadangan"]],
]);

/**
 * Situs panggilan `kirimEmail` TELANJANG di satu berkas.
 *
 * Batas kata di depan wajib: tanpanya `kirimEmailDiam(` ikut terhitung, dan
 * gerbang ini akan menuduh justru pemakaian yang BENAR.
 */
export function situsTelanjang(isi: string): number {
  return (butaKomentar(isi).match(/(?<![\w$])kirimEmail\s*\(/g) ?? []).length;
}

/**
 * Argumen tingkat-atas satu panggilan `kirimEmailDiam(...)`, apa adanya.
 *
 * Kurung/kurawal/kurung siku dihitung supaya objek pesan yang berisi koma
 * (`{ to, subject, html }`) tidak terpecah jadi banyak argumen palsu. String
 * dilewati utuh karena tanda kurung di DALAM subjek surat bukan struktur.
 */
export function argumenDiam(isi: string): string[][] {
  const s = butaKomentar(isi);
  const keluar: string[][] = [];
  for (const m of s.matchAll(/(?<![\w$])kirimEmailDiam\s*\(/g)) {
    // DEKLARASINYA bukan panggilan. Tanpa saringan ini gerbang menuduh rumah
    // bersamanya sendiri — `(pesan: Pesan, konteks: string)` memang bukan
    // literal kebab-case — yaitu menuduh justru satu-satunya berkas yang
    // sudah benar.
    if (s.slice(0, m.index!).trimEnd().endsWith("function")) continue;
    let i = m.index! + m[0].length;
    let dalam = 0;
    let mulai = i;
    const argumen: string[] = [];
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'" || c === "`") {
        const tanda = c;
        i++;
        while (i < s.length && s[i] !== tanda) i += s[i] === "\\" ? 2 : 1;
        continue;
      }
      if (c === "(" || c === "{" || c === "[") dalam++;
      else if (c === ")" || c === "}" || c === "]") {
        if (c === ")" && dalam === 0) {
          argumen.push(s.slice(mulai, i).trim());
          break;
        }
        dalam--;
      } else if (c === "," && dalam === 0) {
        argumen.push(s.slice(mulai, i).trim());
        mulai = i + 1;
      }
    }
    keluar.push(argumen.filter((a) => a !== ""));
  }
  return keluar;
}

describe("kegagalan kirim email tak boleh diam", () => {
  const sumber = sumberServer();

  it("premis: sapuannya benar-benar melihat sumber yang berisi", () => {
    // Sapuan yang membaca nol berkas hijau tanpa menyatakan apa pun.
    // Terukur 117 berkas `.ts` di `src` saat gerbang ini ditulis; lantainya
    // dipasang jauh di bawah itu supaya ia menangkap sapuan yang RUNTUH, bukan
    // menuduh repo yang tumbuh atau menyusut wajar.
    expect(sumber.length).toBeGreaterThan(80);
    expect(sumber.some((f) => f.nama === "modules/mail/service.ts")).toBe(true);
    expect(sumber.filter((f) => f.isi.includes("kirimEmail")).length).toBeGreaterThanOrEqual(5);
  });

  it("hanya berkas beralasan yang memanggil kirimEmail telanjang", () => {
    const pelanggar: string[] = [];
    for (const f of sumber) {
      if (situsTelanjang(f.isi) > 0 && !BOLEH_TELANJANG.has(f.nama)) {
        pelanggar.push(`${f.nama}: panggil kirimEmail langsung — pakai kirimEmailDiam(pesan, konteks)`);
      }
    }
    expect(pelanggar, pelanggar.join("\n")).toEqual([]);
  });

  it("tak ada entri kuburan di daftar yang boleh telanjang", () => {
    // Daftar izin yang menyebut berkas yang sudah tak memanggilnya lagi
    // pelan-pelan berubah jadi izin untuk apa pun yang lahir di berkas itu.
    const mati = [...BOLEH_TELANJANG.keys()].filter(
      (nama) => situsTelanjang(sumber.find((f) => f.nama === nama)?.isi ?? "") === 0,
    );
    expect(mati, `sudah tak memanggil kirimEmail: ${mati.join(", ")}`).toEqual([]);
  });

  it("tiap pemakai kirimEmailDiam menyebut konteksnya", () => {
    const salah: string[] = [];
    let jumlah = 0;
    for (const f of sumber) {
      for (const arg of argumenDiam(f.isi)) {
        jumlah++;
        if (arg.length !== 2) {
          salah.push(`${f.nama}: kirimEmailDiam dipanggil dengan ${arg.length} argumen, harus 2`);
          continue;
        }
        // Konteks WAJIB literal: `konteks` yang datang dari variabel membuat
        // baris log tak bisa dipetakan ke pintunya tanpa menjalankan kodenya.
        if (!/^"[a-z0-9-]{3,}"$/.test(arg[1])) {
          salah.push(`${f.nama}: konteks ${arg[1]} bukan literal kebab-case`);
        }
      }
    }
    expect(salah, salah.join("\n")).toEqual([]);
    // `kirimEmailDiam` sendiri tak memanggil dirinya, jadi angka ini adalah
    // jumlah PINTU yang memakainya.
    expect(jumlah, "jumlah pintu yang memakai kirimEmailDiam").toBe(4);
  });

  it("tiap pintu memakai konteks yang menamai dirinya", () => {
    for (const [nama, konteks] of KONTEKS_WAJIB) {
      const f = sumber.find((x) => x.nama === nama);
      expect(f, `${nama} hilang`).toBeTruthy();
      const dipakai = argumenDiam(f!.isi).map((a) => a[1]);
      expect(dipakai.sort()).toEqual(konteks.map((k) => `"${k}"`).sort());
    }
  });
});

describe("temuan panel: penyedianya ADA tapi menolak", () => {
  const dasar = {
    kunci: "email",
    suksesPada: null,
    suksesPenyedia: null,
    gagalPada: new Date("2026-09-01T03:38:50.817Z"),
    gagalPenyedia: "resend",
    gagalPesan: "Resend gagal (403): The gmail.com domain is not verified",
    gagalBeruntun: 0,
  };

  it("belum pernah ada kiriman → tak ada temuan", () => {
    expect(temuanEmailGagal(null)).toBeNull();
  });

  it("kiriman terakhir BERHASIL → tak ada temuan", () => {
    // Kegagalan yang sudah pulih tetap tersimpan barisnya; melaporkannya
    // mengajari pembaca panel mengabaikan panel.
    expect(temuanEmailGagal({ ...dasar, gagalBeruntun: 0 })).toBeNull();
  });

  it("gagal beruntun → temuan KRITIS yang memuat pesan penyedianya apa adanya", () => {
    const t = temuanEmailGagal({ ...dasar, gagalBeruntun: 7 });
    expect(t).not.toBeNull();
    expect(t!.kode).toBe("email_gagal_kirim");
    expect(t!.tingkat).toBe("kritis");
    // Inti temuan ini: pesan penyedianya SAMPAI ke pembacanya. Temuan yang
    // cuma berkata "email gagal" mengembalikan persis tebak-tebakan yang
    // hendak dihapusnya.
    expect(t!.rincian).toContain("The gmail.com domain is not verified");
    expect(t!.rincian).toContain("7 kiriman");
    expect(t!.rincian).toContain("resend");
  });

  it("belum pernah sukses disebut apa adanya; kalau pernah, waktunya ikut", () => {
    expect(temuanEmailGagal({ ...dasar, gagalBeruntun: 1 })!.rincian).toContain("BELUM PERNAH");
    const pernah = temuanEmailGagal({
      ...dasar,
      gagalBeruntun: 1,
      suksesPada: new Date("2026-08-31T10:00:00.000Z"),
      suksesPenyedia: "resend",
    });
    expect(pernah!.rincian).toContain("2026-08-31T10:00:00.000Z");
    expect(pernah!.rincian).not.toContain("BELUM PERNAH");
  });

  it("penyedia/pesan/waktu yang tak tercatat tidak jadi 'null' di layar", () => {
    // Baris warisan (kolomnya kosong) tetap harus terbaca manusia.
    const t = temuanEmailGagal({
      ...dasar,
      gagalBeruntun: 2,
      gagalPada: null,
      gagalPenyedia: null,
      gagalPesan: null,
    });
    expect(t!.rincian).not.toContain("null");
    expect(t!.rincian).toContain("tak tercatat");
  });
});

/**
 * ATURAN 7 — alat ukurnya sendiri diuji.
 *
 * Sapuan di atas hijau juga bila regexnya tak pernah cocok dengan apa pun.
 * Blok ini memberinya sumber palsu yang JELAS salah dan menuntutnya menuduh.
 */
describe("instrumennya bisa menuduh", () => {
  it("panggilan telanjang terlihat, `kirimEmailDiam` tidak ikut terhitung", () => {
    expect(situsTelanjang('await kirimEmail({ to: "a@b.c" });')).toBe(1);
    expect(situsTelanjang("await kirimEmailDiam({}, \"x\");")).toBe(0);
    // Prosa yang MENGUTIP bentuk terlarang bukan pelanggaran.
    expect(situsTelanjang("// dulu di sini ada kirimEmail(pesan)\nconst a = 1;")).toBe(0);
  });

  it("konteks yang hilang atau bukan literal tertangkap", () => {
    expect(argumenDiam('kirimEmailDiam({ to: "a", subject: "b, c" });')).toEqual([
      ['{ to: "a", subject: "b, c" }'],
    ]);
    expect(argumenDiam('kirimEmailDiam(pesan, konteks);')[0][1]).toBe("konteks");
    expect(argumenDiam('kirimEmailDiam(pesan, "verifikasi-email");')[0][1]).toBe(
      '"verifikasi-email"',
    );
  });

  it("deklarasinya sendiri tidak terhitung sebagai panggilan", () => {
    expect(argumenDiam("export async function kirimEmailDiam(pesan: Pesan, konteks: string) {}")).toEqual(
      [],
    );
  });

  it("koma di dalam objek pesan tidak memecah argumennya", () => {
    const arg = argumenDiam('kirimEmailDiam({ to: e, subject: s, html: h }, "undangan-karyawan");');
    expect(arg[0]).toHaveLength(2);
    expect(arg[0][1]).toBe('"undangan-karyawan"');
  });
});
