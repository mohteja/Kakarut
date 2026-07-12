import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { JenisPengadaan } from "@kakarut/shared";
import { ErrorText, Modal, btnPrimary, btnSecondary, tdClass, thClass } from "../../components/ui";
import { api } from "../../lib/api";
import { formatAngka, formatRupiah } from "../../lib/format";
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
}: {
  grup: FakturGroup;
  tipe: JenisPengadaan;
  endpoint: string;
  ke: TahapTujuan;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const target = URUTAN_TAHAP[ke];
  // hanya baris yang tahapnya masih di belakang tujuan yang bisa maju
  const bisaMaju = grup.rows.filter(
    (r) => r.status !== "ditolak" && URUTAN_TAHAP[r.status] < target,
  );
  const [pilih, setPilih] = useState<Record<string, PilihanBaris>>(() =>
    Object.fromEntries(bisaMaju.map((r) => [r.id, { aktif: true, qty: String(r.qty) }])),
  );

  const label = AKSI_TAHAP[tipe].find((a) => a.ke === ke)?.label ?? ke;
  const keStok = ke === "dikonfirmasi";
  // RAB → diproses hanya INFO (dan pencatatan dana cair) — jumlah barang belum
  // berubah; penyesuaian barang dilakukan saat proses → selesai.
  const keProses = ke === "dikerjakan";
  const keSelesai = ke === "menunggu";

  // Dana cair: ditanyakan saat ada baris terpilih yang MENINGGALKAN tahap RAB
  // — cair penuh sesuai RAB bagian yang maju, atau sebagian (input nominal).
  const [danaMode, setDanaMode] = useState<"penuh" | "sebagian">("penuh");
  const [danaNominal, setDanaNominal] = useState("");

  // Realisasi biaya saat proses → selesai: sesuai rencana, atau tidak —
  // selisihnya wajib dijelaskan (kurang: dari mana; lebih: di siapa).
  const [sesuaiRencana, setSesuaiRencana] = useState(true);
  const [realisasiTeks, setRealisasiTeks] = useState("");
  const [selisihCatatan, setSelisihCatatan] = useState("");

  // Tahap "diproses": semua baris ikut penuh (read-only). Tahap lain: sesuai
  // centang + qty maju yang diisi.
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
  const danaCair = !tanyaDana
    ? null
    : danaMode === "penuh"
      ? rabMaju
      : Number(danaNominal);
  const danaInvalid =
    tanyaDana && danaMode === "sebagian" && (!Number.isFinite(danaCair) || danaCair! < 0);

  // Realisasi vs dana faktur (termasuk pencairan yang dikirim bersamaan):
  // kurang → wajib jelaskan dari mana uangnya; lebih → di siapa sisa uangnya.
  const danaFaktur = grup.danaCair + (danaCair != null && !danaInvalid ? danaCair : 0);
  const realisasi = keSelesai && !sesuaiRencana ? Number(realisasiTeks) : null;
  const realisasiInvalid =
    realisasi != null && (!Number.isFinite(realisasi) || realisasi < 0);
  const selisih = realisasi != null && !realisasiInvalid ? realisasi - danaFaktur : 0;
  const butuhCatatanSelisih =
    realisasi != null && !realisasiInvalid && Math.abs(selisih) >= 0.5;
  const catatanSelisihKosong = butuhCatatanSelisih && selisihCatatan.trim().length === 0;

  const simpan = useMutation({
    mutationFn: () =>
      api(`${endpoint}/tahap/${grup.fakturId}`, {
        method: "POST",
        body: {
          ke,
          items,
          ...(danaCair != null ? { dana_cair: danaCair } : {}),
          ...(realisasi != null && !realisasiInvalid
            ? { realisasi, selisih_catatan: selisihCatatan.trim() || null }
            : {}),
        },
      }),
    onSuccess: () => {
      for (const key of [endpoint, "stok", "laporan", "rekomendasi"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });

  function ubah(id: string, patch: Partial<PilihanBaris>) {
    setPilih((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  return (
    <Modal open onClose={onClose} title={`Ubah tahap → ${label}`}>
      <div className="space-y-3">
        {keProses ? (
          <p className="text-sm text-stone-500">
            Faktur ditandai <b>sedang diproses</b> — jumlah barang <b>belum berubah</b>,
            hanya info proses + pencatatan dana yang cair. Penyesuaian barang dilakukan
            nanti saat proses → selesai.
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
        ) : (
          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  {!keProses && <th className={thClass}></th>}
                  <th className={thClass}>Bahan</th>
                  <th className={thClass}>Tahap sekarang</th>
                  <th className={`${thClass} text-right`}>{keProses ? "Qty" : "Qty maju"}</th>
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
                            onChange={(e) => ubah(r.id, { aktif: e.target.checked })}
                            aria-label={`Ikutkan ${r.bahan}`}
                          />
                        </td>
                      )}
                      <td className={`${tdClass} font-medium`}>{r.bahan}</td>
                      <td className={tdClass}>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeFaktur(tipe, r.status).cls}`}
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
                                onChange={(e) => ubah(r.id, { qty: e.target.value })}
                                aria-label={`Qty maju ${r.bahan}`}
                                className={`w-24 rounded-lg border px-2 py-1 text-right ${salah ? "border-red-400" : "border-stone-300"}`}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tanyaDana && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="text-sm font-semibold text-stone-700">
              💸 Dana cair untuk baris dari tahap RAB
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="dana-cair"
                checked={danaMode === "penuh"}
                onChange={() => setDanaMode("penuh")}
              />
              <span>
                Cair <b>penuh sesuai RAB</b> — {formatRupiah(rabMaju)}
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="dana-cair"
                checked={danaMode === "sebagian"}
                onChange={() => setDanaMode("sebagian")}
              />
              <span>Cair sebagian — nominal:</span>
              <input
                type="number"
                min="0"
                step="any"
                value={danaNominal}
                onFocus={() => setDanaMode("sebagian")}
                onChange={(e) => setDanaNominal(e.target.value)}
                placeholder="Rp"
                aria-label="Nominal dana cair"
                className={`w-36 rounded-lg border px-2 py-1 text-right text-sm ${danaInvalid ? "border-red-400" : "border-stone-300"}`}
              />
            </label>
            {danaMode === "sebagian" &&
              !danaInvalid &&
              danaCair != null &&
              danaCair < rabMaju && (
                <div className="text-xs text-amber-700">
                  Kurang {formatRupiah(rabMaju - danaCair)} dari RAB — sisa kebutuhan dana
                  tercatat di faktur.
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
              <span>Tidak — biaya riil:</span>
              <input
                type="number"
                min="0"
                step="any"
                value={realisasiTeks}
                onFocus={() => setSesuaiRencana(false)}
                onChange={(e) => setRealisasiTeks(e.target.value)}
                placeholder="Rp"
                aria-label="Biaya riil realisasi"
                className={`w-36 rounded-lg border px-2 py-1 text-right text-sm ${realisasiInvalid ? "border-red-400" : "border-stone-300"}`}
              />
            </label>
            {realisasi != null && !realisasiInvalid && selisih > 0.49 && (
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
            {realisasi != null && !realisasiInvalid && selisih < -0.49 && (
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
            {realisasi != null && !realisasiInvalid && Math.abs(selisih) <= 0.49 && (
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
              realisasiInvalid ||
              catatanSelisihKosong ||
              (keSelesai && !sesuaiRencana && realisasiTeks.trim() === "")
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
