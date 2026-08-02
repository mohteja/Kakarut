import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  labelSesiKebersihan,
  SESI_KEBERSIHAN,
  type AreaKebersihanDto,
  type KebersihanSesi,
  type LaporanKebersihanDto,
} from "@kakarut/shared";
import { ImageUpload } from "../../components/ImageUpload";
import {
  Card,
  ErrorText,
  PageTitle,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatTanggal, formatWaktu, hariIniWIB } from "../../lib/format";

/**
 * LAPORAN KEBERSIHAN HARIAN — halaman karyawan (semua peran, di cabang mana
 * pun termasuk Central Kitchen). Tiga kartu sesi hari ini; ketuk salah satunya
 * untuk mengisi checklist.
 *
 * Tanggal TIDAK dikirim dari sini — server menurunkannya dari zona waktu
 * perusahaan, jadi halaman ini selalu bicara tentang "hari ini".
 */

type Isian = { bersih: boolean; catatan: string; foto: string | null };

export function LaporanKebersihanPage() {
  const queryClient = useQueryClient();
  const [sesiBuka, setSesiBuka] = useState<KebersihanSesi | null>(null);
  const [isian, setIsian] = useState<Record<string, Isian>>({});
  const [catatan, setCatatan] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  // `aktif=1` — checklist hanya boleh memuat area yang masih dipakai. Tanpa
  // ini, pelapor berperan manajemen ikut menerima area cabang lain dan area
  // yang sudah dinonaktifkan, lalu kirimannya ditolak server dengan 400.
  const { data: area = [], isLoading: memuatArea, error: gagalArea } = useQuery({
    queryKey: ["kebersihan-area", "checklist"],
    queryFn: () => api<AreaKebersihanDto[]>("/kebersihan/area?aktif=1"),
  });

  // 14 hari terakhir cukup untuk "laporan saya" tanpa membebani daftar.
  const dari = useMemo(() => {
    const d = new Date(`${hariIniWIB()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 13);
    return d.toISOString().slice(0, 10);
  }, []);

  // `saya=1` WAJIB. Tanpa penanda itu, peran manajemen menerima laporan
  // seluruh karyawan: kartu sesi menandai "sudah terisi" karena orang lain
  // yang mengisinya, `editId` menunjuk laporan orang lain, dan tombol Perbarui
  // ditolak 403 — pelapornya tak punya jalan mengirim laporannya sendiri.
  const { data: laporan = [], isLoading, error: gagalLaporan } = useQuery({
    queryKey: ["kebersihan-saya", dari],
    queryFn: () => api<LaporanKebersihanDto[]>(`/kebersihan?saya=1&dari=${dari}`),
  });

  const hariIni = hariIniWIB();
  const laporanHariIni = laporan.filter((l) => l.tanggal === hariIni);
  const perSesi = new Map(laporanHariIni.map((l) => [l.sesi, l]));

  function bukaSesi(sesi: KebersihanSesi) {
    const ada = perSesi.get(sesi);
    const awal: Record<string, Isian> = {};
    for (const a of area) {
      const lama = ada?.items.find((i) => i.area_id === a.id);
      awal[a.id] = {
        // Bawaan "bersih" — karyawan hanya perlu menandai yang bermasalah.
        bersih: lama ? lama.bersih : true,
        catatan: lama?.catatan ?? "",
        foto: lama?.foto_url ?? null,
      };
    }
    setIsian(awal);
    setCatatan(ada?.catatan ?? "");
    setEditId(ada?.id ?? null);
    setSesiBuka(sesi);
  }

  function tutup() {
    setSesiBuka(null);
    setEditId(null);
    setIsian({});
    setCatatan("");
  }

  const kirim = useMutation({
    mutationFn: () => {
      const items = area.map((a) => ({
        area_id: a.id,
        bersih: isian[a.id]?.bersih ?? true,
        catatan: isian[a.id]?.catatan?.trim() || null,
        foto_url: isian[a.id]?.foto ?? null,
      }));
      const body = { catatan: catatan.trim() || null, items };
      return editId
        ? api<LaporanKebersihanDto>(`/kebersihan/${editId}`, { method: "PATCH", body })
        : api<LaporanKebersihanDto>("/kebersihan", {
            method: "POST",
            body: { ...body, sesi: sesiBuka },
          });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kebersihan-saya"] });
      tutup();
    },
  });

  const adaFoto = area.some((a) => !!isian[a.id]?.foto);
  const jumlahKotor = area.filter((a) => isian[a.id]?.bersih === false).length;

  function set(id: string, patch: Partial<Isian>) {
    setIsian((p) => ({ ...p, [id]: { ...(p[id] ?? { bersih: true, catatan: "", foto: null }), ...patch } }));
  }

  if (memuatArea) return <Spinner />;

  return (
    <div>
      <PageTitle>🧹 Laporan Kebersihan</PageTitle>

      {/*
        DITOLAK ≠ BELUM DIATUR. `data: area = []` menyamakan keduanya, jadi
        permintaan yang gagal berbunyi "Owner belum membuat daftar area" —
        karyawannya lalu mengejar owner untuk masalah yang tidak ada, dan
        laporan hari itu tak pernah terkirim.
      */}
      {gagalArea ? (
        <Card className="p-4">
          <ErrorText error={gagalArea} />
          <div className="mt-2 text-sm text-stone-500">
            Daftar area tidak dapat dimuat — <b>bukan</b> berarti owner belum mengaturnya. Muat
            ulang halaman setelah masalahnya beres.
          </div>
        </Card>
      ) : area.length === 0 ? (
        <Card className="p-6 text-center text-sm text-stone-500">
          Owner belum membuat daftar area kebersihan untuk lokasi ini. Minta owner mengaturnya
          lewat <span className="font-medium">Rekap Kebersihan → ⚙ Atur Area</span>.
        </Card>
      ) : sesiBuka ? (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-lg font-semibold text-stone-800">
                {labelSesiKebersihan(sesiBuka)}
              </div>
              <div className="text-xs text-stone-500">{formatTanggal(hariIni)}</div>
            </div>
            <button onClick={tutup} className={btnSecondary}>
              Batal
            </button>
          </div>

          <div className="space-y-2">
            {area.map((a) => {
              const v = isian[a.id] ?? { bersih: true, catatan: "", foto: null };
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border p-3 ${
                    v.bersih ? "border-stone-200" : "border-red-300 bg-red-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-stone-800">{a.nama}</div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => set(a.id, { bersih: true })}
                          className={`rounded-full px-3 py-1 text-sm font-medium ${
                            v.bersih
                              ? "bg-green-600 text-white"
                              : "bg-white text-stone-600 ring-1 ring-stone-300"
                          }`}
                        >
                          ✓ Bersih
                        </button>
                        <button
                          type="button"
                          onClick={() => set(a.id, { bersih: false })}
                          className={`rounded-full px-3 py-1 text-sm font-medium ${
                            !v.bersih
                              ? "bg-red-600 text-white"
                              : "bg-white text-stone-600 ring-1 ring-stone-300"
                          }`}
                        >
                          ✕ Belum
                        </button>
                      </div>
                      {!v.bersih && (
                        <input
                          value={v.catatan}
                          onChange={(e) => set(a.id, { catatan: e.target.value })}
                          placeholder="Apa masalahnya?"
                          className={`${inputClass} mt-2`}
                        />
                      )}
                    </div>
                    <ImageUpload
                      compact
                      value={v.foto}
                      onChange={(url) => set(a.id, { foto: url })}
                      tujuan="bukti"
                      placeholder="📷"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <label className="mb-1 mt-4 block text-xs font-medium text-stone-500">
            Catatan untuk owner (opsional)
          </label>
          <input
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="mis. sabun pel habis"
            className={inputClass}
          />

          <ErrorText error={kirim.error} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => kirim.mutate()}
              disabled={!adaFoto || kirim.isPending}
              className={btnPrimary}
            >
              {kirim.isPending ? "Mengirim…" : editId ? "Perbarui Laporan" : "Kirim Laporan"}
            </button>
            {!adaFoto && (
              <span className="text-sm text-red-600">
                Lampirkan minimal 1 foto bukti sebelum mengirim.
              </span>
            )}
            {adaFoto && jumlahKotor > 0 && (
              <span className="text-sm text-stone-500">{jumlahKotor} area ditandai belum bersih</span>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-2 text-sm text-stone-500">{formatTanggal(hariIni)}</div>
          {/*
            Kalau "laporan saya" gagal dibaca, `perSesi` kosong dan KETIGA kartu
            menyatakan "Belum diisi" — padahal laporannya mungkin sudah ada.
            Yang mengisinya lalu menandai ulang seluruh area, mengunggah ulang
            fotonya, menekan Kirim, dan server menolak 409 "sudah dibuat —
            perbarui laporan yang ada": kartunya sendiri tak pernah menawarkan
            jalan ke laporan itu, karena ia mengira belum ada. Statusnya
            dikatakan apa adanya: TIDAK TERBACA.
          */}
          {gagalLaporan && (
            <Card className="mb-3 border-amber-300 bg-amber-50 p-3">
              <ErrorText error={gagalLaporan} />
              <div className="text-sm text-amber-900">
                Status laporan hari ini <b>tidak terbaca</b>, jadi ketiga sesi di bawah belum tentu
                kosong. Muat ulang halaman dulu — mengirim laporan sekarang bisa ditolak sebagai
                laporan ganda.
              </div>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {SESI_KEBERSIHAN.map((s) => {
              const ada = perSesi.get(s.kode);
              return (
                <Card
                  key={s.kode}
                  onClick={() => bukaSesi(s.kode)}
                  className="cursor-pointer p-4 transition hover:border-orange-300"
                >
                  <div className="text-2xl">{s.emoji}</div>
                  <div className="mt-1 font-semibold text-stone-800">{s.label}</div>
                  {ada ? (
                    <div className="mt-2 text-sm">
                      <span className="font-medium text-green-600">
                        ✓ Terkirim {formatWaktu(ada.created_at)}
                      </span>
                      <div className="text-xs text-stone-500">
                        {ada.area_bersih}/{ada.total_area} bersih · 📷 {ada.jumlah_foto}
                      </div>
                      {ada.catatan_owner && (
                        <div className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          💬 {ada.catatan_owner}
                        </div>
                      )}
                    </div>
                  ) : gagalLaporan ? (
                    <div className="mt-2 text-sm text-amber-700">Status tidak terbaca</div>
                  ) : (
                    <div className="mt-2 text-sm text-stone-400">Belum diisi — ketuk untuk mengisi</div>
                  )}
                </Card>
              );
            })}
          </div>

          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Laporan saya (14 hari terakhir)
          </h2>
          {isLoading ? (
            <Spinner />
          ) : gagalLaporan ? (
            <Card className="p-6 text-center text-sm text-stone-500">
              Riwayat laporan tidak dapat dimuat — <b>bukan</b> berarti belum pernah melapor.
            </Card>
          ) : laporan.length === 0 ? (
            <Card className="p-6 text-center text-sm text-stone-500">Belum ada laporan.</Card>
          ) : (
            <div className="space-y-2">
              {laporan.map((l) => (
                <Card key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <span className="font-medium text-stone-700">{formatTanggal(l.tanggal)}</span>
                  <span className="text-stone-500">{labelSesiKebersihan(l.sesi)}</span>
                  <span className={l.area_kotor > 0 ? "text-red-600" : "text-green-600"}>
                    {l.area_bersih}/{l.total_area} bersih
                  </span>
                  <span className="text-stone-400">📷 {l.jumlah_foto}</span>
                  {l.catatan_owner && (
                    <span className="w-full rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      💬 {l.catatan_owner}
                      {l.catatan_owner_oleh && ` — ${l.catatan_owner_oleh}`}
                    </span>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
