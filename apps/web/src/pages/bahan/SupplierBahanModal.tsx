import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { BahanSupplierDto, SupplierDto } from "@kakarut/shared";
import {
  ErrorText,
  Modal,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { api } from "../../lib/api";

/**
 * Atur SUPPLIER sebuah bahan: centang beberapa supplier (info "beli di mana")
 * dan tandai SATU sebagai supplier utama/langganan. Supplier baru bisa
 * ditambah langsung dari sini (masuk master supplier).
 */
export function SupplierBahanModal({
  bahan,
  onClose,
}: {
  bahan: { id: string; nama: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: master } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
  });
  const { data: terpasang, isLoading } = useQuery({
    queryKey: ["bahan-supplier", bahan.id],
    queryFn: () => api<BahanSupplierDto[]>(`/bahan/${bahan.id}/supplier`),
  });

  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [utamaId, setUtamaId] = useState<string | null>(null);
  // isi state sekali dari data tersimpan (modal di-remount per bahan via key)
  const [siap, setSiap] = useState(false);
  useEffect(() => {
    if (terpasang && !siap) {
      setPilih(new Set(terpasang.map((s) => s.supplier_id)));
      setUtamaId(terpasang.find((s) => s.is_utama)?.supplier_id ?? null);
      setSiap(true);
    }
  }, [terpasang, siap]);

  function toggle(id: string) {
    const s = new Set(pilih);
    if (s.has(id)) {
      s.delete(id);
      // utama ikut hilang → pindahkan ke sisa pilihan pertama (bila ada)
      if (utamaId === id) setUtamaId([...s][0] ?? null);
    } else {
      s.add(id);
      if (utamaId == null || !s.has(utamaId)) setUtamaId(id);
    }
    setPilih(s);
  }

  const simpan = useMutation({
    mutationFn: () =>
      api<BahanSupplierDto[]>(`/bahan/${bahan.id}/supplier`, {
        method: "PUT",
        body: {
          items: [...pilih].map((supplier_id) => ({
            supplier_id,
            is_utama: supplier_id === utamaId,
          })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bahan"] });
      queryClient.invalidateQueries({ queryKey: ["bahan-supplier", bahan.id] });
      onClose();
    },
  });

  // Tambah supplier baru langsung dari modal (masuk master supplier).
  const [tambah, setTambah] = useState<{ nama: string; telepon: string } | null>(null);
  const tambahSupplier = useMutation({
    mutationFn: (f: { nama: string; telepon: string }) =>
      api<SupplierDto>("/supplier", {
        method: "POST",
        body: { nama: f.nama, telepon: f.telepon || null },
      }),
    onSuccess: (baru) => {
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      setPilih((prev) => new Set([...prev, baru.id]));
      setUtamaId((u) => u ?? baru.id);
      setTambah(null);
    },
  });
  function onSubmitTambah(e: FormEvent) {
    e.preventDefault();
    if (tambah && tambah.nama.trim()) tambahSupplier.mutate(tambah);
  }

  const daftar = (master ?? []).filter((s) => s.is_active);

  return (
    <Modal open onClose={onClose} title={`Supplier — ${bahan.nama}`}>
      <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
        Centang supplier tempat membeli bahan ini (boleh lebih dari satu), lalu pilih{" "}
        <b>★ Utama</b> untuk supplier langganan.
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="mb-3 max-h-72 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200">
          {daftar.map((s) => {
            const dipilih = pilih.has(s.id);
            return (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${dipilih ? "bg-orange-50/60" : "hover:bg-stone-50"}`}
              >
                <input
                  type="checkbox"
                  checked={dipilih}
                  onChange={() => toggle(s.id)}
                  aria-label={`Pilih supplier ${s.nama}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-800">
                    {s.nama}
                  </span>
                  {(s.telepon || s.alamat) && (
                    <span className="block truncate text-xs text-stone-400">
                      {[s.telepon, s.alamat].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-xs font-semibold ${
                    dipilih ? "text-amber-700" : "text-stone-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="supplier-utama"
                    checked={utamaId === s.id}
                    onChange={() => setUtamaId(s.id)}
                    disabled={!dipilih}
                    aria-label={`Jadikan ${s.nama} supplier utama`}
                  />
                  ★ Utama
                </span>
              </label>
            );
          })}
          {daftar.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-stone-400">
              Belum ada supplier — tambahkan lewat tombol di bawah.
            </div>
          )}
        </div>
      )}

      {tambah ? (
        <form onSubmit={onSubmitTambah} className="mb-3 space-y-2 rounded-lg bg-stone-50 p-3">
          <div className="grid grid-cols-[1fr_10rem] gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Nama supplier</label>
              <input
                required
                autoFocus
                value={tambah.nama}
                onChange={(e) => setTambah({ ...tambah, nama: e.target.value })}
                aria-label="Nama supplier baru"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Telepon (opsional)</label>
              <input
                value={tambah.telepon}
                onChange={(e) => setTambah({ ...tambah, telepon: e.target.value })}
                aria-label="Telepon supplier baru"
                className={inputClass}
              />
            </div>
          </div>
          <ErrorText error={tambahSupplier.error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTambah(null)} className={btnSecondary}>
              Batal
            </button>
            <button type="submit" disabled={tambahSupplier.isPending} className={btnPrimary}>
              Tambah & pilih
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setTambah({ nama: "", telepon: "" })}
          className="mb-3 text-sm font-medium text-orange-600 hover:underline"
        >
          ＋ Supplier baru
        </button>
      )}

      <ErrorText error={simpan.error} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-stone-500">
          {pilih.size === 0 ? "Tanpa supplier" : `${pilih.size} supplier dipilih`}
        </span>
        <div className="flex gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
