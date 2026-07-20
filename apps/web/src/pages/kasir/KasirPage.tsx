import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  MejaDto,
  MemberCariRow,
  MenuDto,
  MenuStokDto,
  MetodeBayar,
  OpenBillDetail,
  OpenBillRow,
} from "@kakarut/shared";
import { Card, ErrorText, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
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

/**
 * Badge sisa porsi untuk kasir. `porsi` null → menu tak terlacak stoknya →
 * tak menampilkan apa pun. 0 → "Habis" (merah) + bahan PEMBATAS yang kosong
 * (biar jelas KENAPA habis & apa yang perlu ditambah/dikirim ke cabang);
 * sedikit (≤5) → oranye; sisanya hijau. `size` mengatur kepadatan untuk tile
 * kode yang mungil.
 */
function StokBadge({ stok, size = "md" }: { stok: MenuStokDto | undefined; size?: "sm" | "md" }) {
  const porsi = stok?.porsi;
  if (porsi == null) return null;
  const kecil = size === "sm";
  const base = kecil ? "text-[9px] leading-none" : "text-[11px]";
  if (porsi <= 0) {
    // bahan pembatas = bahan resep yang saldonya 0 di cabang ini → sumber "Habis".
    const kurang = stok?.pembatas?.nama;
    return (
      <span
        className={`font-semibold text-red-600 ${base}`}
        title={kurang ? `Habis — bahan "${kurang}" kosong di cabang ini` : "Habis"}
      >
        Habis{kurang && !kecil ? ` · ${kurang}` : ""}
      </span>
    );
  }
  const warna = porsi <= 5 ? "text-orange-600" : "text-emerald-600";
  return <span className={`font-medium ${warna} ${base}`}>Sisa {porsi}</span>;
}

export function KasirPage() {
  const { auth } = useAuth();
  // Kasir butuh satu cabang konkret (menu, meja, shift, open bill) — dari
  // Kantor berjualan atas nama cabang yang dipilih di CabangDataBar.
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const isKasir = auth?.user.role === "cashier";

  // Menu per lokasi: kasir difilter otomatis oleh server; owner/admin
  // mengirim cabang aktif via branchQuery agar tampilan sesuai lokasi.
  const { data: menus, isLoading } = useQuery({
    queryKey: ["menu", branchQuery],
    queryFn: () => api<MenuDto[]>(`/menu${branchQuery}`),
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
  // Mode tampilan katalog: "foto" (kartu thumbnail) / "kode" (ringkas per kategori)
  const [tampilan, setTampilan] = useState<"foto" | "kode">(() => {
    try {
      return localStorage.getItem("kakarut.kasirTampilan") === "kode" ? "kode" : "foto";
    } catch {
      return "foto";
    }
  });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mejaId, setMejaId] = useState<string | null>(null);
  // Modal pilih meja muncul lebih dulu tiap memulai transaksi (sebelum keranjang).
  // Otomatis untuk kasir; owner/admin membukanya lewat tombol "Pilih/Ganti".
  const [mejaModalOpen, setMejaModalOpen] = useState(isKasir);
  const [mejaCari, setMejaCari] = useState("");
  const [konsumenNama, setKonsumenNama] = useState("");
  const [konsumenWa, setKonsumenWa] = useState("");
  // Autocomplete member: q pencarian + apakah dropdown terbuka
  const [cariMember, setCariMember] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const [diskonTipe, setDiskonTipe] = useState<"persen" | "nominal">("nominal");
  const [diskonNilai, setDiskonNilai] = useState("");
  const [metodeBayar, setMetodeBayar] = useState<MetodeBayar>("tunai");
  const [uangDiterima, setUangDiterima] = useState("");
  const [struk, setStruk] = useState<SaleResult | null>(null);
  // Modal "Resume Order" (diskon + pembayaran) muncul saat tombol Lanjut ditekan
  const [resumeOpen, setResumeOpen] = useState(false);
  // id open bill yang sedang dibuka/diedit (null = pesanan baru)
  const [editingBillId, setEditingBillId] = useState<string | null>(null);

  const { data: openBills = [] } = useQuery({
    queryKey: ["open-bill", branchQuery],
    queryFn: () => api<OpenBillRow[]>(`/open-bill${branchQuery}`),
  });

  // Sisa porsi tiap menu di cabang aktif (info "sisa 2 lagi" untuk kasir).
  const { data: ketersediaan = [] } = useQuery({
    queryKey: ["menu-ketersediaan", branchQuery],
    queryFn: () => api<MenuStokDto[]>(`/menu/ketersediaan${branchQuery}`),
  });
  const sisaByMenu = useMemo(
    () => new Map(ketersediaan.map((k) => [k.menu_id, k])),
    [ketersediaan],
  );

  // Autocomplete member: cari nama/WA yang cocok saat mengetik salah satu field.
  const { data: memberSaran = [] } = useQuery({
    queryKey: ["member-cari", cariMember.trim()],
    queryFn: () =>
      api<MemberCariRow[]>(`/member-cari?q=${encodeURIComponent(cariMember.trim())}`),
    enabled: memberOpen && cariMember.trim().length >= 1,
  });

  // Pilih member dari dropdown → isi nama & WA sekaligus, tutup dropdown.
  function pilihMember(m: MemberCariRow) {
    setKonsumenNama(m.nama);
    setKonsumenWa(m.wa);
    setMemberOpen(false);
    setCariMember("");
  }

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

  // Ganti cabang data di tengah sesi (dari Kantor) → keranjang, open bill,
  // dan data konsumen milik cabang sebelumnya tidak boleh terbawa: transaksi
  // akan terkirim dengan branch_id BARU sementara isinya dari katalog lama.
  const cabangSebelum = useRef(branchId);
  useEffect(() => {
    if (cabangSebelum.current === branchId) return;
    cabangSebelum.current = branchId;
    resetTransaksi();
  }, [branchId]);

  // Reset kotak pencarian tiap modal dibuka.
  useEffect(() => {
    if (mejaModalOpen) setMejaCari("");
  }, [mejaModalOpen]);

  // Simpan preferensi tampilan katalog (foto / kode) antar sesi.
  useEffect(() => {
    try {
      localStorage.setItem("kakarut.kasirTampilan", tampilan);
    } catch {
      /* localStorage tak tersedia */
    }
  }, [tampilan]);

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

  // Tampilan "kode": semua menu dikelompokkan per kategori (lintas kategori,
  // mengabaikan kategori aktif) — semua kategori tampil sekaligus. Pencarian
  // nama/kode tetap berlaku.
  const menuKodeGroups = useMemo(() => {
    const q = cariMenu.trim().toLowerCase();
    const list = (menus ?? []).filter(
      (m) => !q || m.nama.toLowerCase().includes(q) || (m.kode?.toLowerCase().includes(q) ?? false),
    );
    const byCat = new Map<string, MenuDto[]>();
    for (const m of list) {
      const arr = byCat.get(m.category_id) ?? [];
      arr.push(m);
      byCat.set(m.category_id, arr);
    }
    return kategoriTampil
      .map((k) => ({ kategori: k, items: byCat.get(k.id) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [menus, cariMenu, kategoriTampil]);

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
  // pembayaran tunai: uang diterima → kembalian; kurang = uang < total
  const uangNum = Number(uangDiterima) || 0;
  const uangKurang = metodeBayar === "tunai" && uangNum > 0 && uangNum < total;
  const kembalian = metodeBayar === "tunai" && uangNum > total ? uangNum - total : 0;

  const bayar = useMutation({
    mutationFn: () =>
      api<SaleResult>("/penjualan", {
        method: "POST",
        body: {
          ...(!isKasir && branchId ? { branch_id: branchId } : {}),
          is_dine_in: dineIn,
          meja_id: mejaId ?? undefined,
          ...(konsumenNama.trim() ? { customer_nama: konsumenNama.trim() } : {}),
          ...(konsumenWa.trim() ? { customer_wa: konsumenWa.trim() } : {}),
          metode_bayar: metodeBayar,
          ...(metodeBayar === "tunai" && uangNum > 0 ? { uang_diterima: uangNum } : {}),
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
      setResumeOpen(false);
      // bila membayar open bill → hapus bill (sudah menjadi transaksi)
      if (editingBillId) api(`/open-bill/${editingBillId}`, { method: "DELETE" }).catch(() => {});
      resetTransaksi();
      // modal pilih meja dibuka lagi saat struk ditutup (transaksi berikutnya)
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["laporan"] });
      queryClient.invalidateQueries({ queryKey: ["penjualan"] });
      queryClient.invalidateQueries({ queryKey: ["open-bill"] });
      queryClient.invalidateQueries({ queryKey: ["menu-ketersediaan"] });
    },
  });

  // Kosongkan seluruh state transaksi (dipakai setelah bayar / simpan bill).
  function resetTransaksi() {
    setCart([]);
    setKonsumenNama("");
    setKonsumenWa("");
    setCariMember("");
    setMemberOpen(false);
    setDiskonNilai("");
    setMetodeBayar("tunai");
    setUangDiterima("");
    setMejaId(null);
    setEditingBillId(null);
  }

  // Simpan keranjang sebagai open bill (belum dibayar) — buat baru / perbarui.
  const simpanBill = useMutation({
    mutationFn: () => {
      const body = {
        ...(!isKasir && branchId ? { branch_id: branchId } : {}),
        meja_id: mejaId ?? undefined,
        ...(konsumenNama.trim() ? { customer_nama: konsumenNama.trim() } : {}),
        ...(konsumenWa.trim() ? { customer_wa: konsumenWa.trim() } : {}),
        items: cart.map((l) => ({
          menu_id: l.menu.id,
          qty: l.qty,
          ...(l.dineInOverride !== null ? { dine_in_override: l.dineInOverride } : {}),
          ...(l.catatan.trim() ? { catatan: l.catatan.trim() } : {}),
        })),
      };
      return editingBillId
        ? api(`/open-bill/${editingBillId}`, { method: "PUT", body })
        : api("/open-bill", { method: "POST", body });
    },
    onSuccess: () => {
      resetTransaksi();
      queryClient.invalidateQueries({ queryKey: ["open-bill"] });
    },
  });

  // Buka open bill → muat kembali item & data ke keranjang untuk dilanjut/bayar.
  async function bukaBill(id: string) {
    const bill = await api<OpenBillDetail>(`/open-bill/${id}`);
    const menuById = new Map((menus ?? []).map((m) => [m.id, m]));
    const lines: CartLine[] = [];
    for (const it of bill.items) {
      const menu = menuById.get(it.menu_id);
      if (menu) lines.push({ menu, qty: it.qty, dineInOverride: it.dine_in_override, catatan: it.catatan ?? "" });
    }
    setCart(lines);
    setMejaId(bill.meja_id);
    setKonsumenNama(bill.customer_nama ?? "");
    setKonsumenWa(bill.customer_wa ?? "");
    setEditingBillId(id);
    setMejaModalOpen(false);
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100vh-3rem)]">
      <CabangDataBar />
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
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
        {/* Toggle tampilan: foto (thumbnail) / kode (ringkas per kategori) */}
        <div className="mb-3 flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
            <button
              type="button"
              onClick={() => setTampilan("foto")}
              className={`px-3 py-1.5 font-medium ${
                tampilan === "foto"
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              🖼 Foto
            </button>
            <button
              type="button"
              onClick={() => setTampilan("kode")}
              className={`px-3 py-1.5 font-medium ${
                tampilan === "kode"
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              🔤 Kode
            </button>
          </div>
        </div>

        {/* Kategori — hanya pada tampilan foto; tampilan kode menampilkan semua kategori sekaligus */}
        {tampilan === "foto" && (
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
        )}

        {tampilan === "foto" ? (
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
                {/* Sisa porsi di bawah nama menu — kasir bisa infokan ke konsumen */}
                <div className="pt-0.5">
                  <StokBadge stok={sisaByMenu.get(m.id)} />
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
        ) : (
          <div className="space-y-4 pb-4 md:flex-1 md:overflow-y-auto">
            {menuKodeGroups.map((g) => (
              <div key={g.kategori.id}>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-400">
                  {g.kategori.nama}
                </div>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
                  {g.items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => tambah(m)}
                      title={m.nama}
                      className="flex flex-col items-center justify-center rounded-md border border-stone-200 bg-white px-1 py-1.5 text-center transition hover:border-orange-400 hover:shadow-sm"
                    >
                      <span className="max-w-full truncate font-mono text-xs font-bold leading-none text-stone-800">
                        {m.kode ?? "—"}
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-orange-600">
                        {formatAngka(m.harga_jual, 0)}
                      </span>
                      {/* Sisa porsi di bawah kode + harga */}
                      <StokBadge stok={sisaByMenu.get(m.id)} size="sm" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {menuKodeGroups.length === 0 && (
              <div className="py-10 text-center text-stone-400">
                {cariMenu ? `Menu "${cariMenu}" tidak ditemukan.` : "Belum ada menu."}
              </div>
            )}
          </div>
        )}
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

        {/* Pemilih Open Bill (di atas) — pesanan tersimpan yang belum dibayar */}
        {openBills.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="mb-1 px-1 text-xs font-semibold text-amber-800">
              📋 Open Bill ({openBills.length}) — ketuk untuk buka
            </div>
            <div className="flex flex-wrap gap-1.5">
              {openBills.map((b) => (
                <button
                  key={b.id}
                  onClick={() => void bukaBill(b.id)}
                  className={`rounded-lg border px-2 py-1 text-left text-xs ${
                    editingBillId === b.id
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <span className="font-semibold">{b.meja_label || b.customer_nama || "Bill"}</span>
                  <span className="ml-1 opacity-80">· {b.jumlah_item} item</span>
                </button>
              ))}
            </div>
          </div>
        )}

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

        {/* Konsumen/member (opsional) — di bawah meja; ketik nama ATAU WA →
            dropdown member muncul, pilih untuk isi keduanya sekaligus. */}
        <div className="relative mb-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={konsumenNama}
              onChange={(e) => {
                setKonsumenNama(e.target.value);
                setCariMember(e.target.value);
                setMemberOpen(true);
              }}
              onFocus={() => {
                setCariMember(konsumenNama);
                setMemberOpen(true);
              }}
              onBlur={() => setTimeout(() => setMemberOpen(false), 150)}
              placeholder="👤 Nama konsumen"
              autoComplete="off"
              className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
            />
            <input
              value={konsumenWa}
              onChange={(e) => {
                setKonsumenWa(e.target.value);
                setCariMember(e.target.value);
                setMemberOpen(true);
              }}
              onFocus={() => {
                setCariMember(konsumenWa);
                setMemberOpen(true);
              }}
              onBlur={() => setTimeout(() => setMemberOpen(false), 150)}
              inputMode="tel"
              placeholder="📱 No. WhatsApp"
              autoComplete="off"
              className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
            />
          </div>
          {memberOpen && memberSaran.length > 0 && (
            <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
              {memberSaran.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    // mouseDown mendahului blur → cegah dropdown tertutup sebelum klik
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pilihMember(m)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-orange-50"
                  >
                    <span className="truncate font-medium text-stone-800">{m.nama}</span>
                    <span className="shrink-0 font-mono text-xs text-stone-500">{m.wa}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
                {/* Peringatan bila pesanan melebihi stok tersisa (mis. pesan 3, sisa 2) */}
                {(() => {
                  const sisa = sisaByMenu.get(l.menu.id)?.porsi;
                  if (sisa == null || l.qty <= sisa) return null;
                  return (
                    <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                      ⚠ {sisa <= 0 ? "Stok habis" : `Stok hanya sisa ${sisa}`} — pesanan {l.qty}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          <div className="flex justify-between text-base font-bold text-stone-800">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          <ErrorText error={simpanBill.error} />
          {cart.length > 0 && !mejaId && (
            <div className="text-center text-xs font-medium text-amber-600">
              Pilih meja dulu untuk melanjutkan.
            </div>
          )}
          {/* Setelah meja & menu: pilih simpan Open Bill atau Lanjut ke pembayaran */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => simpanBill.mutate()}
              disabled={cart.length === 0 || !mejaId || simpanBill.isPending}
              className={`${btnSecondary} py-3`}
            >
              {simpanBill.isPending ? "Menyimpan…" : editingBillId ? "💾 Perbarui Bill" : "📋 Open Bill"}
            </button>
            <button
              onClick={() => setResumeOpen(true)}
              disabled={cart.length === 0 || !mejaId}
              className={`${btnPrimary} py-3`}
            >
              Lanjut →
            </button>
          </div>
        </div>
      </Card>

      {/* Modal Resume Order — kasir baca ulang pesanan, isi diskon, terima uang, lalu Simpan */}
      {resumeOpen && !struk && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setResumeOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-800">Resume Order</h2>
              <button
                onClick={() => setResumeOpen(false)}
                className="text-stone-400 hover:text-stone-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
            <div className="mb-3 text-sm text-stone-500">
              {mejaTerpilih
                ? mejaTerpilih.tipe === "takeaway"
                  ? `🥡 ${mejaTerpilih.nama}`
                  : mejaTerpilih.nama
                : "Tanpa meja"}
              {" · "}
              {dineIn ? "Dine-in" : "Bawa pulang"}
              {konsumenNama.trim() ? ` · 👤 ${konsumenNama.trim()}` : ""}
            </div>

            {/* Baca ulang pesanan */}
            <div className="mb-3 divide-y divide-stone-100 rounded-lg border border-stone-200">
              {cart.map((l) => (
                <div
                  key={l.menu.id}
                  className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-stone-800">{l.qty}×</span> {l.menu.nama}
                    {l.catatan.trim() && (
                      <span className="block text-xs text-stone-400">* {l.catatan.trim()}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-medium text-stone-700">
                    {formatRupiah(l.menu.harga_jual * l.qty)}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
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
                  <span className="text-red-600">
                    {diskon > 0 ? `−${formatRupiah(diskon)}` : "—"}
                  </span>
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
              <div className="flex justify-between text-xl font-bold text-stone-800">
                <span>Total</span>
                <span>{formatRupiah(total)}</span>
              </div>

              {/* Metode pembayaran */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {(["tunai", "qris", "transfer"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetodeBayar(m)}
                    className={`rounded-lg border px-2 py-1.5 text-sm font-medium ${
                      metodeBayar === m
                        ? "border-orange-600 bg-orange-600 text-white"
                        : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    {m === "tunai" ? "💵 Tunai" : m === "qris" ? "📱 QRIS" : "🏦 Transfer"}
                  </button>
                ))}
              </div>
              {metodeBayar === "tunai" && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    {/* nominal berformat: prefix Rp + pemisah ribuan (titik).
                        state uangDiterima disimpan sebagai angka mentah (digit). */}
                    <div className="relative w-full">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-stone-400">
                        Rp
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={uangDiterima ? formatAngka(Number(uangDiterima), 0) : ""}
                        onChange={(e) => setUangDiterima(e.target.value.replace(/\D/g, ""))}
                        placeholder="Uang diterima"
                        className="w-full rounded-lg border border-stone-300 py-1.5 pl-9 pr-3 text-right text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setUangDiterima(String(total))}
                      className="shrink-0 rounded-lg border border-stone-300 px-2 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      Uang pas
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[20000, 50000, 100000].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setUangDiterima(String(n))}
                        className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                      >
                        {formatRupiah(n)}
                      </button>
                    ))}
                  </div>
                  {uangNum > 0 && (
                    <div
                      className={`flex justify-between text-sm font-semibold ${uangKurang ? "text-red-600" : "text-green-600"}`}
                    >
                      <span>{uangKurang ? "Uang kurang" : "Kembalian"}</span>
                      <span>{formatRupiah(uangKurang ? total - uangNum : kembalian)}</span>
                    </div>
                  )}
                </div>
              )}

              <ErrorText error={bayar.error} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => setResumeOpen(false)} className={`${btnSecondary} py-3`}>
                  ← Kembali
                </button>
                <button
                  onClick={() => bayar.mutate()}
                  disabled={uangKurang || bayar.isPending}
                  className={`${btnPrimary} py-3`}
                >
                  {bayar.isPending ? "Menyimpan…" : "💾 Simpan & Cetak"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
