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
import { CabangDataBar } from "../../components/CabangDataBar";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatWaktu } from "../../lib/format";
import {
  KosongkanMejaModal,
  kelasStatus,
  labelStatus,
  useMejaStatus,
} from "./MejaStatusPanel";

interface FormState {
  id?: string;
  nama: string;
  tipe: MejaTipe;
}

type Pos = Record<string, { x: number; y: number }>;

const clamp = (v: number) => Math.max(4, Math.min(96, Math.round(v)));

/**
 * Meja per cabang — denah + status isi/kosong. Dua mode terpisah:
 *  - "view": melihat denah, status okupansi, dan membereskan meja. TERBUKA
 *    untuk seluruh peran cabang: waiter (tim), dapur, bar, dan kasir sama-sama
 *    perlu tahu meja mana yang kosong.
 *  - "edit": masuk lewat "Tambah Meja"/"Atur Denah" — HANYA owner/admin/kasir.
 *    Di sini boleh menambah, ubah, hapus, dan menyeret tata letak.
 *
 * Pembatasan mode edit BUKAN cuma kosmetik: sebelum ini modul meja di server
 * tak punya gerbang peran sama sekali, jadi siapa pun yang punya membership
 * bisa menghapus meja lewat API. Gerbangnya sekarang ada di server; tombolnya
 * disembunyikan di sini supaya layarnya jujur, bukan supaya aman.
 *
 * Tata letak di kiri, daftar meja di kanan (desktop); di mobile denah di atas,
 * daftar di bawah.
 */
export function MejaPage() {
  // Meja fisik per cabang — dari Kantor pilih cabang yang mejanya diatur.
  const { query: branchQuery, id: branchId } = useCabangData();
  const { auth } = useAuth();
  const peran = auth?.user.role;
  /** Master meja = owner/admin/kasir. Sama persis dengan gerbang server. */
  const bolehAtur = peran === "owner" || peran === "admin" || peran === "cashier";
  /** Membereskan meja = + tim (permintaan owner: "tim ataupun kasir"). */
  const bolehKosongkan = bolehAtur || peran === "tim";
  const queryClient = useQueryClient();
  const { data: meja, isLoading } = useQuery({
    queryKey: ["meja", branchQuery],
    queryFn: () => api<MejaDto[]>(`/meja${branchQuery}`),
  });
  const { data: statusList = [] } = useMejaStatus(branchQuery);
  const statusById = new Map(statusList.map((s) => [s.meja_id, s]));
  const [kosongkanId, setKosongkanId] = useState<string | null>(null);
  const kosongkanTarget = statusList.find((s) => s.meja_id === kosongkanId) ?? null;
  const jumlahIsi = statusList.filter((s) => s.status === "isi").length;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<FormState | null>(null);
  const [pos, setPos] = useState<Pos>({});
  const [dirty, setDirty] = useState(false);
  const editingRef = useRef(false);
  const dragId = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const editing = mode === "edit";

  // Seed posisi lokal dari server. Saat mode edit, gabungkan agar seretan yang
  // belum disimpan tidak terhapus ketika data di-refetch (mis. setelah tambah);
  // saat view selalu ikuti kebenaran server.
  useEffect(() => {
    if (!meja) return;
    if (editingRef.current) {
      setPos((prev) => {
        const next: Pos = {};
        for (const m of meja) next[m.id] = prev[m.id] ?? { x: m.pos_x, y: m.pos_y };
        return next;
      });
    } else {
      setPos(Object.fromEntries(meja.map((m) => [m.id, { x: m.pos_x, y: m.pos_y }])));
      setDirty(false);
    }
  }, [meja]);

  function masukEdit() {
    // penjaga keras, bukan cuma menyembunyikan tombol — supaya perubahan
    // tampilan di kemudian hari tak diam-diam membuka mode edit ke semua peran
    if (!bolehAtur) return;
    editingRef.current = true;
    setMode("edit");
  }

  function keluarKeView() {
    editingRef.current = false;
    setForm(null);
    setMode("view");
  }

  function batal() {
    // buang seretan yang belum disimpan, kembali ke kebenaran server
    if (meja) setPos(Object.fromEntries(meja.map((m) => [m.id, { x: m.pos_x, y: m.pos_y }])));
    setDirty(false);
    keluarKeView();
  }

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
      keluarKeView();
      queryClient.invalidateQueries({ queryKey: ["meja"] });
    },
  });

  function simpanSelesai() {
    if (dirty) simpanTataLetak.mutate();
    else keluarKeView();
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>, id: string) {
    if (!editing) return;
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
    <div className="max-w-5xl">
      <CabangDataBar />
      <PageTitle
        aksi={
          editing ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={batal} className={btnSecondary}>
                Batal
              </button>
              <button
                type="button"
                onClick={simpanSelesai}
                disabled={simpanTataLetak.isPending}
                className={btnPrimary}
              >
                {simpanTataLetak.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          ) : bolehAtur ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={masukEdit} className={btnSecondary}>
                ✏️ Atur Denah
              </button>
              <button
                type="button"
                onClick={() => {
                  masukEdit();
                  setForm({ nama: "", tipe: "dine_in" });
                }}
                className={btnPrimary}
              >
                + Tambah Meja
              </button>
            </div>
          ) : null
        }
      >
        Meja ({list.length}
        {jumlahIsi > 0 ? ` · ${jumlahIsi} terisi` : ""})
      </PageTitle>

      {editing ? (
        <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <b>Mode edit.</b> Tambah / ubah / hapus meja dan <b>seret</b> tiap meja di denah untuk
          menatanya. Tekan <b>Simpan</b> untuk menyimpan tata letak dan kembali ke tampilan.
        </div>
      ) : (
        <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
          <b className="text-red-700">Merah</b> = ada pesanan belum dibayar ·{" "}
          <b className="text-amber-700">Kuning</b> = sudah bayar tapi tamu masih duduk ·{" "}
          <b className="text-green-700">Hijau</b> = siap ditempati. Meja tetap terisi setelah
          dibayar — tekan <b>Kosongkan</b> saat tamunya benar-benar pergi. Meja{" "}
          <b>Ruang Tunggu</b> untuk bawa pulang, jadi tidak punya status.
        </div>
      )}

      <ErrorText error={toggle.error || hapus.error || simpanTataLetak.error} />

      {/* Desktop: denah (kiri) + daftar (kanan). Mobile: denah atas, daftar bawah. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {/* Denah — kiri */}
        <Card className="p-3 md:flex-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-stone-700">Denah Ruangan</span>
            {editing && dirty && (
              <span className="text-xs font-medium text-orange-600">Perubahan belum disimpan</span>
            )}
          </div>
          <div
            ref={canvasRef}
            className={`relative mt-1 aspect-[4/3] w-full touch-none overflow-hidden rounded-lg border border-dashed border-stone-300 bg-[linear-gradient(#f5f5f4_1px,transparent_1px),linear-gradient(90deg,#f5f5f4_1px,transparent_1px)] bg-[length:24px_24px] bg-stone-50`}
          >
            {list.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-stone-400">
                {editing ? 'Belum ada meja. Tekan "+ Tambah Meja".' : "Belum ada meja di cabang ini."}
              </div>
            )}
            {list.map((m) => {
              const p = pos[m.id] ?? { x: m.pos_x, y: m.pos_y };
              const takeaway = m.tipe === "takeaway";
              const st = statusById.get(m.id);
              // Saat menata denah, warna okupansi justru mengganggu — yang
              // dicari mata adalah posisi, bukan siapa yang sedang duduk.
              const warna =
                takeaway || editing
                  ? takeaway
                    ? "border-amber-400 bg-amber-100 text-amber-800"
                    : "border-blue-300 bg-blue-100 text-blue-800"
                  : kelasStatus(st);
              return (
                <div
                  key={m.id}
                  onPointerDown={(e) => onPointerDown(e, m.id)}
                  onPointerMove={(e) => onPointerMove(e, m.id)}
                  onPointerUp={(e) => onPointerUp(e, m.id)}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  className={`absolute flex max-w-[42%] -translate-x-1/2 -translate-y-1/2 touch-none select-none flex-col items-center justify-center rounded-lg border px-3 py-2 text-center text-xs font-semibold shadow-sm ${
                    editing ? "cursor-grab active:cursor-grabbing" : ""
                  } ${m.is_active || takeaway ? warna : "border-stone-300 bg-stone-100 text-stone-400"}`}
                >
                  <span>{takeaway ? `🥡 ${m.nama}` : m.nama}</span>
                  {!takeaway && !editing && st && st.status === "isi" && (
                    <span className="text-[10px] font-medium opacity-80">{labelStatus(st)}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-stone-400">
            {editing
              ? 'Tip: seret meja untuk memindahkan, lalu tekan "Simpan".'
              : "🟥 belum bayar · 🟨 sudah bayar, masih duduk · 🟩 siap ditempati · 🥡 ruang tunggu."}
          </div>
        </Card>

        {/* Daftar meja — kanan */}
        <Card className="md:w-80 md:shrink-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
            <span className="text-sm font-semibold text-stone-700">Daftar Meja</span>
            {editing && (
              <button
                type="button"
                onClick={() => setForm({ nama: "", tipe: "dine_in" })}
                className="text-sm font-medium text-orange-600 hover:underline"
              >
                + Tambah
              </button>
            )}
          </div>
          <div className="divide-y divide-stone-100">
            {list.length === 0 && (
              <div className="p-6 text-center text-sm text-stone-400">
                Belum ada meja di cabang ini.
              </div>
            )}
            {list.map((m) => {
              const st = statusById.get(m.id);
              return (
              <div key={m.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-stone-800">{m.nama}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.tipe === "takeaway"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {m.tipe === "takeaway" ? "Take away" : "Dine-in"}
                    </span>
                    {!m.is_active && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                        Nonaktif
                      </span>
                    )}
                    {st && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${kelasStatus(st)}`}
                      >
                        {labelStatus(st)}
                      </span>
                    )}
                  </div>
                  {st?.dikosongkan_pada && st.status === "kosong" && (
                    <div className="mt-0.5 text-xs text-stone-400">
                      Dibereskan {formatWaktu(st.dikosongkan_pada)}
                      {st.dikosongkan_oleh ? ` oleh ${st.dikosongkan_oleh}` : ""}
                    </div>
                  )}
                </div>
                {!editing && st?.status === "isi" && bolehKosongkan && (
                  <button
                    type="button"
                    onClick={() => setKosongkanId(m.id)}
                    className="shrink-0 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                  >
                    ✓ Kosongkan
                  </button>
                )}
                {editing && (
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setForm({ id: m.id, nama: m.nama, tipe: m.tipe })}
                      className="font-medium text-orange-600 hover:underline"
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle.mutate(m)}
                      className="font-medium text-stone-500 hover:underline"
                    >
                      {m.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    {m.tipe !== "takeaway" && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Hapus meja "${m.nama}"?`)) hapus.mutate(m);
                        }}
                        className="font-medium text-red-600 hover:underline"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </Card>
      </div>

      {kosongkanTarget && (
        <KosongkanMejaModal
          meja={kosongkanTarget}
          branchQuery={branchQuery}
          onClose={() => setKosongkanId(null)}
        />
      )}

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
