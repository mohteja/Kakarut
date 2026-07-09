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
  if (!auth) return null;

  const role = auth.user.role;
  const isSuperAdmin = auth.user.is_super_admin;
  const isManajemen = role === "owner" || role === "admin";

  return (
    <div className="flex min-h-screen bg-stone-100">
      <aside className="flex w-56 shrink-0 flex-col bg-stone-900 p-4 print:hidden">
        <div className="mb-6 px-2">
          <div className="text-xl font-bold text-white">
            {auth.company?.nama ?? "Kakarut POS"}
          </div>
          <div className="text-xs text-stone-400">
            {isSuperAdmin
              ? "Platform Super Admin"
              : `${auth.user.nama} · ${role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Kasir"}`}
          </div>
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

        <nav className="flex flex-1 flex-col gap-1">
          {isSuperAdmin ? (
            <NavLink to="/superadmin" className={linkClass}>
              🏢 Tenant
            </NavLink>
          ) : (
            <>
              <NavLink to="/kasir" className={linkClass}>
                🧾 Kasir
              </NavLink>
              <NavLink to="/stok" className={linkClass}>
                📦 Stok
              </NavLink>
              <NavLink to="/produksi" className={linkClass}>
                🏭 Produksi
              </NavLink>
              <NavLink to="/laporan" className={linkClass}>
                📊 Laporan
              </NavLink>
              <NavLink to="/pengaturan/printer" className={linkClass}>
                🖨 Printer
              </NavLink>
              {isManajemen && (
                <>
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

      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
