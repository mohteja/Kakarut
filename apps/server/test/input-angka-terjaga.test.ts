import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Penjaga ANGKA MENTAH DARI KOTAK ISIAN.
 *
 * `<input type="number">` tidak menahan apa pun. Atribut `min`/`max` hanya
 * mengatur tombol panah dan status validitas form — nilai yang diketik, dan
 * kotak yang DIKOSONGKAN, tetap sampai ke `onChange`. Jadi:
 *
 *     Number("")     = 0        ← cara paling wajar mengetik ulang angka
 *     Number("2e")   = NaN      ← ketikan setengah jadi, diterima type=number
 *     Number("-")    = NaN
 *
 * Yang membuat penjaga ini ada: setelan `chunkSize` printer BLE. Nilainya
 * dipakai sebagai LANGKAH perulangan pengiriman byte, ditulis ke localStorage
 * tiap ketukan, dan tak disaring sama sekali. `0` membuat perulangannya tak
 * pernah maju — printer dibanjiri potongan kosong selamanya dan struk tak
 * pernah keluar; `NaN` membuatnya selesai tanpa mengirim satu byte pun,
 * sementara `write()` melaporkan BERHASIL.
 *
 * Sesudah cacat itu diperbaiki, seluruh web disapu dan ternyata ia
 * satu-satunya yang tak terjaga. Penjaga ini yang membuat kesimpulan itu
 * bertahan: yang berikutnya ditambahkan harus ikut dijaga, atau disebut
 * namanya di sini berikut alasannya.
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

const POLA = /(?:Number|parseInt|parseFloat)\(\s*e\.(?:target|currentTarget)\.value/;

/**
 * Bentuk penjagaan yang diterima, semuanya terlihat pada baris yang sama:
 *
 *  - `|| bawaan`   — nilai jatuh ke angka yang masuk akal
 *  - `? … : …`     — kotak kosong ditangani lebih dulu
 *  - `=== x`       — hasilnya dibandingkan, bukan dipakai sebagai angka
 *  - `Number.isFinite` — disaring eksplisit
 *
 * Sengaja per baris: kalau penjagaannya jauh dari tempat angkanya masuk, ia
 * mudah hilang saat kode di antaranya diubah — dan itu persis cara cacat
 * printer bertahan begitu lama.
 */
function terjaga(baris: string): boolean {
  return (
    baris.includes("||") ||
    baris.includes("?") ||
    baris.includes("===") ||
    baris.includes("Number.isFinite")
  );
}

/**
 * Pengecualian BERNAMA, bukan pelonggaran diam-diam.
 *
 * Nilai yang datang dari `<select>` beropsi tetap tak bisa kosong dan tak bisa
 * diketik — pemakainya hanya bisa memilih salah satu `<option>` yang kita
 * tulis sendiri. Di situ `Number(...)` memang selalu angka yang sah.
 *
 * Yang TIDAK boleh masuk daftar ini: `<input>` apa pun. Kalau kelak salah satu
 * dari dua berkas ini berganti dari `<select>` jadi kotak ketik, sapuan di
 * bawah tak akan menyadarinya — jadi bentuk `<select>`-nya ikut dijaga.
 */
const DIKECUALIKAN: Record<string, { baris: string; sebab: string }[]> = {
  "pages/pengaturan/PrinterPage.tsx": [
    { baris: "paperWidth: Number(e.target.value) as 58 | 80,", sebab: "<select> 58/80" },
  ],
  "pages/stok/PermintaanStokPage.tsx": [
    { baris: "setPerPage(Number(e.target.value));", sebab: "<select> 10/20/50/100" },
  ],
};

describe("tak ada angka mentah dari kotak isian yang lolos tanpa penjaga", () => {
  it("seluruh web bersih", () => {
    const temuan: string[] = [];
    for (const f of berkasTsx(WEB)) {
      const rel = f.slice(WEB.length + 1);
      const kecuali = (DIKECUALIKAN[rel] ?? []).map((x) => x.baris);
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((baris, i) => {
          if (!POLA.test(baris) || terjaga(baris)) return;
          if (kecuali.includes(baris.trim())) return;
          temuan.push(`${rel}:${i + 1} — ${baris.trim()}`);
        });
    }
    expect(temuan, "angka ini bisa bernilai 0/NaN tanpa ada yang menahannya").toEqual([]);
  });

  it("pengecualiannya memang masih `<select>`, bukan kotak ketik", () => {
    for (const [rel, daftar] of Object.entries(DIKECUALIKAN)) {
      const isi = readFileSync(join(WEB, rel), "utf8");
      for (const { baris, sebab } of daftar) {
        const i = isi.indexOf(baris);
        expect(i, `${rel}: baris pengecualian tak ditemukan lagi — ${baris}`).toBeGreaterThan(0);
        // `<select` harus berada TIDAK JAUH di atas barisnya; kalau kelak jadi
        // `<input>`, jaraknya tak akan cocok dan pengecualiannya gugur.
        const sebelum = isi.slice(Math.max(0, i - 400), i);
        expect(sebelum, `${rel}: ${sebab} — bukan <select> lagi?`).toContain("<select");
      }
    }
  });
});

describe("yang sudah dijaga tetap dijaga", () => {
  const PRINTER = readFileSync(join(WEB, "pages/pengaturan/PrinterPage.tsx"), "utf8");

  it("tiga kotak angka printer lewat penyaring bersama", () => {
    for (const k of ["feedLines", "chunkSize", "chunkDelayMs"]) {
      expect(PRINTER, k).toContain(`ketikAngka("${k}", e.target.value)`);
    }
    expect(PRINTER).toContain("if (Number.isFinite(n)) updateSettings(");
  });

  it("port LAN punya nilai jatuh", () => {
    expect(PRINTER).toContain("lanPort: Number(e.target.value) || 9100");
  });

  it("kolom per baris menolak nol lewat pemakainya", () => {
    const SETELAN = readFileSync(join(WEB, "lib/print/settings.ts"), "utf8");
    expect(SETELAN).toContain("s.charsPerLine && s.charsPerLine > 0");
  });
});
