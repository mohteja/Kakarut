import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import { BranchProvider } from "./context/BranchContext";
import { PrinterProvider } from "./context/PrinterContext";
import { PrinterPage } from "./pages/pengaturan/PrinterPage";
import { BahanPage } from "./pages/bahan/BahanPage";
import { KasirPage } from "./pages/kasir/KasirPage";
import { RiwayatPage } from "./pages/kasir/RiwayatPage";
import { LaporanPage } from "./pages/laporan/LaporanPage";
import { LaporanPembelianPage } from "./pages/laporan/LaporanPembelianPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { LihatMenuPage } from "./pages/menu/LihatMenuPage";
import { MenuFormPage } from "./pages/menu/MenuFormPage";
import { MenuListPage } from "./pages/menu/MenuListPage";
import { FakturFormPage } from "./pages/produksi/FakturFormPage";
import { PembelianPage } from "./pages/produksi/PembelianPage";
import { PenerimaanPage } from "./pages/produksi/PenerimaanPage";
import { ProduksiPage } from "./pages/produksi/ProduksiPage";
import { RekomendasiBeliPage } from "./pages/produksi/RekomendasiBeliPage";
import { CabangPage } from "./pages/pengaturan/CabangPage";
import { KaryawanPage } from "./pages/pengaturan/KaryawanPage";
import { MejaPage } from "./pages/pengaturan/MejaPage";
import { PenyimpananPage } from "./pages/pengaturan/PenyimpananPage";
import { PerusahaanPage } from "./pages/pengaturan/PerusahaanPage";
import { SupplierPage } from "./pages/pengaturan/SupplierPage";
import { KartuStokPage } from "./pages/stok/KartuStokPage";
import { OpnamePage } from "./pages/stok/OpnamePage";
import { OpnameRiwayatPage } from "./pages/stok/OpnameRiwayatPage";
import { PenyesuaianPage } from "./pages/stok/PenyesuaianPage";
import { StokPage } from "./pages/stok/StokPage";
import { SistemPage } from "./pages/superadmin/SistemPage";
import { TenantsPage } from "./pages/superadmin/TenantsPage";
import { TempatSampahPage } from "./pages/TempatSampahPage";

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
  const beranda = isSuperAdmin ? "/superadmin" : isManajemen ? "/dashboard" : "/kasir";

  return (
    <BranchProvider>
      <PrinterProvider>
      <Routes>
        <Route path="/login" element={<Navigate to={beranda} replace />} />
        {/* Opname = layar penuh tanpa sidebar (dipakai langsung di device) */}
        {!isSuperAdmin && (
          <>
            <Route path="/stok/opname" element={<OpnamePage />} />
            <Route path="/stok/opname/riwayat" element={<OpnameRiwayatPage />} />
          </>
        )}
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
              <Route path="/kasir/riwayat" element={<RiwayatPage />} />
              <Route path="/menu/lihat" element={<LihatMenuPage />} />
              <Route path="/stok" element={<StokPage />} />
              <Route path="/penerimaan" element={<PenerimaanPage />} />
              <Route path="/stok/penyesuaian" element={<PenyesuaianPage />} />
              <Route path="/stok/kartu/:ingredientId" element={<KartuStokPage />} />
              {/* printer & meja = pengaturan kasir → semua peran, termasuk kasir */}
              <Route path="/pengaturan/printer" element={<PrinterPage />} />
              <Route path="/pengaturan/meja" element={<MejaPage />} />
              {isManajemen && (
                <>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/produksi" element={<ProduksiPage />} />
                  <Route path="/produksi/baru" element={<FakturFormPage tipe="produksi" />} />
                  <Route path="/pembelian" element={<PembelianPage />} />
                  <Route path="/pembelian/baru" element={<FakturFormPage tipe="beli" />} />
                  <Route path="/pembelian/rekomendasi" element={<RekomendasiBeliPage />} />
                  <Route path="/laporan" element={<LaporanPage />} />
                  <Route path="/laporan/pembelian" element={<LaporanPembelianPage />} />
                  <Route path="/sampah" element={<TempatSampahPage />} />
                  <Route path="/bahan" element={<BahanPage />} />
                  <Route path="/menu" element={<MenuListPage />} />
                  <Route path="/menu/baru" element={<MenuFormPage />} />
                  <Route path="/menu/:id/edit" element={<MenuFormPage />} />
                  <Route path="/pengaturan/perusahaan" element={<PerusahaanPage />} />
                  <Route path="/pengaturan/cabang" element={<CabangPage />} />
                  <Route path="/pengaturan/karyawan" element={<KaryawanPage />} />
                  <Route path="/pengaturan/supplier" element={<SupplierPage />} />
                  <Route path="/pengaturan/penyimpanan" element={<PenyimpananPage />} />
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
