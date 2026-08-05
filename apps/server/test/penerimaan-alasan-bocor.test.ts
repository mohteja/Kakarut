import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga ALASAN PENERIMAAN — teks dari keputusan yang DIBATALKAN tak boleh
 * menempel pada keputusan lain.
 *
 * `alasan` di halaman Penerimaan dipakai BERSAMA oleh dua jalur:
 *
 *   - `POST /penerimaan/:id/tolak`           → alasan penolakan seluruh kiriman
 *   - `POST /penerimaan/:id/terima-sebagian` → server menuliskannya ke
 *     `alasanTolak` baris yang qty-nya 0 (`alasanTolak: body.alasan ??
 *     "Barang tidak diterima"`)
 *
 * Dulu hanya tombol **Tolak** yang mengosongkannya saat dibuka. Jadi:
 *
 *   1. petugas membuka Tolak, mengetik "barang basah", lalu menekan Batal —
 *      `alasan` tetap terisi karena Batal hanya menutup modenya;
 *   2. ia membuka Terima Sebagian, mengisi qty, lalu simpan;
 *   3. "barang basah" tercatat sebagai `alasan_tolak` baris yang tak diterima —
 *      alasan dari keputusan yang DIBATALKAN, menempel pada keputusan lain.
 *
 * Yang membuatnya sunyi: di mode Terima Sebagian kolomnya tak pernah
 * ditampilkan, jadi tak ada yang bisa melihat teks yang ikut terkirim. Dan
 * `alasan_tolak` justru kolom yang dibaca orang saat menelusuri barang hilang.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const HAL = baca("../../web/src/pages/produksi/PenerimaanPage.tsx");
const RUTE = baca("../src/modules/penerimaan/routes.ts");

describe("premis: terima-sebagian memang menulis alasan ke baris yang ditolak", () => {
  it("baris ber-qty 0 jadi `ditolak` dengan alasan dari badan permintaan", () => {
    expect(RUTE).toContain('alasanTolak: body.alasan ?? "Barang tidak diterima",');
  });

  it("dan klien memang mengirim `alasan` pada jalur itu", () => {
    const i = HAL.indexOf("const terimaSebagian = useMutation({");
    const blok = HAL.slice(i, HAL.indexOf("const tolak = useMutation({", i));
    expect(i).toBeGreaterThan(0);
    expect(blok).toContain("alasan: alasan.trim() || null,");
  });

  it("premis kedua: `alasan` memang SATU state untuk kedua jalur", () => {
    expect(HAL).toContain('const [alasan, setAlasan] = useState("");');
  });
});

describe("membuka Terima Sebagian mengosongkan alasan", () => {
  const iBtn = HAL.indexOf("setSebagianKey(g.key);");
  const BLOK = HAL.slice(iBtn, HAL.indexOf("⚖ Terima Sebagian", iBtn));

  it("`setAlasan(\"\")` ikut dipanggil", () => {
    expect(iBtn, "tombol Terima Sebagian tak ditemukan").toBeGreaterThan(0);
    expect(BLOK).toContain('setAlasan("");');
  });

  it("bersama pembuangan draft qty yang sudah ada sebelumnya", () => {
    expect(BLOK).toContain("setQtyDraft({});");
    expect(BLOK).toContain("setTolakKey(null);");
  });

  it("dan sebabnya ditulis, bukan disimpan di kepala", () => {
    expect(HAL).toContain("Kolom itu dipakai BERSAMA oleh dua jalur");
    expect(HAL).toContain("menempel pada keputusan lain");
  });
});

describe("kolomnya ditampilkan di mode Terima Sebagian", () => {
  /** Hanya potongan cabang `modeSebagian`, bukan seluruh berkas. */
  const iSeb = HAL.indexOf(") : modeSebagian ? (");
  const BLOK = HAL.slice(iSeb, HAL.indexOf("Simpan Penerimaan", iSeb));

  it("ada input alasan yang bisa dilihat & disunting", () => {
    expect(iSeb, "cabang modeSebagian tak ditemukan").toBeGreaterThan(0);
    expect(BLOK).toContain("onChange={(e) => setAlasan(e.target.value)}");
  });

  it("placeholder-nya menyebut untuk apa — bukan alasan seluruh kiriman", () => {
    // Server hanya memakainya untuk baris ber-qty 0; menamainya "alasan
    // penolakan" seperti pada mode Tolak akan menyesatkan.
    expect(BLOK).toContain("alasan baris yang 0");
  });

  it("nilainya berasal dari state yang sama yang dikirim", () => {
    expect(BLOK).toContain("value={alasan}");
  });
});

describe("sifat yang sudah benar dan jangan sampai hilang", () => {
  it("membuka Tolak tetap mengosongkan alasan", () => {
    const i = HAL.indexOf("setTolakKey(g.key);");
    expect(HAL.slice(i, i + 120)).toContain('setAlasan("");');
  });

  it("`segarkan` mengosongkan ketiga state sesudah aksi berhasil", () => {
    expect(HAL).toContain("setSebagianKey(null);");
    expect(HAL).toContain("setTolakKey(null);");
    expect(HAL).toContain('setAlasan("");');
  });

  it("qty 0 tetap PERINTAH, bukan nilai cadangan — tanpa `|| 0`", () => {
    expect(HAL).toContain("qty_diterima: angkaDari(qtyDraft[r.id] ?? r.qty),");
    expect(HAL).not.toContain("angkaDari(qtyDraft[r.id] ?? r.qty) || 0");
  });

  it("dan qty yang tak terbaca masih menahan tombol Simpan", () => {
    expect(HAL).toContain("disabled={terimaSebagian.isPending || qtyTakTerbaca(g).length > 0}");
  });
});
