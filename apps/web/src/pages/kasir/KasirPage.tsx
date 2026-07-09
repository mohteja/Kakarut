import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { MenuDto } from "@kakarut/shared";
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
  // Setelan PB1 terbaru dari server (snapshot login bisa basi bila
  // pengaturan perusahaan diubah saat sesi kasir masih terbuka)
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ company: { pb1_enabled: boolean; pb1_rate: number } | null }>("/auth/me"),
  });
  const pb1Conf = me?.company ?? auth?.company;

  const [aktifKategori, setAktifKategori] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [dineIn, setDineIn] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [struk, setStruk] = useState<SaleResult | null>(null);

  const kategoriTampil = useMemo(() => {
    const adaMenu = new Set((menus ?? []).map((m) => m.category_id));
    return kategori.filter((k) => adaMenu.has(k.id));
  }, [kategori, menus]);

  const menuTampil = useMemo(() => {
    const list = menus ?? [];
    if (!aktifKategori) return list;
    return list.filter((m) => m.category_id === aktifKategori);
  }, [menus, aktifKategori]);

  function tambah(menu: MenuDto) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.menu.id === menu.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { menu, qty: 1, dineInOverride: null }];
    });
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
  const pb1 = pb1Conf?.pb1_enabled ? Math.round(subtotal * (pb1Conf.pb1_rate / 100)) : 0;

  const bayar = useMutation({
    mutationFn: () =>
      api<SaleResult>("/penjualan", {
        method: "POST",
        body: {
          ...(!isKasir && branchId ? { branch_id: branchId } : {}),
          is_dine_in: dineIn,
          catatan: catatan || undefined,
          items: cart.map((l) => ({
            menu_id: l.menu.id,
            qty: l.qty,
            ...(l.dineInOverride !== null ? { is_dine_in: l.dineInOverride } : {}),
          })),
        },
      }),
    onSuccess: (data) => {
      setStruk(data);
      setCart([]);
      setCatatan("");
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["laporan"] });
      queryClient.invalidateQueries({ queryKey: ["penjualan"] });
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      {/* Katalog */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => setAktifKategori(null)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              aktifKategori === null
                ? "bg-orange-600 text-white"
                : "bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            Semua
          </button>
          {kategoriTampil.map((k) => (
            <button
              key={k.id}
              onClick={() => setAktifKategori(k.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                aktifKategori === k.id
                  ? "bg-orange-600 text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {k.nama}
            </button>
          ))}
        </div>

        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 md:grid-cols-3 xl:grid-cols-4">
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
              <div className="line-clamp-2 text-sm font-semibold text-stone-800">{m.nama}</div>
              <div className="mt-auto pt-1 text-sm font-bold text-orange-600">
                {formatRupiah(m.harga_jual)}
              </div>
            </button>
          ))}
          {menuTampil.length === 0 && (
            <div className="col-span-full py-10 text-center text-stone-400">
              Tidak ada menu di kategori ini.
            </div>
          )}
        </div>
      </div>

      {/* Keranjang */}
      <Card className="flex w-96 shrink-0 flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-800">Keranjang</h2>
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
            <button
              onClick={() => setDineIn(false)}
              className={`px-3 py-1.5 font-medium ${!dineIn ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
            >
              Bawa Pulang
            </button>
            <button
              onClick={() => setDineIn(true)}
              className={`px-3 py-1.5 font-medium ${dineIn ? "bg-orange-600 text-white" : "bg-white text-stone-600"}`}
            >
              Dine-in
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto">
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
          {pb1 > 0 && (
            <div className="flex justify-between text-sm text-stone-600">
              <span>PB1 ({pb1Conf?.pb1_rate}%)</span>
              <span>{formatRupiah(pb1)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold text-stone-800">
            <span>Total</span>
            <span>{formatRupiah(subtotal + pb1)}</span>
          </div>
          <ErrorText error={bayar.error} />
          <button
            onClick={() => bayar.mutate()}
            disabled={cart.length === 0 || bayar.isPending}
            className={`${btnPrimary} w-full py-3 text-base`}
          >
            {bayar.isPending ? "Memproses…" : "Bayar & Cetak Struk"}
          </button>
        </div>
      </Card>

      {struk && <ReceiptModal data={struk} onClose={() => setStruk(null)} />}
    </div>
  );
}
