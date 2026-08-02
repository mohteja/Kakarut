import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BahanDto, KategoriDto } from "@kakarut/shared";
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
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { buatCsvBahan } from "../../lib/bahanCsv";
import { unduhCsv } from "../../lib/unduh";
import { formatAngka, formatRupiah } from "../../lib/format";
import { ImporBahanModal } from "./ImporBahanModal";
import { SupplierBahanModal } from "./SupplierBahanModal";

export function BahanPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { auth } = useAuth();
  // karyawan CK (tim) hanya MELIHAT master bahan — ubah/tambah tetap manajemen
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  // Master kategori bahan → pilihan dropdown filter
  const { data: kategoriList } = useQuery({
    queryKey: ["kategori-bahan"],
    queryFn: () => api<KategoriDto[]>("/kategori-bahan"),
  });
  const [kelolaKategori, setKelolaKategori] = useState(false);
  const [imporCsv, setImporCsv] = useState(false);
  const [cari, setCari] = useState("");
  const [filterJenis, setFilterJenis] = useState<"semua" | "produksi" | "beli">("semua");
  const [filterKategori, setFilterKategori] = useState<string>("semua");
  /** id bahan tercentang (untuk ubah/hapus banyak sekaligus) */
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [pesanHapus, setPesanHapus] = useState<string | null>(null);
  /** bahan yang sedang diatur suppliernya (modal) */
  const [aturSupplier, setAturSupplier] = useState<BahanDto | null>(null);

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/bahan/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      setPilih((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  // Hapus banyak: per-id (guard server per bahan tetap berlaku — mis. masih
  // dipakai menu/resep → 409). Yang gagal tetap tercentang + pesan alasannya.
  const hapusBanyak = useMutation({
    mutationFn: async (ids: string[]) => {
      const hasil = await Promise.allSettled(
        ids.map((id) => api(`/bahan/${id}`, { method: "DELETE" })),
      );
      return ids
        .map((id, i) => ({ id, h: hasil[i] }))
        .filter((x) => x.h.status === "rejected")
        .map((x) => ({
          id: x.id,
          pesan: ((x.h as PromiseRejectedResult).reason as Error)?.message ?? "gagal",
        }));
    },
    onSuccess: (gagal, ids) => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      setPilih(new Set(gagal.map((g) => g.id)));
      if (gagal.length === 0) {
        setPesanHapus(null);
      } else {
        const namaById = new Map((bahan ?? []).map((b) => [b.id, b.nama]));
        setPesanHapus(
          `${gagal.length} dari ${ids.length} bahan gagal dihapus — ${gagal
            .map((g) => `${namaById.get(g.id) ?? g.id}: ${g.pesan}`)
            .join("; ")}`,
        );
      }
    },
  });

  if (isLoading) return <Spinner />;

  const semua = bahan ?? [];
  const jumlah = (fn: (b: BahanDto) => boolean) => semua.filter(fn).length;
  const tampil = semua
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()))
    .filter((b) => (filterJenis === "semua" ? true : b.pengadaan === filterJenis))
    .filter((b) =>
      // kategori dicocokkan case-insensitive ("Buah segar" == "buah segar")
      filterKategori === "semua"
        ? true
        : b.kategori.toLowerCase() === filterKategori.toLowerCase(),
    );
  const adaFilter = cari !== "" || filterJenis !== "semua" || filterKategori !== "semua";

  const semuaTampilTerpilih = tampil.length > 0 && tampil.every((b) => pilih.has(b.id));
  const togglePilih = (id: string) =>
    setPilih((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  const togglePilihSemua = () =>
    setPilih((prev) => {
      if (semuaTampilTerpilih) {
        const s = new Set(prev);
        for (const b of tampil) s.delete(b.id);
        return s;
      }
      return new Set([...prev, ...tampil.map((b) => b.id)]);
    });
  // urutan ids mengikuti urutan daftar (nama) agar halaman ubah konsisten
  const idsTerpilih = semua.filter((b) => pilih.has(b.id)).map((b) => b.id);
  // Grid "Ubah Bahan Baku" hanya untuk bahan BELI. Bahan produksi diedit lewat
  // halaman Resep (biaya/HPP-nya dari resep + overhead, bukan harga beli).
  const idsBeliTerpilih = semua
    .filter((b) => pilih.has(b.id) && b.pengadaan === "beli")
    .map((b) => b.id);
  const adaProduksiTerpilih = semua.some((b) => pilih.has(b.id) && b.pengadaan === "produksi");

  function resetFilter() {
    setCari("");
    setFilterJenis("semua");
    setFilterKategori("semua");
  }

  return (
    <div>
      <PageTitle
        aksi={
          bolehUbah ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setKelolaKategori(true)} className={btnSecondary}>
                🏷 Kategori
              </button>
              <button
                onClick={() =>
                  unduhCsv(
                    adaFilter ? "bahan-baku-terfilter.csv" : "bahan-baku.csv",
                    buatCsvBahan(tampil),
                  )
                }
                disabled={tampil.length === 0}
                title={
                  adaFilter
                    ? `Export ${tampil.length} bahan yang tampil ke CSV`
                    : "Export semua bahan ke CSV"
                }
                className={btnSecondary}
              >
                📤 Export CSV{adaFilter ? ` (${tampil.length})` : ""}
              </button>
              <button onClick={() => setImporCsv(true)} className={btnSecondary}>
                📥 Impor CSV
              </button>
              <button onClick={() => navigate("/bahan/baru")} className={btnPrimary}>
                + Tambah Bahan Baku
              </button>
            </div>
          ) : undefined
        }
      >
        Bahan Baku ({adaFilter ? `${tampil.length} dari ${semua.length}` : semua.length})
      </PageTitle>
      <KategoriManagerModal
        open={kelolaKategori}
        onClose={() => setKelolaKategori(false)}
        endpoint="/kategori-bahan"
        queryKey="kategori-bahan"
        judul="Kategori Bahan Baku"
        deskripsi="Kategori untuk mengelompokkan bahan baku. Kategori yang masih dipakai bahan tidak bisa dihapus."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className={`${inputClass} max-w-56`}
        />
        <select
          value={filterJenis}
          onChange={(e) => setFilterJenis(e.target.value as typeof filterJenis)}
          className={`${inputClass} max-w-56`}
          aria-label="Filter jenis pengadaan"
        >
          <option value="semua">Semua jenis ({semua.length})</option>
          <option value="produksi">
            Produksi sendiri ({jumlah((b) => b.pengadaan === "produksi")})
          </option>
          <option value="beli">Beli jadi ({jumlah((b) => b.pengadaan === "beli")})</option>
        </select>
        <select
          value={filterKategori}
          onChange={(e) => setFilterKategori(e.target.value)}
          className={`${inputClass} max-w-48`}
          aria-label="Filter kategori"
        >
          <option value="semua">Semua kategori</option>
          {/* dedupe case-insensitive: "Buah segar" & "buah segar" jadi satu opsi */}
          {(kategoriList ?? [])
            .filter(
              (k, i, arr) =>
                arr.findIndex((x) => x.nama.toLowerCase() === k.nama.toLowerCase()) === i,
            )
            .map((k) => (
              <option key={k.id} value={k.nama}>
                {k.nama} ({jumlah((b) => b.kategori.toLowerCase() === k.nama.toLowerCase())})
              </option>
            ))}
        </select>
        {adaFilter && (
          <button
            onClick={resetFilter}
            className="text-sm font-medium text-orange-600 hover:underline"
          >
            Reset filter
          </button>
        )}
      </div>

      {/* Bar aksi massal — tampil saat ada bahan tercentang */}
      {bolehUbah && pilih.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2">
          <span className="text-sm font-semibold text-orange-800">
            {pilih.size} bahan dipilih
          </span>
          {idsBeliTerpilih.length > 0 && (
            <button
              onClick={() => navigate(`/bahan/ubah?ids=${idsBeliTerpilih.join(",")}`)}
              className={btnPrimary}
            >
              ✏ Ubah terpilih ({idsBeliTerpilih.length})
            </button>
          )}
          {adaProduksiTerpilih && (
            <span className="text-xs text-stone-500">
              Bahan produksi diubah di halaman <b>Resep</b> (satu per satu).
            </span>
          )}
          <button
            onClick={() => {
              if (confirm(`Nonaktifkan ${pilih.size} bahan terpilih?`)) {
                setPesanHapus(null);
                hapusBanyak.mutate(idsTerpilih);
              }
            }}
            disabled={hapusBanyak.isPending}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {hapusBanyak.isPending ? "Menghapus…" : `🗑 Hapus terpilih (${pilih.size})`}
          </button>
          <button
            onClick={() => {
              setPilih(new Set());
              setPesanHapus(null);
            }}
            className="text-sm font-medium text-stone-500 hover:underline"
          >
            Batal pilih
          </button>
        </div>
      )}
      {pesanHapus && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {pesanHapus}
        </div>
      )}

      <ErrorText error={hapus.error} />

      <TabelResponsif
        data={tampil}
        kunci={(b) => b.id}
        kelasBaris={(b) => (pilih.has(b.id) ? "bg-orange-50/60" : "hover:bg-stone-50")}
        judulKartu={
          bolehUbah && tampil.length > 0 ? (
            <label className="flex items-center gap-2 px-1 text-sm text-stone-600">
              <input
                type="checkbox"
                checked={semuaTampilTerpilih}
                onChange={togglePilihSemua}
                aria-label="Pilih semua bahan yang tampil"
              />
              Pilih semua yang tampil ({tampil.length})
            </label>
          ) : undefined
        }
        kosong={
          <>
            Tidak ada bahan yang cocok dengan filter.{" "}
            <button onClick={resetFilter} className="font-medium text-orange-600 hover:underline">
              Reset filter
            </button>
          </>
        }
        kolom={[
          ...(bolehUbah
            ? [
                {
                  hp: "pilih" as const,
                  kelasJudul: "w-8",
                  judul: (
                    <input
                      type="checkbox"
                      checked={semuaTampilTerpilih}
                      onChange={togglePilihSemua}
                      aria-label="Pilih semua bahan yang tampil"
                      title="Pilih semua yang tampil"
                    />
                  ),
                  sel: (b: BahanDto) => (
                    <input
                      type="checkbox"
                      checked={pilih.has(b.id)}
                      onChange={() => togglePilih(b.id)}
                      aria-label={`Pilih ${b.nama}`}
                    />
                  ),
                },
              ]
            : []),
          {
            judul: "Kode",
            hp: "sub",
            kelasSel: "whitespace-nowrap font-mono text-xs text-stone-500",
            sel: (b) => <span className="font-mono">{b.kode ?? "—"}</span>,
          },
          {
            judul: "Nama",
            hp: "judul",
            kelasSel: "font-medium",
            sel: (b) => (
              <>
                <button
                  onClick={() => navigate(`/bahan/${b.id}`)}
                  title={`Detail produk "${b.nama}"`}
                  className="text-left font-medium text-stone-800 hover:text-orange-600 hover:underline"
                >
                  {b.nama}
                </button>
                {b.is_packaging && (
                  <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    Kemasan TA
                  </span>
                )}
                {b.is_complement && (
                  <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                    Complement
                  </span>
                )}
                {b.pengadaan === "beli" && b.boleh_eceran && (
                  <span
                    className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    title="Bisa dibeli eceran — saran beli tidak dibulatkan per kemasan"
                  >
                    Eceran
                  </span>
                )}
                {!b.track_stok && (
                  <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-500">
                    Stok tidak dilacak
                  </span>
                )}
              </>
            ),
          },
          { judul: "Kategori", sel: (b) => b.kategori },
          {
            judul: "Jenis",
            sel: (b) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  b.pengadaan === "produksi"
                    ? "bg-orange-100 text-orange-700"
                    : "bg-teal-100 text-teal-700"
                }`}
              >
                {b.pengadaan === "produksi" ? "Produksi sendiri" : "Beli jadi"}
              </span>
            ),
          },
          {
            judul: "Satuan beli",
            // tanpa kolom Isi di sebelahnya angka ini tidak informatif di kartu
            hp: "lewat",
            kelasSel: "whitespace-nowrap text-stone-600",
            sel: (b) => b.satuan_beli ?? <span className="text-stone-300">—</span>,
          },
          { judul: "Harga Beli", kanan: true, sel: (b) => formatRupiah(b.harga_beli) },
          {
            judul: "Isi",
            kanan: true,
            hp: "lewat",
            sel: (b) => (
              <>
                {formatAngka(b.isi)} <span className="text-stone-400">{b.satuan}</span>
              </>
            ),
          },
          {
            judul: "Harga / Unit",
            kanan: true,
            kelasSel: "font-semibold",
            sel: (b) => formatRupiah(b.harga_per_unit),
          },
          {
            judul: "Stok min",
            kanan: true,
            kelasSel: "text-stone-600",
            sel: (b) =>
              !b.track_stok ? (
                <span className="text-stone-300" title="Stok tidak dilacak">
                  —
                </span>
              ) : b.stok_minimum > 0 ? (
                <>
                  {formatAngka(b.stok_minimum)} <span className="text-stone-400">{b.satuan}</span>
                </>
              ) : (
                <span className="text-stone-300">0</span>
              ),
          },
          {
            judul: "Min beli",
            kanan: true,
            hp: "lewat",
            kelasSel: "text-stone-600",
            sel: (b) =>
              b.pengadaan === "beli" && b.min_beli > 0 ? (
                <>
                  {formatAngka(b.min_beli)} <span className="text-stone-400">{b.satuan}</span>
                </>
              ) : (
                <span className="text-stone-300">—</span>
              ),
          },
          {
            judul: "Rak simpan",
            kelasSel: "text-stone-600",
            sel: (b) =>
              b.rak_lokasi.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {b.rak_lokasi.map((r) => (
                    <span
                      key={r.rak_id}
                      title={`${r.branch_nama} — ${r.rak_nama} (atur di Tempat Penyimpanan)`}
                      className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
                    >
                      {r.branch_tipe === "central_kitchen" ? "🏭" : "🏪"} {r.branch_nama} ·{" "}
                      {r.rak_nama}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-stone-300">—</span>
              ),
          },
          {
            judul: "Supplier",
            kelasSel: "whitespace-nowrap",
            sel: (b) =>
              b.pengadaan === "produksi" ? (
                // dibuat di dapur sendiri — tidak memakai supplier
                <span
                  className="text-xs text-stone-300"
                  title="Produksi sendiri — tidak memakai supplier"
                >
                  —
                </span>
              ) : bolehUbah ? (
                <button
                  onClick={() => setAturSupplier(b)}
                  title={`Atur supplier "${b.nama}" — beli di mana & supplier utama`}
                  aria-label={`Atur supplier ${b.nama}`}
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                    b.supplier_utama
                      ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-orange-400"
                      : "border-dashed border-stone-300 text-stone-500 hover:border-orange-400 hover:text-orange-600"
                  }`}
                >
                  {b.supplier_utama ? (
                    <>
                      ★ {b.supplier_utama}
                      {b.jumlah_supplier > 1 && ` +${b.jumlah_supplier - 1}`}
                    </>
                  ) : (
                    "+ Atur supplier"
                  )}
                </button>
              ) : b.supplier_utama ? (
                <span className="text-xs text-stone-600">
                  ★ {b.supplier_utama}
                  {b.jumlah_supplier > 1 && ` +${b.jumlah_supplier - 1}`}
                </span>
              ) : (
                <span className="text-xs text-stone-300">—</span>
              ),
          },
          {
            judul: "Catatan",
            hp: "lewat",
            kelasSel: "max-w-48 truncate text-stone-400",
            sel: (b) => b.catatan,
          },
          {
            hp: "aksi",
            kelasSel: "whitespace-nowrap text-right",
            sel: (b) =>
              bolehUbah && (
                <>
                  <button
                    onClick={() =>
                      navigate(
                        b.pengadaan === "produksi"
                          ? `/resep?bahan=${b.id}`
                          : `/bahan/ubah?ids=${b.id}`,
                      )
                    }
                    title={
                      b.pengadaan === "produksi"
                        ? "Bahan produksi diubah lewat halaman Resep"
                        : "Ubah bahan"
                    }
                    className="text-sm font-medium text-orange-600 hover:underline"
                  >
                    {b.pengadaan === "produksi" ? "Ubah resep" : "Ubah"}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Nonaktifkan bahan "${b.nama}"?`)) hapus.mutate(b.id);
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

      {aturSupplier && (
        <SupplierBahanModal
          // remount tiap ganti bahan — state centang/utama dimuat ulang
          key={aturSupplier.id}
          bahan={aturSupplier}
          onClose={() => setAturSupplier(null)}
        />
      )}
      {imporCsv && <ImporBahanModal bahan={semua} onClose={() => setImporCsv(false)} />}
    </div>
  );
}
