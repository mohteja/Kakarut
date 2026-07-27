import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./context/AuthContext";
import { BranchProvider } from "./context/BranchContext";
import { PrinterProvider } from "./context/PrinterContext";
// Halaman publik & auth = jalur kritis / kecil → tetap eager (tanpa spinner).
import { LandingPage } from "./pages/publik/LandingPage";
import { PrivasiPage } from "./pages/publik/PrivasiPage";
import { SyaratPage } from "./pages/publik/SyaratPage";
import { KontakPage } from "./pages/publik/KontakPage";
import { BantuanPage } from "./pages/publik/BantuanPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifikasiEmailPage } from "./pages/VerifikasiEmailPage";

// Halaman aplikasi (setelah login) di-LAZY-load per rute → tiap halaman jadi
// chunk terpisah, sehingga bundle awal jauh lebih kecil (library berat seperti
// Leaflet/peta, pemindai QR, dan parser CSV ikut dipecah ke chunk halamannya).
const PrinterPage = lazy(() => import("./pages/pengaturan/PrinterPage").then((m) => ({ default: m.PrinterPage })));
const AbsenPage = lazy(() => import("./pages/absen/AbsenPage").then((m) => ({ default: m.AbsenPage })));
const ProfilPage = lazy(() => import("./pages/profil/ProfilPage").then((m) => ({ default: m.ProfilPage })));
const BahanPage = lazy(() => import("./pages/bahan/BahanPage").then((m) => ({ default: m.BahanPage })));
const DetailBahanPage = lazy(() => import("./pages/bahan/DetailBahanPage").then((m) => ({ default: m.DetailBahanPage })));
const TambahBahanBakuPage = lazy(() => import("./pages/bahan/TambahBahanBakuPage").then((m) => ({ default: m.TambahBahanBakuPage })));
const UbahBahanBakuPage = lazy(() => import("./pages/bahan/UbahBahanBakuPage").then((m) => ({ default: m.UbahBahanBakuPage })));
const KasirPage = lazy(() => import("./pages/kasir/KasirPage").then((m) => ({ default: m.KasirPage })));
const RiwayatPage = lazy(() => import("./pages/kasir/RiwayatPage").then((m) => ({ default: m.RiwayatPage })));
const ShiftPage = lazy(() => import("./pages/kasir/ShiftPage").then((m) => ({ default: m.ShiftPage })));
const LaporanPage = lazy(() => import("./pages/laporan/LaporanPage").then((m) => ({ default: m.LaporanPage })));
const LaporanMenuLarisPage = lazy(() => import("./pages/laporan/LaporanMenuLarisPage").then((m) => ({ default: m.LaporanMenuLarisPage })));
const LaporanPembelianPage = lazy(() => import("./pages/laporan/LaporanPembelianPage").then((m) => ({ default: m.LaporanPembelianPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const SmtpPage = lazy(() => import("./pages/superadmin/SmtpPage").then((m) => ({ default: m.SmtpPage })));
const OperasionalPage = lazy(() => import("./pages/operasional/OperasionalPage").then((m) => ({ default: m.OperasionalPage })));
const TimBerandaPage = lazy(() => import("./pages/TimBerandaPage").then((m) => ({ default: m.TimBerandaPage })));
const MemberPage = lazy(() => import("./pages/member/MemberPage").then((m) => ({ default: m.MemberPage })));
const LihatMenuPage = lazy(() => import("./pages/menu/LihatMenuPage").then((m) => ({ default: m.LihatMenuPage })));
const MenuFormPage = lazy(() => import("./pages/menu/MenuFormPage").then((m) => ({ default: m.MenuFormPage })));
const MenuListPage = lazy(() => import("./pages/menu/MenuListPage").then((m) => ({ default: m.MenuListPage })));
const FakturFormPage = lazy(() => import("./pages/produksi/FakturFormPage").then((m) => ({ default: m.FakturFormPage })));
const PembelianPage = lazy(() => import("./pages/produksi/PembelianPage").then((m) => ({ default: m.PembelianPage })));
const PenerimaanPage = lazy(() => import("./pages/produksi/PenerimaanPage").then((m) => ({ default: m.PenerimaanPage })));
const ProduksiPage = lazy(() => import("./pages/produksi/ProduksiPage").then((m) => ({ default: m.ProduksiPage })));
const RekomendasiBeliPage = lazy(() => import("./pages/produksi/RekomendasiBeliPage").then((m) => ({ default: m.RekomendasiBeliPage })));
const TahapPage = lazy(() => import("./pages/produksi/TahapPage").then((m) => ({ default: m.TahapPage })));
const ResepPage = lazy(() => import("./pages/resep/ResepPage").then((m) => ({ default: m.ResepPage })));
const CabangPage = lazy(() => import("./pages/pengaturan/CabangPage").then((m) => ({ default: m.CabangPage })));
const KaryawanPage = lazy(() => import("./pages/pengaturan/KaryawanPage").then((m) => ({ default: m.KaryawanPage })));
const MejaPage = lazy(() => import("./pages/pengaturan/MejaPage").then((m) => ({ default: m.MejaPage })));
const SatuanPage = lazy(() => import("./pages/pengaturan/SatuanPage").then((m) => ({ default: m.SatuanPage })));
const PenyimpananPage = lazy(() => import("./pages/pengaturan/PenyimpananPage").then((m) => ({ default: m.PenyimpananPage })));
const PerusahaanPage = lazy(() => import("./pages/pengaturan/PerusahaanPage").then((m) => ({ default: m.PerusahaanPage })));
const SupplierPage = lazy(() => import("./pages/pengaturan/SupplierPage").then((m) => ({ default: m.SupplierPage })));
const KartuSupplierPage = lazy(() => import("./pages/pengaturan/KartuSupplierPage").then((m) => ({ default: m.KartuSupplierPage })));
const KartuStokPage = lazy(() => import("./pages/stok/KartuStokPage").then((m) => ({ default: m.KartuStokPage })));
const PermintaanStokPage = lazy(() => import("./pages/stok/PermintaanStokPage").then((m) => ({ default: m.PermintaanStokPage })));
const StokAwalPage = lazy(() => import("./pages/stok/StokAwalPage").then((m) => ({ default: m.StokAwalPage })));
const TambahStokDariMenuPage = lazy(() => import("./pages/stok/TambahStokDariMenuPage").then((m) => ({ default: m.TambahStokDariMenuPage })));
const OpnamePage = lazy(() => import("./pages/stok/OpnamePage").then((m) => ({ default: m.OpnamePage })));
const TransferStokPage = lazy(() => import("./pages/stok/TransferStokPage").then((m) => ({ default: m.TransferStokPage })));
const OpnamePerlengkapanPage = lazy(() => import("./pages/stok/OpnamePerlengkapanPage").then((m) => ({ default: m.OpnamePerlengkapanPage })));
const OpnameRiwayatPage = lazy(() => import("./pages/stok/OpnameRiwayatPage").then((m) => ({ default: m.OpnameRiwayatPage })));
const StokPage = lazy(() => import("./pages/stok/StokPage").then((m) => ({ default: m.StokPage })));
const BeliPerlengkapanPage = lazy(() => import("./pages/perlengkapan/BeliPerlengkapanPage").then((m) => ({ default: m.BeliPerlengkapanPage })));
const PerlengkapanPage = lazy(() => import("./pages/perlengkapan/PerlengkapanPage").then((m) => ({ default: m.PerlengkapanPage })));
const SistemPage = lazy(() => import("./pages/superadmin/SistemPage").then((m) => ({ default: m.SistemPage })));
const BackupPage = lazy(() => import("./pages/superadmin/BackupPage").then((m) => ({ default: m.BackupPage })));
const ErrorLogPage = lazy(() => import("./pages/superadmin/ErrorLogPage").then((m) => ({ default: m.ErrorLogPage })));
const TenantsPage = lazy(() => import("./pages/superadmin/TenantsPage").then((m) => ({ default: m.TenantsPage })));
const TempatSampahPage = lazy(() => import("./pages/TempatSampahPage").then((m) => ({ default: m.TempatSampahPage })));

/** Fallback saat chunk halaman sedang dimuat (lazy). */
function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <Spinner />
    </div>
  );
}

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
  // Kitchen/Bar: seperti tim di cabang store + Produksi lokal divisinya
  // (hasil masuk stok cabang) — kitchen resep divisi kitchen, bar divisi bar.
  const isKitchen = auth.user.role === "kitchen";
  const isBar = auth.user.role === "bar";
  // Transaksi POS (Kasir + Tutup Kasir) HANYA peran kasir.
  const isKasir = auth.user.role === "cashier";
  const beranda = isSuperAdmin
    ? "/superadmin"
    : isManajemen
      ? "/dashboard"
      : isTim || isKitchen || isBar
        ? "/beranda"
        : "/kasir";

  return (
    <BranchProvider>
      <PrinterProvider>
      {/* Satu batas Suspense: menampilkan spinner saat chunk halaman (lazy) dimuat. */}
      <Suspense fallback={<PageLoading />}>
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
              <Route path="/superadmin/backup" element={<BackupPage />} />
              <Route path="/superadmin/error-log" element={<ErrorLogPage />} />
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
              {/* Beranda ringkas peran TIM/KITCHEN (CK: beli/produksi belum selesai; toko: barang datang) */}
              {(isTim || isKitchen || isBar) && <Route path="/beranda" element={<TimBerandaPage />} />}
              {/* Transfer stok — DILIHAT semua peran (kasir termasuk: perlu tahu
                  barang yang sedang menuju cabangnya). Yang boleh MENGIRIM
                  hanya Central Kitchen; halaman menyembunyikan formulirnya di
                  luar CK dan server menolak asal non-CK dengan 403. */}
              <Route path="/transfer-stok" element={<TransferStokPage />} />
              {/* printer & meja — bukan peran tim/kitchen/bar */}
              {!isTim && !isKitchen && !isBar && (
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
                  {/* Detail Produk per bahan — /bahan/baru & /bahan/ubah menang
                      (segmen statis diprioritaskan router di atas :id) */}
                  <Route path="/bahan/:id" element={<DetailBahanPage />} />
                  <Route path="/resep" element={<ResepPage />} />
                </>
              )}
              {/* Kitchen/Bar (divisi produksi cabang store): Produksi lokal
                  divisinya + Resep (BACA saja: cara masak & takaran) — tanpa
                  pembelian/bahan (server menggerbang juga). */}
              {(isKitchen || isBar) && (
                <>
                  <Route path="/produksi" element={<ProduksiPage />} />
                  <Route path="/produksi/baru" element={<FakturFormPage tipe="produksi" />} />
                  <Route path="/produksi/tahap" element={<TahapPage />} />
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
      </Suspense>
      </PrinterProvider>
    </BranchProvider>
  );
}
