import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AreaKebersihanDto } from "@kakarut/shared";
import { ErrorText, Modal, Spinner, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";

/**
 * Master AREA KEBERSIHAN — daftar yang dicentang karyawan tiap sesi.
 * Dibuat modal (bukan halaman sendiri) supaya sidebar tidak bertambah panjang,
 * meniru KategoriManagerModal.
 *
 * "Berlaku di" = semua lokasi vs satu cabang: itulah yang membuat Central
 * Kitchen bisa punya area sendiri tanpa mengotori daftar area toko.
 */
export function AreaKebersihanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const [nama, setNama] = useState("");
  const [branchId, setBranchId] = useState("");

  // `branch_id=all` — ini layar MASTER, jadi harus melihat area seluruh cabang
  // termasuk yang nonaktif. Tanpa penanda itu daftarnya menyempit ke cabang
  // penugasan pemanggil (bawaan "saya sedang jadi pelapor"), sehingga admin
  // bercabang tak bisa lagi mengurus area cabang lain dari sini.
  const { data: area = [], isLoading } = useQuery({
    queryKey: ["kebersihan-area", "master"],
    queryFn: () => api<AreaKebersihanDto[]>("/kebersihan/area?branch_id=all"),
    enabled: open,
  });

  const segarkan = () => queryClient.invalidateQueries({ queryKey: ["kebersihan-area"] });

  const tambah = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/kebersihan/area", {
        method: "POST",
        body: {
          nama: nama.trim(),
          branch_id: branchId || null,
          // Urutan mengikuti panjang daftar → area baru muncul di bawah.
          urutan: area.length,
        },
      }),
    onSuccess: () => {
      setNama("");
      segarkan();
    },
  });

  const ubah = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) =>
      api<{ ok: true }>(`/kebersihan/area/${v.id}`, {
        method: "PATCH",
        body: { is_active: v.is_active },
      }),
    onSuccess: segarkan,
  });

  const hapus = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/kebersihan/area/${id}`, { method: "DELETE" }),
    onSuccess: segarkan,
  });

  return (
    <Modal open={open} onClose={onClose} title="⚙ Atur Area Kebersihan" lebar="max-w-xl">
      <div className="mb-4 rounded-xl border border-stone-200 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Nama area baru</label>
            <input
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="mis. Toilet, Lantai depan, Chiller"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Berlaku di</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={inputClass}
            >
              <option value="">Semua lokasi</option>
              {cabang
                .filter((b) => b.is_active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nama}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <ErrorText error={tambah.error} />
        <button
          onClick={() => tambah.mutate()}
          disabled={!nama.trim() || tambah.isPending}
          className={`${btnPrimary} mt-2`}
        >
          {tambah.isPending ? "Menyimpan…" : "Tambah Area"}
        </button>
      </div>

      <ErrorText error={ubah.error ?? hapus.error} />

      {isLoading ? (
        <Spinner />
      ) : area.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
          Belum ada area. Tambahkan minimal satu agar karyawan bisa mengisi laporan.
        </div>
      ) : (
        <div className="space-y-2">
          {area.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 p-2"
            >
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate font-medium ${
                    a.is_active ? "text-stone-800" : "text-stone-400 line-through"
                  }`}
                >
                  {a.nama}
                </div>
                <div className="text-xs text-stone-500">{a.cabang ?? "Semua lokasi"}</div>
              </div>
              <button
                onClick={() => ubah.mutate({ id: a.id, is_active: !a.is_active })}
                className={btnSecondary}
              >
                {a.is_active ? "Nonaktifkan" : "Aktifkan"}
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Hapus area "${a.nama}"? Laporan lama tetap menyimpan namanya, jadi riwayat aman.`,
                    )
                  ) {
                    hapus.mutate(a.id);
                  }
                }}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50"
              >
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
