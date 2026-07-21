import { PublikHeading, PublikLayout } from "./PublikLayout";
import { EMAIL_KONTAK, NAMA_APP } from "./info";

const FAQ: { t: string; j: React.ReactNode }[] = [
  {
    t: "Bagaimana cara membuat akun?",
    j: <>Buka aplikasi, ketuk <b>Daftar</b>, lalu isi nama, email, dan password. Setelah masuk, Anda dapat membuat perusahaan atau menerima undangan bergabung.</>,
  },
  {
    t: "Saya lupa password, bagaimana?",
    j: <>Di halaman Masuk, ketuk <b>Lupa password</b>, masukkan email Anda, lalu ikuti tautan atur ulang yang kami kirim ke email.</>,
  },
  {
    t: "Kenapa absensi meminta izin lokasi dan kamera?",
    j: <>Lokasi dipakai untuk memastikan Anda absen dari lokasi kerja (geofence), dan kamera untuk memindai QR serta mengambil foto bukti kehadiran. Izin hanya dipakai saat absen.</>,
  },
  {
    t: "Bagaimana menghubungkan printer struk?",
    j: <>{NAMA_APP} mendukung printer Bluetooth (aplikasi Android) dan printer jaringan (LAN). Atur di menu <b>Pengaturan → Printer</b>.</>,
  },
  {
    t: "Apakah bisa dipakai saat internet putus?",
    j: <>Ya. Transaksi tetap tercatat saat offline dan akan tersinkron otomatis begitu koneksi kembali.</>,
  },
  {
    t: "Bagaimana cara menghapus akun?",
    j: <>Buka menu <b>Profil</b> di dalam aplikasi (atau halaman Onboarding), lalu pilih <b>Hapus Akun</b>. Akun dan data pribadi terkait akan dihapus.</>,
  },
];

/** Pusat Bantuan / FAQ. */
export function BantuanPage() {
  return (
    <PublikLayout>
      <PublikHeading judul="Bantuan" sub="Pertanyaan yang sering diajukan" />

      <div className="space-y-3">
        {FAQ.map((f) => (
          <details key={f.t} className="rounded-xl border border-stone-200 bg-white p-4">
            <summary className="cursor-pointer font-semibold text-stone-900">{f.t}</summary>
            <div className="mt-2 text-sm leading-relaxed text-stone-700">{f.j}</div>
          </details>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-700">
        Masih butuh bantuan? Hubungi kami di{" "}
        <a href={`mailto:${EMAIL_KONTAK}`} className="font-medium text-orange-600 hover:underline">{EMAIL_KONTAK}</a>.
      </div>
    </PublikLayout>
  );
}
