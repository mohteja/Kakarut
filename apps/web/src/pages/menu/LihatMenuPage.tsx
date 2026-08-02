import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuDto } from "@kakarut/shared";
import { Card, PageTitle, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggal, hariIniWIB } from "../../lib/format";

interface Kategori {
  id: string;
  nama: string;
  sort_order: number;
}

const LAIN = "__lain__";

/** Fallback beridentitas tetap — lihat alasannya di pemakaian `kategori`. */
const KOSONG: Kategori[] = [];

/** Urutan menu id per kategori, dari data server (menu aktif). */
function bangunUrutan(menus: MenuDto[], kategori: Kategori[]): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  const dikenal = new Set(kategori.map((k) => k.id));
  const urut = (a: MenuDto, b: MenuDto) =>
    a.sort_order - b.sort_order || a.nama.localeCompare(b.nama, "id");
  for (const k of kategori) {
    const ms = menus.filter((m) => m.category_id === k.id).sort(urut);
    if (ms.length) res[k.id] = ms.map((m) => m.id);
  }
  const lain = menus.filter((m) => !dikenal.has(m.category_id)).sort(urut);
  if (lain.length) res[LAIN] = lain.map((m) => m.id);
  return res;
}

/**
 * Halaman "Lihat Menu" (semua peran, terutama kasir): menampilkan menu siap
 * jual + harga jualnya, mengatur urutan/posisi menu (naik/turun per kategori),
 * dan mencetak daftar menu (A4/PDF lewat browser). Menu company-scoped; urutan
 * disimpan ke sort_order.
 */
export function LihatMenuPage() {
  const { auth } = useAuth();
  const { branchQuery, divisi } = useBranch();
  const queryClient = useQueryClient();
  const namaPerusahaan = auth?.company?.nama ?? "Terakasir";

  // Menu per lokasi: tampilkan hanya menu yang tersedia di cabang aktif.
  // Kantor = pusat: katalog PENUH (menu terbatas lokasi tidak boleh hilang).
  const q = divisi === "kantor" ? "" : branchQuery;
  const { data: menus, isLoading } = useQuery({
    queryKey: ["menu", q],
    queryFn: () => api<MenuDto[]>(`/menu${q}`),
  });
  /**
   * `data` diambil apa adanya, lalu di-fallback ke KOSONG yang identitasnya
   * TETAP — jangan kembali ke `data: kategori = []`.
   *
   * Default literal di destructuring membuat array BARU tiap render, dan array
   * itu ikut ke deps `useEffect` di bawah. Selama /kategori belum tiba
   * sementara /menu sudah (dua request paralel — urutannya tidak dijamin),
   * efeknya menembak di SETIAP render, `setUrutan` menghasilkan objek baru,
   * yang memicu render berikutnya, dan seterusnya: perulangan tak berujung
   * yang berhenti hanya karena React menyerah dengan "Maximum update depth
   * exceeded". Selama ini tertutupi karena ["kategori"] biasanya sudah ada di
   * cache dari halaman sebelumnya; muat ulang langsung ke halaman ini yang
   * membukanya.
   */
  const { data: kategoriData, isPending: kategoriPending } = useQuery({
    queryKey: ["kategori"],
    queryFn: () => api<Kategori[]>("/kategori"),
  });
  const kategori = kategoriData ?? KOSONG;

  const [urutan, setUrutan] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  // Seed urutan dari server; jangan timpa saat sedang diedit (dirty).
  // Tunggu /kategori SELESAI (berhasil maupun gagal) — menyemai dengan daftar
  // kategori kosong menaruh seluruh menu di "Lainnya" sekejap, lalu menatanya
  // ulang begitu kategori tiba. Saat gagal, `isPending` tetap jadi false, jadi
  // halaman tetap terisi seperti sebelumnya (semua menu di "Lainnya").
  useEffect(() => {
    if (!menus || kategoriPending) return;
    if (dirtyRef.current) return;
    setUrutan(bangunUrutan(menus, kategori));
  }, [menus, kategori, kategoriPending]);

  const byId = useMemo(() => new Map((menus ?? []).map((m) => [m.id, m])), [menus]);

  // Kategori yang tampil (punya menu), urut sesuai sort_order kategori, lalu "Lainnya".
  const grup = useMemo(() => {
    const cats = kategori
      .filter((k) => (urutan[k.id]?.length ?? 0) > 0)
      .map((k) => ({ id: k.id, nama: k.nama }));
    if (urutan[LAIN]?.length) cats.push({ id: LAIN, nama: "Lainnya" });
    return cats;
  }, [kategori, urutan]);

  function pindah(catId: string, idx: number, arah: -1 | 1) {
    setUrutan((prev) => {
      const arr = [...(prev[catId] ?? [])];
      const j = idx + arah;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...prev, [catId]: arr };
    });
    dirtyRef.current = true;
    setDirty(true);
  }

  const simpan = useMutation({
    mutationFn: (items: { id: string; sort_order: number }[]) =>
      api("/menu/urutan", { method: "PUT", body: { items } }),
    onSuccess: () => {
      dirtyRef.current = false;
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["menu"] });
    },
  });

  function simpanUrutan() {
    const items: { id: string; sort_order: number }[] = [];
    let idx = 0;
    for (const g of grup) for (const id of urutan[g.id] ?? []) items.push({ id, sort_order: idx++ });
    simpan.mutate(items);
  }

  if (isLoading) return <Spinner />;

  const kosong = grup.length === 0;

  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => window.print()} className={btnSecondary}>
              🖨 Cetak Daftar Menu
            </button>
            {dirty && (
              <button onClick={simpanUrutan} disabled={simpan.isPending} className={btnPrimary}>
                {simpan.isPending ? "Menyimpan…" : "Simpan Urutan"}
              </button>
            )}
          </div>
        }
      >
        Lihat Menu
      </PageTitle>
      <div className="mb-4 text-sm text-stone-500">
        Menu siap jual &amp; harga jualnya. Atur <b>urutan (posisi)</b> menu dengan tombol ▲ / ▼,
        lalu <b>Cetak Daftar Menu</b> untuk mencetak (A4/PDF).
      </div>

      {kosong ? (
        <Card className="p-8 text-center text-sm text-stone-400">Belum ada menu siap jual.</Card>
      ) : (
        grup.map((g) => {
          const ids = urutan[g.id] ?? [];
          return (
            <Card key={g.id} className="mb-3 overflow-hidden">
              <div className="border-b border-stone-100 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
                {g.nama}
              </div>
              <ul className="divide-y divide-stone-100">
                {ids.map((id, idx) => {
                  const m = byId.get(id);
                  if (!m) return null;
                  return (
                    <li key={id} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex flex-col">
                        <button
                          onClick={() => pindah(g.id, idx, -1)}
                          disabled={idx === 0}
                          aria-label="Naikkan"
                          className="flex h-5 w-6 items-center justify-center rounded text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => pindah(g.id, idx, 1)}
                          disabled={idx === ids.length - 1}
                          aria-label="Turunkan"
                          className="flex h-5 w-6 items-center justify-center rounded text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                      <span className="w-5 text-right text-xs text-stone-400">{idx + 1}</span>
                      {m.image_url ? (
                        <img
                          src={m.image_url}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-stone-100 text-base">
                          🍜
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-stone-800">{m.nama}</span>
                        {m.deskripsi && (
                          <span className="block text-xs leading-snug text-stone-500">
                            {m.deskripsi}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-semibold text-stone-700">
                        {formatRupiah(m.harga_jual)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })
      )}

      {/* Area cetak (A4/PDF) — hanya tampil saat mencetak */}
      <div id="menu-print" className="hidden text-black print:block">
        <div className="mb-4 text-center">
          <div className="text-xl font-bold">{namaPerusahaan}</div>
          <div className="text-sm font-semibold tracking-wide">DAFTAR MENU</div>
          <div className="text-xs">{formatTanggal(hariIniWIB())}</div>
        </div>
        {grup.map((g) => (
          <div key={g.id} className="mb-4 break-inside-avoid">
            <div className="mb-1 border-b border-black pb-0.5 text-base font-bold">{g.nama}</div>
            {(urutan[g.id] ?? []).map((id) => {
              const m = byId.get(id);
              if (!m) return null;
              return (
                // break-inside-avoid: isi menu tak boleh terpotong ke halaman
                // berikutnya, terpisah dari nama & harganya.
                <div key={id} className="break-inside-avoid py-0.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{m.nama}</span>
                    <span className="font-semibold">{formatRupiah(m.harga_jual)}</span>
                  </div>
                  {m.deskripsi && (
                    <div className="pl-3 text-xs leading-snug text-neutral-600">{m.deskripsi}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
