import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { angkaDari, teksAngka, type GajiPeriodeDetailDto, type GajiSlipDetailDto, type GajiSlipRow } from "@kakarut/shared";
import { SlipGajiModal } from "../../components/SlipGajiModal";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  SpinnerAtauGalat,
  btnPrimary,
  btnSecondary,
  inputClass,
  tdClass,
  thClass,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggal } from "../../lib/format";
import { buatCsvGaji, namaBerkasGaji } from "../../lib/gajiCsv";
import { unduhCsv } from "../../lib/unduh";
import { NavGaji, TandaStatusGaji } from "./PeriodeGajiPage";

/**
 * DETAIL PERIODE GAJI — tabel per karyawan. Draft: bonus/penyesuaian bisa
 * diubah, hitung ulang, finalkan. Final: tandai dibayar (owner bisa membuka
 * lagi). Angka dari server; layar tak menghitung gaji sendiri.
 */
export function DetailPeriodeGajiPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const isOwner = auth?.user.role === "owner";
  const kunci = ["gaji", "periode", id];
  const { data, error, refetch } = useQuery({
    queryKey: kunci,
    queryFn: () => api<GajiPeriodeDetailDto>(`/gaji/periode/${id}`),
  });
  const [slipLihat, setSlipLihat] = useState<string | null>(null);
  const [slipUbah, setSlipUbah] = useState<GajiSlipRow | null>(null);

  const aksi = useMutation({
    mutationFn: (jalan: "hitung-ulang" | "final" | "dibayar" | "buka") =>
      api<GajiPeriodeDetailDto>(`/gaji/periode/${id}/${jalan}`, { method: "POST", body: {} }),
    onSuccess: (d) => {
      qc.setQueryData(kunci, d);
      qc.invalidateQueries({ queryKey: ["gaji"] });
    },
  });
  const hapus = useMutation({
    mutationFn: () => api(`/gaji/periode/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gaji"] });
      navigate("/gaji");
    },
  });

  if (!data) {
    return (
      <div className="max-w-6xl">
        <PageTitle aksi={<NavGaji />}>Periode Gaji</PageTitle>
        <SpinnerAtauGalat error={error} apa="Periode gaji" onCoba={() => refetch()} />
      </div>
    );
  }
  const p = data.periode;
  const draft = p.status === "draft";

  function konfirmasi(jalan: "final" | "dibayar" | "buka", pesan: string) {
    if (confirm(pesan)) aksi.mutate(jalan);
  }

  return (
    <div className="max-w-6xl">
      <PageTitle aksi={<NavGaji />}>
        Periode {formatTanggal(p.mulai)} – {formatTanggal(p.selesai)}
      </PageTitle>
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <TandaStatusGaji status={p.status} />
          <div className="mt-1 text-2xl font-bold text-stone-800" data-testid="total-periode-gaji">
            {formatRupiah(p.total)}
          </div>
          <div className="text-xs text-stone-500">{p.jumlah_slip} karyawan</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && (
            <>
              <button type="button" className={btnSecondary} disabled={aksi.isPending} onClick={() => aksi.mutate("hitung-ulang")}>
                🔄 Hitung ulang
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={aksi.isPending}
                onClick={() =>
                  konfirmasi("final", "Finalkan periode ini? Angka dikunci, cicilan kasbon tercatat, dan karyawan bisa melihat slipnya.")
                }
              >
                ✅ Finalkan
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={hapus.isPending}
                onClick={() => confirm("Hapus periode draft ini?") && hapus.mutate()}
              >
                🗑 Hapus
              </button>
            </>
          )}
          {p.status === "final" && (
            <>
              <button
                type="button"
                className={btnPrimary}
                disabled={aksi.isPending}
                onClick={() => konfirmasi("dibayar", "Tandai periode ini sudah dibayar?")}
              >
                💰 Tandai dibayar
              </button>
              {isOwner && (
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={aksi.isPending}
                  onClick={() => konfirmasi("buka", "Buka kembali jadi draft? Potongan kasbon periode ini dibatalkan.")}
                >
                  ↩ Buka lagi
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className={btnSecondary}
            onClick={() => unduhCsv(namaBerkasGaji(p), buatCsvGaji(data.slip))}
          >
            ⬇ CSV
          </button>
        </div>
      </Card>
      <ErrorText error={aksi.error ?? hapus.error} />
      {p.status === "final" && (
        <p className="mb-3 text-sm text-stone-600">
          Angka sudah dikunci dan slip sudah bisa dilihat karyawan di Profil mereka.
        </p>
      )}
      {data.tanpa_setelan.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="tanpa-setelan">
          Belum diatur gajinya (tak ikut dihitung): {data.tanpa_setelan.map((k) => k.nama).join(", ")}.{" "}
          <Link to="/gaji/karyawan" className="underline">
            Atur sekarang
          </Link>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1080px]">
          <thead>
            <tr className="border-b border-stone-200">
              <th className={thClass}>Karyawan</th>
              <th className={`${thClass} text-right`}>Hadir</th>
              <th className={`${thClass} text-right`}>Alpa</th>
              <th className={`${thClass} text-right`}>Telat</th>
              <th className={`${thClass} text-right`}>Pokok</th>
              <th className={`${thClass} text-right`}>Tunjangan</th>
              <th className={`${thClass} text-right`}>Lembur</th>
              <th className={`${thClass} text-right`}>Bonus</th>
              <th className={`${thClass} text-right`}>Penyesuaian</th>
              <th className={`${thClass} text-right`}>Potongan</th>
              <th className={`${thClass} text-right`}>Kasbon</th>
              <th className={`${thClass} text-right`}>Total</th>
              <th className={thClass} />
            </tr>
          </thead>
          <tbody>
            {data.slip.map((s) => (
              <tr key={s.id} className="border-b border-stone-100" data-testid="baris-slip-gaji">
                <td className={tdClass}>
                  <div className="font-medium text-stone-800">{s.nama}</div>
                  <div className="text-xs text-stone-500">
                    {s.dasar === "bulanan" ? "Bulanan" : "Harian"}
                    {s.lupa_pulang > 0 && ` · ${s.lupa_pulang}× lupa absen pulang`}
                  </div>
                </td>
                <td className={`${tdClass} text-right`}>{s.hadir}</td>
                <td className={`${tdClass} text-right`}>{s.alpa}</td>
                <td className={`${tdClass} text-right`}>{s.telat_kali}</td>
                <td className={`${tdClass} text-right`}>{formatRupiah(s.gaji_pokok)}</td>
                <td className={`${tdClass} text-right`}>{formatRupiah(s.tunjangan_total)}</td>
                <td className={`${tdClass} text-right`}>{formatRupiah(s.upah_lembur)}</td>
                <td className={`${tdClass} text-right`}>{formatRupiah(s.bonus)}</td>
                <td className={`${tdClass} text-right`}>{formatRupiah(s.penyesuaian)}</td>
                <td className={`${tdClass} text-right text-red-600`}>{formatRupiah(s.potongan)}</td>
                <td className={`${tdClass} text-right text-red-600`}>{formatRupiah(s.potongan_kasbon)}</td>
                <td className={`${tdClass} text-right font-bold`}>{formatRupiah(s.total)}</td>
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  {draft && (
                    <button type="button" onClick={() => setSlipUbah(s)} className="mr-3 text-sm font-medium text-orange-600 hover:underline">
                      Bonus
                    </button>
                  )}
                  <button type="button" onClick={() => setSlipLihat(s.id)} className="text-sm font-medium text-stone-600 hover:underline">
                    Slip
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SlipGajiModal sumber="gaji" slipId={slipLihat} onClose={() => setSlipLihat(null)} />
      <UbahSlipModal
        slip={slipUbah}
        onClose={() => setSlipUbah(null)}
        onTersimpan={() => {
          setSlipUbah(null);
          qc.invalidateQueries({ queryKey: ["gaji"] });
        }}
      />
    </div>
  );
}

function UbahSlipModal({
  slip,
  onClose,
  onTersimpan,
}: {
  slip: GajiSlipRow | null;
  onClose: () => void;
  onTersimpan: () => void;
}) {
  const [bonus, setBonus] = useState("");
  const [penyesuaian, setPenyesuaian] = useState("");
  const [catatan, setCatatan] = useState("");
  const [untuk, setUntuk] = useState<string | null>(null);
  if (slip && untuk !== slip.id) {
    setUntuk(slip.id);
    setBonus(teksAngka(slip.bonus));
    setPenyesuaian(teksAngka(slip.penyesuaian));
    setCatatan(slip.catatan ?? "");
  }
  const simpan = useMutation({
    mutationFn: () =>
      api<GajiSlipDetailDto>(`/gaji/slip/${slip!.id}`, {
        method: "PATCH",
        body: { bonus: angkaDari(bonus) || 0, penyesuaian: angkaDari(penyesuaian) || 0, catatan: catatan || null },
      }),
    onSuccess: onTersimpan,
  });
  return (
    <Modal open={!!slip} onClose={onClose} title={`Bonus & penyesuaian — ${slip?.nama ?? ""}`}>
      <div className="space-y-3">
        <label className="block text-sm">
          Bonus (Rp)
          <input inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm">
          Penyesuaian (Rp, boleh minus)
          <input value={penyesuaian} onChange={(e) => setPenyesuaian(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm">
          Catatan (tampil di slip)
          <input value={catatan} maxLength={300} onChange={(e) => setCatatan(e.target.value)} className={inputClass} />
        </label>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end">
          <button type="button" onClick={() => simpan.mutate()} disabled={simpan.isPending} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
