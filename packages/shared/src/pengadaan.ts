import type { KonfirmasiStatus } from "./types";

/**
 * TAHAP PENGADAAN — satu aturan, dipakai server dan web.
 *
 * Sampai 2026-09-03 aturan "belum selesai" ditulis TIGA kali di web:
 * `Layout.tsx` (lencana nav), `TimBerandaPage.tsx` (salinan byte-identik), dan
 * `TambahStokPage.belumSelesai()`. Ringkasan pengadaan yang lahir putaran ini
 * akan jadi salinan keempat — dan salinan keempat dari aturan yang menentukan
 * angka di layar adalah cara paling pasti membuat dua angka bertetangga
 * berselisih pendapat soal faktur yang sama.
 *
 * Berkas ini rumahnya. Server memakainya untuk agregat `ringkas`; web untuk
 * badge, lencana, dan ubin ringkasannya.
 */

/**
 * Tahap yang masih MENUNTUT PEKERJAAN — sama untuk kedua jalur.
 *
 * Sempat terlihat seolah butuh dua rumus: label produksi untuk `menunggu`
 * berbunyi "✅ Selesai — masuk stok", sementara label beli untuk tahap yang sama
 * berbunyi "🚚 Dikirim — menunggu penerimaan". Label produksi itu ASPIRASI,
 * bukan keadaan: `POST /tahap` meng-auto-konfirmasi baris CK-lokal di dalam
 * transaksi yang sama, jadi baris produksi yang benar-benar DUDUK di `menunggu`
 * hampir selalu work-order beralamat yang belum dikirim atau sedang di jalan.
 *
 * Server sendiri sudah memakai satu predikat untuk kedua jalur saat mengurutkan
 * daftarnya: `status NOT IN ('dikonfirmasi','ditolak')`. Himpunan ini
 * komplemennya, ditulis positif.
 */
export const TAHAP_BELUM_SELESAI: readonly KonfirmasiStatus[] = [
  "rencana",
  "dikerjakan",
  "menunggu",
] as const;

/** `ditolak` terminal-tapi-tak-bahagia: bukan tugas tersisa, bukan keberhasilan. */
export const TAHAP_DITOLAK: KonfirmasiStatus = "ditolak";

/** Urutan pipeline — dipakai aturan "tahap hanya bisa maju" & pilihan dropdown. */
export const URUTAN_TAHAP: Record<KonfirmasiStatus, number> = {
  rencana: 0,
  dikerjakan: 1,
  menunggu: 2,
  dikonfirmasi: 3,
  ditolak: 3,
};

/**
 * Status satu FAKTUR (bukan baris). Setelah "terima sebagian", satu faktur
 * bisa punya baris diterima + baris ditolak sekaligus → status "sebagian".
 * Setelah "maju sebagian": ada baris selesai + baris yang masih dikerjakan
 * → status "selesai_sebagian" (masih ada item yang belum).
 */
export type StatusFaktur = KonfirmasiStatus | "sebagian" | "selesai_sebagian";

/**
 * Status faktur diturunkan dari status baris-barisnya. Setelah "maju sebagian"
 * baris-baris bisa berbeda tahap → tampilkan tahap PALING AWAL yang belum
 * selesai (di situlah sisa tugas berada).
 */
export function statusFaktur(rows: { status: KonfirmasiStatus }[]): StatusFaktur {
  const set = new Set(rows.map((r) => r.status));
  if (set.size === 1) return rows[0].status;
  // ada item yang sudah selesai (dikirim/diterima) TAPI masih ada yang belum
  // → "selesai sebagian"
  const adaBelum = set.has("rencana") || set.has("dikerjakan");
  const adaSelesai = set.has("menunggu") || set.has("dikonfirmasi");
  if (adaBelum && adaSelesai) return "selesai_sebagian";
  for (const s of ["rencana", "dikerjakan", "menunggu"] as const) {
    if (set.has(s)) return s;
  }
  // campuran baris selesai: ada yang diterima & ditolak
  return "sebagian";
}

/** Satu BARIS masih menuntut pekerjaan. */
export function barisBelumSelesai(status: KonfirmasiStatus): boolean {
  return TAHAP_BELUM_SELESAI.includes(status);
}

/** Faktur yang belum selesai (masih dalam pipeline) belum menambah saldo stok. */
export function belumSelesai(status: StatusFaktur): boolean {
  return (
    status === "rencana" ||
    status === "dikerjakan" ||
    status === "menunggu" ||
    status === "selesai_sebagian"
  );
}

/**
 * BARIS yang "selesai tapi belum sampai" — tak terlihat dari status mana pun,
 * dan justru itu yang membuatnya berbahaya:
 *
 *   · `menunggu` + beralamat  = sudah jadi tapi belum berangkat, atau sedang
 *     di jalan dan belum diterima cabang;
 *   · `dikonfirmasi` + `untuk_branch_id` = hasil produksi yang sudah masuk stok
 *     CK tapi belum di-`kirim-hasil` ke cabang yang memintanya.
 *
 * Keduanya berbunyi "beres" di papan sementara barangnya tak bisa dipakai
 * siapa pun. Predikatnya disalin dari `stok/service.ts` (`qtyDiJalan`), bukan
 * dikarang di sini.
 */
export function barisBelumSampai(r: {
  status: KonfirmasiStatus;
  tujuan_branch_id: string | null;
  untuk_branch_id: string | null;
}): boolean {
  if (r.status === "menunggu") return r.tujuan_branch_id != null;
  if (r.status === "dikonfirmasi") return r.untuk_branch_id != null;
  return false;
}
