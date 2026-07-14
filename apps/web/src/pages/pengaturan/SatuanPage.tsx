import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { SatuanDto } from "@kakarut/shared";
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
  sort_order: string;
}

/**
 * Master Satuan: daftar satuan (pcs, gr, kg, …) yang dipakai dropdown Bahan
 * Baku. Owner/admin. Satuan yang masih dipakai bahan tak bisa dihapus (409).
 */
export function SatuanPage() {
  const queryClient = useQueryClient();
  const { data: satuan, isLoading } = useQuery({
    queryKey: ["satuan"],
    queryFn: () => api<SatuanDto[]>("/satuan"),
  });
  const [form, setForm] = useState<FormState | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = { nama: f.nama, sort_order: Number(f.sort_order) || 0 };
      return f.id
        ? api(`/satuan/${f.id}`, { method: "PATCH", body })
        : api("/satuan", { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["satuan"] });
    },
  });

  const hapus = useMutation({
    mutationFn: (s: SatuanDto) => api(`/satuan/${s.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["satuan"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <PageTitle
        aksi={
          <button onClick={() => setForm({ nama: "", sort_order: "0" })} className={btnPrimary}>
            + Tambah Satuan
          </button>
        }
      >
        Master Satuan ({satuan?.length ?? 0})
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Satuan dipakai sebagai pilihan pada form Bahan Baku (pcs, gr, kg, ml, …). Satuan yang
        masih dipakai bahan tidak bisa dihapus.
      </div>
      <ErrorText error={hapus.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Urutan</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(satuan ?? []).map((s) => (
              <tr key={s.id}>
                <td className={`${tdClass} font-medium`}>{s.nama}</td>
                <td className={tdClass}>{s.sort_order}</td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <button
                    onClick={() =>
                      setForm({ id: s.id, nama: s.nama, sort_order: String(s.sort_order) })
                    }
                    className="text-sm font-medium text-orange-600 hover:underline"
                  >
                    Ubah
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Hapus satuan "${s.nama}"?`)) hapus.mutate(s);
                    }}
                    className="ml-3 text-sm font-medium text-red-600 hover:underline"
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
            {(satuan ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-stone-400">
                  Belum ada satuan — tambahkan untuk dipakai di form Bahan Baku.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Satuan" : "Tambah Satuan"}
      >
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama</label>
              <input
                required
                autoFocus
                maxLength={20}
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
                placeholder="mis. gr, kg, botol"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Urutan (opsional)</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-400">Angka kecil tampil lebih dulu.</p>
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
