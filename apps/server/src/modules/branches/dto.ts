import type { CabangDto } from "@kakarut/shared";
import type { branches } from "../../db/schema";

type BarisCabang = typeof branches.$inferSelect;

/**
 * SATU-SATUNYA PERAKIT `CabangDto` untuk kawat.
 *
 * Sampai 2026-09-11 ia inline di `branches/routes.ts` dengan satu pemakai, dan
 * itu tak apa-apa selama pemakainya memang satu. Yang membuatnya harus keluar:
 * `GET /admin/tenants/:id` memulangkan cabang juga — dan memulangkannya sebagai
 * BARIS TABEL APA ADANYA (`db.select()` telanjang, 16 kunci camelCase), bukan
 * bentuk yang dipilih siapa pun.
 *
 * Dua bentuk untuk satu tabel, dan yang kedua mengikuti skema: kolom yang
 * ditambahkan besok ikut terkirim tanpa ada yang memutuskannya. Persis yang
 * ATURAN A `bentuk-balasan` larang — dan alasan larangan itu tak terlihat di
 * sana ditulis di penjaganya sendiri.
 */
export function cabangDto(r: BarisCabang): CabangDto {
  return {
    id: r.id,
    nama: r.nama,
    alamat: r.alamat,
    telepon: r.telepon,
    tipe: r.tipe,
    central_kitchen_id: r.centralKitchenId,
    receipt_footer: r.receiptFooter,
    receipt_show_alamat: r.receiptShowAlamat,
    latitude: r.latitude,
    longitude: r.longitude,
    radius_absen_m: r.radiusAbsenM,
    jam_buka: r.jamBuka,
    jam_tutup: r.jamTutup,
    is_active: r.isActive,
  };
}
