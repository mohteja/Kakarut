import { describe, expect, it } from "vitest";
import { angkaAtauNull, angkaDari, teksAngka } from "@kakarut/shared";

/**
 * Membaca angka yang diketik orang, dalam format yang aplikasi ini SENDIRI
 * tampilkan (`Intl.NumberFormat("id-ID")`).
 *
 * Yang dikunci di sini bukan sekadar "koma jadi titik", melainkan dua arah
 * yang sama-sama pernah salah:
 *   - `Number("1,5")`   → NaN  (ditolak, lalu bocor jadi "NaN" di layar)
 *   - `Number("1.500")` → 1.5  (DITERIMA diam-diam, salah 1000×)
 * Yang kedua yang berbahaya: tak ada satu pun tanda bahwa angkanya berubah.
 */
describe("angkaDari: baca angka gaya id-ID", () => {
  it("koma = pemisah desimal (yang dicetak layar untuk 1,5)", () => {
    expect(angkaDari("1,5")).toBe(1.5);
    expect(angkaDari("0,25")).toBe(0.25);
    expect(angkaDari("470,75")).toBe(470.75);
  });

  it("titik + TEPAT tiga angka = ribuan (yang dicetak layar untuk 1.500)", () => {
    expect(angkaDari("1.500")).toBe(1500);
    expect(angkaDari("12.000")).toBe(12000);
    expect(angkaDari("1.500.000")).toBe(1500000);
  });

  it("titik desimal gaya mesin tetap terbaca", () => {
    expect(angkaDari("1.5")).toBe(1.5);
    expect(angkaDari("12.75")).toBe(12.75);
    expect(angkaDari("0.25")).toBe(0.25);
  });

  it("dua pemisah: yang TERAKHIR muncul adalah desimalnya", () => {
    expect(angkaDari("1.500,75")).toBe(1500.75); // id-ID
    expect(angkaDari("1,500.75")).toBe(1500.75); // en-US
    expect(angkaDari("1.234.567,89")).toBe(1234567.89);
  });

  it("bilangan bulat biasa dan negatif", () => {
    expect(angkaDari("470")).toBe(470);
    expect(angkaDari("0")).toBe(0);
    expect(angkaDari("-9000")).toBe(-9000);
    expect(angkaDari("-1.500,5")).toBe(-1500.5);
  });

  it("spasi di tepi (dan di tengah, dari tempel-salin) diabaikan", () => {
    expect(angkaDari("  1,5  ")).toBe(1.5);
    expect(angkaDari("1 500")).toBe(1500);
  });

  it("angka yang sudah berupa number diteruskan apa adanya", () => {
    expect(angkaDari(1.5)).toBe(1.5);
    expect(angkaDari(0)).toBe(0);
  });

  it("yang tak terbaca → NaN, BUKAN 0", () => {
    // 0 adalah angka stok yang sah dan bermakna. Menjadikannya nilai
    // kegagalan membuat salah ketik tak bisa dibedakan dari "memang nol" —
    // dan di opname, "memang nol" berarti barangnya habis.
    for (const buruk of ["", "   ", "abc", "12abc", "1,5,5", null, undefined]) {
      expect(angkaDari(buruk as string)).toBeNaN();
    }
    expect(angkaDari("0")).toBe(0); // pembanding: nol sah
  });

  it("angkaAtauNull memulangkan null, enak untuk badan JSON", () => {
    // `JSON.stringify({q: NaN})` diam-diam jadi `{"q":null}`; dibuat eksplisit
    // supaya pemanggil memutuskan sadar, bukan kecelakaan serialisasi.
    expect(angkaAtauNull("1,5")).toBe(1.5);
    expect(angkaAtauNull("abc")).toBeNull();
    expect(angkaAtauNull("")).toBeNull();
    expect(angkaAtauNull("0")).toBe(0);
  });

  it("bolak-balik dengan yang DICETAK layar (id-ID) selalu utuh", () => {
    const cetak = (n: number) =>
      new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);
    for (const n of [0, 1.5, 470, 1500, 12000, 1500000, 0.25, 1234567.89]) {
      expect(angkaDari(cetak(n))).toBe(n);
    }
  });

  it("teksAngka → angkaDari bolak-balik utuh, termasuk yang String() rusakkan", () => {
    /**
     * Yang MENGISI kotak isian harus satu pintu dengan yang membacanya.
     * `String()` bukan pintu itu: aturan "satu titik + tepat tiga angka =
     * ribuan" — benar untuk ketikan orang — memakan justru keluaran `String()`.
     *
     * Tiga baris pertama adalah kasus yang benar-benar rusak sebelum ada
     * `teksAngka`; sisanya jaring pengaman supaya perbaikannya tak menggeser
     * yang tadinya sudah benar.
     */
    for (const n of [0.125, 1.375, 0.001, 0.625, 2.5, 0.5, 1500, 12.75, 0, 1500000, 470]) {
      expect(angkaDari(teksAngka(n)), `bolak-balik ${n}`).toBe(n);
    }
    // Bentuk id-ID, bukan gaya mesin — inilah yang dibaca mata pemakainya.
    expect(teksAngka(0.125)).toBe("0,125");
    expect(teksAngka(1500)).toBe("1500");
    // Kosong = belum diisi; NaN/null tak pernah bocor jadi teks "NaN".
    expect(teksAngka(null)).toBe("");
    expect(teksAngka(undefined)).toBe("");
    expect(teksAngka(NaN)).toBe("");
  });

  it("harga yang DITEMPEL (ber-Rp) terbaca, bukan jadi nol", () => {
    /**
     * Harga jarang diketik ulang — ia ditempel, dari daftar harga WhatsApp
     * supplier atau dari spreadsheet, lengkap dengan bajunya. Diukur di
     * Chromium: kotak `type="text"` menyimpan tempelan APA ADANYA, jadi
     * "Rp 15.000" sungguh-sungguh sampai ke pengurai.
     *
     * Dulu semuanya NaN, dan hampir semua pemanggil menulis `angkaDari(x) || 0`
     * — jadi harga yang ditempel tersimpan NOL. Bukan ditolak: nol.
     */
    expect(angkaDari("Rp 15.000")).toBe(15000);
    expect(angkaDari("Rp15000")).toBe(15000);
    expect(angkaDari("rp 12.500")).toBe(12500);
    expect(angkaDari("12.500,-")).toBe(12500);
    expect(angkaDari("Rp 1.500.000")).toBe(1500000);
    expect(angkaDari("Rp2,5")).toBe(2.5);
  });

  it("kelonggaran itu TIDAK boleh mematikan penanda salah ketik", () => {
    /**
     * `OpnamePage` dan `StokAwalPage` menandai salah ketik lewat
     * `Number.isNaN(angkaDari(…))`. Pengurai CSV di repo ini jauh lebih longgar
     * — ia membuang SEMUA yang bukan angka, jadi "12abc" jadi 12 — dan menyalin
     * kelonggaran itu ke sini akan mematikan kedua penanda tanpa suara.
     *
     * Karena itu yang dibuang cuma imbuhan rupiah, bukan sembarang huruf.
     */
    for (const salah of ["12abc", "abc", "Rp", "Rpabc", "-", "1,5,5"]) {
      expect(angkaDari(salah), salah).toBeNaN();
    }
  });
});
