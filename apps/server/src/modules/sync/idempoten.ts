import { and, eq, lt, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { syncCommands } from "../../db/schema";

/**
 * Ledger idempotensi BERSAMA dengan /api/sync — kunci `(company_id, client_ref)`.
 *
 * Endpoint ONLINE (penjualan/absensi) memakai ledger yang sama supaya retry —
 * baik retry online maupun antrean yang jatuh ke /sync setelah `receiveTimeout`
 * — mengenali perintah yang SUDAH sukses dan tidak menggandakannya. `/sync`
 * sendiri sudah membaca ledger ini lebih dulu, jadi begitu jalur online mencatat
 * di sini, retry lewat /sync otomatis membalas `sudah_ada`.
 */

/**
 * Field `client_ref` opsional (UUID v4 dari perangkat). Kosong/absen → diabaikan
 * (perilaku lama untuk klien tanpa field ini tidak berubah).
 */
export const clientRefField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().uuid().optional(),
);

/** Field `device_id` opsional (metadata ledger, tidak wajib). */
export const deviceIdField = z.string().trim().max(200).nullish();

/**
 * Hasil SUKSES yang sudah tercatat untuk `client_ref` ini, atau `null` bila belum
 * pernah ada. Membungkus dalam objek supaya "ada tapi hasilJson null" tetap
 * dikenali sebagai HIT (jangan sampai dieksekusi ulang).
 */
export async function cariHasilIdempoten(
  companyId: string,
  clientRef: string,
): Promise<{ hasilJson: unknown } | null> {
  const [ada] = await db
    .select({ status: syncCommands.status, hasilJson: syncCommands.hasilJson })
    .from(syncCommands)
    .where(and(eq(syncCommands.companyId, companyId), eq(syncCommands.clientRef, clientRef)));
  return ada && ada.status === "ok" ? { hasilJson: ada.hasilJson ?? null } : null;
}

/**
 * Catat hasil SUKSES jalur online ke ledger bersama. Idempoten via unique index
 * `(company_id, client_ref)` + `onConflictDoNothing` (aman bila ada balapan/retry).
 */
export async function catatHasilIdempoten(p: {
  companyId: string;
  clientRef: string;
  userId: string;
  deviceId?: string | null;
  tipe: string;
  hasilJson: unknown;
  kode?: number;
}): Promise<void> {
  await db
    .insert(syncCommands)
    .values({
      companyId: p.companyId,
      clientRef: p.clientRef,
      deviceId: p.deviceId ?? null,
      userId: p.userId,
      tipe: p.tipe,
      waktu: new Date(),
      status: "ok",
      kode: p.kode ?? 201,
      hasilJson: p.hasilJson as object,
    })
    .onConflictDoNothing();
}

/**
 * Status ledger untuk perintah yang SEDANG dieksekusi — baris dipesan sebelum
 * eksekusi dimulai, lalu ditutup jadi 'ok' (atau dilepas lagi) setelahnya.
 */
export const BERJALAN = "berjalan";

/**
 * Klaim yang lebih tua dari ini dianggap ditinggalkan (proses mati / di-deploy
 * ulang di tengah jalan) dan boleh diambil alih. Harus JAUH lebih lama daripada
 * satu permintaan terpanjang — kalau terlalu pendek, retry sah bisa merebut
 * klaim yang sebenarnya masih berjalan dan justru menggandakan yang dijaga.
 */
export const KLAIM_BASI_MENIT = 15;

/**
 * Penolakan "perintahmu sedang dikerjakan permintaan lain".
 *
 * `sebab` dipasang sebagai PROPERTI, bukan `cause`: `app.onError` membacanya
 * lewat `(err as { sebab?: string }).sebab` dan hanya properti itu yang sampai
 * ke badan respons — sama seperti `PenjualanGagal`. Sebabnya sengaja sama
 * dengan yang dipakai `/sync` supaya klien offline mengenalinya tanpa
 * mencocokkan teks pesan.
 *
 * Kode 409 (bukan 4xx lain) juga disengaja: mobile memperlakukan kode ≥ 400
 * sebagai BELUM selesai, jadi perintahnya tetap di antrean dan terkirim lagi
 * pada tick berikutnya — tepat yang diinginkan.
 */
export class SedangDiproses extends HTTPException {
  readonly sebab = "sedang_diproses";
  constructor() {
    super(409, { message: "Perintah ini sedang diproses — coba lagi sebentar lagi" });
  }
}

/**
 * KLAIM ATOMIK sebelum eksekusi — bukan sekadar "periksa dulu".
 *
 * `cariHasilIdempoten` (SELECT) hanyalah jalur cepat. Ia TIDAK menjaga apa pun
 * dari eksekusi ganda: dua permintaan ber-`client_ref` sama yang datang
 * bersamaan sama-sama melihat ledger kosong, sama-sama menjalankan perintahnya,
 * lalu yang kedua kalah di unique index dan hasilnya DIBUANG diam-diam oleh
 * `onConflictDoNothing`. Ledger terlihat rapi satu baris; penjualannya dua.
 *
 * `/sync` sudah dijaga begini sejak lama. TUJUH jalur ONLINE memakai pola
 * SELECT-lalu-eksekusi-lalu-INSERT itu — penjualan, refund, absensi (×2),
 * opname, transfer, rencana — jadi lubangnya terbuka di ketujuhnya. Semuanya
 * kini lewat fungsi ini, dan alasannya dibagi (bukan disalin) supaya jalur
 * KEDELAPAN yang muncul kelak tidak bisa lagi lupa memakainya.
 *
 * `cariHasilIdempoten`/`catatHasilIdempoten` sengaja DIPERTAHANKAN sebagai
 * ekspor: `/sync` masih memakainya untuk membaca ledger dan menyimpan
 * penolakan sebagai 'gagal' — kontrak yang memang berbeda (lihat di bawah).
 * Yang tak boleh lagi adalah memakai keduanya sebagai penjaga jalur online.
 *
 * Kontrak "lepas saat gagal" DISENGAJA dan berbeda dari `/sync`:
 * `/sync` menyimpan penolakan sebagai 'gagal' agar mobile mendapat sebab yang
 * sama tanpa mengeksekusi ulang. Jalur online tidak boleh begitu — web menahan
 * `client_ref` yang SAMA sampai sukses (`refPembayaran.current ??= uuidV4()`,
 * hanya direset di `onSuccess`). Kalau penolakan disimpan dan diputar ulang,
 * kasir yang ditolak karena stok kurang lalu memperbaiki keranjangnya akan
 * mendapat penolakan lama itu SELAMANYA. Maka bila `jalankan` melempar,
 * barisnya DILEPAS: perintahnya memang tidak berefek (transaksinya rollback),
 * dan percobaan berikutnya berhak dieksekusi sungguhan.
 */
export async function denganKlaimIdempoten<T>(
  p: {
    companyId: string;
    /** Tanpa ini idempotensi dimatikan — `jalankan` dieksekusi apa adanya. */
    clientRef?: string;
    userId: string;
    deviceId?: string | null;
    tipe: string;
  },
  jalankan: () => Promise<T>,
): Promise<{ data: T; baru: boolean }> {
  const { companyId, clientRef } = p;
  if (!clientRef) return { data: await jalankan(), baru: true };

  const kunci = and(eq(syncCommands.companyId, companyId), eq(syncCommands.clientRef, clientRef));

  // Jalur cepat: sudah pernah SUKSES → putar ulang hasilnya, jangan eksekusi.
  const [ada] = await db
    .select({ status: syncCommands.status, hasilJson: syncCommands.hasilJson })
    .from(syncCommands)
    .where(kunci);
  if (ada?.status === "ok") return { data: ada.hasilJson as T, baru: false };

  const sekarang = Date.now();
  const [klaim] = await db
    .insert(syncCommands)
    .values({
      companyId,
      clientRef,
      deviceId: p.deviceId ?? null,
      userId: p.userId,
      tipe: p.tipe,
      waktu: new Date(),
      status: BERJALAN,
      kode: 0,
    })
    .onConflictDoNothing()
    .returning({ id: syncCommands.id });

  if (!klaim) {
    /*
     * Kalah klaim. Tiga kemungkinan; hanya dua yang boleh dieksekusi:
     *   - baris 'gagal' dari `/sync` → boleh diambil alih. Jalur online memang
     *     selalu mengeksekusi ulang percobaan yang ditolak (perilaku lama
     *     `cariHasilIdempoten`, yang memulangkan null untuk status 'gagal');
     *   - klaim 'berjalan' yang BASI, pengeklaimnya mati sebelum menutup
     *     barisnya → boleh diambil alih sesudah `KLAIM_BASI_MENIT`;
     *   - klaim 'berjalan' yang masih segar → JANGAN sentuh, ini justru yang
     *     dijaga. Suruh klien coba lagi sebentar lagi.
     *
     * UPDATE bersyarat, bukan baca-lalu-tulis: dua pengambil-alih yang datang
     * bersamaan pun tetap hanya satu yang mendapat barisnya.
     */
    const [rebut] = await db
      .update(syncCommands)
      .set({ status: BERJALAN, kode: 0, hasilJson: null, createdAt: new Date() })
      .where(
        and(
          kunci,
          or(
            eq(syncCommands.status, "gagal"),
            and(
              eq(syncCommands.status, BERJALAN),
              lt(syncCommands.createdAt, new Date(sekarang - KLAIM_BASI_MENIT * 60_000)),
            ),
          ),
        ),
      )
      .returning({ id: syncCommands.id });
    if (!rebut) {
      /*
       * SENGAJA tidak disimpan sebagai 'gagal': ini bukan penolakan
       * perintahnya, cuma "sedang dikerjakan". Menyimpannya akan membekukan
       * perintah yang sebenarnya sedang sukses. Sebab `sedang_diproses` sama
       * dengan yang dipakai `/sync`, jadi klien offline mengenalinya.
       */
      throw new SedangDiproses();
    }
  }

  let data: T;
  try {
    data = await jalankan();
  } catch (e) {
    // Lihat kontrak "lepas saat gagal" di atas — barisnya dihapus supaya
    // percobaan berikutnya ber-`client_ref` sama benar-benar dieksekusi.
    // Dibatasi `status = BERJALAN` agar tak menyentuh baris yang sudah ditutup
    // pihak lain, dan kegagalan pelepasannya tak boleh menelan galat aslinya.
    await db
      .delete(syncCommands)
      .where(and(kunci, eq(syncCommands.status, BERJALAN)))
      .catch(() => {});
    throw e;
  }

  // Tutup baris yang tadi diklaim. Barisnya sudah ADA sejak sebelum eksekusi,
  // jadi di sini cukup UPDATE — tak ada lagi INSERT yang bisa kalah balapan dan
  // membuang hasilnya diam-diam.
  await db
    .update(syncCommands)
    .set({ status: "ok", kode: 201, hasilJson: data as object })
    .where(kunci);
  return { data, baru: true };
}
