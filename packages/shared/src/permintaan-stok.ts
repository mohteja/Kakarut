import type {
  BeliPerlengkapanStatus,
  PermintaanStokBagian,
  PermintaanStokRow,
  StatusPermintaan,
} from "./types";
import { TAHAP_BELUM_SELESAI } from "./pengadaan";

/**
 * KEADAAN SATU PERMINTAAN STOK — satu aturan, dipakai server dan web.
 *
 * Kembaran `pengadaan.ts`, dan lahir dari sebab yang sama persis. Sampai
 * 2026-09-03 kedua fungsi di bawah hidup di KLIEN
 * (`PermintaanStokPage.tsx:151-180`), dan itu tak apa-apa selama klien pula
 * yang menarik seluruh riwayat lalu menghitung sendiri. Begitu daftarnya
 * berhalaman, ringkasannya harus dihitung SERVER atas seluruh populasi — dan
 * pada saat itu aturan yang sama ada di dua tempat.
 *
 * Yang terjadi kalau dibiarkan bukan galat: ubin di atas daftar berbunyi
 * "3 selesai" sementara daftar di bawahnya memasang 4 lencana selesai, untuk
 * populasi yang sama, di layar yang sama. Tak ada yang merah, dan yang
 * membacanya tak punya cara tahu mana yang benar.
 *
 * MEMULANGKAN KEADAAN, BUKAN LABEL. Emoji ("🔄 Berjalan") dan kelas Tailwind
 * tetap milik layar yang merendernya; server yang menghitung agregat tak
 * butuh keduanya. Yang tak boleh punya dua salinan adalah aturannya.
 */

/**
 * Tahap perlengkapan yang masih MENUNTUT PEKERJAAN — kembaran
 * `TAHAP_BELUM_SELESAI` untuk pipeline BP-.
 *
 * `tiba` dan `batal` sama-sama terminal, dan bedanya bukan "selesai atau
 * belum" melainkan "berakhir bahagia atau tidak" — persis pemisahan yang sudah
 * dipakai `TAHAP_BELUM_SELESAI` vs `TAHAP_DITOLAK` di jalur bahan.
 */
export const TAHAP_PERLENGKAPAN_BELUM_SELESAI: readonly BeliPerlengkapanStatus[] = [
  "menunggu",
  "diproses",
] as const;

/** Satu-satunya akhir yang BAHAGIA di jalur perlengkapan. */
export const TAHAP_PERLENGKAPAN_TIBA: BeliPerlengkapanStatus = "tiba";

/**
 * Kelima bagian "bahan" sebuah permintaan, yang ada saja.
 *
 * `beli_perlengkapan` sengaja TIDAK ikut: pipeline-nya berbeda
 * (`BeliPerlengkapanStatus`, bukan `KonfirmasiStatus`), jadi menyatukannya di
 * sini menuntut sebuah `as` yang membohongi typecheck. Ia diperiksa terpisah
 * di kedua fungsi di bawah.
 */
function bagianBahan(r: PermintaanStokRow): PermintaanStokBagian[] {
  return [r.produksi, r.produksi_cabang, r.beli, r.beli_produksi, r.kirim].filter(
    (b): b is PermintaanStokBagian => b != null,
  );
}

/** Perlengkapannya sudah tak menuntut pekerjaan (tak ada, atau sudah final). */
function perlengkapanBeres(r: PermintaanStokRow): boolean {
  const st = r.beli_perlengkapan?.status;
  if (st == null) return true;
  // `"sebagian"` (campuran tiba & batal) bukan anggota `BeliPerlengkapanStatus`
  // dan memang final — `includes` di bawah memulangkan false untuknya, benar.
  return !TAHAP_PERLENGKAPAN_BELUM_SELESAI.includes(st as BeliPerlengkapanStatus);
}

/**
 * Permintaan dianggap SELESAI bila tak ada lagi bagian yang menuntut
 * pekerjaan — termasuk yang berakhir `ditolak`.
 *
 * `!TAHAP_BELUM_SELESAI.includes(s)` menggantikan
 * `s === "dikonfirmasi" || s === "ditolak"` yang dulu diketik di klien.
 * Nilainya identik (`KonfirmasiStatus` cuma lima), tapi himpunannya kini
 * dipegang konstanta yang JUGA dipakai merakit predikat SQL-nya di server —
 * jadi menambah tahap keenam mengubah keduanya sekaligus, bukan salah satu.
 */
export function selesaiPermintaan(r: PermintaanStokRow): boolean {
  const st = bagianBahan(r).map((b) => b.status);
  const bahanSelesai = st.length > 0 && st.every((s) => !TAHAP_BELUM_SELESAI.includes(s));
  return bahanSelesai && perlengkapanBeres(r);
}

/**
 * Keadaan keseluruhan satu permintaan = agregat keadaan semua bagiannya.
 *
 * Tiga keadaan, dan ketiganya SALING LEPAS — itu yang membuat ringkasan
 * server bisa dijamin menjumlah tepat ke `total`, dan invarian itulah yang
 * dipakai verify-api §292 untuk menangkap seluruh keluarga cacat agregat
 * sekaligus.
 *
 * Bedanya `selesai` dan `selesai_ada_ditolak` bukan kerapian: permintaan yang
 * seluruh bagiannya `ditolak` juga tak menyisakan pekerjaan apa pun, dan
 * menyebutnya "selesai" begitu saja membuat kegagalan terbaca seperti
 * keberhasilan di ubin ringkasan.
 */
export function statusPermintaan(r: PermintaanStokRow): StatusPermintaan {
  const st = bagianBahan(r).map((b) => b.status);
  const mulus =
    st.length > 0 &&
    st.every((s) => s === "dikonfirmasi") &&
    (r.beli_perlengkapan == null || r.beli_perlengkapan.status === TAHAP_PERLENGKAPAN_TIBA);
  if (mulus) return "selesai";
  if (selesaiPermintaan(r)) return "selesai_ada_ditolak";
  return "berjalan";
}
