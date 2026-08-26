import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hitungPb1 } from "@kakarut/shared";

/**
 * Penjaga SATU RUMUS PB1.
 *
 * PB1 muncul di layar kasir SEBELUM tamu membayar — itu angka yang dijanjikan.
 * Yang benar-benar ditagih dihitung server saat `createSale`. Dua tempat, satu
 * angka, dan tamunya berdiri di depan kasir saat keduanya harus cocok.
 *
 * Dulu keduanya memang cocok, tapi karena KEBETULAN: rumusnya ditulis dua kali,
 * `hitungPb1(subtotal, rate)` di server dan `Math.round(subtotalNet * (rate /
 * 100))` disalin di `KasirPage`. Selama tak ada yang menyentuhnya, tak ada yang
 * kelihatan. Tapi pembulatan PB1 adalah hal yang memang berubah — dibulatkan ke
 * ratusan rupiah terdekat, misalnya, permintaan yang lumrah di sini — dan
 * perubahan seperti itu akan dikerjakan di `hitungPb1`, tempat yang benar.
 * Layar kasir akan tetap memakai rumus lamanya, diam-diam.
 *
 * Akibatnya bukan uji yang merah melainkan tamu yang protes: layar bilang satu
 * angka, struk mencetak angka lain, dan kasir tak punya cara menjelaskan
 * selisihnya. Kasir pula yang disalahkan.
 *
 * MAKA aturannya: tarif PB1 boleh berubah jadi rupiah HANYA di satu tempat.
 * Semua yang lain memanggilnya.
 *
 * YANG SENGAJA TIDAK IKUT ATURAN INI: refund. `hitungUangSetelahRefund`
 * menurunkan PB1 dari PB1 ASAL secara proporsional, bukan menghitung ulang dari
 * tarif hari ini — karena tarifnya bisa sudah berubah sejak transaksi terjadi,
 * dan yang dikembalikan harus yang DULU dibayar. Memanggil `hitungPb1` di sana
 * justru akan jadi bug. Itu dipatok di bawah supaya tak "dirapikan" kelak.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const KASIR = readFileSync(AKAR + "apps/web/src/pages/kasir/KasirPage.tsx", "utf8");
const LAYANAN = readFileSync(AKAR + "apps/server/src/modules/penjualan/service.ts", "utf8");
const REFUND = readFileSync(AKAR + "packages/shared/src/refund.ts", "utf8");

describe("tarif PB1 jadi rupiah hanya di satu baris di seluruh repo", () => {
  function semuaSumber(dir: string): string[] {
    const hasil: string[] = [];
    for (const nama of readdirSync(dir)) {
      if (nama === "node_modules" || nama === "dist") continue;
      const p = dir + nama;
      if (statSync(p).isDirectory()) hasil.push(...semuaSumber(p + "/"));
      else if (/\.tsx?$/.test(nama)) hasil.push(p);
    }
    return hasil;
  }

  const BERKAS = ["apps/web/src/", "apps/server/src/", "packages/shared/src/"].flatMap((r) =>
    semuaSumber(AKAR + r),
  );

  /** Baris yang menyebut tarif PB1 DAN membaginya jadi pecahan. */
  const aritmetika = BERKAS.flatMap((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .map((baris, i) => ({ berkas: p.slice(AKAR.length), baris: i + 1, teks: baris }))
      .filter(
        (b) =>
          /pb1_rate|pb1Rate|ratePersen/.test(b.teks) &&
          /\/\s*100|\*\s*0\./.test(b.teks) &&
          !/^\s*(\/\/|\*)/.test(b.teks),
      ),
  );

  it("tepat SATU baris, dan baris itu ada di `hitungPb1`", () => {
    // Bukan "≤ 1": nol berarti penyapunya yang rusak, bukan repo yang bersih —
    // dan penjaga yang hijau karena tak menemukan apa pun tidak menjaga apa pun.
    //
    // Yang dipatok BERKAS + FUNGSInya, bukan NOMOR BARISnya. Versi lama menulis
    // "packages/shared/src/hpp.ts:103", dan baris itu bergeser ke 122 begitu
    // komentar pengukuran ditambahkan di atasnya — gerbang merah yang tak
    // menyatakan apa pun tentang PB1. Yang dijaga niatnya: satu situs, dan
    // situs itu di dalam badan `hitungPb1`.
    expect(
      aritmetika.map((b) => b.berkas),
      "tarif PB1 diubah jadi rupiah di lebih dari satu tempat (atau penyapunya berhenti cocok)",
    ).toEqual(["packages/shared/src/hpp.ts"]);

    const HPP = readFileSync(AKAR + "packages/shared/src/hpp.ts", "utf8").split("\n");
    const i = aritmetika[0].baris - 1;
    const awal = HPP.slice(0, i).map((b) => b.trim()).reverse()
      .find((b) => /^export function \w+/.test(b));
    expect(awal, "aritmetika PB1 pindah keluar dari `hitungPb1`").toMatch(
      /^export function hitungPb1\(/,
    );
  });

  it("layar kasir MEMANGGIL rumusnya, bukan menyalinnya", () => {
    expect(KASIR).toContain("hitungPb1(subtotalNet, pb1Conf.pb1_rate)");
    // Yang dijaga: `hitungPb1` datang dari @kakarut/shared. Dulu barisnya
    // dipaku APA ADANYA, jadi menambah satu nama lain ke daftar impor yang sama
    // memerahkan gerbang ini tanpa satu pun rumus berpindah. Yang dipaku kini
    // niatnya: nama itu ada di dalam impor dari paket bersama.
    const impor = KASIR.match(/import \{([^}]*)\} from "@kakarut\/shared";/g) ?? [];
    expect(impor.some((b) => /\bhitungPb1\b/.test(b)), "hitungPb1 tak lagi diimpor dari @kakarut/shared").toBe(
      true,
    );
  });

  it("server tetap memakai fungsi yang sama — bukan cuma webnya yang dirapikan", () => {
    // Kalau hanya satu sisi memanggil, "satu rumus" jadi klaim kosong.
    expect(LAYANAN).toContain("hitungPb1(subtotalNet, company.pb1Rate)");
  });
});

describe("angkanya memang tak berubah oleh perapian ini", () => {
  it("`hitungPb1` sama persis dengan rumus lama yang disalin di layar kasir", () => {
    // Perapian yang diam-diam menggeser uang bukan perapian. Rentangnya sengaja
    // memuat nilai yang jatuh tepat di .5 (pembulatan) dan tarif pecahan.
    const rumusLama = (net: number, rate: number) => Math.round(net * (rate / 100));
    for (const net of [0, 1, 5, 7, 12_345, 33_333, 99_999, 1_000_000]) {
      for (const rate of [0, 5, 7.5, 10, 11, 100]) {
        expect(hitungPb1(net, rate), `net=${net} rate=${rate}`).toBe(rumusLama(net, rate));
      }
    }
  });

  it("pembulatannya ke rupiah terdekat, bukan dipotong", () => {
    // Mematoknya membuat perubahan pembulatan di masa depan TERLIHAT sebagai
    // keputusan — uji ini yang harus diperbarui bersama rumusnya.
    expect(hitungPb1(15, 10)).toBe(2); // 1,5 → 2
    expect(hitungPb1(14, 10)).toBe(1); // 1,4 → 1
  });
});

describe("refund SENGAJA tidak ikut — ia mengembalikan yang dulu dibayar", () => {
  it("PB1 refund diturunkan dari PB1 asal, bukan dari tarif hari ini", () => {
    expect(REFUND).toContain("Math.round((asal.pb1 * net) / netAsal)");
  });

  it("dan `hitungPb1` memang TIDAK dipanggil di sana", () => {
    // Kalau tarif naik 10% → 11% sesudah transaksi, menghitung ulang akan
    // mengembalikan uang yang tamunya tak pernah bayar.
    expect(REFUND).not.toContain("hitungPb1");
  });
});
