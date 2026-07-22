import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import { LandingPage } from "./pages/publik/LandingPage";
import { PrivasiPage } from "./pages/publik/PrivasiPage";
import { SyaratPage } from "./pages/publik/SyaratPage";
import { KontakPage } from "./pages/publik/KontakPage";
import { BantuanPage } from "./pages/publik/BantuanPage";
import { BranchProvider } from "./context/BranchContext";
import { PrinterProvider } from "./context/PrinterContext";
import { PrinterPage } from "./pages/pengaturan/PrinterPage";
import { AbsenPage } from "./pages/absen/AbsenPage";
import { ProfilPage } from "./pages/profil/ProfilPage";
import { BahanPage } from "./pages/bahan/BahanPage";
import { TambahBahanBakuPage } from "./pages/bahan/TambahBahanBakuPage";
import { UbahBahanBakuPage } from "./pages/bahan/UbahBahanBakuPage";
import { KasirPage } from "./pages/kasir/KasirPage";
import { RiwayatPage } from "./pages/kasir/RiwayatPage";
import { ShiftPage } from "./pages/kasir/ShiftPage";
import { LaporanPage } from "./pages/laporan/LaporanPage";
import { LaporanMenuLarisPage } from "./pages/laporan/LaporanMenuLarisPage";
import { LaporanPembelianPage } from "./pages/laporan/LaporanPembelianPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifikasiEmailPage } from "./pages/VerifikasiEmailPage";
import { SmtpPage } from "./pages/superadmin/SmtpPage";
import { OperasionalPage } from "./pages/operasional/OperasionalPage";
import { TimBerandaPage } from "./pages/TimBerandaPage";
import { MemberPage } from "./pages/member/MemberPage";
import { LihatMenuPage } from "./pages/menu/LihatMenuPage";
import { MenuFormPage } from "./pages/menu/MenuFormPage";
import { MenuListPage } from "./pages/menu/MenuListPage";
import { FakturFormPage } from "./pages/produksi/FakturFormPage";
import { PembelianPage } from "./pages/produksi/PembelianPage";
import { PenerimaanPage } from "./pages/produksi/PenerimaanPage";
import { ProduksiPage } from "./pages/produksi/ProduksiPage";
import { RekomendasiBeliPage } from "./pages/produksi/RekomendasiBeliPage";
import { TahapPage } from "./pages/produksi/TahapPage";
import { ResepPage } from "./pages/resep/ResepPage";
import { CabangPage } from "./pages/pengaturan/CabangPage";
import { KaryawanPage } from "./pages/pengaturan/KaryawanPage";
import { MejaPage } from "./pages/pengaturan/MejaPage";
import { SatuanPage } from "./pages/pengaturan/SatuanPage";
import { PenyimpananPage } from "./pages/pengaturan/PenyimpananPage";
import { PerusahaanPage } from "./pages/pengaturan/PerusahaanPage";
import { SupplierPage } from "./pages/pengaturan/SupplierPage";
import { KartuSupplierPage } from "./pages/pengaturan/KartuSupplierPage";
import { KartuStokPage } from "./pages/stok/KartuStokPage";
import { PermintaanStokPage } from "./pages/stok/PermintaanStokPage";
import { StokAwalPage } from "./pages/stok/StokAwalPage";
import { TambahStokDariMenuPage } from "./pages/stok/TambahStokDariMenuPage";
import { OpnamePage } from "./pages/stok/OpnamePage";
import { OpnamePerlengkapanPage } from "./pages/stok/OpnamePerlengkapanPage";
import { OpnameRiwayatPage } from "./pages/stok/OpnameRiwayatPage";
import { StokPage } from "./pages/stok/StokPage";
import { BeliPerlengkapanPage } from "./pages/perlengkapan/BeliPerlengkapanPage";
import { PerlengkapanPage } from "./pages/perlengkapan/PerlengkapanPage";
import { SistemPage } from "./pages/superadmin/SistemPage";
import { TenantsPage } from "./pages/superadmin/TenantsPage";
import { TempatSampahPage } from "./pages/TempatSampahPage";

export default function App() {
  const { auth } = useAuth();
  const { pathname } = useLocation();

  // Halaman publik (tanpa login) — dapat diakses siapa pun, termasuk reviewer
  // App Store/Play Store & pengunjung umum. Didahulukan sebelum gerbang auth.
  if (pathname === "/tentang") return <LandingPage />;
  if (pathname === "/privasi") return <PrivasiPage />;
  if (pathname === "/syarat") return <SyaratPage />;
  if (pathname === "/kontak") return <KontakPage />;
  if (pathname === "/bantuan") return <BantuanPage />;
  // Verifikasi email dari tautan — layar penuh, jalan baik saat login maupun tidak.
  if (pathname === "/verifikasi-email") return <VerifikasiEmailPage />;
  // Root domain saat belum login → landing/marketing (situs utama).
  if (!auth && pathname === "/") return <LandingPage />;

  if (!auth) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/daftar" element={<SignupPage />} />
        <Route path="/lupa-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Login TAPI belum punya perusahaan (bukan super admin) → onboarding penuh
  // layar: buat perusahaan sendiri atau terima undangan.
  if (!auth.user.is_super_admin && !auth.user.company_id) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  const isSuperAdmin = auth.user.is_super_admin;
  const isManajemen = auth.user.role === "owner" || auth.user.role === "admin";
  // Tim: cek stok, lihat menu, profil, penerimaan barang, riwayat transaksi
  const isTim = auth.user.role === "tim";
  // Transaksi POS (Kasir + Tutup Kasir) HANYA peran kasir.
  const isKasir = auth.user.role === "cashier";
  const beranda = isSuperAdmin
    ? "/superadmin"
    : isManajemen
      ? "/dashboard"
      : isTim
        ? "/beranda"
        : "/kasir";

  return (
    <BranchProvider>
      <PrinterProvider>
      <Routes>
        <Route path="/login" element={<Navigate to={beranda} replace />} />
        {/* Opname = layar penuh tanpa sidebar (dipakai langsung di device) */}
        {!isSuperAdmin && (
          <>
            <Route path="/stok/opname" element={<OpnamePage />} />
            <Route path="/stok/opname-perlengkapan" element={<OpnamePerlengkapanPage />} />
            <Route path="/stok/opname/riwayat" element={<OpnameRiwayatPage />} />
          </>
        )}
        <Route element={<Layout />}>
          {isSuperAdmin && (
            <>
              <Route path="/superadmin" element={<TenantsPage />} />
              <Route path="/superadmin/sistem" element={<SistemPage />} />
              <Route path="/superadmin/email" element={<SmtpPage />} />
            </>
          )}
          {!isSuperAdmin && (
            <>
              <Route path="/profil" element={<ProfilPage />} />
              <Route path="/kasir/riwayat" element={<RiwayatPage />} />
              <Route path="/menu/lihat" element={<LihatMenuPage />} />
              <Route path="/stok" element={<StokPage />} />
              <Route path="/penerimaan" element={<PenerimaanPage />} />
              <Route path="/stok/kartu/:ingredientId" element={<KartuStokPage />} />
              {/* Absen: semua peran (tim absen sendiri; admin/kasir + stasiun pindai) */}
              <Route path="/absen" element={<AbsenPage />} />
              {/* Beranda ringkas peran TIM (CK: beli/produksi belum selesai; toko: barang datang) */}
              {isTim && <Route path="/beranda" element={<TimBerandaPage />} />}
              {/* printer & meja — bukan peran tim */}
              {!isTim && (
                <>
                  <Route path="/pengaturan/printer" element={<PrinterPage />} />
                  <Route path="/pengaturan/meja" element={<MejaPage />} />
                </>
              )}
              {/* Transaksi POS (jual + tutup kasir) — HANYA peran kasir */}
              {isKasir && (
                <>
                  <Route path="/kasir" element={<KasirPage />} />
                  <Route path="/kasir/tutup" element={<ShiftPage />} />
                </>
              )}
              {/* Produksi/beli/bahan: manajemen + karyawan Central Kitchen
                  (server menolak tim non-CK; menu hanya tampil utk tim CK) */}
              {(isManajemen || isTim) && (
                <>
                  <Route path="/produksi" element={<ProduksiPage />} />
                  <Route path="/produksi/baru" element={<FakturFormPage tipe="produksi" />} />
                  <Route path="/produksi/tahap" element={<TahapPage />} />
                  <Route path="/pembelian" element={<PembelianPage />} />
                  <Route path="/pembelian/baru" element={<FakturFormPage tipe="beli" />} />
                  <Route path="/pembelian/tahap" element={<TahapPage />} />
                  <Route path="/bahan" element={<BahanPage />} />
                  <Route path="/resep" element={<ResepPage />} />
                </>
              )}
              {isManajemen && (
                <>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/operasional" element={<OperasionalPage />} />
                  {/* master perlengkapan (nama/harga/aturan) — operasi stoknya
                      utk semua peran ada di halaman Stok → tab Perlengkapan */}
                  <Route path="/perlengkapan" element={<PerlengkapanPage />} />
                  <Route path="/perlengkapan/beli" element={<BeliPerlengkapanPage />} />
                  <Route path="/pembelian/rekomendasi" element={<RekomendasiBeliPage />} />
                  <Route path="/stok/tambah-dari-menu" element={<TambahStokDariMenuPage />} />
                  <Route path="/stok/awal" element={<StokAwalPage />} />
                  <Route path="/permintaan-stok" element={<PermintaanStokPage />} />
                  <Route path="/laporan" element={<LaporanPage />} />
                  <Route path="/laporan/pembelian" element={<LaporanPembelianPage />} />
                  <Route path="/laporan/menu-laris" element={<LaporanMenuLarisPage />} />
                  <Route path="/sampah" element={<TempatSampahPage />} />
                  <Route path="/member" element={<MemberPage />} />
                  <Route path="/menu" element={<MenuListPage />} />
                  <Route path="/menu/baru" element={<MenuFormPage />} />
                  <Route path="/menu/:id/edit" element={<MenuFormPage />} />
                  <Route path="/pengaturan/perusahaan" element={<PerusahaanPage />} />
                  <Route path="/pengaturan/cabang" element={<CabangPage />} />
                  <Route path="/pengaturan/karyawan" element={<KaryawanPage />} />
                  <Route path="/pengaturan/supplier" element={<SupplierPage />} />
                  <Route path="/pengaturan/supplier/:id" element={<KartuSupplierPage />} />
                  <Route path="/pengaturan/penyimpanan" element={<PenyimpananPage />} />
                  <Route path="/pengaturan/satuan" element={<SatuanPage />} />
                  <Route path="/bahan/baru" element={<TambahBahanBakuPage />} />
                  <Route path="/bahan/ubah" element={<UbahBahanBakuPage />} />
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
