import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { MenuDto } from "@kakarut/shared";
import {
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { KategoriManagerModal } from "../../components/KategoriManagerModal";
import { labelCabang, useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";

/**
 * Food cost dinilai terhadap AMBANG perusahaan (Pengaturan → Perusahaan),
 * bukan angka mati. HPP dihitung live dari harga bahan, jadi menu bisa jatuh
 * ke atas ambang tanpa ada yang mengubah harga jualnya — kalau itu terjadi,
 * tanda ⚠ di sini yang pertama memberi tahu.
 */
function FoodCost({ persen, maks }: { persen: number; maks: number }) {
  const lewat = persen > maks;
  const warna = lewat
    ? "text-red-600"
    : persen > maks * 0.85
      ? "text-yellow-600"
      : "text-green-600";
  return (
    <span className={`font-semibold ${warna}`} title={lewat ? `Ambang ${maks}%` : undefined}>
      {lewat && "⚠ "}
      {persen.toFixed(1)}%
    </span>
  );
}

export function MenuListPage() {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const namaCabang = new Map(cabang.map((b) => [b.id, b.nama]));
  const { data: menus, isLoading } = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuDto[]>("/menu"),
  });
  const { data: company } = useQuery({
    queryKey: ["company"],
    queryFn: () => api<{ foodCostMaks: number }>("/company"),
  });
  const foodCostMaks = company?.foodCostMaks ?? 40;

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/menu/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu"] }),
  });

  const [kelolaKategori, setKelolaKategori] = useState(false);
  // Lihat menu yang diatur untuk cabang tertentu — tanpa baris pembatasan
  // (branch_ids kosong) berarti tampil di semua lokasi.
  const [lokasi, setLokasi] = useState<string>("all");
  const [cari, setCari] = useState("");
  const [filterKat, setFilterKat] = useState("");
  const lokasiOpsi = cabang.filter((b) => b.is_active && b.tipe !== "kantor");

  if (isLoading) return <Spinner />;

  const semua = menus ?? [];
  // Chip kategori mengikuti urutan katalog (bukan alfabet) supaya sejajar
  // dengan urutan grup di bawahnya. Diambil dari SELURUH menu, jadi daftar
  // chip tidak menyusut saat mengetik di kotak cari.
  const kategoriList = [...new Set(semua.map((m) => m.kategori))];
  const q = cari.trim().toLowerCase();

  const tampil = semua
    .filter((m) =>
      lokasi === "all" ? true : m.branch_ids.length === 0 || m.branch_ids.includes(lokasi),
    )
    .filter((m) => (filterKat ? m.kategori === filterKat : true))
    .filter((m) =>
      q === ""
        ? true
        : m.nama.toLowerCase().includes(q) || (m.kode ?? "").toLowerCase().includes(q),
    );

  // kelompokkan per kategori mengikuti urutan katalog
  const grup = new Map<string, MenuDto[]>();
  for (const m of tampil) {
    const list = grup.get(m.kategori) ?? [];
    list.push(m);
    grup.set(m.kategori, list);
  }
  const disaring = tampil.length !== semua.length;

  return (
    <div>
      <PageTitle
        aksi={
          <div className="flex items-center gap-2">
            <Link to="/menu/analisis" className={btnSecondary}>
              📊 Analisis Harga
            </Link>
            <button onClick={() => setKelolaKategori(true)} className={btnSecondary}>
              🏷 Kategori
            </button>
            <Link to="/menu/baru" className={btnPrimary}>
              + Tambah Menu
            </Link>
          </div>
        }
      >
        Menu &amp; HPP ({tampil.length}
        {disaring ? ` dari ${semua.length}` : ""})
      </PageTitle>
      <KategoriManagerModal
        open={kelolaKategori}
        onClose={() => setKelolaKategori(false)}
        endpoint="/kategori"
        queryKey="kategori"
        judul="Kategori Menu"
        deskripsi="Kategori untuk mengelompokkan menu. Kategori yang masih dipakai menu tidak bisa dihapus."
      />
      {/* Cari + filter kategori */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="🔍 Cari menu / kode…"
          aria-label="Cari menu"
          className={`${inputClass} max-w-72`}
        />
        {kategoriList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setFilterKat("")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filterKat === ""
                  ? "bg-orange-600 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Semua
            </button>
            {kategoriList.map((k) => (
              <button
                key={k}
                onClick={() => setFilterKat(filterKat === k ? "" : k)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  filterKat === k
                    ? "bg-orange-600 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </div>

      {lokasiOpsi.length > 1 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-stone-600">
          <span>Tampil di lokasi:</span>
          <select
            value={lokasi}
            onChange={(e) => setLokasi(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            <option value="all">Semua lokasi</option>
            {lokasiOpsi.map((b) => (
              <option key={b.id} value={b.id}>
                {labelCabang(b)}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorText error={hapus.error} />

      {tampil.length === 0 && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-stone-400">
          {semua.length === 0
            ? "Belum ada menu."
            : `Tidak ada menu yang cocok${q ? ` dengan "${cari.trim()}"` : ""}${
                filterKat ? ` di kategori "${filterKat}"` : ""
              }.`}
        </div>
      )}

      {[...grup.entries()].map(([kategori, list]) => (
        <div key={kategori} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold text-stone-700">{kategori}</h2>
          <TabelResponsif
            data={list}
            kunci={(m) => m.id}
            kosong="Belum ada menu di kategori ini."
            kolom={[
              {
                judul: "Kode",
                hp: "sub",
                sel: (m) =>
                  m.kode ? (
                    <span className="inline-block rounded bg-stone-100 px-2 py-0.5 font-mono text-xs font-semibold text-stone-600">
                      {m.kode}
                    </span>
                  ) : (
                    <span className="text-stone-300">—</span>
                  ),
              },
              {
                judul: "Menu",
                hp: "judul",
                kelasSel: "font-medium",
                sel: (m) => (
                  <>
                    {m.nama}
                    {m.tipe === "paket" && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Paket · dasar: {m.base_menu_nama}
                      </span>
                    )}
                    {m.branch_ids.length > 0 && (
                      <span
                        className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700"
                        title={m.branch_ids.map((bid) => namaCabang.get(bid) ?? "?").join(", ")}
                      >
                        📍 {m.branch_ids.map((bid) => namaCabang.get(bid) ?? "?").join(", ")}
                      </span>
                    )}
                  </>
                ),
              },
              { judul: "HPP", kanan: true, sel: (m) => formatRupiah(m.hpp) },
              {
                judul: "HPP Dine-in",
                kanan: true,
                // turunan HPP: hanya berguna berdampingan dengan kolom lain
                hp: "lewat",
                kelasSel: "text-stone-400",
                sel: (m) => formatRupiah(m.hpp_dine_in),
              },
              {
                judul: "Markup",
                kanan: true,
                hp: "lewat",
                sel: (m) => (m.tipe === "paket" ? `dasar ×${m.base_mult}` : `×${m.mult}`),
              },
              {
                judul: "Harga Saran",
                kanan: true,
                hp: "lewat",
                sel: (m) => formatRupiah(m.harga_saran),
              },
              {
                judul: "Saran Bulat",
                kanan: true,
                hp: "lewat",
                sel: (m) => formatRupiah(m.harga_jual_bulat),
              },
              {
                judul: "Harga Jual",
                kanan: true,
                kelasSel: "font-bold",
                sel: (m) => formatRupiah(m.harga_jual),
              },
              {
                judul: "Food Cost",
                kanan: true,
                sel: (m) => <FoodCost persen={m.food_cost_persen} maks={foodCostMaks} />,
              },
              {
                hp: "aksi",
                kelasSel: "whitespace-nowrap text-right",
                sel: (m) => (
                  <>
                    <Link
                      to={`/menu/${m.id}/edit`}
                      className="text-sm font-medium text-orange-600 hover:underline"
                    >
                      Ubah
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm(`Nonaktifkan menu "${m.nama}"?`)) hapus.mutate(m.id);
                      }}
                      className="ml-3 text-sm font-medium text-red-500 hover:underline"
                    >
                      Hapus
                    </button>
                  </>
                ),
              },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
