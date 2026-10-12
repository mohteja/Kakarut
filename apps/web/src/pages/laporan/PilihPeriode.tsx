import { useId, useState } from "react";
import { inputClass } from "../../components/ui";
import { hariIniWIB } from "../../lib/format";
import { PERIODE, periodeDari, rentangPeriode, type KodePeriode, type Rentang } from "../../lib/periode";

/**
 * Pemilih periode laporan: dropdown periode cepat + dua input tanggal.
 *
 * Input tanggalnya TETAP ada, bukan disembunyikan di balik "Pilih tanggal…":
 * memilih "Bulan lalu" langsung memperlihatkan tanggal berapa sampai berapa
 * yang dimaksud, dan menggeser satu tanggal tetap satu klik. Mengubah tanggal
 * tangan membuat dropdown berbunyi "Pilih tanggal" — rentangnya bukan lagi
 * periode bernama, dan dropdown yang tetap berkata "Bulan ini" akan berbohong.
 *
 * Dirender sebagai fragmen: ketiga medannya duduk berdampingan dengan pemilih
 * cabang di dalam kartu filter milik halaman pemakainya.
 */
export function PilihPeriode({
  dari,
  sampai,
  onUbah,
}: {
  dari: string;
  sampai: string;
  onUbah: (r: Rentang) => void;
}) {
  const id = useId();
  const [dipilih, setDipilih] = useState<KodePeriode | null>(null);
  const hariIni = hariIniWIB();
  const aktif = periodeDari({ dari, sampai }, hariIni, dipilih);

  return (
    <>
      <div>
        <label htmlFor={`${id}-periode`} className="mb-1 block text-xs font-medium text-stone-500">
          Periode
        </label>
        <select
          id={`${id}-periode`}
          value={aktif ?? ""}
          onChange={(e) => {
            const kode = e.target.value as KodePeriode | "";
            if (!kode) return;
            setDipilih(kode);
            onUbah(rentangPeriode(kode, hariIni));
          }}
          className={inputClass}
        >
          {aktif === null && <option value="">Pilih tanggal</option>}
          {PERIODE.map((p) => (
            <option key={p.kode} value={p.kode}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-dari`} className="mb-1 block text-xs font-medium text-stone-500">
          Dari tanggal
        </label>
        <input
          id={`${id}-dari`}
          type="date"
          value={dari}
          max={sampai}
          onChange={(e) => onUbah({ dari: e.target.value, sampai })}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-sampai`} className="mb-1 block text-xs font-medium text-stone-500">
          Sampai tanggal
        </label>
        <input
          id={`${id}-sampai`}
          type="date"
          value={sampai}
          min={dari}
          onChange={(e) => onUbah({ dari, sampai: e.target.value })}
          className={inputClass}
        />
      </div>
    </>
  );
}
