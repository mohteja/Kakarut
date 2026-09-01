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

/**
 * Badan surat verifikasi email pendaftaran — KODE 6 DIGIT dulu, tautan sesudahnya.
 *
 * Kodenya dicetak besar dan berjarak antarangka: yang dilakukan orang dengan
 * email ini adalah MEMBACANYA lalu mengetiknya di layar sebelah, dan digit
 * yang berdempetan adalah digit yang salah ketik.
 *
 * URUTANNYA BUKAN SELERA. Tautan ditaruh DI BAWAH kode, dan lebih kecil, sebab
 * tautan adalah jalan yang paling rapuh dari keduanya: ia sekali pakai, bisa
 * dipotong klien email, bisa dibuka lebih dulu oleh pemindai tautan penyedia
 * email (sehingga mati sebelum orangnya sempat), dan bisa membuka peramban
 * LAIN sehingga sesi auto-login mendarat di perangkat yang salah. Menaruhnya
 * di atas mengundang orang memakai jalan yang paling sering gagal.
 *
 * Ia tetap ada karena aplikasi PONSEL menangkapnya sebagai deep link —
 * `docs/API-CONTRACT.md` menuliskan alur itu, dan mencabutnya berarti
 * mematikan pendaftaran dari ponsel.
 */
export function suratVerifikasi(
  nama: string,
  kode: string,
  menit: number,
  url: string,
): string {
  return (
    `<p>Halo ${lolosHtml(nama)},</p>` +
    `<p>Terima kasih sudah mendaftar Terakasir. Masukkan kode ini di halaman verifikasi untuk mengaktifkan akun (berlaku ${lolosHtml(String(menit))} menit):</p>` +
    `<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;` +
    `font-weight:700;letter-spacing:8px;background:#f4f4f5;color:#111;` +
    `padding:16px 18px;border-radius:8px;border:1px solid #e4e4e7;` +
    `text-align:center">${lolosHtml(kode)}</p>` +
    `<p>Jangan berikan kode ini kepada siapa pun. Kami tidak pernah memintanya lewat telepon atau chat.</p>` +
    `<p style="font-size:13px;color:#71717a">Membuka email ini dari aplikasi Terakasir di ponsel? ` +
    `<a href="${lolosAtribut(url)}">Verifikasi lewat tautan</a> — sekali pakai.</p>` +
    `<p>Abaikan email ini bila Anda tidak mendaftar.</p>`
  );
}

/**
 * Versi TEKS-POLOS surat verifikasi.
 *
 * Bukan hiasan: sampai hari ini setiap surat yang keluar dari aplikasi ini
 * adalah surat HTML-SAJA — `Pesan.text` ada di tipenya, cabang SMTP
 * meneruskannya, tapi tak ada satu pemanggil pun yang mengisinya, dan cabang
 * Resend malah membuangnya. Surat HTML-saja berisi kode 6 angka dan satu
 * tautan punya profil spam yang tinggi.
 *
 * Ia juga jawaban bagi pembaca yang klien emailnya memang menolak HTML — di
 * situ surat lama tampil kosong.
 *
 * URL-nya dicetak MENTAH di sini, tidak seperti versi HTML yang
 * menyembunyikannya di balik anchor. Di teks-polos tak ada tempat lain untuk
 * menaruhnya, dan orang yang menyalinnya butuh alamatnya, bukan katanya.
 */
export function suratVerifikasiTeks(nama: string, kode: string, menit: number, url: string): string {
  return [
    `Halo ${nama},`,
    "",
    "Terima kasih sudah mendaftar Terakasir. Masukkan kode ini di halaman",
    `verifikasi untuk mengaktifkan akun (berlaku ${menit} menit):`,
    "",
    `    ${kode}`,
    "",
    "Jangan berikan kode ini kepada siapa pun. Kami tidak pernah memintanya",
    "lewat telepon atau chat.",
    "",
    "Membuka email ini dari aplikasi Terakasir di ponsel? Verifikasi lewat",
    `tautan berikut (sekali pakai): ${url}`,
    "",
    "Abaikan email ini bila Anda tidak mendaftar.",
  ].join("\n");
}

/** Versi TEKS-POLOS surat atur ulang password. Lihat catatan di atas. */
export function suratResetTeks(nama: string, url: string, raw: string): string {
  return [
    `Halo ${nama},`,
    "",
    "Ada permintaan atur ulang password akun Terakasir Anda. Buka tautan",
    "berikut (berlaku 1 jam):",
    "",
    `    ${url}`,
    "",
    "Bila tautannya terpotong, kode ini bisa ditempel manual:",
    "",
    `    ${raw}`,
    "",
    "Abaikan email ini bila Anda tidak meminta.",
  ].join("\n");
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
