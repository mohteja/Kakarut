import { describe, expect, it } from "vitest";
import {
  buildBonBytes,
  buildReceiptBytes,
  totalPorsiBon,
  type BonData,
  type ReceiptOptions,
} from "@kakarut/shared";

/**
 * BON TAGIHAN — rupiah, tapi BUKAN bukti pembayaran.
 *
 * Kertas ketiga di kasir, dan satu-satunya yang membawa angka uang tanpa
 * menyatakan transaksinya selesai. Tamu memintanya sebelum membayar.
 *
 * Kesalahan yang paling mahal di sini bukan salah angka melainkan salah BACA:
 * selembar kertas berisi "TOTAL Rp165.000" yang dikira tanda lunas. Bentuknya
 * hampir identik dengan struk — itu memang disengaja, supaya tamu bisa
 * membandingkan keduanya — jadi yang memisahkan keduanya harus kata-katanya,
 * dan kata-kata itu harus ADA DI DUA TEMPAT: sebelum angkanya dibaca, dan
 * sesudahnya.
 *
 * Janji itu ditegakkan STRUKTURAL, bukan dengan disiplin: `BonData` tak punya
 * kolom `metodeBayar`, `uangDiterima`, `refundTotal`, maupun `footer` sama
 * sekali. Bukan "diisi null" — memang tak ada. Siapa pun yang kelak ingin
 * mencetak "Tunai / Kembali" di sini tak punya nilai untuk dicetak.
 *
 * Tiap asersi INTI di bawah berpasangan dengan asersi yang membuktikan STRUK
 * SUNGGUHAN masih memuat bagian itu. Tanpa pasangannya, "bon tak menyebut
 * kembalian" juga hijau seandainya pembangun struk ikut berhenti mencetaknya —
 * yaitu kerusakan, bukan keberhasilan.
 */
const OPTS: ReceiptOptions = { charsPerLine: 32, cut: true, drawerKick: true, feedLines: 3 };
const teks = (b: Uint8Array) => new TextDecoder().decode(b);

const DASAR: BonData = {
  companyNama: "Warung Uji",
  branchNama: "Pusat",
  waktu: "21/08 14.30",
  isDineIn: true,
  mejaLabel: "Meja 3",
  customerNama: "Budi",
  items: [
    { nama: "Nasi Goreng", qty: 2, hargaSatuan: 15000, lineTotal: 30000, catatan: "tanpa cabai" },
    { nama: "Es Teh", qty: 1, hargaSatuan: 5000, lineTotal: 5000, tag: "TA" },
  ],
  subtotal: 35000,
  pb1Amount: 3500,
  pb1Rate: 10,
  total: 38500,
  kasir: "Sari",
};

/** Struk lunas dengan isi setara — pasangan pembanding untuk tiap asersi INTI. */
const struk = () =>
  teks(
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
        metodeBayar: "tunai",
        uangDiterima: 50000,
      },
      OPTS,
    ),
  );

describe("bon tagihan tak pernah menyatakan sudah dibayar", () => {
  it("INTI: 'BELUM DIBAYAR' muncul DUA kali — sebelum angka dan sesudahnya", () => {
    /*
     * Dua kali, dan itu bukan kelalaian. Yang dibawa pulang orang dari selembar
     * kertas adalah baris terakhir yang dibacanya; pada struk baris itu berbunyi
     * "Terima kasih!". Bon yang hanya memperingatkan di kepala akan berakhir
     * tanpa penutup dan dibaca seolah transaksinya selesai.
     */
    const t = teks(buildBonBytes(DASAR, OPTS));
    expect(t.split("BELUM DIBAYAR")).toHaveLength(3);
    expect(t).toContain("Bukan bukti pembayaran");
    // …dan judulnya sendiri menyebut dirinya bon, bukan nota.
    expect(t).toContain("BON TAGIHAN");
  });

  it("INTI: tak ada baris pembayaran sama sekali", () => {
    const t = teks(buildBonBytes(DASAR, OPTS));
    for (const kata of ["Metode", "Tunai", "QRIS", "Transfer", "Kembali", "Terima kasih"]) {
      expect(t, `bon memuat baris pembayaran "${kata}"`).not.toContain(kata);
    }
  });

  it("PASANGAN: struk SUNGGUHAN memang memuat semua baris itu", () => {
    // Tanpa ini, asersi di atas juga hijau seandainya pembangun struk ikut
    // berhenti mencetak metode & kembalian.
    const s = struk();
    expect(s).toContain("Metode");
    expect(s).toContain("Tunai");
    expect(s).toContain("Kembali");
    expect(s).toContain("Terima kasih");
  });

  it("INTI: tak ada nomor nota maupun nomor antrian", () => {
    // Keduanya lahir saat penjualan tercatat — bon ini justru ada sebelum itu.
    // Nomor apa pun di sini akan dibaca sebagai nomor nota.
    const t = teks(buildBonBytes(DASAR, OPTS));
    expect(t).not.toContain("Antrian");
    expect(t).not.toContain("NaN");
  });

  it("PASANGAN: struk memang bernomor dan berantrian", () => {
    const s = struk();
    expect(s).toContain("PUSAT-20260821-0012");
    expect(s).toContain("Antrian 12");
  });

  it("INTI: laci TIDAK dibuka, meski opsinya menyalakannya", () => {
    /*
     * `drawerKick: true` sengaja dipasang di OPTS: yang membuktikan bukan
     * opsinya melainkan bahwa pembangunnya mengabaikannya. Membuka laci saat
     * bon diminta membuat tamu mengira pembayarannya sudah tercatat.
     */
    const adaKick = (b: Uint8Array) =>
      b.some((_, i) => b[i] === 0x1b && b[i + 1] === 0x70 && b[i + 2] === 0x00);
    const bon = buildBonBytes(DASAR, OPTS);
    const s = buildReceiptBytes(
      {
        companyNama: "W", showAlamat: false, branchNama: "P", nomor: "X-0001",
        waktu: "-", isDineIn: true, items: [], subtotal: 0, pb1Amount: 0, total: 0,
      },
      OPTS,
    );
    expect(adaKick(s), "premis: struk memang membuka laci").toBe(true);
    expect(adaKick(bon), "bon tagihan tak boleh membuka laci").toBe(false);
  });
});

describe("bon memuat angka yang dibutuhkan tamu", () => {
  it("rupiah per baris ADA — ini memang kertas berharga", () => {
    /*
     * Pasangan terbalik dari `slip-pesanan-tanpa-harga`: di sana yang dijaga
     * adalah TIADANYA rupiah. Bon yang kehilangan angkanya tak berguna sama
     * sekali, jadi keberadaannya ikut dipaku.
     */
    const t = teks(buildBonBytes(DASAR, OPTS));
    expect(t).toContain("Nasi Goreng");
    expect(t).toContain("2 x Rp15.000");
    expect(t).toContain("Rp30.000");
    expect(t).toContain("Subtotal");
    expect(t).toContain("TOTAL");
    expect(t).toContain("Rp38.500");
  });

  it("PB1 tercetak dengan tarifnya, dan tak muncul saat nol", () => {
    expect(teks(buildBonBytes(DASAR, OPTS))).toContain("PB1 10%");
    const tanpa = teks(buildBonBytes({ ...DASAR, pb1Amount: 0, pb1Rate: null, total: 35000 }, OPTS));
    expect(tanpa).not.toContain("PB1");
  });

  it("menyebutkan bahwa diskon belum dihitung", () => {
    // Bill belum tahu diskonnya — potongan diputuskan saat pembayaran. Tanpa
    // kalimat ini, tamu menemukan selisihnya sendiri di struk.
    expect(teks(buildBonBytes(DASAR, OPTS))).toContain("Diskon (bila ada) dihitung");
  });

  it("…tapi kalimat itu HILANG begitu diskonnya sudah ada", () => {
    /*
     * Kalimatnya menjelaskan kenapa angka di atas bisa MENGECIL nanti. Dengan
     * potongan yang sudah tercetak, kalimat yang sama berubah arti jadi
     * "mungkin masih ada potongan lagi" — menjanjikan sesuatu yang tak akan
     * datang, di kertas yang sedang dipakai tamu menghitung uang.
     */
    const t = teks(
      buildBonBytes(
        { ...DASAR, diskon: 5000, diskonPersen: null, total: 33500 },
        OPTS,
      ),
    );
    expect(t).toContain("Diskon");
    expect(t).toContain("-Rp5.000");
    expect(t).not.toContain("Diskon (bila ada) dihitung");
    // …dan peringatan utamanya TETAP ada — yang gugur cuma kalimat diskonnya.
    expect(t.split("BELUM DIBAYAR")).toHaveLength(3);
    expect(t).toContain("Bukan bukti pembayaran");
  });

  it("diskon persen mencetak persennya di label", () => {
    expect(
      teks(buildBonBytes({ ...DASAR, diskon: 3500, diskonPersen: 10, total: 35000 }, OPTS)),
    ).toContain("Diskon 10%");
  });

  it("meja & nama tamu tercetak — bon diantar ke meja", () => {
    const t = teks(buildBonBytes(DASAR, OPTS));
    expect(t).toContain("Meja 3");
    expect(t).toContain("Budi");
  });

  it("catatan baris & penanda sajian ikut", () => {
    const t = teks(buildBonBytes(DASAR, OPTS));
    expect(t).toContain("tanpa cabai");
    expect(t).toContain("(TA)");
  });

  it("bon tanpa meja & tanpa tamu tetap tercetak utuh", () => {
    const t = teks(
      buildBonBytes({ ...DASAR, mejaLabel: null, customerNama: null }, OPTS),
    );
    expect(t).toContain("BON TAGIHAN");
    expect(t).toContain("TOTAL");
    expect(t).not.toContain("null");
  });
});

describe("totalPorsiBon: cacah, bukan rupiah", () => {
  it("menjumlahkan qty tiap baris", () => {
    expect(totalPorsiBon(DASAR.items)).toBe(3);
  });

  it("kosong → 0, bukan NaN", () => {
    expect(totalPorsiBon([])).toBe(0);
  });
});
