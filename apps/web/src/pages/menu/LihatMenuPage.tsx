import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MenuDto } from "@kakarut/shared";
import { Card, ErrorText, PageTitle, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
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
  /**
   * APA yang sedang dicetak — dua keperluan berbeda, bukan dua gaya.
   *
   *   "menu"    dibaca TAMU sebelum memesan: butuh deskripsi & harga, dan harus
   *             enak dibaca. Kepadatan mengalah pada keterbacaan.
   *   "pesanan" diisi TAMU lalu diserahkan ke kasir: butuh kotak jumlah, dan
   *             harus muat SATU lembar supaya tak ada yang tercecer. Deskripsi
   *             tidak dibawa — tamu sudah membacanya di menu, dan justru
   *             deskripsilah yang membuat lembar ini meluber.
   *
   * Disatukan dalam satu tombol, keduanya saling menarik ke arah berlawanan:
   * yang satu jadi terlalu padat untuk dibaca, yang lain terlalu longgar untuk
   * muat.
   */
  const [cetak, setCetak] = useState<"menu" | "pesanan">("menu");
  /**
   * Mencetak SESUDAH React menggambar mode yang dipilih.
   *
   * `setCetak(...)` lalu `window.print()` berurutan akan mencetak mode yang
   * LAMA: `window.print()` memblokir sebelum React sempat menggambar ulang, dan
   * bugnya sunyi — yang keluar dari printer terlihat sah, cuma bukan yang
   * diminta.
   */
  const [mintaCetak, setMintaCetak] = useState(false);
  useEffect(() => {
    if (!mintaCetak) return;
    setMintaCetak(false);
    window.print();
  }, [mintaCetak]);
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
            <button
              onClick={() => {
                setCetak("menu");
                setMintaCetak(true);
              }}
              className={btnSecondary}
            >
              🖨 Cetak Menu
            </button>
            <button
              onClick={() => {
                setCetak("pesanan");
                setMintaCetak(true);
              }}
              className={btnSecondary}
            >
              📝 Cetak Kertas Pesanan
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
        lalu cetak.
        <br />
        <span className="text-xs text-stone-400">
          <b>Cetak Menu</b> — daftar untuk DIBACA tamu: dua kolom, lengkap dengan deskripsi.{" "}
          <b>Cetak Kertas Pesanan</b> — lembar untuk DIISI tamu: tiga kolom rapat berkotak jumlah,
          tanpa deskripsi supaya muat satu lembar.
        </span>
      </div>
      {/*
        Simpan yang gagal memang menyisakan tombol "Simpan Urutan" (karena
        `dirty` tak pernah dilepas) — tapi itu petunjuk yang harus ditebak
        sendiri. Tanpa pesannya, urutan yang tampak sudah berpindah di layar
        akan kembali ke semula saat halaman dimuat ulang, dan tak ada yang tahu
        sebabnya penolakan server atau jaringan yang putus.
      */}
      <div className="mb-4">
        <ErrorText error={simpan.error} />
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

      {/*
        Area cetak — DIPORTAL KE `document.body`, di luar shell aplikasi.

        Alasannya terukur, bukan gaya. CSS cetak memakai
        `body * { visibility: hidden }`, dan `visibility` menyembunyikan TANPA
        melepas ruangnya: shell aplikasi tetap setinggi 1.285mm, jadi dokumen
        yang tercetak ikut setinggi itu — 5 halaman A4 untuk isi yang cuma
        631mm. Halaman 3 sampai 5 kosong, dan tak ada yang tahu dari mana.

        Sebagai anak langsung `body`, ia bisa dipasangkan `#root { display:none }`
        di media cetak (lihat `index.css`) yang benar-benar MELEPAS ruang itu.
      */}
      {createPortal(
        <div id="menu-print" className="hidden text-black print:block" data-mode={cetak}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-black pb-1">
            <span className="text-base font-bold leading-tight">{namaPerusahaan}</span>
            <span className="text-[10px] font-semibold tracking-wide">
              {cetak === "pesanan" ? "DAFTAR PESANAN" : "DAFTAR MENU"} ·{" "}
              {formatTanggal(hariIniWIB())}
            </span>
          </div>
          {/*
            Baris identitas hanya pada KERTAS PESANAN: lembar yang diisi tamu
            harus bisa dikembalikan ke mejanya. Menu tak diisi siapa pun, jadi di
            sana baris ini cuma memakan tempat.
          */}
          {cetak === "pesanan" && (
            <div className="mb-2 flex gap-4 text-[10px]">
              <div className="flex-1 border-b border-neutral-500 pb-1.5">Nama</div>
              <div className="w-24 border-b border-neutral-500 pb-1.5">Meja</div>
            </div>
          )}
          {/*
            Kategori TIDAK boleh terbelah antar-kolom. Sempat kubiarkan terbelah
            demi memadatkan, dan hasilnya terlihat langsung: kolom berikutnya
            dimulai oleh menu tanpa judul di atasnya, jadi pembacanya kehilangan
            konteks. Ini lembar yang dibaca TAMU.
          */}
          <div className="daftar-menu">
            {grup.map((g) => (
              <div key={g.id} className="mb-2 break-inside-avoid">
                <div className="judul-kategori mb-0.5 border-b border-black pb-px text-xs font-bold">
                  {g.nama}
                </div>
                {(urutan[g.id] ?? []).map((id) => {
                  const m = byId.get(id);
                  if (!m) return null;
                  return (
                    // break-inside-avoid: satu baris menu tak boleh terpisah
                    // dari harganya, antar-kolom maupun antar-halaman.
                    <div key={id} className="baris-menu break-inside-avoid text-xs">
                      <div className="flex items-baseline gap-2">
                        <span className="flex-1">{m.nama}</span>
                        <span className="font-semibold whitespace-nowrap">
                          {formatRupiah(m.harga_jual)}
                        </span>
                        {/* Kotak jumlah HANYA di kertas pesanan — inilah yang
                            menggantikan tulis tangan. */}
                        {cetak === "pesanan" && (
                          <span className="kotak-jumlah shrink-0" aria-hidden />
                        )}
                      </div>
                      {/* Deskripsi HANYA di menu. Di kertas pesanan ia tak
                          dibaca siapa pun (tamu sudah memilih) tapi memakan
                          lebih dari separuh tinggi barisnya — dan itulah yang
                          membuat lembar pesanan meluber ke halaman kedua. */}
                      {cetak === "menu" && m.deskripsi && (
                        <div className="pl-3 text-[10px] leading-snug text-neutral-600">
                          {m.deskripsi}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
