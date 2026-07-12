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
  tipe: "store" | "central_kitchen";
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
            body: { nama: f.nama, alamat: f.alamat || null, tipe: f.tipe },
          })
        : api("/cabang", {
            method: "POST",
            body: { nama: f.nama, alamat: f.alamat || null, tipe: f.tipe },
          }),
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
          <button
            onClick={() => setForm({ nama: "", alamat: "", tipe: "store" })}
            className={btnPrimary}
          >
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
                <td className={`${tdClass} font-medium`}>
                  {b.nama}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      b.tipe === "central_kitchen"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {b.tipe === "central_kitchen" ? "🏭 Central Kitchen" : "🏪 Store"}
                  </span>
                </td>
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
                    onClick={() =>
                      setForm({ id: b.id, nama: b.nama, alamat: b.alamat ?? "", tipe: b.tipe })
                    }
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
            <div>
              <label className="mb-1 block text-sm font-medium">Jenis cabang</label>
              <select
                value={form.tipe}
                onChange={(e) =>
                  setForm({ ...form, tipe: e.target.value as FormState["tipe"] })
                }
                className={inputClass}
              >
                <option value="store">🏪 Store — outlet penjualan</option>
                <option value="central_kitchen">
                  🏭 Central Kitchen — memproses/produksi lalu mengirim ke store
                </option>
              </select>
              <p className="mt-1 text-xs text-stone-400">
                Central Kitchen membuat faktur produksi/beli, lalu saat <b>dikirim</b> pilih
                cabang store sebagai tujuan — stok masuk di store saat diterima.
              </p>
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
