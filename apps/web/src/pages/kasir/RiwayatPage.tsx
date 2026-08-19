import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { RiwayatTransaksiRow } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, btnSecondary, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatDurasi, formatRupiah, formatWaktu, hariIniWIB } from "../../lib/format";
import { ReceiptModal, type SaleResult } from "./ReceiptModal";

const METODE_LABEL: Record<string, string> = {
  tunai: "💵 Tunai",
  qris: "📱 QRIS",
  transfer: "🏦 Transfer",
};

/**
 * Riwayat transaksi kasir: cek pesanan bila ada kekeliruan + cetak ulang struk.
 */
export function RiwayatPage() {
  const { auth } = useAuth();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { branchQuery, divisi } = useBranch();
  const queryClient = useQueryClient();
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Kantor = pusat data penjualan: semua transaksi seluruh cabang sekaligus
  // (cabang menyetor data penjualan ke kantor); divisi lain terkunci lokasinya.
  const dariKantor = divisi === "kantor";
  const q = dariKantor ? "?branch_id=all" : branchQuery;
  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["riwayat", q, tanggal],
    queryFn: () =>
      api<RiwayatTransaksiRow[]>(`/penjualan${q ? `${q}&` : "?"}tanggal=${tanggal}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["transaksi-detail", selectedId],
    queryFn: () => api<SaleResult>(`/penjualan/${selectedId}`),
    enabled: !!selectedId,
  });

  // Kembalikan uang per sajian: kasir pun boleh (pembelinya sedang menunggu di
  // depan kasir), jejaknya tersimpan di server. Peran lain yang bisa membuka
  // halaman ini — tim & dapur — hanya melihat, sesuai gerbang server.
  const bisaRefund =
    auth?.user.role === "owner" || auth?.user.role === "admin" || auth?.user.role === "cashier";

  const list = rows ?? [];
  const totalHari = list.reduce((a, r) => a + r.total, 0);

  /**
   * Uang & stok sama-sama bergerak saat transaksi dihapus ATAU direfund, jadi
   * daftar, laporan, dan saldo stok sama-sama basi. Disatukan supaya tak ada
   * kunci yang terlewat di salah satu jalur.
   */
  function segarkan(tutup: boolean) {
    if (tutup) setSelectedId(null);
    for (const key of ["riwayat", "transaksi-detail", "stok", "laporan", "rekomendasi", "sampah"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  return (
    <div className="max-w-2xl">
      <PageTitle
        aksi={
          <Link to="/kasir" className={btnSecondary}>
            ← Kasir
          </Link>
        }
      >
        Riwayat Transaksi
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Cek pesanan atau <b>cetak ulang struk</b> bila ada kekeliruan. Ketuk transaksi untuk
        melihat detail & mencetak ulang.
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={tanggal}
          onChange={(e) => setTanggal(e.target.value)}
          className={inputClass}
        />
        {list.length > 0 && (
          <div className="text-sm text-stone-500">
            {list.length} transaksi · total <b>{formatRupiah(totalHari)}</b>
          </div>
        )}
      </div>

      {/*
        GAGAL MEMUAT ≠ TIDAK ADA TRANSAKSI. Sebelum ini keduanya terlihat sama
        persis: "Belum ada transaksi pada tanggal ini." Kasir yang ditolak
        servernya jadi yakin harinya memang sepi, lalu tutup kasir dengan angka
        yang tak pernah dibandingkan dengan apa pun. Server yang MATI sudah
        punya overlay sendiri; yang lolos tanpa jejak justru penolakan biasa
        (mis. hak akses cabang) — dan itu yang ditampilkan di sini.
      */}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <Card className="p-4">
          <ErrorText error={error} />
          <div className="mt-2 text-sm text-stone-500">
            Daftar transaksi tidak bisa dimuat, jadi yang tampil di bawah <b>bukan</b> berarti
            kosong. Muat ulang halaman setelah masalahnya beres.
          </div>
        </Card>
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada transaksi pada tanggal ini.
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:border-orange-400 hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold text-stone-800">{r.nomor}</div>
                <div className="truncate text-sm text-stone-500">
                  {formatWaktu(r.waktu)} · {r.jumlah_item} item
                  {dariKantor && r.cabang && ` · 🏪 ${r.cabang}`}
                  {r.meja && ` · ${r.meja}`}
                  {r.kasir && ` · ${r.kasir}`}
                  {` · ${METODE_LABEL[r.metode] ?? r.metode}`}
                </div>
                {r.konsumen && (
                  <div className="truncate text-xs font-medium text-orange-600">👤 {r.konsumen}</div>
                )}
                {/*
                  Lama SELURUH pesanan rampung — dari sajian pertama masuk
                  sampai yang terakhir keluar. Hanya muncul bila memang sudah
                  rampung: transaksi yang dapurnya tak pernah menandai selesai
                  TIDAK menampilkan "0 mnt", sebab nol berarti keluar seketika
                  dan itu justru memuji kelalaian mencatat.
                */}
                {r.pesanan_durasi_detik != null && (
                  <div
                    className="truncate text-xs text-emerald-700"
                    title={
                      r.pesanan_selesai_pada
                        ? `Semua sajian keluar ${formatWaktu(r.pesanan_selesai_pada)}`
                        : undefined
                    }
                  >
                    ⏱ rampung {formatDurasi(r.pesanan_durasi_detik)}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex flex-col items-end gap-0.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.is_dine_in ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-600"}`}
                  >
                    {r.is_dine_in ? "Dine-in" : "Bawa pulang"}
                  </span>
                  {/* Dapur mengubah cara penyajian lewat Papan Pesanan setelah
                      nota tercatat. Nota & perhitungan bahan TIDAK ikut berubah,
                      jadi selisihnya ditampilkan — bukan disembunyikan.

                      Penandanya per baris, jadi badge yang mutlak menyesatkan:
                      `sajian_takeaway` itu bool_and, ia false begitu SATU baris
                      tetap di piring. Cacah barisnya yang bisa membedakan
                      "semuanya" dari "sebagian" — pakai itu kalau memang
                      sebagian, dan tulis apa adanya. */}
                  {(() => {
                    const campur = r.item_takeaway > 0 && r.item_dine_in > 0;
                    if (campur) {
                      return (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                          {r.item_takeaway} dari {r.jumlah_item} 🥡 dibungkus
                        </span>
                      );
                    }
                    // Seragam semuanya — hanya menarik bila BERBEDA dari nota.
                    if (r.sajian_takeaway !== r.is_dine_in) return null;
                    return (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                        {r.sajian_takeaway
                          ? "disajikan 🥡 bawa pulang"
                          : "disajikan 🍽 di tempat"}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-right">
                  <div className="font-bold text-stone-800">{formatRupiah(r.total)}</div>
                  <div className="text-xs text-orange-600">🧾 Struk</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId && detail && (
        <ReceiptModal
          data={detail}
          autoPrintOnOpen={false}
          onClose={() => setSelectedId(null)}
          onDeleted={isManajemen ? () => segarkan(true) : undefined}
          // Refund tidak menutup struk: kasir biasanya langsung mencetak ulang
          // agar pembeli memegang angka yang benar. Detailnya disegarkan supaya
          // panel & struk memakai sisa porsi yang baru.
          onRefunded={bisaRefund ? () => segarkan(false) : undefined}
        />
      )}
    </div>
  );
}
