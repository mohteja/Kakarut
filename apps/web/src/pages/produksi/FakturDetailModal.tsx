import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FakturLogRow, JenisPengadaan, PenyimpananDto, SupplierDto } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
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

interface Karyawan {
  user_id: string;
  nama: string;
  is_active: boolean;
}

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
 * Detail satu faktur pembelian/produksi: lihat metadata + item, ubah metadata,
 * atau hapus (Tempat Sampah). Ubah & hapus butuh password akun.
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
  // Tempat penyimpanan diambil dari cabang FAKTUR ini (bukan pilihan Kantor),
  // agar daftar tempat cocok dengan cabang faktur — termasuk faktur store lama
  // yang dibuka dari Kantor.
  const fakturBranchId = grup.rows[0]?.branch_id ?? null;
  const branchQuery = fakturBranchId ? `?branch_id=${fakturBranchId}` : "";
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"lihat" | "ubah" | "hapus">("lihat");

  const [noFaktur, setNoFaktur] = useState(grup.noFaktur ?? "");
  const [supplierId, setSupplierId] = useState(grup.supplierId ?? ""); // jalur beli
  // jalur produksi: pelaksana "k:<user_id>" / "s:<supplier_id>"
  const [pelaksana, setPelaksana] = useState(
    grup.workerId ? `k:${grup.workerId}` : grup.supplierId ? `s:${grup.supplierId}` : "",
  );
  const [tempatId, setTempatId] = useState("__keep");
  const [prodDate, setProdDate] = useState(grup.prodDate);
  const [catatan, setCatatan] = useState(grup.catatan ?? "");
  const [password, setPassword] = useState("");

  const { data: supplier = [] } = useQuery({
    queryKey: ["supplier"],
    queryFn: () => api<SupplierDto[]>("/supplier"),
    enabled: mode === "ubah",
  });
  const { data: tempat = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
    enabled: mode === "ubah",
  });
  const { data: karyawan = [] } = useQuery({
    queryKey: ["karyawan"],
    queryFn: () => api<Karyawan[]>("/karyawan"),
    enabled: mode === "ubah" && tipe === "produksi",
  });
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

  const [pelTipe, pelId] = pelaksana ? pelaksana.split(":") : ["", ""];

  const simpanUbah = useMutation({
    mutationFn: () =>
      api(`${endpoint}/faktur/${grup.key}`, {
        method: "PATCH",
        body: {
          password,
          no_faktur: noFaktur.trim() || null,
          // beli: supplier langsung; produksi: pelaksana → worker_id/supplier_id
          supplier_id:
            tipe === "beli" ? supplierId || null : pelTipe === "s" ? pelId : null,
          ...(tipe === "produksi" ? { worker_id: pelTipe === "k" ? pelId : null } : {}),
          catatan: catatan.trim() || null,
          prod_date: prodDate,
          ...(tempatId !== "__keep" ? { storage_location_id: tempatId || null } : {}),
        },
      }),
    onSuccess: selesai,
  });

  // Hapus = SOFT-DELETE ke Tempat Sampah (cukup konfirmasi, tanpa password —
  // bisa dipulihkan dari Tempat Sampah).
  const hapus = useMutation({
    mutationFn: () => api(`${endpoint}/faktur/${grup.key}`, { method: "DELETE" }),
    onSuccess: selesai,
  });

  const judul =
    mode === "ubah"
      ? "Ubah Metadata Faktur"
      : mode === "hapus"
        ? "Hapus ke Tempat Sampah"
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
            <button onClick={() => setMode("ubah")} className={btnSecondary}>
              ✏️ Ubah metadata
            </button>
            <button
              onClick={() => setMode("hapus")}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              🗑 Hapus
            </button>
          </div>
        </div>
      )}

      {mode === "ubah" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            simpanUbah.mutate();
          }}
          className="space-y-3"
        >
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Hanya metadata yang diubah — jumlah & harga tidak berubah (stok tetap).
          </div>
          {tipe === "beli" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">Supplier</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— tanpa supplier —</option>
                  {supplier.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nama}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">No. faktur</label>
                <input
                  value={noFaktur}
                  onChange={(e) => setNoFaktur(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}
          {tipe === "produksi" && (
            <div>
              <label className="mb-1 block text-sm font-medium">Dikerjakan oleh (pelaksana)</label>
              <select
                value={pelaksana}
                onChange={(e) => setPelaksana(e.target.value)}
                className={inputClass}
              >
                <option value="">— tanpa pelaksana —</option>
                {karyawan
                  .filter((k) => k.is_active)
                  .map((k) => (
                    <option key={`k:${k.user_id}`} value={`k:${k.user_id}`}>
                      {k.nama} (karyawan)
                    </option>
                  ))}
                {supplier
                  .filter((s) => s.is_active)
                  .map((s) => (
                    <option key={`s:${s.id}`} value={`s:${s.id}`}>
                      {s.nama} (supplier)
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">Tempat penyimpanan (semua item)</label>
            <select
              value={tempatId}
              onChange={(e) => setTempatId(e.target.value)}
              className={inputClass}
            >
              <option value="__keep">— jangan ubah —</option>
              <option value="">(kosongkan)</option>
              {tempat.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nama}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Tanggal</label>
            <input
              type="date"
              value={prodDate}
              onChange={(e) => setProdDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Catatan</label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password akun (konfirmasi)</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </div>
          <ErrorText error={simpanUbah.error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setMode("lihat")} className={btnSecondary}>
              Batal
            </button>
            <button type="submit" disabled={simpanUbah.isPending} className={btnPrimary}>
              {simpanUbah.isPending ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      )}

      {mode === "hapus" && (
        <div className="space-y-3">
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Faktur akan dipindah ke <b>Tempat Sampah</b> dan stoknya dikoreksi. Masih bisa{" "}
            <b>dipulihkan</b> dari Tempat Sampah bila terhapus tak sengaja.
          </div>
          <ErrorText error={hapus.error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setMode("lihat")} className={btnSecondary}>
              Batal
            </button>
            <button
              onClick={() => hapus.mutate()}
              disabled={hapus.isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {hapus.isPending ? "Menghapus…" : "Ya, pindahkan ke Tempat Sampah"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
