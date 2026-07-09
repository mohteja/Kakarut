import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useBranch, type Cabang } from "../../context/BranchContext";
import { api } from "../../lib/api";

interface FormState {
  id?: string;
  nama: string;
  alamat: string;
}

export function CabangPage() {
  const { cabang } = useBranch();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api(`/cabang/${f.id}`, {
            method: "PATCH",
            body: { nama: f.nama, alamat: f.alamat || null },
          })
        : api("/cabang", { method: "POST", body: { nama: f.nama, alamat: f.alamat || null } }),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["cabang"] });
    },
  });

  const toggleAktif = useMutation({
    mutationFn: (b: Cabang) =>
      api(`/cabang/${b.id}`, { method: "PATCH", body: { is_active: !b.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cabang"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          <button onClick={() => setForm({ nama: "", alamat: "" })} className={btnPrimary}>
            + Tambah Cabang
          </button>
        }
      >
        Cabang
      </PageTitle>
      <ErrorText error={toggleAktif.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Alamat</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {cabang.map((b) => (
              <tr key={b.id}>
                <td className={`${tdClass} font-medium`}>{b.nama}</td>
                <td className={tdClass}>{b.alamat ?? "—"}</td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      b.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {b.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <button
                    onClick={() => setForm({ id: b.id, nama: b.nama, alamat: b.alamat ?? "" })}
                    className="text-sm font-medium text-orange-600 hover:underline"
                  >
                    Ubah
                  </button>
                  <button
                    onClick={() => toggleAktif.mutate(b)}
                    className="ml-3 text-sm font-medium text-stone-500 hover:underline"
                  >
                    {b.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? "Ubah Cabang" : "Tambah Cabang"}>
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama cabang</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Alamat</label>
              <input
                value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
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
