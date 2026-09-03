import { useId, useState, type ComponentProps, type ReactNode } from "react";
import type { StokStatus } from "@kakarut/shared";

export function PageTitle({ children, aksi }: { children: ReactNode; aksi?: ReactNode }) {
  // `flex-wrap`: di layar HP judul + tombol aksi tidak muat sebaris, dan tanpa
  // ini tombol paling kanan terpotong di luar layar.
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h1 className="text-2xl font-bold text-stone-800">{children}</h1>
      {aksi}
    </div>
  );
}

export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * KARTU RINGKASAN satu angka: label kecil di atas, angka besar di bawah.
 *
 * Bentuk ini sudah disalin EMPAT kali sebelum berkas ini memilikinya —
 * Dashboard, Laporan, Laporan Pembelian, Kartu Stok — dan salinannya sudah
 * mulai berbeda: dua memakai `text-xl`, satu `text-2xl`, dan baris kecil di
 * bawah angka dinamai `sub` di satu tempat dan `rincian` di tempat lain. Yang
 * kelima (ringkasan nilai stok) yang membuat ini tak lagi bisa dibiarkan:
 * lima kartu yang mestinya seragam di lima halaman tak akan pernah seragam
 * kalau tiap halaman memegang definisinya sendiri.
 *
 * `besar` mempertahankan ukuran angka Dashboard, yang memang berdiri sendiri
 * sebagai layar ringkasan; halaman lain memakai ukuran yang lebih kecil karena
 * kartunya duduk di atas tabel yang jadi isi utamanya.
 */
export function StatCard({
  label,
  value,
  sub,
  warna = "text-stone-800",
  besar = false,
}: {
  label: string;
  value: string;
  /** baris kecil di bawah angka — dari mana angkanya, atau apa yang tak ikut */
  sub?: ReactNode;
  warna?: string;
  besar?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 font-bold ${besar ? "text-2xl" : "text-xl"} ${warna}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </Card>
  );
}

export function StatusBadge({ status }: { status: StokStatus }) {
  const styles: Record<StokStatus, string> = {
    aman: "bg-green-100 text-green-800",
    menipis: "bg-yellow-100 text-yellow-800",
    habis: "bg-red-100 text-red-800",
  };
  const label: Record<StokStatus, string> = {
    aman: "Aman",
    menipis: "Menipis",
    habis: "Habis",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[status]}`}>
      {label[status]}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  lebar = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  lebar?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
      onClick={onClose}
    >
      <div
        className={`w-full ${lebar} max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-800">{title}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700" aria-label="Tutup">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="py-10 text-center text-stone-400">Memuat…</div>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>;
}


/**
 * Pengganti `<Spinner />` untuk tempat yang menunggu SATU bacaan: berputar
 * selagi dimuat, tapi berhenti dan menjelaskan begitu bacaannya gagal.
 *
 * Kenapa ada: pola `{isLoading || !data ? <Spinner /> : …}` tersebar di banyak
 * modal, dan semuanya salah dengan cara yang sama. Di React Query v5 sebuah
 * bacaan yang gagal berakhir dengan `isLoading === false` DAN `data ===
 * undefined` — jadi syaratnya tetap benar dan spinnernya berputar selamanya.
 * Layarnya tak pernah menyebut ada yang salah, dan tak ada apa pun yang bisa
 * ditekan; satu-satunya jalan keluar adalah menutup modalnya dan menebak.
 *
 * `apa` dipakai untuk menamai yang gagal ("Detail opname", "Riwayat meja") —
 * di dalam modal, "gagal dimuat" tanpa subjek tak memberi tahu apa pun tentang
 * apa yang hilang.
 */
export function SpinnerAtauGalat({
  error,
  apa,
  onCoba,
}: {
  error: unknown;
  apa?: string;
  /** Tombol coba-lagi. Wajib diisi di layar yang tak punya jalan keluar lain. */
  onCoba?: () => void;
}) {
  if (!error) return <Spinner />;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-lg bg-red-50 px-3 py-4 text-center text-sm text-red-700">
      <div>
        <b>{apa ?? "Data"} gagal dimuat.</b> {msg}
      </div>
      {onCoba && (
        <button type="button" onClick={onCoba} className={`mt-3 ${btnSecondary}`}>
          Coba lagi
        </button>
      )}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none";
export const btnPrimary =
  "rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50";
export const btnSecondary =
  "rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50";
export const thClass = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
export const tdClass = "px-3 py-2 text-sm text-stone-700";

/**
 * MEDAN PASSWORD DENGAN TOMBOL LIHAT.
 *
 * Password yang tak bisa dilihat adalah satu-satunya isian di aplikasi ini yang
 * pemakainya TAK BISA memeriksa sendiri sebelum menekan kirim. Salah ketik satu
 * huruf, dan yang ia terima "Password salah" (2026-09-03; sebelumnya kalimat
 * netral "Email atau password salah") — kini ia setidaknya tahu yang salah
 * jarinya dan bukan alamatnya, tapi tetap tak tahu huruf yang mana. Di layar
 * sentuh, dengan papan ketik yang menyembunyikan huruf besar, itu terjadi
 * sepanjang hari, dan menebak ulang berkali-kali menabrak `batasLogin`.
 *
 * `type` sengaja TIDAK bisa dioper pemanggil: justru itu yang sedang diatur di
 * sini. Sisa prop `<input>` diteruskan apa adanya — `autoComplete`
 * (`current-password`/`new-password`) penting untuk pengelola password, dan
 * komponen yang diam-diam membuangnya akan merusak sesuatu yang tak kelihatan.
 *
 * Tombolnya `type="button"`: di dalam `<form>`, tombol tanpa `type` adalah
 * SUBMIT — menekan "lihat" akan mengirim formulirnya, dan orang akan menekan
 * "lihat" justru saat ia belum yakin isinya benar.
 */
export function InputPassword({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  const [lihat, setLihat] = useState(false);
  const id = useId();
  return (
    <div className="relative">
      <input
        {...props}
        type={lihat ? "text" : "password"}
        // `pr-10` selalu ditambahkan, bahkan saat pemanggil mengoper kelasnya
        // sendiri: tanpa itu teks yang panjang berjalan ke bawah tombolnya dan
        // tak terbaca — persis pada mode yang gunanya supaya terbaca.
        className={`${className ?? inputClass} pr-10`}
        aria-describedby={id}
      />
      <button
        type="button"
        id={id}
        onClick={() => setLihat((v) => !v)}
        aria-pressed={lihat}
        aria-label={lihat ? "Sembunyikan password" : "Tampilkan password"}
        title={lihat ? "Sembunyikan password" : "Tampilkan password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-stone-400 hover:text-stone-600"
      >
        {lihat ? "🙈" : "👁"}
      </button>
    </div>
  );
}
