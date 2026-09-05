import type { OpnamePerlengkapanSesiRow, OpnameSesiRow } from "@kakarut/shared";
import type { KolomTabel } from "../../components/TabelResponsif";
import { formatTanggalRingkas, formatWaktu } from "../../lib/format";

/**
 * KOLOM tabel riwayat Stock Opname — bahan baku & perlengkapan.
 *
 * Rumahnya terpisah dari halamannya, meniru `kolomBeliPerlengkapan` dan
 * `kolomPermintaan`: urutan & isi kolomnya dipaku penjaga statis, dan penjaga
 * yang harus mencari daftar kolom di tengah komponen 600 baris adalah penjaga
 * yang pelan-pelan berhenti melihat.
 *
 * TANGGAL DAN JAM BERDIRI DI KOLOM SENDIRI-SENDIRI (keputusan pemilik). Bukan
 * cuma soal selera: sebelum putaran ini halaman ini merender `formatWaktu`
 * TELANJANG — jam dan menit saja, tanpa sehari pun tanggal. Setiap sesi dari
 * setiap hari karena itu terbaca sama ("14.32"), di halaman yang justru ada
 * untuk menelusuri opname LAMA. Aplikasi ponsel sudah menyebut tanggalnya
 * (`formatWaktu` di sana memulangkan `dd/MM HH.mm`); yang diam hanya web.
 */

/** Sel Tanggal — dipakai kedua tab supaya keduanya tak bisa menyimpang. */
function selTanggal(waktu: string) {
  return <span className="whitespace-nowrap tabular-nums">{formatTanggalRingkas(waktu)}</span>;
}

/** Sel Jam — dipakai kedua tab. */
function selJam(waktu: string) {
  return <span className="whitespace-nowrap tabular-nums text-stone-500">{formatWaktu(waktu)}</span>;
}

/** Sel Nomor (SO-0001 / OP-0001) — mono, dan mengaku saat sesinya tak bernomor. */
function selNomor(nomor: string | null) {
  return nomor ? (
    <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
      {nomor}
    </span>
  ) : (
    <span className="text-stone-300">—</span>
  );
}

export function kolomOpnameBahan(
  badge: (baris: OpnameSesiRow) => React.ReactNode,
): KolomTabel<OpnameSesiRow>[] {
  return [
    {
      judul: "Nomor",
      sel: (r) => selNomor(r.nomor),
      hp: "sub",
      kelasJudul: "w-28",
    },
    {
      judul: "Tanggal",
      sel: (r) => selTanggal(r.waktu),
      hp: "judul",
      kelasJudul: "w-32",
    },
    {
      judul: "Jam",
      sel: (r) => selJam(r.waktu),
      kelasJudul: "w-16",
    },
    {
      judul: "Oleh",
      sel: (r) => r.oleh ?? <span className="text-stone-300">—</span>,
    },
    {
      judul: "Item",
      sel: (r) => (
        <span className="tabular-nums">
          {r.jumlah_item}
          {r.jumlah_selisih > 0 && (
            <span className="ml-1 text-amber-700">({r.jumlah_selisih} selisih)</span>
          )}
        </span>
      ),
      kanan: true,
      kelasJudul: "w-32",
    },
    {
      /* Catatan hanya ada di sisi bahan baku. Di kartu HP ia DILEWAT: ia satu
         medan bebas yang bisa sepanjang apa pun, dan kartu yang memuatnya utuh
         berhenti terbaca sebagai ringkasan. Tabel desktop tetap memuatnya. */
      judul: "Catatan",
      sel: (r) =>
        r.catatan ? (
          <span className="text-stone-500">{r.catatan}</span>
        ) : (
          <span className="text-stone-300">—</span>
        ),
      hp: "lewat",
    },
    {
      judul: "Status",
      sel: (r) => badge(r),
      kelasJudul: "w-44",
    },
  ];
}

export function kolomOpnamePerlengkapan(
  badge: (baris: OpnamePerlengkapanSesiRow) => React.ReactNode,
): KolomTabel<OpnamePerlengkapanSesiRow>[] {
  return [
    {
      judul: "Nomor",
      sel: (r) => selNomor(r.nomor),
      hp: "sub",
      kelasJudul: "w-28",
    },
    {
      judul: "Tanggal",
      sel: (r) => selTanggal(r.waktu),
      hp: "judul",
      kelasJudul: "w-32",
    },
    {
      judul: "Jam",
      sel: (r) => selJam(r.waktu),
      kelasJudul: "w-16",
    },
    {
      judul: "Oleh",
      sel: (r) => r.oleh ?? <span className="text-stone-300">—</span>,
    },
    {
      /* Sisi perlengkapan HANYA mencatat baris berselisih — `jumlah_item` di
         sini berarti "berapa perlengkapan yang selisih", bukan "berapa yang
         dihitung". Kepalanya karena itu berbunyi "Selisih", bukan "Item":
         judul yang sama untuk arti yang berbeda adalah cara tercepat membuat
         dua tab berdampingan saling membantah. */
      judul: "Selisih",
      sel: (r) => <span className="tabular-nums">{r.jumlah_item}</span>,
      kanan: true,
      kelasJudul: "w-24",
    },
    {
      judul: "Status",
      sel: (r) => badge(r),
      kelasJudul: "w-44",
    },
  ];
}
