import { isValidElement, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { thClass, tdClass } from "./ui";

/**
 * Peran sebuah kolom ketika layar sempit (< `sm`), tempat tabel berubah jadi
 * satu kartu per baris:
 *
 * - `"judul"` — jadi judul kartu, tanpa label.
 * - `"sub"`   — teks kecil di bawah judul (mis. kode/badge), tanpa label.
 * - `"aksi"`  — masuk ke baris tombol di dasar kartu, tanpa label.
 * - `"pilih"` — kendali pilih (checkbox) di kiri judul, tanpa label.
 * - `"lewat"` — tidak ditampilkan di kartu. Untuk kolom sekunder yang hanya
 *   masuk akal saat semua kolom terlihat berdampingan; membiarkannya akan
 *   membuat kartu jadi daftar panjang yang tidak terbaca.
 *
 * Tanpa `hp`, kolom dirender sebagai pasangan label/nilai di grid dua kolom.
 */
export type PeranHp = "judul" | "sub" | "aksi" | "pilih" | "lewat";

export interface KolomTabel<T> {
  /** Judul kolom di tabel desktop; dipakai juga sebagai label di kartu HP. */
  judul?: ReactNode;
  sel: (baris: T, indeks: number) => ReactNode;
  /** Rata kanan di tabel desktop (kolom angka). Tidak berlaku di kartu HP. */
  kanan?: boolean;
  /** Kelas tambahan untuk `<td>` desktop. */
  kelasSel?: string;
  /** Kelas tambahan untuk `<th>` desktop. */
  kelasJudul?: string;
  hp?: PeranHp;
}

/**
 * Teks datar sebuah sel bila isinya memang cuma teks — termasuk yang dibungkus
 * satu elemen, mis. `<span className="text-stone-300">—</span>`.
 */
function teksDatar(v: ReactNode): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (isValidElement(v)) {
    const isi = (v.props as { children?: ReactNode }).children;
    if (typeof isi === "string" || typeof isi === "number") return String(isi);
  }
  return null;
}

/**
 * Nilai yang tidak perlu memakan baris di kartu HP. Selain nilai kosong,
 * placeholder "tidak ada data" (`—`) juga dilewati: di tabel desktop tanda itu
 * perlu supaya kolomnya tidak kelihatan bolong, tapi di kartu barisnya cukup
 * dihilangkan — kalau tidak, kartu jadi daftar panjang berisi tanda hubung.
 */
function kosongDiHp(v: ReactNode): boolean {
  if (v === null || v === undefined || v === false || v === "") return true;
  const t = teksDatar(v)?.trim();
  return t === "" || t === "—" || t === "-";
}

/**
 * Tabel yang tidak menyembunyikan apa pun di layar HP.
 *
 * Tabel banyak kolom di dalam `overflow-x-auto` terlihat wajar di desktop tapi
 * menyesatkan di HP: halaman tidak ikut melebar, jadi tidak ada petunjuk bahwa
 * tabel masih bisa digeser — kolom paling kanan (biasanya tombol aksi) seolah
 * tidak ada. Karena itu di bawah `sm` setiap baris dirender sebagai kartu, dan
 * tabel semula baru dipakai dari `sm` ke atas.
 *
 * Kedua tampilan memakai definisi kolom yang sama, jadi keduanya tidak bisa
 * menyimpang. `sel` sengaja berupa fungsi yang mengembalikan JSX (bukan
 * komponen) supaya input di dalam sel tidak di-remount setiap render.
 */
export function TabelResponsif<T>({
  kolom,
  data,
  kunci,
  kosong = "Belum ada data.",
  galat,
  kelasBaris,
  minLebar,
  judulKartu,
  onKlikBaris,
}: {
  kolom: KolomTabel<T>[];
  data: T[];
  kunci: (baris: T, indeks: number) => string;
  kosong?: ReactNode;
  /**
   * Galat pemuatan daftar ini, bila ada — biasanya `error` dari `useQuery`.
   *
   * GAGAL MEMUAT ≠ TIDAK ADA. Saat pemuatan gagal, `data` yang di-fallback ke
   * `[]` membuat tabel ini menampilkan `kosong` — sebuah PERNYATAAN ("Belum
   * ada supplier", "Belum ada karyawan") yang tidak pernah diperiksa
   * kebenarannya. Itu lebih buruk daripada layar kosong: pesannya mengajak
   * menambah data yang mungkin sudah ada, dan duplikatnya baru ketahuan jauh
   * kemudian. Diberi `galat`, tabel mengaku tidak tahu.
   */
  galat?: unknown;
  /** Kelas tambahan per baris/kartu (mis. penanda terpilih). */
  kelasBaris?: (baris: T) => string;
  /** `min-width` tabel desktop, mis. `"min-w-[60rem]"`. */
  minLebar?: string;
  /** Header di atas daftar kartu HP (mis. kendali "pilih semua"). */
  judulKartu?: ReactNode;
  /**
   * Klik satu baris (tabel desktop) / kartu (HP) — mis. membuka detail.
   *
   * Dipasang di KEDUA tampilan lewat `propsKlik`: daftar yang bisa dibuka di
   * laptop tak boleh jadi daftar yang cuma bisa dipandang di HP. Klik yang
   * berasal dari kendali di dalam sel (tombol/tautan/input) tidak ikut membuka
   * baris; Enter/Spasi pada baris yang fokus membukanya juga.
   */
  onKlikBaris?: (baris: T, indeks: number) => void;
}) {
  const propsKlik = (baris: T, i: number) =>
    onKlikBaris
      ? {
          tabIndex: 0,
          onClick: (e: MouseEvent<HTMLElement>) => {
            if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
            onKlikBaris(baris, i);
          },
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onKlikBaris(baris, i);
            }
          },
        }
      : {};
  const kelasKlik = onKlikBaris
    ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
    : "";
  const kPilih = kolom.filter((k) => k.hp === "pilih");
  const kJudul = kolom.filter((k) => k.hp === "judul");
  const kSub = kolom.filter((k) => k.hp === "sub");
  const kAksi = kolom.filter((k) => k.hp === "aksi");
  const kPasangan = kolom.filter((k) => !k.hp);

  /**
   * Isi sel kosong: pengakuan saat gagal memuat, klaim `kosong` hanya saat
   * daftarnya memang terbaca dan memang nihil. Satu tempat untuk kedua
   * tampilan (kartu HP & tabel desktop) supaya keduanya tak bisa berselisih.
   */
  const isiKosong = galat ? (
    <>
      <div className="font-medium text-red-700">Daftar ini gagal dimuat.</div>
      <div className="mt-1 text-stone-500">
        {galat instanceof Error ? galat.message : String(galat)}
      </div>
      <div className="mt-1 text-stone-500">
        Kosongnya <b>bukan</b> berarti datanya tidak ada — muat ulang dulu sebelum menambah
        yang baru.
      </div>
    </>
  ) : (
    kosong
  );

  return (
    <>
      {/* HP: satu kartu per baris — tak ada kolom yang jatuh di luar layar */}
      <div className="space-y-3 sm:hidden">
        {judulKartu}
        {data.length === 0 ? (
          <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-400 shadow-sm">
            {isiKosong}
          </div>
        ) : (
          data.map((baris, i) => {
            const pasangan = kPasangan
              .map((k) => ({ k, v: k.sel(baris, i) }))
              .filter(({ v }) => !kosongDiHp(v));
            return (
              <div
                key={kunci(baris, i)}
                className={`rounded-xl border border-stone-200 bg-white p-3 shadow-sm ${
                  kelasBaris?.(baris) ?? ""
                } ${kelasKlik}`}
                {...propsKlik(baris, i)}
              >
                {(kPilih.length > 0 || kJudul.length > 0 || kSub.length > 0) && (
                  <div className="flex items-start gap-2">
                    {kPilih.map((k, j) => (
                      <div key={j} className="pt-0.5">
                        {k.sel(baris, i)}
                      </div>
                    ))}
                    <div className="min-w-0 flex-1">
                      {kJudul.map((k, j) => (
                        <div key={j} className="font-semibold text-stone-800">
                          {k.sel(baris, i)}
                        </div>
                      ))}
                      {kSub.map((k, j) => (
                        <div key={j} className="mt-0.5 text-xs text-stone-500">
                          {k.sel(baris, i)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pasangan.length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                    {pasangan.map(({ k, v }, j) => (
                      <div key={j} className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-stone-400">
                          {k.judul}
                        </dt>
                        <dd className="text-sm text-stone-700">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {kAksi.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                    {kAksi.map((k, j) => (
                      <div key={j} className="contents">
                        {k.sel(baris, i)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop: tabel seperti semula */}
      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm sm:block">
        <table className={`w-full ${minLebar ?? ""}`}>
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              {kolom.map((k, j) => (
                <th
                  key={j}
                  className={`${thClass} ${k.kanan ? "text-right" : ""} ${k.kelasJudul ?? ""}`}
                >
                  {k.judul}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.length === 0 ? (
              <tr>
                <td colSpan={kolom.length} className="py-8 text-center text-sm text-stone-400">
                  {isiKosong}
                </td>
              </tr>
            ) : (
              data.map((baris, i) => (
                <tr
                  key={kunci(baris, i)}
                  className={`${kelasBaris?.(baris) ?? "hover:bg-stone-50"} ${kelasKlik}`}
                  {...propsKlik(baris, i)}
                >
                  {kolom.map((k, j) => (
                    <td
                      key={j}
                      className={`${tdClass} ${k.kanan ? "text-right" : ""} ${k.kelasSel ?? ""}`}
                    >
                      {k.sel(baris, i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
