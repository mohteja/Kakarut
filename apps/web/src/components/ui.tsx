import type { ReactNode } from "react";
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
