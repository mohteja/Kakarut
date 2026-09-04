import { useEffect, useState } from "react";
import { bacaLokal, tulisLokal } from "../lib/simpanan";

/**
 * SAKELAR BENTUK TAMPILAN — satu rumah untuk "ikon / daftar / tabel".
 *
 * Diekstrak 2026-09-03 saat salinan KETIGA hendak lahir (Permintaan Stok, di
 * samping Menu & HPP dan Resep). Dua salinan yang ada sudah menyimpang, dan
 * menyimpangnya persis pada hal yang membuat sakelar terasa satu produk:
 *
 *   Menu  : `text-xs`, `px-3 py-1`,   tanpa hover, tanpa `type="button"`
 *   Resep : `text-sm`, `px-3 py-1.5`, `hover:bg-stone-50`, `type="button"`
 *
 * Tak satu pun dari perbedaan itu pernah diputuskan siapa pun — keduanya hasil
 * mengetik ulang bentuk yang sama dua kali. Yang ketiga akan menambah varian
 * ketiga.
 *
 * `type="button"` diambil dari versi Resep dan dipakai keduanya, dan itu BUKAN
 * selera: tanpanya sebuah `<button>` di dalam `<form>` bertipe `submit`, jadi
 * mengganti bentuk tampilan ikut mengirim formulirnya. Hari ini tak satu pun
 * sakelar berada di dalam form — tapi yang berikutnya bisa, dan cacat itu tak
 * meninggalkan gejala selain "kenapa halamannya reload".
 *
 * Yang TIDAK dibagi: kata-kata labelnya. Menu & Resep memakai "🔳 Ikon" /
 * "☰ Daftar"; Permintaan Stok memakai "🗂 Kartu" / "☰ Tabel", sebab yang
 * ditawarkan memang bukan hal yang sama — kartu permintaan bukan ikon, dan
 * daftarnya memang tabel. Memaksakan satu kosakata untuk tiga layar akan
 * menamai salah satu dengan kata yang tak dipakai orang di layar itu.
 */
export function SakelarTampilan<T extends string>({
  nilai,
  atur,
  opsi,
  kelas = "",
}: {
  nilai: T;
  atur: (v: T) => void;
  /** Dua tombol; urutannya urutan tampil. */
  opsi: readonly { nilai: T; label: string }[];
  /** Kelas pembungkus tambahan (mis. `ml-auto` untuk mendorong ke kanan). */
  kelas?: string;
}) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-lg border border-stone-300 text-sm ${kelas}`}
    >
      {opsi.map((o) => (
        <button
          key={o.nilai}
          type="button"
          onClick={() => atur(o.nilai)}
          aria-pressed={nilai === o.nilai}
          className={`px-3 py-1.5 font-medium transition ${
            nilai === o.nilai
              ? "bg-orange-600 text-white"
              : "bg-white text-stone-600 hover:bg-stone-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Pilihan bentuk yang BERTAHAN, per perangkat.
 *
 * `localStorage`, bukan profil di server, dan itu disengaja: bentuk tampilan
 * milik LAYAR yang sedang dipakai, bukan milik orangnya. Orang yang sama
 * membuka Kakarut di laptop lebar dan di tablet sempit menginginkan jawaban
 * yang berbeda, dan menyimpannya di server memaksa keduanya sama.
 *
 * `bacaLokal`/`tulisLokal` (`lib/simpanan.ts`), bukan `localStorage` telanjang:
 * keduanya punya salinan bayangan di memori supaya tetap bekerja saat
 * penyimpanan diblokir peramban — dan sakelar yang diam-diam berhenti
 * mengingat adalah cacat yang tak pernah dilaporkan siapa pun.
 *
 * Nilai tersimpan yang TAK DIKENAL jatuh ke `bawaan`, bukan dipakai apa
 * adanya: kunci yang sama bisa memuat nilai dari versi lama halaman itu.
 */
export function useTampilan<T extends string>(
  kunci: string,
  opsi: readonly T[],
  bawaan: T,
): [T, (v: T) => void] {
  const [tampilan, setTampilan] = useState<T>(() => {
    const tersimpan = bacaLokal(kunci);
    return opsi.includes(tersimpan as T) ? (tersimpan as T) : bawaan;
  });
  useEffect(() => {
    tulisLokal(kunci, tampilan);
  }, [kunci, tampilan]);
  return [tampilan, setTampilan];
}
