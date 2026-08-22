import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * RUPIAH YANG DIHITUNG DI KLIEN — RATCHET, bukan larangan.
 *
 * Tiap angka rupiah yang dihitung di `apps/web` adalah SALINAN KEDUA dari
 * aturan yang sudah dipunyai server, dan salinan yang menyimpang tak berbunyi
 * apa-apa — ia cuma memberi angka yang berbeda dari yang dicatat. Bentuk itu
 * sudah nyata sekali di repo ini: lembar pembayaran ponsel menghitung PB1
 * dengan urutan operasi yang berbeda dari server, dan selisihnya (Rp 282 vs
 * Rp 283) muncul tepat di layar tempat kasir membaca total sebelum menekan
 * Bayar.
 *
 * SAAT RATCHET INI DIPASANG, VENANYA BERSIH — dan itu diukur, bukan dibaca.
 * Rantai uang layar kasir (subtotal → diskon → batas diskon → PB1 → total)
 * disalin apa adanya lalu DIADU dengan yang benar-benar dicatat server lewat
 * `POST /penjualan` sungguhan, 10 kasus:
 *
 *     polos 1 baris · polos 3 baris ganjil · diskon 7% · diskon PAS 10% ·
 *     diskon 25% (di atas batas) · diskon 7,5% · nominal Rp 1.000 ·
 *     nominal Rp 50.000 (di atas batas) · diskon 100% · qty 7
 *
 * pada perusahaan ber-PB1 **11,13%** dan batas diskon kasir **10%**:
 * **10 kasus, 0 selisih** — subtotal, diskon, PB1, dan total keempatnya sama
 * persis. Yang membuatnya begitu: layar kasir memanggil `hitungPb1` dari
 * `@kakarut/shared`, bukan menulis ulang rumusnya, dan komentarnya sendiri
 * menuliskan alasannya.
 *
 * KENAPA RATCHET DAN BUKAN NOL. Sebagian besar dari yang terhitung di bawah
 * memang tak punya salinan di server: penjumlahan Σ medan yang server kirim
 * (`rows.reduce((t, r) => t + r.total_harga, 0)`) bukan aturan kedua, ia cuma
 * penjumlahan atas jawaban server. Menuntut nol berarti melarang menjumlahkan
 * daftar. Yang dijaga: JUMLAHNYA TAK BOLEH TUMBUH tanpa ada yang memikirkannya.
 */
/*
 * Garis miring di ujung literalnya DISENGAJA, dan ia bukan gaya penulisan:
 * `jangkar-iris` menuntut tiap berkas uji yang memakai `.indexOf("…")` menyebut
 * sumber yang bisa DITELUSURI, dan penelusurnya mengenali direktori lewat
 * literal yang berakhir "/" . Tanpa itu berkas ini masuk daftar "tak satu pun
 * berkas sumbernya terpetakan" — dan hijaunya lalu berarti "tidak diperiksa",
 * bukan "aman". Yang ditelusuri memang benar direktori ini: seluruh isinya
 * dibaca `situsUang` di bawah.
 */
const WEB = fileURLToPath(new URL("../../web/src/", import.meta.url)).replace(/\/$/, "");

/**
 * Jumlah saat ratchet dipasang: 13 (arah A) + 20 (arah B) + 1 (arah C).
 *
 * Turun boleh (dan bagus — artinya satu hitungan pindah ke server atau ke
 * `@kakarut/shared`). Naik berarti ada rupiah baru yang dihitung di layar:
 * pastikan ia bukan salinan kedua dari aturan yang sudah punya rumah, lalu
 * naikkan DASAR dengan alasan di pesan commit — bukan diam-diam.
 */
const DASAR = 34;

function berkasKode(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasKode(p));
    else if (/\.tsx?$/.test(nama)) keluar.push(p);
  }
  return keluar;
}

/**
 * Buang isi komentar TANPA menggeser posisi — diganti spasi, `\n` dijaga.
 *
 * Bukan kerapian: versi pertama sapuan ini memakai penghapus yang memendekkan
 * teksnya, dan melaporkan `ResepPage:1012` untuk baris yang sebenarnya `1110`.
 * Penjaga yang menunjuk baris yang salah menghabiskan waktu orang persis di
 * saat ia sedang mencari sesuatu, dan itu cara tercepat membuatnya diabaikan.
 */
export function butaKomentar(s: string): string {
  const out = s.split("");
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("/*", i)) {
      let j = s.indexOf("*/", i + 2);
      j = j < 0 ? s.length : j + 2;
      for (let k = i; k < j; k += 1) if (out[k] !== "\n") out[k] = " ";
      i = j;
    } else if (s.startsWith("//", i)) {
      let j = s.indexOf("\n", i);
      j = j < 0 ? s.length : j;
      for (let k = i; k < j; k += 1) out[k] = " ";
      i = j;
    } else i += 1;
  }
  return out.join("");
}

/** Isi kurung seimbang yang MULAI di `s[i] === "("`. */
function seimbang(s: string, i: number): string {
  let d = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === "(") d += 1;
    else if (s[j] === ")") {
      d -= 1;
      if (d === 0) return s.slice(i + 1, j);
    }
  }
  return "";
}

/**
 * Operator aritmetika SUNGGUHAN. `[\w)\]]` di depan dan `[\w(]` di belakang
 * wajib: tanpa keduanya `=>`, `+` penyambung JSX, dan tanda minus unary ikut
 * tertangkap, dan gerbangnya jadi menuduh seluruh berkas.
 */
export const ARIT = /[\w)\]]\s*[-+*/]\s*[\w(]/;

interface Situs {
  file: string;
  baris: number;
  arah: "A" | "B" | "C";
  isi: string;
}

export function situsUang(root: string): { situs: Situs[]; totalFormatRupiah: number } {
  const situs: Situs[] = [];
  let totalFormatRupiah = 0;
  for (const p of berkasKode(root)) {
    const src = readFileSync(p, "utf8");
    const b = butaKomentar(src);
    const rel = p.slice(root.length + 1);
    const baris = (idx: number) => src.slice(0, idx).split("\n").length;

    for (const m of b.matchAll(/\bformatRupiah\s*\(/g)) {
      const arg = seimbang(b, m.index! + m[0].length - 1).trim();
      if (!arg) continue;
      totalFormatRupiah += 1;
      // ARAH A — dihitung DI DALAM kurung render.
      if (ARIT.test(arg)) {
        situs.push({ file: rel, baris: baris(m.index!), arah: "A", isi: arg });
        continue;
      }
      // ARAH B — dirender apa adanya, tapi variabelnya dihitung di berkas ini.
      //
      // BEBAS NAMA, dan itu seluruh pointnya. Versi pertama arah ini memakai
      // daftar kata (`total|diskon|harga|…`) dan melewatkan `upahPalsu` pada
      // bukti merahnya sendiri. Daftar nama adalah detektor yang selalu
      // tertinggal satu kata — dan ia sudah menuduh empat pemanggilan yang
      // benar pada vena sebelumnya. Yang dipakai sekarang: apa pun yang
      // dirender `formatRupiah` ADALAH rupiah menurut kodenya sendiri.
      if (!/^[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*$/.test(arg)) continue;
      const akar = arg.split(/[.?]/)[0];
      const d = new RegExp(`\\b(?:const|let)\\s+${akar}\\s*=\\s*([^\\n;]{0,220})`).exec(b);
      if (d && ARIT.test(d[1])) {
        situs.push({ file: rel, baris: baris(m.index!), arah: "B", isi: `${arg} = ${d[1].trim()}` });
      }
    }

    // ARAH C — rupiah yang dirender TANPA `formatRupiah` (literal "Rp {…}").
    // Ia kecil (4 titik), dan justru karena itu ikut dihitung: dua arah di atas
    // buta terhadapnya, dan batas yang tak diukur adalah batas yang menguap.
    for (const m of b.matchAll(/Rp\s*\{/g)) {
      const ln = baris(m.index!);
      const teks = src.split("\n")[ln - 1] ?? "";
      if (ARIT.test(teks) && !teks.includes("formatRupiah")) {
        situs.push({ file: rel, baris: ln, arah: "C", isi: teks.trim() });
      }
    }
  }
  return { situs, totalFormatRupiah };
}

describe("rupiah yang dihitung di klien tak boleh bertambah", () => {
  const { situs, totalFormatRupiah } = situsUang(WEB);

  it("premis: pemindainya benar-benar membaca apps/web", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat ratchetnya hijau dengan
    // hitungan nol — yaitu izin terbuka, bukan penjagaan.
    expect(totalFormatRupiah, "tak satu pun formatRupiah( terbaca").toBeGreaterThan(150);
    expect(situs.filter((s) => s.arah === "A").length).toBeGreaterThan(5);
    expect(situs.filter((s) => s.arah === "B").length).toBeGreaterThan(5);
  });

  it("INTI: jumlahnya tidak melebihi DASAR", () => {
    expect(
      situs.length,
      `ada rupiah BARU yang dihitung di layar. Tiap hitungan uang di klien ` +
        `adalah salinan kedua dari aturan yang sudah dipunyai server, dan ` +
        `salinan yang menyimpang tidak berbunyi apa-apa — ia cuma memberi ` +
        `angka yang berbeda dari yang dicatat (PB1 ponsel: Rp 282 vs Rp 283, ` +
        `di layar tempat kasir membaca total sebelum menekan Bayar). Pakai ` +
        `fungsi dari @kakarut/shared bila aturannya sudah punya rumah, atau ` +
        `naikkan DASAR dengan alasan di pesan commit.\n\nsitus:\n` +
        situs.map((s) => `  [${s.arah}] ${s.file}:${s.baris}  ${s.isi.slice(0, 90)}`).join("\n"),
    ).toBeLessThanOrEqual(DASAR);
  });

  it("PASANGAN: medan server yang dirender apa adanya TIDAK dihitung", () => {
    // Kalau `formatRupiah(sale.total)` ikut terhitung, ratchetnya berubah jadi
    // "jangan menampilkan uang" — tuntutan yang tak masuk akal, dan penjaga
    // yang menuntut hal tak masuk akal akan dilonggarkan orang, bukan dipatuhi.
    expect(totalFormatRupiah - situs.filter((s) => s.arah !== "C").length).toBeGreaterThan(150);
  });

  it("PASANGAN: pemindainya bisa MENUDUH ketiga arahnya", () => {
    const A = (kode: string) => {
      const arg = seimbang(kode, kode.indexOf("(", kode.indexOf("formatRupiah")));
      return ARIT.test(arg);
    };
    expect(A("formatRupiah(a - b)")).toBe(true);
    expect(A("formatRupiah(sale.total)")).toBe(false);
    expect(A("formatRupiah(it.hargaSatuan * ditagih)")).toBe(true);
    // …dan bukan aritmetika: panah, koma, minus unary
    expect(ARIT.test("(a) => b")).toBe(false);
    expect(ARIT.test("fn(a, b)")).toBe(false);
  });

  it("PASANGAN: komentar tak menggeser nomor baris", () => {
    // Dibuktikan atas teks yang panjang komentarnya berbeda-beda: yang dijaga
    // BUKAN isinya melainkan bahwa posisinya tak bergerak.
    const s = "satu\n/* dua\n   tiga */\nempat // lima\nenam\n";
    const b = butaKomentar(s);
    expect(b.length).toBe(s.length);
    expect(b.split("\n").length).toBe(s.split("\n").length);
    expect(b.split("\n")[3].trim()).toBe("empat");
    expect(b.split("\n")[1].trim()).toBe("");
  });
});
