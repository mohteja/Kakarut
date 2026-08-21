/**
 * SLIP PESANAN (bon dapur) — menu & jumlah saja, TANPA HARGA.
 *
 * Kertas kedua di kasir, dipakai untuk dua hal yang sama-sama bukan bukti
 * pembayaran: lembar yang dibawa ke dapur/bar, dan lembar yang ditinggalkan di
 * meja tamu supaya mereka bisa mencocokkan pesanannya. Dicetak pada Open Bill
 * (yang memang belum dibayar) maupun pada penjualan yang langsung lunas.
 *
 * KENAPA TIPENYA SENDIRI, bukan menumpang `ReceiptData`.
 *
 * `OrderSlipItem` TIDAK PUNYA kolom harga sama sekali. Kalau slip ini dibangun
 * dari `ReceiptData`, "tanpa harga" cuma jadi pilihan saat mencetak — dan
 * pilihan bisa dibatalkan tanpa sengaja oleh siapa pun yang kelak menambahkan
 * satu baris `b.line(...)` di sini. Dengan tipe yang memang tak membawa
 * angkanya, harga tak bisa bocor ke kertas ini meski ada yang mencobanya:
 * tak ada nilai yang bisa dicetak.
 *
 * Nomor & antrian sengaja OPSIONAL: penjualan lunas punya nomor nota, Open
 * Bill belum tentu. Yang menggantikannya sebagai identitas adalah MEJA dan
 * nama tamu — dan itu memang yang dipakai orang dapur untuk mengantar.
 */
import { EscPosBuilder } from "./escpos";
import type { ReceiptOptions } from "./receipt";

export interface OrderSlipItem {
  nama: string;
  qty: number;
  /** penanda per baris, mis. "DI"/"TA" saat sajiannya beda dari transaksinya */
  tag?: string | null;
  /** catatan personalisasi per baris (mis. "tanpa gula") */
  catatan?: string | null;
}

export interface OrderSlipData {
  companyNama: string;
  branchNama: string;
  /** nomor nota bila sudah ada; Open Bill yang belum bernomor → null */
  nomor?: string | null;
  /** waktu yang SUDAH diformat (mis. "09/07 14.30") */
  waktu: string;
  isDineIn: boolean;
  mejaLabel?: string | null;
  customerNama?: string | null;
  items: OrderSlipItem[];
  /** catatan pesanan (bukan catatan baris) */
  catatan?: string | null;
  kasir?: string | null;
}

/** Jumlah porsi di slip — cacah, bukan rupiah. */
export function totalPorsi(items: OrderSlipItem[]): number {
  return items.reduce((a, it) => a + it.qty, 0);
}

/** Qty tanpa desimal palsu: 2 → "2", 1.5 → "1.5". */
function qtyTeksSlip(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(qty);
}

export function buildOrderSlipBytes(data: OrderSlipData, opts: ReceiptOptions): Uint8Array {
  const b = new EscPosBuilder(opts.charsPerLine);
  b.init();
  // SENGAJA tanpa `drawerKick`: slip ini bukan pembayaran, dan membuka laci
  // tiap kali pesanan dikirim ke dapur adalah undangan bagi selisih kas.

  // Judul lebih dulu, sebelum apa pun. Kertas ini beredar di dapur dan di meja
  // tamu berdampingan dengan struk sungguhan; yang pertama harus dijawab
  // olehnya adalah "ini bukan bukti bayar".
  b.align("center").bold(true).size("tall").text("PESANAN").size("normal");
  b.text(data.companyNama).bold(false);
  b.text(`Cabang ${data.branchNama}`);
  b.align("left").divider();

  if (data.nomor) b.line(data.nomor, data.waktu);
  else b.line("", data.waktu);
  b.text(data.isDineIn ? "Dine-in" : "Bawa pulang");

  // Nomor antrian: dari empat digit terakhir nomor nota, sama seperti struk.
  const antrian = data.nomor ? Number(data.nomor.slice(-4)) : NaN;
  if (Number.isFinite(antrian) && antrian > 0) {
    b.align("center")
      .bold(true)
      .size("tall")
      .text(`Antrian ${antrian}`)
      .size("normal")
      .bold(false)
      .align("left");
  }

  // Identitas antar: meja lebih dulu — itu yang dipakai mengantarkan makanan.
  // (Pada struk urutannya kebalikannya, sebab di sana yang dicari nama tamu.)
  if (data.mejaLabel) {
    b.align("center").bold(true).size("tall").text(data.mejaLabel).size("normal").bold(false).align("left");
  }
  if (data.customerNama) {
    b.align("center").bold(true).text(data.customerNama).bold(false).align("left");
  }
  b.divider();

  /*
   * Barisnya: "2x Nasi Goreng" — jumlah DI DEPAN, tanpa kolom kanan.
   *
   * Struk menaruh angka di kanan karena di sana yang disejajarkan rupiah. Di
   * sini tak ada kolom kanan sama sekali, jadi jumlahnya dibawa ke depan di
   * mana mata membacanya lebih dulu — yang dicari orang dapur "berapa", bukan
   * "apa".
   */
  for (const it of data.items) {
    const tag = it.tag ? ` (${it.tag})` : "";
    b.bold(true).text(`${qtyTeksSlip(it.qty)}x ${it.nama}${tag}`).bold(false);
    if (it.catatan?.trim()) b.text(`   * ${it.catatan.trim()}`);
  }
  b.divider();

  // Cacah porsi — angka, tapi bukan uang. Berguna untuk memeriksa cepat bahwa
  // tak ada baris yang tertinggal saat slipnya sobek atau tercetak separuh.
  b.line("Total porsi", String(totalPorsi(data.items)));

  if (data.catatan?.trim()) b.divider().text(`Catatan: ${data.catatan.trim()}`);
  if (data.kasir) b.text(`Kasir: ${data.kasir}`);

  b.feed(opts.feedLines);
  if (opts.cut) b.cut();
  return b.build();
}
