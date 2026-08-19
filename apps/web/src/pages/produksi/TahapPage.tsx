import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { JenisPengadaan, PenyimpananDto } from "@kakarut/shared";
import { angkaDari, teksAngka } from "@kakarut/shared";
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
import { ApiError, api } from "../../lib/api";
import { formatAngka, formatRupiah, hariIniWIB } from "../../lib/format";
import { useCompanyMode } from "../../lib/useCompanyMode";
import { uuidV4 } from "../../lib/idempoten";
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
  /** exp lot (YYYY-MM-DD) saat masuk stok — otomatis dari masa simpan, boleh diubah */
  exp: string;
}

/**
 * Hari ini + n hari (YYYY-MM-DD).
 *
 * Berjangkar pada `hariIniWIB()`, BUKAN tanggal lokal perangkat. Aritmetika
 * `Date.UTC` memang bebas drift, tapi titik mulainya tetap harus benar: di
 * cabang WITA/WIT (atau perangkat yang zonanya keliru) `new Date().getDate()`
 * bisa menunjuk hari yang berbeda dari hari kerja perusahaan. Angka yang
 * dihasilkan di sini bukan sekadar tampilan — ia jadi `exp` lot yang tersimpan
 * di stok, dan meleset sehari membuat peringatan kedaluwarsa berbunyi pada
 * barang yang sebenarnya masih layak. Seluruh aplikasi memakai satu makna
 * "hari ini" (zona perusahaan); di sini pun harus sama.
 */
function tanggalPlusHari(n: number): string {
  const [th, bl, hr] = hariIniWIB().split("-").map(Number);
  const t = new Date(Date.UTC(th, bl - 1, hr + n));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
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
    Object.fromEntries(
      bisaMaju.map((r) => [
        r.id,
        {
          aktif: true,
          qty: teksAngka(r.qty),
          // exp default: exp yang sudah ada, atau hari ini + masa simpan master
          exp:
            r.exp_date ??
            ((r.masa_simpan_hari ?? 0) > 0 ? tanggalPlusHari(r.masa_simpan_hari!) : ""),
        },
      ]),
    ),
  );

  const label =
    tipe === "beli" && isWorkOrder && ke === "menunggu"
      ? "📦 Tiba di CK (semua barang di CK)"
      : (AKSI_TAHAP[tipe].find((a) => a.ke === ke)?.label ?? ke);
  const keStok = ke === "dikonfirmasi";
  const keProses = ke === "dikerjakan";
  const keSelesai = ke === "menunggu";
  // Realisasi biaya DIHAPUS di kedua jalur: beli hanya mencatat BARANG saat tiba
  // di CK (bukan uang), produksi tak ber-biaya (bahan sudah dibeli di Beli Bahan
  // Baku). Yang tersisa saat "menunggu": tujuan/tempat simpan barang.

  const [danaNominal, setDanaNominal] = useState("");
  const [danaManual, setDanaManual] = useState(false);

  const [tujuanCabang, setTujuanCabang] = useState(fakturBranchId || "");
  const [tujuanTempat, setTujuanTempat] = useState("");
  // Produksi menyimpan hasil di CK (fakturBranchId); beli manual pakai cabang tujuan.
  const storageBranch = isWorkOrder || tipe !== "beli" ? fakturBranchId : tujuanCabang;
  const { data: tempatTujuan = [] } = useQuery({
    queryKey: ["penyimpanan", storageBranch],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan?branch_id=${storageBranch}`),
    enabled: keSelesai && storageBranch !== "",
  });

  // masuk stok (Tiba/Selesai/dikonfirmasi) → sertakan exp per baris bila terisi
  const masukStok = keSelesai || keStok;
  const items = keProses
    ? bisaMaju.map((r) => ({ id: r.id, qty: r.qty }))
    : bisaMaju
        .filter((r) => pilih[r.id]?.aktif)
        .map((r) => ({
          id: r.id,
          qty: angkaDari(pilih[r.id]?.qty),
          ...(masukStok && pilih[r.id]?.exp ? { exp: pilih[r.id].exp } : {}),
        }));
  const adaInvalid =
    !keProses &&
    bisaMaju.some((r) => {
      const p = pilih[r.id];
      if (!p?.aktif) return false;
      const q = angkaDari(p.qty);
      // qty boleh melebihi rencana (kemasan/hasil nyata) — hanya ≤ 0 yang salah
      return !Number.isFinite(q) || q <= 0;
    });
  const sisaTugas = keProses
    ? 0
    : bisaMaju.filter((r) => {
        const p = pilih[r.id];
        return !p?.aktif || angkaDari(p.qty) < r.qty - 1e-9;
      }).length;

  // Dana cair untuk baris yang meninggalkan tahap RAB (prorata qty maju).
  const barisRab = bisaMaju.filter((r) => r.status === "rencana" && pilih[r.id]?.aktif);
  const rabMaju = barisRab.reduce((t, r) => {
    const q = angkaDari(pilih[r.id]?.qty);
    if (!Number.isFinite(q) || q <= 0 || r.total_harga == null) return t;
    // Diskalakan mengikuti qty yang benar-benar diambil — termasuk saat LEBIH
    // dari rencana (beli per kemasan), supaya dana yang disarankan cukup.
    // Rumusnya sama dengan yang dipakai server saat menulis baris.
    return t + Math.round((r.total_harga * q) / r.qty);
  }, 0);
  // Dana cair hanya untuk BELI — produksi tak belanja apa pun, jadi tak ada
  // uang yang dicairkan.
  const tanyaDana = tipe === "beli" && barisRab.length > 0;
  const danaCair = !tanyaDana ? null : danaManual ? angkaDari(danaNominal) : rabMaju;
  const danaInvalid =
    tanyaDana && danaManual && (!Number.isFinite(danaCair) || danaCair! < 0);

  /*
   * IDENTITAS PERMINTAAN, dipegang sampai sukses.
   *
   * `/tahap` tidak bisa dibuat idempoten dari isinya sendiri: "majukan 3 dari
   * baris ini" membaca qty baris apa adanya, dan sesudah pemotongan pertama
   * qty-nya memang sudah berkurang — kiriman kedua cocok lagi lalu memotong
   * lagi. Terukur pada faktur 8 pcs: "terima 3" yang terkirim dua kali menaruh
   * 6 pcs di stok dan menyusutkan sisa tugas belanja dari 5 jadi 2.
   *
   * Jaringan yang putus SESUDAH server menyimpan tapi SEBELUM balasannya
   * sampai adalah cara paling wajar hal itu terjadi: yang menekan tombol
   * melihat galat, lalu menekan lagi.
   *
   * `??=` — ref yang SAMA dipakai ulang untuk percobaan `paksa` sesudah
   * peringatan "bahan kurang". Itu benar: percobaan yang ditolak melepaskan
   * klaimnya di server (transaksinya rollback), jadi percobaan berikutnya
   * benar-benar dieksekusi; tapi bila yang pertama ternyata SUKSES dan cuma
   * balasannya yang hilang, yang kedua memulangkan hasil pertama alih-alih
   * mengeksekusi ulang.
   */
  const refTahap = useRef<string | null>(null);

  const simpan = useMutation({
    mutationFn: (opts?: { paksa?: boolean }) =>
      api(`${endpoint}/tahap/${grup.fakturId}`, {
        method: "POST",
        body: {
          client_ref: (refTahap.current ??= uuidV4()),
          ke,
          items,
          ...(opts?.paksa ? { paksa: true } : {}),
          ...(danaCair != null ? { dana_cair: danaCair } : {}),
          // Produksi selesai TIDAK dikirim ke cabang — hasil disimpan dulu di CK
          // (tujuan_branch_id tak dikirim); cukup pilih tempat simpan (opsional).
          ...(keSelesai && !isWorkOrder && tipe === "beli" && tujuanCabang
            ? { tujuan_branch_id: tujuanCabang }
            : {}),
          ...(keSelesai && tujuanTempat ? { tujuan_storage_id: tujuanTempat } : {}),
        },
      }),
    onSuccess: () => {
      // Sukses → permintaan berikutnya adalah permintaan BARU, bukan ulangan.
      refTahap.current = null;
      for (const key of [endpoint, "stok", "laporan", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      // beli mulai DIPROSES → buka dokumen belanja otomatis di daftar
      const dok = tipe === "beli" && ke === "dikerjakan" ? `?dok=${grup.key}` : "";
      navigate(`${kembali}${dok}`);
    },
  });

  /*
   * `/tahap` menolak dengan 409 untuk TIGA hal yang sangat berbeda, dan hanya
   * SATU di antaranya boleh dilanjutkan:
   *
   *   - `bahan_kurang`      → peringatan; tombol "tetap proses" (`paksa`) sah;
   *   - `status_berubah`    → faktur diubah orang lain; yang benar MUAT ULANG,
   *                           dan `paksa` tak akan menolong (server tetap CAS);
   *   - `wajib_penerimaan`  → barang harus diterima di cabang tujuan; tak ada
   *                           jalan dari layar ini sama sekali.
   *
   * Dulu SEMUA 409 ditampilkan sebagai "bahan kurang" lengkap dengan tombol
   * lanjut — jadi pada konflik status, kasir ditawari tombol yang tak mungkin
   * berhasil, sementara instruksi sebenarnya terkubur di teks pesan.
   *
   * Dicocokkan lewat `sebab`, bukan teks: teksnya boleh berubah kapan saja.
   */
  const sebab409 =
    simpan.error instanceof ApiError && simpan.error.status === 409
      ? (simpan.error.data?.sebab as string | undefined)
      : undefined;
  const bahanKurang =
    sebab409 === "bahan_kurang" ? (simpan.error as ApiError).message : null;
  // Sebab 409 yang LAIN jatuh ke `<ErrorText>` di bawah — galat biasa, tanpa
  // tombol "tetap proses" yang tak mungkin berhasil.

  function ubah(r: { id: string }, patch: Partial<PilihanBaris>) {
    setPilih((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...patch } }));
  }

  const rabTotalMaju = bisaMaju.reduce((t, r) => t + (r.total_harga ?? 0), 0);

  // Pratinjau penyimpanan per RAK saat barang tiba/disimpan di CK: tiap bahan
  // otomatis masuk rak default (home)-nya; belum diatur → "Tanpa tempat".
  const barisMajuAktif = bisaMaju.filter((r) => pilih[r.id]?.aktif);
  const rakGroups = (() => {
    const m = new Map<string, { nama: string; rows: typeof barisMajuAktif }>();
    for (const r of barisMajuAktif) {
      const key = r.default_storage_location_id ?? "__none";
      const nama = r.default_tempat ?? "Tanpa tempat";
      const g = m.get(key) ?? { nama, rows: [] };
      g.rows.push(r);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) =>
      a.nama === "Tanpa tempat" ? 1 : b.nama === "Tanpa tempat" ? -1 : a.nama.localeCompare(b.nama),
    );
  })();

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
            {tipe === "beli" ? (
              <>
                Faktur ditandai <b>sedang diproses</b> — cukup pastikan RAB & catat dana yang cair.
                Rincian bahan + supplier ada di <b>📄 dokumen belanja</b> yang terbuka setelah ini.
              </>
            ) : (
              <>
                Faktur ditandai <b>mulai dikerjakan</b> — bahan mentah resep dipakai saat produksi
                selesai. (Produksi tak ber-RAB; bahan sudah dibeli di Beli Bahan Baku.)
              </>
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
            {/* RAB hanya untuk beli — produksi tak menampilkan biaya. */}
            {tipe === "beli" && (
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Total est. RAB</span>
                <b className="text-base">{formatRupiah(rabTotalMaju)}</b>
              </div>
            )}
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
                  const q = angkaDari(p?.qty);
                  // RAB itu RENCANA, bukan pagu: qty realisasi boleh LEBIH
                  // (sayur direncanakan 900 gr tapi hanya dijual per kilo → beli
                  // 1.000) maupun KURANG. Yang salah hanya qty ≤ 0/kosong.
                  const salah = p?.aktif && (!Number.isFinite(q) || q <= 0);
                  const sisa = p?.aktif && Number.isFinite(q) ? r.qty - q : r.qty;
                  const lebih = p?.aktif && Number.isFinite(q) ? q - r.qty : 0;
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
                            /* Qty barang: pecahan normal ("1,5" kg) dan koma
                               adalah pemisah desimal bahasa Indonesia.
                               `type="number"` MEMBUANG koma saat diketik —
                               "1,5" jadi "15" tanpa `badInput`. */
                            type="text"
                            inputMode="decimal"
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
                        {lebih > 1e-9 && !salah && (
                          <div className="text-right text-[11px] text-sky-700">
                            lebih {formatAngka(lebih)} {r.satuan} dari rencana — dicatat apa adanya
                          </div>
                        )}
                        {salah && (
                          <div className="text-right text-[11px] text-red-600">
                            qty harus lebih dari 0
                          </div>
                        )}
                        {masukStok && p?.aktif && (
                          <div className="mt-1 flex items-center justify-end gap-1">
                            <span className="text-[10px] text-stone-400">exp</span>
                            <input
                              type="date"
                              value={p?.exp ?? ""}
                              onChange={(e) => ubah(r, { exp: e.target.value })}
                              aria-label={`Exp ${r.bahan}`}
                              title="Tanggal kedaluwarsa lot — otomatis dari masa simpan bahan, boleh diubah (baca dari kemasan). Kosong = tanpa exp."
                              className="rounded-lg border border-stone-300 px-1.5 py-0.5 text-xs"
                            />
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
              {tipe !== "beli"
                ? cabangIniCk
                  ? "📦 Disimpan di Central Kitchen — pilih tempat"
                  : "📦 Disimpan di cabang ini — pilih tempat"
                : isWorkOrder
                  ? "📦 Tiba di CK — semua barang disimpan di CK dulu"
                  : "🚚 Dikirim / disimpan ke mana?"}
            </div>
            {tipe !== "beli" ? (
              /* PRODUKSI SELESAI: hasil disimpan di cabang faktur (CK maupun toko
                 kitchen). Tak ada realisasi biaya (bahan sudah dibeli di Beli Bahan
                 Baku). User cukup PILIH tempat simpan. */
              <>
                <div className="rounded bg-purple-50 px-2 py-1.5 text-xs text-purple-800">
                  {cabangIniCk ? (
                    <>
                      Hasil produksi <b>langsung masuk stok CK</b> — tanpa konfirmasi lagi (orang
                      CK yang produksi). Kirim ke cabang lewat <b>🚚 Kirim ke cabang</b> /
                      Permintaan Stok setelah ini; di cabang barang <b>wajib diterima</b>.
                    </>
                  ) : (
                    <>
                      Hasil produksi <b>langsung masuk stok cabang ini</b> — tanpa konfirmasi &
                      tanpa lewat CK (kitchen/bar cabang yang produksi).
                    </>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-stone-500">
                    Tempat penyimpanan di {cabangIniCk ? "CK" : "cabang"} (opsional)
                  </label>
                  <select
                    value={tujuanTempat}
                    onChange={(e) => setTujuanTempat(e.target.value)}
                    aria-label="Tempat penyimpanan hasil produksi"
                    className={inputClass}
                  >
                    <option value="">— tanpa tempat / rak default tiap hasil —</option>
                    {tempatTujuan.map((tmp) => (
                      <option key={tmp.id} value={tmp.id}>
                        {tmp.nama}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-stone-400">
                    Pilih satu rak untuk semua hasil, atau kosongkan → tiap hasil masuk rak
                    default-nya (atur di <b>Stok → Tempat Penyimpanan</b>); belum diatur → tanpa tempat.
                  </div>
                </div>
              </>
            ) : isWorkOrder ? (
              /* BELI tiba di CK — penyimpanan OTOMATIS per rak (rak default tiap bahan).
                 "Selesai belanja" langsung terlihat isi tiap rak & berapa. */
              <>
                <div className="rounded bg-purple-50 px-2 py-1.5 text-xs text-purple-800">
                  Barang disimpan dulu di CK. Kirim ke cabang tujuan lewat tombol{" "}
                  <b>🚚 Kirim ke cabang</b> — dokumen kirim (surat jalan) dibuat otomatis.
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-stone-500">
                    Disimpan otomatis per rak (dari rak default tiap bahan):
                  </div>
                  {rakGroups.length === 0 ? (
                    <div className="text-xs text-stone-400">Centang baris dulu.</div>
                  ) : (
                    rakGroups.map((g, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5"
                      >
                        <div className="text-sm font-semibold text-stone-700">
                          {g.nama === "Tanpa tempat" ? "📦 Di CK tanpa tempat" : `🗄 ${g.nama}`}
                          <span className="ml-1 text-xs font-normal text-stone-400">
                            ({g.rows.length} bahan)
                          </span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {g.rows
                            .map(
                              (r) =>
                                `${r.bahan} (${formatAngka(angkaDari(pilih[r.id]?.qty) || r.qty)} ${r.satuan})${
                                  pilih[r.id]?.exp ? ` · ⏳ ${pilih[r.id].exp}` : ""
                                }`,
                            )
                            .join(" · ")}
                        </div>
                      </div>
                    ))
                  )}
                  <div className="text-[11px] text-stone-400">
                    Atur rak default tiap bahan di <b>Stok → Tempat Penyimpanan</b> (pilih cabang CK,
                    lalu bahan per rak). Belum diatur → di CK tanpa tempat.
                  </div>
                </div>
              </>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {isPro && (
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
                    Tempat penyimpanan (opsional)
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
            )}
            {tipe === "beli" &&
              !isWorkOrder &&
              tujuanCabang &&
              fakturBranchId &&
              tujuanCabang !== fakturBranchId && (
                <div className="text-xs text-amber-700">
                  Baris yang maju akan <b>berpindah ke cabang tujuan</b> (stok terhitung di sana
                  saat diterima); sisa tugas tetap di cabang ini.
                </div>
              )}
            {tipe === "beli" && !isWorkOrder && tujuanCabang === fakturBranchId && cabangIniCk && (
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
                /* Nominal uang. `type="number"` menyimpan "1.500.000" apa
                   adanya dan `Number` membacanya 1,5 — dana cair Rp 1,5 juta
                   tercatat Rp 1,5. `angkaDari` membaca kedua bentuk. */
                type="text"
                inputMode="decimal"
                value={danaManual ? danaNominal : teksAngka(rabMaju)}
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

        {bahanKurang ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <b>⚠️ {bahanKurang}</b>
            <div className="mt-1 text-xs text-amber-700">
              Anda tetap bisa memproses — pastikan bahan baku menyusul / dikoreksi.
            </div>
          </div>
        ) : (
          <ErrorText error={simpan.error} />
        )}
      </Card>

      {/* Aksi menempel di bawah agar mudah dijangkau di HP */}
      <div className="sticky bottom-0 mt-3 flex justify-end gap-2 border-t border-stone-200 bg-white/95 py-3 backdrop-blur">
        <button onClick={() => navigate(kembali)} className={btnSecondary}>
          Batal
        </button>
        <button
          onClick={() => simpan.mutate({ paksa: !!bahanKurang })}
          disabled={simpan.isPending || items.length === 0 || adaInvalid || danaInvalid}
          className={bahanKurang ? btnPrimary + " !bg-amber-600 hover:!bg-amber-700" : btnPrimary}
        >
          {simpan.isPending
            ? "Menyimpan…"
            : bahanKurang
              ? "Tetap Proses"
              : `Terapkan (${items.length} baris)`}
        </button>
      </div>
    </div>
  );
}
