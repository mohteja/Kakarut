import { useState } from "react";
import type { LaporanHarian } from "@kakarut/shared";
import { Card } from "../../components/ui";
import { formatRupiah } from "../../lib/format";

/**
 * Sebaran transaksi per JAM — dari transaksi pertama sampai terakhir.
 *
 * Yang dijawab grafik ini satu pertanyaan: KAPAN warungnya ramai. Karena itu
 * batangnya CACAH TRANSAKSI, bukan omzet — satu nota Rp 2 juta tidak membuat
 * jam 14 jadi "jam sibuk", dan pemilik yang mengatur jadwal karyawan menghitung
 * orang yang datang, bukan rupiah yang masuk. Omzet per jam tetap ada, tapi di
 * tooltip: ia keterangan, bukan sumbunya.
 *
 * SATU sumbu saja, dan itu disengaja. Menumpuk omzet sebagai sumbu kedua di
 * grafik yang sama membuat dua skala berbeda dibaca seolah sebanding — dua
 * garis yang berpotongan di situ tak berarti apa pun.
 *
 * Batangnya dibangun dari HTML biasa, bukan SVG ber-viewBox: lebarnya ikut
 * kartu induknya di layar mana pun tanpa hitungan koordinat, dan sasaran
 * hover-nya bisa dibuat SEKOLOM PENUH — jauh lebih besar daripada batangnya
 * sendiri, sehingga jam yang sepi (batang setinggi 2px) tetap bisa disentuh.
 */
export function GrafikTransaksiPerJam({ data }: { data: LaporanHarian["per_jam"] }) {
  const [aktif, setAktif] = useState<number | null>(null);

  if (data.length === 0) return null;

  const puncak = Math.max(...data.map((d) => d.jumlah));
  // Semua batang nol (mustahil hari ini — baris hanya lahir dari transaksi —
  // tapi pembagian nol tetap dijaga supaya grafiknya tak jadi NaN bila kelak
  // sumbernya berubah).
  const skala = puncak > 0 ? puncak : 1;
  const iPuncak = data.findIndex((d) => d.jumlah === puncak);
  const totalTransaksi = data.reduce((a, d) => a + d.jumlah, 0);
  const jamTeks = (j: number) => `${String(j).padStart(2, "0")}.00`;

  const d = aktif != null ? data[aktif] : null;

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-lg font-semibold text-stone-700">Transaksi per Jam</h2>
        <p className="text-xs text-stone-400">
          {jamTeks(data[0].jam)}–{jamTeks(data[data.length - 1].jam)} · puncak{" "}
          {puncak} transaksi pukul {jamTeks(data[iPuncak].jam)}
        </p>
      </div>

      {/* `pt-10`: ruang untuk tooltip yang muncul DI ATAS batang. Dengan
          padding biasa ia terpotong tepi kartu — terlihat saat halamannya
          dibuka, bukan saat dikompilasi. */}
      <Card className="px-4 pb-4 pt-10">
        <div className="relative">
          {/* Garis bantu: 0%, 50%, 100% dari puncak. Sengaja tipis dan pucat —
              ia alat ukur, bukan isi grafiknya. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40">
            {[0, 0.5, 1].map((p) => (
              <div
                key={p}
                className="absolute inset-x-0 border-t border-stone-100"
                style={{ top: `${p * 100}%` }}
              />
            ))}
          </div>

          {/* Batangnya. Tiap kolom sasaran hover penuh; batangnya sendiri
              berujung membulat 4px dan menempel ke garis dasar. */}
          <div className="relative flex h-40 items-end gap-[2px]">
            {data.map((row, i) => {
              const tinggi = (row.jumlah / skala) * 100;
              const disorot = aktif === i;
              return (
                <button
                  key={row.jam}
                  type="button"
                  onMouseEnter={() => setAktif(i)}
                  onMouseLeave={() => setAktif(null)}
                  onFocus={() => setAktif(i)}
                  onBlur={() => setAktif(null)}
                  aria-label={`Pukul ${jamTeks(row.jam)}: ${row.jumlah} transaksi, omzet ${formatRupiah(row.omzet)}`}
                  className="group flex h-full flex-1 cursor-default items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                >
                  <div
                    className={`w-full rounded-t transition-colors ${
                      row.jumlah === 0
                        ? "bg-stone-200"
                        : disorot
                          ? "bg-orange-700"
                          : "bg-orange-600"
                    }`}
                    // Jam KOSONG tetap digambar setinggi 2px. Batang nol yang
                    // benar-benar nol tak bisa dibedakan dari "tak ada
                    // datanya"; garis tipis ini mengatakan "kami buka, tak ada
                    // yang membeli" — dan itu keterangan yang berbeda.
                    style={{ height: row.jumlah === 0 ? 2 : `max(${tinggi}%, 3px)` }}
                  />
                </button>
              );
            })}
          </div>

          {/* TIDAK ada angka melayang di atas batang puncak.
              Percobaan pertama memasangnya di situ, dan saat halamannya dibuka
              angka itu bertabrakan dengan tooltip DAN terpotong tepi kartu —
              persis kelas cacat yang tak bisa dilihat typechecker maupun
              pemeriksa warna. Puncaknya sudah disebut di judul ("puncak 95
              transaksi pukul 19.00"), jadi label melayangnya bukan cuma
              bertabrakan, ia juga mengulang. */}

          {/* Tooltip: menyusul batang yang disentuh, dijepit supaya tak keluar
              kartu di batang paling kiri/kanan. */}
          {d && (
            <div
              className={`pointer-events-none absolute top-0 z-10 -translate-y-full whitespace-nowrap rounded-lg bg-stone-800 px-2.5 py-1.5 text-xs text-white shadow-lg ${
                aktif! / data.length < 0.15
                  ? "translate-x-0"
                  : aktif! / data.length > 0.85
                    ? "-translate-x-full"
                    : "-translate-x-1/2"
              }`}
              style={{
                left:
                  aktif! / data.length < 0.15
                    ? 0
                    : aktif! / data.length > 0.85
                      ? "100%"
                      : `${((aktif! + 0.5) / data.length) * 100}%`,
              }}
            >
              <div className="font-semibold">Pukul {jamTeks(d.jam)}</div>
              <div className="text-stone-300">
                {d.jumlah} transaksi · {formatRupiah(d.omzet)}
              </div>
            </div>
          )}
        </div>

        {/* Sumbu jam. Pada rentang panjang labelnya diselang-seling supaya tak
            saling tindih — batangnya tetap semua, yang dijarangkan tulisannya. */}
        <div aria-hidden className="mt-1.5 flex gap-[2px]">
          {data.map((row, i) => (
            <div key={row.jam} className="flex-1 text-center text-[10px] text-stone-400">
              {data.length <= 12 || i % 2 === 0 ? String(row.jam).padStart(2, "0") : ""}
            </div>
          ))}
        </div>
      </Card>

      {/* Rupa TABEL dari data yang sama, untuk pembaca layar dan siapa pun yang
          butuh angkanya persis. Grafik yang hanya bisa dibaca dengan mata
          menyembunyikan datanya dari sebagian orang yang justru harus
          memakainya. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-700">
          Lihat angkanya
        </summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">
            Transaksi per jam, {jamTeks(data[0].jam)} sampai {jamTeks(data[data.length - 1].jam)}
          </caption>
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-stone-500">Jam</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold text-stone-500">
                Transaksi
              </th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold text-stone-500">Omzet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.map((row) => (
              <tr key={row.jam}>
                <td className="px-3 py-1.5">{jamTeks(row.jam)}</td>
                <td className="px-3 py-1.5 text-right">{row.jumlah}</td>
                <td className="px-3 py-1.5 text-right">{formatRupiah(row.omzet)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-stone-200">
            <tr className="font-semibold">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-3 py-1.5 text-right">{totalTransaksi}</td>
              <td className="px-3 py-1.5 text-right">
                {formatRupiah(data.reduce((a, r) => a + r.omzet, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </details>
    </div>
  );
}
