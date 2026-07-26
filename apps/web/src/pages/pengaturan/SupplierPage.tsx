import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { SupplierDto } from "@kakarut/shared";
import {
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import { api } from "../../lib/api";

interface FormState {
  id?: string;
  nama: string;
  telepon: string;
  alamat: string;
  catatan: string;
  kategori: string;
}

export function SupplierPage() {
  const queryClient = useQueryClient();
  const { data: supplier, isLoading } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [cari, setCari] = useState("");
  // "" = semua kategori; "__tanpa__" = supplier tanpa kategori
  const [filterKat, setFilterKat] = useState("");

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        telepon: f.telepon || null,
        alamat: f.alamat || null,
        catatan: f.catatan || null,
        kategori: f.kategori.trim() || null,
      };
      return f.id
        ? api(`/supplier/${f.id}`, { method: "PATCH", body })
        : api("/supplier", { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (s: SupplierDto) =>
      api(`/supplier/${s.id}`, { method: "PATCH", body: { is_active: !s.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  if (isLoading) return <Spinner />;

  const semua = supplier ?? [];
  // daftar kategori (distinct, urut) — jadi chip filter & saran isian form
  const kategoriList = [...new Set(semua.map((s) => s.kategori).filter((k): k is string => !!k))]
    .sort((a, b) => a.localeCompare(b));
  const adaTanpaKategori = semua.some((s) => !s.kategori);
  const q = cari.trim().toLowerCase();
  const terlihat = semua.filter((s) => {
    if (filterKat === "__tanpa__") {
      if (s.kategori) return false;
    } else if (filterKat && s.kategori !== filterKat) return false;
    if (!q) return true;
    return [s.nama, s.telepon, s.alamat, s.kategori]
      .some((v) => v?.toLowerCase().includes(q));
  });

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <button
            onClick={() =>
              setForm({ nama: "", telepon: "", alamat: "", catatan: "", kategori: "" })
            }
            className={btnPrimary}
          >
            + Tambah Supplier
          </button>
        }
      >
        Supplier / Sumber ({supplier?.length ?? 0})
      </PageTitle>
      <ErrorText error={toggle.error} />

      {/* Cari + filter kategori */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari nama / telepon / alamat…"
          aria-label="Cari supplier"
          className={`${inputClass} max-w-72`}
        />
        {(kategoriList.length > 0 || filterKat) && (
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filterKat === k
                    ? "bg-orange-600 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {k}
              </button>
            ))}
            {adaTanpaKategori && kategoriList.length > 0 && (
              <button
                onClick={() => setFilterKat(filterKat === "__tanpa__" ? "" : "__tanpa__")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filterKat === "__tanpa__"
                    ? "bg-orange-600 text-white"
                    : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                }`}
              >
                Tanpa kategori
              </button>
            )}
          </div>
        )}
      </div>

      <TabelResponsif
        data={terlihat}
        kunci={(s) => s.id}
        kosong={
          semua.length === 0
            ? "Belum ada supplier — juga bisa ditambah langsung dari form faktur."
            : "Tidak ada supplier yang cocok dengan pencarian/filter."
        }
        kolom={[
          {
            judul: "Nama",
            hp: "judul",
            kelasSel: "font-medium",
            sel: (s) => (
              <Link
                to={`/pengaturan/supplier/${s.id}`}
                className="hover:text-orange-600 hover:underline"
                title="Buka kartu supplier (riwayat transaksi)"
              >
                {s.nama}
              </Link>
            ),
          },
          {
            judul: "Kategori",
            sel: (s) =>
              s.kategori ? (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                  {s.kategori}
                </span>
              ) : (
                "—"
              ),
          },
          { judul: "Telepon", sel: (s) => s.telepon ?? "—" },
          { judul: "Alamat", kelasSel: "max-w-48 truncate", sel: (s) => s.alamat ?? "—" },
          {
            judul: "Status",
            sel: (s) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  s.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                }`}
              >
                {s.is_active ? "Aktif" : "Nonaktif"}
              </span>
            ),
          },
          {
            hp: "aksi",
            kelasSel: "whitespace-nowrap text-right",
            sel: (s) => (
              <>
                <Link
                  to={`/pengaturan/supplier/${s.id}`}
                  className="text-sm font-medium text-stone-600 hover:underline"
                >
                  📒 Kartu
                </Link>
                <button
                  onClick={() =>
                    setForm({
                      id: s.id,
                      nama: s.nama,
                      telepon: s.telepon ?? "",
                      alamat: s.alamat ?? "",
                      catatan: s.catatan ?? "",
                      kategori: s.kategori ?? "",
                    })
                  }
                  className="ml-3 text-sm font-medium text-orange-600 hover:underline"
                >
                  Ubah
                </button>
                <button
                  onClick={() => toggle.mutate(s)}
                  className="ml-3 text-sm font-medium text-stone-500 hover:underline"
                >
                  {s.is_active ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </>
            ),
          },
        ]}
      />

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Supplier" : "Tambah Supplier"}
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
            <div>
              <label className="mb-1 block text-sm font-medium">Kategori</label>
              <input
                value={form.kategori}
                onChange={(e) => setForm({ ...form, kategori: e.target.value })}
                list="kategori-supplier"
                maxLength={30}
                placeholder="mis. sayur, daging, kemasan, toko online"
                aria-label="Kategori supplier"
                className={inputClass}
              />
              <datalist id="kategori-supplier">
                {kategoriList.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-stone-500">
                Bebas diisi — jadi filter di daftar supplier. Kosongkan bila tak perlu.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Telepon</label>
              <input
                value={form.telepon}
                onChange={(e) => setForm({ ...form, telepon: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Alamat</label>
              <textarea
                rows={2}
                value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                placeholder="alamat lengkap / patokan lokasi (tampil saat belanja diproses)"
                aria-label="Alamat supplier"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Catatan</label>
              <input
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                className={inputClass}
              />
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
