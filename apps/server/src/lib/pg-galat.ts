import { HTTPException } from "hono/http-exception";

/**
 * Pengenal galat Postgres yang dipakai bersama modul-modul.
 *
 * Dulu tinggal di dalam `kebersihan/routes.ts` sebagai fungsi lokal, jadi
 * modul lain yang butuh pengaman yang sama tak punya apa pun untuk dipakai —
 * dan yang terjadi bukan mereka menyalinnya, melainkan mereka tidak
 * memasangnya sama sekali.
 */

/**
 * Benarkah galat ini pelanggaran indeks/constraint UNIK (SQLSTATE 23505)?
 *
 * Drizzle membungkus galat driver, jadi kodenya bisa berada di `err.code`
 * maupun `err.cause.code` — keduanya diperiksa.
 *
 * Dipakai untuk pola **sisipkan lalu tangkap**: saat ada indeks unik yang
 * menjadi sumber kebenaran, memeriksa lebih dulu dengan SELECT tidak pernah
 * cukup — selalu ada jeda antara memeriksa dan menyisipkan. Yang menutup jeda
 * itu indeksnya; tugas kode adalah menerjemahkan penolakannya jadi hasil yang
 * bisa dibaca, bukan 500.
 */
export function bentrokUnik(err: unknown): boolean {
  const kode =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code;
  return kode === "23505";
}

/**
 * Bentrok unik pada indeks TERTENTU — dikenali dari nama constraint-nya.
 *
 * KENAPA PERLU YANG SPESIFIK, padahal `bentrokUnik` sudah ada.
 *
 * Satu penulisan sering berdiri di belakang BEBERAPA indeks unik sekaligus,
 * dan masing-masing berarti hal yang berbeda bagi pemanggilnya. Pembuatan
 * karyawan menabrak `users_email_unique` ("email itu sudah dipakai orang lain",
 * 409 dan berhenti) maupun `memberships_company_kode_uq` ("kode karyawan acak
 * yang barusan dipilih kebetulan sudah ada", coba lagi). Menerjemahkan
 * keduanya sebagai satu hal membuat retry kode karyawan berubah jadi penolakan
 * yang salah — atau sebaliknya, email kembar terus diulang tiga kali sebelum
 * gagal.
 *
 * Nama constraint dicocokkan dengan `includes`, bukan sama-persis: Postgres
 * memulangkannya apa adanya, tetapi jalur galat yang dibungkus driver sesekali
 * menyisipkan awalan skema.
 */
export function bentrokUnikPada(err: unknown, ...namaConstraint: string[]): boolean {
  if (!bentrokUnik(err)) return false;
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  const nama = e?.constraint ?? e?.cause?.constraint ?? "";
  return namaConstraint.some((n) => nama.includes(n));
}

/**
 * Benarkah galat ini "sintaks nilai tak sah" (SQLSTATE 22P02)?
 *
 * Yang melahirkannya di sini hampir selalu satu hal: id dari PATH/QUERY masuk
 * langsung ke pembanding kolom `uuid`. `/customer/abc` membuat Postgres
 * melempar `invalid input syntax for type uuid`, dan tanpa terjemahan itu
 * keluar sebagai **500** — padahal murni salah input klien.
 *
 * Ada 142 pembacaan `c.req.param()` di modul-modul dan hanya lima berkas yang
 * memasang saringan uuid sendiri. Menyalin saringan ke 137 tempat sisanya
 * bukan perbaikan, itu daftar tugas yang tak akan selesai — jadi
 * terjemahannya dipasang di SATU pintu keluar galat (`app.onError`).
 *
 * Sengaja TIDAK membuatnya senyap: 400-nya tetap dicatat ke `error_logs`.
 * 22P02 bisa juga lahir dari literal cacat yang disusun kode sendiri, dan itu
 * cacat server sungguhan — yang berubah cuma labelnya, bukan keberadaannya di
 * panel.
 */
export function nilaiTakSah(err: unknown): boolean {
  const kode =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code;
  return kode === "22P02";
}

/** SQLSTATE galat ini, dari mana pun driver menaruhnya. */
function sqlstate(err: unknown): string | undefined {
  return (
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code
  );
}

/**
 * Alasan gagal SATU BARIS, dalam bahasa yang bisa dibaca pengirimnya — dan
 * yang TAK PERNAH memulangkan teks mentah dari driver.
 *
 * KENAPA ADA. Jalur massal (impor CSV, unggah daftar) tidak menggagalkan
 * seluruh permintaan saat satu baris bermasalah; ia melaporkan baris itu dan
 * meneruskan sisanya. Yang mudah terlewat: "melaporkan barisnya" sempat
 * berarti `(e as Error).message` apa adanya — dan pesan Drizzle memuat SELURUH
 * kueri yang gagal beserta parameternya.
 *
 * TERUKUR, bukan dikhawatirkan. Mengimpor satu bahan berharga 1e15 (kolomnya
 * `numeric(14,2)`) memulangkan ke klien: seluruh perintah INSERT lengkap dengan
 * ke-30 nama kolomnya, ditambah daftar parameternya — termasuk UUID perusahaan.
 * Pemiliknya cuma salah mengetik nol; yang ia lihat dump SQL.
 *
 * Dua kerugian sekaligus, dan yang kedua yang lebih dalam:
 *   · bocornya bentuk dalam basis data & pengenal internal ke pihak yang cukup
 *     punya hak mengimpor bahan;
 *   · pesan yang tak bisa ditindaklanjuti siapa pun. "Failed query: insert
 *     into…" tidak memberi tahu bahwa yang salah adalah ANGKA HARGANYA.
 *
 * Galat yang kita lempar sendiri (`HTTPException`) diteruskan apa adanya —
 * itu memang kalimat untuk dibaca orang, dan sudah kita tulis.
 */
export function alasanGagalBaris(err: unknown, bawaan: string): string {
  if (err instanceof HTTPException) return err.message || bawaan;
  switch (sqlstate(err)) {
    case "23505":
      return "Sudah ada baris lain dengan nama/kode yang sama";
    case "22003":
      return "Angkanya terlalu besar untuk disimpan";
    case "22001":
      return "Teksnya terlalu panjang";
    case "23502":
      return "Ada kolom wajib yang kosong";
    case "23503":
      return "Acuannya tidak ditemukan (kategori/satuan/supplier)";
    case "23514":
      return "Nilainya tidak memenuhi aturan yang berlaku";
    case "22P02":
      return "Format nilainya tidak sah";
    default:
      // SENGAJA tidak menyertakan pesan aslinya. Galat yang belum dikenali
      // tetap tercatat lengkap di `error_logs` untuk yang berhak melihatnya;
      // yang tak boleh cuma mengirimkannya ke pengirim permintaan.
      return bawaan;
  }
}

/**
 * Jalankan tulisan yang bisa menabrak indeks unik, lalu terjemahkan
 * penolakannya jadi 409 berpesan.
 *
 * Kenapa perlu: jalur MEMBUAT di repo ini rata-rata sudah menjaga nama kembar
 * (pra-cek atau `onConflictDoNothing` + 409), tapi jalur MENGGANTI NAMA tidak —
 * sampai sekarang tak ada satu pun yang menjaganya. Padahal indeksnya sama, dan
 * mengetik nama yang sudah dipakai adalah hal paling biasa yang dilakukan orang.
 * Tanpa ini hasilnya 23505 mentah alias 500 — dan di web, 500 yang bukan galat
 * aplikasi memicu overlay global "server sedang diperbarui": aplikasinya
 * terlihat tumbang gara-gara salah ketik nama meja.
 *
 * UPDATE tak punya `ON CONFLICT`, jadi sisipkan-lalu-tangkap adalah satu-satunya
 * cara — dan itu justru yang benar: indeksnya yang jadi sumber kebenaran, bukan
 * pra-cek yang selalu punya jeda sebelum tulisannya.
 */
export async function tanpaBentrok<T>(
  pesan: string,
  jalankan: () => Promise<T>,
  /**
   * Batasi terjemahannya ke indeks yang DISEBUT. Kosong = indeks unik mana pun,
   * perilaku asli helper ini.
   *
   * Diperlukan begitu satu penulisan berdiri di belakang lebih dari satu indeks:
   * `invitations` misalnya dijaga `..._email_pending_uq` (yang memang berarti
   * "sudah diundang") DAN `invitations_token_unique` (token acak yang kebetulan
   * kembar — hal lain sama sekali, dan menyebutnya "sudah diundang" membuat
   * pengundang berhenti padahal cukup mencoba lagi).
   */
  ...hanyaConstraint: string[]
): Promise<T> {
  try {
    return await jalankan();
  } catch (err) {
    const cocok =
      hanyaConstraint.length === 0
        ? bentrokUnik(err)
        : bentrokUnikPada(err, ...hanyaConstraint);
    if (cocok) throw new HTTPException(409, { message: pesan });
    throw err;
  }
}
