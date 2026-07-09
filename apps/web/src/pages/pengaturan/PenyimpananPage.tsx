import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { PenyimpananDto } from "@kakarut/shared";
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
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";

interface FormState {
  id?: string;
  nama: string;
  catatan: string;
}

/** Tempat penyimpanan per cabang (freezer, chiller, gudang, dst). */
export function PenyimpananPage() {
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();
  const { data: tempat, isLoading } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  const [form, setForm] = useState<FormState | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        catatan: f.catatan || null,
        ...(branchId ? { branch_id: branchId } : {}),
      };
      return f.id
        ? api(`/penyimpanan/${f.id}`, { method: "PATCH", body: { nama: f.nama, catatan: f.catatan || null } })
        : api("/penyimpanan", { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (t: PenyimpananDto) =>
      api(`/penyimpanan/${t.id}`, { method: "PATCH", body: { is_active: !t.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["penyimpanan"] }),
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
          <button onClick={() => setForm({ nama: "", catatan: "" })} className={btnPrimary}>
            + Tambah Tempat
          </button>
        }
      >
        Tempat Penyimpanan ({tempat?.length ?? 0})
      </PageTitle>
      <div className="mb-3 text-sm text-stone-500">
        Per cabang — dipakai saat mengisi faktur produksi/pembelian agar setiap stok masuk
        tercatat disimpan di mana (rujukan saat stock opname).
      </div>
      <ErrorText error={toggle.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Catatan</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(tempat ?? []).map((t) => (
              <tr key={t.id}>
                <td className={`${tdClass} font-medium`}>{t.nama}</td>
                <td className={`${tdClass} text-stone-400`}>{t.catatan ?? "—"}</td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {t.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <button
                    onClick={() => setForm({ id: t.id, nama: t.nama, catatan: t.catatan ?? "" })}
                    className="text-sm font-medium text-orange-600 hover:underline"
                  >
                    Ubah
                  </button>
                  <button
                    onClick={() => toggle.mutate(t)}
                    className="ml-3 text-sm font-medium text-stone-500 hover:underline"
                  >
                    {t.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </td>
              </tr>
            ))}
            {(tempat ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-stone-400">
                  Belum ada tempat penyimpanan di cabang ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Tempat Penyimpanan" : "Tambah Tempat Penyimpanan"}
      >
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama tempat</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
                placeholder="mis. Freezer 1, Chiller, Gudang Kering"
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
