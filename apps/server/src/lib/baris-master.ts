import { and, eq, or, sql } from "drizzle-orm";
import type { KategoriDto, SatuanDto } from "@kakarut/shared";
import { db } from "../db/client";
import { ingredients } from "../db/schema";

/**
 * SATU-SATUNYA PERAKIT baris "daftar induk" — bentuk `{id, nama, sort_order}`
 * yang dipakai `/kategori`, `/kategori-bahan`, dan balasan tulis `/satuan`.
 *
 * Sampai 2026-09-10 tak ada perakit sama sekali: bentuknya diketik ulang
 * **sepuluh kali** dengan tangan di TIGA modul (`kategori` 3 situs,
 * `kategori-bahan` 4, `satuan` 3), dan bertahan hanya karena kesepuluhnya
 * kebetulan sama. Terukur hari itu — satu kunci ke-4 yang disuntikkan ke
 * `GET /kategori` lolos `typecheck`, lolos 3.097 uji, dan lolos 3.633 lengan
 * verify-api tanpa satu penjaga pun berubah warna.
 *
 * Web menegaskan bentuk yang sama dari sisi lain: `KategoriDto` SUDAH ada di
 * kontrak dan komentarnya berbunyi "Kategori menu (master data)" — tapi lima
 * pemanggil memakainya untuk `/kategori-bahan`, sementara `/kategori`, rute
 * yang tipe itu dinamai untuknya, dibaca lewat TIGA salinan lokal. Keduanya
 * lolos hanya karena kedua bentuknya identik hari ini.
 */
export function barisMaster(row: { id: string; nama: string; sortOrder: number }): KategoriDto {
  return { id: row.id, nama: row.nama, sort_order: row.sortOrder };
}

/**
 * Baris `GET /satuan` — daftar induk PLUS `dipakai`.
 *
 * `dipakai` dihitung dengan mencocokkan NAMA satuan terhadap `ingredients`
 * (`satuan` maupun `satuan_beli` — keduanya kolom teks bebas), supaya web bisa
 * menahan penghapusan satuan yang masih terpakai.
 *
 * Sampai 2026-09-10 medan itu HANYA dikirim `GET`, sementara `POST` dan
 * `PATCH` memulangkan tiga kunci saja — padahal `SatuanSelect.tsx` sudah
 * mengetik balasan `POST` sebagai `SatuanDto`, yang menjanjikan `dipakai:
 * number`. Terukur dari kawat: `POST /satuan` → `["id","nama","sort_order"]`,
 * `has("dipakai")` = **false**. Tipenya berbohong; yang menahannya dari
 * jadi bug cuma kebetulan bahwa satu-satunya pembacanya `.nama`.
 *
 * Diperbaiki dari sisi SERVER, bukan dengan memperlemah tipenya: ketiga
 * metode kini memulangkan bentuk yang sama, jadi klien yang menaruh hasil
 * `POST` ke dalam daftar hasil `GET` tak lagi menyisipkan baris cacat.
 */
export function barisSatuan(
  row: { id: string; nama: string; sortOrder: number },
  dipakai: number,
): SatuanDto {
  return { ...barisMaster(row), dipakai };
}

/**
 * Berapa BAHAN yang memakai satuan bernama ini — sebagai satuan resep ATAU
 * satuan beli, dihitung sekali per bahan.
 *
 * Aritmetikanya WAJIB sama dengan yang dipakai `GET /satuan`, yang menghitung
 * seluruh daftar sekaligus lewat satu sapuan. Dua cara menghitung "dipakai"
 * yang hari ini sepakat adalah dua cara yang besok bisa tidak — dan yang
 * membacanya adalah gerbang hapus di web ("satuan ini masih terpakai").
 * Karena itu keduanya dipaku berdampingan oleh penjaganya, bukan dipercaya.
 *
 * Satu kueri, dipakai hanya di jalur TULIS (satu baris), sementara `GET`
 * tetap memakai sapuan sekali-jalan untuk seluruh daftar.
 */
export async function hitungDipakai(companyId: string, nama: string): Promise<number> {
  const [baris] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.companyId, companyId),
        or(eq(ingredients.satuan, nama), eq(ingredients.satuanBeli, nama)),
      ),
    );
  return baris?.n ?? 0;
}
