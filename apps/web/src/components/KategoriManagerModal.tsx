import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { KategoriDto } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary, inputClass } from "./ui";
import { api } from "../lib/api";

interface FormState {
  id?: string;
  nama: string;
  sort_order: string;
}

/**
 * Modal CRUD kategori generik — dipakai untuk kategori MENU (`/kategori`) dan
 * kategori BAHAN (`/kategori-bahan`). Keduanya berbentuk {id, nama, sort_order}
 * dengan aturan sama (owner/admin; yang masih dipakai tak bisa dihapus → 409).
 */
export function KategoriManagerModal({
  open,
  onClose,
  endpoint,
  queryKey,
  judul,
  deskripsi,
}: {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  queryKey: string;
  judul: string;
  deskripsi: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [queryKey] });
  const { data: rows, error: gagalMuat } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api<KategoriDto[]>(endpoint),
    enabled: open,
  });
  const [form, setForm] = useState<FormState | null>(null);

  const simpan = useMutation({
    mutationFn: (f: FormState) => {
      const body = { nama: f.nama, sort_order: Number(f.sort_order) || 0 };
      return f.id
        ? api(`${endpoint}/${f.id}`, { method: "PATCH", body })
        : api(endpoint, { method: "POST", body });
    },
    onSuccess: () => {
      setForm(null);
      invalidate();
    },
  });
  const hapus = useMutation({
    mutationFn: (k: KategoriDto) => api(`${endpoint}/${k.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  return (
    <Modal open={open} onClose={onClose} title={judul}>
      <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{deskripsi}</div>
      <ErrorText error={hapus.error} />

      <div className="mb-3 divide-y divide-stone-100 rounded-lg border border-stone-200">
        {(rows ?? []).map((k) => (
          <div key={k.id} className="flex items-center gap-2 px-3 py-2">
            <span className="flex-1 text-sm font-medium text-stone-800">{k.nama}</span>
            <span className="w-10 text-right text-xs text-stone-400">{k.sort_order}</span>
            <button
              onClick={() => setForm({ id: k.id, nama: k.nama, sort_order: String(k.sort_order) })}
              className="text-sm font-medium text-orange-600 hover:underline"
            >
              Ubah
            </button>
            <button
              onClick={() => {
                if (confirm(`Hapus kategori "${k.nama}"?`)) hapus.mutate(k);
              }}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Hapus
            </button>
          </div>
        ))}
        {(rows ?? []).length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-stone-400">
            {/*
              GAGAL MEMUAT ≠ BELUM ADA KATEGORI. Modal ini dibuka justru saat
              orang hendak MENAMBAH kategori, jadi daftar kosong palsu langsung
              berbuah duplikat — dan kategori ganda menyebar ke dropdown Menu &
              Bahan Baku, tempat keduanya terlihat sah.
            */}
            {gagalMuat ? (
              <>
                <div className="font-medium text-red-700">Daftar kategori gagal dimuat.</div>
                <div className="mt-1">
                  Kosongnya <b>bukan</b> berarti belum ada kategori — muat ulang dulu sebelum
                  menambah.
                </div>
              </>
            ) : (
              "Belum ada kategori."
            )}
          </div>
        )}
      </div>

      {form ? (
        <form onSubmit={onSubmit} className="space-y-3 rounded-lg bg-stone-50 p-3">
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Nama</label>
              <input
                required
                autoFocus
                maxLength={30}
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Urutan</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <ErrorText error={simpan.error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
              Batal
            </button>
            <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
              Simpan
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setForm({ nama: "", sort_order: "0" })} className={btnPrimary}>
          + Tambah Kategori
        </button>
      )}
    </Modal>
  );
}
