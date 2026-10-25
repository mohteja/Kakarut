import type { PilihanAddon } from "./types";

/**
 * ADD-ON PER MENU — aturan MURNI yang dipakai server (penjaga), web (pemilih
 * kasir), dan dicermin ke Dart (ponsel). Satu rumah: kalau kasir web, kasir
 * ponsel, dan server berbeda pendapat soal "pilihan ini sah", yang terjadi
 * adalah tombol Tambah menyala lalu server menolak di saat bayar.
 */

/** Batas jumlah per add-on per porsi bila admin tak menetapkan `maks_jumlah`. */
export const BATAS_JUMLAH_ADDON = 20;

/** Bentuk minimal yang dibutuhkan aturan — cocok untuk DTO maupun baris DB. */
export interface AddonAturan {
  id: string;
  nama: string;
  maks_jumlah: number | null;
  is_active: boolean;
  /** sudah dihapus dari form menu (soft delete) */
  terhapus?: boolean;
}
export interface GrupAturan {
  id: string;
  nama: string;
  min_pilih: number;
  maks_pilih: number | null;
  terhapus?: boolean;
  addons: AddonAturan[];
}

export type HasilValidasiAddon = { ok: true } | { ok: false; pesan: string };

/**
 * Sahkah pilihan add-on untuk SATU porsi menu?
 *
 * `lenien` dipakai penjualan OFFLINE yang disusulkan: penjualannya sudah
 * terjadi di toko, jadi add-on yang sejak itu dinonaktifkan/dihapus atau grup
 * wajib yang berubah tak boleh membuat transaksi sah ditolak. Yang tetap
 * ditolak walau lenien: id yang memang bukan milik menu ini (tak mungkin lahir
 * dari kasir yang jujur — add-on tak pernah dihapus keras) dan jumlah yang
 * bukan bilangan bulat positif.
 */
export function validasiPilihanAddon(
  grup: GrupAturan[],
  pilihan: PilihanAddon[],
  opsi: { lenien?: boolean } = {},
): HasilValidasiAddon {
  const lenien = opsi.lenien === true;
  const indeks = new Map<string, { addon: AddonAturan; grup: GrupAturan }>();
  for (const g of grup) for (const a of g.addons) indeks.set(a.id, { addon: a, grup: g });

  const sudah = new Set<string>();
  const dipilihPerGrup = new Map<string, number>();
  for (const p of pilihan) {
    const ent = indeks.get(p.id);
    if (!ent) return { ok: false, pesan: "Add-on tidak dikenal untuk menu ini" };
    const { addon, grup: g } = ent;
    if (sudah.has(p.id)) return { ok: false, pesan: `Add-on "${addon.nama}" terpilih dua kali` };
    sudah.add(p.id);
    if (!Number.isInteger(p.jumlah) || p.jumlah < 1 || p.jumlah > BATAS_JUMLAH_ADDON) {
      return { ok: false, pesan: `Jumlah add-on "${addon.nama}" harus 1–${BATAS_JUMLAH_ADDON}` };
    }
    if (lenien) continue;
    if (addon.terhapus || g.terhapus || !addon.is_active) {
      return { ok: false, pesan: `Add-on "${addon.nama}" sedang tidak tersedia` };
    }
    const maks = addon.maks_jumlah ?? BATAS_JUMLAH_ADDON;
    if (p.jumlah > maks) {
      return { ok: false, pesan: `Add-on "${addon.nama}" paling banyak ${maks}× per porsi` };
    }
    dipilihPerGrup.set(g.id, (dipilihPerGrup.get(g.id) ?? 0) + 1);
  }
  if (lenien) return { ok: true };

  for (const g of grup) {
    if (g.terhapus) continue;
    const n = dipilihPerGrup.get(g.id) ?? 0;
    if (n < g.min_pilih) {
      const tersedia = g.addons.filter((a) => a.is_active && !a.terhapus).length;
      if (tersedia < g.min_pilih) {
        return { ok: false, pesan: `Grup "${g.nama}" wajib, tapi pilihannya sedang tidak tersedia` };
      }
      return {
        ok: false,
        pesan: g.min_pilih === 1 ? `Pilih satu di grup "${g.nama}"` : `Pilih minimal ${g.min_pilih} di grup "${g.nama}"`,
      };
    }
    if (g.maks_pilih !== null && n > g.maks_pilih) {
      return { ok: false, pesan: `Paling banyak ${g.maks_pilih} pilihan di grup "${g.nama}"` };
    }
  }
  return { ok: true };
}

/**
 * KUNCI IDENTITAS baris menurut add-on-nya: dua baris menu yang sama hanya
 * boleh digabung bila tandanya sama. Urutan pilihan tak berpengaruh.
 * Tanpa add-on → "" (sama dengan baris lama).
 */
export function tandaAddon(pilihan: readonly { id: string | null; jumlah: number }[]): string {
  return pilihan
    .filter((p): p is { id: string; jumlah: number } => p.id !== null)
    .map((p) => `${p.id}x${p.jumlah}`)
    .sort()
    .join(",");
}

/** Tambahan harga per SATU porsi dari add-on terpilih (dibulatkan ke sen). */
export function hargaAddon(addons: readonly { harga: number; jumlah: number }[]): number {
  return Math.round(addons.reduce((s, a) => s + a.harga * a.jumlah, 0) * 100) / 100;
}

/**
 * Teks satu add-on untuk ditampilkan: "Extra mie" atau "Extra mie x2".
 * Huruf `x` biasa, bukan `×`: teks yang sama dicetak printer thermal, dan
 * pembersih ESC/POS membuang karakter non-ASCII.
 */
export function teksAddon(a: { nama: string; jumlah: number }): string {
  return a.jumlah > 1 ? `${a.nama} x${a.jumlah}` : a.nama;
}

/** Ringkasan satu baris: "Extra mie x2, Pedas". "" bila tanpa add-on. */
export function ringkasAddon(addons: readonly { nama: string; jumlah: number }[] | null | undefined): string {
  return (addons ?? []).map(teksAddon).join(", ");
}
