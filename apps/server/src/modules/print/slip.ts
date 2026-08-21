import type { Context } from "hono";
import { buildOrderSlipBytes, kolomDefault, type OrderSlipData, type ReceiptOptions } from "@kakarut/shared";
import type { AppEnv } from "../../middleware/auth";

/**
 * SLIP PESANAN DIRENDER DI SERVER — untuk klien yang tak bisa memakai
 * `@kakarut/shared`.
 *
 * Web menyusun byte ESC/POS-nya sendiri (ia mengimpor paket shared). Mobile
 * ditulis Flutter dan tak bisa, jadi ia mengambil byte yang sudah jadi dari
 * sini. Aturan yang sama dengan `qty_teks` di `transfer/routes.ts`: saat klien
 * tak bisa berbagi kode, SERVER yang menuliskannya — sebab menebak sendiri
 * sudah pernah melahirkan "900 kg" untuk barang yang sebenarnya 900 gr.
 *
 * Di sini taruhannya lebih tajam lagi. Satu-satunya janji slip ini adalah TANPA
 * HARGA; kalau layoutnya disusun ulang di Dart, janji itu hidup di dua tempat
 * dan bisa menyimpang diam-diam. Dengan render di server, ia punya satu rumah —
 * dan `OrderSlipItem` yang memang tak berkolom harga menutupnya secara
 * struktural, bukan dengan disiplin.
 */

/** Lebar kertas & perilaku potong, dibaca dari query — klien yang tahu printernya. */
export function opsiSlipDariQuery(c: Context<AppEnv>): ReceiptOptions {
  const paper = c.req.query("paper") === "80" ? 80 : 58;
  const kolomQ = Number(c.req.query("chars_per_line"));
  const feedQ = Number(c.req.query("feed"));
  return {
    charsPerLine:
      Number.isFinite(kolomQ) && kolomQ >= 16 && kolomQ <= 96 ? Math.floor(kolomQ) : kolomDefault(paper),
    // Bawaannya TIDAK memotong: printer tanpa pemotong akan menyisakan perintah
    // yang tak dikenalinya, dan klien yang tahu printernya bisa menyalakannya.
    cut: c.req.query("cut") === "1",
    // `drawerKick` SENGAJA tak bisa diminta. Slip ini bukan pembayaran, dan
    // membuka laci tiap pesanan dikirim ke dapur adalah undangan bagi selisih
    // kas — lihat `buildOrderSlipBytes`, yang memang mengabaikannya.
    drawerKick: false,
    feedLines: Number.isFinite(feedQ) && feedQ >= 0 && feedQ <= 10 ? Math.floor(feedQ) : 3,
  };
}

/**
 * Bentuk balasan slip: byte siap kirim + pratinjaunya.
 *
 * `teks` ada supaya klien bisa MEMPERLIHATKAN apa yang akan tercetak sebelum
 * kertas keluar — dan supaya yang mengembangkannya bisa memeriksa hasilnya
 * tanpa printer. Ia turunan dari byte yang sama, bukan susunan kedua: kalau
 * keduanya dibangun terpisah, pratinjaunya suatu saat akan berbohong.
 */
export function responsSlip(data: OrderSlipData, opts: ReceiptOptions) {
  const bytes = buildOrderSlipBytes(data, opts);
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
