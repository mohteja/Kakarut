import type { Context } from "hono";
import {
  buildBonBytes,
  buildOrderSlipBytes,
  kolomDefault,
  type BonData,
  type OrderSlipData,
  type ReceiptOptions,
} from "@kakarut/shared";
import type { AppEnv } from "../../middleware/auth";

/**
 * KERTAS KASIR YANG DIRENDER SERVER — untuk klien yang tak bisa memakai
 * `@kakarut/shared`.
 *
 * Web menyusun byte ESC/POS-nya sendiri (ia mengimpor paket shared). Mobile
 * ditulis Flutter dan tak bisa, jadi ia mengambil byte yang sudah jadi dari
 * sini. Aturan yang sama dengan `qty_teks` di `transfer/routes.ts`: saat klien
 * tak bisa berbagi kode, SERVER yang menuliskannya — sebab menebak sendiri
 * sudah pernah melahirkan "900 kg" untuk barang yang sebenarnya 900 gr.
 *
 * Dua kertas dilayani di sini, dan keduanya punya satu janji yang hanya bisa
 * dijaga bila layoutnya tinggal di SATU tempat:
 *
 *   · SLIP PESANAN — tanpa harga sama sekali;
 *   · BON TAGIHAN  — berharga, tapi bukan bukti pembayaran.
 *
 * Kalau salah satunya disusun ulang di Dart, janjinya hidup di dua tempat dan
 * bisa menyimpang diam-diam: satu baris harga yang terselip ke slip, atau satu
 * "Terima kasih!" yang terbawa ke bon. Tipenya di shared menutup keduanya
 * secara struktural (`OrderSlipItem` tak berkolom harga; `BonData` tak
 * berkolom metode bayar), dan render di server membuat penutupan itu berlaku
 * untuk semua klien sekaligus.
 */

/** Lebar kertas & perilaku potong, dibaca dari query — klien yang tahu printernya. */
export function opsiKertasDariQuery(c: Context<AppEnv>): ReceiptOptions {
  const paper = c.req.query("paper") === "80" ? 80 : 58;
  const kolomQ = Number(c.req.query("chars_per_line"));
  const feedQ = Number(c.req.query("feed"));
  return {
    charsPerLine:
      Number.isFinite(kolomQ) && kolomQ >= 16 && kolomQ <= 96 ? Math.floor(kolomQ) : kolomDefault(paper),
    // Bawaannya TIDAK memotong: printer tanpa pemotong akan menyisakan perintah
    // yang tak dikenalinya, dan klien yang tahu printernya bisa menyalakannya.
    cut: c.req.query("cut") === "1",
    // `drawerKick` SENGAJA tak bisa diminta, untuk KEDUA kertas. Slip pesanan
    // bukan pembayaran, dan bon tagihan justru kertas yang diserahkan SEBELUM
    // dibayar — membuka laci di salah satunya adalah undangan bagi selisih kas.
    // Kedua pembangunnya memang mengabaikannya; ini lapis keduanya.
    drawerKick: false,
    feedLines: Number.isFinite(feedQ) && feedQ >= 0 && feedQ <= 10 ? Math.floor(feedQ) : 3,
  };
}

/**
 * Bentuk balasan kertas: byte siap kirim + pratinjaunya.
 *
 * `teks` ada supaya klien bisa MEMPERLIHATKAN apa yang akan tercetak sebelum
 * kertas keluar — dan supaya yang mengembangkannya bisa memeriksa hasilnya
 * tanpa printer. Ia turunan dari byte yang sama, bukan susunan kedua: kalau
 * keduanya dibangun terpisah, pratinjaunya suatu saat akan berbohong.
 *
 * Satu fungsi untuk kedua kertas, dan itu bukan kerapian belaka: base64 dan
 * pembersihan perintah kontrol yang disalin dua kali adalah dua tempat yang
 * bisa menyimpang — dan yang menyimpang diam-diam adalah PRATINJAUNYA, yaitu
 * satu-satunya hal yang dipakai orang untuk memeriksa.
 */
function responsKertas(bytes: Uint8Array, opts: ReceiptOptions) {
  return {
    /** byte ESC/POS dalam base64 — kirim apa adanya ke printer */
    data: Buffer.from(bytes).toString("base64"),
    /** pratinjau: byte yang sama, perintah kontrolnya dibuang */
    teks: Buffer.from(bytes)
      .toString("latin1")
      .replace(/[\x00-\x09\x0b-\x1f]/g, ""),
    chars_per_line: opts.charsPerLine,
  };
}

/** Slip pesanan — menu & jumlah saja, tanpa harga. */
export function responsSlip(data: OrderSlipData, opts: ReceiptOptions) {
  return responsKertas(buildOrderSlipBytes(data, opts), opts);
}

/** Bon tagihan — berharga, diserahkan ke tamu SEBELUM membayar. */
export function responsBon(data: BonData, opts: ReceiptOptions) {
  return responsKertas(buildBonBytes(data, opts), opts);
}
