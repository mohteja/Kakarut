import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PerlengkapanRowDto } from "@kakarut/shared";
import { ErrorText, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";

/**
 * Opname perlengkapan mobile-first (layar penuh, tanpa sidebar) — dilakukan
 * staf CABANG maupun CK dari halaman Stok. Pemakaian perlengkapan dicatat
 * lewat opname ini: hitung fisik, selisih menunggu ACC owner/admin.
 */
export function OpnamePerlengkapanPage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();

  const { data: rows = [] } = useQuery({
    queryKey: ["perlengkapan", branchQuery],
    queryFn: () => api<PerlengkapanRowDto[]>(`/perlengkapan${branchQuery}`),
  });

  const [fisik, setFisik] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [hasil, setHasil] = useState<{ nomor: string | null; jumlah_selisih: number } | null>(
    null,
  );

  // Nama CABANG TARGET opname harus tampak: owner dari Kantor menulis ke
  // cabang data terpilih — salah cabang tidak boleh terjadi diam-diam.
  const { cabang } = useBranch();
  const namaCabang =
    cabang.find((b) => b.id === branchId)?.nama ??
    auth?.branch?.nama ??
    auth?.company?.nama ??
    "Cabang";

  const tampil = rows.filter((r) => r.nama.toLowerCase().includes(cari.toLowerCase()));
  const terisi = Object.entries(fisik).filter(([, v]) => v !== "").length;

  const simpan = useMutation({
    mutationFn: () => {
      const items = rows
        .filter((r) => fisik[r.id] !== undefined && fisik[r.id] !== "")
        .map((r) => ({ supply_id: r.id, qty_fisik: Number(fisik[r.id]) }));
      return api<{ session_id: string | null; nomor: string | null; jumlah_selisih: number }>(
        `/perlengkapan/opname${branchQuery}`,
        { method: "POST", body: { items, catatan: catatan.trim() || null } },
      );
    },
    onSuccess: (d) => {
      setKonfirmasi(false);
      setHasil({ nomor: d.nomor, jumlah_selisih: d.jumlah_selisih });
      setFisik({});
      setCatatan("");
      queryClient.invalidateQueries({ queryKey: ["perlengkapan"] });
    },
  });

  function selisihDari(r: PerlengkapanRowDto): number | null {
    const v = fisik[r.id];
    if (v === undefined || v === "") return null;
    return Number(v) - r.saldo;
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/stok" className="text-2xl text-stone-500" aria-label="Kembali">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-stone-800">
            🧰 Opname Perlengkapan — {namaCabang}
          </div>
          <div className="text-xs text-stone-500">
            {formatTanggal(hariIniWIB())} · {terisi} dari {tampil.length} dihitung
          </div>
        </div>
        <Link
          to="/stok/opname/riwayat?tab=perlengkapan"
          className={`${btnSecondary} shrink-0`}
          title="Riwayat opname perlengkapan (status ACC)"
        >
          🕑
        </Link>
      </header>

      {/* Filter */}
      <div className="sticky top-[57px] z-10 space-y-2 border-b border-stone-200 bg-white px-4 py-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari perlengkapan…"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
        />
        <div className="text-xs text-stone-400">
          Pemakaian perlengkapan dicatat lewat opname ini. Kosongkan item yang tidak
          dihitung — selisih menunggu ACC owner/admin.
        </div>
      </div>

      {/* Kartu perlengkapan */}
      <main className="flex-1 space-y-2 p-3 pb-28">
        {tampil.map((r) => {
          const selisih = selisihDari(r);
          return (
            <div key={r.id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-stone-800">{r.nama}</div>
                  <div className="text-sm text-stone-500">
                    Sistem:{" "}
                    <b className="text-stone-700">
                      {formatAngka(r.saldo)} {r.satuan}
                    </b>
                  </div>
                </div>
                {selisih !== null &&
                  (Math.abs(selisih) < 1e-9 ? (
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                      Cocok
                    </span>
                  ) : selisih > 0 ? (
                    <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                      Lebih {formatAngka(selisih)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                      Kurang {formatAngka(-selisih)}
                    </span>
                  ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={fisik[r.id] ?? ""}
                  onChange={(e) => setFisik({ ...fisik, [r.id]: e.target.value })}
                  placeholder="Stok fisik…"
                  className="h-12 flex-1 rounded-lg border border-stone-300 px-3 text-lg font-semibold focus:border-orange-500 focus:outline-none"
                />
                <button
                  onClick={() => setFisik({ ...fisik, [r.id]: String(r.saldo) })}
                  className="h-12 shrink-0 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-600"
                  title="Isi sama dengan sistem"
                >
                  = sistem
                </button>
              </div>
            </div>
          );
        })}
        {tampil.length === 0 && (
          <div className="py-10 text-center text-sm text-stone-400">
            {cari ? `Perlengkapan "${cari}" tidak ditemukan.` : "Belum ada perlengkapan terdaftar."}
          </div>
        )}
      </main>

      {/* Action bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
        <button
          onClick={() => setKonfirmasi(true)}
          disabled={terisi === 0}
          className={`${btnPrimary} w-full py-3 text-base`}
        >
          Simpan Opname ({terisi} dihitung)
        </button>
      </div>

      {/* Sheet konfirmasi */}
      {konfirmasi && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setKonfirmasi(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold text-stone-800">Konfirmasi Opname</h2>
            <p className="mb-3 text-sm text-stone-600">
              {terisi} perlengkapan dihitung. Selisih TIDAK langsung mengubah stok —
              menunggu ACC owner/admin.
            </p>
            <div className="mb-3 max-h-64 space-y-1 overflow-y-auto">
              {rows
                .filter((r) => fisik[r.id] !== undefined && fisik[r.id] !== "")
                .map((r) => {
                  const sel = selisihDari(r)!;
                  return (
                    <div key={r.id} className="flex justify-between text-sm">
                      <span className="text-stone-700">{r.nama}</span>
                      <span
                        className={
                          Math.abs(sel) < 1e-9
                            ? "text-green-600"
                            : sel > 0
                              ? "text-yellow-700"
                              : "text-red-600"
                        }
                      >
                        {formatAngka(r.saldo)} → {formatAngka(Number(fisik[r.id]))}
                        {Math.abs(sel) >= 1e-9 && ` (${sel > 0 ? "+" : ""}${formatAngka(sel)})`}
                      </span>
                    </div>
                  );
                })}
            </div>
            <label className="mb-3 block text-sm">
              Catatan (opsional)
              <input
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
              />
            </label>
            <ErrorText error={simpan.error} />
            <div className="flex gap-2">
              <button onClick={() => setKonfirmasi(false)} className={`${btnSecondary} flex-1`}>
                Batal
              </button>
              <button
                onClick={() => simpan.mutate()}
                disabled={simpan.isPending}
                className={`${btnPrimary} flex-1`}
              >
                {simpan.isPending ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet hasil */}
      {hasil && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 text-lg font-bold text-stone-800">Opname Tersimpan</h2>
            {hasil.nomor && (
              <div className="mt-1 inline-block rounded-md bg-orange-100 px-2 py-0.5 font-mono text-sm font-bold text-orange-800">
                {hasil.nomor}
              </div>
            )}
            {hasil.jumlah_selisih === 0 ? (
              <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-left text-sm text-green-800">
                Semua sesuai sistem — tidak ada selisih, stok tidak berubah.
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-800">
                Ada <b>{hasil.jumlah_selisih} selisih</b>. <b>Stok belum berubah</b> —
                menunggu <b>ACC owner/admin</b> (lihat tombol <b>🕑 Riwayat</b> di atas).
                Setelah di-ACC, stok disesuaikan ke hitungan fisik.
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Link
                to="/stok/opname/riwayat?tab=perlengkapan"
                className={`${btnSecondary} flex-1 text-center`}
              >
                🕑 Lihat Riwayat
              </Link>
              <button onClick={() => setHasil(null)} className={`${btnPrimary} flex-1`}>
                Opname Lagi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
