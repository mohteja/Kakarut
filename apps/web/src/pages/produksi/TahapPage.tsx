import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { JenisPengadaan, PenyimpananDto } from "@kakarut/shared";
import {
  Card,
  ErrorText,
  PageTitle,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
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
}

/** Data yang dikirim TambahStokPage lewat navigate(..., { state }). */
export interface TahapNavState {
  grup: FakturGroup;
  tipe: JenisPengadaan;
  endpoint: string;
  ke: TahapTujuan;
  /** rute daftar untuk kembali/redirect setelah simpan (mis. /pembelian) */
  kembali: string;
}

/**
 * Halaman (bukan modal) untuk mengubah tahap satu faktur stok masuk. Dibuat
 * halaman penuh agar gestur "geser 2 jari = back" di touchpad tak menutup
 * form dengan tak sengaja — back kembali ke daftar, simpan pun redirect ke
 * daftar. Data grup dikirim lewat router state (tanpa fetch ulang); bila
 * dibuka langsung tanpa state (mis. reload) → balik ke daftar.
 */
export function TahapPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as TahapNavState | null;
  if (!state || !state.grup) {
    return <Navigate to={state?.kembali ?? "/pembelian"} replace />;
  }
  return <TahapForm {...state} navigate={navigate} />;
}

function TahapForm({
  grup,
  tipe,
  endpoint,
  ke,
  kembali,
  navigate,
}: TahapNavState & { navigate: ReturnType<typeof useNavigate> }) {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const { id: branchId } = useCabangData("produksi");
  const { isPro } = useCompanyMode();

  const isWorkOrder = grup.rows.some((r) => r.tujuan_branch_id != null);
  const fakturBranchId = grup.rows[0]?.branch_id ?? branchId ?? "";
  const cabangIniCk =
    cabang.find((b) => b.id === fakturBranchId)?.tipe === "central_kitchen";
  const target = URUTAN_TAHAP[ke];
  const bisaMaju = grup.rows.filter(
    (r) =>
      r.status !== "ditolak" &&
      URUTAN_TAHAP[r.status] < target &&
      !(ke === "dikonfirmasi" && r.tujuan_branch_id != null),
  );
  const dikecualikanTujuan =
    ke === "dikonfirmasi"
      ? grup.rows.filter(
          (r) =>
            r.status !== "ditolak" &&
            URUTAN_TAHAP[r.status] < target &&
            r.tujuan_branch_id != null,
        ).length
      : 0;
  const campuranTujuan =
    tipe === "beli" &&
    grup.rows.some((r) => r.tujuan_branch_id != null) &&
    grup.rows.some((r) => r.tujuan_branch_id == null);
  const [pilih, setPilih] = useState<Record<string, PilihanBaris>>(() =>
    Object.fromEntries(bisaMaju.map((r) => [r.id, { aktif: true, qty: String(r.qty) }])),
  );

  const label =
    tipe === "beli" && isWorkOrder && ke === "menunggu"
      ? "📦 Tiba di CK (semua barang di CK)"
      : (AKSI_TAHAP[tipe].find((a) => a.ke === ke)?.label ?? ke);
  const keStok = ke === "dikonfirmasi";
  const keProses = ke === "dikerjakan";
  const keSelesai = ke === "menunggu";

  const [danaNominal, setDanaNominal] = useState("");
  const [danaManual, setDanaManual] = useState(false);

  // Realisasi biaya saat proses → selesai/Tiba di CK: LANGSUNG input berapa
  // yang benar-benar dibelanjakan (bisa kurang/lebih dari dana faktur). Tak
  // ada lagi konfirmasi "sesuai/tidak"; default mengikuti dana faktur.
  const [belanjaRiil, setBelanjaRiil] = useState("");
  const [belanjaManual, setBelanjaManual] = useState(false);
  const [selisihCatatan, setSelisihCatatan] = useState("");

  const [tujuanCabang, setTujuanCabang] = useState(fakturBranchId || "");
  const [tujuanTempat, setTujuanTempat] = useState("");
  const storageBranch = isWorkOrder ? fakturBranchId : tujuanCabang;
  const { data: tempatTujuan = [] } = useQuery({
    queryKey: ["penyimpanan", storageBranch],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan?branch_id=${storageBranch}`),
    enabled: keSelesai && storageBranch !== "",
  });

  const items = keProses
    ? bisaMaju.map((r) => ({ id: r.id, qty: r.qty }))
    : bisaMaju
        .filter((r) => pilih[r.id]?.aktif)
        .map((r) => ({ id: r.id, qty: Number(pilih[r.id]?.qty) }));
  const adaInvalid =
    !keProses &&
    bisaMaju.some((r) => {
      const p = pilih[r.id];
      if (!p?.aktif) return false;
      const q = Number(p.qty);
      return !Number.isFinite(q) || q <= 0 || q > r.qty + 1e-9;
    });
  const sisaTugas = keProses
    ? 0
    : bisaMaju.filter((r) => {
        const p = pilih[r.id];
        return !p?.aktif || Number(p.qty) < r.qty - 1e-9;
      }).length;

  // Dana cair untuk baris yang meninggalkan tahap RAB (prorata qty maju).
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

  // Dana faktur = yang sudah cair + yang cair bersamaan langkah ini.
  const danaFaktur = grup.danaCair + (danaCair != null && !danaInvalid ? danaCair : 0);
  // Realisasi = total belanja riil (default mengikuti dana faktur).
  const realisasi = keSelesai ? (belanjaManual ? Number(belanjaRiil) : danaFaktur) : null;
  const belanjaInvalid =
    keSelesai && belanjaManual && (!Number.isFinite(realisasi) || (realisasi ?? 0) < 0);
  const selisih = realisasi != null && !belanjaInvalid ? realisasi - danaFaktur : 0;
  const butuhCatatanSelisih =
    realisasi != null && !belanjaInvalid && !adaInvalid && Math.abs(selisih) >= 0.5;
  const catatanSelisihKosong = butuhCatatanSelisih && selisihCatatan.trim().length === 0;

  const simpan = useMutation({
    mutationFn: () =>
      api(`${endpoint}/tahap/${grup.fakturId}`, {
        method: "POST",
        body: {
          ke,
          items,
          ...(danaCair != null ? { dana_cair: danaCair } : {}),
          ...(realisasi != null && !belanjaInvalid
            ? { realisasi, selisih_catatan: selisihCatatan.trim() || null }
            : {}),
          ...(keSelesai && !isWorkOrder && tujuanCabang ? { tujuan_branch_id: tujuanCabang } : {}),
          ...(keSelesai && tujuanTempat ? { tujuan_storage_id: tujuanTempat } : {}),
        },
      }),
    onSuccess: () => {
      for (const key of [endpoint, "stok", "laporan", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      // beli mulai DIPROSES → buka dokumen belanja otomatis di daftar
      const dok = tipe === "beli" && ke === "dikerjakan" ? `?dok=${grup.key}` : "";
      navigate(`${kembali}${dok}`);
    },
  });

  function ubah(r: { id: string }, patch: Partial<PilihanBaris>) {
    setPilih((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...patch } }));
  }

  const rabTotalMaju = bisaMaju.reduce((t, r) => t + (r.total_harga ?? 0), 0);

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <PageTitle
        aksi={
          <button onClick={() => navigate(kembali)} className={btnSecondary}>
            ← Kembali
          </button>
        }
      >
        Ubah tahap → {label}
      </PageTitle>

      <Card className="space-y-3 p-4">
        {keProses ? (
          <p className="text-sm text-stone-500">
            Faktur ditandai <b>sedang diproses</b> — cukup pastikan RAB & catat dana yang cair.
            {tipe === "beli" && (
              <> Rincian bahan + supplier ada di <b>📄 dokumen belanja</b> yang terbuka setelah ini.</>
            )}
          </p>
        ) : (
          <p className="text-sm text-stone-500">
            Centang baris yang benar-benar ikut maju. Bila barang baru sebagian, kecilkan{" "}
            <b>qty maju</b> — sisanya tetap di tahap sekarang sebagai <b>tugas</b> yang masih
            harus dikerjakan.
          </p>
        )}

        {keStok && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠ Baris yang dicentang dianggap <b>benar-benar ada/diterima</b> — stok langsung
            terhitung{tipe === "beli" ? " dan tercatat sebagai pengeluaran" : ""}.
          </div>
        )}
        {dikecualikanTujuan > 0 && (
          <div className="rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-800">
            📦 {dikecualikanTujuan} baris bertujuan cabang tidak ikut di sini — barang itu
            diterima lewat <b>Penerimaan</b> di cabang tujuannya setelah dikirim.
          </div>
        )}

        {bisaMaju.length === 0 ? (
          <div className="py-6 text-center text-sm text-stone-400">
            Tidak ada baris yang bisa dipindah ke tahap ini.
          </div>
        ) : keProses ? (
          <div className="space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Jumlah bahan</span>
              <b>{bisaMaju.length} baris</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Total est. RAB</span>
              <b className="text-base">{formatRupiah(rabTotalMaju)}</b>
            </div>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={thClass}></th>
                  <th className={thClass}>Bahan</th>
                  <th className={`${thClass} hidden sm:table-cell`}>Tahap sekarang</th>
                  <th className={`${thClass} text-right`}>Qty maju</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {bisaMaju.map((r) => {
                  const p = pilih[r.id];
                  const q = Number(p?.qty);
                  const salah = p?.aktif && (!Number.isFinite(q) || q <= 0 || q > r.qty + 1e-9);
                  const sisa = p?.aktif && Number.isFinite(q) ? r.qty - q : r.qty;
                  return (
                    <tr key={r.id} className={p?.aktif ? "" : "opacity-50"}>
                      <td className={tdClass}>
                        <input
                          type="checkbox"
                          checked={p?.aktif ?? false}
                          onChange={(e) => ubah(r, { aktif: e.target.checked })}
                          aria-label={`Ikutkan ${r.bahan}`}
                        />
                      </td>
                      <td className={`${tdClass} font-medium`}>
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
                      </td>
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
              {isWorkOrder
                ? tipe === "beli"
                  ? "📦 Tiba di CK — semua barang disimpan di CK dulu"
                  : "📦 Selesai — disimpan di Central Kitchen"
                : "🚚 Dikirim / disimpan ke mana?"}
            </div>
            {isWorkOrder && (
              <div className="rounded bg-purple-50 px-2 py-1.5 text-xs text-purple-800">
                Barang disimpan dulu di CK. Kirim ke cabang tujuan lewat tombol{" "}
                <b>🚚 Kirim ke cabang</b> — dokumen kirim (surat jalan) dibuat otomatis.
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
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
                  {tempatTujuan.map((tmp) => (
                    <option key={tmp.id} value={tmp.id}>
                      {tmp.nama}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!isWorkOrder && tujuanCabang && fakturBranchId && tujuanCabang !== fakturBranchId && (
              <div className="text-xs text-amber-700">
                Baris yang maju akan <b>berpindah ke cabang tujuan</b> (stok terhitung di sana
                saat diterima); sisa tugas tetap di cabang ini.
              </div>
            )}
            {!isWorkOrder && tujuanCabang === fakturBranchId && cabangIniCk && (
              <div className="text-xs text-stone-500">
                🏭 Ini Central Kitchen — bila barang untuk outlet, pilih cabang 🏪 store sebagai
                tujuan (hanya store yang terhubung ke CK ini yang bisa dipilih).
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
              🧾 Realisasi — berapa yang benar-benar {tipe === "beli" ? "dibelanjakan" : "dikeluarkan"}?
            </div>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>Total {tipe === "beli" ? "belanja" : "biaya"} riil:</span>
              <input
                type="number"
                min="0"
                step="any"
                value={belanjaManual ? belanjaRiil : String(danaFaktur)}
                onChange={(e) => {
                  setBelanjaManual(true);
                  setBelanjaRiil(e.target.value);
                }}
                placeholder="Rp"
                aria-label="Total belanja riil"
                className={`w-40 rounded-lg border px-2 py-1 text-right text-sm ${belanjaInvalid ? "border-red-400" : "border-stone-300"}`}
              />
              <span className="text-xs text-stone-400">dana faktur {formatRupiah(danaFaktur)}</span>
            </label>
            {realisasi != null && !belanjaInvalid && selisih > 0.49 && (
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
            {realisasi != null && !belanjaInvalid && selisih < -0.49 && (
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
            {realisasi != null && !belanjaInvalid && Math.abs(selisih) <= 0.49 && (
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
      </Card>

      {/* Aksi menempel di bawah agar mudah dijangkau di HP */}
      <div className="sticky bottom-0 mt-3 flex justify-end gap-2 border-t border-stone-200 bg-white/95 py-3 backdrop-blur">
        <button onClick={() => navigate(kembali)} className={btnSecondary}>
          Batal
        </button>
        <button
          onClick={() => simpan.mutate()}
          disabled={
            simpan.isPending ||
            items.length === 0 ||
            adaInvalid ||
            danaInvalid ||
            belanjaInvalid ||
            catatanSelisihKosong
          }
          className={btnPrimary}
        >
          {simpan.isPending ? "Menyimpan…" : `Terapkan (${items.length} baris)`}
        </button>
      </div>
    </div>
  );
}
