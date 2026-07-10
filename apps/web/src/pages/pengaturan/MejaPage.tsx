import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import type { MejaDto, MejaTipe } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";

interface FormState {
  id?: string;
  nama: string;
  tipe: MejaTipe;
}

type Pos = Record<string, { x: number; y: number }>;

const clamp = (v: number) => Math.max(4, Math.min(96, Math.round(v)));

/**
 * Pengaturan meja per cabang: tambah nomor meja, atur tata letak denah
 * (seret token), dan meja "Ruang Tunggu" untuk take away. Kasir boleh mengatur
 * meja cabangnya sendiri; owner/admin lewat pemilih cabang.
 */
export function MejaPage() {
  const { branchQuery, branchId } = useBranch();
  const queryClient = useQueryClient();
  const { data: meja, isLoading } = useQuery({
    queryKey: ["meja", branchQuery],
    queryFn: () => api<MejaDto[]>(`/meja${branchQuery}`),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [pos, setPos] = useState<Pos>({});
  const [dirty, setDirty] = useState(false);
  const dragId = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Seed posisi lokal dari server setiap data berubah (mis. ganti cabang).
  useEffect(() => {
    if (!meja) return;
    setPos(Object.fromEntries(meja.map((m) => [m.id, { x: m.pos_x, y: m.pos_y }])));
    setDirty(false);
  }, [meja]);

  const simpan = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api(`/meja/${f.id}`, { method: "PATCH", body: { nama: f.nama } })
        : api("/meja", {
            method: "POST",
            body: { nama: f.nama, tipe: f.tipe, ...(branchId ? { branch_id: branchId } : {}) },
          }),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["meja"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (m: MejaDto) =>
      api(`/meja/${m.id}`, { method: "PATCH", body: { is_active: !m.is_active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meja"] }),
  });

  const hapus = useMutation({
    mutationFn: (m: MejaDto) => api(`/meja/${m.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meja"] }),
  });

  const simpanTataLetak = useMutation({
    mutationFn: () =>
      api("/meja/tata-letak", {
        method: "PUT",
        body: {
          items: (meja ?? []).map((m) => ({
            id: m.id,
            pos_x: pos[m.id]?.x ?? m.pos_x,
            pos_y: pos[m.id]?.y ?? m.pos_y,
          })),
        },
      }),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["meja"] });
    },
  });

  function onPointerDown(e: PointerEvent<HTMLDivElement>, id: string) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragId.current = id;
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>, id: string) {
    if (dragId.current !== id || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 100);
    const y = clamp(((e.clientY - r.top) / r.height) * 100);
    setPos((p) => ({ ...p, [id]: { x, y } }));
    setDirty(true);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>, id: string) {
    if (dragId.current === id) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragId.current = null;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) simpan.mutate(form);
  }

  if (isLoading) return <Spinner />;

  const list = meja ?? [];

  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          <button
            onClick={() => setForm({ nama: "", tipe: "dine_in" })}
            className={btnPrimary}
          >
            + Tambah Meja
          </button>
        }
      >
        Pengaturan Meja ({list.length})
      </PageTitle>
      <div className="mb-3 text-sm text-stone-500">
        Tambah nomor meja lalu <b>seret</b> tiap meja untuk menata denah sesuai ruangan. Meja{" "}
        <b>Ruang Tunggu</b> dipakai untuk pesanan bawa pulang (take away). Kasir memilih meja saat
        memulai transaksi.
      </div>

      <ErrorText error={toggle.error || hapus.error} />

      {/* Denah — seret token untuk menata */}
      <Card className="mb-3 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-stone-700">Denah Ruangan</span>
          <button
            onClick={() => simpanTataLetak.mutate()}
            disabled={!dirty || simpanTataLetak.isPending}
            className={`${btnPrimary} px-3 py-1.5 text-xs`}
          >
            {simpanTataLetak.isPending ? "Menyimpan…" : dirty ? "Simpan Tata Letak" : "Tersimpan"}
          </button>
        </div>
        <ErrorText error={simpanTataLetak.error} />
        <div
          ref={canvasRef}
          className="relative mt-2 aspect-[4/3] w-full touch-none overflow-hidden rounded-lg border border-dashed border-stone-300 bg-[linear-gradient(#f5f5f4_1px,transparent_1px),linear-gradient(90deg,#f5f5f4_1px,transparent_1px)] bg-[length:24px_24px] bg-stone-50"
        >
          {list.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-stone-400">
              Belum ada meja. Ketuk "+ Tambah Meja".
            </div>
          )}
          {list.map((m) => {
            const p = pos[m.id] ?? { x: m.pos_x, y: m.pos_y };
            const takeaway = m.tipe === "takeaway";
            return (
              <div
                key={m.id}
                onPointerDown={(e) => onPointerDown(e, m.id)}
                onPointerMove={(e) => onPointerMove(e, m.id)}
                onPointerUp={(e) => onPointerUp(e, m.id)}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none select-none items-center justify-center rounded-lg px-3 py-2 text-center text-xs font-semibold shadow-sm active:cursor-grabbing ${
                  takeaway
                    ? "border border-amber-400 bg-amber-100 text-amber-800"
                    : m.is_active
                      ? "border border-blue-300 bg-blue-100 text-blue-800"
                      : "border border-stone-300 bg-stone-100 text-stone-400"
                }`}
              >
                {takeaway ? `🥡 ${m.nama}` : m.nama}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-stone-400">
          Tip: seret meja untuk memindahkan, lalu tekan "Simpan Tata Letak".
        </div>
      </Card>

      {/* Daftar meja + aksi */}
      <Card className="divide-y divide-stone-100">
        {list.length === 0 && (
          <div className="p-6 text-center text-sm text-stone-400">Belum ada meja di cabang ini.</div>
        )}
        {list.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-stone-800">{m.nama}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    m.tipe === "takeaway"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {m.tipe === "takeaway" ? "Ruang Tunggu · Take away" : "Dine-in"}
                </span>
                {!m.is_active && (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                    Nonaktif
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-sm">
              <button
                onClick={() => setForm({ id: m.id, nama: m.nama, tipe: m.tipe })}
                className="font-medium text-orange-600 hover:underline"
              >
                Ubah
              </button>
              <button
                onClick={() => toggle.mutate(m)}
                className="font-medium text-stone-500 hover:underline"
              >
                {m.is_active ? "Nonaktifkan" : "Aktifkan"}
              </button>
              {m.tipe !== "takeaway" && (
                <button
                  onClick={() => {
                    if (confirm(`Hapus meja "${m.nama}"?`)) hapus.mutate(m);
                  }}
                  className="font-medium text-red-600 hover:underline"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        ))}
      </Card>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Ubah Meja" : "Tambah Meja"}
      >
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Nama / nomor meja</label>
              <input
                required
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={inputClass}
                placeholder="mis. Meja 1, VIP 2, Ruang Tunggu"
              />
            </div>
            {!form.id && (
              <div>
                <label className="mb-1 block text-sm font-medium">Jenis</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, tipe: "dine_in" })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      form.tipe === "dine_in"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-stone-300 text-stone-600"
                    }`}
                  >
                    Meja makan (Dine-in)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, tipe: "takeaway" })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      form.tipe === "takeaway"
                        ? "border-amber-500 bg-amber-50 text-amber-700"
                        : "border-stone-300 text-stone-600"
                    }`}
                  >
                    Ruang Tunggu (Take away)
                  </button>
                </div>
              </div>
            )}
            <ErrorText error={simpan.error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className={btnSecondary}>
                Batal
              </button>
              <button type="submit" disabled={simpan.isPending} className={btnPrimary}>
                {simpan.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
