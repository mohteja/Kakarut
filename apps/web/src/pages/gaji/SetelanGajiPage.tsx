import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BATAS_TANGGAL_MULAI_GAJI,
  KATEGORI_PENGAJUAN,
  angkaDari,
  potonganAlpaBerlaku,
  teksAngka,
  type GajiKaryawanRow,
  type GajiSetelanKaryawanDto,
  type GajiSetelanPerusahaanDto,
  type GajiTunjanganDto,
  type PengajuanKategori,
} from "@kakarut/shared";
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
import { api } from "../../lib/api";
import { formatRupiah } from "../../lib/format";
import { NavGaji } from "./PeriodeGajiPage";

/** SETELAN GAJI — aturan perusahaan + setelan per karyawan (owner & HRD). */
export function SetelanGajiPage() {
  const { data, error, refetch } = useQuery({
    queryKey: ["gaji", "karyawan"],
    queryFn: () => api<GajiKaryawanRow[]>("/gaji/karyawan"),
  });
  const [ubah, setUbah] = useState<GajiKaryawanRow | null>(null);
  const [tampilArsip, setTampilArsip] = useState(false);
  const rows = (data ?? []).filter((k) => tampilArsip || !k.arsip_pada);

  return (
    <div className="max-w-5xl">
      <PageTitle aksi={<NavGaji />}>Setelan Gaji</PageTitle>
      <SetelanPerusahaan />
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-stone-800">Gaji per karyawan</h2>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={tampilArsip} onChange={(e) => setTampilArsip(e.target.checked)} />
          Tampilkan yang sudah keluar
        </label>
      </div>
      {!data ? (
        <SpinnerAtauGalat error={error} apa="Daftar karyawan" onCoba={() => refetch()} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-stone-200">
                <th className={thClass}>Karyawan</th>
                <th className={thClass}>Dasar</th>
                <th className={`${thClass} text-right`}>Nominal</th>
                <th className={thClass}>Jam kerja</th>
                <th className={thClass}>Tunjangan</th>
                <th className={`${thClass} text-right`}>Sisa kasbon</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.user_id} className="border-b border-stone-100" data-testid="baris-setelan-gaji">
                  <td className={tdClass}>
                    <div className="font-medium text-stone-800">{k.nama}</div>
                    <div className="text-xs text-stone-500">
                      {k.cabang ?? "—"}
                      {k.arsip_pada && " · sudah keluar"}
                    </div>
                  </td>
                  <td className={tdClass}>
                    {!k.setelan ? (
                      <span className="text-amber-700">Belum diatur</span>
                    ) : (
                      <>
                        {k.setelan.dasar === "bulanan" ? "Bulanan" : "Harian"}
                        {!k.setelan.aktif && <span className="ml-1 text-xs text-stone-400">(nonaktif)</span>}
                      </>
                    )}
                  </td>
                  <td className={`${tdClass} text-right`}>{k.setelan ? formatRupiah(k.setelan.nominal) : "—"}</td>
                  <td className={tdClass}>
                    {k.setelan?.jam_masuk && k.setelan.jam_pulang ? `${k.setelan.jam_masuk}–${k.setelan.jam_pulang}` : "—"}
                  </td>
                  <td className={tdClass}>
                    {k.tunjangan.length === 0 ? "—" : k.tunjangan.map((t) => `${t.nama} ${formatRupiah(t.nominal)}`).join(", ")}
                  </td>
                  <td className={`${tdClass} text-right`}>{k.kasbon_sisa > 0 ? formatRupiah(k.kasbon_sisa) : "—"}</td>
                  <td className={`${tdClass} text-right`}>
                    <button type="button" onClick={() => setUbah(k)} className="text-sm font-medium text-orange-600 hover:underline">
                      Atur
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <UbahSetelanModal karyawan={ubah} onClose={() => setUbah(null)} />
    </div>
  );
}

function SetelanPerusahaan() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["gaji", "setelan"],
    queryFn: () => api<GajiSetelanPerusahaanDto>("/gaji/setelan"),
  });
  const [form, setForm] = useState<GajiSetelanPerusahaanDto | null>(null);
  if (data && !form) setForm(data);
  const simpan = useMutation({
    mutationFn: (f: GajiSetelanPerusahaanDto) => api("/gaji/setelan", { method: "PUT", body: f }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gaji"] }),
  });
  if (!form) return <SpinnerAtauGalat error={error} apa="Setelan perusahaan" onCoba={() => refetch()} />;
  const ganti = (k: PengajuanKategori, on: boolean) =>
    setForm({ ...form, cuti_dibayar: on ? [...form.cuti_dibayar, k] : form.cuti_dibayar.filter((x) => x !== k) });
  return (
    <Card className="mb-5 p-4">
      <div className="mb-2 font-semibold text-stone-800">Aturan perusahaan</div>
      <label className="mb-3 block text-sm text-stone-700">
        Periode gaji dimulai tanggal
        <input
          type="number"
          min={1}
          max={BATAS_TANGGAL_MULAI_GAJI}
          value={form.tanggal_mulai}
          onChange={(e) => setForm({ ...form, tanggal_mulai: angkaDari(e.target.value) || 1 })}
          className={`${inputClass} mt-1 max-w-[100px]`}
        />
        <span className="ml-2 text-xs text-stone-500">
          (1 = tanggal 1 s/d akhir bulan; 25 = tanggal 25 s/d 24 bulan berikutnya)
        </span>
      </label>
      <div className="mb-1 text-sm text-stone-700">Cuti & libur yang disetujui dan tetap DIBAYAR:</div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {KATEGORI_PENGAJUAN.map((k) => (
          <label key={k.kode} className="flex items-center gap-1.5 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.cuti_dibayar.includes(k.kode)}
              onChange={(e) => ganti(k.kode, e.target.checked)}
            />
            {k.emoji} {k.label}
          </label>
        ))}
      </div>
      <p className="mb-2 text-xs text-stone-500">
        Yang tidak dicentang dipotong seperti alpa (gaji bulanan) atau tidak dibayar (gaji harian).
      </p>
      <ErrorText error={simpan.error} />
      <button type="button" onClick={() => simpan.mutate(form)} disabled={simpan.isPending} className={btnPrimary}>
        {simpan.isSuccess && !simpan.isPending ? "Tersimpan ✓" : "Simpan aturan"}
      </button>
    </Card>
  );
}

type Form = Omit<GajiSetelanKaryawanDto, "nominal" | "potongan_alpa_per_hari" | "potongan_telat_per_kali" | "upah_lembur_per_jam" | "toleransi_telat_menit"> & {
  nominal: string;
  potongan_alpa_per_hari: string;
  potongan_telat_per_kali: string;
  upah_lembur_per_jam: string;
  toleransi_telat_menit: string;
  tunjangan: { nama: string; nominal: string }[];
};

function keForm(k: GajiKaryawanRow): Form {
  const s = k.setelan;
  return {
    dasar: s?.dasar ?? "bulanan",
    nominal: s ? teksAngka(s.nominal) : "",
    jam_masuk: s?.jam_masuk ?? "08:00",
    jam_pulang: s?.jam_pulang ?? "16:00",
    toleransi_telat_menit: teksAngka(s?.toleransi_telat_menit ?? 10),
    potongan_alpa_per_hari: teksAngka(s?.potongan_alpa_per_hari),
    potongan_telat_per_kali: teksAngka(s?.potongan_telat_per_kali ?? 0),
    upah_lembur_per_jam: teksAngka(s?.upah_lembur_per_jam ?? 0),
    aktif: s?.aktif ?? true,
    tunjangan: k.tunjangan.map((t) => ({ nama: t.nama, nominal: teksAngka(t.nominal) })),
  };
}

function keBody(f: Form): GajiSetelanKaryawanDto & { aktif: boolean; tunjangan: GajiTunjanganDto[] } {
  return {
    dasar: f.dasar,
    nominal: angkaDari(f.nominal) || 0,
    jam_masuk: f.jam_masuk || null,
    jam_pulang: f.jam_pulang || null,
    toleransi_telat_menit: angkaDari(f.toleransi_telat_menit) || 0,
    potongan_alpa_per_hari: f.potongan_alpa_per_hari.trim() === "" ? null : angkaDari(f.potongan_alpa_per_hari) || 0,
    potongan_telat_per_kali: angkaDari(f.potongan_telat_per_kali) || 0,
    upah_lembur_per_jam: angkaDari(f.upah_lembur_per_jam) || 0,
    aktif: f.aktif,
    tunjangan: f.tunjangan
      .filter((t) => t.nama.trim())
      .map((t) => ({ nama: t.nama.trim(), nominal: angkaDari(t.nominal) || 0 })),
  };
}

function UbahSetelanModal({ karyawan, onClose }: { karyawan: GajiKaryawanRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [untuk, setUntuk] = useState<string | null>(null);
  if (karyawan && untuk !== karyawan.user_id) {
    setUntuk(karyawan.user_id);
    setForm(keForm(karyawan));
  }
  const simpan = useMutation({
    mutationFn: (f: Form) =>
      api(`/gaji/karyawan/${karyawan!.user_id}`, {
        method: "PUT",
        body: keBody(f),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gaji"] });
      onClose();
    },
  });
  if (!karyawan || !form) return null;
  const set = (p: Partial<Form>) => setForm({ ...form, ...p });
  // Bawaan dari rumus shared yang sama dengan server — layar tak menghitung sendiri.
  const bawaanAlpa = potonganAlpaBerlaku({ ...keBody(form), potongan_alpa_per_hari: null });

  return (
    <Modal open onClose={onClose} title={`Gaji ${karyawan.nama}`} lebar="max-w-xl">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label>
            Dasar gaji
            <select value={form.dasar} onChange={(e) => set({ dasar: e.target.value as Form["dasar"] })} className={inputClass}>
              <option value="bulanan">Bulanan (tetap)</option>
              <option value="harian">Harian (× hari dibayar)</option>
            </select>
          </label>
          <label>
            {form.dasar === "bulanan" ? "Gaji per bulan (Rp)" : "Upah per hari (Rp)"}
            <input inputMode="numeric" value={form.nominal} onChange={(e) => set({ nominal: e.target.value })} className={inputClass} />
          </label>
          <label>
            Jam masuk
            <input type="time" value={form.jam_masuk ?? ""} onChange={(e) => set({ jam_masuk: e.target.value })} className={inputClass} />
          </label>
          <label>
            Jam pulang
            <input type="time" value={form.jam_pulang ?? ""} onChange={(e) => set({ jam_pulang: e.target.value })} className={inputClass} />
          </label>
          <label>
            Toleransi telat (menit)
            <input type="number" min={0} max={240} value={form.toleransi_telat_menit} onChange={(e) => set({ toleransi_telat_menit: e.target.value })} className={inputClass} />
          </label>
          <label>
            Potongan per kali telat (Rp)
            <input inputMode="numeric" value={form.potongan_telat_per_kali} onChange={(e) => set({ potongan_telat_per_kali: e.target.value })} className={inputClass} />
          </label>
          <label>
            Upah lembur per jam (Rp)
            <input inputMode="numeric" value={form.upah_lembur_per_jam} onChange={(e) => set({ upah_lembur_per_jam: e.target.value })} className={inputClass} />
          </label>
          {form.dasar === "bulanan" && (
            <label>
              Potongan per hari alpa (Rp)
              <input
                inputMode="numeric"
                value={form.potongan_alpa_per_hari}
                placeholder={`bawaan ${formatRupiah(bawaanAlpa)}`}
                onChange={(e) => set({ potongan_alpa_per_hari: e.target.value })}
                className={inputClass}
              />
            </label>
          )}
        </div>
        <p className="text-xs text-stone-500">
          Lembur dihitung dari absen pulang yang lewat jam pulang, per 30 menit penuh. Kosongkan jam kerja bila
          telat & lembur tak dihitung.
        </p>
        <div>
          <div className="mb-1 font-medium text-stone-700">Tunjangan tetap per periode</div>
          {form.tunjangan.map((t, i) => (
            <div key={i} className="mb-1 flex gap-2">
              <input
                placeholder="mis. Makan"
                value={t.nama}
                maxLength={40}
                onChange={(e) => set({ tunjangan: form.tunjangan.map((x, j) => (j === i ? { ...x, nama: e.target.value } : x)) })}
                className={inputClass}
              />
              <input
                inputMode="numeric"
                placeholder="Rp"
                value={t.nominal}
                onChange={(e) => set({ tunjangan: form.tunjangan.map((x, j) => (j === i ? { ...x, nominal: e.target.value } : x)) })}
                className={`${inputClass} max-w-[140px]`}
              />
              <button
                type="button"
                aria-label="Hapus tunjangan"
                onClick={() => set({ tunjangan: form.tunjangan.filter((_, j) => j !== i) })}
                className="px-2 text-stone-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={() => set({ tunjangan: [...form.tunjangan, { nama: "", nominal: "" }] })} className="text-sm font-medium text-orange-600 hover:underline">
            + Tunjangan
          </button>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.aktif} onChange={(e) => set({ aktif: e.target.checked })} />
          Ikut dihitung di periode gaji
        </label>
        <ErrorText error={simpan.error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Batal
          </button>
          <button type="button" onClick={() => simpan.mutate(form)} disabled={simpan.isPending || !form.nominal} className={btnPrimary}>
            {simpan.isPending ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
