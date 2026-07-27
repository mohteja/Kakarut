import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  KATEGORI_PENGAJUAN,
  labelKategoriPengajuan,
  type PengajuanJenis,
  type PengajuanKategori,
  type PengajuanRow,
  type PengajuanStatus,
} from "@kakarut/shared";
import { Card, ErrorText, Modal, btnPrimary, inputClass } from "./ui";
import { ImageUpload } from "./ImageUpload";
import { api } from "../lib/api";
import { formatTanggal, hariIniWIB } from "../lib/format";

/**
 * PENGAJUAN CUTI / LIBUR milik sendiri — dipakai di halaman Absen oleh SEMUA
 * peran. Owner/admin yang memutuskan (ACC/tolak) dari halaman Rekap Absen;
 * di sini karyawan hanya mengajukan, memantau statusnya, dan membatalkan
 * selama masih menunggu.
 */

export const badgeStatus = (s: PengajuanStatus) =>
  `rounded-full px-2 py-0.5 text-xs font-semibold ${
    s === "disetujui"
      ? "bg-green-100 text-green-800"
      : s === "ditolak"
        ? "bg-red-100 text-red-700"
        : "bg-yellow-100 text-yellow-800"
  }`;

export const labelStatus = (s: PengajuanStatus) =>
  s === "disetujui" ? "Disetujui" : s === "ditolak" ? "Ditolak" : "Menunggu";

/** Rentang tanggal ringkas: satu hari → satu tanggal saja. */
export function rentangTanggal(mulai: string, selesai: string): string {
  return mulai === selesai
    ? formatTanggal(mulai)
    : `${formatTanggal(mulai)} – ${formatTanggal(selesai)}`;
}

interface FormPengajuan {
  jenis: PengajuanJenis;
  kategori: PengajuanKategori;
  tanggal_mulai: string;
  tanggal_selesai: string;
  alasan: string;
  lampiran_url: string | null;
}

function formAwal(): FormPengajuan {
  const hari = hariIniWIB();
  return {
    jenis: "cuti",
    kategori: "tahunan",
    tanggal_mulai: hari,
    tanggal_selesai: hari,
    alasan: "",
    lampiran_url: null,
  };
}

export function PengajuanCutiSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormPengajuan | null>(null);

  const { data: daftar = [] } = useQuery({
    queryKey: ["pengajuan", "saya"],
    queryFn: () => api<PengajuanRow[]>("/pengajuan"),
  });

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["pengajuan"] });
  };

  const ajukan = useMutation({
    mutationFn: (f: FormPengajuan) =>
      api<PengajuanRow>("/pengajuan", {
        method: "POST",
        body: {
          kategori: f.kategori,
          tanggal_mulai: f.tanggal_mulai,
          tanggal_selesai: f.tanggal_selesai,
          alasan: f.alasan.trim() || null,
          lampiran_url: f.lampiran_url,
        },
      }),
    onSuccess: () => {
      setForm(null);
      segarkan();
    },
  });

  const batalkan = useMutation({
    mutationFn: (id: string) => api(`/pengajuan/${id}`, { method: "DELETE" }),
    onSuccess: segarkan,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form) ajukan.mutate(form);
  }

  // Kategori disaring mengikuti jenis terpilih — memilih "Libur" tak boleh
  // menyisakan "Melahirkan" di dropdown.
  const kategoriTampil = form
    ? KATEGORI_PENGAJUAN.filter((k) => k.jenis === form.jenis)
    : KATEGORI_PENGAJUAN;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-stone-400">
          Pengajuan cuti &amp; libur saya
        </h2>
        <button onClick={() => setForm(formAwal())} className={btnPrimary}>
          ＋ Ajukan
        </button>
      </div>

      <ErrorText error={batalkan.error} />

      {daftar.length === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-400">
          Belum ada pengajuan. Tekan <b>Ajukan</b> untuk mengajukan cuti atau libur.
        </Card>
      ) : (
        <div className="space-y-2">
          {daftar.map((p) => (
            <Card key={p.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-stone-800">
                  {labelKategoriPengajuan(p.kategori)}
                </span>
                <span className={badgeStatus(p.status)}>{labelStatus(p.status)}</span>
                <span className="ml-auto text-sm text-stone-500">
                  {rentangTanggal(p.tanggal_mulai, p.tanggal_selesai)} · {p.jumlah_hari} hari
                </span>
              </div>
              {p.alasan && <div className="mt-1 text-sm text-stone-600">{p.alasan}</div>}
              {p.status === "ditolak" && p.alasan_tolak && (
                <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  <b>Ditolak:</b> {p.alasan_tolak}
                </div>
              )}
              {p.status === "menunggu" && (
                <button
                  onClick={() => {
                    if (confirm("Batalkan pengajuan ini?")) batalkan.mutate(p.id);
                  }}
                  className="mt-2 text-sm font-medium text-stone-400 hover:text-red-600 hover:underline"
                >
                  Batalkan
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={form !== null} onClose={() => setForm(null)} title="Ajukan Cuti / Libur">
        {form && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-500">Jenis</label>
                <select
                  value={form.jenis}
                  onChange={(e) => {
                    const jenis = e.target.value as PengajuanJenis;
                    // Ganti kategori ke yang pertama pada jenis baru supaya
                    // tak pernah tersimpan pasangan yang tak cocok.
                    const pertama = KATEGORI_PENGAJUAN.find((k) => k.jenis === jenis)!.kode;
                    setForm({ ...form, jenis, kategori: pertama });
                  }}
                  className={inputClass}
                >
                  <option value="cuti">Cuti</option>
                  <option value="libur">Libur</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-500">Keperluan</label>
                <select
                  value={form.kategori}
                  onChange={(e) =>
                    setForm({ ...form, kategori: e.target.value as PengajuanKategori })
                  }
                  className={inputClass}
                >
                  {kategoriTampil.map((k) => (
                    <option key={k.kode} value={k.kode}>
                      {k.emoji} {k.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-500">Dari tanggal</label>
                <input
                  type="date"
                  value={form.tanggal_mulai}
                  max={form.tanggal_selesai}
                  onChange={(e) => setForm({ ...form, tanggal_mulai: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-500">
                  Sampai tanggal
                </label>
                <input
                  type="date"
                  value={form.tanggal_selesai}
                  min={form.tanggal_mulai}
                  onChange={(e) => setForm({ ...form, tanggal_selesai: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-stone-500">
                Keterangan (opsional)
              </label>
              <textarea
                value={form.alasan}
                onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                rows={2}
                maxLength={500}
                placeholder="mis. demam, surat dokter terlampir"
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-stone-500">
                Lampiran (opsional) — mis. surat dokter
              </label>
              <ImageUpload
                value={form.lampiran_url}
                onChange={(url) => setForm({ ...form, lampiran_url: url })}
                tujuan="bukti"
                placeholder="📄"
              />
            </div>

            <ErrorText error={ajukan.error} />
            <button type="submit" disabled={ajukan.isPending} className={`${btnPrimary} w-full`}>
              {ajukan.isPending ? "Mengirim…" : "Kirim pengajuan"}
            </button>
            <p className="text-center text-xs text-stone-400">
              Pengajuan menunggu persetujuan owner/admin. Selama belum disetujui, hari itu masih
              terhitung tidak hadir.
            </p>
          </form>
        )}
      </Modal>
    </div>
  );
}
