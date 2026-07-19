import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  BelanjaPerlengkapanDto,
  KirimanPerlengkapanDto,
  OpnamePerlengkapanDetail,
  OpnamePerlengkapanSesiRow,
  PerlengkapanRowDto,
} from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { CabangDataBar } from "../../components/CabangDataBar";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatWaktu } from "../../lib/format";
import { KartuPerlengkapanModal } from "./KartuPerlengkapanModal";

/** Label aturan konsumsi: "1 sachet / hari", "2 pcs / 3 hari", "nonaktif". */
function labelAturan(r: PerlengkapanRowDto): string | null {
  if (!r.aturan) return null;
  const per = r.aturan.per_hari === 1 ? "hari" : `${r.aturan.per_hari} hari`;
  const teks = `${formatAngka(r.aturan.qty)} ${r.satuan} / ${per}`;
  return r.aturan.aktif ? teks : `${teks} (nonaktif)`;
}

type ModalState =
  | { jenis: "item"; item: PerlengkapanRowDto | null }
  | { jenis: "masuk" | "pakai" | "koreksi" | "aturan" | "kartu" | "minta"; item: PerlengkapanRowDto }
  | { jenis: "opname" }
  | { jenis: "riwayat-opname" }
  | null;

/**
 * Perlengkapan non bahan baku (sendok, spons, sabun): modul mandiri di luar
 * Bahan Baku — tidak menyentuh resep/HPP. Stok per cabang; pemakaian dicatat
 * manual (semua peran) atau otomatis lewat aturan harian (owner/admin).
 */
export function PerlengkapanPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { id: dataId, query: branchQuery } = useCabangData();
  const isManajemen = auth?.user.role === "owner" || auth?.user.role === "admin";

  const { data: rows, isLoading } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
  });
  const { data: belanja } = useQuery({
    queryKey: ["perlengkapan-belanja", branchQuery],
    queryFn: () => api<BelanjaPerlengkapanDto>(`/perlengkapan/belanja${branchQuery}`),
    enabled: isManajemen,
  });
  const { data: kiriman = [] } = useQuery({
    queryKey: ["perlengkapan-kiriman", branchQuery],
    queryFn: () => api<KirimanPerlengkapanDto[]>(`/perlengkapan/kiriman${branchQuery}`),
  });
  // kiriman MASUK yang menunggu diterima cabang ini (stok belum pindah)
  const kirimanMasuk = kiriman.filter((k) => k.status === "dikirim");

  const [modal, setModal] = useState<ModalState>(null);
  const [cari, setCari] = useState("");

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-belanja"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-kiriman"] });
    queryClient.invalidateQueries({ queryKey: ["perlengkapan-opname"] });
    queryClient.invalidateQueries({ queryKey: ["kartu-perlengkapan"] });
  };

  const hapus = useMutation({
    mutationFn: (id: string) => api(`/perlengkapan/${id}`, { method: "DELETE" }),
    onSuccess: segarkan,
  });
  const terima = useMutation({
    mutationFn: (id: string) =>
      api(`/perlengkapan/kiriman/${id}/terima${branchQuery}`, { method: "POST" }),
    onSuccess: segarkan,
  });

  const tampil = (rows ?? []).filter((r) =>
    r.nama.toLowerCase().includes(cari.toLowerCase()),
  );

  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          isManajemen ? (
            <button onClick={() => setModal({ jenis: "item", item: null })} className={btnPrimary}>
              ➕ Tambah Perlengkapan
            </button>
          ) : undefined
        }
      >
        🧰 Perlengkapan
      </PageTitle>
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Barang <b>non bahan baku</b> (sendok, spons, sabun…) — di luar resep & HPP. Pemakaian
        dicatat lewat <b>📋 Opname</b> (selisih di-ACC owner/admin), tombol <b>Pakai</b>, atau
        otomatis lewat <b>Aturan</b>. Stok ≤ minimum: di CK <b>beli lagi</b>; di cabang{" "}
        <b>minta ke CK</b> bila stok CK ada.
      </div>
      <CabangDataBar />
      <ErrorText error={hapus.error} />

      {/* Kiriman CK → cabang yang MENUNGGU diterima (stok belum pindah) */}
      {kirimanMasuk.length > 0 && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50 px-4 py-3">
          <div className="mb-2 text-sm font-semibold text-blue-900">
            🚚 Kiriman perlengkapan menunggu ({kirimanMasuk.length})
          </div>
          <div className="space-y-1.5">
            {kirimanMasuk.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-2 text-sm">
                {k.nomor && (
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {k.nomor}
                  </span>
                )}
                <span className="text-stone-700">
                  {k.item.nama} · <b>{formatAngka(k.qty)} {k.item.satuan}</b>
                </span>
                <span className="text-xs text-stone-500">
                  {k.dari_cabang} → {k.ke_cabang}
                </span>
                {dataId === k.ke_branch_id ? (
                  <button
                    onClick={() => terima.mutate(k.id)}
                    disabled={terima.isPending}
                    className="ml-auto rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    ✔ Terima
                  </button>
                ) : (
                  <span className="ml-auto text-xs text-stone-400">menunggu diterima cabang</span>
                )}
              </div>
            ))}
          </div>
          <ErrorText error={terima.error} />
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari perlengkapan…"
          className={`${inputClass} max-w-xs`}
        />
        <button onClick={() => setModal({ jenis: "opname" })} className={btnSecondary}>
          📋 Opname
        </button>
        <button onClick={() => setModal({ jenis: "riwayat-opname" })} className={btnSecondary}>
          🗂 Riwayat Opname
        </button>
        {isManajemen && belanja && (
          <div className="ml-auto rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-700">
            🛒 Belanja bulan ini: <b>{formatRupiah(belanja.total)}</b>
          </div>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : tampil.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          {cari
            ? "Tidak ada perlengkapan yang cocok."
            : "Belum ada perlengkapan. Tambahkan lewat “➕ Tambah Perlengkapan”."}
        </Card>
      ) : (
        <div className="space-y-2">
          {tampil.map((r) => (
            <Card key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-stone-800">{r.nama}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
                    {labelAturan(r) && <span>⏱ {labelAturan(r)}</span>}
                    {r.stok_minimum > 0 && (
                      <span>min {formatAngka(r.stok_minimum)} {r.satuan}</span>
                    )}
                    {r.catatan && <span>· {r.catatan}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-stone-800">
                    {formatAngka(r.saldo)}{" "}
                    <span className="text-sm font-normal text-stone-500">{r.satuan}</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-100 pt-2">
                <button
                  onClick={() => setModal({ jenis: "pakai", item: r })}
                  className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700"
                >
                  ✂️ Pakai
                </button>
                {isManajemen && (
                  <>
                    <button
                      onClick={() => setModal({ jenis: "masuk", item: r })}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      📦 Stok Masuk
                    </button>
                    <button
                      onClick={() => setModal({ jenis: "aturan", item: r })}
                      className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      ⏱ Aturan
                    </button>
                    <button
                      onClick={() => setModal({ jenis: "koreksi", item: r })}
                      className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      🧮 Koreksi Fisik
                    </button>
                  </>
                )}
                {/* stok ≤ minimum: di cabang → minta ke CK bila CK punya stok;
                    di CK sendiri → beli lagi lewat Stok Masuk */}
                {r.saldo_ck != null && r.saldo_ck > 0 && (
                  <button
                    onClick={() => setModal({ jenis: "minta", item: r })}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                      r.status !== "aman"
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    📥 Minta ke CK
                  </button>
                )}
                {r.status !== "aman" && r.saldo_ck != null && r.saldo_ck <= 0 && (
                  <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                    ⚠ stok CK kosong — beli di CK dulu
                  </span>
                )}
                {r.status !== "aman" && r.saldo_ck == null && (
                  <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                    🛒 ≤ minimum — beli lagi (Stok Masuk)
                  </span>
                )}
                <button
                  onClick={() => setModal({ jenis: "kartu", item: r })}
                  className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                >
                  📒 Kartu
                </button>
                {isManajemen && (
                  <span className="ml-auto flex gap-1.5">
                    <button
                      onClick={() => setModal({ jenis: "item", item: r })}
                      className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      ✏️ Ubah
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Hapus perlengkapan "${r.nama}"? Riwayatnya tetap tersimpan.`))
                          hapus.mutate(r.id);
                      }}
                      className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      🗑
                    </button>
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal?.jenis === "item" && (
        <ItemModal item={modal.item} onClose={() => setModal(null)} onSukses={segarkan} />
      )}
      {modal?.jenis === "pakai" && (
        <PakaiModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "masuk" && (
        <MasukModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "koreksi" && (
        <KoreksiModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "aturan" && (
        <AturanModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "kartu" && (
        <KartuPerlengkapanModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.jenis === "minta" && (
        <MintaModal
          item={modal.item}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "opname" && (
        <OpnameModal
          rows={rows ?? []}
          branchQuery={branchQuery}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
      {modal?.jenis === "riwayat-opname" && (
        <RiwayatOpnameModal
          branchQuery={branchQuery}
          isManajemen={isManajemen}
          onClose={() => setModal(null)}
          onSukses={segarkan}
        />
      )}
    </div>
  );
}

/** Cabang minta stok ke Central Kitchen — faktur kiriman KP-, terima dulu di cabang. */
function MintaModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  // saran: cukupi sampai stok minimum (minimal 1)
  const saran = Math.max(1, Math.ceil(item.stok_minimum - item.saldo));
  const [qty, setQty] = useState(String(Math.min(saran, item.saldo_ck ?? saran)));
  const [catatan, setCatatan] = useState("");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/minta${branchQuery}`, {
        method: "POST",
        body: { qty: Number(qty), catatan: catatan.trim() || null },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Minta ke CK — ${item.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Stok cabang: <b>{formatAngka(item.saldo)} {item.satuan}</b>
          {item.stok_minimum > 0 && <> · minimum {formatAngka(item.stok_minimum)}</>}
          <br />
          Stok Central Kitchen: <b>{formatAngka(item.saldo_ck ?? 0)} {item.satuan}</b>
        </div>
        <label className="block text-sm">
          Jumlah diminta ({item.satuan})
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <div className="text-xs text-stone-500">
          Faktur kiriman terbit dari stok CK — stok pindah setelah cabang menekan <b>Terima</b>.
        </div>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            📥 Minta Kiriman
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Stock opname perlengkapan: hitung fisik semua item → selisih menunggu ACC. */
function OpnameModal({
  rows,
  branchQuery,
  onClose,
  onSukses,
}: {
  rows: PerlengkapanRowDto[];
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [fisik, setFisik] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState("");
  const [hasil, setHasil] = useState<string | null>(null);
  const items = rows
    .filter((r) => fisik[r.id] !== undefined && fisik[r.id] !== "")
    .map((r) => ({ supply_id: r.id, qty_fisik: Number(fisik[r.id]) }));
  const kirim = useMutation({
    mutationFn: () =>
      api<{ session_id: string | null; nomor: string | null; jumlah_selisih: number }>(
        `/perlengkapan/opname${branchQuery}`,
        { method: "POST", body: { items, catatan: catatan.trim() || null } },
      ),
    onSuccess: (d) => {
      onSukses();
      setHasil(
        d.jumlah_selisih === 0
          ? "Semua sesuai sistem — tidak ada selisih."
          : `Sesi ${d.nomor} tersimpan: ${d.jumlah_selisih} selisih menunggu ACC owner/admin.`,
      );
    },
  });
  return (
    <Modal open onClose={onClose} title="📋 Stock Opname Perlengkapan" lebar="max-w-2xl">
      {hasil ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{hasil}</div>
          <div className="flex justify-end">
            <button onClick={onClose} className={btnPrimary}>Tutup</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Isi jumlah <b>fisik</b> hasil hitung (kosongkan yang tidak dihitung). Selisih
            TIDAK langsung mengubah stok — menunggu <b>ACC owner/admin</b> di Riwayat Opname.
          </div>
          <div className="max-h-[45vh] overflow-y-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className={thClass}>Perlengkapan</th>
                  <th className={`${thClass} text-right`}>Sistem</th>
                  <th className={`${thClass} w-32`}>Fisik</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-stone-100">
                    <td className={tdClass}>
                      {r.nama} <span className="text-xs text-stone-400">({r.satuan})</span>
                    </td>
                    <td className={`${tdClass} text-right`}>{formatAngka(r.saldo)}</td>
                    <td className={tdClass}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={fisik[r.id] ?? ""}
                        onChange={(e) => setFisik((p) => ({ ...p, [r.id]: e.target.value }))}
                        className={inputClass}
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block text-sm">
            Catatan (opsional)
            <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
          </label>
          <ErrorText error={kirim.error} />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={btnSecondary}>Batal</button>
            <button
              onClick={() => kirim.mutate()}
              disabled={items.length === 0 || kirim.isPending}
              className={btnPrimary}
            >
              📋 Simpan Opname ({items.length} item)
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const STATUS_SESI: Record<string, { label: string; cls: string }> = {
  menunggu: { label: "⏳ Menunggu ACC", cls: "bg-amber-100 text-amber-800" },
  disetujui: { label: "✔ Disetujui", cls: "bg-green-100 text-green-700" },
  ditolak: { label: "✖ Ditolak", cls: "bg-red-100 text-red-700" },
};

/** Riwayat sesi opname perlengkapan + ACC/Tolak/Hapus (owner/admin). */
function RiwayatOpnameModal({
  branchQuery,
  isManajemen,
  onClose,
  onSukses,
}: {
  branchQuery: string;
  isManajemen: boolean;
  onClose: () => void;
  onSukses: () => void;
}) {
  const queryClient = useQueryClient();
  const [buka, setBuka] = useState<string | null>(null);
  const { data: sesi = [], isLoading } = useQuery({
    queryKey: ["perlengkapan-opname", branchQuery],
    queryFn: () => api<OpnamePerlengkapanSesiRow[]>(`/perlengkapan/opname/riwayat${branchQuery}`),
  });
  const { data: detail } = useQuery({
    queryKey: ["perlengkapan-opname", "sesi", buka],
    queryFn: () => api<OpnamePerlengkapanDetail>(`/perlengkapan/opname/sesi/${buka}`),
    enabled: buka != null,
  });
  const aksi = useMutation({
    mutationFn: ({ id, jenis }: { id: string; jenis: "acc" | "tolak" | "hapus" }) =>
      jenis === "hapus"
        ? api(`/perlengkapan/opname/sesi/${id}`, { method: "DELETE" })
        : api(`/perlengkapan/opname/sesi/${id}/${jenis}`, { method: "POST" }),
    onSuccess: () => {
      onSukses();
      queryClient.invalidateQueries({ queryKey: ["perlengkapan-opname"] });
      setBuka(null);
    },
  });
  return (
    <Modal open onClose={onClose} title="🗂 Riwayat Opname Perlengkapan" lebar="max-w-2xl">
      <ErrorText error={aksi.error} />
      {isLoading ? (
        <Spinner />
      ) : sesi.length === 0 ? (
        <div className="py-8 text-center text-sm text-stone-400">Belum ada sesi opname.</div>
      ) : (
        <div className="space-y-2">
          {sesi.map((s) => (
            <div key={s.session_id} className="rounded-lg border border-stone-200">
              <button
                onClick={() => setBuka(buka === s.session_id ? null : s.session_id)}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"
              >
                {s.nomor && (
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                    {s.nomor}
                  </span>
                )}
                <span className="text-stone-600">{formatWaktu(s.waktu)}</span>
                <span className="text-xs text-stone-500">
                  {s.jumlah_item} selisih{s.oleh ? ` · ${s.oleh}` : ""}
                </span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_SESI[s.status]?.cls ?? ""}`}
                >
                  {STATUS_SESI[s.status]?.label ?? s.status}
                </span>
              </button>
              {buka === s.session_id && detail && (
                <div className="border-t border-stone-100 px-3 py-2">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-stone-200">
                        <th className={thClass}>Item</th>
                        <th className={`${thClass} text-right`}>Sistem</th>
                        <th className={`${thClass} text-right`}>Fisik</th>
                        <th className={`${thClass} text-right`}>Selisih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.rows.map((r) => (
                        <tr key={r.supply_id} className="border-b border-stone-100">
                          <td className={tdClass}>{r.nama}</td>
                          <td className={`${tdClass} text-right`}>
                            {r.system_qty != null ? formatAngka(r.system_qty) : "—"}
                          </td>
                          <td className={`${tdClass} text-right`}>
                            {r.qty_fisik != null ? formatAngka(r.qty_fisik) : "—"}
                          </td>
                          <td
                            className={`${tdClass} text-right font-semibold ${r.selisih < 0 ? "text-red-700" : "text-emerald-700"}`}
                          >
                            {r.selisih > 0 ? "+" : ""}
                            {formatAngka(r.selisih)} {r.satuan}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {isManajemen && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      {s.status === "menunggu" && (
                        <>
                          <button
                            onClick={() => aksi.mutate({ id: s.session_id, jenis: "acc" })}
                            disabled={aksi.isPending}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            ✔ ACC (stok berubah)
                          </button>
                          <button
                            onClick={() => aksi.mutate({ id: s.session_id, jenis: "tolak" })}
                            disabled={aksi.isPending}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            ✖ Tolak
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => {
                          if (confirm("Hapus sesi opname ini? Selisih yang sudah disetujui ikut dibatalkan."))
                            aksi.mutate({ id: s.session_id, jenis: "hapus" });
                        }}
                        disabled={aksi.isPending}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                      >
                        🗑 Hapus
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ItemModal({
  item,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto | null;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [nama, setNama] = useState(item?.nama ?? "");
  const [satuan, setSatuan] = useState(item?.satuan ?? "pcs");
  const [hargaBeli, setHargaBeli] = useState(item ? String(item.harga_beli) : "");
  const [stokMin, setStokMin] = useState(item ? String(item.stok_minimum) : "");
  const [catatan, setCatatan] = useState(item?.catatan ?? "");
  const simpan = useMutation({
    mutationFn: () =>
      api(item ? `/perlengkapan/${item.id}` : "/perlengkapan", {
        method: item ? "PATCH" : "POST",
        body: {
          nama: nama.trim(),
          satuan: satuan.trim() || "pcs",
          harga_beli: Number(hargaBeli) || 0,
          stok_minimum: Number(stokMin) || 0,
          catatan: catatan.trim() || null,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={item ? `Ubah ${item.nama}` : "Tambah Perlengkapan"}>
      <div className="space-y-3">
        <label className="block text-sm">
          Nama
          <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputClass} placeholder="mis. Sabun cuci piring" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Satuan
            <input value={satuan} onChange={(e) => setSatuan(e.target.value)} className={inputClass} placeholder="pcs / sachet / botol" />
          </label>
          <label className="block text-sm">
            Harga beli / satuan (Rp)
            <input type="number" min={0} value={hargaBeli} onChange={(e) => setHargaBeli(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block text-sm">
          Stok minimum (peringatan menipis)
          <input type="number" min={0} value={stokMin} onChange={(e) => setStokMin(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm">
          Catatan
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => simpan.mutate()}
            disabled={!nama.trim() || simpan.isPending}
            className={btnPrimary}
          >
            Simpan
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PakaiModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState("1");
  const [catatan, setCatatan] = useState("");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/pakai${branchQuery}`, {
        method: "POST",
        body: { qty: Number(qty), catatan: catatan.trim() || null },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Catat Pemakaian — ${item.nama}`}>
      <div className="space-y-3">
        <div className="text-sm text-stone-500">
          Saldo saat ini: <b>{formatAngka(item.saldo)} {item.satuan}</b>
        </div>
        <label className="block text-sm">
          Jumlah dipakai ({item.satuan})
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} placeholder="mis. cuci peralatan dapur" />
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            ✂️ Catat Pakai
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MasukModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState("");
  const [totalHarga, setTotalHarga] = useState("");
  const [catatan, setCatatan] = useState("");
  // harga default = qty × harga beli item (bisa ditimpa manual)
  const perkiraan = Number(qty) > 0 && item.harga_beli > 0 ? Number(qty) * item.harga_beli : null;
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/masuk${branchQuery}`, {
        method: "POST",
        body: {
          qty: Number(qty),
          total_harga: totalHarga !== "" ? Number(totalHarga) : perkiraan,
          catatan: catatan.trim() || null,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Stok Masuk — ${item.nama}`}>
      <div className="space-y-3">
        <label className="block text-sm">
          Jumlah masuk ({item.satuan})
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="block text-sm">
          Total harga (Rp{perkiraan != null ? ` — perkiraan ${formatRupiah(perkiraan)}` : ", opsional"})
          <input
            type="number"
            min={0}
            value={totalHarga}
            onChange={(e) => setTotalHarga(e.target.value)}
            className={inputClass}
            placeholder={perkiraan != null ? String(perkiraan) : "0"}
          />
        </label>
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} placeholder="mis. beli di toko grosir" />
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            📦 Simpan
          </button>
        </div>
      </div>
    </Modal>
  );
}

function KoreksiModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [fisik, setFisik] = useState("");
  const [catatan, setCatatan] = useState("");
  const selisih = fisik === "" ? null : Number(fisik) - item.saldo;
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/koreksi${branchQuery}`, {
        method: "POST",
        body: { qty_fisik: Number(fisik), catatan: catatan.trim() || null },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Koreksi Fisik — ${item.nama}`}>
      <div className="space-y-3">
        <div className="text-sm text-stone-500">
          Saldo sistem: <b>{formatAngka(item.saldo)} {item.satuan}</b>
        </div>
        <label className="block text-sm">
          Jumlah fisik hasil hitung ({item.satuan})
          <input type="number" min={0} step="any" value={fisik} onChange={(e) => setFisik(e.target.value)} className={inputClass} autoFocus />
        </label>
        {selisih != null && selisih !== 0 && (
          <div className={`rounded-lg px-3 py-2 text-sm ${selisih < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            Selisih {selisih > 0 ? "+" : ""}{formatAngka(selisih)} {item.satuan} akan dicatat sebagai koreksi.
          </div>
        )}
        <label className="block text-sm">
          Catatan (opsional)
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={fisik === "" || Number(fisik) < 0 || kirim.isPending}
            className={btnPrimary}
          >
            🧮 Simpan Koreksi
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AturanModal({
  item,
  branchQuery,
  onClose,
  onSukses,
}: {
  item: PerlengkapanRowDto;
  branchQuery: string;
  onClose: () => void;
  onSukses: () => void;
}) {
  const [qty, setQty] = useState(item.aturan ? String(item.aturan.qty) : "1");
  const [perHari, setPerHari] = useState(item.aturan ? String(item.aturan.per_hari) : "1");
  const [aktif, setAktif] = useState(item.aturan?.aktif ?? true);
  const [mulai, setMulai] = useState(item.aturan?.mulai ?? "");
  const kirim = useMutation({
    mutationFn: () =>
      api(`/perlengkapan/${item.id}/aturan${branchQuery}`, {
        method: "PUT",
        body: {
          qty: Number(qty),
          per_hari: Number(perHari) || 1,
          aktif,
          mulai: mulai || undefined,
        },
      }),
    onSuccess: () => {
      onSukses();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Aturan Konsumsi — ${item.nama}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          Stok berkurang <b>otomatis</b> sesuai aturan — mis. sabun <b>1 sachet / hari</b> atau
          spons <b>1 pcs / 7 hari</b>. Berlaku untuk cabang yang sedang dipilih.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Jumlah terpakai ({item.satuan})
            <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm">
            Setiap … hari
            <input type="number" min={1} max={365} value={perHari} onChange={(e) => setPerHari(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block text-sm">
          Mulai berlaku (kosong = hari ini)
          <input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
          Aturan aktif
        </label>
        <ErrorText error={kirim.error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Batal</button>
          <button
            onClick={() => kirim.mutate()}
            disabled={!(Number(qty) > 0) || kirim.isPending}
            className={btnPrimary}
          >
            ⏱ Simpan Aturan
          </button>
        </div>
      </div>
    </Modal>
  );
}
