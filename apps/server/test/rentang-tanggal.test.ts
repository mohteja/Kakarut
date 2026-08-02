import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga RENTANG TANGGAL: pasangan dari/sampai harus saling membatasi.
 *
 * `KartuStokPage` menuliskan alasannya sendiri, dan alasannya bukan sekadar
 * "hasilnya kosong": saat `dari > sampai` jendelanya NEGATIF, sehingga
 * `saldo_akhir` jatuh di bawah `saldo_awal` tanpa satu pun mutasi — lalu kartu
 * ringkasannya MENGARANG "disetel Stok Awal −N" untuk penyesuaian yang tak
 * pernah ada. Catatan di sana menyebut penjagaannya dipasang "persis seperti
 * halaman laporan lain", jadi ini memang dimaksudkan sebagai aturan rumah.
 *
 * Aturan rumah tanpa penjaga hanya bertahan selama yang menulisnya ingat: tiga
 * halaman berikutnya yang menambah pemilih rentang melewatkannya — Kartu
 * Perlengkapan (kembaran langsung Kartu Stok), daftar Beli/Produksi, dan dua
 * rentang di Rekomendasi Beli.
 *
 * YANG DIPATOK: tiap `<input type="date">` di web harus membawa `min`/`max`,
 * ATAU terdaftar di bawah sebagai tanggal TUNGGAL (yang memang tak punya
 * pasangan untuk dibatasi). Daftarnya tertutup — pemilih rentang baru yang
 * lupa dibatasi langsung terlihat.
 *
 * YANG TIDAK DIPATOK: bahwa `min`/`max`-nya menunjuk pasangan yang BENAR.
 * `min={dari}` pada input yang salah tetap lolos; penjaga ini memaksa
 * pembatasnya ada, bukan menggantikan pembacaan.
 */
const akar = fileURLToPath(new URL("../../web/src/", import.meta.url));

function semuaTsx(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTsx(p + "/"));
    else if (nama.endsWith(".tsx")) hasil.push(p);
  }
  return hasil;
}

/**
 * Tanggal TUNGGAL — tak punya pasangan, jadi tak ada yang bisa dibatasi.
 * Kuncinya `berkas` + isi `value={…}`, supaya mengubahnya jadi rentang (yang
 * akan menambah input kedua) tetap memaksa keputusan sadar di sini.
 */
const TANGGAL_TUNGGAL: { berkas: string; value: string; catatan: string }[] = [
  { berkas: "pages/kasir/RiwayatPage.tsx", value: "tanggal", catatan: "riwayat SATU hari" },
  { berkas: "pages/pesanan/PesananPage.tsx", value: "tanggal", catatan: "papan SATU hari" },
  {
    berkas: "pages/perlengkapan/PerlengkapanPage.tsx",
    value: "mulai",
    catatan: "mulai berlaku aturan pemakaian otomatis (kosong = hari ini)",
  },
  {
    berkas: "pages/produksi/RekomendasiBeliPage.tsx",
    value: "pakaiDari",
    catatan: 'cabang pakaiMode === "tanggal" — satu tanggal, bukan rentang',
  },
  {
    berkas: "pages/produksi/TahapPage.tsx",
    value: 'p?.exp ?? ""',
    catatan: "tanggal kedaluwarsa per lot",
  },
];

interface Input {
  berkas: string;
  baris: number;
  value: string;
  dibatasi: boolean;
}

function inputTanggal(isi: string, rel: string): Input[] {
  const hasil: Input[] = [];
  for (const m of isi.matchAll(/type="date"/g)) {
    const a = isi.lastIndexOf("<input", m.index);
    const b = isi.indexOf("/>", m.index);
    if (a < 0 || b < 0) continue;
    const tag = isi.slice(a, b + 2);
    const v = /value=\{([^}]*)\}/.exec(tag);
    hasil.push({
      berkas: rel,
      baris: isi.slice(0, a).split("\n").length,
      value: v ? v[1].trim() : "?",
      dibatasi: tag.includes("min={") || tag.includes("max={"),
    });
  }
  return hasil;
}

const SEMUA = semuaTsx(akar).flatMap((p) => inputTanggal(readFileSync(p, "utf8"), p.slice(akar.length)));

describe("pemilih tanggal: rentang harus saling membatasi", () => {
  it("pemindainya menemukan input tanggal (penjaga ini tak boleh kosong)", () => {
    expect(SEMUA.length).toBeGreaterThanOrEqual(20);
  });

  it("tiap input tanggal dibatasi min/max, atau terdaftar sebagai tanggal tunggal", () => {
    const telanjang = SEMUA.filter((i) => !i.dibatasi)
      .filter(
        (i) => !TANGGAL_TUNGGAL.some((t) => t.berkas === i.berkas && t.value === i.value),
      )
      .map((i) => `${i.berkas}:${i.baris} — value={${i.value}}`);
    expect(
      telanjang,
      "pemilih rentang baru: pasang max={sampai} / min={dari}, atau daftarkan sbg tanggal tunggal",
    ).toEqual([]);
  });

  it("daftar tanggal tunggal tak boleh menyimpan entri yang sudah tak ada", () => {
    const basi = TANGGAL_TUNGGAL.filter(
      (t) => !SEMUA.some((i) => i.berkas === t.berkas && i.value === t.value),
    ).map((t) => `${t.berkas} value={${t.value}} (${t.catatan})`);
    expect(basi).toEqual([]);
  });
});
