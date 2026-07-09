import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import { BranchProvider } from "./context/BranchContext";
import { PrinterProvider } from "./context/PrinterContext";
import { PrinterPage } from "./pages/pengaturan/PrinterPage";
import { BahanPage } from "./pages/bahan/BahanPage";
import { KasirPage } from "./pages/kasir/KasirPage";
import { LaporanPage } from "./pages/laporan/LaporanPage";
import { LoginPage } from "./pages/LoginPage";
import { MenuFormPage } from "./pages/menu/MenuFormPage";
import { MenuListPage } from "./pages/menu/MenuListPage";
import { ProduksiPage } from "./pages/produksi/ProduksiPage";
import { CabangPage } from "./pages/pengaturan/CabangPage";
import { KaryawanPage } from "./pages/pengaturan/KaryawanPage";
import { PerusahaanPage } from "./pages/pengaturan/PerusahaanPage";
import { StokPage } from "./pages/stok/StokPage";
import { SistemPage } from "./pages/superadmin/SistemPage";
import { TenantsPage } from "./pages/superadmin/TenantsPage";

export default function App() {
  const { auth } = useAuth();

  if (!auth) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isSuperAdmin = auth.user.is_super_admin;
  const isManajemen = auth.user.role === "owner" || auth.user.role === "admin";
  const beranda = isSuperAdmin ? "/superadmin" : "/kasir";

  return (
    <BranchProvider>
      <PrinterProvider>
      <Routes>
        <Route path="/login" element={<Navigate to={beranda} replace />} />
        <Route element={<Layout />}>
          {isSuperAdmin && (
            <>
              <Route path="/superadmin" element={<TenantsPage />} />
              <Route path="/superadmin/sistem" element={<SistemPage />} />
            </>
          )}
          {!isSuperAdmin && (
            <>
              <Route path="/kasir" element={<KasirPage />} />
              <Route path="/stok" element={<StokPage />} />
              <Route path="/produksi" element={<ProduksiPage />} />
              <Route path="/laporan" element={<LaporanPage />} />
              {/* printer = pengaturan per perangkat → semua peran, termasuk kasir */}
              <Route path="/pengaturan/printer" element={<PrinterPage />} />
              {isManajemen && (
                <>
                  <Route path="/bahan" element={<BahanPage />} />
                  <Route path="/menu" element={<MenuListPage />} />
                  <Route path="/menu/baru" element={<MenuFormPage />} />
                  <Route path="/menu/:id/edit" element={<MenuFormPage />} />
                  <Route path="/pengaturan/perusahaan" element={<PerusahaanPage />} />
                  <Route path="/pengaturan/cabang" element={<CabangPage />} />
                  <Route path="/pengaturan/karyawan" element={<KaryawanPage />} />
                </>
              )}
            </>
          )}
          <Route path="*" element={<Navigate to={beranda} replace />} />
        </Route>
      </Routes>
      </PrinterProvider>
    </BranchProvider>
  );
}
