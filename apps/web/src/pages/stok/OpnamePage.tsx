import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { OpnameRingkasan, PenyimpananDto, StokRowDto } from "@kakarut/shared";
import { ErrorText, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";

/**
 * Stock opname mobile-first (layar penuh, tanpa sidebar): hitung stok fisik
 * langsung di device, bandingkan dengan sistem, lihat selisih, simpan.
 */
export function OpnamePage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Peran terikat cabang (kasir & tim) hanya melihat/opname tempat yang
  // ditugaskan padanya (atau terbuka) — owner/admin bebas.
  const terikat = auth?.user.role === "cashier" || auth?.user.role === "tim";

  const { data: stok } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  const { data: tempatList = [] } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });

  const [fisik, setFisik] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [filterTempat, setFilterTempat] = useState("semua");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [hasil, setHasil] = useState<OpnameRingkasan | null>(null);

  // Nama CABANG TARGET opname harus tampak: owner dari Kantor menulis ke
  // cabang data terpilih — salah cabang tidak boleh terjadi diam-diam.
  const { cabang } = useBranch();
  const namaCabang =
    cabang.find((b) => b.id === branchId)?.nama ??
    auth?.branch?.nama ??
    auth?.company?.nama ??
    "Cabang";
  const myId = auth?.user.sub;

  const petugasByLoc = useMemo(() => {
    const m = new Map<string, PenyimpananDto["petugas"]>();
    for (const t of tempatList) m.set(t.id, t.petugas);
    return m;
  }, [tempatList]);

  // tempat yang ditampilkan sebagai filter (kasir: hanya yang boleh diopname)
  const tempatBoleh = useMemo(() => {
    if (!terikat) return tempatList;
    return tempatList.filter((t) => {
      const p = t.petugas;
      return p.length === 0 || p.some((x) => x.user_id === myId);
    });
  }, [tempatList, terikat, myId]);

  const tampil = useMemo(() => {
    return (stok ?? [])
      .filter((s) => s.nama.toLowerCase().includes(cari.toLowerCase()))
      .filter((s) => {
        if (!terikat || !s.tempat_id) return true;
        const p = petugasByLoc.get(s.tempat_id) ?? [];
        return p.length === 0 || p.some((x) => x.user_id === myId);
      })
      .filter((s) =>
        filterTempat === "semua"
          ? true
          : filterTempat === "tanpa"
            ? s.tempat_id === null
            : s.tempat_id === filterTempat,
      );
  }, [stok, cari, filterTempat, terikat, petugasByLoc, myId]);

  const petugasTerpilih =
    filterTempat !== "semua" && filterTempat !== "tanpa"
      ? (petugasByLoc.get(filterTempat) ?? [])
      : null;

  const terisi = Object.entries(fisik).filter(([, v]) => v !== "").length;

  const simpan = useMutation({
    mutationFn: () => {
      const items = Object.entries(fisik)
        .filter(([, v]) => v !== "")
        .map(([ingredient_id, v]) => ({ ingredient_id, qty: Number(v) }));
      return api<{ ringkasan: OpnameRingkasan; session_id: string }>("/stok/opname", {
        method: "POST",
        body: {
          ...(!terikat && branchId ? { branch_id: branchId } : {}),
          items,
          catatan: "Opname mobile",
        },
      });
    },
    onSuccess: (data) => {
      setKonfirmasi(false);
      setHasil(data.ringkasan);
      setFisik({});
      queryClient.invalidateQueries({ queryKey: ["stok"] });
    },
  });

  function selisihDari(s: StokRowDto): number | null {
    const v = fisik[s.ingredient_id];
    if (v === undefined || v === "") return null;
    return Number(v) - s.saldo;
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
            Stok Opname — {auth?.branch?.nama ?? namaCabang}
          </div>
          <div className="text-xs text-stone-500">
            {formatTanggal(hariIniWIB())} · {terisi} dari {tampil.length} dihitung
          </div>
        </div>
        <Link to="/stok/opname/riwayat" className={`${btnSecondary} shrink-0`}>
          🕑
        </Link>
      </header>

      {/* Filter */}
      <div className="sticky top-[57px] z-10 space-y-2 border-b border-stone-200 bg-white px-4 py-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterTempat("semua")}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${filterTempat === "semua" ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600"}`}
          >
            Semua
          </button>
          {tempatBoleh.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilterTempat(t.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${filterTempat === t.id ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600"}`}
            >
              {t.nama}
            </button>
          ))}
          <button
            onClick={() => setFilterTempat("tanpa")}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${filterTempat === "tanpa" ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600"}`}
          >
            Tanpa tempat
          </button>
        </div>
        {petugasTerpilih !== null && (
          <div className="text-xs text-stone-500">
            👤 Petugas opname:{" "}
            {petugasTerpilih.length === 0 ? (
              <span className="text-stone-400">semua boleh (belum diatur)</span>
            ) : (
              <span className="font-medium text-stone-600">
                {petugasTerpilih.map((p) => p.nama).join(", ")}
              </span>
            )}
          </div>
        )}
        {terikat && (
          <div className="text-xs text-stone-400">
            Anda hanya melihat bahan di tempat yang boleh Anda opname.
          </div>
        )}
      </div>

      {/* Kartu bahan */}
      <main className="flex-1 space-y-2 p-3 pb-28">
        {tampil.map((s) => {
          const selisih = selisihDari(s);
          return (
            <div key={s.ingredient_id} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-stone-800">{s.nama}</div>
                  <div className="text-sm text-stone-500">
                    Sistem: <b className="text-stone-700">{formatAngka(s.saldo)} {s.satuan}</b>
                    {s.tempat && <span className="ml-1 text-stone-400">· {s.tempat}</span>}
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
                  value={fisik[s.ingredient_id] ?? ""}
                  onChange={(e) =>
                    setFisik({ ...fisik, [s.ingredient_id]: e.target.value })
                  }
                  placeholder="Stok fisik…"
                  className="h-12 flex-1 rounded-lg border border-stone-300 px-3 text-lg font-semibold focus:border-orange-500 focus:outline-none"
                />
                <button
                  onClick={() =>
                    setFisik({ ...fisik, [s.ingredient_id]: String(s.saldo) })
                  }
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
          <div className="py-10 text-center text-sm text-stone-400">Tidak ada bahan.</div>
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setKonfirmasi(false)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold text-stone-800">Konfirmasi Opname</h2>
            <p className="mb-3 text-sm text-stone-600">
              {terisi} bahan akan disesuaikan ke stok fisik. Bahan yang tidak diisi tidak
              berubah. Selisih akan tercatat di riwayat.
            </p>
            <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {(stok ?? [])
                .filter((s) => fisik[s.ingredient_id] !== undefined && fisik[s.ingredient_id] !== "")
                .map((s) => {
                  const sel = selisihDari(s)!;
                  return (
                    <div key={s.ingredient_id} className="flex justify-between text-sm">
                      <span className="text-stone-700">{s.nama}</span>
                      <span
                        className={
                          Math.abs(sel) < 1e-9
                            ? "text-green-600"
                            : sel > 0
                              ? "text-yellow-700"
                              : "text-red-600"
                        }
                      >
                        {formatAngka(s.saldo)} → {formatAngka(Number(fisik[s.ingredient_id]))}
                        {Math.abs(sel) >= 1e-9 && ` (${sel > 0 ? "+" : ""}${formatAngka(sel)})`}
                      </span>
                    </div>
                  );
                })}
            </div>
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
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-2xl font-bold text-green-600">{hasil.cocok}</div>
                <div className="text-stone-500">Cocok</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-700">{hasil.lebih}</div>
                <div className="text-stone-500">Lebih</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{hasil.kurang}</div>
                <div className="text-stone-500">Kurang</div>
              </div>
            </div>
            {hasil.lebih + hasil.kurang > 0 && (
              <div className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-800">
                Ada <b>{hasil.lebih + hasil.kurang} selisih</b>. <b>Stok belum berubah</b> —
                menunggu <b>ACC owner/admin</b> di Riwayat Opname. Setelah di-ACC, stok baru
                disesuaikan ke hitungan fisik.
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => navigate("/stok")} className={`${btnSecondary} flex-1`}>
                Ke Stok
              </button>
              <button
                onClick={() => navigate("/stok/opname/riwayat")}
                className={`${btnPrimary} flex-1`}
              >
                Lihat Riwayat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
