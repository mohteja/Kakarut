import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import type { TransferStokFaktur, TransferStokSaldoRow } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  inputClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggalRingkas, formatWaktu } from "../../lib/format";

/** Satu baris bahan pada form transfer (qty sebagai teks agar input bebas). */
interface BarisTransfer {
  ingredient_id: string;
  qty: string;
}

/** Badge JENIS bahan — pembeda tegas bahan dibeli vs diproduksi sendiri. */
function BadgeJenis({ pengadaan }: { pengadaan: "beli" | "produksi" }) {
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold ${
        pengadaan === "produksi"
          ? "bg-orange-100 text-orange-800"
          : "bg-sky-100 text-sky-800"
      }`}
    >
      {pengadaan === "produksi" ? "🏭 Produksi" : "🛒 Beli"}
    </span>
  );
}

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  menunggu: { label: "🚚 Dalam perjalanan", cls: "bg-yellow-100 text-yellow-800" },
  dikonfirmasi: { label: "✅ Diterima", cls: "bg-green-100 text-green-800" },
  ditolak: { label: "❌ Ditolak", cls: "bg-red-100 text-red-700" },
  sebagian: { label: "📦 Diterima sebagian", cls: "bg-green-100 text-green-800" },
  rencana: { label: "📋 Draf", cls: "bg-stone-100 text-stone-600" },
  dikerjakan: { label: "🔨 Diproses", cls: "bg-blue-100 text-blue-800" },
};

/**
 * TRANSFER STOK: memindahkan stok yang SUDAH ADA (ready) antar lokasi —
 * CK↔cabang atau cabang↔cabang — dalam satu faktur multi bahan (nomor TF-).
 * Dipakai mis. saat barang kiriman rusak di jalan dan perlu dikirim ulang.
 * BERDAMPINGAN dengan "Kirim dari stok CK" pada Permintaan Stok (jalur rencana
 * menu); yang ini manual/ad-hoc.
 */
export function TransferStokPage() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const { cabang } = useBranch();
  const role = auth?.user.role;
  const terkunci = role === "tim" || role === "kitchen" || role === "bar";
  const lokasiStok = cabang.filter((b) => b.is_active && b.tipe !== "kantor");

  // Cabang ASAL: peran terkunci dipaksa ke cabangnya; manajemen memilih —
  // default Central Kitchen (sumber transfer paling umum).
  const asalDefault =
    (terkunci ? auth?.user.branch_id : null) ??
    lokasiStok.find((b) => b.tipe === "central_kitchen")?.id ??
    lokasiStok[0]?.id ??
    "";
  const [asalId, setAsalId] = useState(asalDefault);
  const [tujuanId, setTujuanId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [baris, setBaris] = useState<BarisTransfer[]>([{ ingredient_id: "", qty: "" }]);

  // Stok READY di cabang asal — sumber pilihan bahan, satuan, dan batas qty.
  const { data: saldoData, isLoading: saldoLoading } = useQuery({
    queryKey: ["transfer-saldo", asalId],
    enabled: !!asalId,
    queryFn: () =>
      api<{ branch_id: string; rows: TransferStokSaldoRow[] }>(
        `/transfer-stok/saldo?branch_id=${asalId}`,
      ),
  });
  const saldoRows = saldoData?.rows ?? [];
  const saldoById = useMemo(
    () => new Map(saldoRows.map((r) => [r.ingredient_id, r])),
    [saldoRows],
  );
  /**
   * Batas transfer = stok fisik DIKURANGI barang yang sudah dikirim tapi belum
   * diterima tujuan. Tanpa potongan ini stok yang sama bisa dijanjikan
   * berkali-kali dan saldo asal jadi minus saat semua kiriman diterima.
   */
  const tersediaDari = (r: TransferStokSaldoRow) => r.saldo - r.dalam_jalan;
  const bahanBeli = saldoRows.filter((r) => r.pengadaan === "beli");
  const bahanProduksi = saldoRows.filter((r) => r.pengadaan === "produksi");

  const { data: riwayat, isLoading: riwayatLoading } = useQuery({
    queryKey: ["transfer-stok"],
    queryFn: () => api<{ rows: TransferStokFaktur[] }>("/transfer-stok"),
  });

  const kirim = useMutation({
    mutationFn: () =>
      api<{ ok: true; nomor: string; jumlah_baris: number }>("/transfer-stok", {
        method: "POST",
        body: {
          asal_branch_id: asalId,
          tujuan_branch_id: tujuanId,
          catatan: catatan.trim() || null,
          items: baris
            .filter((b) => b.ingredient_id && Number(b.qty) > 0)
            .map((b) => ({ ingredient_id: b.ingredient_id, qty: Number(b.qty) })),
        },
      }),
    onSuccess: () => {
      setBaris([{ ingredient_id: "", qty: "" }]);
      setCatatan("");
      queryClient.invalidateQueries({ queryKey: ["transfer-stok"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-saldo"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["penerimaan"] });
      queryClient.invalidateQueries({ queryKey: ["produksi-nav"] });
    },
  });

  const batal = useMutation({
    mutationFn: (fakturId: string) =>
      api(`/transfer-stok/${fakturId}/batal`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-stok"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-saldo"] });
      queryClient.invalidateQueries({ queryKey: ["penerimaan"] });
    },
  });

  const barisTerisi = baris.filter((b) => b.ingredient_id && Number(b.qty) > 0);
  const adaQtyLebih = baris.some((b) => {
    const s = saldoById.get(b.ingredient_id);
    return s != null && Number(b.qty) > tersediaDari(s) + 1e-9;
  });
  const bisaKirim =
    !!asalId && !!tujuanId && asalId !== tujuanId && barisTerisi.length > 0 && !adaQtyLebih;

  const namaCabang = (id: string) => cabang.find((b) => b.id === id)?.nama ?? "—";

  return (
    <div>
      <PageTitle>🔄 Transfer Stok</PageTitle>
      <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Memindahkan <b>stok yang sudah ada</b> antar lokasi — dari <b>Central Kitchen atau
        cabang</b> ke <b>CK atau cabang lain</b>. Dipakai mis. saat barang kiriman{" "}
        <b>rusak di jalan</b> lalu perlu dikirim ulang. Kiriman muncul di{" "}
        <b>📥 Penerimaan Barang</b> cabang tujuan; <b>stok asal berkurang saat kiriman
        diterima</b>. Terpisah dari <b>🚚 Kirim dari stok CK</b> pada Permintaan Stok (jalur
        rencana menu) — keduanya tetap bisa dipakai.
      </div>

      <Card className="mb-4 p-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (bisaKirim) kirim.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Dari lokasi (asal)</label>
              {terkunci ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  📦 {namaCabang(asalId)}
                </div>
              ) : (
                <select
                  value={asalId}
                  onChange={(e) => {
                    setAsalId(e.target.value);
                    setBaris([{ ingredient_id: "", qty: "" }]);
                    if (e.target.value === tujuanId) setTujuanId("");
                  }}
                  className={inputClass}
                  aria-label="Cabang asal transfer"
                >
                  {lokasiStok.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.tipe === "central_kitchen" ? "🏭 " : "🏪 "}
                      {b.nama}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Ke lokasi (tujuan)</label>
              <select
                value={tujuanId}
                onChange={(e) => setTujuanId(e.target.value)}
                className={inputClass}
                required
                aria-label="Cabang tujuan transfer"
              >
                <option value="">— pilih tujuan —</option>
                {lokasiStok
                  .filter((b) => b.id !== asalId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.tipe === "central_kitchen" ? "🏭 " : "🏪 "}
                      {b.nama}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Tabel bahan: JENIS (beli/produksi) selalu terlihat + saldo ready */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="pb-2">Bahan baku</th>
                  <th className="pb-2">Jenis</th>
                  <th className="pb-2 text-right">Stok tersedia</th>
                  <th className="pb-2 text-right">Jumlah kirim</th>
                  <th className="pb-2">Satuan</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {baris.map((b, i) => {
                  const s = saldoById.get(b.ingredient_id);
                  const lebih = s != null && Number(b.qty) > tersediaDari(s) + 1e-9;
                  // bahan yang sudah dipakai di baris lain disembunyikan
                  const dipakaiLain = new Set(
                    baris.filter((_, j) => j !== i).map((x) => x.ingredient_id),
                  );
                  const opsi = (rows: TransferStokSaldoRow[]) =>
                    rows.filter((r) => r.ingredient_id === b.ingredient_id || !dipakaiLain.has(r.ingredient_id));
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-2">
                        <select
                          value={b.ingredient_id}
                          onChange={(e) => {
                            const s2 = [...baris];
                            s2[i] = { ...s2[i], ingredient_id: e.target.value };
                            setBaris(s2);
                          }}
                          className={inputClass}
                          aria-label={`Bahan baris ${i + 1}`}
                        >
                          <option value="">— pilih bahan —</option>
                          {bahanBeli.length > 0 && (
                            <optgroup label="🛒 Bahan beli">
                              {opsi(bahanBeli).map((r) => (
                                <option key={r.ingredient_id} value={r.ingredient_id}>
                                  {r.nama} — {formatAngka(tersediaDari(r))} {r.satuan}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {bahanProduksi.length > 0 && (
                            <optgroup label="🏭 Bahan produksi">
                              {opsi(bahanProduksi).map((r) => (
                                <option key={r.ingredient_id} value={r.ingredient_id}>
                                  {r.nama} — {formatAngka(tersediaDari(r))} {r.satuan}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </td>
                      <td className="py-2 pr-2">{s ? <BadgeJenis pengadaan={s.pengadaan} /> : "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-600">
                        {s ? formatAngka(tersediaDari(s)) : "—"}
                        {s && s.dalam_jalan > 0 && (
                          <div className="text-[11px] font-normal text-amber-600">
                            {formatAngka(s.dalam_jalan)} dalam perjalanan
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <input
                          type="number"
                          min="0.0001"
                          step="any"
                          value={b.qty}
                          onChange={(e) => {
                            const s2 = [...baris];
                            s2[i] = { ...s2[i], qty: e.target.value };
                            setBaris(s2);
                          }}
                          className={`w-28 rounded-lg border px-2 py-2 text-right text-sm focus:outline-none ${
                            lebih
                              ? "border-red-400 bg-red-50 focus:border-red-500"
                              : "border-stone-300 focus:border-orange-500"
                          }`}
                          placeholder="0"
                          aria-label={`Jumlah kirim baris ${i + 1}`}
                        />
                      </td>
                      <td className="py-2 pr-2 text-xs text-stone-500">{s?.satuan ?? ""}</td>
                      <td className="py-2 text-right">
                        {baris.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setBaris(baris.filter((_, j) => j !== i))}
                            className="text-sm font-medium text-red-500 hover:underline"
                            aria-label={`Hapus baris ${i + 1}`}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {saldoLoading ? (
            <div className="mt-2">
              <Spinner />
            </div>
          ) : saldoRows.length === 0 ? (
            <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500">
              Tidak ada stok siap kirim di {namaCabang(asalId)} — isi stok dulu (produksi,
              pembelian, atau stok awal).
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setBaris([...baris, { ingredient_id: "", qty: "" }])}
              className="mt-2 text-sm font-medium text-orange-600 hover:underline"
            >
              + Tambah bahan
            </button>
          )}

          <div className="mt-3">
            <label className="mb-1 block text-sm font-medium">Catatan (opsional)</label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              maxLength={300}
              placeholder="mis. ganti barang rusak di jalan (kiriman PM-0006)"
              className={inputClass}
            />
          </div>

          {adaQtyLebih && (
            <p className="mt-2 text-sm font-medium text-red-600">
              Ada jumlah kirim melebihi stok tersedia — perbaiki dulu.
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" disabled={!bisaKirim || kirim.isPending} className={btnPrimary}>
              {kirim.isPending ? "Mengirim…" : "🔄 Kirim Transfer"}
            </button>
            {barisTerisi.length > 0 && (
              <span className="text-sm text-stone-500">
                {barisTerisi.length} bahan → {tujuanId ? namaCabang(tujuanId) : "pilih tujuan"}
              </span>
            )}
            {kirim.isSuccess && !kirim.isPending && (
              <span className="text-sm font-medium text-green-600">
                ✓ Transfer {kirim.data?.nomor} terkirim
              </span>
            )}
          </div>
          <ErrorText error={kirim.error} />
        </form>
      </Card>

      <h2 className="mb-2 text-lg font-bold text-stone-800">Riwayat Transfer</h2>
      {riwayatLoading ? (
        <Spinner />
      ) : (riwayat?.rows ?? []).length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada transfer stok.
        </Card>
      ) : (
        <div className="space-y-3">
          {(riwayat?.rows ?? []).map((f) => {
            const badge = BADGE_STATUS[f.status] ?? BADGE_STATUS.menunggu;
            return (
              <Card key={f.faktur_id} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 px-3 py-2.5 sm:px-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-stone-800">🔄 Transfer</span>
                      {f.nomor && (
                        <span className="rounded-md bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-orange-800">
                          {f.nomor}
                        </span>
                      )}
                      <span className="text-sm text-stone-500">
                        {formatTanggalRingkas(f.waktu)} · {formatWaktu(f.waktu)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-stone-600">
                      <b>{f.asal_cabang ?? "—"}</b> → <b>{f.tujuan_cabang ?? "—"}</b>
                      {f.dibuat_oleh && (
                        <span className="text-xs text-stone-400"> · oleh {f.dibuat_oleh}</span>
                      )}
                    </div>
                    {f.catatan && <div className="text-xs text-stone-500">{f.catatan}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    {f.status === "menunggu" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Batalkan transfer ${f.nomor ?? ""}? Kiriman ditarik dari Penerimaan cabang tujuan dan masuk Tempat Sampah.`,
                            )
                          )
                            batal.mutate(f.faktur_id);
                        }}
                        disabled={batal.isPending}
                        className="text-xs font-medium text-red-500 hover:underline"
                      >
                        Batalkan
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 text-left text-xs text-stone-500">
                        <th className="px-3 py-1.5">Bahan baku</th>
                        <th className="px-3 py-1.5">Jenis</th>
                        <th className="px-3 py-1.5 text-right">Jumlah</th>
                        <th className="px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {f.items.map((it) => (
                        <tr key={it.id} className={it.status === "ditolak" ? "bg-red-50/60" : ""}>
                          <td className="px-3 py-1.5 font-medium">{it.nama}</td>
                          <td className="px-3 py-1.5">
                            <BadgeJenis pengadaan={it.pengadaan} />
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {formatAngka(it.qty)} {it.satuan}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-stone-500">
                            {(BADGE_STATUS[it.status] ?? BADGE_STATUS.menunggu).label}
                            {it.alasan_tolak && ` · ${it.alasan_tolak}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
          <ErrorText error={batal.error} />
        </div>
      )}
    </div>
  );
}
