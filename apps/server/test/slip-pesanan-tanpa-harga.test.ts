import { describe, expect, it } from "vitest";
import {
  buildOrderSlipBytes,
  buildReceiptBytes,
  totalPorsi,
  type OrderSlipData,
  type ReceiptOptions,
} from "@kakarut/shared";

/**
 * SLIP PESANAN — menu & jumlah saja, TANPA HARGA.
 *
 * Kertas kedua di kasir: lembar yang dibawa ke dapur/bar, dan lembar yang
 * ditinggalkan di meja tamu. Dicetak pada Open Bill (yang memang belum dibayar)
 * maupun pada penjualan yang langsung lunas.
 *
 * Yang dijaga di sini SATU JANJI, dan ia dibuktikan dua arah: apa pun isinya,
 * tak ada rupiah yang sampai ke kertas ini — DAN struk sungguhan tetap memuat
 * rupiahnya. Tanpa pasangan kedua, "tak ada harga" juga hijau seandainya
 * pembangun struknya ikut rusak.
 *
 * Janji itu ditegakkan STRUKTURAL, bukan dengan disiplin: `OrderSlipItem` tak
 * punya kolom harga sama sekali. Kalau slip ini dibangun dari `ReceiptData`,
 * "tanpa harga" cuma pilihan saat mencetak — dan pilihan bisa dibatalkan tanpa
 * sengaja oleh siapa pun yang menambahkan satu baris di pembangunnya. Dengan
 * tipe yang memang tak membawa angkanya, tak ada nilai yang bisa dicetak.
 */
const OPTS: ReceiptOptions = { charsPerLine: 32, cut: true, drawerKick: true, feedLines: 3 };

const teks = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const DASAR: OrderSlipData = {
  companyNama: "Warung Uji",
  branchNama: "Pusat",
  nomor: "PUSAT-20260821-0012",
  waktu: "21/08 14.30",
  isDineIn: true,
  mejaLabel: "Meja 3",
  customerNama: "Budi",
  items: [
    { nama: "Nasi Goreng", qty: 2, catatan: "tanpa cabai" },
    { nama: "Es Teh", qty: 1, tag: "TA" },
  ],
  kasir: "Sari",
};

describe("slip pesanan tak pernah memuat rupiah", () => {
  it("INTI: tak ada 'Rp' di seluruh keluarannya", () => {
    expect(teks(buildOrderSlipBytes(DASAR, OPTS))).not.toContain("Rp");
  });

  it("INTI: tak ada baris total uang", () => {
    const t = teks(buildOrderSlipBytes(DASAR, OPTS));
    for (const kata of ["Subtotal", "TOTAL", "PB1", "Diskon", "Kembali", "Tunai", "Metode"]) {
      expect(t, `slip memuat baris uang "${kata}"`).not.toContain(kata);
    }
  });

  it("INTI: harga yang diselundupkan lewat NAMA MENU pun tak menambah baris uang", () => {
    /*
     * Nama menu ditulis pemiliknya sendiri dan bisa memuat apa saja — termasuk
     * "Paket Rp25.000". Yang dijanjikan slip ini bukan "tak ada karakter Rp di
     * dunia", melainkan bahwa SLIPNYA tidak menghitung dan tidak mencetak
     * harga. Nama tetap dicetak apa adanya; yang diperiksa: tak ada baris uang
     * yang lahir karenanya.
     */
    const t = teks(
      buildOrderSlipBytes(
        { ...DASAR, items: [{ nama: "Paket Rp25.000", qty: 1 }] },
        OPTS,
      ),
    );
    expect(t).toContain("Paket Rp25.000"); // nama menu utuh
    expect(t).not.toContain("Subtotal");
    expect(t).not.toContain("TOTAL");
    // …dan "Rp" yang muncul HANYA yang berasal dari namanya sendiri.
    expect(t.split("Rp")).toHaveLength(2);
  });

  it("PASANGAN: struk SUNGGUHAN tetap memuat rupiahnya", () => {
    // Tanpa ini, seluruh asersi di atas juga hijau seandainya pembangun struk
    // ikut berhenti mencetak harga — yaitu kerusakan, bukan keberhasilan.
    const struk = teks(
      buildReceiptBytes(
        {
          companyNama: "Warung Uji",
          showAlamat: false,
          branchNama: "Pusat",
          nomor: "PUSAT-20260821-0012",
          waktu: "21/08 14.30",
          isDineIn: true,
          items: [{ nama: "Nasi Goreng", qty: 2, hargaSatuan: 15000, lineTotal: 30000 }],
          subtotal: 30000,
          pb1Amount: 0,
          total: 30000,
        },
        OPTS,
      ),
    );
    expect(struk).toContain("Rp");
    expect(struk).toContain("TOTAL");
  });
});

describe("slip memuat apa yang dibutuhkan dapur", () => {
  it("jumlah ada DI DEPAN nama menunya", () => {
    // Yang dicari orang dapur "berapa", bukan "apa" — dan di slip ini tak ada
    // kolom kanan tempat angka bisa disejajarkan.
    expect(teks(buildOrderSlipBytes(DASAR, OPTS))).toContain("2x Nasi Goreng");
  });

  it("catatan per baris ikut tercetak", () => {
    expect(teks(buildOrderSlipBytes(DASAR, OPTS))).toContain("tanpa cabai");
  });

  it("penanda sajian (DI/TA) ikut, sebab ia mengubah cara menyajikan", () => {
    expect(teks(buildOrderSlipBytes(DASAR, OPTS))).toContain("Es Teh (TA)");
  });

  it("meja & nama tamu tercetak — itu identitas antarnya", () => {
    const t = teks(buildOrderSlipBytes(DASAR, OPTS));
    expect(t).toContain("Meja 3");
    expect(t).toContain("Budi");
  });

  it("judulnya menyatakan ini BUKAN bukti bayar", () => {
    expect(teks(buildOrderSlipBytes(DASAR, OPTS))).toContain("PESANAN");
  });

  it("Open Bill tanpa nomor tetap tercetak, tanpa 'Antrian NaN'", () => {
    // Open bill belum tentu bernomor; yang menggantikannya sebagai identitas
    // adalah mejanya.
    const t = teks(buildOrderSlipBytes({ ...DASAR, nomor: null }, OPTS));
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("Antrian");
    expect(t).toContain("Meja 3");
    expect(t).toContain("2x Nasi Goreng");
  });

  it("antrian diambil dari empat digit terakhir nomor nota", () => {
    expect(teks(buildOrderSlipBytes(DASAR, OPTS))).toContain("Antrian 12");
  });

  it("laci TIDAK dibuka — slip ini bukan pembayaran", () => {
    // `drawerKick: true` di opsi sengaja dipasang: yang membuktikan bukan
    // opsinya, melainkan bahwa pembangunnya mengabaikannya.
    const slip = buildOrderSlipBytes(DASAR, OPTS);
    const struk = buildReceiptBytes(
      {
        companyNama: "W", showAlamat: false, branchNama: "P", nomor: "X-0001",
        waktu: "-", isDineIn: true, items: [], subtotal: 0, pb1Amount: 0, total: 0,
      },
      OPTS,
    );
    // ESC p 0 — perintah buka laci (0x1B 0x70 0x00)
    const adaKick = (b: Uint8Array) =>
      b.some((_, i) => b[i] === 0x1b && b[i + 1] === 0x70 && b[i + 2] === 0x00);
    expect(adaKick(struk), "premis: struk memang membuka laci").toBe(true);
    expect(adaKick(slip), "slip pesanan tak boleh membuka laci").toBe(false);
  });
});

describe("totalPorsi: cacah, bukan rupiah", () => {
  it("menjumlahkan qty tiap baris", () => {
    expect(totalPorsi([{ nama: "a", qty: 2 }, { nama: "b", qty: 3 }])).toBe(5);
  });

  it("pesanan kosong → 0, bukan NaN", () => {
    expect(totalPorsi([])).toBe(0);
  });

  it("qty pecahan ikut terjumlah apa adanya", () => {
    expect(totalPorsi([{ nama: "a", qty: 1.5 }, { nama: "b", qty: 0.5 }])).toBe(2);
  });
});
