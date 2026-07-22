import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { KonfirmasiStatus, PermintaanStokBagian, PermintaanStokRow } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, btnSecondary, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah, formatWaktu } from "../../lib/format";

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

function Bagian({
  jalur,
  data,
  to,
}: {
  jalur: "produksi" | "produksi_cabang" | "beli" | "beli_produksi" | "kirim";
  data: PermintaanStokBagian;
  to: string;
}) {
  const ikon =
    jalur === "produksi"
      ? "🏭"
      : jalur === "produksi_cabang"
        ? "🏪"
        : jalur === "beli"
          ? "🛒"
          : jalur === "kirim"
            ? "🚚"
            : "🧺";
  const judul =
    jalur === "produksi"
      ? "Produksi"
      : jalur === "produksi_cabang"
        ? "Produksi di cabang (kitchen)"
        : jalur === "beli"
          ? "Beli produk jadi"
          : jalur === "kirim"
            ? "Kirim dari stok CK"
            : "Bahan produksi";
  const label = (
    jalur === "produksi" || jalur === "produksi_cabang"
      ? LABEL_PRODUKSI
      : jalur === "kirim"
        ? LABEL_KIRIM
        : LABEL_BELI
  )[data.status];
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 transition hover:border-orange-400 hover:shadow-sm"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-stone-800">
          {ikon} {judul} · {data.jumlah_baris} bahan
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
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[data.status]}`}
      >
        {label}
      </span>
    </Link>
  );
}

/** Permintaan dianggap selesai bila SEMUA bagiannya sudah dikonfirmasi/ditolak. */
function selesaiPermintaan(r: PermintaanStokRow): boolean {
  const st = [r.produksi, r.produksi_cabang, r.beli, r.beli_produksi, r.kirim]
    .filter((b): b is PermintaanStokBagian => b != null)
    .map((b) => b.status);
  return st.length > 0 && st.every((s) => s === "dikonfirmasi" || s === "ditolak");
}

/** Status keseluruhan satu permintaan = agregat status semua bagiannya. */
function statusPermintaan(r: PermintaanStokRow): { label: string; cls: string } {
  const st = [r.produksi, r.produksi_cabang, r.beli, r.beli_produksi, r.kirim]
    .filter((b): b is PermintaanStokBagian => b != null)
    .map((b) => b.status);
  if (st.length > 0 && st.every((s) => s === "dikonfirmasi")) {
    return { label: "📦 Selesai ✓", cls: "bg-green-100 text-green-700" };
  }
  if (selesaiPermintaan(r)) {
    return { label: "⚠ Selesai — ada ditolak", cls: "bg-amber-100 text-amber-700" };
  }
  return { label: "🔄 Berjalan", cls: "bg-blue-100 text-blue-700" };
}

/**
 * Permintaan Stok: daftar permintaan "Tambah Stok dari Menu" (owner/admin
 * dari Kantor). Tiap submit = satu kartu, menggabungkan faktur Produksi + Beli.
 */
export function PermintaanStokPage() {
  const queryClient = useQueryClient();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["permintaan-stok"],
    queryFn: () => api<PermintaanStokRow[]>("/rekomendasi/permintaan"),
  });
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

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

  // urutan: yang masih Berjalan dulu, lalu terbaru → terlama
  const list = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) => {
        const beresA = selesaiPermintaan(a) ? 1 : 0;
        const beresB = selesaiPermintaan(b) ? 1 : 0;
        if (beresA !== beresB) return beresA - beresB;
        return b.waktu.localeCompare(a.waktu);
      }),
    [rows],
  );
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const pageAman = Math.min(page, totalPages);
  const tampil = list.slice((pageAman - 1) * perPage, pageAman * perPage);
  const keHalaman = (n: number) => setPage(Math.min(totalPages, Math.max(1, n)));

  return (
    <div className="max-w-2xl">
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

      {isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada permintaan. Buat lewat “➕ Permintaan baru”.
        </Card>
      ) : (
        <div className="space-y-3">
          {tampil.map((r) => {
            const status = statusPermintaan(r);
            // Belanja BAHAN PRODUKSI tidak dijumlahkan: itu input dari faktur
            // produksi yang nilainya sudah termasuk di total produksi —
            // menjumlahkannya lagi = dobel hitung.
            const total =
              (r.produksi?.total ?? 0) + (r.produksi_cabang?.total ?? 0) + (r.beli?.total ?? 0);
            return (
              <Card key={r.rencana_id} className="overflow-hidden">
                {/* Header: tujuan + waktu di kiri, STATUS di pojok kanan atas */}
                <div className="flex items-start justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-bold text-stone-800">📋 Permintaan</span>
                      {/* TUJUAN barang dibuat mencolok agar tak salah lihat */}
                      {r.tujuan_cabang && (
                        <span className="whitespace-nowrap rounded-md bg-purple-100 px-2 py-0.5 text-sm font-bold text-purple-800">
                          📦 → {r.tujuan_cabang}
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
                  {r.kirim && <Bagian jalur="kirim" data={r.kirim} to="/produksi" />}
                  {r.produksi && <Bagian jalur="produksi" data={r.produksi} to="/produksi" />}
                  {/* produksi lokal di cabang tujuan (kitchen) — hasil masuk stok cabang */}
                  {r.produksi_cabang && (
                    <Bagian jalur="produksi_cabang" data={r.produksi_cabang} to="/produksi" />
                  )}
                  {r.beli && <Bagian jalur="beli" data={r.beli} to="/pembelian" />}
                  {r.beli_produksi && (
                    <Bagian jalur="beli_produksi" data={r.beli_produksi} to="/pembelian" />
                  )}
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
                    onClick={() => {
                      if (
                        confirm(
                          `Hapus permintaan ini? Semua fakturnya (produksi & belanja) ikut dipindah ke Tempat Sampah dan stok yang belum masuk dibatalkan. Masih bisa dipulihkan dari Tempat Sampah.`,
                        )
                      )
                        hapus.mutate(r.rencana_id);
                    }}
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
      {!isLoading && list.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => keHalaman(1)}
                disabled={pageAman <= 1}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
                title="Terbaru & masih berjalan"
              >
                «
              </button>
              <button
                onClick={() => keHalaman(pageAman - 1)}
                disabled={pageAman <= 1}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
              >
                ‹ Sebelumnya
              </button>
              <span className="px-2 text-stone-500">
                Halaman <b>{pageAman}</b> / {totalPages}
              </span>
              <button
                onClick={() => keHalaman(pageAman + 1)}
                disabled={pageAman >= totalPages}
                className={`${btnSecondary} px-2.5 py-1 disabled:opacity-40`}
              >
                Berikutnya ›
              </button>
              <button
                onClick={() => keHalaman(totalPages)}
                disabled={pageAman >= totalPages}
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
