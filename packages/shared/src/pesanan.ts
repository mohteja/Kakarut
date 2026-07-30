import type { PesananItemRow, PesananRow, PesananStatus } from "./types";

/**
 * Status KARTU diturunkan dari baris-barisnya, tidak pernah disimpan.
 *
 * `batal` hanya bila SEMUA baris batal — satu porsi yang masih dimasak membuat
 * pesanan ini belum batal. `selesai` bila tak ada lagi yang `dikerjakan`, jadi
 * pesanan yang separuh batal separuh matang tetap lepas dari kolom dapur.
 */
export function turunkanStatusPesanan(items: { status: PesananStatus }[]): PesananStatus {
  if (items.length === 0) return "dikerjakan";
  if (items.every((i) => i.status === "batal")) return "batal";
  if (items.every((i) => i.status !== "dikerjakan")) return "selesai";
  return "dikerjakan";
}

/** Bagian `PesananRow` yang seluruhnya turunan `items`. */
export type RingkasanPesanan = Pick<
  PesananRow,
  "status" | "sajian_takeaway" | "item_selesai" | "item_batal" | "status_oleh" | "status_pada"
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
export function kunciUrutPesanan(p: Pick<PesananRow, "waktu" | "status_pada">): string {
  return p.status_pada && p.status_pada > p.waktu ? p.status_pada : p.waktu;
}

/** Urutkan papan di tempat baru (tidak mengubah array masukan). */
export function urutkanPesanan<T extends Pick<PesananRow, "waktu" | "status_pada">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => kunciUrutPesanan(b).localeCompare(kunciUrutPesanan(a)));
}
