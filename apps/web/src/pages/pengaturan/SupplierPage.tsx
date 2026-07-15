import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { SupplierDto } from "@kakarut/shared";
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

interface FormState {
  id?: string;
  nama: string;
  telepon: string;
  alamat: string;
  catatan: string;
}

export function SupplierPage() {
  const queryClient = useQueryClient();
  const { data: supplier, isLoading } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  const [form, setForm] = useState<FormState | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        telepon: f.telepon || null,
        alamat: f.alamat || null,
        catatan: f.catatan || null,
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

  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          <button
            onClick={() => setForm({ nama: "", telepon: "", alamat: "", catatan: "" })}
            className={btnPrimary}
          >
            + Tambah Supplier
          </button>
        }
      >
        Supplier / Sumber ({supplier?.length ?? 0})
      </PageTitle>
      <ErrorText error={toggle.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Telepon</th>
              <th className={thClass}>Alamat</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(supplier ?? []).map((s) => (
              <tr key={s.id}>
                <td className={`${tdClass} font-medium`}>
                  <Link
                    to={`/pengaturan/supplier/${s.id}`}
                    className="hover:text-orange-600 hover:underline"
                    title="Buka kartu supplier (riwayat transaksi)"
                  >
                    {s.nama}
                  </Link>
                </td>
                <td className={tdClass}>{s.telepon ?? "—"}</td>
                <td className={`${tdClass} max-w-48 truncate`}>{s.alamat ?? "—"}</td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      s.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {s.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
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
                </td>
              </tr>
            ))}
            {(supplier ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-stone-400">
                  Belum ada supplier — juga bisa ditambah langsung dari form faktur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

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
