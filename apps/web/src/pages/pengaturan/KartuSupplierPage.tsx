import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { SupplierKartu } from "@kakarut/shared";
import { Card, PageTitle, Spinner, btnSecondary, tdClass, thClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatWaktu } from "../../lib/format";
import { STATUS_BELI } from "../produksi/TambahStokPage";

/**
 * KARTU SUPPLIER: profil + ringkasan belanja + bahan yang menautkan supplier
 * ini + riwayat transaksi pembelian yang tercatat kepadanya (diisi manual di
 * faktur atau otomatis dari supplier utama bahan saat belanja Diproses).
 */
export function KartuSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["supplier-kartu", id],
    queryFn: () => api<SupplierKartu>(`/supplier/${id}/kartu`),
    enabled: !!id,
  });

  if (isLoading || !data) return <Spinner />;
  const s = data.supplier;

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <Link to="/pengaturan/supplier" className={btnSecondary}>
            ‹ Semua Supplier
          </Link>
        }
      >
        🚚 Kartu Supplier — {s.nama}
      </PageTitle>

      {/* Profil + ringkasan belanja */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4 sm:col-span-1">
          <div className="text-sm font-bold text-stone-800">{s.nama}</div>
          <div className="mt-1 space-y-0.5 text-xs text-stone-500">
            <div>📞 {s.telepon ?? "—"}</div>
            <div>📍 {s.alamat ?? "alamat belum diisi"}</div>
            {s.catatan && <div>📝 {s.catatan}</div>}
            {!s.is_active && (
              <span className="inline-block rounded-full bg-stone-100 px-2 py-0.5 font-semibold text-stone-500">
                Nonaktif
              </span>
            )}
          </div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-xs text-stone-500">Total belanja (diterima ✓)</div>
          <div className="mt-1 text-xl font-bold text-stone-800">
            {formatRupiah(data.total_belanja)}
          </div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-xs text-stone-500">Jumlah transaksi</div>
          <div className="mt-1 text-xl font-bold text-stone-800">{data.jumlah_transaksi}</div>
          <div className="text-xs text-stone-400">faktur pembelian</div>
        </Card>
      </div>

      {/* Bahan yang menautkan supplier ini */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">
          Bahan yang dibeli di sini ({data.bahan.length})
        </h2>
        {data.bahan.length === 0 ? (
          <div className="text-sm text-stone-400">
            Belum ada bahan yang menautkan supplier ini — atur lewat tombol supplier di halaman{" "}
            <Link to="/bahan" className="font-medium text-orange-600 hover:underline">
              Bahan Baku
            </Link>
            .
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.bahan.map((b) => (
              <span
                key={b.ingredient_id}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  b.is_utama
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-stone-200 bg-white text-stone-600"
                }`}
                title={b.is_utama ? "Supplier utama bahan ini" : "Supplier alternatif"}
              >
                {b.is_utama && "★ "}
                {b.nama}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Riwayat transaksi */}
      <h2 className="mb-2 text-sm font-semibold text-stone-700">
        Riwayat transaksi pembelian
      </h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Waktu</th>
              <th className={thClass}>Faktur</th>
              <th className={thClass}>Bahan</th>
              <th className={`${thClass} text-right`}>Qty</th>
              <th className={`${thClass} text-right`}>Total</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Cabang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.rows.map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className={`${tdClass} whitespace-nowrap text-xs text-stone-500`}>
                  {formatWaktu(r.waktu)}
                </td>
                <td className={`${tdClass} font-mono text-xs`}>{r.no_faktur ?? "—"}</td>
                <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  {formatAngka(r.qty)} <span className="text-stone-400">{r.satuan}</span>
                </td>
                <td className={`${tdClass} text-right`}>
                  {r.total_harga == null ? "—" : formatRupiah(r.total_harga)}
                </td>
                <td className={tdClass}>
                  <span
                    className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BELI[r.status].cls}`}
                  >
                    {STATUS_BELI[r.status].label}
                  </span>
                </td>
                <td className={`${tdClass} text-xs text-stone-500`}>{r.cabang ?? "—"}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-stone-400">
                  Belum ada transaksi tercatat ke supplier ini. Transaksi tercatat otomatis
                  saat belanja bahan (yang supplier utamanya di sini) mulai <b>Diproses</b>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
