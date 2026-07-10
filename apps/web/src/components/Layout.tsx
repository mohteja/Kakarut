import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useBranch } from "../context/BranchContext";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-orange-600 text-white" : "text-stone-300 hover:bg-stone-800 hover:text-white"
  }`;

export function Layout() {
  const { auth, logout } = useAuth();
  const { cabang, branchId, setBranchId } = useBranch();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!auth) return null;

  const role = auth.user.role;
  const isSuperAdmin = auth.user.is_super_admin;
  const isManajemen = role === "owner" || role === "admin";
  const namaPerusahaan = auth.company?.nama ?? "Kakarut POS";
  const subJudul = isSuperAdmin
    ? "Platform Super Admin"
    : `${auth.user.nama} · ${role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Kasir"}`;
  // tutup drawer setelah navigasi/aksi di layar mobile
  const tutup = () => setMenuOpen(false);

  return (
    <div className="flex min-h-screen flex-col bg-stone-100 md:flex-row">
      {/* Bilah atas — hanya mobile */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 md:hidden print:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Buka menu"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-2xl text-stone-700 hover:bg-stone-100"
        >
          ☰
        </button>
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-stone-800">{namaPerusahaan}</div>
          <div className="truncate text-xs text-stone-500">{subJudul}</div>
        </div>
      </header>

      {/* Backdrop saat drawer terbuka (mobile) */}
      {menuOpen && (
        <div
          onClick={tutup}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar: drawer di mobile (fixed + geser), statis di desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[82%] transform flex-col overflow-y-auto bg-stone-900 p-4 transition-transform duration-200 ease-out md:static md:z-auto md:w-56 md:max-w-none md:translate-x-0 md:transition-none print:hidden ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-start justify-between gap-2 px-2">
          <div className="min-w-0">
            <div className="truncate text-xl font-bold text-white">{namaPerusahaan}</div>
            <div className="truncate text-xs text-stone-400">{subJudul}</div>
          </div>
          {/* Tombol tutup — hanya mobile */}
          <button
            onClick={tutup}
            aria-label="Tutup menu"
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xl text-stone-400 hover:bg-stone-800 hover:text-white md:hidden"
          >
            ✕
          </button>
        </div>

        {!isSuperAdmin && isManajemen && cabang.length > 0 && (
          <select
            value={branchId ?? ""}
            onChange={(e) => setBranchId(e.target.value)}
            className="mb-4 w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-white"
            aria-label="Pilih cabang"
          >
            {cabang
              .filter((b) => b.is_active)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  Cabang: {b.nama}
                </option>
              ))}
          </select>
        )}
        {!isSuperAdmin && role === "cashier" && auth.branch && (
          <div className="mb-4 rounded-lg bg-stone-800 px-3 py-2 text-xs text-stone-300">
            Cabang: <span className="font-semibold text-white">{auth.branch.nama}</span>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1" onClick={tutup}>
          {isSuperAdmin ? (
            <>
              <NavLink to="/superadmin" end className={linkClass}>
                🏢 Tenant
              </NavLink>
              <NavLink to="/superadmin/sistem" className={linkClass}>
                🗄 Sistem &amp; Migrasi
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/kasir" className={linkClass}>
                🧾 Kasir
              </NavLink>
              <NavLink to="/kasir/riwayat" className={linkClass}>
                🕘 Riwayat Transaksi
              </NavLink>
              <NavLink to="/pengaturan/meja" className={linkClass}>
                🍽 Meja
              </NavLink>
              <NavLink to="/stok" className={linkClass}>
                📦 Stok
              </NavLink>
              <NavLink to="/stok/penyesuaian" className={linkClass}>
                ⚠️ Penyesuaian Stok
              </NavLink>
              <NavLink to="/pengaturan/printer" className={linkClass}>
                🖨 Printer
              </NavLink>
              {isManajemen && (
                <>
                  <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Operasional
                  </div>
                  <NavLink to="/produksi" className={linkClass}>
                    🏭 Produksi Bahan Baku
                  </NavLink>
                  <NavLink to="/pembelian" className={linkClass}>
                    🛒 Beli Bahan Baku
                  </NavLink>
                  <NavLink to="/laporan" className={linkClass}>
                    📊 Laporan
                  </NavLink>
                  <NavLink to="/sampah" className={linkClass}>
                    🗑 Tempat Sampah
                  </NavLink>
                  <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Manajemen
                  </div>
                  <NavLink to="/menu" className={linkClass}>
                    🍜 Menu &amp; HPP
                  </NavLink>
                  <NavLink to="/bahan" className={linkClass}>
                    🥩 Bahan Baku
                  </NavLink>
                  <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Pengaturan
                  </div>
                  <NavLink to="/pengaturan/perusahaan" className={linkClass}>
                    🏪 Perusahaan
                  </NavLink>
                  <NavLink to="/pengaturan/cabang" className={linkClass}>
                    📍 Cabang
                  </NavLink>
                  <NavLink to="/pengaturan/karyawan" className={linkClass}>
                    👥 Karyawan
                  </NavLink>
                  <NavLink to="/pengaturan/supplier" className={linkClass}>
                    🚚 Supplier
                  </NavLink>
                  <NavLink to="/pengaturan/penyimpanan" className={linkClass}>
                    🗃 Tempat Penyimpanan
                  </NavLink>
                </>
              )}
            </>
          )}
        </nav>

        <button
          onClick={logout}
          className="mt-4 rounded-lg border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800"
        >
          Keluar
        </button>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
