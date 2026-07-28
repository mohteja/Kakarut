import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ShiftDetail } from "@kakarut/shared";
import { ErrorText, Modal, Spinner, btnPrimary, btnSecondary, inputClass, thClass, tdClass } from "./ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatRupiah, formatTanggalRingkas, formatWaktu } from "../lib/format";

/** Label + warna selisih kas (fisik − seharusnya). */
function selisihInfo(selisih: number | null) {
  if (selisih == null) return { label: "—", warna: "text-stone-500" };
  if (Math.abs(selisih) < 0.005) return { label: "Pas", warna: "text-green-600" };
  if (selisih < 0) return { label: `Kurang ${formatRupiah(-selisih)}`, warna: "text-red-600" };
  return { label: `Lebih ${formatRupiah(selisih)}`, warna: "text-amber-600" };
}

/** Rupiah yang menghormati hitung buta: `null` dari server = sengaja ditutup. */
function rp(n: number | null) {
  return n == null ? "•••" : formatRupiah(n);
}

const METODE_LABEL: Record<string, string> = {
  tunai: "Tunai",
  qris: "QRIS",
  transfer: "Transfer",
  kartu: "Kartu",
  edc: "EDC",
};

function Baris({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 font-bold ${warna}`}>{value}</div>
    </div>
  );
}

/**
 * Detail satu shift kas: siapa buka & tutup, waktu, rekap penjualan, selisih
 * kas, dan daftar transaksi di jendela shift. Dipakai kasir (Tutup Kasir) &
 * owner/admin (Operasional Cabang).
 */
export function ShiftDetailModal({ shiftId, onClose }: { shiftId: string | null; onClose: () => void }) {
  const { auth } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["shift-detail", shiftId],
    queryFn: () => api<ShiftDetail>(`/shift/${shiftId}`),
    enabled: !!shiftId,
  });

  const info = data ? selisihInfo(data.selisih) : null;
  // Hanya owner/admin yang memutuskan selisih — kasir tak bisa meng-ACC dirinya
  // sendiri (server juga menegakkannya, ini sekadar tak menampilkan tombolnya).
  const bisaAcc = auth?.user?.role === "owner" || auth?.user?.role === "admin";
  const [alasan, setAlasan] = useState("");
  const putuskan = useMutation({
    mutationFn: (status: "disetujui" | "ditolak") =>
      api(`/shift/${shiftId}/selisih/putuskan`, {
        method: "POST",
        body: { status, alasan_tolak: alasan.trim() || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-detail", shiftId] });
      qc.invalidateQueries({ queryKey: ["shift-riwayat"] });
      qc.invalidateQueries({ queryKey: ["shift-selisih"] });
      setAlasan("");
    },
  });

  return (
    <Modal open={!!shiftId} onClose={onClose} title="Detail Shift Kas" lebar="max-w-2xl">
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {/* Status + cabang */}
          <div className="flex flex-wrap items-center gap-2">
            {data.ditutup_pada ? (
              <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-700">
                Ditutup
              </span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Terbuka
              </span>
            )}
            {data.branch_nama && (
              <span className="text-sm font-medium text-stone-600">📍 {data.branch_nama}</span>
            )}
          </div>

          {/* Siapa buka & tutup */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-stone-200 p-3">
              <div className="text-xs text-stone-500">🔓 Dibuka oleh</div>
              <div className="font-semibold text-stone-800">{data.dibuka_oleh || "—"}</div>
              <div className="text-xs text-stone-500">
                {formatTanggalRingkas(data.dibuka_pada)} · {formatWaktu(data.dibuka_pada)}
              </div>
            </div>
            <div className="rounded-lg border border-stone-200 p-3">
              <div className="text-xs text-stone-500">🔒 Ditutup oleh</div>
              <div className="font-semibold text-stone-800">{data.ditutup_oleh || "—"}</div>
              <div className="text-xs text-stone-500">
                {data.ditutup_pada
                  ? `${formatTanggalRingkas(data.ditutup_pada)} · ${formatWaktu(data.ditutup_pada)}`
                  : "masih berjalan"}
              </div>
            </div>
          </div>

          {/* Rekap kas */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Baris label="Modal awal" value={formatRupiah(data.modal_awal)} />
            {/* "•••" = hitung buta: shift masih terbuka, hitungan belum
                dikunci, dan yang melihat kasir */}
            <Baris label="Penjualan tunai" value={rp(data.penjualan_tunai)} />
            <Baris label="Non-tunai" value={formatRupiah(data.penjualan_nontunai)} />
            <Baris label="Transaksi" value={`${data.jumlah_transaksi}×`} />
            <Baris label="Kas seharusnya" value={rp(data.kas_sistem)} warna="text-orange-600" />
            <Baris
              label="Uang fisik"
              value={data.uang_fisik != null ? formatRupiah(data.uang_fisik) : "—"}
            />
          </div>
          {info && (
            <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
              <span className="text-stone-600">Selisih kas (fisik − seharusnya)</span>
              <span className={`font-bold ${info.warna}`}>{info.label}</span>
            </div>
          )}
          {data.catatan && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              📝 {data.catatan}
            </div>
          )}

          {data.hitungan_dikunci_pada && (
            <div className="text-xs text-stone-500">
              🔐 Hitungan dikunci {formatWaktu(data.hitungan_dikunci_pada)} — nominal fisik
              ditetapkan sebelum kas seharusnya terlihat.
            </div>
          )}

          {/* PERSETUJUAN SELISIH KAS — hanya muncul bila memang ada selisih */}
          {data.status_selisih === "menunggu" && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="text-sm font-semibold text-amber-900">
                ⏳ Selisih kas menunggu keputusan
              </div>
              {data.selisih_alasan && (
                <div className="text-sm text-amber-800">
                  Keterangan kasir: <i>{data.selisih_alasan}</i>
                </div>
              )}
              {bisaAcc ? (
                <>
                  <input
                    value={alasan}
                    onChange={(e) => setAlasan(e.target.value)}
                    placeholder="alasan (wajib bila menolak)"
                    className={inputClass}
                  />
                  <ErrorText error={putuskan.error} />
                  <div className="flex gap-2">
                    <button
                      onClick={() => putuskan.mutate("disetujui")}
                      disabled={putuskan.isPending}
                      className={btnPrimary}
                    >
                      ✅ Terima selisih
                    </button>
                    <button
                      onClick={() => putuskan.mutate("ditolak")}
                      disabled={putuskan.isPending}
                      className={btnSecondary}
                    >
                      ✖ Tolak
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-amber-700">
                  Menunggu owner memutuskan — tak ada yang perlu Anda lakukan.
                </div>
              )}
            </div>
          )}
          {data.status_selisih === "disetujui" && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              ✅ Selisih <b>diterima</b>
              {data.selisih_disetujui_oleh ? ` oleh ${data.selisih_disetujui_oleh}` : ""}
              {data.selisih_diputus_pada
                ? ` · ${formatTanggalRingkas(data.selisih_diputus_pada)}`
                : ""}
            </div>
          )}
          {data.status_selisih === "ditolak" && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              ✖ Selisih <b>ditolak</b>
              {data.selisih_disetujui_oleh ? ` oleh ${data.selisih_disetujui_oleh}` : ""}
              {data.alasan_tolak ? ` — ${data.alasan_tolak}` : ""}
              <div className="mt-1 text-xs text-red-700">
                Shift tetap tertutup dan angkanya tidak diubah — penolakan adalah penanda
                untuk ditindaklanjuti di luar aplikasi.
              </div>
            </div>
          )}

          {/* Daftar transaksi di jendela shift */}
          <div>
            <div className="mb-1 text-sm font-semibold text-stone-700">
              Transaksi ({data.transaksi.length})
            </div>
            {data.transaksi.length === 0 ? (
              <div className="rounded-lg border border-stone-200 p-4 text-center text-sm text-stone-400">
                Belum ada transaksi pada shift ini.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-stone-200">
                <table className="w-full">
                  <thead className="sticky top-0 bg-stone-50">
                    <tr>
                      <th className={thClass}>Nomor</th>
                      <th className={thClass}>Jam</th>
                      <th className={thClass}>Kasir</th>
                      <th className={thClass}>Metode</th>
                      <th className={`${thClass} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.transaksi.map((t) => (
                      <tr key={t.id} className={t.susulan ? "bg-amber-50/60" : undefined}>
                        <td className={tdClass}>
                          {t.nomor}
                          {t.susulan && (
                            <span
                              className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                              title="Masuk lewat sinkron SETELAH shift ditutup — inilah yang membuat rekap terkini berbeda dari angka penutupan"
                            >
                              susulan
                            </span>
                          )}
                        </td>
                        <td className={tdClass}>{formatWaktu(t.waktu)}</td>
                        <td className={tdClass}>{t.kasir ?? "—"}</td>
                        <td className={tdClass}>{METODE_LABEL[t.metode] ?? t.metode}</td>
                        <td className={`${tdClass} text-right font-medium`}>{formatRupiah(t.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
