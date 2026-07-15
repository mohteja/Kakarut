import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { JenisPengadaan, PenyimpananDto } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary, inputClass, tdClass, thClass } from "../../components/ui";
import { labelCabang, useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
import { useCompanyMode } from "../../lib/useCompanyMode";
import {
  AKSI_TAHAP,
  URUTAN_TAHAP,
  badgeFaktur,
  labelTahapRingkas,
  type FakturGroup,
  type TahapTujuan,
} from "./TambahStokPage";

interface PilihanBaris {
  aktif: boolean;
  /** qty yang maju — disimpan sebagai teks agar desimal enak diketik */
  qty: string;
  /** harga riil bagian yang maju (harga pasar naik/turun); default prorata RAB */
  harga: string;
  /** true bila harga sudah diketik manual — berhenti mengikuti prorata qty */
  hargaManual: boolean;
}

/**
 * Penyesuaian sebelum tahap faktur berubah: pilih baris (dan qty) yang
 * benar-benar maju — mis. barang yang baru dibeli/dikirim sebagian. Baris
 * atau sisa qty yang tidak ikut tetap di tahap lama sebagai tugas yang
 * masih harus dikerjakan. Perubahan baru terjadi setelah tombol Terapkan.
 */
export function TahapModal({
  grup,
  tipe,
  endpoint,
  ke,
  onClose,
  onSelesai,
}: {
  grup: FakturGroup;
  tipe: JenisPengadaan;
  endpoint: string;
  ke: TahapTujuan;
  onClose: () => void;
  /** dipanggil setelah tahap sukses diterapkan (mis. buka dokumen belanja) */
  onSelesai?: (ke: TahapTujuan) => void;
}) {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  // branchId (cabang-data) hanya fallback; konteks tahap MENGIKUTI cabang
  // FAKTUR itu sendiri (grup.rows[0].branch_id), bukan pilihan Kantor — agar
  // faktur store lama tak keliru dianggap milik CK saat dibuka dari Kantor.
  const { id: branchId } = useCabangData("produksi");
  const { isPro } = useCompanyMode();
  // Work-order CK: faktur produksi hidup di CK & punya cabang tujuan. Tahap
  // "selesai" hanya menyimpan di CK; pengiriman ke cabang lewat tombol
  // "Kirim ke cabang" TERPISAH.
  const isWorkOrder = grup.rows.some((r) => r.tujuan_branch_id != null);
  const fakturBranchId = grup.rows[0]?.branch_id ?? branchId ?? "";
  // CK hanya mengirim ke store yang terhubung dengannya (satu CK per store)
  const cabangIniCk =
    cabang.find((b) => b.id === fakturBranchId)?.tipe === "central_kitchen";
  const target = URUTAN_TAHAP[ke];
  // hanya baris yang tahapnya masih di belakang tujuan yang bisa maju
  const bisaMaju = grup.rows.filter(
    (r) => r.status !== "ditolak" && URUTAN_TAHAP[r.status] < target,
  );
  const [pilih, setPilih] = useState<Record<string, PilihanBaris>>(() =>
    Object.fromEntries(
      bisaMaju.map((r) => [
        r.id,
        {
          aktif: true,
          qty: String(r.qty),
          harga: String(r.total_harga ?? 0),
          hargaManual: false,
        },
      ]),
    ),
  );

  const label = AKSI_TAHAP[tipe].find((a) => a.ke === ke)?.label ?? ke;
  const keStok = ke === "dikonfirmasi";
  // RAB → diproses hanya INFO (dan pencatatan dana cair) — jumlah barang belum
  // berubah; penyesuaian barang dilakukan saat proses → selesai.
  const keProses = ke === "dikerjakan";
  const keSelesai = ke === "menunggu";

  // Dana cair: ditanyakan saat ada baris terpilih yang MENINGGALKAN tahap RAB
  // — satu input nominal, terisi otomatis senilai RAB bagian yang maju sampai
  // diketik manual (cair sebagian tinggal ubah angkanya).
  const [danaNominal, setDanaNominal] = useState("");
  const [danaManual, setDanaManual] = useState(false);

  // Realisasi biaya saat proses → selesai: sesuai rencana, atau tidak —
  // harga riil per bahan disesuaikan (pasar naik/turun) dan selisih dananya
  // wajib dijelaskan (kurang: dari mana; lebih: di siapa).
  const [sesuaiRencana, setSesuaiRencana] = useState(true);
  const [selisihCatatan, setSelisihCatatan] = useState("");
  const pakaiHarga = keSelesai && !sesuaiRencana;

  // Tujuan kirim saat "dikirim/selesai": cabang tujuan (default = cabang
  // faktur ini) + tempat penyimpanan di cabang itu (opsional).
  const [tujuanCabang, setTujuanCabang] = useState(fakturBranchId || "");
  const [tujuanTempat, setTujuanTempat] = useState("");
  // work-order: tempat penyimpanan diambil dari CK (cabang faktur), bukan tujuan
  const storageBranch = isWorkOrder ? fakturBranchId : tujuanCabang;
  const { data: tempatTujuan = [] } = useQuery({
    queryKey: ["penyimpanan", storageBranch],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan?branch_id=${storageBranch}`),
    enabled: keSelesai && storageBranch !== "",
  });

  // Tahap "diproses": semua baris ikut penuh (read-only). Tahap lain: sesuai
  // centang + qty maju yang diisi; harga riil ikut dikirim bila disesuaikan.
  const items = keProses
    ? bisaMaju.map((r) => ({ id: r.id, qty: r.qty }))
    : bisaMaju
        .filter((r) => pilih[r.id]?.aktif)
        .map((r) => ({
          id: r.id,
          qty: Number(pilih[r.id]?.qty),
          ...(pakaiHarga ? { harga: Number(pilih[r.id]?.harga) } : {}),
        }));
  const adaInvalid =
    !keProses &&
    bisaMaju.some((r) => {
      const p = pilih[r.id];
      if (!p?.aktif) return false;
      const q = Number(p.qty);
      if (!Number.isFinite(q) || q <= 0 || q > r.qty + 1e-9) return true;
      if (pakaiHarga) {
        const h = Number(p.harga);
        if (!Number.isFinite(h) || h < 0) return true;
      }
      return false;
    });
  // baris tak dicentang atau qty parsial → jadi sisa tugas di tahap lama
  const sisaTugas = keProses
    ? 0
    : bisaMaju.filter((r) => {
        const p = pilih[r.id];
        return !p?.aktif || Number(p.qty) < r.qty - 1e-9;
      }).length;

  // RAB bagian yang maju dari baris tahap "rencana" (prorata sesuai qty maju,
  // sama dengan hitungan split di server) — dasar default "cair penuh".
  const barisRab = bisaMaju.filter((r) => r.status === "rencana" && pilih[r.id]?.aktif);
  const rabMaju = barisRab.reduce((t, r) => {
    const q = Number(pilih[r.id]?.qty);
    if (!Number.isFinite(q) || q <= 0 || r.total_harga == null) return t;
    return t + Math.round((r.total_harga * Math.min(q, r.qty)) / r.qty);
  }, 0);
  const tanyaDana = barisRab.length > 0;
  const danaCair = !tanyaDana ? null : danaManual ? Number(danaNominal) : rabMaju;
  const danaInvalid =
    tanyaDana && danaManual && (!Number.isFinite(danaCair) || danaCair! < 0);

  // Realisasi vs dana faktur (termasuk pencairan yang dikirim bersamaan):
  // kurang → wajib jelaskan dari mana uangnya; lebih → di siapa sisa uangnya.
  const danaFaktur = grup.danaCair + (danaCair != null && !danaInvalid ? danaCair : 0);
  // total biaya riil = Σ harga riil baris yang maju (dari kolom harga)
  const realisasi = pakaiHarga
    ? bisaMaju
        .filter((r) => pilih[r.id]?.aktif)
        .reduce((t, r) => t + (Number(pilih[r.id]?.harga) || 0), 0)
    : null;
  const selisih = realisasi != null ? realisasi - danaFaktur : 0;
  const butuhCatatanSelisih = realisasi != null && !adaInvalid && Math.abs(selisih) >= 0.5;
  const catatanSelisihKosong = butuhCatatanSelisih && selisihCatatan.trim().length === 0;

  const simpan = useMutation({
    mutationFn: () =>
      api(`${endpoint}/tahap/${grup.fakturId}`, {
        method: "POST",
        body: {
          ke,
          items,
          ...(danaCair != null ? { dana_cair: danaCair } : {}),
          ...(realisasi != null && !adaInvalid
            ? { realisasi, selisih_catatan: selisihCatatan.trim() || null }
            : {}),
          // work-order: JANGAN kirim di tahap selesai (kirim langkah terpisah)
          ...(keSelesai && !isWorkOrder && tujuanCabang ? { tujuan_branch_id: tujuanCabang } : {}),
          ...(keSelesai && tujuanTempat ? { tujuan_storage_id: tujuanTempat } : {}),
        },
      }),
    onSuccess: () => {
      for (const key of [endpoint, "stok", "laporan", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
      onSelesai?.(ke);
    },
  });

  function ubah(r: { id: string; qty: number; total_harga: number | null }, patch: Partial<PilihanBaris>) {
    setPilih((prev) => {
      const baru = { ...prev[r.id], ...patch };
      // harga default mengikuti prorata qty maju selama belum diketik manual
      if (patch.qty !== undefined && !baru.hargaManual && r.total_harga != null) {
        const q = Number(patch.qty);
        if (Number.isFinite(q) && q > 0) {
          baru.harga = String(Math.round((r.total_harga * Math.min(q, r.qty)) / r.qty));
        }
      }
      return { ...prev, [r.id]: baru };
    });
  }

  return (
    <Modal open onClose={onClose} title={`Ubah tahap → ${label}`}>
      <div className="space-y-3">
        {keProses ? (
          <p className="text-sm text-stone-500">
            Faktur ditandai <b>sedang diproses</b> — cukup pastikan RAB & catat dana yang
            cair.
            {tipe === "beli" && (
              <>
                {" "}
                Rincian bahan + supplier ada di <b>📄 dokumen belanja</b> yang terbuka
                setelah ini.
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-stone-500">
            Centang baris yang benar-benar ikut maju. Bila barang baru sebagian, kecilkan{" "}
            <b>qty maju</b> — sisanya tetap di tahap sekarang sebagai <b>tugas</b> yang
            masih harus dikerjakan.
          </p>
        )}

        {keStok && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠ Baris yang dicentang dianggap <b>benar-benar ada/diterima</b> — stok langsung
            terhitung{tipe === "beli" ? " dan tercatat sebagai pengeluaran" : ""}.
          </div>
        )}

        {bisaMaju.length === 0 ? (
          <div className="py-6 text-center text-sm text-stone-400">
            Tidak ada baris yang bisa dipindah ke tahap ini.
          </div>
        ) : keProses ? (
          /* Tahap DIPROSES dibuat sesimpel mungkin: hanya RAB + dana cair —
             rincian per bahan ada di dokumen belanja. */
          <div className="space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Jumlah bahan</span>
              <b>{bisaMaju.length} baris</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Total est. RAB</span>
              <b className="text-base">
                {formatRupiah(bisaMaju.reduce((t, r) => t + (r.total_harga ?? 0), 0))}
              </b>
            </div>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  {!keProses && <th className={thClass}></th>}
                  <th className={thClass}>Bahan</th>
                  {/* di HP pill tahap pindah ke bawah nama bahan agar muat */}
                  <th className={`${thClass} hidden sm:table-cell`}>Tahap sekarang</th>
                  <th className={`${thClass} text-right`}>{keProses ? "Qty" : "Qty maju"}</th>
                  {pakaiHarga && <th className={`${thClass} text-right`}>Harga riil (Rp)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {bisaMaju.map((r) => {
                  const p = pilih[r.id];
                  const q = Number(p?.qty);
                  const salah =
                    !keProses &&
                    p?.aktif &&
                    (!Number.isFinite(q) || q <= 0 || q > r.qty + 1e-9);
                  const sisa = p?.aktif && Number.isFinite(q) ? r.qty - q : r.qty;
                  return (
                    <tr key={r.id} className={p?.aktif || keProses ? "" : "opacity-50"}>
                      {!keProses && (
                        <td className={tdClass}>
                          <input
                            type="checkbox"
                            checked={p?.aktif ?? false}
                            onChange={(e) => ubah(r, { aktif: e.target.checked })}
                            aria-label={`Ikutkan ${r.bahan}`}
                          />
                        </td>
                      )}
                      <td className={`${tdClass} font-medium`}>
                        {r.bahan}
                        <div className="mt-0.5 sm:hidden">
                          <span
                            className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeFaktur(tipe, r.status).cls}`}
                          >
                            {labelTahapRingkas(tipe, r.status)}
                          </span>
                        </div>
                      </td>
                      <td className={`${tdClass} hidden sm:table-cell`}>
                        <span
                          className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeFaktur(tipe, r.status).cls}`}
                        >
                          {labelTahapRingkas(tipe, r.status)}
                        </span>
                      </td>
                      <td className={`${tdClass} text-right`}>
                        {keProses ? (
                          <span>
                            {formatAngka(r.qty)} {r.satuan}
                          </span>
                        ) : (
                          <>
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                min="0"
                                max={r.qty}
                                step="any"
                                value={p?.qty ?? ""}
                                disabled={!p?.aktif}
                                onChange={(e) => ubah(r, { qty: e.target.value })}
                                aria-label={`Qty maju ${r.bahan}`}
                                className={`w-16 rounded-lg border px-2 py-1 text-right sm:w-24 ${salah ? "border-red-400" : "border-stone-300"}`}
                              />
                              <span className="text-xs text-stone-400">
                                / {formatAngka(r.qty)} {r.satuan}
                              </span>
                            </div>
                            {p?.aktif && sisa > 1e-9 && !salah && (
                              <div className="text-right text-[11px] text-amber-600">
                                sisa {formatAngka(sisa)} {r.satuan} tetap jadi tugas
                              </div>
                            )}
                            {salah && (
                              <div className="text-right text-[11px] text-red-600">
                                qty harus 0&lt;qty≤{formatAngka(r.qty)}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      {pakaiHarga && (
                        <td className={`${tdClass} text-right`}>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={p?.harga ?? ""}
                            disabled={!p?.aktif}
                            onChange={(e) =>
                              ubah(r, { harga: e.target.value, hargaManual: true })
                            }
                            aria-label={`Harga riil ${r.bahan}`}
                            className={`w-20 rounded-lg border px-2 py-1 text-right sm:w-28 ${p?.aktif && !(Number.isFinite(Number(p?.harga)) && Number(p?.harga) >= 0) ? "border-red-400" : "border-stone-300"}`}
                          />
                          {r.total_harga != null && (
                            <div className="text-right text-[11px] text-stone-400">
                              RAB {formatRupiah(r.total_harga)}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {keSelesai && (
          <div className="space-y-2 rounded-lg border border-stone-200 p-3">
            <div className="text-sm font-semibold text-stone-700">
              {isWorkOrder ? "📦 Selesai — disimpan di Central Kitchen" : "🚚 Dikirim / disimpan ke mana?"}
            </div>
            {isWorkOrder && (
              <div className="rounded bg-purple-50 px-2 py-1.5 text-xs text-purple-800">
                Barang jadi disimpan dulu di CK. Kirim ke cabang tujuan lewat tombol{" "}
                <b>🚚 Kirim ke cabang</b> setelah selesai.
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {/* Pilihan cabang tujuan hanya di mode Pro (multi-lokasi);
                  Lite otomatis ke cabang sendiri. Kantor bukan tujuan kirim.
                  Work-order: kirim di langkah terpisah, jadi disembunyikan. */}
              {isPro && !isWorkOrder && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-stone-500">
                    Cabang tujuan
                  </label>
                  <select
                    value={tujuanCabang}
                    onChange={(e) => {
                      setTujuanCabang(e.target.value);
                      setTujuanTempat("");
                    }}
                    aria-label="Cabang tujuan"
                    className={inputClass}
                  >
                    {cabang
                      .filter((b) => b.is_active && b.tipe !== "kantor")
                      // Store terhubung ke SATU CK: dari CK hanya tampil store
                      // yang dipasoknya (plus CK itu sendiri)
                      .filter((b) =>
                        cabangIniCk
                          ? b.id === fakturBranchId ||
                            (b.tipe === "store" && b.central_kitchen_id === fakturBranchId)
                          : true,
                      )
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {labelCabang(b)}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-500">
                  {isWorkOrder ? "Tempat penyimpanan di CK (opsional)" : "Tempat penyimpanan (opsional)"}
                </label>
                <select
                  value={tujuanTempat}
                  onChange={(e) => setTujuanTempat(e.target.value)}
                  aria-label="Tempat penyimpanan tujuan"
                  className={inputClass}
                >
                  <option value="">— pilih tempat —</option>
                  {tempatTujuan.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nama}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!isWorkOrder && tujuanCabang && fakturBranchId && tujuanCabang !== fakturBranchId && (
              <div className="text-xs text-amber-700">
                Baris yang maju akan <b>berpindah ke cabang tujuan</b> (stok terhitung di
                sana saat diterima); sisa tugas tetap di cabang ini.
              </div>
            )}
            {!isWorkOrder && tujuanCabang === fakturBranchId && cabangIniCk && (
              <div className="text-xs text-stone-500">
                🏭 Ini Central Kitchen — bila barang untuk outlet, pilih cabang 🏪 store
                sebagai tujuan (hanya store yang terhubung ke CK ini yang bisa dipilih).
              </div>
            )}
          </div>
        )}

        {tanyaDana && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="text-sm font-semibold text-stone-700">
              💸 Dana cair untuk baris dari tahap RAB
            </div>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>Nominal yang cair:</span>
              <input
                type="number"
                min="0"
                step="any"
                value={danaManual ? danaNominal : String(rabMaju)}
                onChange={(e) => {
                  setDanaManual(true);
                  setDanaNominal(e.target.value);
                }}
                placeholder="Rp"
                aria-label="Nominal dana cair"
                className={`w-36 rounded-lg border px-2 py-1 text-right text-sm ${danaInvalid ? "border-red-400" : "border-stone-300"}`}
              />
              <span className="text-xs text-stone-400">RAB: {formatRupiah(rabMaju)}</span>
            </label>
            {!danaInvalid && danaCair != null && danaCair < rabMaju - 0.49 && (
              <div className="text-xs text-amber-700">
                Cair sebagian — kurang {formatRupiah(rabMaju - danaCair)} dari RAB.
              </div>
            )}
            {grup.danaCair > 0 && (
              <div className="text-xs text-stone-500">
                Sudah cair sebelumnya: {formatRupiah(grup.danaCair)} (pencairan dijumlahkan)
              </div>
            )}
          </div>
        )}

        {keSelesai && (
          <div className="space-y-2 rounded-lg border border-stone-200 p-3">
            <div className="text-sm font-semibold text-stone-700">
              🧾 Realisasi biaya — selesai sesuai rencana?
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="realisasi"
                checked={sesuaiRencana}
                onChange={() => setSesuaiRencana(true)}
              />
              <span>
                Ya, <b>sesuai rencana</b> — biaya pas dengan dana faktur (
                {formatRupiah(danaFaktur)})
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="realisasi"
                checked={!sesuaiRencana}
                onChange={() => setSesuaiRencana(false)}
              />
              <span>
                Tidak — <b>harga pasar berubah</b>: isi <b>harga riil per bahan</b> pada
                kolom di tabel atas
              </span>
            </label>
            {realisasi != null && !adaInvalid && (
              <div className="rounded bg-stone-50 px-2 py-1 text-sm text-stone-700">
                Total biaya riil: <b>{formatRupiah(realisasi)}</b>
                <span className="text-stone-400"> · dana faktur {formatRupiah(danaFaktur)}</span>
              </div>
            )}
            {realisasi != null && !adaInvalid && selisih > 0.49 && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-red-700">
                  Kurang {formatRupiah(selisih)} — dari mana uangnya?
                </label>
                <input
                  value={selisihCatatan}
                  onChange={(e) => setSelisihCatatan(e.target.value)}
                  placeholder="mis. talangan kasir Budi / kas toko"
                  aria-label="Sumber dana tambahan"
                  className={`w-full rounded-lg border px-2 py-1 text-sm ${catatanSelisihKosong ? "border-red-400" : "border-stone-300"}`}
                />
              </div>
            )}
            {realisasi != null && !adaInvalid && selisih < -0.49 && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-emerald-700">
                  Lebih {formatRupiah(-selisih)} — di siapa sisa uangnya?
                </label>
                <input
                  value={selisihCatatan}
                  onChange={(e) => setSelisihCatatan(e.target.value)}
                  placeholder="mis. dipegang Budi / dikembalikan ke kas"
                  aria-label="Pemegang sisa dana"
                  className={`w-full rounded-lg border px-2 py-1 text-sm ${catatanSelisihKosong ? "border-red-400" : "border-stone-300"}`}
                />
              </div>
            )}
            {realisasi != null && !adaInvalid && Math.abs(selisih) <= 0.49 && (
              <div className="text-xs text-stone-500">Pas dengan dana faktur — tidak ada selisih.</div>
            )}
          </div>
        )}

        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          <b>{items.length}</b> baris maju → {label}
          {sisaTugas > 0 && (
            <span className="text-amber-700">
              {" "}
              · 📌 {sisaTugas} baris/bagian tetap di tahap sekarang (sisa tugas)
            </span>
          )}
          {danaCair != null && !danaInvalid && (
            <span className="text-emerald-700"> · 💸 dana cair {formatRupiah(danaCair)}</span>
          )}
        </div>

        <ErrorText error={simpan.error} />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button
            onClick={() => simpan.mutate()}
            disabled={
              simpan.isPending ||
              items.length === 0 ||
              adaInvalid ||
              danaInvalid ||
              catatanSelisihKosong
            }
            className={btnPrimary}
          >
            {simpan.isPending ? "Menyimpan…" : `Terapkan (${items.length} baris)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
