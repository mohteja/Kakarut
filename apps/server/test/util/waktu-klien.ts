import { barisDi, jelajah, uraikan, type Simpul } from "./ast";
import { daftarSumber } from "./kueri-terkurung";

/**
 * MEDAN WAKTU YANG DATANG DARI KLIEN — ruas keempat: **kapan**.
 *
 * Tiga ruas kepemilikan sudah punya gerbang (`companyId`, `branchId`,
 * `userId`). Yang keempat menentukan di periode mana sebuah baris hidup, dan
 * ia punya bentuk paling telanjang dari kelas yang ledger ini berulang kali
 * menemukan: **aturannya sudah dipikirkan, ditulis, dan dikomentari — di SATU
 * pintu.**
 *
 * `modules/sync/routes.ts` menolak waktu kejadian yang tak masuk akal, dengan
 * angka (`SKEW_MENIT` 5, `MAKS_UMUR_HARI` 30/7) dan alasan tertulis. Sembilan
 * medan waktu lain yang datang dari klien hanya memvalidasi BENTUKNYA — dan
 * ketiganya yang diukur ternyata merusak sesuatu:
 *
 *   `POST /stok/awal` `tanggal: "2099-01-01"`  → 201; layar Stok melaporkan
 *     saldo **500** sementara kartu stok hari yang sama melaporkan **0**
 *   `PATCH faktur` `prod_date: "2099-06-01"`, `exp: "1900-01-01"` → 200
 *   `GET /pesanan?tanggal=bukan-tanggal` → **500**
 *
 * Yang dijaga berkas ini: tiap medan waktu dari klien punya BATAS, atau
 * terdaftar beralasan.
 */

export type KelasWaktu = "KEJADIAN" | "RENCANA" | "TERDAFTAR" | "TELANJANG";

export interface MedanWaktu {
  berkas: string;
  baris: number;
  nama: string;
  /** teks skema Zod-nya, apa adanya */
  skema: string;
  kelas: KelasWaktu;
}

/**
 * Nama medan yang MEMBAWA waktu.
 *
 * Sengaja lebar: sapuan yang terlalu sempit melaporkan kebersihan yang tak
 * ada. Medan yang tertangkap tapi bukan waktu akan mendarat di `TELANJANG`
 * dan menuntut adjudikasi — itu arah galat yang benar.
 */
const NAMA_WAKTU =
  /^(tanggal|waktu|date|mulai|selesai|exp|expires)$|_(at|date|mulai|selesai)$|^(tanggal|waktu|prod|exp)_/i;

const KEJADIAN_RE = /zTanggalKejadian\s*\(/;
const RENCANA_RE = /zTanggalRencana\s*\(|zStempelRencana\s*\(/;

/** Bentuk skema Zod — dipakai memutuskan apakah medan ini memang masukan. */
const SKEMA_RE = /^(z\.|zTanggal|zBulan|zStempel)/;

/**
 * Medan bernama-waktu di tiap skema Zod milik `modules/`.
 *
 * Dibaca dari POHON, bukan regex atas teks: kunci objek Zod bersarang beberapa
 * tingkat (`z.object({ items: z.array(z.object({ exp: … })) })`), dan sapuan
 * teks berjendela sudah salah berkali-kali di repo ini.
 */
export function medanWaktu(kode?: { nama: string; isi: string }[]): MedanWaktu[] {
  const keluar: MedanWaktu[] = [];
  for (const { nama: berkas, isi } of kode ?? daftarSumber()) {
    if (!/^modules\//.test(berkas)) continue;
    let prog: Simpul;
    try {
      prog = uraikan(berkas, isi);
    } catch {
      continue;
    }
    jelajah(prog, (n) => {
      if (n.type !== "Property" && n.type !== "ObjectProperty") return;
      const key = (n.key?.name ?? n.key?.value) as string | undefined;
      if (typeof key !== "string" || !NAMA_WAKTU.test(key)) return;
      const v = n.value;
      if (!v || v.start === undefined) return;
      const skema = isi.slice(v.start, v.end).replace(/\s+/g, " ");
      if (!SKEMA_RE.test(skema)) return;
      const kelas: KelasWaktu = KEJADIAN_RE.test(skema)
        ? "KEJADIAN"
        : RENCANA_RE.test(skema)
          ? "RENCANA"
          : "TELANJANG";
      keluar.push({ berkas, baris: barisDi(isi, n.start), nama: key, skema: skema.slice(0, 80), kelas });
    });
  }
  return keluar;
}

/** Ringkasan per kelas — dipakai uji PREMIS supaya angkanya tak diam-diam nol. */
export function petaKelasWaktu(daftar = medanWaktu()): Map<KelasWaktu, number> {
  const m = new Map<KelasWaktu, number>();
  for (const x of daftar) m.set(x.kelas, (m.get(x.kelas) ?? 0) + 1);
  return m;
}
