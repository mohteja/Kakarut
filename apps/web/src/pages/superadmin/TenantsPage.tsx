import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
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

interface Tenant {
  id: string;
  nama: string;
  slug: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  jumlah_cabang: number;
  jumlah_user: number;
}

interface FormState {
  nama: string;
  cabang_nama: string;
  owner_nama: string;
  owner_email: string;
  owner_password: string;
}

export function TenantsPage() {
  const queryClient = useQueryClient();
  const { data: tenants, isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => api<Tenant[]>("/admin/tenants"),
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [dibuat, setDibuat] = useState<{ email: string; password: string } | null>(null);

  const buat = useMutation({
    mutationFn: (f: FormState) => api("/admin/tenants", { method: "POST", body: f }),
    onSuccess: (_data, f) => {
      setDibuat({ email: f.owner_email, password: f.owner_password });
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (t: Tenant) =>
      api(`/admin/tenants/${t.id}`, { method: "PATCH", body: { is_active: !t.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) buat.mutate(form);
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageTitle
        aksi={
          <button
            onClick={() =>
              setForm({
                nama: "",
                cabang_nama: "Pusat",
                owner_nama: "",
                owner_email: "",
                owner_password: "",
              })
            }
            className={btnPrimary}
          >
            + Buat Tenant
          </button>
        }
      >
        Tenant / Perusahaan ({tenants?.length ?? 0})
      </PageTitle>

      {dibuat && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          Tenant dibuat. Kredensial owner: <b>{dibuat.email}</b> / <b>{dibuat.password}</b> —
          sampaikan ke pemilik dan minta segera ganti password.
        </div>
      )}
      <ErrorText error={toggle.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Perusahaan</th>
              <th className={thClass}>Slug</th>
              <th className={thClass}>Plan</th>
              <th className={`${thClass} text-right`}>Cabang</th>
              <th className={`${thClass} text-right`}>User</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(tenants ?? []).map((t) => (
              <tr key={t.id}>
                <td className={`${tdClass} font-medium`}>{t.nama}</td>
                <td className={tdClass}>{t.slug}</td>
                <td className={tdClass}>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold uppercase">
                    {t.plan}
                  </span>
                </td>
                <td className={`${tdClass} text-right`}>{t.jumlah_cabang}</td>
                <td className={`${tdClass} text-right`}>{t.jumlah_user}</td>
                <td className={tdClass}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {t.is_active ? "Aktif" : "Ditangguhkan"}
                  </span>
                </td>
                <td className={`${tdClass} text-right`}>
                  <button
                    onClick={() => toggle.mutate(t)}
                    className="text-sm font-medium text-stone-500 hover:underline"
                  >
                    {t.is_active ? "Tangguhkan" : "Aktifkan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={form !== null} onClose={() => setForm(null)} title="Buat Tenant Baru">
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama perusahaan</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Nama cabang pertama</label>
              <input
                required
                value={form.cabang_nama}
                onChange={(e) => setForm({ ...form, cabang_nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Nama owner</label>
              <input
                required
                value={form.owner_nama}
                onChange={(e) => setForm({ ...form, owner_nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Email owner</label>
                <input
                  required
                  type="email"
                  value={form.owner_email}
                  onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Password owner</label>
                <input
                  required
                  minLength={8}
                  value={form.owner_password}
                  onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <ErrorText error={buat.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={buat.isPending} className={btnPrimary}>
                Buat Tenant
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
