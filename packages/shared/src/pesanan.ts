import type { PesananItemRow, PesananRow, PesananStatus } from "./types";

/**
 * Status KARTU diturunkan dari baris-barisnya, tidak pernah disimpan.
 *
 * `batal` hanya bila SEMUA baris batal — satu porsi yang masih dimasak membuat
 * pesanan ini belum batal. `selesai` bila tak ada lagi yang `dikerjakan`, jadi
 * pesanan yang separuh batal separuh matang tetap lepas dari kolom dapur.
 */
export function turunkanStatusPesanan(
  items: { status: PesananStatus }[],
): PesananStatus {
  if (items.length === 0) return "dikerjakan";
  if (items.every((i) => i.status === "batal")) return "batal";
  if (items.every((i) => i.status !== "dikerjakan")) return "selesai";
  return "dikerjakan";
}

/**
 * Apakah penyajian pesanan yang SUDAH DIBAYAR pernah dikoreksi?
 *
 * Saat dibuat, tiap baris SELALU lahir sebagai kebalikan `is_dine_in` BARISNYA
 * sendiri — `sajianDariKasir(override) = !(override ?? true)`, dan `createSale`
 * memakai `item.is_dine_in ?? isDineIn` untuk kolom yang sama. Baris yang
 * justru SAMA dengan `is_dine_in`-nya berarti ada yang membaliknya di papan
 * sesudah transaksi ditutup, dan pada penjualan yang sudah dibayar pembalikan
 * itu bukan kosmetik: server menghitung ulang HPP dan menulis ulang pemakaian
 * stok kemasan.
 *
 * DUA HAL yang gampang salah, dan keduanya pernah salah di sini:
 *
 * 1. Jangan pakai `sajian_takeaway` KARTU. Itu `items.every(…)` — "semua baris
 *    bawa pulang" — jadi pesanan dine-in yang cuma SEBAGIAN dibungkus tetap
 *    beragregat false, `false === true` tak pernah cocok, dan kartunya diam
 *    meski uang sudah berpindah. Arah sebaliknya kebetulan tertangkap, dan
 *    ketimpangan itulah yang membuatnya terbaca benar sekilas.
 *
 * 2. Jangan bandingkan baris dengan `is_dine_in` KARTU. Kasir boleh menandai
 *    satu porsi dibungkus di meja yang makan di tempat (`dine_in_override`),
 *    dan baris itu memang lahir `is_dine_in` false di penjualan yang
 *    `is_dine_in`-nya true. Membandingkannya dengan penanda kartu menuduhnya
 *    "diubah setelah transaksi" padahal kasir sendiri yang menetapkannya
 *    sebelum uang diterima.
 */
export function adaKoreksiSajian(
  p: Pick<PesananRow, "dibayar" | "items">,
): boolean {
  return (
    p.dibayar && p.items.some((it) => it.sajian_takeaway === it.is_dine_in)
  );
}

/** Bagian `PesananRow` yang seluruhnya turunan `items`. */
export type RingkasanPesanan = Pick<
  PesananRow,
  | "status"
  | "sajian_takeaway"
  | "item_selesai"
  | "item_batal"
  | "status_oleh"
  | "status_pada"
>;

/**
 * Ringkasan kartu dari baris-barisnya.
 *
 * DIPAKAI DUA SISI: server saat menyusun `GET /api/pesanan`, dan web saat
 * memperbarui kartu secara optimistis sebelum jawaban server datang. Kalau
 * keduanya punya salinan sendiri, papan akan menampilkan kolom/badge yang
 * berbeda dari yang akan dikirim server — dan bedanya baru terlihat 15 detik
 * kemudian saat polling menimpanya. Satu implementasi, satu perilaku.
 */
export function ringkasPesanan(items: PesananItemRow[]): RingkasanPesanan {
  // "Terakhir disentuh" = perubahan baris paling baru pada kartu ini.
  let statusOleh: string | null = null;
  let statusPada: string | null = null;
  for (const it of items) {
    if (it.status_pada && (!statusPada || it.status_pada > statusPada)) {
      statusPada = it.status_pada;
      statusOleh = it.status_oleh;
    }
  }
  return {
    status: turunkanStatusPesanan(items),
    // Kartu "bawa pulang" hanya bila SELURUH barisnya begitu — satu piring yang
    // tetap di tempat sudah cukup membuat pesanan ini bukan pesanan bawa pulang.
    sajian_takeaway: items.length > 0 && items.every((i) => i.sajian_takeaway),
    item_selesai: items.filter((i) => i.status === "selesai").length,
    item_batal: items.filter((i) => i.status === "batal").length,
    status_oleh: statusOleh,
    status_pada: statusPada,
  };
}

/**
 * Kunci urut papan: **yang terakhir diubah selalu di atas**.
 *
 * Bukan waktu pesanan masuk. Dapur menandai sajian sepanjang shift, dan kartu
 * yang baru disentuh adalah kartu yang sedang dikerjakan orang — itu yang harus
 * ada di depan mata, bukan yang kebetulan masuk paling akhir. Kartu yang belum
 * pernah disentuh jatuh ke waktu masuknya, jadi pesanan baru tetap muncul di
 * atas dan tak ada yang tenggelam.
 */
export function kunciUrutPesanan(
  p: Pick<PesananRow, "waktu" | "status_pada">,
): string {
  return p.status_pada && p.status_pada > p.waktu ? p.status_pada : p.waktu;
}

/** Urutkan papan di tempat baru (tidak mengubah array masukan). */
export function urutkanPesanan<
  T extends Pick<PesananRow, "waktu" | "status_pada">,
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    kunciUrutPesanan(b).localeCompare(kunciUrutPesanan(a)),
  );
}
