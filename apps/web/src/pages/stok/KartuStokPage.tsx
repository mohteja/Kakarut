import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { KartuStokDto, MutasiJenis } from "@kakarut/shared";
import { Card, PageTitle, Spinner, StatCard, inputClass, tdClass, thClass } from "../../components/ui";
import { api } from "../../lib/api";
import {
  formatAngka,
  formatTanggal,
  hariIniWIB,
  labelTahapPembelian,
  labelTahapProduksi,
} from "../../lib/format";

const JENIS_BADGE: Record<MutasiJenis, { label: string; cls: string }> = {
  opname: { label: "Opname", cls: "bg-blue-100 text-blue-800" },
  beli: { label: "Pembelian", cls: "bg-teal-100 text-teal-800" },
  produksi: { label: "Produksi", cls: "bg-orange-100 text-orange-800" },
  penjualan: { label: "Penjualan", cls: "bg-red-100 text-red-700" },
  // bahan mentah terpakai resep saat produksi selesai (mutasi keluar)
  pemakaian: { label: "Pemakaian produksi", cls: "bg-amber-100 text-amber-800" },
  // stok dipindah ke cabang lain & sudah diterima (mutasi keluar)
  kirim: { label: "Kirim keluar", cls: "bg-purple-100 text-purple-800" },
};

function tanggal30HariLalu(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date(Date.now() - 29 * 24 * 3600 * 1000),
  );
}

/**
 * Kartu stok: buku besar mutasi satu bahan — halaman terpisah dengan URL
 * sendiri (dibuka dari tombol "Kartu" di halaman Stok, bisa di tab lain).
 */
export function KartuStokPage() {
  const { ingredientId } = useParams();
  const [searchParams] = useSearchParams();
  const branchId = searchParams.get("branch_id");
  const [dari, setDari] = useState(tanggal30HariLalu());
  const [sampai, setSampai] = useState(hariIniWIB());

  const { data: kartu, isLoading, error } = useQuery({
    queryKey: ["kartu-stok", ingredientId, branchId, dari, sampai],
    queryFn: () =>
      api<KartuStokDto>(
        `/stok/kartu/${ingredientId}?dari=${dari}&sampai=${sampai}${branchId ? `&branch_id=${branchId}` : ""}`,
      ),
    enabled: Boolean(ingredientId),
  });

  /**
   * Pemilih tanggal TIDAK ikut hilang saat memuat/gagal.
   *
   * `dari`/`sampai` ada di dalam `queryKey`, jadi tiap perubahan tanggal
   * membuat query pending lagi. Kalau spinner/pesan galat menggantikan seluruh
   * halaman (termasuk baris judul yang MEMUAT kedua input ini), input-nya
   * ter-unmount di tengah pengguna menyetel tanggal: fokus lepas, pemilih
   * tanggal ponsel tertutup, dan untuk menyetel rentang dua sisi orang harus
   * menunggu satu putaran jaringan lalu mencari kembali input keduanya. Pada
   * galat, halaman bahkan jadi jalan buntu — tak ada lagi kontrol untuk
   * memperbaiki rentangnya. Sama seperti Laporan/Laporan Pembelian/Menu
   * Terlaris: kontrol selalu terpasang, status muat hanya membungkus isinya.
   */
  const pemilihTanggal = (
    // w-full di HP: dua input tanggal + "s/d" tidak muat di sisa baris
    // judul, dan tanpa ini input "sampai" jatuh di luar layar
    <div className="flex w-full items-center gap-2 print:hidden sm:w-auto">
      <input
        type="date"
        value={dari}
        // Rentang terbalik (dari > sampai) bukan cuma kosong: jendelanya
        // negatif, sehingga `saldo_akhir` jatuh di bawah `saldo_awal` tanpa
        // satu pun mutasi — dan kartu ringkasan MENGARANG "disetel Stok Awal
        // −N" untuk penyesuaian yang tak pernah ada. Dijaga di input, persis
        // seperti halaman laporan lain.
        max={sampai}
        onChange={(e) => setDari(e.target.value)}
        className={inputClass}
        aria-label="Dari tanggal"
      />
      <span className="text-stone-400">s/d</span>
      <input
        type="date"
        value={sampai}
        min={dari}
        onChange={(e) => setSampai(e.target.value)}
        className={inputClass}
        aria-label="Sampai tanggal"
      />
    </div>
  );

  return (
    <div className="max-w-4xl">
      <PageTitle aksi={pemilihTanggal}>
        Kartu Stok{kartu ? ` — ${kartu.bahan.nama}` : ""}
      </PageTitle>
      {isLoading ? (
        <Spinner />
      ) : error || !kartu ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error instanceof Error ? error.message : "Kartu stok tidak dapat dimuat"}
        </div>
      ) : (
        <IsiKartu kartu={kartu} />
      )}
    </div>
  );
}

/** Ringkasan + buku besar mutasi satu periode. Dipisah supaya `kartu` di sini
 *  dijamin ada dan pemilih tanggal di induknya tetap terpasang saat memuat. */
function IsiKartu({ kartu }: { kartu: KartuStokDto }) {
  const fmt = (n: number) => `${formatAngka(n)} ${kartu.bahan.satuan}`;

  /**
   * EFEK STOK AWAL (opname) pada periode ini.
   *
   * Opname MENYETEL ULANG saldo, bukan menambah barang, jadi ia sengaja tak
   * masuk `total_masuk`/`total_keluar`. Akibatnya identitas biasa
   * `awal + masuk − keluar = akhir` TIDAK berlaku bila ada opname; selisihnya
   * persis sebesar efek penyetelan itu. Diturunkan dari keempat angka yang
   * sudah dikirim server (bukan dijumlah ulang dari baris mutasi) supaya tetap
   * benar berapa pun jumlah opname di periode itu dan di mana pun letaknya.
   */
  const dasarOpname = Math.round(
    (kartu.saldo_akhir - (kartu.saldo_awal + kartu.total_masuk - kartu.total_keluar)) * 1e6,
  ) / 1e6;
  /** titik tolak EFEKTIF — angka yang membuat penjumlahan di layar ketemu */
  const dasarAwal = kartu.saldo_awal + dasarOpname;

  /**
   * Rentang terbalik: penurunan itu SELISIH PERIODE, bukan penyetelan.
   *
   * Turunan `dasarOpname` di atas hanya sah bila jendelanya maju. Saat
   * `dari > sampai` jendelanya negatif — tak ada mutasi yang tercakup, jadi
   * `total_masuk`/`total_keluar` nol sementara `saldo_akhir` (posisi tanggal
   * lebih awal) berada di bawah `saldo_awal` (posisi tanggal lebih akhir).
   * Rumusnya lalu menyerap seluruh beda itu dan kartu ringkasan MENGARANG
   * "disetel Stok Awal −N" untuk penyesuaian yang tak pernah ada — persis
   * jenis angka mengada-ada yang membuat orang berhenti percaya halaman ini.
   * Pemilih tanggalnya sudah dijaga `min`/`max`, tapi rentang juga bisa datang
   * dari URL yang disunting tangan (halaman ini memang dibuka lewat tautan
   * ber-query), jadi angkanya dijaga sendiri, bukan hanya input-nya.
   */
  const rentangTerbalik = kartu.periode.dari > kartu.periode.sampai;
  const adaSetelan = !rentangTerbalik && dasarOpname !== 0;

  return (
    <>
      <div className="mb-4 text-sm text-stone-500">
        {formatTanggal(kartu.periode.dari)} — {formatTanggal(kartu.periode.sampai)}
      </div>

      {rentangTerbalik && (
        <div className="mb-4 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          Tanggal <b>dari</b> melewati tanggal <b>sampai</b>, jadi periodenya kosong — angka
          ringkasan di bawah tidak bisa dijumlahkan. Tukar kedua tanggalnya.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* SALDO AWAL DIGABUNG DENGAN STOK AWAL.
         *
         * Stok Awal (opname) MENYETEL ULANG saldo — ia bukan barang masuk, jadi
         * tak ikut "Total Masuk". Dulu efeknya tak tampil di ringkasan sama
         * sekali, sehingga penjumlahan di layar tidak pernah ketemu: orang
         * membaca 0 + 125 − 134 lalu mengharapkan −9, padahal tertulis 91.
         * Angka yang tampak salah membuat SELURUH halaman kehilangan
         * kepercayaan, walau tiap barisnya benar.
         *
         * Yang ditampilkan sekarang adalah titik tolak EFEKTIF-nya, dan
         * dijabarkan di baris kecil supaya bisa dicocokkan sendiri:
         *   titik tolak + total masuk − total keluar = saldo akhir. */}
        <StatCard
          label={adaSetelan ? "Saldo Awal + Stok Awal" : "Saldo Awal"}
          value={fmt(adaSetelan ? dasarAwal : kartu.saldo_awal)}
          sub={
            adaSetelan
              ? `${fmt(kartu.saldo_awal)} lalu disetel Stok Awal ${dasarOpname > 0 ? "+" : "−"}${fmt(Math.abs(dasarOpname))}`
              : undefined
          }
        />
        <StatCard label="Total Masuk" value={`+${fmt(kartu.total_masuk)}`} warna="text-green-600" />
        <StatCard label="Total Keluar" value={`−${fmt(kartu.total_keluar)}`} warna="text-red-600" />
        <StatCard label="Saldo Akhir" value={fmt(kartu.saldo_akhir)} warna="text-orange-600" />
      </div>

      {kartu.produksi_berjalan && (
        <div className="mb-3 rounded-lg bg-orange-50 px-4 py-2 text-sm text-orange-800">
          🏭 Sedang diproduksi:{" "}
          <b>
            +{formatAngka(kartu.produksi_berjalan.qty)} {kartu.bahan.satuan}
          </b>{" "}
          ({labelTahapProduksi(kartu.produksi_berjalan)}) — belum masuk saldo; bertambah
          setelah "Konfirmasi Ada".
          <span className="ml-1 text-xs">
            Rincian: 📋 {formatAngka(kartu.produksi_berjalan.rencana)} · 🔨{" "}
            {formatAngka(kartu.produksi_berjalan.dikerjakan)} · ✅{" "}
            {formatAngka(kartu.produksi_berjalan.menunggu)}
          </span>
        </div>
      )}

      {kartu.pembelian_berjalan && (
        <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
          🛒 Sedang dibeli:{" "}
          <b>
            +{formatAngka(kartu.pembelian_berjalan.qty)} {kartu.bahan.satuan}
          </b>{" "}
          ({labelTahapPembelian(kartu.pembelian_berjalan)}) — belum masuk saldo; bertambah
          setelah barang diterima.
          <span className="ml-1 text-xs">
            Rincian: 📋 {formatAngka(kartu.pembelian_berjalan.rencana)} · 🔄{" "}
            {formatAngka(kartu.pembelian_berjalan.dikerjakan)} · 🚚{" "}
            {formatAngka(kartu.pembelian_berjalan.menunggu)}
          </span>
        </div>
      )}

      {kartu.terpotong && (
        <div className="mb-3 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          Mutasi melebihi 500 baris — persempit rentang tanggal untuk melihat semuanya.
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Waktu</th>
              <th className={thClass}>Jenis</th>
              <th className={thClass}>Keterangan</th>
              <th className={`${thClass} text-right`}>Masuk</th>
              <th className={`${thClass} text-right`}>Keluar</th>
              <th className={`${thClass} text-right`}>Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <tr className="bg-stone-50/60">
              <td className={tdClass} colSpan={5}>
                <span className="font-medium text-stone-500">Saldo awal periode</span>
              </td>
              <td className={`${tdClass} text-right font-bold`}>{formatAngka(kartu.saldo_awal)}</td>
            </tr>
            {kartu.mutasi.map((m, i) => {
              const badge = JENIS_BADGE[m.jenis];
              return (
                <tr key={i} className="hover:bg-stone-50">
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {new Intl.DateTimeFormat("id-ID", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    }).format(new Date(m.waktu))}
                  </td>
                  <td className={tdClass}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className={`${tdClass} max-w-72 truncate text-stone-500`} title={m.keterangan ?? ""}>
                    {m.keterangan ?? "—"}
                  </td>
                  <td className={`${tdClass} text-right text-green-700`}>
                    {m.masuk != null ? `+${formatAngka(m.masuk)}` : ""}
                    {m.jenis === "opname" && (
                      <span className="text-xs text-blue-600">reset → {formatAngka(m.saldo)}</span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right text-red-600`}>
                    {m.keluar != null ? `−${formatAngka(m.keluar)}` : ""}
                  </td>
                  <td className={`${tdClass} text-right font-bold`}>{formatAngka(m.saldo)}</td>
                </tr>
              );
            })}
            {kartu.mutasi.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-stone-400">
                  Tidak ada mutasi pada periode ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
