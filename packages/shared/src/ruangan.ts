import type { RuanganDto } from "./types";

/** Ukuran terkecil ruangan (persen kanvas) — masih bisa dipegang jari. */
export const RUANGAN_MIN = 8;

/** Kotak ruangan dibatasi ke kanvas 0..100 dan ukuran minimum. */
export function rapikanRuangan<T extends Pick<RuanganDto, "pos_x" | "pos_y" | "lebar" | "tinggi">>(r: T): T {
  const lebar = Math.min(100, Math.max(RUANGAN_MIN, Math.round(r.lebar)));
  const tinggi = Math.min(100, Math.max(RUANGAN_MIN, Math.round(r.tinggi)));
  return {
    ...r,
    lebar,
    tinggi,
    pos_x: Math.min(100 - lebar, Math.max(0, Math.round(r.pos_x))),
    pos_y: Math.min(100 - tinggi, Math.max(0, Math.round(r.pos_y))),
  };
}

/**
 * Ruangan yang memuat titik (x, y) — titik tengah meja di denah. Bila
 * beberapa ruangan bertumpuk, yang TERKECIL menang (ruangan di dalam
 * ruangan). null = di luar semua ruangan. Satu rumah untuk server (yang
 * menyimpan `meja.ruangan_id`) dan layar (yang menggeser meja bersama
 * ruangannya); ponsel membaca hasilnya dari server.
 */
export function ruanganUntukTitik(
  x: number,
  y: number,
  ruangan: readonly Pick<RuanganDto, "id" | "pos_x" | "pos_y" | "lebar" | "tinggi">[],
): string | null {
  let pilih: { id: string; luas: number } | null = null;
  for (const r of ruangan) {
    const di = x >= r.pos_x && x <= r.pos_x + r.lebar && y >= r.pos_y && y <= r.pos_y + r.tinggi;
    if (!di) continue;
    const luas = r.lebar * r.tinggi;
    if (!pilih || luas < pilih.luas || (luas === pilih.luas && r.id < pilih.id)) pilih = { id: r.id, luas };
  }
  return pilih?.id ?? null;
}

/**
 * Meja take away WAJIB satu per cabang, digabung dengan posisi kasir
 * (permintaan pemilik 2026-11-11). Dulu bernama "Ruang Tunggu".
 */
export const NAMA_KASIR_TAKE_AWAY = "Kasir & Take Away";

/** Label nomor antrean take away: 3 → "TA-3". null → null (dine-in). */
export function labelAntrean(nomor: number | null | undefined): string | null {
  return nomor == null ? null : `TA-${nomor}`;
}

/**
 * Label meja sebuah pesanan untuk layar & kertas: pesanan take away bernomor
 * tampil "Take Away TA-3" (nama mejanya sama untuk semua, jadi tak membedakan
 * apa pun); selain itu nama meja apa adanya.
 */
export function labelMejaPesanan(meja: string | null, nomorAntrean: number | null | undefined): string | null {
  const ta = labelAntrean(nomorAntrean);
  return ta ? `Take Away ${ta}` : meja;
}
