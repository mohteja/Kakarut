import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  labelKategoriPengajuan,
  type PengajuanRow,
  type PengajuanStatus,
  type RekapAbsenDto,
  type RekapAbsenHari,
  type RekapAbsenRow,
} from "@kakarut/shared";
import { Card, ErrorText, Modal, PageTitle, Spinner, btnPrimary, inputClass } from "../../components/ui";
import { TabelResponsif } from "../../components/TabelResponsif";
import {
  badgeStatus,
  labelStatus,
  rentangTanggal,
} from "../../components/PengajuanCutiSection";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import {
  formatTanggal,
  formatTanggalRingkas,
  formatWaktu,
  hariIniWIB,
} from "../../lib/format";

/**
 * REKAP ABSEN BULANAN (owner/admin, di Kantor). Dua tab:
 *  - Rekap: satu baris per karyawan, jumlah hadir/tidak hadir/cuti/libur, plus
 *    SATU KOLOM PER TANGGAL berisi apa yang terjadi hari itu.
 *  - Pengajuan: ACC / tolak cuti & libur yang diajukan karyawan dari menu Absen.
 *
 * Grid tanggal sengaja tabel bergulir horizontal dengan kolom nama terkunci —
 * 31 kolom tak mungkin muat sebagai kartu di HP.
 */

const WARNA: Record<RekapAbsenHari["status"], { sel: string; huruf: string; label: string }> = {
  hadir: { sel: "bg-green-100 text-green-800", huruf: "H", label: "Hadir" },
  alpa: { sel: "bg-red-100 text-red-700", huruf: "A", label: "Tidak hadir" },
  cuti: { sel: "bg-blue-100 text-blue-800", huruf: "C", label: "Cuti" },
  libur: { sel: "bg-stone-200 text-stone-600", huruf: "L", label: "Libur" },
  kosong: { sel: "text-stone-300", huruf: "·", label: "Belum/di luar masa kerja" },
};

/** Bulan berjalan dalam format input[type=month]. */
const bulanIni = () => hariIniWIB().slice(0, 7);

function KartuAngka({ label, value, nada }: { label: string; value: string | number; nada?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${nada ?? "text-stone-800"}`}>{value}</div>
    </Card>
  );
}

export function RekapAbsenPage() {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const [bulan, setBulan] = useState(bulanIni());
  const [cabangFilter, setCabangFilter] = useState("all");
  // Karyawan yang sudah keluar tak ikut mengotori daftar & angka ringkasnya;
  // masih bisa dilihat lewat pilihan Arsip / Semua.
  const [status, setStatus] = useState<"aktif" | "arsip" | "semua">("aktif");
  const [tab, setTab] = useState<"rekap" | "pengajuan">("rekap");
  const [saring, setSaring] = useState<PengajuanStatus | "semua">("menunggu");
  const [detail, setDetail] = useState<{ nama: string; hari: RekapAbsenHari } | null>(null);
  const [tolak, setTolak] = useState<{ id: string; nama: string; alasan: string } | null>(null);

  const { data: rekap, isLoading, error } = useQuery({
    queryKey: ["rekap-absen", bulan, cabangFilter, status],
    queryFn: () =>
      api<RekapAbsenDto>(
        `/absensi/rekap?bulan=${bulan}&branch_id=${cabangFilter}&status=${status}`,
      ),
  });

  const { data: pengajuan = [], error: gagalPengajuan } = useQuery({
    queryKey: ["pengajuan", saring, cabangFilter],
    queryFn: () =>
      api<PengajuanRow[]>(
        `/pengajuan?branch_id=${cabangFilter}${saring === "semua" ? "" : `&status=${saring}`}`,
      ),
  });

  const { data: menunggu = [], error: gagalMenunggu } = useQuery({
    queryKey: ["pengajuan", "menunggu"],
    queryFn: () => api<PengajuanRow[]>("/pengajuan?status=menunggu"),
  });

  const segarkan = () => {
    queryClient.invalidateQueries({ queryKey: ["pengajuan"] });
    queryClient.invalidateQueries({ queryKey: ["rekap-absen"] });
  };

  const putuskan = useMutation({
    mutationFn: (v: { id: string; status: "disetujui" | "ditolak"; alasan_tolak?: string }) =>
      api<PengajuanRow>(`/pengajuan/${v.id}`, {
        method: "PATCH",
        body: { status: v.status, alasan_tolak: v.alasan_tolak ?? null },
      }),
    onSuccess: () => {
      setTolak(null);
      segarkan();
    },
  });

  const chip = (aktif: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      aktif ? "bg-orange-600 text-white" : "bg-white text-stone-600 hover:bg-stone-100"
    }`;

  const totalHadir = rekap?.rows.reduce((a, r) => a + r.hadir, 0) ?? 0;
  const totalAlpa = rekap?.rows.reduce((a, r) => a + r.tidak_hadir, 0) ?? 0;
  const tanggalKolom = rekap?.rows[0]?.harian ?? [];

  return (
    <div>
      <PageTitle>🗓 Rekap Absen</PageTitle>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Bulan</label>
          <input
            type="month"
            value={bulan}
            max={bulanIni()}
            onChange={(e) => setBulan(e.target.value || bulanIni())}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Cabang</label>
          <select
            value={cabangFilter}
            onChange={(e) => setCabangFilter(e.target.value)}
            className={inputClass}
          >
            <option value="all">Semua cabang</option>
            {cabang
              .filter((b) => b.is_active)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Karyawan</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={inputClass}
          >
            <option value="aktif">Aktif</option>
            <option value="arsip">🗄 Sudah keluar (arsip)</option>
            <option value="semua">Semua</option>
          </select>
        </div>
      </Card>

      {/*
        `?? 0` mengubah bacaan yang DITOLAK menjadi angka nol yang terlihat
        sah — "Total tidak hadir: 0" adalah kabar baik yang dikarang halaman
        ini justru saat ia tak tahu apa-apa. Saat gagal, ketiga angka yang
        bersumber dari /absensi/rekap ditulis "—", bukan nol. "Pengajuan
        menunggu" punya permintaannya sendiri, jadi ia tidak ikut dipadamkan
        oleh galat rekap — tapi ia dipadamkan oleh galatnya SENDIRI, dan itu
        yang paling penting di sini: "Pengajuan menunggu: 0" berarti tak ada
        yang perlu di-ACC, dan pengajuan yang tak pernah di-ACC dihitung
        sebagai TIDAK HADIR di rekap yang sama.
      */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KartuAngka label="Karyawan" value={error ? "—" : (rekap?.rows.length ?? 0)} />
        <KartuAngka
          label="Total hadir"
          value={error ? "—" : totalHadir}
          nada={error ? undefined : "text-green-600"}
        />
        <KartuAngka
          label="Total tidak hadir"
          value={error ? "—" : totalAlpa}
          nada={!error && totalAlpa > 0 ? "text-red-600" : undefined}
        />
        <KartuAngka
          label="Pengajuan menunggu"
          value={gagalMenunggu ? "—" : menunggu.length}
          nada={!gagalMenunggu && menunggu.length > 0 ? "text-orange-600" : undefined}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setTab("rekap")} className={chip(tab === "rekap")}>
          Rekap bulanan
        </button>
        <button onClick={() => setTab("pengajuan")} className={chip(tab === "pengajuan")}>
          Pengajuan {!gagalMenunggu && menunggu.length > 0 && `(${menunggu.length})`}
        </button>
      </div>

      {tab === "rekap" ? (
        // Galat diperiksa LEBIH DULU: `isLoading || !rekap` menyatukan MENUNGGU
        // dengan GAGAL, jadi permintaan yang ditolak membiarkan halaman berputar
        // di Spinner selamanya — TanStack sudah berhenti mencoba.
        error ? (
          <Card className="p-4">
            <ErrorText error={error} />
            <div className="mt-2 text-sm text-stone-500">
              Rekap absen tidak dapat dimuat, jadi angkanya tidak ditampilkan — <b>bukan</b> berarti
              nihil kehadiran. Muat ulang halaman setelah masalahnya beres.
            </div>
          </Card>
        ) : isLoading || !rekap ? (
          <Spinner />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-stone-50 text-left">
                  <tr>
                    <th className="sticky left-0 z-10 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Karyawan
                    </th>
                    <th className="px-2 py-2 text-center text-xs font-semibold text-green-700">H</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold text-red-700">A</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold text-blue-700">C</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold text-stone-500">L</th>
                    {tanggalKolom.map((h) => (
                      <th
                        key={h.tanggal}
                        className="w-7 px-0 py-2 text-center text-[11px] font-medium text-stone-400"
                      >
                        {Number(h.tanggal.slice(8))}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rekap.rows.length === 0 && (
                    <tr>
                      <td colSpan={5 + tanggalKolom.length} className="py-8 text-center text-sm text-stone-400">
                        {status === "arsip"
                          ? "Tidak ada karyawan yang keluar pada bulan ini."
                          : "Belum ada karyawan pada cabang & bulan ini."}
                      </td>
                    </tr>
                  )}
                  {rekap.rows.map((r: RekapAbsenRow) => (
                    <tr key={r.user_id} className="hover:bg-stone-50">
                      <td
                        className={`sticky left-0 z-10 max-w-[14rem] bg-white px-3 py-2 font-medium ${
                          r.arsip_pada ? "text-stone-400" : "text-stone-800"
                        }`}
                      >
                        <span className="block truncate">
                          {r.arsip_pada && "🗄 "}
                          {r.nama}
                          {r.cabang && (
                            <span className="ml-1 text-xs font-normal text-stone-400">
                              {r.cabang}
                            </span>
                          )}
                        </span>
                        {/* Baris kedua, bukan disambung: nama + cabang sudah
                            memakan lebar kolom yang terkunci. */}
                        {r.arsip_pada && (
                          <span className="block text-xs font-normal text-stone-400">
                            keluar {formatTanggalRingkas(r.arsip_pada)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-green-700">{r.hadir}</td>
                      <td className="px-2 py-2 text-center font-semibold text-red-700">
                        {r.tidak_hadir}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-blue-700">{r.cuti}</td>
                      <td className="px-2 py-2 text-center font-semibold text-stone-500">{r.libur}</td>
                      {r.harian.map((h) => (
                        <td key={h.tanggal} className="p-0.5 text-center">
                          <button
                            onClick={() => setDetail({ nama: r.nama, hari: h })}
                            title={`${formatTanggal(h.tanggal)} — ${WARNA[h.status].label}`}
                            className={`h-6 w-6 rounded text-[11px] font-bold ${WARNA[h.status].sel}`}
                          >
                            {WARNA[h.status].huruf}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
              {(["hadir", "alpa", "cuti", "libur", "kosong"] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${WARNA[s].sel}`}
                  >
                    {WARNA[s].huruf}
                  </span>
                  {WARNA[s].label}
                </span>
              ))}
            </div>

            <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <b>Cara hitungnya:</b> tiap tanggal dinilai satu per satu — ada cap absen →{" "}
              <b>Hadir</b>; ada cuti/libur yang <b>sudah disetujui</b> → Cuti/Libur; selain itu{" "}
              <b>Tidak hadir</b>. Tanggal yang belum lewat, sebelum karyawan bergabung, dan setelah
              ia keluar <b>tidak pernah dihitung</b>. Bulan ini {rekap.hari_terhitung} dari{" "}
              {rekap.hari} hari sudah terlewati.
            </div>
          </>
        )
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {(["menunggu", "disetujui", "ditolak", "semua"] as const).map((s) => (
              <button key={s} onClick={() => setSaring(s)} className={chip(saring === s)}>
                {s === "semua" ? "Semua" : labelStatus(s)}
              </button>
            ))}
          </div>

          <ErrorText error={putuskan.error} />

          {/*
            "Tidak ada pengajuan pada saringan ini" adalah PERNYATAAN, dan
            `data: pengajuan = []` membuat halaman ini menyatakannya justru saat
            bacaannya ditolak. Saringan bawaannya "menunggu", jadi kalimat itu
            berbunyi "tak ada yang perlu di-ACC" — dan cuti yang tak pernah
            di-ACC dihitung TIDAK HADIR oleh rekap di tab sebelah. Manajemen tak
            punya cara lain tahu bedanya: tabelnya kosong dengan tenang.

            Diperbaiki di `kosong` (bukan dengan menyembunyikan tabelnya) supaya
            satu perubahan berlaku untuk dua tampilan — tabel desktop dan kartu
            HP sama-sama membacanya dari prop ini.
          */}
          <ErrorText error={gagalPengajuan} />

          <TabelResponsif
            data={pengajuan}
            kunci={(p) => p.id}
            kosong={
              gagalPengajuan ? (
                <span className="text-red-700">
                  Daftar pengajuan <b>tidak terbaca</b> — bukan berarti tak ada yang menunggu
                  persetujuan. Muat ulang halaman; cuti yang belum di-ACC tetap terhitung tidak
                  hadir.
                </span>
              ) : (
                "Tidak ada pengajuan pada saringan ini."
              )
            }
            kolom={[
              {
                judul: "Karyawan",
                hp: "judul",
                sel: (p) => (
                  <span className="font-medium text-stone-800">
                    {p.nama}
                    {p.cabang && <span className="ml-1 text-xs text-stone-400">{p.cabang}</span>}
                  </span>
                ),
              },
              {
                judul: "Keperluan",
                hp: "sub",
                sel: (p) => labelKategoriPengajuan(p.kategori),
              },
              {
                judul: "Tanggal",
                sel: (p) => (
                  <span>
                    {rentangTanggal(p.tanggal_mulai, p.tanggal_selesai)}
                    <span className="ml-1 text-xs text-stone-400">({p.jumlah_hari} hari)</span>
                  </span>
                ),
              },
              {
                judul: "Keterangan",
                kelasSel: "text-stone-500",
                sel: (p) => (
                  <span>
                    {p.alasan ?? "—"}
                    {p.lampiran_url && (
                      <a
                        href={p.lampiran_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 font-medium text-orange-600 hover:underline"
                      >
                        📎 lampiran
                      </a>
                    )}
                    {p.status === "ditolak" && p.alasan_tolak && (
                      <span className="block text-xs text-red-700">Ditolak: {p.alasan_tolak}</span>
                    )}
                  </span>
                ),
              },
              {
                judul: "Status",
                sel: (p) => <span className={badgeStatus(p.status)}>{labelStatus(p.status)}</span>,
              },
              {
                hp: "aksi",
                kelasSel: "whitespace-nowrap text-right",
                sel: (p) =>
                  p.status === "menunggu" ? (
                    <>
                      <button
                        onClick={() => putuskan.mutate({ id: p.id, status: "disetujui" })}
                        disabled={putuskan.isPending}
                        className="text-sm font-medium text-green-600 hover:underline"
                      >
                        ✔ Setujui
                      </button>
                      <button
                        onClick={() => setTolak({ id: p.id, nama: p.nama, alasan: "" })}
                        className="ml-3 text-sm font-medium text-stone-400 hover:text-red-600 hover:underline"
                      >
                        ✖ Tolak
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-stone-400">
                      {p.diputus_oleh ? `oleh ${p.diputus_oleh}` : "—"}
                    </span>
                  ),
              },
            ]}
          />
        </>
      )}

      {/* Detail satu sel tanggal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.nama} — ${formatTanggal(detail.hari.tanggal)}` : ""}
      >
        {detail && (
          <div className="space-y-2 text-sm">
            <div>
              <span className={`${badgeStatus("menunggu")} ${WARNA[detail.hari.status].sel}`}>
                {WARNA[detail.hari.status].label}
              </span>
            </div>
            {detail.hari.status === "hadir" && (
              <div className="text-stone-600">
                Masuk: <b>{detail.hari.masuk ? formatWaktu(detail.hari.masuk) : "—"}</b> · Pulang:{" "}
                <b>{detail.hari.keluar ? formatWaktu(detail.hari.keluar) : "belum cap pulang"}</b>
              </div>
            )}
            {detail.hari.kategori && (
              <div className="text-stone-600">
                Keperluan: <b>{labelKategoriPengajuan(detail.hari.kategori)}</b>
              </div>
            )}
            {detail.hari.status === "alpa" && (
              <div className="text-stone-500">
                Tidak ada cap absen dan tidak ada cuti/libur yang disetujui pada tanggal ini.
              </div>
            )}
            {detail.hari.status === "kosong" && (
              <div className="text-stone-500">
                Di luar masa hitung — tanggal belum lewat, atau di luar masa kerja karyawan ini.
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Alasan penolakan (wajib) */}
      <Modal
        open={tolak !== null}
        onClose={() => setTolak(null)}
        title={tolak ? `Tolak pengajuan ${tolak.nama}` : ""}
      >
        {tolak && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              putuskan.mutate({ id: tolak.id, status: "ditolak", alasan_tolak: tolak.alasan });
            }}
            className="space-y-3"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-500">
                Alasan penolakan (wajib — dibaca karyawan)
              </label>
              <textarea
                value={tolak.alasan}
                onChange={(e) => setTolak({ ...tolak, alasan: e.target.value })}
                rows={3}
                maxLength={500}
                required
                placeholder="mis. cabang sedang kekurangan orang, ajukan tanggal lain"
                className={inputClass}
              />
            </div>
            <ErrorText error={putuskan.error} />
            <button type="submit" disabled={putuskan.isPending} className={`${btnPrimary} w-full`}>
              {putuskan.isPending ? "Menyimpan…" : "Tolak pengajuan"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
