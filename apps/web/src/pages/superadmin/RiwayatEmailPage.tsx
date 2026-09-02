import { useQuery } from "@tanstack/react-query";
import type { PercobaanEmailDto } from "@kakarut/shared";
import { Link } from "react-router-dom";
import { PageTitle, SpinnerAtauGalat } from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { api } from "../../lib/api";

/**
 * RIWAYAT PERCOBAAN KIRIM EMAIL — sub-halaman Pengaturan Email.
 *
 * Lahir di halaman Sistem & Migrasi, lalu dipindah ke bawah Pengaturan Email
 * atas permintaan pemilik repo — dan alasannya tepat: orang yang bertanya
 * "surat itu benar-benar dikirim atau tidak?" sedang berurusan dengan EMAIL,
 * bukan dengan migrasi. Di halaman lama ia harus digulir lewat daftar 100
 * migrasi lebih dulu, dan pemilik repo sempat mencarinya di Log Galat.
 *
 * Datanya tetap menumpang `GET /admin/sistem` (kunci query yang sama dengan
 * halaman Sistem), bukan rute baru: tak ada kontrak yang berubah, tak ada
 * cakupan rute yang bergeser, dan halaman ini dibuka jarang oleh satu-dua
 * operator.
 *
 * BUKAN daftar temuan, dan sengaja tak diberi warna merah: baris "Tidak
 * dikirim" yang sah (akun sudah terverifikasi, email tak terdaftar) adalah
 * keadaan NORMAL. Yang dijawab tabel ini cuma satu pertanyaan — dan itu
 * pertanyaan yang dulu tak bisa dijawab dari mana pun.
 */

interface SistemStatus {
  email_percobaan: PercobaanEmailDto[];
}

/**
 * Sebab "tidak dikirim", diterjemahkan ke kalimat yang bisa dibaca orang.
 *
 * Kode mentahnya (`akun_terverifikasi`, `jarak_kirim_ulang`, …) memang bentuk
 * yang benar untuk disimpan, tapi ia menyuruh pembacanya menebak. Padahal
 * tabel ini ada justru untuk menghentikan tebakan.
 *
 * Kuncinya DIJAGA sama persis dengan serikat `SebabTakDicoba` di server
 * (`otp-senyap-tercatat.test.ts`): peta ini pernah membawa label untuk sebab
 * yang sudah dicabut (`email_sudah_terdaftar`), disalin utuh saat halaman ini
 * dipindah, dan tak ada yang menuduh — penjaga yang ada memeriksa salinannya
 * sendiri, bukan peta yang dilihat orang.
 */
const SEBAB: Record<string, string> = {
  balapan_pendaftaran: "Kalah balapan pendaftaran (permintaan kembar)",
  jarak_kirim_ulang: "Ditahan jarak 2 menit antar kirim ulang",
  email_tak_dikenal: "Email tidak terdaftar",
  akun_terhapus: "Akun sudah dihapus",
  akun_nonaktif: "Akun dinonaktifkan",
  akun_terverifikasi: "Akun sudah terverifikasi — tak perlu kode lagi",
  penyedia_belum_diatur: "Belum ada penyedia email (SMTP kosong & tanpa Resend)",
};

export function RiwayatEmailPage() {
  const { data: sistem, error } = useQuery({
    queryKey: ["admin-sistem"],
    queryFn: () => api<SistemStatus>("/admin/sistem"),
  });

  if (!sistem) return <SpinnerAtauGalat error={error} apa="Riwayat kirim email" />;

  return (
    <div className="max-w-3xl">
      <PageTitle>✉ Riwayat Kirim Email</PageTitle>
      <p className="mb-3 text-sm text-stone-600">
        200 percobaan terakhir. <b>Tidak dikirim</b> bukan berarti error — sebagian memang
        keputusan yang benar; sebabnya disebut di kolom terakhir. Pengaturan pengirimnya ada di{" "}
        <Link to="/superadmin/email" className="underline hover:text-orange-600">
          Pengaturan Email
        </Link>
        .
      </p>
      <TabelResponsif
        data={sistem.email_percobaan ?? []}
        kunci={(e) => `${e.waktu}|${e.tujuan}|${e.konteks}`}
        kosong="Belum ada percobaan kirim email yang tercatat."
        kolom={[
          {
            judul: "Waktu",
            sel: (e) => (
              <span className="whitespace-nowrap">
                {new Intl.DateTimeFormat("id-ID", {
                  dateStyle: "short",
                  timeStyle: "medium",
                  timeZone: "Asia/Jakarta",
                }).format(new Date(e.waktu))}
              </span>
            ),
          },
          { judul: "Jenis", sel: (e) => <span className="font-mono text-xs">{e.konteks}</span> },
          { judul: "Tujuan", sel: (e) => <span className="break-all">{e.tujuan}</span> },
          {
            judul: "Hasil",
            sel: (e) => (
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                  e.hasil === "terkirim"
                    ? "bg-green-100 text-green-800"
                    : e.hasil === "gagal"
                      ? "bg-red-100 text-red-800"
                      : "bg-stone-200 text-stone-700"
                }`}
              >
                {e.hasil === "terkirim"
                  ? "Terkirim"
                  : e.hasil === "gagal"
                    ? "Gagal"
                    : "Tidak dikirim"}
              </span>
            ),
          },
          {
            judul: "Keterangan",
            sel: (e) =>
              e.hasil === "gagal" ? (
                <span className="break-all text-red-700">{e.pesan ?? "—"}</span>
              ) : e.sebab ? (
                <span className="text-stone-600">{SEBAB[e.sebab] ?? e.sebab}</span>
              ) : (
                /*
                  Untuk yang TERKIRIM, id pesan penyedianya ikut ditampilkan —
                  itu satu-satunya cara mencocokkan baris ini dengan catatan
                  penyedia, tempat nasib sebenarnya surat itu (delivered /
                  bounced / blocked) tercatat.
                */
                <span className="text-stone-500">
                  {e.penyedia ?? "—"}
                  {e.pesan_id && (
                    <span className="ml-1 break-all font-mono text-xs text-stone-400">
                      {e.pesan_id}
                    </span>
                  )}
                </span>
              ),
          },
        ]}
      />
    </div>
  );
}
