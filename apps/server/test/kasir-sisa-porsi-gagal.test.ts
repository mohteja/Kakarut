import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga SISA PORSI DI KASIR — peringatan yang hilang karena gagal baca tak
 * boleh terbaca sebagai "semua aman".
 *
 * Seluruh peringatan stok di layar kasir berbentuk "tampil kalau ada masalah":
 *
 *   - badge `Habis` / `Sisa N` di tiap kartu & tile menu  (`StokBadge`)
 *   - garis merah "⚠ Stok habis — pesanan 3" di keranjang
 *
 * Keduanya DIAM bila `sisaByMenu` tak menemukan menunya. Itu memang benar
 * untuk menu yang tak melacak stok — tapi jadi bohong saat permintaannya
 * sendiri yang gagal, karena `ketersediaan` jatuh ke `[]` dan SETIAP menu
 * ikut tak ditemukan.
 *
 * Jadi satu permintaan gagal menghapus seluruh peringatan sekaligus, dan
 * layar kasir jadi tak terbedakan dari "semua aman" — tepat di detik pesanan
 * diterima. Bedanya dengan halaman Stok (yang mengarang "∞"): di sini
 * bohongnya lewat KESUNYIAN, dan justru karena itu tak ada yang menyadarinya.
 *
 * Yang ditambahkan hanya KETERANGAN. Ketersediaan di aplikasi ini memberi
 * tahu, tidak melarang — menambah gerbang di sini akan menghentikan penjualan
 * yang sah hanya karena satu permintaan gagal.
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/kasir/KasirPage.tsx", import.meta.url)),
  "utf8",
);

describe("galatnya diambil, bukan dibuang", () => {
  it("`/menu/ketersediaan` punya nama galatnya sendiri", () => {
    expect(HAL).toContain("const { data: ketersediaan = [], error: gagalSisa } = useQuery({");
  });

  it("sebabnya ditulis di tempatnya, bukan disimpan di kepala", () => {
    expect(HAL).toContain("tampil kalau ada masalah");
    expect(HAL).toContain("memberi tahu, tidak");
  });
});

describe("keterangan muncul, dan menyebut APA yang jadi tak tampil", () => {
  it("stripnya digerbang `gagalSisa`", () => {
    expect(HAL).toContain("{!perluPilihMeja && gagalSisa && (");
  });

  it("menyebut badge yang hilang & peringatan keranjang yang ikut hilang", () => {
    expect(HAL).toContain("Sisa porsi tidak terbaca");
    expect(HAL).toContain("tidak muncul di");
    expect(HAL).toContain("melebihi stok tidak akan tampil");
  });

  it("dan memberi tindakan, bukan cuma kabar buruk", () => {
    expect(HAL).toContain("tanyakan dapur sebelum menerima pesanan");
  });

  it("tak tampil saat mejanya belum dipilih — menunya juga belum tampil", () => {
    // Menggantung peringatan di layar "Pilih meja dulu" hanya jadi bising:
    // tak ada satu pun badge yang seharusnya muncul di sana.
    expect(HAL).toContain("!perluPilihMeja && gagalSisa");
  });
});

describe("perilaku menjual TIDAK berubah — ini keterangan, bukan gerbang", () => {
  it("`tambah` tak menumpang penjaga baru", () => {
    const i = HAL.indexOf("function tambah(");
    const blok = HAL.slice(i, i + 600);
    expect(i, "fungsi tambah tak ditemukan").toBeGreaterThan(0);
    expect(blok).not.toContain("gagalSisa");
  });

  it("tombol bayar tak ikut dikunci oleh `gagalSisa`", () => {
    expect(HAL).not.toMatch(/disabled=\{[^}]*gagalSisa/);
  });

  it("`StokBadge` tetap diam untuk menu yang MEMANG tak melacak stok", () => {
    // Kalau penjaganya sampai membuat badge muncul untuk `porsi == null`,
    // tiap menu tanpa resep berlacak stok akan tampak bermasalah.
    expect(HAL).toContain("const porsi = stok?.porsi;");
    expect(HAL).toContain("if (porsi == null) return null;");
  });

  it("peringatan keranjang tetap memakai ambang aslinya", () => {
    expect(HAL).toContain("if (sisa == null || l.qty <= sisa) return null;");
  });
});
