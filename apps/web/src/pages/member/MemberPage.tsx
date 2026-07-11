import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { CustomerDetail, CustomerDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

export function MemberPage() {
  const qc = useQueryClient();
  const { data: members, isLoading } = useQuery({
    queryKey: ["customer"],
    queryFn: () => api<CustomerDto[]>("/customer"),
  });

  const [cari, setCari] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [nama, setNama] = useState("");
  const [wa, setWa] = useState("");
  const [catatan, setCatatan] = useState("");

  function bukaTambah() {
    setEditId(null);
    setNama("");
    setWa("");
    setCatatan("");
    setFormOpen(true);
  }
  function bukaEdit(m: { id: string; nama: string; wa: string; catatan: string | null }) {
    setEditId(m.id);
    setNama(m.nama);
    setWa(m.wa);
    setCatatan(m.catatan ?? "");
    setDetailId(null);
    setFormOpen(true);
  }

  const simpan = useMutation({
    mutationFn: () =>
      api(editId ? `/customer/${editId}` : "/customer", {
        method: editId ? "PUT" : "POST",
        body: { nama, wa, catatan: catatan || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer"] });
      setFormOpen(false);
    },
  });

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/customer/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer"] });
      setDetailId(null);
    },
  });

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const list = members ?? [];
    if (!q) return list;
    return list.filter(
      (m) => m.nama.toLowerCase().includes(q) || m.wa.includes(q.replace(/\D/g, "")),
    );
  }, [members, cari]);

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <PageTitle>Member ({members?.length ?? 0})</PageTitle>
        <button onClick={bukaTambah} className={btnPrimary}>
          + Tambah Member
        </button>
      </div>

      <input
        value={cari}
        onChange={(e) => setCari(e.target.value)}
        placeholder="🔍 Cari nama / nomor WA…"
        className="mb-3 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
      />

      {tampil.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {cari ? `Member "${cari}" tidak ditemukan.` : "Belum ada member. Member otomatis dibuat saat kasir mengisi No. WhatsApp konsumen."}
        </Card>
      ) : (
        <div className="space-y-2">
          {tampil.map((m) => (
            <button
              key={m.id}
              onClick={() => setDetailId(m.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-orange-400 hover:shadow"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold text-stone-800">{m.nama}</div>
                <div className="text-xs text-stone-500">📱 {m.wa}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-bold text-orange-600">{formatRupiah(m.total_belanja)}</div>
                <div className="text-xs text-stone-500">
                  {m.jumlah_transaksi}× ·{" "}
                  {m.terakhir ? formatTanggalRingkas(m.terakhir) : "belum ada"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal detail member */}
      {detailId && (
        <MemberDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={bukaEdit}
          onHapus={(id) => {
            if (confirm("Hapus member ini? Transaksi lamanya tetap tersimpan (tanpa link member).")) {
              hapus.mutate(id);
            }
          }}
          hapusPending={hapus.isPending}
        />
      )}

      {/* Modal form tambah/edit */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-stone-800">
              {editId ? "Ubah Member" : "Tambah Member"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                simpan.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <label className="mb-1 block text-sm font-medium">Nama</label>
                <input required value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Nomor WhatsApp</label>
                <input
                  required
                  value={wa}
                  onChange={(e) => setWa(e.target.value)}
                  inputMode="tel"
                  placeholder="mis. 08123456789"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Catatan <span className="font-normal text-stone-400">(opsional)</span>
                </label>
                <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
              </div>
              <ErrorText error={simpan.error} />
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setFormOpen(false)} className={`${btnSecondary} flex-1`}>
                  Batal
                </button>
                <button type="submit" disabled={simpan.isPending} className={`${btnPrimary} flex-1`}>
                  {simpan.isPending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberDetailModal({
  id,
  onClose,
  onEdit,
  onHapus,
  hapusPending,
}: {
  id: string;
  onClose: () => void;
  onEdit: (m: { id: string; nama: string; wa: string; catatan: string | null }) => void;
  onHapus: (id: string) => void;
  hapusPending: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<CustomerDetail>(`/customer/${id}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-stone-800">{data.nama}</h2>
                <div className="text-sm text-stone-500">📱 {data.wa}</div>
                {data.catatan && <div className="mt-1 text-xs text-stone-500">{data.catatan}</div>}
              </div>
              <button onClick={onClose} className="text-stone-400 hover:text-stone-700" aria-label="Tutup">
                ✕
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-stone-50 p-3">
                <div className="text-xs text-stone-500">Total belanja</div>
                <div className="font-bold text-orange-600">{formatRupiah(data.total_belanja)}</div>
              </div>
              <div className="rounded-lg bg-stone-50 p-3">
                <div className="text-xs text-stone-500">Jumlah transaksi</div>
                <div className="font-bold text-stone-800">{data.jumlah_transaksi}×</div>
              </div>
            </div>

            <div className="mb-2 text-sm font-semibold text-stone-700">Riwayat transaksi</div>
            {data.transaksi.length === 0 ? (
              <div className="rounded-lg bg-stone-50 p-4 text-center text-sm text-stone-400">
                Belum ada transaksi.
              </div>
            ) : (
              <div className="space-y-1.5">
                {data.transaksi.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-semibold text-stone-700">
                        {t.nomor}
                      </div>
                      <div className="text-xs text-stone-500">
                        {formatTanggalRingkas(t.waktu)} · {formatWaktu(t.waktu)} · {t.cabang}
                      </div>
                    </div>
                    <div className="shrink-0 font-bold text-stone-800">{formatRupiah(t.total)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => onHapus(data.id)}
                disabled={hapusPending}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                🗑 Hapus
              </button>
              <button
                onClick={() => onEdit({ id: data.id, nama: data.nama, wa: data.wa, catatan: data.catatan })}
                className={`${btnSecondary} flex-1`}
              >
                ✏ Ubah
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
