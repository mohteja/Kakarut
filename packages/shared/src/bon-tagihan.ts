/**
 * BON TAGIHAN — tagihan berharga yang diserahkan ke tamu SEBELUM membayar.
 *
 * Kertas ketiga di kasir, dan satu-satunya yang membawa rupiah tanpa menjadi
 * bukti pembayaran. Tamu memintanya saat selesai makan untuk memeriksa
 * pesanannya dan tahu berapa yang harus disiapkan; sesudah membayar, yang
 * diterimanya STRUK.
 *
 * Tiga kertas, tiga janji yang berbeda:
 *
 *   struk        rupiah + bukti bayar   → `receipt.ts`
 *   slip pesanan tanpa rupiah           → `order-slip.ts`
 *   BON TAGIHAN  rupiah, BUKAN bukti    → berkas ini
 *
 * KENAPA TIPENYA SENDIRI, bukan `ReceiptData` dengan `metodeBayar: null`.
 *
 * Karena kesalahan yang paling mahal di sini bukan salah angka melainkan salah
 * BACA: satu kertas berisi rupiah yang dikira tanda lunas. `BonData` karena itu
 * TIDAK PUNYA kolom `metodeBayar`, `uangDiterima`, `refundTotal`, maupun
 * `footer`. Bukan "diisi null" — memang tak ada. Siapa pun yang kelak ingin
 * mencetak "Tunai / Kembali" di sini tak punya nilai untuk dicetak, dan
 * "Terima kasih!" tak bisa muncul di kertas yang belum dibayar.
 *
 * Bentuk penjagaan yang sama dengan `OrderSlipItem` yang tak berkolom harga.
 * Disiplin bisa lupa; tipe tidak.
 *
 * TENTANG DISKON. Bill belum tahu diskonnya — potongan diputuskan saat
 * pembayaran (`createSale`), bukan saat pesanan disimpan. Jadi bon ini memang
 * angka SEBELUM diskon, dan ia mengatakannya sendiri di kaki kertas alih-alih
 * membiarkan tamu menemukan selisihnya di struk.
 */
import { EscPosBuilder } from "./escpos";
import { formatRupiahAscii, type ReceiptOptions } from "./receipt";

export interface BonItem {
  nama: string;
  qty: number;
  hargaSatuan: number;
  lineTotal: number;
  /** penanda per baris, mis. "DI"/"TA" saat sajiannya beda dari transaksinya */
  tag?: string | null;
  /** catatan personalisasi per baris (mis. "tanpa gula") */
  catatan?: string | null;
}

export interface BonData {
  companyNama: string;
  /*
   * SENGAJA tanpa alamat & telepon, tak seperti struk.
   *
   * Struk dibawa pulang dan kadang jadi rujukan; bon ini diserahkan ke tamu
   * yang sedang DUDUK di tempatnya, untuk dibaca sekali lalu ditukar uang.
   * Baris alamat di sana bukan informasi, cuma jarak antara mata dan angka
   * yang dicarinya. Ia juga satu titik menyimpang lagi antara web (yang tak
   * memuat alamat di layar kasir) dan server — dan menghapusnya menutup
   * keduanya sekaligus.
   */
  branchNama: string;
  /** waktu yang SUDAH diformat (mis. "21/08 14.30") */
  waktu: string;
  isDineIn: boolean;
  mejaLabel?: string | null;
  customerNama?: string | null;
  items: BonItem[];
  subtotal: number;
  /**
   * Potongan yang SUDAH diputuskan saat bon dicetak (Rp); 0/undefined = belum.
   *
   * Bill tersimpan tak menyimpan diskon — potongan diputuskan di layar
   * pembayaran — jadi `GET /open-bill/:id/bon` selalu mengirim 0. Yang bisa
   * mengisinya cuma layar kasir, saat kasirnya sudah terlanjur memasukkan
   * potongan lalu tamunya minta bon. Tanpa medan ini, kertasnya akan menyebut
   * angka yang LEBIH BESAR daripada yang tertera di layar kasir pada saat yang
   * sama — dan tamu yang melihat keduanya tak punya cara tahu mana yang benar.
   */
  diskon?: number;
  /** persen diskon bila mode persen (utk label "Diskon 10%"); null = nominal */
  diskonPersen?: number | null;
  pb1Amount: number;
  pb1Rate?: number | null;
  /** subtotal − diskon + pb1 */
  total: number;
  /** catatan pesanan (bukan catatan baris) */
  catatan?: string | null;
  kasir?: string | null;
}

/** Jumlah porsi pada bon — untuk memeriksa cepat tak ada baris yang tertinggal. */
export function totalPorsiBon(items: BonItem[]): number {
  return items.reduce((a, it) => a + it.qty, 0);
}

export function buildBonBytes(data: BonData, opts: ReceiptOptions): Uint8Array {
  const b = new EscPosBuilder(opts.charsPerLine);
  b.init();
  // SENGAJA tanpa `drawerKick`, dan bukan sekadar karena "belum ada uang":
  // membuka laci saat bon diminta membuat tamu mengira pembayarannya sudah
  // tercatat, dan membiarkan laci terbuka tanpa transaksi adalah selisih kas
  // yang menunggu terjadi.

  /*
   * Judulnya lebih dulu, sebelum nama warung sekalipun.
   *
   * Kertas ini beredar di meja yang sama dengan struk sungguhan dan bentuknya
   * hampir identik — rupiah, subtotal, TOTAL. Yang harus dijawabnya pada baris
   * PERTAMA adalah "ini belum dibayar", sebab sesudah mata sampai ke angka
   * TOTAL, ia sudah membacanya sebagai nota.
   */
  b.align("center").bold(true).size("tall").text("BON TAGIHAN").size("normal");
  b.text("BELUM DIBAYAR").bold(false);
  b.text(data.companyNama);
  b.text(`Cabang ${data.branchNama}`);
  b.align("left").divider();

  // TIDAK ada nomor nota dan TIDAK ada nomor antrian: keduanya lahir saat
  // penjualan tercatat, dan bon ini justru ada sebelum itu. Menampilkan nomor
  // apa pun di sini akan dibaca sebagai nomor nota.
  b.text(data.waktu);
  b.text(data.isDineIn ? "Dine-in" : "Bawa pulang");

  // Identitas: meja lebih dulu — bon diantar ke meja, bukan dipanggil namanya.
  if (data.mejaLabel) {
    b.align("center").bold(true).size("tall").text(data.mejaLabel).size("normal").bold(false).align("left");
  }
  if (data.customerNama) {
    b.align("center").bold(true).text(data.customerNama).bold(false).align("left");
  }
  b.divider();

  // Barisnya persis seperti struk — tamu membandingkan kedua kertas, dan dua
  // susunan berbeda untuk pesanan yang sama membuat perbandingannya sulit.
  for (const it of data.items) {
    b.text(it.nama);
    const qtyStr = Number.isInteger(it.qty) ? String(it.qty) : it.qty.toFixed(2);
    const tag = it.tag ? ` (${it.tag})` : "";
    b.line(`  ${qtyStr} x ${formatRupiahAscii(it.hargaSatuan)}${tag}`, formatRupiahAscii(it.lineTotal));
    if (it.catatan?.trim()) b.text(`  * ${it.catatan.trim()}`);
  }
  b.divider();

  b.line("Subtotal", formatRupiahAscii(data.subtotal));
  if (data.diskon && data.diskon > 0) {
    b.line(
      `Diskon${data.diskonPersen ? ` ${data.diskonPersen}%` : ""}`,
      formatRupiahAscii(-data.diskon),
    );
  }
  if (data.pb1Amount > 0) {
    b.line(`PB1${data.pb1Rate ? ` ${data.pb1Rate}%` : ""}`, formatRupiahAscii(data.pb1Amount));
  }
  b.bold(true).size("tall").line("TOTAL", formatRupiahAscii(data.total)).size("normal").bold(false);
  b.line("Total porsi", String(totalPorsiBon(data.items)));

  if (data.catatan?.trim()) b.divider().text(`Catatan: ${data.catatan.trim()}`);
  if (data.kasir) b.text(`Kasir: ${data.kasir}`);

  /*
   * Kaki kertas: dikatakan LAGI, sesudah angkanya.
   *
   * Pengulangan ini disengaja. Yang dibawa pulang orang dari selembar kertas
   * adalah baris terakhir yang dibacanya, dan pada struk baris itu berbunyi
   * "Terima kasih!". Bon yang berakhir tanpa penutup akan dibaca seolah
   * transaksinya selesai — jadi penutupnya justru harus mengatakan sebaliknya.
   */
  b.divider();
  b.align("center").bold(true).text("*** BELUM DIBAYAR ***").bold(false);
  b.text("Bukan bukti pembayaran");
  /*
   * Peringatan diskon HANYA saat belum ada diskonnya.
   *
   * Kalimatnya ada untuk menjelaskan kenapa angka di atas bisa MENGECIL nanti.
   * Kalau potongannya sudah tercetak beberapa baris di atas, kalimat yang sama
   * berubah arti jadi "mungkin masih ada potongan lagi" — menjanjikan sesuatu
   * yang tak akan datang, di kertas yang sedang dipakai tamu menghitung uang.
   */
  if (!data.diskon || data.diskon <= 0) {
    b.text("Diskon (bila ada) dihitung");
    b.text("saat pembayaran");
  }

  b.feed(opts.feedLines);
  if (opts.cut) b.cut();
  return b.build();
}
