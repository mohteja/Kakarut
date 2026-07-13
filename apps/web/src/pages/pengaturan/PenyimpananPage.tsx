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
import { useCabangData } from "../../context/BranchContext";
import { CabangDataBar } from "../../components/CabangDataBar";
import { api } from "../../lib/api";

interface FormState {
  id?: string;
  nama: string;
  catatan: string;
}

interface KaryawanRow {
  user_id: string;
  nama: string;
  email: string;
  role: "owner" | "admin" | "cashier" | "tim";
  is_active: boolean;
  branch_id: string | null;
  cabang: string | null;
}

const roleLabel = (r: string) =>
  r === "owner" ? "Owner" : r === "admin" ? "Admin" : r === "tim" ? "Tim" : "Kasir";

/** Pilih akun yang boleh opname di sebuah tempat penyimpanan. */
function PetugasModal({ tempat, onClose }: { tempat: PenyimpananDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<KaryawanRow[]>("/karyawan"),
  });
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tempat.petugas.map((p) => p.user_id)),
  );

  const simpan = useMutation({
    mutationFn: () =>
      api(`/penyimpanan/${tempat.id}/petugas`, {
        method: "PUT",
        body: { user_ids: [...selected] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["penyimpanan"] });
      onClose();
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // owner/admin (bebas cabang) + kasir/tim yang cabangnya = cabang tempat ini
  const daftar = karyawan.filter(
    (k) =>
      k.is_active &&
      (k.role === "owner" || k.role === "admin" || k.branch_id === tempat.branch_id),
  );

  return (
    <Modal open onClose={onClose} title={`Petugas Opname — ${tempat.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Pilih akun yang boleh melakukan stock opname di tempat ini. <b>Kosong = semua boleh</b>{" "}
          (yang boleh opname di cabang). Owner/admin selalu bisa.
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {daftar.length === 0 && (
            <div className="py-4 text-center text-sm text-stone-400">Belum ada karyawan.</div>
          )}
          {daftar.map((k) => (
            <label
              key={k.user_id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${
                selected.has(k.user_id) ? "border-orange-500 bg-orange-50" : "border-stone-200"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(k.user_id)}
                onChange={() => toggle(k.user_id)}
              />
              <span className="min-w-0">
                <span className="font-medium">{k.nama}</span>
                <span className="ml-2 rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
                  {roleLabel(k.role)}
                </span>
                {k.cabang && <span className="block text-xs text-stone-400">{k.cabang}</span>}
              </span>
            </label>
          ))}
        </div>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan Petugas"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Tempat penyimpanan per cabang (freezer, chiller, gudang, dst). */
export function PenyimpananPage() {
  // Tempat penyimpanan fisik per cabang — dari Kantor pilih cabangnya.
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const { data: tempat, isLoading } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [petugas, setPetugas] = useState<PenyimpananDto | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nama: f.nama,
        catatan: f.catatan || null,
        ...(branchId ? { branch_id: branchId } : {}),
      };
      return f.id
        ? api(`/penyimpanan/${f.id}`, {
            method: "PATCH",
            body: { nama: f.nama, catatan: f.catatan || null },
          })
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
    <div className="max-w-4xl">
      <CabangDataBar />
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
        tercatat disimpan di mana. Atur <b>Petugas</b> untuk membatasi siapa yang boleh stock
        opname di tiap tempat (kosong = semua boleh; owner/admin selalu bisa).
      </div>
      <ErrorText error={toggle.error} />

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={thClass}>Nama</th>
              <th className={thClass}>Petugas Opname</th>
              <th className={thClass}>Status</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(tempat ?? []).map((t) => (
              <tr key={t.id}>
                <td className={`${tdClass} font-medium`}>
                  {t.nama}
                  {t.catatan && (
                    <span className="block text-xs font-normal text-stone-400">{t.catatan}</span>
                  )}
                </td>
                <td className={tdClass}>
                  {t.petugas.length === 0 ? (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                      Semua boleh
                    </span>
                  ) : (
                    <span className="text-sm text-stone-700">
                      {t.petugas.map((p) => p.nama).join(", ")}
                    </span>
                  )}
                </td>
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
                    onClick={() => setPetugas(t)}
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    Petugas
                  </button>
                  <button
                    onClick={() => setForm({ id: t.id, nama: t.nama, catatan: t.catatan ?? "" })}
                    className="ml-3 text-sm font-medium text-orange-600 hover:underline"
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

      {petugas && <PetugasModal tempat={petugas} onClose={() => setPetugas(null)} />}
    </div>
  );
}
