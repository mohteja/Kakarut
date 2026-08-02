/**
 * Aturan berkas unggahan — cermin PERSIS `POST /upload`
 * (`apps/server/src/modules/upload/routes.ts`: `MAX_SIZE` dan `ALLOWED`).
 *
 * Di berkas sendiri, bukan di dalam `ImageUpload.tsx`, karena ini logika murni:
 * ia bisa diuji tanpa merender apa pun, dan uji servernya bisa mengimpornya
 * tanpa menyeret JSX ke dalam `tsconfig` server.
 *
 * Disalin dari server, dan TAK BOLEH lebih ketat. Lebih ketat berarti menolak
 * berkas yang sebenarnya diterima server, dan itu kegagalan yang jauh lebih
 * buruk daripada yang diperbaiki: pemakainya kehabisan cara sama sekali.
 */
export const MAKS_BYTE = 5 * 1024 * 1024;
export const TIPE_BOLEH = ["image/jpeg", "image/png", "image/webp"];

/** `null` = boleh diunggah. Selain itu, kalimat yang layak dibaca pemakai. */
export function alasanTolak(file: File): string | null {
  // Format diperiksa LEBIH DULU: untuk HEIC 9 MB, keluhan yang berguna adalah
  // formatnya — mengecilkan foto HEIC tetap tidak akan diterima.
  //
  // HEIC iPhone kadang datang dengan `type` kosong; itu ikut tertolak di sini,
  // sama seperti di server (yang mencari `ALLOWED[file.type]`).
  if (!TIPE_BOLEH.includes(file.type)) return "Format harus JPEG, PNG, atau WebP";
  // `>` bukan `>=` — persis seperti server, supaya tepat 5 MB tetap lolos.
  if (file.size > MAKS_BYTE) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `Ukuran maksimal 5 MB — foto ini ${mb} MB. Potret ulang dengan resolusi lebih kecil.`;
  }
  return null;
}
