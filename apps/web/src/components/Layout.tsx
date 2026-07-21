import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Logo } from "./Logo";
import { labelCabang, useBranch, useCabangData } from "../context/BranchContext";
import { api } from "../lib/api";
import { useCompanyMode } from "../lib/useCompanyMode";

/** Urutan pemilih lokasi: Kantor (pusat) dulu, lalu Central Kitchen, lalu store. */
const URUTAN_TIPE = { kantor: 0, central_kitchen: 1, store: 2 } as const;

/**
 * Halaman yang boleh dibuka per divisi (manajemen mode Pro). Satu perusahaan,
 * beda divisi: cabang store = menu kasir; Central Kitchen = menu produksi;
 * Kantor = pusat, semua menu.
 */
const BOLEH_STORE = [
  "/dashboard",
  "/absen",
  "/profil",
  "/kasir",
  "/menu/lihat",
  "/pengaturan/meja",
  "/stok",
  "/penerimaan",
  "/pengaturan/printer",
];
const BOLEH_CK = ["/absen", "/profil", "/stok", "/perlengkapan", "/perlengkapan/beli", "/penerimaan", "/produksi", "/pembelian", "/bahan", "/resep"];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-orange-600 text-white" : "text-stone-300 hover:bg-stone-800 hover:text-white"
  }`;

export function Layout() {
  const { auth, logout } = useAuth();
  const { cabang, branchId, setBranchId, divisi } = useBranch();
  // Badge stok/penerimaan mengikuti "cabang data" (dari Kantor = cabang yang
  // sedang dikelola, sama dengan isi halaman Stok/Penerimaan).
  const { query: dataQuery } = useCabangData();
  const { isPro } = useCompanyMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const roleGuard = auth?.user.role;
  const manajemenGuard = roleGuard === "owner" || roleGuard === "admin";
  // Divisi store/CK membatasi halaman: tautan lama/bookmark di luar divisi
  // dialihkan ke beranda divisinya (store → Beranda, CK → Produksi).
  useEffect(() => {
    if (!manajemenGuard || !divisi || divisi === "kantor") return;
    const daftar = divisi === "store" ? BOLEH_STORE : BOLEH_CK;
    const ok =
      daftar.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`)) &&
      // perencanaan pengadaan (buat faktur produksi/beli) = urusan Kantor/CK,
      // meski path-nya berawalan /stok
      !(divisi === "store" && location.pathname === "/stok/tambah-dari-menu");
    if (!ok) navigate(divisi === "store" ? "/dashboard" : "/produksi", { replace: true });
  }, [divisi, manajemenGuard, location.pathname, navigate]);

  // Jumlah kiriman pembelian yang menunggu diterima → badge di nav "Penerimaan
  // Barang". Pakai ulang GET /penerimaan (key sama dgn PenerimaanPage → cache
  // dedup + auto-update saat kasir terima/tolak). Non-aktif utk super admin
  // (tanpa company). Segarkan berkala karena barang bisa datang kapan saja.
  const { data: pen } = useQuery({
    queryKey: ["penerimaan", dataQuery],
    queryFn: () => api<{ rows: { status: string }[] }>(`/penerimaan${dataQuery}`),
    enabled: !!auth && !auth.user.is_super_admin,
    refetchInterval: 60_000,
  });
  const kirimanMenunggu = pen?.rows.filter((r) => r.status === "menunggu").length ?? 0;

  // Jumlah bahan menipis/habis → badge di nav "Stok". Pakai ulang GET /stok
  // (key sama dgn StokPage → cache dedup). Merah bila ada yang habis, kuning
  // bila hanya menipis.
  const { data: stok } = useQuery({
    queryKey: ["stok", dataQuery],
    queryFn: () => api<{ status: string }[]>(`/stok${dataQuery}`),
    enabled: !!auth && !auth.user.is_super_admin,
    refetchInterval: 120_000,
  });
  const stokKritis = stok?.filter((r) => r.status !== "aman").length ?? 0;
  const adaHabis = stok?.some((r) => r.status === "habis") ?? false;

  // Badge "belum selesai" utk pengadaan (beli & produksi) di nav Central Kitchen
  // — notifikasi bagi tim CK & manajemen: faktur yang masih rencana/dikerjakan/
  // menunggu (belum masuk stok). Aktif hanya bila menu pengadaan tampil.
  const lihatPengadaan =
    !!auth &&
    !auth.user.is_super_admin &&
    ((roleGuard === "tim" &&
      cabang.find((b) => b.id === auth.user.branch_id)?.tipe === "central_kitchen") ||
      (manajemenGuard && divisi !== "store"));
  const qsPengadaan = `${dataQuery}${dataQuery ? "&" : "?"}per_page=200`;
  const { data: prodNav } = useQuery({
    queryKey: ["produksi-nav", dataQuery],
    queryFn: () => api<{ rows: { faktur_id: string; status: string }[] }>(`/produksi${qsPengadaan}`),
    enabled: lihatPengadaan,
    refetchInterval: 60_000,
  });
  const { data: beliNav } = useQuery({
    queryKey: ["pembelian-nav", dataQuery],
    queryFn: () => api<{ rows: { faktur_id: string; status: string }[] }>(`/pembelian${qsPengadaan}`),
    enabled: lihatPengadaan,
    refetchInterval: 60_000,
  });
  const BELUM_SELESAI = new Set(["rencana", "dikerjakan", "menunggu"]);
  const hitungBelum = (rows?: { faktur_id: string; status: string }[]) =>
    new Set((rows ?? []).filter((r) => BELUM_SELESAI.has(r.status)).map((r) => r.faktur_id)).size;
  const produksiBelum = hitungBelum(prodNav?.rows);
  const beliBelum = hitungBelum(beliNav?.rows);

  if (!auth) return null;

  const role = auth.user.role;
  const isSuperAdmin = auth.user.is_super_admin;
  const isManajemen = role === "owner" || role === "admin";
  // Transaksi POS (Kasir + Tutup Kasir) HANYA peran kasir.
  const isKasir = role === "cashier";
  const adaKantor = cabang.some((b) => b.is_active && b.tipe === "kantor");
  // Satu perusahaan, beda divisi: menu sidebar mengikuti jenis lokasi terpilih.
  const dStore = divisi === "store";
  const dCk = divisi === "central_kitchen";
  const penuh = !divisi || divisi === "kantor";
  // Tim: cek stok, lihat menu, profil, penerimaan barang, riwayat transaksi.
  // Karyawan (tim) di CENTRAL KITCHEN menunya beda: profil, produksi bahan
  // baku, beli bahan baku, dan bahan baku.
  const isTim = role === "tim";
  const timDiCk =
    isTim &&
    cabang.find((b) => b.id === auth.user.branch_id)?.tipe === "central_kitchen";
  const namaPerusahaan = auth.company?.nama ?? "Kakarut POS";
  const subJudul = isSuperAdmin
    ? "Platform Super Admin"
    : `${auth.user.nama} · ${
        role === "owner" ? "Owner" : role === "admin" ? "Admin" : role === "tim" ? "Tim" : "Kasir"
      }`;
  // tutup drawer setelah navigasi/aksi di layar mobile
  const tutup = () => setMenuOpen(false);

  // Badge notifikasi oranye (mis. jumlah faktur pengadaan belum selesai).
  const badgeOranye = (n: number) =>
    n > 0 ? (
      <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 px-1 text-xs font-bold text-white">
        {n}
      </span>
    ) : null;
  const navFlex = (s: { isActive: boolean }) => `${linkClass(s)} flex items-center gap-2`;

  // Konten adalah AREA SCROLL TERSENDIRI (terpisah dari sidebar) — tiap
  // pindah halaman, mulai lagi dari paling atas (klik menu bawah sidebar
  // tidak mewarisi posisi scroll halaman sebelumnya).
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-stone-100 md:flex-row print:h-auto print:overflow-visible">
      {/* Bilah atas — hanya mobile */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 md:hidden print:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Buka menu"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-2xl text-stone-700 hover:bg-stone-100"
        >
          ☰
        </button>
        <Logo className="h-9 w-9 shrink-0" />
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

      {/* Sidebar: drawer di mobile (fixed + geser), statis di desktop.
          overflow-y-auto = scroll sidebar TERPISAH dari scroll konten. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[82%] transform flex-col overflow-y-auto bg-stone-900 p-4 transition-transform duration-200 ease-out md:static md:z-auto md:h-full md:w-56 md:max-w-none md:shrink-0 md:translate-x-0 md:transition-none print:hidden ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-start justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-xl font-bold text-white">{namaPerusahaan}</div>
              <div className="truncate text-xs text-stone-400">{subJudul}</div>
            </div>
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

        {/* Pemilih lokasi = HANYA owner (bebas roaming). Admin terkunci di
            Kantor: hanya owner yang boleh mengganti lokasi ke cabang/CK. */}
        {!isSuperAdmin && role === "owner" && isPro && cabang.length > 0 && (
          <select
            value={branchId ?? ""}
            onChange={(e) => setBranchId(e.target.value)}
            className="mb-4 w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-white"
            aria-label="Pilih cabang"
          >
            {cabang
              .filter((b) => b.is_active)
              .sort((a, b) => URUTAN_TIPE[a.tipe] - URUTAN_TIPE[b.tipe])
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {labelCabang(b)}
                </option>
              ))}
          </select>
        )}
        {/* Admin di-pin ke Kantor (pusat) — tampilkan sebagai label statis. */}
        {!isSuperAdmin && role === "admin" && isPro && adaKantor && (
          <div className="mb-4 rounded-lg bg-stone-800 px-3 py-2 text-xs text-stone-300">
            Lokasi: <span className="font-semibold text-white">🏢 Kantor</span>
          </div>
        )}
        {!isSuperAdmin && (role === "cashier" || isTim) && auth.branch && (
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
              <NavLink to="/superadmin/email" className={linkClass}>
                ✉️ Pengaturan Email
              </NavLink>
            </>
          ) : (
            <>
              {isManajemen && !dCk && (
                <NavLink to="/dashboard" className={linkClass}>
                  🏠 Beranda
                </NavLink>
              )}
              {/* Beranda ringkas peran TIM (CK & toko): notifikasi + tugas hari ini */}
              {isTim && (
                <NavLink to="/beranda" className={linkClass}>
                  🏠 Beranda
                </NavLink>
              )}
              {/* Absen: semua peran (termasuk tim) — absen sendiri via tombol
                  (swafoto + radius GPS); admin/kasir juga jadi stasiun pindai. */}
              <NavLink to="/absen" className={linkClass}>
                🖐 Absen
              </NavLink>
              <NavLink to="/profil" className={linkClass}>
                👤 Profil Saya
              </NavLink>
              {/* Karyawan CENTRAL KITCHEN: profil + produksi + beli + bahan baku */}
              {timDiCk && (
                <>
                  <NavLink to="/produksi" className={navFlex}>
                    <span>🏭 Produksi Bahan Baku</span>
                    {badgeOranye(produksiBelum)}
                  </NavLink>
                  <NavLink to="/pembelian" className={navFlex}>
                    <span>🛒 Beli Bahan Baku</span>
                    {badgeOranye(beliBelum)}
                  </NavLink>
                  <NavLink to="/bahan" className={linkClass}>
                    🥩 Bahan Baku
                  </NavLink>
                  <NavLink to="/resep" className={linkClass}>
                    🧾 Resep
                  </NavLink>
                </>
              )}
              {/* Kasir (jual) & Tutup Kasir: HANYA peran kasir */}
              {isKasir && !dCk && (
                <NavLink to="/kasir" className={linkClass}>
                  🧾 Kasir
                </NavLink>
              )}
              {/* Riwayat Transaksi tetap bisa dipantau owner/admin (bukan tim CK) */}
              {!timDiCk && !dCk && (
                <NavLink to="/kasir/riwayat" className={linkClass}>
                  🕘 Riwayat Transaksi
                </NavLink>
              )}
              {isKasir && !dCk && (
                <NavLink to="/kasir/tutup" className={linkClass}>
                  🧮 Tutup Kasir
                </NavLink>
              )}
              {!timDiCk && !dCk && (
                <NavLink to="/menu/lihat" className={linkClass}>
                  🍜 Lihat Menu
                </NavLink>
              )}
              {!isTim && !dCk && (
                <NavLink to="/pengaturan/meja" className={linkClass}>
                  🍽 Meja
                </NavLink>
              )}
              {/* Menu STOK hanya di KANTOR (owner/admin). Di cabang & CK, staf
                  langsung diberi tautan Stock Opname + Riwayat — tugas mereka
                  memang menghitung stok, bukan mengelola halaman Stok. */}
              {isManajemen && penuh ? (
                <NavLink to="/stok" className={(s) => `${linkClass(s)} flex items-center gap-2`}>
                  <span>📦 Stok</span>
                  {stokKritis > 0 && (
                    <span
                      className={`ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-xs font-bold text-white ${adaHabis ? "bg-red-600" : "bg-amber-500"}`}
                      title={adaHabis ? "Ada bahan habis" : "Ada bahan menipis"}
                    >
                      {stokKritis}
                    </span>
                  )}
                </NavLink>
              ) : (
                <>
                  <NavLink to="/stok/opname" className={linkClass}>
                    📋 SO Bahan Baku
                  </NavLink>
                  <NavLink to="/stok/opname-perlengkapan" className={linkClass}>
                    🧰 SO Perlengkapan
                  </NavLink>
                  <NavLink to="/stok/opname/riwayat" className={linkClass}>
                    🕑 Riwayat SO
                  </NavLink>
                </>
              )}
              {!timDiCk && (
                <NavLink to="/penerimaan" className={(s) => `${linkClass(s)} flex items-center gap-2`}>
                  <span>📥 Penerimaan Barang</span>
                  {kirimanMenunggu > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
                      {kirimanMenunggu}
                    </span>
                  )}
                </NavLink>
              )}
              {!isTim && !dCk && (
                <NavLink to="/pengaturan/printer" className={linkClass}>
                  🖨 Printer
                </NavLink>
              )}
              {/* Divisi store = menu kasir saja; Operasional/Manajemen/
                  Pengaturan hanya di Kantor (pusat) — Central Kitchen dapat
                  blok produksinya sendiri. */}
              {isManajemen && (penuh || dCk) && (
                <>
                  <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Operasional
                  </div>
                  {penuh && (
                    <NavLink to="/operasional" className={linkClass}>
                      🕐 Operasional Cabang
                    </NavLink>
                  )}
                  <NavLink to="/produksi" className={navFlex}>
                    <span>🏭 Produksi Bahan Baku</span>
                    {badgeOranye(produksiBelum)}
                  </NavLink>
                  <NavLink to="/pembelian" className={navFlex}>
                    <span>🛒 Beli Bahan Baku</span>
                    {badgeOranye(beliBelum)}
                  </NavLink>
                  <NavLink to="/perlengkapan/beli" className={linkClass}>
                    🧺 Beli Perlengkapan
                  </NavLink>
                  {dCk && (
                    <>
                      <NavLink to="/bahan" className={linkClass}>
                        🥩 Bahan Baku
                      </NavLink>
                      <NavLink to="/perlengkapan" className={linkClass}>
                        🧰 Perlengkapan
                      </NavLink>
                      <NavLink to="/resep" className={linkClass}>
                        🧾 Resep
                      </NavLink>
                    </>
                  )}
                  {penuh && (
                    <>
                      {/* halaman "Tambah Stok dari Menu" diakses lewat tombol
                          ➕ di halaman Permintaan Stok (tidak lagi di sidebar) */}
                      <NavLink to="/permintaan-stok" className={linkClass}>
                        📋 Permintaan Stok
                      </NavLink>
                      <NavLink to="/laporan" className={linkClass}>
                        📊 Laporan
                      </NavLink>
                      <NavLink to="/sampah" className={linkClass}>
                        🗑 Tempat Sampah
                      </NavLink>
                    </>
                  )}
                </>
              )}
              {isManajemen && penuh && (
                <>
                  <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Manajemen
                  </div>
                  <NavLink to="/menu" className={linkClass}>
                    🍜 Menu &amp; HPP
                  </NavLink>
                  <NavLink to="/resep" className={linkClass}>
                    🧾 Resep
                  </NavLink>
                  <NavLink to="/bahan" className={linkClass}>
                    🥩 Bahan Baku
                  </NavLink>
                  <NavLink to="/perlengkapan" className={linkClass}>
                    🧰 Perlengkapan
                  </NavLink>
                  <NavLink to="/member" className={linkClass}>
                    👥 Member
                  </NavLink>
                  <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Pengaturan
                  </div>
                  <NavLink to="/pengaturan/perusahaan" className={linkClass}>
                    🏪 Perusahaan
                  </NavLink>
                  {/* Lite tetap butuh halaman ini: alamat & struk per cabang
                      (tambah cabang tetap khusus Pro) */}
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
                  <NavLink to="/pengaturan/satuan" className={linkClass}>
                    📏 Master Satuan
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

      <main
        ref={mainRef}
        className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6 print:overflow-visible"
      >
        <Outlet />
      </main>
    </div>
  );
}
