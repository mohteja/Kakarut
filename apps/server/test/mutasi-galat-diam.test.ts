import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Penjaga MUTASI YANG GAGAL DIAM-DIAM.
 *
 * Aksi yang gagal tanpa satu kata pun adalah bentuk paling murni dari layar
 * yang berbohong: tak ada yang berubah, tombolnya hidup lagi, jadi orang
 * menekannya berulang kali sambil mengira sistemnya bandel — padahal jawaban
 * servernya ada, cuma tak pernah ditampilkan.
 *
 * Repo ini sudah punya alatnya, `galatTerbaru()` di `lib/galat.ts`, untuk
 * layar dengan beberapa mutasi yang berbagi satu `<ErrorText>`. Justru karena
 * alat itu ada, mutasi yang TIDAK tersentuh olehnya maupun oleh `.error`
 * langsung adalah kelalaian, bukan pilihan.
 *
 * Dua yang tertinggal dan diperbaiki bersama penjaga ini:
 *
 *  - `OnboardingPage.tolak` — "Tolak" dan "Terima" bersebelahan di kartu
 *    undangan yang sama, tapi hanya `terima.error` yang dirender. Di layar
 *    itu pengguna belum punya perusahaan, belum punya navigasi, dan tak punya
 *    jalan lain untuk mencoba.
 *  - `KaryawanPage.batalUndangan` — satu-satunya aksi di kartu Undangan
 *    Tertunda, galatnya tak dirender di mana pun.
 */
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));

function berkasTsx(dir: string): string[] {
  const out: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) out.push(...berkasTsx(p));
    else if (nama.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Mutasi yang galatnya tak terjangkau: bukan lewat `<nama>.error`, bukan lewat
 * `galatTerbaru(...)`, dan bukan lewat `onError` sendiri (beberapa layar
 * memang menanganinya dengan state khusus — mis. `MejaStatusPanel` yang
 * membedakan `bill_berjalan` untuk menawarkan paksa).
 */
function mutasiDiam(sumber: string): string[] {
  const nama = [...sumber.matchAll(/const (\w+)\s*=\s*useMutation\(/g)].map((m) => m[1]);
  const disebut = new Set<string>();
  for (const m of sumber.matchAll(/galatTerbaru\(([^)]*)\)/g))
    for (const x of m[1].split(",")) disebut.add(x.trim());
  return nama.filter((n) => {
    if (new RegExp(`${n}\\.error`).test(sumber)) return false;
    if (disebut.has(n)) return false;
    // `onError` di dalam blok mutasi itu sendiri
    const i = sumber.indexOf(`const ${n} = useMutation(`);
    const blok = sumber.slice(i, i + 1600);
    return !blok.includes("onError:");
  });
}

/**
 * Pengecualian BERNAMA, bukan pelonggaran diam-diam.
 *
 * `hapusBanyak` menghapus banyak bahan dengan `Promise.allSettled` dan
 * MEMULANGKAN kegagalannya sebagai DATA, bukan melempar. `onSuccess`
 * menampilkannya per baris — nama bahan + pesan servernya — lalu memilih ulang
 * baris yang gagal supaya bisa dicoba lagi tepat yang itu saja.
 *
 * Untuk operasi massal itu lebih baik daripada satu `<ErrorText>` generik:
 * "3 dari 10 gagal, ini yang mana" tak bisa disampaikan oleh `mutation.error`,
 * yang hanya punya ruang untuk satu pesan. Sapuan di bawah tak bisa melihat
 * bentuk ini, jadi dikecualikan di sini — lengkap dengan sebabnya, supaya
 * pengecualiannya tak menular ke mutasi lain yang memang lalai.
 */
const DIKECUALIKAN: Record<string, string[]> = {
  "pages/bahan/BahanPage.tsx": ["hapusBanyak"],
};

describe("tak ada mutasi yang gagal tanpa suara", () => {
  it("seluruh web bersih", () => {
    const temuan: string[] = [];
    for (const f of berkasTsx(WEB)) {
      const rel = f.slice(WEB.length + 1);
      const kecuali = DIKECUALIKAN[rel] ?? [];
      const diam = mutasiDiam(readFileSync(f, "utf8")).filter((n) => !kecuali.includes(n));
      if (diam.length) temuan.push(`${rel}: ${diam.join(", ")}`);
    }
    expect(temuan, "mutasi ini gagal tanpa menampilkan apa pun").toEqual([]);
  });

  it("pengecualiannya masih memang menampilkan kegagalan per baris", () => {
    // Kalau `hapusBanyak` kelak berhenti melapor, pengecualiannya jadi tameng
    // untuk cacat yang sesungguhnya — jadi isinya ikut dijaga.
    const HAL = readFileSync(join(WEB, "pages/bahan/BahanPage.tsx"), "utf8");
    expect(HAL).toContain("bahan gagal dihapus —");
    expect(HAL).toContain("setPilih(new Set(gagal.map((g) => g.id)));");
  });
});

describe("premis: `galatTerbaru` memang ada dan memilih yang TERBARU", () => {
  const GALAT = readFileSync(
    fileURLToPath(new URL("../../web/src/lib/galat.ts", import.meta.url)),
    "utf8",
  );

  it("memilih berdasarkan `submittedAt`, bukan yang pertama truthy", () => {
    expect(GALAT).toContain("if (!terakhir || m.submittedAt > terakhir.submittedAt) terakhir = m;");
  });

  it("dan sebabnya ditulis — aksi terakhir BERHASIL harus membuat layar diam", () => {
    expect(GALAT).toContain("kalau aksi terakhir");
  });
});

describe("yang dulu tertinggal", () => {
  const ONB = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/OnboardingPage.tsx", import.meta.url)),
    "utf8",
  );
  const KAR = readFileSync(
    fileURLToPath(new URL("../../web/src/pages/pengaturan/KaryawanPage.tsx", import.meta.url)),
    "utf8",
  );

  it("Onboarding: Tolak & Terima berbagi satu tempat galat", () => {
    expect(ONB).toContain("<ErrorText error={galatTerbaru(terima, tolak)} />");
    expect(ONB).toContain('import { galatTerbaru } from "../lib/galat";');
  });

  it("Onboarding: keduanya memang bersebelahan di kartu yang sama", () => {
    const i = ONB.indexOf("onClick={() => tolak.mutate(u.id)}");
    const j = ONB.indexOf("onClick={() => terima.mutate(u.id)}");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(j - i).toBeLessThan(500);
  });

  it("Karyawan: Batalkan undangan punya tampilan galatnya", () => {
    expect(KAR).toContain("<ErrorText error={batalUndangan.error} />");
  });

  it("dan sebabnya ditulis, bukan cuma ditambal", () => {
    expect(KAR).toContain("mengira undangannya bandel");
    expect(ONB).toContain("belum punya perusahaan");
  });
});
