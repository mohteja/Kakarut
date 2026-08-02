import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SelisihKasRow, Shift, ShiftPantauRow } from "@kakarut/shared";
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
import { ShiftDetailModal } from "../../components/ShiftDetailModal";
import { api } from "../../lib/api";
import { formatRupiah, formatTanggalRingkas, formatWaktu } from "../../lib/format";

/** Label + warna selisih kas (fisik − seharusnya). */
function selisihInfo(selisih: number | null) {
  if (selisih == null) return { label: "—", warna: "text-stone-500" };
  if (Math.abs(selisih) < 0.005) return { label: "Pas", warna: "text-green-600" };
  if (selisih < 0) return { label: `Kurang ${formatRupiah(-selisih)}`, warna: "text-red-600" };
  return { label: `Lebih ${formatRupiah(selisih)}`, warna: "text-amber-600" };
}

/**
 * Selisih kas yang menunggu keputusan owner, DARI SEMUA CABANG.
 *
 * Sengaja dipisah dari kartu per-cabang di bawahnya: selisih yang belum
 * diputuskan bisa berasal dari shift kemarin di cabang yang hari ini belum
 * buka — kalau hanya muncul di riwayat per cabang, ia harus dicari, dan yang
 * harus dicari tidak akan ketemu.
 */
function PerluAccPanel({ onDetail }: { onDetail: (id: string) => void }) {
  const { data = [] } = useQuery({
    queryKey: ["shift-selisih", "menunggu"],
    queryFn: () => api<SelisihKasRow[]>("/shift/selisih?status=menunggu"),
    refetchInterval: 60_000,
  });
  if (data.length === 0) return null;
  return (
    <Card className="mb-4 border-amber-300 bg-amber-50/60 p-4">
      <div className="mb-2 text-sm font-bold text-amber-900">
        ⏳ Selisih kas menunggu keputusan Anda ({data.length})
      </div>
      <div className="space-y-2">
        {data.map((s) => {
          const info = selisihInfo(s.selisih);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onDetail(s.id)}
              className="block w-full rounded-lg border border-amber-200 bg-white p-3 text-left transition hover:border-amber-400"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-800">📍 {s.branch_nama}</div>
                  <div className="text-xs text-stone-500">
                    🔒 {s.ditutup_oleh || "—"}
                    {s.ditutup_pada
                      ? ` · ${formatTanggalRingkas(s.ditutup_pada)} ${formatWaktu(s.ditutup_pada)}`
                      : ""}
                  </div>
                  {s.catatan && <div className="mt-0.5 text-xs text-stone-500">📝 {s.catatan}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-sm font-bold ${info.warna}`}>{info.label}</div>
                  <div className="text-xs text-stone-400">
                    fisik {formatRupiah(s.uang_fisik)} · sistem {formatRupiah(s.kas_sistem)}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-orange-600">Putuskan ›</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function Stat({ label, value, warna = "text-stone-800" }: { label: string; value: string; warna?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-2.5">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${warna}`}>{value}</div>
    </div>
  );
}

/** Satu kartu cabang: status kasir + rekap hari ini + jam operasional (editable). */
function KartuCabang({
  row,
  onRiwayat,
}: {
  row: ShiftPantauRow;
  onRiwayat: () => void;
}) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  /**
   * Nilai awal ini SEKALI PAKAI — `useState` hanya memakainya saat komponen
   * pertama dipasang, dan kartu ini tak pernah dipasang ulang: kuncinya
   * `branch_id` yang tetap, sementara halamannya menarik `/shift/pantau` tiap
   * 60 detik. Jadi isinya membeku pada keadaan saat halaman dibuka, bisa
   * berjam-jam lalu. Karena itu editor di bawah MENYEMAI ULANG saat dibuka.
   */
  const [jamBuka, setJamBuka] = useState(row.jam_buka ?? "");
  const [jamTutup, setJamTutup] = useState(row.jam_tutup ?? "");

  const simpan = useMutation({
    mutationFn: () =>
      api(`/cabang/${row.branch_id}`, {
        method: "PATCH",
        body: { jam_buka: jamBuka || null, jam_tutup: jamTutup || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-pantau"] });
      qc.invalidateQueries({ queryKey: ["cabang"] });
      setEdit(false);
    },
  });

  const buka = row.shift_id != null;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-stone-800">📍 {row.branch_nama}</div>
          <div className="mt-0.5 text-xs text-stone-500">
            Jam operasional:{" "}
            {row.jam_buka || row.jam_tutup ? (
              <b className="text-stone-700">
                {row.jam_buka ?? "—"}–{row.jam_tutup ?? "—"}
              </b>
            ) : (
              <span className="text-stone-400">belum diatur</span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            buka ? "bg-green-100 text-green-700" : "bg-stone-200 text-stone-600"
          }`}
        >
          {buka ? "Kasir Buka" : "Kasir Tutup"}
        </span>
      </div>

      {/* Tanda peringatan operasional */}
      {(row.telat_buka || row.lupa_tutup) && (
        <div className="mt-2 space-y-1">
          {row.telat_buka && (
            <div className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
              ⚠️ Telat buka — sudah lewat jam buka tapi kasir belum dibuka hari ini
            </div>
          )}
          {row.lupa_tutup && (
            <div className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
              ⚠️ Lupa tutup — kasir masih terbuka padahal sudah lewat jam tutup
            </div>
          )}
        </div>
      )}

      {/* Siapa buka (bila terbuka) */}
      {buka && (
        <div className="mt-2 text-xs text-stone-500">
          🔓 Dibuka oleh <b className="text-stone-700">{row.dibuka_oleh}</b>
          {row.dibuka_pada ? ` · ${formatWaktu(row.dibuka_pada)}` : ""}
        </div>
      )}

      {/* Rekap hari ini */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Transaksi hari ini" value={`${row.jumlah_transaksi}×`} />
        <Stat label="Penjualan tunai" value={formatRupiah(row.penjualan_tunai)} />
        <Stat label="Non-tunai" value={formatRupiah(row.penjualan_nontunai)} />
        <Stat
          label="Kas seharusnya"
          value={buka ? formatRupiah(row.kas_sistem) : "—"}
          warna="text-orange-600"
        />
      </div>

      {/* Aksi */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onRiwayat} className={btnSecondary}>
          🕑 Riwayat shift
        </button>
        {!edit && (
          /*
            SEMAI ULANG SAAT DIBUKA — bukan sekadar `setEdit(true)`.
            Baris "Jam operasional" di atas dibaca dari `row`, jadi ia ikut
            hasil penarikan terbaru; isian di bawah tidak. Tanpa penyemaian
            ini keduanya bisa berbeda di layar yang sama: kartunya menampilkan
            08:00 yang baru diatur admin lain, editornya terbuka kosong.
            Menekan Simpan lalu mengirim yang kosong itu — dan kosong berarti
            `jam_buka` null, yang MEMATIKAN peringatan "telat buka"/"lupa
            tutup" cabang tersebut (`telat_buka` disyaratkan `Boolean(jam_buka)`).
            Tombol Batal di bawah memang sudah menyemai ulang; membukanya pun
            harus.
          */
          <button
            type="button"
            onClick={() => {
              setJamBuka(row.jam_buka ?? "");
              setJamTutup(row.jam_tutup ?? "");
              setEdit(true);
            }}
            className={btnSecondary}
          >
            🕐 Atur jam operasional
          </button>
        )}
      </div>

      {/* Editor jam operasional */}
      {edit && (
        <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Jam buka</label>
              <input
                type="time"
                value={jamBuka}
                onChange={(e) => setJamBuka(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Jam tutup</label>
              <input
                type="time"
                value={jamTutup}
                onChange={(e) => setJamTutup(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <ErrorText error={simpan.error} />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => simpan.mutate()}
              disabled={simpan.isPending}
              className={btnPrimary}
            >
              {simpan.isPending ? "Menyimpan…" : "Simpan"}
            </button>
            <button
              type="button"
              onClick={() => {
                setJamBuka(row.jam_buka ?? "");
                setJamTutup(row.jam_tutup ?? "");
                setEdit(false);
              }}
              className={btnSecondary}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                setJamBuka("");
                setJamTutup("");
              }}
              className="ml-auto text-xs text-stone-500 hover:underline"
            >
              Kosongkan
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Modal daftar riwayat shift satu cabang → klik untuk detail. */
function RiwayatCabangModal({
  branch,
  onClose,
  onDetail,
}: {
  branch: { id: string; nama: string } | null;
  onClose: () => void;
  onDetail: (id: string) => void;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["shift-riwayat", branch?.id],
    queryFn: () => api<Shift[]>(`/shift?branch_id=${branch!.id}`),
    enabled: !!branch,
  });
  return (
    <Modal open={!!branch} onClose={onClose} title={`Riwayat Shift — ${branch?.nama ?? ""}`} lebar="max-w-xl">
      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <div className="p-4 text-center text-sm text-stone-400">Belum ada shift ditutup di cabang ini.</div>
      ) : (
        <div className="space-y-2">
          {data.map((s) => {
            const info = selisihInfo(s.selisih);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onDetail(s.id)}
                className="block w-full rounded-lg border border-stone-200 p-3 text-left transition hover:border-orange-300 hover:bg-orange-50/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-stone-800">
                      {formatTanggalRingkas(s.dibuka_pada)} · {formatWaktu(s.dibuka_pada)} –{" "}
                      {s.ditutup_pada ? formatWaktu(s.ditutup_pada) : "—"}
                    </div>
                    <div className="text-xs text-stone-500">
                      🔓 {s.dibuka_oleh || "—"} · 🔒 {s.ditutup_oleh || "—"}
                    </div>
                    <div className="text-xs text-stone-400">
                      {s.jumlah_transaksi}× · tunai {formatRupiah(s.penjualan_tunai ?? 0)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-sm font-bold ${info.warna}`}>{info.label}</div>
                    {/* selisih yang belum diputuskan owner — biar tak terlewat */}
                    {s.status_selisih === "menunggu" && (
                      <div className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        ⏳ Perlu ACC
                      </div>
                    )}
                    <div className="mt-0.5 text-xs font-medium text-orange-600">Detail ›</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/**
 * Operasional Cabang (owner/admin): pantau status kasir tiap cabang store,
 * penjualan hari ini, jam operasional (dengan tanda telat buka / lupa tutup),
 * plus riwayat shift & detail per shift. Read-only atas shift — buka/tutup
 * tetap dilakukan kasir di cabang.
 */
export function OperasionalPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["shift-pantau"],
    queryFn: () => api<ShiftPantauRow[]>("/shift/pantau"),
    refetchInterval: 60_000,
  });
  const [riwayatBranch, setRiwayatBranch] = useState<{ id: string; nama: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageTitle>🕐 Operasional Cabang</PageTitle>
      <p className="mb-4 text-sm text-stone-500">
        Pantau status kasir tiap cabang, penjualan hari ini, dan jam operasional. Sistem menandai
        cabang yang <b>telat buka</b> atau <b>lupa tutup</b> kasir. Buka/tutup kasir tetap dilakukan
        oleh kasir di cabang.
      </p>

      <PerluAccPanel onDetail={setDetailId} />

      {data.length === 0 ? (
        <Card className="p-8 text-center text-sm text-stone-400">
          Belum ada cabang store. Tambahkan cabang di Pengaturan → Cabang.
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((row) => (
            <KartuCabang
              key={row.branch_id}
              row={row}
              onRiwayat={() => setRiwayatBranch({ id: row.branch_id, nama: row.branch_nama })}
            />
          ))}
        </div>
      )}

      <RiwayatCabangModal
        branch={riwayatBranch}
        onClose={() => setRiwayatBranch(null)}
        onDetail={(id) => setDetailId(id)}
      />
      <ShiftDetailModal shiftId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
