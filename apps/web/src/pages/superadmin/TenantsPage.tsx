import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
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
  const { data: tenants, isLoading, error: gagalMuat } = useQuery({
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

  // Super admin murni set plan (tanpa provisioning lokasi — itu jalur owner).
  const ubahPlan = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) =>
      api(`/admin/tenants/${id}`, { method: "PATCH", body: { plan } }),
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
      <ErrorText error={ubahPlan.error} />

      <TabelResponsif
        data={tenants ?? []}
        kunci={(t) => t.id}
        kosong="Belum ada tenant."
        galat={gagalMuat}
        kolom={[
          { judul: "Perusahaan", hp: "judul", kelasSel: "font-medium", sel: (t) => t.nama },
          { judul: "Slug", hp: "sub", sel: (t) => t.slug },
          {
            judul: "Plan",
            sel: (t) => (
              <select
                value={t.plan === "pro" ? "pro" : "lite"}
                onChange={(e) => ubahPlan.mutate({ id: t.id, plan: e.target.value })}
                aria-label={`Plan ${t.nama}`}
                className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-xs font-semibold uppercase"
              >
                <option value="lite">Lite</option>
                <option value="pro">Pro</option>
              </select>
            ),
          },
          { judul: "Cabang", kanan: true, sel: (t) => t.jumlah_cabang },
          { judul: "User", kanan: true, sel: (t) => t.jumlah_user },
          {
            judul: "Status",
            sel: (t) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  t.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
                }`}
              >
                {t.is_active ? "Aktif" : "Ditangguhkan"}
              </span>
            ),
          },
          {
            hp: "aksi",
            kelasSel: "text-right",
            sel: (t) => (
              /*
                MENANGGUHKAN = MENGUNCI SELURUH PERUSAHAAN, SEKETIKA.
                Gerbang sesi menyaring `companies.is_active` (middleware auth),
                jadi begitu ditangguhkan SETIAP permintaan dari SETIAP
                penggunanya dijawab 401 — kasir yang sedang melayani antrean
                ikut terlempar, di tengah bill yang belum dibayar.

                Tombolnya duduk di kolom yang sama pada tiap baris tenant, jadi
                salah baris berarti mematikan perusahaan yang salah. Karena itu
                konfirmasinya MENYEBUT NAMA: yang dibaca orang sebelum menekan
                "OK" adalah nama perusahaannya, bukan pertanyaan umum.

                Ini juga menyamakan langkah dengan sisa aplikasi — menghapus
                SATU member pun sudah minta konfirmasi, begitu pula bersihkan
                log galat. Aksi paling merusak di sini justru yang tak punya.
              */
              <button
                onClick={() => {
                  const pesan = t.is_active
                    ? `Tangguhkan "${t.nama}"?\n\nSeluruh penggunanya langsung tidak bisa memakai aplikasi — termasuk kasir yang sedang melayani. Bisa diaktifkan lagi kapan saja.`
                    : `Aktifkan kembali "${t.nama}"?\n\nPenggunanya bisa masuk lagi seperti biasa.`;
                  if (confirm(pesan)) toggle.mutate(t);
                }}
                disabled={toggle.isPending}
                className="text-sm font-medium text-stone-500 hover:underline disabled:opacity-50"
              >
                {t.is_active ? "Tangguhkan" : "Aktifkan"}
              </button>
            ),
          },
        ]}
      />

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
