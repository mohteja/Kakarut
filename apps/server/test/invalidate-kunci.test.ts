import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga KUNCI INVALIDASI: yang disegarkan harus benar-benar ADA.
 *
 * `invalidateQueries({ queryKey: ["x"] })` mencocokkan AWALAN, dan
 * perbandingannya per-elemen secara UTUH — `["stok"]` TIDAK pernah cocok
 * dengan `["stok-exp"]` maupun `["stok-fifo"]`, sama seperti `["kartu"]` tak
 * pernah cocok dengan `["kartu-stok"]`.
 *
 * Bentuk kegagalannya diam total: barisnya ada, terbaca benar sekilas, dan
 * tidak menyegarkan apa pun. `StokAwalPage` memanggil `["kartu"]` — tak ada
 * satu pun query dengan kunci itu — jadi kartu stok tetap basi sesudah stok
 * awal ditetapkan, sejak baris itu ditulis.
 *
 * Repo ini sudah dua kali tersandung hal yang sama dan mencatatnya: pasangan
 * perlengkapan di `OpnameRiwayatPage` menuliskan alasannya untuk
 * `perlengkapan-master`, dan `CatatWasteModal` menyebut `stok-exp` satu per
 * satu. Catatan itu tak menghentikan kejadian ketiga — karena catatan bukan
 * penjaga.
 *
 * Yang dipatok: setiap kunci yang di-invalidate harus dipakai oleh setidaknya
 * satu `queryKey` di suatu tempat. Ini TIDAK menjamin cakupannya lengkap —
 * hanya bahwa tak ada baris yang mati sia-sia.
 */
const akar = fileURLToPath(new URL("../../web/src/", import.meta.url));

function semuaTsx(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTsx(p + "/"));
    else if (nama.endsWith(".tsx") || nama.endsWith(".ts")) hasil.push(p);
  }
  return hasil;
}

const BERKAS = semuaTsx(akar);
const isi = BERKAS.map((p) => readFileSync(p, "utf8"));

/**
 * Kunci yang dibangun dari VARIABEL, jadi tak terlihat oleh pemindai literal
 * di bawah. Dicatat manual — dan wajib, karena tanpa ini penjaga ini menuduh
 * lima invalidasi yang sebenarnya BENAR.
 *
 * Saya menemukannya justru dengan cara yang salah: versi pertama penjaga ini
 * melaporkan `["/produksi"]` sebagai kunci mati di lima tempat. Kalau saya
 * percaya begitu saja, "perbaikannya" akan merusak penyegaran daftar Produksi
 * & Pembelian yang selama ini bekerja.
 */
const DIPAKAI_VARIABEL = [
  "/produksi", // TambahStokPage: queryKey: [t.endpoint, …]
  "/pembelian", // idem
  "kategori-bahan", // KategoriManagerModal: queryKey={…} → queryKey: [queryKey]
  "kategori", // idem
  "bahan-supplier", // SupplierBahanModal: queryKey: [cacheKey, …]
  "admin-error-log", // ErrorLogPage: const kunci = ["admin-error-log", …] → queryKey: kunci
];

/** Elemen pertama tiap `queryKey: ["…"]` yang benar-benar dipakai query. */
const DIPAKAI = new Set<string>(DIPAKAI_VARIABEL);
for (const s of isi) {
  /**
   * Panggilan `invalidateQueries` DIBUANG lebih dulu.
   *
   * `invalidateQueries({ queryKey: ["kartu"] })` juga mengandung teks
   * `queryKey: ["kartu"`, jadi tanpa langkah ini invalidasi yang MATI
   * memasukkan kuncinya sendiri ke daftar "dipakai" dan membenarkan dirinya
   * sendiri. Versi pertama penjaga ini begitu, dan saya baru melihatnya karena
   * cacat aslinya ditanam ulang satu per satu: bentuk perulangan berkedip,
   * bentuk objek TIDAK. Satu injeksi saja akan meloloskannya.
   */
  const tanpaInvalidate = s.replace(/invalidateQueries\([\s\S]{0,120}?\)\s*;/g, "");
  for (const m of tanpaInvalidate.matchAll(/queryKey:\s*\[\s*"([^"]+)"/g)) DIPAKAI.add(m[1]);
}

describe("invalidateQueries: kuncinya harus ada yang memakai", () => {
  it("daftar kunci terbaca (penjaga ini tak boleh kosong)", () => {
    expect(DIPAKAI.size).toBeGreaterThan(20);
  });

  it("tak ada invalidasi ke kunci yang tak dipakai query mana pun", () => {
    const mati: string[] = [];
    for (let i = 0; i < BERKAS.length; i++) {
      const s = isi[i];
      // Bentuk objek: invalidateQueries({ queryKey: ["x"…] })
      for (const m of s.matchAll(/invalidateQueries\(\{\s*queryKey:\s*\[\s*"([^"]+)"/g)) {
        if (!DIPAKAI.has(m[1])) {
          const baris = s.slice(0, m.index).split("\n").length;
          mati.push(`${BERKAS[i].slice(akar.length)}:${baris} — ["${m[1]}"]`);
        }
      }
      // Bentuk perulangan: for (const k of ["a","b"]) … queryKey: [k]
      for (const m of s.matchAll(/for\s*\(const \w+ of \[([^\]]+)\][\s\S]{0,200}?invalidateQueries/g)) {
        for (const q of m[1].matchAll(/"([^"]+)"/g)) {
          if (!DIPAKAI.has(q[1])) {
            const baris = s.slice(0, m.index).split("\n").length;
            mati.push(`${BERKAS[i].slice(akar.length)}:${baris} — ["${q[1]}"] (perulangan)`);
          }
        }
      }
    }
    expect(mati).toEqual([]);
  });
});
