/**
 * Layout struk thermal (ESC/POS) — dipakai tombol "Cetak Thermal",
 * auto-print setelah pembayaran, dan Cetak Tes di pengaturan printer.
 */
import { EscPosBuilder } from "./escpos";

export interface ReceiptItem {
  nama: string;
  qty: number;
  hargaSatuan: number;
  lineTotal: number;
  /** penanda per baris, mis. "DI" saat item dine-in di transaksi bawa pulang */
  tag?: string | null;
}

export interface ReceiptData {
  companyNama: string;
  alamat?: string | null;
  telepon?: string | null;
  /** tampilkan alamat & telepon di header struk */
  showAlamat: boolean;
  branchNama: string;
  nomor: string;
  /** waktu yang SUDAH diformat (mis. "09/07 14.30") */
  waktu: string;
  isDineIn: boolean;
  items: ReceiptItem[];
  subtotal: number;
  pb1Amount: number;
  pb1Rate?: number | null;
  total: number;
  catatan?: string | null;
  /** teks footer dari pengaturan perusahaan */
  footer?: string | null;
}

export interface ReceiptOptions {
  charsPerLine: number;
  cut: boolean;
  drawerKick: boolean;
  feedLines: number;
}

/**
 * Format rupiah ASCII murni ("Rp34.000"). Jangan pakai Intl "id-ID" untuk
 * struk thermal — hasilnya mengandung no-break space (0xA0).
 */
export function formatRupiahAscii(n: number): string {
  const v = Math.round(Math.abs(n));
  const sign = n < 0 ? "-" : "";
  return `${sign}Rp${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function buildReceiptBytes(data: ReceiptData, opts: ReceiptOptions): Uint8Array {
  const b = new EscPosBuilder(opts.charsPerLine);
  b.init();
  if (opts.drawerKick) b.drawerKick();

  // Header
  b.align("center").bold(true).size("tall").text(data.companyNama).size("normal").bold(false);
  if (data.showAlamat) {
    if (data.alamat) b.text(data.alamat);
    if (data.telepon) b.text(`Telp: ${data.telepon}`);
  }
  b.text(`Cabang ${data.branchNama}`);
  b.align("left").divider();
  b.line(data.nomor, data.waktu);
  b.text(data.isDineIn ? "Dine-in" : "Bawa pulang");
  b.divider();

  // Item
  for (const it of data.items) {
    b.text(it.nama);
    const qtyStr = Number.isInteger(it.qty) ? String(it.qty) : it.qty.toFixed(2);
    const tag = it.tag ? ` (${it.tag})` : "";
    b.line(`  ${qtyStr} x ${formatRupiahAscii(it.hargaSatuan)}${tag}`, formatRupiahAscii(it.lineTotal));
  }
  b.divider();

  // Total
  b.line("Subtotal", formatRupiahAscii(data.subtotal));
  if (data.pb1Amount > 0) {
    b.line(`PB1${data.pb1Rate ? ` ${data.pb1Rate}%` : ""}`, formatRupiahAscii(data.pb1Amount));
  }
  b.bold(true).size("tall").line("TOTAL", formatRupiahAscii(data.total)).size("normal").bold(false);

  if (data.catatan) {
    b.divider().text(`Catatan: ${data.catatan}`);
  }

  // Footer
  b.align("center").text(data.footer?.trim() ? data.footer : "Terima kasih!");

  b.feed(opts.feedLines);
  if (opts.cut) b.cut();
  return b.build();
}

/** Halaman tes: penggaris kolom + contoh gaya, untuk cek lebar & koneksi. */
export function buildTestPrintBytes(opts: ReceiptOptions): Uint8Array {
  const b = new EscPosBuilder(opts.charsPerLine);
  b.init();
  b.align("center").bold(true).text("=== CETAK TES ===").bold(false);
  b.align("left");
  let ruler = "";
  for (let i = 1; i <= opts.charsPerLine; i++) ruler += String(i % 10);
  b.text(ruler);
  b.text(`Lebar: ${opts.charsPerLine} kolom`);
  b.bold(true).text("Teks tebal").bold(false);
  b.size("tall").text("Teks tinggi 2x").size("normal");
  b.line("Kiri", "Kanan");
  b.line("Contoh item", formatRupiahAscii(34000));
  b.align("center").text("Jika semua baris rapi,");
  b.text("printer siap dipakai.");
  b.feed(opts.feedLines);
  if (opts.cut) b.cut();
  return b.build();
}
