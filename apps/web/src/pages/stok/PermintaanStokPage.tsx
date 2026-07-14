import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { KonfirmasiStatus, PermintaanStokBagian, PermintaanStokRow } from "@kakarut/shared";
import { Card, PageTitle, Spinner, btnSecondary } from "../../components/ui";
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

function Bagian({
  jalur,
  data,
  to,
}: {
  jalur: "produksi" | "beli" | "beli_produksi";
  data: PermintaanStokBagian;
  to: string;
}) {
  const ikon = jalur === "produksi" ? "🏭" : jalur === "beli" ? "🛒" : "🧺";
  const judul =
    jalur === "produksi" ? "Produksi" : jalur === "beli" ? "Beli produk jadi" : "Bahan produksi";
  const label = (jalur === "produksi" ? LABEL_PRODUKSI : LABEL_BELI)[data.status];
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
          <div className="text-xs text-stone-500">≈ {formatRupiah(data.total)}</div>
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

/**
 * Data Permintaan Stok: daftar permintaan "Tambah Stok dari Menu" (owner/admin
 * dari Kantor). Tiap submit = satu kartu, menggabungkan faktur Produksi + Beli.
 */
export function PermintaanStokPage() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["permintaan-stok"],
    queryFn: () => api<PermintaanStokRow[]>("/rekomendasi/permintaan"),
  });
  const list = rows ?? [];

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
        <b>Produksi</b> (work-order Central Kitchen) dan/atau <b>Beli</b> — ketuk untuk membukanya.
      </div>

      {isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada permintaan. Buat lewat “➕ Permintaan baru”.
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <Card key={r.rencana_id} className="p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="font-semibold text-stone-800">
                  {r.tujuan_cabang ? `🏪 ${r.tujuan_cabang}` : "Bahan baku"}
                </div>
                <div className="text-xs text-stone-500">
                  {formatWaktu(r.waktu)}
                  {r.pembuat && ` · oleh ${r.pembuat}`}
                </div>
              </div>
              {r.catatan && <div className="mb-2 text-sm text-stone-600">{r.catatan}</div>}
              <div className="space-y-2">
                {r.produksi && <Bagian jalur="produksi" data={r.produksi} to="/produksi" />}
                {r.beli && <Bagian jalur="beli" data={r.beli} to="/pembelian" />}
                {r.beli_produksi && (
                  <Bagian jalur="beli_produksi" data={r.beli_produksi} to="/pembelian" />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
