import { PublikHeading, PublikLayout } from "./PublikLayout";
import { EMAIL_KONTAK, NAMA_APP } from "./info";

/** Kontak — hanya email (sesuai permintaan: email yang dipakai SMTP). */
export function KontakPage() {
  return (
    <PublikLayout>
      <PublikHeading judul="Kontak" sub="Kami siap membantu" />

      <p className="text-sm leading-relaxed text-stone-700">
        Untuk pertanyaan, kendala teknis, atau kerja sama terkait {NAMA_APP}, hubungi kami melalui
        email. Kami berusaha membalas dalam 1–2 hari kerja.
      </p>

      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
        <div className="text-sm font-medium text-stone-500">Email</div>
        <a
          href={`mailto:${EMAIL_KONTAK}`}
          className="mt-1 block text-lg font-semibold text-orange-600 hover:underline"
        >
          {EMAIL_KONTAK}
        </a>
        <a
          href={`mailto:${EMAIL_KONTAK}?subject=Bantuan%20${encodeURIComponent(NAMA_APP)}`}
          className="mt-4 inline-block rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700"
        >
          Kirim Email
        </a>
      </div>

      <p className="mt-6 text-sm text-stone-500">
        Sebelum menghubungi kami, Anda mungkin menemukan jawaban di halaman{" "}
        <a href="/bantuan" className="font-medium text-orange-600 hover:underline">Bantuan</a>.
      </p>
    </PublikLayout>
  );
}
