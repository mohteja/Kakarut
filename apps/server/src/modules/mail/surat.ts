import { lolosAtribut, lolosHtml } from "@kakarut/shared";

/**
 * Perakit badan HTML surat keluar.
 *
 * Sebelumnya HTML ini dirakit inline di dalam handler, jadi satu-satunya cara
 * memeriksa hasilnya adalah dengan benar-benar mengirim surat — dan di dev
 * surat tak pernah terkirim, jadi keluarannya tak pernah terlihat. Diekstrak
 * ke fungsi murni supaya pelolosan aksaranya bisa DIUJI, bukan diyakini.
 *
 * Yang dijaga di sini: nama pengguna & nama perusahaan dipilih bebas oleh
 * pendaftar (`z.string().trim().min(1)`, tanpa batasan aksara), dan `url` bisa
 * lahir dari `X-Forwarded-Host` selama `APP_BASE_URL`/`APP_HOST_DIPERCAYA`
 * belum disetel. Keduanya masuk ke badan surat yang berangkat dari domain
 * produk dan lolos SPF/DKIM.
 *
 * Beratnya ditulis apa adanya: transport (nodemailer & Resend) menyandikan
 * header, jadi injeksi `Subject` TIDAK terjangkau; klien surat menyaring skrip,
 * jadi ini BUKAN XSS. Yang nyata: penyuntikan tautan & pemalsuan isi.
 *
 * Karena itu `subject` justru TIDAK dilolos: ia dirender sebagai teks biasa,
 * bukan HTML — melolosnya hanya akan memajang `&amp;` pada judul surat
 * perusahaan bernama "Warung Bu Ani & Anak".
 */

/**
 * Blok "kode" yang mudah disalin di badan email — untuk klien (mis. aplikasi
 * mobile) yang meminta pengguna MENEMPEL token secara manual, bukan lewat
 * tautan/deep link. Nilai ini identik dengan parameter `token` pada URL tautan.
 */
function blokKodeEmail(raw: string): string {
  return (
    `<p>Atau salin kode berikut lalu tempel di aplikasi:</p>` +
    `<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;` +
    `word-break:break-all;background:#f4f4f5;color:#111;padding:12px 14px;` +
    `border-radius:8px;border:1px solid #e4e4e7">${lolosHtml(raw)}</p>`
  );
}

/** Badan surat verifikasi email pendaftaran. */
export function suratVerifikasi(nama: string, url: string, raw: string): string {
  return (
    `<p>Halo ${lolosHtml(nama)},</p>` +
    `<p>Terima kasih sudah mendaftar Terakasir. Klik tautan di bawah untuk memverifikasi email &amp; mengaktifkan akun (berlaku 24 jam):</p>` +
    `<p><a href="${lolosAtribut(url)}">Verifikasi email saya</a></p>` +
    blokKodeEmail(raw) +
    `<p>Abaikan email ini bila Anda tidak mendaftar.</p>`
  );
}

/** Badan surat atur ulang password. */
export function suratReset(nama: string, url: string, raw: string): string {
  return (
    `<p>Halo ${lolosHtml(nama)},</p>` +
    `<p>Ada permintaan atur ulang password akun Terakasir Anda. Klik tautan di bawah (berlaku 1 jam):</p>` +
    `<p><a href="${lolosAtribut(url)}">Atur ulang password</a></p>` +
    blokKodeEmail(raw) +
    `<p>Abaikan email ini bila Anda tidak meminta.</p>`
  );
}

/** Badan surat undangan bergabung ke sebuah perusahaan. */
export function suratUndangan(namaPerusahaan: string, url: string): string {
  return (
    `<p>Anda diundang bergabung ke <b>${lolosHtml(namaPerusahaan)}</b> di Terakasir.</p>` +
    `<p>Daftar dengan email ini untuk otomatis bergabung: <a href="${lolosAtribut(url)}">${lolosHtml(url)}</a></p>` +
    `<p>Bila sudah punya akun, cukup login — undangan muncul untuk diterima.</p>`
  );
}
