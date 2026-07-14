import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { BahanDto, BahanResepRow } from "@kakarut/shared";
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
import { useAuth } from "../../context/AuthContext";
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
  track_stok: boolean;
  stok_minimum: string;
  catatan: string;
  is_packaging: boolean;
  is_complement: boolean;
  boleh_eceran: boolean;
  min_beli: string;
}

/** Baris editor resep produksi (bahan mentah per 1 batch bahan jadi). */
interface ResepDraft {
  ingredient_id: string;
  qty: string;
}

const kosong: FormState = {
  nama: "",
  harga_beli: "",
  isi: "1",
  satuan: "pcs",
  kategori: "lain",
  pengadaan: "beli",
  track_stok: true,
  stok_minimum: "0",
  catatan: "",
  is_packaging: false,
  is_complement: false,
  boleh_eceran: false,
  min_beli: "0",
};

export function BahanPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  // karyawan CK (tim) hanya MELIHAT master bahan — ubah/tambah tetap manajemen
  const bolehUbah = auth?.user.role === "owner" || auth?.user.role === "admin";
  const { data: bahan, isLoading } = useQuery({
    queryKey: ["bahan"],
    queryFn: () => api<BahanDto[]>("/bahan"),
  });
  const [form, setForm] = useState<FormState | null>(null);
  // Resep produksi (BOM) bahan jadi yang sedang diedit — bahan mentah per 1 batch
  const [resep, setResep] = useState<ResepDraft[]>([]);
  const [cari, setCari] = useState("");
  const [filterJenis, setFilterJenis] = useState<"semua" | "produksi" | "beli">("semua");
  const [filterKategori, setFilterKategori] = useState<"semua" | "baso" | "minuman" | "lain">(
    "semua",
  );

  const simpan = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        nama: f.nama,
        harga_beli: Number(f.harga_beli),
        isi: Number(f.isi),
        satuan: f.satuan.trim() || "pcs",
        kategori: f.kategori,
        pengadaan: f.pengadaan,
        track_stok: f.track_stok,
        stok_minimum: f.track_stok ? Number(f.stok_minimum) || 0 : 0,
        catatan: f.catatan || null,
        is_packaging: f.is_packaging,
        is_complement: f.is_complement,
        // eceran & minimal belanja hanya relevan utk jalur beli
        boleh_eceran: f.pengadaan === "beli" ? f.boleh_eceran : false,
        min_beli: f.pengadaan === "beli" ? Number(f.min_beli) || 0 : 0,
      };
      const saved = f.id
        ? await api<BahanDto>(`/bahan/${f.id}`, { method: "PUT", body })
        : await api<BahanDto>("/bahan", { method: "POST", body });
      // resep produksi disimpan bersama bahan (per 1 batch = isi bahan jadi)
      if (f.pengadaan === "produksi") {
        await api(`/bahan/${saved.id}/resep`, {
          method: "PUT",
          body: {
            komponen: resep
              .filter((r) => r.ingredient_id && Number(r.qty) > 0)
              .map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty) })),
          },
        });
      }
      return saved;
    },
    onSuccess: () => {
      setForm(null);
      setResep([]);
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["bahan-resep"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] }); // HPP berubah
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  // buka form Ubah: muat resep tersimpan (khusus bahan produksi)
  async function bukaUbah(b: BahanDto) {
    setForm({
      id: b.id,
      nama: b.nama,
      harga_beli: String(b.harga_beli),
      isi: String(b.isi),
      satuan: b.satuan,
      kategori: b.kategori,
      pengadaan: b.pengadaan,
      track_stok: b.track_stok,
      stok_minimum: String(b.stok_minimum),
      catatan: b.catatan ?? "",
      is_packaging: b.is_packaging,
      is_complement: b.is_complement,
      boleh_eceran: b.boleh_eceran,
      min_beli: String(b.min_beli ?? 0),
    });
    if (b.pengadaan === "produksi") {
      try {
        const rows = await api<BahanResepRow[]>(`/bahan/${b.id}/resep`);
        setResep(rows.map((r) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty) })));
      } catch {
        setResep([]);
      }
    } else {
      setResep([]);
    }
  }

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
          bolehUbah ? (
            <button
              onClick={() => {
                setForm(kosong);
                setResep([]);
              }}
              className={btnPrimary}
            >
              + Tambah Bahan
            </button>
          ) : undefined
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
                  {bolehUbah && (
                    <>
                      <button
                        onClick={() => void bukaUbah(b)}
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
                    </>
                  )}
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
            {form.pengadaan === "beli" && (
              <label className="flex items-center gap-2 rounded-lg border border-stone-200 p-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.boleh_eceran}
                  onChange={(e) => setForm({ ...form, boleh_eceran: e.target.checked })}
                />
                <span>
                  Bisa dibeli eceran (tanpa pembulatan per kemasan)
                  <span className="block text-xs font-normal text-stone-500">
                    Tanpa centang: saran beli &amp; faktur otomatis dibulatkan ke atas per
                    kemasan penuh (1 kemasan = {form.isi || "…"} {form.satuan || "unit"}) —
                    mengikuti cara toko menjual.
                  </span>
                </span>
              </label>
            )}
            {form.pengadaan === "beli" && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Minimal belanja ({form.satuan || "unit"})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.min_beli}
                  onChange={(e) => setForm({ ...form, min_beli: e.target.value })}
                  className={inputClass}
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-stone-500">
                  Saat sistem membuat daftar belanja, jumlah beli dibulatkan naik minimal ke
                  nilai ini. Isi <b>0</b> untuk tanpa minimum.
                </p>
              </div>
            )}
            {form.pengadaan === "produksi" && (
              <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
                <div className="mb-1 text-sm font-semibold text-stone-800">
                  🧾 Resep produksi (per 1 batch = {form.isi || "…"} {form.satuan || "unit"})
                </div>
                <p className="mb-2 text-xs text-stone-500">
                  Bahan mentah yang dibutuhkan untuk memproduksi 1 batch bahan ini. Dipakai
                  untuk <b>rencana belanja bahan produksi</b> dan <b>pemotongan stok bahan
                  mentah otomatis</b> saat produksi selesai.
                </p>
                <div className="space-y-2">
                  {resep.map((r, i) => {
                    const pilihan = semua.filter(
                      (x) =>
                        x.pengadaan === "beli" &&
                        x.is_active &&
                        x.id !== form.id &&
                        (x.id === r.ingredient_id ||
                          !resep.some((lain, j) => j !== i && lain.ingredient_id === x.id)),
                    );
                    const terpilih = semua.find((x) => x.id === r.ingredient_id);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={r.ingredient_id}
                          onChange={(e) => {
                            const salinan = [...resep];
                            salinan[i] = { ...salinan[i], ingredient_id: e.target.value };
                            setResep(salinan);
                          }}
                          className={`${inputClass} flex-1`}
                          required
                        >
                          <option value="">— pilih bahan mentah —</option>
                          {pilihan.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.nama}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0.0001"
                          step="any"
                          value={r.qty}
                          onChange={(e) => {
                            const salinan = [...resep];
                            salinan[i] = { ...salinan[i], qty: e.target.value };
                            setResep(salinan);
                          }}
                          placeholder="qty"
                          className="w-24 shrink-0 rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-orange-500 focus:outline-none"
                          required
                        />
                        <span className="w-12 shrink-0 text-xs text-stone-500">
                          {terpilih?.satuan ?? ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setResep(resep.filter((_, j) => j !== i))}
                          className="shrink-0 text-sm font-medium text-red-500 hover:underline"
                          aria-label="Hapus baris resep"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setResep([...resep, { ingredient_id: "", qty: "" }])}
                  className="mt-2 text-sm font-medium text-orange-600 hover:underline"
                >
                  + Tambah bahan mentah
                </button>
                {resep.some((r) => r.ingredient_id && Number(r.qty) > 0) && (
                  <div className="mt-2 rounded bg-white px-3 py-2 text-xs text-stone-600">
                    Estimasi biaya bahan per batch:{" "}
                    <b>
                      {formatRupiah(
                        resep.reduce((a, r) => {
                          const x = semua.find((b) => b.id === r.ingredient_id);
                          return a + (x ? (Number(r.qty) || 0) * x.harga_per_unit : 0);
                        }, 0),
                      )}
                    </b>{" "}
                    — bandingkan dengan harga beli batch di atas.
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Catatan</label>
              <input
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                className={inputClass}
              />
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-stone-200 p-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.track_stok}
                onChange={(e) => setForm({ ...form, track_stok: e.target.checked })}
              />
              <span>
                Lacak stok bahan ini
                <span className="block text-xs font-normal text-stone-500">
                  Dipotong otomatis saat menjual, ditambah saat membeli/produksi, dan tampil
                  di halaman Stok. Tanpa centang: hanya dipakai untuk hitung HPP.
                </span>
              </span>
            </label>
            {form.track_stok && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Ambang batas stok minimum ({form.satuan || "unit"})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.stok_minimum}
                  onChange={(e) => setForm({ ...form, stok_minimum: e.target.value })}
                  className={inputClass}
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-stone-500">
                  Bila saldo ≤ nilai ini → status <b>Menipis</b> (peringatan di Beranda &amp;
                  Stok). Isi <b>0</b> untuk memakai perkiraan otomatis.
                </p>
              </div>
            )}
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
