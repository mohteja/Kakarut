import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MejaDto, MenuDto } from "@kakarut/shared";
import { Card, ErrorText, Spinner, btnPrimary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";
import { ReceiptModal, type SaleResult } from "./ReceiptModal";

interface CartLine {
  menu: MenuDto;
  qty: number;
  /** null = ikut pengaturan transaksi */
  dineInOverride: boolean | null;
  /** catatan personalisasi baris (mis. "tanpa gula") */
  catatan: string;
}

interface Kategori {
  id: string;
  nama: string;
  sort_order: number;
}

export function KasirPage() {
  const { auth } = useAuth();
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";

  const { data: menus, isLoading } = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuDto[]>("/menu"),
  });
  const { data: kategori = [] } = useQuery({
    queryKey: ["kategori"],
    queryFn: () => api<Kategori[]>("/kategori"),
  });
  const { data: mejaList = [], isLoading: mejaLoading } = useQuery({
    queryKey: ["meja", branchQuery],
    queryFn: () => api<MejaDto[]>(`/meja${branchQuery}`),
  });
  // Setelan PB1 terbaru dari server (snapshot login bisa basi bila
  // pengaturan perusahaan diubah saat sesi kasir masih terbuka)
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{
        company: { pb1_enabled: boolean; pb1_rate: number; diskon_maks_persen: number } | null;
      }>("/auth/me"),
  });
  const pb1Conf = me?.company ?? auth?.company;

  const [aktifKategori, setAktifKategori] = useState<string | null>(null);
  const [cariMenu, setCariMenu] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mejaId, setMejaId] = useState<string | null>(null);
  // Modal pilih meja muncul lebih dulu tiap memulai transaksi (sebelum keranjang).
  // Otomatis untuk kasir; owner/admin membukanya lewat tombol "Pilih/Ganti".
  const [mejaModalOpen, setMejaModalOpen] = useState(isKasir);
  const [mejaCari, setMejaCari] = useState("");
  const [catatan, setCatatan] = useState("");
  const [diskonTipe, setDiskonTipe] = useState<"persen" | "nominal">("nominal");
  const [diskonNilai, setDiskonNilai] = useState("");
  const [struk, setStruk] = useState<SaleResult | null>(null);

  const mejaAktif = useMemo(() => mejaList.filter((m) => m.is_active), [mejaList]);
  const mejaTerpilih = mejaAktif.find((m) => m.id === mejaId) ?? null;
  // Meja menentukan mode transaksi: meja bernomor = dine-in (default), meja
  // Ruang Tunggu = bawa pulang. Sebelum meja dipilih, tampilan default dine-in.
  const dineIn = mejaTerpilih ? mejaTerpilih.tipe === "dine_in" : true;
  // Pencarian meja: cocok sebagian (mis. ketik "8" → "Meja 8"), tak harus persis.
  const mejaCocok = useMemo(() => {
    const q = mejaCari.trim().toLowerCase();
    if (!q) return mejaAktif;
    return mejaAktif.filter((m) => m.nama.toLowerCase().includes(q));
  }, [mejaAktif, mejaCari]);

  // Bila meja terpilih dinonaktifkan/dihapus dari master, lepaskan pilihan.
  useEffect(() => {
    if (mejaId && !mejaAktif.some((m) => m.id === mejaId)) setMejaId(null);
  }, [mejaId, mejaAktif]);

  // Reset kotak pencarian tiap modal dibuka.
  useEffect(() => {
    if (mejaModalOpen) setMejaCari("");
  }, [mejaModalOpen]);

  function pilihMeja(id: string) {
    setMejaId(id);
    setMejaModalOpen(false);
  }

  const kategoriTampil = useMemo(() => {
    const adaMenu = new Set((menus ?? []).map((m) => m.category_id));
    return kategori.filter((k) => adaMenu.has(k.id));
  }, [kategori, menus]);

  const menuTampil = useMemo(() => {
    const q = cariMenu.trim().toLowerCase();
    const list = menus ?? [];
    // pencarian nama/kode menu berlaku lintas kategori; tanpa pencarian → filter kategori
    if (q)
      return list.filter(
        (m) => m.nama.toLowerCase().includes(q) || (m.kode?.toLowerCase().includes(q) ?? false),
      );
    if (!aktifKategori) return list;
    return list.filter((m) => m.category_id === aktifKategori);
  }, [menus, aktifKategori, cariMenu]);

  function tambah(menu: MenuDto) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.menu.id === menu.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { menu, qty: 1, dineInOverride: null, catatan: "" }];
    });
  }

  function ubahCatatanLine(menuId: string, val: string) {
    setCart((prev) => prev.map((l) => (l.menu.id === menuId ? { ...l, catatan: val } : l)));
  }

  function ubahQty(menuId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.menu.id === menuId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function toggleLineDineIn(menuId: string) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.menu.id !== menuId) return l;
        const efektif = l.dineInOverride ?? dineIn;
        return { ...l, dineInOverride: !efektif };
      }),
    );
  }

  const subtotal = cart.reduce((a, l) => a + l.menu.harga_jual * l.qty, 0);
  // diskon per transaksi (cermin logika server: clamp ke [0, subtotal])
  const diskonNilaiNum = Number(diskonNilai) || 0;
  const diskonRaw =
    diskonNilaiNum <= 0
      ? 0
      : diskonTipe === "persen"
        ? Math.min(subtotal, Math.round((subtotal * Math.min(100, diskonNilaiNum)) / 100))
        : Math.min(subtotal, Math.round(diskonNilaiNum));
  // batas diskon utk KASIR (owner/admin bebas → 100%)
  const maksDiskonPersen = isKasir ? (pb1Conf?.diskon_maks_persen ?? 100) : 100;
  const diskonBoleh = !isKasir || maksDiskonPersen > 0;
  const capNominal = Math.floor((subtotal * maksDiskonPersen) / 100);
  const diskon = Math.min(diskonRaw, capNominal);
  const diskonDibatasi = diskon < diskonRaw;
  const subtotalNet = subtotal - diskon;
  const pb1 = pb1Conf?.pb1_enabled ? Math.round(subtotalNet * (pb1Conf.pb1_rate / 100)) : 0;
  const total = subtotalNet + pb1;

  const bayar = useMutation({
    mutationFn: () =>
      api<SaleResult>("/penjualan", {
        method: "POST",
        body: {
          ...(!isKasir && branchId ? { branch_id: branchId } : {}),
          is_dine_in: dineIn,
          meja_id: mejaId ?? undefined,
          catatan: catatan || undefined,
          ...(diskon > 0 ? { diskon_tipe: diskonTipe, diskon_nilai: diskonNilaiNum } : {}),
          items: cart.map((l) => ({
            menu_id: l.menu.id,
            qty: l.qty,
            ...(l.dineInOverride !== null ? { is_dine_in: l.dineInOverride } : {}),
            ...(l.catatan.trim() ? { catatan: l.catatan.trim() } : {}),
          })),
        },
      }),
    onSuccess: (data) => {
      setStruk(data);
      setCart([]);
      setCatatan("");
      setDiskonNilai("");
      setMejaId(null);
      // modal pilih meja dibuka lagi saat struk ditutup (transaksi berikutnya)
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["laporan"] });
      queryClient.invalidateQueries({ queryKey: ["penjualan"] });
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100vh-3rem)] md:flex-row">
      {/* Katalog — di BAWAH keranjang pada mobile, kiri pada desktop */}
      <div className="order-2 flex min-w-0 flex-col md:order-1 md:flex-1">
        {/* Pencarian menu — di atas kategori */}
        <input
          value={cariMenu}
          onChange={(e) => {
            setCariMenu(e.target.value);
            if (e.target.value) setAktifKategori(null);
          }}
          placeholder="🔍 Cari menu / kode…"
          className="mb-3 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
        />
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => {
              setAktifKategori(null);
              setCariMenu("");
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              aktifKategori === null && !cariMenu
                ? "bg-orange-600 text-white"
                : "bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            Semua
          </button>
          {kategoriTampil.map((k) => (
            <button
              key={k.id}
              onClick={() => {
                setAktifKategori(k.id);
                setCariMenu("");
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                aktifKategori === k.id && !cariMenu
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {k.nama}
            </button>
          ))}
        </div>

        <div className="grid auto-rows-min grid-cols-2 gap-3 pb-4 md:flex-1 md:grid-cols-3 md:overflow-y-auto xl:grid-cols-4">
          {menuTampil.map((m) => (
            <button
              key={m.id}
              onClick={() => tambah(m)}
              className="flex flex-col rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-orange-400 hover:shadow"
            >
              {m.image_url ? (
                <img
                  src={m.image_url}
                  alt={m.nama}
                  className="mb-2 h-20 w-full rounded-lg object-cover"
                />
              ) : (
                <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-orange-50 text-2xl">
                  🍜
                </div>
              )}
              <div className="flex items-start gap-1.5">
                {m.kode && (
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[11px] font-bold leading-tight text-orange-700">
                    {m.kode}
                  </span>
                )}
                <div className="line-clamp-2 text-sm font-semibold text-stone-800">{m.nama}</div>
              </div>
              <div className="mt-auto pt-1 text-sm font-bold text-orange-600">
                {formatRupiah(m.harga_jual)}
              </div>
            </button>
          ))}
          {menuTampil.length === 0 && (
            <div className="col-span-full py-10 text-center text-stone-400">
              {cariMenu ? `Menu "${cariMenu}" tidak ditemukan.` : "Tidak ada menu di kategori ini."}
            </div>
          )}
        </div>
      </div>

      {/* Keranjang — di ATAS pada mobile, kanan pada desktop */}
      <Card className="order-1 flex w-full shrink-0 flex-col p-4 md:order-2 md:w-96">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold text-stone-800">Keranjang</h2>
            <Link
              to="/kasir/riwayat"
              className="text-xs font-medium text-orange-600 hover:underline"
            >
              🕘 Riwayat
            </Link>
          </div>
          <Link
            to="/pengaturan/meja"
            className="text-xs font-medium text-stone-400 hover:text-orange-600 hover:underline"
          >
            ⚙ Atur meja
          </Link>
        </div>

        {/* Meja terpilih (dipilih lewat modal di awal transaksi) + tombol ganti */}
        <button
          onClick={() => setMejaModalOpen(true)}
          className={`mb-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
            mejaTerpilih
              ? dineIn
                ? "border-blue-200 bg-blue-50"
                : "border-amber-200 bg-amber-50"
              : "border-dashed border-stone-300 bg-stone-50"
          }`}
        >
          <span className="min-w-0">
            <span className="block text-xs text-stone-500">Meja</span>
            {mejaTerpilih ? (
              <span className="font-semibold text-stone-800">
                {mejaTerpilih.tipe === "takeaway" ? `🥡 ${mejaTerpilih.nama}` : mejaTerpilih.nama}
                <span
                  className={`ml-2 text-xs font-medium ${dineIn ? "text-blue-600" : "text-amber-600"}`}
                >
                  {dineIn ? "Dine-in" : "Bawa pulang"}
                </span>
              </span>
            ) : (
              <span className="font-semibold text-stone-400">Belum dipilih</span>
            )}
          </span>
          <span className="shrink-0 text-sm font-medium text-orange-600">
            {mejaTerpilih ? "Ganti" : "Pilih"}
          </span>
        </button>

        <div className="space-y-2 md:flex-1 md:overflow-y-auto">
          {cart.length === 0 && (
            <div className="py-10 text-center text-sm text-stone-400">
              Ketuk menu untuk menambahkan.
            </div>
          )}
          {cart.map((l) => {
            const efektifDineIn = l.dineInOverride ?? dineIn;
            return (
              <div key={l.menu.id} className="rounded-lg border border-stone-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-stone-800">
                      {l.menu.nama}
                    </div>
                    <div className="text-xs text-stone-500">
                      {formatRupiah(l.menu.harga_jual)} ×{" "}
                      <span className="font-semibold">{l.qty}</span>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-stone-800">
                    {formatRupiah(l.menu.harga_jual * l.qty)}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => toggleLineDineIn(l.menu.id)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      efektifDineIn
                        ? "bg-blue-100 text-blue-700"
                        : "bg-stone-100 text-stone-600"
                    }`}
                    title="Ganti dine-in / bawa pulang untuk baris ini"
                  >
                    {efektifDineIn ? "Dine-in" : "Bawa pulang"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => ubahQty(l.menu.id, -1)}
                      className="h-7 w-7 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                    <button
                      onClick={() => ubahQty(l.menu.id, 1)}
                      className="h-7 w-7 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50"
                    >
                      +
                    </button>
                  </div>
                </div>
                <input
                  value={l.catatan}
                  onChange={(e) => ubahCatatanLine(l.menu.id, e.target.value)}
                  placeholder="Catatan (mis. tanpa gula, tanpa mie)"
                  className="mt-2 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-xs focus:border-orange-400 focus:bg-white focus:outline-none"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          <input
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Catatan (opsional)"
            className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          />
          <div className="flex justify-between text-sm text-stone-600">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          {/* Diskon per transaksi: toggle %/Rp + input (dibatasi utk kasir) */}
          <div>
            <div className="flex items-center justify-between gap-2 text-sm text-stone-600">
              <div className="flex items-center gap-1.5">
                <span>Diskon</span>
                <div className="flex overflow-hidden rounded-md border border-stone-300 text-xs">
                  <button
                    type="button"
                    disabled={!diskonBoleh}
                    onClick={() => setDiskonTipe("nominal")}
                    className={`px-2 py-1 font-medium disabled:opacity-40 ${diskonTipe === "nominal" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                  >
                    Rp
                  </button>
                  <button
                    type="button"
                    disabled={!diskonBoleh}
                    onClick={() => setDiskonTipe("persen")}
                    className={`px-2 py-1 font-medium disabled:opacity-40 ${diskonTipe === "persen" ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
                  >
                    %
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  max={diskonTipe === "persen" ? (isKasir ? maksDiskonPersen : 100) : undefined}
                  disabled={!diskonBoleh}
                  value={diskonNilai}
                  onChange={(e) => setDiskonNilai(e.target.value)}
                  placeholder="0"
                  className="w-20 rounded-md border border-stone-300 px-2 py-1 text-right text-sm disabled:bg-stone-100"
                />
              </div>
              <span className="text-red-600">{diskon > 0 ? `−${formatRupiah(diskon)}` : "—"}</span>
            </div>
            {isKasir && maksDiskonPersen < 100 && (
              <div className="mt-0.5 text-right text-xs text-stone-400">
                {maksDiskonPersen === 0
                  ? "Diskon hanya oleh owner/admin"
                  : `Maks diskon kasir ${maksDiskonPersen}%${diskonDibatasi ? " · dibatasi" : ""}`}
              </div>
            )}
          </div>
          {pb1 > 0 && (
            <div className="flex justify-between text-sm text-stone-600">
              <span>PB1 ({pb1Conf?.pb1_rate}%)</span>
              <span>{formatRupiah(pb1)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold text-stone-800">
            <span>Total</span>
            <span>{formatRupiah(total)}</span>
          </div>
          <ErrorText error={bayar.error} />
          {cart.length > 0 && !mejaId && (
            <div className="text-center text-xs font-medium text-amber-600">
              Pilih meja dulu sebelum bayar.
            </div>
          )}
          <button
            onClick={() => bayar.mutate()}
            disabled={cart.length === 0 || !mejaId || bayar.isPending}
            className={`${btnPrimary} w-full py-3 text-base`}
          >
            {bayar.isPending ? "Memproses…" : "Bayar & Cetak Struk"}
          </button>
        </div>
      </Card>

      {/* Modal pilih meja — muncul lebih dulu tiap memulai transaksi */}
      {mejaModalOpen && !struk && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setMejaModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-800">Pilih Meja</h2>
              <button
                onClick={() => setMejaModalOpen(false)}
                className="text-stone-400 hover:text-stone-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-stone-500">
              Pilih meja untuk memulai transaksi. Meja bernomor = dine-in; <b>Ruang Tunggu</b> =
              bawa pulang (take away).
            </p>

            {mejaLoading ? (
              <div className="p-6 text-center text-sm text-stone-400">Memuat meja…</div>
            ) : mejaAktif.length === 0 ? (
              <div className="rounded-lg bg-stone-50 p-6 text-center text-sm text-stone-500">
                Belum ada meja aktif.{" "}
                <Link
                  to="/pengaturan/meja"
                  onClick={() => setMejaModalOpen(false)}
                  className="font-medium text-orange-600 hover:underline"
                >
                  Atur meja dulu →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Pencarian: ketik nomor/kata, cocok sebagian (mis. "8" → Meja 8) */}
                <input
                  autoFocus
                  value={mejaCari}
                  onChange={(e) => setMejaCari(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mejaCocok.length === 1) pilihMeja(mejaCocok[0].id);
                  }}
                  placeholder="Cari meja… (mis. 8 atau ruang tunggu)"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
                />
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {mejaCocok.length === 0 && (
                    <div className="py-6 text-center text-sm text-stone-400">
                      Tidak ada meja cocok "{mejaCari}".
                    </div>
                  )}
                  {mejaCocok.map((m) => {
                    const takeaway = m.tipe === "takeaway";
                    const dipilih = mejaId === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => pilihMeja(m.id)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-semibold ${
                          dipilih
                            ? takeaway
                              ? "border-amber-500 bg-amber-500 text-white"
                              : "border-blue-600 bg-blue-600 text-white"
                            : takeaway
                              ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                              : "border-stone-200 bg-white text-stone-700 hover:border-blue-400"
                        }`}
                      >
                        <span>
                          {takeaway ? `🥡 ${m.nama}` : m.nama}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            dipilih ? "text-white/80" : takeaway ? "text-amber-600" : "text-blue-600"
                          }`}
                        >
                          {takeaway ? "Take away" : "Dine-in"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Link
                  to="/pengaturan/meja"
                  onClick={() => setMejaModalOpen(false)}
                  className="block text-center text-xs text-stone-400 hover:text-orange-600 hover:underline"
                >
                  ⚙ Atur / tambah meja
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {struk && (
        <ReceiptModal
          data={struk}
          onClose={() => {
            setStruk(null);
            setMejaModalOpen(isKasir); // kasir: lanjut pilih meja transaksi berikutnya
          }}
        />
      )}
    </div>
  );
}
