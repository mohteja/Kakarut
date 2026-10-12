import { useId } from "react";
import { useSearchParams } from "react-router-dom";
import { inputClass } from "../../components/ui";
import { hariIniWIB } from "../../lib/format";
import { PERIODE, bacaPeriodeUrl, tulisPeriodeUrl, type KodePeriode, type Rentang } from "../../lib/periode";

/**
 * Periode laporan yang tinggal di URL (lihat `bacaPeriodeUrl`), sehingga
 * keempat tab membaca SATU periode yang sama: `LaporanTabs` membawa kuncinya
 * ke tab lain, dan muat ulang tak mengembalikannya ke hari ini.
 *
 * `replace`, bukan entri riwayat baru: mengganti periode lima kali lalu
 * menekan Kembali seharusnya keluar dari laporan, bukan memutar ulang kelima
 * periode itu satu per satu.
 */
export function usePeriodeLaporan() {
  const [params, setParams] = useSearchParams();
  const { dari, sampai, kode } = bacaPeriodeUrl(params, hariIniWIB());
  return {
    dari,
    sampai,
    /** Periode bernama yang sedang tampil; `null` = rentang pilihan tangan. */
    kode,
    pilih: (k: KodePeriode) => setParams((p) => tulisPeriodeUrl(p, { kode: k }), { replace: true }),
    ubah: (r: Rentang) => setParams((p) => tulisPeriodeUrl(p, { rentang: r }), { replace: true }),
  };
}

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
export function PilihPeriode({ periode }: { periode: ReturnType<typeof usePeriodeLaporan> }) {
  const id = useId();
  const { dari, sampai, kode, pilih, ubah } = periode;

  return (
    <>
      <div>
        <label htmlFor={`${id}-periode`} className="mb-1 block text-xs font-medium text-stone-500">
          Periode
        </label>
        <select
          id={`${id}-periode`}
          value={kode ?? ""}
          onChange={(e) => {
            if (e.target.value) pilih(e.target.value as KodePeriode);
          }}
          className={inputClass}
        >
          {kode === null && <option value="">Pilih tanggal</option>}
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
          onChange={(e) => ubah({ dari: e.target.value, sampai })}
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
          onChange={(e) => ubah({ dari, sampai: e.target.value })}
          className={inputClass}
        />
      </div>
    </>
  );
}
