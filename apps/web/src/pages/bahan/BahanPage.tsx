import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { BahanDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";

interface FormState {
  id?: string;
  nama: string;
  harga_beli: string;
  isi: string;
  satuan: string;
  kategori: "baso" | "minuman" | "lain";
  pengadaan: "produksi" | "beli";
  catatan: string;
  is_packaging: boolean;
  is_complement: boolean;
}

const kosong: FormState = {
  nama: "",
  harga_beli: "",
  isi: "1",
  satuan: "pcs",
  kategori: "lain",
  pengadaan: "beli",
  catatan: "",
  is_packaging: false,
  is_complement: false,
};

export function BahanPage() {
  const queryClient = useQueryClient();
  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [cari, setCari] = useState("");
  const [filterJenis, setFilterJenis] = useState<"semua" | "produksi" | "beli">("semua");
  const [filterKategori, setFilterKategori] = useState<"semua" | "baso" | "minuman" | "lain">(
    "semua",
  );

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        harga_beli: Number(f.harga_beli),
        isi: Number(f.isi),
        satuan: f.satuan.trim() || "pcs",
        kategori: f.kategori,
        pengadaan: f.pengadaan,
        catatan: f.catatan || null,
        is_packaging: f.is_packaging,
        is_complement: f.is_complement,
      };
      return f.id
        ? api(`/bahan/${f.id}`, { method: "PUT", body })
        : api("/bahan", { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/bahan/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  if (isLoading) return <Spinner />;

  const semua = bahan ?? [];
  const jumlah = (fn: (b: BahanDto) => boolean) => semua.filter(fn).length;
  const tampil = semua
    .filter((b) => b.nama.toLowerCase().includes(cari.toLowerCase()))
    .filter((b) => (filterJenis === "semua" ? true : b.pengadaan === filterJenis))
    .filter((b) => (filterKategori === "semua" ? true : b.kategori === filterKategori));
  const adaFilter = cari !== "" || filterJenis !== "semua" || filterKategori !== "semua";

  function resetFilter() {
    setCari("");
    setFilterJenis("semua");
    setFilterKategori("semua");
  }

  return (
    <div>
      <PageTitle
        aksi={
          <button onClick={() => setForm(kosong)} className={btnPrimary}>
            + Tambah Bahan
          </button>
        }
      >
        Bahan Baku ({adaFilter ? `${tampil.length} dari ${semua.length}` : semua.length})
      </PageTitle>

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
          onChange={(e) => setFilterKategori(e.target.value as typeof filterKategori)}
          className={`${inputClass} max-w-48`}
          aria-label="Filter kategori"
        >
          <option value="semua">Semua kategori</option>
          <option value="baso">baso ({jumlah((b) => b.kategori === "baso")})</option>
          <option value="minuman">minuman ({jumlah((b) => b.kategori === "minuman")})</option>
          <option value="lain">lain ({jumlah((b) => b.kategori === "lain")})</option>
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

      <ErrorText error={hapus.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Kategori</th>
              <th className={thClass}>Jenis</th>
              <th className={`${thClass} text-right`}>Harga Beli</th>
              <th className={`${thClass} text-right`}>Isi</th>
              <th className={`${thClass} text-right`}>Harga / Unit</th>
              <th className={thClass}>Catatan</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {tampil.map((b) => (
              <tr key={b.id} className="hover:bg-stone-50">
                <td className={`${tdClass} font-medium`}>
                  {b.nama}
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
                </td>
                <td className={tdClass}>{b.kategori}</td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      b.pengadaan === "produksi"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-teal-100 text-teal-700"
                    }`}
                  >
                    {b.pengadaan === "produksi" ? "Produksi sendiri" : "Beli jadi"}
                  </span>
                </td>
                <td className={`${tdClass} text-right`}>{formatRupiah(b.harga_beli)}</td>
                <td className={`${tdClass} text-right`}>
                  {formatAngka(b.isi)} <span className="text-stone-400">{b.satuan}</span>
                </td>
                <td className={`${tdClass} text-right font-semibold`}>
                  {formatRupiah(b.harga_per_unit)}
                </td>
                <td className={`${tdClass} max-w-48 truncate text-stone-400`} title={b.catatan ?? ""}>
                  {b.catatan}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <button
                    onClick={() =>
                      setForm({
                        id: b.id,
                        nama: b.nama,
                        harga_beli: String(b.harga_beli),
                        isi: String(b.isi),
                        satuan: b.satuan,
                        kategori: b.kategori,
                        pengadaan: b.pengadaan,
                        catatan: b.catatan ?? "",
                        is_packaging: b.is_packaging,
                        is_complement: b.is_complement,
                      })
                    }
                    className="text-sm font-medium text-orange-600 hover:underline"
                  >
                    Ubah
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Nonaktifkan bahan "${b.nama}"?`)) hapus.mutate(b.id);
                    }}
                    className="ml-3 text-sm font-medium text-red-500 hover:underline"
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
            {tampil.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-stone-400">
                  Tidak ada bahan yang cocok dengan filter.{" "}
                  <button
                    onClick={resetFilter}
                    className="font-medium text-orange-600 hover:underline"
                  >
                    Reset filter
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Bahan" : "Tambah Bahan"}
      >
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Harga beli (Rp)</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={form.harga_beli}
                  onChange={(e) => setForm({ ...form, harga_beli: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Isi/gramasi per pembelian
                </label>
                <input
                  required
                  type="number"
                  min="0.0001"
                  step="any"
                  value={form.isi}
                  onChange={(e) => setForm({ ...form, isi: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Satuan</label>
                <input
                  required
                  list="satuan-list-bahan"
                  value={form.satuan}
                  onChange={(e) => setForm({ ...form, satuan: e.target.value })}
                  className={inputClass}
                />
                <datalist id="satuan-list-bahan">
                  {["pcs", "gr", "ml", "butir", "porsi", "lembar", "ikat"].map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
            </div>
            {Number(form.harga_beli) > 0 && Number(form.isi) > 0 && (
              <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
                Harga per {form.satuan || "unit"}:{" "}
                {formatRupiah(Number(form.harga_beli) / Number(form.isi))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Kategori</label>
                <select
                  value={form.kategori}
                  onChange={(e) =>
                    setForm({ ...form, kategori: e.target.value as FormState["kategori"] })
                  }
                  className={inputClass}
                >
                  <option value="baso">baso</option>
                  <option value="minuman">minuman</option>
                  <option value="lain">lain</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Jenis pengadaan</label>
                <select
                  value={form.pengadaan}
                  onChange={(e) =>
                    setForm({ ...form, pengadaan: e.target.value as FormState["pengadaan"] })
                  }
                  className={inputClass}
                >
                  <option value="beli">Beli jadi (jalur: Beli Bahan Baku)</option>
                  <option value="produksi">
                    Produksi sendiri (jalur: Produksi Bahan Baku)
                  </option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Catatan</label>
              <input
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_packaging}
                  onChange={(e) => setForm({ ...form, is_packaging: e.target.checked })}
                />
                Kemasan take-away
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_complement}
                  onChange={(e) => setForm({ ...form, is_complement: e.target.checked })}
                />
                Complement (×0.5 dine-in)
              </label>
            </div>
            <ErrorText error={simpan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
                Simpan
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
