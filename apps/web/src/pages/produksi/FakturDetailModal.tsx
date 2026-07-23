import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FakturLogRow, JenisPengadaan } from "@kakarut/shared";
import { ErrorText, Modal, btnSecondary } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";
import {
  AKSI_TAHAP,
  URUTAN_TAHAP,
  badgeFaktur,
  belumSelesai,
  type FakturGroup,
  type TahapTujuan,
} from "./TambahStokPage";

/** Entri buku dana faktur: pencairan RAB, dana tambahan, atau sisa kembali. */
interface DanaEntri {
  id: string;
  tipe: "cair" | "tambahan" | "kembali";
  nominal: number;
  catatan: string | null;
  oleh: string | null;
  waktu: string;
}

/**
 * Detail satu faktur pembelian/produksi: lihat metadata + item, lalu Batalkan
 * (faktur dari Permintaan Stok — relasi permintaan) atau Hapus ke Tempat Sampah
 * (faktur input langsung). Keduanya bisa dipulihkan dari Tempat Sampah.
 */
export function FakturDetailModal({
  grup,
  tipe,
  endpoint,
  onClose,
  onUbahTahap,
}: {
  grup: FakturGroup;
  tipe: JenisPengadaan;
  endpoint: string;
  onClose: () => void;
  /** ganti tahap langsung dari detail (parent membuka halaman Ubah Tahap) */
  onUbahTahap?: (ke: TahapTujuan) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"lihat" | "hapus">("lihat");
  // Faktur dari Permintaan Stok: tak boleh dihapus langsung (relasinya ke
  // permintaan) — hanya "Batalkan". Hapus permanen dilakukan dari halaman
  // Permintaan Stok. Faktur input langsung tetap "Hapus" biasa.
  const dariPermintaan = grup.dariPermintaan;

  const { data: dana } = useQuery({
    queryKey: [endpoint, "dana", grup.fakturId],
    queryFn: () =>
      api<{ rows: DanaEntri[]; total: number }>(`${endpoint}/dana/${grup.fakturId}`),
    enabled: mode === "lihat" && !!grup.fakturId && grup.danaCair !== 0,
  });
  // jejak kegiatan faktur: dibuat → ubah tahap → konfirmasi/penerimaan
  const { data: log } = useQuery({
    queryKey: [endpoint, "log", grup.fakturId],
    queryFn: () => api<{ rows: FakturLogRow[] }>(`${endpoint}/log/${grup.fakturId}`),
    enabled: mode === "lihat" && !!grup.fakturId,
  });

  function selesai() {
    for (const key of [endpoint, "stok", "sampah", "laporan", "penjualan", "rekomendasi"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    onClose();
  }

  // Batalkan / Hapus = SOFT-DELETE ke Tempat Sampah (cukup konfirmasi — bisa
  // dipulihkan). Untuk faktur dari permintaan ini berarti "batalkan" faktur;
  // permintaannya TIDAK tersentuh (tetap ada di Permintaan Stok).
  const hapus = useMutation({
    mutationFn: () => api(`${endpoint}/faktur/${grup.key}`, { method: "DELETE" }),
    onSuccess: selesai,
  });

  const judul =
    mode === "hapus"
      ? dariPermintaan
        ? "Batalkan Faktur"
        : "Hapus ke Tempat Sampah"
      : `Detail ${tipe === "beli" ? "Pembelian" : "Produksi"}`;

  return (
    <Modal open onClose={onClose} title={judul}>
      {mode === "lihat" && (
        <div className="space-y-3">
          <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
            {grup.nomor && (
              <>
                <dt className="text-stone-400">Nomor</dt>
                <dd className="col-span-2 font-mono font-bold text-orange-700">{grup.nomor}</dd>
              </>
            )}
            <dt className="text-stone-400">Waktu</dt>
            <dd className="col-span-2">{formatWaktu(grup.waktu)}</dd>
            <dt className="text-stone-400">Dibuat oleh</dt>
            <dd className="col-span-2">{grup.dibuatOleh ?? "—"}</dd>
            {tipe === "produksi" && (
              <>
                <dt className="text-stone-400">Dikerjakan oleh</dt>
                <dd className="col-span-2">{grup.dikerjakanOleh ?? grup.supplier ?? "—"}</dd>
              </>
            )}
            {tipe === "beli" && (
              <>
                <dt className="text-stone-400">Supplier</dt>
                <dd className="col-span-2">{grup.supplier ?? "Tanpa sumber"}</dd>
                <dt className="text-stone-400">No. faktur</dt>
                <dd className="col-span-2">{grup.noFaktur ?? "—"}</dd>
              </>
            )}
            <dt className="text-stone-400">Status</dt>
            <dd className="col-span-2">{badgeFaktur(tipe, grup.status).label}</dd>
            {grup.danaCair > 0 && (
              <>
                <dt className="text-stone-400">Dana cair</dt>
                <dd className="col-span-2 font-semibold text-emerald-700">
                  💸 {formatRupiah(grup.danaCair)}
                  {grup.totalHarga > 0 && (
                    <span className="ml-1 font-normal text-stone-400">
                      dari RAB {formatRupiah(grup.totalHarga)}
                    </span>
                  )}
                </dd>
              </>
            )}
            {grup.rows.some((r) => r.alasan_tolak) && (
              <>
                <dt className="text-stone-400">Alasan tolak</dt>
                <dd className="col-span-2 text-red-700">
                  {grup.rows.find((r) => r.alasan_tolak)?.alasan_tolak}
                </dd>
              </>
            )}
            {grup.catatan && (
              <>
                <dt className="text-stone-400">Catatan</dt>
                <dd className="col-span-2">{grup.catatan}</dd>
              </>
            )}
            {grup.diubahOleh && (
              <>
                <dt className="text-stone-400">Diubah oleh</dt>
                <dd className="col-span-2">
                  {grup.diubahOleh}
                  {grup.updatedAt ? ` · ${formatWaktu(grup.updatedAt)}` : ""}
                </dd>
              </>
            )}
          </dl>

          {dana && dana.rows.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2 text-sm">
              <div className="mb-1 font-semibold text-stone-700">💸 Buku dana faktur</div>
              <ul className="space-y-0.5">
                {dana.rows.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2">
                    <span className="min-w-0">
                      {d.tipe === "cair"
                        ? "💸 Cair"
                        : d.tipe === "tambahan"
                          ? "➕ Tambahan"
                          : "↩ Kembali"}
                      {d.catatan && <span className="text-stone-500"> — {d.catatan}</span>}
                      {d.oleh && <span className="text-xs text-stone-400"> · {d.oleh}</span>}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${d.tipe === "kembali" ? "text-amber-700" : "text-emerald-700"}`}
                    >
                      {d.tipe === "kembali" ? "−" : "+"}
                      {formatRupiah(d.nominal)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 border-t border-emerald-200 pt-1 text-right text-xs font-semibold text-emerald-800">
                Dana efektif: {formatRupiah(dana.total)}
              </div>
            </div>
          )}

          {log && log.rows.length > 0 && (
            <div className="rounded-lg border border-stone-200 p-2 text-sm">
              <div className="mb-1 font-semibold text-stone-700">📜 Riwayat tahap</div>
              <ol className="space-y-1">
                {log.rows.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="shrink-0 font-mono text-xs text-stone-400">
                      {formatWaktu(l.waktu)}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-stone-700">{l.aksi}</span>
                      {l.detail && <span className="text-stone-500"> — {l.detail}</span>}
                      {l.oleh && <span className="text-xs text-stone-400"> · {l.oleh}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="rounded-lg border border-stone-200">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {grup.rows.map((r) => {
                  const ditolak = r.status === "ditolak";
                  // faktur campuran: tujuan tiap baris ditulis eksplisit
                  const campuranTujuan =
                    tipe === "beli" &&
                    grup.rows.some((x) => x.tujuan_branch_id != null) &&
                    grup.rows.some((x) => x.tujuan_branch_id == null);
                  return (
                  <tr key={r.id} className={ditolak ? "bg-red-50/60" : ""}>
                    <td className="px-3 py-1.5 font-medium">
                      {r.bahan}
                      {campuranTujuan && (
                        <span
                          className={`ml-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            r.tujuan_branch_id != null
                              ? "bg-purple-100 text-purple-800"
                              : "bg-stone-200 text-stone-700"
                          }`}
                        >
                          {r.tujuan_branch_id != null
                            ? `📦 → ${r.tujuan_cabang ?? "cabang"}`
                            : "🏭 di sini"}
                        </span>
                      )}
                      {ditolak && (
                        <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                          ❌ ditolak
                        </span>
                      )}
                      {/* info belanja: supplier utama bahan + alamatnya */}
                      {tipe === "beli" && r.supplier_bahan && (
                        <div className="mt-0.5 text-xs font-normal text-stone-600">
                          🏪 {r.supplier_bahan}
                          {r.supplier_bahan_telepon && (
                            <span className="text-stone-400"> · {r.supplier_bahan_telepon}</span>
                          )}
                          {r.supplier_bahan_alamat && (
                            <div className="text-[11px] font-normal text-stone-400">
                              📍 {r.supplier_bahan_alamat}
                            </div>
                          )}
                        </div>
                      )}
                      {/* exp lot — terisi saat baris masuk stok (Tiba/Selesai) */}
                      {r.exp_date && (
                        <div className="mt-0.5 text-[11px] font-normal text-stone-500">
                          ⏳ exp {formatTanggalRingkas(r.exp_date)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-stone-600">
                      {ditolak ? (
                        <span className="text-stone-400">
                          0 dari {formatAngka(r.qty)} {r.satuan}
                        </span>
                      ) : (
                        <>
                          +{formatAngka(r.qty)} {r.satuan}
                          {r.qty_dipesan != null && r.qty_dipesan !== r.qty && (
                            <span className="ml-1 text-xs text-amber-600">
                              (dipesan {formatAngka(r.qty_dipesan)})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-stone-500">{r.tempat ?? "—"}</td>
                    {/* Produksi tak menampilkan biaya (bahan sudah dibeli di Beli
                        Bahan Baku) — cukup jumlah yang diproduksi. */}
                    {tipe === "beli" && (
                      <td className="px-3 py-1.5 text-right text-stone-500">
                        {r.total_harga == null ? (
                          "—"
                        ) : ditolak ? (
                          <span className="text-stone-400 line-through">
                            {formatRupiah(r.total_harga)}
                          </span>
                        ) : (
                          formatRupiah(r.total_harga)
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {tipe === "beli" && grup.totalHarga > 0 && (
            <div className="text-right text-sm font-semibold text-stone-700">
              Total: {formatRupiah(grup.totalHarga)}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {/* ganti tahap langsung dari detail — tanpa harus menutup modal dulu */}
            {onUbahTahap &&
              grup.fakturId &&
              belumSelesai(grup.status) &&
              (() => {
                const tahapTerawal = Math.min(
                  ...grup.rows.map((r) => URUTAN_TAHAP[r.status]),
                );
                const isWorkOrderFaktur =
                  tipe === "produksi" && grup.rows.some((r) => r.tujuan_branch_id != null);
                const adaTujuan = grup.rows.some((r) => r.tujuan_branch_id != null);
                const opsiTahap = AKSI_TAHAP[tipe]
                  .filter(
                    (a) =>
                      URUTAN_TAHAP[a.ke] > tahapTerawal &&
                      !(isWorkOrderFaktur && a.ke === "dikonfirmasi"),
                  )
                  // belanja bertujuan cabang: "menunggu" = barang tiba di CK
                  .map((a) =>
                    tipe === "beli" && adaTujuan && a.ke === "menunggu"
                      ? { ...a, label: "📦 Tiba di CK (semua barang di CK)" }
                      : a,
                  );
                if (opsiTahap.length === 0) return null;
                return (
                  <select
                    value=""
                    onChange={(e) => {
                      const ke = e.target.value as TahapTujuan | "";
                      if (ke) onUbahTahap(ke);
                    }}
                    aria-label="Ubah tahap faktur dari detail"
                    className="cursor-pointer rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-500"
                  >
                    <option value="">➡ Ubah Tahap</option>
                    {opsiTahap.map((a) => (
                      <option key={a.ke} value={a.ke}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                );
              })()}
            {/* Faktur dari permintaan → Batalkan (relasi permintaan); input
                langsung → Hapus biasa. Keduanya ke Tempat Sampah (dpt dipulihkan). */}
            {dariPermintaan ? (
              <button
                onClick={() => setMode("hapus")}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
              >
                🚫 Batalkan
              </button>
            ) : (
              <button
                onClick={() => setMode("hapus")}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                🗑 Hapus
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "hapus" && (
        <div className="space-y-3">
          {dariPermintaan ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Faktur ini berasal dari <b>Permintaan {grup.permintaanNomor ?? "Stok"}</b>.
              Membatalkan akan mengeluarkan faktur ini (stok dikoreksi) & memindahkannya ke{" "}
              <b>Tempat Sampah</b> (bisa dipulihkan). <b>Permintaannya tetap ada</b> — untuk
              menghapus permanen, hapus dari <b>Permintaan Stok</b>.
            </div>
          ) : (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Faktur akan dipindah ke <b>Tempat Sampah</b> dan stoknya dikoreksi. Masih bisa{" "}
              <b>dipulihkan</b> dari Tempat Sampah bila terhapus tak sengaja.
            </div>
          )}
          <ErrorText error={hapus.error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setMode("lihat")} className={btnSecondary}>
              {dariPermintaan ? "Tidak" : "Batal"}
            </button>
            <button
              onClick={() => hapus.mutate()}
              disabled={hapus.isPending}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                dariPermintaan
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {hapus.isPending
                ? dariPermintaan
                  ? "Membatalkan…"
                  : "Menghapus…"
                : dariPermintaan
                  ? "Ya, Batalkan faktur"
                  : "Ya, pindahkan ke Tempat Sampah"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
