import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { MenuDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  tdClass,
  thClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";

function FoodCost({ persen }: { persen: number }) {
  const warna =
    persen <= 40 ? "text-green-600" : persen <= 55 ? "text-yellow-600" : "text-red-600";
  return <span className={`font-semibold ${warna}`}>{persen.toFixed(1)}%</span>;
}

export function MenuListPage() {
  const queryClient = useQueryClient();
  const { data: menus, isLoading } = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuDto[]>("/menu"),
  });

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/menu/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu"] }),
  });

  if (isLoading) return <Spinner />;

  // kelompokkan per kategori mengikuti urutan katalog
  const grup = new Map<string, MenuDto[]>();
  for (const m of menus ?? []) {
    const list = grup.get(m.kategori) ?? [];
    list.push(m);
    grup.set(m.kategori, list);
  }

  return (
    <div>
      <PageTitle
        aksi={
          <Link to="/menu/baru" className={btnPrimary}>
            + Tambah Menu
          </Link>
        }
      >
        Menu &amp; HPP ({menus?.length ?? 0})
      </PageTitle>
      <ErrorText error={hapus.error} />

      {[...grup.entries()].map(([kategori, list]) => (
        <div key={kategori} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold text-stone-700">{kategori}</h2>
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thClass}>Kode</th>
                  <th className={thClass}>Menu</th>
                  <th className={`${thClass} text-right`}>HPP</th>
                  <th className={`${thClass} text-right`}>HPP Dine-in</th>
                  <th className={`${thClass} text-right`}>Markup</th>
                  <th className={`${thClass} text-right`}>Harga Saran</th>
                  <th className={`${thClass} text-right`}>Saran Bulat</th>
                  <th className={`${thClass} text-right`}>Harga Jual</th>
                  <th className={`${thClass} text-right`}>Food Cost</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {list.map((m) => (
                  <tr key={m.id} className="hover:bg-stone-50">
                    <td className={tdClass}>
                      {m.kode ? (
                        <span className="inline-block rounded bg-stone-100 px-2 py-0.5 font-mono text-xs font-semibold text-stone-600">
                          {m.kode}
                        </span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className={`${tdClass} font-medium`}>
                      {m.nama}
                      {m.tipe === "paket" && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          Paket · dasar: {m.base_menu_nama}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} text-right`}>{formatRupiah(m.hpp)}</td>
                    <td className={`${tdClass} text-right text-stone-400`}>
                      {formatRupiah(m.hpp_dine_in)}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      {m.tipe === "paket" ? `dasar ×${m.base_mult}` : `×${m.mult}`}
                    </td>
                    <td className={`${tdClass} text-right`}>{formatRupiah(m.harga_saran)}</td>
                    <td className={`${tdClass} text-right`}>
                      {formatRupiah(m.harga_jual_bulat)}
                    </td>
                    <td className={`${tdClass} text-right font-bold`}>
                      {formatRupiah(m.harga_jual)}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <FoodCost persen={m.food_cost_persen} />
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right`}>
                      <Link
                        to={`/menu/${m.id}/edit`}
                        className="text-sm font-medium text-orange-600 hover:underline"
                      >
                        Ubah
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`Nonaktifkan menu "${m.nama}"?`)) hapus.mutate(m.id);
                        }}
                        className="ml-3 text-sm font-medium text-red-500 hover:underline"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ))}
    </div>
  );
}
