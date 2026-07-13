import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { StokRowDto } from "@kakarut/shared";
import { ErrorText, btnPrimary, btnSecondary } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBranch, useCabangData } from "../../context/BranchContext";
import { api } from "../../lib/api";
import { formatAngka, formatTanggal, hariIniWIB } from "../../lib/format";

/**
 * Stok Awal (saldo pembuka): catat stok yang SUDAH ADA sebelum memakai
 * aplikasi. Nilai yang diisi MENJADI saldo bahan (baseline) — bukan ditambah.
 * Owner/admin. Mobile-first, layar penuh seperti Opname.
 */
export function StokAwalPage() {
  const { auth } = useAuth();
  const { query: branchQuery, id: branchId } = useCabangData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: stok } = useQuery({
    queryKey: ["stok", branchQuery],
    queryFn: () => api<StokRowDto[]>(`/stok${branchQuery}`),
  });

  const [awal, setAwal] = useState<Record<string, string>>({});
  const [cari, setCari] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [selesai, setSelesai] = useState(false);

  const { cabang } = useBranch();
  const namaCabang =
    cabang.find((b) => b.id === branchId)?.nama ??
    auth?.branch?.nama ??
    auth?.company?.nama ??
    "Cabang";

  const tampil = useMemo(
    () => (stok ?? []).filter((s) => s.nama.toLowerCase().includes(cari.toLowerCase())),
    [stok, cari],
  );
  const terisi = Object.values(awal).filter((v) => v !== "").length;

  const simpan = useMutation({
    mutationFn: () => {
      const items = Object.entries(awal)
        .filter(([, v]) => v !== "")
        .map(([ingredient_id, v]) => ({ ingredient_id, qty: Number(v) }));
      return api<{ ok: true; jumlah: number }>("/stok/awal", {
        method: "POST",
        body: { ...(branchId ? { branch_id: branchId } : {}), items },
      });
    },
    onSuccess: () => {
      setKonfirmasi(false);
      setSelesai(true);
      setAwal({});
      queryClient.invalidateQueries({ queryKey: ["stok"] });
      queryClient.invalidateQueries({ queryKey: ["kartu"] });
    },
  });

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/stok" className="text-2xl text-stone-500" aria-label="Kembali">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-stone-800">Stok Awal — {namaCabang}</div>
          <div className="text-xs text-stone-500">
            {formatTanggal(hariIniWIB())} · {terisi} bahan diisi
          </div>
        </div>
      </header>

      <div className="border-b border-stone-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">
        Isi <b>stok yang sudah ada</b> sebelum memakai aplikasi. Nilai yang diisi{" "}
        <b>menjadi saldo</b> bahan (menggantikan baseline) — bukan ditambahkan. Bahan yang
        dikosongkan tidak berubah.
      </div>

      <div className="sticky top-[57px] z-10 border-b border-stone-200 bg-white px-4 py-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan…"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
        />
      </div>

      <main className="flex-1 space-y-2 p-3 pb-28">
        {tampil.map((s) => (
          <div key={s.ingredient_id} className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-stone-800">{s.nama}</div>
                <div className="text-sm text-stone-500">
                  Saldo kini: <b className="text-stone-700">{formatAngka(s.saldo)} {s.satuan}</b>
                  {s.tempat && <span className="ml-1 text-stone-400">· {s.tempat}</span>}
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={awal[s.ingredient_id] ?? ""}
                onChange={(e) => setAwal({ ...awal, [s.ingredient_id]: e.target.value })}
                placeholder={`Stok awal (${s.satuan})…`}
                className="h-12 flex-1 rounded-lg border border-stone-300 px-3 text-lg font-semibold focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
        ))}
        {tampil.length === 0 && (
          <div className="py-10 text-center text-sm text-stone-400">Tidak ada bahan.</div>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
        <button
          onClick={() => setKonfirmasi(true)}
          disabled={terisi === 0}
          className={`${btnPrimary} w-full py-3 text-base`}
        >
          Simpan Stok Awal ({terisi} bahan)
        </button>
      </div>

      {konfirmasi && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setKonfirmasi(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold text-stone-800">Konfirmasi Stok Awal</h2>
            <p className="mb-3 text-sm text-stone-600">
              Saldo <b>{terisi} bahan</b> akan ditetapkan ke nilai berikut. Bahan yang tidak
              diisi tidak berubah.
            </p>
            <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {(stok ?? [])
                .filter((s) => awal[s.ingredient_id] !== undefined && awal[s.ingredient_id] !== "")
                .map((s) => (
                  <div key={s.ingredient_id} className="flex justify-between text-sm">
                    <span className="text-stone-700">{s.nama}</span>
                    <span className="text-stone-700">
                      {formatAngka(s.saldo)} → <b>{formatAngka(Number(awal[s.ingredient_id]))}</b>{" "}
                      {s.satuan}
                    </span>
                  </div>
                ))}
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

      {selesai && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 text-lg font-bold text-stone-800">Stok Awal Tersimpan</h2>
            <p className="mt-2 text-sm text-stone-500">
              Saldo bahan sudah ditetapkan. Anda bisa menambahkannya lagi kapan saja.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setSelesai(false)} className={`${btnSecondary} flex-1`}>
                Isi lagi
              </button>
              <button onClick={() => navigate("/stok")} className={`${btnPrimary} flex-1`}>
                Ke Stok
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
