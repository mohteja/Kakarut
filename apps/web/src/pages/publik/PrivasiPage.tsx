import { PublikHeading, PublikLayout, Seksi } from "./PublikLayout";
import { EMAIL_KONTAK, NAMA_APP, TANGGAL_BERLAKU } from "./info";

/** Kebijakan Privasi — WAJIB untuk App Store & Google Play. */
export function PrivasiPage() {
  return (
    <PublikLayout>
      <PublikHeading judul="Kebijakan Privasi" sub={`Berlaku sejak ${TANGGAL_BERLAKU}`} />

      <p className="mb-6 text-sm leading-relaxed text-stone-700">
        Kebijakan ini menjelaskan bagaimana {NAMA_APP} ("kami") mengumpulkan, memakai, dan melindungi
        data Anda saat memakai aplikasi web maupun aplikasi seluler (Android &amp; iOS).
      </p>

      <Seksi nomor={1} judul="Data yang kami kumpulkan">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Data akun</b>: nama dan email untuk membuat serta mengamankan akun.</li>
          <li><b>Lokasi presisi</b>: hanya diambil <b>saat Anda melakukan absensi</b>, untuk memverifikasi Anda berada di lokasi kerja (geofence). Tidak ada pelacakan lokasi di latar belakang.</li>
          <li><b>Foto</b>: foto bukti kehadiran yang Anda ambil saat absen.</li>
          <li><b>Data usaha</b>: transaksi penjualan, stok, produksi, dan data operasional yang Anda masukkan untuk menjalankan usaha Anda.</li>
          <li><b>Pengenal pengguna</b>: ID akun teknis untuk menautkan aktivitas ke akun Anda.</li>
        </ul>
      </Seksi>

      <Seksi nomor={2} judul="Cara kami memakai data">
        <ul className="list-disc space-y-1 pl-5">
          <li>Menyediakan dan mengoperasikan fitur aplikasi (kasir, stok, absensi, laporan).</li>
          <li>Memverifikasi kehadiran karyawan melalui lokasi dan foto saat absen.</li>
          <li>Mengamankan akun dan mencegah penyalahgunaan.</li>
          <li>Mengirim email penting terkait akun (mis. atur ulang password, undangan bergabung).</li>
        </ul>
        <p>Kami <b>tidak</b> memakai data Anda untuk iklan dan <b>tidak</b> melacak Anda di aplikasi atau situs lain.</p>
      </Seksi>

      <Seksi nomor={3} judul="Izin perangkat (aplikasi seluler)">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Kamera</b>: memindai QR absen dan mengambil foto bukti kehadiran.</li>
          <li><b>Lokasi</b>: memverifikasi geofence saat absen.</li>
          <li><b>Bluetooth &amp; jaringan lokal</b>: menghubungkan ke printer struk.</li>
        </ul>
        <p>Setiap izin hanya dipakai untuk fungsi terkait dan hanya saat dibutuhkan.</p>
      </Seksi>

      <Seksi nomor={4} judul="Berbagi data">
        <p>
          Kami tidak menjual data Anda. Data hanya diproses untuk mengoperasikan layanan, dan dapat
          diproses oleh penyedia infrastruktur (hosting, email) yang membantu menjalankan {NAMA_APP},
          sebatas yang diperlukan. Kami dapat mengungkapkan data bila diwajibkan oleh hukum.
        </p>
      </Seksi>

      <Seksi nomor={5} judul="Keamanan &amp; penyimpanan">
        <p>
          Data dikirim melalui koneksi terenkripsi (HTTPS) dan akses dibatasi berdasarkan peran
          pengguna. Data disimpan selama akun Anda aktif dan diperlukan untuk layanan.
        </p>
      </Seksi>

      <Seksi nomor={6} judul="Hak Anda &amp; penghapusan akun">
        <p>
          Anda dapat mengakses dan memperbarui data melalui aplikasi. Anda juga dapat <b>menghapus akun</b>
          {" "}langsung dari dalam aplikasi (menu Profil, atau halaman Onboarding). Menghapus akun akan
          menghapus akun Anda beserta data pribadi terkait, kecuali data yang wajib kami simpan menurut hukum.
        </p>
      </Seksi>

      <Seksi nomor={7} judul="Anak-anak">
        <p>{NAMA_APP} ditujukan untuk penggunaan bisnis dan tidak diperuntukkan bagi anak di bawah umur.</p>
      </Seksi>

      <Seksi nomor={8} judul="Perubahan kebijakan">
        <p>Kami dapat memperbarui kebijakan ini. Perubahan penting akan diinformasikan melalui aplikasi atau email.</p>
      </Seksi>

      <Seksi nomor={9} judul="Hubungi kami">
        <p>
          Pertanyaan seputar privasi:{" "}
          <a href={`mailto:${EMAIL_KONTAK}`} className="font-medium text-orange-600 hover:underline">{EMAIL_KONTAK}</a>.
        </p>
      </Seksi>
    </PublikLayout>
  );
}
