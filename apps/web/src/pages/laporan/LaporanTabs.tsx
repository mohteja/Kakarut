import { NavLink } from "react-router-dom";

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "border-orange-600 text-orange-600"
      : "border-transparent text-stone-500 hover:text-stone-700"
  }`;

/** Tab pindah antara Laporan Penjualan & Pembelian. */
export function LaporanTabs() {
  return (
    <div className="mb-4 flex gap-1 border-b border-stone-200">
      <NavLink end to="/laporan" className={tab}>
        📊 Penjualan
      </NavLink>
      <NavLink to="/laporan/pembelian" className={tab}>
        🛒 Pembelian
      </NavLink>
    </div>
  );
}
