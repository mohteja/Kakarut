import { NavLink, useLocation } from "react-router-dom";
import { searchPeriode } from "../../lib/periode";

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "border-orange-600 text-orange-600"
      : "border-transparent text-stone-500 hover:text-stone-700"
  }`;

/**
 * Tab pindah antara keempat laporan — dan periodenya IKUT pindah.
 *
 * Tanpa membawa kunci periode, memilih "Bulan lalu" di Penjualan lalu membuka
 * Menu Terlaris menampilkan HARI INI: dua angka dari dua periode berbeda,
 * berdampingan di bawah judul yang sama, dan orang membandingkannya.
 * Hanya kunci periode yang dibawa (`searchPeriode`), bukan seluruh query.
 */
export function LaporanTabs() {
  const search = searchPeriode(useLocation().search);
  return (
    <div className="mb-4 flex gap-1 border-b border-stone-200">
      <NavLink end to={{ pathname: "/laporan", search }} className={tab}>
        📊 Penjualan
      </NavLink>
      <NavLink to={{ pathname: "/laporan/pembelian", search }} className={tab}>
        🛒 Pembelian
      </NavLink>
      <NavLink to={{ pathname: "/laporan/menu-laris", search }} className={tab}>
        🔥 Menu Terlaris
      </NavLink>
      <NavLink to={{ pathname: "/laporan/durasi-pesanan", search }} className={tab}>
        ⏱ Lama Pesanan
      </NavLink>
    </div>
  );
}
