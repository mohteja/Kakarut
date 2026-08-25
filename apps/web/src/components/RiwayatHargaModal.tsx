import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RiwayatHargaDto } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
import { api } from "../lib/api";
import { formatAngka, formatRupiah, formatTanggal } from "../lib/format";
import { ErrorText, Modal, Spinner, SpinnerAtauGalat, btnPrimary, btnSecondary, inputClass } from "./ui";

/**
 * Isi kartu RIWAYAT HARGA satu barang (bahan baku / perlengkapan): daftar lot
 * pembelian + statistik terendah/tertinggi (berapa & kapan) + MEDIAN (dasar
 * harga acuan RAB) + harga acuan kini & rata-rata tertimbang — fondasi hitung
 * laba-rugi FIFO/rata-rata. owner/admin bisa mencatat harga acuan manual di sini.
 *
 * `endpoint` = basis path item (mis. `/bahan/<id>` atau `/perlengkapan/<id>`).
 * Server menyediakan GET `${endpoint}/pembelian` & POST `${endpoint}/harga`.
 * Dipakai dua tempat: modal (perlengkapan) & halaman Detail Produk (bahan).
 */
export function RiwayatHargaPanel({
  endpoint,
  satuan,
  bolehUbah,
  invalidateKeys = [],
}: {
  endpoint: string;
  satuan: string;
  bolehUbah: boolean;
  /** query keys yang di-invalidate saat harga acuan disimpan */
  invalidateKeys?: string[][];
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["riwayat-harga", endpoint],
    queryFn: () => api<RiwayatHargaDto>(`${endpoint}/pembelian`),
  });
  const [hargaBaru, setHargaBaru] = useState("");
  // basis input catat harga: per satuan kerja atau per isi/kemasan
  const [basisIsi, setBasisIsi] = useState<boolean | null>(null);

  // kemasan (harga per isi): 1 satuan_beli = isi satuan — mis. 1 kg = 1.000 gram
  const isi = data && data.item.isi > 0 ? data.item.isi : 1;
  const kemasan = data?.item.satuan_beli?.trim() || "kemasan";
  const adaKemasan =
    data != null && (isi !== 1 || (data.item.satuan_beli?.trim() ?? "") !== "");
  const perIsi = (harga: number) => `${formatRupiah(Math.round(harga * isi))} / ${kemasan}`;
  const pakaiBasisIsi = basisIsi ?? adaKemasan;
  // Lot berharga PERKIRAAN: faktur dibuat tanpa harga, server mengisinya dari
  // harga acuan saat itu. Server sudah mengeluarkannya dari statistik; layar
  // yang bertugas membuatnya terlihat, sebab barisnya tetap ditampilkan.
  const jumlahNyata = data?.jumlah_harga_nyata ?? 0;
  /*
    DIHITUNG DARI ANGKA POPULASI, BUKAN DARI `lots`.

    `lots` kini dipotong 300 baris. Menyimpulkan "ada lot tebakan" dengan
    memindai larik yang dipotong berarti penjelasan kuningnya HILANG persis
    pada bahan yang riwayatnya paling panjang — sementara "12.018 lot" dan
    "statistik dari 4 harga" tetap berdampingan di layar tanpa satu kalimat
    pun yang menerangkan selisihnya.
  */
  const adaTebakan = data != null && data.jumlah_pembelian > jumlahNyata;

  const simpan = useMutation({
    mutationFn: () =>
      api<RiwayatHargaDto>(`${endpoint}/harga`, {
        method: "POST",
        // input per kemasan → konversi ke per satuan (server simpan × isi lagi)
        body: { harga_per_unit: (angkaDari(hargaBaru) || 0) / (pakaiBasisIsi ? isi : 1) },
      }),
    onSuccess: (d) => {
      queryClient.setQueryData(["riwayat-harga", endpoint], d);
      for (const k of invalidateKeys) queryClient.invalidateQueries({ queryKey: k });
      setHargaBaru("");
    },
  });

  if (!data) return <SpinnerAtauGalat error={error} apa="Riwayat harga" />;

  return (
    <div className="space-y-3">
      {/* Statistik riwayat: terendah/tertinggi (berapa & kapan) + median.
          Median = dasar harga acuan RAB; harga riil per lot dipakai HPP. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-green-50 px-2 py-2">
          <div className="text-xs text-green-700">Terendah</div>
          <div className="text-sm font-bold text-green-800">
            {data.harga_terendah != null ? formatRupiah(data.harga_terendah.harga) : "—"}
          </div>
          {adaKemasan && data.harga_terendah != null && (
            <div className="text-[10px] font-medium text-green-700">
              {perIsi(data.harga_terendah.harga)}
            </div>
          )}
          <div className="text-[10px] text-green-600">
            {data.harga_terendah != null ? formatTanggal(data.harga_terendah.tanggal) : `/ ${satuan}`}
          </div>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-2">
          <div className="text-xs font-medium text-amber-700">Median · acuan RAB</div>
          <div className="text-sm font-bold text-amber-800">
            {data.harga_median != null ? formatRupiah(data.harga_median) : "—"}
          </div>
          {adaKemasan && data.harga_median != null && (
            <div className="text-[10px] font-medium text-amber-700">
              {perIsi(data.harga_median)}
            </div>
          )}
          <div className="text-[10px] text-amber-600">/ {satuan}</div>
        </div>
        <div className="rounded-lg bg-red-50 px-2 py-2">
          <div className="text-xs text-red-700">Tertinggi</div>
          <div className="text-sm font-bold text-red-800">
            {data.harga_tertinggi != null ? formatRupiah(data.harga_tertinggi.harga) : "—"}
          </div>
          {adaKemasan && data.harga_tertinggi != null && (
            <div className="text-[10px] font-medium text-red-700">
              {perIsi(data.harga_tertinggi.harga)}
            </div>
          )}
          <div className="text-[10px] text-red-600">
            {data.harga_tertinggi != null ? formatTanggal(data.harga_tertinggi.tanggal) : `/ ${satuan}`}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-stone-50 px-2 py-2">
          <div className="text-xs text-stone-500">Harga acuan kini</div>
          <div className="text-sm font-bold text-stone-800">
            {formatRupiah(data.harga_terkini)}
          </div>
          {adaKemasan && (
            <div className="text-[10px] font-medium text-stone-600">
              {perIsi(data.harga_terkini)}
            </div>
          )}
          <div className="text-[10px] text-stone-400">/ {satuan}</div>
        </div>
        <div className="rounded-lg bg-stone-50 px-2 py-2">
          <div className="text-xs text-stone-500">Rata-rata</div>
          <div className="text-sm font-bold text-stone-800">
            {data.harga_rata != null ? formatRupiah(data.harga_rata) : "—"}
          </div>
          {adaKemasan && data.harga_rata != null && (
            <div className="text-[10px] font-medium text-stone-600">
              {perIsi(data.harga_rata)}
            </div>
          )}
          <div className="text-[10px] text-stone-400">tertimbang / {satuan}</div>
        </div>
        <div className="rounded-lg bg-stone-50 px-2 py-2">
          <div className="text-xs text-stone-500">Pembelian</div>
          <div className="text-sm font-bold text-stone-800">{data.jumlah_pembelian}</div>
          <div className="text-[10px] text-stone-400">lot tercatat</div>
        </div>
      </div>
      <p className="text-xs text-stone-500">
        {adaKemasan && (
          <>
            1 <b>{kemasan}</b> = {formatAngka(isi)} {satuan}.{" "}
          </>
        )}
        <b>Median</b> jadi harga acuan RAB belanja — disinkron otomatis tiap <b>Laporan
        Harga</b>. Harga acuan itulah dasar HPP resep &amp; laba-rugi. Harga riil tiap
        pembelian tetap tercatat per lot dan dipakai kartu persediaan bahan.
      </p>
      {/*
        Keempat angka di atas dihitung HANYA dari harga yang pernah dilihat
        orang. Jumlahnya disebutkan supaya selisihnya dengan "lot tercatat"
        punya penjelasan di layar — tanpa ini, 7 lot dengan statistik dari 1
        harga terbaca seperti angka yang salah.
      */}
      {adaTebakan && (
        <p className="text-xs text-amber-700">
          {data.jumlah_pembelian - jumlahNyata} lot berharga <b>perkiraan</b> (faktur dibuat
          tanpa harga, diisi dari harga acuan saat itu) — ditandai <b>≈</b> di daftar dan
          TIDAK ikut menghitung statistik di atas. Statistiknya dari {jumlahNyata} harga yang
          benar-benar dilaporkan. Isi harga aslinya lewat <b>Laporan Harga</b>.
        </p>
      )}

      {/*
        DIPOTONG HARUS TERBACA. "12.018 lot tercatat" tepat di atas daftar
        berisi 300 baris terbaca sebagai pembelian yang hilang — di kartu tempat
        orang memutuskan harga acuan belanjanya.
      */}
      {data.lots_terpotong && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Menampilkan <b>{data.lots.length}</b> pembelian terbaru dari{" "}
          <b>{data.jumlah_pembelian}</b> yang tercatat. Keempat angka statistik di atas
          tetap dihitung dari <b>seluruh</b> pembelian, bukan cuma yang tampil di sini.
        </p>
      )}

      {data.lots.length === 0 ? (
        <div className="rounded-lg bg-stone-50 px-3 py-6 text-center text-sm text-stone-400">
          Belum ada riwayat pembelian. Harga terisi dari pembelian yang tercatat.
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-stone-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-2 py-1.5 text-left">Tanggal</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5 text-right">Harga/{satuan}</th>
                <th className="px-2 py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.lots.map((l) => (
                <tr key={l.id}>
                  <td className="px-2 py-1.5 text-stone-700">
                    {formatTanggal(l.tanggal)}
                    <div className="text-[10px] text-stone-400">
                      {l.nomor ?? l.no_faktur ?? ""}
                      {l.supplier ? ` · ${l.supplier}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-600">
                    {formatAngka(l.qty)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-medium ${
                      l.harga_tebakan ? "text-amber-700" : "text-stone-800"
                    }`}
                  >
                    {l.harga_satuan != null ? (
                      <span title={l.harga_tebakan ? "Harga perkiraan — belum dilaporkan" : undefined}>
                        {l.harga_tebakan && "≈ "}
                        {formatRupiah(l.harga_satuan)}
                      </span>
                    ) : (
                      "—"
                    )}
                    {adaKemasan && l.harga_satuan != null && (
                      <div className="text-[10px] font-normal text-stone-500">
                        {perIsi(l.harga_satuan)}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-600">
                    {l.total_harga != null ? formatRupiah(l.total_harga) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bolehUbah && (
        <div className="rounded-lg border border-stone-200 p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium">
              Catat harga terbaru (Rp / {pakaiBasisIsi ? kemasan : satuan})
            </label>
            {adaKemasan && (
              <div className="flex gap-1 text-xs">
                <button
                  onClick={() => setBasisIsi(true)}
                  className={`rounded-full px-2 py-0.5 ${pakaiBasisIsi ? "bg-orange-500 text-white" : "bg-stone-100 text-stone-600"}`}
                >
                  per {kemasan}
                </button>
                <button
                  onClick={() => setBasisIsi(false)}
                  className={`rounded-full px-2 py-0.5 ${!pakaiBasisIsi ? "bg-orange-500 text-white" : "bg-stone-100 text-stone-600"}`}
                >
                  per {satuan}
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={hargaBaru}
              onChange={(e) => setHargaBaru(e.target.value)}
              placeholder={teksAngka(
                pakaiBasisIsi ? Math.round(data.harga_terkini * isi) : data.harga_terkini,
              )}
              className={`${inputClass} max-w-40`}
            />
            <button
              onClick={() => simpan.mutate()}
              disabled={!(angkaDari(hargaBaru) >= 0) || hargaBaru === "" || simpan.isPending}
              className={btnPrimary}
            >
              {simpan.isPending ? "Menyimpan…" : "Catat"}
            </button>
            {simpan.isSuccess && <span className="text-sm text-green-600">Tersimpan ✓</span>}
          </div>
          {pakaiBasisIsi && hargaBaru !== "" && angkaDari(hargaBaru) >= 0 && (
            <p className="mt-1 text-xs text-stone-500">
              ≈ {formatRupiah(angkaDari(hargaBaru) / isi)} / {satuan}
            </p>
          )}
          <p className="mt-1 text-xs text-stone-500">
            Memperbarui <b>harga acuan</b> — dipakai perkiraan biaya &amp; laba-rugi berikutnya.
          </p>
          <ErrorText error={simpan.error} />
        </div>
      )}
    </div>
  );
}

/** Modal pembungkus RiwayatHargaPanel — dipakai daftar Perlengkapan. */
export function RiwayatHargaModal({
  endpoint,
  nama,
  satuan,
  bolehUbah,
  invalidateKeys = [],
  onClose,
}: {
  endpoint: string;
  nama: string;
  satuan: string;
  bolehUbah: boolean;
  invalidateKeys?: string[][];
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Riwayat Harga — ${nama}`}>
      <div className="space-y-3">
        <RiwayatHargaPanel
          endpoint={endpoint}
          satuan={satuan}
          bolehUbah={bolehUbah}
          invalidateKeys={invalidateKeys}
        />
        <div className="flex justify-end">
          <button onClick={onClose} className={btnSecondary}>
            Tutup
          </button>
        </div>
      </div>
    </Modal>
  );
}
