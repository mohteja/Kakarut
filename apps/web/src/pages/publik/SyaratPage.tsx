import { PublikHeading, PublikLayout, Seksi } from "./PublikLayout";
import { EMAIL_KONTAK, NAMA_APP, TANGGAL_BERLAKU } from "./info";

/** Syarat & Ketentuan penggunaan layanan. */
export function SyaratPage() {
  return (
    <PublikLayout>
      <PublikHeading judul="Syarat & Ketentuan" sub={`Berlaku sejak ${TANGGAL_BERLAKU}`} />

      <p className="mb-6 text-sm leading-relaxed text-stone-700">
        Dengan membuat akun atau memakai {NAMA_APP}, Anda menyetujui syarat dan ketentuan berikut.
        Mohon dibaca dengan saksama.
      </p>

      <Seksi nomor={1} judul="Layanan">
        <p>
          {NAMA_APP} adalah aplikasi kasir (POS) dan manajemen operasional untuk usaha makanan &amp;
          minuman, mencakup penjualan, stok, produksi, absensi, dan laporan.
        </p>
      </Seksi>

      <Seksi nomor={2} judul="Akun">
        <ul className="list-disc space-y-1 pl-5">
          <li>Anda bertanggung jawab menjaga kerahasiaan kredensial dan seluruh aktivitas pada akun Anda.</li>
          <li>Data yang Anda masukkan harus benar dan Anda berhak menggunakannya.</li>
          <li>Anda dapat menghapus akun kapan saja melalui aplikasi.</li>
        </ul>
      </Seksi>

      <Seksi nomor={3} judul="Penggunaan yang dilarang">
        <ul className="list-disc space-y-1 pl-5">
          <li>Menyalahgunakan layanan untuk aktivitas melanggar hukum atau merugikan pihak lain.</li>
          <li>Mencoba mengakses sistem/akun yang bukan milik Anda tanpa izin.</li>
          <li>Mengganggu, membebani berlebihan, atau merusak layanan.</li>
        </ul>
      </Seksi>

      <Seksi nomor={4} judul="Data &amp; konten Anda">
        <p>
          Data usaha yang Anda masukkan tetap milik Anda. Anda memberi kami lisensi terbatas untuk
          memproses data tersebut semata-mata untuk menjalankan layanan bagi Anda.
        </p>
      </Seksi>

      <Seksi nomor={5} judul="Langganan &amp; pembayaran">
        <p>
          Sebagian fitur dapat tersedia secara gratis, dan sebagian lain dapat berbayar. Bila ada
          biaya, rincian dan ketentuannya akan diinformasikan sebelum Anda berlangganan.
        </p>
      </Seksi>

      <Seksi nomor={6} judul="Ketersediaan layanan">
        <p>
          Kami berupaya menjaga layanan tetap tersedia, namun dapat melakukan pemeliharaan atau
          pembaruan sewaktu-waktu. Fitur dapat berubah untuk perbaikan.
        </p>
      </Seksi>

      <Seksi nomor={7} judul="Kekayaan intelektual">
        <p>Nama, logo, dan perangkat lunak {NAMA_APP} dilindungi dan tetap menjadi milik kami.</p>
      </Seksi>

      <Seksi nomor={8} judul="Penafian &amp; batasan tanggung jawab">
        <p>
          Layanan disediakan "sebagaimana adanya". Sejauh diizinkan hukum, kami tidak bertanggung jawab
          atas kerugian tidak langsung yang timbul dari penggunaan layanan. Anda bertanggung jawab
          mencadangkan data penting usaha Anda.
        </p>
      </Seksi>

      <Seksi nomor={9} judul="Penghentian">
        <p>
          Anda dapat berhenti dan menghapus akun kapan saja. Kami dapat menangguhkan akun yang melanggar
          ketentuan ini.
        </p>
      </Seksi>

      <Seksi nomor={10} judul="Hukum yang berlaku">
        <p>Syarat ini tunduk pada hukum Republik Indonesia.</p>
      </Seksi>

      <Seksi nomor={11} judul="Kontak">
        <p>
          Pertanyaan seputar ketentuan ini:{" "}
          <a href={`mailto:${EMAIL_KONTAK}`} className="font-medium text-orange-600 hover:underline">{EMAIL_KONTAK}</a>.
        </p>
      </Seksi>
    </PublikLayout>
  );
}
