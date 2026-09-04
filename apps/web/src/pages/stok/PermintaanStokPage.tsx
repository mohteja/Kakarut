import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  KonfirmasiStatus,
  PermintaanStokBagian,
  PermintaanStokBagianPerlengkapan,
  PermintaanStokDaftar,
  PermintaanStokRow,
  StatusPermintaan,
} from "@kakarut/shared";
import { statusPermintaan } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  StatCard,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { SakelarTampilan, useTampilan } from "../../components/SakelarTampilan";
import { TabelResponsif } from "../../components/TabelResponsif";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatWaktu } from "../../lib/format";
import {
  IKON_JALUR,
  kolomPermintaan,
  LABEL_STATUS,
  STYLE_STATUS,
  tautanJalur,
  totalPermintaan,
  type Jalur,
} from "./kolom-permintaan";

const STATUS_STYLE: Record<KonfirmasiStatus, string> = {
  rencana: "bg-stone-100 text-stone-600",
  dikerjakan: "bg-amber-100 text-amber-700",
  menunggu: "bg-blue-100 text-blue-700",
  dikonfirmasi: "bg-green-100 text-green-700",
  ditolak: "bg-red-100 text-red-700",
};
// Label tahap berbeda antara jalur produksi (work-order CK) & beli (RAB).
const LABEL_PRODUKSI: Record<KonfirmasiStatus, string> = {
  rencana: "Direncanakan",
  dikerjakan: "Dikerjakan",
  menunggu: "Menunggu konfirmasi",
  dikonfirmasi: "Selesai",
  ditolak: "Ditolak",
};
const LABEL_BELI: Record<KonfirmasiStatus, string> = {
  rencana: "RAB (rencana)",
  dikerjakan: "Diproses",
  menunggu: "Dikirim",
  dikonfirmasi: "Diterima",
  ditolak: "Ditolak",
};
// Kirim dari stok CK (transfer): lahir langsung 'menunggu' (siap kirim),
// selesai saat cabang menerima.
const LABEL_KIRIM: Record<KonfirmasiStatus, string> = {
  rencana: "Direncanakan",
  dikerjakan: "Disiapkan",
  menunggu: "Dalam pengiriman",
  dikonfirmasi: "Diterima cabang",
  ditolak: "Ditolak",
};

/**
 * Gaya & label satu bagian — SATU rumah, dipakai kartu DAN tabel.
 *
 * Sempat ada dua: `Bagian` menghitung labelnya sendiri dengan terner yang
 * byte-identik dengan yang dipakai kolom tabel. Dua salinan aturan label
 * berarti kartu dan tabel bisa menyebut tahap yang sama dengan dua kata
 * berbeda untuk faktur yang sama — dan tak satu uji pun akan merah.
 */
export function gayaBagian(b: PermintaanStokBagian, jalur: Jalur) {
  return {
    label: (jalur === "produksi" || jalur === "produksi_cabang"
      ? LABEL_PRODUKSI
      : jalur === "kirim"
        ? LABEL_KIRIM
        : LABEL_BELI)[b.status],
    gaya: STATUS_STYLE[b.status],
  };
}

export function gayaPerlengkapan(r: PermintaanStokRow) {
  return {
    label: r.beli_perlengkapan ? LABEL_PERLENGKAPAN[r.beli_perlengkapan.status] : "",
    gaya: r.beli_perlengkapan ? STYLE_PERLENGKAPAN[r.beli_perlengkapan.status] : "",
  };
}

function Bagian({ jalur, data }: { jalur: Jalur; data: PermintaanStokBagian }) {
  const judul =
    jalur === "produksi"
      ? "Produksi"
      : jalur === "produksi_cabang"
        ? "Produksi di cabang (kitchen/bar)"
        : jalur === "beli"
          ? "Beli produk jadi"
          : jalur === "kirim"
            ? "Kirim dari stok CK"
            : "Bahan produksi";
  const g = gayaBagian(data, jalur);
  return (
    <Link
      /*
       * KE FAKTURNYA, lewat fungsi yang SAMA dengan bentuk tabel.
       *
       * Dulu prop `to` diketik pemanggilnya sebagai "/produksi" / "/pembelian"
       * — DAFTARNYA. Mengklik "🏭 Produksi · 3 bahan" karena itu mendaratkan
       * orang di halaman 1 dari 4 halaman riwayat dan menyuruhnya mencari
       * sendiri faktur yang barusan ia klik, padahal `faktur_id`-nya sudah ada
       * di tangan. Prop itu dihapus supaya tak ada pemanggil yang bisa
       * menentukan tujuan sendiri lagi.
       */
      to={tautanJalur(jalur, data.faktur_id)}
      className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 transition hover:border-orange-400 hover:shadow-sm"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-stone-800">
          {IKON_JALUR[jalur]} {judul} · {data.jumlah_baris} bahan
        </div>
        {data.total > 0 && (
          <div className="text-xs text-stone-500">
            ≈ {formatRupiah(data.total)}
            {/* belanja bahan mentah = input produksi — nilainya sudah ada di
                total produksi, jadi tak dijumlah lagi di total transaksi */}
            {jalur === "beli_produksi" && " · sudah termasuk biaya produksi"}
          </div>
        )}
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${g.gaya}`}>
        {g.label}
      </span>
    </Link>
  );
}

/**
 * Bagian FAKTUR BELI PERLENGKAPAN (BP-): status pipeline sendiri
 * (menunggu dibeli → tiba di CK / batal), tautan ke halaman Beli Perlengkapan.
 */
const STYLE_PERLENGKAPAN: Record<PermintaanStokBagianPerlengkapan["status"], string> = {
  menunggu: "bg-amber-100 text-amber-700",
  diproses: "bg-sky-100 text-sky-700",
  sebagian: "bg-lime-100 text-lime-700",
  tiba: "bg-green-100 text-green-700",
  batal: "bg-stone-100 text-stone-500",
};
const LABEL_PERLENGKAPAN: Record<PermintaanStokBagianPerlengkapan["status"], string> = {
  menunggu: "Menunggu dibeli",
  diproses: "🛒 Diproses",
  sebagian: "Sebagian tiba",
  tiba: "Tiba di CK ✓",
  batal: "Dibatalkan",
};
function BagianPerlengkapan({ data }: { data: PermintaanStokBagianPerlengkapan }) {
  return (
    <Link
      // Lewat fungsi yang sama, supaya batas "BP- tetap ke daftarnya" hidup di
      // SATU tempat dan tak bisa diperbaiki setengah lagi.
      to={tautanJalur("beli_perlengkapan", data.faktur_id)}
      className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 transition hover:border-orange-400 hover:shadow-sm"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-stone-800">
          🧰 Beli perlengkapan · {data.jumlah_baris} item
        </div>
        {data.total > 0 && (
          <div className="text-xs text-stone-500">≈ {formatRupiah(data.total)}</div>
        )}
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE_PERLENGKAPAN[data.status]}`}
      >
        {LABEL_PERLENGKAPAN[data.status]}
      </span>
    </Link>
  );
}

/*
 * `selesaiPermintaan` & `statusPermintaan` PINDAH ke
 * `packages/shared/src/permintaan-stok.ts` pada 2026-09-03.
 *
 * Sebabnya bukan kerapian: sejak putaran ini ringkasan di atas daftar dihitung
 * SERVER atas seluruh populasi (daftarnya berhalaman, jadi menjumlahkannya
 * dari baris yang tampil akan berbunyi "0 selesai" sampai halaman terakhir).
 * Dua salinan aturan yang sama berarti ubin dan lencana bisa berselisih soal
 * permintaan yang sama, di layar yang sama, tanpa satu pun uji memerah.
 * Labelnya tetap di sini — itu memang milik layar.
 */

/**
 * Permintaan Stok: daftar permintaan "Tambah Stok dari Menu" (owner/admin
 * dari Kantor). Tiap submit = satu kartu, menggabungkan faktur Produksi + Beli.
 */
export function PermintaanStokPage() {
  const queryClient = useQueryClient();
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  /*
   * BENTUK TAMPILAN — bawaan `kartu`, bentuk yang sudah ada sebelum tombol
   * ini. Alasannya sama dengan yang ditulis `ResepPage`: mengganti bentuk
   * bawaan sebuah layar yang sudah dipakai orang adalah perubahan yang tak
   * seorang pun minta, dan yang membukanya besok akan mengira ada yang rusak.
   */
  const [tampilan, setTampilan] = useTampilan<"kartu" | "tabel">(
    "kakarut.permintaanTampilan",
    ["kartu", "tabel"],
    "kartu",
  );
  const {
    data,
    isLoading,
    isFetching,
    error: gagalMuat,
  } = useQuery({
    queryKey: ["permintaan-stok", page, perPage],
    queryFn: () =>
      api<PermintaanStokDaftar>(`/rekomendasi/permintaan?page=${page}&per_page=${perPage}`),
    placeholderData: (sebelumnya) => sebelumnya,
  });

  // Hapus permintaan → Tempat Sampah: SOFT-DELETE semua fakturnya sekaligus
  // (produksi + beli + bahan produksi). Stok yang belum masuk otomatis batal.
  const hapus = useMutation({
    mutationFn: (rencanaId: string) =>
      api(`/rekomendasi/permintaan/${rencanaId}`, { method: "DELETE" }),
    onSuccess: () => {
      for (const key of ["permintaan-stok", "stok", "laporan", "/pembelian", "/produksi", "rekomendasi", "sampah"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  /*
   * URUTAN & POTONGAN HALAMAN DATANG DARI SERVER sejak 2026-09-03.
   *
   * Dulu di sini ada `useMemo` yang mengurut seluruh riwayat perusahaan
   * ("berjalan dulu, lalu terbaru") dan `list.slice(...)` yang mengirisnya —
   * keduanya di klien, atas balasan yang memuat SEMUANYA. Terukur sebelum
   * putaran ini: 24 permintaan = 11.790 byte, dan tak ada cara memintanya
   * lebih kecil. Aturan urutnya kini hidup di SQL, jadi tak ada lagi tempat
   * kedua yang bisa berselisih dengannya.
   */
  const list = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const keHalaman = (n: number) => setPage(Math.min(totalPages, Math.max(1, n)));
  /*
   * Tarik `page` turun bila ia melewati halaman terakhir — mis. sesudah
   * permintaan terakhir di halaman 4 dihapus. Tanpa ini orangnya terkunci di
   * halaman kosong tanpa tombol yang membawanya kembali. Pelajaran yang sudah
   * dibayar `TambahStokPage`.
   */
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const konfirmasiHapus = (rencanaId: string) => {
    if (
      confirm(
        `Hapus permintaan ini? Semua fakturnya (produksi & belanja) ikut dipindah ke Tempat Sampah dan stok yang belum masuk dibatalkan. Masih bisa dipulihkan dari Tempat Sampah.`,
      )
    )
      hapus.mutate(rencanaId);
  };

  return (
    /* Lebar dilepas pada bentuk tabel — tabel di dalam kolom 42rem tak terbaca. */
    <div className={tampilan === "kartu" ? "max-w-2xl" : ""}>
      <PageTitle
        aksi={
          <Link to="/stok/tambah-dari-menu" className={btnSecondary}>
            ➕ Permintaan baru
          </Link>
        }
      >
        📋 Data Permintaan Stok
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Riwayat permintaan <b>Tambah Stok dari Menu</b>. Tiap permintaan diterbitkan sebagai faktur{" "}
        <b>🚚 Kirim dari stok CK</b> (stok ready CK langsung dikirim ke cabang), <b>Produksi</b>{" "}
        (work-order Central Kitchen), dan/atau <b>Beli</b> — ketuk untuk membukanya.
      </div>
      <ErrorText error={hapus.error} />

      {/*
        UBIN RINGKASAN — angkanya dari SERVER (`data.ringkas`), atas SELURUH
        populasi, bukan dijumlahkan dari halaman yang sedang tampil. Daftarnya
        menaruh yang belum selesai lebih dulu, jadi ringkasan dari `rows` akan
        berbunyi "0 selesai" sampai orangnya menelusuri ke halaman terakhir.

        TAK DIRENDER SAAT BACAANNYA GAGAL: "0 berjalan" di atas daftar yang
        gagal dimuat terbaca sebagai "tak ada cabang yang menunggu" — jauh
        lebih percaya diri daripada layar kosong, dan salah.
      */}
      {!gagalMuat && data?.ringkas && total > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            besar
            label={LABEL_STATUS.berjalan}
            value={`${formatAngka(data.ringkas.berjalan)} permintaan`}
            warna="text-blue-700"
          />
          <StatCard
            besar
            label={LABEL_STATUS.selesai}
            value={`${formatAngka(data.ringkas.selesai)} permintaan`}
            warna="text-green-700"
          />
          {data.ringkas.selesai_ada_ditolak > 0 && (
            <StatCard
              besar
              label={LABEL_STATUS.selesai_ada_ditolak}
              value={`${formatAngka(data.ringkas.selesai_ada_ditolak)} permintaan`}
              warna="text-amber-700"
            />
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SakelarTampilan
          nilai={tampilan}
          atur={setTampilan}
          opsi={[
            { nilai: "kartu", label: "🗂 Kartu" },
            { nilai: "tabel", label: "☰ Tabel" },
          ]}
        />
        {total > 0 && (
          <span className="text-xs text-stone-400">
            {formatAngka(total)} permintaan
            {isFetching && " · Memuat…"}
          </span>
        )}
      </div>

      {/*
        GAGAL MEMUAT ≠ TIDAK ADA PERMINTAAN. Cabang kosong di bawah mengundang
        membuat permintaan baru — padahal permintaan cabang yang sudah antre
        mungkin hanya tak terbaca. Cabang yang menunggu tak punya cara memberi
        tahu kantor selain lewat daftar ini.
      */}
      {isLoading ? (
        <Spinner />
      ) : gagalMuat ? (
        <Card className="p-4">
          <ErrorText error={gagalMuat} />
          <div className="mt-2 text-sm text-stone-500">
            Daftar permintaan tidak bisa dimuat, jadi kosongnya <b>bukan</b> berarti tak ada
            cabang yang meminta stok. Muat ulang setelah masalahnya beres.
          </div>
        </Card>
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada permintaan. Buat lewat “➕ Permintaan baru”.
        </Card>
      ) : tampilan === "tabel" ? (
        /*
         * BENTUK TABEL — diminta pemilik repo, berdampingan dengan kartunya.
         * `TabelResponsif` sendiri yang menumpuknya kembali jadi kartu di
         * layar kecil, jadi bentuk ini tak menghukum siapa pun yang membukanya
         * dari HP.
         */
        <TabelResponsif
          kolom={kolomPermintaan({
            gayaBagian,
            gayaPerlengkapan,
            onHapus: konfirmasiHapus,
            hapusSedang: hapus.isPending,
          })}
          data={list}
          kunci={(r) => r.rencana_id}
          galat={gagalMuat}
          minLebar="min-w-[64rem]"
          kosong="Belum ada permintaan. Buat lewat “➕ Permintaan baru”."
        />
      ) : (
        <div className="space-y-3">
          {list.map((r) => {
            const st = statusPermintaan(r);
            const status = { label: LABEL_STATUS[st], cls: STYLE_STATUS[st] };
            // Aturan "beli_produksi tak dijumlahkan" (dobel hitung) pindah ke
            // `totalPermintaan` — dipakai kartu DAN tabel, jadi keduanya tak
            // bisa menyebut angka yang berbeda untuk permintaan yang sama.
            const total = totalPermintaan(r);
            return (
              <Card key={r.rencana_id} className="overflow-hidden">
                {/* Header: tujuan + waktu di kiri, STATUS di pojok kanan atas */}
                <div className="flex items-start justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-bold text-stone-800">📋 Permintaan</span>
                      {/* nomor dokumen permintaan — identitas utama (dipakai juga
                          badge asal di kartu Pembelian/Produksi) */}
                      {r.nomor && (
                        <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                          {r.nomor}
                        </span>
                      )}
                      {/* TUJUAN barang dibuat mencolok agar tak salah lihat */}
                      {r.tujuan_cabang && (
                        <span className="whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-sm font-bold text-purple-800">
                          📦 {r.tujuan_cabang}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-stone-500">
                      {formatWaktu(r.waktu)}
                      {r.catatan && ` · ${r.catatan}`}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${status.cls}`}
                  >
                    {status.label}
                  </span>
                </div>
                <div className="space-y-2 border-b border-stone-100 px-4 py-2.5">
                  {/* stok yang SUDAH ADA di CK: dikirim langsung, tanpa produksi baru */}
                  {r.kirim && <Bagian jalur="kirim" data={r.kirim} />}
                  {r.produksi && <Bagian jalur="produksi" data={r.produksi} />}
                  {/* produksi lokal di cabang tujuan (kitchen) — hasil masuk stok cabang */}
                  {r.produksi_cabang && (
                    <Bagian jalur="produksi_cabang" data={r.produksi_cabang} />
                  )}
                  {r.beli && <Bagian jalur="beli" data={r.beli} />}
                  {r.beli_produksi && (
                    <Bagian jalur="beli_produksi" data={r.beli_produksi} />
                  )}
                  {/* faktur beli PERLENGKAPAN (BP-) yang lahir bersama permintaan */}
                  {r.beli_perlengkapan && <BagianPerlengkapan data={r.beli_perlengkapan} />}
                </div>
                {/* Footer: total transaksi permintaan + pembuat + hapus */}
                <div className="flex items-end justify-between gap-2 px-4 py-2.5">
                  <div>
                    <div className="text-xs text-stone-500">Total transaksi:</div>
                    <div className="text-lg font-bold text-stone-800">{formatRupiah(total)}</div>
                    {/* pembuat cukup di footer — header tetap ringkas */}
                    {r.pembuat && (
                      <div className="text-xs text-stone-400">dibuat oleh {r.pembuat}</div>
                    )}
                  </div>
                  <button
                    onClick={() => konfirmasiHapus(r.rencana_id)}
                    disabled={hapus.isPending}
                    className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    🗑 Hapus
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination + aturan baris di BAWAH daftar */}
      {!isLoading && !gagalMuat && total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
          {totalPages > 1 && (
            // flex-wrap: 5 tombol butuh ~420px, lebih lebar dari layar HP —
            // tanpa ini tombol terakhir («/») jatuh di luar layar
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                onClick={() => keHalaman(1)}
                disabled={page <= 1}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
                title="Terbaru & masih berjalan"
              >
                «
              </button>
              <button
                onClick={() => keHalaman(page - 1)}
                disabled={page <= 1}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
              >
                ‹ Sebelumnya
              </button>
              <span className="px-2 text-stone-500">
                Halaman <b>{page}</b> / {totalPages}
              </span>
              <button
                onClick={() => keHalaman(page + 1)}
                disabled={page >= totalPages}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
              >
                Berikutnya ›
              </button>
              <button
                onClick={() => keHalaman(totalPages)}
                disabled={page >= totalPages}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
                title="Terlama"
              >
                »
              </button>
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            Baris / halaman
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
              className={`${inputClass} w-auto`}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
