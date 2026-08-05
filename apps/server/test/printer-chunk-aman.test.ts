import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RENTANG, angkaSetelan, potongBytes } from "../../web/src/lib/print/batas";

/**
 * Penjaga SETELAN PRINTER YANG DIKETIK BEBAS.
 *
 * `chunkSize` di Pengaturan Printer adalah LANGKAH perulangan pengiriman byte
 * ke printer BLE, dan nilainya datang mentah-mentah dari
 * `<input type="number">` — yang `min`/`max`-nya tidak menahan apa pun; ia cuma
 * mengatur tombol panah dan status validitas form. Tiap ketukan langsung
 * ditulis ke localStorage, jadi nilainya bertahan sampai perangkatnya diganti.
 *
 * Dua bentuk kegagalannya, keduanya senyap:
 *
 *   chunkSize = 0    (kotak dikosongkan — cara paling wajar mengetik ulang)
 *     → `i += 0` → perulangan tak pernah maju. Printer dibanjiri potongan
 *       kosong selamanya, struk tak keluar, status berhenti di "Mencetak…".
 *
 *   chunkSize = NaN  ("2e", "-", "1.2.3" — semua diterima type="number")
 *     → badannya jalan SEKALI (`0 < panjang`) dengan `slice(0, NaN)` = potongan
 *       KOSONG, lalu `i` jadi NaN dan `NaN < panjang` false. Jadi: satu tulisan
 *       kosong ke printer, NOL byte struk, dan `write()` BERHASIL. Aplikasi
 *       melaporkan struk tercetak untuk sesuatu yang tak pernah keluar.
 *       Lalu `JSON.stringify(NaN)` = `null`, jadi sesudah muat ulang ia jadi
 *       `null` → `i += null` = `i += 0` → berubah jadi kasus pertama.
 *
 * Yang TIDAK cacat, dan sengaja tidak diklaim cacat: langkah pecahan (100,5).
 * `slice` memangkas awal dan akhir sama-sama ke bawah, jadi potongannya tetap
 * sambung-menyambung — 1000 byte tetap terkirim 1000 byte. `Math.round` di
 * `angkaSetelan` cuma merapikan, bukan menambal.
 *
 * Dua tetangganya di berkas yang sama sudah dijaga sejak awal (`lanPort` pakai
 * `Number(...) || 9100`, `effectiveCharsPerLine` pakai `> 0`), jadi yang paling
 * gawat justru satu-satunya yang terlewat.
 */

const DIR = (p: string) => fileURLToPath(new URL(`../../web/src/${p}`, import.meta.url));
const BLE = readFileSync(DIR("lib/print/bluetooth.ts"), "utf8");
const SETELAN = readFileSync(DIR("lib/print/settings.ts"), "utf8");
const HAL = readFileSync(DIR("pages/pengaturan/PrinterPage.tsx"), "utf8");

const STRUK = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

function gabung(potongan: Uint8Array[]): Uint8Array {
  const total = potongan.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of potongan) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/**
 * Bentuk perulangan yang LAMA, ditulis ulang di sini dengan pembatas langkah.
 * Bukan hiasan: ia yang membuktikan bahwa dua kasus di atas memang cacat, dan
 * ia akan tetap membuktikannya kalau nanti ada yang "merapikan" `write()`
 * kembali ke bentuk ini.
 */
function caraLama(bytes: Uint8Array, chunkSize: number, batas = 5000) {
  const potongan: Uint8Array[] = [];
  let langkah = 0;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    potongan.push(bytes.slice(i, i + chunkSize));
    if (++langkah >= batas) return { potongan, mentok: true };
  }
  return { potongan, mentok: false };
}

describe("cacatnya memang nyata (bentuk perulangan lama)", () => {
  it("chunkSize 0 → berputar tanpa akhir", () => {
    expect(caraLama(STRUK, 0).mentok).toBe(true);
  });

  it("chunkSize NaN → 'berhasil' tanpa mengirim satu byte pun", () => {
    const { potongan, mentok } = caraLama(STRUK, NaN);
    expect(mentok).toBe(false);
    // satu tulisan, isinya kosong — inilah yang dilaporkan sebagai sukses
    expect(potongan).toHaveLength(1);
    expect(gabung(potongan)).toHaveLength(0);
  });

  it("NaN yang lewat localStorage berubah jadi null → sama dengan 0", () => {
    const balik = JSON.parse(JSON.stringify({ chunkSize: NaN })) as { chunkSize: number | null };
    expect(balik.chunkSize).toBeNull();
    expect(caraLama(STRUK, balik.chunkSize as number).mentok).toBe(true);
  });

  it("tapi langkah PECAHAN memang tidak merusak apa-apa", () => {
    // Dugaan awalnya `slice(100.5, 201)` memangkas awalnya saja sehingga byte
    // ke-100 terkirim dua kali. Salah: awal DAN akhir sama-sama dipangkas ke
    // bawah, jadi potongannya tetap sambung. Dicatat di sini supaya tak ada
    // yang menaruhnya lagi di daftar cacat.
    const { potongan } = caraLama(STRUK, 100.5);
    expect(gabung(potongan)).toEqual(STRUK);
    expect(potongan.map((p) => p.length).slice(0, 4)).toEqual([100, 101, 100, 101]);
  });
});

describe("potongBytes: apa pun setelannya, hasilnya utuh dan selesai", () => {
  const NILAI_LIAR: [string, unknown][] = [
    ["kotak dikosongkan", 0],
    ["NaN", NaN],
    ["null sesudah muat ulang", null],
    ["undefined", undefined],
    ["negatif", -100],
    ["pecahan", 100.5],
    ["tak hingga", Infinity],
    ["teks", "seratus"],
    ["jauh di atas batas", 999999],
  ];

  for (const [nama, nilai] of NILAI_LIAR) {
    it(`${nama} → seluruh byte terkirim tepat sekali`, () => {
      const potongan = potongBytes(STRUK, nilai as number);
      expect(potongan.length).toBeGreaterThan(0);
      expect(gabung(potongan)).toEqual(STRUK);
    });

    it(`${nama} → tiap potongan masih di dalam rentang`, () => {
      for (const p of potongBytes(STRUK, nilai as number)) {
        expect(p.length).toBeGreaterThan(0);
        expect(p.length).toBeLessThanOrEqual(RENTANG.chunkSize.max);
      }
    });
  }

  it("setelan wajar dipakai apa adanya", () => {
    expect(potongBytes(STRUK, 100)).toHaveLength(10);
    expect(potongBytes(STRUK, 250)).toHaveLength(4);
  });

  it("byte kosong → tak ada yang dikirim (bukan satu potongan kosong)", () => {
    expect(potongBytes(new Uint8Array(0), 100)).toEqual([]);
  });

  it("potongan terakhir boleh lebih pendek", () => {
    const potongan = potongBytes(STRUK, 300);
    expect(potongan.map((p) => p.length)).toEqual([300, 300, 300, 100]);
  });
});

describe("angkaSetelan", () => {
  const R = { min: 20, max: 512 };

  it("bukan angka → bawaan", () => {
    expect(angkaSetelan(NaN, 100, R)).toBe(100);
    expect(angkaSetelan(undefined, 100, R)).toBe(100);
    expect(angkaSetelan("seratus", 100, R)).toBe(100);
    expect(angkaSetelan(Infinity, 100, R)).toBe(100);
  });

  it("di luar rentang → dijepit ke batas terdekat, bukan ke bawaan", () => {
    // Sengaja: yang mengetik 10 memang mau sekecil mungkin, dan 20 adalah
    // jawaban jujurnya. Kotaknya merapikan diri saat blur, jadi terlihat.
    expect(angkaSetelan(10, 100, R)).toBe(20);
    expect(angkaSetelan(9999, 100, R)).toBe(512);
    expect(angkaSetelan(-5, 100, R)).toBe(20);
  });

  it("`null` dan kotak kosong ikut dijepit (keduanya jadi 0 lewat Number)", () => {
    expect(angkaSetelan(null, 100, R)).toBe(20);
    expect(angkaSetelan("", 100, R)).toBe(20);
  });

  it("pecahan dibulatkan (kerapian: jumlah byte itu bilangan bulat)", () => {
    expect(angkaSetelan(100.5, 100, R)).toBe(101);
    expect(angkaSetelan(100.4, 100, R)).toBe(100);
  });

  it("angka wajar lewat apa adanya", () => {
    expect(angkaSetelan(100, 100, R)).toBe(100);
    expect(angkaSetelan(20, 100, R)).toBe(20);
    expect(angkaSetelan(512, 100, R)).toBe(512);
  });

  it("0 sah untuk setelan yang batas bawahnya 0", () => {
    expect(angkaSetelan(0, 20, RENTANG.chunkDelayMs)).toBe(0);
    expect(angkaSetelan(0, 3, RENTANG.feedLines)).toBe(0);
  });
});

describe("pemakainya benar-benar memakai pagarnya", () => {
  it("write() BLE tak lagi menaikkan indeks dengan chunkSize", () => {
    expect(BLE).toContain("for (const chunk of potongBytes(bytes, this.chunkSize)) {");
    expect(BLE).not.toContain("i += this.chunkSize");
  });

  it("setChunking menyaring dua-duanya", () => {
    expect(BLE).toContain(
      "this.chunkSize = angkaSetelan(chunkSize, RENTANG.chunkSize.min, RENTANG.chunkSize);",
    );
    expect(BLE).toContain("this.chunkDelayMs = angkaSetelan(");
  });

  it("nilai yang sudah terlanjur tersimpan dirapikan saat dimuat", () => {
    expect(SETELAN).toContain("return rapikanAngka({ ...DEFAULT_PRINTER_SETTINGS, ...parsed });");
  });

  it("dan TIDAK dirapikan saat menyimpan — supaya angkanya masih bisa diketik", () => {
    const i = SETELAN.indexOf("export function savePrinterSettings");
    expect(SETELAN.slice(i, i + 200)).not.toContain("rapikanAngka");
    expect(SETELAN).toContain("membuat angkanya tak bisa diketik sampai selesai");
  });

  it("halaman: tiga kotak angka memakai penyaring yang sama", () => {
    for (const k of ["feedLines", "chunkSize", "chunkDelayMs"]) {
      expect(HAL, k).toContain(`onChange={(e) => ketikAngka("${k}", e.target.value)}`);
      expect(HAL, k).toContain(`onBlur={() => rapikanAngka("${k}")}`);
      expect(HAL, k).toContain(`min={RENTANG.${k}.min}`);
      expect(HAL, k).toContain(`max={RENTANG.${k}.max}`);
    }
  });

  it("halaman: NaN tak pernah sampai ke localStorage", () => {
    expect(HAL).toContain("if (Number.isFinite(n)) updateSettings(");
  });

  it("sebabnya ditulis, supaya `min`/`max` tak dikira sudah cukup", () => {
    expect(HAL).toContain("hanya mengatur tombol panah");
  });
});

describe("bawaan setelan harus berada di dalam rentangnya", () => {
  // Penjaga selisih: `DEFAULT_PRINTER_SETTINGS` hidup di `settings.ts` (menyentuh
  // localStorage, jadi tak bisa diimpor dari sini) sementara rentangnya di
  // `batas.ts`. Kalau salah satunya digeser tanpa yang lain, bawaannya sendiri
  // akan dijepit setiap kali dimuat — dan tak ada yang memberitahu.
  const BAWAAN = Object.fromEntries(
    (["chunkSize", "chunkDelayMs", "feedLines"] as const).map((k) => {
      const m = new RegExp(`${k}: (-?\\d+)`).exec(SETELAN);
      return [k, m ? Number(m[1]) : NaN];
    }),
  );

  for (const k of ["chunkSize", "chunkDelayMs", "feedLines"] as const) {
    it(`${k}`, () => {
      expect(Number.isFinite(BAWAAN[k]), `bawaan ${k} tak terbaca dari settings.ts`).toBe(true);
      expect(BAWAAN[k]).toBeGreaterThanOrEqual(RENTANG[k].min);
      expect(BAWAAN[k]).toBeLessThanOrEqual(RENTANG[k].max);
    });
  }
});
