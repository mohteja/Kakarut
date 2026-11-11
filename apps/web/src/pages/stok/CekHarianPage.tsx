import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  OPNAME_JUMLAH_TIAP_HARI,
  angkaDari,
  type CekHarianStatusDto,
  type OpnameRingkasan,
  type OpnameSimpanHasil,
  type PenyimpananDto,
  type StokRowDto,
} from "@kakarut/shared";
import { CabangDataBar } from "../../components/CabangDataBar";
import { Card, ErrorText, PageTitle, SpinnerAtauGalat, btnPrimary, btnSecondary, inputClass } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, formatTanggalJam } from "../../lib/format";
import { uuidV4 } from "../../lib/idempoten";

/**
 * CEK STOK HARIAN — permintaan pemilik (2026-11-11): saat closing cukup
 * menandai tiap bahan SESUAI / TIDAK SESUAI dengan catatan sistem, tanpa
 * menyebut jumlah, supaya cepat dan bisa langsung pulang.
 *
 * Bahan TIDAK SESUAI langsung dihitung di sini — jumlahnya dikirim lewat
 * `POST /stok/opname` (selisih, ACC owner, dan baseline saldo persis seperti
 * opname biasa), lalu sesinya ditautkan ke cek harian. Opname JUMLAH lengkap
 * dikerjakan mingguan dari menu Opname Bahan Baku.
 */
type Tanda = "sesuai" | "tidak";
const TANPA_TEMPAT = "Tanpa tempat";

export function CekHarianPage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const terikat =
    auth?.user.role === "cashier" ||
    auth?.user.role === "tim" ||
    auth?.user.role === "kitchen" ||
    auth?.user.role === "bar";
  const myId = auth?.user.sub;

  const { data: stok, error: gagalStok, refetch: muatStok } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });
  const { data: tempatList, error: gagalTempat } = useQuery({
    queryKey: ["penyimpanan", branchQuery],
    queryFn: () => api<PenyimpananDto[]>(`/penyimpanan${branchQuery}`),
  });
  const { data: status, error: gagalStatus } = useQuery({
    queryKey: ["cek-harian", branchQuery],
    queryFn: () => api<CekHarianStatusDto>(`/stok/cek-harian${branchQuery}`),
  });

  // Peran terikat cabang hanya mengecek rak yang terbuka atau ditugaskan
  // padanya — aturan yang sama dengan opname (server juga menegakkannya).
  const bahan = useMemo(() => {
    const petugasByLoc = new Map((tempatList ?? []).map((t) => [t.id, t.petugas]));
    return (stok ?? []).filter((s) => {
      if (!terikat || !s.tempat_id) return true;
      const p = (petugasByLoc.get(s.tempat_id) ?? []).filter((x) => x.aktif !== false);
      return p.length === 0 || p.some((x) => x.user_id === myId);
    });
  }, [stok, tempatList, terikat, myId]);
  const perTempat = useMemo(() => {
    const m = new Map<string, StokRowDto[]>();
    for (const s of bahan) {
      const k = s.tempat ?? TANPA_TEMPAT;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [bahan]);

  const [tanda, setTanda] = useState<Record<string, Tanda>>({});
  const [fisik, setFisik] = useState<Record<string, string>>({});
  const [alasan, setAlasan] = useState<Record<string, string>>({});
  const [hasil, setHasil] = useState<{ sesuai: number; tidak: number; ringkasan: OpnameRingkasan | null } | null>(
    null,
  );
  // Sekali per pengisian: kirim ulang (jaringan putus) tak menggandakan sesi.
  const refSesi = useRef<string | null>(null);
  const refOpname = useRef<string | null>(null);

  const belumDitandai = bahan.filter((s) => !tanda[s.ingredient_id]);
  const tidakSesuai = bahan.filter((s) => tanda[s.ingredient_id] === "tidak");
  const belumDihitung = tidakSesuai.filter((s) => (fisik[s.ingredient_id] ?? "").trim() === "" || Number.isNaN(angkaDari(fisik[s.ingredient_id])));

  const simpan = useMutation({
    mutationFn: async () => {
      const cabang = !terikat && branchId ? { branch_id: branchId } : {};
      let opnameSessionId: string | null = null;
      let ringkasan: OpnameRingkasan | null = null;
      if (tidakSesuai.length > 0) {
        const op = await api<OpnameSimpanHasil>("/stok/opname", {
          method: "POST",
          body: {
            ...cabang,
            client_ref: (refOpname.current ??= uuidV4()),
            catatan: "Cek harian — bahan tidak sesuai",
            items: tidakSesuai.map((s) => ({
              ingredient_id: s.ingredient_id,
              qty: angkaDari(fisik[s.ingredient_id]),
              alasan: alasan[s.ingredient_id]?.trim() || null,
            })),
          },
        });
        opnameSessionId = op.session_id;
        ringkasan = op.ringkasan;
      }
      await api("/stok/cek-harian", {
        method: "POST",
        body: {
          ...cabang,
          sesi_id: (refSesi.current ??= uuidV4()),
          opname_session_id: opnameSessionId,
          items: bahan.map((s) => ({ ingredient_id: s.ingredient_id, sesuai: tanda[s.ingredient_id] === "sesuai" })),
        },
      });
      const sesuai = bahan.filter((s) => tanda[s.ingredient_id] === "sesuai").length;
      return { sesuai, tidak: tidakSesuai.length, ringkasan };
    },
    onSuccess: (h) => {
      setHasil(h);
      setTanda({});
      setFisik({});
      setAlasan({});
      refSesi.current = null;
      refOpname.current = null;
      queryClient.invalidateQueries({ queryKey: ["cek-harian"] });
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["opname-riwayat"] });
    },
  });

  const gagal = gagalStok ?? gagalTempat;
  return (
    <div className="max-w-3xl">
      <PageTitle
        aksi={
          <Link to="/stok/opname" className={btnSecondary}>
            📋 Opname jumlah
          </Link>
        }
      >
        ✅ Cek Stok Harian
      </PageTitle>
      <CabangDataBar />
      <div className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Cukup tandai tiap bahan <b>Sesuai</b> atau <b>Tidak sesuai</b> dengan catatan sistem — tanpa menghitung.
        Bahan yang tidak sesuai langsung dihitung jumlahnya di sini. Opname jumlah lengkap dikerjakan
        mingguan.
      </div>

      {status ? (
        <Card className="mb-3 space-y-1 p-3 text-sm" >
          <div data-testid="status-cek-harian">
            {status.sudah_cek_hari_ini ? (
              <span className="font-semibold text-green-700">✅ Hari ini sudah dicek.</span>
            ) : (
              <span className="font-semibold text-amber-700">⏳ Hari ini belum dicek.</span>
            )}
          </div>
          <div
            className={status.opname_jumlah_jatuh_tempo ? "font-semibold text-red-700" : "text-stone-600"}
            data-testid="status-opname-mingguan"
          >
            {status.opname_jumlah_terakhir
              ? `Opname jumlah terakhir ${formatTanggal(status.opname_jumlah_terakhir)} (${status.hari_sejak_opname_jumlah} hari lalu).`
              : "Belum pernah opname jumlah di cabang ini."}
            {status.opname_jumlah_jatuh_tempo && (
              <>
                {" "}
                Sudah waktunya opname jumlah mingguan (tiap {OPNAME_JUMLAH_TIAP_HARI} hari) —{" "}
                <Link to="/stok/opname" className="underline">
                  kerjakan
                </Link>
                .
              </>
            )}
          </div>
        </Card>
      ) : (
        <ErrorText error={gagalStatus} />
      )}

      {hasil && (
        <Card className="mb-3 border-green-300 bg-green-50 p-3 text-sm text-green-800" >
          <div data-testid="hasil-cek-harian">
            ✅ Cek harian tersimpan — {hasil.sesuai} sesuai, {hasil.tidak} tidak sesuai.
            {hasil.ringkasan && hasil.ringkasan.lebih + hasil.ringkasan.kurang > 0 && (
              <> Selisihnya menunggu persetujuan owner/admin di Riwayat SO.</>
            )}
          </div>
        </Card>
      )}

      {!stok || !tempatList ? (
        <SpinnerAtauGalat error={gagal} apa="Daftar bahan" onCoba={() => void muatStok()} />
      ) : bahan.length === 0 ? (
        <p className="text-sm text-stone-500">Tak ada bahan yang dilacak stoknya untuk dicek.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={() =>
                setTanda(Object.fromEntries(bahan.map((s) => [s.ingredient_id, tanda[s.ingredient_id] ?? "sesuai"])))
              }
              data-testid="tandai-semua-sesuai"
            >
              ✅ Sisanya sesuai semua
            </button>
            <span className="text-xs text-stone-500">
              {Object.keys(tanda).length}/{bahan.length} ditandai
              {tidakSesuai.length > 0 ? ` · ${tidakSesuai.length} tidak sesuai` : ""}
            </span>
          </div>

          <div className="space-y-3">
            {perTempat.map(([tempat, isi]) => (
              <Card key={tempat} className="p-2">
                <div className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-stone-400">{tempat}</div>
                <ul className="divide-y divide-stone-100">
                  {isi.map((s) => {
                    const t = tanda[s.ingredient_id];
                    return (
                      <li key={s.ingredient_id} className="px-1 py-2" data-testid="baris-cek-harian">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-stone-800">{s.nama}</div>
                            <div className="text-xs text-stone-500">
                              Sistem: {formatAngka(s.saldo)} {s.satuan}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTanda({ ...tanda, [s.ingredient_id]: "sesuai" })}
                            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                              t === "sesuai" ? "bg-green-600 text-white" : "bg-white text-stone-600 ring-1 ring-stone-300"
                            }`}
                          >
                            ✅ Sesuai
                          </button>
                          <button
                            type="button"
                            onClick={() => setTanda({ ...tanda, [s.ingredient_id]: "tidak" })}
                            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                              t === "tidak" ? "bg-red-600 text-white" : "bg-white text-stone-600 ring-1 ring-stone-300"
                            }`}
                          >
                            ❌ Tidak sesuai
                          </button>
                        </div>
                        {t === "tidak" && (
                          <div className="mt-2 grid gap-2 rounded-lg bg-red-50 p-2 sm:grid-cols-2">
                            <label className="text-xs text-red-800">
                              Jumlah fisik ({s.satuan})
                              <input
                                inputMode="decimal"
                                value={fisik[s.ingredient_id] ?? ""}
                                onChange={(e) => setFisik({ ...fisik, [s.ingredient_id]: e.target.value })}
                                className={inputClass}
                                aria-label={`Jumlah fisik ${s.nama}`}
                              />
                            </label>
                            <label className="text-xs text-red-800">
                              Alasan (opsional)
                              <input
                                value={alasan[s.ingredient_id] ?? ""}
                                maxLength={200}
                                onChange={(e) => setAlasan({ ...alasan, [s.ingredient_id]: e.target.value })}
                                className={inputClass}
                              />
                            </label>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>

          <ErrorText error={simpan.error} />
          <div className="sticky bottom-0 mt-3 bg-stone-50/90 py-3">
            {belumDitandai.length > 0 && (
              <p className="mb-2 text-xs text-amber-700">{belumDitandai.length} bahan belum ditandai.</p>
            )}
            {belumDitandai.length === 0 && belumDihitung.length > 0 && (
              <p className="mb-2 text-xs text-red-700">
                Isi jumlah fisik bahan yang tidak sesuai: {belumDihitung.map((s) => s.nama).join(", ")}.
              </p>
            )}
            <button
              type="button"
              className={`${btnPrimary} w-full`}
              disabled={simpan.isPending || belumDitandai.length > 0 || belumDihitung.length > 0}
              onClick={() => simpan.mutate()}
            >
              {simpan.isPending ? "Menyimpan…" : "Simpan cek harian"}
            </button>
          </div>
        </>
      )}

      {status && status.riwayat.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold text-stone-700">Riwayat cek harian</h2>
          <Card className="divide-y divide-stone-100">
            {status.riwayat.map((r) => (
              <div key={r.sesi_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  {formatTanggalJam(r.waktu)}
                  {r.oleh ? ` · ${r.oleh}` : ""}
                </span>
                <span className={r.tidak_sesuai > 0 ? "font-semibold text-red-700" : "text-green-700"}>
                  {r.sesuai} sesuai{r.tidak_sesuai > 0 ? ` · ${r.tidak_sesuai} tidak sesuai` : ""}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
