import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  labelSesiKebersihan,
  SESI_KEBERSIHAN,
  type LaporanKebersihanDto,
  type RekapKebersihanDto,
} from "@kakarut/shared";
import {
  Card,
  ErrorText,
  Modal,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { useBranch } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatTanggal, formatWaktu, hariIniWIB } from "../../lib/format";
import { AreaKebersihanModal } from "./AreaKebersihanModal";

/**
 * REKAP KEBERSIHAN (owner/admin, di Kantor) — SATU KOTAK SATU HARI, berisi
 * laporan semua tim (CK maupun cabang) hari itu. Hari tanpa laporan tetap
 * muncul sebagai kotak kosong: yang penting justru melihat hari yang bolong.
 */

/** Bulan berjalan dalam format input[type=month]. */
const bulanIni = () => hariIniWIB().slice(0, 7);

function KartuAngka({
  label,
  value,
  nada,
}: {
  label: string;
  value: string | number;
  nada?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${nada ?? "text-stone-800"}`}>{value}</div>
    </Card>
  );
}

export function RekapKebersihanPage() {
  const queryClient = useQueryClient();
  const { cabang } = useBranch();
  const [bulan, setBulan] = useState(bulanIni());
  const [cabangFilter, setCabangFilter] = useState("all");
  const [sesiFilter, setSesiFilter] = useState("all");
  const [aturArea, setAturArea] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draftCatatan, setDraftCatatan] = useState("");

  const { data: rekap, isLoading, error } = useQuery({
    queryKey: ["rekap-kebersihan", bulan, cabangFilter, sesiFilter],
    queryFn: () =>
      api<RekapKebersihanDto>(
        `/kebersihan/rekap?bulan=${bulan}&branch_id=${cabangFilter}&sesi=${sesiFilter}`,
      ),
  });

  const { data: detail } = useQuery({
    queryKey: ["kebersihan-detail", detailId],
    queryFn: () => api<LaporanKebersihanDto>(`/kebersihan/${detailId}`),
    enabled: !!detailId,
  });

  const simpanCatatan = useMutation({
    mutationFn: () =>
      api<LaporanKebersihanDto>(`/kebersihan/${detailId}/catatan`, {
        method: "PATCH",
        body: { catatan_owner: draftCatatan.trim() || null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kebersihan-detail", detailId] });
      queryClient.invalidateQueries({ queryKey: ["rekap-kebersihan"] });
      queryClient.invalidateQueries({ queryKey: ["kebersihan-ringkas"] });
    },
  });

  const hari = rekap?.hari ?? [];
  const totalLaporan = hari.reduce((a, h) => a + h.total, 0);
  const hariTerisi = hari.filter((h) => h.total > 0).length;
  const totalKotor = hari.reduce((a, h) => a + h.area_kotor, 0);
  const pelapor = new Set(hari.flatMap((h) => h.laporan.map((l) => l.user_id))).size;

  // Isi kotak catatan begitu detail tiba, sekali per laporan — supaya owner
  // bisa MENGOSONGKAN catatan (nilai "" tak boleh jatuh kembali ke isi lama).
  useEffect(() => {
    if (detail) setDraftCatatan(detail.catatan_owner ?? "");
  }, [detail?.id]);

  return (
    <div>
      <PageTitle
        aksi={
          <button onClick={() => setAturArea(true)} className={btnSecondary}>
            ⚙ Atur Area
          </button>
        }
      >
        🧼 Rekap Kebersihan
      </PageTitle>

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
          <label className="mb-1 block text-xs font-medium text-stone-500">Sesi</label>
          <select
            value={sesiFilter}
            onChange={(e) => setSesiFilter(e.target.value)}
            className={inputClass}
          >
            <option value="all">Semua sesi</option>
            {SESI_KEBERSIHAN.map((s) => (
              <option key={s.kode} value={s.kode}>
                {s.emoji} {s.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/*
        BACAAN YANG DITOLAK ≠ SEMUANYA BERSIH. `hari = rekap?.hari ?? []`
        membuat keempat kartu terisi NOL walau permintaannya gagal — dan "Area
        kotor: 0" bahkan ditulis HIJAU, pernyataan paling meyakinkan yang bisa
        dibuat halaman ini, justru saat ia tak tahu apa-apa. Daftarnya sendiri
        berputar di Spinner selamanya karena `!rekap` disatukan dengan
        `isLoading`; TanStack sudah berhenti mencoba, layarnya tak pernah
        mengatakannya. Galat diperiksa LEBIH DULU: angkanya tak boleh muncul
        sama sekali kalau sumbernya tak terbaca.
      */}
      {error ? (
        <Card className="p-4">
          <ErrorText error={error} />
          <div className="mt-2 text-sm text-stone-500">
            Rekap kebersihan tidak dapat dimuat, jadi angkanya tidak ditampilkan — <b>bukan</b>{" "}
            berarti nol area kotor. Muat ulang halaman setelah masalahnya beres.
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KartuAngka label="Total laporan" value={totalLaporan} />
            <KartuAngka label="Hari terisi" value={`${hariTerisi}/${hari.length}`} />
            <KartuAngka
              label="Area kotor"
              value={totalKotor}
              nada={totalKotor > 0 ? "text-red-600" : "text-green-600"}
            />
            <KartuAngka label="Karyawan melapor" value={pelapor} />
          </div>

          {isLoading || !rekap ? (
            <Spinner />
          ) : (
        <div className="space-y-3">
          {hari.map((h) =>
            // Hari kosong tetap ditampilkan (itu justru informasinya), tapi
            // sebagai baris tipis — sebulan penuh kartu tinggi tak terbaca.
            h.laporan.length === 0 ? (
              <Card
                key={h.tanggal}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <span className="text-sm font-medium text-stone-500">
                  {formatTanggal(h.tanggal)}
                </span>
                <span className="text-sm text-stone-400">Tidak ada laporan.</span>
              </Card>
            ) : (
              <Card key={h.tanggal} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-stone-800">{formatTanggal(h.tanggal)}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {SESI_KEBERSIHAN.map((s) => (
                      <span
                        key={s.kode}
                        className={`rounded-full px-2 py-0.5 ${
                          h.sesi[s.kode] > 0
                            ? "bg-green-100 text-green-800"
                            : "bg-stone-100 text-stone-400"
                        }`}
                        title={s.label}
                      >
                        {s.emoji} {h.sesi[s.kode]}
                      </span>
                    ))}
                    {h.area_kotor > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
                        {h.area_kotor} area kotor
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {h.laporan.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setDetailId(l.id)}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-stone-50"
                    >
                      <span className="font-medium text-stone-700">👤 {l.nama}</span>
                      <span className="text-stone-500">{l.cabang ?? "—"}</span>
                      <span className="text-stone-500">{labelSesiKebersihan(l.sesi)}</span>
                      <span className={l.area_kotor > 0 ? "text-red-600" : "text-green-600"}>
                        {l.area_bersih}/{l.total_area} bersih
                      </span>
                      <span className="text-stone-400">📷 {l.jumlah_foto}</span>
                      <span className="ml-auto text-xs text-stone-400">
                        {formatWaktu(l.created_at)}
                      </span>
                      {l.ada_catatan_owner && <span title="Sudah dikomentari owner">💬</span>}
                    </button>
                  ))}
                </div>
              </Card>
            ),
          )}
        </div>
          )}
        </>
      )}

      <Modal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title="Detail Laporan Kebersihan"
        lebar="max-w-2xl"
      >
        {!detail ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-3 text-sm text-stone-600">
              <span className="font-medium text-stone-800">{detail.nama}</span> ·{" "}
              {detail.cabang ?? "—"} · {labelSesiKebersihan(detail.sesi)} ·{" "}
              {formatTanggal(detail.tanggal)} {formatWaktu(detail.created_at)}
            </div>
            {detail.catatan && (
              <div className="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                Catatan karyawan: {detail.catatan}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-stone-50 text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Area
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Status
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Catatan
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Foto
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className="border-t border-stone-100">
                      <td className="px-3 py-2 text-stone-700">{it.area_nama}</td>
                      <td className="px-3 py-2">
                        {it.bersih ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Bersih
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            Belum
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-stone-500">{it.catatan ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        {it.foto_url ? (
                          <a
                            href={it.foto_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Lihat bukti foto"
                          >
                            <img
                              src={it.foto_url}
                              alt="bukti"
                              className="mx-auto h-8 w-8 rounded object-cover ring-1 ring-stone-200"
                            />
                          </a>
                        ) : (
                          <span className="text-xs text-stone-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="mb-1 mt-4 block text-xs font-medium text-stone-500">
              Catatan owner (dibaca karyawan)
            </label>
            <textarea
              value={draftCatatan}
              onChange={(e) => setDraftCatatan(e.target.value)}
              rows={2}
              placeholder="mis. toilet masih kotor, tolong diulang"
              className={inputClass}
            />
            {detail.catatan_owner_pada && (
              <div className="mt-1 text-xs text-stone-400">
                Terakhir dicatat {detail.catatan_owner_oleh ?? "—"} ·{" "}
                {formatWaktu(detail.catatan_owner_pada)}
              </div>
            )}
            <ErrorText error={simpanCatatan.error} />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => simpanCatatan.mutate()}
                disabled={simpanCatatan.isPending}
                className={btnPrimary}
              >
                {simpanCatatan.isPending ? "Menyimpan…" : "Simpan Catatan"}
              </button>
              <button onClick={() => setDetailId(null)} className={btnSecondary}>
                Tutup
              </button>
            </div>
          </>
        )}
      </Modal>

      <AreaKebersihanModal open={aturArea} onClose={() => setAturArea(false)} />
    </div>
  );
}
